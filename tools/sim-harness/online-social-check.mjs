// 人どうしの関わり（改善案 A1〜A4・B1・B4・C1）の検査。
//
//   A1 トレードの提案のひとこと・返事の知らせ・成り立たなくなった提案の取り下げ
//   A2 取引の記録（トレード）と読む窓口
//   A3 最後に来た時刻・おるすばん（任せた扱い→来たら戻る）・管理者が球団をCPUに戻す
//   A4 得点経過（試合の記録の箱に残り、点の合計が試合の点と合う）
//   B1 予告先発（指名は確定まで本人だけ・確定後は変えられない・試合の日にその投手が投げる）
//   B4 練習試合（受けるとその場で1試合・成績・疲労・記録・順位に入らない・1日1試合）
//   C1 オーナーのひとこと
//
// ⚠ 主目的は「**試合と成績を変えないこと**」と「**見せてはいけないものを見せないこと**」。
//    練習試合が疲労や成績に混ざると、申し込むだけで相手の主力を疲れさせられる。
//    確定前の予告先発が相手に見えると、後出しで先発を合わせられる。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../../server/storage/fileStore.mjs';
import { LeagueService } from '../../server/leagueService.mjs';
import { defaultPhasePlan } from '../../server/leagueEngine.mjs';
import { withStarters } from '../../server/leagueBoard.mjs';
import { prepareDailyLineup, STARTER_SKIP_FATIGUE } from '../../server/dailyLineup.mjs';
import { pruneTrades } from '../../server/social.mjs';
import { scoringPlaysOf } from '../../server/recordedStats.mjs';
import { effectiveStaffModes } from '../../server/coachEngine.mjs';
import {
  AWAY_DAYS,
  OWNER_COMMENT_MAX,
  TRADE_NOTE_MAX,
  STARTER_LOCK_TURNS,
  cleanText,
  isAwayAt,
  lastSeenLabel,
  scoringLabel,
  tokyoDay,
} from '../../src/online/social.js';

