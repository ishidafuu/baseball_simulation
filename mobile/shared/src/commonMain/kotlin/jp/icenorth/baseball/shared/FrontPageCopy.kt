package jp.icenorth.baseball.shared

import kotlinx.serialization.json.JsonObject

/*
 * 紙面の言い回し（テンプレート）。[buildFrontPage] から使う。
 *
 * ⚠ ワンパターンで飽きないよう、場面ごとに言い回しを何通りも持つ（いしだ指定:「思いつく限りたくさん」）。
 * ⚠ どれを使うかは**試合（日付）で決める**。乱数にすると、同じ試合の紙面が開き直すたびに変わって見える。
 *    同じ試合なら同じ言い回し、次の試合では別の言い回しになる。見出し・小見出し・リードなどは
 *    別々の「塩」で選ぶので、組み合わせも試合ごとに変わる。
 * ⚠ 言い回しを足すときは、場面の判定（[GameFacts]）で確かに言えることだけを書く。
 *    たとえば「サヨナラ」「逆転」は今の記録（イニングごとの得点が無い）からは判定できないので使わない。
 */

/** 言い回しを選ぶ。同じ seed と salt なら必ず同じものを返す */
internal class Pen(private val seed: Int) {
    fun <T> pick(pool: List<T>, salt: Int): T {
        var h = seed * 1_000_003 + salt * 7919
        h = h xor (h ushr 13)
        h *= 0x5bd1e995
        h = h xor (h ushr 15)
        return pool[h.mod(pool.size)]
    }
}

/** 試合の詳細（ボックススコア）から分かる、自球団と相手のこと */
internal class GameFacts(
    val ourHits: Int,
    val theirHits: Int?,
    val ourHomeruns: Int,
    val ourErrors: Int,
    val ourSteals: Int,
    /** 自球団で投げた投手（投げた順ではなくアウトの多い順） */
    val ourPitchers: List<PitcherLine>,
    val batters: List<BatterLine>,
    /** 回ごとの得点（自球団 / 相手）。記録に無い古い試合は null */
    val ourInnings: List<Int>? = null,
    val theirInnings: List<Int>? = null,
    /** 自球団が後攻か（回ごとの点差を正しい順で数えるため） */
    val ourHome: Boolean = false,
    val walkOff: Boolean = false,
    /** 決勝打（勝った側が最後に勝ち越した打点）。自球団が勝った日だけ入れる */
    val winningHit: WinningHit? = null,
    /** 相手の決勝打（自球団が負けた日だけ） */
    val theirWinningHit: WinningHit? = null,
) {
    /** 半回ごとの、自球団から見た点差（表→裏の順）。記録が無ければ空 */
    val diffs: List<Int>
        get() {
            val ours = ourInnings ?: return emptyList()
            val theirs = theirInnings ?: return emptyList()
            val (away, home) = if (ourHome) theirs to ours else ours to theirs
            var a = 0
            var h = 0
            val out = mutableListOf<Int>()
            for (i in 0 until maxOf(away.size, home.size)) {
                away.getOrNull(i)?.let { a += it; out += if (ourHome) h - a else a - h }
                home.getOrNull(i)?.let { h += it; out += if (ourHome) h - a else a - h }
            }
            return out
        }
    /** 一度でもリードされた（勝った日なら逆転勝ち） */
    val trailed: Boolean get() = diffs.any { it < 0 }
    /** 一度でもリードした（負けた日なら逆転負け） */
    val led: Boolean get() = diffs.any { it > 0 }
    /** 最大で何点差をひっくり返したか（勝った日） */
    val maxDeficit: Int get() = -(diffs.minOrNull() ?: 0).coerceAtMost(0)
    /** 先に点を取ったのは自球団か（0-0 なら null） */
    val scoredFirst: Boolean? get() = diffs.firstOrNull { it != 0 }?.let { it > 0 }

    /** 1人で最後まで投げた */
    val complete: Boolean get() = ourPitchers.size == 1 && ourPitchers[0].outs >= 24
    val ace: PitcherLine? get() = ourPitchers.firstOrNull()
    val topBatter: BatterLine? get() = batters.maxByOrNull { it.hr * 4 + it.rbi * 2 + it.hits }
    val multiHomer: BatterLine? get() = batters.filter { it.hr >= 2 }.maxByOrNull { it.hr * 10 + it.rbi }

    companion object {
        fun from(game: JsonObject?, team: String): GameFacts? {
            val teams = game?.at("teams").obj() ?: return null
            val ours = teams[team].list().mapNotNull { it.obj() }
            if (ours.isEmpty()) return null
            val theirs = teams.keys.firstOrNull { it != team }?.let { teams[it].list().mapNotNull { p -> p.obj() } }
            val ourHome = game.at("home").str() == team
            val hit = game.at("winningHit").obj()?.let { h ->
                h.at("name").str()?.let { WinningHit(h.at("team").str().orEmpty(), it, h.at("inning").int() ?: 0, h.at("homerun").bool() == true, h.at("hit").bool() == true, h.at("rbis").int() ?: 1) }
            }
            fun List<JsonObject>.sum(group: String, key: String) = sumOf { it.at(group, key).num()?.toInt() ?: 0 }
            return GameFacts(
                ourHits = ours.sum("batting", "hits"),
                theirHits = theirs?.sum("batting", "hits"),
                ourHomeruns = ours.sum("batting", "homeruns"),
                ourErrors = ours.sum("batting", "errors"),
                ourSteals = ours.sum("batting", "stolenBases"),
                ourPitchers = ours.mapNotNull { p ->
                    val outs = p.at("pitching", "inningsPitched").num()?.toInt() ?: 0
                    if (outs <= 0) null
                    else PitcherLine(
                        p.at("name").str().orEmpty(),
                        outs,
                        p.at("pitching", "runsAllowed").num()?.toInt() ?: 0,
                        p.at("pitching", "strikeouts").num()?.toInt() ?: 0,
                    )
                }.sortedByDescending { it.outs },
                batters = ours.map { p ->
                    BatterLine(
                        p.at("name").str().orEmpty(),
                        p.at("batting", "hits").num()?.toInt() ?: 0,
                        p.at("batting", "homeruns").num()?.toInt() ?: 0,
                        p.at("batting", "rbis").num()?.toInt() ?: 0,
                        p.at("id").long(),
                    )
                },
                ourInnings = innings(game!!, ourHome).first,
                theirInnings = innings(game!!, ourHome).second,
                ourHome = ourHome,
                walkOff = game.at("walkOff").bool() == true,
                winningHit = hit?.takeIf { it.team == team },
                theirWinningHit = hit?.takeIf { it.team != team },
            )
        }
    }
}

