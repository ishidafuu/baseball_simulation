# 野球シミュレーター開発ガイド

総合監査を頼まれたら [docs/review-routine.md](docs/review-routine.md) の手順に従い、記録は `docs/audit/` に残す。

過去の設計判断・実測記録は [詳細アーカイブ](docs/archive/CLAUDE-full.md) に保存している。数値や行番号は履歴として扱い、変更時は現在のコードとハーネスで確かめる。

## 起動と検証

- `npm run dev`: 開発サーバー。保存領域のオリジンを固定するため `vite.config.js` の `strictPort` を維持する。
- `npm run build`: 配布用の単一HTMLを生成する。
- `npm run lint -- --quiet`: React Hooks の呼出順を検査する。
- `npm run check:quick`（約30秒）: 普段の作業で回す。lint と軽い検査。
- `npm run check`（4コアで約6分。いちばん長い online-coach-check が約4分）: コミット前に回す。全検査を CPU の数だけ並列に走らせる。`check:full` は複数年進行も足す。
- `npm run check:ui`（約2分）: 一人用の通し検査。ビルドしてブラウザで開幕からドラフト会議まで進める。
- 一人用の画面確認は、日程画面の開発用の早送り（`npm run dev`、またはビルドに `?dev=1`）と、`npm run scenes` で作る場面（`npm run scene -- <名前>`）を使う。詳細は `tools/sim-harness/README.md`。

- 動きを変えない整理（関数の移動・写しの片付け）は `node tools/sim-harness/replay-hash-check.mjs` で確かめる（約40秒。`check` に入っている）。固定の種で一人用の試合とオンラインの開幕40回を回し、結果のハッシュを `tools/sim-harness/replay-hashes.json` と比べる。年度更新をまたぐ分は `--year`（`check:full`）。**狙って結果を変えたときだけ** `--update` で書き直し、コミットに理由を書く。
- 取りこぼし検知: `npm run check:unmerged` で、フォークのブランチにあって ice-north の main に無いコミットが一覧になる。**PR を出す前と、総合監査の最初に回す**。直しは別のブランチに置かず、開いている PR のブランチに載せる（別のブランチに置いた直しは、PR に入らないまま忘れられたことがある）。
- PR: 作業用のフォークから ice-north へは、題と本文だけのコミットを作業ブランチの先頭に載せて `pr/<ブランチ名>` へ push すると作られる。使い方は `.github/workflows/upstream-pr.yml` の先頭。

触った場所ごとに、少なくとも回す検査:

| 触った場所 | 回す検査 |
|---|---|
| `src/game/autoSimulation.js`・`src/simulation-logic.js`・投球判断 | `check:season`・`replay-hash-check`（動きを変えないつもりの整理のとき） |
| ドラフト・成長・年次進行（`src/season/`） | `check:draft`・`check:progression`・`check:ui:yearend` |
| 日程画面・大会・フェーズ（`DateProgressScreen.jsx`・`dateProgression.js`） | `check:bracket`・`check:ui` |
| セーブ（`src/game/saveSystem.js`・`saveMigration.js`） | `check:quick`・`check:ui` |
| オンライン（`server/`・`src/online/`） | `check:online`・`check:online:season` |
| オンラインの保存する項目・ビューの項目を足した | `check:online:size`（約3分。上限は `tools/sim-harness/size-budget.json`） |
| オンラインの画面（`src/online/*.jsx`・`online.css`） | `check:online:dist-ui`・`check:online:ui` |
| 画面の部品全般 | `check:quick`・`check:ui` |

## 実装の入口

