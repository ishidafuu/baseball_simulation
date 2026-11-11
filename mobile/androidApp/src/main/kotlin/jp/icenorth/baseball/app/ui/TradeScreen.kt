package jp.icenorth.baseball.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import jp.icenorth.baseball.app.AppViewModel
import jp.icenorth.baseball.shared.Commands
import jp.icenorth.baseball.shared.LeagueView
import jp.icenorth.baseball.shared.OfferOutcome
import jp.icenorth.baseball.shared.ROSTER_LIMIT
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.bool
import jp.icenorth.baseball.shared.dealProblems
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.long
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.overallScore
import jp.icenorth.baseball.shared.pid
import jp.icenorth.baseball.shared.positionLabel
import jp.icenorth.baseball.shared.rosterCounts
import jp.icenorth.baseball.shared.rosterGroup
import jp.icenorth.baseball.shared.rostersAfterTrade
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.teamLabel
import jp.icenorth.baseball.shared.offerOutcome
import jp.icenorth.baseball.shared.tradeIds
import jp.icenorth.baseball.shared.unseenTrades
import kotlinx.serialization.json.JsonObject
import kotlin.math.roundToInt

/**
 * トレード。
 *
 * ⚠ **送る前に必ず確認の段を通す**（いしだ指摘: 選手を選んだ画面にそのまま「提案する」があり、
 *    最終確認なしに相手へ届いた）。CPU球団はその場で答え、受けたら即成立して取り消せないので特に。
 *    新しい提案は「相手 → 選手 → 確認」の3段（[TradeBuilder]）。届いた提案の成立・断るにも確認を出す。
 * ⚠ 名簿が成り立つかはサーバーと同じ規則（rosterShortfall）。最終の判断はサーバー。
 * ⚠ 逆提案は1回だけ。`offer` はいつも提案した側が出す選手（向きを変えない）。
 */
@Composable
fun TradeScreen(model: AppViewModel, raw: JsonObject) {
    val view = model.view ?: return
    model.tradeDraft?.let { draft ->
        TradeBuilder(model, view, raw, draft)
        return
    }
    val trades = raw.at("trades").list().mapNotNull { it.obj() }
    val waiting = trades.filter { it.at("myTurn").bool() == true }
    val sent = trades.filter { it.at("myTurn").bool() != true }
    val (partners, _) = tradePartners(view, raw)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (waiting.isNotEmpty()) {
            Caption("返事が必要な提案（${waiting.size}件）")
            waiting.forEach { TradeCard(model, view, raw, it) }
        }
        model.parkedTradeDraft?.let { parked ->
            OutlinedButton(
                onClick = { model.tradeDraft = parked; model.parkedTradeDraft = null },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (parked.counterOf != null) "作りかけの逆提案を続ける" else "作りかけの提案を続ける") }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = { model.parkedTradeDraft = null; model.tradeDraft = TradeDraft() }, enabled = partners.isNotEmpty(), modifier = Modifier.weight(1f)) {
                Text("＋ 新しくトレードを考える")
            }
            InfoButton(
                "トレード",
                listOf(
                    "ほかの球団と選手を交換します。相手・選手を選び、確認の画面で内容を見てから送ります。",
                    "CPU球団はその場で答えます（受ける・逆提案・断る）。受けたらすぐ成立し、取り消せません。",
                    "参加者の球団は、相手が受けた時点で成立します。返事が来るまでは取り下げられます。",
                    "解雇は土曜の「契約更改」、獲得は土曜の「トライアウト」で行います。",
                ),
            )
        }
        if (partners.isEmpty()) Muted("トレードの相手になる球団がありません。")
        else if (trades.isEmpty() && model.parkedTradeDraft == null) Muted("いま進んでいる提案はありません。届いた提案と、返事を待っている提案がここに並びます。")
        if (sent.isNotEmpty()) {
            Caption("相手の返事待ち")
            sent.forEach { TradeCard(model, view, raw, it) }
        }
    }
}

/** 作りかけのトレード案。タブを移っても消えないよう [AppViewModel.tradeDraft] に置く */
data class TradeDraft(
    val partner: String? = null,
    val give: Set<Long> = emptySet(),
    val get: Set<Long> = emptySet(),
    val step: TradeStep = TradeStep.Partner,
    /** 逆提案のときの元の提案の id（このときは相手が決まっているので「選手」の段から始める） */
    val counterOf: String? = null,
    /** 逆提案する元の提案が自分の出したものか（サーバーへの返事に要る） */
    val counterMine: Boolean = false,
)

