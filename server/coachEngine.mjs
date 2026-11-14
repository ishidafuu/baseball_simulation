// ============================================================
// 指導者（監督・コーチ）のリーグ側の処理: 配属・その日の采配・年度更新の入れ替わり。
//
// 考え方の計算そのものは `src/online/coaches.js`（純粋な関数）。ここはリーグの保存
// （`league.coaches`）を読み書きする。
//
// 保存の形（版10で足した。`leagueMigration.js`）:
//   league.coaches = {
//     seq,                       // 次の id の番号
//     people: { [id]: Coach },   // 現役・浪人・引退（記録の残る人）
//     teams:  { [球団]: { manager, pitching, batting } },  // id か null
//     fronts: { [球団]: { ambition, patience } },          // 球団の期待と我慢強さ（固定）
//     events: [ ... ],           // 就任・解任・勇退などの出来事（新しい順、40件）
//   }
//   member.staffModes = { lineup, pitching, tactics, tryout, release, camp }（人の任せ方）
//
// ⚠ **乱数は必ず種を決めて引く**（`withSeededRandom`）。同じリーグを同じ手順で
//    進めたら同じ人事になる。
// ⚠ 入れ替わりは**年度更新とキャンプのときだけ**（いしだ指定）。シーズン中は動かない。
// ============================================================
import { hashSeed, withSeededRandom } from '../src/game/rng.js';
import {
  COACH_ROLES,
  createCoaches,
  MARKET_MIN,
  newCoach,
  assignCoach as assign,
  leanFromPlayer,
  positionGroup,
  staffTactics,
  staffModesOf,
  STAFF_MODES,
  STAFF_AREAS,
  STAFF_AREA_KEYS,
  PHASE_STAFF_AREA,
  tryoutContext,
  releaseBias,
  tradeFactor,
  campPlan,
  VIEWS,
  delegationOf,
} from '../src/online/coaches.js';
import { PYRAMID_LEAGUES } from '../src/online/pyramidLeague.js';
import { requireOnline } from '../src/online/shared.js';

const KEEP_EVENTS = 40;
/** 市場の人数の上限（多すぎれば年長から引退）。下限は `coaches.js` の `MARKET_MIN` */
const MARKET_MAX = 16;

export const AMBITION_LABELS = {
  high: '優勝・昇格を狙う',
  mid: '上位を目指す',
  low: '残留できればよい',
};
export const PATIENCE_LABELS = { 1: '短気（1年）', 2: 'ふつう（2年）', 3: '我慢強い（3年）' };
/**
 * 期待の順位（部の中で何位以内なら合格か）。部ごと・期待ごと。
 * ⚠ 1部の最下位は降格、2部の首位は昇格（`pyramidLeague.js`）。
 */
const TARGET_RANK = {
  0: { high: 2, mid: 4, low: 5 },
  1: { high: 2, mid: 3, low: 5 },
};

const seededIn = (league, tag, fn) =>
  withSeededRandom(hashSeed(`${league.seed}:coaches:${tag}`), fn);

/**
 * 監督とコーチの考えの食い違いが、辞任につながる大きさ。
 * ⚠ 考え方はビジョンから決まるので、受け持ちの型が違うと差がはっきり出る。
 *    最初の顔ぶれ（種300通り）で、辞任の線を越える組は約3%、話題の線は約12%に合わせてある
 */
export const RESIGN_CONFLICT = 3.5;
/** 食い違いが紙面の話題になる大きさ（辞任ほどではない） */
export const RIFT_CONFLICT = 2.5;
export const CONFLICT_AREAS = { pitching: '継投・投球', batting: '打撃・走塁' };

/**
 * 監督とコーチの考えの食い違い（コーチの受け持ちの考え方の差 × 監督がどれだけ任せないか）。
 * 強さには効かない。年度更新の辞任と、紙面の「意見が割れる」にだけ使う
 */
export function conflictOf(manager, coach, role) {
  if (!manager || !coach) return 0;
  let gap = 0;
  for (const [key, def] of Object.entries(VIEWS))
    if (def.domain === role)
      gap += Math.abs((manager.views?.[key] || 0) - (coach.views?.[key] || 0));
  return gap * (1 - delegationOf(manager));
}

