package jp.icenorth.baseball.shared

import kotlinx.serialization.json.JsonObject

/**
 * ゲームの TIPS（画面には出ないが勝敗や成長に効く決まり）。
 *
 * 文章だけ直したいときは、下の `GAME_TIPS` の中の文字を書き換えるだけでよい。
 * 並べ替え・追加・削除もそのまま画面に反映される。
 *
 * ⚠ **数字は PC 版の説明（ManualScreen.jsx）ではなく、ゲームの実際の値から書くこと**。
 *    説明のほうが古い箇所がある（2026-11 時点で、打者の疲労ペナルティと成長の摩耗の境目がずれていた）。
 *    出どころ:
 *    - 疲労の溜まり方・回復: src/game/autoSimulation.js（試合後の集計・`recoverAllPitcherFatigue`）
 *    - 疲労による能力低下: src/game/autoSimulation.js（打者 疲労²/1200、投手 疲労²/670）
 *    - 自動の休養・先発飛ばし: server/dailyLineup.mjs と src/online/shared.js の定数
 *    - 休養日: src/online/pyramidLeague.js（`REST_EVERY`）
 *    - 成長の摩耗: src/utils/constants.js（`getFatigueGrowthPenalty`）
 *    - 調子: src/game/condition.js
 *    ゲーム側の値を変えたら、ここも合わせて直すこと。
 */
data class GameTip(val category: String, val title: String, val body: String, val id: String = "")

/** 一覧画面の見出しの順 */
val TIP_CATEGORIES = listOf("疲労", "調子", "試合", "成長")

val GAME_TIPS: List<GameTip> = listOf(
    // ---- 疲労
    GameTip(
        "疲労", "野手の疲労は「スタメンで3打席以上」でたまる",
        "1試合で7〜15。体力が高いほど少ない。代打や守備固めではたまらないが、その日は回復もしない。",
    ),
    GameTip(
        "疲労", "疲労が抜けるのは休養日だけ",
        "3連戦ごとに1日の休養日がある。試合に出た日は回復しない。休養日の回復量は体力と回復力が高いほど多い（野手で1日およそ20〜60）。",
    ),
    GameTip(
        "疲労", "疲れた打者は打てない",
        "ミート・パワー・走力が、疲労60で-3、80で-5、100で-8下がる（選球眼はその半分）。",
    ),
    GameTip(
        "疲労", "疲れた投手はもっと落ちる",
        "球速・制球が、疲労60で-5、80で-10、100で-15下がる。さらに試合開始時のスタミナも疲労のぶん減る（最低でも半分は残る）ので、早く降板しやすい。",
    ),
    GameTip(
        "疲労", "疲労80以上の野手は、その日だけ自動で休む",
        "守備適性60以上・疲労40未満の控えと入れ替わる。保存したスタメンは書き換わらず、次の試合では元に戻る。スタメンが勝手に変わって見えたら、これが理由。", id = "fielderRest",
    ),
    GameTip(
        "疲労", "疲労40以上の先発は登板を飛ばされる",
        "その日は次の順番の先発が投げる。ローテーションを組むときは先発の疲労も見ておくとよい。", id = "starterSkip",
    ),
    GameTip(
        "疲労", "先発は1試合で大きく疲れる",
        "100球で疲労+63〜77（1回以上投げると登板そのものの負荷+30込み）。投手の回復は1日およそ16〜25なので、中4〜5日が目安。",
    ),
    GameTip(
        "疲労", "リリーフは少ない球数でも疲れる",
        "1登板で最低でも疲労+11。連投が続くと疲労が抜けない。",
    ),
    GameTip(
        "疲労", "疲れたまま出すと成長が鈍る",
        "疲労41以上でスタメン出場（投手は10球を超える登板）するたびに成長率が下がる。41〜60で-0.01、61〜80で-0.02、81以上で-0.03。", id = "growthWear",
    ),
    GameTip(
        "疲労", "死球は疲労になる",
        "球が速いほど、体力が低いほど重い。数日は本調子でなくなる。代打の1打席でも疲労がたまる。",
    ),
    // ---- 調子
    GameTip(
        "調子", "調子は毎日変わり、打撃に大きく効く",
        "絶好調はミート+10・パワー+5、絶不調は-10・-5。投手は制球が±10。全員の調子をそろえた実測で、絶好調の打率.280、絶不調.214。", id = "condition",
    ),
    GameTip(
        "調子", "若い選手ほど調子の波が大きい",
        "ベテランほど「普通」に落ち着く。調子は1日ごとに変わり、1段階の上下はよく起きるが、2段階以上の急変はまれ。",
    ),
    // ---- 試合
    GameTip(
        "試合", "本職でない守備位置では力が落ちる",
        "守備適性100で100%、70で85%、30で65%しか発揮できない。", id = "offPosition",
    ),
    GameTip(
        "試合", "得点圏では精神力が効く",
        "精神力50を基準に、10高いごとにミート・パワー（投手は制球）が+1、10低いごとに-1。",
    ),
    GameTip(
        "試合", "先発が降ろされる3つの理由",
        "球数の上限に届く、スタミナが25%を切る、打たれた量（安打・四球・失点の積み重ね）が限度を超える。後半の回ほど、少し打たれただけで降板する。",
    ),
    GameTip(
        "試合", "打撃方針の効き方",
        "慎重はミート+3・選球眼+10・パワー-5。積極はパワー+8・ミート-5・選球眼-5。",
    ),
    // ---- 成長
    GameTip(
        "成長", "試合に出した量が成長に効く",
        "年300打席の選手は、0打席の選手の約2倍伸びる。野手は10試合出場ごとに成長率+0.01。",
    ),
    GameTip(
        "成長", "能力ごとにピークの年齢が違う",
        "走力23歳、球速24歳、肩25歳、ミート・守備・スタミナ27歳、パワー・選球眼29歳、制球31歳。",
    ),
    GameTip(
        "成長", "プロ意識が高いほど衰えが遅い",
        "若い頃の能力とプロ意識が、ほぼ同じくらい将来を決める。",
    ),
)

