package jp.icenorth.baseball.app.ui

import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.launch
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.runtime.rememberCoroutineScope
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
import jp.icenorth.baseball.shared.CpuTradeRule
import jp.icenorth.baseball.shared.OnlineJson
import jp.icenorth.baseball.shared.Player
import jp.icenorth.baseball.shared.TRADE_FILTERS
import jp.icenorth.baseball.shared.TRADE_SLOTS
import jp.icenorth.baseball.shared.TeamUsage
import jp.icenorth.baseball.shared.TradeOdds
import jp.icenorth.baseball.shared.reinforcePoints
import jp.icenorth.baseball.shared.ownSlotScores
import jp.icenorth.baseball.shared.surplusPlayers
import jp.icenorth.baseball.shared.tradeCandidates
import jp.icenorth.baseball.shared.gettingTradeValues
import jp.icenorth.baseball.shared.tradeOdds
import jp.icenorth.baseball.shared.tradeStrengthGap
import jp.icenorth.baseball.shared.tradeOddsBounds
import jp.icenorth.baseball.shared.tradeRatio
import jp.icenorth.baseball.shared.tradeSlot
import jp.icenorth.baseball.shared.valueTiers
import jp.icenorth.baseball.shared.LeagueView
import jp.icenorth.baseball.shared.OfferOutcome
import jp.icenorth.baseball.shared.ROSTER_LIMIT
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.bool
import jp.icenorth.baseball.shared.dealProblems
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.pid
import jp.icenorth.baseball.shared.positionLabel
import jp.icenorth.baseball.shared.rosterCounts
import jp.icenorth.baseball.shared.rosterGroup
import jp.icenorth.baseball.shared.rostersAfterTrade
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.teamLabel
import jp.icenorth.baseball.shared.teamShort
import jp.icenorth.baseball.shared.offerOutcome
import jp.icenorth.baseball.shared.tradeIds
import jp.icenorth.baseball.shared.unseenTrades
import kotlinx.serialization.json.JsonObject
import kotlin.math.roundToInt
import kotlin.math.max

/**
 * トレード。
 *
 * ⚠ **送る前に必ず確認の段を通す**（いしだ指摘: 選手を選んだ画面にそのまま「提案する」があり、
 *    最終確認なしに相手へ届いた）。CPU球団はその場で答え、受けたら即成立して取り消せないので特に。
 *    新しい提案は「相手 → 選手 → 確認」の3段（[TradeBuilder]）。届いた提案の成立・断るにも確認を出す。
 * ⚠ 名簿が成り立つかはサーバーと同じ規則（rosterShortfall）。最終の判断はサーバー。
 * ⚠ 逆提案は1回だけ。`offer` はいつも提案した側が出す選手（向きを変えない）。
 * ⚠ **補強したいところから探せること**（いしだ 2026-11-13: トレードは自球団の補強したい部分ありき）。
 *    最初の画面に補強ポイント（持ち場ごとのリーグ順位）を出し、持ち場・型から他球団の候補を一度に並べる
 *    （[SearchStep]。計算は shared の TradeSearch.kt）。相手球団から選ぶ流れも残す。
 * ⚠ **CPUが受けそうかの目安を出す**（いしだ 2026-11-13: 判断基準が分からないと win-win の交渉がしづらい）。
 *    値段・上乗せ・見る目の幅はサーバーの名簿の読み込みに載る（[OddsMeter]）。
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
        if (partners.isNotEmpty()) {
            ReinforcePanel(model, view, raw) { slot -> model.parkedTradeDraft = null; model.tradeDraft = TradeDraft(step = TradeStep.Search, slot = slot) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = { model.parkedTradeDraft = null; model.tradeDraft = TradeDraft() }, enabled = partners.isNotEmpty(), modifier = Modifier.weight(1f)) {
                Text("＋ 球団を選んで考える")
            }
            InfoButton(
                "トレード",
                listOf(
                    "ほかの球団と選手を交換します。「補強から探す」で持ち場を選ぶと他球団の候補が並びます。球団を先に選んでも考えられます。確認の画面で内容を見てから送ります。",
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
    /** 補強から探しているときの持ち場（TRADE_SLOTS の鍵、または余りを出す [SURPLUS]） */
    val slot: String? = null,
    /** 型で絞り込んでいるとき（TRADE_FILTERS の鍵） */
    val filter: String? = null,
)

enum class TradeStep(val label: String) { Search("候補"), Partner("相手"), Players("選手"), Confirm("確認") }

/** 「余りを出す」の鍵（持ち場の切り替えに並べる） */
const val SURPLUS = "surplus"

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
private data class PartnerRoster(val roster: List<JsonObject>?, val error: String?, val retry: () -> Unit, val rule: CpuTradeRule? = null)

