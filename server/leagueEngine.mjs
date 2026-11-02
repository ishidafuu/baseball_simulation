import './engine-bootstrap.mjs';
import { schedulePlayoffReplay } from './playoffReplay.mjs';
import {
  TEAMS_DATA,
  LEAGUE_SETTINGS,
  initializeTeamsForCount,
  initializeAllPitchingRotations,
  releasedPlayersPool,
} from '../src/teams-data.js';
import { WORLD_DATA } from '../src/corporate/worldData.js';
import { INDEPENDENT_LEAGUES } from '../src/corporate/independentLeagueData.js';
import {
  initializeParallelWorldForIndependent,
  ensureUserIndependentLeagueTagged,
  applyIndependentRank,
  getLeagueRankFromTeams,
  updateAllTeamReputations,
} from '../src/corporate/corporateInit.js';
import {
  createSeasonData,
  initializeStandings,
  SEASON_PHASES,
  getNPBDraftDay,
  getPlayoffChampion,
} from '../src/season/seasonManager.js';
import {
  generateFullSeasonSchedule,
  getScheduleByDate,
} from '../src/season/scheduleGenerator.js';
import {
  progressDate,
  handlePhaseTransition,
} from '../src/season/dateProgression.js';
import {
  generateTryoutCandidates,
  generateSnakeDraftOrder,
  selectPlayerForAI,
  updateReleasedPoolAfterTryout,
  removeDraftedFromClubTeams,
} from '../src/season/tryoutSystem.js';
import { removeDraftedFromGraduatePools } from '../src/season/universityPool.js';
import {
  generateAprilHighSchoolClass,
  processSeasonEnd,
  snapshotRankings,
  advanceToNextYear,
  finalizePlayerSeason,
  cleanupPlayerReferences,
} from '../src/season/yearProgressionSystem.js';
import { processNPBDraft } from '../src/season/npbDraft.js';
import { simulateKoshien } from '../src/season/koshien.js';
import {
  simulateParallelWorldDate,
  generateGrandChampionship,
  autoPlayGrandChampionship,
} from '../src/corporate/parallelWorldManager.js';
import {
  generateBackgroundTournaments,
  advanceBackgroundTournaments,
} from '../src/game/backgroundProgression.js';
import { generatePitchingRotation } from '../src/game/lineupGenerator.js';
import { setRecommendedLineup } from '../src/game/autoSimulation.js';
import { prepareDailyLineup } from './dailyLineup.mjs';
import { initializeAllPlayersCondition } from '../src/game/condition.js';
import { simulateScheduledGamesOnDate } from '../src/game/daySimulation.js';
import { hashSeed, withSeededRandom } from '../src/game/rng.js';
import {
  assignTeamControllers,
  humanTeamNames,
} from '../src/game/teamControl.js';
import { getAIReleaseCandidates } from '../src/game/contractRules.js';
import {
  executeTeamCampTraining,
  applyMotivationEffect,
  applyBatteryMentalEffect,
} from '../src/season/campTraining.js';
import {
  getTeamStaffBonus,
  setStaffIdCounter,
  setStaffNameHistory,
} from '../src/corporate/staffData.js';
import { addToReleasedPool } from '../src/state/pools.js';
import { setPlayerIdCounter } from '../src/state/playerIds.js';
import { captureWorld, restoreWorld } from './worldSnapshot.mjs';
import { createRecorder, freezeComparison } from './recordedStats.mjs';
import {
  ONLINE_SCHEMA,
  ONLINE_ENGINE_VERSION,
  assertLeagueVersion,
  nextProgressionAt,
  phaseDeadlineAt,
  seasonStartAt,
  requireOnline,
} from '../src/online/shared.js';
import {
  generatePyramidTeams,
  pyramidSeasonSchedule,
  applyPyramidMovements,
  topTierTeamNames,
  PYRAMID_TEAM_COUNT,
  SEASON_TURNS,
  gamesPerTeam,
} from '../src/online/pyramidLeague.js';
import {
  assertMemberCount,
  assignmentOrder,
} from '../src/online/membership.js';
import { nextFromPlan } from '../src/online/tryoutPlan.js';

