// ============================================================
// リーグの「年代記」: 節目の記録・引退・裏の大会・優勝や昇格のマジック・球団史。
//
// ⚠ いしだ依頼（2026-11-09）「ゲームのリアリティを出す」のうち、**試合の数字を
//    変えずに記録と見せ方を足すもの**だけ。ここは乱数を引かない
//    （同じ種で同じ試合・同じ年度更新になる）。
// ⚠ 保存に足すのは `league.chronicle`（節目・引退・裏の大会の短い記録）と、
//    `league.history[]` の各年の `leagues`・`moves` だけ。どれも**無ければ作る**
//    （古いリーグでも読める）。過去にさかのぼって作れるのは記録（`league.records`）
//    から数える球団史・歴代記録だけで、節目と引退はこの版から先のぶん。
// ============================================================
import {
  PYRAMID_LEAGUES,
  standingsByLeague,
  compareLeagueStanding,
  PROMOTION_PLACES,
  RELEGATION_FROM_BOTTOM,
} from '../src/online/pyramidLeague.js';
import { SEASON_PHASES } from '../src/season/seasonManager.js';
import { KOSHIEN_STAGE_LABEL } from '../src/season/koshien.js';
import { SEASON_START_MONTH } from '../src/online/shared.js';
import { honorTitlesOf, honorsView } from './seasonAwards.mjs';
import { withProCareer, proCareersOf, rowsWithCareer, newsOfCareers } from './proCareer.mjs';

// ⚠ 節目は**球団ごとに**最新20件（12球団で最大240件・数十KB）。以前はリーグ全体で最新40件で、
//    1年目だけで129件できるため約1か月で消え、「球団史・記録」の節目が各球団に数件しか残らなかった
const KEEP_MILESTONES_PER_TEAM = 20;
const keepMilestones = (list) => {
  const count = {};
  return list.filter((m) => (count[m.team] = (count[m.team] || 0) + 1) <= KEEP_MILESTONES_PER_TEAM);
};
const KEEP_RETIRED = 60;
const KEEP_WORLD = 12;

/** 通算の節目（このリーグでの通算）。`every` ごと、`from` から */
export const CAREER_MILESTONES = [
  { side: 'batting', stat: 'hits', label: '安打', every: 100, from: 100 },
  { side: 'batting', stat: 'homeruns', label: '本塁打', every: 50, from: 50 },
  { side: 'batting', stat: 'rbis', label: '打点', every: 100, from: 100 },
  { side: 'batting', stat: 'stolenBases', label: '盗塁', every: 50, from: 50 },
  { side: 'pitching', stat: 'wins', label: '勝', every: 25, from: 25 },
  { side: 'pitching', stat: 'saves', label: 'セーブ', every: 50, from: 50 },
  { side: 'pitching', stat: 'holds', label: 'ホールド', every: 50, from: 50 },
  { side: 'pitching', stat: 'strikeouts', label: '奪三振', every: 250, from: 250 },
];

/** シーズンの節目（その年の数字）。決まった値だけ */
export const SEASON_MILESTONES = [
  { side: 'batting', stat: 'homeruns', label: '本塁打', at: [20, 30, 40, 50] },
  { side: 'batting', stat: 'hits', label: '安打', at: [150, 180, 200] },
  { side: 'batting', stat: 'rbis', label: '打点', at: [80, 100, 120] },
  { side: 'batting', stat: 'stolenBases', label: '盗塁', at: [30, 50] },
  { side: 'pitching', stat: 'wins', label: '勝', at: [15, 20] },
  { side: 'pitching', stat: 'saves', label: 'セーブ', at: [30, 40] },
  { side: 'pitching', stat: 'strikeouts', label: '奪三振', at: [150, 200] },
];

/** 何かを越えたか。越えた値（いちばん大きいもの）か null */
function crossedCareer(rule, before, after) {
  if (after < rule.from || after <= before) return null;
  const step = Math.floor(after / rule.every) * rule.every;
  return step > before && step >= rule.from ? step : null;
}
function crossedSeason(rule, before, after) {
  const hit = rule.at.filter((v) => before < v && after >= v);
  return hit.length ? hit.at(-1) : null;
}

const chronicleOf = (league) =>
  (league.chronicle ||= { milestones: [], retired: [], world: [] });

