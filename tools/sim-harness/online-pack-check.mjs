// 初期メンバーセット（20セット・各24人）の検査。
//
// ⚠ 主目的は「**どのセットを選んでも不利にならないこと**」。選ぶ時点では
//    中身しか見えないので、合計の力がばらつくと「当たりのセット」を
//    引いたかどうかで勝負が決まってしまう。
// ⚠ **同じセットを2球団に渡さないこと**。選手のidと名前が重複すると、
//    記録がどちらの選手のものか分からなくなる。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../../server/storage/fileStore.mjs';
import { LeagueService } from '../../server/leagueService.mjs';
import {
  defaultPhasePlan,
  openPhase,
  loadLeagueWorld,
} from '../../server/leagueEngine.mjs';
import { captureWorld } from '../../server/worldSnapshot.mjs';
import { packWaiting, pendingProcedure } from '../../src/online/notices.js';
import { projectLeague } from '../../server/projection.mjs';
import { jstWeekday } from '../../src/online/shared.js';
import {
  generateRosterPacks,
  packSummary,
  packScore,
  packPlayerScore,
  packSlotType,
  packsForMember,
  PACK_COUNT,
  PACK_SIZE,
  PACK_RANKS,
  PACK_MAX_AGE,
  PACK_AGE_WEIGHTS,
  YOUNG_PACK_STYLE,
  PACK_SHAPES,
  PACK_RANK_PATTERNS,
  PACK_RANK_SHIFT_V2,
  PACK_STYLE,
  LEGACY_PACK_STYLE,
} from '../../src/online/rosterPack.js';

// --- セットそのもの ---------------------------------------------------
// ⚠ 版2（いまの作り方）は**セットごとに構成と格の内訳が違う**（いしだ指摘:
//    固定だと悩みどころが無い）。そのぶん「どれを選んでも損にならない」は
//    型の決まり（格の点の合計・名簿が成り立つ人数）と、同じ枠の平均からの
//    上振れの合計で見る。
const packs = generateRosterPacks(20261103);
assert.equal(packs.length, PACK_COUNT, 'セット数がちがう');
const rankPoints = (ranks) => (ranks.A || 0) * 3 + (ranks.B || 0) * 2 + (ranks.C || 0);
for (const shape of PACK_SHAPES) {
  const total = ['pitcher', 'catcher', 'infield', 'outfield', 'twoWayPitcher', 'twoWayFielder']
    .reduce((n, k) => n + shape[k], 0);
  assert.equal(total, PACK_SIZE, `構成の型 ${shape.id} の人数が${PACK_SIZE}人でない`);
  // ⚠ 名簿が成り立つ最低限（ローテと中継ぎ・スタメン8人＋控え）
  assert.ok(shape.pitcher + shape.twoWayPitcher >= 10, `${shape.id} の投手が少なすぎる`);
  assert.ok(shape.catcher >= 2, `${shape.id} の捕手が少なすぎる`);
  // ⚠ どの守備のまとまりにも控えが1人は居ること（居ないとレギュラーが疲れても休めない。
  //    外野3人の型で、通年の検査の中堅手が疲労471まで積み上がった）
  assert.ok(shape.infield >= 5, `${shape.id} に内野の控えが居ない`);
  assert.ok(shape.outfield >= 4, `${shape.id} に外野の控えが居ない`);
}
for (const pattern of PACK_RANK_PATTERNS) {
  const n = Object.values(pattern.ranks).reduce((a, b) => a + b, 0);
  assert.equal(n, PACK_SIZE, `格の型 ${pattern.id} の人数がちがう`);
  // ⚠ **点の合計が全部同じ**（段差が等間隔なので、力の総量が同じになる）
  assert.equal(rankPoints(pattern.ranks), rankPoints(PACK_RANK_PATTERNS[0].ranks), `格の型 ${pattern.id} の点の合計がちがう`);
}
assert.equal(
  PACK_RANK_SHIFT_V2.A - PACK_RANK_SHIFT_V2.B,
  PACK_RANK_SHIFT_V2.B - PACK_RANK_SHIFT_V2.C,
  '格の段差が等間隔でない（型によって得をする）',
);
// ⚠ 本当にばらけていること（全部同じ型だと固定と変わらない）
for (const seed of [20261103, 777, 42]) {
  const list = generateRosterPacks(seed);
  assert.ok(new Set(list.map((p) => p.shape)).size >= 4, `シード${seed} で構成の型が偏っている`);
  assert.ok(new Set(list.map((p) => p.pattern)).size >= 4, `シード${seed} で格の型が偏っている`);
  assert.ok(new Set(list.map((p) => p.feature)).size >= 12, `シード${seed} で同じ型のセットが多すぎる`);
}

