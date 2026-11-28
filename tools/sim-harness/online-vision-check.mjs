// 監督の方針を球団の行動につなぐ（先方要望 #6・#7）の検査。
//   node tools/sim-harness/online-vision-check.mjs
//
// 1. 球団の穴（`teamNeeds`）: 同じ名簿どうしなら穴は0。足の遅い球団は「走力」が足りない
// 2. 育成の的（`campAim`）: 穴と型の好みで選ぶ・覚えた的を続ける・年数と上限で選び直す・乱数を引かない
// 3. キャンプの案（`campPlanFor`）: 的のある選手は方向が的に合い、メイン練習が的の練習。
//    1クール回すと選手が的を覚え（`campAim`）、翌年の案も同じ的を続ける
// 4. 時間軸（`shouldHorizon`・`followHorizon`）: 弱い球団は育成・強い球団は勝負・主力が高齢で
//    五分より悪ければ育成。こだわりで寄るまでの年数が変わり、寄るのは1年に1段
// 5. 年度更新（`coachOffseason`）: CPU球団の指導者だけが寄る（人の球団の指導者は動かさない）
// 6. チームの方針（`teamPolicy`・先方要望 #9）: 監督の型から6行。人の球団は注つき、監督不在はバランス型。
//    ビュー（自球団 `staff.policy`・他球団の `projectTeamInfo`）に載る。
//    積極補強の監督ほどCPU同士のトレードを言い出す（`pickTradeMover`。重みに比例）
// 7. 人の球団の提出（`submitPhase`）も育成の的を通す（自分の名簿・形の合うものだけ）
import './lib/bootstrap.mjs';
import assert from 'node:assert/strict';
import { createLeague, runCampRound, campFallbackPlan, submitPhase, defaultPhasePlan } from '../../server/leagueEngine.mjs';
import { campPlanFor, coachOffseason, horizonWants, staffOf } from '../../server/coachEngine.mjs';
import { teamNeeds } from '../../src/online/teamNeeds.js';
import { campAim, shouldHorizon, followHorizon, horizonPatience, AIM_YEARS } from '../../src/online/coaches.js';
import { menuForStat } from '../../src/season/trainingPolicy.js';
import { TEAMS_DATA } from '../../src/teams-data.js';
import { teamPolicy, tradeEagerness } from '../../src/online/teamPolicy.js';
import { teamPolicyView } from '../../server/coachView.mjs';
import { pickTradeMover } from '../../server/cpuTrades.mjs';

const clone = (v) => structuredClone(v);
const now = '2026-10-28T00:00:00.000Z';
const league = createLeague({ seed: 11, members: [{ userId: 'a' }, { userId: 'b' }], now });
// 名簿が配られてキャンプに入ったところまで進める（初期メンバーの選択など）
while (league.phase && league.phase.kind !== 'camp')
  for (const member of league.members)
    submitPhase(league, member.userId, { phaseId: league.phase.id, plan: defaultPhasePlan(league, member.teamName), ready: true }, now);
assert.equal(league.phase?.kind, 'camp', 'キャンプに入らない');
const names = league.season.settings.teamNames;
const humanTeam = league.members[0].teamName;
const cpuTeam = names.find((n) => !league.members.some((m) => m.teamName === n));
const rosterOf = (name) => league.game.teams[name].players;

// ------------------------------------------------------------------ 1. 球団の穴
{
  const mine = rosterOf(cpuTeam);
  const same = teamNeeds(mine, [clone(mine), clone(mine)]);
  assert.ok(Object.values(same.stats).every((v) => v === 0), '同じ名簿どうしで能力の穴がある');
  assert.ok(Object.values(same.slots).every((v) => v === 0), '同じ名簿どうしで持ち場の穴がある');
  const slow = clone(mine);
  for (const p of slow) if (p.position !== 'pitcher') p.physical.speed = Math.max(1, (p.physical.speed || 50) - 20);
  const needs = teamNeeds(slow, [mine, clone(mine)]);
  assert.ok(needs.stats.speed > 0.9, `足の遅い球団の走力の穴が ${needs.stats.speed}`);
  assert.equal(needs.stats.control, 0, '投手は同じなのに制球の穴がある');
  assert.deepEqual(teamNeeds(mine, []).stats.speed, 0, '比べる相手が無いのに穴がある');
}