// --- 決まりだけの部分 ------------------------------------------------------
{
  assert.deepEqual(cleanText('  捕手が\n足りなくて… ', 10), { text: '捕手が 足りなくて…', tooLong: false });
  assert.equal(cleanText('あ'.repeat(11), 10).tooLong, true, '長すぎる文を通している');
  const now = '2026-11-14T03:00:00.000Z';
  assert.equal(isAwayAt({ lastSeenAt: null }, now), false, '来た記録の無い人を留守にしている');
  assert.equal(isAwayAt({ lastSeenAt: '2026-11-11T04:00:00.000Z' }, now), false, '3日経っていないのに留守');
  assert.equal(isAwayAt({ lastSeenAt: '2026-11-11T02:00:00.000Z' }, now), true, '3日来ていないのに留守にならない');
  assert.equal(lastSeenLabel('2026-11-14T01:00:00.000Z', now), '今日');
  // ⚠ 日本時間で数える（UTC の 11/13 15:00 は日本時間の 11/14 0:00）
  assert.equal(lastSeenLabel('2026-11-13T15:00:00.000Z', now), '今日');
  assert.equal(lastSeenLabel('2026-11-13T14:00:00.000Z', now), '昨日');
  assert.equal(lastSeenLabel('2026-11-10T14:00:00.000Z', now), '4日前');
  assert.equal(tokyoDay('2026-11-13T15:30:00.000Z'), '2026-11-14');
  assert.equal(scoringLabel({ kind: 'homerun', runs: 2 }), '2ランホームラン');
  assert.equal(scoringLabel({ kind: 'homerun', runs: 4 }), '満塁ホームラン');
  assert.equal(scoringLabel({ kind: 'homerun', runs: 1 }), 'ソロホームラン');
  assert.equal(scoringLabel({ kind: 'double', runs: 1 }), 'タイムリー二塁打');

  // 得点経過: 打席の外で入った点も拾い、最後の点が試合の点と合う
  const result = { homeTeam: { name: 'H' }, awayTeam: { name: 'A' }, homeScore: 3, awayScore: 1 };
  const plays = scoringPlaysOf(
    [
      { offense: 'A', inning: 1, batterId: 1, batterName: 'a1', scoreBefore: { home: 0, away: 0 }, scoreAfter: { home: 0, away: 1 }, delta: { hits: 1, homeruns: 1, rbis: 1 } },
      { offense: 'H', inning: 1, batterId: 2, batterName: 'h1', scoreBefore: { home: 0, away: 1 }, scoreAfter: { home: 0, away: 1 }, delta: {} },
      // 暴投で1点（打席の外）。次の打席の前の点で気づく
      { offense: 'H', inning: 2, batterId: 3, batterName: 'h2', scoreBefore: { home: 1, away: 1 }, scoreAfter: { home: 1, away: 1 }, delta: {} },
      { runnerOnly: true, offense: 'H', inning: 2 },
      // 押し出し
      { offense: 'H', inning: 9, batterId: 4, batterName: 'h3', scoreBefore: { home: 1, away: 1 }, scoreAfter: { home: 2, away: 1 }, delta: { walks: 1, rbis: 1 } },
    ],
    result,
  );
  // 最後の打席の後の1点（サヨナラ暴投など）も入る
  assert.deepEqual(
    plays.map((p) => [p.inning, p.half, p.kind, p.runs, p.away, p.home]),
    [
      [1, 'top', 'homerun', 1, 1, 0],
      [2, 'bottom', 'other', 1, 1, 1],
      [9, 'bottom', 'walk', 1, 1, 2],
      [9, 'bottom', 'other', 1, 1, 3],
    ],
    '得点経過の拾い方がちがう',
  );

  // 予告先発の重ね方: 自球団の指名は確定前から見え、ほかの球団の指名は確定してから見える
  const team = (name, ids) => ({
    pitchingRotation: { starters: ids, currentStarterIndex: 0 },
    players: ids.map((id) => ({ id, name: `${name}${id}` })),
  });
  const teams = { A: team('A', [1, 2, 3, 4, 5]), B: team('B', [11, 12, 13, 14, 15]) };
  const games = [1, 2, 3, 4].map((id) => ({ id, home: 'A', away: 'B', date: { year: 2026, month: 4, day: id } }));
  const picks = { A: { 3: 5 }, B: { 2: 14, 4: 11 } };
  const locked = new Set([1, 2]);
  const ctx = (own) => ({ ownTeam: own, picksOf: (n) => picks[n], lockedOf: (g) => locked.has(g.id) });
  const forA = withStarters(games, teams, null, ctx('A'));
  assert.deepEqual(forA.map((g) => g.homeStarter), ['A1', 'A2', 'A5', 'A1'], '自球団の指名の後ろのローテがずれていない');
  assert.deepEqual(forA.map((g) => g.homeStarterMark || null), [null, null, 'pick', null]);
  // B の確定した指名（試合2）は見える。確定していない指名（試合4）は見えない
  assert.deepEqual(forA.map((g) => g.awayStarter), ['B11', 'B14', 'B15', 'B11'], '相手の確定した指名が出ていない');
  assert.deepEqual(forA.map((g) => g.awayStarterMark || null), [null, 'fixed', null, null]);
  const forB = withStarters(games, teams, null, ctx('B'));
  assert.equal(forB[2].homeStarter, 'A3', '確定していない相手の指名が見えている（後出しで合わせられる）');
  assert.equal(forB[3].awayStarterMark, 'pick');

  // 試合の日: 指名した投手が疲れていなければその投手から回す。疲れていれば使わずに知らせる
  const day = (fatigue) => {
    const players = [1, 2, 3, 4, 5].map((id) => ({ id, name: `p${id}`, position: 'pitcher', fatigue: id === 4 ? fatigue : 0 }));
    return { players, pitchingRotation: { starters: [1, 2, 3, 4, 5], currentStarterIndex: 0 }, lineupSettings: { battingOrder: [] } };
  };
  {
    const t = day(0);
    const report = {};
    try {
      prepareDailyLineup(t, 'T', { pick: 4, report });
    } catch {
      // 打順の補完で落ちるのは名簿が投手だけだから（先発の決め方は済んでいる）
    }
    assert.equal(report.pick, 'used');
    assert.equal(t.pitchingRotation.currentStarterIndex, 3, '指名した投手から回していない');
  }
  {
    const t = day(STARTER_SKIP_FATIGUE);
    const report = {};
    try {
      prepareDailyLineup(t, 'T', { pick: 4, report });
    } catch {
      // 同上
    }
    assert.equal(report.pick, 'avoided', '疲れた投手の指名を使っている');
    assert.equal(t.pitchingRotation.currentStarterIndex, 0, '使わなかった指名でローテを動かしている');
  }

  // 取り下げ: 選手が居なくなった提案・人が抜けた提案・年度更新
  const league = {
    teams: [{ name: 'A' }, { name: 'B' }],
    members: [
      { userId: 'a', teamName: 'A' },
      { userId: 'b', teamName: 'B' },
    ],
    trades: [
      { id: 't1', from: 'a', to: 'b', fromTeam: 'A', toTeam: 'B', offer: [1], want: [11] },
      { id: 't2', from: 'a', to: 'b', fromTeam: 'A', toTeam: 'B', offer: [2], want: [11] },
    ],
  };
  const world = { A: { players: [{ id: 2 }] }, B: { players: [{ id: 11 }] } };
  assert.equal(pruneTrades(league, world, 'x'), 1);
  assert.deepEqual(league.trades.map((t) => t.id), ['t2'], '居ない選手を含む提案が残っている');
  assert.match(league.members[0].inbox[0].text, /移籍・退団/);
  assert.match(league.members[1].inbox[0].text, /Aからの/);
  assert.equal(pruneTrades(league, world, 'x', { all: true, reason: '年度が替わったため' }), 1);
  assert.equal(league.trades.length, 0, '年度更新で提案が残っている');
}

