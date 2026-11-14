package jp.icenorth.baseball.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import jp.icenorth.baseball.app.AppViewModel
import jp.icenorth.baseball.app.PhaseDraft
import jp.icenorth.baseball.app.savedPhaseDraft
import jp.icenorth.baseball.shared.Commands
import jp.icenorth.baseball.shared.PHASE_LABELS
import jp.icenorth.baseball.shared.ROSTER_LIMIT
import jp.icenorth.baseball.shared.signTotal
import jp.icenorth.baseball.shared.ONLINE_ROSTER_TARGETS
import jp.icenorth.baseball.shared.rosterCounts
import jp.icenorth.baseball.shared.seasonLine
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.bool
import jp.icenorth.baseball.shared.int
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.long
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.pid
import jp.icenorth.baseball.shared.PendingProcedure
import jp.icenorth.baseball.shared.pendingProcedure
import jp.icenorth.baseball.shared.PackWaiting
import jp.icenorth.baseball.shared.packWaiting
import jp.icenorth.baseball.shared.waitingTradeCount
import jp.icenorth.baseball.shared.stageInfo
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.teamLabel
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

private enum class ProcTab(val label: String) { Current("現在の手続き"), Trade("トレード"), Exhibition("練習試合"), Starters("予告先発") }

/**
 * 手続きタブ: 初期メンバー選択・キャンプ・契約更改・トライアウト・年度更新と、トレード。
 * @param onOpenStaff 編成の「指導者」の面を開く（指導者に任せた手続きから、任せ方を変えに行く）
 */
@Composable
fun ProceduresScreen(model: AppViewModel, onHome: () -> Unit = {}, onOpenStaff: () -> Unit = {}) {
    val raw = model.raw ?: return
    // ⚠ どちらの側を開いているかは AppViewModel に置く（届いた提案の知らせから、トレードの側を直接開くため）
    val tab = ProcTab.entries.firstOrNull { it.name == model.procFace } ?: ProcTab.Current
    val view = model.view
    val counts = mapOf(
        ProcTab.Current.name to (if (pendingProcedure(raw) != null) 1 else 0),
        ProcTab.Trade.name to waitingTradeCount(raw),
        // 届いた練習試合の申し込み（返事をする番のもの）
        ProcTab.Exhibition.name to (view?.exhibitions.orEmpty().count { it.status == "offered" && !it.mine }),
    )
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        // ⚠ 球団名を変える入口はホームのメニューだけにした（以前はここの右上にもあった。手続きと関係が薄い）
        ChipTabs(
            ProcTab.entries.map { it.name to it.label },
            tab.name,
            { model.procFace = it },
            Modifier.fillMaxWidth().padding(top = 8.dp),
            counts = counts,
        )
        when (tab) {
            ProcTab.Current -> CurrentProcedure(model, raw, onHome, onOpenStaff)
            ProcTab.Trade -> TradeScreen(model, raw)
            ProcTab.Exhibition -> if (view != null) ExhibitionScreen(model, view)
            ProcTab.Starters -> if (view != null) StarterPicksScreen(model, view)
        }
    }
}

/** 手続きの面の縦スクロール（下に固定する帯を置く面は、これに weight を付けて上に積む） */
@Composable
internal fun ProcScroll(modifier: Modifier = Modifier, state: ScrollState = rememberScrollState(), content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().verticalScroll(state).padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
}

@Composable
private fun CurrentProcedure(model: AppViewModel, raw: JsonObject, onHome: () -> Unit, onOpenStaff: () -> Unit) {
    val pending = raw["pendingPack"].obj()
    val phase = raw["phase"].obj()
    // ⚠ 決める手続きは、決定・実行の帯を画面の下に固定する（[PhasePanel] が自分で面を組む）。
    //    以前は一覧の上と一番下にしか無く、途中で決めるには端まで送る必要があった
    if (pending == null && phase != null) {
        PhasePanel(model, raw, phase, onOpenStaff)
        return
    }
    val scroll = rememberScrollState()
    ProcScroll(Modifier.fillMaxSize(), scroll) {
        // ⚠ いまの段階とやることを先頭に出す（いしだ指摘: シーズン後の流れが分からない）。
        //    途中参加の初期メンバー選択の間は出さない（その画面に説明がある）
        if (pending != null) {
            PendingPack(model, raw, pending, onHome, scroll)
        } else {
            SeasonFlowCard(raw)
            // ⚠ 「無い」だけで終わらせない。合間なら次に何が開くかを書く
            val head = stageHeadText(raw)
            val inSeason = raw.at("stage", "key").str() == "season"
            Section("手続き") { Text(if (head != null && !inSeason) "いま決めることはありません。$head。" else "現在、決定待ちの手続きはありません。") }
            raw["lastCamp"].obj()?.let { camp ->
                Caption("${camp.at("year").int() ?: ""}年目のキャンプ結果")
                // ⚠ 済んだキャンプの結果は畳んで出す（シーズン中ずっと、24人の一覧がこのタブの大半を占めていた）
                CampGains(model, camp, raw.at("roster").list().mapNotNull { it.obj() }, collapsed = true)
            }
            OffseasonGrowthCard(model, raw)
            TryoutResultCard(model, raw)
        }
    }
}

