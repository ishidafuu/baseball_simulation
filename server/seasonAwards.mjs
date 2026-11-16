// ============================================================
// 年間表彰（オンライン）。MVP・新人王・ベストナイン・最優秀バッテリーを部ごとに選ぶ。
//
// ⚠ 先方回答（2026-11-16）「すぐやりたい」A2。タイトル8つ（首位打者〜最多セーブ、
//    `processSeasonEnd`）はリーグ全体のまま、こちらは**部（1部・2部）ごと**に選ぶ。
//    2部の球団にも取れる賞を置くため。
// ⚠ **成績から決めるだけで乱数を引かない**。能力にもご褒美にも効かない（飾りと記録）。
// ⚠ 保存は `season.frozenAwards.honors`（無ければ無いだけ）。`league.history[].awards` は
//    `frozenAwards` の写しなので、年度更新でそのまま年度の記録に残る。版は上げない。
// ⚠ 成績はタイトルと同じ `TEAMS_DATA` の `seasonStats`（規定の打席・投球回も同じ
//    `qualifiedPA` / `qualifiedOuts`）。捕手と投手の組み合わせだけは記録（`league.records`）
//    の捕手の行から引く。
// ============================================================
import {
  qualifiedPA,
  qualifiedOuts,
  plateAppearances,
} from '../src/season/seasonManager.js';
import { compareLeagueStanding } from '../src/online/pyramidLeague.js';

/** 守備位置の正式名（表彰の見出し） */
const POSITION_NAMES = {
  pitcher: '投手', catcher: '捕手', first: '一塁手', second: '二塁手',
  third: '三塁手', short: '遊撃手', left: '外野手', center: '外野手', right: '外野手',
};
/** ベストナインの枠（外野は3人。DH は無い） */
export const BEST_NINE_SLOTS = [
  { pos: 'pitcher', count: 1 },
  { pos: 'catcher', count: 1 },
  { pos: 'first', count: 1 },
  { pos: 'second', count: 1 },
  { pos: 'third', count: 1 },
  { pos: 'short', count: 1 },
  { pos: 'outfield', count: 3 },
];
const OUTFIELD = new Set(['left', 'center', 'right']);
/** 守る位置の難しさ（打者の値打ちに足す点。規定打席ぶん出たときの点） */
const POSITION_BONUS = { catcher: 5, short: 4, second: 3, center: 3, third: 2, right: 1, left: 0, first: -1, pitcher: 0 };
/** ベストナインに数える出場の下限（規定打席の何割か） */
const BEST_NINE_PA_SHARE = 0.5;
/** 最優秀バッテリーに数える組の下限（規定投球回の何割か） */
const BATTERY_OUTS_SHARE = 0.5;
/** 部の1位の球団の選手に、MVPで足す点 */
const CHAMPION_BONUS = 4;

const n = (v) => (Number.isFinite(v) ? v : 0);
const rate3 = (v) => v.toFixed(3).replace(/^0/, '');
const era2 = (earned, outs) => (outs > 0 ? (earned * 27) / outs : null);

/** 打者の打撃の数字 */
function battingLine(b) {
  const pa = plateAppearances(b);
  const ab = n(b.atBats);
  const h = n(b.hits);
  const tb = h + n(b.doubles) + 2 * n(b.triples) + 3 * n(b.homeruns);
  return {
    pa,
    avg: ab > 0 ? h / ab : 0,
    obp: pa > 0 ? (h + n(b.walks) + n(b.hitByPitch)) / pa : 0,
    slg: ab > 0 ? tb / ab : 0,
  };
}

/** 画面に出す短い成績（打者「打率.312 25本 80打点」、投手「15勝4敗 防御率2.10」） */
export function batterSummary(b) {
  const { avg } = battingLine(b);
  return `打率${rate3(avg)} ${n(b.homeruns)}本 ${n(b.rbis)}打点`;
}
export function pitcherSummary(p) {
  const era = era2(n(p.earnedRuns), n(p.inningsPitched));
  const e = era == null ? '' : ` 防御率${era.toFixed(2)}`;
  if (n(p.saves) >= 10 && n(p.saves) > n(p.wins)) return `${n(p.saves)}セーブ${e}`;
  return `${n(p.wins)}勝${n(p.losses)}敗${e}`;
}

/**
 * 選手の値打ち（平均より何点分ぶん上か、のおおよそ）。打者と投手を同じ物差しで比べる。
 * - 打者: 出塁率と長打率の平均との差 × 打席。守る位置の難しさと出場の多さを足す
 * - 投手: 部の防御率との差 × 投球回。セーブを少し足す
 */