export const ENGINE_VERSION = ONLINE_ENGINE_VERSION;
export const CAMP_MENUS = [
  'batting',
  'baserunning',
  'fielding',
  'control',
  'velocity',
  'intensive_power',
  'intensive_meet',
  'intensive_speed',
  'intensive_control',
  'intensive_velocity',
  'intensive_defense',
  'intensive_eye',
];
const clone = (value) => JSON.parse(JSON.stringify(value));
const quiet = (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
};
const seeded = (league, key, fn) =>
  quiet(() =>
    withSeededRandom(
      hashSeed(`${league.seed}:${league.season.year}:${key}`),
      fn,
    ),
  );

// ⚠ **`generateFullSeasonSchedule` は使えない**。`leagueFormat` が
//    `'single'` か `'two'` の2通りしか対応しておらず、7リーグを組めない
//    （実装を読んで確認した）。階層リーグの日程は `pyramidSeasonSchedule`
//    （1ターン＝1日＝全球団が1試合）で組む。
// ⚠ 順位表は**平たい配列のまま**でよい。更新は球団名で行われるので、
//    リーグ分けは表示と昇降格のときだけ見ればよい。
function createSchedule(season, teams) {
  // ⚠ **渡し忘れを黙って通さない**。以前は undefined が渡ると
  //    `pyramidSchedule` の中で「undefined の filter」で落ち、
  //    どこの呼び出しが悪いのか分からなかった。
  requireOnline(
    Array.isArray(teams) && teams.length > 0,
    '日程を組むには球団表が必要です',
  );
  season.schedule = pyramidSeasonSchedule(teams, {
    year: season.currentDate.year,
  });
  season.standings = initializeStandings(season.settings.teamNames);
}

function openPhase(league, kind, now) {
  // ⚠ **締め切りを持たせること**。待ち続ける設計だと、1人が決めないだけで
  //    全員の週が止まる。締め切りが曜日合わせも兼ねている
  //    （土曜＝ストーブリーグ／日曜＝キャンプ／月曜＝開幕）。
  const phase = {
    id: `${league.season.year}:${kind}`,
    kind,
    deadline: now ? phaseDeadlineAt(kind, now) : null,
    submissions: {},
  };
  if (kind === 'initial_tryout' || kind === 'tryout') {
    const names = league.season.settings.teamNames;
    const rank = getLeagueRankFromTeams(names) || 'B';
    const reputation =
      names.reduce(
        (n, name) => n + (TEAMS_DATA[name].developmentReputation || 0),
        0,
      ) / names.length;
    phase.candidates = generateTryoutCandidates(
      league.season.year,
      // ⚠ **球団数を渡すこと**。以前は 4 が直に書かれており、
      //    42球団にすると候補が足りず名簿を埋められない
      names.length,
      kind === 'initial_tryout',
      rank,
      reputation,
    );
  }
  league.phase = phase;
  league.status = 'waiting';
  league.nextAdvanceAt = null;
  league.season.pendingPhaseEvent = kind;
}