/** 「11/9(月) 0:00 の開幕から」。キャンプの前なら見込みなので「（予定）」を付ける（Web 版の packStartText と同じ） */
fun packStartText(joinsAt: String?, estimated: Boolean): String {
    val due = formatDeadline(joinsAt) ?: return "次のキャンプが終わった後の開幕から"
    return "$due の開幕から" + if (estimated) "（予定）" else ""
}

/** 途中参加の初期メンバー選択。選んだ時点で保存する（pack 命令。締め切りは無い） */
@Composable
private fun PendingPack(model: AppViewModel, raw: JsonObject, pending: JsonObject, onHome: () -> Unit, scroll: ScrollState) {
    val packs = pending.at("packs").list().mapNotNull { it.obj() }
    val chosen = pending.at("chosen").str()
    val chosenName = packs.firstOrNull { it.at("id").str() == chosen }?.at("name").str()
    val waiting = packWaiting(raw)
    // ⚠ 年齢の幅は**並んでいるセットから数える**（Web 版の `packAgeRange` と同じ）。セットの版で
    //    幅が違い（版1・版2は19〜24歳、版3は19〜32歳）、決め打ちの「19〜24歳」が版3で残った
    val ages = packs.flatMap { it.at("players").list() }.mapNotNull { it.at("age").int() }
    val ageRange = if (ages.isEmpty()) "19〜24" else "${ages.min()}〜${ages.max()}"
    // 選び終えた後に「セットを選び直す」を押したか
    var choosing by rememberSaveable { mutableStateOf(false) }
    // 中身（24人）を開いているセット
    var packOpen by rememberSaveable { mutableStateOf<String?>(null) }
    // ⚠ **選び終えたら「参加の準備ができました」に切り替える**（Web 版と同じ）。以前は選んだ後も
    //    セットの一覧がそのまま残り、済んだのか・いつ自分の球団になるのか分からなかった（いしだ指摘）
    if (waiting != null && !choosing) {
        PackReady(model, raw, waiting, onHome) { choosing = true }
        return
    }
    if (waiting != null) {
        OutlinedButton(onClick = { choosing = false }) { Text("選び直さずに戻る") }
    }
    Section(
        "初期メンバー選択",
        trailing = {
            InfoButton(
                "初期メンバー選択",
                // ⚠ セットの型（版2）が無ければ、前から待っている人のセット（版1・全部同じ構成）。
                //    Web 版（PackSelect）と同じく説明を分ける
                listOf(
                    "20セットから1つ選びます。選んだ24人はキャンプが終わった時点で名簿に入り、" +
                        packStartText(pending.at("joinsAt").str(), pending.at("joinsInCamp").bool() != true) +
                        "あなたの球団になります。それまでは引き継いだ選手でCPUが戦い、ストーブリーグとキャンプの手続きもCPUが決めます。",
                ) + (
                    if (packs.any { it.at("feature").str() != null }) listOf(
                        "セットごとに構成（投手厚め・野手厚め・二刀流・捕手3人など）と格付けの配り方（少数精鋭・粒ぞろい・大黒柱など）が違います。年齢は${ageRange}歳です。",
                        "格の総量（A=3・B=2・C=1点の合計）はどれも同じにしてあり、同じ枠の平均からの開きも1%前後に揃えてあるので、戦い方の好みで選んでください。",
                    ) else listOf(
                        "どのセットも投12・捕2・内外10の24人（うち二刀流2人）で、格付けはA2・B10・C12、年齢は${ageRange}歳です。",
                        "合計の力は揃えてあるので（開きは1%前後）、好みで選んで構いません。",
                    )
                ) + listOf(
                    "選んだセットは1球団だけが受け取ります（重なったら球団名の順）。",
                ),
            )
        },
    ) {
        Muted(if (chosenName != null) "いま選んでいるのは「$chosenName」です。キャンプまでは何度でも選び直せます。" else "まだ選んでいません。決めずにキャンプを迎えると、1つ目のセットになります。")
    }
    PackPicker(model, packs, chosen, scroll, packOpen, { packOpen = it }) { id ->
        model.command("pack", Commands.pack(id), done = "初期メンバーを選びました") { choosing = false }
    }
}

