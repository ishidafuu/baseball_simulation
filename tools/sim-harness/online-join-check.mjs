// 参加をAPIの経路で通す検査。
//
// ⚠ 主目的は「**まだ参加していない人が実際に入れること**」。
//    参加の道には鶏と卵の罠がある——参加するにはログインが要るが、
//    ログインに参加者であることを求めると、呼ばれた人は永遠に入れない。
//    ここでその経路を丸ごと通す。
// ⚠ 招待コードは廃止した。アカウントは管理者が Supabase で作らない限り
//    増えないので、入口はそこで絞れている。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestStore } from './lib/testStore.mjs';
import { LeagueService } from '../../server/leagueService.mjs';
import { PYRAMID_LEAGUES } from '../../src/online/pyramidLeague.js';

const dir = await mkdtemp(join(tmpdir(), 'pennant-join-'));
try {
  const store = createTestStore(join(dir, 'state.gz'));
  const service = new LeagueService(store, {
    members: [{ userId: 'admin', label: '管理者' }],
    adminId: 'admin',
    clock: () => '2026-10-30T00:00:00.000Z',
  });

  const adminSession = (await service.login('admin')).sessionId;
  const run = (userId, sessionId, type, revision, payload) =>
    service.command(userId, sessionId, {
      requestId: `${type}-${revision}-${userId}`,
      revision,
      type,
      payload,
    });

  // --- リーグを作る（管理者だけ） -----------------------------------
  await run('admin', adminSession, 'create', 0);
  let view = await service.view('admin', adminSession);
  assert.ok(view.teamName, '管理者に球団が割り当たる');
  const bottomTier = Math.max(...PYRAMID_LEAGUES.map((l) => l.tier));
  const league0 = (await store.read()).league;
  assert.equal(
    league0.teams.find((t) => t.name === view.teamName).league,
    PYRAMID_LEAGUES.find((l) => l.tier === bottomTier).id,
    '最下層から始まる',
  );

  // --- まだ参加していない人 -----------------------------------------
  // ⚠ ログインは通る（通さないと参加の画面に来られない）
  const guestSession = (await service.login('guest')).sessionId;
  const guestView = await service.view('guest', guestSession);
  assert.ok(guestView.joinRequired, '参加前は「参加が必要」と返す');
  assert.ok(!guestView.teamName, '球団はまだ持たない');
  assert.equal(guestView.isAdmin, false);
  assert.ok(Number.isInteger(guestView.revision), '参加の命令に使う版が無い');

  // --- そのまま参加できる --------------------------------------------
  const before = league0.members.length;
  await run('guest', guestSession, 'join', guestView.revision, {
    teamName: '多摩川ブリーズ',
  });
  const league2 = (await store.read()).league;
  assert.equal(league2.members.length, before + 1, '参加者が増える');
  // ⚠ **revision が進むこと**。楽観ロックの要で、進め忘れると2人が同時に
  //    操作したとき片方が黙って消える。操作ごとに直接押さえる
  assert.ok(league2.revision > league0.revision, '参加で revision が進む');
  const joined = league2.members.find((m) => m.userId === 'guest');
  assert.ok(joined, '参加者として記録される');
  assert.equal(joined.displayName, '多摩川ブリーズ');
  // ⚠ 内部名は引き継いだ球団のまま（記録の選手キーが迷子になるため）
  assert.ok(
    league2.teams.some(
      (t) => t.name === joined.teamName && t.displayName === '多摩川ブリーズ',
    ),
    '表示名だけを付け替える',
  );
  assert.equal(league2.teams.length, 12, '球団数は変わらない');
  assert.equal(
    league2.teams.find((t) => t.name === joined.teamName).league,
    PYRAMID_LEAGUES.find((l) => l.tier === bottomTier).id,
    '途中参加は最下層に入る',
  );

  // 参加後は自分の球団が見える
  const afterView = await service.view('guest', guestSession);
  assert.ok(!afterView.joinRequired, '参加後は「参加が必要」を返さない');
  assert.equal(afterView.teamName, joined.teamName);

  // ⚠ **付けた球団名が画面に届くこと**。内部名は記録の選手キーまで貫いていて
  //    変えられないので、表示名は別に渡す。これが無いと、名前を付けても
  //    画面には引き継いだCPU球団の名前が出たまま（実際にそうなっていた）。
  assert.equal(
    afterView.teamLabels[joined.teamName].label,
    '多摩川ブリーズ',
    '付けた球団名が表示用に渡っていない',
  );
  assert.ok(
    afterView.teamLabels[joined.teamName].short,
    '短い表記が無い（試合一覧で空欄になる）',
  );
  // ⚠ 名前を変えていない球団は内部名のまま返す（表が歯抜けだと素の名前が出ない）
  const untouched = league2.teams.find((t) => !t.displayName);
  assert.equal(afterView.teamLabels[untouched.name].label, untouched.name);
  // 管理者から見ても同じ表が届く（順位表は全球団ぶん必要）
  const adminAfter = await service.view('admin', adminSession);
  assert.equal(
    Object.keys(adminAfter.teamLabels).length,
    league2.teams.length,
    '順位表に出す全球団ぶんの表示名が無い',
  );
  assert.equal(
    adminAfter.teamLabels[joined.teamName].label,
    '多摩川ブリーズ',
    '他の人が付けた球団名が見えない',
  );

  // --- 二重参加は断る -------------------------------------------------
  await assert.rejects(
    () => run('guest', guestSession, 'join', league2.revision, { teamName: '別名' }),
    /すでに参加しています/,
  );
  // ⚠ 別の人は**何も要らずに**入れる。ここが「コード不要」の本体
  const other = (await service.login('other')).sessionId;
  await run('other', other, 'join', league2.revision, { teamName: '湘南サンズ' });
  const league3 = (await store.read()).league;
  assert.equal(league3.members.length, before + 2, '2人目が入れない');
  assert.ok(
    league3.members.some((m) => m.userId === 'other'),
    '2人目が記録されていない',
  );

  // ⚠ 参加していない人も**ログアウトできる**こと。参加画面にも「ログアウト」があり、
  //    以前は403で抜けられなかった
  const visitor = (await service.login('visitor')).sessionId;
  assert.deepEqual(await service.logout('visitor', visitor), { ok: true });
  assert.ok(!(await store.read()).sessions.visitor, 'セッションが消えていない');

  console.log(
    '■ 参加: OK（非参加者もログインできる / コード不要で入れる / 二重参加は断る / 最下層へ入る / 付けた球団名が画面に届く / 非参加者もログアウトできる）',
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
