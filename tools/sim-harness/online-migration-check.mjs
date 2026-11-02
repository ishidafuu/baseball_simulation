// 保存されたリーグを新しい形へ直す仕組みの検査。
//
// ⚠ 主目的は「**更新のたびにリーグを作り直さずに済むこと**」。
//    オンラインは保存が1つしかないので、形を変えた瞬間に全員の成績が消える、
//    しか選べなかった。実際に一度それをやっている。
// ⚠ **`ONLINE_SCHEMA` を上げたら、同じコミットで `MIGRATIONS` に1段足すこと。**
//    足し忘れをここで落とす。これがこの検査の一番の仕事。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestStore } from './lib/testStore.mjs';
import { LeagueService } from '../../server/leagueService.mjs';
import { ONLINE_SCHEMA, ONLINE_ENGINE_VERSION } from '../../src/online/shared.js';
import {
  MIGRATIONS,
  OLDEST_MIGRATABLE,
  migrationChain,
  migrationState,
  migrateLeague,
  isCurrent,
} from '../../src/online/leagueMigration.js';

// --- 手順表そのもの --------------------------------------------------
// ⚠ ここが本丸。版を上げて段を足し忘れると、ここで止まる
const chain = migrationChain();
assert.deepEqual(
  chain.problems,
  [],
  `移行の手順表が繋がっていない:\n${chain.problems.join('\n')}`,
);
assert.equal(
  chain.reaches,
  ONLINE_SCHEMA,
  `手順の終わりが ${chain.reaches}。ONLINE_SCHEMA は ${ONLINE_SCHEMA}`,
);
// 段は1つずつ、飛ばさず、重複なく並んでいる
assert.equal(
  new Set(MIGRATIONS.map((s) => s.from)).size,
  MIGRATIONS.length,
  '同じ版からの段が2つある',
);

// ⚠ **この照合そのものが効いているか**を確かめる。段がまだ0本なので、
//    いまの表だけ見ても「問題なし」は当たり前に出てしまい、
//    照合を外しても気づけない（実際、最初はここを取りこぼした）。
//    作り物の表を渡して、壊れた形がちゃんと問題として挙がることを見る。
const step = (from, to) => ({ from, to, note: `${from}→${to}`, apply: () => {} });
const problemsOf = (steps, oldest, target) =>
  migrationChain({ steps, oldest, target }).problems;
// 版を上げたのに段を足さなかった ← いちばん起きやすい間違い
assert.ok(
  problemsOf([], 2, 3).length > 0,
  '版を上げて段を足し忘れても通ってしまう',
);
assert.ok(
  problemsOf([step(2, 3)], 2, 3).length === 0,
  '正しい手順を問題扱いしている',
);
// 飛ばした / 重ねた / 2つ分いっぺんに上げた
assert.ok(problemsOf([step(2, 3), step(4, 5)], 2, 5).length > 0, '段の飛びを見逃す');
assert.ok(problemsOf([step(2, 4)], 2, 4).length > 0, '2つ分の段を見逃す');
assert.ok(problemsOf([step(3, 4)], 2, 4).length > 0, '最初の段が無いのを見逃す');
// note と apply が無い段も弾く（移行の内容が分からなくなる）
assert.ok(
  migrationChain({ steps: [{ from: 2, to: 3, apply: () => {} }], oldest: 2, target: 3 })
    .problems.length > 0,
  'note の無い段を見逃す',
);
assert.ok(
  migrationChain({ steps: [{ from: 2, to: 3, note: 'x' }], oldest: 2, target: 3 })
    .problems.length > 0,
  'apply の無い段を見逃す',
);

// --- どの版をどう扱うか ----------------------------------------------
const league = (overrides) => ({
  schema: ONLINE_SCHEMA,
  engineVersion: ONLINE_ENGINE_VERSION,
  ...overrides,
});
assert.equal(migrationState(null).state, 'none');
assert.equal(migrationState(league()).state, 'current');
assert.ok(isCurrent(league()));