enum class TradeStep(val label: String) { Partner("相手"), Players("選手"), Confirm("確認") }

/** まだ知らせていない届いた提案の知らせ文。無ければ null */
fun tradeNoticeText(view: LeagueView, raw: JsonObject?, seen: Set<String>): String? {
    val fresh = unseenTrades(raw, seen)
    if (fresh.isEmpty()) return null
    if (fresh.size > 1) return "トレードの提案が${fresh.size}件届いています"
    val t = fresh.single()
    val mine = t.at("mine").bool() == true
    val partner = view.teamLabel((if (mine) t.at("toTeam") else t.at("fromTeam")).str().orEmpty())
    return if (mine) "${partner}から逆提案が届きました" else "${partner}からトレードの提案が届きました"
}

/** 届いた提案の知らせ（画面の上に重ねる帯）。押すとトレードを開く */
@Composable
fun TradeNotice(text: String, onOpen: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        shape = RoundedCornerShape(12.dp),
        shadowElevation = 6.dp,
        modifier = modifier.fillMaxWidth().clickable(onClick = onOpen).testTag("trade-notice"),
    ) {
        Row(Modifier.padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Notifications, contentDescription = null, modifier = Modifier.size(20.dp))
            Text(text, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f).padding(start = 10.dp))
            TextButton(onClick = onOpen) { Text("見る") }
            IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, contentDescription = "閉じる") }
        }
    }
}

/** 相手にできる球団（参加者の球団を先に）と、参加者の球団の集合 */
private fun tradePartners(view: LeagueView, raw: JsonObject): Pair<List<String>, Set<String>> {
    val humans = raw.at("members").list().mapNotNull { it.at("teamName").str() }.toSet()
    val others = raw.at("teamNames").list().mapNotNull { it.str() }.filter { it != view.teamName }
    return (others.filter { it in humans } + others.filter { it !in humans }) to humans
}

/** 相手の名簿の読み込み（名簿・失敗の文・読み直す） */
private data class PartnerRoster(val roster: List<JsonObject>?, val error: String?, val retry: () -> Unit)

/** 相手の名簿（その場で読む。12球団ぶんをいつもビューに載せると重い） */
@Composable
private fun partnerRoster(model: AppViewModel, partner: String?): PartnerRoster {
    val revision = model.view?.revision
    // ⚠ 版が変わっても**読み直す間は前の名簿を出したまま**にする（相手を変えたときだけ空にする）。
    //    版はほかの参加者の保存や試合の進行でも変わる。空にすると、選んでいる途中や確認の段で
    //    「読み込み中…」に戻り、送るボタンが押せなくなる。最終の判断はサーバーがする
    var roster by remember(partner) { mutableStateOf<List<JsonObject>?>(null) }
    var failure by remember(partner) { mutableStateOf<String?>(null) }
    // 「読み直す」を押した回数（増えると読み直す。⚠ 読み込みに失敗しても押し直せるように。ほかの画面と同じ）
    var attempt by remember(partner) { mutableStateOf(0) }
    LaunchedEffect(partner, revision, attempt) {
        if (partner == null) return@LaunchedEffect
        try {
            roster = model.read("team", mapOf("team" to partner)).at("roster").list().mapNotNull { it.obj() }
            failure = null
        } catch (e: Exception) {
            // ⚠ 前の読み込みが取り消されたとき（ページを連打した・画面を離れた）は失敗として出さない
            if (e is kotlinx.coroutines.CancellationException) throw e
            failure = model.describe(e)
        }
    }
    return PartnerRoster(roster, failure) { attempt++ }
}

private fun namesOf(ids: Set<Long>, vararg rosters: List<JsonObject>?): String {
    if (ids.isEmpty()) return "なし"
    val byId = rosters.flatMap { it.orEmpty() }.associateBy { it.pid }
    return ids.joinToString("、") { id -> byId[id]?.at("name").str() ?: "?" }
}

