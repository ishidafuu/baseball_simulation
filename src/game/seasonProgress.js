import { TEAMS_DATA, LEAGUE_SETTINGS } from '../teams-data.js';
import { ensureCompleteLineup } from './lineup.js';
import { SEASON_PHASES, getCurrentPhase } from '../season/seasonManager.js';
import { getScheduleByDate } from '../season/scheduleGenerator.js';
import { progressDate, progressToNextPhase, handlePhaseTransition, recordGameResult, updatePlayoffProgress } from '../season/dateProgression.js';
import { autoSimulateGame } from './autoSimulation.js';
import { scheduledGameSeed } from './rng.js';
import { updateAllTeamReputations } from '../corporate/corporateInit.js';
import { WORLD_DATA } from '../corporate/worldData.js';
import { generateToshitaikou, createMainTournament, autoPlayMainTournament, autoPlayQualifier, generateNihonSenshuken, generateClubSenshuken, createSenshukenMainTournament, generateRegionalTournament, autoPlayBracket } from '../corporate/toshitaikou.js';
import { generateGrandChampionship, autoPlayGrandChampionship, processSpringPromotionRelegation, regenerateFallSchedules } from '../corporate/parallelWorldManager.js';
import { getUserFallSchedule } from '../university/universityInit.js';
import { showMessage } from '../utils/gameDialog.js';

// 注目度の中間更新月（2ヶ月ごと: 6月, 8月, 10月）
const REPUTATION_UPDATE_MONTHS = new Set([6, 8, 10]);

// 月をまたいだ時に注目度を更新する
const checkMidSeasonReputationUpdate = (oldDate, newDate, seasonData) => {
  if (!oldDate || !newDate) return;
  if (oldDate.month === newDate.month) return;
  if (REPUTATION_UPDATE_MONTHS.has(newDate.month)) {
    updateAllTeamReputations(seasonData);
  }
};

