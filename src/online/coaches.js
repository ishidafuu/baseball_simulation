// ============================================================
// 指導者（監督・投手コーチ・野手コーチ）
//
// いしだ依頼（2026-11-09「CPU球団に個性を持たせる」）。仕様書:
// https://claude.ai/artifact/HN144s1P83tcUtWbSdH7yU
//
// 【何をするものか】全12球団に監督・投手コーチ・野手コーチの3人を置き、
// **その人の考え方と性格で球団ごとの野球の色を出す**。
//
// 【ビジョンが軸】（いしだ依頼 2026-11-10「作りたいチームを軸に」。案:
// https://claude.ai/artifact/8daopGmJUsa6EkP8vz87Yy ）
// 1人ずつ「攻めの型 × 守りの型 × 時間軸」と看板（攻めか守り）を持ち、
// 考え方（采配）・好む選手・キャンプの方針は**そこから決める**（乱数でばらばらに振らない）。
// 性格（気質・こだわり・任せ方）は「どうやるか」を受け持つ。
//
// ⚠ **監督は人の采配の肩代わり。能力を上げる効果は一切持たせない**（いしだ指定
//    2026-11-10「監督バフはナシ」「強さが変わるとこのシステムがブレます」）。
//    型でチームの強さを変えない。一人用の社会人モードのスタッフ
//    （`src/corporate/staffData.js`）は「打撃指導 70」のような数字で練習の伸びを
//    足すが、ここは考え方と性格だけ。
// ⚠ 考え方は**いま人が選べる設定**（`tactics.js` の采配・方針）と、CPUが
//    使っている点数の重み（トライアウト・退団・トレードの返事）にだけ効かせる。
//    試合の計算に新しい補正は足さない。人が同じ設定を選べば同じ試合になる。
// ⚠ ここは**乱数を引かない純粋な計算**と、乱数を引く生成（`generateCoach`）を
//    分けてある。生成は必ず種を決めた中（`seeded` / `withSeededRandom`）で呼ぶこと。
//    同じリーグを作り直したら同じ顔ぶれにならないと、再現が崩れる。
// ============================================================
import { getRandomSurname, getRandomGivenName } from '../data/playerNames.js';
import { hashSeed, withSeededRandom } from '../game/rng.js';
import { TACTIC_FIELDS, STRATEGY_FIELDS } from './tactics.js';
import { poleStats, playerWish, menuForStat } from '../season/trainingPolicy.js';
import { NEED_STATS, needStatValue } from './teamNeeds.js';
import { overallScore } from './tryoutPlan.js';

/** 役職。⚠ 監督とコーチは同じ「指導者」。役職は配属で決まる（コーチから監督へも上がる） */
export const COACH_ROLES = ['manager', 'pitching', 'batting'];
export const ROLE_LABELS = {
  manager: '監督',
  pitching: '投手コーチ',
  batting: '野手コーチ',
};

/**
 * 考え方。値は -2〜2 の整数（0 が標準）。
 * `domain` はその考え方を受け持つ役職（監督とコーチの考えの食い違い `conflictOf` に使う）。
 * ⚠ 値はビジョンから決める（`viewsFromVision`）。乱数は小さな揺らぎだけ。
 */
export const VIEWS = {
  smallBall: { label: '小技', low: '少なめ', high: '多め', domain: 'manager' },
  // ⚠ 代打・守備固めは**遅らせる向きしか無い**（設定「○回以降」は使い始めを遅らせるだけで、
  //    標準のAIより多く使う手が無い）。だから値は -2〜0（生成で 0 を上限にする）
  bench: { label: '代打・守備固め', low: '遅め', high: '標準', domain: 'manager', oneSided: true },
  build: { label: '編成', low: '育成', high: '勝負', domain: 'manager' },
  pitching: { label: '投球', low: '打たせて取る', high: '三振狙い', domain: 'pitching' },
  bullpen: { label: '継投', low: '先発に任せる', high: '早め', domain: 'pitching' },
  hitting: { label: '打撃', low: '慎重', high: '積極', domain: 'batting' },
  running: { label: '走塁', low: '慎重', high: '積極', domain: 'batting' },
};
const VIEW_KEYS = Object.keys(VIEWS);

/**
 * 性格。値は -2〜2 の整数。「どうやるか」を受け持つ（何を目指すかはビジョン）。
 * ⚠ 前の「起用（若手好き）」は時間軸（育成⇔勝負）に、「戦い方（攻め/守り）」と
 *    「選手との接し方」は「こだわり」にまとめた（二重に持つと筋の通らない人が出る）。
 */
const PERSONALITY = {
  temper: { label: '気質', low: '我慢強い', high: '短気' },
  stubborn: { label: 'こだわり', low: '柔軟', high: '頑固' },
  trust: { label: '任せ方', low: 'ワンマン', high: '任せる' },
};
export const PERSONALITY_KEYS = Object.keys(PERSONALITY);
/**
 * 語り口（見た目だけの性格。売り込みや手記の文体が変わる。采配には効かない）。
 * レビューの「あとで足せる案」（いしだ「重くなければ入れて」2026-11-10）
 */
export const VOICES = { talkative: '多弁', quiet: '寡黙', logical: '理論派', spirit: '熱血' };

// ------------------------------------------------------------
// ビジョン（攻めの型 × 守りの型 × 時間軸 と、看板）
//
// ⚠ 攻めと守りの両方を持つ（前の案の「戦い方5つから1つ」では、長打の監督は投手が、
//    投手王国の監督は打線が「おまかせ」になり、試合の半分に色が出なかった）。
//    看板の側を強く、もう一方を控えめに出す。
// ⚠ コーチも同じ形で持つ。コーチの間は受け持ちの側だけが効き（投手コーチは守り、
//    野手コーチは攻め）、監督に上がると両方が効く。
// 型ごとに1か所にまとめる:
//   - `noun` は紙面の「〇〇と〇〇の野球」、`phrase` / `joint` は「足でかき回し、継投で逃げ切る」
//   - `pref` は好む選手（トライアウトの加点・トレードの見る目・軸の選手。`prefBonus` のキー）。
//     攻めの型は野手、守りの型は投手の好み。`hitterPref` は守りの型が野手にも求めるもの
//     （打たせて守るは守備の良い野手。`prefsOf` で控えめに混ぜる）
//   - `views` は考え方の向き（`viewsFromVision`。看板の側は1倍、もう一方は `SUB_SIDE` 倍）。
//     機動力は小技と走塁、長打は強攻と積極打撃、つなぐは慎重な打撃と小技。先発で押すは先発に
//     長く任せて三振を狙い、継投でつなぐは早めの継投、打たせて守るは打たせて取る
//   - `pitch` / `quiet` / `reason` は売り込みの文（ふつう / 寡黙な人 / 理論派が看板の型に添える理屈）
// ------------------------------------------------------------
export const ATTACK_TYPES = {
  speed: {
    label: '機動力', noun: '機動力', phrase: '足でかき回す', joint: '足でかき回し',
    pref: 'speed',
    views: { smallBall: 1.6, running: 1.8 },
    pitch: 'うちは足で勝つ。塁に出たら何かが起きる野球をやる。',
    quiet: '足で勝つ。',
    reason: '盗塁と進塁で、1点を取る確率を上げる。',
  },
  power: {
    label: '長打', noun: '長打', phrase: '一発で決める', joint: '一発で決め',
    pref: 'power',
    views: { smallBall: -1.8, hitting: 1.6, running: -0.4 },
    pitch: '一発で試合を決める。打席では思い切り振ってほしい。',
    quiet: '一発で決める。',
    reason: '長打は1本で流れを変える。数字もそう出ている。',
  },
  contact: {
    label: 'つなぐ', noun: 'つなぎ', phrase: '四球とミートでつなぐ', joint: '四球とミートでつなぎ',
    pref: 'contact',
    views: { smallBall: 0.6, hitting: -1.6 },
    pitch: '四球でもいい。つないでつないで点を取る。',
    quiet: 'つないで点を取る。',
    reason: '出塁率が上がれば、得点は必ず増える。',
  },
};
export const DEFENSE_TYPES = {
  rotation: {
    label: '先発で押す', noun: '先発', phrase: '先発で押し切る', joint: '先発で押し切り',
    pref: 'stamina',
    views: { pitching: 1.0, bullpen: -1.6 },
    pitch: '先発には長いイニングを任せる。',
    quiet: '先発に任せる。',
    reason: '先発が長く投げれば、ブルペンの疲れも減る。',
  },
  bullpen: {
    label: '継投でつなぐ', noun: '継投', phrase: '継投で逃げ切る', joint: '継投で逃げ切り',
    pref: 'velocity',
    views: { pitching: 0.6, bullpen: 1.6 },
    pitch: '投手は早めにつないで、継投で逃げ切る。',
    quiet: '継投で逃げ切る。',
    reason: '打順が3巡目に入る前に代えるのが理屈に合う。',
  },
  fielding: {
    label: '打たせて守る', noun: '守り', phrase: '守備で1点を守る', joint: '守備で1点を守り',
    pref: 'control',
    hitterPref: 'defense',
    views: { pitching: -1.6, smallBall: 0.4, bench: 0.6 },
    pitch: '打たせて取って、守りで1点を守る。',
    quiet: '守り勝つ。',
    reason: '四球を減らして打たせて取れば、失点は減る。',
  },
};
const SIDE_TYPES = { attack: ATTACK_TYPES, defense: DEFENSE_TYPES };
/** 時間軸。主に「誰を使うか」（若手か実績か）に効く */
export const HORIZONS = {
  develop: { label: '育成', phrase: '若手を使って育てる' },
  middle: { label: '中間', phrase: '成績を見て入れ替える' },
  win: { label: '勝負', phrase: '今年勝ちに行く' },
};
/** コーチの受け持ちの側（投手コーチは守りの型、野手コーチは攻めの型。コーチの間はその側だけが効く） */
const ROLE_SIDE = { pitching: 'defense', batting: 'attack' };
/** 看板でない側の効き（看板の側は 1） */
const SUB_SIDE = 0.6;
const DEFAULT_VISION = { attack: 'contact', defense: 'rotation', flagship: 'attack', horizon: 'middle' };

