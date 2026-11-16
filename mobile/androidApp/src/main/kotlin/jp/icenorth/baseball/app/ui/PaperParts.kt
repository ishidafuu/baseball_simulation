package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import jp.icenorth.baseball.app.R
import jp.icenorth.baseball.shared.verticalCells
import jp.icenorth.baseball.shared.verticalColumns
import kotlin.math.ceil
import kotlin.random.Random

/*
 * 新聞風の紙面の部品（縦書き・球場の写真）。FrontPageCard.kt から使う。
 *
 * ⚠ Compose には縦書きが無いので、1字ずつ並べて描く（右の列から左へ）。
 *    「、。」は字の枠の右上へ、「ー」「（）」「―」などは90度回す、小さい「っゃゅょ」は少し右上へ、
 *    2〜3字の数字・英字は横に並べて1字分に詰める（縦中横）。
 * ⚠ 見出しの極太ゴシックは Noto Sans JP Black（SIL OFL。res/font、ライセンスは androidApp/FONT-LICENSE-NotoSansJP.txt）。
 *    端末の標準の字は太さが足りない機種があるので、見出しだけアプリに入れた字を使う。
 */

/**
 * 1面の写真に影絵を描くか。いしだ 2026-11-17「影絵の絵が整うまでは影絵なしで」。
 * 絵（PaperSilhouettes.kt の SHOT_IMAGES）がそろったら true にする
 */
internal const val SILHOUETTES_ON = false

/** 見出しの極太ゴシック */
val PaperGothic = FontFamily(Font(R.font.noto_sans_jp_black, FontWeight.Black))

/**
 * 縦書きの文字。[per] は1列のマスの数（null なら1列に全部）。大きさは列の数とマスの数から決まる。
 * ⚠ 「、。」は列の終わりにぶら下げるので、[per] を決めて高さを取る側は [per]＋1 マスの高さを見込む
 *   （割り付けは shared の verticalColumns）
 * @param gap 列の間（字の大きさに対する割合）
 * @param stroke 袋文字のふち（色と太さ）
 */
@Composable
fun VerticalText(
    text: String,
    fontSize: TextUnit,
    color: Color,
    modifier: Modifier = Modifier,
    per: Int? = null,
    gap: Float = 0.45f,
    fontFamily: FontFamily = PaperGothic,
    fontWeight: FontWeight = FontWeight.Black,
    stroke: Pair<Color, Float>? = null,
    shadow: Shadow? = null,
) {
    val measurer = rememberTextMeasurer()
    val cells = remember(text) { verticalCells(text) }
    val cols = remember(cells, per) { verticalColumns(cells, per ?: cells.size.coerceAtLeast(1)) }
    val density = LocalDensity.current
    val em = with(density) { fontSize.toPx() }
    val rows = cols.maxOfOrNull { it.size } ?: 0
    val wPx = if (cols.isEmpty()) 0f else cols.size * em + (cols.size - 1) * em * gap + (stroke?.second ?: 0f) * 2
    val hPx = rows * em + em * 0.1f
    val style = TextStyle(fontSize = fontSize, fontFamily = fontFamily, fontWeight = fontWeight, color = color)
    // 1字ずつ描くので、読み上げ・検査用に元の文をまとめて持たせる
    Canvas(modifier.semantics { this.text = AnnotatedString(text) }.size(with(density) { wPx.toDp() }, with(density) { hPx.toDp() })) {
        cols.forEachIndexed { ci, col ->
            // 右の列から
            val x0 = size.width - (stroke?.second ?: 0f) - em - ci * em * (1 + gap)
            col.forEachIndexed { ri, cell ->
                val y0 = ri * em
                val layout = measurer.measure(cell.text, style)
                val w = layout.size.width.toFloat()
                val h = layout.size.height.toFloat()
                val cx = x0 + em / 2
                val cy = y0 + em / 2
                fun draw(at: Offset) {
                    stroke?.let { (c, width) -> drawText(layout, color = c, topLeft = at, drawStyle = Stroke(width = width * 2, join = androidx.compose.ui.graphics.StrokeJoin.Round)) }
                    drawText(layout, color = color, topLeft = at, shadow = shadow, drawStyle = Fill)
                }
                when (cell.kind) {
                    1 -> rotate(90f, Offset(cx, cy)) { draw(Offset(cx - w / 2, cy - h / 2)) }
                    2 -> draw(Offset(cx - w / 2 + em * 0.55f, cy - h / 2 - em * 0.55f))
                    3 -> draw(Offset(cx - w / 2 + em * 0.1f, cy - h / 2 - em * 0.1f))
                    4 -> {
                        val s = (em * 0.98f / w).coerceAtMost(1f)
                        scale(s, 1f, Offset(cx, cy)) { draw(Offset(cx - w / 2, cy - h / 2)) }
                    }
                    else -> draw(Offset(cx - w / 2, cy - h / 2))
                }
            }
        }
    }
}

