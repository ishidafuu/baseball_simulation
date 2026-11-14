package jp.icenorth.baseball.shared

import kotlin.math.max

// ============================================================
// トレードを「補強したいところ」から考えるための計算（いしだ 2026-11-13）。
//
// 【意図】トレードは「自球団のどこを強くしたいか」から始まる。以前のアプリは相手球団を先に
//   選ぶ形で、欲しい選手を探すには11球団を1つずつ開くしかなかった。ここでは
//   - 補強ポイント … 守備位置・投手の持ち場ごとに、自球団の一番手がリーグで何番目か
//   - 候補 … ある位置を他球団の誰が守れるか（能力から出した「その位置での力」の順）
//   - 釣り合い … CPU球団が受けそうか（サーバーと同じ値段・上乗せ・見る目の幅で）
//   を出す。
//
// ⚠ 「その位置での力」は試合の強さではない（試合はサーバーの演算で決まる）。ただしサーバーの
//    CPU球団の値段（server/tradeJudge.mjs）は Web 版 tradeSearch.js の同じ式を使うので、変えるときは
//    Web 版・ここ・サーバーの判断（online-trade-check）をそろえる。
//    能力の重みは打つ力（ミ パ 眼 走）と守る力（守 肩 × 適性）を位置ごとに混ぜるだけ。
// ⚠ 釣り合いの境目は**サーバーが渡す数字**（`trade.margin`・`trade.eyeLimit`）で引く。
//    ここに写しを持つと、CPUの判断を変えたときに「受けるはず」と出て断られる。
// ============================================================

/** トレードで探す持ち場。野手は守備位置、投手は先発・中継ぎ・抑え */
data class TradeSlot(val key: String, val label: String, val short: String, val pitcher: Boolean)

val TRADE_SLOTS: List<TradeSlot> = listOf(
    TradeSlot("catcher", "捕手", "捕", false),
    TradeSlot("first", "一塁", "一", false),
    TradeSlot("second", "二塁", "二", false),
    TradeSlot("third", "三塁", "三", false),
    TradeSlot("short", "遊撃", "遊", false),
    TradeSlot("left", "左翼", "左", false),
    TradeSlot("center", "中堅", "中", false),
    TradeSlot("right", "右翼", "右", false),
    TradeSlot("sp", "先発", "先発", true),
    TradeSlot("rp", "中継ぎ", "中継ぎ", true),
    TradeSlot("cl", "抑え", "抑え", true),
)

fun tradeSlot(key: String?): TradeSlot? = TRADE_SLOTS.firstOrNull { it.key == key }

/** 守れるとみなす適性（スタメンの交代の線と同じ） */
const val TRADE_MIN_FITNESS = SUBSTITUTE_MIN_FITNESS

/** 先発ローテの人数（比べるときに数える人数） */
private const val ROTATION_SIZE = 5

/** 中継ぎを比べるときに数える人数 */
private const val BULLPEN_SIZE = 4

/** 守る力を重く見る位置ほど大きい（捕手・遊撃・二塁・中堅） */
private val DEFENSE_WEIGHT = mapOf(
    "catcher" to 0.5, "short" to 0.45, "second" to 0.4, "center" to 0.4,
    "third" to 0.3, "right" to 0.3, "left" to 0.2, "first" to 0.15,
)

private fun Int?.v(): Double = (this ?: 0).toDouble()

/** 打つ力（ミ パ 眼 走） */
fun battingPower(p: Player): Double =
    p.batting?.meet.v() * 0.35 + p.batting?.power.v() * 0.3 + p.batting?.eye.v() * 0.15 + p.physical?.speed.v() * 0.2

/**
 * その持ち場での力（目安）。守れない（適性が線より下・投手の持ち場に野手）なら null。
 * ⚠ 野手の持ち場に投手は入れない（二刀流は編成で別に扱う）。
 */
fun slotStrength(p: Player, slot: String): Double? {
    val s = tradeSlot(slot) ?: return null
    if (s.pitcher) {
        if (!p.isPitcher) return null
        val vel = normalizedVelocity(p.pitching?.velocity?.toDouble())
        val ctl = p.pitching?.control.v()
        val spin = p.pitching?.spinRate.v()
        val sta = normalizedStamina(p.pitching?.stamina?.toDouble())
        return if (slot == "sp") vel * 0.3 + ctl * 0.3 + spin * 0.15 + sta * 0.25
        else vel * 0.4 + ctl * 0.35 + spin * 0.2 + sta * 0.05
    }
    if (p.isPitcher) return null
    val fit = p.fitness(slot)
    if (fit < TRADE_MIN_FITNESS) return null
    val w = DEFENSE_WEIGHT[slot] ?: 0.3
    val defense = (p.fielding?.defense.v() * 0.7 + p.physical?.arm.v() * 0.3) * fit / 100.0
    return battingPower(p) * (1 - w) + defense * w
}