/** その人のビジョン（無い・壊れた値は標準で埋める） */
export function visionOf(coach) {
  const v = coach?.vision || {};
  return {
    attack: Object.hasOwn(ATTACK_TYPES, v.attack) ? v.attack : DEFAULT_VISION.attack,
    defense: Object.hasOwn(DEFENSE_TYPES, v.defense) ? v.defense : DEFAULT_VISION.defense,
    flagship: v.flagship === 'defense' || v.flagship === 'attack' ? v.flagship : DEFAULT_VISION.flagship,
    horizon: Object.hasOwn(HORIZONS, v.horizon) ? v.horizon : DEFAULT_VISION.horizon,
  };
}

/** 看板の側なら 1、そうでなければ控えめ（`SUB_SIDE`） */
const sideWeight = (coach, side) => (visionOf(coach).flagship === side ? 1 : SUB_SIDE);

/**
 * その席で効く型の名前（投手コーチは守りの型「継投でつなぐ」、野手コーチは攻めの型「機動力」）。
 * 監督（両方が効く）は null。
 */
export function roleTypeLabel(coach, role) {
  const side = ROLE_SIDE[role];
  return side ? SIDE_TYPES[side][visionOf(coach)[side]].label : null;
}

/** 若手を使うか（育成 1・中間 0・勝負 -1）。トライアウト・退団・トレードの年齢の見方 */
const horizonYouth = (coach) => {
  const h = visionOf(coach).horizon;
  return h === 'develop' ? 1 : h === 'win' ? -1 : 0;
};

/**
 * 育成観（個性をどこまで伸ばすか）。保存は2つの値 `{ who, line }`:
 *   - `who` … 誰を尖らせるか（all 全員 / sharp 尖った選手だけ / none 誰も）
 *   - `line` … どこまで伸ばしたらバランスに戻すか（長所の線 65・70・80。null は線なし）
 * 画面には4つの名前で出す（`growthLabel`）。
 */
const GROWTH_STYLES = {
  extreme: '徹底して尖らせる',
  staged: '一定まで尖らせて整える',
  shape: '選手の形に合わせる',
  complete: '穴のない選手に',
};
const GROWTH_LINES = [65, 70, 80];
function growthOf(coach) {
  const g = coach?.growth || {};
  const who = ['all', 'sharp', 'none'].includes(g.who) ? g.who : 'sharp';
  const line = who !== 'none' && GROWTH_LINES.includes(Number(g.line)) ? Number(g.line) : null;
  return { who, line };
}
export function growthStyleOf(coach) {
  const { who, line } = growthOf(coach);
  return who === 'none' ? 'complete' : who === 'sharp' ? 'shape' : line == null ? 'extreme' : 'staged';
}

/**
 * 好む選手。ビジョンから決まる、重みつきの並び（`{ hitter: [...], pitcher: [...] }`）。
 * 1つずつ `{ pref, side, weight }`: 野手は攻めの型（重み1）、投手は守りの型（重み1）。
 * 守りの型が野手にも求めるもの（`hitterPref`。打たせて守るは守備の良い野手）は控えめ（0.4）。
 * ⚠ トライアウト・トレードの見る目・軸の選手・カードの文は、どれもこの並びから読む
 *    （`fitOf` と `preferenceText`）。1か所だけ別の読み方をすると、文と振る舞いがずれる。
 */
const PREF_LABELS = {
  stamina: 'スタミナのある先発',
  velocity: '球の速い投手',
  control: '制球の良い投手',
  speed: '俊足',
  power: '長打',
  contact: '巧打',
  defense: '守備の良い野手',
};
const SIDE_PREF_WEIGHT = 0.4;
function prefsOf(coach) {
  const v = visionOf(coach);
  const defense = DEFENSE_TYPES[v.defense];
  return {
    hitter: [
      { pref: ATTACK_TYPES[v.attack].pref, side: 'attack', weight: 1 },
      ...(defense.hitterPref ? [{ pref: defense.hitterPref, side: 'defense', weight: SIDE_PREF_WEIGHT }] : []),
    ],
    pitcher: [{ pref: defense.pref, side: 'defense', weight: 1 }],
  };
}

// 得意分野（`specialty`: manager / pitching / batting）は、向いている席（CPUの空席埋めで効く）と、
// 看板の決まりやすさ（投手コーチ向きの人は守りが看板になりやすい）。
// ⚠ 画面には出さない（最初の3人は席と同じものに決め打ちで、出しても意味が無い）

/**
 * 人の球団が分野ごとに選ぶ任せ方。
 * ⚠ **既定は「意見を聞く」**（いしだ指定）。全部「自分で」にすれば、
 *    指導者を入れる前とまったく同じ動きになる（検査で確かめる）。
 */
export const STAFF_MODES = {
  self: '自分で',
  advice: '意見を聞く',
  delegate: '任せる',
};
const DEFAULT_STAFF_MODE = 'advice';

/**
 * 分野。`owner` はその分野の判断を受け持つ役職（試合中の采配は項目ごとに違うので null）。
 */
export const STAFF_AREAS = {
  lineup: { label: 'スタメンと打順', owner: 'batting' },
  pitching: { label: '投手起用', owner: 'pitching' },
  tactics: { label: '試合中の采配', owner: null },
  tryout: { label: 'トライアウト', owner: 'manager' },
  release: { label: '退団', owner: 'manager' },
  camp: { label: 'キャンプ', owner: null },
};
export const STAFF_AREA_KEYS = Object.keys(STAFF_AREAS);
/**
 * 手続きと、それを受け持つ任せ方の分野（トライアウト・契約更改の退団・キャンプ）。
 * ⚠ 「任せる」にした手続きは、その人の決定を待たない（`coachEngine` の `waitsFor`）
 */
export const PHASE_STAFF_AREA = { tryout: 'tryout', contract: 'release', camp: 'camp' };

/** 人の球団の任せ方（無ければ既定）。⚠ 保存は `member.staffModes`（無い人もいる） */
export function staffModesOf(member) {
  const saved = member?.staffModes || {};
  return Object.fromEntries(
    STAFF_AREA_KEYS.map((key) => [
      key,
      Object.hasOwn(STAFF_MODES, saved[key]) ? saved[key] : DEFAULT_STAFF_MODE,
    ]),
  );
}

// ------------------------------------------------------------
// 采配の項目と、受け持つ役職・考え方
// ------------------------------------------------------------

/**
 * 試合中の采配（`TACTIC_FIELDS`）の受け持ち。`[役職, 考え方]`。
 * ⚠ 代打を使うか（`pinchHit`）・守備固めを使うか（`defensiveSub`）は指導者が
 *    触らない（「使わない」は極端で、人が選ぶもの）。
 */
const TACTIC_OWNERS = {
  sacrificeBunt: ['manager', 'smallBall'],
  squeeze: ['manager', 'smallBall'],
  safetyBunt: ['manager', 'smallBall'],
  pinchHitFrom: ['manager', 'bench'],
  defenseFrom: ['batting', 'bench'],
  hook: ['pitching', 'bullpen'],
  starterLimit: ['pitching', 'bullpen'],
};
/**
 * 方針（`STRATEGY_FIELDS`）の受け持ち。
 * ⚠ 守備方針（前進守備・シフト）は1試合ずっと効く極端な設定なので触らない。
 */
const STRATEGY_OWNERS = {
  batting: ['batting', 'hitting'],
  pitching: ['pitching', 'pitching'],
  baseRunning: ['batting', 'running'],
};

/**
 * 「AI判断」とみなす値（この値のときだけ、意見を聞くで指導者の考えが入る）。
 * ⚠ 画面の文（`coachView.mjs` の「…も標準」）も同じ判定を使う。2つに分けると、
 *    数の項目（代打・守備固めの回、先発の球数）の 0 の扱いがずれる
 */
export const isAuto = (key, value) =>
  value === undefined ||
  value === null ||
  value === 'auto' ||
  ((key === 'pinchHitFrom' || key === 'defenseFrom' || key === 'starterLimit') &&
    Number(value) === 0);

