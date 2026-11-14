package jp.icenorth.baseball.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import jp.icenorth.baseball.app.AppViewModel
import jp.icenorth.baseball.shared.AWAY_DAYS
import jp.icenorth.baseball.shared.CHALLENGE_NOTE_MAX
import jp.icenorth.baseball.shared.Commands
import jp.icenorth.baseball.shared.EXHIBITIONS_PER_DAY
import jp.icenorth.baseball.shared.Exhibition
import jp.icenorth.baseball.shared.LeagueView
import jp.icenorth.baseball.shared.OnlineJson
import jp.icenorth.baseball.shared.OwnGame
import jp.icenorth.baseball.shared.STARTER_LOCK_TURNS
import jp.icenorth.baseball.shared.ScheduledGame
import jp.icenorth.baseball.shared.ScoringPlay
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.int
import jp.icenorth.baseball.shared.lastSeenLabel
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.long
import jp.icenorth.baseball.shared.scoringLine
import jp.icenorth.baseball.shared.sinceLabel
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.teamLabel
import jp.icenorth.baseball.shared.teamShort
import jp.icenorth.baseball.shared.turnOfDate
import kotlinx.coroutines.delay
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement

// ============================================================
// 人どうしの関わりの画面（アプリ）。PC の `src/online/SocialPages.jsx` と同じ中身・同じ文。
//   - 留守中のまとめ（ホームの上）とお知らせの一覧
//   - 速報再生（見ていない自球団の試合を、回ごとに点が入っていく形で見せる）
//   - 得点経過（試合の詳細・練習試合の結果）
//   - 練習試合・予告先発（手続きタブの面）
// ⚠ 説明は画面に並べず「ⓘ」に詰める（アプリは狭い。いしだ指定）
// ============================================================

private fun isoMillis(iso: String?): Long? = iso?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }

/** 留守中のまとめ（前に開いたときから何が起きたか）。閉じるまで出す */
@Composable
fun AwayCard(model: AppViewModel, onOpenInbox: () -> Unit) {
    val away = model.away ?: return
    Section(
        "前回（${sinceLabel(away.at)}）から",
        modifier = Modifier.testTag("away-summary"),
        trailing = { TextButton(onClick = model::dismissAway) { Text("閉じる") } },
    ) {
        away.lines.forEach { Text("・$it", style = MaterialTheme.typography.bodyMedium) }
        if (model.view?.inbox.orEmpty().isNotEmpty()) {
            TextButton(onClick = onOpenInbox) { Text("お知らせを見る") }
        }
    }
}