/** 自球団の起用（打順の守備位置・先発ローテ・抑え）。編成の保存の形から作る */
data class TeamUsage(
    /** 守備位置 → 選手 id（打順に入っている人） */
    val fielders: Map<String, Long> = emptyMap(),
    /** 先発ローテの順 */
    val starters: List<Long> = emptyList(),
    /** 抑え（役割が closer の人） */
    val closer: Long? = null,
) {
    val lineupIds: Set<Long> get() = fielders.values.toSet() + starters + listOfNotNull(closer)

    companion object {
        fun from(lineup: kotlinx.serialization.json.JsonObject?): TeamUsage {
            if (lineup == null) return TeamUsage()
            val order = lineup["battingOrder"].list().mapNotNull { it.obj() }
            val fielders = order.mapNotNull { slot ->
                val id = slot["playerId"].long() ?: return@mapNotNull null
                // ⚠ 投手の打順の枠（DH無し）は守備位置に数えない（PC版 teamUsage と同じ）
                val pos = slot["position"].str()?.takeIf { it != "pitcher" } ?: return@mapNotNull null
                pos to id
            }.toMap()
            val starters = lineup["starters"].list().mapNotNull { it.long() }
            val closer = lineup["pitcherRoles"].obj().orEmpty().entries.firstOrNull { it.value.str() == "closer" }?.key?.toLongOrNull()
            return TeamUsage(fielders, starters, closer)
        }
    }
}

/** 1つの持ち場の、球団としての力（その持ち場の一番手、投手は人数ぶんの平均）と一番手 */
data class SlotScore(val score: Double, val holder: Player?)

/** 名簿の野手を、力の高い組み合わせから順に1人1か所・1か所1人で守備位置に当てる（空いた位置は力0） */
private fun fielderAssignment(roster: List<Player>): MutableMap<String, SlotScore> {
    val out = mutableMapOf<String, SlotScore>()
    val fielderSlots = TRADE_SLOTS.filter { !it.pitcher }.map { it.key }
    val pairs = roster.filter { it.isActive && !it.isPitcher }.flatMap { p -> fielderSlots.mapNotNull { s -> slotStrength(p, s)?.let { Triple(p, s, it) } } }
        .sortedByDescending { it.third }
    val used = mutableSetOf<Long>()
    for ((p, s, v) in pairs) {
        if (s in out || p.id in used) continue
        out[s] = SlotScore(v, p)
        used += p.id
    }
    fielderSlots.forEach { if (it !in out) out[it] = SlotScore(0.0, null) }
    return out
}

/** 名簿の投手を、先発の力の上位 [ROTATION_SIZE] 人（ローテ）と、残りを救援の力の高い順（ブルペン）に分ける */
private fun pitchingStaff(roster: List<Player>): Pair<List<Player>, List<Player>> {
    val pitchers = roster.filter { it.isActive && it.isPitcher }
    val rotation = pitchers.sortedByDescending { slotStrength(it, "sp") ?: 0.0 }.take(ROTATION_SIZE)
    val pen = (pitchers - rotation.toSet()).sortedByDescending { slotStrength(it, "rp") ?: 0.0 }
    return rotation to pen
}

/**
 * 名簿だけから見た持ち場の力（他球団用。起用が分からないので、各位置に一番手を当てる）。
 * 野手は [fielderAssignment]。先発はローテの平均（一番手はいちばん弱い人）、抑えはブルペンの先頭、
 * 中継ぎはその次の [BULLPEN_SIZE] 人の平均。
 */
fun rosterSlotScores(roster: List<Player>): Map<String, SlotScore> {
    val out = fielderAssignment(roster)
    val (rotation, pen) = pitchingStaff(roster)
    out["sp"] = SlotScore(rotation.map { slotStrength(it, "sp") ?: 0.0 }.averageOr0(), rotation.lastOrNull())
    out["cl"] = SlotScore(pen.firstOrNull()?.let { slotStrength(it, "cl") } ?: 0.0, pen.firstOrNull())
    val middle = pen.drop(1).take(BULLPEN_SIZE)
    out["rp"] = SlotScore(middle.map { slotStrength(it, "rp") ?: 0.0 }.averageOr0(), middle.lastOrNull())
    return out
}