/** 相手の名簿（その場で読む。12球団ぶんをいつもビューに載せると重い） */
@Composable
private fun partnerRoster(model: AppViewModel, partner: String?): PartnerRoster {
    val revision = model.view?.revision
    // ⚠ 版が変わっても**読み直す間は前の名簿を出したまま**にする（相手を変えたときだけ空にする）。
    //    版はほかの参加者の保存や試合の進行でも変わる。空にすると、選んでいる途中や確認の段で
    //    「読み込み中…」に戻り、送るボタンが押せなくなる。最終の判断はサーバーがする
    var roster by remember(partner) { mutableStateOf<List<JsonObject>?>(null) }
    var failure by remember(partner) { mutableStateOf<String?>(null) }
    var rule by remember(partner) { mutableStateOf<CpuTradeRule?>(null) }
    // 「読み直す」を押した回数（増えると読み直す。⚠ 読み込みに失敗しても押し直せるように。ほかの画面と同じ）
    var attempt by remember(partner) { mutableStateOf(0) }
    LaunchedEffect(partner, revision, attempt) {
        if (partner == null) return@LaunchedEffect
        try {
            val team = model.read("team", mapOf("team" to partner))
            roster = team.at("roster").list().mapNotNull { it.obj() }
            rule = CpuTradeRule.from(team)
            failure = null
        } catch (e: Exception) {
            // ⚠ 前の読み込みが取り消されたとき（ページを連打した・画面を離れた）は失敗として出さない
            if (e is kotlinx.coroutines.CancellationException) throw e
            failure = model.describe(e)
        }
    }
    return PartnerRoster(roster, failure, { attempt++ }, rule)
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
        if (p != null) PlayerSummary(p, { model.openPlayer = it })
        else Text("${e.at("name").str().orEmpty()}（${positionLabel(e.at("position").str())}）", color = if (e.at("gone").bool() == true) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
    }
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
            TradeStep.Search, TradeStep.Partner -> close()
            TradeStep.Players -> if (counter) close() else set(draft.copy(step = if (draft.slot != null) TradeStep.Search else TradeStep.Partner))
            TradeStep.Confirm -> set(draft.copy(step = TradeStep.Players))
        }
    }
    BackHandler(onBack = back)
    val (theirs, theirError, retryTheirs, rule) = partnerRoster(model, draft.partner)
    val myRoster = raw.at("roster").list().mapNotNull { it.obj() }
    val league = leagueRosters(model, view, raw)
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "戻る") }
            Column(Modifier.weight(1f)) {
                Text(if (counter) "逆提案を作る" else "トレードを考える", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                StepLine(draft.step, counter, draft.slot != null)
            }
            TextButton(onClick = close) { Text("やめる") }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        val body = Modifier.weight(1f).fillMaxWidth()
        val partner = draft.partner
        if (draft.step == TradeStep.Search) {
            SearchStep(model, view, draft, league, body, set)
        } else if (draft.step == TradeStep.Partner || partner == null) {
            PartnerStep(model, view, raw, draft.partner, body) { picked ->
                // 相手を変えたら、もらう選手は選び直し（出す選手は残す）
                set(draft.copy(partner = picked, get = if (picked == draft.partner) draft.get else emptySet(), step = TradeStep.Players))
            }
        } else if (draft.step == TradeStep.Players) {
            PlayersStep(model, view, raw, draft, partner, myRoster, theirs, theirError, retryTheirs, rule, league, body, set)
        } else {
            ConfirmStep(model, view, draft, partner, myRoster, theirs, theirError, retryTheirs, rule, league, body, set)
        }
    }
}

