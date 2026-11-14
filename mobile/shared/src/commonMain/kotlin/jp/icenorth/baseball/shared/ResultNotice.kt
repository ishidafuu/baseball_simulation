package jp.icenorth.baseball.shared

/**
 * 試合結果の通知（端末の中で出す。サーバーからは送らない）。
 *
 * アプリが裏で15分ごとにビューを読み、自球団の直近の試合（`recentGames`）に
 * **前に見た覚えの無い試合**があれば知らせる。
 *
 * ⚠ 「見た」の印は**直近の試合の鍵の集まり**で持つ（[resultKeys]）。毎回いまの5試合に置き換えるので、
 *    窓から外れた古い試合は気にしなくてよい。アプリを開いて画面で見た試合も同じ印に入れる（二重に知らせない）。
 * ⚠ 印がまだ無い（入れた直後・ログインし直した直後）ときは知らせずに印だけ付ける。今季の試合をまとめて知らせないため。
 */
data class ResultNotice(val title: String, val body: String, val games: Int)

/** 試合の見分け（日付・番号・対戦）。id だけだと年をまたいだときに重なりうるので日付も入れる */
fun OwnGame.noticeKey(): String = "${date?.dayKey() ?: 0}:${id ?: number ?: 0}:$away@$home"

/** いまの直近の試合（結果の出たものだけ）の鍵 */
fun resultKeys(view: LeagueView): Set<String> =
    view.recentGames.filter { it.homeScore != null && it.awayScore != null }.map { it.noticeKey() }.toSet()

/**
 * 知らせる中身。新しい試合が無い・印がまだ無いときは null。
 * 新しい試合が2つ以上（電波が無かった間に進んだなど）なら1つの通知にまとめる。
 */
fun resultNotice(view: LeagueView, seen: Set<String>?): ResultNotice? {
    if (seen == null) return null
    val team = view.teamName ?: return null
    val fresh = view.recentGames.filter { it.homeScore != null && it.awayScore != null && it.noticeKey() !in seen }
    if (fresh.isEmpty()) return null
    val place = placeText(view, team)
    if (fresh.size == 1) {
        val g = fresh.single()
        val line = scoreLine(view, g, team)
        val details = listOfNotNull(decisionText(g), homerunText(view, g, team)).joinToString("\n")
        return ResultNotice(line, listOfNotNull(details.ifEmpty { null }, place).joinToString("\n"), 1)
    }
    val wins = fresh.count { outcome(it, team) == 1 }
    val losses = fresh.count { outcome(it, team) == -1 }
    val draws = fresh.size - wins - losses
    val record = "${wins}勝${losses}敗" + if (draws > 0) "${draws}分" else ""
    return ResultNotice(
        "${fresh.size}試合の結果（$record）",
        (fresh.map { scoreLine(view, it, team) } + listOfNotNull(place)).joinToString("\n"),
        fresh.size,
    )
}

/** 1 勝ち・-1 負け・0 引き分け */
private fun outcome(g: OwnGame, team: String): Int {
    val ours = (if (g.home == team) g.homeScore else g.awayScore) ?: 0
    val theirs = (if (g.home == team) g.awayScore else g.homeScore) ?: 0
    return ours.compareTo(theirs).coerceIn(-1, 1)
}

/** 「○ 5-3 美瑛（第42戦）」 */
private fun scoreLine(view: LeagueView, g: OwnGame, team: String): String {
    val ours = if (g.home == team) g.homeScore else g.awayScore
    val theirs = if (g.home == team) g.awayScore else g.homeScore
    val mark = when (outcome(g, team)) { 1 -> "○"; -1 -> "●"; else -> "△" }
    val opp = view.teamShort(if (g.home == team) g.away else g.home)
    val nth = g.number?.let { "（第${it}戦）" }.orEmpty()
    return "$mark $ours-$theirs $opp$nth"
}

private fun decisionText(g: OwnGame): String? {
    val d = g.decisions ?: return null
    return listOfNotNull(
        d.winningPitcher?.name?.let { "勝 $it" },
        d.losingPitcher?.name?.let { "敗 $it" },
        d.savePitcher?.name?.let { "S $it" },
    ).joinToString("  ").ifEmpty { null }
}

/** 自球団の本塁打だけ（「本塁打 田中12号・鈴木」） */
private fun homerunText(view: LeagueView, g: OwnGame, team: String): String? {
    val ours = g.homeruns?.filter { it.team == team && it.name != null }.orEmpty()
    if (ours.isEmpty()) return null
    return "本塁打 " + ours.joinToString("・") { h -> h.name + (h.number?.let { "${it}号" } ?: "") }
}

/** 「1部2位（首位と3差）」 */
private fun placeText(view: LeagueView, team: String): String? {
    val league = view.teamLeagues[team]
    val table = view.leagueTable(league)
    val rank = table.indexOfFirst { it.team == team }
    val mine = table.getOrNull(rank) ?: return null
    val name = league?.let { LEAGUE_NAMES[it] } ?: ""
    val record = "${mine.wins}勝${mine.losses}敗" + if (mine.draws > 0) "${mine.draws}分" else ""
    val behind = if (rank == 0) "" else "（首位と${gb(gamesBehind(table.first(), mine))}差）"
    return "$record ${name}${rank + 1}位$behind"
}
