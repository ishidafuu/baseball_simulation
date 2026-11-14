// 初期編成・トライアウトの希望リストを組み立てる計算の検査。
//
// ⚠ 主目的は「**画面の操作が、サーバーの受け取れる提出を壊さないこと**」。
//    提出は `{ count, rankedIds, total }` で、サーバーは
//    「重複なし・全員が候補・交渉は10人まで・rankedIds は count 以上」を求める
//    （`total`・`count` が空き枠を超えるのは弾かず空き枠に切る）。
//    画面側で1人でも落とすと、その場では気づかず**提出の瞬間だけ弾かれる**。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestStore } from './lib/testStore.mjs';
import { TEAMS_DATA } from '../../src/teams-data.js';
import { rosterGroup } from '../../src/utils/constants.js';
import { captureWorld } from '../../server/worldSnapshot.mjs';
import { createSeededRandom } from '../../src/game/rng.js';

/**
 * 種を固定して手続きを開く。
 *
 * ⚠ **`openPhase` を種の外で呼ばないこと**。トライアウトの候補は
 *    `generateTryoutCandidates` が `Math.random` で作る。本物の進行は
 *    `advanceOneDay` が `seeded(...)` の中で呼ぶので再現するが、検査が直に
 *    呼ぶと毎回違う候補になり、人数や構成を見る判定がときどき落ちる
 *    （実測で、同じコードのまま通ったり落ちたりした）。
 */
function openPhaseSeeded(league, kind, now, seed) {
  const previous = Math.random;
  Math.random = createSeededRandom(seed);
  try {
    openPhase(league, kind, now);
  } finally {
    Math.random = previous;
  }
}
import { LeagueService } from '../../server/leagueService.mjs';
import {
  createLeague,
  defaultPhasePlan,
  submitPhase,
  openPhase,
  loadLeagueWorld,
} from '../../server/leagueEngine.mjs';
import {
  POSITION_GROUPS,
  SORT_KEYS,
  overallScore,
  filterCandidates,
  moveRanked,
  swapRanked,
  planSummary,
  nextFromPlan,
  plannedPicks,
  addToPlan,
  removeFromPlan,
  shiftInPlan,
  moveInPlan,
  wishLimit,
  planCount,
  signTotal,
  wishedCount,
  TRYOUT_WISH_MAX,
  DEFAULT_WEIGHTS,
  WEIGHT_FIELDS,
  sanitizeWeights,
  weightedScore,
  weightedRanked,
  weightFactor,
  WEIGHT_MAX,
} from '../../src/online/tryoutPlan.js';
import { rosterCounts } from '../../src/utils/constants.js';
// ⚠ 目標構成は**オンライン専用の表**（26人）。一人用の表（24人）ではない
import {
  ONLINE_ROSTER_TARGETS as ROSTER_TARGETS,
  ROSTER_LIMIT,
} from '../../src/online/shared.js';

// --- 並べ替えと絞り込み（候補を作らずに済む部分） --------------------
{
  const mk = (id, position, over) => ({
    id,
    name: `選手${id}`,
    age: 20,
    position,
    batting: { meet: over, power: over },
    fielding: { defense: over },
    physical: { speed: over },
    pitching: { velocity: 115 + over / 2.5, control: over, stamina: over * 2 },
  });
  const list = [mk(3, 'pitcher', 60), mk(1, 'catcher', 80), mk(2, 'left', 80)];

  // ⚠ 球速とスタミナは0〜100ではない（球速115〜155・スタミナ0〜200）。
  //    素のまま足すと、能力の低い投手が良い野手を上回って上位に並ぶ
  // 速いだけで他は平凡な投手（140km/h＝100点満点なら62.5）と、全部50の野手。
  // 正規化すれば投手36.9＜野手50。素のまま足すと投手64＞野手50でひっくり返る
  const fastButWeak = { id: 9, name: 'x', position: 'pitcher', pitching: { velocity: 140, control: 20, stamina: 60, spinRate: 20 } };
  const plainBatter = { id: 8, name: 'y', position: 'left', batting: { meet: 50, power: 50 }, fielding: { defense: 50 }, physical: { speed: 50 } };
  assert.ok(
    overallScore(plainBatter) > overallScore(fastButWeak),
    '球速の桁が揃っていない（速いだけの投手が野手を上回る）',
  );
  // スタミナは0〜200。こちらも別に見る（球速だけ直しても片方が残る）
  const ironman = { id: 7, name: 'z', position: 'pitcher', pitching: { velocity: 120, control: 20, stamina: 200, spinRate: 20 } };
  assert.ok(
    overallScore(plainBatter) > overallScore(ironman),
    'スタミナの桁が揃っていない（スタミナだけ高い投手が野手を上回る）',
  );
  assert.equal(overallScore(null), 0, '選手が居なくても落ちない');

  // 総合の降順
  assert.deepEqual(filterCandidates(list, {}).map((p) => p.id), [1, 2, 3]);
  // ⚠ **同点のとき、入力の並びで結果が変わらないこと**。候補の入力順は
  //    サーバー次第で変わりうるのに、画面は「○番目の行を押した」で動く。
  //    入力順まかせだと、同点の選手が入れ替わって別人が動く。
  //    （`sort` が安定なだけでは足りない。入力が違えば出力も変わる）
  assert.deepEqual(
    filterCandidates([...list].reverse(), {}).map((p) => p.id),
    filterCandidates(list, {}).map((p) => p.id),
    '同点の並びが入力順に左右されている',
  );
  assert.deepEqual(filterCandidates(list, { desc: false }).map((p) => p.id), [3, 1, 2]);
  // 守備位置の絞り込み
  assert.deepEqual(filterCandidates(list, { group: 'pitcher' }).map((p) => p.id), [3]);
  assert.deepEqual(filterCandidates(list, { group: 'outfield' }).map((p) => p.id), [2]);
  assert.deepEqual(filterCandidates(list, { group: 'all' }).length, 3);
  // 名前での絞り込み
  assert.deepEqual(filterCandidates(list, { query: '選手2' }).map((p) => p.id), [2]);
  assert.deepEqual(filterCandidates(list, { query: '  ' }).length, 3, '空白だけなら絞らない');
  // ⚠ **元の配列を壊さないこと**。`sort` は破壊的なので、絞り込みを挟まないと
  //    候補の並びそのものが変わり、ページ送りが飛ぶ
  assert.deepEqual(list.map((p) => p.id), [3, 1, 2], '元の候補の並びが変わっている');

  // 並べ替えの選択肢は全部使える
  for (const s of SORT_KEYS)
    assert.doesNotThrow(() => filterCandidates(list, { sortKey: s.key }), s.key);
  // 守備位置の区分は、全部の守備位置を1回ずつ覆っている
  const covered = POSITION_GROUPS.flatMap((g) => g.positions || []);
  assert.deepEqual(
    [...covered].sort(),
    ['catcher', 'center', 'first', 'left', 'pitcher', 'right', 'second', 'short', 'third'],
    '守備位置の区分に漏れか重複がある',
  );
}

// --- 並べ替えの操作 --------------------------------------------------
{
  const ids = [1, 2, 3, 4, 5];
  // ⚠ 取り除いてから入れること。先に入れると後ろへ動かすとき1つずれる
  assert.deepEqual(moveRanked(ids, 1, 3), [2, 3, 4, 1, 5], '後ろへ動かすとずれる');
  assert.deepEqual(moveRanked(ids, 5, 0), [5, 1, 2, 3, 4]);
  assert.deepEqual(moveRanked(ids, 3, ids.length), [1, 2, 4, 5, 3], '末尾送り');
  // 範囲外でも落とさない・落ちない
  assert.deepEqual(moveRanked(ids, 2, -5), [2, 1, 3, 4, 5]);
  assert.deepEqual(moveRanked(ids, 2, 99), [1, 3, 4, 5, 2]);
  // ⚠ 候補に居ない人を足さない（提出は「全員が候補であること」を求める）
  assert.deepEqual(moveRanked(ids, 99, 0), ids, '候補に居ない人が混ざる');

  assert.deepEqual(swapRanked(ids, 0, 1), [2, 1, 3, 4, 5]);
  assert.deepEqual(swapRanked(ids, 0, -1), ids, '先頭より上は何もしない');
  assert.deepEqual(swapRanked(ids, 4, 1), ids, '末尾より下は何もしない');
  // ⚠ どの操作でも元の配列を壊さない（Reactの再描画が止まる）
  assert.deepEqual(ids, [1, 2, 3, 4, 5], '元の配列が書き換わっている');
}

