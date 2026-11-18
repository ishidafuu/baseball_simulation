// オンラインのリーグを何年も試合込みで進め、年ごとのバランスと不整合を出す（計測だけ。合否なし）。
//   node tools/sim-harness/long-run-probe.mjs [年数=10] [種=20261028] [出力JSON]
// 人2人（標準案＝指導者任せ）＋CPU40球団。シーズンの終わり（契約更改が開いた時点）ごとに
// 勝率の散らばり・打撃投手の成績・能力の平均と上位・年齢・名簿・保存の大きさ・不整合を記録する。
// console.error / console.warn と例外も数える。
import './lib/bootstrap.mjs';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createLeague, defaultPhasePlan, submitPhase, advanceLeagueDay } from '../../server/leagueEngine.mjs';
import { touchPresence } from '../../server/social.mjs';
import { splitBundle } from '../../server/storage/snapshotParts.mjs';
import { projectLeague } from '../../server/projection.mjs';
import { squadStrength } from '../../src/online/tradeSearch.js';

const YEARS = Number(process.argv[2] || 10);
const SEED = Number(process.argv[3] || 20261028);
const OUT = process.argv[4] || null;
const issues = new Map(); // 文 → 回数
const note = (kind, msg) => { const k = `${kind}: ${String(msg).slice(0, 300)}`; issues.set(k, (issues.get(k) || 0) + 1); };
const origLog = console.log;
console.error = (...a) => note('console.error', a.map(String).join(' '));
console.warn = (...a) => note('console.warn', a.map(String).join(' '));
const quiet = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = origLog; } };
const out = (...a) => origLog(...a);

let now = new Date('2026-10-28T00:00:00Z');
const league = quiet(() => createLeague({ seed: SEED, members: [{ userId: 'a' }, { userId: 'b' }], now: now.toISOString() }));
const startYear = league.season.year;
const humans = () => new Set(league.members.map((m) => m.teamName));
const names = () => league.season.settings.teamNames;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const avg = (a) => (a.length ? sum(a) / a.length : NaN);
const sd = (a) => { const m = avg(a); return Math.sqrt(avg(a.map((x) => (x - m) ** 2))); };
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const r3 = (x) => Math.round(x * 1000) / 1000;
const r1 = (x) => Math.round(x * 10) / 10;
const isP = (p) => p.position === 'pitcher';

function scanNumbers(obj, path, found) {
  if (obj == null) return;
  if (typeof obj === 'number') { if (!Number.isFinite(obj)) found.push(path); return; }
  if (typeof obj !== 'object') return;
  if (found.length > 20) return;
  for (const [k, v] of Object.entries(obj)) scanNumbers(v, `${path}.${k}`, found);
}