/** 監督を解任した印（再び監督になるとき丸くなる `mellowOnReturn`。称号「苦労人」） */
function markFired(coach) {
  coach.fired = (coach.fired || 0) + 1;
}

/**
 * このキャンプでこの球団の監督の席から外した人を、同じ席に呼び戻すところか。
 * 前からの監督を外したとき（解任に数えたとき）だけ真。今年就けた人を外したのは
 * もともと数えていない（取り消し）。出来事は新しい順（`logEvent`）
 */
function undoesFiring(c, coach, team, year) {
  const mine = (c.events || []).filter((e) => e.coachId === coach.id && e.year === year);
  const last = mine[0];
  if (last?.kind !== 'release' || last.team !== team || last.role !== 'manager') return false;
  // 今年この球団で就いた（呼んだ・昇格した）記録があれば、外したのは取り消しで数えていない
  return !mine.some((e) => e.team === team && (e.kind === 'hire' || e.kind === 'promote'));
}

/** 呼び戻した監督の在任の始まり（通算の行で、去年までこの席に続けて居た最初の年） */
function tenureStart(coach, team, role, year) {
  let since = year;
  const rows = coach.career || [];
  while (rows.some((r) => r.year === since - 1 && r.team === team && r.role === role)) since -= 1;
  return since;
}

/** 席から外して市場へ（`status: 'free'`）。⚠ 引退させるときは呼んだあと status を変える */
function unassign(c, coach, year) {
  if (!coach?.job) return;
  const seats = c.teams[coach.job.team];
  if (seats && seats[coach.job.role] === coach.id) seats[coach.job.role] = null;
  coach.job = null;
  coach.status = 'free';
  coach.freeSince = year;
}

/**
 * 就任・昇格の出来事。紙面の「師弟」「古巣へ」もここで書き留める
 * （就任のときの関係。あとで監督が替わっても記事は変わらない）
 */
function hireEvent(c, { year, kind = 'hire', team, role, coach }) {
  const head = c.people[c.teams[team]?.manager];
  return {
    year,
    kind,
    team,
    role,
    coachId: coach.id,
    name: coach.name,
    from: coach.origin?.kind === 'player' ? 'player' : null,
    // 恩師（現役時代の監督）の下でコーチになる
    ...(role !== 'manager' && head && coach.mentor === head.id ? { mentor: head.name } : {}),
    // 現役時代の球団に戻る
    ...(coach.origin?.kind === 'player' && coach.origin.team === team ? { homecoming: true } : {}),
  };
}

function logEvent(c, event) {
  c.events = [event, ...(c.events || [])].slice(0, KEEP_EVENTS);
}

/**
 * 指導者が居なければ作る（新しいリーグ・版10へ上げたリーグ）。
 * ⚠ 作り方は `coaches.js` の `createCoaches`（保存の移行からも呼ぶので、そちらに置いてある）
 */
export function ensureCoaches(league) {
  if (league.coaches?.people) return league.coaches;
  return (league.coaches = createCoaches(league));
}

/** 球団の3人（居なければ null） */
export function staffOf(league, teamName) {
  const c = league.coaches;
  const seats = c?.teams?.[teamName];
  const get = (id) => (id ? c.people[id] || null : null);
  return {
    manager: get(seats?.manager),
    pitching: get(seats?.pitching),
    batting: get(seats?.batting),
  };
}

const memberOf = (league, teamName) =>
  (league.members || []).find((m) => m.teamName === teamName) || null;

/**
 * 人の球団の、実際に効く任せ方。**受け持ちの席が空いている分野は「自分で」**（いしだ指定）。
 * スタメンと打順は野手コーチ、投手起用は投手コーチ、トライアウトと退団は監督が受け持つ。
 * 試合中の采配とキャンプは項目・選手ごとに受け持ちが違うので、ここでは落とさない
 * （空いた席の項目だけ保存した設定のまま。`blendView` / `campPlan` の `strictSeats`）。
 */
