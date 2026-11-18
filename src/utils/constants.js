// ============================================================
// 定数データ - constants.js
// 変化球の効果や物理計算の定数を定義
// ============================================================

/**
 * 変化球の効果設定
 * whiffBonus: 空振り率への影響
 * groundballBonus: ゴロ率への影響
 * weakBonus: 弱い打球への影響
 * velocityMinus: ストレートからの球速減少
 */
export const BALL_EFFECTS = {
  straight: {
    name: 'ストレート',
    whiffBonus: 0,
    groundballBonus: 0,
    weakBonus: -0.04,
    velocityMinus: 0
  },
  twoSeam: {
    name: 'ツーシーム',
    whiffBonus: -0.05,
    groundballBonus: 0.2,
    weakBonus: 0.12,
    velocityMinus: 5
  },
  slider: {
    name: 'スライダー',
    whiffBonus: 0.07,
    groundballBonus: 0.05,
    weakBonus: -0.02,
    velocityMinus: 12
  },
  curve: {
    name: 'カーブ',
    whiffBonus: 0.075,
    groundballBonus: 0.06,
    weakBonus: 0,
    velocityMinus: 23
  },
  fork: {
    name: 'フォーク',
    whiffBonus: 0.085,
    groundballBonus: 0.06,
    weakBonus: 0.13,
    velocityMinus: 17
  },
  changeup: {
    name: 'チェンジアップ',
    whiffBonus: 0.07,
    groundballBonus: 0.14,
    weakBonus: 0.02,
    velocityMinus: 21
  },
  sinker: {
    name: 'シンカー',
    whiffBonus: -0.04,
    groundballBonus: 0.15,
    weakBonus: 0.23,
    velocityMinus: 8
  },
  shoot: {
    name: 'シュート',
    whiffBonus: -0.04,
    groundballBonus: 0.19,
    weakBonus: 0.23,
    velocityMinus: 5
  },
  cutter: {
    name: 'カッター',
    whiffBonus: 0.01,
    groundballBonus: 0.17,
    weakBonus: 0.2,
    velocityMinus: 5
  },
  splitter: {
    name: 'スプリッター',
    whiffBonus: 0.07,
    groundballBonus: 0.05,
    weakBonus: 0.05,
    velocityMinus: 7
  },
  palm: {
    name: 'パーム',
    whiffBonus: 0.07,
    groundballBonus: 0.07,
    weakBonus: 0.11,
    velocityMinus: 22
  },
  knuckle: {
    name: 'ナックル',
    whiffBonus: 0.07,
    groundballBonus: 0.02,
    weakBonus: 0.15,
    velocityMinus: 30
  }
};

/**
 * 投球フォームの効果設定
 * velocityBonus: 球速への影響（km/h）
 * verticalBreakBonus: 縦変化への影響（カーブ、フォーク等の効果補正）
 * horizontalBreakBonus: 横変化への影響（スライダー、シュート等の効果補正）
 * whiffBonus: 空振り率への影響（サイドスロー・アンダースローは同じ利き腕の打者に対してのみ適用）
 *            例: 左サイドスローは左打者に強い、右アンダースローは右打者に強い
 */
export const PITCHING_FORM_EFFECTS = {
  overhand: {
    name: 'オーバースロー',
    velocityMult: 1.00,
    velocityGrowthMult: 1.1,       // 球速が伸びやすい
    controlGrowthMult: 0.9,        // 制球が伸びにくい
    verticalBreakBonus: 0.15,
    horizontalBreakBonus: 0,
    whiffBonus: 0
  },
  threeQuarter: {
    name: 'スリークォーター',
    velocityMult: 0.98,
    velocityGrowthMult: 1.0,
    controlGrowthMult: 1.0,
    verticalBreakBonus: 0.05,
    horizontalBreakBonus: 0.05,
    whiffBonus: 0
  },
  sidearm: {
    name: 'サイドスロー',
    velocityMult: 0.95,
    velocityGrowthMult: 0.9,       // 球速が伸びにくい
    controlGrowthMult: 1.1,        // 制球が伸びやすい
    horizontalBreakBonus: 0.15,
    verticalBreakBonus: -0.05,
    whiffBonus: 0.03
  },
  submarine: {
    name: 'アンダースロー',
    velocityMult: 0.92,
    velocityGrowthMult: 0.8,       // 球速が伸びにくい
    controlGrowthMult: 1.2,        // 制球が伸びやすい
    verticalBreakBonus: 0.1,
    horizontalBreakBonus: 0.05,
    whiffBonus: 0.05
  }
};

