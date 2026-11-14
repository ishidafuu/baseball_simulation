package jp.icenorth.baseball.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.runtime.CompositionLocalProvider
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
import jp.icenorth.baseball.shared.tradeNoticeKeys
import jp.icenorth.baseball.shared.noticeCount
import jp.icenorth.baseball.shared.pendingProcedure
import jp.icenorth.baseball.shared.waitingTradeCount
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.vector.ImageVector
import jp.icenorth.baseball.app.AppViewModel
import jp.icenorth.baseball.shared.PlanDraft
import jp.icenorth.baseball.shared.Commands
import jp.icenorth.baseball.shared.at
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
    // ⚠ 鍵は文言ではなく通し番号（同じ文言が続いても2回目を出す）
    LaunchedEffect(model.messageSerial) {
        model.message?.let { snackbar.showSnackbar(it); model.message = null }
    }
    LaunchedEffect(model.errorSerial, model.auth) {
        if (model.auth != null) model.error?.let { snackbar.showSnackbar(it); model.error = null }
    }
    if (model.auth == null) {
        LoginScreen(model)
        if (model.busy) BusyOverlay(model.busyLabel.ifEmpty { "ログイン中…" })
        return
    }
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    LaunchedEffect(model.tabRequest) {
        model.tabRequest?.let { name -> Tab.entries.firstOrNull { it.name == name }?.let { tab = it } }
        model.tabRequest = null
    }
    // 試合タブで開いている区分（試合結果・順位表…）。順位表から選手タブへ飛んだあと、戻るで順位表に戻すためここに置く
    var gamesSection by rememberSaveable { mutableStateOf("results") }
    // 順位表の球団を押して選手タブへ来たか（戻るで試合タブの順位表へ戻す。ホームへではなく）
    var fromStandings by rememberSaveable { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var showTips by rememberSaveable { mutableStateOf(false) }
    val raw = model.raw
    // 今のスタメン・ローテに当てはまるTIPS（保存済みの編成で見る＝実際に起きること）。左下の印・TIPSの一覧・メニューの数に使う
    val situations = remember(model.view?.roster, model.view?.lineup) { situationTips(model.view?.roster.orEmpty(), model.view?.lineup) }
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
    // 自分の番の手続き・返事待ちのトレードの数を「手続き」に出す（Web 版の左メニューと同じ数え方。`Notices.kt`）
    val procedure = pendingProcedure(raw)
    val count = noticeCount(raw)
    // 参加前（リーグが無い・まだ参加していない）はホームだけ
    val joined = model.view?.teamName != null
    // ⚠ 戻るはまずホームへ（以前はどのタブからでもアプリが閉じた）。ホームでは従来どおり閉じる。
    //    画面の中の戻る（試合の詳細・トレードなど）は後から登録されるので、そちらが先に効く
    BackHandler(enabled = joined && tab != Tab.Home) { tab = if (tab == Tab.Players && fromStandings) Tab.Games else Tab.Home }
    // ⚠ 選手タブを離れたら、見ている球団を自球団に戻す（以前は順位表から開いた他球団のまま残り、
    //    次に選手タブを開いても他球団の表だった）
    // 前に開いていたタブ。⚠ 端末を回すと画面を作り直して下の LaunchedEffect がもう一度走るので、
    //    **タブが本当に替わったとき**だけを見分けるのに使う
    var lastTab by rememberSaveable { mutableStateOf(tab) }
    LaunchedEffect(tab) {
        // ⚠ 他球団の選手を読んでいる間にタブを移ったら、読み終わっても開かない（以前は移った先でシートが開いた）。
        //    ⚠ 回しただけ（同じタブ）ではやめない。以前は読み込み中に端末を回すと開かなかった
        if (tab != lastTab) {
            model.dropOpeningPlayer()
            lastTab = tab
        }
        if (tab != Tab.Players) {
            model.playersTeam = null
            fromStandings = false
        }
        // 編成の面の合図は、編成タブで使われなかったら（編成がまだ無い間など）捨てる
        if (tab != Tab.Plan) model.planFaceRequest = null
    }
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
                val planDirty = model.plan?.present?.let { d -> model.view?.let { v -> v.lineup != null && !d.sameEdit(PlanDraft.from(d.base, v.roster)) } } == true
                NavigationBar {
                    Tab.entries.forEach { item ->
                        NavigationBarItem(
                            modifier = Modifier.testTag("tab-${item.name}"),
                            selected = tab == item,
                            onClick = { tab = item },
                            icon = {
                                if (item == Tab.Procedures && count > 0) {
                                    BadgedBox(badge = { Badge { Text("$count") } }) { Icon(item.icon, contentDescription = "未完了${count}件") }
                                } else if (item == Tab.Plan && planDirty) {
                                    // 保存していない編成があることを、ほかのタブにいても分かるように点で知らせる
                                    BadgedBox(badge = { Badge() }) { Icon(item.icon, contentDescription = "保存していない変更あり") }
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
            val view = model.view
            // 届いた提案のうち、まだ知らせていないもの。トレードを開いたら知らせ終えたことにする
            // （新しい提案を作っている間は届いた提案の一覧が見えないので、知らせ終えたことにしない）
            val onTrades = tab == Tab.Procedures && model.procTrade && model.tradeDraft == null
            val tradeKeys = tradeNoticeKeys(raw)
            LaunchedEffect(onTrades, tradeKeys) { if (onTrades) model.markTradesSeen(tradeKeys) }
            val notice = if (onTrades || view == null) null else tradeNoticeText(view, raw, model.seenTrades)
            // ⚠ 自分が決める手続きは、その画面を開いていない間ずっと上に帯で出す（閉じられない。済んだら消える）。
            //    初期メンバー選択・人員整理・キャンプは「手続き」のタブの中なので、うっかり飛ばしやすかった
            val onProcedure = tab == Tab.Procedures && model.procFace == "Current"
            Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
                Column {
                    // ⚠ 帯は重ねず上に並べる（重ねると、ホームの右上のメニューのような画面の上の操作を塞ぐ）。
                    //    帯がステータスバーぶん空けたら、下の画面には空けさせない（二重の隙間になる）
                    // ⚠ ホームでは帯を出さない（紙面の「お知らせ」に同じ文があり、上下に2つ並んでいた）
                    val showProcedure = procedure != null && !onProcedure && tab != Tab.Home
                    notice?.let { text ->
                        TradeNotice(
                            text,
                            onOpen = {
                                tab = Tab.Procedures
                                model.procTrade = true
                                // 作りかけの案は捨てずに脇へ置く（一覧の「作りかけの提案を続ける」で戻す）
                                model.tradeDraft?.let { model.parkedTradeDraft = it }
                                model.tradeDraft = null
                            },
                            onDismiss = { model.markTradesSeen(tradeKeys) },
                            modifier = Modifier.statusBarsPadding().padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                    }
                    if (showProcedure) {
                        ProcedureNotice(
                            procedure!!,
                            onOpen = { tab = Tab.Procedures; model.procTrade = false },
                            modifier = (if (notice == null) Modifier.statusBarsPadding() else Modifier).padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                    }
                    Column(if (showProcedure || notice != null) Modifier.consumeWindowInsets(WindowInsets.statusBars) else Modifier) {
                    when (tab) {
                        // ⚠ 手続き中は「次の進行まで」を「停止中」ではなく「手続きの決定待ち」にする（Web 版 nextAdvanceText と同じ）
                        Tab.Home -> CompositionLocalProvider(LocalAwaitingDecision provides (view?.phase != null)) {
                            HomeScreen(model, onOpenLineup = { tab = Tab.Plan }, onOpenProcedures = { tab = Tab.Procedures; model.procTrade = tradesOnly(raw) }, onRename = { renaming = true }, onOpenGames = { gamesSection = "results"; tab = Tab.Games }, onOpenTips = { showTips = true }, tipsNow = situations.size)
                        }
                        // ⚠ 引っ張って更新はホームだけだった。試合・選手・手続きでも同じ操作で読み直せるようにする
                        Tab.Games -> Refreshable(model) {
                            GamesScreen(model, gamesSection, { gamesSection = it }, onOpenTeam = { model.showTeamPlayers(it); fromStandings = true; tab = Tab.Players })
                        }
                        Tab.Players -> Refreshable(model) { PlayersScreen(model) }
                        // ⚠ 編成では TIPS の印を面の切り替えの右に置く（行が3行になり、左下に重ねると打順と「適」が隠れた）
                        Tab.Plan -> PlanScreen(model) {
                            SituationTipsBadge(
                                situations,
                                seen = model.seenSituationTips,
                                onRead = model::markSituationTipsSeen,
                                onOpenAll = { showTips = true },
                                modifier = Modifier.padding(start = 2.dp, end = 8.dp).size(30.dp),
                            )
                        }
                        Tab.Procedures -> Refreshable(model) {
                            ProceduresScreen(model, onHome = { tab = Tab.Home }, onOpenStaff = { model.planFaceRequest = "Staff"; tab = Tab.Plan })
                        }
                    }
                    }
                }
                model.openingPlayer?.let { name ->
                    LoadingPill("${name}を読み込んでいます…", Modifier.align(Alignment.BottomCenter).padding(16.dp))
                }
                // ⚠ 枠は取らず左下の角に重ねる。ホームだけ（当てはまらなければ出ない）。
                //    編成では選手の行に重なる（左下は打順の数字と「適」、右下は並べ替えのつまみ）ので、面の切り替えの右に出す
                if (tab == Tab.Home) {
                    SituationTipsBadge(
                        situations,
                        seen = model.seenSituationTips,
                        onRead = model::markSituationTipsSeen,
                        onOpenAll = { showTips = true },
                        modifier = Modifier.align(Alignment.BottomStart).padding(12.dp),
                    )
                }
            }
        }
        model.openPlayer?.let { PlayerSheet(model, it) }
        if (showTips) TipsScreen(situations, onRead = model::markSituationTipsSeen) { showTips = false }
        if (renaming) RenameDialog(model) { renaming = false }
        // ⚠ 保存・提出の間は画面全体を塞ぐ（いちばん上に重ねる）
        if (model.busy) BusyOverlay(model.busyLabel)
    }
}

/** 球団名・プレイヤー名・ひとこと（順位表には「球団名（あなたの名前）」と出る。ひとことは紙面とオーナーの一覧に） */
@Composable
fun RenameDialog(model: AppViewModel, close: () -> Unit) {
    val view = model.view ?: return
    val me = model.raw?.at("members").list().firstOrNull { it.at("teamName").str() == view.teamName }
    var teamName by remember { mutableStateOf(me?.at("displayName").str() ?: view.teamLabel(view.teamName.orEmpty())) }
    var playerName by remember { mutableStateOf(me?.at("label").str().orEmpty()) }
    var comment by remember { mutableStateOf(me?.at("comment").str().orEmpty()) }
    AlertDialog(
        onDismissRequest = close,
        title = { Text("球団名・名前・ひとこと") },
        text = {
            Column {
                Muted("順位表には「球団名（あなたの名前）」と出ます。ひとことは全国紙とオーナーの一覧に出ます。いつでも変えられます。")
                OutlinedTextField(teamName, { teamName = it.take(24) }, label = { Text("球団名") }, singleLine = true)
                OutlinedTextField(playerName, { playerName = it.take(24) }, label = { Text("あなたの名前") }, singleLine = true)
                OutlinedTextField(
                    comment,
                    { comment = it.replace('\n', ' ').take(jp.icenorth.baseball.shared.OWNER_COMMENT_MAX) },
                    label = { Text("ひとこと（${comment.length}/${jp.icenorth.baseball.shared.OWNER_COMMENT_MAX}字）") },
                    placeholder = { Text("例: 今年こそ昇格") },
                    singleLine = true,
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = teamName.isNotBlank() && !model.busy,
                onClick = {
                    model.command(
                        "profile",
                        Commands.profile(teamName, playerName, comment),
                        done = "保存しました",
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
    pendingProcedure(raw) == null && waitingTradeCount(raw) > 0

/** 引っ張って最新の状態に読み直す枠（ホームと同じ動き） */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun Refreshable(model: AppViewModel, content: @Composable () -> Unit) {
    androidx.compose.material3.pulltorefresh.PullToRefreshBox(
        isRefreshing = model.refreshing,
        onRefresh = { model.reload(pull = true) },
        modifier = Modifier.fillMaxSize(),
    ) { content() }
}
