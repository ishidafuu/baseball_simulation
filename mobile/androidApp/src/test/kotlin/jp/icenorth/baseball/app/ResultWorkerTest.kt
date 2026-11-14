package jp.icenorth.baseball.app

import android.app.Application
import android.app.NotificationManager
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import jp.icenorth.baseball.shared.AuthSession
import jp.icenorth.baseball.shared.OnlineApi
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** 裏の試合結果の確認: 新しい試合だけ1回知らせる・印が無いときは知らせない・トークンの更新を端末に残す */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ResultWorkerTest {
    private lateinit var app: Application
    private lateinit var store: SessionStore
    private val requests = mutableListOf<String>()
    private var serverView = view(1, G41)
    private val client = HttpClient(MockEngine { request ->
        val action = request.url.parameters["action"].orEmpty()
        requests += action + (request.url.parameters["since"]?.let { "?since=$it" } ?: "")
        val body = when (action) {
            "refresh" -> """{"accessToken":"new-access","refreshToken":"new-refresh","expiresAt":${System.currentTimeMillis() + 3_600_000}}"""
            else -> if (request.url.parameters["since"] == generationOf(serverView)) """{"unchanged":true,"viewGeneration":${generationOf(serverView)}}""" else serverView
        }
        respond(body, HttpStatusCode.OK, headers = headersOf(HttpHeaders.ContentType, "application/json"))
    })

    @Before fun prepare() {
        app = RuntimeEnvironment.getApplication()
        app.getSharedPreferences("online", 0).edit().clear().commit()
        shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
        store = SessionStore(app)
        store.auth = AuthSession("u1", "old-access", "s1", "old-refresh", System.currentTimeMillis() + 3_600_000)
        ResultWorker.createApi = { OnlineApi(it, client) }
        ResultNotifier.appVisible = false
    }

    @After fun cleanup() {
        ResultWorker.createApi = { OnlineApi(it) }
        client.close()
    }

    private fun run(): ListenableWorker.Result = runBlocking { TestListenableWorkerBuilder<ResultWorker>(app).build().doWork() }

    private fun posted() = shadowOf(app.getSystemService(NotificationManager::class.java)).allNotifications

    @Test fun firstRunOnlyMarksThenNotifiesNewGameOnce() {
        assertEquals(ListenableWorker.Result.success(), run())
        assertTrue("最初は印だけ（今季の試合をまとめて知らせない）", posted().isEmpty())
        assertNotNull(store.seenResults)

        serverView = view(2, "$G41,$G42")
        run()
        assertEquals(1, posted().size)
        assertEquals("○ 5-3 美瑛（第42戦）", shadowOf(posted().single()).contentTitle)
        assertTrue("新しいビューを端末に残す（開いたらすぐ最新）", store.viewJson!!.contains("\"viewGeneration\":2"))

        app.getSystemService(NotificationManager::class.java).cancelAll()
        run()
        assertTrue("同じ試合で二度鳴らさない（世代も同じなので中身も読まない）", posted().isEmpty())
        assertEquals("view?since=2", requests.last())
    }

    @Test fun gamesNotOpenedInAppAreCombined() {
        run()
        serverView = view(2, "$G41,$G42")
        run()
        serverView = view(3, "$G41,$G42,$G43")
        run()
        // アプリを開いていないので、まだ見ていない2試合を1つの通知に
        assertEquals("2試合の結果（2勝0敗）", shadowOf(posted().single()).contentTitle)
    }

    @Test fun tradeOfferIsItsOwnNotification() {
        run()
        serverView = view(2, "$G41,$G42", ""","trades":[{"id":"t1","mine":false,"fromTeam":"美瑛","toTeam":"津田沼","myTurn":true,"offer":[{"name":"高橋"}],"want":[{"name":"田中"}]}]""")
        run()
        val titles = posted().map { shadowOf(it).contentTitle.toString() }.toSet()
        assertEquals(setOf("○ 5-3 美瑛（第42戦）", "美瑛からトレードの提案が届きました"), titles)
        app.getSystemService(NotificationManager::class.java).cancelAll()
        run()
        assertTrue("同じ提案で二度鳴らさない", posted().isEmpty())
    }

    @Test fun nothingWhileAppIsVisibleOrSwitchedOff() {
        run()
        serverView = view(2, "$G41,$G42")
        ResultNotifier.appVisible = true
        run()
        ResultNotifier.appVisible = false
        store.resultNotify = false
        run()
        assertTrue(posted().isEmpty())
    }

    @Test fun refreshesNearExpiryAndKeepsTheNewTokens() {
        store.auth = store.auth!!.copy(expiresAt = System.currentTimeMillis() + 10_000)
        run()
        assertEquals("refresh", requests.first())
        assertEquals("new-refresh", store.auth?.refreshToken)
        assertEquals("new-access", store.auth?.accessToken)
    }

    @Test fun loggedOutDoesNothing() {
        store.auth = null
        run()
        assertTrue(requests.isEmpty())
        assertNull(store.viewJson)
    }

    private companion object {
        const val G41 = """{"id":7,"date":{"year":2027,"month":6,"day":1},"number":41,"home":"津田沼","away":"美瑛","homeScore":2,"awayScore":4}"""
        const val G42 = """{"id":9,"date":{"year":2027,"month":6,"day":2},"number":42,"home":"美瑛","away":"津田沼","homeScore":3,"awayScore":5}"""
        const val G43 = """{"id":11,"date":{"year":2027,"month":6,"day":3},"number":43,"home":"津田沼","away":"美瑛","homeScore":1,"awayScore":0}"""

        fun view(generation: Int, games: String, extra: String = "") =
            """{"viewGeneration":$generation,"revision":$generation,"teamName":"津田沼","teamLabels":{"美瑛":{"short":"美瑛"}},"recentGames":[$games]$extra}"""

        fun generationOf(view: String) = Regex("\"viewGeneration\":(\\d+)").find(view)!!.groupValues[1]
    }
}
