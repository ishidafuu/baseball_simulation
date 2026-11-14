import { projectPlayerInfo, projectTeamInfo } from './projection.mjs';
import { storedGame, statisticsContext, slimGame } from './recordedViews.mjs';
export function buildArchiveIndex(bundle, retainedYears = []) {
  const league = bundle.league;
  if (!league) return null;
  const players = {};
  // ⚠ 成績の文脈（全試合をなめて作る）は全員で1つ。1人ごとに作ると
  //    参加者×24人ぶん、保存のたびに全試合をなめ直す
  const context = league.members.length ? statisticsContext(league) : null;
  for (const member of league.members) {
    players[member.userId] = {};
    for (const p of league.game.teams[member.teamName].players) {
      const info = projectPlayerInfo(bundle, member.userId, p.id, context);
      delete info.revision;
      players[member.userId][p.id] = info;
    }
  }
  const teams = buildTeamsIndex(bundle);
  const games = {};
  const years = new Set([
    league.season.year,
    ...Object.keys(league.records?.seasons || {}).map(Number),
  ]);
  for (const year of years) {
    if (retainedYears.includes(String(year))) continue;
    const ids = new Set(
      Object.keys(league.records?.seasons?.[year]?.games || {}),
    );
    if (year === league.season.year)
      for (const game of league.season.results) ids.add(String(game.gameId));
    // 勝敗投手は id と名前だけ（`slimGame`。索引が試合の数×約4KB 軽くなる）
    games[year] = Object.fromEntries(
      [...ids].map((id) => [id, slimGame(storedGame(league, id, year))]),
    );
  }
  return { players, teams, games };
}
/**
 * 球団の索引（他球団を開いたときの球団情報）だけ。
 * ⚠ 球団情報には**今の起用**（打順・ローテ・役割）が入るので、編成の保存でも作り直す。
 *    選手・試合の索引（全試合をなめて重い）は編成の保存では変わらないので、
 *    保存側は `archiveUnchanged` のときこれだけ作り直す（`supabaseStore.attemptCommand`）
 */
export function buildTeamsIndex(bundle) {
  const league = bundle.league;
  if (!league) return null;
  return Object.fromEntries(
    (league.members.length ? league.season.settings.teamNames : []).map(
      (name) => [name, projectTeamInfo(bundle, league.members[0].userId, name)],
    ),
  );
}
export function archiveReferences(meta) {
  return new Set(
    [meta, ...(meta?.previous || [])]
      .filter(Boolean)
      .flatMap((index) => [
        index.players?.path,
        index.teams?.path,
        ...Object.values(index.games || {}).map((x) => x.path),
      ])
      .filter(Boolean),
  );
}