for (const pack of packs) {
  const summary = packSummary(pack);
  const shape = PACK_SHAPES.find((s) => s.id === pack.shape);
  const pattern = PACK_RANK_PATTERNS.find((s) => s.id === pack.pattern);
  assert.ok(shape && pattern, `${pack.id} の型が読めない`);
  assert.equal(summary.feature, pack.feature, `${pack.id} の特徴が要約に載っていない`);
  assert.equal(pack.players.length, PACK_SIZE, `${pack.id} の人数がちがう`);
  // 格の内訳は型どおり（0人の格は数えない）
  const ranks = Object.fromEntries(Object.entries(pattern.ranks).filter(([, n]) => n > 0));
  assert.deepEqual(summary.ranks, ranks, `${pack.id} の格の内訳が型とちがう`);
  assert.equal(summary.twoWay, shape.twoWayPitcher + shape.twoWayFielder, `${pack.id} の二刀流の人数がちがう`);
  assert.equal(summary.counts.pitcher, shape.pitcher + shape.twoWayPitcher, `${pack.id} の投手数がちがう`);
  assert.equal(summary.counts.catcher, shape.catcher, `${pack.id} の捕手数がちがう`);
  // ⚠ **8つの守備位置がそろい、内野の控えは遊撃手か三塁手**。以前は枠の種類に守備位置を
  //    含めておらず、内野のBが全員一塁手・三塁手が居ない、という形で配られていた
  //    （控えが守れず、通年の検査でレギュラーの疲労が470を超えた）
  {
    const fielders = pack.players.filter((p) => p.position !== 'pitcher' && !p.isTwoWay);
    const count = (pos) => fielders.filter((p) => p.position === pos).length;
    for (const pos of ['catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'])
      assert.ok(count(pos) >= 1, `${pack.id} に${pos}が居ない`);
    assert.equal(count('first'), 1, `${pack.id} の一塁手の控えは遊撃・三塁を守れない`);
    assert.equal(count('second'), 1, `${pack.id} の二塁手の控えは三塁・一塁を守れない`);
    assert.equal(
      count('short') + count('third') - 2,
      shape.infield - 4,
      `${pack.id} の内野の控えが遊撃手・三塁手でない`,
    );
  }
  for (const p of pack.players) {
    assert.ok(
      p.age >= 19 && p.age <= PACK_AGE_WEIGHTS.at(-1).age,
      `${p.name} の年齢が範囲外: ${p.age}`,
    );
    assert.ok(p.name && p.id, '名前かidが空');
    // ⚠ 作るときの印を選手に残さない（名簿に入ると保存に残る）
    assert.equal(p.packGroup, undefined, `${p.name} に作るときの印が残っている`);
  }
  // ⚠ セットの中で選手が重複しない
  assert.equal(
    new Set(pack.players.map((p) => p.id)).size,
    PACK_SIZE,
    `${pack.id} に同じ選手が2人いる`,
  );
}

// ⚠ **セット同士の釣り合い**（この検査の本丸）。構成が違うセットは合計の点では
//    比べられない（投手と野手で物差しが違う）ので、「同じ枠（守備のまとまり×格）の
//    平均よりどれだけ上か」の合計を比べる。実測で開きは1%前後。
for (const seed of [20261103, 777, 42, 1]) {
  const list = generateRosterPacks(seed);
  const byType = {};
  for (const p of list.flatMap((x) => x.players))
    (byType[packSlotType(p)] ||= []).push(packPlayerScore(p));
  const mean = Object.fromEntries(
    Object.entries(byType).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]),
  );
  const lift = list.map((x) =>
    x.players.reduce((n, p) => n + packPlayerScore(p) - mean[packSlotType(p)], 0),
  );
  const expected =
    list.reduce((n, x) => n + x.players.reduce((m, p) => m + mean[packSlotType(p)], 0), 0) /
    list.length;
  const spread = (Math.max(...lift) - Math.min(...lift)) / expected;
  assert.ok(
    spread <= 0.03,
    `シード${seed} でセットの開きが大きい: ${(spread * 100).toFixed(1)}%`,
  );
}

