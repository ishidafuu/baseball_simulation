// 戦力の物差しと勝ち数のつながり、人の球団とCPU球団の差を測る（計測だけ。合否なし）。
//   STAFF=advice|delegate|self node tools/sim-harness/probe/strength-win-probe.mjs <種>
// 人2人のリーグをトレードなし・標準案で2年回し、各年の開幕と60日目に全12球団の
// 「持ち場の力」（`squadStrength` とその内訳）と、実際に使っている打順・ローテの能力を写し、
// 年の終わりに勝敗と得失点を出す。最後に1行 `RESULT {...}`。
// STAFF は人の球団の任せ方（全分野）。既定 advice は画面の既定（意見を聞く）と同じ。
import '../lib/bootstrap.mjs';
import {
  createLeague, defaultPhasePlan, submitPhase, advanceLeagueDay, loadLeagueWorld,
} from '../../../server/leagueEngine.mjs';
import { setStaffModes } from '../../../server/coachEngine.mjs';
import { STAFF_AREA_KEYS } from '../../../src/online/coaches.js';
import { TEAMS_DATA } from '../../../src/teams-data.js';
import {
  squadStrength, rosterTops, pitchingStaff, slotStrength, TRADE_SLOTS,
} from '../../../src/online/tradeSearch.js';

const SEED = Number(process.argv[2] || 11);
const STAFF = process.env.STAFF || 'advice';
let now = new Date('2026-10-28T00:00:00Z');
const league = createLeague({ seed: SEED, members: [{ userId: 'a' }, { userId: 'b' }], now: now.toISOString() });
if (STAFF !== 'advice')
  for (const m of league.members) setStaffModes(league, m.userId, Object.fromEntries(STAFF_AREA_KEYS.map((k) => [k, STAFF])));
const humans = new Set(league.members.map((m) => m.teamName));
const names = () => league.season.settings.teamNames;

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const n = (v) => (Number.isFinite(v) ? v : 0);
const FIELD_KEYS = { catcher: 'catcher', first: 'first', second: 'second', third: 'third', short: 'short', left: 'left', center: 'center', right: 'right' };
const breaking = (p) => (p.pitching?.arsenal || []).filter((a) => a.type !== 'straight');

function snapshot(name) {
  const team = TEAMS_DATA[name];
  const players = team.players;
  const byId = new Map(players.map((p) => [p.id, p]));
  const tops = rosterTops(players);
  const fieldTop = TRADE_SLOTS.filter((s) => !s.pitcher).reduce((a, s) => a + (tops[s.key]?.score || 0), 0);
  const { rotation, pen } = pitchingStaff(players);
  const order = (team.lineupSettings?.battingOrder || []).filter((e) => e.position !== 'pitcher').map((e) => ({ p: byId.get(e.playerId), pos: e.position })).filter((e) => e.p);
  const starters = (team.pitchingRotation?.starters || []).map((id) => byId.get(id)).filter(Boolean);
  const startSet = new Set(starters.map((p) => p.id));
  const usedPen = players.filter((p) => p.position === 'pitcher' && p.isActive !== false && !startSet.has(p.id))
    .sort((a, b) => (slotStrength(b, 'rp') ?? 0) - (slotStrength(a, 'rp') ?? 0)).slice(0, 6);
  const bat = (k) => avg(order.map((e) => n(e.p.batting?.[k])));
  const phys = (k) => avg(order.map((e) => n(e.p.physical?.[k])));
  const pit = (list, k) => avg(list.map((p) => n(p.pitching?.[k])));
  const brk = (list) => avg(list.map((p) => breaking(p).reduce((a, x) => a + n(x.level), 0)));
  const brkMax = (list) => avg(list.map((p) => Math.max(0, ...breaking(p).map((x) => n(x.level)))));
  return {
    squad: +squadStrength(players).toFixed(1),
    fieldTop: +fieldTop.toFixed(1),
    rot: +rotation.reduce((a, p) => a + (slotStrength(p, 'sp') ?? 0), 0).toFixed(1),
    pen: +pen.slice(0, 6).reduce((a, p) => a + (slotStrength(p, 'rp') ?? 0), 0).toFixed(1),
    // 実際に使っている打順（9人ぶんの持ち場の力の合計と能力の平均）
    lineupSlot: +order.reduce((a, e) => a + (slotStrength(e.p, FIELD_KEYS[e.pos] || 'first') ?? 0), 0).toFixed(1),
    lineupN: order.length,
    meet: bat('meet'), power: bat('power'), eye: bat('eye'), speed: phys('speed'), arm: phys('arm'),
    defense: avg(order.map((e) => n(e.p.fielding?.defense))),
    fit: avg(order.map((e) => n(e.p.positionFitness?.[e.pos] ?? 100))),
    // 実際のローテ
    rotN: starters.length,
    rotSlot: +starters.reduce((a, p) => a + (slotStrength(p, 'sp') ?? 0), 0).toFixed(1),
    sVel: pit(starters, 'velocity'), sCtl: pit(starters, 'control'), sSpin: pit(starters, 'spinRate'), sSta: pit(starters, 'stamina'),
    sBrk: brk(starters), sBrkMax: brkMax(starters),
    rVel: pit(usedPen, 'velocity'), rCtl: pit(usedPen, 'control'), rSpin: pit(usedPen, 'spinRate'), rBrk: brk(usedPen), rBrkMax: brkMax(usedPen),
    catLead: avg(order.filter((e) => e.pos === 'catcher').map((e) => n(e.p.catching?.lead))),
    roster: players.length,
  };
}

