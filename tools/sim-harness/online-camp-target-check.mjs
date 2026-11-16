// キャンプのサブ練習の対象と、人の球団の守備位置の検査（総合監査 2026-11-10 で直したもの）。
//   node tools/sim-harness/online-camp-target-check.mjs
//
// 1. 「変化球練習」で磨く球種は、その投手の持ち球ならどれでも選べる
//    （スプリット・ツーシーム・パームを選ぶと 400 でクールが実行できなかった）
// 2. 人の球団で守備位置を変えた選手に「サブポジ練習」を当てても、守備位置が戻らない
//    （適性への合わせで一塁手に戻り、捕手が0人になることもあった）
// 3. フォーム改造・打席変更（先方回答 2026-11-16 B3）: 選んだ形に変わる・変わったあとの
//    クールで別の形に変わり続けない・対象が無ければ何もしない（基礎体力）・野手にフォーム改造は出さない
import assert from 'node:assert/strict';
import {
  createLeague,
  submitPhase,
  loadLeagueWorld,
  convertPosition,
  validateCampRound,
  runCampRound,
  captureLeagueWorld,
} from '../../server/leagueEngine.mjs';
import { TEAMS_DATA } from '../../src/teams-data.js';
import { CAMP_PITCH_TYPES, currentBats } from '../../src/online/shared.js';
import { campSubKey } from '../../server/leagueEngine.mjs';
import { subMenusFor } from '../../src/online/campMenus.js';

const NOW = '2026-10-26T15:00:00.000Z';
const quiet = (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
};
const league = quiet(() => createLeague({ members: [{ userId: 'a' }], now: NOW }));
quiet(() =>
  submitPhase(league, 'a', { phaseId: league.phase.id, plan: { packId: league.packs[0].id }, ready: true }, NOW),
);
assert.equal(league.phase?.kind, 'camp', 'セットを選んでもキャンプに入らない');
const name = league.members[0].teamName;
const roster = () => league.game.teams[name].players;

// ------------------------------------------------------------------ 1. 磨く球種
{
  const special = roster().flatMap((p) =>
    p.position === 'pitcher'
      ? (p.pitching?.arsenal || [])
          .filter((a) => a.type !== 'straight' && !CAMP_PITCH_TYPES.includes(a.type))
          .map((a) => [p, a.type])
      : [],
  );
  assert.ok(special.length > 0, '新球種の表に無い球種を持つ投手がいない（検査の前提）');
  for (const [pitcher, type] of special) {
    const plan = validateCampRound(league, name, {
      round: 1,
      policy: { mode: 'recommended' },
      sub: { [pitcher.id]: 'breaking' },
      subTarget: { [pitcher.id]: type },
    });
    assert.equal(plan.subTarget[pitcher.id], type, `${type} を磨く球種に選べない`);
  }
  // 持っていない球種は断る（選手の名前を添える）
  const pitcher = special[0][0];
  const missing = CAMP_PITCH_TYPES.find((t) => !pitcher.pitching.arsenal.some((a) => a.type === t));
  assert.throws(
    () =>
      validateCampRound(league, name, {
        round: 1,
        sub: { [pitcher.id]: 'breaking' },
        subTarget: { [pitcher.id]: missing },
      }),
    new RegExp(`練習の対象が不正です（${pitcher.name}）`),
  );
}

// ------------------------------------------------------------------ 2. 変えた守備位置はサブポジ練習で戻らない
{
  loadLeagueWorld(league);
  const first = TEAMS_DATA[name].players.find((p) => p.position === 'first' && p.isActive !== false);
  assert.ok(first, '一塁手がいない（検査の前提）');
  quiet(() => convertPosition(league, 'a', { playerId: first.id, position: 'catcher' }));
  league.game = captureLeagueWorld();
  for (let round = 1; round <= 2; round += 1) {
    const plan = validateCampRound(league, name, {
      round,
      policy: { mode: 'recommended' },
      sub: { [first.id]: 'subposition' },
      subTarget: { [first.id]: 'left' },
    });
    loadLeagueWorld(league);
    quiet(() => runCampRound(league, name, plan));
    league.game = captureLeagueWorld();
    const after = roster().find((p) => p.id === first.id);
    assert.equal(after.position, 'catcher', `${round}クール目のサブポジ練習で守備位置が戻った`);
  }
}
// ------------------------------------------------------------------ 3. フォーム改造・打席変更
{
  const pitcher = roster().find((p) => p.position === 'pitcher' && p.isActive !== false);
  const batter = roster().find((p) => p.position !== 'pitcher' && p.isActive !== false);
  const from = pitcher.pitching.form || 'threeQuarter';
  const to = from === 'sidearm' ? 'overhand' : 'sidearm';
  assert.ok(subMenusFor(pitcher).some(([k]) => k === 'form_change'), '投手にフォーム改造が出ていない');
  assert.ok(!subMenusFor(batter).some(([k]) => k === 'form_change'), '野手にフォーム改造が出ている');
  assert.ok(subMenusFor(batter).some(([k]) => k === 'switch_hit'), '野手に打席変更が出ていない');
  // 対象が無い・もうその形 → 基礎体力
  assert.equal(campSubKey('form_change', pitcher, undefined), 'physique');
  assert.equal(campSubKey('form_change', pitcher, from), 'physique');
  assert.equal(campSubKey('form_change', pitcher, to), 'form_change');
  assert.equal(campSubKey('switch_hit', batter, undefined), 'physique');
  // 野手にフォーム改造の対象は断る（練習そのものが野手に出ない）
  assert.throws(() =>
    validateCampRound(league, name, { round: 1, sub: { [batter.id]: 'form_change' }, subTarget: { [batter.id]: 'sidearm' } }),
  );
  // 4クール同じ指示で回しても、フォームは選んだ形から動かない（1回目で変わり、後は基礎体力）
  const bats = currentBats(batter);
  const toBats = bats === 'switch' ? 'right' : 'switch';
  const formsSeen = new Set();
  // 打席は成功するかが運なので、「元のまま」か「選んだ打席」のどちらか。
  // ⚠ **一度変わったら戻らない**こと（変わったあとは基礎体力で回る。`campSubKey`）。
  //    元か選んだ打席かだけを見ると、両打ちに変わったあと元の打席へ戻っても通ってしまう
  const batsSeen = [];
  for (let round = 1; round <= 4; round += 1) {
    const plan = validateCampRound(league, name, {
      round,
      policy: { mode: 'recommended' },
      sub: { [pitcher.id]: 'form_change', [batter.id]: 'switch_hit' },
      subTarget: { [pitcher.id]: to, [batter.id]: toBats },
    });
    loadLeagueWorld(league);
    const result = quiet(() => runCampRound(league, name, plan));
    league.game = captureLeagueWorld();
    const p = roster().find((x) => x.id === pitcher.id);
    formsSeen.add(p.pitching.form);
    if (round === 1) assert.ok(result.events[pitcher.id]?.some((t) => /フォーム改造/.test(t)), 'フォーム改造の結果が出来事に出ない');
    const b = roster().find((x) => x.id === batter.id);
    const nowBats = currentBats(b);
    assert.ok([bats, toBats].includes(nowBats), '選んでいない打席に変わった');
    if (batsSeen.includes(toBats)) assert.equal(nowBats, toBats, `打席が一度変わったあと元に戻った: ${[...batsSeen, nowBats]}`);
    batsSeen.push(nowBats);
  }
  assert.deepEqual([...formsSeen], [to], `フォームが選んだ形以外に動いた: ${[...formsSeen]}`);
}
console.log('online-camp-target-check PASS');