/** 初期メンバーを選び終えた後。選んだセットと、自分の球団になる日を出す */
@Composable
private fun PackReady(model: AppViewModel, raw: JsonObject, waiting: PackWaiting, onHome: () -> Unit, onChoose: () -> Unit) {
    val team = model.view?.teamLabel(raw.at("teamName").str().orEmpty())
    Section(
        "参加の準備ができました",
        trailing = {
            InfoButton(
                "参加の準備ができました",
                listOf(
                    "選んだ24人は、キャンプが終わった時点で名簿に入ります。",
                    "それまでは引き継いだ選手でCPUが戦い、ストーブリーグとキャンプの手続きもCPUが決めます。トレードもそれまではできません。",
                    "セットはキャンプが終わるまで選び直せます。球団名はホームのメニューで変えられます。",
                ),
            )
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.testTag("pack-ready")) {
            Muted("初期メンバー")
            Text("「${waiting.packName}」" + (waiting.feature?.let { "  $it" } ?: ""), fontWeight = FontWeight.Bold)
            Muted("あなたの球団になる日")
            Text(packStartText(waiting.joinsAt, waiting.estimated), fontWeight = FontWeight.Bold)
            if (!team.isNullOrBlank()) {
                Muted("球団名")
                Text(team, fontWeight = FontWeight.Bold)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                Button(onClick = onHome) { Text("ホームへ") }
                OutlinedButton(onClick = onChoose) { Text("セットを選び直す") }
            }
        }
    }
}

/**
 * 自分が決める手続きの帯（「手続き」を開いていない間、どのタブでも上に出す）。閉じるボタンは置かない:
 * 済むまで出し続ける（初期メンバー選択・人員整理・キャンプを見逃して飛ばさないように）
 */
@Composable
fun ProcedureNotice(procedure: PendingProcedure, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val due = formatDeadline(procedure.deadline)
    // ⚠ 1行の細い帯にする（以前は3行ぶんあり、どのタブでも一覧の上を大きく取っていた）。
    //    「過ぎると標準の内容で進む」は手続きの画面の ⓘ にある
    Surface(
        color = MaterialTheme.colorScheme.tertiaryContainer,
        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
        shape = RoundedCornerShape(10.dp),
        modifier = modifier.fillMaxWidth().clickable(onClick = onOpen).testTag("procedure-notice"),
    ) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${procedure.label}を決めてください", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
            Text(
                listOfNotNull(procedure.progress, due?.let { "〜$it" }).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text("開く ›", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
        }
    }
}

/**
 * 手続きの決まり（Web 版の rulesText のスマホの文と同じ）。
 * ⚠ 以前は PC 向けの長い文をそのまま出していた。長い文は見出しの ⓘ（[rulesDetail]）へ回す。
 * ⚠ 締め切りの日時は上の「1年の流れ」の帯（いまは○○（締め切り …））に出ているので繰り返さない。
 *    帯に締め切りが出ないとき（[showDate]）だけ日時を書く
 */
internal fun rulesText(kind: String?, deadline: String?, showDate: Boolean): String {
    val due = formatDeadline(deadline)
    val shown = due?.takeIf { showDate }
    return when {
        kind == "camp" && due == null -> "全員が4クール終えると次へ進みます（指導者に任せた球団は待ちません）。"
        kind == "camp" -> (shown?.let { "締め切りは $it。" } ?: "") + "全員が4クール終えた時点で次へ進みます（指導者に任せた球団は待ちません）。締め切りまでに終わらなかったぶんは、最後に指示した内容で自動で行われます。"
        due == null -> "全員が決定すると進みます。"
        else -> (shown?.let { "締め切り $it。" } ?: "") + "全員が決定するか、締め切りで進みます。"
    }
}

/** 手続きの決まりの詳しい文（Web 版の PC の rulesText と同じ。日時は除く） */
private fun rulesDetail(deadline: String?): String =
    if (formatDeadline(deadline) != null) "全員が決定した時点で処理します（指導者に任せた球団は待ちません）。締め切りを過ぎると、未決定の球団は保存した下書き（無ければ標準案）で進みます。ほかに検討中の球団がいる間は、決定後も出し直せます。"
    else "全員が決定した時点で処理します（指導者に任せた球団は待ちません）。この手続きに締め切りはありません。ほかに検討中の球団がいる間は、決定後も出し直せます。"

