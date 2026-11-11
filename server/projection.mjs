import {
  withPace,
  leagueRaces,
  chronicleView,
  teamChronicle,
  koshienNoteOf,
  remainingGames,
} from './chronicle.mjs';
import { isLiveSession } from './sessions.mjs';
import { roleFor } from '../src/online/tactics.js';
import { getDeception } from '../src/game/deception.js';
import { getBatterType, BATTER_TYPE_LABEL } from '../src/game/batterType.js';
import {
  PHASE_LABELS,
  ONLINE_SCHEMA,
  CAMP_ROUNDS,
  phaseDeadlineAt,
} from '../src/online/shared.js';
import { isCurrent, migrationState } from '../src/online/leagueMigration.js';
import {
  withStarters,
  leagueLeaders,
  teamSeasonStats,
  abilityLeaders,
} from './leagueBoard.mjs';
import { packSummary, packsForMember } from '../src/online/rosterPack.js';
import {
  currentPlayerStats,
  currentSeasonStats,
  playerPeriods,
  storedGame,
  gameSummary,
  decisionRefs,
  slimGame,
  statisticsContext,
} from './recordedViews.mjs';
import { recordForPlayer } from './recordedStats.mjs';
import { requireOnline, seasonStage } from '../src/online/shared.js';
import { getAIReleaseCandidates, releaseScore } from '../src/game/contractRules.js';
import { SEASON_TURNS } from '../src/online/pyramidLeague.js';
import { ownStaffView, leagueStaffView, teamStaffView, phasePlanBy } from './coachView.mjs';
import { releaseBiasFor, campPlanFor, phaseDelegated } from './coachEngine.mjs';

/**
 * セット（24人）を**選ぶのに要る分だけ**にする。
 * ⚠ 20セット×24人＝480人。全員の全項目を載せるとビューが重くなる。
 */
const packView = (pack) => ({
  ...packSummary(pack),
  takenBy: pack.takenBy || null,
  players: pack.players.map((p) => ({
    id: p.id,
    name: p.name,
    age: p.age,
    position: p.position,
    rank: p.rank || 'C',
    isTwoWay: !!p.isTwoWay,
    batting: { meet: p.batting?.meet, power: p.batting?.power },
    physical: { speed: p.physical?.speed },
    fielding: { defense: p.fielding?.defense },
    pitching: {
      velocity: p.pitching?.velocity,
      control: p.pitching?.control,
      stamina: p.pitching?.stamina,
    },
  })),
});

const playerView = (p) => ({
  id: p.id,
  isActive: p.isActive !== false,
  name: p.name,
  age: p.age,
  condition:
    Number.isInteger(p.condition) && p.condition >= 0 && p.condition <= 4
      ? p.condition
      : null,
  position: p.position,
  number: p.number,
  fatigue: p.fatigue || 0,
  // ⚠ 名前とidや能力から決まる値は、アプリ用にここで求めて渡す（Web は手元で求める）。
  //    アプリに同じ式を書き写すと、片方だけ直したときに表示が食い違う
  deception: p.pitching ? getDeception(p) : undefined,
  batterType: p.batting ? BATTER_TYPE_LABEL[getBatterType(p)] : undefined,
  batting: p.batting,
  pitching: p.pitching,
  fielding: p.fielding,
  physical:
    p.physical &&
    Object.fromEntries(
      [
        'speed',
        'arm',
        'throws',
        'bodyStamina',
        'recovery',
        'muscle',
        'dexterity',
        'build',
      ]
        .filter((key) => p.physical[key] !== undefined)
        .map((key) => [key, p.physical[key]]),
    ),
  catching: p.catching && { lead: p.catching.lead },
  personality: p.personality && {
    discipline: p.personality.discipline,
    mental: p.personality.mental,
  },
  positionFitness: p.positionFitness,
  zoneProfile: p.zoneProfile,
  growthPotential: p.growthPotential,
  growthModifier: p.growthModifier,
  origin: {
    highSchool: p.highSchool?.name,
    university: p.universityTeamName || p.universityName,
    previousTeam: p.previousTeam,
  },
  // ⚠ **チームの経歴**。「どの年にどこへ行ったか」を選手情報に出す。
  //    長くなりすぎないよう新しい順に8件まで（入団・移籍・退団が積まれる）
  careerHistory: Array.isArray(p.careerHistory)
    ? p.careerHistory
        .slice(-8)
        .map((h) => ({ type: h.type, year: h.year, label: h.label }))
    : [],
  seasonStats: p.seasonStats,
});
const dateKey = (d) =>
  d ? (d.year || 0) * 10000 + (d.month || 0) * 100 + (d.day || 0) : Infinity;

