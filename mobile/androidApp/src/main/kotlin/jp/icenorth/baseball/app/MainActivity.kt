package jp.icenorth.baseball.app

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import jp.icenorth.baseball.app.ui.BaseballTheme
import jp.icenorth.baseball.app.ui.OnlineApp

class MainActivity : ComponentActivity() {
    private val model: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // ⚠ 画面はいつも暗い色なので、ステータスバーの時計・電池は端末の設定（ライト）に関係なく白で描く。
        //    既定のままだとライト設定の端末で黒っぽい文字になり、暗い背景で読めなかった
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        // 試合結果の通知（裏の確認を設定とログインに合わせる。入れ直しても間隔はずれない）
        ResultNotifier.sync(this)
        setContent {
            BaseballTheme {
                OnlineApp(model)
            }
            // ⚠ 通知の許可（Android 13 以降）は、ログインしたあとに一度だけ自分から聞く。
            //    断られたら二度と聞かない（ホームのメニューの「通知（試合結果・手続き）」から入れ直せる）
            val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
                if (!granted) model.changeResultNotify(false)
            }
            val loggedIn = model.auth != null
            LaunchedEffect(loggedIn) {
                if (loggedIn && model.resultNotify && !model.notifyAsked && ResultNotifier.needsPermission(this@MainActivity)) {
                    model.notifyAsked = true
                    ask.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        ResultNotifier.appVisible = true
    }

    override fun onStop() {
        super.onStop()
        ResultNotifier.appVisible = false
    }

    override fun onResume() {
        super.onResume()
        // 画面に出ている試合は見たことにする（裏の確認で知らせない）。出ている通知も消す
        model.markResultsSeen()
        // アプリに戻ってきたら最新に（Web 版の visibilitychange と同じ）。来たことも知らせ、
        // しばらく空いていたら留守中のまとめを用意する
        model.resumed()
    }
}