export function createLeague({
  seed = 20261028,
  members,
  now = new Date().toISOString(),
}) {
  // ⚠ 人数は1〜42。0人は拒む（誰も居ないと停止も再開もできない）
  assertMemberCount(members);
  // ⚠ 42球団は seed から生成する。同じ seed なら必ず同じ世界になる
  const defs = generatePyramidTeams(seed);
  const names = defs.map((t) => t.name);
  // ⚠ 参加者は**下の階層から**割り当てる
  const order = assignmentOrder(defs);
  const league = {
    schema: ONLINE_SCHEMA,
    engineVersion: ENGINE_VERSION,
    id: 'pennant',
    seed,
    revision: 1,
    status: 'waiting',
    createdAt: now,
    updatedAt: now,
    nextAdvanceAt: null,
    // ⚠ 検証モード。ONの間だけ管理者が手で進められる。**既定はOFF**
    //    （管理者が好きな時に進められるのは多人数の対戦として公平ではない）
    testMode: false,
    // 階層リーグの球団表。参加者の割り当てと昇降格でこれを見る
    teams: defs,
    members: members.map((m, i) => ({
      userId: m.userId,
      label: m.label || `プレイヤー${i + 1}`,
      teamName: order[i].name,
    })),
    history: [],
    notices: [],
  };
  const season = createSeasonData(1);
  season.settings = {
    ...season.settings,
    teamNames: names,
    teamsCount: PYRAMID_TEAM_COUNT,
    preset: 'pyramid',
    // ⚠ 休養日のぶん試合数はターン数より少ない（規定打席などの基準になる）
    gamesPerSeason: gamesPerTeam(),
    leagueFormat: 'single',
    playoffFormat: 'short',
    useDH: false,
  };
  league.season = season;
  seeded(league, 'create', () => {
    setPlayerIdCounter(0);
    setStaffIdCounter(5000);
    setStaffNameHistory([]);
    initializeTeamsForCount(
      PYRAMID_TEAM_COUNT,
      names,
      defs.map((t) => t.abbreviation),
    );
    LEAGUE_SETTINGS.useDH = false;
    initializeParallelWorldForIndependent('shikoku', names);
    ensureUserIndependentLeagueTagged(names, 'shikoku');
    // ⚠ **生成した球団の格付けを当て直すこと**。上の関数はプリセット定義と
    //    名前で照合するので、その場で作った球団名は全部 'D'（最弱）になる。
    //    初期トライアウトの候補の質はこの格付けで決まるため、リーグ全体の
    //    選手が弱くなっていた（実測でミート43.9→36.8、制球44.5→36.6）。
    for (const def of defs)
      applyIndependentRank(def.name, def.rank, 'pyramid');
    assignTeamControllers(
      TEAMS_DATA,
      league.members.map((m) => m.teamName),
    );
    generateAprilHighSchoolClass(1);
    season._highSchoolGenerated = true;
    createSchedule(season, defs);
    openPhase(league, 'initial_tryout', now);
  });
  league.game = captureWorld();
  return league;
}

// `take`: 写しを複製せずに渡す（`restoreWorld` の説明を参照）。最後に
// `league.game = captureWorld()` で差し替える呼び出しだけが使ってよい。
export function loadLeagueWorld(league, { take = false } = {}) {
  assertLeagueVersion(league);
  restoreWorld(league.game, { take });
  assignTeamControllers(
    TEAMS_DATA,
    league.members.map((m) => m.teamName),
  );
}

export function defaultPhasePlan(league, teamName) {
  const team = league.game.teams[teamName];
  const kind = league.phase.kind;
  if (kind === 'contract')
    return { releaseIds: getAIReleaseCandidates(team.players) };
  if (kind === 'camp') return { menu: 'standard' };
  if (kind === 'offseason') return {};
  return seeded(league, `default:${league.phase.id}:${teamName}`, () => {
    const pool = clone(league.phase.candidates);
    const roster = clone(team.players);
    const rankedIds = [];
    while (pool.length) {
      const player = selectPlayerForAI(pool, roster) || pool[0];
      rankedIds.push(player.id);
      roster.push(player);
      pool.splice(
        pool.findIndex((p) => p.id === player.id),
        1,
      );
    }
    return { rankedIds, count: Math.max(0, 24 - team.players.length) };
  });
}

function validatePhasePlan(league, teamName, plan) {
  requireOnline(
    plan && typeof plan === 'object' && !Array.isArray(plan),
    '提出内容が不正です',
  );
  const team = TEAMS_DATA[teamName];
  switch (league.phase.kind) {
    case 'contract': {
      requireOnline(
        Array.isArray(plan.releaseIds) &&
          new Set(plan.releaseIds).size === plan.releaseIds.length &&
          plan.releaseIds.every((id) => team.players.some((p) => p.id === id)),
        '退団選手の指定が不正です',
      );
      const remaining = team.players.filter(
        (p) => !plan.releaseIds.includes(p.id),
      );
      requireOnline(
        remaining.length >= Math.min(9, team.players.length),
        '契約後も最低9人は残してください。既に9人未満の場合は新たな退団はできません',
      );
      return { releaseIds: [...plan.releaseIds] };
    }
    case 'camp':
      requireOnline(
        plan.menu === 'standard' || CAMP_MENUS.includes(plan.menu),
        '練習方針が不正です',
      );
      return { menu: plan.menu };
    case 'initial_tryout':
    case 'tryout': {
      const candidates = new Set(league.phase.candidates.map((p) => p.id));
      requireOnline(
        Number.isInteger(plan.count) &&
          plan.count >= 0 &&
          plan.count <= Math.max(0, 24 - team.players.length),
        '獲得人数が不正です',
      );
      requireOnline(
        Array.isArray(plan.rankedIds) &&
          plan.rankedIds.length <= candidates.size &&
          new Set(plan.rankedIds).size === plan.rankedIds.length &&
          plan.rankedIds.every((id) => candidates.has(id)),
        '希望順位に無効・重複した選手がいます',
      );
      requireOnline(
        plan.rankedIds.length >= plan.count,
        '獲得希望人数以上の候補を指定してください',
      );
      return { count: plan.count, rankedIds: [...plan.rankedIds] };
    }
    case 'offseason':
      return {};
    default:
      throw new Error('未対応のイベントです');
  }
}

