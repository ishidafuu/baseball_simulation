// ============================================================
// ユーティリティ関数 - physics.js
// 物理演算、統計、表示関連のヘルパー関数
// ============================================================

/**
 * イニング数を分数形式で表示（例: 30回1/3）
 * @param {number} outs - アウト数
 * @returns {string} フォーマットされたイニング表記
 */
export const formatInnings = (outs) => {
  if (outs === 0) return '0回';
  const fullInnings = Math.floor(outs / 3);
  const partialOuts = outs % 3;
  if (partialOuts === 0) {
    return `${fullInnings}回`;
  }
  return `${fullInnings}回${partialOuts}/3`;
};

/**
 * 表の欄の投球回（例: 18.2 ＝ 18回2/3）。アウト数から作る。
 * ⚠ 表はどれもこの書き方にそろえる（オンラインの成績の表・一人用の投手起用の表）。
 *    以前は一人用の投手起用だけ「18 2/3」で、同じ選手が表によって違って見えた
 * @param {number} outs - アウト数
 */
export const inningsCell = (outs) => `${Math.floor(outs / 3)}.${outs % 3}`;

/**
 * 能力値の背景色を取得（0-100）
 * @param {number} value - 能力値
 * @returns {string} Tailwind CSSクラス名
 */
export const getAbilityColor = (value) => {
  if (value >= 80) return 'bg-red-500';      // S級
  if (value >= 70) return 'bg-orange-500';   // A級
  if (value >= 60) return 'bg-yellow-500';   // B級
  if (value >= 50) return 'bg-green-500';    // C級
  return 'bg-gray-500';                       // D級
};

/**
 * 能力値のテキスト色（0-100。SS 90〜 / S 80〜 / A 70〜 / B 60〜 / C 50〜 / D 40〜 / E）。
 * 中身は `constants.js` の `getAbilityColor`（同じ段と色。写しを置かない）
 */
export { getAbilityColor as getAbilityTextColor } from './constants.js';

/**
 * 選手の最高適正ポジションを取得
 * @param {Object} player - 選手オブジェクト
 * @returns {string} ポジション名
 */
