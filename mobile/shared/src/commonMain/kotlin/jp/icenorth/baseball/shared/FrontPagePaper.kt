package jp.icenorth.baseball.shared

import kotlinx.serialization.json.JsonObject
import kotlin.math.abs

/*
 * スポーツ紙らしい紙面（いしだ 2026-11-16「本物のスポーツ新聞みたいに」「地味で情報多めの2面も」）の材料。
 * 1面の縦見出し・写真の説明・ヒーロー欄・目次と、2面（チーム面）・3面（記録面）を作る。
 * 見た目は Android の FrontPageCard.kt（新聞風）だけが使い、ネットニュース風・通常は今までの項目だけを使う。
 *
 * ⚠ 言い回しは [Pen] で選ぶ（同じ試合なら同じ紙面）。
 * ⚠ ビューと試合の詳細にあることだけを書く。監督・選手の談話は決まり文句（場面と監督の気質で選ぶ）。
 */

/** 1面のヒーロー欄（負けた日は「敗戦の中の光」）。[lines] は（文, 強調するか） */
data class PaperHero(
    val title: String,
    val name: String,
    val position: String,
    val lines: List<Pair<String, Boolean>>,
    val season: String?,
)

/** 2面の監督の一問一答 */
data class PaperInterview(val title: String, val intro: String, val speaker: String, val qa: List<Pair<String, String>>)

/** 調子の矢印の1行（[arrow] は −2〜2） */
data class ConditionRow(val arrow: Int, val name: String, val position: String, val note: String)

/** 2面（チーム面） */
data class TeamPage(
    /** 面の名前（「アトラス番」） */
    val section: String,
    val interview: PaperInterview?,
    /** 直近の試合（古い順。1 勝ち・−1 負け・0 引き分け。最大10） */
    val form: List<Int>,
    /** チームの今（項目, 値） */
    val now: List<Pair<String, String>>,
    val nowNote: String?,
    val conditions: List<ConditionRow>,
    /** 投手陣の疲れ（名前, 様子, 休ませたいか） */
    val pitchers: List<Triple<String, String, Boolean>>,
    /** 次の先発の順（「早川→内田→塩沢」） */
    val rotation: String?,
    val articles: List<FrontPage.Article>,
)

data class BoxBatter(val pos: String, val name: String, val ab: Int, val h: Int, val rbi: Int, val hr: Int, val sub: Boolean)
data class BoxPitcher(val name: String, val ip: String, val h: Int, val so: Int, val r: Int, val pitches: Int)
data class BoxTeam(val name: String, val batters: List<BoxBatter>, val totals: List<Int>, val pitchers: List<BoxPitcher>)
data class StandRow(val rank: Int, val team: String, val w: Int, val l: Int, val gb: String, val note: String, val mine: Boolean)
data class LeaderRow(val name: String, val team: String, val value: String, val mine: Boolean)
data class LeaderBoard(val title: String, val rows: List<LeaderRow>)

/** 3面（記録面） */
data class RecordPage(
    /** 「那覇 9―14 宮崎（延長10回）」。試合が無ければ null */
    val game: String?,
    val reviewHead: String?,
    val review: String?,
    val boxes: List<BoxTeam>,
    /** ▽本塁打・▽二塁打・▽盗塁・▽失策 */
    val notes: List<String>,
    /** 継投メモ（「3回 早川→久住（打ち込まれて降板）」） */
    val relays: List<String>,
    val leagueName: String,
    val standings: List<StandRow>,
    val probablesTitle: String?,
    /** 予告先発（自球団の試合が先頭。（文, 自球団か）） */
    val probables: List<Pair<String, Boolean>>,
    val leaders: List<LeaderBoard>,
    val shorts: List<FrontPage.Article>,
)

/** 1面の「きのうの結果」の1行 */
data class ResultRow(val away: String, val awayScore: Int, val home: String, val homeScore: Int)

// ---------------------------------------------------------------------------------------------
// 日付

/** 曜日（0=日曜）。[year] は暦の年（ゲームの日付は 2024 年などの暦） */
internal fun weekday(year: Int, month: Int, day: Int): Int {
    // Zeller の公式（グレゴリオ暦）
    var y = year
    var m = month
    if (m < 3) { m += 12; y -= 1 }
    val k = y % 100
    val j = y / 100
    val h = (day + (13 * (m + 1)) / 5 + k + k / 4 + j / 4 + 5 * j) % 7 // 0=土
    return (h + 6) % 7
}

private val WEEKDAYS = listOf("日", "月", "火", "水", "木", "金", "土")

/** 「4月23日（木曜日）」。暦の年が無ければ曜日を付けない */
fun paperDate(date: GameDate?): String? = date?.let {
    val w = if (it.year > 1000) "（${WEEKDAYS[weekday(it.year, it.month, it.day)]}曜日）" else ""
    "${it.month}月${it.day}日$w"
}

// ---------------------------------------------------------------------------------------------
// 試合の詳細（ボックススコア）

private val POS_SHORT = POSITION_LABELS + mapOf("dh" to "指", "DH" to "指")

/** 試合の詳細の選手（打撃と投球の数） */
private class DetailPlayer(val o: JsonObject) {
    val id = o.at("id").long()
    val name = o.at("name").str().orEmpty()
    val pos = o.at("position").str()
    val order = o.at("battingOrder").int() ?: 0
    fun b(k: String) = o.at("batting", k).int() ?: 0
    fun p(k: String) = o.at("pitching", k).int() ?: 0
    val outs get() = p("inningsPitched")
    val batted get() = b("plateAppearances") > 0 || b("atBats") > 0
}

/** 姓だけ（新聞の成績表の書き方。「及川 邦敏」→「及川」） */
internal fun familyName(name: String): String = name.substringBefore(' ').substringBefore('　').ifBlank { name }

/** 投げた順（継投の記録から。記録が無ければ投げたアウトの多い順） */
private fun pitchingOrder(game: JsonObject, team: String, players: List<DetailPlayer>): List<DetailPlayer> {
    val threw = players.filter { it.outs > 0 || it.p("battersFaced") > 0 }
    val changes = game.at("pitcherChanges").list().mapNotNull { it.obj() }.filter { it.at("team").str() == team }
    if (changes.isEmpty()) return threw.sortedByDescending { it.outs }
    val names = mutableListOf<String>()
    changes.firstOrNull()?.at("out").str()?.let { names += it }
    changes.forEach { c -> c.at("in").str()?.let { if (it !in names) names += it } }
    val byName = threw.associateBy { it.name }
    val ordered = names.mapNotNull { byName[it] }
    return ordered + threw.filter { it !in ordered }
}

