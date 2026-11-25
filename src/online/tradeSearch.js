import { positionFitness } from "./lineupEdit.js";
import { SUBSTITUTE_MIN_FITNESS } from "./shared.js";
import { normalizedVelocity, normalizedStamina } from "./tryoutPlan.js";

// ============================================================
// トレードを「補強したいところ」から考えるための計算（PC版。いしだ 2026-11-13）。
//
// 【意図】トレードは「自球団のどこを強くしたいか」から始まる。相手球団を先に選ぶ形だと、
//   欲しい選手を探すには11球団を1つずつ開くしかない。ここでは
//   - 補強ポイント … 守備位置・投手の持ち場ごとに、自球団の一番手がリーグで何番目か
//   - 候補 … ある持ち場を他球団の誰が担えるか（能力から出した「その持ち場での力」の順）
//   - 余り … 起用していない選手のうち、他球団なら一番手になれる人
//   - 釣り合い … CPU球団が受けそうか（サーバーと同じ値段・上乗せ・見る目の幅で）
//   を出す。
//
// ⚠ **アプリの `mobile/shared/.../TradeSearch.kt` と同じ式**。片方だけ変えると、
//    PCとアプリで補強ポイントや見込みが食い違う。変えるときは両方を変える。
// ⚠ 「その持ち場での力」は試合の強さではない（試合はサーバーの演算で決まる）。
//    ただし**CPU球団のトレードの値段もこの式を使う**（`server/tradeJudge.mjs` が
//    `bestSlot`・`squadStrength`・`needFactors`・`needOfDrop` を読む）。ここを変えると
//    CPUの判断も変わるので、`online-trade-check` も回すこと。
// ⚠ 釣り合いの境目は**サーバーが渡す数字**（`team.trade.margin`・`eyeLimit`）で引く。
//    ここに写しを持つと、CPUの判断を変えたときに「受けるはず」と出て断られる。
// ============================================================

/** トレードで探す持ち場。野手は守備位置、投手は先発・中継ぎ・抑え */
export const TRADE_SLOTS = [
  { key: "catcher", label: "捕手", pitcher: false },
  { key: "first", label: "一塁", pitcher: false },
  { key: "second", label: "二塁", pitcher: false },
  { key: "third", label: "三塁", pitcher: false },
  { key: "short", label: "遊撃", pitcher: false },
  { key: "left", label: "左翼", pitcher: false },
  { key: "center", label: "中堅", pitcher: false },
  { key: "right", label: "右翼", pitcher: false },
  { key: "sp", label: "先発", pitcher: true },
  { key: "rp", label: "中継ぎ", pitcher: true },
  { key: "cl", label: "抑え", pitcher: true },
];

export const tradeSlot = (key) =>
  TRADE_SLOTS.find((s) => s.key === key) || null;

/** 守れるとみなす適性（スタメンの交代の線と同じ） */
export const TRADE_MIN_FITNESS = SUBSTITUTE_MIN_FITNESS;
/** ローテの人数・ブルペンの人数 */
export const ROTATION_SIZE = 5;
export const BULLPEN_SIZE = 4;
/**
 * 球団の力（`squadStrength`）に中継ぎを数える重み。
 * ⚠ 2026-11-25 の計測で、同じ10点でも 野手の持ち場 +.033・先発 +.013・**中継ぎ +.0015** だった
 *    （中継ぎは投げる回が少ない）。等しく数えると、中継ぎを集めるトレードで「戦力が上がった」ように
 *    見えて勝ちに結びつかなかった（トレードの伸びの6割近くが投手）。アプリの `SQUAD_PEN_WEIGHT` と同じ値
 */
export const SQUAD_PEN_WEIGHT = 0.25;

/** 守る力を重く見る位置ほど大きい（捕手・遊撃・二塁・中堅） */
const DEFENSE_WEIGHT = {
  catcher: 0.5,
  short: 0.45,
  second: 0.4,
  center: 0.4,
  third: 0.3,
  right: 0.3,
  left: 0.2,
  first: 0.15,
};

const n = (v) => (Number.isFinite(v) ? v : 0);
const isPitcher = (p) => p.position === "pitcher";
const isActive = (p) => p.isActive !== false;
const average = (list) =>
  list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;

/**
 * 打つ力（ミ パ 眼 走）。
 * ⚠ 重みは**試合で効く順**に合わせた（2026-11-25、全球団の2年ぶん768球団・年の計測。
 *    打順の平均が1上がったときの勝率: ミート +8.6厘・パワー +6.8厘・走力 +3.6厘・選球眼 ほぼ0）。
 *    以前は 0.35/0.3/0.15/0.2 で、選球眼を重く見すぎていた。アプリの `battingPower`（TradeSearch.kt）と同じ値
 */
export const battingPower = (p) =>
  n(p.batting?.meet) * 0.4 +
  n(p.batting?.power) * 0.35 +
  n(p.batting?.eye) * 0.05 +
  n(p.physical?.speed) * 0.2;