/** 混ぜた考え方（小数）をどちらに倒すか。⚠ ±0.75 までは「標準」 */
const LEAN = 0.75;
/**
 * 1試合ずっと効く方針（打撃・投球）を倒す線。⚠ 強い考えのときだけ動かす。
 * ビジョンから決めた考え方を ±0.75 で当てたら、「積極打撃」（パワー+8・慎重は-5 と片寄った効き）の
 * 球団が増え、リーグ全体の本塁打が一人用の約1.6倍になった（online-parity-check、
 * 種4通りで 0.69 対 一人用0.39）。1.25 にすると 0.51 で、PR #22 の頃（0.45）と同じ幅に戻る。
 * 方針まで動かすのは考えの強い人（長打が看板の人など）だけ。型の色はおもに試合中の采配
 * （小技・継投・代打の回）と走塁で出る
 */
const STRATEGY_LEAN = 1.25;
const lean = (v) => (v <= -LEAN ? -1 : v >= LEAN ? 1 : 0);

/** 考え方 → 設定の値 */
function optionFor(key, v) {
  const side = lean(v);
  switch (key) {
    case 'sacrificeBunt':
    case 'squeeze':
    case 'safetyBunt':
      return side < 0 ? 'avoid' : side > 0 ? 'aggressive' : 'auto';
    case 'pinchHitFrom':
      // ⚠ 「多め」は表せない（いまのAIが6回から出すのが最も早い）。少なめだけ8回からにする
      return side < 0 ? 8 : 0;
    case 'defenseFrom':
      return side < 0 ? 9 : 0;
    case 'hook':
      return side < 0 ? 'patient' : side > 0 ? 'early' : 'auto';
    case 'starterLimit':
      // ⚠ 早めの継投が強い人だけ100球で代える（スタミナ100の先発の上限は95球なので、
      //    効くのはスタミナの多い先発だけ）
      return v >= 1.25 ? 100 : 0;
    case 'batting':
      return v <= -STRATEGY_LEAN ? 'patient' : v >= STRATEGY_LEAN ? 'aggressive' : 'balanced';
    case 'pitching':
      return v <= -STRATEGY_LEAN ? 'contact' : v >= STRATEGY_LEAN ? 'strikeout' : 'balanced';
    case 'baseRunning':
      return side < 0 ? 'conservative' : side > 0 ? 'aggressive' : 'normal';
    default:
      return undefined;
  }
}

/** 監督の任せ度（0〜1）。性格の「任せ方」から決まる */
export const delegationOf = (manager) =>
  manager ? (clampInt(manager.personality?.trust ?? 0) + 2) / 4 : 1;

// ⚠ `|| 0` で -0 を 0 にする（保存の JSON を通ると -0 は 0 になり、作り直しと食い違う）
const clampInt = (v) => Math.max(-2, Math.min(2, Math.round(Number(v) || 0))) || 0;
/** 呼び名（姓だけ。「山田監督」）。名前は「姓 名」 */
export const shortName = (coach) => String(coach?.name || '').split(/\s+/)[0];
const viewOf = (coach, key) => clampInt(coach?.views?.[key] ?? 0);

/**
 * 役職の受け持ちの判断に使う考え方（小数）と、決めた人の説明。
 *
 * - 監督の受け持ち … 監督の考え方だけ
 * - コーチの受け持ち … 監督とコーチを任せ度で混ぜる（ワンマン 0%〜任せる 100%）
 *
 * `strictSeats`: 人の球団。**席が空いている受け持ちは「自分で」**（いしだ指定）。
 *    CPUはコーチが空席なら監督が決める。
 * 返り値 null は「指導者は決めない」（保存した設定のまま）。
 */
export function blendView(staff, role, key, { strictSeats = false } = {}) {
  const manager = staff?.manager || null;
  const coach = role === 'manager' ? null : staff?.[role] || null;
  if (role === 'manager') {
    if (!manager) return null;
    return { value: viewOf(manager, key), by: `${shortName(manager)}監督` };
  }
  if (!coach) {
    if (strictSeats || !manager) return null;
    return { value: viewOf(manager, key), by: `${shortName(manager)}監督` };
  }
  if (!manager)
    return { value: viewOf(coach, key), by: `${shortName(coach)}${ROLE_LABELS[role]}` };
  const w = delegationOf(manager);
  const value = viewOf(manager, key) * (1 - w) + viewOf(coach, key) * w;
  // ⚠ 画面では「（…）」の中に入るので、ここに括弧を使わない
  const by =
    w === 0
      ? `${shortName(manager)}監督・ワンマン`
      : w === 1
        ? `${shortName(coach)}${ROLE_LABELS[role]}`
        : `${shortName(coach)}${ROLE_LABELS[role]}と${shortName(manager)}監督・任せ度${Math.round(w * 100)}%`;
  return { value, by };
}

const optionLabel = (fields, key, value) => {
  const options = fields[key]?.[1] || {};
  return options[value] ?? options[String(value)] ?? String(value);
};

/**
 * その日の采配・方針（試合で実際に使う値）と、画面に出す内訳。
 *
 * - CPU（`human: false`）… 指導者が全部決める（任せると同じ）
 * - 人・自分で … 保存した設定のまま。指導者は何もしない
 * - 人・意見を聞く … 「AI判断」の項目だけ指導者の考えで動く。方針（打撃など）は保存のまま
 * - 人・任せる … 采配も方針も指導者が決める
 *
 * ⚠ 返す `tactics` / `strategy` は**その日だけ当てる写し**。保存した設定を書き換えない
 *    （人が「自分で」に戻したとき、元の設定が残っているように）。
 */
export function staffTactics({
  staff,
  human = false,
  mode = 'delegate',
  tactics = {},
  strategy = {},
}) {
  const effectiveMode = human ? mode : 'delegate';
  const outTactics = { ...(tactics || {}) };
  const outStrategy = { ...(strategy || {}) };
  const lines = [];
  for (const [key, [label]] of Object.entries(TACTIC_FIELDS)) {
    const setting = tactics?.[key];
    const owner = TACTIC_OWNERS[key];
    let by = null;
    if (owner && effectiveMode !== 'self' && (effectiveMode === 'delegate' || isAuto(key, setting))) {
      const blended = blendView(staff, owner[0], owner[1], { strictSeats: human });
      if (blended) {
        outTactics[key] = optionFor(key, blended.value);
        by = blended.by;
      }
    }
    lines.push({
      field: 'tactics',
      key,
      label,
      setting: setting ?? null,
      settingLabel: optionLabel(
        TACTIC_FIELDS,
        key,
        setting ?? Object.keys(TACTIC_FIELDS[key][1])[0],
      ),
      value: outTactics[key] ?? null,
      valueLabel: optionLabel(
        TACTIC_FIELDS,
        key,
        outTactics[key] ?? Object.keys(TACTIC_FIELDS[key][1])[0],
      ),
      by,
    });
  }
  for (const [key, [label]] of Object.entries(STRATEGY_FIELDS)) {
    const setting = strategy?.[key];
    const owner = STRATEGY_OWNERS[key];
    let by = null;
    if (owner && effectiveMode === 'delegate') {
      const blended = blendView(staff, owner[0], owner[1], { strictSeats: human });
      if (blended) {
        outStrategy[key] = optionFor(key, blended.value);
        by = blended.by;
      }
    }
    lines.push({
      field: 'strategy',
      key,
      label,
      setting: setting ?? null,
      settingLabel: optionLabel(
        STRATEGY_FIELDS,
        key,
        setting ?? Object.keys(STRATEGY_FIELDS[key][1])[0],
      ),
      value: outStrategy[key] ?? null,
      valueLabel: optionLabel(
        STRATEGY_FIELDS,
        key,
        outStrategy[key] ?? Object.keys(STRATEGY_FIELDS[key][1])[0],
      ),
      by,
    });
  }
  return { tactics: outTactics, strategy: outStrategy, lines };
}

// ------------------------------------------------------------
// 編成（トライアウト・退団・トレードの返事・キャンプ）
// ------------------------------------------------------------

/** 好みの加点の上限（1つあたり ±12点。候補の点数の揺らぎ±8と同じくらい） */
const PREF_CAP = 12;
const groupOf = (player) => (player.position === 'pitcher' ? 'pitcher' : 'hitter');
const prefBonus = (pref, p) => {
  const capped = (v) => Math.max(-PREF_CAP, Math.min(PREF_CAP, v));
  switch (pref) {
    case 'velocity':
      return capped(((p.pitching?.velocity || 140) - 140) * 0.8);
    case 'control':
      return capped(((p.pitching?.control || 50) - 50) * 0.4);
    case 'stamina':
      return capped(((p.pitching?.stamina || 100) - 100) * 0.25);
    case 'power':
      return capped(((p.batting?.power || 50) - 50) * 0.4);
    case 'contact':
      return capped(((p.batting?.meet || 50) - 50) * 0.4);
    case 'speed':
      return capped(((p.physical?.speed || 50) - 50) * 0.4);
    case 'defense':
      return capped(((p.fielding?.defense || 50) - 50) * 0.4);
    default:
      return 0;
  }
};

/**
 * その人の目で見た、選手の型への合い方（加点。`prefsOf` の並びを重みで足す）。
 * 監督（`role` なし）は看板の側を強く、もう一方を控えめに見る（`sideWeight`）。
 * コーチ（`role` に席）は受け持ちの側の好みだけで見る（投手コーチは守り、野手コーチは攻め）。
 */
function fitOf(coach, player, role = null) {
  const only = ROLE_SIDE[role];
  let score = 0;
  for (const { pref, side, weight } of prefsOf(coach)[groupOf(player)]) {
    if (only && side !== only) continue;
    score += prefBonus(pref, player) * weight * (only ? 1 : sideWeight(coach, side));
  }
  return score;
}

