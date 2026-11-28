import { numberLeagueTeams, captainsOfYear, updateTeamFace } from './teamFace.mjs';
import './engine-bootstrap.mjs';
import { schedulePlayoffReplay, PLAYOFF_REPLAY } from './playoffReplay.mjs';
import { selectHonors } from './seasonAwards.mjs';
import {
  recordMilestones,
  recordKoshien,
  recordGrandChampionship,
  recordRetirements,
  annotateHistory,
  careerSummaryOf,
} from './chronicle.mjs';
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
  calendarYearOf,
  openingDayFields,
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
import { reliefOrderOf, isPitcher, isStaffableFielder } from '../src/online/pitchingEdit.js';
import { setRecommendedLineup, withFielderGameFatigue } from '../src/game/autoSimulation.js';
import { ensureCompleteLineup } from '../src/game/lineup.js';
import { prepareDailyLineup, benchTwoWayStarter } from './dailyLineup.mjs';
import { initializeAllPlayersCondition, CONDITION_LEVELS } from '../src/game/condition.js';
import { simulateScheduledGamesOnDate } from '../src/game/daySimulation.js';
import { hashSeed, withSeededRandom } from '../src/game/rng.js';
import {
  assignTeamControllers,
  humanTeamNames,
} from '../src/game/teamControl.js';
import { getAIReleaseCandidates } from '../src/game/contractRules.js';
import {
  executeTeamCampTraining,
  executeSubTraining,
  applyMotivationEffect,
  applyBatteryMentalEffect,
  menuFitsPlayer,
  subMenuFitsPlayer,
  canonicalSubMenu,
  campSubKey,
  SUB_TRAINING_MENUS,
  calcSecondAffinity,
} from '../src/season/campTraining.js';
import {
  moodMultiplier,
  resolveTraining,
  playerPolicy,
  CAMP_POLICY_MODES,
} from '../src/season/trainingPolicy.js';
import {
  getTeamStaffBonus,
  setStaffIdCounter,
  setStaffNameHistory,
} from '../src/corporate/staffData.js';
import { addToReleasedPool } from '../src/state/pools.js';
import {
  assertTradeAllowed,
  canRespond,
  canCounter,
  cpuTradeDecision,
  rosterShortfall,
  MAX_OPEN_TRADES,
} from '../src/online/trades.js';
import { tradeValueOf } from './tradeValue.mjs';
import { tradeJudgeForLeague } from './tradeJudge.mjs';
import { tradeStrengthGap, givingTradeValues,
} from '../src/online/tradeSearch.js';
import {
  planCpuTrade,
  CPU_OFFER_VALUE_FLOOR,
  liveOfferMemo,
  rememberOffer,
  partnerOrder,
  pickTradeMover,
  dayRoll,
  offerExpiry,
  dateKey as cpuDateKey,
  CPU_TRADE_EVERY,
  CPU_OFFER_EVERY,
  CPU_OFFER_DAYS,
  CPU_TRADE_LAST_MONTH,
} from './cpuTrades.mjs';
import { setPlayerIdCounter } from '../src/state/playerIds.js';
import { captureWorld, restoreWorld } from './worldSnapshot.mjs';
import { createRecorder, freezeComparison, keyFor } from './recordedStats.mjs';
import { chooseProDraft, applyProDraft } from './proDraft.mjs';
import {
  pushInbox,
  recordTransaction,
  moveOf,
  pruneTrades,
  markAway,
  keepAwayPlan,
  teamLabelIn,
  forgetLastYearPlans,
} from './social.mjs';
import { cleanText, TRADE_NOTE_MAX } from '../src/online/social.js';
import {
  pickFor,
  clearPlayedPicks,
  lockStarters,
  lockedStarterFor,
  pruneDepartedPicks,
  starterAvoidedText,
} from './starterPicks.mjs';
import {
  openChallenge as openChallengeIn,
  respondChallenge as respondChallengeIn,
  playExhibition,
  clearOpenChallenges,
  dropChallengesOf,
} from './exhibition.mjs';
import {
  ONLINE_SCHEMA,
  ONLINE_ENGINE_VERSION,
  assertLeagueVersion,
  nextProgressionAt,
  phaseDeadlineAt,
  seasonStartAt,
  requireOnline,
  CAMP_MENUS,
  CAMP_SUB_MENUS,
  CAMP_DIRECTIONS,
  CAMP_PHASES,
  CAMP_ROUNDS,
  ROSTER_LIMIT,
  ROSTER_STANDARD,
  ONLINE_ROSTER_TARGETS,
  CONVERT_POSITIONS,
  CAMP_SUB_TARGETS,
  CAMP_PITCH_TYPES,
  CAMP_FORMS,
  CAMP_BATS,
  CAMP_STANCES,
  campTargetKind,
  onlineFielderFatigueFor,
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
  clearTeamSplitName,
  clearTeamLogo,
} from '../src/online/membership.js';
import {
  nextFromPlan,
  wishLimit,
  signTotal,
  fillsAutomatically,
  TRYOUT_WISH_MAX,
  tryoutPickOrder,
} from '../src/online/tryoutPlan.js';
import { generateRosterPacks, packsForMember } from '../src/online/rosterPack.js';
import { abilitySnapshot, abilityGains, addCampGains } from '../src/online/campGains.js';
import {
  ensureCoaches,
  applyStaffTactics,
  tryoutContextFor,
  releaseBiasFor,
  tradeFactorFor,
  campPlanFor,
  coachSeasonRows,
  coachOffseason,
  validateStaffMoves,
  reserveStaffMoves,
  fillVacancies,
  hirePlayerAsCoach,
  setStaffModes,
  staffCommand,
  effectiveStaffModes,
  phaseDelegated,
  waitsFor,
  staffOf,
} from './coachEngine.mjs';
import { tradeEagerness } from '../src/online/teamPolicy.js';

export const ENGINE_VERSION = ONLINE_ENGINE_VERSION;
export { CAMP_MENUS, CAMP_SUB_MENUS, CAMP_DIRECTIONS, CAMP_PHASES, CAMP_ROUNDS };
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

/**
 * トライアウトで自動で埋める人数（名簿の合計）。人の球団は標準の26人、CPU球団は26か27人。
 *
 * ⚠ 先方要望（2026-11-16）: 枠は28人まで（複数人のトレードのため）、CPUは26〜27人を基本。
 *    CPUの27人目はリーグの種×年×球団のハッシュで決める（乱数を引かない＝同じ年度をやり直せば同じ）。
 * ⚠ 人の球団は**獲得する人数を自分で決めたときだけ**27・28人まで取れる（`signTotal`）
 */
export function autoRosterTarget(league, teamName) {
  if (league.members.some((m) => m.teamName === teamName)) return ROSTER_STANDARD;
  return ROSTER_STANDARD + (hashSeed(`${league.seed}:${league.season.year}:roster:${teamName}`) % 2);
}

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
  // ⚠ **ターン数と試合数は、日程を組んだときに書き留めること**。進行中の
  //    シーズンは組んだ日程のまま終わるので、`SEASON_TURNS` を変えた直後に
  //    画面が「第121ターン / 160」のような、日程に無い数を出してしまう。
  //    書き留めておけば、古いリーグは120のまま最後まで、次の年から160になる。
  season.settings.seasonTurns = SEASON_TURNS;
  season.settings.gamesPerSeason = gamesPerTeam();
}

/**
 * 途中参加した人に見せるセットのid。**検査用ではなく命令の検証に使う**。
 * ⚠ セットは保存していない（種から作り直す）ので、選択が正しいかは
 *    ここで作り直して確かめるしかない。
 */
export function packIdsFor(member) {
  return packsForMember(member).map((p) => p.id);
}

/**
 * 途中参加して、まだセットが名簿に入っていない人か。
 * その球団は次のキャンプまでCPUが動かし、名簿はキャンプでセットに入れ替わる。
 */
const hasPendingPack = (league, teamName) =>
  (league.members || []).some((m) => m.teamName === teamName && m.packSeed);

/**
 * 途中参加した人が選んだセットを、名簿に入れる。**キャンプのときだけ**呼ぶ。
 *
 * ⚠ シーズン途中で入れ替えないこと。順位表と選手成績が合わなくなる。
 *    キャンプは新シーズンの直前なので、ここで入れ替えれば勝敗は0から始まる。
 * ⚠ 選ばなかった人（締め切りまでに決めなかった人）には**標準で1つ目**を渡す。
 *    空のまま開幕させない。
 * ⚠ 入れ替えで消える24人は、引き継いだCPU球団の選手。プールへは戻さない
 *    （戻すと翌年のトライアウトに同じ顔ぶれが並ぶ）。
 */
function applyPendingPacks(league) {
  for (const member of league.members || []) {
    if (!member.packSeed) continue;
    // 名簿には複製を入れる（`clone`）ので、使い回しの値を読むだけでよい
    const packs = packsForMember(member);
    const pack =
      packs.find((p) => p.id === member.pendingPackId) || packs[0];
    const team = TEAMS_DATA[member.teamName];
    if (!team) continue;
    team.players = clone(pack.players);
    for (const player of team.players)
      player.careerHistory = [
        ...(player.careerHistory || []),
        { type: 'independent', year: league.season.year, label: member.teamName },
      ];
    refreshTeamPlan(league, member.teamName);
    delete member.packSeed;
    delete member.packStyle;
    delete member.pendingPackId;
  }
}

/**
 * 育成方針（やる気に効く）。⚠ 受け取れない値は標準へ倒す。
 *    画面の値をそのまま信じると、知らない方針で `moodMultiplier` が
 *    「全部不一致」になり、全員のやる気が下がる。
 */
export function normalizeCampPolicy(policy) {
  const direction = CAMP_DIRECTIONS.includes(policy?.direction)
    ? policy.direction
    : 'balanced';
  const phase = CAMP_PHASES.includes(policy?.phase) ? policy.phase : 'skill';
  // ⚠ 決め方（おすすめ・希望どおり・全員同じ）。**無ければ全員同じ**として
  //    扱う（前の版の画面・保存した指示・CPU球団はこれまでどおり）
  const mode = CAMP_POLICY_MODES.includes(policy?.mode) ? policy.mode : 'team';
  return { mode, direction, phase };
}

/**
 * 自分で回していない球団に締め切りで当てるキャンプの指示（提出した案、無ければ既定）。
 * ⚠ **何も実行・提出しなかった人は「おすすめ」**（画面の既定と同じ）。
 *    既定を全員同じ方針のままにすると、画面ではおすすめと出ているのに
 *    締め切りで「全体を伸ばす×技術」が回り、希望の違う選手の身が入らない。
 *    CPU球団（`member` なし）はこれまでどおり（決め方なし＝全員同じ方針）
 */
export function campFallbackPlan(member, plan) {
  return {
    policy: plan?.policy || (member ? { mode: 'recommended' } : undefined),
    players: plan?.players,
    main: plan?.assignments,
    sub: plan?.subAssignments,
    // 指導者の育成の的（`coaches.js` の `campAim`）。回したら選手に覚えさせる
    aims: plan?.aims,
  };
}

/**
 * 選手ごとの方針の上書き（{ [id]: { direction, phase } }）。
 * ⚠ 自分の名簿の選手だけ・受け取れる方針だけ。
 */
function campPlayerPolicies(roster, source) {
  const ids = new Set(roster.map((p) => p.id));
  const out = {};
  for (const [id, own] of Object.entries(source || {})) {
    const playerId = Number(id);
    if (!ids.has(playerId)) continue;
    requireOnline(
      CAMP_DIRECTIONS.includes(own?.direction) &&
        CAMP_PHASES.includes(own?.phase),
      '育成方針が不正です',
    );
    out[playerId] = { direction: own.direction, phase: own.phase };
  }
  return out;
}

/**
 * サブ練習の「対象」を `executeSubTraining` が読む形にする。
 * ⚠ 対象を取らないメニューには何も渡さない（知らない鍵を増やさない）。
 */
function campTargetOptions(key, value, player) {
  if (!value) return {};
  const kind = campTargetKind(key, player);
  if (kind === 'pitch' || kind === 'ownPitch') return { targetPitch: value };
  if (kind === 'position') return { targetPosition: value };
  if (kind === 'form') return { targetForm: value };
  // 野手のフォーム改造＝打撃フォーム（オープン/スクエア/クローズ）
  if (kind === 'stance') return { targetStance: value };
  if (kind === 'bats') return { targetBats: value };
  return {};
}

// 実際に回すサブ練習（フォーム改造・打席変更は、対象が無いか、もうその形なら基礎体力）。
// ⚠ 一人用のキャンプ画面と同じ規則なので `campTraining.js` に置いた。検査が読むのでここからも出す
export { campSubKey };

/**
 * キャンプを**1クールだけ**走らせる。
 *
 * ⚠ 人の球団は画面で1クールずつ実行し、伸びた能力を見てから次を決める
 *    （一人用と同じ）。締め切りで残りを回すぶんもここを通す。
 * ⚠ **やる気は方針との噛み合いで決まる**（`moodMultiplier`）。方針が無ければ
 *    「全体を伸ばす×技術」として扱う。希望どおりが正解ではなく、噛み合いは
 *    効率にだけ効く。
 * ⚠ サブ練習が無い選手は `physique`（基礎体力）。一人用の既定と同じ。
 * ⚠ 世界（`TEAMS_DATA`）を直に書き換える。呼ぶ側が `captureWorld()` すること。
 */
export function runCampRound(
  league,
  teamName,
  { policy, players: overrides, main, sub, subTarget, aims } = {},
  // ⚠ **最後のクールかどうかを渡す**。経験値の消費はキャンプで1回だけで、
  //    クールごとに減らすと覚醒率が1クール目だけのものになる
  //    （`executeCampTraining` の `spendExperience`）。
  //    既定は true（渡さない呼び出しは今までどおり毎回消費する）
  { lastRound = true } = {},
) {
  const team = TEAMS_DATA[teamName];
  if (!team?.players?.length) return { gains: {}, events: {} };
  const humanTeam = (league.members || []).some((m) => m.teamName === teamName);
  // ⚠ 伸びは**練習の前後を比べて**作る（メイン・サブ・スタッフの効果をまとめて）。
  //    練習ごとの報告を足し合わせると、サブ練習やスタッフの効果が漏れる
  const before = new Map(
    team.players.map((player) => [player.id, abilitySnapshot(player)]),
  );
  const staff = team.corporateData?.staff
    ? getTeamStaffBonus(team.corporateData.staff)
    : null;
  // ⚠ 独立リーグの覚醒倍率。一人用の `gameMode === 'independent'` と揃える
  const awakening = 1.5;
  const assignments = {};
  const moods = {};
  // ⚠ 方針は**練習の前に1回だけ**決める。練習で能力が変わると本人の希望も
  //    変わりうるので、サブ練習の既定を後で引き直すとメインと食い違う
  const policies = new Map();
  for (const player of team.players) {
    // ⚠ **守備位置に合わないメニューは標準へ倒す**（投手に打撃練習など）。
    //    倒さないと、伸びるのはその選手が使わない能力だけになる。
    //    画面の選択肢（`CampPlanner` の `menusFor`）と同じ規則。
    // ⚠ **方針は選手ごと**（`playerPolicy`）。やる気もその選手の方針で見る
    const { direction, phase } = playerPolicy(player, policy, overrides);
    policies.set(player.id, { direction, phase });
    const wanted = main?.[player.id] || resolveTraining(player, direction, phase).main;
    assignments[player.id] = menuFitsPlayer(wanted, player)
      ? wanted
      : player.position === 'pitcher'
        ? 'control'
        : 'batting';
    moods[player.id] = moodMultiplier(player, direction, phase);
  }
  const { updatedTeam, allReports } = executeTeamCampTraining(
    team,
    assignments,
    {},
    staff,
    awakening,
    moods,
    { spendExperience: lastRound },
  );
  TEAMS_DATA[teamName] = updatedTeam;
  // ⚠ **育成の的を選手に覚えさせる**（`coaches.js` の `campAim`）。翌年のキャンプもこの的を続ける
  //    （毎年引き直すと積み上がらない。先方要望 #6）。的の練習を実際に当てた選手だけ
  for (const player of updatedTeam.players) {
    const aim = aims?.[player.id];
    if (aim && assignments[player.id] === main?.[player.id])
      player.campAim = { stat: aim.stat, mode: aim.mode, since: aim.since };
  }
  // 数字にならない出来事（フォーム改造・新球種・打席の変更）は文で残す
  // ⚠ 能力の覚醒（大きく伸びた）も `isAwakening` で来る。伸びた数は `gains` に
  //    あるので、ここは「覚醒した」ことだけ書く（「ミート 63」と今の値を並べない）
  const events = {};
  const note = (player, report) => {
    for (const r of report || [])
      // ⚠ フォーム改造は失敗してもフォームが変わる。打席変更の失敗も知らせる（数字に出ない）
      if (r.isAwakening || r.statName === 'フォーム改造' || r.after === '変更失敗')
        (events[player.id] ||= []).push(
          typeof r.before === 'number' && r.stat !== 'newpitch'
            ? `${r.statName}が覚醒`
            : `${r.statName} ${r.after}`.trim(),
        );
  };
  for (const r of allReports || []) note(r.player, r.growthReport);
  for (const player of updatedTeam.players) {
    // ⚠ 守備位置に合うかは**入口で見ている**（`validateCampRound` と
    //    `validatePhasePlan`）。ここで倒すと、どちらの入口が漏れても気づけない
    const own =
      policies.get(player.id) || playerPolicy(player, policy, overrides);
    const chosen = sub?.[player.id];
    const key = campSubKey(
      chosen || resolveTraining(player, own.direction, own.phase).sub,
      player,
      subTarget?.[player.id],
    );
    // ⚠ 方針の「短所を埋める×技術」は、もと守備補強（本職だけを上げ、守備位置は動かさない）。
    //    サブポジ練習にまとめた（2026-11-24）ので、ほかの位置の適性も上がり、後の
    //    `syncPositionToFitness` でCPU球団の遊撃手が二塁へ黙って移ることがある。前と同じく動かさない
    const keepPosition = humanTeam || (!chosen && own.phase === 'skill' && key === 'subposition');
    // ⚠ **選んだ対象を渡すこと**（覚えたい球種・磨きたい球種・守備位置）。
    //    渡さないと中で抽選され、画面で選んだのに違うものを覚える
    if (SUB_TRAINING_MENUS[key]) {
      const position = player.position;
      note(
        player,
        executeSubTraining(
          player,
          key,
          campTargetOptions(key, subTarget?.[player.id], player),
          staff,
        )?.growthReport,
      );
      // ⚠ **人の球団の守備位置は「守備位置を変える」（convert）が正本**。サブポジ練習の
      //    後の適性への合わせ（`syncPositionToFitness`）で黙って元に戻さない
      //    （一塁手を捕手に変えても1クールで一塁に戻り、捕手が0人になることもあった）。
      //    CPU球団は一人用と同じく適性に合わせる
      if (keepPosition) player.position = position;
    }
  }
  if (staff) {
    applyMotivationEffect(updatedTeam.players, staff);
    applyBatteryMentalEffect(updatedTeam.players, staff);
  }
  const gains = {};
  for (const player of updatedTeam.players) {
    const diff = abilityGains(
      before.get(player.id) || {},
      abilitySnapshot(player),
    );
    if (Object.keys(diff).length) gains[player.id] = diff;
  }
  // `moods`: 選手ごとのやる気の倍率（検査で、方針が選手ごとに効いたかを見る）
  return { gains, events, moods };
}

