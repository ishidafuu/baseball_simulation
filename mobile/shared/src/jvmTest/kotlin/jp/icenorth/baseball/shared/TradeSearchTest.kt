package jp.icenorth.baseball.shared

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TradeSearchTest {
    private var seq = 0L
    private fun fielder(pos: String, bat: Int, def: Int, fit: Map<String, Int> = emptyMap(), age: Int = 25, value: Double = 150.0) = Player(
        id = ++seq, name = "野手$seq", age = age, position = pos,
        batting = Batting(meet = bat, power = bat, eye = bat), physical = Physical(speed = bat, arm = def), fielding = Fielding(def),
        positionFitness = fit, tradeValue = value,
    )
    private fun pitcher(level: Int, value: Double = 150.0) = Player(
        id = ++seq, name = "投手$seq", age = 25, position = "pitcher",
        pitching = Pitching(velocity = 130 + level / 4, control = level, stamina = level * 2, spinRate = level), tradeValue = value,
    )
    private fun team(bat: Int, extra: List<Player> = emptyList()): List<Player> =
        listOf("catcher", "first", "second", "third", "short", "left", "center", "right").map { fielder(it, bat, bat) } +
            (1..10).map { pitcher(bat) } + extra

    @Test
    fun slotStrengthNeedsFitness() {
        val p = fielder("short", 60, 60, mapOf("second" to 70, "third" to 50))
        assertTrue(slotStrength(p, "short")!! > 0)
        assertTrue(slotStrength(p, "second")!! > 0)
        assertNull(slotStrength(p, "third"), "適性60未満は守れない")
        assertNull(slotStrength(p, "sp"), "野手は投手の持ち場に入らない")
    }

    @Test
    fun weakSlotComesFirst() {
        val mine = team(60).toMutableList()
        // 遊撃だけ弱い
        val weakShort = fielder("short", 30, 30)
        mine.removeAt(4); mine.add(4, weakShort)
        val usage = TeamUsage(fielders = mine.take(8).associate { it.position to it.id }, starters = mine.filter { it.isPitcher }.take(5).map { it.id })
        val others = (1..3).associate { "相手$it" to team(55) }
        val points = reinforcePoints(mine, usage, others)
        assertEquals("short", points.first().slot.key)
        assertEquals(4, points.first().rank)
        assertEquals(weakShort.id, points.first().holder?.id)
        val candidates = tradeCandidates("short", mine, usage, others)
        assertTrue(candidates.first().diff > 0, "相手の遊撃のほうが強い")
        assertTrue(candidates.first().theirStarter)
    }

    @Test
    fun takingTwoRegularsCostsTheCombinedHole() {
        // 外野のレギュラー3人と、左翼・右翼どちらも守れる控え1人（レギュラーとほぼ同じ力）。
        // 1人ずつなら控えが埋めて穴は小さいが、2人まとめて抜けると控え1人では埋まらない
        val bench = fielder("left", 64, 64, mapOf("right" to 100))
        val roster = team(65, listOf(bench))
        val left = roster.first { it.position == "left" }
        val right = roster.first { it.position == "right" }
        val alone = needFactors(roster, listOf(left))[left.id]!!
        assertTrue(alone < 1 + NEED_LIMIT, "前提: 1人なら控えが埋めて上乗せは満額にならない: $alone")
        val together = needFactors(roster, listOf(left, right))
        assertTrue(together[left.id]!! > alone, "まとめて抜けた穴のほうが大きい: ${together[left.id]} / $alone")
        // 1人だけなら前と同じ（1人ずつの穴）
        assertEquals(alone, needFactors(roster, listOf(left))[left.id]!!, 1e-9)
        // 見込みは tradeBase に倍率を掛けた値。1人なら tradeValue をそのまま使う
        val withBase = roster.map { if (it.id == left.id || it.id == right.id) it.copy(tradeBase = 100.0) else it }
        val values = gettingTradeValues(withBase, withBase.filter { it.id == left.id || it.id == right.id })
        assertEquals(100.0 * together[left.id]!!, values[0]!!, 1e-9)
        assertEquals(listOf(left.tradeValue), gettingTradeValues(withBase, listOf(left)))
    }

    @Test
    fun strengthGapCatchesTwoForOne() {
        // 相手の遊撃のスター1人を、自分の控え2人で取る。値段が釣り合っても戦力は自分だけ上がる
        val star = fielder("short", 80, 80)
        val theirs = team(50, listOf(star))
        val benchA = fielder("left", 40, 40)
        val benchB = pitcher(40)
        val mine = team(50, listOf(benchA, benchB))
        val gap = tradeStrengthGap(mine, theirs, setOf(benchA.id, benchB.id), setOf(star.id))
        assertTrue(gap > STRENGTH_GAP_LIMIT, "スターを控え2人で取ると戦力が開く: $gap")
        // 同じ力どうしの交換は開かない
        val a = mine.first { it.position == "left" }
        val b = theirs.first { it.position == "left" }
        assertEquals(0.0, tradeStrengthGap(mine, theirs, setOf(a.id), setOf(b.id)), 1e-9)
    }

    @Test
    fun oddsUseServerBounds() {
        val rule = CpuTradeRule(1.05, 0.1, null)
        val (low, high) = tradeOddsBounds(rule)
        assertEquals(TradeOdds.Likely, tradeOdds(listOf(100.0 * high + 0.1), listOf(100.0), rule))
        assertEquals(TradeOdds.Depends, tradeOdds(listOf(105.0), listOf(100.0), rule))
        assertEquals(TradeOdds.Short, tradeOdds(listOf(100.0 * low - 0.1), listOf(100.0), rule))
        // 見る目がいちばん不利（出す側0.9倍・もらう側1.1倍）でも届く ⇔ 受けるはず
        val give = 100.0 * high
        assertTrue(give * 0.9 >= 100.0 * 1.1 * 1.05 - 1e-9)
    }

    @Test
    fun surplusFindsTeamsWithHoles() {
        val mine = team(60) + fielder("short", 58, 58)
        val usage = TeamUsage(fielders = mine.take(8).associate { it.position to it.id }, starters = mine.filter { it.isPitcher }.take(5).map { it.id })
        val others = mapOf("弱い" to team(40), "強い" to team(80))
        val surplus = surplusPlayers(mine, usage, others)
        val extra = surplus.first { it.player.position == "short" && it.player.id !in usage.lineupIds }
        assertEquals(listOf("弱い"), extra.wantedBy)
    }

    @Test
    fun surplusRelieverMustBeatTheirTopReliever() {
        // 自球団: ローテ5人・抑え1人の外に中継ぎが4人（50）と、もう1人（52）
        val mine = team(60).take(8) + (1..6).map { pitcher(60) } + (1..4).map { pitcher(50) } + pitcher(52)
        val pitchers = mine.filter { it.isPitcher }
        val usage = TeamUsage(fielders = mine.take(8).associate { it.position to it.id }, starters = pitchers.take(5).map { it.id }, closer = pitchers[5].id)
        // 相手: 救援が平均すると弱いが、上位には強い人がいる
        val mixed = team(40).take(8) + (1..5).map { pitcher(60) } + listOf(pitcher(70), pitcher(70)) + (1..3).map { pitcher(30) }
        val surplus = surplusPlayers(mine, usage, mapOf("相手" to mixed))
        assertTrue(surplus.none { it.player.isPitcher }, "相手の一番手の中継ぎ（70）を下回る中継ぎは出さない: $surplus")
        // 相手の救援が全員弱ければ、上位4人の外の中継ぎ（ここでは52より弱い50の1人）が出る
        val weak = team(40).take(8) + (1..10).map { pitcher(30) }
        val wanted = surplusPlayers(mine, usage, mapOf("弱い" to weak)).filter { it.player.isPitcher }
        assertEquals(1, wanted.size, "力の上位4人の中継ぎは起用の中心として残す")
        assertEquals(50, wanted.single().player.pitching?.control)
    }

    @Test
    fun theirStarterMarksTheAce() {
        val ace = pitcher(80)
        val other = team(50).take(8) + listOf(ace) + (1..9).map { pitcher(50) }
        val mine = team(40)
        val usage = TeamUsage(fielders = mine.take(8).associate { it.position to it.id }, starters = mine.filter { it.isPitcher }.take(5).map { it.id })
        val sp = tradeCandidates("sp", mine, usage, mapOf("相手" to other))
        assertEquals(listOf(ace.id), sp.filter { it.theirStarter }.map { it.player.id }, "先発の一番手はエース（ローテの5番手ではない）")
    }

    @Test
    fun pitcherBattingSlotIsNotAFielder() {
        val lineup = kotlinx.serialization.json.buildJsonObject {
            put("battingOrder", kotlinx.serialization.json.buildJsonArray {
                add(kotlinx.serialization.json.buildJsonObject { put("playerId", kotlinx.serialization.json.JsonPrimitive(1)); put("position", kotlinx.serialization.json.JsonPrimitive("short")) })
                add(kotlinx.serialization.json.buildJsonObject { put("playerId", kotlinx.serialization.json.JsonPrimitive(2)); put("position", kotlinx.serialization.json.JsonPrimitive("pitcher")) })
            })
        }
        assertEquals(mapOf("short" to 1L), TeamUsage.from(lineup).fielders)
    }
}
