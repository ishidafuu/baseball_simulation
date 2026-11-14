package jp.icenorth.baseball.shared

import kotlinx.serialization.json.JsonObject
import kotlin.math.max
import kotlin.math.min

/**
 * 初期編成・トライアウトの希望リスト。Web 版 src/online/tryoutPlan.js の写し。
 *
 * ⚠ 提出は `{ count, rankedIds, total }`。`rankedIds` は**交渉する選手を10人まで、欲しい順に**
 *    並べたもの（Web 版の「交渉」の形。以前の「候補全員を並べて目標構成で飛ばす」形はやめた）。
 *    `total` は**獲得する人数**（交渉した人＋足りないぶんを自動で埋める人）。無ければ空き枠いっぱい。
 * ⚠ サーバーは上から見て、まだ空いている選手を取る（希望順のとおり。目標構成で飛ばさない）。
 *    同じ選手を複数の球団が希望したら、前年の順位が上の球団が取る。
 */

val JsonObject.pid: Long get() = at("id").long() ?: 0L

fun rosterGroup(position: String?): String = when (position) {
    "pitcher" -> "pitcher"
    "catcher" -> "catcher"
    "first", "second", "third", "short" -> "infielder"
    else -> "outfielder"
}

val ROSTER_GROUP_LABELS = mapOf("pitcher" to "投手", "catcher" to "捕手", "infielder" to "内野手", "outfielder" to "外野手")

fun rosterCounts(players: List<JsonObject>): MutableMap<String, Int> {
    val counts = mutableMapOf("pitcher" to 0, "catcher" to 0, "infielder" to 0, "outfielder" to 0)
    for (p in players) counts.merge(rosterGroup(p.at("position").str()), 1, Int::plus)
    return counts
}

/** 交渉できる人数の上限（1位〜10位）。Web 版 `TRYOUT_WISH_MAX` */
const val TRYOUT_WISH_MAX = 10

/** 交渉できる人数（空き枠と10人の小さい方） */
fun wishLimit(maxCount: Int): Int = max(0, min(TRYOUT_WISH_MAX, maxCount))

/** 獲得する人数（提出の `total`）。無ければ空き枠いっぱい。Web 版 `signTotal` */
fun signTotal(plan: JsonObject?, maxCount: Int): Int {
    val room = max(0, maxCount)
    val total = plan?.get("total")?.int() ?: return room
    return total.coerceIn(0, room)
}

/** 交渉した選手のうち、取りにいく人数（獲得する人数と交渉した人数の小さい方）。Web 版 `wishedCount` */
fun wishedCount(rankedIds: List<Long>, total: Int): Int = max(0, min(rankedIds.size, total))

/** 競合しなかった場合に実際に取る顔ぶれ（希望順の上から count 人） */
fun plannedPicks(rankedIds: List<Long>, candidates: List<JsonObject>, count: Int, @Suppress("UNUSED_PARAMETER") roster: List<JsonObject> = emptyList()): List<JsonObject> {
    val byId = candidates.associateBy { it.pid }
    return rankedIds.mapNotNull { byId[it] }.take(max(0, count))
}

fun normalizedVelocity(v: Double?): Double = if (v == null || v == 0.0) 0.0 else (v - 115) * 2.5
fun normalizedStamina(v: Double?): Double = if (v == null || v == 0.0) 0.0 else v / 2

/** 並べ替えの目安の総合点（overallScore）。試合の強さではない */
fun overallScore(p: JsonObject): Double = if (p.isPitcherJson()) {
    normalizedVelocity(p.at("pitching", "velocity").num()) * 0.35 +
        (p.at("pitching", "control").num() ?: 0.0) * 0.35 +
        normalizedStamina(p.at("pitching", "stamina").num()) * 0.2 +
        (p.at("pitching", "spinRate").num() ?: 0.0) * 0.1
} else {
    (p.at("batting", "meet").num() ?: 0.0) * 0.35 +
        (p.at("batting", "power").num() ?: 0.0) * 0.3 +
        (p.at("physical", "speed").num() ?: 0.0) * 0.15 +
        (p.at("fielding", "defense").num() ?: 0.0) * 0.2
}

data class SortKey(val key: String, val label: String, val of: (JsonObject) -> Double)

const val WEIGHTED_SORT_KEY = "weighted"

val TRYOUT_SORT_KEYS: List<SortKey> = listOf(
    SortKey("overall", "総合", ::overallScore),
    SortKey("age", "年齢") { it.at("age").num() ?: 0.0 },
    SortKey("meet", "ミート") { it.at("batting", "meet").num() ?: 0.0 },
    SortKey("power", "パワー") { it.at("batting", "power").num() ?: 0.0 },
    SortKey("velocity", "球速") { it.at("pitching", "velocity").num() ?: 0.0 },
    SortKey("control", "制球") { it.at("pitching", "control").num() ?: 0.0 },
    SortKey("defense", "守備") { it.at("fielding", "defense").num() ?: 0.0 },
)

data class WeightField(val key: String, val label: String, val group: String)