function batterValue(b, lg, position, minPA) {
  const line = battingLine(b);
  if (line.pa <= 0) return null;
  const share = Math.min(1, line.pa / minPA);
  return (
    line.pa * ((line.obp - lg.obp) + 0.5 * (line.slg - lg.slg)) * 0.45 +
    n(b.stolenBases) * 0.15 +
    // ⚠ 記者投票らしさ（本塁打と打点の多い人が選ばれやすい）。出塁と長打だけだと
    //    「打率.282・5本」が「.308・27本」の上に来る年があった
    n(b.homeruns) * 0.4 +
    n(b.rbis) * 0.08 +
    (POSITION_BONUS[position] ?? 0) * share +
    share * 8
  );
}
function pitcherValue(p, lg, minOuts) {
  const outs = n(p.inningsPitched);
  if (outs <= 0) return null;
  const era = era2(n(p.earnedRuns), outs);
  return ((lg.era - era) * outs) / 27 + n(p.wins) * 0.6 + n(p.saves) * 0.3 + Math.min(1, outs / minOuts) * 8;
}

/** 部の平均（打者は打席のある人全員、投手は投げた人全員） */
function leagueAverages(players) {
  let pa = 0, h = 0, bb = 0, ab = 0, tb = 0, outs = 0, er = 0;
  for (const x of players) {
    const b = x.player.seasonStats?.batting || {};
    const p = x.player.seasonStats?.pitching || {};
    const bp = plateAppearances(b);
    pa += bp;
    ab += n(b.atBats);
    h += n(b.hits);
    bb += n(b.walks) + n(b.hitByPitch);
    tb += n(b.hits) + n(b.doubles) + 2 * n(b.triples) + 3 * n(b.homeruns);
    outs += n(p.inningsPitched);
    er += n(p.earnedRuns);
  }
  return {
    obp: pa > 0 ? (h + bb) / pa : 0.3,
    slg: ab > 0 ? tb / ab : 0.35,
    era: outs > 0 ? (er * 27) / outs : 4,
  };
}

/** 新人王に数える年齢の上限（表彰の時点の年齢） */
export const ROOKIE_MAX_AGE = 22;

/**
 * 新人王の候補か。**どの年も同じ決まり**:
 *   1. 表彰の時点で22歳以下（`ROOKIE_MAX_AGE`）
 *   2. このリーグの去年までの記録（`league.records.seasons`）に出ていない
 *      （＝このリーグで公式戦に出るのは今年がはじめて）
 * ⚠ 1年目のリーグは去年の記録が無いので、1. だけで決まる（足す前の決まりと同じ）。
 *    前は2年目から 1. を見ておらず、30歳のトライアウト入団や途中参加の人の
 *    初期メンバー（24人）が丸ごと候補になっていた。
 * ⚠ 選手ごとの「このリーグに来た年」は全員には無い（1年目の CPU 球団の名簿には
 *    経歴が付かず、トライアウトの入団は前の年度の印で付く）ので、記録で見る。
 *    名簿にいて1試合も出なかった若手は翌年も候補のままだが、年齢の上限で23歳には外れる
 *    （NPB も「前の年までの出場が少ない」ことで決める）。
 */
export function isRookie(league, player, year) {
  if ((player.age ?? 99) > ROOKIE_MAX_AGE) return false;
  const key = player.onlinePlayerId;
  if (!key) return true;
  return !Object.entries(league.records?.seasons || {}).some(
    ([y, s]) => Number(y) < year && s.players?.[key],
  );
}

const entryOf = (x, extra = {}) => ({
  id: x.player.id,
  key: x.player.onlinePlayerId || null,
  name: x.player.name,
  team: x.team,
  position: x.player.position || null,
  ...extra,
});

/** 投手として数えるか（登録が投手。二刀流の野手は打者として数える） */
const isPitcher = (p) => p.position === 'pitcher';

/**
 * 部ごとの表彰を選ぶ。
 * @param league オンラインのリーグ（部分け `league.teams[].league`・記録・順位表）
 * @param teams 球団名 → 球団（`TEAMS_DATA`）
 * @returns {{ [leagueId]: { mvp, rookie, bestNine, battery } }}
 */
