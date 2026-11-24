// ============================================================
// 全国大会成績を選手の経歴(careerHistory)に記録する
// 例: { type:'achievement', year:3, grade:3, team:'○○大学',
//       tournament:'明治神宮大会', result:'優勝' }
// → 表示側で「○○大学3年時 明治神宮大会 優勝」等に整形する。
//
// 記録タイミングはトーナメントの決着時（recordResult / autoPlayGrandChampionship）。
// 優勝チームと準優勝チームの在籍選手に付与する。
// ============================================================

import { TEAMS_DATA } from '../teams-data.js';
import { universityPool } from '../state/schoolPools.js';

const clampGrade = (g) => Math.max(1, Math.min(4, g));

/**
 * 優勝/準優勝チームの在籍選手に大会成績を記録する。
 * @param {string} teamName - 対象チーム名
 * @param {Object} opts
 *   - tournament: 大会名（例 '明治神宮大会'）
 *   - gameYear: ゲーム年（学年計算に使用。1,2,...）
 *   - isRunnerUp: 準優勝なら true
 */
export function recordTeamAchievement(teamName, { tournament, gameYear, isRunnerUp = false } = {}) {
  if (!teamName || !tournament) return;
  const result = isRunnerUp ? '準優勝' : '優勝';

  const tag = (player, grade) => {
    if (!player) return;
    if (!Array.isArray(player.careerHistory)) player.careerHistory = [];
    // 重複防止（同一大会・同一年・同一結果）
    const dup = player.careerHistory.some(e =>
      e.type === 'achievement' && e.tournament === tournament && e.year === gameYear && e.result === result);
    if (dup) return;
    player.careerHistory.push({
      type: 'achievement',
      year: gameYear ?? null,
      grade: grade || null,
      team: teamName,
      tournament,
      result,
    });
  };

  // 1) TEAMS_DATA に実在するチーム（自チーム・運営大学・社会人・独立）
  const team = TEAMS_DATA[teamName];
  if (team?.players?.length) {
    const isUni = !!team.universityData;
    team.players.forEach(p => {
      // 大学は年齢から学年を近似（18→1年 … 21→4年）。それ以外は学年なし。
      const grade = isUni ? clampGrade((p.age || 18) - 17) : null;
      tag(p, grade);
    });
    return;
  }

  // 2) 世界の大学（universityPool に所属する選手）
  for (const enrollYear of Object.keys(universityPool)) {
    const cohort = universityPool[enrollYear];
    if (!cohort) continue;
    for (const entry of cohort) {
      if (entry.universityTeamName !== teamName) continue;
      const grade = (gameYear != null) ? clampGrade(gameYear - entry.enrollYear + 1) : null;
      tag(entry.player, grade);
    }
  }
}

/** ブラケット決着時に呼ぶ: 優勝・準優勝の両チームを記録 */
export function recordBracketAchievements(bracket, championName, runnerUpName) {
  if (!bracket?.achievementTournament) return;
  if (bracket._achievementsRecorded) return;
  bracket._achievementsRecorded = true;
  const tournament = bracket.achievementTournament;
  const gameYear = bracket.achievementGameYear;
  if (championName) recordTeamAchievement(championName, { tournament, gameYear });
  if (runnerUpName) recordTeamAchievement(runnerUpName, { tournament, gameYear, isRunnerUp: true });
}
