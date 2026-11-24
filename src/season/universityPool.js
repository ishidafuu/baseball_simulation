// ============================================================
// 大学野球プールシステム (universityPool.js)
// 高卒世代 → NPB不指名 → ランク別進路振り分け
// 大学4年間 → 卒業後に再びドラフト/入団候補
// ============================================================

import { generateRandomPlayerName, getRandomGivenName } from '../data/playerNames.js';
import { getRegionalSurname, REGIONAL_SHARE } from '../data/prefectureNames.js';
import { homeBlockOf, blockOfUniversity, HOME_UNIV_PREF } from '../data/regions.js';
import { generateCatcherLead, taperLow, ALL_PITCH_TYPES, FORM_PITCH_SYNERGY, createEmptyStats, blankSeasonStats } from '../utils/constants.js';
import { generatePositionFitness, generateRandomArsenal, generateTwoWayPositionFitness } from './playerFactory.js';
import { getUniversityGrowthMultiplier, UNIVERSITY_TEAMS, getUniversityTeamsByRank } from '../university/universityTeamsData.js';
import { assignHighSchool } from '../data/highSchoolData.js';
import { getVelocityCap, getVelocityCatchupMult } from '../utils/physics.js';
import { dexterityMult } from './growthUtils.js';
import { STAT_GROWTH, growthThreshold, growthDecayRate, stochasticRound, ceilOf } from './growthSystem.js';
import { generateHandedness } from '../utils/handedness.js';
import { releasedPlayersPool, TEAMS_DATA } from '../teams-data.js';
import { buildToolNorms, toolProfile } from '../game/scoutTools.js';
import { addToReleasedPool, replaceReleasedPool } from '../state/pools.js';
import { universityPool, highSchoolPool, clearUniversityPool, clearHighSchoolPool } from '../state/schoolPools.js';
import { addToRoster } from '../state/roster.js';
import { WORLD_DATA } from '../corporate/worldData.js';
import { reservePlayerIds } from '../state/playerIds.js';
import { syncPositionToFitness } from '../utils/physics.js';

export const HIGH_SCHOOL_CLASS_SIZE = 5000;

// 高校生の打撃（ミート・パワー・選球眼）の上の裾を畳む。境より上を係数で圧縮するだけなので
// 中央値と順位は変わらない。`taperLow`（下の裾）と対になる考え方。
const BAT_TAPER_AT = 45;
const BAT_TAPER_K = 0.7;
export const batTaperHigh = (v) => (v > BAT_TAPER_AT ? Math.round(BAT_TAPER_AT + (v - BAT_TAPER_AT) * BAT_TAPER_K) : v);

// 大学・高校のプールの実体は src/state/schoolPools.js（頭の注）。

/**
 * 高卒世代を一括生成（毎年1回、ドラフト前に実行）
 * NPBに指名されるレベルの選手は少数。残りが大学・社会人・独立に流れる。
 * @param {number} year - ゲーム内年度
 * @param {number} count - 生成人数（デフォルト1000）
 * @returns {Array} 生成された高卒選手の配列
 */
export function generateHighSchoolClass(year, count = HIGH_SCHOOL_CLASS_SIZE) {
  const players = [];
  const nextId = reservePlayerIds(year * 100000 + 50000);

  for (let i = 0; i < count; i++) {
    players.push(generateHighSchoolPlayer(nextId()));
  }

  return players;
}

/**
 * 高卒選手を1人生成
 * 才能ランク（S～E）で基礎能力が決まり、一芸特化で個性を付与。
 * 成長力はランクと緩く相関するが、低ランクでも大器晩成型が出現する。
 */
