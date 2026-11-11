// ホームに出すリーグ全体の眺め（2部制の順位表・先発予定・ベスト5）の検査。
//
// ⚠ 主目的は「**見せてはいけないものを見せないこと**」と「**並びが決まること**」。
//    率の項目に規定未満を混ぜると、3打数2安打の控えが打率1位になって
//    順位表として意味を成さない。
// ⚠ 2部制の分け方は `standingsByLeague` が正本。ここで並べ直さない。
import assert from 'node:assert/strict';
import { turnOfDate } from '../../src/online/shared.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../../server/storage/fileStore.mjs';
import { LeagueService } from '../../server/leagueService.mjs';
import { defaultPhasePlan } from '../../server/leagueEngine.mjs';
import { leagueLeaders, withStarters, teamSeasonStats } from '../../server/leagueBoard.mjs';
import { ownUpcomingGames } from '../../server/projection.mjs';
import {
  PYRAMID_LEAGUES,
  TEAMS_PER_LEAGUE,
} from '../../src/online/pyramidLeague.js';

const dir = await mkdtemp(join(tmpdir(), 'pennant-board-'));
try {
  const store = new FileStore(join(dir, 'state.gz'));
  let now = '2026-10-26T15:00:00.000Z';
  const service = new LeagueService(store, {
    members: [{ userId: 'admin', label: '管理者' }],
    adminId: 'admin',
    allowStep: true,
    clock: () => now,
  });
  const admin = (await service.login('admin')).sessionId;
  const guest = (await service.login('guest')).sessionId;
  let seq = 0;
  const send = async (user, sess, type, payload) => {
    const l = (await store.read()).league;
    seq += 1;
    return service.command(user, sess, {
      requestId: `board-${type}-${seq}`,
      revision: l?.revision ?? 0,
      type,
      payload,
    });
  };
  await send('admin', admin, 'create');
  await send('guest', guest, 'join', { teamName: '湘南サンズ' });
  for (let i = 0; i < 4; i += 1) {
    const l = (await store.read()).league;
    if (!l.phase) break;
    for (const m of l.members) {
      const cur = (await store.read()).league;
      if (!cur.phase) break;
      await service.command(m.userId, m.userId === 'admin' ? admin : guest, {
        requestId: `board-submit-${i}-${m.userId}`,
        revision: cur.revision,
        type: 'submit',
        payload: {
          phaseId: cur.phase.id,
          plan: defaultPhasePlan(cur, m.teamName),
          ready: true,
          baseSubmission: null,
        },
      });
    }
  }
  for (let i = 0; i < 14; i += 1) {
    await send('admin', admin, 'step');
    now = new Date(Date.parse(now) + 3600000).toISOString();
  }
  const view = await service.view('admin', admin);

  // --- 2部制の順位表に必要なもの -------------------------------------
  // ⚠ 分け方そのものは画面側（`LeaguePanels` の `Standings`）が持つ。
  //    ここで作り直さない。投影が渡す材料だけを見る。
  assert.ok(view.teamLeagues, '所属リーグの表が無い（順位表を部ごとに分けられない）');
  assert.equal(
    Object.keys(view.teamLeagues).length,
    PYRAMID_LEAGUES.length * TEAMS_PER_LEAGUE,
    '全球団ぶんの所属リーグが無い',
  );
  for (const division of PYRAMID_LEAGUES)
    assert.equal(
      Object.values(view.teamLeagues).filter((id) => id === division.id).length,
      TEAMS_PER_LEAGUE,
      `${division.id} の球団数がちがう`,
    );

  // ⚠ 人が持っている球団だけ名前を添える。CPUに付けると持ち主が居るように見える
  assert.ok(view.teamOwners, '持ち主の表が無い');
  assert.deepEqual(
    Object.keys(view.teamOwners).sort(),
    (await store.read()).league.members.map((m) => m.teamName).sort(),
    '持ち主の表が参加者と合っていない',
  );
  // ⚠ 呼び名が球団名と同じときは空で返す。参加時の既定が球団名なので、
  //    そのまま出すと「湘南サンズ（湘南サンズ）」と2回並ぶ
  const joinedTeam = (await store.read()).league.members.find(
    (m) => m.userId === 'guest',
  ).teamName;
  assert.equal(view.teamOwners[joinedTeam], '', '球団名と同じ呼び名を返している');

  // 名前を付けると出る
  await send('guest', guest, 'profile', { playerName: 'あいす' });
  const named = await service.view('guest', guest);
  assert.equal(named.teamOwners[joinedTeam], 'あいす', '付けた名前が渡っていない');
  // 球団名も変えられる（内部名は変わらない）
  const before = (await store.read()).league.members.find((m) => m.userId === 'guest');
  await send('guest', guest, 'profile', { teamName: '湘南ドルフィンズ' });
  const after = (await store.read()).league.members.find((m) => m.userId === 'guest');
  assert.equal(after.teamName, before.teamName, '内部名が変わっている（記録が迷子になる）');
  assert.equal(after.displayName, '湘南ドルフィンズ');

  // --- 今後の日程 -----------------------------------------------------
  assert.ok(view.upcoming.length > 0, '今後の日程が空');
  for (const game of view.upcoming) {
    assert.ok(game.home && game.away, '対戦相手が無い');
    assert.notEqual(game.home, game.away, '同じ球団同士の試合');
    // ⚠ 先発予定は出すこと。「誰が投げるか」が分からないと日程を見る意味が薄い
    assert.ok(game.homeStarter, `先発予定が無い: ${game.home}`);
    assert.ok(game.awayStarter, `先発予定が無い: ${game.away}`);
  }
  // ⚠ 同じ球団が続けて出るとき、先発予定は**ローテを回すこと**。
  //    毎回同じ投手だと、1人が全試合に先発する予定になる。
  // ⚠ 本物のリーグで「最初に見つけた球団」を見ると脆い。先発が1人しか
  //    残っていない球団を引くと、連投が正しい挙動になって落ちる（実際に落ちた）。
  //    作り物の日程で、回る所だけを直に確かめる。
  {
    const teams = {
      A: {
        players: [
          { id: 1, name: '一番手' },
          { id: 2, name: '二番手' },
          { id: 3, name: '三番手' },
        ],
        pitchingRotation: { starters: [1, 2, 3], currentStarterIndex: 0 },
      },
      B: {
        players: [{ id: 9, name: '唯一' }],
        pitchingRotation: { starters: [9], currentStarterIndex: 0 },
      },
      C: { players: [], pitchingRotation: { starters: [] } },
    };
    const fake = [
      { id: 1, date: { year: 1, month: 4, day: 1 }, home: 'A', away: 'B' },
      { id: 2, date: { year: 1, month: 4, day: 2 }, home: 'A', away: 'B' },
      { id: 3, date: { year: 1, month: 4, day: 3 }, home: 'A', away: 'C' },
    ];
    const rows = withStarters(fake, teams);
    assert.deepEqual(
      rows.map((g) => g.homeStarter),
      ['一番手', '二番手', '三番手'],
      'ローテが回っていない',
    );
    // ⚠ 先発が1人しかいない球団は連投でよい（それが実際の予定）
    assert.deepEqual(rows.slice(0, 2).map((g) => g.awayStarter), ['唯一', '唯一']);
    // 投手が居なくても落ちない
    assert.equal(rows[2].awayStarter, null, '投手が居ないのに名前が出る');
    // ⚠ 途中から始めても回る（`currentStarterIndex` を見る）
    teams.A.pitchingRotation.currentStarterIndex = 2;
    assert.deepEqual(
      withStarters(fake, teams).map((g) => g.homeStarter),
      ['三番手', '一番手', '二番手'],
      '現在のローテ位置を見ていない',
    );
    // ⚠ 並べ替えや絞り込みをしないこと（それは投影側の仕事）
    assert.deepEqual(
      withStarters(fake, teams).map((g) => g.id),
      [1, 2, 3],
      '渡された順を変えている',
    );
  }

  // --- ベスト5 --------------------------------------------------------
  const leaders = Object.fromEntries(view.leaders.map((c) => [c.id, c]));
  for (const id of ['avg', 'homeruns', 'rbis', 'stolenBases', 'era', 'wins', 'strikeouts', 'saves'])
    assert.ok(leaders[id], `${id} の項目が無い`);
  assert.ok(leaders.avg.rows.length > 0, '打率の上位が空');
  assert.ok(leaders.avg.rows.length <= 10, '10人を超えている');
  assert.ok(leaders.avg.rows.every((r) => r.id != null), '行に選手の id が無い');
  // 打率は降順、防御率は昇順
  const avgValues = leaders.avg.rows.map((r) => r.value);
  assert.deepEqual(avgValues, [...avgValues].sort((a, b) => b - a), '打率が降順でない');
  const eraValues = leaders.era.rows.map((r) => r.value);
  assert.deepEqual(eraValues, [...eraValues].sort((a, b) => a - b), '防御率が昇順でない');

  // ⚠ **規定に届かない選手を混ぜないこと**。混ぜると3打数2安打の控えが1位になる
  const league = (await store.read()).league;
  const played = Object.fromEntries(
    league.season.standings.map((s) => [s.team, s.gamesPlayed || 0]),
  );
  for (const row of leaders.avg.rows) {
    const player = league.game.teams[row.team].players.find((p) => p.name === row.name);
    const b = player.seasonStats.batting;
    assert.ok(
      (b.atBats || 0) + (b.walks || 0) + (b.hitByPitch || 0) +
        (b.sacrificeBunts || 0) + (b.sacrificeFlies || 0) >= played[row.team] * 3.1,
      `規定未満が打率の上位に入っている: ${row.name}`,
    );
  }

  // 死球・犠打・犠飛も打席に含む。計測済みならその打席数を優先する。
  {
    const player = (id, batting) => ({ id, name: `規定${id}`, seasonStats: { batting } });
    const base = { atBats: 25, hits: 10, walks: 0 };
    const players = [
      player(1, { ...base, plateAppearances: 31 }),
      player(2, { ...base, hitByPitch: 4, sacrificeBunts: 2 }),
      player(3, { ...base, hitByPitch: 3, sacrificeFlies: 3 }),
      player(4, { ...base, hitByPitch: 4, sacrificeBunts: 1 }),
    ];
    const fixture = {
      season: { settings: { teamNames: ['甲'] }, standings: [{ team: '甲', gamesPlayed: 10 }] },
      game: { teams: { 甲: { players } } },
    };
    assert.deepEqual(
      leagueLeaders(fixture, (_name, p) => p.seasonStats)
        .find((category) => category.id === 'avg').rows.map((row) => row.name).sort(),
      ['規定1', '規定2', '規定3'],
      '規定31打席に到達した打者を外す・30打席の打者を含める',
    );
  }

  // 並びが決まっていること（見るたび順位が入れ替わらない）
  const again = await service.view('admin', admin);
  assert.deepEqual(
    again.leaders.map((c) => c.rows.map((r) => `${r.team}:${r.name}`)),
    view.leaders.map((c) => c.rows.map((r) => `${r.team}:${r.name}`)),
    '上位の並びが実行のたびに変わる',
  );

  // ⚠ **同値のとき、入力の順で結果が変わらないこと**。球団をなめる順は
  //    変わりうるのに、見るたび1位が入れ替わると順位表として信用できない。
  //    （`sort` が安定なだけでは足りない。入力が違えば出力も変わる）
  {
    const player = (id, name, homeruns) => ({
      id,
      name,
      seasonStats: { batting: { homeruns }, pitching: {} },
    });
    const make = (order) => ({
      season: {
        settings: { teamNames: order },
        standings: order.map((t) => ({ team: t, gamesPlayed: 10 })),
      },
      game: {
        teams: {
          甲: { players: [player(1, '同点太郎', 5)] },
          乙: { players: [player(2, '同点次郎', 5)] },
          丙: { players: [player(3, '同点三郎', 5)] },
        },
      },
    });
    const run = (order) =>
      leagueLeaders(make(order), (_t, p) => p.seasonStats)
        .find((c) => c.id === 'homeruns')
        .rows.map((r) => r.name);
    assert.deepEqual(
      run(['甲', '乙', '丙']),
      run(['丙', '乙', '甲']),
      '同点の並びが入力順に左右されている',
    );
  }

  // ⚠ 成績が1つも無い時点でも落ちないこと（開幕直後）
  assert.doesNotThrow(() =>
    leagueLeaders(
      { ...league, season: { ...league.season, standings: [] } },
      () => ({ batting: {}, pitching: {} }),
    ),
  );
  // --- 今後の5試合（自球団だけ） --------------------------------------
  // ⚠ ホームに出すのは**自球団の次の5試合**。リーグ全体の一覧（`upcoming`）は
  //    試合結果の画面が使うので、そちらを絞らないこと。
  // ⚠ 6試合だと、直近の一覧と横に並べたときに順位表より縦に伸びる
  {
    const live = (await store.read()).league;
    const own = view.teamName;
    const next = view.nextGames;
    assert.ok(Array.isArray(next), '今後の5試合が渡っていない');
    assert.equal(next.length, 5, `試合数がちがう: ${next.length}`);
    for (const game of next)
      assert.ok(
        game.home === own || game.away === own,
        `自球団の試合でないものが混ざっている: ${game.away}@${game.home}`,
      );
    // ⚠ 日付順。順が崩れると「次の試合」が次でなくなる
    const keys = next.map(
      (g) => g.date.year * 10000 + g.date.month * 100 + g.date.day,
    );
    assert.deepEqual(keys, [...keys].sort((a, b) => a - b), '日付順でない');
    // ⚠ **消化済みを混ぜない**
    const results = new Set(live.season.results.map((g) => g.gameId));
    for (const game of next)
      assert.ok(!results.has(game.id), '消化済みの試合が混ざっている');
    // ⚠ いちばん近い試合であること（間を飛ばしていない）
    const earliest = live.season.schedule
      .filter((g) => !g.result && (g.home === own || g.away === own))
      .map((g) => g.date.year * 10000 + g.date.month * 100 + g.date.day)
      .sort((a, b) => a - b)[0];
    assert.equal(keys[0], earliest, '次の試合を飛ばしている');
    // ⚠ 先発予定が入っていること（ローテを回すのは `withStarters` の検査で見る）
    assert.ok(
      next.some((g) => g.homeStarter && g.awayStarter),
      '先発予定が入っていない',
    );
    // ⚠ 自球団の先発が**毎試合同じでない**こと。5試合すべて同じ投手だと、
    //    ローテが回っていない（`withStarters` を通していない）
    const mine = next.map((g) => (g.home === own ? g.homeStarter : g.awayStarter));
    assert.ok(new Set(mine).size > 1, `自球団の先発が全部同じ: ${mine[0]}`);

    // ⚠ **何試合目かが付いていること**。画面は日付ではなくこれを出す
    //    （1ターン＝ゲーム内1日で休養日が飛ぶので、暦では進み具合が読めない）。
    const played = live.season.standings.find((r) => r.team === own).gamesPlayed;
    assert.equal(
      next[0].number,
      played + 1,
      `次の試合の番号が合わない: ${next[0].number}（消化${played}）`,
    );
    assert.deepEqual(
      next.map((g) => g.number),
      next.map((_, i) => played + 1 + i),
      '試合番号が連続していない',
    );

    // ⚠ **先発の投げる手と今季成績が付いていること**。名前だけだと、
    //    どちらが有利な相手かを画面で判断できない
    const roster = new Map(
      live.season.settings.teamNames.flatMap((name) =>
        live.game.teams[name].players.map((p) => [p.id, p]),
      ),
    );
    const byName = new Map([...roster.values()].map((p) => [p.name, p]));
    for (const game of next) {
      for (const side of ['home', 'away']) {
        const info = game[`${side}StarterInfo`];
        assert.ok(info, `${side} の先発の情報が無い`);
        assert.equal(info.name, game[`${side}Starter`], '名前が食い違っている');
        // ⚠ 左右は**名簿の `throws` と一致**すること。既定で右に倒すだけだと、
        //    左投手が全員右と出る
        assert.equal(
          info.throws,
          byName.get(info.name).physical?.throws === 'left' ? 'left' : 'right',
          `${info.name} の投げる手がちがう`,
        );
        assert.ok(Number.isInteger(info.wins) && info.wins >= 0, '勝が数でない');
        assert.ok(Number.isInteger(info.losses) && info.losses >= 0, '敗が数でない');
        assert.ok(
          info.era === null || (info.era >= 0 && info.era < 30),
          `${info.name} の防御率が外れている: ${info.era}`,
        );
      }
    }
    // ⚠ **左投手が居ること**（全員「右」になっていないこと）。実測で
    //    独立リーグの左投げはおよそ2割
    const hands = new Set(
      live.season.settings.teamNames
        .flatMap((name) => live.game.teams[name].players)
        .filter((p) => p.position === 'pitcher')
        .map((p) => p.physical?.throws),
    );
    assert.ok(hands.has('left') && hands.has('right'), '前提: 左右の投手が居る');

    // ⚠ 勝敗と防御率が**選手成績と一致**すること（別に数えていない）
    const sample = next.find((g) => g.homeStarterInfo.wins + g.homeStarterInfo.losses > 0)
      || next[0];
    const player = byName.get(sample.homeStarterInfo.name);
    const home = live.game.teams[sample.home].players.some((p) => p.id === player.id)
      ? sample.home
      : null;
    assert.ok(home, '先発が所属球団の名簿に居ない');
    const stats = player.seasonStats?.pitching || {};
    assert.equal(sample.homeStarterInfo.wins, stats.wins || 0, '勝が名簿と合わない');
    assert.equal(sample.homeStarterInfo.losses, stats.losses || 0, '敗が名簿と合わない');
  }

  // ⚠ **投げていない投手の防御率は `null`**（作り物の成績で見る）。0 で割った
  //    値や 0.00 を出すと「無失点の好投手」に見える。本物のリーグはこの時点で
  //    先発が全員投げているので、ここは作り物で押さえる。
  {
    const live = (await store.read()).league;
    const [home, away] = live.season.settings.teamNames;
    const fresh = withStarters(
      [{ id: 1, date: live.season.currentDate, home, away }],
      live.game.teams,
      () => ({ pitching: { wins: 0, losses: 0, earnedRuns: 0, inningsPitched: 0 } }),
    );
    assert.equal(fresh[0].homeStarterInfo.era, null, '投げていないのに防御率が出る');
    assert.equal(fresh[0].awayStarterInfo.era, null, '投げていないのに防御率が出る');
    // 1失点・3イニング（アウト9つ）なら 3.00
    const pitched = withStarters(
      [{ id: 1, date: live.season.currentDate, home, away }],
      live.game.teams,
      () => ({ pitching: { wins: 1, losses: 2, earnedRuns: 1, inningsPitched: 9 } }),
    );
    assert.equal(pitched[0].homeStarterInfo.era, 3, '防御率の式がちがう');
    assert.equal(pitched[0].homeStarterInfo.wins, 1, '勝がちがう');
    assert.equal(pitched[0].homeStarterInfo.losses, 2, '敗がちがう');
  }

  // ⚠ **リーグ全体の一覧には重ねないこと**。投影を重くするだけで、
  //    試合結果の画面は名前しか出さない
  {
    const live = (await store.read()).league;
    const plain = withStarters(
      [
        {
          id: 1,
          date: live.season.currentDate,
          home: live.season.settings.teamNames[0],
          away: live.season.settings.teamNames[1],
        },
      ],
      live.game.teams,
    );
    assert.ok(plain[0].homeStarter, '前提: 先発の名前は付く');
    assert.ok(
      !('homeStarterInfo' in plain[0]),
      '成績を渡していないのに先発の情報が付いている',
    );
  }

  // ⚠ **番号は消化済みも数えること**（作り物の日程で見る）。これから行う試合
  //    だけで1から振ると、シーズン中ずっと「1試合目」から始まる。
  {
    const day = (d) => ({ year: 2026, month: 9, day: d });
    const games = ownUpcomingGames(
      [
        { id: 1, date: day(1), home: '甲府ウルブズ', away: '松本ディアーズ', result: {} },
        { id: 2, date: day(2), home: '長岡サンダー', away: '甲府ウルブズ', result: {} },
        { id: 3, date: day(3), home: '甲府ウルブズ', away: '長岡サンダー', result: null },
        { id: 4, date: day(4), home: '松本ディアーズ', away: '甲府ウルブズ', result: null },
        // 他球団の試合は数に入れない
        { id: 5, date: day(2), home: '松本ディアーズ', away: '長岡サンダー', result: {} },
      ],
      '甲府ウルブズ',
    );
    assert.deepEqual(
      games.map((g) => g.number),
      [3, 4],
      '消化済みを数えずに番号を振っている',
    );
  }

  // ⚠ **日付順に並べ直すこと**（作り物の日程で見る）。`pyramidSchedule` が
  //    作る配列は、1球団ぶんを抜き出すとたまたま日付順になっているので、
  //    本物のリーグでは並べ直しを外しても気づけない（実測で素通りした）。
  //    プレーオフの試合は後から足されるので、順を当てにはできない。
  {
    const day = (d) => ({ year: 2026, month: 9, day: d });
    const games = ownUpcomingGames(
      [
        { id: 3, date: day(9), home: '甲府ウルブズ', away: '松本ディアーズ', result: null },
        { id: 1, date: day(3), home: '松本ディアーズ', away: '甲府ウルブズ', result: null },
        { id: 2, date: day(5), home: '甲府ウルブズ', away: '長岡サンダー', result: null },
        { id: 4, date: day(1), home: '長岡サンダー', away: '松本ディアーズ', result: null },
      ],
      '甲府ウルブズ',
    );
    assert.deepEqual(
      games.map((g) => g.date.day),
      [3, 5, 9],
      '自球団の予定が日付順になっていない',
    );
  }

  // --- 能力ランキング（リーグ全球団） ----------------------------------
  // ⚠ 以前は自球団の中だけだった。12球団288人の中での位置が分からないと、
  //    自分の選手が強いのか弱いのか判断できない。
  {
    const live = (await store.read()).league;
    const fields = view.abilityLeaders;
    assert.ok(Array.isArray(fields) && fields.length >= 8, '能力ランキングが渡っていない');
    const names = live.season.settings.teamNames;
    const byId = new Map(
      names.flatMap((n) => live.game.teams[n].players.map((p) => [p.id, { team: n, p }])),
    );
    const teamsSeen = new Set();
    for (const field of fields) {
      // ⚠ **ベスト10まで**。5人だと288人の中の上澄みしか見えない
      assert.equal(field.rows.length, 10, `${field.label} が10人でない`);
      // ⚠ **全球団から選ぶこと**。自球団だけだと、どの行も同じ球団になる
      for (const row of field.rows) {
        const found = byId.get(row.id);
        assert.ok(found, `${row.name} が名簿に居ない`);
        assert.equal(row.team, found.team, '球団がちがう');
        teamsSeen.add(row.team);
        // ⚠ 投手の項目は投手だけ、野手の項目は野手だけ。混ぜると
        //    「走力ランキングが投手で埋まる」
        assert.equal(
          row.position === 'pitcher',
          field.side === 'pitching',
          `${field.label} に ${row.position} が混ざっている`,
        );
      }
      // 降順に並んでいる
      const values = field.rows.map((r) => r.value);
      assert.deepEqual(
        values,
        [...values].sort((a, b) => b - a),
        `${field.label} が降順でない`,
      );
    }
    assert.ok(
      teamsSeen.size > 1,
      `自球団の中だけで並べている（出た球団: ${[...teamsSeen].join('・')}）`,
    );
    // ⚠ 同値は名前で分ける。見るたび違う人が1位になると順位表の意味が無い
    const again = await service.view('admin', admin);
    assert.deepEqual(
      again.abilityLeaders.map((f) => f.rows.map((r) => r.id)),
      fields.map((f) => f.rows.map((r) => r.id)),
      '見るたびに並びが変わる',
    );
  }

  // --- 順位表に添えるチーム打率・チーム防御率 --------------------------
  {
    const a = { batting: { hits: 6, atBats: 20 }, pitching: { earnedRuns: 2, inningsPitched: 27 } };
    const b = { batting: { hits: 2, atBats: 10 }, pitching: { earnedRuns: 4, inningsPitched: 27 } };
    const fixture = {
      season: { year: 1, settings: { teamNames: ['甲', '乙'] }, results: [{ gameId: 1 }] },
      game: { teams: {
        甲: { players: [{ id: 1, seasonStats: structuredClone(a) }] },
        乙: { players: [{ id: 2, seasonStats: structuredClone(b) }] },
      } },
      records: { seasons: { 1: { year: 1, complete: true, games: {
        1: { home: '甲', away: '乙', teams: { 甲: [a], 乙: [b] } },
      } } } },
    };
    const statsOf = (_name, p) => p.seasonStats;
    const expected = { 甲: { average: 0.3, era: 2 }, 乙: { average: 0.2, era: 4 } };
    assert.deepEqual(teamSeasonStats(fixture, statsOf), expected);
    [fixture.game.teams.甲.players, fixture.game.teams.乙.players] =
      [fixture.game.teams.乙.players, fixture.game.teams.甲.players];
    assert.deepEqual(teamSeasonStats(fixture, statsOf), expected, '移籍だけで過去の球団成績が移った');
    fixture.game.teams.甲.players = [];
    assert.deepEqual(teamSeasonStats(fixture, statsOf), expected, '退団した選手の球団での実績が消えた');

    // 記録の無い試合を0に置き換えない。旧リーグ・部分記録は名簿の既存成績へ戻す。
    fixture.game.teams.甲.players = [{ id: 2, seasonStats: structuredClone(b) }];
    const fallback = { 甲: { average: 0.2, era: 4 }, 乙: { average: 0.3, era: 2 } };
    const partial = structuredClone(fixture);
    partial.records.seasons[1].complete = false;
    assert.deepEqual(teamSeasonStats(partial, statsOf), fallback, '部分記録を全試合の成績として出した');
    const missing = structuredClone(fixture);
    missing.season.results.push({ gameId: 2 });
    assert.deepEqual(teamSeasonStats(missing, statsOf), fallback, '欠けた試合を0にした');
    const legacy = structuredClone(fixture);
    delete legacy.records;
    assert.deepEqual(teamSeasonStats(legacy, statsOf), fallback, '未計測リーグの既存成績を失った');
    const empty = structuredClone(fixture);
    empty.season.results = [];
    empty.records.seasons[1].games = {};
    assert.deepEqual(teamSeasonStats(empty, statsOf), {
      甲: { average: null, era: null }, 乙: { average: null, era: null },
    }, '開幕前の0打席・0投球回を打率0・防御率0にした');
  }
  {
    const live = (await store.read()).league;
    const stats = view.teamStats;
    assert.ok(stats, 'チーム成績が渡っていない');
    assert.deepEqual(
      Object.keys(stats).sort(),
      [...live.season.settings.teamNames].sort(),
      '全球団ぶんのチーム成績が無い',
    );
    let counted = 0;
    for (const [name, row] of Object.entries(stats)) {
      if (row.average === null) continue;
      counted += 1;
      // ⚠ 独立リーグの打率は実測で .2 前後。3倍（イニングをアウト数と
      //    取り違えるなど）や0になっていないこと
      assert.ok(
        row.average > 0.1 && row.average < 0.4,
        `${name} のチーム打率が外れている: ${row.average}`,
      );
      // ⚠ `inningsPitched` は**アウト数**。イニング数だと思って9を掛けると
      //    防御率が3倍になる（実測で3前後 → 9前後）
      assert.ok(
        row.era > 0 && row.era < 9,
        `${name} のチーム防御率が外れている: ${row.era}`,
      );
    }
    assert.equal(counted, live.season.settings.teamNames.length, '打てていない球団がある');

    // ⚠ **選手成績と合っていること**。別に数えると画面の中で数字が食い違う
    const own = view.teamName;
    const hits = view.roster.reduce(
      (n, p) => n + (p.seasonStats?.batting?.hits || 0),
      0,
    );
    const atBats = view.roster.reduce(
      (n, p) => n + (p.seasonStats?.batting?.atBats || 0),
      0,
    );
    assert.ok(atBats > 0, '前提: 自球団が打席に立っている');
    assert.ok(
      Math.abs(stats[own].average - hits / atBats) < 1e-9,
      `自球団のチーム打率が名簿の合計と合わない: ${stats[own].average} / ${hits / atBats}`,
    );
  }

  // --- ホームの「直近5試合」 -------------------------------------------
  // ⚠ リーグ全体の `results`（直近14試合）では足りない。12球団は毎ターン6試合
  //    するので、自球団は2〜3試合しか入らない
  {
    const own = view.teamName;
    const recent = view.recentGames;
    assert.ok(Array.isArray(recent), '直近の試合が渡っていない');
    assert.ok(recent.length > 0, '直近の試合が空');
    assert.ok(recent.length <= 5, `直近の試合が多すぎる: ${recent.length}`);
    for (const g of recent) {
      assert.ok(
        g.home === own || g.away === own,
        `自球団以外の試合が入っている: ${g.home} 対 ${g.away}`,
      );
      // ⚠ **消化済みだけ**。点数の無い試合が混ざると「0-0」と出る
      assert.ok(
        Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore),
        '点数の無い試合が入っている',
      );
    }
    // ⚠ **古い順**で返すこと（画面が上から並べる）
    const turns = recent.map((g) => turnOfDate(g.date, view.seasonTurns));
    assert.deepEqual(
      turns,
      [...turns].sort((a, b) => a - b),
      '直近の試合が古い順になっていない',
    );
    // ⚠ 通し番号の数え方は「今後の試合」と揃えること（同じ試合が左右で違う番号
    //    になる）。直近の最後は、今後の最初より前の番号
    const next = view.nextGames || [];
    if (next.length)
      assert.ok(
        recent.at(-1).number < next[0].number,
        `番号の数え方が左右で食い違う: ${recent.at(-1).number} / ${next[0].number}`,
      );
    // ⚠ ホームは**5試合**（6試合だと順位表まで縦に伸びる）
    assert.ok(next.length <= 5, `今後の試合が多すぎる: ${next.length}`);
  }

  // --- 通算成績（球団ごとの読み込みに載る）-----------------------------
  // ⚠ **1年で終わるゲームではない**。育てた選手がこのリーグで何をしたかが
  //    残らないと、育てた意味が見えない。
  // ⚠ 通算は**ビューに載せない**（288人ぶんは重い）。球団ごとの読み込み
  //    （`action=team`）に載せ、画面はそこから読む。
  {
    const live = (await store.read()).league;
    const own = view.teamName;
    const info = await service.teamInfo('admin', own);
    const careerOf = (p) => (p.periods || []).find((x) => x.id === 'career');
    const withCareer = info.roster.filter(careerOf).map((p) => ({
      ...p,
      career: careerOf(p),
    }));
    assert.ok(withCareer.length > 0, '通算成績が1人も付いていない');
    // ⚠ **今季を含めること**。シーズン中に開いて空だと、記録が無いように見える
    const played = withCareer.filter(
      (p) => (p.career.seasonStats?.batting?.atBats || 0) > 0,
    );
    assert.ok(played.length > 0, '打席に立った選手の通算が0');
    for (const p of played) {
      assert.ok(p.career.years >= 1, `${p.name} の年数が0`);
      // ⚠ **率はその場で出すこと**。合計の足し算では作れない
      const m = p.career.performance?.batting?.metrics;
      assert.ok(m, `${p.name} の通算に率が無い`);
      const s = p.career.seasonStats.batting;
      assert.ok(
        Math.abs(m.avg - s.hits / s.atBats) < 1e-9,
        `${p.name} の通算打率が合計と合わない: ${m.avg} / ${s.hits / s.atBats}`,
      );
      // ⚠ 通算は今季以上（今季しか無い段階では一致する）
      assert.ok(
        p.career.seasonStats.batting.atBats >=
          (p.seasonStats?.batting?.atBats || 0),
        `${p.name} の通算が今季を下回っている`,
      );
    }
    // ⚠ 記録の鍵は `onlinePlayerId`。付いていないと移籍で通算が切れる
    for (const name of live.season.settings.teamNames)
      for (const player of live.game.teams[name].players)
        assert.ok(
          player.onlinePlayerId,
          `${player.name} に記録の鍵が付いていない（移籍で通算が切れる）`,
        );
    // ⚠ **他球団も読めること**（画面は球団を選んで見る）
    const other = live.season.settings.teamNames.find((n) => n !== own);
    const otherInfo = await service.teamInfo('admin', other);
    assert.ok(otherInfo.roster.some(careerOf), '他球団の通算成績が読めない');
    // ⚠ **他球団の選手も、今季以外の期間を持つこと**。以前は今季だけで、
    //    CPU球団の選手を開くと「成績が残っていない」ように見えた
    const sample = otherInfo.roster.find(careerOf);
    assert.ok(
      sample.periods.some((x) => x.id === 'current'),
      '他球団の選手に今季の期間が無い',
    );
    assert.ok(
      sample.periods.length > 1,
      `他球団の選手が今季しか持っていない: ${sample.periods.map((x) => x.label).join('/')}`,
    );
    // ⚠ 場面別は**外して**載せる（索引が重くなる）。今季のぶんは
    //    `publicSplits` に別にあり、画面がそこへ重ねる
    assert.ok(
      sample.periods.every((x) => x.splits === undefined),
      '期間に場面別が載っている（索引が重くなる）',
    );
    assert.ok(sample.publicSplits, '今季の場面別が載っていない');
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(
  '■ ホームの眺め: OK（所属リーグと持ち主の表・名前を後から変えられる・先発予定がローテを回る・死球や犠打飛を含め規定打席を判定・並びが決まる・自球団の次の6試合と先発の左右と成績・チーム成績は移籍退団でも出場球団に残る・部分記録は既存集計を使う・能力ランキングが全球団から並ぶ・通算成績が今季を含んで積み上がる）',
);