/** 縦書きの文の列の数と1列のマスの数（[width] に収まるよう、[minPer] マス以上で） */
internal fun verticalFit(text: String, width: Float, em: Float, gap: Float, minPer: Int): Int {
    val n = verticalCells(text).size
    val maxCols = ((width + em * gap) / (em * (1 + gap))).toInt().coerceAtLeast(1)
    return maxOf(minPer, ceil(n / maxCols.toDouble()).toInt() + 1)
}

/** 網点（新聞の写真らしさ）。小さな点の絵を敷き詰める */
private fun halftone(px: Int): ShaderBrush {
    val bmp = ImageBitmap(px, px)
    val c = androidx.compose.ui.graphics.Canvas(bmp)
    c.drawCircle(Offset(px / 2f, px / 2f), px * 0.2f, Paint().apply { color = Color.Black.copy(alpha = 0.32f) })
    return ShaderBrush(ImageShader(bmp, TileMode.Repeated, TileMode.Repeated))
}

/**
 * 球場の写真（の代わりの絵）。夜の球場・照明塔・観客席・得点板・グラウンド。得点板の数字は本物の回ごとの得点。
 * @param top 上の段（先攻）の回ごとの得点の文字（無ければ合計だけ）
 * @param muted 負けた日は色を落とす
 */
@Composable
fun StadiumPhoto(
    away: String,
    home: String,
    top: List<String>,
    bottom: List<String>,
    awayTotal: Int,
    homeTotal: Int,
    seed: Int,
    muted: Boolean,
    board: Color,
    modifier: Modifier = Modifier,
    scene: String? = null,
    sceneImage: ImageBitmap? = null,
) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val dot = remember(density) { halftone(with(density) { 3.dp.roundToPx() }.coerceAtLeast(3)) }
    Canvas(modifier) {
        val paint = Paint().apply { colorFilter = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(if (muted) 0.15f else 1f) }) }
        drawIntoCanvas { it.saveLayer(Rect(Offset.Zero, size), paint) }
        val figure = SILHOUETTES_ON && (sceneImage != null || hasSilhouette(scene))
        drawStadium(this, measurer, away, home, top, bottom, awayTotal, homeTotal, seed, board, roomForFigure = figure)
        // 影絵（左の手前。右は縦の見出し、下は斜めの帯が重なるので、上半身が見える所に立たせる）
        if (!figure) {
            // 影絵を止めている間は球場だけ
        } else if (sceneImage != null) {
            drawSilhouetteImage(sceneImage, size.width * 0.02f, size.height * 0.97f, size.height * 0.64f)
        } else if (hasSilhouette(scene)) {
            val tall = size.height * (if (silhouetteWidth(scene) > 100f) 0.52f else 0.6f)
            drawSilhouettes(scene, size.width * 0.03f + silhouetteWidth(scene) / 2 * tall / 100f, size.height * 0.95f, tall)
        }
        drawIntoCanvas { it.restore() }
        drawRect(dot)
        if (muted) drawRect(Color.Black.copy(alpha = 0.18f))
    }
}