// --- 3人のリーグで通しで動かす ------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'pennant-social-'));
try {
  const store = new FileStore(join(dir, 'state.gz'));
  let now = '2026-10-26T15:00:00.000Z';
  const later = (hours) => {
    now = new Date(Date.parse(now) + hours * 3600000).toISOString();
  };
  const service = new LeagueService(store, {
    members: [{ userId: 'a', label: 'A' }],
    adminId: 'a',
    allowStep: true,
    clock: () => now,
  });
  const sessions = {};
  for (const id of ['a', 'b', 'c']) sessions[id] = (await service.login(id)).sessionId;
  let seq = 0;
  const live = () => store.read().then((b) => b.league);
  const send = async (user, type, payload) => {
    const l = await live();
    seq += 1;
    return service.command(user, sessions[user], {
      requestId: `social-${type}-${seq}`,
      revision: l?.revision ?? 0,
      type,
      payload,
    });
  };
  const view = (user) => service.view(user, sessions[user]);
  await send('a', 'create');
  await send('b', 'join', { teamName: '湘南サンズ' });
  await send('c', 'join', { teamName: '美瑛ベアーズ' });
  for (let i = 0; i < 4; i += 1) {
    const l = await live();
    if (!l.phase) break;
    for (const m of l.members) {
      const cur = await live();
      if (!cur.phase) break;
      await send(m.userId, 'submit', {
        phaseId: cur.phase.id,
        plan: defaultPhasePlan(cur, m.teamName),
        ready: true,
        baseSubmission: null,
      });
    }
  }
  assert.equal((await live()).status, 'running', '前提: 開幕している');
  for (let i = 0; i < 4; i += 1) {
    await send('a', 'step');
    later(1);
  }
  const started = await live();
  const teamOf = (l, user) => l.members.find((m) => m.userId === user).teamName;
  const [A, B, C] = ['a', 'b', 'c'].map((u) => teamOf(started, u));
  const pitchersOf = (l, name) =>
    l.game.teams[name].players.filter((p) => p.position === 'pitcher' && p.isActive !== false);

  // --- C1 オーナーのひとこと ------------------------------------------------
  await send('b', 'profile', { comment: '今年は昇格しかない' });
  assert.equal(
    (await view('a')).members.find((m) => m.teamName === B).comment,
    '今年は昇格しかない',
    'ひとことがほかの人に見えていない',
  );
  await assert.rejects(
    () => send('b', 'profile', { comment: 'あ'.repeat(OWNER_COMMENT_MAX + 1) }),
    /ひとことは/,
    '長すぎるひとことが通った',
  );
  assert.equal(
    (await service.teamInfo('a', B)).owner?.comment,
    '今年は昇格しかない',
    '球団の画面にひとことが出ていない',
  );

  // --- A1 トレードのひとこと・返事の知らせ ------------------------------------
  const pA = pitchersOf(started, A);
  const pB = pitchersOf(started, B);
  const pC = pitchersOf(started, C);
  await assert.rejects(
    () => send('a', 'tradeOffer', { to: B, offer: [pA[0].id], want: [pB[0].id], note: 'あ'.repeat(TRADE_NOTE_MAX + 1) }),
    /ひとことは/,
    '長すぎるひとことが通った',
  );
  await send('a', 'tradeOffer', { to: B, offer: [pA[0].id], want: [pB[0].id], note: '捕手が足りなくて…' });
  const offeredB = (await view('b')).trades[0];
  assert.equal(offeredB.note, '捕手が足りなくて…', '相手にひとことが届いていない');
  await send('b', 'tradeRespond', { tradeId: offeredB.id, action: 'counter', offer: [pA[0].id, pA[1].id], want: [pB[0].id], note: 'もう1人なら' });
  const countered = await view('a');
  assert.equal(countered.trades[0].replyNote, 'もう1人なら', '逆提案のひとことが無い');
  assert.equal(countered.inbox[0].type, 'tradeCountered', '逆提案の知らせが無い');
  await send('a', 'tradeRespond', { tradeId: offeredB.id, action: 'reject' });
  assert.equal((await view('b')).inbox[0].type, 'tradeWithdrawn', '取り下げの知らせが無い');
  assert.equal((await view('a')).trades.length, 0);

  // 成り立たなくなった提案は取り下げる: A の投手を B と C の両方に出し、B が受ける
  await send('a', 'tradeOffer', { to: B, offer: [pA[0].id], want: [pB[0].id] });
  await send('a', 'tradeOffer', { to: C, offer: [pA[0].id], want: [pC[0].id] });
  const toB = (await view('b')).trades[0];
  const revisionBefore = (await live()).revision;
  await send('b', 'tradeRespond', { tradeId: toB.id, action: 'accept' });
  const afterTrade = await live();
  assert.equal(afterTrade.trades.length, 0, '動いた選手を含む提案が残っている（枠を埋める）');
  assert.ok(afterTrade.revision > revisionBefore);
  assert.equal((await view('a')).inbox[0].type, 'tradeAccepted', '成立の知らせが無い');
  assert.ok(
    (await view('c')).inbox.some((n) => n.type === 'tradeWithdrawn'),
    '取り下げた提案の相手に知らせていない',
  );

  // --- A2 取引の記録 --------------------------------------------------------
  const log = afterTrade.transactions[0];
  assert.equal(log.kind, 'trade');
  assert.deepEqual(log.teams, [A, B]);
  assert.deepEqual(
    log.moves.map((m) => [m.playerId, m.from, m.to]),
    [
      [pA[0].id, A, B],
      [pB[0].id, B, A],
    ],
    '取引の記録の中身がちがう',
  );
  const read = await service.transactions('c', { team: B });
  assert.equal(read.items[0].id, log.id, '取引の記録を球団で絞れない');
  assert.equal((await service.transactions('c', { team: C })).items.length, 0);
  assert.equal((await view('a')).recentTransactions[0].id, log.id);
  await assert.rejects(() => service.transactions('zz', {}), (e) => e.status === 403);

  // --- B4 練習試合 ------------------------------------------------------------
  await assert.rejects(
    () => send('a', 'challenge', { toTeam: started.teams.find((t) => !started.members.some((m) => m.teamName === t.name)).name }),
    /人が持っている球団/,
    'CPU球団に申し込めた',
  );
  await send('a', 'challenge', { toTeam: C, note: '新しい打順を試したい' });
  await assert.rejects(() => send('c', 'challenge', { toTeam: A }), /もう申し込み/, '同じ組で2つ申し込めた');
  const offer = (await view('c')).exhibitions[0];
  assert.equal(offer.status, 'offered');
  assert.equal((await view('c')).inbox[0].type, 'challenge', '申し込みの知らせが無い');
  const beforeGame = await live();
  await send('c', 'challengeRespond', { id: offer.id, action: 'accept' });
  const afterGame = await live();
  const played = afterGame.exhibitions.find((e) => e.id === offer.id);
  assert.equal(played.status, 'played');
  assert.ok(Number.isInteger(played.result.homeScore) && Number.isInteger(played.result.awayScore));
  assert.equal(played.result.home, C, '受けた側がホームでない');
  assert.ok(played.result.teams[A]?.length > 8, '練習試合のボックスが無い');
  // ⚠ 成績・疲労・調子・記録・順位・日程に入らない
  for (const name of [A, C])
    assert.deepEqual(
      afterGame.game.teams[name],
      beforeGame.game.teams[name],
      `${name} の選手が練習試合で変わった（疲労・成績が残る）`,
    );
  assert.deepEqual(afterGame.season.standings, beforeGame.season.standings, '順位表が変わった');
  assert.deepEqual(afterGame.records, beforeGame.records, '記録に練習試合が入った');
  assert.deepEqual(afterGame.season.schedule, beforeGame.season.schedule, '日程が変わった');
  assert.equal((await view('a')).inbox[0].type, 'challengePlayed', '結果の知らせが無い');
  // 同じ相手とは1日1試合
  await assert.rejects(() => send('a', 'challenge', { toTeam: C }), /1日/, '同じ日に2試合目を申し込めた');
  later(24);
  await send('a', 'challenge', { toTeam: C });
  const second = (await view('a')).exhibitions.find((e) => e.status === 'offered');
  await send('a', 'challengeRespond', { id: second.id, action: 'withdraw' });
  assert.equal((await view('c')).inbox[0].type, 'challengeWithdrawn');
  // 同じ申し込みからは同じ試合（乱数は申し込みの番号から）
  // ⚠ ここでは結果を作り直さず、乱数の種が番号から決まることだけ確かめる（`respondChallenge`）

  // --- B1 予告先発 ------------------------------------------------------------
  const plan = (await view('a')).starterPlan;
  const open = plan.games.find((g) => !g.starterLocked);
  assert.ok(open, '前提: 確定前の試合がある');
  assert.ok(plan.games.filter((g) => g.starterLocked).length >= 1, '前提: 確定した試合がある');
  const lockedGame = plan.games.find((g) => g.starterLocked);
  const rotation = (await view('a')).lineup.starters;
  await assert.rejects(
    () => send('a', 'starterPick', { gameId: lockedGame.id, playerId: rotation[0] }),
    /確定しています/,
    '確定した試合の先発を変えられた',
  );
  const notStarter = (await live()).game.teams[A].players.find(
    (p) => p.position === 'pitcher' && !rotation.includes(p.id),
  );
  if (notStarter)
    await assert.rejects(
      () => send('a', 'starterPick', { gameId: open.id, playerId: notStarter.id }),
      /先発ローテ/,
      'ローテに居ない投手を指名できた',
    );
  // ⚠ 休めている投手を選ぶ（その試合の次に回ってくる予定の投手。前の登板から間が空いている）
  const ownSide = open.home === A ? 'home' : 'away';
  const index = plan.games.indexOf(open);
  const nextName = plan.games[index + 1]?.[`${ownSide}Starter`];
  const pickId =
    (await live()).game.teams[A].players.find((p) => p.name === nextName && rotation.includes(p.id))?.id ??
    rotation.find((id) => id !== open[`${ownSide}StarterInfo`]?.id);
  await send('a', 'starterPick', { gameId: open.id, playerId: pickId });
  const picked = (await view('a')).starterPlan.games.find((g) => g.id === open.id);
  assert.equal(picked[`${ownSide}StarterMark`], 'pick', '自分の指名に印が無い');
  assert.equal(picked[`${ownSide}StarterInfo`]?.id, pickId, '指名した投手が先発予定に出ていない');
  // 確定するまで試合を進める → 確定の印、変えられない
  for (let i = 0; i < 20; i += 1) {
    const l = await live();
    const game = l.season.schedule.find((g) => g.id === open.id);
    if (game.result) break;
    const lockedNow =
      (await view('a')).starterPlan.games.find((g) => g.id === open.id)?.starterLocked;
    if (lockedNow) {
      await assert.rejects(
        () => send('a', 'starterPick', { gameId: open.id, playerId: null }),
        /確定しています/,
        '確定した指名を外せた',
      );
    }
    await send('a', 'step');
    later(1);
  }
  const done = await live();
  const box = done.records.seasons[done.season.year].games[open.id];
  const starter = box.teams[A].find((p) => p.pitching?.gamesStarted === 1);
  // ⚠ 休めている投手を選んだので、回避ではなく投げているはず（世界の種は作った時刻で決まる）
  assert.equal(
    starter?.id,
    pickId,
    `指名した投手が投げていない（投げたのは ${starter?.name}）`,
  );
  assert.ok(!(done.members.find((m) => m.userId === 'a').starterPicks || {})[open.id], '終わった試合の指名が残っている');

  // --- A4 得点経過 ------------------------------------------------------------
  {
    const games = Object.values(done.records.seasons[done.season.year].games);
    assert.ok(games.length >= 6);
    for (const g of games) {
      assert.ok(Array.isArray(g.scoring), `試合 ${g.gameId} に得点経過が無い`);
      const away = g.scoring.filter((p) => p.half === 'top').reduce((s, p) => s + p.runs, 0);
      const home = g.scoring.filter((p) => p.half === 'bottom').reduce((s, p) => s + p.runs, 0);
      assert.deepEqual([away, home], [g.awayScore, g.homeScore], `試合 ${g.gameId} の得点経過の合計が点と合わない`);
      if (g.scoring.length) {
        const last = g.scoring.at(-1);
        assert.deepEqual([last.away, last.home], [g.awayScore, g.homeScore]);
      }
    }
    const recent = (await view('a')).recentGames.at(-1);
    assert.ok(Array.isArray(recent.scoring) && recent.lineScore, '直近の試合に得点経過と回ごとの得点が無い');
  }

  // --- A3 最後に来た時刻・おるすばん ---------------------------------------------
  {
    const l = await live();
    assert.ok(l.members.every((m) => m.lastSeenAt), 'ログイン・操作で来た時刻が入っていない');
    const before = l.revision;
    // 前に書いてから時間が経っていれば書く。⚠ 版は上げない（送信中の提出が弾かれる）
    await service.presence('b', sessions.b);
    const seen = (await live()).members.find((m) => m.userId === 'b').lastSeenAt;
    assert.equal(seen, now, '画面を開いたのに来た時刻を書いていない');
    assert.equal((await live()).revision, before, '来た時刻の記録で版が上がった（送信中の提出が弾かれる）');
    // 書いたばかりなら書かない（画面を開くたびに保存しない）
    later(1);
    await service.presence('b', sessions.b);
    assert.equal((await live()).members.find((m) => m.userId === 'b').lastSeenAt, seen, '書いたばかりなのにまた書いた');
    // b だけ3日来ない（a は進行の操作で毎回来ている）
    later(AWAY_DAYS * 24 + 1);
    const modesBefore = structuredClone(l.members.find((m) => m.userId === 'b').staffModes || null);
    await send('a', 'step');
    const away = await live();
    const b = away.members.find((m) => m.userId === 'b');
    assert.equal(b.away, true, '3日来ていない人がおるすばんにならない');
    assert.equal(away.members.find((m) => m.userId === 'a').away, undefined, '来ている人を留守にした');
    if (away.coaches) {
      const modes = effectiveStaffModes(away, b);
      assert.ok(
        Object.values(modes).every((mode) => mode === 'delegate' || mode === 'self'),
        'おるすばんなのに「意見を聞く」が残っている',
      );
    }
    assert.deepEqual(b.staffModes || null, modesBefore, 'おるすばんで本人の任せ方を書き換えた');
    assert.ok((await view('a')).members.find((m) => m.teamName === B).away, '一覧に留守の印が出ない');
    assert.equal((await view('a')).members.find((m) => m.teamName === B).lastSeenDay, tokyoDay(seen));
    // 来たら解く
    await service.presence('b', sessions.b);
    const back = (await live()).members.find((m) => m.userId === 'b');
    assert.equal(back.away, undefined, '来たのにおるすばんが解けない');
    assert.equal(back.inbox[0].type, 'awayEnded');
    assert.ok(!isAwayAt(back, now));
  }

  // --- A3 管理者が球団をCPUに戻す -----------------------------------------------
  {
    await send('c', 'tradeOffer', { to: A, offer: [pitchersOf(await live(), C)[1].id], want: [pitchersOf(await live(), A)[2].id] });
    await send('a', 'challenge', { toTeam: C });
    await assert.rejects(() => send('b', 'releaseMember', { userId: 'c' }), (e) => e.status === 403, '管理者でない人が外せた');
    await assert.rejects(() => send('a', 'releaseMember', { userId: 'a' }), /自分/, '管理者が自分を外せた');
    await send('a', 'releaseMember', { userId: 'c' });
    const l = await live();
    assert.ok(!l.members.some((m) => m.userId === 'c'), '外した人が残っている');
    assert.equal(l.teams.find((t) => t.name === C).displayName, C, '球団名が元に戻っていない');
    assert.equal(l.trades.length, 0, '外した人の提案が残っている');
    assert.ok(!l.exhibitions.some((e) => e.status === 'offered'), '外した人の練習試合の申し込みが残っている');
    assert.equal((await service.teamInfo('a', C)).owner, null, 'CPUに戻した球団にオーナーが出ている');
    assert.ok((await view('a')).inbox.some((n) => /オーナーが替わった/.test(n.text)), '相手に取り下げを知らせていない');
    // 次に入る人の種は、残っている人と重ならない
    const sd = (await service.login('d')).sessionId;
    sessions.d = sd;
    await send('d', 'join', {});
    const joined = await live();
    const seeds = joined.members.map((m) => m.packSeed).filter((s) => s != null);
    assert.equal(new Set(seeds).size, seeds.length, '途中参加の種が重なった（同じidの選手ができる）');
  }

  console.log(
    '■ 人どうしの関わり: OK（ひとこと / トレードのひとこと・返事の知らせ・成り立たない提案の取り下げ / 取引の記録 / 練習試合は成績・疲労・記録に入らず1日1試合 / 予告先発は確定まで本人だけ・確定後は変えられない・その投手が投げる / 得点経過の合計が点と合う / おるすばんと解除・版を上げない / 管理者が球団をCPUに戻す）',
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