/**
 * トライアウトの選び方に渡す球団の事情（`selectPlayerForAI` の `teamContext`）。
 *
 * - `winRate` … 若手を取るか即戦力を取るか。監督の「編成」（時間軸から決まる）と
 *   前年の勝率で決まる（もとからある「勝率で寄せる」仕組みをそのまま使う）
 * - `bonus` … 型に合う選手への小さな加点（1つ最大±12点。候補の点数の揺らぎ±8と同じくらい）
 *
 * 投手は投手コーチ、野手は野手コーチの目（受け持ちの側の好み）を、監督の任せ度で監督の目と
 * 混ぜる（`fitOf`）。監督の目は看板の側が強い。
 * 監督が居なければ null（人の球団で監督が空席＝自分で）。
 */
export function tryoutContext(staff, { lastWinRate = 0.5 } = {}) {
  const manager = staff?.manager;
  if (!manager) return null;
  const w = delegationOf(manager);
  const build = viewOf(manager, 'build');
  const youth = horizonYouth(manager);
  return {
    winRate: Math.max(0, Math.min(1, 0.5 + 0.12 * build + 0.5 * ((lastWinRate ?? 0.5) - 0.5))),
    bonus: (p) => {
      const role = p.position === 'pitcher' ? 'pitching' : 'batting';
      const coach = staff[role];
      let score = coach ? (1 - w) * fitOf(manager, p) + w * fitOf(coach, p, role) : fitOf(manager, p);
      // 育成は若手、勝負はベテラン（20歳以下と27歳以上に±2点ずつ）
      const age = p.age || 22;
      if (age <= 20) score += youth * 2;
      else if (age >= 27) score -= youth * 2;
      return score;
    },
  };
}

/** 退団の選び方の偏り（育成の監督ほどベテランを早めに出す。`getAIReleaseCandidates`） */
export function releaseBias(staff) {
  const manager = staff?.manager;
  return manager ? { youth: horizonYouth(manager) } : null;
}

/** トレードの見る目の幅（±10%）。⚠ 広いと、人がその差で何度も得をする（CPUは1.05倍で受ける） */
export const TRADE_FACTOR_LIMIT = 0.1;

/**
 * CPU球団がトレードで選手を見る目（`server/tradeJudge.mjs` の値段にかける倍率。0.9〜1.1）。
 * 育成の監督は若手を高く、勝負の監督はいまの主力の年齢（27歳以上）を高く見る（最大±6%）。
 * 型に合う選手も少し高く見る（最大±3%）。
 * ⚠ 上乗せ（`CPU_ACCEPT_MARGIN`）は全球団そのまま。見る目だけを変える。
 */
export function tradeFactor(staff, player) {
  const manager = staff?.manager;
  if (!manager || !player) return 1;
  const build = viewOf(manager, 'build');
  const youth = horizonYouth(manager);
  const age = player.age || 25;
  let f = 1;
  if (age <= 23) f += -0.025 * build + 0.01 * youth;
  else if (age >= 27) f += 0.025 * build - 0.01 * youth;
  f += 0.03 * Math.max(-1, Math.min(1, fitOf(manager, player) / PREF_CAP));
  return Math.max(1 - TRADE_FACTOR_LIMIT, Math.min(1 + TRADE_FACTOR_LIMIT, f));
}

/**
 * CPU球団の見る目を、トレードの画面に出す一言にする（`tradeFactor` と同じ式から）。
 * ⚠ 倍率そのものは出さない（目安だけ。いしだ 2026-11-13）。向きと、型の加点があることだけ。
 */
export function tradeEyeNote(staff) {
  const manager = staff?.manager;
  if (!manager) return null;
  const young = -0.025 * viewOf(manager, 'build') + 0.01 * horizonYouth(manager);
  const age =
    young > 0.005
      ? '23歳以下の若手を高く見る'
      : young < -0.005
        ? '27歳以上の主力を高く見る'
        : '年齢では差をつけない';
  return `${shortName(manager)}監督: ${age}・型に合う選手を少し高く見る`;
}

/** 「穴のない選手に」で短所を埋めに行く開き（その段階の長所と短所の差） */
const PATCH_GAP = 15;

/**
 * その指導者が1人の選手に当てるキャンプの方針（`{ direction, phase }`）。
 *
 * - 段階（phase）は時間軸から: 育成は23歳以下に基礎体力、勝負は技術、中間は本人の希望。
 *   ⚠ 柔軟な人（こだわり -1 以下）は、段階を本人の希望に合わせる（やる気を落とさない）
 * - 方向（direction）は育成観から（`growthOf`）:
 *   - 全員を尖らせる … 長所が線に届くまで「長所」、届いたら「短所」（線なしならずっと長所）
 *   - 尖った選手だけ … 尖った選手は線まで「長所」、ほかは「全体」（バランスを個性として伸ばす）。
 *     尖った選手かどうかは選手の希望（`playerWish`）と同じ物差し（技術の長所と短所の開き）
 *   - 誰も尖らせない … 開きが大きければ「短所」、小さければ「全体」
 * ⚠ どれも人がキャンプの画面で選べる方針。伸びを足す効果は無い。
 * ⚠ 「何を伸ばすか」（メインの練習の割り当て）は育成の的（`campAim`）が決める。的を覚えている選手は、
 *    ここで出した方向より的の方向が先（`campPlan`）。
 */
export function growthPolicy(coach, player) {
  const { who, line } = growthOf(coach);
  const horizon = visionOf(coach).horizon;
  const wish = playerWish(player);
  const age = player?.age ?? 25;
  let phase = horizon === 'develop' ? (age <= 23 ? 'physique' : 'skill') : horizon === 'win' ? 'skill' : wish.phase;
  if (clampInt(coach?.personality?.stubborn) <= -1) phase = wish.phase;
  const pole = poleStats(player, phase);
  if (!Number.isFinite(pole.bestValue)) return { direction: 'balanced', phase };
  const belowLine = line == null || pole.bestValue < line;
  const direction =
    who === 'all'
      ? belowLine ? 'sharpen' : 'patch'
      : who === 'sharp'
        ? wish.direction === 'sharpen' && belowLine ? 'sharpen' : 'balanced'
        : pole.bestValue - pole.worstValue >= PATCH_GAP ? 'patch' : 'balanced';
  return { direction, phase };
}

// ------------------------------------------------------------
// 球団の状況から見た時間軸（先方要望 #7「弱小チームの方針転換」。2026-11-27）
//
// 【なぜ要るか】時間軸（育成・中間・勝負）は人物に固定で、生まれたときの抽選のまま変わらなかった。
//   最下位の球団でも「勝負」の監督なら勝ちに行き続け、何年負けても同じことを繰り返す。
// 【どうしたか】年度更新で、球団の状況（勝率・前年の勝率・同じ部の中の戦力の位置・主力の年齢）から
//   「あるべき時間軸」（`shouldHorizon`）を出し、指導者が**こだわりの強さに応じて**寄る
//   （`followHorizon`）。柔軟な人はすぐ寄り、頑固な人は何年か外れ続けて初めて折れる。
//   人物の個性（生まれの抽選）は残り、寄るのも1年に1段だけ（育成⇔中間⇔勝負）。
// ⚠ CPU球団の指導者だけ（`coachEngine.coachOffseason`）。人の球団の指導者は人が選んだ人なので動かさない。
// ⚠ 乱数を引かない。
// ------------------------------------------------------------

/** 勝率の物差し（117試合で1標準偏差くらい） */
const HORIZON_RATE_SCALE = 0.08;
/** これを越えたら勝負、下回ったら育成 */
const HORIZON_LINE = 0.75;
/** 主力がこの年齢以上で、状況が五分より悪ければ作り直し（育成） */
const HORIZON_OLD_CORE = 31;

/**
 * 球団の状況から見た、あるべき時間軸（'develop' | 'middle' | 'win'）。
 * - `winRate` … 終わった年の勝率、`lastWinRate` … その前の年（無ければ終わった年と同じに見る）
 * - `strength` … 同じ部の中の戦力（`squadStrength`）の位置。1 が最強・0 が最弱
 * - `coreAge` … 主力（レギュラー）の平均年齢
 */
export function shouldHorizon({ winRate = 0.5, lastWinRate = null, strength = 0.5, coreAge = 28 } = {}) {
  const form =
    (0.6 * (winRate - 0.5) + 0.4 * ((lastWinRate ?? winRate) - 0.5)) / HORIZON_RATE_SCALE;
  const power = (strength - 0.5) * 3;
  const score = 0.5 * form + 0.5 * power;
  if (coreAge >= HORIZON_OLD_CORE && score < 0) return 'develop';
  return score >= HORIZON_LINE ? 'win' : score <= -HORIZON_LINE ? 'develop' : 'middle';
}

const HORIZON_STEPS = ['develop', 'middle', 'win'];
/** 何年外れ続けたら寄るか（こだわり: 柔軟 -1 以下は1年・ふつうは2年・頑固 1 以上は3年） */
export const horizonPatience = (coach) => {
  const stubborn = clampInt(coach?.personality?.stubborn);
  return stubborn <= -1 ? 1 : stubborn >= 1 ? 3 : 2;
};

