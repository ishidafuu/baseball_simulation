package jp.icenorth.baseball.shared

import kotlinx.serialization.json.JsonObject
import kotlin.math.abs
import kotlin.math.round

/**
 * ホームの「スポーツ新聞」の紙面。ビューと、自球団の最新の試合の詳細（あれば）から見出しと記事を作る。
 *
 * ⚠ 数字の表（順位表・タイトル争いの一覧・リーグ便りの全件）は試合タブに置く（いしだの指定:
 *    「数字数字したことは試合タブ、ホームはエンタメ感」）。ここでは数字は記事の文の中に少しだけ入れる。
 * ⚠ 文はビューから決まる（同じビューなら同じ紙面）。言い回しは試合ごとに変える（[Pen]・FrontPageCopy.kt）。
 *    乱数で選ぶと、開き直すたびに記事が変わって見える。
 */
data class FrontPage(
    /** 題字の下の日付（「4月23日 第25ターン」） */
    val issue: String,
    /** 自球団の名前（題字の下に出す） */
    val team: String,
    /** 部の中の順位と勝敗（「1部 3位 10勝8敗」）。まだ試合が無ければ部だけ */
    val standing: String?,
    /** リーグの状態（進行中・停止中など） */
    val status: String?,
    /** 自分の番の手続き・返事待ちのトレードなど（紙面のいちばん上に「お知らせ」で出す。押すと手続きへ） */
    val alerts: List<String>,
    /** 大見出し */
    val headline: String,
    /** 袖見出し（連勝・順位など） */
    val kicker: String?,
    /** 小見出し（勝ち投手・主役） */
    val subhead: String?,
    /** リード文 */
    val lead: String?,
    val tone: Tone,
    /** 大見出しの下に出す得点（自球団の最新の試合） */
    val score: Score?,
    val articles: List<Article>,
    /** リーグ短信（同じ日のほかの試合） */
    val shorts: List<String>,
    /** どちらの新聞か（地元紙＝自球団の目線 / 全国紙＝リーグ全体を中立に） */
    val paper: Paper = Paper.Local,
    /** 題字（地元紙は「宮崎球報」のように街の名前から。全国紙は NEXT STAGE） */
    val title: String = "NEXT STAGE",
    /** 題字の脇の帯（「スポーツ」「地元紙」） */
    val badge: String = "スポーツ",
    /** 号外（ノーヒットノーラン・2桁連勝など）。紙面の上に「号外」の帯を出す */
    val extra: Boolean = false,
    /** 回ごとの得点（大見出しの下のスコアの代わりに出す。記録に無い古い試合は null） */
    val lineScore: LineScore? = null,
    /** 勝敗投手・本塁打の欄（「勝 ○○ 3勝1敗」「本 △△ 5号」）。新聞の小さな定型欄 */
    val box: List<Pair<String, String>> = emptyList(),
    /** 曜日つきの日付（「4月23日（木曜日）」。新聞風の題字の横） */
    val dateLine: String? = null,
    /** 号数（今季のターン。新聞風の欄外） */
    val issueNo: Int? = null,
    /** 1面の縦の大見出し（「大逆転」「完封」など短い言葉）。新聞風だけが使う */
    val bigHead: String? = null,
    /** 縦の袖見出し（大見出しから自球団の名前を落としたもの） */
    val bigSub: String? = null,
    /** リード文の横の縦の小見出し */
    val leadHead: String? = null,
    /** 写真（球場の得点板）の説明 */
    val caption: String? = null,
    /** ヒーロー欄 */
    val hero: PaperHero? = null,
    /** 題字の下の「きょうの紙面」（目次） */
    val index: List<String> = emptyList(),
    /** 1面の「きのうの結果」（同じ日のほかの試合） */
    val results: List<ResultRow> = emptyList(),
    /** 新聞風の1面に載せる記事（残りは2面）。null なら [articles] を全部1面に */
    val frontArticles: List<Article>? = null,
    /** 囲みのコラム（TIPS） */
    val column: Article? = null,
    /** 2面（チーム面）。地元紙のシーズン中だけ */
    val teamPage: TeamPage? = null,
    /** 3面（記録面）。地元紙のシーズン中だけ */
    val recordPage: RecordPage? = null,
    /** 速報を見るまで伏せている（新聞風は「ただいま印刷中」） */
    val sealed: Boolean = false,
    /** 1面の写真に描く影絵の場面（[SCENE_HOMER] など）。null なら球場だけ */
    val scene: String? = null,
    /**
     * 影絵の絵の候補（"s01" など。いしだに渡した16枚の番号）。前の組から順に、絵のある組を使い、組の中は試合で選ぶ。
     * 絵が1枚も無ければ [scene] を図形で描く
     */
    val shots: List<List<String>> = emptyList(),
) {
    enum class Tone { Win, Lose, Draw, None }
    enum class Paper(val label: String) { Local("地元紙"), National("全国紙") }
    data class Score(val away: String, val awayScore: Int, val home: String, val homeScore: Int)
    /** 回ごとの得点。[home] の最後の回がサヨナラなら [walkOff]（「x」を付ける） */
    data class LineScore(val away: String, val home: String, val awayRuns: List<Int>, val homeRuns: List<Int>, val walkOff: Boolean)
    /** @param link 押したときに開く所（[LINK_LINEUP] など）。null なら押せない */
    data class Article(val kicker: String, val title: String, val body: String, val link: String? = null)
}

