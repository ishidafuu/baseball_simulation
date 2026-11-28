package jp.icenorth.baseball.shared

import kotlinx.serialization.Serializable

/*
 * 指導者（監督・投手コーチ・野手コーチ）。形はサーバー（server/coachView.mjs）の
 * `ownStaffView`（ビューの staff）・`leagueStaffView`（leagueStaff）・`teamStaffView`（team の窓口の staff）。
 *
 * ⚠ 文はサーバーが作る（PC/アプリ同文）。アプリで言い換えないこと。
 * ⚠ 監督は人の采配の肩代わり。能力を上げる効果は無い（監督バフはナシ）。ビジョン（攻めの型 × 守りの型 ×
 *    時間軸）と育成観・性格で、采配の「AI判断」・トライアウト・退団・キャンプの案・トレードの返事が変わるだけ。
 */

/** 考え方・性格の1行（-2〜2。代打・守備固めは -2〜0 の片側） */
@Serializable
data class StaffScale(
    val key: String = "",
    val label: String = "",
    val low: String = "",
    val high: String = "",
    val value: Int = 0,
    val oneSided: Boolean = false,
    val text: String = "",
)

@Serializable
data class CoachHistory(
    val year: Int = 0,
    val team: String? = null,
    val teamLabel: String? = null,
    val role: String? = null,
    val roleLabel: String? = null,
    val text: String = "",
)

/** 指導した球団と役職のひと続き（「2年目〜 美瑛 投手コーチ（現職）」） */
@Serializable
data class CoachStint(
    val team: String? = null,
    val role: String? = null,
    val from: Int? = null,
    val to: Int? = null,
    val current: Boolean = false,
    val teamLabel: String? = null,
    val roleLabel: String = "",
    val text: String = "",
)

/** 主な指導選手の1人（「田中（2年・打率.301 12本）」） */
@Serializable
data class CoachPupil(val name: String = "", val years: Int = 0, val text: String = "")

@Serializable
data class CoachCard(
    val id: String = "",
    val name: String = "",
    val age: Int = 0,
    val role: String? = null,
    val roleLabel: String = "",
    val team: String? = null,
    val since: Int? = null,
    val specialty: String? = null,
    val origin: String = "",
    val fromPlayer: Boolean = false,
    val legend: Boolean = false,
    /** 紙面の言葉（「機動力と継投の野球」） */
    val color: String = "",
    /** ビジョンの見出し（「足でかき回し、継投で逃げ切る」） */
    val headline: String = "",
    /** 「攻め 機動力（看板）・守り 継投でつなぐ・育成」 */
    val vision: String = "",
    /** 育成観（「一定まで尖らせて整える（長所70まで）」） */
    val growth: String = "",
    val personality: String = "",
    /** 称号（通算の記録から。最大2つ。「優勝請負人」） */
    val titles: List<String> = emptyList(),
    /** 監督の席の人だけ（「任せ度50%」） */
    val delegation: String? = null,
    val career: String = "",
    /** 売り込みの文（本人の言葉） */
    val pitch: String = "",
    /** 軸の選手（監督の席の人だけ。自分の球団とCPU球団。「田中・佐藤・鈴木」） */
    val keyPlayers: String? = null,
    val views: List<StaffScale> = emptyList(),
    val traits: List<StaffScale> = emptyList(),
    val prefs: String = "",
    val playerLine: String? = null,
    val mentor: String? = null,
    val history: List<CoachHistory> = emptyList(),
    /**
     * 詳細能力（`COACH_ABILITY_ITEMS` の鍵 → 1〜99）。表示と人物像だけで、どこにも効かない
     * （サーバーの coachAbilities。先方要望 2026-11-20）。古いサーバーには無い
     */
    val abilities: Map<String, Int>? = null,
    /**
     * これまでの指導チームと役職（古い順。full のカードだけ）。
     * ⚠ 既定は null（空にしない）。古いサーバーは項目を載せず、空の一覧（まだ指導していない）と
     *    見分けられないと「まだ指導した球団はありません」と事実と違う文になる（判断6、2026-11-20 監査）
     */
    val stints: List<CoachStint>? = null,
    /** 主な指導選手（在任中に出番の多かった5人まで。full のカードだけ）。無い（古いサーバー）は null */
    val pupils: List<CoachPupil>? = null,
) {
    /** 呼び名（姓だけ。「山田監督」） */
    val shortName: String get() = name.substringBefore(' ').ifBlank { name }

    /** 性格の値（気質 temper: -2 我慢強い 〜 2 短気、こだわり stubborn、任せ方 trust） */
    fun trait(key: String): Int = traits.firstOrNull { it.key == key }?.value ?: 0
}