/** 手動実行と締切時の自動実行で、同じ記録を残す。 */
export function recordCampRound(state, result) {
  state.rounds = (state.rounds || 0) + 1;
  state.last = {
    round: state.rounds,
    gains: result?.gains || {},
    events: result?.events || {},
  };
  // ⚠ **クールごとの伸びも残す**（先方指摘: 表の「+〇」が通算なので、1つのクールで
  //    どれだけ伸びたか分からない）。`last` は直近の1クールしか持たないので、
  //    キャンプ後に「第1〜4クールでそれぞれ何が伸びたか」を出すには並びが要る。
  //    ⚠ 無い記録（版を上げる前に始めたキャンプ）もある。読む側は無ければ `last` だけで出す
  state.byRound = [
    ...(state.byRound || []),
    { round: state.rounds, gains: result?.gains || {} },
  ];
  state.gains = addCampGains(state.gains, result?.gains);
  state.events ||= {};
  for (const [id, events] of Object.entries(result?.events || {}))
    state.events[id] = [...new Set([...(state.events[id] || []), ...events])];
}

// ============================================================
// トレード
// ============================================================

/** その人の球団。⚠ 参加者でなければ止める（CPU球団は交渉しない） */
function memberTeam(league, userId) {
  const member = (league.members || []).find((m) => m.userId === userId);
  requireOnline(member, '参加者ではありません', 403);
  const team = TEAMS_DATA[member.teamName];
  requireOnline(team, '球団が見つかりません', 409);
  return { member, team };
}

/**
 * ⚠ **初期メンバーの入れ替えを待っている球団とはトレードしない**。
 *    途中参加した人の名簿は、次のキャンプの後に選んだセットで丸ごと
 *    置き換わる（`applyPendingPacks`）。その前にトレードすると、受け取った
 *    選手は置き換えで消え、出した選手だけが相手に残る（選手が1人ずつ
 *    リーグから消えていく）。
 */
function assertNoPendingPack(league, teamNames) {
  for (const name of teamNames)
    requireOnline(
      !hasPendingPack(league, name),
      `${teamLabelIn(league, name)}は開幕前に初期メンバーへ入れ替わるため、それまではトレードできません`,
      409,
    );
}

// 素質だけの値段（検査用）。CPU球団の判断と画面の値段は `tradeJudge.mjs` の `valueOf`
export { tradeValueOf };

/**
 * CPU球団 `to` の返事（`cpuTradeDecision`）。提案のときと、CPUの逆提案を受けるときに使う。
 */
export function cpuDecisionFor(league, fromTeam, to, offerIds, wantIds, judge = tradeJudgeForLeague(league)) {
  const theirs = TEAMS_DATA[to];
  // ⚠ CPU球団の監督の見る目（育成なら若手を高く、勝負なら主力の年齢を高く）
  const factor = tradeFactorFor(league, to);
  // ⚠ 値段は**画面に出すものと同じ関数**（`tradeJudge`。素質・いまの力・成績・
  //    その球団の事情）。ここだけ変えると、見込みメーターが「受けるはず」と
  //    出したのに断られる
  // ⚠ `judge` は名簿が変わっていない間だけ使い回せる（球団の事情を名簿ごとに覚える）。
  //    1日のCPUトレード（`runCpuTrades`）は1回作って渡し、交換が成立したら作り直す
  // ⚠ 検査（`human-trade-probe`・`online-trade-check`）もこの関数で判断させる（値段の式を写さない）
  return cpuTradeDecision({
    // 受け取る選手（こちらが出す選手）は、相手の事情を抜いた値段で見る。
    valueOf: (player) => judge.valueOf(player) * factor(player),
    // ⚠ **その球団で出番があるかを乗せる**（いしだ 2026-11-24「トレードは…選手に活躍の場を
    //    与える場にすべきです。もっとも得点が高いのは、余剰戦力が相手チームでレギュラーに
    //    なれる場合です」）。持ち場の一番になれるなら満額（+`PLAYING_TIME_BONUS`＝50%）、
    //    控え止まりなら上乗せ0。画面の見込みメーター（`TradeScreen.jsx`）とアプリも同じ関数
    //    （`givingTradeValues`）。何人か受け取るときは1人ずつ順に足した分だけを数える
    //    ⚠ **出す選手（`want`）を抜いた名簿で測ること**。1対1は同じ持ち場の交換になりやすく、
    //       抜く前の名簿で測ると「いま居る主力（これから出す本人）に勝てないから控え止まり」と
    //       判定され、上乗せが入るべき交換にほとんど入らなかった。逆提案は差し替えた顔ぶれで測り直す
    giveValuesOf: (players, want) =>
      givingTradeValues(
        (theirs.players || []).filter((p) => !(want || []).includes(p.id)),
        players,
        (player) => judge.valueOf(player) * factor(player),
      ),
    // 自分が出す選手は、その球団の事情こみ（抜けると穴が空く選手ほど高い）
    valueOfOwn: (player) => judge.valueOf(player, to) * factor(player),
    // まとめて出すときは、まとめて抜けた穴で値段を付ける（`needFactors`）
    lossOf: (players) =>
      judge.setValuesOf(players, to).map((v, i) => v * factor(players[i])),
    fromPlayers: fromTeam.players,
    toPlayers: theirs.players,
    offerIds,
    wantIds,
    // ⚠ 交換で開く戦力の差（画面の見込みメーターも同じ式で出す。`tradeSearch.js`）
    strengthGap: (give, get) =>
      tradeStrengthGap(fromTeam.players, theirs.players, give, get),
  });
}

/**
 * トレードを提案する。相手は**CPU球団でもよい**。
 *
 * ⚠ **CPU球団はその場で答える**。返事を待つ相手が居ないので、提案した瞬間に
 *    受ける／逆提案／断るのどれかが決まる（`cpuTradeDecision`）。
 *    以前は参加者の球団だけを相手にしていたが、1人で遊んでいる間は
 *    トレードがまったく使えなかった。
 * ⚠ **断ったときは記録を残さないこと**。断られた提案が一覧に残ると、
 *    同じものを押し直せてしまう。理由をそのまま返して画面に出す。
 * ⚠ 抱えられる提案の数に上限を置く（`MAX_OPEN_TRADES`）。無制限だと
 *    相手の画面を埋められる。
 * ⚠ **人が出す提案に時間の期限は無い**。消えるのは返事（受ける・断る）・提案した側の取り下げ（`reject`）と、
 *    成り立たなくなったとき（選手が移籍・退団した、オーナーが替わった）・年度更新（`pruneTrades`）。
 *    人の提案の画面の注記に「期限」と書かないこと（再監査 A4）。
 *    ⚠ 期限があるのは**CPUから人の球団への提案だけ**（`CPU_OFFER_DAYS` 日。`runCpuTrades` が取り下げる）。年度更新で消えるのは、能力も年齢も
 *    変わった後に古い条件で成立させないため（いしだ承認の改善案 A1）。
 * ⚠ ひとこと（`note`）は人の球団宛てのときだけ残す。CPU球団はその場で答えるので読む人が居ない。
 */
export function openTrade(league, userId, { to, offer, want, note }, now) {
  league.trades = league.trades || [];
  const mine = memberTeam(league, userId);
  requireOnline(
    (league.season.settings.teamNames || []).includes(to),
    '相手の球団が見つかりません',
    409,
  );
  requireOnline(to !== mine.member.teamName, '自分の球団とはトレードできません');
  // ⚠ 参加者が居なければCPU球団。`to`（相手のuserId）は null で持つ
  const partner = (league.members || []).find((m) => m.teamName === to);
  const theirs = TEAMS_DATA[to];
  requireOnline(theirs, '相手の球団が見つかりません', 409);
  // ⚠ 相手はCPU球団のこともある（`partner` は null）。球団名で確かめる
  assertNoPendingPack(league, [mine.member.teamName, to]);
  requireOnline(
    league.trades.filter((t) => t.from === userId).length < MAX_OPEN_TRADES,
    `出せる提案は同時に${MAX_OPEN_TRADES}件までです`,
    409,
  );
  const offerIds = (offer || []).map(Number);
  const wantIds = (want || []).map(Number);
  assertTradeAllowed(mine.team, theirs, offerIds, wantIds);
  const message = tradeNote(note);
  const id = `trade-${(league.tradeSeq = (league.tradeSeq || 0) + 1)}`;
  const trade = {
    id,
    from: userId,
    fromTeam: mine.member.teamName,
    to: partner ? partner.userId : null,
    toTeam: to,
    offer: offerIds,
    want: wantIds,
    // ⚠ 手番を持っている側だけが返事をする。両方が同時に受けられると二重に成立する
    turn: 'to',
    countered: false,
    createdAt: now,
    updatedAt: now,
    ...(partner && message ? { note: message } : {}),
  };
  if (partner) {
    league.trades.push(trade);
    return { id, status: 'offered' };
  }
  // --- CPU球団はその場で答える
  const decision = cpuDecisionFor(league, mine.team, to, offerIds, wantIds);
  if (decision.action === 'accept') {
    applyTrade(league, trade, now);
    return { id, status: 'accepted' };
  }
  if (decision.action === 'counter') {
    // ⚠ 逆提案も**提案した側から見た形**で持つ（`offer` は `fromTeam` が出す）
    trade.want = decision.want;
    assertTradeAllowed(mine.team, theirs, trade.offer, trade.want);
    trade.countered = true;
    trade.turn = 'from';
    trade.updatedAt = now;
    league.trades.push(trade);
    return { id, status: 'countered' };
  }
  // ⚠ 断られたら**何も残さない**。`requireOnline` で画面に理由を出す
  requireOnline(
    decision.reason !== 'lopsided',
    `${teamLabelIn(league, to)} は、この交換ではそちらの戦力ばかり上がるので応じませんでした。もらう選手を見直してください`,
    409,
    'trade',
  );
  requireOnline(
    false,
    `${teamLabelIn(league, to)} はこの内容では応じませんでした。出す選手を足すか、もらう選手を見直してください`,
    409,
    'trade',
  );
}

/**
 * トレードに返事をする。`action` は `accept` / `counter` / `reject`。
 *
 * ⚠ **成立のときに中身をもう一度確かめる**。提案から返事までの間に、選手が
 *    別のトレードで移っていることがある。提案のときに見ただけだと、居ない
 *    選手を動かして名簿が壊れる。
 * ⚠ 逆提案は**最初の返事のときだけ**（`canCounter`）。投げ返しが続くと終わらない。
 * ⚠ 断るのは**どちらの側からでも**できる（取り下げも兼ねる）。
 */
export function respondTrade(league, userId, { tradeId, action, offer, want, note }, now) {
  league.trades = league.trades || [];
  const trade = league.trades.find((t) => t.id === tradeId);
  requireOnline(trade, 'そのトレードはもうありません', 409);
  requireOnline(
    trade.from === userId || trade.to === userId,
    'このトレードの当事者ではありません',
    403,
  );
  const drop = () => {
    league.trades = league.trades.filter((t) => t.id !== tradeId);
  };
  // 相手（人）に知らせる。⚠ 文はここで作る（PC とアプリが同じ文を出す）
  const mine = trade.from === userId;
  const otherId = mine ? trade.to : trade.from;
  const myLabel = teamLabelIn(league, mine ? trade.fromTeam : trade.toTeam);
  const tell = (type, text) =>
    otherId && pushInbox(league, otherId, { type, tradeId: trade.id, text }, now);
  if (action === 'reject') {
    drop();
    // ⚠ 断るのはどちらの側からでもできる。提案した側が引いたのなら「取り下げ」
    if (mine) tell('tradeWithdrawn', `${myLabel}がトレードの提案を取り下げました`);
    else tell('tradeRejected', `${myLabel}がトレードの提案を断りました`);
    return { status: 'rejected' };
  }
  requireOnline(canRespond(trade, userId), 'いまは相手の返事待ちです', 409);
  const fromTeam = TEAMS_DATA[trade.fromTeam];
  const toTeam = TEAMS_DATA[trade.toTeam];
  requireOnline(fromTeam && toTeam, '球団が見つかりません', 409);

  if (action === 'counter') {
    requireOnline(
      canCounter(trade, userId),
      '逆提案は1回までです。受けるか断るかを選んでください',
      409,
    );
    // ⚠ 逆提案も**提案した側から見た形**で持つ（`offer` は `fromTeam` が出す）。
    //    向きを変えると、成立のときにどちらが誰を出すのか分からなくなる
    const offerIds = (offer || []).map(Number);
    const wantIds = (want || []).map(Number);
    assertTradeAllowed(fromTeam, toTeam, offerIds, wantIds);
    trade.offer = offerIds;
    trade.want = wantIds;
    trade.countered = true;
    trade.turn = 'from';
    trade.updatedAt = now;
    // ⚠ **CPUからの提案への逆提案は、CPUがその場で答える**（返事を待つ人が居ない）。判断は人の提案と
    //    同じ `cpuDecisionFor`（人の球団が「出す・もらう」側として見る）。受ければ成立、受けなければ断る
    if (trade.from === null) {
      assertNoPendingPack(league, [trade.fromTeam, trade.toTeam]);
      const answer = cpuDecisionFor(league, toTeam, trade.fromTeam, trade.want, trade.offer);
      // ⚠ 応じないときは例外で返す（命令ごと取り消されるので、元の提案がそのまま残る）
      requireOnline(
        answer.action === 'accept',
        `${teamLabelIn(league, trade.fromTeam)} はこの逆提案には応じませんでした。元の提案のまま受けるか、断ってください`,
        409,
        'trade',
      );
      drop();
      applyTrade(league, trade, now);
      return { status: 'accepted' };
    }
    const reply = tradeNote(note);
    if (reply) trade.replyNote = reply;
    else delete trade.replyNote;
    tell('tradeCountered', `${myLabel}からトレードの逆提案が届きました`);
    return { status: 'countered' };
  }

  requireOnline(action === 'accept', 'トレードの操作が不正です');
  // ⚠ **CPUの逆提案を受けるときは、いまの名簿でもう一度CPUに判断させる**。提案に期限は無く、
  //    逆提案を取っておいて別のトレードや成長で名簿を変えてから受けると、戦力の開きの線
  //    （`STRENGTH_GAP_LIMIT`）や値段を回り込めた（監査 2026-11-14）。
  //    応じなくなったら成立させない（提案は残すので、断って出し直してもらう）
  // ⚠ CPUからの提案を受けるときも、いまの名簿でもう一度CPUに判断させる（同じ理由）。
  //    人の球団（`toTeam`）が出す・もらう側として見る
  // `human` は人の球団、`cpu` はCPU球団の名前、`give`・`get` は人の球団が出す・もらう選手
  const rejudge = (human, cpu, give, get, message) => {
    assertNoPendingPack(league, [trade.fromTeam, trade.toTeam]);
    assertTradeAllowed(fromTeam, toTeam, trade.offer, trade.want);
    const again = cpuDecisionFor(league, human, cpu, give, get);
    requireOnline(again.action === 'accept', message, 409, 'trade');
  };
  if (trade.to === null)
    rejudge(
      fromTeam,
      trade.toTeam,
      trade.offer,
      trade.want,
      `${teamLabelIn(league, trade.toTeam)} は、名簿や選手の力が変わったので、この逆提案ではもう応じません。断ってから出し直してください`,
    );
  if (trade.from === null)
    rejudge(
      toTeam,
      trade.fromTeam,
      trade.want,
      trade.offer,
      `${teamLabelIn(league, trade.fromTeam)} は、名簿や選手の力が変わったので、この提案をもう続けません。断って閉じてください`,
    );
  drop();
  applyTrade(league, trade, now);
  tell('tradeAccepted', `${myLabel}とのトレードが成立しました`);
  return { status: 'accepted' };
}