function invariants(label) {
  const teams = league.game.teams;
  const seen = new Map();
  for (const name of names()) {
    const t = teams[name];
    if (!t) { note('invariant', `${label} 球団が無い ${name}`); continue; }
    const ps = t.players || [];
    if (ps.length > 28) note('invariant', `${label} 28人超 ${name} ${ps.length}`);
    if (ps.length < 20) note('invariant', `${label} 20人未満 ${name} ${ps.length}`);
    const pitchers = ps.filter(isP).length;
    if (pitchers < 8) note('invariant', `${label} 投手8人未満 ${name} ${pitchers}`);
    if (!ps.some((p) => p.position === 'catcher')) note('invariant', `${label} 捕手なし ${name}`);
    for (const p of ps) {
      const key = p.onlinePlayerId || p.id;
      if (seen.has(p.id)) note('invariant', `${label} 同じ選手idが2球団 ${p.name} ${seen.get(p.id)}/${name}`);
      seen.set(p.id, name);
      const bad = [];
      scanNumbers({ batting: p.batting, physical: p.physical, pitching: p.pitching, fielding: p.fielding, seasonStats: p.seasonStats, careerStats: p.careerStats, age: p.age, fatigue: p.fatigue }, p.name, bad);
      if (bad.length) note('invariant', `${label} 数でない値 ${bad.slice(0, 3).join(',')}`);
      for (const k of ['meet', 'power', 'eye', 'steal', 'bunt']) { const v = p.batting?.[k]; if (v != null && (v < 1 || v > 100)) note('invariant', `${label} 範囲外 batting.${k}=${v}`); }
      for (const k of ['speed', 'arm', 'bodyStamina', 'recovery', 'muscle', 'dexterity']) { const v = p.physical?.[k]; if (v != null && (v < 1 || v > 100)) note('invariant', `${label} 範囲外 physical.${k}=${v}`); }
      if (p.fielding?.defense != null && (p.fielding.defense < 1 || p.fielding.defense > 100)) note('invariant', `${label} 範囲外 defense=${p.fielding.defense}`);
      for (const k of ['control', 'spinRate']) { const v = p.pitching?.[k]; if (isP(p) && v != null && (v < 1 || v > 100)) note('invariant', `${label} 範囲外 pitching.${k}=${v}`); }
      if (isP(p) && p.pitching?.stamina != null && (p.pitching.stamina < 1 || p.pitching.stamina > 200)) note('invariant', `${label} 範囲外 stamina=${p.pitching.stamina}`);
      if (isP(p) && p.pitching?.velocity != null && (p.pitching.velocity < 100 || p.pitching.velocity > 170)) note('invariant', `${label} 範囲外 velocity=${p.pitching.velocity}`);
      if (p.age < 15 || p.age > 45) note('invariant', `${label} 年齢 ${p.age}`);
      if (p.fatigue != null && (p.fatigue < 0 || p.fatigue > 200)) note('invariant', `${label} 疲労 ${p.fatigue} ${name}${humans().has(name) ? '(人)' : ''} ${p.name} ${p.position} 先発${p.isStarter ? '○' : '×'} 試合${p.seasonStats?.batting?.games ?? '-'}/${p.seasonStats?.pitching?.games ?? '-'}`);
      for (const side of ['batting', 'pitching']) for (const [k, v] of Object.entries(p.seasonStats?.[side] || {})) if (typeof v !== 'number') note('invariant', `${label} 成績が数でない ${side}.${k}=${JSON.stringify(v)?.slice(0, 40)}`);
      const b = p.seasonStats?.batting; if (b && b.hits > b.atBats) note('invariant', `${label} 安打>打数 ${p.name}`);
      if (b && b.homeruns > b.hits) note('invariant', `${label} 本塁打>安打 ${p.name}`);
      const pp = p.seasonStats?.pitching; if (pp && pp.earnedRuns > pp.runsAllowed) note('invariant', `${label} 自責>失点 ${p.name}`);
      if (!key) note('invariant', `${label} onlinePlayerId なし ${p.name}`);
    }
  }
}

function sizes() {
  const { core, parts } = splitBundle({ league, sessions: {} });
  const gz = (v) => Math.round(gzipSync(JSON.stringify(v ?? null)).length / 1024);
  const kb = (v) => Math.round(Buffer.byteLength(JSON.stringify(v ?? null)) / 1024);
  const o = { coreKB: kb(core), coreGz: gz(core) };
  for (const [k, v] of Object.entries(parts)) { o[`${k}KB`] = kb(v); o[`${k}Gz`] = gz(v); }
  try { const view = quiet(() => projectLeague({ league, sessions: {} }, 'a', null, null)); o.viewKB = kb(view); o.viewGz = gz(view); } catch (e) { note('exception', `projectLeague ${e.message}`); }
  return o;
}

