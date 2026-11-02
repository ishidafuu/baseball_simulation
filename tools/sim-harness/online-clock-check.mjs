import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestStore } from './lib/testStore.mjs';
import { LeagueService } from '../../server/leagueService.mjs';
import { nextProgressionAt, ONLINE_SCHEMA, ONLINE_ENGINE_VERSION } from '../../src/online/shared.js';
const dir = await mkdtemp(join(tmpdir(), 'pennant-clock-'));
try {
  const store = createTestStore(join(dir, 'state.gz'));
  await store.transaction((b) => {
    b.league = {
      schema: ONLINE_SCHEMA,
      engineVersion: ONLINE_ENGINE_VERSION,
      revision: 1,
      status: 'waiting',
      phase: {},
      members: [{ userId: 'a' }],
    };
    b.sessions.a = 'active';
  });
  // ⚠ **境界は「枠そのものの時刻」にまたがらせること**。1ターン＝1時間に変えたとき、
  //    10:29:59→10:30:01 では開始時刻で計算しても完了時刻で計算しても次は11:00になり、
  //    この検査が**何も判別しなくなっていた**。正時（10:00）をまたがせる。
  let now = '2026-10-28T00:59:59.000Z';
  const service = new LeagueService(store, {
    members: [{ userId: 'a' }],
    adminId: 'a',
    clock: () => now,
  });
  // イベント計算が10:00（JST）の境界をまたぐ。実試合の検証とは別の遅延fixture。
  service.engine = async (fn) =>
    fn({
      submitPhase(l, user, plan, startedAt) {
        l.status = 'running';
        l.phase = null;
        l.nextAdvanceAt = nextProgressionAt(startedAt);
        now = '2026-10-28T01:00:01.000Z';
      },
    });
  await service.command('a', 'active', {
    requestId: 'clock:boundary',
    revision: 1,
    type: 'submit',
    payload: { baseSubmission: null },
  });
  const league = (await store.read()).league;
  assert.equal(
    league.nextAdvanceAt,
    '2026-10-28T02:00:00.000Z',
    '処理開始ではなく完了後の未来の枠を使う',
  );
  assert.equal(league.updatedAt, now);
  console.log('online-clock-check PASS（決定処理が進行時刻をまたぐ境界）');
} finally {
  await rm(dir, { recursive: true, force: true });
}