// ------------------------------------------------------------------ 2. 育成の的
{
  const coach = (attack, horizon = 'middle', line = null) => ({
    vision: { attack, defense: 'rotation', flagship: 'attack', horizon },
    growth: { who: 'all', line },
    personality: { stubborn: 0 },
  });
  // 走力もミートも平均より上の野手
  const hitter = {
    id: 1, position: 'center', age: 24,
    batting: { meet: 60, power: 40, eye: 40, steal: 50 }, physical: { speed: 62, arm: 50 }, fielding: { defense: 45 },
  };
  const noNeed = { stats: {} };
  assert.equal(campAim(coach('contact'), hitter, { needs: noNeed, year: 5, direction: 'sharpen' }).stat, 'meet', '穴が無いのにミートを選ばない');
  const slowTeam = { stats: { speed: 1 } };
  assert.equal(campAim(coach('speed'), hitter, { needs: slowTeam, year: 5, direction: 'sharpen' }).stat, 'speed', '機動力の監督で足が足りないのに走力を選ばない');
  assert.equal(campAim(coach('speed'), hitter, { needs: noNeed, year: 5, direction: 'balanced' }), null, '「全体」なのに的を持つ');
  // 覚えた的を続ける（方向が「全体」の年でも・穴が変わっても）
  const kept = { ...hitter, campAim: { stat: 'speed', mode: 'sharpen', since: 5 } };
  assert.deepEqual(campAim(coach('contact'), kept, { needs: noNeed, year: 6, direction: 'balanced' }), { stat: 'speed', mode: 'sharpen', since: 5 }, '覚えた的を続けない');
  // 年数が過ぎたら選び直す
  assert.equal(campAim(coach('contact'), kept, { needs: noNeed, year: 5 + AIM_YEARS, direction: 'sharpen' }).stat, 'meet', '年数が過ぎても前の的のまま');
  assert.equal(campAim(coach('contact'), kept, { needs: noNeed, year: 5 + AIM_YEARS, direction: 'sharpen' }).since, 5 + AIM_YEARS);
  // 指導者の線に届いたら選び直す
  const reached = { ...kept, physical: { speed: 71, arm: 50 } };
  assert.notEqual(campAim(coach('contact', 'middle', 70), reached, { needs: noNeed, year: 6, direction: 'sharpen' })?.stat, 'speed', '線に届いたのに同じ的');
  // 投手は投手の能力から
  const pitcher = { id: 2, position: 'pitcher', age: 26, pitching: { control: 60, velocity: 140, stamina: 100 }, batting: {}, physical: {}, fielding: {} };
  assert.ok(['control', 'velocity'].includes(campAim(coach('contact'), pitcher, { needs: noNeed, year: 1, direction: 'sharpen' }).stat));
  assert.equal(campAim(coach('contact'), pitcher, { needs: { stats: { stamina: 1 } }, year: 1, direction: 'patch' }).stat, 'stamina', 'スタミナの穴を短所埋めで選ばない');
}