export function effectiveStaffModes(league, member) {
  const modes = staffModesOf(member);
  if (!league.coaches) return Object.fromEntries(STAFF_AREA_KEYS.map((k) => [k, 'self']));
  // ⚠ **おるすばん中は全部の分野を任せた扱い**（しばらく来ていない人。`social.mjs` の `markAway`）。
  //    本人の設定（`member.staffModes`）は書き換えないので、来れば元に戻る。席が空いた分野は下で「自分で」
  if (member.away) for (const area of STAFF_AREA_KEYS) modes[area] = 'delegate';
  for (const area of STAFF_AREA_KEYS) if (seatEmpty(league, member.teamName, area)) modes[area] = 'self';
  return modes;
}

/**
 * いまの手続き（トライアウト・契約更改の退団・キャンプ）を、その人が指導者に任せているか。
 * ⚠ **任せた手続きはその人の決定を待たない**（`leagueEngine` の `waitsFor`）。提出があっても
 *    指導者の案で決めるので（`resolvePhase`）、待つ意味が無い。画面の「指導者に任せています」もこれ
 */
export function phaseDelegated(league, member) {
  const area = PHASE_STAFF_AREA[league.phase?.kind];
  return !!area && !!member && effectiveStaffModes(league, member)[area] === 'delegate';
}

/**
 * その分野を受け持つ席が空いているか（空いていれば「自分で」しか選べない）。
 * 受け持ちが決まっている分野はその席、采配とキャンプは3人とも居ないとき
 */
export function seatEmpty(league, teamName, area) {
  const staff = staffOf(league, teamName);
  const owner = STAFF_AREAS[area]?.owner;
  return owner ? !staff[owner] : !staff.manager && !staff.pitching && !staff.batting;
}

/** その球団の分野の任せ方。CPUはいつも「任せる」 */
export function areaMode(league, teamName, area) {
  const member = memberOf(league, teamName);
  return member ? effectiveStaffModes(league, member)[area] : 'delegate';
}

/**
 * その日の采配（試合で使う写し）。画面の「AI判断 → 積極的（山田監督）」もここから。
 * ⚠ `team` は世界の球団（保存した設定 `onlineTactics` / `strategy` を持つ）
 */
export function teamTacticsFor(league, teamName, team) {
  const member = memberOf(league, teamName);
  return staffTactics({
    staff: staffOf(league, teamName),
    human: !!member,
    mode: member ? effectiveStaffModes(league, member).tactics : 'delegate',
    tactics: team?.onlineTactics || {},
    strategy: team?.strategy || {},
  });
}

/**
 * 試合の日だけ、指導者の采配を球団に当てる。返す関数で元に戻す。
 * ⚠ **保存した設定は書き換えない**。試合の後に必ず戻す（`advanceOneDay` の finally）。
 */
export function applyStaffTactics(league, teamName, team) {
  if (!team || !league.coaches) return () => {};
  // ⚠ 「自分で」の人の球団は何も触らない（指導者を入れる前とまったく同じ試合にする）
  const member = memberOf(league, teamName);
  if (member && effectiveStaffModes(league, member).tactics === 'self') return () => {};
  const had = { tactics: Object.hasOwn(team, 'onlineTactics'), strategy: Object.hasOwn(team, 'strategy') };
  const saved = { tactics: team.onlineTactics, strategy: team.strategy };
  const { tactics, strategy } = teamTacticsFor(league, teamName, team);
  team.onlineTactics = tactics;
  team.strategy = strategy;
  return () => {
    if (had.tactics) team.onlineTactics = saved.tactics;
    else delete team.onlineTactics;
    if (had.strategy) team.strategy = saved.strategy;
    else delete team.strategy;
  };
}

/**
 * 終わったばかりの年の勝率。無ければ前年の記録、それも無ければ .500。
 * ⚠ **今季の順位表を先に読む**。トライアウト（11/10）は年度更新（11/30）より前で、
 *    その時点の `history.at(-1)` は1年前の年。先に読むと、今季最下位の球団が
 *    前年の好成績で「勝負」の選び方をしてしまう。年度更新の後（今季の試合が0）は前年の記録
 */
