package jp.icenorth.baseball.shared

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** 写した計算が Web 版と同じ答えを出すか（期待値は mobile/tools/expect-logic.mjs が書き出す） */
class LogicTest {
    private fun resource(name: String) = OnlineJson.parseToJsonElement(
        LogicTest::class.java.getResource("/$name")!!.readText(),
    ).jsonObject

    private val view = resource("view-running.json")
    private val expected = resource("logic-expected.json")
    private val roster = view.at("roster").list().map { it as JsonObject }

    @Test
    fun campMatchesWeb() {
        for (direction in listOf("sharpen", "balanced", "patch")) for (phase in listOf("physique", "skill")) for (p in roster) {
            val want = expected.at("camp", "$direction:$phase:${p.pid}").list().map { it.str() }
            val t = resolveTraining(p, direction, phase)
            val tone = describeMood(p, direction, phase).tone.name.lowercase()
            assertEquals(want, listOf(clampMenu(t.main, p), clampSub(t.sub, p), tone), "$direction:$phase:${p.at("name").str()}")
        }
        for (p in roster) {
            val w = playerWish(p)
            assertEquals(expected.at("wish", "${p.pid}", "direction").str(), w.direction)
            assertEquals(expected.at("wish", "${p.pid}", "phase").str(), w.phase)
            val r = recommendedPolicy(p)
            assertEquals(expected.at("recommended", "${p.pid}", "direction").str(), r.direction)
            assertEquals(expected.at("recommended", "${p.pid}", "phase").str(), r.phase)
        }
    }

    @Test
    fun tryoutMatchesWeb() {
        val candidates = roster.drop(12)
        val have = roster.take(12)
        val ids = { key: String -> expected.at("tryout", key).list().map { it.long() } }
        val ranked = weightedRanked(candidates, DEFAULT_WEIGHTS, have)
        assertEquals(ids("ranked"), ranked)
        assertEquals(ids("picks"), plannedPicks(ranked, candidates, 6, have).map { it.pid })
        assertEquals(ids("added"), addToPlan(ranked.take(5), ranked.last()))
        assertEquals(ids("removed"), removeFromPlan(ranked, ranked.first()))
        assertEquals(ids("shifted"), shiftInPlan(ranked, 2, -1))
        assertEquals(ids("moved"), moveInPlan(ranked, ranked.last(), 0))
        // 獲得する人数（無ければ空き枠いっぱい・範囲に収める）と、交渉から取りにいく人数
        val totals = listOf(
            signTotal(JsonObject(emptyMap()), 7),
            signTotal(JsonObject(mapOf("total" to JsonPrimitive(3))), 7),
            signTotal(JsonObject(mapOf("total" to JsonPrimitive(20))), 7),
            signTotal(JsonObject(mapOf("total" to JsonPrimitive(-1))), 7),
            wishedCount(ranked, 4),
        )
        assertEquals(expected.at("tryout", "totals").list().map { it.int() }, totals)
        // 最低限に足りない人数（画面の「獲得後の名簿」）。Web 版 tryoutPlan.js の minimumShort
        val pitchersOnly = roster.filter { it.at("position").str() == "pitcher" }.take(3)
        val noCatcher = roster.filter { it.at("position").str() != "pitcher" && it.at("position").str() != "catcher" }.take(9)
        val shorts = listOf(minimumShort(pitchersOnly, emptyList()), minimumShort(noCatcher, emptyList()), minimumShort(roster, emptyList()))
        assertEquals(expected.at("tryout", "shorts").list().map { it.int() }, shorts)
        val summary = planSummary(ranked, candidates, 6, have)
        assertEquals(expected.at("tryout", "warnings").list().map { it.str() }, summary.warnings)
        // 注意は獲得したあとの名簿で数える（投手がそろっている／投手が3人だけ）
        val cases = expected.at("tryout", "warningCases").list().map { c -> c.list().map { it.str() } }
        val full = planSummary(weightedRanked(candidates, DEFAULT_WEIGHTS, have), candidates, candidates.size, have)
        assertEquals(cases[0], full.warnings)
        val own = roster.take(3)
        val pool = roster.drop(11)
        val few = planSummary(weightedRanked(pool, DEFAULT_WEIGHTS, own), pool, pool.size, own)
        assertEquals(cases[1], few.warnings)
    }

    @Test
    fun planKeepsSavedSettings() {
        val typed = OnlineJson.decodeFromString<LeagueView>(view.toString())
        val draft = PlanDraft.from(typed.lineup!!, typed.roster)
        val payload = draft.toPayload()
        // 保存済みの役割・方針はそのまま送り返す
        typed.lineup!!["pitcherRoles"].obj()?.forEach { (id, role) ->
            assertEquals(role.str(), payload.at("pitcherRoles", id).str())
        }
        typed.lineup!!["strategy"].obj()?.forEach { (k, v) -> assertEquals(v.str(), payload.at("strategy", k).str()) }
        STRATEGY_FIELDS.forEach { f -> assertNotNull(payload.at("strategy", f.key).str()) }
        assertEquals(typed.lineup, payload.at("baseLineup"))
        // 編集→元に戻す→やり直す
        var history = EditHistory(draft)
        history = history.push(draft.swapBatters(0, 3))
        history = history.push(history.present.withStrategy("batting", "aggressive"))
        assertTrue(history.canUndo)
        assertEquals(draft.swapBatters(0, 3), history.undo().present)
        assertEquals("aggressive", history.undo().redo().present.strategy["batting"])
        assertTrue(history.undo().undo().present.sameEdit(draft))
        // 自動采配は既定のままなら送らない、変えたら全項目を送る
        if (typed.lineup!!["tactics"] == null) {
            assertEquals(null, payload["tactics"])
            val changed = draft.withTactic("starterLimit", "100").toPayload()
            assertEquals(100, changed.at("tactics", "starterLimit").int())
            assertEquals("auto", changed.at("tactics", "hook").str())
        }
    }
}