/** 今どの段か（逆提案は相手が決まっているので「相手」の段を出さない） */
@Composable
private fun StepLine(step: TradeStep, counter: Boolean, searching: Boolean) {
    val steps = when {
        counter -> listOf(TradeStep.Players, TradeStep.Confirm)
        searching -> listOf(TradeStep.Search, TradeStep.Players, TradeStep.Confirm)
        else -> listOf(TradeStep.Partner, TradeStep.Players, TradeStep.Confirm)
    }
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

@OptIn(ExperimentalFoundationApi::class)
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
    rule: CpuTradeRule?,
    league: LeagueRosters,
    modifier: Modifier,
    set: (TradeDraft) -> Unit,
) {
    // ⚠ 「もらう」「出す」をタブで分けない（いしだ 2026-11-13: 比べにくい）。守備の括りごとに、相手の選手と
    //    自球団の選手を同じ形の行で上下に並べる（PC版のトレードと同じ考え方）
    // 選んだ選手（もらう・出す）の本職の括りから始める（⚠ 探した持ち場の括りにすると、遊撃で探した中堅手や、
    //    余りを出すで選んだ外野手が開いた一覧に居なかった）
    val firstGroup = run {
        theirs?.firstOrNull { it.pid in draft.get }?.let { rosterGroup(it.at("position").str()) }
            ?: myRoster.firstOrNull { it.pid in draft.give }?.let { rosterGroup(it.at("position").str()) }
            ?: tradeSlot(draft.slot)?.let { if (it.pitcher) "pitcher" else rosterGroup(it.key) }
            ?: "pitcher"
    }
    // 相手の名簿が届いてから決め直す（選手の詳細から来たときは、もらう選手の括りから始める）
    var group by rememberSaveable(draft.partner, theirs != null) { mutableStateOf(firstGroup) }
    val usage = remember(view.lineup) { TeamUsage.from(view.lineup) }
    val problems = dealProblems(myRoster, theirs, draft.give, draft.get)
    val theirPlayers = remember(theirs) { theirs.orEmpty().toPlayers() }
    val myPlayers = remember(view.roster, league) { league.withValues(view.roster) }
    val tier = league.tier
    val inGroup = { p: Player -> rosterGroup(p.position) == group }
    Column(modifier) {
        ChipTabs(
            GROUPS.map { (key, label) ->
                val n = (theirPlayers.filter { it.id in draft.get } + myPlayers.filter { it.id in draft.give }).count { rosterGroup(it.position) == key }
                key to (label + if (n > 0) " $n" else "")
            },
            group,
            { group = it },
            Modifier.padding(top = 8.dp),
        )
        // ⚠ **自球団の選手が見つからなかった**（いしだ 2026-11-13「相手チームしか選べない」）。相手の一覧の
        //    下に自球団を置いていたので、投手なら13人ほど送らないと出す選手が見えなかった。
        //    - 「相手（もらう）／自球団（出す）」の2つを上に置き、押すとその見出しへ飛ぶ（切り替えではない。
        //      両方は1つの一覧に並んだまま）。選ばれている方は、いま画面の上にある方
        //    - 見出しは上に貼り付ける（どちらの選手を見ているか分かるように）
        //    - もらう選手が決まっていて出す選手がまだのとき（補強から「考える」・選手の詳細から）は、
        //      最初から自球団の見出しを出す（次にするのは出す選手を選ぶこと）
        val theirList = remember(theirPlayers, group) { theirPlayers.filter(inGroup).sortedByDescending { it.tradeValue ?: 0.0 } }
        val myList = remember(myPlayers, group) { myPlayers.filter(inGroup).sortedByDescending { it.tradeValue ?: 0.0 } }
        val giveHeader = 1 + if (theirError != null || theirs == null) 1 else theirList.size
        val listState = rememberLazyListState()
        val scope = rememberCoroutineScope()
        var jumped by rememberSaveable(draft.partner) { mutableStateOf(false) }
        LaunchedEffect(theirs != null) {
            if (!jumped && theirs != null && draft.get.isNotEmpty() && draft.give.isEmpty()) listState.scrollToItem(giveHeader)
            if (theirs != null) jumped = true
        }
        val showingGive = listState.firstVisibleItemIndex >= giveHeader
        ChipTabs(
            listOf(
                "get" to "${view.teamShort(partner)}（もらう）${theirList.size}人",
                "give" to "自球団（出す）${myList.size}人",
            ),
            if (showingGive) "give" else "get",
            { side -> scope.launch { listState.animateScrollToItem(if (side == "give") giveHeader else 0) } },
            Modifier.padding(top = 4.dp).testTag("trade-side"),
        )
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) {
            stickyHeader(key = "h-get") { SideHeader("${view.teamLabel(partner)}（もらう）") }
            when {
                theirError != null -> item { LoadFailed(theirError, retryTheirs, title = "相手の名簿を読めませんでした") }
                theirs == null -> item { Muted("読み込み中…") }
                else -> items(theirList, key = { "get-${it.id}" }) { p ->
                    TradeRow(model, partner, p, p.id in draft.get, null, tier(p.tradeValue)) {
                        set(draft.copy(get = if (p.id in draft.get) draft.get - p.id else draft.get + p.id))
                    }
                }
            }
            stickyHeader(key = "h-give") { SideHeader("自球団（出す）") }
            items(myList, key = { "give-${it.id}" }) { p ->
                TradeRow(model, view.teamName.orEmpty(), p, p.id in draft.give, if (p.id in usage.lineupIds) "スタメン・ローテ" else null, tier(p.tradeValue)) {
                    set(draft.copy(give = if (p.id in draft.give) draft.give - p.id else draft.give + p.id))
                }
            }
        }
        // 下の帯: 選んだ選手・CPUの見込み・確認へ進むボタン（ここでは送らない）
        Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                PickedLine("出す", namesOf(draft.give, myRoster))
                PickedLine("もらう", namesOf(draft.get, theirs))
                if (rule != null && draft.get.isNotEmpty()) {
                    OddsMeter(myPlayers.filter { it.id in draft.give }.map { it.tradeValue }, gettingTradeValues(theirPlayers, theirPlayers.filter { it.id in draft.get }), rule, compact = true, gap = strengthGapOf(rule, myPlayers, theirs?.let { theirPlayers }, draft.give, draft.get))
                }
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

/** 一覧の見出し（上に貼り付く）。⚠ 下の行が透けないように地色を敷く */
@Composable
private fun SideHeader(text: String) {
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxWidth()) { Caption(text) }
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
    rule: CpuTradeRule?,
    league: LeagueRosters,
    modifier: Modifier,
    set: (TradeDraft) -> Unit,
) {
    val humans = model.raw?.at("members").list().mapNotNull { it.at("teamName").str() }.toSet()
    val problems = dealProblems(myRoster, theirs, draft.give, draft.get)
    val counter = draft.counterOf
    val theirPlayers = remember(theirs) { theirs.orEmpty().toPlayers() }
    val myPlayers = remember(view.roster, league) { league.withValues(view.roster) }
    val giving = myPlayers.filter { it.id in draft.give }
    val getting = theirPlayers.filter { it.id in draft.get }
    val usage = remember(view.lineup) { TeamUsage.from(view.lineup) }
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
            // 1人と1人（投手どうし・野手どうし）なら、能力と成績を1列ずつ並べて差を出す
            val one = giving.singleOrNull()
            val other = getting.singleOrNull()
            if (one != null && other != null && one.isPitcher == other.isPitcher) {
                Section("比べる") { CompareTable(one, other, league.tier) }
            }
            ConfirmSide("出す（自球団）", draft.give, giving, model, view.teamName.orEmpty(), league.tier)
            ConfirmSide("もらう（${view.teamLabel(partner)}）", draft.get, if (theirs == null) null else getting, model, partner, league.tier)
            theirError?.let { LoadFailed(it, retryTheirs, title = "相手の名簿を読めませんでした") }
            if (rule != null && counter == null) Section("${view.teamLabel(partner)}の見込み") {
                OddsMeter(giving.map { it.tradeValue }, gettingTradeValues(if (theirs == null) null else theirPlayers, getting), rule, gap = strengthGapOf(rule, myPlayers, theirs?.let { theirPlayers }, draft.give, draft.get))
            }
            if (theirs != null) Section("交換後") {
                holesAfter(giving, usage).forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                AfterCounts(view, partner, myRoster, theirs, draft.give, draft.get)
            }
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

/** 出すとスタメン・ローテ・抑えに穴が空くか */
private fun holesAfter(giving: List<Player>, usage: TeamUsage): List<String> = giving.mapNotNull { p ->
    val pos = usage.fielders.entries.firstOrNull { it.value == p.id }?.key
    when {
        pos != null -> "${p.name}が抜けて、スタメンの${positionLabel(pos)}が空きます"
        p.id in usage.starters -> "${p.name}が抜けて、先発ローテが1人減ります"
        p.id == usage.closer -> "${p.name}が抜けて、抑えが空きます"
        else -> null
    }
}

@Composable
private fun ConfirmSide(title: String, ids: Set<Long>, players: List<Player>?, model: AppViewModel, team: String, tier: (Double?) -> String?) {
    Section(title) {
        if (ids.isEmpty()) Muted("なし")
        else if (players == null) Muted("読み込み中…")
        players.orEmpty().forEach { p -> PlayerLines(model, team, p, tier(p.tradeValue)) }
    }
}

/** 選手1人の行（名前・年齢・位置／能力／今季成績）。トレードのどの段でも同じ形 */
@Composable
private fun PlayerLines(model: AppViewModel, team: String, p: Player, tier: String?, tag: String? = null, extra: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "${jp.icenorth.baseball.shared.conditionIcon(p.condition)} ${p.name}",
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false).clickable { model.openPlayerOf(team, p.id, p.name) },
            )
            Muted("  ${p.age ?: "-"}歳 ${positionLabel(p.position)}")
            tag?.let { Box(Modifier.padding(start = 6.dp)) { Tag(it) } }
            Spacer(Modifier.weight(1f))
            extra?.invoke()
            tier?.let { ValueTier(it) }
        }
        if (p.isPitcher) { PitcherAbilityRow(p); PitcherStatsRow(p) } else { AbilityRow(p); StatsRow(p) }
    }
}