@Composable
private fun PhasePanel(model: AppViewModel, raw: JsonObject, phase: JsonObject, onOpenStaff: () -> Unit) {
    val view = model.view ?: return
    val phaseId = phase.at("id").str().orEmpty()
    val kind = phase.at("kind").str()
    val submission = phase["submission"].obj()
    val members = raw.at("members").list().mapNotNull { it.obj() }
    val title = PHASE_LABELS[kind] ?: phase.at("label").str() ?: "手続き"
    val deadline = phase.at("deadline").str() ?: view.phaseDeadline
    // 1年の流れの帯と、手続きの見出し（決まり・誰が決めたか）。どの手続きでも面の先頭に置く
    val header: @Composable () -> Unit = {
        SeasonFlowCard(raw)
        Section(
            title,
            trailing = { if (kind != "camp") InfoButton(title, listOf(rulesDetail(deadline))) },
        ) {
            Text(rulesText(kind, deadline, showDate = stageInfo(raw)?.open != true), style = MaterialTheme.typography.bodyMedium)
            // 標準案を出した指導者と、任せているか（Web の PhasePanel と同じ文。文はサーバーが作る）。
            // ⚠ 任せていると提出しても指導者の案で決まり、サーバーも決定を待たないので、出さないと組み立てが無駄になる。
            //    キャンプのぶんは CampPanel が出す（Web と同じ分け方）
            // ⚠ 出すのは、出ている案が指導者の案のままの間だけ（変えていない・保存も決定もしていない）。自分で入れ替えて
            //    決定したあとも「○○監督の案です。変えてから決定できます」が残り、決定した中身が指導者の案に読めた（Web と同じ直し）
            val draftDirty = phase.at("delegated").bool() != true &&
                model.phaseDraft?.takeIf { it.phaseId == phaseId }?.dirty == true
            if (kind != "camp" && !draftDirty && submission == null) {
                phase.at("planBy", "text").str()?.takeIf { it.isNotBlank() }?.let { Muted(it) }
            }
            members.forEach { m ->
                val ready = m.at("ready").bool() == true
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // ⚠ 決定前は印を出さない（以前は「…」で、何の印か分からなかった）。右の「検討中」で分かる。
                    //    「未提出」とは書かない（下書きを保存した球団もここに入る。Web 版も「検討中」）
                    Text(if (ready) "✓" else "", color = MaterialTheme.colorScheme.primary, modifier = Modifier.width(20.dp))
                    Text(view.teamLabel(m.at("teamName").str().orEmpty()), modifier = Modifier.weight(1f))
                    // ⚠ 指導者に任せた球団は待たない（Web 版の `phaseStatusLabel` と同じ言葉）
                    Muted(
                        when {
                            m.at("cpu").bool() == true -> "CPUが決定（初期メンバー待ち）"
                            m.at("delegated").bool() == true -> "指導者に任せています"
                            ready -> "決定済み"
                            else -> "検討中"
                        },
                    )
                }
            }
        }
    }
    if (kind == "camp") {
        // 年度更新はキャンプの直前に済む。方針を決める前に見られるようにする
        CampPanel(model, raw, phase) {
            header()
            OffseasonGrowthCard(model, raw)
            TryoutResultCard(model, raw)
        }
        return
    }

    // ⚠ **指導者に任せた手続き（トライアウト・契約更改）は、指導者の案を読むだけで見せる**。サーバーは任せた手続きを
    //    提出があっても指導者の案で決める（server/leagueEngine.mjs の resolvePhase）。以前は編集・「この内容で決定」が
    //    そのまま出て「決定しました」「決定済み」と出るのに、案は使われなかった（Web の PhasePanel と同じ直し）。
    //    キャンプは CampPanel が受け持つ（自分でクールを回すと任せ方は「意見を聞く」に戻る）ので、ここでは扱わない
    val delegated = phase.at("delegated").bool() == true
    // 編集中の案。保存済みの提出があればそれ、無ければ標準案（defaults）から始める
    val draft = model.phaseDraft?.takeIf { it.phaseId == phaseId }
    var failure by remember(phaseId) { mutableStateOf<String?>(null) }
    // 「読み直す」を押した回数。⚠ 標準案の読み込みに失敗したあとは、ほかの鍵（手続き・提出・下書きの有無）が
    //    変わらないことが多いので、これを鍵に入れないと読み直さず「標準案を準備しています…」のまま止まる
    var attempt by remember(phaseId) { mutableStateOf(0) }
    // 初期メンバーのセットの中身（24人）を開いているセット。開いている間は下の決定の帯を出さない
    var packOpen by rememberSaveable(phaseId) { mutableStateOf<String?>(null) }
    // 任せているときに見せる指導者の案（標準案。defaultPhasePlan は任せた人の球団に指導者の考えを当てる）。
    // ⚠ 下書き（model.phaseDraft）とは別に持つ。任せる前に編集していた下書きは、「意見を聞く」に戻したら続きから使える
    var coachPlan by remember(phaseId) { mutableStateOf<JsonObject?>(null) }
    LaunchedEffect(phaseId, delegated, attempt, view.revision) {
        if (!delegated) return@LaunchedEffect
        try {
            val defaults = model.read("defaults")
            if (defaults.at("phaseId").str() != phaseId) {
                failure = "手続きが更新されました。最新状態を確認してください"
                return@LaunchedEffect
            }
            coachPlan = defaults["plan"].obj() ?: JsonObject(emptyMap())
            failure = null
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            failure = model.describe(e)
        }
    }
    // ⚠ 下書きを捨てた（null にした）ときも読み直すよう、draft == null も鍵に入れる
    LaunchedEffect(phaseId, submission, draft == null, attempt, delegated) {
        if (delegated) return@LaunchedEffect
        val current = model.phaseDraft?.takeIf { it.phaseId == phaseId }
        if (current != null && (current.dirty || current.base == (submission ?: JsonNull))) return@LaunchedEffect
        val plan = submission?.get("plan").obj()
        if (plan != null) {
            model.phaseDraft = PhaseDraft(phaseId, plan, submission, dirty = false)
            return@LaunchedEffect
        }
        try {
            val defaults = model.read("defaults")
            if (defaults.at("phaseId").str() != phaseId) {
                failure = "手続きが更新されました。最新状態を確認してください"
                return@LaunchedEffect
            }
            model.phaseDraft = PhaseDraft(phaseId, defaults["plan"].obj() ?: JsonObject(emptyMap()), JsonNull, dirty = false)
            failure = null
        } catch (e: Exception) {
            // ⚠ 前の読み込みが取り消されたとき（ページを連打した・画面を離れた）は失敗として出さない
            if (e is kotlinx.coroutines.CancellationException) throw e
            failure = model.describe(e)
        }
    }
    val scroll = rememberScrollState()
    val failed = failure
    // 見せる案（任せていれば指導者の案、でなければ編集中の案）
    val shown = if (delegated) coachPlan else draft?.plan
    if (failed != null || shown == null) {
        ProcScroll(Modifier.fillMaxSize(), scroll) {
            header()
            if (failed != null) {
                Section {
                    // ⚠ 任せているときは下書きを捨てない（「意見を聞く」に戻したときの続き）
                    LoadFailed(failed, onRetry = { if (!delegated) model.phaseDraft = null; failure = null; attempt += 1; model.reload(pull = true) })
                }
            } else {
                Muted(if (delegated) "指導者の案を準備しています…" else "標準案を準備しています…")
            }
        }
        return
    }
    // 編集できる案（任せていれば null。読むだけ）
    val editing = if (delegated) null else draft
    val changedElsewhere = editing != null && editing.dirty && editing.base != (submission ?: JsonNull)
    val scope = rememberCoroutineScope()
    val setPlan: (JsonObject) -> Unit = { next -> if (editing != null) model.phaseDraft = editing.copy(plan = next, dirty = true) }
    val plan = shown
    val ready = submission?.at("ready").bool() == true
    val packs = phase.at("packs").list().mapNotNull { it.obj() }
    val isPack = plan["packId"] != null || phase["packs"] != null

    Column(Modifier.fillMaxSize()) {
        ProcScroll(Modifier.weight(1f), scroll) {
            header()
            if (changedElsewhere) {
                Section {
                    Text("別の操作で提出が更新されました。現在の入力を破棄して保存済みの内容を読み直せます。", color = MaterialTheme.colorScheme.secondary)
                    OutlinedButton(onClick = { model.phaseDraft = savedPhaseDraft(raw, phaseId) }) { Text("最新の提出を読み直す") }
                }
            }
            when {
                isPack -> {
                    // ⚠ 選んだらその場で保存する（途中参加の初期メンバー選択と同じく、押せば保存される）。
                    //    以前は手続きのタブでは未保存の編集になるだけで、「選択中」と出ても保存されず、
                    //    そのまま離れると締め切りで標準案のセットになった。決定済みなら決定のまま出し直す
                    PackPicker(model, packs, plan.at("packId").str(), scroll, packOpen, { packOpen = it }) { id ->
                        val name = packs.firstOrNull { it.at("id").str() == id }?.at("name").str().orEmpty()
                        // 初期メンバー選択は任せられない（任せ方の分野が無い）。念のため読むだけのときは送らない
                        if (editing != null) submit(
                            model, phaseId, Commands.withPack(plan, id), ready, editing.base,
                            done = if (ready) "「$name」に選び直しました（決定済み）" else "「$name」を下書きに保存しました。決めたら「この内容で決定」を押してください",
                        )
                    }
                }
                plan["rankedIds"] != null -> TryoutPanel(model, raw, phase, plan, setPlan, editable = editing != null) {
                    // 標準案に戻す（⚠ 保存済みの下書きではなく、いつも標準案を取り直す）
                    if (editing != null) scope.launch {
                        try {
                            val defaults = model.read("defaults")
                            if (defaults.at("phaseId").str() != phaseId) failure = "手続きが更新されました。最新状態を確認してください"
                            else model.phaseDraft = editing.copy(plan = defaults["plan"].obj() ?: plan, dirty = submission != null)
                        } catch (e: Exception) {
                            // ⚠ 前の読み込みが取り消されたとき（ページを連打した・画面を離れた）は失敗として出さない
                            if (e is kotlinx.coroutines.CancellationException) throw e
                            failure = model.describe(e)
                        }
                    }
                }
                plan["releaseIds"] != null -> ReleasePanel(model, raw, plan, setPlan, editable = editing != null)
                kind == "offseason" -> Section { Text("最終順位を保存し、次年度のキャンプへ進みます。決めることはありません（「この内容で決定」を押すと早く進みます）。") }
            }
        }
        // ⚠ セットの中身を開いている間は帯を出さない。帯は選んでいるセット（A）を指したまま「この内容で決定」を出すので、
        //    別のセット（B）の24人を見ながら押すと A で決まっていた。中身の面には「このセットにする」と「一覧へ戻る」がある
        val viewingPack = isPack && packs.any { it.at("id").str() == packOpen }
        val summary = when {
            isPack -> packs.firstOrNull { it.at("id").str() == plan.at("packId").str() }?.at("name").str()?.let { "選んでいるセット: $it" }
            plan["rankedIds"] != null -> "獲得する人数 ${signTotal(plan, rosterRoom(raw))}人（交渉 ${plan.at("rankedIds").list().size}人）"
            plan["releaseIds"] != null -> releaseSummary(raw, plan)
            else -> null
        }
        when {
            viewingPack -> Unit
            // 任せている: 決定・下書き・取り消しは出さず、自分で決めるときの入口（指導者の面）を置く
            editing == null -> DelegatedBar(summary, onOpenStaff)
            // ⚠ 決定・下書きの操作は画面の下に固定する（以前は一覧の上と一番下の2か所で、途中からは押せなかった）
            else -> DecisionBar(
                status = when {
                    editing.dirty -> "編集中（未保存）"
                    ready -> "決定済み。ほかに検討中の球団がいる間は出し直せます"
                    submission != null -> "下書きを保存済み"
                    // ⚠ 「標準案を表示しています」は何のことか分かりにくかった
                    else -> "まだ変えていません（標準案のまま）"
                },
                summary = summary,
                ready = ready,
                dirty = editing.dirty,
                onDecide = { submit(model, phaseId, plan, true, editing.base) },
                onSave = { submit(model, phaseId, plan, false, editing.base) },
                // 保存済みの提出に戻す（無ければ null にして標準案を読み直す）
                onDiscard = { model.phaseDraft = savedPhaseDraft(raw, phaseId) },
            )
        }
    }
}

