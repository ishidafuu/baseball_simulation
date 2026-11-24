import { humanTeamNames } from '../game/teamControl.js';
// ============================================================
// 年間進行システム - yearProgressionSystem.js
// シーズン終了処理、年度更新、引退、解雇
// ============================================================

import { createSeasonData, initializeStandings, qualifiedPA, qualifiedOuts, plateAppearances, compareStandings, getPlayoffChampion } from './seasonManager.js';
import { processNpbCareers } from '../game/npbCareer.js';
import { generateFullSeasonSchedule } from './scheduleGenerator.js';
import { PHYSICAL_STATS, TECHNICAL_STATS, getAgeGrowthBase, getStatPath, getStatName, getNestedValue, setNestedValue } from './growthUtils.js';
import { PITCHING_FORM_EFFECTS, getUtilityScore } from '../utils/constants.js';
import { pitchOwnValue } from '../game/pitchCalling.js';
import { deviationValue, deviationOf, valueGroup, DRAFT_DEMAND } from '../game/playerValue.js';
import { generateHighSchoolClass, assignCareerPaths, enrollInUniversity, processUniversityYear, processHighSchoolNPBDraft, distributeHighSchoolGraduates, HIGH_SCHOOL_CLASS_SIZE, absorbUniversityPoolIntoRosters } from './universityPool.js';
import { universityPool, highSchoolPool } from '../state/schoolPools.js';
import { initializeUniversityLeagues, processUniversityPromotionRelegation } from '../university/universityLeagueManager.js';
import { getUniversityLeagueSchedule, getUniversityLeagueStandings } from '../university/universityInit.js';
import { generatePositionFitness } from './playerFactory.js';
import { assignSecondCareer } from './secondCareer.js';
import { syncPositionToFitness, getVelocityCap, getVelocityCatchupMult } from '../utils/physics.js';
import { WORLD_DATA } from '../corporate/worldData.js';
import { releasedPlayersPool, TEAMS_DATA } from '../teams-data.js';
import { addToReleasedPool, replaceReleasedPool, removeFromReleasedPoolByIds } from '../state/pools.js';
import { addToRoster, replaceRoster } from '../state/roster.js';
// 成長・衰退の計算は growthSystem.js に抽出。
import { updateGrowthModifiers, applyFreeAgentGrowth, applyCorporatePlayerGrowth, applyAgeCurveChanges, applyPositionShifts } from './growthSystem.js';
// CPU並行世界のロスター管理（大学卒業/新入生・社会人/独立の戦力外/補充）は rosterProgression.js に抽出
import { processUniversityTeamGraduation, releaseCPUCorporatePlayers, replenishCorporateRosters, replenishIndependentLeagueRosters, buildRecruitNorms, abilityZ, markFreshRoute, processLowerTierTurnover } from './rosterProgression.js';
import { updateAllTeamReputations, updateAllRanks, updateAllTournamentBudgetBonuses, advanceSponsors, applyReputationDecay, applyUniversityReputationDecay, resetIndependentLeagueSchedules } from '../corporate/corporateInit.js';
import { extractTournamentSeeds } from '../corporate/toshitaikou.js';
import { advanceStaffYear } from '../corporate/staffData.js';
import { generateRandomPlayerName } from '../data/playerNames.js';
export { TRAINING_MENUS, SUB_TRAINING_MENUS, executeTeamCampTraining, executeSubTraining, executeCampTraining, ALL_PITCH_TYPES, getPitchTypeName, FORM_PITCH_AFFINITY, calcSecondAffinity, calculateSeasonExperience, updateAllPlayersExperience, applyMotivationEffect, applyBatteryMentalEffect } from './campTraining.js';
export { DISPATCH_DESTINATIONS, DISPATCH_LIMITS, calcPlayerOverall, checkDispatchEligibility, executeDispatchTraining, resolveDispatchTraining, getUniversityDispatchOptions, getAvailableDispatchKeys } from './dispatchSystem.js';

/**
 * 4月: 高校3年生を生成して高校生プールに格納
 * シーズン開始時に呼び出される
 * @param {number} year - ゲーム内年度
 * @returns {number} 生成人数
 */
export function generateAprilHighSchoolClass(year) {
  if (highSchoolPool.year === year && highSchoolPool.players.length > 0) {
    return highSchoolPool.players.length;
  }
  const players = generateHighSchoolClass(year, HIGH_SCHOOL_CLASS_SIZE);
  highSchoolPool.players = players;
  highSchoolPool.year = year;
  return players.length;
}

/**
 * チームから選手IDを除去した際にlineupSettings/pitchingRotationを清掃
 * @param {Object} team - チームデータ
 * @param {string} playerId - 除去された選手ID
 */
export function cleanupPlayerReferences(team, playerId) {
  // lineupSettings.battingOrderから除去
  if (team.lineupSettings?.battingOrder) {
    const idx = team.lineupSettings.battingOrder.findIndex(e => e.playerId === playerId);
    if (idx !== -1) {
      team.lineupSettings.battingOrder.splice(idx, 1);
    }
  }

  // pitchingRotationから除去
  const rotation = team.pitchingRotation;
  if (!rotation) return;

  if (rotation.starters) {
    const idx = rotation.starters.indexOf(playerId);
    if (idx !== -1) {
      rotation.starters.splice(idx, 1);
      if (rotation.starters.length > 0) {
        rotation.currentStarterIndex = (rotation.currentStarterIndex || 0) % rotation.starters.length;
      } else {
        rotation.currentStarterIndex = 0;
      }
    }
  }
  if (rotation.closer === playerId) {
    rotation.closer = null;
  }
  if (rotation.setupMen) {
    const idx = rotation.setupMen.indexOf(playerId);
    if (idx !== -1) rotation.setupMen.splice(idx, 1);
  }
  if (rotation.middleRelievers) {
    const idx = rotation.middleRelievers.indexOf(playerId);
    if (idx !== -1) rotation.middleRelievers.splice(idx, 1);
  }
  // pitcherRolesマップからも除去
  if (rotation.pitcherRoles) {
    delete rotation.pitcherRoles[playerId];
  }
  // reliefFatigueからも除去
  if (rotation.reliefFatigue) {
    delete rotation.reliefFatigue[playerId];
  }
}

function collectAllPlayers(allTeams) {
  const allPlayers = [];
  const seenIds = new Set();
  Object.entries(allTeams).forEach(([teamName, team]) => {
    team.players.forEach(player => {
      if (player.id != null && seenIds.has(player.id)) return;
      if (player.id != null) seenIds.add(player.id);
      allPlayers.push({ ...player, teamName });
    });
  });
  return allPlayers;
}

/**
 * シーズン終了処理
 */
export function processSeasonEnd(seasonData, allTeams) {
  const awards = {
    champion: null, battingChampion: null, homeRunKing: null,
    rbiKing: null, stolenBaseKing: null, eraChampion: null,
    winsLeader: null, savesLeader: null, strikeoutKing: null
  };

  if (seasonData.standings && seasonData.standings.length > 0) {
    // 順位表・プレーオフと同じ並べ方（勝率→勝利数）。以前はここだけ勝利数が先で、
    // 引き分けの多いチームの扱いが順位表と食い違っていた
    const sortedStandings = [...seasonData.standings].sort(compareStandings);
    awards.champion = sortedStandings[0].team;
  }

  // 大学/社会人モード等では自チームリーグのみを対象にする
  const eligibleTeamNames = seasonData.settings?.teamNames;
  const filteredTeams = eligibleTeamNames?.length
    ? Object.fromEntries(Object.entries(allTeams).filter(([name]) => eligibleTeamNames.includes(name)))
    : allTeams;
  const allPlayers = collectAllPlayers(filteredTeams);
  // 規定はシーズンの長さに連動させる（定義は seasonManager に一本化してある）。
  // 以前は 100打数 / 30 の固定値で、しかも 30 は**アウト数＝10回**だったため
  // 17回で防御率0.00の中継ぎが防御率王になっていた
  const totalGames = seasonData.settings?.gamesPerSeason || seasonData.schedule?.length || 0;
  const minPA = qualifiedPA(totalGames);
  const minOuts = qualifiedOuts(totalGames);
  const qualifiedBatters = allPlayers.filter(p => plateAppearances(p.seasonStats.batting) >= minPA);
  const qualifiedPitchers = allPlayers.filter(p => (p.seasonStats.pitching.inningsPitched || 0) >= minOuts);

  const findLeader = (players, getValue, ascending = false) => {
    if (players.length === 0) return null;
    return players.reduce((best, p) =>
      ascending ? (getValue(p) < getValue(best) ? p : best) : (getValue(p) > getValue(best) ? p : best)
    );
  };
  const toAward = (player, statObj) => player ? { id: player.id, name: player.name, team: player.teamName, ...statObj } : null;
  const getBattingAvg = (p) => p.seasonStats.batting.atBats > 0 ? p.seasonStats.batting.hits / p.seasonStats.batting.atBats : 0;
  const getEra = (p) => p.seasonStats.pitching.inningsPitched > 0 ? (p.seasonStats.pitching.earnedRuns * 27) / p.seasonStats.pitching.inningsPitched : 99.99;

  if (qualifiedBatters.length > 0) {
    const ba = findLeader(qualifiedBatters, getBattingAvg);
    awards.battingChampion = toAward(ba, { avg: getBattingAvg(ba).toFixed(3) });
    const hr = findLeader(qualifiedBatters, p => p.seasonStats.batting.homeruns);
    awards.homeRunKing = toAward(hr, { homeruns: hr.seasonStats.batting.homeruns });
    const rbi = findLeader(qualifiedBatters, p => p.seasonStats.batting.rbis);
    awards.rbiKing = toAward(rbi, { rbis: rbi.seasonStats.batting.rbis });
    const sb = findLeader(qualifiedBatters, p => p.seasonStats.batting.stolenBases);
    awards.stolenBaseKing = toAward(sb, { stolenBases: sb.seasonStats.batting.stolenBases });
  }

  if (qualifiedPitchers.length > 0) {
    const eraL = findLeader(qualifiedPitchers, getEra, true);
    awards.eraChampion = toAward(eraL, { era: getEra(eraL).toFixed(2) });
    const winsL = findLeader(qualifiedPitchers, p => p.seasonStats.pitching.wins);
    awards.winsLeader = toAward(winsL, { wins: winsL.seasonStats.pitching.wins });
    const soL = findLeader(qualifiedPitchers, p => p.seasonStats.pitching.strikeouts);
    awards.strikeoutKing = toAward(soL, { strikeouts: soL.seasonStats.pitching.strikeouts });
  }

  const savesL = findLeader(allPlayers, p => p.seasonStats.pitching.saves || 0);
  if (savesL && (savesL.seasonStats.pitching.saves || 0) > 0) {
    awards.savesLeader = toAward(savesL, { saves: savesL.seasonStats.pitching.saves });
  }

  return awards;
};

/**
 * ランキングのスナップショットを生成（シーズン確定時に呼び出し）
 * プレーオフ後にseasonDataに保存し、選手が引退/解雇されても成績が残る
 */