function lastWinRate(league, teamName) {
  const rate = (row) =>
    row && row.wins + row.losses > 0 ? row.wins / (row.wins + row.losses) : null;
  return (
    rate(league.season?.standings?.find((s) => s.team === teamName)) ??
    rate(league.history?.at(-1)?.standings?.find((s) => s.team === teamName)) ??
    0.5
  );
}

/**
 * トライアウトの選び方（`selectPlayerForAI` の `teamContext`）。
 * 人の球団で「自分で」なら null（指導者を入れる前と同じ選び方）。
 */
export function tryoutContextFor(league, teamName) {
  if (!league.coaches) return null;
  if (areaMode(league, teamName, 'tryout') === 'self') return null;
  return tryoutContext(staffOf(league, teamName), {
    lastWinRate: lastWinRate(league, teamName),
  });
}

/** 退団の選び方の偏り。人の球団で「自分で」なら null */
export function releaseBiasFor(league, teamName) {
  if (!league.coaches) return null;
  if (areaMode(league, teamName, 'release') === 'self') return null;
  return releaseBias(staffOf(league, teamName));
}

/** CPU球団がトレードで選手を見る目（`tradeJudge.mjs` の値段にかける倍率） */
export function tradeFactorFor(league, teamName) {
  const staff = staffOf(league, teamName);
  return (player) => tradeFactor(staff, player);
}

/**
 * キャンプの指示（`runCampRound` に渡す形）。人の球団で「自分で」なら null。
 * 選手ごとの方針はコーチの育成観と時間軸から（`coaches.js` の `growthPolicy`）。
 */
export function campPlanFor(league, teamName, roster) {
  if (!league.coaches) return null;
  const member = memberOf(league, teamName);
  if (member && effectiveStaffModes(league, member).camp === 'self') return null;
  return campPlan(staffOf(league, teamName), roster, { strictSeats: !!member });
}

/** 人の任せ方を保存する */
export function setStaffModes(league, userId, modes) {
  const member = (league.members || []).find((m) => m.userId === userId);
  requireOnline(member, '参加者ではありません', 403);
  requireOnline(
    modes && typeof modes === 'object' && !Array.isArray(modes),
    '任せ方の指定が不正です',
  );
  const next = { ...staffModesOf(member) };
  for (const [area, mode] of Object.entries(modes)) {
    requireOnline(STAFF_AREA_KEYS.includes(area), '未対応の分野です');
    requireOnline(Object.hasOwn(STAFF_MODES, mode), '任せ方の値が不正です');
    next[area] = mode;
  }
  member.staffModes = next;
}

// ------------------------------------------------------------
// 人の球団の人事（キャンプの手続きの間だけ）
// ------------------------------------------------------------

/**
 * 人の球団の指導者を動かす。`action`:
 *   - `release` … その席の人を解任（市場へ）
 *   - `hire`    … 市場の人を空いた席に呼ぶ（`coachId`）
 *   - `swap`    … 2つの席を入れ替える（`role` と `other`。コーチを監督にする、など）
 *
 * ⚠ **キャンプの手続きの間だけ**（いしだ指定: 入れ替えは年度更新のときだけ。年度更新は
 *    自動で決める場が無いので、すぐ後のキャンプで選び直す）。
 * ⚠ 市場の人は早い者勝ち。CPU球団はキャンプの終わり（締め切り）に空席を埋める。
 */