// ============================================================
// 投球フォームの表示名
//
// ⚠ **表を二重に作らないこと**。以前は10箇所が独自の短縮表を持っており、
//    `threeQuarter` だけで **スリークォーター / スリー / スリクォ / 3Q** の4通り、
//    `sidearm` は サイド / サイドスロー / サイドアーム の3通りに割れていた。
//    同じファイルの中で2種類使っている画面もあった（`CampScreen`）。
//
// ⚠ **フル名は `PITCHING_FORM_EFFECTS[].name` から導出する**。ここで書き直すと
//    11個目のコピーになる。
// ============================================================

/** フル名（オーバースロー / スリークォーター / サイドスロー / アンダースロー） */
export const FORM_NAME = Object.fromEntries(
  Object.entries(PITCHING_FORM_EFFECTS).map(([k, v]) => [k, v.name])
);

/** 短縮名。表の列に入れる用（4文字で揃える） */
export const FORM_SHORT = {
  overhand: 'オーバー',
  threeQuarter: 'スリクォ',
  sidearm: 'サイド',
  submarine: 'アンダー',
};

/**
 * 打席の短縮名（キャンプの打席変更の選択肢と結果の文）。
 * ⚠ 表はここだけ。アプリの写し（`Tables.kt` の `BATS_SHORT`）は `mobile/tools/gen-tables.mjs` が書き出す
 */
export const BATS_SHORT = { right: '右打', left: '左打', switch: '両打' };

/** 2文字コード。選手検索のような極端に狭い列で使う */
export const FORM_CODE = {
  overhand: 'OV', threeQuarter: '3Q', sidearm: 'SD', submarine: 'UN',
};

/** フォームの選択肢（`<select>` 用）。順序もここが唯一の権威 */
export const FORM_OPTIONS = Object.keys(PITCHING_FORM_EFFECTS).map(k => ({ key: k, name: FORM_NAME[k], short: FORM_SHORT[k] }));

/**
 * 投球フォームと相性の良い変化球（ボーナス適用）
 */
export const FORM_PITCH_SYNERGY = {
  overhand: ['curve', 'fork', 'splitter', 'knuckle'],      // 縦変化
  threeQuarter: [],                                         // すべて平均的
  sidearm: ['slider', 'shoot', 'cutter', 'twoSeam', 'sinker'], // 横変化。シンカーはサイドの武器でもある
  submarine: ['sinker', 'curve', 'palm']                    // 浮き上がり系
};

