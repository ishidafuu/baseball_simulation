// ========================================================================
// gameSetup.js - setupManagedGame, handleManagedGameEnd
// Extracted from App.jsx GAME_SETUP section
// ========================================================================

import { TEAMS_DATA, LEAGUE_SETTINGS } from '../teams-data.js';
import { generateAILineup } from './autoSimulation.js';
import { recordGameResult } from '../season/dateProgression.js';
import { decidePitchers, recordDecisions } from './pitcherDecisions.js';
import { adjustGrowthModifier, applyFatigueGrowthPenalty, addFatigue } from '../utils/constants.js';
import { advanceQualifierWithResult, autoPlayBracket, isBracketComplete, getBracketRankings, buildLosersBracket, recordResult } from '../corporate/toshitaikou.js';

/**
 * setupManagedGame - 采配モードの試合セットアップ
 *
 * ctx に必要なプロパティ:
 *   setCount, setBases, setOuts, setInning, setScore, setGameOver,
 *   setGameStarted, setRemainingPitches, setSimMode, outOccurredRef,
 *   setInningScores, setExtraInningScores, setCurrentInningScore,
 *   setTeamHits, setTeamErrors, setTeamRBIs, setIsTopInning,
 *   setGameLog, setLastResult, setStatistics, setRecentVelocities,
 *   setHomeTeam, setAwayTeam, setCurrentStamina,
 *   setManagedGameInfo, managedGameInfoRef, setScreenMode
 */