// ------------------------------------------------------------------ 3. キャンプの案と、的を覚える
{
  const l = clone(league);
  const roster = rosterOf(cpuTeam);
  const plan = campPlanFor(l, cpuTeam, roster);
  const again = campPlanFor(l, cpuTeam, roster);
  assert.deepEqual(plan, again, '同じ状態で案が変わる（乱数を引いている）');
  const aimed = Object.entries(plan.aims);
  assert.ok(aimed.length > 0, '的のある選手が居ない');
  // ⚠ 的を持つのは方向が「長所」「短所」の選手だけ（「全体」は持たない）。CPU球団の全体で4割以上
  let all = 0;
  let withAim = 0;
  for (const n of names) {
    if (l.members.some((m) => m.teamName === n)) continue;
    const r = rosterOf(n);
    all += r.length;
    withAim += Object.keys(campPlanFor(l, n, r).aims).length;
  }
  assert.ok(withAim >= all * 0.4, `的のある選手が少なすぎる（${withAim}/${all}）`);
  for (const [id, aim] of aimed) {
    const p = roster.find((x) => String(x.id) === id);
    assert.equal(plan.players[id].direction, aim.mode, '方向が的に合わない');
    assert.equal(plan.assignments[id], menuForStat(p, aim.stat, aim.mode), 'メイン練習が的の練習でない');
    assert.equal(aim.since, l.season.year);
  }
  const stats = {};
  for (const [, aim] of aimed) stats[aim.stat] = (stats[aim.stat] || 0) + 1;
  assert.ok(Object.keys(stats).length >= 3, `的が偏りすぎ ${JSON.stringify(stats)}`);
  // 1クール回すと覚える
  Object.assign(TEAMS_DATA, clone(l.game.teams));
  runCampRound(l, cpuTeam, campFallbackPlan(null, plan), { lastRound: false });
  const after = TEAMS_DATA[cpuTeam].players;
  const remembered = after.filter((p) => p.campAim);
  assert.ok(remembered.length >= aimed.length * 0.9, `的を覚えた選手が ${remembered.length}/${aimed.length}`);
  for (const p of remembered) assert.deepEqual(p.campAim, plan.aims[p.id], '覚えた的が案と違う');
  // 翌年の案も同じ的を続ける（年数のうち）
  l.season.year += 1;
  const next = campPlanFor(l, cpuTeam, after);
  let same = 0;
  for (const p of remembered) if (next.aims[p.id]?.stat === p.campAim.stat && next.aims[p.id].since === p.campAim.since) same += 1;
  assert.ok(same >= remembered.length * 0.8, `翌年に的を続けた選手が ${same}/${remembered.length}`);
  console.log(`的のある選手 ${withAim}/${all}人 / 的の例（${cpuTeam}）: ${JSON.stringify(stats)} / 覚えた ${remembered.length}人・翌年も同じ ${same}人`);
}

// ------------------------------------------------------------------ 4. 時間軸
{
  assert.equal(shouldHorizon({ winRate: 0.35, lastWinRate: 0.4, strength: 0, coreAge: 27 }), 'develop', '弱い球団が育成にならない');
  assert.equal(shouldHorizon({ winRate: 0.65, lastWinRate: 0.6, strength: 1, coreAge: 27 }), 'win', '強い球団が勝負にならない');
  assert.equal(shouldHorizon({ winRate: 0.5, lastWinRate: 0.5, strength: 0.5, coreAge: 27 }), 'middle', '五分の球団が中間にならない');
  assert.equal(shouldHorizon({ winRate: 0.47, lastWinRate: 0.5, strength: 0.4, coreAge: 32 }), 'develop', '主力が高齢で五分より悪いのに作り直さない');
  const person = (horizon, stubborn) => ({ vision: { attack: 'speed', defense: 'rotation', flagship: 'attack', horizon }, personality: { stubborn } });
  assert.equal(horizonPatience(person('win', -2)), 1);
  assert.equal(horizonPatience(person('win', 0)), 2);
  assert.equal(horizonPatience(person('win', 2)), 3);
  const flexible = person('win', -1);
  assert.equal(followHorizon(flexible, 'develop'), 'middle', '柔軟な人が1年で寄らない（1段だけ）');
  assert.equal(flexible.vision.horizon, 'middle');
  const firm = person('win', 1);
  assert.equal(followHorizon(firm, 'develop'), null);
  assert.equal(followHorizon(firm, 'develop'), null);
  assert.deepEqual(firm.horizonMiss, { want: 'develop', years: 2 });
  assert.equal(followHorizon(firm, 'develop'), 'middle', '頑固な人が3年外れても寄らない');
  assert.equal(firm.horizonMiss, undefined);
  const turned = person('win', 0);
  followHorizon(turned, 'develop');
  followHorizon(turned, 'middle');
  assert.deepEqual(turned.horizonMiss, { want: 'middle', years: 1 }, '求められる向きが変わったのに数え直さない');
  followHorizon(turned, 'win');
  assert.equal(turned.horizonMiss, undefined, '合ったのに外れた年数が残る');
}

