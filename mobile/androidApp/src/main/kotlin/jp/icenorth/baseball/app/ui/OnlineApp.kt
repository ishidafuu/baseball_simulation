package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import jp.icenorth.baseball.shared.situationTips
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.vector.ImageVector
import jp.icenorth.baseball.app.AppViewModel
import jp.icenorth.baseball.shared.Commands
import jp.icenorth.baseball.shared.CAMP_ROUNDS
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.int
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.bool
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.teamLabel
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

enum class Tab(val label: String, val icon: ImageVector) {
    Home("ホーム", Icons.Filled.Home),
    Games("試合", Icons.Filled.DateRange),
    Players("選手", Icons.Filled.Person),
    Plan("編成", Icons.Filled.List),
    Procedures("手続き", Icons.Filled.Edit),
}

@Composable
fun OnlineApp(model: AppViewModel) {
    val snackbar = remember { SnackbarHostState() }
    // 失敗とお知らせは画面下に出す（ログイン画面では画面内に出す）
    LaunchedEffect(model.message) {
        model.message?.let { snackbar.showSnackbar(it); model.message = null }
    }
    LaunchedEffect(model.error, model.auth) {
        if (model.auth != null) model.error?.let { snackbar.showSnackbar(it); model.error = null }
    }
    if (model.auth == null) {
        LoginScreen(model)
        if (model.busy) BusyOverlay(model.busyLabel.ifEmpty { "ログイン中…" })
        return
    }
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    var renaming by remember { mutableStateOf(false) }
    var showTips by rememberSaveable { mutableStateOf(false) }
    val raw = model.raw
    // 画面を開いている間は、ときどき読み直す（届いたトレードの提案や進行に気づけるように）。
    // アプリに戻ってきたときもすぐ読む。裏に回っている間は読まない
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                model.reload(quiet = true)
                delay(AUTO_RELOAD_MS)
            }
        }
    }
    // 自分の番の手続き・返事待ちのトレードがあれば「手続き」に印
    val pending = raw != null && (
        raw["pendingPack"].obj() != null ||
            (raw["phase"].obj() != null && raw.at("phase", "submission", "ready").bool() != true &&
                (raw.at("phase", "kind").str() != "camp" || (raw.at("phase", "camp", "rounds").int() ?: 0) < (raw.at("phase", "camp", "total").int() ?: CAMP_ROUNDS))) ||
            raw.at("trades").list().any { it.at("myTurn").bool() == true }
        )
    // 参加前（リーグが無い・まだ参加していない）はホームだけ
    val joined = model.view?.teamName != null
    Box(Modifier.fillMaxSize()) {
        if (!joined) {
            // ⚠ 参加前もお知らせ・失敗を出す場所を置く（無いと参加の失敗が見えず、知らせも消えない）
            Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
                Column(Modifier.padding(padding).consumeWindowInsets(padding)) {
                    HomeScreen(model, onOpenLineup = {}, onOpenProcedures = {}, onRename = {})
                }
            }
            if (model.busy) BusyOverlay(model.busyLabel)
            return@Box
        }
        // ⚠ 中身の余白（padding）は使い切った印を付ける（consumeWindowInsets）。付けないと各画面の
        //    statusBarsPadding がもう一度ステータスバーぶん空け、上に二重の隙間ができる
        Scaffold(
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                NavigationBar {
                    Tab.entries.forEach { item ->
                        NavigationBarItem(
                            modifier = Modifier.testTag("tab-${item.name}"),
                            selected = tab == item,
                            onClick = { tab = item },
                            icon = {
                                if (item == Tab.Procedures && pending) {
                                    BadgedBox(badge = { Badge() }) { Icon(item.icon, contentDescription = null) }
                                } else {
                                    Icon(item.icon, contentDescription = null)
                                }
                            },
                            label = { Text(item.label) },
                        )
                    }
                }
            },
        ) { padding ->
            // 今のスタメン・ローテに当てはまるTIPS（保存済みの編成で見る＝実際に起きること）
            val view = model.view
            val situations = remember(view?.roster, view?.lineup) { situationTips(view?.roster.orEmpty(), view?.lineup) }
            // 届いた提案のうち、まだ知らせていないもの。トレードを開いたら知らせ終えたことにする
            val onTrades = tab == Tab.Procedures && model.procTrade
            val tradeKeys = tradeNoticeKeys(raw)
            LaunchedEffect(onTrades, tradeKeys) { if (onTrades) model.markTradesSeen(tradeKeys) }
            val notice = if (onTrades || view == null) null else tradeNoticeText(view, raw, model.seenTrades)
            Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
                Column {
                    when (tab) {
                        Tab.Home -> HomeScreen(model, onOpenLineup = { tab = Tab.Plan }, onOpenProcedures = { tab = Tab.Procedures; model.procTrade = tradesOnly(raw) }, onRename = { renaming = true }, onOpenGames = { tab = Tab.Games }, onOpenTips = { showTips = true })
                        Tab.Games -> GamesScreen(model)
                        Tab.Players -> PlayersScreen(model)
                        Tab.Plan -> PlanScreen(model)
                        Tab.Procedures -> ProceduresScreen(model, onRename = { renaming = true })
                    }
                }
                // ⚠ 枠は取らず左下の角に重ねる。ホームと編成だけ（当てはまらなければ出ない）
                //    右下だと編成の行の「並べ替え」つまみに重なる。左下は打順の数字なので触る物が無い
                if (tab == Tab.Home || tab == Tab.Plan) {
                    SituationTipsBadge(
                        situations,
                        seen = model.seenSituationTips,
                        onRead = model::markSituationTipsSeen,
                        onOpenAll = { showTips = true },
                        modifier = Modifier.align(Alignment.BottomStart).padding(12.dp),
                    )
                }
                // ⚠ 届いた提案は、どのタブにいても上に帯で知らせる（「手続き」の小さな印だけでは気づきにくかった）
                notice?.let { text ->
                    TradeNotice(
                        text,
                        onOpen = { tab = Tab.Procedures; model.procTrade = true; model.tradeDraft = null },
                        onDismiss = { model.markTradesSeen(tradeKeys) },
                        modifier = Modifier.align(Alignment.TopCenter).padding(8.dp),
                    )
                }
            }
        }
        model.openPlayer?.let { PlayerSheet(model, it) }
        if (showTips) TipsScreen { showTips = false }
        if (renaming) RenameDialog(model) { renaming = false }
        // ⚠ 保存・提出の間は画面全体を塞ぐ（いちばん上に重ねる）
        if (model.busy) BusyOverlay(model.busyLabel)
    }
}