/**
 * これからの試合。リーグ全体の直近と、自球団の直近を合わせて日付順に返す。
 *
 * ⚠ **日程の配列は日付順ではない**。`pyramidSchedule` はリーグごとに
 *    1年ぶんを並べてから次のリーグへ進むので、先頭は1部の試合で埋まる。
 *    以前は先頭から6件を取っていて、2部の球団には自球団の予定が
 *    シーズン中ずっと出なかった。
 * ⚠ 自球団の分を別に足すのは、画面の「自球団」絞り込みがこの一覧を
 *    絞るだけだから。リーグ全体の6件に自球団が無いと空になる。
 */
export function upcomingGames(schedule, ownTeam, size = 6) {
  const open = schedule
    .filter((g) => !g.result && g.home !== 'TBD' && g.away !== 'TBD')
    .sort((a, b) => dateKey(a.date) - dateKey(b.date) || a.id - b.id);
  const league = open.slice(0, size);
  const own = open
    .filter((g) => g.home === ownTeam || g.away === ownTeam)
    .slice(0, size);
  const ids = new Set(league.map((g) => g.id));
  return [...league, ...own.filter((g) => !ids.has(g.id))]
    .sort((a, b) => dateKey(a.date) - dateKey(b.date) || a.id - b.id)
    .map((g) => ({ id: g.id, date: g.date, home: g.home, away: g.away }));
}

/**
 * 自球団のこれからの試合を、近い順に。ホームの「今後の6試合」に使う。
 * 試合には**その球団の何試合目か**（`number`）を添える。
 *
 * ⚠ **自球団だけ**。リーグ全体の一覧は `upcomingGames`（試合結果の画面が使う）。
 * ⚠ 相手の決まっていない試合（`TBD`）は出さない。プレーオフの決勝は準決勝が
 *    終わるまで `TBD` で置かれる。
 */
export function ownUpcomingGames(schedule, ownTeam, size = 6) {
  // ⚠ **その球団の何試合目かを数える**。日付はゲーム内の暦で、1ターン＝1日の
  //    うえ休養日が飛ぶので、「4/18」と言われても何試合目かが読めない。
  //    消化済みも含めて日付順に並べ、その位置を番号にする。
  const own = schedule
    .filter(
      (g) =>
        g.date &&
        g.home !== 'TBD' &&
        g.away !== 'TBD' &&
        (g.home === ownTeam || g.away === ownTeam),
    )
    .sort((a, b) => dateKey(a.date) - dateKey(b.date) || a.id - b.id);
  const upcoming = [];
  own.forEach((g, i) => {
    if (g.result) return;
    upcoming.push({
      id: g.id,
      date: g.date,
      // 1始まり。消化済みを含めた通し番号
      number: i + 1,
      home: g.home,
      away: g.away,
    });
  });
  return upcoming.slice(0, size);
}

/**
 * 球団ごとの今の連続（`{ 球団: { kind: 'W'|'L'|'D', count } }`）。今季の公式日程の終わった試合から数える。
 * ⚠ 日程は日付順とは限らないので並べ直す（`ownRecentGames` と同じ並べ方）
 */
export function teamStreaks(schedule) {
  const played = (schedule || [])
    .filter((g) => g.date && g.result && g.home !== 'TBD' && g.away !== 'TBD')
    .sort((a, b) => dateKey(a.date) - dateKey(b.date) || a.id - b.id);
  const streaks = {};
  for (const g of played) {
    const { homeScore: h, awayScore: a } = g.result;
    for (const [team, mine, theirs] of [
      [g.home, h, a],
      [g.away, a, h],
    ]) {
      const kind = mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
      const now = streaks[team];
      streaks[team] =
        now?.kind === kind ? { kind, count: now.count + 1 } : { kind, count: 1 };
    }
  }
  return streaks;
}

