// このファイルは mobile/tools/gen-tables.mjs が Web 版の表から書き出したもの。手で直さないこと。
package jp.icenorth.baseball.shared

data class Menu(val key: String, val name: String, val icon: String, val description: String, val category: String? = null, val only: String? = null)
data class Choice(val key: String, val label: String)
data class ChoiceField(val key: String, val label: String, val numeric: Boolean, val options: List<Choice>, val default: String)

val CAMP_MENUS: List<Menu> = listOf(
    Menu("batting", "打撃練習", "🏏", "ミートを強化、パワー・選球眼・バントを微増", category = "batting"),
    Menu("baserunning", "走塁練習", "🏃", "走力・盗塁・バントを強化", category = "batting"),
    Menu("fielding", "ノック", "🧤", "守備力と肩力を強化（投手野手共通）・野手は今の守備位置の適性も+4〜8/クール", category = "fielding"),
    Menu("control", "投げ込み", "🎯", "制球力を強化し、スタミナも向上（投手向け）", category = "pitching"),
    Menu("velocity", "球速練習", "🔥", "球速を強化（肩力上限・フォーム適性あり）、スタミナも微増（投手向け）", category = "pitching"),
    Menu("intensive_power", "長打集中", "💥", "パワーを集中して大きく伸ばす。伸びた分の4割を他の能力から引く代わりに、普通の練習が鈍る帯でも伸びる", category = "batting"),
    Menu("intensive_meet", "ミート集中", "🎯", "ミートを集中して大きく伸ばす。伸びた分の4割を他の能力から引く代わりに、普通の練習が鈍る帯でも伸びる", category = "batting"),
    Menu("intensive_speed", "走力集中", "⚡", "走力を集中して大きく伸ばす。伸びた分の4割を他の能力から引く代わりに、普通の練習が鈍る帯でも伸びる", category = "batting"),
    Menu("intensive_control", "制球集中", "🎯", "制球を集中して大きく伸ばす。伸びた分の4割を他の能力から引く代わりに、普通の練習が鈍る帯でも伸びる", category = "pitching"),
    Menu("intensive_velocity", "球速集中", "🔥", "球速を集中して大きく伸ばす。伸びた分の4割を他の能力から引く代わりに、普通の練習が鈍る帯でも伸びる", category = "pitching"),
    Menu("intensive_defense", "守備集中", "🛡️", "守備を集中して大きく伸ばす。伸びた分の4割を他の能力から引く代わりに、普通の練習が鈍る帯でも伸びる", category = "fielding"),
    Menu("intensive_eye", "選球眼集中", "👁️", "選球眼を集中して大きく伸ばす。伸びた分の4割を他の能力から引く代わりに、普通の練習が鈍る帯でも伸びる", category = "batting"),
)
val CAMP_SUB_MENUS: List<Menu> = listOf(
    Menu("physique", "基礎体力", "🏃", "体力+2〜4/クール確定・体幹+0〜1（投手：スタミナ+1〜2も）", only = null),
    Menu("weight", "ウエイト", "🏋️", "体幹+2〜4（60から鈍り85で止まる）・パワー+0〜1・肩力+0〜1", only = null),
    Menu("stretch", "ストレッチ", "🧘", "野手：ミート/パワー/選球眼/走力/肩/守備からランダム1能力+1。投手：制球/球速/スタミナ/肩/守備/ミートからランダム1能力+1。回復力30%UP", only = null),
    Menu("long_throw", "遠投", "🎯", "肩力を重点強化（+0〜3）投手は球速連動", only = null),
    Menu("eye", "選球眼練習", "👁️", "選球眼を強化（+0〜2）", only = null),
    Menu("clead_study", "Cリード学習", "🧠", "キャッチャーリード向上（リード+1~3）", only = "catcher"),
    Menu("breaking", "変化球練習", "🌀", "変化球レベルを強化（1球種を選んで集中練習も可）", only = "pitcher"),
    Menu("newpitch", "新球種習得", "✨", "新球種習得に挑戦（成功率22%・器用さとフォーム適性で上昇。球種は狙いを選べる・選ばなければおまかせ）", only = "pitcher"),
    Menu("spin_analysis", "スピン解析", "🎥", "高速カメラで回転を分析・スピン+1〜3、持ち球すべてのLv+1程度、制球微増（器用さで上下・投手のみ）", only = "pitcher"),
    Menu("subposition", "サブポジ練習", "🔀", "指定ポジションの適正大幅UP（器用さで伸びが変わる）・今の守備位置の適正+4〜8・守備+0〜2", only = null),
    Menu("form_change", "フォーム改造", "🔄", "投手は投球フォーム、野手は打撃フォーム（オープン/スクエア/クローズ）の変更に挑戦（成功20%・器用さで上下: 成功で能力UP / 失敗で低下。フォームは成否によらず変わる）", only = null),
    Menu("switch_hit", "打席変更", "↔️", "打席変更に挑戦（器用さで成功率が上下・失敗でミート低下リスク）", only = null),
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
    ChoiceField("restLine", "疲れた野手を休ませる目安", false, listOf(Choice("standard", "標準（疲労80から）"), Choice("early", "早め（疲労60から）"), Choice("late", "遅め（疲労100から）")), "standard"),
)
val STRATEGY_EFFECTS: Map<String, String> = mapOf("batting.balanced" to "能力は変わりません。", "batting.patient" to "ミート+3・パワー-5・選球眼+10。よく見て当てにいく。", "batting.aggressive" to "ミート-5・パワー+8・選球眼-5。長打を狙って強く振る。", "pitching.balanced" to "能力は変わりません。配球は捕手に任せる。", "pitching.strikeout" to "能力は変わりません。誘い球と変化球を増やし、空振りを取りにいく（四球は増える）。", "pitching.contact" to "能力は変わりません。ストライクゾーンで勝負し、ゴロを打たせる球種を選ぶ（四球は減るが打たれやすい）。", "baseRunning.normal" to "能力は変わりません。", "baseRunning.aggressive" to "能力は変わりません。盗塁を試みる回数が約1.5倍。", "baseRunning.conservative" to "能力は変わりません。盗塁を試みる回数が半分以下。", "baseRunning.never" to "盗塁しない。", "defense.normal" to "能力は変わりません。", "defense.infield_in" to "内野の守備+10・外野の守備-15。内野は打球に早く追いつくが、外野の間を抜かれやすい。", "defense.shift" to "内野の守備+5・外野の守備-10。内野の網を厚くするぶん、外野が手薄になる。")
val STARTER_ROLES: Map<String, String> = mapOf("auto_s" to "おまかせ", "ace" to "ゲームメーカー", "complete" to "完投型", "quality" to "勝ち権利型", "short" to "ショートスターター", "opener" to "オープナー")
val RELIEF_ROLES: Map<String, String> = mapOf("auto_r" to "おまかせ", "long" to "ロングリリーフ", "ace_relief" to "中継ぎエース", "setup" to "セットアッパー", "closer" to "クローザー", "onepoint" to "ワンポイント", "behind" to "ビハインド", "mopup" to "敗戦処理")
val ROLE_HINT: Map<String, String> = mapOf("ace" to "7〜8回を任せる", "complete" to "スタミナの限界まで", "quality" to "5〜6回で交代", "short" to "3〜4回で継投", "opener" to "初回〜2回で継投", "auto_s" to "AIが判断", "closer" to "9回のリード", "setup" to "8回の僅差", "ace_relief" to "接戦の中盤から", "long" to "複数イニング", "onepoint" to "左打者の対策", "behind" to "負けている展開", "mopup" to "大差の敗戦処理", "auto_r" to "AIが判断")
val PHASE_LABELS: Map<String, String> = mapOf("pack_select" to "初期メンバー選択", "initial_tryout" to "初期編成", "camp" to "キャンプ", "contract" to "契約更改", "tryout" to "トライアウト", "offseason" to "年度更新")
val FORM_SHORT: Map<String, String> = mapOf("overhand" to "オーバー", "threeQuarter" to "スリクォ", "sidearm" to "サイド", "submarine" to "アンダー")
val BATS_SHORT: Map<String, String> = mapOf("right" to "右打", "left" to "左打", "switch" to "両打")
val PITCH_TYPE_NAMES: Map<String, String> = mapOf("straight" to "ストレート", "twoSeam" to "ツーシーム", "slider" to "スライダー", "curve" to "カーブ", "fork" to "フォーク", "changeup" to "チェンジアップ", "sinker" to "シンカー", "shoot" to "シュート", "cutter" to "カッター", "splitter" to "スプリッター", "palm" to "パーム", "knuckle" to "ナックル")
val RELIEF_ORDER: List<String> = listOf("closer", "setup", "ace_relief", "long", "onepoint", "behind", "mopup", "auto_r")
val STARTER_ORDER: List<String> = listOf("ace", "complete", "quality", "short", "opener", "auto_s")
const val MAX_STARTERS: Int = 8
const val RELIEF_REST_FATIGUE: Int = 50
const val STARTER_SKIP_FATIGUE: Int = 40
const val FIELDER_REST_FATIGUE: Int = 80
const val FIELDER_FORCE_REST_FATIGUE: Int = 120
const val SUBSTITUTE_MIN_FITNESS: Int = 60
const val SUBSTITUTE_FRESH_FATIGUE: Int = 40
const val ROSTER_LIMIT: Int = 28
const val ROSTER_STANDARD: Int = 26
const val CAMP_ROUNDS: Int = 4
val REST_LINES: Map<String, Int> = mapOf("standard" to 80, "early" to 60, "late" to 100)
/** その球団の休ませる目安の疲労（Web 版 shared.js の restFatigueOf） */
fun restFatigueOf(restLine: String?): Int = REST_LINES[restLine] ?: FIELDER_REST_FATIGUE
data class SeasonStep(val key: String, val label: String, val time: String, val todo: String)
val SEASON_STEPS: List<SeasonStep> = listOf(
    SeasonStep("season", "シーズン", "月〜金", "試合は自動で進みます。スタメン設定・投手起用を整えておきます。"),
    SeasonStep("postseason", "プレーオフ", "土曜の未明", "1部の上位でプレーオフを行い、今季の成績とタイトルを確定します（自動）。終わると契約更改が開きます。"),
    SeasonStep("contract", "契約更改", "土 0:00〜12:00", "来季に残さない選手を選んで「この内容で決定」を押します。決めなければ標準案で進みます。"),
    SeasonStep("tryout", "トライアウト", "土 12:00〜21:00", "空いた枠に獲りたい選手の希望リストを作って決定します。決めなければ標準案で進みます。"),
    SeasonStep("year_end", "年度更新", "自動", "加齢による伸び・衰え、引退、昇格・降格、新しい日程が入ります（決めることはありません）。順位・入退団・主なトピックは「その年のまとめ」で見られます。"),
    SeasonStep("camp", "キャンプ", "日曜", "育成方針と練習を決めて、4クールを1クールずつ実行します。終わらなかったぶんは締め切りで自動で行われます。"),
    SeasonStep("opening", "開幕", "月 0:00", "キャンプで伸びた能力を見て、スタメン設定・投手起用を整えて開幕を待ちます。"),
)
val CAMP_POLICY_GUIDE: Map<String, Pair<String, String>> = mapOf(
    "balanced:skill" to ("選球眼+2 ミート+2 パワー+1 回復+1" to "スタミナ+5 制球+1 回復+1 肩力+1 球速+1"),
    "balanced:physique" to ("体力+12 体幹+2 盗塁+2 バント+1" to "体力+12 スタミナ+10 体幹+2 球速+2"),
    "sharpen:skill" to ("ミート+2 選球眼+1 守備+1（いちばん高い能力に集中）" to "制球+2 守備+2"),
    "sharpen:physique" to ("体幹+12 パワー+2 肩力+2 盗塁+2" to "体幹+12 肩力+2 球速+2 守備+2 スタミナ+1"),
    "patch:skill" to ("守備+2 盗塁+1 選球眼+1 ミート+1・守備位置の適性（いちばん低い能力を底上げ）" to "守備+3 スタミナ+2"),
    "patch:physique" to ("体力+12 盗塁+2 体幹+2 バント+1" to "体力+12 スタミナ+9 体幹+2 球速+1"),
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
val CAMP_SUB_TARGETS: Map<String, String> = mapOf("newpitch" to "pitch", "breaking" to "ownPitch", "subposition" to "position", "form_change" to "form", "switch_hit" to "bats")
val CAMP_PITCH_TYPES: List<String> = listOf("slider", "curve", "fork", "changeup", "sinker", "cutter", "knuckle", "shoot")
val CONVERT_POSITIONS: List<String> = listOf("pitcher", "catcher", "first", "second", "third", "short", "left", "center", "right")
val CAMP_TARGET_REQUIRED: List<String> = listOf("form", "stance", "bats")
val CAMP_STANCES: List<String> = listOf("open", "square", "closed")
val CAMP_FORMS: List<String> = listOf("overhand", "threeQuarter", "sidearm", "submarine")
val CAMP_BATS: List<String> = listOf("right", "left", "switch")
val POSITION_NAMES: Map<String, String> = mapOf("pitcher" to "投手", "catcher" to "捕手", "first" to "一塁", "second" to "二塁", "third" to "三塁", "short" to "遊撃", "left" to "左翼", "center" to "中堅", "right" to "右翼")
const val TRADE_NOTE_MAX: Int = 100
const val OWNER_COMMENT_MAX: Int = 40
const val CHALLENGE_NOTE_MAX: Int = 60
const val AWAY_DAYS: Int = 3
const val STARTER_LOCK_TURNS: Int = 3
const val STARTER_PICK_GAMES: Int = 6
const val EXHIBITIONS_PER_DAY: Int = 1
const val SEASON_TURNS: Int = 160
const val SEASON_START_MONTH: Int = 4
val POSITION_LABELS: Map<String, String> = mapOf("pitcher" to "投", "catcher" to "捕", "first" to "一", "second" to "二", "third" to "三", "short" to "遊", "left" to "左", "center" to "中", "right" to "右")
val STATUS_LABELS: Map<String, String> = mapOf("running" to "進行中", "waiting" to "決定待ち", "paused" to "一時停止", "error" to "要確認・停止中")
const val TEAMS_PER_LEAGUE: Int = 6
const val TRYOUT_WISH_MAX: Int = 20
/** 能力の一言の説明（何に・どう効くか）。Web 版 src/online/playerInfo.js の ABILITY_HELP */
val ABILITY_HELP: Map<String, String> = linkedMapOf(
    "ミート" to "ボールに当てる力。安打の出やすさに効く。",
    "パワー" to "打球の強さ。長打と本塁打に効く。",
    "選球眼" to "ボール球を見送る力。四球と三振に効く。",
    "走力" to "足の速さ。内野安打・走塁・盗塁と、守備の範囲に効く。",
    "盗塁技術" to "盗塁の成功しやすさ。",
    "バント" to "バントの決まりやすさ。",
    "打者型" to "能力から決まる待ち方の型。相手投手の配球の読み合いに使われる。",
    "球速" to "速いほど打者が振り遅れる。疲れやスタミナ切れで落ちる。",
    "制球" to "狙ったコースに投げる力。四球と甘い球の出やすさに効く。",
    "スタミナ" to "1試合で投げられる量。減るほど球速と制球が落ちる。",
    "回転" to "直球のノビと変化球のキレ。高いほど球種の実際の効きが上がる。",
    "出どころ" to "球の見えにくさ。打者がタイミングを取りにくく、球種も見分けにくい。生まれつきで変わらない。",
    "打撃フォーム" to "オープン・スクエア・クローズの3つ。オープンは内角が得意で外角が苦手、クローズはその逆、スクエアは偏りなし。体格も同じ向きに効く（小柄は内角・大柄は外角が得意）。キャンプの「フォーム改造」で変えられる（成功率は器用さで上下し、成否にかかわらずフォームは変わる）。苦手を消すか、得意を伸ばすかの選択。",
    "フォーム" to "球速の出方（オーバー1.00倍〜アンダー0.92倍）と、球速・制球の伸びやすさが変わる。",
    "守備" to "打球の処理のうまさ。失策と、捕れる範囲に効く。",
    "肩力" to "送球の強さ。外野からの返球・内野の送球・捕手の盗塁阻止に効く。",
    "捕手リード" to "配球のうまさ。球種の選び方と失投の少なさに効く。制球の良い投手には際どいコースを多く求める。",
    "体力" to "疲れにくさ。野手は3打席以上出た日の疲れが体力80で12・50で15・20で27（50を下回ると急に増える）、投手は球数あたりの疲れが減る。休んだ日の回復量にも掛かる。目安は体力80で休まず全試合、50で10数試合に1回、20で1試合ごとに休み。",
    "回復" to "休んだ日に疲れが抜ける量。野手は「体力×25〜85%」、投手は0.7〜1.3倍。",
    "精神力" to "得点圏に走者がいるときだけ効く。打者はミート・パワー、投手は制球が「(精神力−50)÷10」だけ上下する。",
    "体幹" to "パワー・肩力・走力・球速・体力の伸びやすさ（0.5〜1.5倍。50で等倍）。試合には効かない。",
    "器用さ" to "ミート・選球眼・守備・制球・盗塁・バントの伸びやすさ（0.5〜1.5倍）。フォーム改造・新球種・両打ち・別の守備位置の覚えやすさにも効く。試合には効かない。",
    "プロ意識" to "キャンプの伸び（0.5〜1.5倍）、覚醒の起きやすさ（30未満は起きない）、キャンプの伸びが止まる年齢（80で+1歳、100で+2歳）、年度替わりの自然成長の山の位置（50が基準。上は10ごとに0.5歳遅く＝100で2.5歳遅く、下は10ごとに1.15歳早く＝20で3.5歳早く衰え始める）。試合には効かない。",
    "成長係数" to "能力の伸びやすさの素（0.30〜1.80・年齢を含まない）。出場で積み・疲れたまま出ると削れる変動こみ。年度替わりの年齢曲線を0.1ごとに0.8歳ずらす（1.4なら3.2歳うしろ）ほか、キャンプの伸び（0.7＋0.3×係数）と、キャンプの伸びが止まる年齢（1.0で26歳・1.4で32歳）を決める。",
    "自然成長" to "年度替わりに、練習しなくても自然に動く分（主な能力1つあたり・1年）。+1.00なら主な能力が平均1上がり、0.00で横ばい、マイナスは衰え。高卒から23〜25歳まで上がって山になり、26歳から徐々に下がって30代前半で0を割る。素質が高い・プロ意識が高い・試合に出て大事に使われている選手は、この山が後ろにずれて長持ちする。キャンプの伸びはこれとは別に乗る。",
    "守備適性" to "その位置で守ると、守備・走力・肩力が「0.5＋適性÷200」倍で効く（100で等倍、60で0.8倍）。",
)
const val BATTERY_MIN_OUTS: Int = 90
val BATTERY_NOTE: String = "30回未満の組は薄く出しています。回数が少ないうちは運の差が大きく出ます。読まれ率は、打者に狙い球を当てられた球の割合で、低いほどリードが効いています。"
/** 選手成績の表の区分と列（Web 版 src/online/statsView.js の STAT_GROUPS.batting） */
val BATTING_GROUPS: List<StatGroup> = listOf(
    StatGroup(
        "basic", "基本",
        listOf(
            StatColumn("avg", "打率", StatFormat.Rate, false, statMetric("batting", "avg")),
            StatColumn("homeruns", "本塁打", StatFormat.Count, false, statRaw("batting", "homeruns")),
            StatColumn("rbis", "打点", StatFormat.Count, false, statRaw("batting", "rbis")),
            StatColumn("stolenBases", "盗塁", StatFormat.Count, false, statRaw("batting", "stolenBases")),
        ),
    ),
    StatGroup(
        "appearances", "出場・安打",
        listOf(
            StatColumn("games", "試合", StatFormat.Count, false, statRaw("batting", "games")),
            StatColumn("pa", "打席", StatFormat.Count, false, statMetric("batting", "pa")),
            StatColumn("atBats", "打数", StatFormat.Count, false, statRaw("batting", "atBats")),
            StatColumn("hits", "安打", StatFormat.Count, false, statRaw("batting", "hits")),
        ),
    ),
    StatGroup(
        "extra", "長打",
        listOf(
            StatColumn("doubles", "二塁打", StatFormat.Count, false, statRaw("batting", "doubles")),
            StatColumn("triples", "三塁打", StatFormat.Count, false, statRaw("batting", "triples")),
            StatColumn("homeruns", "本塁打", StatFormat.Count, false, statRaw("batting", "homeruns")),
            StatColumn("slg", "長打率", StatFormat.Rate, false, StatComputed.slg),
        ),
    ),
    StatGroup(
        "discipline", "四死球・犠打",
        listOf(
            StatColumn("walks", "四球", StatFormat.Count, false, statRaw("batting", "walks")),
            StatColumn("hitByPitch", "死球", StatFormat.Count, false, statRaw("batting", "hitByPitch")),
            StatColumn("strikeouts", "三振", StatFormat.Count, true, statRaw("batting", "strikeouts")),
            StatColumn("sacrificeBunts", "犠打", StatFormat.Count, false, statRaw("batting", "sacrificeBunts")),
        ),
    ),
    StatGroup(
        "sacrifices", "犠打飛・守備補助",
        listOf(
            StatColumn("sacrificeBunts", "犠打", StatFormat.Count, false, statRaw("batting", "sacrificeBunts")),
            StatColumn("sacrificeFlies", "犠飛", StatFormat.Count, false, statRaw("batting", "sacrificeFlies")),
            StatColumn("hitByPitch", "死球", StatFormat.Count, false, statRaw("batting", "hitByPitch")),
            StatColumn("assists", "捕殺", StatFormat.Count, false, statRaw("batting", "assists")),
        ),
    ),
    StatGroup(
        "running", "走塁",
        listOf(
            StatColumn("stolenBases", "盗塁", StatFormat.Count, false, statRaw("batting", "stolenBases")),
            StatColumn("caughtStealing", "盗塁死", StatFormat.Count, true, statRaw("batting", "caughtStealing")),
            StatColumn("stealRate", "成功率", StatFormat.Percent, false, statMetric("batting", "stealRate")),
            StatColumn("stealAttempts", "企図", StatFormat.Count, false, statMetric("batting", "stealAttempts")),
        ),
    ),
    StatGroup(
        "sabers", "打撃指標",
        listOf(
            StatColumn("ops", "OPS", StatFormat.Rate, false, StatComputed.ops),
            StatColumn("obp", "出塁率", StatFormat.Rate, false, statMetric("batting", "obp")),
            StatColumn("slg", "長打率", StatFormat.Rate, false, StatComputed.slg),
            StatColumn("iso", "ISO", StatFormat.Rate, false, statMetric("batting", "iso")),
        ),
    ),
    StatGroup(
        "rates", "打席率",
        listOf(
            StatColumn("kRate", "K%", StatFormat.Percent, true, statMetric("batting", "kRate")),
            StatColumn("bbRate", "BB%", StatFormat.Percent, false, statMetric("batting", "bbRate")),
            StatColumn("hrRate", "本塁打率", StatFormat.Percent, false, statMetric("batting", "hrRate")),
            StatColumn("ops", "OPS", StatFormat.Rate, false, StatComputed.ops),
        ),
    ),
    StatGroup(
        "fielding", "守備",
        listOf(
            StatColumn("fieldingChances", "機会", StatFormat.Count, false, statRaw("batting", "fieldingChances")),
            StatColumn("errors", "失策", StatFormat.Count, true, statRaw("batting", "errors")),
            StatColumn("fieldRate", "守備率", StatFormat.Rate, false, StatComputed.fieldRate),
            StatColumn("games", "試合", StatFormat.Count, false, statRaw("batting", "games")),
        ),
    ),
    StatGroup(
        "catching", "捕手",
        listOf(
            StatColumn("caughtOuts", "守備回", StatFormat.Innings, false, statCaught("outs")),
            StatColumn("catcherEra", "防御率", StatFormat.Decimal, true, statCaught("era")),
            StatColumn("readRate", "読まれ率", StatFormat.Percent, true, statCaught("readRate")),
            StatColumn("catcherStarts", "先発", StatFormat.Count, false, statCaught("starts")),
        ),
    ),
    StatGroup(
        "catchingAllowed", "捕手・被打撃",
        listOf(
            StatColumn("catcherK9", "K/9", StatFormat.Decimal, false, statCaught("k9")),
            StatColumn("catcherBb9", "BB/9", StatFormat.Decimal, true, statCaught("bb9")),
            StatColumn("catcherAvg", "被打率", StatFormat.Rate, true, statCaught("avg")),
            StatColumn("catching:lead", "リード", StatFormat.Ability, false, statField("catching", "lead")),
        ),
    ),
    StatGroup(
        "state", "調子・疲労",
        listOf(
            StatColumn("condition", "調子", StatFormat.Condition, false, StatComputed.condition),
            StatColumn("fatigue", "疲労", StatFormat.Count, true, statField("fatigue")),
            StatColumn("age", "年齢", StatFormat.Count, false, statField("age")),
            StatColumn("physical:speed", "走力", StatFormat.Ability, false, statField("physical", "speed")),
        ),
    ),
    StatGroup(
        "abilities", "打撃能力",
        listOf(
            StatColumn("batting:meet", "ミート", StatFormat.Ability, false, statField("batting", "meet")),
            StatColumn("batting:power", "パワー", StatFormat.Ability, false, statField("batting", "power")),
            StatColumn("batting:eye", "選球眼", StatFormat.Ability, false, statField("batting", "eye")),
            StatColumn("physical:speed", "走力", StatFormat.Ability, false, statField("physical", "speed")),
        ),
    ),
    StatGroup(
        "defense", "守備能力",
        listOf(
            StatColumn("fielding:defense", "守備", StatFormat.Ability, false, statField("fielding", "defense")),
            StatColumn("physical:arm", "肩力", StatFormat.Ability, false, statField("physical", "arm")),
            StatColumn("catching:lead", "リード", StatFormat.Ability, false, statField("catching", "lead")),
            StatColumn("physical:recovery", "回復", StatFormat.Ability, false, statField("physical", "recovery")),
        ),
    ),
)
/** 選手成績の表の区分と列（Web 版 src/online/statsView.js の STAT_GROUPS.pitching） */
val PITCHING_GROUPS: List<StatGroup> = listOf(
    StatGroup(
        "basic", "基本",
        listOf(
            StatColumn("era", "防御率", StatFormat.Decimal, true, statMetric("pitching", "era")),
            StatColumn("outs", "投球回", StatFormat.Innings, false, statRaw("pitching", "inningsPitched")),
            StatColumn("strikeouts", "奪三振", StatFormat.Count, false, statRaw("pitching", "strikeouts")),
            StatColumn("walks", "四球", StatFormat.Count, true, statRaw("pitching", "walks")),
        ),
    ),
    StatGroup(
        "record", "登板・勝敗",
        listOf(
            StatColumn("games", "登板", StatFormat.Count, false, statRaw("pitching", "games")),
            StatColumn("wins", "勝利", StatFormat.Count, false, statRaw("pitching", "wins")),
            StatColumn("losses", "敗戦", StatFormat.Count, true, statRaw("pitching", "losses")),
            StatColumn("saves", "セーブ", StatFormat.Count, false, statRaw("pitching", "saves")),
        ),
    ),
    StatGroup(
        "usage", "先発・対戦打者",
        listOf(
            StatColumn("gamesStarted", "先発", StatFormat.Count, false, statRaw("pitching", "gamesStarted")),
            StatColumn("battersFaced", "対戦打者", StatFormat.Count, false, statRaw("pitching", "battersFaced")),
            StatColumn("hitBatters", "死球", StatFormat.Count, true, statRaw("pitching", "hitBatters")),
            StatColumn("wildPitches", "暴投", StatFormat.Count, true, statRaw("pitching", "wildPitches")),
        ),
    ),
    StatGroup(
        "relief", "救援",
        listOf(
            StatColumn("holds", "ホールド", StatFormat.Count, false, statRaw("pitching", "holds")),
            StatColumn("saves", "セーブ", StatFormat.Count, false, statRaw("pitching", "saves")),
            StatColumn("outs", "投球回", StatFormat.Innings, false, statRaw("pitching", "inningsPitched")),
            StatColumn("pitches", "投球数", StatFormat.Count, false, statRaw("pitching", "pitches")),
        ),
    ),
    StatGroup(
        "allowed", "被打撃・失点",
        listOf(
            StatColumn("hits", "被安打", StatFormat.Count, true, statRaw("pitching", "hits")),
            StatColumn("homeruns", "被本塁打", StatFormat.Count, true, statRaw("pitching", "homeruns")),
            StatColumn("runsAllowed", "失点", StatFormat.Count, true, statRaw("pitching", "runsAllowed")),
            StatColumn("earnedRuns", "自責点", StatFormat.Count, true, statRaw("pitching", "earnedRuns")),
        ),
    ),
    StatGroup(
        "quality", "先発・球数",
        listOf(
            StatColumn("qualityStarts", "QS", StatFormat.Count, false, statRaw("pitching", "qualityStarts")),
            StatColumn("highQualityStarts", "HQS", StatFormat.Count, false, statRaw("pitching", "highQualityStarts")),
            StatColumn("pitches", "投球数", StatFormat.Count, false, statRaw("pitching", "pitches")),
            StatColumn("outs", "投球回", StatFormat.Innings, false, statRaw("pitching", "inningsPitched")),
        ),
    ),
    StatGroup(
        "sabers", "投球指標",
        listOf(
            StatColumn("whip", "WHIP", StatFormat.Decimal, true, StatComputed.whip),
            StatColumn("kbb", "K/BB", StatFormat.Decimal, false, StatComputed.kbb),
            StatColumn("k9", "K/9", StatFormat.Decimal, false, statMetric("pitching", "k9")),
            StatColumn("bb9", "BB/9", StatFormat.Decimal, true, statMetric("pitching", "bb9")),
        ),
    ),
    StatGroup(
        "rates", "9回換算",
        listOf(
            StatColumn("k9", "K/9", StatFormat.Decimal, false, statMetric("pitching", "k9")),
            StatColumn("bb9", "BB/9", StatFormat.Decimal, true, statMetric("pitching", "bb9")),
            StatColumn("hr9", "被本/9", StatFormat.Decimal, true, statMetric("pitching", "hr9")),
            StatColumn("era", "防御率", StatFormat.Decimal, true, statMetric("pitching", "era")),
        ),
    ),
    StatGroup(
        "state", "調子・疲労",
        listOf(
            StatColumn("condition", "調子", StatFormat.Condition, false, StatComputed.condition),
            StatColumn("fatigue", "疲労", StatFormat.Count, true, statField("fatigue")),
            StatColumn("age", "年齢", StatFormat.Count, false, statField("age")),
            StatColumn("pitching:velocity", "球速", StatFormat.Velocity, false, statField("pitching", "velocity")),
        ),
    ),
    StatGroup(
        "abilities", "投球能力",
        listOf(
            StatColumn("pitching:velocity", "球速", StatFormat.Velocity, false, statField("pitching", "velocity")),
            StatColumn("pitching:control", "制球", StatFormat.Ability, false, statField("pitching", "control")),
            StatColumn("pitching:stamina", "スタミナ", StatFormat.Stamina, false, statField("pitching", "stamina")),
            StatColumn("pitching:spinRate", "回転", StatFormat.Ability, false, statField("pitching", "spinRate")),
        ),
    ),
)
val OVERVIEW_BATTING_IDS: List<String> = listOf("games", "pa", "avg", "homeruns", "rbis", "stolenBases", "obp", "slg", "ops", "strikeouts", "walks", "sacrificeBunts")
const val DEFAULT_SORT_BATTING: String = "pa"
val OVERVIEW_PITCHING_IDS: List<String> = listOf("games", "era", "wins", "losses", "saves", "holds", "outs", "strikeouts", "walks", "k9", "bb9", "whip")
const val DEFAULT_SORT_PITCHING: String = "outs"
/** 能力で絞り込む条件に使える能力（Web 版 src/online/tryoutPlan.js の ABILITY_FILTERS） */
val ABILITY_FILTERS: List<AbilityFilterDef> = listOf(
    AbilityFilterDef("meet", "ミート", "fielder", "", filterField("batting", "meet")),
    AbilityFilterDef("power", "パワー", "fielder", "", filterField("batting", "power")),
    AbilityFilterDef("eye", "選球眼", "fielder", "", filterField("batting", "eye")),
    AbilityFilterDef("speed", "走力", "fielder", "", filterField("physical", "speed")),
    AbilityFilterDef("arm", "肩力", "fielder", "", filterField("physical", "arm")),
    AbilityFilterDef("defense", "守備", "fielder", "", filterField("fielding", "defense")),
    AbilityFilterDef("velocity", "球速", "pitcher", "km/h", filterField("pitching", "velocity")),
    AbilityFilterDef("control", "制球", "pitcher", "", filterField("pitching", "control")),
    AbilityFilterDef("stamina", "スタミナ", "pitcher", "", filterField("pitching", "stamina")),
    AbilityFilterDef("spin", "回転", "pitcher", "", filterField("pitching", "spinRate")),
    AbilityFilterDef("breaking", "変化球（最高）", "pitcher", "", AbilityFilterComputed.breaking),
)
const val ABILITY_FILTER_MAX: Int = 4
data class FielderGroup(val id: String, val label: String, val positions: List<String>)
val FIELDER_GROUPS: List<FielderGroup> = listOf(
    FielderGroup("catcher", "捕手", listOf("catcher")),
    FielderGroup("infield", "内野手", listOf("first", "second", "third", "short")),
    FielderGroup("outfield", "外野手", listOf("left", "center", "right")),
)
val ABILITY_RANKS: List<Pair<Int, Char>> = listOf(90 to 'S', 80 to 'A', 70 to 'B', 60 to 'C', 50 to 'D', 40 to 'E', 0 to 'F')
const val FATIGUE_WARN_FROM: Int = 41
const val FATIGUE_HEAVY_FROM: Int = 81
val CONDITION_ICONS: Map<Int, String> = mapOf(0 to "😰", 1 to "😞", 2 to "😐", 3 to "😊", 4 to "🔥")
val CONDITION_TEXT: List<String> = listOf("絶不調", "不調", "普通", "好調", "絶好調")
/** 球団ロゴの図形（100×100 の箱。2つ目は線だけで重ねる模様）。Web 版 `LOGO_SHAPES` */
val LOGO_SHAPES: Map<String, Pair<String, String?>> = mapOf(
    "circle" to ("M50 3A47 47 0 1 1 49.99 3Z" to null),
    "shield" to ("M50 4L90 16Q90 64 50 96Q10 64 10 16Z" to null),
    "diamond" to ("M50 3L97 50L50 97L3 50Z" to null),
    "hex" to ("M50 3L90.7 26.5L90.7 73.5L50 97L9.3 73.5L9.3 26.5Z" to null),
    "plate" to ("M12 6H88V56L50 95L12 56Z" to null),
    "oval" to ("M2 50A48 35 0 1 1 98 50A48 35 0 1 1 2 50Z" to null),
    "seal" to ("M50 2L56.65 8.02L64.83 4.35L69.29 12.13L78.21 11.17L80.05 19.95L88.83 21.79L87.87 30.71L95.65 35.17L91.98 43.35L98 50L91.98 56.65L95.65 64.83L87.87 69.29L88.83 78.21L80.05 80.05L78.21 88.83L69.29 87.87L64.83 95.65L56.65 91.98L50 98L43.35 91.98L35.17 95.65L30.71 87.87L21.79 88.83L19.95 80.05L11.17 78.21L12.13 69.29L4.35 64.83L8.02 56.65L2 50L8.02 43.35L4.35 35.17L12.13 30.71L11.17 21.79L19.95 19.95L21.79 11.17L30.71 12.13L35.17 4.35L43.35 8.02Z" to null),
    "square" to ("M16 6H84Q94 6 94 16V84Q94 94 84 94H16Q6 94 6 84V16Q6 6 16 6Z" to null),
    "pennant" to ("M4 16L97 50L4 84Z" to null),
    "banner" to ("M3 39H97L90 50L97 61H3L10 50Z" to null),
    "swoosh" to ("M4 54Q48 40 96 44Q62 50 34 62Q20 60 4 54Z" to null),
    "bat" to ("M47.6 95h4.8v-3.4h-1.1L52.7 42Q55.2 22 54.6 10Q54 3.5 50 3.5Q46 3.5 45.4 10Q44.8 22 47.3 42L48.7 91.6h-1.1Z" to null),
    "star" to ("M50 2L61.46 34.22L95.65 35.17L68.55 56.03L78.21 88.83L50 69.5L21.79 88.83L31.45 56.03L4.35 35.17L38.54 34.22Z" to null),
    "ball" to ("M50 3A47 47 0 1 1 49.99 3Z" to "M22 13Q40 50 22 87M78 13Q60 50 78 87"),
)
/** ロゴの字の送り幅（0x20〜0x7E。1000分のいくつ）。字から測らずこの数で決める（Web 版 `charWidth`） */
val LOGO_CHAR_WIDTHS: Map<String, List<Int>> = mapOf(
    "graduate" to listOf(350, 260, 400, 650, 650, 940, 674, 240, 352, 352, 467, 650, 200, 509, 200, 392, 650, 650, 650, 650, 650, 650, 650, 650, 650, 650, 200, 200, 650, 650, 650, 519, 950, 657, 684, 600, 690, 636, 596, 620, 792, 392, 540, 669, 556, 946, 812, 650, 624, 650, 699, 600, 580, 740, 687, 1026, 649, 607, 596, 352, 392, 352, 650, 621, 423, 657, 684, 600, 690, 636, 596, 620, 792, 392, 540, 669, 556, 946, 812, 650, 624, 650, 699, 600, 580, 740, 687, 1026, 649, 607, 596, 352, 317, 352, 650),
    "alfa" to listOf(300, 339, 356, 732, 684, 885, 828, 193, 374, 374, 409, 576, 245, 389, 244, 423, 732, 522, 649, 623, 694, 651, 693, 648, 700, 693, 244, 245, 499, 495, 499, 630, 1148, 806, 775, 722, 804, 713, 632, 782, 840, 420, 666, 835, 653, 1143, 942, 792, 738, 810, 800, 674, 780, 781, 786, 1207, 800, 776, 689, 325, 424, 325, 413, 600, 403, 615, 662, 562, 658, 594, 384, 654, 696, 346, 313, 678, 350, 1042, 696, 632, 658, 652, 527, 519, 451, 686, 651, 956, 636, 632, 568, 299, 255, 299, 618),
    "yellowtail" to listOf(208, 327, 338, 543, 434, 667, 451, 191, 366, 366, 366, 415, 238, 317, 232, 378, 427, 228, 376, 411, 439, 388, 411, 342, 400, 399, 338, 343, 342, 429, 342, 536, 718, 587, 684, 568, 785, 602, 581, 632, 750, 280, 642, 717, 721, 772, 647, 638, 722, 680, 733, 668, 567, 740, 668, 896, 589, 665, 615, 366, 378, 366, 500, 385, 400, 407, 373, 365, 412, 317, 360, 418, 393, 203, 221, 368, 258, 608, 391, 366, 391, 409, 349, 368, 215, 396, 364, 554, 371, 390, 359, 439, 375, 439, 387),
)
const val LOGO_OTHER_ASCII_WIDTH: Int = 620
const val LOGO_TEXT_UNIT: Double = 40.0
const val LOGO_ARC_GAP: Double = 1.14
val LOGO_BOX: List<Double> = listOf(-4.0, -4.0, 108.0, 108.0)
const val LOGO_MINI_SIZE: Int = 32
const val LOGO_MAX_LAYERS: Int = 8
const val LOGO_MINI_MAX_LAYERS: Int = 4
const val LOGO_WHITE: String = "#ffffff"
const val LOGO_INK: String = "#14161c"