// フェーズ遷移検出＆自動画面遷移
export const checkPhaseTransitionAndNavigate = (oldSeasonData, newSeasonData, { setSeasonData, setScreenMode, setManagementView }) => {
  const oldPhase = oldSeasonData.phase;
  const newPhase = newSeasonData.phase;

  if (oldPhase !== newPhase) {
    newSeasonData = handlePhaseTransition(newSeasonData, newPhase);
  }

  const { month, day } = newSeasonData.currentDate;
  const isCorporate = newSeasonData.settings?.corporateMode;
  const isUniversityMode = newSeasonData.settings?.universityMode;

  // 社会人モード: 都市対抗予選（6月） - DateProgressScreen側で処理するためここでは何もしない
  // 社会人モード: 都市対抗本戦（8月） - DateProgressScreen側で処理するためここでは何もしない

  // 大学モード: 夏季合宿（8月20日）
  if (isUniversityMode && month === 8 && day >= 20 && !newSeasonData.summerCampDone) {
    setSeasonData(newSeasonData);
    setScreenMode('management');
    setManagementView('summer_camp');
    return null;
  }

  // 大学モード: 9月突入 → 春季入替戦＋秋季スケジュール再生成
  if (isUniversityMode && month >= 9 && !newSeasonData.springPromotionDone && WORLD_DATA.universityLeagues) {
    const uniInfo = WORLD_DATA.universityLeague;
    const userRegionId = uniInfo?.userRegion;
    const userDiv = uniInfo?.userDivision || 1;
    const hasDivisions = (uniInfo?.numDivisions || 1) >= 2;
    const league = WORLD_DATA.universityLeagues?.[userRegionId];
    if (league) {
      const springObj = league.spring;
      if (springObj) {
        const rows = newSeasonData.standings.map(s => ({
          team: s.team, wins: s.wins || 0, losses: s.losses || 0,
          draws: s.draws || 0, winRate: s.winRate || 0, gamesPlayed: s.gamesPlayed || 0,
        }));
        if (hasDivisions) springObj[`standings${userDiv}`] = rows;
        else springObj.standings = rows;
        springObj.done = true;
      }
    }
    processSpringPromotionRelegation();
    regenerateFallSchedules(newSeasonData.currentDate.year);
    if (userRegionId) {
      const fallGames = getUserFallSchedule(userRegionId);
      const springGames = newSeasonData.schedule.filter(g => g.season !== 'fall');
      const nextId = springGames.length;
      const newFallGames = fallGames.map((g, i) => ({ ...g, id: nextId + i }));
      const newLeagueTeams = WORLD_DATA.universityLeague?.leagueTeams;
      const fallStandingsInit = newLeagueTeams
        ? newLeagueTeams.map(t => ({ team: t, wins: 0, losses: 0, draws: 0, winRate: 0, gamesPlayed: 0 }))
        : newSeasonData.standings.map(s => ({ team: s.team, wins: 0, losses: 0, draws: 0, winRate: 0, gamesPlayed: 0 }));
      newSeasonData = {
        ...newSeasonData,
        schedule: [...springGames, ...newFallGames],
        springPromotionDone: true,
        springStandings: newSeasonData.standings.map(s => ({ ...s })),
        standings: fallStandingsInit,
      };
    } else {
      newSeasonData = { ...newSeasonData, springPromotionDone: true };
    }
  }

  // 11月9日: 契約更改強制
  if (month === 11 && day === 9 && newPhase === SEASON_PHASES.CONTRACT) {
    setSeasonData(newSeasonData);
    setScreenMode('management');
    setManagementView('contract');
    return null;
  }

  // 11月10日〜29日: トライアウト強制（大学モードは11/29に別途university_scoutが発火するため除外）
  if (!isUniversityMode && month === 11 && day >= 10 && day < 30 && (newPhase === SEASON_PHASES.TRYOUT || newPhase === SEASON_PHASES.CONTRACT)) {
    newSeasonData = { ...newSeasonData, phase: SEASON_PHASES.TRYOUT };
    setSeasonData(newSeasonData);
    setScreenMode('management');
    setManagementView('tryout');
    return null;
  }
  // 大学モード: 11月29日にuniversity_scout強制
  if (isUniversityMode && month === 11 && day === 29) {
    setSeasonData(newSeasonData);
    setScreenMode('management');
    setManagementView('university_scout');
    return null;
  }

  // 11月30日〜: オフシーズン強制（日付を11/30に正規化して12/1以降がセーブされるバグを防ぐ）
  if (month >= 12 || (month === 11 && day >= 30)) {
    const offseasonDate = month >= 12
      ? { ...newSeasonData.currentDate, month: 11, day: 30 }
      : newSeasonData.currentDate;
    newSeasonData = { ...newSeasonData, phase: SEASON_PHASES.OFF_SEASON, currentDate: offseasonDate };
    setSeasonData(newSeasonData);
    setScreenMode('management');
    setManagementView('offseason');
    return null;
  }

  return newSeasonData;
};

// ユーザーチームのスタメンが完成しているか確認
export const checkUserLineupComplete = (userTeamName) => {
  return ensureCompleteLineup(TEAMS_DATA[userTeamName], LEAGUE_SETTINGS.useDH);
};

// 指定日の試合を自動シミュレーション
export const simulateGamesOnDate = (seasonData) => {
  const currentDate = seasonData.currentDate;
  const todayGames = getScheduleByDate(seasonData.schedule, currentDate);

  if (todayGames.length === 0) return seasonData;

  let updatedSeasonData = { ...seasonData };

  todayGames.forEach(game => {
    if (game.result) return;
    if (game.home === 'TBD' || game.away === 'TBD') return;

    const homeTeam = TEAMS_DATA?.[game.home];
    const awayTeam = TEAMS_DATA?.[game.away];
    if (!homeTeam || !awayTeam) return;

    const gameResult = autoSimulateGame?.(game.home, game.away, false, scheduledGameSeed(game));
    if (gameResult) {
      updatedSeasonData = recordGameResult(updatedSeasonData, {
        date: currentDate,
        home: game.home,
        away: game.away,
        homeScore: gameResult.homeScore,
        awayScore: gameResult.awayScore,
        rngSeed: gameResult.rngSeed
      });
    }
  });

  updatedSeasonData = updatePlayoffProgress(updatedSeasonData);
  return updatedSeasonData;
};