/** 試合の回ごとの得点（自球団, 相手）。記録に無ければ null */
private fun innings(game: JsonObject, ourHome: Boolean): Pair<List<Int>?, List<Int>?> {
    val ls = game.at("lineScore").obj() ?: return null to null
    val home = ls.at("home").list().mapNotNull { it.int() }
    val away = ls.at("away").list().mapNotNull { it.int() }
    if (home.isEmpty() && away.isEmpty()) return null to null
    return if (ourHome) home to away else away to home
}

/** 決勝打。[hit] は安打か（犠飛・押し出しは false）。[homerun] なら安打でもある */
internal data class WinningHit(val team: String, val name: String, val inning: Int, val homerun: Boolean, val hit: Boolean, val rbis: Int) {
    /** 「本塁打」「適時打」「犠飛など」を文で言い分ける */
    val what: String get() = when { homerun -> "本塁打"; hit -> "適時打"; else -> "勝ち越しの打点" }
}

internal data class PitcherLine(val name: String, val outs: Int, val runs: Int, val strikeouts: Int)
internal data class BatterLine(val name: String, val hits: Int, val hr: Int, val rbi: Int, val id: Long? = null)

/** 1試合の場面（見出しを選ぶ材料） */
internal class Situation(
    val me: String,
    val opp: String,
    val home: Boolean,
    val ours: Int,
    val theirs: Int,
    /** 同じ結果が続いている数（今日を含む） */
    val streak: Int,
    /** 今日と逆の結果が、今日の前に続いていた数（連敗を止めた・連勝が止まった） */
    val brokenStreak: Int,
    val rank: Int?,
    val facts: GameFacts?,
) {
    val diff: Int get() = kotlin.math.abs(ours - theirs)
    val place: String get() = if (home) "本拠地" else "敵地"
}

/** 投球回の書き方。[Prose] は文の中（「7回」「6回2/3」「1/3回」）、[Box] は成績表の回の欄（「7」「2⅔」「⅓」） */
internal enum class InningsStyle { Prose, Box }