function releasePlayers(teamName, ids, year) {
  const team = TEAMS_DATA[teamName];
  for (const player of team.players.filter((p) => ids.includes(p.id))) {
    if ((player.age || 20) < 33) {
      const saved = clone(finalizePlayerSeason(player, year));
      addToReleasedPool({
        ...saved,
        isStarter: false,
        battingOrder: 0,
        releasedYear: year,
        previousTeam: teamName,
        attemptsInPool: 0,
        seasonFinalizedYear: year,
      });
    }
    cleanupPlayerReferences(team, player.id);
  }
  team.players = team.players.filter((p) => !ids.includes(p.id));
}

function resolveTryout(league, plans) {
  const phase = league.phase;
  const names =
    phase.kind === 'initial_tryout'
      ? league.season.settings.teamNames
      : [...league.season.standings]
          .sort((a, b) => a.winRate - b.winRate)
          .map((s) => s.team);
  const remaining = clone(phase.candidates);
  const acquired = Object.fromEntries(names.map((name) => [name, []]));
  const allPicked = [];
  // ⚠ **希望順位は静的だが、ドラフトは動的**。4球団なら自分の番までに
  //    ほとんど取られないが、42球団だと24巡目には約1000人が消えており、
  //    好みの順だけで取ると**捕手が一度も浮上しない**ことがある。
  //    そのまま進むと「投手・捕手・野手が不足」で**フェーズ全体が解決できず、
  //    1球団の都合で全員が止まる**（実際にそうなった）。
  //    残り指名枠が不足ぶんと同じになったら、必要な守備位置を優先する。
  const isPitcher = (p) => p.position === 'pitcher';
  const shortfall = (list) => {
    const fielders = list.filter((p) => !isPitcher(p)).length;
    const needPitcher = !list.some(isPitcher);
    const needCatcher = !list.some((p) => p.position === 'catcher');
    const needFielders = Math.max(8 - fielders, needCatcher ? 1 : 0);
    return { needPitcher, needCatcher, needFielders };
  };
  for (const pick of generateSnakeDraftOrder(names, 24)) {
    const team = TEAMS_DATA[pick.team];
    const plan = plans[pick.team];
    const roster = [...team.players, ...acquired[pick.team]];
    const { needPitcher, needCatcher, needFielders } = shortfall(roster);
    const slotsLeft = 24 - roster.length;
    const mustFill = (needPitcher ? 1 : 0) + needFielders;
    // ⚠ **希望人数に達しても、最低限が欠けていれば取り続ける**。
    //    以前は希望人数（0人も選べる）で打ち切っていたため、投手・捕手・野手が
    //    足りない球団が1つあるだけで下の検査に落ち、**全員のトライアウトが
    //    解決できずに止まった**（締め切りの自動解決も同じ所で失敗する）。
    //    足りないぶんは必要な守備位置から自動で補う。
    const planFull = !!plan && acquired[pick.team].length >= plan.count;
    if (slotsLeft <= 0 || (planFull && mustFill === 0)) continue;
    let forced = null;
    if (slotsLeft <= mustFill || planFull) {
      // 足りないものから順に埋める（投手 → 捕手 → 野手）
      const want = needPitcher
        ? isPitcher
        : needCatcher
          ? (p) => p.position === 'catcher'
          : (p) => !isPitcher(p);
      const pool = remaining.filter(want);
      forced = pool.length ? selectPlayerForAI(pool, roster) || pool[0] : null;
    }
    const player = forced
      ? forced
      : planFull
        ? null
        : plan
        ? // ⚠ **希望順だけで取らないこと**。候補の38%が投手なので、順番どおりに
          //    取ると投手15人・野手9人（控えゼロ）になる。CPUは
          //    `selectPlayerForAI` が目標構成を見ているので投手10・野手14で揃い、
          //    人の球団だけ構造的に不利だった。同じ目標に従って飛ばす
          nextFromPlan(
            plan.rankedIds
              .map((id) => remaining.find((p) => p.id === id))
              .filter(Boolean),
            roster,
          )
        : selectPlayerForAI(remaining, roster);
    if (!player) continue;
    remaining.splice(
      remaining.findIndex((p) => p.id === player.id),
      1,
    );
    acquired[pick.team].push(player);
    allPicked.push({ team: pick.team, player, round: pick.round });
  }
  for (const name of names) {
    const team = TEAMS_DATA[name];
    const combined = [...team.players, ...acquired[name]];
    requireOnline(
      combined.filter((p) => p.position !== 'pitcher').length >= 8 &&
        combined.some((p) => p.position === 'pitcher') &&
        combined.some((p) => p.position === 'catcher'),
      `${league.teams?.find((t) => t.name === name)?.displayName || name}の投手・捕手・野手が不足します。希望順位を見直してください`,
      409,
      'roster',
    );
    team.players = combined;
  }
  for (const { team, player, round } of allPicked) {
    player.draftInfo = { year: league.season.year, round };
    player.careerHistory = [
      ...(player.careerHistory || []),
      { type: 'independent', year: league.season.year, label: team },
    ];
  }
  if (phase.kind !== 'initial_tryout') {
    const ids = allPicked.map((p) => p.player.id);
    updateReleasedPoolAfterTryout(ids);
    removeDraftedFromGraduatePools(
      ids,
      allPicked.map((p) => p.player),
    );
    removeDraftedFromClubTeams(ids);
  }
  league.notices.unshift({
    type: 'tryout',
    year: league.season.year,
    picks: allPicked.map(({ team, player, round }) => ({
      team,
      playerId: player.id,
      name: player.name,
      round,
    })),
  });
  for (const name of names) {
    generatePitchingRotation(name);
    setRecommendedLineup(TEAMS_DATA[name], name);
  }
}