export const getBestFitPosition = (player) => {
  // positionFitnessが存在しない場合、originalPositionまたは現在のpositionを返す
  if (!player.positionFitness) {
    console.warn('positionFitness not found for player:', player.name);
    return player.originalPosition || player.position;
  }

  const positions = ['pitcher', 'catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];
  let bestPosition = player.position; // デフォルトは現在のposition
  let maxFitness = 0;

  // 最高適正値のポジションを探す
  positions.forEach(pos => {
    const fitness = player.positionFitness[pos] || 0;
    if (fitness > maxFitness) {
      maxFitness = fitness;
      bestPosition = pos;
    }
  });

  return bestPosition;
};

/**
 * 選手の指定ポジションの適正値を取得（統一アクセス）
 * @param {Object} player - 選手オブジェクト
 * @param {string} pos - ポジション名
 * @param {number} defaultValue - デフォルト値（省略時50）
 * @returns {number} 適正値（0-100）
 */
export const getPositionFitness = (player, pos, defaultValue = 50) => {
  if (!player?.positionFitness) return defaultValue;
  return player.positionFitness[pos] ?? defaultValue;
};

export const syncPositionToFitness = (player) => {
  if (!player?.positionFitness || player.position === 'pitcher') return;
  const positions = ['catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];
  let bestPos = player.position;
  let bestVal = player.positionFitness[bestPos] || 0;
  for (const pos of positions) {
    const val = player.positionFitness[pos] || 0;
    if (val > bestVal) { bestVal = val; bestPos = pos; }
  }
  if (bestPos !== player.position) player.position = bestPos;
};

// 肩力から球速上限を算出（肩50→130km, 肩100→165km）
export const getVelocityCap = (arm) => {
  return Math.round(130 + (Math.min(100, arm || 50) - 50) * 0.7);
};

// 肩力ポテンシャルと現在球速のギャップによるキャッチアップ補正
// ギャップが大きい＝投げ方が悪い→練習で改善しやすい
export const getVelocityCatchupMult = (arm, currentVelocity) => {
  const cap = getVelocityCap(arm);
  const gap = cap - currentVelocity;
  if (gap <= 5) return 1.0;
  return Math.min(3.0, 1.0 + (gap - 5) * 0.05);
};

/**
 * スタミナによる能力補正を計算
 * @param {number} currentStamina - 現在のスタミナ
 * @param {number} maxStamina - 最大スタミナ
 * @returns {Object} { velocityPenalty, controlPenalty }
 */
export const getStaminaPenalty = (currentStamina, maxStamina) => {
  const staminaRate = Math.max(0, Math.min(currentStamina / maxStamina, 1));

  // 2次曲線: 50%以上はほぼ影響なし、50%未満で急激に悪化
  // staminaRate=1.0→0, 0.5→-8, 0.3→-18, 0.1→-27, 0→-30
  let velocityPenalty = 0;
  let controlPenalty = 0;

  if (staminaRate < 0.50) {
    // (1 - 2*rate)^2 * maxPenalty: rate=0.5→0, rate=0→maxPenalty
    const deficit = 1 - staminaRate * 2; // 0→1 when rate goes 0.5→0
    controlPenalty = -Math.round(deficit * deficit * 30);
    velocityPenalty = -Math.round(deficit * deficit * 20);
  }

  return { velocityPenalty, controlPenalty };
};

/**
 * 内野手の実効肩力を取得（左投げペナルティ込み）
 * @param {string} position - ポジション名
 * @param {Object} defense - 守備配置オブジェクト
 * @returns {number} 実効肩力
 */
export const getInfielderEffectiveArm = (position, defense) => {
  const player = defense[position];
  let arm = player.arm;

  // セカンド・ショート・サードは左投げで-20
  if ((position === 'second' || position === 'short' || position === 'third')
      && player.throws === 'left') {
    arm = Math.max(0, arm - 20);
  }

  return arm;
};

/**
 * 左右の相性効果を計算
 * @param {string} pitcherThrows - 投手の投げ手（'right'/'left'）
 * @param {string} batterBats - 打者の打席（'right'/'left'/'switch'）
 * @returns {Object} 相性効果オブジェクト
 */
export const getHandednessEffect = (pitcherThrows, batterBats) => {
  // スイッチヒッターの処理
  let effectiveBats = batterBats;
  if (batterBats === 'switch') {
    effectiveBats = pitcherThrows === 'right' ? 'left' : 'right';
  }

  // 相性判定
  const isOppositeHand = (pitcherThrows === 'right' && effectiveBats === 'left') ||
                         (pitcherThrows === 'left' && effectiveBats === 'right');

  // 打席別固有補正
  const isPowerHitter = effectiveBats === 'right';  // 右打者はパワー+2
  const isContactHitter = effectiveBats === 'left';  // 左打者は内野安打+

  if (isOppositeHand) {
    // 有利な組み合わせ（打者有利）
    return {
      meetBonus: 5,
      powerBonus: isPowerHitter ? 2 : 0,  // 右打者のみ+2
      contactBonus: 0.03,
      infieldHitBonus: isContactHitter ? 0.05 : 0,  // 左打者のみ+5%
      label: '打者有利',
      effectiveBats: effectiveBats
    };
  } else {
    // 不利な組み合わせ（投手有利）
    return {
      meetPenalty: -5,
      powerBonus: isPowerHitter ? 2 : 0,  // 右打者のみ+2
      contactBonus: -0.03,
      infieldHitBonus: isContactHitter ? 0.05 : 0,  // 左打者のみ+5%
      label: '投手有利',
      effectiveBats: effectiveBats
    };
  }
};

// ES module exports
