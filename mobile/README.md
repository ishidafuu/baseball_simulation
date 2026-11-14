# オンライン対人版 スマホアプリ（Android）

オンライン対人モード専用のネイティブアプリ。試合やシーズンの計算はサーバー（`../server`、本番は Vercel の `../api/online.mjs`）が行い、アプリは「見る」「指示を送る」だけ。一人用モードは入れない。

## 構成

| モジュール | 中身 |
| --- | --- |
| `shared` | 通信（Ktor）、データの形、編成の編集（打順・投手起用・方針、元に戻す）、成績表の列、キャンプ・トライアウト・トレードの計算、指示の中身（`Commands`）。Kotlin Multiplatform（いまは jvm だけ。iOS に進むときに target を足す） |
| `androidApp` | Jetpack Compose の画面。下のタブ: ホーム／試合／選手（選手成績・通算・能力ランキング）／編成（スタメン・投手起用・方針采配）／手続き（初期メンバー・キャンプ・契約更改・トライアウト・年度更新・トレード） |

### PC版と同じにしてある決まり

- 成績は1つの表の形（名前の列は固定、数字の列は横に流す）。区分はタブで切り替え、見出しを押して並べ替え。
- 能力は数字をランクの色で出す（文字だけにしない）。調子は顔。
- 編成の保存は上の1か所。3つの面（スタメン・投手起用・方針）を1つの編集として持ち、元に戻す／やり直すもまとめて効く。
- 投手は長押しでつかんでローテ・救援の役割の見出しへ落とすと持ち場が変わる。打順・ローテも長押しでつかんで落とした相手と入れ替える（2人の入れ替え。間はずれない）。
- 保存・提出・練習・トレードの送信中は画面全体を塞ぐ（押し直し・画面移動で結果を見失わないため）。
- 「詳細はPCで」を作らない（キャンプの選手ごとの練習もスマホで選べる）。

### Web 版から写しているもの

- `shared/.../Tables.kt` は `tools/gen-tables.mjs` が Web 版の表から書き出す（手で直さない）。
- キャンプの方針（`trainingPolicy.js`）とトライアウトの希望順（`tryoutPlan.js`）は Kotlin に写してあり、
  `tools/expect-logic.mjs` が書き出す期待値（`logic-expected.json`）と `LogicTest` で答え合わせする。
- CI はどちらも `--check` で、Web 版だけ直して写しが古くなっていないかを見る。

- 接続先の既定は本番（`https://baseball-simulation-neon.vercel.app/api/online`）。ログイン画面の「接続先を変える（開発用）」でローカルの開発サーバーにも繋げる（エミュレーターから PC へは `http://10.0.2.2:3002/`）。
- ログインは Web 版と同じアカウント。1アカウントで同時に操作できるのは**ブラウザ1台とアプリ1台**まで（`server/sessions.mjs`）。アプリはログインのときに `client: "app"` を送る。同じ種類の別の端末でログインすると、前の端末だけが閲覧のみになる。

## サーバーとの約束（壊さないために）

- アプリは `?action=login / refresh / view / defaults / team / player / games / game / command` を使う。ビューの項目名を変えるとアプリが壊れる。
- `view` には手元のビューの世代 `since`（ビューの `viewGeneration`）を添える。世代が同じ（かつ保存の版が今のサーバーと同じ）なら、サーバーはビューを送らず `{ unchanged: true, viewGeneration, writable }` だけ返す（`server/leagueService.mjs` の `view`）。アプリはこのとき `writable`（書き込めるか）だけを合わせる。世代を持たない保存先（開発サーバーの `FileStore`）は `since` を無視して毎回全部返す。
- `command` の返事の `view` は最新のビューで、`view.viewGeneration` に公開した世代が入る（`server/storage/supabaseStore.mjs`）。アプリは読み直さずにこれを使い、次の `since` にする。返事に `view` が無ければ読み直す。
- `games` は `year`・`page`・`scope`（`own` / `league`）・`size`（1〜200。既定は6）を受ける。紙面は `size=200` で自球団の1シーズンを1回で読む（`OWN_HISTORY_PAGE`）。
- 試合の勝敗投手（ビューの `results`・`games`・`game` の `decisions` の `winningPitcher` / `losingPitcher` / `savePitcher` / `holdPitchers`）は `{ id, name }` だけ（`server/recordedViews.mjs` の `decisionRefs`）。能力や成績は載らないので、自球団の投手は名簿（ビューの `roster`）から `id` で引く。
- タイトル争い（ビューの `leaders` の `rows`）の行は `{ id, name, team, label, value }`（`server/leagueBoard.mjs` の `leagueLeaders`）。アプリは行を押すと球団の名簿から `id` で選手を探し、名前では探し直さない（同じ球団の同名の別人を開かないため。`shared/.../PlayerLookup.kt`）。`id` の無い古いサーバーの行だけ名前で探す。
- 編成の保存（`command` の `lineup`）は、ビューの `lineup` を**丸ごと**送り返し、`baseLineup` に編集前の塊を添える。アプリが知らない項目もそのまま返すので、編成に項目を足すのは構わない。
- 手続きの任せ方は、ビューの `phase.delegated`（自分がその手続きを指導者に任せているか）と `members` の `ready`・`cpu`・`delegated` を読む。任せた手続きは決定の帯を出さず、`defaults` の案（指導者の案）を読むだけで見せる。待たれている最後の1人が手続きの分野を「任せる」にして保存すると、サーバーはその場で手続きを決めるので、アプリは送る前に確かめる（`shared/.../Staff.kt` の `delegationSettles`。`server/leagueEngine.mjs` の `waitsFor` と同じ見方）。