private fun boxTeam(view: LeagueView, game: JsonObject, team: String): BoxTeam? {
    val players = game.at("teams", team).list().mapNotNull { it.obj() }.map { DetailPlayer(it) }
    if (players.isEmpty()) return null
    // battingOrder は試合が終わったときの打順なので、途中で退いた選手は 0 になっている。
    // 退いた選手は同じ守備位置の最後の選手の枠へ戻し、枠の中は打席の多い順（多い方を先発とみなす）
    val slots = players.filter { it.order > 0 }.sortedBy { it.order }.map { mutableListOf(it) }
    val extra = mutableListOf<DetailPlayer>()
    players.filter { it.order <= 0 && it.batted }.sortedByDescending { it.b("plateAppearances") }.forEach { p ->
        val slot = slots.firstOrNull { it.size == 1 && it[0].pos == p.pos }
        if (slot != null) slot += p else extra += p
    }
    fun row(p: DetailPlayer, sub: Boolean) = BoxBatter(POS_SHORT[p.pos] ?: "", familyName(p.name), p.b("atBats"), p.b("hits"), p.b("rbis"), p.b("homeruns"), sub)
    val batters = slots.flatMap { slot ->
        slot.sortedByDescending { it.b("plateAppearances") }.mapIndexed { i, p -> row(p, i > 0) }
    } + extra.map { row(it, true) }
    val all = slots.flatten() + extra
    val totals = listOf(all.sumOf { it.b("atBats") }, all.sumOf { it.b("hits") }, all.sumOf { it.b("rbis") }, all.sumOf { it.b("homeruns") })
    val pitchers = pitchingOrder(game, team, players).map {
        BoxPitcher(familyName(it.name), inningsText(it.outs, InningsStyle.Box), it.p("hits"), it.p("strikeouts"), it.p("runsAllowed"), it.p("pitches"))
    }
    return BoxTeam(view.teamShort(team), batters, totals, pitchers)
}

/** ▽本塁打・二塁打・三塁打・盗塁・失策 */
private fun boxNotes(view: LeagueView, game: JsonObject, team: String): List<String> {
    val teams = game.at("teams").obj() ?: return emptyList()
    val own = view.roster.associateBy { it.id }
    // 自球団を先に
    val order = teams.keys.sortedBy { if (it == team) 0 else 1 }
    fun names(stat: String, withCount: Boolean = true): String = order.flatMap { t ->
        teams[t].list().mapNotNull { it.obj() }.map { DetailPlayer(it) }.filter { it.b(stat) > 0 }.map { p ->
            val n = familyName(p.name) + if (withCount && p.b(stat) >= 2) p.b(stat).toString() else ""
            if (t == team) n else "$n（${teamMark(view, t)}）"
        }
    }.joinToString("、")
    val homers = order.flatMap { t ->
        teams[t].list().mapNotNull { it.obj() }.map { DetailPlayer(it) }.filter { it.b("homeruns") > 0 }.map { p ->
            val hr = p.b("homeruns")
            val total = if (t == team) p.id?.let { own[it] }?.seasonStats?.batting?.homeruns else null
            val num = if (total != null && total >= hr) (total - hr + 1..total).joinToString("・") { "${it}号" } else ""
            familyName(p.name) + num + if (t == team) "" else "（${teamMark(view, t)}）"
        }
    }.joinToString("、")
    val errors = order.mapNotNull { t ->
        val n = teams[t].list().sumOf { it.at("batting", "errors").int() ?: 0 }
        if (n > 0) "${view.teamShort(t)}$n" else null
    }.joinToString("、")
    return listOfNotNull(
        homers.ifEmpty { null }?.let { "▽本塁打　$it" },
        names("triples").ifEmpty { null }?.let { "▽三塁打　$it" },
        names("doubles").ifEmpty { null }?.let { "▽二塁打　$it" },
        names("stolenBases").ifEmpty { null }?.let { "▽盗塁　$it" },
        errors.ifEmpty { null }?.let { "▽失策　$it" },
    )
}

/** 継投メモ（自球団だけ。理由は遊ぶ人の言葉に直す） */
private fun relayNotes(game: JsonObject, team: String): List<String> =
    game.at("pitcherChanges").list().mapNotNull { it.obj() }.filter { it.at("team").str() == team }.mapNotNull { c ->
        val out = c.at("out").str()?.let(::familyName) ?: return@mapNotNull null
        val inn = c.at("in").str()?.let(::familyName) ?: return@mapNotNull null
        val why = c.at("reason").str()?.let(::readableChangeReason)?.let(::shortReason)
            ?: c.at("role").str()
        "${c.at("inning").int() ?: "-"}回　$out→$inn" + (why?.let { "（$it）" } ?: "")
    }

/** 継投の理由を短く（「先発早川 喜一が打ち込まれて降板」→「打ち込まれて降板」） */
private fun shortReason(text: String): String {
    val t = text.trim()
    val i = t.indexOf('が')
    return (if (i in 1..14) t.substring(i + 1) else t).trim().take(18)
}

// ---------------------------------------------------------------------------------------------
// 1面の縦見出し・写真の説明・ヒーロー

/** 1面の縦の大見出し（短い言葉）。場面が無ければ null */
internal fun bigHeadOf(tone: FrontPage.Tone, s: Situation?): String? {
    s ?: return null
    val f = s.facts
    return when (tone) {
        FrontPage.Tone.Win -> when {
            f?.theirHits == 0 && s.theirs == 0 -> "快挙"
            f?.walkOff == true -> "サヨナラ"
            s.theirs == 0 && f?.complete == true -> "完封"
            s.theirs == 0 -> "零封"
            s.brokenStreak >= 3 -> "連敗脱出"
            f != null && f.trailed && f.maxDeficit >= 3 -> "大逆転"
            f != null && f.trailed -> "逆転"
            s.ours >= 10 || s.diff >= 7 -> "猛打"
            (f?.multiHomer != null) || (f?.ourHomeruns ?: 0) >= 3 -> "一発攻勢"
            s.streak >= 3 -> "${s.streak}連勝"
            s.diff == 1 -> "競り勝つ"
            f?.complete == true -> "完投"
            else -> "快勝"
        }
        FrontPage.Tone.Lose -> when {
            f?.ourHits == 0 -> "屈辱"
            s.ours == 0 -> "零敗"
            f?.walkOff == true -> "サヨナラ"
            s.brokenStreak >= 3 -> "連勝止まる"
            s.diff >= 7 || s.theirs >= 10 -> "大敗"
            f != null && f.led && s.diff <= 3 -> "逆転負け"
            (f?.ourErrors ?: 0) >= 2 -> "守乱"
            s.diff == 1 -> "惜敗"
            s.streak >= 3 -> "${s.streak}連敗"
            else -> "黒星"
        }
        FrontPage.Tone.Draw -> "痛み分け"
        FrontPage.Tone.None -> null
    }
}

