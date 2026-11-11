package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import jp.icenorth.baseball.app.AppViewModel
import jp.icenorth.baseball.shared.BATTING_GROUPS
import jp.icenorth.baseball.shared.LeagueView
import jp.icenorth.baseball.shared.PITCHING_GROUPS
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.careerRoster
import jp.icenorth.baseball.shared.bool
import jp.icenorth.baseball.shared.defaultSortColumn
import jp.icenorth.baseball.shared.int
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.num
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.overviewGroup
import jp.icenorth.baseball.shared.positionLabel
import jp.icenorth.baseball.shared.sortRoster
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.teamLabel
import jp.icenorth.baseball.shared.teamShort
import kotlinx.serialization.json.JsonObject

private enum class PlayersMode(val label: String) { Season("今季"), Career("通算"), Ranking("能力順") }

/** 選手タブ: 選手成績・通算成績（球団を切り替えて同じ表）と、リーグ全体の能力ランキング */
@Composable
fun PlayersScreen(model: AppViewModel) {
    val view = model.view ?: return
    val raw = model.raw ?: return
    var mode by rememberSaveable { mutableStateOf(PlayersMode.Season) }
    // 見ている球団はモデルに置く（試合タブの順位表から「この球団の選手成績」へ飛べるように）。
    // ⚠ 飛んできたときに「選手成績」の表を出すための合図は要らない。タブを移ると この画面は構成から外れ、
    //    mode は毎回「選手成績」から始まる（以前の合図 seenJump は、入った時点で合図と同じ値になり働いていなかった）
    val team = model.playersTeam ?: view.teamName.orEmpty()
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        // ⚠ 絞り込みは2段にまとめる（以前は 表の種類／球団・打撃投球／項目 の3段で、表が画面の半ばから始まった）。
        //    1段目に表の種類と球団、2段目（TeamStats の中）に打撃・投球と項目
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
            ChipTabs(PlayersMode.entries.map { it.name to it.label }, mode.name, { mode = PlayersMode.valueOf(it) })
            Box(Modifier.weight(1f)) {
                if (mode != PlayersMode.Ranking) TeamPicker(view, raw, team) { model.playersTeam = it }
            }
            InfoButton(
                "選手",
                listOf("表の見出しを押すと並べ替え、名前を押すと選手の詳細を開きます。", "自球団の表で色の付いた行は、スタメン・先発ローテの選手です。ランキングでは自球団の選手に色が付きます。"),
                Modifier.padding(end = 8.dp),
            )
        }
        when (mode) {
            PlayersMode.Ranking -> AbilityRanking(model, view, raw)
            else -> TeamStats(model, view, raw, team, career = mode == PlayersMode.Career)
        }
    }
}

@Composable
private fun TeamPicker(view: LeagueView, raw: JsonObject, team: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val names = raw.at("teamNames").list().mapNotNull { it.str() }.ifEmpty { view.standings.map { it.team } }
    // 自球団を先頭に
    val ordered = listOfNotNull(view.teamName) + names.filter { it != view.teamName }
    Box {
        TextButton(onClick = { open = true }) {
            Text(view.teamLabel(team), fontWeight = FontWeight.Bold)
            Icon(Icons.Filled.ArrowDropDown, contentDescription = "球団を選ぶ")
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            ordered.forEach { name ->
                DropdownMenuItem(
                    text = { Text(view.teamLabel(name) + if (name == view.teamName) "（自球団）" else "") },
                    onClick = { open = false; onPick(name) },
                )
            }
        }
    }
}