/** アウトの数 → 投球回（[style] で文の中か成績表の欄か） */
internal fun inningsText(outs: Int, style: InningsStyle): String {
    val whole = outs / 3
    val rest = outs % 3
    return when (style) {
        InningsStyle.Prose -> when {
            rest == 0 -> "${whole}回"
            whole == 0 -> "$rest/3回"
            else -> "${whole}回$rest/3"
        }
        InningsStyle.Box -> {
            val frac = when (rest) { 1 -> "⅓"; 2 -> "⅔"; else -> "" }
            if (whole == 0 && frac.isNotEmpty()) frac else "$whole$frac"
        }
    }
}

/** 「7回を1失点」「6回2/3を無失点」（数字が続いて「6回2/31失点」と読めないように「を」を挟む） */
internal fun allowed(runs: Int): String = if (runs == 0) "を無失点" else "を${runs}失点"

/** 勝った日の大見出し。上から順に当てはまる場面の言い回しを使う */
internal fun winHeadline(s: Situation, pen: Pen): String {
    val me = s.me
    val opp = s.opp
    val f = s.facts
    val ace = f?.ace?.name
    val pool: List<String> = when {
        // ⚠ ノーヒットノーランは無安打かつ無得点（四球や失策で点を取られたら言えない）
        f?.theirHits == 0 && s.theirs == 0 && f.complete -> listOf(
            "${ace}、ノーヒットノーラン！",
            "快挙 ${ace}が無安打無得点",
            "${ace} 歴史的快投 ノーノー達成",
            "${ace}、${opp}打線に1本も許さず",
        )
        f?.theirHits == 0 && s.theirs == 0 -> listOf(
            "${me}、継投でノーヒットノーラン",
            "${me}投手陣 無安打リレーの快挙",
            "${opp}打線を無安打に ${me}完璧リレー",
        )
        f?.walkOff == true -> f.winningHit.let { h ->
            when {
                h?.homerun == true -> listOf("${h.name}サヨナラ弾！ ${me}劇勝", "劇的 ${h.name}がサヨナラ本塁打", "${h.name}、サヨナラアーチで${opp}を沈める")
                h?.hit == true -> listOf("${h.name}、サヨナラ打 ${me}劇的勝利", "${h.name}が決めた ${me}サヨナラ勝ち", "劇的 ${h.name}のサヨナラ打")
                else -> listOf("${me}サヨナラ勝ち ${opp}を振り切る", "劇的 ${me}がサヨナラ勝ち", "${me}、${opp}にサヨナラ勝ち")
            }
        }
        s.theirs == 0 && f?.complete == true -> listOf(
            "${ace}完封 ${me}が${opp}を零封",
            "${ace}、圧巻の完封劇",
            "${ace}が${opp}打線を封じる 完封勝利",
            "${ace} 最後まで投げ抜き無失点",
            "完封 ${ace}が${opp}を寄せ付けず",
        )
        s.theirs == 0 -> listOf(
            "${me}、完封リレーで${opp}を零封",
            "${me}投手陣 零封リレー",
            "${me}、${opp}に得点許さず完封勝ち",
            "鉄壁 ${me}が完封勝利",
        )
        s.brokenStreak >= 3 -> listOf(
            "${me}、連敗を${s.brokenStreak}で止める",
            "${me}ようやく白星 連敗ストップ",
            "待望の勝利 ${me}が連敗脱出",
            "${me}、${opp}を下し連敗に終止符",
        )
        f != null && f.trailed && f.maxDeficit >= 3 -> listOf(
            "${me}、${f.maxDeficit}点差をひっくり返す",
            "${me}大逆転勝ち ${f.maxDeficit}点差を跳ね返す",
            "${me}執念の大逆転 ${opp}を下す",
        )
        f != null && f.trailed && s.diff <= 3 -> listOf(
            "${me}逆転勝ち ${opp}を下す",
            "${me}、逆転で${opp}を破る",
            "${me}粘って逆転勝利",
            "${me}、終盤に${opp}を逆転".takeIf { (f.winningHit?.inning ?: 0) >= 7 } ?: "${me}が逆転で白星",
        )
        s.ours >= 10 || s.diff >= 7 -> listOf(
            "${me}打線爆発 ${s.ours}点大勝",
            "${me}、${s.ours}得点の猛攻",
            "${me}打線が大爆発 ${opp}を圧倒",
            "${s.ours}点 ${me}が${opp}に大勝",
            "${me}止まらぬ猛打 ${s.ours}-${s.theirs}",
        )
        f?.multiHomer != null -> f.multiHomer!!.let { b ->
            listOf(
                "${b.name}${b.hr}発 ${me}快勝",
                "${b.name}、${b.hr}本塁打の大暴れ",
                "${b.name}が${b.hr}発 ${opp}を沈める",
            )
        }
        (f?.ourHomeruns ?: 0) >= 3 -> listOf(
            "${me}${f!!.ourHomeruns}発の一発攻勢",
            "${me}、アーチ${f!!.ourHomeruns}本で${opp}を圧倒",
            "${me}一発攻勢 ${f!!.ourHomeruns}本塁打で快勝",
        )
        s.diff == 1 -> listOf(
            "${me}、接戦を制す",
            "${me}1点差を逃げ切る",
            "${me}競り勝つ ${opp}を振り切る",
            "しびれる1点差 ${me}に軍配",
            "${me}、執念の1点差勝利",
        )
        s.streak >= 5 -> listOf(
            "${me}破竹の${s.streak}連勝",
            "${me}止まらない${s.streak}連勝",
            "${s.streak}連勝 ${me}の勢い本物",
        )
        s.streak >= 3 -> listOf(
            "${me}止まらない${s.streak}連勝",
            "${me}${s.streak}連勝 勢い止まらず",
            "${me}、${opp}も下して${s.streak}連勝",
            "${me}波に乗る${s.streak}連勝",
        )
        (f?.ace?.strikeouts ?: 0) >= 10 -> listOf(
            "${ace}${f!!.ace!!.strikeouts}奪三振 ${me}快勝",
            "${ace}、三振の山 ${f!!.ace!!.strikeouts}奪三振",
            "奪三振ショー ${ace}が${opp}を圧倒",
        )
        f?.complete == true -> listOf(
            "${ace}完投 ${me}勝利",
            "${ace}、1人で投げ抜く",
            "${ace}が完投勝利 ${opp}を下す",
        )
        (f?.ourHits ?: 0) >= 15 -> listOf(
            "${me}${f!!.ourHits}安打の猛攻",
            "${me}、${f!!.ourHits}安打で${opp}を圧倒",
        )
        (f?.ourSteals ?: 0) >= 3 -> listOf(
            "${me}足でかき回す ${f!!.ourSteals}盗塁",
            "${me}、機動力で${opp}を翻弄",
        )
        s.rank == 1 -> listOf(
            "${me}、首位がっちり",
            "首位${me}また勝った",
            "${me}首位固め ${opp}を下す",
        )
        else -> listOf(
            "${me}快勝 ${opp}を下す",
            "${me}、${opp}に勝利",
            "${me}白星 ${opp}を退ける",
            "${me}投打かみ合い勝利",
            "${me}、${opp}戦を制す",
            "${me}が${s.place}で白星",
            "${me}、${opp}を破る",
        )
    }
    return pen.pick(pool, 1)
}

