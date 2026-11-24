// ============================================================
// 社会人野球 退団システム (corporateDepartures.js)
// 11月末に引退+戦力外通告。
// ⚠ もとは scoutingSystem.js（入団のスカウト）の頭にあった。引退の判定のためだけに
//    スカウトの側が年度更新（yearProgressionSystem.js）を読んでいたので分けた（2026-11-24）。
// ============================================================

import { addToReleasedPool } from '../state/pools.js';
import { checkRetirement } from '../season/yearProgressionSystem.js';

// ============================================================
// 退団システム
// ============================================================

/**
 * 社会人チームの退団処理（11月末）
 * - 自動引退判定
 * - AI自動戦力外
 * @param {Object} allTeams - TEAMS_DATA
 * @param {string} userTeamName - ユーザーチーム名
 * @returns {{ retirements: Array, aiReleases: Object }}
 */
export function processCorporateRetirements(allTeams, userTeamName) {
  const retirements = [];
  const aiReleases = {};

  Object.entries(allTeams).forEach(([teamName, team]) => {
    if (!team?.players) return;
    // ⚠ **大学は対象外**。大学に戦力外という概念は無く、
    // `processUniversityTeamGraduation`（卒業のみ）が担当する。
    // 以前はここで全 TEAMS_DATA を回しており、234校から毎年7人前後——
    // 実測で**4136名/年**（1〜3年生を能力で切っていた）を放出していた。
    // 独立モードの `ContractScreen` で踏んだのと同じ穴。
    if (team.universityData) return;

    const retired = [];
    team.players.forEach(player => {
      const result = checkRetirement(player);
      if (result.shouldRetire) {
        retired.push({
          id: player.id,
          name: player.name,
          team: teamName,
          age: player.age,
          position: player.position,
          reason: result.reason,
          hallOfFame: result.hallOfFame,
          careerStats: player.careerStats
        });
      }
    });

    if (retired.length > 0) {
      retirements.push(...retired);
    }

    // AIチームの自動戦力外
    // ⚠ 独立は `processLowerTierTurnover`（年度替わり）が唯一の担当。
    //    ここでも切ると同じチームから年に二度放出することになる
    if (teamName !== userTeamName && !team.independentLeagueId) {
      const releases = getCorporateAIReleases(team.players, retired.map(r => r.id));
      if (releases.length > 0) {
        aiReleases[teamName] = releases;
      }
    }
  });

  return { retirements, aiReleases };
}

const CORPORATE_MIN_ROSTER = 18;
export const CORPORATE_TARGET_ROSTER = 24;

/**
 * AIチームの戦力外候補を選出
 */
function getCorporateAIReleases(players, retiredIds) {
  const active = players.filter(p => !retiredIds.includes(p.id));
  if (active.length <= CORPORATE_MIN_ROSTER) return [];

  const maxRelease = Math.max(0, active.length - CORPORATE_MIN_ROSTER);
  const targetRelease = Math.max(0, active.length - CORPORATE_TARGET_ROSTER);
  const releaseCount = Math.min(maxRelease, Math.max(1, targetRelease + 1));

  const scored = active.map(p => {
    let score = 0;
    const age = p.age || 20;
    const isPitcher = p.position === 'pitcher';

    if (age >= 38) score += 50;
    else if (age >= 36) score += 40;
    else if (age >= 34) score += 25;
    else if (age >= 32) score += 15;
    else if (age >= 30) score += 10;

    if (isPitcher) {
      const overall = ((p.pitching?.velocity || 130) - 115) * 2 + (p.pitching?.control || 50) + ((p.pitching?.stamina || 100) / 2);
      if (overall / 3 < 35) score += 30;
      else if (overall / 3 < 45) score += 15;
    } else {
      const overall = ((p.batting?.meet||0) + (p.batting?.power||0) + (p.physical?.speed||0) + (p.physical?.arm||0) + (p.fielding?.defense||0)) / 5;
      if (overall < 35) score += 30;
      else if (overall < 45) score += 15;
    }

    // 出場が少ない選手
    const games = (p.seasonStats?.batting?.games || 0) + (p.seasonStats?.pitching?.games || 0);
    if (games === 0) score += 20;
    else if (games < 5) score += 10;

    return { id: p.id, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, releaseCount).map(s => s.id);
}

/**
 * 退団を確定する（引退+戦力外選手をロスターから除外、プールに追加）
 * @param {Object} allTeams - TEAMS_DATA
 * @param {Array} retiredIds - 引退選手ID配列
 * @param {Object} releases - { teamName: [playerId, ...] } 戦力外選手
 * @param {number} currentYear - 現在の年
 */
export function executeDepartures(allTeams, retiredIds, releases, currentYear) {
  const retiredSet = new Set(retiredIds);

  Object.entries(allTeams).forEach(([teamName, team]) => {
    if (!team?.players) return;
    const releaseIds = new Set(releases[teamName] || []);

    team.players.forEach(p => {
      if (releaseIds.has(p.id) && !retiredSet.has(p.id)) {
        const age = p.age || 20;
        if (age < 35) {
          const snapshot = JSON.parse(JSON.stringify(p));
          snapshot.isStarter = false;
          snapshot.battingOrder = 0;
          snapshot.releasedYear = currentYear;
          snapshot.previousTeam = teamName;
          snapshot.attemptsInPool = 0;
          if (!snapshot.careerHistory) snapshot.careerHistory = [];
          snapshot.careerHistory.push({ type: 'released', year: currentYear, label: `${teamName}退団` });
          addToReleasedPool(snapshot);
        }
      }
    });

    const removeIds = new Set([...retiredSet, ...releaseIds].filter(id =>
      team.players.some(p => p.id === id)
    ));
    team.players = team.players.filter(p => !removeIds.has(p.id));
  });
}