/**
 * その持ち場での力（目安）。守れない（適性が線より下・投手の持ち場に野手）なら null。
 * ⚠ 野手の持ち場に投手は入れない（二刀流は編成で別に扱う）。
 */
export function slotStrength(p, slot) {
  const s = tradeSlot(slot);
  if (!s || !p) return null;
  if (s.pitcher) {
    if (!isPitcher(p)) return null;
    const vel = normalizedVelocity(p.pitching?.velocity);
    const ctl = n(p.pitching?.control);
    const spin = n(p.pitching?.spinRate);
    const sta = normalizedStamina(p.pitching?.stamina);
    // ⚠ 先発は制球を重く・スタミナを軽く（2026-11-25 の計測。ローテの平均が1上がったときの勝率:
    //    制球 +3.3厘・球速 +2.4厘・回転 +0.9厘・スタミナ ほぼ0）。以前は 0.3/0.3/0.15/0.25
    return slot === "sp"
      ? vel * 0.3 + ctl * 0.4 + spin * 0.15 + sta * 0.15
      : vel * 0.4 + ctl * 0.35 + spin * 0.2 + sta * 0.05;
  }
  if (isPitcher(p)) return null;
  const fit = positionFitness(p, slot);
  if (fit < TRADE_MIN_FITNESS) return null;
  const w = DEFENSE_WEIGHT[slot] ?? 0.3;
  const defense =
    ((n(p.fielding?.defense) * 0.7 + n(p.physical?.arm) * 0.3) * fit) / 100;
  return battingPower(p) * (1 - w) + defense * w;
}

const sp = (p) => slotStrength(p, "sp") ?? 0;
const rp = (p) => slotStrength(p, "rp") ?? 0;

/** 自球団の起用（打順の守備位置・先発ローテ・抑え）。`view.lineup` から作る */
export function teamUsage(lineup) {
  const fielders = {};
  for (const e of lineup?.battingOrder || []) {
    if (e?.playerId != null && e.position && e.position !== "pitcher")
      fielders[e.position] = e.playerId;
  }
  const starters = (lineup?.starters || []).filter((id) => id != null);
  const closerKey = Object.entries(lineup?.pitcherRoles || {}).find(
    ([, role]) => role === "closer",
  )?.[0];
  const closer = closerKey == null ? null : closerKey;
  const ids = new Set(
    [...Object.values(fielders), ...starters, closer]
      .filter((id) => id != null)
      .map(String),
  );
  return { fielders, starters, closer, ids };
}

/**
 * 名簿の野手を、力の高い組み合わせから順に1人1か所・1か所1人で守備位置に当てる（空いた位置は力0）。
 * ⚠ CPU球団の値段（`server/tradeJudge.mjs`）は `rosterTops` 経由でこの割り当てを使う
 */
export function fielderAssignment(roster) {
  const out = {};
  const fielderSlots = TRADE_SLOTS.filter((s) => !s.pitcher).map((s) => s.key);
  const pairs = roster
    .filter((p) => isActive(p) && !isPitcher(p))
    .flatMap((p) =>
      fielderSlots
        .map((s) => ({ p, s, v: slotStrength(p, s) }))
        .filter((e) => e.v != null),
    )
    .sort((a, b) => b.v - a.v);
  const used = new Set();
  for (const { p, s, v } of pairs) {
    if (out[s] || used.has(p.id)) continue;
    out[s] = { score: v, holder: p };
    used.add(p.id);
  }
  for (const s of fielderSlots)
    if (!out[s]) out[s] = { score: 0, holder: null };
  return out;
}

/**
 * 名簿の投手を、先発の力の上位 ROTATION_SIZE 人（ローテ）と、残りを救援の力の高い順（ブルペン）に分ける。
 * ⚠ サーバーの値段（`server/tradeJudge.mjs`）も使う。式は変えていない
 */
export function pitchingStaff(roster) {
  const pitchers = roster.filter((p) => isActive(p) && isPitcher(p));
  const rotation = [...pitchers]
    .sort((a, b) => sp(b) - sp(a))
    .slice(0, ROTATION_SIZE);
  const pen = pitchers
    .filter((p) => !rotation.includes(p))
    .sort((a, b) => rp(b) - rp(a));
  return { rotation, pen };
}

/**
 * 名簿だけから見た持ち場の力（他球団用。起用が分からないので、各位置に一番手を当てる）。
 * 野手は `fielderAssignment`。先発はローテの平均（一番手はいちばん弱い人）、抑えはブルペンの先頭、
 * 中継ぎはその次の BULLPEN_SIZE 人の平均。
 * @returns {Record<string, {score:number, holder:object|null}>}
 */
