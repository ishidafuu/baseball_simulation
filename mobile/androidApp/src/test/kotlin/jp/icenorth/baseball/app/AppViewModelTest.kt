package jp.icenorth.baseball.app

import android.app.Application
import android.os.Looper
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import jp.icenorth.baseball.shared.AuthSession
import jp.icenorth.baseball.shared.OnlineApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@LooperMode(LooperMode.Mode.PAUSED)
class AppViewModelTest {
    private lateinit var app: Application
    private lateinit var model: AppViewModel
    private val clients = mutableListOf<HttpClient>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    @Before fun prepare() {
        app = RuntimeEnvironment.getApplication()
        app.getSharedPreferences("online", 0).edit().clear().commit()
    }

    @After fun cleanup() {
        if (::model.isInitialized) model.logout()
        idle()
        scope.cancel()
        clients.forEach { it.close() }
    }

    private fun create(status: (String) -> HttpStatusCode = { HttpStatusCode.OK }, handler: suspend (String) -> String) {
        model = AppViewModel(app) { endpoint ->
            val client = HttpClient(MockEngine { request ->
                val action = request.url.parameters["action"].orEmpty()
                respond(handler(action), status(action), headers = headersOf(HttpHeaders.ContentType, "application/json"))
            })
            clients.add(client)
            OnlineApi(endpoint, client)
        }
    }

    private fun login() {
        model.localLogin("player1")
        until { model.view?.revision == 1 && !model.busy }
    }

    @Test fun commandKeepsItsViewWhenAnOlderReloadFinishesLater() {
        val oldReadStarted = CompletableDeferred<Unit>()
        val releaseOldRead = CompletableDeferred<Unit>()
        var views = 0
        create { action ->
            when (action) {
                "login" -> AUTH
                "view" -> if (++views == 1) VIEW_1 else {
                    oldReadStarted.complete(Unit)
                    releaseOldRead.await()
                    VIEW_1
                }
                "command" -> """{"view":$VIEW_2}"""
                else -> "{}"
            }
        }
        login()
        model.reload(quiet = true)
        until { oldReadStarted.isCompleted }
        var completed = false
        model.command("rename", JsonObject(emptyMap())) { completed = true }
        until { completed && !model.busy }
        releaseOldRead.complete(Unit)
        idle()
        assertEquals(2, model.view?.revision)
        assertTrue(SessionStore(app).viewJson.orEmpty().contains("\"revision\":2"))
    }

    @Test fun pullToRefreshWhileAQuietReloadIsRunningReadsAgain() {
        val quietStarted = CompletableDeferred<Unit>()
        val releaseQuiet = CompletableDeferred<Unit>()
        var views = 0
        create { action ->
            when (action) {
                "login" -> AUTH
                "view" -> when (++views) {
                    1 -> VIEW_1
                    2 -> {
                        quietStarted.complete(Unit)
                        releaseQuiet.await()
                        VIEW_1
                    }
                    else -> VIEW_2
                }
                else -> "{}"
            }
        }
        login()
        model.reload(quiet = true)
        until { quietStarted.isCompleted }
        // 静かな読み直しの通信中に引っ張って更新しても、無反応にならない
        model.reload(pull = true)
        assertTrue("引っ張って更新の印が出ない", model.refreshing)
        releaseQuiet.complete(Unit)
        until { !model.refreshing }
        assertEquals("静かな読み直しのあとに読み直していない", 3, views)
        assertEquals(2, model.view?.revision)
    }

    @Test fun commandThatSucceededIsReportedEvenIfTheReloadAfterItFails() {
        var views = 0
        create { action ->
            when (action) {
                "login" -> AUTH
                "view" -> if (++views == 1) VIEW_1 else throw java.io.IOException("電波が無い")
                // 返事にビューが載っていない（読み直しが要る）
                "command" -> """{"ok":true}"""
                else -> "{}"
            }
        }
        login()
        var done: JsonObject? = null
        model.command("rename", JsonObject(emptyMap()), done = "名前を変えました") { done = it }
        until { !model.busy }
        // 指示はサーバーで済んでいるので、成功の知らせと onDone は出す。読み直しの失敗は別に伝える
        assertNotNull("指示の成功が呼ぶ側に伝わらない", done)
        assertEquals("名前を変えました", model.message)
        assertTrue("読み直しの失敗が伝わらない: ${model.error}", model.error.orEmpty().contains("最新の状態を読み込めませんでした"))
        assertNotNull(model.auth)
        assertEquals(2, views)
    }

