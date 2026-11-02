# 野球シミュレーター開発ガイド

過去の設計判断・実測記録は [詳細アーカイブ](docs/archive/CLAUDE-full.md) に保存している。数値や行番号は履歴として扱い、変更時は現在のコードとハーネスで確かめる。

## 起動と検証

- `npm run dev`: 開発サーバー。保存領域のオリジンを固定するため `vite.config.js` の `strictPort` を維持する。
- `npm run build`: 配布用の単一HTMLを生成する。
- `npm run lint -- --quiet`: React Hooks の呼出順を検査する。
- `npm run check:quick`（約12秒）: 普段の作業で回す。lint と軽い検査。
- `npm run check`（約100秒）: コミット前に回す。全検査を CPU の数だけ並列に走らせる。`check:full` は複数年進行も足す。
- `npm run check:ui`（約2分）: 一人用の通し検査。ビルドしてブラウザで開幕からドラフト会議まで進める。
- 一人用の画面確認は、日程画面の開発用の早送り（`npm run dev`、またはビルドに `?dev=1`）と、`npm run scenes` で作る場面（`npm run scene -- <名前>`）を使う。詳細は `tools/sim-harness/README.md`。

触った場所ごとに、少なくとも回す検査:

| 触った場所 | 回す検査 |
|---|---|
| `src/game/autoSimulation.js`・`src/simulation-logic.js`・投球判断 | `check:season` |
| ドラフト・成長・年次進行（`src/season/`） | `check:draft`・`check:progression` |
| 日程画面・大会・フェーズ（`DateProgressScreen.jsx`・`dateProgression.js`） | `check:bracket`・`check:ui` |
| セーブ（`src/game/saveSystem.js`・`saveMigration.js`） | `check:quick`・`check:ui` |
| オンライン（`server/`・`src/online/`） | `check:online`・`check:online:season` |
| 画面の部品全般 | `check:quick`・`check:ui` |

## 実装の入口

- `src/App.jsx`: 手動試合、管理画面の接続。`[SECTION:]` マーカーで対象箇所を探す。
- `src/game/autoSimulation.js`: 自動試合。共通の物理演算は `src/simulation-logic.js`、投球判断は `src/game/pitchCalling.js`。
- `src/components/DateProgressScreen.jsx`: 日付進行とイベント。フェーズの定義は `src/season/seasonManager.js` と `src/season/dateProgression.js`。
- `src/components/LineupSettingScreen.jsx`: 打順、守備位置、投手起用。オンライン版も `LineupSettingContent` をそのまま使う（`src/online/OnlineLineup.jsx`、view との変換は `src/online/lineupBridge.js`）。
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
- 持ち込んだ画面は `.online` の**外**（ポータル）に出す。`online.css` は `.online button` のように要素名で当てており、詳細度が Tailwind の単一クラスより強いので、内側に入れるとボタンが全部同じ高さ・同じ色に潰れる。
- オンラインの保存の形を変えたら `ONLINE_SCHEMA` を上げ、**同じコミットで** `src/online/leagueMigration.js` の `MIGRATIONS` に1段足す。オンラインは保存が1つしかないので、段が無いと全員の成績を消して作り直すしか選べない。移行できるのは項目を足す変更だけなので、形は足す方向で設計する。
- 既存の数値調整は `npm run check:season` で集計を確認する。
