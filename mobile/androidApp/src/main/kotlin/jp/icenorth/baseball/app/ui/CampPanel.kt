package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Surface
import androidx.compose.ui.platform.testTag
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.clickable
import androidx.compose.material3.TextButton
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import jp.icenorth.baseball.app.AppViewModel
import jp.icenorth.baseball.app.CampBulk
import jp.icenorth.baseball.app.CampDraft
import jp.icenorth.baseball.shared.CAMP_DIRECTIONS
import jp.icenorth.baseball.shared.CAMP_POLICY_GUIDE
import jp.icenorth.baseball.shared.Commands
import jp.icenorth.baseball.shared.CAMP_GROUPS
import jp.icenorth.baseball.shared.CAMP_PHASES
import jp.icenorth.baseball.shared.CAMP_ROUNDS
import jp.icenorth.baseball.shared.Menu
import jp.icenorth.baseball.shared.MoodTone
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.campGroupOf
import jp.icenorth.baseball.shared.campMenusFor
import jp.icenorth.baseball.shared.campSubMenusFor
import jp.icenorth.baseball.shared.campSubTargetChoices
import jp.icenorth.baseball.shared.Choice
import jp.icenorth.baseball.shared.clampMenu
import jp.icenorth.baseball.shared.clampSub
import jp.icenorth.baseball.shared.describeMood
import jp.icenorth.baseball.shared.int
import jp.icenorth.baseball.shared.isPitcherJson
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.num
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.pid
import jp.icenorth.baseball.shared.playerWish
import jp.icenorth.baseball.shared.playerPolicy
import jp.icenorth.baseball.shared.Wish
import jp.icenorth.baseball.shared.resolveTraining
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.positionLabel
import jp.icenorth.baseball.shared.CampGainItem
import jp.icenorth.baseball.shared.formatGain
import jp.icenorth.baseball.shared.campGainTotals
import jp.icenorth.baseball.shared.campGainRows
import kotlinx.serialization.json.JsonObject
import kotlin.math.roundToInt