// フェーズ内の全未消化試合を自動シミュレーション
export const simulateAllRemainingGames = (seasonData) => {
  let updatedSeasonData = { ...seasonData };
  const currentPhase = seasonData.phase;

  const isPlayoff = currentPhase === SEASON_PHASES.PLAYOFFS;
  if (isPlayoff) {
    let maxIterations = 50;
    while (maxIterations-- > 0) {
      const remainingGames = updatedSeasonData.schedule.filter(game => {
        if (game.phase !== SEASON_PHASES.PLAYOFFS) return false;
        if (game.result) return false;
        if (game.home === 'TBD' || game.away === 'TBD') return false;
        return true;
      }).sort((a, b) => {
        if (a.date.month !== b.date.month) return a.date.month - b.date.month;
        return a.date.day - b.date.day;
      });

      if (remainingGames.length === 0) break;

      const game = remainingGames[0];
      const homeTeam = TEAMS_DATA?.[game.home];
      const awayTeam = TEAMS_DATA?.[game.away];
      if (!homeTeam || !awayTeam) break;

      const gameResult = autoSimulateGame?.(game.home, game.away, false, scheduledGameSeed(game));
      if (gameResult) {
        updatedSeasonData = recordGameResult(updatedSeasonData, {
          date: game.date, home: game.home, away: game.away,
          homeScore: gameResult.homeScore, awayScore: gameResult.awayScore,
          rngSeed: gameResult.rngSeed
        });
        updatedSeasonData = updatePlayoffProgress(updatedSeasonData);
      } else {
        break;
      }
    }
  } else {
    const phaseOpts = seasonData.settings?.universityMode ? { universityMode: true } : undefined;
    const phaseGames = seasonData.schedule.filter(game => {
      const gamePhase = getCurrentPhase(game.date.month, game.date.day, phaseOpts);
      return gamePhase === currentPhase && !game.result;
    });
    phaseGames.forEach(game => {
      if (game.result) return;
      const homeTeam = TEAMS_DATA?.[game.home];
      const awayTeam = TEAMS_DATA?.[game.away];
      if (!homeTeam || !awayTeam) return;
      const gameResult = autoSimulateGame?.(game.home, game.away, false, scheduledGameSeed(game));
      if (gameResult) {
        updatedSeasonData = recordGameResult(updatedSeasonData, {
          date: game.date, home: game.home, away: game.away,
          homeScore: gameResult.homeScore, awayScore: gameResult.awayScore,
          rngSeed: gameResult.rngSeed
        });
      }
    });
  }

  return updatedSeasonData;
};

// 日付進行ハンドラー
export const handleProgressDate = (days, { seasonData, setSeasonData, setSelectedMonth, selectedMonth, userTeamName, setScreenMode, setManagementView }) => {
  if (!seasonData) return;

  if ((seasonData.phase === SEASON_PHASES.REGULAR_SEASON || seasonData.phase === SEASON_PHASES.PLAYOFFS) && !checkUserLineupComplete(userTeamName)) {
    showMessage('スタメンが9人揃っていません。スタメン設定画面で打順を設定してください。');
    return;
  }

  let newSeasonData = progressDate(seasonData, days);

  const oldPhase = seasonData.phase;
  const newPhase = newSeasonData.phase;
  if (oldPhase !== newPhase) {
    newSeasonData = handlePhaseTransition(newSeasonData, newPhase);
  }

  newSeasonData = simulateGamesOnDate(newSeasonData);

  // 2ヶ月ごとの注目度更新
  checkMidSeasonReputationUpdate(seasonData.currentDate, newSeasonData.currentDate, newSeasonData);

  // カレンダー月を現在日付に自動追従
  if (newSeasonData?.currentDate?.month && newSeasonData.currentDate.month !== selectedMonth) {
    setSelectedMonth(newSeasonData.currentDate.month);
  }

  const result = checkPhaseTransitionAndNavigate(seasonData, newSeasonData, { setSeasonData, setScreenMode, setManagementView });
  if (result !== null) setSeasonData(result);
};