export const POSITION_ORDER = ['pitcher', 'catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];
export const getPositionSortIndex = (pos) => { const i = POSITION_ORDER.indexOf(pos); return i >= 0 ? i : 99; };

/**
 * ポジション名（日本語表記）
 */
export const POSITION_NAMES = {
  pitcher: '投',
  catcher: '捕',
  first: '一',
  second: '二',
  third: '三',
  short: '遊',
  left: '左',
  center: '中',
  right: '右',
  dh: 'DH'
};

/**
 * ベンチ（控え）を並べる順。**野手を守備位置順に並べ、投手は最後**。
 * 交代要員を探すときは「捕手の控えは誰か」「内野の控えは誰か」を見るので、
 * ロスター順のままだと投手と野手が混ざって探せない。
 *
 * ⚠ **DHは守備位置ではない**。「打撃に優れ守備が苦手な選手が入る打順」なので、
 * ここに枠を作ってはいけない。`position: 'dh'` は打線のエントリ側だけの概念で、
 * 選手の `position` としては `saveMigration.normalizePlayer` が実ポジションへ
 * 寄せている（旧セーブ対策）。万一残っていたら守備適性から解決する。
 */
export const BENCH_POSITION_ORDER = {
  catcher: 0, first: 1, second: 2, third: 3, short: 4,
  left: 5, center: 6, right: 7, pitcher: 8,
};

/** 守備適性が最も高いポジション。position が守備位置でない選手の保険 */
const bestFieldingPosition = (player) => {
  const f = player?.positionFitness;
  if (!f) return 'first';   // 守備の弱い選手を置く定位置
  let best = 'first', max = -1;
  for (const pos of Object.keys(BENCH_POSITION_ORDER)) {
    const v = f[pos] ?? 0;
    if (v > max) { max = v; best = pos; }
  }
  return best;
};

const benchRank = (player) => {
  const r = BENCH_POSITION_ORDER[player?.position];
  return r !== undefined ? r : BENCH_POSITION_ORDER[bestFieldingPosition(player)];
};

/**
 * 控え選手をポジション順に並べ替える（元配列は変更しない）。
 * 同じポジション内はロスター順のまま（Array#sort は安定ソート）。
 */
export const sortBenchByPosition = (players) =>
  [...players].sort((a, b) => benchRank(a) - benchRank(b));

/**
 * 併殺の成立率（内野守備50・走者の足55のときの%）。
 * 実NPBの併殺は約0.70/チーム/試合。**判定は「内野ゴロのアウト」だけを対象にする**
 * （外野へ抜けた打球はそもそもアウトにならないので距離の条件は要らない）。
 * judgeFielderReach のゴロ捕球率と両方効くので、ゴロの較正を変えたら測り直すこと。
 */
export const DP_BASE = 34;

/**
 * フォームと球種の相性が**試合の効きに与える倍率**。
 *
 * ⚠ `FORM_PITCH_SYNERGY` は長らく**キャンプの成長倍率と習得成功率にしか
 * 効いていなかった**。そのため同じレベルで揃えると
 *   サイド＋シンカー(適性) 2.670 対 サイド＋フォーク(適性外) 2.643
 * と適性が結果に一切出ず、「サイド・アンダースローはシンカーが武器」という
 * 設計が球速ペナルティ（アンダーは×0.92）だけ受けて損をする形になっていた。
 *
 * 適性球はよく曲がり、適性外の球は曲がりきらない。これで
 * 「球速は落ちるが適性球はよく効く」というトレードオフが成立する。
 * スリークォーターは適性リストが空＝すべて平均（倍率1.0）。
 */
const FORM_SYNERGY_ON = 1.30;
const FORM_SYNERGY_OFF = 0.88;
export const formPitchBonus = (form, type) => {
  if (!type || type === 'straight') return 1;
  const list = FORM_PITCH_SYNERGY[form];
  if (!list || !list.length) return 1;
  return list.includes(type) ? FORM_SYNERGY_ON : FORM_SYNERGY_OFF;
};

/**
 * 変化球の球速減（km/h）。**2エンジンで共有すること**。
 *
 * 以前は自動シミュが `8 + level/100 × 15`（Lv100なら全球種一律 -23）、
 * 采配モードが `BALL_EFFECTS.velocityMinus`（ナックル-30 / ツーシーム-5）と
 * 別式だった。スキップだとツーシームもナックルも同じ速さで来ていた。
 * 緩急は打球方向（`SEQ_DIR`）とタイミングの両方に効くので揃える必要がある。
 *
 * レベルで少し伸びる（磨いた球ほど緩急がはっきりする）。
 */
export const pitchVelocityDrop = (type, level = 50) => {
  const base = BALL_EFFECTS[type]?.velocityMinus ?? 0;
  if (!base) return 0;
  return base * (0.72 + Math.max(0, Math.min(100, level)) / 100 * 0.28);
};
// ⚠ かつてここに「減速量を投手の直球に比例させる」切り替え（`VELOCITY_DROP_MODE`）を
//    準備していたが、遅い投手のナックルの到達球速を 70→79km にしても防御率は誤差内
//    （8シード×80試合で 3.53 対 3.52）だった。原因は到達球速ではなく
//    効き（`pitchBreakEfficiency`）とタイミングの窓（`KNUCKLE_TIMING`）だったので撤去した

/**
 * **ナックルの打ちにくさは速さでほとんど決まらない**（`calculatePhysicsContact`）。
 * タイミングの窓は「その球の速さ」と「投手の素の球速」の両方で広がる（遅いほど当てやすい）。
 * 回転で曲がる球や直球ならそれで正しいが、ナックルは**揺れで**打ち損じさせる球なので、
 * 遅いことがそのまま当てやすさにならない。
 * `indep` の割合だけ、窓を「素の球速 `refFastball` の投手が投げたナックル」の窓へ寄せる
 * （0＝速さどおり / 1＝速さに全く依らない）。基準の投手（140km/h）の窓は変わらない。
 * ⚠ **関数の中で毎回読む**（計測で差し替えられるように。モジュール定数を `globalThis` で
 *   差し替えても静的 import の巻き上げで効かない——CLAUDE.md「計測」の⚠）
 */
export const KNUCKLE_TIMING = { indep: 1.0, refFastball: 140 };

/**
 * **読めない球**。打者が球種を張り当てても効果が出ない。
 * ナックルは回転を殺して不規則に揺れる球で、投手・捕手・打者の誰にも
 * どこへ来るか分からない。「ナックルが来ると分かっていても打てない」という
 * 実際の性質を、読み合いを無効にすることで表現する。
 */
export const UNREADABLE_PITCHES = new Set(['knuckle']);
export const isUnreadablePitch = (type) => UNREADABLE_PITCHES.has(type);

/**
 * 球種キー → 日本語名。**`BALL_EFFECTS` を唯一の出典にする**。
 *
 * 以前は App.jsx（予告先発）・DraftResultScreen・campTraining が
 * それぞれ独自の対応表を持っており、App.jsx の表だけが
 *   - `knuckleball` という**存在しないキー**（実際は `knuckle`）
 *   - `twoSeam` / `palm` が抜けている
 *   - `splitter` が「スプリット」（他は「スプリッター」）
 * という状態で、ナックルが `knuckle` と生のアルファベットで表示されていた。
 * 球種を1つ足すたびに4箇所直す形になっていたので、ここに集約する。
 */
export const getPitchTypeName = (type) => BALL_EFFECTS[type]?.name || type;

// ============================================================
// 打席結果バッジ
//
// `addAtBatResult` に渡る文字列は 安打 / 二塁打 / 遊ゴロ / ライナー … と
// 長さがまちまちで、そのまま並べるとバッジの幅が揃わない。数が増えると
// 折り返して打順の行がガタガタになる。
//
// **枠を3文字幅に固定し、2文字の結果は均等割り付けで埋める**
// （`text-align-last: justify`）。1文字まで削ると何のことか分からないので、
// 読める長さを保ったまま幅だけ揃えるのがちょうどいい。
// ============================================================

/** 3文字を超える表記だけ、意味を保ったまま3文字以内に畳む */
const AT_BAT_RESULT_LABEL = {
  併殺: '併殺打',
};

/** バッジに出す表記（2〜3文字）。元の文字列はそのまま `title` に出すこと */
export const formatAtBatResult = (label) => {
  if (!label) return '';
  const fixed = AT_BAT_RESULT_LABEL[label];
  if (fixed) return fixed;
  if (label.length <= 3) return label;
  // 想定外の長い表記（守備位置が取れなかった凡打など）は打球種別だけ残す
  if (label.includes('ライナー')) return '直線';
  if (label.includes('ゴロ')) return 'ゴロ';
  if (label.includes('フライ')) return '飛球';
  return label.slice(0, 3);
};

/** 打席結果バッジの背景色。安打=黄 / 本塁打=赤 / 三振=青 / 四死球=緑 / 併殺=紫 */
export const atBatResultColor = (label) => {
  if (label === '本塁打') return 'bg-red-600';
  if (label === '安打' || label === '二塁打' || label === '三塁打') return 'bg-yellow-600';
  if (label === '三振') return 'bg-blue-700';
  if (label === '四球') return 'bg-green-700';
  if (label === '死球') return 'bg-emerald-800';
  if (label === '併殺') return 'bg-purple-700';
  return 'bg-gray-600';
};

/**
 * ポジション別の色設定（背景色）
 */
// ⚠ **識別色は保ったまま、文字色でコントラストを取ること**。
//    `text-white` 一律だと 黄 2.94:1 / 緑 3.30:1 / 水色 4.10:1 と AA(4.5) を割る。
//    黄色は**濃い文字**に、緑と水色は**地を1段濃く**して white を活かす。
//    実測: 赤 4.83 / 水色 5.03 / 黄 4.96 / 緑 5.02 / 紫 5.38。
const POS_BADGE = {
  pitcher:  'bg-red-600 text-white',
  catcher:  'bg-sky-700 text-white',
  infield:  'bg-yellow-600 text-yellow-950',
  outfield: 'bg-green-700 text-white',
  dh:       'bg-purple-600 text-white',
};

export const POSITION_COLORS = {
  pitcher: POS_BADGE.pitcher,
  catcher: POS_BADGE.catcher,
  first: POS_BADGE.infield,
  second: POS_BADGE.infield,
  third: POS_BADGE.infield,
  short: POS_BADGE.infield,
  left: POS_BADGE.outfield,
  center: POS_BADGE.outfield,
  right: POS_BADGE.outfield,
  dh: POS_BADGE.dh
};

/**
 * ポジション「群」の識別色。キャンプのタブなど、群単位で色分けするときに使う。
 * ⚠ **色を別に持たないこと**。`POSITION_COLORS` と同じ割り当て
 * （投手=赤 / 捕手=水色 / 内野=黄 / 外野=緑）を群にまとめただけ。
 * 選択中は塗り、非選択は同系の枠と文字だけにして、識別色は保ったまま格を落とす。
 */
// ⚠ 非選択も不透明にすること。このタブ列はキャンプの紙（明るい地色）の上に直に載るので、
//    `bg-*-900/25` だと淡く薄まって文字が 1.8〜2.3:1 まで落ちていた
export const POSITION_GROUP_COLORS = {
  pitcher:  { on: 'bg-red-600 text-white border-red-500',
              off: 'bg-red-950 text-red-300 border-red-700 hover:bg-red-900' },
  catcher:  { on: 'bg-sky-600 text-white border-sky-500',
              off: 'bg-sky-950 text-sky-300 border-sky-700 hover:bg-sky-900' },
  infield:  { on: 'bg-yellow-600 text-white border-yellow-500',
              off: 'bg-yellow-950 text-yellow-300 border-yellow-700 hover:bg-yellow-900' },
  outfield: { on: 'bg-green-600 text-white border-green-500',
              off: 'bg-green-950 text-green-300 border-green-700 hover:bg-green-900' },
};

// ============================================================
// チームランク（S〜D）の共有テーブル
//
// ⚠ **表を二重に作らないこと**。実測で `RANK_ORDER` が6箇所にあり、
//    ・4つが同じ `{S:0…D:4}` のコピー
//    ・`scoutingSystem` と `toshitaikou` の2つは**定義だけで一度も使われていない**
//    ・`scoutingSystem` は `['S'…'D']`、`tryoutSystem` は `['D'…'S']` と
//      **同じ名前で逆順**（読み間違いの罠）
//    という状態だった。`RANK_COLORS` も4箇所・`RANK_LABELS` も3箇所に
//    同じものが書かれていた。
//
// ⚠ **ここに置いてよいのは「どのカテゴリでも同じもの」だけ**。
//    強さの数値（`RANK_STRENGTH`）は 社会人 `{S:88…}` と 大学 `{S:78…}` で
//    別物なので**統合してはいけない**。背景色も
//    `TeamRankingScreen`(900段) と `UniversitySelectScreen`(500/20) で別物。
// ============================================================
export const RANK_DESC = ['S', 'A', 'B', 'C', 'D'];              // 強い順
export const RANK_ASC = ['D', 'C', 'B', 'A', 'S'];               // 弱い順（1つ上のランクを引く用）
export const RANK_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 };      // 強い順の添字
export const RANK_LABELS = { S: '超強豪', A: '強豪', B: '中堅', C: '育成型', D: '新興' };
export const RANK_COLORS = {
  S: 'text-yellow-400',
  A: 'text-red-400',
  B: 'text-blue-400',
  C: 'text-green-400',
  D: 'text-gray-300',
};

