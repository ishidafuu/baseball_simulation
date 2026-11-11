package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import jp.icenorth.baseball.shared.paperNameIndex
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import jp.icenorth.baseball.app.AppViewModel
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.mutableStateOf
import jp.icenorth.baseball.shared.packWaiting
import jp.icenorth.baseball.shared.CAMP_ROUNDS
import jp.icenorth.baseball.shared.PHASE_LABELS
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.bool
import jp.icenorth.baseball.shared.int
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.str
import kotlinx.serialization.json.JsonObject
import jp.icenorth.baseball.shared.GameResult
import jp.icenorth.baseball.shared.LeagueView
import jp.icenorth.baseball.shared.buildFrontPage
import jp.icenorth.baseball.shared.buildNationalPage
import jp.icenorth.baseball.shared.BackIssue
import jp.icenorth.baseball.shared.TeamChronicle
import jp.icenorth.baseball.shared.TEAM_RECORD_ROWS
import jp.icenorth.baseball.shared.careerRecordLine
import jp.icenorth.baseball.shared.historyLine
import jp.icenorth.baseball.shared.milestoneLine
import jp.icenorth.baseball.shared.retiredHead
import jp.icenorth.baseball.shared.seasonRecordLine
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.teamShort
import jp.icenorth.baseball.shared.backIssueKey
import jp.icenorth.baseball.shared.backIssuesOf
import jp.icenorth.baseball.shared.Player
import jp.icenorth.baseball.shared.OnlineJson
import androidx.compose.material3.FilterChip
import androidx.compose.material3.AlertDialog
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.lazy.items
import jp.icenorth.baseball.shared.appVersionArticle
import jp.icenorth.baseball.shared.APP_DOWNLOAD_URL
import jp.icenorth.baseball.shared.LINK_APP_UPDATE
import androidx.compose.ui.platform.LocalUriHandler
import jp.icenorth.baseball.shared.loadOwnHistory
import jp.icenorth.baseball.shared.OWN_HISTORY_PAGE
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import androidx.compose.runtime.SideEffect
import jp.icenorth.baseball.shared.FrontPage
import jp.icenorth.baseball.shared.GAME_TIPS
import jp.icenorth.baseball.shared.LINK_GAMES
import jp.icenorth.baseball.shared.LINK_LINEUP
import jp.icenorth.baseball.shared.LINK_TIPS
import androidx.compose.material3.HorizontalDivider