// --- 初期セットの年齢の幅 ------------------------------------------------
// ⚠ **衰える年齢の選手を最初から混ぜること**（いしだ指摘: 2〜3年目から
//    能力がインフレする）。19〜24歳だけだと開幕時点で全員が伸び盛りで、
//    リーグ全体が毎年上がるだけになる。
// ⚠ 版2（19〜24歳）の作り方は**残す**。途中参加で待っている人のセットは
//    種から作り直すので、作り方が変わると選んだセットの中身が入れ替わる。
{
  const ages = packs.flatMap((p) => p.players.map((x) => x.age));
  const mean = ages.reduce((a, b) => a + b, 0) / ages.length;
  assert.ok(
    Math.max(...ages) >= 30,
    `衰える年齢（30歳以上）の選手が1人も居ない: 最高 ${Math.max(...ages)}歳`,
  );
  assert.ok(
    ages.filter((a) => a >= 27).length / ages.length >= 0.1,
    `27歳以上が少なすぎる: ${((ages.filter((a) => a >= 27).length / ages.length) * 100).toFixed(1)}%`,
  );
  // ⚠ **伸び盛りを薄くしすぎない**。若い選手が育つのがこの遊びの軸
  assert.ok(
    ages.filter((a) => a <= 23).length / ages.length >= 0.4,
    `23歳以下が少なすぎる: ${((ages.filter((a) => a <= 23).length / ages.length) * 100).toFixed(1)}%`,
  );
  assert.ok(mean >= 22.5 && mean <= 25, `平均年齢が範囲外: ${mean.toFixed(1)}`);
  // 版2は19〜24歳のまま
  const young = generateRosterPacks(20261103, { style: YOUNG_PACK_STYLE });
  for (const pack of young)
    for (const p of pack.players)
      assert.ok(
        p.age >= 19 && p.age <= PACK_MAX_AGE,
        `版2の${p.name} の年齢が範囲外: ${p.age}`,
      );
}

{
  const legacy = generateRosterPacks(20261103, { style: LEGACY_PACK_STYLE });
  assert.equal(legacy.length, PACK_COUNT);
  for (const pack of legacy) {
    const summary = packSummary(pack);
    assert.deepEqual(summary.ranks, PACK_RANKS, `版1 ${pack.id} の格の内訳がちがう`);
    assert.equal(summary.counts.pitcher, 12, `版1 ${pack.id} の投手数がちがう`);
    assert.equal(summary.twoWay, 2, `版1 ${pack.id} の二刀流が2人でない`);
    assert.equal(summary.feature, null, '版1のセットに特徴が付いている');
  }
  const scores = legacy.map((p) => packScore(p.players));
  const spread = (Math.max(...scores) - Math.min(...scores)) / (scores.reduce((a, b) => a + b, 0) / scores.length);
  assert.ok(spread <= 0.04, `版1のセットの開きが大きい: ${(spread * 100).toFixed(1)}%`);
  assert.notDeepEqual(
    legacy.map((p) => p.players[0].name),
    packs.map((p) => p.players[0].name),
    '版1と版3が同じセットになっている',
  );
  for (const pack of legacy)
    for (const p of pack.players)
      assert.ok(
        p.age >= 19 && p.age <= PACK_MAX_AGE,
        `版1の${p.name} の年齢が範囲外: ${p.age}`,
      );
  // 待っている人のセットは版で作り分ける
  assert.deepEqual(
    packsForMember({ packSeed: 20261103 }).map((p) => p.players[0].id),
    legacy.map((p) => p.players[0].id),
    '版の無い人に版1のセットを作っていない',
  );
  assert.deepEqual(
    packsForMember({ packSeed: 20261103, packStyle: PACK_STYLE }).map((p) => p.players[0].id),
    packs.map((p) => p.players[0].id),
    '版2の人に版2のセットを作っていない',
  );
}