const val LINK_LINEUP = "lineup"
const val LINK_GAMES = "games"
const val LINK_TIPS = "tips"

private fun one(v: Double?): String = v?.let { (round(it * 10) / 10).toString() } ?: "-"
private fun two(v: Double?): String = v?.let { val r = round(it * 100).toInt(); "${r / 100}.${(abs(r) % 100).toString().padStart(2, '0')}" } ?: "-"

/** 手続きの時期（試合が無く、1面は時期の話にする） */
internal val OFF_PHASES = setOf("pack_select", "initial_tryout", "camp", "contract", "tryout", "offseason")

/**
 * 部の中の並べ方（勝率→勝利数→球団名）。Web の `compareLeagueStanding`（src/online/pyramidLeague.js）と同じ。
 * ⚠ ビューの順位表（standings）は全球団を通した勝率→勝利数の並びで、同率のときの順が決まっていない。
 *    昇降格・マジック（サーバー）と PC の順位表はこの並べ方なので、紙面の順位もこれで数える
 */
val LEAGUE_STANDING_ORDER: Comparator<Standing> =
    compareByDescending<Standing> { it.winRate }.thenByDescending { it.wins }.thenBy { it.team }

/** 部の順位表（1位から）。[league] が null（部の無い古いビュー）なら全球団 */
fun LeagueView.leagueTable(league: String?): List<Standing> =
    standings.filter { league == null || teamLeagues[it.team] == league }.sortedWith(LEAGUE_STANDING_ORDER)

/** ゲーム差の書き方（「4」「2.5」。「4.0差」とは書かない）。地元紙・全国紙で共通 */
internal fun gb(v: Double): String = if (v % 1.0 == 0.0) "${v.toInt()}" else one(v)

/** [leader] と [me] のゲーム差（0なら並んでいる）。地元紙・全国紙で共通 */
internal fun gamesBehind(leader: Standing, me: Standing): Double = ((leader.wins - me.wins) + (me.losses - leader.losses)) / 2.0

/** [team] から見た試合の結果（1 勝ち・−1 負け・0 引き分け。点が無ければ0点として数える） */
internal fun GameResult.outcomeFor(team: String): Int {
    val h = home == team
    return ((if (h) homeScore else awayScore) ?: 0).compareTo((if (h) awayScore else homeScore) ?: 0)
}

/** 日付の通し番号（年×10000＋月×100＋日）。並べる・同じ日を見分けるのに使う（年をまたいでも大小が日付の順） */
internal fun dayKey(year: Int, month: Int, day: Int): Int = year * 10000 + month * 100 + day

internal fun GameDate.dayKey(): Int = dayKey(year, month, day)

/**
 * @param alerts 自分の番の手続きなど（締め切りの書き方が端末の時計に依るので、画面の側で作って渡す）
 * @param column 紙面の終わりに載せるコラム（ゲームのTIPS など）
 * @param history 自球団の今季の試合（古い順。「試合」の窓口から読んだもの）。
 *                ⚠ ビューの results は**リーグ全体の直近14試合**しか無い（自球団は2〜3試合）ので、連勝・連敗や
 *                相手との対戦成績はこれで数える。無ければビューの分だけで数え、対戦成績は書かない
 * @param historyComplete [history] が今季の自球団の試合を全部含むか（対戦成績を書いてよいか）
 * @param app 入っているアプリが最新かの記事と、いちばん上に置くか（[appVersionArticle]）
 * @param opponent 次の相手の名簿（「team」の窓口）。警戒選手を書く。無ければ書かない
 */