/**
 * 自球団の**直近の試合**（新しい順ではなく**古い順**で返す。画面が上から並べる）。
 *
 * ⚠ リーグ全体の `results`（直近14試合）では足りない。12球団は毎ターン6試合
 *    するので、14試合では自球団は2〜3試合しか入らない。
 * ⚠ 通し番号の数え方は `ownUpcomingGames` と**同じ**にすること。片方だけ
 *    数え方を変えると、同じ試合が画面の左右で違う番号になる。
 */
export function ownRecentGames(schedule, ownTeam, size = 5) {
  const own = schedule
    .filter(
      (g) =>
        g.date &&
        g.home !== 'TBD' &&
        g.away !== 'TBD' &&
        (g.home === ownTeam || g.away === ownTeam),
    )
    .sort((a, b) => dateKey(a.date) - dateKey(b.date) || a.id - b.id);
  const played = [];
  own.forEach((g, i) => {
    if (!g.result) return;
    played.push({
      id: g.id,
      date: g.date,
      number: i + 1,
      home: g.home,
      away: g.away,
      homeScore: g.result.homeScore,
      awayScore: g.result.awayScore,
    });
  });
  return played.slice(-size);
}

export function projectLineup(team) {
  return {
    battingOrder: (team.lineupSettings?.battingOrder || []).filter(
      (e) => e.position !== 'pitcher',
    ),
    starters: team.pitchingRotation?.starters || [],
    strategy: team.strategy || {},
    ...(team.pitchingRotation?.pitcherRoles ||
    team.pitchingRotation?.closer ||
    team.pitchingRotation?.setupMen?.length ||
    team.pitchingRotation?.middleRelievers?.length
      ? {
          // ⚠ 野手は投手起用に加えた選手だけ（先発ローテか、役割を保存した野手。二刀流）。
          //    全員を載せると、画面が全野手を投手起用に入っているものとして読む
          pitcherRoles: Object.fromEntries(
            team.players
              .filter(
                (p) =>
                  p.isActive !== false &&
                  (p.position === 'pitcher' ||
                    team.pitchingRotation.starters?.includes(p.id) ||
                    Object.hasOwn(
                      team.pitchingRotation.pitcherRoles || {},
                      String(p.id),
                    )),
              )
              .map((p) => [
                p.id,
                roleFor(
                  team.pitchingRotation.pitcherRoles?.[p.id] ??
                    (team.pitchingRotation.closer === p.id
                      ? 'closer'
                      : team.pitchingRotation.setupMen?.includes(p.id)
                        ? 'setup'
                        : team.pitchingRotation.middleRelievers?.includes(p.id)
                          ? 'long'
                          : undefined),
                  team.pitchingRotation.starters?.includes(p.id),
                ),
              ]),
          ),
        }
      : {}),
    ...(team.onlineTactics ? { tactics: team.onlineTactics } : {}),
  };
}
/**
 * 途中参加した人の球団が、選んだセットで始まる時刻（＝キャンプの締め切り。月曜0時の開幕）。
 * 名簿の入れ替えはキャンプの終わり（`applyPendingPacks`）なので、キャンプの最中なら
 * その締め切り、まだなら次のキャンプの締め切りの見込み。分からなければ null。
 *
 * ⚠ 画面に「次の日曜」と書くだけだと、日曜のキャンプ中に参加した人には
 *    今日なのか来週なのか分からなかった（いしだ指摘: 決めた後に何が起きるか
 *    分からず、画面が止まって見えた）。日時で出すためにここで決める。
 */
function packJoinsAt(l) {
  if (l.phase?.kind === 'camp') return l.phase.deadline || null;
  const base = l.phase?.deadline || l.nextAdvanceAt;
  if (!base) return null;
  try {
    return phaseDeadlineAt('camp', base);
  } catch {
    return null;
  }
}
const pendingPackAuto = (phase, member) =>
  !!phase && !!member.packSeed && phase.kind !== 'pack_select';
