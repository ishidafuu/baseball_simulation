import React from 'react';
import { RANK_LABELS, RANK_HEX } from '../utils/constants.js';
import SelectShell from './select/SelectShell.jsx';
import TeamSelectCard from './select/TeamSelectCard.jsx';
import { TEAMS_DATA, initializeAllPitchingRotations } from '../teams-data.js';
import { createSeasonData } from '../season/seasonManager.js';
import { REGULATION_PRESETS } from '../season/regulationSettings.js';
import { generateOptimalLineup, generatePitchingRotation, generateAllTeamsLineup } from '../game/lineupGenerator.js';
import { openSoloSeason } from '../season/soloSeasonSteps.js';
import { initializeCorporateGame, initializeParallelWorldForIndependent, ensureUserIndependentLeagueTagged } from '../corporate/corporateInit.js';
import { INDEPENDENT_LEAGUES } from '../corporate/independentLeagueData.js';
import { initializeWorld, WORLD_DATA } from '../corporate/worldData.js';
import { clearUniversityPool, clearHighSchoolPool } from '../season/universityPool.js';
import { initializeUniversityGame, getUniversityLeagueSchedule, getUniversityLeagueStandings } from '../university/universityInit.js';

let selectedIndependentLeague = null;

import StartScreen from './StartScreen.jsx';
import ManualScreen from './ManualScreen.jsx';
import NewGameRegulationsScreen from './NewGameRegulationsScreen.jsx';
import TryoutScreen from './TryoutScreen.jsx';
import CampScreen from './CampScreen.jsx';
import SandboxSetupScreen from './SandboxSetupScreen.jsx';
import UniversityTeamSelectScreen from './UniversitySelectScreen.jsx';
import { ModeSelectScreen, CorporateTeamSelectScreen, CorporateNameEditScreen } from './CorporateSelectScreen.jsx';
import { withoutTryoutDraft } from '../season/tryoutDraftState.js';

