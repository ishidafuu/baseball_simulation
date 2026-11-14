package jp.icenorth.baseball.shared

import kotlinx.serialization.json.JsonObject

/*
 * 全国紙（リーグ全体を中立に書く「NEXT STAGE」）。地元紙（[buildFrontPage]）と並べて切り替える。
 *
 * ⚠ 1面はその日のリーグでいちばんのニュース。自球団が載らない日もある（それが全国紙らしさ）。
 * ⚠ ビューにあるものだけで書く（直近14試合・順位表・連勝連敗・タイトル・能力ランキング・参加者）。
 *    他球団の試合の詳細（誰が打ったか）は読まないので、選手の名前は勝ち投手・タイトル・能力ランキングから。
 * ⚠ 言い回しは日付で選ぶ（[Pen]）。同じ日なら同じ紙面。
 */

private fun GameResult.winner(): String? = when {
    homeScore == null || awayScore == null -> null
    homeScore > awayScore -> home
    awayScore > homeScore -> away
    else -> null
}

private fun GameResult.loser(): String? = winner()?.let { if (it == home) away else home }

/** 連勝・連敗の添え書き（「宮崎3連勝」）。3つ以上のときだけ */
internal fun streakNote(view: LeagueView, team: String): String? = view.teamStreaks[team]?.takeIf { it.count >= 3 && it.kind != "D" }?.let {
    "${view.teamShort(team)}${it.count}${if (it.kind == "W") "連勝" else "連敗"}"
}

/** 短信の1行（「宮崎 5-3 那覇（宮崎3連勝）」）。連続はいまの数なので、その日がいちばん新しい試合のときだけ添える */
internal fun shortLine(view: LeagueView, g: GameResult, latest: Boolean): String {
    val base = "${view.teamShort(g.away)} ${g.awayScore}-${g.homeScore} ${view.teamShort(g.home)}"
    val note = if (latest) listOfNotNull(g.winner()?.let { streakNote(view, it) }, g.loser()?.let { streakNote(view, it) }).joinToString("、") else ""
    return if (note.isEmpty()) base else "$base（$note）"
}

/** シーズンを終えた順位のひと言（「1部は川崎、2部は新潟が首位でシーズンを終えた。」）。試合が無ければ空 */
private fun seasonEnd(view: LeagueView): String {
    val tops = listOf("A", "B").mapNotNull { l -> view.leagueTable(l).firstOrNull { it.gamesPlayed > 0 }?.let { "${LEAGUE_NAMES[l]}は${view.teamShort(it.team)}" } }
    return if (tops.isEmpty()) "" else "今季、${tops.joinToString("、")}が首位でシーズンを終えた。"
}

/**
 * 全国紙の紙面。題字の下（球団・順位・日付・お知らせ）は地元紙と同じものを使う。
 * @param local 同じ日の地元紙（題字の下の行を写す）
 */
