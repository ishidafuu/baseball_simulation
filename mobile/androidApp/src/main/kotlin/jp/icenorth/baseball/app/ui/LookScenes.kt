package jp.icenorth.baseball.app.ui

import jp.icenorth.baseball.shared.otherGameCards
import jp.icenorth.baseball.shared.OtherGame
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.clickable
import androidx.compose.animation.togetherWith
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.animation.fadeIn
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import jp.icenorth.baseball.shared.LeagueView
import jp.icenorth.baseball.shared.LiveScene
import jp.icenorth.baseball.shared.NEUTRAL_LOOK
import jp.icenorth.baseball.shared.TodaySide
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.hasLivePlays
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.fieldArt
import jp.icenorth.baseball.shared.highlightIndexes
import jp.icenorth.baseball.shared.liveScenes
import jp.icenorth.baseball.shared.orderPosition
import jp.icenorth.baseball.shared.playTone
import jp.icenorth.baseball.shared.stadiumArt
import jp.icenorth.baseball.shared.stadiumScene
import jp.icenorth.baseball.shared.teamLabel
import jp.icenorth.baseball.shared.teamShort
import jp.icenorth.baseball.shared.todayGameCard
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject

// ============================================================
// 新しい見た目（試作）段3: 試合タブの頭の「今日の一戦」の札と、試合の詳しい画面の打席速報。
// Web 版 `src/online/look/TodayGame.jsx`・`LivePlays.jsx` と同じ中身（文と絵は共通部の
// `TodayGame.kt`・`LookPlay.kt`・`LookScene.kt`。Web と答え合わせしてある）。
// ⚠ **切のときは何も出さない**（試合タブも試合の画面も今までと同じ）。表示専用。
// ============================================================

/** 新しい見た目の夜の地色・金色・金の上の字・白い字の影（今日の一戦・打席速報・球団の出来事の場面で共通） */
internal val LookNight = Color(0xFF0B1220)
internal val LookGold = Color(0xFFFDE68A)
internal val LookGoldInk = Color(0xFF422006)
internal val LookShadow = Shadow(Color.Black, blurRadius = 8f)
private val NightBar = Color(0xFF131C2F)
private val Slate300 = Color(0xFFCBD5E1)
private val Slate400 = Color(0xFF94A3B8)
private val ScoreRed = Color(0xFFF87171)
private val HitYellow = Color(0xFFFACC15)
private val Pressed = Color(0xFF38BDF8)

private fun toneColor(tone: String) = when (tone) {
    "score" -> ScoreRed
    "hit" -> HitYellow
    else -> Slate400
}

/** 本拠地の夜の球場（照明・旗・フェンスは本拠地の球団の色、後ろの景色は土地で海か山、客の入りは順位と連勝） */
@Composable
fun StadiumBackdrop(team: String, city: String, crowd: Double, modifier: Modifier = Modifier) {
    val look = LocalLook.current
    if (!look.on) return
    val home = look.teamLook(team) ?: NEUTRAL_LOOK
    val art = remember(home, city, crowd, team) { stadiumArt(home, stadiumScene(city), crowd, team) }
    LookCanvas(art, modifier.testTag("stadium-art"), crop = true)
}

/** 打席速報の球場の図（その行の後の走者・打球）。Web 版 `PlayField` */
@Composable
fun PlayField(scene: LiveScene, home: String, modifier: Modifier = Modifier) {
    val look = LocalLook.current
    if (!look.on) return
    val fence = look.teamLook(home) ?: NEUTRAL_LOOK
    val offense = look.teamLook(scene.team) ?: NEUTRAL_LOOK
    val bases = scene.basesAfter ?: 0
    val art = remember(fence, offense, scene) { fieldArt(fence, offense, bases, scene.batted, scene.code, scene.runs) }
    LookCanvas(art, modifier.aspectRatio(160f / 136f).semantics { contentDescription = "球場の図（走者と打球）" }.testTag("field-art"))
}

