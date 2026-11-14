package jp.icenorth.baseball.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import jp.icenorth.baseball.app.ui.formatDeadline
import jp.icenorth.baseball.shared.EventNotice
import jp.icenorth.baseball.shared.LeagueView
import jp.icenorth.baseball.shared.eventNotices
import kotlinx.serialization.json.JsonObject
import java.time.Instant
import kotlinx.coroutines.sync.Mutex
import java.util.concurrent.TimeUnit

/**
 * 試合結果と手続き・トレードの通知（端末の中で出す）。
 *
 * サーバーから送る仕組み（Firebase）は使わない。WorkManager でおよそ15分ごとに裏でビューを読み（[ResultWorker]）、
 * 新しい試合があれば通知する。Android の決まりで15分より短くはできず、電池の節約中はもっと遅れることもある
 * （いしだ 2026-11-14「すぐじゃなくてOK」）。
 */
object ResultNotifier {
    private const val CHANNEL = "results"
    private const val WORK = "result-check"
    private const val EVENT_CHANNEL = "events"
    private const val RESULT_ID = 1001
    private const val EVENT_ID = 1002

    /** アプリが前に出ているか（MainActivity の onStart / onStop）。出ている間は裏で確かめない（画面で見えている） */
    @Volatile
    var appVisible = false

    /** 端末が通知を許しているか（Android 13 以降は許可が要る。それより前でも通知を切られていることがある） */
    fun permitted(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /** 許可をお願いする必要があるか（Android 13 以降で、まだ許されていない） */
    fun needsPermission(context: Context): Boolean =
        Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED

    /**
     * 裏の確認を、設定とログインに合わせて入れる・止める。何度呼んでもよい（同じ名前の仕事は1つだけ。KEEP なので間隔もずれない）。
     */
    fun sync(context: Context, store: SessionStore = SessionStore(context)) {
        // ⚠ 画面の検査（Robolectric）では入れない。入れると検査の最中に裏の確認が本当のサーバーへ読みに行く
        if (Build.FINGERPRINT == "robolectric") return
        val work = runCatching { WorkManager.getInstance(context) }.getOrNull() ?: return
        if (store.auth != null && store.resultNotify) {
            val request = PeriodicWorkRequestBuilder<ResultWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            work.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, request)
        } else {
            work.cancelUniqueWork(WORK)
            clear(context)
        }
    }

    /** 出ている通知を消す（アプリを開いた・ログアウトした・通知を切った） */
    fun clear(context: Context) {
        NotificationManagerCompat.from(context).cancel(RESULT_ID)
        NotificationManagerCompat.from(context).cancel(EVENT_ID)
    }

    /** 試合結果（1つだけを書き換える。開かずにいた間の試合は1つにまとめて出す） */
    fun showResult(context: Context, title: String, body: String) =
        show(context, RESULT_ID, CHANNEL, "試合結果", "自分の球団の試合が終わったら知らせます", title, body)

    /** 手続き・トレード・手続きの結果（試合結果とは別の通知。チャンネルも分け、端末の設定で片方だけ切れる） */
    fun showEvent(context: Context, title: String, body: String) =
        show(context, EVENT_ID, EVENT_CHANNEL, "手続き・トレード", "手続きの開始・締め切り間近・トレードの提案・手続きの結果を知らせます", title, body)

    /** いま知らせる候補（締め切りは日本時間で、画面と同じ書き方） */
    fun events(view: LeagueView, raw: JsonObject?): List<EventNotice> = eventNotices(
        view, raw, System.currentTimeMillis(),
        millisOf = { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() },
        format = { formatDeadline(it) },
    )

    private fun show(context: Context, id: Int, channel: String, channelName: String, channelText: String, title: String, body: String) {
        if (!permitted(context)) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(channel) == null) {
            manager.createNotificationChannel(
                NotificationChannel(channel, channelName, NotificationManager.IMPORTANCE_DEFAULT).apply { description = channelText },
            )
        }
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(title)
            .setContentText(body.lineSequence().firstOrNull().orEmpty())
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(id, notification) }
    }
}

/**
 * トークンの更新を、画面（[AppViewModel]）と裏の確認（[ResultWorker]）で1本にまとめる。
 * ⚠ 本番の Supabase は更新トークンを使うたびに新しくし、古い更新トークンをもう一度使うとログインごと無効にする。
 *    2か所が別々に更新すると、片方が古いトークンで更新してログアウトになる。どちらもこの鍵を取ってから、
 *    端末に残したログイン情報（SessionStore.auth）を読み直して更新する。
 */
object AuthLock {
    val mutex = Mutex()
}
