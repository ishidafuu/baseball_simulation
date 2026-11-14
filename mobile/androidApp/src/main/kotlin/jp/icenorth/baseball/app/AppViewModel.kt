package jp.icenorth.baseball.app

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import jp.icenorth.baseball.app.ui.TradeDraft
import jp.icenorth.baseball.shared.AuthSession
import jp.icenorth.baseball.shared.AppBuild
import jp.icenorth.baseball.shared.EditHistory
import jp.icenorth.baseball.shared.LatestApp
import jp.icenorth.baseball.shared.fetchLatestApp
import jp.icenorth.baseball.shared.resultKeys
import jp.icenorth.baseball.shared.findRosterPlayer
import jp.icenorth.baseball.shared.PlanDraft
import jp.icenorth.baseball.shared.Wish
import jp.icenorth.baseball.shared.sanitizeWeights
import jp.icenorth.baseball.shared.LeagueView
import jp.icenorth.baseball.shared.OnlineApi
import jp.icenorth.baseball.shared.OnlineException
import jp.icenorth.baseball.shared.OnlineJson
import jp.icenorth.baseball.shared.str
import jp.icenorth.baseball.shared.obj
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.long
import jp.icenorth.baseball.shared.at
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * @param fetchLatest main の最新のアプリを読む（[fetchLatestApp]）。検査では外へ読みに行かないよう既定は null を返す
 */