// ⚠ **新しすぎる保存を古いコードで触らない**。巻き戻すと、新しい版で書かれた
//    内容を落としたまま保存し直すことになる
const future = migrationState(league({ schema: ONLINE_SCHEMA + 1 }));
assert.equal(future.state, 'blocked');
assert.ok(future.reason.includes('新しい'), future.reason);

// 作り直すしかない版は、そう言う
const ancient = migrationState(league({ schema: OLDEST_MIGRATABLE - 1 }));
assert.equal(ancient.state, 'blocked');
assert.ok(ancient.reason.includes('作り直'), ancient.reason);

// 試合の計算方法が変わったら、形を直しても意味がない
const otherEngine = migrationState(league({ engineVersion: 'online-x' }));
assert.equal(otherEngine.state, 'blocked');

// 版が数でないもの（壊れた保存）も止める
for (const broken of [{}, { schema: 'two' }, { schema: null }])
  assert.equal(
    migrationState({ engineVersion: ONLINE_ENGINE_VERSION, ...broken }).state,
    'blocked',
    JSON.stringify(broken),
  );

// 直せない保存に `migrateLeague` を当てたら、黙って壊さず例外にする
assert.throws(
  () => migrateLeague(league({ schema: ONLINE_SCHEMA + 1 })),
  (e) => e.status === 409 && e.code === 'version',
);
// 直す必要が無いものは、何もしない
assert.deepEqual(migrateLeague(league()), { applied: [], changed: false });

// --- 作り物の手順で、実際に段が当たるか -------------------------------
// ⚠ いまは段が0本（版を上げていない）。段が入ったときに動くことを、
//    同じ `migrateLeague` に作り物の手順を渡して確かめる。
{
  const steps = [
    { from: 2, to: 3, note: 'aを足す', apply: (l) => { l.a ??= 1; } },
    { from: 3, to: 4, note: 'bを足す', apply: (l) => { l.b ??= 2; } },
  ];
  // `migrationState` と同じ選び方で、下から順に当てる
  const run = (start) => {
    const l = { schema: start, engineVersion: ONLINE_ENGINE_VERSION };
    for (const s of steps.filter((s) => s.from >= start)) {
      s.apply(l);
      l.schema = s.to;
    }
    return l;
  };
  assert.deepEqual(run(2), { schema: 4, engineVersion: ONLINE_ENGINE_VERSION, a: 1, b: 2 });
  // ⚠ 途中の版から始めたら、その先だけ当たる（既に済んだ段を当て直さない）
  assert.deepEqual(run(3), { schema: 4, engineVersion: ONLINE_ENGINE_VERSION, b: 2 });
  // ⚠ **何度当てても同じ結果になること**（途中で失敗したらやり直すため）
  const once = run(2);
  const twice = { ...once };
  for (const s of steps) s.apply(twice);
  assert.deepEqual(twice, once, '2回当てると結果が変わる手順がある');
}

