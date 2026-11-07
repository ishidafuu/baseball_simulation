package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
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
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import jp.icenorth.baseball.app.AppViewModel
import jp.icenorth.baseball.app.PhaseDraft
import jp.icenorth.baseball.shared.Commands
import jp.icenorth.baseball.shared.PHASE_LABELS
import jp.icenorth.baseball.shared.ROSTER_LIMIT
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.bool
import jp.icenorth.baseball.shared.int
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.long
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.pid
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.teamLabel
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

private enum class ProcTab(val label: String) { Current("現在の手続き"), Trade("トレード") }

/** 手続きタブ: 初期メンバー選択・キャンプ・契約更改・トライアウト・年度更新と、トレード */
@Composable
fun ProceduresScreen(model: AppViewModel, onRename: () -> Unit) {
    val raw = model.raw ?: return
    // ⚠ どちらの側を開いているかは AppViewModel に置く（届いた提案の知らせから、トレードの側を直接開くため）
    val tab = if (model.procTrade) ProcTab.Trade else ProcTab.Current
    val waiting = raw.at("trades").list().count { it.at("myTurn").bool() == true }
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            ChipTabs(
                ProcTab.entries.map { it.name to (it.label + if (it == ProcTab.Trade && waiting > 0) "（$waiting）" else "") },
                tab.name,
                { model.procTrade = it == ProcTab.Trade.name },
                Modifier.weight(1f),
            )
            TextButton(onClick = onRename) { Text("球団名") }
        }
        when (tab) {
            ProcTab.Current -> CurrentProcedure(model, raw)
            ProcTab.Trade -> TradeScreen(model, raw)
        }
    }
}

@Composable
private fun CurrentProcedure(model: AppViewModel, raw: JsonObject) {
    val pending = raw["pendingPack"].obj()
    val phase = raw["phase"].obj()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when {
            pending != null -> PendingPack(model, raw, pending)
            phase != null -> PhasePanel(model, raw, phase)
            else -> Section("手続き") { Text("現在、決定待ちの手続きはありません。") }
        }
    }
}

/** 途中参加の初期メンバー選択。選んだ時点で保存する（pack 命令。締め切りは無い） */
@Composable
private fun PendingPack(model: AppViewModel, raw: JsonObject, pending: JsonObject) {
    val packs = pending.at("packs").list().mapNotNull { it.obj() }
    val chosen = pending.at("chosen").str()
    val chosenName = packs.firstOrNull { it.at("id").str() == chosen }?.at("name").str()
    Section(
        "初期メンバー選択",
        trailing = {
            InfoButton(
                "初期メンバー選択",
                listOf(
                    "20セットから1つ選びます。選んだ24人は次の日曜のキャンプで名簿に入り、月曜の開幕からあなたの球団になります。それまでは引き継いだ選手でCPUが戦い、ストーブリーグとキャンプの手続きもCPUが決めます。",
                    "どのセットも投12・捕2・内外10の24人（うち二刀流2人）、格付けはA2・B10・C12、年齢は19〜24歳です。合計の力は揃えてあるので、好みで選んで構いません。",
                    "選んだセットは1球団だけが受け取ります（重なったら球団名の順）。",
                ),
            )
        },
    ) {
        Muted(if (chosenName != null) "いま選んでいるのは「$chosenName」です。キャンプまでは何度でも選び直せます。" else "まだ選んでいません。決めずにキャンプを迎えると、1つ目のセットになります。")
    }
    PackPicker(model, packs, chosen) { id ->
        model.command("pack", Commands.pack(id), done = "初期メンバーを選びました")
    }
}

/** 締め切りの説明（Web 版の rulesText と同じ決まり） */
private fun rulesText(kind: String?, deadline: String?): String {
    val due = formatDeadline(deadline)
    return if (kind == "camp") {
        if (due != null) "締め切りは $due。全員が4クール終えた時点で次へ進みます。締め切りまでに終わらなかったぶんは、最後に指示した内容で自動で行われます。"
        else "全員が4クール終えると次へ進みます。"
    } else if (due != null) {
        "締め切りは $due。全員が決定した時点で処理します。締め切りを過ぎると、未決定の球団は保存した下書き（無ければ標準案）で進みます。ほかに検討中の球団がいる間は、決定後も出し直せます。"
    } else {
        "全員が決定した時点で処理します。この手続きに締め切りはありません。ほかに検討中の球団がいる間は、決定後も出し直せます。"
    }
}

