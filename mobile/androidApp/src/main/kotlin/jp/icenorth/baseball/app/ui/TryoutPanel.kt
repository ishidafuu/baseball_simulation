package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import jp.icenorth.baseball.shared.TeamFit
import jp.icenorth.baseball.shared.teamFitRank
import jp.icenorth.baseball.shared.Commands
import jp.icenorth.baseball.shared.DEFAULT_WEIGHTS
import jp.icenorth.baseball.shared.ONLINE_ROSTER_TARGETS
import jp.icenorth.baseball.shared.ROSTER_GROUP_LABELS
import jp.icenorth.baseball.shared.TRYOUT_GROUPS
import jp.icenorth.baseball.shared.TRYOUT_SORT_KEYS
import jp.icenorth.baseball.shared.WEIGHTED_SORT_KEY
import jp.icenorth.baseball.shared.WEIGHT_FIELDS
import jp.icenorth.baseball.shared.WEIGHT_LEVELS
import jp.icenorth.baseball.shared.WEIGHT_MAX
import jp.icenorth.baseball.shared.TRYOUT_WISH_MAX
import jp.icenorth.baseball.shared.addToPlan
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.inTryoutGroup
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.minimumShort
import jp.icenorth.baseball.shared.long
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.overallScore
import jp.icenorth.baseball.shared.pid
import jp.icenorth.baseball.shared.planSummary
import jp.icenorth.baseball.shared.removeFromPlan
import jp.icenorth.baseball.shared.rosterCounts
import jp.icenorth.baseball.shared.shiftInPlan
import jp.icenorth.baseball.shared.signTotal
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.weightedRanked
import jp.icenorth.baseball.shared.weightedScore
import jp.icenorth.baseball.shared.wishLimit
import jp.icenorth.baseball.shared.wishedCount
import kotlinx.serialization.json.JsonObject
import kotlin.math.max
import kotlin.math.roundToInt

private const val PAGE = 12

/**
 * 初期編成・トライアウトの希望リスト（Web 版 TryoutPlanner と同じ規則）。
 *
 * - 上: 獲得する人数（−／＋）と、交渉する選手（10人まで。↑↓で順位、「やめる」で外す）
 * - 下: 候補（区分・並べ替え・名前で絞り、「交渉」で交渉する選手の末尾へ）
 * ⚠ 交渉する選手の並び＝サーバーが取りにいく順（目標構成で飛ばさない）。以前の「候補全員を並べて
 *    目標構成で飛ばす」形は Web 版でやめており、サーバーも11人以上の希望を受け付けない。
 * ⚠ 獲得する人数（`total`）は交渉した人数と別に持つ（先方指摘「指名選手の人数を決められない」）。
 *    交渉が多ければ上位から人数ぶん、少なければ残りを自動で埋める。決めていなければ空き枠いっぱい。
 * @param editable false なら読むだけ（指導者に任せた手続き）。人数・交渉・並べ替えと
 *    「重視する能力」を出さない。候補の絞り込み・並べ替え（見るだけの操作）は残す
 */