### 検査に使う実際の窓口の答え（`shared/src/jvmTest/resources/`）

ビュー・窓口の形（`server/projection.mjs` など）を変えたら、使っている物を取り直して `./gradlew -PsharedOnly :shared:jvmTest` が通ることを確かめる。どれもリポジトリの根から動かす。

| ファイル | 中身 | 作り方 | 使う検査 |
| --- | --- | --- | --- |
| `view-running.json` | 開幕3日目（4月4日）のビュー | `node mobile/tools/view-fixture.mjs` のあと、必ず `node mobile/tools/expect-logic.mjs > mobile/shared/src/jvmTest/resources/logic-expected.json` | `ViewTest`・`LogicTest`・`TipsTest`・`TwoWayTest` |
| `front/view.json`・`game.json`・`games.json`・`team.json` | 同じリーグの6月12日のビュー、自球団の最新の試合の詳細、今季の自球団の試合、次の相手の名簿 | 同じ `view-fixture.mjs` が一緒に書き出す | `FrontPageTest`（紙面） |
| `chronicle/view-late.json`・`view-offseason.json`・`team.json` | 1年目の終盤（マジックが出る頃）のビュー、2年目のキャンプのビュー（引退・裏の大会）、球団史 | `node mobile/tools/chronicle-fixtures.mjs`（引退が出ない年は1人分を作って載せる） | `ChronicleTest`（年代記の紙面） |
| `staff-view.json` | 指導者（監督・コーチ）の入ったビュー（2年目のキャンプ） | `WRITE_APP_FIXTURE=1 node tools/sim-harness/online-coach-check.mjs` | `StaffTest` |
| `logic-expected.json` | Web 版の計算の答え（`view-running.json` の名簿から） | 上の `expect-logic.mjs`。CI は `--check` | `LogicTest` |

- ⚠ 試合の結果は命令の `requestId` で決まる（同じコードなら同じ答え）。`ViewTest` の紙面の検査は「4月4日の自球団の最新の試合が負け」を前提にしているので、`view-fixture.mjs` はその形になる回まで `requestId` を変えて作り直す。試合の計算を変えて30回で合わなくなったら、検査の期待値をビューの中身から作る形に直すかを決める（`docs/audit/2026-11-08.md` の判断待ち 2）。

## ビルド

- GitHub Actions（`.github/workflows/android.yml`）が `mobile/` の変更ごとに検査と APK のビルドをする。APK は実行結果の Artifacts から落とす。
- 手元: Android Studio で `mobile/` を開く。または `./gradlew :androidApp:assembleDebug`。
- Android SDK の無い環境では `./gradlew -PsharedOnly :shared:jvmTest` で共通部分だけ検査できる。
- `ONLINE_TEST_ENDPOINT=http://127.0.0.1:3002/` を付けると、開発サーバー（開幕済みのリーグ）に繋いで打順の保存まで通す検査も動く。
- `ONLINE_FLOW_ENDPOINT=http://127.0.0.1:3002/` を付けると、**空のデータで起動した**開発サーバーで、リーグ作成 → 初期メンバー選択 → キャンプ4クール → 開幕 → 編成の保存 → 試合 → 読むだけの窓口 → トレード → 名前の変更 を、アプリと同じ指示の中身で通す（`LocalFlowTest`）。`ONLINE_FLOW_FULL=1` も付けると、契約更改・トライアウト・年度更新・翌年のキャンプまで進める（5分ほど）。

## アプリの版（最新かどうか）

- アプリは作ったときに「最後に `mobile/` を変えたコミット」とその時刻を持つ（`androidApp/build.gradle.kts` の `APP_COMMIT`）。CI は履歴を全部取って作る（`fetch-depth: 0`）。
- 起動時と引っ張って更新したとき（30分に1回まで）、GitHub の公開 API で ice-north の main の同じもの（`commits?path=mobile`）を読み、ホームの紙面に記事で出す（`shared/.../AppUpdate.kt`）。同じなら「最新版」、main の方が新しければ紙面の先頭に「新しいアプリが出ています」（押すと配布ページ）、ブランチで作った先の版なら「試作版」。
- ⚠ `mobile/` の中なら README や tools だけの変更でも「新しい版」になる。

## 署名

`androidApp/debug.keystore` は試作配布用（パスワードは Android 標準の `android`）。CI のたびに鍵が変わると上書きインストールできなくなるので固定してある。ストアに出すときは本番用の鍵を別に作り、リポジトリには置かない。
