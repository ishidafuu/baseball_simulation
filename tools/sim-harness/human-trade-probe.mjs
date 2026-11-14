// 人の球団が「CPUが受けるトレードの中で、自分の戦力がいちばん上がるもの」を選び続けたとき、
// 2年目にどれだけ勝つかを測る（計測だけ。合否なし）。
//   node tools/sim-harness/human-trade-probe.mjs trade 11   … トレードする
//   node tools/sim-harness/human-trade-probe.mjs none 11    … しない（標準案だけ）
// 人2人のリーグを標準案で回し、開幕前・1年目の60日目・2年目の開幕にトレードを探す。
// 2年目に各球団が約73試合を終えたところの順位（* が人の球団）と、持ち場の力の合計
// （`squadStrength`）を出す。1本で約10分。
// 2026-11-14 の実測（種 11/22/33/44、2年目の人の勝率の平均）:
//   値段だけで受けていた頃 .69（最高 .81）／戦力の開きを見る今 .54／トレードしない .53
import './lib/bootstrap.mjs';
import {
  createLeague, defaultPhasePlan, submitPhase, advanceLeagueDay, loadLeagueWorld, captureLeagueWorld, openTrade,
} from '../../server/leagueEngine.mjs';
import { TEAMS_DATA } from '../../src/teams-data.js';
import { tradeJudgeForLeague } from '../../server/tradeJudge.mjs';
import { tradeFactorFor } from '../../server/coachEngine.mjs';
import { cpuTradeDecision, assertTradeAllowed } from '../../src/online/trades.js';
import { squadStrength, tradeStrengthGap } from '../../src/online/tradeSearch.js';

const MODE = process.argv[2] || 'trade'; // trade | none
const SEED = Number(process.argv[3] || 20261028);
const MAX_TRADES = Number(process.argv[4] || 8);
let now = new Date('2026-10-28T00:00:00Z');
const league = createLeague({ seed: SEED, members: [{ userId: 'a' }, { userId: 'b' }], now: now.toISOString() });
const humans = new Set(league.members.map((m) => m.teamName));
const names = () => league.season.settings.teamNames;
const log = (...a) => console.log(...a);

function strengthReport(label) {
  const rows = names().map((n) => ({ n, h: humans.has(n), s: squadStrength(league.game.teams[n].players) }));
  const H = rows.filter((r) => r.h).map((r) => r.s), C = rows.filter((r) => !r.h).map((r) => r.s);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  log(`[${label}] squad human ${H.map((x) => x.toFixed(0)).join('/')} | cpu avg ${avg(C).toFixed(0)} max ${Math.max(...C).toFixed(0)} min ${Math.min(...C).toFixed(0)}`);
}
function standings(label) {
  const st = [...league.season.standings].sort((a, b) => b.winRate - a.winRate);
  log(`[${label}] ` + st.map((s) => `${humans.has(s.team) ? '*' : ''}${s.team.slice(0, 3)} ${s.wins}-${s.losses}`).join(' / '));
}

function tradeRound(label) {
  if (MODE !== 'trade') return;
  loadLeagueWorld(league);
  let made = 0;
  for (const member of league.members) {
    for (let k = 0; k < MAX_TRADES; k++) {
      const mine = TEAMS_DATA[member.teamName].players;
      const base = squadStrength(mine);
      const judge = tradeJudgeForLeague(league);
      const contrib = mine.map((p) => ({ p, drop: base - squadStrength(mine.filter((q) => q.id !== p.id)) }))
        .sort((a, b) => a.drop - b.drop);
      const cheap = contrib.slice(0, 12).map((x) => x.p);
      const offers = [...mine.map((p) => [p])];
      for (let i = 0; i < cheap.length; i++) for (let j = i + 1; j < cheap.length; j++) offers.push([cheap[i], cheap[j]]);
      let best = null;
      for (const to of names()) {
        if (humans.has(to)) continue;
        const theirs = TEAMS_DATA[to].players;
        const factor = tradeFactorFor(league, to);
        for (const want of theirs) {
          for (const offer of offers) {
            if (offer.length === 2 && theirs.length >= 26) continue;
            const after = [...mine.filter((p) => !offer.includes(p)), want];
            const gain = squadStrength(after) - base;
            if (gain <= 1 || (best && gain <= best.gain)) continue;
            try { assertTradeAllowed({ players: mine }, { players: theirs }, offer.map((p) => p.id), [want.id]); } catch { continue; }
            const d = cpuTradeDecision({
              valueOf: (p) => judge.valueOf(p) * factor(p),
              valueOfOwn: (p) => judge.valueOf(p, to) * factor(p),
              lossOf: (ps) => judge.setValuesOf(ps, to).map((v, i) => v * factor(ps[i])),
              strengthGap: (give, get) => tradeStrengthGap(mine, theirs, give, get),
              fromPlayers: mine, toPlayers: theirs, offerIds: offer.map((p) => p.id), wantIds: [want.id],
            });
            if (d.action === 'accept') best = { gain, to, offer, want };
          }
        }
      }
      if (!best) break;
      const r = openTrade(league, member.userId, { to: best.to, offer: best.offer.map((p) => p.id), want: [best.want.id] }, now.toISOString());
      if (r.status !== 'accepted') { log('not accepted?', r); break; }
      made++;
      log(`  trade ${member.teamName.slice(0,3)}: ${best.offer.map((p) => `${p.name}(${p.age})`).join('+')} -> ${best.want.name}(${best.want.age}) from ${best.to.slice(0,3)} gain ${best.gain.toFixed(1)}`);
    }
  }
  league.game = captureLeagueWorld();
  log(`[${label}] trades ${made}`);
}

let days = 0;
let did = { pack: false, mid: false, y2: false };
while (days < 2000) {
  if (league.season.year === 2 && days > 0 && league.status === 'running' && !did.y2) { strengthReport('y2 start before trades'); tradeRound('y2 start'); strengthReport('y2 start after trades'); did.y2 = true; }
  if (league.status === 'waiting' && league.phase) {
    const phase = league.phase;
    if (phase.kind === 'contract') { standings('y1 end'); strengthReport('y1 end'); }
    strengthReport(`before ${phase.kind} y${league.season.year}`);
    for (const m of league.members)
      submitPhase(league, m.userId, { phaseId: phase.id, plan: defaultPhasePlan(league, m.teamName), ready: true }, now.toISOString());
    if (league.phase?.id !== phase.id) strengthReport(`after ${phase.kind} y${league.season.year}`);
    if (phase.kind === 'pack_select' && !did.pack) { strengthReport('after pack'); tradeRound('after pack'); strengthReport('after pack trades'); did.pack = true; }
    continue;
  }
  now = new Date(now.getTime() + 4 * 3600000);
  advanceLeagueDay(league, `p:${days}`, now.toISOString());
  days++;
  if (league.season.year === 1 && days === 60 && !did.mid) { tradeRound('y1 mid'); strengthReport('y1 mid after trades'); did.mid = true; }
  if (league.season.year === 2) {
    const g = league.season.standings.reduce((a, s) => a + s.wins + s.losses, 0) / 12;
    if (g >= 73) { standings('y2 ~73g'); strengthReport('y2 ~73g'); break; }
  }
}