export function staffCommand(league, userId, payload) {
  const member = (league.members || []).find((m) => m.userId === userId);
  requireOnline(member, '参加者ではありません', 403);
  requireOnline(
    league.phase?.kind === 'camp',
    '指導者を替えられるのはキャンプの間だけです',
    409,
  );
  const c = ensureCoaches(league);
  const team = member.teamName;
  const year = league.season.year;
  c.teams[team] ||= { manager: null, pitching: null, batting: null };
  const seats = c.teams[team];
  const { action, role, other, coachId } = payload || {};
  requireOnline(COACH_ROLES.includes(role), '役職の指定が不正です');
  if (action === 'release') {
    const coach = c.people[seats[role]];
    requireOnline(coach, 'その席は空いています', 409);
    // ⚠ その年に就けた人を外すのは取り消し（解任に数えない）
    if (role === 'manager' && coach.job.since < year) markFired(coach);
    unassign(c, coach, year);
    logEvent(c, { year, kind: 'release', team, role, coachId: coach.id, name: coach.name });
    return { status: 'released' };
  }
  if (action === 'hire') {
    requireOnline(!seats[role], '先にその席の人を解任してください', 409);
    const coach = c.people[coachId];
    requireOnline(coach && coach.status === 'free', 'その人はもう市場にいません', 409);
    // ⚠ **同じキャンプで外した監督を同じ席に呼び戻すのは取り消し**。解任を数え直さないと
    //    「解任1回」と「反省して丸くなる」が両方付き、繰り返すと称号「苦労人」まで付く
    const undo = role === 'manager' && undoesFiring(c, coach, team, year);
    if (undo) coach.fired = Math.max(0, (coach.fired || 0) - 1);
    assign(c, team, role, coach, year);
    // 在任も外す前の続きに戻す（「在任N年」が1年目に戻らない）
    if (undo) coach.job.since = tenureStart(coach, team, role, year);
    logEvent(c, hireEvent(c, { year, team, role, coach }));
    return { status: 'hired' };
  }
  if (action === 'swap') {
    requireOnline(COACH_ROLES.includes(other) && other !== role, '入れ替える役職の指定が不正です');
    const a = seats[role];
    const b = seats[other];
    requireOnline(a || b, '入れ替える人がいません', 409);
    seats[role] = null;
    seats[other] = null;
    // 席に就け直す（在任は今年から。監督になる人は `assign` の中で丸くなる）
    for (const [id, r] of [[a, other], [b, role]])
      if (id) {
        const coach = c.people[id];
        assign(c, team, r, coach, year);
        if (r === 'manager') logEvent(c, hireEvent(c, { year, kind: 'promote', team, role: r, coach }));
      }
    return { status: 'swapped' };
  }
  requireOnline(false, '指導者の操作が不正です');
}

// ------------------------------------------------------------
// 年度更新
// ------------------------------------------------------------

/**
 * 終わった年の球団の成績（指導者の通算に残す）。**年度更新の前**（日程が残っている間）に呼ぶ。
 * 得点・失点は日程の結果から、打率・防御率・本塁打・盗塁・奪三振は試合の記録から。
 */
export function coachSeasonRows(league) {
  const year = league.season.year;
  const names = league.season.settings.teamNames || [];
  const totals = Object.fromEntries(
    names.map((n) => [n, { runs: 0, allowed: 0, hits: 0, atBats: 0, homeruns: 0, stolenBases: 0, earnedRuns: 0, outs: 0, strikeouts: 0, walks: 0, recorded: false }]),
  );
  for (const g of league.season.schedule || []) {
    if (g.phase !== 'regular_season' || !g.result) continue;
    if (totals[g.home]) {
      totals[g.home].runs += g.result.homeScore || 0;
      totals[g.home].allowed += g.result.awayScore || 0;
    }
    if (totals[g.away]) {
      totals[g.away].runs += g.result.awayScore || 0;
      totals[g.away].allowed += g.result.homeScore || 0;
    }
  }
  const season = league.records?.seasons?.[year];
  for (const game of Object.values(season?.games || {}))
    for (const name of [game.home, game.away]) {
      const t = totals[name];
      if (!t || !Array.isArray(game.teams?.[name])) continue;
      t.recorded = true;
      for (const row of game.teams[name]) {
        t.hits += row.batting?.hits || 0;
        t.atBats += row.batting?.atBats || 0;
        t.homeruns += row.batting?.homeruns || 0;
        t.stolenBases += row.batting?.stolenBases || 0;
        t.earnedRuns += row.pitching?.earnedRuns || 0;
        t.outs += row.pitching?.inningsPitched || 0;
        t.strikeouts += row.pitching?.strikeouts || 0;
        t.walks += row.pitching?.walks || 0;
      }
    }
  const out = {};
  for (const name of names) {
    const t = totals[name];
    out[name] = {
      runs: t.runs,
      allowed: t.allowed,
      ...(t.recorded
        ? {
            average: t.atBats ? Math.round((t.hits / t.atBats) * 1000) / 1000 : null,
            era: t.outs ? Math.round(((t.earnedRuns * 27) / t.outs) * 100) / 100 : null,
            homeruns: t.homeruns,
            stolenBases: t.stolenBases,
            strikeouts: t.strikeouts,
            walks: t.walks,
          }
        : {}),
    };
  }
  return out;
}