const num = (v) => (Number.isFinite(v) ? v : 0);

/** 打撃・投球の数の項目を足し込む（`into` は `{ batting: {}, pitching: {} }`。`stats` は同じ形） */
function addStats(into, stats) {
  for (const side of ['batting', 'pitching'])
    for (const [k, v] of Object.entries(stats?.[side] || {}))
      if (typeof v === 'number') into[side][k] = (into[side][k] || 0) + v;
}

/**
 * 過去の年（今季より前）の通算。記録の鍵ごと。
 * ⚠ 年の中では変わらないので、リーグ×年で覚えておく（試合のある日ごとに
 *    全シーズン×300人をなめ直さない）。覚えるのはこのプロセスの間だけ（保存しない）
 */
const pastCache = new WeakMap();
function pastTotals(league, year) {
  const records = league.records;
  const hit = records && pastCache.get(records);
  if (hit?.year === year) return hit.totals;
  const out = new Map();
  for (const season of Object.values(league.records?.seasons || {})) {
    if (Number(season.year) >= year) continue;
    for (const [key, rec] of Object.entries(season.players || {})) {
      const t = out.get(key) || { batting: {}, pitching: {} };
      addStats(t, rec.stats);
      out.set(key, t);
    }
  }
  if (records) pastCache.set(records, { year, totals: out });
  return out;
}

/**
 * その日の試合で届いた節目を残す。`games`: その日に終わった試合（`gameId` を持つ）。
 * ⚠ 前の値は「今の値 − その日の出場ぶん」で作る。前日の写しを取ると、
 *    300人ぶんの通算を毎日2回なめることになる
 */
export function recordMilestones(league, games, date) {
  const year = league.season.year;
  const season = league.records?.seasons?.[year];
  if (!season || !games.length) return [];
  const past = pastTotals(league, year);
  // ⚠ **その日の分を選手ごとに足してから**比べる。1日に2試合出た人（ダブルヘッダー・
  //    プレーオフの再試合）を1試合ずつ比べると、「今季の合計 − 1試合ぶん」がもう
  //    節目を越えていて、越えた日が記録されない
  const day = new Map();
  for (const game of games) {
    const box = season.games?.[String(game.gameId)];
    if (!box?.teams) continue;
    for (const [team, rows] of Object.entries(box.teams))
      for (const row of rows || []) {
        const d = day.get(row.key) || { team, name: row.name, id: row.id, key: row.key, batting: {}, pitching: {} };
        for (const side of ['batting', 'pitching'])
          for (const [k, v] of Object.entries(row[side] || {}))
            if (typeof v === 'number') d[side][k] = (d[side][k] || 0) + v;
        d.team = team;
        day.set(row.key, d);
      }
  }
  const found = [];
  for (const row of day.values()) {
    const team = row.team;
    const rec = season.players?.[row.key];
    if (!rec) continue;
    for (const rule of CAREER_MILESTONES) {
      const today = num(row[rule.side]?.[rule.stat]);
      if (!today) continue;
      const after = num(past.get(row.key)?.[rule.side]?.[rule.stat]) + num(rec.stats?.[rule.side]?.[rule.stat]);
      const value = crossedCareer(rule, after - today, after);
      if (value)
        found.push({
          kind: 'career', side: rule.side, stat: rule.stat,
          label: `通算${value}${rule.label}`, value,
          team, name: row.name, playerId: row.id, key: row.key,
        });
    }
    for (const rule of SEASON_MILESTONES) {
      const today = num(row[rule.side]?.[rule.stat]);
      if (!today) continue;
      const after = num(rec.stats?.[rule.side]?.[rule.stat]);
      const value = crossedSeason(rule, after - today, after);
      if (value)
        found.push({
          kind: 'season', side: rule.side, stat: rule.stat,
          label: `シーズン${value}${rule.label}`, value,
          team, name: row.name, playerId: row.id, key: row.key,
        });
    }
  }
  if (!found.length) return found;
  const stamp = { year, month: date.month, day: date.day };
  const c = chronicleOf(league);
  c.milestones = keepMilestones([...found.map((m) => ({ ...stamp, ...m })), ...c.milestones]);
  return found;
}

// ------------------------------------------------------------
// 裏の大会（甲子園・独立リーグ日本一決定戦）
// ------------------------------------------------------------


