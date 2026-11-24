// VALUE_DIST（群ごとの平均・σ）と BAND_SD（群×年齢帯のσ）を実ワールドで測る
// 母集団: TEAMS_DATA の全選手 ＋ 高校生プール ＋ 大学プール（playerValue.js の注記どおり）
// 使い方: node tools/sim-harness/value-dist-probe.mjs [年数=3]
import './lib/bootstrap.mjs';
import { SRC } from './lib/bootstrap.mjs';
const { bootstrapWorld, advanceYear, TEAMS_DATA } = await import('./lib/world.mjs');
const { draftAbilityScore } = await import(SRC + '/season/yearProgressionSystem.js');
const { valueGroup, AGE_BAND } = await import(SRC + '/game/playerValue.js');
const { generateHighSchoolClass } = await import(SRC + '/season/universityPool.js');
const { highSchoolPool, universityPool } = await import(SRC + '/state/schoolPools.js');
const Y = +process.argv[2] || 3;
const o = console.log; console.log = () => {}; console.warn = () => {};
let { seasonData } = bootstrapWorld();
for (let y = 0; y < Y; y++) seasonData = advanceYear(seasonData).nextSeasonData;
console.log = o;
const players = [];
for (const t of Object.values(TEAMS_DATA)) players.push(...(t.players || []));
let hs = highSchoolPool.players?.length ? highSchoolPool.players : generateHighSchoolClass(Y + 1, 5000);
players.push(...hs);
for (const c of Object.values(universityPool)) if (Array.isArray(c)) players.push(...c.map(e => e.player));
const acc = {};
for (const p of players) {
  const { main, sub } = draftAbilityScore(p);
  const raw = main + sub * 0.6;
  const g = valueGroup(p), b = AGE_BAND(p.age);
  (acc[g] ||= []).push(raw); (acc[g + '|' + b] ||= []).push(raw);
}
const ms = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); return [m, sd]; };
for (const k of Object.keys(acc).sort()) { const [m, sd] = ms(acc[k]); o(k.padEnd(10), 'n', acc[k].length, 'mean', m.toFixed(0), 'sd', sd.toFixed(0)); }