private fun List<Double>.averageOr0() = if (isEmpty()) 0.0 else average()

/**
 * 自球団の持ち場の力（**いまの起用**で見る）。打順に入っていない位置・ローテが空なら名簿から補う。
 * 先発の一番手は「ローテでいちばん弱い人」（穴になっている人）を出す。
 */
fun ownSlotScores(roster: List<Player>, usage: TeamUsage): Map<String, SlotScore> {
    val byId = roster.associateBy { it.id }
    val fallback = rosterSlotScores(roster)
    val out = fallback.toMutableMap()
    usage.fielders.forEach { (pos, id) ->
        val p = byId[id] ?: return@forEach
        if (tradeSlot(pos)?.pitcher == false) out[pos] = SlotScore(slotStrength(p, pos) ?: 0.0, p)
    }
    val rotation = usage.starters.mapNotNull { byId[it] }.filter { it.isPitcher }
    if (rotation.isNotEmpty()) {
        val weakest = rotation.minByOrNull { slotStrength(it, "sp") ?: 0.0 }
        out["sp"] = SlotScore(rotation.map { slotStrength(it, "sp") ?: 0.0 }.averageOr0(), weakest)
        val pen = roster.filter { it.isActive && it.isPitcher && it.id !in usage.starters }
        val closer = usage.closer?.let { byId[it] }?.takeIf { it.isPitcher } ?: pen.maxByOrNull { slotStrength(it, "rp") ?: 0.0 }
        out["cl"] = SlotScore(closer?.let { slotStrength(it, "cl") } ?: 0.0, closer)
        val middle = (pen - listOfNotNull(closer).toSet()).sortedByDescending { slotStrength(it, "rp") ?: 0.0 }.take(BULLPEN_SIZE)
        out["rp"] = SlotScore(middle.map { slotStrength(it, "rp") ?: 0.0 }.averageOr0(), middle.lastOrNull())
    }
    return out
}

/** 補強ポイントの1行 */
data class SlotReport(
    val slot: TradeSlot,
    val holder: Player?,
    val score: Double,
    /** リーグで何番目か（1が最強） */
    val rank: Int,
    /** 比べた球団の数（自球団を含む） */
    val teams: Int,
    /** その位置を守れる控え（打順の外の野手）がいない */
    val noBackup: Boolean,
)

/**
 * 補強ポイント。持ち場ごとに自球団の順位を出し、弱い順に並べる。
 * @param others 他球団の名簿（読めた球団だけでよい。順位は読めた球団の中での順位）
 */
fun reinforcePoints(mine: List<Player>, usage: TeamUsage, others: Map<String, List<Player>>): List<SlotReport> {
    val own = ownSlotScores(mine, usage)
    val theirs = others.values.map { rosterSlotScores(it) }
    val bench = mine.filter { it.isActive && !it.isPitcher && it.id !in usage.fielders.values }
    return TRADE_SLOTS.map { slot ->
        val mineScore = own[slot.key] ?: SlotScore(0.0, null)
        val rank = 1 + theirs.count { (it[slot.key]?.score ?: 0.0) > mineScore.score }
        val noBackup = !slot.pitcher && bench.none { it.fitness(slot.key) >= TRADE_MIN_FITNESS }
        SlotReport(slot, mineScore.holder, mineScore.score, rank, theirs.size + 1, noBackup)
    }.sortedWith(compareByDescending<SlotReport> { it.rank }.thenBy { it.score })
}

/** 候補の絞り込み（型で探す） */
data class TradeFilter(val key: String, val label: String, val pitcher: Boolean?, val test: (Player) -> Boolean)

val TRADE_FILTERS: List<TradeFilter> = listOf(
    TradeFilter("young", "23歳以下", null) { (it.age ?: 99) <= 23 },
    TradeFilter("meet", "好打（ミ70+）", false) { (it.batting?.meet ?: 0) >= 70 },
    TradeFilter("power", "長打（パ70+）", false) { (it.batting?.power ?: 0) >= 70 },
    TradeFilter("speed", "俊足（走70+）", false) { (it.physical?.speed ?: 0) >= 70 },
    TradeFilter("arm", "強肩（肩70+）", false) { (it.physical?.arm ?: 0) >= 70 },
    TradeFilter("lefty", "左投げ", true) { it.physical?.throws == "left" },
    TradeFilter("velocity", "速球（150+）", true) { (it.pitching?.velocity ?: 0) >= 150 },
    TradeFilter("control", "制球（制70+）", true) { (it.pitching?.control ?: 0) >= 70 },
)