export function selectHonors(league, teams) {
  const season = league.season;
  const year = season.year;
  const totalGames = season.settings?.gamesPerSeason || 0;
  const minPA = qualifiedPA(totalGames);
  const minOuts = qualifiedOuts(totalGames);
  const tierOf = new Map((league.teams || []).map((t) => [t.name, t.league]));
  const names = (season.settings?.teamNames || Object.keys(teams)).filter((name) => teams[name]);
  const honors = {};
  for (const leagueId of new Set(names.map((name) => tierOf.get(name)).filter(Boolean))) {
    const teamNames = names.filter((name) => tierOf.get(name) === leagueId);
    // ⚠ **部は表彰の時点で居る球団で決め、成績はその年の通し**（`seasonStats` は移籍しても
    //    選手に付いて回る）。年の途中にトレードで部をまたいだ選手は、移った先の部で、
    //    前の球団の分も含めた1年分の成績で比べる（前の部では候補にならない）。
    //    部の平均（`leagueAverages`）も同じ数え方。
    const players = teamNames.flatMap((team) =>
      (teams[team].players || []).map((player) => ({ team, player })),
    );
    if (!players.length) continue;
    const lg = leagueAverages(players);
    // 部の1位（順位表と同じ並べ方）
    const table = (season.standings || [])
      .filter((s) => teamNames.includes(s.team))
      .map((s) => ({ ...s, winRate: s.winRate ?? (s.wins + s.losses > 0 ? s.wins / (s.wins + s.losses) : 0) }))
      .sort(compareLeagueStanding);
    const champion = table[0]?.team || null;

    const rated = [];
    for (const x of players) {
      const b = x.player.seasonStats?.batting || {};
      const p = x.player.seasonStats?.pitching || {};
      if (isPitcher(x.player)) {
        const v = pitcherValue(p, lg, minOuts);
        if (v != null) rated.push({ ...x, kind: 'pitcher', value: v, line: pitcherSummary(p), enough: n(p.inningsPitched) >= minOuts || n(p.saves) >= 10 });
      } else {
        const v = batterValue(b, lg, x.player.position, minPA);
        if (v != null) rated.push({ ...x, kind: 'batter', value: v, line: batterSummary(b), pa: plateAppearances(b) });
      }
    }
    const best = (list) =>
      list.reduce((a, c) => (a == null || c.value > a.value || (c.value === a.value && String(c.player.name).localeCompare(String(a.player.name), 'ja') < 0) ? c : a), null);

    // MVP: 規定に届いた人の中で値打ちが一番（部の1位の球団の人に少し足す）
    const mvpPool = rated
      .filter((x) => (x.kind === 'batter' ? x.pa >= minPA : x.enough))
      .map((x) => ({ ...x, value: x.value + (x.team === champion ? CHAMPION_BONUS : 0) }));
    const mvp = best(mvpPool);
    // 新人王: 新人の中で値打ちが一番（規定の半分は出た人）
    const rookie = best(
      rated.filter(
        (x) =>
          isRookie(league, x.player, year) &&
          (x.kind === 'batter' ? x.pa >= minPA * BEST_NINE_PA_SHARE : n(x.player.seasonStats?.pitching?.inningsPitched) >= minOuts * BEST_NINE_PA_SHARE || n(x.player.seasonStats?.pitching?.saves) >= 10),
      ),
    );
    // ベストナイン: 登録の守備位置ごと（外野は3人）
    const bestNine = [];
    for (const slot of BEST_NINE_SLOTS) {
      const pool = rated
        .filter((x) =>
          slot.pos === 'pitcher'
            ? x.kind === 'pitcher' && x.enough
            : x.kind === 'batter' &&
              x.pa >= minPA * BEST_NINE_PA_SHARE &&
              (slot.pos === 'outfield' ? OUTFIELD.has(x.player.position) : x.player.position === slot.pos),
        )
        .sort((a, b) => b.value - a.value || String(a.player.name).localeCompare(String(b.player.name), 'ja'))
        .slice(0, slot.count);
      for (const x of pool)
        bestNine.push(entryOf(x, { slot: slot.pos, label: slot.pos === 'outfield' ? '外野手' : POSITION_NAMES[slot.pos], line: x.line }));
    }
    honors[leagueId] = {
      mvp: mvp ? entryOf(mvp, { line: mvp.line }) : null,
      rookie: rookie ? entryOf(rookie, { line: rookie.line }) : null,
      bestNine,
      battery: bestBattery(league, teams, teamNames, minOuts),
    };
  }
  return honors;
}

/**
 * 最優秀バッテリー: 同じ球団の投手と捕手の組で、規定投球回の半分以上を組んだ中で防御率が一番。
 * 捕手の記録（`records.seasons[年].players[鍵].catching.pitchers`）から引く。
 */