/** 縦の袖見出し（大見出しの横に黄色で。大見出しから自球団の名前を落としたもの） */
internal fun bigSubOf(headline: String, me: String): String =
    headline.removePrefix("${me}、").removePrefix(me).trim().ifEmpty { headline }

/** リードの横の小見出し（縦） */
internal fun leadHeadOf(tone: FrontPage.Tone, s: Situation?, place: String?): String? {
    s ?: return place
    val f = s.facts
    return when (tone) {
        FrontPage.Tone.Win -> when {
            f != null && f.ourHits >= 10 -> "${s.place}で${f.ourHits}安打${s.ours}点"
            s.theirs == 0 -> "投手陣が零封"
            s.diff == 1 -> "1点差を守り切る"
            else -> place ?: "${s.place}で白星"
        }
        FrontPage.Tone.Lose -> when {
            s.ours == 0 -> "打線が沈黙"
            f?.walkOff == true -> "最後に力尽きる"
            s.diff >= 5 -> "投手陣が崩れる"
            else -> place ?: "${s.place}で黒星"
        }
        else -> place
    }
}

/** 写真（球場の得点板）の説明 */
internal fun photoCaption(tone: FrontPage.Tone, s: Situation?, ls: FrontPage.LineScore?): String? {
    s ?: return null
    val f = s.facts
    val park = if (s.home) "本拠地" else "${s.opp}の球場"
    val innings = ls?.let { maxOf(it.awayRuns.size, it.homeRuns.size) } ?: 0
    return "▲" + when {
        f?.walkOff == true && tone == FrontPage.Tone.Win -> "サヨナラ勝ちが決まった${park}の得点板"
        f?.walkOff == true -> "${innings}回裏に${f.theirInnings?.lastOrNull() ?: ""}点を奪われた${park}の得点板"
        tone == FrontPage.Tone.Win && s.theirs == 0 -> "相手の欄に0が並んだ${park}の得点板"
        tone == FrontPage.Tone.Win && f?.winningHit != null -> "${f.winningHit.inning}回に勝ち越した${park}の得点板"
        tone == FrontPage.Tone.Lose && s.ours == 0 -> "0が並んだ${park}の得点板"
        else -> "${park}の得点板"
    }
}

private val POSITION_NOUNS = mapOf(
    "pitcher" to "投手", "catcher" to "捕手", "first" to "一塁手", "second" to "二塁手", "third" to "三塁手",
    "short" to "遊撃手", "left" to "左翼手", "center" to "中堅手", "right" to "右翼手", "dh" to "指名打者",
)

/** ヒーロー欄（勝った日はきょうのヒーロー、負けた日は敗戦の中の光）。詳細が無ければ null */
internal fun heroOf(view: LeagueView, game: JsonObject?, team: String, tone: FrontPage.Tone, f: GameFacts?): PaperHero? {
    if (game == null || f == null || tone == FrontPage.Tone.None) return null
    val players = game.at("teams", team).list().mapNotNull { it.obj() }.map { DetailPlayer(it) }
    val won = tone == FrontPage.Tone.Win
    val bat = players.filter { it.batted }.maxByOrNull { it.b("homeruns") * 4 + it.b("rbis") * 2 + it.b("hits") }
    val ace = players.maxByOrNull { it.outs }
    val batGood = bat != null && (bat.b("homeruns") > 0 || bat.b("rbis") >= 2 || bat.b("hits") >= 3)
    val aceGood = ace != null && ace.outs >= 18 && ace.p("runsAllowed") <= 2
    val winner = f.winningHit?.name?.let { n -> players.firstOrNull { it.name == n } }
    val pick = when {
        aceGood && (!batGood || (bat!!.b("homeruns") < 2 && ace!!.p("runsAllowed") == 0)) -> ace
        batGood -> bat
        won && winner != null -> winner
        ace != null && ace.outs >= 15 -> ace
        else -> return null
    }!!
    val roster = pick.id?.let { id -> view.roster.firstOrNull { it.id == id } }
    val isPitcherLine = pick == ace && (pick.outs >= 15 || !pick.batted) && !(pick == bat && batGood)
    val lines: List<Pair<String, Boolean>> = if (isPitcherLine) listOfNotNull(
        (if (pick.p("gamesStarted") > 0 || pitchingOrder(game, team, players).firstOrNull() == pick) "先発" else "救援") to false,
        "${inningsText(pick.outs, InningsStyle.Box)}回" to true,
        "${pick.p("runsAllowed")}失点" to true,
        pick.p("strikeouts").takeIf { it > 0 }?.let { "${it}奪三振" to false },
    ) else listOfNotNull(
        "${pick.b("atBats")}打数" to false,
        "${pick.b("hits")}安打" to (pick.b("hits") >= 2),
        pick.b("homeruns").takeIf { it > 0 }?.let { "${it}本塁打" to true },
        pick.b("rbis").takeIf { it > 0 }?.let { "${it}打点" to (it >= 2) },
    )
    val season = if (isPitcherLine) roster?.seasonStats?.pitching?.let { "今季 ${it.wins}勝${it.losses}敗" + if (it.saves > 0) "${it.saves}S" else "" }
    else roster?.seasonStats?.batting?.takeIf { it.atBats > 0 }?.let { "今季 ${rate3(it.hits.toDouble() / it.atBats)} ${it.homeruns}本" }
    return PaperHero(
        title = if (won) "きょうのヒーロー" else if (tone == FrontPage.Tone.Lose) "敗戦の中の光" else "きょうの主役",
        name = pick.name,
        position = POSITION_NOUNS[pick.pos ?: roster?.position] ?: "",
        lines = lines,
        season = season,
    )
}

// ---------------------------------------------------------------------------------------------
// 2面（チーム面）