/**
 * 「今日の一戦」の札（試合タブの頭）。今日の試合が無い日は次の試合を「次の一戦」として出す。
 * ⚠ 縦は詰めてある（先方要望 #8）。球団は横並び（マーク・名前・順位）、ひとことは VS の下、
 *    「スタメンを見る」は見出しの右。Web 版 `TodayGame.jsx` と同じ形
 * ⚠ 札の下に、同じ日のほかの試合を重ねて見せ、数秒ごとにめくる（`OtherGamesStack`）
 * @param onLineup 「スタメンを見る」で開く画面（null ならボタンを出さない）
 */
@Composable
fun TodayGameCard(view: LeagueView, onLineup: (() -> Unit)?) {
    val look = LocalLook.current
    if (!look.on) return
    val card = remember(view) { todayGameCard(view) } ?: return
    val others = remember(view) { otherGameCards(view) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(LookNight).testTag("today-game")) {
            StadiumBackdrop(card.home, card.city, card.crowd, Modifier.matchParentSize())
            Column {
                Row(
                    Modifier.fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.7f), Color.Transparent)))
                        .padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "${card.title}　${card.whenText}",
                            style = MaterialTheme.typography.titleSmall,
                            color = Color.White,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(card.place, fontSize = 11.sp, color = Slate300, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (onLineup != null) {
                        Button(
                            onClick = onLineup,
                            colors = ButtonDefaults.buttonColors(containerColor = LookGold, contentColor = LookGoldInk),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 2.dp),
                            modifier = Modifier.height(30.dp),
                        ) { Text("スタメンを見る ›", fontSize = 12.sp, fontWeight = FontWeight.Bold) }
                    }
                }
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    TodaySideBlock(view, card.own, right = false, Modifier.weight(1f))
                    Column(Modifier.widthIn(max = 96.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            "VS",
                            fontFamily = LookGraduate,
                            fontSize = 26.sp,
                            color = LookGold,
                            style = TextStyle(shadow = Shadow(Color(0xFFB45309), androidx.compose.ui.geometry.Offset(0f, 4f), 0f)),
                        )
                        if (card.note.isNotEmpty()) {
                            Text(
                                card.note,
                                fontSize = 10.sp,
                                color = Color.White,
                                textAlign = TextAlign.Center,
                                maxLines = 2,
                                modifier = Modifier.background(LookNight.copy(alpha = 0.8f), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                        }
                    }
                    TodaySideBlock(view, card.foe, right = true, Modifier.weight(1f))
                }
                Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StarterBlock(card.own, right = false, Modifier.weight(1f))
                    StarterBlock(card.foe, right = true, Modifier.weight(1f))
                }
            }
        }
        OtherGamesStack(view, others)
    }
}

@Composable
private fun TodaySideBlock(view: LeagueView, side: TodaySide, right: Boolean, modifier: Modifier) {
    Row(
        modifier.padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = if (right) Arrangement.spacedBy(6.dp, Alignment.End) else Arrangement.spacedBy(6.dp),
    ) {
        if (!right) TeamMark(side.team, size = 46.dp)
        Column(Modifier.weight(1f, fill = false), horizontalAlignment = if (right) Alignment.End else Alignment.Start) {
            Text(
                view.teamLabel(side.team),
                style = MaterialTheme.typography.titleSmall.copy(shadow = LookShadow),
                color = Color.White,
                textAlign = if (right) TextAlign.End else TextAlign.Start,
                maxLines = 2,
            )
            if (side.record.isNotEmpty()) {
                Text(
                    side.record,
                    fontSize = 10.sp,
                    color = Color(0xFFE2E8F0),
                    style = TextStyle(shadow = LookShadow),
                    textAlign = if (right) TextAlign.End else TextAlign.Start,
                    maxLines = 2,
                )
            }
        }
        if (right) TeamMark(side.team, size = 46.dp)
    }
}

/** ほかの試合をめくる間隔（Web 版 `OTHER_GAMES_MS` と同じ） */
private const val OTHER_GAMES_MS = 4000L