/**
 * ランク色の実値。`RANK_COLORS` と**同じ意味**で、Tailwind のクラス名では
 * 書けない場所（SVG の fill / グラデーション / box-shadow）のために持つ。
 * ⚠ **`RANK_COLORS` と必ず揃えること**。片方だけ変えると、同じランクが
 *   文字とバッジで違う色になる。
 * ⚠ 背景色はここに置かない。`RANK_BG` は画面ごとに濃さが別物
 *   （`TeamRankingScreen` は900段、`UniversitySelectScreen` は500/20）。
 */
export const RANK_HEX = {
  S: '#facc15',
  A: '#f87171',
  B: '#60a5fa',
  C: '#4ade80',
  D: '#d1d5db',
};

/**
 * 利き手ラベル（日本語表記）
 */
export const HAND_LABELS = {
  right: '右',
  left: '左',
  switch: '両'
};

/**
 * ポジション名（フル表記）
 */
export const POSITION_NAMES_FULL = {
  pitcher: 'ピッチャー',
  catcher: 'キャッチャー',
  first: 'ファースト',
  second: 'セカンド',
  third: 'サード',
  short: 'ショート',
  left: 'レフト',
  center: 'センター',
  right: 'ライト'
};

/**
 * 能力値 → ランク変換（S〜F）
 */