/** 候補の1人 */
data class TradeCandidate(
    val team: String,
    val player: Player,
    /** その持ち場での力 */
    val strength: Double,
    /** 自球団の一番手との差（＋なら上） */
    val diff: Double,
    /** 相手の球団でその持ち場の一番手か（抜けると相手に穴が空く） */
    val theirStarter: Boolean,
)

/** 持ち場を他球団の誰が担えるか（その持ち場での力の高い順） */
fun tradeCandidates(slot: String, mine: List<Player>, usage: TeamUsage, others: Map<String, List<Player>>, filter: TradeFilter? = null): List<TradeCandidate> {
    val base = ownSlotScores(mine, usage)[slot]?.score ?: 0.0
    return others.flatMap { (team, roster) ->
        // 相手のその持ち場の一番手（先発ならエース。抜けると相手に穴が空く）
        val holders = rosterTops(roster)
        roster.filter { it.isActive }.mapNotNull { p ->
            if (filter != null && ((filter.pitcher != null && filter.pitcher != p.isPitcher) || !filter.test(p))) return@mapNotNull null
            val v = slotStrength(p, slot) ?: return@mapNotNull null
            TradeCandidate(team, p, v, v - base, holders[slot]?.holder?.id == p.id)
        }
    }.sortedByDescending { it.strength }
}

/** いちばん力を出せる持ち場（余りを出すときの「この人はどこで使えるか」） */
fun bestSlot(p: Player): Pair<TradeSlot, Double>? =
    TRADE_SLOTS.mapNotNull { s -> slotStrength(p, s.key)?.let { s to it } }.maxByOrNull { it.second }

/** 余りの1人と、その人が一番手になれる相手球団 */
data class SurplusEntry(val player: Player, val slot: TradeSlot, val strength: Double, val wantedBy: List<String>)

/** 余りを出すとき、起用の中心とみなす中継ぎの人数（ローテ・抑えの外で力の高い順） */
const val SURPLUS_KEEP_RELIEVERS = BULLPEN_SIZE

/**
 * 名簿の中で、持ち場ごとの**一番手1人**とその力（他球団用）。
 * 野手は [rosterSlotScores] の割り当て、先発はローテでいちばん良い人、抑えは救援の一番手、中継ぎはその次。
 * ⚠ [rosterSlotScores] の先発・中継ぎは**人数ぶんの平均**と、いちばん弱い人なので、余りと比べると甘くなり
 *    （平均を上回るだけで「一番手になれる」と出ていた）、「相手の一番手」の印もローテの5番手に付いた。
 */
fun rosterTops(roster: List<Player>): Map<String, SlotScore> {
    val out = fielderAssignment(roster)
    val (rotation, pen) = pitchingStaff(roster)
    fun top(p: Player?, slot: String) = SlotScore(p?.let { slotStrength(it, slot) } ?: 0.0, p)
    out["sp"] = top(rotation.firstOrNull(), "sp")
    out["cl"] = top(pen.getOrNull(0), "cl")
    out["rp"] = top(pen.getOrNull(1), "rp")
    return out
}

/** 持ち場ごとの一番手1人の力（[rosterTops] の力だけ） */
fun rosterTopStrengths(roster: List<Player>): Map<String, Double> = rosterTops(roster).mapValues { it.value.score }

/**
 * 余りを出す。起用の中心（打順・ローテ・抑え・力の上位 [SURPLUS_KEEP_RELIEVERS] 人の中継ぎ）の外にいる選手のうち、
 * 他球団ならその持ち場の**一番手**を上回る人と、その球団。⚠ 相手に穴があるところへ出すと、相手にも得がある（win-win の手がかり）。
 * ⚠ 以前は中継ぎを全員「起用していない」と数え、相手の中継ぎの平均と比べていたので、防御率4点台の中継ぎに
 *    9球団が手を挙げた（いしだ 2026-11-13）。
 */