/** 値段の段（CPUが付ける値段の目安。リーグの全員を3つに分けた高・中・低） */
@Composable
private fun ValueTier(tier: String) {
    val color = when (tier) {
        "高" -> MaterialTheme.colorScheme.secondary
        "低" -> MaterialTheme.colorScheme.onSurfaceVariant
        else -> MaterialTheme.colorScheme.onSurface
    }
    Row(Modifier.padding(start = 6.dp)) {
        Text("値", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.alignByBaseline())
        Text(tier, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = color, modifier = Modifier.alignByBaseline())
    }
}

@Composable
private fun TradeRow(model: AppViewModel, team: String, p: Player, selected: Boolean, tag: String?, tier: String?, onToggle: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(if (selected) MaterialTheme.colorScheme.secondary.copy(alpha = 0.18f) else Color.Transparent, RoundedCornerShape(8.dp))
            .clickable(onClick = onToggle)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (selected) "✓" else "", color = MaterialTheme.colorScheme.secondary, fontWeight = FontWeight.Bold, modifier = Modifier.width(16.dp))
        Box(Modifier.weight(1f)) { PlayerLines(model, team, p, tier, tag) }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

// ------------------------------------------------------------------ 比べる

/** 1人と1人を能力・成績で1行ずつ比べる（差は もらう − 出す。防御率は低いほど良い） */
@Composable
private fun CompareTable(give: Player, get: Player, tier: (Double?) -> String?) {
    data class Line(val label: String, val a: Double?, val b: Double?, val text: (Double?) -> String, val lowerIsBetter: Boolean = false)
    val int = { v: Double? -> v?.roundToInt()?.toString() ?: "-" }
    val rate = { v: Double? -> jp.icenorth.baseball.shared.rate3(v) }
    val lines = if (give.isPitcher) listOf(
        Line("球速", give.pitching?.velocity?.toDouble(), get.pitching?.velocity?.toDouble(), int),
        Line("制球", give.pitching?.control?.toDouble(), get.pitching?.control?.toDouble(), int),
        Line("スタミナ", give.pitching?.stamina?.toDouble(), get.pitching?.stamina?.toDouble(), int),
        Line("回転", give.pitching?.spinRate?.toDouble(), get.pitching?.spinRate?.toDouble(), int),
        Line("防御率", give.performance?.pitching?.metrics?.era, get.performance?.pitching?.metrics?.era, { v -> v?.let { "%.2f".format(it) } ?: "-" }, lowerIsBetter = true),
        Line("K/9", give.performance?.pitching?.metrics?.k9, get.performance?.pitching?.metrics?.k9, { v -> v?.let { "%.1f".format(it) } ?: "-" }),
    ) else listOf(
        Line("ミート", give.batting?.meet?.toDouble(), get.batting?.meet?.toDouble(), int),
        Line("パワー", give.batting?.power?.toDouble(), get.batting?.power?.toDouble(), int),
        Line("選球眼", give.batting?.eye?.toDouble(), get.batting?.eye?.toDouble(), int),
        Line("走力", give.physical?.speed?.toDouble(), get.physical?.speed?.toDouble(), int),
        Line("守備", give.fielding?.defense?.toDouble(), get.fielding?.defense?.toDouble(), int),
        Line("肩", give.physical?.arm?.toDouble(), get.physical?.arm?.toDouble(), int),
        Line("打率", give.performance?.batting?.metrics?.avg, get.performance?.batting?.metrics?.avg, rate),
        Line("OPS", give.performance?.batting?.metrics?.ops, get.performance?.batting?.metrics?.ops, { v -> jp.icenorth.baseball.shared.ops3(v) }),
    )
    val head = MaterialTheme.typography.labelSmall
    val ink = MaterialTheme.colorScheme.onSurfaceVariant
    Row(Modifier.fillMaxWidth()) {
        Text("", modifier = Modifier.width(64.dp))
        Text("出す ${give.name}", style = head, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Text("もらう ${get.name}", style = head, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Text("差", style = head, color = ink, modifier = Modifier.width(48.dp))
    }
    val good = Color(0xFF4ADE80)
    val bad = MaterialTheme.colorScheme.error
    (lines + Line("年齢", give.age?.toDouble(), get.age?.toDouble(), int)).forEach { l ->
        Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(l.label, style = MaterialTheme.typography.bodySmall, color = ink, modifier = Modifier.width(64.dp))
            Text(l.text(l.a), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
            Text(l.text(l.b), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            val d = if (l.a != null && l.b != null) l.b - l.a else null
            val better = d != null && l.label != "年齢" && (if (l.lowerIsBetter) d < 0 else d > 0)
            val worse = d != null && l.label != "年齢" && (if (l.lowerIsBetter) d > 0 else d < 0)
            Text(
                when {
                    d == null -> ""
                    l.label == "年齢" -> if (d > 0) "+${d.roundToInt()}" else "${d.roundToInt()}"
                    l.label in setOf("打率", "OPS") -> (if (d >= 0) "+" else "") + "%.3f".format(d).removePrefix("0").replace("-0.", "-.")
                    l.lowerIsBetter || l.label == "K/9" -> (if (d >= 0) "+" else "") + "%.2f".format(d)
                    else -> (if (d >= 0) "+" else "") + d.roundToInt()
                },
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Bold,
                color = if (better) good else if (worse) bad else ink,
                modifier = Modifier.width(48.dp),
            )
        }
    }
    Row(Modifier.fillMaxWidth().padding(top = 2.dp)) {
        Text("値段", style = MaterialTheme.typography.bodySmall, color = ink, modifier = Modifier.width(64.dp))
        Text(tier(give.tradeValue) ?: "-", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
        Text(tier(get.tradeValue) ?: "-", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(48.dp))
    }
}

// ------------------------------------------------------------------ CPUの見込み

/** 交換で開く戦力の差（相手の名簿が読めていて、サーバーが線を渡したときだけ。shared の [tradeStrengthGap]） */
private fun strengthGapOf(rule: CpuTradeRule, mine: List<Player>, theirs: List<Player>?, give: Set<Long>, get: Set<Long>): Double? =
    if (rule.gapLimit == null || theirs == null || get.isEmpty()) null else tradeStrengthGap(mine, theirs, give, get)

/** CPUの判断の決まり（ⓘ に出す。数字はサーバーが渡す決まりから） */
private fun oddsHelp(rule: CpuTradeRule): List<String> = listOf(
    "CPU球団は、素質（ドラフトと同じ物差し。若いほど高い）といまの持ち場での力を半々で見て値段を付け、今季の成績で上下させます。相手が出す選手は、抜けると穴が空く主力ほど高くなります（何人かまとめてもらうと、まとめて空く穴で見ます）。「値 高・中・低」は、リーグの全選手をこの値段で3つに分けたものです。",
    "受け取る選手の値段の合計が、出す選手の値段の合計の${"%.2f".format(rule.margin)}倍以上なら受けます。",
    "監督によって見る目が違い、1人ずつ最大±${(rule.eyeLimit * 100).roundToInt()}%高く・低く見ます（若手好み・主力好み・監督の型に合う選手）。",
    "値段が釣り合っていても、交換のあとのスタメン・ローテ・中継ぎの力がそちらばかり上がる交換は断ります（弱い2人で強い1人を取る形など）。",
    "足りないときは、もらう選手を同じ持ち場（投手・捕手・内野・外野）の値段の釣り合う選手に差し替えた逆提案を返します。差し替えられる選手がいなければ断ります。",
    "「釣り合い」は、出す選手の値段の合計がもらう選手の値段の合計の何%かです。「受けるには約○%」は見る目を抜いたときの線です。",
    "メーターの「受けるはず」は、見る目がいちばん不利でも届く線です。「足りない」は、いちばん有利でも届かない線です。その間は監督しだいです。",
)

/**
 * CPUが受けそうか。出す側の値段がもらう側の何%かをメーターに置き、「足りない／監督しだい／受けるはず」の3段で出す。
 * ⚠ 境目はサーバーが渡す決まり（[CpuTradeRule]）から引く（shared の [tradeOdds]）。
 */
@Composable
private fun OddsMeter(giveValues: List<Double?>, getValues: List<Double?>, rule: CpuTradeRule, compact: Boolean = false, gap: Double? = null) {
    // ⚠ 値段が届くまでは見込みを出さない（0として数えると「足りない」と出て、出す選手を足しすぎる）
    if (giveValues.any { it == null } || getValues.any { it == null }) {
        Muted("CPUの見込み: 値段を読み込み中…")
        return
    }
    val give = giveValues.filterNotNull()
    val get = getValues.filterNotNull()
    // ⚠ 戦力の開きが線を超えたら、値段が釣り合っても断る（サーバーと同じ。値段より先に見る）
    val gapLimit = rule.gapLimit
    val lopsided = gap != null && gapLimit != null && gap > gapLimit
    val odds = if (lopsided) TradeOdds.Lopsided else tradeOdds(give, get, rule)
    val ratio = tradeRatio(give, get)
    val (low, high) = tradeOddsBounds(rule)
    val color = when (odds) {
        TradeOdds.Likely -> Color(0xFF4ADE80)
        TradeOdds.Depends -> Color(0xFFFACC15)
        TradeOdds.Short, TradeOdds.Lopsided -> MaterialTheme.colorScheme.error
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("CPUの見込み", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(odds.label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = color, modifier = Modifier.padding(start = 8.dp).weight(1f))
            InfoButton("CPUの判断", oddsHelp(rule) + listOfNotNull(rule.eyeNote))
        }
        // ⚠ 「出す側 73%」だけでは何の割合か分からなかった（いしだ 2026-11-13）。受ける線と並べて、見出しと別の行に（狭い画面で折り返していた）
        ratio?.let { Muted("釣り合い ${(it * 100).roundToInt()}%（受けるには約${(rule.margin * 100).roundToInt()}%）") }
        if (lopsided) Text(
            "この交換でそちらの戦力が相手より${"%.1f".format(gap ?: 0.0)}点多く上がるので、値段が釣り合っても断ります（${"%.0f".format(gapLimit ?: 0.0)}点まで）。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
        )
        if (ratio != null) {
            val top = max(2.0, high * 1.25)
            BoxWithConstraints(Modifier.fillMaxWidth().height(10.dp)) {
                Row(Modifier.fillMaxSize()) {
                    // ⚠ weight は0より大きくないと落ちる（見る目の幅が0なら黄の帯が無い）
                    fun w(v: Double) = (v / top).toFloat().coerceAtLeast(0.0001f)
                    Box(Modifier.weight(w(low)).fillMaxSize().background(MaterialTheme.colorScheme.error.copy(alpha = 0.45f)))
                    Box(Modifier.weight(w(high - low)).fillMaxSize().background(Color(0xFFFACC15).copy(alpha = 0.45f)))
                    Box(Modifier.weight(w(top - high)).fillMaxSize().background(Color(0xFF4ADE80).copy(alpha = 0.45f)))
                }
                val x = maxWidth * (ratio.coerceIn(0.0, top) / top).toFloat()
                Box(Modifier.offset(x = (x - 2.dp).coerceAtLeast(0.dp)).width(4.dp).fillMaxSize().background(MaterialTheme.colorScheme.onSurface))
            }
        }
        if (!compact) rule.eyeNote?.let { Muted(it) }
    }
}

// ------------------------------------------------------------------ 名簿をまとめて読む

/** リーグの名簿（読めた球団だけ）と、値段の索引・段 */
private class LeagueRosters(
    val teams: Map<String, List<Player>>,
    /** 読み終えた球団の数（読めなかった球団も含む） */
    val loaded: Int,
    val total: Int,
    /** 読めなかった球団の数 */
    val failed: Int = 0,
) {
    val values: Map<Long, Double> = teams.values.flatten().mapNotNull { p -> p.tradeValue?.let { p.id to it } }.toMap()
    val tier: (Double?) -> String? = valueTiers(values.values.toList())
    val complete: Boolean get() = loaded >= total

    /** 名簿に値段を付ける（自球団の値段も球団の読み込みにだけ載るので） */
    fun withValues(roster: List<Player>): List<Player> = roster.map { it.copy(tradeValue = values[it.id]) }

    /** 自球団を除いた球団の名簿 */
    fun others(own: String?): Map<String, List<Player>> = teams - own.orEmpty()
}

private fun List<JsonObject>.toPlayers(): List<Player> =
    mapNotNull { e -> runCatching { OnlineJson.decodeFromJsonElement(Player.serializer(), e) }.getOrNull() }

/** 読めなかった球団があれば数を出す（⚠ 出さないと「条件に合う選手がいません」に見えた） */
@Composable
private fun FailedRosters(league: LeagueRosters, modifier: Modifier = Modifier) {
    if (league.failed > 0) Text("${league.failed}球団の名簿を読めませんでした（トレードを開き直すと読み直します）", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = modifier)
}

/** 一度に読む球団の数（PC版 useLeagueRosters と同じ3本） */
private const val ROSTER_READERS = 3

/**
 * 全球団（自球団を含む。値段は球団の読み込みにだけ載るので）の名簿を読む。
 * ⚠ 読み込みは版ごとに覚えている（[AppViewModel.read]）ので、画面を行き来しても読み直さない。
 *    1つの読み込みの中で3本ずつ読む（球団ごとに別の読み込みにすると、画面が変わるたびに取り消される。
 *    1本ずつだと12球団で待たされた）。読めない球団は飛ばし、数だけ数える
 */
@Composable
private fun leagueRosters(model: AppViewModel, view: LeagueView, raw: JsonObject): LeagueRosters {
    val names = remember(raw) { raw.at("teamNames").list().mapNotNull { it.str() } }
    var state by remember { mutableStateOf(LeagueRosters(emptyMap(), 0, names.size)) }
    LaunchedEffect(names, view.revision) {
        val lock = kotlinx.coroutines.sync.Mutex()
        var teams = state.teams
        var done = 0
        var failed = 0
        val queue = java.util.concurrent.ConcurrentLinkedQueue(names)
        kotlinx.coroutines.coroutineScope {
            repeat(ROSTER_READERS) {
                launch {
                    while (true) {
                        val name = queue.poll() ?: break
                        val roster = try {
                            model.read("team", mapOf("team" to name)).at("roster").list().mapNotNull { it.obj() }.toPlayers()
                        } catch (e: Exception) {
                            if (e is kotlinx.coroutines.CancellationException) throw e
                            null
                        }
                        lock.withLock {
                            if (roster != null) teams = teams + (name to roster) else failed += 1
                            done += 1
                            state = LeagueRosters(teams, done, names.size, failed)
                        }
                    }
                }
            }
        }
    }
    return state
}

// ------------------------------------------------------------------ 補強から探す

private val REINFORCE_HELP = listOf(
    "持ち場（守備位置・先発・中継ぎ・抑え）ごとに、自球団のいまの起用の力が、リーグで何番目かを出します。弱い順に3つです。",
    "力は能力から出した目安です。野手は打つ力（ミ パ 眼 走）と守る力（守 肩 × その位置の適性）を合わせ、捕手・遊撃・二塁・中堅は守る力を重く見ます。先発はローテ5人、中継ぎは4人の平均です。",
    "他球団は名簿の中でいちばん良い組み合わせで数えます（起用は見えないため）。「控え無し」は、その位置を適性60以上で守れる控えがいないことです。",
    "持ち場を押すと、他球団でその持ち場を担える選手が、力の高い順に並びます。",
)

/** 最初の画面の「補強から探す」。弱い持ち場3つと、持ち場の一覧 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ReinforcePanel(model: AppViewModel, view: LeagueView, raw: JsonObject, onSearch: (String) -> Unit) {
    val league = leagueRosters(model, view, raw)
    val usage = remember(view.lineup) { TeamUsage.from(view.lineup) }
    val others = remember(league, view.teamName) { league.others(view.teamName) }
    // ⚠ 読み終わるのを待たず、**読めた球団の分から**出す（いしだ 2026-11-13: 全部読むまで何も出ず待たされた）。
    //    順位は読めた球団の中での順位で、読むたびに付け直す
    val points = remember(league.teams, view.roster, usage) {
        if (others.isNotEmpty()) reinforcePoints(view.roster, usage, others) else emptyList()
    }
    Section("補強から探す", trailing = { InfoButton("補強ポイント", REINFORCE_HELP) }) {
        if (!league.complete) Muted("各球団の名簿を読んでいます（${league.loaded}/${league.total}）。読めた球団の中での順位です")
        FailedRosters(league)
        points.take(3).forEach { r ->
            Row(
                Modifier.fillMaxWidth().clickable { onSearch(r.slot.key) }.padding(vertical = 6.dp).testTag("reinforce-${r.slot.key}"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(r.slot.label, fontWeight = FontWeight.Bold, modifier = Modifier.width(56.dp))
                Column(Modifier.weight(1f)) {
                    Text(r.holder?.name ?: "不在", style = MaterialTheme.typography.bodyMedium)
                    Muted("${r.teams}球団中 ${r.rank}位" + if (r.noBackup) "・控え無し" else "")
                }
                Text("探す ›", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
            }
        }
        Caption("持ち場から探す")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            (TRADE_SLOTS.map { it.key to it.short } + (SURPLUS to "余りを出す")).forEach { (key, label) ->
                OutlinedButton(onClick = { onSearch(key) }, contentPadding = PaddingValues(horizontal = 10.dp), modifier = Modifier.testTag("slot-$key")) { Text(label) }
            }
        }
    }
}

/** 候補を探す段。持ち場（と型）を選ぶと、他球団でそれを担える選手が並ぶ。押すとその選手を「もらう」に入れて選手の段へ */
@Composable
private fun SearchStep(model: AppViewModel, view: LeagueView, draft: TradeDraft, league: LeagueRosters, modifier: Modifier, set: (TradeDraft) -> Unit) {
    val slotKey = draft.slot ?: TRADE_SLOTS.first().key
    val usage = remember(view.lineup) { TeamUsage.from(view.lineup) }
    val own = view.teamName.orEmpty()
    val others = remember(league, own) { league.others(own) }
    Column(modifier) {
        ChipTabs(
            TRADE_SLOTS.map { it.key to it.label } + (SURPLUS to "余りを出す"),
            slotKey,
            { set(draft.copy(slot = it, filter = null)) },
            Modifier.padding(top = 8.dp),
        )
        if (!league.complete) Muted("各球団の名簿を読んでいます（${league.loaded}/${league.total}）", Modifier.padding(horizontal = 16.dp))
        FailedRosters(league, Modifier.padding(horizontal = 16.dp))
        if (slotKey == SURPLUS) {
            SurplusList(model, view, usage, others, league, set, draft)
            return@Column
        }
        val slot = tradeSlot(slotKey) ?: return@Column
        val filters = TRADE_FILTERS.filter { it.pitcher == null || it.pitcher == slot.pitcher }
        ChipTabs(listOf("all" to "すべて") + filters.map { it.key to it.label }, draft.filter ?: "all", { set(draft.copy(filter = it.takeIf { k -> k != "all" })) })
        val mineScore = remember(view.roster, usage) { ownSlotScores(view.roster, usage)[slotKey] }
        val filter = filters.firstOrNull { it.key == draft.filter }
        val candidates = remember(slotKey, filter, league.teams, view.roster, usage) { tradeCandidates(slotKey, view.roster, usage, others, filter) }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Muted("いまの${slot.label}: ${mineScore?.holder?.name ?: "不在"}" + (mineScore?.let { "（力${it.score.roundToInt()}）" } ?: ""), Modifier.weight(1f))
            InfoButton("候補", listOf(
                "他球団で${slot.label}を担える選手です" + (if (slot.pitcher) "。" else "（適性${jp.icenorth.baseball.shared.TRADE_MIN_FITNESS}以上）。") + "力の高い順に並びます。",
                "右の「+9」などは、いまの一番手との力の差です。「値」はCPUが付ける値段の目安です。",
                "「相手の一番手」は、相手の球団でもその持ち場の一番手の選手です（出すと相手に穴が空くので、釣り合いを多めに求められやすい選手です）。",
                "行を押すと、その選手を「もらう」に入れて、出す選手を選ぶ段へ進みます。名前を押すと選手の詳細です。",
            ))
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) {
            if (candidates.isEmpty() && league.complete) item { Muted("条件に合う選手がいません", Modifier.padding(8.dp)) }
            items(candidates.take(80), key = { "${it.team}-${it.player.id}" }) { c ->
                Column(
                    Modifier.fillMaxWidth().clickable {
                        set(draft.copy(partner = c.team, get = setOf(c.player.id), give = if (draft.partner == c.team) draft.give else emptySet(), step = TradeStep.Players))
                    }.padding(horizontal = 4.dp, vertical = 2.dp),
                ) {
                    Muted(view.teamLabel(c.team) + if (!slot.pitcher) "・${slot.short}の適性${c.player.fitness(slotKey)}" else "")
                    PlayerLines(model, c.team, c.player, league.tier(c.player.tradeValue), if (c.theirStarter) "相手の一番手" else null) {
                        val d = c.diff.roundToInt()
                        Text(
                            (if (d >= 0) "+" else "") + d,
                            fontWeight = FontWeight.Bold,
                            color = if (d > 0) Color(0xFF4ADE80) else if (d < 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

/** 余りを出す。起用していない自球団の選手のうち、他球団ならその持ち場の一番手を上回る人と、その球団 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SurplusList(model: AppViewModel, view: LeagueView, usage: TeamUsage, others: Map<String, List<Player>>, league: LeagueRosters, set: (TradeDraft) -> Unit, draft: TradeDraft) {
    val mine = remember(view.roster, league) { league.withValues(view.roster) }
    val list = remember(mine, usage, others) { surplusPlayers(mine, usage, others) }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Muted("起用の中心にいない選手と、その人が一番手になれる球団", Modifier.weight(1f))
        InfoButton("余りを出す", listOf(
            "起用の中心（打順・先発ローテ・抑え・力の上位${jp.icenorth.baseball.shared.SURPLUS_KEEP_RELIEVERS}人の中継ぎ）に入っていない自球団の選手のうち、他球団ならその持ち場の一番手を上回る人です。先発・中継ぎは、相手の上位（先発5人・中継ぎ4人）の中でいちばん良い人と比べます。",
            "相手には穴が埋まる得があるので、釣り合いの取れた交換を考えやすい相手です。ただしCPUの判断は値段だけで、相手の穴は見ません（ⓘ「CPUの判断」）。",
            "球団を押すと、その選手を「出す」に入れて、もらう選手を選ぶ段へ進みます。",
        ))
    }
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) {
        if (list.isEmpty() && league.complete) item { Muted("他球団で一番手になれる控えはいません", Modifier.padding(8.dp)) }
        items(list, key = { it.player.id }) { e ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp)) {
                PlayerLines(model, view.teamName.orEmpty(), e.player, league.tier(e.player.tradeValue), e.slot.label)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    e.wantedBy.forEach { team ->
                        OutlinedButton(
                            onClick = { set(draft.copy(partner = team, give = setOf(e.player.id), get = emptySet(), step = TradeStep.Players)) },
                            contentPadding = PaddingValues(horizontal = 10.dp),
                        ) { Text(view.teamLabel(team)) }
                    }
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}