export function recordKoshien(league, result, date) {
  if (!result?.champion) return;
  const c = chronicleOf(league);
  if (c.world.some((w) => w.kind === 'koshien' && w.year === league.season.year)) return;
  const pref = (name) => result.entries?.find((e) => e.name === name)?.pref || null;
  c.world.unshift({
    kind: 'koshien',
    year: league.season.year,
    month: date.month,
    day: date.day,
    champion: result.champion,
    championPref: pref(result.champion),
    runnerUp: result.runnerUp || null,
    runnerUpPref: pref(result.runnerUp),
    // ⚠ 選手の id を残す。トライアウトの候補に同じ人が出たら「甲子園の○○」と添える
    notable: (result.notable || []).slice(0, 12).map((n) => ({
      playerId: n.playerId, name: n.name, school: n.school, pref: n.pref || null,
      role: n.role, stage: n.stage, stageLabel: KOSHIEN_STAGE_LABEL[n.stage] || '出場',
    })),
  });
  c.world = c.world.slice(0, KEEP_WORLD);
}

/** 独立リーグ日本一決定戦。`ours`: このリーグの代表（プレーオフ優勝） */
export function recordGrandChampionship(league, gc, ours, date) {
  if (!gc?.bracket?.champion) return;
  const c = chronicleOf(league);
  if (c.world.some((w) => w.kind === 'grand' && w.year === league.season.year)) return;
  // 代表がどこまで勝ち進んだか（不戦勝は勝ちに数えない）
  const rounds = gc.bracket.rounds || [];
  let reached = null;
  rounds.forEach((round, r) => {
    for (const m of round)
      if ((m.team1 === ours || m.team2 === ours) && m.team1 && m.team2) reached = { round: r, won: m.winner === ours, score: m.score || null, opponent: m.team1 === ours ? m.team2 : m.team1 };
  });
  const final = rounds.at(-1)?.[0];
  const leagueOf = (team) => gc.champions?.find((x) => x.team === team)?.leagueName || null;
  c.world.unshift({
    kind: 'grand',
    year: league.season.year,
    month: date.month,
    day: date.day,
    champion: gc.bracket.champion,
    championLeague: leagueOf(gc.bracket.champion),
    runnerUp: gc.bracket.runnerUp || null,
    runnerUpLeague: leagueOf(gc.bracket.runnerUp),
    finalScore: final?.score || null,
    teams: gc.bracket.teamCount || gc.champions?.length || 0,
    ours: ours || null,
    oursResult: !ours ? null
      : gc.bracket.champion === ours ? '優勝'
      : gc.bracket.runnerUp === ours ? '準優勝'
      : reached ? `${rounds.length - reached.round === 2 ? '準決勝' : rounds.length - reached.round === 3 ? '準々決勝' : `${reached.round + 1}回戦`}で敗退` : null,
    oursLostTo: ours && reached && !reached.won ? reached.opponent : null,
  });
  c.world = c.world.slice(0, KEEP_WORLD);
}

/** 甲子園で名を上げた人か（トライアウトの候補に添える）。新しい年から探す */
export function koshienNoteOf(league, playerId) {
  for (const w of league.chronicle?.world || []) {
    if (w.kind !== 'koshien') continue;
    const n = w.notable?.find((x) => x.playerId === playerId);
    // ⚠ 年は「N年目」（リーグの年は 1, 2, …。「1年夏」だと高校1年の夏と読める）
    if (n) return `${w.year}年目の夏の甲子園 ${n.school}の${n.role}（${n.stageLabel}）`;
  }
  return null;
}

// ------------------------------------------------------------
// 引退
// ------------------------------------------------------------

/** 通算の要約（このリーグでの成績）。記録の鍵ごと */
function careerOf(league, key) {
  const total = { batting: {}, pitching: {}, seasons: 0, teams: [] };
  for (const season of Object.values(league.records?.seasons || {})) {
    const rec = season.players?.[key];
    if (!rec) continue;
    total.seasons += 1;
    for (const t of rec.teams || []) if (!total.teams.includes(t)) total.teams.push(t);
    addStats(total, rec.stats);
  }
  return total;
}

