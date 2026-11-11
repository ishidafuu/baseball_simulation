package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import jp.icenorth.baseball.shared.FrontPage
import kotlinx.coroutines.delay
import java.time.Instant

/**
 * ホームの見た目。**中身（記事）はどれも同じ [FrontPage]** で、描き方だけを変える。
 * いしだの指定: 新聞風が好みに合わない人もいるので、ネットニュース風・通常からも選べるように。
 * 選んだものは端末に覚える（[jp.icenorth.baseball.app.AppViewModel.homeStyle]）。
 */
enum class HomeStyle(val label: String) { Paper("新聞風"), Web("ネットニュース風"), Plain("通常") }

fun homeStyleOf(name: String?): HomeStyle = HomeStyle.entries.firstOrNull { it.name == name } ?: HomeStyle.Paper

@Composable
fun HomePage(
    style: HomeStyle,
    page: FrontPage,
    nextAdvanceAt: String?,
    menu: @Composable () -> Unit,
    onLink: (String) -> Unit,
    onOpenProcedures: () -> Unit,
) {
    when (style) {
        HomeStyle.Paper -> FrontPageCard(page, nextAdvanceAt, menu, onLink, onOpenProcedures)
        HomeStyle.Web -> WebNewsPage(page, nextAdvanceAt, menu, onLink, onOpenProcedures)
        HomeStyle.Plain -> PlainPage(page, nextAdvanceAt, menu, onLink, onOpenProcedures)
    }
}

/** 次の進行までの残り秒。1秒ごとに数え直す。止まっている・手続き中なら null */
@Composable
fun secondsUntil(iso: String?): Long? {
    val at = remember(iso) { iso?.let { runCatching { Instant.parse(it) }.getOrNull() } } ?: return null
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(at) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }
    return ((at.toEpochMilli() - now) / 1000).coerceAtLeast(0)
}

/**
 * 手続きの決定を待っているか（`view.phase` がある）。⚠ 「次の進行まで」は残り秒しか受け取らないので、
 * 手続き中かどうかは画面の上（[OnlineApp]）から渡す。
 */
val LocalAwaitingDecision = staticCompositionLocalOf { false }

/**
 * 残り時間の前に付ける「次の進行まで」。⚠ 時刻があるときだけ付ける。時刻が無いとき・0秒のときは
 *    「次の進行まで 進行中…」「次の進行まで 手続きの決定待ち」と、つながらない文になっていた
 */
fun countdownLead(left: Long?): String = if (left != null && left > 0) "次の進行まで " else ""

/** 「次の進行まで」に出す文（Web 版 api.js の nextAdvanceText と同じ決まり） */
@Composable
fun countdownText(left: Long?): String = countdownText(left, LocalAwaitingDecision.current, System.currentTimeMillis())

/**
 * ⚠ **時刻が無い理由まで書く**。手続き中は進行の時刻を持たない（決定で動く）ので、以前は手続き中も
 *    「停止中」と出て、止まっているのか自分の決定を待っているのか読めなかった。
 * ⚠ 60分を超えたら残りではなく**日時**で出す。キャンプのあとの開幕までなどは「5432:10」のような
 *    数千分の数え下げになって読めなかった。
 */
fun countdownText(left: Long?, awaitingDecision: Boolean, now: Long): String = when {
    left == null -> if (awaitingDecision) "手続きの決定待ち" else "停止中"
    left == 0L -> "進行中…"
    // 残り秒は切り捨てなので、分に丸めて元の時刻に戻す（0:00 ちょうどが 23:59 に見えない）
    left > 60 * 60 -> formatDateTime((now + left * 1000 + 30_000) / 60_000 * 60_000)
    else -> "%d:%02d".format(left / 60, left % 60)
}

private val WebAccent = Color(0xFF3B82F6)
private val WebBreaking = Color(0xFFEF4444)