/**
 * CPU球団が自分から動くトレード。シーズン中（7月まで）の1日の終わりに呼ぶ。
 *   1. 期限の過ぎたCPUからの提案を取り下げる
 *   2. CPU同士の交換（平均 `CPU_TRADE_EVERY` 日に1回、1組）
 *   3. 人の球団への提案（球団ごとに平均 `CPU_OFFER_EVERY` 日に1回。未返事のCPUからの提案は1件まで）
 * ⚠ 受ける側の判断は人の提案と同じ `cpuDecisionFor`（値段の上乗せと戦力の開きの線）。
 *    人の球団への提案は「人がこれを出したら受ける」ものだけ（受けたときにもう一度同じ判断を通す）。
 * ⚠ 初期メンバーの入れ替え待ちの球団（`hasPendingPack`）は相手にしない。
 */
function runCpuTrades(league, now) {
  const season = league.season;
  const { month } = season.currentDate || {};
  league.trades = league.trades || [];
  // 期限切れ（日付が期限を過ぎた）CPUからの提案
  const today = cpuDateKey(season.currentDate);
  const expired = league.trades.filter((t) => t.from === null && t.expires && today > t.expires);
  if (expired.length) {
    league.trades = league.trades.filter((t) => !expired.includes(t));
    for (const t of expired)
      pushInbox(
        league,
        t.to,
        {
          type: 'tradeWithdrawn',
          tradeId: t.id,
          text: `${teamLabelIn(league, t.fromTeam)}からのトレードの提案は、期限が過ぎたため取り下げられました`,
        },
        now,
      );
  }
  if (league.phase || season.phase !== SEASON_PHASES.REGULAR_SEASON || !(month <= CPU_TRADE_LAST_MONTH)) return;
  const names = (season.settings.teamNames || []).filter(
    (n) => TEAMS_DATA[n] && !hasPendingPack(league, n),
  );
  const humans = new Map((league.members || []).map((m) => [m.teamName, m.userId]));
  const cpus = names.filter((n) => !humans.has(n));
  // ⚠ 名簿の写しと値段の道具は**くじが当たってから**作り、交換が成立したら作り直す。
  //    以前は毎日（トレードの無い日も）作り、`cpuDecisionFor` の呼ぶたびにも作り直していた。
  //    また CPU同士の交換のあとも古い名簿（`applyTrade` は名簿の配列を差し替える）のまま
  //    人の球団への提案を組んでいたので、出て行った選手を出す提案を作れた
  let teams = null;
  let judge = null;
  const fresh = () => {
    if (!teams) {
      teams = Object.fromEntries(names.map((n) => [n, TEAMS_DATA[n].players]));
      judge = tradeJudgeForLeague(league);
    }
  };
  const allowed = (fromName, toName, give, get) => {
    try {
      assertTradeAllowed(TEAMS_DATA[fromName], TEAMS_DATA[toName], give, get);
      return true;
    } catch {
      return false;
    }
  };
  // --- CPU同士
  if (cpus.length >= 2 && dayRoll(league, 'cpu-trade') < 1 / CPU_TRADE_EVERY) {
    // 言い出す球団は監督の編成の方針で選ばれやすさが違う（積極補強ほど言い出す。先方要望 #9）
    const from = pickTradeMover(league, cpus, (name) => tradeEagerness(staffOf(league, name).manager));
    fresh();
    const plan = planCpuTrade({
      from,
      teams,
      partners: partnerOrder(league, from, cpus, 'cpu'),
      valueOf: (p) => judge.valueOf(p),
      // 相手のCPUが、人の提案と同じ判断で受けるか
      accept: (partner, give, get) =>
        allowed(from, partner, give, get) &&
        cpuDecisionFor(league, TEAMS_DATA[from], partner, give, get, judge).action === 'accept',
    });
    if (plan) {
      const id = `trade-${(league.tradeSeq = (league.tradeSeq || 0) + 1)}`;
      applyTrade(
        league,
        { id, from: null, fromTeam: from, to: null, toTeam: plan.partner, offer: plan.give, want: plan.get, turn: 'to', countered: false },
        now,
      );
      // 名簿が変わったので、次に使うときに作り直す
      teams = null;
      judge = null;
    }
  }
  // --- 人の球団への提案
  for (const [teamName, userId] of humans) {
    if (!names.includes(teamName) || !cpus.length) continue;
    if (league.trades.some((t) => t.from === null && t.to === userId)) continue;
    if (dayRoll(league, `cpu-offer:${teamName}`) >= 1 / CPU_OFFER_EVERY) continue;
    // ⚠ 釣り合う案を持たない球団も多い（その日の名簿で3〜4割）ので、その日の順にCPUを見て
    //    最初に案が見つかった球団が言い出す（1回の判断は数十ミリ秒）
    const order = [...cpus].sort(
      (a, b) => dayRoll(league, `cpu-offer-from:${teamName}:${a}`) - dayRoll(league, `cpu-offer-from:${teamName}:${b}`),
    );
    fresh();
    let from = null;
    let plan = null;
    // ⚠ 人の同じ選手を続けて求めない。どのCPUからでも、求めてから `CPU_OFFER_MEMO_DAYS` 日は
    //    その選手を求める提案を出さない（以前は同じCPUだけを避けたので、別のCPUが人の同じ主力を
    //    続けて欲しがれた。判断7、いしだ 2026-11-20）。覚えは `league.cpuOfferMemo`（日付つき）
    const avoid = new Set(liveOfferMemo(league).filter((m) => m.team === teamName).map((m) => m.id));
    for (const cpu of order) {
      plan = planCpuTrade({
        from: cpu,
        avoid,
        teams,
        partners: [teamName],
        valueOf: (p) => judge.valueOf(p),
        // ⚠ 人の側から見ても釣り合う案だけ（戦力の開きを両向きに見る・値段が見合う）。
        //    以前は人の一番手を若い控え1人で取る案ばかり届いた（いしだ 2026-11-20）
        balanced: true,
        fair: (partner, give, get) => {
          const pick = (team, ids) => TEAMS_DATA[team].players.filter((p) => ids.includes(p.id));
          const offered = pick(cpu, give).reduce((a, p) => a + judge.valueOf(p), 0);
          const lost = judge.setValuesOf(pick(partner, get), partner).reduce((a, v) => a + v, 0);
          return offered >= lost * CPU_OFFER_VALUE_FLOOR;
        },
        // 人がこの内容で出したら、CPUが受けるか（受けたときも同じ判断を通す。`respondTrade`）
        accept: (partner, give, get) =>
          allowed(cpu, partner, give, get) &&
          cpuDecisionFor(league, TEAMS_DATA[partner], cpu, get, give, judge).action === 'accept',
      });
      if (plan) {
        from = cpu;
        break;
      }
    }
    if (!plan) continue;
    rememberOffer(league, teamName, plan.get);
    const id = `trade-${(league.tradeSeq = (league.tradeSeq || 0) + 1)}`;
    league.trades.push({
      id,
      // ⚠ CPUからの提案は `from` が null（提案した人が居ない）。`offer` は CPU が出す選手
      from: null,
      fromTeam: from,
      to: userId,
      toTeam: teamName,
      offer: plan.give,
      want: plan.get,
      turn: 'to',
      countered: false,
      createdAt: now,
      updatedAt: now,
      expires: offerExpiry(season.currentDate),
    });
    pushInbox(
      league,
      userId,
      { type: 'tradeOffered', tradeId: id, text: `${teamLabelIn(league, from)}からトレードの提案が届きました（${CPU_OFFER_DAYS}日以内に返事を）` },
      now,
    );
  }
}

/** トレードに添えるひとこと（空なら null）。⚠ 長すぎれば断る（黙って切ると違う文が届く） */
function tradeNote(note) {
  if (note == null) return null;
  const { text, tooLong } = cleanText(note, TRADE_NOTE_MAX);
  requireOnline(!tooLong, `ひとことは${TRADE_NOTE_MAX}字までです`);
  return text || null;
}

/**
 * トレードを成立させる（選手を入れ替えて、経歴とお知らせに残す）。
 *
 * ⚠ **人が受けたときとCPUが受けたときで同じ処理を通すこと**。2か所に書くと、
 *    片方だけ経歴を残し忘れる・打順を組み直し忘れる、ということが起きる。
 * ⚠ 成立の直前に**もう一度**中身を確かめる（`assertTradeAllowed` と
 *    `assertNoPendingPack`）。提案から返事までの間に、選手が別のトレードで
 *    移っていたり、相手が途中参加の入れ替え待ちになっていたりする。
 */
function applyTrade(league, trade, now) {
  const fromTeam = TEAMS_DATA[trade.fromTeam];
  const toTeam = TEAMS_DATA[trade.toTeam];
  requireOnline(fromTeam && toTeam, '球団が見つかりません', 409);
  assertNoPendingPack(league, [trade.fromTeam, trade.toTeam]);
  const after = assertTradeAllowed(fromTeam, toTeam, trade.offer, trade.want);
  fromTeam.players = after.from;
  toTeam.players = after.to;
  // ⚠ 移った選手の経歴に残す。あとから「どの年にどこへ行ったか」を辿れるように
  for (const [players, label] of [
    [after.moving, trade.toTeam],
    [after.coming, trade.fromTeam],
  ])
    for (const player of players)
      player.careerHistory = [
        ...(player.careerHistory || []),
        { type: 'trade', year: league.season.year, label },
      ];
  // ⚠ **打順と投手起用を組み直す**。出した選手が打順に残ると試合が組めない
  refreshTeamPlan(league, trade.fromTeam);
  refreshTeamPlan(league, trade.toTeam);
  // 取引の記録（年ごと・日付つき。お知らせは20件で消えるので、こちらに残す）
  recordTransaction(
    league,
    {
      kind: 'trade',
      teams: [trade.fromTeam, trade.toTeam],
      // 相手がCPU球団だったか（その場で答えた）。CPUからの提案（`from` が null）も含む
      cpu: !trade.to || !trade.from,
      // CPU球団どうしの交換（`runCpuTrades`）
      ...(!trade.to && !trade.from ? { cpuOnly: true } : {}),
      moves: [
        ...after.moving.map((p) => moveOf(p, trade.fromTeam, trade.toTeam)),
        ...after.coming.map((p) => moveOf(p, trade.toTeam, trade.fromTeam)),
      ],
    },
    now,
  );
  // ⚠ 動いた選手を含むほかの提案は成り立たない。残すと「（移籍済み）」のまま枠を埋める
  //    （この提案はもう一覧から外してある。`respondTrade` は先に外してから呼ぶ）
  pruneTrades(league, TEAMS_DATA, now);
  league.notices.unshift({
    type: 'trade',
    year: league.season.year,
    teams: [trade.fromTeam, trade.toTeam],
    picks: [
      ...after.moving.map((p) => ({
        round: '移籍',
        name: p.name,
        playerId: p.id,
        team: trade.toTeam,
      })),
      ...after.coming.map((p) => ({
        round: '移籍',
        name: p.name,
        playerId: p.id,
        team: trade.fromTeam,
      })),
    ],
  });
  return after;
}

/** 練習試合を申し込む（`exhibition.mjs`）。世界は読まない */
export function openChallenge(league, userId, payload, now) {
  return openChallengeIn(league, userId, payload, now);
}

/**
 * 練習試合の申し込みに返事をする。受けたらその場で1試合する。
 * ⚠ **世界は読み込むが、保存し直さない**（呼ぶ側は `captureLeagueWorld` しないこと）。
 *    試合は2球団の写しで行うので、成績・疲労・調子は残らない（`playExhibition`）。
 * ⚠ 乱数は申し込みの番号から（やり直しても同じ試合）
 */
export function respondChallenge(league, userId, payload, now) {
  return respondChallengeIn(league, userId, payload, now, (ex) => {
    loadLeagueWorld(league);
    return seeded(league, `exhibition:${ex.id}`, () => playExhibition(league, ex));
  });
}

/**
 * 管理者が、参加者の球団をCPUに戻す（来なくなった人の球団。改善案 A3）。
 * - 参加者から外し、球団名を元の名前に戻す（次に入る人が付け直せる）
 * - その人のトレードの提案・練習試合の申し込み・手続きの提出を消す
 * - 編成をCPUと同じく作り直す
 * - 手続きがこの人だけを待っていたら、その場で進める
 * ⚠ 選手・成績・記録はそのまま（球団の内部名で持っているので、引き継ぐ人にそのまま渡る）
 * ⚠ 管理者は自分を外せない（外すと誰もリーグを動かせなくなる）
 */
export function releaseMember(league, adminId, targetUserId, now) {
  requireOnline(targetUserId && targetUserId !== adminId, '管理者は自分の球団をCPUに戻せません');
  const index = (league.members || []).findIndex((m) => m.userId === targetUserId);
  requireOnline(index >= 0, 'その参加者は見つかりません', 409);
  const member = league.members[index];
  loadLeagueWorld(league);
  league.members.splice(index, 1);
  const team = (league.teams || []).find((t) => t.name === member.teamName);
  if (team) {
    team.displayName = team.name;
    // ⚠ 分けた名前（地域名・チーム名・地方）も消す。表示名だけ戻すと略称・地元が前の人の
    //    ままで、次に入った人に引き継がれていた（2026-11-20 監査）
    clearTeamSplitName(team);
    // 作ったロゴも消す（次に入る人は自動のロゴから始める）
    clearTeamLogo(team);
  }
  if (league.phase) {
    delete league.phase.submissions?.[targetUserId];
    delete league.phase.camp?.[targetUserId];
  }
  for (const key of ['campResults', 'tryoutResults', 'offseasonResults'])
    if (league[key]) delete league[key][targetUserId];
  pruneTrades(league, TEAMS_DATA, now);
  dropChallengesOf(league, targetUserId, now);
  assignTeamControllers(
    TEAMS_DATA,
    league.members.map((m) => m.teamName),
  );
  refreshTeamPlan(league, member.teamName, { force: true });
  resolveSettledPhase(league, now);
  league.game = captureWorld();
  return { teamName: member.teamName };
}

/**
 * 選手の**登録守備位置**を変える（コンバート）。
 *
 * ⚠ **能力は足さない**。選手は元から `pitching` も `batting` も
 *    `positionFitness` も持っている（セットの生成がそう作る）ので、登録を
 *    変えるだけで成り立つ。新しい位置の適性は低いまま＝下手なのが正しい。
 * ⚠ **名簿が成り立たなくなる変更は受け付けない**（トレードと同じ
 *    `rosterShortfall`）。最後の捕手を外野手にすると試合が組めない。
 * ⚠ **打順と投手起用を組み直す**。残したままだと、野手になった選手が登板順に
 *    残り、投手になった選手が守備に就いたままになる。組み直すので、
 *    画面には「打順と投手起用は組み直されます」と断ってから押させる。
 */
export function convertPosition(league, userId, { playerId, position }) {
  const { member, team } = memberTeam(league, userId);
  requireOnline(
    CONVERT_POSITIONS.includes(position),
    '守備位置の指定が不正です',
  );
  const player = team.players.find((p) => p.id === Number(playerId));
  requireOnline(player, 'その選手は名簿にいません', 409);
  requireOnline(
    player.isActive !== false,
    '登録を外れている選手の守備位置は変えられません',
    409,
  );
  requireOnline(player.position !== position, 'すでにその守備位置です');
  const after = team.players.map((p) =>
    p.id === player.id ? { ...p, position } : p,
  );
  const problems = rosterShortfall(after);
  requireOnline(
    !problems.length,
    `この変更では名簿が成り立ちません: ${problems.join('・')}`,
  );
  player.position = position;
  // ⚠ **印を付けること**。投手かどうかの判定は「スタミナ100以上なら投手」という
  //    当て推量を含むので、投手から野手へ移しても投げ続ける（`registeredAsFielder`）
  player.primaryRole = position === 'pitcher' ? 'pitcher' : 'fielder';
  refreshTeamPlan(league, member.teamName, { force: true });
  return { position };
}

