package jp.icenorth.baseball.app

import android.graphics.Bitmap
import android.util.Log
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.test.swipeDown
import androidx.lifecycle.ViewModelProvider
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import jp.icenorth.baseball.app.ui.TradeDraft
import jp.icenorth.baseball.app.ui.TradeStep
import jp.icenorth.baseball.shared.at
import jp.icenorth.baseball.shared.list
import jp.icenorth.baseball.shared.str
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 画面の見回り（CI の screens ジョブ）。開発サーバー（server/dev.mjs）に「プレイヤー1」で入り、
 * 全タブ・シート・手続きを開いてスクショを撮る。撮れなかった所は飛ばして続ける（落とさない）。
 *   引数 stage … 撮る場面の名前（ファイル名の頭に付く。pack / camp / running / contract / tryout）
 * スクショはアプリの files/shots/ に置き、ワークフローが run-as で取り出す。
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class ScreenTour {
    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private val stage = InstrumentationRegistry.getArguments().getString("stage") ?: "running"
    private val endpoint = InstrumentationRegistry.getArguments().getString("endpoint") ?: "http://10.0.2.2:3002/"
    private var count = 0
    private lateinit var model: AppViewModel

    private fun pause(ms: Long = 1200) {
        rule.waitForIdle()
        Thread.sleep(ms)
        rule.waitForIdle()
    }

    private fun shot(name: String) {
        pause(600)
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return
        val dir = File(rule.activity.filesDir, "shots").apply { mkdirs() }
        val file = File(dir, "%s-%02d-%s.png".format(stage, ++count, name))
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        Log.i("ScreenTour", "shot ${file.name}")
    }

    /** 失敗しても見回りを続ける（どこで撮れなかったかはログに残す） */
    private fun step(label: String, block: () -> Unit) {
        runCatching(block).onFailure { Log.w("ScreenTour", "skip $label: ${it.message}") }
    }

    private fun tab(name: String) {
        rule.onNodeWithTag("tab-$name").performClick()
        pause(2500)
    }

    private fun click(text: String, substring: Boolean = false) {
        rule.onAllNodesWithText(text, substring = substring).onFirst().performClick()
        pause()
    }

    private fun scroll(times: Int = 1) {
        repeat(times) {
            rule.onAllNodes(isRoot()).onFirst().performTouchInput { swipeUp(startY = bottom * 0.75f, endY = top + height * 0.2f) }
            pause(500)
        }
    }

    private fun back() {
        Espresso.pressBackUnconditionally()
        pause()
    }

    /** 上から順に撮り、数回スクロールして下も撮る */
    private fun page(name: String, scrolls: Int = 2) {
        shot(name)
        repeat(scrolls) { i ->
            step("$name scroll") { scroll(); shot("$name-${i + 2}") }
        }
    }

    @Test
    fun tour() {
        model = ViewModelProvider(rule.activity)[AppViewModel::class.java]
        rule.runOnUiThread { model.logout() }
        pause()
        if (stage == "pack") shot("login")
        rule.runOnUiThread {
            model.changeEndpoint(endpoint)
            model.localLogin("player1")
        }
        rule.waitUntil(90_000) { model.view != null && !model.busy }
        pause(3000)
        val view = model.view!!

        rule.runOnUiThread { model.changeHomeStyle("Paper") }
        pause()
        page("home", scrolls = 3)
        // ホームの見た目の切り替え（新聞風・ネットニュース風・通常。中身は同じ記事）
        listOf("Web" to "home-web", "Plain" to "home-plain").forEach { (style, name) ->
            step(name) {
                rule.runOnUiThread { model.changeHomeStyle(style) }
                pause(1500)
                rule.onAllNodes(isRoot()).onFirst().performTouchInput { swipeDown(startY = top + height * 0.2f, endY = bottom * 0.75f) }
                page(name, scrolls = 2)
            }
        }
        rule.runOnUiThread { model.changeHomeStyle("Paper") }
        pause()
        step("menu") { rule.onAllNodes(androidx.compose.ui.test.hasContentDescription("メニュー")).onFirst().performClick(); shot("home-menu"); back() }

        when (stage) {
            "running" -> {
                tab("Games")
                page("games", scrolls = 1)
                step("game detail") {
                    rule.onAllNodesWithTag("game-row").onFirst().performClick()
                    pause(2500)
                    page("game-detail", scrolls = 2)
                    back()
                }
                step("league games") { click("リーグ全体"); pause(2000); shot("games-league") }
                step("standings") { click("順位表"); page("games-standings", scrolls = 1) }
                step("leaders") { click("タイトル"); shot("games-leaders") }
                step("news") { click("リーグ便り"); shot("games-news") }

                tab("Players")
                page("players-batting", scrolls = 1)
                step("pitching stats") { click("投球"); page("players-pitching", scrolls = 1) }
                step("player sheet") {
                    val name = view.roster.first { !it.isPitcher }.name
                    click(name, substring = true)
                    pause(2500)
                    page("player-sheet", scrolls = 2)
                    back()
                }
                step("career") { click("通算成績"); pause(2500); page("players-career", scrolls = 1) }
                step("ranking") { click("能力ランキング"); pause(2500); page("players-ranking", scrolls = 1) }

                tab("Plan")
                page("plan-order", scrolls = 2)
                step("position sheet") {
                    repeat(3) { rule.onAllNodes(isRoot()).onFirst().performTouchInput { swipeDown(startY = top + height * 0.25f, endY = bottom * 0.85f) } }
                    pause()
                    val first = model.plan?.present?.slots?.firstOrNull()
                    val label = first?.position?.let { jp.icenorth.baseball.shared.positionLabel(it) }
                    if (label != null) click(label)
                    shot("plan-position-sheet")
                    back()
                }
                step("replace sheet") {
                    val first = model.plan?.present?.slots?.firstOrNull()?.playerId
                    val name = view.roster.firstOrNull { it.id == first }?.name
                    if (name != null) click(name, substring = true)
                    shot("plan-replace-sheet")
                    back()
                }
                step("order stats") { click("今季成績"); page("plan-order-stats", scrolls = 1) }
                step("order fitness") { click("守備適性"); page("plan-order-fitness", scrolls = 1) }
                step("bench sheet") {
                    click("能力")
                    scroll(3)
                    val starters = model.plan?.present?.slots?.map { it.playerId }.orEmpty().toSet()
                    val bench = view.roster.filter { !it.isPitcher && it.isActive && it.id !in starters }
                    val name = bench.firstOrNull { rule.onAllNodesWithText(it.name, substring = true).fetchSemanticsNodes().isNotEmpty() }?.name
                    if (name != null) click(name, substring = true)
                    shot("plan-bench-sheet")
                    back()
                }
                step("pitching") { click("投手起用"); page("plan-pitching", scrolls = 2) }
                step("role sheet") {
                    repeat(3) { rule.onAllNodes(isRoot()).onFirst().performTouchInput { swipeDown(startY = top + height * 0.25f, endY = bottom * 0.85f) } }
                    pause()
                    val starter = model.plan?.present?.pitching?.starters?.firstOrNull()
                    val name = view.roster.firstOrNull { it.id == starter }?.name
                    if (name != null) click(name, substring = true)
                    shot("plan-role-sheet")
                    back()
                }
                step("tactics") { click("方針・采配"); page("plan-tactics", scrolls = 2) }

                tab("Procedures")
                page("procedures", scrolls = 4)
                // トレード: 相手 → 選手 → 確認の段（送らずに閉じる）
                step("trade") {
                    rule.runOnUiThread { model.procTrade = true }
                    pause(1500)
                    shot("trade")
                    click("新しくトレードを考える", substring = true)
                    shot("trade-partner")
                    val partner = model.raw!!.at("teamNames").list().mapNotNull { it.str() }.first { it != view.teamName }
                    rule.runOnUiThread { model.tradeDraft = TradeDraft(partner = partner, step = TradeStep.Players) }
                    pause(3000)
                    click("総合", substring = true)
                    click("出す（自球団）", substring = true)
                    click("総合", substring = true)
                    shot("trade-players")
                    click("確認へ")
                    page("trade-confirm", scrolls = 1)
                    rule.runOnUiThread { model.tradeDraft = null; model.procTrade = false }
                    pause()
                }
            }
            else -> {
                tab("Procedures")
                page("procedures", scrolls = 5)
                if (stage == "camp") step("camp group") { click("野手", substring = true); page("procedures-camp-fielders", scrolls = 1) }
                if (stage == "tryout") step("tryout weights") { click("開く"); page("procedures-tryout-weights", scrolls = 1) }
                tab("Games")
                step("news") { click("リーグ便り"); page("games-news", scrolls = 1) }
                tab("Plan")
                page("plan-order", scrolls = 0)
                tab("Players")
                page("players", scrolls = 0)
            }
        }
        step("rename") {
            tab("Home")
            rule.onAllNodes(androidx.compose.ui.test.hasContentDescription("メニュー")).onFirst().performClick()
            pause()
            click("球団名", substring = true)
            shot("rename-dialog")
            back()
        }
        Log.i("ScreenTour", "done $stage: $count shots")
    }

}