export function snapshotRankings(allTeams, eligibleTeamNames) {
  const filteredTeams = eligibleTeamNames?.length
    ? Object.fromEntries(Object.entries(allTeams).filter(([name]) => eligibleTeamNames.includes(name)))
    : allTeams;
  const allPlayers = collectAllPlayers(filteredTeams);

  const buildRanking = (filterFn, getValue, formatValue, ascending = false) => {
    return allPlayers.filter(filterFn)
      .map(p => {
        const sv = getValue(p);
        return { rank: 0, name: p.name, team: p.teamName, value: formatValue ? formatValue(sv) : sv, sortValue: sv };
      })
      .sort((a, b) => ascending ? a.sortValue - b.sortValue : b.sortValue - a.sortValue)
      .slice(0, 10)
      .map((p, i) => ({ ...p, rank: i + 1 }));
  };

  const hasBatAB = p => p.seasonStats?.batting?.atBats > 0;
  const hasIP = p => p.seasonStats?.pitching?.inningsPitched > 0;

  const getOPS = p => {
    const s = p.seasonStats.batting;
    const obp = (s.hits + s.walks + (s.hitByPitch || 0)) / (s.atBats + s.walks + (s.hitByPitch || 0));
    const totalBases = (s.hits - (s.doubles || 0) - (s.triples || 0) - s.homeruns) + (s.doubles || 0) * 2 + (s.triples || 0) * 3 + s.homeruns * 4;
    return obp + totalBases / s.atBats;
  };
  const getWHIP = p => {
    const s = p.seasonStats.pitching;
    return ((s.hits || 0) + (s.walks || 0)) / (s.inningsPitched / 3);
  };

  return {
    battingAverage: buildRanking(hasBatAB, p => p.seasonStats.batting.hits / p.seasonStats.batting.atBats, v => v.toFixed(3)),
    homeRuns: buildRanking(p => p.seasonStats?.batting?.homeruns > 0, p => p.seasonStats.batting.homeruns),
    rbis: buildRanking(p => p.seasonStats?.batting?.rbis > 0, p => p.seasonStats.batting.rbis),
    stolenBases: buildRanking(p => p.seasonStats?.batting?.stolenBases > 0, p => p.seasonStats.batting.stolenBases),
    ops: buildRanking(hasBatAB, getOPS, v => v.toFixed(3)),
    era: buildRanking(hasIP, p => (p.seasonStats.pitching.earnedRuns * 27) / p.seasonStats.pitching.inningsPitched, v => v.toFixed(2), true),
    whip: buildRanking(hasIP, getWHIP, v => v.toFixed(2), true),
    wins: buildRanking(p => p.seasonStats?.pitching?.wins > 0, p => p.seasonStats.pitching.wins),
    holds: buildRanking(p => p.seasonStats?.pitching?.holds > 0, p => p.seasonStats.pitching.holds),
    saves: buildRanking(p => p.seasonStats?.pitching?.saves > 0, p => p.seasonStats.pitching.saves),
  };
}

/**
 * 全選手の年齢を1歳増やす
 * @param {Object} allTeams - 全チームデータ
 * @returns {Object} - 更新されたチームデータ
 */
export function updateAllPlayerAges(allTeams) {
  const updatedTeams = {};

  Object.entries(allTeams).forEach(([teamName, team]) => {
    updatedTeams[teamName] = {
      ...team,
      players: team.players.map(player => ({
        ...player,
        age: (player.age || 20) + 1
      }))
    };
  });

  return updatedTeams;
};

/**
 * NPBドラフト候補条件を判定
 * 能力ベース + 年齢補正 + 成長力 + 知名度（通算蓄積）+ シーズン成績ボーナス
 * @param {Object} player - 選手データ
 * @param {number} awardBonus - シーズン個人成績ボーナス（デフォルト0）
 * @returns {Object} - { isDraftEligible: boolean, reasons: string[], totalScore: number }
 */
/**
 * ドラフト評価の「能力点」だけを返す（年齢・知名度・成長力は含まない）。
 * **ドラフトとトレードで同じ物差しを使う**ために切り出してある。
 * ここに独自の評価式をもう1つ書かないこと。
 */
/**
 * ドラフト評価の「能力点」を**メイン／サブに分けて**返す。
 * 年齢・知名度・成長力は含まない。
 *
 * 【メイン】スカウトが最初に見る中核の能力
 *   投手 … 球速・制球・変化球
 *   野手 … 打撃（ミート/パワー/選球眼）・守備・走塁（捕手はリードも守備の一部）
 * 【サブ】メインを支えるフィジカルと付随要素
 *   投手 … スタミナ・体力・素材としての肩・フォーム
 *   野手 … 肩・体力・守備の幅
 *
 * **ドラフトとトレードで同じ物差しを使う**ために切り出してある。
 * ここに独自の評価式をもう1つ書かないこと。
 */
export function draftAbilityScore(player) {
  const age = player.age || 20;
  const isYoung = age <= 19;
  const isMature = age >= 22;

  if (player.position === 'pitcher') {
    const velocity = player.pitching?.velocity || 0;
    const control = player.pitching?.control || 0;
    const stamina = player.pitching?.stamina || 0;
    const breakingBalls = (player.pitching?.arsenal || []).filter(a => a.type !== 'straight');

    // 年齢別ウェイト: 高校生は球速重視、社会人は制球・変化球重視
    //
    // ⚠ **140km未満の傾きが足りていなかった**（社会人 0.9 / 高校生 1.5）。
    // 実測では 1km = 0.0512 防御率、投手ブランチ平均は 1pt = 0.0206 なので、
    // 価値に見合う重みは **2.5 pt/km**。140km以上は閾値ボーナスで
    // 3.4〜5.5 と足りていたが、独立リーグの投手は大半が120〜135kmなので
    // **実際に効くのは下限帯**で、そこが2.8倍の過小評価だった。
    const velBase = isYoung ? 3.4 : isMature ? 2.5 : 2.8;
    const vel140 = isYoung ? 4.0 : isMature ? 2.5 : 3.0;
    const vel150 = isYoung ? 5.0 : isMature ? 3.0 : 3.5;
    const ctrlW = isYoung ? 0.7 : isMature ? 1.4 : 1.1;
    const staW = isYoung ? 0.15 : isMature ? 0.35 : 0.25;
    const breakW = isYoung ? 0.5 : isMature ? 1.0 : 0.8;

    // 【左投手はプロ候補の「線」が低い】実際のスカウトは
    // 「右なら145km、左なら140km」を目安にする。
    // ⚠ 幅の決め方を3通り試した（高校生投手の上位100人に占める左の割合。
    //    プール比率は約30%）:
    //      +5km を全球速帯に … **52%**（効きすぎ）
    //      +5km を閾値だけに … **18%**（足りない。左は生成時点で-3kmされている）
    //      **+3km を全体に**  … **27%** ≒ プール比率
    // +3 は生成時の左投手ペナルティ(-3km)をちょうど打ち消す値でもある。
    // 実測で上位に入る左投手は右より **2.3km 遅い**（134.1 対 136.4）ので、
    // 「左は少し遅くても候補に挙がる」という関係は出ている。
    const LEFTY_VELOCITY_EDGE = 3;
    const sv = velocity + (player.physical?.throws === 'left' ? LEFTY_VELOCITY_EDGE : 0);

    let velocityScore = Math.max(0, (sv - 110) * velBase);
    if (sv >= 140) velocityScore += (sv - 140) * vel140;
    if (sv >= 150) velocityScore += (sv - 150) * vel150;

    // 【変化球は種類込みで評価する】以前は「最高レベル1つ×重み＋本数ボーナス」で
    // 球種の違いを見ていなかった。実測では同じLv100でもカーブ1.16対ツーシーム0.72。
    // `pitchOwnValue` は捕手の球種スコアと**同じ回帰係数**なので物差しが増えない。
    // 2球種目以降は逓減。スケール29.4 はプール平均が従来と一致する値。
    const OWN_DIMINISH = [1.0, 0.55, 0.30, 0.18, 0.10];
    const breakingScore = breakingBalls
      .map(a => pitchOwnValue(a.type, a.level || 0))
      .sort((x, y) => y - x)
      .reduce((sum, v, i) => sum + v * (OWN_DIMINISH[i] ?? 0.06), 0) * 29.4 * (breakW / 0.5);

    const main = velocityScore + control * ctrlW + breakingScore;

    let sub = stamina * staW + (player.physical?.bodyStamina || 50) * 0.10;
    if (isYoung) {
      sub += (player.physical?.arm || 0) * 0.3;
      const form = player.pitching?.form;
      if (form === 'submarine') sub -= 20;
      else if (form === 'sidearm') sub -= 10;
    }
    if (isMature) {
      const form = player.pitching?.form;
      if (form === 'submarine') sub += 8;
      else if (form === 'sidearm') sub += 5;
    }
    return { main, sub };
  }

  const meet = player.batting?.meet || 0;
  const power = player.batting?.power || 0;
  const eye = player.batting?.eye || 0;
  const speed = player.physical?.speed || 0;
  const defense = player.fielding?.defense || 0;
  const arm = player.physical?.arm || 0;

  // 年齢別ウェイト: 高校生はパワー/足/肩、社会人はミート/選球眼/守備
  const meetW = isYoung ? 0.6 : isMature ? 1.3 : 1.0;
  const powerW = isYoung ? 1.4 : isMature ? 0.8 : 1.0;
  const eyeW = isYoung ? 0.2 : isMature ? 0.8 : 0.5;
  const speedW = isYoung ? 0.8 : isMature ? 0.3 : 0.4;
  const defW = isYoung ? 0.2 : isMature ? 0.7 : 0.4;
  const armW = isYoung ? 0.6 : isMature ? 0.2 : 0.3;

  // 【捕手のリードは守備の一部】以前は捕手も打撃・守備・肩でしか見ておらず
  // リードが完全に盲点だった（評価との相関 -0.074）。実測の1点あたりの価値は
  // リード -0.0044 / 捕手守備 -0.0041 とほぼ同じなので守備と同じ重みで足す。
  // ⚠ 平均50からの差で足すこと。絶対値だと全捕手に一律加点され捕手が膨らむ。
  const leadScore = player.position === 'catcher'
    ? ((player.catching?.lead ?? 50) - 50) * defW : 0;

  const main = meet * meetW + power * powerW + eye * eyeW
    + speed * speedW + defense * defW + leadScore;
  const sub = arm * armW + (player.physical?.bodyStamina || 50) * 0.10
    + getUtilityScore(player) * 0.08;
  return { main, sub };
}

