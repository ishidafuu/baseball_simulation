/**
 * 一人用の年度末と開幕の手順（全モード共通）。
 *
 * ⚠ 以前は `ManagementScreen.jsx`（2年目以降）と `GameFlowScreens.jsx`（新しいゲーム）に
 *    同じ手順が8回写してあった（監査 2026-11-23 の「大きな整理の候補」7）。
 *    写しごとの違いは引数で残している。**既定を変えないこと**（動きが変わる）:
 *      - `resetCondition` … 2年目以降のキャンプ明け（通常・独立）だけ調子を作り直さない
 *      - `preserveUserLineup` … 2年目以降は自分で組んだ打順を保つ。新しいゲームは推奨で上書き
 *      - `snapshotYear` … 能力の記録（`growthHistory`）は2年目以降の開幕だけ。新しいゲームは取らない
 *      - `regional` … 社会人・クラブだけ地域トーナメントを作る（`seeds` は前年の結果）
 * オンラインの開幕は `server/leagueEngine.mjs` のキャンプ明けで、日付とフェーズだけ
 * `openingDayFields` を共にしている（調子の作り直しと打順はサーバーの手順がある）。
 */
import { TEAMS_DATA } from '../teams-data.js';
import { calendarYearOf, openingDayFields } from './seasonManager.js';
import { initializeAllPlayersCondition } from '../game/condition.js';
import { generateAILineup, setRecommendedLineup } from '../game/autoSimulation.js';
import { generatePitchingRotation, ensureAllTeamsReady } from '../game/lineupGenerator.js';
import { snapshotAbilityHistory, snapshotRankings } from './yearProgressionSystem.js';
import { generateRegionalTournament } from '../corporate/toshitaikou.js';
import { soloSeasonEnd } from './soloChronicle.js';

/**
 * 開幕の準備（全球団のローテと打順・調子・能力の記録・地域トーナメント）をして、
 * `seasonData` に足す項目を返す（開幕の日・フェーズ・地域トーナメント）。
 * 順番（調子→ローテと打順→記録→トーナメント）は写しのときのまま。
 */
export function openSoloSeason({
  userTeamName,
  year,
  resetCondition = true,
  preserveUserLineup = false,
  snapshotYear = null,
  regional = null,
}) {
  if (resetCondition) initializeAllPlayersCondition();
  ensureAllTeamsReady({
    userTeamName, generatePitchingRotation, setRecommendedLineup, generateAILineup,
    preserveUserLineup,
  });
  if (snapshotYear != null) snapshotAbilityHistory(TEAMS_DATA, snapshotYear);
  const fields = openingDayFields(year);
  if (regional) {
    const rt = generateRegionalTournament({
      userTeamName,
      calendarYear: calendarYearOf(year || 1),
      seeds: regional.seeds || null,
    });
    fields.regionalTournament = { ...rt, generated: true };
  }
  return fields;
}

/**
 * その年の表彰と最終順位を確定する（まだなら）。`seasonData` に足す項目を返す（無ければ空）。
 * ⚠ プロ指名・年度更新で選手が名簿から抜ける**前**に呼ぶこと。
 */
export function soloSeasonEndFreeze(seasonData) {
  const update = {};
  if (!seasonData.frozenAwards) update.frozenAwards = soloSeasonEnd(seasonData, TEAMS_DATA);
  if (!seasonData.finalRankings) update.finalRankings = snapshotRankings(TEAMS_DATA, seasonData.settings?.teamNames);
  return update;
}