export function projectLeague(bundle, userId, sessionId, adminId) {
  const l = bundle.league;
  if (!l) return { setupRequired: true, isAdmin: userId === adminId };
  // ⚠ **古い形のまま投影しない**。ビューには最新の版の印を押すので、
  //    中身が古いまま投影すると「新しい形です」と嘘をつくことになる。
  //    移行できる場合は画面から取り込めるので、それも伝える。
  if (!isCurrent(l)) {
    const info = migrationState(l);
    return {
      versionMismatch: true,
      isAdmin: userId === adminId,
      canMigrate: info.state === 'migratable',
      reason: info.reason || null,
      writable: isLiveSession(bundle.sessions, userId, sessionId),
    };
  }
  const member = l.members.find((m) => m.userId === userId);
  // ⚠ **参加者でなくても「招待コードを入れる画面」までは返すこと**。
  //    ここで null（＝403）にすると、招待された人はログインした途端に
  //    締め出され、コードを入れる場所に辿り着けない（鶏と卵になる）。
  if (!member)
    return {
      joinRequired: true,
      isAdmin: userId === adminId,
      revision: l.revision,
      writable: isLiveSession(bundle.sessions, userId, sessionId),
    };
  const team = l.game.teams[member.teamName];
  const statistics = statisticsContext(l);
  // ⚠ **表示名は内部名と別に持つ**。参加した人が付けた球団名を画面に出すため。
  //    内部名（`teamName` / 順位表 / 日程）は記録の選手キーまで貫いているので
  //    変えられない。表示のときだけこの表で引く。
  // ⚠ 略称は**名前を付け替えたときだけ**表示名の頭3文字にする。参加すると表示名は
  //    既定の名前（内部名と同じ）でも必ず入るので、`displayName` の有無で分けると
  //    名前を付けずに入った球団まで「新潟ブ」のようになっていた（再監査 F16）
  const teamLabels = Object.fromEntries(
    (l.teams || []).map((t) => [
      t.name,
      {
        label: t.displayName || t.name,
        short:
          t.displayName && t.displayName !== t.name
            ? [...t.displayName].slice(0, 3).join('')
            : t.abbreviation || t.name,
      },
    ]),
  );
  const labelOf = (name) => teamLabels[name]?.label || name;
  // ⚠ 成績の引き当ては**1回だけ**。12球団×24人＝288人を、ベスト5と
  //    チーム打率・チーム防御率で別々に引くと、同じ計算を2度する
  const seasonStatsCache = new Map();
  const seasonStatsOf = (teamName, player) => {
    if (!seasonStatsCache.has(player.id))
      seasonStatsCache.set(
        player.id,
        currentSeasonStats(l, teamName, player, statistics),
      );
    return seasonStatsCache.get(player.id);
  };
  const phase = l.phase;
  // 球団ごとのレギュラーシーズンの残り試合（ペースとマジックで共用。日程を2回なめない）
  const left = remainingGames(l.season.schedule);
  return {
    // ⚠ **このビューを作ったコードの版**。`LeagueService.view` がここを見て、
    //    古い形のリーグを表示させない。ビューは保存済みのものがそのまま
    //    返ることがあり（`SupabaseStore.readView`）、その経路はリーグ本体を
    //    読まないので `assertLeagueVersion` が一度も走らない。実際、
    //    固定4球団の頃のリーグが2部制のコードで**そのまま表示された**。
    schema: ONLINE_SCHEMA,
    revision: l.revision,
    status: l.status,
    error: l.error,
    teamName: member.teamName,
    year: l.season.year,
    lastCamp: l.campResults?.[userId] || null,
    // 年度更新の伸び・衰えと引退（`offseasonChanges`）。次の年度更新まで残る
    lastOffseason: l.offseasonResults?.[userId] || null,
    // いまの段階（1年の流れの帯）。`seasonStage` の説明を参照
    stage: seasonStage({
      phaseKind: phase?.kind,
      regularLeft: l.season.schedule.some(
        (g) => g.phase === 'regular_season' && !g.result,
      ),
      regularPlayed: l.season.schedule.some(
        (g) => g.phase === 'regular_season' && g.result,
      ),
      date: l.season.currentDate,
    }),
    teamNames: l.season.settings.teamNames,
    // ⚠ 一人用の編成画面が `LEAGUE_SETTINGS.useDH` を見るので、
    //    リーグの設定をビューにも載せる（打順が8枠か9枠かが変わる）
    useDH: !!l.season.settings.useDH,
    currentDate: l.season.currentDate,
    // ⚠ **シーズンのターン数はビューに載せる**。画面が `SEASON_TURNS` を直に
    //    読むと、進行中のリーグ（組んだ日程は120ターン）に新しい総数を
    //    当ててしまい「第121ターン / 160」と日程に無い数が出る
    seasonTurns: l.season.settings.seasonTurns || SEASON_TURNS,
    nextAdvanceAt: l.nextAdvanceAt,
    isAdmin: userId === adminId,
    writable: isLiveSession(bundle.sessions, userId, sessionId),
    hasBackup: !!bundle.backup,
    // ⚠ 締め切りはビューに載せる。定期進行の判定（`isDue`）がこれを見て、
    //    フェーズ中（status が running でない）でも起動する必要がある
    phaseDeadline: l.phase?.deadline || null,
    // ⚠ 検証モード。管理画面に手動進行のボタンを出すかの判断に使う
    testMode: l.testMode === true,
    teamLabels,
    // 球団ごとの所属リーグ（'A'＝1部、'B'＝2部）。順位表を部ごとに分けるため。
    // ⚠ 順位表（`standings`）は全12球団を通した並びなので、そのままだと
    //    1部と2部が混ざって見える。
    teamLeagues: Object.fromEntries(
      (l.teams || []).map((t) => [t.name, t.league]),
    ),
    // 人が持っている球団 → その人の呼び名。順位表に括弧で添える。
    // ⚠ CPUは載せない（誰かが持っているように見える）。
    // ⚠ 呼び名が球団名と同じときも載せない。参加時の既定が球団名なので、
    //    そのままだと「湘南サンズ（湘南サンズ）」と2回並ぶ
    teamOwners: Object.fromEntries(
      (l.members || []).map((m) => [
        m.teamName,
        m.label && m.label !== labelOf(m.teamName) ? m.label : '',
      ]),
    ),
    members: l.members.map((m) => ({
      label: m.label,
      teamName: m.teamName,
      // ⚠ 自チーム情報の画面が「いまの球団名」を出すのに使う
      displayName: m.displayName || teamLabels[m.teamName]?.label || m.teamName,
      ready:
        !!phase?.submissions[m.userId]?.ready ||
        pendingPackAuto(phase, m) ||
        phaseDelegated(l, m),
      // ⚠ 途中参加でセットを待っている人の球団は、キャンプまでCPUが決める
      //    （手続きはこの人の決定を待たない。`leagueEngine` の `waitsFor`）
      ...(pendingPackAuto(phase, m) && !phase?.submissions[m.userId]?.ready
        ? { cpu: true }
        : {}),
      // ⚠ 手続きを指導者に任せた球団も待たない（`waitsFor`）。一覧に「指導者に任せています」と出す
      ...(phaseDelegated(l, m) ? { delegated: true } : {}),
    })),
    standings: l.season.standings,
    // 球団ごとの今の連勝・連敗（全国紙の「○○、5連勝」）。引き分けは続きを切る
    teamStreaks: teamStreaks(l.season.schedule),
    // ⚠ 各項目の上位10人（Web は5人まで出す）。12球団×24人をなめるので**1回の投影で1度だけ**作る
    // ⚠ 数える項目の上位には「このままなら年間○」（`pace`）を添える
    leaders: withPace(leagueLeaders(l, seasonStatsOf, labelOf), l, left),
    // 優勝・昇格・残留のマジックと決定（部ごと）。手続きの時期も決着は残す
    races: leagueRaces(l, left),
    // 節目の記録・引退・裏の大会（リーグ全体の最近のもの）
    chronicle: chronicleView(l),
    // 記録完備時は出場当時の球団に集計する。旧・部分記録の控えには同じ個人成績を使う。
    teamStats: teamSeasonStats(l, seasonStatsOf),
    // ⚠ 能力ランキングは**リーグ全球団**の中で並べる。画面は自球団の名簿しか
    //    持っていないので、並べ替えはここで済ませて渡す
    abilityLeaders: abilityLeaders(l, labelOf),
    results: l.season.results.slice(-14).map((g) => ({
      gameId: g.gameId,
      date: g.date,
      home: g.home,
      away: g.away,
      homeScore: g.result.homeScore,
      awayScore: g.result.awayScore,
      decisions: decisionRefs(g.result.decisions),
    })),
    // ⚠ ホームに出す**自球団の次の6試合**。リーグ全体の一覧（`upcoming`）とは
    //    別物。試合結果の画面はリーグ全体を使うので、そちらを絞らないこと。
    //    ⚠ ここだけ `seasonStatsOf` を渡して、先発予定に投げる手と今季成績を
    //       重ねる（`upcoming` は名前だけでよい）
    nextGames: withStarters(
      ownUpcomingGames(l.season.schedule, member.teamName, 5),
      l.game.teams,
      seasonStatsOf,
    ),
    // ⚠ ホームの左に出す**自球団の直近5試合**。リーグ全体の `results`（14件）では
    //    12球団ぶんが混ざって自球団が2〜3試合しか入らない
    recentGames: ownRecentGames(l.season.schedule, member.teamName, 5),
    // ⚠ 並べ方は `upcomingGames` が正本（日付順・自球団を必ず含む）。
    //    先発予定はその上に重ねるだけにする
    upcoming: withStarters(
      upcomingGames(l.season.schedule, member.teamName),
      l.game.teams,
    ),
    roster: team.players.map((p) => ({
      ...playerView(p),
      ...currentPlayerStats(l, member.teamName, p, statistics),
      detailAvailable: true,
    })),
    seasonYears: [
      ...new Set([
        l.season.year,
        ...Object.keys(l.records?.seasons || {}).map(Number),
        ...l.history.map((h) => h.year),
      ]),
    ].sort((a, b) => b - a),
    gameDetailsAvailable: true,
    lineup: projectLineup(team),
    nextStarterId: team.pitchingRotation?.starters?.length
      ? team.pitchingRotation.starters[
          (team.pitchingRotation.currentStarterIndex || 0) %
            team.pitchingRotation.starters.length
        ]
      : null,
    phase: phase
      ? {
          id: phase.id,
          kind: phase.kind,
          label: PHASE_LABELS[phase.kind],
          // ⚠ 締め切りの有無で画面の文面が変わる
          deadline: phase.deadline || null,
          packs: l.packs?.map(packView),
          // ⚠ 甲子園で名を上げた人には、その年の成績を添える（`koshien`）
          candidates: phase.candidates?.map((c) => {
            const view = playerView(c);
            const note = koshienNoteOf(l, c.id);
            return note ? { ...view, koshien: note } : view;
          }),
          // ⚠ 契約更改: 標準案（決めなかったときの案）で誰が・なぜ退団になるか。
          //    PC・スマホ・アプリが同じ理由を出すよう、サーバーで1回だけ作る
          //    （選び方そのもの `getAIReleaseCandidates` / `releaseScore` から）
          // ⚠ 指導者の考え（監督の時間軸）を、標準案と同じく当てる（`releaseBiasFor`）
          releaseAdvice:
            phase.kind === 'contract'
              ? Object.fromEntries(
                  getAIReleaseCandidates(
                    team.players,
                    releaseBiasFor(l, member.teamName),
                  ).map((id) => [
                    id,
                    releaseScore(team.players.find((p) => p.id === id)).reasons,
                  ]),
                )
              : undefined,
          // 標準案を出した人（「山田監督の案」）と、任せているか。手続きの画面の見出しに出す
          planBy: phasePlanBy(l, member.teamName, phase.kind),
          // ⚠ この手続きを指導者に任せているか。任せた手続きはこの人の決定を待たない
          //    （`leagueEngine` の `waitsFor`）ので、「決めてください」の知らせを出さない（`notices.js`）。
          //    `planBy` は案を出す人が居ないと null になるので、これとは別に渡す
          delegated: phaseDelegated(l, member),
          submission: phase.submissions[userId] || null,
          // ⚠ キャンプは1クールずつ自分で実行する。どこまで終わったかを渡す
          //    （渡さないと、押すたびに「第1クール」のままに見える）
          camp:
            phase.kind === 'camp'
              ? {
                  rounds: phase.camp?.[userId]?.rounds || 0,
                  total: CAMP_ROUNDS,
                  plan: phase.camp?.[userId]?.plan || null,
                  // ⚠ **指導者の案（「意見を聞く」「任せる」のとき）**。まだクールを回して
                  //    いなければ、画面の下書きをこの案から始める。締め切りで回さなかった
                  //    クールに当たるのもこの案（`defaultPhasePlan` の camp）なので、
                  //    出さないと「おすすめ」を見ていたのに見たことのない案で回る
                  suggested: phase.camp?.[userId]?.plan
                    ? null
                    : campPlanFor(l, member.teamName, team.players),
                  // ⚠ 伸びた能力（このクール・通算）。画面のまとめに使う
                  last: phase.camp?.[userId]?.last || null,
                  gains: phase.camp?.[userId]?.gains || {},
                  events: phase.camp?.[userId]?.events || {},
                }
              : null,
        }
      : null,
    // ⚠ **途中参加した人の初期メンバー選択**。リーグ全体の手続きではなく、
    //    その人だけのもの。選んだセットは**次のキャンプ**で名簿に入る。
    //    セットは種から作り直す（20セット×24人を保存に抱えないため）。
    pendingPack: member.packSeed
      ? {
          chosen: member.pendingPackId || null,
          packs: packsForMember(member).map(packView),
          joinsAt: packJoinsAt(l),
          // キャンプの最中か（締め切りが決まっている）。でなければ joinsAt は見込み
          joinsInCamp: l.phase?.kind === 'camp',
        }
      : null,
    // ⚠ **自分が当事者のものだけ**渡す。他人同士の交渉が見えると、
    //    誰が誰を欲しがっているかが筒抜けになる
    trades: (l.trades || [])
      .filter((t) => t.from === userId || t.to === userId)
      .map((t) => ({
        id: t.id,
        mine: t.from === userId,
        fromTeam: t.fromTeam,
        toTeam: t.toTeam,
        // ⚠ 名前と守備位置まで渡す。idだけだと、相手の選手が画面で引けない
        offer: tradePlayers(l, t.fromTeam, t.offer),
        want: tradePlayers(l, t.toTeam, t.want),
        myTurn: (t.turn === 'to' ? t.to : t.from) === userId,
        countered: !!t.countered,
        canCounter: t.turn === 'to' && !t.countered && t.to === userId,
        updatedAt: t.updatedAt,
      })),
    history: l.history,
    notices: l.notices.slice(0, 4),
    // 指導者（監督・投手コーチ・野手コーチ）と任せ方・采配の内訳（`coachView.mjs`）
    staff: ownStaffView(l, member, team, labelOf),
    // リーグ全球団の指導者の顔ぶれと、最近の人事
    leagueStaff: leagueStaffView(l, labelOf),
  };
}