@Serializable
data class StaffSeat(val role: String = "", val roleLabel: String = "", val coach: CoachCard? = null)

@Serializable
data class StaffModeOption(val value: String = "", val label: String = "")

/** 分野ごとの任せ方。`effective` が実際に効くもの（受け持ちの席が空いていれば self） */
@Serializable
data class StaffArea(
    val key: String = "",
    val label: String = "",
    val mode: String = "advice",
    val effective: String = "advice",
    val effectiveLabel: String = "",
    val owner: String? = null,
    val ownerLabel: String = "",
    val locked: Boolean = false,
    val note: String? = null,
)

/**
 * 任せ方の下書き（変えた分野だけ）から、送る分を取り出す。席が空いた分野（locked）と、
 * いまの値と同じものは送らない。⚠ PC の `staffModeChanges`（src/online/StaffPage.jsx）と同じ決め方
 */
fun staffModeChanges(modes: List<StaffArea>, draft: Map<String, String>): Map<String, String> =
    modes.mapNotNull { area -> draft[area.key]?.takeIf { !area.locked && it != area.effective }?.let { area.key to it } }.toMap()

/** 采配の1行（「送りバント: AI判断 → 積極的（山田監督）」）。by が無ければ指導者は決めていない */
@Serializable
data class TacticLine(
    val field: String = "",
    val key: String = "",
    val label: String = "",
    val settingLabel: String = "",
    val valueLabel: String = "",
    val resolvedLabel: String? = null,
    val isStandard: Boolean = false,
    val by: String? = null,
    val text: String = "",
)

@Serializable
data class StaffFront(val ambition: String = "", val patience: String = "")

@Serializable
data class StaffEvent(
    val year: Int = 0,
    /** retire / fire / resign / turn / hire / promote / release */
    val kind: String = "",
    val team: String? = null,
    val role: String? = null,
    val coachId: String? = null,
    val name: String = "",
    val mentor: String? = null,
    val homecoming: Boolean = false,
    val reason: String? = null,
    /** 契約更改で人が決めた退任（kind は resign。サーバーの `applyStaffMoves`）。古いサーバーには無い */
    val stepDown: Boolean = false,
    val text: String = "",
)

@Serializable
data class StaffRift(val role: String = "", val text: String = "")

/** 自分の球団の指導者（ビューの staff） */
@Serializable
data class StaffView(
    val seats: List<StaffSeat> = emptyList(),
    val modeOptions: List<StaffModeOption> = emptyList(),
    val modes: List<StaffArea> = emptyList(),
    val tactics: List<TacticLine> = emptyList(),
    val front: StaffFront? = null,
    /** チームの方針（先方要望 #9。src/online/teamPolicy.js）。古いサーバーには無い */
    val policy: TeamPolicy? = null,
    val canEditSeats: Boolean = false,
    val market: List<CoachCard> = emptyList(),
    val events: List<StaffEvent> = emptyList(),
    val rifts: List<StaffRift> = emptyList(),
    /** 年度更新で動く人事（契約更改の異動・コーチ打診。サーバーの `scheduledStaffLines`）。古いサーバーには無い */
    val scheduled: List<String> = emptyList(),
) {
    fun seat(role: String): CoachCard? = seats.firstOrNull { it.role == role }?.coach
    val manager: CoachCard? get() = seat("manager")
    fun mode(area: String): StaffArea? = modes.firstOrNull { it.key == area }
    fun tactic(field: String, key: String): TacticLine? = tactics.firstOrNull { it.field == field && it.key == key }
}

@Serializable
data class StaffBrief(
    /** 指導者の id（押すと人物の小窓。その球団の読み込みから同じ id の人を探す）。古いサーバーには無い */
    val id: String? = null,
    val name: String = "",
    val shortName: String = "",
    val color: String = "",
    val delegation: String? = null,
    /** 監督としての通算勝利（今季ぶんを含む） */
    val totalWins: Int = 0,
    /** 今季からの監督 */
    val isNew: Boolean = false,
)

@Serializable
data class TeamStaff(
    val team: String = "",
    val teamLabel: String? = null,
    val manager: StaffBrief? = null,
    val pitching: StaffBrief? = null,
    val batting: StaffBrief? = null,
)

/** リーグ全球団の顔ぶれと最近の人事（ビューの leagueStaff） */
@Serializable
data class LeagueStaff(val teams: List<TeamStaff> = emptyList(), val events: List<StaffEvent> = emptyList()) {
    fun of(team: String?): TeamStaff? = teams.firstOrNull { it.team == team }
}