// ------------------------------------------------------------------ 5. 年度更新で CPU球団だけ寄る
{
  const l = clone(league);
  // 終わった年: 人の球団と CPU の1球団を最下位に
  const standings = names.map((team, i) => ({ team, wins: 60 + i, losses: 60 - i, draws: 0 }));
  for (const row of standings) if (row.team === humanTeam || row.team === cpuTeam) Object.assign(row, { wins: 35, losses: 85 });
  l.history = [...(l.history || []), { year: l.season.year, standings, leagues: Object.fromEntries(l.teams.map((t) => [t.name, t.league])) }];
  const wants = horizonWants(l, l.history.at(-1), rosterOf);
  assert.ok(['develop', 'middle'].includes(wants[cpuTeam]), `最下位の球団が ${wants[cpuTeam]}`);
  // 全員を柔軟な勝負の人に
  for (const p of Object.values(l.coaches.people)) {
    p.vision = { ...p.vision, horizon: 'win' };
    p.personality = { ...p.personality, stubborn: -2 };
  }
  const humanStaff = staffOf(l, humanTeam);
  coachOffseason(l, { rosterOf });
  const cpuStaff = staffOf(l, cpuTeam);
  if (wants[cpuTeam] === 'develop' && cpuStaff.manager)
    assert.equal(cpuStaff.manager.vision.horizon, 'middle', '最下位の CPU球団の柔軟な監督が寄らない');
  for (const role of ['manager', 'pitching', 'batting'])
    if (humanStaff[role] && l.coaches.people[humanStaff[role].id]?.job?.team === humanTeam)
      assert.equal(l.coaches.people[humanStaff[role].id].vision.horizon, 'win', '人の球団の指導者が動いた');
  const counts = {};
  for (const n of names) {
    const h = staffOf(l, n).manager?.vision?.horizon;
    if (h) counts[h] = (counts[h] || 0) + 1;
  }
  console.log(`年度更新の後の監督の時間軸: ${JSON.stringify(counts)}（求めた時間軸 ${JSON.stringify(Object.values(wants).reduce((a, w) => ({ ...a, [w]: (a[w] || 0) + 1 }), {}))}）`);
}

