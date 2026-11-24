// ============================================================
// 選手を作る部品 - playerFactory.js
// 新しい選手1人の能力・球種・守れる位置・特性を作る。
//
// ⚠ もとは tryoutSystem.js（トライアウト）に住んでいて、大学・高校の世代を作る
//    universityPool.js、年度更新、オンラインの初期セット（rosterPack.js）が
//    「トライアウト」から部品を借りていた。universityPool.js と tryoutSystem.js が
//    互いに読み合う輪になっていたので、作る部品だけをここへ分けた（2026-11-24）。
//    ここはトライアウトもプールも読まない。
// ⚠ 乱数は Math.random。引く順番を変えると固定の種の結果が変わる
//    （replay-hash-check で確かめる）。
// ============================================================

import { generateRandomPlayerName } from '../data/playerNames.js';
import { generateCatcherLead, createEmptyStats } from '../utils/constants.js';
import { generateBats } from '../utils/handedness.js';
import { fillPlayerOrigin } from './playerOrigin.js';
import { withSeededRandom, hashSeed } from '../game/rng.js';
import { generateScoutComment } from '../game/scoutComment.js';

/**
 * 特性の数を決定（確率分布）
 * 1つ: 75%, 2つ: 20%, 3つ: 4%, 4つ: 1%
 */
function getTraitCount() {
  const rand = Math.random() * 100;
  if (rand < 75) return 1;
  if (rand < 95) return 2;
  if (rand < 99) return 3;
  return 4;
}

/**
 * 野手用特性リスト
 */
const BATTER_TRAITS = [
  'speedster',      // 俊足タイプ
  'slugger',        // パワータイプ
  'defender',       // 守備タイプ
  'contactHitter',  // 巧打タイプ
  'eyeMaster',      // 選球眼タイプ
  'baserunner',     // 走塁タイプ
  'armStrong',      // 強肩タイプ
  'speedContact',   // 俊足巧打タイプ（走力+ミート）
  'powerArm',       // 強打強肩タイプ（パワー+肩力）
];

/**
 * 投手用特性リスト
 */
const PITCHER_TRAITS = [
  'fireballer',       // 速球タイプ
  'controlPitcher',   // 制球タイプ
  'ironman',          // スタミナタイプ
  'breakingBall',     // 変化球タイプ
  'sinkerballer',     // ゴロ量産タイプ（制球+スタミナ重視）
  'strikeoutArtist',  // 奪三振タイプ（球速高/制球不安定）
];

/**
 * 複数特性を選出（重複なし）
 * @param {boolean} isPitcher - 投手かどうか
 * @returns {string[]} 選ばれた特性の配列
 */
function getPlayerTraits(isPitcher) {
  const count = getTraitCount();
  const pool = isPitcher ? [...PITCHER_TRAITS] : [...BATTER_TRAITS];
  const traits = [];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const idx = Math.floor(Math.random() * pool.length);
    traits.push(pool.splice(idx, 1)[0]);
  }
  return traits;
}

/**
 * 生成候補（初回トライアウト）だけに使う、リーグの格の**平行移動**。
 * 上限でも倍率でもないので、能力の差＝選手の形は保たれる。
 */
const RANK_LEVEL_SHIFT = { S: 6, A: 0, B: -8, C: -16, D: -24 };
function applyLeagueLevelShift(player, rank, override) {
  if (!player) return;
  if (!rank && override === undefined) return;
  // ⚠ `override` は段差を直に渡す口。オンラインの初期セットは選手ごとに
  //    A/B/C の段差を付けるので、リーグの格の表とは別の値が要る
  const d = override !== undefined ? override : (RANK_LEVEL_SHIFT[rank] ?? -10);
  if (d === 0) return;
  const shift = (obj, key, amount, lo = 1, hi = 99) => {
    if (!obj || typeof obj[key] !== 'number') return;
    obj[key] = Math.max(lo, Math.min(hi, Math.round(obj[key] + amount)));
  };
  // ⚠ 打撃は投球より緩く下げること。一律 d だとパワーの平均が D で1桁台まで落ち、
  //    Dリーグの長打率−打率が .012・本塁打 0.06/チーム試合（4本/75試合）、得点は
  //    四球(16%)と失策だけで作られていた。現実の格下リーグはむしろ打ち合いになる
  //    （投手・守備の質の落ち方の方が大きい）。パワーは半分・ミート/選球眼は3/4
  shift(player.batting, 'meet', d * 0.6); shift(player.batting, 'power', d * 0.25);
  shift(player.batting, 'eye', d * 0.75);  shift(player.batting, 'steal', d * 0.6);
  shift(player.fielding, 'defense', d);
  shift(player.physical, 'speed', d * 0.6); shift(player.physical, 'arm', d * 0.6);
  shift(player.pitching, 'control', d * 0.75);
  // 球速は km スケールなので効きを弱める（D で約 -11km）
  shift(player.pitching, 'velocity', d * 0.45, 105, 168);
}

