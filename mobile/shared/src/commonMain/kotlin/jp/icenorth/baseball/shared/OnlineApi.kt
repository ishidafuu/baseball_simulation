package jp.icenorth.baseball.shared

import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** サーバーが返した失敗。`code` は server/http.mjs の OnlineError の code（revision / session / edit_conflict など） */
class OnlineException(message: String, val code: String? = null, val status: Int = 0) : Exception(message)

val OnlineJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

/**
 * オンライン対人モードの API（server/http.mjs）。窓口は1本で `?action=` で切り替える。
 *
 * @param endpoint 例: `https://baseball-simulation-neon.vercel.app/api/online`、
 *                 ローカル開発: `http://10.0.2.2:3002/`（エミュレーターから見たPC）
 */
class OnlineApi(private val endpoint: String, private val client: HttpClient = defaultHttpClient()) {

    /** 本番（Supabase のメールとパスワード） */
    suspend fun login(email: String, password: String): AuthSession = decode(
        client.post(endpoint) {
            parameter("action", "login")
            // ⚠ 端末の種類を送る。ブラウザ1台とアプリ1台まで同時に操作できる（server/sessions.mjs）。
            //    送らないとブラウザ扱いになり、PCでログインし直すとアプリが外れる
            jsonBody(buildJsonObject { put("email", email); put("password", password); put("client", "app") })
        },
    )

    /** ローカルの開発サーバー（server/dev.mjs）用。player1 / player2 */
    suspend fun localLogin(user: String): AuthSession = decode(
        client.post(endpoint) {
            parameter("action", "login")
            jsonBody(buildJsonObject { put("user", user); put("client", "app") })
        },
    )

    suspend fun refresh(refreshToken: String): RefreshResult = decode(
        client.post(endpoint) {
            parameter("action", "refresh")
            jsonBody(buildJsonObject { put("refreshToken", refreshToken) })
        },
    )

    /**
     * 生の JSON も返す（端末に保存して、次の起動ですぐ出すため）。
     * `since` に手元のビューの世代（`viewGeneration`）を渡すと、変わっていなければサーバーは
     * ビューを送らず `{"unchanged":true,...}` だけ返す（世代を知らない古いサーバーは無視して全部返す）。
     */
    suspend fun viewRaw(auth: AuthSession, since: Long? = null): String = text(
        client.get(endpoint) {
            parameter("action", "view")
            if (since != null) parameter("since", since)
            authorize(auth)
        },
    )

    suspend fun view(auth: AuthSession): LeagueView = OnlineJson.decodeFromString(viewRaw(auth))

    /**
     * 読むだけの窓口（defaults / team / player / games / game）。形は Web 版と同じ生の JSON で返す。
     *   team   … `team`（球団名。空なら自球団）
     *   player … `id`
     *   games  … `year` `page` `scope`（own / league）
     *   game   … `id` `year`
     */
    suspend fun read(auth: AuthSession, action: String, params: Map<String, String?> = emptyMap()): JsonObject =
        OnlineJson.parseToJsonElement(
            text(
                client.get(endpoint) {
                    parameter("action", action)
                    params.forEach { (k, v) -> if (v != null) parameter(k, v) }
                    authorize(auth)
                },
            ),
        ).jsonObject

    /**
     * 指示を送る。
     *
     * ⚠ **[RETRY_ON_REVISION] の命令（編成・提出・キャンプのクール）は、版のずれだけなら最新の版で1回だけ送り直す**。
     *    版はリーグ全体で1つなので、定期の進行や他の参加者の操作だけで「他の操作で更新されました」に
     *    なる。編成と提出は `baseLineup` / `baseSubmission`、キャンプはクール番号で本当の食い違いを別に
     *    確かめているので、送り直しても上書き・二重の実行は起きない。
     * ⚠ 一覧は Web 版の `shared.js` から写す（`gen-tables.mjs`）。ここに手で並べていたので、
     *    アプリだけキャンプのクールが抜けていた。
     */
    @OptIn(ExperimentalUuidApi::class)
    suspend fun command(auth: AuthSession, revision: Int, type: String, payload: JsonElement? = null): JsonObject {
        suspend fun send(rev: Int): JsonObject {
            val body = buildJsonObject {
                put("requestId", Uuid.random().toString())
                put("revision", rev)
                put("type", type)
                if (payload != null) put("payload", payload)
            }
            return OnlineJson.parseToJsonElement(
                text(client.post(endpoint) { parameter("action", "command"); authorize(auth); jsonBody(body) }),
            ).jsonObject
        }
        return try {
            send(revision)
        } catch (e: OnlineException) {
            if (e.code != "revision" || type !in RETRY_ON_REVISION) throw e
            send(view(auth).revision)
        }
    }

    /**
     * 「来た」ことを知らせる（最終ログインとおるすばんの解除。server/leagueService.mjs presence）。
     * ⚠ 版は上がらない（ほかの人の画面を読み直させない）。サーバーが3時間に1回までしか書かない
     */
    suspend fun presence(auth: AuthSession) {
        text(client.post(endpoint) { parameter("action", "presence"); authorize(auth); jsonBody(JsonObject(emptyMap())) })
    }

    suspend fun logout(auth: AuthSession) {
        text(client.post(endpoint) { parameter("action", "logout"); authorize(auth); jsonBody(JsonObject(emptyMap())) })
    }

    private fun io.ktor.client.request.HttpRequestBuilder.authorize(auth: AuthSession) {
        header("Authorization", "Bearer ${auth.accessToken}")
        header("X-Online-Session", auth.sessionId)
    }

    private fun io.ktor.client.request.HttpRequestBuilder.jsonBody(body: JsonObject) {
        contentType(ContentType.Application.Json)
        setBody(body.toString())
    }

    private suspend inline fun <reified T> decode(response: HttpResponse): T =
        OnlineJson.decodeFromString(text(response))

    private suspend fun text(response: HttpResponse): String {
        val body = response.bodyAsText()
        if (response.status.isSuccess()) return body
        val error = runCatching { OnlineJson.parseToJsonElement(body).jsonObject }.getOrNull()
        // ⚠ JSON でない応答（Vercel の防御画面など）は、状態コードと先頭だけ出して切り分けられるようにする
        throw OnlineException(
            error?.get("error")?.jsonPrimitive?.contentOrNull
                ?: "サーバー処理に失敗しました（${response.status.value}: ${body.take(80).replace('\n', ' ')}）",
            error?.get("code")?.jsonPrimitive?.contentOrNull,
            response.status.value,
        )
    }
}

/** 試合の進行（45分ごと）や重い保存は数十秒かかることがある。Web 版は 290 秒まで待つ */
fun defaultHttpClient(): HttpClient = createPlatformHttpClient {
    install(HttpTimeout) {
        requestTimeoutMillis = 290_000
        connectTimeoutMillis = 15_000
        // ⚠ **読み取りの待ち時間も伸ばすこと**。指定しないと OkHttp の既定の 10 秒になり、
        //    本番のログイン（Supabase の認証＋保存）が 10 秒を超えると SocketTimeoutException で落ちた
        socketTimeoutMillis = 290_000
    }
}

expect fun createPlatformHttpClient(config: io.ktor.client.HttpClientConfig<*>.() -> Unit): HttpClient
