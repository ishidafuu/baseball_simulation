import React from 'react';
import { TEAMS_DATA, initializeAllPitchingRotations } from '../teams-data.js';
import { applyNextSeasonRegulations } from '../season/nextSeasonRegulations.js';
import { withDeparted, rosterIndex, departedSince } from '../season/departedStats.js';
import { progressDate } from '../season/dateProgression.js';
import { generateOptimalLineup, generatePitchingRotation, generateAllTeamsLineup } from '../game/lineupGenerator.js';
import { openSoloSeason, soloSeasonEndFreeze } from '../season/soloSeasonSteps.js';
import { processNPBDraft } from '../season/npbDraft.js';
import { withoutTryoutDraft } from '../season/tryoutDraftState.js';

import TryoutScreen from './TryoutScreen.jsx';
import ContractScreen from './ContractScreen.jsx';
import DraftResultScreen from './DraftResultScreen.jsx';
import RosterScreen from './RosterScreen.jsx';
import TeamInfoScreen from './TeamInfoScreen.jsx';
import TradeScreen from './TradeScreen.jsx';
import DateProgressScreen from './DateProgressScreen.jsx';
import OffSeasonScreen from './OffSeasonScreen.jsx';
import RegulationsScreen from './RegulationsScreen.jsx';
import SandboxSetupScreen from './SandboxSetupScreen.jsx';
import CampScreen from './CampScreen.jsx';
import JerseyNumberScreen from './JerseyNumberScreen.jsx';
import PlayerStatsScreen from './PlayerStatsScreen.jsx';
import HallOfFameScreen from './HallOfFameScreen.jsx';
import SaveLoadScreen from './SaveLoadScreen.jsx';
import EditScreen from './EditScreen.jsx';
import { ToshitaikouQualifierScreen, ToshitaikouMainScreen } from './ToshitaikouScreen.jsx';
import CorporateDepartureScreen from './CorporateDepartureScreen.jsx';
import AbilityRankingScreen from './AbilityRankingScreen.jsx';
import CorporateScoutScreen from './CorporateScoutScreen.jsx';
import CorporateManagementScreen from './CorporateManagementScreen.jsx';
import ClubRecruitScreen from './ClubRecruitScreen.jsx';
import BudgetSettlementScreen from './BudgetSettlementScreen.jsx';
import UniversityScoutScreen from './UniversityScoutScreen.jsx';
import PlayerSearchScreen from './PlayerSearchScreen.jsx';
import TeamRankingScreen from './TeamRankingScreen.jsx';