/**
 * 指導者を、あるべき時間軸（`want`）へ寄せる。**その人を直接書き換える**。
 * 外れた年数は `coach.horizonMiss`（`{ want, years }`）に数え、こだわりの年数（`horizonPatience`）に
 * 届いたら1段だけ寄る。合っていれば数えを消す。寄ったら新しい時間軸を返す（寄らなければ null）。
 * ⚠ 向きが変わったら（育成を求められていたのが勝負に）数え直す
 */
export function followHorizon(coach, want) {
  if (!coach || !HORIZON_STEPS.includes(want)) return null;
  const v = visionOf(coach);
  if (v.horizon === want) {
    delete coach.horizonMiss;
    return null;
  }
  const prev = coach.horizonMiss;
  const years = prev?.want === want ? (prev.years || 0) + 1 : 1;
  if (years < horizonPatience(coach)) {
    coach.horizonMiss = { want, years };
    return null;
  }
  const at = HORIZON_STEPS.indexOf(v.horizon);
  const next = HORIZON_STEPS[at + Math.sign(HORIZON_STEPS.indexOf(want) - at)];
  coach.vision = { ...v, horizon: next };
  delete coach.horizonMiss;
  return next;
}

// ------------------------------------------------------------
// 育成の的（先方要望 #6 第2段。2026-11-27）
//
// 【なぜ要るか】CPU の育成の方針は毎年その場の能力の開きから引き直していた（`playerWish` の
//   開き 22・10 の線）。伸ばした結果で開きが変わると方針が切り替わり、何年たっても積み上がらない。
//   人は「毎年同じ能力に集中練習を当て続ける」だけで勝率 .700 を超えていた（先方の計測）。
// 【どうしたか】指導者がその選手で**何を伸ばすか**（的）を、
//   「球団に足りないもの（`teamNeeds`）× 指導者の型の好み × その選手が伸ばせるもの」で決め、
//   選手に覚えさせて（`player.campAim`）**数年持ち続ける**。下駄ではなく方針の一貫性。
// ⚠ 伸びを足す効果は無い。当てるのは人がキャンプの画面で選べるメニュー（集中練習か幅広い練習）。
// ⚠ 乱数を引かない（画面の案と締め切りの実行で同じ的になるように）。
// ⚠ 時間軸で穴の重みが変わる: 勝負は穴を強く見る（今年の穴を埋める）、育成は弱く見る
//   （その選手の長所を伸ばす）。
// ------------------------------------------------------------

/** 能力が試合に効く重み（`tradeSearch.js` の `battingPower`・`slotStrength` の重みに合わせた目安） */
const AIM_WEIGHT = {
  meet: 0.4,
  power: 0.35,
  speed: 0.2,
  eye: 0.05,
  control: 0.4,
  velocity: 0.3,
  stamina: 0.15,
};
/** 守備は守る位置で重みが違う（捕手・遊撃・二塁・中堅は重い） */
const aimDefenseWeight = (player) =>
  ['catcher', 'short', 'second', 'center'].includes(player?.position) ? 0.3 : 0.15;
/** 長所を伸ばす的に選べる能力（集中練習がある能力）と、短所を埋める的に選べる能力 */
const AIM_POOL = {
  sharpen: { hitter: ['meet', 'power', 'eye', 'speed', 'defense'], pitcher: ['control', 'velocity'] },
  patch: { hitter: NEED_STATS.hitter, pitcher: NEED_STATS.pitcher },
};
/** 型の好み（`prefsOf` の `pref`）→ 能力 */
const PREF_STAT = {
  contact: 'meet',
  power: 'power',
  speed: 'speed',
  defense: 'defense',
  control: 'control',
  velocity: 'velocity',
  stamina: 'stamina',
};
/** 的を持ち続ける年数。これを過ぎたら選び直す（同じ能力がまた選ばれることもある） */
export const AIM_YEARS = 3;
/** 長所を伸ばす的の上限（指導者の線が無いとき）。届いたら選び直す */
const AIM_CAP = 85;
/** 穴の重み（時間軸ごと） */
const AIM_NEED_WEIGHT = { develop: 0.6, middle: 1.0, win: 1.5 };
/** 型の好みの重み */
const AIM_PREF_WEIGHT = 0.5;

/** その指導者がこの能力をどれだけ好むか（0〜。看板の側は1、もう一方は控えめ。コーチは受け持ちの側だけ） */
function aimPref(coach, player, stat, role) {
  const only = ROLE_SIDE[role];
  let w = 0;
  for (const { pref, side, weight } of prefsOf(coach)[groupOf(player)]) {
    if (only && side !== only) continue;
    if (PREF_STAT[pref] === stat) w += weight * (only ? 1 : sideWeight(coach, side));
  }
  return w;
}