fun buildNationalPage(view: LeagueView, raw: JsonObject?, local: FrontPage): FrontPage {
    val date = view.currentDate
    val pen = Pen((date?.dayKey() ?: 0) + 7)
    val latestDay = view.results.maxOfOrNull { it.date?.dayKey() ?: 0 }
    val today = view.results.filter { latestDay != null && (it.date?.dayKey() ?: 0) == latestDay && it.homeScore != null && it.awayScore != null }
    val owners = view.teamOwners.keys
    // 部ごとの上位2球団（首位攻防の判定）
    val top2 = view.teamLeagues.values.toSet().associateWith { l -> view.leagueTable(l).filter { it.gamesPlayed > 0 }.take(2).map { it.team }.toSet() }

    data class Story(val g: GameResult, val points: Int)
    val stories = today.map { g ->
        val w = g.winner()
        val l = g.loser()
        val ws = w?.let { view.teamStreaks[it] }?.takeIf { it.kind == "W" }?.count ?: 0
        val ls = l?.let { view.teamStreaks[it] }?.takeIf { it.kind == "L" }?.count ?: 0
        val diff = kotlin.math.abs((g.homeScore ?: 0) - (g.awayScore ?: 0))
        val league = view.teamLeagues[g.home]
        val clash = league != null && top2[league]?.containsAll(listOf(g.home, g.away)) == true
        var pts = 0
        if (clash) pts += 10
        if (ws >= 3) pts += ws * 3
        if (ls >= 5) pts += ls * 2
        if (diff >= 7) pts += 5
        if (w != null && minOf(g.homeScore ?: 0, g.awayScore ?: 0) == 0) pts += 4
        if (g.home in owners || g.away in owners) pts += 2
        if (league == "A") pts += 1
        Story(g, pts)
    }
    // ⚠ 手続きの時期は試合の話を1面にしない（地元紙と同じ。[OFF_PHASES]）
    val story = if (view.phase?.kind in OFF_PHASES) null else stories.maxByOrNull { it.points }

    var headline: String
    var kicker: String? = null
    var lead: String? = null
    var subhead: String? = null
    var score: FrontPage.Score? = null
    var extra = false
    if (story != null) {
        val g = story.g
        val w = g.winner()
        val l = g.loser()
        val league = view.teamLeagues[g.home]?.let { LEAGUE_NAMES[it] } ?: ""
        score = FrontPage.Score(view.teamShort(g.away), g.awayScore ?: 0, view.teamShort(g.home), g.homeScore ?: 0)
        if (w == null || l == null) {
            headline = pen.pick(listOf("${view.teamShort(g.home)}と${view.teamShort(g.away)}、譲らず", "${view.teamShort(g.home)}・${view.teamShort(g.away)} 痛み分け"), 1)
            lead = "${league}の${view.teamShort(g.home)}と${view.teamShort(g.away)}は${g.homeScore}-${g.awayScore}で引き分けた。"
        } else {
            val W = view.teamShort(w)
            val L = view.teamShort(l)
            val ws = view.teamStreaks[w]?.takeIf { it.kind == "W" }?.count ?: 0
            val ls = view.teamStreaks[l]?.takeIf { it.kind == "L" }?.count ?: 0
            val wScore = maxOf(g.homeScore ?: 0, g.awayScore ?: 0)
            val lScore = minOf(g.homeScore ?: 0, g.awayScore ?: 0)
            val clash = view.teamLeagues[g.home]?.let { top2[it]?.containsAll(listOf(g.home, g.away)) } == true
            headline = pen.pick(
                when {
                    clash -> listOf("首位攻防 ${W}が${L}を下す", "${W}、首位攻防を制す", "上位対決は${W}に軍配")
                    ws >= 5 -> listOf("${W}破竹の${ws}連勝", "${W}止まらない${ws}連勝", "${ws}連勝 ${W}の勢い本物")
                    ls >= 5 -> listOf("${L}泥沼の${ls}連敗", "${L}${ls}連敗 ${W}に屈す")
                    wScore - lScore >= 7 -> listOf("${W}打線爆発 ${L}から${wScore}点", "${W}、${wScore}得点で${L}に大勝")
                    lScore == 0 -> listOf("${W}、${L}を零封", "${W}投手陣 ${L}を完封")
                    ws >= 3 -> listOf("${W}${ws}連勝", "${W}、${L}を下して${ws}連勝")
                    else -> listOf("${W}、${L}を下す", "${W}が${L}に勝利", "${W}白星 ${L}を退ける")
                },
                2,
            )
            extra = ws >= 10
            kicker = listOfNotNull(league.ifEmpty { null }, if (ws >= 2) "${ws}連勝" else null).joinToString("・").ifEmpty { null }
            val winPlace = if (w == g.home) "本拠地" else "敵地"
            val table = view.teamLeagues[w]?.let { view.leagueTable(it) }.orEmpty()
            val rank = table.indexOfFirst { it.team == w }
            val rec = table.getOrNull(rank)?.let { "${W}はこれで${it.wins}勝${it.losses}敗${if (it.draws > 0) "${it.draws}分" else ""}、${league}${rank + 1}位。" } ?: ""
            val date0 = g.date?.let { "${it.month}月${it.day}日、" } ?: ""
            lead = "$date0${league}の${W}は${winPlace}で${L}と対戦し、${wScore}-${lScore}で勝った。$rec"
            subhead = g.decisions?.winningPitcher?.name?.let { "勝ち投手は${it}" + (g.decisions.savePitcher?.name?.let { s -> "、${s}がセーブ" } ?: "") }
        }
    } else {
        val (h, l) = when (view.phase?.kind) {
            "pack_select" -> "新リーグ開幕へ 各球団が顔ぶれ選び" to "参加する球団が、最初の24人を選んでいる。"
            "camp" -> pen.pick(listOf("球春到来 12球団がキャンプイン", "各球団、開幕へ汗"), 1) to "どの球団が伸びるか。キャンプの過ごし方が開幕後を左右する。"
            "contract" -> "ストーブリーグ開幕 各球団が来季へ" to "契約更改の季節。残す選手と手放す選手の見極めが始まった。" + seasonEnd(view)
            "tryout" -> "トライアウト 新天地を求めて" to "各球団の補強の取り合いが始まる。" + seasonEnd(view)
            "offseason" -> "新たな1年へ 昇格・降格の明暗" to "年度が替わり、新しい所属でのシーズンが始まる。"
            else -> pen.pick(listOf("開幕迫る 12球団の戦力は", "まもなく開幕 頂点はどこだ"), 1) to "開幕を前に、各球団の準備は最終段階に入った。"
        }
        headline = h
        lead = l
    }

    val articles = mutableListOf<FrontPage.Article>()
    // 1部・2部の戦線（1部は首位争いと降格、2部は昇格争い）
    for (league in listOf("A", "B")) {
        val table = view.leagueTable(league).filter { it.gamesPlayed > 0 }
        if (table.size < 2) continue
        val name = LEAGUE_NAMES[league] ?: league
        val top = table[0]
        val second = table[1]
        val last = table.last()
        val T = view.teamShort(top.team)
        val S = view.teamShort(second.team)
        val g2 = gamesBehind(top, second)
        val ended = view.phase?.kind in OFF_PHASES
        val body = if (ended) "${T}が${top.wins}勝${top.losses}敗で首位、" + (if (g2 == 0.0) "${S}と並んで" else "2位の${S}に${gb(g2)}差をつけて") + "シーズンを終えた。"
        else buildString {
            append("首位は${T}（${top.wins}勝${top.losses}敗）。")
            append(if (g2 == 0.0) "${S}がゲーム差なしで並ぶ。" else "2位の${S}が${gb(g2)}差で追う。")
            if (league == "A") {
                // ⚠ 降格が決まったら「危機」とは書かない（下のマジックの文が「降格が決定」と書く）
                if (view.races.none { it.kind == "relegated" && it.team == last.team }) append("最下位の${view.teamShort(last.team)}は2部降格の危機にある。")
            } else append("優勝すれば1部へ昇格する。")
        }
        val title = when {
            ended -> "${name}、${T}が首位で終える"
            g2 == 0.0 -> "${name}は${T}と${S}が首位並ぶ"
            g2 >= 5 -> pen.pick(listOf("${name}、${T}が独走", "${T}独走 ${name}首位を快走"), 30 + league.hashCode())
            league == "B" -> pen.pick(listOf("昇格争い ${T}が先頭", "1部昇格へ ${T}が一歩リード"), 30 + league.hashCode())
            else -> pen.pick(listOf("${name}首位は${T}", "${T}が${name}首位 ${S}追う"), 30 + league.hashCode())
        }
        // マジックと決定（この部のもの）
        val races = view.races.filter { it.league == league }.mapNotNull { raceText(it, view::teamShort) }
        // ⚠ 見出しにするのは上の決着（1位・昇格）だけ。残留・降格の決定は本文に回す
        val decided = view.races.firstOrNull { it.league == league && it.clinched && it.kind in setOf("first", "promotion") }?.let { raceText(it, view::teamShort) }
        articles += FrontPage.Article(
            "${name}戦線",
            decided?.head ?: title,
            body + races.joinToString("") { "${it.head}。" },
            LINK_GAMES,
        )
    }
    // 連勝・連敗（1面に出した球団以外）
    val headTeams = story?.g?.let { setOf(it.home, it.away) }.orEmpty()
    val hot = view.teamStreaks.filter { (t, s) -> s.kind == "W" && s.count >= 3 && t !in headTeams }.entries.sortedByDescending { it.value.count }
    val cold = view.teamStreaks.filter { (t, s) -> s.kind == "L" && s.count >= 3 && t !in headTeams }.entries.sortedByDescending { it.value.count }
    if ((hot.isNotEmpty() || cold.isNotEmpty()) && view.phase?.kind !in OFF_PHASES) {
        val body = listOfNotNull(
            hot.take(3).joinToString("、") { "${view.teamShort(it.key)}が${it.value.count}連勝" }.ifEmpty { null }?.let { "$it。" },
            cold.take(3).joinToString("、") { "${view.teamShort(it.key)}は${it.value.count}連敗" }.ifEmpty { null }?.let { "$it。" },
        ).joinToString("")
        val title = hot.firstOrNull()?.let { "${view.teamShort(it.key)}${it.value.count}連勝 勢いに乗る" } ?: cold.first().let { "${view.teamShort(it.key)}、${it.value.count}連敗で苦境" }
        articles += FrontPage.Article("連勝・連敗", title, body, LINK_GAMES)
    }
    // オーナーたちの戦い（人が持つ球団が2つ以上のとき。人はオーナーで、ベンチの監督は指導者）
    val humans = view.teamOwners.keys.filter { it in view.teamLeagues }
    if (humans.size >= 2) {
        val lines = humans.mapNotNull { t ->
            val league = view.teamLeagues[t] ?: return@mapNotNull null
            val table = view.leagueTable(league)
            val rank = table.indexOfFirst { it.team == t }
            val who = view.teamOwners[t]?.ifBlank { null }?.let { "${it}オーナーの" } ?: ""
            "${who}${view.teamShort(t)}は${LEAGUE_NAMES[league]}${rank + 1}位" + (table.getOrNull(rank)?.takeIf { it.gamesPlayed > 0 }?.let { "（${it.wins}勝${it.losses}敗）" } ?: "")
        }
        // オーナーのひとこと（新しく書いたものから2つまで。順位表の横に出しているのと同じ文）
        val voices = view.members.filter { !it.comment.isNullOrBlank() && it.teamName in humans }
            .sortedByDescending { it.commentAt.orEmpty() }
            .take(2)
            .joinToString("") { m ->
                val who = view.teamOwners[m.teamName]?.ifBlank { null } ?: view.teamShort(m.teamName.orEmpty())
                "${who}オーナーは「${m.comment}」と語る。"
            }
        articles += FrontPage.Article("オーナーたちの戦い", "${humans.size}人のオーナー、それぞれの現在地", lines.joinToString("、") + "。" + voices, LINK_GAMES)
    }
    // 記録（最新の試合の日に届いた節目。リーグ全体）
    if (view.phase?.kind !in OFF_PHASES) {
        val day = view.results.lastOrNull()?.date
        val hits = milestonesOn(view, day)
        hits.firstOrNull()?.let { m ->
            articles += FrontPage.Article(
                "記録",
                if (hits.size == 1) "${view.teamShort(m.team)}・${m.name}、${m.label}" else "${m.name}が${m.label} 節目の記録が${hits.size}つ",
                milestoneBody(hits, view::teamShort),
                LINK_GAMES,
            )
        }
    }
    // 指導者（オフはリーグの人事。シーズン中は監督の通算勝利の節目）
    articles += staffNationalArticles(view, view.phase?.kind in OFF_PHASES, today.mapNotNull { it.winner() }.toSet())
    // 引退（年度更新のあと。リーグ全体の大物から）
    if (view.phase?.kind in OFF_PHASES && view.chronicle.retired.isNotEmpty()) {
        val gone = view.chronicle.retired
        articles += FrontPage.Article(
            "引退",
            "${view.teamShort(gone[0].team)}・${gone[0].name}がユニフォームを脱ぐ",
            retiredBody(gone, view::teamShort),
            LINK_GAMES,
        )
    }
    // 球界の外から（甲子園・独立リーグ日本一決定戦。同じ年で、その日から120日。[recentWorld]）
    recentWorld(view).forEach { w ->
        worldText(w, view::teamShort)?.let { t -> articles += FrontPage.Article(if (w.kind == "koshien") "甲子園" else "日本一決定戦", t.head, t.body, LINK_GAMES) }
    }
    // タイトル戦線（打率・本塁打・勝利の先頭）
    val boards = raw?.at("leaders").list().mapNotNull { it.obj() }
    val leadersLine = listOf("avg" to "打率", "homeruns" to "本塁打", "wins" to "勝利").mapNotNull { (id, label) ->
        val b = boards.firstOrNull { it.at("id").str() == id } ?: return@mapNotNull null
        val row = b.at("rows").list().firstOrNull()?.obj() ?: return@mapNotNull null
        val v = row.at("value").num() ?: return@mapNotNull null
        val value = if (id == "avg") rate3(v) else "${v.toInt()}${if (id == "homeruns") "本" else "勝"}"
        "${label}は${row.at("name").str()}（${view.teamShort(row.at("team").str().orEmpty())}）が$value"
    }
    if (leadersLine.isNotEmpty()) {
        val first = boards.firstOrNull { it.at("id").str() == "homeruns" }?.at("rows").list()?.firstOrNull()?.obj()
        articles += FrontPage.Article(
            "タイトル戦線",
            first?.let { "本塁打王争い ${it.at("name").str()}が先頭" } ?: "タイトル争い、序盤の主役は",
            leadersLine.joinToString("、") + "でトップに立つ。" + (first?.let { r -> boards.firstOrNull { it.at("id").str() == "homeruns" }?.let { paceLine(it, r) } }?.let { p -> if (p.isEmpty()) "" else "本塁打の${first.at("name").str()}は$p" } ?: ""),
            LINK_GAMES,
        )
    }
    // プロ注目（飾り。リーグ全体の能力ランキングから若い選手を）
    val ability = raw?.at("abilityLeaders").list().mapNotNull { it.obj() }
    val scout = listOf("velocity" to "最速", "power" to "パワー", "speed" to "走力", "meet" to "ミート").mapNotNull { (id, label) ->
        val b = ability.firstOrNull { it.at("id").str() == id } ?: return@mapNotNull null
        b.at("rows").list().mapNotNull { it.obj() }.firstOrNull { (it.at("age").int() ?: 99) <= 25 }?.let { Triple(label, it, id) }
    }
    if (scout.isNotEmpty()) {
        val (label, row, id) = pen.pick(scout, 40)
        val name = row.at("name").str().orEmpty()
        val team = view.teamShort(row.at("team").str().orEmpty())
        val value = row.at("value").int() ?: 0
        val trait = if (id == "velocity") "最速${value}km" else "$label$value"
        val scouts = 2 + pen.pick(listOf(0, 1, 2, 3), 41)
        articles += FrontPage.Article(
            "プロ注目",
            pen.pick(listOf("${team}の${name}にNPBが熱視線", "${trait}の${name}、スカウト${scouts}球団が視察", "未来のプロ野球選手？ ${team}・${name}"), 42),
            "${row.at("age").int()}歳の${positionNoun(row.at("position").str())}・${name}（${team}）。リーグ屈指の${trait}に、NPB${scouts}球団のスカウトが足を運んだ。",
            LINK_GAMES,
        )
    }
    val shorts = if (story == null) emptyList() else today.filter { it != story.g }.map { shortLine(view, it, latest = true) }
    return local.copy(
        paper = FrontPage.Paper.National,
        title = "NEXT STAGE",
        badge = "スポーツ",
        headline = headline,
        kicker = kicker,
        subhead = subhead,
        lead = lead,
        tone = if (story != null) FrontPage.Tone.Win else FrontPage.Tone.None,
        score = score,
        lineScore = null,
        box = emptyList(),
        extra = extra,
        articles = articles,
        shorts = shorts,
    )
}
