// フェーズの締め切りと自動決定の検査。
//
// ⚠ 主目的は「**1人が決めなくても週が進むこと**」。
//    非同期で遊ぶゲームなので、待ち続ける設計だと誰かの都合で全員が止まる。
// ⚠ 締め切りは曜日合わせも兼ねている。シーズンは月曜0時に始まり、
//    120ターン（24×5日）で金曜23時に終わる。そこから
//    土曜＝ストーブリーグ（締め切り 日曜0時）／日曜＝キャンプ（締め切り 月曜0時）。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  jstWeekday,
  nextWeekdayStart,
  phaseDeadlineAt,
  PHASE_WEEKDAY,
  ONLINE_SCHEMA,
  seasonStartAt,
} from '../../src/online/shared.js';
import { SEASON_TURNS } from '../../src/online/pyramidLeague.js';
import { createTestStore } from './lib/testStore.mjs';
import { LeagueService } from '../../server/leagueService.mjs';
import { defaultPhasePlan } from '../../server/leagueEngine.mjs';

// --- 日数の割り当て -------------------------------------------------
// ⚠ 120は6球団の総当たり（1巡5節）に割り切れる。144だと最後の1巡が途中で切れ、
//    相手によって対戦数が28と29に割れていた
assert.equal(SEASON_TURNS, 120);
assert.equal(SEASON_TURNS % 24, 0, '1日24ターンで割り切れる');
assert.equal(SEASON_TURNS / 24, 5, '試合は月〜金の5日');

// --- 曜日の計算 -----------------------------------------------------
// 2026-10-30T14:00Z = 10/30 23:00 JST（金曜）
assert.equal(jstWeekday('2026-10-30T14:00:00.000Z'), 5, '金曜');
assert.equal(jstWeekday('2026-10-30T15:00:00.000Z'), 6, '1時間後は土曜0時');

// ⚠ ちょうどその曜日の0時でも**次の週**を返す（先へ進むため）
const satMidnight = '2026-10-30T15:00:00.000Z'; // 土曜0時JST
assert.equal(nextWeekdayStart(satMidnight, 6), '2026-11-06T15:00:00.000Z');
assert.equal(nextWeekdayStart(satMidnight, 0), '2026-10-31T15:00:00.000Z', '翌日の日曜0時');

// --- フェーズの締め切り ---------------------------------------------
// ストーブリーグ（土曜担当）は日曜0時が締め切り
for (const kind of ['contract', 'tryout', 'offseason']) {
  assert.equal(PHASE_WEEKDAY[kind], 6, `${kind} は土曜`);
  assert.equal(
    phaseDeadlineAt(kind, satMidnight),
    '2026-10-31T15:00:00.000Z',
    `${kind} の締め切りは日曜0時`,
  );
}
// キャンプ（日曜担当）は月曜0時が締め切り
assert.equal(PHASE_WEEKDAY.camp, 0);
assert.equal(
  phaseDeadlineAt('camp', '2026-10-31T15:00:00.000Z'),
  '2026-11-01T15:00:00.000Z',
  'キャンプの締め切りは月曜0時',
);
// ⚠ **初期編成にも締め切りを置くこと**。以前は「最初の1回くらいは全員を待とう」と
//    設けなかったが、1人が決めないだけでリーグが永久に止まった（実際に止まった）。
//    時間による進行が絶対で、決めていない人は標準案で押し通す。
// ⚠ 初期編成は土曜扱い（締め切り日曜0時）。こうすると次のキャンプが月曜0時に
//    締め切られて**月曜開幕**になる。日曜扱いにすると開幕が1週間ずれる
assert.equal(PHASE_WEEKDAY.initial_tryout, 6, '初期編成が土曜扱いでない');
assert.equal(
  phaseDeadlineAt('initial_tryout', satMidnight),
  '2026-10-31T15:00:00.000Z',
  '初期編成の締め切りは日曜0時',
);
// 初期編成 → キャンプ と続けると、開幕は月曜0時になる
assert.equal(
  phaseDeadlineAt('camp', phaseDeadlineAt('initial_tryout', satMidnight)),
  '2026-11-01T15:00:00.000Z',
  '初期編成から続けたときの開幕が月曜0時でない',
);
assert.equal(phaseDeadlineAt('unknown_kind', satMidnight), null, '知らない種類は締め切り無し');