@Composable
private fun TradeCard(model: AppViewModel, view: LeagueView, raw: JsonObject, trade: JsonObject) {
    val mine = trade.at("mine").bool() == true
    val myTurn = trade.at("myTurn").bool() == true
    val countered = trade.at("countered").bool() == true
    val partner = (if (mine) trade.at("toTeam") else trade.at("fromTeam")).str().orEmpty()
    // ⚠ 自分から見た向きに直す（offer はいつも提案した側が出す選手）
    val giveEntries = (if (mine) trade.at("offer") else trade.at("want")).list().mapNotNull { it.obj() }
    val getEntries = (if (mine) trade.at("want") else trade.at("offer")).list().mapNotNull { it.obj() }
    val (theirs, theirError, retryTheirs) = partnerRoster(model, partner)
    val myRoster = raw.at("roster").list().mapNotNull { it.obj() }
    val stale = (giveEntries + getEntries).any { it.at("gone").bool() == true }
    val give = giveEntries.filter { it.at("gone").bool() != true }.map { it.pid }.toSet()
    val get = getEntries.filter { it.at("gone").bool() != true }.map { it.pid }.toSet()
    val problems = dealProblems(myRoster, theirs, give, get)
    val tradeId = trade.at("id").str().orEmpty()
    // 確かめている返事（accept / reject）。押してすぐには送らない
    // 逆提案などで内容が変わったら、古い内容に対して開いた確認を閉じる。
    var asking by remember(trade) { mutableStateOf<String?>(null) }
    val respond = { action: String ->
        model.command(
            "tradeRespond",
            Commands.tradeRespond(tradeId, action, mine),
            label = "返事を送信中…",
            done = if (action == "accept") "トレードが成立しました" else if (mine) "提案を取り下げました" else "断りました",
        )
    }
    Section(
        when {
            mine && countered -> "${view.teamLabel(partner)} からの逆提案"
            mine -> "${view.teamLabel(partner)} へ提案中"
            else -> "${view.teamLabel(partner)} からの提案"
        },
    ) {
        Text(
            (if (myTurn) "あなたの返事待ち" else "相手の返事待ち") + if (countered) "（逆提案あり）" else "",
            color = if (myTurn) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelLarge,
        )
        DealSide("出す（自球団）", giveEntries, myRoster, model)
        DealSide("もらう（${view.teamLabel(partner)}）", getEntries, theirs.orEmpty(), model)
        theirError?.let { LoadFailed(it, retryTheirs, title = "相手の名簿を読めませんでした") }
        if (theirs != null) AfterCounts(view, partner, myRoster, theirs, give, get)
        if (stale) Text("移籍済みの選手が含まれているため、成立できません。", color = MaterialTheme.colorScheme.error)
        problems.forEach { Text(it, color = MaterialTheme.colorScheme.error) }
        if (myTurn) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { asking = "accept" }, enabled = !stale && problems.isEmpty() && theirs != null) { Text("成立させる") }
                if (trade.at("canCounter").bool() == true) {
                    OutlinedButton(onClick = { model.tradeDraft = TradeDraft(partner, give, get, TradeStep.Players, counterOf = tradeId, counterMine = mine) }) { Text("逆提案") }
                }
                OutlinedButton(onClick = { asking = "reject" }) { Text("断る") }
            }
        } else {
            OutlinedButton(onClick = { asking = "reject" }) { Text(if (mine) "取り下げる" else "断る") }
        }
    }
    asking?.let { action ->
        val accept = action == "accept"
        val verb = if (accept) "成立させる" else if (mine) "取り下げる" else "断る"
        AlertDialog(
            onDismissRequest = { asking = null },
            title = { Text(if (accept) "トレードを成立させますか？" else if (mine) "提案を取り下げますか？" else "提案を断りますか？") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("出す: ${namesOf(give, myRoster)}")
                    Text("もらう: ${namesOf(get, theirs)}")
                    Text(
                        if (accept) "成立すると取り消せません。" else "この提案は消えます。",
                        color = if (accept) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = if (accept) FontWeight.Bold else FontWeight.Normal,
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { asking = null; respond(action) },
                    enabled = !accept || (!stale && myTurn && problems.isEmpty() && theirs != null && theirError == null),
                ) { Text(verb) }
            },
            dismissButton = { TextButton(onClick = { asking = null }) { Text("やめる") } },
        )
    }
}