/**
 * 「精神」グレード（S〜F）。
 *
 * 【なぜ数値を出さないか】プロ意識(`discipline`)は成長を最も大きく左右する
 * （才能ランクの幅2.2に対し、意識20⇔90で2.2〜2.7ランク動く）。しかし
 * **本来スカウトから見えるものではない**ので、生の数値は出さない。
 * 精神系をひとまとめにした**大雑把な7段階**だけを見せる。
 *
 * ⚠ **プロ意識だけの言い換えにしないこと**。`mental`（度胸・勝負強さ）を
 *    混ぜてあるので、グレードが高くても成長するとは限らない。
 *    「Aだから伸びる」と読み切れない粗さが、見抜く余地を残す。
 */
export const mentalScore = (player) => {
  const d = player?.personality?.discipline ?? 50;
  const m = player?.personality?.mental ?? 50;
  return d * 0.65 + m * 0.35;
};
export const getMentalGrade = (player) => {
  const v = mentalScore(player);
  if (v >= 76) return 'S';
  if (v >= 67) return 'A';
  if (v >= 59) return 'B';
  if (v >= 51) return 'C';
  if (v >= 43) return 'D';
  if (v >= 34) return 'E';
  return 'F';
};

/**
 * 能力値を0〜100の物差しに揃える。
 * ⚠ 球速（115〜155km）とスタミナ（0〜200）は0〜100ではない。段位も色も
 *    この値で決めるので、**式はここ1か所**に置く（2か所に書くと片方だけずれる）。
 */
export const normalizeAbility = (value, isPitcherVelocity = false, isStamina = false) =>
  isPitcherVelocity ? (value - 115) * 2.5 : isStamina ? value / 2 : value;

