package jp.icenorth.baseball.shared

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 新聞風の1面の追加（縦見出し・ヒーロー・目次）と2面・3面を、FrontPageTest と同じ実データで確かめる。
 * 作った面は build/front-pages-2-3.txt に書き出す（文面を目で確かめる用）
 */
class FrontPagePaperTest {
    private fun res(name: String) = javaClass.getResource("/front/$name")!!.readText()
    private val view = OnlineJson.decodeFromString<LeagueView>(res("view.json"))
    private val raw = OnlineJson.decodeFromString<JsonObject>(res("view.json"))
    private val game = OnlineJson.decodeFromString<JsonObject>(res("game.json"))
    private val history = runBlocking {
        loadOwnHistory(view.teamName!!) { OnlineJson.decodeFromString<JsonObject>(res("games.json")) }
    }

    private fun local() = buildFrontPage(
        view, raw, game,
        column = FrontPage.Article("コラム", "t", "b", LINK_TIPS),
        history = history.first, historyComplete = history.second,
    )

    private fun dump(p: FrontPage): String = buildString {
        appendLine("1面 ${p.dateLine} 第${p.issueNo}号  縦「${p.bigHead}」袖「${p.bigSub}」小「${p.leadHead}」  ${p.caption}")
        appendLine("目次 ${p.index}")
        p.hero?.let { appendLine("ヒーロー[${it.title}] ${it.name}（${it.position}） ${it.lines} ${it.season}") }
        p.frontArticles?.forEach { appendLine("  1面記事 <${it.kicker}> ${it.title}") }
        p.results.forEach { appendLine("  結果 ${it.away} ${it.awayScore}-${it.homeScore} ${it.home}") }
        p.teamPage?.let { t ->
            appendLine("2面 ${t.section}")
            t.interview?.let { iv -> appendLine("  ${iv.title}\n  ${iv.intro}"); iv.qa.forEach { (q, a) -> appendLine("  $q / $a") } }
            appendLine("  直近 ${t.form}  ${t.now}  ${t.nowNote}")
            t.conditions.forEach { appendLine("  調子 ${it.arrow} ${it.name}（${it.position}） ${it.note}") }
            appendLine("  投手 ${t.pitchers}  次 ${t.rotation}")
            t.articles.forEach { appendLine("  <${it.kicker}> ${it.title}\n    ${it.body}") }
        }
        p.recordPage?.let { r ->
            appendLine("3面 ${r.game}  ${r.reviewHead}\n  ${r.review}")
            r.boxes.forEach { b ->
                appendLine("  [${b.name}] 計${b.totals}")
                b.batters.forEach { appendLine("    ${it.pos} ${if (it.sub) " " else ""}${it.name} ${it.ab} ${it.h} ${it.rbi} ${it.hr}") }
                b.pitchers.forEach { appendLine("    投 ${it.name} ${it.ip} ${it.h} ${it.so} ${it.r} ${it.pitches}") }
            }
            r.notes.forEach { appendLine("  $it") }
            appendLine("  継投 ${r.relays}")
            r.standings.forEach { appendLine("  ${it.rank} ${it.team} ${it.w}-${it.l} ${it.gb} ${it.note}${if (it.mine) " ★" else ""}") }
            appendLine("  ${r.probablesTitle} ${r.probables}")
            r.leaders.forEach { b -> appendLine("  ${b.title} ${b.rows.joinToString { "${it.name}(${it.team})${it.value}" }}") }
            r.shorts.forEach { appendLine("  短信 ${it.title} / ${it.body}") }
        }
    }

