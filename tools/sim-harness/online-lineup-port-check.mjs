// オンラインの編成の受け渡し（`src/online/lineupBridge.js`）とスマホの打順（`tapLineup.js`）の検査。
//
// ⚠ 主目的は「**保存していない編集の入れ物（`lineup.full`。`team` 形）から、サーバーが
//    受け取れる `plan` が作れること**」。スマホとPCの画面が入れ替わるとき（回転）は、
//    編集を `team` 形で預けて読み直す。投影（`projectLineup`）と検証（`validateLineup`）の
//    両方と形が合っていないと、画面では編集できるのに保存の瞬間だけ弾かれる——
//    いちばん気づきにくい壊れ方になる。
// ⚠ 以前はスマホの投手起用が一人用の編成画面（`team` 形をその場で書き換える）を使っていた。
//    いまはPCと同じ表（`MobilePitching.jsx` → `PitchingBoard.jsx`）で、`team` 形は受け渡しだけ。
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
import {
  teamFromView,
  planFromTeam,
  rebaseLineupSave,
  rebaseLineupParts,
  fullLineupFromBoards,
  fullLineupTouchesPitching,
  LINEUP_EDITOR_KEYS,
  LINEUP_BOARD_KEYS,
  TACTICS_EDITOR_KEYS,
} from '../../src/online/lineupBridge.js';
import {
  buildTapDraft,
  startTapDraft,
  commitTap,
  undoTap,
  tapValue,
  tapDirty,
  tapPlan,
  tapLineup,
  restoreFromTapDraft,
} from '../../src/online/tapLineup.js';
import { benchFielders } from '../../src/online/lineupEdit.js';
import { pitchingFromLineup } from '../../src/online/pitchingEdit.js';
import { generateOptimalLineup, generatePitchingRotation } from '../../src/game/lineupGenerator.js';
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

  // 先発が1人で、その選手が野手も兼ねる。9番には控えの投手を仮に置き、
  // 編成画面で同じ選手が2回並んで野手枠が消えるのを防ぐ。
  {
    const fielding = view.lineup.battingOrder.map((e) => ({ ...e }));
    const twoWay = view.lineup.starters[0];
    fielding[0].playerId = twoWay;
    const onlyStarter = {
      ...view,
      nextStarterId: twoWay,
      lineup: { ...view.lineup, battingOrder: fielding, starters: [twoWay] },
    };
    const t = teamFromView(onlyStarter);
    const entries = t.lineupSettings.battingOrder;
    assert.equal(entries.length, 9, '先発1人の二刀流で9枠を復元できない');
    assert.equal(new Set(entries.map((e) => e.playerId)).size, 9, '二刀流の先発が2回並んでいる');
    assert.deepEqual(planFromTeam(t).battingOrder, fielding.sort((a, b) => a.battingOrder - b.battingOrder), '9番の補完で野手枠を変更した');
    assert.equal(planFromTeam(t).starters[0], twoWay, '9番の補完で先発を変更した');
  }

  // --- PCの2つの編集画面が同じ編成を保存しても、互いの編集を消さないか -----
  // ⚠ PCでは「スタメン設定・投手起用」と「方針・采配」が**同じ編成の塊**を別々に
  //    編集する。保存には編集を始めたときの塊（`baseLineup`）を添え、サーバーの今と
  //    違えば弾かれる。`rebaseLineupSave` は自分の項目だけを最新の塊に載せて送る。
  {
    const latestRevision = async () => (await store.read()).league.revision;
    const start = (await service.view('admin', sessionId)).lineup;
    // ① 方針・采配だけ保存（スタメン設定側は start を起点に編集中のまま）
    const tactics = {
      strategy: { ...start.strategy, batting: 'patient' },
      tactics: start.tactics,
    };
    await run(
      'lineup',
      await latestRevision(),
      rebaseLineupSave(tactics, start, start, TACTICS_EDITOR_KEYS),
    );
    const afterTactics = (await service.view('admin', sessionId)).lineup;
    assert.equal(afterTactics.strategy.batting, 'patient', '方針が保存されていない');
    // ② スタメン設定側は古い起点（start）のまま保存する。弾かれず、①の方針も残ること
    const reordered = [...start.starters].reverse();
    await run(
      'lineup',
      await latestRevision(),
      rebaseLineupSave(
        { ...start, starters: reordered },
        start,
        afterTactics,
        LINEUP_EDITOR_KEYS,
      ),
    );
    const afterLineup = (await service.view('admin', sessionId)).lineup;
    assert.deepEqual(afterLineup.starters, reordered, '先発の並びが保存されていない');
    assert.equal(
      afterLineup.strategy.batting,
      'patient',
      'スタメン設定の保存で、別の画面で保存した方針を古い値に戻した',
    );
    // ③ 自分の項目（先発）が他で変わっていたら、本当の食い違いとして弾かれること
    await assert.rejects(
      run(
        'lineup',
        await latestRevision(),
        rebaseLineupSave(
          { ...start, starters: [...start.starters].slice(1).concat(start.starters[0]) },
          start,
          afterLineup,
          LINEUP_EDITOR_KEYS,
        ),
      ),
      /編成がほかの画面で更新されています/,
      '自分の項目が他で変わっていたのに上書きできてしまう',
    );
    assert.deepEqual(
      (await service.view('admin', sessionId)).lineup.starters,
      reordered,
      '弾かれたはずの保存で先発が変わった',
    );
    // ④ 方針・采配で項目を消したとき（undefined）は、送る塊からも消える
    const dropped = rebaseLineupSave(
      { strategy: undefined, tactics: afterLineup.tactics },
      afterLineup,
      afterLineup,
      TACTICS_EDITOR_KEYS,
    );
    assert.ok(!('strategy' in dropped), '消した項目が送る塊に残っている');
    assert.deepEqual(dropped.baseLineup, afterLineup, '起点が最新の塊になっていない');
  }

  // --- スマホの打順（2タップの表 `TapLineup.jsx`）------------------------
  // ⚠ 1回目に押したもので「何を入れ替えるか」が決まる（名前＝打順、守備位置の札＝守備、
  //    控え＝交代）。2回目は相手の行のどこを押してもよい（名前でも札でも同じ）。
  //    どの操作の後も**そのまま保存できる形**（`validateLineup` を通る）こと。
  // ⚠ 保存は方針・采配の下書きとまとめて送る（`rebaseLineupParts`）。それぞれ自分の項目
  //    だけを最新に載せるので、PCや別の端末で保存したほかの項目を古い値に戻さない
  {
    const latestRevision = async () => (await store.read()).league.revision;
    const start = await service.view('admin', sessionId);
    let draft = buildTapDraft(start);
    const pressSeq = (...targets) => {
      let selection = null;
      let order = tapValue(draft);
      for (const target of targets) {
        const result = tapLineup(order, selection, target);
        ({ order, selection } = result);
      }
      assert.equal(selection, null, '2回押したのに選んだまま');
      draft = commitTap(draft, order);
      assert.doesNotThrow(
        () =>
          validateLineup(league.game.teams[teamName], {
            ...start.lineup,
            ...tapPlan(draft),
          }),
        '2タップの入れ替えの後に保存できない形になった',
      );
      return order;
    };
    const before = tapValue(draft);
    // 名前 → 名前: 打順を入れ替える（守備位置は選手に付いたまま）
    let order = pressSeq({ kind: 'row', index: 0 }, { kind: 'row', index: 2 });
    assert.deepEqual(order[0], before[2]);
    assert.deepEqual(order[2], before[0]);
    // 守備位置の札 → 名前: 守備位置を入れ替える（打順はそのまま）
    order = pressSeq({ kind: 'pos', index: 0 }, { kind: 'row', index: 1 });
    assert.equal(order[0].playerId, before[2].playerId, '守備の入れ替えで打順が動いた');
    assert.equal(order[0].position, before[1].position, '守備位置が入れ替わっていない');
    // 名前 → 控え: 交代（打順と守備位置を引き継ぐ）
    const reserve = benchFielders(start.roster, order)[0];
    order = pressSeq({ kind: 'row', index: 3 }, { kind: 'bench', playerId: reserve.id });
    assert.equal(order[3].playerId, reserve.id, '控えと交代していない');
    assert.equal(order[3].position, before[3].position, '交代で守備位置が変わった');
    // 守備位置の札 → 札: 守備位置を入れ替える
    order = pressSeq({ kind: 'pos', index: 4 }, { kind: 'pos', index: 5 });
    assert.equal(order[4].position, before[5].position, '札どうしで守備位置が入れ替わっていない');
    // 2回目は相手の行のどこを押してもよい: 名前を選んで札を押しても打順の入れ替え
    order = pressSeq({ kind: 'row', index: 5 }, { kind: 'pos', index: 6 });
    assert.equal(order[5].playerId, before[6].playerId, '名前の次に札を押して打順が入れ替わらない');
    // 札を選んで控え／控えを選んで札: 交代
    const spare = () => benchFielders(start.roster, order)[0];
    let reserve2 = spare();
    order = pressSeq({ kind: 'pos', index: 7 }, { kind: 'bench', playerId: reserve2.id });
    assert.equal(order[7].playerId, reserve2.id, '札の次に控えを押して交代しない');
    reserve2 = spare();
    order = pressSeq({ kind: 'bench', playerId: reserve2.id }, { kind: 'pos', index: 2 });
    assert.equal(order[2].playerId, reserve2.id, '控えの次に札を押して交代しない');
    // 同じものをもう一度押すと選ぶのをやめる。同じ行の札と名前の押し替え・控えどうしは選び直す
    assert.equal(tapLineup(order, { kind: 'row', index: 1 }, { kind: 'row', index: 1 }).selection, null);
    assert.deepEqual(
      tapLineup(order, { kind: 'row', index: 1 }, { kind: 'pos', index: 1 }).selection,
      { kind: 'pos', index: 1 },
    );
    const [benchA, benchB] = benchFielders(start.roster, order);
    assert.deepEqual(
      tapLineup(order, { kind: 'bench', playerId: benchA.id }, { kind: 'bench', playerId: benchB.id }).selection,
      { kind: 'bench', playerId: benchB.id },
    );
    // 元に戻すは1手ずつ
    assert.equal(draft.stack.length, 8);
    assert.deepEqual(tapValue(undoTap(draft)), draft.stack[6]);
    // PCの画面へ渡す形（`lineup.full`）から始めても同じ編集になる。打順だけなら全画面の編成は開かない
    const kept = fullLineupFromBoards(start, [
      { keys: LINEUP_BOARD_KEYS, plan: tapPlan(draft), baseLineup: draft.baseLineup },
    ]);
    assert.equal(fullLineupTouchesPitching(kept), false, '打順だけの編集で全画面の編成を開く');
    assert.deepEqual(tapValue(startTapDraft(start, null, kept)), order, '受け取った編集が違う');
    assert.deepEqual(
      startTapDraft(start, { ...draft, dirty: true }, kept),
      draft,
      '同じ編集なら下書き（元に戻すの履歴つき）のまま使わない',
    );
    assert.deepEqual(restoreFromTapDraft(draft).lineup.battingOrder, tapPlan(draft).battingOrder);
    const pitching = fullLineupFromBoards(start, [
      {
        keys: ['starters'],
        plan: { starters: [...start.lineup.starters].reverse() },
        baseLineup: start.lineup,
      },
    ]);
    assert.equal(fullLineupTouchesPitching(pitching), true, '投手起用の編集を表が引き取ってしまう');
    // ① 方針・采配を別の画面で保存したあとでも、打順の保存は弾かれず、方針も残る
    const tacticsBase = start.lineup;
    await run(
      'lineup',
      await latestRevision(),
      rebaseLineupSave(
        { strategy: { ...tacticsBase.strategy, batting: 'aggressive' }, tactics: tacticsBase.tactics },
        tacticsBase,
        tacticsBase,
        TACTICS_EDITOR_KEYS,
      ),
    );
    const afterTactics = (await service.view('admin', sessionId)).lineup;
    assert.ok(tapDirty(draft));
    await run(
      'lineup',
      await latestRevision(),
      rebaseLineupParts(
        [{ keys: LINEUP_BOARD_KEYS, plan: tapPlan(draft), base: draft.baseLineup }],
        afterTactics,
      ),
    );
    const saved = (await service.view('admin', sessionId)).lineup;
    assert.deepEqual(
      saved.battingOrder.map((e) => [e.playerId, e.position]),
      order.map((e) => [e.playerId, e.position]),
      'スマホの打順が保存されていない',
    );
    assert.equal(saved.strategy.batting, 'aggressive', '打順の保存で方針を古い値に戻した');
    // ② 打順と方針をまとめて送る。打順が他で変わっていたら本当の食い違いとして弾く
    const stale = commitTap(buildTapDraft(start), [...before].reverse());
    await assert.rejects(
      run(
        'lineup',
        await latestRevision(),
        rebaseLineupParts(
          [
            { keys: LINEUP_BOARD_KEYS, plan: tapPlan(stale), base: stale.baseLineup },
            { keys: TACTICS_EDITOR_KEYS, plan: saved, base: saved },
          ],
          saved,
        ),
      ),
      /編成がほかの画面で更新されています/,
      '打順が他で変わっていたのに上書きできてしまう',
    );
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
  // --- 同じ役割の中の順番が、試合の使われ方まで届くか ----------------
  // ⚠ いしだ 2026-11-20「リリーフ投手が同じロールだった場合、並びが上の選手が優先して
  //    使われてしまいます。同じロール内で順番を入れ替えられるようにしてほしいです」
  {
    const team = league.game.teams[teamName];
    const relievers = team.players
      .filter((p) => p.position === 'pitcher' && p.isActive !== false)
      .slice(5, 8)
      .map((p) => p.id);
    assert.ok(relievers.length === 3, '前提: 救援に回せる投手が足りない');
    const roles = Object.fromEntries(relievers.map((id) => [id, 'mopup']));
    const starters = team.players
      .filter((p) => p.position === 'pitcher' && !relievers.includes(p.id))
      .slice(0, 5)
      .map((p) => p.id);
    const base = projectLineup(team);
    saveLineup(league, 'admin', {
      battingOrder: base.battingOrder,
      starters,
      strategy: base.strategy,
      pitcherRoles: roles,
    });
    const first = league.game.teams[teamName].pitchingRotation;
    // ⚠ 順番を送らなければ名簿の並び（今までどおり）
    assert.deepEqual(
      first.middleRelievers.filter((id) => relievers.includes(id)),
      relievers,
      '順番を送らないときは名簿の並びにならない',
    );
    // 逆順で送ると、一覧もその順になる
    const reversed = [...relievers].reverse();
    saveLineup(league, 'admin', {
      battingOrder: base.battingOrder,
      starters,
      strategy: base.strategy,
      pitcherRoles: roles,
      pitcherOrder: reversed,
    });
    const after = league.game.teams[teamName].pitchingRotation;
    assert.deepEqual(
      after.middleRelievers.filter((id) => relievers.includes(id)),
      reversed,
      '決めた順が救援の一覧に届いていない',
    );
    assert.deepEqual(
      after.relievers.filter((id) => relievers.includes(id)),
      reversed,
      '決めた順が救援の一覧（relievers）に届いていない',
    );
    // ⚠ 画面へ返す形にも順番が載る（開き直しても並びが戻らない）
    assert.deepEqual(
      projectLineup(league.game.teams[teamName]).pitcherOrder.filter((id) =>
        relievers.includes(id),
      ),
      reversed,
      '画面へ返す形に順番が載っていない',
    );
    // ⚠ 役割だけを保存し直しても順番が消えない
    saveLineup(league, 'admin', {
      battingOrder: base.battingOrder,
      starters,
      strategy: base.strategy,
      pitcherRoles: roles,
    });
    assert.deepEqual(
      league.game.teams[teamName].pitchingRotation.middleRelievers.filter((id) =>
        relievers.includes(id),
      ),
      reversed,
      '役割だけ保存したら順番が消えた',
    );
  }

  // --- 画面の「同じ役割の中の順」と、試合が使う順（`middleRelievers` / `setupMen`）が合う
  // ⚠ 監査 2026-11-20。保存（`lineupTactics`）はその順で欄を作るが、作り直す経路
  //    （一度も保存していない・守備位置を変えた `force`・投手起用を任せた）は
  //    `generatePitchingRotation` の能力の順のままで、画面の▲▼と別の投手が先に出ていた
  {
    let seq = 0;
    const cmd = async (type, payload) =>
      service.command('admin', sessionId, {
        requestId: `relief-${type}-${++seq}`,
        revision: (await store.read()).league.revision,
        type,
        payload,
      });
    const sameOrder = async (label) => {
      const current = await service.view('admin', sessionId);
      const state = pitchingFromLineup(current.lineup, current.roster);
      const stored = (await store.read()).league;
      const rotation = stored.game.teams[stored.members[0].teamName].pitchingRotation;
      const rank = (id) => state.order.indexOf(id);
      let groups = 0;
      for (const list of [rotation.setupMen, rotation.middleRelievers]) {
        const byRole = {};
        for (const id of list) (byRole[state.roles[id]] ||= []).push(id);
        for (const ids of Object.values(byRole)) {
          if (ids.length < 2) continue;
          groups += 1;
          assert.deepEqual(
            ids,
            [...ids].sort((a, b) => rank(a) - rank(b)),
            `${label}: 試合で使う順が画面の同じ役割の中の順と違う`,
          );
        }
      }
      assert.ok(groups > 0, `前提（${label}）: 2人以上の役割が無い`);
      return current;
    };
    // (c) 一度も保存していない球団: 控えの野手を投手にして、同じ役割を2人以上にする
    //     （守備位置の変更は作り直し＝能力の順の欄になる）
    let current = await service.view('admin', sessionId);
    const playing = new Set(current.lineup.battingOrder.map((e) => e.playerId));
    const bench = current.roster.filter(
      (p) => p.position !== 'pitcher' && p.isActive !== false && !playing.has(p.id),
    );
    for (const p of bench.slice(0, 3)) await cmd('convert', { playerId: p.id, position: 'pitcher' });
    assert.equal(current.lineup.pitcherOrder, undefined, '前提: 並べ替えを保存していない');
    current = await sameOrder('保存していない');
    // 救援を逆の順に保存してから、(b) 守備位置を変える（作り直す）
    const state = pitchingFromLineup(current.lineup, current.roster);
    await cmd('lineup', {
      battingOrder: current.lineup.battingOrder,
      starters: state.starters,
      strategy: current.lineup.strategy,
      pitcherRoles: state.roles,
      pitcherOrder: [...state.order].reverse(),
      baseLineup: current.lineup,
    });
    current = await sameOrder('並べ替えを保存した');
    const more = current.roster.find(
      (p) =>
        p.position !== 'pitcher' &&
        p.isActive !== false &&
        !current.lineup.battingOrder.some((e) => e.playerId === p.id),
    );
    assert.ok(more, '前提: 投手にできる控えの野手が居ない');
    await cmd('convert', { playerId: more.id, position: 'pitcher' });
    current = await sameOrder('守備位置を変えた後');
    // (a) 投手起用を指導者に任せる（作り直す）
    // ⚠ 判断4（いしだ 2026-11-20「おすすめで」）: 任せている間は**指導者が並べた順**
    //    （`generatePitchingRotation` の能力の順）で起用し、画面にもその順で出す。
    //    人が▲▼で並べた順（上で逆に保存した）や名簿の並びのままにしない
    const roleGroups = (state, order) => {
      const groups = {};
      for (const id of order)
        if (Object.hasOwn(state.roles, String(id)) && !state.starters.includes(id))
          (groups[state.roles[id]] ||= []).push(id);
      return groups;
    };
    const coachRotation = async () => {
      const stored = (await store.read()).league;
      const fresh = JSON.parse(JSON.stringify(stored.game.teams[stored.members[0].teamName]));
      generatePitchingRotation(null, fresh);
      const r = fresh.pitchingRotation;
      return { r, coach: [...(r.closer != null ? [r.closer] : []), ...r.setupMen, ...r.middleRelievers] };
    };
    // 任せる前に、人が指導者の順と**逆**に並べて保存しておく（見分けられるように）
    {
      const { coach } = await coachRotation();
      const before = pitchingFromLineup(current.lineup, current.roster);
      await cmd('lineup', {
        ...current.lineup,
        starters: before.starters,
        pitcherRoles: before.roles,
        pitcherOrder: [...coach].reverse(),
        baseLineup: current.lineup,
      });
      current = await sameOrder('指導者と逆に並べて保存した');
    }
    const humanOrder = pitchingFromLineup(current.lineup, current.roster).order;
    await cmd('staffModes', { modes: { pitching: 'delegate' } });
    current = await sameOrder('投手起用を任せた後');
    {
      const stored = (await store.read()).league;
      const own = stored.game.teams[stored.members[0].teamName];
      const { r, coach } = await coachRotation();
      const state = pitchingFromLineup(current.lineup, current.roster);
      assert.ok(current.lineup.pitcherOrder?.length, '任せた球団の画面へ指導者の順が返らない');
      const shown = roleGroups(state, state.order);
      const wanted = roleGroups(state, coach);
      assert.deepEqual(shown, wanted, '任せた球団の画面の同じ役割の中の順が、指導者の能力の順と違う');
      assert.notDeepEqual(
        roleGroups(state, humanOrder),
        wanted,
        '前提: 人が並べた順と指導者の順が同じで、見分けられない',
      );
      // 試合が使う欄も能力の順（`sameOrder` で画面の順と合うことは見た）
      const rot = own.pitchingRotation;
      assert.deepEqual(rot.middleRelievers, r.middleRelievers, '任せた球団の中継ぎの欄が能力の順でない');
      assert.deepEqual(rot.setupMen, r.setupMen, '任せた球団のセットアッパーの欄が能力の順でない');
    }
    // 任せたまま打順だけ保存しても、投手起用は任せたまま（指導者の順を「変えた」に数えない）。
    // 版の食い違い（409）の条件は変えない: 画面が受け取った形をそのまま送り返せば通る
    const delegatedView = current.lineup;
    await cmd('lineup', { ...delegatedView, baseLineup: delegatedView });
    {
      const stored = (await store.read()).league;
      assert.equal(
        stored.members[0].staffModes?.pitching,
        'delegate',
        '任せたまま打順だけ保存したら、投手起用が任せていない扱いに戻った',
      );
    }
    current = await sameOrder('任せたまま打順を保存した後');
    assert.deepEqual(current.lineup.pitcherOrder, delegatedView.pitcherOrder, '打順の保存で救援の順が変わった');
    // 任せる→自分で: 任せていた間の順がそのまま初めの順になる
    await cmd('staffModes', { modes: { pitching: 'self' } });
    current = await sameOrder('任せるのをやめた後');
    assert.deepEqual(
      current.lineup.pitcherOrder,
      delegatedView.pitcherOrder,
      '任せるのをやめたら、任せていた間の順が引き継がれない',
    );
    // ⚠ 画面へ返す順番には名簿に居る選手だけを載せる（退団した選手の id を残さない）
    const stored = (await store.read()).league;
    const own = stored.game.teams[stored.members[0].teamName];
    own.pitchingRotation.pitcherOrder = [...own.pitchingRotation.pitcherOrder, 999999999];
    assert.equal(
      projectLineup(own).pitcherOrder.includes(999999999),
      false,
      '名簿に居ない選手が画面へ返す順番に残る',
    );
  }

} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(
  '■ 編成画面の移植: OK（救援の同じ役割の中の順番が試合まで届く・作り直しても画面の順と合う・任せた間は指導者の能力の順 / 投影と往復する / 複製を渡す / 編集が届く / 投手と入れ替えても保存できる / 次の先発を打順に入れる / PCの2画面の保存が互いを消さない / スマホの2タップの入れ替えが保存できる形のまま・方針と別々に保存しても消さない / TEAMS_DATA 無しで自動編成）',
);