@Composable
fun TryoutPanel(
    model: AppViewModel,
    raw: JsonObject,
    phase: JsonObject,
    plan: JsonObject,
    setPlan: (JsonObject) -> Unit,
    editable: Boolean = true,
    onReset: () -> Unit,
) {
    val candidates = remember(phase) { phase.at("candidates").list().mapNotNull { it.obj() } }
    val roster = remember(raw) { raw.at("roster").list().mapNotNull { it.obj() } }
    val byId = remember(candidates) { candidates.associateBy { it.pid } }
    // ⚠ 候補に居ない選手（古い下書き）は数えない。10人を超える古い下書きも10人で切る
    val maxCount = rosterRoom(raw)
    val limit = wishLimit(maxCount)
    val ranked = plan.at("rankedIds").list().mapNotNull { it.long() }.filter { it in byId }.take(limit)
    val total = signTotal(plan, maxCount)
    val count = wishedCount(ranked, total)
    val autoFill = (total - count).coerceAtLeast(0)
    val summary = planSummary(ranked, candidates, count, roster)
    val weights = model.tryoutWeights
    val scores = remember(candidates, weights) { candidates.associate { it.pid to weightedScore(it, weights) } }
    // ⚠ お知らせは出したときの希望順と組で持つ（希望順が外から変わったら出さない）
    var noticeState by remember { mutableStateOf<Pair<String, List<Long>>?>(null) }
    val notice = noticeState?.takeIf { it.second == ranked }?.first
    val setRanked: (List<Long>) -> Unit = { ids -> setPlan(Commands.withTryout(plan, ids.take(limit), total)) }
    val setTotal: (Int) -> Unit = { n -> setPlan(Commands.withTryout(plan, ranked.take(limit), n.coerceIn(0, maxCount))) }

    // ⚠ 「交渉する選手」と「候補」を切り替える（候補を見ている間は交渉の中身が見えず、行き来に長いスクロールが要った）
    var side by rememberSaveable { mutableStateOf("plan") }
    ChoiceRow(listOf("plan" to "交渉 ${ranked.size}人", "pool" to "候補 ${candidates.size}人"), side) { side = it }

    if (side == "plan") Section(
        "獲得する人数",
        trailing = {
            InfoButton(
                "トライアウト",
                listOf(
                    "「交渉」を押した順が1位〜${TRYOUT_WISH_MAX}位です。1位から順に取りにいきます。",
                    "同じ選手を他球団も希望したときは、前年の順位が上の球団が獲得します（取られたぶんは下から繰り上がります）。",
                    "獲得するのは「獲得する人数」まで。交渉した人で足りないぶんは自動で埋まります（CPUと同じ判断）。0人にしても、投手・捕手・野手が最低限に届かないときは足りない位置だけ補います。",
                    "「重視する能力」の重みから評価（0〜100）を出し、おすすめの${TRYOUT_WISH_MAX}人を選べます。「軽視〜最重視」を0.6〜1.6倍で重み付けした平均で、投手と野手は別の能力で計算します。重みはこの端末に覚えます。",
                ),
            )
        },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (editable) OutlinedButton(onClick = { setTotal(total - 1) }, enabled = total > 0) { Text("−") }
            Text("${total}人", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            if (editable) OutlinedButton(onClick = { setTotal(total + 1) }, enabled = total < maxCount) { Text("＋") }
            Muted("空き枠${maxCount}人")
        }
        Text(
            when {
                total == 0 -> "今年は獲得しません（最低限に届かないときだけ、足りない位置を補います）。"
                ranked.size > total -> "交渉した${ranked.size}人のうち、上位から${total}人を取ります。取られたら下位が繰り上がります。"
                autoFill > 0 -> "交渉した${count}人に、自動で${autoFill}人を足して${total}人獲得します。"
                else -> "交渉した${count}人を獲得します。"
            // ⚠ 最低限（投1・捕1・野8）に届かないぶんはサーバーが人数を超えて補うので、その分も足す（Web 版と同じ）
            } + "獲得後の名簿は${roster.size + max(total, summary.picked.size + minimumShort(roster, summary.picked))}人です。",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
        )
        if (editable) Row {
            if (total < maxCount) TextButton(onClick = { setTotal(maxCount) }) { Text("枠いっぱいにする") }
            TextButton(onClick = onReset) { Text("標準案に戻す") }
        }
    }

    if (side == "plan" && editable) WeightsSection(model, candidates, roster, limit) { next ->
        setRanked(next)
        noticeState = "評価の高い順に、投・捕・内・外の目標人数を守って${next.size}人選び直しました。" to next
    }

    val after = rosterCounts(roster + summary.picked)
    val afterLine = "獲得後の名簿 投${after["pitcher"]}/${ONLINE_ROSTER_TARGETS["pitcher"]} 捕${after["catcher"]}/${ONLINE_ROSTER_TARGETS["catcher"]} 内${after["infielder"]}/${ONLINE_ROSTER_TARGETS["infielder"]} 外${after["outfielder"]}/${ONLINE_ROSTER_TARGETS["outfielder"]}（交渉した人まで）"
    if (side == "plan") Section("交渉する選手 ${ranked.size} / ${limit}人") {
        Muted(afterLine)
        if (summary.blocking.isNotEmpty()) Text("交渉した選手だけでは足りません: ${summary.blocking.joinToString(" / ")}。足りない守備位置は自動で補います（希望どおりにしたいなら、その位置の選手と交渉してください）。", color = MaterialTheme.colorScheme.error)
        if (summary.warnings.isNotEmpty()) Text("${summary.warnings.joinToString("。")}。人数が足りない位置は自動で埋められます。", color = MaterialTheme.colorScheme.secondary)
        notice?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
        if (ranked.isEmpty()) Muted(if (limit > 0) "「候補」で「交渉」を押すと、ここに1位から並びます。${limit}人まで選べます。" else "名簿に空きがありません。")
        ranked.forEachIndexed { i, id ->
            val p = byId[id] ?: return@forEachIndexed
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${i + 1}", fontWeight = FontWeight.Bold, modifier = Modifier.width(24.dp))
                Box(Modifier.weight(1f)) {
                    PlayerSummary(p, { model.openPlayer = it }) {
                        Column(horizontalAlignment = Alignment.End) {
                            Score(scores[p.pid])
                            Fit(teamFitRank(p, roster, weights))
                            // 獲得する人数より下は「取られたときの繰り上がり」
                            if (i >= total) Tag("繰り上がり用", MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            // ⚠ 並べ替え・外すは下の行に、押せる大きさ（48dp）で置く（名前の横に詰めると押し間違えやすい）
            if (editable) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = { setRanked(shiftInPlan(ranked, i, -1)) }, enabled = i > 0) { Text("↑ 上へ") }
                TextButton(onClick = { setRanked(shiftInPlan(ranked, i, 1)) }, enabled = i < ranked.size - 1) { Text("↓ 下へ") }
                TextButton(onClick = { setRanked(removeFromPlan(ranked, id)) }) { Text("やめる") }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }

    var group by rememberSaveable { mutableStateOf("all") }
    var sortKey by rememberSaveable { mutableStateOf(WEIGHTED_SORT_KEY) }
    var query by rememberSaveable { mutableStateOf("") }
    // 何人まで出しているか（「続きを表示」で増やす。絞り込み・並べ替えを変えたら最初に戻す）
    var shownCount by rememberSaveable { mutableStateOf(PAGE) }
    val scoreOf: (JsonObject) -> Double = if (sortKey == WEIGHTED_SORT_KEY) { p -> scores[p.pid] ?: 0.0 } else TRYOUT_SORT_KEYS.firstOrNull { it.key == sortKey }?.of ?: ::overallScore
    val pool = candidates
        .filter { inTryoutGroup(it, group) && (query.isBlank() || it.at("name").str().orEmpty().contains(query.trim())) }
        .sortedWith(compareByDescending<JsonObject> { scoreOf(it) }.thenBy { it.pid })
    val shown = pool.take(shownCount)
    if (side == "pool") Section("候補 ${candidates.size}人") {
        Muted("交渉中 ${ranked.size} / ${limit}人・$afterLine")
        notice?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
        ChoiceRow(TRYOUT_GROUPS, group) { group = it; shownCount = PAGE }
        ChoiceRow(listOf(WEIGHTED_SORT_KEY to "評価") + TRYOUT_SORT_KEYS.map { it.key to it.label }, sortKey) { sortKey = it; shownCount = PAGE }
        OutlinedTextField(query, { query = it; shownCount = PAGE }, label = { Text("名前で探す") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        shown.forEach { p ->
            val at = ranked.indexOf(p.pid)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    PlayerSummary(p, { model.openPlayer = it }) {
                        Column(horizontalAlignment = Alignment.End) {
                            Score(scores[p.pid])
                            Fit(teamFitRank(p, roster, weights))
                            Koshien(p)
                            if (at >= 0) Tag("交渉中 ${at + 1}位", MaterialTheme.colorScheme.primary)
                        }
                    }
                }
                // ⚠ 操作の欄は幅を決めておく（字で幅が変わると右の評価の列がずれる）
                // ⚠ ボタンは1つだけ（Web 版と同じ。以前は「＋予定」「最優先」の2つで、どちらを押すか毎回迷った）
                if (editable) Box(Modifier.width(ActionWidth), contentAlignment = Alignment.CenterEnd) {
                    if (at < 0) {
                        TextButton(onClick = {
                            // ⚠ 黙って何も起きない、を作らない。満員のときは理由を出す
                            if (ranked.size >= limit) {
                                noticeState = (if (limit == 0) "名簿に空きがないので、交渉できません。" else "交渉できるのは${limit}人までです。誰かの交渉をやめてから選んでください。") to ranked
                            } else setRanked(addToPlan(ranked, p.pid, limit))
                        }) { Text("交渉") }
                    } else {
                        TextButton(onClick = { setRanked(removeFromPlan(ranked, p.pid)) }) { Text("やめる") }
                    }
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
        // ⚠ ページ送りをやめ、続きを下に足す（以前は12人ごとに「前へ／次へ」で、見ていた所に戻れなかった）
        if (pool.size > shown.size) {
            OutlinedButton(onClick = { shownCount += PAGE * 2 }, modifier = Modifier.fillMaxWidth()) { Text("続きを表示（残り${pool.size - shown.size}人）") }
        }
    }
}

/**
 * いまの名簿の同じ区分で何番手にあたるか（Web 版のトライアウト画面と同じ）。
 * ⚠ いしだ指摘: 候補が自分のチームに合っているか分からない
 */
@Composable
private fun Fit(fit: TeamFit) {
    Text(
        "うちの${ROSTER_GROUP_LABELS[fit.group]}で${fit.rank}番手",
        style = MaterialTheme.typography.labelSmall,
        color = if (fit.rank <= 2) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
        fontWeight = if (fit.rank <= 2) FontWeight.Bold else FontWeight.Normal,
    )
}

/** 甲子園で名を上げた人（「2年目の夏の甲子園 ○○高のエース（ベスト4）」。サーバーが付ける。`koshienNoteOf`） */
@Composable
private fun Koshien(p: JsonObject) {
    val note = p.at("koshien").str() ?: return
    Text(note, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.tertiary)
}

@Composable
private fun Score(value: Double?) {
    value ?: return
    Text("評価${value.roundToInt()}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary, fontWeight = FontWeight.Bold)
}

/** 重視する能力（評価値の重み）。端末に覚え、サーバーには送らない */
@Composable
private fun WeightsSection(model: AppViewModel, candidates: List<JsonObject>, roster: List<JsonObject>, limit: Int, onRanked: (List<Long>) -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    val weights = model.tryoutWeights
    Section("重視する能力（評価値の重み）", trailing = { TextButton(onClick = { open = !open }) { Text(if (open) "閉じる" else "開く") } }) {
        if (!open) return@Section
        listOf("fielder" to "野手", "pitcher" to "投手", "common" to "共通").forEach { (side, title) ->
            Text(title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
            WEIGHT_FIELDS.filter { it.group == side }.forEach { f ->
                val level = weights[f.key] ?: 2
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(f.label, modifier = Modifier.width(64.dp))
                    Slider(
                        value = level.toFloat(),
                        onValueChange = { v -> model.changeWeights(weights + (f.key to v.roundToInt())) },
                        valueRange = 0f..WEIGHT_MAX.toFloat(),
                        steps = WEIGHT_MAX - 1,
                        modifier = Modifier.weight(1f),
                    )
                    Text(WEIGHT_LEVELS.getOrNull(level)?.first.orEmpty(), modifier = Modifier.width(64.dp).padding(start = 6.dp), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { onRanked(weightedRanked(candidates, weights, roster, limit)) }) { Text("この重みで${limit}人選ぶ") }
            TextButton(onClick = { model.changeWeights(DEFAULT_WEIGHTS) }) { Text("標準に戻す") }
        }
    }
}

/** 候補の行の操作（「交渉」「やめる」）の欄の幅 */
private val ActionWidth = 84.dp