val WEIGHT_FIELDS = listOf(
    WeightField("meet", "ミート", "fielder"), WeightField("power", "パワー", "fielder"),
    WeightField("eye", "選球眼", "fielder"), WeightField("speed", "走力", "fielder"),
    WeightField("defense", "守備", "fielder"), WeightField("arm", "肩", "fielder"),
    WeightField("velocity", "球速", "pitcher"), WeightField("control", "制球", "pitcher"),
    WeightField("stamina", "スタミナ", "pitcher"), WeightField("breaking", "変化球", "pitcher"),
    WeightField("youth", "若さ", "common"),
)

val WEIGHT_LEVELS = listOf("軽視" to 0.6, "やや軽視" to 0.8, "普通" to 1.0, "やや重視" to 1.2, "重視" to 1.4, "最重視" to 1.6)
val WEIGHT_MAX = WEIGHT_LEVELS.size - 1

val DEFAULT_WEIGHTS = mapOf(
    "meet" to 4, "power" to 4, "eye" to 1, "speed" to 2, "defense" to 2, "arm" to 1,
    "velocity" to 4, "control" to 4, "stamina" to 2, "breaking" to 2, "youth" to 1,
)

fun sanitizeWeights(weights: Map<String, Int>?): Map<String, Int> =
    WEIGHT_FIELDS.associate { f -> f.key to (weights?.get(f.key)?.coerceIn(0, WEIGHT_MAX) ?: DEFAULT_WEIGHTS.getValue(f.key)) }

private fun clamp100(v: Double?) = max(0.0, min(100.0, v ?: 0.0))

fun abilityValue(p: JsonObject, key: String): Double = when (key) {
    "meet", "power", "eye" -> clamp100(p.at("batting", key).num())
    "speed", "arm" -> clamp100(p.at("physical", key).num())
    "defense" -> clamp100(p.at("fielding", "defense").num())
    "velocity" -> clamp100(normalizedVelocity(p.at("pitching", "velocity").num()))
    "control" -> clamp100(p.at("pitching", "control").num())
    "stamina" -> clamp100(normalizedStamina(p.at("pitching", "stamina").num()))
    "breaking" -> clamp100(
        p.at("pitching", "arsenal").list().filter { it.at("type").str() != "straight" }
            .maxOfOrNull { it.at("level").num() ?: 0.0 } ?: 0.0,
    )
    "youth" -> clamp100((32 - (p.at("age").num() ?: 25.0)) * 100 / 14)
    else -> 0.0
}

/** 重み付きの評価値（0〜100） */
fun weightedScore(p: JsonObject, weights: Map<String, Int>): Double {
    val side = if (p.isPitcherJson()) "pitcher" else "fielder"
    var total = 0.0; var sum = 0.0
    for (f in WEIGHT_FIELDS) {
        if (f.group != side && f.group != "common") continue
        val w = WEIGHT_LEVELS.getOrNull(weights[f.key] ?: 0)?.second ?: WEIGHT_LEVELS[0].second
        total += w * abilityValue(p, f.key); sum += w
    }
    return if (sum > 0) total / sum else 0.0
}

/** 重みからおすすめの希望順（目標構成に空きのある区分を先に）。交渉できる人数（10人）までで切る */
fun weightedRanked(candidates: List<JsonObject>, weights: Map<String, Int>, roster: List<JsonObject>, limit: Int = TRYOUT_WISH_MAX): List<Long> {
    val score = candidates.associate { it.pid to weightedScore(it, weights) }
    val sorted = candidates.sortedWith(compareByDescending<JsonObject> { score[it.pid] }.thenBy { it.pid })
    val counts = rosterCounts(roster)
    val head = mutableListOf<Long>(); val tail = mutableListOf<Long>()
    for (p in sorted) {
        val g = rosterGroup(p.at("position").str())
        if ((counts[g] ?: 0) < (ONLINE_ROSTER_TARGETS[g] ?: 0)) { counts.merge(g, 1, Int::plus); head += p.pid } else tail += p.pid
    }
    return (head + tail).take(max(0, limit))
}

val TRYOUT_GROUPS = listOf(
    "all" to "全部", "pitcher" to "投手", "catcher" to "捕手", "infield" to "内野", "outfield" to "外野",
)

fun inTryoutGroup(p: JsonObject, group: String): Boolean = when (group) {
    "all" -> true
    "pitcher" -> p.at("position").str() == "pitcher"
    "catcher" -> p.at("position").str() == "catcher"
    "infield" -> p.at("position").str() in setOf("first", "second", "third", "short")
    else -> p.at("position").str() in setOf("left", "center", "right")
}

/** 交渉する選手を希望リストの末尾へ加える。満員・重複なら何もしない（Web 版 `addToPlan`） */
fun addToPlan(rankedIds: List<Long>, id: Long, limit: Int = TRYOUT_WISH_MAX): List<Long> =
    if (id in rankedIds || rankedIds.size >= limit) rankedIds else rankedIds + id

/** 交渉をやめる（希望リストから外す） */
fun removeFromPlan(rankedIds: List<Long>, id: Long): List<Long> = rankedIds.filter { it != id }