export function checkNPBDraftEligibility(player, awardBonus = 0) {
  const isPitcher = player.position === 'pitcher';
  const reasons = [];
  const age = player.age || 20;

  if (age >= 30) {
    return { isDraftEligible: false, reasons: [], totalScore: 0 };
  }

  // 大学所属選手: 4年生(22歳)のみ指名対象
  if (player.universityTeamId || player.universityYear) {
    if (age < 22) return { isDraftEligible: false, reasons: ['大学4年生のみ指名可'], totalScore: 0 };
  }

  // 年齢ボーナス（若い選手の将来性を評価）
  // 実際のNPBドラフトでは高校生が1巡目の3-5人を占める
  // ⚠ **カテゴリ加点を全廃したので、構成比を決めるのはこの年齢カーブと成長だけ**。
  //    高卒の +33 は「素材への投機」として大きすぎ、高校生が指名の45%を占めていた
  //    （プールの81%が高校生なので、少しの下駄でも大量に通ってしまう）。
  const ageBonusMap = { 18: 38, 19: 35, 20: 20, 21: 10, 22: 10, 23: -2, 24: -18, 25: -28, 26: -38, 27: -46, 28: -55, 29: -65 };
  const ageBonus = ageBonusMap[age] !== undefined ? ageBonusMap[age] : (age < 18 ? 33 : -65);

  // 将来性投影倍率（若い選手の能力を伸びしろ込みで評価）
  const potentialMult = age <= 18 ? 1.03 : age <= 19 ? 1.02 : age <= 20 ? 1.01 : 1.0;

  // 成長力ボーナス（若い選手ほど成長力が大きく評価される）
  const gp = player.growthPotential || 1.0;
  const gpBonus = age <= 19 ? Math.max(0, (gp - 0.60) * 45)
               : age <= 22 ? Math.max(0, (gp - 0.8) * 25)
               : Math.max(0, (gp - 1.0) * 15);

  // 知名度ボーナス
  const fame = player.fame || 0;
  const fameBonus = Math.round(fame * 0.3);

  const isYoung = age <= 19;
  const isMature = age >= 22;

  // 能力点は `draftAbilityScore`（メイン／サブ）に一本化してある。
  // ここでは **投打で比較できる偏差値**に直してから年齢・知名度を足す。
  const { main, sub } = draftAbilityScore(player);
  const isPitcherBranch = isPitcher;
  const abilityScore = deviationValue(player, main, sub) * potentialMult;

  // 成長力ボーナスは「素材があってこそ」なので現在能力に比例させる。
  // ⚠ ここも**偏差値で見る**こと。素点で割ると投手(平均81)と野手(平均113)で
  // 倍率が変わり、せっかく揃えた投打のスケールがまたずれる（実測 投手32%止まり）。
  const dev = deviationOf(player, main, sub);
  const abilityFactor = Math.max(0, Math.min(1.0, (dev - 25) / 50));
  const gpBonusScaled = age <= 19 ? Math.max(0, (gp - 0.60) * 25) * abilityFactor
                      : age <= 22 ? Math.max(0, (gp - 0.8) * 25) * abilityFactor
                      : Math.max(0, (gp - 1.0) * 15);

  // ロスター需要（価値ではない。playerValue.js の DRAFT_DEMAND 参照）
  const demandBonus = DRAFT_DEMAND[valueGroup(player)] || 0;
  const baseScore = abilityScore + ageBonus + gpBonusScaled + fameBonus + demandBonus;
  const totalScore = baseScore + awardBonus;

  reasons.push(`${isPitcher ? '投手力' : '野手力'}${Math.round(abilityScore)}pt`);
  if (fameBonus > 0) reasons.push(`知名度+${fameBonus}pt`);
  if (awardBonus > 0) reasons.push(`成績ボーナス+${awardBonus}pt`);
  reasons.push(`総合${Math.round(totalScore)}pt`);
  if (isPitcher) {
    const velocity = player.pitching?.velocity || 0;
    const control = player.pitching?.control || 0;
    const bestBreaking = (player.pitching?.arsenal || [])
      .filter(a => a.type !== 'straight').reduce((m, a) => Math.max(m, a.level || 0), 0);
    if (isYoung && velocity >= 140) reasons.push(`球速${velocity}km`);
    if (!isYoung && velocity >= 148) reasons.push(`球速${velocity}km`);
    if (isMature && control >= 65) reasons.push(`制球力${control}`);
    if (isMature && bestBreaking >= 60) reasons.push(`変化球${bestBreaking}`);
  } else {
    const power = player.batting?.power || 0;
    const speed = player.physical?.speed || 0;
    const arm = player.physical?.arm || 0;
    const meet = player.batting?.meet || 0;
    const defense = player.fielding?.defense || 0;
    const eye = player.batting?.eye || 0;
    if (isYoung && power >= 55) reasons.push(`パワー${power}`);
    if (isYoung && speed >= 65) reasons.push(`俊足${speed}`);
    if (isYoung && arm >= 65) reasons.push(`強肩${arm}`);
    if (isMature && meet >= 60) reasons.push(`ミート${meet}`);
    if (isMature && defense >= 65) reasons.push(`守備${defense}`);
    if (isMature && eye >= 55) reasons.push(`選球眼${eye}`);
    if (player.position === 'catcher' && (player.catching?.lead ?? 0) >= 60) reasons.push(`リード${player.catching.lead}`);
  }
  if (age <= 22) reasons.push(`${age}歳の将来性`);

  return {
    isDraftEligible: true,
    reasons,
    totalScore: baseScore + awardBonus
  };
}

/**
 * シーズン個人成績ランキングからボーナスを計算
 * 各部門1位: +10pt、2位: +5pt
 * 打撃: 首位打者、本塁打王、打点王、盗塁王
 * 投手: 最優秀防御率、最多勝、最多セーブ、最多奪三振
 * @param {Object} allTeams - TEAMS_DATA
 * @param {Object} [options]
 * @param {number} [options.totalGames] - シーズンの試合数。渡すと規定を本物のタイトル
 *   （`processSeasonEnd`）と同じ規定打席・規定投球回（`qualifiedPA`・`qualifiedOuts`）にする。
 *   ⚠ 渡さないときは従来の固定値（100打数・30アウト＝10回）のまま（一人用の `processNPBDraft`）。
 *   固定値だと10回で防御率0.00の中継ぎが「最優秀防御率」になり、本物のタイトルと食い違う
 * @returns {Object} - playerId -> { bonus: number, awards: string[] }
 */
export function computeSeasonAwardBonuses(allTeams, { totalGames } = {}) {
  const bonusMap = {};
  const addBonus = (playerId, points, awardName) => {
    if (!bonusMap[playerId]) bonusMap[playerId] = { bonus: 0, awards: [] };
    bonusMap[playerId].bonus += points;
    bonusMap[playerId].awards.push(awardName);
  };

  const allPlayers = [];
  Object.values(allTeams).forEach(team => {
    if (!team.players) return;
    team.players.forEach(p => { if (p.seasonStats) allPlayers.push(p); });
  });

  const getBattingAvg = p => p.seasonStats.batting.atBats > 0 ? p.seasonStats.batting.hits / p.seasonStats.batting.atBats : 0;
  const getEra = p => p.seasonStats.pitching.inningsPitched > 0 ? (p.seasonStats.pitching.earnedRuns * 27) / p.seasonStats.pitching.inningsPitched : 99.99;

  const awardRanking = (players, getValue, title, ascending = false) => {
    if (players.length === 0) return;
    const sorted = [...players].sort((a, b) => ascending ? getValue(a) - getValue(b) : getValue(b) - getValue(a));
    addBonus(sorted[0].id, 10, `${title}1位`);
    if (sorted.length >= 2) addBonus(sorted[1].id, 5, `${title}2位`);
  };

  const useSeasonRule = Number.isFinite(totalGames) && totalGames > 0;
  const qualifiedBatters = useSeasonRule
    ? allPlayers.filter(p => plateAppearances(p.seasonStats?.batting) >= qualifiedPA(totalGames))
    : allPlayers.filter(p => p.seasonStats?.batting?.atBats >= 100);
  awardRanking(qualifiedBatters, getBattingAvg, '首位打者');
  awardRanking(qualifiedBatters, p => p.seasonStats.batting.homeruns || 0, '本塁打王');
  awardRanking(qualifiedBatters, p => p.seasonStats.batting.rbis || 0, '打点王');
  awardRanking(qualifiedBatters, p => p.seasonStats.batting.stolenBases || 0, '盗塁王');

  const minOuts = useSeasonRule ? qualifiedOuts(totalGames) : 30;
  const qualifiedPitchers = allPlayers.filter(p => p.seasonStats?.pitching?.inningsPitched >= minOuts);
  awardRanking(qualifiedPitchers, getEra, '最優秀防御率', true);
  awardRanking(qualifiedPitchers, p => p.seasonStats.pitching.wins || 0, '最多勝');
  awardRanking(qualifiedPitchers, p => p.seasonStats.pitching.strikeouts || 0, '最多奪三振');

  const savePitchers = allPlayers.filter(p => (p.seasonStats?.pitching?.saves || 0) > 0);
  awardRanking(savePitchers, p => p.seasonStats.pitching.saves || 0, '最多セーブ');

  return bonusMap;
}


/**
 * 殿堂入り条件を判定
 * 投手: 通算100勝、または通算30セーブ、または通算600奪三振
 * 野手: 通算打率.300以上、または通算150本塁打、または通算1000安打
 * @param {Object} player - 選手データ
 * @returns {Object} - { isHallOfFame: boolean, reason: string }
 */
export function checkHallOfFame(player) {
  const isPitcher = player.position === 'pitcher';

  // 通算成績
  const careerStats = player.careerStats || { batting: {}, pitching: {} };
  const careerWins = careerStats.pitching?.wins || 0;
  const careerStrikeouts = careerStats.pitching?.strikeouts || 0;
  const careerSaves = careerStats.pitching?.saves || 0;
  const careerHits = careerStats.batting?.hits || 0;
  const careerAtBats = careerStats.batting?.atBats || 0;
  const careerHomeruns = careerStats.batting?.homeruns || 0;
  const careerAvg = careerAtBats > 0 ? careerHits / careerAtBats : 0;

  if (isPitcher) {
    if (careerWins >= 100) return { isHallOfFame: true, reason: `通算${careerWins}勝の名投手` };
    if (careerSaves >= 30) return { isHallOfFame: true, reason: `通算${careerSaves}セーブの守護神` };
    if (careerStrikeouts >= 600) return { isHallOfFame: true, reason: `通算${careerStrikeouts}奪三振のストライカー` };
  } else {
    if (careerAvg >= 0.300 && careerAtBats >= 500) return { isHallOfFame: true, reason: `通算打率${careerAvg.toFixed(3)}の安打製造機` };
    if (careerHomeruns >= 150) return { isHallOfFame: true, reason: `通算${careerHomeruns}本塁打のスラッガー` };
    if (careerHits >= 1000) return { isHallOfFame: true, reason: `通算${careerHits}安打の名選手` };
  }

  return { isHallOfFame: false, reason: '' };
}

/**
 * 引退・殿堂入り判定
 * @param {Object} player - 選手データ
 * @returns {Object} - { shouldRetire: boolean, hallOfFame: boolean, reason: string, draftEligible: boolean, draftReasons: string[] }
 */
export function checkRetirement(player) {
  const age = player.age || 20;

  // 殿堂入り判定（新しい条件を使用）
  const { isHallOfFame: hallOfFame, reason: hofReason } = checkHallOfFame(player);

  // NPBドラフト候補判定
  const { isDraftEligible: draftEligible, reasons: draftReasons } = checkNPBDraftEligibility(player);

  // 引退判定
  let shouldRetire = false;
  let reason = hofReason;

  // 48歳以上は強制引退（プロ意識100＋大事に使われた稀な選手が45歳前後まで現役）
  // 29〜47歳の引退は processRetirements() で能力順位ベースに一括判定
  if (age >= 48) {
    shouldRetire = true;
    if (!reason) reason = '年齢による引退';
  }

  return { shouldRetire, hallOfFame, reason, draftEligible, draftReasons };
};