    @Test
    fun buildsPages() {
        val p = local()
        File("build/front-pages-2-3.txt").writeText(dump(p))
        assertNotNull(p.bigHead)
        assertNotNull(p.dateLine)
        assertTrue(p.dateLine!!.contains("曜日"))
        val t = assertNotNull(p.teamPage)
        val r = assertNotNull(p.recordPage)
        assertTrue(t.form.isNotEmpty() && t.form.size <= 10)
        assertEquals(2, r.boxes.size)
        // 成績表の計は、打者の打数の合計と同じ
        r.boxes.forEach { b -> assertEquals(b.batters.sumOf { it.ab }, b.totals[0]) }
        // 自球団が先
        assertEquals(view.teamShort(view.teamName!!), r.boxes[0].name)
        assertTrue(r.boxes[0].pitchers.isNotEmpty())
        assertTrue(r.standings.any { it.mine })
        // コラムは1面の記事に入れない（囲みで別に出す）
        assertTrue(p.frontArticles!!.none { it.link == LINK_TIPS })
        assertNotNull(p.column)
        // 写真の影絵（負けた日はうなだれる選手）
        // 試合のデータは負けた日（静岡 7―6 宮崎）
        assertEquals(FrontPage.Tone.Lose, p.tone)
        assertEquals(SCENE_DOWN, p.scene)
        assertTrue(p.shots.isNotEmpty() && p.shots.all { g -> g.all { it.matches(Regex("s(0[1-9]|1[0-9]|2[0-2])")) } })
    }

    @Test
    fun pitchingOrderStartsWithStarter() {
        val r = local().recordPage!!
        val changes = game.at("pitcherChanges").list().mapNotNull { it.obj() }.filter { it.at("team").str() == view.teamName }
        val first = changes.first().at("out").str()!!
        assertEquals(familyName(first), r.boxes[0].pitchers.first().name)
    }

    @Test
    fun sealedClearsResults() {
        val open = local()
        val p = open.sealedForQuick()
        assertTrue(p.sealed)
        assertNull(p.teamPage)
        assertNull(p.recordPage)
        assertNull(p.bigHead)
        assertNull(p.hero)
        assertTrue(p.results.isEmpty())
        assertNull(p.scene)
        assertTrue(p.shots.isEmpty())
        // 伏せた紙面のどの文にも、結果の分かること（得点・相手・主役・見出し）が残っていない。
        // ⚠ 項目を1つずつ並べず、紙面の文を全部集めて調べる（項目を足したときに伏せ忘れても落ちる）
        val score = assertNotNull(open.score)
        val hero = assertNotNull(open.hero)
        val texts = allStrings(p)
        assertTrue(texts.isNotEmpty())
        val scoreLine = Regex("(^|\\D)(${score.awayScore}\\s*[―\\-－–]\\s*${score.homeScore}|${score.homeScore}\\s*[―\\-－–]\\s*${score.awayScore})(\\D|$)")
        val opp = if (score.home == view.teamShort(view.teamName!!)) score.away else score.home
        val leaks = listOf(opp, familyName(hero.name), open.headline) + listOfNotNull(open.bigHead, open.caption, open.subhead)
        texts.forEach { t ->
            assertFalse(scoreLine.containsMatchIn(t), "得点が残っている: $t")
            leaks.forEach { w -> assertFalse(w in t, "「$w」が残っている: $t") }
        }
    }

    /** 紙面の中の文を全部（入れ子の項目・一覧・組も辿る） */
    private fun allStrings(root: Any?): List<String> {
        val out = mutableListOf<String>()
        fun walk(o: Any?) {
            when (o) {
                null, is Number, is Boolean, is Enum<*> -> {}
                is String -> out += o
                is Collection<*> -> o.forEach(::walk)
                is Map<*, *> -> o.forEach { (k, v) -> walk(k); walk(v) }
                is Pair<*, *> -> { walk(o.first); walk(o.second) }
                is Triple<*, *, *> -> { walk(o.first); walk(o.second); walk(o.third) }
                else -> {
                    val c = o.javaClass
                    check(c.name.startsWith("jp.icenorth.baseball.shared.")) { "辿れない型: ${c.name}" }
                    c.declaredFields.filter { !java.lang.reflect.Modifier.isStatic(it.modifiers) }.forEach { f ->
                        f.isAccessible = true
                        walk(f.get(o))
                    }
                }
            }
        }
        walk(root)
        return out
    }