function resolvePhase(league, now) {
  const kind = league.phase.kind;
  const plans = Object.fromEntries(
    league.members.map((m) => [
      m.teamName,
      league.phase.submissions[m.userId].plan,
    ]),
  );
  if (kind === 'initial_tryout' || kind === 'tryout')
    resolveTryout(league, plans);
  if (kind === 'contract') {
    for (const name of league.season.settings.teamNames)
      releasePlayers(
        name,
        plans[name]?.releaseIds ||
          getAIReleaseCandidates(TEAMS_DATA[name].players),
        league.season.year,
      );
  }
  if (kind === 'camp') {
    for (let round = 0; round < 4; round++) {
      for (const [name, team] of Object.entries(TEAMS_DATA)) {
        if (!team.players?.length) continue;
        const menu = plans[name]?.menu || 'standard';
        const assignments = Object.fromEntries(
          team.players.map((p) => [
            p.id,
            menu === 'standard'
              ? p.position === 'pitcher'
                ? 'control'
                : 'batting'
              : menu,
          ]),
        );
        const staff = team.corporateData?.staff
          ? getTeamStaffBonus(team.corporateData.staff)
          : null;
        TEAMS_DATA[name] = executeTeamCampTraining(
          team,
          assignments,
          {},
          staff,
        ).updatedTeam;
        if (staff) {
          applyMotivationEffect(TEAMS_DATA[name].players, staff);
          applyBatteryMentalEffect(TEAMS_DATA[name].players, staff);
        }
      }
    }
    initializeAllPlayersCondition();
    for (const name of league.season.settings.teamNames) {
      generatePitchingRotation(name);
      setRecommendedLineup(TEAMS_DATA[name], name);
    }
    league.season.currentDate = {
      year: 2023 + league.season.year,
      month: 4,
      day: 1,
    };
    league.season.phase = SEASON_PHASES.REGULAR_SEASON;
    generateAprilHighSchoolClass(league.season.year);
    league.season._highSchoolGenerated = true;
    generateBackgroundTournaments(league.season.currentDate);
  }
  if (kind === 'offseason') {
    freezeComparison(league);
    league.history.push({
      year: league.season.year,
      standings: clone(league.season.standings),
      awards: clone(league.season.frozenAwards || {}),
      playoffChampion: getPlayoffChampion(league.season.schedule),
    });
    const result = advanceToNextYear(league.season, TEAMS_DATA, {
      playedTeamNames: league.season.settings.teamNames,
    });
    for (const key of Object.keys(TEAMS_DATA)) delete TEAMS_DATA[key];
    Object.assign(TEAMS_DATA, result.updatedTeams);
    league.season = result.newSeasonData;
    WORLD_DATA.year = league.season.year;
    assignTeamControllers(
      TEAMS_DATA,
      league.members.map((m) => m.teamName),
    );
    // ⚠ **昇降格は日程を作り直す前に適用すること**。所属が変わってから
    //    日程を組まないと、昇格した球団が元のリーグの相手と戦い続ける。
    const movements = applyPyramidMovements(
      league.teams,
      league.history.at(-1)?.standings || [],
    );
    if (movements.length)
      league.notices.unshift({
        type: 'promotion',
        year: league.history.at(-1)?.year,
        moves: movements,
      });
    // ⚠ **球団表を渡すこと**。翌シーズンの日程もリーグ分けが要る。
    //    渡し忘れると `pyramidSchedule` が undefined を filter して落ちる
    //    （通年検査が年度更新で踏んだ）。
    createSchedule(league.season, league.teams);
    // 一人用と同じく年度末にCPUローテを再構築。人間の編成は有効な範囲で保持する。
    const humans = new Set(humanTeamNames(TEAMS_DATA));
    for (const name of Object.keys(TEAMS_DATA))
      if (!humans.has(name)) generatePitchingRotation(name);
  }
  league.phase = null;
  delete league.season.pendingPhaseEvent;
  if (kind === 'initial_tryout' || kind === 'offseason')
    openPhase(league, 'camp', now);
  else {
    league.status = 'running';
    // キャンプの後は開幕。月曜0時に揃える（`seasonStartAt` の説明を参照）
    league.nextAdvanceAt =
      kind === 'camp' ? seasonStartAt(now) : nextProgressionAt(now);
  }
}

