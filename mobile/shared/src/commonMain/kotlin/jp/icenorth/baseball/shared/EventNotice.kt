package jp.icenorth.baseball.shared

import kotlinx.serialization.json.JsonObject

/**
 * 試合結果のほかに通知すること（手続き・トレード・手続きの結果）。[ResultNotice] と同じく端末の中で出す。
 *
 * - 手続きが始まった（初期メンバー選択・キャンプ・契約更改・トライアウト・年度更新。自分が決める番のものだけ）
 * - 締め切りが近いのに、まだ決めていない（残り [DUE_SOON_MILLIS] 以内）
 * - トレードの提案・逆提案が届いた（自分が返事をする番）
 * - トライアウト・キャンプ・年度更新の結果が出た
 *
 * ⚠ 手続きの数え方は「手続き」のタブの数字と同じ（[pendingProcedure]）。指導者に任せた手続きは知らせない。
 * ⚠ 印（[key]）は端末に覚え、同じことを二度知らせない。アプリの画面で見たものにも印を付ける。
 */
data class EventNotice(val key: String, val title: String, val body: String)

/** 締め切りの何時間前に「まだ決めていない」を知らせるか */
const val DUE_SOON_MILLIS: Long = 3 * 60 * 60 * 1000L

/**
 * いま知らせる候補（印を見る前）。
 * @param now いまの時刻（ミリ秒）
 * @param millisOf ISO の日時をミリ秒に（読めなければ null）
 * @param format ISO の日時を画面と同じ書き方に（「11/16(月) 21:00」）
 */
fun eventNotices(
    view: LeagueView,
    raw: JsonObject?,
    now: Long,
    millisOf: (String) -> Long?,
    format: (String) -> String?,
): List<EventNotice> = buildList {
    if (raw == null || view.teamName == null) return@buildList
    val year = view.year ?: 0

    pendingProcedure(raw)?.let { proc ->
        // ⚠ 手続きの回ごとの見分け。phase の id が無い古いサーバーでも年と種類で分かれる
        val id = raw.at("phase", "id").str() ?: "$year"
        val due = proc.deadline?.let(format)
        val start = "proc:${proc.kind}:$id"
        add(
            EventNotice(
                start,
                if (proc.kind == "pack_select") "初期メンバーを選んでください" else "${proc.label}が始まりました",
                listOfNotNull(due?.let { "締め切り $it" }, proc.progress, "アプリの「手続き」から決めてください").joinToString("\n"),
            ),
        )
        val left = proc.deadline?.let(millisOf)?.minus(now)
        if (left != null && left in 1..DUE_SOON_MILLIS) {
            val hours = (left + 30 * 60 * 1000L) / (60 * 60 * 1000L)
            add(
                EventNotice(
                    "due:${proc.kind}:$id",
                    "${proc.label}の締め切りが近づいています",
                    listOfNotNull(
                        if (hours >= 1) "あと約${hours}時間（${due ?: ""}）" else "あと1時間を切りました（${due ?: ""}）",
                        proc.progress,
                        "決めなかったぶんは標準の案で決まります",
                    ).joinToString("\n"),
                ),
            )
        }
    }

    // トレード: 自分が返事をする番の提案（逆提案が返ってきたら別の印でもう一度）
    raw.at("trades").list().mapNotNull { it.obj() }.filter { it.at("myTurn").bool() == true }.forEach { t ->
        val id = t.at("id").str() ?: return@forEach
        val countered = t.at("countered").bool() == true
        val mine = t.at("mine").bool() == true
        val partner = (if (mine) t.at("toTeam") else t.at("fromTeam")).str()?.let(view::teamShort) ?: "相手"
        // 相手が出す選手・こちらが出す選手（提案を出したのが相手なら offer が相手の選手）
        val theirs = (if (mine) t.at("want") else t.at("offer")).list().mapNotNull { it.at("name").str() }
        val ours = (if (mine) t.at("offer") else t.at("want")).list().mapNotNull { it.at("name").str() }
        add(
            EventNotice(
                "trade:$id:${if (countered) "c" else "o"}",
                if (countered && mine) "${partner}から逆提案が返ってきました" else "${partner}からトレードの提案が届きました",
                listOfNotNull(
                    theirs.takeIf { it.isNotEmpty() }?.let { "もらう: ${it.joinToString("・")}" },
                    ours.takeIf { it.isNotEmpty() }?.let { "出す: ${it.joinToString("・")}" },
                ).joinToString("\n"),
            ),
        )
    }

    // 手続きの結果（その年のもの。次の同じ手続きまでビューに残る）
    raw["lastTryout"].obj()?.let { r ->
        val picks = r.at("picks").list().mapNotNull { it.at("name").str() }
        val lost = r.at("lost").list().size
        add(
            EventNotice(
                "result:tryout:${r.at("year").int() ?: year}",
                "トライアウトの結果: ${picks.size}人が入団",
                listOfNotNull(
                    picks.take(6).joinToString("・").ifEmpty { null }?.let { it + if (picks.size > 6) " ほか" else "" },
                    if (lost > 0) "交渉した${lost}人は他球団へ" else null,
                ).joinToString("\n"),
            ),
        )
    }
    raw["lastCamp"].obj()?.let { r ->
        add(EventNotice("result:camp:${r.at("year").int() ?: year}", "キャンプが終わりました", "選手ごとの伸びは「手続き」で見られます"))
    }
    raw["lastOffseason"].obj()?.let { r ->
        val departed = r.at("departed").list().size
        add(
            EventNotice(
                "result:offseason:${r.at("year").int() ?: year}",
                "年度更新が終わりました",
                listOfNotNull("伸び・衰えが出ました", if (departed > 0) "引退・退団 ${departed}人" else null).joinToString("\n"),
            ),
        )
    }
}

/**
 * 知らせるものを1つの通知にまとめる（まだ印の無いものだけ）。無ければ null。
 * 印がまだ無い（入れた直後）ときは null（いま出ているものをまとめて知らせない）。
 */
fun eventNotice(events: List<EventNotice>, notified: Set<String>?): EventNotice? {
    if (notified == null) return null
    val fresh = events.filter { it.key !in notified }
    return when (fresh.size) {
        0 -> null
        1 -> fresh.single()
        else -> EventNotice(fresh.joinToString(",") { it.key }, "お知らせ ${fresh.size}件", fresh.joinToString("\n") { it.title })
    }
}

/**
 * 印を足す。増えすぎたら（通知を切っていた間など）、いま出ているものだけに切る（切っても二度は知らせない）
 */
fun withEventKeys(notified: Set<String>?, events: List<EventNotice>): Set<String> {
    val next = notified.orEmpty() + events.map { it.key }
    return if (next.size > 100) events.map { it.key }.toSet() else next
}
