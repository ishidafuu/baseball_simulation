package jp.icenorth.baseball.shared

import kotlinx.serialization.json.JsonObject

/** 紙面の文の中の選手名が指す選手（球団と id。id が無ければ名前で探す） */
data class NameRef(val team: String, val id: Long?)

/**
 * 紙面の記事に出てくる選手名から、どの選手かを引く表を作る。
 * 手元にある選手だけを使う（自球団の名簿・最新の試合の両球団・次の相手の名簿・タイトル争いと能力ランキングの行）。
 * ⚠ 同じ名前の選手が別にいる名前は入れない（押して別人が開くより、押せないほうがよい）。1字の名前も入れない
 */
fun paperNameIndex(raw: JsonObject?, ownTeam: String?, lastGame: JsonObject?, opponent: Pair<String, List<Player>>?): Map<String, NameRef> {
    val seen = mutableMapOf<String, MutableSet<NameRef>>()
    fun add(name: String?, team: String?, id: Long?) {
        if (name == null || name.length < 2 || team.isNullOrEmpty()) return
        val refs = seen.getOrPut(name) { mutableSetOf() }
        // id が分かっている行と分からない行が同じ人を指すことがあるので、id の無い行は同じ球団に別の行があれば足さない
        if (id == null && refs.any { it.team == team }) return
        refs.removeAll { it.team == team && it.id == null }
        refs += NameRef(team, id)
    }
    if (ownTeam != null) raw?.at("roster").list().mapNotNull { it.obj() }.forEach { add(it.at("name").str(), ownTeam, it.at("id").long()) }
    lastGame?.at("teams").obj()?.forEach { (team, rows) ->
        rows.list().mapNotNull { it.obj() }.forEach { add(it.at("name").str(), team, it.at("id").long()) }
    }
    opponent?.let { (team, players) -> players.forEach { add(it.name, team, it.id) } }
    listOf("leaders", "abilityLeaders").forEach { key ->
        raw?.at(key).list().mapNotNull { it.obj() }.forEach { board ->
            board.at("rows").list().mapNotNull { it.obj() }.forEach { add(it.at("name").str(), it.at("team").str(), it.at("id").long()) }
        }
    }
    return seen.filterValues { it.size == 1 }.mapValues { it.value.first() }
}

/** 文の中で表の名前が出てくる所（始まり・終わり・名前）。長い名前を先に取り、重ならない */
fun nameSpans(text: String, index: Map<String, NameRef>): List<Triple<Int, Int, String>> {
    if (index.isEmpty() || text.isEmpty()) return emptyList()
    val taken = BooleanArray(text.length)
    val found = mutableListOf<Triple<Int, Int, String>>()
    index.keys.sortedByDescending { it.length }.forEach { name ->
        var from = 0
        while (true) {
            val at = text.indexOf(name, from)
            if (at < 0) break
            val end = at + name.length
            if ((at until end).none { taken[it] }) {
                (at until end).forEach { taken[it] = true }
                found += Triple(at, end, name)
            }
            from = end
        }
    }
    return found.sortedBy { it.first }
}