/** 部で1位を数える成績（称号に使う。盗塁・本塁打・得点は多いほど、防御率は低いほど） */
const LEAD_STATS = { stolenBases: 1, homeruns: 1, runs: 1, era: -1 };

/** 部ごとの1位の数字。⚠ 指導者の席が空いていた球団も比べる（全球団の成績 `rows` から） */
function leadersOf(entry, rows) {
  const best = {};
  for (const [team, row] of Object.entries(rows)) {
    const leagueId = entry?.leagues?.[team];
    if (!leagueId) continue;
    const b = (best[leagueId] ||= {});
    for (const [stat, sign] of Object.entries(LEAD_STATS))
      if (row[stat] != null && (b[stat] == null || (row[stat] - b[stat]) * sign > 0)) b[stat] = row[stat];
  }
  return best;
}

/** 部の中の順位（1始まり）と部の段（0=1部） */
function placeOf(entry, teamName) {
  const leagueId = entry?.leagues?.[teamName];
  if (!leagueId) return null;
  const table = (entry.standings || []).filter((s) => entry.leagues[s.team] === leagueId);
  const rank = table.findIndex((s) => s.team === teamName) + 1;
  const tier = PYRAMID_LEAGUES.find((l) => l.id === leagueId)?.tier ?? 0;
  return rank > 0 ? { rank, size: table.length, tier, leagueId } : null;
}

/**
 * 年度更新での指導者の処理。**昇降格を当てたあと**に呼ぶ（`league.history` の最後が終わった年）。
 *
 * 1. 終わった年の成績を各人の通算に残す
 * 2. 年を取る。高齢なら勇退
 * 3. CPU球団の監督の進退（期待と我慢強さ）。コーチは監督と考えが合わないと辞めることがある
 * 4. 引退した選手のうち、指導者の道に進む人を市場へ（`secondCareer` が監督・コーチの人）
 * 5. 市場の人数を整える（少なければ新しく作り、多すぎれば年長から引退）
 *
 * 空いた席は**キャンプの終わり**に埋める（`fillVacancies`）。人の球団が先に市場から選べるように。
 *
 * `rows`: `coachSeasonRows`（年度更新の前に取ったもの）
 * `retirees`: 引退した選手 [{ team, name, position, seasons, line, secondCareer, player }]
 */