fun buildFrontPage(
    view: LeagueView,
    raw: JsonObject?,
    lastGame: JsonObject? = null,
    alerts: List<String> = emptyList(),
    column: FrontPage.Article? = null,
    history: List<GameResult>? = null,
    historyComplete: Boolean = false,
    app: Pair<FrontPage.Article, Boolean>? = null,
    opponent: List<Player>? = null,
): FrontPage {
    val team = view.teamName ?: ""
    val me = view.teamShort(team)
    val date = view.currentDate
    val issue = listOfNotNull(
        date?.let { "${it.month}月${it.day}日" },
        turnOfDate(date, view.seasonTurns)?.let { "第${it}ターン" },
    ).joinToString(" ").ifEmpty { formatTurn(date, view.seasonTurns) }

    // 自球団の順位（部の中）
    val league = view.teamLeagues[team]
    val table = view.leagueTable(league)
    val rankIndex = table.indexOfFirst { it.team == team }
    val mine = table.getOrNull(rankIndex)
    val leagueName = league?.let { LEAGUE_NAMES[it] } ?: ""
    val placeText = if (mine != null && mine.gamesPlayed > 0) {
        val behindTop = gamesBehind(table.first(), mine)
        "${leagueName}${rankIndex + 1}位" + if (rankIndex == 0) "" else "（首位と${gb(behindTop)}差）"
    } else null

    val recent = view.results.filter { it.home == team || it.away == team }
    // 読んだ今季の試合とビューの直近の試合を合わせる（同じ試合は1つに。古い順）
    val own = (history.orEmpty() + recent)
        .filter { it.homeScore != null && it.awayScore != null }
        .distinctBy { it.gameId ?: it.hashCode().toLong() }
        .sortedWith(compareBy<GameResult>({ it.date?.month ?: 0 }, { it.date?.day ?: 0 }, { it.gameId ?: 0L }))
    val outcome = { r: GameResult -> r.outcomeFor(team) }
    val last = own.lastOrNull()
    val articles = mutableListOf<FrontPage.Article>()
    // 言い回しは試合（無ければ日付）で選ぶ。同じ試合なら開き直しても同じ紙面
    val pen = Pen(last?.gameId?.toInt() ?: dayKey(view.year ?: 0, date?.month ?: 0, date?.day ?: 0))

    var headline: String
    var kicker: String? = null
    var subhead: String? = null
    var lead: String? = null
    var tone = FrontPage.Tone.None
    var score: FrontPage.Score? = null
    var lineScore: FrontPage.LineScore? = null
    var box: List<Pair<String, String>> = emptyList()
    var extra = false
    var facts: GameFacts? = null
    var sit: Situation? = null
    var detailGame: JsonObject? = null

    // ⚠ 手続きの時期（オフ・キャンプ・初期メンバー選び）は、最後の試合でなく時期の話を1面にする
    //    （以前は11月の契約更改の間も、9月の最後の試合を「白星」と書いていた）
    val offPhase = view.phase?.kind in OFF_PHASES
    if (!offPhase && last != null && last.homeScore != null && last.awayScore != null) {
        val home = last.home == team
        val ours = if (home) last.homeScore else last.awayScore
        val theirs = if (home) last.awayScore else last.homeScore
        val opp = view.teamShort(if (home) last.away else last.home)
        val now = outcome(last)
        val streak = own.asReversed().takeWhile { outcome(it) == now }.size
        // 今日の前に、今日と逆の結果が続いていた数（連敗ストップ・連勝ストップ）
        // ⚠ 止めたのは今日の試合のときだけ（2連勝目以降に「連敗ストップ」とは書かない）
        val broken = if (now == 0 || streak != 1) 0 else own.asReversed().drop(1).takeWhile { outcome(it) == -now }.size
        tone = when { now > 0 -> FrontPage.Tone.Win; now < 0 -> FrontPage.Tone.Lose; else -> FrontPage.Tone.Draw }
        // ⚠ 詳細は**その試合のもの**のときだけ使う（読み終わる前の古い詳細で別の試合の見出しを書かない）。
        //    見出しだけでなく、スコアボードと勝敗投手・本塁打の欄も同じ（別の試合の回ごとの得点・本塁打を出さない）
        val detail = lastGame?.takeIf { it.at("gameId").long() == null || it.at("gameId").long() == last.gameId }
        facts = GameFacts.from(detail, team)
        detailGame = detail
        val situation = Situation(me, opp, home, ours, theirs, streak, broken, mine?.let { rankIndex + 1 }, facts)
        sit = situation
        headline = when (tone) {
            FrontPage.Tone.Win -> winHeadline(situation, pen)
            FrontPage.Tone.Lose -> loseHeadline(situation, pen)
            else -> drawHeadline(situation, pen)
        }
        kicker = listOfNotNull(
            if (streak >= 2 && tone != FrontPage.Tone.Draw) "${streak}${if (tone == FrontPage.Tone.Win) "連勝" else "連敗"}" else null,
            placeText,
        ).joinToString("・").ifEmpty { null }
        score = FrontPage.Score(view.teamShort(last.away), last.awayScore, view.teamShort(last.home), last.homeScore)
        val d = last.decisions
        // 主役（試合の詳細があれば）。無ければ自球団の勝ち投手・負け投手
        subhead = heroSubhead(situation, tone, pen) ?: when (tone) {
            FrontPage.Tone.Win -> listOfNotNull(d?.winningPitcher?.name?.let { "勝ち投手 $it" }, d?.savePitcher?.name?.let { "S $it" }).joinToString("　").ifEmpty { null }
            FrontPage.Tone.Lose -> d?.losingPitcher?.name?.let { "負け投手 $it" }
            else -> null
        }
        val record = mine?.let { "これで${it.wins}勝${it.losses}敗${if (it.draws > 0) "${it.draws}分" else ""}${placeText?.let { p -> "、$p" } ?: ""}。" }
        lead = gameLead(situation, last.date?.let { "${it.month}月${it.day}日" }, tone, record, pen)
        // ⚠ 号外は滅多に無いことだけ（ノーヒットノーラン・2桁連勝）
        extra = tone == FrontPage.Tone.Win && ((facts?.theirHits == 0 && theirs == 0) || streak >= 10)
        lineScore = detail?.let { lineScoreOf(it, view) }
        box = boxLines(view, detail, team, last.decisions)
    } else {
        // まだ試合が無い（初期メンバー選び・キャンプ・オフ）
        val (h, l) = phaseCopy(
            view.phase?.kind,
            view.pendingPack != null,
            date != null && date.month < SEASON_START_MONTH,
            me,
            pen,
        )
        headline = h
        // シーズンを終えたあと（契約更改・トライアウト）は今季の成績をひと言
        lead = if (view.phase?.kind in setOf("contract", "tryout") && mine != null && mine.gamesPlayed > 0)
            listOfNotNull(l, "今季は${mine.wins}勝${mine.losses}敗${if (mine.draws > 0) "${mine.draws}分" else ""}、${leagueName}${rankIndex + 1}位で終えた。").joinToString("")
        else l
    }

    // 記録達成（自球団の選手が、最新の試合の日に届いた節目）
    if (!offPhase) {
        val ours = milestonesOn(view, last?.date).filter { it.team == team }
        ours.firstOrNull()?.let { m ->
            articles += FrontPage.Article(
                "記録達成",
                pen.pick(listOf("${m.name}、${m.label}", "${m.name}が${m.label}に到達", "祝 ${m.name} ${m.label}"), 16),
                milestoneBody(ours, null),
                LINK_GAMES,
            )
        }
    }
    // 引退（年度更新のあと。自球団から退いた人）
    if (offPhase) {
        val gone = view.chronicle.retired.filter { it.team == team }
        if (gone.isNotEmpty())
            articles += FrontPage.Article(
                "現役引退",
                if (gone.size == 1) "${gone[0].name}、現役引退" else "${gone[0].name}ら${gone.size}人が現役引退",
                retiredBody(gone, null) + "長い間、お疲れさまでした。",
                LINK_GAMES,
            )
    }
    // 次戦予告（相手との今季の対戦成績も）
    view.nextGames.firstOrNull { it.home == team || it.away == team }?.let { g ->
        val home = g.home == team
        val oppName = if (home) g.away else g.home
        val opp = view.teamShort(oppName)
        val ourStarter = if (home) g.homeStarterInfo else g.awayStarterInfo
        val theirStarter = if (home) g.awayStarterInfo else g.homeStarterInfo
        val pitchers = if (ourStarter?.name != null && theirStarter?.name != null) {
            "先発は${ourStarter.name}（${ourStarter.wins}勝${ourStarter.losses}敗${ourStarter.era?.let { " 防御率${two(it)}" } ?: ""}）、" +
                "${opp}は${theirStarter.name}（${theirStarter.wins}勝${theirStarter.losses}敗）の予想。"
        } else "先発はまだ決まっていない。"
        // 対戦成績は今季の試合を全部読めたときだけ（一部だけで数えると「初対戦」などと誤る）
        val versus = own.filter { it.home == oppName || it.away == oppName }
        val h2h = when {
            !historyComplete -> ""
            versus.isEmpty() -> "今季初対戦。"
            else -> {
                val w = versus.count { outcome(it) > 0 }
                val l = versus.count { outcome(it) < 0 }
                "今季の${opp}戦は${w}勝${l}敗${if (versus.size - w - l > 0) "${versus.size - w - l}分" else ""}。"
            }
        }
        // 古巣との対戦（経歴にその球団がある自球団の選手）
        val oldBoys = view.roster.filter { p -> p.isActive && p.careerHistory.dropLast(1).any { it.type == "independent" && it.label == oppName } }
        val homecoming = oldBoys.firstOrNull()?.let { p ->
            pen.pick(listOf("${p.name}にとっては古巣との対戦になる。", "古巣${opp}を相手に、${p.name}の${if (p.isPitcher) "快投" else "一打"}に期待がかかる。"), 13)
        }.orEmpty()
        // 天王山（同じ部でゲーム差1.5以内の、首位争い・降格争いの直接対決）
        val theirs = table.firstOrNull { it.team == oppName }
        val showdown = if (!offPhase && mine != null && theirs != null && mine.gamesPlayed > 0) {
            val gap = abs(gamesBehind(mine, theirs))
            val oppRank = table.indexOf(theirs)
            when {
                gap > 1.5 -> null
                minOf(rankIndex, oppRank) == 0 -> "首位攻防"
                league == "A" && minOf(rankIndex, oppRank) >= table.size - 2 -> "残留争い"
                else -> null
            }?.let { kind -> kind to gap }
        } else null
        val nextTitle = showdown?.let { (kind, _) -> pen.pick(listOf("天王山 ${opp}との${kind}", "${kind}の直接対決 ${opp}戦", "負けられない${opp}戦"), 17) } ?: nextGameTitle(opp, home, pen)
        val showdownLine = showdown?.let { (kind, gap) -> if (gap == 0.0) "ゲーム差なしで並ぶ${opp}との${kind}。" else "ゲーム差${gb(gap)}の${opp}との${kind}。" }.orEmpty()
        articles += FrontPage.Article("次戦予告", nextTitle, showdownLine + pitchers + h2h + homecoming, LINK_LINEUP)
        // 警戒選手（地元紙らしく、相手の中心選手を名指しで）
        opponent?.let { warningArticle(opp, it, theirStarter, pen) }?.let { articles += it }
    }

    // 順位の行方（数字は文の中に少しだけ）
    // ⚠ 自球団がまだ試合をしていない・部に1球団しか無いときは書かない（「2位の-」「宮崎はnull」になる）
    // ⚠ シーズンを終えたあと（手続きの時期）は書かない（今季の順位はリードに書く。「追う」「うかがう」にならないよう）
    if (!offPhase && table.size >= 2 && table.first().gamesPlayed > 0 && mine != null && mine.gamesPlayed > 0) {
        val top = table.first()
        val second = table.getOrNull(1)
        val gap = second?.let { gamesBehind(top, it) }
        val behind = gamesBehind(top, mine)
        val (title, body) = standingsCopy(
            me = me,
            rankIndex = rankIndex,
            size = table.size,
            top = view.teamShort(top.team),
            topRecord = "${top.wins}勝${top.losses}敗",
            second = second?.let { view.teamShort(it.team) },
            gapToSecond = gap?.let { gb(it) },
            gapToSecondValue = gap,
            behind = gb(behind),
            behindValue = behind.takeIf { rankIndex > 0 },
            leagueName = leagueName,
            placeText = placeText,
            pen = pen,
        )
        articles += FrontPage.Article("順位の行方", title, body, LINK_GAMES)
    }
    // マジック（自球団のもの。無ければ、自球団が追う相手のもの）
    run {
        val own = view.races.firstOrNull { it.team == team }
        val chased = view.races.firstOrNull { it.rival == team && !it.clinched }
        val race = own ?: chased ?: return@run
        val t = raceText(race, view::teamShort) ?: return@run
        val title = if (own != null) t.head else "${view.teamShort(race.team)}にマジック${race.magic} ${me}が止めるか"
        articles += FrontPage.Article(if (race.clinched) "決定" else "マジック", title, t.body, LINK_GAMES)
    }
    // 独立リーグ日本一決定戦に自球団が出たとき
    recentWorld(view).firstOrNull { it.kind == "grand" && it.ours == team }?.let { w ->
        worldText(w, view::teamShort)?.let { t ->
            articles += FrontPage.Article("日本一決定戦", if (w.champion == team) "${me}、独立リーグ日本一" else "${me}は${w.oursResult ?: "出場"}", t.body, LINK_GAMES)
        }
    }

    // タイトル戦線（自球団の選手が上位に居れば、その話題を優先）
    val boards = raw?.at("leaders").list().mapNotNull { it.obj() }
    val ownLeaders = boards.flatMap { b ->
        b.at("rows").list().mapNotNull { it.obj() }.take(5).withIndex()
            .filter { it.value.at("team").str() == team }
            .map { Triple(b, it.index + 1, it.value) }
    }.sortedBy { it.second }
    if (ownLeaders.isNotEmpty()) {
        val (b, rank, row) = ownLeaders.first()
        val name = row.at("name").str().orEmpty()
        val label = b.at("label").str().orEmpty()
        val others = ownLeaders.drop(1).take(2).joinToString("、") { (bb, r, rr) ->
            if (rr.at("name").str() == name) "${name}は${bb.at("label").str()}でも${r}位" else "${rr.at("name").str()}が${bb.at("label").str()}で${r}位"
        }
        articles += FrontPage.Article(
            "タイトル戦線",
            leaderTitle(name, label, rank, pen),
            "${label}は${leaderValue(b, row)}でリーグ${rank}位につける。" + paceLine(b, row) + if (others.isNotEmpty()) "ほかにも、$others。" else "",
            LINK_GAMES,
        )
    } else {
        boards.firstOrNull { it.at("id").str() == "avg" }?.let { b ->
            b.at("rows").list().firstOrNull()?.obj()?.let { row ->
                val name = row.at("name").str().orEmpty()
                articles += FrontPage.Article(
                    "タイトル戦線",
                    pen.pick(listOf("首位打者争い、${name}が先頭", "打率トップは${name}", "${name}、首位打者を走る"), 6),
                    "${view.teamShort(row.at("team").str().orEmpty())}の${name}が打率${leaderValue(b, row)}でトップ。${me}の選手は上位5人に居ない。",
                    LINK_GAMES,
                )
            }
        }
    }

    // ベンチの話題（絶好調・成績の特徴・お疲れ）
    val hot = view.roster.filter { it.isActive && it.condition == 4 }.map { it.name }
    val labelled = view.roster.filter { it.isActive }.mapNotNull { p ->
        p.performance?.batting?.labels?.firstOrNull { it.tone == "good" }?.let { "${p.name}（${it.text}）" }
    }
    val tired = view.roster.filter { it.isActive && (it.fatigue ?: 0) >= FIELDER_REST_FATIGUE && !it.isPitcher }.map { it.name }
    // 最近の調子（直近5試合・連続試合安打）
    val hotBats = view.roster.filter { !offPhase && it.isActive && !it.isPitcher && hotRecent(it.recent) }
        .sortedByDescending { (it.recent!!.hits * 1000) / it.recent.atBats.coerceAtLeast(1) }
    val coldBats = view.roster.filter { !offPhase && it.isActive && !it.isPitcher && coldRecent(it.recent) }
    val streaker = view.roster.filter { !offPhase && it.isActive && (it.recent?.hitStreak ?: 0) >= 5 }.maxByOrNull { it.recent!!.hitStreak }
    val bench = listOfNotNull(
        hot.takeIf { it.isNotEmpty() }?.let { pen.pick(listOf("絶好調は${it.take(3).joinToString("・")}。", "${it.take(3).joinToString("・")}の調子がいい。"), 9) },
        labelled.takeIf { it.isNotEmpty() }?.let { pen.pick(listOf("${it.take(2).joinToString("、")}と、持ち味が数字に表れている。", "数字の上でも${it.take(2).joinToString("、")}が光る。"), 10) },
        hotBats.firstOrNull()?.let { p ->
            val r = p.recent!!
            if (p == streaker) "${p.name}はここ${r.games}試合で${r.atBats}打数${r.hits}安打、${r.hitStreak}試合連続安打中と当たっている。"
            else pen.pick(listOf("${p.name}はここ${r.games}試合で${r.atBats}打数${r.hits}安打と当たっている。", "最近の${p.name}は${r.games}試合${r.hits}安打と好調だ。"), 14)
        },
        streaker?.takeIf { it != hotBats.firstOrNull() }?.let { p -> "${p.name}は${p.recent!!.hitStreak}試合連続安打中。" },
        coldBats.firstOrNull()?.let { p -> val r = p.recent!!; pen.pick(listOf("一方、${p.name}はここ${r.games}試合で${r.atBats}打数${r.hits}安打と苦しんでいる。", "${p.name}は${r.games}試合${r.hits}安打と当たりが止まった。"), 15) },
        tired.takeIf { it.isNotEmpty() }?.let { pen.pick(listOf("${it.take(3).joinToString("・")}は疲れがたまっており、休養が必要か。", "${it.take(3).joinToString("・")}には疲れの色が見える。"), 11) },
    )
    if (bench.isNotEmpty()) {
        val title = when {
            streaker != null && streaker.recent!!.hitStreak >= 8 -> "${streaker.name}、${streaker.recent.hitStreak}試合連続安打"
            hot.isEmpty() && hotBats.isNotEmpty() -> pen.pick(listOf("${hotBats[0].name}が好調", "${hotBats[0].name}、バットが止まらない", "当たってる${hotBats[0].name}"), 7)
            else -> benchTitle(hot.firstOrNull(), tired.firstOrNull(), me, pen)
        }
        articles += FrontPage.Article("ベンチ裏", title, bench.joinToString(""), LINK_LINEUP)
    }
    // 試合後のひと言（監督と主役の談話。決まり文句から選ぶ）
    sit?.let { situation ->
        val (speaker, temper) = commentSpeaker(view)
        commentArticle(speaker, tone, situation, pen, temper)?.let { articles += it }
    }
    // プロ注目（飾り。NPBのスカウトが見に来ている、という話だけで、選手は抜かれない）
    scoutArticle(view.roster, me, view.year, date, pen)?.let { articles += it }

    // リーグ便りの最新1件（全件は試合タブ）
    raw?.at("notices").list().mapNotNull { it.obj() }.firstOrNull()?.let { n ->
        val items = (n["picks"] ?: n["moves"]).list().mapNotNull { it.obj() }
        when (n.at("type").str()) {
            "draft" -> {
                val ours = items.filter { it.at("team").str() == team }
                articles += FrontPage.Article(
                    "ドラフト",
                    if (ours.isNotEmpty()) "${me}から${ours.size}人がプロへ" else "ドラフト会議で${items.size}人が指名",
                    if (ours.isNotEmpty()) ours.take(3).joinToString("、") { "${it.at("name").str()}（${view.teamShort(it.at("npbTeam").str().orEmpty())}）" } + "が指名を受けた。"
                    else "リーグから${items.size}人がNPBの球団へ。詳しくは試合タブのリーグ便りで。",
                    LINK_GAMES,
                )
            }
            "promotion" -> {
                val up = items.filter { it.at("to").str() == "A" }.mapNotNull { it.at("teamId").str() }.map { view.teamShort(it) }
                articles += FrontPage.Article("昇格・降格", if (up.isNotEmpty()) "${up.joinToString("・")}が1部へ" else "入れ替えが決まる", "${items.size}球団の所属が入れ替わった。", LINK_GAMES)
            }
            "trade" -> {
                val teams = n.at("teams").list().mapNotNull { it.str() }.map { view.teamShort(it) }
                articles += FrontPage.Article(
                    "トレード",
                    "${teams.joinToString("と")}がトレード成立",
                    items.take(4).joinToString("、") { "${it.at("name").str()}（→${view.teamShort(it.at("team").str().orEmpty())}）" } + "が移籍する。",
                    LINK_GAMES,
                )
            }
            "tryout" -> {
                val ours = items.filter { it.at("team").str() == team }
                articles += FrontPage.Article(
                    "トライアウト",
                    if (ours.isNotEmpty()) "${me}、トライアウトで${ours.size}人獲得" else "トライアウトで${items.size}人が新天地へ",
                    if (ours.isNotEmpty()) ours.take(4).joinToString("・") { it.at("name").str().orEmpty() } + "が加わる。" else "詳しくは試合タブのリーグ便りで。",
                    LINK_GAMES,
                )
            }
        }
    }

    // リーグ短信: 自球団の最新の試合と同じ日のほかの試合
    val shorts = last?.takeIf { !offPhase }?.date?.let { d ->
        view.results.filter { it.date == d && it.home != team && it.away != team && it.homeScore != null && it.awayScore != null }
            .map { shortLine(view, it, latest = view.results.none { r -> (r.date?.dayKey() ?: 0) > d.dayKey() }) }
    }.orEmpty()

    // 指導者（オフは自球団の人事と新体制。シーズン中はときどきベンチの空気）
    articles += staffLocalArticles(view, me, offPhase, pen)

    // 新聞風の2面・3面（地元紙のシーズン中で、自球団の試合があるとき）
    val (front, rest) = splitFront(articles)
    val hero = heroOf(view, detailGame, team, tone, facts)
    val teamPage = if (!offPhase && last != null) buildTeamPage(
        view, raw, team, me, own, tone, sit, detailGame, hero,
        leftover = rest.filter { !(it.kicker == "ひと言" && view.staff?.manager != null) },
        pen = pen,
    ) else null
    val recordPage = if (!offPhase && last != null) buildRecordPage(view, raw, team, sit, detailGame, lineScore, facts, pen) else null
    val nextOpp = view.nextGames.firstOrNull { it.home == team || it.away == team }?.let { view.teamShort(if (it.home == team) it.away else it.home) }
    val index = listOfNotNull(
        nextOpp?.let { "次は${it}戦" },
        teamPage?.interview?.let { "2面 ${it.speaker}" } ?: teamPage?.let { "2面 チームの今" },
        recordPage?.takeIf { it.boxes.isNotEmpty() }?.let { "3面 成績表" } ?: recordPage?.let { "3面 順位" },
    )
    val results = last?.takeIf { !offPhase }?.date?.let { d ->
        view.results.filter { it.date == d && it.home != team && it.away != team && it.homeScore != null && it.awayScore != null }
            .map { ResultRow(view.teamShort(it.away), it.awayScore!!, view.teamShort(it.home), it.homeScore!!) }
    }.orEmpty()

    column?.let { articles += it }
    // アプリの版: 古いときは記事のいちばん上（全幅の1本目）、最新・試作版は紙面の終わり
    app?.let { (article, top) -> if (top) articles.add(0, article) else articles += article }
    val standing = listOfNotNull(
        leagueName.ifEmpty { null },
        mine?.takeIf { it.gamesPlayed > 0 }?.let { "${rankIndex + 1}位 ${it.wins}勝${it.losses}敗${if (it.draws > 0) "${it.draws}分" else ""}" },
    ).joinToString(" ").ifEmpty { null }
    return FrontPage(
        paper = FrontPage.Paper.Local,
        title = localTitle(me),
        badge = "地元紙",
        extra = extra,
        lineScore = lineScore,
        box = box,
        issue = issue,
        team = view.teamLabel(team),
        standing = standing,
        status = view.status?.let { STATUS_LABELS[it] ?: it },
        alerts = alerts,
        headline = headline,
        kicker = kicker,
        subhead = subhead,
        lead = lead,
        tone = tone,
        score = score,
        articles = articles,
        shorts = shorts,
        dateLine = paperDate(date),
        issueNo = turnOfDate(date, view.seasonTurns),
        bigHead = bigHeadOf(tone, sit),
        bigSub = sit?.let { bigSubOf(headline, me) },
        leadHead = leadHeadOf(tone, sit, mine?.takeIf { it.gamesPlayed > 0 }?.let { "${leagueName}${rankIndex + 1}位" }),
        caption = photoCaption(tone, sit, lineScore),
        hero = hero,
        index = index,
        results = results,
        // ⚠ 2面が無い日（手続きの時期など）は記事を全部1面に（null）
        frontArticles = if (teamPage == null) null
        else (if (app?.second == true) listOf(app.first) else emptyList()) + front + (if (app != null && !app.second) listOf(app.first) else emptyList()),
        column = column,
        teamPage = teamPage,
        recordPage = recordPage,
        scene = if (offPhase) null else sceneOf(tone, facts, hero),
        shots = if (offPhase) emptyList() else shotsOf(tone, sit, facts, hero),
    )
}