// 左投げがまず就かないポジション。ここを右投げに寄せるぶん、
// 一塁・外野の左投げ率が上がって全体は handedness.js の目標（左25%）に収まる。
// 割合は従来の左投げの内訳（投40/一15/左15/中15/右14/捕1）と同じ像になるよう合わせてある。
const RIGHT_ONLY_POSITIONS = new Set(['catcher', 'second', 'third', 'short']);
const LEFT_THROW_RATE = { pitcher: 0.25, first: 0.47, left: 0.47, center: 0.47, right: 0.47 };
const throwsForPosition = (pos) => {
  if (RIGHT_ONLY_POSITIONS.has(pos)) return Math.random() < 0.01 ? 'left' : 'right';
  return Math.random() < (LEFT_THROW_RATE[pos] ?? 0.25) ? 'left' : 'right';
};

/**
 * 候補選手を1人作る。
 *
 * ⚠ **生成はここ1か所**。守備位置・年齢の上限・二刀流・格を引数で受け取り、
 *    初回トライアウトの補充（tryoutSystem.js の `generateRandomFillCandidates`）と
 *    オンラインの初期セット（`src/online/rosterPack.js`）の両方から呼ぶ。
 *    別に書くと、同じ「選手」が2通りの作られ方をして食い違う。
 * ⚠ 乱数は `Math.random` を使う。呼ぶ側がシードを差し替えて再現する。
 */