// フェーズスキップ時にWORLD_DATAの社会人トーナメントを一括消化
const bulkSimulateWorldDataTournaments = (month, calYear) => {
  if (!WORLD_DATA.initialized) return;
  // 地域トーナメント
  if (month >= 4 && !WORLD_DATA.corporateRegionalTournament?.generated) {
    try {
      const rt = generateRegionalTournament({ userTeamName: null, calendarYear: calYear });
      WORLD_DATA.corporateRegionalTournament = { ...rt, generated: true };
    } catch (_) { WORLD_DATA.corporateRegionalTournament = { generated: true, done: true }; }
  }
  if (WORLD_DATA.corporateRegionalTournament?.generated && WORLD_DATA.corporateRegionalTournament.phase !== 'done') {
    const rt = WORLD_DATA.corporateRegionalTournament;
    for (const regionId of Object.keys(rt.brackets || {})) {
      const r = rt.brackets[regionId];
      autoPlayBracket(r.bracket, r.teamDefsMap);
      if (r.bracket.champion) { r.champion = r.bracket.champion; r.phase = 'done'; }
    }
    rt.phase = 'done'; rt.done = true;
  }
  // 都市対抗
  if (month >= 5 && !WORLD_DATA.corporateToshitaikou?.generated) {
    try {
      const t = generateToshitaikou({ userTeamName: null, calendarYear: calYear });
      WORLD_DATA.corporateToshitaikou = { ...t, generated: true, qualifiersDone: false, mainDone: false };
    } catch (_) { WORLD_DATA.corporateToshitaikou = { generated: true, qualifiersDone: true, mainDone: true }; }
  }
  if (WORLD_DATA.corporateToshitaikou?.generated && !WORLD_DATA.corporateToshitaikou.mainDone) {
    const td = WORLD_DATA.corporateToshitaikou;
    if (!td.qualifiersDone && td.qualifiers) {
      for (const rid of Object.keys(td.qualifiers)) autoPlayQualifier(td.qualifiers[rid], null);
      td.qualifiersDone = true;
    }
    if (!td.mainTournament) {
      try { td.mainTournament = createMainTournament(td.qualifiers, null, calYear); } catch (_) {}
    }
    if (td.mainTournament) {
      autoPlayMainTournament(td.mainTournament);
      td.champion = td.mainTournament.champion; td.runnerUp = td.mainTournament.runnerUp; td.mainDone = true;
    }
  }
  // 日本選手権
  if (month >= 9 && !WORLD_DATA.corporateNihonSenshuken?.generated) {
    try {
      const ns = generateNihonSenshuken({ userTeamName: null, calendarYear: calYear });
      WORLD_DATA.corporateNihonSenshuken = { ...ns, generated: true, phase: 'qualifiers' };
    } catch (_) { WORLD_DATA.corporateNihonSenshuken = { generated: true, done: true }; }
  }
  if (WORLD_DATA.corporateNihonSenshuken?.generated && !WORLD_DATA.corporateNihonSenshuken.done) {
    const ns = WORLD_DATA.corporateNihonSenshuken;
    if (ns.qualifiers) { for (const rid of Object.keys(ns.qualifiers)) autoPlayQualifier(ns.qualifiers[rid], null); }
    if (!ns.mainTournament) {
      try { ns.mainTournament = createSenshukenMainTournament(ns.qualifiers, calYear, 'corporate'); } catch (_) {}
    }
    if (ns.mainTournament) {
      autoPlayMainTournament(ns.mainTournament);
      ns.champion = ns.mainTournament.champion; ns.runnerUp = ns.mainTournament.runnerUp;
    }
    ns.done = true;
  }
  // クラブ選手権
  if (month >= 9 && !WORLD_DATA.corporateClubSenshuken?.generated) {
    try {
      const cs = generateClubSenshuken({ userTeamName: null, calendarYear: calYear });
      WORLD_DATA.corporateClubSenshuken = { ...cs, generated: true, phase: 'qualifiers' };
    } catch (_) { WORLD_DATA.corporateClubSenshuken = { generated: true, done: true }; }
  }
  if (WORLD_DATA.corporateClubSenshuken?.generated && !WORLD_DATA.corporateClubSenshuken.done) {
    const cs = WORLD_DATA.corporateClubSenshuken;
    if (cs.qualifiers) { for (const rid of Object.keys(cs.qualifiers)) autoPlayQualifier(cs.qualifiers[rid], null); }
    if (!cs.mainTournament) {
      try { cs.mainTournament = createSenshukenMainTournament(cs.qualifiers, calYear, 'club'); } catch (_) {}
    }
    if (cs.mainTournament) {
      autoPlayMainTournament(cs.mainTournament);
      cs.champion = cs.mainTournament.champion; cs.runnerUp = cs.mainTournament.runnerUp;
    }
    cs.done = true;
  }
};

