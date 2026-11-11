package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.mutableStateOf
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.int
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.num
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.rate3
import jp.icenorth.baseball.shared.str
import kotlinx.serialization.json.JsonObject
import jp.icenorth.baseball.shared.LEAGUE_NAMES
import jp.icenorth.baseball.shared.LEAGUE_STANDING_ORDER
import jp.icenorth.baseball.shared.LeagueView
import jp.icenorth.baseball.shared.PROMOTION_PLACES
import jp.icenorth.baseball.shared.PYRAMID_LEAGUES
import jp.icenorth.baseball.shared.RELEGATION_FROM_BOTTOM
import jp.icenorth.baseball.shared.Standing
import jp.icenorth.baseball.shared.teamLabel
import jp.icenorth.baseball.shared.teamShort



// 試合タブの「順位表・タイトル争い・リーグ便り」（以前はホームにあった。ホームは新聞の紙面にした）

/** 順位表の1つの表（2部制なら部ごと）。`promotes` / `relegates` はその部に昇格・降格があるか */
internal data class StandingGroup(val title: String, val rows: List<Standing>, val promotes: Boolean, val relegates: Boolean)

/**
 * 順位表を部ごとに分けて並べる（Web 版 LeaguePanels.jsx の Standings と同じ決まり）。
 * ⚠ 並びは `compareLeagueStanding`（勝率 → 勝ち数 → 球団名）。サーバーの順位表は全球団を通した並びで、
 *    同率の並びが決まっていない
 */
internal fun standingGroups(view: LeagueView): List<StandingGroup> {
    // 並べ方は紙面・PC・昇降格と同じ1つ（勝率→勝利数→球団名。shared の LEAGUE_STANDING_ORDER）
    val order = LEAGUE_STANDING_ORDER
    // teamLeagues が無い古いビューは1つの表（昇格・降格の印は出さない）
    if (view.teamLeagues.isEmpty()) return listOf(StandingGroup("順位", view.standings.sortedWith(order), promotes = false, relegates = false))
    val known = PYRAMID_LEAGUES.map { league ->
        StandingGroup(
            "${league.name} 順位",
            view.standings.filter { view.teamLeagues[it.team] == league.id }.sortedWith(order),
            league.promotes,
            league.relegates,
        )
    }
    // 表に無い部（古い保存など）も落とさない
    val others = view.standings.filter { s -> PYRAMID_LEAGUES.none { it.id == view.teamLeagues[s.team] } }
        .groupBy { view.teamLeagues[it.team].orEmpty() }.toSortedMap()
        .map { (id, rows) -> StandingGroup("${LEAGUE_NAMES[id] ?: id} 順位", rows.sortedWith(order), promotes = false, relegates = false) }
    return (known + others).filter { it.rows.isNotEmpty() }
}

/** 昇格圏・降格圏の印（上から [PROMOTION_PLACES] 位まで・下から [RELEGATION_FROM_BOTTOM] 位まで） */
internal fun StandingGroup.moveMark(index: Int): String? = when {
    promotes && index < PROMOTION_PLACES -> "昇格圏"
    relegates && index >= rows.size - RELEGATION_FROM_BOTTOM -> "降格圏"
    else -> null
}

@Composable
fun StandingsBoard(view: LeagueView, onTeam: ((String) -> Unit)? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { standingGroups(view).forEach { group ->
        Section(group.title) {
            // 見出しの1行（数字が何か分かるように）
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                val head = MaterialTheme.typography.labelSmall
                val ink = MaterialTheme.colorScheme.onSurfaceVariant
                Text("順", style = head, color = ink, modifier = Modifier.width(24.dp))
                Text("球団", style = head, color = ink, modifier = Modifier.weight(1f))
                Text("勝-敗-分", style = head, color = ink, modifier = Modifier.width(80.dp), textAlign = TextAlign.End)
                Text("差", style = head, color = ink, modifier = Modifier.width(44.dp), textAlign = TextAlign.End)
            }
            val top = group.rows.firstOrNull()
            group.rows.forEachIndexed { i, row ->
                val own = row.team == view.teamName
                val gap = top?.let { ((it.wins - it.losses) - (row.wins - row.losses)) / 2.0 } ?: 0.0
                val mark = group.moveMark(i)
                Row(
                    Modifier
                        .fillMaxWidth()
                        // 球団を押すと、その球団の選手成績へ
                        .then(if (onTeam != null) Modifier.clickable { onTeam(row.team) } else Modifier)
                        .background(
                            if (own) MaterialTheme.colorScheme.primary.copy(alpha = 0.18f) else MaterialTheme.colorScheme.surfaceContainer,
                            RoundedCornerShape(6.dp),
                        )
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${i + 1}", modifier = Modifier.width(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                view.teamShort(row.team),
                                fontWeight = if (own) FontWeight.Bold else FontWeight.Normal,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false),
                            )
                            mark?.let { Tag(it, if (it == "昇格圏") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error) }
                        }
                        // ⚠ 人が持っている球団だけ、名前を括弧で添える（CPUに付けると誰かが持っているように見える）。
                        //    呼び名が球団名と同じときはサーバーが空で返す（Web 版と同じく「プレイヤー」）
                        if (view.teamOwners.containsKey(row.team)) {
                            Text(
                                "（${view.teamOwners[row.team].orEmpty().ifEmpty { "プレイヤー" }}）",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    Text("${row.wins}-${row.losses}-${row.draws}", modifier = Modifier.width(80.dp), textAlign = TextAlign.End)
                    Text(if (i == 0 || gap == 0.0) "-" else "%.1f".format(gap), modifier = Modifier.width(44.dp), textAlign = TextAlign.End)
                }
            }
        }
    }
    }
}