export function rosterSlotScores(roster) {
  const out = fielderAssignment(roster);
  const { rotation, pen } = pitchingStaff(roster);
  out.sp = {
    score: average(rotation.map(sp)),
    holder: rotation.at(-1) || null,
  };
  out.cl = {
    score: pen[0] ? slotStrength(pen[0], "cl") : 0,
    holder: pen[0] || null,
  };
  const middle = pen.slice(1, 1 + BULLPEN_SIZE);
  out.rp = { score: average(middle.map(rp)), holder: middle.at(-1) || null };
  return out;
}

/**
 * 自球団の持ち場の力（**いまの起用**で見る）。打順に入っていない位置・ローテが空なら名簿から補う。
 * 先発の一番手は「ローテでいちばん弱い人」（穴になっている人）を出す。
 */
export function ownSlotScores(roster, usage) {
  const byId = new Map(roster.map((p) => [String(p.id), p]));
  const out = { ...rosterSlotScores(roster) };
  for (const [pos, id] of Object.entries(usage.fielders)) {
    const p = byId.get(String(id));
    if (p && tradeSlot(pos)?.pitcher === false)
      out[pos] = { score: slotStrength(p, pos) ?? 0, holder: p };
  }
  const rotation = usage.starters
    .map((id) => byId.get(String(id)))
    .filter((p) => p && isPitcher(p));
  if (rotation.length) {
    const weakest = rotation.reduce((a, b) => (sp(b) < sp(a) ? b : a));
    out.sp = { score: average(rotation.map(sp)), holder: weakest };
    const starterIds = new Set(usage.starters.map(String));
    const pen = roster.filter(
      (p) => isActive(p) && isPitcher(p) && !starterIds.has(String(p.id)),
    );
    const named = usage.closer != null ? byId.get(String(usage.closer)) : null;
    const closer =
      named && isPitcher(named)
        ? named
        : pen.reduce((a, b) => (!a || rp(b) > rp(a) ? b : a), null);
    out.cl = { score: closer ? slotStrength(closer, "cl") : 0, holder: closer };
    const middle = pen
      .filter((p) => p !== closer)
      .sort((a, b) => rp(b) - rp(a))
      .slice(0, BULLPEN_SIZE);
    out.rp = { score: average(middle.map(rp)), holder: middle.at(-1) || null };
  }
  return out;
}

/**
 * 補強ポイント。持ち場ごとに自球団の順位を出し、弱い順に並べる。
 * @param others 他球団の名簿 `{球団名: roster}`（読めた球団だけでよい。順位は読めた球団の中での順位）
 */
export function reinforcePoints(mine, usage, others) {
  const own = ownSlotScores(mine, usage);
  const theirs = Object.values(others).map(rosterSlotScores);
  const inLineup = new Set(Object.values(usage.fielders).map(String));
  const bench = mine.filter(
    (p) => isActive(p) && !isPitcher(p) && !inLineup.has(String(p.id)),
  );
  return TRADE_SLOTS.map((slot) => {
    const m = own[slot.key] || { score: 0, holder: null };
    return {
      slot,
      holder: m.holder,
      score: m.score,
      rank:
        1 + theirs.filter((t) => (t[slot.key]?.score ?? 0) > m.score).length,
      teams: theirs.length + 1,
      noBackup:
        !slot.pitcher &&
        !bench.some((p) => positionFitness(p, slot.key) >= TRADE_MIN_FITNESS),
    };
  }).sort((a, b) => b.rank - a.rank || a.score - b.score);
}

/** 候補の絞り込み（型で探す）。`pitcher` が null なら投手・野手どちらにも使う */
export const TRADE_FILTERS = [
  {
    key: "young",
    label: "23歳以下",
    pitcher: null,
    test: (p) => (p.age ?? 99) <= 23,
  },
  {
    key: "meet",
    label: "好打（ミ70+）",
    pitcher: false,
    test: (p) => n(p.batting?.meet) >= 70,
  },
  {
    key: "power",
    label: "長打（パ70+）",
    pitcher: false,
    test: (p) => n(p.batting?.power) >= 70,
  },
  {
    key: "speed",
    label: "俊足（走70+）",
    pitcher: false,
    test: (p) => n(p.physical?.speed) >= 70,
  },
  {
    key: "arm",
    label: "強肩（肩70+）",
    pitcher: false,
    test: (p) => n(p.physical?.arm) >= 70,
  },
  {
    key: "lefty",
    label: "左投げ",
    pitcher: true,
    test: (p) => p.physical?.throws === "left",
  },
  {
    key: "velocity",
    label: "速球（150+）",
    pitcher: true,
    test: (p) => n(p.pitching?.velocity) >= 150,
  },
  {
    key: "control",
    label: "制球（制70+）",
    pitcher: true,
    test: (p) => n(p.pitching?.control) >= 70,
  },
];

