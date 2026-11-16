package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import jp.icenorth.baseball.shared.BoxTeam
import jp.icenorth.baseball.shared.FrontPage
import jp.icenorth.baseball.shared.LINK_GAMES
import jp.icenorth.baseball.shared.LINK_TIPS
import jp.icenorth.baseball.shared.RecordPage
import jp.icenorth.baseball.shared.TeamPage
import jp.icenorth.baseball.shared.verticalCells

/*
 * ホームの「スポーツ新聞」（新聞風）。アプリのほかの画面は暗い色だが、ここだけ新聞紙の色（生成り）にする。
 *
 * いしだ 2026-11-16「本物のスポーツ新聞みたいに」「地味で情報多めの2面も」:
 * - 1面: 球場の写真（の代わりの絵）に縦の大見出し・黄色の袋文字・斜めの黒帯を重ねる。リードは縦書き、横にヒーロー欄。
 *   勝った日は赤、負けた日は黒で写真の色を落とす（スポーツ紙の1面の決まり）。
 * - 2面（チーム面）: 監督の一問一答・チームの今・調子の矢印・投手陣の疲れ・選手の談話・次の相手・若手。
 * - 3面（記録面）: 両軍の成績表・継投メモ・順位表・予告先発・個人成績・リーグ短信。
 * - 速報を見るまでは「ただいま印刷中」（結果を伏せる）。
 * 案の資料: https://claude.ai/artifact/8CJhsphdLbaXq9aBmUz38U
 */
private val Paper = Color(0xFFF1ECDF)
private val Ink = Color(0xFF1B1A17)
private val InkSoft = Color(0xFF5B5548)
private val Red = Color(0xFFC8102E)
private val Navy = Color(0xFF14365F)
private val Yellow = Color(0xFFFFE100)
private val Rule = Color(0xFF8A8272)
private val Shade = Color(0xFFE6DFCD)

/**
 * @param menu 題字の右に置くメニュー（更新・名前の変更・見た目の切り替え・ログアウト）
 * @param onLink 記事を押したとき（[FrontPage.Article.link]）
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FrontPageCard(
    page: FrontPage,
    nextAdvanceAt: String?,
    menu: @Composable () -> Unit,
    onLink: (String) -> Unit,
    onOpenProcedures: () -> Unit,
) {
    val national = page.paper == FrontPage.Paper.National
    val accent = if (national) Navy else Red
    val pages = listOfNotNull(1, page.teamPage?.let { 2 }, page.recordPage?.let { 3 })
    var pageNo by rememberSaveable(page.paper, page.issue) { mutableIntStateOf(1) }
    if (pageNo !in pages) pageNo = 1
    // 面の終わりの「2面に詳報 ▶」などで替えたときは、新しい面の頭（面の切り替え）まで戻す
    val tabsInView = remember { BringIntoViewRequester() }
    var jumps by remember { mutableIntStateOf(0) }
    LaunchedEffect(jumps) { if (jumps > 0) tabsInView.bringIntoView() }
    val jump: (Int) -> Unit = { if (it in pages) { pageNo = it; jumps++ } }
    Column(
        Modifier
            .fillMaxWidth()
            .background(Paper, RoundedCornerShape(4.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        RunningHead(page, pageNo)
        Masthead(page, nextAdvanceAt, accent, menu)
        if (pages.size > 1) Box(Modifier.bringIntoViewRequester(tabsInView)) { PageTabs(pages, pageNo) { pageNo = it } }
        when {
            page.sealed -> SealedFront(page, onLink, onOpenProcedures)
            pageNo == 2 && page.teamPage != null -> TeamPageView(page.teamPage!!, accent, onLink) { jump(3) }
            pageNo == 3 && page.recordPage != null -> RecordPageView(page.recordPage!!, onLink) { jump(1) }
            else -> FrontView(page, accent, onLink, onOpenProcedures, onPage = jump)
        }
    }
}

// ------------------------------------------------------------------------------------------
// 題字まわり

/** 欄外の細い行（面・号数・日付・発行元） */
@Composable
private fun RunningHead(page: FrontPage, pageNo: Int) {
    Row(Modifier.fillMaxWidth().padding(bottom = 4.dp).drawBehind { drawLine(Ink, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }.padding(bottom = 2.dp)) {
        Text("（$pageNo）" + (page.issueNo?.let { "　第${it}号" } ?: ""), fontSize = 9.sp, color = InkSoft, modifier = Modifier.weight(1f))
        page.dateLine?.let { Text(it, fontSize = 9.sp, color = InkSoft, modifier = Modifier.weight(1.4f), textAlign = TextAlign.Center) }
        Text("${page.title}社", fontSize = 9.sp, color = InkSoft, modifier = Modifier.weight(1f), textAlign = TextAlign.End, maxLines = 1)
    }
}

@Composable
private fun Masthead(page: FrontPage, nextAdvanceAt: String?, accent: Color, menu: @Composable () -> Unit) {
    val national = page.paper == FrontPage.Paper.National
    Row(verticalAlignment = Alignment.CenterVertically) {
        // ⚠ 題字は縮められるように（文字を大きくしている端末で、右のメニューが押し出されないよう）
        Column(Modifier.weight(1.25f, fill = false).background(accent).padding(horizontal = 8.dp, vertical = 3.dp)) {
            Text(
                page.title,
                fontFamily = if (national) PaperGothic else FontFamily.Serif,
                fontWeight = FontWeight.Black,
                fontSize = if (national) 25.sp else 28.sp,
                letterSpacing = if (national) 0.sp else 2.sp,
                color = Color.White,
                maxLines = 1,
                softWrap = false,
                overflow = TextOverflow.Clip,
                style = androidx.compose.ui.text.TextStyle(shadow = Shadow(Color.Black.copy(alpha = 0.45f), Offset(3f, 3f), 0f)),
            )
            Text(if (national) "独 立 リ ー グ 総 合 ス ポ ー ツ 紙" else "独 立 リ ー グ 地 域 ス ポ ー ツ 紙", fontSize = 7.sp, color = Color.White, maxLines = 1, softWrap = false)
        }
        Column(Modifier.weight(1f).padding(start = 8.dp)) {
            Text(page.dateLine ?: page.issue, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Ink, maxLines = 1)
            Text(listOfNotNull(page.issueNo?.let { "第${it}ターン" }, page.status).joinToString("・"), fontSize = 10.sp, color = InkSoft, maxLines = 1)
            Row {
                val left = secondsUntil(nextAdvanceAt)
                Text(countdownLead(left), fontSize = 10.sp, color = InkSoft, modifier = Modifier.alignByBaseline())
                Text(countdownText(left), fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 15.sp, color = Red, modifier = Modifier.alignByBaseline(), maxLines = 1)
            }
        }
        CompositionLocalProvider(LocalContentColor provides Ink) { menu() }
    }
    // 球団と順位（大きさの違う字はベースラインでそろえる）
    Row(
        Modifier.fillMaxWidth().padding(top = 5.dp)
            .drawBehind {
                drawLine(Ink, Offset(0f, 0f), Offset(size.width, 0f), 3.dp.toPx())
                drawLine(Ink, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
            }
            .padding(vertical = 3.dp),
    ) {
        Text(page.team, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 14.sp, color = Ink, maxLines = 1, modifier = Modifier.weight(1f, fill = false).alignByBaseline())
        page.standing?.let { Text("　$it", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Ink, maxLines = 1, modifier = Modifier.alignByBaseline()) }
    }
    // きょうの紙面（目次）
    if (page.index.isNotEmpty()) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = 4.dp).border(1.dp, Ink)) {
            Text("きょうの紙面", fontSize = 10.sp, fontWeight = FontWeight.Black, color = Paper, modifier = Modifier.background(if (national) Navy else Ink).padding(horizontal = 6.dp, vertical = 2.dp))
            page.index.forEach { Text(it, fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Ink, maxLines = 1, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)) }
        }
    }
}