/** 記事の種類ごとの色（ネットニュース風のカテゴリの札） */
private fun categoryColor(kicker: String): Color = when (kicker) {
    "次戦予告" -> Color(0xFF22C55E)
    "順位の行方" -> Color(0xFF3B82F6)
    "タイトル戦線" -> Color(0xFFF59E0B)
    "ベンチ裏" -> Color(0xFFA855F7)
    "警戒警報" -> Color(0xFFEF4444)
    "ひと言" -> Color(0xFF14B8A6)
    "プロ注目" -> Color(0xFFEAB308)
    "1部戦線", "2部戦線" -> Color(0xFF3B82F6)
    "連勝・連敗", "オーナーたちの戦い" -> Color(0xFFF97316)
    "ドラフト", "トライアウト", "トレード", "昇格・降格", "人事" -> Color(0xFF06B6D4)
    "新体制", "ベンチの空気" -> Color(0xFFA855F7)
    else -> Color(0xFF94A3B8)
}

/**
 * ネットニュース風。上にトップ記事（得点を大きく）、下にカテゴリの札つきの見出しの一覧。
 */
@Composable
private fun WebNewsPage(page: FrontPage, nextAdvanceAt: String?, menu: @Composable () -> Unit, onLink: (String) -> Unit, onOpenProcedures: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // 上の帯（サイト名・球団・残り時間）
        Column(Modifier.fillMaxWidth().background(WebAccent, RoundedCornerShape(10.dp)).padding(start = 14.dp, end = 4.dp, top = 6.dp, bottom = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(page.title, color = Color.White, fontWeight = FontWeight.Black, fontSize = 18.sp)
                Text(if (page.paper == FrontPage.Paper.Local) " 地元ニュース" else " ニュース", color = Color.White.copy(alpha = 0.85f), fontWeight = FontWeight.Bold, fontSize = 14.sp, modifier = Modifier.weight(1f))
                androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides Color.White) { menu() }
            }
            Text(listOfNotNull(page.team, page.standing).joinToString("　"), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row {
                Text(listOfNotNull(page.issue.ifEmpty { null }, page.status).joinToString("・"), color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp, modifier = Modifier.weight(1f).alignByBaseline())
                val left = secondsUntil(nextAdvanceAt)
                Text(countdownLead(left), color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp, modifier = Modifier.alignByBaseline())
                Text(countdownText(left), color = Color.White, fontWeight = FontWeight.Black, fontSize = 16.sp, modifier = Modifier.alignByBaseline().padding(end = 10.dp))
            }
        }
        // 速報（自分の番の手続きなど）
        if (page.alerts.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().background(WebBreaking.copy(alpha = 0.15f), RoundedCornerShape(10.dp)).clickable(onClick = onOpenProcedures).padding(12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Text("速報", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Black, modifier = Modifier.background(WebBreaking, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
                Column(Modifier.weight(1f).padding(start = 8.dp)) {
                    page.alerts.forEach { Text(it, fontWeight = FontWeight.Bold, fontSize = 14.sp) }
                    Text("手続きを開く ›", color = WebBreaking, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 2.dp))
                }
            }
        }
        // トップ記事
        Card(onClick = { onLink(jp.icenorth.baseball.shared.LINK_GAMES) }, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)) {
            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("トップ", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Black, modifier = Modifier.background(WebAccent, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
                    page.kicker?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                page.score?.let { s ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                        Text(s.away, fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.End)
                        Text("  ${s.awayScore} - ${s.homeScore}  ", fontWeight = FontWeight.Black, fontSize = 30.sp, color = toneColor(page.tone))
                        Text(s.home, fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.weight(1f))
                    }
                }
                Text(page.headline, fontWeight = FontWeight.Black, fontSize = 21.sp, lineHeight = 27.sp)
                page.subhead?.let { Text(it, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                page.lead?.let { Text(paperText(it), fontSize = 13.sp, lineHeight = 20.sp) }
                if (page.box.isNotEmpty()) Text(page.box.joinToString("　") { (k, v) -> "$k $v" }, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        // 見出しの一覧
        if (page.articles.isNotEmpty()) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                Column {
                    Text("ニュース", fontWeight = FontWeight.Black, fontSize = 15.sp, modifier = Modifier.padding(start = 14.dp, top = 12.dp, bottom = 4.dp))
                    page.articles.forEachIndexed { i, a ->
                        if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(horizontal = 14.dp))
                        val link = a.link
                        Row(
                            Modifier.fillMaxWidth().then(if (link != null) Modifier.clickable { onLink(link) } else Modifier).padding(horizontal = 14.dp, vertical = 10.dp),
                        ) {
                            Box(Modifier.padding(top = 3.dp).width(4.dp).height(34.dp).background(categoryColor(a.kicker), RoundedCornerShape(2.dp)))
                            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                                Text(a.kicker, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = categoryColor(a.kicker))
                                Text(a.title, fontWeight = FontWeight.Bold, fontSize = 15.sp, lineHeight = 20.sp)
                                Text(paperText(a.body), fontSize = 12.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                            if (link != null) Text("›", fontSize = 20.sp, color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(start = 6.dp).align(Alignment.CenterVertically))
                        }
                    }
                }
            }
        }
        // ほかの試合（横に並べる）
        if (page.shorts.isNotEmpty()) {
            Text("同じ日のほかの試合", fontWeight = FontWeight.Bold, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                page.shorts.forEach {
                    Text(it, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 8.dp))
                }
            }
        }
    }
}

@Composable
private fun toneColor(tone: FrontPage.Tone): Color = when (tone) {
    FrontPage.Tone.Win -> WebBreaking
    FrontPage.Tone.Lose -> MaterialTheme.colorScheme.onSurface
    else -> MaterialTheme.colorScheme.onSurface
}

/**
 * 通常。アプリのほかの画面と同じカードで、飾らずに並べる（以前のホームに近い見た目）。
 */
@Composable
private fun PlainPage(page: FrontPage, nextAdvanceAt: String?, menu: @Composable () -> Unit, onLink: (String) -> Unit, onOpenProcedures: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
            Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(page.team, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    menu()
                }
                Text(listOfNotNull(page.standing, page.issue.ifEmpty { null }, page.status).joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
                Row {
                    val left = secondsUntil(nextAdvanceAt)
                    Text(countdownLead(left), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.alignByBaseline())
                    Text(countdownText(left), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.secondary, modifier = Modifier.alignByBaseline())
                }
            }
        }
        if (page.alerts.isNotEmpty()) {
            Card(onClick = onOpenProcedures, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondary.copy(alpha = 0.18f))) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    page.alerts.forEach { Text(it, fontWeight = FontWeight.SemiBold) }
                    Text("手続きを開く →", color = MaterialTheme.colorScheme.secondary, style = MaterialTheme.typography.labelLarge)
                }
            }
        }
        // 最新の試合（見出しは飾らずにそのまま）
        Card(onClick = { onLink(jp.icenorth.baseball.shared.LINK_GAMES) }) {
            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(if (page.score != null) "最新の試合" else "いまの様子", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                page.score?.let { s ->
                    Text("${s.away} ${s.awayScore} - ${s.homeScore} ${s.home}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                Text(page.headline, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                page.subhead?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                page.lead?.let { Text(paperText(it), style = MaterialTheme.typography.bodySmall) }
                if (page.box.isNotEmpty()) Text(page.box.joinToString("　") { (k, v) -> "$k $v" }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        page.articles.forEach { a ->
            val link = a.link
            Card(
                modifier = Modifier.fillMaxWidth().then(if (link != null) Modifier.clickable { onLink(link) } else Modifier),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
            ) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(a.kicker, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    Text(a.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                    Text(paperText(a.body), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (page.shorts.isNotEmpty()) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("同じ日のほかの試合", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    page.shorts.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
                }
            }
        }
    }
}
