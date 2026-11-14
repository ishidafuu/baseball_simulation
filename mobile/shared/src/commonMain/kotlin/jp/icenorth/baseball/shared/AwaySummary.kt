package jp.icenorth.baseball.shared

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.putJsonArray

/**
 * 留守中のまとめ（前に開いたときのビューと今のビューを比べた文の並び）。変わったことが無ければ null。
 * Web 版 `src/online/awaySummary.js` の写し。ビューは生の形（端末に残した JSON）で比べる。
 *
 * ⚠ 文を変えたら Web 版も直す。`mobile/tools/expect-social.mjs` が書き出す答えと `SocialTest` で照らし合わせる。
 */
fun awaySummary(before: JsonObject?, after: JsonObject?): List<String>? {
    if (before == null || after == null) return null
    val team = after.at("teamName").str()
    if (team == null || before.at("teamName").str() != team) return null
    if (before.at("revision").num() == after.at("revision").num()) return null
    val lines = mutableListOf<String>()
    val year = after.at("year").int()
    if (year != before.at("year").int()) {
        lines += "${year}年目に入りました"
    } else {
        val a = ownStanding(before)
        val b = ownStanding(after)
        val games = played(b) - played(a)
        if (a != null && b != null && games > 0) {
            val wins = (b.at("wins").int() ?: 0) - (a.at("wins").int() ?: 0)
            val losses = (b.at("losses").int() ?: 0) - (a.at("losses").int() ?: 0)
            val draws = (b.at("draws").int() ?: 0) - (a.at("draws").int() ?: 0)
            lines += "${games}試合 ${wins}勝${losses}敗${if (draws > 0) "${draws}分" else ""}"
        }
        val from = divisionRank(before)
        val to = divisionRank(after)
        val division = LEAGUE_NAMES[after.at("teamLeagues", team).str()] ?: ""
        if (from != null && to != null && from != to && games > 0) lines += "$division${from}位→${to}位"
        else if (to != null && games > 0) lines += "$division${to}位"
    }
    // 自球団の節目の記録（通算100安打など）
    val milestoneKey = { m: JsonObject -> "${m.at("year").int()}:${m.at("playerId").long()}:${m.at("label").str()}" }
    val seen = before.at("chronicle", "milestones").list().mapNotNull { it.obj() }.map(milestoneKey).toSet()
    val fresh = after.at("chronicle", "milestones").list().mapNotNull { it.obj() }
        .filter { it.at("team").str() == team && milestoneKey(it) !in seen }
    fresh.take(2).forEach { lines += "${it.at("name").str().orEmpty()}が${it.at("label").str().orEmpty()}" }
    if (fresh.size > 2) lines += "ほか節目の記録${fresh.size - 2}件"
    // 手続きが始まった
    val phase = after["phase"].obj()
    val label = phase?.at("label").str()
    if (phase != null && phase.at("id").str() != before.at("phase", "id").str() && !label.isNullOrEmpty()) lines += "${label}が始まりました"
    // 返事が要るトレード（新しく届いたもの）
    val tradeKey = { t: JsonObject -> "${t.at("id").str()}:${t.at("updatedAt").str()}" }
    val waiting = before.at("trades").list().mapNotNull { it.obj() }.filter { it.at("myTurn").bool() == true }.map(tradeKey).toSet()
    val trades = after.at("trades").list().mapNotNull { it.obj() }.count { it.at("myTurn").bool() == true && tradeKey(it) !in waiting }
    if (trades > 0) lines += "トレードの返事待ち${trades}件"
    // 練習試合の申し込み（新しく届いたもの）
    val offered = before.at("exhibitions").list().mapNotNull { it.at("id").str() }.toSet()
    val challenges = after.at("exhibitions").list().mapNotNull { it.obj() }
        .count { it.at("status").str() == "offered" && it.at("mine").bool() != true && it.at("id").str() !in offered }
    if (challenges > 0) lines += "練習試合の申し込み${challenges}件"
    // あなたへのお知らせ（新しいもの）
    val known = before.at("inbox").list().mapNotNull { it.at("id").str() }.toSet()
    val notes = after.at("inbox").list().count { it.at("id").str() !in known }
    if (notes > 0) lines += "あなたへのお知らせ${notes}件"
    return lines.ifEmpty { null }
}

/**
 * まとめに要る項目だけを抜いたビュー（端末に残す。ビューまるごとは大きい）。
 * [awaySummary] の `before` に渡すと、まるごとのビューと同じ答えになる（`SocialTest`）
 */
fun awayDigest(view: JsonObject): JsonObject = buildJsonObject {
    for (key in listOf("teamName", "revision", "year", "standings", "teamLeagues", "phase")) view[key]?.let { put(key, it) }
    view.at("chronicle", "milestones")?.let { put("chronicle", buildJsonObject { put("milestones", it) }) }
    putJsonArray("trades") {
        view.at("trades").list().mapNotNull { it.obj() }.forEach { t ->
            add(buildJsonObject { for (k in listOf("id", "myTurn", "updatedAt")) t[k]?.let { put(k, it) } })
        }
    }
    putJsonArray("exhibitions") {
        view.at("exhibitions").list().mapNotNull { it.obj() }.forEach { e ->
            add(buildJsonObject { for (k in listOf("id", "status", "mine")) e[k]?.let { put(k, it) } })
        }
    }
    putJsonArray("inbox") { view.at("inbox").list().mapNotNull { it.obj() }.forEach { n -> n["id"]?.let { add(buildJsonObject { put("id", it) }) } } }
}

/** 自球団の部の中の順位（1始まり）。順位表は全球団を通した並びなので、部で絞って数える。Web 版 `divisionRank` */
fun divisionRank(view: JsonObject): Int? {
    val team = view.at("teamName").str() ?: return null
    val league = view.at("teamLeagues", team).str()
    val rows = view.at("standings").list().mapNotNull { it.obj() }
        .filter { league.isNullOrEmpty() || view.at("teamLeagues", it.at("team").str() ?: "").str() == league }
    val at = rows.indexOfFirst { it.at("team").str() == team }
    return if (at >= 0) at + 1 else null
}

private fun ownStanding(view: JsonObject): JsonObject? {
    val team = view.at("teamName").str()
    return view.at("standings").list().mapNotNull { it.obj() }.firstOrNull { it.at("team").str() == team }
}

private fun played(row: JsonObject?): Int =
    if (row == null) 0 else (row.at("wins").int() ?: 0) + (row.at("losses").int() ?: 0) + (row.at("draws").int() ?: 0)
