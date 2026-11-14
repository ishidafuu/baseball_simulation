package jp.icenorth.baseball.shared

/**
 * 人どうしの関わり（得点経過の言い方・最終ログインの見せ方）。Web 版 `src/online/social.js` の写し。
 *
 * ⚠ 数字（ひとことの字数・おるすばんの日数など）は Tables.kt（`gen-tables.mjs` が書き出す）にある。
 * ⚠ 文を変えたら Web 版も直す。`mobile/tools/expect-social.mjs` が書き出す答えと `SocialTest` で照らし合わせる。
 */

private const val DAY_MS = 24L * 60 * 60 * 1000
private const val TOKYO_OFFSET_MS = 9L * 60 * 60 * 1000

/** 日本時間の日付（"2026-11-14"）。エポックミリ秒から */
fun tokyoDay(millis: Long): String {
    val days = (millis + TOKYO_OFFSET_MS).floorDiv(DAY_MS)
    val (y, m, d) = civilFromDays(days)
    return "${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}"
}

/** "2026-11-14" → 1970-01-01 からの日数。読めなければ null */
fun dayNumber(day: String): Long? {
    val parts = day.take(10).split("-")
    if (parts.size != 3) return null
    val y = parts[0].toLongOrNull() ?: return null
    val m = parts[1].toIntOrNull()?.takeIf { it in 1..12 } ?: return null
    val d = parts[2].toIntOrNull()?.takeIf { it in 1..31 } ?: return null
    return daysFromCivil(y, m, d)
}

/**
 * 最終ログインの見せ方（「今日」「昨日」「3日前」）。`lastSeenDay` はビューの日本時間の日付。
 * Web 版 `SocialPages.jsx` の `seenText`（`lastSeenLabel` に日付だけを渡す）と同じ答え
 */
fun lastSeenLabel(lastSeenDay: String?, now: Long): String {
    if (lastSeenDay.isNullOrEmpty()) return ""
    val seen = dayNumber(lastSeenDay) ?: return ""
    val today = dayNumber(tokyoDay(now)) ?: return ""
    val days = today - seen
    return when {
        days <= 0 -> "今日"
        days == 1L -> "昨日"
        else -> "${days}日前"
    }
}

/** 得点経過の1行の言い方（「2ランホームラン」「タイムリー二塁打」「押し出し四球」）。Web 版 `scoringLabel` */
fun scoringLabel(play: ScoringPlay): String = when (play.kind) {
    "homerun" -> when {
        play.runs >= 4 -> "満塁ホームラン"
        play.runs == 1 -> "ソロホームラン"
        else -> "${play.runs}ランホームラン"
    }
    "single" -> "タイムリー"
    "double" -> "タイムリー二塁打"
    "triple" -> "タイムリー三塁打"
    "walk" -> "押し出し四球"
    "hit_by_pitch" -> "押し出し死球"
    "error" -> "相手の失策の間に"
    "other" -> "暴投・盗塁などで"
    else -> "凡打の間に"
}

/** 得点経過の1行（「7回裏 X 佐藤 2ランホームラン（3-2）」）。Web 版 `scoringLine` */
fun scoringLine(play: ScoringPlay, awayShort: String = "", homeShort: String = ""): String {
    val top = play.half == "top"
    val team = if (top) awayShort else homeShort
    val who = play.name?.takeIf { it.isNotEmpty() }?.let { "$it " } ?: ""
    return "${play.inning}回${if (top) "表" else "裏"}${if (team.isNotEmpty()) " $team" else ""} $who${scoringLabel(play)}（${play.away}-${play.home}）"
}

/** 前回の時刻の見せ方（「11/14 7:00」）。日本時間。Web 版 `awaySummary.js` の `sinceLabel` */
fun sinceLabel(millis: Long): String {
    val local = millis + TOKYO_OFFSET_MS
    val days = local.floorDiv(DAY_MS)
    val (_, m, d) = civilFromDays(days)
    val inDay = local - days * DAY_MS
    val hh = inDay / (60 * 60 * 1000)
    val mm = (inDay / (60 * 1000)) % 60
    return "$m/$d $hh:${mm.toString().padStart(2, '0')}"
}

// 暦の計算（Howard Hinnant の days_from_civil / civil_from_days）。端末の時刻帯に左右されない
private fun daysFromCivil(year: Long, month: Int, day: Int): Long {
    val y = if (month <= 2) year - 1 else year
    val era = y.floorDiv(400L)
    val yoe = y - era * 400
    val mp = (month + 9) % 12
    val doy = (153 * mp + 2) / 5 + day - 1
    val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146097 + doe - 719468
}

private fun civilFromDays(days: Long): Triple<Long, Int, Int> {
    val z = days + 719468
    val era = z.floorDiv(146097L)
    val doe = z - era * 146097
    val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
    val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    val mp = (5 * doy + 2) / 153
    val d = (doy - (153 * mp + 2) / 5 + 1).toInt()
    val m = (if (mp < 10) mp + 3 else mp - 9).toInt()
    val y = yoe + era * 400 + if (m <= 2) 1 else 0
    return Triple(y, m, d)
}