/** 負けた日の大見出し */
internal fun loseHeadline(s: Situation, pen: Pen): String {
    val me = s.me
    val opp = s.opp
    val f = s.facts
    val pool: List<String> = when {
        f?.ourHits == 0 && s.ours == 0 -> listOf(
            "${me}、ノーヒットノーラン食らう",
            "${me}打線沈黙 無安打無得点",
            "屈辱 ${me}が無安打無得点",
        )
        f?.ourHits == 0 -> listOf(
            "${me}、無安打に抑えられる",
            "${me}打線 ヒット1本も出ず",
        )
        s.ours == 0 -> listOf(
            "${me}、零封負け",
            "${me}打線沈黙 ${opp}に完封される",
            "${me}あと1本が出ず 零敗",
            "${me}、${opp}投手陣を打てず",
            "${me}ゼロ行進 ${opp}に零封",
        )
        // ⚠ 「サヨナラ打」は安打のときだけ（押し出し・犠飛で決まった日は名前を出さない形。勝った日の見出しと同じ分け方）
        f?.walkOff == true -> f.theirWinningHit.let { h ->
            when {
                h?.homerun == true -> listOf("${me}、${h.name}にサヨナラ弾浴びる", "${me}痛恨のサヨナラ負け", "${me}、${opp}にサヨナラ負け")
                h?.hit == true -> listOf("${me}、${h.name}にサヨナラ打浴びる", "${me}痛恨のサヨナラ負け", "${me}、${opp}にサヨナラ負け")
                else -> listOf("${me}、サヨナラ負け", "${me}痛恨のサヨナラ負け", "${opp}にサヨナラ許す ${me}")
            }
        }
        s.brokenStreak >= 3 -> listOf(
            "${me}、連勝${s.brokenStreak}でストップ",
            "${me}の連勝止まる ${opp}に敗れる",
            "${opp}が${me}の連勝を止める",
        )
        s.diff >= 7 || s.theirs >= 10 -> listOf(
            "${me}投壊 ${s.theirs}失点の大敗",
            "${me}、${opp}に大敗",
            "${me}投手陣火だるま ${s.theirs}失点",
            "${me}、${opp}打線を止められず",
            "${me}大敗 ${s.ours}-${s.theirs}",
        )
        f != null && f.led && s.diff <= 3 -> listOf(
            "${me}逆転負け ${opp}に屈す",
            "${me}、リード守れず逆転負け",
            "${me}痛い逆転負け",
        )
        (f?.ourErrors ?: 0) >= 2 -> listOf(
            "${me}守乱で自滅",
            "痛恨の${f!!.ourErrors}失策 ${me}敗れる",
            "${me}、守りのミスから崩れる",
        )
        (f?.ourHits ?: 0) >= 10 -> listOf(
            "${me}${f!!.ourHits}安打も実らず",
            "${me}拙攻 好機生かせず",
            "${me}、打っても届かず",
        )
        s.diff == 1 -> listOf(
            "${me}あと一歩 惜敗",
            "${me}、1点に泣く",
            "${me}競り負ける ${opp}に惜敗",
            "惜しくも1点差 ${me}敗れる",
            "${me}、あと1点が遠く",
        )
        s.streak >= 5 -> listOf(
            "${me}泥沼の${s.streak}連敗",
            "${me}${s.streak}連敗 トンネル抜けず",
            "${me}止まらぬ連敗 ${s.streak}に",
        )
        s.streak >= 3 -> listOf(
            "${me}${s.streak}連敗 出口見えず",
            "${me}、${opp}にも敗れ${s.streak}連敗",
            "${me}${s.streak}連敗 トンネル続く",
        )
        else -> listOf(
            "${me}、${opp}に屈す",
            "${me}黒星 ${opp}に敗れる",
            "${me}、${opp}戦を落とす",
            "${me}反撃及ばず",
            "${me}、悔しい敗戦",
            "${me}が${s.place}で黒星",
        )
    }
    return pen.pick(pool, 1)
}

