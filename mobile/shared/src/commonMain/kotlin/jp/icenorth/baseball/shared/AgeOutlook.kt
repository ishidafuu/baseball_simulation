package jp.icenorth.baseball.shared

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

// ============================================================
// 年齢構成と3年後の見込み（自球団だけ）。数字と文はサーバーが作る（src/online/ageOutlook.js）。
// ⚠ 並びと見出しは Web 版（src/online/AgeOutlook.jsx）と同じにすること
// ============================================================

@Serializable
data class AgeBand(val label: String = "", val pitchers: Int = 0, val fielders: Int = 0)

@Serializable
data class AgeOutlookRow(
    val id: Long? = null,
    val name: String = "",
    val position: String? = null,
    val age: Int = 0,
    val later: Int = 0,
    val peakAge: Int = 0,
    val upside: Int = 0,
    val kind: String = "",
    val veteran: Boolean = false,
)

@Serializable
data class AgeOutlook(
    val years: Int = 3,
    val bands: List<AgeBand> = emptyList(),
    val core: List<AgeOutlookRow> = emptyList(),
    val rising: List<AgeOutlookRow> = emptyList(),
    val lines: List<String> = emptyList(),
    val advice: String = "",
)

/**
 * ビューの `ageOutlook` を読む。無い（名簿が空・途中参加で初期メンバー待ち）・読めないときは null
 * （画面は「まだ見込みを出せません」）
 */
fun ageOutlookOf(raw: JsonObject?): AgeOutlook? =
    raw?.at("ageOutlook").obj()?.let { runCatching { OnlineJson.decodeFromJsonElement(AgeOutlook.serializer(), it) }.getOrNull() }

/** 見込みの言葉（Web 版 AgeOutlook.jsx の KIND_LABEL と同じ） */
fun ageOutlookLabel(r: AgeOutlookRow): String =
    when (r.kind) { "rising" -> "まだ伸びる"; "peak" -> "ピークの近く"; else -> "下り坂の見込み" } + if (r.veteran) "・引退が近い年齢" else ""

const val AGE_OUTLOOK_NOTE = "見込みは成長力とプロ意識から決まるピーク年齢で見ています（乱数なし）。練習や出場で前後します。"
