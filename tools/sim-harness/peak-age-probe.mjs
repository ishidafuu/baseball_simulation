// ============================================================
// 「投手と野手はどちらが完成が遅いか」を測る
//
// ⚠ CLAUDE.md「若い投手は同年代の野手より総合力が低く出る（仕様）」の表は
//    **ある時点の断面**（各年齢帯に居る選手の平均総合力）。断面は
//    「誰がその年齢帯に残っているか」に汚染される（ドラフトで抜ける・
//    戦力外になる・進路で分かれる）ので、完成年齢の証拠にはならない。
//    ここでは同じ母集団（実ワールド）で **断面と縦断の両方**を出して比べる。
// ============================================================
import { SRC } from './lib/bootstrap.mjs';
import { bootstrapWorld, TEAMS_DATA } from './lib/world.mjs';

const { applyCorporatePlayerGrowth } = await import(SRC + '/season/growthSystem.js');
const { calcPlayerOverall } = await import(SRC + '/season/dispatchSystem.js');

bootstrapWorld();

const isP = (p) => p.position === 'pitcher';
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// ---------- ① 断面（CLAUDE.md の表と同じ見方） ----------
const bands = [[18,20,'18-20'],[21,22,'21-22'],[23,25,'23-25'],[26,28,'26-28'],[29,31,'29-31'],[32,99,'32+  ']];
const snap = { P: {}, F: {} };
let nTeams = 0, nPlayers = 0;
for (const team of Object.values(TEAMS_DATA)) {
  if (!team?.players?.length) continue;
  nTeams++;
  for (const p of team.players) {
    nPlayers++;
    const k = isP(p) ? 'P' : 'F';
    const b = bands.find(([lo, hi]) => p.age >= lo && p.age <= hi);
    if (!b) continue;
    (snap[k][b[2]] ||= []).push(calcPlayerOverall(p));
  }
}
console.log(`\n■ ① 断面（実ワールド ${nTeams}チーム / ${nPlayers}人）— CLAUDE.md の表と同じ見方`);
console.log('─'.repeat(56));
console.log('  年齢帯      投手    野手   野手-投手');
for (const [, , lab] of bands) {
  const p = mean(snap.P[lab] || []), f = mean(snap.F[lab] || []);
  const d = f - p;
  console.log(`  ${lab}  ${p.toFixed(1).padStart(8)}${f.toFixed(1).padStart(8)}` +
    `${((d >= 0 ? '+' : '') + d.toFixed(1)).padStart(9)}`);
}

// ---------- ② 縦断（同じ選手を追う） ----------
// ⚠ 社会人ロスターの18〜20歳は数が少ないので、**高校生プールを社会人チームへ
//    入れて18歳から追う**。「18歳で入ってきた選手がいつ完成するか」がここでの問い。
const { highSchoolPool } = await import(SRC + '/state/schoolPools.js');
const pool = (highSchoolPool.players || []).slice(0, 1200);
const cohort = [];
const growTeams = {};
const PER = 24;
for (let i = 0; i < pool.length; i += PER) {
  const name = `COHORT_${i / PER}`;
  const players = pool.slice(i, i + PER).map(p => JSON.parse(JSON.stringify(p)));
  if (players.length < PER) break;
  for (const p of players) { p.age = 18; p._pk = `${name}:${p.id}`; cohort.push(p); }
  growTeams[name] = { name, players, corporateData: { type: 'corporate', rank: 'B' } };
}
const track = new Map(cohort.map(p => [p._pk, { pos: isP(p) ? 'P' : 'F', from: p.age, by: {} }]));
for (let step = 0; step < 24; step++) {
  for (const p of cohort) {
    const t = track.get(p._pk);
    if (t) t.by[p.age] = calcPlayerOverall(p);
  }
  applyCorporatePlayerGrowth(growTeams);
  for (const team of Object.values(growTeams)) for (const p of team.players) p.age++;
}

const res = { P: { peak: [], done: [], gain: [] }, F: { peak: [], done: [], gain: [] } };
for (const { pos, by } of track.values()) {
  const ages = Object.keys(by).map(Number).sort((a, b) => a - b);
  const vals = ages.map(a => by[a]);
  const top = Math.max(...vals), base = vals[0];
  if (top - base < 1) continue;             // 伸びない選手はピークが定義できない
  res[pos].peak.push(ages[vals.indexOf(top)]);
  const tgt = base + (top - base) * 0.95;   // 「完成」＝生涯の伸びしろの95%に達した年齢
  res[pos].done.push(ages[vals.findIndex(v => v >= tgt)]);
  res[pos].gain.push(top - base);
}
console.log(`\n■ ② 縦断（同じ選手を18〜20歳から40歳超まで追う・社会人と独立）`);
console.log('─'.repeat(56));
console.log('            人数   ピーク年齢   完成年齢(伸びの95%)   生涯の伸び');
for (const k of ['P', 'F']) {
  console.log(`  ${k === 'P' ? '投手' : '野手'}    ${String(res[k].peak.length).padStart(5)}` +
    `${(med(res[k].peak) + '歳').padStart(11)}${(med(res[k].done) + '歳').padStart(17)}` +
    `${mean(res[k].gain).toFixed(1).padStart(14)}`);
}
const dist = (k) => {
  const c = {};
  for (const a of res[k].done) { const b = a <= 22 ? '〜22' : a <= 25 ? '23-25' : a <= 28 ? '26-28' : a <= 31 ? '29-31' : '32〜'; c[b] = (c[b] || 0) + 1; }
  return ['〜22','23-25','26-28','29-31','32〜'].map(b => `${b} ${String(Math.round((c[b]||0)/res[k].done.length*100)).padStart(2)}%`).join(' / ');
};
console.log('\n  完成年齢の分布');
console.log('    投手  ', dist('P'));
console.log('    野手  ', dist('F'));

// ---------- ③ 「使えるようになる年齢」= 一軍定着58 / レギュラー68 を超えた年齢 ----------
// npbCareer の絶対値の床（FIRST_TEAM_THRESHOLD 58 / REGULAR_THRESHOLD 68）を借りる
const cross = { P: { 58: [], 68: [] }, F: { 58: [], 68: [] } };
const reach = { P: { 58: 0, 68: 0, n: 0 }, F: { 58: 0, 68: 0, n: 0 } };
for (const { pos, by } of track.values()) {
  const ages = Object.keys(by).map(Number).sort((a, b) => a - b);
  reach[pos].n++;
  for (const th of [58, 68]) {
    const a = ages.find(x => by[x] >= th);
    if (a != null) { cross[pos][th].push(a); reach[pos][th]++; }
  }
}
console.log('\n■ ③ 到達年齢（総合力が閾値を初めて超えた年齢）');
console.log('─'.repeat(56));
console.log('            一軍定着58 到達率 / 年齢(中央)    レギュラー68 到達率 / 年齢');
for (const k of ['P', 'F']) {
  const r = reach[k];
  const f = (th) => `${String(Math.round(r[th] / r.n * 100)).padStart(3)}% / ${r[th] ? med(cross[k][th]) + '歳' : '—'}`;
  console.log(`  ${k === 'P' ? '投手' : '野手'}         ${f(58).padStart(14)}            ${f(68).padStart(14)}`);
}
console.log();
