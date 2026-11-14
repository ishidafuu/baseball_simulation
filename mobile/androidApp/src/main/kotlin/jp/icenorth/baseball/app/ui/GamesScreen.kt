package jp.icenorth.baseball.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import jp.icenorth.baseball.app.AppViewModel
import jp.icenorth.baseball.shared.LeagueView
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.bool
import jp.icenorth.baseball.shared.int
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.num
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.positionLabel
import jp.icenorth.baseball.shared.readableChangeReason
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.teamLabel
import jp.icenorth.baseball.shared.teamShort
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/**
 * 試合タブ: 自球団／リーグ全体の試合結果（年度・6試合ずつ）と、1試合の打撃・投手成績。
 * @param section 開いている区分（試合結果・順位表・タイトル・リーグ便り）。⚠ 呼ぶ側（OnlineApp）が持つ。
 *                順位表から選手タブへ飛んだあと、戻るで順位表に戻すため（以前は戻ると「試合結果」から）
 */
@Composable
fun GamesScreen(model: AppViewModel, section: String, onSection: (String) -> Unit, onOpenTeam: (String) -> Unit = {}) {
    val view = model.view ?: return
    val raw = model.raw ?: return
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    // ⚠ 一覧の選択（年度・自球団/リーグ・区分・ページ）は詳細を開く分岐より**前に**置く。後ろに置くと、
    //    詳細を開いている間は構成から外れて捨てられ、戻ると初期値（1ページ目など）に戻っていた
    val years = raw.at("seasonYears").list().mapNotNull { it.int() }.ifEmpty { listOfNotNull(view.year) }
    var year by rememberSaveable { mutableStateOf(years.lastOrNull() ?: 1) }
    var scope by rememberSaveable { mutableStateOf("own") }
    // ⚠ ページ送り（6試合ずつ）はやめ、下の「続きを表示」で足していく（1シーズンを見返すのに何十回も押していた）
    var pages by rememberSaveable { mutableStateOf(1) }
    // ⚠ 読んだ一覧とスクロールの位置も分岐より前に置く（以前は後ろにあり、詳細から戻ると一瞬「読み込み中…」に
    //    なって一覧の先頭に戻っていた。「続きを表示」で足した下の方の試合を開くと、戻るたびに送り直しになる）
    val listScroll = rememberScrollState()
    var data by remember { mutableStateOf<JsonObject?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    // 「読み直す」を押した回数（鍵に入れて読み直す）
    var attempt by remember { mutableStateOf(0) }
    LaunchedEffect(year, scope, pages, view.revision, attempt) {
        loading = true
        try {
            // 読んだページは版ごとに覚えているので、足したぶんだけ通信する
            val parts = (0 until pages).map { model.read("games", mapOf("year" to "$year", "page" to "$it", "scope" to scope, "size" to "$GAMES_CHUNK")) }
            data = JsonObject(parts.first() + ("games" to JsonArray(parts.flatMap { it.at("games").list() })))
            failure = null
        } catch (e: Exception) {
            // ⚠ 前の読み込みが取り消されたとき（ページを連打した・画面を離れた）は失敗として出さない
            if (e is kotlinx.coroutines.CancellationException) throw e
            failure = model.describe(e)
        } finally {
            // ⚠ 取り消された読み込み（次のページの読み込みが始まった）では消さない。新しい読み込みの「読み込み中」が先に消えてしまう
            if (kotlinx.coroutines.currentCoroutineContext()[kotlinx.coroutines.Job]?.isActive == true) loading = false
        }
    }
    val current = open
    if (current != null) {
        BackHandler { open = null }
        GameDetail(model, view, current.substringBefore(':'), current.substringAfter(':')) { open = null }
        return
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(listScroll).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("試合", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        // ⚠ 順位表・タイトル争い・リーグ便りはここ（ホームは新聞の紙面にしたので、数字の表はこのタブにまとめる）
        ChipTabs(
            listOf("results" to "試合結果", "standings" to "順位表", "leaders" to "タイトル", "news" to "リーグ便り"),
            section,
            onSection,
        )
        when (section) {
            "standings" -> { StandingsBoard(view, onOpenTeam); return@Column }
            "leaders" -> {
                val boards = raw.at("leaders").list().mapNotNull { it.obj() }.filter { it.at("rows").list().isNotEmpty() }
                if (boards.isEmpty()) Muted("まだ記録がありません。") else LeadersBoard(view, boards) { team, id, name -> model.openPlayerOf(team, id, name) }
                return@Column
            }
            "news" -> { NewsBoard(view, raw); return@Column }
        }
        ChoiceRow(listOf("own" to "自球団", "league" to "リーグ全体"), scope) { scope = it; pages = 1 }
        if (years.size > 1) ChoiceRow(years.map { "$it" to "${it}年目" }, "$year") { year = it.toInt(); pages = 1 }
        val games = data?.at("games").list().mapNotNull { it.obj() }
        val count = data?.at("count").int() ?: 0
        when {
            failure != null -> LoadFailed(failure.orEmpty(), onRetry = { failure = null; attempt += 1 })
            data == null -> Muted("読み込み中…")
            games.isEmpty() -> Muted("まだ試合がありません。")
            else -> Section {
                games.forEach { g ->
                    GameRow(view, g) { open = "${g.at("gameId").num()?.toLong()}:${data?.at("year").int() ?: year}" }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
        val shown = games.size
        if (data != null && failure == null && count > shown) {
            OutlinedButton(onClick = { pages += 1 }, enabled = !loading, modifier = Modifier.fillMaxWidth()) {
                Text(if (loading) "読み込み中…" else "続きを表示（残り${count - shown}試合）")
            }
        }
    }
}

/** 試合結果を1回に読む数（「続きを表示」で足す数） */
private const val GAMES_CHUNK = 20

private fun dateText(g: JsonObject) = g.at("date").let { d -> "${d.at("month").int() ?: ""}/${d.at("day").int() ?: ""}" }

@Composable
private fun GameRow(view: LeagueView, g: JsonObject, onOpen: () -> Unit) {
    val home = g.at("home").str().orEmpty()
    val away = g.at("away").str().orEmpty()
    val hs = g.at("homeScore").int()
    val `as` = g.at("awayScore").int()
    val mine = view.teamName
    val result = if (mine == home || mine == away) {
        val own = if (mine == home) hs else `as`
        val their = if (mine == home) `as` else hs
        if (own == null || their == null) null else if (own > their) "勝" to WinColor else if (own < their) "負" to LoseColor else "分" to MaterialTheme.colorScheme.onSurfaceVariant
    } else null
    Row(Modifier.fillMaxWidth().testTag("game-row").clickable(onClick = onOpen).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(dateText(g), modifier = Modifier.width(44.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        Text(result?.first ?: "", color = result?.second ?: MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold, modifier = Modifier.width(20.dp))
        Column(Modifier.weight(1f)) {
            Text("${view.teamShort(away)}  ${`as` ?: "-"} - ${hs ?: "-"}  ${view.teamShort(home)}", fontWeight = FontWeight.SemiBold)
            val d = g.at("decisions")
            Muted(
                listOfNotNull(
                    d.at("winningPitcher", "name").str()?.let { "勝 $it" },
                    d.at("losingPitcher", "name").str()?.let { "敗 $it" },
                    d.at("savePitcher", "name").str()?.let { "S $it" },
                ).joinToString("  "),
            )
        }
        Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun GameDetail(model: AppViewModel, view: LeagueView, id: String, year: String, onBack: () -> Unit) {
    var game by remember(id) { mutableStateOf<JsonObject?>(null) }
    var failure by remember(id) { mutableStateOf<String?>(null) }
    var attempt by remember(id) { mutableStateOf(0) }
    LaunchedEffect(id, attempt) {
        try {
            game = model.read("game", mapOf("id" to id, "year" to year))
        } catch (e: Exception) {
            // ⚠ 前の読み込みが取り消されたとき（ページを連打した・画面を離れた）は失敗として出さない
            if (e is kotlinx.coroutines.CancellationException) throw e
            failure = model.describe(e)
        }
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onClick = onBack) { Text("‹ 試合結果へ戻る") }
        val g = game
        when {
            failure != null -> LoadFailed(failure.orEmpty(), onRetry = { failure = null; attempt += 1 })
            g == null -> Muted("読み込み中…")
            else -> {
                val home = g.at("home").str().orEmpty()
                val away = g.at("away").str().orEmpty()
                Section {
                    Muted("${dateText(g)} · ${view.teamLabel(home)}の主催")
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(view.teamShort(away), style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f), textAlign = TextAlign.End)
                        Text(
                            "  ${g.at("awayScore").int() ?: "-"} - ${g.at("homeScore").int() ?: "-"}  ",
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(view.teamShort(home), style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                    }
                    LineScoreTable(view, g)
                    val d = g.at("decisions")
                    Muted(
                        listOfNotNull(
                            d.at("winningPitcher", "name").str()?.let { "勝 $it" },
                            d.at("losingPitcher", "name").str()?.let { "敗 $it" },
                            d.at("savePitcher", "name").str()?.let { "S $it" },
                            d.at("holdPitchers").list().mapNotNull { it.at("name").str() }.takeIf { it.isNotEmpty() }?.let { "H ${it.joinToString("・")}" },
                        ).joinToString("  "),
                    )
                }
                // 得点経過（何回に誰が何で点を入れたか）。記録の無い古い試合には無い
                ScoringList(view, scoringOf(g["scoring"]), away, home)
                listOf(away, home).forEach { team ->
                    val players = g.at("teams", team).list().mapNotNull { it.obj() }
                    if (players.isNotEmpty()) BoxScore(view, team, players) { p -> model.openPlayerOf(team, p.at("id").num()?.toLong(), p.at("name").str()) }
                }
                val changes = g.at("pitcherChanges").list().mapNotNull { it.obj() }
                if (changes.isNotEmpty()) {
                    Section("継投") {
                        changes.forEach { c ->
                            Column {
                                Text(
                                    "${c.at("inning").int()}回${if (c.at("isTop").bool() == true) "表" else "裏"} ${view.teamShort(c.at("team").str().orEmpty())}  ${c.at("out").str()} → ${c.at("in").str()}",
                                    fontSize = 13.sp,
                                )
                                Muted(listOfNotNull(c.at("role").str(), c.at("reason").str()?.let(::readableChangeReason)).joinToString(" · "))
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * 回ごとの得点の欄（先攻・後攻）。9回に満たなくても9回まで枠を取る。
 * 後攻は、やらなかった裏を「x」、サヨナラの回を「1x」にする（紙面のスコアボードと同じ書き方）
 */
internal fun lineScoreCells(away: List<Int>, home: List<Int>, walkOff: Boolean): Pair<List<String>, List<String>> {
    val innings = maxOf(9, away.size, home.size)
    val top = (0 until innings).map { away.getOrNull(it)?.toString() ?: "" }
    val bottom = (0 until innings).map { i ->
        when {
            i < home.size && i == home.size - 1 && walkOff -> "${home[i]}x"
            i < home.size -> "${home[i]}"
            i < away.size -> "x"
            else -> ""
        }
    }
    return top to bottom
}

/** スコアボード。⚠ 試合の詳細に無く、何回に点が入ったか分からなかった。古い試合（記録に無い）は出さない */
@Composable
private fun LineScoreTable(view: LeagueView, g: JsonObject) {
    val ls = g.at("lineScore").obj() ?: return
    val away = ls.at("away").list().mapNotNull { it.int() }
    val home = ls.at("home").list().mapNotNull { it.int() }
    if (away.isEmpty()) return
    val (top, bottom) = lineScoreCells(away, home, g.at("walkOff").bool() == true)
    val cell = Modifier.width(20.dp)
    @Composable
    fun line(name: String, cells: List<String>, total: String, head: Boolean) {
        val color = if (head) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(name, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Clip, modifier = Modifier.width(48.dp))
            cells.forEach { Text(it, fontSize = if (head) 11.sp else 13.sp, color = color, textAlign = TextAlign.Center, modifier = cell) }
            Text(total, fontSize = if (head) 11.sp else 14.sp, fontWeight = FontWeight.Bold, color = color, textAlign = TextAlign.End, modifier = Modifier.width(28.dp))
        }
    }
    // 延長で幅が足りないときは横に送る
    Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
        line("", top.indices.map { "${it + 1}" }, "計", head = true)
        line(view.teamShort(g.at("away").str().orEmpty()), top, "${away.sum()}", head = false)
        line(view.teamShort(g.at("home").str().orEmpty()), bottom, "${home.sum()}", head = false)
    }
}

/** @param width 列の幅。⚠ 34dp で揃えていたら、投手の表（7列）で名前の欄が狭くなり名前が切れた */
private data class Col(val label: String, val width: Dp = 28.dp, val get: (JsonObject) -> String)

private fun n(v: Double?) = v?.toInt()?.toString() ?: "-"

private val BATTER_COLS = listOf(
    Col("打数") { n(it.at("batting", "atBats").num()) },
    Col("安打") { n(it.at("batting", "hits").num()) },
    Col("本塁") { n(it.at("batting", "homeruns").num()) },
    Col("打点") { n(it.at("batting", "rbis").num()) },
    Col("四球") { n(it.at("batting", "walks").num()) },
    Col("三振") { n(it.at("batting", "strikeouts").num()) },
)

private val PITCHER_COLS = listOf(
    Col("回") { p -> p.at("pitching", "inningsPitched").num()?.toInt()?.let { "${it / 3}.${it % 3}" } ?: "-" },
    Col("被安") { n(it.at("pitching", "hits").num()) },
    Col("失点") { n(it.at("pitching", "runsAllowed").num()) },
    Col("自責") { n(it.at("pitching", "earnedRuns").num()) },
    Col("四球") { n(it.at("pitching", "walks").num()) },
    Col("三振") { n(it.at("pitching", "strikeouts").num()) },
    Col("球数", 32.dp) { n(it.at("pitching", "pitches").num()) },
)

@Composable
private fun BoxScore(view: LeagueView, team: String, players: List<JsonObject>, onPlayer: (JsonObject) -> Unit) {
    val batters = players
        .filter { (it.at("battingOrder").int() ?: 0) > 0 || (it.at("batting", "plateAppearances").num() ?: 0.0) > 0 }
        .sortedBy { it.at("battingOrder").int()?.takeIf { o -> o > 0 } ?: 99 }
    val pitchers = players.filter { (it.at("pitching", "battersFaced").num() ?: 0.0) > 0 || (it.at("pitching", "inningsPitched").num() ?: 0.0) > 0 }
    Section(view.teamLabel(team)) {
        Table(batters, BATTER_COLS, onPlayer) { p -> "${p.at("battingOrder").int()?.takeIf { it > 0 }?.toString() ?: " "} ${positionLabel(p.at("position").str())} ${p.at("name").str().orEmpty()}" }
        if (pitchers.isNotEmpty()) {
            Muted("投手")
            Table(pitchers, PITCHER_COLS, onPlayer) { it.at("name").str().orEmpty() }
        }
    }
}

@Composable
private fun Table(rows: List<JsonObject>, cols: List<Col>, onPlayer: (JsonObject) -> Unit, name: (JsonObject) -> String) {
    Column {
        Row {
            Text("", modifier = Modifier.weight(1f))
            cols.forEach { Text(it.label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(it.width), textAlign = TextAlign.End) }
        }
        rows.forEach { p ->
            // 行を押すと選手の詳細（押しやすい高さにする）
            Row(Modifier.fillMaxWidth().clickable { onPlayer(p) }.padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(name(p), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                cols.forEach { Text(it.get(p), fontSize = 13.sp, modifier = Modifier.width(it.width), textAlign = TextAlign.End) }
            }
        }
    }
}
