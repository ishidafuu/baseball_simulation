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
        assertEquals(if (p.tone == FrontPage.Tone.Lose) SCENE_DOWN else p.scene, p.scene)
        assertNotNull(p.scene)
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
        val p = local().sealedForQuick()
        assertTrue(p.sealed)
        assertNull(p.teamPage)
        assertNull(p.recordPage)
        assertNull(p.bigHead)
        assertNull(p.hero)
        assertTrue(p.results.isEmpty())
        assertNull(p.scene)
        assertTrue(p.shots.isEmpty())
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
}