/** 持ち場を他球団の誰が担えるか（その持ち場での力の高い順） */
export function tradeCandidates(slot, mine, usage, others, filter = null) {
  const base = ownSlotScores(mine, usage)[slot]?.score ?? 0;
  return Object.entries(others)
    .flatMap(([team, roster]) => {
      // 相手のその持ち場の一番手（先発ならエース。抜けると相手に穴が空く）
      const holder = rosterTops(roster)[slot]?.holder;
      return roster
        .filter((p) => isActive(p))
        .filter(
          (p) =>
            !filter ||
            ((filter.pitcher == null || filter.pitcher === isPitcher(p)) &&
              filter.test(p)),
        )
        .map((p) => {
          const strength = slotStrength(p, slot);
          return strength == null
            ? null
            : {
                team,
                player: p,
                strength,
                diff: strength - base,
                theirStarter: holder?.id === p.id,
              };
        })
        .filter(Boolean);
    })
    .sort((a, b) => b.strength - a.strength);
}

/** いちばん力を出せる持ち場 */
export function bestSlot(p) {
  let best = null;
  for (const s of TRADE_SLOTS) {
    const v = slotStrength(p, s.key);
    if (v != null && (!best || v > best.strength))
      best = { slot: s, strength: v };
  }
  return best;
}

/** 余りから外す（起用の中心とみなす）中継ぎの人数。アプリの `SURPLUS_KEEP_RELIEVERS` と同じ */
export const SURPLUS_KEEP_RELIEVERS = BULLPEN_SIZE;

/**
 * 名簿の中で、持ち場ごとの**一番手1人**とその力（他球団用。アプリの `rosterTops` と同じ）。
 * 野手は `rosterSlotScores` の割り当て、先発はローテでいちばん良い人、抑えは救援の一番手、中継ぎはその次。
 * ⚠ `rosterSlotScores` の先発・中継ぎは**人数ぶんの平均**と、いちばん弱い人なので、余りと比べると甘くなり
 *    （平均を上回るだけで「一番手になれる」と出ていた）、「相手の一番手」の印もローテの5番手に付いた。
 * @returns {Record<string, {score:number, holder:object|null}>}
 */
export function rosterTops(roster) {
  const out = fielderAssignment(roster);
  const { rotation, pen } = pitchingStaff(roster);
  const top = (p, slot) => ({
    score: p ? (slotStrength(p, slot) ?? 0) : 0,
    holder: p || null,
  });
  out.sp = top(rotation[0], "sp");
  out.cl = top(pen[0], "cl");
  out.rp = top(pen[1], "rp");
  return out;
}

// ------------------------------------------------------------------ 抜けたときの穴（CPUの値段の上乗せ）

/** 出すと穴が空く選手の上乗せ（最大 +20%）。⚠ サーバーの値段（`server/tradeJudge.mjs`）と共通 */
export const NEED_LIMIT = 0.2;
/**
 * 「穴が空く」を満額にする落差。抜けたときに**球団の持ち場の力の合計**がどれだけ
 * 落ちるかで測る。
 * ⚠ 持ち場での力は実測でおおむね 40〜65。8 は「代わりが居ない」と言える落差。
 * ⚠ **余りを値引きしないこと**。以前は起用の枠の外を一律0.88倍にしていたが、
 *    1人を1つの持ち場に縛って数えていたため、**他の持ち場なら一番手になれる強い控え
 *    まで「余り」**になり、弱い選手で強い控えが取れる組が 1.9%→7.9% へ増えた（実測）。
 *    いまは落差が0なら等倍（上乗せが無いだけ）。
 */
export const DROP_SCALE = 8;

/**
 * 球団の「持ち場の力の合計」。抜けたときの落差を測るための物差し。
 *
 * 数えるのは**実際に要る持ち場ぶん**だけ:
 *   野手 … 8つの持ち場の一番手（`fielderAssignment` の割り当て。1人1か所）＋ 2人目の捕手
 *   投手 … 先発 `ROTATION_SIZE` 人 ＋ 中継ぎ `BULLPEN_SIZE` 人（中継ぎは `SQUAD_PEN_WEIGHT` 倍）
 * ⚠ **一番手だけを数えないこと**。先発を1人しか数えないと、2〜5番手の先発が
 *    「抜けても落差0＝余り」になる。
 * ⚠ **捕手は2人**（名簿の最低条件が捕手1人なので、2人目が抜けると次の出場で詰まる）。
 * ⚠ 登録を外れた選手（`isActive === false`）は数えない（ほかの持ち場の数え方と同じ）。
 * ⚠ アプリの `squadStrength`（TradeSearch.kt）と同じ式。
 */
export function squadStrength(players) {
  const roster = players || [];
  const tops = rosterTops(roster);
  let total = 0;
  for (const slot of TRADE_SLOTS)
    if (!slot.pitcher) total += tops[slot.key]?.score || 0;
  const catchers = roster
    .filter(isActive)
    .map((p) => slotStrength(p, "catcher"))
    .filter((v) => v !== null)
    .sort((a, b) => b - a);
  total += catchers[1] ?? 0;
  const { rotation, pen } = pitchingStaff(roster);
  for (const p of rotation) total += slotStrength(p, "sp") ?? 0;
  for (const p of pen.slice(0, BULLPEN_SIZE))
    total += (slotStrength(p, "rp") ?? 0) * SQUAD_PEN_WEIGHT;
  return total;
}