/** 監督の一問一答。[quote] は1面の「ひと言」と同じ決まり文句 */
internal fun interviewOf(
    view: LeagueView,
    tone: FrontPage.Tone,
    s: Situation,
    game: JsonObject?,
    team: String,
    pen: Pen,
): PaperInterview? {
    val coach = view.staff?.manager
    val (speaker0, temper) = commentSpeaker(view)
    val speaker = speaker0?.let { "${it}監督" } ?: return null
    val f = s.facts
    val quote = managerQuote(tone, s, pen, temper) ?: return null
    // 監督の売り込みの文の1文目（「四球でもいい。」）。勝った日に、持ち味が出た試合ならときどき使う
    val creed = coach?.pitch?.split('。')?.firstOrNull { it.isNotBlank() }?.trim()
    val qa = mutableListOf<Pair<String, String>>()
    val q1 = when {
        tone == FrontPage.Tone.Win && f?.walkOff == true -> "――劇的なサヨナラ勝ち。"
        tone == FrontPage.Tone.Win && f != null && f.trailed && f.maxDeficit >= 3 -> "――${f.maxDeficit}点差からの逆転。"
        tone == FrontPage.Tone.Win && s.theirs == 0 -> "――完封リレー。"
        tone == FrontPage.Tone.Win && s.streak >= 3 -> "――${s.streak}連勝。"
        tone == FrontPage.Tone.Win -> "――きょうの勝因は。"
        tone == FrontPage.Tone.Lose && f?.walkOff == true -> "――サヨナラ負け。"
        tone == FrontPage.Tone.Lose && s.streak >= 3 -> "――${s.streak}連敗。"
        tone == FrontPage.Tone.Lose -> "――きょうの敗因は。"
        else -> "――引き分けに終わった。"
    }
    val a1 = if (tone == FrontPage.Tone.Win && creed != null && pen.pick(listOf(true, false), 60)) "${creed}。それをやり切った結果だ" else quote
    qa += q1 to a1
    // 主役
    val b = f?.topBatter?.takeIf { it.hr > 0 || it.rbi >= 2 || it.hits >= 3 }
    val ace = f?.ace
    if (b != null) {
        val feat = when { b.hr >= 2 -> "${b.hr}本塁打"; b.hr == 1 -> "本塁打"; b.hits >= 3 -> "${b.hits}安打"; else -> "${b.rbi}打点" }
        qa += "――${familyName(b.name)}が$feat。" to pen.pick(
            when (tone) {
                FrontPage.Tone.Win -> listOf("調子が上がってきた。今はあいつに回せば何か起きる", "よく打ってくれた。頼もしい", "練習の成果。本人の努力だ", "こういう日を増やしてほしい")
                FrontPage.Tone.Lose -> listOf("あいつが打っても勝てなかった。周りが続かないと", "一人で打っても勝てない", "あの打撃は明日につながる")
                else -> listOf("よく打ってくれた。あと1本が欲しかった", "あの打撃は明日につながる")
            },
            61,
        )
    } else if (ace != null && ace.outs >= 18) {
        qa += "――${familyName(ace.name)}が${inningsText(ace.outs, InningsStyle.Box)}回${ace.runs}失点。" to pen.pick(
            when (tone) {
                FrontPage.Tone.Win -> listOf("試合をつくってくれた。言うことはない", "球に力があった", "捕手とよく話し合えていた")
                FrontPage.Tone.Lose -> listOf("よく投げた。打線が援護できなかった", "投手を責める試合ではない", "勝たせてあげたかった")
                else -> listOf("よく投げた。勝ちを付けてあげたかった", "試合をつくってくれた")
            },
            62,
        )
    }
    // 先発が早く降りた日
    val order = game?.let { g -> pitchingOrder(g, team, g.at("teams", team).list().mapNotNull { it.obj() }.map { DetailPlayer(it) }) }
    val starter = order?.firstOrNull()
    if (starter != null && starter.outs < 15 && starter.p("runsAllowed") >= 3) {
        qa += "――先発の${familyName(starter.name)}は${inningsText(starter.outs, InningsStyle.Box)}回で降板。" to when {
            temper >= 1 -> pen.pick(listOf("あれでは任せられない。次は考える", "試合を壊した。反省してもらう"), 63)
            else -> pen.pick(listOf("本人がいちばん悔しいはず。次も任せる", "調子が悪い日もある。切り替えてほしい"), 63)
        }
    } else if (s.streak >= 2 && tone == FrontPage.Tone.Win) {
        qa += "――チームの状態は。" to pen.pick(listOf("一戦一戦、やることは変わらない", "いい雰囲気でやれている", "浮かれずにいきたい"), 64)
    }
    val how = when {
        temper >= 1 -> pen.pick(listOf("熱っぽく", "語気を強めて"), 65)
        temper <= -1 -> pen.pick(listOf("穏やかに", "落ち着いた口調で"), 65)
        else -> pen.pick(listOf("淡々と", "言葉を選びながら"), 65)
    }
    val event = when (tone) {
        FrontPage.Tone.Win -> if (f?.trailed == true && f.maxDeficit >= 3) "大逆転劇" else if (f?.walkOff == true) "サヨナラ劇" else "${s.place}での白星"
        FrontPage.Tone.Lose -> "${s.place}での黒星"
        else -> "引き分け"
    }
    return PaperInterview(
        title = "${speaker}「${shortQuote(quote)}」",
        intro = "${event}から一夜。${speaker}は試合後、${how}語った。（一問一答）",
        speaker = speaker,
        qa = qa,
    )
}

/** 選手の談話（ヒーロー） */
internal fun heroTalk(hero: PaperHero?, tone: FrontPage.Tone, pen: Pen): FrontPage.Article? {
    hero ?: return null
    val pitcher = hero.position == "投手"
    val n = familyName(hero.name)
    val (quote, more) = when {
        tone == FrontPage.Tone.Win && pitcher -> pen.pick(listOf("捕手のリードのおかげです", "野手に助けてもらいました", "次も長い回を投げたい", "真っすぐで押せた"), 70) to
            pen.pick(listOf("「次の登板も同じように投げたい」と話した。", "「まだまだ良くなる」と気を引き締めた。"), 71)
        tone == FrontPage.Tone.Win -> pen.pick(listOf("打てる球を待てている", "甘い球をしっかり振れた", "チームの勝ちに貢献できてうれしい", "とにかく必死でした"), 70) to
            pen.pick(listOf("「チームが勝つ打点を挙げたい」と次戦を見据えた。", "「明日も打てるよう準備します」と笑顔を見せた。", "「調子はいい」と手応えを口にした。"), 71)
        pitcher -> pen.pick(listOf("粘り切れず悔しい", "勝ちにつながる投球ができなかった"), 70) to "「次は必ず」と前を向いた。"
        else -> pen.pick(listOf("勝ちにつながらず悔しい", "打てても負けたら意味がない"), 70) to "「明日こそ勝てるように」と唇をかんだ。"
    }
    val line = hero.lines.joinToString("") { it.first }
    return FrontPage.Article(
        "ヒーロー",
        "${n}「${quote}」",
        "この日${line}の${hero.name}は「${quote}」と振り返った。" + (hero.season?.let { "${it.removePrefix("今季 ")}と、今季も数字を残している。" } ?: "") + more,
        LINK_LINEUP,
    )
}