/** 指導者に任せた手続きの文（Web の PhasePanel と同じ文） */
internal const val DELEGATED_PHASE_TEXT = "指導者に任せています。この手続きは指導者の案で決まります。自分で決めるなら「指導者」で任せ方を「意見を聞く」にしてください。"

/** 指導者に任せた手続きの帯（決定・下書きの帯の代わり）。上の行は指導者の案の要約 */
@Composable
private fun DelegatedBar(summary: String?, onOpenStaff: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, tonalElevation = 3.dp, modifier = Modifier.fillMaxWidth().testTag("delegated-bar")) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            summary?.let { Text(it, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            Muted(DELEGATED_PHASE_TEXT)
            OutlinedButton(onClick = onOpenStaff, modifier = Modifier.fillMaxWidth()) { Text("指導者の画面へ", maxLines = 1) }
        }
    }
}

/** 決定・下書きの帯（手続きの面の下に固定する）。上の行はいまの状態と、選んでいる中身の要約 */
@Composable
private fun DecisionBar(
    status: String,
    summary: String?,
    ready: Boolean,
    dirty: Boolean,
    onDecide: () -> Unit,
    onSave: () -> Unit,
    onDiscard: () -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, tonalElevation = 3.dp, modifier = Modifier.fillMaxWidth().testTag("decision-bar")) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            summary?.let { Text(it, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Muted(status, Modifier.weight(1f))
                if (dirty) TextButton(onClick = onDiscard, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)) { Text("変更を取り消す") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = onDecide, modifier = Modifier.weight(1f)) { Text("この内容で決定", maxLines = 1) }
                OutlinedButton(onClick = onSave) { Text(if (ready) "決定を取り消す" else "下書きを保存", maxLines = 1) }
            }
        }
    }
}

