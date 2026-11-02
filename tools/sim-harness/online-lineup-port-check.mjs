// 一人用の編成画面をオンラインへ移植した部分の検査。
//
// ⚠ 主目的は「**画面が書き換えた `team` から、サーバーが受け取れる `plan` が作れること**」。
//    `src/online/OnlineLineup.jsx` は 2,600行の一人用画面に `team` 形の複製を渡し、
//    書き換えられた結果を読み直して送る。投影（`projectLineup`）と検証
//    （`validateLineup`）の両方と形が合っていないと、画面では編集できるのに
//    保存の瞬間だけ弾かれる——いちばん気づきにくい壊れ方になる。
//
// ⚠ 見た目（`.online button` に潰されないこと）はここでは見ない。CSSの詳細度の
//    問題なのでブラウザでしか出ない。`OnlineLineup.jsx` のポータルの注記を参照。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestStore } from './lib/testStore.mjs';
import { LeagueService } from '../../server/leagueService.mjs';
import { defaultPhasePlan } from '../../server/leagueEngine.mjs';
import { projectLineup } from '../../server/projection.mjs';
import { saveLineup } from '../../server/lineupCommand.mjs';
import { validateLineup } from '../../src/online/shared.js';
import { teamFromView, planFromTeam } from '../../src/online/lineupBridge.js';
import { generateOptimalLineup } from '../../src/game/lineupGenerator.js';
import { TEAMS_DATA } from '../../src/teams-data.js';