function bestBattery(league, teams, teamNames, minOuts) {
  const players = league.records?.seasons?.[league.season.year]?.players || {};
  // ⚠ いまの球団は名簿で見る。記録の `teams` は来た順に**足すだけ**（`recordedStats.mjs`）
  //    なので、A→B→A と戻った選手でも [A, B] のままで、最後の要素はいまの球団ではない
  const teamOf = new Map();
  for (const name of teamNames)
    for (const p of teams[name]?.players || [])
      if (p.onlinePlayerId) teamOf.set(p.onlinePlayerId, name);
  let top = null;
  for (const [key, rec] of Object.entries(players)) {
    const team = teamOf.get(key);
    if (!team || !teamNames.includes(team) || !rec.catching?.pitchers) continue;
    for (const [pitcherKey, line] of Object.entries(rec.catching.pitchers)) {
      const outs = n(line.outs);
      if (outs < minOuts * BATTERY_OUTS_SHARE) continue;
      const pitcher = players[pitcherKey];
      if (!pitcher || teamOf.get(pitcherKey) !== team) continue;
      const era = era2(n(line.earnedRuns), outs);
      if (top == null || era < top.era || (era === top.era && outs > top.outs))
        top = { era, outs, team, pitcher: pitcher.name, catcher: rec.name };
    }
  }
  if (!top) return null;
  return {
    team: top.team,
    pitcher: top.pitcher,
    catcher: top.catcher,
    line: `${Math.floor(top.outs / 3)}回 防御率${top.era.toFixed(2)}`,
  };
}

/**
 * 球団の年表に出す表彰（「MVP 山田」「ベストナイン 山田・佐藤」）。
 * `awards.honors` が無い年（表彰を足す前の年）は空。
 */
export function honorTitlesOf(awards, teamName) {
  const out = [];
  for (const h of Object.values(awards?.honors || {})) {
    if (h.mvp?.team === teamName) out.push(`MVP ${h.mvp.name}`);
    if (h.rookie?.team === teamName) out.push(`新人王 ${h.rookie.name}`);
    if (h.battery?.team === teamName) out.push(`最優秀バッテリー ${h.battery.pitcher}・${h.battery.catcher}`);
    const nine = (h.bestNine || []).filter((x) => x.team === teamName).map((x) => x.name);
    if (nine.length) out.push(`ベストナイン ${nine.join('・')}`);
  }
  return out;
}

const TITLE_ROWS = [
  ['battingChampion', '首位打者', (a) => (a.avg != null ? `打率${String(a.avg).replace(/^0/, '')}` : '')],
  ['homeRunKing', '本塁打王', (a) => `${a.homeruns ?? ''}本`],
  ['rbiKing', '打点王', (a) => `${a.rbis ?? ''}打点`],
  ['stolenBaseKing', '盗塁王', (a) => `${a.stolenBases ?? ''}盗塁`],
  ['eraChampion', '最優秀防御率', (a) => (a.era != null ? `防御率${a.era}` : '')],
  ['winsLeader', '最多勝', (a) => `${a.wins ?? ''}勝`],
  ['strikeoutKing', '最多奪三振', (a) => `${a.strikeouts ?? ''}奪三振`],
  ['savesLeader', '最多セーブ', (a) => `${a.saves ?? ''}セーブ`],
];

/**
 * ビューに載せる、いちばん新しい年の表彰（タイトル＋部ごとの表彰）。
 * 成績を確定した年（10月下旬〜年度更新）はその年、それ以外は去年（`history` の最後）。
 * 表彰を足す前の年しか無ければ部ごとの表彰は空のまま、タイトルだけ出す。
 */
export function honorsView(league, leagueNames = {}) {
  const current = league.season?.frozenAwards;
  const last = league.history?.at?.(-1);
  const source = current ? { year: league.season.year, awards: current } : last ? { year: last.year, awards: last.awards } : null;
  if (!source?.awards) return null;
  const a = source.awards;
  const titles = TITLE_ROWS.filter(([k]) => a[k]?.name).map(([k, label, value]) => ({
    label,
    name: a[k].name,
    team: a[k].team,
    line: value(a[k]),
  }));
  const leagues = Object.entries(a.honors || {})
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([id, h]) => ({
      league: leagueNames[id] || id,
      mvp: h.mvp,
      rookie: h.rookie,
      bestNine: h.bestNine || [],
      battery: h.battery,
    }));
  if (!titles.length && !leagues.length) return null;
  return { year: source.year, titles, leagues };
}