/** タイトル争いに並べる人数（サーバーは10人まで返す。Web は5人） */
private const val LEADERS_SHOWN = 10

/**
 * タイトル争い（リーグの上位）。
 * @param onPlayer 行を押したとき。id はサーバーの行の選手 id（古いサーバーには無いので、そのときは名前で探す）
 */
@Composable
fun LeadersBoard(view: LeagueView, boards: List<JsonObject>, onPlayer: ((team: String, id: Long?, name: String) -> Unit)? = null) {
    // ⚠ 選んだ項目は回転でも残す（remember だと、端末を回すと先頭の項目に戻っていた）
    var selected by rememberSaveable { mutableStateOf(boards.first().at("id").str().orEmpty()) }
    val board = boards.firstOrNull { it.at("id").str() == selected } ?: boards.first()
    val digits = board.at("digits").int() ?: 0
    Section("タイトル争い") {
        ChoiceRow(boards.map { it.at("id").str().orEmpty() to it.at("label").str().orEmpty() }, board.at("id").str()) { selected = it }
        board.at("rows").list().mapNotNull { it.obj() }.take(LEADERS_SHOWN).forEachIndexed { i, row ->
            val mine = row.at("team").str() == view.teamName
            val team = row.at("team").str().orEmpty()
            val name = row.at("name").str().orEmpty()
            val id = row.at("id").num()?.toLong()
            Row(
                Modifier.fillMaxWidth().then(if (onPlayer != null) Modifier.clickable { onPlayer(team, id, name) } else Modifier).padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("${i + 1}", modifier = Modifier.width(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(row.at("name").str().orEmpty(), fontWeight = if (mine) FontWeight.Bold else FontWeight.Normal, color = if (mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
                Text(view.teamShort(row.at("team").str().orEmpty()), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 12.dp))
                val v = row.at("value").num()
                Text(
                    when {
                        v == null -> "-"
                        digits == 3 -> rate3(v)
                        digits > 0 -> "%.${digits}f".format(v)
                        else -> v.toInt().toString()
                    },
                    fontWeight = FontWeight.Bold,
                )
                // 「このままなら年間○」。1位だけ（並べると数字が多すぎる。Web 版 LeagueBoard の Leaders と同じ）
                leaderPace(i, row)?.let { Text("  ペース$it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

/** 1位の年間ペース（今の数より多いときだけ）。サーバーの `pace`（数える項目だけに付く） */
internal fun leaderPace(index: Int, row: JsonObject): Int? {
    if (index != 0) return null
    val pace = row.at("pace").num() ?: return null
    val value = row.at("value").num() ?: return null
    return pace.toInt().takeIf { pace > value }
}

private val NOTICE_LABELS = mapOf("draft" to "NPBドラフト", "tryout" to "トライアウト", "promotion" to "昇格・降格", "trade" to "トレード")

/** リーグ便り（ドラフト・トライアウト・昇降格・トレードと、過去のシーズンの最終順位） */
@Composable
fun NewsBoard(view: LeagueView, raw: JsonObject) {
    val notices = raw.at("notices").list().mapNotNull { it.obj() }
    val history = raw.at("history").list().mapNotNull { it.obj() }
    Section("リーグ便り") {
        if (notices.isEmpty() && history.isEmpty()) {
            Muted("まだお知らせがありません。ドラフト・トライアウト・昇格と降格・成立したトレードと、過去のシーズンの最終順位がここに並びます。")
            return@Section
        }
        val options = notices.mapIndexed { i, n ->
            "n$i" to "${n.at("year").int() ?: ""}年 ${NOTICE_LABELS[n.at("type").str()] ?: "お知らせ"}"
        } + history.mapIndexed { i, h -> "h$i" to "${h.at("year").int() ?: ""}年の最終順位" }
        var selected by rememberSaveable { mutableStateOf(options.first().first) }
        var expanded by rememberSaveable { mutableStateOf(false) }
        val key = options.firstOrNull { it.first == selected }?.first ?: options.first().first
        ChoiceRow(options.take(if (expanded) options.size else 4), key) { selected = it }
        if (options.size > 4 && !expanded) TextButton(onClick = { expanded = true }) { Text("ほかのお知らせ（${options.size - 4}件）") }
        val index = key.drop(1).toInt()
        if (key.startsWith("n")) {
            val notice = notices[index]
            val items = (notice["picks"] ?: notice["moves"]).list().mapNotNull { it.obj() }
            items.forEach { p ->
                if (notice.at("type").str() == "promotion") {
                    val from = p.at("from").str(); val to = p.at("to").str()
                    val up = (from == "B" && to == "A")
                    Text("${view.teamShort(p.at("teamId").str().orEmpty())}  ${LEAGUE_NAMES[from] ?: from} → ${LEAGUE_NAMES[to] ?: to}${if (up) "（昇格）" else "（降格）"}")
                } else {
                    val round = p["round"]?.let { r -> r.int()?.let { "${it}巡" } ?: r.str() }
                    Row {
                        Text(listOfNotNull(round, p.at("name").str()).joinToString(" "), fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        Muted("→ ${view.teamShort(p.at("npbTeam").str() ?: p.at("team").str().orEmpty())}")
                    }
                }
            }
        } else {
            history[index].at("standings").list().mapNotNull { it.obj() }.forEachIndexed { i, s ->
                Text("${i + 1}. ${view.teamLabel(s.at("team").str().orEmpty())}　${s.at("wins").int() ?: 0}勝${s.at("losses").int() ?: 0}敗")
            }
        }
    }
}