/** 通算の一行（「通算 .281 45本 230打点」「通算 52勝38敗 防御率3.12」） */
export function careerLine(total, pitcher) {
  const b = total.batting, p = total.pitching;
  if (pitcher && (p.inningsPitched || 0) > 0) {
    const era = (num(p.earnedRuns) * 27) / p.inningsPitched;
    return [`${num(p.games)}試合 ${num(p.wins)}勝${num(p.losses)}敗`, num(p.saves) ? `${p.saves}セーブ` : null, num(p.holds) ? `${p.holds}ホールド` : null, `防御率${era.toFixed(2)}`]
      .filter(Boolean).join(' ');
  }
  if ((b.atBats || 0) > 0) {
    const avg = (num(b.hits) / b.atBats).toFixed(3).replace(/^0/, '');
    return `${num(b.games)}試合 打率${avg} ${num(b.hits)}安打 ${num(b.homeruns)}本塁打 ${num(b.rbis)}打点`;
  }
  return null;
}

/**
 * 年度更新で引退した人を残す（このリーグの球団の人だけ）。
 * `retirements`: `advanceToNextYear` の戻り値。`keys`: 年度更新の前に取った「選手 id → 記録の鍵」
 */
export function recordRetirements(league, retirements, { year, teamNames, keys }) {
  const ours = new Set(teamNames || []);
  const list = [];
  for (const r of retirements || []) {
    if (!ours.has(r.team)) continue;
    const key = keys.get(`${r.team}:${r.name}`);
    const total = key ? careerOf(league, key) : null;
    const pitcher = r.position === 'pitcher';
    list.push({
      year,
      team: r.team,
      name: r.name,
      age: r.age,
      position: r.position,
      seasons: total?.seasons || 0,
      line: total ? careerLine(total, pitcher) : null,
      hits: num(total?.batting.hits),
      homeruns: num(total?.batting.homeruns),
      wins: num(total?.pitching.wins),
      saves: num(total?.pitching.saves),
      hallOfFame: !!r.hallOfFame,
      reason: r.reason || null,
      // 「川崎ミラージュの打撃コーチ」（`assignSecondCareer` の title は「監督」「打撃コーチ」など）
      secondCareer: r.secondCareer?.title ? `${r.secondCareer.team || r.team}の${r.secondCareer.title}` : null,
    });
  }
  // 大物から（通算の数字の大きい順）
  const weight = (x) => x.hits + x.homeruns * 4 + x.wins * 8 + x.saves * 4 + (x.hallOfFame ? 10000 : 0);
  list.sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name, 'ja'));
  const c = chronicleOf(league);
  c.retired = [...list, ...c.retired.filter((x) => x.year !== year)].slice(0, KEEP_RETIRED);
  return list;
}

// ------------------------------------------------------------
// 優勝・昇格・残留のマジック
// ------------------------------------------------------------

/** 球団ごとのレギュラーシーズンの残り試合 */
export function remainingGames(schedule) {
  const out = {};
  for (const g of schedule || []) {
    if (g.phase !== SEASON_PHASES.REGULAR_SEASON || g.result) continue;
    out[g.home] = (out[g.home] || 0) + 1;
    out[g.away] = (out[g.away] || 0) + 1;
  }
  return out;
}

const rateOf = (w, l) => (w + l > 0 ? w / (w + l) : 0);
/** a がどう転んでも b より上か（勝率 → 勝ち数の順。順位表と同じ並べ方） */
function surelyAbove(a, b) {
  const aw = a.wins, al = a.losses + a.left; // a は残りを全部負ける
  const bw = b.wins + b.left, bl = b.losses; // b は残りを全部勝つ
  const ra = rateOf(aw, al), rb = rateOf(bw, bl);
  return ra > rb || (ra === rb && aw > bw);
}

/**
 * マジック: 追う球団が残りを全部勝っても届かなくなるまでに要る「自分の勝ち＋相手の負け」の数。
 * 決まったかどうかと同じ物差し（`surelyAbove`、勝率で厳密に）で数える。届かなければ Infinity。
 * ⚠ 以前は勝ち数だけで数えていた（追う球団の最大の勝ち数＋1 − 自分の勝ち数）。消化試合数が
 *    違うと勝率と食い違い、「マジック0なのに決まっていない」が出ていた（`online-chronicle-check`）
 */
