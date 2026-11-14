package jp.icenorth.baseball.shared

/**
 * 投手起用の編集（Web 版 src/online/pitchingEdit.js と同じ決まり）。
 *   starters … 先発ローテの順（投手の id）
 *   roles    … 起用できる全投手の役割。ローテの投手は先発の型、ほかは救援の役割
 * - 先発は1〜8人、クローザーは1人まで
 * - **野手も投手で起用できる**（二刀流）。投手登録の選手はいつも全員が入り、野手は
 *   加えた選手だけが入る（`roles` に居る野手）。⚠ 全員を入れると救援の「おまかせ」で野手が投げる
 */
data class PitchingState(val starters: List<Long>, val roles: Map<Long, String>) {
    fun isStarterRole(role: String?) = role != null && STARTER_ROLES.containsKey(role)

    /** 2人の登板順を入れ替える（間の投手は動かさない。Web の swapStarters と同じ） */
    fun swapStarters(a: Int, b: Int): PitchingState {
        if (a == b || a !in starters.indices || b !in starters.indices) return this
        val next = starters.toMutableList(); next[a] = starters[b]; next[b] = starters[a]
        return copy(starters = next)
    }

    fun setRole(id: Long, role: String, at: Int? = null): PitchingState {
        val current = roles[id]
        if (current == null) {
            if (!isStarterRole(role) && id in starters && starters.size > 1) return copy(starters = starters - id)
            return this
        }
        if (current == role && at == null) return this
        val toStarter = isStarterRole(role)
        val wasStarter = id in starters
        var nextStarters = starters
        if (toStarter && !wasStarter) {
            if (starters.size >= MAX_STARTERS) return this
            nextStarters = starters.toMutableList().apply { add(at ?: size, id) }
        } else if (!toStarter && wasStarter) {
            if (starters.size <= 1) return this
            nextStarters = starters - id
        }
        val nextRoles = roles.toMutableMap()
        nextRoles[id] = role
        if (role == "closer") {
            for ((other, r) in roles) {
                if (r == "closer" && other != id) nextRoles[other] = if (wasStarter || isStarterRole(current)) "auto_r" else current
            }
        }
        return PitchingState(nextStarters, nextRoles)
    }

    /** 投手起用に入っている（役割を持つ）か */
    fun onStaff(id: Long) = id in roles

    /** 野手を投手起用に加える（救援の「おまかせ」で入る）。投手登録・抹消中・もう入っている選手は変えない */
    fun addToStaff(player: Player): PitchingState =
        if (!player.canJoinStaff || onStaff(player.id)) this else copy(roles = roles + (player.id to "auto_r"))

    /** 加えた野手を投手起用から外す（ローテからも外れる）。投手登録と、最後の1人の先発は外せない */
    fun removeFromStaff(id: Long, roster: List<Player>): PitchingState {
        val player = roster.firstOrNull { it.id == id } ?: return this
        if (player.isPitcher) return this
        if (id in starters && starters.size <= 1) return this
        return PitchingState(starters - id, roles - id)
    }

    /** 投手起用に加えていない野手（加える候補。投球の能力の高い順。Web 版 staffCandidates と同じ） */
    fun staffCandidates(roster: List<Player>): List<Player> =
        roster.filter { it.canJoinStaff && !onStaff(it.id) }.sortedByDescending { it.staffScore }

    /** 2人の持ち場を入れ替える（先発どうし＝順、先発と救援＝持ち場ごと、救援どうし＝役割） */
    fun swap(a: Long, b: Long): PitchingState {
        if (a == b) return this
        val ia = starters.indexOf(a); val ib = starters.indexOf(b)
        if (ia >= 0 && ib >= 0) {
            val next = starters.toMutableList(); next[ia] = b; next[ib] = a
            return copy(starters = next)
        }
        val ra = roles[a]; val rb = roles[b]
        if (ra == null && rb == null) return this
        if (ra == null || rb == null) {
            val (missing, other) = if (ra == null) a to b else b to a
            if (missing !in starters) return this
            return PitchingState(starters.map { if (it == missing) other else it }, roles + (other to "auto_s"))
        }
        val nextStarters = if (ia >= 0 || ib >= 0) starters.map { if (it == a) b else if (it == b) a else it } else starters
        return PitchingState(nextStarters, roles + mapOf(a to rb, b to ra))
    }

    companion object {
        fun roleFor(role: String?, starter: Boolean): String =
            if (role != null && (if (starter) STARTER_ROLES else RELIEF_ROLES).containsKey(role)) role
            else if (starter) "auto_s" else "auto_r"

        /**
         * 保存済みの編成と名簿から作る。名簿に居ない先発も外さない（Web 版 pitchingFromLineup）。
         * 野手は、先発ローテに居るか役割を保存してある選手（加えた野手）だけ入る
         */
        fun from(starters: List<Long>, savedRoles: Map<Long, String>, pitchers: List<Player>): PitchingState {
            val unique = starters.distinct()
            val roles = pitchers
                .filter { (it.isPitcher && it.isActive) || (it.canJoinStaff && (it.id in unique || it.id in savedRoles)) }
                .associate { it.id to roleFor(savedRoles[it.id], it.id in unique) }
            return PitchingState(unique, roles)
        }
    }
}

/** 投手起用に加えられる野手（野手登録で、抹消されておらず、投球の能力がある） */
val Player.canJoinStaff: Boolean get() = !isPitcher && isActive && pitching != null

/** 加える候補の並びの目安（Web 版 staffCandidates と同じ式） */
private val Player.staffScore: Int
    get() = (pitching?.control ?: 0) + (pitching?.stamina ?: 0) + ((pitching?.velocity ?: 0) - 100)

fun roleLabel(role: String?): String = STARTER_ROLES[role] ?: RELIEF_ROLES[role] ?: (role ?: "")
