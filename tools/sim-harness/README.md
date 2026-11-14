# sim-harness — シミュレーション検証ハーネス

ブラウザを立ち上げずに、Node から実物のゲームロジック（試合エンジン・ドラフト）を
ヘッドレスで回し、**結果が現実的な帯に収まっているか / 構造が壊れていないか** を
機械的に検証するツール群。数十のランダム要素が絡むバランス調整を「体感」ではなく
「数値」で確認するためのもの。

> 背景: このリポジトリにはテストが無く、開発履歴上クラブチームのドラフト比率など
> 同じバランス問題を何度も調整し直している（revert 往復もある）。目視ではなく
> 自動チェックで桁レベルの崩壊を踏み抜けるようにするのが目的。

## 使い方

`npm run` 経由が手軽（package.json にスクリプト登録済み）。まとめて回すものは
`run-checks.mjs` が **CPU の数だけ同時に**走らせ、最後に所要時間の一覧と落ちた検査の出力を出す。

```bash
npm run check:quick        # 普段の作業向け: lint＋軽い検査（約30秒）
npm run check              # コミット前・CI: 全部（4コアで約6分。いちばん長い online-coach-check が約4分）
npm run check:full         # check ＋ progression（4コアで約6〜7分）
npm run check:online       # オンライン版の検査だけ
npm run check:online:season  # オンラインの通年検査（約2分。CIでは別ジョブ）
npm run check:ui           # 一人用の通し検査（ビルド→ブラウザで開幕からドラフト会議まで。約2分）
npm run check:ui:yearend   # 一人用の年度更新（独立・箱庭・企業・クラブで1年目のオフから2年目の開幕まで。4コアで約2分半）
npm run check:online:dist-ui  # オンラインの画面検査10本（ビルド→dist を開く。サーバー不要。1本ずつで約4分）
npm run check:online:ui    # オンラインの PC/スマホの通し（先に開発サーバー2つ: ONLINE_DISABLE_TIMER=1 npm run dev:online と npm run dev。立て方は .github/workflows/check.yml の ui ジョブと同じ）
npm run check:season       # 個別（ほかの check:* も同じ）
node tools/sim-harness/run-checks.mjs season-check online-parity-check  # 名前で選ぶ
node tools/sim-harness/run-checks.mjs check --serial   # 1本ずつ（出力を順に追う）
```

引数付きで直接叩くこともできる:

```bash
# シーズン統計バランス検証（デフォルト: 8チーム×120試合×3シード）
node tools/sim-harness/season-check.mjs 8 120 3   # チーム数 試合数 シード数
# NPBドラフト比率検証（デフォルト: 3シード）
node tools/sim-harness/draft-check.mjs 5          # シード数
# 多年次プログレッション検証（デフォルト: 5年）
node tools/sim-harness/progression-check.mjs 8    # 年数
```

いずれも **全PASSで終了コード0、FAILで1**。検査を足したら `run-checks.mjs` の
`CHECKS`（ブラウザやサーバーが要るものは `SEPARATE`）に1行足す。書き忘れると
`run-checks.mjs` が止まって知らせる。

### 検査の速さについて

- オンライン版の検査は、保存先に `lib/testStore.mjs` の **メモリ上の保存** を使う。
  本物の `FileStore` は読み書きのたびにリーグ全体を gzip していて、検査の時間の
  約75%がそこに消えていた。保存の形そのものは `online-storage-check` が
  本物で確かめる。本物で回したいときは `SIM_HARNESS_FILE_STORE=1`。
- 同時に走らせる数は `-j N` か `SIM_HARNESS_JOBS=N` で決められる（メモリが足りないとき）。
  4本同時で使うメモリは最大6GB程度だった。

### 一人用の早送りと場面

- 一人用の日程画面には **開発用の早送り**（7日・30日・次の区切りまで）が右下に出る。
  `npm run dev` では常に、配布用ビルドでは URL に `?dev=1` を付けたときだけ出る
  （`src/game/devTools.js`）。「1日進める」を繰り返すだけで、自分の試合は「おまかせ」で
  消化し、フェーズ移行と大会の試合では止まる。