/** 1面・2面・3面の切り替え */
@Composable
private fun PageTabs(pages: List<Int>, now: Int, onPick: (Int) -> Unit) {
    val names = mapOf(1 to "1面", 2 to "2面 チーム", 3 to "3面 記録")
    Row(Modifier.fillMaxWidth().padding(top = 6.dp).drawBehind { drawLine(Ink, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }) {
        pages.forEach { p ->
            Text(
                names[p] ?: "${p}面",
                fontSize = 12.sp,
                fontWeight = FontWeight.Black,
                color = if (p == now) Paper else InkSoft,
                modifier = Modifier.padding(end = 2.dp).border(1.dp, Ink).background(if (p == now) Ink else Shade).clickable { onPick(p) }.padding(horizontal = 12.dp, vertical = 4.dp),
            )
        }
    }
}

// ------------------------------------------------------------------------------------------
// 1面

@Composable
private fun FrontView(page: FrontPage, accent: Color, onLink: (String) -> Unit, onOpenProcedures: () -> Unit, onPage: (Int) -> Unit) {
    Shako(page.alerts, onOpenProcedures)
    if (page.extra) {
        Text(
            "号　外",
            color = Color.White,
            fontFamily = PaperGothic,
            fontWeight = FontWeight.Black,
            fontSize = 20.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp).fillMaxWidth().background(Red).padding(vertical = 2.dp),
        )
    }
    val score = page.score
    if (score != null) {
        PhotoStage(page, accent, Modifier.padding(top = 6.dp).clickable { onLink(LINK_GAMES) })
        page.caption?.let { Text(it, fontSize = 9.sp, color = InkSoft, modifier = Modifier.padding(top = 2.dp)) }
        LeadBlock(page)
        BoxLine(page)
    } else {
        // 試合の無い時期（手続き・オフ）は、黒ベタの見出しと横書きのリード
        Column(Modifier.padding(top = 6.dp).fillMaxWidth().background(Ink).padding(horizontal = 10.dp, vertical = 8.dp)) {
            page.kicker?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.Black, color = Yellow) }
            Text(page.headline, fontFamily = PaperGothic, fontWeight = FontWeight.Black, fontSize = 30.sp, lineHeight = 36.sp, color = Color.White)
        }
        page.subhead?.let { Text(it, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 16.sp, color = Ink, modifier = Modifier.padding(top = 6.dp)) }
        page.lead?.let { Text(paperText("　$it"), fontFamily = FontFamily.Serif, fontSize = 13.sp, lineHeight = 21.sp, color = Ink, modifier = Modifier.padding(top = 6.dp)) }
    }
    val articles = (page.frontArticles ?: page.articles).filter { it.link != LINK_TIPS }
    ArticleGrid(articles, onLink, vertical = true, firstWide = false)
    page.column?.let { ColumnBox(it, if (page.paper == FrontPage.Paper.National) "論説" else "球報抄", onLink) }
    if (page.results.isNotEmpty()) ResultsTable(page)
    else if (page.shorts.isNotEmpty()) {
        Text("リーグ短信", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 13.sp, color = Ink, modifier = Modifier.padding(top = 8.dp))
        page.shorts.forEach { Text("▽$it", fontSize = 12.sp, color = Ink, lineHeight = 18.sp) }
    }
    if (page.teamPage != null) {
        Text("2面に詳報 ▶", fontSize = 12.sp, fontWeight = FontWeight.Black, color = Ink, textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth().padding(top = 8.dp).clickable { onPage(2) })
    }
}