@Composable
private fun DealSide(title: String, entries: List<JsonObject>, roster: List<JsonObject>, model: AppViewModel) {
    val byId = roster.associateBy { it.pid }
    Text(title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
    if (entries.isEmpty()) Muted("なし")
    entries.forEach { e ->
        val p = byId[e.pid]
        if (p != null) PlayerSummary(p, { model.openPlayer = it }) { Overall(p) }
        else Text("${e.at("name").str().orEmpty()}（${positionLabel(e.at("position").str())}）", color = if (e.at("gone").bool() == true) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun Overall(p: JsonObject) {
    Text("総合${overallScore(p).roundToInt()}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary, fontWeight = FontWeight.Bold)
}

private fun countsText(players: List<JsonObject>): String {
    val c = rosterCounts(players)
    return "${players.size}/${ROSTER_LIMIT}人 投${c["pitcher"]} 捕${c["catcher"]} 内${c["infielder"]} 外${c["outfielder"]}"
}

@Composable
private fun AfterCounts(view: LeagueView, partner: String, mine: List<JsonObject>, theirs: List<JsonObject>, give: Set<Long>, get: Set<Long>) {
    val after = rostersAfterTrade(mine, theirs, give, get)
    Muted("交換後  自球団 ${countsText(after.mine)}")
    Muted("交換後  ${view.teamLabel(partner)} ${countsText(after.theirs)}")
}

private val GROUPS = listOf("pitcher" to "投手", "catcher" to "捕手", "infielder" to "内野手", "outfielder" to "外野手")

/**
 * 新しい提案・逆提案を作る画面。「相手 → 選手 → 確認」の段を進み、**確認の段でだけ送れる**。
 * 戻るボタンは1つ前の段へ（最初の段なら閉じる）。
 */
@Composable
private fun TradeBuilder(model: AppViewModel, view: LeagueView, raw: JsonObject, draft: TradeDraft) {
    val counter = draft.counterOf != null
    val set = { next: TradeDraft -> model.tradeDraft = next }
    val close = { model.tradeDraft = null }
    val back = {
        when (draft.step) {
            TradeStep.Partner -> close()
            TradeStep.Players -> if (counter) close() else set(draft.copy(step = TradeStep.Partner))
            TradeStep.Confirm -> set(draft.copy(step = TradeStep.Players))
        }
    }
    BackHandler(onBack = back)
    val (theirs, theirError, retryTheirs) = partnerRoster(model, draft.partner)
    val myRoster = raw.at("roster").list().mapNotNull { it.obj() }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "戻る") }
            Column(Modifier.weight(1f)) {
                Text(if (counter) "逆提案を作る" else "トレードを考える", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                StepLine(draft.step, counter)
            }
            TextButton(onClick = close) { Text("やめる") }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        val body = Modifier.weight(1f).fillMaxWidth()
        val partner = draft.partner
        if (draft.step == TradeStep.Partner || partner == null) {
            PartnerStep(model, view, raw, draft.partner, body) { picked ->
                // 相手を変えたら、もらう選手は選び直し（出す選手は残す）
                set(draft.copy(partner = picked, get = if (picked == draft.partner) draft.get else emptySet(), step = TradeStep.Players))
            }
        } else if (draft.step == TradeStep.Players) {
            PlayersStep(model, view, raw, draft, partner, myRoster, theirs, theirError, retryTheirs, body, set)
        } else {
            ConfirmStep(model, view, draft, partner, myRoster, theirs, theirError, retryTheirs, body, set)
        }
    }
}

/** 今どの段か（逆提案は相手が決まっているので「相手」の段を出さない） */
@Composable
private fun StepLine(step: TradeStep, counter: Boolean) {
    val steps = TradeStep.entries.filter { !counter || it != TradeStep.Partner }
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        steps.forEachIndexed { i, s ->
            if (i > 0) Muted("›")
            Text(
                "${i + 1} ${s.label}",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = if (s == step) FontWeight.Bold else FontWeight.Normal,
                color = if (s == step) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun PartnerStep(model: AppViewModel, view: LeagueView, raw: JsonObject, current: String?, modifier: Modifier, onPick: (String) -> Unit) {
    val (partners, humans) = tradePartners(view, raw)
    val places = remember(view.standings, view.teamLeagues) {
        standingGroups(view).flatMap { group ->
            group.rows.mapIndexed { i, row -> row.team to "${group.title.removeSuffix(" 順位").removeSuffix("順位")}${i + 1}位 · ${row.wins}勝${row.losses}敗${if (row.draws > 0) "${row.draws}分" else ""}" }
        }.toMap()
    }
    // 各球団の人数（投・捕・内・外）。どこが余っていて、どこが足りないかが、相手を選ぶ手がかりになる。
    // ⚠ 名簿はビューに無いので、球団ごとに読む（版ごとに覚えているので、選手の段で同じ相手を選んでも読み直さない）。
    //    1つの読み込みで順に読む（行ごとに読むと、送って行が消えるたびに読み込みが取り消される）。読めない球団は人数を出さないだけ
    var counts by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    LaunchedEffect(partners, view.revision) {
        partners.forEach { name ->
            try {
                val roster = model.read("team", mapOf("team" to name)).at("roster").list().mapNotNull { it.obj() }
                counts = counts + (name to countsText(roster))
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
            }
        }
    }
    LazyColumn(modifier, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf("参加者の球団" to partners.filter { it in humans }, "CPU球団" to partners.filter { it !in humans }).forEach { (title, names) ->
            if (names.isEmpty()) return@forEach
            item(key = "h-$title") { Caption(title) }
            items(names, key = { it }) { name ->
                Surface(
                    color = if (name == current) MaterialTheme.colorScheme.secondary.copy(alpha = 0.18f) else MaterialTheme.colorScheme.surfaceContainer,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().clickable { onPick(name) },
                ) {
                    Row(Modifier.padding(horizontal = 14.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(view.teamLabel(name), fontWeight = FontWeight.SemiBold)
                            // どんな球団か（部・順位・勝敗）。選ぶ前の手がかり
                            places[name]?.let { Muted(it) }
                            counts[name]?.let { Muted(it) }
                        }
                        Muted("›")
                    }
                }
            }
        }
    }
}

@Composable
private fun PlayersStep(
    model: AppViewModel,
    view: LeagueView,
    raw: JsonObject,
    draft: TradeDraft,
    partner: String,
    myRoster: List<JsonObject>,
    theirs: List<JsonObject>?,
    theirError: String?,
    retryTheirs: () -> Unit,
    modifier: Modifier,
    set: (TradeDraft) -> Unit,
) {
    // まず「もらう」から（欲しい選手を決めてから、釣り合う選手を出すほうが考えやすい）
    var side by rememberSaveable { mutableStateOf("get") }
    var group by rememberSaveable { mutableStateOf("pitcher") }
    val lineupIds = remember(raw) {
        (raw.at("lineup", "battingOrder").list().mapNotNull { it.at("playerId").long() } + raw.at("lineup", "starters").list().mapNotNull { it.long() }).toSet()
    }
    val problems = dealProblems(myRoster, theirs, draft.give, draft.get)
    val giving = side == "give"
    val picked = if (giving) draft.give else draft.get
    val roster = if (giving) myRoster else theirs
    Column(modifier) {
        ChipTabs(
            listOf("get" to "もらう（${view.teamLabel(partner)}）${draft.get.size}人", "give" to "出す（自球団）${draft.give.size}人"),
            side,
            { side = it },
            Modifier.padding(top = 8.dp),
        )
        ChipTabs(
            GROUPS.map { (key, label) ->
                val n = roster.orEmpty().count { rosterGroup(it.at("position").str()) == key && it.pid in picked }
                key to (label + if (n > 0) " $n" else "")
            },
            group,
            { group = it },
        )
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) {
            when {
                !giving && theirError != null -> item { LoadFailed(theirError, retryTheirs, title = "相手の名簿を読めませんでした") }
                roster == null -> item { Muted("読み込み中…") }
                else -> items(
                    roster.filter { rosterGroup(it.at("position").str()) == group }.sortedByDescending { overallScore(it) },
                    key = { it.pid },
                ) { p ->
                    TradeRow(model, p, p.pid in picked, if (giving && p.pid in lineupIds) "スタメン・ローテ" else null) {
                        val id = p.pid
                        if (giving) set(draft.copy(give = if (id in draft.give) draft.give - id else draft.give + id))
                        else set(draft.copy(get = if (id in draft.get) draft.get - id else draft.get + id))
                    }
                }
            }
        }
        // 下の帯: 選んだ選手と、確認へ進むボタン（ここでは送らない）
        Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                PickedLine("出す", namesOf(draft.give, myRoster))
                PickedLine("もらう", namesOf(draft.get, theirs))
                problems.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (draft.give.isNotEmpty() || draft.get.isNotEmpty()) {
                        TextButton(onClick = { set(draft.copy(give = emptySet(), get = emptySet())) }) { Text("選び直す") }
                    }
                    Spacer(Modifier.weight(1f))
                    Button(
                        onClick = { set(draft.copy(step = TradeStep.Confirm)) },
                        enabled = (draft.give.isNotEmpty() || draft.get.isNotEmpty()) && theirs != null && problems.isEmpty(),
                    ) { Text("確認へ") }
                }
            }
        }
    }
}

@Composable
private fun PickedLine(label: String, names: String) {
    Row {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 8.dp).alignByBaseline())
        Text(names, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.alignByBaseline())
    }
}