/**
 * 同じ日のほかの試合。カードを重ねて1枚ずつ見せ、`OTHER_GAMES_MS` ごとに次へめくる（先方要望 #8）。
 * ⚠ 点を押すとその試合へ（押したところから、また数秒ごとにめくる）
 */
@Composable
private fun OtherGamesStack(view: LeagueView, games: List<OtherGame>) {
    if (games.isEmpty()) return
    val count = games.size
    var index by remember(games) { mutableIntStateOf(0) }
    val at = index % count
    LaunchedEffect(games, index) {
        if (count < 2) return@LaunchedEffect
        delay(OTHER_GAMES_MS)
        index = (index + 1) % count
    }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(LookNight).padding(horizontal = 10.dp, vertical = 8.dp).testTag("other-games"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("ほかの試合", fontSize = 12.sp, color = Color.White, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text("${at + 1}/$count", fontSize = 11.sp, color = Slate400)
        }
        // 後ろに重なっている札（2枚まで）の縁を少しずつずらして見せる
        Box(Modifier.fillMaxWidth()) {
            val behind = minOf(2, count - 1)
            for (k in behind downTo 1) {
                Box(
                    Modifier.matchParentSize()
                        .padding(start = (6 * k).dp, end = (6 * k).dp, top = (5 * k).dp)
                        .offset(y = (5 * k).dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color(0xFF1E293B).copy(alpha = if (k == 1) 0.7f else 0.4f)),
                )
            }
            AnimatedContent(
                targetState = at,
                transitionSpec = {
                    (slideInVertically { it / 3 } + fadeIn(tween(500))) togetherWith (slideOutVertically { -it / 2 } + fadeOut(tween(400)))
                },
                label = "ほかの試合",
            ) { i ->
                // 出ていく側の札は古い番号のまま描かれる。日が進んで試合が減ると games[i] が外れて落ちるので、
                // 外れたら描かない（Web は index % count で同じことを防いでいる）
                games.getOrNull(i)?.let { OtherGameFace(view, it) }
            }
        }
        if (count > 1) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally)) {
                games.forEachIndexed { i, g ->
                    Box(
                        Modifier.size(width = if (i == at) 18.dp else 8.dp, height = 8.dp)
                            .clip(CircleShape)
                            .background(if (i == at) LookGold else Color(0xFF475569))
                            .clickable { index = i }
                            .semantics { contentDescription = "${view.teamLabel(g.away)}対${view.teamLabel(g.home)}" },
                    )
                }
            }
        }
    }
}