/** 調子の矢印（0〜4 → −2〜2） */
private fun arrowOf(condition: Int?): Int = ((condition ?: 2) - 2).coerceIn(-2, 2)

/** 2面を作る */
internal fun buildTeamPage(
    view: LeagueView,
    raw: JsonObject?,
    team: String,
    me: String,
    own: List<GameResult>,
    tone: FrontPage.Tone,
    s: Situation?,
    game: JsonObject?,
    hero: PaperHero?,
    leftover: List<FrontPage.Article>,
    pen: Pen,
): TeamPage {
    val last10 = own.takeLast(10)
    val form = last10.map { it.outcomeFor(team) }
    val now = mutableListOf<Pair<String, String>>()
    if (last10.isNotEmpty()) {
        val w = form.count { it > 0 }
        val l = form.count { it < 0 }
        now += "直近${last10.size}試合" to "${w}勝${l}敗${if (last10.size - w - l > 0) "${last10.size - w - l}分" else ""}"
        val scored = last10.sumOf { if (it.home == team) it.homeScore ?: 0 else it.awayScore ?: 0 }
        val allowed = last10.sumOf { if (it.home == team) it.awayScore ?: 0 else it.homeScore ?: 0 }
        now += "1試合の得点" to oneDecimal(scored.toDouble() / last10.size)
        now += "1試合の失点" to oneDecimal(allowed.toDouble() / last10.size)
    }
    // チーム打率・防御率（部の中の順位）
    val ranks = teamStatRanks(view, raw, team)
    val avgRank = ranks?.avgRank
    val eraRank = ranks?.eraRank
    ranks?.let { r ->
        if (r.avg != null && r.avgRank != null) now += "チーム打率" to "${rate3(r.avg)}（${r.avgRank}位）"
        if (r.era != null && r.eraRank != null) now += "チーム防御率" to "${twoDecimals(r.era)}（${r.eraRank}位）"
    }
    val half = ((ranks?.teams ?: 0) + 1) / 2
    val nowNote = if (avgRank != null && eraRank != null) when {
        avgRank <= half && eraRank <= half -> pen.pick(listOf("投打がかみ合い、地力がついてきた。", "打っても投げても上位。崩れる気配は少ない。"), 80)
        avgRank <= half -> pen.pick(listOf("打線は好調だが、投手陣が踏ん張りきれていない。", "打ち勝つ野球。投手陣の立て直しが課題だ。"), 80)
        eraRank <= half -> pen.pick(listOf("投手陣は粘っているが、打線の援護が足りない。", "守り勝つ野球。あと1本が出れば上が見える。"), 80)
        else -> pen.pick(listOf("投打ともに下位。我慢の時期が続く。", "打線も投手陣も、もう一段の奮起が要る。"), 80)
    } else null

    // 調子の矢印（スタメンと、調子の振れた控え）
    val orderIds = view.lineup?.at("battingOrder").list().mapNotNull { it.obj() }.associate { (it.at("playerId").long() ?: 0L) to (it.at("position").str() to (it.at("battingOrder").int() ?: 0)) }
    val fielders = view.roster.filter { it.isActive && !it.isPitcher }
    val candidates = fielders.filter { it.id in orderIds || (it.condition ?: 2) >= 4 || (it.condition ?: 2) <= 0 }
    val conditions = candidates
        .sortedWith(compareByDescending<Player> { abs(arrowOf(it.condition)) }.thenBy { orderIds[it.id]?.second ?: 99 })
        .take(5)
        .sortedByDescending { arrowOf(it.condition) }
        .map { p ->
            val r = p.recent
            val note = when {
                r == null -> ""
                r.hitStreak >= 3 -> "${r.hitStreak}試合連続安打"
                hotRecent(r) -> "${r.games}試合で${r.hits}安打"
                coldRecent(r) -> "${r.games}試合で${r.hits}安打"
                p.id !in orderIds -> "控え"
                else -> ""
            }
            ConditionRow(arrowOf(p.condition), familyName(p.name), orderIds[p.id]?.first?.let { POS_SHORT[it] } ?: "控", note)
        }

    // 投手陣の疲れ
    val pitchers = view.roster.filter { it.isActive && it.isPitcher && (it.fatigue ?: 0) >= 30 }
        .sortedByDescending { it.fatigue }
        .take(3)
        .map { p ->
            val f = p.fatigue ?: 0
            Triple(familyName(p.name), "疲労$f", f >= 60)
        }
    val rotation = run {
        val starters = view.lineup?.at("starters").list().mapNotNull { it.long() }
        if (starters.isEmpty()) return@run null
        val next = raw?.at("nextStarterId").long()
        val i = starters.indexOf(next).takeIf { it >= 0 } ?: 0
        val byId = view.roster.associateBy { it.id }
        (0 until minOf(3, starters.size)).mapNotNull { k -> byId[starters[(i + k) % starters.size]]?.name?.let(::familyName) }.joinToString("→").ifEmpty { null }
    }

    val articles = mutableListOf<FrontPage.Article>()
    heroTalk(hero, tone, pen)?.let { articles += it }
    opponentReport(view, raw, team, own)?.let { articles += it }
    prospectArticle(view, pen)?.let { articles += it }
    articles += leftover

    val interview = s?.let { interviewOf(view, tone, it, game, team, pen) }
    return TeamPage(
        section = "${teamNick(view.teamLabel(team), me)}番",
        interview = interview,
        form = form,
        now = now,
        nowNote = nowNote,
        conditions = conditions,
        pitchers = pitchers,
        rotation = rotation,
        articles = articles,
    )
}

/** 面の名前に使う球団の愛称（「宮崎アトラス」→「アトラス」）。街の名前が前に付いていなければそのまま */
internal fun teamNick(label: String, city: String): String = label.removePrefix(city).trim().ifEmpty { label }

private fun oneDecimal(v: Double): String { val r = kotlin.math.round(v * 10).toInt(); return "${r / 10}.${abs(r % 10)}" }
private fun twoDecimals(v: Double): String { val r = kotlin.math.round(v * 100).toInt(); return "${r / 100}.${(abs(r) % 100).toString().padStart(2, '0')}" }

/** チーム打率・防御率と、部の中の順位（[teams] は部の球団の数）。チームの成績が無ければ null */
private class TeamStatRanks(val avg: Double?, val avgRank: Int?, val era: Double?, val eraRank: Int?, val teams: Int)