private fun submit(model: AppViewModel, phaseId: String, plan: JsonObject, ready: Boolean, base: JsonElement?, done: String? = null) {
    model.command("submit", Commands.submit(phaseId, plan, ready, base), label = if (ready) "決定を送信中…" else "保存中…", done = done ?: if (ready) "決定しました" else "保存しました") {
        // ⚠ サーバーは提出を整えて保存する（送った形と同じとは限らない）ので、読み直したビューの提出から作り直す。
        //    送った形を base にすると、次の提出が edit_conflict で断られることがある
        // ⚠ null にしてはいけない（[savedPhaseDraft]）。null の間は面が「標準案を準備しています…」に替わり、
        //    トライアウトの候補の絞り込み・契約更改の並び・初期メンバーの構成の絞り込みとスクロールが初期に戻っていた
        model.phaseDraft = savedPhaseDraft(model.raw, phaseId)
    }
}

/** セットの人数と格付けの1行（「投11 捕2 内7 外4 · 格付け A3 B8 C13 · 平均20.9歳 · 二刀流4」） */
private fun packLine(pack: JsonObject): String {
    val counts = pack["counts"].obj()
    return listOf("pitcher" to "投", "catcher" to "捕", "infield" to "内", "outfield" to "外")
        .joinToString(" ") { (k, l) -> "$l${counts.at(k).int() ?: 0}" } +
        // ⚠ 「A3 B8 C13」だけでは何の数か分からなかった
        " · 格付け " + listOf("A", "B", "C").joinToString(" ") { "$it${pack.at("ranks", it).int() ?: 0}" } +
        " · 平均${pack.at("averageAge").str() ?: "-"}歳 · 二刀流${pack.at("twoWay").int() ?: 0}"
}

