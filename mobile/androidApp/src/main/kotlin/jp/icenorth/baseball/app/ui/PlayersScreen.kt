package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.ui.graphics.Color
import jp.icenorth.baseball.shared.AGE_OUTLOOK_NOTE
import jp.icenorth.baseball.shared.AgeOutlook
import jp.icenorth.baseball.shared.ageOutlookLabel
import jp.icenorth.baseball.shared.ageOutlookOf
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
import jp.icenorth.baseball.shared.RELIEF_ORDER
import jp.icenorth.baseball.shared.RELIEF_ROLES
import jp.icenorth.baseball.shared.STARTER_ROLES
import jp.icenorth.baseball.shared.seasonLine
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.careerRoster
import jp.icenorth.baseball.shared.bool
import jp.icenorth.baseball.shared.defaultSortColumn
import jp.icenorth.baseball.shared.int
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.num
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.overviewGroup
import jp.icenorth.baseball.shared.abilityOverview
import jp.icenorth.baseball.shared.positionLabel
import jp.icenorth.baseball.shared.sortRoster
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.teamLabel
import jp.icenorth.baseball.shared.teamShort
import kotlinx.serialization.json.JsonObject
import kotlin.math.roundToInt

private enum class PlayersMode(val label: String) { Season("今季"), Career("通算"), CareerRank("通算順"), Ranking("能力順"), Ages("年齢") }

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
                if (mode != PlayersMode.Ranking && mode != PlayersMode.CareerRank && mode != PlayersMode.Ages) TeamPicker(view, raw, team) { model.playersTeam = it }
            }
            InfoButton(
                "選手",
                // ⚠ 添え書きは常に出さず ⓘ に入れる（アプリは狭い。年齢の見込みの読み方もここ）
                listOf("表の見出しを押すと並べ替え、名前を押すと選手の詳細を開きます。", "色の付いた行は、スタメン・先発ローテの選手です。他球団は表の上にスタメンと投手陣も出します。ランキングでは自球団の選手に色が付きます。", "年齢: $AGE_OUTLOOK_NOTE"),
                Modifier.padding(end = 8.dp),
            )
        }
        when (mode) {
            PlayersMode.Ranking -> AbilityRanking(model, view, raw)
            PlayersMode.CareerRank -> CareerRanking(model, view, raw)
            // 自球団の年齢構成と3年後の見込み（Web 版 AgeOutlook.jsx と同じ中身）
            PlayersMode.Ages -> AgeOutlookPane(raw)
            else -> TeamStats(model, view, raw, team, career = mode == PlayersMode.Career)
        }
    }
}

@Composable
private fun AgeOutlookPane(raw: JsonObject) {
    val outlook = remember(raw) { ageOutlookOf(raw) }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
        item { AgeOutlookCard(outlook) }
    }
}

/**
 * 年齢構成と3年後の見込み（自球団）。選手の「年齢」と、手続きのトライアウト・契約更改
 * （`ProceduresScreen.kt`。`compact` で主力の一覧を省く。Web 版 LeaguePanels.jsx と同じ置き場所）
 */
