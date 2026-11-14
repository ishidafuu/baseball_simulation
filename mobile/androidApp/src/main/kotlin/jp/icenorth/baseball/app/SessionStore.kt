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
            // ⚠ 試合結果の通知の印もログインごと（別の人・別の球団で入り直したら、最初は印を付けるだけ）
            if (value == null) remove("auth").remove("view").remove("seenResults").remove("notifiedResults") else putString("auth", OnlineJson.encodeToString(AuthSession.serializer(), value))
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

    /** スタメンの行に能力まで出すか（既定は成績だけ。いしだ 2026-11-13）。端末に覚える */
    var lineupDetail: Boolean
        get() = prefs.getBoolean("lineupDetail", false)
        set(value) = prefs.edit().putBoolean("lineupDetail", value).apply()

    /** 状況に応じたTIPSを最後に読んだときに出ていたTIPSの id（読んだら点滅を止めるため） */
    var seenSituationTips: Set<String>
        get() = prefs.getStringSet("seenSituationTips", null)?.toSet().orEmpty()
        set(value) = prefs.edit().putStringSet("seenSituationTips", value).apply()

    /** 知らせ終えた届いたトレードの提案（[jp.icenorth.baseball.app.ui.tradeNoticeKeys]） */
    var seenTrades: Set<String>
        get() = prefs.getStringSet("seenTrades", null)?.toSet().orEmpty()
        set(value) = prefs.edit().putStringSet("seenTrades", value).apply()

    /** ホームで開く新聞（地元紙・全国紙。[jp.icenorth.baseball.shared.FrontPage.Paper] の名前） */
    var homePaper: String?
        get() = prefs.getString("homePaper", null)
        set(value) = prefs.edit().putString("homePaper", value).apply()

    /** 紙面のバックナンバー（JSON。[jp.icenorth.baseball.shared.BackIssue] の並び） */
    var backIssues: String?
        get() = prefs.getString("backIssues", null)
        set(value) = prefs.edit().putString("backIssues", value).apply()

    var viewJson: String?
        get() = prefs.getString("view", null)
        set(value) = prefs.edit().putString("view", value).apply()

    /** 試合結果を通知するか（ホームのメニュー）。既定はする。端末の通知の許可が無ければ出ない */
    var resultNotify: Boolean
        get() = prefs.getBoolean("resultNotify", true)
        set(value) = prefs.edit().putBoolean("resultNotify", value).apply()

    /** 通知の許可を一度お願いしたか（Android 13 以降。断られたら二度と自分からは聞かない） */
    var notifyAsked: Boolean
        get() = prefs.getBoolean("notifyAsked", false)
        set(value) = prefs.edit().putBoolean("notifyAsked", value).apply()

    /**
     * アプリで見た自球団の直近の試合（[jp.icenorth.baseball.shared.resultKeys]）。null はまだ印が無い。
     * 通知はここに無い試合をまとめて出す（開かずにいた間の試合を1つの通知に）
     */
    var seenResults: Set<String>?
        get() = prefs.getStringSet("seenResults", null)?.toSet()
        set(value) = prefs.edit().putStringSet("seenResults", value).apply()

    /** 通知を出し終えた試合（同じ試合で二度鳴らさない） */
    var notifiedResults: Set<String>?
        get() = prefs.getStringSet("notifiedResults", null)?.toSet()
        set(value) = prefs.edit().putStringSet("notifiedResults", value).apply()
}
