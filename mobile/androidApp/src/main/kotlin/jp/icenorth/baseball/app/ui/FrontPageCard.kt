package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.CompositionLocalProvider
import jp.icenorth.baseball.shared.FrontPage
import jp.icenorth.baseball.shared.LINK_GAMES

/*
 * ホームの「スポーツ新聞」。アプリのほかの画面は暗い色だが、ここだけ新聞紙の色（生成り）にして
 * 紙面らしさを出す。見出しは明朝（端末の Serif。日本語は Noto Serif CJK）で太く。
 * 勝った日の大見出しは赤、負けた日は黒（スポーツ紙の1面の決まり）。
 */
private val Paper = Color(0xFFF4EFE3)
private val Ink = Color(0xFF1B1A17)
private val InkSoft = Color(0xFF5B5548)
private val Red = Color(0xFFC8102E)
private val Rule = Color(0xFF2B2A27)

/**
 * @param menu 題字の右に置くメニュー（更新・名前の変更・見た目の切り替え・ログアウト）
 * @param onLink 記事を押したとき（[FrontPage.Article.link]）
 */
@Composable
fun FrontPageCard(
    page: FrontPage,
    nextAdvanceAt: String?,
    menu: @Composable () -> Unit,
    onLink: (String) -> Unit,
    onOpenProcedures: () -> Unit,
) {
    val onOpenGames = { onLink(LINK_GAMES) }
    Column(
        Modifier
            .fillMaxWidth()
            .background(Paper, RoundedCornerShape(4.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Masthead(page, nextAdvanceAt, menu)
        // お知らせ（自分の番の手続きなど）。紙面のいちばん上に赤枠で
        if (page.alerts.isNotEmpty()) {
            Column(
                Modifier.padding(top = 10.dp).fillMaxWidth().border(2.dp, Red).clickable(onClick = onOpenProcedures).padding(horizontal = 10.dp, vertical = 8.dp),
            ) {
                Text("お知らせ", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Black, modifier = Modifier.background(Red).padding(horizontal = 5.dp, vertical = 1.dp))
                page.alerts.forEach { Text("■ $it", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Ink, modifier = Modifier.padding(top = 4.dp)) }
                Text("手続きを開く →", fontSize = 12.sp, color = Red, fontWeight = FontWeight.Bold, textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
            }
        }
        // 号外（ノーヒットノーラン・2桁連勝など）
        if (page.extra) {
            Text(
                "号　外",
                color = Color.White,
                fontFamily = FontFamily.Serif,
                fontWeight = FontWeight.Black,
                fontSize = 20.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp).fillMaxWidth().background(Red).padding(vertical = 2.dp),
            )
        }
        // 大見出し
        page.kicker?.let {
            Text(
                it,
                color = Color.White,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 10.dp).background(if (page.tone == FrontPage.Tone.Win) Red else Ink).padding(horizontal = 6.dp, vertical = 2.dp),
            )
        }
        Text(
            page.headline,
            fontFamily = FontFamily.Serif,
            fontWeight = FontWeight.Black,
            fontSize = 32.sp,
            lineHeight = 38.sp,
            color = if (page.tone == FrontPage.Tone.Win) Red else Ink,
            modifier = Modifier.padding(top = 6.dp).clickable(onClick = onOpenGames),
        )
        // 回ごとの得点があればスコアボード、無ければ得点だけ
        page.lineScore?.let { LineScoreBoard(it) } ?: page.score?.let { ScoreLine(it) }
        page.subhead?.let {
            Text(it, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Ink, modifier = Modifier.padding(top = 6.dp))
        }
        page.lead?.let {
            Text(paperText("　$it"), fontFamily = FontFamily.Serif, fontSize = 14.sp, lineHeight = 22.sp, color = Ink, modifier = Modifier.padding(top = 8.dp))
        }
        // 勝敗投手・本塁打の欄（新聞の小さな定型欄）
        if (page.box.isNotEmpty()) {
            Column(Modifier.padding(top = 6.dp)) {
                page.box.forEach { (mark, text) ->
                    Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(mark, color = Paper, fontSize = 10.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center, modifier = Modifier.width(18.dp).background(Ink).padding(vertical = 1.dp))
                        Text(text, fontSize = 12.sp, color = Ink, modifier = Modifier.padding(start = 6.dp))
                    }
                }
            }
        }
        // 記事は2段に組む（最初の1本は全幅）
        if (page.articles.isNotEmpty()) {
            HRule(Modifier.padding(top = 12.dp))
            ArticleBlock(page.articles.first(), Modifier.fillMaxWidth().padding(vertical = 10.dp), onLink)
            page.articles.drop(1).chunked(2).forEach { pair ->
                HRule()
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(vertical = 10.dp)) {
                    ArticleBlock(pair[0], Modifier.weight(1f).padding(end = 8.dp), onLink)
                    if (pair.size > 1) {
                        Box(Modifier.width(1.dp).fillMaxHeight().background(Rule.copy(alpha = 0.4f)))
                        ArticleBlock(pair[1], Modifier.weight(1f).padding(start = 8.dp), onLink)
                    }
                }
            }
        }
        if (page.shorts.isNotEmpty()) {
            HRule()
            Text("リーグ短信", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 14.sp, color = Ink, modifier = Modifier.padding(top = 8.dp, bottom = 4.dp))
            page.shorts.forEach { Text("■ $it", fontSize = 13.sp, color = Ink, lineHeight = 19.sp) }
        }
    }
}