// ------------------------------------------------------------------ 6. チームの方針
{
  const cpu = teamPolicyView(league, cpuTeam);
  const manager = staffOf(league, cpuTeam).manager;
  assert.ok(manager, 'CPU球団に監督が居ない');
  const keys = cpu.rows.map((r) => r.key);
  for (const k of ['attack', 'pitching', 'lean', 'build', 'growth', 'need']) assert.ok(keys.includes(k), `方針に ${k} の行が無い`);
  const value = (p, k) => p.rows.find((r) => r.key === k)?.value;
  const attack = { speed: '機動力重視', power: '長打重視', contact: 'つなぎ重視' }[manager.vision.attack];
  const pitching = { rotation: '先発完投型', bullpen: '継投型', fielding: '打たせて取る' }[manager.vision.defense];
  const build = { develop: '若手育成', middle: 'バランス', win: '積極補強' }[manager.vision.horizon];
  assert.equal(value(cpu, 'attack'), attack, '攻撃の方針が監督の型と違う');
  assert.equal(value(cpu, 'pitching'), pitching, '投手起用の方針が監督の型と違う');
  assert.equal(value(cpu, 'build'), build, '編成の方針が監督の時間軸と違う');
  assert.ok(cpu.rows.every((r) => r.value && r.note), '方針の行に値か一言が無い');
  assert.equal(cpu.note, null, 'CPU球団に人の球団の注が付いた');
  assert.ok(teamPolicyView(league, humanTeam).note?.includes('オーナー'), '人の球団に注が無い');
  assert.ok(teamPolicyView(league, humanTeam, { own: true }).note?.includes('あなた'), '自球団の注が無い');
  // 人の球団はコーチの居ない側を監督で埋めない（キャンプはおすすめで練習する。監査18）
  const coach = staffOf(league, cpuTeam).pitching || manager;
  const humanNoPitch = teamPolicy({ manager, batting: coach }, { human: true });
  assert.match(value(humanNoPitch, 'growth'), /投手はおすすめ|^おすすめ$/, '人の球団の投手コーチ不在が監督の育成観で埋まる');
  assert.equal(value(teamPolicy({ manager }, { human: true }), 'growth'), 'おすすめ', '人の球団のコーチ不在がおすすめにならない');
  assert.notEqual(value(teamPolicy({ manager }, {}), 'growth'), 'おすすめ', 'CPU球団のコーチ不在が監督で埋まらない');
  const none = teamPolicy({}, {});
  assert.equal(value(none, 'lean'), 'バランス型', '監督不在がバランス型にならない');
  // 穴の大きい持ち場が「いまの重点」に出る
  const needy = teamPolicy({ manager }, { needs: { slots: { catcher: 0.9 }, stats: { power: 0.5 } } });
  assert.equal(value(needy, 'need'), '捕手・長打', 'いまの重点が穴の大きい順にならない');
  assert.equal(value(teamPolicy({ manager }, { needs: { slots: {}, stats: {} } }), 'need'), '目立つ穴なし');
  // 言い出しやすさ: 積極補強 > バランス > 若手育成。重みに比例して選ばれる
  const as = (horizon) => ({ vision: { ...manager.vision, horizon } });
  assert.ok(tradeEagerness(as('win')) > tradeEagerness(as('middle')) && tradeEagerness(as('middle')) > tradeEagerness(as('develop')));
  assert.equal(tradeEagerness(null), 1);
  const l = clone(league);
  const pool = names.slice(0, 6);
  const weight = (n) => (n === pool[0] ? tradeEagerness(as('win')) : n === pool[1] ? tradeEagerness(as('develop')) : 1);
  const picks = {};
  const days = 4000;
  for (let i = 0; i < days; i++) {
    l.season.currentDate = { year: 1 + Math.floor(i / 365), month: 1 + (Math.floor(i / 28) % 12), day: 1 + (i % 28) };
    const from = pickTradeMover(l, pool, weight);
    picks[from] = (picks[from] || 0) + 1;
  }
  const total = pool.reduce((a, n) => a + weight(n), 0);
  for (const n of pool) {
    const want = (weight(n) / total) * days;
    assert.ok(Math.abs((picks[n] || 0) - want) < want * 0.2, `言い出す回数が重みに比例しない（${n}: ${picks[n]} / 見込み ${Math.round(want)}）`);
  }
  console.log(`言い出す回数（積極補強・若手育成・バランス4球団）: ${pool.map((n) => picks[n] || 0).join('・')}`);
}

// ------------------------------------------------------------------ 7. 人の球団の提出も的を通す（監査18）
// 「意見を聞く」で提出しなかった人は、締め切りで指導者の案が `submitPhase` の正規化を通って回る。
// そこで的（`aims`）を落とすと、メイン練習は的の練習なのに選手が的を覚えず毎年選び直しになっていた
{
  const l = clone(league);
  const member = l.members[0];
  const plan = defaultPhasePlan(l, member.teamName);
  const ids = Object.keys(plan.aims || {});
  assert.ok(ids.length > 0, '人の球団の指導者の案に的が無い');
  // 他球団の選手・形の崩れた的は落とす
  const other = rosterOf(cpuTeam)[0].id;
  const sent = { ...plan, aims: { ...plan.aims, [other]: plan.aims[ids[0]], [ids[0]]: { stat: 1 } } };
  submitPhase(l, member.userId, { phaseId: l.phase.id, plan: sent, ready: false }, now);
  const kept = l.phase.submissions[member.userId].plan.aims || {};
  assert.equal(kept[other], undefined, '他球団の選手の的を受け取った');
  assert.equal(kept[ids[0]], undefined, '形の崩れた的を受け取った');
  for (const id of ids.slice(1)) assert.deepEqual(kept[id], plan.aims[id], '提出で的が落ちた');
}

console.log('online-vision-check PASS');