@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    model: AppViewModel,
    onOpenLineup: () -> Unit,
    onOpenProcedures: () -> Unit,
    onRename: () -> Unit,
    onOpenGames: () -> Unit = {},
    onOpenTips: () -> Unit = {},
    /** 今のスタメン・ローテに当てはまるTIPSの数（メニューの「ゲームのTIPS」に添える） */
    tipsNow: Int = 0,
) {
    val view = model.view
    PullToRefreshBox(
        isRefreshing = model.refreshing,
        onRefresh = { model.reload(pull = true) },
        modifier = Modifier.fillMaxSize(),
    ) {
        if (view == null) {
            // ⚠ 読めなかったら理由と「読み直す」を出す（以前は「読み込み中…」のまま止まった）
            val failure = model.loadFailure
            Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                if (failure != null) LoadFailed(failure, onRetry = { model.reload(pull = true) }) else Text("読み込み中…")
            }
            return@PullToRefreshBox
        }
        if (view.setupRequired || view.teamName == null) {
            NotJoined(model)
            return@PullToRefreshBox
        }
        val team = view.teamName.orEmpty() // 上で参加前（null）は返している
        // 1面の主役を書くため、自球団の最新の試合の詳細を読む（終わった試合は変わらないので一度読めば使い回す）。
        // 連勝・連敗と対戦成績のため、今季の自球団の試合も読む（ビューには直近の数試合しか無い）
        val last = view.results.lastOrNull { it.home == team || it.away == team }
        var lastGame by remember { mutableStateOf<JsonObject?>(null) }
        var history by remember { mutableStateOf<Pair<List<GameResult>, Boolean>?>(null) }
        // 次の相手の名簿（地元紙の「警戒警報」）。読めなければ記事を出さないだけ
        val next = view.nextGames.firstOrNull { it.home == team || it.away == team }
        val oppName = next?.let { if (it.home == team) it.away else it.home }
        var opponent by remember(oppName) { mutableStateOf<List<Player>?>(null) }
        LaunchedEffect(oppName, view.revision) {
            val name = oppName ?: return@LaunchedEffect
            opponent = runCatching {
                model.read("team", mapOf("team" to name)).at("roster").list().mapNotNull { e ->
                    runCatching { OnlineJson.decodeFromJsonElement(Player.serializer(), e) }.getOrNull()
                }
            }.onFailure { if (it is kotlinx.coroutines.CancellationException) throw it }.getOrNull()
        }
        // ⚠ 読み終わるまで紙面を作り直さない（詳細の無い紙面を出してから差し替えると、見出しが一瞬で変わって見えた）
        var ready by remember(last?.gameId) { mutableStateOf(last?.gameId == null) }
        LaunchedEffect(last?.gameId, view.year) {
            val id = last?.gameId ?: return@LaunchedEffect
            val year = "${view.year ?: ""}"
            // ⚠ 2つは同時に読む（順に読むと待ち時間が足し算になる）
            coroutineScope {
                val game = async {
                    runCatching { model.read("game", mapOf("id" to "$id", "year" to year)) }
                        .onFailure { if (it is kotlinx.coroutines.CancellationException) throw it }
                        .getOrNull()
                }
                val games = async {
                    runCatching {
                        loadOwnHistory(team) { page ->
                            model.read("games", mapOf("year" to year, "page" to "$page", "scope" to "own", "size" to "$OWN_HISTORY_PAGE"))
                        }
                    }
                        .onFailure { if (it is kotlinx.coroutines.CancellationException) throw it }
                        .getOrNull()
                }
                lastGame = game.await()
                history = games.await()
            }
            ready = true
        }
        // TIPS は紙面のコラムに1本（ホームを開くたびに選び直す。いしだの指定「ホームを表示するたびにランダムで1つ」）
        val tip = remember { GAME_TIPS.random() }
        val alerts = pendingAlerts(view, model.raw)
        // 入っているアプリが最新か（いしだの指定: 紙面の記事で知らせる）
        val app = remember(model.latestApp) { appVersionArticle(model.appBuild, model.latestApp) }
        var shown by remember { mutableStateOf<FrontPage?>(null) }
        val built = if (ready) {
            remember(view, model.raw, lastGame, history, tip, alerts, app, opponent) {
                buildFrontPage(
                    view, model.raw, lastGame, alerts,
                    column = FrontPage.Article("コラム", tip.title, tip.body, LINK_TIPS),
                    history = history?.first,
                    historyComplete = history?.second == true,
                    app = app,
                    opponent = opponent,
                )
            }
        } else null
        SideEffect { if (built != null) shown = built }
        val localPage = built ?: shown
        if (localPage == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("紙面を刷っています…") }
            return@PullToRefreshBox
        }
        // 全国紙（リーグ全体を中立に）。題字の下の行は地元紙と同じ
        val national = remember(localPage, view, model.raw) { buildNationalPage(view, model.raw, localPage) }
        val paper = FrontPage.Paper.entries.firstOrNull { it.name == model.homePaper } ?: FrontPage.Paper.Local
        val page = if (paper == FrontPage.Paper.National) national else localPage
        // バックナンバー（その日の両紙の見出しを端末に残す）。球団ごとに分ける（別のアカウントの見出しを混ぜない）
        LaunchedEffect(localPage.headline, national.headline) {
            backIssueKey(view)?.let { key -> model.recordBackIssue(BackIssue(key, localPage.issue, localPage.headline, national.headline, team)) }
        }
        var showBack by remember { mutableStateOf(false) }
        if (showBack) BackNumberDialog(backIssuesOf(model.backIssues, team), localPage.title) { showBack = false }
        var showChronicle by remember { mutableStateOf(false) }
        if (showChronicle) ChronicleDialog(model, team, view.teamShort(team)) { showChronicle = false }
        val style = homeStyleOf(model.homeStyle)
        val uriHandler = LocalUriHandler.current
        val names = remember(model.raw, team, lastGame, opponent, oppName) {
            paperNameIndex(model.raw, team, lastGame, oppName?.let { n -> opponent?.let { n to it } })
        }
        val paperLinks = remember(names) { PaperLinks(names) { ref, name -> model.openPlayerOf(ref.team, ref.id, name) } }
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 72.dp), // 左下の TIPS の印に隠れないよう
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
        ) {
            // ⚠ ホームは記事1枚にまとめる（いしだの指定）。球団名・順位・進行の残り時間・手続きの知らせも紙面の中に置く。
            //    数字の表（順位表・タイトル争い・リーグ便り）は試合タブ
            item(key = "paper") {
                PaperTabs(paper, localPage.title) { model.changeHomePaper(it.name) }
            }
            item(key = "page") {
                // 記事の中の選手名を押すと、その選手の詳細を開く（手元で分かる選手だけ）
                CompositionLocalProvider(LocalPaperLinks provides paperLinks) {
                HomePage(
                    style = style,
                    page = page,
                    nextAdvanceAt = view.nextAdvanceAt,
                    menu = { HomeMenu(model, style, onRename, onOpenTips, tipsNow, onOpenBack = { showBack = true }, onOpenChronicle = { showChronicle = true }) },
                    onLink = { link ->
                        when (link) {
                            LINK_LINEUP -> onOpenLineup()
                            LINK_GAMES -> onOpenGames()
                            LINK_TIPS -> onOpenTips()
                            LINK_APP_UPDATE -> runCatching { uriHandler.openUri(APP_DOWNLOAD_URL) }
                        }
                    },
                    onOpenProcedures = onOpenProcedures,
                )
                }
            }
        }
    }
}