private fun teamStatRanks(view: LeagueView, raw: JsonObject?, team: String): TeamStatRanks? {
    val stats = raw?.at("teamStats").obj() ?: return null
    val league = view.teamLeagues[team]
    val inLeague = stats.keys.filter { league == null || view.teamLeagues[it] == league }
    val mine = stats[team] ?: return null
    val avg = mine.at("average").num()
    val era = mine.at("era").num()
    return TeamStatRanks(
        avg = avg,
        avgRank = avg?.let { v -> 1 + inLeague.count { (stats[it].at("average").num() ?: 0.0) > v } },
        era = era,
        eraRank = era?.let { v -> 1 + inLeague.count { (stats[it].at("era").num() ?: 99.0) < v } },
        teams = inLeague.size,
    )
}

/** 次の相手を探る（相手の順位・連勝連敗・打率と防御率の順位・対戦成績） */
private fun opponentReport(view: LeagueView, raw: JsonObject?, team: String, own: List<GameResult>): FrontPage.Article? {
    val g = view.nextGames.firstOrNull { it.home == team || it.away == team } ?: return null
    val opp = if (g.home == team) g.away else g.home
    val O = view.teamShort(opp)
    val league = view.teamLeagues[opp]
    val table = view.leagueTable(league)
    val rank = table.indexOfFirst { it.team == opp }
    val st = table.getOrNull(rank)?.takeIf { it.gamesPlayed > 0 }
    val parts = mutableListOf<String>()
    st?.let { parts += "${LEAGUE_NAMES[league] ?: ""}${rank + 1}位の${O}は${it.wins}勝${it.losses}敗。" }
    view.teamStreaks[opp]?.takeIf { it.count >= 2 && it.kind != "D" }?.let { parts += "いま${it.count}${if (it.kind == "W") "連勝" else "連敗"}中だ。" }
    teamStatRanks(view, raw, opp)?.let { r ->
        val a = r.avg
        val e = r.era
        val ar = r.avgRank
        val er = r.eraRank
        if (a != null && ar != null) parts += "チーム打率${rate3(a)}は部で${ar}位、"
        if (e != null && er != null) parts += "防御率${twoDecimals(e)}は${er}位。"
        if (ar != null && er != null) parts += when {
            ar <= 2 && er >= r.teams - 1 -> "打線は怖いが、投手陣には付け入る隙がある。"
            er <= 2 && ar >= r.teams - 1 -> "投手陣は手ごわいが、打線は湿りがちだ。"
            ar <= 2 && er <= 2 -> "投打に穴の少ない難敵だ。"
            else -> ""
        }
    }
    val versus = own.filter { it.home == opp || it.away == opp }
    if (versus.isNotEmpty()) {
        val w = versus.count { it.outcomeFor(team) > 0 }
        val l = versus.count { it.outcomeFor(team) < 0 }
        parts += "今季の対戦は${w}勝${l}敗。"
    }
    if (parts.isEmpty()) return null
    return FrontPage.Article("次の相手", "${O}を探る", parts.joinToString(""), LINK_LINEUP)
}

/** 若手の芽（23歳以下で伸びしろのある自球団の選手。日によって載せる） */
private fun prospectArticle(view: LeagueView, pen: Pen): FrontPage.Article? {
    val young = view.roster.filter { it.isActive && (it.age ?: 99) <= 23 && (it.growthPotential ?: 1.0) >= 1.1 }
    if (young.isEmpty() || !pen.pick(listOf(true, true, false), 90)) return null
    val p = pen.pick(young.sortedByDescending { it.growthPotential ?: 0.0 }.take(3), 91)
    val strength = if (p.isPitcher) listOfNotNull(
        p.pitching?.velocity?.let { "最速${it}km" to (it - 140) * 4 },
        p.pitching?.control?.let { "制球$it" to it - 50 },
    ).maxByOrNull { it.second }?.first
    else listOfNotNull(
        p.batting?.meet?.let { "ミート$it" to it },
        p.batting?.power?.let { "パワー$it" to it },
        p.physical?.speed?.let { "走力$it" to it },
    ).maxByOrNull { it.second }?.first
    val now = if (p.isPitcher) p.seasonStats?.pitching?.takeIf { it.games > 0 }?.let { "今季は${it.games}試合に投げて${it.wins}勝${it.losses}敗。" }
    else p.seasonStats?.batting?.takeIf { it.atBats > 0 }?.let { "今季は${it.atBats}打数で打率${rate3(it.hits.toDouble() / it.atBats)}。" }
    val big = (p.growthPotential ?: 1.0) >= 1.3
    return FrontPage.Article(
        "若手の芽",
        "${familyName(p.name)}（${p.age}）",
        "${p.age}歳の${positionNoun(p.position)}・${p.name}。" + (strength?.let { "${it}が持ち味だ。" } ?: "") + (now ?: "まだ出番は少ない。") +
            if (big) pen.pick(listOf("首脳陣は「必ず出てくる」と期待を寄せる。", "伸びしろは大きく、将来の中心選手と目される。"), 92)
            else pen.pick(listOf("じっくり力をつけている。", "出番をつかめるか。"), 92),
        LINK_LINEUP,
    )
}

// ---------------------------------------------------------------------------------------------
// 3面（記録面）

