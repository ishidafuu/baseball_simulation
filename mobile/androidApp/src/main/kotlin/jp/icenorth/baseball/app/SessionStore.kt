package jp.icenorth.baseball.app

import android.content.Context
import jp.icenorth.baseball.shared.AuthSession
import jp.icenorth.baseball.shared.OnlineJson

/**
 * ログイン情報と最後に読んだビューを端末に残す。
 * 起動直後は前回のビューをすぐ出し、裏で最新に入れ替える（待ち時間を見せないため）。
 *
 * ⚠ 試作ではアプリ専用の SharedPreferences（他のアプリからは読めない）に置いている。
 *    ストア公開までに暗号化した保存（Android Keystore）へ移す。
 */
class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("online", Context.MODE_PRIVATE)

    var endpoint: String?
        get() = prefs.getString("endpoint", null)
        set(value) = prefs.edit().putString("endpoint", value).apply()

    var auth: AuthSession?
        get() = prefs.getString("auth", null)?.let { runCatching { OnlineJson.decodeFromString<AuthSession>(it) }.getOrNull() }
        set(value) = prefs.edit().apply {
            if (value == null) remove("auth").remove("view") else putString("auth", OnlineJson.encodeToString(AuthSession.serializer(), value))
        }.apply()

    var tryoutWeights: Map<String, Int>?
        get() = prefs.getString("tryoutWeights", null)?.let { text ->
            runCatching { OnlineJson.decodeFromString<Map<String, Int>>(text) }.getOrNull()
        }
        set(value) = prefs.edit().putString("tryoutWeights", value?.let { OnlineJson.encodeToString(it) }).apply()

    /** ホームの見た目（新聞風・ネットニュース風・通常）。端末に覚える */
    var homeStyle: String?
        get() = prefs.getString("homeStyle", null)
        set(value) = prefs.edit().putString("homeStyle", value).apply()

    /** 状況に応じたTIPSを最後に読んだときに出ていたTIPSの id（読んだら点滅を止めるため） */
    var seenSituationTips: Set<String>
        get() = prefs.getStringSet("seenSituationTips", null)?.toSet().orEmpty()
        set(value) = prefs.edit().putStringSet("seenSituationTips", value).apply()

    /** 知らせ終えた届いたトレードの提案（[jp.icenorth.baseball.app.ui.tradeNoticeKeys]） */
    var seenTrades: Set<String>
        get() = prefs.getStringSet("seenTrades", null)?.toSet().orEmpty()
        set(value) = prefs.edit().putStringSet("seenTrades", value).apply()

    var viewJson: String?
        get() = prefs.getString("view", null)
        set(value) = prefs.edit().putString("view", value).apply()
}