export const getAbilityRank = (value, isPitcherVelocity = false, isStamina = false) => {
  const v = normalizeAbility(value, isPitcherVelocity, isStamina);
  if (v >= 90) return 'S';
  if (v >= 80) return 'A';
  if (v >= 70) return 'B';
  if (v >= 60) return 'C';
  if (v >= 50) return 'D';
  if (v >= 40) return 'E';
  return 'F';
};

/**
 * ランク → テキスト色クラス
 */
export const getRankColor = (rank) => ({
  S: 'text-pink-400',
  A: 'text-red-400',
  B: 'text-orange-400',
  C: 'text-yellow-400',
  D: 'text-green-400',
  E: 'text-blue-400',
  F: 'text-gray-300'
}[rank] || 'text-gray-300');

/**
 * 能力値 → 色クラス（数値表示用）
 */
/**
 * growthModifier を安全に加減算するユーティリティ
 */
/**
 * 疲労を足す（試合の後）。⚠ **上限で止める**。控えの居ない球団では同じ選手が毎日出て
 * 回復の日が来ないので、上限が無いと疲労が2000を超え、能力の引き算（疲労²/1200）で
 * ミートが数千も下がっていた（10年の長期シミュ）。150 は普段の最高（先発の翌日で100前後）より上
 */
export const FATIGUE_MAX = 150;
export function addFatigue(player, amount) {
  if (!(amount > 0)) return;
  const now = player.fatigue || 0;
  player.fatigue = Math.min(Math.max(FATIGUE_MAX, now), now + amount);
}

export const adjustGrowthModifier = (player, delta) => {
  player.growthModifier = Math.round(((player.growthModifier || 0) + delta) * 100) / 100;
};

/**
 * 疲労度に応じた成長率ペナルティ（摩耗）を返す。
 *   〜40: なし / 41〜60: -0.01 / 61〜80: -0.02 / 81〜: -0.03
 * 適用条件は呼び出し側で判定する:
 *   野手 = スタメン出場した試合のみ（代打・代走・守備固めは対象外）
 *   投手 = 10球以上投げた登板のみ（10球以下のワンポイントは対象外）
 */
export const getFatigueGrowthPenalty = (fatigue) => {
  const f = fatigue || 0;
  if (f <= 40) return 0;
  if (f <= 60) return -0.01;
  if (f <= 80) return -0.02;
  return -0.03;
};

/**
 * **登録を野手にした選手**か（コンバート）。
 *
 * ⚠ 投手かどうかの判定は「スタミナ100以上なら投手」という当て推量を含む
 *    （野手も `pitching.stamina` を持つため）。投手から野手へコンバートした
 *    選手はスタミナが高いままなので、印を付けないと**登録を変えても投げ続ける**。
 * ⚠ 判定は3か所にある（`isPitcherPlayer`・`autoSimulation` の中の写し・
 *    `generatePitchingRotation` の絞り込み）。この印は**その全部で見ること**。
 */
export const registeredAsFielder = (player) => player?.primaryRole === 'fielder';

/**
 * 疲労の重さ → 画面で名前に付ける色の段。
 *   ''（無色） / 'warn'（黄: 成長が鈍り始める） / 'heavy'（赤: 鈍り方が最も大きい）
 *
 * ⚠ **段は `getFatigueGrowthPenalty` から導くこと**。画面に 41 や 81 を直に
 *    書くと、摩耗の段を動かしたときに色だけ古い境目のまま残る。
 * ⚠ 色は**名前に付ける**。疲労の数字の列は既に色が付いているが、スタメンを
 *    選ぶときに見ているのは名前なので、数字まで目が行かない。
 */
export const getFatigueTone = (fatigue) => {
  const penalty = getFatigueGrowthPenalty(fatigue);
  if (penalty <= -0.03) return 'heavy';
  if (penalty < 0) return 'warn';
  return '';
};

/** 疲労ペナルティを条件付きで適用する（applied=false なら何もしない） */
export const applyFatigueGrowthPenalty = (player, applied) => {
  if (!applied) return 0;
  const penalty = getFatigueGrowthPenalty(player?.fatigue);
  if (penalty !== 0) adjustGrowthModifier(player, penalty);
  return penalty;
};

/**
 * 能力値 → 色クラス（数値表示用）
 */
export const getAbilityColor = (value) => {
  if (value >= 90) return 'text-pink-400';
  if (value >= 80) return 'text-red-400';
  if (value >= 70) return 'text-orange-400';
  if (value >= 60) return 'text-yellow-400';
  if (value >= 50) return 'text-green-400';
  if (value >= 40) return 'text-blue-400';
  return 'text-gray-300';
};

