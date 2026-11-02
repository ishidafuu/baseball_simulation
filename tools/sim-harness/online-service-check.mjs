import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestStore } from './lib/testStore.mjs';
import { LeagueService } from '../../server/leagueService.mjs';
const dir = await mkdtemp(join(tmpdir(), 'pennant-service-'));
try {
  const store = createTestStore(join(dir, 'state.gz'));
  let now = '2026-10-28T00:00:00.000Z';
  const service = new LeagueService(store, {
    local: true,
    adminId: 'a',
    members: [{ userId: 'a' }, { userId: 'b' }],
    clock: () => now,
  });
  const a = (await service.login('a')).sessionId;
  const b = (await service.login('b')).sessionId;
  let view = await service.view('a', a);
  assert.equal(view.setupRequired, true);
  let seq = 0;
  const command = async (user, session, type, payload, revision) => {
    const frame = await service.view(user, session);
    if (type === 'lineup')
      payload = { ...payload, baseLineup: payload?.baseLineup ?? frame.lineup };
    if (type === 'submit' && !Object.hasOwn(payload, 'baseSubmission'))
      payload = { ...payload, baseSubmission: frame.phase?.submission || null };
    return service.command(user, session, {
      requestId: `request:${++seq}`,
      revision: revision ?? frame.revision ?? 0,
      type,
      payload,
    });
  };
  await assert.rejects(
    command('b', b, 'create'),
    (error) => error.status === 403,
  );
  await command('a', a, 'create');
  const nextA = (await service.login('a')).sessionId;
  await assert.rejects(
    command('a', a, 'pause'),
    (error) => error.code === 'session',
  );
  assert.equal((await service.view('a', a)).writable, false);
  await service.logout('a', a);
  assert.equal(
    (await service.view('a', nextA)).writable,
    true,
    '古い端末のログアウトで現在の端末を失効させない',
  );
  const newStore = createTestStore(join(dir, 'state.gz'));
  assert.equal(
    (await newStore.read()).sessions.a,
    nextA,
    '再起動でも端末権限を保持する',
  );
  for (let phase = 0; phase < 2; phase++) {
    for (const [user, session] of [
      ['a', nextA],
      ['b', b],
    ]) {
      const defaults = await service.defaults(user, session);
      const cmd = {
        requestId: `request:${++seq}`,
        revision: defaults.revision,
        type: 'submit',
        payload: {
          phaseId: defaults.phaseId,
          plan: defaults.plan,
          ready: true,
          baseSubmission: (await service.view(user, session)).phase.submission,
        },
      };
      await service.command(user, session, cmd);
      const currentRevision = (await service.view(user, session)).revision;
      await service.command(user, session, cmd);
      assert.equal(
        (await service.view(user, session)).revision,
        currentRevision,
        '同じ操作の再送を二重適用しない',
      );
      if (user === 'a')
        assert.equal(
          (await service.view('b', b)).phase.submission,
          null,
          '相手の希望内容を返さない',
        );
    }
  }
  view = await service.view('a', nextA);
  assert.equal(view.status, 'running');
  await assert.rejects(
    command('b', b, 'step'),
    (error) => error.status === 403,
    '検証用でも管理者以外の手動進行を拒否する',
  );
  const rev = view.revision;
  const concurrent = await Promise.allSettled([
    command('a', nextA, 'lineup', view.lineup, rev),
    command('b', b, 'lineup', (await service.view('b', b)).lineup, rev),
  ]);
  assert.equal(
    concurrent.filter((r) => r.status === 'fulfilled').length,
    1,
    '同じrevisionの競合は一方だけ成功',
  );
  const validCommand = {
    requestId: `request:${++seq}`,
    revision: (await service.view('a', nextA)).revision,
    type: 'lineup',
    payload: {
      ...(await service.view('a', nextA)).lineup,
      baseLineup: (await service.view('a', nextA)).lineup,
    },
  };
  await service.command('a', nextA, validCommand);
  await assert.rejects(
    service.command('a', nextA, { ...validCommand, type: 'pause' }),
    (error) => error.status === 409,
  );
  await assert.rejects(
    service.command('a', nextA, null),
    (error) => error.status === 400,
  );
  const before = await store.read();
  await assert.rejects(
    command('a', nextA, 'lineup', { battingOrder: [], starters: [] }),
  );
  assert.deepEqual(await store.read(), before, '失敗した操作は一切公開しない');
  await command('a', nextA, 'pause');
  await command('a', nextA, 'backup');
  await command('a', nextA, 'resume');
  now = (await service.view('a', nextA)).nextAdvanceAt;
  const ticks = await Promise.all([service.tick(), service.tick()]);
  assert.equal(
    ticks.filter((t) => t.advanced).length,
    1,
    '重複Cronで1日だけ進む',
  );
  assert.equal((await service.view('a', nextA)).currentDate.day, 2);
  await command('a', nextA, 'pause');
  await command('a', nextA, 'restore');
  view = await service.view('a', nextA);
  assert.equal(view.currentDate.day, 1);
  assert.equal(view.status, 'paused');
  assert.equal(view.writable, true);
  await command('a', nextA, 'resume');
  now = new Date(
    Date.parse((await service.view('a', nextA)).nextAdvanceAt) + 20 * 60000,
  ).toISOString();
  await service.tick();
  view = await service.view('a', nextA);
  assert.equal(view.status, 'error');
  assert.equal(view.currentDate.day, 1, '遅延分を自動追いつきしない');
  await command('a', nextA, 'resume');
  assert.ok((await service.view('a', nextA)).nextAdvanceAt > now);
  assert.ok(
    Buffer.byteLength(JSON.stringify(view)) < 250000,
    '全世界データを画面に転送しない',
  );
  await service.logout('a', nextA);
  assert.equal((await service.view('a', nextA)).writable, false);
  assert.equal((await service.view('a', undefined)).writable, false);
  await assert.rejects(
    command('a', nextA, 'pause'),
    (error) => error.code === 'session',
  );
  console.log(
    'online-service-check PASS（永続化・競合・再送・端末交代・秘密提出・停止復元・重複Cron）',
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