/** 球団名とプレイヤー名（順位表には「球団名（あなたの名前）」と出る） */
@Composable
fun RenameDialog(model: AppViewModel, close: () -> Unit) {
    val view = model.view ?: return
    val me = model.raw?.at("members").list().firstOrNull { it.at("teamName").str() == view.teamName }
    var teamName by remember { mutableStateOf(me?.at("displayName").str() ?: view.teamLabel(view.teamName.orEmpty())) }
    var playerName by remember { mutableStateOf(me?.at("label").str().orEmpty()) }
    AlertDialog(
        onDismissRequest = close,
        title = { Text("球団名・名前を変える") },
        text = {
            Column {
                Muted("順位表には「球団名（あなたの名前）」と出ます。いつでも変えられます。")
                OutlinedTextField(teamName, { teamName = it.take(24) }, label = { Text("球団名") }, singleLine = true)
                OutlinedTextField(playerName, { playerName = it.take(24) }, label = { Text("あなたの名前") }, singleLine = true)
            }
        },
        confirmButton = {
            TextButton(
                enabled = teamName.isNotBlank() && !model.busy,
                onClick = {
                    model.command(
                        "profile",
                        Commands.profile(teamName, playerName),
                        done = "名前を保存しました",
                    ) { close() }
                },
            ) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = close) { Text("閉じる") } },
    )
}

/** 画面を開いている間に読み直す間隔（届いた提案に気づくため。変わっていなければサーバーは「変わりなし」だけ返す） */
private const val AUTO_RELOAD_MS = 60_000L

/** 自分の番の手続きは無く、届いた提案だけがある（ホームのお知らせから、トレードの側を直接開く） */
private fun tradesOnly(raw: kotlinx.serialization.json.JsonObject?): Boolean =
    raw != null && raw["pendingPack"].obj() == null && raw["phase"].obj() == null &&
        raw.at("trades").list().any { it.at("myTurn").bool() == true }