- `npm run scenes` で、途中の区切り（開幕・30日後・秋季リーグ・ドラフト前）の
  ブラウザ保存領域を `tools/scenes/` に書き出す（git には入れない）。
  `npm run scene -- before-draft` でその場面からブラウザを開ける。年末の画面を
  確かめるのに、毎回最初から進めなくてよい。セーブの形を変えたら作り直す。

### 一人用の年度更新の通し検査（singleplayer-yearend-ui-check.mjs）

独立リーグ・箱庭・社会人（企業・クラブ）・大学を新しく始め、ドラフト会議・契約更改（退団処理）・
トライアウト（スカウト入団・入部希望者・スポーツ推薦）・オフシーズン・翌年のレギュレーションを画面で通して、
2年目の開幕（2025/4/1）に着き日程が進むことを確かめる。「ボタンを押しても次の画面へ移らない」
型の止まり方（2f9ee22）を捕まえるためのもの。大学は卒業・入部レポートの途中のオートセーブを
読み直し、年度更新がもう一度走らずレポートの続きに戻ることも見る。5モードを別々のタブで同時に進める
（`--serial` で1モードずつ、`club sandbox` のようにモードを選べる）。重いので `check` の束には
入れていない。年次進行・オフの画面・`ManagementScreen.jsx` の遷移を触ったら回す。

## 何を検証するか

### season-check.mjs — 試合エンジンのバランス
N チームでフルシーズンを消化し、リーグ全体の打率・出塁率・長打率・防御率・K/9・
BB/9・四球率・三振率・本塁打率が現実的な帯に収まるかを検証。加えて構造的不変条件
（ID重複なし・ロスター非空・投手数・ローテ整合・打率が[0,1]）もチェックする。

ロスターは `generateExpansionRoster`（トライアウト＝独立リーグ最下層相当）の弱い選手で
構成されるため、長打率・本塁打は低め・四球はやや多めが「正常」。帯はその戦力レベルの
実測ベースラインに較正済みで、**NPBとの一致ではなく回帰検出**が目的。

加えて **個人成績リーダーの外れ値検出** も行う（規定到達者の首位打者・本塁打王・防御率王が
現実的な範囲か）。系統的なオフェンス膨張はリーグ集計の帯が、単一の絶対おかしいライン
（首位打者.500超・規定防御率0.00等）はこの外れ値検出が捕える二段構え。

### draft-check.mjs — NPBドラフトの比率
実物の `processNPBDraft` を、各ソース（高校/大学/社会人/クラブ/独立）の実物ジェネレーター
で用意した合成ワールドに対して回し、指名の内訳を検証する。主眼は **クラブチームの
過剰指名の回帰検出**。クラブの初期能力スケールが正しければ新規クラブ選手はほぼ指名
されない（設計目標: クラブ輩出は年約2名）。

### progression-check.mjs — 世界の多年次健全性
独立リーグモードのフルワールド（ユーザーリーグ + 社会人179 + 他独立 + 大学234校 +
高校生プール、計約560チーム/約15,000選手）を構築し、実物の年次進行（表彰→ドラフト→
`advanceToNextYear`→翌年高校生生成）をN年回して長期健全性を検証する。捕まえるバグ:
- **プール漏れ/爆発**（例: 過去にあった「大学卒業生のリリースプール消失」）→ 人口保存で検出
- **デモグラフィ崩壊**（若年層が痩せる）→ 年齢ピラミッドの単調減少で検出
- **ポジション偏り**（捕手不足・投手過多）→ 投手/捕手シェアの帯で検出
- **多年次のクラブ過剰指名** → クラブ指名シェアで検出
- **年次進行のクラッシュ**（成長/引退/大学/ドラフトのどこか）→ N年完走で検出
- **ドラフト規模の暴走** → 総指名数の帯で検出

初年のドラフト比率は 高33/大38/社23/独6 前後で CLAUDE.md 目標（高30/大35/社20/独14）に
近い。年を追うと高校比率が上がる傾向があるが、これは実試合を消化せず出場由来の成長/
表彰を過小評価する近似の影響を含むため、比率推移は参考値（合否はクラブ/人口/年齢/完走）。

## 重要な発見（構築時に判明したこと）