/** あなたへのお知らせ（新しい順。文はサーバーが作る） */
@Composable
fun InboxDialog(view: LeagueView, onClose: () -> Unit) {
    AlertDialog(
        onDismissRequest = onClose,
        confirmButton = { TextButton(onClick = onClose) { Text("閉じる") } },
        title = { Text("あなたへのお知らせ") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (view.inbox.isEmpty()) Text("まだありません。トレードの返事・練習試合・予告先発の回避などをここに残します。")
                view.inbox.forEach { n ->
                    Column {
                        isoMillis(n.at)?.let { Muted(sinceLabel(it)) }
                        Text(n.text, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        },
    )
}

/** 得点経過（「7回裏 那覇 佐藤 2ランホームラン（3-2）」） */
@Composable
fun ScoringList(view: LeagueView, plays: List<ScoringPlay>?, away: String, home: String, title: String? = "得点経過") {
    plays ?: return
    Section(title) {
        if (plays.isEmpty()) Muted("両チーム無得点でした。")
        plays.forEach { p ->
            Text(scoringLine(p, view.teamShort(away), view.teamShort(home)), fontSize = 13.sp)
        }
    }
}

/** 試合の詳細の生の形から得点経過を読む（記録の無い古い試合は null） */
fun scoringOf(element: JsonElement?): List<ScoringPlay>? =
    element?.let { runCatching { OnlineJson.decodeFromJsonElement(ListSerializer(ScoringPlay.serializer()), it) }.getOrNull() }

/** 速報再生で使う試合の鍵（年度ごとに id が振り直されるので年度も入れる） */
private fun quickKey(view: LeagueView, g: OwnGame) = "${view.year}:${g.id}"

/**
 * 速報が届いています（まだ見ていない自球団の最新の試合）。結果は書かない（押して見るまで伏せる）。
 * ⚠ 見たら直近の試合すべてに印を付ける（たまっていた試合をひとつずつ出さない）
 */
@Composable
fun QuickReplayCard(model: AppViewModel, view: LeagueView) {
    val team = view.teamName ?: return
    val latest = view.recentGames.lastOrNull { it.lineScore != null && it.homeScore != null } ?: return
    val seen = model.quickSeen.orEmpty()
    if (quickKey(view, latest) in seen) return
    var playing by remember { mutableStateOf(false) }
    val markAll = { model.markQuickSeen(view.recentGames.map { quickKey(view, it) }.toSet()) }
    val opponent = if (latest.home == team) latest.away else latest.home
    val unseen = view.recentGames.count { it.lineScore != null && quickKey(view, it) !in seen }
    Section("速報", modifier = Modifier.testTag("quick-replay")) {
        Text(
            "${latest.date?.let { "${it.month}/${it.day} " } ?: ""}${view.teamShort(opponent)}戦の結果が届いています" +
                if (unseen > 1) "（ほか${unseen - 1}試合）" else "",
            style = MaterialTheme.typography.bodyMedium,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { playing = true }) { Text("速報で見る") }
            TextButton(onClick = markAll) { Text("あとで見ない") }
        }
    }
    if (playing) QuickReplayDialog(view, latest) { playing = false; markAll() }
}

/**
 * 速報再生。表・裏の順に1つずつ点を出していき、点が入った回は得点経過も出す。
 * ⚠ 試合を作り直さない（ビューの回ごとの得点と得点経過を見せる順を変えるだけ）
 */
@Composable
private fun QuickReplayDialog(view: LeagueView, game: OwnGame, onClose: () -> Unit) {
    val away = game.lineScore?.away.orEmpty()
    val home = game.lineScore?.home.orEmpty()
    // 表・裏を1つと数える（後攻が裏をやらなかった回は数えない）
    val halves = away.size + home.size
    var step by remember { mutableIntStateOf(0) }
    LaunchedEffect(game.id) {
        delay(600)
        while (step < halves) {
            step += 1
            delay(HALF_INNING_MS)
        }
    }
    val shownAway = away.take((step + 1) / 2)
    val shownHome = home.take(step / 2)
    val done = step >= halves
    val walkOff = home.size == away.size && (game.homeScore ?: 0) > (game.awayScore ?: 0)
    val plays = game.scoring.orEmpty().filter { (it.inning - 1) * 2 + (if (it.half == "top") 0 else 1) < step }
    AlertDialog(
        onDismissRequest = onClose,
        confirmButton = { TextButton(onClick = onClose) { Text("閉じる") } },
        dismissButton = { if (!done) TextButton(onClick = { step = halves }) { Text("最後まで") } },
        title = { Text("速報 ${view.teamShort(game.away)} 対 ${view.teamShort(game.home)}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(view.teamShort(game.away), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), textAlign = TextAlign.End)
                    Text("  ${shownAway.sum()} - ${shownHome.sum()}  ", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text(view.teamShort(game.home), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                }
                QuickBoard(view, game, shownAway, shownHome, walkOff && done)
                Text(
                    when {
                        done -> "試合終了"
                        step == 0 -> "プレイボール"
                        else -> "${(step + 1) / 2}回${if (step % 2 == 1) "表" else "裏"}"
                    },
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.secondary,
                )
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    plays.forEach { Text(scoringLine(it, view.teamShort(game.away), view.teamShort(game.home)), fontSize = 13.sp) }
                    AnimatedVisibility(done) {
                        val d = game.decisions
                        Muted(
                            listOfNotNull(
                                d?.winningPitcher?.name?.let { "勝 $it" },
                                d?.losingPitcher?.name?.let { "敗 $it" },
                                d?.savePitcher?.name?.let { "S $it" },
                            ).joinToString("  "),
                            Modifier.padding(top = 6.dp),
                        )
                    }
                }
            }
        },
    )
}

/** 速報のスコアボード（まだの回は空け、点の入った回だけ色を付ける） */
@Composable
private fun QuickBoard(view: LeagueView, game: OwnGame, away: List<Int>, home: List<Int>, walkOff: Boolean) {
    val full = game.lineScore ?: return
    val innings = maxOf(9, full.away.size, full.home.size)
    val (top, bottom) = lineScoreCells(away, home, walkOff)
    // 後攻がやらなかった裏（x）は、表が全部出てから出す
    val showX = away.size == full.away.size && home.size == full.home.size
    val cell = Modifier.width(20.dp)
    @Composable
    fun line(name: String, cells: List<String>, values: List<Int>, total: String, head: Boolean) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(name, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Clip, modifier = Modifier.width(44.dp))
            (0 until innings).forEach { i ->
                val text = cells.getOrNull(i).orEmpty().let { if (it == "x" && !showX) "" else it }
                val scored = !head && (values.getOrNull(i) ?: 0) > 0
                Text(
                    text,
                    fontSize = if (head) 11.sp else 13.sp,
                    fontWeight = if (scored) FontWeight.Bold else FontWeight.Normal,
                    color = when {
                        head -> MaterialTheme.colorScheme.onSurfaceVariant
                        scored -> MaterialTheme.colorScheme.secondary
                        else -> MaterialTheme.colorScheme.onSurface
                    },
                    textAlign = TextAlign.Center,
                    modifier = cell,
                )
            }
            Text(total, fontSize = if (head) 11.sp else 14.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.End, modifier = Modifier.width(26.dp))
        }
    }
    Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
        line("", (1..innings).map { "$it" }, emptyList(), "計", head = true)
        line(view.teamShort(game.away), top, away, "${away.sum()}", head = false)
        line(view.teamShort(game.home), bottom, home, "${home.sum()}", head = false)
    }
}

