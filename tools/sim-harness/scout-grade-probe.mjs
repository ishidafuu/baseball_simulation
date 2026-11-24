#!/usr/bin/env node
// ============================================================
// 大学推薦スカウトの「おすすめ度」を測る
//
// ① 大学ランクごとに見える帯（`discoverCandidatesFromPool` と同じ切り方）の
//    中央の評価点を投手・野手別に出す → `getUniversityScoutRecommendation` の baseline
// ② 実際に候補リストを作り、おすすめ度 S/A/B/C/D の割合を出す
//
// 使い方: node tools/sim-harness/scout-grade-probe.mjs [回数=10]
// ⚠ 高校生プールの生成や `evaluatePlayerScore` を変えたら必ず走らせること
// ============================================================
import './lib/bootstrap.mjs';
import { SRC } from './lib/bootstrap.mjs';
const { generateHighSchoolClass, balanceRankByPosition } = await import(SRC + '/season/universityPool.js');
const { highSchoolPool } = await import(SRC + '/state/schoolPools.js');
const { evaluatePlayerScore } = await import(SRC + '/game/scoutReport.js');
const { initUniversityScoutList, getUniversityScoutRecommendation } = await import(SRC + '/university/universityScout.js');
const { WORLD_DATA } = await import(SRC + '/corporate/worldData.js');

const N = +process.argv[2] || 10;
const o = console.log; console.log = () => {}; console.warn = () => {};
const BAND_LO = { S: 0.00, A: 0.10, B: 0.22, C: 0.38, D: 0.55 };
const BAND_HI = { S: 0.40, A: 0.58, B: 0.72, C: 0.84, D: 0.96 };
const REP = { S: 85, A: 65, B: 40, C: 20, D: 5 };
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };

const mids = {}; const grades = {};
for (let t = 0; t < N; t++) {
  highSchoolPool.players = generateHighSchoolClass(1, 5000);
  const ranked = balanceRankByPosition(highSchoolPool.players
    .map(p => ({ player: p, ability: evaluatePlayerScore(p), score: evaluatePlayerScore(p) }))
    .sort((a, b) => b.ability - a.ability));
  const n = ranked.length;
  for (const r of ['S', 'A', 'B', 'C', 'D']) {
    const band = ranked.slice(Math.floor(n * BAND_LO[r]), Math.floor(n * BAND_HI[r]));
    const m = (mids[r] ||= { P: [], F: [] });
    m.P.push(med(band.filter(x => x.player.position === 'pitcher').map(x => x.ability)));
    m.F.push(med(band.filter(x => x.player.position !== 'pitcher').map(x => x.ability)));
    WORLD_DATA._universityScout = { candidates: [], recruited: [], initialized: false };
    const cands = initUniversityScoutList({ universityData: { reputation: REP[r] } }, r);
    const g = (grades[r] ||= {});
    for (const c of cands) { const k = getUniversityScoutRecommendation(c, r); g[k] = (g[k] || 0) + 1; }
  }
}
console.log = o;
o('ランク  帯の中央（投手 / 野手）   おすすめ度の割合');
for (const r of ['S', 'A', 'B', 'C', 'D']) {
  const g = grades[r]; const tot = Object.values(g).reduce((a, b) => a + b, 0);
  o(`  ${r}      ${med(mids[r].P).toFixed(0).padStart(3)} / ${med(mids[r].F).toFixed(0).padStart(3)}          ` +
    ['S', 'A', 'B', 'C', 'D'].map(k => `${k} ${((g[k] || 0) / tot * 100).toFixed(0)}%`).join(' / '));
}