/**
 * 球速・投手スタミナを**他の能力値と同じ 0〜100 の物差し**へ正規化する。
 *
 * ⚠ **この2つだけ単位が違う**（球速は km/h・スタミナは 0〜200）ので、
 *    生の値を他の能力と平均すると意味を成さない。
 * ⚠ **新しい係数を作らないこと**。`(v-115)×2.5` / `sta/2` は
 *    `AbilityValue` / `AbilityRadar` / `PlayerDetailModal` / `TryoutScreen` /
 *    `ContractScreen` が既に使っている**この作品の共通の物差し**で、
 *    ランク配色もこれで較正してある。ここが唯一の定義。
 * ⚠ 実際にこれを守らなかったのが `calcPlayerOverall` で、独自に
 *    `(v-115)×1.5` / `sta/3` を使っていたため**投手の総合力だけ低く出て**いた
 *    （NPBレギュラー相当で 投手45 対 野手57）。
 */
export const normVelocity = (v) => Math.max(0, Math.min(99, ((v ?? 130) - 115) * 2.5));
export const normPitcherStamina = (v) => Math.max(0, Math.min(99, (v ?? 80) / 2));

/**
 * 総合力（`calcPlayerOverall`）→ 色クラス。
 * ⚠ `getAbilityColor`（生の能力値用）とは**別のスケール**。総合力は個々の能力値より
 *    低く出るので、同じ閾値を使うと大半が灰色に潰れる。用途で使い分けること。
 * ⚠ 能力ランキングとチームランキングの2画面が使う。**片方に書き写さないこと**。
 */
export const getOverallColor = (v) => {
  if (v >= 70) return 'text-yellow-400';
  if (v >= 60) return 'text-red-400';
  if (v >= 50) return 'text-blue-400';
  if (v >= 40) return 'text-green-400';
  return 'text-gray-300';
};