/** 主将・永久欠番（球団の顔。`teamFace.mjs`）。世界を読んだあとに呼ぶ */
export function setTeamFace(league, userId, payload) {
  const { member, team } = memberTeam(league, userId);
  return updateTeamFace(league, team, member.teamName, payload);
}

export function openPhase(league, kind, now) {
  // ⚠ **締め切りを持たせること**。待ち続ける設計だと、1人が決めないだけで
  //    全員の週が止まる。締め切りが曜日合わせも兼ねている
  //    （土曜＝ストーブリーグ／日曜＝キャンプ／月曜＝開幕）。
  const phase = {
    id: `${league.season.year}:${kind}`,
    kind,
    deadline: now ? phaseDeadlineAt(kind, now) : null,
    submissions: {},
  };
  if (kind === 'pack_select') {
    // ⚠ **セットはこのときだけ作る**。20セット×24人＝480人なので、
    //    手続きが終わったら `league.phase` ごと消えて保存から落ちる
    league.packs = generateRosterPacks(league.seed + 7).map((pack) => ({
      ...pack,
      takenBy: null,
    }));
    phase.packIds = league.packs.map((p) => p.id);
  }
  if (kind === 'tryout') {
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
      // ⚠ 第3引数は「初回か」。初回の名簿は**初期メンバーセット**で配るので
      //    オンラインに初回トライアウトは無い。常に実在プールから引く
      false,
      rank,
      reputation,
    );
  }
  if (kind === 'camp') {
    // ⚠ 緩急の補完（`secondAffinity`、◆）はキャンプの頭で決める。一人用は
    //    `CampScreen` を開いたときに付けるが、オンラインには付ける所が無く、
    //    ◆が出ない・新球種の習得ボーナス（+0.08）も入らなかった（監査 2026-11-13）。
    //    一度決めたら習得のたびに `executeCampTraining` が更新する
    for (const name of league.season.settings.teamNames) {
      for (const p of TEAMS_DATA[name]?.players || []) {
        if (p.position === 'pitcher' && p.pitching && p.pitching.secondAffinity === undefined)
          p.pitching.secondAffinity = calcSecondAffinity(p.pitching.arsenal || []);
      }
    }
  }
  league.phase = phase;
  if (kind === 'tryout') {
    // ⚠ **CPU球団の狙い（見込み）**。トライアウトの候補に「どの球団がリストに入れているか」の札を出す
    //    （先方要望 2026-11-21「欲しい選手を全部リストに入れても予定人数取れない事があった。どの球団が
    //    リストに加えているかバッジがあれば、より上位にしたり諦めたり選択肢が増える」）。
    //    中身は標準案（`defaultPhasePlan`。CPU が取るときと同じ `selectPlayerForAI` で空き枠ぶん並べたもの）。
    //    CPU は実際には指名の番ごとに選び直すので**見込み**（画面もそう書く）。開いた時に1回だけ作って残す
    //    （名簿は契約更改のあとで決まっていて、手続きの間は動かない）。手続きが終われば `phase` ごと消える。
    const human = new Set((league.members || []).map((m) => m.teamName));
    phase.cpuLists = Object.fromEntries(
      league.season.settings.teamNames
        .filter((n) => !human.has(n) && TEAMS_DATA[n])
        .map((n) => [n, defaultPhasePlan(league, n).rankedIds || []])
        .filter(([, ids]) => ids.length),
    );
  }
  league.status = 'waiting';
  league.nextAdvanceAt = null;
  league.season.pendingPhaseEvent = kind;
}

/**
 * リーグ1つぶんの世界の種を、作った時刻から作る。
 *
 * ⚠ **`createLeague` の既定値は変えない**。既定の種（20261028）の世界で
 *    キャンプの成長量や覚醒率を合わせてあり（`online-camp-check`）、
 *    既定を動かすとその数値の検査がまとめて動く。本物のリーグはこの関数の種で
 *    作るので、`online-camp-check` は別の種の世界でも効きと伸びの大きさを見張る。
 * ⚠ 呼ぶ側が時刻を固定していれば同じ世界になる（検査のリーグは時計を
 *    固定しているので再現する）。本番は作るたびに別の顔ぶれになる。
 */
export const worldSeedFromTime = (now) => hashSeed(`world:${now}`);

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
      // ⚠ 来た時刻を入れる（無いと来なくなってもおるすばんにならない。`isAwayAt`）
      lastSeenAt: now,
    })),
    history: [],
    notices: [],
    // ⚠ トレードの置き場。無いと `league.trades.push` で落ちる
    trades: [],
    tradeSeq: 0,
  };
  const season = createSeasonData(1);
  season.settings = {
    ...season.settings,
    teamNames: names,
    teamsCount: PYRAMID_TEAM_COUNT,
    preset: 'pyramid',
    // ⚠ 試合数とターン数は `createSchedule` が入れる（日程と同じ場所で決める）。
    //    休養日のぶん試合数はターン数より少ない（規定打席などの基準になる）
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
    LEAGUE_SETTINGS.maxExtraInnings = 12;
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
    // ⚠ 開幕前は「どのセットを選ぶか」だけ。希望リストはシーズン後の
    //    トライアウトで使う（初期編成は置き換えた）
    openPhase(league, 'pack_select', now);
  });
  // 背番号（リーグの球団だけ。`teamFace.mjs`）
  numberLeagueTeams(league.season.settings.teamNames, TEAMS_DATA);
  league.game = captureWorld();
  // 指導者（監督・コーチ）。⚠ 世界とは別の保存（`league.coaches`）。種から決まる
  ensureCoaches(league);
  return league;
}

// `take`: 写しを複製せずに渡す（`restoreWorld` の説明を参照）。最後に
// `league.game = captureWorld()` で差し替える呼び出しだけが使ってよい。
/**
 * 世界を保存の形へ書き戻す。⚠ `TEAMS_DATA` を触ったら必ず呼ぶこと
 *    （触っただけでは保存に載らない）。
 */
export function captureLeagueWorld() {
  return captureWorld();
}

/**
 * キャンプ1クールぶんの指示を検証する。
 * ⚠ 自分の名簿の選手だけ・受け取れるメニューだけ。画面の値をそのまま
 *    信じると、知らないメニューで練習が飛ぶ。
 */