function seasonSnapshot() {
  const hs = humans();
  const teams = league.game.teams;
  const byLeague = {};
  for (const def of league.teams) (byLeague[def.league] ||= []).push(def.name);
  const st = new Map(league.season.standings.map((s) => [s.team, s]));
  const leagues = {};
  for (const [lg, ns] of Object.entries(byLeague)) {
    const rows = ns.map((n) => st.get(n)).filter(Boolean);
    const wr = rows.map((s) => s.wins / Math.max(1, s.wins + s.losses));
    const top = rows.slice().sort((a, b) => b.wins / (b.wins + b.losses) - a.wins / (a.wins + a.losses))[0];
    leagues[lg] = { teams: rows.length, games: avg(rows.map((s) => s.wins + s.losses + (s.draws || 0))), wrSd: r3(sd(wr)), wrMax: r3(Math.max(...wr)), wrMin: r3(Math.min(...wr)), first: top?.team, humans: rows.filter((s) => hs.has(s.team)).map((s) => ({ team: s.team, w: s.wins, l: s.losses, d: s.draws || 0 })) };
    const g = rows.map((s) => s.wins + s.losses + (s.draws || 0));
    if (Math.max(...g) - Math.min(...g) > 2) note('invariant', `y${league.season.year} 部${lg} 試合数がそろわない ${Math.min(...g)}〜${Math.max(...g)}`);
  }
  // 成績（42球団の全選手）
  let ab = 0, h = 0, d2 = 0, d3 = 0, hr = 0, bb = 0, so = 0, hbp = 0, sb = 0, cs = 0, sf = 0;
  let ip = 0, er = 0, pk = 0, pbb = 0, phr = 0, ph = 0, games = 0;
  const qualBat = [], qualPit = [];
  const playedGames = avg(names().map((n) => { const s = st.get(n); return s ? s.wins + s.losses + (s.draws || 0) : 0; }));
  for (const n of names()) for (const p of teams[n]?.players || []) {
    const b = p.seasonStats?.batting; const q = p.seasonStats?.pitching;
    if (b) { ab += b.atBats || 0; h += b.hits || 0; d2 += b.doubles || 0; d3 += b.triples || 0; hr += b.homeruns || 0; bb += b.walks || 0; so += b.strikeouts || 0; hbp += b.hitByPitch || 0; sb += b.stolenBases || 0; cs += b.caughtStealing || 0; sf += b.sacrificeFlies || 0;
      const pa = b.atBats + b.walks + (b.hitByPitch || 0);
      if (pa >= 3.1 * playedGames) qualBat.push({ name: p.name, team: n, avg: b.hits / b.atBats, hr: b.homeruns, age: p.age }); }
    if (q) { ip += q.inningsPitched || 0; er += q.earnedRuns || 0; pk += q.strikeouts || 0; pbb += q.walks || 0; phr += q.homeruns || 0; ph += q.hits || 0; games += q.games || 0;
      if ((q.inningsPitched || 0) / 3 >= playedGames) qualPit.push({ name: p.name, team: n, era: (q.earnedRuns * 27) / q.inningsPitched, w: q.wins }); }
  }
  const inn = ip / 3; // ⚠ inningsPitched はアウト数
  const totalGames = sum(names().map((n) => { const s = st.get(n); return s ? s.wins + s.losses + (s.draws || 0) : 0; })) / 2;
  const stats = {
    avg: r3(h / ab), obp: r3((h + bb + hbp) / (ab + bb + hbp + sf)), slg: r3((h + d2 + 2 * d3 + 3 * hr) / ab),
    hrPerGame: r3(hr / totalGames / 2), runsPerTeamGame: r3((er / 0.9) / totalGames / 2), era: r1(er * 9 / inn * 100) / 100,
    k9: r1(pk * 9 / inn), bb9: r1(pbb * 9 / inn), sbPerGame: r3(sb / totalGames / 2), sbRate: r3(sb / Math.max(1, sb + cs)),
    topAvg: qualBat.sort((a, b) => b.avg - a.avg).slice(0, 3).map((x) => `${x.name}(${x.team.slice(0, 2)},${x.age}) ${x.avg.toFixed(3)}`),
    topHr: qualBat.slice().sort((a, b) => b.hr - a.hr).slice(0, 3).map((x) => `${x.name} ${x.hr}`),
    bestEra: qualPit.sort((a, b) => a.era - b.era).slice(0, 3).map((x) => `${x.name} ${x.era.toFixed(2)}`),
    qualifiedBatters: qualBat.length, qualifiedPitchers: qualPit.length,
  };
  // 能力（42球団）
  const all = names().flatMap((n) => (teams[n]?.players || []).map((p) => ({ p, n })));
  const bats = all.filter(({ p }) => !isP(p)).map(({ p }) => p), pits = all.filter(({ p }) => isP(p)).map(({ p }) => p);
  const ab_ = (arr, f) => { const v = arr.map(f).filter((x) => x != null); return { avg: r1(avg(v)), p90: pct(v, 0.9), max: Math.max(...v), n90: v.filter((x) => x >= 90).length }; };
  const abilities = {
    meet: ab_(bats, (p) => p.batting?.meet), power: ab_(bats, (p) => p.batting?.power), eye: ab_(bats, (p) => p.batting?.eye),
    speed: ab_(bats, (p) => p.physical?.speed), defense: ab_(bats, (p) => p.fielding?.defense), arm: ab_(bats, (p) => p.physical?.arm),
    velocity: ab_(pits, (p) => p.pitching?.velocity), control: ab_(pits, (p) => p.pitching?.control), stamina: ab_(pits, (p) => p.pitching?.stamina),
    spin: ab_(pits, (p) => p.pitching?.spinRate),
  };
  // 部ごとの戦力（squadStrength）
  const strength = {};
  for (const [lg, ns] of Object.entries(byLeague)) { const v = ns.map((n) => squadStrength(teams[n]?.players || [])); strength[lg] = { avg: r1(avg(v)), min: r1(Math.min(...v)), max: r1(Math.max(...v)) }; }
  const humanStrength = [...hs].map((n) => ({ team: n, lg: league.teams.find((t) => t.name === n)?.league, s: r1(squadStrength(teams[n]?.players || [])) }));
  const ages = all.map(({ p }) => p.age);
  const ageBins = {}; for (const a of ages) { const b = a <= 22 ? '〜22' : a <= 26 ? '23-26' : a <= 30 ? '27-30' : a <= 34 ? '31-34' : '35〜'; ageBins[b] = (ageBins[b] || 0) + 1; }
  const roster = names().map((n) => teams[n]?.players?.length || 0);
  return { year: league.season.year, leagues, stats, abilities, strength, humanStrength, age: { avg: r1(avg(ages)), max: Math.max(...ages), bins: ageBins }, roster: { min: Math.min(...roster), max: Math.max(...roster), avg: r1(avg(roster)) }, players: all.length };
}