// ============================================================
// 【活躍の場】いしだ 2026-11-24
//   「トレードは戦力の充実はもちろんですが、選手に活躍の場を与える場にすべきです。
//     もっとも得点が高いのは、余剰戦力が相手チームでレギュラーになれる場合です」
//
// ⚠ 受け取る側にとって、その選手が**持ち場の一番になれるか**を値段に乗せる。
//    控え止まりなら上乗せ0、その持ち場の一番になるなら満額。
// ⚠ 出す側の「余り」はもう見ている（`playerDrops` → `needOf`。抜けても穴が空かない選手は
//    値段が上がらない＝安く出せる）。**足りなかったのは受け取る側**で、CPUは
//    「うちで出番のある選手」と「ベンチを温める選手」を同じ値段で見ていた。
// ⚠ 「足りない持ち場へ弱い選手を押し込む」抜け道にはならない。上乗せは**その選手自身の
//    力に比例**するので、弱い選手は空いた持ち場に入っても上乗せが小さい。さらに
//    `STRENGTH_GAP_LIMIT` が両球団の戦力の伸びを比べる門番として残る。
// ============================================================
/**
 * 受け取る側で持ち場の一番になれるときの、値段の上乗せ。
 *
 * ⚠ 実測（初期セットの自軍 × CPU6球団・1対1の総当たり1,738件。CPUが受ける割合）:
 *   | 上乗せ | 相手でレギュラーになる選手 | 相手で控え止まり | 全体 |
 *   |---|---|---|---|
 *   | 無し  |  0.0% | 22.5% | 27.3% |
 *   | 35%   | 37.5% | 23.1% | 30.8% |
 *   | **50%** | **50.0%** | **23.1%** | **31.9%** |
 *   | 70%   | 62.5% | 23.4% | 34.4% |
 *   控え止まりの選手はどの値でもほとんど動かない（上乗せがその選手の力に比例するため）。
 *   50%にしたのは「レギュラーになれる交換」を半々まで通し、全体の緩みを+4.6ptに留める位置だから。
 */
export const PLAYING_TIME_BONUS = 0.50;

/**
 * その名簿に加えたとき、その選手が**持ち場の一番になって、どれだけ新しい力になるか**（0〜1）。
 * 1   … 空いた持ち場に入る（力がまるごと新しい上積みになる＝レギュラーの場そのもの）
 * 0.6 … 一番手を押しのける（例: 30の球団に80の選手なら 50/80）
 * 0   … いまの一番手に届かず控え止まり
 * ⚠ 「持ち場を取る」と「ちゃんと上積みになる」の**両方**が要る形にしてある。
 *    取るだけで満額にすると、控え級を押し込むだけで値段を満たせる
 * ⚠ アプリの `playingTimeShare`（TradeSearch.kt）と同じ式。
 */
export function playingTimeShare(roster, player) {
  const own = bestSlot(player)?.strength ?? 0;
  if (!(own > 0)) return 0;
  const before = squadStrength(roster || []);
  const after = squadStrength([...(roster || []), player]);
  return Math.max(0, Math.min(1, (after - before) / own));
}

/** 受け取る側から見た値段の倍率（1 〜 1+`PLAYING_TIME_BONUS`） */
export const playingTimeFactor = (roster, player) =>
  1 + PLAYING_TIME_BONUS * playingTimeShare(roster, player);

/**
 * 何人かまとめて受け取るときの、1人ずつの出番の度合い（並びは `players` と同じ）。
 * ⚠ **1人ずつ順に名簿へ足して、その人が足した分だけを数える**。1人ずつ `roster` と比べると、
 *    同じ持ち場に2人出したとき2人とも「一番になれる」と数え、上乗せが二重に付いた
 *    （遊撃30の球団へ遊撃70を2人で、本当の上積み40に対して80ぶん。監査 2026-11-24）。
 * ⚠ 足す順は**持ち場での力の高い順**（同じなら id の小さい順）。渡された並びに頼らない
 *    （画面とサーバーで並びが違っても同じ答えにするため）。アプリの `playingTimeShares` と同じ。
 */
export function playingTimeShares(roster, players) {
  const list = players || [];
  const order = list
    .map((p, i) => ({ p, i, own: bestSlot(p)?.strength ?? 0 }))
    .sort((a, b) => b.own - a.own || Number(a.p.id) - Number(b.p.id));
  const out = new Array(list.length).fill(0);
  let base = [...(roster || [])];
  let before = squadStrength(base);
  for (const { p, i, own } of order) {
    const next = [...base, p];
    const after = squadStrength(next);
    out[i] = own > 0 ? Math.max(0, Math.min(1, (after - before) / own)) : 0;
    base = next;
    before = after;
  }
  return out;
}