private val LEADER_UNITS = mapOf("homeruns" to "本", "rbis" to "打点", "stolenBases" to "個", "wins" to "勝", "strikeouts" to "個", "saves" to "セーブ")

/** 「このままなら年間○本のペース。」（数える項目だけ。サーバーが `pace` を付ける） */
internal fun paceLine(board: JsonObject, row: JsonObject): String {
    val pace = row.at("pace").int() ?: return ""
    val v = row.at("value").num()?.toInt() ?: return ""
    if (pace <= v) return ""
    return "このままなら年間${pace}${LEADER_UNITS[board.at("id").str()] ?: ""}のペース。"
}

/** タイトルの値を文の中で読める形に（.531 / 2.15 / 12本 / 8個） */
private fun leaderValue(board: JsonObject, row: JsonObject): String {
    val v = row.at("value").num() ?: return "-"
    return when (board.at("digits").int() ?: 0) {
        3 -> rate3(v)
        2 -> two(v)
        1 -> one(v)
        else -> v.toInt().toString() + (LEADER_UNITS[board.at("id").str()] ?: "")
    }
}

/**
 * 紙面のために自球団の試合を読むときの1ページの数（`games` の窓口の `size`）。
 * ⚠ 以前は画面の既定の6試合ずつ最大8回、順に読んでおり、紙面が出るまで待たされた。
 *    サーバーは1回で200試合まで返せる（自球団の1シーズンが入る）ので、たいてい1回で済む。
 *    `size` を知らない古いサーバーは6試合ずつ返すので、そのときは従来どおりページを重ねる
 */