    @Test fun refusedCommandReadsTheLatestViewLikeThePc() {
        var views = 0
        create(status = { if (it == "command") HttpStatusCode.Conflict else HttpStatusCode.OK }) { action ->
            when (action) {
                "login" -> AUTH
                "view" -> if (++views == 1) VIEW_1 else VIEW_2
                // 送り直さない命令（トレード）が断られた
                "command" -> """{"error":"相手の名簿が変わりました","code":"trade_stale"}"""
                else -> "{}"
            }
        }
        login()
        var done = false
        model.command("trade", JsonObject(emptyMap())) { done = true }
        until { !model.busy }
        assertFalse("断られたのに onDone を呼んだ", done)
        assertEquals("相手の名簿が変わりました", model.error)
        // ⚠ 断られたら最新を読み直す（以前は古いビューのまま残り、同じ画面で押し直すことになった）
        assertEquals(2, views)
        assertEquals(2, model.view?.revision)
        assertNotNull(model.auth)
    }

    @Test fun latestAppIsNotReadAgainOnEveryPullAfterAFailure() {
        val schedule = CheckSchedule(interval = 30 * 60_000L, retry = 5 * 60_000L)
        assertTrue(schedule.due(0))
        schedule.started(0)
        // 読めなかった（電波・GitHub の回数の上限）。以前はすぐ「まだ読んでいない」に戻り、引っ張るたびに読みに行った
        schedule.failed(1_000)
        assertFalse(schedule.due(2_000))
        assertFalse(schedule.due(1_000 + 5 * 60_000L - 1))
        assertTrue(schedule.due(1_000 + 5 * 60_000L))
        // 読めたら30分あける
        schedule.started(10 * 60_000L)
        assertFalse(schedule.due(39 * 60_000L))
        assertTrue(schedule.due(40 * 60_000L))
    }

    @Test fun networkFailureDoesNotShowTheExceptionClassName() {
        var views = 0
        create { action ->
            when (action) {
                "login" -> AUTH
                "view" -> if (++views == 1) VIEW_1 else throw java.net.SocketTimeoutException("timeout")
                else -> "{}"
            }
        }
        login()
        model.reload(pull = true)
        until { !model.refreshing }
        val text = model.error.orEmpty()
        assertTrue(text, text.startsWith("通信できませんでした"))
        assertTrue(text, text.contains("時間切れ"))
        // ⚠ 内部の言葉（例外のクラス名・英語の文）を出さない
        assertFalse(text, text.contains("Exception") || text.contains("timeout"))
        assertEquals(null, networkCause(IllegalStateException("x")))
    }

    @Test fun homeIsToldWhyTheFirstViewCouldNotBeRead() {
        // ログインしたまま開き直した（覚えているビューは無い）
        SessionStore(app).auth = AuthSession("a", "token", "session")
        var views = 0
        create { action ->
            when (action) {
                "view" -> if (++views == 1) throw java.net.ConnectException("Connection refused") else VIEW_1
                else -> "{}"
            }
        }
        // ⚠ 以前はホームが「読み込み中…」のまま止まった
        until { model.loadFailure != null }
        assertNull(model.view)
        assertTrue(model.loadFailure.orEmpty(), model.loadFailure.orEmpty().contains("接続できません"))
        model.reload(pull = true)
        until { model.view?.revision == 1 && !model.refreshing }
        assertNull(model.loadFailure)
    }

