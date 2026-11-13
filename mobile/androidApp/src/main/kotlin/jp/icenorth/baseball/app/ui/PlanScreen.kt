package jp.icenorth.baseball.app.ui

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import jp.icenorth.baseball.app.AppViewModel
import jp.icenorth.baseball.shared.EditHistory
import jp.icenorth.baseball.shared.FIELDER_REST_FATIGUE
import jp.icenorth.baseball.shared.FIELD_POSITIONS
import jp.icenorth.baseball.shared.positionGroup
import jp.icenorth.baseball.shared.FIELDER_GROUP_LABELS
import jp.icenorth.baseball.shared.LeagueView
import jp.icenorth.baseball.shared.MAX_STARTERS
import jp.icenorth.baseball.shared.PlanDraft
import jp.icenorth.baseball.shared.Player
import jp.icenorth.baseball.shared.RELIEF_ORDER
import jp.icenorth.baseball.shared.RELIEF_REST_FATIGUE
import jp.icenorth.baseball.shared.RELIEF_ROLES
import jp.icenorth.baseball.shared.ROLE_HINT
import jp.icenorth.baseball.shared.STARTER_ORDER
import jp.icenorth.baseball.shared.STARTER_ROLES
import jp.icenorth.baseball.shared.STARTER_SKIP_FATIGUE
import jp.icenorth.baseball.shared.STRATEGY_EFFECTS
import jp.icenorth.baseball.shared.STRATEGY_FIELDS
import jp.icenorth.baseball.shared.SUBSTITUTE_MIN_FITNESS
import jp.icenorth.baseball.shared.SUBSTITUTE_FRESH_FATIGUE
import jp.icenorth.baseball.shared.TACTIC_FIELDS
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.conditionIcon
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.num
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.candidatesFor
import jp.icenorth.baseball.shared.positionLabel
import jp.icenorth.baseball.shared.roleLabel
import jp.icenorth.baseball.shared.subPositions
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState

private enum class PlanTab(val label: String) { Order("スタメン"), Pitching("投手起用"), Tactics("方針・采配"), Staff("指導者") }

/** 編集（今の編集に当てる変換）を渡す */
private typealias Edit = ((PlanDraft) -> PlanDraft) -> Unit

private sealed interface PlanSheet {
    data class Role(val id: Long) : PlanSheet
}

/**
 * スタメンで選んでいる行。もう1つの行を押すと入れ替える（PC のスタメン設定と同じ「選んで、もう1つを押す」）。
 * ⚠ 以前は守備の入れ替え・控えとの交代を別のシートで選んでいて、シートを開くと一覧の能力・成績が見えなくなった
 *    （いしだ 2026-11-13）。一覧の上で選び、相手の行に「入れ替えたときの適性」を出す。
 */
private sealed interface OrderPick {
    data class Starter(val index: Int) : OrderPick
    data class Bench(val id: Long) : OrderPick
}

