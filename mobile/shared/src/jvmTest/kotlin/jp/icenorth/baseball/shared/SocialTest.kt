package jp.icenorth.baseball.shared

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals

/** 得点経過・時刻・最終ログイン・留守中のまとめの文が Web 版と同じか（期待値は mobile/tools/expect-social.mjs が書き出す） */
class SocialTest {
    private val expected = OnlineJson.parseToJsonElement(
        SocialTest::class.java.getResource("/social-expected.json")!!.readText(),
    ).jsonObject

    @Test
    fun scoringLinesMatchWeb() {
        val cases = expected.at("scoring").list()
        assertEquals(12, cases.size)
        for (c in cases) {
            val play = OnlineJson.decodeFromJsonElement(ScoringPlay.serializer(), c.at("play")!!)
            assertEquals(c.at("line").str(), scoringLine(play, awayShort = "宮崎", homeShort = "那覇"))
            assertEquals(c.at("plain").str(), scoringLine(play))
        }
    }

    @Test
    fun clockMatchesWeb() {
        for (c in expected.at("clock").list()) {
            val at = c.at("at").long()!!
            assertEquals(c.at("day").str(), tokyoDay(at), "tokyoDay($at)")
            assertEquals(c.at("since").str(), sinceLabel(at), "sinceLabel($at)")
        }
        for (c in expected.at("lastSeen").list()) {
            val day = c.at("day").str()
            assertEquals(c.at("label").str(), lastSeenLabel(day, c.at("now").long()!!), "lastSeenLabel($day)")
        }
    }

    @Test
    fun awaySummaryMatchesWeb() {
        for ((key, c) in expected.at("summaries").obj()!!) {
            val before = c.at("before") as JsonObject
            val after = c.at("after") as JsonObject
            val want = c.at("lines").list().map { it.str() }.ifEmpty { null }
            assertEquals(want, awaySummary(before, after), key)
            // 端末に残す要点（まるごとのビューの代わり）と比べても同じ答え
            assertEquals(want, awaySummary(awayDigest(before), after), "$key（要点）")
            val rank = c.at("rank").list().map { it.int() }
            assertEquals(rank, listOf(divisionRank(before), divisionRank(after)), "$key の順位")
        }
    }
}