/**
 * CPU球団が受け取る選手（提案した側が出す選手）の値段（並びは `give` と同じ）。
 * `valueOf` の値段に、その球団で出番があるかの上乗せ（`PLAYING_TIME_BONUS`）を掛ける。
 * `rosterAfter` は**この交換で出ていく選手を抜いた**受け取る側の名簿。
 * ⚠ サーバーの `cpuDecisionFor`・Web の見込みメーター・アプリの `givingTradeValues` が同じこれを使う。
 *    値段の読めない選手（数でない）はそのまま返す。
 */
export function givingTradeValues(rosterAfter, give, valueOf) {
  const shares = playingTimeShares(rosterAfter, give);
  return (give || []).map((p, i) => {
    const v = valueOf(p);
    return Number.isFinite(v) ? v * (1 + PLAYING_TIME_BONUS * shares[i]) : v;
  });
}

/**
 * CPU球団が受ける「戦力の開き」の上限（`squadStrength` の点）。
 *
 * ⚠ **値段の釣り合いだけでは足りない**（いしだ 2026-11-14「2年目に人の球団が勝ちすぎる」）。
 *    値段は1人ずつの合計なので、弱い2人で強い1人を取る交換が通り、取った1人がそのまま
 *    スタメンに入る。人が「CPUが受ける中でいちばん得な交換」を選び続けると、開幕前の
 *    十数件でスタメン・ローテの力が約13%上がり、2年目の勝率が平均 .69（最高 .81）になった
 *    （`tools/sim-harness/human-trade-probe.mjs`、4つの世界）。
 * ⚠ CPUは**両方の球団の力の伸び**を比べ、提案した側の伸びが自分の伸びをこれより上回る
 *    交換を断る。両方の穴が埋まる交換は通る。
 *
 * ⚠ いしだ 2026-11-24「トレードで、値段が釣り合うのに戦力点が合わず破談になるケースが
 *    多いです。緩和してください」。**3点 → 8点**に緩めた。
 *    実測（初期セットの自軍 × CPU6球団・1対1と2対1の総当たり10,136件。値段が釣り合った案のうち
 *    戦力の開きで断られる割合）:
 *      3点 25.3% ／ 5点 22.1% ／ **8点 17.7%** ／ 10点 16.0% ／ 12点 13.2%
 *    断られる案が**3分の1減る**。
 * ⚠ **8点でも抜け穴は塞がったまま**。「控え2人で主力1人を取り、CPUの戦力は下がる」案
 *    725件のうち通るのは **0件**（10点で5件・12点で20件通り始める）。ここを10点以上に
 *    上げるときは `human-trade-probe` を回し直すこと。
 *
 * ⚠ **勝率への影響も測った**（`human-trade-probe`、種11/22/33/44、2年目の約73試合時点の
 *    人の球団の勝率。同じコードで線だけ差し替えた）:
 *      トレードしない .501 ／ 線3点 .511 ／ **線8点 .576**
 *    緩めたぶん、トレードを使う人が **+.075** 有利になる（3点はほぼ中立の +.010 だった）。
 *    この線が入ったときの問題（線なしで .69・しないとき .53 ＝ +.16）の半分以下なので
 *    そのままにしてある。もっと締めるなら5〜6点（断る割合は22.1%・21.3%）。
 * ⚠ **2026-11-14の記録「3点で .54」はもう当てにならない**。同じ3点を今のコードで測ると
 *    .511 で、それ以降の成長曲線・キャンプ・打撃フォーム・配球の変更で基準そのものが動いた。
 *    線を動かすときは**その時のコードで「しない」も測って**中立点を取り直すこと。
 * ⚠ **値段の上乗せで線を伸ばす案は採らなかった**。2対1は値段が1人ずつの足し算なので
 *    上乗せの中央値が68%もあり、上乗せで買える形にすると抜け穴がそのまま開く。
 *
 * ⚠ 根っこにあるのは**通貨の食い違い**で、線の位置の問題ではない。値段は1人ずつの
 *    足し算、`squadStrength` は持ち場ごとの一番だけ。控えを2人受け取ったCPUは
 *    「値段では払ってもらったのに戦力は増えない」。直すなら控えの厚みを戦力に
 *    数える側（`squadStrength`）で、線はその後で引き直す。
 *
 * ⚠ アプリの `STRENGTH_GAP_LIMIT`（TradeSearch.kt）と同じ値。サーバーは決まり（`team.trade.gapLimit`）
 *    でも渡すので、画面はそれを使う。
 */
export const STRENGTH_GAP_LIMIT = Number(globalThis.process?.env?.GAP_LIMIT || 8); // 計測用（sim だけ）