/**
 * キャンプ（1クールずつサーバーで実行する。campRound 命令）。
 *
 * 育成方針（長所／全体／短所 × 基礎体力／技術）→ 全員の練習を引き直す。
 * 選手ごとにメイン・サブ練習を選び、「第Nクール練習を実行」。伸びた能力を見て次を決める（全4回）。
 * ⚠ 同じクールを2回走らせない（クール番号を送り、サーバーが次の1つだけ受け付ける）。
 * ⚠ スマホでも選手ごとの練習を選べるようにする（Web のスマホ版は方針だけだったが、
 *    「詳細はPCで」を作らない）。表は入らないので、1人1枚のカードにする。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CampPanel(model: AppViewModel, raw: JsonObject, phase: JsonObject, header: @Composable () -> Unit = {}) {
    val phaseId = phase.at("id").str().orEmpty()
    val camp = phase["camp"].obj()
    val done = camp.at("rounds").int() ?: 0
    val total = camp.at("total").int() ?: CAMP_ROUNDS
    val finished = done >= total
    val roster = remember(raw) { raw.at("roster").list().mapNotNull { it.obj() } }
    // 実行済みのクールの指示。まだ回していなければ指導者の案（「意見を聞く」「任せる」のとき）。
    // ⚠ 締め切りで回さなかったクールに当たるのは指導者の案なので、画面もここから始める（Web と同じ）
    val saved = camp.at("plan").obj() ?: camp.at("suggested").obj()
    val draft = model.campDraft?.takeIf { it.phaseId == phaseId } ?: CampDraft(
        phaseId,
        saved.at("policy", "direction").str() ?: "balanced",
        saved.at("policy", "phase").str() ?: "skill",
        saved.at("main").obj().idMap(),
        saved.at("sub").obj().idMap(),
        // ⚠ 実行済みの指示に決め方が無ければ「全員同じ」（前の版）。何も無ければおすすめ
        mode = saved.at("policy", "mode").str() ?: if (saved == null) "recommended" else "team",
        players = saved.at("players").obj().orEmpty().mapNotNull { (k, v) ->
            val d = v.obj().at("direction").str()
            val ph = v.obj().at("phase").str()
            if (d != null && ph != null) k.toLongOrNull()?.let { it to Wish(d, ph) } else null
        }.toMap(),
        subTarget = saved.at("subTarget").obj().idMap(),
    )
    val policyOf = { p: JsonObject -> playerPolicy(p, draft.mode, draft.direction, draft.phase, draft.players) }
    val trainingOf = { p: JsonObject -> policyOf(p).let { resolveTraining(p, it.direction, it.phase) } }
    val mainOf = { p: JsonObject -> clampMenu(draft.main[p.pid] ?: trainingOf(p).main, p) }
    val subOf = { p: JsonObject -> clampSub(draft.sub[p.pid] ?: trainingOf(p).sub, p) }
    // 方針を変えたら割り当ても引き直す（方針はやる気にも効くので、練習が前のままだと噛み合いが読めない）
    // ⚠ 1人ずつの上書きも消す（決め方を選び直したら、全員その決め方に従う）
    val applyPolicy = { mode: String, direction: String, ph: String ->
        val training = { p: JsonObject -> playerPolicy(p, mode, direction, ph, emptyMap()).let { resolveTraining(p, it.direction, it.phase) } }
        model.campDraft = CampDraft(
            phaseId, direction, ph,
            roster.associate { it.pid to clampMenu(training(it).main, it) },
            roster.associate { it.pid to clampSub(training(it).sub, it) },
            mode = mode,
            // 対象は残す（送るときに、いまのサブ練習に合うものだけにする。Web と同じ）
            subTarget = draft.subTarget,
        )
    }
    // この選手だけ本人の希望に合わせる（練習もその方針で引き直す）
    val fitWish = { p: JsonObject ->
        val wish = playerWish(p)
        val t = resolveTraining(p, wish.direction, wish.phase)
        model.campDraft = draft.copy(
            players = draft.players + (p.pid to wish),
            main = draft.main + (p.pid to clampMenu(t.main, p)),
            sub = draft.sub + (p.pid to clampSub(t.sub, p)),
        )
    }
    // ⚠ 一括は1人ずつ選んだ練習も上書きするので、直後は元に戻せるようにする（確かめずに全員が変わっていた）
    // ⚠ 戻す先は model に置く（画面の remember だと、端末を回すと「元に戻す」が消えていた）
    val applyAll = { menu: Menu, pitchers: Boolean ->
        val next = draft.copy(main = draft.main + roster.filter { it.isPitcherJson() == pitchers }.associate { it.pid to clampMenu(menu.key, it) })
        model.campBulk = CampBulk("${if (pitchers) "投手" else "野手"}全員を「${menu.icon}${menu.name}」にしました", before = draft, after = next)
        model.campDraft = next
    }
    // 一括のあとに別の変更をしたら、戻す先が分からなくなるので出さない（別の手続きの案とも一致しない）
    val undo = model.campBulk?.takeIf { it.after == model.campDraft }
    val execute = {
        val payload = Commands.campRound(
            done + 1, draft.mode, draft.direction, draft.phase, draft.players,
            roster.associate { it.pid to mainOf(it) },
            roster.associate { it.pid to subOf(it) },
            // ⚠ いまのサブ練習に合う対象だけ送る（アプリは対象を送っておらず、新球種は抽選・サブポジ練習は外れていた）
            Commands.campTargetsToSend(roster, subOf, draft.subTarget),
        )
        model.command("campRound", payload, label = "第${done + 1}クールの練習中…", done = "第${done + 1}クールの練習を終えました")
    }

    Column(Modifier.fillMaxSize()) {
        ProcScroll(Modifier.weight(1f)) {
            header()
            Section(
                "春季キャンプ",
                trailing = {
                    Rounds(done, total)
                    InfoButton(
                        "春季キャンプ",
                        listOf(
                            "メイン練習とサブ練習を選んで実行します。1クールごとに結果が反映されるので、伸びた能力を見て次のクールを決められます。全クールが終わったら、伸びた能力でスタメン・投手起用を整えて開幕を待ちます。",
                            "本人の希望（育成方針・段階）と噛み合うほど練習が身につきます（正解とは限りません）。",
                            // ⚠ 希望の印の読み方はここ（以前は選手の一覧の上に常に出していた）
                            "選手のカードの「希望」の印: " + (CAMP_DIRECTIONS + CAMP_PHASES).joinToString(" ") { "${it.icon}${it.name}" },
                            "カードの右上（希望の印）を押すと、素質と前のクールの伸びが開きます（キャンプ通算は全クールの後に出ます）。「本人の希望どおりに」で、その選手だけ本人の希望に合わせます。",
                        ),
                    )
                },
            ) {
                // 誰の案か・任せているか（Web の CampPlanner と同じ文。文はサーバーが作る）
                if (!finished) phase.at("planBy", "text").str()?.takeIf { it.isNotBlank() }?.let { Muted(it) }
                // ⚠ 決め方（Web 版 CAMP_MODE_LABELS と同じ）。既定はおすすめ。球団で1つの方針だと、
                //    希望の違う選手が必ず「身が入らない」で残る（いしだ指摘: 一括指定が有効に見えない）
                Text("決め方", style = MaterialTheme.typography.labelLarge)
                ChoiceRow(CAMP_MODES, draft.mode, enabled = !finished) { applyPolicy(it, draft.direction, draft.phase) }
                if (draft.mode == "team") {
                    Text("育成方針", style = MaterialTheme.typography.labelLarge)
                    ChoiceRow(CAMP_DIRECTIONS.map { it.key to "${it.icon} ${it.name}" }, draft.direction, enabled = !finished) { applyPolicy("team", it, draft.phase) }
                    Text("段階", style = MaterialTheme.typography.labelLarge)
                    ChoiceRow(CAMP_PHASES.map { it.key to "${it.icon} ${it.name}" }, draft.phase, enabled = !finished) { applyPolicy("team", draft.direction, it) }
                    Muted(
                        listOfNotNull(CAMP_DIRECTIONS.firstOrNull { it.key == draft.direction }?.description, CAMP_PHASES.firstOrNull { it.key == draft.phase }?.description).joinToString("／"),
                    )
                } else {
                    Muted(CAMP_MODE_NOTES[draft.mode].orEmpty())
                }
                // ⚠ いしだ指摘: どれくらい伸びるのか・おまかせでいいのかが分からない。Web 版と同じ実測の目安（`CAMP_POLICY_GUIDE`）
                //    目安は全員同じ方針のときだけ（選手ごとに違うと1つに決まらない）
                val moods = roster.map { p -> policyOf(p).let { describeMood(p, it.direction, it.phase).tone } }
                val moodLine = "希望と噛み合う選手: 意欲的 ${moods.count { it == MoodTone.Good }}人・納得 ${moods.count { it == MoodTone.Mid }}人・身が入らない ${moods.count { it == MoodTone.Bad }}人。"
                val guide = if (draft.mode == "team") CAMP_POLICY_GUIDE["${draft.direction}:${draft.phase}"] else null
                if (guide != null) {
                    Text("4クールでの伸びの目安（1人あたり）", style = MaterialTheme.typography.labelLarge)
                    Muted("野手: ${guide.first}")
                    Muted("投手: ${guide.second}")
                    Muted(
                        (if (draft.direction == "balanced" && draft.phase == "skill") "いまは「全体を伸ばす×技術」です。試合に効きやすいミート・制球が伸びます。"
                        else "「全体を伸ばす×技術」なら、ミート・制球が伸びます。") +
                            "基礎体力は体力・体幹の数字が大きく伸びますが、打撃・制球はほとんど伸びません。" + moodLine,
                    )
                } else {
                    Muted(moodLine)
                }
                Text("全員に一括", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    campMenusFor(false).filter { !it.key.startsWith("intensive_") }.forEach { m ->
                        OutlinedButton(onClick = { applyAll(m, false) }, enabled = !finished) { Text("野手 ${m.icon}${m.name}", fontSize = 12.sp) }
                    }
                    campMenusFor(true).filter { !it.key.startsWith("intensive_") && it.key != "fielding" }.forEach { m ->
                        OutlinedButton(onClick = { applyAll(m, true) }, enabled = !finished) { Text("投手 ${m.icon}${m.name}", fontSize = 12.sp) }
                    }
                }
                undo?.let { b ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Muted(b.text, Modifier.weight(1f))
                        TextButton(onClick = { model.campDraft = b.before; model.campBulk = null }) { Text("元に戻す") }
                    }
                }
                if (finished) {
                    // ⚠ 終わったことを知らせる（Web 版 CampPlanner と同じ文。以前は実行ボタンが消えるだけだった）
                    Text(
                        "全${total}クールが終わりました。伸びた能力でスタメン・投手起用を整えて、月曜の開幕を待ちます。",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }

            // ⚠ まとめは**キャンプが終わってから**（先方指摘: キャンプ中に上に出る上昇のまとめは要らない。
            //    キャンプ後に選手ごとの総合上昇値を見たい）。キャンプ中は選手ごとの「第Nクール」の伸びで見る
            if (finished) key(done) { CampGains(model, camp, roster) }

            val campRounds = remember(camp) { campRoundList(camp) }
            var group by rememberSaveable { mutableStateOf("pitcher") }
            val groups = CAMP_GROUPS.map { (id, label) -> Triple(id, label, roster.filter { campGroupOf(it.at("position").str()) == id }) }.filter { it.third.isNotEmpty() }
            val shown = groups.firstOrNull { it.first == group } ?: groups.firstOrNull()
            ChipTabs(groups.map { (id, label, list) -> id to "$label ${list.size}" }, shown?.first.orEmpty(), { group = it })
            shown?.third?.forEach { p ->
                CampPlayerCard(
                    model, p, mainOf(p), subOf(p), policyOf(p), enabled = !finished,
                    onFitWish = { fitWish(p) },
                    rounds = campRounds,
                    target = draft.subTarget[p.pid],
                    onMain = { key -> model.campDraft = draft.copy(main = draft.main + (p.pid to key)) },
                    // ⚠ 練習を変えたら対象は捨てる（別の練習の対象が残る）
                    onSub = { key -> model.campDraft = draft.copy(sub = draft.sub + (p.pid to key), subTarget = draft.subTarget - p.pid) },
                    onTarget = { key -> model.campDraft = draft.copy(subTarget = if (key == null) draft.subTarget - p.pid else draft.subTarget + (p.pid to key)) },
                )
            }
        }
        // ⚠ 実行は画面の下に固定する（以前は方針の欄と一覧の一番下の2か所で、選手を見ている途中では押せず、
        //    クールの進みも上に流れて見えなくなった）
        if (!finished) {
            Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, tonalElevation = 3.dp, modifier = Modifier.fillMaxWidth().testTag("camp-bar")) {
                Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Muted("$done/${total}クール済み")
                    Button(onClick = execute, modifier = Modifier.weight(1f)) { Text("第${done + 1}クール練習を実行", maxLines = 1) }
                }
            }
        }
    }
}


private fun JsonObject?.idMap(): Map<Long, String> =
    orEmpty().mapNotNull { (k, v) -> k.toLongOrNull()?.let { id -> v.str()?.takeIf { it.isNotEmpty() }?.let { id to it } } }.toMap()

/** 1クールぶんの記録（伸びと出来事。どちらも選手の id → 中身） */
internal data class CampRound(val round: Int, val gains: JsonObject?, val events: JsonObject?)