internal fun drawHeadline(s: Situation, pen: Pen): String = pen.pick(
    listOf(
        "${s.me}、${s.opp}と痛み分け",
        "${s.me}決着つかず ドロー",
        "${s.me}、${s.opp}と引き分け",
        "勝ち切れず ${s.me}ドロー",
        "${s.me}と${s.opp}、譲らず",
    ),
    1,
)

/** 小見出し（その日の主役）。試合の詳細が無ければ null */
internal fun heroSubhead(s: Situation, tone: FrontPage.Tone, pen: Pen): String? {
    val won = tone == FrontPage.Tone.Win
    val lost = tone == FrontPage.Tone.Lose
    val f = s.facts ?: return null
    val b = f.topBatter
    val p = f.ace
    // 投手が主役（無安打・完封・完投・2桁奪三振で、打者がそれほど目立たない日）
    val pitcherDay = p != null && won && ((f.theirHits == 0 && s.theirs == 0) || (f.complete && s.theirs <= 1) || p.strikeouts >= 10) &&
        (b == null || b.hr < 2)
    if (pitcherDay) {
        val line = "${inningsText(p!!.outs, InningsStyle.Prose)}${allowed(p.runs)}${if (p.strikeouts >= 7) "・${p.strikeouts}奪三振" else ""}"
        return pen.pick(
            listOf("${p.name} ${line}の快投", "${p.name}、${line}", "投げては${p.name}が${line}"),
            2,
        )
    }
    if (b != null && (b.hr > 0 || b.rbi >= 3 || b.hits >= 3)) {
        val parts = listOfNotNull("${b.hits}安打".takeIf { b.hits > 0 }, "${b.hr}本塁打".takeIf { b.hr > 0 }, "${b.rbi}打点".takeIf { b.rbi > 0 }).joinToString("・")
        val pool = when {
            lost && b.hits >= 3 -> listOf("${b.name} ${parts}も孤軍奮闘", "${b.name}、意地の${parts}", "${b.name}気を吐く ${parts}")
            lost -> listOf("${b.name} ${parts}も実らず", "${b.name}、意地の一打")
            !won -> listOf("${b.name} ${parts}", "${b.name}、${parts}の活躍")
            b.hr >= 2 -> listOf("${b.name} ${parts}の大暴れ", "${b.name}、1試合${b.hr}発", "主役は${b.name} ${parts}")
            b.hits >= 4 -> listOf("${b.name} ${b.hits}安打の固め打ち", "${b.name}、${parts}の大当たり", "${b.name}止まらない ${parts}")
            b.hits >= 3 -> listOf("${b.name} 猛打賞（${parts}）", "${b.name}、${parts}の活躍", "${b.name}が猛打賞")
            b.hr >= 1 && b.rbi >= 3 -> listOf("${b.name} 一発含む${b.rbi}打点", "${b.name}、${parts}で勝利に貢献", "${b.name}の一発が効く")
            b.rbi >= 3 -> listOf("${b.name} ${b.rbi}打点の活躍", "${b.name}、勝負強く${b.rbi}打点", "${b.name}がチャンスで決める")
            else -> listOf("${b.name}に一発", "${b.name}、${parts}", "${b.name}のアーチ")
        }
        return pen.pick(pool, 2)
    }
    if (p != null && p.outs >= 15) {
        val line = "${inningsText(p.outs, InningsStyle.Prose)}${allowed(p.runs)}"
        return if (lost) pen.pick(listOf("${p.name} ${line}も援護なく", "${p.name}、${line}の力投報われず", "${p.name}が${line}"), 2)
        else pen.pick(listOf("${p.name} ${line}の好投", "${p.name}、${line}で試合をつくる", "${p.name}が${line}"), 2)
    }
    return null
}