/** 今のチームに当てはまるTIPS。`who` はその状態の選手（「名前（疲労85）」など） */
data class SituationTip(val tip: GameTip, val who: List<String>)

/**
 * 前に読んだときに無かったTIPSがあるか（あれば「i」マークを点滅させる。いしだ指定: 一度読んだら点滅を止める）。
 * [seen] は最後に読んだときに出ていたTIPSの id。中の選手（疲れた人の顔ぶれ）が変わっただけでは点滅させない
 * （毎日のように点滅してしまうため）。別の種類のTIPSが出たときだけ、また点滅する。
 */
fun hasUnreadTips(tips: List<SituationTip>, seen: Set<String>): Boolean = tips.any { it.tip.id !in seen }

/** これ未満の守備適性で守っていたら知らせる（80で発揮90%。それより上は差が小さいので出さない） */
const val OFF_POSITION_NOTICE_FITNESS = 80

/**
 * 保存されたスタメン・先発ローテと選手の状態から、当てはまるTIPSを選ぶ。
 * 何も当てはまらなければ空。並びは「試合に直接効く順」。
 *
 * ⚠ 境目はサーバーと同じ定数（Tables.kt の FIELDER_REST_FATIGUE など）を使うこと。
 */
fun situationTips(roster: List<Player>, lineup: JsonObject?, tips: List<GameTip> = GAME_TIPS): List<SituationTip> {
    if (lineup == null) return emptyList()
    val draft = LineupDraft.from(lineup)
    val byId = roster.associateBy { it.id }
    val batters = draft.slots.mapNotNull { slot -> byId[slot.playerId]?.let { it to slot.position } }
    val starters = draft.starters.mapNotNull { byId[it] }
    val f = { p: Player -> p.fatigue ?: 0 }
    val tipById = tips.associateBy { it.id }
    return buildList {
        fun add(id: String, who: List<String>) {
            val tip = tipById[id] ?: return
            if (who.isNotEmpty()) add(SituationTip(tip, who))
        }
        add("fielderRest", batters.filter { f(it.first) >= FIELDER_REST_FATIGUE }.map { "${it.first.name}（疲労${f(it.first)}）" })
        add("starterSkip", starters.filter { f(it) >= STARTER_SKIP_FATIGUE }.map { "${it.name}（疲労${f(it)}）" })
        add(
            "offPosition",
            batters.filter { (p, pos) -> pos in FIELD_POSITIONS && p.fitness(pos) < OFF_POSITION_NOTICE_FITNESS }
                .map { (p, pos) -> "${p.name}（${positionLabel(pos)}・適性${p.fitness(pos)}）" },
        )
        add("condition", batters.filter { it.first.condition == 0 }.map { "${it.first.name}（絶不調）" })
        // 自動で休む人（80以上）は上で知らせたので、ここは成長が鈍り始める41〜79だけ
        add(
            "growthWear",
            batters.filter { fatigueTone(f(it.first)) > 0 && f(it.first) < FIELDER_REST_FATIGUE }.map { "${it.first.name}（疲労${f(it.first)}）" },
        )
    }
}