/** 手続きのお知らせ（社告） */
@Composable
private fun Shako(alerts: List<String>, onOpenProcedures: () -> Unit) {
    if (alerts.isEmpty()) return
    Column(Modifier.padding(top = 6.dp).fillMaxWidth().border(2.dp, Red).clickable(onClick = onOpenProcedures).padding(horizontal = 8.dp, vertical = 5.dp)) {
        alerts.forEachIndexed { i, a ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = if (i > 0) 3.dp else 0.dp)) {
                if (i == 0) Text("社告", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Black, modifier = Modifier.background(Red).padding(horizontal = 5.dp))
                Text(a, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Ink, modifier = Modifier.weight(1f).padding(start = if (i == 0) 6.dp else 36.dp))
            }
        }
        Text("手続きへ →", fontSize = 11.sp, color = Red, fontWeight = FontWeight.Black, textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth())
    }
}

/** 写真（球場）と、その上に重ねる見出し */
@Composable
private fun PhotoStage(page: FrontPage, accent: Color, modifier: Modifier) {
    val score = page.score ?: return
    val ls = page.lineScore
    val (top, bottom) = ls?.let { lineScoreCells(it.awayRuns, it.homeRuns, it.walkOff) } ?: (emptyList<String>() to emptyList())
    val lose = page.tone == FrontPage.Tone.Lose
    val national = page.paper == FrontPage.Paper.National
    val strip = when { national -> Navy; lose -> Ink; page.tone == FrontPage.Tone.Win -> Red; else -> Ink }
    val subFill = if (lose || national) Color.White else Yellow
    val subStroke = if (national) Navy else Ink
    val height = 284.dp
    Box(modifier.fillMaxWidth().height(height).border(1.dp, Ink)) {
        StadiumPhoto(
            away = ls?.away ?: score.away,
            home = ls?.home ?: score.home,
            top = top,
            bottom = bottom,
            awayTotal = score.awayScore,
            homeTotal = score.homeScore,
            seed = page.issue.hashCode() + page.headline.hashCode(),
            muted = lose,
            board = if (national) Color(0xFF1D2A3A) else Color(0xFF123524),
            modifier = Modifier.fillMaxSize(),
            scene = page.scene,
            sceneImage = shotImageRes(page.shots, page.issue.hashCode())?.let { ImageBitmap.imageResource(it) },
        )
        Row(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f).fillMaxHeight()) {
                page.kicker?.let {
                    Text(it, fontSize = 11.sp, fontWeight = FontWeight.Black, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.background(if (lose) Color.White else Yellow).padding(horizontal = 7.dp, vertical = 2.dp))
                }
                // 斜めの黒帯（主役）
                (page.subhead ?: page.bigSub?.takeIf { page.bigHead == null })?.let { band ->
                    Box(Modifier.align(Alignment.BottomStart).padding(bottom = 10.dp, end = 4.dp).drawBehind { slantBand(if (national) Navy else Ink, if (lose) Color.White else Yellow) }.padding(start = 10.dp, end = 14.dp, top = 3.dp, bottom = 4.dp)) {
                        Text(band, fontFamily = PaperGothic, fontWeight = FontWeight.Black, fontStyle = FontStyle.Italic, fontSize = 21.sp, lineHeight = 25.sp, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            val density = LocalDensity.current
            val avail = with(density) { (height - 12.dp).toPx() }
            // 黄色の袋文字（縦）
            page.bigSub?.takeIf { page.bigHead != null }?.replace("　", "")?.let { sub ->
                val em = with(density) { 25.sp.toPx() }
                // 「、。」が列の終わりにぶら下がる分（1マス）を残す
                val per = ((avail / em).toInt() - 1).coerceAtLeast(4)
                VerticalText(sub, 25.sp, subFill, Modifier.padding(top = 8.dp, end = 2.dp), per = per, gap = 0.15f, stroke = subStroke to with(density) { 3.dp.toPx() })
            }
            // 縦の大見出し
            page.bigHead?.let { head ->
                val n = verticalCells(head).size.coerceAtLeast(1)
                val size = with(density) { (avail / n).coerceAtMost(66.sp.toPx()).toSp() }
                Box(Modifier.fillMaxHeight().background(strip).padding(horizontal = 3.dp, vertical = 5.dp)) {
                    VerticalText(head, size, Color.White, shadow = Shadow(Color.Black.copy(alpha = 0.5f), Offset(5f, 5f), 0f))
                }
            }
        }
    }
}

/** リード（縦書き）とヒーロー欄と縦の小見出し */
@Composable
private fun LeadBlock(page: FrontPage) {
    val lead = page.lead ?: return
    BoxWithConstraints(Modifier.fillMaxWidth().padding(top = 7.dp)) {
        val density = LocalDensity.current
        val heroW = if (page.hero != null) 106.dp else 0.dp
        val headW = if (page.leadHead != null) 30.dp else 0.dp
        val leadW = maxWidth - heroW - headW - 16.dp
        val fs = 13.sp
        val em = with(density) { fs.toPx() }
        val per = verticalFit("　$lead", with(density) { leadW.toPx() }, em, 0.6f, minPer = 12)
        // 「、。」が列の終わりにぶら下がる分（1マス）も高さに取る
        val h = with(density) { (em * (per + 1) + em * 0.1f).toDp() }
        Row(Modifier.fillMaxWidth().height(h), horizontalArrangement = Arrangement.End) {
            page.hero?.let { HeroBox(it, Modifier.width(heroW).fillMaxHeight()) }
            Spacer(Modifier.weight(1f))
            VerticalText("　$lead", fs, Ink, per = per, gap = 0.6f, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Normal)
            page.leadHead?.let {
                Box(Modifier.padding(start = 6.dp).fillMaxHeight().drawBehind { drawLine(Ink, Offset(0f, 0f), Offset(0f, size.height), 1.dp.toPx()) }.padding(start = 5.dp)) {
                    VerticalText(it, 18.sp, Ink, per = ((per + 1) * 13 / 18 - 1).coerceAtLeast(1), gap = 0.2f, fontFamily = FontFamily.Serif)
                }
            }
        }
    }
}

@Composable
private fun HeroBox(hero: jp.icenorth.baseball.shared.PaperHero, modifier: Modifier) {
    val win = hero.title != "敗戦の中の光"
    Column(modifier.border(2.dp, Ink).background(if (win) Color(0xFFFFF8D6) else Color(0xFFEDEDED))) {
        Text(hero.title, fontSize = 10.sp, fontWeight = FontWeight.Black, color = Color.White, textAlign = TextAlign.Center, maxLines = 1, modifier = Modifier.fillMaxWidth().background(if (win) Red else Ink).padding(vertical = 1.dp))
        Row(Modifier.fillMaxSize().padding(5.dp)) {
            Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.Bottom) {
                hero.lines.forEach { (t, strong) ->
                    Text(t, fontSize = if (strong) 15.sp else 10.sp, fontFamily = if (strong) FontFamily.Serif else FontFamily.Default, fontWeight = if (strong) FontWeight.Black else FontWeight.Normal, color = if (strong && win) Red else Ink, maxLines = 1, lineHeight = if (strong) 17.sp else 13.sp)
                }
                hero.season?.let { Text(it, fontSize = 9.sp, color = Ink, maxLines = 1, modifier = Modifier.padding(top = 2.dp).drawBehind { drawLine(Ink, Offset(0f, 0f), Offset(size.width, 0f), 1f) }.padding(top = 1.dp)) }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                VerticalText(hero.name.replace(" ", "").replace("　", ""), 19.sp, Ink, fontFamily = FontFamily.Serif)
                if (hero.position.isNotEmpty()) VerticalText(hero.position, 9.sp, Ink, Modifier.padding(top = 4.dp), fontWeight = FontWeight.Bold, fontFamily = FontFamily.Default)
            }
        }
    }
}

/** 勝敗投手・本塁打の欄（上下に線を引いて詰める） */
@Composable
private fun BoxLine(page: FrontPage) {
    if (page.box.isEmpty()) return
    val s = page.score
    Text(
        buildAnnotatedString {
            s?.let { withStyle(SpanStyle(fontWeight = FontWeight.Black)) { append("【${it.away} ${it.awayScore}―${it.homeScore} ${it.home}】 ") } }
            page.box.forEach { (mark, text) ->
                withStyle(SpanStyle(background = Ink, color = Paper, fontWeight = FontWeight.Black, fontSize = 9.sp)) { append(" $mark ") }
                append(" $text　")
            }
        },
        fontSize = 11.sp,
        lineHeight = 17.sp,
        color = Ink,
        modifier = Modifier.padding(top = 7.dp).fillMaxWidth()
            .drawBehind {
                drawLine(Ink, Offset(0f, 0f), Offset(size.width, 0f), 2.dp.toPx())
                drawLine(Ink, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
            }
            .padding(vertical = 3.dp),
    )
}

/**
 * 記事を2段に並べる。[vertical] なら見出しを縦書きにして、記事ごとに形を変える（黒ベタ・赤の水玉・無地）
 */
@Composable
private fun ArticleGrid(articles: List<FrontPage.Article>, onLink: (String) -> Unit, vertical: Boolean, firstWide: Boolean) {
    if (articles.isEmpty()) return
    val rows = mutableListOf<List<FrontPage.Article>>()
    var rest = articles
    if (firstWide) { rows += listOf(rest.first()); rest = rest.drop(1) }
    rows += rest.chunked(2)
    var n = 0
    rows.forEach { pair ->
        HRule(Modifier.padding(top = 8.dp))
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(top = 7.dp)) {
            pair.forEachIndexed { i, a ->
                if (i > 0) Box(Modifier.padding(horizontal = 7.dp).width(1.dp).fillMaxHeight().background(Rule))
                ArticleBlock(a, n++, Modifier.weight(1f), onLink, vertical)
            }
        }
    }
}

@Composable
private fun ArticleBlock(article: FrontPage.Article, n: Int, modifier: Modifier, onLink: (String) -> Unit, vertical: Boolean) {
    val link = article.link
    val warn = article.kicker in setOf("警戒警報", "タイトル戦線", "記録達成", "決定")
    Row(modifier.then(if (link != null) Modifier.clickable { onLink(link) } else Modifier)) {
        Column(Modifier.weight(1f)) {
            Text(
                article.kicker,
                color = if (warn) Color.White else Ink,
                fontSize = 9.sp,
                fontWeight = FontWeight.Black,
                modifier = Modifier.border(1.dp, if (warn) Red else Ink).background(if (warn) Red else Color.Transparent).padding(horizontal = 4.dp),
            )
            if (!vertical) Text(article.title, fontFamily = PaperGothic, fontWeight = FontWeight.Black, fontSize = 14.sp, lineHeight = 18.sp, color = Ink, modifier = Modifier.padding(top = 3.dp))
            Text(paperText(article.body), fontFamily = FontFamily.Serif, fontSize = 12.sp, lineHeight = 19.sp, color = Ink, modifier = Modifier.padding(top = 3.dp))
        }
        if (vertical) {
            val per = 8
            when (if (warn) 1 else n % 3) {
                0 -> Box(Modifier.padding(start = 5.dp).background(Ink).padding(horizontal = 2.dp, vertical = 5.dp)) { VerticalText(article.title, 17.sp, Color.White, per = per, gap = 0.12f) }
                1 -> Box(Modifier.padding(start = 5.dp).drawBehind { dots(Red.copy(alpha = 0.3f)) }.padding(horizontal = 2.dp, vertical = 4.dp)) { VerticalText(article.title, 17.sp, Red, per = per, gap = 0.12f) }
                else -> Box(Modifier.padding(start = 5.dp)) { VerticalText(article.title, 17.sp, Ink, per = per, gap = 0.12f) }
            }
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.dots(c: Color) {
    val step = 4.5.dp.toPx()
    var y = step / 2
    while (y < size.height) {
        var x = step / 2
        while (x < size.width) { drawCircle(c, 1.1.dp.toPx(), Offset(x, y)); x += step }
        y += step
    }
}

/** 囲みのコラム（TIPS） */
@Composable
private fun ColumnBox(a: FrontPage.Article, name: String, onLink: (String) -> Unit) {
    Row(Modifier.padding(top = 9.dp).fillMaxWidth().height(IntrinsicSize.Min).border(1.dp, Ink).then(a.link?.let { l -> Modifier.clickable { onLink(l) } } ?: Modifier)) {
        Column(Modifier.weight(1f).padding(horizontal = 8.dp, vertical = 6.dp)) {
            Text(a.title, fontWeight = FontWeight.Black, fontSize = 12.sp, color = Ink)
            Text(paperText(a.body), fontFamily = FontFamily.Serif, fontSize = 12.sp, lineHeight = 19.sp, color = Ink)
        }
        Box(Modifier.fillMaxHeight().drawBehind {
            drawLine(Ink, Offset(0f, 0f), Offset(0f, size.height), 1.dp.toPx())
            var x = -size.height
            while (x < size.width) { drawLine(Color.Black.copy(alpha = 0.16f), Offset(x, size.height), Offset(x + size.height, 0f), 1.5.dp.toPx()); x += 5.dp.toPx() }
        }.padding(horizontal = 5.dp, vertical = 8.dp)) {
            VerticalText(name, 16.sp, Ink, fontFamily = FontFamily.Serif, gap = 0f)
        }
    }
}

/** きのうの結果（勝った側を太字に） */
@Composable
private fun ResultsTable(page: FrontPage) {
    Column(Modifier.padding(top = 9.dp)) {
        Text("きのうの結果", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Paper, modifier = Modifier.background(if (page.paper == FrontPage.Paper.National) Navy else Ink).padding(horizontal = 8.dp, vertical = 1.dp))
        Box(Modifier.fillMaxWidth().height(2.dp).background(Ink))
        page.results.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth().drawBehind { drawLine(Rule, Offset(0f, size.height), Offset(size.width, size.height), 1f) }.padding(vertical = 2.dp)) {
                pair.forEach { r ->
                    val aw = r.awayScore > r.homeScore
                    val hw = r.homeScore > r.awayScore
                    Text(r.away, fontSize = 12.sp, fontWeight = if (aw) FontWeight.Black else FontWeight.Normal, color = Ink, maxLines = 1, modifier = Modifier.weight(1f))
                    Text("${r.awayScore} ― ${r.homeScore}", fontSize = 12.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, color = Ink, textAlign = TextAlign.Center, modifier = Modifier.weight(1.1f))
                    Text(r.home, fontSize = 12.sp, fontWeight = if (hw) FontWeight.Black else FontWeight.Normal, color = Ink, maxLines = 1, modifier = Modifier.weight(1f))
                }
                if (pair.size == 1) Spacer(Modifier.weight(3.1f))
            }
        }
    }
}

/** 速報を見るまでの紙面（結果を伏せる） */
@Composable
private fun SealedFront(page: FrontPage, onLink: (String) -> Unit, onOpenProcedures: () -> Unit) {
    Shako(page.alerts, onOpenProcedures)
    Box(Modifier.padding(top = 6.dp).fillMaxWidth().height(240.dp).border(1.dp, Ink), contentAlignment = Alignment.Center) {
        PressLines(Modifier.fillMaxSize())
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("輪 転 機 　稼 働 中", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Color.White, modifier = Modifier.background(Ink).padding(horizontal = 10.dp, vertical = 1.dp))
            Text("ただいま印刷中", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 32.sp, letterSpacing = 4.sp, color = Ink, modifier = Modifier.padding(top = 10.dp))
            Text("試合の速報を見ると、きょうの1面が刷り上がります", fontSize = 11.sp, color = InkSoft, modifier = Modifier.padding(top = 8.dp))
        }
    }
    val articles = page.articles.filter { it.link != LINK_TIPS }
    ArticleGrid(articles, onLink, vertical = false, firstWide = true)
    (page.column ?: page.articles.firstOrNull { it.link == LINK_TIPS })?.let { ColumnBox(it, "球報抄", onLink) }
}

// ------------------------------------------------------------------------------------------
// 2面（チーム面）

@Composable
private fun SectionBar(title: String, sub: String?) {
    Row(
        Modifier.padding(top = 8.dp).fillMaxWidth()
            .drawBehind {
                drawLine(Ink, Offset(0f, 0f), Offset(size.width, 0f), 3.dp.toPx())
                drawLine(Ink, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
            }
            .padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 16.sp, letterSpacing = 5.sp, color = Ink)
        sub?.let { Text(it, fontSize = 10.sp, color = InkSoft, modifier = Modifier.padding(start = 6.dp), maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
}

@Composable
private fun SmallHead(text: String, modifier: Modifier = Modifier) {
    Text(text, fontWeight = FontWeight.Black, fontSize = 12.sp, color = Ink, modifier = modifier.fillMaxWidth().drawBehind { drawLine(Ink, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }.padding(bottom = 1.dp))
}

@Composable
private fun KeyValue(k: String, v: String, valueColor: Color = Ink) {
    Row(Modifier.fillMaxWidth().drawBehind { drawLine(Rule, Offset(0f, size.height), Offset(size.width, size.height), 1f) }.padding(vertical = 1.dp)) {
        Text(k, fontSize = 11.sp, color = Ink, modifier = Modifier.weight(1f), maxLines = 1)
        Text(v, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = valueColor, maxLines = 1)
    }
}

@Composable
private fun TeamPageView(t: TeamPage, accent: Color, onLink: (String) -> Unit, onNext: () -> Unit) {
    SectionBar(t.section, "チームの今と、ベンチ裏から")
    t.interview?.let { iv ->
        Text(iv.title, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 17.sp, lineHeight = 22.sp, color = Ink, modifier = Modifier.padding(top = 6.dp))
        Row(Modifier.padding(top = 4.dp)) {
            Column(Modifier.padding(end = 8.dp)) {
                CoachFace(accent, Modifier.size(78.dp, 88.dp))
                Text("▲${iv.speaker}", fontSize = 9.sp, color = InkSoft)
            }
            Column(Modifier.weight(1f)) {
                Text("　${iv.intro}", fontFamily = FontFamily.Serif, fontSize = 12.sp, lineHeight = 19.sp, color = Ink)
                iv.qa.forEach { (q, a) ->
                    Text(q, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 12.sp, lineHeight = 19.sp, color = InkSoft)
                    Text(
                        buildAnnotatedString {
                            withStyle(SpanStyle(fontWeight = FontWeight.Black)) { append(iv.speaker) }
                            append("「$a」")
                        },
                        fontFamily = FontFamily.Serif, fontSize = 12.sp, lineHeight = 19.sp, color = Ink,
                    )
                }
            }
        }
        Text("（担当記者）", fontSize = 9.sp, color = InkSoft, textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth())
    }
    HRule(Modifier.padding(top = 6.dp))
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(top = 5.dp)) {
        Column(Modifier.weight(1f)) {
            SmallHead("チームの今")
            if (t.form.isNotEmpty()) {
                Text("直近${t.form.size}試合（右が最新）", fontSize = 9.sp, color = InkSoft, modifier = Modifier.padding(top = 2.dp))
                Text(
                    buildAnnotatedString { t.form.forEach { r -> withStyle(SpanStyle(color = if (r > 0) Red else Ink)) { append(when { r > 0 -> "○"; r < 0 -> "●"; else -> "△" }) } } },
                    fontSize = 14.sp, letterSpacing = 1.sp,
                )
            }
            t.now.forEach { (k, v) -> KeyValue(k, v) }
            t.nowNote?.let { Text("　$it", fontFamily = FontFamily.Serif, fontSize = 11.sp, lineHeight = 17.sp, color = Ink, modifier = Modifier.padding(top = 3.dp)) }
        }
        Box(Modifier.padding(horizontal = 7.dp).width(1.dp).fillMaxHeight().background(Rule))
        Column(Modifier.weight(1f)) {
            if (t.conditions.isNotEmpty()) {
                SmallHead("調子の矢印")
                t.conditions.forEach { c ->
                    Row(Modifier.fillMaxWidth().drawBehind { drawLine(Rule, Offset(0f, size.height), Offset(size.width, size.height), 1f) }.padding(vertical = 1.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(arrowText(c.arrow), fontSize = 13.sp, fontWeight = FontWeight.Black, color = if (c.arrow > 0) Red else if (c.arrow < 0) Navy else Ink, modifier = Modifier.width(16.dp))
                        Text(c.name, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Ink, maxLines = 1)
                        Text("（${c.position}）", fontSize = 10.sp, color = InkSoft, maxLines = 1)
                        Text(c.note, fontSize = 9.sp, color = InkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f), textAlign = TextAlign.End)
                    }
                }
            }
            if (t.pitchers.isNotEmpty() || t.rotation != null) {
                SmallHead("投手陣の疲れ", Modifier.padding(top = 6.dp))
                t.pitchers.forEach { (n, s, warn) -> KeyValue(n, if (warn) "$s 要休養" else s, if (warn) Red else Ink) }
                t.rotation?.let { KeyValue("次の先発", it) }
            }
        }
    }
    ArticleGrid(t.articles, onLink, vertical = false, firstWide = true)
    Text("3面 記録・順位 ▶", fontSize = 12.sp, fontWeight = FontWeight.Black, color = Ink, textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth().padding(top = 8.dp).clickable(onClick = onNext))
}

private fun arrowText(a: Int) = when (a) { 2 -> "↑"; 1 -> "↗"; 0 -> "→"; -1 -> "↘"; else -> "↓" }

// ------------------------------------------------------------------------------------------
// 3面（記録面）

@Composable
private fun RecordPageView(r: RecordPage, onLink: (String) -> Unit, onBack: () -> Unit) {
    if (r.game != null) {
        SectionBar("記録", r.game)
        r.reviewHead?.let { Text(it, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 15.sp, color = Ink, modifier = Modifier.padding(top = 5.dp)) }
        r.review?.let { Text("　$it", fontFamily = FontFamily.Serif, fontSize = 11.sp, lineHeight = 17.sp, color = Ink, modifier = Modifier.padding(top = 2.dp)) }
        if (r.boxes.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(top = 6.dp)) {
                r.boxes.forEachIndexed { i, b ->
                    if (i > 0) Box(Modifier.padding(horizontal = 5.dp).width(1.dp).fillMaxHeight().background(Rule))
                    BoxScore(b, Modifier.weight(1f))
                }
            }
        }
        if (r.notes.isNotEmpty()) Text(r.notes.joinToString("　"), fontSize = 10.sp, lineHeight = 15.sp, color = Ink, modifier = Modifier.padding(top = 4.dp).fillMaxWidth().drawBehind { drawLine(Ink, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }.padding(top = 2.dp))
        if (r.relays.isNotEmpty()) Text(
            buildAnnotatedString { withStyle(SpanStyle(fontWeight = FontWeight.Black)) { append("継投メモ　") }; append(r.relays.joinToString("　")) },
            fontSize = 10.sp, lineHeight = 15.sp, color = Ink, modifier = Modifier.padding(top = 2.dp),
        )
    }
    SectionBar("順位と成績", null)
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(top = 3.dp)) {
        if (r.standings.isNotEmpty()) Column(Modifier.weight(1.1f)) {
            TableRow(listOf("", r.leagueName, "勝", "敗", "差", "直近"), header = true)
            r.standings.forEach { s -> TableRow(listOf("${s.rank}", s.team, "${s.w}", "${s.l}", s.gb, s.note), bold = s.mine, shade = s.mine) }
        }
        if (r.probables.isNotEmpty()) {
            Box(Modifier.padding(horizontal = 6.dp).width(1.dp).fillMaxHeight().background(Rule))
            Column(Modifier.weight(1f)) {
                SmallHead(r.probablesTitle ?: "予告先発")
                r.probables.forEach { (t, mine) -> Text(t, fontSize = 10.sp, lineHeight = 15.sp, color = if (mine) Ink else InkSoft, fontWeight = if (mine) FontWeight.Black else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
        }
    }
    if (r.leaders.isNotEmpty()) {
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(top = 7.dp)) {
            r.leaders.forEachIndexed { i, b ->
                if (i > 0) Box(Modifier.padding(horizontal = 4.dp).width(1.dp).fillMaxHeight().background(Rule))
                Column(Modifier.weight(1f)) {
                    SmallHead(b.title)
                    b.rows.forEachIndexed { k, row ->
                        Row {
                            Text("${k + 1} ${row.name}", fontSize = 10.sp, fontWeight = if (row.mine) FontWeight.Black else FontWeight.Normal, color = Ink, maxLines = 1, overflow = TextOverflow.Clip, modifier = Modifier.weight(1f))
                            Text("（${row.team}）", fontSize = 9.sp, color = InkSoft, maxLines = 1)
                            Text(row.value, fontSize = 10.sp, fontWeight = if (row.mine) FontWeight.Black else FontWeight.Normal, color = Ink, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
    if (r.shorts.isNotEmpty()) {
        SectionBar("リーグ短信", "ほかの球団の話題")
        ArticleGrid(r.shorts, onLink, vertical = false, firstWide = false)
    }
    Text("◀ 1面にもどる", fontSize = 12.sp, fontWeight = FontWeight.Black, color = Ink, textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth().padding(top = 8.dp).clickable(onClick = onBack))
}

private val BOX_W = listOf(14.dp, null, 18.dp, 18.dp, 18.dp, 16.dp)
private val PITCH_W = listOf(null, 22.dp, 16.dp, 16.dp, 16.dp, 20.dp)

@Composable
private fun BoxScore(b: BoxTeam, modifier: Modifier) {
    Column(modifier) {
        Text(b.name, fontSize = 10.sp, fontWeight = FontWeight.Black, color = Ink, modifier = Modifier.border(1.dp, Ink).padding(horizontal = 4.dp))
        TableRow(listOf("", "打撃", "打", "安", "点", "本"), header = true, widths = BOX_W)
        b.batters.forEach { x ->
            TableRow(listOf(x.pos, if (x.sub) " ${x.name}" else x.name, "${x.ab}", "${x.h}", "${x.rbi}", if (x.hr > 0) "${x.hr}" else ""), widths = BOX_W, strongCol = if (x.h >= 2) 3 else -1)
        }
        TableRow(listOf("", "計") + b.totals.map { "$it" }, widths = BOX_W, bold = true, topRule = true)
        Spacer(Modifier.height(4.dp))
        TableRow(listOf("投手", "回", "安", "振", "失", "球"), header = true, widths = PITCH_W)
        b.pitchers.forEach { p -> TableRow(listOf(p.name, p.ip, "${p.h}", "${p.so}", "${p.r}", "${p.pitches}"), widths = PITCH_W) }
    }
}

/** 小さな表の1行。[widths] の null の列は残りの幅を使う（左寄せ） */
@Composable
private fun TableRow(
    cells: List<String>,
    header: Boolean = false,
    bold: Boolean = false,
    shade: Boolean = false,
    topRule: Boolean = false,
    widths: List<Dp?>? = null,
    strongCol: Int = -1,
) {
    val ws = widths ?: listOf(14.dp, null, 20.dp, 20.dp, 26.dp, 34.dp)
    Row(
        Modifier.fillMaxWidth()
            .then(if (shade) Modifier.background(Shade) else Modifier)
            .drawBehind {
                if (header) drawLine(Ink, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
                if (topRule) drawLine(Ink, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx())
            },
    ) {
        cells.forEachIndexed { i, c ->
            val w = ws.getOrNull(i)
            Text(
                c,
                fontSize = if (header) 9.sp else 10.5.sp,
                lineHeight = 14.sp,
                fontWeight = if (bold || header || i == strongCol) FontWeight.Black else FontWeight.Normal,
                color = if (i == 0 && !header) InkSoft else Ink,
                maxLines = 1,
                overflow = TextOverflow.Clip,
                textAlign = if (w == null) TextAlign.Start else TextAlign.Center,
                modifier = if (w == null) Modifier.weight(1f) else Modifier.widthIn(min = w).width(w),
            )
        }
    }
}

@Composable
private fun HRule(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(Rule))
}