export function submitPhase(league, userId, { phaseId, plan, ready }, now) {
  requireOnline(
    league.status === 'waiting' && league.phase?.id === phaseId,
    'このイベントは終了しています。最新状態を確認してください',
    409,
    'phase',
  );
  const member = league.members.find((m) => m.userId === userId);
  requireOnline(member, '参加者ではありません', 403);
  loadLeagueWorld(league);
  const normalized = validatePhasePlan(league, member.teamName, plan);
  league.phase.submissions[userId] = {
    plan: normalized,
    ready: ready === true,
  };
  if (league.members.every((m) => league.phase.submissions[m.userId]?.ready))
    seeded(league, `phase:${phaseId}`, () => resolvePhase(league, now));
  league.game = captureWorld();
}

export { saveLineup } from './lineupCommand.mjs';

/**
 * 保存する試合結果から、両球団の丸ごとの写し（`homeTeam` / `awayTeam`）を外す。
 *
 * ⚠ **1試合で約100KBあり、しかも2か所に入っていた**（`season.results` と
 *    `season.schedule[].result`）。1シーズンで保存が約190MB（圧縮後24MB）まで
 *    膨らみ、Supabase の無料枠を数年で食い潰す大きさだった。
 * ⚠ 外してよい理由：個人成績と試合の詳細は試合の直後に記録（`createRecorder`）が
 *    取り終えている。保存後にこの写しを読むのは、記録が無い古いリーグ向けの
 *    `storedGame` の予備経路だけで、そこは写しが無ければ要約を返す。
 *    点数・勝敗投手・継投（`pitcherChanges`）は残す。
 * ⚠ 保存の**項目を減らすのではなく、中身を軽くするだけ**。古いコードが読んでも
 *    同じ予備経路に入るだけなので、`ONLINE_SCHEMA` は上げない。
 */
