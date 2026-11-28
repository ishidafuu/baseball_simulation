// ============================================================
// キャンプ練習システム
// メイン練習・サブ練習・チーム一括実行
//
// ⚠ **一人用とオンラインで同じ表・同じ式を使う**。2026-11-20 の調整（新球種の取得率・
//    ウエイトと基礎体力の役・覚醒の抑え・ノックの守備1.5倍）はオンラインの要望から入ったが、
//    一人用にも同じく効かせる（いしだ 2026-11-21「判断はおすすめで」。分けると同じ練習の
//    説明文が2通りになり、画面の説明とずれる）。数字を変えるときは両方に効くことを前提に
// ============================================================

import { PHYSICAL_STATS, getAgeGrowthBase, getStatPath, getStatName, getNestedValue, setNestedValue, physiqueMultFor, dexterityMult, dexterityShift } from './growthUtils.js';
import { PITCHING_FORM_EFFECTS, FORM_PITCH_SYNERGY, getPitchTypeName, FORM_SHORT, BATS_SHORT, ABILITY_CAP, ALL_PITCH_TYPES } from '../utils/constants.js';
import { syncPositionToFitness, getVelocityCap, getVelocityCatchupMult } from '../utils/physics.js';
// ⚠ **確率的丸め**。年次成長（`growthSystem`）と同じものを使う（二重に書かない）
import { stochasticRound, dampBreakingGain } from './growthSystem.js';
// 打撃フォーム（オープン/スクエア/クローズ）。得意ゾーンへの効き目は `batterZone.js` が持つ
import { BATTING_STANCES, battingStanceOf } from '../game/batterZone.js';

/**
 * 覚えられる変化球（直球は除く）。
 * ⚠ **ここが正本**。オンラインの画面は `CAMP_PITCH_TYPES`（`src/online/shared.js`）
 *    から読むが、中身はこの表を再輸出しているだけ。二重に書かないこと——
 *    片方に球種を足すと「選べるのに覚えられない」か「覚えられるのに選べない」になる。
 */
export const PITCH_TYPES = [
  'slider',
  'curve',
  'fork',
  'changeup',
  'sinker',
  'cutter',
  'knuckle',
  'shoot',
];

// ============================================================
// 【集中練習】いしだ 2026-11-25
//   「普通の練習と、集中練習のトータルは同じにしてほしいです。
//     しかし、能力が育ち頭打ちになったところで集中練習をすることで
//     個性を伸ばしやすい設定にしたいのです」
//
// ⚠ 直す前は**要望の真逆**だった（実測。24歳・意識60・器用50・他の技術系も同じ値に
//    そろえた400人・4クール。「合計」はスタミナと球速を除く0〜99の能力の増減の総和）:
//      ミートの帯 35: 打撃練習 合計+4.58 / ミート集中 合計+1.59（対象で勝つ差 +3.13）
//                 80: 打撃練習 合計+0.78 / ミート集中 合計**-1.96**（差 +0.67）
//    ・**トータルが揃っていない**。集中はいつも満遍なくより少なく、高い帯では**負**。
//      代償が固定（-1×本数で4クール -3.0 前後）なのに、伸びは頭打ちで小さくなるから。
//    ・**頭打ちで集中の優位が消える**。対象の伸びに高能力値減衰が掛かり、集中は
//      全部を1能力に注ぐのでその減衰を丸ごと受ける。満遍なくは4能力に散るので
//      1つが高くても他で稼げる。だから差は低い帯で最大・頭打ちで最小だった。
//
// 直した形は3つ組。
//   (1) 代償を**対象の伸びの割合**にする（`INTENSIVE_COST`）。固定をやめるので
//       「集中の合計 = 対象の伸び ×(1 - 割合)」が**帯に依らず**成り立つ。
//       伸びが0なら代償も0＝「減点だけ受ける」が構造的に起きない
//       （だから `INTENSIVE_PENALTY_FLOOR`（代償が出たクールは最低+1）は**落とした**。
//        あれはリスクを直接打ち消していた）。
//   (2) `INTENSIVE_FOCUS` を較正して、集中の差し引きを満遍なくの合計と同じ水準に置く。
//       ⚠ 能力ごとの抑え（`batGrowthMult`・制球の `focusStatMult`）は集中では**掛けない**。
//          あれはリーグの流れを抑えるための調整で、メニューごとに差し引きが変わってしまう。
//          いしだの選び「物差しの違う能力は予算の外／集中の差し引きはどのメニューも同じ水準」。
//          才能の抑え（`TALENT_STAT_MULTIPLIERS`。走力0.4・肩0.3・パワー0.5・球速0.8）は
//          **残す**（「練習だけでは伸びない能力」は設計の軸で、何度も確かめられている）。
//   (3) 集中のときだけ対象の天井を**別の形**にする（`highStatDamp` の `intensive`）。
//       これが「頭打ちになったところで個性を伸ばす」の実体。詳しくはその関数の注。
//       ⚠ **減衰を一律に緩めるのでは駄目だった**。技術系の減衰は下限 15% で止まるので、
//          緩めると「毎クール必ず少し伸びる」が残り、15年×4クールで能力が **99 に張り付く**
//          （実測。満遍なくの到達点はミート70・守備88・制球65 なのに、集中は 98〜99）。
//          下限が0でない天井は、クールを積めばいくらでも越えられる。
//
// ⚠ **(2) と「低い帯で効きすぎない」は数の上で両立しない**（いしだ 2026-11-25
//    「制球集中の効果が、制球が低い層には効果が高すぎますし、制球が高い層には低い気がします」）。
//    満遍なく自体が低い帯で大きく高い帯で小さい（打撃練習の合計は 50帯4.5 → 80帯1.0）ので、
//    それに差し引きを揃えると**集中も同じ形になる**＝低い帯でいちばん効く。
//    平らにするには低い帯を下げるしかなく、そのぶん (2) の「どの帯でも満遍なくと同じ」は崩れる。
//    **いまは平らを採っている**（`INTENSIVE_FOCUS` 3.7 → 2.4）。結果、
//      低い帯: 満遍なくのほうが総量は多い（若手は満遍なくで伸ばす理由がある）
//      高い帯: 対象の伸びは集中だけが残る（80帯で対象 0.22 対 1.58 ＝ 7倍）
//    ＝「集中は頭打ちの選手のための道具」という形。(2) は中くらいの帯の目安として残す。
// ============================================================
// 集中練習が1点に集約する倍率。
// 3.0 → 3.7 →（同じ日に）**2.4**（2026-11-25）。3.7 は「満遍なくの合計と差し引きが揃う」点に
// 合わせた値だったが、それだと低い帯に効きすぎた（制球集中が4クールで 35帯 +9.1 対 70帯 +4.3）。
// 2.4 にして、天井の平らな帯（`highStatDamp`）を広げたことで、帯ごとの伸びが平らになった。
// 実測（23歳・意識60・器用50・レギュラー先発・800人・制球集中4クール）:
//   帯35 9.1→**5.9** / 50 9.1→6.0 / 60 7.8→5.9 / 70 4.3→**5.2** / 80 0.8→**2.1**
// ⚠ 到達点は `INTENSIVE_FOCUS` ではなく天井（`highStatDamp` のゼロ点）が決めるので、
//    ここを動かしても「集中の終わり」は動かない（速さだけが動く）
const INTENSIVE_FOCUS = 2.4;
// 代償の割合。対象に入った伸びのこの割合を、`penaltyPool` の他能力から引く
const INTENSIVE_COST = 0.4;
// 球速の天井が効き始める、肩の上限（`getVelocityCap`）からの距離（km）
const VELOCITY_DAMP_WINDOW = 10;
// 球速の1クールの伸びの上限（km）。追いつき倍率×集中の倍率の掛け算を止める
const VELOCITY_PER_ROUND_MAX = 4;
// 集中練習の天井の形。
// ⚠ **ゼロになる点で決める**（「始まりを+20ずらす」では駄目だった）。ずらしだけだと
//    元の曲線の `from` が高い能力（守備は `EFFORT_DAMP` で70から）では ずらした先が90になり、
//    1.5〜2倍の傾きでも**99までに0へ届かず天井が消えた**（実測の到達点 94.3 → 99.0）。
//    いまは「元の曲線が下限に着く点」から `INTENSIVE_ZERO_SHIFT` だけうしろをゼロ点とし、
//    そこから `INTENSIVE_DAMP_WINDOW` 手前で減り始める形にする。能力ごとに自動で揃う:
//      技術系（50から3%/下限15%→78.3で下限）→ ゼロ点86.3・減り始め70.3
//      守備（70から5%/下限15%→87で下限）    → ゼロ点95.0・減り始め79.0
// ⚠ 減り始めまでは 1.0 のまま＝**平らな帯**。ここを広く取ると
//    「低い帯に効きすぎ・高い帯に効かない」が直る（いしだ 2026-11-25）。
const INTENSIVE_ZERO_SHIFT = 8;
const INTENSIVE_DAMP_WINDOW = 16;
// 集中の天井のゼロ点の上限（Q2 監査16）。⚠ フィジカル系（80から3%/下限10%→110で下限）はゼロ点が118になり、
//    能力は99までなので**走力集中に天井が無かった**（走力50でも95でも1クール約+0.8で同じ）。
//    守備と同じ95で止める（走力なら79から減り始めて95で0）。
//    ⚠ 球速（km の物差し）には掛けない（`highStatDamp` の `zeroMax`）
const INTENSIVE_ZERO_MAX = 95;
/** 高能力値の減衰。`intensive` なら集中用の形（平らな帯のあとゼロへ）で返す */
function highStatDamp(currentValue, curve, intensive, zeroMax = INTENSIVE_ZERO_MAX) {
  if (!intensive) {
    if (currentValue < curve.from) return 1.0;
    return Math.max(curve.floor, 1.0 - (currentValue - curve.from) * curve.rate);
  }
  // 元の曲線が下限に着く点 → そこから `INTENSIVE_ZERO_SHIFT` うしろがゼロ点
  const baseFloorAt = curve.from + (1 - curve.floor) / curve.rate;
  const zero = Math.min(zeroMax, baseFloorAt + INTENSIVE_ZERO_SHIFT);
  const from = zero - INTENSIVE_DAMP_WINDOW;
  if (currentValue < from) return 1.0;
  return Math.max(0, (zero - currentValue) / INTENSIVE_DAMP_WINDOW);
}

// 練習カテゴリ → スタッフ指導能力のマッピング
const CATEGORY_TO_STAFF_ABILITY = {
  batting: 'battingCoach',
  fielding: 'fieldRunCoach',
  pitching: 'pitchingCoach',
};


// ============================================================
// メニューが「何のために」効くか
//
// ⚠ **キャンプの判断は物差しによって答えが逆になる**。実測（1チームだけ
//    3年鍛えて90試合×4シード / 同じ選手を3年鍛えてドラフト評価）:
//
//      メニュー   勝率     得点   失点  ｜ ドラフト評価
//      打撃練習   0.640    4.18   2.79 ｜ **286〜298（最善）**
//      ノック     0.673    3.43  **2.06** ｜ 270〜285
//      走塁練習  **0.682**  3.52   2.35 ｜ 260〜278（最低）
//
//    **チームを勝たせるなら守備・走塁、選手をドラフトへ送り出すなら打撃**。
//    走塁が勝率で最良なのは、走力が `judgeFielderReach` の守備範囲にも効くため。
//    ⚠ **片方の物差しだけで係数を較正しないこと**。ドラフト評価だけを見て
//       「守備練習が弱い」と判断して強化すると、勝敗側が壊れる。
//
// ⚠ **この対立を画面に出す `serves` フィールドは撤去した（現在は無い）**。
//    メニュー名に「（勝敗）」「（ドラフト）」と括弧書きしていたが、選択欄が狭く（w-32）
//    名前が切れるうえ、ヘッダーにも同じ説明が出ていて重複していた。
//    **上の実測表はモデルの性質として現役**なので消さないこと。
//    もう一度画面に出すなら、括弧書きではない置き方を考えること。

/**
 * 練習メニュー定義
 * 各練習メニューは特定の能力値を成長させる
 */
/**
 * 1シーズン出ずっぱりで貯まる経験値の目安。
 * 野手は120試合×(出場1 + 打数/3)、投手は登板×(1 + 投球回)（`calculateSeasonExperience`）。
 */
export const FULL_SEASON_EXPERIENCE = 240;
/**
 * 覚醒（限界突破）の、1クール・1能力あたりの起こりやすさ（%）。
 *
 * ⚠ **キャンプ4クールを通して20%前後**にそろえてある（いしだ要望:
 *    経験が高い状態でキャンプに臨み、4クール合わせて20%前後）。
 *    打撃練習は4能力に当たるので4クールで16回引く。1回1.4%なら
 *    1-(1-0.014)^16 ≒ 20%。オンラインの覚醒倍率は1.5（`runCampRound` の
 *    `awakening`）なので、その手前の素の値は 1.4÷1.5 ≒ 0.93 にする。
 * ⚠ **クールごとに下がらないこと**（いしだ要望: 均す）。以前は経験値を
 *    クールごとに7割消費しており、覚醒率は 63.7% → 22.0% → 0% → 0% と
 *    1クール目だけのものになっていた。消費はキャンプの最後の1クールで1回
 *    （`executeCampTraining` の `spendExperience`）。
 */
export const AWAKENING_PER_ROUND = 0.93;
/** 経験値の頭打ち（1シーズンぶんの1.5倍）。大当たりの年を作らない */
export const AWAKENING_EXPERIENCE_CAP = 1.5;

/**
 * キャンプのメイン練習（ふだんの伸び・集中・覚醒）で、ミートとパワーだけに掛ける倍率。
 * ⚠ 要望 2026-11-24「ミートとパワーの成長量をやや下げます → 70台はプロでもレギュラークラス
 *    としています。数年プレイしているとレギュラーの半分がプロクラスになってしまうため」。
 *    才能の係数（`TALENT_STAT_MULTIPLIERS`）とは分けて持つ（才能の係数は走力・肩・球速にも効く）。
 *    年度替わりの自然成長（オンライン）は `growthSystem.js` の `NATURAL_GROWTH_KIND` で下げた。
 * ⚠ 0.85 では5年の長期シミュで差が種のゆらぎに埋もれたので 0.8 にし、覚醒の量にも掛けた
 *    （覚醒は 3〜6 → 2〜5。最低+1 は残す）
 */
export const CAMP_BAT_GROWTH_MULT = { meet: 0.8, power: 0.8 };

/**
 * 才能依存の能力は、練習だけでは伸びにくい。
 *
 * ⚠ **係数と最低保証の両方に効かせること**。以前は伸び幅にだけ掛けていたが、
 *    主対象には「1クール最低+1」の保証があり、掛け算の結果が0に丸まっても
 *    必ず+1入っていた。走塁練習を4クール当てれば走力は必ず+4で、
 *    才能係数0.6は**一度も効いていなかった**（実測: 走力は1年+2.3で、
 *    打撃系の中で最大）。保証のほうもこの率で引くこと。
 * ⚠ 体力・スタミナ・体幹（やれば伸びるもの）はここに入れない。
 */