export function validateCampRound(league, teamName, payload) {
  // ⚠ **保存された世界（`league.game`）を見ること。`TEAMS_DATA` を見ない**。
  //    呼ぶ側は `loadLeagueWorld` の前に検査するので、メモリ上の世界は
  //    空（起動したての関数）か、前に読んだ古い世界のまま。実際にアプリで
  //    キャンプの1クール目が「球団が見つかりません」で止まった。
  const team = league.game?.teams?.[teamName];
  requireOnline(team, '球団が見つかりません', 409);
  const byId = new Map(team.players.map((p) => [p.id, p]));
  // ⚠ **守備位置に合うかも見る**。合わないものは `runCampRound` が既定へ
  //    倒すが、画面には「選んだのに違う練習をした」と映る。入口で断る。
  const pick = (source, allowed, fits, message) => {
    const out = {};
    for (const [id, rawKey] of Object.entries(source || {})) {
      const playerId = Number(id);
      const player = byId.get(playerId);
      if (!player) continue;
      // ⚠ サブ練習のまとめた古い名前（守備補強）は今の名前で受ける（古いアプリ・下書きから届く）
      const key = allowed === CAMP_SUB_MENUS ? canonicalSubMenu(rawKey) : rawKey;
      requireOnline(allowed.includes(key) && fits(key, player), message);
      out[playerId] = key;
    }
    return out;
  };
  const sub = pick(
    payload?.sub,
    CAMP_SUB_MENUS,
    subMenuFitsPlayer,
    'サブ練習が不正です',
  );
  // ⚠ **対象を取るメニューにだけ付ける**。別の練習に対象が付いていたら、
  //    画面とサーバーの食い違いなので断る（黙って捨てると原因が分からない）
  const subTarget = {};
  for (const [id, value] of Object.entries(payload?.subTarget || {})) {
    const playerId = Number(id);
    const player = byId.get(playerId);
    if (!player || !value) continue;
    const kind = campTargetKind(sub[playerId], player);
    requireOnline(kind, '対象を選べない練習に対象が付いています');
    // ⚠ **磨きたい球種（ownPitch）はその選手の持ち球で照らす**。新球種の表
    //    （`CAMP_PITCH_TYPES`、覚えられる8種）で照らしていたので、スプリット・
    //    ツーシーム・パームを持つ投手に「変化球練習」で選ぶと、そのクールが実行できなかった
    const owned = (player.pitching?.arsenal || [])
      .map((pitch) => pitch?.type)
      .filter((type) => type && type !== 'straight');
    requireOnline(
      kind === 'position'
        ? CONVERT_POSITIONS.includes(value) && value !== 'pitcher'
        : kind === 'form'
          ? CAMP_FORMS.includes(value)
          : kind === 'stance'
            ? CAMP_STANCES.includes(value)
            : kind === 'bats'
              ? CAMP_BATS.includes(value)
            : kind === 'ownPitch'
              ? owned.includes(value)
              : CAMP_PITCH_TYPES.includes(value),
      `練習の対象が不正です（${player.name}）`,
    );
    subTarget[playerId] = value;
  }
  return {
    policy: normalizeCampPolicy(payload?.policy),
    players: campPlayerPolicies(team.players, payload?.players),
    main: pick(payload?.main, CAMP_MENUS, menuFitsPlayer, '練習メニューが不正です'),
    sub,
    subTarget,
  };
}

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
  if (kind === 'pack_select') {
    // ⚠ 決めなかった人にも渡す。空いているセットから、球団名で決まる位置を取る
    //    （乱数だと、やり直しで違うセットになって再現しない）
    // ⚠ **ほかの人が選んだセットは避けること**。標準案も解決のときは
    //    「選んだもの」と同じ扱い（球団名の順）になるので、決めなかった人の
    //    標準案が、ほかの人が自分で選んだセットを先に取っていた
    const member = league.members.find((m) => m.teamName === teamName);
    const wanted = new Set(
      Object.entries(league.phase.submissions || {})
        .filter(([userId]) => userId !== member?.userId)
        .map(([, s]) => s?.plan?.packId)
        .filter(Boolean),
    );
    const free = (league.packs || []).filter((p) => !p.takenBy && !wanted.has(p.id));
    const index =
      [...league.season.settings.teamNames].sort().indexOf(teamName) % Math.max(1, free.length);
    return { packId: free[index]?.id || league.packs?.[0]?.id || null };
  }
  if (kind === 'contract')
    return {
      // ⚠ 監督の時間軸（育成ならベテランを早めに出す）。人の球団で「自分で」なら従来どおり
      releaseIds: getAIReleaseCandidates(
        team.players,
        releaseBiasFor(league, teamName),
      ),
    };
  if (kind === 'camp') {
    // ⚠ 人の球団で「意見を聞く」「任せる」なら、コーチの方針（投手は投手コーチ、
    //    野手は野手コーチ）を選手ごとに。「自分で」・席が空いていれば従来の既定
    const coached = campPlanFor(league, teamName, team.players);
    if (coached) return { menu: 'standard', assignments: {}, ...coached };
    // ⚠ 既定は全体の方針だけ。選手ごとの割り当ては画面で決める
    // ⚠ **人の球団は「おすすめ」を書いておく**（画面の既定と同じ）。方針の無い案は
    //    締め切りの自動実行（`autoResolvePhase` → `submitPhase`）の正規化で
    //    「全員同じ（全体×技術）」に埋まり、`campFallbackPlan` のおすすめに届かなかった
    const human = league.members.some((m) => m.teamName === teamName);
    return human
      ? { menu: 'standard', assignments: {}, policy: { mode: 'recommended' } }
      : { menu: 'standard', assignments: {} };
  }
  if (kind === 'offseason') return {};
  // ⚠ **途中参加でセットを待っている球団は、トライアウトで取らない**。
  //    名簿は次のキャンプでセットに丸ごと入れ替わるので、取った選手は
  //    どこにも残らず消える（プールからは抜けているので世界から居なくなる）
  if (kind === 'tryout' && hasPendingPack(league, teamName))
    return { rankedIds: [], count: 0, total: 0 };
  // ⚠ 監督の考え（育成か勝負か・好む選手）。人の球団で「自分で」なら null（従来どおり）
  const context = tryoutContextFor(league, teamName);
  return seeded(league, `default:${league.phase.id}:${teamName}`, () => {
    const pool = clone(league.phase.candidates);
    const roster = clone(team.players);
    const rankedIds = [];
    // ⚠ **空き枠ぶんまで**（交渉できる人数 `TRYOUT_WISH_MAX` が上限）。以前は候補360人を
    //    全員並べていたが、いまの希望リストは上限があり、それを超えると提出が弾かれる。
    //    標準案は人数を決めない（`total` 無し）ので、尽きたぶんは自動で埋まる
    // ⚠ 並べるのは**自動で埋める人数まで**（標準26人、CPUは26〜27人。`autoRosterTarget`）。
    //    上限（28人）まで並べると、CPUも標準案の人の球団も28人まで取ってしまう
    const room = Math.max(0, autoRosterTarget(league, teamName) - team.players.length);
    const limit = Math.min(room, wishLimit(room));
    while (pool.length && rankedIds.length < limit) {
      // ⚠ オンラインの目標構成（26人）を渡す。既定は一人用の24人で、解決側
      //    （`resolveTryout`）と区分の数がずれていた（監査 2026-11-13）
      const player =
        selectPlayerForAI(pool, roster, context, ONLINE_ROSTER_TARGETS) || pool[0];
      rankedIds.push(player.id);
      roster.push(player);
      pool.splice(
        pool.findIndex((p) => p.id === player.id),
        1,
      );
    }
    return { rankedIds, count: rankedIds.length };
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
      // コーチ打診（先方要望 2026-11-21。`hirePlayerAsCoach`）。役職ごとに1人まで。**無くてもよい**（古い画面・アプリ）
      const offers = plan.coachOffers ?? {};
      requireOnline(
        offers && typeof offers === 'object' && !Array.isArray(offers) &&
          Object.keys(offers).every((role) => role === 'pitching' || role === 'batting'),
        'コーチ打診の指定が不正です',
      );
      const offerIds = Object.values(offers).filter((id) => id != null);
      requireOnline(
        new Set(offerIds).size === offerIds.length &&
          offerIds.every((id) => team.players.some((p) => p.id === id) && !plan.releaseIds.includes(id)),
        'コーチ打診の選手が不正です（名簿に居ない・解雇と重なる・2つの役職に同じ人）',
      );
      const remaining = team.players.filter(
        (p) => !plan.releaseIds.includes(p.id) && !offerIds.includes(p.id),
      );
      requireOnline(
        remaining.length >= Math.min(9, team.players.length),
        '契約後も最低9人は残してください。既に9人未満の場合は新たな退団はできません',
      );
      const coachOffers = Object.fromEntries(Object.entries(offers).filter(([, id]) => id != null));
      // 指導者の異動（先方要望 2026-11-23。`validateStaffMoves`）。**無くてもよい**（古い画面・アプリ）
      const staffMoves = validateStaffMoves(league, teamName, plan.staffMoves);
      return {
        releaseIds: [...plan.releaseIds],
        ...(Object.keys(coachOffers).length ? { coachOffers } : {}),
        ...(staffMoves ? { staffMoves } : {}),
      };
    }
    case 'camp': {
      requireOnline(
        plan.menu === 'standard' || CAMP_MENUS.includes(plan.menu),
        '練習方針が不正です',
      );
      // ⚠ **選手ごとの割り当て**。一人用のキャンプ画面と同じく、1人ずつ
      //    メイン練習とサブ練習を決められる。
      // ⚠ 自分の名簿の選手だけ。他球団の選手を混ぜられると練習が飛ぶ
      const own = new Map(team.players.map((p) => [p.id, p]));
      const assignments = {};
      for (const [id, key] of Object.entries(plan.assignments || {})) {
        const playerId = Number(id);
        if (!own.has(playerId)) continue;
        requireOnline(CAMP_MENUS.includes(key), '練習メニューが不正です');
        // ⚠ 守備位置に合わないもの（野手に球速練習など）は落とす（全体の方針で埋まる）。
        //    弾くと、保存済みの下書きが締め切りで丸ごと標準案に戻ってしまう
        if (!menuFitsPlayer(key, own.get(playerId))) continue;
        assignments[playerId] = key;
      }
      // ⚠ **サブ練習も守備位置を見る**（`campRound` の入口と同じ規則）。
      //    変化球練習を野手に当てても何も起きず、そのクールが丸ごと無駄になる
      const subAssignments = {};
      for (const [id, rawKey] of Object.entries(plan.subAssignments || {})) {
        const playerId = Number(id);
        const player = team.players.find((p) => p.id === playerId);
        if (!player) continue;
        // ⚠ まとめた古い名前（守備補強 → サブポジ練習）は今の名前で残す
        const key = canonicalSubMenu(rawKey);
        requireOnline(
          CAMP_SUB_MENUS.includes(key) && subMenuFitsPlayer(key, player),
          'サブ練習が不正です',
        );
        subAssignments[playerId] = key;
      }
      return {
        menu: plan.menu,
        assignments,
        subAssignments,
        // ⚠ 方針は**やる気**に効く（噛み合うと伸びやすい）。無ければ標準
        policy: normalizeCampPolicy(plan.policy),
        players: campPlayerPolicies(team.players, plan.players),
      };
    }
    case 'pack_select': {
      // ⚠ 居ないセットを受け付けない。解決のときに「足りません」で
      //    手続き全体が止まる（1球団の都合で全員が止まる）
      const ids = new Set((league.packs || []).map((p) => p.id));
      requireOnline(
        typeof plan.packId === 'string' && ids.has(plan.packId),
        '初期メンバーの選択が不正です',
      );
      return { packId: plan.packId };
    }
    case 'tryout': {
      const candidates = new Set(league.phase.candidates.map((p) => p.id));
      // ⚠ 人数が空き枠を超えていても**拒まず空き枠に切る**。下書きを保存したあとトレードで
      //    名簿が増えると、保存済みの人数が空き枠を超える。拒むと締め切りで下書きが捨てられ、
      //    交渉した選手が誰も取られないまま標準案で決まっていた（監査 2026-11-14）
      const room = Math.max(0, ROSTER_LIMIT - team.players.length);
      requireOnline(
        Number.isInteger(plan.count) && plan.count >= 0,
        '獲得人数が不正です',
      );
      requireOnline(
        Array.isArray(plan.rankedIds) &&
          plan.rankedIds.length <= candidates.size &&
          new Set(plan.rankedIds).size === plan.rankedIds.length &&
          plan.rankedIds.every((id) => candidates.has(id)),
        '希望順位に無効・重複した選手がいます',
      );
      // ⚠ **交渉は `TRYOUT_WISH_MAX` 人まで**（獲得する人数より多く並べて、取られたら繰り上げる）。
      //    画面でも止めているが、正本はここ。超えた提出を通すと、画面に出ていない選手まで取りにいく
      requireOnline(
        plan.rankedIds.length <= TRYOUT_WISH_MAX,
        `交渉できるのは${TRYOUT_WISH_MAX}人までです`,
      );
      requireOnline(
        plan.rankedIds.length >= plan.count,
        '獲得希望人数以上の候補を指定してください',
      );
      // ⚠ 獲得する人数（`signTotal`）。**無くてもよい**（古い画面・アプリの提出は
      //    空き枠いっぱいまで取る、前と同じ動き）
      requireOnline(
        plan.total === undefined ||
          (Number.isInteger(plan.total) && plan.total >= 0),
        '獲得する人数が不正です',
      );
      return {
        count: Math.min(plan.count, room),
        rankedIds: [...plan.rankedIds],
        ...(plan.total === undefined ? {} : { total: Math.min(plan.total, room) }),
      };
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

/**
 * 保存する打順を組む（`setRecommendedLineup`）。**組む間だけ疲労と調子を平らにする**。
 * ⚠ 保存した打順は次に組み直すまで毎試合使う。CPU球団は名簿が変わった日（CPU同士のトレード・
 *    プロ指名など）に組み直すので、その日の疲れ・調子で選ぶと、疲れていたレギュラーが外れて
 *    控えの打順のまま何十試合も固まっていた（2026-11-25 の計測で、実際の打順の持ち場の力が
 *    名簿の最良より平均で約20点、ひどい球団で約90点低かった。人の球団の2年目 .534 の一因）。
 * ⚠ その日の疲れは**毎日の休養**（`restTiredFielders`）がその日だけ控えと入れ替える。
 *    保存する打順は「疲れていないときの一番の組」にしておく。
 */
function recommendedLineupForSave(team, name) {
  const saved = team.players.map((p) => [p, p.fatigue, p.condition]);
  for (const p of team.players) {
    p.fatigue = 0;
    p.condition = CONDITION_LEVELS.NORMAL;
  }
  try {
    return setRecommendedLineup(team, name);
  } finally {
    for (const [p, fatigue, condition] of saved) {
      if (fatigue === undefined) delete p.fatigue;
      else p.fatigue = fatigue;
      if (condition === undefined) delete p.condition;
      else p.condition = condition;
    }
  }
}
/**
 * 手続きの後の先発ローテと打順。CPUは作り直す。
 * ⚠ **人の球団は、保存した編成がまだ成り立つならそのまま残す**。以前は全球団を
 *    作り直していたため、キャンプの間に決めた打順・ローテが開幕の時点で
 *    おすすめに戻っていた（手続き中も編成画面は開けて保存できる）。
 *    ローテの投手が名簿から消えた・打順が埋まらないときだけ作り直す。
 */
function refreshTeamPlan(league, name, { force = false } = {}) {
  const team = TEAMS_DATA[name];
  // 名簿に居なくなった投手（トレード・退団）の予告先発を消す
  pruneDepartedPicks(league, name, team);
  const member = league.members.find((m) => m.teamName === name);
  const human = !!member;
  // ⚠ 人の球団でも、スタメン・投手起用を**指導者に任せた**分野はCPUと同じく作り直す
  //    （任せていない分野は、成り立つ限り人の編成を残す）
  const modes = human ? effectiveStaffModes(league, member) : null;
  const ownLineup = human && modes.lineup !== 'delegate';
  const ownPitching = human && modes.pitching !== 'delegate';
  // ⚠ 任せている間は**指導者が考えて並べた順**（能力の順）を `pitcherOrder` に写して、
  //    画面の順も同じにする（`recordCoachReliefOrder`。いしだ 2026-11-20 判断4「おすすめで」）
  const delegated = human && !ownPitching;
  if (human && !force && ownLineup !== ownPitching) {
    if (!ownPitching) {
      generatePitchingRotation(name);
      recordCoachReliefOrder(team);
      alignReliefOrder(team);
    }
    if (!ownLineup) {
      const registered = new Map(team.players.map((p) => [p.id, p.position]));
      recommendedLineupForSave(team, name);
      for (const player of team.players)
        if (registered.has(player.id)) player.position = registered.get(player.id);
    }
  }
  // ⚠ `force` は**守備位置の登録を変えたとき**に使う。残した編成はそのままだと
  //    「野手になった選手が登板順に残る」「投手になった選手が守備に就く」まま
  //    保たれてしまう（`ensureCompleteLineup` は登録の変更までは見ない）
  if (human && !force && (ownLineup || ownPitching)) {
    const ids = new Set(team.players.map((p) => p.id));
    const starters = team.pitchingRotation?.starters || [];
    // ⚠ 次の先発が野手の打順にも入っている（二刀流）とき、そのまま
    //    `ensureCompleteLineup` に渡すと野手の枠から外したまま保存される。
    //    控えに一時的に任せて確かめ、すぐ戻す（試合の日と同じ扱い）
    const undoTwoWay =
      starters.length > 0 && starters.every((id) => ids.has(id))
        ? benchTwoWayStarter(team)
        : null;
    const complete = undoTwoWay ? ensureCompleteLineup(team, false) : false;
    undoTwoWay?.();
    if (complete) {
      syncRelievers(team);
      alignReliefOrder(team);
      return;
    }
  }
  generatePitchingRotation(name);
  if (delegated) recordCoachReliefOrder(team);
  if (human) alignReliefOrder(team);
  // ⚠ **守備位置の登録を書き換えさせない**。CPUの打順作り（`generateAILineup`）は
  //    スタメンに入れた選手の登録をその日の守備位置に書き換える（一人用の試合の
  //    写しでの作り）。保存する名簿に当てると、二刀流の投手が「右翼手」になって
  //    ローテに残る・一塁手が三塁手に変わる、が黙って起きていた。守備位置は
  //    打順の側（`lineupSettings`）にあるので、登録は元に戻してよい
  const registered = new Map(team.players.map((p) => [p.id, p.position]));
  recommendedLineupForSave(team, name);
  for (const player of team.players)
    if (registered.has(player.id)) player.position = registered.get(player.id);
}

/**
 * 残した投手起用の**救援の欄**を名簿に合わせる。
 *
 * ⚠ 先発ローテが揃っていれば編成はそのまま残すが、救援（中継ぎ・セットアッパー・
 *    守護神）は見ていなかった。トレード・トライアウト・退団で
 *    - 出した救援投手が欄に残る（守護神が居ない球団になる）
 *    - 入ってきた投手がどの欄にも入らず、**試合で1度も投げない**
 *      （画面の投手起用には「おまかせ」の救援として出るので、気づけない）
 *    ことになっていた。居ない投手を外し、どこにも居ない投手を中継ぎに足す。
 *    役割（`pitcherRoles`）が無い投手は「おまかせ」として扱われる（`roleFor`）。
 */
function syncRelievers(team) {
  const rotation = team.pitchingRotation;
  if (!rotation) return;
  const active = team.players.filter((p) => p.isActive !== false);
  // ⚠ 投手起用に加えた野手（二刀流）は欄に残す。足すのは投手登録の選手だけ
  //    （野手を全員「おまかせ」の救援にしない）
  const staff = new Set([
    ...(rotation.starters || []),
    ...(rotation.setupMen || []),
    ...(rotation.middleRelievers || []),
    ...(rotation.closer != null ? [rotation.closer] : []),
    ...Object.keys(rotation.pitcherRoles || {}).map(Number),
  ]);
  const pitchers = active
    .filter((p) => p.position === 'pitcher' || (p.pitching && staff.has(p.id)))
    .map((p) => p.id);
  const present = new Set(pitchers);
  const starters = new Set(rotation.starters || []);
  rotation.setupMen = (rotation.setupMen || []).filter((id) => present.has(id));
  if (rotation.closer != null && !present.has(rotation.closer))
    rotation.closer = null;
  const assigned = new Set([
    ...rotation.setupMen,
    ...(rotation.closer != null ? [rotation.closer] : []),
  ]);
  const middle = (rotation.middleRelievers || []).filter(
    (id) => present.has(id) && !starters.has(id) && !assigned.has(id),
  );
  for (const id of pitchers)
    if (!starters.has(id) && !assigned.has(id) && !middle.includes(id))
      middle.push(id);
  rotation.middleRelievers = middle;
  rotation.relievers = pitchers.filter((id) => !starters.has(id));
  if (rotation.pitcherRoles)
    for (const id of Object.keys(rotation.pitcherRoles))
      if (!present.has(Number(id))) delete rotation.pitcherRoles[id];
}

/** 投手起用の画面に出る投手陣（`pitchingFromLineup` と同じ。投手登録＋加えた野手） */
function reliefStaffOf(team) {
  const rotation = team.pitchingRotation || {};
  const starters = rotation.starters || [];
  return team.players.filter(
    (p) =>
      isPitcher(p) ||
      (isStaffableFielder(p) &&
        (starters.includes(p.id) ||
          Object.hasOwn(rotation.pitcherRoles || {}, String(p.id)))),
  );
}

/**
 * 投手起用を**指導者に任せた**人の球団: 指導者が並べた救援の順（`generatePitchingRotation` の
 * 能力の順の欄。守護神・セットアッパー・中継ぎの順）を `pitcherOrder` に写す。
 *
 * ⚠ いしだ 2026-11-20 判断4「おすすめで」。`alignReliefOrder` だけだと、任せた球団も
 *    同じ役割の中を名簿の並び（または任せる前に人が並べた古い順）で起用していた。
 *    任せている間は指導者の考えた順で投げ、画面にもその順で出す。
 *    自分で起用している球団（`pitcherOrder` は人の▲▼の順）には呼ばない。
 *    任せる→自分で、に切り替えたときは、ここで書いた順がそのまま初めの順になる。
 * ⚠ 形は保存（`lineupTactics` の `reliefOrderOf`）と同じにする（画面に出る投手陣だけ・
 *    欄に無い投手は名簿の並びで後ろ）。違う形だと、任せたまま打順だけ保存したときに
 *    順番が「変わった」に数えられ、投手起用が「意見を聞く」に戻ってしまう（`saveLineup`）。
 *    同じ順なら書き直しても形は変わらない（画面の編集が 409 で弾かれない）。
 */
function recordCoachReliefOrder(team) {
  const rotation = team.pitchingRotation;
  if (!rotation) return;
  const coachOrder = [
    ...(rotation.closer != null ? [rotation.closer] : []),
    ...(rotation.setupMen || []),
    ...(rotation.middleRelievers || []),
  ];
  const order = reliefOrderOf(coachOrder, reliefStaffOf(team));
  const before = rotation.pitcherOrder || [];
  if (order.length === before.length && order.every((id, i) => id === before[i])) return;
  rotation.pitcherOrder = order;
}

/**
 * 人の球団の救援の欄（`setupMen` / `middleRelievers` / `relievers`）を、投手起用の画面に
 * 出る「同じ役割の中の順」に並べ直す。
 *
 * ⚠ 2026-11-20 監査。画面（`pitchingFromLineup` → `reliefOrderOf`）は保存した
 *    `pitcherOrder`、無ければ名簿の並びで役割の中を並べ、試合（`autoSimulation`）は
 *    `middleRelievers` / `setupMen` の並びの先頭から使う。保存（`lineupTactics`）は
 *    その順で欄を作るが、**作り直す経路**（投手起用を任せた球団・守備位置の変更の
 *    `force`・一度も保存していない球団）は `generatePitchingRotation` の**能力の順**の
 *    欄のままで、画面の▲▼の順と別の投手が先に出ていた。
 *    役割は変えない。並びの決め方は画面と同じ関数（`reliefOrderOf`）を使う。
 * ⚠ `pitcherOrder` は書き足さない（並べ替えたことのない球団の画面へ返す形を変えない。
 *    `lineupTactics.mjs` の注）。ただし投手起用を任せた球団は、先に `recordCoachReliefOrder`
 *    で指導者の順を書いてから呼ぶ（判断4）。
 */
function alignReliefOrder(team) {
  const rotation = team.pitchingRotation;
  if (!rotation) return;
  const starters = rotation.starters || [];
  const staff = reliefStaffOf(team);
  const order = reliefOrderOf(rotation.pitcherOrder, staff);
  const rank = (id) => {
    const at = order.indexOf(id);
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  const byOrder = (ids) => [...ids].sort((a, b) => rank(a) - rank(b));
  rotation.setupMen = byOrder(rotation.setupMen || []);
  rotation.middleRelievers = byOrder(rotation.middleRelievers || []);
  rotation.relievers = byOrder(
    staff.map((p) => p.id).filter((id) => !starters.includes(id)),
  );
}

/**
 * 初期メンバー選択を解決する。
 *
 * ⚠ **同じセットは1球団だけ**。選手のidと名前が重複すると、記録が
 *    どちらの選手のものか分からなくなる。
 * ⚠ 取り合いになったら**球団名の順で決める**。乱数で決めると、同じ
 *    やり直しで違う結果になって再現しなくなる。
 * ⚠ 選ばなかった球団（CPU・未提出の人）には、残りから順に配る。
 */
function resolvePackSelect(league, plans) {
  const names = league.season.settings.teamNames;
  const packs = league.packs || [];
  const byId = new Map(packs.map((p) => [p.id, p]));
  const assigned = {};
  // 1) 選んだ球団から。球団名の順に見て、空いていれば渡す
  for (const name of [...names].sort()) {
    const wanted = plans[name]?.packId;
    const pack = wanted ? byId.get(wanted) : null;
    if (pack && !pack.takenBy) {
      pack.takenBy = name;
      assigned[name] = pack;
    }
  }
  // 2) 残りを順に配る
  const free = packs.filter((p) => !p.takenBy);
  for (const name of names) {
    if (assigned[name]) continue;
    const pack = free.shift();
    requireOnline(pack, `${teamLabelIn(league, name)}に渡す初期メンバーが足りません`, 409);
    pack.takenBy = name;
    assigned[name] = pack;
  }
  for (const name of names) {
    const team = TEAMS_DATA[name];
    // ⚠ 複製を入れること。`league.packs` は手続きが終わると消えるが、
    //    参照のまま渡すと保存の形が絡まる
    team.players = clone(assigned[name].players);
    for (const player of team.players) {
      player.careerHistory = [
        ...(player.careerHistory || []),
        { type: 'independent', year: league.season.year, label: name },
      ];
    }
  }
  // ⚠ **打順と投手起用を作ること**。渡した名簿だけでは試合が組めない。
  //    付け忘れると、打順が空のまま開幕して画面も壊れる（実測で
  //    `battingOrder` に2番が無く、打順の入れ替えが例外になった）。
  for (const name of names) refreshTeamPlan(league, name);
  // ⚠ 配り終えたら捨てる。480人ぶんを抱えたままにしない
  delete league.packs;
}

function resolveTryout(league, plans, now) {
  const phase = league.phase;
  // ⚠ 指名順は**前年の順位が上の球団から**（いしだ要望:「順位を上げることの
  //    ご褒美」）。同じ選手を複数の球団が希望したら、順位が上の球団が取る。
  //    以前は逆（弱い球団から）で、スネーク（巡ごとに逆順）だった。
  //    ⚠ スネークにしないこと。巡ごとに逆順にすると、2巡目は最下位の球団が
  //       先に取ることになり、「順位が上なら先に取れる」と食い違う。
  //    ⚠ 勝率が同じ球団は球団名で決める（毎回同じ順にするため。`winRate` だけで
  //       並べると、同率の2球団の前後が実行ごとに変わりうる）
  const names = tryoutPickOrder(league.season.standings);
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
  // ⚠ 巡目は**枠の数**から取る。直に書くと、枠を増やしたときに取り残される
  // ⚠ **毎回同じ順**（スネークではない）。上の `names` の理由と同じ
  const order = Array.from({ length: ROSTER_LIMIT }, (_, round) =>
    names.map((team) => ({ round: round + 1, team })),
  ).flat();
  const picksLeftOf = Object.fromEntries(names.map((name) => [name, 0]));
  for (const pick of order) picksLeftOf[pick.team] += 1;
  // ⚠ **獲得する人数**（`signTotal`）。参加者が決める（空き枠＝上限28人まで）。CPU球団と、決めていない提出は
  //    自動で埋める人数まで（`autoRosterTarget`。人の球団は標準26人、CPUは26〜27人）。
  //    先方指摘「指名選手の人数を決められない」
  // ⚠ **初期メンバーを待っている球団は0人**（提出の中身によらない）。名簿は次のキャンプで
  //    セットに丸ごと入れ替わるので、取った選手は世界から消える（`defaultPhasePlan` の注）。
  //    `total` の無い提出は自動で埋める人数まで取るので、ここで止めないと26人まで取っていた
  const totalOf = Object.fromEntries(
    names.map((name) => [
      name,
      hasPendingPack(league, name)
        ? 0
        : signTotal(
            plans[name],
            ROSTER_LIMIT - TEAMS_DATA[name].players.length,
            // 決めていない案は自動で埋める人数まで（標準26人・CPUは26〜27人）
            autoRosterTarget(league, name) - TEAMS_DATA[name].players.length,
          ),
    ]),
  );
  // 交渉したのに他球団に取られた選手（実際に取りにいった所まで。`tryoutResults` の lost）
  const lostOf = Object.fromEntries(names.map((name) => [name, new Set()]));
  // 交渉の何位で取れたか（画面の「トライアウトの結果」に出す）
  const wishOf = (name, id) => {
    const at = plans[name]?.rankedIds?.indexOf(id) ?? -1;
    return at >= 0 ? at + 1 : null;
  };
  for (const pick of order) {
    // この指名を含めて、この球団に残っている指名の回数
    const picksLeft = picksLeftOf[pick.team]--;
    const team = TEAMS_DATA[pick.team];
    const plan = plans[pick.team];
    const roster = [...team.players, ...acquired[pick.team]];
    const { needPitcher, needCatcher, needFielders } = shortfall(roster);
    const slotsLeft = ROSTER_LIMIT - roster.length;
    const mustFill = (needPitcher ? 1 : 0) + needFielders;
    // ⚠ 交渉した人数（`plan.count`）に達したら交渉リストからは取らない（`planFull`）。
    //    その先は獲得する人数（`totalOf`）まで、**`total` の無い案だけ**CPUと同じ判断で埋める
    //    （`fillsAutomatically`。下の注）。`total` を決めた提出は交渉した選手しか取らない。
    //    ⚠ 0人も選べる。打ち切っていた頃は、投手・捕手・野手が足りない球団が
    //       1つあるだけで下の検査に落ち、**全員のトライアウトが解決できずに
    //       止まった**（締め切りの自動解決も同じ所で失敗する）。
    const planFull = !!plan && acquired[pick.team].length >= plan.count;
    if (slotsLeft <= 0) continue;
    // ⚠ 獲得する人数に届いたら、それ以上は取らない。ただし最低限（投手1・捕手1・
    //    野手8）に届かないぶんだけは補う。補わないと下の検査に落ちて、
    //    **全員のトライアウトが解決できずに止まる**
    const reached = acquired[pick.team].length >= totalOf[pick.team];
    if (reached && mustFill <= 0) continue;
    // 足りないものから順に埋める（投手 → 捕手 → 野手）
    const pickForShortfall = () => {
      const want = needPitcher
        ? isPitcher
        : needCatcher
          ? (p) => p.position === 'catcher'
          : (p) => !isPitcher(p);
      const pool = remaining.filter(want);
      // ⚠ **交渉した選手に足りない位置の人が居れば、その人から**（交渉の上から）。画面は
      //    「その位置の選手と交渉してください」と勧めているのに、補うときだけCPUの判断で
      //    別の選手を入れていた（監査 2026-11-14）
      const wished = (plan?.rankedIds || [])
        .map((id) => pool.find((p) => p.id === id))
        .find(Boolean);
      if (wished) return wished;
      return pool.length
        ? selectPlayerForAI(pool, roster, null, ONLINE_ROSTER_TARGETS) || pool[0]
        : null;
    };
    let forced = null;
    // ⚠ 残りの**指名回数**でも判定する。枠（上限28人）だけで見ていると、希望順位の
    //    候補が全員他球団に取られて指名を見送り続けた球団は、枠が空いたまま
    //    巡目が尽き、最低限の構成に届かずにトライアウト全体が解決できなかった。
    if (reached || slotsLeft <= mustFill || picksLeft <= mustFill)
      forced = pickForShortfall();
    // CPUと同じ判断で選ぶ。
    // ⚠ CPUにも**オンラインの目標構成**を渡す。既定（一人用の24人）だと
    //    CPUだけ24人で止まり、人の球団だけ26人になる
    // ⚠ 監督の考え（育成か勝負か・好む選手）を渡す（`coachEngine.tryoutContextFor`）
    const auto = () =>
      selectPlayerForAI(
        remaining,
        roster,
        tryoutContextFor(league, pick.team),
        ONLINE_ROSTER_TARGETS,
      );
    // ⚠ 希望順のとおりに取る（飛ばさない）。自分で選ぶ形なので、
    //    1位を飛ばされると何を選んだのか分からなくなる
    const fromPlan =
      plan && !planFull && !reached
        ? nextFromPlan(
            plan.rankedIds
              .map((id) => remaining.find((p) => p.id === id))
              .filter(Boolean),
          )
        : null;
    // ⚠ 取りにいった希望より上で、もう残っていない（自分以外が取った）選手は「取られた」。
    //    人数で切った位置（`total`）で数えると、繰り上がって取りにいった下位の希望が漏れる
    if (plan && !planFull && !reached && !forced) {
      for (const id of plan.rankedIds) {
        if (fromPlan && id === fromPlan.id) break;
        if (!remaining.some((p) => p.id === id) && !acquired[pick.team].some((p) => p.id === id))
          lostOf[pick.team].add(id);
      }
    }
    // ⚠ **獲得する人数を自分で決めた提出（`total` がある）は、交渉した選手しか取らない**
    //    （先方指摘「希望選手が取れなかった場合、選んでいない選手が入団してしまう」）。
    //    取られたぶんは交渉リストの下が繰り上がり、リストが尽きたらそこで止める
    //    （最低限に届かないぶんだけは下で補う）。だから交渉リストは獲得する人数より
    //    多く持てる（`TRYOUT_WISH_MAX`）。
    // ⚠ 人数を決めていない案（CPU・標準案・指導者の案・古い提出）は従来どおり、
    //    希望が尽きても CPU と同じ判断で枠を埋める。埋めないと名簿が21人などで終わり、
    //    控えの数でそのまま不利になる（実測で自分21人・CPU26人）
    const fills = !plan || fillsAutomatically(plan);
    let player = forced || (reached ? null : fromPlan || (fills ? auto() : null));
    // 希望順位の候補が尽きても、最低限が欠けていれば必要な守備位置から補う
    if (!player && mustFill > 0) player = pickForShortfall();
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
      `${teamLabelIn(league, name)}の投手・捕手・野手が不足します。希望順位を見直してください`,
      409,
      'roster',
    );
    team.players = combined;
  }
  // 取引の記録（入団）。球団ごとに1件。前の所属（他球団を退団した選手）も残す
  for (const name of names)
    recordTransaction(
      league,
      {
        kind: 'signing',
        teams: [name],
        moves: allPicked
          .filter((p) => p.team === name)
          .map(({ player }) => moveOf(player, player.previousTeam || null, name)),
      },
      now,
    );
  for (const { team, player, round } of allPicked) {
    player.draftInfo = { year: league.season.year, round };
    player.careerHistory = [
      ...(player.careerHistory || []),
      { type: 'independent', year: league.season.year, label: team },
    ];
  }
  // ⚠ **取った選手をプールから消すこと**。残すと翌年のトライアウトに
  //    同じ選手がもう一度出てくる
  {
    const ids = allPicked.map((p) => p.player.id);
    updateReleasedPoolAfterTryout(ids);
    removeDraftedFromGraduatePools(
      ids,
      allPicked.map((p) => p.player),
    );
    removeDraftedFromClubTeams(ids);
  }
  // ⚠ **参加者ごとの結果を残す**（先方指摘「トライアウト後の入団選手の一覧が無く、
  //    誰が入ったか分からない」）。リーグ便りには全球団の指名が混ざって並ぶだけで、
  //    自分の球団に誰が来たか・交渉した人が取られたのかが読めなかった。
  //    `campResults` と同じく次のトライアウトまで残し、ビューの `lastTryout` で出す。
  // ⚠ 交渉した選手を**どこが取ったか**は本人にだけ見せる（交渉の中身はほかの人に見せない）
  const takenBy = new Map(allPicked.map(({ team, player }) => [player.id, team]));
  const candidateById = new Map(phase.candidates.map((p) => [p.id, p]));
  const brief = (player) => ({
    playerId: player.id,
    name: player.name,
    position: player.position,
    age: player.age,
  });
  league.tryoutResults = Object.fromEntries(
    (league.members || [])
      .filter((m) => !m.packSeed && acquired[m.teamName])
      .map((m) => {
        const plan = plans[m.teamName];
        return [
          m.userId,
          {
            year: league.season.year,
            total: totalOf[m.teamName],
            picks: allPicked
              .filter((p) => p.team === m.teamName)
              .map(({ player, round }) => ({
                ...brief(player),
                round,
                wish: wishOf(m.teamName, player.id),
              })),
            lost: (plan?.rankedIds || [])
              .filter(
                (id) =>
                  lostOf[m.teamName].has(id) &&
                  takenBy.has(id) &&
                  takenBy.get(id) !== m.teamName,
              )
              .map((id) => ({
                ...brief(candidateById.get(id) || { id, name: '?' }),
                wish: wishOf(m.teamName, id),
                takenBy: takenBy.get(id),
              })),
          },
        ];
      }),
  );
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
  for (const name of names) refreshTeamPlan(league, name);
}

/**
 * 投手起用を**自分で**組んでいる人の先発ローテに、引退・退団・トレードで空いた枠があれば
 * 指導者の案（`generatePitchingRotation` と同じ選び方）で埋め、お知らせで伝える。キャンプの終わり
 * （開幕の前）に1回だけ呼ぶ。
 * ⚠ 人の編成は成り立つ限り残す（`refreshTeamPlan`）ので、ローテの投手が引退すると
 *    その分だけ短いローテのまま翌年を迎えていた。何もいじらない人の球団は数年で
 *    ローテが1〜2人になり、先頭が年220回を投げていた（10年の長期シミュ）。
 *    埋めるのは**人が保存したときの人数まで**（`plannedStarters`。4人で回すと決めた人に
 *    5人目を足さない）。一度も保存していなければ指導者の案と同じ5人まで。
 *    守護神・セットアッパーに置いた投手は動かさない。
 * @returns 埋めた `{ team, ids }` の一覧
 */
export function refillOwnRotations(league, now) {
  const filled = [];
  for (const member of league.members) {
    const name = member.teamName;
    const team = TEAMS_DATA[name];
    const rotation = team?.pitchingRotation;
    if (!rotation?.starters || hasPendingPack(league, name)) continue;
    if (effectiveStaffModes(league, member).pitching === 'delegate') continue;
    const want = rotation.plannedStarters ?? ROTATION_DEFAULT;
    if (rotation.starters.length >= want) continue;
    // 指導者の案（名簿の写しで作る。今の編成には触らない）
    const plan = { players: team.players };
    generatePitchingRotation(name, plan);
    const keep = new Set([rotation.closer, ...(rotation.setupMen || []), ...rotation.starters].filter(Boolean));
    const added = [];
    for (const id of plan.pitchingRotation?.starters || []) {
      if (rotation.starters.length >= want) break;
      if (keep.has(id)) continue;
      rotation.starters.push(id);
      added.push(id);
      if (plan.pitchingRotation.pitcherRoles?.[id])
        (rotation.pitcherRoles ||= {})[id] = plan.pitchingRotation.pitcherRoles[id];
    }
    if (!added.length) continue;
    const moved = new Set(added);
    rotation.middleRelievers = (rotation.middleRelievers || []).filter((id) => !moved.has(id));
    const names = added.map((id) => team.players.find((p) => p.id === id)?.name).filter(Boolean);
    pushInbox(
      league,
      member.userId,
      {
        type: 'rotationFilled',
        text: `先発ローテの空いた枠に、指導者が${names.join('・')}を入れました（投手起用で変えられます）`,
      },
      now,
    );
    filled.push({ team: name, ids: added });
  }
  return filled;
}
/** 一度も投手起用を保存していない人のローテの人数（指導者の案 `generatePitchingRotation` の上限） */
const ROTATION_DEFAULT = 5;

/**
 * 年度更新の後に**捕手が1人も居ない**対人リーグの球団へ、捕手を1人補う。
 * ⚠ トライアウトは年度更新（引退）より前にあるので、捕手1人の球団はその人が引退すると
 *    翌年のトライアウトまで1年ずっと捕手なしになる（10年の長期シミュで起きた。野手がマスクを
 *    かぶるので試合は壊れないが、リードと捕手の守備がずっと野手の値になる）。
 *    放出された選手（`releasedPlayersPool`）の捕手から、居なければ対人リーグの外（大学を除く）で
 *    捕手を3人以上持つ球団の3人目より後ろから、いちばん良い捕手を入れる。入団の履歴に残す。
 * ⚠ 名簿の上限（28人）に届いている球団には足さない（引退の後なので、まず起きない）
 * @returns 補った `{ team, player }` の一覧
 */
export function fillMissingCatchers(league, now) {
  const isCatcher = (p) => p.position === 'catcher';
  const score = (p) =>
    (p.fielding?.defense || 0) + (p.catching?.lead ?? 30) + (p.batting?.meet || 0) * 0.5;
  const inLeague = new Set(league.season.settings.teamNames);
  const added = [];
  for (const name of league.season.settings.teamNames) {
    const team = TEAMS_DATA[name];
    if (!team || team.players.some(isCatcher)) continue;
    if (team.players.length >= ROSTER_LIMIT) continue;
    // 候補: 放出された捕手 → 外の球団の、2人目より後ろの捕手
    const pooled = releasedPlayersPool.filter(isCatcher).map((p) => ({ p, from: null }));
    const outside = pooled.length
      ? []
      : Object.entries(TEAMS_DATA)
          // ⚠ 大学は在学生の名簿が正本（CLAUDE.md）なので取らない。2人目までの捕手も取らない
          //    （以前は在学中の大学生や、外の球団の正捕手を入れることがあった。2026-11-24 監査）
          .filter(([n, t]) => !inLeague.has(n) && !t.universityData && !t.universityTeamId)
          .flatMap(([n, t]) =>
            (t.players || [])
              .filter(isCatcher)
              .sort((a, b) => score(b) - score(a))
              .slice(2)
              .map((p) => ({ p, from: n })),
          );
    const best = [...pooled, ...outside].sort((a, b) => score(b.p) - score(a.p))[0];
    if (!best) continue;
    const { p, from } = best;
    if (from) {
      cleanupPlayerReferences(TEAMS_DATA[from], p.id);
      TEAMS_DATA[from].players = TEAMS_DATA[from].players.filter((x) => x.id !== p.id);
    } else releasedPlayersPool.splice(releasedPlayersPool.indexOf(p), 1);
    const player = { ...p, isStarter: false, battingOrder: 0 };
    player.careerHistory = [
      ...(player.careerHistory || []),
      { type: 'independent', year: league.season.year, label: name },
    ];
    team.players.push(player);
    recordTransaction(
      league,
      { kind: 'signing', teams: [name], moves: [moveOf(player, from || player.previousTeam || null, name)] },
      now,
    );
    added.push({ team: name, player });
  }
  return added;
}

/**
 * 参加者の球団の、選手ごとの能力の写し（年度更新の前後を比べるため）。
 * ⚠ 途中参加でセットを待っている球団は取らない（名簿がキャンプで入れ替わる）
 */
function snapshotMemberTeams(league) {
  const out = {};
  for (const member of league.members || []) {
    if (member.packSeed) continue;
    const team = TEAMS_DATA[member.teamName];
    if (!team?.players) continue;
    out[member.userId] = team.players.map((p) => ({
      id: p.id,
      name: p.name,
      age: p.age,
      position: p.position,
      abilities: abilitySnapshot(p),
    }));
  }
  return out;
}

/**
 * 年度更新の結果（参加者ごと）。伸び・衰えは `campResults` と同じ形の `gains`、
 * 名簿から居なくなった選手（引退）は `departed` に名前で残す。
 * ⚠ 画面はこれだけを読む。差を画面で作ると、別の端末で見たときに前が無い
 */
function offseasonChanges(league, before, year) {
  const out = {};
  for (const [userId, players] of Object.entries(before)) {
    const member = league.members.find((m) => m.userId === userId);
    const team = member && TEAMS_DATA[member.teamName];
    if (!team?.players) continue;
    const now = new Map(team.players.map((p) => [p.id, p]));
    const gains = {};
    const departed = [];
    for (const old of players) {
      const player = now.get(old.id);
      if (!player) {
        departed.push({ id: old.id, name: old.name, age: old.age, position: old.position });
        continue;
      }
      const diff = abilityGains(old.abilities, abilitySnapshot(player));
      if (Object.keys(diff).length) gains[old.id] = diff;
    }
    out[userId] = { year, gains, departed };
  }
  return out;
}

function resolvePhase(league, now) {
  const kind = league.phase.kind;
  // ⚠ 途中参加でセットを待っている人は提出しないことがある（`submitPhase`）。
  //    その球団はCPUが動かしているので、標準案で決める
  // ⚠ **指導者に任せた手続きは、提出があっても指導者の案で決める**（提出は「確認した」の印だけ）。
  //    自分で決めたいときは画面で任せ方を「意見を聞く」に戻してから出す。
  //    だからその人の決定は待たない（`waitsFor`）
  // ⚠ **おるすばん（`member.away`）で任せた扱いになった人でも、自分で出した案があればそれを使う**。
  //    留守の印は「決めていない分を指導者が埋める」ためのもので、出した決定を上書きしない
  const plans = Object.fromEntries(
    league.members.map((m) => [
      m.teamName,
      (phaseDelegated(league, { ...m, away: false })
        ? null
        : league.phase.submissions[m.userId]?.plan) ||
        defaultPhasePlan(league, m.teamName),
    ]),
  );
  if (kind === 'pack_select') resolvePackSelect(league, plans);
  if (kind === 'tryout') resolveTryout(league, plans, now);
  if (kind === 'contract') {
    for (const name of league.season.settings.teamNames) {
      const ids =
        plans[name]?.releaseIds ||
        getAIReleaseCandidates(
          TEAMS_DATA[name].players,
          releaseBiasFor(league, name),
        );
      // コーチ打診（人の球団だけ。`hirePlayerAsCoach`）。⚠ 解雇と違い、トライアウトの受験者（`releasePlayers` の
      //    退団者の池）には入れない。名簿から外して、年度更新でコーチの席に就く
      const offers = Object.entries(plans[name]?.coachOffers || {});
      const coached = [];
      for (const [role, id] of offers) {
        const team = TEAMS_DATA[name];
        const player = team.players.find((p) => p.id === id);
        if (!player) continue;
        hirePlayerAsCoach(league, name, player, role, careerSummaryOf(league, keyFor(name, player), player.position === 'pitcher'));
        coached.push(player);
        cleanupPlayerReferences(team, player.id);
        team.players = team.players.filter((p) => p.id !== player.id);
      }
      if (coached.length) refreshTeamPlan(league, name);
      // 指導者の異動（人の球団だけ）。年度更新で動く（`reserveStaffMoves` → `applyStaffMoves`）。
      // ⚠ 締め切りまでに席が空いていたら（いまは契約更改の間に席は動かないが念のため）検め直して落とす
      if (league.coaches && plans[name]?.staffMoves) {
        let moves = null;
        try {
          moves = validateStaffMoves(league, name, plans[name].staffMoves);
        } catch {
          moves = null;
        }
        reserveStaffMoves(league, name, moves);
      }
      // 取引の記録（退団）。⚠ 名簿から消す前に名前を控える
      const leaving = [...coached, ...TEAMS_DATA[name].players.filter((p) => ids.includes(p.id))];
      releasePlayers(name, ids, league.season.year);
      recordTransaction(
        league,
        { kind: 'release', teams: [name], moves: leaving.map((p) => moveOf(p, name, null)) },
        now,
      );
    }
  }
  if (kind === 'camp') {
    // ⚠ **自分で回したクールは数えること**。人の球団は画面で1クールずつ
    //    実行する（`runCampRound`）。締め切りで残りだけを回す。
    //    数えないと、自分で4回やった球団がもう4回やって8クールぶん成長する。
    const done = (league.phase.camp ||= {});
    // ⚠ **CPU球団の空いた席はキャンプの終わりに埋める**（人の球団がキャンプの間に
    //    市場から先に選べるように）。練習より前に埋めて、新しいコーチの方針で練習する
    if (league.coaches) fillVacancies(league);
    const leagueTeams = new Set(league.season.settings.teamNames);
    for (const [name, team] of Object.entries(TEAMS_DATA)) {
      if (!team.players?.length) continue;
      const member = league.members.find((m) => m.teamName === name);
      const state = member ? (done[member.userId] ||= { rounds: 0 }) : null;
      const already = state?.rounds || 0;
      // ⚠ 自分で回したときの指示があればそれを使う（残りのクールも同じ方針で）。
      //    無ければ提出した案、それも無ければ標準
      // ⚠ **いまキャンプを任せている人は、自分で回したときの指示を使わない**（指導者の方針で回す）。
      //    自分で回すと任せ方は「意見を聞く」に戻る（`takeBackCamp`）ので、ここで任せているのは
      //    回したあとに任せ直した人。画面の文（`coachView.mjs` の `phasePlanBy`「残りのクールは
      //    指導者の方針で回ります」）と、ほかの任せた手続き（提出があっても指導者の案）に揃える。
      //    以前は任せ直しても、最後に自分で実行した指示で残りが回っていた（再監査 A3）
      // ⚠ おるすばんで任せた扱いになっただけなら、自分で回したときの指示を使う（`plans` と同じ）
      const saved =
        member && !phaseDelegated(league, { ...member, away: false })
          ? done[member.userId]?.plan
          : null;
      // ⚠ CPU球団（このリーグの）はコーチの方針。世界のほかの球団は従来どおり
      const plan =
        plans[name] ||
        (!member && leagueTeams.has(name)
          ? campPlanFor(league, name, team.players)
          : undefined);
      const rest = saved || campFallbackPlan(member, plan);
      // ⚠ **乱数は球団ごとに引き直す**（リーグの種×年×球団）。手続き全体の1本の乱数を
      //    回すと、ほかの球団のメニュー（集中練習の代償・新球種の抽選）で引く回数が変わる
      //    だけで、自分の球団の伸びが入れ替わっていた（2026-11-16、キャンプの確率を
      //    変えたら別の球団の検査値が倍・半分に振れた）
      withSeededRandom(hashSeed(`${league.seed}:${league.season.year}:camp:${name}`), () => {
        for (let round = already; round < CAMP_ROUNDS; round += 1) {
          const result = runCampRound(league, name, rest, {
            lastRound: round === CAMP_ROUNDS - 1,
          });
          if (state) recordCampRound(state, result);
        }
      });
    }
    // 最終クールの応答では phase が消えるため、完了結果を別に残す。
    // 初期名簿へ入れ替わる球団には、入れ替え前のCPU選手の成果を見せない。
    // ⚠ 記録の無い人を飛ばすこと。版を上げる前に自分で4クール済ませた人は
    //    `last` を持たず（`clone(undefined)` は例外）、名簿の無い球団は
    //    `done` に入らない。ここで投げると締め切りが進まず、リーグが止まる
    league.campResults = Object.fromEntries(
      league.members
        .filter((m) => !m.packSeed && done[m.userId])
        .map((m) => {
          const state = done[m.userId];
          return [
            m.userId,
            {
              year: league.season.year,
              rounds: state.rounds || 0,
              last: state.last ? clone(state.last) : null,
              byRound: clone(state.byRound || []),
              gains: clone(state.gains || {}),
              events: clone(state.events || {}),
            },
          ];
        }),
    );
    // ⚠ **キャンプの練習より後に入れ替えること**。先に入れ替えると、
    //    選んだばかりの24人がキャンプで成長してしまい、セットの釣り合いが崩れる
    applyPendingPacks(league);
    // ⚠ CPU球団はキャンプで守備位置を適性に合わせるので、最後の捕手が一塁手などに移ることがある
    //    （10年の長期シミュで、年度更新で補った後のキャンプで捕手0人の球団が出た）
    fillMissingCatchers(league, now);
    // 自分で組んだ先発ローテの、引退・退団などで空いた枠を埋める（開幕の前に1回）
    refillOwnRotations(league, now);
    initializeAllPlayersCondition();
    for (const name of league.season.settings.teamNames)
      refreshTeamPlan(league, name);
    // 開幕の日とフェーズは一人用と同じ（`seasonManager.js` の `openingDayFields`）
    Object.assign(league.season, openingDayFields(league.season.year));
    generateAprilHighSchoolClass(league.season.year);
    league.season._highSchoolGenerated = true;
    generateBackgroundTournaments(league.season.currentDate);
  }
  if (kind === 'offseason') {
    // ⚠ **年度更新の伸び・衰えを残す**（いしだ指摘: 成長がいつ・どれだけ
    //    起きたか分からない）。能力が変わるのはキャンプとここだけで、
    //    ここは画面に何も出ていなかった。キャンプと同じく前後の差で作る
    const offseasonBefore = snapshotMemberTeams(league);
    freezeComparison(league);
    league.history.push({
      year: league.season.year,
      standings: clone(league.season.standings),
      awards: clone(league.season.frozenAwards || {}),
      playoffChampion: getPlayoffChampion(league.season.schedule, PLAYOFF_REPLAY),
    });
    // その年の部分け（昇降格の前）。球団史の「1部2位」に使う
    annotateHistory(league.history.at(-1), league.teams, null);
    // その年の主将（球団の顔。年度更新の前の名簿で。`teamFace.mjs`）
    {
      const captains = captainsOfYear(league.season.settings.teamNames, TEAMS_DATA);
      if (Object.keys(captains).length) league.history.at(-1).captains = captains;
    }
    // 引退した人の記録の鍵（年度更新で名簿から消えるので、先に引いておく）
    const retireKeys = new Map();
    const retireNumbers = new Map();
    for (const name of league.season.settings.teamNames)
      for (const p of TEAMS_DATA[name]?.players || []) {
        if (p.onlinePlayerId) retireKeys.set(`${name}:${p.name}`, p.onlinePlayerId);
        // 背番号（永久欠番にするときに使う）
        if (Number.isInteger(p.number)) retireNumbers.set(`${name}:${p.name}`, p.number);
      }
    const retireYear = league.season.year;
    const retireTeams = [...league.season.settings.teamNames];
    // 指導者の通算に残す、終わった年の球団の成績（日程が残っている今のうちに）
    const coachRows = league.coaches ? coachSeasonRows(league) : {};
    // 引退した選手の現役時代の姿（指導者になる人の考え方を寄せる）
    const retireLooks = new Map();
    for (const name of retireTeams)
      for (const p of TEAMS_DATA[name]?.players || [])
        retireLooks.set(`${name}:${p.name}`, {
          position: p.position,
          pitching: p.pitching ? { velocity: p.pitching.velocity, control: p.pitching.control, stamina: p.pitching.stamina } : null,
          batting: p.batting ? { meet: p.batting.meet, power: p.batting.power, eye: p.batting.eye, bunt: p.batting.bunt } : null,
          physical: p.physical ? { speed: p.physical.speed } : null,
          // ⚠ 守備の名手は「打たせて守る」に寄せる（`coaches.js` の `leanFromPlayer`）
          fielding: p.fielding ? { defense: p.fielding.defense } : null,
        });
    const result = advanceToNextYear(league.season, TEAMS_DATA, {
      playedTeamNames: league.season.settings.teamNames,
      // 対人リーグの球団は自然成長の式を分ける（フィジカル・精神が中心、若いほど。先方指摘 2026-11-16）
      onlineTeamNames: league.season.settings.teamNames,
    });
    const retiredList = recordRetirements(league, result.retirements, {
      year: retireYear,
      teamNames: retireTeams,
      keys: retireKeys,
      numbers: retireNumbers,
    });
    for (const key of Object.keys(TEAMS_DATA)) delete TEAMS_DATA[key];
    Object.assign(TEAMS_DATA, result.updatedTeams);
    league.season = result.newSeasonData;
    // 引退で捕手が居なくなった球団に1人補う（`fillMissingCatchers`）
    fillMissingCatchers(league, now);
    // 年齢の変化の一覧は一人用のキャンプ画面向け（オンラインは使わない。6MB ある）
    delete league.season.ageReports;
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
    annotateHistory(league.history.at(-1), league.teams, movements);
    // 指導者の年度更新（成績を残す・勇退・CPU監督の進退・引退選手が指導者へ）。
    // ⚠ 昇降格を当てたあと（降格した球団の監督の進退に使う）
    if (league.coaches) {
      const ours = new Set(retireTeams);
      const lines = new Map((retiredList || []).map((r) => [`${r.team}:${r.name}`, r]));
      const retirees = (result.retirements || [])
        .filter((r) => ours.has(r.team))
        .map((r) => ({
          ...r,
          seasons: lines.get(`${r.team}:${r.name}`)?.seasons || 0,
          line: lines.get(`${r.team}:${r.name}`)?.line || null,
          player: retireLooks.get(`${r.team}:${r.name}`) || null,
        }));
      coachOffseason(league, {
        rows: coachRows,
        retirees,
        // 球団の状況（戦力・主力の年齢）は年度更新の後の名簿で見る（年を取り、引退した後）
        rosterOf: (name) => TEAMS_DATA[name]?.players,
      });
      // 指導者の道へ進んだ人は、引退の記録の「引退後」もそれに合わせる
      // ⚠ **肩書きの形（「〇〇の打撃コーチ」と同じ名詞）で書く**。アプリは
      //    「今後は${secondCareer}として球界に残る。」と組むので、「指導者の道へ」だと文が崩れる
      const turned = new Set(
        retirees
          .filter((r) => ['manager', 'coach'].includes(r.secondCareer?.role))
          .map((r) => `${r.team}:${r.name}`),
      );
      for (const entry of league.chronicle?.retired || [])
        if (entry.year === retireYear && turned.has(`${entry.team}:${entry.name}`))
          entry.secondCareer = '指導者';
    }
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
    // ⚠ 投手起用を指導者に任せた人の球団も作り直す（CPUと同じ）
    const humans = new Set(
      humanTeamNames(TEAMS_DATA).filter((name) => {
        const member = league.members.find((m) => m.teamName === name);
        return !member || effectiveStaffModes(league, member).pitching !== 'delegate';
      }),
    );
    for (const name of Object.keys(TEAMS_DATA))
      if (!humans.has(name)) generatePitchingRotation(name);
    league.offseasonResults = offseasonChanges(
      league,
      offseasonBefore,
      league.history.at(-1)?.year,
    );
  }
  // ⚠ **選手が動いた手続きの後は、成り立たなくなったトレードの提案を取り下げる**（退団・入団・
  //    引退・初期メンバーの入れ替え）。年度更新では全部取り下げる（能力も年齢も変わった後に
  //    古い条件で成立させない）。予告先発と申し込み中の練習試合も年度とともに消す
  //    （日程を作り直すので、試合の番号が新しい年の別の試合を指してしまう）。留守の前の編成の
  //    控えも消す（年をまたいで戻すと、キャンプの後の編成が前の年の形に巻き戻る）
  if (kind === 'offseason') {
    pruneTrades(league, TEAMS_DATA, now, {
      all: true,
      reason: '年度が替わったため、取り下げられました',
    });
    forgetLastYearPlans(league);
    clearOpenChallenges(league, now, '年度が替わったため、練習試合の申し込みは取り下げられました');
  } else pruneTrades(league, TEAMS_DATA, now);
  league.phase = null;
  delete league.season.pendingPhaseEvent;
  if (kind === 'pack_select' || kind === 'offseason')
    openPhase(league, 'camp', now);
  else {
    league.status = 'running';
    // キャンプの後は開幕。月曜0時に揃える（`seasonStartAt` の説明を参照）
    league.nextAdvanceAt =
      kind === 'camp' ? seasonStartAt(now) : nextProgressionAt(now);
  }
}

// 手続きがこの人の決定をまだ待っているか（`coachEngine.mjs`。画面の `members[].ready` と同じものを使う）
export { waitsFor };

/** 手続きがまだ誰かの決定を待っているか（待機中の手続きが無ければ false） */
function anyoneWaited(league) {
  return (
    league.status === 'waiting' &&
    !!league.phase &&
    league.members.some((m) => waitsFor(league, m))
  );
}

/**
 * 待つ人が居なくなった手続きを、その場で解決する。世界は読み込んであること。
 * ⚠ **乱数は締め切りのときと同じ種**（`phase:${id}`）。どの経路で進んでも結果が同じになる
 */
function resolveSettledPhase(league, now) {
  if (league.status !== 'waiting' || !league.phase || anyoneWaited(league)) return false;
  seeded(league, `phase:${league.phase.id}`, () => resolvePhase(league, now));
  return true;
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
  // ⚠ 決定（「この内容で決定」・キャンプの最後のクール）のたびに見る。待つ人が居なければ進む。
  //    ⚠ 全員が任せていても、開いただけでは進まない（`openPhase` は見ない）。誰かが決定するか締め切りで進む
  // ⚠ **下書きの保存・決定の取り消し（`ready: false`）では進めない**。以前は ready を見ておらず、
  //    全員が任せた手続き（1人リーグで任せたときも）では、任せた人が「下書きを保存」を押した
  //    その場でトライアウト・契約更改が処理され、知らせは「下書きを保存しました」だった。
  //    締め切りの自動決定（`autoResolvePhase`）は ready: true で出すので、ここで止まらない
  if (ready === true) resolveSettledPhase(league, now);
  // トライアウトで入った人にも背番号を付ける
  numberLeagueTeams(league.season.settings.teamNames, TEAMS_DATA);
  league.game = captureWorld();
}

export { saveLineup } from './lineupCommand.mjs';

/**
 * 人の球団の任せ方を変える（`staffModes` 命令）。手続きを進めたら true を返す。
 * ⚠ スタメン・投手起用を**いま任せた**ときは、その場で指導者の編成に作り直す
 *    （次の手続きや年度更新まで人の編成のまま、にならないように）。世界を読むのはそのときだけ
 * ⚠ **手続きを待っていた最後の1人が任せたら、その場で手続きを進める**（`waitsFor`）。
 *    締め切りまで待たせない。もともと誰も待っていない手続き（全員が任せている）は、
 *    任せ方を変えただけでは進めない（`submitPhase` の説明を参照）
 */
export function updateStaffModes(league, userId, modes, now) {
  const member = league.members.find((m) => m.userId === userId);
  requireOnline(member, '参加者ではありません', 403);
  const waited = anyoneWaited(league);
  const before = effectiveStaffModes(league, member);
  setStaffModes(league, userId, modes);
  const after = effectiveStaffModes(league, member);
  const rebuild = ['lineup', 'pitching'].some(
    (area) => after[area] === 'delegate' && before[area] !== 'delegate',
  );
  const settle = waited && !anyoneWaited(league);
  if (!rebuild && !settle) return false;
  loadLeagueWorld(league);
  if (rebuild) refreshTeamPlan(league, member.teamName);
  if (settle) resolveSettledPhase(league, now);
  league.game = captureWorld();
  return settle;
}

/** キャンプを任せていた人が自分で1クール回したとき、キャンプを「意見を聞く」に戻す */
export function takeBackCamp(league, member) {
  const modes = { ...(member.staffModes || {}) };
  if (modes.camp !== 'delegate') return;
  setStaffModes(league, member.userId, { camp: 'advice' });
}

/**
 * 人の球団の人事（`staff` 命令。キャンプの間だけ）。
 * ⚠ **人事ではキャンプを進めない**。指導者が3人とも居ない球団は「自分で」になって待たれ、
 *    1人呼ぶと任せた形に戻って待たれなくなる。ここで進めると、続けてほかの席に呼ぶ前に
 *    キャンプ（人事ができる期間）が終わってしまう。ほかの人の決定・任せ方の変更・締め切りで進む
 */
export function updateStaff(league, userId, payload) {
  return staffCommand(league, userId, payload);
}

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
  // ⚠ 試合中の記録（`decisionLog`・`pitcherAppearances`。1試合で約1KB）も外す
  //    （監査 2026-11-20。1年目8月の芯で圧縮後 456KB → 276KB）。勝敗投手は試合の直後に
  //    `decisions` へ確定していて（`autoSimulation.js` の `decisionsFromResult`）、
  //    保存後に読むところは無い（オンラインの画面・アプリ・サーバーとも）
  const DROP = ['homeTeam', 'awayTeam', 'decisionLog', 'pitcherAppearances'];
  const slim = (result) => {
    if (!result || !DROP.some((key) => key in result)) return result;
    const rest = { ...result };
    for (const key of DROP) delete rest[key];
    return rest;
  };
  for (const game of season.results || []) game.result = slim(game.result);
  for (const game of season.schedule || []) game.result = slim(game.result);
  // ⚠ 年齢による能力の変化の一覧（世界の全選手・約1.6万人ぶん）は一人用のキャンプ画面だけが
  //    読む。オンラインは `offseasonChanges` で別に作るので要らない。2年目の芯 9.4MB のうち
  //    6.2MB がこれだった（監査 2026-11-20）。年度更新でも消すが、もう保存に入っている
  //    リーグのぶんもここ（毎日の進行）で消える。中身を軽くするだけなので版は上げない
  delete season.ageReports;
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
  // ⚠ **おるすばん**（しばらく来ていない人の球団）。指導者に任せた扱いにして、編成をその場で
  //    作り直す（任せたスタメン・投手起用は、手続きか任せ方の変更でしか作り直されないので、
  //    ここで作らないと放っておかれた球団は新しく取った選手が控えのまま走り続ける）
  // ⚠ 作り直す前に、その人の編成を控える（戻ってきたら戻す。`keepAwayPlan`）
  for (const member of markAway(league, now)) {
    keepAwayPlan(member, TEAMS_DATA[member.teamName]);
    refreshTeamPlan(league, member.teamName);
  }
  advanceOneDay(league, `day:${operationId}`, now);
  for (let n = 1; n <= IDLE_DAYS_PER_TICK && idleDay(league); n++)
    advanceOneDay(league, `day:${operationId}:${n}`, now);
  if (league.status === 'running')
    league.nextAdvanceAt = nextProgressionAt(now);
  league.notices = league.notices.slice(0, 20);
  // 背番号（足りない人・重なった人だけ。トレード・トライアウトで来た人もここで付く）
  numberLeagueTeams(league.season.settings.teamNames, TEAMS_DATA);
  // 戻すときも持ち主ごと渡した（`take`）ので、写しも複製せずに作る（`captureWorld` の注）
  league.game = captureWorld({ take: true });
}

function advanceOneDay(league, key, now) {
  // ⚠ 野手の1試合の疲労はオンラインの式（`onlineFielderFatigueFor`）。一人用の式は変えない
  seeded(league, key, () => withFielderGameFatigue(onlineFielderFatigueFor, () => {
    const oldDate = league.season.currentDate;
    const todays = getScheduleByDate(league.season.schedule, oldDate).filter(
      (game) => !game.result,
    );
    const playingTeams = new Set(todays.flatMap((game) => [game.home, game.away]));
    // 予告先発（人が指名した先発。`starterPicks.mjs`）。使えなかった指名は後で知らせる
    // ⚠ 人の球団は**確定したときに控えた先発**で投げる（`lockStarters`。相手に見えた先発と同じにする）。
    //    控えが無い試合（この作りの前に確定した試合）だけ、今の指名を見る
    lockStarters(league, TEAMS_DATA);
    // ⚠ 人の球団の救援の欄を画面の順に揃える（`alignReliefOrder`。2026-11-20 監査）。
    //    手続きの作り直しは揃えるが、この直しより前に作り直した保存は能力の順のまま
    //    残っているので、試合の前にも揃える（揃っていれば何も変わらない）
    // ⚠ 投手起用を任せた球団は、欄（指導者の能力の順）を正本にして `pitcherOrder` へ写す
    //    （判断4。この直しより前に任せた保存は、古い順や名簿の並びのまま残っている）
    for (const member of league.members || []) {
      const team = TEAMS_DATA[member.teamName];
      if (!playingTeams.has(member.teamName) || !team) continue;
      if (effectiveStaffModes(league, member).pitching === 'delegate')
        recordCoachReliefOrder(team);
      alignReliefOrder(team);
    }
    const pickReports = [];
    const restoreRotations = league.season.settings.teamNames
      .filter((name) => playingTeams.has(name))
      .map((name) => {
        const game = todays.find((g) => g.home === name || g.away === name);
        const lock = game ? lockedStarterFor(league, name, game.id) : null;
        const pick = lock ? lock.id : game ? pickFor(league, name, game.id) : null;
        const report = {};
        // ⚠ 知らせるのは指名したときだけ（ローテの順の投手が疲れて回るのは今までどおり黙って）
        if (pick != null && (!lock || lock.picked))
          pickReports.push({ name, game, pick, report, shownName: lock?.name });
        return prepareDailyLineup(TEAMS_DATA[name], name, { pick, report, outside: !!lock, label: teamLabelIn(league, name) });
      });
    // その日の采配（指導者の考え方）。⚠ 保存した設定は書き換えず、試合の後に戻す
    for (const name of league.season.settings.teamNames)
      if (playingTeams.has(name))
        restoreRotations.push(applyStaffTactics(league, name, TEAMS_DATA[name]));
    let season, played;
    try {
      ({ data: season, results: played } = simulateScheduledGamesOnDate(
        league.season,
        // ⚠ 観戦記録は既定で残さない（容量）。`ONLINE_RECORD_REPLAY=1` で有効
        createRecorder(league, TEAMS_DATA, {
          replay: process.env.ONLINE_RECORD_REPLAY === '1',
        }),
        PLAYOFF_REPLAY,
      ));
    } finally {
      for (const restore of restoreRotations) restore();
    }
    // 節目の記録（通算100安打など）。記録（`league.records`）は試合の中で書かれている
    recordMilestones(league, played || [], oldDate);
    for (const { name, game, pick, report, shownName } of pickReports) {
      if (report.pick !== 'avoided') continue;
      const member = league.members.find((m) => m.teamName === name);
      // ⚠ 名前は確定したときの控え、無ければほかの球団からも探す（トレードで出た投手は自球団の名簿に居ない）
      const pitcher = Object.values(TEAMS_DATA)
        .map((t) => t?.players?.find((p) => p.id === pick))
        .find(Boolean) || (shownName ? { name: shownName } : null);
      const foe = teamLabelIn(league, game.home === name ? game.away : game.home);
      pushInbox(
        league,
        member?.userId,
        {
          type: 'starterAvoided',
          // ⚠ 理由を分ける（以前は移籍・抹消・ローテから外れたときも「疲れが残っていた」と出ていた）
          text: starterAvoidedText(report.reason, pitcher?.name || '投手', foe),
        },
        now,
      );
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
    clearPlayedPicks(league);
    // 日付が進んで確定の時刻を過ぎた試合の先発を控える（次の進行までにローテを並べ替えても変わらない）
    lockStarters(league, TEAMS_DATA);
    const { month, day, year } = season.currentDate;
    generateBackgroundTournaments(season.currentDate);
    // CPU球団が自分から動くトレード（CPU同士・人の球団への提案）。⚠ 乱数は引かない（`cpuTrades.mjs`）
    runCpuTrades(league, now);
    if (month === 8 && day >= 15 && !season._koshienDone) {
      recordKoshien(league, simulateKoshien(season.year), season.currentDate);
      season._koshienDone = true;
    }
    if (month === 10 && day >= 21 && !season.grandChampionship?.generated) {
      const champion = getPlayoffChampion(season.schedule, PLAYOFF_REPLAY);
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
          recordGrandChampionship(league, gc, champion, season.currentDate);
          if (league.records?.seasons?.[season.year])
            league.records.seasons[season.year].grandChampionshipExcluded =
              true;
          season.grandChampionship = gc;
        }
      }
    }
    // その年の成績を確定する（比較値・タイトル・最終順位）。
    //
    // ⚠ **NPBドラフトは一人用の処理を回さない**。一人用の `processNPBDraft` は各球団から
    //    2〜3人ずつ抜くので、長く続ける対人リーグでは育てた選手が手元から消えすぎる。
    //    代わりにリーグ全体で年0〜5人だけ指名し、抜かれた球団にご褒美を渡す
    //    （`proDraft.mjs`。先方要望 2026-11-16 で解禁）。
    // ⚠ **確定の処理は残すこと**。同じ日に動いていたので一緒に消しやすいが、
    //    これが無いとタイトルも最終順位も年度の記録に残らない。
    // ⚠ 日付はNPBのドラフト日のまま（一人用と同じ暦で動かすため）。
    //    印の名前（`_draftDone`）も**保存の形を変えないため旧名のまま**。
    //    いまの意味は「その年の成績を確定したか」。
    if (month === 10 && day === getNPBDraftDay(year) && !season._draftDone) {
      freezeComparison(league);
      season.frozenAwards = processSeasonEnd(season, TEAMS_DATA);
      // 年間表彰（MVP・新人王・ベストナイン・最優秀バッテリー。部ごと。`seasonAwards.mjs`）
      season.frozenAwards.honors = selectHonors(league, TEAMS_DATA);
      season.finalRankings = snapshotRankings(
        TEAMS_DATA,
        season.settings.teamNames,
      );
      // プロ野球への道（成績を確定した**後**。タイトルと最終順位は指名された選手を含めて残す）
      runProDraft(league, now);
      season._draftDone = true;
    }
    if (month === 11 && day === 9) openPhase(league, 'contract', now);
    else if (month === 11 && day === 10) openPhase(league, 'tryout', now);
    // ⚠ **年度更新は決めることが無いので、開いたその場で済ませる**
    //    （いしだ指摘: 押す意味の無い「決定」が「何をすればいいか分からない」を
    //    生んでいた）。以前は土曜21時〜24時の4時間を手続きとして待っていた。
    //    済ませると続けてキャンプが開く（`resolvePhase`）ので、キャンプが長くなる。
    // ⚠ 手続きとして開いてから解決する（`resolvePhase` の流れを1本に保つ）。
    //    古い保存で年度更新が開いたままのリーグは、従来どおり決定か締め切りで進む
    else if (month === 11 && day === 30) {
      openPhase(league, 'offseason', now);
      resolvePhase(league, now);
    }
  }));
}