/** 戦評（回ごとの得点から流れを書く） */
internal fun reviewOf(s: Situation, ls: FrontPage.LineScore?, f: GameFacts?, pen: Pen): Pair<String, String>? {
    ls ?: return null
    val ours = if (s.home) ls.homeRuns else ls.awayRuns
    val theirs = if (s.home) ls.awayRuns else ls.homeRuns
    // 半回ごとの得点（表→裏）
    data class Half(val inning: Int, val us: Boolean, val runs: Int)
    val halves = mutableListOf<Half>()
    for (i in 0 until maxOf(ours.size, theirs.size)) {
        val top = if (s.home) theirs.getOrNull(i)?.let { Half(i + 1, false, it) } else ours.getOrNull(i)?.let { Half(i + 1, true, it) }
        val bot = if (s.home) ours.getOrNull(i)?.let { Half(i + 1, true, it) } else theirs.getOrNull(i)?.let { Half(i + 1, false, it) }
        listOfNotNull(top, bot).filter { it.runs > 0 }.forEach { halves += it }
    }
    if (halves.isEmpty()) return null
    var a = 0
    var b = 0
    val sentences = mutableListOf<String>()
    for (h in halves) {
        val before = a - b
        if (h.us) a += h.runs else b += h.runs
        val after = a - b
        val who = if (h.us) s.me else s.opp
        val verb = when {
            before == 0 && a + b == h.runs -> "先制"
            before <= 0 && after > 0 && h.us && before < 0 -> "逆転"
            before >= 0 && after < 0 && !h.us && before > 0 -> "逆転"
            after == 0 -> "同点に追いつく"
            (h.us && before == 0 && after > 0) || (!h.us && before == 0 && after < 0) -> "勝ち越し"
            (h.us && after > 0) || (!h.us && after < 0) -> "加点"
            else -> "反撃"
        }
        sentences += "${h.inning}回に${who}が${h.runs}点を挙げて$verb"
    }
    // 長いときは最初と、流れが変わった所と、いちばん大きな回と、最後だけ（起きた順）
    val keep = if (sentences.size <= 4) sentences else {
        val big = halves.indices.maxByOrNull { halves[it].runs }
        sentences.indices.filter { i ->
            i == 0 || i == sentences.lastIndex || i == big || "逆転" in sentences[i] || "同点" in sentences[i] || "勝ち越し" in sentences[i]
        }.take(5).map { sentences[it] }
    }
    val body = keep.joinToString("。") { it } + "。" +
        (f?.ourPitchers?.let { ps ->
            when {
                ps.isEmpty() -> ""
                ps.size == 1 -> "${s.me}は${familyName(ps[0].name)}が1人で投げ抜き、${if (s.theirs == 0) "無失点" else "${s.theirs}失点"}。"
                else -> "${s.me}の投手陣は${ps.size}人の継投で${if (s.theirs == 0) "無失点" else "${s.theirs}失点"}。"
            }
        } ?: "") +
        (f?.winningHit?.let { "決勝点は${it.inning}回、${it.name}の${it.what}だった。" } ?: f?.theirWinningHit?.let { "${it.inning}回、${it.name}に決勝の${it.what}を許した。" } ?: "")
    val head = when {
        f?.walkOff == true -> if (s.ours > s.theirs) "最後に試合を決める" else "最後の最後に暗転"
        f != null && f.trailed && s.ours > s.theirs -> pen.pick(listOf("粘りが逆転呼ぶ", "終盤の反撃が実る"), 100)
        f != null && f.led && s.ours < s.theirs -> pen.pick(listOf("リード守れず", "逃げ切りに失敗"), 100)
        s.ours > s.theirs && s.theirs == 0 -> "投手陣が零封リレー"
        s.ours > s.theirs -> pen.pick(listOf("流れを渡さず", "序盤から主導権"), 100)
        s.ours < s.theirs -> pen.pick(listOf("流れをつかめず", "反撃届かず"), 100)
        else -> "決着つかず"
    }
    return head to body
}

internal fun buildRecordPage(
    view: LeagueView,
    raw: JsonObject?,
    team: String,
    s: Situation?,
    game: JsonObject?,
    ls: FrontPage.LineScore?,
    f: GameFacts?,
    pen: Pen,
): RecordPage {
    val league = view.teamLeagues[team]
    val table = view.leagueTable(league)
    val top = table.firstOrNull()
    val standings = table.mapIndexed { i, st ->
        val streak = view.teamStreaks[st.team]?.takeIf { it.count >= 3 && it.kind != "D" }?.let { "${it.count}${if (it.kind == "W") "連勝" else "連敗"}" } ?: ""
        StandRow(i + 1, view.teamShort(st.team), st.wins, st.losses, if (i == 0 || top == null) "―" else gb(gamesBehind(top, st)), streak, st.team == team)
    }.takeIf { table.any { it.gamesPlayed > 0 } }.orEmpty()

    // 予告先発（次の日の全試合。自球団を先に）
    val upcoming = raw?.at("upcoming").list().mapNotNull { it.obj() }
    val firstDay = upcoming.firstOrNull()?.at("date")
    val day = upcoming.filter { it.at("date") == firstDay }
    val probables = day.sortedBy { if (it.at("home").str() == team || it.at("away").str() == team) 0 else 1 }.map { g ->
        val home = g.at("home").str().orEmpty()
        val away = g.at("away").str().orEmpty()
        val hs = g.at("homeStarter").str()?.let(::familyName) ?: "未定"
        val aw = g.at("awayStarter").str()?.let(::familyName) ?: "未定"
        "${view.teamShort(away)}―${view.teamShort(home)}　$aw―$hs" to (home == team || away == team)
    }
    val probablesTitle = firstDay?.let { d -> d.at("month").int()?.let { m -> "予告先発　${m}月${d.at("day").int()}日" } }

    // 個人成績ベスト5（打率・本塁打・防御率）
    val boards = raw?.at("leaders").list().mapNotNull { it.obj() }
    val leaders = listOf("avg" to "打率", "homeruns" to "本塁打", "era" to "防御率").mapNotNull { (id, label) ->
        val b = boards.firstOrNull { it.at("id").str() == id } ?: return@mapNotNull null
        val rows = b.at("rows").list().mapNotNull { it.obj() }.take(5).map { r ->
            val v = r.at("value").num()
            val value = when (id) { "avg" -> rate3(v); "era" -> v?.let(::twoDecimals) ?: "-"; else -> "${v?.toInt() ?: "-"}" }
            val t = r.at("team").str().orEmpty()
            LeaderRow(familyName(r.at("name").str().orEmpty()), teamMark(view, t), value, t == team)
        }
        LeaderBoard(label, rows).takeIf { rows.isNotEmpty() }
    }

    // リーグ短信（ほかの球団の話題）
    val shorts = mutableListOf<FrontPage.Article>()
    val lastDay = view.results.lastOrNull()?.date
    milestonesOn(view, lastDay).filter { it.team != team }.take(2).forEach { m ->
        shorts += FrontPage.Article("記録", "${familyName(m.name)}、${m.label}", "${view.teamShort(m.team)}の${m.name}が${m.label}に到達した。", LINK_GAMES)
    }
    view.teamStreaks.filter { (t, st) -> t != team && st.count >= 4 && st.kind != "D" }.entries.sortedByDescending { it.value.count }.take(2).forEach { (t, st) ->
        val T = view.teamShort(t)
        shorts += if (st.kind == "W") FrontPage.Article("連勝", "${T}${st.count}連勝", "${T}が${st.count}連勝と勢いに乗っている。", LINK_GAMES)
        else FrontPage.Article("連敗", "${T}${st.count}連敗", "${T}は${st.count}連敗。トンネルを抜け出せない。", LINK_GAMES)
    }
    view.races.filter { it.team != team && !it.clinched && it.magic in 1..20 }.take(1).forEach { r ->
        raceText(r, view::teamShort)?.let { shorts += FrontPage.Article("マジック", it.head, it.body, LINK_GAMES) }
    }

    val gameTitle = s?.let {
        val away = if (it.home) it.opp else it.me
        val home = if (it.home) it.me else it.opp
        val (as0, hs0) = if (it.home) it.theirs to it.ours else it.ours to it.theirs
        val innings = ls?.let { l -> maxOf(l.awayRuns.size, l.homeRuns.size) } ?: 9
        "$away $as0―$hs0 $home" + if (innings > 9) "（延長${innings}回）" else ""
    }
    val review = s?.let { reviewOf(it, ls, f, pen) }
    val boxes = game?.let { g ->
        val teams = g.at("teams").obj()?.keys.orEmpty().sortedBy { if (it == team) 0 else 1 }
        teams.mapNotNull { boxTeam(view, g, it) }
    }.orEmpty()
    return RecordPage(
        game = gameTitle,
        reviewHead = review?.first,
        review = review?.second,
        boxes = boxes,
        notes = game?.let { boxNotes(view, it, team) }.orEmpty(),
        relays = game?.let { relayNotes(it, team) }.orEmpty(),
        leagueName = league?.let { LEAGUE_NAMES[it] } ?: "",
        standings = standings,
        probablesTitle = probablesTitle,
        probables = probables,
        leaders = leaders,
        shorts = shorts,
    )
}