    @Test
    fun interviewIsNotDuplicated() {
        // 監督がいなくても、持ち主の呼び名を監督として一問一答を作る。そのときも1面の「ひと言」を2面に重ねない
        val noCoach = view.copy(staff = null, members = listOf(Member(label = "いしだ", teamName = view.teamName)))
        val p = buildFrontPage(noCoach, raw, game, history = history.first, historyComplete = history.second)
        val t = assertNotNull(p.teamPage)
        val iv = assertNotNull(t.interview)
        assertEquals("いしだ監督", iv.speaker)
        assertTrue(t.articles.none { it.kicker == "ひと言" }, t.articles.joinToString { it.title })
        assertTrue(t.articles.none { it.title == iv.title })
        // 監督がいる日も同じ
        val q = local().teamPage!!
        assertNotNull(q.interview)
        assertTrue(q.articles.none { it.kicker == "ひと言" })
        // 話し手がいない（一問一答を作れない）日は、「ひと言」を2面に残す
        val nobody = view.copy(staff = null, members = emptyList())
        val r = buildFrontPage(nobody, raw, game, history = history.first, historyComplete = history.second).teamPage!!
        assertNull(r.interview)
        assertTrue(r.articles.any { it.kicker == "ひと言" })
    }

    @Test
    fun inningsWording() {
        val p = local()
        // 文の中は「6回2/3」（⅔ は成績表の回の欄だけ）
        val prose = allStrings(p.teamPage) + allStrings(p.hero) + listOfNotNull(p.subhead, p.lead)
        assertTrue(prose.none { '⅓' in it || '⅔' in it }, prose.filter { '⅓' in it || '⅔' in it }.joinToString())
        assertTrue(p.recordPage!!.boxes[0].pitchers.any { '⅔' in it.ip || '⅓' in it.ip })
        // 先発の早川は8アウト（2回2/3）で降板
        assertTrue(p.teamPage!!.interview!!.qa.any { it.first == "――先発の早川は2回2/3で降板。" }, p.teamPage!!.interview!!.qa.toString())
        // 1死も取れずに降りた日
        val zero = buildFrontPage(view, raw, withStarterOuts(game, view.teamName!!, "早川 喜一", 0), history = history.first, historyComplete = history.second)
        assertTrue(zero.teamPage!!.interview!!.qa.any { it.first == "――先発の早川は1死も取れずに降板。" }, zero.teamPage!!.interview!!.qa.toString())
    }

    /** 試合の詳細の投手のアウトの数を書き換える */
    private fun withStarterOuts(g: JsonObject, team: String, name: String, outs: Int): JsonObject {
        fun JsonObject.with(k: String, v: kotlinx.serialization.json.JsonElement) = JsonObject(this + (k to v))
        val teams = g["teams"]!!.obj()!!
        val players = teams[team].list().map { e ->
            val o = e.obj()!!
            if (o.at("name").str() == name) o.with("pitching", o["pitching"]!!.obj()!!.with("inningsPitched", kotlinx.serialization.json.JsonPrimitive(outs))) else o
        }
        return g.with("teams", teams.with(team, kotlinx.serialization.json.JsonArray(players)))
    }

    @Test
    fun inningsProse() {
        assertEquals("7回", inningsText(21, InningsStyle.Prose))
        assertEquals("6回2/3", inningsText(20, InningsStyle.Prose))
        assertEquals("1/3回", inningsText(1, InningsStyle.Prose))
        assertEquals("6回2/3を1失点", inningsText(20, InningsStyle.Prose) + allowed(1))
    }

    @Test
    fun drawDayHeroTalk() {
        val loseWords = listOf("粘り切れず悔しい", "勝ちにつながる投球ができなかった", "「次は必ず」", "勝ちにつながらず悔しい", "打てても負けたら意味がない", "唇をかんだ")
        val pitcher = PaperHero("きょうの主役", "早川 喜一", "投手", listOf("先発" to false), null, "先発で7回を1失点")
        val batter = PaperHero("きょうの主役", "及川 邦敏", "三塁手", listOf("4打数" to false), null, "4打数3安打")
        for (seed in 1..30) for (h in listOf(pitcher, batter)) {
            val a = heroTalk(h, FrontPage.Tone.Draw, Pen(seed))!!
            loseWords.forEach { w -> assertFalse(w in a.title + a.body, "引き分けの日に負けの談話: ${a.body}") }
        }
        assertTrue("先発で7回を1失点" in heroTalk(pitcher, FrontPage.Tone.Draw, Pen(1))!!.body)
    }

