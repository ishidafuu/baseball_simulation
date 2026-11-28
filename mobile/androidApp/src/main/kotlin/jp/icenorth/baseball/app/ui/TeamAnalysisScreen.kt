package jp.icenorth.baseball.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import jp.icenorth.baseball.app.AppViewModel
import jp.icenorth.baseball.shared.LEAGUE_NAMES
import jp.icenorth.baseball.shared.LeagueView
import jp.icenorth.baseball.shared.OnlineJson
import jp.icenorth.baseball.shared.TeamDiagnosis
import jp.icenorth.baseball.shared.TeamPolicy
import jp.icenorth.baseball.shared.allTeamRatings
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.SERVER_UPDATE_PENDING
import jp.icenorth.baseball.shared.defenseGrade
import jp.icenorth.baseball.shared.defensePositionLabel
import jp.icenorth.baseball.shared.defenseRows
import jp.icenorth.baseball.shared.defenseRange
import jp.icenorth.baseball.shared.fitnessAt
import jp.icenorth.baseball.shared.hasTeamRatings
import jp.icenorth.baseball.shared.isFieldPosition
import jp.icenorth.baseball.shared.int
import jp.icenorth.baseball.shared.jsRound
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.num
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.rankIn
import jp.icenorth.baseball.shared.rate3
import jp.icenorth.baseball.shared.ratingAverage
import jp.icenorth.baseball.shared.ratingScales
import jp.icenorth.baseball.shared.rivalsOf
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.teamLabel
import jp.icenorth.baseball.shared.teamRatingsOf
import kotlinx.serialization.json.JsonObject

/*
 * チーム分析（選手タブ）の「能力」「スタメン」「守備」。PC の左メニュー「チーム分析」（src/online/TeamAnalysis.jsx）の写し。
 * ⚠ 先方要望（2026-11-20）。チーム能力値は**いまの起用**に就いている選手の能力の平均で、見せるだけ（強さには効かない）。
 *    値はサーバーが全球団ぶん作る（ビューの teamRatings）
 */

/**
 * 球団の名簿と起用（自球団は手元のビュー、他球団はその場で読む）。
 * ⚠ 呼ぶのは PlayersScreen の1か所だけにし、「能力」「スタメン」「守備」へ同じものを渡す。以前は切り替えごとに
 *    呼んでいて、他球団を見ながら切り替えるたびに同じ `team` を読み直していた（2026-11-20 監査）
 */
class TeamData(val roster: List<JsonObject>?, val lineup: JsonObject?, val failure: String?, val policy: TeamPolicy? = null, val retry: () -> Unit)

/** ビュー・球団の読み込みの `staff.policy`（チームの方針）。無い・壊れた値は null */
private fun policyOf(staff: JsonObject?): TeamPolicy? =
    staff?.at("policy")?.obj()?.let { runCatching { OnlineJson.decodeFromJsonElement(TeamPolicy.serializer(), it) }.getOrNull() }

@Composable
fun rememberTeamData(model: AppViewModel, view: LeagueView, raw: JsonObject, team: String): TeamData {
    val own = team == view.teamName
    var roster by remember(team) { mutableStateOf<List<JsonObject>?>(null) }
    var lineup by remember(team) { mutableStateOf<JsonObject?>(null) }
    var policy by remember(team) { mutableStateOf<TeamPolicy?>(null) }
    var failure by remember(team) { mutableStateOf<String?>(null) }
    var attempt by remember(team) { mutableStateOf(0) }
    LaunchedEffect(team, view.revision, attempt) {
        if (own) return@LaunchedEffect
        try {
            val result = model.read("team", mapOf("team" to team))
            roster = result.at("roster").list().mapNotNull { it.obj() }
            lineup = result.at("lineup").obj()
            policy = policyOf(result.at("staff").obj())
            failure = null
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            failure = model.describe(e)
        }
    }
    val ownPolicy = remember(raw) { if (own) policyOf(raw.at("staff").obj()) else null }
    return if (own) TeamData(raw.at("roster").list().mapNotNull { it.obj() }, view.lineup, null, ownPolicy) {}
    else TeamData(roster, lineup, failure, policy) { failure = null; attempt += 1 }
}

private fun sumOf(roster: List<JsonObject>, side: String, key: String): Int =
    roster.sumOf { it.at("seasonStats", side, key).num()?.toInt() ?: 0 }