- `src/App.jsx`: 画面の切り替え・セーブ・管理画面の接続。采配の試合（手動試合）の state と処理は `src/game/useManagedGame.jsx`（App が同じ位置で呼ぶフック）、画面は `src/components/ManagedGameScreen.jsx`。1球の計算は自動の試合と同じ `src/game/pitchEngine.js`、CPU の采配は `src/game/managedTactics.js` から `src/game/cpuTactics.js` を呼ぶ。`[SECTION:]` マーカー（App.jsx と useManagedGame.jsx）で対象箇所を探す。
- `src/game/autoSimulation.js`: 自動試合。共通の物理演算は `src/simulation-logic.js`、投球判断は `src/game/pitchCalling.js`。
- `src/components/DateProgressScreen.jsx`: 日付進行とイベント。フェーズの定義は `src/season/seasonManager.js` と `src/season/dateProgression.js`。
- `src/components/LineupSettingScreen.jsx`: 打順、守備位置、投手起用（一人用）。一人用のスタメン設定はオンラインPC版と同じ1枚の表（`src/components/lineup/SoloLineupBoard.jsx`、中身は `soloLineupOrder.js`、DH制あり）、投手起用も同じ形の1枚の表（`src/components/lineup/SoloPitchingBoard.jsx`、中身は `soloPitchingEdit.js`。オンラインに無い「役割なし」があり、野手は救援だけ）で、`.online.online-desktop.online-embed` に包んでオンラインの部品のクラスを使う。一人用のチーム情報（`TeamInfoScreen.jsx`）はオンラインの選手成績の表（`CompactRoster`）をそのまま使う。オンラインのスマホ版の打順・守備・控えは2回のタップで入れ替える縦の表（`src/online/TapLineup.jsx`、中身は `src/online/tapLineup.js`）、投手起用は「投手起用を開く」からPC版と同じ表（`PitchingBoard.jsx`）を全画面で出す（`src/online/MobilePitching.jsx`。スマホとPCの間の未保存の編集の受け渡しは `src/online/lineupBridge.js`）。オンラインのPC版は `src/online/LineupBoard.jsx`・`PitchingBoard.jsx`。表の選ぶ・入れ替える・ドラッグの中身は一人用とオンラインで共通（`src/online/useLineupPicking.js`・`usePitchingPicking.js`、行の部品は `PitchingRows.jsx`）。
- `src/game/saveSystem.js`: スロット、バックアップ、ロード、ファイル入出力。形式移行は `src/game/saveMigration.js`。
- `src/corporate/worldData.js`: 並行世界の初期化。`TEAMS_DATA` とともにロード失敗時の復元対象。
- `src/components/StartScreen.jsx` と `src/components/select/`: タイトルと導入画面。意匠はナイター中継で、本編とは別の語彙（`.glass-panel` と `.lift-card`）を使う。

## 変更時の不変条件