// --- 本物の候補で、提出まで通るか ------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'pennant-tryout-'));
try {
  const store = createTestStore(join(dir, 'state.gz'));
  const service = new LeagueService(store, {
    members: [{ userId: 'admin', label: '管理者' }],
    adminId: 'admin',
    clock: () => '2026-10-26T15:00:00.000Z',
  });
  const sessionId = (await service.login('admin')).sessionId;
  await service.command('admin', sessionId, {
    requestId: 'create-0',
    revision: 0,
    type: 'create',
  });
  // ⚠ **シーズン終わりの形を作る**。開幕前の手続きは初期メンバーセットの
  //    選択になったので、トライアウトは年末（11月10日）まで来ない。
  //    1シーズン回すとこの検査が90秒かかるため、
  //      ①セットを選んで名簿を作る → ②戦力外を出して空きを作る →
  //      ③トライアウトを開く
  //    という形を直に作る。実際の年末と同じ並び（契約更改→トライアウト）。
  const created = (await store.read()).league;
  assert.equal(created.phase.kind, 'pack_select', '前提: 開幕前はセット選択');
  await service.command('admin', sessionId, {
    requestId: 'packpick-0',
    revision: created.revision,
    type: 'submit',
    payload: {
      phaseId: created.phase.id,
      // ⚠ 構成が「標準」のセットを選ぶ（下の戦力外は区分ごとの人数を決め打ちで
      //    残すので、外野3人の型だと残せない）
      plan: {
        packId: (created.packs.find((p) => p.shape === 'standard') || created.packs[0]).id,
      },
      ready: true,
      baseSubmission: null,
    },
  });
  // ⚠ 戦力外は**区分ごとに残す人数を決めて**出す。投手だけ減らすと
  //    「投手を取るのが正しい」状態になり、目標構成が効いているか分からない。
  //    残す人数は、空いた枠が目標構成の空きとちょうど同じになるよう選ぶ。
  //    こうすると、希望順を素直に取る実装なら投手が枠のぶんだけ増え、
  //    目標構成を見る実装なら投手の空き（数人）しか増えない。
  // ⚠ **候補の数に余裕を持たせること**。年末のトライアウトの候補は12球団で
  //    実測120人。12球団×空き枠がちょうど120だと、必要な守備位置が先に
  //    尽きて1人埋まらない球団が出る（枠を26にしたときに実際そうなった）。
  //    空きは6枠（12球団で72人）にして、候補に余りを残す。
  const KEEP = { pitcher: 9, catcher: 2, infielder: 5, outfielder: 4 };
  // ⚠ 枠の数から導く。直に書くと、枠を増やしたときに取り残される
  const KEEP_TOTAL = Object.values(KEEP).reduce((a, b) => a + b, 0);
  const EXPECTED_SLOTS = ROSTER_LIMIT - KEEP_TOTAL;
  await store.transaction((bundle) => {
    const l = bundle.league;
    loadLeagueWorld(l);
    for (const name of l.season.settings.teamNames) {
      const team = TEAMS_DATA[name];
      const left = { ...KEEP };
      team.players = team.players.filter((p) => {
        const group = rosterGroup(p.position);
        if (left[group] <= 0) return false;
        left[group] -= 1;
        return true;
      });
    }
    openPhaseSeeded(l, 'tryout', '2026-11-10T15:00:00.000Z', 20261110);
    // ⚠ 世界を保存へ書き戻すこと。`TEAMS_DATA` を触っただけでは保存に載らない
    l.game = captureWorld();
    return { value: null };
  });
  const league = (await store.read()).league;
  assert.equal(league.phase.kind, 'tryout');
  const candidates = league.phase.candidates;
  // ⚠ 候補は実測120人（12球団ぶん）。1本のリストで扱える数ではない、
  //    という前提の根拠。空きは12球団×8人＝96なので、全球団が埋められる
  assert.ok(candidates.length > 90, `候補が少なすぎる: ${candidates.length}`);
  const roomBefore = league.game.teams[league.members[0].teamName].players;
  assert.deepEqual(
    rosterCounts(roomBefore),
    KEEP,
    `前提: 戦力外のあとの構成がちがう（${JSON.stringify(rosterCounts(roomBefore))}）`,
  );
  const slots = ROSTER_LIMIT - roomBefore.length;
  assert.equal(
    slots,
    EXPECTED_SLOTS,
    `前提: 空きが${EXPECTED_SLOTS}人ぶん（いま${slots}）`,
  );
  // ⚠ 目標構成の空きと枠の数が合っていること。ずれていると、この節の
  //    「投手だらけにならない」が何を見ているのか分からなくなる
  const roomByGroup = Object.entries(ROSTER_TARGETS).reduce(
    (n, [group, target]) => n + Math.max(0, target - KEEP[group]),
    0,
  );
  assert.equal(roomByGroup, slots, '前提: 目標構成の空きと枠の数が合わない');

  const teamName = league.members[0].teamName;
  const base = defaultPhasePlan(league, teamName);
  // ⚠ 既定案も**交渉できる人数まで**（10人と空き枠の小さい方）。以前は候補を
  //    全員（実測360人）並べており、`selectPlayerForAI` を360回回していた
  assert.equal(
    base.rankedIds.length,
    wishLimit(slots),
    `既定案の人数がちがう: ${base.rankedIds.length}人（空き${slots}）`,
  );
  assert.ok(base.count > 0);
  assert.equal(base.count, base.rankedIds.length, '既定案の人数と count が合わない');
  // 画面の操作を順に当てる: 最下位の選手を1位へ → 隣と入替 → 末尾へ
  let plan = { ...base, rankedIds: [...base.rankedIds] };
  const lastId = plan.rankedIds.at(-1);
  plan = { ...plan, rankedIds: moveInPlan(plan.rankedIds, lastId, 0) };
  assert.equal(plan.rankedIds[0], lastId, '1位へ動かせていない');
  plan = { ...plan, rankedIds: swapRanked(plan.rankedIds, 0, 1) };
  assert.equal(plan.rankedIds[1], lastId);
  plan = {
    ...plan,
    rankedIds: moveInPlan(plan.rankedIds, lastId, plan.rankedIds.length),
  };
  assert.equal(plan.rankedIds.at(-1), lastId, '末尾へ動かせていない');

  // ⚠ **どの操作をしても人数が変わらないこと**。交渉をやめない限り減らない
  assert.equal(
    plan.rankedIds.length,
    base.rankedIds.length,
    '操作のあとで交渉中の人数が変わっている',
  );
  assert.equal(new Set(plan.rankedIds).size, plan.rankedIds.length, '重複している');

  const posOf = (id) => candidates.find((p) => p.id === id).position;

  // サーバーが受け取れること（ここが本丸）
  const current = (await store.read()).league;
  await service.command('admin', sessionId, {
    requestId: 'submit-0',
    revision: current.revision,
    type: 'submit',
    payload: {
      phaseId: current.phase.id,
      plan,
      ready: false,
      baseSubmission: null,
    },
  });
  const saved = (await store.read()).league.phase.submissions.admin.plan;
  assert.deepEqual(saved.rankedIds, plan.rankedIds, '並べ替えがサーバーに届いていない');

  // --- 交渉は10人まで（サーバー側が正本） -------------------------------
  // ⚠ 画面も `addToPlan` で止めているが、**正本はサーバー**。古い画面や手で
  //    作った提出が通ると、画面に出ていない選手まで取りにいく（希望順は
  //    そのまま指名順なので、11人目以降も `resolveTryout` が取る）。
  {
    const idsOf = (n) => candidates.slice(0, n).map((p) => p.id);
    // ちょうど10人は通る（境界が10人より手前にずれていないこと）
    const ten = idsOf(TRYOUT_WISH_MAX);
    const beforeTen = (await store.read()).league;
    await service.command('admin', sessionId, {
      requestId: 'submit-ten',
      revision: beforeTen.revision,
      type: 'submit',
      payload: {
        phaseId: beforeTen.phase.id,
        plan: { count: plan.count, rankedIds: ten },
        ready: false,
        baseSubmission: { plan: saved, ready: false },
      },
    });
    const savedTen = (await store.read()).league.phase.submissions.admin.plan;
    assert.deepEqual(savedTen.rankedIds, ten, `${TRYOUT_WISH_MAX}人の交渉が通らない`);
    // 11人は弾く
    const over = idsOf(TRYOUT_WISH_MAX + 1);
    const beforeOver = (await store.read()).league;
    await assert.rejects(
      () =>
        service.command('admin', sessionId, {
          requestId: 'submit-over',
          revision: beforeOver.revision,
          type: 'submit',
          payload: {
            phaseId: beforeOver.phase.id,
            plan: { count: plan.count, rankedIds: over },
            ready: false,
            baseSubmission: { plan: savedTen, ready: false },
          },
        }),
      (e) => /交渉できるのは/.test(e.message) && e.status === 400,
      `${TRYOUT_WISH_MAX + 1}人の交渉が通った`,
    );
    // ⚠ 弾いたあとも前の提出が残ること（下書きを巻き込んで消さない）
    assert.deepEqual(
      (await store.read()).league.phase.submissions.admin.plan.rankedIds,
      ten,
      '弾いた提出で前の下書きが壊れた',
    );
    // 元の案に戻す（この先の節が `plan` を正本にしている）
    const restore = (await store.read()).league;
    await service.command('admin', sessionId, {
      requestId: 'submit-restore',
      revision: restore.revision,
      type: 'submit',
      payload: {
        phaseId: restore.phase.id,
        plan,
        ready: false,
        baseSubmission: { plan: savedTen, ready: false },
      },
    });
    assert.deepEqual(
      (await store.read()).league.phase.submissions.admin.plan.rankedIds,
      plan.rankedIds,
      '元の案に戻せていない',
    );
  }

  // --- 実際にドラフトを解決した名簿 -----------------------------------
  // ⚠ **ここが本当の不具合があった所**。純粋な関数だけ見ていても捕まらない。
  //    見るのは2つ:
  //    ①**希望順のとおりに取る**こと（自分で10人選ぶ形なので、目標構成で
  //      飛ばすと1位を選んだ意味が無くなる）。
  //    ②**希望のあとの空き枠が自動で埋まる**こと。交渉は10人までで、しかも
  //      上位の球団に先を越されるので、希望が尽きた所で打ち切ると人の球団だけ
  //      名簿が足りないまま終わる（実測で自分21人・CPU26人。控えの数で不利）。
  {
    const live = (await store.read()).league;
    // ⚠ **CPUが欲しがらない選手（評価の低い順）を希望する**。上位の選手を希望すると他球団と
    //    競合して繰り上がりが混ざり、「希望順のとおりか」が見えなくなる
    //    （競合そのものは下の「順位が上の球団が競合に勝つ」で見る）。
    // ⚠ 希望は**空き枠より少なく**する（4人 / 空き6）。同じ数にすると
    //    自動で埋める所を一度も通らない。
    // ⚠ **目標構成を超える投手のうしろに野手を置くこと**（投手3人 → 野手1人）。
    //    名簿に投手が9人・目標が11人なので、3人目の投手で目標を超える。
    //    目標構成で飛ばす実装（古い規則）だと、ここで3人目の投手を飛ばして
    //    うしろの野手を先に取るので、巡目がずれて落ちる。投手だけ並べた希望では
    //    飛ばす先が無く、古い実装でも同じ結果になって**素通りする**（実測）。
    const weakest = (list, n) =>
      [...list].sort((a, b) => overallScore(a) - overallScore(b)).slice(0, n).map((p) => p.id);
    const wish = [
      ...weakest(candidates.filter((p) => p.position === 'pitcher'), 3),
      ...weakest(candidates.filter((p) => p.position !== 'pitcher'), 1),
    ];
    assert.equal(wish.length, 4, '前提: 希望は4人');
    assert.ok(wish.length < slots, '前提: 希望が空き枠より少ない');
    assert.equal(
      KEEP.pitcher + 3,
      ROSTER_TARGETS.pitcher + 1,
      '前提: 3人目の投手で目標構成（投手）を超える',
    );
    await service.command('admin', sessionId, {
      requestId: 'submit-1',
      revision: live.revision,
      type: 'submit',
      payload: {
        phaseId: live.phase.id,
        plan: { count: wish.length, rankedIds: wish },
        ready: true,
        baseSubmission: JSON.parse(JSON.stringify(live.phase.submissions.admin)),
      },
    });
    const after = (await store.read()).league;
    // 全員が提出したので、締め切りを待たずに解決している
    assert.notEqual(after.phase?.kind, 'tryout', 'トライアウトが解決していない');
    const mineRoster = after.game.teams[teamName].players;
    const mine = rosterCounts(mineRoster);
    // ① 希望した4人が、希望した順（1巡目〜4巡目）で入っていること。
    //    ⚠ 目標構成で飛ばす実装だと、3人目の投手（目標を超える）が後回しになり、
    //       4人目の野手が先に入るので巡目がずれる
    wish.forEach((id, i) => {
      const got = mineRoster.find((p) => p.id === id);
      assert.ok(got, `希望${i + 1}位の選手を取れていない（飛ばされた）`);
      assert.equal(
        got.draftInfo?.round,
        i + 1,
        `希望${i + 1}位が${got.draftInfo?.round}巡目になっている（希望順のとおりに取っていない）`,
      );
    });
    const cpuNames = after.season.settings.teamNames.filter((n) => n !== teamName);
    const cpus = cpuNames.map((n) => rosterCounts(after.game.teams[n].players));
    assert.ok(mine.catcher >= 1, `捕手が居ない: ${JSON.stringify(mine)}`);
    // ② 希望のあとの空き枠が自動で埋まり、名簿が26人になること。
    //    ⚠ 自動で埋めたぶんは希望に入っていない選手（CPUと同じ判断で選ぶ）
    assert.equal(
      mineRoster.length,
      ROSTER_LIMIT,
      `希望のあとの空き枠が埋まっていない: ${mineRoster.length}人（${JSON.stringify(mine)}）`,
    );
    const beforeIds = new Set(roomBefore.map((p) => p.id));
    const filled = mineRoster.filter(
      (p) => !beforeIds.has(p.id) && !wish.includes(p.id),
    );
    assert.equal(
      filled.length,
      slots - wish.length,
      `自動で埋めた人数が合わない: ${filled.length}人（空き${slots} - 希望${wish.length}）`,
    );
    // ⚠ **控えが居ること**。野手9人だと代打も守備固めも出せず、
    //    レギュラーが全試合に出続けるので、成績の出方が一人用と別物になる。
    //    実測で、直す前は野手9人（CPUは14人）だった。
    // ⚠ 投手の人数そのものは見ない（投手を希望したのだから投手が増えるのが
    //    正しい）。自動で埋めるぶんが目標構成を見ているので、野手は足りる
    const fielders = mineRoster.length - mine.pitcher;
    const cpuFielders = Math.min(...cpus.map((c) => ROSTER_LIMIT - c.pitcher));
    assert.ok(
      fielders >= 12,
      `野手が ${fielders}人しかいない（控えが出せない / CPUは最少${cpuFielders}人）`,
    );
    // ⚠ **CPUも枠いっぱいになること**。人の球団だけ埋まってCPUが空いていると、
    //    控えの数で差が付く。
    // ⚠ 人数は目標構成では決まらない（`selectPlayerForAI` は目標を
    //    「どの守備位置を優先するか」にしか使わず、尽きても別の選手を取る）。
    //    オンラインの目標構成を渡しているのは**顔ぶれの偏りを揃えるため**で、
    //    ここはその検査ではない。
    for (const name of cpuNames)
      assert.equal(
        after.game.teams[name].players.length,
        ROSTER_LIMIT,
        `${name} の枠が埋まっていない`,
      );
    // ⚠ 目標構成の合計と枠が合っていること。ずれると埋めきれないか弾かれる
    assert.equal(
      Object.values(ROSTER_TARGETS).reduce((a, b) => a + b, 0),
      ROSTER_LIMIT,
      '目標構成の合計と枠の数が合っていない',
    );
  }

  // 守備位置の内訳
  const roster = league.game.teams[teamName].players;
  const summary = planSummary(plan.rankedIds, candidates, plan.count, roster);
  assert.equal(summary.picked.length, plan.count, '獲得予定の人数が合わない');
  const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
  assert.equal(total, plan.count, '内訳の合計が獲得予定人数と合わない');
  assert.deepEqual(summary.blocking, [], '既定案が「決定できない」になっている');

  // ⚠ **獲得予定は希望順のとおり**（目標構成で飛ばさない）。自分で10人選ぶ形なので、
  //    1位を飛ばされると何を選んだのか分からない。偏りすぎて最低限（投手1・捕手1・
  //    野手8）に届かないぶんは、サーバーが必要な守備位置から補う。
  assert.deepEqual(
    summary.picked.map((p) => p.id),
    plan.rankedIds.slice(0, plan.count),
    '獲得予定が希望順のとおりでない',
  );
  // 投手だけを並べた希望なら、投手が並ぶのが正しい。
  // ⚠ **目標構成（投手11人）で切らないこと**。以前はここで切っており、
  //    10人選ぶ形にしたときに「11人目から投手にならない」という
  //    古い期待だけが残った
  const allPitchers = candidates
    .filter((p) => p.position === 'pitcher')
    .slice(0, TRYOUT_WISH_MAX)
    .map((p) => p.id);
  assert.equal(
    allPitchers.length,
    TRYOUT_WISH_MAX,
    `前提: 候補の投手が${allPitchers.length}人しかいない`,
  );
  const skewed = planSummary(allPitchers, candidates, allPitchers.length, []);
  assert.equal(
    skewed.counts.pitcher,
    allPitchers.length,
    `投手だけ並べたのに投手が ${skewed.counts.pitcher}人になった`,
  );
  // ⚠ 野手が1人も居ない希望は、提出前に「決定できない」と知らせること
  //    （サーバーは最低限を自動で補うが、希望どおりにはならない）
  assert.ok(
    skewed.blocking.some((t) => t.includes('野手')),
    `投手だけの希望を知らせていない: ${JSON.stringify(skewed.blocking)}`,
  );

  // ⚠ 残っている中のいちばん上を取る（飛ばして空の回を作らない）
  const ordered = plan.rankedIds.map((id) => candidates.find((p) => p.id === id));
  assert.equal(
    nextFromPlan(ordered)?.id,
    ordered[0].id,
    '希望の先頭を取っていない',
  );
  assert.equal(nextFromPlan([]), null, '候補が尽きても落ちない');

  // ⚠ **画面とサーバーが同じ規則を使うこと**。片方だけ直すと、画面に出ている
  //    顔ぶれと実際に取る顔ぶれが食い違う（`resolveTryout` も `nextFromPlan`）
  const simulated = plannedPicks(plan.rankedIds, candidates, ROSTER_LIMIT, []);
  assert.deepEqual(
    simulated.map((p) => p.id),
    plan.rankedIds,
    '画面側の予定が希望順のとおりでない',
  );
  {
    // サーバーの取り方（残りから `nextFromPlan` を繰り返す）をそのまま回す
    let rest = plan.rankedIds.map((id) => candidates.find((p) => p.id === id));
    const byEngine = [];
    while (rest.length && byEngine.length < plan.count) {
      const next = nextFromPlan(rest);
      byEngine.push(next.id);
      rest = rest.filter((p) => p.id !== next.id);
    }
    assert.deepEqual(
      byEngine,
      summary.picked.map((p) => p.id),
      '画面の予定とサーバーの選び方が食い違う',
    );
  }

  // ⚠ 成り立たない編成は提出前に知らせる（詳細は下）
  // ⚠ ここは**名簿が空の球団**で見る。この検査のリーグは戦力外のあとでも
  //    16人残っているので、10人取れば野手は足りてしまい、不足を作れない
  const few = planSummary(plan.rankedIds, candidates, 10, []);
  assert.ok(few.blocking.length > 0, '野手が足りないのに知らせていない');
  assert.ok(
    few.blocking.some((t) => t.includes('野手')),
    `野手の不足を名指ししていない: ${JSON.stringify(few.blocking)}`,
  );
  assert.deepEqual(few.warnings, [], '決定できない状態で助言も出している');

  // 捕手を1人も入れない並びは、捕手の不足として名指しする
  const noCatcher = [
    ...plan.rankedIds.filter((id) => posOf(id) !== 'catcher'),
    ...plan.rankedIds.filter((id) => posOf(id) === 'catcher'),
  ];
  assert.ok(
    planSummary(noCatcher, candidates, 9, []).blocking.length > 0,
    '成り立たない編成を知らせない',
  );
  // ⚠ 既に名簿が埋まっている球団なら、0人でも成り立つ（初期編成だけの話にしない）
  const already = Array.from({ length: 12 }, (_, i) => ({
    id: -1 - i,
    position: i === 0 ? 'pitcher' : i === 1 ? 'catcher' : 'left',
  }));
  assert.deepEqual(
    planSummary(plan.rankedIds, candidates, 0, already).blocking,
    [],
    '名簿が足りている球団で「決定できない」になる',
  );

  // --- 1人が成り立たない案を出しても、全員が止まらないこと ---------------
  // ⚠ **以前は0人の案1つでトライアウト全体が解決できなかった**。サーバーは
  //    0人を受け付けるのに、解決の最後で「投手・捕手・野手が不足」で落ち、
  //    締め切りの自動解決も同じ所で失敗して、黙ったまま全員が止まった。
  //    いまは必要な守備位置から自動で補い、枠いっぱいまで埋める。
  {
    const two = createLeague({
      members: [{ userId: 'a' }, { userId: 'b' }],
      now: '2026-10-26T15:00:00.000Z',
    });
    const [ma, mb] = two.members;
    // ⚠ **大量に戦力外を出した球団**を作る。名簿が2人しか残っていない球団が
    //    0人の案を出しても、最低限（投手1・捕手1・野手8）まで補われること。
    //    ⚠ **12球団の空き枠の合計を候補の数（実測119人）以内に収めること**。
    //       いまは希望が尽きても枠を埋めるので、空き枠の合計がそのまま
    //       取りにいく人数になる。超えると候補が尽きて、最低限に届かない球団が
    //       出た所で「投手・捕手・野手が不足します」で**全員が止まる**
    //       （空きを10人ずつにしていた頃は 24+11×10＝134人で実際にそうなった）。
    //       いまは 24＋11×6＝90人。
    // まずセットを配って名簿を作る（開幕前の手続き）
    for (const m of two.members)
      submitPhase(
        two,
        m.userId,
        {
          phaseId: two.phase.id,
          plan: defaultPhasePlan(two, m.teamName),
          ready: true,
        },
        '2026-10-26T15:00:00.000Z',
      );
    assert.equal(two.phase?.kind, 'camp', '前提: セット選択が解決してキャンプへ');
    loadLeagueWorld(two);
    const KEEP_TWO = { pitcher: 9, catcher: 2, infielder: 5, outfielder: 4 };
    for (const name of two.season.settings.teamNames) {
      const team = TEAMS_DATA[name];
      const left = name === ma.teamName
        ? { pitcher: 1, catcher: 0, infielder: 0, outfielder: 1 }
        : { ...KEEP_TWO };
      team.players = team.players.filter((p) => {
        const group = rosterGroup(p.position);
        if (left[group] <= 0) return false;
        left[group] -= 1;
        return true;
      });
    }
    openPhaseSeeded(two, 'tryout', '2026-10-26T15:00:00.000Z', 20261026);
    two.game = captureWorld();
    assert.equal(
      two.game.teams[ma.teamName].players.length,
      2,
      '前提: 大量に戦力外を出した球団',
    );
    submitPhase(
      two,
      ma.userId,
      { phaseId: two.phase.id, plan: { count: 0, rankedIds: [] }, ready: true },
      '2026-10-26T15:00:00.000Z',
    );
    submitPhase(
      two,
      mb.userId,
      {
        phaseId: two.phase.id,
        plan: defaultPhasePlan(two, mb.teamName),
        ready: true,
      },
      '2026-10-26T15:00:00.000Z',
    );
    assert.notEqual(
      two.phase?.kind,
      'tryout',
      '0人の案が1つあるだけでトライアウトが解決しない',
    );
    const zero = two.game.teams[ma.teamName].players;
    const zc = rosterCounts(zero);
    assert.ok(
      zero.length - zc.pitcher >= 8 && zc.pitcher >= 1 && zc.catcher >= 1,
      `0人の案の球団が最低限を満たさない: ${JSON.stringify(zc)}`,
    );
    // ⚠ **0人の案でも枠は埋める**（以前は「最低限だけ補い、12人を超えない」
    //    ことを見ていた）。交渉は10人までで、しかも上位の球団に先を越されるので、
    //    希望が尽きた所で打ち切ると**その球団だけ名簿が足りないまま**1年を
    //    始めることになる（実測で自分21人・CPU26人。控えの数でそのまま不利）。
    //    誰とも交渉しなかった球団は、CPUと同じ判断で枠いっぱいまで埋める。
    assert.equal(
      zero.length,
      ROSTER_LIMIT,
      `0人の案の球団の枠が埋まっていない: ${zero.length}人（${JSON.stringify(zc)}）`,
    );
  }

  // --- 名簿が空の球団でも、枠いっぱいまで取れること -----------------------
  // ⚠ **巡目は枠の数から取ること**。直に 24 と書いていると、枠を26へ
  //    増やしたときに取り残され、空の球団が24人で止まる（1人も居ない状態から
  //    組み直す球団が出てくる）。
  {
    const empty = createLeague({
      members: [{ userId: 'x' }, { userId: 'y' }],
      now: '2026-10-26T15:00:00.000Z',
    });
    const [mx] = empty.members;
    for (const m of empty.members)
      submitPhase(
        empty,
        m.userId,
        {
          phaseId: empty.phase.id,
          plan: defaultPhasePlan(empty, m.teamName),
          ready: true,
        },
        '2026-10-26T15:00:00.000Z',
      );
    loadLeagueWorld(empty);
    // ⚠ 候補は12球団で実測120人。空の球団が枠いっぱい取れるよう、
    //    ほかの球団は空きを少なくしておく
    const KEEP_MANY = { pitcher: 9, catcher: 2, infielder: 5, outfielder: 4 };
    for (const name of empty.season.settings.teamNames) {
      const team = TEAMS_DATA[name];
      if (name === mx.teamName) {
        team.players = [];
        continue;
      }
      const left = { ...KEEP_MANY };
      team.players = team.players.filter((p) => {
        const group = rosterGroup(p.position);
        if (left[group] <= 0) return false;
        left[group] -= 1;
        return true;
      });
    }
    openPhaseSeeded(empty, 'tryout', '2026-10-26T15:00:00.000Z', 20261027);
    empty.game = captureWorld();
    assert.equal(empty.game.teams[mx.teamName].players.length, 0, '前提: 空の球団');
    for (const m of empty.members)
      submitPhase(
        empty,
        m.userId,
        {
          phaseId: empty.phase.id,
          plan: defaultPhasePlan(empty, m.teamName),
          ready: true,
        },
        '2026-10-26T15:00:00.000Z',
      );
    assert.notEqual(empty.phase?.kind, 'tryout', 'トライアウトが解決していない');
    assert.equal(
      empty.game.teams[mx.teamName].players.length,
      ROSTER_LIMIT,
      `空の球団が枠いっぱいまで取れていない（巡目が足りない）`,
    );
    // ⚠ **標準案のままなら偏らないこと**。希望順はそのまま指名順なので、
    //    標準案（サーバーの `selectPlayerForAI`）が投手に寄っていると、
    //    触らずに提出した参加者だけ控えの居ない名簿になる。
    //    実測で、直す前は人の球団だけ投手15人・野手9人（CPUは投手10・野手14）だった
    const got = rosterCounts(empty.game.teams[mx.teamName].players);
    const gotFielders = ROSTER_LIMIT - got.pitcher;
    assert.ok(got.catcher >= 1, `標準案で捕手が居ない: ${JSON.stringify(got)}`);
    assert.ok(
      gotFielders >= 12,
      `標準案で野手が ${gotFielders}人しかいない（控えが出せない）: ${JSON.stringify(got)}`,
    );
  }

  // --- 順位が上の球団が競合に勝つ -----------------------------------------
  // 【なぜ】いしだ要望「順位を上げることのご褒美」。指名順は**前年の順位が
  //    上の球団から**で、同じ選手を複数の球団が希望したら上位の球団が獲得する。
  // ⚠ **両方の向き（どちらの参加者が上でも）で見ること**。片方だけだと、
  //    並べ替えを逆にする間違いを「参加者の並び順で先に取れた」のまま通す。
  // ⚠ **2巡目も同じ順**（スネークにしない）。巡ごとに逆順にすると、2巡目は
  //    下位の球団が先に取ることになり、「順位が上なら先に取れる」と食い違う。
  {
    const contested = (topIndex, seed) => {
      const l = createLeague({
        members: [{ userId: 'a' }, { userId: 'b' }],
        now: '2026-10-26T15:00:00.000Z',
      });
      for (const m of l.members)
        submitPhase(
          l,
          m.userId,
          { phaseId: l.phase.id, plan: defaultPhasePlan(l, m.teamName), ready: true },
          '2026-10-26T15:00:00.000Z',
        );
      loadLeagueWorld(l);
      // ⚠ 空き枠の合計を候補の数（実測119人）以内に。12球団×6人＝72人
      const KEEP_ANY = { pitcher: 9, catcher: 2, infielder: 5, outfielder: 4 };
      for (const name of l.season.settings.teamNames) {
        const team = TEAMS_DATA[name];
        const left = { ...KEEP_ANY };
        team.players = team.players.filter((p) => {
          const group = rosterGroup(p.position);
          if (left[group] <= 0) return false;
          left[group] -= 1;
          return true;
        });
      }
      openPhaseSeeded(l, 'tryout', '2026-10-26T15:00:00.000Z', seed);
      l.game = captureWorld();
      // 参加者の2球団を1位・2位にする（CPUはその下）
      const top = l.members[topIndex];
      const bottom = l.members[1 - topIndex];
      for (const row of l.season.standings) {
        row.winRate =
          row.team === top.teamName ? 0.7 : row.team === bottom.teamName ? 0.69 : 0.3;
        row.gamesPlayed = 100;
        row.wins = Math.round(row.winRate * 100);
        row.losses = 100 - row.wins;
      }
      // ⚠ **CPUが欲しがらない選手で競合させる**。良い選手を使うと、2巡目までに
      //    CPUに取られて「繰り上がったのか、順位で負けたのか」が分からない
      const wish = l.phase.candidates
        .filter((p) => p.position === 'pitcher')
        .sort((x, y) => overallScore(x) - overallScore(y))
        .slice(0, 4)
        .map((p) => p.id);
      assert.equal(wish.length, 4, '前提: 競合させる候補が4人');
      // 2球団が**同じ希望順**を出す
      for (const m of l.members)
        submitPhase(
          l,
          m.userId,
          {
            phaseId: l.phase.id,
            plan: { count: wish.length, rankedIds: [...wish] },
            ready: true,
          },
          '2026-10-26T15:00:00.000Z',
        );
      assert.notEqual(l.phase?.kind, 'tryout', 'トライアウトが解決していない');
      const roundOf = (teamName, id) =>
        l.game.teams[teamName].players.find((p) => p.id === id)?.draftInfo?.round ?? null;
      return {
        top: wish.map((id) => roundOf(top.teamName, id)),
        bottom: wish.map((id) => roundOf(bottom.teamName, id)),
      };
    };
    for (const topIndex of [0, 1]) {
      const { top, bottom } = contested(topIndex, 20261028 + topIndex);
      const label = `（参加者${topIndex + 1}が1位）`;
      // 1位の球団が希望1位を取る。2位の球団は取れず、希望2位へ繰り上がる
      assert.equal(top[0], 1, `順位が上の球団が希望1位を取れていない${label}`);
      assert.equal(bottom[0], null, `順位が下の球団が競合に勝った${label}`);
      assert.equal(bottom[1], 1, `競合に負けた球団が繰り上がっていない${label}`);
      assert.equal(top[1], null, `同じ選手を2球団が取った${label}`);
      // 2巡目も順位が上の球団が先（スネークにしない）
      assert.equal(top[2], 2, `2巡目で順位が上の球団が先に取れていない${label}`);
      assert.equal(bottom[2], null, `2巡目だけ順位が逆になっている（スネーク）${label}`);
      assert.equal(bottom[3], 2, `2巡目の繰り上がりが起きていない${label}`);
    }
  }

  // --- 獲得する人数を決められる・入団した選手が残る ---------------------------
  // 【なぜ】先方（main の持ち主）指摘「トライアウトの指名選手の人数を決められない」
  //    「トライアウト後の入団選手の一覧が無く、誰が入ったかわからない」。
  //    交渉10人の形にしたとき、希望が尽きても空き枠を**必ず全部**埋めるようにしたので、
  //    少なく取ることができなくなっていた。
  // ⚠ 見るのは:
  //    ①獲得する人数（`total`）で止まる（交渉が多くても上位から人数ぶんだけ）
  //    ②0人なら取らない（最低限は名簿が満たしているので補いも起きない）
  //    ③交渉が少なければ、残りは自動で埋めて人数ちょうどになる
  //    ④`total` の無い提出（古い画面・アプリ）は前と同じく枠いっぱい
  //    ⑤参加者ごとの結果（`tryoutResults`）に、入った選手と交渉の何位かが残る
  {
    assert.equal(signTotal({}, 6), 6, '決めていないのに枠いっぱいにならない');
    assert.equal(signTotal({ total: 2 }, 6), 2, '決めた人数にならない');
    assert.equal(signTotal({ total: 9 }, 6), 6, '空き枠より多く取ろうとしている');
    assert.equal(signTotal({ total: -1 }, 6), 0, '負の人数が通る');
    assert.equal(wishedCount([1, 2, 3], 2), 2, '人数より多く交渉から取ろうとしている');
    const l = createLeague({
      members: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }],
      now: '2026-10-26T15:00:00.000Z',
    });
    for (const m of l.members)
      submitPhase(
        l,
        m.userId,
        { phaseId: l.phase.id, plan: defaultPhasePlan(l, m.teamName), ready: true },
        '2026-10-26T15:00:00.000Z',
      );
    loadLeagueWorld(l);
    const KEEP_ANY = { pitcher: 9, catcher: 2, infielder: 5, outfielder: 4 };
    for (const name of l.season.settings.teamNames) {
      const team = TEAMS_DATA[name];
      const left = { ...KEEP_ANY };
      team.players = team.players.filter((p) => {
        const group = rosterGroup(p.position);
        if (left[group] <= 0) return false;
        left[group] -= 1;
        return true;
      });
    }
    openPhaseSeeded(l, 'tryout', '2026-10-26T15:00:00.000Z', 20261099);
    l.game = captureWorld();
    const [a, b, c] = l.members;
    const room = ROSTER_LIMIT - TEAMS_DATA[a.teamName].players.length;
    assert.ok(room >= 4, `前提: 空き枠が${room}人しかない`);
    // ⚠ CPUが欲しがらない選手を交渉する（上位の選手だとCPUや他の参加者と競合する）
    const wish = [...l.phase.candidates]
      .sort((x, y) => overallScore(x) - overallScore(y))
      .slice(0, 4)
      .map((p) => p.id);
    // 負の人数は弾く（正本はサーバー）
    assert.throws(
      () =>
        submitPhase(
          l,
          a.userId,
          { phaseId: l.phase.id, plan: { count: 0, rankedIds: [], total: -1 }, ready: false },
          '2026-10-26T15:00:00.000Z',
        ),
      /獲得する人数が不正です/,
      '負の人数が通った',
    );
    // ⚠ 空き枠より多い人数は**弾かず空き枠に切る**。下書きを保存した後にトレードで名簿が
    //    増えると保存済みの人数が空き枠を超える。弾くと締め切りで下書きが捨てられ、
    //    交渉した選手が誰も取られなかった（監査 2026-11-14）
    submitPhase(
      l,
      a.userId,
      {
        phaseId: l.phase.id,
        plan: { count: 2, rankedIds: wish.slice(0, 2), total: room + 1 },
        ready: false,
      },
      '2026-10-26T15:00:00.000Z',
    );
    {
      const saved = l.phase.submissions[a.userId].plan;
      assert.equal(saved.total, room, `空き枠を超えた人数が切られていない（${saved.total}）`);
      assert.deepEqual(saved.rankedIds, wish.slice(0, 2), '交渉が消えた');
    }
    const plans = {
      a: { count: 2, rankedIds: wish, total: 2 },
      b: { count: 0, rankedIds: [], total: 0 },
      c: { count: 1, rankedIds: [wish[3]], total: 3 },
    };
    for (const m of l.members)
      submitPhase(
        l,
        m.userId,
        { phaseId: l.phase.id, plan: plans[m.userId], ready: true },
        '2026-10-26T15:00:00.000Z',
      );
    assert.notEqual(l.phase?.kind, 'tryout', 'トライアウトが解決していない');
    const added = (m) =>
      l.game.teams[m.teamName].players.filter(
        (p) => p.draftInfo?.year === l.season.year && l.tryoutResults[m.userId].picks.some((x) => x.playerId === p.id),
      );
    // ①
    assert.equal(l.tryoutResults[a.userId].picks.length, 2, `人数2人で${l.tryoutResults[a.userId].picks.length}人取った`);
    assert.deepEqual(
      l.tryoutResults[a.userId].picks.map((p) => p.wish),
      [1, 2],
      '交渉の上位から取っていない',
    );
    assert.equal(added(a).length, 2, '結果と名簿が食い違う');
    assert.equal(l.game.teams[a.teamName].players.length, ROSTER_LIMIT - room + 2, '名簿の人数が合わない');
    // ②
    assert.equal(l.tryoutResults[b.userId].picks.length, 0, '0人なのに取った');
    assert.equal(l.game.teams[b.teamName].players.length, ROSTER_LIMIT - room, '0人なのに名簿が増えた');
    // ③ 交渉1人＋自動2人。交渉した4位の選手は a が取らない（a は2人で止まる）ので c が取れる
    const cPicks = l.tryoutResults[c.userId].picks;
    assert.equal(cPicks.length, 3, `人数3人で${cPicks.length}人取った`);
    assert.equal(cPicks.filter((p) => p.wish === 1).length, 1, '交渉した選手を取っていない');
    assert.equal(cPicks.filter((p) => p.wish === null).length, 2, '残りが自動で埋まっていない');
    // ⑤ 結果は名前・守備位置・巡目を持つ（画面はこれだけで一覧を出す）
    for (const p of [...l.tryoutResults[a.userId].picks, ...cPicks]) {
      assert.ok(p.name && p.position && Number.isInteger(p.round), `結果の形が足りない: ${JSON.stringify(p)}`);
    }
    // CPU球団は前と同じく枠いっぱい
    for (const name of l.season.settings.teamNames.filter(
      (n) => !l.members.some((m) => m.teamName === n),
    ))
      assert.equal(l.game.teams[name].players.length, ROSTER_LIMIT, `${name} の枠が埋まっていない`);
  }

  // --- 最低限を補うときは、交渉した選手から ---------------------------------
  // ⚠ 捕手のいない球団が獲得0人で捕手と交渉したら、その捕手を取る（画面は「その位置の選手と
  //    交渉してください」と勧める）。以前は補うときだけCPUの判断で別の捕手が入った（監査 2026-11-14）
  {
    const l = createLeague({
      members: [{ userId: 'a' }, { userId: 'b' }],
      now: '2026-10-26T15:00:00.000Z',
    });
    for (const m of l.members)
      submitPhase(
        l,
        m.userId,
        { phaseId: l.phase.id, plan: defaultPhasePlan(l, m.teamName), ready: true },
        '2026-10-26T15:00:00.000Z',
      );
    loadLeagueWorld(l);
    const [a, b] = l.members;
    TEAMS_DATA[a.teamName].players = TEAMS_DATA[a.teamName].players.filter(
      (p) => p.position !== 'catcher',
    );
    openPhaseSeeded(l, 'tryout', '2026-10-26T15:00:00.000Z', 20261099);
    l.game = captureWorld();
    // CPUが欲しがらない（いちばん低い）捕手と交渉する
    const catcher = [...l.phase.candidates]
      .filter((p) => p.position === 'catcher')
      .sort((x, y) => overallScore(x) - overallScore(y))[0];
    const plans = {
      a: { count: 0, rankedIds: [catcher.id], total: 0 },
      b: { count: 0, rankedIds: [], total: 0 },
    };
    for (const m of l.members)
      submitPhase(
        l,
        m.userId,
        { phaseId: l.phase.id, plan: plans[m.userId], ready: true },
        '2026-10-26T15:00:00.000Z',
      );
    assert.notEqual(l.phase?.kind, 'tryout', 'トライアウトが解決していない');
    const picks = l.tryoutResults[a.userId].picks;
    assert.equal(picks.length, 1, `捕手1人だけ補うはずが${picks.length}人取った`);
    assert.equal(picks[0].playerId, catcher.id, '交渉した捕手ではない捕手で補った');
    assert.equal(picks[0].wish, 1, '交渉の1位として記録されていない');
  }

  // --- 画面の操作を何度繰り返しても、押したとおりに動くこと ---------------
  // ⚠ **以前は入れ替えるほど画面が壊れて見えた**。候補360人を1本の希望順に
  //    並べ、獲得予定は「目標構成で飛ばしたあとの顔ぶれ」だったので、
  //    - 「指名に加える」は候補336人中301人で何も起きなかった
  //    - 「↓」で選手が獲得予定から消え、控えの選手が代わりに入った
  //    いまは `rankedIds` がそのまま希望リスト（10人まで）で、配列を
  //    出し入れするだけ（いしだ要望「交渉ボタンを押す」）。
  {
    const limit = TRYOUT_WISH_MAX;
    // ⚠ 交渉できるのは**10人まで**。空き枠が少ない年はさらに少ない
    assert.equal(wishLimit(26), TRYOUT_WISH_MAX, '空き枠が多くても10人を超えている');
    assert.equal(wishLimit(3), 3, '空き枠より多く交渉できる');
    assert.equal(wishLimit(0), 0, '空きが無いのに交渉できる');
    assert.equal(planCount([1, 2, 3], 2), 2, '空き枠より多く取ろうとしている');
    assert.equal(planCount([1, 2], 5), 2, '交渉していない人数まで取ろうとしている');

    // 1) どの候補でも「交渉」で希望リストに入る（満員でなければ）
    {
      let missed = 0;
      for (const p of candidates.slice(0, 60)) {
        const next = addToPlan([], p.id, limit);
        if (next.length !== 1 || next[0] !== p.id) missed += 1;
      }
      assert.equal(missed, 0, `「交渉」で入らない選手が${missed}人いる`);
    }
    // 2) 満員になったら増えない。同じ人を2回押しても増えない
    {
      let ids = [];
      for (const p of candidates.slice(0, limit + 5)) ids = addToPlan(ids, p.id, limit);
      assert.equal(ids.length, limit, `交渉が${limit}人を超えた: ${ids.length}人`);
      assert.deepEqual(
        addToPlan(ids, ids[0], limit),
        ids,
        '同じ選手を2回交渉できる',
      );
    }
    // 3) 操作を無作為に500回当てても、毎回押したとおりになる
    const sameSet = (a, b) => [...a].sort().join() === [...b].sort().join();
    let ids = candidates.slice(0, limit).map((p) => p.id);
    let seed = 12345;
    const rand = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return n > 0 ? seed % n : 0;
    };
    for (let step = 0; step < 500; step += 1) {
      const before = [...ids];
      const op = rand(5);
      let next;
      if (op === 4 && before.length > 1) {
        // ドラッグ: from 位の選手を to 位へ（間の選手は1つずつずれる）
        const from = rand(before.length);
        const to = rand(before.length);
        next = moveInPlan(ids, before[from], to);
        assert.ok(sameSet(next, before), `${step}回目: ドラッグで顔ぶれが変わった`);
        assert.equal(next[to], before[from], `${step}回目: ドラッグした位置に来ない`);
        const rest = (list, id) => list.filter((x) => x !== id);
        assert.deepEqual(
          rest(next, before[from]),
          rest(before, before[from]),
          `${step}回目: ドラッグで間の選手の順が崩れた`,
        );
      } else if ((op === 0 || op === 1) && before.length > 1) {
        const i = rand(before.length);
        const delta = op === 0 ? -1 : 1;
        next = shiftInPlan(ids, i, delta);
        assert.ok(sameSet(next, before), `${step}回目: ↑↓で顔ぶれが変わった`);
        const j = i + delta;
        if (j >= 0 && j < before.length)
          assert.equal(next[j], before[i], `${step}回目: ↑↓で1つ動かない`);
      } else if (op === 2 && before.length) {
        const id = before[rand(before.length)];
        next = removeFromPlan(ids, id);
        assert.ok(!next.includes(id), `${step}回目: やめた選手が残った`);
        assert.equal(next.length, before.length - 1, `${step}回目: やめて人数が合わない`);
      } else {
        const pick = candidates[rand(candidates.length)];
        next = addToPlan(ids, pick.id, limit);
        if (before.includes(pick.id) || before.length >= limit)
          assert.deepEqual(next, before, `${step}回目: 入らないはずの交渉で変わった`);
        else {
          assert.equal(next.at(-1), pick.id, `${step}回目: 交渉した選手が末尾に入らない`);
          assert.equal(next.length, before.length + 1, `${step}回目: 交渉で人数が合わない`);
        }
      }
      // ⚠ 提出の条件（全員が候補・重複なし・10人まで）を壊さない
      assert.ok(next.length <= limit, `${step}回目: ${limit}人を超えた`);
      assert.equal(new Set(next).size, next.length, `${step}回目: 重複した`);
      assert.ok(
        next.every((id) => candidates.some((p) => p.id === id)),
        `${step}回目: 候補に居ない人が混ざった`,
      );
      ids = next;
    }
    // 4) 獲得予定は**希望順のとおり**（目標構成で飛ばさない）。
    //    ⚠ 自分で10人選ぶ形なので、1位を飛ばされると何を選んだのか分からない
    {
      const pitchers = candidates.filter((p) => p.position === 'pitcher').slice(0, 5);
      const order = pitchers.map((p) => p.id);
      const picked = plannedPicks(order, candidates, 3, []).map((p) => p.id);
      assert.deepEqual(picked, order.slice(0, 3), '希望順のとおりに取っていない');
      assert.deepEqual(
        plannedPicks(order, candidates, 0, []),
        [],
        '0人のときに取っている',
      );
    }
  }

  // --- 重視する能力の重みから、おすすめ順を作る ---------------------------
  // 【なぜ】標準案と「総合」は決まった配分でしか見ない。参加者が重みを決め、
  //    その評価値でおすすめ順を組めるようにした（画面だけの計算。提出の形は同じ）。
  {
    const none = [];
    for (const p of candidates) {
      const v = weightedScore(p, DEFAULT_WEIGHTS);
      assert.ok(v >= 0 && v <= 100, `評価値が0〜100を外れた: ${p.id} ${v}`);
    }
    const ranked = weightedRanked(candidates, DEFAULT_WEIGHTS, none);
    // ⚠ **提出の条件を壊さない**（10人まで・重複なし・全員が候補）。おすすめ順は
    //    そのまま希望リストに入るので、ここが11人以上だとサーバーに弾かれる
    assert.equal(
      ranked.length,
      TRYOUT_WISH_MAX,
      `重みのおすすめが${ranked.length}人（交渉できるのは${TRYOUT_WISH_MAX}人まで）`,
    );
    assert.equal(new Set(ranked).size, ranked.length, '重みのおすすめで重複した');
    assert.ok(
      ranked.every((id) => candidates.some((p) => p.id === id)),
      '重みのおすすめに候補でない選手が混ざった',
    );
    // 獲得予定はおすすめ順のまま（飛ばさない）、評価の高い順
    const picks = plannedPicks(ranked, candidates, ranked.length, none);
    assert.deepEqual(picks.map((p) => p.id), ranked, '獲得予定がおすすめ順のとおりでない');
    // ⚠ **おすすめ順は偏らせない**（希望順のとおりに取るので、ここが偏ると
    //    そのまま偏った名簿になる）。目標構成に空きのある区分から勧めること
    const recommended = rosterCounts(picks);
    for (const [group, target] of Object.entries(ROSTER_TARGETS))
      assert.ok(
        recommended[group] <= target,
        `おすすめが ${group} で目標 ${target} を超えた: ${recommended[group]}`,
      );
    const sc = picks.map((p) => weightedScore(p, DEFAULT_WEIGHTS));
    assert.ok(sc.every((v, i) => i === 0 || sc[i - 1] >= v), '獲得予定が評価の高い順でない');
    // パワーを重視（ほかは軽視）にすると、パワーを軽視（ほかは重視）より
    // パワーの高い野手を取る。⚠ 「無視」は無いので、1項目だけで決まりはしない
    const lowAll = Object.fromEntries(WEIGHT_FIELDS.map((f) => [f.key, 0]));
    const highAll = Object.fromEntries(WEIGHT_FIELDS.map((f) => [f.key, WEIGHT_MAX]));
    const picksWith = (w, roster = none) =>
      plannedPicks(weightedRanked(candidates, w, roster), candidates, TRYOUT_WISH_MAX, roster);
    const avgOf = (xs, f) => xs.reduce((n, p) => n + f(p), 0) / xs.length;
    // ⚠ **投手が埋まっている名簿で見る**。おすすめは10人までなので、
    //    空の名簿だと投手ばかり勧められて野手の比べようがない回がある
    const pitchersFull = Array.from({ length: ROSTER_TARGETS.pitcher }, (_, i) => ({
      id: -300 - i,
      position: 'pitcher',
    }));
    const fieldersOf = (xs) => xs.filter((p) => p.position !== 'pitcher');
    const powerUp = avgOf(fieldersOf(picksWith({ ...lowAll, power: WEIGHT_MAX }, pitchersFull)), (p) => p.batting.power);
    const powerDown = avgOf(fieldersOf(picksWith({ ...highAll, power: 0 }, pitchersFull)), (p) => p.batting.power);
    assert.ok(powerUp > powerDown, `パワー重視が効いていない: ${powerUp} <= ${powerDown}`);
    const youngUp = avgOf(picksWith({ ...lowAll, youth: WEIGHT_MAX }), (p) => p.age);
    const youngDown = avgOf(picksWith({ ...highAll, youth: 0 }), (p) => p.age);
    assert.ok(youngUp < youngDown, `若さ重視が効いていない: ${youngUp} >= ${youngDown}`);
    // 名簿がある球団（2年目以降のトライアウト）では、名簿の分だけ区分の空きが減る
    // ⚠ **目標の人数から作ること**。10と直に書くと、目標を変えたときに
    //    「埋まっている」前提が崩れる（枠を26にしたときに実際そうなった）
    const full = Array.from({ length: ROSTER_TARGETS.pitcher }, (_, i) => ({
      id: -200 - i,
      position: 'pitcher',
    }));
    const withRoster = plannedPicks(
      weightedRanked(candidates, DEFAULT_WEIGHTS, full),
      candidates,
      ROSTER_LIMIT - full.length,
      full,
    );
    assert.equal(
      rosterCounts(withRoster).pitcher,
      0,
      '投手が埋まっている球団に投手を勧める',
    );
    // 段階は番号をそのまま掛けない（軽視0.6〜最重視1.6を0.2刻みの6段階。0倍は無い）
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5].map(weightFactor),
      [0.6, 0.8, 1.0, 1.2, 1.4, 1.6],
      '段階の倍率が想定と違う',
    );
    {
      // ミート「最重視」（1.6）・ほかは「軽視」（0.6）なら、評価はその重み付き平均
      const w = { ...lowAll, meet: WEIGHT_MAX };
      const one = {
        position: 'first',
        age: 25, // 若さ 50
        batting: { meet: 80, power: 40, eye: 50 },
        physical: { speed: 60, arm: 30 },
        fielding: { defense: 70 },
      };
      const expected = (80 * 1.6 + (40 + 50 + 60 + 70 + 30 + 50) * 0.6) / (1.6 + 0.6 * 6);
      assert.ok(Math.abs(weightedScore(one, w) - expected) < 1e-9, '重み付き平均になっていない');
    }
    // 壊れた重みは直す（0〜5の整数。知らない値は既定）
    assert.deepEqual(
      sanitizeWeights({ meet: 9, power: -3, eye: '2.7', speed: 'x' }),
      { ...DEFAULT_WEIGHTS, meet: WEIGHT_MAX, power: 0, eye: 2, speed: DEFAULT_WEIGHTS.speed },
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(
  '■ 希望リストの組み立て: OK（絞り込み・並べ替え・人数が減らない・提出が通る・交渉は10人まで・希望順のとおりに取る・希望のあとの空き枠が埋まる・順位が上の球団が競合に勝つ・獲得する人数で止まる・入団した選手が結果に残る・成り立たない編成を提出前に知らせる・標準案なら名簿が偏らない・入れ替えを繰り返しても押したとおりに動く・重みからおすすめ順を作る）',
);