// ⚠ **担当の曜日を過ぎてから開いた手続きは、翌週まで待たせない**。
//    契約更改が日曜0時の締め切りで決まると、続くトライアウトは日曜に開く。
//    以前は「次の日曜0時」＝**7日後**が締め切りになり、1週間止まっていた
const sunOne = '2026-10-31T16:00:00.000Z'; // 日曜1時JST
assert.equal(
  phaseDeadlineAt('tryout', sunOne),
  '2026-11-01T04:00:00.000Z',
  '日曜に開いたトライアウトは12時間で締める（日曜13時）',
);
assert.equal(
  phaseDeadlineAt('offseason', '2026-11-01T05:00:00.000Z'),
  '2026-11-01T09:00:00.000Z',
  '日曜14時に開いたオフシーズンは4時間で締める（日曜18時）',
);
// 土曜のうちに開いたものは従来どおり日曜0時
assert.equal(
  phaseDeadlineAt('tryout', '2026-10-31T03:00:00.000Z'),
  '2026-10-31T15:00:00.000Z',
  '土曜に開いたトライアウトは日曜0時',
);
// 担当の曜日より前（金曜）に開いたものも、早めに締めずに日曜0時まで待つ
assert.equal(
  phaseDeadlineAt('contract', '2026-10-30T13:00:00.000Z'),
  '2026-10-31T15:00:00.000Z',
  '金曜に開いた契約更改は日曜0時',
);
// キャンプは遅れて開いても月曜0時（月曜0時が開幕の基準）
assert.equal(
  phaseDeadlineAt('camp', '2026-11-01T09:00:00.000Z'),
  '2026-11-01T15:00:00.000Z',
  'キャンプは月曜0時',
);

// ⚠ **開幕は月曜0時に揃える**。以前はキャンプが決まった次の正時に始まり、
//    火曜12時に全員が決めると火曜13時に開幕していた
assert.equal(
  seasonStartAt('2026-10-27T03:00:00.000Z'), // 火曜12時JST
  '2026-11-01T15:00:00.000Z',
  '火曜に決まったら次の月曜0時に開幕',
);
assert.equal(
  seasonStartAt('2026-11-01T15:00:05.000Z'), // 月曜0時すぎ（締め切りでの自動決定）
  '2026-11-01T16:00:00.000Z',
  '月曜に入ってから決まったら次の正時から始める（翌週まで待たせない）',
);