/** 1面に載せる記事と、2面へ回す記事に分ける（1面は大きなニュースと次戦・警戒だけ。コラムは別に囲む） */
internal fun splitFront(articles: List<FrontPage.Article>): Pair<List<FrontPage.Article>, List<FrontPage.Article>> {
    val frontKinds = setOf("記録達成", "決定", "日本一決定戦", "次戦予告", "警戒警報", "現役引退", "ドラフト", "トライアウト", "トレード", "昇格・降格", "新体制", "人事")
    val front = mutableListOf<FrontPage.Article>()
    val rest = mutableListOf<FrontPage.Article>()
    articles.forEach { a ->
        when {
            a.link == LINK_TIPS -> {}
            a.link == LINK_APP_UPDATE -> front += a
            a.kicker in frontKinds && front.count { it.link != LINK_APP_UPDATE } < 2 -> front += a
            else -> rest += a
        }
    }
    return front to rest
}

/** 見出しに入れる談話。長ければ読点で切り、それでも長ければ省く */
internal fun shortQuote(q: String, max: Int = 18): String {
    if (q.length <= max) return q
    val stop = q.indexOf('。')
    if (stop in 6..max) return q.substring(0, stop)
    val comma = q.indexOf('、')
    if (comma in 6..max) return q.substring(0, comma)
    return q.take(max - 1) + "…"
}

/** 表に添える球団の1字（「（宮）」）。ほかの球団と1字目がかぶるときは短い名前のまま */
internal fun teamMark(view: LeagueView, team: String): String {
    val short = view.teamShort(team)
    val head = short.take(1)
    val clash = (view.teamLeagues.keys + view.teamLabels.keys).any { it != team && view.teamShort(it).take(1) == head }
    return if (clash) short else head
}

// 1面の写真の影絵（Android の PaperParts.kt が描く）
const val SCENE_HOMER = "homer"
const val SCENE_WALKOFF = "walkoff"
const val SCENE_PITCHER = "pitcher"
const val SCENE_BATTER = "batter"
const val SCENE_DOWN = "down"

/** 写真の影絵の場面（サヨナラの歓喜・本塁打・投手・構える打者・うなだれる選手） */
internal fun sceneOf(tone: FrontPage.Tone, f: GameFacts?, hero: PaperHero?): String? = when (tone) {
    FrontPage.Tone.Win -> when {
        f?.walkOff == true -> SCENE_WALKOFF
        hero?.position == "投手" -> SCENE_PITCHER
        (f?.ourHomeruns ?: 0) > 0 -> SCENE_HOMER
        else -> SCENE_BATTER
    }
    FrontPage.Tone.Lose -> SCENE_DOWN
    FrontPage.Tone.Draw -> SCENE_BATTER
    FrontPage.Tone.None -> null
}

/**
 * 影絵の絵の候補（いしだに頼んだ16枚の番号）。
 * 01 本塁打のスイング 02 本塁打の一周 03 サヨナラの歓喜 04 ホームで迎える 05 投げる投手 06 雄たけびの投手 07 投手と捕手の抱擁
 * 08 打って走り出す 09 ヘッドスライディング 10 ダイビングキャッチ 11 ハイタッチ 12 構える打者
 * 13 うなだれる 14 引き揚げる後ろ姿 15 しゃがみこむ投手 16 ベンチの手すり
 * 17 空振り三振で片ひざ 18 打球を見上げる外野手 19 マウンドを降りる投手 20 ホームでタッチアウト 21 打球をはじく内野手 22 スタンドへ一礼
 */
internal fun shotsOf(tone: FrontPage.Tone, s: Situation?, f: GameFacts?, hero: PaperHero?): List<List<String>> {
    s ?: return emptyList()
    val first: List<String> = when (tone) {
        FrontPage.Tone.Win -> when {
            f?.walkOff == true -> listOf("s03", "s04")
            s.theirs == 0 && f?.complete == true -> listOf("s06", "s07")
            (f?.ourHomeruns ?: 0) > 0 && hero?.position != "投手" -> listOf("s01", "s02")
            hero?.position == "投手" -> listOf("s05", "s06")
            f != null && f.trailed -> listOf("s08")
            s.diff == 1 -> listOf("s09", "s10")
            else -> listOf("s11", "s12", "s08")
        }
        FrontPage.Tone.Lose -> when {
            f?.walkOff == true && f.theirWinningHit?.homerun == true -> listOf("s18", "s14")
            f?.walkOff == true -> listOf("s14", "s20")
            s.diff >= 5 || s.theirs >= 8 -> listOf("s15", "s19")
            s.ours == 0 -> listOf("s16", "s17")
            (f?.ourErrors ?: 0) >= 2 -> listOf("s21")
            f?.theirWinningHit?.homerun == true -> listOf("s18")
            s.diff == 1 -> listOf("s20", "s13")
            s.streak >= 3 -> listOf("s22", "s13")
            else -> listOf("s13", "s16", "s14", "s17")
        }
        FrontPage.Tone.Draw -> listOf("s12", "s16")
        FrontPage.Tone.None -> return emptyList()
    }
    val fallback = if (tone == FrontPage.Tone.Lose) listOf("s13", "s16") else listOf("s12", "s11")
    return listOf(first, fallback)
}