/**
 * 題字。下に「球団・順位」と「日付・ターン・状態・次の進行までの残り時間」を2行で（以前は紙面の上の別のカードだった。
 * いしだの指定でホームは紙面1枚にまとめる）
 */
@Composable
private fun Masthead(page: FrontPage, nextAdvanceAt: String?, menu: @Composable () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        // ⚠ 題字は縮められるように（文字を大きくしている端末で、右のメニュー＝ログアウトや見た目の切り替えが押し出されないよう）
        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            Text(page.title, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 24.sp, letterSpacing = 1.sp, color = Ink, maxLines = 1, softWrap = false, overflow = TextOverflow.Clip, modifier = Modifier.weight(1f, fill = false))
            Text(
                page.badge,
                color = Color.White,
                fontSize = 13.sp,
                fontWeight = FontWeight.Black,
                maxLines = 1,
                softWrap = false,
                modifier = Modifier.padding(start = 6.dp).background(Red).padding(horizontal = 5.dp, vertical = 1.dp),
            )
        }
        CompositionLocalProvider(LocalContentColor provides Ink) { menu() }
    }
    // 題字の下の二重線
    Box(Modifier.padding(top = 2.dp).fillMaxWidth().height(2.dp).background(Rule))
    Box(Modifier.padding(top = 2.dp).fillMaxWidth().height(1.dp).background(Rule))
    // 大きさの違う字は下ぞろえ（Alignment.Bottom）でなくベースラインでそろえる（下ぞろえだと小さい字が浮く）
    Row(Modifier.padding(top = 6.dp)) {
        Text(page.team, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 16.sp, color = Ink, maxLines = 1, modifier = Modifier.weight(1f, fill = false).alignByBaseline())
        page.standing?.let { Text("　$it", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Ink, maxLines = 1, modifier = Modifier.alignByBaseline()) }
    }
    Row(Modifier.fillMaxWidth().padding(top = 2.dp)) {
        Text(listOfNotNull(page.issue.ifEmpty { null }, page.status).joinToString("・"), fontSize = 11.sp, color = InkSoft, modifier = Modifier.weight(1f).alignByBaseline())
        val left = secondsUntil(nextAdvanceAt)
        Text(countdownLead(left), fontSize = 11.sp, color = InkSoft, modifier = Modifier.alignByBaseline())
        Text(countdownText(left), fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 16.sp, color = Red, modifier = Modifier.alignByBaseline())
    }
    Box(Modifier.padding(top = 4.dp).fillMaxWidth().height(1.dp).background(Rule.copy(alpha = 0.5f)))
}

@Composable
private fun ScoreLine(score: FrontPage.Score) {
    Row(
        Modifier.padding(top = 8.dp).border(1.dp, Rule).padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(score.away, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Ink)
        Text("${score.awayScore}", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 26.sp, color = Ink)
        Text("－", fontSize = 15.sp, color = InkSoft)
        Text("${score.homeScore}", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 26.sp, color = Ink)
        Text(score.home, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Ink)
    }
}

/** スコアボード（回ごとの得点。サヨナラの回には x を付ける） */
@Composable
private fun LineScoreBoard(ls: FrontPage.LineScore) {
    // 枠の数と「x」「1x」の書き方は試合の詳細のスコアボードと同じ（GamesScreen.kt の lineScoreCells）
    val (top, bottom) = lineScoreCells(ls.awayRuns, ls.homeRuns, ls.walkOff)
    val cell = Modifier.width(17.dp)
    Column(Modifier.padding(top = 8.dp).border(1.dp, Rule).padding(horizontal = 6.dp, vertical = 4.dp)) {
        @Composable
        fun line(name: String, runs: List<String>, total: String, bold: Boolean) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(name, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Ink, maxLines = 1, overflow = TextOverflow.Clip, modifier = Modifier.width(44.dp))
                runs.forEach { Text(it, fontSize = 12.sp, color = if (bold) Ink else InkSoft, textAlign = TextAlign.Center, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal, modifier = cell) }
                Text(total, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 15.sp, color = Ink, textAlign = TextAlign.End, modifier = Modifier.width(26.dp))
            }
        }
        line("", top.indices.map { "${it + 1}" }, "計", false)
        line(ls.away, top, "${ls.awayRuns.sum()}", true)
        line(ls.home, bottom, "${ls.homeRuns.sum()}", true)
    }
}

@Composable
private fun ArticleBlock(article: FrontPage.Article, modifier: Modifier, onLink: (String) -> Unit) {
    val link = article.link
    Column(modifier.then(if (link != null) Modifier.clickable { onLink(link) } else Modifier)) {
        Text(
            article.kicker,
            color = Paper,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.background(Ink).padding(horizontal = 4.dp, vertical = 1.dp),
        )
        Text(article.title, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 17.sp, lineHeight = 22.sp, color = Ink, modifier = Modifier.padding(top = 4.dp))
        Text(paperText(article.body), fontFamily = FontFamily.Serif, fontSize = 13.sp, lineHeight = 20.sp, color = Ink, modifier = Modifier.padding(top = 3.dp))
    }
}

@Composable
private fun HRule(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(Rule.copy(alpha = 0.5f)))
}
