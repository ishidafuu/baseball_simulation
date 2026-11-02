// 検証モード（管理者が手で進められる）の検査。
//
// ⚠ 主目的は「**遊んでいる人が勝手に進められないこと**」。時間で進むのが本筋で、
//    手動進行は作っている間だけの抜け道。既定でOFF・管理者専用・OFFなら拒む、
//    の3つを押さえる。
// ⚠ まとめて進めるときも**1日ずつ繰り返すこと**。日付を飛ばす実装にすると、
//    間の日の試合・疲労回復・コンディション更新が落ちて取り返せない
//    （一人用で同じ失敗をしている。`CLAUDE.md` の不変条件）。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../../server/storage/fileStore.mjs';
import { LeagueService } from '../../server/leagueService.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pennant-testmode-'));
try {
  const store = new FileStore(join(dir, 'state.gz'));
  let now = '2026-10-26T15:00:00.000Z'; // 月曜0時JST
  const service = new LeagueService(store, {
    members: [{ userId: 'admin', label: '管理者' }],
    adminId: 'admin',
    clock: () => now,
  });
  const admin = (await service.login('admin')).sessionId;
  const guest = (await service.login('guest')).sessionId;
  const send = async (userId, sessionId, type, payload, tag = '') => {
    const l = (await store.read()).league;
    return service.command(userId, sessionId, {
      requestId: `probe-${type}${tag}-${l?.revision ?? 0}`,
      revision: l?.revision ?? 0,
      type,
      payload,
    });
  };
  await send('admin', admin, 'create');
  await send('guest', guest, 'join', { teamName: 'テスト球団' });

  // --- 既定はOFF -----------------------------------------------------
  // ⚠ ONのままだと管理者が好きな時に試合を進められる。多人数の対戦として公平でない
  assert.equal((await store.read()).league.testMode, false, '既定でONになっている');
  const view0 = await service.view('admin', admin);
  assert.equal(view0.testMode, false, 'ビューに検証モードが載っていない');

  // OFFのうちは手動進行を拒む
  await assert.rejects(
    () => send('admin', admin, 'resolve'),
    (e) => e.status === 403,
    'OFFなのに手続きを締め切れた',
  );
  await assert.rejects(
    () => send('admin', admin, 'step'),
    (e) => e.status === 403,
    'OFFなのに進められた',
  );

  // --- 切り替えは管理者だけ -------------------------------------------
  await assert.rejects(
    () => send('guest', guest, 'testmode', { on: true }),
    (e) => e.status === 403,
    '参加者が検証モードを入れられる',
  );
  await send('admin', admin, 'testmode', { on: true });
  assert.equal((await store.read()).league.testMode, true, 'ONにならない');
  assert.equal((await service.view('admin', admin)).testMode, true);

  // --- 手続きをいま締め切る -------------------------------------------
  const waiting = (await store.read()).league;
  assert.equal(waiting.phase?.kind, 'initial_tryout', '前提: 初期編成の決定待ち');
  assert.ok(
    Date.parse(waiting.phase.deadline) > Date.parse(now),
    '前提: 締め切りはまだ先',
  );
  // ⚠ 参加者は締め切れない（進行の主導権を握れてしまう）
  await assert.rejects(
    () => send('guest', guest, 'resolve'),
    (e) => e.status === 403,
    '参加者が手続きを締め切れる',
  );
  await send('admin', admin, 'resolve');
  const afterResolve = (await store.read()).league;
  assert.equal(afterResolve.phase?.kind, 'camp', '締め切っても次へ進まない');
  // ⚠ 未提出の人にも名簿が配られていること（標準案を当てる）
  for (const m of afterResolve.members) {
    const team = afterResolve.game.teams[m.teamName];
    assert.ok(
      team.players.length > 0,
      `${m.teamName} に選手が居ない（標準案が当たっていない）`,
    );
  }
  await send('admin', admin, 'resolve');
  const running = (await store.read()).league;
  assert.ok(!running.phase, 'キャンプが終わっていない');
  assert.equal(running.status, 'running', '開幕していない');

  // 決定待ちが無いときは断る
  await assert.rejects(
    () => send('admin', admin, 'resolve'),
    (e) => e.status === 409,
    '手続きが無いのに締め切れた',
  );

  // --- 1時間進める / まとめて進める ------------------------------------
  const before = running.season.currentDate;
  await send('admin', admin, 'step');
  const oneTurn = (await store.read()).league;
  assert.notDeepEqual(oneTurn.season.currentDate, before, '1ターン進んでいない');

  // ⚠ **まとめて進めても1日ずつ**。日付を飛ばすと間の日の試合・疲労回復が落ちる。
  //    進んだ日数で確かめる（飛ばす実装なら日数が合わない）
  const dayBefore = oneTurn.season.currentDate;
  const gamesBefore = oneTurn.season.results.length;
  await send('admin', admin, 'step', { turns: 5 }, 'x');
  const five = (await store.read()).league;
  const dayOf = (d) => Date.UTC(d.year, d.month - 1, d.day) / 86400000;
  assert.equal(
    dayOf(five.season.currentDate) - dayOf(dayBefore),
    5,
    'まとめて進めたのに日付が5日ぶん動いていない',
  );
  assert.ok(
    five.season.results.length > gamesBefore,
    'まとめて進めたのに試合が増えていない',
  );

  // 上限を超える指定は丸める（暴走させない）
  await send('admin', admin, 'step', { turns: 999 }, 'y');
  const capped = (await store.read()).league;
  assert.ok(
    dayOf(capped.season.currentDate) - dayOf(five.season.currentDate) <= 24,
    '1回で24ターンを超えて進んだ',
  );

  // --- OFFに戻せる -----------------------------------------------------
  await send('admin', admin, 'testmode', { on: false });
  assert.equal((await store.read()).league.testMode, false, 'OFFに戻せない');
  await assert.rejects(
    () => send('admin', admin, 'step'),
    (e) => e.status === 403,
    'OFFに戻したのに進められる',
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(
  '■ 検証モード: OK（既定OFF / 管理者だけ / OFFなら拒む / 手続きを締め切れる / まとめて進めても1日ずつ）',
);