export function executeSetupManagedGame(ctx, gameInfo) {
  const {
    setCount, setBases, setOuts, setInning, setScore, setGameOver,
    setGameStarted, setRemainingPitches, setSimMode, outOccurredRef,
    setInningScores, setExtraInningScores, setCurrentInningScore,
    setTeamHits, setTeamErrors, setTeamRBIs, setIsTopInning,
    setGameLog, setLastResult, setStatistics, setRecentVelocities,
    setHomeTeam, setAwayTeam, setCurrentStamina,
    setManagedGameInfo, managedGameInfoRef, setScreenMode
  } = ctx;

  // gameInfo: { gameId, home, away, otherGames: [{gameId, home, away}, ...] }
  const htn = gameInfo.home;
  const atn = gameInfo.away;
  const htd = TEAMS_DATA[htn];
  const atd = TEAMS_DATA[atn];

  if (!htd || !atd) return;

  const useDH = LEAGUE_SETTINGS.useDH;

  // ユーザーチームがどちら側かに応じてスタメンを適用
  const applyLineup = (teamData, teamName) => {
    const players = JSON.parse(JSON.stringify(teamData.players));
    const settings = teamData.lineupSettings;
    const isUserTeam = settings?.battingOrder?.length > 0;
    // AIチームの今日の先発（generateAILineup がローテと疲労から選んだ人）
    let aiStarterId = null;

    if (isUserTeam) {
      // DH の印も外す（打順に入る人だけ付け直す。`generateAILineup` の説明を参照）
      players.forEach(p => { p.battingOrder = 0; delete p._isDH; });
      settings.battingOrder.forEach(entry => {
        const player = players.find(p => p.id === entry.playerId);
        if (player) {
          player.battingOrder = entry.battingOrder;
          if (entry.position === 'dh') {
            player._isDH = true;
          } else {
            player.position = entry.position;
            delete player._isDH;
          }
        }
      });
    } else {
      const tempTeamData = { ...teamData, players };
      aiStarterId = generateAILineup(tempTeamData, teamName)?.id ?? null;
    }

    // ユーザーチームのみローテーションから先発を設定
    // （AIチームはgenerateAILineup内で先発選択＆index更新済み）
    if (isUserTeam) {
      const rotation = teamData.pitchingRotation;
      if (rotation?.starters?.length > 0) {
        const index = rotation.currentStarterIndex || 0;
        const starterId = rotation.starters[index];

        const starterPlayer = players.find(p => p.id === starterId);
        const starterOldOrder = starterPlayer?.battingOrder || 0;
        const starterOldPos = starterPlayer?.position;
        const hadNonPitcherSlot = starterOldOrder > 0 && (!useDH ? starterOldOrder !== 9 : true);

        if (!useDH) {
          const oldNinthPlayer = players.find(p => p.battingOrder === 9 && p.id !== starterId);

          players.forEach(p => {
            if (p.id === starterId) {
              p.battingOrder = 9;
              p.position = 'pitcher';
            }
          });

          if (oldNinthPlayer) {
            oldNinthPlayer.battingOrder = 0;
          }

          // 二刀流：野手スロットに空きが出た場合、ベンチから最適な野手を補充
          if (hadNonPitcherSlot && starterOldPos) {
            const startersInLineup = new Set(players.filter(p => p.battingOrder > 0).map(p => p.id));
            const benchFielders = players.filter(p =>
              p.battingOrder === 0 && !startersInLineup.has(p.id) && p.position !== 'pitcher'
            );
            if (benchFielders.length > 0) {
              benchFielders.sort((a, b) =>
                (b.positionFitness?.[starterOldPos] || 0) - (a.positionFitness?.[starterOldPos] || 0)
              );
              benchFielders[0].battingOrder = starterOldOrder;
              benchFielders[0].position = starterOldPos;
            } else if (oldNinthPlayer) {
              oldNinthPlayer.battingOrder = starterOldOrder;
              oldNinthPlayer.position = starterOldPos;
            }
          }
        } else {
          // DH制: 投手はbattingOrder=0で守備のみ参加
          players.forEach(p => {
            if (p.id === starterId) {
              p.battingOrder = 0;
              p.position = 'pitcher';
            }
          });

          // 二刀流：空いた野手スロットをベンチから補充
          if (hadNonPitcherSlot && starterOldPos && !starterPlayer?._isDH) {
            const startersInLineup = new Set(players.filter(p => p.battingOrder > 0).map(p => p.id));
            const benchFielders = players.filter(p =>
              p.battingOrder === 0 && !startersInLineup.has(p.id) && p.position !== 'pitcher'
            );
            if (benchFielders.length > 0) {
              benchFielders.sort((a, b) =>
                (b.positionFitness?.[starterOldPos] || 0) - (a.positionFitness?.[starterOldPos] || 0)
              );
              benchFielders[0].battingOrder = starterOldOrder;
              benchFielders[0].position = starterOldPos;
            }
          }
        }
      }

      // 同一IDの重複を除去（先頭を残す）
      const seenIds = new Set();
      players.forEach(p => {
        if (seenIds.has(p.id)) {
          p.battingOrder = 0;
          p.isStarter = false;
        }
        seenIds.add(p.id);
      });
    }

    // DH制: 先発投手を特定（isStartingPitcherフラグ）
    if (useDH) {
      const rotation = teamData.pitchingRotation;
      let starterPitcherId = null;
      if (isUserTeam && rotation?.starters?.length > 0) {
        const index = rotation.currentStarterIndex || 0;
        starterPitcherId = rotation.starters[index];
      } else {
        // ⚠ AIチームは generateAILineup が選んだ先発を使う。以前は名簿で最初の投手を
        //    選び直しており、試合前の「相手先発」と違う人（抑えなど）がマウンドに立ち、
        //    ローテだけ1つ進んでいた
        starterPitcherId = aiStarterId ?? players.find(p => p.position === 'pitcher')?.id;
      }
      players.forEach(p => {
        p._isStartingPitcher = (p.id === starterPitcherId && p.position === 'pitcher');
      });
    }

    return players;
  };

  const homePlayers = applyLineup(htd, htn);
  const awayPlayers = applyLineup(atd, atn);

  // ゲーム状態をリセット
  setCount({ balls: 0, strikes: 0 });
  setBases([false, false, false]);
  setOuts(0);
  setInning(1);
  setScore({ home: 0, away: 0 });
  setGameOver(false);
  setGameStarted(false);
  setRemainingPitches(0);
  setSimMode(null);
  outOccurredRef.current = false;
  setInningScores({
    away: [null, null, null, null, null, null, null, null, null],
    home: [null, null, null, null, null, null, null, null, null]
  });
  setExtraInningScores({ away: [], home: [] });
  setCurrentInningScore({ away: 0, home: 0 });
  setTeamHits({ home: 0, away: 0 });
  setTeamErrors({ home: 0, away: 0 });
  setTeamRBIs({ home: 0, away: 0 });
  setIsTopInning(true);
  setGameLog([]);
  setLastResult(null);
  setStatistics(null);
  setRecentVelocities([]);

  setHomeTeam({
    name: htn,
    players: homePlayers.map(p => ({
      ...p,
      isStarter: (p.battingOrder > 0 && p.battingOrder <= 9) || (useDH && p._isStartingPitcher),
      hasSubbedOut: false,
      originalPosition: p.position,
      gameStats: { atBats: 0, hits: 0, homeruns: 0, rbis: 0, strikeouts: 0, atBatResults: [] }
    })),
    currentBatterOrder: 1
  });

  setAwayTeam({
    name: atn,
    players: awayPlayers.map(p => ({
      ...p,
      isStarter: (p.battingOrder > 0 && p.battingOrder <= 9) || (useDH && p._isStartingPitcher),
      hasSubbedOut: false,
      originalPosition: p.position,
      gameStats: { atBats: 0, hits: 0, homeruns: 0, rbis: 0, strikeouts: 0, atBatResults: [] }
    })),
    currentBatterOrder: 1
  });

  const startingPitcher = useDH
    ? homePlayers.find(p => p._isStartingPitcher)
    : homePlayers.find(p => p.battingOrder === 9);
  if (startingPitcher) {
    const maxStamina = startingPitcher.pitching?.stamina || 100;
    const fatigue = startingPitcher.fatigue || 0;
    // 疲労によりスタミナ上限が低下（最低50%まで）
    const startStamina = Math.max(Math.floor(maxStamina * 0.5), maxStamina - fatigue);
    setCurrentStamina(startStamina);
  }

  setManagedGameInfo(gameInfo);
  managedGameInfoRef.current = gameInfo;
  setScreenMode('game');
}