function magicAgainst(lead, chaser) {
  if (surelyAbove(lead, chaser)) return 0;
  let best = Infinity;
  for (let x = 0; x <= lead.left && x < best; x++)
    for (let y = 0; y <= chaser.left && x + y < best; y++) {
      // 自分が x 勝（残りは全敗）、相手が y 敗（残りは全勝）したあとで、もう抜かれないか
      const a = { wins: lead.wins + x, losses: lead.losses + lead.left - x, left: 0 };
      const b = { wins: chaser.wins + chaser.left - y, losses: chaser.losses + y, left: 0 };
      if (surelyAbove(a, b)) {
        best = x + y;
        break;
      }
    }
  return best;
}
/** レギュラーシーズンの残りの直接対決の数（`"球団A|球団B"`。名前の順に並べた鍵） */
function remainingPairs(schedule) {
  const out = {};
  for (const g of schedule || []) {
    if (g.phase !== SEASON_PHASES.REGULAR_SEASON || g.result) continue;
    const key = [g.home, g.away].sort().join('|');
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

/**
 * `chaser` が自力で `lead` の上に立てるか（直接対決を含めて残りを全部勝てば、`lead` が
 * ほかを全部勝っても上に居る）。`lead` から見ると、これが偽になった相手には自力で決められる。
 */
function canPassAlone(chaser, lead, pairs) {
  const h2h = pairs[[chaser.team, lead.team].sort().join('|')] || 0;
  const c = { wins: chaser.wins + chaser.left, losses: chaser.losses, left: 0 };
  const l = { wins: lead.wins + lead.left - h2h, losses: lead.losses + h2h, left: 0 };
  return surelyAbove(c, l);
}

/** いちばん手ごわい相手（マジックがいちばん大きい）と、そのマジック。⚠ 1球団1回だけ数える */
function toughest(lead, chasers) {
  let rival = null;
  let magic = -1;
  for (const chaser of chasers) {
    const m = magicAgainst(lead, chaser);
    if (m > magic) {
      rival = chaser;
      magic = m;
    }
  }
  return { rival, magic };
}

/**
 * 部ごとのレース。`kind`: first（1部の1位）/ promotion（2部の昇格）/ survive（1部の残留）。
 * シーズン中（レギュラーの残りがある間）と、終わった直後の決着だけを返す
 */
export function leagueRaces(league, left = remainingGames(league.season.schedule)) {
  const anyLeft = Object.values(left).some((n) => n > 0);
  const played = (league.season.standings || []).some((s) => (s.gamesPlayed || 0) > 0);
  if (!played) return [];
  const races = [];
  const standings = league.season.standings || [];
  const byName = Object.fromEntries(standings.map((s) => [s.team, s]));
  // ⚠ `standingsByLeague` は**球団名**を順位の順に返す（行ではない）
  const groups = standingsByLeague(league.teams || [], standings);
  const pairs = remainingPairs(league.season.schedule);
  // ⚠ **マジックは「点灯」してから出す**（追う球団がどれも自力で抜けなくなってから）。
  //    以前は「残り試合以下」で絞っていたが、単独首位なら必ず成り立つので、
  //    開幕2日目から「マジック118」が順位表・話題・両紙に出続けていた
  const lit = (lead, chasers) => chasers.every((c) => !canPassAlone(c, lead, pairs));
  for (const def of PYRAMID_LEAGUES) {
    const rows = (groups[def.id] || []).map((team) => ({ team, wins: byName[team]?.wins || 0, losses: byName[team]?.losses || 0, left: left[team] || 0 }));
    if (rows.length < 2) continue;
    const topKind = def.up.length ? 'promotion' : 'first';
    const places = def.up.length ? PROMOTION_PLACES[0] : 1;
    // 上位（1位・昇格圏）: 圏内の最後の球団から見て、圏外のいちばん上と比べる
    for (let i = 0; i < places && i < rows.length - 1; i++) {
      const lead = rows[i];
      const chasers = rows.slice(places);
      const clinched = chasers.every((c) => surelyAbove(lead, c));
      const tough = toughest(lead, chasers);
      const rival = tough.rival;
      const magic = clinched ? 0 : tough.magic;
      if (clinched || (magic <= lead.left && lit(lead, chasers)))
        races.push({ league: def.id, leagueName: def.name, kind: topKind, team: lead.team, magic, clinched, rival: clinched ? null : rival.team, left: lead.left });
    }
    // 下位（降格）: 降格圏のすぐ上の球団の残留マジックと、降格の決定
    if (def.down.length) {
      const n = RELEGATION_FROM_BOTTOM[0];
      const safe = rows[rows.length - n - 1];
      const danger = rows.slice(rows.length - n);
      const stay = danger.every((d) => surelyAbove(safe, d));
      const tough = toughest(safe, danger);
      const rival = tough.rival;
      const magic = stay ? 0 : tough.magic;
      if (stay || (magic <= safe.left && lit(safe, danger)))
        races.push({ league: def.id, leagueName: def.name, kind: 'survive', team: safe.team, magic, clinched: stay, rival: stay ? null : rival.team, left: safe.left });
      for (const d of danger) {
        const above = rows.slice(0, rows.length - n);
        if (above.every((a) => surelyAbove(a, d)))
          races.push({ league: def.id, leagueName: def.name, kind: 'relegated', team: d.team, magic: 0, clinched: true, rival: null, left: d.left });
      }
    }
  }
  // ⚠ シーズンが終わって決着がついたあとも出す（紙面・順位表の「決定」）。オフの手続きの間も
  //    決着だけは残る（`projection.mjs`）。文は時期によらない形にしてある（`chronicleText.js`）
  return anyLeft ? races : races.filter((r) => r.clinched);
}

/**
 * 個人成績の上位に「このままなら年間○」を添える（数える項目だけ。率は添えない）。
 * ⚠ 試合数が少ないうちは添えない（開幕3試合で「年間80本ペース」と書かない）
 */
export function withPace(leaders, league, left = remainingGames(league.season.schedule)) {
  const played = Object.fromEntries((league.season.standings || []).map((s) => [s.team, s.gamesPlayed || 0]));
  return (leaders || []).map((category) => {
    if (['avg', 'era'].includes(category.id)) return category;
    return {
      ...category,
      rows: category.rows.map((row) => {
        const g = played[row.team] || 0;
        const rest = left[row.team] || 0;
        if (g < 15 || rest <= 0) return row;
        return { ...row, pace: Math.round((row.value / g) * (g + rest)) };
      }),
    };
  });
}

// ------------------------------------------------------------
// 球団史・歴代記録（記録からさかのぼって作れる）
// ------------------------------------------------------------

const TEAM_RECORDS = [
  { side: 'batting', stat: 'hits', label: '安打' },
  { side: 'batting', stat: 'homeruns', label: '本塁打' },
  { side: 'batting', stat: 'rbis', label: '打点' },
  { side: 'batting', stat: 'stolenBases', label: '盗塁' },
  { side: 'pitching', stat: 'wins', label: '勝利' },
  { side: 'pitching', stat: 'saves', label: 'セーブ' },
  { side: 'pitching', stat: 'holds', label: 'ホールド' },
  { side: 'pitching', stat: 'strikeouts', label: '奪三振' },
];
const AWARD_LABELS = {
  battingChampion: '首位打者', homeRunKing: '本塁打王', rbiKing: '打点王', stolenBaseKing: '盗塁王',
  eraChampion: '最優秀防御率', winsLeader: '最多勝', strikeoutKing: '最多奪三振', savesLeader: '最多セーブ',
};

/**
 * 球団の年表と歴代記録。`activeKeys`: いま名簿にいる人の記録の鍵（「現役」の印）。
 * Map（鍵 → 選手 id）なら、現役の行に `id` を付ける（画面が名前を押して選手を開く）
 */
const idOf = (keys, key) =>
  keys instanceof Map && keys.has(key) ? { id: keys.get(key) } : {};

export function teamChronicle(league, teamName, activeKeys = new Set()) {
  // 年表（終わった年）
  const seasons = (league.history || []).map((h) => {
    const row = h.standings?.find((s) => s.team === teamName);
    const leagueId = h.leagues?.[teamName] || null;
    let rank = null;
    if (row && leagueId) {
      // ⚠ 順位は昇降格と同じ並べ方（勝率 → 勝利数 → 球団名、`compareLeagueStanding`）。
      //    保存の並びのままだと、同率で終わった年に「5位・降格」のように食い違う
      const table = h.standings
        .filter((s) => h.leagues[s.team] === leagueId)
        .map((s) => ({ ...s, winRate: s.winRate ?? (s.wins + s.losses > 0 ? s.wins / (s.wins + s.losses) : 0) }))
        .sort(compareLeagueStanding);
      rank = table.findIndex((s) => s.team === teamName) + 1;
    }
    const move = (h.moves || []).find((m) => m.teamId === teamName);
    const titles = Object.entries(h.awards || {})
      .filter(([k, a]) => AWARD_LABELS[k] && a?.team === teamName)
      .map(([k, a]) => `${AWARD_LABELS[k]} ${a.name}`)
      .concat(honorTitlesOf(h.awards, teamName));
    return {
      year: h.year,
      league: leagueId ? PYRAMID_LEAGUES.find((l) => l.id === leagueId)?.name || null : null,
      rank,
      wins: row?.wins ?? null,
      losses: row?.losses ?? null,
      draws: row?.draws ?? null,
      champion: h.playoffChampion === teamName,
      move: move ? (PYRAMID_LEAGUES.find((l) => l.id === move.to)?.tier < PYRAMID_LEAGUES.find((l) => l.id === move.from)?.tier ? '昇格' : '降格') : null,
      titles,
    };
  }).reverse();

  // 歴代記録: シーズン最多（各項目の上位3）と通算（この球団での成績の上位3）
  const single = Object.fromEntries(TEAM_RECORDS.map((r) => [r.stat, []]));
  const careers = new Map();
  for (const season of Object.values(league.records?.seasons || {})) {
    const current = Number(season.year) === league.season.year;
    // ⚠ **年の途中で移籍した人は、この球団で出た試合だけ**を数える。記録の `stats` は
    //    両方の球団の合計なので、そのままだと前の球団で打った本塁打まで球団記録に入る。
    //    その人の分だけ試合の記録（球団ごとの行）から足し直す
    const moved = new Map();
    for (const rec of Object.values(season.players || {}))
      if (rec.teams?.includes(teamName) && rec.teams.length > 1)
        moved.set(rec.key, { batting: {}, pitching: {} });
    if (moved.size)
      for (const box of Object.values(season.games || {}))
        for (const row of box?.teams?.[teamName] || []) {
          const t = moved.get(row.key);
          if (t) addStats(t, row);
        }
    for (const rec of Object.values(season.players || {})) {
      if (!rec.teams?.includes(teamName)) continue;
      const stats = moved.get(rec.key) || rec.stats;
      const c = careers.get(rec.key) || { key: rec.key, name: rec.name, batting: {}, pitching: {} };
      for (const r of TEAM_RECORDS) {
        const v = num(stats?.[r.side]?.[r.stat]);
        if (v > 0) single[r.stat].push({ name: rec.name, year: Number(season.year), value: v, current, active: activeKeys.has(rec.key), ...idOf(activeKeys, rec.key) });
        c[r.side][r.stat] = (c[r.side][r.stat] || 0) + v;
      }
      careers.set(rec.key, c);
    }
  }
  const top = (list) => list.sort((a, b) => b.value - a.value || a.year - b.year || a.name.localeCompare(b.name, 'ja')).slice(0, 3);
  const records = TEAM_RECORDS.map((r) => ({
    stat: r.stat,
    label: r.label,
    season: top(single[r.stat]),
    career: top([...careers.values()].map((c) => ({ name: c.name, value: num(c[r.side][r.stat]), active: activeKeys.has(c.key), ...idOf(activeKeys, c.key) })).filter((x) => x.value > 0)),
  })).filter((r) => r.season.length || r.career.length);

  const c = league.chronicle || {};
  return {
    seasons,
    records,
    retired: (c.retired || []).filter((r) => r.team === teamName).slice(0, 20),
    // プロ入りした選手（球団の誇り。`proDraft.mjs`）
    // プロでのその後（飾り。`proCareer.mjs`。保存せず毎回作り直す）
    proDrafted: withProCareer((c.proDrafted || []).filter((r) => r.team === teamName), league).map(({ key, ...r }) => r),
    milestones: (c.milestones || []).filter((m) => m.team === teamName).slice(0, KEEP_MILESTONES_PER_TEAM),
    moves: teamMoves(league, teamName),
  };
}

/** 入退団の言い方（取引の種類 → 入った側・出た側） */
const MOVE_HOW = {
  signing: { in: '入団' },
  release: { out: '退団' },
  trade: { in: 'トレード', out: 'トレード' },
};

/**
 * 球団の入退団履歴（新しい順。1行1人）。
 *
 * ⚠ 先方指摘「各チームの入退団履歴も見られるように。表示先は球団史・記録から」。
 *    材料は取引の記録（`league.transactions`。入団＝トライアウト・退団＝契約更改・トレード）と
 *    引退（`chronicle.retired`）。取引の記録は球団ごとに `TEAM_TRANSACTIONS_KEEP` 件残す（`keepTransactions`）。
 * ⚠ `other` は相手の球団（トレードの相手・入団前の所属）。無ければ null。
 */
export function teamMoves(league, teamName, limit = 80) {
  const rows = [];
  for (const t of league.transactions || []) {
    if (!t.teams?.includes(teamName)) continue;
    const how = MOVE_HOW[t.kind];
    if (!how) continue;
    for (const m of t.moves || []) {
      const side = m.to === teamName ? 'in' : m.from === teamName ? 'out' : null;
      if (!side || !how[side]) continue;
      rows.push({
        year: t.year ?? null,
        month: t.date?.month ?? null,
        day: t.date?.day ?? null,
        side,
        how: how[side],
        name: m.name,
        position: m.position || null,
        other: (side === 'in' ? m.from : m.to) || null,
      });
    }
  }
  for (const r of league.chronicle?.retired || [])
    if (r.team === teamName)
      rows.push({
        year: r.year ?? null,
        // 引退は年度更新（11月末）
        month: 11,
        day: 30,
        side: 'out',
        how: '引退',
        name: r.name,
        position: r.position || null,
        other: null,
      });
  for (const r of league.chronicle?.proDrafted || [])
    if (r.team === teamName)
      rows.push({
        year: r.year ?? null,
        // 指名はNPBのドラフト会議（10月下旬）
        month: 10,
        day: 25,
        side: 'out',
        how: 'プロ入り',
        name: r.name,
        position: r.position || null,
        other: r.npbTeam || null,
      });
  const key = (r) => (r.year || 0) * 10000 + (r.month || 0) * 100 + (r.day || 0);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => key(b.r) - key(a.r) || a.i - b.i)
    .slice(0, limit)
    .map(({ r }) => r);
}

/** ビューに載せる分（リーグ全体の最近のもの。小さく） */
export function chronicleView(league) {
  const c = league.chronicle || {};
  const year = league.season.year;
  // プロでのその後は行ごとに1回だけ作り、一覧（先頭30人）と便り（全員）で使い回す
  const careers = proCareersOf(c.proDrafted || [], league);
  return {
    milestones: (c.milestones || []).slice(0, 12).map(({ key, ...m }) => m),
    // ⚠ 引退は**年度更新の直後（キャンプ〜開幕前）だけ**。年度の印だけで決めると、
    //    翌年の契約更改（11月。まだ同じ年）でも去年の引退が新しい話として紙面に出る
    retired: (c.retired || [])
      .filter((r) => r.year === year - 1 && (league.season.currentDate?.month || 0) < SEASON_START_MONTH)
      .slice(0, 12),
    world: (c.world || []).slice(0, 4).map(({ notable, ...w }) => ({ ...w, star: notable?.[0] || null })),
    // リーグからプロ入りした選手（新しい順。球団史・記録の「リーグからプロへ」）
    // ⚠ リーグ全体の一覧はいちばん新しい年の一行（`after`）だけ。全部の年（`career`）は球団史の方に載せる
    proDrafted: rowsWithCareer(careers.slice(0, 30)).map(({ key, career, ...r }) => r),
    // 今年のプロの便り（10月から年度更新まで。紙面と話題に出す）
    proNews: newsOfCareers(careers, league),
    // いちばん新しい年の表彰（タイトルと、部ごとの MVP・新人王・ベストナイン・最優秀バッテリー）
    honors: honorsView(league, Object.fromEntries(PYRAMID_LEAGUES.map((l) => [l.id, l.name]))),
  };
}

/** 年度の記録（`league.history` の最後）に、その年の部分けと昇降格を書き足す */
export function annotateHistory(entry, teams, movements) {
  if (!entry) return;
  entry.leagues ??= Object.fromEntries((teams || []).map((t) => [t.name, t.league]));
  if (movements) entry.moves ??= movements.map((m) => ({ teamId: m.teamId, from: m.from, to: m.to }));
}
