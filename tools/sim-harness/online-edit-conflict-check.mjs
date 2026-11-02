// 同じログインを共有するタブの競合。進行エンジンではなく操作境界のfixture。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestStore } from './lib/testStore.mjs';
import { LeagueService } from '../../server/leagueService.mjs';
import { ONLINE_SCHEMA, ONLINE_ENGINE_VERSION } from '../../src/online/shared.js';
const positions = [
  'catcher',
  'first',
  'second',
  'third',
  'short',
  'left',
  'center',
  'right',
];
const team = {
  players: [
    ...positions.map((position, i) => ({ id: i + 1, position })),
    { id: 9, position: 'pitcher', pitching: {} },
  ],
  lineupSettings: {
    battingOrder: positions.map((position, i) => ({
      playerId: i + 1,
      position,
      battingOrder: i + 1,
    })),
  },
  pitchingRotation: { starters: [9], currentStarterIndex: 0 },
  strategy: {},
};
const planOf = (team) => ({
  battingOrder: team.lineupSettings.battingOrder.filter(
    (e) => e.position !== 'pitcher',
  ),
  starters: team.pitchingRotation.starters,
  strategy: team.strategy,
});
const dir = await mkdtemp(join(tmpdir(), 'pennant-edit-'));
try {
  const store = createTestStore(join(dir, 'state.gz'));
  await store.transaction((b) => {
    b.sessions = { a: 'same-session', b: 'other-session' };
    b.league = {
      schema: ONLINE_SCHEMA,
      engineVersion: ONLINE_ENGINE_VERSION,
      revision: 1,
      status: 'running',
      members: [
        { userId: 'a', teamName: 'A' },
        { userId: 'b', teamName: 'B' },
      ],
      game: { teams: { A: structuredClone(team), B: structuredClone(team) } },
    };
  });
  const service = new LeagueService(store, {
    members: [{ userId: 'a' }, { userId: 'b' }],
    adminId: 'a',
  });
  let sequence = 0;
  async function send(user, type, payload) {
    return service.command(
      user,
      user === 'a' ? 'same-session' : 'other-session',
      {
        requestId: `edit-case:${++sequence}`,
        revision: (await store.read()).league.revision,
        type,
        payload,
      },
    );
  }
  const original = structuredClone(planOf(team));
  await send('a', 'lineup', {
    ...original,
    strategy: { batting: 'patient' },
    baseLineup: original,
  });
  await assert.rejects(
    send('a', 'lineup', {
      ...original,
      strategy: { batting: 'aggressive' },
      baseLineup: original,
    }),
    (error) => error.code === 'edit_conflict',
    '最新の全体revisionでも古い下書きによる上書きを拒否する',
  );
  const current = structuredClone(
    planOf((await store.read()).league.game.teams.A),
  );
  await send('b', 'lineup', { ...original, baseLineup: original });
  await send('a', 'lineup', { ...current, baseLineup: current });
  assert.equal(
    (await store.read()).league.game.teams.A.strategy.batting,
    'patient',
    '相手球団の更新だけなら編集中の案を保存できる',
  );
  await store.transaction((b) => {
    b.league.status = 'waiting';
    b.league.phase = { id: '1:camp', kind: 'camp', submissions: {} };
  });
  service.engine = async (fn) =>
    fn({
      submitPhase(l, user, payload) {
        l.phase.submissions[user] = {
          plan: payload.plan,
          ready: payload.ready,
        };
      },
    });
  await send('a', 'submit', {
    phaseId: '1:camp',
    plan: { menu: 'batting' },
    ready: false,
    baseSubmission: null,
  });
  await assert.rejects(
    send('a', 'submit', {
      phaseId: '1:camp',
      plan: { menu: 'control' },
      ready: true,
      baseSubmission: null,
    }),
    (error) => error.code === 'edit_conflict',
    '古い確認画面で保存済みの提出を上書きしない',
  );
  const submitted = (await store.read()).league.phase.submissions.a;
  await send('b', 'submit', {
    phaseId: '1:camp',
    plan: { menu: 'standard' },
    ready: false,
    baseSubmission: null,
  });
  await send('a', 'submit', {
    phaseId: '1:camp',
    plan: { menu: 'velocity' },
    ready: true,
    baseSubmission: submitted,
  });
  console.log(
    'online-edit-conflict-check PASS（同一ログインの別タブ・編成/提出の古い下書き・相手球団の更新）',
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
