package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import jp.icenorth.baseball.app.AppViewModel
import jp.icenorth.baseball.shared.SEASON_STEPS
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.campGainRows
import jp.icenorth.baseball.shared.campGainTotals
import jp.icenorth.baseball.shared.formatGain
import jp.icenorth.baseball.shared.int
import jp.icenorth.baseball.shared.num
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.offseasonGains
import jp.icenorth.baseball.shared.positionLabel
import jp.icenorth.baseball.shared.stageHead
import jp.icenorth.baseball.shared.stageInfo
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.teamLabel
import kotlinx.serialization.json.JsonObject

// ============================================================
// 1年の流れの帯と、オフの成長（Web 版の `SeasonFlow.jsx` / `OffseasonGrowth.jsx` と同じ）。
//
// ⚠ いしだ指摘: シーズン後の流れ・いまの段階・何をすればいいか、成長がいつどれだけ
//    起きたのかが分からない。段階はサーバーが決める（`view.stage`）。
// ============================================================

/** いまの段階の1行目（Web 版の `stageLines(view).head` と同じ文） */
fun stageHeadText(raw: JsonObject?): String? {
    val info = stageInfo(raw) ?: return null
    val deadline = formatDeadline(raw?.at("phase", "deadline").str() ?: raw?.at("phaseDeadline").str())
    return stageHead(info, formatDeadline(raw?.at("nextAdvanceAt").str()), if (raw?.get("phase").obj() != null) deadline else null)
}

@Composable
fun SeasonFlowCard(raw: JsonObject?) {
    val info = stageInfo(raw) ?: return
    Section(modifier = Modifier.testTag("season-flow")) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            SEASON_STEPS.forEachIndexed { i, step ->
                // ⚠ 前後だけ出す（Web 版のスマホ幅と同じ）。7つ並べると、いまの段階が右端の外に隠れる
                if (i < info.index - 1 || i > info.index + 2) return@forEachIndexed
                val now = i == info.index
                val done = i < info.index
                val accent = MaterialTheme.colorScheme.primary
                val bg = when {
                    now && info.open -> accent
                    done -> Color(0x332E9E5B)
                    else -> MaterialTheme.colorScheme.surfaceContainerHighest
                }
                val ink = when {
                    now && info.open -> MaterialTheme.colorScheme.onPrimary
                    done -> Color(0xFF2E9E5B)
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                }
                var mod = Modifier.background(bg, RoundedCornerShape(6.dp))
                if (now && !info.open) mod = mod.border(1.dp, accent, RoundedCornerShape(6.dp))
                Column(mod.padding(horizontal = 8.dp, vertical = 4.dp)) {
                    Text(step.label, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = ink)
                    Text(step.time, fontSize = 10.sp, color = ink)
                }
            }
        }
        stageHeadText(raw)?.let { Text(it, fontWeight = FontWeight.Bold) }
        Muted(info.step.todo)
    }
}

/** 年度更新で起きた伸び・衰え・引退（`view.lastOffseason`） */
@Composable
fun OffseasonGrowthCard(model: AppViewModel, raw: JsonObject?) {
    if (raw == null) return
    val result = raw["lastOffseason"].obj() ?: return
    val roster = raw.at("roster").list().mapNotNull { it.obj() }
    val gains = offseasonGains(result, roster)
    val rows = campGainRows(gains, roster).filter { it.items.isNotEmpty() }
    val totals = campGainTotals(gains)
    var all by rememberSaveable { mutableStateOf(false) }
    Section(
        "${result.at("year").int() ?: ""}年目オフの成長（年度更新）",
        trailing = { InfoButton("年度更新の成長", listOf("能力が変わるのはキャンプと年度更新だけです（シーズン中は変わりません）。", "年度更新では、年齢と今季の出場に応じて伸びたり衰えたりします。")) },
    ) {
        if (rows.isEmpty()) {
            Muted("変わった能力はありません。")
        } else {
            Text("${rows.count { it.sum > 0 }}人が伸び、${rows.count { it.sum < 0 }}人が衰えました", fontWeight = FontWeight.Bold)
            Muted("伸び: " + totals.filter { it.diff > 0 }.take(5).joinToString(" · ") { "${it.label}${formatGain(it.diff)}" })
            (if (all) rows else rows.take(8)).forEach { row ->
                Column(Modifier.fillMaxWidth().clickable { model.openPlayer = row.player }.padding(vertical = 4.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(row.player.at("name").str().orEmpty(), fontWeight = FontWeight.SemiBold)
                        Muted("${positionLabel(row.player.at("position").str().orEmpty())} · ${row.player.at("age").int() ?: ""}歳")
                    }
                    GainLine(null, row.items)
                }
            }
            if (rows.size > 8) TextButton(onClick = { all = !all }) { Text(if (all) "上位8人だけ" else "全員（${rows.size}人）を見る") }
        }
        val departed = result.at("departed").list().mapNotNull { it.obj() }
        if (departed.isNotEmpty())
            Muted("引退: " + departed.joinToString("、") { "${it.at("name").str()}（${it.at("age").int()}歳・${positionLabel(it.at("position").str().orEmpty())}）" })
    }
}

/**
 * トライアウトで入団した選手と、交渉したのに他球団に取られた選手（`view.lastTryout`。Web 版 TryoutResult と同じ）。
 * ⚠ 先方指摘: トライアウト後の入団選手の一覧が無く、誰が入ったか分からない（リーグ便りは全球団の指名が混ざるだけ）
 */
@Composable
fun TryoutResultCard(model: AppViewModel, raw: JsonObject?) {
    if (raw == null) return
    val result = raw["lastTryout"].obj() ?: return
    val roster = raw.at("roster").list().mapNotNull { it.obj() }
    val byId = roster.associateBy { it.at("id").num()?.toLong() }
    val picks = result.at("picks").list().mapNotNull { it.obj() }
    val lost = result.at("lost").list().mapNotNull { it.obj() }
    val wished = picks.count { it.at("wish").int() != null }
    Section("${result.at("year").int() ?: ""}年目のトライアウトで入団した選手（${picks.size}人）") {
        Muted(if (picks.isEmpty()) "今年のトライアウトで入団した選手はいません。" else "交渉して獲得 ${wished}人・自動で獲得 ${picks.size - wished}人")
        picks.forEach { p ->
            val player = byId[p.at("playerId").num()?.toLong()]
            Row(
                Modifier.fillMaxWidth().clickable(enabled = player != null) { player?.let { model.openPlayer = it } }.padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(p.at("name").str().orEmpty(), fontWeight = FontWeight.SemiBold)
                // ⚠ 年齢は名簿の今の値（結果の年齢はトライアウト時点で、年度更新で1つ上がる）。Web 版 TryoutResult.jsx
                Muted("${positionLabel(p.at("position").str().orEmpty())} · ${player?.age ?: p.at("age").int() ?: ""}歳 · ${p.at("round").int() ?: ""}巡目")
                val wish = p.at("wish").int()
                Text(
                    if (wish != null) "交渉${wish}位" else "自動",
                    color = if (wish != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.sp,
                )
            }
        }
        if (lost.isNotEmpty())
            Muted("交渉したが他球団が獲得: " + lost.joinToString("、") { l ->
                "${l.at("name").str()}（交渉${l.at("wish").int() ?: ""}位・${positionLabel(l.at("position").str().orEmpty())}）→ ${l.at("takenBy").str()?.let { model.view?.teamLabel(it) ?: it }.orEmpty()}"
            })
    }
}