    @Test fun theSameNoticeTwiceIsAnnouncedTwice() {
        create { "{}" }
        // 画面は通し番号を鍵に出す。同じ文言が続いても番号は上がる（2回目を落とさない）
        model.message = "保存しました"
        val first = model.messageSerial
        model.message = "保存しました"
        assertEquals(first + 1, model.messageSerial)
        // 消しただけでは上がらない（出し直さない）
        model.message = null
        assertEquals(first + 1, model.messageSerial)
        model.error = "失敗"
        val failed = model.errorSerial
        model.error = "失敗"
        assertEquals(failed + 1, model.errorSerial)
        assertEquals("失敗", model.error)
    }

    @Test fun refreshThatStartedBeforeLogoutCannotRestoreTheSession() {
        val refreshStarted = CompletableDeferred<Unit>()
        val releaseRefresh = CompletableDeferred<Unit>()
        create { action ->
            when (action) {
                "login" -> AUTH_EXPIRED
                "view" -> VIEW_1
                "refresh" -> {
                    refreshStarted.complete(Unit)
                    releaseRefresh.await()
                    """{"accessToken":"renewed","refreshToken":"new-refresh","expiresAt":9999999999999}"""
                }
                else -> "{}"
            }
        }
        login()
        var failure: Throwable? = null
        val read = scope.launch { runCatching { model.read("team") }.onFailure { failure = it } }
        until { refreshStarted.isCompleted }
        model.logout()
        releaseRefresh.complete(Unit)
        until { read.isCompleted }
        assertTrue(failure is CancellationException)
        assertNull(model.auth)
        assertNull(model.view)
        assertNull(SessionStore(app).auth)
        assertNull(SessionStore(app).viewJson)
        assertNull(model.error)
    }

    @Test fun savingDuringTokenRefreshKeepsTheRotatedCredentials() {
        val refreshStarted = CompletableDeferred<Unit>()
        val releaseRefresh = CompletableDeferred<Unit>()
        var refreshes = 0
        create { action ->
            when (action) {
                "login" -> AUTH_EXPIRED
                "view" -> VIEW_1
                "refresh" -> {
                    refreshes += 1
                    refreshStarted.complete(Unit)
                    releaseRefresh.await()
                    """{"accessToken":"renewed","refreshToken":"new-refresh","expiresAt":9999999999999}"""
                }
                "command" -> """{"view":$VIEW_2}"""
                else -> "{}"
            }
        }
        login()
        model.reload(quiet = true)
        until { refreshStarted.isCompleted }
        var completed = false
        model.command("rename", JsonObject(emptyMap())) { completed = true }
        releaseRefresh.complete(Unit)
        until { completed && !model.busy }
        assertEquals(1, refreshes)
        assertEquals("renewed", model.auth?.accessToken)
        assertEquals("new-refresh", SessionStore(app).auth?.refreshToken)
        assertEquals(2, model.view?.revision)
    }

    @Test fun responseFromLoggedOutUserCannotFillTheNextUsersReadCache() {
        val readStarted = CompletableDeferred<Unit>()
        val releaseRead = CompletableDeferred<Unit>()
        var reads = 0
        create { action ->
            when (action) {
                "login" -> AUTH
                "view" -> VIEW_1
                "team" -> if (++reads == 1) {
                    readStarted.complete(Unit)
                    releaseRead.await()
                    """{"owner":"old"}"""
                } else """{"owner":"new"}"""
                else -> "{}"
            }
        }
        login()
        var failure: Throwable? = null
        val old = scope.launch { runCatching { model.read("team") }.onFailure { failure = it } }
        until { readStarted.isCompleted }
        model.logout()
        releaseRead.complete(Unit)
        until { old.isCompleted }
        login()
        var next: JsonObject? = null
        val fresh = scope.launch { next = model.read("team") }
        until { fresh.isCompleted }
        assertTrue(failure is CancellationException)
        assertEquals(2, reads)
        assertEquals("\"new\"", next?.get("owner").toString())
    }