@Composable
fun AgeOutlookCard(outlook: AgeOutlook?, compact: Boolean = false) {
    // 手続きの中（compact）は、見込みが無ければ何も出さない（Web 版と同じ）
    if (outlook == null) { if (!compact) Text("まだ見込みを出せません。", style = MaterialTheme.typography.bodySmall); return }
    val most = (outlook.bands.maxOfOrNull { it.pitchers + it.fielders } ?: 1).coerceAtLeast(1)
    Section("年齢構成と${outlook.years}年後の見込み") {
        outlook.bands.forEach { b ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(b.label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.width(72.dp))
                Row(Modifier.weight(1f).height(10.dp).background(Color(0x26949FB8))) {
                    if (b.fielders > 0) Box(Modifier.weight(b.fielders.toFloat()).fillMaxHeight().background(Color(0xFF38BDF8)))
                    if (b.pitchers > 0) Box(Modifier.weight(b.pitchers.toFloat()).fillMaxHeight().background(Color(0xFFF59E0B)))
                    val rest = most - b.fielders - b.pitchers
                    if (rest > 0) Spacer(Modifier.weight(rest.toFloat()))
                }
                Text("野手${b.fielders}・投手${b.pitchers}", style = MaterialTheme.typography.labelSmall)
            }
        }
        outlook.lines.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
        Text(outlook.advice, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
        if (!compact) outlook.core.forEach { r ->
            Text(
                "${r.name}（${positionLabel(r.position)}） ${r.age}歳 → ${r.later}歳　${ageOutlookLabel(r)}",
                style = MaterialTheme.typography.bodySmall,
                color = if (r.kind == "decline" || r.veteran) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
            )
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
    // 他球団のスタメンと投手陣（球団の読み込みの `lineup`。古い保存では無い）
    var loadedLineup by remember(team, career) { mutableStateOf<JsonObject?>(null) }
    // 引退・解雇・退団した選手の通算（サーバーの `formerCareers`。通算のときだけ出す）
    var former by remember(team, career) { mutableStateOf<List<JsonObject>>(emptyList()) }
    var failure by remember(team, career) { mutableStateOf<String?>(null) }
    var attempt by remember(team, career) { mutableStateOf(0) }
    val needsRead = career || !own
    LaunchedEffect(team, career, view.revision, attempt) {
        if (!needsRead) return@LaunchedEffect
        try {
            val result = model.read("team", mapOf("team" to team))
            loaded = result.at("roster").list().mapNotNull { it.obj() }
            loadedLineup = result.at("lineup").obj()
            former = result.at("formerCareers").list().mapNotNull { it.obj() }
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
    // 主要の次に能力（スタメン・トレードの行と同じ並び）
    val groups = listOf(overviewGroup(batting), abilityOverview(batting)) + if (batting) BATTING_GROUPS else PITCHING_GROUPS
    val group = groups.firstOrNull { it.id == groupId } ?: groups.first()
    val allColumns = groups.flatMap { it.columns }
    // 捕手の区分は受けた選手と捕手だけを、守った回の多い順に出す（Web 版 CompactRoster と同じ）
    val catching = group.id == "catching" || group.id == "catchingAllowed"
    val catchingColumns = BATTING_GROUPS.filter { it.id == "catching" || it.id == "catchingAllowed" }.flatMap { it.columns }
    val chosenColumn = sortId?.let { id -> allColumns.firstOrNull { it.id == id } }
    val sortColumn = when {
        catching && (chosenColumn == null || catchingColumns.none { it.id == chosenColumn.id }) -> catchingColumns.first()
        else -> chosenColumn ?: defaultSortColumn(batting)
    }
    val sortAscending = if (catching && sortColumn.id != chosenColumn?.id) false else if (sortId == null) false else ascending
    val players = roster.orEmpty().filter { (it.at("position").str() == "pitcher") != batting && it.at("isActive").bool() != false }
        .filter { !catching || it.at("catcherStats").obj() != null || it.at("position").str() == "catcher" }
    val sorted = sortRoster(players, sortColumn, sortAscending)
    val lineup = if (own) view.lineup else loadedLineup
    val lineupIds = remember(lineup) {
        lineup?.at("battingOrder").list().mapNotNull { it.at("playerId").num()?.toLong() }.toSet() +
            lineup?.at("starters").list().mapNotNull { it.num()?.toLong() }
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
                // 他球団はスタメンと投手陣を表の上に出す（順位表から球団を押して来たとき用。先方要望 2026-11）
                if (!own && !career && lineup != null && source != null) {
                    TeamLineupCard(lineup, source) { model.openPlayer = it }
                }
                StatTable(
                    players = sorted,
                    columns = group.columns,
                    sortId = sortColumn.id,
                    ascending = sortAscending,
                    onSort = { c ->
                        if (c.id == sortColumn.id && sortId == c.id) ascending = !ascending
                        else { sortId = c.id; ascending = c.ascending }
                    },
                    onPlayer = { model.openPlayer = it },
                    highlight = { (it.at("id").num()?.toLong() ?: -1L) in lineupIds },
                    sub = { p ->
                        positionLabel(p.at("position").str()) + (p.at("age").int()?.let { " ${it}歳" } ?: "")
                    },
                    // ⚠ なぜいないのかを書く（以前は名簿が空の開幕前も「該当する選手がいません」だけだった）
                    empty = when {
                        catching -> "捕手の記録がまだありません。"
                        career -> "通算の記録のある${if (batting) "野手" else "投手"}がいません。"
                        roster.isEmpty() && own -> "まだ選手がいません。初期メンバー選択が済むと、ここに並びます。"
                        roster.isEmpty() -> "まだ選手がいません。"
                        else -> "${if (batting) "野手" else "投手"}がいません。"
                    },
                )
                if (catching) {
                    Muted(
                        "※ マスクをかぶった時の投手成績（記録を取り始めた後の試合だけ）。読まれ率は、打者に狙い球を当てられた球の割合で、低いほどリードが効いています",
                        Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                    )
                }
                if (career) FormerCareers(former, batting)
            }
        }
    }
}

/**
 * 引退・解雇・退団した選手の通算（その球団で最後にプレーした人。新しく去った順）。
 * Web 版 CareerStats の「退団・引退した選手の通算」と同じ中身。
 * ⚠ 先方要望（2026-11-16）「引退・解雇後も成績が残るように」。名簿に居ないので押しても詳細は開かない
 */
@Composable
private fun FormerCareers(list: List<JsonObject>, batting: Boolean) {
    val rows = list.filter { it.at(if (batting) "batting" else "pitching").obj() != null }
    if (rows.isEmpty()) return
    fun rate3(v: Double?): String = v?.let { val n = kotlin.math.round(it * 1000).toInt(); if (n >= 1000) "1.000" else ".${n.toString().padStart(3, '0')}" } ?: "—"
    fun dec2(v: Double?): String = v?.let { val n = kotlin.math.round(it * 100).toInt(); "${n / 100}.${(n % 100).toString().padStart(2, '0')}" } ?: "—"
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Caption("退団・引退した${if (batting) "野手" else "投手"}の通算")
        rows.forEach { r ->
            val b = r.at("batting").obj()
            val q = r.at("pitching").obj()
            val line = if (batting && b != null) {
                "${b.at("games").int() ?: 0}試合 打率${rate3(b.at("avg").num())} ${b.at("hits").int() ?: 0}安打 ${b.at("homeruns").int() ?: 0}本 ${b.at("rbis").int() ?: 0}打点 ${b.at("stolenBases").int() ?: 0}盗塁"
            } else if (q != null) {
                "${q.at("games").int() ?: 0}登板 ${q.at("wins").int() ?: 0}勝${q.at("losses").int() ?: 0}敗${q.at("saves").int() ?: 0}S${q.at("holds").int() ?: 0}H 防御率${dec2(q.at("era").num())} ${q.at("strikeouts").int() ?: 0}奪三振"
            } else ""
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(r.at("name").str().orEmpty(), fontWeight = FontWeight.SemiBold)
                    Muted("最終${r.at("lastYear").int() ?: ""}年・${r.at("years").int() ?: 0}シーズン")
                }
            }
            Muted(line)
            HorizontalDivider(Modifier.padding(top = 6.dp), color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

/**
 * 他球団のスタメン（打順・守備・今季成績）と投手陣（先発ローテ・救援の役割）。
 * Web 版の順位表から開く小窓（src/online/TeamLineup.jsx）と同じ中身。名前を押すと選手の詳細。
 * ⚠ 方針・作戦はサーバーが載せない（人の球団の采配は出さない）
 */
@Composable
private fun TeamLineupCard(lineup: JsonObject, roster: List<JsonObject>, onPlayer: (JsonObject) -> Unit) {
    var open by rememberSaveable { mutableStateOf(true) }
    val byId = remember(roster) { roster.associateBy { it.at("id").num()?.toLong() } }
    val order = lineup.at("battingOrder").list().mapNotNull { it.obj() }.sortedBy { it.at("battingOrder").int() ?: 0 }
    val starters = lineup.at("starters").list().mapNotNull { it.num()?.toLong() }.filter { it in byId }
    val roles = lineup.at("pitcherRoles").obj().orEmpty().mapNotNull { (k, v) -> k.toLongOrNull()?.let { it to v.str().orEmpty() } }.toMap()
    val relievers = RELIEF_ORDER.flatMap { role -> roles.filter { (id, r) -> r == role && id !in starters && id in byId }.keys.map { it to role } }
    @Composable
    fun line(mark: String, sub: String?, player: JsonObject?) {
        Row(
            Modifier.fillMaxWidth().then(if (player != null) Modifier.clickable { onPlayer(player) } else Modifier).padding(vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.width(92.dp)) {
                Text(mark, style = MaterialTheme.typography.bodyMedium)
                if (sub != null) Muted(sub)
            }
            Text(player?.at("name").str() ?: "（空き）", Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
            Muted(player?.let { seasonLine(it).removePrefix("今季 ") }.orEmpty())
        }
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { Caption("スタメン・投手陣（今の起用）") }
            TextButton(onClick = { open = !open }) { Text(if (open) "畳む" else "出す") }
        }
        if (open) {
            order.forEach { e ->
                line("${e.at("battingOrder").int() ?: ""}番 ${positionLabel(e.at("position").str())}", null, byId[e.at("playerId").num()?.toLong()])
            }
            if (order.isNotEmpty()) Muted("9番は先発投手（その日の先発ローテの番）")
            HorizontalDivider(Modifier.padding(vertical = 6.dp), color = MaterialTheme.colorScheme.outlineVariant)
            starters.forEachIndexed { i, id ->
                val type = roles[id]?.takeIf { it != "auto_s" }?.let { STARTER_ROLES[it] }
                line("先発${i + 1}", type, byId[id])
            }
            relievers.forEach { (id, role) -> line(RELIEF_ROLES[role] ?: role, null, byId[id]) }
            if (starters.isEmpty() && relievers.isEmpty()) Muted("投手起用がまだありません。")
            HorizontalDivider(Modifier.padding(top = 6.dp), color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

/**
 * 通算成績ランキング（リーグ全球団の選手の、このリーグを始めてからの合計の上位。Web 版 CareerStats の「リーグ全体ランキング」）。
 * ⚠ 先方指摘「各チームごとの通算成績しか見られない。全チームの選手をランキング化した通算成績も」。
 *    並べ替えはサーバー（`careerLeaders`）。退団した選手も残る（押しても詳細は開かない）
 */
@Composable
private fun CareerRanking(model: AppViewModel, view: LeagueView, raw: JsonObject) {
    val boards = raw.at("careerLeaders").list().mapNotNull { it.obj() }
    if (boards.isEmpty()) {
        Muted("まだ集計がありません。", Modifier.padding(16.dp))
        return
    }
    var selected by rememberSaveable { mutableStateOf(boards.first().at("id").str().orEmpty()) }
    val board = boards.firstOrNull { it.at("id").str() == selected } ?: boards.first()
    val format = board.at("format").str()
    fun text(v: Double?): String = when {
        v == null -> "—"
        format == "rate" -> v.let { val n = (it * 1000).roundToInt(); if (n >= 1000) "1.000" else ".${n.toString().padStart(3, '0')}" }
        format == "decimal" -> ((v * 100).roundToInt() / 100.0).let { val t = it.toString(); if (t.substringAfter('.').length < 2) t + "0" else t }
        else -> v.roundToInt().toString()
    }
    Column(Modifier.fillMaxSize()) {
        ChipTabs(boards.map { it.at("id").str().orEmpty() to it.at("label").str().orEmpty() }, board.at("id").str().orEmpty(), { selected = it })
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp)) {
            Muted("リーグ全球団の選手の、このリーグを始めてからの合計です（今季を含む・退団した選手も残ります）。" + (board.at("qualified").str()?.let { " $it" } ?: ""))
            val rows = board.at("rows").list().mapNotNull { it.obj() }
            if (rows.isEmpty()) Muted("該当なし", Modifier.padding(vertical = 12.dp))
            rows.forEachIndexed { i, row ->
                val active = row.at("active").bool() == true
                val mine = active && row.at("team").str() == view.teamName
                Row(
                    Modifier.fillMaxWidth()
                        .then(if (active) Modifier.clickable { model.openPlayerOf(row.at("team").str().orEmpty(), row.at("id").num()?.toLong(), row.at("name").str()) } else Modifier)
                        .padding(vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${i + 1}", modifier = Modifier.width(28.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Column(Modifier.weight(1f)) {
                        Text(row.at("name").str().orEmpty(), fontWeight = if (mine) FontWeight.Bold else FontWeight.SemiBold, color = if (mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                        Muted((row.at("team").str()?.let { view.teamShort(it) } ?: "—") + if (active) "" else "（退団）")
                    }
                    Text(text(row.at("value").num()), fontWeight = FontWeight.Bold)
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
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