fun surplusPlayers(mine: List<Player>, usage: TeamUsage, others: Map<String, List<Player>>): List<SurplusEntry> {
    val theirs = others.mapValues { (_, r) -> rosterTopStrengths(r) }
    val keptRelievers = mine.filter { it.isActive && it.isPitcher && it.id !in usage.lineupIds }
        .sortedByDescending { slotStrength(it, "rp") ?: 0.0 }
        .take(SURPLUS_KEEP_RELIEVERS)
        .map { it.id }.toSet()
    return mine.filter { it.isActive && it.id !in usage.lineupIds && it.id !in keptRelievers }.mapNotNull { p ->
        val (slot, v) = bestSlot(p) ?: return@mapNotNull null
        val wanted = theirs.filter { (_, s) -> v > (s[slot.key] ?: 0.0) }.keys.toList()
        if (wanted.isEmpty()) null else SurplusEntry(p, slot, v, wanted)
    }.sortedByDescending { it.wantedBy.size * 1000 + it.strength }
}

// ------------------------------------------------------------------ 抜けたときの穴（CPUの値段の上乗せ）

/** 出すと穴が空く選手の上乗せ（最大 +20%）。Web 版・サーバーの NEED_LIMIT と同じ */
const val NEED_LIMIT = 0.2
/** 「穴が空く」を満額にする落差。Web 版・サーバーの DROP_SCALE と同じ */
const val DROP_SCALE = 8.0

/**
 * 球団の「持ち場の力の合計」（Web 版 `squadStrength` と同じ式）。野手8か所の一番手＋2人目の捕手、
 * 先発 [ROTATION_SIZE] 人＋中継ぎ [BULLPEN_SIZE] 人。
 */
fun squadStrength(roster: List<Player>): Double {
    val tops = rosterTops(roster)
    var total = TRADE_SLOTS.filter { !it.pitcher }.sumOf { tops[it.key]?.score ?: 0.0 }
    val catchers = roster.filter { it.isActive }.mapNotNull { slotStrength(it, "catcher") }.sortedDescending()
    total += catchers.getOrNull(1) ?: 0.0
    val (rotation, pen) = pitchingStaff(roster)
    total += rotation.sumOf { slotStrength(it, "sp") ?: 0.0 }
    total += pen.take(BULLPEN_SIZE).sumOf { slotStrength(it, "rp") ?: 0.0 }
    return total
}

/**
 * CPU球団が受ける「戦力の開き」の上限（[squadStrength] の点。Web 版 `STRENGTH_GAP_LIMIT` と同じ）。
 * 提案した側の伸びがCPUの伸びをこれより上回る交換は、値段が釣り合っても断る。
 * 画面はサーバーが渡す決まり（[CpuTradeRule.gapLimit]）を使う。
 */
const val STRENGTH_GAP_LIMIT = 3.0

/**
 * 交換で開く戦力の差＝提案した側の [squadStrength] の伸び − 受ける側の伸び（Web 版 `tradeStrengthGap` と同じ）。
 * ⚠ 交換後の名簿の並びはサーバーと同じ（残った選手のあとに来た選手）。
 */
fun tradeStrengthGap(from: List<Player>, to: List<Player>, giveIds: Set<Long>, getIds: Set<Long>): Double {
    val fromAfter = from.filter { it.id !in giveIds } + to.filter { it.id in getIds }
    val toAfter = to.filter { it.id !in getIds } + from.filter { it.id in giveIds }
    return squadStrength(fromAfter) - squadStrength(from) - (squadStrength(toAfter) - squadStrength(to))
}

private fun needOfDrop(drop: Double): Double = 1 + NEED_LIMIT * minOf(1.0, maxOf(0.0, drop) / DROP_SCALE)

/**
 * その球団が [players] を**まとめて**手放すときの1人ずつの倍率（Web 版 `needFactors` と同じ）。
 * まとめて抜けた落差が1人ずつの落差の合計より大きいときは、その差を1人ずつの落差の割合で配る。
 */
fun needFactors(roster: List<Player>, players: List<Player>): Map<Long, Double> {
    val ids = roster.map { it.id }.toSet()
    val leaving = players.filter { it.id in ids }
    val out = players.associate { it.id to 1.0 }.toMutableMap()
    if (leaving.isEmpty()) return out
    val full = squadStrength(roster)
    val drops = leaving.map { p -> maxOf(0.0, full - squadStrength(roster.filter { it.id != p.id })) }
    val leavingIds = leaving.map { it.id }.toSet()
    val together = maxOf(0.0, full - squadStrength(roster.filter { it.id !in leavingIds }))
    val sum = drops.sum()
    leaving.forEachIndexed { i, p ->
        var drop = drops[i]
        if (leaving.size > 1 && together > sum) drop = if (sum > 0) drop * together / sum else together / leaving.size
        out[p.id] = needOfDrop(drop)
    }
    return out
}