/**
 * 編成タブ（スタメン・投手起用・方針と采配）。
 *
 * ⚠ 3つの面を**1つの編集**として持ち、保存も元に戻す／やり直すも上の1か所に置く
 *    （以前の指摘: 保存の場所が面ごとに違うと迷う）。
 * ⚠ 編集はタブを移っても消えないよう、画面ではなくモデル側（model.plan）に置く。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlanScreen(model: AppViewModel, tipsBadge: @Composable () -> Unit = {}) {
    val view = model.view
    val lineup = view?.lineup
    if (view == null || lineup == null || view.roster.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("編成はシーズンの名簿が決まると編集できます", textAlign = TextAlign.Center, modifier = Modifier.padding(24.dp))
        }
        return
    }
    // サーバーの編成が変わったら、編集していなければ最新に合わせる（編集中は手元を優先。保存時にサーバーが食い違いを見る）
    LaunchedEffect(lineup, view.roster) {
        val fresh = PlanDraft.from(lineup, view.roster)
        val current = model.plan
        // ⚠ 「編集していない」は手を付けていない（元に戻す手が無い）ことでも見る。名簿だけが変わった（トレード・抹消）とき、
        //    作り直した元の案と見比べるだけだと、抜けた選手の枠が空きに変わるぶん「未保存の変更」に見えて、最新に合わなかった
        if (current == null || !current.canUndo || current.present.sameEdit(PlanDraft.from(current.present.base, view.roster))) model.plan = EditHistory(fresh)
    }
    val history = model.plan ?: EditHistory(PlanDraft.from(lineup, view.roster))
    val draft = history.present
    val dirty = !draft.sameEdit(PlanDraft.from(draft.base, view.roster))
    // 編集中にサーバーの編成が変わった（PCで保存した・手続きで名簿が変わった）。このまま保存しても edit_conflict で断られる
    val stale = draft.base != lineup
    // ⚠ 編集は「今の編集に当てる変換」で渡す。ドラッグ中は描き直しの前に何度も呼ばれるので、
    //    描いたときの draft から作ると途中の移動が消える
    val edit: Edit = { f -> (model.plan ?: history).let { h -> model.plan = h.push(f(h.present)) } }
    // ドラッグ1回ぶんの移動は1手にまとめる（元に戻す1回で、つかむ前に戻る）
    val dragging = remember { booleanArrayOf(false) }
    val dragEdit: Edit = { f ->
        (model.plan ?: history).let { h ->
            val next = f(h.present)
            if (next != h.present) model.plan = if (dragging[0]) h.replace(next) else h.push(next).also { dragging[0] = true }
        }
    }
    val onDragStart = { dragging[0] = false }
    // 手続きの「指導者の画面へ」から来たら、その面（指導者）から開く。合図は一度使ったら下ろす
    var tab by rememberSaveable { mutableStateOf(PlanTab.entries.firstOrNull { it.name == model.planFaceRequest } ?: PlanTab.Order) }
    LaunchedEffect(model.planFaceRequest) {
        PlanTab.entries.firstOrNull { it.name == model.planFaceRequest }?.let { tab = it }
        model.planFaceRequest = null
    }
    var sheet by remember { mutableStateOf<PlanSheet?>(null) }
    val players = remember(view.roster) { view.roster.associateBy { it.id } }
    val rawPlayers = remember(model.raw) {
        model.raw?.at("roster").list().mapNotNull { it.obj() }
            .associateBy { it.at("id").num()?.toLong() ?: 0L }
    }
    val open: (Long) -> Unit = { id -> rawPlayers[id]?.let { model.openPlayer = it } }
    val nextId = model.raw?.at("nextStarterId").num()?.toLong()

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        // ⚠ 指導者の面では編成の保存の帯を出さない（任せ方は面の中の「任せ方を保存」で送る。
        //    帯の「保存」と並ぶと、どちらで任せ方が保存されるのか分からなかった）
        if (tab != PlanTab.Staff) {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 8.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                // ⚠ 4つのボタンと状態の文を1行に収める（ボタンの名前を長くしたら、状態の文が縦に1字ずつ折れた）。
                //    ボタンの内側の余白を詰め、状態の文は折り返さない
                val tight = PaddingValues(horizontal = 6.dp)
                TextButton(onClick = { model.plan = history.undo() }, enabled = history.canUndo, contentPadding = tight) { Text("↶ 元に戻す") }
                TextButton(onClick = { model.plan = history.redo() }, enabled = history.canRedo, contentPadding = tight) { Text("↷ やり直す") }
                Text(if (dirty) "未保存" else "保存済み", style = MaterialTheme.typography.labelSmall, color = if (dirty) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, softWrap = false, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                // ⚠ 取り消すと、編集を始めたときではなく**今の保存済み**の編成に戻す（古い base に戻すと保存が断られ続ける）
                // ⚠ 名前は「変更を取り消す」（手続き・指導者の画面と Web と同じ。以前はここだけ「変更を捨てる」だった）
                TextButton(onClick = { model.plan = history.push(PlanDraft.from(lineup, view.roster)) }, enabled = dirty || stale, contentPadding = tight) { Text("変更を取り消す") }
                Button(
                    onClick = {
                        val problem = draft.problem(view.roster)
                        if (problem != null) model.error = problem
                        else model.saveLineup(draft.toPayload()) {
                            model.view?.lineup?.let { model.plan = EditHistory(PlanDraft.from(it, model.view!!.roster)) }
                        }
                    },
                    enabled = dirty,
                ) { Text("保存") }
            }
            if (stale) {
                Text(
                    "別の画面で編成が更新されました。この編集は保存できないので、「変更を取り消す」で最新の編成を読み直してから編集し直してください。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }
        }
        // 今の状態に当てはまる TIPS の印は面の切り替えの右に（行に重ねない）。切り替えの右の余白は詰めて、印が「指導者」にかからないように
        Row(Modifier.fillMaxWidth().padding(top = if (tab == PlanTab.Staff) 8.dp else 0.dp), verticalAlignment = Alignment.CenterVertically) {
            ChipTabs(PlanTab.entries.map { it.name to it.label }, tab.name, { tab = PlanTab.valueOf(it) }, Modifier.weight(1f), endPadding = 4.dp)
            tipsBadge()
        }
        when (tab) {
            PlanTab.Order -> OrderEditor(view, draft, players, nextId, dragEdit, edit, onDragStart, open, model.lineupDetail, model::changeLineupDetail)
            PlanTab.Pitching -> PitchingEditor(view, draft, players, nextId, dragEdit, edit, onDragStart, open) { sheet = it }
            PlanTab.Tactics -> TacticsEditor(view, draft, edit)
            // 監督・コーチと任せ方（PC の「指導者」ページと同じ中身）
            PlanTab.Staff -> StaffPanel(model, view)
        }
    }

    when (val s = sheet) {
        is PlanSheet.Role -> ModalBottomSheet(onDismissRequest = { sheet = null }) {
            RoleSheet(
                draft, s.id, players[s.id],
                onRemove = { edit { it.withPitching(it.pitching.removeFromStaff(s.id, view.roster)) }; sheet = null },
            ) { role ->
                edit { it.withPitching(it.pitching.setRole(s.id, role)) }; sheet = null
            }
        }
        null -> Unit
    }
}

// ------------------------------------------------------------------ スタメン

/**
 * スタメン。「打順を組む」「適性を見て守備を決める」「疲れた選手を休ませる」を**この1画面で**できるようにする。
 *  - 行はスタメンも控えも同じ形（[FielderRow]）。ふだんは名前と今季成績、「成績のみ」を押すと能力も出す
 *  - 守備の札は投手・捕手・内野・外野で色を分ける
 *  - 選手を押して選び、ほかのスタメンを押すと守備の入れ替え、控えを押すと交代（控えから選んでもよい）。
 *    スタメンを選んでいる間は、控えを画面の下に固定して出す
 *  - 上の「気になる所」に、休養に入る選手と適性の低い守備を出す
 *  - 投手も野手の枠に入れられる（二刀流）。控えの最後に投手を出す（守れる位置のある投手だけ。残りは畳む）
 */