// ゲームフロースタート画面群
const GameFlowScreens = ({
  gameFlowState,
  setGameFlowState,
  gameMode,
  setGameMode,
  seasonData,
  setSeasonData,
  allTeams,
  userTeamName,
  hasSaveData,
  saveSlots,
  saveGame,
  loadGame,
  loadAutosave,
  initializeNewGame,
  setScreenMode,
  setManagementView,
  setSelectedMonth,
  setLeagueConfig
}) => {
  // 新しいゲームの開幕（キャンプ・チーム設定の後）。背番号の画面から始める
  const enterFirstSeason = () => {
    setSelectedMonth(4);
    setManagementView('jersey');
    setScreenMode('management');
    setGameFlowState('season');
  };
  // ⚠ 新しいゲームは自チームの打順を推奨で組み直し、能力の記録は取らない（`soloSeasonSteps.js`）
  const openFirstSeason = (regional = null) => {
    const opening = openSoloSeason({ userTeamName, year: seasonData?.year, regional });
    setSeasonData(prev => ({ ...prev, ...opening }));
    enterFirstSeason();
  };

  // TITLE: スタート画面
  if (gameFlowState === 'title') {
    return <StartScreen
      onNewGame={() => { setGameMode('normal'); setGameFlowState('newgame_mode_select'); }}
      onSandbox={() => { setGameMode('sandbox'); setGameFlowState('sandbox_regulations'); }}
      onContinue={async (slotIndex) => {
        const result = await loadGame(slotIndex);
        if (!result?.success) alert(result?.error || 'ロードに失敗しました');
        return result;
      }}
      onEdit={async (slotIndex) => {
        const result = await loadGame(slotIndex);
        if (result?.success) {
          setManagementView('edit');
        } else {
          alert(result?.error || 'ロードに失敗しました');
        }
      }}
      onEditCorporateNames={() => setGameFlowState('edit_corporate_names')}
      onManual={() => setGameFlowState('manual')}
      onContinueAutosave={async () => {
        const result = await loadAutosave();
        if (!result?.success) alert(result?.error || 'オートセーブのロードに失敗しました');
      }}
      hasSaveData={hasSaveData}
      saveSlots={saveSlots}
    />;
  }

  // MODE SELECT: 独立リーグ / 社会人野球 / 大学野球 選択
  if (gameFlowState === 'newgame_mode_select') {
    return <ModeSelectScreen
      onSelectIndependent={() => setGameFlowState('newgame_league_select')}
      onSelectCorporate={() => setGameFlowState('newgame_corporate_select')}
      onSelectUniversity={() => setGameFlowState('newgame_university_select')}
      onBack={() => setGameFlowState('title')}
    />;
  }

  // LEAGUE SELECT: どの独立リーグで遊ぶか選択
  if (gameFlowState === 'newgame_league_select') {
    const leagueList = [
      { key: 'shikoku', icon: '🏝️' },
      { key: 'bc', icon: '⚾' },
      { key: 'kyushu', icon: '🌸' },
      { key: 'hokkaido', icon: '🐻' },
      { key: 'kansai', icon: '🏯' },
    ];
    // 開始前の「表紙」なので、前後の画面（どの球界で始めるか・チーム選択）と同じ
    // 導入画面の外枠（SelectShell）とカード（`.lift-card` ＋ bg-surface-2/80）にする。
    // ⚠ ここだけ本編寄りの灰色のグラデと素のカードのままで、モード選択 → リーグ選択 →
    //    チーム選択と進むと、真ん中の1枚だけ地色と意匠が変わっていた。
    return (
      <SelectShell
        kicker="LEAGUE SELECT"
        title="リーグ選択"
        sub="プレイするリーグを選んでください。他のリーグは平行世界として同時に進行します。"
        footer={(
          <div className="text-center">
            <button onClick={() => setGameFlowState('newgame_mode_select')} className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-surface-2 text-sm transition">← 戻る</button>
          </div>
        )}
      >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {leagueList.map(({ key, icon }) => {
              const leagueDef = INDEPENDENT_LEAGUES[key];
              return (
                <button key={key}
                  onClick={() => {
                    selectedIndependentLeague = key;
                    setGameFlowState('newgame_team_select');
                  }}
                  className="lift-card w-full text-left rounded-xl p-4 border bg-surface-2/80 border-gray-700/70 hover:border-gray-500 flex flex-col"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-3xl" aria-hidden>{icon}</span>
                    <div className="text-base font-bold text-white truncate">{leagueDef?.name}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-gray-300 mt-2">
                    <span>{leagueDef?.teams?.length || 4}チーム</span>
                    <span>{leagueDef?.gamesPerSeason || 60}試合</span>
                    <span>{leagueDef?.leagueFormat === 'two' ? '2リーグ制' : '1リーグ制'}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {leagueDef?.teams?.map(t => (
                      <span key={t.id} className="text-xs text-gray-200 bg-black/30 px-1.5 py-0.5 rounded">{t.abbreviation}</span>
                    ))}
                  </div>
                </button>
              );
            })}
            <button
              onClick={() => {
                selectedIndependentLeague = null;
                setGameFlowState('newgame_regulations');
              }}
              className="lift-card w-full text-left rounded-xl p-4 border border-dashed bg-surface-2/50 border-gray-600 hover:border-gray-400 flex flex-col"
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl" aria-hidden>🛠️</span>
                <div className="min-w-0">
                  <div className="text-base font-bold text-white">リーグ作成</div>
                  <div className="text-xs text-gray-300">チーム数・試合数・ルールを自由に設定</div>
                </div>
              </div>
              <div className="flex gap-3 text-xs text-gray-300 mt-2">
                <span>カスタム設定</span>
                <span>全5リーグ平行世界あり</span>
              </div>
            </button>
          </div>
      </SelectShell>
    );
  }

  // TEAM SELECT: 既存リーグのチーム選択
  if (gameFlowState === 'newgame_team_select') {
    const leagueDef = INDEPENDENT_LEAGUES[selectedIndependentLeague];
    const teams = leagueDef?.teams || [];
    return (
      <SelectShell
        kicker="TEAM SELECT"
        title={leagueDef?.name}
        sub="監督を務めるチームを選んでください"
        footer={(
          <div className="text-center">
            <button onClick={() => setGameFlowState('newgame_league_select')} className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-surface-2 text-sm transition">← 戻る</button>
          </div>
        )}
      >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {teams.map((team) => (
              <TeamSelectCard key={team.id}
                name={team.name}
                accent={RANK_HEX[team.rank] || '#94a3b8'}
                rank={team.rank}
                rankLabel={[RANK_LABELS[team.rank], team.city].filter(Boolean).join('・')}
                onClick={() => {
                  const regulations = {
                    useDH: leagueDef.useDH || false,
                    gamesPerSeason: leagueDef.gamesPerSeason,
                    teamsCount: teams.length,
                    leagueFormat: leagueDef.leagueFormat || 'single',
                    leagueNames: leagueDef.leagueNames || null,
                    playoffFormat: leagueDef.playoffFormat || 'short',
                    maxExtraInnings: 12,
                    teamNames: teams.map(t => t.name),
                    teamAbbreviations: teams.map(t => t.abbreviation),
                    preset: selectedIndependentLeague,
                    selectedTeamIndex: teams.indexOf(team),
                  };
                  initializeNewGame(regulations);
                  setGameFlowState('independent_loading');
                  setTimeout(() => {
                    const teamNames = Object.keys(TEAMS_DATA).filter(name => {
                      const t = TEAMS_DATA[name];
                      return t && !t.corporateTeamId && !t.independentLeagueId;
                    });
                    initializeParallelWorldForIndependent(selectedIndependentLeague, teamNames);
                    // 自リーグを独立リーグの一員としてタグ付け（ランキング/トレード/注目度に含める）
                    ensureUserIndependentLeagueTagged(regulations.teamNames, selectedIndependentLeague);
                    setGameFlowState('newgame_tryout');
                  }, 50);
                }}
              />
            ))}
          </div>
      </SelectShell>
    );
  }

  // CORPORATE: 地区・チーム選択
  if (gameFlowState === 'newgame_corporate_select') {
    return <CorporateTeamSelectScreen
      onSelect={(team) => {
        setGameMode('corporate');
        setGameFlowState('corporate_loading');
        const isClubTeam = team.type === 'club';
        setTimeout(() => {
          const result = initializeCorporateGame(team);

          setLeagueConfig({
            format: 'tournament',
            teamsPerLeague: result.allTeamNames.length,
            leagues: [{ name: isClubTeam ? 'クラブ野球' : '社会人野球', teams: [result.userTeamName] }]
          });

          const newSeasonData = createSeasonData(1);
          newSeasonData.settings = {
            teamsCount: result.allTeamNames.length,
            teamNames: [result.userTeamName],
            teamAbbreviations: [result.userTeamName.slice(0, 3)],
            gamesPerSeason: 0,
            useDH: true,
            leagueFormat: 'tournament',
            corporateMode: true,
            clubMode: isClubTeam,
            corporateTeamId: team.id,
            allCorporateTeamNames: result.allTeamNames,
          };

          newSeasonData.schedule = [];
          newSeasonData.standings = [];
          setSeasonData(newSeasonData);

          if (isClubTeam) {
            // クラブチームはキャンプなし → 直接シーズンへ
            Object.assign(newSeasonData, openSoloSeason({
              userTeamName: result.userTeamName, year: newSeasonData.year, regional: { seeds: null },
            }));
            setSeasonData(newSeasonData);
            enterFirstSeason();
          } else {
            setGameFlowState('corporate_camp');
          }
        }, 50);
      }}
      onBack={() => setGameFlowState('newgame_mode_select')}
    />;
  }

  // CORPORATE: ローディング画面
  if (gameFlowState === 'corporate_loading') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">⚾</div>
          <div className="text-white text-xl font-bold mb-2">全チームを初期化中...</div>
          <div className="text-gray-300 text-sm">179チームの選手を生成しています</div>
          <div className="mt-4 w-48 h-1 bg-gray-700 rounded-full mx-auto overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{width: '60%'}}></div>
          </div>
        </div>
      </div>
    );
  }

  // CORPORATE: キャンプ
  if (gameFlowState === 'corporate_camp') {
    return <CampScreen
      seasonData={seasonData}
      allTeams={allTeams}
      // 地域トーナメントをキャンプ終了時に生成（4/1開始時に組み合わせ確定済み）
      onComplete={() => openFirstSeason({ seeds: seasonData?.tournamentSeeds })}
    />;
  }

  // UNIVERSITY: リーグ・チーム選択
  if (gameFlowState === 'newgame_university_select') {
    return <UniversityTeamSelectScreen
      onSelect={(team) => {
        setGameMode('university');
        setGameFlowState('university_loading');
        setTimeout(() => {
          const result = initializeUniversityGame(team);

          setLeagueConfig({
            format: 'single',
            teamsPerLeague: result.allTeamNames.length,
            leagues: [{ name: result.leagueName, teams: result.allTeamNames }]
          });

          const newSeasonData = createSeasonData(1);
          newSeasonData.settings = {
            teamsCount: result.allTeamNames.length,
            teamNames: result.allTeamNames,
            teamAbbreviations: result.allTeamNames.map(n => n.slice(0, 3)),
            gamesPerSeason: 30,
            useDH: false,
            leagueFormat: 'single',
            universityMode: true,
            universityTeamId: team.id,
            universityRegion: team.region,
          };

          const uniSchedule = getUniversityLeagueSchedule(team.region);
          newSeasonData.schedule = uniSchedule;
          newSeasonData.standings = getUniversityLeagueStandings(team.region, result.allTeamNames);
          setSeasonData(newSeasonData);
          setGameFlowState('university_camp');
        }, 50);
      }}
      onBack={() => setGameFlowState('newgame_mode_select')}
    />;
  }

  // UNIVERSITY: ローディング画面
  if (gameFlowState === 'university_loading') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🎓</div>
          <div className="text-white text-xl font-bold mb-2">大学野球の世界を構築中...</div>
          <div className="text-gray-300 text-sm">リーグチームと並行世界を生成しています</div>
          <div className="mt-4 w-48 h-1 bg-gray-700 rounded-full mx-auto overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full animate-pulse" style={{width: '60%'}}></div>
          </div>
        </div>
      </div>
    );
  }

  // UNIVERSITY: キャンプ
  if (gameFlowState === 'university_camp') {
    return <CampScreen
      seasonData={seasonData}
      allTeams={allTeams}
      onComplete={() => openFirstSeason()}
    />;
  }

  // MANUAL: ゲーム辞典
  if (gameFlowState === 'manual') {
    return <ManualScreen onBack={() => setGameFlowState('title')} />;
  }

  // EDIT CORPORATE NAMES: 社会人チーム名編集（セーブ不要）
  if (gameFlowState === 'edit_corporate_names') {
    return <CorporateNameEditScreen onBack={() => setGameFlowState('title')} />;
  }

  // NEW GAME: レギュレーション設定（カスタムリーグ専用）
  if (gameFlowState === 'newgame_regulations') {
    return <NewGameRegulationsScreen
      selectedLeague={null}
      onBack={() => setGameFlowState('newgame_league_select')}
      onComplete={(regulations) => {
        const presetKey = regulations.preset;
        initializeNewGame({ ...regulations, preset: presetKey });
        setGameFlowState('independent_loading');
        setTimeout(() => {
          const teamNames = Object.keys(TEAMS_DATA).filter(name => {
            const team = TEAMS_DATA[name];
            return team && !team.corporateTeamId && !team.independentLeagueId;
          });
          initializeParallelWorldForIndependent(presetKey || '__custom__', teamNames);
          ensureUserIndependentLeagueTagged(regulations.teamNames, presetKey || '__custom__');
          setGameFlowState('newgame_tryout');
        }, 50);
      }}
    />;
  }

  // INDEPENDENT: ローディング画面（平行世界の生成）
  if (gameFlowState === 'independent_loading') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">⚾</div>
          <div className="text-white text-xl font-bold mb-2">平行世界を初期化中...</div>
          <div className="text-gray-300 text-sm">社会人チーム179チーム＋独立リーグの選手を生成しています</div>
          <div className="mt-4 w-48 h-1 bg-gray-700 rounded-full mx-auto overflow-hidden">
            <div className="h-full bg-green-500 rounded-full animate-pulse" style={{width: '60%'}}></div>
          </div>
        </div>
      </div>
    );
  }

  // NEW GAME: 初期トライアウト
  if (gameFlowState === 'newgame_tryout') {
    return <TryoutScreen
      seasonData={seasonData}
      setSeasonData={setSeasonData}
      allTeams={allTeams}
      isInitialTryout={true}
      initializeAllPitchingRotations={initializeAllPitchingRotations}
      onSave={saveGame}
      saveSlots={saveSlots}
      onComplete={() => {
        // 途中の状態の写し（tryoutDraft）は終えたら外す（`tryoutDraftState.js`）
        setSeasonData(prev => withoutTryoutDraft(prev));
        setGameFlowState('newgame_camp');
      }}
    />;
  }

  // NEW GAME: キャンプ
  if (gameFlowState === 'newgame_camp') {
    return <CampScreen
      seasonData={seasonData}
      allTeams={allTeams}
      onComplete={() => openFirstSeason()}
    />;
  }

  // SANDBOX: レギュレーション設定
  if (gameFlowState === 'sandbox_regulations') {
    return <NewGameRegulationsScreen
      submitLabel="設定完了 - チーム設定へ"
      onBack={() => setGameFlowState('title')}
      onComplete={(regulations) => {
        // ⚠ 箱庭は背景の世界を持たないが、前のゲームの WORLD_DATA・プールは消すこと
        //    （以前は何も戻さず、前のゲームの大会・監督履歴・高校生が残っていた）
        initializeWorld('sandbox');
        WORLD_DATA.initialized = false;
        clearUniversityPool();
        clearHighSchoolPool();
        initializeNewGame(regulations);
        setGameFlowState('sandbox_setup');
      }}
    />;
  }

  // SANDBOX: チーム設定画面
  if (gameFlowState === 'sandbox_setup') {
    return <SandboxSetupScreen
      allTeams={allTeams}
      generateOptimalLineup={generateOptimalLineup}
      generatePitchingRotation={generatePitchingRotation}
      generateAllTeamsLineup={() => generateAllTeamsLineup(allTeams)}
      onComplete={() => openFirstSeason()}
    />;
  }

  return null;
};

export default GameFlowScreens;