/** チームの方針の1行（攻撃・投手起用・重心・編成・育成・いまの重点） */
@Serializable
data class TeamPolicyRow(val key: String = "", val label: String = "", val value: String = "", val note: String = "")

/**
 * チームの方針（チーム分析。先方要望 #9）。文はサーバーが作る（src/online/teamPolicy.js の teamPolicy）ので、ここは出すだけ。
 * `note` は人の球団（自球団・他の人の球団）にだけ付く注
 */
@Serializable
data class TeamPolicy(
    val by: String? = null,
    val headline: String = "",
    val tags: List<String> = emptyList(),
    val rows: List<TeamPolicyRow> = emptyList(),
    val note: String? = null,
)

/** 他球団の指導者（team の窓口の staff）。⚠ 人の球団の采配（tactics）は届かない */
@Serializable
data class TeamStaffView(
    val seats: List<StaffSeat> = emptyList(),
    val front: StaffFront? = null,
    /** チームの方針（先方要望 #9）。古いサーバーには無い */
    val policy: TeamPolicy? = null,
    val tactics: List<TacticLine>? = null,
    val events: List<StaffEvent> = emptyList(),
)

/**
 * 手続きと、それを受け持つ任せ方の分野（src/online/coaches.js の PHASE_STAFF_AREA と同じ）。
 * ⚠ 「任せる」にした手続きは、その人の決定を待たず指導者の案で決まる（server/leagueEngine.mjs の waitsFor・resolvePhase）
 */
val PHASE_STAFF_AREA: Map<String, String> = mapOf("tryout" to "tryout", "contract" to "release", "camp" to "camp")

/**
 * 自分のほかに、いまの手続きで待たれている人がいないか（ほかは全員 決定済み・指導者に任せた・CPUが決める）。
 * サーバーの waitsFor と同じ見方（ビューの members の ready は、決定済みと任せた球団を含む）
 */
fun nobodyElseWaited(view: LeagueView): Boolean =
    view.members.all { it.teamName == view.teamName || it.ready || it.cpu }

/**
 * 任せ方の保存（[changes] は送る分 `{ 分野: 任せ方 }`）で、いまの手続きがその場で決まるか。
 * 決まるなら手続きの名前（「トライアウト」など）、決まらないなら null。Web の `delegationSettles`（src/online/notices.js）と同じ。
 * ⚠ サーバーは**待たれている最後の1人が手続きの分野を「任せる」にした瞬間に**、指導者の案で手続きを進める
 *    （server/leagueEngine.mjs の updateStaffModes）。取り消せないので、画面は保存の前に確認を1段挟む。
 *    1人リーグなら手続き中に任せるといつもこれになる。
 * ⚠ 自分がまだ決めておらず（ready でも cpu でもない）、自分のほかに待たれている人がいない（[nobodyElseWaited]）とき
 */
fun delegationSettles(view: LeagueView, changes: Map<String, String>): String? {
    val phase = view.phase ?: return null
    val area = PHASE_STAFF_AREA[phase.kind] ?: return null
    if (changes[area] != "delegate" || phase.delegated) return null
    val me = view.members.firstOrNull { it.teamName == view.teamName } ?: return null
    if (me.ready || me.cpu || !nobodyElseWaited(view)) return null
    return PHASE_LABELS[phase.kind] ?: "手続き"
}

/**
 * 任せ方を保存したあとの知らせ。手続きがその場で決まったら言い分ける（[delegationSettles]）。
 * [before] / [after] は送る前と後のビュー。Web の `staffModesDoneText` と同じ文
 */
fun staffModesDoneText(changes: Map<String, String>, before: LeagueView?, after: LeagueView?): String {
    val phase = before?.phase
    val area = PHASE_STAFF_AREA[phase?.kind]
    if (phase != null && area != null && changes[area] == "delegate" && after != null && after.phase?.id != phase.id)
        return "任せ方を変えました。${PHASE_LABELS[phase.kind]}は指導者の案で決まりました"
    return "任せ方を変えました"
}

/** 手続きの標準案を出した指導者（ビューの phase.planBy） */
@Serializable
data class PlanBy(val mode: String = "advice", val by: String = "", val text: String = "")

const val ROLE_MANAGER = "manager"
val STAFF_ROLE_LABELS = mapOf("manager" to "監督", "pitching" to "投手コーチ", "batting" to "野手コーチ")
