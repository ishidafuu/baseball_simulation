package jp.icenorth.baseball.shared

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 年間表彰の行・プロのその後・年齢構成の読み・はじめての1週間が Web 版と同じ答えか。
 * 期待値は mobile/tools/expect-chronicle.mjs が、年代記のビュー（resources/chronicle/）から書き出す。
 */
class HonorsTest {
    private val expected = OnlineJson.parseToJsonElement(
        HonorsTest::class.java.getResource("/chronicle-expected.json")!!.readText(),
    ).jsonObject

    private fun res(name: String) = HonorsTest::class.java.getResource("/chronicle/$name")!!.readText()
    private val names = listOf("late" to "view-late.json", "offseason" to "view-offseason.json", "pro" to "view-pro.json")
    private val views = names.associate { (key, file) -> key to OnlineJson.decodeFromString<LeagueView>(res(file)) }
    private val raws = names.associate { (key, file) -> key to OnlineJson.decodeFromString<JsonObject>(res(file)) }

    private fun pairs(e: kotlinx.serialization.json.JsonElement?): List<Pair<String, String>> =
        e.list().map { it.list().let { p -> p[0].str().orEmpty() to p[1].str().orEmpty() } }

    private fun strings(e: kotlinx.serialization.json.JsonElement?): List<List<String>> =
        e.list().map { row -> row.list().map { it.str().orEmpty() } }

    @Test
    fun honorRowsMatchWeb() {
        for ((key, v) in views) {
            val h = v.chronicle.honors
            assertEquals(pairs(expected.at("honors", key, "plain")), honorRows(h), "honorRows($key)")
            assertEquals(pairs(expected.at("honors", key, "short")), honorRows(h) { "[$it]" }, "honorRows($key, short)")
        }
        // 2年目のキャンプのビューには前の年の表彰（部ごと）が載っている（材料が空のまま比べていないか）
        val off = views.getValue("offseason").chronicle.honors
        assertNotNull(off, "年度更新のあとのビューに表彰が無い")
        assertTrue(off.leagues.isNotEmpty() && off.titles.isNotEmpty(), "部ごとの表彰かタイトルが無い")
        assertTrue(off.leagues.all { it.bestNine.isNotEmpty() }, "ベストナインが空の部がある")
        // 表彰を足す前のサーバー（項目なし）は何も出さない
        assertEquals(emptyList(), honorRows(null))
    }

    @Test
    fun proCareerMatchesWeb() {
        for ((key, v) in views)
            assertEquals(strings(expected.at("proAfter", key)), v.chronicle.proDrafted.map(::proDraftedAfter), "proDraftedAfter($key)")
        val team = OnlineJson.decodeFromJsonElement(
            ListSerializer(ProDrafted.serializer()),
            raws.getValue("pro").at("teamChronicle", "proDrafted")!!,
        )
        assertEquals(strings(expected.at("teamProAfter")), team.map(::proDraftedAfter), "球団史のその後")
        assertTrue(team.any { it.career.size >= 2 }, "球団史に2年分以上のその後が無い（材料が足りない）")
        // リーグ全体の一覧はいちばん新しい年の一行だけ
        val pro = views.getValue("pro").chronicle
        assertTrue(pro.proDrafted.isNotEmpty() && pro.proDrafted.all { it.career.isEmpty() && it.after != null }, "一覧のその後の形が違う")
        // 今年の便り
        val news = pro.proNews.map { listOf(it.name, it.team, it.npbTeam, it.text, it.highlight.orEmpty()) }
        assertEquals(strings(expected.at("proNews")), news)
        assertTrue(news.isNotEmpty(), "便りが無い（材料が足りない）")
        // 古いサーバー（その後の無い行）は何も出さない
        assertEquals(emptyList(), proDraftedAfter(ProDrafted()))
    }

    @Test
    fun ageOutlookParsesLikeWeb() {
        for ((key, raw) in raws) {
            val e = expected.at("ageOutlook", key)
            val o = ageOutlookOf(raw)
            if (e.obj() == null) { assertNull(o, "ageOutlook($key)"); continue }
            assertNotNull(o, "ageOutlook($key) が読めない")
            assertEquals(e.at("years").int(), o.years)
            assertEquals(e.at("bands").list().map { b -> b.list().let { Triple(it[0].str(), it[1].int(), it[2].int()) } }, o.bands.map { Triple(it.label, it.pitchers, it.fielders) })
            assertEquals(
                e.at("core").list().map { r -> r.list().let { listOf(it[0].str(), it[1].int(), it[2].int(), it[3].str(), it[4].bool()) } },
                o.core.map { listOf(it.name, it.age, it.later, it.kind, it.veteran) },
            )
            assertEquals(e.at("lines").list().map { it.str() }, o.lines)
            assertEquals(e.at("advice").str(), o.advice)
            assertTrue(o.core.isNotEmpty() && o.bands.isNotEmpty(), "ageOutlook($key) が空")
        }
        // 項目が無い・null（途中参加で初期メンバー待ち）は null
        assertNull(ageOutlookOf(OnlineJson.decodeFromString<JsonObject>("""{"ageOutlook":null}""")))
        assertNull(ageOutlookOf(OnlineJson.decodeFromString<JsonObject>("{}")))
        assertNull(ageOutlookOf(null))
    }

    @Test
    fun firstWeekMatchesWeb() {
        val fw = expected.at("firstWeek")
        for (row in fw.at("millis").list()) {
            val (iso, ms) = row.list().let { it[0].str() to it[1].long() }
            assertEquals(ms, isoToMillis(iso), "isoToMillis($iso)")
        }
        val joined = fw.at("joined").str()
        for (row in fw.at("inWeek").list()) {
            val (now, inside) = row.list().let { it[0].long()!! to it[1].bool() }
            assertEquals(inside, inFirstWeek(joined, now), "inFirstWeek($joined, $now)")
        }
        assertEquals(fw.at("noJoined").bool(), inFirstWeek(null, isoToMillis(joined)!!))
        assertNull(isoToMillis("not a time"))
        assertNull(isoToMillis(null))
        // 端末に残す鍵（Web 版の firstWeekKey と同じ形）
        val pro = views.getValue("pro")
        assertEquals(fw.at("key").str(), firstWeekKey(pro.teamName.orEmpty(), pro.joinedAt!!))
    }
}
