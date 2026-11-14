// アプリの共通部（Kotlin）に写した計算が Web 版と同じ答えを出すかの検査用に、期待値を書き出す。
//   node mobile/tools/expect-logic.mjs > mobile/shared/src/jvmTest/resources/logic-expected.json
import fs from 'node:fs';
import { resolveTraining, playerWish, describeMood, recommendedPolicy } from '../../src/season/trainingPolicy.js';
// 画面（CampPlanner.jsx）と同じ判定を読む（以前は JSX から読めないので写していた）
import { clampMenu, clampSub } from '../../src/online/campMenus.js';
import {
  plannedPicks, weightedRanked, DEFAULT_WEIGHTS, addToPlan, removeFromPlan, shiftInPlan, moveInPlan, planSummary,
  signTotal, wishedCount, minimumShort,
} from '../../src/online/tryoutPlan.js';

const view = JSON.parse(fs.readFileSync(new URL('../shared/src/jvmTest/resources/view-running.json', import.meta.url)));
const roster = view.roster;
const camp = {};
for (const direction of ['sharpen', 'balanced', 'patch'])
  for (const phase of ['physique', 'skill'])
    for (const p of roster) {
      const r = resolveTraining(p, direction, phase);
      camp[`${direction}:${phase}:${p.id}`] = [clampMenu(r.main, p), clampSub(r.sub, p), describeMood(p, direction, phase).tone];
    }
const wish = Object.fromEntries(roster.map((p) => [p.id, playerWish(p)]));
const recommended = Object.fromEntries(roster.map((p) => [p.id, recommendedPolicy(p)]));
// トライアウト: 名簿の後ろ12人を候補、残りを名簿として扱う
const candidates = roster.slice(12);
const have = roster.slice(0, 12);
const ranked = weightedRanked(candidates, DEFAULT_WEIGHTS, have);
const count = 6;
const picks = plannedPicks(ranked, candidates, count, have).map((p) => p.id);
// 希望リストは交渉する10人まで（Web 版の「交渉」の形）。出し入れと並べ替えは配列そのものを動かす
const added = addToPlan(ranked.slice(0, 5), ranked.at(-1));
const removed = removeFromPlan(ranked, ranked[0]);
const shifted = shiftInPlan(ranked, 2, -1);
const moved = moveInPlan(ranked, ranked.at(-1), 0);
// 獲得する人数（無ければ空き枠いっぱい・範囲に収める）と、交渉から取りにいく人数
const totals = [signTotal({}, 7), signTotal({ total: 3 }, 7), signTotal({ total: 20 }, 7), signTotal({ total: -1 }, 7), wishedCount(ranked, 4)];
// 最低限に足りない人数（画面の「獲得後の名簿」）: 投手だけ3人／捕手のいない野手だけ／そろった名簿
const pitchersOnly = roster.filter((p) => p.position === 'pitcher').slice(0, 3);
const noCatcher = roster.filter((p) => p.position !== 'pitcher' && p.position !== 'catcher').slice(0, 9);
const shorts = [minimumShort(pitchersOnly, []), minimumShort(noCatcher, []), minimumShort(roster, [])];
const summary = planSummary(ranked, candidates, count, have);
// 注意（warnings）は獲得したあとの名簿で数える。上の例は野手が足りず注意が出ないので、
// 名簿に投手がそろっている場合（注意なし）と、投手が3人しかいない場合（注意あり）も比べる
const fullStaff = planSummary(weightedRanked(candidates, DEFAULT_WEIGHTS, have), candidates, candidates.length, have);
const fewPitchers = (() => {
  const own = roster.slice(0, 3);
  const pool = roster.slice(11);
  return planSummary(weightedRanked(pool, DEFAULT_WEIGHTS, own), pool, pool.length, own);
})();
const text = JSON.stringify({ camp, wish, recommended, tryout: { ranked, picks, added, removed, shifted, moved, totals, shorts, blocking: summary.blocking, warnings: summary.warnings, warningCases: [fullStaff.warnings, fewPitchers.warnings] } });
// --check: 書き出し済みの期待値が今の Web 版の答えと同じか（CI で、Web 版だけ直したときに気づく）
if (process.argv.includes('--check')) {
  const file = new URL('../shared/src/jvmTest/resources/logic-expected.json', import.meta.url);
  if (fs.readFileSync(file, 'utf8').trim() !== text) {
    console.error('logic-expected.json が古い。node mobile/tools/expect-logic.mjs > mobile/shared/src/jvmTest/resources/logic-expected.json で書き出し直し、アプリの共通部も揃えること');
    process.exit(1);
  }
} else console.log(text);