/** 地元紙と全国紙の切り替え（紙面の上に小さく。どの見た目でも同じ） */
@Composable
private fun PaperTabs(paper: FrontPage.Paper, localTitle: String, onChange: (FrontPage.Paper) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FrontPage.Paper.entries.forEach { p ->
            FilterChip(
                selected = p == paper,
                onClick = { onChange(p) },
                label = { Text(if (p == FrontPage.Paper.Local) "地元紙　$localTitle" else "全国紙　NEXT STAGE") },
            )
        }
    }
}

/** 紙面のバックナンバー（新しい日から。両紙の1面の見出し） */
@Composable
private fun BackNumberDialog(issues: List<BackIssue>, localTitle: String, onClose: () -> Unit) {
    AlertDialog(
        onDismissRequest = onClose,
        confirmButton = { TextButton(onClick = onClose) { Text("閉じる") } },
        title = { Text("過去の見出し") },
        text = {
            if (issues.isEmpty()) Text("まだありません。ホームを開くたびに、その日の1面の見出しを残します。")
            else LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(issues.asReversed(), key = { it.key }) { b ->
                    Column {
                        Text("${b.key / 10000}年目 ${b.issue}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("$localTitle：${b.local}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                        Text("NEXT STAGE：${b.national}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        },
    )
}

/**
 * 球団史・記録（年表・歴代記録・引退した選手・節目）。「team」の窓口の chronicle を読む。
 * ⚠ 文と並びは PC の「球団史・記録」（src/online/Chronicle.jsx）と同じにすること
 */
@Composable
private fun ChronicleDialog(model: AppViewModel, team: String, short: String, onClose: () -> Unit) {
    var data by remember { mutableStateOf<TeamChronicle?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(team) {
        runCatching {
            model.read("team", mapOf("team" to team)).at("chronicle").obj()?.let { OnlineJson.decodeFromJsonElement(TeamChronicle.serializer(), it) }
        }.onFailure { if (it is kotlinx.coroutines.CancellationException) throw it }
            .onSuccess { data = it ?: TeamChronicle() }
            .onFailure { failed = true }
    }
    AlertDialog(
        onDismissRequest = onClose,
        confirmButton = { TextButton(onClick = onClose) { Text("閉じる") } },
        title = { Text("${short}の球団史・記録") },
        text = {
            val c = data
            when {
                failed -> Text("読み込めませんでした。少し待ってから開き直してください。")
                c == null -> Text("読み込み中…")
                else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    item { ChronicleHeading("年表") }
                    if (c.seasons.isEmpty()) item { Text("まだ終わったシーズンがありません。1年目を終えると、ここに年ごとの成績が並びます。", style = MaterialTheme.typography.bodySmall) }
                    items(c.seasons, key = { "s${it.year}" }) { s ->
                        Text(s.historyLine(), style = MaterialTheme.typography.bodyMedium)
                    }
                    item { ChronicleHeading("歴代記録") }
                    if (c.records.isEmpty()) item { Text("記録がまだありません。", style = MaterialTheme.typography.bodySmall) }
                    // シーズン最多・球団通算とも上位3人（PC と同じ。以前は1位だけだった）
                    items(c.records, key = { "r${it.stat}" }) { r ->
                        Column {
                            Text(r.label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                            if (r.season.isNotEmpty()) Text("シーズン最多", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            r.season.take(TEAM_RECORD_ROWS).forEachIndexed { i, x -> Text(seasonRecordLine(i + 1, x), style = MaterialTheme.typography.bodySmall) }
                            if (r.career.isNotEmpty()) Text("球団通算", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            r.career.take(TEAM_RECORD_ROWS).forEachIndexed { i, x -> Text(careerRecordLine(i + 1, x), style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                    item { ChronicleHeading("節目の記録") }
                    if (c.milestones.isEmpty()) item { Text("まだありません。通算100安打・シーズン20本塁打などに届くと、ここに残ります。", style = MaterialTheme.typography.bodySmall) }
                    items(c.milestones.withIndex().toList(), key = { "m${it.index}" }) { (_, m) ->
                        Text(milestoneLine(m), style = MaterialTheme.typography.bodySmall)
                    }
                    item { ChronicleHeading("引退した選手") }
                    if (c.retired.isEmpty()) item { Text("この球団から引退した選手はまだいません。", style = MaterialTheme.typography.bodySmall) }
                    items(c.retired.withIndex().toList(), key = { "x${it.index}" }) { (_, r) ->
                        Column {
                            Text(retiredHead(r), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                            Text(listOfNotNull(r.seasons.takeIf { it > 0 }?.let { "在籍${it}年" }, r.line, r.secondCareer?.let { "→ $it" }).joinToString("　"), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        },
    )
}

@Composable
private fun ChronicleHeading(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
}

/** 紙面の右上のメニュー（更新・名前の変更・TIPS・ホームの見た目・ログアウト） */
@Composable
private fun HomeMenu(model: AppViewModel, style: HomeStyle, onRename: () -> Unit, onOpenTips: () -> Unit, tipsNow: Int, onOpenBack: () -> Unit, onOpenChronicle: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    // ⚠ ログアウトは確かめてから（メニューの一番下で押し間違えやすく、戻るにはメールとパスワードを入れ直す）
    var askLogout by remember { mutableStateOf(false) }
    if (askLogout) {
        AlertDialog(
            onDismissRequest = { askLogout = false },
            title = { Text("ログアウトしますか") },
            text = { Text("もう一度使うときは、メールアドレスとパスワードでログインし直します。") },
            confirmButton = { TextButton(onClick = { askLogout = false; model.logout() }) { Text("ログアウト") } },
            dismissButton = { TextButton(onClick = { askLogout = false }) { Text("やめる") } },
        )
    }
    Box {
        IconButton(onClick = { open = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "メニュー") }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("最新に更新") }, onClick = { open = false; model.reload(pull = true) })
            DropdownMenuItem(text = { Text("球団名・名前を変える") }, onClick = { open = false; onRename() })
            // ⚠ 当てはまるTIPSがあれば数を添える（一覧の先頭に、当てはまる人と一緒に出る。左下の印は未読のときだけなので、
            //    読んだあとに「誰が疲れているか」を見直す入口はここ）
            DropdownMenuItem(text = { Text("ゲームのTIPS" + if (tipsNow > 0) "（いま当てはまる${tipsNow}件）" else "") }, onClick = { open = false; onOpenTips() })
            DropdownMenuItem(text = { Text("過去の見出し") }, onClick = { open = false; onOpenBack() })
            DropdownMenuItem(text = { Text("球団史・記録") }, onClick = { open = false; onOpenChronicle() })
            HorizontalDivider()
            Text("ホームの見た目", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
            HomeStyle.entries.forEach { s ->
                DropdownMenuItem(
                    text = { Text((if (s == style) "● " else "○ ") + s.label) },
                    onClick = { open = false; model.changeHomeStyle(s.name) },
                )
            }
            HorizontalDivider()
            DropdownMenuItem(text = { Text("ログアウト") }, onClick = { open = false; askLogout = true })
        }
    }
}

/** 自分の番の手続き・初期メンバー選択・返事待ちのトレード */
private fun pendingAlerts(view: LeagueView, raw: JsonObject?): List<String> = buildList {
    // ⚠ 初期メンバーを待っている間は、リーグの手続きはCPUが決める（`Notices.kt` と同じ決まり）
    if (view.pendingPack != null) {
        // ⚠ 選び終えたら「いつ自分の球団になるか」を出す（Web 版のホームの「開幕待ち」と同じ）
        val waiting = packWaiting(raw)
        add(
            if (waiting != null) "開幕待ち: 「${waiting.packName}」で、${packStartText(waiting.joinsAt, waiting.estimated)}あなたの球団になります"
            else "初期メンバーを選んでください",
        )
    } else view.phase?.let { phase ->
        val due = formatDeadline(phase.deadline ?: view.phaseDeadline)
        val label = phase.kind?.let { PHASE_LABELS[it] } ?: phase.label ?: "手続き"
        val ready = raw?.at("phase", "submission", "ready").bool() == true
        val campDone = phase.kind == "camp" && (raw?.at("phase", "camp", "rounds").int() ?: 0) >= (raw?.at("phase", "camp", "total").int() ?: CAMP_ROUNDS)
        // ⚠ 指導者に任せた手続きはサーバーが決定を待たない（`Notices.kt` の pendingProcedure と同じ決まり）
        val delegated = raw?.at("phase", "delegated").bool() == true
        add(
            when {
                delegated -> "$label: 指導者に任せています"
                campDone -> "$label: 全クール終了（ほかの球団を待っています）"
                ready -> "$label: 決定済み（変更もできます）"
                // ⚠ 名前と「を」の間に空白を入れない（「契約更改 を決めてください」と出ていた。上の帯と同じ書き方）
                else -> "${label}を決めてください" + (due?.let { "（締め切り $it）" } ?: "")
            },
        )
    }
    // ⚠ シーズン後の手続きの合間・開幕待ちも知らせる（いしだ指摘: いまの段階と次に何が来るのかが分からない）
    if (view.pendingPack == null && view.phase == null && raw?.at("stage", "key").str().let { it != null && it != "season" })
        stageHeadText(raw)?.let { add("オフ: $it") }
    val waiting = raw?.at("trades").list().count { it.at("myTurn").bool() == true }
    if (waiting > 0) add("トレードの提案に返事が必要です（${waiting}件）")
}

@Composable
private fun NotJoined(model: AppViewModel) {
    val joinable = model.raw?.at("joinRequired").bool() == true
    Column(
        Modifier.fillMaxSize().statusBarsPadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (joinable) {
            Text("リーグに参加する", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(
                "空いている球団のうち、下の階層で一番弱いものを引き継ぎます。このあと初期メンバーのセットを選び、球団名とプレイヤー名を決めます。",
                textAlign = TextAlign.Center,
            )
            FilledTonalButton(onClick = { model.command("join", JsonObject(emptyMap()), label = "参加しています…", done = "リーグに参加しました") }) { Text("参加する") }
        } else {
            Text("リーグがまだありません", style = MaterialTheme.typography.titleMedium)
            Text("リーグの作成は管理者が Web 版で行います。作成後、下に引っ張ると更新されます。", textAlign = TextAlign.Center)
        }
        TextButton(onClick = model::logout) { Text("別のアカウントでログインし直す") }
    }
}