/**
 * その年のプロ指名（リーグ全体で0〜5人）を決めて当てる。`proDraft.mjs` の注を参照。
 * ⚠ 初期メンバーを待っている球団は外す（名簿は次のキャンプで丸ごと入れ替わる）
 */
function runProDraft(league, now) {
  const names = league.season.settings.teamNames;
  const teams = Object.fromEntries(names.filter((n) => TEAMS_DATA[n]).map((n) => [n, TEAMS_DATA[n]]));
  const skip = new Set(names.filter((n) => hasPendingPack(league, n)));
  const picks = quiet(() => chooseProDraft(league, teams, skip));
  if (!picks.length) return;
  const touched = new Set();
  const rows = applyProDraft(league, teams, picks, {
    gamesPerSeason: league.season.settings.gamesPerSeason || 120,
    remove: (teamName, player) => {
      const team = TEAMS_DATA[teamName];
      cleanupPlayerReferences(team, player.id);
      team.players = team.players.filter((p) => p.id !== player.id);
      touched.add(teamName);
    },
  });
  // 抜けた選手の入った提案は取り下げ、打順・ローテを組み直す（成り立つなら人の編成は残る）
  pruneTrades(league, TEAMS_DATA, now);
  for (const name of touched) refreshTeamPlan(league, name);
  return rows;
}

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