// 引退スコア計算（能力による引退優先度。低いほど先に引退）
function calcRetirementScore(player) {
  if (player.position === 'pitcher') {
    return (player.pitching?.velocity || 120) * 0.5
         + (player.pitching?.control  || 30)  * 0.3
         + (player.pitching?.stamina  || 50)  * 0.2;
  }
  return (player.batting?.meet      || 30) * 0.35
       + (player.batting?.power     || 20) * 0.25
       + (player.batting?.eye       || 20) * 0.15
       + (player.physical?.speed    || 30) * 0.15
       + (player.fielding?.defense  || 30) * 0.10;
}

/**
 * 全チームの引退処理
 * 40歳以上: 強制引退
 * 29〜39歳: 各年齢×ポジション別にグローバルで能力下位 (age-28)×5% を引退
 *   29歳→下位5%, 30歳→下位10%, ..., 39歳→下位55%
 * @param {Object} allTeams - 全チームデータ
 * @returns {Object} - { updatedTeams, retirements }
 */
export function processRetirements(allTeams, retirementYear = null) {
  const retireIds = new Set();

  // Step 1: 年齢×ポジション別にグローバル収集
  const groups = {};  // `${age}_pitcher` or `${age}_fielder` → player[]
  for (const team of Object.values(allTeams)) {
    for (const player of team.players || []) {
      const age = player.age || 20;
      if (age >= 48) {
        retireIds.add(player.id);
        continue;
      }
      if (age < 29) continue;
      const posKey = player.position === 'pitcher' ? 'pitcher' : 'fielder';
      const key = `${age}_${posKey}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(player);
    }
  }

  // Step 2: 各グループで能力下位 X% を引退マーク
  for (const [key, players] of Object.entries(groups)) {
    const age = parseInt(key.split('_')[0]);
    const retireCount = Math.floor(players.length * (age - 28) * 0.05);
    if (retireCount <= 0) continue;
    players
      .slice()
      .sort((a, b) => calcRetirementScore(a) - calcRetirementScore(b))
      .slice(0, retireCount)
      .forEach(p => retireIds.add(p.id));
  }

  // Step 3: チームから除去して引退記録を生成
  const updatedTeams = {};
  const retirements = [];

  for (const [teamName, team] of Object.entries(allTeams)) {
    const retired   = (team.players || []).filter(p => retireIds.has(p.id));
    const remaining = (team.players || []).filter(p => !retireIds.has(p.id));

    retired.forEach(player => {
      const { isHallOfFame: hallOfFame, reason: hofReason } = checkHallOfFame(player);
      // セカンドキャリア（引退後の監督/コーチ/スカウト就任）を判定し、
      // 選手のストーリーに刻む。該当しなければ null（完全引退）。
      const secondCareer = assignSecondCareer(player, retirementYear, teamName);
      if (secondCareer) {
        if (!Array.isArray(player.careerHistory)) player.careerHistory = [];
        player.careerHistory.push({
          type: 'second_career',
          year: secondCareer.year,
          team: teamName,
          role: secondCareer.role,
          label: `${teamName} ${secondCareer.title}就任`,
        });
        player.secondCareer = secondCareer;
      }
      retirements.push({
        name:       player.name,
        team:       teamName,
        age:        player.age,
        position:   player.position,
        throws:     player.physical?.throws || 'right',
        bats:       player.batting?.bats   || 'right',
        hallOfFame,
        reason:     hofReason || (player.age >= 40 ? '年齢による引退' : '引退'),
        careerStats: player.careerStats,
        careerHistory: player.careerHistory || null,
        secondCareer: secondCareer || null,
        draftInfo:  player.draftInfo || null,
        yearsPlayed: player.yearsPlayed,
      });
      cleanupPlayerReferences(team, player.id);
    });

    updatedTeams[teamName] = { ...team, players: remaining };
  }

  return { updatedTeams, retirements };
};

/**
 * 選手解雇
 * @param {Object} team - チームデータ
 * @param {number} playerId - 解雇する選手のID
 * @returns {Object} - 更新されたチームデータ
 */
export function releasePlayer(team, playerId) {
  return {
    ...team,
    players: team.players.filter(p => p.id !== playerId)
  };
};

/**
 * シーズン統計をリセット
 * @param {Object} allTeams - 全チームデータ
 * @returns {Object} - 更新されたチームデータ
 */
export function resetSeasonStats(allTeams, year) {
  const updatedTeams = {};

  Object.entries(allTeams).forEach(([teamName, team]) => {
    updatedTeams[teamName] = {
      ...team,
      players: team.players.map(player => finalizePlayerSeason(player, year))
    };
  });

  return updatedTeams;
};

/**
 * 選手1人分のシーズン終了処理（シーズン成績→通算加算、履歴追加、リセット）
 * resetSeasonStats の中身を1選手向けに抽出したもの。
 * 解雇プールに入る選手など、TEAMS_DATA の外でもシーズン終了処理を適用するために使う。
 * @param {Object} player - 選手オブジェクト
 * @param {number} year - シーズン年
 * @returns {Object} - シーズン終了処理済みの選手オブジェクト（新しいインスタンス）
 */
export function finalizePlayerSeason(player, year) {
  // 既に同じ年で終了処理済みの選手はそのまま返す
  // （解雇→再トライアウトで別チームに拾われた選手が、オフシーズンの resetSeasonStats で
  //  再度シーズン終了処理されるのを防ぐ）
  if (player.seasonFinalizedYear && player.seasonFinalizedYear === year) {
    return player;
  }
  const cb = player.careerStats?.batting || {};
  const sb = player.seasonStats?.batting || {};
  const updatedCareerBatting = {
    games: (cb.games || 0) + (sb.games || 0),
    atBats: (cb.atBats || 0) + (sb.atBats || 0),
    hits: (cb.hits || 0) + (sb.hits || 0),
    doubles: (cb.doubles || 0) + (sb.doubles || 0),
    triples: (cb.triples || 0) + (sb.triples || 0),
    homeruns: (cb.homeruns || 0) + (sb.homeruns || 0),
    rbis: (cb.rbis || 0) + (sb.rbis || 0),
    walks: (cb.walks || 0) + (sb.walks || 0),
    strikeouts: (cb.strikeouts || 0) + (sb.strikeouts || 0),
    stolenBases: (cb.stolenBases || 0) + (sb.stolenBases || 0),
    errors: (cb.errors || 0) + (sb.errors || 0),
    fieldingChances: (cb.fieldingChances || 0) + (sb.fieldingChances || 0)
  };

  const cp = player.careerStats?.pitching || {};
  const sp = player.seasonStats?.pitching || {};
  const updatedCareerPitching = {
    games: (cp.games || 0) + (sp.games || 0),
    wins: (cp.wins || 0) + (sp.wins || 0),
    losses: (cp.losses || 0) + (sp.losses || 0),
    saves: (cp.saves || 0) + (sp.saves || 0),
    holds: (cp.holds || 0) + (sp.holds || 0),
    inningsPitched: (cp.inningsPitched || 0) + (sp.inningsPitched || 0),
    runsAllowed: (cp.runsAllowed || 0) + (sp.runsAllowed || 0),
    earnedRuns: (cp.earnedRuns || 0) + (sp.earnedRuns || 0),
    hits: (cp.hits || 0) + (sp.hits || 0),
    homeruns: (cp.homeruns || 0) + (sp.homeruns || 0),
    walks: (cp.walks || 0) + (sp.walks || 0),
    strikeouts: (cp.strikeouts || 0) + (sp.strikeouts || 0),
    pitches: (cp.pitches || 0) + (sp.pitches || 0),
    qualityStarts: (cp.qualityStarts || 0) + (sp.qualityStarts || 0),
    highQualityStarts: (cp.highQualityStarts || 0) + (sp.highQualityStarts || 0)
  };

  // ⚠ **出ていない側の成績（0ばかり）は書かない**。年度別の記録は世界の全選手（約16,000人）に
  //    毎年たまり、10年で世界の保存の半分になって毎日の進行も倍に重くなった（10年の長期シミュ）。
  //    社会人・独立など対人リーグの外の選手は打撃・投球とも0、野手の投球・投手の打撃もほぼ0。
  //    読む側（選手詳細の年度別成績・オンラインの「参考」の期間）は `h.batting || {}` で読むので、
  //    無い年は今までどおり0として出る。能力（abilities）と年は残す（新人王の判定は件数を見る）
  const playedBatting = sb.games || sb.atBats || sb.walks || sb.hitByPitch;
  const playedPitching = sp.games || sp.inningsPitched;
  const statsHistoryEntry = {
    year: year || '?',
    ...(playedBatting ? { batting: JSON.parse(JSON.stringify(sb)) } : {}),
    ...(playedPitching ? { pitching: JSON.parse(JSON.stringify(sp)) } : {}),
    abilities: {
      meet: player.batting?.meet || 0,
      power: player.batting?.power || 0,
      speed: player.physical?.speed || 0,
      arm: player.physical?.arm || 0,
      defense: player.fielding?.defense || 0,
      eye: player.batting?.eye || 0,
      steal: player.batting?.steal || 0,
      velocity: player.pitching?.velocity || 0,
      control: player.pitching?.control || 0,
      stamina: player.pitching?.stamina || 0,
      catcherLead: player.catching?.lead,
      arsenal: player.pitching?.arsenal ? JSON.parse(JSON.stringify(player.pitching.arsenal)) : [],
      age: player.age || 0
    }
  };
  const existingHistory = player.statsHistory || [];
  return {
    ...player,
    seasonFinalizedYear: year || '?',
    fatigue: 0,
    statsHistory: [...existingHistory, statsHistoryEntry],
    previousSeasonStats: JSON.parse(JSON.stringify(player.seasonStats || {})),
    careerStats: {
      batting: updatedCareerBatting,
      pitching: updatedCareerPitching
    },
    seasonStats: {
      batting: { games: 0, atBats: 0, hits: 0, doubles: 0, triples: 0, homeruns: 0, rbis: 0, walks: 0, strikeouts: 0, stolenBases: 0, errors: 0, fieldingChances: 0 },
      pitching: { games: 0, wins: 0, losses: 0, saves: 0, holds: 0, inningsPitched: 0, runsAllowed: 0, earnedRuns: 0, hits: 0, homeruns: 0, walks: 0, strikeouts: 0, pitches: 0, qualityStarts: 0, highQualityStarts: 0 }
    }
  };
}

/**
 * タイトル獲得記録を選手に追加
 * @param {Object} allTeams - 全チームデータ
 * @param {Object} awards - 表彰結果
 * @returns {Object} - 更新されたチームデータ
 */
export function recordAwardsToPlayers(allTeams, awards, totalGames = 0, eligibleTeamNames = null) {
  const updatedTeams = {};

  // タイトル別の知名度上昇量
  const FAME_TITLE_1ST = 15;
  const FAME_TITLE_2ND = 8;

  // 2位の選手IDを収集
  // ⚠ **1位（`processSeasonEnd`）と同じ母集団・同じ規定で数えること**。以前は全球団から
  //    100打数／30アウト（＝10回）の固定値で拾っており、リーグの外の球団の選手や
  //    規定に届かない投手が「2位」として知名度を得ていた
  const runnerUpIds = new Set();
  const allPlayers = [];
  Object.entries(allTeams).forEach(([teamName, team]) => {
    if (eligibleTeamNames?.length && !eligibleTeamNames.includes(teamName)) return;
    if (team.players) team.players.forEach(p => allPlayers.push(p));
  });
  const collectRunnerUp = (getStat, filterFn, ascending = false) => {
    const qualified = allPlayers.filter(filterFn);
    if (qualified.length < 2) return;
    const sorted = [...qualified].sort((a, b) => ascending ? getStat(a) - getStat(b) : getStat(b) - getStat(a));
    runnerUpIds.add(sorted[1].id);
  };
  const getBattingAvg = p => p.seasonStats?.batting?.atBats > 0 ? p.seasonStats.batting.hits / p.seasonStats.batting.atBats : 0;
  const getEra = p => p.seasonStats?.pitching?.inningsPitched > 0 ? (p.seasonStats.pitching.earnedRuns * 27) / p.seasonStats.pitching.inningsPitched : 99.99;
  const batFilter = p => plateAppearances(p.seasonStats?.batting) >= qualifiedPA(totalGames);
  const pitFilter = p => (p.seasonStats?.pitching?.inningsPitched || 0) >= qualifiedOuts(totalGames);
  collectRunnerUp(getBattingAvg, batFilter);
  collectRunnerUp(p => p.seasonStats?.batting?.homeruns || 0, batFilter);
  collectRunnerUp(p => p.seasonStats?.batting?.rbis || 0, batFilter);
  collectRunnerUp(p => p.seasonStats?.batting?.stolenBases || 0, batFilter);
  collectRunnerUp(getEra, pitFilter, true);
  collectRunnerUp(p => p.seasonStats?.pitching?.wins || 0, pitFilter);
  collectRunnerUp(p => p.seasonStats?.pitching?.strikeouts || 0, pitFilter);
  collectRunnerUp(p => p.seasonStats?.pitching?.saves || 0, p => (p.seasonStats?.pitching?.saves || 0) > 0);

  Object.entries(allTeams).forEach(([teamName, team]) => {
    updatedTeams[teamName] = {
      ...team,
      players: team.players.map(player => {
        const achievements = [...(player.professionalCareer?.achievements || [])];
        let fameGain = 0;

        const matchAward = (award) => award && (award.id ? award.id === player.id : award.name === player.name);

        if (matchAward(awards.battingChampion)) {
          achievements.push({ year: 0, title: '首位打者' });
          fameGain += FAME_TITLE_1ST;
        }
        if (matchAward(awards.homeRunKing)) {
          achievements.push({ year: 0, title: '本塁打王' });
          fameGain += FAME_TITLE_1ST;
        }
        if (matchAward(awards.rbiKing)) {
          achievements.push({ year: 0, title: '打点王' });
          fameGain += FAME_TITLE_1ST;
        }
        if (matchAward(awards.stolenBaseKing)) {
          achievements.push({ year: 0, title: '盗塁王' });
          fameGain += FAME_TITLE_1ST;
        }
        if (matchAward(awards.eraChampion)) {
          achievements.push({ year: 0, title: '最優秀防御率' });
          fameGain += FAME_TITLE_1ST;
        }
        if (matchAward(awards.winsLeader)) {
          achievements.push({ year: 0, title: '最多勝' });
          fameGain += FAME_TITLE_1ST;
        }
        if (matchAward(awards.savesLeader)) {
          achievements.push({ year: 0, title: '最多セーブ' });
          fameGain += FAME_TITLE_1ST;
        }
        if (matchAward(awards.strikeoutKing)) {
          achievements.push({ year: 0, title: '最多奪三振' });
          fameGain += FAME_TITLE_1ST;
        }

        // 2位にも知名度加算
        if (runnerUpIds.has(player.id)) {
          fameGain += FAME_TITLE_2ND;
        }

        // 規定到達で出場実績による微量加算（毎シーズン+2）。
        // ⚠ 100打数 / 30（＝10回）の固定値だった頃は投手78人中74人に配られており、
        //    「規定に届いた」という意味を持っていなかった
        const minPA = qualifiedPA(totalGames);
        const minOuts = qualifiedOuts(totalGames);
        const pa = plateAppearances(player.seasonStats?.batting);
        const pitOuts = player.seasonStats?.pitching?.inningsPitched || 0;
        if (pa >= minPA || pitOuts >= minOuts) {
          fameGain += 2;
        }

        const currentFame = player.fame || 0;

        return {
          ...player,
          fame: Math.min(100, currentFame + fameGain),
          professionalCareer: {
            ...(player.professionalCareer || {}),
            achievements
          }
        };
      })
    };
  });

  return updatedTeams;
};



// ============================================================
// CPU並行世界チームのシーズン成績を自動生成
// resetSeasonStats 後に呼び出すことで通算成績に積み上がりつつ、
// 引退判定・成長計算でも利用できる状態にする
// ============================================================
function simulateParallelWorldStats(allTeams, playedTeamNames = []) {
  const humanTeams = new Set([...humanTeamNames(allTeams), ...playedTeamNames]);

  for (const [teamName, team] of Object.entries(allTeams)) {
    if (humanTeams.has(teamName)) continue;
    if (!team?.players?.length) continue;

    // チームタイプ別試合数
    let seasonGames;
    if (team.universityData) {
      seasonGames = 26;          // 大学: 春13+秋13
    } else if (team.independentLeagueId) {
      seasonGames = 90;          // 独立リーグ
    } else if (team.corporateData?.type === 'club') {
      seasonGames = 20;          // クラブ: 地域リーグ
    } else if (team.corporateData) {
      seasonGames = 45;          // 社会人企業
    } else {
      continue;
    }

    const pitchers = team.players.filter(p => p.position === 'pitcher');
    const fielders = team.players.filter(p => p.position !== 'pitcher');

    // チーム総合力 → 勝率推定
    const teamScore = team.players.reduce((s, p) => {
      return s + (p.position === 'pitcher'
        ? Math.max(0, (p.pitching?.velocity || 120) - 110) * 0.5 + (p.pitching?.control || 30) * 0.5
        : (p.batting?.meet || 30) * 0.4 + (p.batting?.power || 20) * 0.3 + (p.physical?.speed || 30) * 0.15 + (p.fielding?.defense || 30) * 0.15);
    }, 0) / Math.max(1, team.players.length);
    const winRate = Math.min(0.75, Math.max(0.25, 0.25 + teamScore / 120));

    // --- 野手: 能力順に出場時間を配分 ---
    const sortedFielders = [...fielders].sort((a, b) =>
      (b.batting?.meet || 0) + (b.batting?.power || 0) - ((a.batting?.meet || 0) + (a.batting?.power || 0))
    );
    sortedFielders.forEach((p, i) => {
      const rate = i < 9
        ? 0.85 - i * 0.025
        : Math.max(0.12, 0.52 - (i - 9) * 0.07);
      const gamesPlayed = Math.max(1, Math.round(seasonGames * rate * (0.85 + Math.random() * 0.3)));
      const atBats = Math.round(gamesPlayed * (3.2 + Math.random() * 0.8));
      const meetF = (p.batting?.meet || 30) / 100;
      const hitRate = Math.min(0.38, Math.max(0.14, meetF * 0.4 + (Math.random() - 0.5) * 0.04));
      const hits = Math.round(atBats * hitRate);
      const pwrF = (p.batting?.power || 20) / 100;
      const hr = Math.round(atBats * pwrF * 0.06 * (0.7 + Math.random() * 0.6));
      const eyeF = (p.batting?.eye || 25) / 80;

      if (!p.seasonStats) p.seasonStats = {};
      p.seasonStats.batting = {
        games: gamesPlayed,
        atBats,
        hits,
        homeruns: hr,
        rbis: Math.round(hr * 2.2 + hits * 0.22 + Math.random() * 4),
        walks: Math.round(atBats * 0.08 * (0.6 + eyeF)),
        strikeouts: Math.round(atBats * (0.22 - meetF * 0.08)),
        doubles: Math.round(hits * 0.18),
        triples: Math.round(hits * 0.03),
        stolenBases: Math.round(gamesPlayed * (p.physical?.speed || 30) / 220 * (0.7 + Math.random() * 0.6)),
        caughtStealing: 0,
        sacrificeBunts: Math.round(gamesPlayed * 0.05),
      };
    });

    // --- 投手: 先発・リリーフで按分 ---
    const sortedPitchers = [...pitchers].sort((a, b) =>
      (Math.max(0, (b.pitching?.velocity || 120) - 110) * 0.5 + (b.pitching?.control || 30))
      - (Math.max(0, (a.pitching?.velocity || 120) - 110) * 0.5 + (a.pitching?.control || 30))
    );
    const starterCount = Math.min(5, Math.max(1, Math.round(pitchers.length * 0.35)));

    sortedPitchers.forEach((p, i) => {
      const ctrlF = (p.pitching?.control || 30) / 80;
      const velF = Math.max(0, ((p.pitching?.velocity || 120) - 110)) / 45;
      const era = Math.min(7.5, Math.max(1.5, 5.5 - ctrlF * 2.5 - velF * 1.2 + (Math.random() - 0.5) * 0.8));

      if (!p.seasonStats) p.seasonStats = {};

      if (i < starterCount) {
        const starts = Math.max(1, Math.round(seasonGames / starterCount * (0.85 + Math.random() * 0.3)));
        const avgIP = 4.0 + (p.pitching?.stamina || 60) / 60 * 2.5;
        const ip = Math.round(starts * avgIP);
        p.seasonStats.pitching = {
          games: starts,
          gamesStarted: starts,
          gamesRelieved: 0,
          // ⚠ 投球回は**アウト数**で持つ（防御率は `自責×27÷アウト`）。回のまま入れると
          //    防御率が3倍・規定投球回に届かない
          inningsPitched: ip * 3,
          wins: Math.round(starts * winRate * 0.5 * (0.7 + Math.random() * 0.6)),
          losses: Math.round(starts * (1 - winRate) * 0.5 * (0.7 + Math.random() * 0.6)),
          saves: 0,
          earnedRuns: Math.round(ip * era / 9),
          strikeouts: Math.round(ip * (1.0 + ctrlF * 0.8) * (0.8 + Math.random() * 0.4)),
          walks: Math.round(ip * Math.max(0.1, 0.5 - ctrlF * 0.3) * (0.8 + Math.random() * 0.4)),
          hits: Math.round(ip * (0.9 + (1 - velF) * 0.3)),
          homeruns: Math.round(ip * 0.06),
          battersFaced: Math.round(ip * 3.5),
        };
      } else {
        const isCloser = i === starterCount;
        const numRelievers = Math.max(1, pitchers.length - starterCount);
        const apps = Math.max(2, Math.round(
          seasonGames * (isCloser ? 0.35 : 0.22) / numRelievers * (0.8 + Math.random() * 0.4)
        ));
        const ip = Math.round(apps * (isCloser ? 1.0 : 1.3));
        p.seasonStats.pitching = {
          games: apps,
          gamesStarted: 0,
          gamesRelieved: apps,
          inningsPitched: ip * 3,   // アウト数（先発と同じ）
          wins: Math.round(apps * 0.08 * (0.7 + Math.random() * 0.6)),
          losses: Math.round(apps * 0.06 * (0.7 + Math.random() * 0.6)),
          saves: isCloser ? Math.round(apps * winRate * 0.55 * (0.8 + Math.random() * 0.4)) : 0,
          earnedRuns: Math.round(ip * era / 9),
          strikeouts: Math.round(ip * (1.2 + ctrlF * 0.6) * (0.8 + Math.random() * 0.4)),
          walks: Math.round(ip * Math.max(0.1, 0.4 - ctrlF * 0.2) * (0.8 + Math.random() * 0.4)),
          hits: Math.round(ip * (0.85 + (1 - velF) * 0.25)),
          homeruns: Math.round(ip * 0.05),
          battersFaced: Math.round(ip * 3.4),
        };
      }
    });
  }
}

/**
 * 次年度への完全移行
 * @param {Object} seasonData - 現在のシーズンデータ
 * @param {Object} allTeams - 全チームデータ
 * @returns {Object} - { newSeasonData, updatedTeams, awards, retirements }
 */
export function advanceToNextYear(seasonData, allTeams, { playedTeamNames = [], onlineTeamNames = null } = {}) {
  // オンラインの対人リーグの球団（自然成長の式を分ける。`growthSystem` の `CATEGORY_GROWTH.online`）
  const online = onlineTeamNames ? new Set(onlineTeamNames) : null;
  // 0. プロへ送り出した教え子のキャリアを1年進める（NPBは観るだけの階層）
  const npbYear = seasonData.settings?.year || seasonData.year || 1;
  processNpbCareers(allTeams, npbYear);

  // 0.4. 今オフの入団の印を消す（スカウト候補から外すためだけの一時フラグ）
  for (const t of Object.values(allTeams)) for (const p of (t?.players || [])) delete p._justRecruited;

  // 0.5. 仮置きのプールに残った在学生を名簿へ（旧セーブの移行。大学生の実体は名簿ひとつ）
  //      ⚠ 加齢（4）より前に置くこと——名簿の選手として一緒に歳を取らせる
  absorbUniversityPoolIntoRosters(allTeams, seasonData.year);

  // 1. シーズン終了処理（表彰）
  // ドラフト前にfrozenAwardsが確定済みならそれを使用（指名選手がランキングから消えるのを防ぐ）
  const awards = seasonData.frozenAwards || processSeasonEnd(seasonData, allTeams);

  // 2. タイトルを選手に記録
  let updatedTeams = recordAwardsToPlayers(allTeams, awards, seasonData.settings?.gamesPerSeason || seasonData.schedule?.length || 0, seasonData.settings?.teamNames);

  // 2.5. 成長率変動を更新（疲労酷使ペナルティ・優勝ボーナス）
  updateGrowthModifiers(updatedTeams, awards);

  // 2.6. 年度末の注目度減衰を適用してからランク判定
  for (const teamData of Object.values(updatedTeams)) {
    if (teamData?.corporateData) {
      if (teamData.independentLeagueId) {
        applyUniversityReputationDecay(teamData);
      } else {
        applyReputationDecay(teamData);
      }
    }
    if (teamData?.universityData) {
      applyUniversityReputationDecay(teamData);
    }
  }
  let rankChanges = [];
  let staffRetirements = [];
  rankChanges = updateAllRanks(seasonData);
  // 2.7. その年の全国大会の成績 → 翌年の予算の「大会成績ボーナス」（毎年置き換え。足し込まない）
  updateAllTournamentBudgetBonuses(seasonData, updatedTeams);
  if (seasonData.settings?.corporateMode) {
    const userTeamName = Object.keys(updatedTeams)[0];
    for (const [teamName, teamData] of Object.entries(updatedTeams)) {
      if (teamData?.corporateData) {
        advanceSponsors(teamData.corporateData);
        const isUser = teamName === userTeamName;
        const retired = advanceStaffYear(teamData.corporateData.staff, !isUser, teamData.corporateData.rank);
        if (isUser && retired.length > 0) {
          staffRetirements = retired;
        }
        // 赤字ペナルティは11/30のBudgetSettlementScreenで適用済み
        teamData.corporateData.scoutMissions = [];
        teamData.corporateData.scoutTasks = {};
        teamData.corporateData.favoritePlayerIds = {};
        teamData.corporateData.autoInvestFilter = null;
      }
    }
  }

  // 2.8. ランキングをスナップショット（ドラフト前に確定済みならそのまま使用）
  if (!seasonData.finalRankings) {
    seasonData.finalRankings = snapshotRankings(updatedTeams);
  }

  // 3. シーズン統計を通算に加算してリセット
  updatedTeams = resetSeasonStats(updatedTeams, seasonData.year);

  // 3.5. CPU並行世界チームにシーズン成績を注入
  // resetSeasonStats後に入れることで通算成績に正しく積み上がり、
  // 以降の引退判定(step5)・成長計算(step4.6)でも使われる
  // ⚠ **本当に試合をしたチームには入れないこと**。独立リーグで遊ぶときの同じリーグの
  //    球団（`settings.teamNames`）と、日程を持って毎日試合を消化する並行世界の
  //    独立リーグは、本物の成績を持っている。ここで作り物を入れると、その成績が
  //    翌シーズンの開幕から乗ったまま本物の試合が足されていた（実測：開幕前で
  //    1球団の打数が2,700前後）。成績の一覧・タイトル争いが最初から壊れる
  const playedTeams = [
    ...playedTeamNames,
    ...(seasonData.settings?.teamNames || []),
    ...Object.values(WORLD_DATA.independentLeagues || {})
      .filter(league => league?.schedule?.length)
      .flatMap(league => league.teams || []),
  ];
  simulateParallelWorldStats(updatedTeams, playedTeams);

  // 4. 選手の年齢を更新
  updatedTeams = updateAllPlayerAges(updatedTeams);
  // 自由契約選手も加齢（チームなしだが時間は経過する）
  releasedPlayersPool.forEach(p => { p.age = (p.age || 20) + 1; });

  // 4.5. 年齢カーブによる成長・衰退を適用
  const { updatedTeams: teamsAfterAgeCurve, ageReports } = applyAgeCurveChanges(updatedTeams, { online });
  updatedTeams = teamsAfterAgeCurve;

  // 4.6. 社会人/独立チームの若手選手に実戦経験による成長を適用
  applyCorporatePlayerGrowth(updatedTeams, { online });

  // 4.65. 加齢で守備範囲が落ちた選手を易しい守備位置へ移す（捕手→一塁、遊撃→三塁…）
  const positionShifts = applyPositionShifts(updatedTeams);

  // 4.7. 自由契約選手の自主トレ成長（クラブ所属と同等: discipline主導・環境なし）
  applyFreeAgentGrowth(releasedPlayersPool);

  // 5. 引退処理
  const { updatedTeams: teamsAfterRetirement, retirements } = processRetirements(updatedTeams, seasonData.year);

  // 5.5. 大学プール処理: 在学生の成長 + 卒業生を排出
  const currentYear = seasonData.year;
  const { graduates: uniGraduates, report: uniReport } = processUniversityYear(currentYear);
  // 卒業生の進路を能力別に振り分け
  // NPBドラフト漏れの大学卒業生 → 社会人候補 / 独立候補 / 引退
  // ⚠ 大学モードでは TEAMS_DATA に居ない222校の在学生がここ（プール）を通る。
  //    名簿側（`processUniversityTeamGraduation`）と同じく群ごとの z で比べること
  //    （旧式は投手 `(球速-120)×1.5+…` 対 野手 `ミート+パワー+…` の別スケール）
  const uniGradNorms = buildRecruitNorms(uniGraduates);
  const gradScored = uniGraduates.map(g => ({ player: g, score: abilityZ(g, uniGradNorms) }));
  gradScored.sort((a, b) => b.score - a.score);
  const corpCut = Math.floor(gradScored.length * 0.35);
  const indCut = corpCut + Math.floor(gradScored.length * 0.25);
  gradScored.forEach((entry, i) => {
    const grad = entry.player;
    grad.isStarter = false;
    grad.battingOrder = 0;
    grad.origin = 'university';
    grad.isReleasedCandidate = true;
    if (i < corpCut) {
      grad.postGradPath = 'corporate';
    } else if (i < indCut) {
      grad.postGradPath = 'independent';
    } else {
      grad.postGradPath = 'retired';
    }
    if (grad.postGradPath !== 'retired') {
      markFreshRoute(grad, 'university', currentYear);   // 企業の入団ルート（大卒）
      addToReleasedPool(grad);
    }
  });

  // 5.55. 大学チームの4年生卒業＋ロスター入れ替え
  // universityMode だけでなく社会人/独立モードでもTEAMS_DATA大学チームがある場合に実行
  // ※distributeHighSchoolGraduates より先に実行してプールから一般入部を選出する
  let universityGraduationReport = null;
  const hasPopulatedUniversityTeams = Object.values(teamsAfterRetirement).some(
    t => t?.universityData && (t.players?.length || 0) > 0
  );
  if (hasPopulatedUniversityTeams) {
    universityGraduationReport = processUniversityTeamGraduation(teamsAfterRetirement, seasonData, currentYear);
  }

  // 5.6. 高校生プールの残り（ドラフト漏れ）をランク別に進路振り分け
  // 高校生プールは4月に生成、10月ドラフトで上位が除去済み
  let hsDistribution = { university: {}, corporate: [], independent: [], retired: [] };
  if (highSchoolPool.players.length > 0) {
    hsDistribution = distributeHighSchoolGraduates(currentYear + 1);
    // ランク別に大学入学
    // ⚠ 名簿は `teamsAfterRetirement` 側に入れる（呼び出し側がこれで TEAMS_DATA を書き戻す）
    enrollInUniversity(hsDistribution.university, currentYear + 1, teamsAfterRetirement);
    // 社会人候補はリリースプールへ
    hsDistribution.corporate.forEach(p => {
      p.isStarter = false;
      p.battingOrder = 0;
      markFreshRoute(p, 'highschool', currentYear);   // 企業の入団ルート（高卒）
      addToReleasedPool(p);
    });
    // 独立候補もリリースプールへ
    hsDistribution.independent.forEach(p => {
      p.isStarter = false;
      p.battingOrder = 0;
      markFreshRoute(p, 'highschool', currentYear);
      addToReleasedPool(p);
    });
  }

  // 5.7. 独立・クラブの新陳代謝（独立は25歳から去り、実力があれば社会人・クラブへ。
  //      クラブは年齢で引退）。⚠ 補充（5.8〜）より前に置くこと——空いた枠を
  //      同じオフの新卒で埋めるため。自リーグは ContractScreen が担当するので除外
  {
    const turnover = processLowerTierTurnover(teamsAfterRetirement, currentYear, seasonData.settings?.teamNames || []);
    retirements.push(...turnover.retirements);
  }

  // 5.75. CPU社会人・独立チームの自動戦力外通告（非社会人モードのみ）
  // 社会人モードは CorporateDepartureScreen の AI 放出処理が担当するため除外
  if (!seasonData.settings?.corporateMode) {
    // 自リーグは ContractScreen（11/9）が担当済みなので除外する
    releaseCPUCorporatePlayers(teamsAfterRetirement, currentYear, seasonData.settings?.teamNames || []);
  }

  // ━━━ 入団優先度: S社会人 → A社会人 → 独立リーグ → B社会人 → C/D社会人 → クラブ ━━━

  // 5.8a. S/Aランク社会人AIチームのロスター補充（最優先: 高品質選手を先に確保）
  replenishCorporateRosters(teamsAfterRetirement, currentYear, ['S', 'A']);

  // 5.8b. 独立リーグAIチームの補充（S/Aに続いてプールから選択）
  replenishIndependentLeagueRosters(teamsAfterRetirement, currentYear);

  // 5.9. B/C/DランクAIチームのロスター補充（独立リーグ後の残り選手。C/Dはプロ意識・成長率も考慮）
  replenishCorporateRosters(teamsAfterRetirement, currentYear, ['B', 'C', 'D']);

  // 5.92. クラブチームへの選手供給（最後の受け皿: 社会人・独立に入れなかった選手）
  // ※旧 step 5.65 から移動 — クラブが最下位優先度になるよう社会人/独立の後に処理
  const clubTeamEntries = Object.entries(teamsAfterRetirement).filter(([, t]) => t.corporateData?.type === 'club');
  if (clubTeamEntries.length === 0 && universityGraduationReport?.clubGraduates?.length > 0) {
    // 大学モード: TEAMS_DATAにクラブチームがないため、club卒業生をリリースプールへ
    universityGraduationReport.clubGraduates.forEach(p => {
      p.isStarter = false;
      p.battingOrder = 0;
      addToReleasedPool(p);
    });
  }
  if (clubTeamEntries.length > 0) {
    // クラブ候補者収集
    const clubCandidatesRaw = [];
    if (universityGraduationReport?.clubGraduates) {
      clubCandidatesRaw.push(...universityGraduationReport.clubGraduates);
    }
    // 大学プール卒業生で「引退」判定の一部
    gradScored.forEach(entry => {
      if (entry.player.postGradPath === 'retired' && Math.random() < 0.3) {
        clubCandidatesRaw.push(entry.player);
      }
    });
    // 高校卒で「引退」判定の選手の一部
    if (hsDistribution.retired) {
      hsDistribution.retired.forEach(p => {
        if (Math.random() < 0.15) clubCandidatesRaw.push(p);
      });
    }
    // リリースプールから30歳以下の一部（企業・独立からの退団者）
    // ⚠ **今年独立を辞めた選手は全員をクラブの候補にすること**。社会人に拾われ
    //    なかった分の受け皿がここしか無い（1割の抽選だと実力があっても大半が消える）
    for (let i = releasedPlayersPool.length - 1; i >= 0; i--) {
      const p = releasedPlayersPool[i];
      const indLeaver = p._freshRoute === 'independent' && p._freshYear === currentYear;
      if (indLeaver || (p.age && p.age <= 30 && Math.random() < 0.1)) {
        clubCandidatesRaw.push(p);
        releasedPlayersPool.splice(i, 1);
      }
    }

    if (clubCandidatesRaw.length > 0) {
      // クラブ向け採点: 能力 + プロ意識 + 成長率（クラブはdisciplineが成長を左右するため）
      // ⚠ **能力は共有の `abilityZ` を使うこと**。ここも 投手 `球速×0.5+制球×0.3+…`
      //    （典型97）対 野手の加重平均（典型38）と投打で別スケールで、候補を
      //    この順に並べて空きクラブへ詰めるので**投手から先に入っていた**。
      const clubNorms = buildRecruitNorms(clubCandidatesRaw);
      const scoreForClub = (p) => {
        const disc = ((p.personality?.discipline ?? 50) - 50) / 18;
        const gp   = Math.max(0, (p.growthPotential || 1.0) - 1.0) / 0.2;
        return abilityZ(p, clubNorms) * 0.50 + disc * 0.35 + gp * 0.15;
      };

      // プロ意識が一定以上の選手のみクラブへ（あまりにも低い選手は野球から離れる）
      const clubCandidates = clubCandidatesRaw
        .filter(p => (p.personality?.discipline ?? 50) >= 35)
        .sort((a, b) => scoreForClub(b) - scoreForClub(a));

      const sortedClubs = clubTeamEntries
        .map(([name, team]) => ({ name, team, count: team.players?.length || 0 }))
        .sort((a, b) => a.count - b.count);

      const CLUB_ROSTER_CAP = 35;
      const CLUB_PITCHER_CAP = 0.45;   // これ以上の投手比のクラブには投手を入れない
      // 投手/野手バランスチェック用
      const getClubPitcherRatio = (clubInfo) => {
        const total    = clubInfo.team.players?.length || 0;
        const pitchers = (clubInfo.team.players || []).filter(p => p.position === 'pitcher').length;
        return total > 0 ? pitchers / total : 0.35;
      };

      // ⚠ **行き先は「その群が一番足りないクラブ」で選ぶこと**。以前は「人数が最も
      //    少ないクラブ」だけで選んでおり、捕手も野手の人数も見ていなかった。クラブの
      //    年齢引退が入ると人数が15人台へ縮み、8年目に **208チーム中191が野手9人未満 /
      //    52が捕手0人** になった（捕手0は引退を入れる前から51チームあった）。
      const groupOf = (p) => p.position === 'pitcher' ? 'pitcher' : p.position === 'catcher' ? 'catcher' : 'fielder';
      const groupCount = (c, g) => (c.team.players || []).filter(x => groupOf(x) === g).length;
      const placed = new Set();
      const placeInClub = (p, targetClub) => {
        p._nextYearTeam = targetClub.name;
        const player = { ...p };
        player.isStarter   = false;
        player.battingOrder = 0;
        player.careerHistory = [...(p.careerHistory || [])];
        player.careerHistory.push({ type: 'club_join', year: currentYear + 1, label: `${targetClub.name}入部` });
        addToRoster(targetClub.team, player);
        targetClub.count++;
        placed.add(p);
      };

      for (const p of clubCandidates) {
        // 人数が最も少ないクラブを選択（投手/野手バランスも考慮）
        const needsPitcher = sortedClubs.some(c => c.count < CLUB_ROSTER_CAP && getClubPitcherRatio(c) < 0.30);
        // ⚠ **フォールバックでも投手比の上限は外さないこと**。以前は
        //    `|| sortedClubs.find(c => c.count < CLUB_ROSTER_CAP)` と無条件だったので、
        //    **全クラブが45%を超えた瞬間に門番が効かなくなる**一方通行のラチェットに
        //    なっていた（実測 クラブの投手比 37%→63%、クラブが投手の吸い込み口）。
        //    上限に触れて入れない投手は、クラブにも入らず野球から離れる——
        //    「最後の受け皿」でも受けきれない、が正しい形。
        //    外していいのは「投手不足クラブには野手を回さない」という**優先**の方だけ。
        const fits = (c, strict) => {
          if (c.count >= CLUB_ROSTER_CAP) return false;
          const ratio = getClubPitcherRatio(c);
          if (p.position === 'pitcher' && ratio > CLUB_PITCHER_CAP) return false;
          if (strict && p.position !== 'pitcher' && needsPitcher && ratio < 0.25) return false;
          return true;
        };
        const g = groupOf(p);
        const pickNeediest = (strict) => {
          let best = null, bestKey = Infinity;
          for (const c of sortedClubs) {
            if (!fits(c, strict) || !c.team.players) continue;
            const key = groupCount(c, g) * 100 + c.count;   // 群が手薄 → 全体が少ない の順
            if (key < bestKey) { bestKey = key; best = c; }
          }
          return best;
        };
        const targetClub = pickNeediest(true) || pickNeediest(false);

        if (!targetClub) continue;
        placeInClub(p, targetClub);
        sortedClubs.sort((a, b) => a.count - b.count);
      }

      // 補充の底上げ: 捕手2人・野手10人（捕手込み）に届かないクラブは、今年野球を
      // 離れる高卒から地元の若手を迎える（クラブの実態＝地域の受け皿）。
      // ⚠ **ここを省くと人数が引退に負けて縮み続ける**（上記の実測）。
      const CLUB_MIN_CATCHERS = 2;
      const CLUB_MIN_FIELDERS = 10;
      const topUpPool = (hsDistribution.retired || [])
        .filter(p => !placed.has(p) && (p.personality?.discipline ?? 50) >= 35)
        .sort((a, b) => scoreForClub(b) - scoreForClub(a));
      const takeFromTopUp = (pred) => {
        const i = topUpPool.findIndex(pred);
        return i >= 0 ? topUpPool.splice(i, 1)[0] : null;
      };
      for (const c of sortedClubs) {
        if (!c.team.players) continue;
        while (groupCount(c, 'catcher') < CLUB_MIN_CATCHERS && c.count < CLUB_ROSTER_CAP) {
          const p = takeFromTopUp(x => x.position === 'catcher');
          if (!p) break;
          placeInClub(p, c);
        }
        while (c.team.players.filter(x => x.position !== 'pitcher').length < CLUB_MIN_FIELDERS
               && c.count < CLUB_ROSTER_CAP) {
          const p = takeFromTopUp(x => x.position !== 'pitcher');
          if (!p) break;
          placeInClub(p, c);
        }
      }
    }
  }

  // 5.95. リリースプール整理: 33歳以上を先に除去してからサイズ上限を適用
  {
    const beforeAge = releasedPlayersPool.filter(p => (p.age || 0) < 33);
    if (beforeAge.length !== releasedPlayersPool.length) {
      replaceReleasedPool(beforeAge);
    }
    const poolCap = seasonData.settings?.universityMode ? 300 : 400;
    if (releasedPlayersPool.length > poolCap) {
      // ⚠ **ここも投打で別スケールだった**。旧式は 投手 `球速+制球×0.5`（典型155）
      //    対 野手 `ミート+パワー+走×0.3`（典型90）で、400人へ削るたびに
      //    **投手だけが残り野手が捨てられて**いた。共有の `abilityZ` で揃える。
      const poolNorms = buildRecruitNorms(releasedPlayersPool);
      const scoredPool = releasedPlayersPool.map((p, i) => ({ p, i, s: abilityZ(p, poolNorms) }))
        .sort((a, b) => b.s - a.s).slice(0, poolCap);
      const keep = new Set(scoredPool.map(e => e.i));
      const trimmed = releasedPlayersPool.filter((_, i) => keep.has(i));
      replaceReleasedPool(trimmed);
    }
  }

  // 5.98. 卒業レポートに nextYearTeam を転記（5.9/5.92 の配属完了後）
  // 実際の配属先チームのタイプに合わせて path ラベルも更新する
  if (universityGraduationReport?.graduated) {
    universityGraduationReport.graduated.forEach(entry => {
      if (entry._playerRef?._nextYearTeam) {
        entry.nextYearTeam = entry._playerRef._nextYearTeam;
        const destTeam = teamsAfterRetirement[entry.nextYearTeam];
        if (destTeam) {
          if (destTeam.independentLeagueId) entry.path = 'independent';
          else if (destTeam.corporateData?.type === 'club') entry.path = 'club';
          else if (destTeam.corporateData) entry.path = 'corporate';
        }
      }
      delete entry._playerRef;
    });
  }

  // 6. 新シーズンデータ作成
  const newYear = seasonData.year + 1;
  const newSeasonData = createSeasonData(newYear);
  newSeasonData.settings = { ...seasonData.settings };

  // 社会人モード: トーナメントシード引き継ぎ
  if (seasonData.settings?.corporateMode) {
    newSeasonData.schedule = [];
    newSeasonData.standings = [];
    newSeasonData.tournamentSeeds = extractTournamentSeeds(seasonData);
    // 前年都市対抗チャンピオン引き継ぎ
    if (seasonData.toshitaikou?.mainTournament?.champion) {
      newSeasonData.prevToshitaikouChampion = seasonData.toshitaikou.mainTournament.champion;
    }
    // 大会結果アーカイブ
    const prevHistory = seasonData.tournamentHistory || [];
    const yearRecord = { year: seasonData.year, calendarYear: seasonData.currentDate?.year };
    const rt = seasonData.regionalTournament;
    if (rt?.phase === 'done' && rt.brackets) {
      yearRecord.regional = {};
      Object.entries(rt.brackets).forEach(([rid, region]) => {
        yearRecord.regional[rid] = { regionName: region.regionName, champion: region.champion };
      });
    }
    const td = seasonData.toshitaikou;
    if (td?.generated) {
      yearRecord.toshitaikou = { champion: td.champion, runnerUp: td.runnerUp };
      if (td.qualifiers) {
        yearRecord.toshitaikouQualifiers = {};
        Object.entries(td.qualifiers).forEach(([rid, q]) => {
          yearRecord.toshitaikouQualifiers[rid] = { regionName: q.regionName, qualifiedTeams: q.qualifiedTeams || [] };
        });
      }
    }
    const ns = seasonData.nihonSenshuken;
    if (ns?.generated) {
      yearRecord.senshuken = { champion: ns.champion, runnerUp: ns.runnerUp };
    }
    const cs = seasonData.clubSenshuken;
    if (cs?.generated) {
      yearRecord.club = { champion: cs.champion, runnerUp: cs.runnerUp };
    }
    newSeasonData.tournamentHistory = [...prevHistory, yearRecord];
  } else if (seasonData.settings?.universityMode) {
    // 大学モード: 新シーズンのスケジュール・順位表は大学リーグの再初期化の後で取得する（下）
    // 大会結果アーカイブ
    const prevHistory = seasonData.tournamentHistory || [];
    const yearRecord = { year: seasonData.year, calendarYear: seasonData.currentDate?.year };
    if (seasonData.universityChampionship?.phase === 'done') {
      yearRecord.universityChampionship = {
        champion: seasonData.universityChampionship.champion,
        runnerUp: seasonData.universityChampionship.runnerUp,
      };
    }
    if (seasonData.meijiJingu?.phase === 'done') {
      yearRecord.meijiJingu = {
        champion: seasonData.meijiJingu.champion,
        runnerUp: seasonData.meijiJingu.runnerUp,
      };
    }
    newSeasonData.tournamentHistory = [...prevHistory, yearRecord];
    if (universityGraduationReport) {
      // NPB の指名も入れておく（レポートの途中の保存を読み直したとき、オフシーズンの画面が
      // 前の年のデータを持たずにレポートを出し直すため。`isYearAdvanced` を参照）
      newSeasonData.universityGraduationReport = {
        ...universityGraduationReport,
        npbDrafted: seasonData.universityNpbDrafted || [],
      };
    }
  } else {
    // 独立リーグモード: リーグ優勝・プレーオフ結果をアーカイブ
    const prevHistory = seasonData.tournamentHistory || [];
    const yearRecord = { year: seasonData.year, calendarYear: seasonData.currentDate?.year };
    if (awards.champion) yearRecord.leagueChampion = awards.champion;
    // プレーオフ決勝の優勝チームを集計
    // ⚠ 引き分けを「ビジターの勝ち」と数えないこと（以前はそう数えて、シリーズを
    //    勝っていないチームを優勝として残すことがあった）。決め方は順位表側と同じ
    const playoffChampion = getPlayoffChampion(seasonData.schedule || []);
    if (playoffChampion) yearRecord.playoffChampion = playoffChampion;
    newSeasonData.tournamentHistory = [...prevHistory, yearRecord];
    // スケジュールはレギュレーション設定後に生成
    const teams = Object.keys(teamsAfterRetirement);
    newSeasonData.schedule = [];
    newSeasonData.standings = initializeStandings(teams);
  }

  // 年齢カーブの結果を新シーズンデータに保存（キャンプ画面で表示用）
  newSeasonData.ageReports = ageReports;
  // 大学プールの状態を記録
  const uniEnrollCount = Object.values(hsDistribution.university).reduce((sum, arr) => sum + arr.length, 0);
  const gradCorpCount = gradScored.filter(e => e.player.postGradPath === 'corporate').length;
  const gradIndCount = gradScored.filter(e => e.player.postGradPath === 'independent').length;
  const gradRetiredCount = gradScored.filter(e => e.player.postGradPath === 'retired').length;
  newSeasonData.universityReport = {
    graduated: uniReport.graduated,
    newEnrollment: uniEnrollCount,
    corporateCount: hsDistribution.corporate.length,
    independentCount: hsDistribution.independent.length,
    retiredCount: hsDistribution.retired.length,
    growing: uniReport.grown,
    gradPaths: { corporate: gradCorpCount, independent: gradIndCount, retired: gradRetiredCount },
  };

  // 大学リーグの入替戦 → 新シーズン初期化 + 社会人トーナメント結果リセット
  let universityPromotions = [];
  if (WORLD_DATA.initialized) {
    // 大学モード2部制: ユーザー部の成績をWORLD_DATAの秋季順位表に同期してから入替戦判定
    // （ユーザー部の試合はseasonData.standingsにのみ記録され、WORLD_DATA側は0のまま。
    //   またleague.fall.doneも立たないためprocessUniversityPromotionRelegationがスキップする）
    if (seasonData.settings?.universityMode && WORLD_DATA.universityLeague) {
      const ul = WORLD_DATA.universityLeague;
      const regionId = ul.userRegion || seasonData.settings?.universityRegion;
      const userDiv = ul.userDivision || 1;
      const uLeague = WORLD_DATA.universityLeagues?.[regionId];
      if (uLeague?.divisions && uLeague.fall) {
        const standingsKey = `standings${userDiv}`;
        if (uLeague.fall[standingsKey] && seasonData.standings?.length) {
          uLeague.fall[standingsKey].forEach(s => {
            const found = seasonData.standings.find(st => st.team === s.team);
            if (found) {
              s.wins = found.wins || 0;
              s.losses = found.losses || 0;
              s.draws = found.draws || 0;
              s.winRate = found.winRate || 0;
              s.gamesPlayed = found.gamesPlayed || 0;
            }
          });
          uLeague.fall[standingsKey].sort(compareStandings);
        }
        uLeague.fall.done = true;
      }
    }
    universityPromotions = processUniversityPromotionRelegation();
    const nextCalendarYear = newSeasonData.currentDate?.year || 2025;
    initializeUniversityLeagues(nextCalendarYear);
    resetIndependentLeagueSchedules(nextCalendarYear);
    WORLD_DATA.corporateToshitaikou = null;
    WORLD_DATA.corporateNihonSenshuken = null;
    WORLD_DATA.corporateClubSenshuken = null;
    WORLD_DATA.corporateRegionalTournament = null;
    WORLD_DATA._universityScout = null;
  }

  // 大学モード: リーグ再初期化後にスケジュール・順位表を設定
  if (seasonData.settings?.universityMode) {
    const regionId = seasonData.settings.universityRegion;
    newSeasonData.schedule = getUniversityLeagueSchedule(regionId);
    // 入替でユーザーの部が変わった場合、settings.teamNamesも更新
    const leagueTeams = WORLD_DATA.universityLeague?.leagueTeams || seasonData.settings.teamNames;
    newSeasonData.standings = getUniversityLeagueStandings(regionId, leagueTeams);
    newSeasonData.settings.teamNames = [...leagueTeams];
    newSeasonData.settings.teamsCount = leagueTeams.length;
    newSeasonData.settings.teamAbbreviations = leagueTeams.map(n => n.slice(0, 3));
  }

  // ランク変動レポートを新シーズンデータに保存
  if (rankChanges.length > 0) {
    newSeasonData.rankChanges = rankChanges;
  }

  // スタッフ退職レポートを新シーズンデータに保存
  if (staffRetirements.length > 0) {
    newSeasonData.staffRetirements = staffRetirements;
  }

  // 赤字ペナルティレポート（BudgetSettlementScreenで設定済みの場合のみ引き継ぐ）
  if (seasonData.deficitPenalties?.length > 0) {
    newSeasonData.deficitPenalties = seasonData.deficitPenalties;
  }

  if (universityPromotions.length > 0) {
    newSeasonData.universityPromotions = universityPromotions;
  }

  return {
    newSeasonData,
    updatedTeams: teamsAfterRetirement,
    awards,
    retirements,
    ageReports,
    rankChanges,
    universityGraduationReport,
    universityPromotions,
  };
};

/**
 * 箱庭モード用の次年度移行
 * 成長・加齢・引退をスキップし、表彰とスタッツリセットのみ行う
 * @param {Object} seasonData - 現在のシーズンデータ
 * @param {Object} allTeams - 全チームデータ
 * @returns {Object} - { newSeasonData, updatedTeams, awards, retirements: [] }
 */
export function advanceToNextYearSandbox(seasonData, allTeams) {
  // 1. シーズン終了処理（表彰）- 確定済みのfrozenAwardsがあればそれを使用
  const awards = seasonData.frozenAwards || processSeasonEnd(seasonData, allTeams);

  // 2. タイトルを選手に記録
  let updatedTeams = recordAwardsToPlayers(allTeams, awards, seasonData.settings?.gamesPerSeason || seasonData.schedule?.length || 0, seasonData.settings?.teamNames);

  // 3. シーズン統計を通算に加算してリセット
  updatedTeams = resetSeasonStats(updatedTeams, seasonData.year);

  // 箱庭モード: 加齢・成長・引退はスキップ

  // 4. 新シーズンデータ作成
  const newYear = seasonData.year + 1;
  const newSeasonData = createSeasonData(newYear);
  newSeasonData.settings = { ...seasonData.settings };

  const teams = Object.keys(updatedTeams);
  newSeasonData.schedule = [];
  newSeasonData.standings = initializeStandings(teams);

  if (WORLD_DATA.initialized) {
    const nextCalYear = newSeasonData.currentDate?.year || 2025;
    initializeUniversityLeagues(nextCalYear);
    resetIndependentLeagueSchedules(nextCalYear);
  }

  return {
    newSeasonData,
    updatedTeams,
    awards,
    retirements: [],
    ageReports: {}
  };
};

/**
 * シーズン開始時に全選手の能力値をスナップショットとして記録
 * キャンプ完了（開幕直前）に呼び出す
 */
export function snapshotAbilityHistory(allTeams, year) {
  Object.values(allTeams).forEach(team => {
    if (!team.players) return;
    team.players.forEach(player => {
      if (!player.growthHistory) player.growthHistory = [];
      // 同じ年の記録が既にあれば上書き
      const existing = player.growthHistory.findIndex(h => h.year === year);
      const snapshot = {
        year,
        meet:     player.batting?.meet     || 0,
        power:    player.batting?.power    || 0,
        speed:    player.physical?.speed   || 0,
        arm:      player.physical?.arm     || 0,
        defense:  player.fielding?.defense || 0,
        velocity: player.pitching?.velocity || 0,
        control:  player.pitching?.control  || 0,
        stamina:  player.pitching?.stamina  || 0,
      };
      if (existing !== -1) {
        player.growthHistory[existing] = snapshot;
      } else {
        player.growthHistory.push(snapshot);
      }
    });
  });
}