    @Test
    fun captionWithoutLineScore() {
        val facts = GameFacts(5, 8, 0, 0, 0, emptyList(), emptyList(), walkOff = true)
        val s = Situation("宮崎", "那覇", false, 3, 4, 1, 0, 4, facts)
        val c = photoCaption(FrontPage.Tone.Lose, s, null)!!
        assertFalse("0回" in c, c)
        assertFalse("裏に点" in c, c)
        assertTrue("サヨナラ負け" in c, c)
        // 回ごとの得点があれば回と点を書く
        val f2 = GameFacts(5, 8, 0, 0, 0, emptyList(), emptyList(), ourInnings = listOf(0, 0, 0, 0, 0, 0, 3, 0, 0), theirInnings = listOf(0, 0, 0, 2, 0, 0, 0, 0, 2), walkOff = true)
        val ls = FrontPage.LineScore("宮崎", "那覇", listOf(0, 0, 0, 0, 0, 0, 3, 0, 0), listOf(0, 0, 0, 2, 0, 0, 0, 0, 2), true)
        assertEquals("▲9回裏に2点を奪われた那覇の球場の得点板", photoCaption(FrontPage.Tone.Lose, s.copyFacts(f2), ls))
    }

    private fun Situation.copyFacts(f: GameFacts) = Situation(me, opp, home, ours, theirs, streak, brokenStreak, rank, f)

    @Test
    fun teamMarkAvoidsClash() {
        val v = LeagueView(
            teamLabels = mapOf("a" to TeamLabel("宮崎アトラス", "宮崎"), "b" to TeamLabel("宮城ベアーズ", "宮城"), "c" to TeamLabel("那覇シーサーズ", "那覇")),
        )
        assertEquals("宮崎", teamMark(v, "a"))
        assertEquals("宮城", teamMark(v, "b"))
        assertEquals("那", teamMark(v, "c"))
    }

    @Test
    fun nationalHasNoTeamPages() {
        val n = buildNationalPage(view, raw, local())
        assertNull(n.teamPage)
        assertNull(n.recordPage)
        assertNull(n.hero)
        assertNull(n.frontArticles)
    }

    @Test
    fun innings() {
        assertEquals("7", inningsText(21, InningsStyle.Box))
        assertEquals("2⅔", inningsText(8, InningsStyle.Box))
        assertEquals("⅓", inningsText(1, InningsStyle.Box))
        assertEquals("0", inningsText(0, InningsStyle.Box))
    }

    @Test
    fun weekdays() {
        assertEquals(1, weekday(2026, 11, 16)) // 月曜
        assertEquals(4, weekday(2024, 1, 4)) // 木曜（1月は前の年の13月として数える）
        assertEquals("6月12日（水曜日）", paperDate(GameDate(2024, 6, 12)))
    }

    @Test
    fun bigHeads() {
        val s = Situation("宮崎", "那覇", false, 14, 9, 2, 0, 4, null)
        assertEquals("猛打", bigHeadOf(FrontPage.Tone.Win, s))
        assertEquals("快勝", bigHeadOf(FrontPage.Tone.Win, Situation("宮崎", "那覇", false, 4, 2, 1, 0, 4, null)))
        assertEquals("黒星", bigHeadOf(FrontPage.Tone.Lose, Situation("宮崎", "那覇", true, 3, 5, 1, 0, 4, null)))
        assertEquals("零封", bigHeadOf(FrontPage.Tone.Win, Situation("宮崎", "那覇", true, 3, 0, 1, 0, 4, null)))
        assertEquals("6点差をひっくり返す", bigSubOf("宮崎、6点差をひっくり返す", "宮崎"))
        assertFalse(bigSubOf("劇的 宮崎がサヨナラ勝ち", "宮崎").isEmpty())
    }
}