export function createCandidatePlayer(options) {
  // ポジションを先に配ってから、そのポジションに合う利き手を引く。
  // （利き手から決めると捕手・二遊三が左投げに食われて枠が埋まらない）
  // ⚠ 守備位置は呼ぶ側が決める。ここで引き直すと、初期セットの
  //    「投手11・捕手2・内野5・外野4」のような構成が崩れる
  const position = options.position;
  const isPitcher = position === 'pitcher';
  const throws = throwsForPosition(position);
  const bats = generateBats(throws);

  // ⚠ 二刀流も呼ぶ側が決められる（初期セットは本職ごとに1人ずつ決め打ち）
  const isTwoWay = options.isTwoWay ?? Math.random() < 0.08;
  const leftHandFieldPositions = ['first', 'left', 'center', 'right'];
  const allFieldPositions = ['catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];
  // 二刀流の投手だけサブ守備位置を持つ（野手側は枠を崩さないよう本職のまま）
  const twoWaySubPosition = (isTwoWay && isPitcher)
    ? (throws === 'left'
        ? leftHandFieldPositions[Math.floor(Math.random() * leftHandFieldPositions.length)]
        : allFieldPositions[Math.floor(Math.random() * allFieldPositions.length)])
    : null;

  const hasTraits = !isTwoWay && Math.random() < 0.65;
  const playerTraits = hasTraits ? getPlayerTraits(isPitcher) : [];
  const isSpecialist = playerTraits.length > 0;
  const specialistType = playerTraits[0] || null;

  const formRand = Math.random() * 100;
  let pitchingForm;
  if (formRand < 45) pitchingForm = 'overhand';
  else if (formRand < 85) pitchingForm = 'threeQuarter';
  else if (formRand < 95) pitchingForm = 'sidearm';
  else pitchingForm = 'submarine';

  const name = generateRandomPlayerName();
  // トライアウトの候補は19〜25歳。
  // ⚠ **年齢の配り方は呼ぶ側が差し替えられる**（`options.ageWeights`）。
  //    初期セットは19〜32歳の幅を使う（`rosterPack.js` の `PACK_AGE_WEIGHTS`）。
  //    衰える年齢の選手が1人も居ないと、リーグ全体が毎年伸びるだけになる
  const ageWeights = options.ageWeights || [
    { age: 19, weight: 20 },
    { age: 20, weight: 10 },
    { age: 21, weight: 10 },
    { age: 22, weight: 30 },
    { age: 23, weight: 15 },
    { age: 24, weight: 10 },
    { age: 25, weight: 5 },
  ];
  // ⚠ 年齢の上限も呼ぶ側が絞れる
  const allowed = ageWeights.filter((w) => w.age <= (options.maxAge ?? 25));
  const totalWeight = allowed.reduce((sum, w) => sum + w.weight, 0);
  const roll = Math.random() * totalWeight;
  let cumulative = 0;
  let age = allowed[0].age;
  for (const entry of allowed) {
    cumulative += entry.weight;
    if (roll < cumulative) { age = entry.age; break; }
  }

  const abilities = generateAbilities(isPitcher, position, isSpecialist, specialistType, pitchingForm, age, isTwoWay, playerTraits);

  const player = {
    id: options.id,
    name: name,
    age: age,
    position: position,
    battingOrder: 0,
    isStarter: false,
    isTwoWay: isTwoWay,
    twoWaySubPosition: twoWaySubPosition,
    primaryRole: isTwoWay && position === 'pitcher' ? 'pitcher' : null,
    batting: {
      meet: abilities.meet,
      power: abilities.power,
      eye: abilities.eye,
      bats: bats,
      steal: abilities.steal,
      bunt: abilities.bunt || 30
    },
    physical: {
      speed: abilities.speed,
      arm: abilities.arm,
      throws: throws,
      bodyStamina: abilities.bodyStamina || 50,
      recovery: abilities.recovery || 50,
      muscle: abilities.muscle || 50,
      dexterity: abilities.dexterity || 50
    },
    fielding: {
      defense: abilities.defense
    },
    catching: {
      lead: position === 'catcher' ? generateCatcherLead(age) : Math.floor(Math.random() * 26) + 20
    },
    pitching: {
      velocity: abilities.velocity,
      control: abilities.control,
      stamina: abilities.stamina,
      spinRate: abilities.spinRate || 50,
      form: pitchingForm,
      arsenal: (isPitcher || isTwoWay)
        ? generateRandomArsenal(
            playerTraits.includes('breakingBall') ? 2 : 0,
            playerTraits.includes('fireballer') || playerTraits.includes('strikeoutArtist')
          )
        : generateFielderArsenal()
    },
    traits: playerTraits,
    scoutComment: null,
    isNewcomer: true, // 新卒（FAではない新規候補）
    growthPotential: (() => {
      const u1 = Math.random() || 0.001;
      const u2 = Math.random();
      const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const skewed = normal > 0 ? normal * 0.75 : normal;
      let base = 0.95 + skewed * 0.2;
      if (age <= 19) base += 0.08;
      return Math.max(0.5, Math.min(1.5, base));
    })(),
    positionFitness: isTwoWay ? generateTwoWayPositionFitness(position, twoWaySubPosition, throws) : generatePositionFitness(position),
    professionalCareer: {
      isDrafted: false,
      draftYear: null,
      draftTeam: null,
      achievements: []
    },
    personality: {
      discipline: Math.max(1, Math.min(100, Math.round(50 + (Math.sqrt(-2 * Math.log(Math.random() || 0.001)) * Math.cos(2 * Math.PI * Math.random())) * 18))),
      mental: Math.max(1, Math.min(100, Math.round(50 + (Math.sqrt(-2 * Math.log(Math.random() || 0.001)) * Math.cos(2 * Math.PI * Math.random())) * 18))),
    },
    fame: 0,
    fatigue: 0,
    experience: 0,
    careerHistory: [{ type: 'highschool', label: '高校卒' }],
    seasonStats: createEmptyStats(),
    careerStats: createEmptyStats()
  };

  // 初回トライアウトの候補は生成物なので、帯から引くことができない。
  // リーグの格は**平行移動**で表す（上限や倍率ではない）。
  // ⚠ 倍率だと 走力100 の快足が D リーグで 58 に潰れる。差が保たれる加算なら
  //    格下リーグでも「1つだけ図抜けた選手」がそのまま図抜けたまま来る。
  // ⚠ 格は**平行移動**。上限や倍率ではないので、能力の差＝選手の形が保たれる
  applyLeagueLevelShift(player, options.rank, options.levelShift);
  // ⚠ 引いた帯を選手に残す。初期セットの「A2名・B10名・C12名」はこれで数える
  if (options.rank) player.rank = options.rank;
  // 出身（高校・大学）。⚠ いしだ 2026-11-20「初期メンバーにも、高校や大学のラベル付けを
  //    してほしいです」。生成した選手は出身が空で、選手情報の「出身高校」も経歴も出ず、
  //    同窓・地元の縁（`src/online/hometown.js`）にも一度も引っかからなかった。
  //    ⚠ 在学中の印（`universityTeamId` / `universityYear`）は付けない（`playerOrigin.js` の注）
  //    ⚠ 出身は**別の種**で引く（選手の id と名前から）。外の乱数を1つでも引くと後ろの選手が
  //    全部入れ替わり、種と版から作り直す初期セット（`rosterPack.js`「古い作り方は変えない」）で
  //    選んだ後に待っている人の24人が別人になる（2026-11-20 監査）
  //    ⚠ 大学名を付けるのは**オンライン**（`rosterPack.js`）だけ。一人用の補充
  //    （`generateRandomFillCandidates`）は `withUniversity: false` で高校だけ付ける。
  //    一人用はこの候補から社会人・独立の初期名簿も作り（`corporateInit` の
  //    `generateCorporateRoster`）、大学歴は後で `assignInitialUniversityBackgrounds` が
  //    大卒率55%で付け直す。ここでも付けると大卒が5割→6.5割に増えてドラフトの
  //    「大卒は24歳から」（`amateurRoute`）の対象が広がり、付け直した大学と経歴の大学が
  //    食い違っていた（判断3。2026-11-20 監査）
  withSeededRandom(hashSeed(`origin:${player.id}:${player.name}`), () =>
    fillPlayerOrigin(player, { university: options.withUniversity !== false }),
  );

  player.scoutComment = generateScoutComment(player);
  return player;
}

/**
 * 能力値を生成（複数特性対応、フォーム別球速調整、年齢補正、二刀流対応）
 * 特性が複数ある場合、各特性のボーナスを累積適用
 * 年齢補正: 18歳基準で、1歳につき平均+1ポイント
 */
function generateAbilities(isPitcher, position, isSpecialist, specialistType, pitchingForm, age = 20, isTwoWay = false, playerTraits = []) {
  // フォームによる球速・制球の調整
  // サイドスロー・アンダースローは球速-10、制球+15
  const isSideOrUnder = pitchingForm === 'sidearm' || pitchingForm === 'submarine';
  const velocityAdjust = isSideOrUnder ? -10 : 0;
  const controlAdjust = isSideOrUnder ? 15 : 0;

  // 年齢補正: 18歳を基準に、年齢が上がるほど即戦力（大卒・社会人の実力差を反映）
  // 線形+小さな二次項（18歳=0, 22歳=6, 25歳=10でキャップ）
  const ageBonus = Math.min(10, Math.max(0, Math.round((age - 18) * 1.2 + (age - 18) * (age - 18) * 0.08)));
  const battingAgeBonus = Math.floor(ageBonus * 0.5);
  const velocityAgeBonus = Math.floor(ageBonus * 0.2);

  // バラつき付きランダム生成（能力値用、10-99制限）
  const randRangeWithVariance = (min, max, bonus = ageBonus) => {
    const variance = Math.floor(Math.random() * 21) - 10; // -10 ~ +10 のランダム変動
    const adjustedMin = Math.max(10, Math.min(min + bonus, max));
    const base = Math.floor(Math.random() * (max - adjustedMin + 1)) + adjustedMin;
    return Math.max(1, Math.min(99, base + variance));
  };

  // 球速用ランダム生成（120-160km/h範囲、正規分布風のバラつき）
  const randVelocity = (min, max, bonus = 0) => {
    // 2つの乱数の平均で中央に寄りやすく（でも例外的な高速投手も出る）
    const r1 = Math.random();
    const r2 = Math.random();
    const normalRand = (r1 + r2) / 2; // 0-1の範囲で中央寄り
    // 5%の確率で例外的な才能（より高い値）
    const exceptional = Math.random() < 0.05 ? Math.floor(Math.random() * 4) + 2 : 0;
    const base = Math.floor(normalRand * (max - min + 1)) + min + bonus + exceptional;
    // バラつきを追加
    const variance = Math.floor(Math.random() * 7) - 3; // -3 ~ +3
    return Math.max(min, Math.min(160, base + variance));
  };

  // スタミナ用ランダム生成（40-150範囲、2/3に調整済み）
  const randStamina = (min, max, bonus = 0) => {
    const base = Math.floor(Math.random() * (max - min + 1)) + min + bonus;
    const variance = Math.floor(Math.random() * 15) - 7; // -7 ~ +7
    return Math.max(40, Math.min(150, base + variance));
  };

  // 肩力から球速を導出（全選手共通）
  // 低肩力は線形、高肩力帯は伸びが鈍化するカーブ
  // arm 30→112, 50→124, 60→131, 70→137, 80→143, 85→146, 90→149, 95→151
  const velocityFromArm = (arm) => {
    const normalized = arm / 100;
    const base = Math.round(95 + normalized * 45 + Math.pow(normalized, 2.5) * 15);
    const variance = Math.floor(Math.random() * 5) - 2; // -2 ~ +2
    return Math.max(100, Math.min(158, base + variance));
  };

  // 全生成選手の平均能力を-3する調整関数
  const applyGlobalOffset = (abilities) => {
    const offset = -3;
    const result = {};
    for (const [key, value] of Object.entries(abilities)) {
      if (key === 'velocity') {
        result[key] = Math.max(100, value + offset);
      } else if (key === 'stamina') {
        result[key] = Math.max(30, value + offset);
      } else {
        result[key] = Math.max(1, Math.min(99, value + offset));
      }
    }
    return result;
  };

  // 二刀流選手の場合は投打両方に能力を持つ
  if (isTwoWay) {
    if (isPitcher) {
      // 投手登録の二刀流: 肩が強く投手能力寄り、打撃は原石レベル
      const twoWayArm = randRangeWithVariance(60, 80, ageBonus);
      return applyGlobalOffset({
        meet: randRangeWithVariance(33, 55, battingAgeBonus),
        power: randRangeWithVariance(30, 55, battingAgeBonus),
        eye: randRangeWithVariance(30, 55, battingAgeBonus),
        steal: randRangeWithVariance(30, 55),
        bunt: randRangeWithVariance(30, 55),
        speed: randRangeWithVariance(45, 75),
        arm: twoWayArm,
        defense: randRangeWithVariance(45, 70),
        bodyStamina: randRangeWithVariance(45, 75),
        recovery: randRangeWithVariance(45, 75),
        muscle: randRangeWithVariance(45, 70),
        dexterity: randRangeWithVariance(40, 65),
        velocity: velocityFromArm(twoWayArm),
        control: Math.min(randRangeWithVariance(40, 68) + controlAdjust, 85),
        stamina: randStamina(85, 120),
        spinRate: randRangeWithVariance(30, 60)
      });
    } else {
      // 野手登録の二刀流: 野手能力メイン、肩が強めで投手もそこそこ
      const twoWayArm = randRangeWithVariance(55, 73, ageBonus);
      return applyGlobalOffset({
        meet: randRangeWithVariance(40, 65, battingAgeBonus),
        power: randRangeWithVariance(32, 57, battingAgeBonus),
        eye: randRangeWithVariance(35, 65, battingAgeBonus),
        steal: randRangeWithVariance(30, 60),
        bunt: randRangeWithVariance(30, 55),
        speed: randRangeWithVariance(43, 73),
        arm: twoWayArm,
        defense: randRangeWithVariance(40, 65),
        bodyStamina: randRangeWithVariance(40, 70),
        recovery: randRangeWithVariance(40, 70),
        muscle: randRangeWithVariance(45, 70),
        dexterity: randRangeWithVariance(40, 65),
        velocity: velocityFromArm(twoWayArm),
        control: Math.min(randRangeWithVariance(40, 65) + controlAdjust, 80),
        stamina: randStamina(72, 108),
        spinRate: randRangeWithVariance(30, 60)
      });
    }
  }

  // 通常の能力値範囲（投手用 or 野手アーキタイプ別）
  let normalAbilities;
  if (isPitcher) {
    // 投手は肩力ベースで球速が決まる（肩力40-90で幅広い投手像）
    const pitcherArm = randRangeWithVariance(40, 90, ageBonus);
    normalAbilities = {
      meet: randRangeWithVariance(10, 35, battingAgeBonus),
      power: randRangeWithVariance(3, 25, battingAgeBonus),
      eye: randRangeWithVariance(20, 45, battingAgeBonus),
      steal: randRangeWithVariance(5, 25, Math.max(0, Math.floor(ageBonus * 0.5))),
      bunt: randRangeWithVariance(15, 45),
      speed: randRangeWithVariance(25, 60, Math.max(0, Math.floor(ageBonus * 0.5))),
      arm: pitcherArm,
      defense: randRangeWithVariance(30, 65),
      bodyStamina: randRangeWithVariance(35, 70),
      recovery: randRangeWithVariance(35, 70),
      muscle: randRangeWithVariance(30, 70),
      dexterity: randRangeWithVariance(30, 65),
      velocity: velocityFromArm(pitcherArm),
      control: Math.min(randRangeWithVariance(20, 70) + controlAdjust, 85),
      stamina: randStamina(60, 140, ageBonus),
      spinRate: randRangeWithVariance(25, 75)
    };
  } else {
    // 野手アーキタイプ: 特性なしの選手にも個性を持たせる
    // 【設計思想】原石段階。長所は光るが伸びしろを残す
    const archetypes = [
      // 巧打タイプ: ミート高、パワー低
      { meet: [50, 80], power: [10, 35], eye: [45, 75], steal: [25, 55], bunt: [45, 70], speed: [30, 60], arm: [20, 55], defense: [30, 60] },
      // 強打タイプ: パワー高、走力低
      { meet: [25, 55], power: [45, 75], eye: [25, 50], steal: [10, 35], bunt: [5, 25], speed: [20, 48], arm: [35, 65], defense: [20, 50] },
      // 俊足タイプ: 走力高、パワー低
      { meet: [30, 58], power: [10, 35], eye: [30, 55], steal: [55, 85], bunt: [50, 75], speed: [60, 88], arm: [25, 55], defense: [35, 65] },
      // 守備タイプ: 守備高、打撃低
      { meet: [20, 48], power: [10, 35], eye: [30, 55], steal: [25, 55], bunt: [30, 55], speed: [40, 70], arm: [50, 80], defense: [55, 85] },
      // バランスタイプ: 平均的
      { meet: [30, 60], power: [20, 50], eye: [28, 58], steal: [25, 55], bunt: [25, 55], speed: [30, 60], arm: [28, 58], defense: [28, 58] },
      // 打撃特化タイプ: 打撃全般高、守備走力低
      { meet: [48, 78], power: [38, 68], eye: [40, 68], steal: [10, 35], bunt: [15, 35], speed: [20, 48], arm: [25, 50], defense: [18, 45] },
      // 肩力タイプ: 肩力高、ミート低
      { meet: [20, 50], power: [25, 50], eye: [25, 50], steal: [20, 50], bunt: [20, 45], speed: [30, 60], arm: [58, 88], defense: [40, 70] },
    ];
    const archIndex = Math.floor(Math.random() * archetypes.length);
    const arch = archetypes[archIndex];
    const fielderArm = randRangeWithVariance(arch.arm[0], arch.arm[1]);
    // アーキタイプ別のmuscle/dexterity範囲
    // 0:巧打→dex高, 1:強打→muscle高, 2:俊足→muscle中, 3:守備→dex高, 4:バランス→両方中, 5:打撃特化→dex高, 6:肩力→muscle中
    const archMuscle = [
      [30, 55], // 巧打
      [55, 80], // 強打
      [40, 65], // 俊足
      [35, 55], // 守備
      [35, 60], // バランス
      [45, 70], // 打撃特化
      [40, 65], // 肩力
    ][archIndex];
    const archDexterity = [
      [50, 75], // 巧打
      [25, 50], // 強打
      [35, 60], // 俊足
      [55, 80], // 守備
      [35, 60], // バランス
      [50, 75], // 打撃特化
      [30, 55], // 肩力
    ][archIndex];
    normalAbilities = {
      meet: randRangeWithVariance(arch.meet[0], arch.meet[1], battingAgeBonus),
      power: randRangeWithVariance(arch.power[0], arch.power[1], battingAgeBonus),
      eye: randRangeWithVariance(arch.eye[0], arch.eye[1], battingAgeBonus),
      steal: randRangeWithVariance(arch.steal[0], arch.steal[1], Math.max(0, Math.floor(ageBonus * 0.7))),
      bunt: randRangeWithVariance(arch.bunt[0], arch.bunt[1], Math.max(0, Math.floor(battingAgeBonus * 0.5))),
      speed: randRangeWithVariance(arch.speed[0], arch.speed[1], Math.max(0, Math.floor(ageBonus * 0.7))),
      arm: fielderArm,
      defense: randRangeWithVariance(arch.defense[0], arch.defense[1]),
      bodyStamina: randRangeWithVariance(40, 75),
      recovery: randRangeWithVariance(40, 75),
      muscle: randRangeWithVariance(archMuscle[0], archMuscle[1]),
      dexterity: randRangeWithVariance(archDexterity[0], archDexterity[1]),
      velocity: velocityFromArm(fielderArm),
      control: randRange(30, 55),
      stamina: randRange(40, 67),
      spinRate: randRangeWithVariance(20, 45)
    };
  }

  if (!isSpecialist || playerTraits.length === 0) {
    return applyGlobalOffset(normalAbilities);
  }

  // 複数特性の能力調整（各特性のボーナスを累積適用）
  let abilities = { ...normalAbilities };

  // 特性ごとのボーナス定義
  // 【設計思想】独立リーグ入り時点では原石。長所は"光る"程度で、
  // キャンプ練習や経験で磨くことで戦力になる。最初からプロレベルは作らない。
  // - 長所（シグネチャ能力）: 55〜75程度 (C〜B ランク)
  // - 副長所: 40〜60
  // - 弱点: 10〜35 (伸びしろとして残す)
  const traitBonuses = {
    // --- 野手特性（原石、磨けば光る素材） ---
    speedster: {
      // 足は光るが打撃・守備は未熟 → 外野・代走から育成
      speed: () => randRange(73, 88),
      steal: () => randRange(68, 85),
      bunt: () => randRange(55, 75),
      meet: () => randRange(30, 47),
      power: () => randRange(17, 33),
      defense: () => randRange(43, 63),
      muscle: () => randRange(55, 75),
      dexterity: () => randRange(30, 50)
    },
    slugger: {
      // パワーが魅力だが粗削り → ミート・選球眼を磨く余地
      power: () => randRange(63, 78),
      meet: () => randRange(33, 50),
      eye: () => randRange(30, 50),
      speed: () => randRange(23, 40),
      steal: () => randRange(13, 27),
      defense: () => randRange(27, 47),
      arm: () => randRange(37, 57),
      muscle: () => randRange(65, 85),
      dexterity: () => randRange(25, 45)
    },
    defender: {
      // 守備センスは光るが打撃は弱い → 守備固めから育成
      defense: () => randRange(73, 88),
      arm: () => randRange(67, 83),
      meet: () => randRange(30, 47),
      power: () => randRange(20, 37),
      speed: () => randRange(43, 63),
      muscle: () => randRange(35, 55),
      dexterity: () => randRange(60, 80)
    },
    contactHitter: {
      // 当てる感覚はあるが一発は期待薄 → 長打力を磨く余地
      meet: () => randRange(65, 80),
      eye: () => randRange(58, 75),
      bunt: () => randRange(50, 70),
      power: () => randRange(23, 40),
      speed: () => randRange(43, 60),
      dexterity: () => randRange(60, 80),
      muscle: () => randRange(30, 50)
    },
    eyeMaster: {
      // 選球眼が光る → 四球選べるがミート/パワーに伸びしろ
      eye: () => randRange(68, 83),
      meet: () => randRange(40, 57),
      power: () => randRange(23, 40),
      steal: () => randRange(30, 50),
      dexterity: () => randRange(55, 75)
    },
    baserunner: {
      // 走塁勘が抜群 → バッティングに成長余地
      speed: () => randRange(68, 83),
      steal: () => randRange(71, 86),
      meet: () => randRange(33, 50),
      power: () => randRange(20, 37),
      defense: () => randRange(43, 63)
    },
    armStrong: {
      // 肩は魅力的だが打撃・守備は粗い
      arm: () => randRange(71, 86),
      defense: () => randRange(47, 65),
      power: () => randRange(33, 53),
      meet: () => randRange(27, 47)
    },
    speedContact: {
      // 俊足+巧打の素材型（両方ほどほどに光る）
      meet: () => randRange(61, 75),
      eye: () => randRange(45, 63),
      speed: () => randRange(65, 80),
      steal: () => randRange(61, 78),
      power: () => randRange(17, 33),
      defense: () => randRange(43, 63)
    },
    powerArm: {
      // 強打+強肩の素材型
      power: () => randRange(58, 73),
      arm: () => randRange(68, 83),
      defense: () => randRange(45, 63),
      meet: () => randRange(33, 50),
      speed: () => randRange(25, 43),
      steal: () => randRange(13, 27)
    },
    // --- 投手特性（原石、磨けば光る素材） ---
    // 肩力を指定 → 球速は後で肩力から自動導出
    fireballer: {
      // 剛腕が魅力。制球や変化球を磨けば戦力に
      arm: () => randRange(80, 92),
      control: () => Math.min(randRange(28, 45) + controlAdjust, 58),
      stamina: () => randStamina(58, 88),
      muscle: () => randRange(65, 85),
      spinRate: () => randRange(55, 80)
    },
    controlPitcher: {
      // 制球派の素材。肩はそこそこだが制球が光る
      arm: () => randRange(58, 72),
      control: () => Math.min(randRange(58, 73) + controlAdjust, 80),
      stamina: () => randStamina(77, 108),
      dexterity: () => randRange(60, 80)
    },
    ironman: {
      // タフネス型。技術は粗いが練習で伸びる
      arm: () => randRange(60, 73),
      control: () => Math.min(randRange(35, 52) + controlAdjust, 65),
      stamina: () => randStamina(100, 135),
      muscle: () => randRange(55, 75)
    },
    breakingBall: {
      // 変化球派（arsenalで+2球種、早熟型）
      arm: () => randRange(55, 70),
      control: () => Math.min(randRange(48, 63) + controlAdjust, 72),
      stamina: () => randStamina(75, 103)
    },
    sinkerballer: {
      // ゴロ量産候補。制球とスタミナが売り
      arm: () => randRange(58, 72),
      control: () => Math.min(randRange(52, 68) + controlAdjust, 75),
      stamina: () => randStamina(87, 118)
    },
    strikeoutArtist: {
      // 空振り奪取型。肩が強く粗削り
      arm: () => randRange(75, 88),
      control: () => Math.min(randRange(30, 48) + controlAdjust, 60),
      stamina: () => randStamina(58, 86),
      spinRate: () => randRange(60, 85)
    }
  };

  // 各特性を順に適用
  // 単一特性: 常に上書き → 得意/不得意が明確な個性的な選手に
  // 複数特性: 良い方を採用 → 複合的な長所を持つ選手に
  const isSingleTrait = playerTraits.length === 1;
  let armChanged = false;
  playerTraits.forEach(trait => {
    const bonuses = traitBonuses[trait];
    if (!bonuses) return;
    Object.entries(bonuses).forEach(([stat, generator]) => {
      const traitValue = generator();
      if (isSingleTrait || traitValue > abilities[stat]) {
        abilities[stat] = traitValue;
        if (stat === 'arm') armChanged = true;
      }
    });
  });

  // 肩力が変わった場合、球速を肩力から再導出（統一ルール）
  if (armChanged) {
    abilities.velocity = velocityFromArm(abilities.arm);
  }

  return applyGlobalOffset(abilities);
}

/**
 * 範囲内のランダム整数を生成
 */
function randRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 野手用の簡易変化球を生成（投手適正なし）
 * 基本的な変化球からランダムに1つ、レベルはF〜Eランク
 */
function generateFielderArsenal() {
  const basicPitches = ['slider', 'curve', 'fork', 'changeup', 'sinker', 'cutter'];
  const selectedType = basicPitches[Math.floor(Math.random() * basicPitches.length)];
  const level = Math.floor(Math.random() * 21) + 20; // 20-40 (F〜Eランク)
  return [
    { id: 1, type: 'straight', level: 100 },
    { id: 2, type: selectedType, level }
  ];
}

/**
 * ランダムな変化球を生成
 * @param {number} extraPitches - 追加球種数（breakingBall特性用）
 * @param {boolean} weak - 球威型（fireballer/strikeoutArtist）フラグ。変化球が少なく未熟（成長課題を演出）
 */
export const generateRandomArsenal = (extraPitches = 0, weak = false) => {
  const pitchTypes = ['straight', 'twoSeam', 'slider', 'curve', 'fork', 'changeup',
                      'sinker', 'shoot', 'cutter', 'splitter', 'palm', 'knuckle'];
  // weak: 球威型はストレート+変化球1種のみ（チェンジアップ等を覚えれば化ける演出）
  // 独立リーグ入りの投手は高校でもプレーしてきた選手なので、最低でも1球種は持つ
  const baseSize = weak ? 2 : (Math.floor(Math.random() * 3) + 2); // weak=ストレート+1種, 通常=2-4種
  const arsenalSize = Math.min(baseSize + extraPitches, 7);
  const arsenal = [];
  const usedTypes = new Set();

  // ストレートは必ず含める
  arsenal.push({ id: 1, type: 'straight', level: 100 });
  usedTypes.add('straight');

  for (let i = 2; i <= arsenalSize; i++) {
    const availableTypes = pitchTypes.filter(t => !usedTypes.has(t));
    if (availableTypes.length === 0) break;

    const selectedType = availableTypes[Math.floor(Math.random() * availableTypes.length)];
    let levelMin, levelMax;
    if (weak) {
      // 球威型: 変化球は未熟（レベルF〜E帯）→ 習得・練習の伸びしろ演出
      levelMin = 15;
      levelMax = 40;
    } else {
      // 通常: 独立リーグレベル（S/Aランクは稀に）
      levelMin = (i > baseSize) ? 40 : 25;
      levelMax = (i > baseSize) ? 80 : 70;
    }
    let level = Math.floor(Math.random() * (levelMax - levelMin + 1)) + levelMin;
    // weakでない場合のみスライダー・スプリッター底上げ
    if (!weak && (selectedType === 'slider' || selectedType === 'splitter')) {
      level = Math.max(level, 40);
      level = Math.min(level + 10, 90);
    }
    arsenal.push({ id: i, type: selectedType, level });
    usedTypes.add(selectedType);
  }

  return arsenal;
}

/**
 * ポジション適性を生成
 */
export const generatePositionFitness = (mainPosition) => {
  const fitness = {
    pitcher: 30, catcher: 30, first: 30,
    second: 30, third: 30, short: 30,
    left: 30, center: 30, right: 30
  };

  // メインポジションは100
  fitness[mainPosition] = 100;

  // 隣接ポジションに適性を付与（primary=関連性高い, secondary=やや関連）
  const positionGroups = {
    pitcher: { primary: [], secondary: [] },
    catcher: { primary: ['first'], secondary: [] },
    first: { primary: ['third'], secondary: ['catcher'] },
    second: { primary: ['short'], secondary: ['third'] },
    third: { primary: ['first', 'short'], secondary: ['second'] },
    short: { primary: ['second', 'third'], secondary: [] },
    left: { primary: ['center', 'right'], secondary: [] },
    center: { primary: ['left', 'right'], secondary: [] },
    right: { primary: ['left', 'center'], secondary: [] }
  };

  const group = positionGroups[mainPosition];
  if (group) {
    group.primary.forEach(adj => {
      fitness[adj] = Math.floor(Math.random() * 25) + 65; // 65-90
    });
    group.secondary.forEach(adj => {
      fitness[adj] = Math.floor(Math.random() * 25) + 50; // 50-75
    });
  }

  // ユーティリティ型（約12%）: 複数ポジションを守れる器用な選手を出す。
  // 内野型は内野中心（+一部外野）、外野型は外野中心（+一部内野）に広げる。
  if (mainPosition !== 'pitcher' && Math.random() < 0.12) {
    const infield = ['catcher', 'first', 'second', 'third', 'short'];
    const outfield = ['left', 'center', 'right'];
    const isOF = outfield.includes(mainPosition);
    let pool = isOF
      ? [...outfield, ...(Math.random() < 0.4 ? ['second', 'third', 'first'] : [])]
      : [...infield, ...(Math.random() < 0.4 ? outfield : [])];
    pool = pool.filter(p => p !== mainPosition).sort(() => Math.random() - 0.5);
    const extra = randRange(2, 4);
    for (let i = 0; i < Math.min(extra, pool.length); i++) {
      const pos = pool[i];
      fitness[pos] = Math.max(fitness[pos] || 0, Math.floor(Math.random() * 20) + 68); // 68-88
    }
  }

  return fitness;
}

/**
 * 二刀流選手のポジション適性を生成
 * @param {string} mainPosition - 登録ポジション
 * @param {string|null} subPosition - 投手登録二刀流の野手サブポジション
 * @param {string} throws - 利き腕 ('right' or 'left')
 */
export const generateTwoWayPositionFitness = (mainPosition, subPosition, throws) => {
  const fitness = {
    pitcher: 80,
    catcher: 30, first: 30,
    second: 30, third: 30, short: 30,
    left: 30, center: 30, right: 30
  };

  fitness[mainPosition] = 100;

  if (mainPosition === 'pitcher' && subPosition) {
    // 投手登録の二刀流: サブポジションを50-80で設定 + 関連ポジションもブースト
    // 投手は子供の頃からエースで各ポジションをこなしてきた選手が多い
    fitness[subPosition] = Math.floor(Math.random() * 31) + 50; // 50-80
    if (throws === 'left') {
      // 左投げ: ファーストと外野のみ守れる
      const leftPositions = ['first', 'left', 'center', 'right'].filter(p => p !== subPosition);
      for (const pos of leftPositions) {
        fitness[pos] = Math.floor(Math.random() * 15) + 40; // 40-54
      }
    } else {
      // 右投げ: 全ポジション経験あり
      if (['short', 'second', 'third'].includes(subPosition)) {
        const infield = ['short', 'second', 'third'].filter(p => p !== subPosition);
        for (const pos of infield) {
          fitness[pos] = Math.floor(Math.random() * 15) + 45; // 45-59
        }
        fitness.center = Math.floor(Math.random() * 15) + 40;
      } else if (['left', 'center', 'right'].includes(subPosition)) {
        const outfield = ['left', 'center', 'right'].filter(p => p !== subPosition);
        for (const pos of outfield) {
          fitness[pos] = Math.floor(Math.random() * 15) + 45; // 45-59
        }
        fitness.first = Math.floor(Math.random() * 15) + 40;
      } else {
        // catcher/first等: 周辺ポジションを広めにブースト
        fitness.first = Math.max(fitness.first, Math.floor(Math.random() * 15) + 40);
        fitness.third = Math.max(fitness.third, Math.floor(Math.random() * 15) + 40);
        fitness.left = Math.max(fitness.left, Math.floor(Math.random() * 15) + 38);
        fitness.center = Math.max(fitness.center, Math.floor(Math.random() * 15) + 38);
        fitness.right = Math.max(fitness.right, Math.floor(Math.random() * 15) + 38);
      }
    }
  } else {
    // 野手登録の二刀流: 投手適性高め、周辺ポジションも対応可
    fitness.pitcher = Math.floor(Math.random() * 15) + 75; // 75-90
    if (throws === 'left') {
      const leftPositions = ['first', 'left', 'center', 'right'].filter(p => p !== mainPosition);
      for (const pos of leftPositions) {
        fitness[pos] = Math.floor(Math.random() * 20) + 55;
      }
    } else {
      if (mainPosition === 'short') {
        fitness.second = Math.floor(Math.random() * 15) + 65;
        fitness.third = Math.floor(Math.random() * 15) + 55;
        fitness.center = Math.floor(Math.random() * 15) + 50;
      } else if (mainPosition === 'center') {
        fitness.left = Math.floor(Math.random() * 15) + 65;
        fitness.right = Math.floor(Math.random() * 15) + 65;
      } else {
        if (mainPosition !== 'first') fitness.first = Math.floor(Math.random() * 20) + 60;
        if (mainPosition !== 'left') fitness.left = Math.floor(Math.random() * 20) + 55;
        if (mainPosition !== 'center') fitness.center = Math.floor(Math.random() * 20) + 55;
        if (mainPosition !== 'right') fitness.right = Math.floor(Math.random() * 20) + 55;
      }
    }
  }

  return fitness;
}