/** 速報再生で表・裏を1つ進める間（ミリ秒） */
private const val HALF_INNING_MS = 650L

/** 練習試合（人の球団どうしで1試合。成績・疲労・順位には入らない）。手続きタブの面 */
@Composable
fun ExhibitionScreen(model: AppViewModel, view: LeagueView) {
    val team = view.teamName ?: return
    val list = view.exhibitions
    val incoming = list.filter { it.status == "offered" && !it.mine }
    val outgoing = list.filter { it.status == "offered" && it.mine }
    val played = list.filter { it.status == "played" && it.result != null }
    val others = view.members.filter { it.teamName != null && it.teamName != team }
    var note by rememberSaveable { mutableStateOf("") }
    var shown by remember { mutableStateOf<Exhibition?>(null) }
    val now = System.currentTimeMillis()
    ProcScroll(Modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("練習試合", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            InfoButton(
                "練習試合",
                listOf(
                    "人の球団どうしで1試合だけ行います。1部と2部に分かれていても当たれます。",
                    "成績・疲労・順位には入りません。いまのスタメンと投手起用で戦います。",
                    "同じ相手とは1日${EXHIBITIONS_PER_DAY}試合まで。申し込みは相手が受けたその場で試合をします。",
                    "申し込みは年度が替わると取り下げられます。",
                ),
            )
        }
        if (incoming.isNotEmpty()) Section("届いた申し込み") {
            incoming.forEach { e ->
                Text("${view.teamLabel(e.fromTeam)}から" + (e.note?.takeIf { it.isNotEmpty() }?.let { "「$it」" } ?: "申し込みが届いています"))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = !model.busy, onClick = {
                        model.command("challengeRespond", Commands.challengeRespond(e.id, "accept"), label = "試合中…", done = "練習試合が終わりました（結果は下に）")
                    }) { Text("受けて試合をする") }
                    OutlinedButton(enabled = !model.busy, onClick = {
                        model.command("challengeRespond", Commands.challengeRespond(e.id, "decline"), done = "見送りました")
                    }) { Text("見送る") }
                }
            }
        }
        Section("申し込む") {
            if (others.isEmpty()) Muted("ほかに人の球団がまだありません。")
            else OutlinedTextField(
                note,
                { note = it.replace('\n', ' ').take(CHALLENGE_NOTE_MAX) },
                label = { Text("ひとこと（なくても送れます）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            others.forEach { m ->
                val name = m.teamName.orEmpty()
                val open = list.any { it.status == "offered" && (it.fromTeam == name || it.toTeam == name) }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(view.teamLabel(name), fontWeight = FontWeight.Bold)
                        Muted(
                            listOfNotNull(
                                m.label?.ifBlank { null } ?: "プレイヤー",
                                if (m.away) "おるすばん中" else lastSeenLabel(m.lastSeenDay, now).ifEmpty { null },
                            ).joinToString("・"),
                        )
                    }
                    OutlinedButton(enabled = !model.busy && !open, onClick = {
                        model.command("challenge", Commands.challenge(name, note), done = "申し込みました") { note = "" }
                    }) { Text(if (open) "申し込み中" else "申し込む") }
                }
            }
            outgoing.forEach { e ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Muted("${view.teamLabel(e.toTeam)}の返事を待っています", Modifier.weight(1f))
                    TextButton(enabled = !model.busy, onClick = {
                        model.command("challengeRespond", Commands.challengeRespond(e.id, "withdraw"), done = "取り下げました")
                    }) { Text("取り下げる") }
                }
            }
        }
        Section("結果") {
            if (played.isEmpty()) Muted("まだ練習試合はありません。")
            played.forEach { e ->
                val r = e.result
                Row(Modifier.fillMaxWidth().clickable { shown = e }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Muted(isoMillis(e.playedAt)?.let(::sinceLabel).orEmpty(), Modifier.width(80.dp))
                    Text(
                        "${view.teamShort(r.at("away").str().orEmpty())} ${r.at("awayScore").int() ?: "-"} - ${r.at("homeScore").int() ?: "-"} ${view.teamShort(r.at("home").str().orEmpty())}",
                        modifier = Modifier.weight(1f),
                    )
                    Text("詳細 ›", color = MaterialTheme.colorScheme.primary, fontSize = 13.sp)
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
    shown?.let { e -> ExhibitionDialog(view, e) { shown = null } }
}

/** 練習試合の結果（得点経過と勝敗の投手） */
@Composable
private fun ExhibitionDialog(view: LeagueView, e: Exhibition, onClose: () -> Unit) {
    val r = e.result ?: return
    val away = r.at("away").str().orEmpty()
    val home = r.at("home").str().orEmpty()
    AlertDialog(
        onDismissRequest = onClose,
        confirmButton = { TextButton(onClick = onClose) { Text("閉じる") } },
        title = { Text("練習試合 ${view.teamShort(away)} ${r.at("awayScore").int() ?: "-"} - ${r.at("homeScore").int() ?: "-"} ${view.teamShort(home)}") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Muted(
                    listOfNotNull(
                        r.at("decisions", "winningPitcher", "name").str()?.let { "勝 $it" },
                        r.at("decisions", "losingPitcher", "name").str()?.let { "敗 $it" },
                        r.at("decisions", "savePitcher", "name").str()?.let { "S $it" },
                    ).joinToString("  "),
                )
                ScoringList(view, scoringOf(r["scoring"]), away, home)
                // 打撃の主な成績（安打・本塁打・打点のあった人）
                listOf(away, home).forEach { team ->
                    val hitters = r.at("teams", team).list().filter { (it.at("batting", "hits").int() ?: 0) + (it.at("batting", "rbis").int() ?: 0) > 0 }
                    if (hitters.isNotEmpty()) {
                        Text(view.teamShort(team), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        hitters.forEach { p ->
                            val b = p.at("batting")
                            Text(
                                "${p.at("name").str().orEmpty()}  ${b.at("atBats").int() ?: 0}打数${b.at("hits").int() ?: 0}安打" +
                                    listOfNotNull(
                                        b.at("homeruns").int()?.takeIf { it > 0 }?.let { "${it}本塁打" },
                                        b.at("rbis").int()?.takeIf { it > 0 }?.let { "${it}打点" },
                                    ).joinToString("") { " $it" },
                                fontSize = 12.sp,
                            )
                        }
                    }
                }
            }
        },
    )
}

/** 予告先発（この先の試合の先発をローテから指名する）。手続きタブの面 */
@Composable
fun StarterPicksScreen(model: AppViewModel, view: LeagueView) {
    val plan = view.starterPlan
    val team = view.teamName ?: return
    val rotation = view.lineup?.get("starters").list().mapNotNull { it.long() }.mapNotNull { id -> view.roster.firstOrNull { it.id == id } }
    ProcScroll(Modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("予告先発", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            InfoButton(
                "予告先発",
                listOf(
                    "この先の試合の先発を、先発ローテの中から選べます。",
                    "試合の${plan?.lockTurns ?: STARTER_LOCK_TURNS}ターン前に確定し、相手にも「予告先発」として見えます。確定までは相手に見えません。",
                    "指名した投手が投げると、ローテはその投手の次から回ります。",
                    "試合の日に疲れていたら回避して、いつもの順で投げます（お知らせが届きます）。",
                    "${AWAY_DAYS}日来ていない間（おるすばん）と、投手起用を指導者に任せている間は選べません。",
                ),
            )
        }
        if (plan == null) {
            Muted("サーバーが新しくなると使えます。")
            return@ProcScroll
        }
        if (!plan.canPick) Muted("投手起用を指導者に任せている間は、先発はローテの順に回ります（編成の「指導者」で「自分で」か「意見を聞く」にすると選べます）。")
        if (plan.games.isEmpty()) Muted("予定されている試合はありません。")
        Section {
            plan.games.forEachIndexed { i, g ->
                if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                StarterPickRow(model, view, plan.canPick, rotation, g, g.id?.let { plan.picks["$it"] }, team)
            }
        }
    }
}

@Composable
private fun StarterPickRow(
    model: AppViewModel,
    view: LeagueView,
    canPick: Boolean,
    rotation: List<jp.icenorth.baseball.shared.Player>,
    g: ScheduledGame,
    pick: Long?,
    team: String,
) {
    val home = g.home == team
    val own = if (home) g.homeStarterInfo else g.awayStarterInfo
    val foe = if (home) g.awayStarterInfo else g.homeStarterInfo
    val ownMark = if (home) g.homeStarterMark else g.awayStarterMark
    val foeMark = if (home) g.awayStarterMark else g.homeStarterMark
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "${turnOfDate(g.date, view.seasonTurns)?.let { "第${it}ターン" } ?: ""} ${if (home) "対" else "＠"}${view.teamShort(if (home) g.away else g.home)}",
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            Muted("相手 ${foe?.name ?: "未定"}")
            if (foeMark == "fixed") Tag("予告") else Muted("（予定）")
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("自軍 ${own?.name ?: "未定"}", modifier = Modifier.weight(1f))
            when {
                g.starterLocked -> if (ownMark != null) Tag("確定") else Muted("確定")
                !canPick -> Muted("ローテの順")
                else -> Box {
                    TextButton(enabled = !model.busy, onClick = { open = true }) { Text(if (pick == null) "指名する" else "指名を変える") }
                    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                        val id = g.id ?: return@DropdownMenu
                        DropdownMenuItem(
                            text = { Text("ローテの順に戻す", fontWeight = if (pick == null) FontWeight.Bold else FontWeight.Normal) },
                            onClick = {
                                open = false
                                if (pick != null) model.command("starterPick", Commands.starterPick(id, null), done = "指名を外しました")
                            },
                        )
                        rotation.forEach { p ->
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        p.name + if ((p.fatigue ?: 0) >= 40) "（疲れ）" else "",
                                        fontWeight = if (pick == p.id) FontWeight.Bold else FontWeight.Normal,
                                    )
                                },
                                onClick = {
                                    open = false
                                    if (pick != p.id) model.command("starterPick", Commands.starterPick(id, p.id), done = "${p.name}を指名しました")
                                },
                            )
                        }
                    }
                }
            }
        }
        if (ownMark == "pick" && !g.starterLocked) Muted("あなたの指名（確定までは相手に見えません）")
    }
}