private fun drawStadium(
    d: DrawScope,
    measurer: androidx.compose.ui.text.TextMeasurer,
    away: String,
    home: String,
    top: List<String>,
    bottom: List<String>,
    awayTotal: Int,
    homeTotal: Int,
    seed: Int,
    board: Color,
    roomForFigure: Boolean,
) = with(d) {
    val w = size.width
    val h = size.height
    val u = w / 388f // 見本の絵（幅388）の物差し
    drawRect(Brush.verticalGradient(listOf(Color(0xFF0B1026), Color(0xFF27305C), Color(0xFF5B4A6E)), endY = h * 0.8f))
    // 照明塔（得点板より上に）
    listOf(if (roomForFigure) 110f else 22f, 262f).forEach { x0 ->
        val x = x0 * u
        val y0 = (if (roomForFigure) 4 else 26) * u
        drawRect(Color(0xFF11131F), Offset(x + 13 * u, y0 + 20 * u), Size(3 * u, 120 * u))
        drawRect(Color(0xFF1A1D2E), Offset(x, y0), Size(30 * u, 20 * u))
        for (i in 0 until 4) for (j in 0 until 2) drawCircle(Color(0xFFFFFBE0), 2.3f * u, Offset(x + (4.5f + i * 7) * u, y0 + (5 + j * 9) * u))
        drawCircle(
            Brush.radialGradient(listOf(Color.White.copy(alpha = 0.9f), Color(0xFFFFF6C8).copy(alpha = 0.45f), Color.Transparent), center = Offset(x + 15 * u, y0 + 10 * u), radius = 52 * u),
            52 * u,
            Offset(x + 15 * u, y0 + 10 * u),
        )
    }
    // 観客席
    val standTop = h * 0.56f
    val standBottom = h * 0.80f
    drawPath(Path().apply { moveTo(0f, standTop); lineTo(w, standTop - 12 * u); lineTo(w, standBottom); lineTo(0f, standBottom); close() }, Color(0xFF161A2C))
    val rnd = Random(seed)
    val crowd = listOf(Color(0xFFC9CED9), Color(0xFF8F97AB), Color(0xFFE8C9A0), Color(0xFFC8102E), Color.White, Color(0xFF6B7390))
    repeat(520) {
        val x = rnd.nextFloat() * w
        val y = standTop - 12 * u * x / w + 3 * u + rnd.nextFloat() * (standBottom - standTop - 4 * u)
        drawCircle(crowd[rnd.nextInt(crowd.size)].copy(alpha = 0.8f), 1.1f * u, Offset(x, y))
    }
    // 得点板（影絵があるときは上の帯に。下に選手が立つ）
    val bx = if (roomForFigure) w * 0.04f else 30 * u
    val by = h * (if (roomForFigure) 0.10f else 0.22f)
    val bw = w * 0.6f
    val bh = h * (if (roomForFigure) 0.25f else 0.30f)
    drawRect(Color(0xFF0C0E18), Offset(bx + 20 * u, by + bh), Size(6 * u, standTop - by - bh + 10 * u))
    drawRect(Color(0xFF0C0E18), Offset(bx + bw - 26 * u, by + bh), Size(6 * u, standTop - by - bh + 10 * u))
    drawRect(board, Offset(bx, by), Size(bw, bh))
    drawRect(Color(0xFF0C0E18), Offset(bx, by), Size(bw, bh), style = Stroke(4 * u))
    val small = TextStyle(fontSize = (8 * u).toSp(), color = Color(0xFF9FC7A9), fontWeight = FontWeight.Bold)
    val num = TextStyle(fontSize = (13 * u).toSp(), color = Color.White, fontWeight = FontWeight.Bold)
    val name = TextStyle(fontSize = (12 * u).toSp(), color = Color.White, fontWeight = FontWeight.Black)
    val total = TextStyle(fontSize = (17 * u).toSp(), color = Color(0xFFFFD54A), fontWeight = FontWeight.Black)
    fun text(t: String, style: TextStyle, cx: Float, cy: Float, center: Boolean = true) {
        val l = measurer.measure(t, style)
        drawText(l, topLeft = Offset(if (center) cx - l.size.width / 2f else cx, cy - l.size.height / 2f))
    }
    val rowH = bh / 3.4f
    val y1 = by + rowH * 0.7f
    val y2 = by + rowH * 1.8f
    val y3 = by + rowH * 2.8f
    text(away.take(3), name, bx + 6 * u, y2, center = false)
    text(home.take(3), name, bx + 6 * u, y3, center = false)
    val left = bx + 50 * u
    val right = bx + bw - 30 * u
    val n = top.size
    if (n > 0) {
        val cw = (right - left) / n
        for (i in 0 until n) {
            val cx = left + cw * i + cw / 2
            text("${i + 1}", small, cx, y1)
            text(top[i], num, cx, y2)
            text(bottom.getOrElse(i) { "" }, num, cx, y3)
        }
    }
    text("計", small, bx + bw - 15 * u, y1)
    text("$awayTotal", total, bx + bw - 15 * u, y2)
    text("$homeTotal", total, bx + bw - 15 * u, y3)
    // グラウンド
    drawRect(Color(0xFF1D3F66), Offset(0f, standBottom), Size(w, 6 * u))
    drawRect(Color(0xFF2F6B3A), Offset(0f, standBottom + 6 * u), Size(w, h - standBottom))
    drawPath(Path().apply { moveTo(-20 * u, h); quadraticTo(w * 0.4f, standBottom + 10 * u, w + 20 * u, h); close() }, Color(0xFFB98A5A).copy(alpha = 0.85f))
}