/** リード文（1文目＝結果、2文目＝勝敗と順位、3文目＝打線か投手のひと言） */
internal fun gameLead(s: Situation, dateText: String?, tone: FrontPage.Tone, record: String?, pen: Pen): String {
    val score = "${s.ours}-${s.theirs}"
    // 「4月3日、」と「4月3日の」の2つの形（日付が無ければどちらも空）
    val on = dateText?.let { "$it、" } ?: ""
    val of = dateText?.let { "${it}の" } ?: ""
    val first = when (tone) {
        FrontPage.Tone.Win -> pen.pick(
            listOf(
                "${on}${s.me}は${s.place}で${s.opp}と対戦し、${score}で勝利した。",
                "${s.me}が${s.place}で${s.opp}を${score}で破った。",
                "${of}${s.opp}戦、${s.me}は${score}で白星を挙げた。",
                "${s.me}は${s.opp}に${score}で勝ち、星を一つ伸ばした。",
            ),
            3,
        )
        FrontPage.Tone.Lose -> pen.pick(
            listOf(
                "${on}${s.me}は${s.place}で${s.opp}と対戦し、${score}で敗れた。",
                "${s.me}は${s.place}で${s.opp}に${score}で敗れた。",
                "${of}${s.opp}戦、${s.me}は${score}で星を落とした。",
                "${s.me}は${s.opp}に${score}で屈した。",
            ),
            3,
        )
        else -> "${on}${s.me}は${s.place}で${s.opp}と対戦し、${score}で引き分けた。"
    }
    val f = s.facts
    // 決勝打（勝った日）・相手の決勝打（負けた日）。サヨナラは大見出しで言っているので回だけ
    val decisive = when {
        f == null -> null
        tone == FrontPage.Tone.Win && f.winningHit != null -> f.winningHit.let { h ->
            if (f.walkOff) "${h.inning}回裏、${h.name}の${h.what}で試合を決めた。"
            else pen.pick(listOf("${h.inning}回に${h.name}の${h.what}で勝ち越した。", "決勝点は${h.inning}回、${h.name}の${h.what}。"), 12)
        }
        tone == FrontPage.Tone.Lose && f.theirWinningHit != null -> f.theirWinningHit.let { h ->
            pen.pick(listOf("${h.inning}回に${h.name}の${h.what}で勝ち越された。", "${h.inning}回、${h.name}に決勝の${h.what}を許した。"), 12)
        }
        else -> null
    }
    val color = if (f == null) null else when {
        tone == FrontPage.Tone.Win && f.ourHits >= 10 -> pen.pick(listOf("打線は${f.ourHits}安打と振れていた。", "${f.ourHits}安打を放った打線が試合を決めた。"), 4)
        tone == FrontPage.Tone.Win && f.ourPitchers.size >= 3 -> pen.pick(listOf("投手陣は${f.ourPitchers.size}人の継投でつないだ。", "${f.ourPitchers.size}投手の継投が実った。"), 4)
        tone == FrontPage.Tone.Lose && f.ourHits == 0 -> "打線は無安打に抑えられた。"
        tone == FrontPage.Tone.Lose && f.ourHits <= 3 -> pen.pick(listOf("打線はわずか${f.ourHits}安打に抑えられた。", "散発${f.ourHits}安打では勝てなかった。"), 4)
        tone == FrontPage.Tone.Lose && f.ourErrors >= 1 -> pen.pick(listOf("守りの${f.ourErrors}失策も響いた。", "${f.ourErrors}失策が痛かった。"), 4)
        f.ourSteals >= 2 -> "足を使った攻め（${f.ourSteals}盗塁）も見せた。"
        else -> null
    }
    return listOfNotNull(first, decisive, record, color).joinToString("")
}

