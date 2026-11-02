import { simulateScheduledGamesOnDate } from '../game/daySimulation.js';
import { generateBackgroundTournaments, advanceBackgroundTournaments } from '../game/backgroundProgression.js';
import React, { useState, useEffect, useMemo } from 'react';
import TutorialHint from './TutorialHint.jsx';
import { ScreenShell } from './GameUIComponents.jsx';
import { TEAMS_DATA, LEAGUE_SETTINGS, getTeamAbbreviation } from '../teams-data.js';
import { PHASE_INFO, SEASON_PHASES, formatDate, getDayOfWeek, getCurrentPhase, getNPBDraftDay, qualifiedPA, qualifiedOuts as qualifiedOutsFor, plateAppearances, getDaysInMonth, getPlayoffChampion, advanceDate, compareDates } from '../season/seasonManager.js';
import { RANK_COLORS } from '../utils/constants.js';
import { getScheduleByDate, getNextGame } from '../season/scheduleGenerator.js';
import { progressDate, handlePhaseTransition, updatePlayoffProgress } from '../season/dateProgression.js';
import { autoSimulateGame } from '../game/autoSimulation.js';
import { scheduledGameSeed } from '../game/rng.js';
import { ensureCompleteLineup } from '../game/lineup.js';
import { getModeCapabilities } from '../game/modeCapabilities.js';
import { generateToshitaikou, createMainTournament, autoPlayMainTournament, autoPlayQualifier, autoPlayBracket, getRoundName, getUserNextMatch, simulateQualifierOnDate, simulateMainTournamentOnDate, getUserMatchOnDate, getTournamentDatesForCalendar, simulateQuickMatch, recordResult as recordTournamentResult, generateNihonSenshuken, generateClubSenshuken, simulateNihonSenshukenOnDate, getUserNihonSenshukenMatchOnDate, getNihonSenshukenDatesForCalendar, createSenshukenMainTournament, generateRegionalTournament, simulateRegionalTournamentOnDate, getUserRegionalTournamentMatchOnDate, getRegionalTournamentDatesForCalendar } from '../corporate/toshitaikou.js';
import { simulateParallelWorldDate, getAllParallelLeagues, getAllUniversityLeagues, generateGrandChampionship, autoPlayGrandChampionship, processSpringPromotionRelegation, regenerateFallSchedules } from '../corporate/parallelWorldManager.js';
import { getUserFallSchedule } from '../university/universityInit.js';
import { generateAprilHighSchoolClass, checkNPBDraftEligibility } from '../season/yearProgressionSystem.js';
import { simulateKoshien, getKoshienHeadline, KOSHIEN_STAGE_LABEL } from '../season/koshien.js';
import { addToWatchList, removeFromWatchList, isWatched } from '../game/watchList.js';
import { highSchoolPool, universityPool, seedInitialUniversityClasses } from '../season/universityPool.js';
import { WORLD_DATA } from '../corporate/worldData.js';
import { updateAllTeamReputations, resetIndependentLeagueSchedules, getLeagueRankFromTeams } from '../corporate/corporateInit.js';
import { INDEPENDENT_LEAGUES } from '../corporate/independentLeagueData.js';
import { CONDITION_LEVELS, CONDITION_LABELS, CONDITION_COLORS, CONDITION_ICONS } from '../game/condition.js';
import { POSITION_NAMES, FORM_SHORT, FORM_NAME } from '../utils/constants.js';
import { Tooltip } from './GameUIComponents.jsx';
import { formatInnings } from '../utils/physics.js';
import { checkScoutMissionCompletion, SCOUT_TARGETS, processAutoInvestigation, advanceFavoriteBonus, processUniversityScoutDay, initUniversityScoutList } from '../corporate/scoutingSystem.js';
import { generateUniversityChampionship, generateMeijiJinguTournament, simulateUniversityTournamentOnDate, autoPlayUniversityTournament, getUserUniversityTournamentMatchOnDate, getUniversityTournamentDatesForCalendar } from '../university/universityTournament.js';
import { UNIVERSITY_REGIONS } from '../university/universityTeamsData.js';
import PreGameModal from './dateProgress/PreGameModal.jsx';
import NewspaperModal, { buildNewspaperData } from './dateProgress/Newspaper.jsx';
import { decisionsFromResult } from '../game/pitcherDecisions.js';
import { KoshienNoticeModal, PhaseTransitionModal } from './dateProgress/Modals.jsx';
import { renderBracketWithLines as renderBracketWithLinesImpl } from './dateProgress/bracketRenderer.jsx';
import { isDevToolsEnabled } from '../game/devTools.js';

// 折りたたみ領域。閉じている間は children を描画しない（初回展開まで遅延）。
// 27大学リーグ順位表やトーナメント等の重いDOMを、日程進行のたびに再構築するのを防ぐ。
// 一度開いたら以降はマウントを維持するため、開閉アニメーションは通常どおり働く。
// リーグの格（S〜D）を示す小バッジ。所属チームの現ランク最頻値で、
// トライアウト受験者の質もこの値でスケールされる。
const LEAGUE_RANK_STYLE = {
  S: 'bg-yellow-900/50 text-yellow-300 border-yellow-600/50',
  A: 'bg-orange-900/50 text-orange-300 border-orange-600/50',
  B: 'bg-green-900/50 text-green-300 border-green-600/50',
  C: 'bg-blue-900/50 text-blue-300 border-blue-600/50',
  D: 'bg-gray-700/60 text-gray-200 border-gray-500/50',
};
const LeagueRankBadge = ({ rank, className = '' }) => {
  if (!rank) return null;
  return (
    <span
      className={`px-1.5 py-0.5 rounded border text-xs font-bold leading-none ${LEAGUE_RANK_STYLE[rank] || LEAGUE_RANK_STYLE.D} ${className}`}
      title="リーグの格（所属チームのランクから算出。トライアウト受験者の質に影響）"
    >
      {rank}
    </span>
  );
};

const Collapse = ({ open, children, className = '' }) => {
  const [everOpen, setEverOpen] = useState(open);
  useEffect(() => { if (open && !everOpen) setEverOpen(true); }, [open, everOpen]);
  return (
    <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
      <div className={`overflow-hidden ${className}`}>{everOpen ? children : null}</div>
    </div>
  );
};

// フェーズ移行イベントの表示名（確認ダイアログ）
const PHASE_EVENT_INFO = {
  draft: { label: 'ドラフト会議', desc: 'NPBドラフト会議が始まります。チームの有力選手が指名される可能性があります。' },
  contract: { label: '契約更改', desc: '選手との契約更改を行います。戦力外通告もこのフェーズで実施します。' },
  corporate_departure: { label: '退団処理', desc: '引退・戦力外の選手が退団します。' },
  corporate_scout: { label: 'スカウト入団', desc: '新戦力のスカウト・獲得を行います。' },
  club_recruit: { label: 'クラブ補強', desc: '新メンバーの獲得を行います。' },
  tryout: { label: 'トライアウト', desc: '新戦力の獲得のためトライアウトを実施します。' },
  university_scout: { label: 'スポーツ推薦', desc: '推薦スカウトの最終決定を行います。' },
  budget_settlement: { label: '予算決算', desc: '今シーズンの収支を確定します。' },
  offseason: { label: 'オフシーズン', desc: 'シーズンが終了しました。表彰・引退・進路決定を行います。' },
};

