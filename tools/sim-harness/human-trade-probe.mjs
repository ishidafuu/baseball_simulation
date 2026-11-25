// 人の球団が「CPUが受けるトレードの中で、自分の戦力がいちばん上がるもの」を選び続けたとき、
// 2年目にどれだけ勝つかを測る（計測だけ。合否なし）。
//   node tools/sim-harness/human-trade-probe.mjs trade 11   … トレードする
//   node tools/sim-harness/human-trade-probe.mjs none 11    … しない（標準案だけ）
// 人2人のリーグを標準案で回し、開幕前・1年目の60日目・2年目の開幕にトレードを探す。
// 2年目に各球団が約73試合を終えたところの順位（* が人の球団）と、持ち場の力の合計
// （`squadStrength`）を出す。1本で約3分（2026-11-24）。
// 2026-11-14 の実測（種 11/22/33/44、2年目の人の勝率の平均）:
//   値段だけで受けていた頃 .69（最高 .81）／戦力の開きを見る今 .54／トレードしない .53
// 2026-11-24 の実測（CPUの判断をサーバーの `cpuDecisionFor` そのものにした。出番の上乗せ +50%・
//   1人ずつ順に足す数え方・逆提案の測り直しこみ。種 11/22/33/44。1本 約3分）:
//   2年目の人の勝率の平均 .589（.583/.562・.569/.427・.667/.597・.671/.639）、成立したトレード 計148件
//   （1リーグ 34〜39件）／トレードしない（種11だけ）.415。
//   ⚠ それまでのこの道具は出番の上乗せを掛けておらず、サーバーより受ける交換を少なく見ていた
import './lib/bootstrap.mjs';
import {
  createLeague, defaultPhasePlan, submitPhase, advanceLeagueDay, loadLeagueWorld, captureLeagueWorld, openTrade,
  cpuDecisionFor,
} from '../../server/leagueEngine.mjs';
import { TEAMS_DATA } from '../../src/teams-data.js';
import { tradeJudgeForLeague } from '../../server/tradeJudge.mjs';
import { assertTradeAllowed } from '../../src/online/trades.js';
import { squadStrength } from '../../src/online/tradeSearch.js';
import { setStaffModes } from '../../server/coachEngine.mjs';

const MODE = process.argv[2] || 'trade'; // trade | none
const SEED = Number(process.argv[3] || 20261028);
// ⚠ 何が勝ちすぎを生むかを切り分ける試し（TRADE_VARIANT。カンマ区切りで重ねられる）:
//   rounds=pack+mid+y2 … トレードを探す時期（開幕前・1年目60日目・2年目開幕）
//   one   … 1対1だけ（2人で1人を取る交換をしない）
//   cap=N … 1回に1球団あたり最大N件
//   norebuy … 一度動かした選手（出した・取った）をもう動かさない
//   pairlimit=N … 同じCPU球団とは1シーズンにN件まで
const VARIANT = Object.fromEntries((process.env.TRADE_VARIANT || '').split(',').filter(Boolean)
  .map((kv) => { const [k, v] = kv.split('='); return [k, v ?? true]; }));
const ROUNDS = new Set(String(VARIANT.rounds || 'pack+mid+y2').split('+'));
const MAX_TRADES = Number(VARIANT.cap || process.argv[4] || 8);
const touched = new Set();
const pairCount = new Map();
const tradeLog = [];
let now = new Date('2026-10-28T00:00:00Z');
const league = createLeague({ seed: SEED, members: [{ userId: 'a' }, { userId: 'b' }], now: now.toISOString() });
const humans = new Set(league.members.map((m) => m.teamName));
// TRADE_STAFF=delegate: 人の球団のスタメンと投手起用を指導者に任せる（取った選手をその場で使う形に組み直す）
if (process.env.TRADE_STAFF)
  for (const m of league.members) setStaffModes(league, m.userId, { lineup: process.env.TRADE_STAFF, pitching: process.env.TRADE_STAFF });
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