/**
 * handleManagedGameEnd - 采配モード試合終了後の成績反映処理
 *
 * ctx に必要なプロパティ:
 *   managedGameInfoRef, score, homeTeam, awayTeam,
 *   seasonData, setSeasonData, selectedMonth, setSelectedMonth,
 *   setManagedGameInfo, setScreenMode, setManagementView
 */
export function executeHandleManagedGameEnd(ctx) {
  const {
    managedGameInfoRef, score, homeTeam, awayTeam, decisionLog,
    seasonData, setSeasonData, selectedMonth, setSelectedMonth,
    setManagedGameInfo, setScreenMode, setManagementView
  } = ctx;

  const info = managedGameInfoRef.current;
  if (!info) return;

  const finalScore = { ...score };
  const htn = homeTeam.name;
  const atn = awayTeam.name;

  // トーナメントの勝ち上がり。⚠ **引き分けを「ホームの負け」にしないこと**。
  //    采配した大会の試合はユーザーがホームなので、以前は同点で終わると
  //    無条件にユーザーの敗退になっていた。自動の試合（`simulateQuickMatch`）と同じく
  //    タイブレークで決着させる（采配試合はチームの格が引けないので五分）。
  const tournamentOutcome = () => {
    let h = finalScore.home, a = finalScore.away;
    if (h === a) {
      const homeWins = Math.random() < 0.5;
      const loseAdd = Math.random() < 0.4 ? 1 : 0;
      const winAdd = loseAdd + 1 + (Math.random() < 0.35 ? 1 : 0);
      if (homeWins) { h += winAdd; a += loseAdd; } else { a += winAdd; h += loseAdd; }
    }
    return { userWon: h > a, winnerName: h > a ? htn : atn, scoreArr: [h, a] };
  };

  const gameResult = {
    date: seasonData.currentDate,
    home: htn,
    away: atn,
    homeScore: finalScore.home,
    awayScore: finalScore.away
  };

  let updatedSeasonData = recordGameResult(seasonData, gameResult);

  // ユーザーチームのみローテインデックスを進める
  // （AIチームはgenerateAILineup内で既にインデックス更新済み）
  [htn, atn].forEach(teamName => {
    const teamData = TEAMS_DATA[teamName];
    const isUserTeam = teamData?.lineupSettings?.battingOrder?.length > 0;
    if (isUserTeam) {
      const rotation = teamData?.pitchingRotation;
      if (rotation?.starters?.length > 0) {
        rotation.currentStarterIndex =
          ((rotation.currentStarterIndex || 0) + 1) % rotation.starters.length;
      }
    }
  });

  const updateManagedGameStats = (teamState, teamName, side) => {
    const teamData = TEAMS_DATA[teamName];
    if (!teamData) return;
    // この試合の先発＝登板記録の最初の投手。⚠ ローテに入っているかで決めないこと
    //    （以前はそうしていて、救援に回ったローテ投手が先発扱いの疲労を背負い、
    //    逆に采配試合の先発には先発数・QSが一度も付かなかった）
    const gameStarterId = (decisionLog?.appearances?.[side] || []).find(a => a.isStarter)?.id
      ?? decisionLog?.appearances?.[side]?.[0]?.id ?? null;

    teamState.players.forEach(p => {
      const playerData = teamData.players.find(pl => pl.id === p.id);
      if (!playerData) return;

      const gs = p.gameStats || {};

      // 出場した選手はその日の疲労回復を行わない（recoverAllPitcherFatigueでスキップ）。
      // 打席・登板が無くても、打順を持っていれば途中出場（代走・守備固め）とみなす。
      {
        const gp = gs.pitching || {};
        const appeared = (gs.atBats || 0) > 0 || (gs.walks || 0) > 0 || (gs.hitByPitch || 0) > 0
          || (gp.outs || 0) > 0 || (gp.pitches || 0) > 0
          || (p.battingOrder || 0) > 0;
        if (appeared) playerData._playedToday = true;
      }

      if (gs.atBats > 0 || gs.walks > 0 || gs.hitByPitch > 0 || gs.sacrificeBunts > 0) {
        if (!playerData.seasonStats) playerData.seasonStats = { batting: {}, pitching: {} };
        if (!playerData.seasonStats.batting) playerData.seasonStats.batting = {};
        const season = playerData.seasonStats.batting;
        season.games = (season.games || 0) + 1;
        season.atBats = (season.atBats || 0) + (gs.atBats || 0);
        season.hits = (season.hits || 0) + (gs.hits || 0);
        // ⚠ 二塁打・三塁打・犠打は以前ここで集計しておらず、采配した試合の分だけ落ちていた
        season.doubles = (season.doubles || 0) + (gs.doubles || 0);
        season.triples = (season.triples || 0) + (gs.triples || 0);
        season.sacrificeBunts = (season.sacrificeBunts || 0) + (gs.sacrificeBunts || 0);
        season.homeruns = (season.homeruns || 0) + (gs.homeruns || 0);
        season.rbis = (season.rbis || 0) + (gs.rbis || 0);
        season.strikeouts = (season.strikeouts || 0) + (gs.strikeouts || 0);
        season.walks = (season.walks || 0) + (gs.walks || 0);
        season.hitByPitch = (season.hitByPitch || 0) + (gs.hitByPitch || 0);
        // 盗塁・盗塁死（采配モードは塁で走者を識別できるようになって初めて付く。baseState.js）
        season.stolenBases = (season.stolenBases || 0) + (gs.stolenBases || 0);
        season.caughtStealing = (season.caughtStealing || 0) + (gs.caughtStealing || 0);

        // 成長率変動: 摩耗ペナルティはスタメン出場(3打席以上)時のみ、疲労度に応じて段階的に適用
        // （代打・代走・守備固めではペナルティ無し）
        const isStarterAppearance = (gs.atBats || 0) >= 3;
        applyFatigueGrowthPenalty(playerData, isStarterAppearance);
        if (season.games % 10 === 0) adjustGrowthModifier(playerData, 0.01);

        // 野手疲労蓄積: スタメン出場(3打席以上)のみ（代打等は蓄積なし・回復もなし）
        if (isStarterAppearance) {
          const bodyStamina = playerData.physical?.bodyStamina || 50;
          const baseFatigue = Math.round(15 - (bodyStamina / 100) * 8);
          addFatigue(playerData, baseFatigue);
        }
        // 死球の疲労は打席数に関わらず乗る（代打の1打席で当たっても痛い）
        if (gs.hbpFatigue) addFatigue(playerData, gs.hbpFatigue);
      }

      // 守備成績。**采配モードにも自動シミュと同じ集計を持たせる**
      // （打席が無くても守備には就いているので、打撃の集計とは別に見る）
      if (gs.fieldingChances || gs.fieldErrors || gs.assists) {
        if (!playerData.seasonStats) playerData.seasonStats = { batting: {}, pitching: {} };
        if (!playerData.seasonStats.batting) playerData.seasonStats.batting = {};
        const sb = playerData.seasonStats.batting;
        sb.fieldingChances = (sb.fieldingChances || 0) + (gs.fieldingChances || 0);
        sb.errors = (sb.errors || 0) + (gs.fieldErrors || 0);
        sb.assists = (sb.assists || 0) + (gs.assists || 0);
      }

      const ps = p.stats?.pitching || {};
      if (ps.outs > 0 || ps.pitches > 0) {
        if (!playerData.seasonStats.pitching) playerData.seasonStats.pitching = {};
        const sp = playerData.seasonStats.pitching;
        const prevTotalOuts = sp.inningsPitched || 0;
        sp.games = (sp.games || 0) + 1;
        sp.inningsPitched = (sp.inningsPitched || 0) + (ps.outs || 0);
        sp.strikeouts = (sp.strikeouts || 0) + (ps.strikeouts || 0);
        sp.walks = (sp.walks || 0) + (ps.walks || 0);
        sp.hitBatters = (sp.hitBatters || 0) + (ps.hitBatters || 0);
        sp.runsAllowed = (sp.runsAllowed || 0) + (ps.runsAllowed || 0);
        // 自責点0（全て失策絡み）が失点で上書きされないよう ?? を使う
        sp.earnedRuns = (sp.earnedRuns || 0) + (ps.earnedRuns ?? ps.runsAllowed ?? 0);
        sp.hits = (sp.hits || 0) + (ps.hits || 0);
        sp.homeruns = (sp.homeruns || 0) + (ps.homeruns || 0);
        sp.pitches = (sp.pitches || 0) + (ps.pitches || 0);
        sp.wildPitches = (sp.wildPitches || 0) + (ps.wildPitches || 0);

        // 成長率変動: 摩耗ペナルティは10球以上投げた登板のみ、疲労度に応じて段階的に適用
        // （10球以下のワンポイント起用ではペナルティ無し）
        applyFatigueGrowthPenalty(playerData, (ps.pitches || 0) >= 10);

        // 投手疲労蓄積: bodyStaminaが高いほど疲労が溜まりにくい
        const bodyStamina = playerData.physical?.bodyStamina || 50;
        const staminaBonus = (bodyStamina / 100) * 1.5;
        const pitcherRoles = teamData.pitchingRotation?.pitcherRoles || {};
        const starterIds = new Set(teamData.pitchingRotation?.starters || []);
        const isStarter = gameStarterId != null ? p.id === gameStarterId : starterIds.has(p.id);
        const baseDivisor = isStarter ? 1.5 : 3;
        const pitchFatigue = Math.floor((ps.pitches || 0) / (baseDivisor + staminaBonus));
        // 自動試合と同じく、1イニング以上投げた先発にだけ付ける
        const startBonus = (isStarter && (ps.outs || 0) >= 3) ? 30 : 0;
        if (isStarter) {
          // 先発数・QS（6回以上・自責3以下）・HQS（7回以上・自責2以下）。自動試合と同じ判定
          const er = ps.earnedRuns ?? ps.runsAllowed ?? 0;
          sp.gamesStarted = (sp.gamesStarted || 0) + 1;
          if ((ps.outs || 0) >= 18 && er <= 3) sp.qualityStarts = (sp.qualityStarts || 0) + 1;
          if ((ps.outs || 0) >= 21 && er <= 2) sp.highQualityStarts = (sp.highQualityStarts || 0) + 1;
        }
        const fatigue = isStarter ? pitchFatigue + startBonus : Math.max(11, pitchFatigue);
        addFatigue(playerData, fatigue);
        if (isStarter) {
          // 先発: 15イニング(45アウト)ごとに+0.01
          if (Math.floor(sp.inningsPitched / 45) > Math.floor(prevTotalOuts / 45)) {
            adjustGrowthModifier(playerData, 0.01);
          }
        } else {
          // リリーフ: 登板数ベース（守護神/セットアッパー/中継ぎエースは4登板、その他は5登板ごと）
          const role = pitcherRoles[p.id] || '';
          const highPressureRoles = ['closer', 'setup', 'ace_relief'];
          const threshold = highPressureRoles.includes(role) ? 4 : 5;
          if (sp.games % threshold === 0) {
            adjustGrowthModifier(playerData, 0.01);
          }
        }
      }
    });
  };

  updateManagedGameStats(homeTeam, htn, 'home');
  updateManagedGameStats(awayTeam, atn, 'away');

  // 勝敗・セーブ・ホールド（自動シミュと同じ判定。pitcherDecisions.js）。
  // ⚠ 以前はここに独自の推定があり（先発が5回以上なら先発の勝ち／最少アウト＝最後の投手）、
  //    0-0で5回に降りた先発に勝ちが付き、1-0の9回の守護神にセーブが付かなかった
  if (finalScore.home !== finalScore.away && decisionLog) {
    const teamState = { home: homeTeam, away: awayTeam };
    const outsOf = (side, id) => teamState[side]?.players?.find(p => p.id === id)?.stats?.pitching?.outs || 0;
    const d = decidePitchers({
      finalScore, appearances: decisionLog.appearances, lastLead: decisionLog.lastLead, outsOf,
    });
    if (d.winSide) {
      const find = (side, id) => (id == null ? null : teamState[side].players.find(p => p.id === id) || null);
      const loseSide = d.winSide === 'home' ? 'away' : 'home';
      const nameOf = { home: htn, away: atn };
      recordDecisions({
        winningPitcher: find(d.winSide, d.win),
        losingPitcher: find(loseSide, d.loss),
        savePitcher: find(d.winSide, d.save),
        holdPitchers: d.holds.map(id => find(d.winSide, id)).filter(Boolean),
      }, { winTeam: nameOf[d.winSide], loseTeam: nameOf[loseSide] }, TEAMS_DATA);
    }
  }

  // ⚠ 同じ日の他の試合はここで消化しない。日付送りと一緒に日程進行の
  //    `executeSkipDay`（`simulateScheduledGamesOnDate`）が消化する（下記 `_resumeDayAfterManagedGame`）。
  //    以前はここに**勝敗・セーブ・ホールドの判定をもう1本**持っていた（表の二重化）

  // 大学トーナメントの結果処理（全日本大学野球選手権 / 明治神宮大会）
  for (const tournamentKey of ['universityChampionship', 'meijiJingu']) {
    const utPending = updatedSeasonData[tournamentKey]?.pendingMatch;
    if (utPending && info.isTournament) {
      const ut = { ...updatedSeasonData[tournamentKey] };
      const { userWon, winnerName, scoreArr } = tournamentOutcome();

      recordResult(ut.bracket, utPending.roundIdx, utPending.matchIdx, winnerName, scoreArr);
      if (isBracketComplete(ut.bracket)) {
        ut.champion = ut.bracket.champion;
        const finalRound = ut.bracket.rounds[ut.bracket.rounds.length - 1];
        ut.runnerUp = finalRound?.[0]?.loser || null;
        ut.phase = 'done';
      }

      ut.pendingMatch = null;
      updatedSeasonData = { ...updatedSeasonData, [tournamentKey]: ut };
      setSeasonData(updatedSeasonData);
      setManagedGameInfo(null);
      managedGameInfoRef.current = null;
      setScreenMode('management');
      setManagementView('dateprogress');
      return;
    }
  }

  // 地域トーナメントの結果処理
  const rtPending = updatedSeasonData.regionalTournament?.pendingMatch;
  if (rtPending && info.isTournament) {
    const rt = { ...updatedSeasonData.regionalTournament };
    const { userWon, winnerName, scoreArr } = tournamentOutcome();

    const region = rt.brackets?.[rtPending.regionId];
    if (region) {
      recordResult(region.bracket, rtPending.roundIdx, rtPending.matchIdx, winnerName, scoreArr);
      if (isBracketComplete(region.bracket)) {
        region.champion = region.bracket.champion;
        region.phase = 'done';
        const allDone = Object.values(rt.brackets).every(r => r.phase === 'done');
        if (allDone) {
          rt.champions = Object.values(rt.brackets).map(r => r.champion).filter(Boolean);
          rt.phase = 'done';
        }
      }
    }

    rt.pendingMatch = null;
    updatedSeasonData = { ...updatedSeasonData, regionalTournament: rt };
    setSeasonData(updatedSeasonData);
    setManagedGameInfo(null);
    managedGameInfoRef.current = null;
    setScreenMode('management');
    setManagementView('dateprogress');
    return;
  }

  // 日本選手権の結果処理
  const nsPending = updatedSeasonData.nihonSenshuken?.pendingMatch;
  if (nsPending && info.isTournament) {
    const ns = { ...updatedSeasonData.nihonSenshuken };
    const { userWon, winnerName, scoreArr } = tournamentOutcome();

    if (nsPending.bracketType === 'nihon_senshuken' && ns.mainTournament) {
      recordResult(ns.mainTournament.bracket, nsPending.roundIdx, nsPending.matchIdx, winnerName, scoreArr);
      if (isBracketComplete(ns.mainTournament.bracket)) {
        const rankings = getBracketRankings(ns.mainTournament.bracket);
        ns.mainTournament.champion = rankings[0] || null;
        ns.mainTournament.runnerUp = rankings[1] || null;
        ns.mainTournament.phase = 'done';
        ns.champion = ns.mainTournament.champion;
        ns.runnerUp = ns.mainTournament.runnerUp;
        ns.phase = 'done';
      }
    } else if (nsPending.bracketType === 'nihon_senshuken_qualifier_losers' && nsPending.regionId) {
      const qualifier = ns.qualifiers[nsPending.regionId];
      if (qualifier?.losersBracket) {
        recordResult(qualifier.losersBracket, nsPending.roundIdx, nsPending.matchIdx, winnerName, scoreArr);
        if (!userWon) {
          autoPlayBracket(qualifier.losersBracket, qualifier.teamDefsMap);
        }
        if (isBracketComplete(qualifier.losersBracket)) {
          const losersRankings = getBracketRankings(qualifier.losersBracket);
          qualifier.qualifiedTeams.push(...losersRankings.slice(0, qualifier.slots - 1));
          qualifier.phase = 'done';
        }
        const allDone = Object.values(ns.qualifiers).every(q => q.phase === 'done');
        if (allDone) {
          ns.userQualifierDone = true;
          ns.phase = 'qualifiers_done';
        }
      }
    } else if (nsPending.bracketType === 'nihon_senshuken_qualifier' && nsPending.regionId) {
      const qualifier = ns.qualifiers[nsPending.regionId];
      if (qualifier) {
        advanceQualifierWithResult(qualifier, nsPending.roundIdx, nsPending.matchIdx, winnerName, scoreArr, htn);
        const allDone = Object.values(ns.qualifiers).every(q => q.phase === 'done');
        if (allDone) {
          ns.userQualifierDone = true;
          ns.phase = 'qualifiers_done';
        }
      }
    }

    ns.pendingMatch = null;
    updatedSeasonData = { ...updatedSeasonData, nihonSenshuken: ns };
    setSeasonData(updatedSeasonData);
    setManagedGameInfo(null);
    managedGameInfoRef.current = null;
    setScreenMode('management');
    setManagementView('dateprogress');
    return;
  }

  // クラブ選手権の結果処理
  const csPending = updatedSeasonData.clubSenshuken?.pendingMatch;
  if (csPending && info.isTournament) {
    const cs = { ...updatedSeasonData.clubSenshuken };
    const { userWon, winnerName, scoreArr } = tournamentOutcome();

    if (csPending.bracketType === 'club_senshuken' && cs.mainTournament) {
      recordResult(cs.mainTournament.bracket, csPending.roundIdx, csPending.matchIdx, winnerName, scoreArr);
      if (isBracketComplete(cs.mainTournament.bracket)) {
        const rankings = getBracketRankings(cs.mainTournament.bracket);
        cs.mainTournament.champion = rankings[0] || null;
        cs.mainTournament.runnerUp = rankings[1] || null;
        cs.mainTournament.phase = 'done';
        cs.champion = cs.mainTournament.champion;
        cs.runnerUp = cs.mainTournament.runnerUp;
        cs.phase = 'done';
      }
    } else if (csPending.bracketType === 'club_senshuken_qualifier_losers' && csPending.regionId) {
      const qualifier = cs.qualifiers[csPending.regionId];
      if (qualifier?.losersBracket) {
        recordResult(qualifier.losersBracket, csPending.roundIdx, csPending.matchIdx, winnerName, scoreArr);
        if (!userWon) {
          autoPlayBracket(qualifier.losersBracket, qualifier.teamDefsMap);
        }
        if (isBracketComplete(qualifier.losersBracket)) {
          const losersRankings = getBracketRankings(qualifier.losersBracket);
          qualifier.qualifiedTeams.push(...losersRankings.slice(0, qualifier.slots - 1));
          qualifier.phase = 'done';
        }
        const allDone = Object.values(cs.qualifiers).every(q => q.phase === 'done');
        if (allDone) {
          cs.userQualifierDone = true;
          cs.phase = 'qualifiers_done';
        }
      }
    } else if (csPending.bracketType === 'club_senshuken_qualifier' && csPending.regionId) {
      const qualifier = cs.qualifiers[csPending.regionId];
      if (qualifier) {
        advanceQualifierWithResult(qualifier, csPending.roundIdx, csPending.matchIdx, winnerName, scoreArr, htn);
        const allDone = Object.values(cs.qualifiers).every(q => q.phase === 'done');
        if (allDone) {
          cs.userQualifierDone = true;
          cs.phase = 'qualifiers_done';
        }
      }
    }

    cs.pendingMatch = null;
    updatedSeasonData = { ...updatedSeasonData, clubSenshuken: cs };
    setSeasonData(updatedSeasonData);
    setManagedGameInfo(null);
    managedGameInfoRef.current = null;
    setScreenMode('management');
    setManagementView('dateprogress');
    return;
  }

  // トーナメント試合の結果処理
  const pendingMatch = updatedSeasonData.toshitaikou?.pendingMatch;
  if (pendingMatch && info.isTournament) {
    const td = { ...updatedSeasonData.toshitaikou };
    const { userWon, winnerName, scoreArr } = tournamentOutcome();

    if (pendingMatch.bracketType === 'main_tournament' && td.mainTournament) {
      // 本戦の結果記録
      recordResult(td.mainTournament.bracket, pendingMatch.roundIdx, pendingMatch.matchIdx, winnerName, scoreArr);
      if (isBracketComplete(td.mainTournament.bracket)) {
        const rankings = getBracketRankings(td.mainTournament.bracket);
        td.mainTournament.champion = rankings[0] || null;
        td.mainTournament.runnerUp = rankings[1] || null;
        td.mainTournament.phase = 'done';
        td.champion = td.mainTournament.champion;
        td.runnerUp = td.mainTournament.runnerUp;
        td.mainDone = true;
      }
    } else if (pendingMatch.bracketType === 'losers' && pendingMatch.regionId) {
      // 敗者復活の結果記録
      const qualifier = td.qualifiers[pendingMatch.regionId];
      if (qualifier?.losersBracket) {
        recordResult(qualifier.losersBracket, pendingMatch.roundIdx, pendingMatch.matchIdx, winnerName, scoreArr);
        // ユーザーが負けたら残りの敗者復活を全消化
        if (!userWon) {
          autoPlayBracket(qualifier.losersBracket, qualifier.teamDefsMap);
        }
        if (isBracketComplete(qualifier.losersBracket)) {
          const losersRankings = getBracketRankings(qualifier.losersBracket);
          qualifier.qualifiedTeams.push(...losersRankings.slice(0, qualifier.slots - 1));
          qualifier.phase = 'done';
        }
        const allDone = Object.values(td.qualifiers).every(q => q.phase === 'done');
        td.qualifiersDone = allDone;
        td.userQualifierDone = qualifier.phase === 'done';
      }
    } else if (pendingMatch.regionId) {
      // 予選(勝者側)の結果記録
      const qualifier = td.qualifiers[pendingMatch.regionId];
      if (qualifier) {
        advanceQualifierWithResult(qualifier, pendingMatch.roundIdx, pendingMatch.matchIdx, winnerName, scoreArr, htn);
        const allDone = Object.values(td.qualifiers).every(q => q.phase === 'done');
        td.qualifiersDone = allDone;
        td.userQualifierDone = qualifier.phase === 'done';
      }
    }
    td.pendingMatch = null;
    updatedSeasonData = { ...updatedSeasonData, toshitaikou: td };
    setSeasonData(updatedSeasonData);
    setManagedGameInfo(null);
    managedGameInfoRef.current = null;
    setScreenMode('management');
    setManagementView('dateprogress');
    return;
  }

  // ⚠ **ここで日付を進めないこと**。以前は `progressDate` だけ呼んで日程進行へ戻っており、
  //    通常の日送り（`DateProgressScreen.executeSkipDay`）が行う
  //    他リーグ・大学リーグの試合 / 背景の社会人大会 / 推薦スカウトの日次処理 /
  //    2ヶ月ごとの注目度 / `checkAndTriggerEvents` が**采配した日だけ丸ごと抜けていた**。
  //    それらは日付の完全一致でしか消化しないので、後からも拾われない
  //    （大学モードではドラフト前日の試合を采配するとドラフトまで飛んでいた）。
  //    印を付けて日程進行へ戻り、向こうで同じ1日の処理を通す。
  updatedSeasonData = { ...updatedSeasonData, _resumeDayAfterManagedGame: true };

  setSeasonData(updatedSeasonData);

  setManagedGameInfo(null);
  managedGameInfoRef.current = null;
  setScreenMode('management');
  setManagementView('dateprogress');
}
