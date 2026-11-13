// このファイルは mobile/tools/gen-tables.mjs が Web 版の表から書き出したもの。手で直さないこと。
package jp.icenorth.baseball.shared

data class Menu(val key: String, val name: String, val icon: String, val description: String, val category: String? = null, val only: String? = null)
data class Choice(val key: String, val label: String)
data class ChoiceField(val key: String, val label: String, val numeric: Boolean, val options: List<Choice>, val default: String)

val CAMP_MENUS: List<Menu> = listOf(
    Menu("batting", "打撃練習", "🏏", "ミートを強化、パワー・選球眼・バントを微増", category = "batting"),
    Menu("baserunning", "走塁練習", "🏃", "走力・盗塁・バントを強化", category = "batting"),
    Menu("fielding", "ノック", "🧤", "守備力と肩力を強化（投手野手共通）", category = "fielding"),
    Menu("control", "投げ込み", "🎯", "制球力を強化し、スタミナも向上（投手向け）", category = "pitching"),
    Menu("velocity", "球速練習", "🔥", "球速を強化（肩力上限・フォーム適性あり）、スタミナも微増（投手向け）", category = "pitching"),
    Menu("intensive_power", "長打集中", "💥", "パワー+1確定、50%で+2〜3。25%で他-1、25%で他2つ-1", category = "batting"),
    Menu("intensive_meet", "ミート集中", "🎯", "ミート+1確定、50%で+2〜3。25%で他-1、25%で他2つ-1", category = "batting"),
    Menu("intensive_speed", "走力集中", "⚡", "走力+1確定、50%で+2〜3。25%で他-1、25%で他2つ-1", category = "batting"),
    Menu("intensive_control", "制球集中", "🎯", "制球+1確定、50%で+2〜3。25%で他-1、25%で他2つ-1", category = "pitching"),
    Menu("intensive_velocity", "球速集中", "🔥", "球速+1確定、50%で+2〜3。25%で他-1、25%で他2つ-1", category = "pitching"),
    Menu("intensive_defense", "守備集中", "🛡️", "守備+1確定、50%で+2〜3。25%で他-1、25%で他2つ-1", category = "fielding"),
    Menu("intensive_eye", "選球眼集中", "👁️", "選球眼+1確定、50%で+2〜3。25%で他-1、25%で他2つ-1", category = "batting"),
)
val CAMP_SUB_MENUS: List<Menu> = listOf(
    Menu("physique", "基礎体力", "🏃", "体力+2〜4・体幹+2〜3/クール確定（投手：スタミナ+1〜2も）", only = null),
    Menu("weight", "ウエイト", "🏋️", "体幹+1〜3（確定）・パワー+0〜1・肩力+0〜1", only = null),
    Menu("stretch", "ストレッチ", "🧘", "野手：ミート/パワー/走力/肩/守備からランダム1能力+1。投手：制球/球速/肩/守備/ミートからランダム1能力+1。回復力30%UP", only = null),
    Menu("defense_sub", "守備補強", "🧤", "非適正ポジションの守備練習・バント微増", only = null),
    Menu("long_throw", "遠投", "🎯", "肩力を重点強化（+0〜3）投手は球速連動", only = null),
    Menu("eye", "選球眼練習", "👁️", "選球眼を強化（+0〜2）", only = null),
    Menu("clead_study", "Cリード学習", "🧠", "キャッチャーリード向上（リード+1~3）", only = "catcher"),
    Menu("breaking", "変化球練習", "🌀", "変化球レベルを強化（1球種を選んで集中練習も可）", only = "pitcher"),
    Menu("newpitch", "新球種習得", "✨", "新球種習得に挑戦（成功率12%・器用さとフォーム適性で上昇。球種は狙いを選べる・選ばなければおまかせ）", only = "pitcher"),
    Menu("spin_analysis", "スピン解析", "🎥", "高速カメラで回転を分析・スピン+1〜3（器用さ係数）、変化球Lv向上、制球微増（投手のみ）", only = "pitcher"),
    Menu("subposition", "サブポジ練習", "🔀", "指定ポジションの守備練習（適正大幅UP・器用さで伸びが変わる）", only = null),
)
val CAMP_DIRECTIONS: List<Menu> = listOf(
    Menu("sharpen", "長所を伸ばす", "⚔️", "最も強い能力に絞って伸ばす。他は伸びない"),
    Menu("balanced", "全体を伸ばす", "⚖️", "満遍なく。突出はしないが穴も出来ない"),
    Menu("patch", "短所を埋める", "🧱", "最も弱い能力を底上げする。伸びしろが大きく効率は良い"),
)
val CAMP_PHASES: List<Menu> = listOf(
    Menu("physique", "基礎体力", "🏃", "走力・肩・球速・スタミナ・体力。若いうちほど伸びる"),
    Menu("skill", "技術", "🎯", "ミート・制球・選球眼・守備。経験で伸びる"),
)
val STRATEGY_FIELDS: List<ChoiceField> = 
listOf(
    ChoiceField("batting", "打撃方針", false, listOf(Choice("balanced", "バランス"), Choice("patient", "慎重"), Choice("aggressive", "積極")), "balanced"),
    ChoiceField("pitching", "投球方針", false, listOf(Choice("balanced", "バランス"), Choice("strikeout", "三振狙い"), Choice("contact", "打たせて取る")), "balanced"),
    ChoiceField("baseRunning", "走塁方針", false, listOf(Choice("normal", "標準"), Choice("aggressive", "積極"), Choice("conservative", "慎重"), Choice("never", "盗塁しない")), "normal"),
    ChoiceField("defense", "守備方針", false, listOf(Choice("normal", "標準"), Choice("infield_in", "前進守備"), Choice("shift", "守備シフト")), "normal"),
)
val TACTIC_FIELDS: List<ChoiceField> = 
listOf(
    ChoiceField("sacrificeBunt", "送りバント", false, listOf(Choice("auto", "AI判断"), Choice("avoid", "控えめ"), Choice("aggressive", "積極的"), Choice("never", "しない")), "auto"),
    ChoiceField("squeeze", "スクイズ", false, listOf(Choice("auto", "AI判断"), Choice("avoid", "控えめ"), Choice("aggressive", "積極的"), Choice("never", "しない")), "auto"),
    ChoiceField("safetyBunt", "セーフティバント", false, listOf(Choice("auto", "AI判断"), Choice("avoid", "控えめ"), Choice("aggressive", "積極的"), Choice("never", "しない")), "auto"),
    ChoiceField("pinchHit", "代打", false, listOf(Choice("auto", "AI判断"), Choice("never", "使わない")), "auto"),
    ChoiceField("pinchHitFrom", "代打を使い始める回", true, listOf(Choice("0", "AI判断"), Choice("5", "5回以降"), Choice("6", "6回以降"), Choice("7", "7回以降"), Choice("8", "8回以降"), Choice("9", "9回以降")), "0"),
    ChoiceField("defensiveSub", "守備固め", false, listOf(Choice("auto", "AI判断"), Choice("never", "使わない")), "auto"),
    ChoiceField("defenseFrom", "守備固めを使い始める回", true, listOf(Choice("0", "AI判断"), Choice("7", "7回以降"), Choice("8", "8回以降"), Choice("9", "9回以降")), "0"),
    ChoiceField("hook", "先発の不調時の交代", false, listOf(Choice("auto", "標準"), Choice("early", "早めに交代"), Choice("patient", "長めに任せる")), "auto"),
    ChoiceField("starterLimit", "先発の球数上限", true, listOf(Choice("0", "役割・スタミナで判断"), Choice("60", "最大60球"), Choice("80", "最大80球"), Choice("100", "最大100球"), Choice("120", "最大120球")), "0"),
)
val STRATEGY_EFFECTS: Map<String, String> = mapOf("batting.balanced" to "能力はそのまま。", "batting.patient" to "ミート+3・パワー-5・選球眼+10。よく見て当てにいく。", "batting.aggressive" to "ミート-5・パワー+8・選球眼-5。長打を狙って強く振る。", "pitching.balanced" to "能力は変わらない。配球は捕手に任せる。", "pitching.strikeout" to "能力は変わらない。誘い球と変化球を増やし、空振りを取りにいく（四球は増える）。", "pitching.contact" to "能力は変わらない。ストライクゾーンで勝負し、ゴロを打たせる球種を選ぶ（四球は減るが打たれやすい）。", "baseRunning.normal" to "能力は変わらない。", "baseRunning.aggressive" to "能力は変わらない。盗塁を試みる回数が約1.5倍。", "baseRunning.conservative" to "能力は変わらない。盗塁を試みる回数が半分以下。", "baseRunning.never" to "盗塁しない。", "defense.normal" to "能力はそのまま。", "defense.infield_in" to "内野の守備+10・外野の守備-15。内野は打球に早く追いつくが、外野の間を抜かれやすい。", "defense.shift" to "内野の守備+5・外野の守備-10。内野の網を厚くするぶん、外野が手薄になる。")
val STARTER_ROLES: Map<String, String> = mapOf("auto_s" to "おまかせ", "ace" to "ゲームメーカー", "complete" to "完投型", "quality" to "勝ち権利型", "short" to "ショートスターター", "opener" to "オープナー")
val RELIEF_ROLES: Map<String, String> = mapOf("auto_r" to "おまかせ", "long" to "ロングリリーフ", "ace_relief" to "中継ぎエース", "setup" to "セットアッパー", "closer" to "守護神", "onepoint" to "ワンポイント", "behind" to "ビハインド", "mopup" to "敗戦処理")
val ROLE_HINT: Map<String, String> = mapOf("ace" to "7〜8回を任せる", "complete" to "スタミナの限界まで", "quality" to "5〜6回で交代", "short" to "3〜4回で継投", "opener" to "初回〜2回で継投", "auto_s" to "AIが判断", "closer" to "9回のリード", "setup" to "8回の僅差", "ace_relief" to "接戦の中盤から", "long" to "複数イニング", "onepoint" to "左打者の対策", "behind" to "負けている展開", "mopup" to "大差の敗戦処理", "auto_r" to "AIが判断")
val PHASE_LABELS: Map<String, String> = mapOf("pack_select" to "初期メンバー選択", "initial_tryout" to "初期編成", "camp" to "キャンプ", "contract" to "契約更改", "tryout" to "トライアウト", "offseason" to "年度更新")
val FORM_SHORT: Map<String, String> = mapOf("overhand" to "オーバー", "threeQuarter" to "スリクォ", "sidearm" to "サイド", "submarine" to "アンダー")
val PITCH_TYPE_NAMES: Map<String, String> = mapOf("straight" to "ストレート", "twoSeam" to "ツーシーム", "slider" to "スライダー", "curve" to "カーブ", "fork" to "フォーク", "changeup" to "チェンジアップ", "sinker" to "シンカー", "shoot" to "シュート", "cutter" to "カッター", "splitter" to "スプリッター", "palm" to "パーム", "knuckle" to "ナックル")
val RELIEF_ORDER: List<String> = listOf("closer", "setup", "ace_relief", "long", "onepoint", "behind", "mopup", "auto_r")
val STARTER_ORDER: List<String> = listOf("ace", "complete", "quality", "short", "opener", "auto_s")
const val MAX_STARTERS: Int = 8
const val RELIEF_REST_FATIGUE: Int = 50
const val STARTER_SKIP_FATIGUE: Int = 40
const val FIELDER_REST_FATIGUE: Int = 80
const val SUBSTITUTE_MIN_FITNESS: Int = 60
const val SUBSTITUTE_FRESH_FATIGUE: Int = 40
const val ROSTER_LIMIT: Int = 26
const val CAMP_ROUNDS: Int = 4
data class SeasonStep(val key: String, val label: String, val time: String, val todo: String)
val SEASON_STEPS: List<SeasonStep> = listOf(
    SeasonStep("season", "シーズン", "月〜金", "試合は自動で進みます。スタメン設定・投手起用を整えておきます。"),
    SeasonStep("postseason", "プレーオフ", "土曜の未明", "1部の上位でプレーオフを行い、今季の成績とタイトルを確定します（自動）。終わると契約更改が開きます。"),
    SeasonStep("contract", "契約更改", "土 0:00〜12:00", "来季に残さない選手を選んで「この内容で決定」を押します。決めなければ標準案で進みます。"),
    SeasonStep("tryout", "トライアウト", "土 12:00〜21:00", "空いた枠に獲りたい選手の希望リストを作って決定します。決めなければ標準案で進みます。"),
    SeasonStep("year_end", "年度更新", "自動", "加齢による伸び・衰え、引退、昇格・降格、新しい日程が入ります（決めることはありません）。結果は「オフの成長」で見られます。"),
    SeasonStep("camp", "キャンプ", "日曜", "育成方針と練習を決めて、4クールを1クールずつ実行します。終わらなかったぶんは締め切りで自動で行われます。"),
    SeasonStep("opening", "開幕", "月 0:00", "キャンプで伸びた能力を見て、スタメン設定・投手起用を整えて開幕を待ちます。"),
)
val CAMP_POLICY_GUIDE: Map<String, Pair<String, String>> = mapOf(
    "balanced:skill" to ("ミート+5 パワー+1 回復+1 肩力+1" to "制球+5 スタミナ+4 回復+1 球速+1"),
    "balanced:physique" to ("体力+12 体幹+8 走力+4 盗塁+2" to "体力+12 スタミナ+10 体幹+8 球速+4 肩力+4"),
    "sharpen:skill" to ("ミート+2 選球眼+2（いちばん高い能力に集中）" to "制球+4 守備+2"),
    "sharpen:physique" to ("体幹+8 走力+3 肩力+2 パワー+2" to "体幹+8 肩力+4 守備+3 球速+2"),
    "patch:skill" to ("ミート+3 守備+2 バント+1（いちばん低い能力を底上げ）" to "守備+4 制球+2 スタミナ+2"),
    "patch:physique" to ("体力+12 体幹+8 走力+3 盗塁+2" to "体力+12 スタミナ+10 体幹+8 球速+2 肩力+2"),
)
val ONLINE_ROSTER_TARGETS: Map<String, Int> = mapOf("pitcher" to 11, "catcher" to 2, "infielder" to 6, "outfielder" to 7)
val RETRY_ON_REVISION: Set<String> = setOf("lineup", "submit", "campRound")
data class PyramidLeague(val id: String, val name: String, val promotes: Boolean, val relegates: Boolean)
val PYRAMID_LEAGUES: List<PyramidLeague> = listOf(
    PyramidLeague("A", "1部", false, true),
    PyramidLeague("B", "2部", true, false),
)
const val PROMOTION_PLACES: Int = 1
const val RELEGATION_FROM_BOTTOM: Int = 1
val CAMP_SUB_TARGETS: Map<String, String> = mapOf("newpitch" to "pitch", "breaking" to "ownPitch", "subposition" to "position")
val CAMP_PITCH_TYPES: List<String> = listOf("slider", "curve", "fork", "changeup", "sinker", "cutter", "knuckle", "shoot")
val CONVERT_POSITIONS: List<String> = listOf("pitcher", "catcher", "first", "second", "third", "short", "left", "center", "right")
val POSITION_NAMES: Map<String, String> = mapOf("pitcher" to "投手", "catcher" to "捕手", "first" to "一塁", "second" to "二塁", "third" to "三塁", "short" to "遊撃", "left" to "左翼", "center" to "中堅", "right" to "右翼")