/**
 * 交換で開く戦力の差（点）＝提案した側の `squadStrength` の伸び − 受ける側の伸び。
 * 正なら提案した側のほうが強くなる。⚠ 交換後の名簿の並びはサーバーの
 * `rostersAfterTrade`（残った選手のあとに来た選手）と同じにする。
 * ⚠ アプリの `tradeStrengthGap`（TradeSearch.kt）と同じ式。
 * @param fromPlayers 提案した側の名簿
 * @param toPlayers 受ける側（CPU球団）の名簿
 * @param giveIds 提案した側が出す選手のid
 * @param getIds 受ける側が出す選手のid
 */
export function tradeStrengthGap(fromPlayers, toPlayers, giveIds, getIds) {
  const from = fromPlayers || [];
  const to = toPlayers || [];
  const give = new Set(giveIds || []);
  const get = new Set(getIds || []);
  const fromAfter = [
    ...from.filter((p) => !give.has(p.id)),
    ...to.filter((p) => get.has(p.id)),
  ];
  const toAfter = [
    ...to.filter((p) => !get.has(p.id)),
    ...from.filter((p) => give.has(p.id)),
  ];
  return (
    squadStrength(fromAfter) - squadStrength(from) -
    (squadStrength(toAfter) - squadStrength(to))
  );
}

/** 落差から倍率（1 〜 1+`NEED_LIMIT`） */
export const needOfDrop = (drop) =>
  1 + NEED_LIMIT * Math.min(1, Math.max(0, drop) / DROP_SCALE);

/**
 * 1人ずつ「ほかは残る」として抜いたときの落差（`Map<id, 落差>`。0 以上）と満員の力。
 * CPUの出し渋り（`tradeJudge.mjs` の `needOf`）と画面の「出しやすい」
 * （`tradeThoughts.js`）が**同じ測り方**を使うための1か所。
 * ⚠ 名簿の人数ぶん `squadStrength` を呼ぶ（25人なら26回）。球団ごとに1回だけ使うこと。
 * ⚠ 何人かまとめて出すときは、まとめて空く穴で見る `needFactors` の方を使う。
 */
export function playerDrops(roster) {
  const all = roster || [];
  const full = squadStrength(all);
  const drops = new Map(
    all.map((p) => [
      p.id,
      Math.max(0, full - squadStrength(all.filter((q) => q.id !== p.id))),
    ]),
  );
  return { full, drops };
}

/**
 * その球団が `players` を**まとめて**手放すときの、1人ずつの倍率（1 〜 1+`NEED_LIMIT`）。
 * `Map<id, 倍率>` で返す。名簿に居ない選手は 1。
 *
 * ⚠ **まとめて抜けたときの落差で決める**（監査 2026-11-13・いしだ「おすすめで」）。
 *    1人ずつ「ほかは残る」として測ると、外野のレギュラー2人をまとめてもらっても
 *    それぞれ「控えが埋める小さな穴」にしかならず、2人抜けた大きな穴に上乗せが
 *    掛からなかった。
 *    まとめた落差が1人ずつの落差の合計より大きいときは、その差を1人ずつの落差の
 *    割合で配る（1人ずつの落差が全員0なら等分）。小さいとき（同じ穴を2回数えて
 *    いたとき）は1人ずつの落差のまま。1人だけなら前と同じ値になる。
 */
export function needFactors(roster, players) {
  const all = roster || [];
  const out = new Map();
  const leaving = (players || []).filter(
    (p) => p && all.some((q) => q.id === p.id),
  );
  for (const p of players || []) if (p) out.set(p.id, 1);
  if (!leaving.length) return out;
  const full = squadStrength(all);
  const drops = leaving.map((p) =>
    Math.max(0, full - squadStrength(all.filter((q) => q.id !== p.id))),
  );
  const ids = new Set(leaving.map((p) => p.id));
  const together = Math.max(0, full - squadStrength(all.filter((q) => !ids.has(q.id))));
  const sum = drops.reduce((a, b) => a + b, 0);
  leaving.forEach((p, i) => {
    let drop = drops[i];
    if (leaving.length > 1 && together > sum)
      drop = sum > 0 ? (drop * together) / sum : together / leaving.length;
    out.set(p.id, needOfDrop(drop));
  });
  return out;
}

/**
 * CPU球団が `players` をまとめて出すときの値段（1人ずつ。並びは `players` と同じ）。
 * `base` は事情を抜いた値段（サーバーの `tradeBase`）。⚠ 1を下回らせない（サーバーと同じ）。
 * 1人なら `tradeValue` と同じになる。
 */
export function setTradeValues(roster, players, base) {
  const factors = needFactors(roster, players);
  return players.map((p) => Math.max(1, base(p) * (factors.get(p.id) ?? 1)));
}

/** 持ち場ごとの一番手1人の力（`rosterTops` の力だけ） */
export function rosterTopStrengths(roster) {
  return Object.fromEntries(
    Object.entries(rosterTops(roster)).map(([k, v]) => [k, v.score]),
  );
}

