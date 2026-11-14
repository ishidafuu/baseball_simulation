package jp.icenorth.baseball.shared

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * 指示（command）の中身。形はサーバー（server/leagueService.mjs）と Web 版の画面に合わせる。
 * 画面から直接組み立てず、ここを通す（ローカルの開発サーバーでの検査も同じ関数を使う）。
 */
object Commands {
    private fun ids(list: Collection<Long>) = JsonArray(list.map { JsonPrimitive(it) })

    /** 手続きの提出。`base` は編集を始めたときの提出（無ければ null）。サーバーが別の操作との食い違いを見る */
    fun submit(phaseId: String, plan: JsonObject, ready: Boolean, base: JsonElement?): JsonObject = buildJsonObject {
        put("phaseId", phaseId)
        put("plan", plan)
        put("ready", ready)
        put("baseSubmission", base ?: JsonNull)
    }

    /** キャンプの1クール。⚠ round は「次のクール」（実行済み＋1）。同じクールは2回走らない */
    fun campRound(
        round: Int,
        mode: String,
        direction: String,
        phase: String,
        players: Map<Long, Wish>,
        main: Map<Long, String>,
        sub: Map<Long, String>,
        /** サブ練習の対象（新球種・磨く球種・守る位置）。⚠ campTargetsToSend で、いまのサブ練習に合うものだけにして渡す */
        subTarget: Map<Long, String> = emptyMap(),
    ): JsonObject = buildJsonObject {
        put("round", round)
        putJsonObject("policy") { put("mode", mode); put("direction", direction); put("phase", phase) }
        // 選手ごとの方針の上書き（「合わせる」）
        putJsonObject("players") {
            players.forEach { (id, w) -> putJsonObject(id.toString()) { put("direction", w.direction); put("phase", w.phase) } }
        }
        putJsonObject("main") { main.forEach { (id, key) -> put(id.toString(), key) } }
        putJsonObject("sub") { sub.forEach { (id, key) -> put(id.toString(), key) } }
        putJsonObject("subTarget") { subTarget.forEach { (id, key) -> put(id.toString(), key) } }
    }

    /**
     * 送る練習の対象。**いまのサブ練習で選べるものだけ**（Web 版 CampPlanner.jsx の execute と同じ）。
     * ⚠ 練習を変えたあとに前の対象が残っていると、サーバーが「対象を選べない練習に対象が付いています」と断る。
     */
    fun campTargetsToSend(roster: List<JsonObject>, subOf: (JsonObject) -> String, target: Map<Long, String>): Map<Long, String> =
        roster.mapNotNull { p ->
            val value = target[p.pid]?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            if (campSubTargetChoices(subOf(p), p).any { it.key == value }) p.pid to value else null
        }.toMap()

    fun pack(packId: String): JsonObject = buildJsonObject { put("packId", packId) }

    /**
     * 球団名・呼び名・ひとこと。⚠ ひとこと（comment）は null なら送らない（いまのひとことのまま）。
     * 空の文字列を送ると消える
     */
    fun profile(teamName: String, playerName: String, comment: String? = null): JsonObject = buildJsonObject {
        put("teamName", teamName.trim())
        put("playerName", playerName.trim())
        if (comment != null) put("comment", comment.trim())
    }

    /** 新しい提案。offer＝自分が出す、want＝相手からもらう。note は人の球団へのひとこと（空なら送らない） */
    fun tradeOffer(to: String, give: Collection<Long>, get: Collection<Long>, note: String? = null): JsonObject = buildJsonObject {
        put("to", to)
        put("offer", ids(give))
        put("want", ids(get))
        note?.trim()?.takeIf { it.isNotEmpty() }?.let { put("note", it) }
    }

    /**
     * 提案への返事（accept / reject / counter）。
     * ⚠ 逆提案の offer はいつも**提案した側**が出す選手。自分が提案した側か（mine）で向きを直す。
     */
    fun tradeRespond(
        tradeId: String,
        action: String,
        mine: Boolean = false,
        give: Collection<Long>? = null,
        get: Collection<Long>? = null,
        note: String? = null,
    ): JsonObject = buildJsonObject {
        put("tradeId", tradeId)
        put("action", action)
        if (action == "counter" && give != null && get != null) {
            put("offer", ids(if (mine) give else get))
            put("want", ids(if (mine) get else give))
            note?.trim()?.takeIf { it.isNotEmpty() }?.let { put("note", it) }
        }
    }

