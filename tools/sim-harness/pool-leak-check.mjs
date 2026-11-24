// ============================================================
// プール間の複製検査（「選手が2箇所に居ないこと」）
//
// 【なぜ必要か】選手はプールとチームの間を移る。移した先に足したのに
// **移した元から消し忘れる**と、同じ選手が2箇所に存在し、その後それぞれ
// 独立に歳を取って成長するので「同名で能力だけ違う別人」に見える。
//
// 実際に起きた事故: `processUniversityTeamGraduation` のスカウト推薦入部で
//   reserved.forEach(p => { delete p._universityReserved; ... });          // 先に消す
//   highSchoolPool.players = players.filter(p => p._universityReserved !== teamName);
// と**フラグを消してから、そのフラグで除去**していたため条件が全員 true になり、
// 誰もプールから消えなかった。推薦入部者が高校生プールに残り、その後
// `distributeHighSchoolGraduates` が社会人・独立へも配るので
// **同じ選手が「大学 ＋ 社会人 ＋ 自由契約」の3箇所**に現れた。
// 選手検索で同名3人（器用さ・成長率・左右という**不変量が完全一致**）として発覚。
//
// ⚠ 一般入部の経路は `takenIds` を先に取っていて正しかった。
//    **同じ処理の片方だけ順序が違う**という形なので、両方を検査する。
// ⚠ 除去は id ではなく**オブジェクトの同一性**で行うこと。id はチーム内でしか
//    一意ではない（実測で自リーグ4チーム間に157件の衝突がある）。
// ============================================================

import { bootstrapWorld, TEAMS_DATA } from './lib/world.mjs';
import { Report } from './lib/report.mjs';

bootstrapWorld();
const { highSchoolPool } = await import('../../src/state/schoolPools.js');
const { processUniversityTeamGraduation } = await import('../../src/season/rosterProgression.js');

const uniTeams = {};
let userUni = null;
for (const [n, t] of Object.entries(TEAMS_DATA)) {
  if (t.universityData) { uniTeams[n] = t; if (!userUni) userUni = n; }
}

// 推薦入部を5人予約して年度替わりを回す
const picks = highSchoolPool.players.slice(0, 5);
picks.forEach(p => { p._universityReserved = userUni; });
const before = highSchoolPool.players.length;

const orig = console.log;
console.log = () => {};
processUniversityTeamGraduation(uniTeams, { userTeamName: userUni, settings: { year: 1 } }, 1);
console.log = orig;

const leaked = picks.filter(p => highSchoolPool.players.includes(p));
const enrolled = picks.filter(p => (TEAMS_DATA[userUni].players || []).some(q => q.name === p.name && q.recruitType));

// 世界全体で「同名かつ不変量まで一致」する組が無いか（複製の痕跡）
const all = [];
for (const [tn, t] of Object.entries(TEAMS_DATA)) for (const p of (t.players || [])) all.push({ p, where: tn });
for (const p of (highSchoolPool.players || [])) all.push({ p, where: '高校生プール' });
// ⚠ 不変量は**作った時の乱数そのもの**で比べる。以前は成長率を小数2桁に丸め、左右は
//    置き場の違う `x.throws`（正しくは `physical.throws`）を読んでいて、実際は器用さと丸めた
//    成長率だけだった。同名の別人がたまたま一致し、時々「複製の疑い」で落ちた
const inv = (x) => [x.physical?.dexterity, String(x.growthPotential ?? 0), x.physical?.throws, x.physical?.build, x.bats].join('/');
const byName = new Map();
for (const e of all) {
  if (!byName.has(e.p.name)) byName.set(e.p.name, []);
  byName.get(e.p.name).push(e);
}
let clonePairs = 0;
for (const v of byName.values()) {
  if (v.length < 2) continue;
  for (let i = 0; i < v.length; i++) {
    for (let j = i + 1; j < v.length; j++) if (inv(v[i].p) === inv(v[j].p)) clonePairs++;
  }
}
// 同一オブジェクトが2箇所に登録されていないか
const seen = new Set();
let refDup = 0;
for (const e of all) { if (seen.has(e.p)) refDup++; else seen.add(e.p); }

const r = new Report('プール間の複製検査');
r.info('世界の選手数', `${all.length}人`);
r.info('推薦予約', `${picks.length}人 / 高校生プール ${before}人`);
r.info('  うち大学へ入部', `${enrolled.length}人`);
r.assert('推薦入部者がプールに残らない', leaked.length === 0,
  leaked.length ? `${leaked.length}人が残存: ${leaked.map(p => p.name).join(' / ')}` : '残存0人');
r.assert('同一オブジェクトの二重登録なし', refDup === 0, `${refDup}件`);
r.info('同名グループ', `${[...byName.values()].filter(v => v.length > 1).length}件（同名自体は母集団の大きさから自然に出る）`);
r.assert('同名かつ不変量まで一致する組が無い', clonePairs === 0,
  clonePairs ? `${clonePairs}組（複製の疑い）` : '0組');
r.print();
process.exit(r.passed ? 0 : 1);