/** その選手の、的に選べる能力の平均（長所・短所の基準） */
const aimBase = (player) => {
  const xs = NEED_STATS[groupOf(player)].map((s) => needStatValue(player, s)).filter((v) => v != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};

/** 覚えている的がまだ使えるか */
function aimStillGood(player, aim, year, line) {
  if (!aim || !['sharpen', 'patch'].includes(aim.mode)) return false;
  if (!AIM_POOL[aim.mode][groupOf(player)].includes(aim.stat)) return false;
  if (!Number.isFinite(aim.since) || year - aim.since >= AIM_YEARS || year < aim.since) return false;
  const v = needStatValue(player, aim.stat);
  if (v == null) return false;
  if (aim.mode === 'sharpen') return v < (line ?? AIM_CAP);
  // 短所が埋まった（平均を越えた）ら選び直す
  const base = aimBase(player);
  return base == null || v < base + 3;
}

/**
 * その指導者がこの選手に当てる育成の的（`{ stat, mode, since }`）。当てないなら null。
 *
 * - 覚えている的（`player.campAim`）がまだ使えるなら**それを続ける**（年数・上限・短所が埋まったかを見る）
 * - 無ければ `direction`（`growthPolicy` の方向）が「長所」「短所」のときだけ新しく選ぶ。
 *   「全体」なら的を持たない（今までどおり幅広い練習）
 * - 選び方: 試合に効く重み ×（1 ＋ 穴 × 時間軸の重み ＋ 型の好み × 0.5）× その選手の向き
 *   （長所は平均より高いほど、短所は低いほど）
 * `needs` は `teamNeeds` の結果（無ければ穴は0として選ぶ）。`role` はその選手を見る席。
 */
export function campAim(coach, player, { needs = null, year = 0, role = null, direction = 'balanced' } = {}) {
  const { line } = growthOf(coach);
  if (aimStillGood(player, player?.campAim, year, line)) {
    const { stat, mode, since } = player.campAim;
    return { stat, mode, since };
  }
  if (direction !== 'sharpen' && direction !== 'patch') return null;
  const base = aimBase(player);
  if (base == null) return null;
  const needW = AIM_NEED_WEIGHT[visionOf(coach).horizon] ?? 1;
  let best = null;
  for (const stat of AIM_POOL[direction][groupOf(player)]) {
    const v = needStatValue(player, stat);
    if (v == null) continue;
    if (direction === 'sharpen' ? v < base || v >= (line ?? AIM_CAP) : v > base) continue;
    const weight = stat === 'defense' ? aimDefenseWeight(player) : AIM_WEIGHT[stat] ?? 0;
    const pull = 1 + needW * (needs?.stats?.[stat] ?? 0) + AIM_PREF_WEIGHT * aimPref(coach, player, stat, role);
    const lean = direction === 'sharpen' ? 1 + (v - base) / 20 : 1 + (base - v) / 40;
    const score = weight * pull * lean;
    if (!best || score > best.score) best = { stat, score };
  }
  return best ? { stat: best.stat, mode: direction, since: year } : null;
}

/**
 * キャンプの方針（選手ごとの上書き）。投手は投手コーチ、野手は野手コーチの育成観。
 * コーチが居なければ監督。誰も居なければ null（標準のまま）。
 * ⚠ **人の球団（`strictSeats`）は監督で埋めない**。コーチの居ない側の選手は上書きせず、
 *    全体の方針を「おすすめ」（「自分で」の既定と同じ）にして、その選手はおすすめで練習する。
 *    CPU球団はこれまでどおり（全員同じ「全体×技術」の上に上書き）
 * ⚠ **育成の的**（`campAim`）がある選手は、方向を的に合わせ、メイン練習（`assignments`）を
 *    的の能力の練習にする。的は `aims` に入れて返し、キャンプを回した側が選手に覚えさせる
 *    （`runCampRound`）。`needs` は `teamNeeds`、`year` は今の年（的を持ち続ける年数を数える）
 */
export function campPlan(staff, roster, { strictSeats = false, needs = null, year = 0 } = {}) {
  const pick = (role) =>
    staff?.[role] ? { coach: staff[role], role } : !strictSeats && staff?.manager ? { coach: staff.manager, role: null } : null;
  const players = {};
  const assignments = {};
  const aims = {};
  let any = false;
  for (const player of roster || []) {
    const seat = pick(player.position === 'pitcher' ? 'pitching' : 'batting');
    if (!seat) continue;
    any = true;
    const own = growthPolicy(seat.coach, player);
    const aim = campAim(seat.coach, player, { needs, year, role: seat.role, direction: own.direction });
    if (aim) {
      players[player.id] = { direction: aim.mode, phase: own.phase };
      assignments[player.id] = menuForStat(player, aim.stat, aim.mode);
      aims[player.id] = aim;
    } else players[player.id] = own;
  }
  if (!any) return null;
  return {
    policy: strictSeats ? { mode: 'recommended' } : { mode: 'team', direction: 'balanced', phase: 'skill' },
    players,
    assignments,
    aims,
  };
}

// ------------------------------------------------------------
// 説明の文（画面・紙面で同じ文を使う。サーバーでだけ作る）
// ------------------------------------------------------------

/** 攻めと守りの型（`ATTACK_TYPES` / `DEFENSE_TYPES` の1つずつ）を看板の側から順に2つ */
const sidesOf = (coach) => {
  const v = visionOf(coach);
  const attack = ATTACK_TYPES[v.attack];
  const defense = DEFENSE_TYPES[v.defense];
  return v.flagship === 'defense' ? [defense, attack] : [attack, defense];
};

/** その人の野球の一言（紙面の言葉。「機動力と継投の野球」。看板が先） */
export function coachColor(coach) {
  if (!coach) return '';
  const [flag, other] = sidesOf(coach);
  return `${flag.noun}と${other.noun}の野球`;
}

/** ビジョンの見出し（「足でかき回し、継投で逃げ切る」。看板が先） */
export function visionHeadline(coach) {
  if (!coach) return '';
  const [flag, other] = sidesOf(coach);
  return `${flag.joint}、${other.phrase}`;
}

/**
 * ビジョンの内訳（「攻め 機動力（看板）・守り 継投でつなぐ・育成」）。
 * `role` がコーチの席なら、受け持ちの側に「（受け持ち）」を付ける（コーチの間はその側だけが効く）。
 */
export function visionText(coach, role = null) {
  if (!coach) return '';
  const v = visionOf(coach);
  const mark = (side) => {
    const words = [
      v.flagship === side ? '看板' : null,
      ROLE_SIDE[role] === side ? '受け持ち' : null,
    ].filter(Boolean);
    return words.length ? `（${words.join('・')}）` : '';
  };
  return `攻め ${ATTACK_TYPES[v.attack].label}${mark('attack')}・守り ${DEFENSE_TYPES[v.defense].label}${mark('defense')}・${HORIZONS[v.horizon].label}`;
}

/** 育成観の一言（「一定まで尖らせて整える（長所70まで）」） */
export function growthLabel(coach) {
  const { line } = growthOf(coach);
  return `${GROWTH_STYLES[growthStyleOf(coach)]}${line != null ? `（長所${line}まで）` : ''}`;
}

/** 好む選手の一言（「野手は俊足と守備の良い野手、投手は制球の良い投手」） */
export function preferenceText(coach) {
  const prefs = prefsOf(coach);
  const say = (list) => list.map((x) => PREF_LABELS[x.pref]).join('と');
  return `野手は${say(prefs.hitter)}、投手は${say(prefs.pitcher)}`;
}

const HORIZON_PITCH = {
  develop: '若い選手は失敗していい。使いながら育てる。',
  middle: '調子と成績を見て、使う選手を決める。',
  win: '今年勝つ。結果を出した選手を使う。',
};
const GROWTH_PITCH = {
  extreme: '長所は伸ばせるだけ伸ばす。',
  staged: 'まず武器を作り、それから穴を埋める。',
  shape: '選手それぞれの形を大事にしたい。',
  complete: '穴のない選手に育てたい。',
};
const REGRET_PITCH = '前はやり方にこだわりすぎた。今度は選手の声も聞く。';

/**
 * 売り込みの文（本人の言葉。市場で選ぶときの判断材料）。看板の側から語る。
 * 語り口（`voice`）で文体が変わる。監督を解任された人は「前回の反省」を添える
 * （市場にいる間と、反省を活かして監督に戻った年。`mellowOnReturn`）。
 * `year` は今の年（戻った年かを見る）。
 * ⚠ 文はサーバーでだけ使う（PC・スマホ・アプリで同じ文を出す）
 */
export function pitchText(coach, { year = null } = {}) {
  if (!coach) return '';
  const [flag, other] = sidesOf(coach);
  const regret = regretPending(coach) || (year != null && coach.mellowedAt === year) ? [REGRET_PITCH] : [];
  if (coach.voice === 'quiet') return [...regret, flag.quiet, other.quiet, 'あとは結果で見せる。'].join('');
  return [
    ...regret,
    flag.pitch,
    other.pitch,
    coach.voice === 'logical' ? flag.reason : null,
    HORIZON_PITCH[visionOf(coach).horizon],
    GROWTH_PITCH[growthStyleOf(coach)],
    coach.voice === 'spirit' ? '気持ちで負けたら終わりだ。最後まで全力でやる。' : null,
    coach.voice === 'talkative' ? 'とにかく見ていてほしい。面白い野球をやりますよ。' : null,
  ]
    .filter(Boolean)
    .join('');
}

/** 軸の選手を選ぶ主力の範囲（力の上位。野手はほぼスタメン、投手は先発と勝ちパターン） */
const KEY_POOL = { hitter: 9, pitcher: 6 };

/**
 * 軸の選手（キーマン。効果は無く説明だけ）。看板が攻めなら野手2人と投手1人、守りなら投手2人と
 * 野手1人。主力（力の上位 `KEY_POOL`）のうち、型に合う順に（同じなら力の順）。
 */
export function keyPlayers(coach, roster = []) {
  const byId = (a, b) => String(a.id).localeCompare(String(b.id));
  const pick = (group, n) =>
    roster
      .filter((p) => groupOf(p) === group)
      .map((p) => ({ p, power: overallScore(p), fit: fitOf(coach, p) }))
      .sort((a, b) => b.power - a.power || byId(a.p, b.p))
      .slice(0, KEY_POOL[group])
      .sort((a, b) => b.fit - a.fit || b.power - a.power || byId(a.p, b.p))
      .slice(0, n)
      .map((x) => x.p);
  return visionOf(coach).flagship === 'defense'
    ? [...pick('pitcher', 2), ...pick('hitter', 1)]
    : [...pick('hitter', 2), ...pick('pitcher', 1)];
}

/** 監督を解任されて、まだ反省を活かしていない（次に監督になるとき丸くなる） */
const regretPending = (coach) => (coach?.fired || 0) > (coach?.mellowed || 0);

/**
 * 解任された監督が、再び監督になるとき、こだわりが1段やわらぐ（「前回の反省」）。
 * 解任1回につき1度だけ。返り値は丸くなったか。
 * ⚠ 采配の強さは変わらない。こだわりが効くのはキャンプの段階を選手の希望に合わせるかと、
 * 時間軸が球団の状況に寄るまでの年数（`horizonPatience`）だけ。
 */
export function mellowOnReturn(coach, year) {
  if (!regretPending(coach)) return false;
  coach.mellowed = coach.fired;
  coach.mellowedAt = year;
  const stubborn = clampInt(coach.personality?.stubborn);
  if (stubborn > -2) coach.personality = { ...coach.personality, stubborn: stubborn - 1 };
  return true;
}

/** 性格の一言（「短気・頑固」）。標準の軸は出さない */
export function personalityText(coach) {
  const words = PERSONALITY_KEYS.filter((k) => k !== 'trust')
    .map((key) => {
      const v = clampInt(coach?.personality?.[key]);
      return v === 0 ? null : PERSONALITY[key][v < 0 ? 'low' : 'high'];
    })
    .filter(Boolean);
  const trust = clampInt(coach?.personality?.trust);
  if (trust <= -2) words.push('ワンマン');
  else if (trust >= 2) words.push('コーチに任せる');
  if (!words.length) words.push('穏やか');
  if (VOICES[coach?.voice]) words.push(VOICES[coach.voice]);
  return words.join('・');
}

/** 考え方の目盛り（数字ではなく「積極←→慎重」の位置。-2〜2） */
export function viewScale(coach) {
  return VIEW_KEYS.map((key) => {
    const value = viewOf(coach, key);
    const def = VIEWS[key];
    const word = value < 0 ? def.low : def.high;
    return {
      key,
      label: def.label,
      low: def.low,
      high: def.high,
      value,
      // ⚠ 片側だけの考え方（代打・守備固め）は -2〜0 の目盛り
      ...(def.oneSided ? { oneSided: true } : {}),
      text: value === 0 || (def.oneSided && value > 0) ? '標準' : `${Math.abs(value) === 1 ? 'やや' : ''}${word}`,
    };
  });
}

export function personalityScale(coach) {
  return PERSONALITY_KEYS.map((key) => {
    const value = clampInt(coach?.personality?.[key]);
    const def = PERSONALITY[key];
    return {
      key,
      label: def.label,
      low: def.low,
      high: def.high,
      value,
      text: value === 0 ? 'ふつう' : `${Math.abs(value) === 1 ? 'やや' : ''}${value < 0 ? def.low : def.high}`,
    };
  });
}

/**
 * 経歴の一言（「元投手・湘南サンズで8年」「元内野手」）。
 * ⚠ 球団名は**いまの名前で引き直す**（`labelOf` に内部名 `origin.team` を渡す）。保存している
 *    `origin.teamLabel` は指導者になった時点の名前なので、そのあと球団名を変えると
 *    「元投手（旧名で8年）」と古い名前が残っていた（2026-11-24 監査）。
 *    `labelOf` が無いときだけ保存した名前を使う
 */
export function originText(coach, labelOf = null) {
  const o = coach?.origin || {};
  const pos = POSITION_WORDS[o.position] || '選手';
  if (o.kind === 'player' && o.team)
    return `元${pos}（${teamNameOf(o, labelOf)}${o.seasons ? `で${o.seasons}年` : ''}）`;
  return `元${pos}`;
}
/**
 * 出身の球団の名前。いまの名前が引けるならそれ、引けない（リーグを抜けた・入れ替わった球団で
 * `labelOf` が内部名をそのまま返す）なら保存した当時の名前
 */
function teamNameOf(o, labelOf) {
  const now = labelOf ? labelOf(o.team) : null;
  if (now && now !== o.team) return now;
  return o.teamLabel || now || o.team;
}
const POSITION_WORDS = {
  pitcher: '投手',
  catcher: '捕手',
  infield: '内野手',
  outfield: '外野手',
};
export const positionGroup = (position) =>
  position === 'pitcher'
    ? 'pitcher'
    : position === 'catcher'
      ? 'catcher'
      : ['left', 'center', 'right'].includes(position)
        ? 'outfield'
        : 'infield';

// ------------------------------------------------------------
// 生成（乱数を引く。必ず種を決めた中で呼ぶこと）
// ------------------------------------------------------------

const rand = () => Math.random();
const pickWeighted = (table) => {
  const total = Object.values(table).reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (const [key, weight] of Object.entries(table)) {
    r -= weight;
    if (r < 0) return key;
  }
  return Object.keys(table).at(-1);
};
/** 平均0・幅 sd の揺らぎ（12個の一様乱数の和。種で決まる） */
const noise = (sd) => {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rand();
  return (s - 6) * sd;
};
const intPersonality = () => clampInt(noise(0.85));

const HORIZON_BUILD = { develop: -1.8, middle: 0, win: 1.8 };

/** ビジョンと性格から7つの考え方の向き（小数）を作る（型の `views`）。揺らぎは生成で足す */
function viewsFromVision(vision, personality = {}) {
  const v = visionOf({ vision });
  const out = Object.fromEntries(VIEW_KEYS.map((k) => [k, 0]));
  const add = (table, weight) => {
    for (const [k, x] of Object.entries(table || {})) out[k] += x * weight;
  };
  add(ATTACK_TYPES[v.attack].views, sideWeight({ vision: v }, 'attack'));
  add(DEFENSE_TYPES[v.defense].views, sideWeight({ vision: v }, 'defense'));
  out.build += HORIZON_BUILD[v.horizon];
  // 気質: 短気ほど継投が早く、代打・守備固めも早め（我慢強いと遅め）
  const t = clampInt(personality.temper);
  out.bullpen += 0.3 * t;
  out.bench += 0.3 * t - 0.3;
  return out;
}

/**
 * 引退した選手の現役時代の姿から、ビジョンの寄せ方を作る（`generateCoach` の `lean`）。
 * 俊足は機動力、長距離砲は長打、巧打者はつなぐ、守備の名手は打たせて守る。
 * 投手はスタミナがあれば先発で押す、球が速ければ継投でつなぐ、制球が良ければ打たせて守る。
 */
export function leanFromPlayer(player) {
  if (!player) return {};
  if (player.position === 'pitcher') {
    const p = player.pitching || {};
    const defense =
      (p.stamina || 100) >= 130 ? 'rotation' : (p.velocity || 140) >= 148 ? 'bullpen' : (p.control || 50) >= 65 ? 'fielding' : null;
    // ⚠ 目立つ能力が無ければ寄せない（看板は得意分野から決まる）
    return defense ? { defense, flagship: 'defense' } : {};
  }
  const speed = player.physical?.speed || 50;
  const power = player.batting?.power || 50;
  const meet = player.batting?.meet || 50;
  const eye = player.batting?.eye || 50;
  const attack =
    power >= 70 && power >= speed ? 'power' : speed >= 70 ? 'speed' : meet >= 70 && eye >= 60 ? 'contact' : null;
  const defense = (player.fielding?.defense || 50) >= 70 ? 'fielding' : null;
  return {
    ...(attack ? { attack } : {}),
    ...(defense ? { defense } : {}),
    ...(attack ? { flagship: 'attack' } : defense ? { flagship: 'defense' } : {}),
  };
}

/**
 * 指導者を1人作る。
 *
 * - `position` … 現役時代の守備の括り（pitcher / catcher / infield / outfield）。省けば乱数
 * - `specialty` … 得意分野（manager / pitching / batting）。省けば現役時代から決める
 * - `lean` … ビジョンの寄せ方 `{ attack, defense, flagship, horizon }`（引退選手のコーチ化で使う）
 * - `usedNames` … 既に使っている名前（同じ名前の指導者を作らない）
 *
 * ⚠ 乱数を引く順を変えると、同じ種でも顔ぶれが変わる（作り直しの再現は検査で見る）。
 */
function generateCoach({
  id,
  age,
  position,
  specialty,
  lean = {},
  personality: fixed,
  usedNames,
  origin = {},
}) {
  const pos =
    position ||
    pickWeighted({ pitcher: 40, catcher: 12, infield: 26, outfield: 22 });
  const spec =
    specialty ||
    pickWeighted(
      pos === 'pitcher'
        ? { pitching: 65, manager: 30, batting: 5 }
        : pos === 'catcher'
          ? { manager: 50, pitching: 30, batting: 20 }
          : { batting: 60, manager: 37, pitching: 3 },
    );
  const personality = {
    temper: fixed?.temper ?? intPersonality(),
    stubborn: fixed?.stubborn ?? intPersonality(),
    trust: fixed?.trust ?? intPersonality(),
  };
  // ビジョン。投手コーチ向きの人は守り、野手コーチ向きの人は攻めが看板になりやすい
  const attack = lean.attack || pickWeighted({ speed: 1, power: 1, contact: 1 });
  const defense = lean.defense || pickWeighted({ rotation: 1, bullpen: 1, fielding: 1 });
  const defenseFirst = spec === 'pitching' ? 0.75 : spec === 'batting' ? 0.25 : 0.5;
  const flagship = lean.flagship || (rand() < defenseFirst ? 'defense' : 'attack');
  const horizon = lean.horizon || pickWeighted({ develop: 30, middle: 40, win: 30 });
  const vision = { attack, defense, flagship, horizon };
  // 育成観（誰を尖らせるか × どこまで）
  const style = pickWeighted({ extreme: 15, staged: 40, shape: 30, complete: 15 });
  const line = style === 'staged' || style === 'shape' ? Number(pickWeighted({ 65: 1, 70: 2, 80: 1 })) : null;
  const growth = { who: style === 'shape' ? 'sharp' : style === 'complete' ? 'none' : 'all', line };
  const voice = pickWeighted({ talkative: 1, quiet: 1, logical: 1, spirit: 1 });
  // 考え方はビジョンから。揺らぎは小さく（筋の通らない人を作らない）
  const base = viewsFromVision(vision, personality);
  const views = {};
  for (const key of VIEW_KEYS) {
    const v = clampInt(base[key] + noise(0.45));
    views[key] = (VIEWS[key].oneSided ? Math.min(0, v) : v) || 0;
  }
  let name;
  for (let guard = 0; guard < 50; guard++) {
    name = `${getRandomSurname()} ${getRandomGivenName()}`;
    if (!usedNames?.has(name)) break;
  }
  usedNames?.add(name);
  return {
    id,
    name,
    age: age ?? 40 + Math.floor(rand() * 18),
    origin: { kind: 'new', ...origin, position: pos },
    specialty: spec,
    vision,
    growth,
    voice,
    views,
    personality,
    status: 'free',
    job: null,
    career: [],
  };
}

const VOICE_KEYS = Object.keys(VOICES);

/**
 * ビジョンを持たない古い形の指導者（版10・11。PR #22 で入った形）に、いまの形の項目を足す
 * （保存の移行 11 → 12 から呼ぶ）。返り値は足したか（2回目は何もしない）。
 *
 * ⚠ **足すだけ**。考え方（`views`）は変えないので、采配はこれまでと同じ。
 *    ビジョンは今の考え方・好み・得意分野から読み取る。古い項目（`prefs`・性格の
 *    `youth` / `boldness`）は残る（もう読まない）。語り口は種から決める（何度当てても同じ）。
 */
export function upgradeCoach(coach, seed) {
  if (!coach || coach.vision) return false;
  const v = coach.views || {};
  const p = coach.prefs || {};
  const old = coach.personality || {};
  // ⚠ **好み（prefs）を先に。ただし考え方（views）と逆を向く好みは使わない**。
  //    考え方は変えない（采配はそのまま）ので、逆を向く好みで型を決めると「つなぐ」の
  //    見出しで打撃「積極」、「打たせて守る」で投球「三振狙い」のように、カードの文と采配が食い違う
  const against = {
    speed: v.running <= -1,
    power: v.hitting <= -1,
    contact: v.hitting >= 1,
  };
  const attack =
    Object.hasOwn(ATTACK_TYPES, p.hitter) && !against[p.hitter]
      ? p.hitter
      : v.running >= 1 ? 'speed' : v.hitting >= 1 ? 'power' : 'contact';
  const defense =
    v.bullpen >= 1 ? 'bullpen'
      : v.bullpen <= -1 ? 'rotation'
        : v.pitching <= -1 || (p.pitcher === 'control' && !(v.pitching >= 1)) ? 'fielding'
          : p.pitcher === 'velocity' ? 'bullpen' : 'rotation';
  // 看板は得意分野から（采配が得意な人は、前の「戦い方」が守りなら守り）
  const flagship =
    coach.specialty === 'pitching' || (coach.specialty !== 'batting' && clampInt(old.boldness) <= -1)
      ? 'defense'
      : 'attack';
  // 時間軸は編成の考え方から（標準なら前の「起用」の若手好きで）
  const lean = clampInt(v.build) || -clampInt(old.youth);
  const horizon = lean <= -1 ? 'develop' : lean >= 1 ? 'win' : 'middle';
  coach.vision = { attack, defense, flagship, horizon };
  // 育成観は前の「キャンプの考え」から（長所を伸ばす → 徹底して尖らせる、選手に合わせる →
  // 選手の形に合わせる、全体・短所 → 穴のない選手に）
  coach.growth =
    p.camp === 'sharpen' ? { who: 'all', line: null }
      : p.camp === 'fit' ? { who: 'sharp', line: 70 }
        : { who: 'none', line: null };
  coach.voice = VOICE_KEYS[hashSeed(`${seed}:voice:${coach.id}`) % VOICE_KEYS.length];
  coach.personality = { ...old, stubborn: clampInt(old.stubborn) };
  return true;
}

// ------------------------------------------------------------
// 保存（`league.coaches`）の作り方
// ⚠ 保存の移行（`leagueMigration.js`）からも呼ぶので、サーバーの外（ここ）に置く
// ------------------------------------------------------------

/** 市場（どこにも属していない指導者）の人数の目安 */
export const MARKET_MIN = 8;

const usedNamesOf = (c) => new Set(Object.values(c.people).map((p) => p.name));

/** 指導者を1人作って名簿に入れる（市場に居る状態）。⚠ 種を決めた中で呼ぶ */
export function newCoach(c, options) {
  const id = `c${(c.seq = (c.seq || 0) + 1)}`;
  const coach = generateCoach({ ...options, id, usedNames: usedNamesOf(c) });
  c.people[id] = coach;
  return coach;
}

/** 球団の席に就ける（前の職は呼ぶ側で外しておく） */
export function assignCoach(c, teamName, role, coach, year) {
  c.teams[teamName] ||= { manager: null, pitching: null, batting: null };
  c.teams[teamName][role] = coach.id;
  if (role === 'manager') mellowOnReturn(coach, year);
  coach.status = 'active';
  coach.job = { team: teamName, role, since: year, misses: 0 };
  coach.freeSince = null;
}

/**
 * リーグの指導者を最初から作る（新しいリーグ・版10へ上げたリーグ）。
 * 全球団に3人、市場に8人。球団の期待（ambition）と我慢強さ（patience）もここで決める。
 *
 * ⚠ **種はリーグの種から**。同じリーグなら何度作っても同じ顔ぶれになる
 *    （移行をやり直しても結果が変わらない）。
 */
export function createCoaches(league) {
  const year = league.season?.year || 1;
  const names =
    league.season?.settings?.teamNames || (league.teams || []).map((t) => t.name);
  const c = { seq: 0, people: {}, teams: {}, fronts: {}, events: [] };
  withSeededRandom(hashSeed(`${league.seed}:coaches:init`), () => {
    for (const name of names) {
      const r = Math.random();
      const p = Math.random();
      c.fronts[name] = {
        ambition: r < 0.3 ? 'high' : r < 0.8 ? 'mid' : 'low',
        patience: p < 0.15 ? 1 : p < 0.65 ? 2 : 3,
      };
      c.teams[name] = { manager: null, pitching: null, batting: null };
      const manager = newCoach(c, {
        specialty: 'manager',
        age: 45 + Math.floor(Math.random() * 18),
      });
      assignCoach(c, name, 'manager', manager, year);
      const pitching = newCoach(c, {
        position: Math.random() < 0.85 ? 'pitcher' : 'catcher',
        specialty: 'pitching',
        age: 36 + Math.floor(Math.random() * 20),
      });
      assignCoach(c, name, 'pitching', pitching, year);
      const batting = newCoach(c, {
        position: Math.random() < 0.5 ? 'infield' : 'outfield',
        specialty: 'batting',
        age: 36 + Math.floor(Math.random() * 20),
      });
      assignCoach(c, name, 'batting', batting, year);
    }
    for (let i = 0; i < MARKET_MIN; i++) {
      const coach = newCoach(c, {});
      coach.freeSince = year;
    }
  });
  return c;
}

// ------------------------------------------------------------
// 指導者の詳細能力（先方要望 2026-11-20「指導者にも詳細能力を」）
//
// ⚠ **表示と人物像のためだけ**。采配・育成・キャンプ・トレード・試合のどこにも効かない
//    （いしだ方針「監督に能力バフは無し・型で強さを変えない」）。画面にもそう書く。
// ⚠ **保存しない**。指導者の id（種）・現役時代・得意分野・ビジョン・性格・通算の年数から毎回同じ値を作る
//    （乱数を引かない。何度見ても同じ。保存の形も版も変えない）。
//    経験を積むと少しずつ上がる（通算の年数）。名選手は現役の受け持ちの分野が高い。
// ⚠ 値は 0〜100（選手の能力と同じ目盛り。画面は選手と同じ段位 S〜F で出す）。
// ------------------------------------------------------------
export const COACH_ABILITY_ITEMS = [
  { key: 'tactics', label: '采配', note: '試合の流れを読む力' },
  { key: 'pitchingCoach', label: '投手指導', note: '投手を見る・教える力' },
  { key: 'battingCoach', label: '打撃指導', note: '打者を見る・教える力' },
  { key: 'fieldingCoach', label: '守備走塁指導', note: '守備と走塁を教える力' },
  { key: 'development', label: '育成', note: '若手を伸ばす根気' },
  { key: 'leadership', label: '統率', note: 'チームをまとめる力' },
  { key: 'rapport', label: '人望', note: '選手やコーチに慕われる度合い' },
  { key: 'eye', label: '眼力', note: '選手の素質を見抜く目' },
];

/** 0〜1 の決まった値（id と項目ごと）。⚠ FNV-1a は似た文字列で似た値になるのでかき混ぜる */
function abilityUnit(id, key) {
  let h = hashSeed(`${id}:coach-ability:${key}`);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * 指導者の詳細能力（0〜100 の整数）。`COACH_ABILITY_ITEMS` の並び。
 * 土台 40〜64（id から）＋ 得意分野・現役の守備位置・ビジョン・性格の寄せ ＋ 経験（通算の年数）。
 */
export function coachAbilities(coach) {
  if (!coach) return null;
  const id = coach.id || coach.name || '';
  const spec = coach.specialty;
  const pos = coach.origin?.position;
  const legend = !!coach.origin?.legend;
  const v = visionOf(coach);
  const p = coach.personality || {};
  const rows = coach.career || [];
  const years = (role) => rows.filter((r) => !role || r.role === role).length;
  const exp = (n, per = 1.5, cap = 12) => Math.min(cap, n * per);
  const base = (key) => 40 + Math.floor(abilityUnit(id, key) * 25);
  const raw = {
    tactics:
      base('tactics') + (spec === 'manager' ? 10 : 0) + (pos === 'catcher' ? 4 : 0) + exp(years('manager'), 2, 16),
    pitchingCoach:
      base('pitchingCoach') +
      (spec === 'pitching' ? 12 : 0) +
      (pos === 'pitcher' ? 6 : pos === 'catcher' ? 4 : 0) +
      (legend && pos === 'pitcher' ? 6 : 0) +
      exp(years('pitching')),
    battingCoach:
      base('battingCoach') +
      (spec === 'batting' ? 12 : 0) +
      (pos && pos !== 'pitcher' ? 5 : 0) +
      (legend && pos !== 'pitcher' ? 6 : 0) +
      exp(years('batting')),
    fieldingCoach:
      base('fieldingCoach') +
      (pos === 'infield' || pos === 'catcher' ? 7 : pos === 'outfield' ? 4 : 0) +
      (v.defense === 'fielding' ? 7 : 0) +
      (v.attack === 'speed' ? 5 : 0) +
      exp(years('batting'), 0.8, 6),
    development:
      base('development') + (v.horizon === 'develop' ? 12 : v.horizon === 'win' ? -6 : 0) - clampInt(p.temper) * 3 + exp(years(), 0.6, 6),
    leadership: base('leadership') + clampInt(p.stubborn) * 3 + (legend ? 8 : 0) + exp(years('manager'), 1.5, 10),
    rapport: base('rapport') + clampInt(p.trust) * 4 - clampInt(p.temper) * 3 + (legend ? 6 : 0) - clampInt(p.stubborn) * 2,
    eye: base('eye') + (spec === 'manager' ? 4 : 0) + (coach.voice === 'logical' ? 6 : 0) + exp(years(), 0.8, 10),
  };
  return Object.fromEntries(
    COACH_ABILITY_ITEMS.map(({ key }) => [key, Math.max(1, Math.min(99, Math.round(raw[key])))]),
  );
}