const val OWN_HISTORY_PAGE = 200

/**
 * 自球団の今季の試合を、新しい順に1ページずつ読み、連勝・連敗が数えられる所まで集める（紙面用）。
 * 今日と同じ結果が途切れ、その前の逆の結果も途切れたら止める（連敗ストップ・連勝ストップまで分かる）。
 * 読みすぎないよう [maxPages] で打ち切る。
 * @param readPage 「試合」の窓口（scope=own）の1ページを読む
 * @return 古い順の試合と、今季の試合を全部読めたか
 */
suspend fun loadOwnHistory(team: String, maxPages: Int = 8, readPage: suspend (Int) -> JsonObject): Pair<List<GameResult>, Boolean> {
    val games = mutableListOf<GameResult>() // 新しい順
    var count = Int.MAX_VALUE
    fun outcome(r: GameResult): Int = r.outcomeFor(team)
    for (page in 0 until maxPages) {
        val data = readPage(page)
        count = data.at("count").int() ?: count
        val rows = data["games"].list().mapNotNull { e ->
            runCatching { OnlineJson.decodeFromJsonElement(GameResult.serializer(), e) }.getOrNull()
        }.filter { it.homeScore != null && it.awayScore != null }
        if (rows.isEmpty()) break
        games += rows
        if (games.size >= count) break
        // 結果の変わり目が2つ見えたら、連続の数は決まっている
        val changes = games.zipWithNext().count { (a, b) -> outcome(a) != outcome(b) }
        // ⚠ 2面の「直近10試合」のため、10試合は読む
        if (changes >= 2 && games.size >= 10) break
    }
    return games.asReversed().toList() to (games.size >= count)
}