@Composable
private fun OrderEditor(
    view: LeagueView,
    draft: PlanDraft,
    players: Map<Long, Player>,
    nextId: Long?,
    edit: Edit,
    /** 押して1回で終わる編集（入れ替え・交代） */
    clickEdit: Edit,
    onDragStart: () -> Unit,
    open: (Long) -> Unit,
    /** 行に能力も出すか（既定は成績だけ） */
    detail: Boolean = false,
    onDetail: (Boolean) -> Unit = {},
) {
    val haptic = LocalHapticFeedback.current
    var picked by remember { mutableStateOf<OrderPick?>(null) }
    // 編成が変わったら（取り消し・保存など）、選んでいた打順の枠がずれるので選び直し
    // ⚠ 打順・名簿が変わったら（ドラッグ・元に戻す・読み直し）選択を外す。数だけで見ると、並べ替えで
    //    選んだ番号が別の選手を指したまま残り、次の押下で違う選手を入れ替えた
    LaunchedEffect(draft.slots, view.roster) { picked = null }
    val pick: (OrderPick) -> Unit = { target ->
        val current = picked
        when {
            current == null -> picked = target
            current == target -> picked = null
            current is OrderPick.Starter && target is OrderPick.Starter -> {
                clickEdit { it.swapPositions(current.index, target.index) }; haptic.performHapticFeedback(HapticFeedbackType.LongPress); picked = null
            }
            current is OrderPick.Starter && target is OrderPick.Bench -> {
                clickEdit { it.replaceBatter(current.index, target.id) }; haptic.performHapticFeedback(HapticFeedbackType.LongPress); picked = null
            }
            current is OrderPick.Bench && target is OrderPick.Starter -> {
                clickEdit { it.replaceBatter(target.index, current.id) }; haptic.performHapticFeedback(HapticFeedbackType.LongPress); picked = null
            }
            else -> picked = target
        }
    }
    val listState = rememberLazyListState()
    val reorder = rememberReorderableLazyListState(listState) { from, to ->
        val a = (from.key as? String)?.removePrefix("bat:")?.toLongOrNull() ?: return@rememberReorderableLazyListState
        val b = (to.key as? String)?.removePrefix("bat:")?.toLongOrNull() ?: return@rememberReorderableLazyListState
        edit { d ->
            val i = d.slots.indexOfFirst { it.playerId == a }
            val j = d.slots.indexOfFirst { it.playerId == b }
            if (i < 0 || j < 0) d else d.moveBatter(i, j)
        }
        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    }
    val bench = benchOf(view, draft)
    val notes = orderNotes(draft, players, bench)
    val pickedStarter = (picked as? OrderPick.Starter)?.index?.let { draft.slots.getOrNull(it) }
    val pickedBench = (picked as? OrderPick.Bench)?.id?.let { players[it] }
    /** 選んでいる行と入れ替えたら、この行の人はどこをどの適性で守るか */
    val starterHint: (Int) -> (@Composable () -> Unit)? = { index ->
        val slot = draft.slots[index]
        when {
            pickedStarter != null && picked != OrderPick.Starter(index) -> {
                val me = players[pickedStarter.playerId]
                val them = players[slot.playerId]
                ({
                    SwapHint("⇄", listOf(
                        Triple(me?.name.orEmpty(), slot.position, me?.fitness(slot.position) ?: 0),
                        Triple(them?.name ?: "空き", pickedStarter.position, them?.fitness(pickedStarter.position) ?: 0),
                    ))
                })
            }
            pickedBench != null -> ({ SwapHint("交代", listOf(Triple(pickedBench.name, slot.position, pickedBench.fitness(slot.position)))) })
            else -> null
        }
    }
    val benchHint: (Player) -> (@Composable () -> Unit)? = { p ->
        if (pickedStarter != null) ({ SwapHint("交代", listOf(Triple(p.name, pickedStarter.position, p.fitness(pickedStarter.position)))) }) else null
    }
    // ⚠ 投手は多い（10人以上）。守れる位置（適性 SUBSTITUTE_MIN_FITNESS 以上）のある投手だけを出し、残りは「全員を出す」で開く
    var allPitchers by rememberSaveable { mutableStateOf(false) }
    val pitcherBench = pitcherBenchOf(view, draft)
    val shownPitchers = (if (allPitchers) pitcherBench else pitcherBench.filter { it.subPositions().isNotEmpty() })
        .sortedByDescending { p -> p.bestFieldPosition()?.let { p.fitness(it) } ?: 0 }
    // 次の先発が野手の枠にも入っている（二刀流の先発の日）
    val twoWaySlot = draft.slots.firstOrNull { nextId != null && it.playerId == nextId }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            val who = pickedStarter?.let { players[it.playerId]?.name } ?: pickedBench?.name
            if (who != null) {
                // 選んでいる間だけ、次に何を押せばよいかを出す（いつも出す説明は ⓘ に。いしだ指定）
                // ⚠ 操作の説明は ⓘ に（2行取っていた。いしだ 2026-11-13）。ここは誰を選んでいるかだけ
                Text(
                    "$who を選択中",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.secondary,
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { picked = null }) { Text("やめる") }
            } else {
                Box(Modifier.weight(1f)) { Caption("打順") }
                // 行に出すものの切り替え（既定は成績だけ。まず成績を見て決めるので。端末に覚える）
                TextButton(onClick = { onDetail(!detail) }, contentPadding = PaddingValues(horizontal = 8.dp), modifier = Modifier.testTag("lineup-detail")) {
                    Text(if (detail) "能力も表示中 ▴" else "成績のみ ▾", style = MaterialTheme.typography.labelMedium)
                }
            }
            InfoButton("スタメン", ORDER_HELP, Modifier.padding(end = 8.dp))
        }
        LazyColumn(
            state = listState,
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.fillMaxWidth().weight(1f),
        ) {
            if (notes.isNotEmpty()) {
                item(key = "notes") {
                    Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
                        Column(Modifier.padding(vertical = 4.dp)) {
                            Text("気になる所", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
                            notes.forEach { note ->
                                Row(
                                    Modifier.fillMaxWidth().clickable { picked = note.pick }.padding(horizontal = 12.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    PosBadge(note.position, small = true)
                                    Text(note.text, style = MaterialTheme.typography.bodySmall, color = note.color ?: MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
                                    Text(note.action, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                    }
                }
            }
            item(key = "head:bat") {
                Column {
                    twoWaySlot?.let { slot ->
                        Muted(
                            "${players[slot.playerId]?.name ?: "次の先発"}は次の先発です。先発の日は9番・投手に回り、${positionLabel(slot.position)}はその日だけ控えが守ります（試合の後は元に戻ります）",
                            Modifier.padding(horizontal = 4.dp),
                        )
                    }
                }
            }
            items(draft.slots, key = { "bat:${it.playerId}" }) { slot ->
                val index = draft.slots.indexOf(slot)
                ReorderableItem(reorder, key = "bat:${slot.playerId}") { dragging ->
                    val elevation by animateDpAsState(if (dragging) 8.dp else 0.dp, label = "lift")
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = when {
                            dragging -> MaterialTheme.colorScheme.surfaceContainerHighest
                            picked == OrderPick.Starter(index) -> MaterialTheme.colorScheme.secondary.copy(alpha = 0.22f)
                            else -> MaterialTheme.colorScheme.surfaceContainer
                        },
                        shadowElevation = elevation,
                        modifier = Modifier.fillMaxWidth().longPressDraggableHandle(onDragStarted = { onDragStart(); haptic.performHapticFeedback(HapticFeedbackType.LongPress) }),
                    ) {
                        FielderRow(
                            order = "${index + 1}",
                            position = slot.position,
                            player = players[slot.playerId],
                            fitnessAt = slot.position,
                            onPosition = { pick(OrderPick.Starter(index)) },
                            onName = { pick(OrderPick.Starter(index)) },
                            onInfo = { open(slot.playerId) },
                            draggable = true,
                            placeholder = "空き（押して控えと交代）",
                            hint = starterHint(index),
                            detail = detail,
                        )
                    }
                }
            }
            FIELDER_GROUP_LABELS.forEach { (group, label) ->
                val members = bench.filter { positionGroup(it.position) == group }
                if (members.isEmpty()) return@forEach
                item(key = "head:bench:$group") { Caption("控え・$label（${members.size}人）") }
                items(members, key = { "bench:${it.id}" }) { p ->
                    Surface(shape = RoundedCornerShape(10.dp), color = if (picked == OrderPick.Bench(p.id)) MaterialTheme.colorScheme.secondary.copy(alpha = 0.22f) else MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
                        FielderRow(
                            order = null,
                            position = p.position,
                            player = p,
                            fitnessAt = p.position,
                            onPosition = { pick(OrderPick.Bench(p.id)) },
                            onName = { pick(OrderPick.Bench(p.id)) },
                            onInfo = { open(p.id) },
                            hint = benchHint(p),
                            detail = detail,
                        )
                    }
                }
            }
            if (bench.isEmpty()) item(key = "bench:none") { Muted("控えの野手がいません", Modifier.padding(8.dp)) }
            if (pitcherBench.isNotEmpty()) {
                item(key = "head:bench:pitcher") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.weight(1f)) { Caption("控え・投手（二刀流で野手の枠に）") }
                        if (allPitchers || shownPitchers.size < pitcherBench.size) {
                            TextButton(onClick = { allPitchers = !allPitchers }) {
                                Text(if (allPitchers) "守れる投手だけ" else "全員を出す（ほか${pitcherBench.size - shownPitchers.size}人）")
                            }
                        }
                    }
                }
                items(shownPitchers, key = { "bench:${it.id}" }) { p ->
                    Surface(shape = RoundedCornerShape(10.dp), color = if (picked == OrderPick.Bench(p.id)) MaterialTheme.colorScheme.secondary.copy(alpha = 0.22f) else MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
                        FielderRow(
                            order = null,
                            position = p.position,
                            player = p,
                            // ⚠ 投手の本職（投手）の適性は意味が無い。守るなら一番合う位置で
                            fitnessAt = p.bestFieldPosition() ?: "right",
                            onPosition = { pick(OrderPick.Bench(p.id)) },
                            onName = { pick(OrderPick.Bench(p.id)) },
                            onInfo = { open(p.id) },
                            hint = benchHint(p),
                            detail = detail,
                        )
                    }
                }
            }
        }
        // スタメンを選んでいる間は、控えを画面の下に固定して出す（いしだ 2026-11-13: 控えを探すのに下までスクロールが要った）。
        // その位置の適性の高い順（同じなら疲れの少ない順）。押すと交代。投手は守れる人（適性 SUBSTITUTE_MIN_FITNESS 以上）だけ
        if (pickedStarter != null) {
            val at = pickedStarter.position
            val subs = remember(bench, pitcherBench, at) {
                (bench + pitcherBench.filter { it.fitness(at) >= SUBSTITUTE_MIN_FITNESS }).candidatesFor(at)
            }
            Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shadowElevation = 8.dp, modifier = Modifier.fillMaxWidth().testTag("bench-dock")) {
                Column {
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("控えと交代（${positionLabel(at)}の適性順）", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    }
                    if (subs.isEmpty()) {
                        Muted("この位置を守れる控えがいません", Modifier.padding(16.dp))
                    } else {
                        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 230.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            items(subs, key = { "dock:${it.id}" }) { p ->
                                Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
                                    FielderRow(
                                        order = null,
                                        position = p.position,
                                        player = p,
                                        // 「適」は交代して守る位置での適性
                                        fitnessAt = at,
                                        onPosition = { pick(OrderPick.Bench(p.id)) },
                                        onName = { pick(OrderPick.Bench(p.id)) },
                                        onInfo = { open(p.id) },
                                        detail = false,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun benchOf(view: LeagueView, draft: PlanDraft): List<Player> =
    view.roster.filter { p -> !p.isPitcher && p.isActive && draft.slots.none { it.playerId == p.id } }

/** 控えの投手（野手の枠にも入れられる。二刀流。Web 版 benchPitchers と同じ） */
private fun pitcherBenchOf(view: LeagueView, draft: PlanDraft): List<Player> =
    view.roster.filter { p -> p.isPitcher && p.isActive && draft.slots.none { it.playerId == p.id } }

/** 投手が野手の枠に入るとしたら一番合う守備位置（Web 版 bestFieldPosition と同じ） */
private fun Player.bestFieldPosition(): String? = FIELD_POSITIONS.maxByOrNull { fitness(it) }

private class OrderNote(val position: String, val text: String, val action: String, val pick: OrderPick, val color: androidx.compose.ui.graphics.Color? = null)

/** 「気になる所」: 試合の日に休養に入る選手と、適性の低い守備（押すと直すためのシートを開く） */
@Composable
private fun orderNotes(draft: PlanDraft, players: Map<Long, Player>, bench: List<Player>): List<OrderNote> {
    val notes = mutableListOf<OrderNote>()
    draft.slots.forEachIndexed { index, slot ->
        val p = players[slot.playerId]
        if (p == null) {
            notes += OrderNote(slot.position, "${positionLabel(slot.position)}が空いています（選手が抜けました）。控えと交代して埋めてください", "交代", OrderPick.Starter(index), MaterialTheme.colorScheme.error)
            return@forEachIndexed
        }
        val fatigue = p.fatigue ?: 0
        if (fatigue >= FIELDER_REST_FATIGUE) {
            // サーバー（server/dailyLineup.mjs）と同じ条件: 控えはその位置の適性60以上、かつ疲労40未満
            val canRest = bench.any { it.fitness(slot.position) >= SUBSTITUTE_MIN_FITNESS && (it.fatigue ?: 0) < SUBSTITUTE_FRESH_FATIGUE }
            notes += OrderNote(
                slot.position,
                if (canRest) "${p.name} 疲労$fatigue。試合の日は控えと入れ替わって休みます"
                else "${p.name} 疲労$fatigue。${positionLabel(slot.position)}を守れる控えが居ないので休めません",
                "交代",
                OrderPick.Starter(index),
                MaterialTheme.colorScheme.error,
            )
        }
        val fit = p.fitness(slot.position)
        if (fit < SUBSTITUTE_MIN_FITNESS) {
            notes += OrderNote(slot.position, "${p.name} ${positionLabel(slot.position)}の適性$fit。守備で失点しやすい", "守備", OrderPick.Starter(index), MaterialTheme.colorScheme.error)
        }
    }
    return notes
}

/**
 * 選んでいる行と入れ替えたときに、**誰が**どこをどの適性で守るか（⇄ は守備の入れ替え、交代は控えとの交代）。
 * ⚠ 以前は名前の右に札と数字だけを詰めていて、どちらの選手の数字か分からなかった（いしだ 2026-11-13）
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SwapHint(label: String, moves: List<Triple<String, String, Int>>) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.secondary, modifier = Modifier.align(Alignment.CenterVertically))
        moves.forEach { (name, pos, fit) ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("$name →", style = MaterialTheme.typography.bodySmall, maxLines = 1)
                PosBadge(pos, filled = false, small = true)
                Text("$fit", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = fitnessColor(fit))
            }
        }
    }
}

// ------------------------------------------------------------------ 投手起用

/**
 * 先発ローテと救援の役割を1本の並びで出し、長押しでつかんで別の場所へ落とすと持ち場が変わる
 * （ローテの中＝順番、救援の見出し・救援の投手の上＝その役割、ローテへ＝先発に入る）。
 * 細かい型（ゲームメーカー・完投型など）は投手を押して選ぶ。
 * 野手も投手で起用できる（二刀流）。最後の「野手を投手で起用する」から加え、役割のシートで外す。
 */
@Composable
private fun PitchingEditor(
    view: LeagueView,
    draft: PlanDraft,
    players: Map<Long, Player>,
    nextId: Long?,
    edit: Edit,
    /** 押して1回で終わる編集（ドラッグの1手にまとめない） */
    clickEdit: Edit,
    onDragStart: () -> Unit,
    open: (Long) -> Unit,
    onSheet: (PlanSheet) -> Unit,
) {
    val haptic = LocalHapticFeedback.current
    val listState = rememberLazyListState()
    val reorder = rememberReorderableLazyListState(listState) { from, to ->
        val id = (from.key as? String)?.removePrefix("p:")?.toLongOrNull() ?: return@rememberReorderableLazyListState
        val target = to.key as? String ?: return@rememberReorderableLazyListState
        edit { d -> d.withPitching(dropPitcher(d.pitching, id, target)) }
        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    }
    PitchingList(view, draft, players, nextId, reorder, listState, onDragStart, open, onSheet) { p ->
        clickEdit { it.withPitching(it.pitching.addToStaff(p)) }
        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
    }
}

/** 投手 id を target（別の投手 p:… ／役割の見出し role:… ／ローテの見出し head:rot）へ落としたときの持ち場 */
private fun dropPitcher(state: jp.icenorth.baseball.shared.PitchingState, id: Long, target: String): jp.icenorth.baseball.shared.PitchingState {
        val inRotation = id in state.starters
        return when {
            target.startsWith("p:") -> {
                val other = target.removePrefix("p:").toLongOrNull() ?: return state
                val at = state.starters.indexOf(other)
                when {
                    at >= 0 && inRotation -> state.moveStarter(state.starters.indexOf(id), at)
                    at >= 0 -> if (state.starters.size < MAX_STARTERS) state.setRole(id, "auto_s", at) else state
                    else -> state.roles[other]?.let { role -> if (state.roles[id] != role) state.setRole(id, role) else state } ?: state
                }
            }
            target.startsWith("role:") -> state.setRole(id, target.removePrefix("role:"))
            target == "head:rot" -> if (inRotation) state.moveStarter(state.starters.indexOf(id), 0) else if (state.starters.size < MAX_STARTERS) state.setRole(id, "auto_s", 0) else state
            else -> state
        }
}

@Composable
private fun PitchingList(
    view: LeagueView,
    draft: PlanDraft,
    players: Map<Long, Player>,
    nextId: Long?,
    reorder: sh.calvin.reorderable.ReorderableLazyListState,
    listState: androidx.compose.foundation.lazy.LazyListState,
    onDragStart: () -> Unit,
    open: (Long) -> Unit,
    onSheet: (PlanSheet) -> Unit,
    onAdd: (Player) -> Unit,
) {
    val haptic = LocalHapticFeedback.current
    val state = draft.pitching
    // 投手起用に加えていない野手（ふだんは畳む。野手は多い）
    var fieldersOpen by rememberSaveable { mutableStateOf(false) }
    val candidates = state.staffCandidates(view.roster)
    val relievers = RELIEF_ORDER.map { role -> role to state.roles.filter { (id, r) -> r == role && id !in state.starters }.keys.mapNotNull { players[it] } }
    LazyColumn(
        state = listState,
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        item(key = "head:rot") {
            ReorderableItem(reorder, key = "head:rot") {
                Row(verticalAlignment = Alignment.Bottom) {
                    Box(Modifier.weight(1f)) { Caption("先発ローテーション（${state.starters.size}/${MAX_STARTERS}人）") }
                    InfoButton("投手起用", pitchingHelp())
                }
            }
        }
        items(state.starters, key = { "p:$it" }) { id ->
            val index = state.starters.indexOf(id)
            ReorderableItem(reorder, key = "p:$id") { dragging ->
                PitcherCard(dragging, Modifier.longPressDraggableHandle(onDragStarted = { onDragStart(); haptic.performHapticFeedback(HapticFeedbackType.LongPress) })) {
                    PitcherRow("${index + 1}", players[id], state.roles[id], starter = true, nextId == id, onRole = { onSheet(PlanSheet.Role(id)) }, onInfo = { open(id) })
                }
            }
        }
        relievers.forEach { (role, list) ->
            item(key = "role:$role") {
                ReorderableItem(reorder, key = "role:$role") {
                    // ⚠ 0人の役割も見出しは残す（ここへ落とすとその役割になる）。人数を添え、0人は薄くする
                    //    （以前は0人の見出しも同じ濃さで並び、誰かいるように見えた）
                    val empty = list.isEmpty()
                    // 0人の役割は間を詰める（空の見出しが4つ5つ並ぶと、投手の行が画面の外へ押し出されていた）
                    Row(Modifier.padding(top = if (empty) 2.dp else 10.dp, start = 4.dp), verticalAlignment = Alignment.Bottom) {
                        Text(
                            RELIEF_ROLES[role] ?: role,
                            style = if (empty) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge,
                            fontWeight = if (empty) FontWeight.Normal else FontWeight.Bold,
                            color = if (empty) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                        )
                        Text(if (empty) "  なし" else "  ${list.size}人", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            items(list, key = { "p:${it.id}" }) { p ->
                ReorderableItem(reorder, key = "p:${p.id}") { dragging ->
                    PitcherCard(dragging, Modifier.longPressDraggableHandle(onDragStarted = { onDragStart(); haptic.performHapticFeedback(HapticFeedbackType.LongPress) })) {
                        // ⚠ 救援は役割の札を出さない（すぐ上の見出しと同じ印が二重に並んでいた）
                        PitcherRow("", p, null, starter = false, next = false, onRole = { onSheet(PlanSheet.Role(p.id)) }, onInfo = { open(p.id) })
                    }
                }
            }
        }
        if (candidates.isNotEmpty()) {
            item(key = "head:fielders") {
                Column(Modifier.padding(top = 10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.weight(1f)) { Caption("野手を投手で起用する（二刀流・${candidates.size}人）") }
                        TextButton(onClick = { fieldersOpen = !fieldersOpen }) { Text(if (fieldersOpen) "畳む" else "出す") }
                    }
                    Muted("加えると救援の「おまかせ」で入ります。役割は押して選び直せます。加えていない野手は投げません", Modifier.padding(horizontal = 4.dp))
                }
            }
            if (fieldersOpen) {
                items(candidates, key = { "add:${it.id}" }) { p ->
                    Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.weight(1f)) {
                                PitcherRow("", p, null, starter = false, next = false, onRole = { open(p.id) }, onInfo = { open(p.id) }, draggable = false)
                            }
                            TextButton(onClick = { onAdd(p) }) { Text("加える") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PitcherCard(dragging: Boolean, handle: Modifier, content: @Composable () -> Unit) {
    val elevation by animateDpAsState(if (dragging) 8.dp else 0.dp, label = "lift")
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = if (dragging) MaterialTheme.colorScheme.surfaceContainerHighest else MaterialTheme.colorScheme.surfaceContainer,
        shadowElevation = elevation,
        modifier = Modifier.fillMaxWidth().then(handle),
    ) { content() }
}

/** @param role 札に出す役割（先発の型）。救援は見出しに出ているので null */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PitcherRow(order: String, player: Player?, role: String?, starter: Boolean, next: Boolean, onRole: () -> Unit, onInfo: () -> Unit, draggable: Boolean = true) {
    Row(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (order.isNotEmpty()) Text(order, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.width(24.dp))
        Column(Modifier.weight(1f).clickable(onClick = onRole)) {
            // ⚠ 札は折り返す（名前が長い・札が3つ並ぶと、1行に収まらず右の札が切れていた）
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("${conditionIcon(player?.condition)} ${player?.name ?: "?"}", fontWeight = FontWeight.SemiBold, modifier = Modifier.align(Alignment.CenterVertically))
                val tag = Modifier.align(Alignment.CenterVertically)
                if (role != null) Box(tag) { Tag(roleLabel(role), MaterialTheme.colorScheme.primary) }
                // 野手登録の選手（二刀流）。本職の守備位置も出す
                if (player != null && !player.isPitcher) Box(tag) { Tag("野手・${positionLabel(player.position)}") }
                val fatigue = player?.fatigue ?: 0
                if (starter && fatigue >= STARTER_SKIP_FATIGUE) Box(tag) { Tag("飛ばす") }
                if (!starter && fatigue >= RELIEF_REST_FATIGUE) Box(tag) { Tag("休養") }
                if (next) Box(tag) { Tag("次の先発") }
            }
            // 能力（速 制 ス 回転・変化球）と今季成績を両方（野手の行と同じく切り替えずに全部出す。いしだ 2026-11-13）
            player?.let { p ->
                PitcherAbilityRow(p)
                PitcherStatsRow(p)
            }
        }
        // 疲労は野手の行と同じく、名前の右端の決まった場所に（先発は飛ばす線、救援は休養の線で赤）
        FatigueBadge(player?.fatigue, restAt = if (starter) STARTER_SKIP_FATIGUE else RELIEF_REST_FATIGUE)
        IconButton(onClick = onInfo, modifier = Modifier.size(32.dp)) { Text("ⓘ", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (draggable) Icon(Icons.Filled.Menu, contentDescription = "長押しで並べ替え", tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun RoleSheet(draft: PlanDraft, id: Long, player: Player?, onRemove: () -> Unit, onPick: (String) -> Unit) {
    val state = draft.pitching
    val current = state.roles[id]
    val starter = id in state.starters
    Column(Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("${player?.name ?: ""} の役割", style = MaterialTheme.typography.titleMedium)
        Caption(if (starter) "先発の型" else "先発に入れる（${state.starters.size}/${MAX_STARTERS}人）")
        STARTER_ORDER.forEach { role ->
            val enabled = starter || state.starters.size < MAX_STARTERS
            RoleOption(STARTER_ROLES[role] ?: role, ROLE_HINT[role], role == current, enabled) { onPick(role) }
        }
        Caption(if (starter) "救援に回す" + if (state.starters.size <= 1) "（先発が1人なので回せません）" else "" else "救援の役割")
        RELIEF_ORDER.forEach { role ->
            val enabled = !starter || state.starters.size > 1
            RoleOption(RELIEF_ROLES[role] ?: role, ROLE_HINT[role], role == current, enabled) { onPick(role) }
        }
        // 加えた野手（二刀流）は投手起用から外せる。⚠ 最後の1人の先発は外せない
        if (player != null && !player.isPitcher) {
            val canRemove = !starter || state.starters.size > 1
            Caption("野手（二刀流）")
            RoleOption("投手起用から外す", if (canRemove) "野手だけで出る" else "先発が1人なので外せません", false, canRemove, onRemove)
        }
    }
}

@Composable
private fun RoleOption(label: String, hint: String?, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (selected) "●" else "○", color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, modifier = Modifier.width(24.dp))
        Text(label, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal, color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline, modifier = Modifier.weight(1f))
        hint?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

// ------------------------------------------------------------------ 方針・采配

@Composable
private fun TacticsEditor(view: LeagueView, draft: PlanDraft, edit: Edit) {
    // 下は少しだけ空ける（TIPS の印は面の切り替えの右に出すので、行には重ならない）
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // 指導者に任せているときは、ここで変えると「意見を聞く」に戻ることを先に知らせる（PC と同じ）
        if (view.staff?.mode("tactics")?.effective == "delegate")
            Muted("試合中の采配は指導者に任せています（「AI判断の中身」のとおりに動きます）。ここで変えて保存すると、任せ方は「意見を聞く」に戻ります。")
        Section("方針") {
            STRATEGY_FIELDS.forEach { f ->
                Text(f.label, style = MaterialTheme.typography.labelLarge)
                ChoiceRow(f.options.map { it.key to it.label }, draft.strategy[f.key]) { v -> edit { it.withStrategy(f.key, v) } }
                // 選んだ方針の効き目（能力の増減と効き方。Web 版と同じ文）
                STRATEGY_EFFECTS["${f.key}.${draft.strategy[f.key] ?: f.default}"]?.let { Muted(it) }
                StaffActual(view, "strategy", f.key)
            }
        }
        Section("自動采配", trailing = { InfoButton("自動采配", listOf("試合中の作戦と継投の決め方です。AI判断のままでも試合は進みます。", "「AI判断の中身」は、指導者が「AI判断」に入れている内容と、決めた人です（保存した設定に対して）。")) }) {
            TACTIC_FIELDS.forEach { f ->
                Text(f.label, style = MaterialTheme.typography.labelLarge)
                ChoiceRow(f.options.map { it.key to it.label }, draft.tactics[f.key]) { v -> edit { it.withTactic(f.key, v) } }
                StaffActual(view, "tactics", f.key)
            }
        }
    }
}

/** スタメンの説明（画面には出さず ⓘ に詰める。いしだ指定） */
private val ORDER_HELP = listOf(
    "長押しでドラッグすると打順を並べ替えます。",
    "選手（守備の札か名前）を押して選び、ほかのスタメンを押すと守備位置を入れ替え、控えを押すと交代します。控えから選んでスタメンを押しても交代です。選んでいる間は、各行の名前の下に「入れ替えたら誰がどこをどの適性で守るか」が出ます。",
    "行はふだん名前と今季成績の2段です。右上の「成績のみ」を押すと能力（ミ パ 眼 走｜守 肩）の段も出ます（端末に覚えます）。成績の段の右端は、ほかに守れる位置の適性です。",
    "守備の札の下の「適」は、守っている位置での適性です（${SUBSTITUTE_MIN_FITNESS}未満は赤、90以上は緑）。",
    "試合の日に疲労${FIELDER_REST_FATIGUE}以上の野手は、その位置の適性${SUBSTITUTE_MIN_FITNESS}以上・疲労${SUBSTITUTE_FRESH_FATIGUE}未満の控えが居れば、その日だけ入れ替わって休みます。",
    "疲労は41以上で黄（成長が鈍り始める）、${FIELDER_REST_FATIGUE}以上で赤です。",
)

/** 投手起用の説明（役割の目安も、行には出さずここに） */
private fun pitchingHelp(): List<String> = listOf(
    "長押しでドラッグするとローテの順番を並べ替えます。救援の役割の見出しへ落とすと持ち場が変わります。行を押すと先発の型・救援の役割を選べます。",
    "疲労${STARTER_SKIP_FATIGUE}以上の先発は順番を飛ばし、疲労${RELIEF_REST_FATIGUE}以上の救援は休ませます。守護神は1人まで。",
    "先発の型: " + STARTER_ORDER.joinToString("、") { "${STARTER_ROLES[it] ?: it}＝${ROLE_HINT[it].orEmpty()}" },
    "救援の役割: " + RELIEF_ORDER.joinToString("、") { "${RELIEF_ROLES[it] ?: it}＝${ROLE_HINT[it].orEmpty()}" },
)