function tradeRound(label, key) {
  if (MODE !== 'trade' || !ROUNDS.has(key)) return;
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
      const movable = (p) => !(VARIANT.norebuy && touched.has(p.id));
      const offers = [...mine.filter(movable).map((p) => [p])];
      const cheapM = cheap.filter(movable);
      if (!VARIANT.one) for (let i = 0; i < cheapM.length; i++) for (let j = i + 1; j < cheapM.length; j++) offers.push([cheapM[i], cheapM[j]]);
      let best = null;
      for (const to of names()) {
        if (humans.has(to)) continue;
        const pk = `${league.season.year}|${member.teamName}|${to}`;
        if (VARIANT.pairlimit && (pairCount.get(pk) || 0) >= Number(VARIANT.pairlimit)) continue;
        const theirs = TEAMS_DATA[to].players;
        for (const want of theirs) {
          if (!movable(want)) continue;
          for (const offer of offers) {
            if (offer.length === 2 && theirs.length >= 26) continue;
            const after = [...mine.filter((p) => !offer.includes(p)), want];
            const gain = squadStrength(after) - base;
            if (gain <= 1 || (best && gain <= best.gain)) continue;
            try { assertTradeAllowed({ players: mine }, { players: theirs }, offer.map((p) => p.id), [want.id]); } catch { continue; }
            // ⚠ CPUの判断は**サーバーの関数そのもの**（`cpuDecisionFor`。出番の上乗せ・まとめて抜けた穴・
            //    戦力の開き）。値段の式をここに写すと、サーバーを変えたときに測るものが食い違う
            const d = cpuDecisionFor(league, TEAMS_DATA[member.teamName], to, offer.map((p) => p.id), [want.id], judge);
            if (d.action === 'accept') best = { gain, to, offer, want, cpuBase: squadStrength(theirs) };
          }
        }
      }
      if (!best) break;
      const r = openTrade(league, member.userId, { to: best.to, offer: best.offer.map((p) => p.id), want: [best.want.id] }, now.toISOString());
      if (r.status !== 'accepted') { log('not accepted?', r); break; }
      made++;
      if (process.env.TRADE_DEBUG) {
        // 取った選手が打順・ローテに入ったか（人の球団の編成は、成り立つ限り残る）
        const t = TEAMS_DATA[member.teamName];
        const inOrder = (t.lineupSettings?.battingOrder || []).some((e) => e.playerId === best.want.id && e.position !== 'pitcher');
        const inRot = (t.pitchingRotation?.starters || []).includes(best.want.id);
        const role = best.want.position === 'pitcher' ? (inRot ? '先発' : '救援') : (inOrder ? 'スタメン' : '控え');
        log(`    取った ${best.want.name}: ${role}`);
      }
      for (const p of [...best.offer, best.want]) touched.add(p.id);
      const pk = `${league.season.year}|${member.teamName}|${best.to}`;
      pairCount.set(pk, (pairCount.get(pk) || 0) + 1);
      const toAfter = squadStrength(TEAMS_DATA[best.to].players);
      tradeLog.push({ round: key, team: member.teamName, to: best.to, n: best.offer.length, gain: +best.gain.toFixed(1),
        give: best.offer.map((p) => ({ age: p.age, pos: p.position, ovr: p.overall ?? null })), want: { age: best.want.age, pos: best.want.position },
        cpuGain: +(toAfter - best.cpuBase).toFixed(1) });
      log(`  trade ${member.teamName.slice(0,3)}: ${best.offer.map((p) => `${p.name}(${p.age})`).join('+')} -> ${best.want.name}(${best.want.age}) from ${best.to.slice(0,3)} gain ${best.gain.toFixed(1)}`);
    }
  }
  league.game = captureLeagueWorld();
  log(`[${label}] trades ${made}`);
}

let y1rec = null;
// 人の球団の勝率（と全体の得失点）
const record = () => Object.fromEntries(league.season.standings.filter((s) => humans.has(s.team))
  .map((s) => [s.team, { w: s.wins, l: s.losses, pct: +(s.wins / Math.max(1, s.wins + s.losses)).toFixed(3) }]));
let days = 0;
let did = { pack: false, mid: false, y2: false };
while (days < 2000) {
  if (league.season.year === 2 && days > 0 && league.status === 'running' && !did.y2) { strengthReport('y2 start before trades'); tradeRound('y2 start', 'y2'); strengthReport('y2 start after trades'); did.y2 = true; }
  if (league.status === 'waiting' && league.phase) {
    const phase = league.phase;
    if (phase.kind === 'contract') { standings('y1 end'); strengthReport('y1 end'); y1rec = record(); }
    strengthReport(`before ${phase.kind} y${league.season.year}`);
    // ⚠ **1人出すごとに手続きが閉じていないか見る**。最後の1人が決めた瞬間に処理されて
    //    `league.phase` が null になるので、次の人の `defaultPhasePlan` が落ちていた
    //    （この計測は `check` に入っていないので、engine が変わったあと腐ったまま残っていた）
    for (const m of league.members) {
      if (!league.phase || league.phase.id !== phase.id) break;
      submitPhase(league, m.userId, { phaseId: phase.id, plan: defaultPhasePlan(league, m.teamName), ready: true }, now.toISOString());
    }
    if (league.phase?.id !== phase.id) strengthReport(`after ${phase.kind} y${league.season.year}`);
    if (phase.kind === 'pack_select' && !did.pack) { strengthReport('after pack'); tradeRound('after pack', 'pack'); strengthReport('after pack trades'); did.pack = true; }
    continue;
  }
  now = new Date(now.getTime() + 4 * 3600000);
  advanceLeagueDay(league, `p:${days}`, now.toISOString());
  days++;
  if (league.season.year === 1 && days === 60 && !did.mid) { tradeRound('y1 mid', 'mid'); strengthReport('y1 mid after trades'); did.mid = true; }
  if (league.season.year === 2) {
    const g = league.season.standings.reduce((a, s) => a + s.wins + s.losses, 0) / 12;
    if (g >= 73) {
      standings('y2 ~73g'); strengthReport('y2 ~73g');
      console.log('RESULT ' + JSON.stringify({ mode: MODE, variant: process.env.TRADE_VARIANT || '', seed: SEED, y1: y1rec, y2: record(), trades: tradeLog }));
      break;
    }
  }
}