/**
 * クールごとの記録（`camp.byRound`。無い記録＝版を上げる前に始めたキャンプは直近の `camp.last` だけ）。
 * ⚠ 先方指摘: 「+〇」が通算なので、1つのクールでどれだけ伸びたか分からなかった。
 * ⚠ 呼ぶ側で1回だけ読む（選手ごとに読み直さない）
 */
internal fun campRoundList(camp: JsonObject?): List<CampRound> {
    val byRound = camp.at("byRound").list().mapNotNull { it.obj() }
    val last = camp.at("last").obj()
    return byRound.map { r ->
        val round = r.at("round").int() ?: 0
        // 出来事は byRound に無い。直近のクールのぶんだけ last から添える
        CampRound(round, r.at("gains").obj(), if (round == last.at("round").int()) last.at("events").obj() else null)
    }.ifEmpty { listOfNotNull(last?.let { CampRound(it.at("round").int() ?: 0, it.at("gains").obj(), it.at("events").obj()) }) }
}

/**
 * キャンプ後の成果（選手ごとの総合上昇値。Web 版 CampResultList と同じ）。全員を伸びた量の多い順に並べ、
 * 「計」（伸びた量の合計）・項目ごとの通算・クールごとの合計を出す。
 * @param collapsed 畳んで出す（済んだキャンプの結果。シーズン中ずっと全員の一覧がタブの大半を占めないように）
 */