function teamDiag(n) {
  const t = league.game.teams[n]; const ps = t?.players || [];
  const s = league.season.standings.find((x) => x.team === n) || {};
  const rot = t?.pitchingRotation || {};
  const starters = ps.filter((p) => p.isStarter);
  const bat = (p) => p.seasonStats?.batting || {};
  return { team: n, human: humans().has(n), w: s.wins, l: s.losses, players: ps.length, pitchers: ps.filter(isP).length, catchers: ps.filter((p) => p.position === 'catcher').length,
    starters: starters.length, pitcherStarters: starters.filter(isP).length, rotation: (rot.starters || []).length, rotationMissing: (rot.starters || []).filter((id) => !ps.some((p) => p.id === id)).length,
    closer: rot.closer ? ps.some((p) => p.id === rot.closer) : null, avgFatigue: r1(avg(ps.map((p) => p.fatigue || 0))), maxFatigue: Math.max(0, ...ps.map((p) => p.fatigue || 0)),
    strength: r1(squadStrength(ps)), runs: sum(ps.map((p) => (bat(p).hits || 0))), teamAvg: r3(sum(ps.map((p) => bat(p).hits || 0)) / Math.max(1, sum(ps.map((p) => bat(p).atBats || 0)))),
    era: r1(sum(ps.map((p) => p.seasonStats?.pitching?.earnedRuns || 0)) * 27 / Math.max(1, sum(ps.map((p) => p.seasonStats?.pitching?.inningsPitched || 0))) * 100) / 100,
    topPA: ps.filter((p) => !isP(p)).map((p) => ({ n: p.name, pa: (bat(p).atBats || 0) + (bat(p).walks || 0), pos: p.position, meet: p.batting?.meet, power: p.batting?.power })).sort((a, b) => b.pa - a.pa).slice(0, 9).map((x) => `${x.pos}${x.meet}/${x.power}:${x.pa}`).join(' '),
    topIP: ps.filter(isP).map((p) => ({ ip: Math.round((p.seasonStats?.pitching?.inningsPitched || 0) / 3), v: p.pitching?.velocity, c: p.pitching?.control, st: p.pitching?.stamina })).sort((a, b) => b.ip - a.ip).slice(0, 6).map((x) => `${x.v}/${x.c}/${x.st}:${x.ip}`).join(' ') };
}