export function slimStoredResults(season) {
  const slim = (result) => {
    if (!result || !('homeTeam' in result || 'awayTeam' in result))
      return result;
    const { homeTeam, awayTeam, ...rest } = result;
    return rest;
  };
  for (const game of season.results || []) game.result = slim(game.result);
  for (const game of season.schedule || []) game.result = slim(game.result);
}

/**
 * 1回の定期進行で、試合の無い日をまとめて進める上限。
 * ⚠ 1日ずつ進める処理を繰り返すだけで、日付を飛ばしはしない
 *    （間の日の大会・ドラフト・手続きの判定を落とさないため）。
 * ⚠ 上限は**日数で決める**（時間で打ち切らない）。時間で切ると、同じ保存から
 *    やり直したときに区切りが変わって結果が変わる。実測で1日あたり約0.1秒。
 */
export const IDLE_DAYS_PER_TICK = 60;

/** その日に消化する試合が無く、レギュラーシーズンも終わっているか */
function idleDay(league) {
  const season = league.season;
  if (league.status !== 'running' || league.phase) return false;
  if (
    season.schedule.some(
      (g) => g.phase === SEASON_PHASES.REGULAR_SEASON && !g.result,
    )
  )
    return false;
  return !getScheduleByDate(season.schedule, season.currentDate).some(
    (g) => !g.result,
  );
}

/**
 * 定期進行1回ぶん。
 *
 * ⚠ **シーズン後の試合の無い日はまとめて進める**。1ターン＝1日のままだと、
 *    レギュラーシーズン（120日・7月末まで）の後、プレーオフ（10月）と
 *    ドラフト・契約更改（11月）までの空の日を1時間に1日ずつ進めることになり、
 *    1年に約240時間かかっていた。週の割り当て（月〜金＝シーズン、
 *    土＝ストーブリーグ、日＝キャンプ）が成り立たない。
 * ⚠ **レギュラーシーズン中は1日ずつ**。休養日（試合の無い日）も1ターンとして
 *    数える設計なので、そこまでまとめると週の長さが変わる。
 */
export function advanceLeagueDay(league, operationId, now) {
  requireOnline(league.status === 'running', '現在は進行を停止しています', 409);
  // 最後に captureWorld() で差し替えるので、写しの複製は要らない
  loadLeagueWorld(league, { take: true });
  advanceOneDay(league, `day:${operationId}`, now);
  for (let n = 1; n <= IDLE_DAYS_PER_TICK && idleDay(league); n++)
    advanceOneDay(league, `day:${operationId}:${n}`, now);
  if (league.status === 'running')
    league.nextAdvanceAt = nextProgressionAt(now);
  league.notices = league.notices.slice(0, 20);
  league.game = captureWorld();
}