/** 試合の無い時期の大見出しとリード（時期ごとに何通りか） */
internal fun phaseCopy(phase: String?, pendingPack: Boolean, preseason: Boolean, me: String, pen: Pen): Pair<String, String?> {
    val (heads, leads) = when {
        pendingPack || phase == "pack_select" -> listOf(
            "${me}始動 初期メンバー選びへ",
            "新球団${me}、24人の顔ぶれは",
            "${me}誕生 まずはメンバー選び",
        ) to listOf(
            "新リーグの幕開け。まずは24人の顔ぶれを決めるところから始まる。",
            "どのセットを選ぶかで、球団の色が決まる。悩みどころだ。",
        )
        phase == "initial_tryout" -> listOf(
            "${me}、初期編成で戦力を整える",
            "${me}補強へ 足りない所を埋める",
        ) to listOf("開幕前の最後の補強。足りない位置を埋めておきたい。")
        phase == "camp" -> listOf(
            "${me}、春季キャンプで鍛錬",
            "${me}キャンプイン 若手に期待",
            "球春到来 ${me}が始動",
            "${me}、汗を流す春",
        ) to listOf(
            "開幕を前に、選手たちは汗を流している。誰が伸びるかは練習の選び方次第だ。",
            "キャンプは1クールずつ。伸びた能力を見ながら次の練習を決めたい。",
            "本人の希望と噛み合う練習ほど身につく。首脳陣の腕の見せどころだ。",
        )
        phase == "contract" -> listOf(
            "${me}、契約更改の季節",
            "${me}ストーブリーグ 誰を残すか",
            "${me}、来季へ向けて編成に着手",
        ) to listOf("シーズンが終わり、来季の陣容を考える時期に入った。", "残す選手、手放す選手。オフの決断が来季を左右する。")
        phase == "tryout" -> listOf(
            "${me}、トライアウトで新戦力探し",
            "${me}補強へ トライアウトに注目",
            "掘り出し物は居るか ${me}がトライアウトへ",
        ) to listOf("新しい顔ぶれを探すトライアウト。他球団との取り合いになる。", "どの選手を何番目に狙うか。希望順の付け方が勝負だ。")
        phase == "offseason" -> listOf(
            "${me}、新シーズンへ",
            "${me}、新たな1年が始まる",
            "${me}来季へ再出発",
        ) to listOf("年度が替わり、新しいシーズンの準備が始まる。")
        preseason -> listOf(
            "開幕へ ${me}準備着々",
            "${me}、開幕を待つ",
            "いよいよ開幕 ${me}の戦いが始まる",
        ) to listOf("開幕に向けて、スタメンと投手起用を整えておきたい。")
        else -> listOf("${me}、次の戦いへ", "${me}、次戦に備える") to emptyList()
    }
    return pen.pick(heads, 1) to leads.takeIf { it.isNotEmpty() }?.let { pen.pick(it, 3) }
}