@Composable
private fun TeamStats(model: AppViewModel, view: LeagueView, raw: JsonObject, team: String, career: Boolean) {
    val own = team == view.teamName
    // 自球団の今季は手元のビューで出す。他球団と通算はその場で読みに行く（全球団ぶんをビューに載せない）
    var loaded by remember(team, career) { mutableStateOf<List<JsonObject>?>(null) }
    var failure by remember(team, career) { mutableStateOf<String?>(null) }
    var attempt by remember(team, career) { mutableStateOf(0) }
    val needsRead = career || !own
    LaunchedEffect(team, career, view.revision, attempt) {
        if (!needsRead) return@LaunchedEffect
        try {
            val result = model.read("team", mapOf("team" to team))
            loaded = result.at("roster").list().mapNotNull { it.obj() }
            failure = null
        } catch (e: Exception) {
            // ⚠ 前の読み込みが取り消されたとき（ページを連打した・画面を離れた）は失敗として出さない
            if (e is kotlinx.coroutines.CancellationException) throw e
            failure = model.describe(e)
        }
    }
    val source: List<JsonObject>? = if (needsRead) loaded else raw.at("roster").list().mapNotNull { it.obj() }
    // 通算は通算の数字を表が読む形に移す（Web 版 careerRoster と同じ）。記録の無い選手は出さない
    // ⚠ 通算はサーバーの期間の一覧（`periods` の id=career）から読む（careerRoster。以前の `career` の項目はもう無い）
    val roster = source?.let { list -> if (!career) list else careerRoster(list) }
    var batting by rememberSaveable { mutableStateOf(true) }
    var groupId by rememberSaveable(batting) { mutableStateOf("overview") }
    var sortId by rememberSaveable(batting, career) { mutableStateOf<String?>(null) }
    var ascending by rememberSaveable(batting, career) { mutableStateOf(false) }
    val groups = listOf(overviewGroup(batting)) + if (batting) BATTING_GROUPS else PITCHING_GROUPS
    val group = groups.firstOrNull { it.id == groupId } ?: groups.first()
    val allColumns = groups.flatMap { it.columns }
    val sortColumn = sortId?.let { id -> allColumns.firstOrNull { it.id == id } } ?: defaultSortColumn(batting)
    val players = roster.orEmpty().filter { (it.at("position").str() == "pitcher") != batting && it.at("isActive").bool() != false }
    val sorted = sortRoster(players, sortColumn, if (sortId == null) false else ascending)
    val lineupIds = remember(view.lineup) {
        view.lineup?.at("battingOrder").list().mapNotNull { it.at("playerId").num()?.toLong() }.toSet() +
            view.lineup?.at("starters").list().mapNotNull { it.num()?.toLong() }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            ChoiceRow(listOf("bat" to "打撃", "pit" to "投球"), if (batting) "bat" else "pit") { batting = it == "bat" }
            // 項目は残りの幅で横に送る
            ChipTabs(groups.map { it.id to it.label }, group.id, { groupId = it }, Modifier.weight(1f))
        }
        if (career && roster != null) {
            val years = roster.maxOfOrNull { it.at("career", "years").int() ?: 0 } ?: 0
            val partial = roster.any { it.at("career", "partial").bool() == true }
            Muted(
                if (roster.isEmpty()) "このリーグでの記録がまだありません。1シーズン目が進むと出ます。"
                else "通算${years}シーズン（今季を含む）" + if (partial) "。記録の無い試合の分は入っていません" else "",
                Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        when {
            failure != null -> LoadFailed(failure.orEmpty(), onRetry = { failure = null; attempt += 1 }, modifier = Modifier.padding(16.dp))
            roster == null -> Muted("読み込み中…", Modifier.padding(16.dp))
            else -> {
                StatTable(
                    players = sorted,
                    columns = group.columns,
                    sortId = sortColumn.id,
                    ascending = if (sortId == null) false else ascending,
                    onSort = { c ->
                        if (c.id == sortColumn.id && sortId != null) ascending = !ascending
                        else { sortId = c.id; ascending = c.ascending }
                    },
                    onPlayer = { model.openPlayer = it },
                    highlight = { own && (it.at("id").num()?.toLong() ?: -1L) in lineupIds },
                    sub = { p ->
                        positionLabel(p.at("position").str()) + (p.at("age").int()?.let { " ${it}歳" } ?: "")
                    },
                    // ⚠ なぜいないのかを書く（以前は名簿が空の開幕前も「該当する選手がいません」だけだった）
                    empty = when {
                        career -> "通算の記録のある${if (batting) "野手" else "投手"}がいません。"
                        roster.isEmpty() && own -> "まだ選手がいません。初期メンバー選択が済むと、ここに並びます。"
                        roster.isEmpty() -> "まだ選手がいません。"
                        else -> "${if (batting) "野手" else "投手"}がいません。"
                    },
                )
            }
        }
    }
}

/** 能力ランキング（リーグ全球団の中の並び。球団ごとの表では作れない） */
@Composable
private fun AbilityRanking(model: AppViewModel, view: LeagueView, raw: JsonObject) {
    val boards = raw.at("abilityLeaders").list().mapNotNull { it.obj() }
    if (boards.isEmpty()) {
        Muted("まだ集計がありません。", Modifier.padding(16.dp))
        return
    }
    var selected by rememberSaveable { mutableStateOf(boards.first().at("id").str().orEmpty()) }
    val board = boards.firstOrNull { it.at("id").str() == selected } ?: boards.first()
    val velocity = board.at("velocity").bool() == true
    val stamina = board.at("stamina").bool() == true
    // 自球団の選手だけに絞る（順位はリーグ全体の中の順位のまま）
    var ownOnly by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        ChipTabs(boards.map { it.at("id").str().orEmpty() to it.at("label").str().orEmpty() }, board.at("id").str().orEmpty(), { selected = it })
        Box(Modifier.padding(horizontal = 16.dp)) { ChoiceRow(listOf("all" to "リーグ全体", "own" to "自球団だけ"), if (ownOnly) "own" else "all") { ownOnly = it == "own" } }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp)) {
            val ranked = board.at("rows").list().mapNotNull { it.obj() }.withIndex().filter { !ownOnly || it.value.at("team").str() == view.teamName }
            if (ranked.isEmpty()) Muted("この項目の上位に、自球団の選手はいません。", Modifier.padding(vertical = 12.dp))
            ranked.forEach { (i, row) ->
                val mine = row.at("team").str() == view.teamName
                Row(
                    Modifier.fillMaxWidth().clickable { model.openPlayer = row }.padding(vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${i + 1}", modifier = Modifier.width(28.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Column(Modifier.weight(1f)) {
                        Text(row.at("name").str().orEmpty(), fontWeight = if (mine) FontWeight.Bold else FontWeight.SemiBold, color = if (mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                        Muted("${view.teamShort(row.at("team").str().orEmpty())} · ${positionLabel(row.at("position").str())} · ${row.at("age").int() ?: "-"}歳")
                    }
                    Box(Modifier.width(56.dp), contentAlignment = Alignment.CenterEnd) {
                        AbilityNum(null, row.at("value").int(), velocity = velocity, stamina = stamina)
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}