    @Test fun playerOfAnotherTeamShowsLoadingAndIsDroppedWhenLeaving() {
        val readStarted = CompletableDeferred<Unit>()
        val releaseRead = CompletableDeferred<Unit>()
        create { action ->
            when (action) {
                "login" -> AUTH
                "view" -> VIEW_1
                "team" -> {
                    readStarted.complete(Unit)
                    releaseRead.await()
                    """{"roster":[{"id":7,"name":"同名"}]}"""
                }
                else -> "{}"
            }
        }
        login()
        model.openPlayerOf("other", 7, "同名")
        // ⚠ 以前は読み込みの間に何も出ず、押しても何も起きないように見えた
        assertEquals("同名", model.openingPlayer)
        until { readStarted.isCompleted }
        // ⚠ 読み終わる前にタブを移ったら、移った先でシートを開かない
        model.dropOpeningPlayer()
        assertNull(model.openingPlayer)
        releaseRead.complete(Unit)
        idle()
        assertNull(model.openPlayer)
        // 読んだ名簿は覚えているので、押し直せばすぐ開く
        model.openPlayerOf("other", 7, "同名")
        until { model.openPlayer != null }
        assertNull(model.openingPlayer)
        // ⚠ id があれば名前では探し直さない（同じ球団の同名の別人を開かない）
        model.openPlayer = null
        model.openPlayerOf("other", 99, "同名")
        until { model.openingPlayer == null }
        assertNull(model.openPlayer)
    }

    @Test fun changingEndpointClearsThePreviousServersCredentialsAndView() {
        create { action -> if (action == "login") AUTH else if (action == "view") VIEW_1 else "{}" }
        login()
        model.changeEndpoint("https://another.invalid/api/online")
        assertNull(model.auth)
        assertNull(model.view)
        assertNull(SessionStore(app).auth)
        assertNull(SessionStore(app).viewJson)
    }

    /**
     * 裏の試合結果の確認が端末のビューを新しくしていて、起動したらサーバーは「変わっていない」と返す。
     * それでも、前に画面に出したビューと比べて留守中のまとめを出す（以前は何も出なかった）
     */
    @Test fun awaySummaryAfterTheWorkerRefreshedTheStoredView() {
        val shown = """{"revision":1,"viewGeneration":1,"teamName":"team","writable":true,"standings":[{"team":"team","wins":10,"losses":5,"gamesPlayed":15}]}"""
        val stored = """{"revision":4,"viewGeneration":4,"teamName":"team","writable":true,"standings":[{"team":"team","wins":12,"losses":6,"gamesPlayed":18}]}"""
        app.getSharedPreferences("online", 0).edit()
            .putString("auth", AUTH)
            .putString("view", stored)
            .putString("shownDigest", jp.icenorth.baseball.shared.awayDigest(jp.icenorth.baseball.shared.OnlineJson.parseToJsonElement(shown).jsonObject).toString())
            .putLong("shownAt", System.currentTimeMillis() - 60 * 60_000L)
            .commit()
        var sinceSent: String? = null
        model = AppViewModel(app) { endpoint ->
            val client = HttpClient(MockEngine { request ->
                if (request.url.parameters["action"] == "view") sinceSent = request.url.parameters["since"]
                respond("""{"unchanged":true,"viewGeneration":4,"writable":true}""", HttpStatusCode.OK, headers = headersOf(HttpHeaders.ContentType, "application/json"))
            })
            clients.add(client)
            OnlineApi(endpoint, client)
        }
        until { model.away != null }
        assertEquals("4", sinceSent)
        assertEquals(listOf("3試合 2勝1敗"), model.away!!.lines.take(1))
    }

    private fun idle() {
        repeat(5) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(10)
        }
    }

    private fun until(condition: () -> Boolean) {
        val deadline = System.nanoTime() + 10_000_000_000L
        while (!condition()) {
            if (System.nanoTime() > deadline) fail("非同期処理が完了しませんでした")
            idle()
        }
        idle()
    }

    companion object {
        private const val AUTH = """{"userId":"a","accessToken":"token","sessionId":"session"}"""
        private const val AUTH_EXPIRED = """{"userId":"a","accessToken":"token","sessionId":"session","refreshToken":"refresh","expiresAt":0}"""
        private const val VIEW_1 = """{"revision":1,"teamName":"team","writable":true}"""
        private const val VIEW_2 = """{"revision":2,"teamName":"team","writable":true}"""
    }
}