- 大学の在学生はチーム名簿を正本とし、プールとの二重登録を避ける。
- 年度末の戦力外は所属リーグと企業チームの担当範囲を分け、大学の在学生を解雇しない。
- 保存する前に生きた状態を変更しない。IndexedDB の書き込みはトランザクション完了を確認する。
- 日付を飛ばす操作でも強制イベントを一度だけ処理する。試合日程を変更したらプレーオフと全国大会の順序も確認する。
- 日をまとめて進める導線は1日進行の繰り返しで作る。日付を差し替える実装は間の日の試合・イベント判定・疲労回復とコンディション更新を落とし、取りこぼしは戻らない。止まる条件は `handleProgressDate` の戻り値を唯一の正本とし、呼ぶ側に書き写さない。
- 采配後の日の再開（`_resumeDayAfterManagedGame`）は冪等に保つ。`StrictMode` がマウント時に effect を2回実行し、印を落とすのは `setState` 経由なので印だけでは門番にならない。順位表は作り直しで自己修復するが `TEAMS_DATA` の選手成績は二重に積まれる。
- 一人用の画面をオンラインへ持ち込むときは、`team` をプロップで受け取る形に直してから渡し、`TEAMS_DATA` を名前で引く関数には `team` も渡す。引けないと `console.error` を出して戻るだけなので、画面は操作できたまま何も起きない。
- 持ち込んだ画面は `.online` の中に置くなら `.online-sp` で包む（PC版。ほかのページと同じ枠に入れるため）。`online.css` は `.online button` のように要素名で当てており、詳細度が Tailwind の単一クラスより強いので、そのまま入れるとボタンが全部同じ高さ・同じ色に潰れる。いま `.online` の中に包んだ一人用の画面は無い（PC版の編成は `LineupBoard.jsx` に置き換えた）ので、`online.css` の要素名の指定の多くは `:not(:where(.online-sp *))` を付けていない。持ち込むときは、その画面に当たる要素名の指定に `:not(:where(.online-sp *))` を付けてから入れる。包まずに出すならポータルで `.online` の**外**へ出す（スマホ版の全画面）。
- オンラインの保存の形を変えたら `ONLINE_SCHEMA` を上げ、**同じコミットで** `src/online/leagueMigration.js` の `MIGRATIONS` に1段足す。オンラインは保存が1つしかないので、段が無いと全員の成績を消して作り直すしか選べない。移行できるのは項目を足す変更だけなので、形は足す方向で設計する。
- PC のスポーツ新聞（`src/online/paper/`・`SportsPaper.jsx`）の文はアプリの `FrontPage*.kt` の写し。どちらかの文を変えたら両方を直し、`node mobile/tools/expect-paper.mjs > mobile/shared/src/jvmTest/resources/front/paper-expected.json` で期待値を書き出し直す（答え合わせはアプリの `FrontPageWebTest`）。
- 新しい見た目（試作。`src/online/look/` の球団の色・字の表、マーク・顔・球場の描く手順、打席速報・今日の一戦・番記者の文、成績の S〜F の札 `statGrade.js`、球団ロゴを描く手順 `logoArt.js`）はアプリの `Look.kt`・`LookArt.kt`・`LookScene.kt`・`LookPlay.kt`・`TodayGame.kt`・`LookStory.kt`・`LookGrade.kt`・`LookLogo.kt` の写し元。どちらかを変えたら両方を直し、`node mobile/tools/expect-look.mjs > mobile/shared/src/jvmTest/resources/look-expected.json` で期待値を書き出し直す（答え合わせはアプリの `LookTest`）。入／切は端末ごとで**既定は入**（Web。2026-11-28 に採用。鍵は 'new'＝入／'old'＝切／無い＝既定の入）。画面の検査は切の画面を確かめる前提なので、検査のブラウザは鍵が無ければ 'old' を置いて開く（`tools/sim-harness/lib/browser.mjs` の `launchBrowser`。既定の入を確かめるときは `newContext({ lookDefault: true })`）。切のときは今までと同じ画面に保つ（例外: トレードの相手選びの球団マークは先方要望で切でも出す。`TeamMark` の `always`。切のときは端末の字で描き、`public/fonts/` もロゴの絵も読まず、球団ロゴも描かない）。字は `tools/look-fonts.py` で書き出す（日本語と数字は使う字に絞る。Graduate・Alfa Slab One は OFL の予約名があるので絞らない）。Web の字はどれも配布 HTML に埋め込まず `public/fonts/` に置き、入にした人だけが読む（日本語は1つ約450KB）。
- 球団ロゴ（試作。見えるのも作れるのも、新しい見た目を入にした人だけ）は**部品の重ね**（最大8枚。図形・絵・字に、位置・大きさ・回転・色・ふち）で持つ。保存は `team.logo`（版22。`profile` 命令の `logo`、`null` で自動に戻す）で、送られたものは `look/logoData.js` の `cleanLogo` が必ず確かめ直す。型とおまかせの候補は `logoBuild.js`、描く手順は `logoArt.js`、作る小窓は `LogoEditor.jsx`。サーバーは作っていない球団にも自動のロゴ（おまかせの1番目。保存しない）を付けて、ビューの `teamLabels[].logo` に色と一緒に載せる（`teamLogo.js`）ので、描く側は載ってきた重ねを描くだけでよい。絵は game-icons.net（CC BY 3.0）で、名前の表が `logoMotifs.js`、形は `node tools/logo-icons.mjs <icons.json>` で `public/look/logo-icons.json` に書き出す（配布 HTML に埋め込まない）。**作者の表示（小窓の下の1行と `public/look/LICENSE-game-icons.txt`）を消さない**。字の幅は測らずに `logoParts.js` の表で決める（`python3 tools/logo-font-widths.py` で字のファイルと比べる）。絵・型・部品の表を変えたら `online-logo-check`、小窓を変えたら `check:online:logo-ui` を回す。アプリには**描く側だけ**写してある（`LookLogo.kt`。ビューに載ってきた重ねを球団マークの場所に描き、選んだ色も出る。答え合わせは `LookTest`、期待値は `expect-look.mjs`）。作る画面・型・おまかせの候補はアプリに無い（ロゴを作るのは Web）。`logoArt.js`・`logoData.js` の `openLayer`・`logoParts.js` の色と字の幅を変えたら `LookLogo.kt` も直す。絵の形はアプリも `public/look/logo-icons.json` をそのまま入れる（`androidApp/build.gradle.kts` の assets）ので、絵を足したらアプリも作り直す。アプリの作者の表示は、メニューの「新しい見た目（試作）」の下の1行（これも消さない）。
- 「動きで見る」（試作。`src/online/look/playMotion.js` と `motion*.js`・`PlayMotion.jsx`）は Web だけで、アプリにはまだ写していない。保存は足さず、版20の `plays` の行を読むだけ。どこへ・いつは `playMotion.js`、守備の持ち場（塁に入る・中継・送球の逸れに備える人）は `motionDefense.js`、球場の寸法は `motionField.js`、カメラは `motionCamera.js`、姿勢は `motionPose.js`、絵は `motionFigure.js`・`motionStadium.js`・`motionPaint.js` が決め、React を知るのは `PlayMotion.jsx` だけ。バントは打球の記録が無いので打球を作って見せる（`buntBall`）。動きやカメラを変えたら `online-motion-check`（球が窓から出ない・姿勢が数になる・送球の先に受ける野手が居る）を回す。
- 一人用の文字色は、地色（明るい紙）の上かカードの上かを見て `src/index.css` の「文字色の決まり」の表から選ぶ。地色の上は `text-ink` 系の4色だけで、半透明の枠を置かない。
- 既存の数値調整は `npm run check:season` で集計を確認する。