/**
 * 締め切りを過ぎたフェーズを、未提出の人に既定案を当てて解決する。
 *
 * ⚠ **非同期で遊ぶゲームなので、待ち続けてはいけない**。1人が決めないと
 *    全員の週が止まる。既定案（`defaultPhasePlan`）はAIの選び方そのものなので、
 *    放置しても不利になりすぎない。
 * ⚠ 解決すると次のフェーズが開くことがある（契約更改→トライアウト→オフシーズン）。
 *    そちらの締め切りも過ぎていれば、同じティックで続けて解決する。
 */
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
      const saved = phase.submissions[member.userId];
      if (saved?.ready) continue;
      // ⚠ **保存した下書きがあれば、それで決める**。以前は下書きを捨てて標準案で
      //    決めていたため、契約更改で「誰も解雇しない」と下書きを保存したまま
      //    締め切りを迎えた球団が、標準案どおりに選手を解雇されていた。
      //    下書きが今は通らない（検証で弾かれる）ときだけ標準案に戻す。
      // ⚠ 検証は記録を書き換える前に済むので、弾かれても状態は汚れない。
      if (saved?.plan) {
        try {
          submitPhase(
            league,
            member.userId,
            { phaseId: id, plan: saved.plan, ready: true },
            now,
          );
          continue;
        } catch (error) {
          if (league.phase?.id !== id || league.phase.submissions[member.userId]?.ready)
            throw error;
        }
      }
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