class ReviewTest {
    @Test
    fun keepsTheTurningInning() {
        val s = Situation("久留米", "相模原", false, 6, 4, 2, 0, 4, null)
        val ls = FrontPage.LineScore("久留米", "相模原", listOf(1, 0, 0, 0, 3, 1, 1, 0, 0), listOf(3, 0, 0, 0, 0, 1, 0, 0, 0), false)
        val r = reviewOf(s, ls, null, Pen(1))!!
        assertTrue("5回" in r.second, r.second)
    }

    @Test
    fun namesTurnsAndTies() {
        // 宮崎は先攻。1回に先制、2回に逆転され、3回に同点、5回に勝ち越し
        val s = Situation("宮崎", "那覇", false, 4, 3, 1, 0, 4, null)
        val ls = FrontPage.LineScore("宮崎", "那覇", listOf(2, 0, 1, 0, 1, 0, 0, 0, 0), listOf(0, 3, 0, 0, 0, 0, 0, 0, 0), false)
        val body = reviewOf(s, ls, null, Pen(1))!!.second
        assertTrue("1回に宮崎が2点を挙げて先制" in body, body)
        assertTrue("2回に那覇が3点を挙げて逆転" in body, body)
        assertTrue("3回に宮崎が1点を挙げて同点に追いつく" in body, body)
        assertTrue("5回に宮崎が1点を挙げて勝ち越し" in body, body)
    }

    @Test
    fun longGameKeepsTurningPoints() {
        // 6回の得点のうち、加点・反撃を落としても逆転・同点・勝ち越しは残す
        val s = Situation("宮崎", "那覇", false, 6, 4, 1, 0, 4, null)
        val ls = FrontPage.LineScore("宮崎", "那覇", listOf(2, 0, 1, 0, 1, 1, 0, 1, 0), listOf(0, 3, 0, 0, 0, 0, 1, 0, 0), false)
        val body = reviewOf(s, ls, null, Pen(1))!!.second
        assertTrue("逆転" in body && "同点に追いつく" in body && "勝ち越し" in body, body)
        assertFalse("6回に宮崎" in body, body)
        assertFalse("7回に那覇" in body, body)
        assertTrue("8回に宮崎" in body, body)
    }
}

class VerticalColumnsTest {
    private fun cols(text: String, per: Int) = verticalColumns(verticalCells(text), per).map { c -> c.joinToString("") { it.text } }

    @Test
    fun hangsOnlyCommaAndPeriod() {
        // 「、。」だけは前の列にぶら下げる（per＋1 マス）
        assertEquals(listOf("あいう。", "えお"), cols("あいう。えお", 3))
        assertEquals(listOf("あいう、", "えお"), cols("あいう、えお", 3))
    }

    @Test
    fun pushesOtherNoStartCharsForward() {
        // 「」ー っ ）」はぶら下げず、前の字と一緒に次の列へ送る（列は per マスを超えない）
        assertEquals(listOf("あい", "う」え"), cols("あいう」え", 3))
        assertEquals(listOf("あい", "うー"), cols("あいうー", 3))
        assertEquals(listOf("あい", "かっ"), cols("あいかっ", 3))
        assertEquals(listOf("あい", "う）"), cols("あいう）", 3))
    }

    @Test
    fun handlesTwoNoStartCharsInARow() {
        // 「。」をぶら下げた後に「」」が続くときは、ぶら下げをやめて前の字ごと送る
        assertEquals(listOf("あい", "う。」", "え"), cols("あいう。」え", 3))
        // 「」。」も同じ
        assertEquals(listOf("あい", "う」。"), cols("あいう」。", 3))
    }

    @Test
    fun columnsNeverExceedPerPlusOne() {
        val text = "宮崎、逆転負け「あと一歩だった」。ーっ）！？。、」』テストの文章です。".repeat(3)
        for (per in 4..12) {
            val cs = verticalColumns(verticalCells(text), per)
            assertEquals(verticalCells(text), cs.flatten())
            cs.forEach { c ->
                assertTrue(c.size <= per + 1, "$per: ${c.joinToString("") { it.text }}")
                // per＋1 マスになるのは「、。」をぶら下げたときだけ
                if (c.size == per + 1) assertTrue(c.last().text in listOf("、", "。"), c.joinToString("") { it.text })
            }
        }
    }
}