const FIELD_POSITIONS_FOR_UTILITY = ['catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];

/**
 * ユーティリティ度（守備の幅）: メイン以外に守れるポジションの数と質を 0-100 で返す。
 * 守備適性60以上のサブポジについて (適性-50) を加算。
 * 例) 75の適性を3ポジ → 75 / 65を2ポジ → 30 / 単能力なら 0。
 * 投手は 0。
 */
export const getUtilityScore = (player) => {
  if (!player || player.position === 'pitcher') return 0;
  const pf = player.positionFitness || {};
  const main = player.position;
  let score = 0;
  for (const pos of FIELD_POSITIONS_FOR_UTILITY) {
    if (pos === main) continue;
    const f = pf[pos] || 0;
    if (f >= 60) score += (f - 50);
  }
  return Math.max(0, Math.min(100, score));
};

/**
 * 捕手のリード（配球）能力を生成する。
 *
 * 従来は生成箇所ごとに狭い一様分布だった（トライアウト35-70 / 大学25-55 /
 * 補充30-50）。実在する捕手が25〜70に収まり中央45という狭さのため、
 * 配球の仕組みを整えても「良い捕手」と「悪い捕手」の差が出しようがなかった。
 *
 * 正規分布 N(48, 18) を 5〜95 で切って、突出した捕手が稀に出るようにする。
 * 平均は据え置き（リーグ全体の成績は変わらない）。
 *   ±1σ: 30〜66 / ±2σ: 12〜84 / 90超は約1%
 */
// リードは**経験の積み上げ**なので、生成時点でも年齢で水準が違う。
// ⚠ **傾きは年次成長のリード成長率と揃えること**（実測 意識55 で約 +1.8/年）。
//    揃えないと「生成された30歳の捕手」と「19歳から育った30歳の捕手」が別水準になる。
// ⚠ 年齢を渡さない場合は 25歳相当（母集団の中央付近）。ここを動かすと
//    リーグ全体のリード平均が動き、防御率が動く（リード18→81 で -0.31）。
const LEAD_AGE_SLOPE = 1.8;

// ============================================================
// 「実在しない水準」だけを畳む（`taperLow`）
//
// 能力値の水準: 20=小学生 / 30=中学生 / 40=高校生 / 50=大学生 / 60=プロの及第点。
// 生成の裾が 20 を割ると「走れない・投げられない」選手がチームに載る。
//
// ⚠ **`clamp` で下限を切ってはいけない**。平均が押し上がってリーグの較正が動く。
//    境より下だけを境に向かって圧縮すれば、**中央値と99%点は完全に不変**のまま
//    最小値だけが上がる。
// ⚠ 対象は **全員が必ずやる身体動作**（守る・走る・投げる）に限る。
//    ミート・パワー・選球眼・走塁・バント・**制球**には入れない——
//    「守備の名手で打てない」「ノーコンだが速い」という一芸型を潰してしまう。
//    実際に制球へ入れたら 防御率 -0.27 / BB/9 -0.51 と実害が出た。
// ⚠ **物差しを二重に作らないこと**。以前は `corporateInit` の中にだけ書かれており、
//    高校生プールは素通りで**ドラフト上位に走力8の選手**が出ていた。
// ============================================================
export const IMPLAUSIBLE_FLOOR = 20;
export const TAPER_K = 0.25;
export const taperLow = (val, floor = IMPLAUSIBLE_FLOOR) =>
  val >= floor ? val : Math.max(1, Math.round(floor - (floor - val) * TAPER_K));

// ============================================================
// アマ時代の進路（高卒 / 大卒）— NPBドラフトの在籍年数規定に使う
//
// 実NPBは「社会人チームに所属する選手は、高校卒業後3年 / 大学卒業後2年を
// 経過しないと指名できない」。本作はこれを**年齢**で門番している
// （`npbDraft.js`: 高卒 age>=21 / 大卒 age>=24）ので、その選手がどちらの
// 進路で来たのかを引く手段が要る。
//
// ⚠ **判定を呼び出し側に書かないこと**。以前は `npbDraft.js` が
//    `careerHistory?.some(h => h.type === 'university')` を直に書いており、
//    一方の生成側（`corporateInit`）は大学歴を**経歴に積む前に**判定していたため、
//    **生成された社会人6563人が1人も大学歴を持たず、大卒の門番が一度も
//    発火していなかった**。書き手と読み手が別々に真偽を決めると必ず食い違う。
// ⚠ `universityTeamId` は**大学パイプ**（`universityPipeSystem`）が見るフィールドで、
//    経歴とは別経路。どちらが欠けても片方だけ動くので、両方見て判定する。
// ============================================================
export const AMATEUR_ROUTE = { HIGHSCHOOL: 'highschool', UNIVERSITY: 'university' };

export const amateurRoute = (player) => {
  if (!player) return AMATEUR_ROUTE.HIGHSCHOOL;
  if (player.universityTeamId || player.universityTeamName || player.universityName) {
    return AMATEUR_ROUTE.UNIVERSITY;
  }
  if (player.careerHistory?.some(h => h.type === 'university')) return AMATEUR_ROUTE.UNIVERSITY;
  return AMATEUR_ROUTE.HIGHSCHOOL;
};

// 社会人に所属する選手がNPBドラフトの対象になる最低年齢（進路別）。
// 高卒19歳入団なら 21歳＝3年目、大卒22歳入団なら 24歳＝3年目で解禁される。
export const CORPORATE_DRAFT_MIN_AGE = { highschool: 21, university: 24 };

export const generateCatcherLead = (age = 25) => {
  const u1 = Math.random() || 0.0001;
  const u2 = Math.random();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const ageShift = Math.max(-6, Math.min(8, (age ?? 25) - 25)) * LEAD_AGE_SLOPE;
  return Math.max(5, Math.min(95, Math.round(54 + ageShift + normal * 16)));
};

// ============================================================
// 先発の自動ロール（`teams-data.initializeAllPitchingRotations` と
// `lineupGenerator.generatePitchingRotation` で共有。表を二重に作らないこと）
//
// ⚠ **スタミナの低い先発を自動で「ショートスターター」（球数上限65）にしないこと**。
//    スタミナは1球ごとに1減り25%で降板するので、スタミナの低い投手は放っておいても
//    早く降りる。そこへ65球の上限を重ねると、先発の3割（スタミナ110未満）が
//    スタミナに関係なく3.9回で降りていた。ショートは采配で選ぶ起用法として残す
// ============================================================
export const autoStarterRole = (index, stamina = 80) =>
  index === 0 ? 'ace' : stamina >= 170 ? 'complete' : 'quality';

/**
 * ドラフトの目標構成（24人の名簿）。
 *
 * ⚠ **CPUの指名と、人の希望リストの解決で共有すること**。表を二重に持つと、
 *    人とCPUで別の名簿ができる。実際、人の希望リストだけこの目標を見ておらず、
 *    順番どおりに取った結果 **投手15人・野手9人**（控えゼロ）になっていた。
 *    CPUは全球団が投手10・野手14で揃っていた。
 * ⚠ 目標は「寄せる先」であって上限ではない。CPU側は不足ポジションに
 *    点数の下駄を履かせるだけなので、捕1・内7 のように振れる。
 */
export const ROSTER_TARGETS = {
  pitcher: 10,
  catcher: 2,
  infielder: 6,
  outfielder: 6,
};

/** 守備位置 → 目標構成の区分 */
export const rosterGroup = (position) =>
  position === 'pitcher'
    ? 'pitcher'
    : position === 'catcher'
      ? 'catcher'
      : ['first', 'second', 'third', 'short'].includes(position)
        ? 'infielder'
        : 'outfielder';

/** 名簿を目標の区分ごとに数える */
export const rosterCounts = (players) => {
  const counts = { pitcher: 0, catcher: 0, infielder: 0, outfielder: 0 };
  for (const p of players || []) counts[rosterGroup(p.position)] += 1;
  return counts;
};
