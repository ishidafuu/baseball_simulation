package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.layout.Arrangement
import jp.icenorth.baseball.shared.ABILITY_HELP
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import jp.icenorth.baseball.app.AppViewModel
import jp.icenorth.baseball.shared.CONDITION_TEXT
import jp.icenorth.baseball.shared.FORM_SHORT
import jp.icenorth.baseball.shared.PITCH_TYPE_NAMES
import jp.icenorth.baseball.shared.POSITION_LABELS
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.bool
import jp.icenorth.baseball.shared.detailReadable
import jp.icenorth.baseball.shared.formatStat
import jp.icenorth.baseball.shared.int
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.localPeriods
import jp.icenorth.baseball.shared.num
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.overviewGroup
import jp.icenorth.baseball.shared.positionLabel
import jp.icenorth.baseball.shared.str
import kotlinx.serialization.json.JsonObject

/** 選手の詳細（能力・守備適性・今季と通算の成績）。どの画面からでも同じシートで開く */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlayerSheet(model: AppViewModel, player: JsonObject) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = { model.openPlayer = null }, sheetState = state) {
        PlayerDetail(model, player)
    }
}

private fun hand(v: String?) = when (v) { "left" -> "左"; "switch" -> "両"; else -> "右" }

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PlayerDetail(model: AppViewModel, p: JsonObject) {
    val id = p.at("id").num()?.toLong()
    // ⚠ action=player は自球団の選手しか返さない（他球団・トレード相手・トライアウト候補は 404）。
    //    それ以外は球団の読み込みに載った期間を使う（Web 版 PlayerPerformance.jsx の Detail と同じ分け方）
    val ownRoster = model.raw?.at("roster").list().mapNotNull { it.obj() }
    val readable = remember(p, ownRoster) { detailReadable(p, ownRoster) }
    var periods by remember(id, readable) { mutableStateOf(if (readable) null else localPeriods(p)) }
    var failure by remember(id, readable) { mutableStateOf<String?>(null) }
    var attempt by remember(id, readable) { mutableStateOf(0) }
    LaunchedEffect(id, readable, attempt) {
        if (id == null || !readable) return@LaunchedEffect
        try {
            periods = model.read("player", mapOf("id" to id.toString())).at("periods").list().mapNotNull { it.obj() }
        } catch (e: Exception) {
            // ⚠ 前の読み込みが取り消されたとき（ページを連打した・画面を離れた）は失敗として出さない
            if (e is kotlinx.coroutines.CancellationException) throw e
            failure = model.describe(e)
        }
    }
    val pitcher = p.at("position").str() == "pitcher"
    var openPeriods by remember(id) { mutableStateOf(setOf(0)) }
    Column(
        // 画面の見回り（ScreenTour）はこの印の上でスクロールする（シートは別の窓なので、画面の根を送っても動かない）
        Modifier.testTag("player-sheet").verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column {
            Text(p.at("name").str().orEmpty(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            val condition = p.at("condition").int()?.let { CONDITION_TEXT.getOrNull(it) }
            Muted(
                listOfNotNull(
                    "${p.at("age").int() ?: "-"}歳",
                    POSITION_LABELS[p.at("position").str()]?.let { "本職 $it" },
                    "${hand(p.at("physical", "throws").str())}投${hand(p.at("batting", "bats").str())}打",
                    if (pitcher) FORM_SHORT[p.at("pitching", "form").str()] else null,
                    if (p.at("isTwoWay").bool() == true) "二刀流" else null,
                    condition?.let { "調子 $it" },
                    p.at("fatigue").int()?.let { "疲労 $it" },
                ).joinToString(" · "),
            )
        }
        // ⚠ 能力は投打の両方を持つ（二刀流が売り。投手を野手で、野手を投手で起用できる）。本職を先に
        // ⚠ **効き方で分けて並べ、項目を押すと何にどう効くかを出す**（いしだ指摘 2026-11-08: 体幹などが
        //    何に効いているのか分からず、アプリでは見えもしなかった）。Web 版の並べ方・説明と同じ
        val pitchingBlock: @Composable () -> Unit = {
            AbilityGroup("投球") {
                Item("球速", p.at("pitching", "velocity").int(), velocity = true)
                Item("制球", p.at("pitching", "control").int())
                Item("スタミナ", p.at("pitching", "stamina").int(), stamina = true)
                Item("回転", p.at("pitching", "spinRate").int())
                Item("出どころ", p.at("deception").int())
                p.at("pitching", "arsenal").list().filter { it.at("type").str() != "straight" }.forEach { a ->
                    AbilityNum("${PITCH_TYPE_NAMES[a.at("type").str()] ?: a.at("type").str()} ", a.at("level").int())
                }
            }
        }
        val battingBlock: @Composable () -> Unit = {
            AbilityGroup("打撃・守備") {
                Item("ミート", p.at("batting", "meet").int())
                Item("パワー", p.at("batting", "power").int())
                Item("選球眼", p.at("batting", "eye").int())
                Item("走力", p.at("physical", "speed").int())
                Item("盗塁", p.at("batting", "steal").int(), help = "盗塁技術")
                Item("バント", p.at("batting", "bunt").int())
                Item("守備", p.at("fielding", "defense").int())
                Item("肩", p.at("physical", "arm").int(), help = "肩力")
                if (p.at("position").str() == "catcher") Item("リード", p.at("catching", "lead").int(), help = "捕手リード")
                p.at("batterType").str()?.let { TextItem("打者型", it) }
            }
        }
        Text("能力", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        // ⚠ 本職でない側は畳んでおき、見出しを押して開く（いしだ 2026-11-11: シートが長い）。
        //    二刀流の選手は両方が本職なので、いつも両方を開いておく
        val twoWay = p.at("isTwoWay").bool() == true
        var otherOpen by remember(id) { mutableStateOf(false) }
        val (mainBlock, otherBlock) = if (pitcher) pitchingBlock to battingBlock else battingBlock to pitchingBlock
        mainBlock()
        if (twoWay || otherOpen) otherBlock()
        if (!twoWay) {
            Row(
                Modifier.fillMaxWidth().clickable { otherOpen = !otherOpen }.padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Muted(if (pitcher) "打撃・守備の能力（本職でない）" else "投球の能力（本職でない）", Modifier.weight(1f))
                Text(if (otherOpen) "閉じる ▴" else "開く ▾", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        AbilityGroup("体力・精神") {
            Item("体力", p.at("physical", "bodyStamina").int())
            Item("回復", p.at("physical", "recovery").int())
            Item("精神力", p.at("personality", "mental").int())
        }
        AbilityGroup("成長の素質（試合には効かない）") {
            Item("体幹", p.at("physical", "muscle").int())
            Item("器用さ", p.at("physical", "dexterity").int())
            Item("プロ意識", p.at("personality", "discipline").int())
            growthFactor(p)?.let { TextItem("成長係数", it) }
        }
        val fitness = p.at("positionFitness").obj().orEmpty()
            .mapNotNull { (pos, v) -> v.int()?.let { pos to it } }
            .filter { (pos, v) -> pos != "pitcher" && v >= 60 }
            .sortedByDescending { it.second }
        if (fitness.isNotEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("守れる位置（適性）", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                ABILITY_HELP["守備適性"]?.let { InfoButton("守備適性", listOf(it)) }
            }
            Text(fitness.joinToString("  ") { (pos, v) -> "${positionLabel(pos)} $v" })
        }
        val history = p.at("careerHistory").list().mapNotNull { it.at("label").str() }
        if (history.isNotEmpty()) Muted("経歴: " + history.joinToString(" → "))

        Text("成績", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        when {
            failure != null -> LoadFailed(failure.orEmpty(), onRetry = { failure = null; attempt += 1 }, title = "成績を読めませんでした")
            periods == null -> Muted("読み込み中…")
            periods!!.isEmpty() -> Muted("成績の記録がありません。")
            else -> periods!!.forEachIndexed { index, period ->
                // ⚠ 開いておくのは先頭（今季）だけ。ほかの期間は見出しを押して開く（全部を並べるとシートが長く、
                //    同じ並びの数字が3回続いて、どれが今季か見失った）
                val shown = index in openPeriods
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(
                        Modifier.fillMaxWidth().clickable { openPeriods = if (shown) openPeriods - index else openPeriods + index }.padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(period.at("label").str().orEmpty(), fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        Text(if (shown) "閉じる ▴" else "開く ▾", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (!shown) return@Column
                    // 投手は投球を先に。打席に立っていれば打撃も出す
                    val sides = if (pitcher) listOf(false, true) else listOf(true, false)
                    sides.forEach { batting ->
                        val group = overviewGroup(batting)
                        val show = if (batting) !pitcher || (period.at("seasonStats", "batting", "plateAppearances").num() ?: 0.0) > 0
                        else pitcher || (period.at("seasonStats", "pitching", "games").num() ?: 0.0) > 0
                        if (show) {
                            Muted(if (batting) "打撃" else "投球")
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                group.columns.forEach { c ->
                                    Row {
                                        Text("${c.label} ", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.alignByBaseline())
                                        Text(formatStat(c, c.get(period)), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.alignByBaseline().width(ValueWidth))
                                    }
                                }
                            }
                        }
                    }
                    period.at("source").str()?.let { Muted(it) }
                }
            }
        }
    }
}

private val ValueWidth = 48.dp

/** [AbilityGroup] の中の項目。押した項目の説明を、かたまりの下に出す */
private class AbilityScope(val open: String?, val toggle: (String) -> Unit)

/**
 * 能力の1かたまり（小さな見出しと数字の並び）。項目を押すと、何にどう効くか（[ABILITY_HELP]）を
 * 下に出す。もう一度押すと閉じる。
 * ⚠ 説明は押したときだけ出す（いつも出しておくと画面が長くなる。アプリの「添え書きを常に出さない」決まり）
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AbilityGroup(title: String, content: @Composable AbilityScope.() -> Unit) {
    var open by remember { mutableStateOf<String?>(null) }
    val scope = AbilityScope(open) { key -> open = if (open == key) null else key }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Muted(title)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { scope.content() }
        open?.let { key ->
            ABILITY_HELP[key]?.let { text ->
                Text(
                    "$key  $text",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp).testTag("ability-help"),
                )
            }
        }
    }
}

/** 数字の項目。[help] は説明の見出し（Web 版の名前。アプリの短い表示名と違うときだけ渡す） */
@Composable
private fun AbilityScope.Item(label: String, value: Int?, help: String = label, velocity: Boolean = false, stamina: Boolean = false) {
    val known = ABILITY_HELP[help] != null
    Box(Modifier.clickable(enabled = known) { toggle(help) }) {
        AbilityNum("$label ", value, velocity, stamina)
    }
}

/** 文字の項目（打者型・成長係数） */
@Composable
private fun AbilityScope.TextItem(label: String, text: String, help: String = label) {
    Row(Modifier.clickable(enabled = ABILITY_HELP[help] != null) { toggle(help) }) {
        Text("$label ", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.alignByBaseline())
        Text(text, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, modifier = Modifier.alignByBaseline())
    }
}

/** 成長係数（Web 版と同じく 0.3〜1.8 に収め、小数2桁） */
private fun growthFactor(p: JsonObject): String? {
    val base = p.at("growthPotential").num() ?: return null
    val value = (base + (p.at("growthModifier").num() ?: 0.0)).coerceIn(0.3, 1.8)
    val hundredths = kotlin.math.round(value * 100).toInt()
    return "${hundredths / 100}.${(hundredths % 100).toString().padStart(2, '0')}"
}