export function coachOffseason(league, { rows = {}, retirees = [] } = {}) {
  const c = ensureCoaches(league);
  const entry = league.history?.at(-1);
  const year = entry?.year ?? league.season.year - 1;
  const nextYear = league.season.year;
  const teamLabel = (name) =>
    (league.teams || []).find((t) => t.name === name)?.displayName || name;
  const events = [];
  // 終わった年の監督（引退した選手の恩師）。⚠ 勇退・解任で席が空く前に控える
  const managers = Object.fromEntries(
    Object.entries(c.teams).map(([team, seats]) => [team, seats.manager]),
  );
  const leaders = leadersOf(entry, rows);
  seededIn(league, `offseason:${year}`, () => {
    // 1) 成績を残す（部で1位だった成績は `leads` に。称号に使う）
    for (const [team, seats] of Object.entries(c.teams)) {
      const place = placeOf(entry, team);
      const row = entry?.standings?.find((s) => s.team === team);
      const move = (entry?.moves || []).find((m) => m.teamId === team);
      const stats = rows[team] || {};
      const leads = Object.keys(LEAD_STATS).filter(
        (stat) => stats[stat] != null && stats[stat] === leaders[place?.leagueId]?.[stat],
      );
      for (const role of COACH_ROLES) {
        const coach = c.people[seats[role]];
        if (!coach) continue;
        coach.career = [
          ...(coach.career || []),
          {
            year,
            team,
            role,
            league: place?.leagueId || null,
            rank: place?.rank ?? null,
            wins: row?.wins ?? 0,
            losses: row?.losses ?? 0,
            draws: row?.draws ?? 0,
            champion: entry?.playoffChampion === team,
            move: move
              ? (PYRAMID_LEAGUES.find((l) => l.id === move.to)?.tier ?? 0) <
                (PYRAMID_LEAGUES.find((l) => l.id === move.from)?.tier ?? 0)
                ? 'up'
                : 'down'
              : null,
            ...stats,
            ...(leads.length ? { leads } : {}),
          },
        ];
      }
    }
    // 2) 年を取り、高齢なら勇退
    for (const coach of Object.values(c.people)) {
      if (coach.status === 'retired') continue;
      coach.age += 1;
      const p = coach.age >= 74 ? 1 : coach.age >= 70 ? 0.35 : coach.age >= 66 ? 0.12 : 0;
      const longFree = coach.status === 'free' && coach.freeSince != null && nextYear - coach.freeSince >= 4;
      if (Math.random() < p || longFree) {
        const job = coach.job;
        if (job) {
          unassign(c, coach, nextYear);
          events.push({ year: nextYear, kind: 'retire', team: job.team, role: job.role, coachId: coach.id, name: coach.name, age: coach.age });
        }
        coach.status = 'retired';
        coach.freeSince = null;
      }
    }
    // 3) 進退（CPU球団の監督）と、考えの合わないコーチの辞任
    for (const [team, seats] of Object.entries(c.teams)) {
      const human = !!memberOf(league, team);
      const manager = c.people[seats.manager];
      if (manager && !human) {
        const place = placeOf(entry, team);
        const front = c.fronts[team] || { ambition: 'mid', patience: 2 };
        if (place) {
          const target = TARGET_RANK[place.tier]?.[front.ambition] ?? 4;
          const worst = place.rank === place.size;
          const ok = place.rank <= target || entry?.playoffChampion === team;
          manager.job.misses = ok ? 0 : (manager.job.misses || 0) + (worst ? 2 : 1);
          // ⚠ 就任1年目では解任しない（その年が就任の年なら見送る）
          if (manager.job.since < year && manager.job.misses >= front.patience) {
            markFired(manager);
            unassign(c, manager, nextYear);
            events.push({
              year: nextYear,
              kind: 'fire',
              team,
              role: 'manager',
              coachId: manager.id,
              name: manager.name,
              reason: worst ? `${place.tier === 0 ? '1部' : '2部'}最下位` : `期待の${target}位以内に届かず`,
            });
          }
        }
      }
      const head = c.people[seats.manager];
      for (const role of ['pitching', 'batting']) {
        const coach = c.people[seats[role]];
        if (!coach) continue;
        const conflict = conflictOf(head, coach, role);
        const leave = conflict >= RESIGN_CONFLICT ? 0.4 : human ? 0 : 0.06;
        if (Math.random() < leave) {
          unassign(c, coach, nextYear);
          events.push({
            year: nextYear,
            kind: 'resign',
            team,
            role,
            coachId: coach.id,
            name: coach.name,
            reason: conflict >= RESIGN_CONFLICT && head ? `${head.name}監督と${CONFLICT_AREAS[role]}の考えが合わず` : null,
          });
        }
      }
    }
    // 4) 引退した選手が指導者の道へ
    for (const r of retirees) {
      const role = r.secondCareer?.role;
      if (role !== 'manager' && role !== 'coach') continue;
      const group = positionGroup(r.position);
      const coach = newCoach(c, {
        age: (r.age || 35) + 1,
        position: group,
        specialty: role === 'manager' ? 'manager' : group === 'pitcher' ? 'pitching' : group === 'catcher' ? 'manager' : 'batting',
        lean: leanFromPlayer(r.player),
        origin: {
          kind: 'player',
          team: r.team,
          teamLabel: teamLabel(r.team),
          seasons: r.seasons || 0,
          line: r.line || null,
          playerName: r.name,
          legend: role === 'manager',
        },
      });
      coach.name = r.name;
      coach.freeSince = nextYear;
      // 現役時代の監督（恩師）
      if (managers[r.team]) coach.mentor = managers[r.team];
      events.push({ year: nextYear, kind: 'turn', team: r.team, role: null, coachId: coach.id, name: coach.name });
    }
    // 5) 市場の人数を整える
    const free = () => Object.values(c.people).filter((p) => p.status === 'free');
    while (free().length < MARKET_MIN) {
      const coach = newCoach(c, {});
      coach.freeSince = nextYear;
    }
    const extra = free().sort((a, b) => b.age - a.age).slice(0, Math.max(0, free().length - MARKET_MAX));
    for (const coach of extra) coach.status = 'retired';
  });
  // 記録の無い引退者は残さない（保存を太らせない）
  for (const [id, coach] of Object.entries(c.people))
    if (coach.status === 'retired' && !coach.career?.length) delete c.people[id];
  for (const event of events.reverse()) logEvent(c, event);
  return events;
}