/** 希望リストの中で隣と入れ替える（↑↓用）。端なら何もしない */
fun shiftInPlan(rankedIds: List<Long>, index: Int, delta: Int): List<Long> {
    val next = index + delta
    if (index !in rankedIds.indices || next !in rankedIds.indices) return rankedIds
    return rankedIds.toMutableList().also { it[index] = rankedIds[next]; it[next] = rankedIds[index] }
}

/** 希望リストの中で、選手 id を to 番目（0始まり）へ動かす */
fun moveInPlan(rankedIds: List<Long>, id: Long, to: Int): List<Long> {
    if (id !in rankedIds) return rankedIds
    val rest = rankedIds.filter { it != id }
    val index = to.coerceIn(0, rest.size)
    return rest.take(index) + id + rest.drop(index)
}

data class PlanSummary(val counts: Map<String, Int>, val picked: List<JsonObject>, val blocking: List<String>, val warnings: List<String>)

/**
 * 名簿＋交渉で取る人で、最低限（投手1・捕手1・野手8）に足りない人数。サーバーはこの分だけ
 * 獲得する人数を超えて補う。Web 版 TryoutPlanner.jsx の `minimumShort`（サーバーの `shortfall` と同じ数え方）
 */
fun minimumShort(roster: List<JsonObject>, picked: List<JsonObject>): Int {
    val list = roster + picked
    val pitcher = if (list.any { it.at("position").str() == "pitcher" }) 0 else 1
    val catcher = list.any { it.at("position").str() == "catcher" }
    val fielders = list.count { it.at("position").str() != "pitcher" }
    return pitcher + max(8 - fielders, if (catcher) 0 else 1)
}

/** 獲得予定の内訳と、成り立たない点（足りない守備位置はサーバーが自動で補う）・物足りない点 */
fun planSummary(rankedIds: List<Long>, candidates: List<JsonObject>, count: Int, roster: List<JsonObject>): PlanSummary {
    val picked = plannedPicks(rankedIds, candidates, count, roster)
    val counts = rosterCounts(picked)
    val combined = roster + picked
    val fielders = combined.count { !it.isPitcherJson() }
    val pitchers = combined.count { it.isPitcherJson() }
    val catchers = combined.count { it.at("position").str() == "catcher" }
    val blocking = buildList {
        if (fielders < 8) add("野手が${fielders}人（8人以上必要）")
        if (pitchers < 1) add("投手が1人もいません")
        if (catchers < 1) add("捕手が1人もいません")
    }
    // 注意も獲得したあとの名簿（いまの名簿＋獲得予定）で数える（Web 版と同じ。見出しの「獲得後の名簿」と揃える）
    val after = rosterCounts(combined)
    val warnings = if (blocking.isNotEmpty()) emptyList() else buildList {
        if ((after["pitcher"] ?: 0) < 5) add("獲得後も投手が5人未満です")
        if ((after["infielder"] ?: 0) < 4) add("獲得後も内野手が4人未満です")
        if ((after["outfielder"] ?: 0) < 3) add("獲得後も外野手が3人未満です")
    }
    return PlanSummary(counts, picked, blocking, warnings)
}

// --- トレード（src/online/trades.js と同じ条件） ---------------------------

/** 名簿として成り立つか（rosterShortfall） */
fun rosterShortfall(players: List<JsonObject>): List<String> = buildList {
    if (players.size > ROSTER_LIMIT) add("${ROSTER_LIMIT}人を超えます（${players.size}人）")
    if (players.none { it.isPitcherJson() }) add("投手が居なくなります")
    if (players.none { it.at("position").str() == "catcher" }) add("捕手が居なくなります")
    val fielders = players.count { !it.isPitcherJson() }
    if (fielders < 8) add("野手が8人を割ります（${fielders}人）")
}

data class TradeAfter(val mine: List<JsonObject>, val theirs: List<JsonObject>)

fun rostersAfterTrade(mine: List<JsonObject>, theirs: List<JsonObject>, give: Set<Long>, get: Set<Long>): TradeAfter {
    val moving = mine.filter { it.pid in give }
    val coming = theirs.filter { it.pid in get }
    return TradeAfter(mine.filter { it.pid !in give } + coming, theirs.filter { it.pid !in get } + moving)
}

fun dealProblems(mine: List<JsonObject>, theirs: List<JsonObject>?, give: Set<Long>, get: Set<Long>): List<String> {
    theirs ?: return emptyList()
    val after = rostersAfterTrade(mine, theirs, give, get)
    return rosterShortfall(after.mine) + rosterShortfall(after.theirs)
}

/** 候補がいまの名簿の同じ区分で何番手にあたるか（Web 版の `teamFitRank` と同じ） */
data class TeamFit(val group: String, val rank: Int, val of: Int)

fun teamFitRank(candidate: JsonObject, roster: List<JsonObject>, weights: Map<String, Int>): TeamFit {
    val group = rosterGroup(candidate.at("position").str())
    val score = weightedScore(candidate, weights)
    val same = roster.filter { rosterGroup(it.at("position").str()) == group }
    return TeamFit(group, 1 + same.count { weightedScore(it, weights) > score }, same.size)
}