const DateProgressContent = ({ seasonData, setSeasonData, onForceEvent, onSetupManagedGame, onRegisterAdvance }) => {
  const [selectedMonth, setSelectedMonth] = useState(seasonData?.currentDate?.month || 4);
  const [isSimulating, setIsSimulating] = useState(false);
  const [showGameChoiceModal, setShowGameChoiceModal] = useState(false);  // 試合選択モーダル
  const [rankingLeague, setRankingLeague] = useState('all');
  const [selectedRegionTab, setSelectedRegionTab] = useState(null);
  const [selectedBracketTab, setSelectedBracketTab] = useState('main');
  const [selectedRtRegionTab, setSelectedRtRegionTab] = useState(null);
  const [activeTournamentTab, setActiveTournamentTab] = useState(null);
  const [isGeneratingTournament, setIsGeneratingTournament] = useState(false);
  const [koshienNotice, setKoshienNotice] = useState(null);   // 夏の甲子園の結果ダイアログ
  const [watchTick, setWatchTick] = useState(0);              // 注目リスト更新の再描画トリガー
  const [showTournamentMatchModal, setShowTournamentMatchModal] = useState(null);
  const [scoutReportNotifications, setScoutReportNotifications] = useState([]);
  const [showOtherLeagues, setShowOtherLeagues] = useState(false);
  const [showCorporateTournaments, setShowCorporateTournaments] = useState(() => {
    const ct = WORLD_DATA.corporateToshitaikou;
    const cn = WORLD_DATA.corporateNihonSenshuken;
    const cc = WORLD_DATA.corporateClubSenshuken;
    const cr = WORLD_DATA.corporateRegionalTournament;
    return (
      (cr?.generated && cr?.phase !== 'done') ||
      (ct?.generated && !ct?.mainDone) ||
      (cn?.generated && !cn?.done) ||
      (cc?.generated && !cc?.done)
    ) || false;
  });
  const [showUniversityLeagues, setShowUniversityLeagues] = useState(false);
  const [showUcTournament, setShowUcTournament] = useState(() => {
    const uc = seasonData?.universityChampionship;
    return !!uc?.generated && !uc?.champion;
  });
  const [showMjTournament, setShowMjTournament] = useState(() => {
    const mj = seasonData?.meijiJingu;
    return !!mj?.generated && !mj?.champion;
  });
  const [expandedUniLeagues, setExpandedUniLeagues] = useState({});
  const [uniStandingsTab, setUniStandingsTab] = useState('fall'); // 'spring' | 'fall'
  const [expandedCorpTournaments, setExpandedCorpTournaments] = useState({});
  const [uniRtRegionTab, setUniRtRegionTab] = useState(null);
  const [showNewspaper, setShowNewspaper] = useState(false);
  const [pendingPhaseEvent, setPendingPhaseEvent] = useState(null);
  const newspaperFameDateRef = React.useRef(null);

  const userTeamName = Object.keys(TEAMS_DATA || {})[0] || 'チームA';
  const modeCapabilities = getModeCapabilities(seasonData.settings);
  const isCorporate = modeCapabilities.corporate;
  const isUniversity = modeCapabilities.university;
  const currentPhase = seasonData.phase || 'off_season';
  const phaseInfo = PHASE_INFO[currentPhase] || { name: '', color: 'bg-gray-100', description: '' };
  const currentDate = seasonData.currentDate || { month: 4, day: 1, year: 1 };

  const getStartingPitcher = (teamName) => {
    const team = TEAMS_DATA[teamName];
    if (!team) return null;
    const rotation = team.pitchingRotation;
    const starters = rotation?.starters || [];
    // autoSimulation と同じロジック: currentStarterIndex で直接引く
    if (starters.length > 0) {
      const index = (rotation.currentStarterIndex || 0) % starters.length;
      const exact = team.players.find(p => p.id === starters[index] && p.isActive !== false);
      if (exact) return exact;
      // ゾンビIDや非アクティブの場合は次の有効な先発を返す
      for (let i = 1; i < starters.length; i++) {
        const candidate = team.players.find(p => p.id === starters[(index + i) % starters.length] && p.isActive !== false);
        if (candidate) return candidate;
      }
    }
    // フォールバック: pitcherRoles からスターターロールの投手を探す
    const starterRoles = new Set(['ace', 'complete', 'short', 'quality', 'opener']);
    const pitcherRoles = rotation?.pitcherRoles || {};
    const starterIds = Object.entries(pitcherRoles)
      .filter(([, role]) => starterRoles.has(role))
      .map(([id]) => { const n = Number(id); return isNaN(n) ? id : n; });
    if (starterIds.length > 0) {
      const found = team.players.filter(p => p.isActive !== false && starterIds.includes(p.id) && p.pitching);
      if (found.length > 0) return found.sort((a, b) => (b.pitching?.stamina || 0) - (a.pitching?.stamina || 0))[0];
    }
    // 最終フォールバック: 投手スタミナ最高の選手
    const pitchers = team.players.filter(p => p.isActive !== false && p.pitching && p.position === 'pitcher');
    if (pitchers.length > 0) return pitchers.sort((a, b) => (b.pitching?.stamina || 0) - (a.pitching?.stamina || 0))[0];
    return null;
  };

  // ⚠ 勝敗・セーブ・ホールドの判定と記録は `autoSimulateGame` の中（pitcherDecisions.js）。
  //    以前はここに独自の判定があり、この画面を通る試合にしか勝敗が付かなかった
  //    （社会人モードの大会・背景のリーグ戦は全員0勝0敗）。表示に使うのは結果の `decisions`
  const determinePitcherDecisions = (gameResult) => gameResult?.decisions || decisionsFromResult(gameResult);


  const checkAndTriggerEvents = (oldData, newData) => {
    // 大学プールの初期化。従来はセーブのロード時にしか呼ばれておらず、
    // 新規ゲームでは在学生が1人も居ないまま進行していた（新聞の大学欄が空になる）。
    // 中身があれば即座に return する冪等な関数なので、毎回呼んで構わない。
    seedInitialUniversityClasses(newData.settings?.year || seasonData?.year || 1);

    const oldPhase = oldData.phase;
    const newPhase = newData.phase;
    if (oldPhase !== newPhase) {
      newData = handlePhaseTransition(newData, newPhase);
    }
    const { month, day } = newData.currentDate;
    const capabilities = getModeCapabilities(newData.settings);
    const isCorporate = capabilities.corporate;

    // 4月1日: 高校3年生を生成
    if (month === 4 && day <= 3 && !newData._highSchoolGenerated) {
      const gameYear = newData.settings?.year || seasonData?.year || 1;
      generateAprilHighSchoolClass(gameYear);
      newData = { ...newData, _highSchoolGenerated: true };
      if (isUniversity) {
        const userTeam = TEAMS_DATA[userTeamName];
        const uniRank = userTeam?.universityData?.rank || 'C';
        const list = initUniversityScoutList(userTeam, uniRank);
        WORLD_DATA._universityScout = { candidates: list, recruited: [], initialized: true };
      }
    }

    // 8月中旬: 夏の甲子園。操作はできないが、スカウト対象の高校生に知名度が付く
    if (month === 8 && day >= 15 && !newData._koshienDone) {
      const gameYear = newData.settings?.year || seasonData?.year || 1;
      const kou = simulateKoshien(gameYear);
      newData = { ...newData, _koshienDone: true };
      if (kou) setKoshienNotice(kou);
    }

    if (isCorporate && month >= 5 && !newData.toshitaikou?.generated) {
      setSeasonData(newData);
      setIsGeneratingTournament(true);
      setTimeout(() => {
        const calYear = newData.currentDate.year;
        const seeds = newData.tournamentSeeds || null;
        const tournament = generateToshitaikou({ userTeamName, calendarYear: calYear, seeds });
        const updated = { ...newData, toshitaikou: { ...tournament, generated: true, qualifiersDone: false, mainDone: false } };
        if (tournament.userRegionId) setSelectedRegionTab(tournament.userRegionId);
        setSeasonData(updated);
        setIsGeneratingTournament(false);
      }, 50);
      return newData;
    }

    if (isCorporate && month >= 7 && newData.toshitaikou?.qualifiersDone && !newData.toshitaikou?.mainDone && !newData.toshitaikou?.mainTournament) {
      setSeasonData(newData);
      setIsGeneratingTournament(true);
      setTimeout(() => {
        const td = newData.toshitaikou;
        const prevChamp = td.prevChampion || newData.prevToshitaikouChampion || null;
        const calYear = newData.currentDate.year;
        const mainSeeds = newData.tournamentSeeds?.toshitaikouMain || null;
        const mainTournament = createMainTournament(td.qualifiers, prevChamp, calYear, mainSeeds);
        const updated = { ...newData, toshitaikou: { ...td, mainTournament, mainDone: false } };
        setSeasonData(updated);
        setIsGeneratingTournament(false);
      }, 50);
      return newData;
    }

    // 地域トーナメント（4〜5月、各地域16チーム）
    if (isCorporate && month >= 4 && !newData.regionalTournament?.generated) {
      setSeasonData(newData);
      setIsGeneratingTournament(true);
      setTimeout(() => {
        const calYear = newData.currentDate.year;
        const rtSeeds = newData.tournamentSeeds || null;
        const rt = generateRegionalTournament({ userTeamName, calendarYear: calYear, seeds: rtSeeds });
        const updated = { ...newData, regionalTournament: { ...rt, generated: true } };
        setSeasonData(updated);
        setIsGeneratingTournament(false);
      }, 50);
      return newData;
    }

    // 日本選手権（企業）＋全日本クラブ野球選手権（クラブ）（9月予選、10月本戦）
    if (isCorporate && month >= 9 && !newData.nihonSenshuken?.generated) {
      setSeasonData(newData);
      setIsGeneratingTournament(true);
      setTimeout(() => {
        const calYear = newData.currentDate.year;
        const nsSeeds = newData.tournamentSeeds || null;
        const ns = generateNihonSenshuken({ userTeamName, calendarYear: calYear, seeds: nsSeeds });
        const cs = generateClubSenshuken({ userTeamName, calendarYear: calYear, seeds: nsSeeds });
        const updated = {
          ...newData,
          nihonSenshuken: { ...ns, generated: true },
          clubSenshuken: { ...cs, generated: true },
        };
        setSeasonData(updated);
        setIsGeneratingTournament(false);
      }, 50);
      return newData;
    }

    // 日本選手権: 予選終了 → 本戦生成
    if (isCorporate && newData.nihonSenshuken?.generated && newData.nihonSenshuken.phase === 'qualifiers_done' && !newData.nihonSenshuken.mainTournament) {
      setSeasonData(newData);
      setIsGeneratingTournament(true);
      setTimeout(() => {
        const ns = newData.nihonSenshuken;
        const calYear = newData.currentDate.year;
        const nsMainSeeds = newData.tournamentSeeds?.senshukenMain || null;
        const mainTournament = createSenshukenMainTournament(ns.qualifiers, calYear, 'corporate', nsMainSeeds);
        const updated = { ...newData, nihonSenshuken: { ...ns, mainTournament, phase: 'main' } };
        setSeasonData(updated);
        setIsGeneratingTournament(false);
      }, 50);
      return newData;
    }

    // クラブ選手権: 予選終了 → 本戦生成
    if (isCorporate && newData.clubSenshuken?.generated && newData.clubSenshuken.phase === 'qualifiers_done' && !newData.clubSenshuken.mainTournament) {
      setSeasonData(newData);
      setIsGeneratingTournament(true);
      setTimeout(() => {
        const cs = newData.clubSenshuken;
        const calYear = newData.currentDate.year;
        const csMainSeeds = newData.tournamentSeeds?.clubMain || null;
        const mainTournament = createSenshukenMainTournament(cs.qualifiers, calYear, 'club', csMainSeeds);
        const updated = { ...newData, clubSenshuken: { ...cs, mainTournament, phase: 'main' } };
        setSeasonData(updated);
        setIsGeneratingTournament(false);
      }, 50);
      return newData;
    }

    if (!isCorporate) generateBackgroundTournaments(newData.currentDate);

    // 独立リーグの優勝決定シリーズが終わってから全国大会を開催する。
    const playoffGames = newData.schedule.filter(game => game.phase === SEASON_PHASES.PLAYOFFS);
    const playoffChampion = getPlayoffChampion(newData.schedule);
    if (capabilities.grandChampionship && WORLD_DATA.initialized
      && (month > 10 || (month === 10 && day >= 21))
      && (playoffGames.length === 0 || playoffChampion)
      && !newData.grandChampionship?.generated) {
      const gc = generateGrandChampionship(
        WORLD_DATA.userLeagueId,
        newData.standings,
        newData.settings,
        newData.year,
        playoffChampion
      );
      if (gc) {
        autoPlayGrandChampionship(gc);
        newData = { ...newData, grandChampionship: gc };
      }
    }

    // 大学モード: 夏季合宿（8月20日）
    if (isUniversity && month === 8 && day >= 20 && !newData.summerCampDone) {
      setSeasonData(newData);
      if (onForceEvent) onForceEvent('summer_camp');
      return newData;
    }

    // 大学モード: 9月突入 → 春季入替戦＋秋季スケジュール再生成
    if (isUniversity && month >= 9 && !newData.springPromotionDone && WORLD_DATA.universityLeagues) {
      const uniInfo = WORLD_DATA.universityLeague;
      const userRegionId = uniInfo?.userRegion;
      const userDiv = uniInfo?.userDivision || 1;
      const hasDivisions = (uniInfo?.numDivisions || 1) >= 2;
      const league = WORLD_DATA.universityLeagues?.[userRegionId];
      // ユーザーの春季順位をWORLD_DATAに同期してspring.done=trueにセット
      if (league) {
        const springObj = league.spring;
        if (springObj) {
          const rows = newData.standings.map(s => ({
            team: s.team, wins: s.wins || 0, losses: s.losses || 0,
            draws: s.draws || 0, winRate: s.winRate || 0, gamesPlayed: s.gamesPlayed || 0,
          }));
          if (hasDivisions) springObj[`standings${userDiv}`] = rows;
          else springObj.standings = rows;
          springObj.done = true;
        }
      }
      // 全リーグ春季入替戦 → 全リーグ秋季スケジュール再生成
      processSpringPromotionRelegation();
      regenerateFallSchedules(newData.currentDate.year);
      // ユーザーのseasonData.scheduleの秋季ゲームを新divTeamsで差し替え
      if (userRegionId) {
        const fallGames = getUserFallSchedule(userRegionId);
        const springGames = newData.schedule.filter(g => g.season !== 'fall');
        const nextId = springGames.length;
        const newFallGames = fallGames.map((g, i) => ({ ...g, id: nextId + i }));
        // processSpringPromotionRelegation後の新部のチームリストで秋季順位表を初期化
        const newLeagueTeams = WORLD_DATA.universityLeague?.leagueTeams;
        const fallStandingsInit = newLeagueTeams
          ? newLeagueTeams.map(t => ({ team: t, wins: 0, losses: 0, draws: 0, winRate: 0, gamesPlayed: 0 }))
          : newData.standings.map(s => ({ team: s.team, wins: 0, losses: 0, draws: 0, winRate: 0, gamesPlayed: 0 }));
        newData = {
          ...newData,
          schedule: [...springGames, ...newFallGames],
          springPromotionDone: true,
          springStandings: newData.standings.map(s => ({ ...s })),
          standings: fallStandingsInit,
        };
      } else {
        newData = { ...newData, springPromotionDone: true };
      }
    }

    // 大学モード: 全日本大学野球選手権大会（6月）
    if (isUniversity && month === 6 && day >= 5 && !newData.universityChampionship?.generated) {
      const calYear = newData.currentDate.year;
      const tournament = generateUniversityChampionship(newData, calYear);
      if (tournament) {
        if (tournament.userQualified) {
          newData = { ...newData, universityChampionship: { ...tournament, generated: true } };
          setSeasonData(newData);
          return newData;
        } else {
          newData = { ...newData, universityChampionship: { ...tournament, generated: true } };
        }
      }
    }

    // 大学モード: 明治神宮野球大会（11月）
    if (isUniversity && month === 11 && day >= 5 && !newData.meijiJingu?.generated) {
      const calYear = newData.currentDate.year;
      const tournament = generateMeijiJinguTournament(newData, calYear);
      if (tournament) {
        if (tournament.userQualified) {
          newData = { ...newData, meijiJingu: { ...tournament, generated: true } };
          setSeasonData(newData);
          return newData;
        } else {
          newData = { ...newData, meijiJingu: { ...tournament, generated: true } };
        }
      }
    }

    // 大学モード: トーナメント日付ベース進行
    if (isUniversity) {
      if (newData.universityChampionship?.generated && newData.universityChampionship.phase !== 'done') {
        const uc = JSON.parse(JSON.stringify(newData.universityChampionship));
        simulateUniversityTournamentOnDate(uc, newData.currentDate, userTeamName);
        newData = { ...newData, universityChampionship: uc };
      }
      if (newData.meijiJingu?.generated && newData.meijiJingu.phase !== 'done') {
        const mj = JSON.parse(JSON.stringify(newData.meijiJingu));
        simulateUniversityTournamentOnDate(mj, newData.currentDate, userTeamName);
        newData = { ...newData, meijiJingu: mj };
      }
    }

    const triggerPhaseEvent = (data, eventType) => {
      // ⚠ **未処理のイベントを seasonData に残す**。イベントは「その日ちょうど」でしか
      //    発火しない（`day === 9` 等）ので、確認ダイアログを「キャンセル」してから
      //    日付を進めると、その年のドラフト・契約更改・トライアウト・推薦確定が丸ごと飛んでいた。
      //    残しておけば `handleProgressDate` がダイアログを出し直す（セーブ→ロードでも残る）
      data = { ...data, pendingPhaseEvent: eventType };
      setSeasonData(data);
      const info = PHASE_EVENT_INFO[eventType];
      setPendingPhaseEvent({ eventType, label: info?.label || eventType, desc: info?.desc || '', data });
      return null;
    };

    if (month === 10 && day === getNPBDraftDay(newData.currentDate.year) && newPhase === SEASON_PHASES.DRAFT) {
      return triggerPhaseEvent(newData, 'draft');
    }
    if (month === 11 && day === 9 && newPhase === SEASON_PHASES.CONTRACT) {
      if (isUniversity) {
        // 大学モード: 契約更改なし → オフシーズンへ直行
      } else {
        return triggerPhaseEvent(newData, isCorporate ? 'corporate_departure' : 'contract');
      }
    }
    if (month === 11 && day === 10 && !isUniversity && newPhase === SEASON_PHASES.TRYOUT) {
      const isClub = seasonData?.settings?.clubMode;
      return triggerPhaseEvent(newData, isCorporate ? (isClub ? 'club_recruit' : 'corporate_scout') : 'tryout');
    }
    if (month === 11 && day === 29 && isUniversity) {
      return triggerPhaseEvent(newData, 'university_scout');
    }
    if (month === 11 && day === 30 && isCorporate && !seasonData?.settings?.clubMode) {
      return triggerPhaseEvent(newData, 'budget_settlement');
    }
    if (month >= 12 || (month === 11 && day >= 30)) {
      newData = { ...newData, phase: SEASON_PHASES.OFF_SEASON };
      return triggerPhaseEvent(newData, 'offseason');
    }
    return newData;
  };

  // ブラケット描画は bracketRenderer.jsx に抽出済み（userTeamName を渡す薄いラッパー）
  const renderBracketWithLines = (bracket, teamDefsMap = null) =>
    renderBracketWithLinesImpl(bracket, teamDefsMap, userTeamName);

  const autoFillLineup = () => {
    return ensureCompleteLineup(TEAMS_DATA[userTeamName], LEAGUE_SETTINGS.useDH);
  };

  // 戻り値は「日付を進めたか」。false は**何かが引き止めた**（モーダルを出した・
  // スタメンが作れなかった）という意味で、「次の試合まで」の連続進行がここで止まる。
  // ⚠ 止まる条件をループ側に書き写さないこと。条件はこの関数が唯一の正本で、
  //    写しを置くと片方だけ増えて取りこぼす（大会が6種類あるので特に危ない）。
  const handleProgressDate = (days) => {
    if (isSimulating) return false;
    // 未処理のフェーズ移行イベントがあれば、日付を進めずにダイアログを出し直す
    if (seasonData.pendingPhaseEvent) {
      const t = seasonData.pendingPhaseEvent;
      const info = PHASE_EVENT_INFO[t];
      setPendingPhaseEvent({ eventType: t, label: info?.label || t, desc: info?.desc || '', data: seasonData });
      return false;
    }
    if ((currentPhase === SEASON_PHASES.REGULAR_SEASON || currentPhase === SEASON_PHASES.PLAYOFFS) && !autoFillLineup()) {
      alert('スタメンを自動補完できませんでした。ロスター管理で打順を設定してください。');
      return false;
    }

    // 都市対抗トーナメントのユーザー試合チェック
    if (seasonData.toshitaikou?.generated) {
      const tournamentMatch = getUserMatchOnDate(seasonData.toshitaikou, seasonData.currentDate, userTeamName);
      if (tournamentMatch) {
        setShowTournamentMatchModal(tournamentMatch);
        return false;
      }
    }

    // 地域トーナメントのユーザー試合チェック
    if (seasonData.regionalTournament?.generated && seasonData.regionalTournament.phase !== 'done') {
      const rtMatch = getUserRegionalTournamentMatchOnDate(seasonData.regionalTournament, seasonData.currentDate, userTeamName);
      if (rtMatch) {
        setShowTournamentMatchModal(rtMatch);
        return false;
      }
    }

    // 日本選手権のユーザー試合チェック
    if (seasonData.nihonSenshuken?.generated && seasonData.nihonSenshuken.phase !== 'done') {
      const nsMatch = getUserNihonSenshukenMatchOnDate(seasonData.nihonSenshuken, seasonData.currentDate, userTeamName);
      if (nsMatch) {
        setShowTournamentMatchModal(nsMatch);
        return false;
      }
    }

    // クラブ選手権のユーザー試合チェック
    if (seasonData.clubSenshuken?.generated && seasonData.clubSenshuken.phase !== 'done') {
      const csMatch = getUserNihonSenshukenMatchOnDate(seasonData.clubSenshuken, seasonData.currentDate, userTeamName);
      if (csMatch) {
        const clubMatch = { ...csMatch, bracketType: csMatch.bracketType?.replace('nihon_senshuken', 'club_senshuken') || 'club_senshuken', type: csMatch.type?.replace('nihon_senshuken', 'club_senshuken') || 'club_senshuken' };
        setShowTournamentMatchModal(clubMatch);
        return false;
      }
    }

    // 大学トーナメントのユーザー試合チェック
    if (seasonData.universityChampionship?.generated && seasonData.universityChampionship.phase !== 'done') {
      const ucMatch = getUserUniversityTournamentMatchOnDate(seasonData.universityChampionship, seasonData.currentDate, userTeamName);
      if (ucMatch) {
        setShowTournamentMatchModal({ ...ucMatch, type: 'university_championship' });
        return false;
      }
    }
    if (seasonData.meijiJingu?.generated && seasonData.meijiJingu.phase !== 'done') {
      const mjMatch = getUserUniversityTournamentMatchOnDate(seasonData.meijiJingu, seasonData.currentDate, userTeamName);
      if (mjMatch) {
        setShowTournamentMatchModal({ ...mjMatch, type: 'meiji_jingu' });
        return false;
      }
    }

    // ユーザーチームの試合があるかチェック
    const todayGames = getScheduleByDate(seasonData.schedule, seasonData.currentDate);
    const userGame = todayGames.find(g => !g.result && (g.home === userTeamName || g.away === userTeamName));

    if (userGame && onSetupManagedGame && (currentPhase === SEASON_PHASES.REGULAR_SEASON || currentPhase === SEASON_PHASES.PLAYOFFS)) {
      setShowGameChoiceModal(true);
      return false;
    }

    // 試合がない日 or ユーザー試合がない → 通常進行
    executeSkipDay(days);
    return true;
  };

  const executeSkipDay = (days) => {
    setIsSimulating(true);
    const { data: afterSimData } = simulateScheduledGamesOnDate(seasonData);
    let newSeasonData = progressDate(afterSimData, days);
    if (newSeasonData._resumeDayAfterManagedGame) newSeasonData = { ...newSeasonData, _resumeDayAfterManagedGame: false };

    // 平行世界の試合をシミュレーション
    if (WORLD_DATA.initialized) {
      simulateParallelWorldDate(seasonData.currentDate);
    }

    // 都市対抗トーナメントを日付ベースで進行
    if (newSeasonData.toshitaikou?.generated) {
      const td = JSON.parse(JSON.stringify(newSeasonData.toshitaikou));
      const dateObj = seasonData.currentDate;

      // 予選を日付ベースで進行
      if (!td.qualifiersDone && td.qualifiers) {
        for (const regionId of Object.keys(td.qualifiers)) {
          simulateQualifierOnDate(td.qualifiers[regionId], dateObj, userTeamName);
        }
        const allDone = Object.values(td.qualifiers).every(q => q.phase === 'done');
        td.qualifiersDone = allDone;
        td.userQualifierDone = !td.userRegionId || td.qualifiers[td.userRegionId]?.phase === 'done';
      }

      // 本戦を日付ベースで進行
      if (td.mainTournament && td.mainTournament.phase !== 'done') {
        simulateMainTournamentOnDate(td.mainTournament, dateObj, userTeamName);
        if (td.mainTournament.phase === 'done') {
          td.champion = td.mainTournament.champion;
          td.runnerUp = td.mainTournament.runnerUp;
          td.mainDone = true;
        }
      }

      newSeasonData = { ...newSeasonData, toshitaikou: td };
    }

    // 地域トーナメントの試合を消化
    if (newSeasonData.regionalTournament?.generated && newSeasonData.regionalTournament.phase !== 'done') {
      const rt = JSON.parse(JSON.stringify(newSeasonData.regionalTournament));
      simulateRegionalTournamentOnDate(rt, seasonData.currentDate, userTeamName);
      newSeasonData = { ...newSeasonData, regionalTournament: rt };
    }

    // 日本選手権の試合を消化
    if (newSeasonData.nihonSenshuken?.generated && newSeasonData.nihonSenshuken.phase !== 'done') {
      const ns = JSON.parse(JSON.stringify(newSeasonData.nihonSenshuken));
      simulateNihonSenshukenOnDate(ns, seasonData.currentDate, userTeamName);
      newSeasonData = { ...newSeasonData, nihonSenshuken: ns };
    }

    // クラブ選手権の試合を消化
    if (newSeasonData.clubSenshuken?.generated && newSeasonData.clubSenshuken.phase !== 'done') {
      const cs = JSON.parse(JSON.stringify(newSeasonData.clubSenshuken));
      simulateNihonSenshukenOnDate(cs, seasonData.currentDate, userTeamName);
      newSeasonData = { ...newSeasonData, clubSenshuken: cs };
    }

    if (!seasonData.settings?.corporateMode) advanceBackgroundTournaments(seasonData.currentDate);

    // 大学モード: スカウト調査＋注目ボーナスの日次処理
    if (isUniversity && WORLD_DATA._universityScout?.candidates) {
      const uniRank = TEAMS_DATA[userTeamName]?.universityData?.rank || 'C';
      const uniRep = TEAMS_DATA[userTeamName]?.universityData?.reputation ?? 30;
      processUniversityScoutDay(WORLD_DATA._universityScout.candidates, newSeasonData.currentDate, uniRank, uniRep);
    }

    // スカウト派遣の完了チェック + 自動調査 + お気に入りボーナス
    if (seasonData.settings?.corporateMode) {
      const userTeam = TEAMS_DATA[userTeamName];
      if (userTeam?.corporateData?.scoutMissions) {
        const completedMissions = checkScoutMissionCompletion(userTeam, newSeasonData.currentDate, newSeasonData.year || 1);
        if (completedMissions.length > 0) {
          setScoutReportNotifications(prev => [...prev, ...completedMissions]);
        }
        processAutoInvestigation(userTeam, newSeasonData.currentDate);
      }
      advanceFavoriteBonus(userTeam, newSeasonData.currentDate);
    }

    // 2ヶ月ごとの注目度更新（6月/8月/10月に月をまたいだ時）
    const oldMonth = seasonData.currentDate?.month;
    const newMonth = newSeasonData.currentDate?.month;
    if (oldMonth !== newMonth && [6, 8, 10].includes(newMonth)) {
      updateAllTeamReputations(newSeasonData);
    }

    if (newSeasonData.currentDate.month !== selectedMonth) setSelectedMonth(newSeasonData.currentDate.month);
    const finalData = checkAndTriggerEvents(seasonData, newSeasonData);
    if (finalData !== null) setSeasonData(finalData);
    setIsSimulating(false);
  };

  // 采配した試合の後は、その日の残り（他の試合・背景の大会・日次処理・イベント判定）を
  // 通常の日送りと同じ経路で済ませてから翌日へ進む（`gameSetup` が印を付けて戻ってくる）
  //
  // ⚠ **印（フラグ）だけでは二重実行を止められない**。印を落とすのは `executeSkipDay` の中の
  //    `setSeasonData` 経由なので、同じコミットで2回走ると**どちらも印が立ったまま**通る。
  //    `isSimulating` も `setState` なので同じ理由で間に合わない（旧実装はこれだけだった）。
  //    `executeSkipDay` は先頭で `simulateGamesOnDate` を呼ぶので、2回通ると
  //    **その日の他の試合が二重に計算され、順位表の試合数がずれる**。
  //    ⚠ 「開発時の React が effect を2回実行するだけ」で済ませないこと——
  //    `aiManager` の `setTeam(prev => …)` で交代ログと登板疲労が二重になったのと同じ型で、
  //    あのときも**冪等にして**直した。印を落とす経路に頼らず、ここで2回目を捨てる。
  //    キーは日付（`newspaperFameDateRef` と同じ書き方）。1日に采配する自チームの試合は
  //    1つなので日付で一意になり、翌日は自然にキーが変わる＝latch の掃除が要らない
  const resumedDayRef = React.useRef(null);
  useEffect(() => {
    if (!seasonData?._resumeDayAfterManagedGame) return;
    const d = seasonData.currentDate;
    const key = `${d?.year}-${d?.month}-${d?.day}`;
    if (resumedDayRef.current === key) return;
    resumedDayRef.current = key;
    executeSkipDay(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonData?._resumeDayAfterManagedGame]);

  // ── 「次の試合まで」: 1日進行を繰り返す ──────────────────────────────
  // ⚠ **`progressToNextGame` で日付を飛ばしてはいけない**。あれは `currentDate` を
  //    次の試合日に差し替えるだけなので、間の日の試合・背景の大会・イベント判定に加えて
  //    `progressDate` の日数ループ（`recoverAllPitcherFatigue` と
  //    `updateAllPlayersCondition`）まで丸ごと抜ける。イベントは日付の完全一致でしか
  //    発火しないから、飛ばした日の分は後から戻ってこない。
  //    （`dateProgression.js` の `progressToNextGame` と `seasonProgress.js` の
  //    `handleProgressToNextGame` は、この理由で死んだまま残っていたので除去した。
  //    復活させず、1日進行をそのまま繰り返すこと。）
  const nextUserGame = useMemo(() => {
    if (!seasonData?.schedule || !seasonData?.currentDate) return null;
    return getNextGame(seasonData.schedule, seasonData.currentDate, userTeamName);
  }, [seasonData?.schedule, seasonData?.currentDate, userTeamName]);

  // 繰り返しの上限。⚠ 日数は**ゲームの暦**（`advanceDate`）で数えること。
  //    `getDaysInMonth` を持っている暦なので、JSの Date で引き算すると合わない年がある。
  //    今日の試合（まだ結果が無いもの）は 0 を返す＝「次の試合まで」は出番なし。
  const daysToNextGame = useMemo(() => {
    if (!nextUserGame) return -1;
    let n = 0;
    let d = seasonData.currentDate;
    while (compareDates(d, nextUserGame.date) < 0 && n < 60) { d = advanceDate(d, 1); n++; }
    return compareDates(d, nextUserGame.date) === 0 ? n : -1;
  }, [nextUserGame, seasonData?.currentDate]);

  const [autoAdvanceLeft, setAutoAdvanceLeft] = useState(0);
  const autoAdvanceDayRef = React.useRef(null);

  const startAutoAdvance = () => {
    if (isSimulating || daysToNextGame < 1) return;
    // 押し直したときに動き出すよう、始める時に印を落とす（下の latch の説明を参照）
    autoAdvanceDayRef.current = null;
    // ⚠ **+1 すること**。試合日に「着く」だけだと試合前モーダルが出ず、
    //    着いた画面でもう一度ボタンを押させることになる（実測でそうなった）。
    //    試合日にもう一度 `handleProgressDate` を呼べば、その中の試合チェックが
    //    モーダルを出して false を返す＝そこが終点になる。
    //    采配できないモード・フェーズなら試合は自動消化されて1日だけ余分に進むが、
    //    それは「1日進める」を押したのと同じ結果で、残り日数が0なのでそこで止まる。
    setAutoAdvanceLeft(daysToNextGame + 1);
  };

  useEffect(() => {
    if (autoAdvanceLeft <= 0) return;
    // 注意を要するダイアログが開いたら、そこが終点
    if (showGameChoiceModal || showTournamentMatchModal || pendingPhaseEvent || koshienNotice || showNewspaper) {
      setAutoAdvanceLeft(0);
      return;
    }
    const d = seasonData?.currentDate;
    const key = `${d?.year}-${d?.month}-${d?.day}`;
    // 同じ日で2回進めない。`StrictMode` のマウント時2回実行と、
    // 「進まなかった日での再入」を同時に塞ぐ（`resumedDayRef` と同じ書き方）
    if (autoAdvanceDayRef.current === key) { setAutoAdvanceLeft(0); return; }
    autoAdvanceDayRef.current = key;
    // 進めたら残りを減らす。引き止められたら（モーダルが出た等）そこで終わり
    if (handleProgressDate(1)) setAutoAdvanceLeft(n => n - 1);
    else setAutoAdvanceLeft(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdvanceLeft, seasonData?.currentDate]);

  // ── 開発用の早送り（`src/game/devTools.js` が許したときだけ画面に出る） ──
  // 「1日進める」を押すのと同じ `handleProgressDate(1)` を繰り返すだけ。日付を差し替えない
  // （上の「次の試合まで」の注意を参照）。止まる条件も `handleProgressDate` の戻り値に従う。
  // 違うのは、自分の試合の前のモーダルで「おまかせ（skip）」を選んで先へ進めることと、
  // 甲子園の結果のお知らせを閉じて進めることだけ。
  // フェーズ移行（ドラフト・契約更改など）と大会の試合のモーダルでは**止まる**。
  // そこが確かめたい画面のはずなので、人が見て押す。
  const devToolsEnabled = useMemo(() => isDevToolsEnabled(), []);
  const [devLeft, setDevLeft] = useState(0);
  const [devTick, setDevTick] = useState(0);
  const devDayRef = React.useRef(null);
  const startDevAdvance = (days) => {
    if (isSimulating) return;
    devDayRef.current = null;
    setDevLeft(days);
  };
  useEffect(() => {
    // 大会の組み合わせを作っている間（読み込み画面）は待つ。作り終えた状態が入ってから
    // 続ける。待たずに進めると、後から入る古い日付の状態で上書きされる
    if (devLeft <= 0 || isSimulating || isGeneratingTournament) return;
    if (pendingPhaseEvent || showTournamentMatchModal) { setDevLeft(0); return; }
    if (koshienNotice) { setKoshienNotice(null); return; }
    if (showGameChoiceModal) {
      // 自分の試合は「おまかせ」で消化する（1日進む）
      handleGameChoice('skip');
      setDevLeft(n => n - 1);
      return;
    }
    const d = seasonData?.currentDate;
    const key = `${d?.year}-${d?.month}-${d?.day}`;
    // 同じ日で2回進めない（StrictMode の2回実行と、引き止められた日での再入を塞ぐ）
    if (devDayRef.current === key) { setDevLeft(0); return; }
    devDayRef.current = key;
    if (handleProgressDate(1)) setDevLeft(n => n - 1);
    // 引き止められた。モーダルが開いたなら上で扱い、開かなかったなら（スタメン不足など）
    // 次の回で同じ日のキーに当たって止まる。どちらでも1回はやり直させる。
    else setDevTick(t => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devLeft, devTick, isSimulating, isGeneratingTournament, seasonData?.currentDate, showGameChoiceModal, koshienNotice, pendingPhaseEvent, showTournamentMatchModal]);

  const handleGameChoice = (choice) => {
    if (isSimulating) return;
    setShowGameChoiceModal(false);
    if (choice === 'skip') {
      executeSkipDay(1);
    } else if (choice === 'manage') {
      // 采配モードへ移行
      const todayGames = getScheduleByDate(seasonData.schedule, seasonData.currentDate);
      const userGame = todayGames.find(g => !g.result && (g.home === userTeamName || g.away === userTeamName));
      const otherGames = todayGames.filter(g => !g.result && g.home !== userTeamName && g.away !== userTeamName);

      if (userGame && onSetupManagedGame) {
        onSetupManagedGame({
          gameId: userGame.id,
          home: userGame.home,
          away: userGame.away,
          otherGames: otherGames.map(g => ({ gameId: g.id, home: g.home, away: g.away }))
        });
      }
    }
  };

  // トーナメント: ユーザーの試合を開始（都市対抗 / 日本選手権 / 地域トーナメント 共用）
  const startTournamentMatch = (opponentName, opponentDef, matchInfo) => {
    if (!onSetupManagedGame) return;
    const oppName = opponentDef?.displayName || opponentDef?.name || opponentName;
    const isNS = matchInfo.bracketType === 'nihon_senshuken' || matchInfo.bracketType === 'nihon_senshuken_qualifier' || matchInfo.bracketType === 'nihon_senshuken_qualifier_losers';
    const isCS = matchInfo.bracketType === 'club_senshuken' || matchInfo.bracketType === 'club_senshuken_qualifier' || matchInfo.bracketType === 'club_senshuken_qualifier_losers';
    const isRT = matchInfo.bracketType === 'regional_tournament';
    const isUC = matchInfo.type === 'university_championship';
    const isMJ = matchInfo.type === 'meiji_jingu';
    const pendingMatch = {
      regionId: matchInfo.regionId,
      roundIdx: matchInfo.roundIdx,
      matchIdx: matchInfo.matchIdx,
      opponentName: oppName,
      bracketType: matchInfo.bracketType || matchInfo.type || 'main',
    };

    let updatedData;
    if (isUC) {
      updatedData = { ...seasonData, universityChampionship: { ...seasonData.universityChampionship, pendingMatch } };
    } else if (isMJ) {
      updatedData = { ...seasonData, meijiJingu: { ...seasonData.meijiJingu, pendingMatch } };
    } else if (isRT) {
      updatedData = { ...seasonData, regionalTournament: { ...seasonData.regionalTournament, pendingMatch } };
    } else if (isCS) {
      updatedData = { ...seasonData, clubSenshuken: { ...seasonData.clubSenshuken, pendingMatch } };
    } else if (isNS) {
      updatedData = { ...seasonData, nihonSenshuken: { ...seasonData.nihonSenshuken, pendingMatch } };
    } else {
      updatedData = { ...seasonData, toshitaikou: { ...seasonData.toshitaikou, pendingMatch } };
    }
    setSeasonData(updatedData);

    const prefix = isUC ? 'university_championship' : isMJ ? 'meiji_jingu' : isRT ? 'regional_tournament' : isCS ? 'club_senshuken' : isNS ? 'nihon_senshuken' : 'toshitaikou';
    onSetupManagedGame({
      gameId: `${prefix}_${matchInfo.bracketType}_${matchInfo.roundIdx}_${matchInfo.matchIdx}`,
      home: userTeamName,
      away: oppName,
      otherGames: [],
      isTournament: true,
    });
  };

  useEffect(() => {
    if (onRegisterAdvance) onRegisterAdvance(() => handleProgressDate(1));
  });

  // マウント時: 独立リーグスケジュールが古い年度のものであればリセット（セーブロード後の取りこぼし対策）
  useEffect(() => {
    if (!WORLD_DATA.initialized || !WORLD_DATA.independentLeagues) return;
    const calYear = seasonData?.currentDate?.year;
    if (!calYear) return;
    const stale = Object.values(WORLD_DATA.independentLeagues).find(ld => {
      if (!ld?.schedule?.length) return false;
      const schedYear = ld.schedule.find(g => g.date?.year)?.date?.year;
      return schedYear && schedYear < calYear;
    });
    if (stale) resetIndependentLeagueSchedules(calYear);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 大学トーナメント終了時に自動折り畳み
  useEffect(() => {
    if (seasonData?.universityChampionship?.champion) setShowUcTournament(false);
    else if (seasonData?.universityChampionship?.generated) setShowUcTournament(true);
  }, [seasonData?.universityChampionship?.champion, seasonData?.universityChampionship?.generated]);

  useEffect(() => {
    if (seasonData?.meijiJingu?.champion) setShowMjTournament(false);
    else if (seasonData?.meijiJingu?.generated) setShowMjTournament(true);
  }, [seasonData?.meijiJingu?.champion, seasonData?.meijiJingu?.generated]);

  // 社会人トーナメント（背景世界）全終了時に自動折り畳み
  useEffect(() => {
    const ct = WORLD_DATA.corporateToshitaikou;
    const cn = WORLD_DATA.corporateNihonSenshuken;
    const cc = WORLD_DATA.corporateClubSenshuken;
    const cr = WORLD_DATA.corporateRegionalTournament;
    const anyGenerated = cr?.generated || ct?.generated || cn?.generated || cc?.generated;
    const anyActive = (
      (cr?.generated && cr?.phase !== 'done') ||
      (ct?.generated && !ct?.mainDone) ||
      (cn?.generated && !cn?.done) ||
      (cc?.generated && !cc?.done)
    );
    if (anyGenerated && !anyActive) setShowCorporateTournaments(false);
    else if (anyActive) setShowCorporateTournaments(true);
  }, [seasonData?.currentDate?.month, seasonData?.currentDate?.day]);

  // ⚠ getDaysInMonth は seasonManager の export を使う（同じ式をここに書き直さないこと）
  const getFirstDayOfWeek = (year, month) => new Date(year, month - 1, 1).getDay();

  const year = seasonData.currentDate?.year || 2024;
  const daysInMonth = getDaysInMonth(year, selectedMonth);
  const firstDay = getFirstDayOfWeek(year, selectedMonth);

  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const todayDow = new Date(seasonData.currentDate.year, seasonData.currentDate.month - 1, seasonData.currentDate.day).getDay();

  // トーナメント日程をカレンダー用に取得
  const tournamentCalendarDates = useMemo(() => {
    const allDates = [];
    if (seasonData.toshitaikou?.generated) {
      allDates.push(...getTournamentDatesForCalendar(seasonData.toshitaikou, userTeamName));
    }
    if (seasonData.nihonSenshuken?.generated) {
      allDates.push(...getNihonSenshukenDatesForCalendar(seasonData.nihonSenshuken, userTeamName));
    }
    if (seasonData.regionalTournament?.generated) {
      allDates.push(...getRegionalTournamentDatesForCalendar(seasonData.regionalTournament, userTeamName));
    }
    if (seasonData.clubSenshuken?.generated) {
      allDates.push(...getNihonSenshukenDatesForCalendar(seasonData.clubSenshuken, userTeamName, 'club_senshuken'));
    }
    if (seasonData.universityChampionship?.generated) {
      allDates.push(...getUniversityTournamentDatesForCalendar(seasonData.universityChampionship, userTeamName));
    }
    if (seasonData.meijiJingu?.generated) {
      allDates.push(...getUniversityTournamentDatesForCalendar(seasonData.meijiJingu, userTeamName));
    }
    const dateMap = {};
    allDates.forEach(d => {
      const key = `${d.date.month}-${d.date.day}`;
      if (!dateMap[key]) dateMap[key] = [];
      dateMap[key].push(d);
    });
    return dateMap;
  }, [seasonData.toshitaikou, seasonData.nihonSenshuken, seasonData.clubSenshuken, seasonData.regionalTournament, seasonData.universityChampionship, seasonData.meijiJingu, userTeamName]);

  const calendarCells = useMemo(() => {
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push({ day: null, games: [], eventLabel: null, tournamentEvents: [] });
    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = { year, month: selectedMonth, day };
      const gamesOnDay = getScheduleByDate(seasonData.schedule, dateObj);
      const isToday = seasonData.currentDate.year === year && seasonData.currentDate.month === selectedMonth && seasonData.currentDate.day === day;
      const phaseOpts = isUniversity ? { universityMode: true } : undefined;
      const phase = getCurrentPhase(selectedMonth, day, phaseOpts, year);
      let eventLabel = null;
      if (selectedMonth === 11 && day === 30) eventLabel = 'シーズン終了';
      else if (isUniversity && selectedMonth === 11 && day === 29) eventLabel = 'セレクション';
      else if (isUniversity && selectedMonth === 8 && day >= 20 && day <= 31) eventLabel = '夏合宿';
      else if (phase === SEASON_PHASES.SPRING_CAMP) eventLabel = 'キャンプ';
      else if (phase === SEASON_PHASES.PLAYOFFS && !isCorporate) eventLabel = 'プレーオフ';
      else if (!isCorporate && !isUniversity && selectedMonth === 10 && day === 21) eventLabel = 'グランドCS';
      else if (phase === SEASON_PHASES.DRAFT) eventLabel = 'ドラフト';
      else if (phase === SEASON_PHASES.CONTRACT) eventLabel = isCorporate ? '退団' : '契約更改';
      else if (phase === SEASON_PHASES.TRYOUT) eventLabel = isCorporate ? 'スカウト入団' : 'トライアウト';
      else if (phase === SEASON_PHASES.OFF_SEASON && !isCorporate) eventLabel = 'オフシーズン';
      const tKey = `${selectedMonth}-${day}`;
      const tournamentEvents = tournamentCalendarDates[tKey] || [];
      cells.push({ day, games: gamesOnDay, isToday, eventLabel, tournamentEvents });
    }
    return cells;
  }, [seasonData.schedule, seasonData.currentDate, year, selectedMonth, daysInMonth, firstDay, tournamentCalendarDates, isCorporate, isUniversity]);

  const todaysGames = getScheduleByDate(seasonData.schedule, seasonData.currentDate);

  // ⚠ **「次の自チーム戦まであと何日」は撤去済み**（`nextUserGame`）。
  //    先頭の進行バーの中にあったが、バーごと撤去した。カレンダーは自チームの試合日を
  //    青、自チームのトーナメントを黄で塗っているので、**同じことが絵で分かる**。
  //    ⚠ データを作る `useMemo` も併せて消してある——描画されない state を残さない。

  // ⚠ **「昨日の結果」は撤去済み**（日程進行が縦に長くなりすぎたため）。
  //    `simulateGamesOnDate` の戻り値が一度も描画されていなかったのを直した機能で、
  //    データは `seasonData.results`（リーグ戦）＋ 各ブラケットの日付走査
  //    （トーナメント。社会人はリーグ戦を持たないのでこちらが本体）で作っていた。
  //    ⚠ **宣言だけ残さないこと**——描画されない state はこの作品が繰り返し踏んだ defect。
  //    復活させるなら git 履歴から戻し、**縦を増やさない置き方**にすること
  //    （⚠ かつてここに「進行バーの中に1行」と書いてあったが、**その進行バーも撤去した**。
  //    折りたたみか、カレンダーの「本日の試合」欄に畳むことになる）。

  // 今日のトーナメント試合を取得（「本日の対戦」欄に表示するため）
  const todaysTournamentMatches = useMemo(() => {
    const matches = [];
    const cd = seasonData.currentDate;
    const isDateMatch = (d) => d && cd.year === d.year && cd.month === d.month && cd.day === d.day;

    // 都市対抗 予選
    const td = seasonData.toshitaikou;
    if (td?.generated && !td.qualifiersDone) {
      const qualifiers = td.qualifiers || {};
      for (const [regionId, q] of Object.entries(qualifiers)) {
        for (const [bracketType, bracket] of [['main', q.mainBracket], ['losers', q.losersBracket]]) {
          if (!bracket) continue;
          const um = getUserNextMatch(bracket, userTeamName);
          if (!um) continue;
          const matchDate = bracket.matchDates?.[um.roundIdx]?.[um.matchIdx] || bracket.roundDates?.[um.roundIdx];
          if (!isDateMatch(matchDate)) continue;
          const oppName = um.match.team1 === userTeamName ? um.match.team2 : um.match.team1;
          const oppDef = q.teamDefsMap[oppName];
          matches.push({
            type: 'toshitaikou_qualifier',
            label: `都市対抗 地区予選 ${bracketType === 'losers' ? '敗者復活 ' : ''}${getRoundName(bracket, um.roundIdx)}`,
            opponent: oppName, oppDef, color: 'yellow',
            regionId, roundIdx: um.roundIdx, matchIdx: um.matchIdx, bracketType,
          });
        }
      }
    }
    // 都市対抗 本戦
    if (td?.mainTournament) {
      const mt = td.mainTournament;
      const bracket = mt.bracket;
      const um = td.phase !== 'done' ? getUserNextMatch(bracket, userTeamName) : null;
      if (um) {
        const matchDate = bracket?.matchDates?.[um.roundIdx]?.[um.matchIdx] || bracket?.roundDates?.[um.roundIdx];
        if (isDateMatch(matchDate)) {
          const oppName = um.match.team1 === userTeamName ? um.match.team2 : um.match.team1;
          const oppDef = mt.teamDefsMap[oppName];
          matches.push({
            type: 'toshitaikou_main',
            label: `都市対抗 本戦 ${getRoundName(bracket, um.roundIdx)}`,
            opponent: oppName, oppDef, color: 'yellow',
            roundIdx: um.roundIdx, matchIdx: um.matchIdx, bracketType: 'main_tournament',
          });
        }
      }
    }
    // 地域トーナメント
    const rt = seasonData.regionalTournament;
    if (rt?.generated && rt.phase !== 'done' && rt.userRegionId) {
      const region = rt.brackets[rt.userRegionId];
      if (region && region.phase !== 'done') {
        const um = getUserNextMatch(region.bracket, userTeamName);
        if (um) {
          const matchDate = region.bracket.matchDates?.[um.roundIdx]?.[um.matchIdx] || region.bracket.roundDates?.[um.roundIdx];
          if (isDateMatch(matchDate)) {
            const oppName = um.match.team1 === userTeamName ? um.match.team2 : um.match.team1;
            const oppDef = region.teamDefsMap[oppName];
            matches.push({
              type: 'regional_tournament',
              label: `地域トーナメント ${region.regionName} ${getRoundName(region.bracket, um.roundIdx)}`,
              opponent: oppName, oppDef, color: 'green',
              regionId: rt.userRegionId, roundIdx: um.roundIdx, matchIdx: um.matchIdx, bracketType: 'regional_tournament',
            });
          }
        }
      }
    }
    // 日本選手権（予選＋本戦）
    const ns = seasonData.nihonSenshuken;
    if (ns?.generated && ns.phase !== 'done') {
      // 予選フェーズ
      if ((ns.phase === 'qualifiers' || ns.phase === 'qualifiers_done') && ns.qualifiers && ns.userRegionId) {
        const q = ns.qualifiers[ns.userRegionId];
        if (q && q.phase !== 'done') {
          for (const [bracketType, bracket] of [['nihon_senshuken_qualifier', q.mainBracket], ['nihon_senshuken_qualifier_losers', q.losersBracket]]) {
            if (!bracket) continue;
            const um = getUserNextMatch(bracket, userTeamName);
            if (!um) continue;
            const matchDate = bracket.matchDates?.[um.roundIdx]?.[um.matchIdx] || bracket.roundDates?.[um.roundIdx];
            if (!isDateMatch(matchDate)) continue;
            const oppName = um.match.team1 === userTeamName ? um.match.team2 : um.match.team1;
            const oppDef = q.teamDefsMap[oppName];
            matches.push({
              type: 'nihon_senshuken_qualifier',
              label: `日本選手権 地区予選 ${bracketType.includes('losers') ? '敗者復活 ' : ''}${getRoundName(bracket, um.roundIdx)}`,
              opponent: oppName, oppDef, color: 'red',
              regionId: ns.userRegionId, roundIdx: um.roundIdx, matchIdx: um.matchIdx, bracketType,
            });
          }
        }
      }
      // 本戦フェーズ
      if (ns.phase === 'main' && ns.mainTournament) {
        const nsBracket = ns.mainTournament.bracket;
        const um = ns.mainTournament.phase !== 'done' ? getUserNextMatch(nsBracket, userTeamName) : null;
        if (um) {
          const matchDate = nsBracket?.matchDates?.[um.roundIdx]?.[um.matchIdx] || nsBracket?.roundDates?.[um.roundIdx];
          if (isDateMatch(matchDate)) {
            const oppName = um.match.team1 === userTeamName ? um.match.team2 : um.match.team1;
            const oppDef = ns.mainTournament.teamDefsMap[oppName];
            matches.push({
              type: 'nihon_senshuken',
              label: `日本選手権 本戦 ${getRoundName(nsBracket, um.roundIdx)}`,
              opponent: oppName, oppDef, color: 'red',
              roundIdx: um.roundIdx, matchIdx: um.matchIdx, bracketType: 'nihon_senshuken',
            });
          }
        }
      }
    }
    // クラブ選手権（予選＋本戦）
    const csd = seasonData.clubSenshuken;
    if (csd?.generated && csd.phase !== 'done') {
      if ((csd.phase === 'qualifiers' || csd.phase === 'qualifiers_done') && csd.qualifiers && csd.userRegionId) {
        const q = csd.qualifiers[csd.userRegionId];
        if (q && q.phase !== 'done') {
          for (const [bracketType, bracket] of [['club_senshuken_qualifier', q.mainBracket], ['club_senshuken_qualifier_losers', q.losersBracket]]) {
            if (!bracket) continue;
            const um = getUserNextMatch(bracket, userTeamName);
            if (!um) continue;
            const matchDate = bracket.matchDates?.[um.roundIdx]?.[um.matchIdx] || bracket.roundDates?.[um.roundIdx];
            if (!isDateMatch(matchDate)) continue;
            const oppName = um.match.team1 === userTeamName ? um.match.team2 : um.match.team1;
            const oppDef = q.teamDefsMap[oppName];
            matches.push({
              type: 'club_senshuken_qualifier',
              label: `クラブ選手権 地区予選 ${bracketType.includes('losers') ? '敗者復活 ' : ''}${getRoundName(bracket, um.roundIdx)}`,
              opponent: oppName, oppDef, color: 'purple',
              regionId: csd.userRegionId, roundIdx: um.roundIdx, matchIdx: um.matchIdx, bracketType,
            });
          }
        }
      }
      if (csd.phase === 'main' && csd.mainTournament) {
        const csBracket = csd.mainTournament.bracket;
        const um = csd.mainTournament.phase !== 'done' ? getUserNextMatch(csBracket, userTeamName) : null;
        if (um) {
          const matchDate = csBracket?.matchDates?.[um.roundIdx]?.[um.matchIdx] || csBracket?.roundDates?.[um.roundIdx];
          if (isDateMatch(matchDate)) {
            const oppName = um.match.team1 === userTeamName ? um.match.team2 : um.match.team1;
            const oppDef = csd.mainTournament.teamDefsMap[oppName];
            matches.push({
              type: 'club_senshuken',
              label: `クラブ選手権 本戦 ${getRoundName(csBracket, um.roundIdx)}`,
              opponent: oppName, oppDef, color: 'purple',
              roundIdx: um.roundIdx, matchIdx: um.matchIdx, bracketType: 'club_senshuken',
            });
          }
        }
      }
    }
    return matches;
  }, [seasonData.toshitaikou, seasonData.nihonSenshuken, seasonData.clubSenshuken, seasonData.regionalTournament, seasonData.currentDate, userTeamName]);

  // ⚠ **「本日の自チームの予定」は撤去済み**（`todaysUserMatch`）。進行バーの中にあったが、
  //    下の「本日の試合」欄が同じ内容をカードで出しており**二重だった**。
  //    ⚠ データを作る `useMemo` も併せて消してある——描画されない state を残さない。

  // 月間戦績を1回だけ計算（ヘッダーとサマリーの両方で使用）
  const monthlyStats = useMemo(() => {
    const monthGames = calendarCells
      .filter(c => c.day !== null)
      .flatMap(c => c.games)
      .filter(g => g.result && !g.result.cancelled && (g.home === userTeamName || g.away === userTeamName));
    if (monthGames.length === 0) return null;
    let wins = 0, losses = 0, draws = 0;
    const results = [];
    monthGames.forEach(g => {
      const isHome = g.home === userTeamName;
      const hw = g.result.homeScore > g.result.awayScore;
      const aw = g.result.awayScore > g.result.homeScore;
      const won = isHome ? hw : aw;
      const lost = isHome ? aw : hw;
      if (won) { wins++; results.push('win'); }
      else if (lost) { losses++; results.push('loss'); }
      else { draws++; results.push('draw'); }
    });
    // ⚠ 旧実装は `.toFixed(3).slice(2)` で、表示側が `(.{winRate})` と頭に点を付けていた。
    //    `"0.667" → "667"` の前提なので、**全勝の `"1.000"` が `"000"` に潰れて `.000` と出る**
    //    （1勝0敗と0勝1敗が同じ表示になり、勝率が真逆に読める）。野球の慣習どおり
    //    先頭の 0 だけを落とし、1.000 はそのまま出す
    const winRate = (wins + losses) > 0
      ? (wins / (wins + losses)).toFixed(3).replace(/^0/, '')
      : '---';
    return { wins, losses, draws, results, winRate };
  }, [calendarCells, userTeamName]);

  const totalGames = seasonData?.settings?.gamesPerSeason || 60;
  const standings = seasonData.standings || [];

  const leagueFormat = seasonData?.settings?.leagueFormat || 'single';
  const isTwoLeague = leagueFormat === 'two';
  const teamNamesList = seasonData?.settings?.teamNames || [];
  const leagueNamesList = seasonData?.settings?.leagueNames || ['リーグ1', 'リーグ2'];
  const halfTeams = Math.floor((seasonData?.settings?.teamsCount || 4) / 2);
  const league1Teams = isTwoLeague ? teamNamesList.slice(0, halfTeams) : [];
  const league2Teams = isTwoLeague ? teamNamesList.slice(halfTeams) : [];
  const getLeagueLabel = (game) => {
    if (!isTwoLeague) return null;
    if (league1Teams.includes(game.home) && league1Teams.includes(game.away)) return leagueNamesList[0];
    if (league2Teams.includes(game.home) && league2Teams.includes(game.away)) return leagueNamesList[1];
    return '交流戦';
  };
  const leader = standings[0];
  const leaderWins = leader?.wins || 0;
  const leaderLosses = leader?.losses || 0;
  const isChampionDecided = leader && standings.length > 1 && (() => {
    const second = standings[1];
    const secondRemaining = totalGames - ((second.wins || 0) + (second.losses || 0) + (second.draws || 0));
    return leaderWins > (second.wins || 0) + secondRemaining;
  })();

  // トピック生成（試合結果が増えた時だけ再計算 = 試合のある日のみ更新）
  const cachedTopics = useMemo(() => {
    const topics = [];
    const userLeagueTeamSet = new Set(seasonData?.settings?.teamNames || []);
    const allTeamNames = userLeagueTeamSet.size > 0
      ? Object.keys(TEAMS_DATA || {}).filter(tn => userLeagueTeamSet.has(tn))
      : Object.keys(TEAMS_DATA || {});
    // 社会人・大学モードはTEAMS_DATAに選手が入っている全チームを対象にする
    const allPlayersTeams = (seasonData?.settings?.corporateMode || seasonData?.settings?.universityMode)
      ? Object.keys(TEAMS_DATA || {})
      : allTeamNames;
    const allPlayers = [];
    allPlayersTeams.forEach(tn => {
      (TEAMS_DATA[tn]?.players || []).forEach(p => allPlayers.push({ ...p, teamName: tn }));
    });

    // 直前の試合結果からトピック生成
    // 社会人・大学モードはsettings.teamNamesが自チームのみのため、結果を広めに取る
    const recentCount = (seasonData?.settings?.corporateMode || seasonData?.settings?.universityMode)
      ? Math.min(40, (seasonData.results || []).length)
      : Math.max(allTeamNames.length, 1);
    const recentResults = (seasonData.results || []).slice(-recentCount);
    recentResults.forEach(r => {
      if (!r.result || r.result.cancelled) return;
      const hs = r.result.homeScore;
      const as = r.result.awayScore;
      const diff = Math.abs(hs - as);
      if (diff >= 8) {
        const winner = hs > as ? r.home : r.away;
        topics.push({ cat: 'game_blowout', icon: '💥', text: `${getTeamAbbreviation(winner)}が${diff}点差の大勝`, color: 'text-red-400' });
      }
      if (hs === 0 || as === 0) {
        const winner = hs > as ? r.home : r.away;
        topics.push({ cat: 'game_shutout', icon: '🛡️', text: `${getTeamAbbreviation(winner)}投手陣が完封勝利`, color: 'text-blue-400' });
      }
      if (hs > as && diff === 1) {
        topics.push({ cat: 'game_walkoff', icon: '🎉', text: `${getTeamAbbreviation(r.home)}がサヨナラ勝ち！`, color: 'text-yellow-400' });
      }
    });

    // 個人成績のマイルストーン
    allPlayers.forEach(p => {
      const bs = p.seasonStats?.batting;
      const ps = p.seasonStats?.pitching;
      const abbr = getTeamAbbreviation(p.teamName);
      if (bs?.atBats >= 30 && bs.hits / bs.atBats >= 0.350) {
        topics.push({ cat: 'bat_avg', icon: '🔥', text: `${abbr} ${p.name}が打率${(bs.hits / bs.atBats).toFixed(3)}と好調`, color: 'text-orange-400' });
      }
      const hr = bs?.homeruns || 0;
      if (hr > 0 && (hr === 10 || hr === 20 || hr === 30 || hr === 40 || hr === 50)) {
        topics.push({ cat: 'bat_hr', icon: '💣', text: `${abbr} ${p.name}が${hr}号到達`, color: 'text-pink-400', team: p.teamName });
      }
      const w = ps?.wins || 0;
      if (w > 0 && (w === 5 || w === 10 || w === 15 || w === 20)) {
        topics.push({ cat: 'pitch_wins', icon: '🏆', text: `${abbr} ${p.name}が${w}勝目`, color: 'text-yellow-400', team: p.teamName });
      }
      const so = ps?.strikeouts || 0;
      if (so > 0 && (so === 50 || so === 100 || so === 150 || so === 200)) {
        topics.push({ cat: 'pitch_k', icon: '🌀', text: `${abbr} ${p.name}が${so}奪三振達成`, color: 'text-purple-400', team: p.teamName });
      }
      if (p.age <= 22 && bs?.atBats >= 20 && bs.hits / bs.atBats >= 0.300) {
        topics.push({ cat: 'young', icon: '⭐', text: `${abbr} ${p.name}(${p.age}歳)にスカウトが熱視線`, color: 'text-cyan-400' });
      }
    });

    // 順位変動トピック
    const _standings = seasonData.standings || [];
    const userStandingData = _standings.find(s => s.team === userTeamName);
    if (userStandingData) {
      const ur = _standings.indexOf(userStandingData) + 1;
      if (ur === 1 && (userStandingData.wins || 0) >= 3) {
        topics.push({ cat: 'standings', icon: '👑', text: `${userTeamName}が首位をキープ`, color: 'text-yellow-300' });
      }
      if (ur <= 3 && _standings.length >= 2) {
        const first = _standings[0];
        const second = _standings[1];
        const gb = ((first.wins - second.wins) - (first.losses - second.losses)) / 2;
        if (gb <= 1.0 && gb > 0) {
          topics.push({ cat: 'standings', icon: '⚡', text: `首位${getTeamAbbreviation(first.team)}と2位${getTeamAbbreviation(second.team)}が${gb}ゲーム差の接戦`, color: 'text-red-300' });
        }
      }
    }

    // 試合結果からの追加トピック
    recentResults.forEach(r => {
      if (!r.result || r.result.cancelled) return;
      const hs = r.result.homeScore;
      const as = r.result.awayScore;
      const total = hs + as;
      const diff = Math.abs(hs - as);
      if (total >= 15) {
        topics.push({ cat: 'game_slugfest', icon: '🎆', text: `${getTeamAbbreviation(r.home)}vs${getTeamAbbreviation(r.away)}は合計${total}点の乱打戦`, color: 'text-orange-300' });
      }
      if (total <= 2 && total > 0) {
        topics.push({ cat: 'game_pitching', icon: '🧊', text: `${getTeamAbbreviation(r.home)}vs${getTeamAbbreviation(r.away)}は${hs}-${as}の緊迫した投手戦`, color: 'text-blue-300' });
      }
      if (hs > as && diff >= 2 && diff <= 3 && hs >= 5) {
        topics.push({ cat: 'game_comeback', icon: '🔄', text: `${getTeamAbbreviation(r.home)}が終盤の粘りで逆転勝利`, color: 'text-green-400' });
      }
      if (hs === as) {
        topics.push({ cat: 'game_draw', icon: '🤝', text: `${getTeamAbbreviation(r.home)}vs${getTeamAbbreviation(r.away)}は${hs}-${as}の引き分け`, color: 'text-gray-300' });
      }
    });

    // チーム連勝・連敗
    allTeamNames.forEach(tn => {
      const abbr = getTeamAbbreviation(tn);
      const teamResults = (seasonData.results || []).filter(g => g.result && !g.result.cancelled && (g.home === tn || g.away === tn));
      if (teamResults.length >= 5) {
        let streak = 0;
        let streakType = null;
        for (let i = teamResults.length - 1; i >= 0; i--) {
          const g = teamResults[i];
          const isHome = g.home === tn;
          const won = isHome ? g.result.homeScore > g.result.awayScore : g.result.awayScore > g.result.homeScore;
          const lost = isHome ? g.result.homeScore < g.result.awayScore : g.result.awayScore < g.result.homeScore;
          if (streakType === null) {
            streakType = won ? 'win' : lost ? 'loss' : null;
            if (!streakType) break;
            streak = 1;
          } else if ((streakType === 'win' && won) || (streakType === 'loss' && lost)) {
            streak++;
          } else {
            break;
          }
        }
        if (streakType === 'win' && streak >= 5) {
          topics.push({ cat: 'team_streak', icon: '🔥', text: `${abbr}が破竹の${streak}連勝中！`, color: 'text-red-400' });
        }
        if (streakType === 'loss' && streak >= 5) {
          topics.push({ cat: 'team_streak', icon: '📉', text: `${abbr}が${streak}連敗と苦しい展開`, color: 'text-gray-300' });
        }
      }
    });

    // 個人成績の追加トピック
    allPlayers.forEach(p => {
      const bs = p.seasonStats?.batting;
      const ps = p.seasonStats?.pitching;
      const abbr = getTeamAbbreviation(p.teamName);

      const rbi = bs?.rbis || 0;
      if (rbi > 0 && (rbi === 20 || rbi === 30 || rbi === 40 || rbi === 50 || rbi === 60 || rbi === 70 || rbi === 80)) {
        topics.push({ cat: 'bat_rbi', icon: '💪', text: `${abbr} ${p.name}が${rbi}打点到達`, color: 'text-orange-400', team: p.teamName });
      }
      const sb = bs?.stolenBases || 0;
      if (sb > 0 && (sb === 10 || sb === 20 || sb === 30 || sb === 40 || sb === 50)) {
        topics.push({ cat: 'bat_sb', icon: '💨', text: `${abbr} ${p.name}が${sb}盗塁到達、俊足が光る`, color: 'text-green-300', team: p.teamName });
      }
      if (bs?.atBats >= 50 && bs.hits / bs.atBats < 0.200) {
        topics.push({ cat: 'bat_slump', icon: '😰', text: `${abbr} ${p.name}が打率${(bs.hits / bs.atBats).toFixed(3)}と深刻な不振`, color: 'text-gray-300' });
      }
      if ((bs?.hits || 0) > 0 && ((bs.hits) === 50 || (bs.hits) === 100 || (bs.hits) === 150)) {
        topics.push({ cat: 'bat_hits', icon: '📊', text: `${abbr} ${p.name}がシーズン${bs.hits}安打到達`, color: 'text-blue-300', team: p.teamName });
      }
      if (bs?.atBats >= 30) {
        const pa = bs.atBats + (bs.walks || 0) + (bs.hitByPitch || 0);
        const obp = (bs.hits + (bs.walks || 0) + (bs.hitByPitch || 0)) / pa;
        if (obp >= 0.420) {
          topics.push({ cat: 'bat_obp', icon: '👁️', text: `${abbr} ${p.name}の出塁率${obp.toFixed(3)}は驚異的`, color: 'text-teal-400' });
        }
      }
      const bk = bs?.strikeouts || 0;
      if (bk > 0 && (bk === 50 || bk === 100 || bk === 150)) {
        topics.push({ cat: 'bat_k', icon: '🌬️', text: `${abbr} ${p.name}が${bk}三振到達、粗さが目立つ`, color: 'text-gray-300' });
      }

      // inningsPitched はアウト数で保存されている（3アウト=1イニング）
      // 30イニング = 90アウトが閾値
      if (ps && (ps.inningsPitched || 0) >= 90) {
        const era = ((ps.earnedRuns || 0) * 27) / ps.inningsPitched;
        if (era <= 1.99 && era >= 0) {
          topics.push({ cat: 'pitch_era', icon: '🎯', text: `${abbr} ${p.name}が防御率${era.toFixed(2)}と圧巻`, color: 'text-emerald-400' });
        }
        if (era >= 5.00 && ps.games >= 5) {
          topics.push({ cat: 'pitch_era', icon: '🚒', text: `${abbr} ${p.name}が防御率${era.toFixed(2)}と炎上中`, color: 'text-red-300' });
        }
      }
      const sv = ps?.saves || 0;
      if (sv > 0 && (sv === 5 || sv === 10 || sv === 15 || sv === 20 || sv === 25 || sv === 30)) {
        topics.push({ cat: 'pitch_save', icon: '🔒', text: `${abbr} ${p.name}が${sv}セーブ到達、守護神の仕事`, color: 'text-indigo-400', team: p.teamName });
      }
      const qs = ps?.qualityStarts || 0;
      if (qs > 0 && (qs === 5 || qs === 10 || qs === 15 || qs === 20)) {
        topics.push({ cat: 'pitch_qs', icon: '📐', text: `${abbr} ${p.name}がQS${qs}回到達、安定感抜群`, color: 'text-sky-400' });
      }

      if (p.age >= 35 && bs?.atBats >= 20 && bs.hits / bs.atBats >= 0.280) {
        topics.push({ cat: 'veteran', icon: '🫡', text: `${abbr} ${p.name}(${p.age}歳)、衰え知らずの活躍`, color: 'text-amber-400' });
      }
      const dbl = bs?.doubles || 0;
      if (dbl > 0 && (dbl === 10 || dbl === 20 || dbl === 30 || dbl === 40 || dbl === 50)) {
        topics.push({ cat: 'bat_2b', icon: '↗️', text: `${abbr} ${p.name}が${dbl}二塁打到達、広角打法が冴える`, color: 'text-lime-400', team: p.teamName });
      }

      if (bs?.atBats >= 10) {
        const recentGames = (seasonData.results || []).slice(-10);
        let recentHits = 0, recentAB = 0, recentHR = 0;
        recentGames.forEach(g => {
          if (!g.result || g.result.cancelled) return;
          const isHome = g.home === p.teamName;
          const lineup = isHome ? g.result.homeLineup : g.result.awayLineup;
          if (!lineup) return;
          const pStats = lineup?.find(l => l.name === p.name);
          if (pStats) {
            recentHits += pStats.hits || 0;
            recentAB += pStats.atBats || 0;
            recentHR += pStats.homeruns || 0;
          }
        });
        if (recentAB >= 10) {
          const recentAvg = recentHits / recentAB;
          if (recentAvg >= 0.400) {
            topics.push({ cat: 'bat_hot', icon: '🔥', text: `${abbr} ${p.name}が直近${recentAB}打数${recentHits}安打と絶好調！`, color: 'text-red-400' });
          }
          if (recentAB >= 12 && recentAvg < 0.100) {
            topics.push({ cat: 'bat_cold', icon: '❄️', text: `${abbr} ${p.name}が直近${recentAB}打数${recentHits}安打と当たりが止まらない`, color: 'text-blue-300' });
          }
          if (recentHR >= 3) {
            topics.push({ cat: 'bat_hr_streak', icon: '💥', text: `${abbr} ${p.name}が直近で${recentHR}本塁打の量産体制`, color: 'text-pink-400' });
          }
        }
      }

      if (p.abilities?.pitching?.velocity >= 150) {
        topics.push({ cat: 'pitch_velo', icon: '🚀', text: `${abbr} ${p.name}の剛速球${p.abilities.pitching.velocity}km/hにスタンドがどよめく`, color: 'text-red-300' });
      }
      if (p.abilities?.pitching?.velocity >= 140 && p.abilities?.pitching?.velocity < 150 && p.age <= 22) {
        topics.push({ cat: 'pitch_velo_young', icon: '⚡', text: `${abbr} ${p.name}(${p.age}歳)が最速${p.abilities.pitching.velocity}km/h、将来が楽しみ`, color: 'text-cyan-300' });
      }

      if (p.abilities?.fielding?.defense >= 85 && p.position !== 'pitcher') {
        const posNames = { catcher: '捕手', first: '一塁手', second: '二塁手', third: '三塁手', short: '遊撃手', left: '左翼手', center: '中堅手', right: '右翼手' };
        const posName = posNames[p.position] || p.position;
        topics.push({ cat: 'defense_scout', icon: '🧤', text: `${abbr} ${p.name}の${posName}守備にスカウトも高評価`, color: 'text-emerald-300' });
      }

      if (ps && (ps.games || 0) >= 25) {
        topics.push({ cat: 'pitch_ironman', icon: '💪', text: `${abbr} ${p.name}が${ps.games}試合登板、フル回転の活躍`, color: 'text-orange-300' });
      }

      const walks = bs?.walks || 0;
      if (walks > 0 && (walks === 20 || walks === 30 || walks === 40 || walks === 50)) {
        topics.push({ cat: 'bat_bb', icon: '👀', text: `${abbr} ${p.name}が${walks}四球到達、優れた選球眼`, color: 'text-teal-300', team: p.teamName });
      }

      if ((bs?.stolenBases || 0) >= 8 && bs?.atBats >= 30 && bs.hits / bs.atBats >= 0.300) {
        topics.push({ cat: 'bat_allround', icon: '🌟', text: `${abbr} ${p.name}が打率${(bs.hits / bs.atBats).toFixed(3)}・${bs.stolenBases}盗塁の万能ぶり`, color: 'text-yellow-300' });
      }

      // inningsPitched はアウト数（3アウト=1イニング）。20イニング = 60アウト
      if (ps && (ps.inningsPitched || 0) >= 60 && (ps.earnedRuns || 0) === 0) {
        topics.push({ cat: 'pitch_scoreless', icon: '✨', text: `${abbr} ${p.name}が${formatInnings(ps.inningsPitched)}無失点の快投`, color: 'text-amber-300' });
      }
    });

    // 順位争い追加トピック
    if (_standings.length >= 3) {
      const last = _standings[_standings.length - 1];
      const secondLast = _standings[_standings.length - 2];
      const lastGb = ((secondLast.wins - last.wins) - (secondLast.losses - last.losses)) / 2;
      if (lastGb <= 1.0 && lastGb >= 0 && (last.gamesPlayed || 0) >= 10) {
        topics.push({ cat: 'standings', icon: '🏳️', text: `${getTeamAbbreviation(last.team)}と${getTeamAbbreviation(secondLast.team)}が最下位争い`, color: 'text-gray-300' });
      }
      if (_standings.length >= 4) {
        const third = _standings[2];
        const fourth = _standings[3];
        const csGb = ((third.wins - fourth.wins) - (third.losses - fourth.losses)) / 2;
        if (csGb <= 1.5 && csGb >= 0 && (third.gamesPlayed || 0) >= 10) {
          topics.push({ cat: 'standings', icon: '🏁', text: `${getTeamAbbreviation(third.team)}と${getTeamAbbreviation(fourth.team)}がAクラス争い`, color: 'text-yellow-300' });
        }
      }
      if (_standings.length >= 2) {
        const first = _standings[0];
        const second = _standings[1];
        const topGb = ((first.wins - second.wins) - (first.losses - second.losses)) / 2;
        if (topGb >= 5 && (first.gamesPlayed || 0) >= 15) {
          topics.push({ cat: 'standings', icon: '🏇', text: `${getTeamAbbreviation(first.team)}が${topGb}ゲーム差で首位独走`, color: 'text-yellow-400' });
        }
      }
    }

    // チーム勝率トピック
    _standings.forEach(s => {
      const abbr = getTeamAbbreviation(s.team);
      if ((s.gamesPlayed || 0) >= 20 && (s.winRate || 0) >= 0.700) {
        topics.push({ cat: 'team_wr', icon: '🏆', text: `${abbr}が勝率${s.winRate.toFixed(3)}の驚異的ペース`, color: 'text-yellow-400' });
      }
      if ((s.gamesPlayed || 0) >= 20 && (s.winRate || 0) <= 0.300) {
        topics.push({ cat: 'team_wr', icon: '⛈️', text: `${abbr}が勝率${s.winRate.toFixed(3)}と苦しいシーズン`, color: 'text-gray-300' });
      }
    });

    // 重複排除 + 同一カテゴリ最大2件に制限
    const seen = new Set();
    const catCount = {};
    const catTeamSeen = {};
    const milestoneCats = new Set(['pitch_wins', 'pitch_save', 'bat_hr', 'bat_hits', 'bat_2b', 'pitch_k', 'bat_rbi', 'bat_sb', 'bat_bb']);
    const unique = topics.filter(t => {
      if (seen.has(t.text)) return false;
      seen.add(t.text);
      if (t.cat) {
        catCount[t.cat] = (catCount[t.cat] || 0) + 1;
        if (catCount[t.cat] > 2) return false;
        if (milestoneCats.has(t.cat) && t.team) {
          const teamKey = `${t.cat}_${t.team}`;
          if (catTeamSeen[teamKey]) return false;
          catTeamSeen[teamKey] = true;
        }
      }
      return true;
    });
    // シード値で安定シャッフル（結果数ベースでゲーム日ごとに変わる）
    const seed = (seasonData.results?.length || 0) * 31 + 7;
    const shuffled = unique.sort((a, b) => {
      const ha = (a.text.length * 17 + seed) % 97;
      const hb = (b.text.length * 17 + seed) % 97;
      return ha - hb;
    }).slice(0, 12);

    return shuffled;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonData.results?.length, seasonData.standings, seasonData.currentDate?.month, seasonData.currentDate?.day]);

  // 自チーム専用レポート（監督・コーチ視点の状況報告）
  const teamReport = useMemo(() => {
    const reports = [];
    const userTeam = TEAMS_DATA[userTeamName];
    if (!userTeam?.players) return reports;
    const players = userTeam.players;
    const results = seasonData.results || [];
    const teamGames = results.filter(g => g.result && !g.result.cancelled && (g.home === userTeamName || g.away === userTeamName));
    if (teamGames.length < 3) return reports;

    // --- 直近5試合の傾向分析 ---
    const recent = teamGames.slice(-5);
    let rWins = 0, rLosses = 0, rScored = 0, rAllowed = 0;
    recent.forEach(g => {
      const isHome = g.home === userTeamName;
      const won = isHome ? g.result.homeScore > g.result.awayScore : g.result.awayScore > g.result.homeScore;
      const lost = isHome ? g.result.homeScore < g.result.awayScore : g.result.awayScore < g.result.homeScore;
      if (won) rWins++; else if (lost) rLosses++;
      rScored += isHome ? g.result.homeScore : g.result.awayScore;
      rAllowed += isHome ? g.result.awayScore : g.result.homeScore;
    });
    const avgScored = (rScored / recent.length).toFixed(1);
    const avgAllowed = (rAllowed / recent.length).toFixed(1);

    if (rWins >= 4) {
      reports.push({ icon: '🔥', text: `直近${recent.length}試合で${rWins}勝と絶好調。この勢いを維持したい。`, color: 'text-green-400' });
    } else if (rLosses >= 4) {
      reports.push({ icon: '⚠️', text: `直近${recent.length}試合で${rLosses}敗。何か手を打たないと順位が下がる一方だ。`, color: 'text-red-400' });
    } else if (rWins >= 3) {
      reports.push({ icon: '📈', text: `直近${recent.length}試合は${rWins}勝${rLosses}敗と上り調子。チームに勢いが出てきた。`, color: 'text-green-300' });
    } else if (rLosses >= 3) {
      reports.push({ icon: '📉', text: `直近${recent.length}試合は${rWins}勝${rLosses}敗。立て直しが急務だ。`, color: 'text-orange-400' });
    }

    if (parseFloat(avgScored) < 2.5 && teamGames.length >= 5) {
      reports.push({ icon: '🦗', text: `直近の平均得点${avgScored}。打線が湿りがちだ。打順の入れ替えも検討したい。`, color: 'text-orange-300' });
    }
    if (parseFloat(avgAllowed) >= 6 && teamGames.length >= 5) {
      reports.push({ icon: '🚒', text: `直近の平均失点${avgAllowed}。投手陣が打ち込まれている。起用法を見直す必要がある。`, color: 'text-red-300' });
    }

    // --- 好調・不調の野手 ---
    const fieldPlayers = players.filter(p => p.position !== 'pitcher');
    fieldPlayers.forEach(p => {
      const bs = p.seasonStats?.batting;
      if (!bs || bs.atBats < 15) return;
      const recentGameData = results.slice(-8);
      let rh = 0, rab = 0, rhr = 0;
      recentGameData.forEach(g => {
        if (!g.result || g.result.cancelled) return;
        const isHome = g.home === userTeamName;
        if (g.home !== userTeamName && g.away !== userTeamName) return;
        const lineup = isHome ? g.result.homeLineup : g.result.awayLineup;
        const ps = lineup?.find(l => l.name === p.name);
        if (ps) { rh += ps.hits || 0; rab += ps.atBats || 0; rhr += ps.homeruns || 0; }
      });
      if (rab >= 8) {
        const avg = rh / rab;
        if (avg >= 0.400) {
          reports.push({ icon: '🔥', text: `${p.name}が直近${rab}打数${rh}安打と打ちまくっている。クリーンナップでの起用が効果的だ。`, color: 'text-red-400' });
        } else if (avg <= 0.100 && rab >= 12) {
          reports.push({ icon: '❄️', text: `${p.name}が直近${rab}打数${rh}安打と深刻な不振。打順を下げるか、思い切って休ませることも必要かもしれない。`, color: 'text-blue-300' });
        }
        if (rhr >= 3) {
          reports.push({ icon: '💣', text: `${p.name}が直近で${rhr}本塁打と量産中。長打力が頼りになる。`, color: 'text-pink-400' });
        }
      }
    });

    // --- 投手陣の状況 ---
    const pitchers = players.filter(p => p.position === 'pitcher');
    pitchers.forEach(p => {
      const ps = p.seasonStats?.pitching;
      if (!ps || (ps.inningsPitched || 0) < 18) return; // 6イニング以上
      const era = ((ps.earnedRuns || 0) * 27) / ps.inningsPitched;
      if (era <= 2.00) {
        reports.push({ icon: '🎯', text: `${p.name}が防御率${era.toFixed(2)}と安定。エース格の働きをしている。`, color: 'text-emerald-400' });
      } else if (era >= 5.50 && ps.games >= 3) {
        reports.push({ icon: '😓', text: `${p.name}が防御率${era.toFixed(2)}と苦しんでいる。配置転換や登板間隔の調整を考えたい。`, color: 'text-red-300' });
      }
    });

    // --- 順位状況 ---
    const standings = seasonData.standings || [];
    const userIdx = standings.findIndex(s => s.team === userTeamName);
    if (userIdx >= 0 && standings[userIdx].gamesPlayed >= 5) {
      const rank = userIdx + 1;
      const total = standings.length;
      const us = standings[userIdx];
      if (rank === 1) {
        const second = standings[1];
        if (second) {
          const gb = ((us.wins - second.wins) - (us.losses - second.losses)) / 2;
          if (gb >= 3) {
            reports.push({ icon: '👑', text: `現在首位。2位に${gb}ゲーム差をつけている。この調子で突き放したい。`, color: 'text-yellow-400' });
          } else {
            reports.push({ icon: '⚡', text: `首位だが2位${getTeamAbbreviation(second.team)}とは${gb}ゲーム差。油断は禁物だ。`, color: 'text-yellow-300' });
          }
        }
      } else if (rank === total) {
        const above = standings[userIdx - 1];
        const gb = ((above.wins - us.wins) - (above.losses - us.losses)) / 2;
        reports.push({ icon: '🏳️', text: `現在最下位。${rank - 1}位${getTeamAbbreviation(above.team)}まで${gb}ゲーム差。巻き返しを図りたい。`, color: 'text-gray-300' });
      } else {
        const above = standings[userIdx - 1];
        const gb = ((above.wins - us.wins) - (above.losses - us.losses)) / 2;
        reports.push({ icon: '📊', text: `現在${rank}位。${rank - 1}位${getTeamAbbreviation(above.team)}まで${gb}ゲーム差。`, color: 'text-blue-300' });
      }
    }

    // --- チーム打撃成績の傾向 ---
    let totalHR = 0, totalSB = 0;
    fieldPlayers.forEach(p => {
      totalHR += p.seasonStats?.batting?.homeruns || 0;
      totalSB += p.seasonStats?.batting?.stolenBases || 0;
    });
    if (teamGames.length >= 10 && totalHR < teamGames.length * 0.3) {
      reports.push({ icon: '💤', text: `チーム本塁打が${totalHR}本と少ない。長打不足が課題だ。`, color: 'text-gray-300' });
    }
    if (teamGames.length >= 10 && totalSB >= teamGames.length * 1.2) {
      reports.push({ icon: '💨', text: `チーム盗塁${totalSB}個と機動力が武器になっている。足を活かした攻撃を続けたい。`, color: 'text-green-300' });
    }

    // --- 疲労蓄積の警告（疲労50超で出場すると成長率が下がる） ---
    const fatigueWarnings = [];
    players.forEach(p => {
      const fatigue = p.fatigue || 0;
      if (fatigue >= 80) {
        fatigueWarnings.push({ name: p.name, fatigue, level: 'critical' });
      } else if (fatigue >= 60) {
        fatigueWarnings.push({ name: p.name, fatigue, level: 'danger' });
      } else if (fatigue >= 45) {
        fatigueWarnings.push({ name: p.name, fatigue, level: 'warning' });
      }
    });
    fatigueWarnings.sort((a, b) => b.fatigue - a.fatigue);

    if (fatigueWarnings.some(w => w.level === 'critical')) {
      const names = fatigueWarnings.filter(w => w.level === 'critical').map(w => w.name).join('、');
      reports.push({ icon: '🚨', text: `${names}の疲労が限界を超えている。出場させると成長率が大幅に低下する。`, color: 'text-red-500' });
    }
    if (fatigueWarnings.some(w => w.level === 'danger')) {
      const names = fatigueWarnings.filter(w => w.level === 'danger').map(w => w.name).join('、');
      reports.push({ icon: '⚠️', text: `${names}の疲労が蓄積している。出場ごとに成長率が低下している。`, color: 'text-orange-400' });
    }
    if (fatigueWarnings.some(w => w.level === 'warning')) {
      const names = fatigueWarnings.filter(w => w.level === 'warning').map(w => w.name).join('、');
      reports.push({ icon: '💤', text: `${names}の疲労が蓄積しつつある。もうすぐ成長率低下ラインに達する。`, color: 'text-yellow-400' });
    }

    return reports;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonData.results?.length, seasonData.standings, seasonData.currentDate?.month, seasonData.currentDate?.day]);

  // チーム状況レポート＋スカウト通知＋リーグトピックを統合し、重要度順に上位6件を返す。
  // 自チームに関わる/行動を促す情報を高く、話題性のみの情報を低く重み付けする。
  const NEWS_LIMIT = 6;
  const newsFeed = useMemo(() => {
    const items = [];
    // 自チームレポート（監督視点・行動可能）— アイコンで重要度を判定
    const REPORT_PRI = {
      '🚨': 96, '⚠️': 82, '🚒': 74, '📉': 73, '😓': 72, '🦗': 71, '❄️': 70,
      '👑': 68, '⚡': 66, '🏳️': 64, '🎯': 62, '🔥': 61, '📊': 60, '💣': 58,
      '📈': 56, '💨': 52, '💤': 50, '💧': 48,
    };
    teamReport.forEach(r => items.push({ ...r, src: 'report', pri: REPORT_PRI[r.icon] ?? 60 }));
    // スカウト帰還・調査完了（自チーム関連）
    scoutReportNotifications.slice(0, 3).forEach(m => items.push({
      src: 'scout', pri: 63, icon: '🔍', color: 'text-cyan-300',
      text: m.type === 'investigation'
        ? `${m.targetPlayerName}の${(m._revealedAbilities || []).join('・') || '能力'}を調査完了（${m.staffName}）`
        : `${m.staffName}が${SCOUT_TARGETS[m.target]?.label || m.target}から帰還 — ${m.results?.length || 0}名の候補選手を発見`,
    }));
    // リーグの話題（自チーム順位が最優先、次いでマイルストーン、試合トピック）
    const TOPIC_PRI = {
      standings: 59, bat_hr: 42, pitch_wins: 42, pitch_k: 40, young: 40, bat_avg: 38,
      game_walkoff: 34, team_wr: 32, game_shutout: 32, game_blowout: 30,
    };
    cachedTopics.forEach(t => items.push({ ...t, src: 'topic', pri: TOPIC_PRI[t.cat] ?? 30 }));
    // 重要度降順（同点は report > scout > topic の順で自チーム寄りを優先）
    const srcRank = { report: 0, scout: 1, topic: 2 };
    items.sort((a, b) => (b.pri - a.pri) || (srcRank[a.src] - srcRank[b.src]));
    return items.slice(0, NEWS_LIMIT);
  }, [teamReport, scoutReportNotifications, cachedTopics]);

  // スポーツ新聞モーダル用のデータ生成
  // 紙面のデータ作りと描画は dateProgress/Newspaper.jsx へ抽出した（合計409行）
  const newspaperData = useMemo(
    () => (showNewspaper ? buildNewspaperData(seasonData, userTeamName, newspaperFameDateRef) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showNewspaper, seasonData.results?.length, seasonData.currentDate?.day]);

  const getEventColor = (label) => {
    if (label === 'シーズン終了') return 'text-red-400';
    if (label === 'プレーオフ' || label === 'グランドCS') return 'text-yellow-400';
    if (label === '契約更改') return 'text-teal-400';
    if (label === '退団') return 'text-red-400';
    if (label === 'トライアウト') return 'text-orange-400';
    if (label === 'スカウト入団') return 'text-cyan-400';
    if (label === 'セレクション') return 'text-pink-400';
    if (label === 'オフシーズン') return 'text-gray-300';
    if (label === 'キャンプ') return 'text-green-400';
    if (label === 'ドラフト') return 'text-purple-400';
    return 'text-gray-400';
  };

  // ユーザーチームの成績取得
  if (isGeneratingTournament) {
    return (
      <div className="p-3 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">⚾</div>
          <div className="text-white text-xl font-bold mb-2">都市対抗予選を開催中...</div>
          <div className="text-gray-300 text-sm">全12地区の予選トーナメントをシミュレーション中</div>
          <div className="mt-4 w-48 h-1 bg-gray-700 rounded-full mx-auto overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{width: '70%'}}></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ScreenShell>
      <TutorialHint id="dateprogress-intro" title="シーズンの進め方">
        ここが基本画面です。カレンダー右上の<b className="text-cyan-200">「1日進める」</b>で1日進み、試合が自動で消化されて順位表・成績が更新されます。<b className="text-cyan-200">「次の試合まで」</b>を押すと、自分の試合の直前まで1日ずつまとめて進みます。自分の試合は采配してプレイすることもできます。サイドバーからロスター管理・注目選手などへ移動できます。
      </TutorialHint>

      {/* ⚠ **画面の先頭にあった進行バーは撤去した**（日付＋本日の予定＋次の自チーム戦＋
          「▶ 1日進める」を1本に畳んだ帯）。日程進行が縦に長かったので、
          **持っていた4つの情報がどれも他の場所と重複していた**ことを理由に外してある:
          日付 → カレンダーの見出しへ統合 / 本日の予定 → 下の「本日の試合」欄 /
          次の自チーム戦 → カレンダーの色分け（自チーム戦=青・自トーナメント=黄）/
          1日進める → サイドバーの「日程進行」の再クリック（`onActiveClick`）。
          ⚠ このうち**「1日進める」だけは置き場所を戻した**。サイドバーの再クリックは
          押せると分かる手がかりが無く、「一番よく押す操作に押す場所が無い」状態だったため。
          帯は復活させず、**カレンダーの見出し行**（月送りの ◀▶ の隣）に置いてある
          ＝縦は1pxも増えない。この帯は実測66px使っていた。
          再クリックの経路も残してある（覚えた人の手を止めないため）。 */}
      {/* ⚠ **「昨日の結果」パネルはここにあったが、日程進行が縦に長くなりすぎたため撤去した**。
          押した手応えを返すのが役目だったので、消したことで
          「押しても何が起きたか画面に返らない」が部分的に戻っている。
          復活させるなら**縦を増やさない置き方**（折りたたみ、または「本日の試合」欄の中）にすること。
          ⚠ 置き場所として挙げていた進行バーも、その後撤去した（すぐ上の注記）。
          データを作る useMemo も併せて撤去済み（描画されない state を残さないため）。 */}
      {/* 2カラムレイアウト: 左にカレンダー+本日の試合、右に順位表 */}
      <div className="flex gap-3">
        {/* 左カラム: カレンダー＋本日の試合 */}
        <div className="w-[800px] shrink-0">
          <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl p-3 shadow-xl border border-gray-700/30 mb-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-600/30 flex items-center justify-center">
                  <span className="text-blue-400 text-sm">📅</span>
                </div>
                {/* 撤去した進行バーの日付をここへ統合してある。
                    ⚠ **「4月」と日付を並べて出さないこと**。今月を見ている間ずっと
                    同じ月が2回出る（実際にそうなっていた）。見出しは1つだけ持ち、
                    今月なら日付・他の月なら月、と中身を入れ替える。
                    ⚠ 枠も地色も持たせない。見出しの中の見出しになって、
                    隣の月間戦績と格が揃わなかった */}
                {selectedMonth === seasonData.currentDate.month ? (
                  <span className="tabular-nums whitespace-nowrap">
                    <span className="text-gray-300 font-normal text-sm mr-1">{seasonData.currentDate.year}年</span>
                    <span className="text-white">{seasonData.currentDate.month}月{seasonData.currentDate.day}日</span>
                    <span className={`ml-0.5 text-sm ${todayDow === 0 ? 'text-red-400' : todayDow === 6 ? 'text-blue-400' : 'text-gray-300'}`}>
                      ({dayNames[todayDow]})
                    </span>
                  </span>
                ) : (
                  <span className="tabular-nums whitespace-nowrap">
                    <span className="text-gray-300 font-normal text-sm mr-1">{seasonData.currentDate.year}年</span>
                    <span className="text-white">{selectedMonth}月</span>
                  </span>
                )}
                {monthlyStats && (
                  <span className="text-sm font-bold ml-1">
                    <span className="text-green-400">{monthlyStats.wins}勝</span>
                    <span className="text-red-400 ml-1">{monthlyStats.losses}敗</span>
                    {monthlyStats.draws > 0 && <span className="text-gray-300 ml-1">{monthlyStats.draws}分</span>}
                    <span className="text-gray-300 ml-1.5 font-normal text-xs">
                      ({monthlyStats.winRate})
                    </span>
                  </span>
                )}
              </h2>
              {/* 日送りの置き場所。⚠ **この行に置くこと＝縦を増やさない**。
                  月送りの ◀▶ が w-10 h-10 で既に行の高さを決めているので、
                  同じ高さのボタンを横に足しても帯は1pxも伸びない。
                  （以前ここに専用の進行バーを置いて、縦に長すぎるので撤去した。
                  そのとき日送りはサイドバーの再クリックだけになり、
                  「一番よく押す操作に押す場所が無い」状態に戻っていた。）
                  ⚠ 月送り（見る月を変える）と日送り（世界を進める）は別の仕事なので、
                  区切り線で分けて、▶ の字も日送り側には持たせない
                  （同じ行に ▶ が2つ並ぶと、どちらが日を進めるのか読めなかった）。 */}
              <div className="flex items-center gap-1">
                <button onClick={() => setSelectedMonth(m => m > 1 ? m - 1 : 12)} title="前の月を見る" className="bg-gray-700/60 hover:bg-gray-600 text-gray-300 hover:text-white w-10 h-10 rounded-xl flex items-center justify-center text-base transition-all active:scale-90 border border-gray-600/30 hover:border-gray-500">◀</button>
                <button onClick={() => setSelectedMonth(m => m < 12 ? m + 1 : 1)} title="次の月を見る" className="bg-gray-700/60 hover:bg-gray-600 text-gray-300 hover:text-white w-10 h-10 rounded-xl flex items-center justify-center text-base transition-all active:scale-90 border border-gray-600/30 hover:border-gray-500">▶</button>
                <div className="w-px h-6 bg-gray-600/50 mx-1.5" aria-hidden="true" />
                <button
                  onClick={startAutoAdvance}
                  disabled={isSimulating || autoAdvanceLeft > 0 || daysToNextGame < 1}
                  title={daysToNextGame === 0 ? '今日が試合の日です（「1日進める」で試合へ）'
                    : daysToNextGame < 0 ? '次の試合が予定されていません'
                    : `${daysToNextGame}日進めて、次の試合の前で止まります`}
                  className="btn-secondary h-10 px-3 rounded-xl text-sm whitespace-nowrap transition-all active:scale-95"
                >
                  次の試合まで{daysToNextGame > 1 && <span className="ml-1 text-xs opacity-70 tabular-nums">{daysToNextGame}日</span>}
                </button>
                <button
                  onClick={() => handleProgressDate(1)}
                  disabled={isSimulating || autoAdvanceLeft > 0}
                  title="1日進める"
                  className="btn-primary h-10 px-4 rounded-xl text-sm whitespace-nowrap transition-all active:scale-95"
                >
                  {/* 残りは「試合日まで」で数える（`autoAdvanceLeft` は試合日に呼ぶ1回分を含む） */}
                  {autoAdvanceLeft > 1 ? `進行中… 残り${autoAdvanceLeft - 1}日` : autoAdvanceLeft === 1 ? '進行中…' : '1日進める'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {dayNames.map((name, i) => (
                <div key={i} className={`text-center text-xs font-bold py-1.5 rounded-md ${i === 0 ? 'text-red-400 bg-red-900/15' : i === 6 ? 'text-blue-400 bg-blue-900/15' : 'text-gray-300 bg-gray-800/50'}`}>{name}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {calendarCells.map((cell, i) => {
                const showAsScheduled = cell.isToday;
                const colIdx = i % 7;
                const hasUserGame = cell.games?.some(g => g.home === userTeamName || g.away === userTeamName);
                const hasTournament = cell.tournamentEvents?.length > 0;
                const hasUserTournament = cell.tournamentEvents?.some(t => t.isUserMatch);
                return (
                  <div key={i} className={`min-h-[62px] p-1 rounded-lg text-sm transition-all ${
                    cell.day === null ? 'bg-transparent' :
                    // ⚠ 「今日」は緑のベタ塗り＋グロー＋リングで、画面で一番強い要素だった。
                    //    現在地は「次に押すもの」ではないので、サイドバー・タブと同じ
                    //    アクセント（＝ここに居る）の語彙に揃える。
                    //    ⚠ **この画面でアクセントを持つ「箱」はここだけ**にすること
                    //    （見出しの日付にも同じ枠を付けたら、強い箱が2つになった）
                    //    ⚠ 見出し行の「1日進める」は `.btn-primary`（塗り）でアクセントを持つが、
                    //    これは別の役目（＝次に押すもの）で、この枠は輪郭だけの現在地なので
                    //    競合しない。実機で並べて確認済み。増やすならここまで
                    cell.isToday ? 'bg-[var(--accent-soft)] border border-[var(--accent)]' :
                    hasUserTournament ? 'bg-yellow-900/30 border border-yellow-500/30 hover:border-yellow-400/40' :
                    hasUserGame && !cell.games.some(g => g.result) ? 'bg-blue-900/30 border border-blue-500/20 hover:border-blue-400/40' :
                    hasUserGame && cell.games.some(g => g.result) ? 'bg-gray-700/60 border border-gray-600/20' :
                    hasTournament ? 'bg-orange-900/20 border border-orange-700/20' :
                    colIdx === 0 ? 'bg-gray-800/60 hover:bg-gray-700/60' :
                    colIdx === 6 ? 'bg-gray-800/60 hover:bg-gray-700/60' :
                    'bg-gray-800/40 hover:bg-gray-700/50'
                  }`}>
                    {cell.day && (
                      <>
                        <div className={`font-bold mb-0.5 text-xs leading-none ${cell.isToday ? 'text-accent' : colIdx === 0 ? 'text-red-400' : colIdx === 6 ? 'text-blue-400' : 'text-gray-200'}`}>{cell.day}</div>
                        {hasTournament && (
                          <div className="mb-0.5">
                            {(() => {
                              const getTournamentName = (type) => {
                                if (type?.startsWith('nihon_senshuken')) return '日本選手権';
                                if (type?.startsWith('club_senshuken')) return 'クラブ選手権';
                                if (type === 'regional_tournament') return '地域大会';
                                if (type === 'university_championship') return '大学選手権';
                                if (type === 'meiji_jingu') return '明治神宮';
                                return '都市対抗';
                              };
                              const isMainType = (type) => type === 'main' || type === 'nihon_senshuken' || type === 'club_senshuken' || type === 'university_championship' || type === 'meiji_jingu';
                              const userRegionEvents = cell.tournamentEvents.filter(t => t.isUserRegion || isMainType(t.type));
                              if (userRegionEvents.length === 0) {
                                const hasAnyDone = cell.tournamentEvents.some(t => t.done);
                                const name = getTournamentName(cell.tournamentEvents[0]?.type);
                                return <div className={`text-xs font-bold leading-tight ${hasAnyDone ? 'text-gray-400' : 'text-orange-400'}`}>{name}</div>;
                              }
                              const deduped = [];
                              const seen = new Set();
                              for (const t of userRegionEvents) {
                                const lbl = isMainType(t.type) ? (t.label || '本戦') : t.label || '予選';
                                const key = `${getTournamentName(t.type)}_${lbl}_${t.isUserMatch}`;
                                if (seen.has(key)) continue;
                                seen.add(key);
                                deduped.push(t);
                              }
                              return deduped.map((t, ti) => {
                                const rawLabel = isMainType(t.type) ? (t.label || '本戦') : t.label || '予選';
                                const tournamentCount = new Set(userRegionEvents.map(e => getTournamentName(e.type))).size;
                                const label = tournamentCount > 1 ? `${getTournamentName(t.type)} ${rawLabel}` : rawLabel;
                                const color = t.isUserMatch ? 'text-yellow-400' : t.done ? 'text-gray-400' : 'text-orange-400';
                                return <div key={ti} className={`text-xs font-bold leading-tight ${color}`}>{label}{t.isUserMatch ? '⚾' : ''}</div>;
                              });
                            })()}
                          </div>
                        )}
                        {cell.eventLabel && cell.games.length > 0 && (
                          <div className={`text-xs font-bold leading-tight mb-0.5 ${getEventColor(cell.eventLabel)}`}>{cell.eventLabel}</div>
                        )}
                        {cell.games.length > 0 ? (
                          <div className="space-y-0">
                            {cell.games.map((game, gIdx) => {
                              const awayShort = getTeamAbbreviation(game.away);
                              const homeShort = getTeamAbbreviation(game.home);
                              const isUserInGame = game.home === userTeamName || game.away === userTeamName;
                              const leagueColor = !isTwoLeague ? '' :
                                (league1Teams.includes(game.home) && league1Teams.includes(game.away)) ? 'border-l border-blue-500/50 pl-0.5' :
                                (league2Teams.includes(game.home) && league2Teams.includes(game.away)) ? 'border-l border-orange-500/50 pl-0.5' :
                                'border-l border-green-500/50 pl-0.5';
                              if (showAsScheduled || !game.result) {
                                return <div key={gIdx} className={`text-xs leading-tight text-center font-medium whitespace-nowrap overflow-hidden ${isUserInGame ? 'text-yellow-300' : 'text-white'} ${leagueColor}`}>{awayShort}-{homeShort}</div>;
                              }
                              if (game.result?.cancelled) return null;
                              const awayWin = game.result.awayScore > game.result.homeScore;
                              const homeWin = game.result.homeScore > game.result.awayScore;
                              // ユーザーチームの勝敗を視覚的に
                              let userWon = null;
                              if (isUserInGame) {
                                if (game.home === userTeamName) userWon = homeWin;
                                else userWon = awayWin;
                              }
                              // プレーオフの通算成績を計算
                              let seriesInfo = null;
                              if (game.seriesId && game.phase === SEASON_PHASES.PLAYOFFS) {
                                const seriesGames = (seasonData.schedule || []).filter(g => g.seriesId === game.seriesId && g.result && !g.result?.cancelled);
                                const upToThis = seriesGames.filter(g => g.seriesGame <= game.seriesGame);
                                const homeTeamInSeries = (seasonData.schedule || []).find(g => g.seriesId === game.seriesId && g.seriesGame === 1)?.home || game.home;
                                let homeWins = 0, awayWins = 0;
                                upToThis.forEach(g => {
                                  const hWon = g.result.homeScore > g.result.awayScore;
                                  const isSeriesHome = g.home === homeTeamInSeries;
                                  if ((hWon && isSeriesHome) || (!hWon && !isSeriesHome)) homeWins++;
                                  else awayWins++;
                                });
                                seriesInfo = `${homeWins}-${awayWins}`;
                              }
                              return (
                                <div key={gIdx} className={`leading-tight text-center ${leagueColor}`}>
                                  <div className="text-xs whitespace-nowrap overflow-hidden">
                                    <span className={awayWin ? 'text-green-400 font-bold' : 'text-gray-300'}>{awayShort}</span>
                                    <span className="text-white mx-px font-mono text-xs">{game.result.awayScore}-{game.result.homeScore}</span>
                                    <span className={homeWin ? 'text-green-400 font-bold' : 'text-gray-300'}>{homeShort}</span>
                                  </div>
                                  {isUserInGame && userWon !== null && (
                                    <div className={`text-xs font-bold ${userWon ? 'text-green-400' : 'text-red-400'}`}>{userWon ? '○' : '●'}</div>
                                  )}
                                  {seriesInfo && <div className="text-xs text-yellow-400 font-mono">{seriesInfo}</div>}
                                </div>
                              );
                            })}
                          </div>
                        ) : cell.eventLabel ? (
                          <div className={`text-xs font-bold leading-tight mt-0.5 ${getEventColor(cell.eventLabel)}`}>{cell.eventLabel}</div>
                        ) : (
                          <div className="text-xs text-gray-400">-</div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 本日の対戦 */}
          <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl p-2 shadow-xl border border-gray-700/30">
            <h2 className="text-sm font-bold text-white mb-1.5 flex items-center gap-1.5">
              <span className="text-orange-400 text-sm">⚾</span>
              <span>{formatDate(seasonData.currentDate)} の対戦</span>
              <span className="text-xs font-normal text-gray-400 ml-1">{todaysGames.length + todaysTournamentMatches.length}試合</span>
            </h2>
            <div>
            {/* トーナメント試合カード */}
            {todaysTournamentMatches.map((tm, idx) => {
              const userStarter = getStartingPitcher(userTeamName);
              const oppStarter = getStartingPitcher(tm.opponent);
              const colorMap = {
                green: { bg: 'from-green-900/40 to-green-800/20', border: 'border-green-500/40', shadow: 'shadow-green-900/20', text: 'text-green-400' },
                red: { bg: 'from-red-900/40 to-red-800/20', border: 'border-red-500/40', shadow: 'shadow-red-900/20', text: 'text-red-400' },
                purple: { bg: 'from-purple-900/40 to-purple-800/20', border: 'border-purple-500/40', shadow: 'shadow-purple-900/20', text: 'text-purple-400' },
                yellow: { bg: 'from-yellow-900/40 to-yellow-800/20', border: 'border-yellow-500/40', shadow: 'shadow-yellow-900/20', text: 'text-yellow-400' },
              };
              const c = colorMap[tm.color] || colorMap.yellow;
              return (
              <div key={`tm-${idx}`}
                onClick={() => setShowTournamentMatchModal({ opponent: tm.opponent, oppDef: tm.oppDef, roundIdx: tm.roundIdx, matchIdx: tm.matchIdx, bracketType: tm.bracketType, regionId: tm.regionId })}
                className={`mb-1.5 rounded-lg p-2.5 border shadow-md cursor-pointer hover:brightness-125 transition bg-gradient-to-r ${c.bg} ${c.border} ${c.shadow}`}>
                <div className={`text-xs font-bold mb-1 ${c.text}`}>
                  🏆 {tm.label}
                </div>
                <div className="flex items-center justify-center gap-4">
                  <div className="text-center">
                    <div className="text-white font-bold text-sm">{userTeamName}</div>
                    {userStarter && <div className="text-xs text-gray-300">先発: {userStarter.name}</div>}
                  </div>
                  <span className="text-gray-400 text-xs font-bold">VS</span>
                  <div className="text-center">
                    <div className="text-white font-bold text-sm">{tm.opponent}</div>
                    {oppStarter && <div className="text-xs text-gray-300">先発: {oppStarter.name}</div>}
                  </div>
                </div>
              </div>
              );
            })}
            {todaysGames.length === 0 && todaysTournamentMatches.length === 0 ? (
              <div className="text-center py-3 bg-gray-800/50 rounded-xl h-full flex flex-col items-center justify-center">
                <div className="text-gray-400 text-xl mb-1">⚾</div>
                <span className="text-gray-400 text-xs">本日は試合がありません（休養日）</span>
              </div>
            ) : todaysGames.length > 0 ? (
              <div>
                {(() => {
                  const renderGameCards = (games) => (
                    <div className="grid grid-cols-2 gap-1">
                      {games.map(game => {
                  const awayPitcher = getStartingPitcher(game.away);
                  const homePitcher = getStartingPitcher(game.home);
                  const hasResult = !!game.result;
                  const isUserGame = game.home === userTeamName || game.away === userTeamName;
                  let todaySeriesInfo = null;
                  if (game.seriesId && game.phase === SEASON_PHASES.PLAYOFFS) {
                    const seriesAll = (seasonData.schedule || []).filter(g => g.seriesId === game.seriesId && !g.result?.cancelled);
                    const played = seriesAll.filter(g => g.result);
                    const homeTeamInSeries = seriesAll.find(g => g.seriesGame === 1)?.home || game.home;
                    let hWins = 0, aWins = 0;
                    played.forEach(g => {
                      const hWon = g.result.homeScore > g.result.awayScore;
                      const isSeriesHome = g.home === homeTeamInSeries;
                      if ((hWon && isSeriesHome) || (!hWon && !isSeriesHome)) hWins++;
                      else aWins++;
                    });
                    const roundLabel = game.playoffRound === 'semi' ? '準決勝' : '決勝';
                    todaySeriesInfo = `${roundLabel} 第${game.seriesGame}戦 (${hWins}-${aWins})`;
                  }
                  return (
                    <div key={game.id} className={`rounded-lg p-1.5 transition-all relative overflow-hidden ${
                      isUserGame && !hasResult ? 'bg-gradient-to-br from-blue-900/50 to-blue-800/30 border border-blue-500/30 shadow-md shadow-blue-900/20' :
                      hasResult ? 'bg-gray-800/60 border border-gray-700/20' :
                      'bg-gradient-to-br from-gray-800 to-gray-800 border border-gray-700/20'
                    }`}>
                      {isUserGame && !hasResult && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-400 via-blue-500 to-blue-400"></div>}
                      {todaySeriesInfo && (
                        <div className="text-center mb-1.5">
                          <span className="text-xs bg-yellow-600/30 text-yellow-300 font-bold px-2 py-0.5 rounded-full">{todaySeriesInfo}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <div className="text-center flex-1">
                          <div className={`font-bold text-sm ${game.away === userTeamName ? 'text-yellow-300' : 'text-white'}`}>{getTeamAbbreviation(game.away)}</div>
                          <div className="text-xs text-gray-300 truncate">{awayPitcher ? awayPitcher.name : '先発未定'}</div>
                          {awayPitcher && !hasResult && (() => {
                            const ps = awayPitcher.seasonStats?.pitching;
                            if (!ps || !ps.games) return null;
                            const era = (ps.inningsPitched || 0) > 0 ? ((ps.earnedRuns || 0) / ps.inningsPitched * 27).toFixed(2) : '-';
                            const parts = [`${ps.wins || 0}勝${ps.losses || 0}敗`];
                            if ((ps.saves || 0) > 0) parts.push(`${ps.saves}S`);
                            if ((ps.holds || 0) > 0) parts.push(`${ps.holds}H`);
                            parts.push(`防${era}`);
                            return <div className="text-xs text-gray-300">{parts.join(' ')}</div>;
                          })()}
                        </div>
                        {hasResult ? (
                          <div className="px-3 text-center">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-base font-black font-mono ${game.result.awayScore > game.result.homeScore ? 'text-green-400' : 'text-gray-300'}`}>{game.result.awayScore}</span>
                              <span className="text-gray-400 text-xs">-</span>
                              <span className={`text-base font-black font-mono ${game.result.homeScore > game.result.awayScore ? 'text-green-400' : 'text-gray-300'}`}>{game.result.homeScore}</span>
                            </div>
                            {/* 勝敗投手・セーブ表示 */}
                            {(() => {
                              const dec = game.result.decisions || determinePitcherDecisions(game.result);
                              const parts = [];
                              if (dec.winningPitcher) parts.push(<span key="w" className="text-green-400">○{dec.winningPitcher.name}</span>);
                              if (dec.losingPitcher) parts.push(<span key="l" className="text-red-400">●{dec.losingPitcher.name}</span>);
                              if (dec.savePitcher) parts.push(<span key="s" className="text-indigo-400">S{dec.savePitcher.name}</span>);
                              if (parts.length === 0) return <div className="text-xs text-gray-400 mt-0.5">試合終了</div>;
                              return <div className="text-xs mt-0.5 flex flex-wrap justify-center gap-x-1.5">{parts}</div>;
                            })()}
                            {/* 投手交代理由（ユーザーチームのみ） */}
                            {isUserGame && game.result.pitcherChanges?.length > 0 && (
                              <div className="mt-1 border-t border-gray-700/50 pt-1">
                                {game.result.pitcherChanges
                                  .filter(c => c.team === userTeamName)
                                  .slice(0, 3)
                                  .map((c, ci) => (
                                  <div key={ci} className="text-xs text-gray-300 leading-tight">
                                    <span className="text-yellow-400">{c.inning}回</span> {c.out}→<span className="text-cyan-300">{c.in}</span>
                                    <span className="text-gray-400 ml-0.5">({c.role})</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="px-3 text-center">
                            <div className="text-gray-400 text-xs font-bold tracking-wider">VS</div>
                          </div>
                        )}
                        <div className="text-center flex-1">
                          <div className={`font-bold text-sm ${game.home === userTeamName ? 'text-yellow-300' : 'text-white'}`}>{getTeamAbbreviation(game.home)}</div>
                          <div className="text-xs text-gray-300 truncate">{homePitcher ? homePitcher.name : '先発未定'}</div>
                          {homePitcher && !hasResult && (() => {
                            const ps = homePitcher.seasonStats?.pitching;
                            if (!ps || !ps.games) return null;
                            const era = (ps.inningsPitched || 0) > 0 ? ((ps.earnedRuns || 0) / ps.inningsPitched * 27).toFixed(2) : '-';
                            const parts = [`${ps.wins || 0}勝${ps.losses || 0}敗`];
                            if ((ps.saves || 0) > 0) parts.push(`${ps.saves}S`);
                            if ((ps.holds || 0) > 0) parts.push(`${ps.holds}H`);
                            parts.push(`防${era}`);
                            return <div className="text-xs text-gray-300">{parts.join(' ')}</div>;
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                      })}
                    </div>
                  );
                  if (isTwoLeague) {
                    const l1Games = todaysGames.filter(g => league1Teams.includes(g.home) && league1Teams.includes(g.away));
                    const l2Games = todaysGames.filter(g => league2Teams.includes(g.home) && league2Teams.includes(g.away));
                    const interGames = todaysGames.filter(g => !l1Games.includes(g) && !l2Games.includes(g));
                    return (
                      <div className="space-y-1.5">
                        {l1Games.length > 0 && renderGameCards(l1Games)}
                        {l2Games.length > 0 && renderGameCards(l2Games)}
                        {interGames.length > 0 && renderGameCards(interGames)}
                      </div>
                    );
                  }
                  return renderGameCards(todaysGames);
                })()}
              </div>
            ) : null}
            </div>
          </div>

          {/* 個人成績ランキング */}
          {(() => {
            const allPlayers = [];
            const seenIds = new Set();
            // standings（= 所属リーグの順位表）からチーム名セットを作成。
            // settings.teamNames は社会人/大学モードでは自チームのみのため standings を使う。
            const leagueTeamSet = new Set(standings.map(s => s.team));
            // spring/fall 両方あるときは springStandings も含める
            if (seasonData?.springStandings) {
              seasonData.springStandings.forEach(s => leagueTeamSet.add(s.team));
            }
            Object.entries(TEAMS_DATA || {}).forEach(([teamName, team]) => {
              if (!team?.players) return;
              if (leagueTeamSet.size > 0 && !leagueTeamSet.has(teamName)) return;
              if (isTwoLeague && rankingLeague === 'l1' && !league1Teams.includes(teamName)) return;
              if (isTwoLeague && rankingLeague === 'l2' && !league2Teams.includes(teamName)) return;
              team.players.forEach(p => {
                if (p.id != null && seenIds.has(p.id)) return;
                if (p.id != null) seenIds.add(p.id);
                allPlayers.push({ ...p, teamName });
              });
            });

            // 規定打席・規定投球回をシーズン進行度に比例して算出。
            // 式は seasonManager に一本化してある（タイトル判定と同じものを使うこと。
            // 別々に持っていた頃は「ランキング1位」と「◯◯王」が別人になっていた）
            const maxGamesPlayed = Math.max(...(standings.map(s => s.gamesPlayed || 0)), 1);
            const seasonProgress = Math.min(maxGamesPlayed / totalGames, 1);
            const qualifiedAB = qualifiedPA(totalGames, seasonProgress);
            const qualifiedOuts = qualifiedOutsFor(totalGames, seasonProgress);
            const qualifiedInnings = Math.floor(qualifiedOuts / 3);

            const battingQualified = allPlayers.filter(p => plateAppearances(p.seasonStats?.batting) >= qualifiedAB);
            const pitchingQualified = allPlayers.filter(p => (p.seasonStats?.pitching?.inningsPitched || 0) >= qualifiedOuts);

            const avgRanking = [...battingQualified]
              .map(p => ({ ...p, value: p.seasonStats.batting.hits / p.seasonStats.batting.atBats }))
              .sort((a, b) => b.value - a.value).slice(0, 5);

            const hrRanking = [...allPlayers]
              .filter(p => (p.seasonStats?.batting?.homeruns || 0) > 0)
              .map(p => ({ ...p, value: p.seasonStats.batting.homeruns }))
              .sort((a, b) => b.value - a.value).slice(0, 5);

            const rbiRanking = [...allPlayers]
              .filter(p => (p.seasonStats?.batting?.rbis || 0) > 0)
              .map(p => ({ ...p, value: p.seasonStats.batting.rbis }))
              .sort((a, b) => b.value - a.value).slice(0, 5);

            const eraRanking = [...pitchingQualified]
              .map(p => ({ ...p, value: (p.seasonStats.pitching.earnedRuns / (p.seasonStats.pitching.inningsPitched / 3)) * 9 }))
              .sort((a, b) => a.value - b.value).slice(0, 5);

            const winRanking = [...allPlayers]
              .filter(p => (p.seasonStats?.pitching?.wins || 0) > 0)
              .map(p => ({ ...p, value: p.seasonStats.pitching.wins }))
              .sort((a, b) => b.value - a.value).slice(0, 5);

            const soRanking = [...allPlayers]
              .filter(p => (p.seasonStats?.pitching?.strikeouts || 0) > 0)
              .map(p => ({ ...p, value: p.seasonStats.pitching.strikeouts }))
              .sort((a, b) => b.value - a.value).slice(0, 5);

            const battingRankings = [
              { title: '打率', data: avgRanking, format: v => v.toFixed(3), color: 'text-blue-400', icon: '🏏' },
              { title: '本塁打', data: hrRanking, format: v => v, color: 'text-pink-400', icon: '💥' },
              { title: '打点', data: rbiRanking, format: v => v, color: 'text-green-400', icon: '🔋' },
            ];

            const pitchingRankings = [
              { title: '防御率', data: eraRanking, format: v => v.toFixed(2), color: 'text-orange-400', icon: '🛡' },
              { title: '勝利', data: winRanking, format: v => v, color: 'text-yellow-400', icon: '🏆' },
              { title: '奪三振', data: soRanking, format: v => v, color: 'text-purple-400', icon: '🔥' },
            ];

            const allRankings = [...battingRankings, ...pitchingRankings];
            const hasAnyData = allRankings.some(r => r.data.length > 0);
            if (!hasAnyData && !isTwoLeague) return null;

            const renderRankingCard = (r) => (
              <div key={r.title} className="bg-gray-900/80 rounded-xl p-2.5 border border-gray-700/20">
                <div className={`text-xs font-bold ${r.color} mb-2 pb-1.5 border-b border-gray-700/40 flex items-center gap-1`}>
                  <span>{r.icon}</span> {r.title}
                </div>
                {r.data.length === 0 ? (
                  <div className="text-xs text-gray-400 py-1">該当者なし</div>
                ) : (
                  r.data.map((p, i) => {
                    const isUser = p.teamName === userTeamName;
                    return (
                      <div key={p.id} className={`flex items-center text-xs py-0.5 rounded-md px-1 ${isUser ? 'text-yellow-300 bg-yellow-900/15' : 'text-gray-300'}`}>
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          i === 0 ? 'bg-yellow-500/90 text-black' : i === 1 ? 'bg-gray-400/80 text-black' : i === 2 ? 'bg-orange-600/80 text-white' : 'text-gray-400'
                        }`}>{i + 1}</span>
                        <span className="flex-1 truncate ml-1.5 text-sm">{p.name} <span className="text-gray-300 text-xs">({getTeamAbbreviation(p.teamName)})</span></span>
                        <span className={`font-mono font-bold text-xs ${r.color}`}>{r.format(p.value)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            );

            return (
              <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl p-3 shadow-xl border border-gray-700/30 mt-3">
                <h2 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-yellow-600/30 flex items-center justify-center">
                    <span className="text-yellow-400 text-sm">📊</span>
                  </div>
                  <span>個人成績ランキング</span>
                  <span className="text-xs text-gray-300 font-normal ml-1">規定打席{qualifiedAB} / 規定投球{qualifiedInnings}回</span>
                  {isTwoLeague && (
                    <div className="flex gap-1 ml-auto">
                      {[
                        { key: 'all', label: '全体' },
                        { key: 'l1', label: leagueNamesList[0] },
                        { key: 'l2', label: leagueNamesList[1] },
                      ].map(opt => (
                        <button
                          key={opt.key}
                          onClick={() => setRankingLeague(opt.key)}
                          className={`px-2 py-0.5 rounded text-xs font-bold transition ${
                            rankingLeague === opt.key ? 'seg-on' : 'seg'
                          }`}
                        >{opt.label}</button>
                      ))}
                    </div>
                  )}
                </h2>
                {!hasAnyData ? (
                  <div className="text-center text-gray-400 text-xs py-4">まだ成績データがありません</div>
                ) : (<>
                  {/* 打撃部門 */}
                  <div className="text-xs text-blue-300 font-bold mb-1 mt-1">打撃部門</div>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {battingRankings.map(r => renderRankingCard(r))}
                  </div>
                  {/* 投手部門 */}
                  <div className="text-xs text-orange-300 font-bold mb-1">投手部門</div>
                  <div className="grid grid-cols-3 gap-2">
                    {pitchingRankings.map(r => renderRankingCard(r))}
                  </div>
                </>)}
              </div>
            );
          })()}
        </div>

        {/* 右カラム: 順位表 or トーナメント */}
        <div className="flex-1 min-w-[420px]">
          {/* 大学モード: トーナメント表示（順位表は共通のものを使用） */}
          {seasonData.settings?.universityMode && (() => {
            const uc = seasonData.universityChampionship;
            const mj = seasonData.meijiJingu;
            if (!uc?.generated && !mj?.generated) return null;

            return (
              <div className="space-y-3 mb-3">
                {/* 全日本大学野球選手権大会 */}
                {uc?.generated && (
                  <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl p-3 shadow-xl border border-orange-700/30">
                    <h2
                      className="text-sm font-bold text-orange-400 mb-2 flex items-center justify-between cursor-pointer select-none"
                      onClick={() => setShowUcTournament(v => !v)}
                    >
                      <span>全日本大学野球選手権大会</span>
                      <span className="text-xs text-gray-400">{showUcTournament ? '▲' : '▼'}</span>
                    </h2>
                    <Collapse open={showUcTournament}>
                      {uc.champion && (
                        <div className="bg-orange-900/30 border border-orange-700/50 rounded-lg p-2 mb-2 text-center">
                          <span className="text-orange-400 font-bold">優勝: {uc.champion}</span>
                          {uc.runnerUp && <span className="text-gray-300 ml-2">準優勝: {uc.runnerUp}</span>}
                        </div>
                      )}
                      {uc.bracket && renderBracketWithLines(uc.bracket)}
                    </Collapse>
                  </div>
                )}

                {/* 明治神宮野球大会 */}
                {mj?.generated && (
                  <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl p-3 shadow-xl border border-red-700/30">
                    <h2
                      className="text-sm font-bold text-red-400 mb-2 flex items-center justify-between cursor-pointer select-none"
                      onClick={() => setShowMjTournament(v => !v)}
                    >
                      <span>明治神宮野球大会</span>
                      <span className="text-xs text-gray-400">{showMjTournament ? '▲' : '▼'}</span>
                    </h2>
                    <Collapse open={showMjTournament}>
                      {mj.champion && (
                        <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-2 mb-2 text-center">
                          <span className="text-red-400 font-bold">優勝: {mj.champion}</span>
                          {mj.runnerUp && <span className="text-gray-300 ml-2">準優勝: {mj.runnerUp}</span>}
                        </div>
                      )}
                      {mj.bracket && renderBracketWithLines(mj.bracket)}
                    </Collapse>
                  </div>
                )}
              </div>
            );
          })()}
          {isCorporate ? (() => {
            const td = seasonData.toshitaikou;
            const rtData = seasonData.regionalTournament;
            const ns = seasonData.nihonSenshuken;
            const cs = seasonData.clubSenshuken;

            // 利用可能なトーナメントタブを構築（時系列順）
            const tournamentTabs = [];
            if (rtData?.generated) tournamentTabs.push({ key: 'regional', label: '地域', color: 'green', done: rtData.phase === 'done' });
            if (td?.generated) {
              if (td.mainTournament) tournamentTabs.push({ key: 'toshitaikou_main', label: '都市対抗 本戦', color: 'yellow', done: !!td.mainDone });
              else tournamentTabs.push({ key: 'toshitaikou', label: '都市対抗 予選', color: 'blue', done: !!td.qualifiersDone });
            }
            if (ns?.generated) tournamentTabs.push({ key: 'senshuken', label: '日本選手権', color: 'red', done: ns.phase === 'done' });
            if (cs?.generated) tournamentTabs.push({ key: 'club', label: 'クラブ選手権', color: 'purple', done: cs.phase === 'done' });

            // 自動選択: 最新の未完了タブ（なければ最後のタブ）
            const autoTab = tournamentTabs.find(t => !t.done)?.key || tournamentTabs[tournamentTabs.length - 1]?.key || null;
            const curTab = (activeTournamentTab && tournamentTabs.some(t => t.key === activeTournamentTab)) ? activeTournamentTab : autoTab;

            const borderColors = { green: 'border-green-700/30', blue: 'border-blue-700/30', yellow: 'border-yellow-700/30', red: 'border-red-700/30', purple: 'border-purple-700/30' };

            // ヘルパー: ブラケット＋ユーザー試合情報の描画
            const themeBg = { green: 'bg-green-900/30', yellow: 'bg-yellow-900/30', red: 'bg-red-900/30', purple: 'bg-purple-900/30', blue: 'bg-blue-900/30' };
            const themeBorder = { green: 'border-green-700/50', yellow: 'border-yellow-700/50', red: 'border-red-700/50', purple: 'border-purple-700/50', blue: 'border-blue-700/50' };
            const themeText = { green: 'text-green-400', yellow: 'text-yellow-400', red: 'text-red-400', purple: 'text-purple-400', blue: 'text-blue-400' };
            const renderBracketPanel = (bracket, teamDefsMap, themeColor, champion, runnerUp, userMatch) => (
              <div>
                {champion && (
                  <div className={`${themeBg[themeColor]} border ${themeBorder[themeColor]} rounded-lg p-2 mb-2 text-center`}>
                    <div className={`${themeText[themeColor]} font-bold`}>優勝: {champion}</div>
                    {runnerUp && <div className="text-gray-300 text-xs">準優勝: {runnerUp}</div>}
                  </div>
                )}
                {bracket && renderBracketWithLines(bracket, teamDefsMap)}
                {userMatch && (() => {
                  const md = bracket?.matchDates?.[userMatch.roundIdx]?.[userMatch.matchIdx] || bracket?.roundDates?.[userMatch.roundIdx];
                  const ds = md ? `${md.month}/${md.day}` : '';
                  return (
                    <div className={`mt-2 ${themeBg[themeColor]} border ${themeBorder[themeColor]} rounded-lg p-2`}>
                      <div className={`text-xs ${themeText[themeColor]} font-bold mb-1 flex items-center gap-1`}>
                        <span>{getRoundName(bracket, userMatch.roundIdx)} - あなたの試合</span>
                        {ds && <span className="text-gray-300 font-normal">({ds})</span>}
                      </div>
                      <span className="text-sm text-white font-bold">
                        {userTeamName} vs {userMatch.match.team1 === userTeamName ? userMatch.match.team2 : userMatch.match.team1}
                      </span>
                    </div>
                  );
                })()}
              </div>
            );

            // 各タブの中身
            const renderTabContent = () => {
              if (curTab === 'regional' && rtData?.generated) {
                const rtBrackets = rtData.brackets || {};
                const rtRegionIds = Object.keys(rtBrackets);
                const rtActiveRegion = selectedRtRegionTab || rtData.userRegionId || rtRegionIds[0];
                const rtActiveQ = rtBrackets[rtActiveRegion];
                const rtUserNext = rtActiveRegion === rtData.userRegionId && rtActiveQ ? getUserNextMatch(rtActiveQ.bracket, userTeamName) : null;
                return (<>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {rtRegionIds.map(rid => {
                      const rq = rtBrackets[rid]; const isUser = rid === rtData.userRegionId; const isActive = rid === rtActiveRegion;
                      return (<button key={rid} onClick={() => setSelectedRtRegionTab(rid)}
                        className={`px-1.5 py-0.5 rounded text-xs font-bold transition ${isActive ? 'seg-on' : isUser ? 'seg ring-1 ring-cyan-700/60' : rq.phase === 'done' ? 'seg opacity-60' : 'seg'}`}>
                        {rq.regionName}{isUser ? '*' : ''}
                      </button>);
                    })}
                  </div>
                  {rtActiveQ && renderBracketPanel(rtActiveQ.bracket, rtActiveQ.teamDefsMap, 'green', rtActiveQ.champion, null, rtUserNext)}
                </>);
              }
              if (curTab === 'toshitaikou' && td?.generated) {
                const qualifiers = td.qualifiers || {};
                const regionIds = Object.keys(qualifiers);
                const activeRegion = selectedRegionTab || td.userRegionId || regionIds[0];
                const activeQ = qualifiers[activeRegion];
                const umMain = activeRegion === td.userRegionId && activeQ ? getUserNextMatch(activeQ.mainBracket, userTeamName) : null;
                const umLosers = activeRegion === td.userRegionId && activeQ?.losersBracket ? getUserNextMatch(activeQ.losersBracket, userTeamName) : null;
                const um = umMain || umLosers;
                const umBracket = umMain ? activeQ?.mainBracket : activeQ?.losersBracket;
                const hasLosers = !!activeQ?.losersBracket;
                const showingLosers = hasLosers && selectedBracketTab === 'losers';
                return (<>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {regionIds.map(rid => {
                      const q = qualifiers[rid]; const isUser = rid === td.userRegionId; const isActive = rid === activeRegion;
                      return (<button key={rid} onClick={() => { setSelectedRegionTab(rid); setSelectedBracketTab('main'); }}
                        className={`px-1.5 py-0.5 rounded text-xs font-bold transition ${isActive ? 'seg-on' : isUser ? 'seg ring-1 ring-cyan-700/60' : q.phase === 'done' ? 'seg opacity-60' : 'seg'}`}>
                        {q.regionName}{isUser ? '*' : ''}
                      </button>);
                    })}
                  </div>
                  {activeQ && (<div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-gray-300">{activeQ.regionName} ({activeQ.slots}枠)</span>
                      {activeQ.phase === 'done' && <span className="text-xs text-green-400">予選終了</span>}
                    </div>
                    {hasLosers && (
                      <div className="flex gap-1 mb-2">
                        <button onClick={() => setSelectedBracketTab('main')} className={`px-2 py-0.5 rounded text-xs font-bold transition ${!showingLosers ? 'seg-on' : 'seg'}`}>地区予選</button>
                        <button onClick={() => setSelectedBracketTab('losers')} className={`px-2 py-0.5 rounded text-xs font-bold transition ${showingLosers ? 'seg-on' : 'seg'}`}>敗者復活</button>
                      </div>
                    )}
                    {showingLosers ? renderBracketWithLines(activeQ.losersBracket, activeQ.teamDefsMap) : renderBracketWithLines(activeQ.mainBracket, activeQ.teamDefsMap)}
                    {um && (() => {
                      const md = umBracket?.matchDates?.[um.roundIdx]?.[um.matchIdx] || umBracket?.roundDates?.[um.roundIdx];
                      const ds = md ? `${md.month}/${md.day}` : '';
                      const lp = umLosers && !umMain ? '敗者復活 ' : '';
                      return (<div className="mt-2 bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-2">
                        <div className="text-xs text-yellow-400 font-bold mb-1">{lp}{getRoundName(umBracket, um.roundIdx)} - あなたの試合 {ds && <span className="text-gray-300 font-normal">({ds})</span>}</div>
                        <span className="text-sm text-white font-bold">{userTeamName} vs {um.match.team1 === userTeamName ? um.match.team2 : um.match.team1}</span>
                      </div>);
                    })()}
                    {activeQ.qualifiedTeams?.length > 0 && (
                      <div className="mt-2 bg-green-900/20 border border-green-700/30 rounded-lg p-2">
                        <div className="text-xs text-green-400 font-bold mb-0.5">本戦出場</div>
                        <div className="flex flex-wrap gap-x-2">{activeQ.qualifiedTeams.map((name, i) => {
                          const def = activeQ.teamDefsMap[name];
                          return (<span key={i} className="text-xs"><span className={`font-bold ${RANK_COLORS[def?.rank] || ''}`}>{def?.rank}</span><span className={name === userTeamName ? 'text-yellow-300 font-bold' : 'text-gray-300'}> {name}</span></span>);
                        })}</div>
                      </div>
                    )}
                  </div>)}
                </>);
              }
              if (curTab === 'toshitaikou_main' && td?.mainTournament) {
                const mt = td.mainTournament;
                const um = !td.mainDone ? getUserNextMatch(mt.bracket, userTeamName) : null;
                return renderBracketPanel(mt.bracket, mt.teamDefsMap, 'yellow', td.mainDone ? td.champion : null, td.mainDone ? td.runnerUp : null, um);
              }
              if (curTab === 'senshuken' && ns?.generated) {
                const nsMainBracket = ns.mainTournament?.bracket;
                const nsMainTeamDefs = ns.mainTournament?.teamDefsMap;
                const nsDone = ns.phase === 'done';
                if (nsMainBracket) {
                  const um = !nsDone ? getUserNextMatch(nsMainBracket, userTeamName) : null;
                  return renderBracketPanel(nsMainBracket, nsMainTeamDefs, 'red', nsDone ? ns.champion : null, nsDone ? ns.runnerUp : null, um);
                }
                if (ns.userRegionId && ns.qualifiers?.[ns.userRegionId]) {
                  const q = ns.qualifiers[ns.userRegionId];
                  const umQ = getUserNextMatch(q.mainBracket, userTeamName) || (q.losersBracket ? getUserNextMatch(q.losersBracket, userTeamName) : null);
                  return (<div>
                    <div className="text-xs text-red-300 font-bold mb-1">{q.regionName}地区予選 ({q.slots}枠)</div>
                    {renderBracketWithLines(q.mainBracket, q.teamDefsMap)}
                    {q.losersBracket && (<div className="mt-1"><div className="text-xs text-orange-300 font-bold mb-1">敗者復活</div>{renderBracketWithLines(q.losersBracket, q.teamDefsMap)}</div>)}
                    {q.qualifiedTeams?.length > 0 && (<div className="mt-2 bg-green-900/20 border border-green-700/30 rounded-lg p-2"><div className="text-xs text-green-400 font-bold mb-0.5">本戦出場</div><div className="flex flex-wrap gap-x-2">{q.qualifiedTeams.map((n2, i) => <span key={i} className={`text-xs ${n2 === userTeamName ? 'text-yellow-300 font-bold' : 'text-gray-300'}`}>{n2}</span>)}</div></div>)}
                  </div>);
                }
                return <div className="text-gray-400 text-xs text-center py-2">予選進行中...</div>;
              }
              if (curTab === 'club' && cs?.generated) {
                const csMainBracket = cs.mainTournament?.bracket;
                const csMainTeamDefs = cs.mainTournament?.teamDefsMap;
                const csDone = cs.phase === 'done';
                if (csMainBracket) {
                  const um = !csDone ? getUserNextMatch(csMainBracket, userTeamName) : null;
                  return renderBracketPanel(csMainBracket, csMainTeamDefs, 'purple', csDone ? cs.champion : null, csDone ? cs.runnerUp : null, um);
                }
                if (cs.userRegionId && cs.qualifiers?.[cs.userRegionId]) {
                  const q = cs.qualifiers[cs.userRegionId];
                  return (<div>
                    <div className="text-xs text-purple-300 font-bold mb-1">{q.regionName}地区予選 ({q.slots}枠)</div>
                    {renderBracketWithLines(q.mainBracket, q.teamDefsMap)}
                    {q.losersBracket && (<div className="mt-1"><div className="text-xs text-orange-300 font-bold mb-1">敗者復活</div>{renderBracketWithLines(q.losersBracket, q.teamDefsMap)}</div>)}
                  </div>);
                }
                return <div className="text-gray-400 text-xs text-center py-2">予選進行中...</div>;
              }
              // スケジュール表示（タブなし時）
              return (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-gray-300"><span>4月〜5月</span><span>地域トーナメント</span></div>
                  <div className="flex justify-between text-gray-300"><span>5月〜6月</span><span>都市対抗 地区予選</span></div>
                  <div className="flex justify-between text-gray-300"><span>7月</span><span>都市対抗 本戦</span></div>
                  <div className="flex justify-between text-gray-300"><span>9月</span><span>日本選手権/クラブ選手権 予選</span></div>
                  <div className="flex justify-between text-gray-300"><span>10月</span><span>本戦 / NPBドラフト</span></div>
                  <div className="flex justify-between text-gray-300"><span>11月</span><span>退団・スカウト</span></div>
                </div>
              );
            };

            const curTabDef = tournamentTabs.find(t => t.key === curTab);
            return (
              <div className={`bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl p-3 shadow-xl border ${borderColors[curTabDef?.color] || 'border-gray-700/30'}`}>
                {tournamentTabs.length > 0 ? (
                  <>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {tournamentTabs.map(tab => {
                      const active = tab.key === curTab;
                      return (
                        <button key={tab.key} onClick={() => setActiveTournamentTab(tab.key)}
                          className={`px-2 py-1 rounded-lg text-xs font-bold transition ${
                            /* ⚠ 選択色をデータ配列(`tabColors`)に持たせていたので大会ごとに
                               緑/青/黄/赤/紫 とバラバラだった（CLAUDE.md「色をデータ配列に
                               持たせない」）。しかも `text-white` が bg-green-600 の上で 3.3:1。
                               共有語彙の `.seg` / `.seg-on` に揃える。大会の識別色は
                               カードの枠(`borderColors`)が引き続き持つ */
                            active ? 'seg-on' : tab.done ? 'seg opacity-70' : 'seg'
                          }`}>
                          {tab.label}{tab.done ? ' ✓' : ''}
                        </button>
                      );
                    })}
                  </div>
                  {renderTabContent()}
                  </>
                ) : (
                  <>
                  <h2 className="text-base font-bold text-white flex items-center gap-2 mb-2"><span>📅</span> 年間スケジュール</h2>
                  {renderTabContent()}
                  </>
                )}
              </div>
            );
          })() : (() => {
            const renderStandingsTable = (leagueStandings, title, titleColor) => {
              const lLeader = leagueStandings[0];
              const lLeaderWins = lLeader?.wins || 0;
              const lLeaderLosses = lLeader?.losses || 0;
              const isLChampionDecided = lLeader && leagueStandings.length > 1 && (() => {
                const second = leagueStandings[1];
                const secondRemaining = totalGames - ((second.wins || 0) + (second.losses || 0) + (second.draws || 0));
                return lLeaderWins > (second.wins || 0) + secondRemaining;
              })();

              return (
                <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl p-3 shadow-xl border border-gray-700/30">
                  <h2 className={`text-base font-bold mb-2.5 ${titleColor || 'text-white'} flex items-center gap-2`}>
                    <div className="w-7 h-7 rounded-lg bg-gray-700/60 flex items-center justify-center text-sm">📊</div>
                    {title}
                  </h2>
                  <table className="tabular-nums w-full text-white text-sm">
                    <thead>
                      <tr className="border-b-2 border-gray-600/50 text-gray-300 text-xs">
                        <th className="py-1.5 px-0.5 text-center w-6">#</th>
                        <th className="py-1.5 px-1 text-left">チーム</th>
                        <th className="py-1.5 px-0.5 text-center">試</th>
                        <th className="py-1.5 px-0.5 text-center">勝</th>
                        <th className="py-1.5 px-0.5 text-center">負</th>
                        <th className="py-1.5 px-0.5 text-center">分</th>
                        <th className="py-1.5 px-0.5 text-center">率</th>
                        <th className="py-1.5 px-0.5 text-center">差</th>
                        <th className="py-1.5 px-0.5 text-center">打率</th>
                        <th className="py-1.5 px-0.5 text-center">防</th>
                        <th className="py-1.5 px-0.5 text-center">M</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leagueStandings.map((team, index) => {
                        const isUser = team.team === userTeamName;
                        const wr = (team.wins || 0) + (team.losses || 0) > 0
                          ? ((team.wins || 0) / ((team.wins || 0) + (team.losses || 0))).toFixed(3) : '.000';
                        const td = TEAMS_DATA[team.team];
                        let tAvg = '-', tEra = '-';
                        if (td?.players) {
                          let tH = 0, tAB = 0, tER = 0, tIP = 0;
                          td.players.forEach(p => {
                            tH += p.seasonStats?.batting?.hits || 0;
                            tAB += p.seasonStats?.batting?.atBats || 0;
                            tER += p.seasonStats?.pitching?.earnedRuns || 0;
                            tIP += (p.seasonStats?.pitching?.inningsPitched || 0) / 3;
                          });
                          tAvg = tAB > 0 ? (tH / tAB).toFixed(3) : '-';
                          tEra = tIP > 0 ? (tER / tIP * 9).toFixed(2) : '-';
                        }
                        let gb = '';
                        if (index === 0) gb = isLChampionDecided ? '優勝' : '-';
                        else { const d = ((lLeaderWins - (team.wins || 0)) - (lLeaderLosses - (team.losses || 0))) / 2; gb = d === 0 ? '-' : d.toFixed(1); }
                        let mg = '';
                        if (index === 0 && leagueStandings.length > 1) {
                          const sec = leagueStandings[1];
                          const secMax = (sec.wins || 0) + (totalGames - ((sec.wins || 0) + (sec.losses || 0) + (sec.draws || 0)));
                          const mn = secMax - lLeaderWins + 1;
                          if (mn > 0 && !isLChampionDecided) mg = `M${mn}`;
                          else if (isLChampionDecided) mg = '-';
                        }
                        return (
                          <tr key={team.team} className={`border-b border-gray-700/30 transition-colors hover:bg-gray-700/20 ${isUser ? 'bg-blue-900/30 hover:bg-blue-900/40' : ''} ${index === 0 && isLChampionDecided ? 'bg-yellow-900/15' : ''}`}>
                            <td className="py-1.5 px-0.5 text-center">
                              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mx-auto ${index === 0 ? 'bg-yellow-500/90 text-black' : index === 1 ? 'bg-gray-400/80 text-black' : index === 2 ? 'seg-on' : 'seg'}`}>{index + 1}</span>
                            </td>
                            <td className={`py-1.5 px-1 font-bold text-sm ${isUser ? 'text-yellow-300' : ''}`}>
                              {team.team}
                              {isUser && <span className="ml-1 text-xs text-blue-400 font-bold">YOU</span>}
                            </td>
                            <td className="py-1.5 px-0.5 text-center text-white text-xs">{team.gamesPlayed || 0}</td>
                            <td className="py-1.5 px-0.5 text-center text-green-400 font-bold">{team.wins || 0}</td>
                            <td className="py-1.5 px-0.5 text-center text-red-400 font-bold">{team.losses || 0}</td>
                            <td className="py-1.5 px-0.5 text-center text-white">{team.draws || 0}</td>
                            <td className="py-1.5 px-0.5 text-center font-mono text-xs">{wr}</td>
                            <td className={`py-1.5 px-0.5 text-center font-bold text-xs ${index === 0 && isLChampionDecided ? 'text-yellow-400' : 'text-white'}`}>{gb}</td>
                            <td className="py-1.5 px-0.5 text-center font-mono text-blue-300 text-xs">{tAvg}</td>
                            <td className="py-1.5 px-0.5 text-center font-mono text-orange-300 text-xs">{tEra}</td>
                            <td className="py-1.5 px-0.5 text-center text-red-400 font-bold text-xs">{mg}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            };

            // プレーオフ成績表示コンポーネント
            const renderPlayoffBracket = () => {
              const playoffGames = (seasonData.schedule || []).filter(g => g.phase === SEASON_PHASES.PLAYOFFS);
              if (playoffGames.length === 0) return null;
              const playoffFormat = seasonData?.settings?.playoffFormat || 'short';

              // シリーズごとの集計
              const getSeriesData = (seriesId) => {
                const games = playoffGames.filter(g => g.seriesId === seriesId && !g.result?.cancelled);
                if (games.length === 0) return null;
                const firstGame = games.find(g => g.seriesGame === 1);
                if (!firstGame || firstGame.home === 'TBD') return null;
                // seriesGame=1のhomeを「上位チーム」とする
                const team1 = firstGame.home;
                const team2 = firstGame.away;
                let team1Wins = 0, team2Wins = 0;
                const gameResults = games.sort((a, b) => a.seriesGame - b.seriesGame).map(g => {
                  if (!g.result) return { game: g.seriesGame, status: 'pending' };
                  const homeWon = g.result.homeScore > g.result.awayScore;
                  const t1Won = (g.home === team1 && homeWon) || (g.away === team1 && !homeWon);
                  if (t1Won) team1Wins++;
                  else team2Wins++;
                  const t1Score = g.home === team1 ? g.result.homeScore : g.result.awayScore;
                  const t2Score = g.home === team2 ? g.result.homeScore : g.result.awayScore;
                  return { game: g.seriesGame, t1Score, t2Score, t1Won, status: 'done' };
                });
                const maxGames = games.length;
                const maxWins = maxGames === 1 ? 1 : Math.ceil(maxGames / 2);
                const isComplete = team1Wins >= maxWins || team2Wins >= maxWins;
                const winner = isComplete ? (team1Wins >= maxWins ? team1 : team2) : null;
                return { team1, team2, team1Wins, team2Wins, gameResults, isComplete, winner };
              };

              // シリーズ表示（5戦3勝 or 1戦）
              const renderSeries = (seriesData, title, isFinal = false) => {
                if (!seriesData) return (
                  <div className={`rounded-xl p-2.5 text-center border border-dashed ${isFinal ? 'bg-gray-800/40 border-yellow-700/30' : 'bg-gray-800/40 border-gray-600/30'}`}>
                    <div className={`text-xs font-bold mb-1 ${isFinal ? 'text-yellow-500' : 'text-gray-400'}`}>{title}</div>
                    <div className="text-gray-400 text-xs">準決勝結果待ち</div>
                  </div>
                );
                const { team1, team2, team1Wins, team2Wins, gameResults, isComplete, winner } = seriesData;
                const t1Abbr = getTeamAbbreviation(team1);
                const t2Abbr = getTeamAbbreviation(team2);
                return (
                  <div className={`rounded-xl overflow-hidden ${
                    isFinal ? 'bg-gradient-to-b from-yellow-900/30 to-gray-800 border border-yellow-600/30 shadow-lg shadow-yellow-900/10' :
                    isComplete ? 'bg-gray-800/60 border border-gray-700/30' :
                    'bg-gradient-to-b from-gray-700 to-gray-800 border border-gray-600/30'
                  }`}>
                    {/* タイトルバー */}
                    <div className={`px-2.5 py-1 ${
                      isFinal ? 'bg-gradient-to-r from-yellow-700/40 via-yellow-600/30 to-yellow-700/40' :
                      'bg-gradient-to-r from-gray-700 via-gray-600/30 to-gray-700'
                    }`}>
                      <div className={`text-xs font-bold text-center tracking-wide ${isFinal ? 'text-yellow-400' : 'text-gray-300'}`}>{title}</div>
                    </div>
                    <div className="p-2.5">
                      {/* チーム名と勝敗 */}
                      <div className="flex items-center justify-between mb-2">
                        <div className={`text-sm font-bold flex-1 text-center ${winner === team1 ? 'text-yellow-300' : winner === team2 ? 'text-gray-400 line-through' : 'text-white'}`}>
                          {winner === team1 && <span className="text-xs mr-0.5">👑</span>}{t1Abbr}
                        </div>
                        <div className="px-2.5">
                          <div className="flex items-center gap-1">
                            <span className={`font-black text-xl font-mono ${winner === team1 ? 'text-yellow-300' : 'text-white'}`}>{team1Wins}</span>
                            <span className="text-gray-400 text-sm">-</span>
                            <span className={`font-black text-xl font-mono ${winner === team2 ? 'text-yellow-300' : 'text-white'}`}>{team2Wins}</span>
                          </div>
                        </div>
                        <div className={`text-sm font-bold flex-1 text-center ${winner === team2 ? 'text-yellow-300' : winner === team1 ? 'text-gray-400 line-through' : 'text-white'}`}>
                          {winner === team2 && <span className="text-xs mr-0.5">👑</span>}{t2Abbr}
                        </div>
                      </div>
                      {/* 各試合スコア */}
                      {gameResults.length > 0 && (
                        <div className="space-y-0.5 bg-gray-900/40 rounded-lg p-1.5">
                          {gameResults.map(g => (
                            <div key={g.game} className={`flex items-center text-xs rounded-md px-1.5 py-0.5 ${g.status === 'done' ? 'bg-gray-800/40' : ''}`}>
                              <span className="w-10 text-gray-400 text-xs">第{g.game}戦</span>
                              {g.status === 'done' ? (
                                <>
                                  <span className={`flex-1 text-right font-mono ${g.t1Won ? 'text-green-400 font-bold' : 'text-gray-300'}`}>{g.t1Score}</span>
                                  <span className="mx-1.5 text-gray-700">-</span>
                                  <span className={`flex-1 text-left font-mono ${!g.t1Won ? 'text-green-400 font-bold' : 'text-gray-300'}`}>{g.t2Score}</span>
                                </>
                              ) : (
                                <span className="flex-1 text-center text-gray-700 text-xs">--- 未消化 ---</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {isComplete && winner && isFinal && (
                        <div className="mt-2 text-center py-1.5 bg-yellow-600/20 rounded-lg border border-yellow-600/20">
                          <div className="text-xs font-bold text-yellow-400">🏆 {winner} 優勝!</div>
                        </div>
                      )}
                      {isComplete && winner && !isFinal && (
                        <div className="mt-1.5 text-center text-xs font-bold text-gray-300">
                          {winner} → 決勝進出
                        </div>
                      )}
                    </div>
                  </div>
                );
              };

              const renderBracketContainer = (title, content) => (
                <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl p-3 shadow-xl border border-gray-700/30 mt-3">
                  <h2 className="text-base font-bold mb-3 text-white flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-yellow-600/30 flex items-center justify-center">
                      <span className="text-yellow-400 text-sm">🏆</span>
                    </div>
                    <span>{title}</span>
                  </h2>
                  {content}
                </div>
              );

              if (playoffFormat === 'tournament') {
                const semi1 = getSeriesData('semi1');
                const semi2 = getSeriesData('semi2');
                const final_ = getSeriesData('final');
                return renderBracketContainer('プレーオフ トーナメント (5戦3勝制)', (
                  <div className="flex items-stretch gap-2">
                    <div className="flex-1 space-y-2">
                      {renderSeries(semi1, '準決勝①')}
                      {renderSeries(semi2, '準決勝②')}
                    </div>
                    <div className="flex items-center">
                      <svg width="24" height="100" className="text-gray-400">
                        <line x1="0" y1="25" x2="12" y2="25" stroke="currentColor" strokeWidth="1.5"/>
                        <line x1="12" y1="25" x2="12" y2="75" stroke="currentColor" strokeWidth="1.5"/>
                        <line x1="0" y1="75" x2="12" y2="75" stroke="currentColor" strokeWidth="1.5"/>
                        <line x1="12" y1="50" x2="24" y2="50" stroke="currentColor" strokeWidth="1.5"/>
                      </svg>
                    </div>
                    <div className="flex-1 flex items-center">
                      {renderSeries(final_, '決勝', true)}
                    </div>
                  </div>
                ));
              } else if (playoffFormat === 'short') {
                const final_ = getSeriesData('final');
                if (!final_) return null;
                return renderBracketContainer('プレーオフ (3回戦2勝先取)',
                  renderSeries(final_, '決勝', true)
                );
              } else {
                // 'full' or fallback
                const final_ = getSeriesData('final');
                if (!final_) return null;
                return renderBracketContainer('プレーオフ (5回戦3勝先取)',
                  renderSeries(final_, '決勝', true)
                );
              }
            };

            if (isTwoLeague) {
              const l1 = standings.filter(s => league1Teams.includes(s.team)).sort((a, b) => b.winRate - a.winRate || b.wins - a.wins);
              const l2 = standings.filter(s => league2Teams.includes(s.team)).sort((a, b) => b.winRate - a.winRate || b.wins - a.wins);
              return (
                <div className="space-y-3">
                  {renderStandingsTable(l1, `${leagueNamesList[0]} 順位表`, 'text-blue-400')}
                  {renderStandingsTable(l2, `${leagueNamesList[1]} 順位表`, 'text-orange-400')}
                  {renderPlayoffBracket()}
                </div>
              );
            }

            // 大学モード: 春秋制タブ付き順位表
            const isUniversityMode = seasonData?.settings?.universityMode;
            const userLeagueName = isUniversityMode
              ? (UNIVERSITY_REGIONS.find(r => r.id === WORLD_DATA.userLeagueId)?.name || '')
              : (INDEPENDENT_LEAGUES[WORLD_DATA.userLeagueId]?.name || '');
            const curMonth = currentDate?.month || 4;
            const spStandings = seasonData?.springStandings || null;
            const isFallSeason = isUniversityMode && spStandings != null;
            const hasBothSeasons = isUniversityMode && isFallSeason && spStandings?.length > 0;

            if (!isUniversityMode) {
              return (
                <div className="space-y-3">
                  {renderStandingsTable(standings, userLeagueName ? `${userLeagueName}　順位` : '順位表', 'text-white')}
                  {renderPlayoffBracket()}
                </div>
              );
            }

            // 大学モード: タブ表示
            const isSummerBreak = !isFallSeason && curMonth >= 7 && curMonth <= 8;
            const isPreFall = !isFallSeason && curMonth >= 9;
            const activeTab = hasBothSeasons ? uniStandingsTab : (isFallSeason ? 'fall' : 'spring');
            const springLabel = (isSummerBreak || isPreFall || isFallSeason) ? '春季最終' : '春季';
            const fallLabel = '秋季';

            const springTableData = hasBothSeasons
              ? [...spStandings].sort((a, b) => b.winRate - a.winRate || b.wins - a.wins)
              : isFallSeason ? [] : [...standings].sort((a, b) => b.winRate - a.winRate || b.wins - a.wins);
            const fallTableData = standings;

            const showingData = activeTab === 'fall' ? fallTableData : springTableData;
            const showingTitle = activeTab === 'fall'
              ? `${userLeagueName ? userLeagueName + '　' : ''}${fallLabel}順位表`
              : `${userLeagueName ? userLeagueName + '　' : ''}${springLabel}順位`;
            const showingColor = activeTab === 'fall' ? 'text-orange-400' : 'text-green-400';

            return (
              <div className="space-y-3">
                <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl p-3 shadow-xl border border-gray-700/30">
                  {/* タブ（両シーズンある場合のみ） */}
                  {hasBothSeasons && (
                    <div className="flex gap-1 mb-3">
                      <button
                        onClick={() => setUniStandingsTab('spring')}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition ${activeTab === 'spring' ? 'seg-on border' : 'seg'}`}
                      >🌸 {springLabel}</button>
                      <button
                        onClick={() => setUniStandingsTab('fall')}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition ${activeTab === 'fall' ? 'seg-on border' : 'seg'}`}
                      >🍂 {fallLabel}</button>
                    </div>
                  )}
                  <h2 className={`text-base font-bold mb-2.5 ${showingColor} flex items-center gap-2`}>
                    <div className="w-7 h-7 rounded-lg bg-gray-700/60 flex items-center justify-center text-sm">📊</div>
                    {showingTitle}
                  </h2>
                  <table className="tabular-nums w-full text-white text-sm">
                    <thead>
                      <tr className="border-b-2 border-gray-600/50 text-gray-300 text-xs">
                        <th className="py-1.5 px-0.5 text-center w-6">#</th>
                        <th className="py-1.5 px-1 text-left">チーム</th>
                        <th className="py-1.5 px-0.5 text-center">試</th>
                        <th className="py-1.5 px-0.5 text-center">勝</th>
                        <th className="py-1.5 px-0.5 text-center">負</th>
                        <th className="py-1.5 px-0.5 text-center">分</th>
                        <th className="py-1.5 px-0.5 text-center">率</th>
                        {activeTab === 'fall' && <th className="py-1.5 px-0.5 text-center">差</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {showingData.map((team, index) => {
                        const isUser = team.team === userTeamName;
                        const wr = (team.wins || 0) + (team.losses || 0) > 0
                          ? ((team.wins || 0) / ((team.wins || 0) + (team.losses || 0))).toFixed(3) : '.000';
                        let gb = '';
                        if (index === 0) {
                          gb = '-';
                        } else {
                          const leader = showingData[0];
                          const gbVal = ((leader.wins - team.wins) + (team.losses - leader.losses)) / 2;
                          gb = gbVal > 0 ? gbVal.toFixed(1) : '-';
                        }
                        return (
                          <tr key={index} className={`border-b border-gray-700/20 ${isUser ? 'bg-blue-900/20' : index % 2 === 0 ? 'bg-gray-800/20' : ''}`}>
                            <td className="py-1.5 px-0.5 text-center">
                              <span className={`text-xs font-bold ${index === 0 ? 'text-yellow-400' : index <= 2 ? 'text-gray-300' : 'text-gray-400'}`}>{index + 1}</span>
                            </td>
                            <td className="py-1.5 px-1">
                              <span className={`text-xs ${isUser ? 'text-yellow-300 font-bold' : 'text-gray-200'}`}>
                                {team.team}{isUser && <span className="text-xs text-blue-400 ml-1">you</span>}
                              </span>
                            </td>
                            <td className="py-1.5 px-0.5 text-center text-xs text-gray-300">{(team.wins || 0) + (team.losses || 0) + (team.draws || 0)}</td>
                            <td className="py-1.5 px-0.5 text-center text-xs text-green-400 font-bold">{team.wins || 0}</td>
                            <td className="py-1.5 px-0.5 text-center text-xs text-red-400">{team.losses || 0}</td>
                            <td className="py-1.5 px-0.5 text-center text-xs text-gray-300">{team.draws || 0}</td>
                            <td className="py-1.5 px-0.5 text-center text-xs font-mono text-gray-300">{wr}</td>
                            {activeTab === 'fall' && <td className="py-1.5 px-0.5 text-center text-xs text-gray-300">{gb}</td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {renderPlayoffBracket()}
              </div>
            );
          })()}

          {/* スポーツ新聞ボタン（ニュースが無い時のフォールバック） */}
          {newsFeed.length === 0 && (seasonData.results?.length || 0) > 0 && (
            <div className="mt-3 text-center">
              <button onClick={() => setShowNewspaper(true)} className="btn-warn text-xs px-4 py-1.5 rounded-lg border transition-colors">
                📰 スポーツ新聞を読む
              </button>
            </div>
          )}

          {/* ニュース＆状況（チーム状況レポート＋スカウト＋リーグトピックを重要度順に統合） */}
          {newsFeed.length > 0 && (
            <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl p-3 shadow-xl border border-gray-700/30 mt-3">
              <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-1.5">
                <span className="text-yellow-400">📰</span> ニュース＆状況
                <button onClick={() => setShowNewspaper(true)} className="btn-warn ml-auto text-xs px-2 py-0.5 rounded-lg border transition-colors">
                  スポーツ新聞
                </button>
              </h2>
              <div className="space-y-1">
                {newsFeed.map((n, i) => (
                  <div key={i} className={`flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 border ${
                    n.src === 'report' ? 'bg-blue-950/30 border-blue-800/20'
                      : n.src === 'scout' ? 'bg-cyan-900/30 border-cyan-700/30'
                      : 'bg-gray-800/60 border-transparent'
                  }`}>
                    <span className="text-sm shrink-0">{n.icon}</span>
                    <span className={`text-xs ${n.color}`}>{n.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 平行世界リーグ順位表 */}
          {WORLD_DATA.initialized && (() => {
            const parallelLeagues = getAllParallelLeagues();
            if (parallelLeagues.length === 0 && !seasonData.grandChampionship?.done) return null;
            return (
              <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl p-3 shadow-xl border border-emerald-700/30 mt-3">
                <h2
                  className="text-sm font-bold text-emerald-400 mb-2 flex items-center gap-1.5 cursor-pointer select-none flex-wrap"
                  onClick={() => setShowOtherLeagues(prev => !prev)}
                >
                  <span>🌐</span> 独立リーグ状況
                  {/* 自リーグ（並行世界リストには含まれないためヘッダーに表示） */}
                  {(() => {
                    const myTeams = seasonData?.settings?.teamNames || [];
                    if (myTeams.length === 0) return null;
                    const myRank = getLeagueRankFromTeams(myTeams);
                    const myLeagueName = INDEPENDENT_LEAGUES[seasonData?.settings?.preset]?.name
                      || seasonData?.settings?.leagueName || '所属リーグ';
                    return (
                      <span className="flex items-center gap-1 ml-1 font-normal">
                        <span className="text-xs text-gray-300">所属:</span>
                        <span className="text-xs text-gray-200 font-bold">{myLeagueName}</span>
                        <LeagueRankBadge rank={myRank} />
                      </span>
                    );
                  })()}
                  <span className="text-xs text-gray-400 ml-auto">{showOtherLeagues ? '▲' : '▼'}</span>
                </h2>
                <Collapse open={showOtherLeagues}><div className="space-y-2">
                  {parallelLeagues.map(league => {
                    const leagueDef = INDEPENDENT_LEAGUES[league.id];
                    const isTwoLeague = leagueDef?.leagueFormat === 'two';
                    const leagueNames = leagueDef?.leagueNames;
                    const halfCount = isTwoLeague ? Math.floor(league.standings.length / 2) : 0;
                    return (
                    <div key={league.id} className="bg-gray-800/50 rounded-lg p-2 border border-gray-700/30">
                      <div className="text-xs font-bold text-gray-300 mb-1 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate">{leagueDef?.name || league.name}</span>
                          <LeagueRankBadge rank={getLeagueRankFromTeams(league.teams)} />
                        </span>
                        <span className="text-xs text-gray-300 flex-shrink-0">{leagueDef?.gamesPerSeason || '?'}試合中{Math.round(league.gamesPlayed)}試合消化</span>
                      </div>
                      {isTwoLeague && halfCount > 0 ? (
                        <div className="space-y-1.5">
                          {[0, 1].map(li => {
                            const lName = leagueNames?.[li] || `リーグ${li + 1}`;
                            const lTeams = league.standings.filter((_, idx) => {
                              const teamIdx = league.teams.indexOf(league.standings[idx]?.team);
                              return teamIdx >= 0 && Math.floor(teamIdx / halfCount) === li;
                            }).sort((a, b) => b.winRate - a.winRate || b.wins - a.wins);
                            return (
                              <div key={li}>
                                <div className="text-xs text-gray-400 font-bold mb-0.5">{lName}</div>
                                <div className="space-y-0.5">
                                  {lTeams.map((s, i) => {
                                    const wr = (s.wins + s.losses) > 0 ? (s.wins / (s.wins + s.losses)).toFixed(3) : '.000';
                                    return (
                                      <div key={s.team} className="flex items-center text-xs gap-1">
                                        <span className={`w-4 text-center font-bold ${i === 0 ? 'text-yellow-400' : 'text-gray-400'}`}>{i + 1}</span>
                                        <span className="flex-1 text-gray-200 truncate">{s.team}</span>
                                        <span className="text-green-400 w-5 text-right">{s.wins}</span>
                                        <span className="text-gray-400">-</span>
                                        <span className="text-red-400 w-5">{s.losses}</span>
                                        <span className="text-gray-300 w-8 text-right font-mono">{wr}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                      <div className="space-y-0.5">
                        {league.standings.map((s, i) => {
                          const wr = (s.wins + s.losses) > 0 ? (s.wins / (s.wins + s.losses)).toFixed(3) : '.000';
                          return (
                            <div key={s.team} className="flex items-center text-xs gap-1">
                              <span className={`w-4 text-center font-bold ${i === 0 ? 'text-yellow-400' : 'text-gray-400'}`}>{i + 1}</span>
                              <span className="flex-1 text-gray-200 truncate">{s.team}</span>
                              <span className="text-green-400 w-5 text-right">{s.wins}</span>
                              <span className="text-gray-400">-</span>
                              <span className="text-red-400 w-5">{s.losses}</span>
                              <span className="text-gray-300 w-8 text-right font-mono">{wr}</span>
                            </div>
                          );
                        })}
                      </div>
                      )}
                    </div>
                    );
                  })}
                  {seasonData.grandChampionship?.done && (() => {
                    const gc = seasonData.grandChampionship;
                    const champLeagueMap = {};
                    for (const c of gc.champions || []) {
                      champLeagueMap[c.team] = c.leagueName || c.league;
                    }
                    const roundLabels = { 1: '決勝', 2: '準決勝', 3: '準々決勝', 4: '1回戦' };
                    const numRounds = gc.bracket.rounds.length;
                    return (
                      <div className="bg-orange-900/20 rounded-lg p-2 border border-orange-700/30">
                        <div className="text-xs font-bold text-orange-400 mb-1">🏆 独立リーググランドチャンピオンシップ</div>
                        <div className="text-xs text-gray-300 mb-1">
                          <span className="text-orange-300 font-bold">優勝: {gc.bracket.champion}</span>
                          {gc.bracket.runnerUp && <span className="text-gray-400 ml-2">準優勝: {gc.bracket.runnerUp}</span>}
                        </div>
                        <div className="text-xs text-gray-300 mb-1 flex flex-wrap gap-x-2">
                          {gc.champions.map((c, ci) => (
                            <span key={ci}><span className="text-gray-400">{champLeagueMap[c.team]}:</span> {c.team}</span>
                          ))}
                        </div>
                        <div className="space-y-1">
                          {gc.bracket.rounds.map((round, ri) => {
                            const realMatches = round.filter(m => !m.isBye);
                            if (realMatches.length === 0) return null;
                            const label = roundLabels[numRounds - ri] || `${ri + 1}回戦`;
                            return (
                              <div key={ri}>
                                <div className="text-xs text-orange-600 font-bold">{label}</div>
                                {realMatches.map((m, mi) => (
                                  <div key={mi} className="flex items-center text-xs gap-1">
                                    <span className={`flex-1 truncate ${m.winner === m.team1 ? 'text-orange-300 font-bold' : 'text-gray-400'}`}>{m.team1}</span>
                                    <span className="text-gray-400 font-mono">{m.score || ''}</span>
                                    <span className={`flex-1 truncate text-right ${m.winner === m.team2 ? 'text-orange-300 font-bold' : 'text-gray-400'}`}>{m.team2}</span>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div></Collapse>
              </div>
            );
          })()}

          {/* 大学リーグ順位表 */}
          {WORLD_DATA.initialized && (() => {
            // 大学モード: ユーザーリーグの順位をWORLD_DATAに同期（simulateUniversityLeagueDateはユーザーリーグをスキップするため）
            // springStandings != null = recordGameResultが秋季初試合でリセット済み → 実際に秋季が始まっている
            if (isUniversity && seasonData.standings?.length > 0) {
              const uniInfo = WORLD_DATA.universityLeague;
              const userRegionId = uniInfo?.userRegion;
              const userDiv = uniInfo?.userDivision || 1;
              const hasDivisions = (uniInfo?.numDivisions || 1) >= 2;
              const league = WORLD_DATA.universityLeagues?.[userRegionId];
              if (league) {
                const isAutumnStarted = seasonData.springStandings != null;
                const seasonKey = isAutumnStarted ? 'fall' : 'spring';
                const seasonObj = league[seasonKey];
                if (seasonObj) {
                  const rows = seasonData.standings.map(s => ({
                    team: s.team, wins: s.wins || 0, losses: s.losses || 0,
                    draws: s.draws || 0, winRate: s.winRate || 0, gamesPlayed: s.gamesPlayed || 0,
                  }));
                  if (hasDivisions) {
                    seasonObj[`standings${userDiv}`] = rows;
                  } else {
                    seasonObj.standings = rows;
                  }
                  seasonObj.done = seasonData.phase === 'off_season';
                  if (isAutumnStarted) {
                    if (league.spring) league.spring.done = true;
                    seasonObj._active = true;
                  }
                }
              }
            }
            const uniLeagues = getAllUniversityLeagues();
            if (uniLeagues.length === 0) return null;
            const activeLeagues = uniLeagues.filter(l => l.playedGames > 0 || l.currentSeason !== '終了');
            if (activeLeagues.length === 0 && !uniLeagues.some(l => l.springDone || l.fallDone)) return null;
            return (
              <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl p-3 shadow-xl border border-blue-700/30 mt-3">
                <h2
                  className="text-sm font-bold text-blue-400 mb-2 flex items-center gap-1.5 cursor-pointer select-none"
                  onClick={() => setShowUniversityLeagues(prev => !prev)}
                >
                  <span>🎓</span> 大学リーグ
                  <span className="text-xs text-gray-400 ml-1">({uniLeagues.length}リーグ)</span>
                  <span className="text-xs text-gray-400 ml-auto">{showUniversityLeagues ? '▲' : '▼'}</span>
                </h2>
                <Collapse open={showUniversityLeagues}><div className="space-y-1">
                  {uniLeagues.map(league => {
                    const isExpanded = expandedUniLeagues[league.id] || false;
                    const toggleLeague = () => setExpandedUniLeagues(prev => ({ ...prev, [league.id]: !prev[league.id] }));
                    const renderStandingsRow = (s, i) => {
                      const wr = (s.wins + s.losses) > 0 ? (s.wins / (s.wins + s.losses)).toFixed(3) : '.000';
                      return (
                        <div key={s.team} className="flex items-center text-xs gap-1">
                          <span className={`w-4 text-center font-bold ${i === 0 ? 'text-yellow-400' : 'text-gray-400'}`}>{i + 1}</span>
                          <span className="flex-1 text-gray-200 truncate">{s.team}</span>
                          <span className="text-green-400 w-5 text-right">{s.wins}</span>
                          <span className="text-gray-400">-</span>
                          <span className="text-red-400 w-5">{s.losses}</span>
                          <span className="text-gray-300 w-8 text-right font-mono">{wr}</span>
                        </div>
                      );
                    };
                    return (
                      <div key={league.id} className="bg-gray-800/50 rounded-lg px-2 py-1.5 border border-gray-700/30">
                        <div
                          className="text-xs font-bold text-gray-300 flex items-center justify-between cursor-pointer select-none"
                          onClick={toggleLeague}
                        >
                          <span>{league.name}</span>
                          <span className="flex items-center gap-2">
                            <span className="text-xs text-blue-400/70">{league.currentSeason}</span>
                            <span className="text-xs text-gray-400">{league.playedGames}/{league.totalGames}</span>
                            <span className="text-xs text-gray-400">{isExpanded ? '▲' : '▼'}</span>
                          </span>
                        </div>
                        <Collapse open={isExpanded}><div className="mt-1 space-y-0.5">
                          {league.divisions ? (
                            <div className="space-y-1.5">
                              {Array.from({ length: league.numDivisions || 2 }, (_, d) => {
                                const divKey = `div${d + 1}`;
                                const divLabel = `${d + 1}部`;
                                const divColor = d === 0 ? 'text-blue-400/60' : 'text-gray-400';
                                return (
                                  <div key={divKey}>
                                    <div className={`text-xs ${divColor} font-bold mb-0.5`}>{divLabel}</div>
                                    <div className="space-y-0.5">
                                      {(league.standings[divKey] || []).map((s, i) => renderStandingsRow(s, i))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              {(Array.isArray(league.standings) ? league.standings : []).map((s, i) => renderStandingsRow(s, i))}
                            </div>
                          )}
                        </div></Collapse>
                      </div>
                    );
                  })}
                </div></Collapse>
              </div>
            );
          })()}

          {/* 社会人トーナメント（全非社会人モード: 折りたたみ式・トーナメント表付き） */}
          {!isCorporate && WORLD_DATA.initialized && (() => {
            const corpToshi = WORLD_DATA.corporateToshitaikou;
            const corpNS = WORLD_DATA.corporateNihonSenshuken;
            const corpCS = WORLD_DATA.corporateClubSenshuken;
            const corpRT = WORLD_DATA.corporateRegionalTournament;
            if (!corpToshi?.generated && !corpNS?.generated && !corpCS?.generated && !corpRT?.generated) return null;

            const thColors = { yellow: 'text-yellow-400', red: 'text-red-400', green: 'text-green-400', purple: 'text-purple-400' };
            const bgColors = { yellow: 'bg-yellow-900/20 border-yellow-700/30', red: 'bg-red-900/20 border-red-700/30', green: 'bg-green-900/20 border-green-700/30', purple: 'bg-purple-900/20 border-purple-700/30' };

            // トーナメント表レンダラー（大学モード向け・観戦のみ）
            const renderUniCorpBracket = (key, data) => {
              if (key === 'rt') {
                const brackets = data.brackets || {};
                const regionIds = Object.keys(brackets);
                if (regionIds.length === 0) return null;
                const activeId = (uniRtRegionTab && brackets[uniRtRegionTab]) ? uniRtRegionTab : regionIds[0];
                const active = brackets[activeId];
                return (
                  <div>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {regionIds.map(rid => {
                        const r = brackets[rid];
                        return (
                          <button key={rid} onClick={() => setUniRtRegionTab(rid)}
                            className={`px-1.5 py-0.5 rounded text-xs font-bold transition ${rid === activeId ? 'seg-on' : r.champion ? 'seg opacity-60' : 'seg'}`}>
                            {r.regionName}{r.champion ? '✓' : ''}
                          </button>
                        );
                      })}
                    </div>
                    {active?.bracket
                      ? renderBracketWithLines(active.bracket, active.teamDefsMap)
                      : <div className="text-xs text-gray-400 text-center py-2">ブラケット未生成</div>
                    }
                  </div>
                );
              }
              if (key === 'toshi') {
                const mt = data.mainTournament;
                if (mt?.bracket) {
                  return (
                    <div>
                      {data.mainDone && data.champion && <div className="text-xs text-yellow-300 font-bold text-center mb-1">🏆 優勝: {data.champion}{data.runnerUp ? ` / 準優勝: ${data.runnerUp}` : ''}</div>}
                      {renderBracketWithLines(mt.bracket, mt.teamDefsMap)}
                    </div>
                  );
                }
                // 本戦未開始 → 最初の予選を表示
                const qualifiers = data.qualifiers || {};
                const firstQId = Object.keys(qualifiers)[0];
                const firstQ = qualifiers[firstQId];
                if (firstQ?.mainBracket) {
                  return (
                    <div>
                      <div className="text-xs text-gray-300 mb-1">{firstQ.regionName} 地区予選（他地域省略）</div>
                      {renderBracketWithLines(firstQ.mainBracket, firstQ.teamDefsMap)}
                    </div>
                  );
                }
                return <div className="text-xs text-gray-400 text-center py-2">予選進行中</div>;
              }
              if (key === 'ns' || key === 'cs') {
                const mt = data.mainTournament;
                const color = key === 'ns' ? 'text-red-300' : 'text-purple-300';
                if (mt?.bracket) {
                  return (
                    <div>
                      {data.done && data.champion && <div className={`text-xs ${color} font-bold text-center mb-1`}>🏆 優勝: {data.champion}{data.runnerUp ? ` / 準優勝: ${data.runnerUp}` : ''}</div>}
                      {renderBracketWithLines(mt.bracket, mt.teamDefsMap)}
                    </div>
                  );
                }
                return <div className="text-xs text-gray-400 text-center py-2">予選進行中（本戦ブラケット未生成）</div>;
              }
              return null;
            };

            const tournamentList = [];
            if (corpRT?.generated) {
              const champions = [];
              for (const rid of Object.keys(corpRT.brackets || {})) {
                const r = corpRT.brackets[rid];
                if (r?.champion) champions.push({ region: r.regionName, team: r.champion });
              }
              const inProgressCount = Object.keys(corpRT.brackets || {}).length - champions.length;
              const status = inProgressCount > 0 ? `${inProgressCount}地域 進行中` : null;
              tournamentList.push({ key: 'rt', label: '地域トーナメント', color: 'green', champions, status, data: corpRT });
            }
            if (corpToshi?.generated) {
              const status = corpToshi.mainDone ? null : !corpToshi.qualifiersDone ? '予選中' : corpToshi.mainTournament ? '本戦中' : '本戦 準備中';
              tournamentList.push({ key: 'toshi', label: '都市対抗', color: 'yellow', champion: corpToshi.mainDone ? corpToshi.champion : null, runnerUp: corpToshi.mainDone ? corpToshi.runnerUp : null, status, data: corpToshi });
            }
            if (corpNS?.generated) {
              const status = corpNS.done ? null : corpNS.phase === 'main' ? '本戦中' : '予選中';
              tournamentList.push({ key: 'ns', label: '日本選手権', color: 'red', champion: corpNS.done ? corpNS.champion : null, runnerUp: corpNS.done ? corpNS.runnerUp : null, status, data: corpNS });
            }
            if (corpCS?.generated) {
              const status = corpCS.done ? null : corpCS.phase === 'main' ? '本戦中' : '予選中';
              tournamentList.push({ key: 'cs', label: 'クラブ選手権', color: 'purple', champion: corpCS.done ? corpCS.champion : null, runnerUp: corpCS.done ? corpCS.runnerUp : null, status, data: corpCS });
            }
            if (tournamentList.length === 0) return null;

            return (
              <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl p-3 shadow-xl border border-yellow-700/30 mt-3">
                <h2
                  className="text-sm font-bold text-yellow-400 flex items-center gap-1.5 cursor-pointer select-none"
                  onClick={() => setShowCorporateTournaments(prev => !prev)}
                >
                  <span>🏢</span> 社会人トーナメント
                  <span className="text-xs text-gray-400 ml-auto">{showCorporateTournaments ? '▲' : '▼'}</span>
                </h2>
                <Collapse open={showCorporateTournaments}><div className="space-y-1.5 mt-2">
                  {tournamentList.map((t) => {
                    const isExpanded = expandedCorpTournaments[t.key] || false;
                    return (
                      <div key={t.key} className={`rounded-lg border ${bgColors[t.color]}`}>
                        {/* ヘッダー行（クリックでトーナメント表開閉） */}
                        <div
                          className="px-2 py-1.5 flex items-center gap-1 cursor-pointer select-none"
                          onClick={() => setExpandedCorpTournaments(prev => ({ ...prev, [t.key]: !prev[t.key] }))}
                        >
                          <span className={`text-xs font-bold ${thColors[t.color]}`}>{t.champion || (t.champions?.length > 0 && !t.status) ? '🏆' : '⚾'} {t.label}</span>
                          {t.status && <span className="text-xs text-gray-400 font-normal ml-1">{t.status}</span>}
                          <span className="text-xs text-gray-400 ml-auto">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                        {/* 結果サマリー */}
                        <div className="px-2 pb-1.5">
                          {t.champions ? (
                            <div className="flex flex-wrap gap-x-2">
                              {t.champions.map((c, ci) => (
                                <span key={ci} className="text-xs"><span className="text-gray-400">{c.region}:</span> <span className="text-gray-200">{c.team}</span></span>
                              ))}
                              {t.champions.length === 0 && <span className="text-xs text-gray-400">開催中...</span>}
                            </div>
                          ) : t.champion ? (
                            <div className="text-xs text-gray-300">
                              <span className={`${thColors[t.color]} font-bold`}>優勝: {t.champion}</span>
                              {t.runnerUp && <span className="text-gray-400 ml-2">準優勝: {t.runnerUp}</span>}
                            </div>
                          ) : (
                            <div className="text-xs text-gray-400">開催中...</div>
                          )}
                        </div>
                        {/* トーナメント表（展開時） */}
                        <Collapse open={isExpanded}>
                          <div className="px-2 pb-2 border-t border-gray-700/40 pt-2">
                            {renderUniCorpBracket(t.key, t.data)}
                          </div>
                        </Collapse>
                      </div>
                    );
                  })}
                </div></Collapse>
              </div>
            );
          })()}
        </div>
      </div>

      {/* トーナメント試合モーダル */}
      {showTournamentMatchModal && (() => {
        const tm = showTournamentMatchModal;
        const oppName = tm.match.team1 === userTeamName ? tm.match.team2 : tm.match.team1;
        const isNsType = tm.bracketType === 'nihon_senshuken' || tm.bracketType === 'nihon_senshuken_qualifier' || tm.bracketType === 'nihon_senshuken_qualifier_losers';
        const isCsType = tm.bracketType === 'club_senshuken' || tm.bracketType === 'club_senshuken_qualifier' || tm.bracketType === 'club_senshuken_qualifier_losers';
        const isRtType = tm.bracketType === 'regional_tournament';
        const isUcType = tm.type === 'university_championship';
        const isMjType = tm.type === 'meiji_jingu';
        const isQualifier = tm.type === 'qualifier' || tm.type === 'nihon_senshuken_qualifier';
        const td = seasonData.toshitaikou;
        const ns = seasonData.nihonSenshuken;
        const cs = seasonData.clubSenshuken;
        const rt = seasonData.regionalTournament;
        let oppDef, bracket, modalTitle, modalSubtitle;

        if (isUcType || isMjType) {
          const source = isUcType ? seasonData.universityChampionship : seasonData.meijiJingu;
          oppDef = source?.teamDefsMap?.[oppName];
          bracket = source?.bracket;
          modalTitle = isUcType ? '全日本大学野球選手権大会' : '明治神宮野球大会';
          const roundName = bracket ? getRoundName(bracket, tm.roundIdx) : '';
          modalSubtitle = roundName;
        } else if (isRtType) {
          const region = rt?.brackets?.[tm.regionId];
          oppDef = region?.teamDefsMap?.[oppName];
          bracket = region?.bracket;
          modalTitle = '地域トーナメント';
          const roundName = bracket ? getRoundName(bracket, tm.roundIdx) : '';
          modalSubtitle = `${region?.regionName || ''} - ${roundName}`;
        } else if (isNsType || isCsType) {
          const source = isCsType ? cs : ns;
          const srcQ = source?.qualifiers?.[tm.regionId];
          const mainBt = isCsType ? 'club_senshuken' : 'nihon_senshuken';
          if (tm.bracketType === mainBt) {
            oppDef = source?.mainTournament?.teamDefsMap?.[oppName];
            bracket = source?.mainTournament?.bracket;
          } else if (tm.bracketType.includes('losers')) {
            oppDef = srcQ?.teamDefsMap?.[oppName];
            bracket = srcQ?.losersBracket;
          } else {
            oppDef = srcQ?.teamDefsMap?.[oppName];
            bracket = srcQ?.mainBracket;
          }
          modalTitle = isCsType ? '全日本クラブ野球選手権' : '日本選手権大会';
          const roundName = bracket ? getRoundName(bracket, tm.roundIdx) : '';
          if (tm.bracketType === mainBt) {
            modalSubtitle = `本戦 - ${roundName}`;
          } else {
            modalSubtitle = `地区予選 ${srcQ?.regionName || ''}${tm.bracketType.includes('losers') ? ' 敗者復活' : ''} - ${roundName}`;
          }
        } else {
          const isTdQualifier = tm.type === 'qualifier';
          oppDef = isTdQualifier
            ? td?.qualifiers?.[tm.regionId]?.teamDefsMap?.[oppName]
            : td?.mainTournament?.teamDefsMap?.[oppName];
          bracket = isTdQualifier
            ? (tm.bracketType === 'losers' ? td?.qualifiers?.[tm.regionId]?.losersBracket : td?.qualifiers?.[tm.regionId]?.mainBracket)
            : td?.mainTournament?.bracket;
          modalTitle = '都市対抗野球大会';
          const roundName = bracket ? getRoundName(bracket, tm.roundIdx) : '';
          modalSubtitle = isTdQualifier ? `地区予選 ${td?.qualifiers?.[tm.regionId]?.regionName}${tm.bracketType === 'losers' ? ' 敗者復活' : ''} - ${roundName}` : `本戦 - ${roundName}`;
        }

        const titleColor = (isUcType || isMjType) ? 'text-blue-400' : isRtType ? 'text-green-400' : isCsType ? 'text-purple-400' : isNsType ? 'text-red-400' : 'text-yellow-400';

        const handleTournamentChoice = (choice) => {
          setShowTournamentMatchModal(null);
          if (choice === 'manage') {
            startTournamentMatch(oppName, oppDef, {
              regionId: tm.regionId || null,
              roundIdx: tm.roundIdx,
              matchIdx: tm.matchIdx,
              bracketType: tm.bracketType,
            });
          } else {
            if (isUcType || isMjType) {
              const dataKey = isUcType ? 'universityChampionship' : 'meijiJingu';
              const srcData = { ...seasonData[dataKey] };
              if (srcData.bracket && srcData.teamDefsMap) {
                const def1 = srcData.teamDefsMap[tm.match.team1];
                const def2 = srcData.teamDefsMap[tm.match.team2];
                if (def1 && def2) {
                  const result = simulateQuickMatch(def1, def2);
                  recordTournamentResult(srcData.bracket, tm.roundIdx, tm.matchIdx, result.winner, result.score);
                }
              }
              setSeasonData(prev => ({ ...prev, [dataKey]: srcData }));
            } else if (isRtType) {
              const rtData = { ...seasonData.regionalTournament };
              const region = rtData.brackets?.[tm.regionId];
              if (region) {
                const def1 = region.teamDefsMap[tm.match.team1];
                const def2 = region.teamDefsMap[tm.match.team2];
                if (def1 && def2) {
                  const result = simulateQuickMatch(def1, def2);
                  recordTournamentResult(region.bracket, tm.roundIdx, tm.matchIdx, result.winner, result.score);
                }
              }
              setSeasonData(prev => ({ ...prev, regionalTournament: rtData }));
            } else if (isNsType || isCsType) {
              const dataKey = isCsType ? 'clubSenshuken' : 'nihonSenshuken';
              const srcData = { ...seasonData[dataKey] };
              const mainBt = isCsType ? 'club_senshuken' : 'nihon_senshuken';
              let targetBracket, teamDefsMap;
              if (tm.bracketType === mainBt) {
                targetBracket = srcData.mainTournament?.bracket;
                teamDefsMap = srcData.mainTournament?.teamDefsMap;
              } else if (tm.bracketType.includes('losers')) {
                targetBracket = srcData.qualifiers?.[tm.regionId]?.losersBracket;
                teamDefsMap = srcData.qualifiers?.[tm.regionId]?.teamDefsMap;
              } else {
                targetBracket = srcData.qualifiers?.[tm.regionId]?.mainBracket;
                teamDefsMap = srcData.qualifiers?.[tm.regionId]?.teamDefsMap;
              }
              if (targetBracket && teamDefsMap) {
                const def1 = teamDefsMap[tm.match.team1];
                const def2 = teamDefsMap[tm.match.team2];
                if (def1 && def2) {
                  const result = simulateQuickMatch(def1, def2);
                  recordTournamentResult(targetBracket, tm.roundIdx, tm.matchIdx, result.winner, result.score);
                }
              }
              setSeasonData(prev => ({ ...prev, [dataKey]: srcData }));
            } else {
              const td = { ...seasonData.toshitaikou };
              if (tm.type === 'qualifier' && tm.regionId) {
                const q = td.qualifiers[tm.regionId];
                if (q) {
                  const targetBracket = tm.bracketType === 'losers' ? q.losersBracket : q.mainBracket;
                  const def1 = q.teamDefsMap[tm.match.team1];
                  const def2 = q.teamDefsMap[tm.match.team2];
                  if (targetBracket && def1 && def2) {
                    const result = simulateQuickMatch(def1, def2);
                    recordTournamentResult(targetBracket, tm.roundIdx, tm.matchIdx, result.winner, result.score);
                  }
                }
              } else if (tm.type === 'main' && td.mainTournament) {
                const mt = td.mainTournament;
                const def1 = mt.teamDefsMap[tm.match.team1];
                const def2 = mt.teamDefsMap[tm.match.team2];
                if (def1 && def2) {
                  const result = simulateQuickMatch(def1, def2);
                  recordTournamentResult(mt.bracket, tm.roundIdx, tm.matchIdx, result.winner, result.score);
                }
              }
              setSeasonData(prev => ({ ...prev, toshitaikou: td }));
            }
            executeSkipDay(1);
          }
        };

        return <PreGameModal
          seasonData={seasonData}
          userTeamName={userTeamName}
          formatDate={formatDate}
          getStartingPitcher={getStartingPitcher}
          handleGameChoice={handleTournamentChoice}
          setShowGameChoiceModal={() => setShowTournamentMatchModal(null)}
          tournamentInfo={{
            opponentName: oppName,
            title: modalTitle,
            subtitle: modalSubtitle,
            titleColor,
          }}
        />;
      })()}

      {/* スポーツ新聞モーダル */}
      {showNewspaper && newspaperData && (
        <NewspaperModal data={newspaperData} seasonData={seasonData} onClose={() => setShowNewspaper(false)} />
      )}

      {/* 試合選択モーダル */}
      {showGameChoiceModal && <PreGameModal
        seasonData={seasonData}
        userTeamName={userTeamName}
        formatDate={formatDate}
        getStartingPitcher={getStartingPitcher}
        handleGameChoice={handleGameChoice}
        setShowGameChoiceModal={setShowGameChoiceModal}
      />}

      {/* 夏の甲子園の結果。操作はできないが、ここで見た選手がスカウト・ドラフトに繋がる */}
      <KoshienNoticeModal
        notice={koshienNotice}
        year={year}
        gameYear={seasonData?.settings?.year || 1}
        watchTick={watchTick}
        onClose={() => setKoshienNotice(null)}
        onWatchChange={() => setWatchTick(t => t + 1)} />
      {/* フェーズ移行確認モーダル */}
      <PhaseTransitionModal
        event={pendingPhaseEvent}
        onClose={() => setPendingPhaseEvent(null)}
        onProceed={(evt) => {
          setPendingPhaseEvent(null);
          setSeasonData(prev => (prev?.pendingPhaseEvent ? { ...prev, pendingPhaseEvent: null } : prev));
          if (onForceEvent) onForceEvent(evt);
        }} />
      {devToolsEnabled && (
        <div data-testid="dev-advance" className="fixed bottom-3 right-3 z-40 rounded-xl border border-amber-500/40 bg-gray-900/90 px-3 py-2 text-xs text-amber-200 shadow-lg">
          <div className="mb-1 font-bold">開発用の早送り</div>
          {devLeft > 0 ? (
            <div className="flex items-center gap-2">
              <span className="tabular-nums">残り{devLeft}日</span>
              <button onClick={() => setDevLeft(0)} className="rounded bg-gray-700 px-2 py-1 hover:bg-gray-600">止める</button>
            </div>
          ) : (
            <div className="flex gap-1">
              {[7, 30].map(n => (
                <button key={n} data-testid={`dev-advance-${n}`} onClick={() => startDevAdvance(n)} disabled={isSimulating}
                  className="rounded bg-gray-700 px-2 py-1 hover:bg-gray-600">{n}日</button>
              ))}
              <button data-testid="dev-advance-phase" onClick={() => startDevAdvance(400)} disabled={isSimulating}
                title="フェーズ移行・大会の試合のどちらかが出るまで進める"
                className="rounded bg-amber-700 px-2 py-1 hover:bg-amber-600">次の区切りまで</button>
            </div>
          )}
        </div>
      )}
    </ScreenShell>
  );
};

const DateProgressScreen = (props) => props.seasonData
  ? <DateProgressContent {...props} />
  : <div className="p-8 text-white">読み込み中...</div>;

export default DateProgressScreen;