/**
 * 空いた席を埋める（CPU球団だけ）。**キャンプの終わり**に呼ぶ。
 *
 * - 監督が空席なら、半分の確率で自分の球団のコーチを上げる（内部昇格）。でなければ市場から
 * - コーチが空席なら市場から（まれに空席のまま1年過ごす球団もある）
 * - 市場から選ぶときは、得意分野が合う人・監督と考えの合うコーチ・古巣の人を好む
 * ⚠ 弱い球団（前年の順位が低い）から先に選ぶ
 */
export function fillVacancies(league) {
  const c = ensureCoaches(league);
  const year = league.season.year;
  const entry = league.history?.at(-1);
  const order = Object.keys(c.teams).sort((a, b) => {
    const ra = entry?.standings?.findIndex((s) => s.team === a) ?? 0;
    const rb = entry?.standings?.findIndex((s) => s.team === b) ?? 0;
    return rb - ra || a.localeCompare(b);
  });
  const events = [];
  seededIn(league, `fill:${year}`, () => {
    for (const team of order) {
      if (memberOf(league, team)) continue;
      const seats = c.teams[team];
      const pickFrom = (role) => {
        // ⚠ 点は1人1回だけ引く（並べ替えの比べるたびに乱数を引くと、比べ方が食い違う）
        const scored = Object.values(c.people)
          .filter((p) => p.status === 'free')
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((p) => ({
            p,
            score:
              (p.specialty === role ? 3 : role === 'manager' ? 1 : 0) +
              // 監督と考えの合うコーチを好む（考えが割れて1年で辞める入れ替わりを減らす。
              // 辞任・紙面の話題と同じ物差し `conflictOf`）
              -0.5 * (role === 'manager' ? 0 : conflictOf(c.people[seats.manager], p, role)) +
              (p.origin?.team === team ? 2 : 0) +
              (p.origin?.legend && role === 'manager' ? 2 : 0) -
              (p.age >= 68 ? 2 : 0) +
              Math.random() * 2.5,
          }));
        scored.sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id));
        return scored[0]?.p || null;
      };
      if (!seats.manager) {
        const insiders = ['pitching', 'batting']
          .map((role) => c.people[seats[role]])
          .filter((p) => p && p.age < 66);
        let coach = null;
        let promoted = false;
        if (insiders.length && Math.random() < 0.5) {
          coach = insiders.sort((a, b) => (b.specialty === 'manager') - (a.specialty === 'manager') || a.id.localeCompare(b.id))[0];
          seats[coach.job.role] = null;
          promoted = true;
        } else coach = pickFrom('manager');
        if (coach) {
          assign(c, team, 'manager', coach, year);
          events.push(hireEvent(c, { year, kind: promoted ? 'promote' : 'hire', team, role: 'manager', coach }));
        }
      }
      for (const role of ['pitching', 'batting']) {
        if (seats[role]) continue;
        // ⚠ まれに空席のまま（1年）。監督が受け持ちを兼ねる
        if (Math.random() < 0.05) continue;
        const coach = pickFrom(role);
        if (!coach) continue;
        assign(c, team, role, coach, year);
        events.push(hireEvent(c, { year, team, role, coach }));
      }
    }
  });
  for (const event of events.reverse()) logEvent(c, event);
  return events;
}

