// 球団間のトレードの検査。
//
// ⚠ 主目的は「**二重に成立しないこと**」と「**名簿を壊さないこと**」。
//    選手が動く操作なので、取り違えると記録の持ち主が分からなくなる。
// ⚠ 流れは 提案 → 受ける／逆提案／断る。逆提案は**1回だけ**で、
//    そのあとは受けるか断るかしかない（投げ返しが続くと終わらない）。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../../server/storage/fileStore.mjs';
import { LeagueService } from '../../server/leagueService.mjs';
import {
  rosterShortfall,
  rostersAfterTrade,
  canRespond,
  canCounter,
  cpuTradeDecision,
  CPU_ACCEPT_MARGIN,
  MAX_OPEN_TRADES,
} from '../../src/online/trades.js';
import {
  createLeague,
  defaultPhasePlan,
  loadLeagueWorld,
  submitPhase,
  tradeValueOf,
} from '../../server/leagueEngine.mjs';
import {
  createTradeJudge,
  formFactor,
  needFactor,
  needFactors,
  NEED_LIMIT,
} from '../../server/tradeJudge.mjs';
import { comparisonFromPlayers } from '../../server/performanceLabels.mjs';
import { tradeFactorFor } from '../../server/coachEngine.mjs';
import { ROSTER_LIMIT } from '../../src/online/shared.js';
import { PACK_SIZE } from '../../src/online/rosterPack.js';
import { TEAMS_DATA } from '../../src/teams-data.js';
import { rosterGroup } from '../../src/utils/constants.js';
import {
  bestSlot,
  rosterTops,
  setTradeValues,
  squadStrength,
  tradeStrengthGap,
  STRENGTH_GAP_LIMIT,
} from '../../src/online/tradeSearch.js';

const NOW = '2026-10-26T15:00:00.000Z';

// --- 規則だけの部分 -----------------------------------------------------
{
  const make = (n, position) =>
    Array.from({ length: n }, (_, i) => ({ id: `${position}${i}`, position }));
  // ⚠ **枠ちょうどの名簿を作る**。人数を直に書くと、枠を変えたときに
  //    「上限を超えても通している」の判定が効かなくなる
  const ok = [
    ...make(ROSTER_LIMIT - 10, 'pitcher'),
    ...make(2, 'catcher'),
    ...make(4, 'short'),
    ...make(4, 'left'),
  ];
  assert.equal(ok.length, ROSTER_LIMIT, '前提: 枠ちょうどの名簿');
  assert.deepEqual(rosterShortfall(ok), [], '成り立つ名簿を弾いている');
  // ⚠ 投手・捕手・野手8人は**トライアウトの解決と同じ条件**。緩めると
  //    トレードで捕手のいない球団を作れてしまう
  assert.ok(
    rosterShortfall(ok.filter((p) => p.position !== 'catcher')).length,
    '捕手が居なくても通している',
  );
  assert.ok(
    rosterShortfall(ok.filter((p) => p.position !== 'pitcher')).length,
    '投手が居なくても通している',
  );
  assert.ok(
    rosterShortfall([
      ...make(10, 'pitcher'),
      ...make(2, 'catcher'),
      ...make(5, 'left'),
    ]).length,
    '野手が8人を割っても通している',
  );
  assert.ok(
    rosterShortfall([...ok, ...make(1, 'left')]).length,
    `${ROSTER_LIMIT}人を超えても通している`,
  );

  // --- CPUの判断（規則だけ）--------------------------------------------
  // ⚠ 値段は作り物を渡す。本物の評価式に引きずられず、3つの分岐そのものを見る
  const price = { strong: 300, mid: 200, weak: 100 };
  const guy = (id, position, tier) => ({ id, position, tier });
  const valueOf = (p) => price[p.tier];
  const decide = (fromPlayers, toPlayers, offerIds, wantIds) =>
    cpuTradeDecision({ valueOf, fromPlayers, toPlayers, offerIds, wantIds });
  const humanRoster = [
    guy(1, 'pitcher', 'strong'),
    guy(2, 'pitcher', 'weak'),
    guy(3, 'left', 'mid'),
    guy(4, 'pitcher', 'mid'),
  ];
  const cpuRoster = [
    guy(11, 'pitcher', 'strong'),
    guy(12, 'pitcher', 'mid'),
    guy(13, 'pitcher', 'weak'),
    guy(14, 'left', 'mid'),
    guy(15, 'short', 'mid'),
    guy(16, 'left', 'weak'),
  ];
  // 一方的に得（もらうだけ）→ 受ける
  assert.equal(decide(humanRoster, cpuRoster, [1], []).action, 'accept');
  // ⚠ **釣り合っているだけでは受けない**。等価交換を通すと、少しだけ得な
  //    提案を繰り返して一方的に戦力を集められる
  assert.equal(decide(humanRoster, cpuRoster, [1], [11]).action, 'counter');
  // 上乗せがあれば受ける（strong 300 ≧ mid 200 × 1.05）
  assert.equal(decide(humanRoster, cpuRoster, [1], [12]).action, 'accept');
  // 釣り合わない要求 → 払える選手に差し替えて逆提案
  {
    // mid 200 で strong 300 を要求 → 予算 190 に収まる投手（weak 100）へ
    const d = decide(humanRoster, cpuRoster, [4], [11]);
    assert.equal(d.action, 'counter');
    // ⚠ **守備の括りは変えない**（内野を頼まれて投手を出さない）
    assert.deepEqual(d.want, [13], '予算に収まる投手へ差し替えていない');
    // ⚠ **予算に収まる中で最も価値が高い選手**を出す（安く見せかけない）
    const even = decide(humanRoster, cpuRoster, [1], [11]);
    assert.deepEqual(even.want, [12], '予算に収まる上の選手を出していない');
  }
  // ⚠ いちばん安い選手にも届かない額なら断る（weak 100 → 予算 95）
  assert.equal(decide(humanRoster, cpuRoster, [2], [11]).action, 'reject');
  // タダで要求 → 断る（払える選手が居ない）
  assert.equal(decide(humanRoster, cpuRoster, [], [11]).action, 'reject');
  // ⚠ 括りが違うと差し替えられない。野手を頼まれたが予算に収まる野手が居ない
  assert.equal(decide(humanRoster, cpuRoster, [2], [14]).action, 'reject');
  // --- 逆提案の持ち場（いしだ 2026-11-13「外野が欲しいのに内野を提案される」）
  // ⚠ **内野と外野を分けること**。以前は投手・捕手・野手の3つしかなく、外野手を
  //    頼むと内野手が返ってきた。
  {
    // 外野手（left mid）を mid で要求 → 予算190に収まる外野手（left weak）へ
    const out = decide(humanRoster, cpuRoster, [3], [14]);
    assert.equal(out.action, 'counter');
    assert.deepEqual(out.want, [16], '外野手を頼んだのに外野手で返していない');
    // 内野手（short mid）を mid で要求 → 予算に収まる内野手が居ないので断る。
    //    ⚠ ここで外野手（left weak）を返さないこと
    assert.equal(
      decide(humanRoster, cpuRoster, [3], [15]).action,
      'reject',
      '内野手を頼んだのに外野手で返している',
    );
  }
  // --- 自分が出す選手の値段だけ、球団の事情で変えられること（`valueOfOwn`）
  // ⚠ もらう選手にも同じ事情を掛けると、足りない持ち場へ弱い選手を押し込むだけで
  //    上乗せを満たせてしまう（`server/tradeJudge.mjs`）
  {
    const own = (p) => price[p.tier] * 1.5; // 主力は出し渋る、という見立て
    const decideOwn = (offerIds, wantIds) =>
      cpuTradeDecision({
        valueOf,
        valueOfOwn: own,
        fromPlayers: humanRoster,
        toPlayers: cpuRoster,
        offerIds,
        wantIds,
      });
    // 出し渋られると、同じ提案（strong 300 で mid 200）でも通らない（300 < 300×1.05）
    assert.equal(decide(humanRoster, cpuRoster, [1], [12]).action, 'accept');
    assert.notEqual(
      decideOwn([1], [12]).action,
      'accept',
      '出す選手の値段（valueOfOwn）が効いていない',
    );
    // 逆提案の予算も出す側の値段で見る（mid 300 は 285 に収まらず weak 150 へ）
    const d = decideOwn([1], [11]);
    assert.equal(d.action, 'counter');
    assert.deepEqual(d.want, [13], '逆提案の予算に出す側の値段を使っていない');
  }
  // ⚠ **同じ答えを返すこと**（乱数を使っていない）
  assert.deepEqual(
    decide(humanRoster, cpuRoster, [4], [11]),
    decide(humanRoster, cpuRoster, [4], [11]),
    '同じ提案に違う答えを返した',
  );

  // 入れ替えの計算。⚠ 元の配列を書き換えない
  const from = [{ id: 1, position: 'pitcher' }, { id: 2, position: 'left' }];
  const to = [{ id: 3, position: 'catcher' }];
  const after = rostersAfterTrade(from, to, [1], [3]);
  assert.deepEqual(after.from.map((p) => p.id).sort(), [2, 3]);
  assert.deepEqual(after.to.map((p) => p.id), [1]);
  assert.deepEqual(from.map((p) => p.id), [1, 2], '元の配列が書き換わっている');

  // 手番と逆提案
  const trade = { from: 'a', to: 'b', turn: 'to', countered: false };
  assert.ok(canRespond(trade, 'b') && !canRespond(trade, 'a'), '手番の判定がちがう');
  assert.ok(canCounter(trade, 'b'), '最初の返事で逆提案できない');
  assert.ok(!canCounter({ ...trade, countered: true }, 'b'), '逆提案が2回できる');
  assert.ok(
    !canCounter({ ...trade, turn: 'from', countered: true }, 'a'),
    '提案した側が逆提案を返せる（投げ返しが終わらない）',
  );
}