const years = {};
function snapAll(label) {
  loadLeagueWorld(league);
  const y = league.season.year;
  for (const name of names()) {
    const row = ((years[y] ||= {})[name] ||= { human: humans.has(name) });
    row[label] = snapshot(name);
  }
}
function finishYear() {
  const y = league.season.year;
  const rs = {}, ra = {};
  for (const g of league.season.results || []) {
    const r = g.result;
    if (!r || !Number.isFinite(r.homeScore)) continue;
    rs[g.home] = (rs[g.home] || 0) + r.homeScore; ra[g.home] = (ra[g.home] || 0) + r.awayScore;
    rs[g.away] = (rs[g.away] || 0) + r.awayScore; ra[g.away] = (ra[g.away] || 0) + r.homeScore;
  }
  for (const s of league.season.standings) {
    const row = ((years[y] ||= {})[s.team] ||= { human: humans.has(s.team) });
    Object.assign(row, { w: s.wins, l: s.losses, rs: rs[s.team] || 0, ra: ra[s.team] || 0 });
  }
}

let days = 0, dayInYear = 0, lastYear = null, started = {}, done = false;
while (days < 3000 && !done) {
  if (league.status === 'waiting' && league.phase) {
    const phase = league.phase;
    if (phase.kind === 'contract') {
      finishYear();
      if (league.season.year >= 2) break;
    }
    for (const m of league.members) {
      if (!league.phase || league.phase.id !== phase.id) break;
      submitPhase(league, m.userId, { phaseId: phase.id, plan: defaultPhasePlan(league, m.teamName), ready: true }, now.toISOString());
    }
    continue;
  }
  if (league.season.year !== lastYear) { lastYear = league.season.year; dayInYear = 0; }
  const gamesSoFar = league.season.standings.reduce((a, s) => a + s.wins + s.losses, 0);
  if (!started[lastYear] && gamesSoFar === 0 && league.status === 'running' && !league.phase) {
    // 開幕前（キャンプの後）
  }
  now = new Date(now.getTime() + 4 * 3600000);
  advanceLeagueDay(league, `p:${days}`, now.toISOString());
  days++;
  dayInYear++;
  const g = league.season.standings.reduce((a, s) => a + s.wins + s.losses, 0) / 12;
  if (!started[lastYear] && g >= 1) { snapAll('start'); started[lastYear] = 'start'; }
  else if (started[lastYear] === 'start' && g >= 58) { snapAll('mid'); started[lastYear] = 'mid'; }
}
console.log('RESULT ' + JSON.stringify({ seed: SEED, staff: STAFF + (process.env.LINEUP_FIX ? '+fix' : ''), years }));