const years = [];
const offseasons = [];
let days = 0, lastPhase = null;
const t0 = Date.now();
let tYear = Date.now();
while (days < 20000) {
  if (league.status === 'waiting' && league.phase) {
    const phase = league.phase;
    if (phase.kind === 'contract' && lastPhase !== phase.id) {
      invariants(`y${league.season.year} 終わり`);
      const snap = seasonSnapshot();
      snap.size = sizes();
      snap.history = { champion: null };
      snap.seconds = Math.round((Date.now() - tYear) / 1000);
      const worst = Object.values(snap.leagues).map((l) => league.season.standings.filter((x) => league.teams.find((t) => t.name === x.team)?.league === Object.keys(snap.leagues).find((k) => snap.leagues[k] === l)).sort((a, b) => a.wins / (a.wins + a.losses) - b.wins / (b.wins + b.losses))[0]?.team);
      snap.teams = [...new Set([...humans(), ...worst.filter(Boolean)])].map(teamDiag);
      out(JSON.stringify(snap.teams));
      if (process.env.DUMP && league.season.year >= startYear + YEARS - 1) writeFileSync(process.env.DUMP, JSON.stringify(league));
      tYear = Date.now();
      years.push(snap);
      out(`\n=== ${snap.year}年 終わり（${snap.seconds}秒） ===`);
      out(JSON.stringify({ leagues: snap.leagues, stats: snap.stats }, null, 0));
      out(JSON.stringify({ abilities: snap.abilities, strength: snap.strength, humanStrength: snap.humanStrength, age: snap.age, roster: snap.roster, players: snap.players }));
      out(JSON.stringify(snap.size));
      if (OUT) writeFileSync(OUT, JSON.stringify({ seed: SEED, years, offseasons, issues: Object.fromEntries(issues) }, null, 1));
    }
    lastPhase = phase.id;
    for (const m of league.members) {
      try { quiet(() => submitPhase(league, m.userId, { phaseId: phase.id, plan: defaultPhasePlan(league, m.teamName), ready: true }, now.toISOString())); }
      catch (e) { note('exception', `submitPhase ${phase.kind} ${e.message}`); }
    }
    if (league.phase?.id === phase.id && league.status === 'waiting') { note('stuck', `手続き ${phase.kind} が進まない`); break; }
    if (phase.kind === 'offseason' || league.offseasonResults?.year !== offseasons.at(-1)?.year) {
      const h = league.history.at(-1);
      if (h && offseasons.at(-1)?.year !== h.year) {
        offseasons.push({ year: h.year, champion: h.playoffChampion, moves: (league.notices.find((x) => x.type === 'promotion' && x.year === h.year)?.moves || []).length });
        invariants(`y${league.season.year} 年度更新の後`);
      }
    }
    continue;
  }
  if (league.season.year >= startYear + YEARS) break;
  now = new Date(now.getTime() + 4 * 3600000);
  for (const m of league.members) touchPresence(league, m.userId, now.toISOString());
  try { quiet(() => advanceLeagueDay(league, `long:${days}`, now.toISOString())); }
  catch (e) { note('exception', `advanceLeagueDay ${league.season.year}/${league.season.currentDate?.month}/${league.season.currentDate?.day} ${e.stack?.split('\n').slice(0, 3).join(' | ')}`); if (issues.size > 200) break; now = new Date(now.getTime() + 3600000); }
  days++;
  const h = league.history.at(-1);
  if (h && offseasons.at(-1)?.year !== h.year) {
    offseasons.push({ year: h.year, champion: h.playoffChampion, moves: (league.notices.find((x) => x.type === 'promotion' && x.year === h.year)?.moves || []).length });
    invariants(`y${league.season.year} 年度更新の後`);
  }
}
out(`\n=== 終わり ${Math.round((Date.now() - t0) / 60000)}分 ${days}回 ===`);
out(JSON.stringify(offseasons));
out(JSON.stringify(sizes()));
for (const [k, v] of issues) out(`${v}× ${k}`);
if (OUT) writeFileSync(OUT, JSON.stringify({ seed: SEED, years, offseasons, finalSize: sizes(), issues: Object.fromEntries(issues) }, null, 1));