// 次のフェーズまで進行
export const handleProgressToNextPhase = ({ seasonData, setSeasonData, setSelectedMonth, selectedMonth, userTeamName, setScreenMode, setManagementView }) => {
  if (!seasonData) return;

  if ((seasonData.phase === SEASON_PHASES.REGULAR_SEASON || seasonData.phase === SEASON_PHASES.PLAYOFFS) && !checkUserLineupComplete(userTeamName)) {
    showMessage('スタメンが9人揃っていません。スタメン設定画面で打順を設定してください。');
    return;
  }

  let newSeasonData = simulateAllRemainingGames(seasonData);
  newSeasonData = progressToNextPhase(newSeasonData);

  const oldPhase = seasonData.phase;
  const newPhase = newSeasonData.phase;
  if (oldPhase !== newPhase) {
    newSeasonData = handlePhaseTransition(newSeasonData, newPhase);
  }

  // フェーズスキップ時: WORLD_DATAの社会人トーナメントも一括消化
  if (!newSeasonData.settings?.corporateMode) {
    bulkSimulateWorldDataTournaments(newSeasonData.currentDate.month, newSeasonData.currentDate.year);
  }

  // フェーズスキップ時: グランドチャンピオンシップを生成・消化（独立リーグモード）
  if (!newSeasonData.settings?.corporateMode && !newSeasonData.settings?.universityMode &&
      WORLD_DATA.initialized && newSeasonData.currentDate.month >= 10 && !newSeasonData.grandChampionship?.generated) {
    const gc = generateGrandChampionship(WORLD_DATA.userLeagueId, newSeasonData.standings, newSeasonData.settings, newSeasonData.year);
    if (gc) {
      autoPlayGrandChampionship(gc);
      newSeasonData = { ...newSeasonData, grandChampionship: gc };
    }
  }

  // フェーズスキップ時は注目度を強制更新
  updateAllTeamReputations(newSeasonData);

  if (newSeasonData?.currentDate?.month && newSeasonData.currentDate.month !== selectedMonth) {
    setSelectedMonth(newSeasonData.currentDate.month);
  }

  const result = checkPhaseTransitionAndNavigate(seasonData, newSeasonData, { setSeasonData, setScreenMode, setManagementView });
  if (result !== null) setSeasonData(result);
};