@Composable
private fun PhasePanel(model: AppViewModel, raw: JsonObject, phase: JsonObject) {
    val view = model.view ?: return
    val phaseId = phase.at("id").str().orEmpty()
    val kind = phase.at("kind").str()
    val submission = phase["submission"].obj()
    val members = raw.at("members").list().mapNotNull { it.obj() }
    Section(PHASE_LABELS[kind] ?: phase.at("label").str() ?: "手続き") {
        Text(rulesText(kind, phase.at("deadline").str() ?: view.phaseDeadline), style = MaterialTheme.typography.bodyMedium)
        members.forEach { m ->
            val ready = m.at("ready").bool() == true
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (ready) "✓" else "…", color = if (ready) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(20.dp))
                Text(view.teamLabel(m.at("teamName").str().orEmpty()), modifier = Modifier.weight(1f))
                Muted(if (m.at("cpu").bool() == true) "CPUが決定（初期メンバー待ち）" else if (ready) "決定済み" else "検討中")
            }
        }
    }
    if (kind == "camp") {
        CampPanel(model, raw, phase)
        return
    }

    // 編集中の案。保存済みの提出があればそれ、無ければ標準案（defaults）から始める
    val draft = model.phaseDraft?.takeIf { it.phaseId == phaseId }
    var failure by remember(phaseId) { mutableStateOf<String?>(null) }
    // ⚠ 下書きを捨てた（null にした）ときも読み直すよう、draft == null も鍵に入れる
    LaunchedEffect(phaseId, submission, draft == null) {
        val current = model.phaseDraft?.takeIf { it.phaseId == phaseId }
        if (current != null && (current.dirty || current.base == (submission ?: JsonNull))) return@LaunchedEffect
        val plan = submission?.get("plan").obj()
        if (plan != null) {
            model.phaseDraft = PhaseDraft(phaseId, plan, submission, dirty = false)
            return@LaunchedEffect
        }
        try {
            val defaults = model.read("defaults")
            if (defaults.at("phaseId").str() != phaseId) {
                failure = "手続きが更新されました。最新状態を確認してください"
                return@LaunchedEffect
            }
            model.phaseDraft = PhaseDraft(phaseId, defaults["plan"].obj() ?: JsonObject(emptyMap()), JsonNull, dirty = false)
            failure = null
        } catch (e: Exception) {
            // ⚠ 前の読み込みが取り消されたとき（ページを連打した・画面を離れた）は失敗として出さない
            if (e is kotlinx.coroutines.CancellationException) throw e
            failure = model.describe(e)
        }
    }
    if (failure != null) {
        Section {
            Text("読み込めませんでした: $failure", color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { model.phaseDraft = null; failure = null; model.reload(pull = true) }) { Text("読み直す") }
        }
        return
    }
    if (draft == null) {
        Muted("標準案を準備しています…")
        return
    }
    val changedElsewhere = draft.dirty && draft.base != (submission ?: JsonNull)
    if (changedElsewhere) {
        Section {
            Text("別の操作で提出が更新されました。現在の入力を破棄して保存済みの内容を読み直せます。", color = MaterialTheme.colorScheme.secondary)
            OutlinedButton(onClick = { model.phaseDraft = null }) { Text("最新の提出を読み直す") }
        }
    }
    val scope = rememberCoroutineScope()
    val setPlan: (JsonObject) -> Unit = { model.phaseDraft = draft.copy(plan = it, dirty = true) }
    val plan = draft.plan
    val ready = submission?.at("ready").bool() == true

    // 決定・下書きの操作（PC版と同じく見出しのすぐ下に1か所）
    Section {
        Muted(
            when {
                draft.dirty -> "編集中の内容（未保存）です。"
                ready -> "あなたは決定済みです。ほかに検討中の球団がいる間は出し直せます。"
                submission != null -> "下書きを保存済みです。"
                else -> "標準案を表示しています。"
            },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = { submit(model, phaseId, plan, true, draft.base) }) { Text("この内容で決定") }
            OutlinedButton(onClick = { submit(model, phaseId, plan, false, draft.base) }) { Text(if (ready) "決定を取り消す" else "下書きを保存") }
        }
        if (draft.dirty) TextButton(onClick = { model.phaseDraft = null }) { Text("変更を取り消す") }
    }

    when {
        plan["packId"] != null || phase["packs"] != null -> {
            val packs = phase.at("packs").list().mapNotNull { it.obj() }
            PackPicker(model, packs, plan.at("packId").str()) { id -> setPlan(Commands.withPack(plan, id)) }
        }
        plan["rankedIds"] != null -> TryoutPanel(model, raw, phase, plan, setPlan) {
            // 標準案に戻す（⚠ 保存済みの下書きではなく、いつも標準案を取り直す）
            scope.launch {
                try {
                    val defaults = model.read("defaults")
                    if (defaults.at("phaseId").str() != phaseId) failure = "手続きが更新されました。最新状態を確認してください"
                    else model.phaseDraft = draft.copy(plan = defaults["plan"].obj() ?: plan, dirty = submission != null)
                } catch (e: Exception) {
                    // ⚠ 前の読み込みが取り消されたとき（ページを連打した・画面を離れた）は失敗として出さない
                    if (e is kotlinx.coroutines.CancellationException) throw e
                    failure = model.describe(e)
                }
            }
        }
        plan["releaseIds"] != null -> ReleasePanel(model, raw, plan, setPlan)
        kind == "offseason" -> Section { Text("最終順位を保存し、次年度のキャンプへ進みます。") }
    }
}