/**
 * 余りを出す。起用の中心（打順・ローテ・抑え・力の上位 `SURPLUS_KEEP_RELIEVERS` 人の中継ぎ）の外にいる選手のうち、
 * 他球団ならその持ち場の**一番手**を上回る人と、その球団。⚠ 相手に穴があるところへ出すと、相手にも得がある
 * （win-win の手がかり）。
 * ⚠ 以前は中継ぎを全員「起用していない」と数え、相手の中継ぎの平均と比べていたので、防御率4点台の中継ぎに
 *    9球団が手を挙げた（いしだ 2026-11-13）。式はアプリの `surplusPlayers` と同じ。
 */
export function surplusPlayers(mine, usage, others) {
  const theirs = Object.entries(others).map(([team, r]) => [
    team,
    rosterTopStrengths(r),
  ]);
  const kept = new Set(
    mine
      .filter(
        (p) => isActive(p) && isPitcher(p) && !usage.ids.has(String(p.id)),
      )
      .sort((a, b) => rp(b) - rp(a))
      .slice(0, SURPLUS_KEEP_RELIEVERS)
      .map((p) => String(p.id)),
  );
  return mine
    .filter(
      (p) =>
        isActive(p) && !usage.ids.has(String(p.id)) && !kept.has(String(p.id)),
    )
    .map((p) => {
      const best = bestSlot(p);
      if (!best) return null;
      const wantedBy = theirs
        .filter(([, top]) => best.strength > (top[best.slot.key] ?? 0))
        .map(([team]) => team);
      return wantedBy.length ? { player: p, ...best, wantedBy } : null;
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.wantedBy.length * 1000 +
        b.strength -
        (a.wantedBy.length * 1000 + a.strength),
    );
}

// ------------------------------------------------------------------ CPUの判断の目安

export const TRADE_ODDS = {
  // ⚠ 「断る」と言い切らない。値段が足りないときは、サーバーは別の顔ぶれで逆提案を組み、
  //    その顔ぶれの開きだけを見る（`cpuTradeDecision`）。言い切ると約1割で逆提案が返っていた（監査 2026-11-14）
  lopsided: "戦力差が開きすぎる（この形では受けない）",
  short: "足りない（逆提案か断る）",
  depends: "相手の監督しだい",
  likely: "受けるはず",
};

/** サーバーが渡すCPU球団の決まり（`team.trade`）。参加者の球団なら null */
export function cpuTradeRule(team) {
  const t = team?.trade;
  if (!t || !Number.isFinite(t.margin)) return null;
  return {
    margin: t.margin,
    eyeLimit: n(t.eyeLimit),
    eyeNote: t.eyeNote || null,
    // ⚠ 古いサーバーは渡さない（そのときは戦力の開きを見ない）
    gapLimit: Number.isFinite(t.gapLimit) ? t.gapLimit : null,
  };
}

/**
 * 釣り合い。CPUは「受け取る値段 ≧ 出す値段 × 上乗せ」で受ける（`trades.js` の
 * `cpuTradeDecision`）。値段には監督の見る目（1±eyeLimit）が1人ずつかかるので、
 * 見る目がいちばん不利でも届くなら「受けるはず」、いちばん有利でも届かないなら「足りない」。
 * ⚠ 値段は1を下回らせない（サーバーと同じ）。
 * @param give 自球団が出す選手の値段（CPUが受け取る）
 * @param get 自球団がもらう選手の値段（CPUが出す）
 */
export function tradeOdds(give, get, rule) {
  const lo = 1 - rule.eyeLimit;
  const hi = 1 + rule.eyeLimit;
  const sum = (list, f) => list.reduce((a, v) => a + Math.max(1, v * f), 0);
  if (sum(give, lo) >= sum(get, hi) * rule.margin) return "likely";
  if (sum(give, hi) < sum(get, lo) * rule.margin) return "short";
  return "depends";
}

/** 出す側の値段がもらう側の何割か（メーターの位置）。もらう選手がいなければ null */
export function tradeRatio(give, get) {
  if (!get.length) return null;
  const sum = (list) => list.reduce((a, v) => a + Math.max(1, v), 0);
  return sum(give) / sum(get);
}

/** メーターの境目（出す÷もらう）。これより下は「足りない」、上は「受けるはず」 */
export function tradeOddsBounds(rule) {
  const lo = 1 - rule.eyeLimit;
  const hi = 1 + rule.eyeLimit;
  return [(rule.margin * lo) / hi, (rule.margin * hi) / lo];
}

/** 値段の段（高・中・低）。並べた全員の値段の上3分の1・下3分の1で分ける */
export function valueTiers(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < 3) return () => null;
  const low = sorted[Math.floor(sorted.length / 3)];
  const high = sorted[Math.floor((sorted.length * 2) / 3)];
  return (v) =>
    !Number.isFinite(v) ? null : v >= high ? "高" : v < low ? "低" : "中";
}