// --- 本物のリーグで、命令と定期処理が直すか ---------------------------
const dir = await mkdtemp(join(tmpdir(), 'pennant-migrate-'));
try {
  const store = createTestStore(join(dir, 'state.gz'));
  const now = '2026-10-26T15:00:00.000Z';
  const service = new LeagueService(store, {
    members: [{ userId: 'admin', label: '管理者' }],
    adminId: 'admin',
    clock: () => now,
  });
  const sessionId = (await service.login('admin')).sessionId;
  await service.command('admin', sessionId, {
    requestId: 'create-0',
    revision: 0,
    type: 'create',
  });

  // 版が合っているうちは、ふつうに見える
  const okView = await service.view('admin', sessionId);
  assert.ok(!okView.versionMismatch, '版が合っているのに止めている');
  assert.equal(okView.schema, ONLINE_SCHEMA);

  // ⚠ **古い形のまま投影しないこと**。ビューには最新の版の印を押すので、
  //    中身が古いまま投影すると「新しい形です」と嘘になる。
  // ⚠ ここで使う版は **`OLDEST_MIGRATABLE - 1`**（＝直せない版）。
  //    「いまの版-1」にすると、段が増えた瞬間に“直せる版”に変わって
  //    この区画の意味が消える（実際に段を1本入れた時に変わった）。
  const UNMIGRATABLE = OLDEST_MIGRATABLE - 1;
  await store.transaction((bundle) => {
    bundle.league.schema = UNMIGRATABLE;
    return { value: null };
  });
  const blockedView = await service.view('admin', sessionId);
  assert.ok(blockedView.versionMismatch, '古い形のまま投影している');
  assert.ok(!('teamName' in blockedView), '古いリーグの中身が漏れている');
  assert.equal(blockedView.isAdmin, true);
  assert.equal(blockedView.canMigrate, false, '直せない版を直せると言っている');

  // ⚠ 直せない形でも、定期処理が例外で落ちないこと（毎正時が止まる）
  assert.deepEqual(await service.tick(), { advanced: false }, '定期処理が落ちた');
  // 直せないので保存は古いまま（黙って半分だけ直さない）
  assert.equal((await store.read()).league.schema, UNMIGRATABLE);

  // 取り込みの命令も、理由を返して止まる
  await assert.rejects(
    () =>
      service.command('admin', sessionId, {
        requestId: 'migrate-0',
        revision: 0,
        type: 'migrate',
      }),
    (e) => e.status === 409 && e.code === 'version',
  );

  // 版を戻せば、また普通に使える（検査が版だけで止めていることの確認）
  await store.transaction((bundle) => {
    bundle.league.schema = ONLINE_SCHEMA;
    return { value: null };
  });
  const back = await service.view('admin', sessionId);
  assert.ok(!back.versionMismatch);
  assert.equal(back.teamName, (await store.read()).league.members[0].teamName);

  // ⚠ 取り込みは**版の照合を飛ばす**こと。古い形の画面は revision を
  //    持っていないので、照合すると取り込みボタンが押せない
  const live = (await store.read()).league;
  assert.ok(live.revision > 0, '前提: revision が進んでいる');
  const res = await service.command('admin', sessionId, {
    requestId: 'migrate-1',
    revision: 0,
    type: 'migrate',
  });
  assert.deepEqual(res, { ok: true, applied: [] }, '取り込みが revision で弾かれた');
  // ⚠ 取り込みで revision を上げないこと（送信中の提出が弾かれる）
  assert.equal((await store.read()).league.revision, live.revision, 'revisionが動いた');
  // 取り込みのあとも中身はそのまま（段が0本なので当たり前だが、
  // 「取り込み＝作り直し」に実装が変わったら、ここで落ちる）
  assert.equal(
    (await store.read()).league.members[0].teamName,
    live.members[0].teamName,
    '取り込みで球団が入れ替わっている',
  );

  // --- 本物の段で、直って保存されるか ---------------------------------
  // ⚠ 本物のリーグを1つ古い版へ落として、命令・定期処理・ふつうの操作の
  //    どれでも直ることを見る。段が0本だった頃は手順表を差し替える口を
  //    付けていたが、2→3 の段が入ったので本物で通せるようになった。
  const upgradable = service;
  // ⚠ **いちばん古い直せる版まで落とすこと**。`ONLINE_SCHEMA - 1` にすると
  //    最後の段しか当たらず、途中の段が壊れていても気づけない
  //    （段が2本になった時に実際に取りこぼした）。
  // ⚠ 各段が当たったことを**別々の目印**で見る。
  //    2→3 は `invites` が消えること、3→4 は `testMode` が入ること。
  const downgrade = () =>
    store.transaction((bundle) => {
      bundle.league.schema = OLDEST_MIGRATABLE;
      bundle.league.invites = [{ code: 'OLD', usedBy: null }];
      delete bundle.league.testMode;
      // ⚠ **締め切りの無い手続き**を作る。初期編成には締め切りが無かったので、
      //    1人が決めないだけでリーグが永久に止まっていた。止まったままの
      //    リーグを、移行のときに時間で進む形へ直せることを見る
      if (bundle.league.phase) bundle.league.phase.deadline = null;
      return { value: null };
    });
  /** 全部の段が当たったか */
  const migrated = (league) =>
    !league.invites &&
    league.testMode === false &&
    (!league.phase || !!league.phase.deadline);

  // 1) 取り込みの命令で直る
  await downgrade();
  const before = (await store.read()).league;
  assert.ok((await upgradable.view('admin', sessionId)).versionMismatch, '古い形を通している');
  const applied = await upgradable.command('admin', sessionId, {
    requestId: 'migrate-2',
    revision: 0,
    type: 'migrate',
  });
  assert.equal(applied.ok, true);
  assert.equal(
    applied.applied.length,
    ONLINE_SCHEMA - OLDEST_MIGRATABLE,
    `当てた段の数がちがう: ${JSON.stringify(applied.applied)}`,
  );
  const fixed = (await store.read()).league;
  assert.equal(fixed.schema, ONLINE_SCHEMA, '直した形が保存されていない');
  assert.ok(
    migrated(fixed),
    `段が当たっていない: ${JSON.stringify({ invites: fixed.invites, testMode: fixed.testMode, deadline: fixed.phase?.deadline })}`,
  );
  // ⚠ 止まっていた手続きが、時間で進む形になっていること
  assert.ok(
    fixed.phase && Date.parse(fixed.phase.deadline) > 0,
    '締め切りの無い手続きが残っている（永久に止まる）',
  );
  // ⚠ 取り込みで revision を上げない（送信中の提出が弾かれる）
  assert.equal(fixed.revision, before.revision, '取り込みで revision が動いた');
  // 中身は保たれている
  assert.equal(fixed.members[0].teamName, before.members[0].teamName);
  assert.equal(fixed.game.teams[fixed.members[0].teamName].players.length,
    before.game.teams[before.members[0].teamName].players.length,
    '移行で名簿が変わっている');
  // 直った後は普通に見える
  const healed = await upgradable.view('admin', sessionId);
  assert.ok(!healed.versionMismatch, '直したのにまだ止めている');
  assert.equal(healed.teamName, before.members[0].teamName);

  // 2) もう一度取り込んでも、何も起きない（段を二重に当てない）
  const again = await upgradable.command('admin', sessionId, {
    requestId: 'migrate-3',
    revision: 0,
    type: 'migrate',
  });
  assert.deepEqual(again.applied, [], '済んだ段をもう一度当てている');
  assert.ok(migrated((await store.read()).league), '取り込み後に古い形へ戻っている');

  // 3) 誰も操作しなくても、定期処理で直る
  await downgrade();
  await upgradable.tick();
  const byTick = (await store.read()).league;
  assert.equal(byTick.schema, ONLINE_SCHEMA, '定期処理で直っていない');
  assert.ok(migrated(byTick), '定期処理で段が当たっていない');

  // 4) ふつうの命令でも直る（取り込みボタンを押さなくても、誰かが何かすれば直る）
  await downgrade();
  const stale2 = (await store.read()).league;
  await upgradable.command('admin', sessionId, {
    requestId: 'backup-0',
    revision: stale2.revision,
    type: 'backup',
  });
  const byCommand = (await store.read()).league;
  assert.equal(byCommand.schema, ONLINE_SCHEMA, 'ふつうの命令で直っていない');
  assert.ok(migrated(byCommand), 'ふつうの命令で段が当たっていない');
  // 命令そのものも実行されていること（移行だけして本題を落とさない）
  assert.ok((await store.read()).backup, '命令そのものが実行されていない');
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(
  `■ 保存の移行: OK（手順が${MIGRATIONS.length}段で${ONLINE_SCHEMA}に届く / 新しすぎる保存を触らない / 直せなくても止まらない / 命令・定期処理・取り込みのどれでも直る）`,
);