/** チーム能力値（レーダー）と今季のチーム成績。自球団はチーム診断も */
@Composable
fun TeamOverviewPane(model: AppViewModel, view: LeagueView, raw: JsonObject, team: String, data: TeamData, onOpenPlan: (String) -> Unit, onOpenTrade: () -> Unit) {
    val own = team == view.teamName
    val rivals = remember(raw, team) { rivalsOf(view, raw, team) }
    val everyone = remember(raw) { allTeamRatings(raw) }
    val ratings = teamRatingsOf(raw, team)
    val inLeague = rivals.mapNotNull { everyone[it] }
    val league = LEAGUE_NAMES[view.teamLeagues[team]] ?: "リーグ"
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Section("チーム能力値") {
            Muted("いまの起用（スタメン・先発ローテ・リリーフ・控え）に就いている選手の能力の平均です（0〜100）。図は項目ごとにリーグ全球団の中で比べた位置で、外ほど上です。目安で、試合の強さを直接決める数字ではありません。")
            // ⚠ 項目が無い（古いサーバー）のと、その球団の値が無い（起用がまだ無い）を分ける（判断6、2026-11-20 監査）
            if (!hasTeamRatings(raw)) Muted(SERVER_UPDATE_PENDING)
            else if (ratings == null) Muted("起用がまだ無いので、チーム能力値を出せません。")
            else TeamRadar(
                ratings = ratings,
                average = if (inLeague.isEmpty()) null else ratingAverage(inLeague),
                ranks = if (inLeague.isEmpty()) null else jp.icenorth.baseball.shared.RATING_AXES.associate { a -> a.key to rankIn(inLeague.map { it[a.key]?.toDouble() }, ratings[a.key]?.toDouble()) },
                scales = ratingScales(everyone.values + listOf(ratings)),
                label = view.teamLabel(team),
            )
        }
        data.policy?.let { TeamPolicyCard(it) }
        Section("今季のチーム成績") {
            val stats = raw.at("teamStats", team).obj()
            val avg = stats?.at("average").num()
            val era = stats?.at("era").num()
            val avgRank = rankIn(rivals.map { raw.at("teamStats", it, "average").num() }, avg)
            val eraRank = rankIn(rivals.map { raw.at("teamStats", it, "era").num() }, era, better = false)
            val roster = data.roster
            when {
                data.failure != null -> LoadFailed(data.failure, onRetry = data.retry)
                roster == null -> Muted("読み込み中…")
                else -> {
                    val chances = sumOf(roster, "batting", "fieldingChances")
                    val errors = sumOf(roster, "batting", "errors")
                    Tiles(
                        listOf(
                            Triple("チーム打率", avg?.let { rate3(it) } ?: "—", avgRank?.let { "$league${it}位" }),
                            Triple("チーム防御率", era?.let { "%.2f".format(it) } ?: "—", eraRank?.let { "$league${it}位" }),
                            Triple("本塁打", "${sumOf(roster, "batting", "homeruns")}", null),
                            Triple("盗塁", "${sumOf(roster, "batting", "stolenBases")}", null),
                            Triple("奪三振", "${sumOf(roster, "pitching", "strikeouts")}", null),
                            Triple("失策", "$errors", if (chances > 0) "守備率${rate3((chances - errors).toDouble() / chances)}" else null),
                        ),
                    )
                    Muted("順位は同じ部の中で比べています。")
                }
            }
        }
        if (own) {
            val diagnosis = remember(raw) {
                raw.at("diagnosis").obj()?.let { runCatching { OnlineJson.decodeFromJsonElement(TeamDiagnosis.serializer(), it) }.getOrNull() }
            }
            diagnosis?.let { DiagnosisCard(it, onOpenPlan, onOpenTrade) }
        }
    }
}

/**
 * チームの方針（先方要望 #9）。PC の TeamAnalysis.jsx の TeamPolicy の写し。
 * 見出し（監督の野球の一言）・札・6行（攻撃・投手起用・重心・編成・育成・いまの重点）と、人の球団の注
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TeamPolicyCard(policy: TeamPolicy) {
    Section("チームの方針") {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("team-policy")) {
            Text(policy.headline, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f, fill = false))
            policy.by?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if (policy.tags.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                policy.tags.forEach { tag ->
                    Text(
                        tag,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                        modifier = Modifier
                            .background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(999.dp))
                            .padding(horizontal = 10.dp, vertical = 2.dp),
                    )
                }
            }
        }
        policy.rows.forEach { row ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(row.label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(72.dp))
                Column(Modifier.weight(1f)) {
                    Text(row.value, fontWeight = FontWeight.Bold)
                    Text(row.note, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        policy.note?.let { Muted(it) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Tiles(tiles: List<Triple<String, String, String?>>) {
    FlowRow(Modifier.fillMaxWidth().testTag("team-tiles"), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 3) {
        tiles.forEach { (label, value, note) ->
            Column(
                Modifier.weight(1f).background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(8.dp)).padding(8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(note.orEmpty(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** スタメン・投手陣（いまの打順と守備位置、先発ローテとリリーフの役割） */
@Composable
fun TeamLineupPane(model: AppViewModel, data: TeamData) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
        val roster = data.roster
        when {
            data.failure != null -> LoadFailed(data.failure, onRetry = data.retry, modifier = Modifier.padding(16.dp))
            roster == null -> Muted("読み込み中…", Modifier.padding(16.dp))
            data.lineup == null -> Muted("この球団のスタメンはまだ読めません。次に日付が進むと出ます。", Modifier.padding(16.dp))
            else -> TeamLineupCard(data.lineup, roster) { model.openPlayer = it }
        }
    }
}