// ⚠ **格の段差がリーグの格の表と別であること**。`RANK_LEVEL_SHIFT` は
//    A=0・B=-8・C=-16 で、チームの格をチーム全体に当てるための表。これを
//    選手の格に流用すると能力が全体に下がり、表示がほぼ全員Fになった（実測）。
//    段差の中心をBに置いて、水準そのものを数字で押さえる。
//    ⚠ 「AがCより上」だけでは**足りない**。流用してもその順序は保たれるので、
//       この検査は通ってしまう（実測でmutationを見逃した）。水準を見ること。
const rankPool = { A: [], B: [], C: [] };
for (const seed of [20261103, 777, 42, 1, 999]) {
  const all = generateRosterPacks(seed).flatMap((p) => p.players);
  const pitchers = all.filter((p) => p.position === 'pitcher');
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const control = (list) => mean(list.map((p) => p.pitching.control));
  const overall = control(pitchers);
  // 実測（版2、12の種）: 46.4〜50.4 / 表を流用すると41〜43
  assert.ok(
    overall >= 45.5 && overall <= 54,
    `シード${seed} 投手の制球の水準がずれている: ${overall.toFixed(1)}（45.5〜54を想定）`,
  );
  // 実測（版2、12の種）: Bは47.9〜53.8 / 流用すると43.4〜46.5
  const bControl = control(pitchers.filter((p) => p.rank === 'B'));
  assert.ok(
    bControl >= 47,
    `シード${seed} Bランク投手が弱すぎる（制球 ${bControl.toFixed(1)}）`,
  );
  // 格の順序は**種をまとめて**見る（下）。二刀流の投手は打撃も数えるので外す
  const pure = pitchers.filter((p) => !p.isTwoWay);
  for (const r of ['A', 'B', 'C'])
    rankPool[r].push(...pure.filter((p) => p.rank === r).map(packPlayerScore));
  // ⚠ 野手も見る（投手だけ見ると野手側の段差漏れに気づけない）
  const fielders = all.filter((p) => p.position !== 'pitcher');
  const meetB = mean(fielders.filter((p) => p.rank === 'B').map((p) => p.batting.meet));
  assert.ok(meetB >= 43, `シード${seed} Bランク野手が弱すぎる（ミート ${meetB.toFixed(1)}）`);
}
// 格の順序（AがBより上、BがCより上）。
// ⚠ **5つの種をまとめて見る**。Aは1セットに2人しか居らず（種ごとに11〜22人）、
//    19〜32歳の幅では年齢ぶんの差（`generateAbilities` の `ageBonus` は最大10）が
//    格の段差（A=+10・B=0）と同じ大きさになる。種ごとに見ると、A が少ない種で
//    平均が B と入れ替わる（実測: 種777 で A197.6 対 B199.1）。
// ⚠ 順序だけでは**足りない**（上の水準の検査と組で見る）。格の表を流用しても
//    順序は保たれるので、水準（制球45.5〜54・B投手47以上）がmutationを捕まえる。
{
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const byRank = ['A', 'B', 'C'].map((r) => mean(rankPool[r]));
  assert.ok(
    byRank[0] > byRank[1] && byRank[1] > byRank[2],
    `格の順に強くなっていない: ${byRank.map((v) => v.toFixed(1)).join(' / ')}（人数 ${['A', 'B', 'C'].map((r) => rankPool[r].length).join('/')}）`,
  );
}

// ⚠ 同じシードなら同じ結果（サーバーと再現で違う世界にならない）
assert.deepEqual(generateRosterPacks(777), generateRosterPacks(777), 'シードが同じなのに違う');
assert.notDeepEqual(
  generateRosterPacks(777).map((p) => p.players[0].name),
  generateRosterPacks(42).map((p) => p.players[0].name),
  'シードを変えても同じ結果になった',
);

// ⚠ 全セットを通して選手が重複しない（20×24＝480人）。idも種×1000の幅に収まる
const everyId = packs.flatMap((p) => p.players.map((x) => x.id));
assert.equal(new Set(everyId).size, everyId.length, 'セットをまたいで同じ選手がいる');
assert.ok(
  everyId.every((id) => id > 20261103 * 1000 && id < 20261103 * 1000 + 1000),
  '選手のidが種の幅からはみ出している（別の人のセットとidが重なる）',
);