**試合エンジンは日次疲労回復が前提。** 実ゲームは `progressDate` 内で毎日
`recoverAllPitcherFatigue()` を呼び、出場者だけ相殺している。これを再現せず試合を
連続実行すると疲労が青天井に蓄積し、数十試合で制球・ミートが崩壊して
**打率.077 / 防御率34 / 四球率63%** という異常値になる。逆に日次回復を入れると
打率.264 / 防御率3.5 / K9=7.3 と完全に現実的な数値に収束する。
→ このハーネスは日次回復を再現している（`lib/league.mjs`）。

## 回帰検出力の自己検証

ハーネス自身が「本当に壊れたら FAIL するか」を確認できる故意の破壊モードを持つ。

```bash
# 日次回復を無効化 → 疲労スパイラルで season-check が必ずFAIL（打率.11/防御率50級）
SIM_HARNESS_NO_RECOVERY=1 node tools/sim-harness/season-check.mjs 6 100 1

# クラブ初期能力を故意に膨張 → クラブシェアが跳ね draft-check が必ずFAIL（~17%）
SIM_HARNESS_BOOST_CLUB=1 node tools/sim-harness/draft-check.mjs 2

# 毎年ロスターから4%漏らす → 人口保存が割れて progression-check が必ずFAIL（~83%）
SIM_HARNESS_LEAK=1 node tools/sim-harness/progression-check.mjs 4
```

> 補足: 高校生供給を止めても壊れない（`processNPBDraft` にプール空時の自動再生成
> セーフティがあり、パイプラインが自己修復する）ことが構築時に判明した。健全性の証左。

### spin-probe.mjs — 回転数の効き方（プローブ / 合否なし）

`check` 系と違い**PASS/FAILを出さない測定ツール**。回転数(spinRate)を振ったときに
球種ごとの空振り率と、リーグ全体のK/9・防御率がどう動くかを表で出す。

```bash
node tools/sim-harness/spin-probe.mjs            # 球種別の空振り率のみ（数秒）
node tools/sim-harness/spin-probe.mjs --season   # ＋全投手の回転数を揃えたシーズン（約1分）
```

回転数は「直球に大きく・変化球に少し」という配分で設計してある（CLAUDE.md 参照）。
係数（`SPIN_FASTBALL_W` / `SPIN_BREAKING_W` / `SPIN_BREAK_LEVEL_W`）を触ったら、
**この配分と、能力の総価値（回転0→100のK/9の幅）の両方**を測り直すこと。

### peak-age-probe.mjs — 完成年齢（プローブ / 合否なし）

⚠ **断面（各年齢帯に居る選手の平均）で完成の早さを語らないこと**。断面は
「誰がその年齢帯に残っているか」（ドラフトで抜ける・戦力外・進路の振り分け）に
汚染される。このプローブは ①断面 と ②同じ1200人を18歳から追う縦断 を並べて出す。
2つが食い違うときは縦断が正しい。⚠ 縦断でも標本が小さいと符号が反転する
（129人では断面と同じ答えが出て、1150人では逆になった）。

### dexterity-probe.mjs — 器用さの効き（プローブ / 合否なし）

```bash
node tools/sim-harness/dexterity-probe.mjs 20000
```

器用さ(dexterity)が フォーム改造 / 球種習得 / 打席変更 / サブポジ習得 に
どれだけ効くかを出す。⚠ **2つを同時に見ること**——①選手間で差が付いているか、
②リーグ全体の習得率が動いていないか（動くと球種数・左右比率が釣られる）。
⚠ ②の基準は**器用さ50の実測値**を取る（倍率1.0＝従来の挙動）。定数を手で書くと、
フォーム適性が乗っている経路で比較にならない。

### npb-career-probe.mjs / npb-rookie-probe.mjs — 教え子のプロキャリア

```bash
YEARS=12 node tools/sim-harness/npb-career-probe.mjs   # ゲームが実際に回す母集団
YEARS=20 node tools/sim-harness/npb-rookie-probe.mjs   # 指名クラス全体（影のNPB）
```

⚠ **2本あるのは母集団が違うから**。`npbAlumni` に載るのは `source` が
highschool / university（＝プール）**以外**、つまり社会人・独立・クラブ・
実体化した大学チームの選手だけで、指名時の年齢が22以上で95%を占める。
実NPBの「指名者全体の一軍到達 40〜50%」と直接比べられるのは
`npb-rookie-probe`（`advanceYear` の返す指名者全体で影のNPBを作る）のほう。