function weightedPick(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + Math.max(1, w), 0);
  let roll = Math.random() * total;
  for (const [key, w] of entries) {
    roll -= Math.max(1, w);
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function generateHighSchoolPlayer(id) {
  // ⚠ **名前はここで作らない**。出身校（＝県）が決まってからでないと
  //    県別の姓を引けない。以前はここで `generateRandomPlayerName()` を呼び、
  //    高校の割り当ては 300行ほど下で行っていた。順序を入れ替えてある。

  // 左右比率は src/utils/handedness.js に一元化（右打56% / 左打41% / 両打3%）
  const { throws, bats } = generateHandedness();

  // === 体格 ===
  const buildRoll = Math.random();
  let build;
  if (buildRoll < 0.25) build = 'large';
  else if (buildRoll < 0.75) build = 'medium';
  else build = 'small';

  const buildMod = {
    large:  { power: 6, arm: 5, speed: -5, defense: -3, steal: -3, bodyStamina: 3 },
    medium: { power: 0, arm: 0, speed: 0, defense: 0, steal: 0, bodyStamina: 0 },
    small:  { power: -5, arm: -3, speed: 5, defense: 3, steal: 4, bodyStamina: -2 }
  }[build];

  const formRand = Math.random() * 100;
  let pitchingForm;
  if (formRand < 48) pitchingForm = 'overhand';
  else if (formRand < 86) pitchingForm = 'threeQuarter';
  else if (formRand < 96) pitchingForm = 'sidearm';
  else pitchingForm = 'submarine';

  const isSideOrUnder = pitchingForm === 'sidearm' || pitchingForm === 'submarine';
  const controlAdjust = isSideOrUnder ? 8 : 0;

  const r = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const cl = (val, lo, hi) => Math.max(lo, Math.min(hi, val));
  const nrm = (mu, sigma) => {
    const a = Math.random() || 0.001, b = Math.random();
    return mu + sigma * Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  };

  // === 共通の運動能力因子（五ツール型を生まれさせる）===
  // ⚠ 旧実装は能力を**独立に**引いていたため、能力どうしの相関がほぼ0だった
  //    （実測: 走力-肩 -0.03 / 走力-守備 0.10 / ミート-パワー 0.17）。
  //    実データのツール間相関は 0.2〜0.4 で、特に運動能力系（走力・肩・守備）は
  //    互いに高い。相関が無いと**「走攻守そろった逸材」も「全部だめな選手」も
  //    出ない**——全員が凸凹の寄せ集めになり、ドラフト1位の見た目が地味になる。
  // ⚠ **周辺分布を変えないこと**。共通因子を足すだけだと各能力の分散が増えて
  //    リーグの較正が動く。σ を √(1-af²) に絞って合計の分散を保つ。
  const ath = nrm(0, 1);
  const ATH = {   // 各能力が運動能力因子から受け取る割合（相関 = af_i × af_j）
    speed: 0.60, arm: 0.60, defense: 0.50, steal: 0.50, power: 0.45, bodyStamina: 0.40,
    meet: 0.30, eye: 0.25, velocity: 0.35, control: 0.15, stamina: 0.30, recovery: 0.25,
  };
  const athAdd = (stat, sigma) => ath * sigma * (ATH[stat] ?? 0);
  const athSigma = (stat, sigma) => sigma * Math.sqrt(1 - (ATH[stat] ?? 0) ** 2);

  // === 才能ランク（連続分布）===
  const talentRoll = Math.random() * 100;
  let tier, off;
  // ⚠ オフセットの幅＝才能ランクの差。旧値（S+22〜E-4 の26点）では
  //    `calculatePlayerRank` の素点で S39.9 対 E23.1 の **16.8点 = 1.7ランク**しかなく、
  //    「才能ランクの差が小さい」と感じる水準だった。35点に広げて約2.4ランクにする。
  if (talentRoll < 1)        { tier = 'S'; off = 28; }
  else if (talentRoll < 4)   { tier = 'A'; off = 19; }
  else if (talentRoll < 12)  { tier = 'B'; off = 9; }
  else if (talentRoll < 28)  { tier = 'C'; off = 2; }
  else if (talentRoll < 68)  { tier = 'D'; off = 0; }
  else                       { tier = 'E'; off = -7; }

  // === Phase 2: 基礎身体能力を先に生成（投手/野手決定の材料）===
  // ⚠ 走る・投げるは**全員が必ずやる身体動作**なので、実在しない水準（20未満）は畳む。
  //    以前は高校生プールが素通りで、ドラフト1〜2位に**走力8**の選手が出ていた。
  let baseArm = taperLow(Math.max(1, Math.round(nrm(38, athSigma('arm', 14)) + athAdd('arm', 14) + off * 0.5 + buildMod.arm)));
  let baseSpeed = taperLow(Math.max(1, Math.round(nrm(35, athSigma('speed', 14)) + athAdd('speed', 14) + buildMod.speed)));

  // === Phase 3: 投手/野手を肩力ベースで決定 ===
  // 肩が強いほど投手になる確率が上がる。
  // ⚠ **指名の投打比率はここで決まる**。`deviationValue` が群（投手/捕手/野手）
  //    ごとに偏差値化しているので、カテゴリ加点が無ければ
  //    **指名比率はプール比率にほぼ一致する**（実測 プール投手41% → 指名も41%）。
  //    実NPBの支配下登録は約半分が投手なので、母集団も50%に合わせる。
  //    ⚠ 加点(`DRAFT_DEMAND`)で寄せないこと——価値の物差しが歪む。
  let pitcherChance = cl(0.185 + baseArm * 0.0076, 0.13, 0.79);
  if (throws === 'left') pitcherChance = cl(pitcherChance + 0.10, 0.10, 0.80);
  const isPitcher = Math.random() < pitcherChance;

  const isTwoWay = Math.random() < 0.01;
  let twoWaySubPosition = null;
  let isPositionCandidate = false; // 投手登録だが野手適性が高い選手（約10%）
  let candidateFieldPos = null;
  if (isTwoWay && isPitcher) {
    const fieldPositions = throws === 'left'
      ? ['first', 'left', 'center', 'right']
      : ['first', 'second', 'third', 'short', 'left', 'center', 'right'];
    twoWaySubPosition = fieldPositions[Math.floor(Math.random() * fieldPositions.length)];
  }

  // === Phase 4: ポジションを能力・体格から決定 ===
  let position;
  if (isPitcher) {
    position = 'pitcher';
  } else if (throws === 'left') {
    const w = {
      first:  20 + (build === 'large' ? 15 : 0) + Math.max(0, 40 - baseSpeed) * 0.3,
      left:   20 + (build === 'large' ? 8 : 0),
      center: 15 + Math.max(0, baseSpeed - 35) * 0.5 + (build === 'small' ? 10 : 0),
      right:  15 + Math.max(0, baseArm - 35) * 0.4
    };
    position = weightedPick(w);
  } else {
    const w = {
      // 捕手も同じ理由で母集団の比率が指名比率になる。実NPBの捕手は約8%
      catcher: 21 + Math.max(0, baseArm - 35) * 0.5 + (build === 'large' ? 6 : build === 'small' ? -5 : 0),
      first:   10 + (build === 'large' ? 10 : build === 'small' ? -3 : 0) + Math.max(0, 40 - baseSpeed) * 0.3,
      second:  12 + Math.max(0, baseSpeed - 30) * 0.3 + (build === 'small' ? 8 : build === 'large' ? -5 : 0),
      third:   12 + Math.max(0, baseArm - 30) * 0.3 + (build === 'large' ? 3 : 0),
      short:   10 + Math.max(0, baseSpeed - 35) * 0.4 + Math.max(0, baseArm - 35) * 0.3 + (build === 'small' ? 5 : build === 'large' ? -8 : 0),
      left:    10 + (build === 'large' ? 5 : 0) + Math.max(0, 35 - baseArm) * 0.2,
      center:  10 + Math.max(0, baseSpeed - 35) * 0.5 + (build === 'small' ? 5 : build === 'large' ? -3 : 0),
      right:   10 + Math.max(0, baseArm - 35) * 0.4 + Math.max(0, baseSpeed - 30) * 0.2
    };
    position = weightedPick(w);
  }

  // === 一芸特化（25%）===
  let specialty = null;
  if (Math.random() < 0.25) {
    specialty = isPitcher
      ? ['power_arm', 'technician', 'iron_arm'][r(0, 2)]
      : ['speedster', 'slugger', 'contact', 'glove', 'cannon'][r(0, 4)];
  }

  // === Phase 5: 能力生成 ===
  /** stat 名を渡すと運動能力因子が乗る。渡さなければ従来どおり独立 */
  const g = (mu, sigma, tf = 0, floor = 1, stat = null) =>
    Math.max(floor, Math.round(
      nrm(mu, stat ? athSigma(stat, sigma) : sigma)
      + (stat ? athAdd(stat, sigma) : 0) + off * tf));

  let abilities;
  if (isTwoWay) {
    const velTierBonus = { S: 12, A: 6, B: 2, C: 0, D: -2, E: -4 };
    if (isPitcher) {
      // 投手登録二刀流: 投手能力メイン、打撃は野手水準（転向候補を上回る本物の両刀）
      const twoWayArm = Math.max(10, baseArm + r(8, 16));
      const twoWayVelCap = getVelocityCap(twoWayArm);
      let velocity = Math.round(nrm(126, 7) + velTierBonus[tier]);
      if (isSideOrUnder) velocity -= 3;
      if (throws === 'left') velocity -= 3;
      abilities = {
        meet:  g(46, 8, 0.8, 15, 'meet'),
        power: g(39, 10, 0.7, 8, 'power'),
        eye:   g(45, 8, 0.7, 10, 'eye'),
        steal: Math.max(1, Math.round(nrm(24, 8) + buildMod.steal * 0.7)),
        speed: baseSpeed,
        arm: twoWayArm,
        defense: taperLow(g(42, 10, 0.5, 5, 'defense')),
        bodyStamina: g(47 + buildMod.bodyStamina, 10, 0, 15),
        recovery: g(62, 9, 0, 42),
        velocity: Math.max(110, Math.min(twoWayVelCap, velocity)),
        control: Math.max(5, Math.round(nrm(26, 8) + off + controlAdjust)),
        stamina: Math.max(60, Math.round(nrm(70, 12) + off * 1.5))
      };
    } else {
      // 野手登録二刀流: 野手能力メイン、肩が強く投手もそこそこ
      const twoWayArm = Math.max(10, baseArm + r(10, 20));
      const velCap = getVelocityCap(twoWayArm); // 野手二刀流は肩力依存の自然な球速上限を維持
      abilities = {
        meet: Math.max(5, Math.round(nrm(35, 9) + off)),
        power: Math.max(8, Math.round(nrm(32, 10) + off + buildMod.power)),
        eye: Math.max(5, Math.round(nrm(32, 8) + off * 0.8)),
        steal: Math.max(1, Math.round(nrm(22, 8) + off * 0.4 + buildMod.steal)),
        speed: baseSpeed,
        arm: twoWayArm,
        defense: Math.max(1, Math.round(nrm(42, 10) + off * 0.6 + buildMod.defense)),
        bodyStamina: g(47 + buildMod.bodyStamina, 10, 0, 15),
        recovery: g(62, 9, 0, 42),
        velocity: Math.max(100, Math.min(velCap, Math.round(nrm(110 + twoWayArm * 0.3, 5)))),
        control: Math.max(5, Math.round(nrm(26, 8) + off + controlAdjust)),
        stamina: Math.max(50, Math.round(nrm(62, 10) + off))
      };
    }
  } else if (isPitcher) {
    // ランクボーナスを大きめに設定（S才能投手で150km超えが年数人現れる程度）
    // velCapは生成・成長すべてに適用（肩力が球速の物理的上限を決める）
    const velTierBonus = { S: 12, A: 6, B: 2, C: 0, D: -2, E: -4 };
    let velocity = Math.round(nrm(126, 9) + velTierBonus[tier]);
    if (isSideOrUnder) velocity -= 3;
    if (throws === 'left') velocity -= 3;
    let control = Math.round(nrm(24, 9) + off + controlAdjust);
    let stamina = Math.round(nrm(70, 14) + off * 1.5);

    if (specialty === 'power_arm') velocity += r(5, 10);
    else if (specialty === 'technician') control += r(10, 20);
    else if (specialty === 'iron_arm') stamina += r(15, 25);

    // 投手はチームで最も身体能力が高い選手が指名される傾向があるため、
    // 打撃・野手能力のベースを引き上げる（野手には及ばないが一定の素質を持つ）
    // さらに10%は「投手に烙印を押されなければ野手だった」型として野手能力が準野手レベル
    isPositionCandidate = Math.random() < 0.10;
    if (isPositionCandidate) {
      candidateFieldPos = throws === 'left'
        ? weightedPick({
            first:  10 + (build === 'large' ? 12 : 0),
            left:   10,
            center: 10 + Math.max(0, baseSpeed - 35) * 0.4,
            right:  10 + Math.max(0, baseArm - 35) * 0.3,
          })
        : weightedPick({
            first:  8 + (build === 'large' ? 12 : 0),
            second: 8 + Math.max(0, baseSpeed - 35) * 0.3,
            third:  10 + Math.max(0, baseArm - 30) * 0.3,
            short:  8 + Math.max(0, baseSpeed - 35) * 0.3 + Math.max(0, baseArm - 35) * 0.2,
            left:   8 + (build === 'large' ? 4 : 0),
            center: 8 + Math.max(0, baseSpeed - 35) * 0.4,
            right:  8 + Math.max(0, baseArm - 35) * 0.3,
          });
    }

    const armValue = Math.max(10, baseArm + r(2, 8));
    const velCap = getVelocityCap(armValue);
    abilities = isPositionCandidate ? {
      // 野手向き投手: 打撃能力は準野手レベル、転向候補
      meet:  g(40, 9, 0.7, 12, 'meet'),
      power: g(39, 11, 0.6, 8, 'power'),
      eye:   g(39, 8, 0.6, 8, 'eye'),
      steal: Math.max(1, Math.round(nrm(24, 9) + buildMod.steal * 0.8)),
      speed: baseSpeed,
      arm: armValue,
      defense: taperLow(g(40, 10, 0.5, 5, 'defense')),
      bodyStamina: g(46 + buildMod.bodyStamina, 10, 0, 15),
      recovery: g(62, 9, 0, 42),
      velocity: Math.max(110, Math.min(velCap, velocity)),
      control: Math.max(5, control),
      stamina: Math.max(60, stamina)
    } : {
      // 通常投手: 打撃は野手より低いが、チームの中心選手らしく一定の素質あり
      meet:  g(30, 8, 0.4, 5, 'meet'),
      power: g(30, 10, 0.4, 6, 'power'),
      eye:   g(32, 7, 0.4, 5, 'eye'),
      steal: Math.max(1, Math.round(nrm(18, 8) + buildMod.steal * 0.6)),
      speed: baseSpeed,
      arm: armValue,
      defense: taperLow(g(36, 10, 0.4, 1, 'defense')),
      bodyStamina: g(45 + buildMod.bodyStamina, 10, 0, 15),
      recovery: g(62, 9, 0, 42),
      velocity: Math.max(110, Math.min(velCap, velocity)),
      control: Math.max(5, control),
      stamina: Math.max(60, stamina)
    };
  } else {
    // ポジション別補正
    const pm = {
      catcher: { meet: -2, power: 0, eye: 0, defense: 4, steal: -5 },
      first:   { meet: 1, power: 5, eye: 1, defense: -4, steal: -4 },
      second:  { meet: 2, power: -3, eye: 2, defense: 3, steal: 2 },
      short:   { meet: 0, power: -3, eye: 1, defense: 5, steal: 1 },
      third:   { meet: 0, power: 3, eye: 0, defense: 2, steal: -2 },
      left:    { meet: 2, power: 4, eye: 1, defense: -3, steal: -1 },
      center:  { meet: 1, power: -3, eye: 1, defense: 4, steal: 3 },
      right:   { meet: 0, power: 2, eye: 0, defense: 1, steal: 0 }
    }[position] || { meet: 0, power: 0, eye: 0, defense: 0, steal: 0 };

    // ポジション適性に基づいた走力・肩力の方向付け
    // 指導者は小中学校から各選手の特性に合ったポジションで育てるため、
    // ポジションと身体能力に強い相関が生まれる
    // あくまで傾向としての補正（強制ではなく偏りを作るだけ）
    // σ=14の正規分布に対して±5程度なので、3σ超えの素材は傾向を覆せる
    const physMod = {
      catcher: { speedAdj:  -5, armAdj:  6 }, // やや鈍足・強肩傾向
      first:   { speedAdj:  -5, armAdj: -3 }, // やや鈍足傾向
      second:  { speedAdj:   4, armAdj:  0 }, // やや俊足傾向
      short:   { speedAdj:   4, armAdj:  4 }, // 俊足・強肩傾向
      third:   { speedAdj:  -1, armAdj:  4 }, // やや強肩傾向
      left:    { speedAdj:  -2, armAdj: -3 }, // やや弱肩傾向
      center:  { speedAdj:   6, armAdj:  0 }, // 俊足傾向（最も強め）
      right:   { speedAdj:   1, armAdj:  3 }, // やや強肩傾向
    }[position] || { speedAdj: 0, armAdj: 0 };
    baseSpeed = Math.max(1, baseSpeed + physMod.speedAdj);
    baseArm   = Math.max(1, baseArm   + physMod.armAdj);

    // ⚠ **打撃だけ「小学生水準」で生成されていた**。能力値の物差し
    //    （20=小学生 / 30=中学生 / 40=高校生 / 50=大学生 / 60=プロ及第点）に対し、
    //    走力36.7・肩38.9・守備39.5 と身体系は高校生水準なのに、
    //    ミート20.1・パワー20.9・選球眼19.0 と打撃だけ小学生水準だった。
    //    その結果、リーグが高校生出身で埋まると**打撃だけが取り残されて打低になる**
    //    （定常リーグ 打率.222 対 初期ロスター.248）。高校生水準へ引き上げる。
    let meet = Math.round(nrm(29, athSigma('meet', 9)) + athAdd('meet', 9) + off + pm.meet);
    let power = Math.round(nrm(27, athSigma('power', 12)) + athAdd('power', 12) + off + buildMod.power + pm.power);
    let eye = Math.round(nrm(28, athSigma('eye', 8)) + athAdd('eye', 8) + off * 0.8 + pm.eye);
    let defense = Math.round(nrm(38, athSigma('defense', 13)) + athAdd('defense', 13) + off * 0.6 + buildMod.defense + pm.defense);
    let steal = Math.round(nrm(22, athSigma('steal', 9)) + athAdd('steal', 9) + off * 0.4 + buildMod.steal + pm.steal);

    if (specialty === 'speedster') { baseSpeed += r(14, 26); steal += r(10, 18); }
    else if (specialty === 'slugger') power += r(14, 26);
    else if (specialty === 'contact') { meet += r(14, 24); eye += r(8, 15); }
    else if (specialty === 'glove') defense += r(14, 24);
    else if (specialty === 'cannon') baseArm += r(18, 30);

    // ⚠ **打撃の上の裾だけ畳む**（`batTaperHigh`）。才能オフセット（S+28）と
    //    専門型の加点（+14〜24）が重なり、高校生の上位3%がミート55・上位1%が61と、
    //    **高卒の時点でNPBレギュラー基準（ミート58）に届く打者**が毎年出ていた。
    //    その層がそのまま大学S・社会人Sのスタメンになるので、アマの上位の打撃が
    //    プロより強くなる根になっていた。中央値は動かさず、45より上だけを圧縮する
    //    （順位は保つ＝「たまに凄い高校生」は残る）。
    meet = batTaperHigh(meet); power = batTaperHigh(power); eye = batTaperHigh(eye);

    abilities = {
      meet: Math.max(5, meet), power: Math.max(8, power),
      eye: Math.max(5, eye), steal: Math.max(1, steal),
      speed: taperLow(Math.max(1, baseSpeed)), arm: taperLow(Math.max(1, baseArm)),
      defense: taperLow(Math.max(1, defense)),
      bodyStamina: g(46 + buildMod.bodyStamina, 10, 0, 15),
      recovery: g(62, 9, 0, 42),
      velocity: Math.max(90, Math.round(nrm(85 + baseArm * 0.6, 5))),
      control: g(20, 7, 0.3, 5),
      stamina: g(42, 8, 0.3, 20)
    };
  }

  // 能力値の上限（100）。⚠ 下限しか切っておらず、専門型の加点（強肩 +18〜30 等）が
  //    乗ると 肩107・パワー113 のような尺度外の高校生が10万人に24人出ていた。
  //    球速（km/h）とスタミナ（尺度が200まで）は対象外
  for (const k of ['meet', 'power', 'eye', 'steal', 'speed', 'arm', 'defense', 'bodyStamina', 'recovery', 'control']) {
    if (typeof abilities[k] === 'number' && abilities[k] > 100) abilities[k] = 100;
  }

  // 成長力: ランクにほぼ依存しない（生まれ持った素質）
  const gpCenter = { S: 1.02, A: 0.98, B: 0.95, C: 0.92, D: 0.90, E: 0.88 };
  const u1 = Math.random() || 0.001;
  const u2 = Math.random();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const growthPotential = cl(gpCenter[tier] + normal * 0.28, 0.35, 1.50);

  const highSchool = assignHighSchool(tier);

  // 出身校の県に固有の姓の表があればそちらから引く（現状は沖縄のみ）。
  // 名（下の名前）は本土と共通なので全国のまま。
  const regional = highSchool?.pref ? getRegionalSurname(highSchool.pref) : null;
  const name = (regional && Math.random() < REGIONAL_SHARE)
    ? regional + ' ' + getRandomGivenName()
    : generateRandomPlayerName();

  // 高校知名度の計算: 出身校ランク + 能力（投手=球速、野手=パワー） + 揺らぎ
  // 高校野球分析サイトの評価軸（強豪校在籍・MAX球速・通算本塁打）を模倣
  const schoolRankFame = { S: 12, A: 8, B: 5, C: 3, D: 2, E: 1, F: 0 }[highSchool?.rank ?? 'F'];
  const abilityFame = (isPitcher || isTwoWay)
    ? (abilities.velocity >= 150 ? 15 : abilities.velocity >= 145 ? 10 : abilities.velocity >= 140 ? 6 : abilities.velocity >= 135 ? 3 : 0)
    : (abilities.power >= 60 ? 12 : abilities.power >= 50 ? 8 : abilities.power >= 40 ? 5 : abilities.power >= 30 ? 3 : 0);
  // 総合能力による揺らぎ: 同ランク・同球速でも選手ごとに差をつける
  const overallBonus = Math.round(
    isPitcher ? abilities.control * 0.05 + abilities.stamina * 0.03 : abilities.meet * 0.04 + abilities.speed * 0.03 + abilities.defense * 0.03
  );
  const famNoise = Math.round((Math.random() - 0.5) * 8);
  const fame = Math.max(0, Math.min(50, schoolRankFame + abilityFame + overallBonus + famNoise));

  return {
    id,
    name,
    age: 18,
    position,
    batting: {
      meet: abilities.meet, power: abilities.power, eye: abilities.eye,
      bats, steal: abilities.steal, bunt: r(10, 40)
    },
    physical: {
      speed: abilities.speed, arm: abilities.arm, throws, build,
      bodyStamina: abilities.bodyStamina, recovery: abilities.recovery,
      muscle: Math.max(5, Math.round(nrm(build === 'large' ? 55 : build === 'small' ? 30 : 42, 10))),
      dexterity: Math.max(5, Math.round(nrm(build === 'large' ? 35 : build === 'small' ? 55 : 42, 10)))
    },
    fielding: { defense: abilities.defense },
    catching: {
      lead: position === 'catcher' ? generateCatcherLead(18) : r(10, 30)
    },
    pitching: {
      velocity: abilities.velocity, control: abilities.control,
      stamina: abilities.stamina, spinRate: r(20, 50),
      form: pitchingForm,
      arsenal: (isPitcher || isTwoWay) ? (() => { const rv = Math.random(); const ex = rv < 0.4 ? 0 : rv < 0.7 ? 1 : rv < 0.9 ? 2 : 3; return generateRandomArsenal(ex, true); })() : generateFielderArsenalBasic()
    },
    isTwoWay,
    twoWaySubPosition,
    growthPotential,
    // 生成時の才能ランク（S〜E）。育成の効きを測る基準として保持する。
    // ⚠ これは「生まれ持ったもの」であって現在の実力ではない。
    //    実力の表示は `calculatePlayerRank`（能力から毎回計算）を使うこと。
    talentTier: tier,
    growthModifier: 0,
    personality: {
      discipline: Math.max(1, Math.min(100, Math.round(50 + (Math.sqrt(-2 * Math.log(Math.random() || 0.001)) * Math.cos(2 * Math.PI * Math.random())) * 18))),
      mental: Math.max(1, Math.min(100, Math.round(50 + (Math.sqrt(-2 * Math.log(Math.random() || 0.001)) * Math.cos(2 * Math.PI * Math.random())) * 18))),
    },
    positionFitness: isTwoWay
      ? generateTwoWayPositionFitness(position, twoWaySubPosition, throws)
      : (isPositionCandidate && candidateFieldPos)
        ? generateTwoWayPositionFitness('pitcher', candidateFieldPos, throws)
        : generatePositionFitness(position),
    fame,
    highSchool: highSchool ? { name: highSchool.name, rank: highSchool.rank, pref: highSchool.pref } : null,
    fatigue: 0,
    experience: 0,
    careerHistory: [{ type: 'highschool', year: null, label: highSchool ? `${highSchool.name}` : '高校卒' }],
    seasonStats: createEmptyStats(),
    careerStats: createEmptyStats()
  };
}

function generateFielderArsenalBasic() {
  const types = ['slider', 'curve', 'fork', 'changeup', 'sinker', 'cutter'];
  const type = types[Math.floor(Math.random() * types.length)];
  return [
    { id: 1, type: 'straight', level: 100 },
    { id: 2, type, level: Math.floor(Math.random() * 15) + 15 }
  ];
}

// ============================================================
// 進路振り分け
// ============================================================

/**
 * 高卒世代の進路を振り分け
 * 能力順にソートし、上位層から大学→社会人→独立の順で配分
 * @param {Array} highSchoolClass - 高卒選手の配列
 * @param {number} year - 入学年度
 * @returns {{ university: Array, corporate: Array, independent: Array, undrafted: Array }}
 */
export function assignCareerPaths(highSchoolClass, year) {
  // 総合力でソート
  const scored = highSchoolClass.map(p => ({
    player: p,
    score: evaluatePlayerPotential(p)
  }));
  scored.sort((a, b) => b.score - a.score);

  const total = scored.length;
  // 上位30%: 大学進学
  const uniCut = Math.floor(total * 0.30);
  // 次の10%: 社会人入り候補
  const corpCut = uniCut + Math.floor(total * 0.10);
  // 次の10%: 独立リーグ候補
  const indCut = corpCut + Math.floor(total * 0.10);
  // 残り50%: 野球を辞める（破棄）

  const university = scored.slice(0, uniCut).map(s => s.player);
  const corporate = scored.slice(uniCut, corpCut).map(s => s.player);
  const independent = scored.slice(corpCut, indCut).map(s => s.player);
  const undrafted = scored.slice(indCut).map(s => s.player);

  return { university, corporate, independent, undrafted };
}

/**
 * 選手の潜在能力を評価（進路振り分け用）
 * 現在の能力 + 成長力を加味
 */
/**
 * いまの力だけの点（伸びしろ・知名度・ゆらぎを混ぜない）。
 * ⚠ 進路の振り分けは `evaluatePlayerPotential`（伸びしろ・知名度こみ）で決める。
 *    こちらは「**画面に出る強さ**で並べたい」ところだけで使う（逸材枠）。
 */
function currentAbilityScore(player) {
  if (player.position === 'pitcher') {
    const v = player.pitching?.velocity || 130;
    const c = player.pitching?.control || 40;
    const s = player.pitching?.stamina || 60;
    return (v - 120) * 1.5 + c + s * 0.4;
  }
  const m = player.batting?.meet || 0;
  const p = player.batting?.power || 0;
  const spd = player.physical?.speed || 0;
  const def = player.fielding?.defense || 0;
  const arm = player.physical?.arm || 0;
  return m + p + spd * 0.5 + def * 0.3 + arm * 0.3;
}

function evaluatePlayerPotential(player) {
  const gp = player.growthPotential || 1.0;
  const abilityScore = currentAbilityScore(player);

  // 成長力で補正（高成長の選手は上位に配置されやすい）
  const growthBonus = (gp - 0.9) * 50;
  // ランダムなゆらぎ（完全な実力順にならないように）
  const noise = (Math.random() - 0.5) * 20;

  // 知名度補正: 無名の逸材は評価が低くなり、下位に流れやすい
  const fame = player.fame || 0;
  const famePenalty = fame < 5 ? -(20 + Math.random() * 10)
                    : fame < 15 ? -(5 + Math.random() * 10)
                    : 0;

  return abilityScore + growthBonus + noise + famePenalty;
}

// ============================================================
// ランク別進路振り分け（NPBドラフト後に実行）
// S→A→B→C→D の順に良い選手から各ランクの大学・社会人・独立に配分
// ============================================================

// 各ランクの受け入れ割合（高校生全体に対する比率）
// 大学は各ランクのチーム数×1チームあたり受け入れ数で算出
const UNI_PER_TEAM = { S: 15, A: 13, B: 11, C: 9, D: 7 };
const RANK_CORP_RATIO = { S: 0.10, A: 0.08, B: 0.06, C: 0.04, D: 0.03 };
const RANK_IND_RATIO  = { S: 0.05, A: 0.04, B: 0.04, C: 0.03, D: 0.03 };

function getUniversitySlotsByRank() {
  const teamCounts = {};
  UNIVERSITY_TEAMS.forEach(t => { teamCounts[t.rank] = (teamCounts[t.rank] || 0) + 1; });
  const slots = {};
  for (const rank of ['S', 'A', 'B', 'C', 'D']) {
    slots[rank] = (teamCounts[rank] || 0) * (UNI_PER_TEAM[rank] || 7);
  }
  return slots;
}

/**
 * NPBドラフトで高校生プールから有力選手を除去
 * 高校生は18歳なので年齢ボーナス+25ptがつく
 * @returns {{ drafted: Array, remaining: Array }}
 */
export function processHighSchoolNPBDraft() {
  const NPB_TEAMS = [
    '読売ジャイアンツ', '阪神タイガース', '横浜DeNAベイスターズ',
    '広島東洋カープ', '中日ドラゴンズ', 'ヤクルトスワローズ',
    'オリックス・バファローズ', 'ソフトバンクホークス', '西武ライオンズ',
    '楽天ゴールデンイーグルス', '千葉ロッテマリーンズ', '日本ハムファイターズ'
  ];

  // 高校生用の閾値（社会人/大学よりやや低い → 将来性重視）
  const HS_PITCHER_THRESHOLD = 200;
  const HS_FIELDER_THRESHOLD = 230;
  const DRAFT_ROUND_LABELS = ['育成指名', 'ドラフト6位', 'ドラフト5位', 'ドラフト4位', 'ドラフト3位', 'ドラフト2位', 'ドラフト1位'];

  const drafted = [];
  const remaining = [];

  highSchoolPool.players.forEach(player => {
    const score = evaluatePlayerPotential(player);
    const isPitcher = player.position === 'pitcher';
    const threshold = isPitcher ? HS_PITCHER_THRESHOLD : HS_FIELDER_THRESHOLD;

    // 成長力が高い選手は追加評価
    const gpBonus = Math.max(0, (player.growthPotential - 1.0) * 40);
    const totalScore = score + gpBonus;

    if (totalScore >= threshold) {
      const npbTeam = NPB_TEAMS[Math.floor(Math.random() * NPB_TEAMS.length)];
      const overThreshold = totalScore - threshold;
      const roundIndex = Math.min(Math.floor(overThreshold / 10), DRAFT_ROUND_LABELS.length - 1);
      drafted.push({
        player,
        npbTeam,
        draftRound: DRAFT_ROUND_LABELS[Math.max(0, roundIndex)],
        position: player.position,
        age: player.age,
        name: player.name,
        playerId: player.id,
        score: totalScore,
        source: 'highschool'
      });
    } else {
      remaining.push(player);
    }
  });

  highSchoolPool.players = remaining;
  return { drafted, remaining };
}

/**
 * ランク別に進路を振り分け（NPBドラフト後に実行）
 * @param {number} enrollYear - 大学入学年度
 * @returns {{ university: Object, corporate: Array, independent: Array, retired: Array }}
 *   university: { S: [...], A: [...], ... } ランク別に分類
 */

// ============================================================
// ⚠ 進路の振り分けは「群ごとに順位を付けてから」帯を切る
//
// `evaluatePlayerPotential` は**投手の評価点が野手より低く出る既知の偏り**を持つ
// （`npbDraft` の節）。1本の順位表を作って上から帯で切ると、その偏りが
// **そのまま進路の構成比になる**。実測で高校生プールは投手50.6%なのに
// **大学プールは19.2%**しか無く、高校の投手の半分が「引退」へ落ちていた。
//
// 群（投手/野手）ごとに順位を付け、母集団の比率どおりに交互へ並べ直す。
// **群の中の順位は完全に保たれる**ので「良い選手ほど良い進路」は変わらず、
// **どの帯を切っても投手の割合が母集団と同じ**になる。
//
// ⚠ 倍率や加点でスケールを揃えようとしないこと——ドラフト評価で2度失敗している。
// ⚠ トライアウトは別経路で既に是正済み（`TRYOUT_OVERDRAW` + `balanceByPosition`）。
//    そちらへこの関数を持ち込むと二重に効く。
// ⚠ **大学推薦スカウトの候補の帯も同じ順位表を切っている**ので、そちらからも呼ぶ
//    （`universityScout.js` の `discoverCandidatesFromPool`）。**同じ並べ替えを書き写さないこと**。
export function balanceRankByPosition(scored) {
  const P = scored.filter(e => e.player?.position === 'pitcher');
  const F = scored.filter(e => e.player?.position !== 'pitcher');
  if (P.length === 0 || F.length === 0) return scored;
  const total = P.length + F.length;
  const out = [];
  let pi = 0, fi = 0;
  for (let k = 0; k < total; k++) {
    const wantP = (k + 1) * P.length / total;   // ここまでに出ているべき投手の数
    if (pi < P.length && (fi >= F.length || pi < wantP)) out.push(P[pi++]);
    else out.push(F[fi++]);
  }
  return out;
}

export function distributeHighSchoolGraduates(enrollYear) {
  const players = highSchoolPool.players.filter(p => !p._universityReserved);
  if (players.length === 0) {
    return { university: {}, corporate: [], independent: [], retired: [] };
  }

  // 潜在能力でソート（降順）
  const scored = balanceRankByPosition(players.map(p => ({
    player: p,
    score: evaluatePlayerPotential(p)
  })).sort((a, b) => b.score - a.score));

  // === 進路は「水準」だけでなく「形」でも決まる（弱者の兵法）===
  // 総合能力に優れた選手は大学・社会人へ進んで万能を目指し、
  // 一芸型は独立・クラブへ進んでその武器を磨く。
  // ⚠ 物差しは候補プールそのものから作る（`scoutTools`。表を二重に作らない）。
  const toolNorms = buildToolNorms(players);
  const spikeCache = new Map();
  const spikeOf = (p) => {
    // `shape`（足切りなし）を使う。`spike` だと能力の低い一芸型が全員0になる
    if (!spikeCache.has(p.id)) spikeCache.set(p.id, toolProfile(p, toolNorms).shape || 0);
    return spikeCache.get(p.id);
  };

  // === 即戦力志望型 独立直行 ===
  // B〜C帯スコア範囲で成長力が高い選手が、大学4年待ちより独立リーグを選ぶ
  // (4年待てない即戦力志向 + 社会人S/Aには届かないがBには行きたくない層)
  const indImpatient = [];
  const skipIndices = new Set();
  const n = scored.length;
  const impatientLo = Math.floor(n * 0.18);  // B帯下位付近から
  const impatientHi = Math.floor(n * 0.58);  // C帯上位付近まで
  for (let i = impatientLo; i < impatientHi && indImpatient.length < 50; i++) {
    const { player: p } = scored[i];
    const gp = p.growthPotential || 1.0;
    if (gp < 1.05) continue;
    // 成長力が高いほど独立を選ぶ確率が上がる（gp1.05→3%, gp1.20→9%, gp1.35→15%）
    // 一芸型はさらに独立を選びやすい（大学で4年かけて万能を目指すより、
    // 試合に出て武器で勝負するほうが自分に向いていると分かっている）
    const prob = Math.min(0.30, (gp - 1.0) * 0.60 * (1 + spikeOf(p) * 0.5));
    if (Math.random() < prob) {
      p.age = Math.max(p.age || 18, 19);
      p.origin = 'independent_impatient';
      p._destinationRank = 'C';
      indImpatient.push(p);
      skipIndices.add(i);
    }
  }

  const remaining = skipIndices.size > 0 ? scored.filter((_, i) => !skipIndices.has(i)) : scored;
  const total = remaining.length;
  const university = { S: [], A: [], B: [], C: [], D: [] };
  const corporate = [];
  const independent = [...indImpatient];
  let cursor = 0;

  const uniSlots = getUniversitySlotsByRank();

  // ランクS→Dの順に上位から取っていく
  for (const rank of ['S', 'A', 'B', 'C', 'D']) {
    const uniCount = Math.min(uniSlots[rank] || 0, total - cursor);
    const corpRatio = RANK_CORP_RATIO[rank] || 0.25;
    const indRatio = RANK_IND_RATIO[rank] || 0.20;
    const corpCount = Math.floor(uniCount * corpRatio / (1 - corpRatio - indRatio));
    const indCount = Math.floor(uniCount * indRatio / (1 - corpRatio - indRatio));
    const slotCount = Math.min(uniCount + corpCount + indCount, total - cursor);
    // 同じランク帯（＝ほぼ同じ水準）の中では、**形**で進路が分かれる。
    // ⚠ 大学・社会人・独立をこの順に並べてはいけない。社会人と独立は枠が小さく
    //    隣り合うので、尖り順に切ると**社会人と独立がほぼ同じ集団になる**
    //    （実測 尖り 社会人2.34 対 独立2.28）。
    //    「総合力に優れるほど大学・社会人、一芸ほど独立」なので、
    //    **先に独立へ一芸型を抜いてから**、残りを従来どおり成績順に大学・社会人へ配る。
    const slice = remaining.slice(cursor, cursor + slotCount);
    cursor += slotCount;
    const bySpike = [...slice].sort((a, b) => spikeOf(b.player) - spikeOf(a.player));
    const toIndependent = new Set(bySpike.slice(0, indCount).map(e => e.player.id));
    const rest = slice.filter(e => !toIndependent.has(e.player.id));   // 成績順のまま

    for (const entry of bySpike.slice(0, indCount)) {
      const p = entry.player;
      p.age = Math.max(p.age || 18, 19);
      p.origin = 'independent_candidate';
      p._destinationRank = rank;
      independent.push(p);
    }
    rest.forEach((entry, i) => {
      const p = entry.player;
      p.age = Math.max(p.age || 18, 19);
      if (i < uniCount) {
        p._destinationRank = rank;
        university[rank].push(p);
      } else {
        p.origin = 'corporate_candidate';
        p._destinationRank = rank;
        corporate.push(p);
      }
    });
  }

  // 残り（どこにも入れなかった選手）は引退
  const retired = remaining.slice(cursor).map(s => s.player);

  // 高校生プールをクリア（推薦予約者は残す）
  const reserved = highSchoolPool.players.filter(p => p._universityReserved);
  highSchoolPool.players = reserved;

  return { university, corporate, independent, retired };
}

// ============================================================
// 独立リーグ トライアウト供給（2年目以降）
// トライアウトはオフシーズンの振り分け前に行われるため、指名者は
// removeDraftedFromGraduatePools() でプールから除去して二重計上を防ぐ。
// 選手の一次供給元は高校生プール。大学4年生・FAは補助的に加える。
// ============================================================

const _cloneForTryout = (p) => JSON.parse(JSON.stringify(p));

const _shuffleInPlace = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// 高校卒業予定選手を独立適性帯から抽出（クローンを返す）
// qualityBias(0-1): 高いほど上位帯から抽出（注目度の高いリーグは良い選手が集まる）
export function getHighSchoolTryoutCandidates(count, qualityBias = 0) {
  const pool = (highSchoolPool.players || []).filter(p => !p._universityReserved);
  if (pool.length === 0 || count <= 0) return [];
  const scored = pool.map(p => ({ p, s: evaluatePlayerPotential(p) })).sort((a, b) => b.s - a.s);
  // リーグの格・注目度(qualityBias)が「**どの層から来るか**」を決める。
  // ⚠ 帯は**ランクごとに明確に分離する**こと。旧値（bias 0で8〜60% / bias 1で2〜45%）は
  //    ほぼ重なっており、実測でDリーグとSリーグの受験者の質がほとんど同じだった
  //    （ミート平均 27.2 対 29.8）。能力の上限を撤廃した以上、リーグの格は
  //    この帯だけで表現される——ここが効かないと「昇格しても何も変わらない」になる。
  //    bias 0(D) → 上位30〜68% / 0.5(B) → 17〜44% / 1.0(S) → 5〜20%
  // エリートの最上位（NPB/大学S志望）は独立に来ないので start に下限を残す。
  const bias = Math.max(0, Math.min(1, qualityBias));
  const start = Math.floor(scored.length * (0.30 - 0.25 * bias));
  const end = Math.max(start + count, Math.floor(scored.length * (0.68 - 0.48 * bias)));
  const band = _shuffleInPlace(scored.slice(start, end));
  return band.slice(0, count).map(({ p }) => _asHighSchoolCandidate(p));
}

/** 高校生プールの選手を受験者の形にする（帯・逸材・素材型で共通） */
function _asHighSchoolCandidate(player, kind = 'band') {
  const c = _cloneForTryout(player);
  // 年末トライアウト時点では高校3年生=18歳。入団後の年次進行で翌キャンプに19歳になる。
  c.age = c.age || 18;
  c.origin = 'independent_candidate';
  c._tryoutSource = 'highschool';
  // どの枠で来たか（検査と、あとで画面に出すときの手がかり。獲得した選手にはそのまま残り、オンラインでは保存にも載る）
  if (kind !== 'band') c._tryoutKind = kind;
  c.isNewcomer = true;
  return c;
}

// ============================================================
// 高校生の「帯の外」から来る2つの枠（いしだ 2026-11-18
// 「高卒が軒並み大学生より弱い。一部強い高校生や、荒削りな素材型がいてほしい」）。
//
// 【なぜ必要か】受験者の高校生は評価順の帯（上位30〜68%）からしか引いていなかった。
// プールには強い選手も一芸の持ち主も居るのに、**どちらも帯より上**にいて来られない。
//   実測（12球団・3回ぶん）: 高卒が大学生の評価の中央値を超えるのは 力で4.7%、
//   大学生の最大を超えた高卒は 358人中0人。走か肩が80以上の高卒は1%（大学は6%）。
//   プール5000人では 走か肩80以上が48人居て、**36人が帯より上**（＝絶対に来ない）。
// ============================================================

/**
 * 逸材枠。プールの**最上位**から引く（大学・NPBではなく、すぐ試合に出られる道を選んだ高校生）。
 * ⚠ **人数で絞ること**（帯を広げない）。帯を上へ広げると高卒全体が強くなり、
 *    「9割は大学生のほうが強い」という釣り合いが崩れる（いしだ要望）。
 */
export function getHighSchoolEliteTryoutCandidates(count) {
  const pool = (highSchoolPool.players || []).filter(p => !p._universityReserved);
  if (pool.length === 0 || count <= 0) return [];
  // ⚠ ここだけ **いまの力**で並べる（`evaluatePlayerPotential` は伸びしろ・知名度・
  //    ゆらぎを混ぜるので、「最上位」を取っても画面では評価49の選手が混じる。実測で
  //    逸材枠の平均が大学生の中央値と並ぶだけだった）
  const scored = pool.map(p => ({ p, s: currentAbilityScore(p) })).sort((a, b) => b.s - a.s);
  // ⚠ プールが引く人数より少ないとき（予約で減った年など）に、無い選手を引かない
  const top = Math.min(scored.length, Math.max(count, Math.floor(scored.length * HS_ELITE_BAND)));
  // ⚠ 帯の中で**上へ寄せて引く**（一様だと帯の平均＝大学生の中央値あたりに固まり、
  //    「飛び抜けた高校生」が出ない）。u² なので半分はプールの上位1.5%から来て、
  //    ときどき最上位（大学生の最大を超える選手）が混じる。
  //    ⚠ 寄せ方を強めるのは良いが、**人数（`HS_ELITE_SHARE`）は増やさないこと**。
  //       増やすと高卒全体が強くなり、「9割は大学生のほうが強い」が崩れる
  const picked = new Set();
  const out = [];
  for (let guard = 0; out.length < count && guard < count * 50; guard += 1) {
    const i = Math.min(top - 1, Math.floor(top * Math.random() ** 2));
    if (picked.has(i)) continue;
    picked.add(i);
    out.push(_asHighSchoolCandidate(scored[i].p, 'elite'));
  }
  return out;
}

/** プールの上位何割から逸材枠を引くか。狭いほど「飛び抜けた高校生」が混じる */
const HS_ELITE_BAND = 0.06;
/**
 * 素材型とみなす一芸の強さ（プールの中での上位何割か）。
 * 実測の線: 上位1.5% は 走69・肩76・体68（プールの中央は 走35・肩43・体46）
 */
const HS_TOOL_BAND = 0.015;
/** 素材型は「総合では目立たない」人から。評価順の上位何割より下を見るか */
const HS_TOOL_MIN_RANK = 0.25;
/**
 * 素材（荒削りな強み）。体幹は体力（`bodyStamina`）で見る。
 * ⚠ **投手と野手で見るものを分ける**。投手の肩は画面にも出ないし、荒削りな投手は
 *    「球は速いが制球が無い」。野手の球速を見ても意味が無い
 */
const HS_TOOLS = [
  { key: 'speed', of: (p) => p.physical?.speed, pitcher: false },
  { key: 'arm', of: (p) => p.physical?.arm, pitcher: false },
  { key: 'velocity', of: (p) => p.pitching?.velocity, pitcher: true },
  { key: 'body-f', of: (p) => p.physical?.bodyStamina, pitcher: false },
  { key: 'body-p', of: (p) => p.physical?.bodyStamina, pitcher: true },
];
const _isPitcher = (p) => p.position === 'pitcher';
const _toolFits = (tool, p) => tool.pitcher === _isPitcher(p);
/** 素材型は伸びしろのある人から選ぶ（荒削りでも、育てば化ける見込みがあること） */
const HS_TOOL_MIN_GROWTH = 1.0;

/**
 * 素材型枠。走・肩・体幹のどれかがプールの上位 `HS_TOOL_BAND` に入る選手を、
 * **総合の評価は見ずに**引く（評価順では上位でない人だけ）。
 * ⚠ 一芸の線は**プールの中の相対**で引くこと。「80以上」のような決め打ちだと、
 *    体幹は実測で80以上が5000人中1人しか居らず、その枠が毎年空になる。
 */
export function getHighSchoolToolTryoutCandidates(count) {
  const pool = (highSchoolPool.players || []).filter(p => !p._universityReserved);
  if (pool.length === 0 || count <= 0) return [];
  const scored = pool.map(p => ({ p, s: evaluatePlayerPotential(p) })).sort((a, b) => b.s - a.s);
  // 評価順で上位すぎる人は逸材枠の仕事（ここは「強くはないが素材がある」人）
  const rankOf = new Map(scored.map(({ p }, i) => [p, i / scored.length]));
  // ⚠ 線は**同じ括りの中で**引く（投手の球速を野手ごみで並べない）
  const cut = {};
  for (const tool of HS_TOOLS) {
    const values = pool
      .filter((p) => _toolFits(tool, p))
      .map(tool.of)
      .filter((v) => typeof v === 'number')
      .sort((a, b) => b - a);
    cut[tool.key] = values.length
      ? values[Math.min(values.length - 1, Math.floor(values.length * HS_TOOL_BAND))]
      : Infinity;
  }
  // ⚠ **一芸ごとに順番に取る**。まとめて無作為に引くと、人数の多い括り（体力の
  //    ある投手）ばかりになり、「足の速い野手」「強肩の野手」が出てこない（実測で
  //    15人中11人が体力型の投手だった）
  // 伸びしろのある人を先に。足りなければ残りから埋める（枠を空けない）
  const order = (list) => [
    ..._shuffleInPlace(list.filter((p) => (p.growthPotential ?? 1) >= HS_TOOL_MIN_GROWTH)),
    ..._shuffleInPlace(list.filter((p) => (p.growthPotential ?? 1) < HS_TOOL_MIN_GROWTH)),
  ];
  const buckets = HS_TOOLS.map((tool) =>
    order(
      pool.filter(
        (p) =>
          (rankOf.get(p) ?? 1) >= HS_TOOL_MIN_RANK &&
          _toolFits(tool, p) &&
          (tool.of(p) ?? -1) >= cut[tool.key],
      ),
    ),
  );
  const taken = new Set();
  const out = [];
  for (let round = 0; out.length < count && round < 50; round += 1) {
    let moved = false;
    for (const bucket of buckets) {
      if (out.length >= count) break;
      while (bucket.length && taken.has(bucket[0])) bucket.shift();
      if (!bucket.length) continue;
      const player = bucket.shift();
      taken.add(player);
      out.push(_asHighSchoolCandidate(player, 'tool'));
      moved = true;
    }
    if (!moved) break;
  }
  return out;
}

// 卒業予定の大学4年生（NPB未指名）を抽出（クローンを返す）
// qualityBias(0-1): 高いほど上位帯から抽出
export function getUniversitySeniorTryoutCandidates(currentYear, count, qualityBias = 0) {
  if (count <= 0) return [];
  const seniors = [];
  // 名簿の4年生（大学生の実体はここ）。指名されたら `removeDraftedFromGraduatePools` が
  // `_srcUniTeam` を頼りに名簿から外す
  const userUniTeam = WORLD_DATA.universityLeague?.userTeam || null;
  for (const [teamName, team] of Object.entries(TEAMS_DATA)) {
    if (!team?.universityData || teamName === userUniTeam) continue;
    for (const p of team.players || []) {
      if ((p.universityYear || 0) >= 4 || (p.age || 18) >= 22) {
        seniors.push({ player: p, universityRank: team.universityData.rank,
          universityTeamId: team.universityTeamId, universityTeamName: teamName, _roster: true });
      }
    }
  }
  for (const enrollYear of Object.keys(universityPool)) {
    const cohort = universityPool[enrollYear];
    if (!cohort) continue;
    for (const entry of cohort) {
      const p = entry.player;
      const yearsInUni = currentYear - entry.enrollYear;
      // 卒業予定の4年生のみ。3年生(21歳/在学2年)は対象外。
      // 4年生は在学3年目 or 22歳（高卒18→入学19→…→4年22）。
      if (yearsInUni >= 3 || (p.age || 18) >= 22) seniors.push(entry);
    }
  }
  if (seniors.length === 0) return [];
  const scored = seniors.map(e => ({ e, s: evaluatePlayerPotential(e.player) })).sort((a, b) => b.s - a.s);
  // エリート(社会人/NPB志望)上位は避け、リーグの格に応じた帯から
  // （高校生プールと同じ考え方。帯はランクごとに分離する）
  const bias = Math.max(0, Math.min(1, qualityBias));
  const start = Math.floor(scored.length * (0.28 - 0.24 * bias));
  const end = Math.max(start + count, Math.floor(scored.length * (0.75 - 0.45 * bias)));
  const band = _shuffleInPlace(scored.slice(start, end));
  return band.slice(0, count).map(({ e }) => {
    // 既存プールで所属大学が未設定（旧不具合で配属されなかった）の場合はランク相当の大学を補填
    if (!e.universityTeamName) {
      const rank = e.universityRank || 'C';
      const userUniTeam = WORLD_DATA.universityLeague?.userTeam || null;
      const pool = UNIVERSITY_TEAMS.filter(t => t.rank === rank && t.name !== userUniTeam);
      const team = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
      if (team) { e.universityTeamName = team.name; e.universityTeamId = team.id; }
    }
    const c = _cloneForTryout(e.player);
    if (e._roster) c._srcUniTeam = e.universityTeamName;
    if (e.universityRank) c.universityRank = e.universityRank;
    if (e.universityTeamName) { c.universityName = e.universityTeamName; c.universityTeamName = e.universityTeamName; }
    c.origin = 'university';
    c._tryoutSource = 'university';
    c.isNewcomer = true;
    return c;
  });
}

// トライアウトで指名された選手を高校生プール・大学プールから除去する
export function removeDraftedFromGraduatePools(draftedIds, draftedPlayers = []) {
  // 大学の名簿から来た4年生は、その大学の名簿から外す（id は名簿の中でだけ一意）
  for (const p of draftedPlayers) {
    if (!p?._srcUniTeam) continue;
    const team = TEAMS_DATA[p._srcUniTeam];
    if (team?.players) {
      const i = team.players.findIndex(x => x.id === p.id && x.name === p.name);
      if (i >= 0) team.players.splice(i, 1);
    }
    delete p._srcUniTeam;
  }
  if (!draftedIds || draftedIds.length === 0) return;
  const drafted = new Set(draftedIds);
  if (highSchoolPool.players?.length) {
    highSchoolPool.players = highSchoolPool.players.filter(p => !drafted.has(p.id));
  }
  for (const enrollYear of Object.keys(universityPool)) {
    const cohort = universityPool[enrollYear];
    if (!cohort) continue;
    const remaining = cohort.filter(entry => !drafted.has(entry.player?.id));
    if (remaining.length === 0) delete universityPool[enrollYear];
    else universityPool[enrollYear] = remaining;
  }
}

// ============================================================
// 大学在学中の成長
// ============================================================

function getTeamLeaguePosition(teamName, regionId) {
  const leagues = WORLD_DATA.universityLeagues;
  if (!leagues) return null;

  const league = leagues[regionId];
  if (!league) return null;

  for (const seasonKey of ['fall', 'spring']) {
    const seasonData = league[seasonKey];
    if (!seasonData?.done) continue;

    if (league.divisions && league.divTeams) {
      const numDiv = league.numDivisions || 2;
      for (let d = 1; d <= numDiv; d++) {
        const standings = seasonData[`standings${d}`];
        if (!standings) continue;
        const idx = standings.findIndex(s => s.team === teamName);
        if (idx >= 0) return { position: idx + 1, total: standings.length, division: d, season: seasonKey };
      }
    } else {
      const standings = seasonData.standings;
      if (!standings) continue;
      const idx = standings.findIndex(s => s.team === teamName);
      if (idx >= 0) return { position: idx + 1, total: standings.length, division: 1, season: seasonKey };
    }
  }
  return null;
}

function applyUniversityFame(entry, currentYear) {
  const player = entry.player;
  const yearsInUni = currentYear - entry.enrollYear;
  const rank = entry.universityRank;
  const teamName = entry.universityTeamName;

  if (!teamName) return;

  const team = UNIVERSITY_TEAMS.find(t => t.name === teamName);
  const regionId = team?.region;

  // リーグの注目度: 六大学・東都など上位リーグほどメディア露出が多い
  const rankFameBase = { S: 4, A: 3, B: 2, C: 1, D: 0 };
  let fameGain = rankFameBase[rank] || 0;

  // リーグ順位ボーナス
  if (regionId) {
    const pos = getTeamLeaguePosition(teamName, regionId);
    if (pos) {
      if (pos.division === 1) {
        if (pos.position === 1) fameGain += 5;
        else if (pos.position === 2) fameGain += 3;
        else if (pos.position === 3) fameGain += 1;
      }
      // 2部所属は注目度が低い
      if (pos.division >= 2) fameGain = Math.max(0, fameGain - 2);
    }
  }

  // 3-4年生（ドラフト候補年）は注目度が上がりやすい
  if (yearsInUni >= 3) fameGain = Math.round(fameGain * 1.5);
  else if (yearsInUni >= 2) fameGain = Math.round(fameGain * 1.2);

  // 能力が高い選手ほど名前が知れ渡る（エース・四番は目立つ）
  const isPitcher = player.position === 'pitcher';
  let abilityBonus = 0;
  if (isPitcher) {
    if (player.pitching?.velocity >= 150) abilityBonus += 3;
    else if (player.pitching?.velocity >= 145) abilityBonus += 1;
    if (player.pitching?.control >= 60) abilityBonus += 1;
  } else {
    if (player.batting?.power >= 60) abilityBonus += 2;
    else if (player.batting?.power >= 50) abilityBonus += 1;
    if (player.batting?.meet >= 60) abilityBonus += 1;
    if (player.physical?.speed >= 70) abilityBonus += 1;
  }
  fameGain += abilityBonus;

  if (fameGain > 0) {
    player.fame = Math.min(100, (player.fame || 0) + fameGain);
  }
}

/**
 * 大学プールの年次更新（毎年オフシーズンに実行）
 * - 在学中の選手の年齢+1、能力成長、知名度蓄積
 * - 4年生（22歳）を卒業として排出
 * @param {number} currentYear - 現在のゲーム年度
 * @returns {{ graduates: Array, enrollmentReport: Object }}
 */
export function processUniversityYear(currentYear) {
  const graduates = [];
  const report = { grown: 0, graduated: 0 };

  Object.keys(universityPool).forEach(enrollYear => {
    const cohort = universityPool[enrollYear];
    if (!cohort) return;

    const remaining = [];
    cohort.forEach(entry => {
      const player = entry.player;
      player.age = (player.age || 18) + 1;

      // 在学年数
      const yearsInUni = currentYear - entry.enrollYear;

      // 卒業判定: 4年経過 or 年齢23歳以上
      if (yearsInUni >= 4 || player.age >= 23) {
        applyUniversityFame(entry, currentYear);
        if (entry.universityTeamId) {
          player.universityTeamId = entry.universityTeamId;
          player.universityName = entry.universityTeamName;
          player.universityTeamName = entry.universityTeamName;
          player.universityRank = entry.universityRank;
        }
        graduates.push(player);
        report.graduated++;
        return;
      }

      // 成長処理（大学の特色に応じた成長）
      applyUniversityGrowth(player, entry.universityRank, entry.universityTeamId);
      applyUniversityFame(entry, currentYear);
      report.grown++;
      remaining.push(entry);
    });

    if (remaining.length === 0) {
      delete universityPool[enrollYear];
    } else {
      universityPool[enrollYear] = remaining;
    }
  });

  return { graduates, report };
}

// フォームごとの適性球種。**試合の表（`FORM_PITCH_SYNERGY`）が正本**——キャンプの
// `FORM_PITCH_AFFINITY` もここから作るので、大学・キャンプ・試合で適性が揃う
const UNI_FORM_PITCH_AFFINITY = FORM_PITCH_SYNERGY;

/**
 * 大学での1年間の成長を適用
 * 大学のspecialtiesに応じて得意分野が伸びやすく、新球種・サブポジも成長
 * @param {Object} player - 選手オブジェクト
 * @param {string|null} universityRank - 大学ランク
 * @param {number|null} universityTeamId - 大学チームID（specialties参照用）
 */
function applyUniversityGrowth(player, universityRank = null, universityTeamId = null) {
  const gp = player.growthPotential || 1.0;
  const rankMult = getUniversityGrowthMultiplier(universityRank);
  const isPitcher = player.position === 'pitcher';

  const team = universityTeamId ? UNIVERSITY_TEAMS.find(t => t.id === universityTeamId) : null;
  const specialties = team?.specialties || [];
  const has = (s) => specialties.includes(s);
  // specialtyに含まれる分野は1.2倍、含まれない分野は0.85倍
  const specMult = (s) => has(s) ? 1.2 : 0.85;

  const decayMult = (current, threshold, rate, floor = 0.10) => {
    if (current < threshold) return 1.0;
    return Math.max(floor, 1.0 - (current - threshold) * rate);
  };

  // ⚠ **能力の物差し（伸びやすさ・天井・ピーク年齢）は `STAT_GROWTH` が単一の権威**。
  //    以前は大学だけ完全に別実装で、base も閾値もハードコードされていた
  //    （技術系は社会人の2.6倍、走力・肩は4〜7倍）。そのため社会人側で天井を
  //    下げても大学卒業生の上位1%が 79→77 としか動かず、
  //    **同じ「ミート60」が進路によって別の意味を持つ**状態だった。
  //    3作品（高校野球版・本作・プロ野球版）で能力値を共有する構想があるので、
  //    ここが分かれていると作品間でスケールがずれる。
  // 大学の性格（ランク・specialties・マイルドなプロ意識）は乗数側で表す。
  const UNIV_GAIN = 2.6;   // STAT_GROWTH の base を大学の成長量に合わせる係数

  // プロ意識。**大学は他カテゴリよりマイルド**にする。
  // 意図: 怠け者でも練習環境があり、ある程度は強制的に練習させられるので、
  //       意識の差は出るが独立（0.55〜1.90）やクラブ（0.10〜2.60）ほど開かない。
  // ⚠ **下限を切ることで「強制的に練習させられる環境」を表す**。
  //    傾き 0.0048（下限なし）では4年間の幅が 3.1点＝0.31ランクしかなく、
  //    マイルドを通り越して事実上無効だった。
  //   意識20→0.78(下限) / 50→1.00 / 80→1.39 / 100→1.65
  //   参考: 独立 0.55〜1.90 / クラブ 0.10〜2.60 と比べて感度は約半分、
  //         かつ怠けても0.78より下がらない（＝落ちはしない）。
  const discipline = player.personality?.discipline ?? 50;
  const disciplineMult = Math.max(0.78, 1.0 + (discipline - 50) * 0.013);

  /**
   * @param key STAT_GROWTH のキー（伸びやすさ・天井・ピーク年齢の出どころ）
   * @param spec 大学の得意分野（specialties）のキー
   */
  const grow = (current, key, spec, capOverride = null, baseMult = 1) => {
    const g = STAT_GROWTH[key];
    let amount = g.base * baseMult * UNIV_GAIN * gp * rankMult * disciplineMult
      * specMult(spec) * (0.7 + Math.random() * 0.6);
    amount *= decayMult(current, growthThreshold(ceilOf(g).threshold, gp), growthDecayRate(ceilOf(g).rate, gp), ceilOf(g).floor);
    return Math.min(capOverride ?? g.cap, current + stochasticRound(amount));
  };

  if (isPitcher) {
    player.pitching.control = grow(player.pitching.control, 'control', 'technique');
    player.pitching.stamina = grow(player.pitching.stamina, 'stamina', 'stamina');
    player.physical.arm = grow(player.physical.arm, 'armP', 'athletic');
    const uniVelCap = getVelocityCap(player.physical.arm);
    const uniVelCatchup = getVelocityCatchupMult(player.physical.arm, player.pitching.velocity);
    player.pitching.velocity = grow(player.pitching.velocity, 'velocity', 'power', uniVelCap, uniVelCatchup);
    if (player.pitching.arsenal) {
      const techBonus = has('technique') ? 1.3 : 1.0;
      player.pitching.arsenal.forEach(pitch => {
        if (pitch.type !== 'straight') {
          pitch.level = Math.min(100, pitch.level + Math.floor(Math.random() * 4 * gp * rankMult * techBonus));
        }
      });
    }
    player.physical.bodyStamina = grow(player.physical.bodyStamina, 'bodyStamina', 'stamina');

    // 新球種習得チャンス（technique or versatility持ちの大学で確率UP）
    const arsenal = player.pitching?.arsenal || [];
    const existingTypes = arsenal.map(p => p.type);
    const hasNewPitchChance = has('technique') || has('versatility');
    // ⚠ 器用さも掛ける（器用さ50で従来どおり）。社会人・独立の
    //    `tryLearnNewPitch` と揃えること——片方だけだと進路で意味が変わる
    const newPitchRate = (hasNewPitchChance ? 0.15 : 0.05) * dexterityMult(player, 0.5);
    if (Math.random() < newPitchRate) {
      const form = player.pitching?.form || 'overhand';
      const affinityTypes = UNI_FORM_PITCH_AFFINITY[form] || [];
      // フォーム適性球種を優先候補にする
      let candidates = affinityTypes.filter(t => !existingTypes.includes(t));
      if (candidates.length === 0) {
        candidates = ALL_PITCH_TYPES.filter(t => !existingTypes.includes(t));
      }
      if (candidates.length > 0) {
        const newType = candidates[Math.floor(Math.random() * candidates.length)];
        const isAffinity = affinityTypes.includes(newType);
        const baseLevel = Math.floor(Math.random() * 20) + (isAffinity ? 25 : 15);
        const newId = arsenal.length > 0 ? Math.max(...arsenal.map(a => a.id || 0)) + 1 : 1;
        arsenal.push({ id: newId, type: newType, level: baseLevel });
        if (!player.pitching.arsenal) player.pitching.arsenal = arsenal;
      }
    }
  } else {
    player.batting.meet = grow(player.batting.meet, 'meet', 'technique');
    player.batting.power = grow(player.batting.power, 'power', 'power');
    player.batting.eye = grow(player.batting.eye, 'eye', 'mental');
    player.physical.speed = grow(player.physical.speed, 'speed', 'athletic');
    player.fielding.defense = grow(player.fielding.defense, 'defense', 'defense');
    player.physical.arm = grow(player.physical.arm, 'arm', 'athletic');
    player.physical.bodyStamina = grow(player.physical.bodyStamina, 'bodyStamina', 'stamina');

    // サブポジ成長（defense or versatility持ちの大学で確率UP）
    if (player.positionFitness) {
      const hasSubPosChance = has('defense') || has('versatility');
      const subPosRate = hasSubPosChance ? 0.35 : 0.12;
      if (Math.random() < subPosRate) {
        const allPos = ['catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];
        const nonMain = allPos.filter(p => p !== player.position);
        const weak = nonMain.filter(p => (player.positionFitness[p] || 0) < 70);
        const targets = weak.length > 0 ? weak : nonMain;
        const picked = targets[Math.floor(Math.random() * targets.length)];
        const old = player.positionFitness[picked] || 0;
        // ⚠ キャンプの `subposition` と同じ幅(0.4)にすること
        const gain = Math.max(1, Math.round(
          (Math.floor(Math.random() * 8) + (hasSubPosChance ? 7 : 4)) * dexterityMult(player, 0.4)));
        player.positionFitness[picked] = Math.min(100, old + gain);
      }
      syncPositionToFitness(player);
    }
  }

  // フィジカル共通
  player.physical.muscle = grow(player.physical.muscle || 40, 'muscle', 'athletic');
  player.physical.dexterity = grow(player.physical.dexterity || 40, 'dexterity', 'athletic');
  player.physical.recovery = grow(player.physical.recovery || 40, 'recovery', 'stamina');
}

// ============================================================
// 入学・卒業の統合処理
// ============================================================

/**
 * 高卒世代を大学プールに入学させる（具体的な大学チームに配属）
 * @param {Array|Object} players - 大学進学する選手の配列、またはランク別オブジェクト { S: [...], A: [...], ... }
 * @param {number} enrollYear - 入学年度
 */
export function enrollInUniversity(players, enrollYear, allTeams = TEAMS_DATA) {
  const stage = (entry) => {
    if (!universityPool[enrollYear]) universityPool[enrollYear] = [];
    universityPool[enrollYear].push(entry);
  };
  // 名簿があればそこへ入れる（大学生の実体は名簿ひとつ）。無ければ初期化中の仮置き
  const place = (player, rank, team) => {
    const roster = team?.name ? allTeams[team.name] : null;
    if (roster?.players) {
      prepareUniversityFreshman(player, rank, team);
      addToRoster(roster, player);
    } else {
      stage({
        player, enrollYear, graduateYear: enrollYear + 4,
        universityRank: rank,
        universityTeamId: team?.id || null,
        universityTeamName: team?.name || null,
      });
    }
  };

  const teamCounts = {};
  // ユーザーが操作している大学（大学モード）のみNPC配属から除外する。
  // 独立/社会人モードでは234大学がすべてTEAMS_DATAに載るため、TEAMS_DATA全体で
  // 除外すると配属先が無くなり所属が「大学」表記になってしまう不具合を防ぐ。
  const userUniTeam = WORLD_DATA.universityLeague?.userTeam || null;
  // 捕手は「捕手の少ない大学」へ。⚠ 以前は守備位置を見ずに配っており、
  //   捕手0人の大学が常に13〜23校あった（亜細亜大学: 60人中 捕手0・投手29）
  const catchersOf = (t) => (allTeams[t.name]?.players || []).filter(p => p.position === 'catcher').length
    + (teamCatchers[t.id] || 0);
  const teamCatchers = {};
  const assignTeam = (rank, homeBlock = null, position = null) => {
    const teams = UNIVERSITY_TEAMS.filter(t => t.rank === rank && t.name !== userUniTeam);
    if (teams.length === 0) return null;
    let minCount = Infinity;
    let candidates = [];
    teams.forEach(t => {
      const count = teamCounts[t.id] || 0;
      if (count < minCount) {
        minCount = count;
        candidates = [t];
      } else if (count === minCount) {
        candidates.push(t);
      }
    });
    // 地元優先。⚠ **枠は均等割り（最も空いている大学）のまま**にすること。
    //    地元だからと空きを無視して入れると、人口の多い地区の大学だけ膨らむ。
    //    同じだけ空いている大学が複数あるときに、地元をより高い確率で選ぶ。
    if (position === 'catcher') {
      const least = Math.min(...candidates.map(catchersOf));
      candidates = candidates.filter(t => catchersOf(t) === least);
    }
    const home = homeBlock ? candidates.filter(t => blockOfUniversity(t) === homeBlock) : [];
    const pick = (home.length && Math.random() < HOME_UNIV_PREF) ? home : candidates;
    const team = pick[Math.floor(Math.random() * pick.length)];
    teamCounts[team.id] = (teamCounts[team.id] || 0) + 1;
    // 名簿に入る場合は名簿の人数に数えられるので、仮置き（名簿なし）のときだけ数える
    if (position === 'catcher' && !allTeams[team.name]?.players) teamCatchers[team.id] = (teamCatchers[team.id] || 0) + 1;
    return team;
  };

  const addUniHistory = (player, team) => {
    if (!player.careerHistory) player.careerHistory = [];
    if (team?.name) {
      player.careerHistory.push({ type: 'university', year: enrollYear, label: team.name });
    }
  };

  if (Array.isArray(players)) {
    players.forEach(player => {
      const rank = player._destinationRank || 'C';
      const team = assignTeam(rank, homeBlockOf(player), player.position);
      addUniHistory(player, team);
      player.age = Math.max(player.age || 18, 19);
      place(player, rank, team);
    });
  } else {
    for (const rank of ['S', 'A', 'B', 'C', 'D']) {
      if (!players[rank]) continue;
      players[rank].forEach(player => {
        const team = assignTeam(rank, homeBlockOf(player), player.position);
        addUniHistory(player, team);
        player.age = Math.max(player.age || 18, 19);
        place(player, rank, team);
      });
    }
  }
}

// 名簿に入る新1年生の支度（所属・学年・成績欄）
function prepareUniversityFreshman(player, rank, team, universityYear = 1) {
  player.universityTeamId = team.id ?? player.universityTeamId ?? null;
  player.universityTeamName = team.name;
  player.universityRank = rank;
  player.universityYear = universityYear;
  player.recruitType = player.recruitType || 'recommended';
  player.isStarter = false;
  player.battingOrder = 0;
  delete player._destinationRank;
  if (!player.positionFitness) player.positionFitness = generatePositionFitness(player.position);
  syncPositionToFitness(player);
  if (!player.seasonStats) player.seasonStats = blankSeasonStats();
}

/**
 * 大学在学生1人の1年分（成長＋知名度）。**名簿の選手に掛ける唯一の経路**。
 * ⚠ 以前は成長がプールの選手にしか掛からず、名簿の大学生は年齢カーブの
 *    わずかな変動しか受けていなかった（3年でミート +1.4 対 プール +11.4）。
 * @param {number} universityYear この1年を終えた時点の学年（1〜4）
 */
export function applyUniversityYear(player, { rank, teamId, teamName, universityYear, currentYear, grow = true }) {
  applyUniversityFame({
    player, universityRank: rank, universityTeamName: teamName,
    enrollYear: currentYear - (universityYear - 1),
  }, currentYear);
  if (grow) applyUniversityGrowth(player, rank, teamId);
}

/** 大学生（名簿＋初期化中の仮置き）の総数 */
export function countUniversityStudents(allTeams = TEAMS_DATA) {
  let n = Object.values(universityPool).reduce((sum, c) => sum + (c?.length || 0), 0);
  for (const t of Object.values(allTeams)) if (t?.universityData) n += t.players?.length || 0;
  return n;
}

/**
 * 仮置きのプールに残った在学生を名簿へ移す（旧セーブの移行もここ）。
 * ⚠ 旧セーブはプールと名簿の**両方に別人の在学生**を持つので、移すと一時的に
 *    名簿が大きくなる（4年で卒業して元の規模に戻る）。どちらも実在の選手なので捨てない。
 */
export function absorbUniversityPoolIntoRosters(allTeams = TEAMS_DATA, currentYear = 1) {
  let moved = 0;
  for (const enrollYear of Object.keys(universityPool)) {
    const cohort = universityPool[enrollYear] || [];
    const rest = [];
    for (const e of cohort) {
      const roster = e.universityTeamName ? allTeams[e.universityTeamName] : null;
      if (!roster?.players || !e.player) { rest.push(e); continue; }
      const grade = Math.max(1, Math.min(4, currentYear - Number(enrollYear) + 1));
      prepareUniversityFreshman(e.player, e.universityRank || roster.universityData?.rank || 'C',
        { id: e.universityTeamId, name: e.universityTeamName }, grade);
      addToRoster(roster, e.player);
      moved++;
    }
    if (rest.length) universityPool[enrollYear] = rest; else delete universityPool[enrollYear];
  }
  return moved;
}

/**
 * ゲーム開始時・セーブロード時に大学プールを初期シードする
 * 過去数年分の高校卒業生を遡って生成し、大学に在籍させる
 * これにより、Year1のドラフトから大学生が指名可能になる
 * @param {number} gameYear - 現在のゲーム年度
 */
export function seedInitialUniversityClasses(gameYear) {
  // ⚠ 名簿も数えること。プールは仮置きなので普段は空で、プールだけ見ると
  //    毎回8920人を作り直して名簿へ足してしまう（この関数は日送りのたびに呼ばれる）
  if (countUniversityStudents() > 0) return;

  const classesNeeded = 4;
  const uniSlots = getUniversitySlotsByRank();
  const totalUniSlots = Object.values(uniSlots).reduce((s, v) => s + v, 0);

  for (let i = 0; i < classesNeeded; i++) {
    const enrollYear = gameYear - classesNeeded + i + 1;
    const yearsInUni = gameYear - enrollYear;
    const count = Math.floor(totalUniSlots * 2.5);
    const nextId = reservePlayerIds((enrollYear + 10000) * 100000 + 70000);
    const players = [];
    for (let j = 0; j < count; j++) {
      const p = generateHighSchoolPlayer(nextId());
      p.age = 19 + yearsInUni;
      players.push(p);
    }

    // ⚠ **枠の2.5倍を生成して上位だけ採る**ので、順位表の偏りがそのまま構成比になる。
    //    群ごとに順位を付け直してから切ること（`balanceRankByPosition`）。
    const scored = balanceRankByPosition(
      players.map(p => ({ player: p, score: evaluatePlayerPotential(p) }))
        .sort((a, b) => b.score - a.score)
    );
    const uniPlayers = { S: [], A: [], B: [], C: [], D: [] };
    let cursor = 0;
    for (const rank of ['S', 'A', 'B', 'C', 'D']) {
      const slotCount = uniSlots[rank] || 0;
      const slice = scored.slice(cursor, cursor + slotCount);
      cursor += slotCount;
      slice.forEach(entry => {
        entry.player._destinationRank = rank;
        uniPlayers[rank].push(entry.player);
      });
    }

    // 一旦プールに仮置きしてから成長させ、最後に名簿へ移す
    enrollInUniversity(uniPlayers, enrollYear, {});

    const cohort = universityPool[enrollYear];
    if (cohort) {
      for (let y = 0; y < yearsInUni; y++) {
        cohort.forEach(entry => {
          applyUniversityGrowth(entry.player, entry.universityRank, entry.universityTeamId);
        });
      }
    }
  }
  absorbUniversityPoolIntoRosters(TEAMS_DATA, gameYear);
}

// ============================================================
// パイプラインウォームアップ（ゲーム開始時に4年分を事前シミュレート）
// 高校生成→簡易ドラフト→進路振り分け→大学成長→卒業→社会人補充
// これにより、Year2以降もドラフト候補が全ソースからバランスよく出る
// ============================================================

function mockNPBDraftScore(player) {
  const isPitcher = player.position === 'pitcher';
  const age = player.age || 18;
  const ageBonusMap = { 18: 28, 19: 22, 20: 15, 21: 8, 22: 5, 23: 2, 24: 0, 25: -10, 26: -22 };
  const ageBonus = ageBonusMap[age] !== undefined ? ageBonusMap[age] : -30;
  const potentialMult = age <= 18 ? 1.18 : age <= 19 ? 1.12 : age <= 20 ? 1.06 : age <= 21 ? 1.02 : 1.0;
  const gp = player.growthPotential || 1.0;
  const fame = player.fame || 0;
  const fameBonus = Math.round(fame * 0.3);

  const isYoung = age <= 19;
  const isMature = age >= 22;

  let rawAbility, abilityScore;
  if (isPitcher) {
    const v = player.pitching?.velocity || 0;
    const c = player.pitching?.control || 0;
    const s = player.pitching?.stamina || 0;
    const breakingBalls = (player.pitching?.arsenal || []).filter(a => a.type !== 'straight');
    const bestBreaking = breakingBalls.reduce((max, a) => Math.max(max, a.level || 0), 0);
    const arsenalCount = breakingBalls.filter(a => (a.level || 0) >= 20).length;

    const velBase = isYoung ? 1.4 : isMature ? 0.9 : 1.1;
    const vel140 = isYoung ? 3.5 : isMature ? 2.5 : 3.0;
    const vel150 = isYoung ? 4.5 : isMature ? 3.0 : 3.5;
    const ctrlW = isYoung ? 0.7 : isMature ? 1.4 : 1.1;
    const staW = isYoung ? 0.15 : isMature ? 0.35 : 0.25;
    const breakW = isYoung ? 0.5 : isMature ? 1.0 : 0.8;

    let velocityScore = Math.max(0, (v - 110) * velBase);
    if (v >= 140) velocityScore += (v - 140) * vel140;
    if (v >= 150) velocityScore += (v - 150) * vel150;
    const breakingScore = bestBreaking * breakW + (arsenalCount >= 3 ? 12 : arsenalCount >= 2 ? 5 : 0);
    rawAbility = velocityScore + c * ctrlW + s * staW + breakingScore;

    if (isYoung) {
      rawAbility += (player.physical?.arm || 0) * 0.3;
      const form = player.pitching?.form;
      if (form === 'submarine') rawAbility -= 20;
      else if (form === 'sidearm') rawAbility -= 10;
    }
    if (isMature) {
      const form = player.pitching?.form;
      if (form === 'submarine') rawAbility += 8;
      else if (form === 'sidearm') rawAbility += 5;
    }
    abilityScore = rawAbility * potentialMult;
  } else {
    const m = player.batting?.meet || 0;
    const p = player.batting?.power || 0;
    const e = player.batting?.eye || 0;
    const spd = player.physical?.speed || 0;
    const def = player.fielding?.defense || 0;
    const arm = player.physical?.arm || 0;

    const meetW = isYoung ? 0.6 : isMature ? 1.3 : 1.0;
    const powerW = isYoung ? 1.3 : isMature ? 0.8 : 1.0;
    const eyeW = isYoung ? 0.2 : isMature ? 0.8 : 0.5;
    const speedW = isYoung ? 0.7 : isMature ? 0.3 : 0.4;
    const defW = isYoung ? 0.2 : isMature ? 0.7 : 0.4;
    const armW = isYoung ? 0.5 : isMature ? 0.2 : 0.3;

    rawAbility = m * meetW + p * powerW + e * eyeW + spd * speedW + def * defW + arm * armW;
    abilityScore = rawAbility * potentialMult;
  }
  const abilityFactor = Math.min(1.0, rawAbility / (isPitcher ? 120 : 130));
  const gpBonus = age <= 19 ? Math.max(0, (gp - 0.65) * 38) * abilityFactor
                : age <= 22 ? Math.max(0, (gp - 0.8) * 25) * abilityFactor
                : Math.max(0, (gp - 1.0) * 15);
  return abilityScore + ageBonus + gpBonus + fameBonus;
}

function runMockNPBDraft(hsPlayers, uniGraduates) {
  const MIN_SCORE = 80;
  const DRAFT_SLOTS = 72;

  const candidates = [];
  hsPlayers.forEach(p => candidates.push({ player: p, score: mockNPBDraftScore(p), source: 'highschool' }));
  uniGraduates.forEach(p => candidates.push({ player: p, score: mockNPBDraftScore(p), source: 'university' }));

  const eligible = candidates.filter(c => c.score >= MIN_SCORE);
  eligible.sort((a, b) => b.score - a.score);
  const drafted = eligible.slice(0, DRAFT_SLOTS);
  const draftedIds = new Set(drafted.map(d => d.player.id));

  return {
    draftedIds,
    draftedCount: { highschool: drafted.filter(d => d.source === 'highschool').length, university: drafted.filter(d => d.source === 'university').length },
  };
}

export function warmUpPlayerPipeline(gameYear) {
  const existingCount = Object.values(universityPool).reduce((sum, cohort) => sum + (cohort?.length || 0), 0);
  if (existingCount > 0) return;

  const WARMUP_YEARS = 4;

  for (let i = 0; i < WARMUP_YEARS; i++) {
    const simYear = gameYear - WARMUP_YEARS + i;
    const enrollYear = simYear + 1;
    const yearsFromStart = i;

    // 1. 高校生プール生成
    const idBase = (simYear + 10000) * 100000 + 50000;
    const hsPlayers = [];
    for (let j = 0; j < HIGH_SCHOOL_CLASS_SIZE; j++) {
      hsPlayers.push(generateHighSchoolPlayer(idBase + j));
    }

    // 2. 大学4年生の卒業処理（2年目以降のサイクルで卒業者が出る）
    const uniGraduates = [];
    Object.keys(universityPool).forEach(ey => {
      const cohort = universityPool[ey];
      if (!cohort) return;
      const remaining = [];
      cohort.forEach(entry => {
        entry.player.age = (entry.player.age || 18) + 1;
        const yearsInUni = enrollYear - entry.enrollYear;
        if (yearsInUni >= 4 || entry.player.age >= 23) {
          if (entry.universityTeamId) {
            entry.player.universityTeamId = entry.universityTeamId;
            entry.player.universityName = entry.universityTeamName;
            entry.player.universityTeamName = entry.universityTeamName;
            entry.player.universityRank = entry.universityRank;
          }
          uniGraduates.push(entry.player);
        } else {
          applyUniversityGrowth(entry.player, entry.universityRank, entry.universityTeamId);
          remaining.push(entry);
        }
      });
      if (remaining.length === 0) delete universityPool[ey];
      else universityPool[ey] = remaining;
    });

    // 3. 簡易NPBドラフト（高校生 + 大学卒業生から上位を除去）
    const { draftedIds } = runMockNPBDraft(hsPlayers, uniGraduates);
    const remainingHS = hsPlayers.filter(p => !draftedIds.has(p.id));
    const remainingGrads = uniGraduates.filter(p => !draftedIds.has(p.id));

    // 4. 大学卒業生の進路（ドラフト漏れ → 社会人/独立/引退）
    const gradScored = remainingGrads.map(p => ({ player: p, score: evaluatePlayerPotential(p) }));
    gradScored.sort((a, b) => b.score - a.score);
    const corpCut = Math.floor(gradScored.length * 0.40);
    const indCut = Math.floor(gradScored.length * 0.55);
    gradScored.forEach((entry, idx) => {
      const grad = entry.player;
      if (idx < corpCut) {
        grad.postGradPath = 'corporate';
        grad.origin = 'corporate_candidate';
      } else if (idx < indCut) {
        grad.postGradPath = 'independent';
        grad.origin = 'independent_candidate';
      } else {
        grad.postGradPath = 'retired';
      }
      if (grad.postGradPath !== 'retired') {
        addToReleasedPool(grad);
      }
    });

    // 5. 高校生の進路振り分け（ドラフト漏れ）
    highSchoolPool.players = remainingHS;
    highSchoolPool.year = simYear;
    const hsDistribution = distributeHighSchoolGraduates(enrollYear);

    // 大学入学。⚠ ウォームアップ中は必ずプールに仮置きする（`{}` を渡す）。大学モードでは
    //    自リーグの大学が既に TEAMS_DATA に居るので、名簿へ直接入れると
    //    ウォームアップの加齢・成長・卒業を通らない選手が名簿に混ざる
    enrollInUniversity(hsDistribution.university, enrollYear, {});

    // 社会人・独立候補はリリースプールへ（高卒1年目=19歳）
    hsDistribution.corporate.forEach(p => {
      p.isStarter = false;
      p.battingOrder = 0;
      p.age = Math.max(19, p.age);
      addToReleasedPool(p);
    });
    hsDistribution.independent.forEach(p => {
      p.isStarter = false;
      p.battingOrder = 0;
      p.age = Math.max(19, p.age);
      addToReleasedPool(p);
    });
  }

  // 6. 最後に在学中の全コホートの年齢を正しく設定（ゲーム開始年基準）
  Object.keys(universityPool).forEach(ey => {
    const cohort = universityPool[ey];
    if (!cohort) return;
    const yearsInUni = gameYear - parseInt(ey);
    cohort.forEach(entry => {
      entry.player.age = 19 + yearsInUni;
    });
  });

  // 7. 社会人AIチームにリリースプールから選手を補充
  distributeToCorporateTeams(gameYear);
}

function distributeToCorporateTeams(gameYear) {
  if (releasedPlayersPool.length === 0) return;

  const corpTeams = Object.entries(TEAMS_DATA)
    .filter(([, t]) => t.corporateData && t.corporateData.type === 'enterprise')
    .map(([name, team]) => ({ name, team, count: team.players?.length || 0 }));
  const clubTeams = Object.entries(TEAMS_DATA)
    .filter(([, t]) => t.corporateData && t.corporateData.type === 'club')
    .map(([name, team]) => ({ name, team, count: team.players?.length || 0 }));

  if (corpTeams.length === 0 && clubTeams.length === 0) return;

  const scored = releasedPlayersPool
    .map((p, idx) => ({ player: p, idx, score: evaluatePlayerPotential(p) }))
    .sort((a, b) => b.score - a.score);

  const usedIndices = new Set();
  const ROSTER_CAPS = { S: 38, A: 35, B: 30, C: 27, D: 20 };

  // 企業チーム: 上位選手を優先配分
  const sortedCorp = [...corpTeams].sort((a, b) => {
    const capA = ROSTER_CAPS[a.team.corporateData.rank] || 25;
    const capB = ROSTER_CAPS[b.team.corporateData.rank] || 25;
    return (a.count / capA) - (b.count / capB);
  });

  for (const teamInfo of sortedCorp) {
    const cap = ROSTER_CAPS[teamInfo.team.corporateData.rank] || 25;
    const needed = Math.max(0, cap - teamInfo.count);
    const toAdd = Math.min(needed, Math.floor(needed * 0.3) + 1);
    let added = 0;
    for (const entry of scored) {
      if (added >= toAdd) break;
      if (usedIndices.has(entry.idx)) continue;
      const p = { ...entry.player };
      p.age = Math.max(19, p.age);
      p.isStarter = false;
      p.battingOrder = 0;
      if (!p.careerHistory) p.careerHistory = [];
      p.careerHistory.push({ type: 'corporate_join', year: gameYear, label: teamInfo.name });
      addToRoster(teamInfo.team, p);
      usedIndices.add(entry.idx);
      added++;
    }
    teamInfo.count += added;
  }

  // クラブチーム: 中〜下位選手を配分
  const sortedClub = [...clubTeams].sort((a, b) => a.count - b.count);
  for (const teamInfo of sortedClub) {
    const cap = 20;
    const needed = Math.max(0, cap - teamInfo.count);
    const toAdd = Math.min(needed, 2);
    let added = 0;
    for (let i = scored.length - 1; i >= 0; i--) {
      if (added >= toAdd) break;
      if (usedIndices.has(scored[i].idx)) continue;
      const p = { ...scored[i].player };
      p.age = Math.max(19, p.age);
      p.isStarter = false;
      p.battingOrder = 0;
      if (!p.careerHistory) p.careerHistory = [];
      p.careerHistory.push({ type: 'club_join', year: gameYear, label: `${teamInfo.name}入部` });
      addToRoster(teamInfo.team, p);
      usedIndices.add(scored[i].idx);
      added++;
    }
  }

  // 使用した選手をリリースプールから除去
  const remaining = releasedPlayersPool.filter((_, idx) => !usedIndices.has(idx));
  replaceReleasedPool(remaining);
}


/**
 * セーブ/ロード用: 大学プール+高校生プールをシリアライズ
 */
function clonePlayerLite(p) {
  const clone = {};
  for (const key of Object.keys(p)) {
    if (key === 'seasonStats' || key === 'careerStats' || key === 'gameLog' || key === 'lastAtBat' || key === 'lastPitch') continue;
    const v = p[key];
    clone[key] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  }
  return clone;
}

export function serializeUniversityPool() {
  const uni = {};
  for (const [year, cohort] of Object.entries(universityPool)) {
    uni[year] = cohort.map(entry => {
      const e = { ...entry };
      if (e.player) e.player = clonePlayerLite(e.player);
      return e;
    });
  }
  const hs = {
    players: (highSchoolPool.players || []).map(clonePlayerLite),
    year: highSchoolPool.year
  };
  return { university: uni, highSchool: hs };
}

/**
 * セーブ/ロード用: シリアライズされたデータから復元
 */
export function deserializeUniversityPool(data) {
  clearUniversityPool();
  clearHighSchoolPool();
  if (!data) return;

  // ⚠ 保存ではプールの選手の成績欄を落としている（まだ試合に出ていないので空）。
  //    ロードで戻さないと、大学・社会人・ドラフトで名簿に入った選手が成績欄の無いまま
  //    年度替わりを迎え、通算成績が作られなかった（実測で通算成績の無い選手が約2700人）
  const restoreStats = (player) => {
    if (!player || typeof player !== 'object') return;
    if (!player.seasonStats) player.seasonStats = createEmptyStats();
    if (!player.careerStats) player.careerStats = createEmptyStats();
  };
  // 後方互換: 旧形式（大学プールのみ）の場合
  // ⚠ 旧形式でも成績欄を戻すこと（新形式と同じ理由）
  if (!data.university && !data.highSchool) {
    Object.entries(data).forEach(([year, cohort]) => {
      universityPool[year] = cohort;
      if (Array.isArray(cohort)) cohort.forEach(entry => restoreStats(entry?.player));
    });
    return;
  }

  if (data.university) {
    Object.entries(data.university).forEach(([year, cohort]) => {
      universityPool[year] = cohort;
      if (Array.isArray(cohort)) cohort.forEach(entry => restoreStats(entry?.player));
    });
  }
  if (data.highSchool) {
    highSchoolPool.players = data.highSchool.players || [];
    highSchoolPool.year = data.highSchool.year || 0;
    highSchoolPool.players.forEach(restoreStats);
  }
}