// --- 手続きとして通るか -----------------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'pennant-pack-'));
try {
  const store = new FileStore(join(dir, 'state.gz'));
  const now = '2026-10-26T15:00:00.000Z';
  const service = new LeagueService(store, {
    members: [{ userId: 'admin', label: '管理者' }],
    adminId: 'admin',
    clock: () => now,
  });
  const admin = (await service.login('admin')).sessionId;
  const guest = (await service.login('guest')).sessionId;
  let seq = 0;
  const send = async (user, sess, type, payload) => {
    const l = (await store.read()).league;
    seq += 1;
    return service.command(user, sess, {
      requestId: `packchk-${type}-${seq}`,
      revision: l?.revision ?? 0,
      type,
      payload,
    });
  };
  await send('admin', admin, 'create');
  await send('guest', guest, 'join', { teamName: '湘南サンズ' });

  const opened = (await store.read()).league;
  // ⚠ 開幕前の手続きは**セット選択**。初期編成（希望リスト）は置き換えた
  assert.equal(opened.phase.kind, 'pack_select', '開幕前の手続きがちがう');
  assert.equal(opened.packs.length, PACK_COUNT);
  // ⚠ 締め切りがあること（1人が決めなくても開幕する）
  assert.ok(opened.phase.deadline, 'セット選択に締め切りが無い');

  const view = await service.view('admin', admin);
  assert.equal(view.phase.packs.length, PACK_COUNT, 'ビューにセットが渡っていない');
  assert.equal(view.phase.packs[0].players.length, PACK_SIZE, '選手が渡っていない');
  // ⚠ ビューが重くなりすぎないこと。20×24人ぶんを丸ごと載せると保存も重くなる
  const kb = Buffer.byteLength(JSON.stringify(view.phase.packs)) / 1024;
  assert.ok(kb < 400, `セットの投影が重い: ${Math.round(kb)}KB`);
  // ⚠ **画面が出す能力を全部渡すこと**（いしだ指摘: 体力・肩・足といった
  //    代表的な能力すら出ていない）。`PackSelect` の `COLUMNS` と対になっていて、
  //    片方だけ足すと表に「—」が並ぶ。軽くするために項目を削った名残で、
  //    打撃2つ・走力・守備・球速・制球しか渡していなかった
  {
    const paths = [
      ['batting', 'meet'],
      ['batting', 'power'],
      ['batting', 'eye'],
      ['physical', 'speed'],
      ['physical', 'arm'],
      ['physical', 'bodyStamina'],
      ['fielding', 'defense'],
      ['pitching', 'velocity'],
      ['pitching', 'control'],
      ['pitching', 'stamina'],
      // ⚠ 表に無い能力も渡す。選手名を押した先（詳細）も同じ選手を出すので、
      //    削ると回復・体幹・バント・変化球が「—」になった（監査 2026-11-13）
      ['physical', 'recovery'],
      ['batting', 'bunt'],
    ];
    for (const pack of view.phase.packs)
      for (const p of pack.players) {
        assert.ok(!('growthPotential' in p), `${p.name} の成長力（隠す値）が渡っている`);
        if (p.position === 'pitcher')
          assert.ok(Array.isArray(p.pitching?.arsenal), `${p.name} の球種が渡っていない`);
      }
    for (const pack of view.phase.packs)
      for (const p of pack.players)
        for (const [group, key] of paths) {
          // 投手に打撃、野手に投球が無いことはある。**群そのものが無い**のは渡し忘れ
          if (!p[group]) assert.fail(`${p.name} の${group}が渡っていない`);
          assert.ok(
            key in p[group],
            `${p.name} の ${group}.${key} が渡っていない（画面は列を出すので「—」になる）`,
          );
        }
  }

  // 居ないセットは受け付けない
  const liveRevision = (await store.read()).league.revision;
  await assert.rejects(
    () =>
      service.command('admin', admin, {
        requestId: 'packchk-bad',
        revision: liveRevision,
        type: 'submit',
        payload: {
          phaseId: opened.phase.id,
          plan: { packId: 'pack-999' },
          ready: true,
          baseSubmission: null,
        },
      }),
    /初期メンバーの選択が不正/,
  );

  // ⚠ **2人が同じセットを選んだとき**。片方だけが取り、もう片方は別のを受け取る
  for (const [user, sess] of [
    ['admin', admin],
    ['guest', guest],
  ]) {
    const cur = (await store.read()).league;
    await service.command(user, sess, {
      requestId: `packchk-submit-${user}`,
      revision: cur.revision,
      type: 'submit',
      payload: {
        phaseId: cur.phase.id,
        plan: { packId: 'pack-3' },
        ready: true,
        baseSubmission: null,
      },
    });
  }
  const after = (await store.read()).league;
  assert.equal(after.phase?.kind, 'camp', 'セット選択の次はキャンプ');
  // ⚠ 配り終えたら捨てる。480人ぶんを保存に残さない
  assert.ok(!after.packs, 'セットが保存に残っている');

  const names = after.season.settings.teamNames;
  for (const name of names)
    assert.equal(
      after.game.teams[name].players.length,
      PACK_SIZE,
      `${name} の人数がちがう`,
    );
  // ⚠ 288人が全員ちがう選手（同じセットを2球団に渡していない）
  const ids = names.flatMap((n) => after.game.teams[n].players.map((p) => p.id));
  assert.equal(ids.length, names.length * PACK_SIZE);
  assert.equal(new Set(ids).size, ids.length, '同じ選手が2球団にいる');
  const allNames = names.flatMap((n) => after.game.teams[n].players.map((p) => p.name));
  assert.equal(new Set(allNames).size, allNames.length, '同じ名前の選手がいる');

  // 名簿がセットの24人そのもの（型は球団ごとに違ってよい）
  // ⚠ 投手の人数は**二刀流を除いて**数える。開幕前の打順作り（CPUの
  //    `generateAILineup`）は、守れる二刀流の投手を外野に回すことがある
  //    （実測: 投手→右翼）。二刀流でない投手は動かさない
  const opening = new Map(opened.packs.map((p) => [p.players[0].id, p]));
  for (const name of names) {
    const players = after.game.teams[name].players;
    const pack = players.map((p) => opening.get(p.id)).find(Boolean);
    assert.ok(pack, `${name} の名簿がどのセットか分からない`);
    assert.deepEqual(
      players.map((p) => p.id).sort((a, b) => a - b),
      pack.players.map((p) => p.id).sort((a, b) => a - b),
      `${name} の名簿がセットの24人とちがう`,
    );
    const ranks = players.reduce((c, p) => ((c[p.rank] = (c[p.rank] || 0) + 1), c), {});
    assert.deepEqual(ranks, packSummary(pack).ranks, `${name} の格の内訳がセットとちがう`);
    const purePitchers = (list) =>
      list.filter((p) => p.position === 'pitcher' && !p.isTwoWay).length;
    assert.equal(
      purePitchers(players),
      purePitchers(pack.players),
      `${name} の投手（二刀流を除く）の数がセットとちがう`,
    );
  }

  // ⚠ **打順と投手起用まで作られていること**。名簿を渡すだけでは試合が
  //    組めない。実測で、打順が空のまま開幕して画面が例外で落ちた。
  for (const name of names) {
    const team = after.game.teams[name];
    const order = team.lineupSettings?.battingOrder || [];
    assert.equal(order.length, 9, `${name} の打順が9人でない: ${order.length}`);
    assert.deepEqual(
      [...order.map((e) => e.battingOrder)].sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      `${name} の打順の番号が揃っていない`,
    );
    const ids = new Set(team.players.map((p) => p.id));
    assert.ok(
      order.every((e) => ids.has(e.playerId)),
      `${name} の打順に名簿外の選手がいる`,
    );
    assert.ok(
      (team.pitchingRotation?.starters || []).length >= 3,
      `${name} の先発ローテーションが作られていない`,
    );
  }

  // ⚠ 決めなかった人にも渡ること（締め切りで押し通すため）
  const plan = defaultPhasePlan(
    { ...after, phase: { kind: 'pack_select' }, packs },
    names[0],
  );
  assert.ok(plan.packId, '既定の選択が空');
  // ⚠ **ほかの人が自分で選んだセットは、標準案に入れない**。標準案も解決では
  //    「選んだもの」と同じ扱い（球団名の順）なので、決めなかった人が先に取っていた
  const avoiding = defaultPhasePlan(
    {
      ...after,
      phase: {
        kind: 'pack_select',
        submissions: { someoneElse: { plan: { packId: plan.packId }, ready: true } },
      },
      packs,
    },
    names[0],
  );
  assert.ok(avoiding.packId, '既定の選択が空（ほかの人が選んだとき）');
  assert.notEqual(avoiding.packId, plan.packId, '決めなかった人の標準案が、ほかの人の選んだセットを取る');

  // --- 途中参加した人のセット選択 ---------------------------------------
  // ⚠ 開幕後に参加した人は、引き継いだCPUの名簿のままでは自分で選んだ24人で
  //    始められない。**自分のセットを選び、次のキャンプで入れ替わる**。
  // ⚠ シーズン途中で入れ替えないこと（順位表と選手成績が合わなくなる）。
  {
    const late = (await store.read()).league;
    assert.ok(!late.phase || late.phase.kind !== 'pack_select', '前提: セット選択は終わっている');
    const joiner = (await service.login('late1')).sessionId;
    await service.command('late1', joiner, {
      requestId: 'packchk-join-late1',
      revision: late.revision,
      type: 'join',
      payload: {},
    });
    const joined = (await store.read()).league;
    const me = joined.members.find((m) => m.userId === 'late1');
    assert.ok(me, '参加できていない');
    // ⚠ **種を持つこと**。セット（20×24人）は保存せず、種から作り直す
    assert.ok(Number.isFinite(me.packSeed), '個別の種が配られていない');
    // ⚠ 作り方の版も残す（種から作り直すので、版が変わると中身が入れ替わる）
    assert.equal(me.packStyle, PACK_STYLE, '途中参加の人にセットの版が残っていない');
    assert.equal(me.pendingPackId, null, '選ぶ前なのに選択が入っている');
    const myTeam = me.teamName;
    const inherited = joined.game.teams[myTeam].players.map((p) => p.id);
    assert.ok(inherited.length > 0, '前提: 引き継いだ名簿がある');

    // ビューにセットが渡る
    const joinerView = await service.view('late1', joiner);
    assert.equal(joinerView.pendingPack?.packs.length, PACK_COUNT, 'セットが渡っていない');
    assert.equal(joinerView.pendingPack.chosen, null, '選ぶ前なのに選択済み');
    // ⚠ 年齢構成の見込みは、セットが入るまで出さない（いまの名簿は CPU のときの選手で、入れ替わる）
    assert.equal(joinerView.ageOutlook, null, '初期メンバーを待っている間に、入れ替わる名簿の年齢構成が出た');
    // ⚠ 種から作り直したセットが**毎回同じ**こと。違うと、見た顔ぶれと
    //    実際に入る顔ぶれが食い違う
    const again = await service.view('late1', joiner);
    assert.deepEqual(
      again.pendingPack.packs.map((x) => x.players.map((p) => p.id)),
      joinerView.pendingPack.packs.map((x) => x.players.map((p) => p.id)),
      '見るたびに違う選手になる',
    );

    // 居ないセットは受け付けない
    const liveRev = () => store.read().then((b) => b.league.revision);
    const badRevision = await liveRev();
    await assert.rejects(
      () =>
        service.command('late1', joiner, {
          requestId: 'packchk-late-bad',
          revision: badRevision,
          type: 'pack',
          payload: { packId: 'pack-999' },
        }),
      /初期メンバーの選択が不正/,
    );

    const wanted = joinerView.pendingPack.packs[3];
    await service.command('late1', joiner, {
      requestId: 'packchk-late-pick',
      revision: await liveRev(),
      type: 'pack',
      payload: { packId: wanted.id },
    });
    const picked = (await store.read()).league;
    assert.equal(
      picked.members.find((m) => m.userId === 'late1').pendingPackId,
      wanted.id,
      '選択が保存されていない',
    );
    // ⚠ **まだ名簿を入れ替えないこと**
    assert.deepEqual(
      picked.game.teams[myTeam].players.map((p) => p.id),
      inherited,
      'キャンプ前なのに名簿が入れ替わった',
    );
    // ⚠ 選び終えたら「いつ自分の球団になるか」を出す（いしだ指摘: 決めた後も画面がそのままで、
    //    済んだのか分からなかった）。キャンプの最中ならその締め切り、まだなら見込み
    //    （次のキャンプの締め切り＝月曜0時）
    const pickedView = await service.view('late1', joiner);
    const ready = packWaiting(pickedView);
    assert.ok(ready, '選び終えたのに「開幕待ち」にならない');
    assert.equal(ready.packName, wanted.name, '開幕待ちのセットの名前がちがう');
    assert.equal(pendingProcedure(pickedView), null, '選び終えたのに手続きの帯が残っている');
    if (picked.phase?.kind === 'camp') {
      assert.equal(ready.joinsAt, picked.phase.deadline, 'キャンプ中なのに締め切りで始まると出ない');
      assert.equal(ready.estimated, false, 'キャンプ中なのに日時が見込みのまま');
    } else {
      assert.ok(ready.estimated, 'キャンプの前なのに日時が見込みになっていない');
      assert.ok(
        ready.joinsAt && Date.parse(ready.joinsAt) > Date.parse(now),
        `自分の球団になる日時が無い・過去: ${ready.joinsAt}`,
      );
      assert.equal(jstWeekday(ready.joinsAt), 1, `開幕の見込みが月曜ではない: ${ready.joinsAt}`);
    }
    // キャンプの前（シーズン中）なら、次のキャンプの締め切り（月曜0時）を見込みで出す
    {
      const inSeason = structuredClone(picked);
      inSeason.phase = null;
      inSeason.nextAdvanceAt = '2026-11-04T01:45:00.000Z'; // 水曜 10:45（JST）
      const seasonView = projectLeague(
        { league: inSeason, sessions: {}, receipts: {} },
        'late1',
        null,
        'admin',
      );
      const est = packWaiting(seasonView);
      assert.equal(est?.estimated, true, 'シーズン中なのに日時が見込みになっていない');
      assert.equal(est.joinsAt, '2026-11-08T15:00:00.000Z', `次のキャンプの締め切り（11/9 月 0時）にならない: ${est.joinsAt}`);
    }

    // キャンプで入れ替わる
    await store.transaction((bundle) => {
      loadLeagueWorld(bundle.league);
      openPhase(bundle.league, 'camp', now);
      bundle.league.game = captureWorld();
      return { value: null };
    });
    const camp = (await store.read()).league;
    // ⚠ **セットを待っている人の決定は待たない**（その球団はキャンプまでCPUが動かす）。
    //    以前は待っていたが、画面には初期メンバーの選択しか出さないので決める手段が無く、
    //    ストーブリーグとキャンプが毎回締め切りまで止まっていた
    const waiting = (await service.view('late1', joiner)).members.find(
      (m) => m.teamName === myTeam,
    );
    assert.ok(waiting.ready && waiting.cpu, 'セットを待っている人がCPU決定として出ていない');
    // キャンプの最中は、その締め切りで自分の球団になる（見込みではない）
    const inCamp = packWaiting(await service.view('late1', joiner));
    assert.equal(inCamp?.joinsAt, camp.phase.deadline, 'キャンプ中なのに締め切りで始まると出ない');
    assert.equal(inCamp.estimated, false, 'キャンプ中なのに日時が見込みのまま');
    for (const m of camp.members.filter((x) => x.userId !== 'late1'))
      await service.command(m.userId, m.userId === 'admin' ? admin : guest, {
        requestId: `packchk-camp-${m.userId}`,
        revision: await liveRev(),
        type: 'submit',
        payload: {
          phaseId: camp.phase.id,
          plan: { menu: 'standard' },
          ready: true,
          baseSubmission: null,
        },
      });
    const done = (await store.read()).league;
    assert.notEqual(
      done.phase?.kind,
      'camp',
      'セットを待っている人の決定を待って、キャンプが締め切りまで止まる',
    );
    const mine = done.game.teams[myTeam].players;
    assert.equal(mine.length, PACK_SIZE, `キャンプ後の人数がちがう: ${mine.length}`);
    assert.deepEqual(
      mine.map((p) => p.id).sort(),
      wanted.players.map((p) => p.id).sort(),
      '選んだセットが名簿に入っていない',
    );
    // ⚠ 済んだら印を消すこと。残ると毎キャンプで名簿が作り直される
    const after2 = done.members.find((m) => m.userId === 'late1');
    assert.ok(!after2.packSeed && !after2.pendingPackId, '選択の印が残っている');
    // ⚠ **全球団を通して選手のidが重複しないこと**。種を人ごとにずらさないと、
    //    別の球団に同じidの選手ができて記録がどちらのものか分からなくなる
    const allIds = done.season.settings.teamNames.flatMap((n) =>
      done.game.teams[n].players.map((p) => p.id),
    );
    assert.equal(new Set(allIds).size, allIds.length, '同じidの選手が2人いる');
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(
  `■ 初期メンバーセット: OK（${PACK_COUNT}セット×${PACK_SIZE}人 / 構成と格の型がばらけ、型の決まりを守る / 同じ枠の平均からの開きが3%以内 / 19〜32歳（衰える年齢も混ざる）/ 版1・版2は前の作り方のまま / 取り合いを解く / 288人が重複しない / 途中参加は次のキャンプで入れ替わる）`,
);