@Composable
private fun ConfirmStep(
    model: AppViewModel,
    view: LeagueView,
    draft: TradeDraft,
    partner: String,
    myRoster: List<JsonObject>,
    theirs: List<JsonObject>?,
    theirError: String?,
    retryTheirs: () -> Unit,
    modifier: Modifier,
    set: (TradeDraft) -> Unit,
) {
    val humans = model.raw?.at("members").list().mapNotNull { it.at("teamName").str() }.toSet()
    val problems = dealProblems(myRoster, theirs, draft.give, draft.get)
    val counter = draft.counterOf
    val submit = {
        if (counter != null) {
            model.command(
                "tradeRespond",
                Commands.tradeRespond(counter, "counter", draft.counterMine, draft.give, draft.get),
                label = "逆提案を送信中…",
                done = "逆提案を送りました",
            ) { model.tradeDraft = null }
        } else {
            val before = tradeIds(model.raw)
            model.command("tradeOffer", Commands.tradeOffer(partner, draft.give, draft.get), label = "提案を送信中…") {
                model.tradeDraft = null
                val name = view.teamLabel(partner)
                model.message = when (offerOutcome(before, model.raw)) {
                    OfferOutcome.Accepted -> "${name}が受けて、トレードが成立しました"
                    OfferOutcome.Countered -> "${name}から逆提案が届きました。内容を見て返事をしてください"
                    OfferOutcome.Offered -> "提案を送りました。相手の返事を待っています"
                }
            }
        }
    }
    Column(modifier) {
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ConfirmSide("出す（自球団）", draft.give, myRoster, model)
            ConfirmSide("もらう（${view.teamLabel(partner)}）", draft.get, theirs, model)
            theirError?.let { LoadFailed(it, retryTheirs, title = "相手の名簿を読めませんでした") }
            if (theirs != null) Section("交換後の名簿") { AfterCounts(view, partner, myRoster, theirs, draft.give, draft.get) }
            problems.forEach { Text(it, color = MaterialTheme.colorScheme.error) }
        }
        Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // ⚠ 送ったあとどうなるかは、送るボタンの真上に（ここだけは常に出す。取り消せないことがあるため）
                Text(
                    when {
                        counter != null -> "逆提案はこの1回だけです。相手が受けなければ、この提案は消えます。"
                        partner in humans -> "相手が受けた時点で成立します。返事が来るまでは取り下げられます。"
                        else -> "CPU球団はすぐに答えます。受けたらその場で成立し、取り消せません。"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                    color = if (counter == null && partner !in humans) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = { set(draft.copy(step = TradeStep.Players)) }) { Text("選手を選び直す") }
                    Spacer(Modifier.weight(1f))
                    Button(
                        onClick = submit,
                        enabled = (draft.give.isNotEmpty() || draft.get.isNotEmpty()) && theirs != null && problems.isEmpty(),
                    ) { Text(if (counter != null) "逆提案を送る" else "提案を送る") }
                }
            }
        }
    }
}