/** 守備分析: いまのスタメンの守備位置ごとの守備範囲・適性・失策（守備位置の順） */
@Composable
fun TeamDefensePane(model: AppViewModel, data: TeamData) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val roster = data.roster
        val lineup = data.lineup
        when {
            data.failure != null -> LoadFailed(data.failure, onRetry = data.retry)
            roster == null -> Muted("読み込み中…")
            lineup == null || lineup.at("battingOrder").list().isEmpty() -> Muted("この球団のスタメンはまだ読めません。次に日付が進むと出ます。")
            else -> {
                val byId = roster.associateBy { it.at("id").num()?.toLong() }
                // DH の行も末尾に出す（PC と同じ。判断6、2026-11-20 監査）。チーム守備の平均には入れない
                val order = defenseRows(lineup.at("battingOrder").list().mapNotNull { it.obj() })
                val ranges = order.filter { isFieldPosition(it.at("position").str()) }.mapNotNull { e -> byId[e.at("playerId").num()?.toLong()]?.let { defenseRange(it, e.at("position").str().orEmpty()) } }
                val teamRange = if (ranges.isEmpty()) 0.0 else ranges.average()
                val teamGrade = defenseGrade(teamRange)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("チーム守備 ", style = MaterialTheme.typography.titleSmall)
                    Text(teamGrade.label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Color(teamGrade.color))
                    Muted("　平均の守備範囲 ${jsRound(teamRange * 100)}")
                }
                Section("守備位置ごと") {
                    Row(Modifier.fillMaxWidth()) {
                        val head = MaterialTheme.typography.labelSmall
                        val ink = MaterialTheme.colorScheme.onSurfaceVariant
                        Text("守備", style = head, color = ink, modifier = Modifier.width(34.dp))
                        Text("選手", style = head, color = ink, modifier = Modifier.weight(1f))
                        Text("範囲", style = head, color = ink, modifier = Modifier.width(48.dp), textAlign = TextAlign.End)
                        Text("適性", style = head, color = ink, modifier = Modifier.width(36.dp), textAlign = TextAlign.End)
                        Text("失策", style = head, color = ink, modifier = Modifier.width(30.dp), textAlign = TextAlign.End)
                        Text("守備率", style = head, color = ink, modifier = Modifier.width(58.dp), textAlign = TextAlign.End)
                    }
                    order.forEach { e ->
                        val pos = e.at("position").str().orEmpty()
                        val p = byId[e.at("playerId").num()?.toLong()]
                        Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(defensePositionLabel(pos), modifier = Modifier.width(34.dp), fontWeight = FontWeight.Bold)
                                if (p == null) {
                                    Muted("（空き）")
                                    return@Row
                                }
                                PlayerName(p, { model.openPlayer = it }, Modifier.weight(1f))
                                val range = defenseRange(p, pos)
                                val grade = defenseGrade(range)
                                Row(Modifier.width(48.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                                    Text(grade.label, fontWeight = FontWeight.Bold, color = Color(grade.color))
                                    Text(" ${jsRound(range * 100)}", style = MaterialTheme.typography.labelSmall)
                                }
                                // ⚠ 本職（適性100）は空欄。本職でない人だけ数字を出す（以前は全員100で、列が同じ数字だけだった。UI総点検 A7）
                                val fitness = fitnessAt(p, pos)
                                Text(if (fitness >= 100 || !isFieldPosition(pos)) "" else "$fitness", modifier = Modifier.width(36.dp), textAlign = TextAlign.End, color = if (fitness < 60) MaterialTheme.colorScheme.error else Color.Unspecified)
                                val chances = p.at("seasonStats", "batting", "fieldingChances").num()?.toInt() ?: 0
                                val errors = p.at("seasonStats", "batting", "errors").num()?.toInt() ?: 0
                                Text("$errors", modifier = Modifier.width(30.dp), textAlign = TextAlign.End)
                                Text(if (chances > 0) rate3((chances - errors).toDouble() / chances) else "—", modifier = Modifier.width(58.dp), textAlign = TextAlign.End)
                            }
                            if (p != null) {
                                Row(Modifier.padding(start = 34.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    AbilityNum("守備", p.at("fielding", "defense").num()?.toInt())
                                    AbilityNum("肩", p.at("physical", "arm").num()?.toInt())
                                    AbilityNum("走力", p.at("physical", "speed").num()?.toInt())
                                }
                            }
                        }
                    }
                }
                Muted("守備範囲は守備・走力・肩を位置ごとの重みで足し、適性で割り引いたものです（スタメン設定の守備図と同じ）。ランクは S〜F。適性は本職でない位置を守る人だけ出します（本職は100）。")
            }
        }
    }
}