/**
 * CPU球団の選手を何人かもらうときの値段（並びは [getting] と同じ。Web 版の見込みメーターと同じ）。
 * 2人以上で、名簿と事情を抜いた値段（[Player.tradeBase]）がそろっていれば、まとめて抜けた穴で引く。
 * それ以外は1人ずつの値段（[Player.tradeValue]）。
 */
fun gettingTradeValues(roster: List<Player>?, getting: List<Player>): List<Double?> {
    if (getting.size < 2 || roster == null || getting.any { it.tradeBase == null }) return getting.map { it.tradeValue }
    val factors = needFactors(roster, getting)
    return getting.map { max(1.0, it.tradeBase!! * (factors[it.id] ?: 1.0)) }
}

// ------------------------------------------------------------------ CPUの判断の目安

/** サーバーが渡すCPU球団の決まり（`trade` の項目）。参加者の球団なら null */
data class CpuTradeRule(val margin: Double, val eyeLimit: Double, val eyeNote: String?, val gapLimit: Double? = null) {
    companion object {
        fun from(team: kotlinx.serialization.json.JsonObject?): CpuTradeRule? {
            val t = team?.get("trade").obj() ?: return null
            val margin = t["margin"].num() ?: return null
            // ⚠ 古いサーバーは gapLimit を渡さない（そのときは戦力の開きを見ない）
            return CpuTradeRule(margin, t["eyeLimit"].num() ?: 0.0, t["eyeNote"].str(), t["gapLimit"].num())
        }
    }
}

enum class TradeOdds(val label: String) {
    Lopsided("戦力差が開きすぎる（断る）"),
    Short("足りない（逆提案か断る）"),
    Depends("相手の監督しだい"),
    Likely("受けるはず"),
}

/**
 * 釣り合い。CPUは「受け取る値段 ≧ 出す値段 × 上乗せ」で受ける（`src/online/trades.js` の
 * `cpuTradeDecision`）。値段には監督の見る目（1±eyeLimit）が1人ずつかかるので、
 * 見る目がいちばん不利でも届くなら「受けるはず」、いちばん有利でも届かないなら「足りない」。
 * ⚠ 値段は1を下回らせない（サーバーと同じ）。
 * @param give 自球団が出す選手の値段（CPUが受け取る）
 * @param get 自球団がもらう選手の値段（CPUが出す）
 */
fun tradeOdds(give: List<Double>, get: List<Double>, rule: CpuTradeRule): TradeOdds {
    val lo = 1 - rule.eyeLimit
    val hi = 1 + rule.eyeLimit
    val gainWorst = give.sumOf { max(1.0, it * lo) }
    val gainBest = give.sumOf { max(1.0, it * hi) }
    val lossWorst = get.sumOf { max(1.0, it * hi) }
    val lossBest = get.sumOf { max(1.0, it * lo) }
    return when {
        gainWorst >= lossWorst * rule.margin -> TradeOdds.Likely
        gainBest < lossBest * rule.margin -> TradeOdds.Short
        else -> TradeOdds.Depends
    }
}

/** 出す側の値段がもらう側の何割か（メーターの位置）。もらう選手がいなければ null */
fun tradeRatio(give: List<Double>, get: List<Double>): Double? {
    val loss = get.sumOf { max(1.0, it) }
    if (get.isEmpty()) return null
    return give.sumOf { max(1.0, it) } / loss
}

/** メーターの境目（出す÷もらう）。これより下は「足りない」、上は「受けるはず」 */
fun tradeOddsBounds(rule: CpuTradeRule): Pair<Double, Double> {
    val lo = 1 - rule.eyeLimit
    val hi = 1 + rule.eyeLimit
    return rule.margin * lo / hi to rule.margin * hi / lo
}

/** 値段の段（高・中・低）。並べた全員の値段の上3分の1・下3分の1で分ける */
fun valueTiers(values: List<Double>): (Double?) -> String? {
    val sorted = values.sorted()
    if (sorted.size < 3) return { null }
    val low = sorted[sorted.size / 3]
    val high = sorted[sorted.size * 2 / 3]
    return { v -> if (v == null) null else if (v >= high) "高" else if (v < low) "低" else "中" }
}