const dir = await mkdtemp(join(tmpdir(), 'pennant-lineup-port-'));
try {
  const store = createTestStore(join(dir, 'state.gz'));
  let now = '2026-10-26T15:00:00.000Z'; // 月曜0時JST
  const service = new LeagueService(store, {
    members: [{ userId: 'admin', label: '管理者' }],
    adminId: 'admin',
    clock: () => now,
  });
  const sessionId = (await service.login('admin')).sessionId;
  const run = (type, revision, payload) =>
    service.command('admin', sessionId, {
      requestId: `${type}-${revision}`,
      revision,
      type,
      payload,
    });
  await run('create', 0);
  // 初期編成とキャンプを既定案で通してシーズンを開始させる
  for (let i = 0; i < 4; i += 1) {
    const current = (await store.read()).league;
    if (!current.phase) break;
    const teamName = current.members[0].teamName;
    await service.command('admin', sessionId, {
      requestId: `submit-${i}`,
      revision: current.revision,
      type: 'submit',
      payload: {
        phaseId: current.phase.id,
        plan: defaultPhasePlan(current, teamName),
        ready: true,
        baseSubmission: null,
      },
    });
  }
  const league = (await store.read()).league;
  assert.equal(league.status, 'running', 'シーズンが始まっている');
  const teamName = league.members[0].teamName;
  const serverTeam = league.game.teams[teamName];
  const view = await service.view('admin', sessionId);

  // --- 往復（何も編集しないとき） ---------------------------------
  // ⚠ ここが本丸。view → team → plan が、サーバー自身の投影と一致すること
  const team = teamFromView(view);
  const plan = planFromTeam(team);
  const projected = projectLineup(serverTeam);
  // ⚠ `projectLineup` は**並べ替えない**（保存された配列の順のまま返す）。
  //    画面は打順の番号で並べるので、送る側は番号順に揃える。比べるときも揃える
  assert.deepEqual(
    plan.battingOrder,
    projected.battingOrder
      .map(({ playerId, position, battingOrder }) => ({
        playerId,
        position,
        battingOrder,
      }))
      .sort((a, b) => a.battingOrder - b.battingOrder),
    '編集しないのに打順の中身が変わっている',
  );
  assert.deepEqual(
    plan.battingOrder.map((e) => e.battingOrder),
    [1, 2, 3, 4, 5, 6, 7, 8],
    '送る打順が1〜8の順に並んでいない',
  );
  assert.deepEqual(plan.starters, projected.starters, '先発の並びが変わっている');

  // 画面に渡す `team` は投手を打順9番に戻している（一人用の画面がそう組む）
  const order = team.lineupSettings.battingOrder;
  assert.equal(order.length, 9, '打順が9枠でない');
  const pitcherSlots = order.filter((e) => e.position === 'pitcher');
  assert.equal(pitcherSlots.length, 1, '投手の枠が1つでない');
  assert.equal(pitcherSlots[0].battingOrder, 9, '投手が9番でない');
  assert.equal(pitcherSlots[0].playerId, view.nextStarterId, '次の先発が入っていない');
  // ⚠ 送る側では投手を外す。`validateLineup` は野手8人ちょうどを求める
  assert.equal(plan.battingOrder.length, 8, '送る打順が8人でない');
  assert.doesNotThrow(() => validateLineup(serverTeam, plan), '自分の投影が通らない');

  // ⚠ **複製であること**。view のデータをそのまま渡すと、保存前の編集が画面全体に漏れる
  team.players[0].name = '書き換えた名前';
  assert.notEqual(
    view.roster[0].name,
    '書き換えた名前',
    '画面に渡した team が view を直接書き換えている',
  );

  // --- 編集が届くか ------------------------------------------------
  const fresh = teamFromView(view);
  const slots = fresh.lineupSettings.battingOrder.filter(
    (e) => e.position !== 'pitcher',
  );
  const firstId = slots.find((e) => e.battingOrder === 1).playerId;
  const secondId = slots.find((e) => e.battingOrder === 2).playerId;
  for (const e of slots) {
    if (e.playerId === firstId) e.battingOrder = 2;
    else if (e.playerId === secondId) e.battingOrder = 1;
  }
  const swapped = planFromTeam(fresh);
  assert.equal(swapped.battingOrder[0].playerId, secondId, '入れ替えが plan に出ていない');
  saveLineup(league, 'admin', swapped);
  const after = projectLineup(league.game.teams[teamName]);
  const afterFirst = after.battingOrder.find((e) => e.battingOrder === 1);
  assert.equal(afterFirst.playerId, secondId, '入れ替えがサーバーに届いていない');

  // --- 投手と野手の打順を入れ替えても保存できるか -------------------
  // ⚠ 画面では投手の枠（9番）と野手を入れ替えられる。以前はそのまま送って
  //    野手が 1,2,4…9 になり、サーバーの「打順は1〜8」で弾かれていた
  //    （保存に失敗すると編集も消えていた）
  {
    const t = teamFromView(view);
    const entries = t.lineupSettings.battingOrder;
    const pitcherEntry = entries.find((e) => e.position === 'pitcher');
    const third = entries.find((e) => e.battingOrder === 3);
    pitcherEntry.battingOrder = 3;
    third.battingOrder = 9;
    const p = planFromTeam(t);
    assert.deepEqual(
      p.battingOrder.map((e) => e.battingOrder),
      [1, 2, 3, 4, 5, 6, 7, 8],
      '投手と入れ替えたあとの打順が1〜8に振り直されていない',
    );
    assert.equal(p.battingOrder.at(-1).playerId, third.playerId, '9番に回した野手が最後に来ていない');
    assert.doesNotThrow(() => validateLineup(serverTeam, p), '投手と入れ替えると保存できない');
  }

  // --- 次の先発が並びの先頭でないとき ---------------------------------
  // ⚠ 打順の投手は「次の先発」。並びの先頭を入れると、次の試合で投げない投手が出る
  {
    const second = view.lineup.starters[1];
    const t = teamFromView({ ...view, nextStarterId: second });
    const slot = t.lineupSettings.battingOrder.find((e) => e.position === 'pitcher');
    assert.equal(slot.playerId, second, '次の先発でない投手が打順に入っている');
    assert.equal(t.pitchingRotation.currentStarterIndex, 1, '次の先発の位置が合っていない');
  }

  // --- TEAMS_DATA を引かずに自動編成できるか -------------------------
  // ⚠ オンラインの球団は `TEAMS_DATA` に居ない。`generateOptimalLineup` が
  //    名前で引く作りのままだと、「自動」を押しても**黙って何も起きない**
  //    （console.error を出して return するだけで、画面は編集できたように見える）
  // ⚠ 名前は**ブラウザ側の条件**に合わせて TEAMS_DATA に無いものを使う。
  //    サーバー側のプロセスでは engine が TEAMS_DATA を埋めてしまうので、
  //    実際の球団名で試すと「引けてしまって」検査が素通りする
  const detached = '移植検査用の球団';
  assert.ok(!TEAMS_DATA[detached], '検査用の名前が TEAMS_DATA に居る');
  const autoTeam = teamFromView(view);
  const beforeAuto = planFromTeam(autoTeam).battingOrder.map((e) => e.playerId);
  generateOptimalLineup(detached, 'offense', autoTeam);
  const afterAuto = planFromTeam(autoTeam).battingOrder.map((e) => e.playerId);
  assert.notDeepEqual(afterAuto, beforeAuto, '自動編成が打順を組み直していない');
  assert.doesNotThrow(
    () => validateLineup(serverTeam, planFromTeam(autoTeam)),
    '自動編成の結果が保存できない',
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(
  '■ 編成画面の移植: OK（投影と往復する / 複製を渡す / 編集が届く / 投手と入れ替えても保存できる / 次の先発を打順に入れる / TEAMS_DATA 無しで自動編成）',
);