private fun submit(model: AppViewModel, phaseId: String, plan: JsonObject, ready: Boolean, base: JsonElement?) {
    model.command("submit", Commands.submit(phaseId, plan, ready, base), label = if (ready) "決定を送信中…" else "保存中…", done = if (ready) "決定しました" else "保存しました") {
        // ⚠ サーバーは提出を整えて保存する（送った形と同じとは限らない）ので、読み直したビューの提出から作り直す。
        //    送った形を base にすると、次の提出が edit_conflict で断られることがある
        model.phaseDraft = null
    }
}

/** 初期メンバーのセット。カードを押すと中身、「このセットにする」で選ぶ */
@Composable
private fun PackPicker(model: AppViewModel, packs: List<JsonObject>, chosen: String?, onChoose: (String) -> Unit) {
    var open by remember { mutableStateOf(chosen ?: packs.firstOrNull()?.at("id").str()) }
    Section("セットを選ぶ") {
        packs.forEach { pack ->
            val id = pack.at("id").str().orEmpty()
            val counts = pack["counts"].obj()
            Row(
                Modifier.fillMaxWidth().clickable { open = id }.padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(if (id == chosen) "●" else "○", color = if (id == chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, modifier = Modifier.width(22.dp))
                Column(Modifier.weight(1f)) {
                    Text(pack.at("name").str().orEmpty(), fontWeight = if (id == open) FontWeight.Bold else FontWeight.Normal)
                    Muted(
                        listOf("pitcher" to "投", "catcher" to "捕", "infield" to "内", "outfield" to "外")
                            .joinToString(" ") { (k, l) -> "$l${counts.at(k).int() ?: 0}" } +
                            " · 平均${pack.at("averageAge").str() ?: "-"}歳 · 二刀流${pack.at("twoWay").int() ?: 0}",
                    )
                }
                if (id == chosen) Tag("選択中", MaterialTheme.colorScheme.primary)
            }
            if (id == open) {
                Button(onClick = { onChoose(id) }, enabled = id != chosen) { Text(if (id == chosen) "選択中" else "このセットにする") }
                pack.at("players").list().mapNotNull { it.obj() }.forEach { p ->
                    PlayerSummary(p, { model.openPlayer = it }) {
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            p.at("rank").str()?.let { Tag(it, MaterialTheme.colorScheme.onSurfaceVariant) }
                            if (p.at("isTwoWay").bool() == true) Tag("二刀流")
                        }
                    }
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

/** 契約更改。チェックした選手が退団する（最低9人は残す） */
@Composable
private fun ReleasePanel(model: AppViewModel, raw: JsonObject, plan: JsonObject, setPlan: (JsonObject) -> Unit) {
    val roster = raw.at("roster").list().mapNotNull { it.obj() }
    val releases = plan.at("releaseIds").list().mapNotNull { it.long() }
    Section("退団させる選手（${releases.size}人）") {
        Muted("チェックした選手が退団（最低9人は残す）")
        roster.forEach { p ->
            val checked = p.pid in releases
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = checked,
                    onCheckedChange = { on ->
                        val next = if (on) releases + p.pid else releases - p.pid
                        setPlan(Commands.withReleases(plan, next))
                    },
                )
                Box(Modifier.weight(1f)) {
                    PlayerSummary(p, { model.openPlayer = it }) { if (checked) Tag("退団予定") }
                }
            }
        }
    }
}

/** 名簿の残りの枠（トライアウトの獲得希望人数の上限） */
internal fun rosterRoom(raw: JsonObject): Int = (ROSTER_LIMIT - raw.at("roster").list().size).coerceAtLeast(0)