/** 監督の似顔絵（写真の代わり）。帽子は球団の色 */
@Composable
fun CoachFace(cap: Color, modifier: Modifier = Modifier) {
    val density = LocalDensity.current
    val dot = remember(density) { halftone(with(density) { 3.dp.roundToPx() }.coerceAtLeast(3)) }
    Canvas(modifier) {
        val s = size.width / 92f
        drawRect(Color(0xFFCFD6DF))
        drawRect(Color(0xFF9FB3A2), Offset(0f, 70 * s), Size(size.width, size.height - 70 * s))
        drawPath(Path().apply { moveTo(8 * s, size.height); quadraticTo(10 * s, 76 * s, 34 * s, 72 * s); lineTo(58 * s, 72 * s); quadraticTo(82 * s, 76 * s, 84 * s, size.height); close() }, Color(0xFFF4F1EA))
        drawLine(cap, Offset(46 * s, 73 * s), Offset(46 * s, size.height), 2 * s)
        drawRect(Color(0xFFD9A77D), Offset(38 * s, 60 * s), Size(16 * s, 15 * s))
        drawOval(Color(0xFFE3B68E), Offset(29 * s, 26 * s), Size(34 * s, 40 * s))
        drawPath(Path().apply { moveTo(27 * s, 40 * s); quadraticTo(28 * s, 18 * s, 46 * s, 18 * s); quadraticTo(64 * s, 18 * s, 65 * s, 40 * s); close() }, cap)
        drawPath(Path().apply { moveTo(24 * s, 40 * s); quadraticTo(46 * s, 31 * s, 70 * s, 41 * s); lineTo(70 * s, 45 * s); quadraticTo(46 * s, 37 * s, 24 * s, 45 * s); close() }, Color(0xFF1B1A17))
        drawCircle(Color(0xFF1B1A17), 1.6f * s, Offset(39 * s, 48 * s))
        drawCircle(Color(0xFF1B1A17), 1.6f * s, Offset(53 * s, 48 * s))
        drawPath(Path().apply { moveTo(39 * s, 56 * s); quadraticTo(46 * s, 61 * s, 53 * s, 56 * s) }, Color(0xFF7A4A2A), style = Stroke(1.6f * s))
        drawRect(dot)
    }
}

/** 輪転機の帯（伏せた紙面の飾り） */
@Composable
fun PressLines(modifier: Modifier = Modifier) {
    Canvas(modifier) {
        var y = 0f
        val step = 14.dp.toPx()
        while (y < size.height) {
            drawRect(Color.Black.copy(alpha = 0.06f), Offset(0f, y), Size(size.width, 6.dp.toPx()))
            y += step
        }
    }
}

/** 斜めの帯（見出しの黒帯）。影を右下にずらして描く */
fun DrawScope.slantBand(fill: Color, shadow: Color) {
    val skew = size.height * 0.15f
    fun band(dx: Float, dy: Float, c: Color) = drawPath(
        Path().apply {
            moveTo(dx + skew, dy); lineTo(size.width + dx, dy); lineTo(size.width - skew + dx, size.height + dy); lineTo(dx, size.height + dy); close()
        },
        c,
    )
    translate(0f, 0f) {
        band(4.dp.toPx(), 4.dp.toPx(), shadow)
        band(0f, 0f, fill)
    }
}