/** トレードに出ている選手を、画面に出すぶんだけ */
function tradePlayers(league, teamName, ids) {
  const players = league.game.teams[teamName]?.players || [];
  return (ids || []).map((id) => {
    const player = players.find((p) => p.id === id);
    // ⚠ 居ない選手（別のトレードで移った）も**消さずに出す**。黙って減ると
    //    「出したはずの選手が提案から消えた」ように見える
    return player
      ? {
          id,
          name: player.name,
          age: player.age,
          position: player.position,
          gone: false,
        }
      : { id, name: '（移籍済み）', position: null, gone: true };
  });
}

// 参加者向けに、確定済み名簿・今季成績・能力だけを公開する。
// 編成、次回先発、戦術、契約、未提出案や成長の内部値を含めない。
export function projectTeamInfo(bundle, userId, teamName) {
  const l = bundle.league;
  requireOnline(
    l?.members.some((m) => m.userId === userId),
    '参加者ではありません',
    403,
  );
  requireOnline(
    l.season.settings.teamNames.includes(teamName),
    '球団が見つかりません',
    404,
  );
  const statistics = statisticsContext(l);
  const activeKeys = new Set(
    l.game.teams[teamName].players.map((p) => p.onlinePlayerId).filter(Boolean),
  );
  const labelOf = (name) =>
    (l.teams || []).find((t) => t.name === name)?.displayName || name;
  return {
    teamName,
    readOnly: true,
    year: l.season.year,
    // 指導者（カード・CPU球団なら采配の内訳）。⚠ 人の球団の采配は出さない（`teamStaffView`）
    staff: teamStaffView(l, teamName, l.game.teams[teamName], labelOf),
    // 球団史（年表）・歴代記録・引退・節目。記録からさかのぼって作る
    chronicle: teamChronicle(l, teamName, activeKeys),
    roster: l.game.teams[teamName].players.map((p) => {
      const visible = playerView(p);
      delete visible.growthPotential;
      delete visible.growthModifier;
      return {
        ...visible,
        ...currentPlayerStats(l, teamName, p, statistics),
        // ⚠ **他球団の選手も、過去の年と通算を出すこと**。以前は今季しか
        //    載せていなかったので、CPU球団の選手を開くと「成績が残っていない」
        //    ように見えた（記録はサーバーに揃っている）。通算成績の一覧も
        //    ここから読む（同じ数字を2通り持たない）。
        // ⚠ 場面別（`splits`）は**外す**。打者×投手の組み合わせで大きく、
        //    12球団ぶんを索引に積むと実測2.5MB（外せば0.8MB）。今季のぶんは
        //    下の `publicSplits` に別に載せてあり、画面が今季の期間へ重ねる。
        periods: playerPeriods(l, teamName, p, statistics).map(
          // eslint-disable-next-line no-unused-vars
          ({ splits, ...rest }) => rest,
        ),
        publicOnly: true,
        publicSplits: recordForPlayer(l, p, teamName)?.splits || null,
        publicPartial: !!statistics.season && !statistics.season.complete,
        publicSource: statistics.season?.complete
          ? '対人リーグ（プレーオフ込み・グランドCS除外）'
          : '今季の成績（記録を取り始める前を含む。場面別は取り始めた後だけ）',
      };
    }),
  };
}