@Composable
private fun ConfirmSide(title: String, ids: Set<Long>, roster: List<JsonObject>?, model: AppViewModel) {
    val players = roster.orEmpty().filter { it.pid in ids }
    Section(title, trailing = { if (players.isNotEmpty()) Muted("総合 計${players.sumOf { overallScore(it) }.roundToInt()}") }) {
        if (ids.isEmpty()) Muted("なし")
        else if (roster == null) Muted("読み込み中…")
        players.forEach { p -> PlayerSummary(p, { model.openPlayer = it }) { Overall(p) } }
    }
}

@Composable
private fun TradeRow(model: AppViewModel, p: JsonObject, selected: Boolean, tag: String?, onToggle: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(if (selected) MaterialTheme.colorScheme.secondary.copy(alpha = 0.18f) else Color.Transparent, RoundedCornerShape(8.dp))
            .clickable(onClick = onToggle)
            .padding(horizontal = 6.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (selected) "✓" else "", color = MaterialTheme.colorScheme.secondary, fontWeight = FontWeight.Bold, modifier = Modifier.padding(end = 4.dp))
        Box(Modifier.weight(1f)) {
            PlayerSummary(p, { model.openPlayer = it }) {
                Column(horizontalAlignment = Alignment.End) {
                    Overall(p)
                    tag?.let { Tag(it) }
                }
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}