/**
 * 初期メンバーのセット。一覧は要約だけにし、押すとそのセットの24人の面に替わる（「一覧へ戻る」か戻るで一覧へ）。
 * ⚠ 以前は選んだセットの24人が一覧の中に開き、次のセットが遠くなって見比べにくかった。
 *    見せ方は Web と違ってよい（いしだ 2026-11-11）。構成（二刀流・捕手3人・投手厚め…）で絞り込める
 * @param open 中身を開いているセットの id（呼ぶ側が持つ。手続きの面は、開いている間は決定の帯を隠す）
 */
@Composable
private fun PackPicker(
    model: AppViewModel,
    packs: List<JsonObject>,
    chosen: String?,
    scroll: ScrollState,
    open: String?,
    onOpen: (String?) -> Unit,
    onChoose: (String) -> Unit,
) {
    // 一覧をどこまで送っていたか（中身から戻ったときに同じ所へ戻す）
    var listAt by rememberSaveable { mutableStateOf(0) }
    var kind by rememberSaveable { mutableStateOf("all") }
    val scope = rememberCoroutineScope()
    val opened = packs.firstOrNull { it.at("id").str() == open }
    val close: () -> Unit = {
        onOpen(null)
        scope.launch {
            // 一覧に替わってから送る（替わる前だと、中身の面の長さで止まる）
            withFrameNanos { }
            scroll.scrollTo(listAt)
        }
    }
    if (opened != null) {
        val id = opened.at("id").str().orEmpty()
        BackHandler(onBack = close)
        Section(opened.at("name").str().orEmpty(), trailing = { TextButton(onClick = close) { Text("‹ 一覧へ戻る") } }) {
            opened.at("feature").str()?.let { Text(it, color = MaterialTheme.colorScheme.tertiary, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall) }
            Muted(packLine(opened))
            Button(onClick = { onChoose(id); close() }, enabled = id != chosen, modifier = Modifier.fillMaxWidth()) { Text(if (id == chosen) "選択中" else "このセットにする") }
            opened.at("players").list().mapNotNull { it.obj() }.forEach { p ->
                PlayerSummary(p, { model.openPlayer = it }) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        p.at("rank").str()?.let { Tag(it, MaterialTheme.colorScheme.onSurfaceVariant) }
                        if (p.at("isTwoWay").bool() == true) Tag("二刀流")
                    }
                }
            }
        }
        return
    }
    // セットの型（版2）の前半が構成（「二刀流・主力3人」の「二刀流」）。前から待っている人のセット（版1）には無い
    val kindOf: (JsonObject) -> String? = { it.at("feature").str()?.substringBefore("・") }
    val kinds = packs.mapNotNull(kindOf).distinct()
    val shownKind = kind.takeIf { it == "all" || it in kinds } ?: "all"
    Section("セットを選ぶ") {
        if (kinds.size > 1) ChoiceRow(listOf("all" to "すべて") + kinds.map { it to it }, shownKind) { kind = it }
        packs.filter { shownKind == "all" || kindOf(it) == shownKind }.forEach { pack ->
            val id = pack.at("id").str().orEmpty()
            Row(
                Modifier.fillMaxWidth().clickable {
                    listAt = scroll.value
                    onOpen(id)
                    scope.launch { scroll.scrollTo(0) }
                }.padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(if (id == chosen) "●" else "○", color = if (id == chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, modifier = Modifier.width(22.dp))
                Column(Modifier.weight(1f)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(pack.at("name").str().orEmpty(), fontWeight = if (id == chosen) FontWeight.Bold else FontWeight.Normal)
                        pack.at("feature").str()?.let { Text(it, color = MaterialTheme.colorScheme.tertiary, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall) }
                    }
                    Muted(packLine(pack))
                }
                if (id == chosen) Tag("選択中", MaterialTheme.colorScheme.primary)
                Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 8.dp))
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

/**
 * 契約更改。チェックした選手が退団する（最低9人は残す）。
 * ⚠ Web 版の `ContractPlanner` と同じ材料を出す（いしだ指摘: 切る判断ができているか分からない）:
 *    退団後の区分ごとの人数・トライアウトで獲れる人数・今季の成績・標準案の理由（サーバーの `phase.releaseAdvice`）
 * @param editable false なら読むだけ（指導者に任せた手続き。チェックを押せない）
 */
@Composable
private fun ReleasePanel(model: AppViewModel, raw: JsonObject, plan: JsonObject, setPlan: (JsonObject) -> Unit, editable: Boolean = true) {
    val roster = raw.at("roster").list().mapNotNull { it.obj() }
    val releases = plan.at("releaseIds").list().mapNotNull { it.long() }
    val advice = raw.at("phase", "releaseAdvice").obj()
    val remaining = roster.filter { it.pid !in releases }
    // ⚠ 開いたときに退団予定だった選手を先頭にまとめる（以前は名簿の順のままで、退団予定が一覧の中に散っていた）。
    //    並びは開いたときに1回だけ決める（チェックのたびに並び替えると、押した行が動いて見失う）
    val order = remember(roster.map { it.pid }) {
        val first = releases.toSet()
        roster.sortedByDescending { it.pid in first }.map { it.pid }
    }
    val byId = roster.associateBy { it.pid }
    Section(
        "退団させる選手（${releases.size}人）",
        trailing = {
            // ⚠ 決まりの説明は ⓘ の中（以前は2段落が常に出ていた）。人数の集計は下の帯に出す
            InfoButton(
                "契約更改",
                listOf(
                    "チェックした選手が退団します。最低9人を残してください。",
                    "続くトライアウトで最大 ${(ROSTER_LIMIT - remaining.size).coerceAtLeast(0)}人を獲れます（上限${ROSTER_LIMIT}人）。目標に足りない区分はトライアウトで優先して埋まります。",
                    "標準案は「30歳以上」と「能力の低さ」で点を付けて選び、トライアウトで入れ替えるため毎年少なくとも3人を出します。",
                    "このあとの年度更新で、若い選手は伸び、30歳を過ぎると衰えやすくなります。",
                ),
            )
        },
    ) {
        order.mapNotNull { byId[it] }.forEach { p ->
            val checked = p.pid in releases
            val reasons = advice?.get(p.pid.toString()).list().mapNotNull { it.str() }.takeIf { advice?.containsKey(p.pid.toString()) == true }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = checked,
                    onCheckedChange = { on ->
                        val next = if (on) releases + p.pid else releases - p.pid
                        setPlan(Commands.withReleases(plan, next))
                    },
                    enabled = editable,
                )
                Column(Modifier.weight(1f)) {
                    PlayerSummary(p, { model.openPlayer = it }) { if (checked) Tag("退団予定") }
                    Muted(seasonLine(p))
                    if (reasons != null) Text(
                        "標準案で退団: " + (reasons.joinToString("・").ifEmpty { "枠を空けるため" }),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.tertiary,
                    )
                }
            }
        }
    }
}

/** 退団後の人数（「退団3人 · 残り21人 · 投9/11 捕2/2 内6/6 外4/7」）。決定の帯に出す */
private fun releaseSummary(raw: JsonObject, plan: JsonObject): String {
    val roster = raw.at("roster").list().mapNotNull { it.obj() }
    val releases = plan.at("releaseIds").list().mapNotNull { it.long() }
    val remaining = roster.filter { it.pid !in releases }
    val counts = rosterCounts(remaining)
    return "退団${releases.size}人 · 残り${remaining.size}人 · " + listOf("pitcher" to "投", "catcher" to "捕", "infielder" to "内", "outfielder" to "外")
        .joinToString(" ") { (k, l) -> "$l${counts[k] ?: 0}/${ONLINE_ROSTER_TARGETS[k] ?: 0}" }
}

/** 名簿の残りの枠（トライアウトの獲得希望人数の上限） */
internal fun rosterRoom(raw: JsonObject): Int = (ROSTER_LIMIT - raw.at("roster").list().size).coerceAtLeast(0)