class AppViewModel internal constructor(
    app: Application,
    private val fetchLatest: suspend () -> LatestApp? = { null },
    private val createApi: (String) -> OnlineApi,
) : AndroidViewModel(app) {
    constructor(app: Application) : this(app, { fetchLatestApp() }, { OnlineApi(it) })

    private val store = SessionStore(app)

    var endpoint by mutableStateOf(store.endpoint ?: BuildConfig.DEFAULT_ENDPOINT)
        private set
    var auth by mutableStateOf(store.auth)
        private set
    var view by mutableStateOf(store.viewJson?.let(::parseView))
        private set

    /** ビューの生の形（型にしていない項目——名簿の細かい能力・手続き・トレードなど——を引くため） */
    var raw by mutableStateOf(store.viewJson?.let(::parseRaw))
        private set

    /** 編成の編集（タブを移っても消えないよう、画面ではなくここに置く） */
    var plan by mutableStateOf<EditHistory<PlanDraft>?>(null)

    /** 手続きの編集中の案（タブを移っても消えないよう、ここに置く） */
    var phaseDraft by mutableStateOf<PhaseDraft?>(null)
    var campDraft by mutableStateOf<CampDraft?>(null)

    /** キャンプの一括の直前の案（直後だけ「元に戻す」を出す。端末を回しても消えないよう、ここに置く） */
    var campBulk by mutableStateOf<CampBulk?>(null)
    var tradeDraft by mutableStateOf<TradeDraft?>(null)

    /** 指導者の任せ方の下書き（変えた分野だけ。「任せ方を保存」でまとめて送る） */
    var staffModesDraft by mutableStateOf<Map<String, String>>(emptyMap())

    /**
     * 届いた提案の知らせから一覧を開いたときに、脇へ置いた作りかけの案。
     * ⚠ 知らせを押しただけで作りかけの案を捨てないこと（選んだ選手が黙って消えていた）。
     *    一覧の「作りかけの提案を続ける」で戻す
     */
    var parkedTradeDraft by mutableStateOf<TradeDraft?>(null)

    /** 手続きタブでトレードの側を開いているか（届いた提案の知らせから直接開くため、ここに置く） */
    var procTrade by mutableStateOf(false)

    /**
     * 次に編成タブを開いたときに出す面（PlanTab の名前。「Staff」なら指導者）。編成タブが開いたら null に戻す。
     * 指導者に任せた手続きの「指導者の画面へ」から、任せ方を変えに行くため
     */
    var planFaceRequest by mutableStateOf<String?>(null)

    /** 知らせ終えた届いた提案の印。端末に覚える（開き直すたびに知らせない） */
    var seenTrades by mutableStateOf(store.seenTrades)
        private set

    fun markTradesSeen(keys: Set<String>) {
        if (keys == seenTrades) return
        seenTrades = keys
        store.seenTrades = keys
    }

    /** トライアウトの評価値の重み（端末に覚える。サーバーには送らない） */
    var tryoutWeights by mutableStateOf(sanitizeWeights(store.tryoutWeights))
        private set

    /** ホームの見た目（[jp.icenorth.baseball.app.ui.HomeStyle] の名前）。端末に覚える */
    var homeStyle by mutableStateOf(store.homeStyle)
        private set

    fun changeHomeStyle(name: String) {
        homeStyle = name
        store.homeStyle = name
    }

    /** スタメンの行に能力まで出すか（既定は成績だけ）。端末に覚える */
    var lineupDetail by mutableStateOf(store.lineupDetail)
        private set

    fun changeLineupDetail(on: Boolean) {
        lineupDetail = on
        store.lineupDetail = on
    }

    /** ホームで開く新聞（地元紙・全国紙）。端末に覚える */
    var homePaper by mutableStateOf(store.homePaper)
        private set

    fun changeHomePaper(name: String) {
        homePaper = name
        store.homePaper = name
    }

    /** 紙面のバックナンバー（古い順）。端末に覚える */
    var backIssues by mutableStateOf(
        store.backIssues?.let { runCatching { OnlineJson.decodeFromString<List<jp.icenorth.baseball.shared.BackIssue>>(it) }.getOrNull() }.orEmpty(),
    )
        private set

    fun recordBackIssue(item: jp.icenorth.baseball.shared.BackIssue) {
        if (backIssues.any { it == item }) return
        val next = jp.icenorth.baseball.shared.addBackIssue(backIssues, item)
        backIssues = next
        store.backIssues = OnlineJson.encodeToString(next)
    }

    /** 状況に応じたTIPSを最後に読んだときのTIPSの id。端末に覚える（[jp.icenorth.baseball.shared.hasUnreadTips]） */
    var seenSituationTips by mutableStateOf(store.seenSituationTips)
        private set

    fun markSituationTipsSeen(ids: Set<String>) {
        if (ids == seenSituationTips) return
        seenSituationTips = ids
        store.seenSituationTips = ids
    }

    fun changeWeights(next: Map<String, Int>) {
        tryoutWeights = sanitizeWeights(next)
        store.tryoutWeights = tryoutWeights
    }

    /** 読んだ球団の名簿の選手 id → 球団（選手の詳細から、その選手でトレードを考えるため） */
    val rosterTeams: MutableMap<Long, String> = java.util.concurrent.ConcurrentHashMap()

    /** 下のタブを移す合図（選手の詳細の「トレードを考える」など。OnlineApp が読んで下ろす） */
    var tabRequest by mutableStateOf<String?>(null)

    /** 他球団の選手をもらう形で、トレードを考え始める（選手の詳細から） */
    fun startTradeFor(team: String, id: Long) {
        openPlayer = null
        // ⚠ 作りかけの案（逆提案を含む）は捨てずに「下書きの続き」へ退避する（黙って消さない）
        tradeDraft?.let { parkedTradeDraft = it }
        tradeDraft = jp.icenorth.baseball.app.ui.TradeDraft(partner = team, get = setOf(id), step = jp.icenorth.baseball.app.ui.TradeStep.Players)
        procTrade = true
        tabRequest = "Procedures"
    }

    /** 選手の詳細を開いている選手（名簿の生の形）。どの画面からでも同じシートで開く */
    var openPlayer by mutableStateOf<JsonObject?>(null)

    /** 選手タブで見ている球団（null は自球団）。順位表の球団を押すと、ここに入れて選手タブへ移る */
    var playersTeam by mutableStateOf<String?>(null)

    fun showTeamPlayers(team: String) {
        playersTeam = team
    }

    /**
     * 他球団の名簿を読んでいる間の、開こうとしている選手の名前（画面の下に「読み込んでいます…」を出す）。
     * ⚠ 以前は印が無く、押しても何も起きないように見えた
     */
    var openingPlayer by mutableStateOf<String?>(null)
        private set

    /** 選手の詳細を開く操作の通し番号。新しく押した・やめた（[dropOpeningPlayer]）ら、前の読み込みの結果は使わない */
    private var openPlayerSerial = 0L

    /**
     * 球団と id（無ければ名前）から選手の詳細を開く。試合の成績表やタイトル争いの行には能力が載っていないので、
     * 自球団は手元の名簿から、他球団は球団の読み込み（版ごとに覚えている）から探す。
     * いまの名簿にいない選手（退団・移籍した）は、そのことを知らせる（id があれば名前では探し直さない。[findRosterPlayer]）
     */
    fun openPlayerOf(team: String, id: Long?, name: String?) {
        val epoch = sessionEpoch
        val serial = ++openPlayerSerial
        val own = team == view?.teamName
        openingPlayer = if (own) null else name ?: "選手"
        viewModelScope.launch {
            try {
                val source = if (own) raw else read("team", mapOf("team" to team))
                val found = findRosterPlayer(source.at("roster").list().mapNotNull { it.obj() }, id, name)
                if (epoch != sessionEpoch || serial != openPlayerSerial) return@launch
                if (found != null) openPlayer = found else message = "${name ?: "この選手"}は、いまこの球団の名簿にいません"
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // やめた操作の失敗は出さない（認証切れだけはログイン画面へ戻す）
                if (epoch == sessionEpoch && (serial == openPlayerSerial || e.isAuthFailure())) handle(e)
            } finally {
                if (serial == openPlayerSerial) openingPlayer = null
            }
        }
    }

    /**
     * 選手の詳細を開きに行っているのをやめる（読み終わっても開かない）。下のタブを移ったとき。
     * ⚠ 読み込みそのものは取り消さない（トークンの更新の途中で捨てると締め出される。[reload] と同じ理由）。
     *    以前は読み終わる前にタブを移ると、移った先でシートが開いた
     */
    fun dropOpeningPlayer() {
        if (openingPlayer == null) return
        openPlayerSerial += 1
        openingPlayer = null
    }

    /** 引っ張って更新している間 */
    var refreshing by mutableStateOf(false)
        private set

    /**
     * まだビューが1つも無いときに、読み込みに失敗した理由（ホームに「読み直す」と出す）。読めたら null。
     * ⚠ 以前はホームが「読み込み中…」のまま止まり、引っ張って更新もできなかった（中身がスクロールしないため）
     */
    var loadFailure by mutableStateOf<String?>(null)
        private set

    /** 保存などの操作中（画面全体を塞いで、二重に押せなくする） */
    var busy by mutableStateOf(false)
        private set

    /** 塞いでいる間に出す文言（「保存中…」「練習中…」など） */
    var busyLabel by mutableStateOf("")
        private set

    /**
     * 失敗とお知らせ（画面下に出す）。⚠ 出すたびに通し番号（[errorSerial]・[messageSerial]）を上げる。
     * 画面は番号を鍵に出すので、同じ文言が続いても（同じ保存を続けて2回など）2回目を落とさない。
     * 以前は文言そのものを鍵にしていて、出している間に同じ文言が来ると変化が無いので出なかった
     */
    private var errorText by mutableStateOf<String?>(null)
    var errorSerial by mutableStateOf(0L)
        private set
    var error: String?
        get() = errorText
        set(value) {
            errorText = value
            if (value != null) errorSerial += 1
        }

    private var messageText by mutableStateOf<String?>(null)
    var messageSerial by mutableStateOf(0L)
        private set
    var message: String?
        get() = messageText
        set(value) {
            messageText = value
            if (value != null) messageSerial += 1
        }

    private var api = createApi(endpoint)
    private var reloadJob: Job? = null

    /** 読み直しの通し番号。「引っ張って更新」の印を下ろしてよいのは、いちばん新しい読み直しだけ */
    private var reloadSerial = 0L
    private var operationJob: Job? = null
    private var sessionEpoch = 0L

    // 指示を送る前から進行中だった読込で、保存後のビューを巻き戻さない。
    private var viewRequestEpoch = 0L

    /** トークンの更新を1本にまとめる（同時に読み込むと同じ更新トークンで2回更新しにいくため） */
    // ⚠ 裏の試合結果の確認（ResultWorker）と同じ鍵。更新トークンを2か所で別々に使うとログインごと無効になる
    private val refreshLock = AuthLock.mutex

    // ⚠ init（起動時の読み込み）より前に置く。後ろに置くと、読み込みが走ったあとで初期値に戻される
    /**
     * 手元のビューの世代（サーバーが公開のたびに上げる）。null なら次は全部読む。
     * ⚠ 起動直後も、端末に残したビューの世代から始める（残したビューの中に入っている）。以前は起動のたびに
     *    null から始めて、何も変わっていなくてもビューをまるごと取り直していた
     */
    private var viewGeneration: Long? = raw?.get("viewGeneration")?.jsonPrimitive?.longOrNull

    /**
     * 読むだけの窓口の答えを覚えておく（同じ画面を開き直すたびに取りに行かない）。
     * 版（view.revision）が同じ間だけ使う。版はリーグに何か書かれるたびに上がるので、試合が進めば読み直す。
     * 試合の詳細（終わった試合のボックススコア）は変わらないので、版に関係なく使い回す。
     */
    private val readCache = object : LinkedHashMap<String, Pair<Int?, JsonObject>>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<Int?, JsonObject>>?) = size > 40
    }

    /** 入っているアプリの版（作ったときに build.gradle.kts が入れる） */
    val appBuild = AppBuild(BuildConfig.APP_COMMIT, BuildConfig.APP_COMMIT_TIME, BuildConfig.APP_BRANCH)

    /** main の最新のアプリ（ホームの紙面の「アプリ」の記事）。まだ読めていない・読めなかったら null */
    var latestApp by mutableStateOf<LatestApp?>(null)
        private set
    private val latestAppSchedule = CheckSchedule(interval = 30 * 60_000L, retry = 5 * 60_000L)
    private var latestAppJob: Job? = null

    /**
     * main の最新のアプリを読む。⚠ GitHub の認証なしの API は1時間に60回までなので、30分に1回まで
     * （起動時と、引っ張って更新したとき）。読めなかったら5分あけて読み直す。手元で作った版（コミットが分からない）は読まない
     */
    private fun checkLatestApp() {
        if (appBuild.commit.isEmpty() || latestAppJob?.isActive == true) return
        val now = System.currentTimeMillis()
        if (!latestAppSchedule.due(now)) return
        latestAppSchedule.started(now)
        latestAppJob = viewModelScope.launch {
            // 読めなかったときは前の答えを残す（電波の悪い所で記事が消えたり出たりしないように）
            fetchLatest()?.let { latestApp = it } ?: latestAppSchedule.failed(System.currentTimeMillis())
        }
    }

    init {
        checkLatestApp()
        if (auth != null) reload()
    }

    fun changeEndpoint(value: String) {
        val next = value.trim()
        if (next == endpoint) return
        logout()
        endpoint = next
        store.endpoint = endpoint
        api = createApi(endpoint)
    }

    // メールは全角を半角に、前後の空白を落とし小文字に（日本語キーボードの全角や先頭の自動大文字を吸収する）
    fun login(email: String, password: String) = signIn { it.login(java.text.Normalizer.normalize(email, java.text.Normalizer.Form.NFKC).trim().lowercase(), password) }

    /** ローカルの開発サーバー（server/dev.mjs）用 */
    fun localLogin(user: String) = signIn { it.localLogin(user) }

    private fun signIn(block: suspend (OnlineApi) -> AuthSession) {
        if (busy) return
        val epoch = sessionEpoch
        val readEpoch = viewRequestEpoch
        val client = api
        busy = true
        error = null
        operationJob = viewModelScope.launch {
            // ⚠ ログインと最初の読み込みの失敗を分けて出す。以前は読み込みの 401 でも
            //    ログイン画面に戻り「ログインできない」ように見えて、どこで弾かれたか分からなかった
            val next = try {
                block(client).also { requireSession(epoch) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (epoch != sessionEpoch) return@launch
                error = "ログインできませんでした: ${e.readable()}"
                busy = false
                return@launch
            }
            try {
                store.auth = next
                auth = next
                load(next, epoch, readEpoch)
                ResultNotifier.sync(getApplication<Application>(), store)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (epoch != sessionEpoch) return@launch
                store.auth = null
                auth = null
                error = "ログインは通りましたが、リーグの読み込みで失敗しました: ${e.readable()}"
            } finally {
                if (epoch == sessionEpoch) busy = false
            }
        }
    }

    fun logout() {
        val current = auth
        val client = api
        sessionEpoch += 1
        reloadJob?.cancel()
        reloadJob = null
        operationJob?.cancel()
        operationJob = null
        busy = false
        refreshing = false
        store.auth = null
        auth = null
        view = null
        loadFailure = null
        raw = null
        openPlayer = null
        openPlayerSerial += 1
        openingPlayer = null
        playersTeam = null
        plan = null
        phaseDraft = null
        campDraft = null
        campBulk = null
        tradeDraft = null
        staffModesDraft = emptyMap()
        parkedTradeDraft = null
        procTrade = false
        planFaceRequest = null
        message = null
        error = null
        clearCaches()
        ResultNotifier.sync(getApplication<Application>(), store)
        if (current != null) viewModelScope.launch { runCatching { client.logout(current) } }
    }

    /**
     * 最新のビューを読み直す。`quiet` は画面を開いている間の自動の読み直し（届いた提案に気づくため）で、
     * 保存の最中は読まず、通信の失敗も出さない（電波の悪い所で失敗の知らせが続かないように）。
     */
    fun reload(pull: Boolean = false, quiet: Boolean = false) {
        val current = auth ?: return
        val epoch = sessionEpoch
        val readEpoch = viewRequestEpoch
        if (busy) return
        // ⚠ 読み直しの通信中（画面を開いている間の静かな読み直しなど）でも、引っ張って更新したときは
        //    無反応にしない（以前は先に return していて、印も出ず読み直しもしなかった）。走っている読み直しが
        //    終わるのを待ってから、もう一度読む。取り消さないのは、トークンの更新の途中で捨てると
        //    入れ替わった更新トークンを受け取りそこね、次の更新で締め出されるため
        val previous = reloadJob?.takeIf { it.isActive }
        if (previous != null && !pull) return
        if (pull) {
            refreshing = true
            checkLatestApp()
        }
        val serial = ++reloadSerial
        reloadJob = viewModelScope.launch {
            try {
                previous?.join()
                authed(current, epoch) { load(it, epoch, readEpoch) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // ⚠ 静かな読み直しの失敗も、ビューが無い間はホームに出す（知らせは出さないが、読み込み中のまま止めない）
                if (epoch == sessionEpoch && view == null) loadFailure = e.readable()
                if (epoch == sessionEpoch && (!quiet || e.isAuthFailure())) handle(e)
            } finally {
                // 前の読み直しが終わっても、待っている新しい読み直しの印は下ろさない
                if (epoch == sessionEpoch && serial == reloadSerial) refreshing = false
            }
        }
    }

    /** 編成を保存する。成功したら最新のビューを読み直す */
    fun saveLineup(payload: JsonObject, onSaved: () -> Unit) =
        command("lineup", payload, label = "編成を保存中…", done = "編成を保存しました") { onSaved() }

    /**
     * 指示を送る（保存・提出・練習・トレードなど）。送っている間は画面全体を塞ぐ。
     * 成功したら最新のビューを読み直してから `onDone` を呼ぶ（結果は送った指示の応答）。
     * ⚠ 失敗しても編集中の内容は消さない（呼ぶ側の状態に触らない）。
     */
    fun command(
        type: String,
        payload: JsonElement?,
        label: String = "保存中…",
        done: String? = null,
        onDone: (JsonObject) -> Unit = {},
    ) {
        val current = auth ?: return
        val epoch = sessionEpoch
        val revision = view?.revision ?: return
        if (busy) return
        val readEpoch = ++viewRequestEpoch
        busy = true
        busyLabel = label
        error = null
        refreshing = false
        operationJob = viewModelScope.launch {
            try {
                val result = try {
                    authed(current, epoch) { api.command(it, revision, type, payload) }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (epoch != sessionEpoch) return@launch
                    handle(e)
                    // ⚠ サーバーに断られたら最新を読み直す（PC の run と同じ）。断られる多くは手続きが進んだ・
                    //    名簿が変わったなど手元のビューが古いときで、読み直さないと同じ古い画面のまま押し直すことになる。
                    //    通信の失敗（電波が無い・時間切れ）では読まない（読み直しも同じく待たされるだけ）。
                    //    読み直しの失敗は出さない（断られた理由の知らせを上書きしない）
                    if (e is OnlineException && !e.isAuthFailure()) {
                        try {
                            authed(current, epoch) { load(it, epoch, readEpoch) }
                        } catch (c: CancellationException) {
                            throw c
                        } catch (ignored: Exception) {
                            // 断られた理由の知らせを残す
                        }
                    }
                    return@launch
                }
                // ⚠ 返事に最新のビューが載っていればそのまま使う（読み直しの往復を省く）。
                //    載っていない（古いサーバー・二重送信の控えから返った）ときは読み直す
                val fresh = result["view"] as? JsonObject
                if (fresh != null) {
                    applyView(fresh.toString())
                } else {
                    // ⚠ ここで失敗しても**指示はサーバーで済んでいる**。以前は指示の失敗と同じに扱い、
                    //    成功の知らせも onDone も出さなかった（保存できていないように見えて押し直す）。
                    //    読み直しの失敗だけを伝え、成功の知らせと onDone はそのまま出す
                    try {
                        authed(epoch = epoch) { load(it, epoch, readEpoch) }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        if (epoch != sessionEpoch) return@launch
                        if (e.isAuthFailure()) {
                            handle(e)
                            return@launch
                        }
                        error = "送信は済みましたが、最新の状態を読み込めませんでした。引っ張って更新してください（${e.readable()}）"
                    }
                }
                if (done != null) message = done
                onDone(result)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // 返事を受けたあとの処理（呼ぶ側の onDone など）の失敗。落とさずに出す
                if (epoch == sessionEpoch) handle(e)
            } finally {
                if (epoch == sessionEpoch) busy = false
            }
        }
    }

    /** 読むだけの窓口（team / player / games / game / defaults）。失敗は例外のまま返す */
    suspend fun read(action: String, params: Map<String, String?> = emptyMap()): JsonObject {
        val epoch = sessionEpoch
        val key = action + "?" + params.filterValues { it != null }.toSortedMap().entries.joinToString("&")
        val revision = view?.revision
        val cached = synchronized(readCache) { readCache[key] }
        if (cached != null && (action == "game" || (revision != null && cached.first == revision))) return cached.second
        // ⚠ 試合の詳細の一球ごとの経過（replay）はアプリでは使わず大きいので、覚える前に落とす（40試合ぶん持つと重い）
        val value = authed(epoch = epoch) { api.read(it, action, params) }.let { if (action == "game") JsonObject(it - "replay") else it }
        synchronized(readCache) { readCache[key] = revision to value }
        // 他球団の選手がどの球団か（選手の詳細の「トレードを考える」で相手を決めるため）
        if (action == "team") params["team"]?.let { team -> value.at("roster").list().forEach { p -> p.at("id").long()?.let { rosterTeams[it] = team } } }
        return value
    }

    /**
     * 認証付きで呼ぶ。期限の判定がずれていて認証切れ（auth）で断られたら、一度だけ更新してやり直す
     * （すぐログアウトにしない）。断られた指示はサーバーで行われていないので、やり直しても二重にならない。
     */
    private suspend fun <T> authed(start: AuthSession? = auth, epoch: Long = sessionEpoch, block: suspend (AuthSession) -> T): T {
        requireSession(epoch)
        val current = start ?: throw OnlineException("ログインしていません")
        return try {
            val credentials = fresh(current, epoch)
            requireSession(epoch)
            block(credentials).also { requireSession(epoch) }
        } catch (e: OnlineException) {
            requireSession(epoch)
            if (e.code != "auth" || current.refreshToken == null) throw e
            val credentials = fresh(current, epoch, force = true)
            requireSession(epoch)
            block(credentials).also { requireSession(epoch) }
        }
    }

    /**
     * ビューを読み直す。手元のビューの世代を添え、サーバーで何も変わっていなければ（試合が進んでいない・
     * 誰も保存していない）ビューは送られてこないので、今のまま使う（アプリに戻るたびの読み直しが軽くなる）。
     */
    private suspend fun load(credentials: AuthSession, epoch: Long, readEpoch: Long) {
        requireSession(epoch)
        if (readEpoch != viewRequestEpoch) return
        val since = viewGeneration.takeIf { view != null }
        val text = api.viewRaw(credentials, since)
        requireSession(epoch)
        if (readEpoch != viewRequestEpoch) return
        if (since != null) {
            val head = runCatching { OnlineJson.parseToJsonElement(text).jsonObject }.getOrNull()
            if (head?.get("unchanged")?.jsonPrimitive?.booleanOrNull == true) {
                // 書き込めるかどうか（保守中など）だけは世代と関係なく変わるので合わせる
                head["writable"]?.jsonPrimitive?.booleanOrNull?.let { w -> if (view?.writable != w) view = view?.copy(writable = w) }
                return
            }
        }
        applyView(text)
    }

    private fun applyView(text: String) {
        view = parseView(text)
        loadFailure = null
        raw = parseRaw(text)
        // 指示の返事に載ったビューにも、公開した世代が入っている（サーバーが押す）。
        // 古いサーバーの返事には無いので、そのときは null にして次は全部読む
        viewGeneration = raw?.get("viewGeneration")?.jsonPrimitive?.longOrNull
        store.viewJson = text
        markResultsSeen()
    }

    /** 試合結果を通知するか（ホームのメニュー）。端末の許可が無いときは画面が許可をお願いする */
    var resultNotify by mutableStateOf(store.resultNotify)
        private set

    fun changeResultNotify(on: Boolean) {
        resultNotify = on
        store.resultNotify = on
        ResultNotifier.sync(getApplication<Application>(), store)
    }

    /** 通知の許可を一度お願いしたか（ログインのあとに一度だけ自分から聞く） */
    var notifyAsked: Boolean
        get() = store.notifyAsked
        set(value) { store.notifyAsked = value }

    /**
     * 画面で見た試合に印を付ける（裏の確認で同じ試合を知らせない）。出ている通知も消す。
     * ⚠ 画面に出したビューの試合だけ。ビューが変わっていなくても（世代が同じ）、前に付けた印のままでよい
     */
    fun markResultsSeen() {
        val v = view ?: return
        if (v.teamName == null) return
        val keys = resultKeys(v)
        store.seenResults = keys
        // ⚠ 知らせ済みは足すだけ（手元のビューが裏で読んだものより古いことがある。置き換えると同じ試合をもう一度鳴らす）。
        //    裏の確認はいまの直近の試合に置き換えるので、通知を切っている間だけ増えすぎないよう切る
        val notified = store.notifiedResults.orEmpty() + keys
        store.notifiedResults = if (notified.size > 30) keys else notified
        ResultNotifier.clear(getApplication<Application>())
    }

    private fun clearCaches() {
        synchronized(readCache) { readCache.clear() }
        // 選手→球団もトレードで変わる。読み直した名簿から作り直す
        rosterTeams.clear()
        viewGeneration = null
    }

    /** アクセストークンの期限が近ければ先に更新する（本番の Supabase は1時間で切れる） */
    private suspend fun fresh(current: AuthSession, epoch: Long, force: Boolean = false): AuthSession = refreshLock.withLock {
        requireSession(epoch)
        // ほかの呼び出しが待っている間に更新を済ませていたら、それを使う
        val latest = auth
        if (latest != null && latest.accessToken != current.accessToken) return@withLock latest
        // 裏の確認（ResultWorker）が更新を済ませて端末に残していたら、それを使う（古い更新トークンで更新しない）
        val stored = store.auth
        if (stored != null && stored.userId == current.userId && stored.sessionId == current.sessionId && stored.accessToken != current.accessToken) {
            auth = stored
            return@withLock stored
        }
        refreshOnce(current, epoch, force)
    }

    private suspend fun refreshOnce(current: AuthSession, epoch: Long, force: Boolean): AuthSession {
        val expiresAt = current.expiresAt ?: return current
        val refreshToken = current.refreshToken ?: return current
        if (!force && expiresAt - System.currentTimeMillis() > 60_000) return current
        val result = api.refresh(refreshToken)
        requireSession(epoch)
        val next = current.copy(
            accessToken = result.accessToken,
            refreshToken = result.refreshToken ?: refreshToken,
            expiresAt = result.expiresAt,
        )
        store.auth = next
        auth = next
        return next
    }

    private fun requireSession(epoch: Long) {
        if (epoch != sessionEpoch) throw CancellationException("セッションが変わりました")
    }

    /** 画面で読み込みに失敗したとき（認証切れならログイン画面へ戻す） */
    fun report(e: Exception) = handle(e)

    fun describe(e: Exception): String = e.readable()

    private fun handle(e: Exception) {
        // 別の端末でログインし直した／認証が切れた → ログイン画面へ戻す
        if (e.isAuthFailure()) logout()
        error = e.readable()
    }

    private fun Exception.isAuthFailure() = this is OnlineException && (code == "session" || code == "auth" || status == 401)

    private fun Exception.readable(): String = when (this) {
        is OnlineException -> message ?: "サーバー処理に失敗しました"
        // ⚠ 原因の切り分けのため、分かる原因は添える（スクショで送ってもらう）。
        //    以前は例外のクラス名と英語の文（SocketTimeoutException: timeout など）をそのまま出していた
        else -> "通信できませんでした。電波の良いところで、もう一度試してください" + (networkCause(this)?.let { "（$it）" } ?: "")
    }
}

/** 通信の失敗の原因（画面に添える短い言葉）。包まれた例外の中も見る。分からなければ null */
internal fun networkCause(e: Throwable): String? = generateSequence(e) { it.cause }.take(5).firstNotNullOfOrNull { c ->
    when {
        c is java.net.UnknownHostException -> "接続先が見つかりません"
        c is java.net.ConnectException -> "接続できません"
        c is javax.net.ssl.SSLException -> "安全な接続ができません"
        // OkHttp（SocketTimeoutException）と Ktor（HttpRequestTimeoutException など）の時間切れ
        c is java.net.SocketTimeoutException || c::class.simpleName.orEmpty().contains("Timeout") -> "時間切れ"
        else -> null
    }
}

private fun parseView(raw: String): LeagueView? = runCatching { OnlineJson.decodeFromString<LeagueView>(raw) }.getOrNull()
private fun parseRaw(raw: String): JsonObject? = runCatching { OnlineJson.parseToJsonElement(raw).jsonObject }.getOrNull()

/**
 * 間をあけて読みに行くものの予定（main の最新のアプリなど）。
 * ⚠ 読めなかったときも間をあける（[retry]）。以前は失敗で「まだ読んでいない」に戻していたので、
 *    電波の悪い所や GitHub の回数の上限に当たったあとは、引っ張って更新するたびに読みに行っていた
 *    （上限に当たると1時間ずっと失敗し、その間も読み続ける）
 */
internal class CheckSchedule(private val interval: Long, private val retry: Long) {
    private var nextAt = 0L

    fun due(now: Long): Boolean = now >= nextAt

    fun started(now: Long) {
        nextAt = now + interval
    }

    fun failed(now: Long) {
        nextAt = now + retry
    }
}

/**
 * 手続き（初期メンバー・トライアウト・契約更改・年度更新）の編集中の案。
 * `base` は編集を始めたときの提出（サーバーが別の操作との食い違いを見る baseSubmission）。
 */
data class PhaseDraft(val phaseId: String, val plan: JsonObject, val base: JsonElement?, val dirty: Boolean)

/**
 * ビューの提出（`phase.submission`）から、保存済みの案を作る。手続きが変わった・提出が無ければ null。
 * ⚠ 保存・決定のあとは案を null にせず、読み直したビューからこれで作り直す。null の間は手続きの面が
 *    「標準案を準備しています…」に替わり、中の一覧（トライアウトの候補の絞り込み・件数、契約更改の並び、
 *    初期メンバーの構成の絞り込み）の状態が捨てられ、スクロールも先頭に戻っていた
 */
internal fun savedPhaseDraft(raw: JsonObject?, phaseId: String): PhaseDraft? {
    val phase = raw?.get("phase").obj()?.takeIf { it.at("id").str() == phaseId } ?: return null
    val submission = phase["submission"].obj() ?: return null
    val plan = submission["plan"].obj() ?: return null
    return PhaseDraft(phaseId, plan, submission, dirty = false)
}

/** キャンプの一括で当てる前後の案 */
data class CampBulk(val text: String, val before: CampDraft, val after: CampDraft)

/** キャンプの方針と、選手ごとのメイン・サブ練習（未実行のクールの指示） */
data class CampDraft(
    val phaseId: String,
    val direction: String,
    val phase: String,
    val main: Map<Long, String>,
    val sub: Map<Long, String>,
    /** 決め方（recommended / wish / team）。⚠ 既定はおすすめ */
    val mode: String = "recommended",
    /** 選手ごとの方針の上書き（「合わせる」） */
    val players: Map<Long, Wish> = emptyMap(),
    /** サブ練習の対象（新球種・磨く球種・守る位置）。無ければ「おまかせ」 */
    val subTarget: Map<Long, String> = emptyMap(),
)