function ownedPlayer(bundle, userId, id) {
  const l = bundle.league,
    member = l?.members.find((m) => m.userId === userId);
  requireOnline(member, '参加者ではありません', 403);
  const player = l.game.teams[member.teamName].players.find(
    (p) => String(p.id) === String(id),
  );
  requireOnline(player, '選手が見つかりません', 404);
  return { l, member, player };
}
export function projectPlayerInfo(bundle, userId, id, context) {
  const { l, member, player } = ownedPlayer(bundle, userId, id);
  return {
    id: player.id,
    name: player.name,
    revision: l.revision,
    periods: playerPeriods(
      l,
      member.teamName,
      player,
      context || statisticsContext(l),
    ),
  };
}
/** 試合一覧の1ページの数（画面の既定） */
const GAMES_PAGE = 6;
/**
 * 1回で返せる数の上限。⚠ アプリのホームは連勝・対戦成績のために自球団の今季の試合を読むが、
 *    6試合ずつ最大8回に分けて順に読んでおり、紙面が出るまで待たされた。1シーズン（自球団）が入る数にする
 */
const GAMES_PAGE_MAX = 200;
export function projectGames(
  bundle,
  userId,
  { year, page = 0, scope = 'own', size = GAMES_PAGE } = {},
) {
  const l = bundle.league,
    member = l?.members.find((m) => m.userId === userId);
  requireOnline(member, '参加者ではありません', 403);
  year = Number(year || l.season.year);
  page = Number(page);
  size = Number(size);
  requireOnline(
    Number.isSafeInteger(year) &&
      year > 0 &&
      Number.isSafeInteger(page) &&
      page >= 0 &&
      Number.isSafeInteger(size) &&
      size >= 1 &&
      size <= GAMES_PAGE_MAX &&
      ['own', 'league'].includes(scope),
    '試合一覧の指定が不正です',
  );
  const games = new Map();
  if (year === l.season.year)
    for (const game of l.season.results)
      games.set(String(game.gameId), gameSummary(game));
  for (const game of Object.values(l.records?.seasons?.[year]?.games || {}))
    games.set(String(game.gameId), gameSummary(game));
  const all = [...games.values()]
    .filter(
      (g) =>
        scope === 'league' ||
        g.home === member.teamName ||
        g.away === member.teamName,
    )
    .sort(
      (a, b) =>
        b.date.month - a.date.month ||
        b.date.day - a.date.day ||
        b.gameId - a.gameId,
    );
  return {
    year,
    page,
    count: all.length,
    size,
    games: all.slice(page * size, page * size + size),
  };
}
export function projectGameInfo(bundle, userId, id, year) {
  const l = bundle.league;
  requireOnline(
    l?.members.some((m) => m.userId === userId),
    '参加者ではありません',
    403,
  );
  requireOnline(
    Number.isSafeInteger(Number(id)) && Number(id) > 0,
    '試合の指定が不正です',
  );
  year = Number(year || l.season.year);
  requireOnline(Number.isSafeInteger(year) && year > 0, '年度の指定が不正です');
  const game = storedGame(l, id, year);
  requireOnline(game, '試合記録が見つかりません', 404);
  const result = structuredClone(slimGame(game));
  if (result.replay?.appliedPlans) {
    const ownTeam = l.members.find((m) => m.userId === userId).teamName;
    result.replay.appliedPlan = result.replay.appliedPlans[ownTeam] || null;
    result.replay.appliedTeam = ownTeam;
    delete result.replay.appliedPlans;
  }
  return result;
}