⚠ **防御率は投球回で重み付けすること**。単純平均だと18回の敗戦処理と160回の
エースが同じ重みになり 0.3〜0.4 高く出る。

### human-trade-probe.mjs — トレードで人の球団がどれだけ強くなるか（プローブ / 合否なし）

```bash
node tools/sim-harness/human-trade-probe.mjs trade 11   # 得なトレードを選び続ける（約10分）
node tools/sim-harness/human-trade-probe.mjs none 11    # トレードしない（比べる元）
```

人2人のリーグで、人の球団が「CPUが受ける中で自分の持ち場の力（`squadStrength`）が
いちばん上がる交換」を開幕前・1年目の60日目・2年目の開幕に選び続け、2年目の約73試合目の
順位を出す。2026-11-14 の実測（種 11/22/33/44 の平均）: 値段だけで受けていた頃 .69、
戦力の開き（`STRENGTH_GAP_LIMIT`）を見る今 .54、トレードしない .53。
⚠ 種1つでは揺れが大きい（同じ手で .29〜.64）。4つ以上を並べて比べる。

## 構成

ファイル名で役目が分かるようにしている。

- `*-check.mjs`: 合否のある検査。`run-checks.mjs` の `CHECKS`（まとめて回す）か `DIST_UI`
  （オンラインの画面検査。dist を開く）か `SEPARATE`（別の手順で回す）のどれかに必ず載せる
  （載っていないと `run-checks.mjs` が止まる）。
  - `online-*-check.mjs` はオンライン版、`*-ui-check.mjs` はブラウザで画面を動かす検査。
- `*-probe.mjs`: 合否の無い測定（効き方・分布を見るため。手で回す）。
- `run-checks.mjs`: 検査をまとめて同時に走らせる入口。`open-scene.mjs`: 書き出した場面から続きを遊ぶ。

```
tools/sim-harness/lib/
  bootstrap.mjs         window/alert/localStorage のNodeスタブ（最初にimport必須）
  report.mjs            PASS/FAIL整形・帯チェック
  league.mjs            Nチーム構築 + 日次回復付きシーズン実行
  stats.mjs             成績集計 + 不変条件チェック
  draftworld.mjs        ドラフト用合成ワールド構築 + 実物processNPBDraft呼び出し
  world.mjs             フルワールド構築 + 実物の年次進行シーケンス
  singleplayer.mjs      一人用の画面を Playwright で動かす道具（dist を vite preview で配る）
  serviceRoute.mjs      画面の通信を検査の中の LeagueService へつなぐ（サーバーを立てずに実画面で操作）
  testStore.mjs         オンラインの検査用の保存先（既定はメモリ、SIM_HARNESS_FILE_STORE=1 で本物）
  textWrap.mjs          折り返した文の最後の行が1字だけになる所を探す（画面の検査用）
  deadline.mjs          通信を保留する fixture でも有限時間で落とす
  chronicle-shots.mjs   年代記の画面を目で確かめるためのスクショ（検査ではない）
```

## 限界と今後

- **draft-check は新規ロスター前提のスナップショット検証**。単年のクラブ初期能力
  スケール回帰を直接踏み抜くのが目的。多年次の育成ダイナミクスは progression-check の領分。
- **progression-check は実試合を消化しない近似**。CPU成績は `simulateParallelWorldStats`
  が注入し、ドラフト評価は能力ベースで成立するが、出場数由来の `growthModifier` や表彰
  fame は過小評価気味。そのため多年次のドラフト比率が徐々に高校寄りに漂流する（比率推移は
  参考値に留め、合否は人口保存・年齢ピラミッド・クラブ・完走・指名規模で判定）。
- **さらに忠実にするなら**: progression-check にユーザーリーグの実試合消化（season-check の
  エンジンを流用）を組み込めば、出場由来の成長・表彰まで反映でき、比率推移も合否対象に
  できる。ただし全560チーム分を回すと重くなるため、ユーザーリーグ + 主要社会人/大学の
  サンプルだけ実消化する折衷が現実的。