export const TALENT_STAT_MULTIPLIERS = {
  arm: 0.3,       // 肩力: 生まれ持った体格に依存
  speed: 0.4,     // 走力: 先天的な筋繊維に依存
  // パワー: 体幹トレーニングで伸びる余地あり。⚠ 0.8 → 0.5（2026-11-23）。10年でリーグのパワーが
  //   36→48、本塁打が1試合 0.39→0.96 本と2.5倍になっていた（10年の長期シミュ）
  power: 0.5,
  velocity: 0.8,  // 球速: フォーム改善等で伸びる余地あり
};

/**
 * 努力で上がる能力の天井（いしだ 2026-11-21「体力や守備、スタミナ、体幹、サブポジなどの
 * 努力で上がるものに関しては、制限をゆるくしたいところです」）。
 * 才能で決まる能力（ミート・パワー・選球眼・制球）より**ずっと緩い**。
 *
 * ⚠ **いま入っているのは守備と体幹**。ご指摘の残り3つは、測ったら元から減衰を受けていない。
 *    ・体幹（`muscle`）… サブ練習「ウエイト」が +2〜4。60から4%/pt で鈍り、85で0（下の `muscle`）
 *    ・体力（`bodyStamina`）… サブ練習「基礎体力」が確定で +2〜4。**主練習の対象ではない**
 *      （実測: 体力88から4クールのサブで99まで到達）
 *    ・サブポジ（`positionFitness`）… ノックとサブ練習が確定で +4〜8。減衰なし・100で止まる
 *    ・スタミナ（`stamina`）… 1クールの計算値が常に1未満で、**「最低+1」の規則が
 *      すべてを決めている**（実測: スタミナ90でも190でも・意識50でも90でも 4クールで +4.0）。
 *      天井を足しても一度も効かないので入れない。効かせたいならメニューの係数
 *      （`control` の `stamina: 0.5`）の側を上げること。
 * ⚠ **変化球（`arsenal[].level`）は別の表**（`growthSystem.dampBreakingGain`）。メイン練習の対象ではなく
 *    （`getStatPath('breaking')` が無い）、サブ練習の独自の分配で決まるのでここには載せられない。
 * ⚠ 守備は `TECHNICAL_STATS` なので、放っておくと技術系の天井（50から3%）を受ける。
 *    それだと**ノックで守備を積む**という一番素直な育て方が潰れる（実測の到達点 79.9）。
 *    才能で決まるミート・パワーとは別の物差しにする。
 */
const EFFORT_DAMP = {
  // 体幹: 60までは素通し、そこから4%/pt で **85で0**（下限なし）。
  // ⚠ **減衰がまったく無かった**（2026-11-26 の実測。ウエイト4クールの伸びが
  //    体幹42でも85でも +12.0 と完全に平らで、42から**5年で99**に到達した）。
  //    体幹は試合には効かず、パワー・走力・肩・球速・体力の**成長倍率**（0.5〜1.5倍）
  //    専用の能力なので、上げ切ると「倍率そのものを買う」ことになる。
  //    実測（打撃練習4クールのパワー）: 体幹42 +0.72 → 99 +1.10。
  //    リーグ平均のパワーが上がり続ける一番太い供給路がここだった
  //    （いしだ 2026-11-26「ホームランが出すぎな気がします」の調べで判明）。
  // ⚠ **下限を0にする**のが要。下限が残るとクールを積めばいくらでも越えられる
  //    （変化球・集中練習で同じ轍を踏んでいる）。60までは素通しなので、
  //    ふつうの選手（生成時の平均42・σ10）が倍率1.1まで上げるところは今までどおり。
  muscle: { from: 60, rate: 0.04, floor: 0 },
  // 守備70までは減衰ゼロ＝ノックが素直に効く。70から1点ごとに5%（85で25%・90で下限）
  //   実測の到達点（能力38の19歳から毎年4クールのノック・34歳まで）:
  //     意識90/器用80 → 88.8（技術系のままなら 79.9 / 今朝までの65から4%なら 86.3）
  //     標準（意識50） → 68.2（技術系のままなら 65.6 / 65から4%なら 66.2）
  defense: { from: 70, rate: 0.05, floor: 0.15 },
};

export const TRAINING_MENUS = {
  batting: {
    name: '打撃練習',
    icon: '🏏',
    description: 'ミートを強化、パワー・選球眼・バントを微増',
    targets: ['meet', 'power', 'eye', 'bunt'],
    // 実測: 得点+0.75/試合だが失点+0.73。ドラフト評価は最善
    // 能力ごとの成長倍率: パワーは才能依存のため半減、選球眼は副次効果として半減
    // ミートは1.0倍維持（+0〜2）、パワー/選球眼/バントは0.3〜0.5倍（+0〜1）
    // ⚠ 選球眼 0.5→1.0（2026-11-23）。投手の制球が毎クール伸びるのに選球眼だけ
    //    伸びず、10年で四球が半分になっていた（10年の長期シミュ）
    // ⚠ パワー 0.7 → **0.45**（いしだ 2026-11-25「打撃練習のとき、パワーの伸びを下げて」）。
    //    ここは**打撃練習だけ**を下げる。パワーを狙って伸ばす道（長打集中）は据え置きで、
    //    「ミートを磨く練習にパワーまで付いてくる」分を削る。
    //    実測（人の球団の野手13人に4クール・20回の平均）: パワー +0.72 → **+0.45**。
    //    長打集中のパワーは +3.45 で不変、打撃練習のミート（+1.83）・選球眼（+2.84）も不変。
    //    ⚠ ミート・パワーに共通で掛かる `CAMP_BAT_GROWTH_MULT`（0.8）とは別の軸。
    //      あちらを下げるとミートと長打集中まで動く。
    growthMultipliers: { power: 0.45, eye: 1.0, bunt: 0.3 },
    category: 'batting'
  },
  baserunning: {
    name: '走塁練習',
    icon: '🏃',
    description: '走力・盗塁・バントを強化',
    targets: ['speed', 'steal', 'bunt'],
    // 実測: 勝率0.682で最良（走力は守備範囲にも効く）
    growthMultipliers: { speed: 0.75, bunt: 0.5 },
    category: 'batting'
  },
  fielding: {
    name: 'ノック',
    icon: '🧤',
    description: '守備力と肩力を強化（投手野手共通）・野手は今の守備位置の適性も+4〜8/クール',
    targets: ['defense', 'arm'],
    // 実測: 失点2.06で最少
    // ⚠ 守備は 1.0→**1.5**（いしだ 2026-11-20「ノックの守備の伸びが弱い気がします」）。
    //    実測（4クール・経験値満タン）: 守備60の選手で 平均+2.0→+3.0。
    //    守備位置の適性は前から確定で+4〜8/クール上がる（`executeCampTraining` の末尾）が、
    //    主力は自分の位置が既に100なので動かず、伸びていないように見えていた
    growthMultipliers: { arm: 1.5, defense: 1.5 },
    category: 'fielding'
  },
  control: {
    name: '投げ込み',
    icon: '🎯',
    description: '制球力を強化し、スタミナも向上（投手向け）',
    targets: ['control', 'stamina'],
    // ⚠ 制球は**1.0ではなく0.45**。投手は選べるメニューが少なく（投げ込み・
    //    球速練習・新球種）、制球が毎クール選ばれ続ける。野手がミート・走塁・
    //    ノックに散るぶん、制球だけが積み上がっていた
    //    （実測: 1年で制球+2.5 対 ミート+1.05、5年でリーグ平均が
    //    制球 49.8→65.7 対 ミート 45.9→51.9）。
    // ⚠ **ミートと同じ速さになるところまで下げる**。0.7では 制球1.1 対
    //    ミート0.6 でまだ倍近く、投手有利が年々開いていた
    // ⚠ スタミナは据え置き（やれば伸びるもの）
    // ⚠ 0.45 → **0.2**（2026-11-23、いしだ「3件とも直す」）。0.45 でも10年でリーグの制球が
    //    49→65 と伸び続け、選球眼（横ばい）との差で四球が半分になった。指導者の「長所を伸ばす」の
    //    制球集中にも同じ係数を掛けていた（2026-11-25 から集中では掛けない。上の「集中練習」の注の (2)）
    // ⚠ 0.2 → **0.4**（要望 2026-11-24「制球の成長をやや上げます → 現在は4クールでも1～2程度しか
    //    上がらず効果が低い」）。実測（人の球団の投手11人・4クール・20回の平均）:
    //    制球集中 +1.05 → +2.1、投げ込み +0.23 → +0.5。0.45 で四球が半分になった頃は、ストレッチの
    //    制球・集中の最低保証が減衰を素通りしていた（2026-11-23〜24 に塞いだ）。長期の BB/9 は
    //    long-run-probe で確かめた
    // ⚠ **この係数が主に動かすのは「低い帯の伸びの速さ」**。天井は年次成長のアマの天井
    //    （`AMA_CTL`。能力46から8%・下限3%）が握っているので、到達点の動きは小さい。
    //    2026-11-24 の実測（19歳・制球40から毎年4クール＋年次成長の15年後）:
    //      標準（意識50・器用50）    0.2→57.5 / 0.25→57.7 / 0.3→57.6 / 0.4→58.5
    //      意識90・器用80          0.2→60.5 / 0.25→61.8 / 0.3→62.5 / 0.4→64.2
    //    ⚠ 標準の投手はほぼ動かないが、**プロ意識と器用さの高い投手は到達点も動く**
    //      （アマの天井の下限3%の先を、速い伸びで押していける）。ここを上げるときは
    //      「速さ」だけでなく上側の到達点も動くものとして見ること。
    // ⚠ 0.4 → **0.55**（いしだ 2026-11-25「投げ込みや制球集中のとき、制球の伸びを上げて」）。
    //    実測（人の球団の投手11人に4クール・40回の平均）:
    //      制球集中 +2.00 → **+2.74** / 投げ込み +0.67 → **+0.93**
    //    ⚠ 投げ込みの伸びは小さいので1回の測りでは ±0.1 振れる。期待値は `statMultiplier` に
    //      **厳密に比例する**（`stochasticRound` が期待値を保ち、`dampFactor` は係数に依らない）
    //      ので、0.4/0.6 の2点（+0.67 / +0.93）から直線で読むこと。
    //      切片の約 +0.15 は覚醒ぶん（係数が掛からない）。
    //    到達点（上と同じ測り方の15年後）: 標準 58.3→**59.0** / 意識90・器用80 65.1→**67.6**。
    growthMultipliers: { control: 0.55, stamina: 0.5 },
    category: 'pitching'
  },
  velocity: {
    name: '球速練習',
    icon: '🔥',
    description: '球速を強化（肩力上限・フォーム適性あり）、スタミナも微増（投手向け）',
    targets: ['velocity', 'stamina'],
    growthMultipliers: { stamina: 0.3 },
    category: 'pitching'
  },
  newpitch: {
    name: '新球種習得',
    icon: '✨',
    description: '新しい変化球を覚える（投手のみ・器用さで習得レベルと失敗率が変わる）',
    targets: ['newpitch'],
    category: 'pitching'
  },
  // 集中練習コース: 通常の式で出した伸びを1能力に集約（`INTENSIVE_FOCUS`）/ 代償は対象の伸びの `INTENSIVE_COST`（4割）を他能力から
  intensive_power: {
    name: '長打集中',
    icon: '💥',
    description: 'パワーを集中して大きく伸ばす。伸びた分の4割を他の能力から引く代わりに、普通の練習が鈍る帯でも伸びる',
    targets: ['power'],
    category: 'batting',
    intensive: true,
    penaltyPool: ['meet', 'eye', 'speed', 'defense']
  },
  intensive_meet: {
    name: 'ミート集中',
    icon: '🎯',
    description: 'ミートを集中して大きく伸ばす。伸びた分の4割を他の能力から引く代わりに、普通の練習が鈍る帯でも伸びる',
    targets: ['meet'],
    category: 'batting',
    intensive: true,
    penaltyPool: ['power', 'eye', 'speed', 'defense']
  },
  intensive_speed: {
    name: '走力集中',
    icon: '⚡',
    description: '走力を集中して大きく伸ばす。伸びた分の4割を他の能力から引く代わりに、普通の練習が鈍る帯でも伸びる',
    targets: ['speed'],
    category: 'batting',
    intensive: true,
    penaltyPool: ['meet', 'power', 'eye', 'defense']
  },
  intensive_control: {
    name: '制球集中',
    icon: '🎯',
    description: '制球を集中して大きく伸ばす。伸びた分の4割を他の能力から引く代わりに、普通の練習が鈍る帯でも伸びる',
    targets: ['control'],
    category: 'pitching',
    intensive: true,
    // ⚠ スタミナ・球速は**代償の引き先に入れない**（物差しが違うので予算の外。いしだ 2026-11-25）。
    //    入れていると、代償の一部が点数の外へ逃げて「同じトータル」が崩れる
    penaltyPool: ['meet', 'defense', 'arm', 'speed']
  },
  intensive_velocity: {
    name: '球速集中',
    icon: '🔥',
    description: '球速を集中して大きく伸ばす。伸びた分の4割を他の能力から引く代わりに、普通の練習が鈍る帯でも伸びる',
    targets: ['velocity'],
    category: 'pitching',
    intensive: true,
    // ⚠ 肩力は入れない（球速の伸びが肩力へ50%連動するので、同じクールで上げて下げることになる）
    penaltyPool: ['control', 'meet', 'defense']
  },
  intensive_defense: {
    name: '守備集中',
    icon: '🛡️',
    description: '守備を集中して大きく伸ばす。伸びた分の4割を他の能力から引く代わりに、普通の練習が鈍る帯でも伸びる',
    targets: ['defense'],
    category: 'fielding',
    intensive: true,
    penaltyPool: ['meet', 'power', 'eye', 'speed']
  },
  intensive_eye: {
    name: '選球眼集中',
    icon: '👁️',
    description: '選球眼を集中して大きく伸ばす。伸びた分の4割を他の能力から引く代わりに、普通の練習が鈍る帯でも伸びる',
    targets: ['eye'],
    category: 'batting',
    intensive: true,
    penaltyPool: ['meet', 'power', 'speed', 'defense']
  }
};

/**
 * そのメニューがこの選手の守備位置に合うか（オンラインのキャンプの規則）。
 * 投手に打撃系（batting）、野手に投球系（pitching）を当てない。守備系はどちらにも当てられる。
 *
 * ⚠ 一人用のキャンプ画面は、野手に投球系を当てること（投手への転向の準備など）も
 *    許している。この規則はオンラインの選択肢（`CampPlanner` の `menusFor`）と
 *    サーバーの受け付けをそろえるためのもの。野手に「球速練習」を当てても、
 *    伸びるのは野手が使わない球速・スタミナだけになる。
 */