@Composable
internal fun CampGains(model: AppViewModel, camp: JsonObject?, roster: List<JsonObject>, collapsed: Boolean = false) {
    val total = camp.at("gains").obj()
    if (total.isNullOrEmpty() && (camp.at("rounds").int() ?: 0) == 0) return
    var open by rememberSaveable { mutableStateOf(!collapsed) }
    val rows = campGainRows(total, roster, camp.at("events").obj())
    val totals = campGainTotals(total)
    // ⚠ **全クールぶん揃っているときだけ**クール別を出す（途中のクールからの記録だと「計」と合わない）
    val rounds = remember(camp) { camp.at("byRound").list().mapNotNull { it.obj() }.takeIf { it.size == (camp.at("rounds").int() ?: -1) }.orEmpty() }
    Section("選手ごとの総合上昇値（キャンプ通算）", trailing = if (collapsed) ({ TextButton(onClick = { open = !open }) { Text(if (open) "閉じる" else "開く") } }) else null) {
        if (!open) {
            Muted(if (rows.isEmpty()) "伸びた能力はありません。" else "${rows.count { it.grew }}人が伸びました")
            return@Section
        }
        if (rows.isEmpty()) {
            Muted("伸びた能力はありません。")
            return@Section
        }
        Text("${rows.count { it.grew }}人が伸びました", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        Muted("球団全体: " + totals.take(6).joinToString(" · ") { "${it.label}${formatGain(it.diff)}" })
        rows.forEach { row ->
            val id = row.player.at("id").num()?.toLong()?.toString() ?: row.player.at("id").str().orEmpty()
            Column(Modifier.fillMaxWidth().clickable { model.openPlayer = row.player }.padding(vertical = 4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(row.player.at("name").str().orEmpty(), fontWeight = FontWeight.SemiBold)
                    Muted(positionLabel(row.player.at("position").str().orEmpty()))
                    val sum = (row.sum * 10).roundToInt() / 10.0
                    Text(
                        "計${formatGain(sum)}",
                        color = if (sum >= 0) GainUp else MaterialTheme.colorScheme.error,
                        fontWeight = FontWeight.Bold,
                    )
                }
                if (row.items.isNotEmpty()) GainLine(null, row.items)
                // ⚠ 0 は「±0」と書く（「第1」「0」が続いて「第10」に読めた）
                if (rounds.isNotEmpty()) Muted("クール別 " + rounds.joinToString(" / ") { r ->
                    val n = (r.at("gains", id).obj().orEmpty().values.sumOf { it.num() ?: 0.0 } * 10).roundToInt() / 10.0
                    "第${r.at("round").int() ?: 0} ${if (n == 0.0) "±0" else formatGain(n)}"
                })
                row.events.forEach { Text(it, color = MaterialTheme.colorScheme.tertiary, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
            }
        }
    }
}

/** 伸びの並び。伸びは緑、下がったものは赤 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun GainLine(title: String?, items: List<CampGainItem>) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        title?.let { Muted(it) }
        items.forEach { item ->
            Text(
                "${item.label}${formatGain(item.diff)}",
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (item.diff > 0) GainUp else MaterialTheme.colorScheme.error,
            )
        }
    }
}

private val GainUp = androidx.compose.ui.graphics.Color(0xFF2E9E5B)

@Composable
private fun Rounds(done: Int, total: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        repeat(total) { i ->
            val color = when {
                i < done -> MaterialTheme.colorScheme.primary
                i == done -> MaterialTheme.colorScheme.secondary
                else -> MaterialTheme.colorScheme.outlineVariant
            }
            Box(Modifier.size(22.dp).background(color, CircleShape), contentAlignment = Alignment.Center) {
                Text("${i + 1}", fontSize = 11.sp, color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold)
            }
        }
        Text(" $done/$total", style = MaterialTheme.typography.bodySmall)
    }
}

/** 方針の決め方（Web 版 CampPlanner の CAMP_MODE_LABELS / CAMP_MODE_NOTES と同じ文） */
private val CAMP_MODES = listOf("recommended" to "おすすめ", "wish" to "全員を希望どおり", "team" to "全員同じ方針")
private val CAMP_MODE_NOTES = mapOf(
    "recommended" to "本人の希望どおりにします。ただし技術が平凡な選手が「短所を埋める」を望むときは「長所を伸ばす」に変えます（段階は希望のままなので「納得」）。",
    "wish" to "全員を本人の希望どおりにします（全員「意欲的」）。希望どおりが正解とは限りません。",
)

private val MOOD_TEXT = mapOf(MoodTone.Good to "意欲的", MoodTone.Mid to "納得", MoodTone.Bad to "身が入らない")

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CampPlayerCard(
    model: AppViewModel,
    p: JsonObject,
    main: String,
    sub: String,
    policy: Wish,
    enabled: Boolean,
    onFitWish: () -> Unit,
    rounds: List<CampRound>,
    target: String?,
    onMain: (String) -> Unit,
    onSub: (String) -> Unit,
    onTarget: (String?) -> Unit,
) {
    val pitcher = p.isPitcherJson()
    // ⚠ `policy` は**この選手に当てる方針**（playerPolicy の結果）
    val mood = describeMood(p, policy.direction, policy.phase)
    val wish = playerWish(p)
    val moodColor = when (mood.tone) {
        MoodTone.Good -> MaterialTheme.colorScheme.primary
        MoodTone.Mid -> MaterialTheme.colorScheme.onSurfaceVariant
        MoodTone.Bad -> MaterialTheme.colorScheme.error
    }
    // ⚠ 閉じた形は名前・希望・練習の2つだけ（以前は素質と通算の伸びも常に出ていて、1画面に3人しか入らなかった）。
    //    右上（やる気・希望）を押すと素質と、前のクールの伸びが開く（直近のクールの伸びは閉じていても出す）
    var open by rememberSaveable(p.pid) { mutableStateOf(false) }
    Section(modifier = Modifier.padding(vertical = 0.dp)) {
        PlayerSummary(p, { model.openPlayer = it }) {
            Row(
                Modifier.clickable { open = !open }.padding(start = 8.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Muted(
                    "希望 ${CAMP_DIRECTIONS.firstOrNull { it.key == wish.direction }?.icon.orEmpty()}${CAMP_PHASES.firstOrNull { it.key == wish.phase }?.icon.orEmpty()}",
                )
                Tag(MOOD_TEXT[mood.tone] ?: mood.label, moodColor)
                Muted(if (open) "▴" else "▾")
            }
        }
        if (open) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Muted("成長 ${p.at("growthPotential").num()?.let { "%.2f".format(it) } ?: "—"}")
                AbilityNum("プロ意識", p.at("personality", "discipline").int())
                AbilityNum("精神", p.at("personality", "mental").int())
                AbilityNum("肩", p.at("physical", "arm").int())
                if (pitcher) AbilityNum("守", p.at("fielding", "defense").int()) else AbilityNum("眼", p.at("batting", "eye").int())
                AbilityNum("体力", p.at("physical", "bodyStamina").int())
                AbilityNum("回復", p.at("physical", "recovery").int())
            }

            // この選手だけ本人の希望に合わせる（⚠ 以前は「合わせる」で、何に合わせるのか分からなかった）
            if (wish != policy) {
                TextButton(onClick = onFitWish, enabled = enabled, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp)) {
                    Text("本人の希望どおりに", fontSize = 12.sp)
                }
            }
        }
        // ⚠ **クールごとの伸び**（先方指摘: 通算の「+〇」だけでは、1つのクールで伸びた値が分からない）。
        //    直近のクールは閉じた形でも出し、それより前のクールは開いたときに並べる
        val id = p.pid.toString()
        val roundItems = rounds.map { r ->
            r.round to campGainRows(r.gains?.get(id).obj()?.let { JsonObject(mapOf(id to it)) }, listOf(p)).firstOrNull()?.items.orEmpty()
        }
        roundItems.lastOrNull()?.let { (round, items) ->
            if (items.isNotEmpty()) GainLine("第${round}クール", items) else Muted("第${round}クール: 伸びなし")
        }
        // ⚠ 直近のクールの出来事（フォーム改造・新球種・覚醒）。上のまとめを消したので、ここに出さないと
        //    キャンプが終わるまで知らされない
        rounds.lastOrNull()?.events?.get(id).list().mapNotNull { it.str() }.forEach {
            Text(it, color = MaterialTheme.colorScheme.tertiary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
        if (open) roundItems.dropLast(1).asReversed().forEach { (round, items) ->
            if (items.isNotEmpty()) GainLine("第${round}クール", items) else Muted("第${round}クール: 伸びなし")
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MenuPicker("メイン", main, campMenusFor(pitcher), enabled, Modifier.weight(1f), onMain)
            MenuPicker("サブ", sub, campSubMenusFor(p), enabled, Modifier.weight(1f), onSub)
        }
        // 対象を取る練習（新球種習得・変化球練習・サブポジ練習）だけ、何を練習するかを選ぶ。⚠「おまかせ」を残す（従来どおり中で選ぶ）
        val choices = campSubTargetChoices(sub, p)
        if (choices.isNotEmpty()) TargetPicker(target, choices, enabled, onTarget)
    }
}

/** サブ練習の対象（Web 版 CampPlanner の対象の欄と同じ選択肢） */
@Composable
private fun TargetPicker(selected: String?, choices: List<Choice>, enabled: Boolean, onPick: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val current = choices.firstOrNull { it.key == selected }
    Box(Modifier.fillMaxWidth()) {
        OutlinedButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
            Text("対象: ${current?.label ?: "おまかせ"}", fontSize = 12.sp, maxLines = 1)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("おまかせ", fontWeight = if (current == null) FontWeight.Bold else FontWeight.Normal) }, onClick = { open = false; onPick(null) })
            choices.forEach { c ->
                DropdownMenuItem(
                    text = { Text(c.label, fontWeight = if (c.key == current?.key) FontWeight.Bold else FontWeight.Normal) },
                    onClick = { open = false; onPick(c.key) },
                )
            }
        }
    }
}

@Composable
private fun MenuPicker(label: String, selected: String, menus: List<Menu>, enabled: Boolean, modifier: Modifier, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val current = menus.firstOrNull { it.key == selected }
    Box(modifier) {
        OutlinedButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
            Text("$label: ${current?.let { "${it.icon}${it.name}" } ?: selected}", fontSize = 12.sp, maxLines = 1)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            menus.forEach { m ->
                DropdownMenuItem(
                    text = {
                        Column {
                            Text("${m.icon} ${m.name}", fontWeight = if (m.key == selected) FontWeight.Bold else FontWeight.Normal)
                            Text(m.description, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    },
                    onClick = { open = false; onPick(m.key) },
                )
            }
        }
    }
    // ⚠ ここ（Box の外）に部品を足さないこと。呼ぶ側の Row に並んでしまい、横幅いっぱいの部品だと
    //    メイン／サブのボタンの幅が0になって見えなくなる（実際に透明な区切り線でそうなっていた）
}