const ManagementScreen = ({
  managementView,
  setManagementView,
  resumeViewRef,
  seasonData,
  setSeasonData,
  setSelectedMonth,
  userTeamName,
  allTeams,
  gameMode,
  setGameMode,
  setLeagueConfig,
  hallOfFamePlayers,
  setHallOfFamePlayers,
  teamHistory,
  setTeamHistory,
  draftResults,
  setDraftResults,
  saveSlots,
  saveGame,
  loadGame,
  loadAutosave,
  deleteSave,
  refreshSaveSlots,
  setupManagedGame,
  setScreenMode,
  setGameFlowState
}) => {
  const draftedIds = seasonData?.draftedPlayerIds || [];
  if (managementView === 'tryout') return <TryoutScreen
    seasonData={seasonData}
    setSeasonData={setSeasonData}
    allTeams={allTeams}
    initializeAllPitchingRotations={initializeAllPitchingRotations}
    onSave={saveGame}
    saveSlots={saveSlots}
    onComplete={() => {
      // 途中の状態の写し（tryoutDraft）は終えたら外す（`tryoutDraftState.js`）
      const newData = { ...withoutTryoutDraft(seasonData), currentDate: { ...seasonData.currentDate, month: 11, day: 11 }, phase: 'off_season' };
      setSeasonData(newData);
      setManagementView('dateprogress');
    }}
  />;
  if (managementView === 'contract') return <ContractScreen
    seasonData={seasonData}
    allTeams={allTeams}
    onComplete={(departed) => {
      // ⚠ 戦力外で外した選手のその年の成績を残す（選手成績の画面が年度末まで出す）
      const newData = progressDate(withDeparted(seasonData, departed), 1);
      setSeasonData({ ...newData, phase: 'tryout' });
      setManagementView('tryout');
    }}
  />;
  if (managementView === 'corporate_departure') return <CorporateDepartureScreen
    seasonData={seasonData}
    allTeams={allTeams}
    onComplete={(departed) => {
      const newData = progressDate(withDeparted(seasonData, departed), 1);
      setSeasonData({ ...newData, phase: 'tryout' });
      setManagementView(seasonData?.settings?.clubMode ? 'club_recruit' : 'corporate_scout');
    }}
  />;
  if (managementView === 'corporate_scout') return <CorporateScoutScreen
    seasonData={seasonData}
    allTeams={allTeams}
    draftedPlayerIds={draftedIds}
    onComplete={() => {
      // 完了済みスカウトミッションをクリア（翌年の派遣用にリセット）
      const ut = TEAMS_DATA[userTeamName];
      if (ut?.corporateData?.scoutMissions) {
        ut.corporateData.scoutMissions = [];
      }
      const newData = { ...seasonData, currentDate: { ...seasonData.currentDate, month: 11, day: 11 }, phase: 'off_season' };
      setSeasonData(newData);
      setManagementView('dateprogress');
    }}
  />;
  if (managementView === 'club_recruit') return <ClubRecruitScreen
    seasonData={seasonData}
    onComplete={() => {
      const newData = { ...seasonData, currentDate: { ...seasonData.currentDate, month: 11, day: 11 }, phase: 'off_season' };
      setSeasonData(newData);
      setManagementView('dateprogress');
    }}
  />;
  if (managementView === 'university_scout') {
    const isForced = seasonData.currentDate?.month === 11 && seasonData.currentDate?.day >= 29;
    return <UniversityScoutScreen
      seasonData={seasonData}
      onBack={!isForced ? () => setManagementView('dateprogress') : null}
      onComplete={isForced ? (result) => {
        const recommended = result?.recommended || [];
        const selection = result?.selection || [];
        const newData = {
          ...seasonData,
          currentDate: { ...seasonData.currentDate, month: 11, day: 30 },
          phase: 'off_season',
          universityRecruits: [
            ...recommended.map(p => ({ id: p.id, name: p.name, position: p.position, source: p._scoutSource, type: 'recommended' })),
            ...selection.map(p => ({ id: p.id, name: p.name, position: p.position, source: p.highSchool?.name || '高校', type: 'selection' })),
          ],
        };
        setSeasonData(newData);
        setManagementView('dateprogress');
      } : null}
    />;
  }
  if (managementView === 'budget_settlement') return <BudgetSettlementScreen
    seasonData={seasonData}
    onComplete={(penalties) => {
      const newData = {
        ...seasonData,
        phase: 'off_season',
        ...(penalties && penalties.length > 0 ? { deficitPenalties: penalties } : {}),
      };
      setSeasonData(newData);
      setManagementView('offseason');
    }}
  />;
  if (managementView === 'draft') return <DraftResultScreen
    draftedPlayers={draftResults?.draftedPlayers || []}
    nearMissPlayers={draftResults?.nearMissPlayers || []}
    proBonus={draftResults?.proBonus || []}
    draftBySource={draftResults?.draftBySource || null}
    firstRoundData={draftResults?.firstRoundData || null}
    npbStandings={draftResults?.npbStandings || null}
    userTeamName={userTeamName}
    onContinue={() => {
      if (draftResults?.draftedPlayers) {
        const ids = draftResults.draftedPlayers.map(d => d.playerId);
        setSeasonData(prev => ({ ...prev, draftedPlayerIds: ids }));
      }
      setDraftResults(null);
      setManagementView('dateprogress');
    }}
  />;
  if (managementView === 'corporate_management') return <CorporateManagementScreen
    seasonData={seasonData}
    gameMode={gameMode}
  />;
  if (managementView === 'player_search') return <PlayerSearchScreen
    onBack={() => setManagementView('dateprogress')}
    gameMode={gameMode}
    userTeamName={userTeamName}
  />;
  if (managementView === 'roster') return <RosterScreen seasonData={seasonData} gameMode={gameMode} />;
  if (managementView === 'teaminfo') return <TeamInfoScreen gameMode={gameMode} />;
  if (managementView === 'trade') return <TradeScreen
    userTeamName={userTeamName}
    seasonData={seasonData}
    onBack={() => setManagementView('dateprogress')}
  />;
  if (managementView === 'dateprogress') return <DateProgressScreen
    seasonData={seasonData}
    setSeasonData={setSeasonData}
    onSetupManagedGame={setupManagedGame}
    onForceEvent={(eventType) => {
      if (gameMode === 'sandbox' && (eventType === 'contract' || eventType === 'tryout' || eventType === 'draft' || eventType === 'corporate_departure' || eventType === 'corporate_scout' || eventType === 'club_recruit' || eventType === 'budget_settlement' || eventType === 'university_scout')) {
        const update = soloSeasonEndFreeze(seasonData);
        if (Object.keys(update).length > 0) setSeasonData(prev => ({ ...prev, ...update }));
        setManagementView('offseason');
        return;
      }
      if (eventType === 'contract') setManagementView('contract');
      else if (eventType === 'corporate_departure') setManagementView('corporate_departure');
      else if (eventType === 'corporate_scout') setManagementView('corporate_scout');
      else if (eventType === 'club_recruit') setManagementView('club_recruit');
      else if (eventType === 'university_scout') setManagementView('university_scout');
      else if (eventType === 'summer_camp') setManagementView('summer_camp');
      else if (eventType === 'budget_settlement') setManagementView('budget_settlement');
      else if (eventType === 'tryout') setManagementView('tryout');
      else if (eventType === 'draft') {
        // プロ指名で選手が消える前にランキング・表彰を確定する
        const preUpdate = soloSeasonEndFreeze(seasonData);
        // ⚠ 指名で名簿から抜ける社会人・独立・大学の選手の、その年の成績を写しておく
        //    （選手成績の画面が年度末まで出す。`departedStats.js`）
        const rosterBefore = rosterIndex(TEAMS_DATA);
        const results = processNPBDraft(TEAMS_DATA, seasonData.year);
        const departed = departedSince(rosterBefore, TEAMS_DATA);
        setSeasonData(prev => withDeparted({ ...prev, ...preUpdate }, departed));
        setDraftResults(results);
        // 大学モード: ドラフト指名された大学チーム選手をseasonDataに記録
        if (seasonData.settings?.universityMode && results.draftedPlayers.length > 0) {
          const uniTeamNames = new Set(seasonData.settings.teamNames || []);
          const uniDrafted = results.draftedPlayers
            .filter(d => uniTeamNames.has(d.teamName) || d.source === 'university_team')
            .map(d => ({ name: d.name, team: d.teamName, position: d.position, npbTeam: d.npbTeam, draftRound: d.draftRound }));
          if (uniDrafted.length > 0) {
            setSeasonData(prev => ({ ...prev, universityNpbDrafted: uniDrafted }));
          }
        }
        if (results.draftedPlayers.length > 0) {
          setHallOfFamePlayers(prev => [...prev, ...results.draftedPlayers.map(d => {
            const p = d.player;
            const draftStats = p ? {
              batting: p.batting ? { meet: p.batting.meet, power: p.batting.power, eye: p.batting.eye, steal: p.batting.steal } : null,
              physical: p.physical ? { speed: p.physical.speed, arm: p.physical.arm } : null,
              fielding: p.fielding ? { defense: p.fielding.defense } : null,
              pitching: p.pitching ? { velocity: p.pitching.velocity, control: p.pitching.control, stamina: p.pitching.stamina, arsenal: p.pitching.arsenal ? JSON.parse(JSON.stringify(p.pitching.arsenal)) : null } : null,
              positionFitness: p.positionFitness ? JSON.parse(JSON.stringify(p.positionFitness)) : null,
              traits: p.traits ? [...p.traits] : null
            } : null;
            return {
              name: d.name,
              position: d.position,
              teamName: d.teamName,
              departureType: 'npb_drafted',
              npbTeam: d.npbTeam,
              draftRound: d.draftRound,
              hallOfFame: d.hallOfFame || false,
              hofReason: d.hofReason,
              reason: `NPBドラフト指名 (${d.npbTeam})`,
              careerStats: d.careerStats,
              draftStats,
              throws: p?.physical?.throws || 'right',
              bats: p?.batting?.bats || 'right',
              age: d.age,
              yearsPlayed: d.yearsPlayed,
              year: seasonData?.year,
              source: d.source || null,
              draftInfo: p?.draftInfo || null
            };
          })]);
        }
        setManagementView('draft');
      }
      else if (eventType === 'offseason') {
        const update = soloSeasonEndFreeze(seasonData);
        if (Object.keys(update).length > 0) setSeasonData(prev => ({ ...prev, ...update }));
        setManagementView('offseason');
      }
    }}
  />;
  if (managementView === 'offseason') return <OffSeasonScreen
    seasonData={seasonData}
    setSeasonData={setSeasonData}
    gameMode={gameMode}
    setGameMode={setGameMode}
    setLeagueConfig={setLeagueConfig}
    setSelectedMonth={setSelectedMonth}
    userTeamName={userTeamName}
    onSave={async (slotIndex) => { await saveGame(slotIndex); }}
    saveSlots={saveSlots}
    // ⚠ 年度更新（advanceToNextYear）の直後に、同じ操作の中から呼ばれる。この画面が持つ
    //    `seasonData` はまだ前の年なので、翌年のデータは引数で受け取る（大学の卒業レポートを
    //    挟むときは描き直した後に呼ばれるので引数なし）。以前はクラブの2年目の開幕が
    //    前の年の 2024/4/1 になり、地域トーナメントのシードも前の年のものを使っていた
    onStartNextSeason={(nextSeasonData) => {
      const next = nextSeasonData || seasonData;
      if (gameMode === 'sandbox') {
        setManagementView('sandbox_next_regulations');
      } else if (gameMode === 'university' || gameMode === 'corporate') {
        if (next?.settings?.clubMode) {
          // クラブチームはキャンプなし → 直接シーズンへ
          const opening = openSoloSeason({
            userTeamName, year: next?.year, preserveUserLineup: true, snapshotYear: next.year,
            regional: { seeds: next?.tournamentSeeds },
          });
          setSeasonData(prev => ({ ...prev, ...opening }));
          setSelectedMonth(4);
          setManagementView('dateprogress');
        } else {
          setManagementView('camp');
        }
      } else {
        setManagementView('regulations_next');
      }
    }}
    onAddHallOfFamePlayers={(newPlayers) => {
      setHallOfFamePlayers(prev => [...prev, ...newPlayers]);
    }}
    onRecordTeamHistory={(historyEntry) => {
      setTeamHistory(prev => [...prev, historyEntry]);
    }}
  />;
  if (managementView === 'sandbox_next_regulations') return <RegulationsScreen
    seasonData={seasonData}
    setSeasonData={setSeasonData}
    currentTeams={allTeams}
    confirmLabel="確定 → チーム設定へ進む"
    onConfirm={(confirmedSettings) => {
      applyNextSeasonRegulations({
        confirmedSettings, seasonData, currentTeams: allTeams, setSeasonData, setLeagueConfig, generatePitchingRotation,
        setManagementView, nextView: 'sandbox_setup',
      });
    }}
  />;
  if (managementView === 'sandbox_setup') return <SandboxSetupScreen
    allTeams={allTeams}
    generateOptimalLineup={generateOptimalLineup}
    generatePitchingRotation={generatePitchingRotation}
    generateAllTeamsLineup={() => generateAllTeamsLineup(allTeams)}
    onComplete={() => {
      const opening = openSoloSeason({
        userTeamName, year: seasonData.year, preserveUserLineup: true, snapshotYear: seasonData.year,
      });
      setSeasonData(prev => ({ ...prev, ...opening }));
      setSelectedMonth(4);
      setManagementView('dateprogress');
    }}
  />;
  if (managementView === 'regulations_next') return <RegulationsScreen
    seasonData={seasonData}
    setSeasonData={setSeasonData}
    currentTeams={allTeams}
    onConfirm={(confirmedSettings) => {
      applyNextSeasonRegulations({
        confirmedSettings, seasonData, currentTeams: allTeams, setSeasonData, setLeagueConfig, generatePitchingRotation,
        setManagementView, nextView: 'camp',
      });
    }}
  />;
  if (managementView === 'summer_camp') return <CampScreen
    seasonData={seasonData}
    allTeams={allTeams}
    gameMode={gameMode}
    maxRounds={2}
    campTitle="夏季合宿"
    completeLabel="秋季リーグへ"
    onComplete={() => {
      setSeasonData(prev => ({ ...prev, summerCampDone: true }));
      setManagementView('dateprogress');
    }}
  />;
  if (managementView === 'camp') return <CampScreen
    seasonData={seasonData}
    allTeams={allTeams}
    gameMode={gameMode}
    onComplete={() => {
      // ⚠ ここだけ調子を作り直さない（写しだったときからの違い。`soloSeasonSteps.js`）
      const opening = openSoloSeason({
        userTeamName, year: seasonData.year, resetCondition: false, preserveUserLineup: true,
        snapshotYear: seasonData.year,
      });
      setSeasonData(prev => ({ ...prev, ...opening }));
      setSelectedMonth(4);
      setManagementView('jersey'); // シーズン開始直前に背番号設定
    }}
  />;
  if (managementView === 'jersey') return <JerseyNumberScreen
    userTeamName={userTeamName}
    seasonData={seasonData}
    onComplete={() => setManagementView('dateprogress')}
  />;
  if (managementView === 'stats') return <PlayerStatsScreen
    seasonData={seasonData}
    allTeams={allTeams}
    userTeamName={userTeamName}
  />;
  if (managementView === 'ranking') return <AbilityRankingScreen seasonData={seasonData} userTeamName={userTeamName} />;
  if (managementView === 'team_ranking') return <TeamRankingScreen
    userTeamName={userTeamName}
    gameMode={gameMode}
    seasonData={seasonData}
    onBack={() => setManagementView('dateprogress')}
  />;
  if (managementView === 'halloffame') return <HallOfFameScreen
    hallOfFamePlayers={hallOfFamePlayers}
    allTeams={TEAMS_DATA}
    teamHistory={teamHistory}
    seasonData={seasonData}
    onClose={() => setManagementView('dateprogress')}
  />;
  if (managementView === 'save') return <SaveLoadScreen
    onSave={saveGame}
    onLoad={loadGame}
    onLoadAutosave={loadAutosave}
    onDelete={deleteSave}
    saveSlots={saveSlots}
    seasonData={seasonData}
    onSlotsChanged={refreshSaveSlots}
    onReturnToTitle={() => {
      setScreenMode('start');
      setGameFlowState('title');
    }}
  />;
  if (managementView === 'regulations') return <RegulationsScreen
    seasonData={seasonData}
    setSeasonData={setSeasonData}
  />;
  if (managementView === 'toshitaikou_qualifier') return <ToshitaikouQualifierScreen
    toshitaikou={seasonData?.toshitaikou}
    userTeamName={userTeamName}
    onContinue={() => setManagementView('dateprogress')}
  />;
  if (managementView === 'toshitaikou_main') return <ToshitaikouMainScreen
    toshitaikou={seasonData?.toshitaikou}
    userTeamName={userTeamName}
    onContinue={() => setManagementView('dateprogress')}
  />;
  if (managementView === 'edit') return <EditScreen
    generateOptimalLineup={generateOptimalLineup}
    generatePitchingRotation={generatePitchingRotation}
    generateAllTeamsLineup={() => generateAllTeamsLineup(allTeams)}
    allTeams={allTeams}
    onOpenSave={() => setManagementView('save')}
    // ⚠ ロードしたときに戻るはずだった画面へ（規定の確定・キャンプ・背番号など）
    onBackToGame={() => setManagementView(resumeViewRef?.current || 'dateprogress')}
  />;
  return <div className="p-8 text-white">準備中...</div>;
};

export default ManagementScreen;