export const menuFitsPlayer = (key, player) => {
  const category = TRAINING_MENUS[key]?.category;
  if (!category) return false;
  return player?.position === 'pitcher' ? category !== 'batting' : category !== 'pitching';
};

/**
 * そのサブ練習がこの選手に効くか（オンラインのキャンプの規則）。
 *
 * ⚠ 効かない練習を当てると**そのクールが丸ごと無駄になる**。
 *    変化球練習・新球種習得・スピン解析は投手にしか効かず
 *    （`executeSubTraining` が投手以外では何もしない）、Cリード学習は
 *    捕手のリードを上げるものなので捕手だけ。
 * ⚠ 画面の選択肢（`CampPlanner` の `subMenusFor`）とサーバーの受け付けを
 *    これでそろえる。
 */
const SUB_MENU_ONLY = {
  breaking: 'pitcher',
  newpitch: 'pitcher',
  spin_analysis: 'pitcher',
  clead_study: 'catcher',
  // ⚠ フォーム改造は**投手も野手も使える**（いしだ 2026-11-23）。投手は投球フォーム、
  //    野手は打撃フォーム（オープン/スクエア/クローズ）を変える。以前は野手だと
  //    ミートが少し伸びるだけだったので投手にだけ出していた
};
/**
 * 名前を変えた・まとめたサブ練習の、古い名前 → 今の名前。
 * ⚠ 保存済みの計画（オンラインの下書き・一人用のセーブ・アプリ）に古い名前が残っていても
 *    壊さない。サブ練習の名前を受け取る入口（`subMenuFitsPlayer`・`executeSubTraining`・
 *    `clampSub`・サーバーの受け付け）はこれを通す。アプリの写しは `Camp.kt` の `SUB_MENU_ALIASES`
 */
export const SUB_MENU_ALIASES = {
  defense_sub: 'subposition', // 守備補強 → サブポジ練習（2026-11-24）
};
export const canonicalSubMenu = (key) => SUB_MENU_ALIASES[key] || key;

// フォーム改造（投手）で選べるフォーム。`executeSubTraining` の抽選と、オンラインの `CAMP_FORMS` と同じ並び
const SUB_FORMS = ['overhand', 'threeQuarter', 'sidearm', 'submarine'];
// 打席変更で選べる打席（オンラインの `CAMP_BATS` と同じ）
const SUB_BATS = ['right', 'left', 'switch'];
/**
 * 実際に回すサブ練習。フォーム改造（投手の投球フォーム・野手の打撃フォーム）と打席変更は、
 * **対象が無いか、もうその形なら基礎体力**。一人用とオンラインで同じ規則にする。
 * ⚠ 選んだサブ練習と対象はクールをまたいで残る（一人用の画面・オンラインの4クールの指示）。
 *    `executeSubTraining` は対象＝いまの形なら別の形を抽選するので、ここで止めないと
 *    1クール目に変わった形が次のクールでまた別の形に変わり、失敗の減点も重なる。
 * ⚠ 打席変更は失敗すると打席が変わらないので、次のクールでまた挑む（成功したら止まる）
 * ⚠ もとはサーバー（`server/leagueEngine.mjs`）にあった。サーバーはここから読む
 */
export function campSubKey(rawKey, player, target) {
  // ⚠ まとめた古い名前（守備補強 → サブポジ練習）は今の名前で回す。保存済みの計画に残っている
  const key = canonicalSubMenu(rawKey);
  // ⚠ フォーム改造は投手と野手で別物（投球フォーム / 打撃フォーム）
  if (key === 'form_change' && player?.position !== 'pitcher')
    return typeof target === 'string' && Object.hasOwn(BATTING_STANCES, target) && target !== battingStanceOf(player)
      ? key
      : 'physique';
  if (key === 'form_change')
    return SUB_FORMS.includes(target) && target !== (player.pitching?.form || 'threeQuarter')
      ? key
      : 'physique';
  if (key === 'switch_hit')
    return SUB_BATS.includes(target)
      && target !== (player?.batting?.bats || player?.physical?.bats || 'right')
      ? key
      : 'physique';
  return key;
}

export const subMenuFitsPlayer = (rawKey, player) => {
  const key = canonicalSubMenu(rawKey);
  if (!SUB_TRAINING_MENUS[key]) return false;
  const only = SUB_MENU_ONLY[key];
  return !only || player?.position === only;
};

/**
 * サブ練習メニュー（基礎体力・弱点補強系）
 */
export const SUB_TRAINING_MENUS = {
  physique: {
    name: '基礎体力',
    icon: '🏃',
    description: '体力+2〜4/クール確定・体幹+0〜1（投手：スタミナ+1〜2も）',
  },
  weight: {
    name: 'ウエイト',
    icon: '🏋️',
    description: '体幹+2〜4（60から鈍り85で止まる）・パワー+0〜1・肩力+0〜1',
  },
  stretch: {
    name: 'ストレッチ',
    icon: '🧘',
    description: '野手：ミート/パワー/選球眼/走力/肩/守備からランダム1能力+1。投手：制球/球速/スタミナ/肩/守備/ミートからランダム1能力+1。回復力30%UP',
    targets: ['all_minor', 'recovery_sub'],
  },
  form_change: {
    name: 'フォーム改造',
    icon: '🔄',
    description: '投手は投球フォーム、野手は打撃フォーム（オープン/スクエア/クローズ）の変更に挑戦（成功20%・器用さで上下: 成功で能力UP / 失敗で低下。フォームは成否によらず変わる）',
    targets: ['control', 'meet'],
  },
  switch_hit: {
    name: '打席変更',
    icon: '↔️',
    description: '打席変更に挑戦（器用さで成功率が上下・失敗でミート低下リスク）',
    targets: ['switch_bats'],
  },
  breaking: {
    name: '変化球練習',
    icon: '🌀',
    description: '変化球レベルを強化（1球種を選んで集中練習も可）',
    targets: ['breaking'],
  },
  // ⚠ 「守備補強」（`defense_sub`）を**ここへまとめた**（要望 2026-11-24「サブポジ練習を現在の
  //    ポジションも上がるように → 守備補助で上げられますが、わかりにくいため統合します」。守備補助＝守備補強）。
  //    守備補強がしていた「守備+0〜2・今の守備位置の適性+4〜8」をサブポジ練習が一緒に行う
  //    （バントの微増は落とした。守備の練習ではないため）。古い名前は `canonicalSubMenu` で読み替える
  subposition: {
    name: 'サブポジ練習',
    icon: '🔀',
    description: '指定ポジションの適正大幅UP（器用さで伸びが変わる）・今の守備位置の適正+4〜8・守備+0〜2',
    targets: ['subposition', 'defense', 'fitness'],
  },
  clead_study: {
    name: 'Cリード学習',
    icon: '🧠',
    description: 'キャッチャーリード向上（リード+1~3）',
    targets: ['clead'],
  },
  long_throw: {
    name: '遠投',
    icon: '🎯',
    description: '肩力を重点強化（+0〜3）投手は球速連動',
    targets: ['arm'],
  },
  eye: {
    name: '選球眼練習',
    icon: '👁️',
    description: '選球眼を強化（+0〜2）',
    targets: ['eye'],
  },
  newpitch: {
    name: '新球種習得',
    icon: '✨',
    description: '新球種習得に挑戦（成功率22%・器用さとフォーム適性で上昇。球種は狙いを選べる・選ばなければおまかせ）',
    targets: ['newpitch'],
  },
  spin_analysis: {
    name: 'スピン解析',
    icon: '🎥',
    description: '高速カメラで回転を分析・スピン+1〜3、持ち球すべてのLv+1程度、制球微増（器用さで上下・投手のみ）',
  },
};

/**
 * キャンプの伸びが止まる年齢（22〜32）。素質（成長係数）・疲労管理・プロ意識で延びる。
 *
 * ⚠ いしだ 2026-11-20「成長係数の年齢ごとの変動を教えて。30歳以上の選手が、まだまだ
 *    1.0以上になっていたので、正常に動いているか知りたいです」。
 *    **成長係数（`growthPotential`）は年齢で下げない**のが決まり（`growthSystem.js` の注。
 *    昔は毎年引いていて、30代は全員0付近に潰れ、年齢の効きが三重に掛かっていた）。
 *    年齢はこの停止年齢と `getAgeGrowthBase` のカーブだけが担う。
 *    （選手情報の「成長の停止」の表示は 2026-11-20 にやめた。式はキャンプだけが使う）
 */
export function growthStopAge(player) {
  const gp = player?.growthPotential ?? 1.0;
  const mod = player?.growthModifier || 0;
  const discipline = player?.personality?.discipline ?? 50;
  return Math.min(32, Math.max(22,
    Math.round(26 + (gp - 1.0) * 15)
    + Math.min(2, Math.max(0, mod * 5))
    + Math.min(2, Math.max(0, (discipline - 60) * 0.05))
  ));
}

/** 止まったあとも練習が効く割合（プロ意識で決まる。50で0%・80で9%・100で15%） */
export function postStopTrainEffect(player) {
  return Math.max(0, ((player?.personality?.discipline ?? 50) - 50) * 0.003);
}

/**
 * 覚醒の伸びの、高い能力での抑え。
 *
 * ⚠ いしだ 2026-11-20「能力80台から4クールで+6くらい上がる選手がいます。独立リーグとしては
 *    上がりすぎな気がしますので調整をお願いします。能力が低い場合は、いまの伸びのままでOK」。
 *    ふだんの伸びは能力65以上で減衰していたが、**覚醒には何も掛かっていなかった**ので、
 *    80台でも1回の覚醒で+3〜6跳ねていた（実測: 4クールの最大 +9）。
 * ⚠ **70未満は素通し**（低い能力はいまの伸びのまま、という要望）。
 * ⚠ 実測（4クール・経験値満タン・プロ意識60・成長力1.0、600回）:
 *    ミート40 平均+2.2・最大+14（据え置き）／60 平均+2.1（据え置き）／
 *    80 平均 0.96→0.82・**最大 9→5**／90 最大 7→3。
 */
function awakeningHighStatDamp(currentValue) {
  if (!(currentValue >= 70)) return 1;
  return Math.max(0.3, 1 - (currentValue - 70) * 0.05);
}

/**
 * 技術系能力（ミート・パワー・選球眼・制球・バントなど）のサブ練習の高能力値成長減衰。
 * **メイン練習と同じ天井**（50以上で超過1ごとに3%、下限15%）を、確率的に丸めて掛ける。
 * ⚠ 2026-11-23 まではサブ練習だけ旧式（70から5%・`Math.round`）のままだった。+1 に 0.7 を
 *    掛けても丸めて+1 なので、能力70台の前半まで減衰が一度も効かず、サブ練習の制球（40%で+1）が
 *    毎年ほぼそのまま積み上がっていた。10年の長期シミュでリーグの制球が 49→69 と伸び続け、
 *    四球が半分になった主な出どころ（キャンプの制球の伸びは、同じ能力のミートの1.6倍）。
 * ⚠ 守備は努力で上がる能力なので別の物差し（`EFFORT_DAMP.defense`。メイン練習と同じ）
 */
function applyTechStatDecay(currentValue, growth, curve = TECH_SUB_DAMP) {
  if (growth <= 0 || currentValue < curve.from) return growth;
  const dampFactor = Math.max(curve.floor, 1.0 - (currentValue - curve.from) * curve.rate);
  return Math.max(0, stochasticRound(growth * dampFactor));
}
/** サブ練習の技術系の天井（メイン練習の技術系と同じ値） */
const TECH_SUB_DAMP = { from: 50, rate: 0.03, floor: 0.15 };
// 変化球レベルの天井は `growthSystem.dampBreakingGain`（キャンプ・大学で共有する物差し）

/**
 * サブ練習を実行（メイン練習の半分程度の効果）
 * @param {Object} player - 選手
 * @param {string} subType - サブ練習タイプ
 * @param {Object} options - オプション { targetPosition, targetForm, targetStance, targetBats, targetPitch, keepPosition }
 */