/** 「順位の行方」の見出しと本文 */
internal fun standingsCopy(
    me: String,
    rankIndex: Int,
    size: Int,
    top: String,
    topRecord: String,
    second: String?,
    gapToSecond: String?,
    gapToSecondValue: Double?,
    behind: String?,
    behindValue: Double?,
    leagueName: String,
    placeText: String?,
    pen: Pen,
): Pair<String, String> {
    val pool: List<Pair<String, String>> = when {
        // ゲーム差なし（「0.0差」とは書かない）
        rankIndex == 0 && gapToSecondValue == 0.0 -> listOf(
            "${me}、${second}と首位に並ぶ" to "${second}とゲーム差なしで${leagueName}の首位を争っている。",
            "首位争い ${me}と${second}が並ぶ" to "${me}と${second}がゲーム差なしで並ぶ大混戦だ。",
        )
        rankIndex > 0 && behindValue == 0.0 -> listOf(
            "${me}、首位${top}と並ぶ" to "首位の${top}（${topRecord}）とゲーム差なし。抜け出せるか。",
            "${me}首位タイ" to "${top}とゲーム差なしで並んでいる。",
        )
        rankIndex == 0 && gapToSecondValue != null && gapToSecondValue >= 5 -> listOf(
            "${me}独走 2位に${gapToSecond}差" to "2位の${second}に${gapToSecond}ゲーム差をつけ、${leagueName}の首位を独走している。",
            "${me}、首位を快走" to "2位の${second}とは${gapToSecond}差。このまま逃げ切れるか。",
        )
        rankIndex == 0 && gapToSecondValue != null && gapToSecondValue <= 1 -> listOf(
            "首位${me}、${second}が${gapToSecond}差で追う" to "首位に立つが、2位の${second}とは${gapToSecond}差。気の抜けない争いが続く。",
            "首位攻防 ${me}と${second}が競る" to "${me}が首位、${second}が${gapToSecond}差で続く混戦だ。",
        )
        rankIndex == 0 -> listOf(
            "${me}が首位を走る" to "2位の${second ?: "-"}とは${gapToSecond ?: "-"}差。",
            "${me}、首位をキープ" to "${leagueName}の首位を守っている。2位${second ?: "-"}とは${gapToSecond ?: "-"}差。",
        )
        behindValue != null && behindValue <= 1.5 -> listOf(
            "首位まで${behind}差 ${me}射程圏" to "首位の${top}（${topRecord}）とは${behind}差。逆転も見えてきた。",
            "${me}、首位${top}を追う" to "${top}とのゲーム差は${behind}。直接対決が鍵になる。",
        )
        rankIndex == size - 1 && size > 1 -> listOf(
            "${me}最下位 巻き返しへ" to "${top}が${topRecord}で首位。${me}は${placeText}と苦しいが、まだ挽回の機会はある。",
            "${me}、浮上のきっかけを" to "今は${placeText}。連勝で流れを変えたい。",
        )
        else -> listOf(
            "首位は${top}" to "${top}が${topRecord}で${leagueName}を引っ張る。${me}は${placeText}。",
            "${top}が首位を快走" to "${me}は${placeText}。上位との差を詰められるか。",
            "${me}、上位をうかがう" to "首位は${top}（${topRecord}）。${me}は${placeText}。",
        )
    }
    return pen.pick(pool, 5)
}

/** 「タイトル戦線」の見出し */
internal fun leaderTitle(name: String, label: String, rank: Int, pen: Pen): String = pen.pick(
    if (rank == 1) listOf("${name}、${label}トップ", "${name}が${label}で首位", "${label}争い ${name}が先頭", "${name}、${label}の頂点に")
    else listOf("${name}、${label}${rank}位", "${name}が${label}${rank}位 上位うかがう", "${label}争い ${name}が${rank}位につける"),
    6,
)

/** 「ベンチ裏」の見出し */
internal fun benchTitle(hot: String?, tired: String?, me: String, pen: Pen): String = when {
    hot != null -> pen.pick(listOf("${hot}が絶好調", "${hot}、好調キープ", "乗ってる${hot}", "${hot}の調子が上向き"), 7)
    tired != null -> pen.pick(listOf("${tired}に疲れ", "${tired}お疲れ気味 休養も", "${tired}、疲労の色"), 7)
    else -> pen.pick(listOf("${me}の話題", "${me}こぼれ話"), 7)
}

/** 「次戦予告」の見出し */
internal fun nextGameTitle(opp: String, home: Boolean, pen: Pen): String = pen.pick(
    if (home) listOf("次は${opp}戦（本拠地）", "本拠地で${opp}を迎え撃つ", "次戦は本拠地で${opp}と", "${opp}を迎えて")
    else listOf("次は${opp}戦（敵地）", "敵地で${opp}と対戦", "次戦は敵地で${opp}と", "${opp}の本拠地に乗り込む"),
    8,
)
