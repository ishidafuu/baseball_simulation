// 采配・方針の強さの測り（計測だけ・合否なし）。同じ名簿の双子の球団 A/B を作り、A だけ設定を変えて対戦させる。
//   node tools/sim-harness/tactic-strength-probe.mjs [名簿の数=6] [1名簿あたりの試合=200] [名前の一部で絞る]
// ⚠ 方針の数字（`src/online/tactics.js` の `STRATEGY_MODS`）を変えたらこれで勝率を測り直す。
//    いしだの方針「型で強さを変えない」。対照（何も変えない）と比べ、±の幅に収まるかを見る。
// 2026-11-13 の結果（6名簿×200×…）: 打たせて .512・シフト .503・前進 .498・積極 .505・慎重 .485
import './lib/bootstrap.mjs';
import { SRC } from './lib/bootstrap.mjs';
const { TEAMS_DATA, initializeTeamsForCount, initializeAllPitchingRotations } = await import(SRC + '/teams-data.js');
const { generateExpansionRoster } = await import(SRC + '/season/tryoutSystem.js');
const { autoSimulateGame, recoverAllPitcherFatigue } = await import(SRC + '/game/autoSimulation.js');

const ROSTERS = Number(process.argv[2]) || 6;
const GAMES = Number(process.argv[3]) || 200;
const only = process.argv[4];

const CASES = {
  'バント積極': { t: { sacrificeBunt: 'aggressive' } },
  'バント控えめ': { t: { sacrificeBunt: 'avoid' } },
  'スクイズ積極': { t: { squeeze: 'aggressive' } },
  'スクイズ控えめ': { t: { squeeze: 'avoid' } },
  'セーフティ積極': { t: { safetyBunt: 'aggressive' } },
  'セーフティ控えめ': { t: { safetyBunt: 'avoid' } },
  '代打8回から': { t: { pinchHitFrom: 8 } },
  '守備固め9回から': { t: { defenseFrom: 9 } },
  '継投早め': { t: { hook: 'early' } },
  '継投長め': { t: { hook: 'patient' } },
  '先発100球まで': { t: { starterLimit: 100 } },
  '打撃積極': { s: { batting: 'aggressive' } },
  '打撃慎重': { s: { batting: 'patient' } },
  '投球三振狙い': { s: { pitching: 'strikeout' } },
  '投球打たせる': { s: { pitching: 'contact' } },
  '守備シフト': { s: { defense: 'shift' } },
  '守備前進': { s: { defense: 'infield_in' } },
  '走塁積極': { s: { baseRunning: 'aggressive' } },
  '走塁慎重': { s: { baseRunning: 'conservative' } },
  '全部積極(極端)': { t: { sacrificeBunt: 'aggressive', squeeze: 'aggressive', safetyBunt: 'aggressive', hook: 'early', starterLimit: 100 }, s: { batting: 'aggressive', pitching: 'strikeout', baseRunning: 'aggressive' } },
  '全部控えめ(極端)': { t: { sacrificeBunt: 'avoid', squeeze: 'avoid', safetyBunt: 'avoid', pinchHitFrom: 8, defenseFrom: 9, hook: 'patient' }, s: { batting: 'patient', pitching: 'contact', baseRunning: 'conservative' } },
  '最強候補(積極打撃+打たせる)': { s: { batting: 'aggressive', pitching: 'contact' } },
  '最弱候補(慎重打撃+三振狙い+先発100)': { t: { starterLimit: 100 }, s: { batting: 'patient', pitching: 'strikeout' } },
  '何も変えない(対照)': {},
};

function setup(r) {
  initializeTeamsForCount(2);
  const [A, B] = Object.keys(TEAMS_DATA);
  const roster = generateExpansionRoster(1, 26).map(p => ({ ...p, number: p.id }));
  TEAMS_DATA[A].players = roster;
  TEAMS_DATA[B].players = structuredClone(roster).map(p => ({ ...p, id: p.id + 900000, number: p.id + 900000 }));
  initializeAllPitchingRotations();
  return [A, B];
}

const out = [];
for (const [label, c] of Object.entries(CASES)) {
  if (only && !label.includes(only)) continue;
  let w = 0, l = 0, rf = 0, ra = 0;
  for (let r = 0; r < ROSTERS; r++) {
    const [A, B] = setup(r);
    if (process.env.VEL_A) for (const pl of TEAMS_DATA[A].players) if (pl.pitching) pl.pitching.velocity += Number(process.env.VEL_A);
    if (process.env.CTL_A) for (const pl of TEAMS_DATA[A].players) if (pl.pitching) pl.pitching.control += Number(process.env.CTL_A);
    if (c.t) TEAMS_DATA[A].onlineTactics = { ...c.t };
    if (c.s) TEAMS_DATA[A].strategy = { ...c.s };
    for (let g = 0; g < GAMES; g++) {
      if ((g + 1) % 7 === 0) recoverAllPitcherFatigue();
      const home = g % 2 ? A : B, away = g % 2 ? B : A;
      const res = autoSimulateGame(home, away);
      const hs = res?.homeScore ?? res?.score?.home, as = res?.awayScore ?? res?.score?.away;
      const aScore = home === A ? hs : as, bScore = home === A ? as : hs;
      rf += aScore; ra += bScore;
      if (aScore > bScore) w++; else if (aScore < bScore) l++;
      recoverAllPitcherFatigue();
    }
  }
  const pct = w / (w + l);
  const se = Math.sqrt(0.25 / (w + l));
  out.push(label);
  console.log(`${label.padEnd(14, '　')} 勝率 ${pct.toFixed(3)} (±${(2*se).toFixed(3)})  ${w}勝${l}敗  得点/試合 ${(rf/(ROSTERS*GAMES)).toFixed(2)} 失点/試合 ${(ra/(ROSTERS*GAMES)).toFixed(2)}`);
}