export function executeSubTraining(player, rawSubType, options = {}, staffBonus = null) {
  const subType = canonicalSubMenu(rawSubType);
  const menu = SUB_TRAINING_MENUS[subType];
  if (!menu) return { player, growthReport: [] };

  const growthReport = [];
  const growthAmount = () => Math.random() < 0.4 ? (Math.random() < 0.3 ? 2 : 1) : 0;

  switch (subType) {
    case 'physique': {
      // 体力+2〜4（確定）
      if (player.physical) {
        const bsBefore = player.physical.bodyStamina ?? 50;
        if (bsBefore < 99) {
          const bsGrowth = Math.floor(Math.random() * 3) + 2; // 2〜4
          player.physical.bodyStamina = Math.min(99, bsBefore + bsGrowth);
          growthReport.push({ statName: '体力', before: bsBefore, after: player.physical.bodyStamina, growth: player.physical.bodyStamina - bsBefore });
        }
        // 体幹 +0〜1（50%で+1）
        // ⚠ **ウエイトより上げないこと**（いしだ 2026-11-20「基礎体力練習でウエイトより
        //    体幹が上がってしまいます」）。以前はどちらも +1〜3 で、基礎体力は体力と
        //    スタミナまで付くぶん丸ごと上位互換だった。体幹を鍛えるのはウエイトの役
        const oldMuscle = player.physical.muscle ?? 50;
        if (oldMuscle < 100 && Math.random() < 0.5) {
          // ⚠ ウエイトと同じ減衰（`EFFORT_DAMP.muscle`）。片方だけ素通しにすると抜け道になる
          const mGain = applyTechStatDecay(oldMuscle, 1, EFFORT_DAMP.muscle);
          if (mGain > 0) {
            player.physical.muscle = Math.min(ABILITY_CAP, oldMuscle + mGain);
            growthReport.push({ statName: '体幹', before: oldMuscle, after: player.physical.muscle, growth: player.physical.muscle - oldMuscle });
          }
        }
      }
      // 投手はスタミナ+1〜2も上昇
      if (player.pitching) {
        const staGrowth = Math.random() < 0.4 ? 2 : 1;
        const before = player.pitching.stamina || 80;
        player.pitching.stamina = Math.min(200, before + staGrowth);
        growthReport.push({ statName: 'スタミナ', before, after: player.pitching.stamina, growth: staGrowth });
      }
      break;
    }
    case 'weight': {
      // 体幹 +2〜4（確定）
      // ⚠ **体幹を鍛える練習はこれ**（いしだ 2026-11-20「キャンプのウエイトの効果を上げて、
      //    基礎体力練習の体幹上昇効果を下げてください」）。基礎体力は体力・スタミナの役
      if (player.physical) {
        const oldMuscle = player.physical.muscle ?? 50;
        if (oldMuscle < 100) {
          // ⚠ 高い体幹では鈍る（`EFFORT_DAMP.muscle`。85で0）
          const mGrowth = applyTechStatDecay(oldMuscle, Math.floor(Math.random() * 3) + 2, EFFORT_DAMP.muscle);
          if (mGrowth > 0) {
            player.physical.muscle = Math.min(ABILITY_CAP, oldMuscle + mGrowth);
            growthReport.push({ statName: '体幹', before: oldMuscle, after: player.physical.muscle, growth: player.physical.muscle - oldMuscle });
          }
        }
        // 肩力 +0〜1（40%で+1）投手は球速連動
        if (Math.random() < 0.4) {
          const oldArm = player.physical.arm || 50;
          if (oldArm < 100) {
            player.physical.arm = Math.min(ABILITY_CAP, oldArm + 1);
            growthReport.push({ statName: '肩力', before: oldArm, after: player.physical.arm, growth: 1 });
            if (player.pitching) {
              const armNow = player.physical.arm;
              const velChange = Math.round(0.5 * getVelocityCatchupMult(armNow, player.pitching.velocity || 120));
              if (velChange > 0) {
                const oldVel = player.pitching.velocity || 120;
                const newVel = Math.min(getVelocityCap(armNow), oldVel + velChange);
                if (newVel > oldVel) {
                  player.pitching.velocity = newVel;
                  growthReport.push({ statName: '球速', before: oldVel, after: newVel, growth: newVel - oldVel, isLinked: true });
                }
              }
            }
          }
        }
      }
      // パワー +0〜1（55%で+1。⚠ ウエイトの効きを上げた。40%→55%）
      if (player.batting && Math.random() < 0.55) {
        const oldPower = player.batting.power || 0;
        const powerGrowth = applyTechStatDecay(oldPower, 1);
        if (powerGrowth > 0) {
          player.batting.power = Math.min(ABILITY_CAP, oldPower + powerGrowth);
          growthReport.push({ statName: 'パワー', before: oldPower, after: player.batting.power, growth: powerGrowth });
        }
      }
      break;
    }
    case 'stretch': {
      // 投手は制球・球速・スタミナ含む6能力、野手はミート・パワー・選球眼・走力・肩力・守備からランダム1つ+1
      // ⚠ 野手に選球眼、投手にスタミナを足した（2026-11-23）。指導者の「満遍なく」のサブ練習はこれで、
      //    毎クール必ずどれかが+1になる。野手は選球眼が候補に無く、投手は制球・球速に2割ずつ入るので、
      //    10年でリーグの制球が 49→69・選球眼は横ばいになり、四球が半分になっていた（10年の長期シミュ）
      const isPitcher = player.position === 'pitcher';
      const stats = isPitcher ? [
        { key: 'pitching.control', name: '制球', isTech: true },
        { key: 'pitching.velocity', name: '球速', isTech: false, isVelocity: true },
        { key: 'pitching.stamina', name: 'スタミナ', isTech: false, isStamina: true },
        { key: 'physical.arm', name: '肩力', isTech: false },
        { key: 'fielding.defense', name: '守備', isTech: true },
        { key: 'batting.meet', name: 'ミート', isTech: true },
      ] : [
        { key: 'batting.meet', name: 'ミート', isTech: true },
        { key: 'batting.power', name: 'パワー', isTech: true },
        { key: 'batting.eye', name: '選球眼', isTech: true },
        { key: 'physical.speed', name: '走力', isTech: false },
        { key: 'physical.arm', name: '肩力', isTech: false },
        { key: 'fielding.defense', name: '守備', isTech: true },
      ];
      const picked = stats[Math.floor(Math.random() * stats.length)];
      const [obj, prop] = picked.key.split('.');
      if (player[obj]) {
        const old = player[obj][prop] ?? (picked.isVelocity ? 120 : 50);
        let gain;
        if (picked.isVelocity) {
          const armVal = player.physical?.arm || 50;
          gain = old < getVelocityCap(armVal) ? 1 : 0;
        } else {
          // 守備はサブポジ練習（もと守備補強）と同じ努力系の減衰（70から）。技術系（50から）だと
          // ストレッチだけ守備が伸びにくかった（2026-11-24 監査）
          gain = picked.key === 'fielding.defense' ? applyTechStatDecay(old, 1, EFFORT_DAMP.defense)
            : picked.isTech ? applyTechStatDecay(old, 1) : 1;
        }
        if (gain > 0) {
          // ⚠ スタミナは 1〜200 の物差し（`executeCampTraining` の maxValue と同じ）
          const maxVal = picked.isVelocity ? getVelocityCap(player.physical?.arm || 50) : picked.isStamina ? 200 : ABILITY_CAP;
          player[obj][prop] = Math.min(maxVal, old + gain);
          growthReport.push({ statName: picked.name, before: old, after: player[obj][prop], growth: gain });
          if (picked.key === 'physical.arm' && !isPitcher) {
            const armNow = player.physical?.arm || 50;
            const velChange = Math.round(gain * 0.5 * getVelocityCatchupMult(armNow, player.pitching?.velocity || 120));
            if (velChange > 0 && player.pitching) {
              const oldVel = player.pitching.velocity || 120;
              const newVel = Math.min(getVelocityCap(armNow), oldVel + velChange);
              if (newVel !== oldVel) {
                player.pitching.velocity = newVel;
                growthReport.push({ statName: '球速', before: oldVel, after: newVel, growth: newVel - oldVel, isLinked: true });
              }
            }
          }
        }
      }
      // 回復力UP（30%の確率で+1）
      if (player.physical && Math.random() < 0.3) {
        const recBefore = player.physical.recovery || 50;
        player.physical.recovery = Math.min(99, recBefore + 1);
        growthReport.push({ statName: '回復', before: recBefore, after: player.physical.recovery, growth: 1 });
      }
      break;
    }
    case 'form_change': {
      if (player.position === 'pitcher' && player.pitching) {
        const currentForm = player.pitching.form || 'threeQuarter';
        const forms = SUB_FORMS;
        const targetForm = options.targetForm && options.targetForm !== currentForm
          ? options.targetForm
          : forms.filter(f => f !== currentForm)[Math.floor(Math.random() * (forms.length - 1))];
        // 成功/失敗にかかわらずフォームは変わる
        player.pitching.form = targetForm;
        // ⚠ 器用さで成功率が動く（基準20%・器用さ50で据え置き）。
        //    実測の p5(27)→10.8% / p95(72)→28.8% / 最高87→34.8%
        const formRate = 0.20 * dexterityMult(player, 1.0);
        if (Math.random() < formRate) {
          // 成功: フォーム変更 + 制球+3~5 大幅アップ
          growthReport.push({ statName: 'フォーム改造成功', before: FORM_SHORT[currentForm], after: FORM_SHORT[targetForm], growth: 0, isAwakening: true });
          const bonus = Math.floor(Math.random() * 3) + 3;
          const oldCtrl = player.pitching.control || 50;
          // ⚠ 上限（ABILITY_CAP）で止める（98で成功すると103になっていた）
          player.pitching.control = Math.min(ABILITY_CAP, oldCtrl + bonus);
          if (player.pitching.control !== oldCtrl)
            growthReport.push({ statName: '制球', before: oldCtrl, after: player.pitching.control, growth: player.pitching.control - oldCtrl });
        } else {
          // 失敗: フォーム変更 + 制球-1~3 ダウン
          growthReport.push({ statName: 'フォーム改造', before: FORM_SHORT[currentForm], after: FORM_SHORT[targetForm], growth: 0 });
          const penalty = Math.floor(Math.random() * 3) + 1;
          if (player.pitching.control > 20) {
            const oldCtrl = player.pitching.control;
            player.pitching.control = Math.max(15, oldCtrl - penalty);
            growthReport.push({ statName: '制球', before: oldCtrl, after: player.pitching.control, growth: player.pitching.control - oldCtrl });
          }
        }
      } else if (player.batting) {
        // ============================================================
        // 【野手のフォーム改造＝打撃フォームを変える】いしだ 2026-11-23
        //   「オープン：インコースが得意になり、アウトコースが苦手になる／スクエア：
        //    平均的／クローズ：アウトコースが得意になり、インコースが苦手になる…
        //    苦手を無くす打撃フォームにするか、得意を伸ばす打撃フォームにするか、
        //    プレイヤーの判断で変わります」
        //
        // ⚠ それまではミートが少し伸びるだけで、打撃練習の劣化版だった。
        // ⚠ 投手のフォーム改造と**同じ形**にする（成否にかかわらずフォームは変わり、
        //    成功なら主要能力が伸び、失敗なら下がる。成功率は器用さで動く）。
        //    違うのは動く能力がミートであることだけ。
        // ⚠ 得意ゾーンへの効き目は `src/game/batterZone.js`（`BATTING_STANCES`）。
        //    ここは「どのフォームにするか」だけを決める。
        // ============================================================
        const currentStance = battingStanceOf(player);
        const stances = Object.keys(BATTING_STANCES);
        const targetStance = options.targetStance && BATTING_STANCES[options.targetStance]
          && options.targetStance !== currentStance
          ? options.targetStance
          : stances.filter(f => f !== currentStance)[Math.floor(Math.random() * (stances.length - 1))];
        player.battingStance = targetStance;
        const stanceRate = 0.20 * dexterityMult(player, 1.0);
        const label = (k) => BATTING_STANCES[k].label;
        if (Math.random() < stanceRate) {
          growthReport.push({ statName: '打撃フォーム改造成功', before: label(currentStance), after: label(targetStance), growth: 0, isAwakening: true });
          const bonus = Math.floor(Math.random() * 3) + 3;
          const oldMeet = player.batting.meet || 50;
          player.batting.meet = Math.min(ABILITY_CAP, oldMeet + bonus);
          if (player.batting.meet !== oldMeet)
            growthReport.push({ statName: 'ミート', before: oldMeet, after: player.batting.meet, growth: player.batting.meet - oldMeet });
        } else {
          growthReport.push({ statName: '打撃フォーム改造', before: label(currentStance), after: label(targetStance), growth: 0 });
          const penalty = Math.floor(Math.random() * 3) + 1;
          const oldMeet = player.batting.meet || 50;
          if (oldMeet > 20) {
            player.batting.meet = Math.max(15, oldMeet - penalty);
            growthReport.push({ statName: 'ミート', before: oldMeet, after: player.batting.meet, growth: player.batting.meet - oldMeet });
          }
        }
      }
      break;
    }
    case 'switch_hit': {
      const currentBats = player.batting?.bats || player.physical?.bats || 'right';
      const targetBats = options.targetBats && options.targetBats !== currentBats
        ? options.targetBats
        : (currentBats === 'switch' ? null : 'switch');
      if (!targetBats || targetBats === currentBats) {
        growthReport.push({ statName: '打席変更', before: BATS_SHORT[currentBats], after: '変更不要', growth: 0 });
        break;
      }
      // ハイリスクハイリターン: switch→片打は30%、片打→switchは15%、片打→反対は20%
      const isToSwitch = targetBats === 'switch';
      const isFromSwitch = currentBats === 'switch';
      // ⚠ 器用さで成功率が動く（器用さ50で従来どおり）。
      //    両打ちへの転向は「新しい形を身につける」の最たるものなので幅は広め
      const successRate = (isToSwitch ? 0.15 : isFromSwitch ? 0.30 : 0.20)
        * dexterityMult(player, 0.9);
      if (Math.random() < successRate) {
        if (!player.batting) player.batting = {};
        player.batting.bats = targetBats;
        growthReport.push({ statName: '打席', before: BATS_SHORT[currentBats], after: BATS_SHORT[targetBats], growth: 0, isAwakening: true });
        // ミート微減リスク（switchへの場合のみ）
        if (isToSwitch && player.batting.meet > 30) {
          const penalty = Math.floor(Math.random() * 3) + 1;
          const oldMeet = player.batting.meet;
          player.batting.meet = Math.max(20, oldMeet - penalty);
          growthReport.push({ statName: 'ミート', before: oldMeet, after: player.batting.meet, growth: player.batting.meet - oldMeet });
        }
      } else {
        growthReport.push({ statName: '打席変更', before: BATS_SHORT[currentBats], after: '変更失敗', growth: 0 });
        // 失敗ペナルティ: ミート-1~2
        if (player.batting?.meet > 25) {
          const penalty = Math.floor(Math.random() * 2) + 1;
          const oldMeet = player.batting.meet;
          player.batting.meet = Math.max(20, oldMeet - penalty);
          growthReport.push({ statName: 'ミート', before: oldMeet, after: player.batting.meet, growth: player.batting.meet - oldMeet });
        }
      }
      break;
    }
    case 'breaking': {
      // 変化球練習（サブ練習版）
      // 合計4〜8ポイントを保有変化球に分配。1球種のみの投手は集中練習として一気に上昇
      if (player.position === 'pitcher' && player.pitching) {
        const arsenal = player.pitching?.arsenal || [];
        const nonStraight = arsenal.filter(p => p.type !== 'straight');
        const playerForm = player.pitching?.form;
        const battVal = staffBonus ? (staffBonus.batteryCoach || 50) : 50;
        const battMult = 0.9 + (battVal / 100) * 0.2;

        if (nonStraight.length > 0) {
          const age = player.age || 20;
          const ageBase = getAgeGrowthBase(age, false);
          const ageMult = Math.max(0.6, 1.0 + ageBase * 0.12); // 0.6〜1.1
          // ⚠ 器用さの幅を 0.15 → **0.30** に広げた（2026-11-24。いしだ「自然成長をやや下げる。
          //    その代わりに器用さをちょっと増やす」）。旧式 `0.85 + dext/100*0.30` は
          //    `dexterityMult(player, 0.15)` と同値で、実測の帯（p5 27・p95 72）では
          //    0.86〜1.13 しか動かず、才能の差がほとんど出ていなかった。
          //    いまは 器用10→0.76 / 50→1.00 / 95→1.27。物差しは共通の `dexterityMult`
          const dextMult = dexterityMult(player, 0.30);

          // 基本プール4〜8ポイント、補正後も整数に丸める
          const rawPool = Math.floor(Math.random() * 5) + 4;
          const effectivePool = Math.max(1, Math.round(rawPool * ageMult * dextMult * battMult));

          // MAXに達した球種は配分対象から除外（プールを無駄にしない）
          const growable = nonStraight.filter(p => p.level < 100);
          const maxed = nonStraight.filter(p => p.level >= 100);

          // MAX球種はレポートに表示するだけ
          maxed.forEach(pitch => {
            growthReport.push({ statName: `${getPitchTypeName(pitch.type)} [MAX]`, before: pitch.level, after: pitch.level, growth: 0 });
          });

          // **1球種を指定して集中練習できる**（options.targetPitch）。
          // 分散させず1つに全ポイントを注ぎ込むので伸びが速い。
          // 習熟度の低い球は「防御率は変わらず四球だけ増える」ので、
          // 封印しつつ1つを集中して磨く、という育成が成立する。
          const focus = options.targetPitch
            ? growable.find(p => p.type === options.targetPitch) : null;
          if (focus) {
            const formAff = getFormPitchAffinity(playerForm, focus.type);
            // 集中練習は分散させないぶん +2（適性があればさらに +1）
            // ⚠ 高レベルの減衰（`dampBreakingGain`）を掛けてから足す
            const growth = dampBreakingGain(focus.level, effectivePool + 2 + (formAff ? 1 : 0));
            const before = focus.level;
            focus.level = Math.min(100, before + growth);
            growthReport.push({
              statName: `${getPitchTypeName(focus.type)}${formAff ? ' [適性]' : ''} [集中]`,
              before, after: focus.level, growth: focus.level - before,
            });
          } else if (growable.length > 0) {
            // プールをレベルアップ可能な球種で均等分配し、余りはランダムな球種に+1
            const count = growable.length;
            const base = Math.floor(effectivePool / count);
            const extraCount = effectivePool - base * count;
            const extraSet = new Set(
              [...Array(count).keys()].sort(() => Math.random() - 0.5).slice(0, extraCount)
            );

            growable.forEach((pitch, i) => {
              const formAff = getFormPitchAffinity(playerForm, pitch.type);
              const formBonus = formAff ? 1 : 0;
              // ⚠ 減衰は**球種ごと**に掛ける（プールの分配は先に済ませる）。
              //    磨き上げた球だけが伸びにくくなり、低い球はそのまま伸びる
              const growth = dampBreakingGain(pitch.level, base + (extraSet.has(i) ? 1 : 0) + formBonus);
              const before = pitch.level;
              pitch.level = Math.min(100, before + growth);
              const affinityTag = formAff ? ' [適性]' : '';
              growthReport.push({ statName: `${getPitchTypeName(pitch.type)}${affinityTag}`, before, after: pitch.level, growth: pitch.level - before });
            });
          }
        }
      }
      break;
    }
    case 'newpitch': {
      // 新球種習得（サブ練習版 - 成功率低め、フォーム適性で確率UP）
      if (player.position === 'pitcher' && player.pitching) {
        const currentArsenal = (player.pitching.arsenal || []).map(a => a.type);
        const available = PITCH_TYPES.filter(t => !currentArsenal.includes(t));
        // フォーム適性のある球種を優先的に選ぶ（50%の確率で適性球種を選択）
        const playerForm = player.pitching?.form;
        const affinityTypes = available.filter(t => getFormPitchAffinity(playerForm, t));
        const useAffinity = affinityTypes.length > 0 && Math.random() < 0.5;
        const candidates = useAffinity ? affinityTypes : available;
        if (available.length > 0) {
          // ⚠ **狙う球種を指定できる**（`options.targetPitch`）。指定が無ければ
          //    従来どおり適性寄りの抽選。指定しても**成功率は上がらない**——
          //    フォーム適性と器用さで決まるので、適性の無い球種は難しいまま。
          const wanted = available.includes(options.targetPitch)
            ? options.targetPitch
            : null;
          const newType =
            wanted || candidates[Math.floor(Math.random() * candidates.length)];
          const formAff = getFormPitchAffinity(playerForm, newType);
          // ⚠ 0.12→0.16→**0.22**・適性の上限 0.25→0.32→**0.40**
          //    （いしだ 2026-11-16「取得率が低い」／2026-11-20「新球種取得の確率が低すぎる気が
          //     します。確認してください」）。オンラインで新球種を覚える道は**このサブ練習だけ**
          //     （`CAMP_MENUS` に newpitch は無い）なので、ここが遅いと一生覚えない。
          //    実測（初期セットの投手137人・器用さ平均53）: 1クール 24.3%→**29.9%**、
          //    4クール続けて1つ以上 66.9%→**75.7%**、平均 0.95→1.21球種
          const baseRate = 0.22;
          // ⚠ フォーム適性を足した**後**に器用さを掛ける。先に掛けると
          //    上限 0.32 のクランプで器用さが消える
          // スリークォーターは適性球が無い代わりに、どの球種も少し覚えやすい（`newPitchLearnBonus`）
          const successRate = Math.min(0.40, baseRate + newPitchLearnBonus(playerForm, newType))
            * dexterityMult(player, 0.8);
          if (Math.random() < successRate) {
            const level = 20 + Math.floor(Math.random() * 20);
            if (!player.pitching.arsenal) player.pitching.arsenal = [{ type: 'straight', level: 50 }];
            player.pitching.arsenal.push({ type: newType, level });
            const affinityTag = formAff ? ' [適性]' : '';
            growthReport.push({ statName: '新球種', before: '-', after: `${getPitchTypeName(newType)}Lv${level}${affinityTag}`, growth: 0, isAwakening: true });
          } else {
            growthReport.push({ statName: '新球種', before: '-', after: '習得失敗', growth: 0 });
          }
        } else {
          growthReport.push({ statName: '新球種', before: '-', after: '習得済み', growth: 0 });
        }
      }
      break;
    }
    case 'spin_analysis': {
      if (!player.pitching) break;
      // スピン（回転数）+1〜3（器用さで上下）
      // ⚠ **器用さが効いていなかった**（2026-11-25 の実測。器用72 が 0.97倍で器用50 を
      //    下回っていた）。原因は `Math.max(1, Math.min(3, Math.round(生の1〜3 × 倍率)))`。
      //    上限3と `Math.round` で倍率が潰れ、下限1で低い側も持ち上がっていた。
      //    他の練習と同じ「掛けてから最後に確率的に丸める」形にする（`stochasticRound`）。
      //    倍率の幅は元の式（`0.5 + dex/100`）と同じ 0.5＝共通の `dexterityMult(player, 0.5)`。
      const oldSpin = player.pitching.spinRate || 50;
      if (oldSpin < 100) {
        const rawSpin = Math.floor(Math.random() * 3) + 1; // 1〜3
        const spinGrowth = stochasticRound(rawSpin * dexterityMult(player, 0.5));
        if (spinGrowth > 0) {
          const newSpin = Math.min(100, oldSpin + spinGrowth);
          player.pitching.spinRate = newSpin;
          growthReport.push({ statName: 'スピン', before: oldSpin, after: newSpin, growth: newSpin - oldSpin });
        }
      }
      // 持ち球の**全部**が +1 程度（器用さで上下）。
      // ⚠ いしだ 2026-11-25「スピン練習は、変化球にも1程度全部が伸びるようにしましょうか」。
      //    前は「1球種だけ +2〜4」で、変化球練習（プールを配る）と役目が重なっていた。
      //    全部を少しずつにすると「持ち球の多い投手ほど得」＝変化球練習（1つに寄せられる）と
      //    役目が分かれる。合計は 2球種で約2・5球種で約5（前はどちらも約3）。
      // ⚠ 天井は変化球練習と**同じ物差し**（`dampBreakingGain`）。掛けないと
      //    「変化球練習が止まったらスピン解析で磨く」に流れるだけで抜けが残る
      //    （直す前の実測で Lv30 でも Lv95 でも +3.0 固定だった）
      const arsenal = player.pitching.arsenal || [];
      for (const pitch of arsenal) {
        if (pitch.type === 'straight' || (pitch.level || 0) >= 100) continue;
        const oldLv = pitch.level || 0;
        const lv = dampBreakingGain(oldLv, 1 * dexterityMult(player, 0.5));
        if (lv <= 0) continue;
        pitch.level = Math.min(100, oldLv + lv);
        growthReport.push({ statName: `${getPitchTypeName(pitch.type)}LV`, before: oldLv, after: pitch.level, growth: pitch.level - oldLv });
      }
      // 制球 +0〜1（40%の確率・高能力値減衰あり）
      if (Math.random() < 0.4) {
        const oldCtrl = player.pitching.control || 50;
        const ctrlGain = applyTechStatDecay(oldCtrl, 1);
        if (ctrlGain > 0) {
          player.pitching.control = Math.min(ABILITY_CAP, oldCtrl + ctrlGain);
          growthReport.push({ statName: '制球', before: oldCtrl, after: player.pitching.control, growth: ctrlGain });
        }
      }
      break;
    }
    case 'clead_study': {
      if (!player.catching) player.catching = {};
      const batteryValue = staffBonus ? (staffBonus.batteryCoach || 50) : 50;
      const batteryMult = 0.7 + (batteryValue / 100) * 0.6;
      const rawGain = Math.floor(Math.random() * 3) + 1; // 1~3
      const gain = Math.max(1, Math.round(rawGain * batteryMult));
      const old = player.catching.lead || 40;
      player.catching.lead = Math.min(ABILITY_CAP, old + gain);
      growthReport.push({ statName: 'Cリード', before: old, after: player.catching.lead, growth: gain });
      break;
    }
    case 'long_throw': {
      if (player.physical) {
        // 肩力は才能依存が強いため半減（50%の確率で適用）
        const armRaw = Math.random() < 0.5 ? (Math.random() < 0.35 ? 3 : Math.random() < 0.5 ? 2 : 1) : (Math.random() < 0.3 ? 1 : 0);
        const armRawHalved = Math.random() < 0.5 ? armRaw : 0;
        if (armRawHalved > 0) {
          const oldArm = player.physical.arm || 50;
          const armGain = Math.min(armRawHalved, 100 - oldArm);
          if (armGain > 0) {
            player.physical.arm = oldArm + armGain;
            growthReport.push({ statName: '肩力', before: oldArm, after: player.physical.arm, growth: armGain });
            if (player.pitching) {
              const armNow = player.physical.arm;
              const velChange = Math.round(armGain * 0.6 * getVelocityCatchupMult(armNow, player.pitching.velocity || 120));
              if (velChange > 0) {
                const oldVel = player.pitching.velocity || 120;
                const newVel = Math.min(getVelocityCap(armNow), oldVel + velChange);
                if (newVel > oldVel) {
                  player.pitching.velocity = newVel;
                  growthReport.push({ statName: '球速', before: oldVel, after: newVel, growth: newVel - oldVel, isLinked: true });
                }
              }
            }
          }
        }
      }
      // 回転（ノビ）: 投手は遠投で回転数を伸ばせる（20%で+0、40%で+1、30%で+2、10%で+3）
      if (player.pitching) {
        const spinRoll = Math.random();
        const spinRaw = spinRoll < 0.2 ? 0 : spinRoll < 0.6 ? 1 : spinRoll < 0.9 ? 2 : 3;
        if (spinRaw > 0) {
          const oldSpin = player.pitching.spinRate || 50;
          if (oldSpin < 100) {
            const spinGain = Math.min(spinRaw, 100 - oldSpin);
            player.pitching.spinRate = oldSpin + spinGain;
            growthReport.push({ statName: '回転/ノビ', before: oldSpin, after: player.pitching.spinRate, growth: spinGain });
          }
        }
      }
      break;
    }
    case 'eye': {
      const eyeRaw = growthAmount();
      if (eyeRaw > 0 && player.batting) {
        const old = player.batting.eye || 50;
        const eyeGain = applyTechStatDecay(old, eyeRaw);
        if (eyeGain > 0) {
          player.batting.eye = Math.min(ABILITY_CAP, old + eyeGain);
          growthReport.push({ statName: '選球眼', before: old, after: player.batting.eye, growth: eyeGain });
        }
      }
      break;
    }
    case 'subposition': {
      // 本職の守備（もと「守備補強」の中身）: 守備+0〜2（40%）・今の守備位置の適正を確定で+4〜8。
      // ⚠ 指定ポジションの適正より**先に**やる。後の `syncPositionToFitness` で守備位置が
      //    変わると（CPU球団）、上げる「今の守備位置」がずれる
      const defRaw = growthAmount();
      if (defRaw > 0 && player.fielding) {
        const oldDef = player.fielding.defense || 50;
        const def = applyTechStatDecay(oldDef, defRaw, EFFORT_DAMP.defense);
        if (def > 0) {
          player.fielding.defense = Math.min(ABILITY_CAP, oldDef + def);
          growthReport.push({ statName: '守備', before: oldDef, after: player.fielding.defense, growth: def });
        }
      }
      if (!player.positionFitness) player.positionFitness = {};
      if (player.position && player.position !== 'pitcher') {
        const curPos = player.position;
        const oldFit = player.positionFitness[curPos] || 0;
        if (oldFit < 100) {
          const gain = Math.floor(Math.random() * 5) + 4;
          player.positionFitness[curPos] = Math.min(100, oldFit + gain);
          growthReport.push({ statName: `${POSITION_NAMES_MAP[curPos] || curPos}適正`, before: oldFit, after: player.positionFitness[curPos], growth: player.positionFitness[curPos] - oldFit });
        }
      }
      // サブポジション練習 - 指定ポジションまたはランダムの適正を上げる（成長3倍）
      const allPos = ['catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];
      const nonMainPos = allPos.filter(p => p !== player.position);
      let picked = options.targetPosition;
      if (!picked || picked === player.position || !allPos.includes(picked)) {
        // 「自動」は**既に高い適性を100へ寄せる**のを優先する。
        // 半端な適性をいくつも作るより、1つを守れる水準まで上げ切るほうが使える
        // （`lineupGenerator` は適性の高い選手をそのポジションに置くため）。
        // ⚠ 以前は「80未満の弱いポジションからランダム」で、狙いが逆だった。
        const room = nonMainPos.filter(p => (player.positionFitness[p] || 0) < 100);
        const pool = room.length > 0 ? room : nonMainPos;
        const top = pool.reduce((m, p) => Math.max(m, player.positionFitness[p] || 0), -1);
        // ⚠ 同点は必ず起きる（投手は全ポジション一律30、野手も横並びになりうる）。
        //    `reduce` で最大値を1つ選ぶと配列の先頭＝常に捕手になるので、同点内で引く。
        const best = pool.filter(p => (player.positionFitness[p] || 0) === top);
        picked = best[Math.floor(Math.random() * best.length)];
      }
      if (picked) {
        // 3倍成長: 元(50%で0,30%で3,20%で5) → 常に成長、9-15程度
        // ⚠ 器用さで伸び幅が動く（器用さ50で従来どおり 9-15）。
        //    新しい守備位置を覚えるのは器用さの仕事。幅は控えめ（毎クール掛かるため）
        const baseGain = Math.max(1, Math.round(
          (Math.floor(Math.random() * 7) + 9) * dexterityMult(player, 0.4)));
        const old = player.positionFitness[picked] || 0;
        player.positionFitness[picked] = Math.min(100, old + baseGain);
        const actual = player.positionFitness[picked] - old;
        growthReport.push({ statName: `${POSITION_NAMES_MAP[picked] || picked}適正`, before: old, after: player.positionFitness[picked], growth: actual });
        // ⚠ **人の球団（一人用の自分の球団）は守備位置を動かさない**（`keepPosition`）。
        //    守備位置は編成の画面で決めるもので、サブポジ練習の後の適性への合わせで黙って変えない
        //    （方針「短所を埋める×技術」はサブポジ練習になるので、遊撃手が二塁へ移っていた。
        //    実測 200人中90人）。オンラインの人の球団と同じ規則（`runCampRound` の `keepPosition`）。
        //    CPU球団は今までどおり適性に合わせる
        if (!options.keepPosition) syncPositionToFitness(player);
      }
      break;
    }
  }

  return { player, growthReport };
}

const POSITION_NAMES_MAP = { pitcher: '投', catcher: '捕', first: '一', second: '二', third: '三', short: '遊', left: '左', center: '中', right: '右' };

/**
 * シーズン終了時に経験値を集計
 * 投手: 登板数 + 投球回数
 * 野手: 出場試合数 + 打席数/3
 * フル稼働で年間約250ポイント
 * @param {Object} player - 選手データ
 */
export function calculateSeasonExperience(player) {
  const pitchingStats = player.seasonStats?.pitching || {};
  const battingStats = player.seasonStats?.batting || {};

  const pitcherExp = (pitchingStats.games || 0) + Math.floor(pitchingStats.inningsPitched || 0);
  const batterExp = (battingStats.games || 0) + Math.floor((battingStats.atBats || 0) / 3);

  // 投手はピッチング経験を、野手はバッティング経験を採用
  const isPitcher = player.position === 'pitcher';
  return isPitcher ? pitcherExp : batterExp;
}

/**
 * 全選手の経験値を更新（シーズン終了時に呼ぶ）
 * @param {Object} allTeams - 全チームデータ
 */
export function updateAllPlayersExperience(allTeams) {
  const updatedTeams = {};

  Object.entries(allTeams).forEach(([teamName, team]) => {
    updatedTeams[teamName] = {
      ...team,
      players: team.players.map(player => {
        const gainedExp = calculateSeasonExperience(player);
        return {
          ...player,
          experience: (player.experience || 0) + gainedExp
        };
      })
    };
  });

  return updatedTeams;
}

/**
 * ポジション経験による成長ボーナス倍率を算出
 * 外野: バランス成長、二塁/遊撃: 走力・守備、三塁/一塁: 打撃、捕手: 守備・肩
 */
function getPositionGrowthBonus(player, targetStat) {
  const posExp = player.positionExperience || {};
  const totalGames = Object.values(posExp).reduce((a, b) => a + b, 0);
  if (totalGames === 0) return 1.0;

  // 各ポジションの成長傾向（stat → bonus倍率）
  const positionBonusMap = {
    // 二塁・遊撃: 走力、守備が伸びやすい
    second:  { speed: 1.4, defense: 1.4, steal: 1.3, bunt: 1.2, arm: 1.1, meet: 1.0, power: 0.9 },
    short:   { speed: 1.4, defense: 1.4, steal: 1.3, bunt: 1.2, arm: 1.2, meet: 1.0, power: 0.9 },
    // 三塁・一塁: 打撃が伸びやすい
    third:   { power: 1.4, meet: 1.3, arm: 1.2, defense: 1.0, speed: 0.9, steal: 0.9, bunt: 0.9 },
    first:   { power: 1.5, meet: 1.4, eye: 1.2, defense: 0.9, speed: 0.9, steal: 0.8, bunt: 0.8 },
    // 外野: バランス成長
    left:    { speed: 1.2, meet: 1.1, power: 1.1, arm: 1.1, defense: 1.1, steal: 1.1, bunt: 1.0 },
    center:  { speed: 1.3, defense: 1.2, meet: 1.1, steal: 1.2, bunt: 1.1, arm: 1.0, power: 1.0 },
    right:   { arm: 1.3, power: 1.2, meet: 1.1, speed: 1.1, defense: 1.1, steal: 1.0, bunt: 0.9 },
    // 捕手: 守備・肩が伸びやすい
    catcher: { defense: 1.5, arm: 1.4, meet: 1.0, bunt: 1.0, power: 0.9, speed: 0.8, steal: 0.8 },
  };

  // 加重平均でボーナスを計算
  let weightedBonus = 0;
  Object.entries(posExp).forEach(([pos, games]) => {
    const bonusMap = positionBonusMap[pos] || {};
    const bonus = bonusMap[targetStat] || 1.0;
    weightedBonus += bonus * (games / totalGames);
  });

  return weightedBonus || 1.0;
}

/**
 * 打順経験による成長ボーナス倍率を算出
 * 1番: 走力、2-3番: バランス、4番: パワー、5番: パワー/打撃、下位: 守備
 */
function getBattingOrderGrowthBonus(player, targetStat) {
  const boExp = player.battingOrderExperience || {};
  const totalGames = Object.values(boExp).reduce((a, b) => a + b, 0);
  if (totalGames === 0) return 1.0;

  const orderBonusMap = {
    1: { speed: 1.4, steal: 1.4, bunt: 1.3, meet: 1.2, eye: 1.2, power: 0.9 },
    2: { meet: 1.3, bunt: 1.3, speed: 1.2, eye: 1.2, steal: 1.1, power: 1.0, defense: 1.0 },
    3: { meet: 1.3, power: 1.2, eye: 1.1, speed: 1.1, defense: 1.0, bunt: 0.9 },
    4: { power: 1.5, meet: 1.2, eye: 1.1, speed: 0.9, steal: 0.8, bunt: 0.7 },
    5: { power: 1.3, meet: 1.2, eye: 1.1, arm: 1.0, bunt: 0.8 },
    6: { defense: 1.2, meet: 1.1, power: 1.1, arm: 1.1, bunt: 1.0 },
    7: { defense: 1.2, arm: 1.1, bunt: 1.1, meet: 1.0, speed: 1.1 },
    8: { defense: 1.3, arm: 1.2, bunt: 1.2, speed: 1.1 },
    9: { bunt: 1.2 },
  };

  let weightedBonus = 0;
  Object.entries(boExp).forEach(([order, games]) => {
    const bonusMap = orderBonusMap[parseInt(order)] || {};
    const bonus = bonusMap[targetStat] || 1.0;
    weightedBonus += bonus * (games / totalGames);
  });

  return weightedBonus || 1.0;
}

// フォーム別の変化球適性（習得しやすさ・成長ボーナス）
// affinity: 習得成功率ボーナス(加算), growth: 変化球練習の成長倍率
// ⚠ **どの球種が適性かは試合の表（`constants.js` の `FORM_PITCH_SYNERGY`）が正本**。
//    以前はここに別の一覧があり、アンダースローの適性がキャンプでは changeup・twoSeam、
//    試合では sinker・curve・palm と食い違っていた（「相性◎」で練習した球が試合では×0.88）。
//    ここで決めるのは**適性球のボーナスの大きさだけ**。`FORM_PITCH_STRONG` に無い適性球は
//    標準（+0.10・×1.3）。スリークォーターは試合の表で「すべて平均」なので適性球は無い。
// ⚠ 大学の新球種（`universityPool` の UNI_FORM_PITCH_AFFINITY）はこの表のキーの順
//    （＝`FORM_PITCH_SYNERGY` の並び）を使う
const FORM_PITCH_DEFAULT_AFF = { affinity: 0.10, growth: 1.3 };
const FORM_PITCH_STRONG = {
  overhand: { fork: { affinity: 0.15, growth: 1.5 } },
  sidearm: { sinker: { affinity: 0.15, growth: 1.5 } },
  submarine: { sinker: { affinity: 0.20, growth: 1.7 } },
};
export const FORM_PITCH_AFFINITY = Object.fromEntries(
  Object.entries(FORM_PITCH_SYNERGY).map(([form, list]) => [form, Object.fromEntries(
    list.map(t => [t, { ...(FORM_PITCH_STRONG[form]?.[t] || FORM_PITCH_DEFAULT_AFF) }]))]));

function getFormPitchAffinity(form, pitchType) {
  return FORM_PITCH_AFFINITY[form]?.[pitchType] || null;
}

/**
 * 新球種の**覚えやすさ**の加算（キャンプだけ。試合の効き目には関わらない）。
 * 適性球ならその `affinity`。適性球の無い「すべて平均」のフォーム（スリークォーター）は、
 * どの球種でも `ALL_ROUND_LEARN_BONUS` だけ覚えやすい。
 * ⚠ いしだ 2026-11-23「おねがいします」（案A）。相性の表を試合の表 1 つにしたら、
 *    スリークォーターは適性球が無くなり、新球種の取得が 1クール約30%→約22% に落ちた。
 *    試合の表に適性球を足すと他の球が ×0.88 に弱くなる（標準のフォームなので影響が大きい）ので、
 *    試合はそのまま「すべて平均」とし、キャンプの覚えやすさだけ戻す。
 *    +0.08 は、他のフォームの実測（1クール約30〜31%・4クールで約75%）にそろうように選んだ
 */
const ALL_ROUND_LEARN_BONUS = { threeQuarter: 0.08 };
function newPitchLearnBonus(form, pitchType) {
  const aff = getFormPitchAffinity(form, pitchType);
  if (aff) return aff.affinity;
  return FORM_PITCH_SYNERGY[form]?.length === 0 ? (ALL_ROUND_LEARN_BONUS[form] || 0) : 0;
}

// 速球系変化球・緩急系変化球の分類
const FAST_PITCH_TYPES = ['slider', 'cutter', 'sinker', 'twoSeam', 'shoot'];
const SLOW_PITCH_TYPES = ['curve', 'changeup', 'fork', 'splitter', 'palm', 'knuckle'];

// 保有球種の緩急バランスから第2適性を算出（球種習得のたびに動的更新）
// 速球系≥緩急系なら緩急系から、逆なら速球系から補完するよう選ぶ
export function calcSecondAffinity(arsenal) {
  const existingTypes = arsenal.map(p => p.type);
  const fastCount = existingTypes.filter(t => FAST_PITCH_TYPES.includes(t)).length;
  const slowCount = existingTypes.filter(t => SLOW_PITCH_TYPES.includes(t)).length;
  const pool = fastCount >= slowCount ? SLOW_PITCH_TYPES : FAST_PITCH_TYPES;
  const candidates = pool.filter(t => !existingTypes.includes(t));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * キャンプ練習を実行（1クール分）
 * 成長量は1/4に調整済み
 * @param {Object} player - 選手データ
 * @param {string} trainingType - 練習メニューのキー
 * @param {string} [newPitchType] - 新球種習得時の球種キー
 * @returns {Object} - 成長結果 { player, growthReport }
 */
export function executeCampTraining(player, trainingType, newPitchType, staffBonus = null, awakeningMult = 1.0, moodMult = 1.0, { spendExperience = true } = {}) {
  const menu = TRAINING_MENUS[trainingType];
  if (!menu) {
    console.warn(`Unknown training type: ${trainingType}`);
    return { player, growthReport: [] };
  }

  const experience = player.experience || 0;
  const age = player.age || 20;
  const growthReport = [];
  let updatedPlayer = JSON.parse(JSON.stringify(player));

  // 全選手があらゆる練習を受けられるよう、不足する能力オブジェクトをデフォルト値で初期化
  if (!updatedPlayer.batting) {
    updatedPlayer.batting = { meet: 0, power: 0, eye: 0, steal: 0, bunt: 0, bats: 'right' };
  }
  if (!updatedPlayer.pitching) {
    updatedPlayer.pitching = { velocity: 110, control: 30, stamina: 80, spinRate: 30, form: 'threeQuarter', arsenal: [{ id: 1, type: 'straight', level: 30 }] };
  }
  if (!updatedPlayer.fielding) {
    updatedPlayer.fielding = { defense: 0 };
  }

  // スタッフ指導補正: 練習カテゴリに対応するスタッフ能力で0.7〜1.3倍
  const staffAbilityKey = CATEGORY_TO_STAFF_ABILITY[menu.category];
  const staffAbilityValue = staffBonus && staffAbilityKey ? (staffBonus[staffAbilityKey] || 50) : 50;
  const coachingMult = 0.7 + (staffAbilityValue / 100) * 0.6;

  // フィットネス補正: フィジカル系能力の練習に0.8〜1.2倍
  const fitnessValue = staffBonus ? (staffBonus.fitness || 50) : 50;
  const fitnessMult = 0.8 + (fitnessValue / 100) * 0.4;

  // バッテリー指導補正: 制球練習に0.9〜1.1倍（投手コーチが主、バッテリーは補助）
  const batteryValue = staffBonus ? (staffBonus.batteryCoach || 50) : 50;
  const batteryMult = 0.9 + (batteryValue / 100) * 0.2;

  // 新球種習得の場合（覚醒10%/大成功15%/成功20%/習得33%/失敗22%）
  if (trainingType === 'newpitch') {
    const arsenal = updatedPlayer.pitching?.arsenal || [];
    const existingTypes = arsenal.map(p => p.type);
    // newPitchTypeが指定されていても既習得済みなら無視して自動選択（クール間の選択状態が古くなる場合の対策）
    const validNewPitchType = newPitchType && !existingTypes.includes(newPitchType) ? newPitchType : null;
    const targetType = validNewPitchType || ALL_PITCH_TYPES.find(t => !existingTypes.includes(t));
    if (targetType && !existingTypes.includes(targetType)) {
      // フォーム適性ボーナス（適性球種は失敗率が下がる）
      const formAff = getFormPitchAffinity(updatedPlayer.pitching?.form, targetType);
      const formBonus = newPitchLearnBonus(updatedPlayer.pitching?.form, targetType);
      // 第2適性（緩急補完）ボーナス
      const hasSecondAffinity = updatedPlayer.pitching?.secondAffinity === targetType;
      const affinityBonus = formBonus + (hasSecondAffinity ? 0.08 : 0);
      // 基本: 覚醒10%, 大成功15%, 成功20%, 習得33%, 失敗22%
      // 適性ボーナス分だけ失敗率が減り、成功率に上乗せ
      // ⚠ ここに `failRate = max(0.05, 0.30 - affinityBonus)` があったが、
      //    **計算するだけで一度も使われていなかった**（実際の失敗率は
      //    `1 - (0.45 + learnedRate)` ＝ `0.30 - affinityBonus*0.5` で決まる）。
      //    適性ボーナスの効きを読み違える元なので除去した
      // ⚠ 0.25→0.33（先方指摘 2026-11-16: 新球種の取得率が低い。若干上げる）。失敗 30%→22%
      const learnedRate = 0.33 + affinityBonus * 0.5;
      // ⚠ 器用さは**抽選そのものを上へずらす**（器用さ50で従来どおり）。
      //    `affinityBonus` は失敗↔習得(Lv1-20)しか動かさないので、そこへ足すと
      //    「器用な投手は覚えが早い＝最初から高いレベル」が表現できない。
      //    実測 器用さ87 で 覚醒10%→16% / 失敗30%→24%、器用さ5 で 覚醒2.8% / 失敗37%
      const roll = Math.random() - dexterityShift(updatedPlayer, 0.08);
      const outcome = roll < 0.10 ? 'awakening'
        : roll < 0.25 ? 'great_success'
        : roll < 0.45 ? 'success'
        : roll < (0.45 + learnedRate) ? 'learned'
        : 'failure';
      const affinityTag = (formAff && hasSecondAffinity) ? ' [フォーム+緩急適性]'
        : formAff ? ' [フォーム適性]'
        : hasSecondAffinity ? ' [緩急適性]'
        : '';
      if (outcome === 'failure') {
        growthReport.push({
          stat: 'newpitch',
          statName: `${getPitchTypeName(targetType)}習得失敗${affinityTag}`,
          before: 0, after: 0, growth: 0, isAwakening: false
        });
      } else {
        const newId = arsenal.length > 0 ? Math.max(...arsenal.map(a => a.id)) + 1 : 1;
        let startLevel, label;
        if (outcome === 'awakening') {
          startLevel = Math.floor(Math.random() * 20) + 61;
          label = '(覚醒!!)';
        } else if (outcome === 'great_success') {
          startLevel = Math.floor(Math.random() * 20) + 41;
          label = '(大成功!)';
        } else if (outcome === 'success') {
          startLevel = Math.floor(Math.random() * 20) + 21;
          label = '';
        } else {
          startLevel = Math.floor(Math.random() * 20) + 1;
          label = '';
        }
        arsenal.push({ id: newId, type: targetType, level: startLevel });
        updatedPlayer.pitching.arsenal = arsenal;
        // 球種構成が変わったので第2適性を動的に再計算
        updatedPlayer.pitching.secondAffinity = calcSecondAffinity(arsenal);
        growthReport.push({
          stat: 'newpitch',
          statName: `${getPitchTypeName(targetType)}習得${label}${affinityTag}`,
          before: 0, after: startLevel, growth: startLevel, isAwakening: outcome === 'awakening'
        });
      }
    } else {
      growthReport.push({
        stat: 'newpitch',
        statName: '習得失敗（全球種習得済み）',
        before: 0, after: 0, growth: 0, isAwakening: false
      });
    }
    return { player: updatedPlayer, growthReport };
  }

  // 成長停止年齢: gp(個人差) + 疲労管理(growthModifier) + プロ意識で延長
  // 停止後もdisciplineが高ければ練習で微量カバー可能
  // ⚠ 式は `growthStopAge` / `postStopTrainEffect` に出してある
  const _stopAge = growthStopAge(player);
  // stopAge到達後: discipline次第で衰えをカバー（discipline 50→0%, 80→9%, 100→15%）
  const _postStopFloor = postStopTrainEffect(player);
  // stopAge4年前から緩やかに減衰 → 停止後はpostStopFloorのみ
  const stopAgeGate = age >= _stopAge
    ? _postStopFloor
    : Math.max(_postStopFloor, 1.0 - Math.max(0, age - (_stopAge - 4)) / 4 * (1.0 - _postStopFloor));

  // 集中練習の代償は**対象の伸びが決まってから**引く（`INTENSIVE_COST`）。
  // ⚠ 以前は「50%で±0・25%で1能力-1・25%で2能力-1」を**先に**引いていた。
  //    伸びと無関係な固定の代償だったので、頭打ちの帯では総量が負になっていた。
  //    対象に入った伸びを受け取るための箱（集中メニューの対象は必ず1つ）
  let intensiveGain = 0;

  // 通常の能力練習（成長量抑制: プロ級へ到達しにくくする）
  menu.targets.forEach((targetStat, targetIdx) => {
    const isPhysical = PHYSICAL_STATS.includes(targetStat);
    const ageBase = getAgeGrowthBase(age, isPhysical);
    const ageMultiplier = Math.max(0.3, 1.0 + ageBase * 0.10);
    const posBonus = getPositionGrowthBonus(player, targetStat);
    const boBonus = getBattingOrderGrowthBonus(player, targetStat);
    const expBonus = posBonus * boBonus;

    // 技術系は経験で伸びる、フィジカル系は若さで伸びる
    let aptitudeFactor = 1.0;
    if (isPhysical) {
      // フィジカル: 若いほど鍛えやすい
      if (age <= 20) aptitudeFactor = 1.3;
      else if (age <= 23) aptitudeFactor = 1.1;
      else if (age <= 26) aptitudeFactor = 1.0;
      else if (age <= 29) aptitudeFactor = 0.8;
      else aptitudeFactor = 0.6;
    } else {
      // 技術系: 経験で伸びる。初年度でも基本練習の効果が出るよう最低1.0に設定
      // 旧0.7スタートは他の掛け算(0.14×discipline等)と組み合わさって常に0になっていた
      aptitudeFactor = Math.min(1.2, 1.0 + (experience / 300));
    }

    // 才能依存の能力は練習だけでは伸びにくい（グローバル補正）
    // ⚠ ミート・パワーは伸びを少し下げる（`CAMP_BAT_GROWTH_MULT`。ふだんの伸び・集中・覚醒の量）
    const talentMult = TALENT_STAT_MULTIPLIERS[targetStat] ?? 1.0;
    const batGrowthMult = CAMP_BAT_GROWTH_MULT[targetStat] ?? 1.0;

    // 体幹/器用さによる成長方向の補正（0.5〜1.5倍）
    const physiqueMult = physiqueMultFor(player, targetStat);
    // プロ意識による練習効率（プロ意識0=50%, 50=100%, 100=150%）
    const discipline = player.personality?.discipline ?? 50;
    const disciplineMult = 0.5 + (discipline / 100) * 1.0;
    // 成長率のキャンプ影響（30%: 成長率1.4→1.12倍, 0.6→0.88倍）
    const potential = Math.max(0.3, Math.min(1.8, (player.growthPotential ?? 1.0) + (player.growthModifier || 0)));
    const campPotMult = 0.7 + 0.3 * potential;

    // ⚠ `rawGrowth` は**丸める前の小数**。フォーム補正・球速の追いつき・高能力の
    //    減衰を全部掛けてから、最後に1回だけ確率的に丸める（下の adjustedBaseGrowth）。
    //    先に丸めると 0/1 にしかならず、×0.8〜1.2 や減衰を `Math.round` すると
    //    制球65〜77で減衰が効かず、78以上で伸びが0に落ちる崖になっていた（監査 2026-11-13）。
    let rawGrowth, isAwakening, awakeningGrowth;

    if (menu.intensive && menu.penaltyPool) {
      // 集中練習＝「長所を伸ばす」の実体。
      // ⚠ 以前はここが **+1確定・50%で+1〜2 の固定値**で、年齢・プロ意識・
      //    コーチ・成長力・体格をすべて**素通り**していた。1クールあたり約1.75しか
      //    入らないのに他能力に減点が付くので、**どの水準の選手でも
      //    「満遍なく」に負ける**（実測 ドラフト評価 211 対 230）。
      //    集中する意味が数字の上で一度も無かった。
      // 通常メニューと同じ式で出してから1点に集約する。
      // ⚠ **能力ごとの抑えは掛けない**（上の「集中練習」の注の (2)）。
      //    `batGrowthMult`（ミート・パワー 0.8）と制球の `focusStatMult`（投げ込みの係数）は
      //    リーグの流れを抑えるための調整なので、集中の差し引きがメニューごとに変わってしまう。
      //    才能の抑え（`talentMult`）だけは残す。
      const rawBase = (Math.floor(Math.random() * 3) + 1) * ageMultiplier * expBonus;
      const rawFocus = (Math.floor(Math.random() * 4) + 1) * ageMultiplier * expBonus;
      rawGrowth = ((rawBase + rawFocus) * 0.14 * INTENSIVE_FOCUS
        * talentMult * aptitudeFactor * physiqueMult * disciplineMult
        * campPotMult * coachingMult * moodMult * (isPhysical ? fitnessMult : 1.0) * stopAgeGate);
      isAwakening = false;
      awakeningGrowth = 0;
    } else {
      const rawBase = (Math.floor(Math.random() * 3) + 1) * ageMultiplier * expBonus;
      const rawFocus = (Math.floor(Math.random() * 4) + 1) * ageMultiplier * expBonus;
      const statMultiplier = menu.growthMultipliers?.[targetStat] ?? 1.0;
      const physFitMult = isPhysical ? fitnessMult : 1.0;
      const battCoachMult = targetStat === 'control' ? batteryMult : 1.0;
      // ⚠ **`Math.round` ではなく確率的丸め**。1クールの伸びは係数を全部
      //    掛けると 0.3〜0.9 にしかならず、`Math.round` では 0.5 を境に
      //    「必ず+1」か「必ず0」に潰れていた。才能係数（走力0.4・肩0.3）も
      //    メニューの係数（制球0.7）も、0.5をまたがない限り**一度も効かない**。
      //    端数の確率で切り上げれば期待値がそのまま残り、係数が素直に効く
      //    （年次成長の `growthSystem` が同じ理由で先に入れている）
      rawGrowth = ((rawBase + rawFocus) * 0.14 * statMultiplier * batGrowthMult * talentMult * aptitudeFactor * physiqueMult * disciplineMult * campPotMult * coachingMult * moodMult * physFitMult * battCoachMult * stopAgeGate);
      if ((targetStat === 'stamina' || targetStat === 'bodyStamina') && rawGrowth < 1) rawGrowth = 1;
      // 覚醒判定（経験値 × プロ意識の相乗効果）
      // discipline < 30: 努力しない選手は飛躍しない（係数0）
      // discipline = 50: 標準(1.0倍), 70→2.0倍, 100→2.5倍（上限）
      const awakeningDisciplineFactor = discipline < 30
        ? 0
        : Math.min(2.5, (discipline - 30) / 20);
      const awakeningChance = experience >= 30
        ? Math.min(AWAKENING_EXPERIENCE_CAP, experience / FULL_SEASON_EXPERIENCE)
          * AWAKENING_PER_ROUND * awakeningMult * awakeningDisciplineFactor
        : 0;
      isAwakening = awakeningMult > 0 && Math.random() * 100 < awakeningChance;
      // 才能依存の能力は覚醒量も抑制
      const rawAwakening = isAwakening ? Math.floor(Math.random() * 4) + 3 : 0;
      // ⚠ **高い能力では覚醒の伸びも抑える**（いしだ 2026-11-20。`awakeningHighStatDamp`）。
      //    70未満は素通し。ここで現在値が要るので、先に引いておく
      const awakeningBase = getStatPath(targetStat)
        ? (getNestedValue(updatedPlayer, getStatPath(targetStat)) ?? 0)
        : 0;
      awakeningGrowth = isAwakening
        ? Math.max(1, Math.round(rawAwakening * talentMult * batGrowthMult * awakeningHighStatDamp(awakeningBase)))
        : 0;
    }

    const statPath = getStatPath(targetStat);
    if (statPath) {
      const currentValue = getNestedValue(updatedPlayer, statPath) ?? 0;

      // フォーム別成長補正（オーバー→球速伸びやすい、アンダー→制球伸びやすい）
      const formEffect = PITCHING_FORM_EFFECTS[updatedPlayer.pitching?.form] || PITCHING_FORM_EFFECTS.threeQuarter;
      let growthMult = 1.0;
      if (targetStat === 'velocity') growthMult *= (formEffect.velocityGrowthMult || 1.0);
      else if (targetStat === 'control') growthMult *= (formEffect.controlGrowthMult || 1.0);

      // 肩力ポテンシャルとのギャップによるキャッチアップ（球速のみ）
      if (targetStat === 'velocity') {
        const armVal = getNestedValue(updatedPlayer, getStatPath('arm')) || 50;
        growthMult *= getVelocityCatchupMult(armVal, currentValue);
      }

      // 高能力値の成長減衰（ふだんの伸び）。
      // ⚠ **覚醒には別の抑え**（`awakeningHighStatDamp`。いしだ 2026-11-20「能力80台から
      //    4クールで+6は上がりすぎ。能力が低い場合はいまの伸びのままでOK」）。
      //    ここの `dampFactor` が掛かるのは `adjustedBaseGrowth` だけで、覚醒ぶんは
      //    上の `awakeningGrowth` で別に抑えてから足す（70未満は素通し）。
      // ⚠ **曲線は `highStatDamp` が1本で持つ**（集中のときは「平らな帯のあとゼロへ」の形に
      //    差し替える。上の「集中練習」の注の (3) と `INTENSIVE_ZERO_SHIFT`）。しきい値と率を2箇所に書かないこと。
      const isIntensive = !!(menu.intensive && menu.penaltyPool);
      let dampCurve;
      if (targetStat === 'velocity') {
        // ⚠ 球速の天井は**肩の上限までの距離**で決める（いしだ 2026-11-25）。
        //    前は絶対値 155km からだったので、**肩の低い投手には天井が存在しなかった**
        //    （肩60の上限は137kmで、155に届かないため減衰が一度も効かない）。
        //    `getVelocityCap(肩)` の `VELOCITY_DAMP_WINDOW` km 手前から効かせると、
        //    肩60でも肩100でも上限手前で鈍る。⚠ 集中では `highStatDamp` が集中用の形に直すので、
        //    減り始めは上限の13.5km手前・ゼロは上限の2.5km先（満遍なくより少し早く鈍り、最後は0。監査16）。
        const armForDamp = getNestedValue(updatedPlayer, getStatPath('arm')) || 50;
        dampCurve = { from: getVelocityCap(armForDamp) - VELOCITY_DAMP_WINDOW, rate: 0.2, floor: 0.1 };
      } else if (isPhysical) {
        // フィジカル系(speed/arm/stamina/bodyStamina/recovery): 能力値80以上で成長減衰（超過1ごとに3%減衰）
        // ⚠ しきい値は据え置き。体力・スタミナは「やれば伸びる」もので、
        //    足・肩は `TALENT_STAT_MULTIPLIERS` の側で抑える
        dampCurve = { from: 80, rate: 0.03, floor: 0.1 };
      } else {
        // 技術系(meet/power/eye/control/defense/steal): 能力値**50**以上で成長減衰
        // 超過1ごとに3%減衰、下限15%（78で下限に届く）
        // ⚠ 変遷は 75 → 65 → **50**。65にしたのは「制球が47→66（5年）まで素通りで伸び、
        //    打撃だけが置いていかれる」を直すため。50に下げたのは別の抜けを塞ぐため。
        // ⚠ いしだ 2026-11-21「若干、練習効果が大きすぎる。4クールの合計が+10に到達するのは
        //    伸びすぎ」。年度替わりの自然成長には**アマ用の低い天井**（打撃は能力42から
        //    9%ずつ・下限2%。`AMA_BAT`）が掛かっているのに、**キャンプ側の天井だけ
        //    65始まり・4%と緩かった**ので、練習だけでアマの天井を素通りできた。
        //    実測（能力38の19歳・意識90・器用80・毎年4クール・34歳まで）:
        //      ミートの到達点 79.6 → **73.2**（NPBレギュラー基準は58）
        //    ⚠ **普通の選手はほぼ無傷**（意識50の到達点 59.6 → 59.4）。減衰の開始が50なので、
        //      そこに届かない選手には一切掛からない。「4クールで+10」も能力50未満では同じ。
        //      上位の青天井だけを塞ぐ変更（いしだの選んだ案1）。
        dampCurve = { from: 50, rate: 0.03, floor: 0.15 };
      }
      // ⚠ 努力で上がる能力は天井を別に持つ（`EFFORT_DAMP` の注を見ること）。
      //    上の技術系・フィジカル系の判定を**上書きする**ので、順番を変えないこと
      const effort = EFFORT_DAMP[targetStat];
      if (effort) dampCurve = effort;
      const dampFactor = highStatDamp(currentValue, dampCurve, isIntensive,
        targetStat === 'velocity' ? Infinity : INTENSIVE_ZERO_MAX);
      const adjustedBaseGrowth = Math.max(0, stochasticRound(rawGrowth * growthMult * dampFactor));

      let totalGrowth = Math.max(0, adjustedBaseGrowth + awakeningGrowth);
      // ⚠ **主対象の「最低+1」は置かない**。確率的丸めにする前は
      //    「掛け算の結果が0に丸まっても+1」で埋めていたが、そのせいで
      //    1クールの伸びが**どの能力も常に+1**になり、才能係数もメニューの
      //    係数も減衰も、すべてここに押し流されていた（実測: 走力・制球が
      //    打撃系の2〜3倍の速さで伸び続けた）。端数を確率で拾うので、
      //    期待値は保たれる＝練習が構造的に無駄になることはない。
      // ⚠ スタミナ・体力だけは最低+1を残す（やれば伸びるもの。いしだ方針）
      if ((targetStat === 'stamina' || targetStat === 'bodyStamina') && totalGrowth < 1) totalGrowth = 1;
      // ⚠ 【かつてここにあった集中練習の「最低保証」（`INTENSIVE_PENALTY_FLOOR`。代償が出た
      //    クールは対象を最低+1）】は 2026-11-25 に落とした。代償を伸びの割合にしたので
      //    「伸び0のまま減点だけ」が構造的に起きない（伸び0なら代償も0）。
      //    あの保証は代償クールを損だけにしない仕掛けだったが、同時に**リスクを直接
      //    打ち消していた**（いしだ「集中系の練習の、リスクが低いように感じます」）。
      //    能力ごとの係数を保証にも掛ける手当て（`floorStatMult`）も一緒に不要になった。
      // ⚠ **球速は1クールの伸びを `VELOCITY_PER_ROUND_MAX` km で止める**（いしだ 2026-11-25
      //    「球速集中効果の上限は1クール4kmとしましょう」）。
      //    肩の上限までの距離が大きいと、追いつき倍率（`getVelocityCatchupMult` は差38kmで2.65倍）と
      //    集中練習の倍率（当時3.7、いまは2.4）が掛け算になり、肩90・球速120 の投手が**1クールで+7.0km**
      //    （4クールで+23km・1年で120→143.6km）伸びていた。
      //    ⚠ 天井（`dampCurve`）は上限の手前10kmからしか効かないので、そこへ届くまでの帯は
      //      この1クールの上限だけが止める。球速練習もふつうは 1クール1.2km 程度で掛からないが、
      //      肩の上限との差が大きい投手（肩100・球速110 など）では球速練習にも掛かる（監査16 で確かめた。そのままにしてある）。
      if (targetStat === 'velocity' && totalGrowth > VELOCITY_PER_ROUND_MAX)
        totalGrowth = VELOCITY_PER_ROUND_MAX;
      const armForCap = getNestedValue(updatedPlayer, getStatPath('arm')) || 50;
      // ⚠ 1〜99 の物差しの能力は ABILITY_CAP で止める（100 で止めていて、98 から練習すると100になった。2026-11-20 監査）
      const maxValue = targetStat === 'velocity' ? getVelocityCap(armForCap) : targetStat === 'stamina' ? 200 : ABILITY_CAP;
      // ⚠ 上限で切るのは**伸びるときだけ**。球速が肩の上限より上にある投手（初期の世界で投手の約6%）は、
      //    `min(上限, 今+伸び)` だと練習するたびに上限まで落とされ、その落ちが連動で肩も下げ、
      //    肩が下がると上限も下がる下向きの連鎖になっていた（肩60・球速145 が4クールで球速-11km・肩-5。監査16）
      const newValue = Math.max(currentValue, Math.min(maxValue, currentValue + totalGrowth));
      updatedPlayer = setNestedValue(updatedPlayer, statPath, newValue);
      growthReport.push({
        stat: targetStat,
        statName: getStatName(targetStat),
        before: currentValue, after: newValue,
        growth: newValue - currentValue, isAwakening
      });
      // 集中練習の代償は、ここで決まった伸びの割合で後から引く（`INTENSIVE_COST`）
      if (menu.intensive && menu.penaltyPool) intensiveGain += newValue - currentValue;

      // 球速⇔肩力の連動
      if (targetStat === 'velocity' && newValue !== currentValue) {
        const armPath = getStatPath('arm');
        const currentArm = getNestedValue(updatedPlayer, armPath) || 50;
        // 球速変動→肩力の連動。
        // ⚠ **この連動は成長の抑えをまるごと素通りしていた**（いしだ 2026-11-25）。
        //    `Math.round(球速の変化 × 0.5)` を肩に直接代入していたので、
        //    高能力値の減衰（フィジカル系は能力80から）も才能の抑え
        //    （`TALENT_STAT_MULTIPLIERS.arm` 0.3。「肩は生まれ持った体格に依存」）も掛からず、
        //    球速集中で +24km 伸びた投手の肩が**1年で90→99**になっていた。
        //    肩が上がると `getVelocityCap` が上がる＝**球速の上限が自分で上がるループ**で、
        //    実測では毎年4クールの球速集中で 3年目に164km（上限158kmを越えて165kmまで）に達していた。
        //    才能の抑えと肩自身の減衰を通し、確率的に丸める（期待値は保たれる）。
        // ⚠ 下がる側（球速が落ちたとき）は抑えを掛けない（衰えは別の話で、
        //    抑えを掛けると「球速だけ落ちて肩は残る」ことになる）。
        const rawArm = (newValue - currentValue) * 0.5;
        const armChange = rawArm > 0
          ? stochasticRound(rawArm * (TALENT_STAT_MULTIPLIERS.arm ?? 1)
            * highStatDamp(currentArm, { from: 80, rate: 0.03, floor: 0.1 }, false))
          : Math.round(rawArm);
        if (armChange !== 0) {
          // ⚠ 上がる側で今の値より下げない（遠投では肩が100まで上がるので、99 で切ると肩100の投手が
          //    球速を伸ばして肩99に下がっていた。監査16）
          const newArm = Math.max(1, Math.min(Math.max(ABILITY_CAP, currentArm), currentArm + armChange));
          if (newArm !== currentArm) {
            updatedPlayer = setNestedValue(updatedPlayer, armPath, newArm);
            growthReport.push({ stat: 'arm', statName: getStatName('arm'), before: currentArm, after: newArm, growth: newArm - currentArm, isAwakening: false, isLinked: true });
          }
        }
      }
      // 肩力→球速の連動はサブ練習「遠投」(long_throw)で処理。メイン練習では肩力のみ成長
    }
  });

  // 集中練習の代償: 対象に入った伸びの `INTENSIVE_COST` を、他能力から1点ずつ引く。
  // ⚠ 伸びに比例させるのが要（上の「集中練習」の注の (1)）。固定だと頭打ちの帯で
  //    総量が負になり、「トータルは同じ」が成り立たない。
  // ⚠ **確率的に丸める**（`stochasticRound`）。1クールの代償は 0.4〜1.6 点なので
  //    `Math.round` だと 0 か 1 に潰れ、割合が効かない。
  // ⚠ 引く先は `penaltyPool` を混ぜて1点ずつ。点数が能力の数より多ければ**巡回して2点目**を引く
  //    （大きく伸びたクールは同じ能力が2点下がる）。
  if (menu.intensive && menu.penaltyPool) {
    const pool = menu.penaltyPool.filter(s => !menu.targets.includes(s) && getStatPath(s));
    let cost = stochasticRound(Math.max(0, intensiveGain) * INTENSIVE_COST);
    if (cost > 0 && pool.length > 0) {
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      const taken = new Map();
      for (let i = 0; cost > 0 && i < shuffled.length * 3; i += 1) {
        const penaltyStat = shuffled[i % shuffled.length];
        const penaltyPath = getStatPath(penaltyStat);
        const currentVal = getNestedValue(updatedPlayer, penaltyPath) || 50;
        if (currentVal <= 1) continue;   // 1 より下げない
        updatedPlayer = setNestedValue(updatedPlayer, penaltyPath, currentVal - 1);
        if (!taken.has(penaltyStat)) taken.set(penaltyStat, currentVal);
        cost -= 1;
      }
      for (const [penaltyStat, before] of taken) {
        const after = getNestedValue(updatedPlayer, getStatPath(penaltyStat));
        growthReport.push({
          stat: penaltyStat,
          statName: getStatName(penaltyStat),
          before, after,
          growth: after - before, isAwakening: false, isPenalty: true
        });
      }
    }
  }

  // ノック: 現在ポジションの適正を確定で+4〜8（野手のみ）
  if (trainingType === 'fielding' && updatedPlayer.position !== 'pitcher' && updatedPlayer.positionFitness) {
    const curPos = updatedPlayer.position;
    const curFit = updatedPlayer.positionFitness[curPos] || 0;
    if (curFit < 100) {
      const gain = Math.floor(Math.random() * 5) + 4;
      const newFit = Math.min(100, curFit + gain);
      updatedPlayer.positionFitness[curPos] = newFit;
      growthReport.push({
        stat: 'positionFitness',
        statName: `${POSITION_NAMES_MAP[curPos] || curPos}適正`,
        before: curFit, after: newFit, growth: newFit - curFit, isAwakening: false
      });
    }
  }

  // 経験値を消費（練習に使った分の一部をリセット）。
  // ⚠ **キャンプの最後の1クールで1回だけ**（`spendExperience`）。クールごとに
  //    減らすと、覚醒率が1クール目だけのものになる（実測 63.7%→22.0%→0%→0%）。
  //    呼ぶ側（`executeTeamCampTraining` → オンラインの `runCampRound` /
  //    一人用の `CampScreen`）が最後のクールかどうかを渡す。
  // ⚠ 既定は true。渡さない呼び出しは今までどおり毎回消費する
  if (spendExperience) {
    updatedPlayer.experience = Math.floor(experience * 0.3);
    updatedPlayer.positionExperience = {};
    updatedPlayer.battingOrderExperience = {};
  }

  return { player: updatedPlayer, growthReport };
}

// getPitchTypeName は utils/constants.js（BALL_EFFECTS が出典）から取り込んで再輸出する
export { ALL_PITCH_TYPES, getPitchTypeName };

/**
 * チーム全体のキャンプ練習を実行
 * @param {Object} team - チームデータ
 * @param {Object} trainingAssignments - { playerId: trainingType } の形式
 * @param {Object} [newPitchSelections] - { playerId: pitchType } 新球種選択
 * @returns {Object} - { updatedTeam, allReports }
 */
/**
 * スタッフのモチベーション管理が選手のプロ意識に影響（キャンプ1クールごと）
 * motivation 0→変化なし, 50→+0~1, 100→+1~2（1クールあたり）
 */
export function applyMotivationEffect(players, staffBonus) {
  if (!staffBonus) return [];
  const motivation = staffBonus.motivation || 0;
  if (motivation < 20) return [];

  const reports = [];
  const baseChance = motivation / 100;

  players.forEach(p => {
    if (!p.personality) return;
    const current = p.personality.discipline ?? 50;
    if (current >= 95) return;
    if (Math.random() < baseChance) {
      const gain = motivation >= 70 ? (Math.random() < 0.4 ? 2 : 1) : 1;
      const newVal = Math.min(99, current + gain);
      p.personality.discipline = newVal;
      if (gain > 0) {
        reports.push({ name: p.name, before: current, after: newVal, gain });
      }
    }
  });
  return reports;
}

/**
 * バッテリー指導が投手・捕手の精神力に影響（キャンプ1クールごと）
 * batteryCoach 0→変化なし, 50→+0~1, 100→+1~2
 */
export function applyBatteryMentalEffect(players, staffBonus) {
  if (!staffBonus) return [];
  const battery = staffBonus.batteryCoach || 0;
  if (battery < 20) return [];

  const reports = [];
  const baseChance = battery / 100;

  players.forEach(p => {
    if (p.position !== 'pitcher' && p.position !== 'catcher') return;
    if (!p.personality) return;
    const current = p.personality.mental ?? 50;
    if (current >= 95) return;
    if (Math.random() < baseChance) {
      const gain = battery >= 70 ? (Math.random() < 0.4 ? 2 : 1) : 1;
      const newVal = Math.min(99, current + gain);
      p.personality.mental = newVal;
      if (gain > 0) {
        reports.push({ name: p.name, before: current, after: newVal, gain });
      }
    }
  });
  return reports;
}

/**
 * @param {Object} [moodMults] - { [playerId]: 倍率 } 選手の希望と指示の噛み合い
 *   （`trainingPolicy.moodMultiplier`）。指示が正しいかとは別で、**やる気にだけ**効く。
 */
export function executeTeamCampTraining(team, trainingAssignments, newPitchSelections = {}, staffBonus = null, awakeningMult = 1.0, moodMults = {}, options = {}) {
  const allReports = [];
  const updatedPlayers = team.players.map(player => {
    // ⚠ 派遣中の選手は派遣先で鍛えるので、キャンプの練習はしない。以前は画面側で
    //    割り当てから外しても、ここで「割り当て無し＝自動の練習」に拾われ、
    //    派遣の成長に加えて4クールぶんの練習も積んでいた（CPU球団も同じ）
    if (player.dispatchedThisCamp) return player;
    const trainingType = trainingAssignments[player.id];
    if (!trainingType) {
      const autoTraining = player.position === 'pitcher' ? 'control' : 'batting';
      const { player: trained, growthReport } = executeCampTraining(player, autoTraining, undefined, staffBonus, awakeningMult, moodMults[player.id] ?? 1.0, options);
      allReports.push({ player: trained, trainingType: autoTraining, growthReport });
      return trained;
    }

    const newPitchType = trainingType === 'newpitch' ? newPitchSelections[player.id] : undefined;
    const { player: trained, growthReport } = executeCampTraining(player, trainingType, newPitchType, staffBonus, awakeningMult, moodMults[player.id] ?? 1.0, options);
    allReports.push({ player: trained, trainingType, growthReport });
    return trained;
  });

  return {
    updatedTeam: { ...team, players: updatedPlayers },
    allReports
  };
}