    /** 予告先発の指名（playerId が null なら指名を外して、ローテの順に戻す） */
    fun starterPick(gameId: Long, playerId: Long?): JsonObject = buildJsonObject {
        put("gameId", gameId)
        put("playerId", playerId?.let(::JsonPrimitive) ?: JsonNull)
    }

    /** 練習試合を申し込む（相手は人の球団だけ） */
    fun challenge(toTeam: String, note: String = ""): JsonObject = buildJsonObject {
        put("toTeam", toTeam)
        put("note", note.trim())
    }

    /** 練習試合の申し込みへの返事（accept / decline / withdraw） */
    fun challengeRespond(id: String, action: String): JsonObject = buildJsonObject {
        put("id", id)
        put("action", action)
    }

    /**
     * 任せ方を変える（area: lineup / pitching / tactics / tryout / release / camp、mode: self / advice / delegate）。
     * ⚠ 変えた分野をまとめて1回で送る（`staffModeChanges`。1つ押すたびに保存しない）
     */
    fun staffModes(modes: Map<String, String>): JsonObject = buildJsonObject {
        putJsonObject("modes") { modes.forEach { (area, mode) -> put(area, mode) } }
    }

    /** 指導者の人事（キャンプの間だけ）。action: release / hire / swap */
    fun staff(action: String, role: String, other: String? = null, coachId: String? = null): JsonObject = buildJsonObject {
        put("action", action)
        put("role", role)
        if (other != null) put("other", other)
        if (coachId != null) put("coachId", coachId)
    }

    fun withReleases(plan: JsonObject, ids: Collection<Long>) = JsonObject(plan + ("releaseIds" to ids(ids)))
    fun withRanked(plan: JsonObject, ids: List<Long>) = JsonObject(plan + ("rankedIds" to ids(ids)))
    /** トライアウトの希望を出す形にそろえる（交渉する選手・取りにいく人数・獲得する人数）。Web 版 TryoutPlanner と同じ */
    fun withTryout(plan: JsonObject, ids: List<Long>, total: Int) = JsonObject(
        withRanked(plan, ids) + ("count" to JsonPrimitive(wishedCount(ids, total))) + ("total" to JsonPrimitive(total)),
    )
    fun withPack(plan: JsonObject, packId: String) = JsonObject(plan + ("packId" to JsonPrimitive(packId)))
}

/**
 * サブ練習の「対象」の選択肢。対象を取らない練習は空。Web 版 CampPlanner.jsx の subTargetChoices と同じ決まり。
 * ⚠ 新球種は**まだ持っていない球種**、変化球練習は**持っている球種**（取り違えると1クール捨てる）。
 * ⚠ 極めた球種（100）は外す（選んでも伸びず、黙って分配に戻る）。
 * ⚠ サブポジはいまの守備位置を除き、適性を添える（どこなら現実的か分からない）。
 */
fun campSubTargetChoices(subKey: String?, player: JsonObject): List<Choice> {
    val arsenal = player.at("pitching", "arsenal").list().mapNotNull { it.obj() }
    val owned = arsenal.mapNotNull { it.at("type").str() }.filter { it != "straight" }
    val name = { type: String -> PITCH_TYPE_NAMES[type] ?: type }
    return when (CAMP_SUB_TARGETS[subKey]) {
        "pitch" -> CAMP_PITCH_TYPES.filter { it !in owned }.map { Choice(it, name(it)) }
        "ownPitch" -> arsenal.filter { (it.at("type").str() ?: "") in owned && (it.at("level").num() ?: 0.0) < 100 }
            .map { pitch ->
                val type = pitch.at("type").str().orEmpty()
                Choice(type, name(type) + (pitch.at("level").num()?.let(::plainNumber) ?: ""))
            }
        "position" -> CONVERT_POSITIONS.filter { it != "pitcher" && it != player.at("position").str() }
            .map { pos -> Choice(pos, (POSITION_NAMES[pos] ?: pos) + (player.at("positionFitness", pos).num()?.let { " ${plainNumber(it)}%" } ?: "")) }
        else -> emptyList()
    }
}

/** 整数なら小数点を付けずに出す（JS の `${n}` と同じ見え方） */
private fun plainNumber(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