@Composable
private fun OtherGameFace(view: LeagueView, g: OtherGame) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0xFF273449)).padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                TeamMark(g.away, size = 28.dp)
                Column {
                    Text(view.teamLabel(g.away), fontSize = 13.sp, color = Color.White, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(g.awayRecord, fontSize = 10.sp, color = Slate300, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Column(Modifier.padding(horizontal = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("VS", fontFamily = LookGraduate, fontSize = 16.sp, color = LookGold)
                Text(g.city.ifEmpty { "ホーム" }, fontSize = 10.sp, color = Slate400, maxLines = 1)
            }
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End)) {
                Column(Modifier.weight(1f, fill = false), horizontalAlignment = Alignment.End) {
                    Text(view.teamLabel(g.home), fontSize = 13.sp, color = Color.White, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(g.homeRecord, fontSize = 10.sp, color = Slate300, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                TeamMark(g.home, size = 28.dp)
            }
        }
        Text(
            "先発　${g.awayStarter ?: "未定"}　−　${g.homeStarter ?: "未定"}",
            fontSize = 11.sp,
            color = Slate300,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun StarterBlock(side: TodaySide, right: Boolean, modifier: Modifier) {
    val s = side.starter
    val accent = lookColor(LocalLook.current.teamLook(side.team)?.c2) ?: Slate400
    Row(
        modifier.height(IntrinsicSize.Min).clip(RoundedCornerShape(10.dp)).background(LookNight.copy(alpha = 0.86f)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!right) Box(Modifier.width(5.dp).fillMaxHeight().background(accent))
        Row(
            Modifier.weight(1f).padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = if (right) Arrangement.spacedBy(8.dp, Alignment.End) else Arrangement.spacedBy(8.dp),
        ) {
            // ⚠ 名前だけの先発（古いビュー）も、Web と同じく名前を種にして顔を出す
            val face: @Composable () -> Unit = { s?.let { PlayerFace(it.id?.toString() ?: it.name, it.age, it.condition, size = 40.dp, team = side.team) } }
            if (!right) face()
            Column(Modifier.weight(1f, fill = false), horizontalAlignment = if (right) Alignment.End else Alignment.Start) {
                Text(s?.mark ?: "先発", fontSize = 10.sp, color = Slate400)
                Text(s?.name ?: "未定", fontSize = 14.sp, color = Color.White, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                s?.line?.takeIf { it.isNotEmpty() }?.let { Text(it, fontSize = 11.sp, color = Slate300, maxLines = 1) }
            }
            if (right) face()
        }
        if (right) Box(Modifier.width(5.dp).fillMaxHeight().background(accent))
    }
}

/** 打席速報を出せる試合か（入で、塁と打球の記録がある＝版20からの試合） */
@Composable
fun livePlaysReady(game: JsonObject): Boolean {
    val on = LocalLook.current.on
    return remember(on, game) { on && hasLivePlays(game) }
}

private const val AUTO_MS = 1800L

/**
 * 打席速報（試合を1打席ずつ追う。球場の図に走者と打球の線、実況の1行、その回の流れ）。
 * ⚠ 中身は試合の `plays`（打席ごとの行）。1球ごとの観戦記録は使わない
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LivePlays(view: LeagueView, game: JsonObject) {
    if (!LocalLook.current.on) return
    val scenes = remember(game, view.teamLabels) { liveScenes(game) { view.teamShort(it) } }
    val highlights = remember(scenes) { highlightIndexes(scenes) }
    // 画面を回しても、いまの打席から続ける
    var index by rememberSaveable(game) { mutableIntStateOf(0) }
    var auto by remember(game) { mutableStateOf(false) }
    var only by rememberSaveable(game) { mutableStateOf(false) }
    val order = remember(only, highlights, scenes) { if (only && highlights.isNotEmpty()) highlights else scenes.indices.toList() }
    val pos = orderPosition(order, index)
    // 自動で次の打席へ（最後まで来たら止まる）
    LaunchedEffect(auto, pos, order) {
        if (!auto) return@LaunchedEffect
        if (pos >= order.size - 1) {
            auto = false
            return@LaunchedEffect
        }
        delay(AUTO_MS)
        index = order[pos + 1]
    }
    val scene = order.getOrNull(pos)?.let { scenes.getOrNull(it) }
    if (scene == null) {
        Muted("この試合の打席の記録はありません。")
        return
    }
    fun go(step: Int) {
        index = order.getOrNull((pos + step).coerceIn(0, order.size - 1)) ?: 0
    }
    val away = game.at("away").str().orEmpty()
    val home = game.at("home").str().orEmpty()
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(LookNight).testTag("live-plays"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // 点の札（両球団と点・回・アウト）
        Row(Modifier.fillMaxWidth().background(NightBar).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TeamMark(away, size = 22.dp, modifier = Modifier.padding(end = 4.dp))
            Text(view.teamShort(away), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            Text(" ${scene.score.first} - ${scene.score.second} ", color = LookGold, fontWeight = FontWeight.Bold, fontSize = 20.sp)
            Text(view.teamShort(home), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            TeamMark(home, size = 22.dp, modifier = Modifier.padding(start = 4.dp))
            Spacer(Modifier.weight(1f))
            Text("${scene.inning}回${if (scene.half == "t") "表" else "裏"}", color = Slate300, fontSize = 13.sp)
            val outs = minOf(2, scene.outs)
            Row(Modifier.padding(start = 6.dp).semantics { contentDescription = "${outs}アウト" }, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                repeat(2) { i -> Box(Modifier.size(9.dp).background(if (outs > i) ScoreRed else Color(0xFF334155), CircleShape)) }
            }
        }
        PlayField(scene, home, Modifier.padding(horizontal = 12.dp).widthIn(max = 400.dp).fillMaxWidth().align(Alignment.CenterHorizontally))
        // 実況の1行と点の動き
        val tone = playTone(scene.code, scene.runs)
        Row(Modifier.padding(horizontal = 10.dp).fillMaxWidth().height(IntrinsicSize.Min).clip(RoundedCornerShape(6.dp)).testTag("live-telop")) {
            Box(Modifier.width(6.dp).fillMaxHeight().background(toneColor(tone)))
            Column(
                Modifier.weight(1f)
                    .background(Brush.horizontalGradient(listOf(Color(0xFF1E3A8A).copy(alpha = 0.55f), Color.Transparent)))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Text(
                    playLine(scene),
                    style = MaterialTheme.typography.titleSmall,
                    color = Color.White,
                )
                Text(scene.situation, fontSize = 12.sp, color = Slate300)
            }
        }
        // その半回の、いまの打席までの流れ（新しい順に4つ）
        val now = order[pos]
        val flow = scenes.withIndex().filter { (i, s) -> s.inning == scene.inning && s.half == scene.half && i <= now }.takeLast(4).reversed()
        Column(Modifier.padding(horizontal = 12.dp)) {
            flow.forEach { (i, s) ->
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        s.code,
                        fontSize = 12.sp,
                        color = Color(0xFF0F172A),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.width(24.dp).background(toneColor(playTone(s.code, s.runs)), RoundedCornerShape(4.dp)),
                    )
                    Text(
                        playLine(s),
                        fontSize = 13.sp,
                        color = if (i == now) Color.White else Slate400,
                        fontWeight = if (i == now) FontWeight.Bold else null,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        // 打席を送る
        FlowRow(
            Modifier.fillMaxWidth().background(NightBar).padding(horizontal = 10.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            LiveButton("◀ 前の打席", enabled = pos > 0) { go(-1) }
            LiveButton(if (auto) "■ 止める" else "▶ 自動", pressed = auto) {
                // 最後の打席で「自動」を押したら頭から
                if (!auto && pos >= order.size - 1) index = order.firstOrNull() ?: 0
                auto = !auto
            }
            LiveButton("次の打席 ▶", enabled = pos < order.size - 1) { go(1) }
            LiveButton("見どころだけ", pressed = only, enabled = highlights.isNotEmpty()) {
                // 切りかえても、いま出ている場面から続ける
                index = order[pos]
                only = !only
            }
            Text("${pos + 1} / ${order.size}", fontSize = 12.sp, color = Slate400, modifier = Modifier.align(Alignment.CenterVertically).padding(start = 4.dp))
        }
    }
}

/** 実況の1行（打者の名前と実況。打席の外の行は実況だけ） */
private fun playLine(s: LiveScene): String = "${s.batterName?.takeIf { it.isNotEmpty() }?.let { "$it　" }.orEmpty()}${s.phrase}"

@Composable
private fun LiveButton(label: String, enabled: Boolean = true, pressed: Boolean = false, onClick: () -> Unit) {
    val padding = PaddingValues(horizontal = 10.dp, vertical = 2.dp)
    if (pressed) {
        Button(onClick = onClick, enabled = enabled, contentPadding = padding, modifier = Modifier.height(34.dp), colors = ButtonDefaults.buttonColors(containerColor = Pressed, contentColor = LookNight)) {
            Text(label, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
    } else {
        OutlinedButton(onClick = onClick, enabled = enabled, contentPadding = padding, modifier = Modifier.height(34.dp)) { Text(label, fontSize = 12.sp) }
    }
}