// --- 実際に自動決定されるか -----------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'pennant-deadline-'));
try {
  const store = createTestStore(join(dir, 'state.gz'));
  let now = '2026-10-26T15:00:00.000Z'; // 月曜0時JST
  const service = new LeagueService(store, {
    members: [{ userId: 'admin', label: '管理者' }],
    adminId: 'admin',
    clock: () => now,
  });
  const adminSession = (await service.login('admin')).sessionId;
  const run = (userId, sessionId, type, revision, payload) =>
    service.command(userId, sessionId, {
      requestId: `${type}-${revision}-${userId}`,
      revision,
      type,
      payload,
    });

  await run('admin', adminSession, 'create', 0);
  // 2人目を入れる（1人だと提出した時点で必ず揃ってしまう）
  let view = await service.view('admin', adminSession);
  // ⚠ **本物のリーグから作ったビューに版の印が載ること**。
  //    印が無いと `LeagueService.view` が全部「古い形式です」で止める。
  //    `online-config-check` は作り物のビューで門番を見ているので、
  //    印を付け忘れた側はここでしか捕まらない（実際に取りこぼした）。
  assert.equal(view.schema, ONLINE_SCHEMA, 'ビューに版の印が無い');
  const guest = (await service.login('guest')).sessionId;
  await run('guest', guest, 'join', (await store.read()).league.revision, {
    teamName: 'テスト球団',
  });

  // ⚠ **誰も提出していなくても、締め切りで開幕まで進むこと**。
  //    ここが「時間による進行が絶対」の本体。初期編成→キャンプ→開幕が
  //    1回の定期処理で通る（締め切りがどちらも過去になっているため）
  const league = (await store.read()).league;
  assert.equal(league.phase.kind, 'initial_tryout');
  assert.ok(league.phase.deadline, '初期編成に締め切りが無い');
  // ⚠ **手続きは1回の定期処理につき1つずつ解決する**。次の手続きの締め切りは
  //    「開いた時刻」から数えるので、まとめて片付きはしない。それでよい——
  //    止まらないことが大事で、急いで進めることが目的ではない
  // ⚠ **保存した下書きは、締め切りでもそのまま使うこと**。以前は下書きを捨てて
  //    標準案で決めていた（契約更改で「誰も解雇しない」と保存した球団が、
  //    標準案どおりに解雇された）。
  // ⚠ 下書きは「相手球団が先に取りそうな選手だけ・捕手なし」の希望順位にする。
  //    以前は希望の候補が全員取られると指名を見送り続け、巡目が尽きて
  //    捕手・野手が足りないまま「トライアウト全体が解決できない」で止まった。
  const guestTeam = league.members.find((m) => m.userId === 'guest').teamName;
  const adminTeam = league.members.find((m) => m.userId === 'admin').teamName;
  const byId = new Map(league.phase.candidates.map((p) => [p.id, p]));
  const contested = defaultPhasePlan(league, adminTeam)
    .rankedIds.filter((id) => byId.get(id).position !== 'catcher')
    .slice(0, 12);
  await run('guest', guest, 'submit', league.revision, {
    phaseId: league.phase.id,
    plan: { count: 12, rankedIds: contested },
    ready: false,
    baseSubmission: null,
  });
  now = league.phase.deadline;
  const first = await service.tick();
  assert.ok(first.advanced, '締め切りを過ぎても進まない');
  assert.deepEqual(first.autoResolved, ['initial_tryout'], '初期編成が自動決定されない');
  const camped = (await store.read()).league;
  assert.equal(camped.phase?.kind, 'camp', '初期編成の次はキャンプ');
  {
    const roster = camped.game.teams[guestTeam].players;
    // 標準案は24人取る。下書きは12人まで（希望が先に取られたぶんは最低限の補充だけ）
    assert.equal(defaultPhasePlan(league, guestTeam).count, 24, '前提: 標準案は24人');
    assert.ok(
      roster.length >= 9 && roster.length <= 12,
      `保存した下書きが使われていない（${roster.length}人）`,
    );
    assert.ok(
      roster.some((p) => p.position === 'catcher'),
      '希望の候補が尽きた球団に捕手が補われていない',
    );
    assert.ok(roster.some((p) => p.position === 'pitcher'), '投手がいない');
    assert.ok(roster.filter((p) => p.position !== 'pitcher').length >= 8, '野手が足りない');
  }
  assert.ok(camped.phase.deadline, 'キャンプに締め切りが無い');
  // ⚠ 開幕は**月曜0時**。初期編成を土曜扱いにしてあるのはこのため
  assert.equal(jstWeekday(camped.phase.deadline), 1, '開幕が月曜でない');

  // ⚠ **キャンプ（手続き中）でも打順を保存でき、開幕後もその打順が残ること**。
  //    以前は手続き中の保存を「この期間は編成変更できません」で弾き、
  //    さらにキャンプの解決で全球団の打順をおすすめに作り直していた。
  const guestView = await service.view('guest', guest);
  const swapped = guestView.lineup.battingOrder.map((e) => ({ ...e }));
  const leadoff = swapped.find((e) => e.battingOrder === 1);
  const twoHole = swapped.find((e) => e.battingOrder === 2);
  [leadoff.playerId, twoHole.playerId] = [twoHole.playerId, leadoff.playerId];
  [leadoff.position, twoHole.position] = [twoHole.position, leadoff.position];
  await run('guest', guest, 'lineup', guestView.revision, {
    ...guestView.lineup,
    battingOrder: swapped,
    baseLineup: guestView.lineup,
  });
  const savedOrder = swapped
    .sort((a, b) => a.battingOrder - b.battingOrder)
    .map((e) => e.playerId);

  now = camped.phase.deadline;
  // ⚠ **自動決定が失敗したら、止めて理由を残すこと**。以前はログに出すだけで
  //    保存を変えず、毎時同じ失敗を黙って繰り返していた（誰も気づけない）
  {
    const engine = service.engine;
    service.engine = async () => {
      throw new Error('検査用の失敗');
    };
    await service.tick();
    service.engine = engine;
    const stopped = (await store.read()).league;
    assert.equal(stopped.status, 'error', '自動決定の失敗で止まっていない');
    assert.match(stopped.error, /締め切りの自動決定に失敗しました（検査用の失敗）/);
    // 止めている間は、定期処理でやり直さない
    assert.deepEqual(await service.tick(), { advanced: false });
    assert.equal((await store.read()).league.status, 'error');
    // 管理者が再開すると待機に戻り、次の定期処理でやり直す
    await run('admin', adminSession, 'resume', stopped.revision);
    const resumed = (await store.read()).league;
    assert.equal(resumed.status, 'waiting', '再開で待機に戻らない');
    assert.ok(!resumed.error, '再開しても理由が残っている');
  }
  const second = await service.tick();
  assert.deepEqual(second.autoResolved, ['camp'], 'キャンプが自動決定されない');
  const opened = (await store.read()).league;
  assert.ok(!opened.phase, '手続きが残っている');
  assert.equal(opened.status, 'running', '誰も提出していないのに開幕しない');
  assert.deepEqual(
    opened.game.teams[guestTeam].lineupSettings.battingOrder
      .filter((e) => e.position !== 'pitcher')
      .sort((a, b) => a.battingOrder - b.battingOrder)
      .map((e) => e.playerId),
    savedOrder,
    'キャンプ中に保存した打順が開幕で作り直された',
  );

  // ⚠ **全員が提出したら締め切り前でも進むこと**。時間は下限であって、
  //    待たせるためのものではない。別のリーグを立てて、その経路を見る
  const dir2 = await mkdtemp(join(tmpdir(), 'pennant-deadline2-'));
  try {
    const store2 = createTestStore(join(dir2, 'state.gz'));
    let clock2 = '2026-10-26T15:00:00.000Z';
    const service2 = new LeagueService(store2, {
      members: [{ userId: 'admin', label: '管理者' }],
      adminId: 'admin',
      clock: () => clock2,
    });
    const s2 = (await service2.login('admin')).sessionId;
    await service2.command('admin', s2, {
      requestId: 'create-2',
      revision: 0,
      type: 'create',
    });
    for (let i = 0; i < 4; i += 1) {
      const current = (await store2.read()).league;
      if (!current.phase) break;
      const teamName = current.members[0].teamName;
      await service2.command('admin', s2, {
        requestId: `submit2-${i}`,
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
    const done = (await store2.read()).league;
    assert.ok(!done.phase, '全員が提出しても手続きが残っている');
    assert.equal(done.status, 'running', '全員が提出しても開幕しない');
    // ⚠ 早く決まっても開幕は**月曜0時**のまま（`seasonStartAt`）。以前は
    //    提出の処理の最後で次の正時に書き換わり、火曜開幕になっていた
    assert.equal(
      done.nextAdvanceAt,
      seasonStartAt(clock2),
      '全員が早く決めたときに開幕が月曜0時からずれた',
    );
    assert.equal(jstWeekday(done.nextAdvanceAt), 1, '開幕が月曜でない');
    // ⚠ 締め切りより前でも開幕する（待たせない）
    assert.ok(
      Date.parse(clock2) < Date.parse(opened.phase?.deadline || '2999-01-01'),
      '前提: まだ締め切り前',
    );
  } finally {
    await rm(dir2, { recursive: true, force: true });
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(
  '■ 締め切りと自動決定: OK（120ターン / 初期編成にも締め切り / 誰も提出しなくても月曜に開幕 / 全員提出なら締め切り前でも開幕・それでも開幕は月曜 / 下書きは締め切りでも使う / 希望が尽きても最低限を補う / キャンプ中に保存した打順が開幕後も残る）',
);