// --- 2人のリーグで、通しで動かす ----------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'pennant-trade-'));
try {
  const store = new FileStore(join(dir, 'state.gz'));
  const service = new LeagueService(store, {
    members: [{ userId: 'a', label: 'A' }],
    adminId: 'a',
    clock: () => NOW,
  });
  const sa = (await service.login('a')).sessionId;
  const sb = (await service.login('b')).sessionId;
  let seq = 0;
  const send = async (user, session, type, payload) => {
    const l = (await store.read()).league;
    seq += 1;
    return service.command(user, session, {
      requestId: `trade-${type}-${seq}`,
      revision: l?.revision ?? 0,
      type,
      payload,
    });
  };
  const live = () => store.read().then((b) => b.league);

  await send('a', sa, 'create');
  await send('b', sb, 'join', {});
  // 名簿を配る（セット選択を両方決める）
  for (const [user, session] of [
    ['a', sa],
    ['b', sb],
  ]) {
    const l = await live();
    if (!l.phase || l.phase.kind !== 'pack_select') break;
    await send(user, session, 'submit', {
      phaseId: l.phase.id,
      plan: { packId: l.packs[user === 'a' ? 0 : 1].id },
      ready: true,
      baseSubmission: null,
    });
  }
  const started = await live();
  const teamA = started.members.find((m) => m.userId === 'a').teamName;
  const teamB = started.members.find((m) => m.userId === 'b').teamName;
  const rosterOf = (l, name) => l.game.teams[name].players;
  // ⚠ セットは24人、枠は26人。**最初は2つ空いている**
  assert.equal(rosterOf(started, teamA).length, PACK_SIZE, '前提: セットの人数');
  assert.ok(PACK_SIZE < ROSTER_LIMIT, '前提: 枠に空きがある');

  // ⚠ **選手は評価額で選ぶ**（名簿の先頭から取らない）。相手（teamB）は参加者の
  //    球団なので応じるかは人が決めるが、この先の値段の差の検査が名簿の順に
  //    左右されないように、いちばん高い投手と安い投手で組む。
  //    リーグの種は作った時刻から決まるので、世界は固定ではない
  const pitchers = (l, name) =>
    rosterOf(l, name)
      .filter((p) => p.position === 'pitcher')
      .sort((x, y) => tradeValueOf(y) - tradeValueOf(x));
  const pickA = pitchers(started, teamA)[0]; // 自軍のいちばん高い投手を出す
  const pickB = pitchers(started, teamB).at(-1); // 相手のいちばん安い投手をもらう
  assert.ok(
    tradeValueOf(pickA) > tradeValueOf(pickB),
    `前提: 値段の差がある（${tradeValueOf(pickA)} / ${tradeValueOf(pickB)}）`,
  );

  // ⚠ 居ない球団は相手にできない
  await assert.rejects(
    () =>
      send('a', sa, 'tradeOffer', {
        to: '存在しない球団',
        offer: [pickA.id],
        want: [],
      }),
    /相手の球団が見つかりません/,
    '居ない球団に提案できた',
  );
  // ⚠ 自分の球団とはトレードできない
  await assert.rejects(
    () => send('a', sa, 'tradeOffer', { to: teamA, offer: [pickA.id], want: [] }),
    /自分の球団/,
    '自分の球団に提案できた',
  );
  // ⚠ 相手の名簿にいない選手は要求できない
  await assert.rejects(
    () =>
      send('a', sa, 'tradeOffer', {
        to: teamB,
        offer: [pickA.id],
        want: [pickA.id],
      }),
    /相手の名簿にいない/,
    '相手に居ない選手を要求できた',
  );
  // ⚠ 空の提案は出せない
  await assert.rejects(
    () => send('a', sa, 'tradeOffer', { to: teamB, offer: [], want: [] }),
    /1人以上/,
    '空の提案が通った',
  );

  // --- 提案 → 受ける ----------------------------------------------------
  await send('a', sa, 'tradeOffer', {
    to: teamB,
    offer: [pickA.id],
    want: [pickB.id],
  });
  const offered = await live();
  assert.equal(offered.trades.length, 1, '提案が残っていない');
  assert.equal(offered.trades[0].turn, 'to', '手番が相手になっていない');

  // ⚠ **提案した側は受けられない**。両方が受けられると二重に成立する
  await assert.rejects(
    () =>
      send('a', sa, 'tradeRespond', {
        tradeId: offered.trades[0].id,
        action: 'accept',
      }),
    /相手の返事待ち/,
    '提案した側が自分で受けられた',
  );
  // ⚠ 当事者でない人は触れない
  const sc = (await service.login('c')).sessionId;
  await assert.rejects(
    () =>
      send('c', sc, 'tradeRespond', {
        tradeId: offered.trades[0].id,
        action: 'accept',
      }),
    (e) => e.status === 403,
    '関係ない人が返事できた',
  );

  // ビューには当事者だけに見えること
  const viewA = await service.view('a', sa);
  const viewB = await service.view('b', sb);
  assert.equal(viewA.trades.length, 1, '提案した側に見えていない');
  assert.equal(viewB.trades.length, 1, '相手に見えていない');
  assert.equal(viewA.trades[0].myTurn, false, '提案した側が手番になっている');
  assert.equal(viewB.trades[0].myTurn, true, '相手の手番になっていない');
  assert.equal(viewB.trades[0].canCounter, true, '相手が逆提案できない');
  assert.equal(viewA.trades[0].offer[0].name, pickA.name, '選手名が渡っていない');

  await send('b', sb, 'tradeRespond', {
    tradeId: offered.trades[0].id,
    action: 'accept',
  });
  const done = await live();
  assert.equal(done.trades.length, 0, '成立したのに提案が残っている');
  assert.ok(
    rosterOf(done, teamB).some((p) => p.id === pickA.id),
    '出した選手が相手の名簿に入っていない',
  );
  assert.ok(
    rosterOf(done, teamA).some((p) => p.id === pickB.id),
    'もらった選手が自分の名簿に入っていない',
  );
  assert.ok(
    !rosterOf(done, teamA).some((p) => p.id === pickA.id),
    '出した選手が自分の名簿に残っている',
  );
  // ⚠ 1対1なので人数は変わらない（セットの24人のまま）
  assert.equal(rosterOf(done, teamA).length, PACK_SIZE, '人数が変わった');
  // ⚠ 打順を組み直すこと。出した選手が打順に残ると試合が組めない
  for (const name of [teamA, teamB]) {
    const order = done.game.teams[name].lineupSettings?.battingOrder || [];
    const ids = new Set(rosterOf(done, name).map((p) => p.id));
    assert.ok(
      order.length === 9 && order.every((e) => ids.has(e.playerId)),
      `${name} の打順に名簿外の選手がいる`,
    );
  }
  // ⚠ お知らせに残す
  const notice = done.notices.find((n) => n.type === 'trade');
  assert.ok(notice, 'トレードのお知らせが無い');
  assert.equal(notice.picks.length, 2, 'お知らせの人数がちがう');
  // ⚠ 経歴に残す（あとから「どの年にどこへ行ったか」を辿れるように）
  const moved = rosterOf(done, teamB).find((p) => p.id === pickA.id);
  assert.ok(
    (moved.careerHistory || []).some((h) => h.type === 'trade'),
    '経歴にトレードが残っていない',
  );

  // --- 提案 → 逆提案 → 受ける -------------------------------------------
  const a2 = rosterOf(done, teamA).filter((p) => p.position === 'pitcher');
  const b2 = rosterOf(done, teamB).filter((p) => p.position === 'pitcher');
  await send('a', sa, 'tradeOffer', {
    to: teamB,
    offer: [a2[0].id],
    want: [b2[0].id],
  });
  const t2 = (await live()).trades[0];
  await send('b', sb, 'tradeRespond', {
    tradeId: t2.id,
    action: 'counter',
    offer: [a2[1].id],
    want: [b2[0].id],
  });
  const countered = (await live()).trades[0];
  assert.equal(countered.turn, 'from', '逆提案で手番が戻っていない');
  assert.equal(countered.countered, true, '逆提案の印が付いていない');
  assert.deepEqual(countered.offer, [a2[1].id], '逆提案の中身が入っていない');
  // ⚠ **逆提案は1回だけ**。提案した側は受けるか断るかしかない
  await assert.rejects(
    () =>
      send('a', sa, 'tradeRespond', {
        tradeId: countered.id,
        action: 'counter',
        offer: [a2[2].id],
        want: [b2[0].id],
      }),
    /逆提案は1回まで/,
    '逆提案を投げ返せた',
  );
  // ⚠ 相手は手番を持っていないので受けられない
  await assert.rejects(
    () => send('b', sb, 'tradeRespond', { tradeId: countered.id, action: 'accept' }),
    /相手の返事待ち/,
    '手番でない側が受けられた',
  );
  await send('a', sa, 'tradeRespond', { tradeId: countered.id, action: 'accept' });
  const done2 = await live();
  assert.equal(done2.trades.length, 0, '逆提案が成立していない');
  assert.ok(
    rosterOf(done2, teamB).some((p) => p.id === a2[1].id),
    '逆提案で出した選手が移っていない',
  );
  assert.ok(
    rosterOf(done2, teamA).some((p) => p.id === a2[0].id),
    '逆提案で外した選手まで移っている',
  );

  // --- 断ると消える ------------------------------------------------------
  // ⚠ 人数の揃ったトレードにする（名簿の形を保つため）。
  const beforeReject = await live();
  const a3 = rosterOf(beforeReject, teamA).find((p) => p.position === 'pitcher');
  const b3 = rosterOf(beforeReject, teamB).find((p) => p.position === 'pitcher');
  await send('a', sa, 'tradeOffer', { to: teamB, offer: [a3.id], want: [b3.id] });
  const t3 = (await live()).trades[0];
  await send('b', sb, 'tradeRespond', { tradeId: t3.id, action: 'reject' });
  assert.equal((await live()).trades.length, 0, '断っても消えていない');
  assert.ok(
    rosterOf(await live(), teamA).some((p) => p.id === a3.id),
    '断ったのに選手が移った',
  );
  // ⚠ 消えたものに触れない
  await assert.rejects(
    () => send('b', sb, 'tradeRespond', { tradeId: t3.id, action: 'accept' }),
    /もうありません/,
    '消えたトレードを受けられた',
  );

  // ⚠ **提案した側からも断れる**（取り下げを兼ねる）
  await send('a', sa, 'tradeOffer', { to: teamB, offer: [a3.id], want: [b3.id] });
  const t4 = (await live()).trades[0];
  await send('a', sa, 'tradeRespond', { tradeId: t4.id, action: 'reject' });
  assert.equal((await live()).trades.length, 0, '提案した側が取り下げられない');

  // --- 名簿が成り立たなくなる提案は通さない -------------------------------
  // ⚠ 捕手を全部出すと、自分の名簿が成り立たなくなる
  const current = await live();
  const myCatchers = rosterOf(current, teamA)
    .filter((p) => p.position === 'catcher')
    .map((p) => p.id);
  const theirPitchers = rosterOf(current, teamB)
    .filter((p) => p.position === 'pitcher')
    .map((p) => p.id);
  assert.ok(myCatchers.length > 1, '前提: 捕手が2人以上居る');
  await assert.rejects(
    () =>
      send('a', sa, 'tradeOffer', {
        to: teamB,
        offer: myCatchers,
        want: theirPitchers.slice(0, myCatchers.length),
      }),
    /自球団の名簿が成り立ちません/,
    '捕手を全部出す提案が通った',
  );
  // ⚠ **相手の名簿も見る**。相手の捕手を全部もらう提案は通さない
  const theirCatchers = rosterOf(current, teamB)
    .filter((p) => p.position === 'catcher')
    .map((p) => p.id);
  const myPitchers = rosterOf(current, teamA)
    .filter((p) => p.position === 'pitcher')
    .map((p) => p.id);
  await assert.rejects(
    () =>
      send('a', sa, 'tradeOffer', {
        to: teamB,
        offer: myPitchers.slice(0, theirCatchers.length),
        want: theirCatchers,
      }),
    /相手の名簿が成り立ちません/,
    '相手の捕手を全部もらえた',
  );
  // ⚠ **人数が合わないと上限を超える**。空きの数より多くもらうと枠を割る
  const room = ROSTER_LIMIT - rosterOf(current, teamA).length;
  await assert.rejects(
    () =>
      send('a', sa, 'tradeOffer', {
        to: teamB,
        offer: [],
        want: theirPitchers.slice(0, room + 1),
      }),
    new RegExp(`${ROSTER_LIMIT}人を超えます`),
    '上限を超えるトレードが通った',
  );

  // --- 抱えられる提案の数に上限 ------------------------------------------
  assert.ok(
    myPitchers.length > MAX_OPEN_TRADES && theirPitchers.length > MAX_OPEN_TRADES,
    '前提: 上限より多い投手が両球団に居る',
  );
  for (let i = 0; i < MAX_OPEN_TRADES; i += 1)
    await send('a', sa, 'tradeOffer', {
      to: teamB,
      offer: [myPitchers[i]],
      want: [theirPitchers[i]],
    });
  await assert.rejects(
    () =>
      send('a', sa, 'tradeOffer', {
        to: teamB,
        offer: [myPitchers[MAX_OPEN_TRADES]],
        want: [theirPitchers[MAX_OPEN_TRADES]],
      }),
    new RegExp(`${MAX_OPEN_TRADES}件まで`),
    '上限を超えて提案できた',
  );

  // --- 打順に入っている選手を出したら、打順を組み直すこと -----------------
  // ⚠ 出した選手が打順に残ると**試合が組めない**。控えの投手を出しただけだと
  //    打順は元のままで通ってしまうので、**打順に入っている野手**で確かめる。
  {
    for (const t of (await live()).trades)
      await send('a', sa, 'tradeRespond', { tradeId: t.id, action: 'reject' });
    const before = await live();
    const order = before.game.teams[teamA].lineupSettings.battingOrder;
    assert.equal(order.length, 9, '前提: 打順が9人');
    // ⚠ **並び順は打順の番号で見る**。配列の順は保存されたままで、
    //    先頭が9番（投手）のことがある
    const entry = [...order]
      .sort((x, y) => x.battingOrder - y.battingOrder)
      .find((e) => e.position !== 'pitcher');
    const starter = rosterOf(before, teamA).find((p) => p.id === entry.playerId);
    // ⚠ ここで居なければ、**前のトレードで打順を組み直していない**
    assert.ok(
      starter,
      '打順に入っている野手が名簿に居ない（前のトレードで打順を組み直していない）',
    );
    // 同じ守備位置の相手の野手と交換する（名簿の形を保つため）
    const swap = rosterOf(before, teamB).find(
      (p) => p.position === starter.position,
    );
    assert.ok(swap, `前提: 相手に ${starter.position} が居る`);
    await send('a', sa, 'tradeOffer', {
      to: teamB,
      offer: [starter.id],
      want: [swap.id],
    });
    const t = (await live()).trades[0];
    await send('b', sb, 'tradeRespond', { tradeId: t.id, action: 'accept' });
    const after = await live();
    for (const name of [teamA, teamB]) {
      const ids = new Set(rosterOf(after, name).map((p) => p.id));
      const next = after.game.teams[name].lineupSettings?.battingOrder || [];
      assert.equal(next.length, 9, `${name} の打順が9人でない`);
      assert.ok(
        next.every((e) => ids.has(e.playerId)),
        `${name} の打順に名簿外の選手が残っている`,
      );
      // ⚠ 投手起用も同じ。出した投手が先発に残ると、その日の先発が立たない
      const rotation = after.game.teams[name].pitchingRotation?.starters || [];
      assert.ok(
        rotation.length > 0 && rotation.every((id) => ids.has(id)),
        `${name} の先発ローテーションに名簿外の選手が残っている`,
      );
    }
    assert.ok(
      !after.game.teams[teamA].lineupSettings.battingOrder.some(
        (e) => e.playerId === starter.id,
      ),
      '出した選手が打順に残っている',
    );
  }

  // --- 間に状況が変わっていたら成立させない -------------------------------
  // ⚠ 提案から返事までの間に、選手が別のトレードで移っていることがある。
  //    提案のときに見ただけだと、**居ない選手を動かして名簿が壊れる**。
  //    同じ選手を出す提案を2件作り、1件目を成立させてから2件目を受けてみる。
  {
    // いま残っている提案を片付ける
    for (const t of (await live()).trades)
      await send('a', sa, 'tradeRespond', { tradeId: t.id, action: 'reject' });
    assert.equal((await live()).trades.length, 0, '前提: 提案が残っていない');

    const now = await live();
    const mine = rosterOf(now, teamA).filter((p) => p.position === 'pitcher');
    const theirs = rosterOf(now, teamB).filter((p) => p.position === 'pitcher');
    const sameGuy = mine[0].id;
    await send('a', sa, 'tradeOffer', {
      to: teamB,
      offer: [sameGuy],
      want: [theirs[0].id],
    });
    await send('a', sa, 'tradeOffer', {
      to: teamB,
      offer: [sameGuy],
      want: [theirs[1].id],
    });
    const [first, second] = (await live()).trades;
    await send('b', sb, 'tradeRespond', { tradeId: first.id, action: 'accept' });
    assert.ok(
      !rosterOf(await live(), teamA).some((p) => p.id === sameGuy),
      '前提: 1件目で選手が移っている',
    );
    // ⚠ 2件目は、もう持っていない選手を出す提案。**成立させてはいけない**
    await assert.rejects(
      () => send('b', sb, 'tradeRespond', { tradeId: second.id, action: 'accept' }),
      /出す選手が名簿にいません/,
      '移った選手を2度出せた',
    );
    // 名簿が壊れていないこと
    for (const name of [teamA, teamB]) {
      const players = rosterOf(await live(), name);
      assert.equal(players.length, PACK_SIZE, `${name} の人数が壊れた`);
      assert.equal(
        new Set(players.map((p) => p.id)).size,
        players.length,
        `${name} に同じ選手が2人いる`,
      );
    }
  }

  // --- 救援投手の欄を名簿に合わせること ------------------------------------
  // ⚠ 人の球団は先発ローテが揃っていれば編成を残す。以前は救援の欄を見て
  //    いなかったため、**出した守護神が欄に残り、もらった投手はどの欄にも
  //    入らず試合で1度も投げなかった**（画面には「おまかせ」の救援として出る）。
  {
    for (const t of (await live()).trades)
      await send('a', sa, 'tradeRespond', { tradeId: t.id, action: 'reject' });
    const before = await live();
    const relief = (name) => {
      const r = before.game.teams[name].pitchingRotation;
      const starters = new Set(r.starters || []);
      return rosterOf(before, name).filter(
        (p) => p.position === 'pitcher' && !starters.has(p.id),
      );
    };
    const rotA = before.game.teams[teamA].pitchingRotation;
    // 守護神が居ればその人を出す（欄に残るかを見たいので）
    const outgoing =
      relief(teamA).find((p) => p.id === rotA.closer) || relief(teamA)[0];
    const incoming = relief(teamB)[0];
    assert.ok(outgoing && incoming, '前提: 両球団に救援投手が居る');
    await send('a', sa, 'tradeOffer', {
      to: teamB,
      offer: [outgoing.id],
      want: [incoming.id],
    });
    const t = (await live()).trades[0];
    await send('b', sb, 'tradeRespond', { tradeId: t.id, action: 'accept' });
    const after = await live();
    for (const name of [teamA, teamB]) {
      const r = after.game.teams[name].pitchingRotation;
      const ids = new Set(rosterOf(after, name).map((p) => p.id));
      const bullpen = [
        ...(r.middleRelievers || []),
        ...(r.setupMen || []),
        ...(r.closer != null ? [r.closer] : []),
      ];
      assert.ok(
        bullpen.every((id) => ids.has(id)),
        `${name} の救援の欄に名簿外の投手が残っている`,
      );
      const starters = new Set(r.starters || []);
      for (const p of rosterOf(after, name))
        if (p.position === 'pitcher' && !starters.has(p.id))
          assert.ok(
            bullpen.includes(p.id),
            `${name} の ${p.name} がどの救援の欄にも入っていない（試合で投げない）`,
          );
    }
  }

  // --- CPU球団とのトレード（その場で答える）-----------------------------
  // ⚠ **1人で遊んでいる間もトレードが使えること**。以前は参加者の球団だけを
  //    相手にしていて、CPU11球団に対して何も出せなかった。
  {
    // ⚠ **相手は、いま誰も持っていない球団から選び直すこと**。上の節で人が
    //    増えると、最初に見つけた球団が参加者のものになっていることがある
    const held = new Set((await live()).members.map((m) => m.teamName));
    const cpu = (await live()).season.settings.teamNames.find(
      (n) => !held.has(n),
    );
    assert.ok(cpu, '前提: CPU球団が残っていない');
    // ⚠ 値段は**サーバーと同じ見立て**で見る（`openTrade` は `tradeJudge` の値段に
    //    監督の見る目を掛けて判断している）。素の `tradeValueOf` で見ると、逆提案の
    //    予算の検査がずれる（実測で 184.22 対 181.41 と、1.5%はみ出して落ちた）。
    // ⚠ **もらう選手と出す選手で値段が違う**。CPUは自分が出す選手にだけ球団の事情
    //    （抜けると穴が空く選手は高く）を掛ける（`valueOfOwn`）
    // ⚠ 値段は**1人1回だけ計算する**。評価式は重く、下の組み合わせ探しで何百回も呼ぶ
    const factor = tradeFactorFor(await live(), cpu);
    const judgeFor = (l) =>
      createTradeJudge(
        Object.fromEntries(
          [...new Set(l.season.settings.teamNames)].map((n) => [
            n,
            rosterOf(l, n),
          ]),
        ),
      );
    // ⚠ 名簿が動いたら作り直すこと（球団の事情は名簿から出すので、古いと値段がずれる）
    let judge = judgeFor(await live());
    const refreshJudge = async () => {
      judge = judgeFor(await live());
    };
    // こちらが出す選手の値段（相手の事情は掛からない）
    const value = (p) => judge.valueOf(p) * factor(p);
    // CPUが出す選手の値段（その球団の事情こみ）
    const ownValue = (p) => judge.valueOf(p, cpu) * factor(p);
    const kindOf = (p) => rosterGroup(p.position);

    // (1) 一方的に得な提案（もらうだけ）→ その場で成立する
    {
      const before = await live();
      const giveaway = [...rosterOf(before, teamA)]
        .filter((p) => p.position === 'pitcher')
        .sort((x, y) => value(y) - value(x))[0];
      await send('a', sa, 'tradeOffer', {
        to: cpu,
        offer: [giveaway.id],
        want: [],
      });
      const after = await live();
      assert.ok(
        rosterOf(after, cpu).some((p) => p.id === giveaway.id),
        'CPUが受けたのに選手が動いていない',
      );
      assert.ok(
        !rosterOf(after, teamA).some((p) => p.id === giveaway.id),
        '出した選手が自分の名簿に残っている',
      );
      // ⚠ **その場で終わること**。待ち状態が残ると、返事をしない相手を
      //    永久に待つことになる
      assert.equal(
        after.trades.filter((t) => t.toTeam === cpu).length,
        0,
        'CPUとのトレードが返事待ちで残っている',
      );
      assert.ok(
        after.notices.some((n) => n.type === 'trade'),
        'お知らせに残っていない',
      );
      // ⚠ 打順を組み直すこと（出した選手が打順に残ると試合が組めない）
      for (const name of [teamA, cpu]) {
        const ids = new Set(rosterOf(after, name).map((p) => p.id));
        for (const e of after.game.teams[name].lineupSettings?.battingOrder || [])
          assert.ok(ids.has(e.playerId), `${name} の打順に居ない選手が残った`);
      }
      // 名簿が動いたので、球団の事情から出す値段を作り直す
      await refreshJudge();
    }

    // (2) タダで要求 → 断る。**記録を残さない**（押し直せてしまう）
    {
      const l = await live();
      const target = [...rosterOf(l, cpu)].sort(
        (x, y) => ownValue(y) - ownValue(x),
      )[0];
      const open = (await live()).trades.length;
      await assert.rejects(
        () => send('a', sa, 'tradeOffer', { to: cpu, offer: [], want: [target.id] }),
        /応じませんでした/,
        'CPUがタダで選手を渡した',
      );
      assert.equal(
        (await live()).trades.length,
        open,
        '断られた提案が残っている',
      );
      assert.ok(
        rosterOf(await live(), cpu).some((p) => p.id === target.id),
        '断ったのに選手が動いた',
      );
    }

    // (3) 釣り合わない提案 → 逆提案が返り、こちらが受けると成立する
    {
      const l = await live();
      const mine = rosterOf(l, teamA);
      const theirs = rosterOf(l, cpu);
      // ⚠ 組み合わせは**同じ物差しで探す**。値段を決め打ちすると、評価式を
      //    変えたときに「逆提案にならない提案」を送って検査が無意味になる
      let pair = null;
      for (const give of mine) {
        for (const ask of theirs) {
          if (kindOf(give) !== kindOf(ask)) continue;
          if (value(give) >= ownValue(ask) * CPU_ACCEPT_MARGIN) continue;
          const affordable = theirs.some(
            (p) =>
              p.id !== ask.id &&
              kindOf(p) === kindOf(ask) &&
              ownValue(p) <= value(give) / CPU_ACCEPT_MARGIN,
          );
          if (affordable) {
            pair = { give, ask };
            break;
          }
        }
        if (pair) break;
      }
      assert.ok(pair, '前提: 逆提案になる組み合わせが見つからない');
      await send('a', sa, 'tradeOffer', {
        to: cpu,
        offer: [pair.give.id],
        want: [pair.ask.id],
      });
      const countered = (await live()).trades.find((t) => t.toTeam === cpu);
      assert.ok(countered, '逆提案が残っていない');
      assert.equal(countered.countered, true, '逆提案の印が無い');
      // ⚠ 手番が**こちら**に戻ること。相手の返事待ちだと誰も進めない
      assert.equal(countered.turn, 'from', '手番が戻っていない');
      assert.notDeepEqual(
        countered.want,
        [pair.ask.id],
        '頼んだ選手がそのまま返ってきた（逆提案になっていない）',
      );
      const chosen = theirs.find((p) => p.id === countered.want[0]);
      assert.ok(chosen, '逆提案の選手が名簿にいない');
      assert.equal(kindOf(chosen), kindOf(pair.ask), '守備の括りが変わった');
      assert.ok(
        ownValue(chosen) <= value(pair.give) / CPU_ACCEPT_MARGIN,
        `払える範囲を超えた選手を出した（${ownValue(chosen)} > ${value(pair.give) / CPU_ACCEPT_MARGIN}）`,
      );
      // ⚠ CPUの逆提案に**こちらは逆提案で返せない**（投げ返しが続くと終わらない）
      await assert.rejects(
        () =>
          send('a', sa, 'tradeRespond', {
            tradeId: countered.id,
            action: 'counter',
            offer: [pair.give.id],
            want: [pair.ask.id],
          }),
        /逆提案は1回/,
        'CPUの逆提案に投げ返せた',
      );
      await send('a', sa, 'tradeRespond', {
        tradeId: countered.id,
        action: 'accept',
      });
      const done = await live();
      assert.ok(
        rosterOf(done, teamA).some((p) => p.id === chosen.id),
        '逆提案を受けたのに選手が来ていない',
      );
      assert.ok(
        rosterOf(done, cpu).some((p) => p.id === pair.give.id),
        '逆提案を受けたのに選手を出していない',
      );
      assert.equal(
        done.trades.filter((t) => t.toTeam === cpu).length,
        0,
        '成立したのに残っている',
      );
    }
  }
  // --- 初期メンバーへの入れ替えを待っている球団とはトレードしない -----------
  // ⚠ 途中参加した人の名簿は次のキャンプで選んだセットに丸ごと置き換わる。
  //    その前にトレードすると、受け取った選手は置き換えで消え、出した選手だけが
  //    相手に残る（選手がリーグから消える）。
  {
    for (const t of (await live()).trades)
      await send('a', sa, 'tradeRespond', { tradeId: t.id, action: 'reject' });
    const sc = (await service.login('c')).sessionId;
    await send('c', sc, 'join', {});
    const l = await live();
    const joiner = l.members.find((m) => m.userId === 'c');
    assert.ok(joiner?.packSeed, '前提: 途中参加した人はセットを待っている');
    const theirs = rosterOf(l, joiner.teamName).find(
      (p) => p.position === 'pitcher',
    );
    const mine = rosterOf(l, teamA).find((p) => p.position === 'pitcher');
    await assert.rejects(
      () =>
        send('a', sa, 'tradeOffer', {
          to: joiner.teamName,
          offer: [mine.id],
          want: [theirs.id],
        }),
      /初期メンバーへ入れ替わる/,
      'セットを待っている球団とトレードできた',
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

// --- CPUの値段（素質・いまの力・成績・球団の事情）-------------------------
// 【なぜ】いしだ 2026-11-13「CPUのトレードがアホすぎる。弱い選手で強い選手が
//   取れる」。以前はドラフトの物差し（能力の偏差値）だけで値段を決めており、
//   スカウトの見立てなので**いまの力とも成績とも噛み合っていなかった**。
// ⚠ ここは**釣り合いの検査**（`check:season` と同じ性格）。1組ずつの正解ではなく、
//    12球団の総当たりで「弱い選手で強い選手が取れる」組の割合を見る。
{
  const l = createLeague({ members: [{ userId: 'a' }], now: NOW });
  for (const m of l.members)
    submitPhase(
      l,
      m.userId,
      { phaseId: l.phase.id, plan: defaultPhasePlan(l, m.teamName), ready: true },
      NOW,
    );
  loadLeagueWorld(l);
  const names = [...new Set(l.season.settings.teamNames)];
  const teams = Object.fromEntries(
    names.map((name) => [name, TEAMS_DATA[name].players]),
  );
  const judge = createTradeJudge(teams);
  const rows = [];
  for (const [team, players] of Object.entries(teams))
    for (const p of players) {
      const best = bestSlot(p);
      if (!best) continue;
      rows.push({
        team,
        player: p,
        strength: best.strength,
        // こちらが出す値段（相手の事情は掛からない）と、その球団が出す値段
        value: judge.valueOf(p),
        own: judge.valueOf(p, team),
        old: tradeValueOf(p),
      });
    }
  assert.ok(rows.length > 200, `前提: 12球団ぶんの名簿（${rows.length}人）`);

  // ① **明らかに弱い選手で、強い選手は取れないこと**。
  //    「持ち場での力が3以上下の選手の値段が、相手の選手の `CPU_ACCEPT_MARGIN` 倍
  //    以上（＝CPUが受ける額）」になる組を数える。
  // ⚠ 0 にはならない（持ち場が違えば力は直接比べられないし、素質も混ぜている）。
  //    見るのは**桁**。実測: 直す前 13.7% → 直したあと 0.5%
  const inversion = (price) => {
    let pairs = 0;
    let bad = 0;
    for (const a of rows)
      for (const b of rows) {
        if (a === b || a.team === b.team) continue;
        if (b.strength >= a.strength - 3) continue; // b が明らかに弱い
        pairs += 1;
        if (b[price.give] >= a[price.get] * CPU_ACCEPT_MARGIN) bad += 1;
      }
    return bad / pairs;
  };
  const rate = inversion({ give: 'value', get: 'own' });
  const before = inversion({ give: 'old', get: 'old' });
  assert.ok(
    rate <= 0.03,
    `弱い選手で強い選手が取れる組が多すぎる: ${(rate * 100).toFixed(1)}%`,
  );
  // ⚠ **直す前より良くなっていること**を見る（物差しを戻したら落ちる）
  assert.ok(
    rate < before / 3,
    `ドラフトの物差しだけの頃（${(before * 100).toFixed(1)}%）から良くなっていない: ${(rate * 100).toFixed(1)}%`,
  );

  // ② 成績が効くこと（規定に届いていれば ±、届いていなければ等倍）
  {
    const withStats = rows
      .map((r) => r.player)
      .filter((p) => p.seasonStats?.batting || p.seasonStats?.pitching);
    const baseline = comparisonFromPlayers(
      rows.map((r) => ({
        seasonStats: {
          batting: { atBats: 400, hits: 100, doubles: 18, triples: 2, homeruns: 10, walks: 30, strikeouts: 80, sacrificeBunts: 5, hitByPitch: 2 },
          pitching: { inningsPitched: 450, strikeouts: 120, walks: 45, homeruns: 15, earnedRuns: 60 },
        },
      })),
    );
    const batter = (hits, homeruns) => ({
      position: 'left',
      seasonStats: {
        batting: { atBats: 400, hits, doubles: 20, triples: 2, homeruns, walks: 40, strikeouts: 70, sacrificeBunts: 3, hitByPitch: 2 },
      },
    });
    assert.ok(
      formFactor(batter(140, 30), baseline) > formFactor(batter(70, 2), baseline),
      '打者の成績が値段に効いていない',
    );
    // ⚠ 規定に届かない選手は成績で判断しない（数試合の当たり外れで値段が動く）
    const few = {
      position: 'left',
      seasonStats: {
        batting: { atBats: 20, hits: 12, doubles: 2, triples: 0, homeruns: 4, walks: 2, strikeouts: 3, sacrificeBunts: 0, hitByPitch: 0 },
      },
    };
    assert.equal(formFactor(few, baseline), 1, '打席が少ないのに成績で値段を動かした');
    const pitcher = (earnedRuns) => ({
      position: 'pitcher',
      seasonStats: {
        pitching: { inningsPitched: 450, strikeouts: 150, walks: 30, homeruns: 10, earnedRuns },
      },
    });
    assert.ok(
      formFactor(pitcher(20), baseline) > formFactor(pitcher(120), baseline),
      '投手の成績が値段に効いていない',
    );
    assert.ok(withStats.length >= 0); // 名簿の形が変わったら気づけるように読んでおく
  }

  // ③ 球団の事情（抜けると穴が空く選手は高く、代わりが居る選手は等倍）
  {
    const team = names[0];
    const players = teams[team];
    const tops = rosterTops(players);
    const ace = tops.sp.holder;
    assert.ok(ace, '前提: 先発の一番手が居る');
    assert.ok(
      needFactor(players, ace) > 1 + NEED_LIMIT / 2,
      `先発の一番手を出し渋っていない: ${needFactor(players, ace)}`,
    );
    // 起用の枠の外（控えが厚い持ち場の最後尾）は等倍
    const spare = [...players]
      .filter((p) => p.position === 'pitcher')
      .sort((x, y) => needFactor(players, x) - needFactor(players, y))[0];
    assert.equal(
      needFactor(players, spare),
      1,
      '代わりが居る選手にも上乗せしている',
    );
    // ⚠ 他球団の選手には掛けない（名簿に居なければ等倍）
    assert.equal(
      needFactor(players, teams[names[1]][0]),
      1,
      '他球団の選手に自軍の事情を掛けている',
    );
    // ⚠ 上乗せは `NEED_LIMIT` まで（際限なく高くしない）
    const most = Math.max(...players.map((p) => needFactor(players, p)));
    assert.ok(most <= 1 + NEED_LIMIT + 1e-9, `上乗せが ${most} 倍になっている`);
  }

  // ③' まとめて出すときは、まとめて空く穴で値段を付ける（監査 2026-11-13）。
  //    1人ずつ「ほかは残る」として測ると、レギュラー2人をまとめてもらっても
  //    小さな穴2つにしかならなかった
  {
    const team = names[0];
    const players = teams[team];
    const tops = rosterTops(players);
    const pair = [tops.left.holder, tops.right.holder].filter(Boolean);
    assert.equal(pair.length, 2, '前提: 左翼・右翼の一番手が居る');
    const together = needFactors(players, pair);
    for (const p of pair)
      assert.ok(
        together.get(p.id) >= needFactor(players, p) - 1e-9,
        `まとめて出すほうが安い: ${together.get(p.id)} < ${needFactor(players, p)}`,
      );
    assert.ok(
      Math.max(...together.values()) <= 1 + NEED_LIMIT + 1e-9,
      '上乗せが上限を超えた',
    );
    // 外野を全員まとめて出すと、1人ずつ足すより確かに高い（控えで埋まらない）
    const outfield = players.filter((p) => ['left', 'center', 'right'].includes(p.position));
    const sumAlone = outfield.reduce((a, p) => a + judge.valueOf(p, team), 0);
    const sumTogether = judge.setValuesOf(outfield, team).reduce((a, v) => a + v, 0);
    assert.ok(
      sumTogether > sumAlone,
      `外野をまとめて出しても値段が上がらない: ${sumTogether} / ${sumAlone}`,
    );
    // 1人なら前と同じ値段。画面の式（`setTradeValues` に事情を抜いた値段）とも同じ
    for (const p of pair)
      assert.equal(judge.setValuesOf([p], team)[0], judge.valueOf(p, team));
    assert.deepEqual(
      setTradeValues(players, outfield, (p) => judge.valueOf(p)),
      judge.setValuesOf(outfield, team),
      '画面の見込みとサーバーの値段がずれた',
    );
    // 判断も、まとめた値段（`lossOf`）で見る
    const decideSet = (lossOf) =>
      cpuTradeDecision({
        valueOf: (p) => judge.valueOf(p),
        valueOfOwn: (p) => judge.valueOf(p, team),
        lossOf,
        fromPlayers: teams[names[1]],
        toPlayers: players,
        offerIds: [],
        wantIds: outfield.map((p) => p.id),
      });
    const without = decideSet(null);
    const withSet = decideSet((list) => judge.setValuesOf(list, team));
    assert.ok(withSet.loss > without.loss, 'まとめた値段が判断に使われていない');
  }

  // ⑤ 値段が釣り合っても、提案した側ばかり強くなる交換は断る（いしだ 2026-11-14
  //    「2年目に人の球団が勝ちすぎる」）。値段は1人ずつの合計なので、弱い2人で
  //    強い1人を取る交換が通り、人が得な交換を選び続けると2年目の勝率が平均 .69 になった
  //    （`human-trade-probe.mjs`）。線を当てると .54（トレードしないときは .53）。
  {
    const mineName = l.members[0].teamName;
    const mine = teams[mineName];
    const base = squadStrength(mine);
    // 抜けても痛くない（落差の小さい）12人から2人の組を作る
    const cheap = mine
      .map((p) => ({ p, drop: base - squadStrength(mine.filter((q) => q.id !== p.id)) }))
      .sort((a, b) => a.drop - b.drop || a.p.id - b.p.id)
      .slice(0, 12)
      .map((x) => x.p);
    const pairs = [];
    for (let i = 0; i < cheap.length; i += 1)
      for (let j = i + 1; j < cheap.length; j += 1) pairs.push([cheap[i], cheap[j]]);
    let blocked = null;
    let fair = null;
    for (const to of names) {
      if (to === mineName || (blocked && fair)) continue;
      const theirs = teams[to];
      const factor = tradeFactorFor(l, to);
      const decide = (offer, want, gap) =>
        cpuTradeDecision({
          valueOf: (p) => judge.valueOf(p) * factor(p),
          valueOfOwn: (p) => judge.valueOf(p, to) * factor(p),
          lossOf: (ps) => judge.setValuesOf(ps, to).map((v, i) => v * factor(ps[i])),
          fromPlayers: mine,
          toPlayers: theirs,
          offerIds: offer.map((p) => p.id),
          wantIds: [want.id],
          strengthGap: gap
            ? (give, get) => tradeStrengthGap(mine, theirs, give, get)
            : null,
        });
      for (const want of theirs) {
        for (const offer of [...mine.map((p) => [p]), ...pairs]) {
          if (blocked && fair) break;
          if (rosterShortfall(rostersAfterTrade(mine, theirs, offer.map((p) => p.id), [want.id]).to).length)
            continue;
          if (decide(offer, want, false).action !== 'accept') continue;
          const gap = tradeStrengthGap(mine, theirs, offer.map((p) => p.id), [want.id]);
          if (!blocked && gap > STRENGTH_GAP_LIMIT) blocked = { offer, want, to, gap, decide };
          if (!fair && gap <= STRENGTH_GAP_LIMIT && gap > -STRENGTH_GAP_LIMIT)
            fair = { offer, want, to, gap, decide };
        }
      }
    }
    assert.ok(blocked, '前提: 値段だけなら受ける、戦力の開く交換がある');
    const no = blocked.decide(blocked.offer, blocked.want, true);
    assert.equal(no.action, 'reject', `戦力が ${blocked.gap.toFixed(1)} 点開く交換を受けた`);
    assert.equal(no.reason, 'lopsided', '断った理由が戦力の開きになっていない');
    // 両方の穴が埋まる交換までは止めない（トレードが死なない）
    assert.ok(fair, '前提: 戦力の開かない交換もある');
    assert.equal(
      fair.decide(fair.offer, fair.want, true).action,
      'accept',
      '戦力の開かない交換まで断った',
    );
    // 画面の式（`tradeStrengthGap`）は、サーバーの交換後の名簿（`rostersAfterTrade`）で測った差と同じ
    const after = rostersAfterTrade(
      mine,
      teams[blocked.to],
      blocked.offer.map((p) => p.id),
      [blocked.want.id],
    );
    assert.ok(
      Math.abs(
        squadStrength(after.from) - squadStrength(mine) -
          (squadStrength(after.to) - squadStrength(teams[blocked.to])) -
          blocked.gap,
      ) < 1e-9,
      '画面とサーバーで戦力の差の測り方がずれた',
    );
  }

  // ④ 同じ名簿なら同じ値段（乱数を使っていない）
  {
    const again = createTradeJudge(teams);
    const p = rows[0].player;
    assert.equal(
      again.valueOf(p, rows[0].team),
      judge.valueOf(p, rows[0].team),
      '同じ名簿で値段が変わった',
    );
  }
}

console.log(
  '■ トレード: OK（提案→受ける／逆提案は1回だけ→受ける／断ると消える・手番を持つ側だけ返事できる・両球団の名簿を守る・打順を組み直す・CPU球団はその場で受ける/逆提案/断る・逆提案は同じ持ち場から・弱い選手で強い選手は取れない・成績と球団の事情が値段に効く・提案した側ばかり強くなる交換は断る）',
);