function advanceOneDay(league, key, now) {
  seeded(league, key, () => {
    const oldDate = league.season.currentDate;
    const playingTeams = new Set(
      getScheduleByDate(league.season.schedule, oldDate)
        .filter((game) => !game.result)
        .flatMap((game) => [game.home, game.away]),
    );
    const restoreRotations = league.season.settings.teamNames
      .filter((name) => playingTeams.has(name))
      .map((name) => prepareDailyLineup(TEAMS_DATA[name], name));
    let season;
    try {
      season = simulateScheduledGamesOnDate(
        league.season,
        // ⚠ 観戦記録は既定で残さない（容量）。`ONLINE_RECORD_REPLAY=1` で有効
        createRecorder(league, TEAMS_DATA, {
          replay: process.env.ONLINE_RECORD_REPLAY === '1',
        }),
      ).data;
    } finally {
      for (const restore of restoreRotations) restore();
    }
    slimStoredResults(season);
    season = progressDate(season, 1);
    simulateParallelWorldDate(oldDate);
    advanceBackgroundTournaments(oldDate);
    if (
      oldDate.month !== season.currentDate.month &&
      [6, 8, 10].includes(season.currentDate.month)
    )
      updateAllTeamReputations(season);
    if (league.season.phase !== season.phase) {
      // ⚠ **プレーオフは1部の球団だけで組む**。順位表は全12球団を通した並びなので、
      //    そのままだと2部の首位がプレーオフに出て優勝できてしまう（実測で起きた）。
      //    出場できる球団は**その場で渡すだけ**にして保存には残さない。
      //    保存の形を変えずに済み、昇降格のたびに書き直す必要もない。
      const settings = season.settings;
      season = handlePhaseTransition(
        {
          ...season,
          settings: { ...settings, playoffTeamNames: topTierTeamNames(league.teams) },
        },
        season.phase,
      );
      season.settings = settings;
    }
    schedulePlayoffReplay(season);
    league.season = season;
    const { month, day, year } = season.currentDate;
    generateBackgroundTournaments(season.currentDate);
    if (month === 8 && day >= 15 && !season._koshienDone) {
      simulateKoshien(season.year);
      season._koshienDone = true;
    }
    if (month === 10 && day >= 21 && !season.grandChampionship?.generated) {
      const champion = getPlayoffChampion(season.schedule);
      if (champion) {
        const gc = generateGrandChampionship(
          'shikoku',
          season.standings,
          season.settings,
          season.year,
          champion,
        );
        if (gc) {
          autoPlayGrandChampionship(gc);
          if (league.records?.seasons?.[season.year])
            league.records.seasons[season.year].grandChampionshipExcluded =
              true;
          season.grandChampionship = gc;
        }
      }
    }
    if (month === 10 && day === getNPBDraftDay(year) && !season._draftDone) {
      freezeComparison(league);
      season.frozenAwards = processSeasonEnd(season, TEAMS_DATA);
      season.finalRankings = snapshotRankings(
        TEAMS_DATA,
        season.settings.teamNames,
      );
      const result = processNPBDraft(TEAMS_DATA, season.year);
      league.notices.unshift({
        type: 'draft',
        year: season.year,
        picks: result.draftedPlayers.map((p) => ({
          name: p.player.name,
          playerId: p.player.id,
          team: p.teamName,
          npbTeam: p.npbTeam,
          round: p.draftRound,
        })),
      });
      season._draftDone = true;
    }
    if (month === 11 && day === 9) openPhase(league, 'contract', now);
    else if (month === 11 && day === 10) openPhase(league, 'tryout', now);
    else if (month === 11 && day === 30) openPhase(league, 'offseason', now);
  });
}

/**
 * 締め切りを過ぎたフェーズを、未提出の人に既定案を当てて解決する。
 *
 * ⚠ **非同期で遊ぶゲームなので、待ち続けてはいけない**。1人が決めないと
 *    全員の週が止まる。既定案（`defaultPhasePlan`）はAIの選び方そのものなので、
 *    放置しても不利になりすぎない。
 * ⚠ 解決すると次のフェーズが開くことがある（契約更改→トライアウト→オフシーズン）。
 *    そちらの締め切りも過ぎていれば、同じティックで続けて解決する。
 */
/**
 * 手続きを**いま**締め切る（検証用）。未提出の人には標準案を当てる。
 * ⚠ 締め切り時刻を `now` に書き換えてから通常の自動決定に渡す。
 *    解決の手順を2本に分けると、片方だけ直したときに食い違う。
 */
export function resolvePhaseNow(league, now) {
  requireOnline(league.phase, '決定待ちの手続きはありません', 409);
  league.phase.deadline = now;
  return autoResolvePhase(league, now);
}

export function autoResolvePhase(league, now) {
  loadLeagueWorld(league);
  const resolved = [];
  // ⚠ 上限を置く。開く→解決の繰り返しが想定外に続いても回り続けない
  for (let guard = 0; guard < 10; guard++) {
    const phase = league.phase;
    if (!phase?.deadline || phase.deadline > now) break;
    const id = phase.id;
    resolved.push(phase.kind);
    for (const member of league.members) {
      if (league.phase?.id !== id) break;
      if (phase.submissions[member.userId]?.ready) continue;
      submitPhase(
        league,
        member.userId,
        { phaseId: id, plan: defaultPhasePlan(league, member.teamName), ready: true },
        now,
      );
    }
    if (league.phase?.id === id) break; // 誰も居ない等で解決しなかった
  }
  return resolved;
}
