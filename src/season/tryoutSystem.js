// ============================================================
// トライアウトシステム - tryoutSystem.js
// 選手獲得システム（年次トライアウト、ドラフト）
// ============================================================

import { generateRandomPlayerName } from '../data/playerNames.js';
import { releasedPlayersPool, TEAMS_DATA } from '../teams-data.js';
import { getHighSchoolTryoutCandidates, getUniversitySeniorTryoutCandidates } from './universityPool.js';
import {
  getUtilityScore,
  generateCatcherLead,
  RANK_ASC,
  ROSTER_TARGETS,
  rosterGroup,
  rosterCounts as countRoster,
} from '../utils/constants.js';
import { generateBats } from '../utils/handedness.js';
import { reservePlayerIds } from '../state/playerIds.js';

// 2年目以降トライアウトの1チームあたり基準受験者数
// 構成比はリーグ注目度(developmentReputation)で変動する（下記 generateTryoutCandidates 参照）:
//   低注目度: 素材型の高校生中心 / 高注目度: 大学卒・元プロ(FA)が集まる
const TRYOUT_TOTAL_PER_TEAM = 10;

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
 * 受験者の実効ランクを決める。約10%は1つ上のランク基準でスケールする。
 * 意図: 同格の中で埋もれるより、少し格下のリーグで試合に出て活躍・目立つほうが賢い、という逸材を再現。
 */
function effectiveTryoutRank(baseRank) {
  if (!baseRank) return baseRank;
  if (Math.random() < 0.10) {
    const i = RANK_ASC.indexOf(baseRank);
    if (i >= 0 && i < RANK_ASC.length - 1) return RANK_ASC[i + 1];
  }
  return baseRank;
}

/**
 * リーグの格は「**どの層の選手が受けに来るか**」だけを決める。
 *
 * ⚠ **能力に上限やスケールを掛けてはいけない**（旧 `applyLeagueRankScaling` を撤廃）。
 *    旧実装はランク別に 球速・制球・ミート・パワー・選球眼へ上限を掛け、
 *    さらに守備・走力を 0.58〜0.98 倍していた。**帯で絞ったうえに能力も削る二重制限**で、
 *      ・走力100の快足が D リーグでは 58 に潰される
 *      ・球速150の投手が C リーグでは 133 で頭打ち
 *    と、**尖った選手ほど削られて一芸型が入って来られなかった**。
 *    現実には格下リーグにも「1つだけ図抜けた選手」は普通に来る。
 *
 * 代わりに、ランクを抽出帯（`qualityBias`）に写す。帯が上がれば良い選手が来るし、
 * 帯の中にどんな形の選手が居るかは母集団のまま——尖った選手はそのまま尖って来る。
 */
const RANK_BAND_BIAS = { S: 0.90, A: 0.70, B: 0.50, C: 0.30, D: 0.12 };
const rankBandBias = (rank) => RANK_BAND_BIAS[rank] ?? 0.30;

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

/**
 * 候補の守備位置は「24人ロスターの需要」に合わせる（投手10 / 捕手2 / 内野6 / 外野6）。
 *
 * ⚠ 8ポジションから一様に引くと捕手が候補全体の **5.0%** しか出ない。
 *    4チーム96指名の初回トライアウトで捕手が8人（1チーム2人）に満たない回が 29/40、
 *    1人も取れないチームが出る回が 5/40 あった。捕手が1人のロスターは
 *    休養・故障で守れる選手が居なくなり、AIオーダー編成が適性30の外野手を捕手に置く。
 * ⚠ 左投げはほぼ捕手・二塁・三塁・遊撃を守らないので、その分の重みは右投げ側が背負う。
 *    左右比率(`handedness.js`)を変えたら測り直すこと。
 */
// 需要の比率そのもの（投手10/24=41.7% 捕手8.3% 内野25% 外野25%）。
// 候補は指名数の1.25倍居るので、どの群も同じ 1.25倍の余裕を持つ。
const TRYOUT_POSITION_QUOTA = [
  ['pitcher', 42], ['catcher', 8],
  ['first', 6], ['second', 6], ['third', 6], ['short', 7],
  ['left', 8], ['center', 9], ['right', 8],
];

/**
 * ⚠ **確率ではなく枚数で配る**。重み付き抽選にすると捕手は n=120・p=0.09 で σ≈3 あり、
 *    60回中9回は8人（1チーム2人）に届かなかった。初回トライアウトは
 *    ゲーム開始時に一度だけ起きるので、裾を引くと「その周回だけ捕手が居ない」league になる。
 */
const buildPositionBag = (count) => {
  const total = TRYOUT_POSITION_QUOTA.reduce((s, [, w]) => s + w, 0);
  const bag = [];
  let acc = 0;
  for (const [pos, w] of TRYOUT_POSITION_QUOTA) {
    acc += (count * w) / total;
    while (bag.length < Math.min(Math.round(acc), count)) bag.push(pos);
  }
  while (bag.length < count) bag.push('pitcher');
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
};

/**
 * 実在プール（高校生・大学4年生）から引いた候補を、上と同じ需要の比率へ均す。
 *
 * ⚠ プールの抽出は `evaluatePlayerPotential` の順に並べた帯から取るので、
 *    **ドラフト評価の偏りがそのまま構成比になる**。投手の評価点は野手より低く出る
 *    既知の偏り（CLAUDE.md「投手が指名されにくい」）があるため、実測で
 *    投手 25.5% / 捕手 8.1%（捕手が0人の回もあり）と、24人ロスターの需要
 *    （投手41.7% / 捕手8.3%）から大きく外れていた。
 *    多めに引いてから群ごとに間引く。帯の中はシャッフル済みなので質の分布は変わらない。
 */
const TRYOUT_GROUP_MIX = { pitcher: 0.40, catcher: 0.09, infield: 0.26, outfield: 0.25 };
const TRYOUT_OVERDRAW = 3;
const positionGroupOf = (p) => p === 'pitcher' ? 'pitcher'
  : p === 'catcher' ? 'catcher'
  : ['first', 'second', 'third', 'short'].includes(p) ? 'infield' : 'outfield';
const balanceByPosition = (pool, size) => {
  if (!Array.isArray(pool) || pool.length <= size) return pool || [];
  const buckets = { pitcher: [], catcher: [], infield: [], outfield: [] };
  pool.forEach(p => buckets[positionGroupOf(p.position)].push(p));
  const picked = [], leftovers = [];
  for (const g of Object.keys(buckets)) {
    const want = Math.round(size * TRYOUT_GROUP_MIX[g]);
    picked.push(...buckets[g].slice(0, want));
    leftovers.push(...buckets[g].slice(want));
  }
  // 群が枯れて枠に届かない分は残りから補い、人数だけは保つ
  for (let i = 0; picked.length < size && i < leftovers.length; i++) picked.push(leftovers[i]);
  // 群の順に並んだままだと、端数を切るときに常に同じ群（外野）が落ちる
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked.slice(0, size);
};

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
 * 不足分補充用のランダム候補生成（2年目以降用）
 * generateTryoutCandidatesと同じロジックだが少数のみ生成
 */
/**
 * 候補選手を1人作る。
 *
 * ⚠ **生成はここ1か所**。守備位置・年齢の上限・二刀流・格を引数で受け取り、
 *    初回トライアウトの補充（`generateRandomFillCandidates`）と
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
    seasonStats: {
      batting: { games: 0, atBats: 0, hits: 0, doubles: 0, triples: 0, homeruns: 0, rbis: 0, walks: 0, strikeouts: 0, stolenBases: 0, sacrificeBunts: 0 },
      pitching: { games: 0, wins: 0, losses: 0, saves: 0, holds: 0, inningsPitched: 0, runsAllowed: 0, earnedRuns: 0, hits: 0, homeruns: 0, walks: 0, strikeouts: 0, pitches: 0 }
    },
    careerStats: {
      batting: { games: 0, atBats: 0, hits: 0, doubles: 0, triples: 0, homeruns: 0, rbis: 0, walks: 0, strikeouts: 0, stolenBases: 0, sacrificeBunts: 0 },
      pitching: { games: 0, wins: 0, losses: 0, saves: 0, holds: 0, inningsPitched: 0, runsAllowed: 0, earnedRuns: 0, hits: 0, homeruns: 0, walks: 0, strikeouts: 0, pitches: 0 }
    }
  };

  // 初回トライアウトの候補は生成物なので、帯から引くことができない。
  // リーグの格は**平行移動**で表す（上限や倍率ではない）。
  // ⚠ 倍率だと 走力100 の快足が D リーグで 58 に潰れる。差が保たれる加算なら
  //    格下リーグでも「1つだけ図抜けた選手」がそのまま図抜けたまま来る。
  // ⚠ 格は**平行移動**。上限や倍率ではないので、能力の差＝選手の形が保たれる
  applyLeagueLevelShift(player, options.rank, options.levelShift);
  // ⚠ 引いた帯を選手に残す。初期セットの「A2名・B10名・C12名」はこれで数える
  if (options.rank) player.rank = options.rank;

  player.scoutComment = generateScoutComment(player);
  return player;
}

/**
 * 不足分補充用のランダム候補生成（2年目以降用）
 * generateTryoutCandidatesと同じロジックだが少数のみ生成
 */
function generateRandomFillCandidates(count, year, independentLeagueRank) {
  const candidates = [];
  const nextId = reservePlayerIds((year || 1) * 10000 + 5001);
  const positionBag = buildPositionBag(count);
  for (let i = 1; i <= count; i++) {
    // ⚠ 格上の逸材（約10%）は**1人ずつ**引くこと。まとめて1回引くと、
    //    9割の年は1人も来ず、1割の年は全員が格上になる
    const rank = effectiveTryoutRank(independentLeagueRank);
    candidates.push(
      createCandidatePlayer({ id: nextId(), position: positionBag[i - 1], rank }),
    );
  }
  return candidates;
}

/**
 * 解雇プールから再トライアウト参加者を取り出し、候補者形式に整形
 * - プール内の base snapshot を変更せずに、表示用コピーを生成
 * - 年齢は attemptsInPool 分加算（プール滞在年数相当の経過）
 * - 能力値にブランクによる微減衰を適用
 * @returns {Array} 再トライアウト参加者（解雇フラグ付き）
 */
/**
 * 自由契約のプールから受験者を作る。
 *
 * @param {number|null} maxPlayers 引く人数（null なら全員）
 * @param {boolean} exProFirst **球団を解雇された選手を先に引く**
 *
 * ⚠ **プールは元プロだけではない**。大学卒業生・高卒の不指名者もここに入るので、
 *    人数の9割がそれで、素で引くと「FA枠」にほとんど元プロが来ない
 *    （実測: プール440人のうち元プロは49人。FA枠5人のうち元プロは0〜1人）。
 *    元プロは26〜32歳の衰える年代で、**リーグが若いまま伸び続けるのを止める**
 *    唯一の供給源なので、FA枠はそこから先に引く（いしだ案）。
 */
function getReleasedCandidatesFromPool(maxPlayers = null, exProFirst = false) {
  if (!releasedPlayersPool || releasedPlayersPool.length === 0) return [];

  // シャッフルして上限を設ける: 複数チームの並行初期化時に同一選手が全チームに選ばれるのを防ぐ
  const shuffled = () => [...releasedPlayersPool].sort(() => Math.random() - 0.5);
  const sourcePool =
    maxPlayers === null
      ? releasedPlayersPool
      : exProFirst
        ? (() => {
            const all = shuffled();
            // ⚠ 解雇された選手の印は `previousTeam`（`releasePlayers` が付ける）
            const exPro = all.filter((p) => p.previousTeam);
            const rest = all.filter((p) => !p.previousTeam);
            return [...exPro, ...rest].slice(0, maxPlayers);
          })()
        : shuffled().slice(0, maxPlayers);

  const candidates = [];
  for (const p of sourcePool) {
    const aged = JSON.parse(JSON.stringify(p));

    // 大学卒業生/新規候補は減衰なし（入団直後のフレッシュな状態）
    if (p.origin === 'university' || p.origin === 'corporate_candidate' || p.origin === 'independent_candidate') {
      aged.isReleasedCandidate = true;
      candidates.push(aged);
      continue;
    }

    // プールで過ごした年数＝不指名の回数（解雇直後の初回は0年）。
    // ⚠ **ここで年齢を足さないこと**。プールの選手は年度替わりに加齢する
    //    （`yearProgressionSystem` の「自由契約選手も加齢」）。以前はここでも
    //    「滞在年数＋1」歳を足しており、11/9 に解雇された25歳が翌日のトライアウトで
    //    26歳・能力も1年ぶん落ちた姿で出て、入団すると翌季は27歳になっていた。
    const yearsInPool = p.attemptsInPool || 0;
    aged.age = p.age || 20;
    // 能力値の微減衰: プールで過ごした年数に応じて累積（1年あたり各-1〜-2）
    const decay = (val, min = 1) => {
      let result = val;
      for (let y = 0; y < yearsInPool; y++) {
        result = Math.max(min, result - (1 + Math.floor(Math.random() * 2)));
      }
      return result;
    };
    if (aged.batting) {
      aged.batting.meet = decay(aged.batting.meet || 0);
      aged.batting.power = decay(aged.batting.power || 0);
      aged.batting.eye = decay(aged.batting.eye || 0);
    }
    if (aged.physical) {
      aged.physical.speed = decay(aged.physical.speed || 0);
    }
    if (aged.fielding) {
      aged.fielding.defense = decay(aged.fielding.defense || 0);
    }
    if (aged.pitching) {
      aged.pitching.control = decay(aged.pitching.control || 0);
      aged.pitching.velocity = decay(aged.pitching.velocity || 0, 100);
      aged.pitching.stamina = decay(aged.pitching.stamina || 0, 30);
    }
    // 再トライアウトフラグ
    aged.isReleasedCandidate = true;
    candidates.push(aged);
  }
  return candidates;
}

/**
 * クラブチーム（社会人クラブ）の選手からトライアウト受験者を抽出する。
 * クラブ選手はプロ志向でトライアウトを受けに来る想定。若手中心に抽出しクローンを返す。
 * @param {number} count - 抽出人数
 * @returns {Array} クラブ選手候補（_tryoutSource='club'）
 */
function getClubTryoutCandidates(count) {
  if (count <= 0) return [];
  const pool = [];
  for (const [teamName, team] of Object.entries(TEAMS_DATA)) {
    if (team?.corporateData?.type !== 'club') continue;
    for (const p of team.players || []) {
      if ((p.age || 25) > 27) continue; // 若手中心（プロ志向）
      pool.push({ p, teamName });
    }
  }
  if (pool.length === 0) return [];
  pool.sort(() => Math.random() - 0.5);
  return pool.slice(0, count).map(({ p, teamName }) => {
    const c = JSON.parse(JSON.stringify(p));
    c.origin = 'club';
    c._tryoutSource = 'club';
    c._previousClub = teamName;
    c.isReleasedCandidate = false;
    c.isNewcomer = false;
    return c;
  });
}

/**
 * トライアウトで指名されたクラブ選手を、所属クラブのロスターから除去する。
 * （指名者を残すと同一選手が2チームに存在してしまうため）
 * @param {Array<number>} draftedIds - 指名された選手のIDリスト
 */
export function removeDraftedFromClubTeams(draftedIds) {
  if (!draftedIds || draftedIds.length === 0) return;
  const drafted = new Set(draftedIds);
  for (const team of Object.values(TEAMS_DATA)) {
    if (team?.corporateData?.type !== 'club') continue;
    if (!team.players?.length) continue;
    team.players = team.players.filter(p => !drafted.has(p.id));
  }
}

/**
 * トライアウト後に解雇プールを更新
 * - 獲得された選手はプールから削除
 * - 獲得されなかった選手は attemptsInPool++（base snapshotの能力値・年齢は変更しない）
 * - 2回連続不指名、またはベース年齢+滞在年数が33歳以上の選手は引退（削除）
 * @param {Array<number>} draftedIds - トライアウトで指名された選手のIDリスト
 */
export function updateReleasedPoolAfterTryout(draftedIds) {
  if (!releasedPlayersPool || releasedPlayersPool.length === 0) return;
  const drafted = new Set(draftedIds || []);
  for (let i = releasedPlayersPool.length - 1; i >= 0; i--) {
    const p = releasedPlayersPool[i];
    if (drafted.has(p.id)) {
      // 再獲得された: プールから削除
      releasedPlayersPool.splice(i, 1);
      continue;
    }
    // 不指名: attempts++（base age/能力は保持）
    p.attemptsInPool = (p.attemptsInPool || 0) + 1;
    // 引退判定: 2回連続不指名 or 次のトライアウト時の年齢（年度替わりで1つ上がる）が33以上
    const nextDisplayAge = (p.age || 20) + 1;
    if (p.attemptsInPool >= 2 || nextDisplayAge >= 33) {
      releasedPlayersPool.splice(i, 1);
    }
  }
}

/**
 * トライアウト候補者を生成
 * @param {number} year - 年数（0=初回30人/チーム、1以降=15人/チーム）
 * @param {number} teamCount - チーム数
 * @param {boolean} isInitial - 初回トライアウトかどうか
 * @returns {Array} トライアウト候補者の配列
 */
export function generateTryoutCandidates(year, teamCount, isInitial = false, independentLeagueRank = null, leagueReputation = 0) {
  // リリースプール（ドラフト漏れ・大学卒業生・戦力外）を主体にする
  // 初回も2年目以降も同じロジック（warmUpPipelineで事前にプール生成済み）
  const candidates = [];
  const existingIds = new Set();
  const addCandidate = (c) => {
    if (!c || existingIds.has(c.id)) return;
    existingIds.add(c.id);
    if (!c.scoutComment) c.scoutComment = generateScoutComment(c);
    candidates.push(c);
  };

  // === 初回トライアウト: プール未整備のため生成で供給 ===
  if (isInitial) {
    const releasedLimit = Math.min(releasedPlayersPool?.length || 0, 50);
    getReleasedCandidatesFromPool(releasedLimit).forEach(addCandidate);
    const minCandidates = teamCount * 30;
    const freshCount = Math.max(0, minCandidates - candidates.length);
    if (freshCount > 0) {
      generateRandomFillCandidates(freshCount, year, independentLeagueRank).forEach(addCandidate);
    }
    return candidates;
  }

  // === 2年目以降: 実在プールから供給（生成しない）===
  // 受験者の構成比・質・人数はリーグ注目度(leagueReputation 0-100)で変動する。
  //   低注目度: 大学卒40/高卒52/FA8 → 素材型の高校生中心
  //   高注目度: 大学卒55/高卒25/FA20 → 大学卒・元プロ(FA)が集まり、質も上位帯に
  // 大学でプロに届かなかった4年生が最多という現実的な像は維持しつつ、
  // リーグを育てる（プロ輩出でdevelopmentReputationが上がる）動機付けにする。
  const t = Math.max(0, Math.min(1, (leagueReputation || 0) / 60));
  const uniShare = 0.40 + 0.15 * t;
  // ⚠ **FA（元プロ）の枠を厚くする**（いしだ案: 解雇した選手が混ざることで
  //    年齢の釣り合いが取れる）。以前は 8〜20% で、しかもその半分がクラブ選手、
  //    さらにプールを素で引いていたので、実際に出てくる元プロは受験者の
  //    **0〜1%**しか居なかった（実測: 120人中0〜1人）。
  //    受験者の平均年齢は19.9歳で、**29歳以上が1人も居ない**。
  //    これでは入ってくるのが若い選手だけになり、リーグは毎年伸びるだけになる
  const faShare = 0.18 + 0.12 * t;
  const hsShare = Math.max(0.20, 1 - uniShare - faShare);
  const total = teamCount * (TRYOUT_TOTAL_PER_TEAM + Math.round(2 * t)); // 注目度で受験者数も微増
  const uniCount = Math.max(Math.round(total * uniShare), 6);
  const hsCount = Math.max(Math.round(total * hsShare), 5);
  const faCount = Math.max(Math.round(total * faShare), 3);
  // リーグの格は**どの層から引くか**だけを決める（`RANK_BAND_BIAS`）。
  // ⚠ 能力に上限や倍率を掛けない。帯で絞ったうえに能力も削ると二重制限になり、
  //    一芸型（走力100・ミート30 のような選手）が真っ先に削られて来られなくなる。
  // 注目度(t) は帯をさらに少しだけ上へ動かす（リーグを育てる動機付け）。
  const qualityBias = Math.max(0, Math.min(1, rankBandBias(independentLeagueRank) + t * 0.25));
  // 約10%は「格上の逸材」＝もう一段上の帯から引く。
  //   意図: 同格で埋もれるより、少し格下のリーグで試合に出て活躍するほうが賢いという選手。
  const gemBias = Math.min(1, qualityBias + 0.25);
  // 通常枠（90%）とgem枠（10%）に分割
  const split = (n) => { const gem = Math.max(1, Math.round(n * 0.1)); return { main: Math.max(0, n - gem), gem }; };
  const hsS = split(hsCount), uniS = split(uniCount);
  // 多めに引いてから守備位置の群で間引く（プールの評価順に構成比が引きずられるのを断つ）
  const drawHS = (n, bias) => balanceByPosition(getHighSchoolTryoutCandidates(n * TRYOUT_OVERDRAW, bias), n);
  const drawUni = (n, bias) => balanceByPosition(getUniversitySeniorTryoutCandidates(year, n * TRYOUT_OVERDRAW, bias), n);
  // 1. 高校卒業予定
  drawHS(hsS.main, qualityBias).forEach(addCandidate);
  drawHS(hsS.gem, gemBias).forEach(c => { c._gem = true; addCandidate(c); });
  // 2. 大学4年生（卒業予定・NPB未指名）
  drawUni(uniS.main, qualityBias).forEach(addCandidate);
  drawUni(uniS.gem, gemBias).forEach(c => { c._gem = true; addCandidate(c); });
  // 3. FA組（リリースプール ＋ クラブチーム選手）
  //    FA枠の半分はクラブチームのプロ志向選手から供給する
  // ⚠ クラブ選手は若い。FA枠の多数は**元プロ**に回す
  const clubCount = Math.max(Math.round(faCount * 0.35), 2);
  const releasedCount = Math.max(faCount - clubCount, 2);
  getReleasedCandidatesFromPool(releasedCount, true).forEach(addCandidate);
  getClubTryoutCandidates(clubCount).forEach(addCandidate);

  // 4. 安全網: 実在候補が極端に少ない場合のみ生成で補完（通常は発生しない）
  const minCandidates = teamCount * 4;
  if (candidates.length < minCandidates) {
    generateRandomFillCandidates(minCandidates - candidates.length, year, independentLeagueRank).forEach(addCandidate);
  }

  return candidates;
}

/**
 * リーグ全体の育成評判に基づいてトライアウト候補者を強化
 * プロ輩出実績のあるリーグには良い選手が集まりやすくなる
 * @param {Array} candidates - トライアウト候補者の配列
 * @param {Object} allTeams - TEAMS_DATA
 * @returns {Array} 強化された候補者の配列
 */
export function applyReputationBonus(candidates, allTeams) {
  // リーグ全体の育成評判の平均を計算
  const teams = Object.values(allTeams);
  const totalReputation = teams.reduce((sum, team) => sum + (team.developmentReputation || 0), 0);
  const avgReputation = teams.length > 0 ? totalReputation / teams.length : 0;

  if (avgReputation <= 0) return candidates;

  // 評判に応じて「一芸に秀でた」尖った候補者が出やすくなる
  // 全体的な底上げではなく、1つの能力だけが突出する
  const boostRate = Math.min(0.2, avgReputation / 500); // 最大20%の候補者に一芸ブースト
  const spikeAmount = Math.min(10, Math.floor(avgReputation / 10)); // 最大+10ポイント（1つの能力のみ）

  candidates.forEach(player => {
    if (Math.random() < boostRate) {
      if (player.position === 'pitcher') {
        // 投手: 1つだけ突出させる（他は据え置き）
        const roll = Math.random();
        if (roll < 0.4) {
          // 剛速球タイプ
          player.pitching.velocity = Math.min(152, player.pitching.velocity + Math.ceil(spikeAmount / 3));
        } else if (roll < 0.7) {
          // 精密制球タイプ
          player.pitching.control = Math.min(99, player.pitching.control + spikeAmount);
        } else {
          // 鉄腕タイプ
          player.pitching.stamina = Math.min(200, player.pitching.stamina + spikeAmount * 2);
        }
      } else {
        // 野手: 1つの能力だけ突出させる
        const roll = Math.random();
        if (roll < 0.25) {
          // 巧打タイプ
          player.batting.meet = Math.min(99, player.batting.meet + spikeAmount);
        } else if (roll < 0.5) {
          // 強打タイプ
          player.batting.power = Math.min(99, player.batting.power + spikeAmount);
        } else if (roll < 0.75) {
          // 俊足タイプ
          player.physical.speed = Math.min(99, player.physical.speed + spikeAmount);
          player.batting.steal = Math.min(99, (player.batting.steal || 30) + spikeAmount);
        } else {
          // 守備の名手タイプ
          player.fielding.defense = Math.min(99, player.fielding.defense + spikeAmount);
          player.physical.arm = Math.min(99, (player.physical.arm || 40) + Math.ceil(spikeAmount / 2));
        }
      }
    }
  });

  return candidates;
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

/**
 * 年齢による評価補正（素材型 vs 即戦力）
 * 大卒(22歳)を基準(±0)とし、若いほど将来性で加点、年上はやや辛口
 * @param {number} age - 選手の年齢
 * @returns {number} - ランク計算に加算する補正値
 */
function getAgeRankAdjust(age) {
  if (age <= 18) return 10;  // 高卒素材（大化けの期待）
  if (age <= 19) return 7;
  if (age <= 20) return 5;
  if (age <= 21) return 3;
  if (age <= 22) return 0;   // 大卒基準
  if (age <= 23) return -3;
  if (age <= 24) return -7;
  return -12;                // 即戦力レベル必須
}

/**
 * 選手の推薦ランクを計算（S/A/B/C/D）
 * 年齢補正あり: 若手は素材型として加点、年上は即戦力として現能力ベースで評価
 * @param {Object} player - 選手データ
 * @returns {string} - 'S', 'A', 'B', 'C', 'D'
 */
export function calculatePlayerRank(player) {
  const isPitcher = player.position === 'pitcher';
  let totalScore = 0;

  if (isPitcher) {
    // 投手評価: 球速、制球、スタミナ、変化球
    const velocityScore = (player.pitching.velocity - 130) * 2; // 130km/h基準
    const controlScore = player.pitching.control;
    const staminaScore = player.pitching.stamina / 2;
    const arsenalScore = player.pitching.arsenal.reduce((sum, pitch) => sum + pitch.level, 0) / player.pitching.arsenal.length;

    totalScore = (velocityScore * 0.3) + (controlScore * 0.25) + (staminaScore * 0.25) + (arsenalScore * 0.2);
  } else {
    // 野手評価: ミート、パワー、走力、守備、肩
    const meetScore = player.batting.meet;
    const powerScore = player.batting.power;
    const speedScore = player.physical.speed;
    const defenseScore = player.fielding.defense;
    const armScore = player.physical.arm;

    totalScore = (meetScore * 0.3) + (powerScore * 0.25) + (speedScore * 0.2) + (defenseScore * 0.15) + (armScore * 0.1);
  }

  // 年齢補正（素材型ボーナス / 即戦力ペナルティ）
  totalScore += getAgeRankAdjust(player.age || 22);

  // ランク判定
  if (totalScore >= 80) return 'S';
  if (totalScore >= 70) return 'A';
  if (totalScore >= 60) return 'B';
  if (totalScore >= 50) return 'C';
  return 'D';
};

/**
 * スカウトコメントテンプレート（特性別）
 */
const SCOUT_COMMENT_TEMPLATES = {
  // 野手特性
  speedster: [
    '俊足は天下一品。バント・盗塁で試合を動かせる選手に育てたい。',
    'とにかく足が速い。守備範囲の広い外野手として磨けば一線級になれる素材だ。',
    'この走力は独立リーグでは際立っている。打撃が育てば面白い。'
  ],
  slugger: [
    '打球の飛距離は将来性を感じさせる。ミートを鍛えればアーチを量産できるはず。',
    '粗削りだが、あの打球の強さは本物。あとは当てる技術だけだ。',
    '強いスイングが武器。制球眼を磨けば長距離砲になれる。'
  ],
  defender: [
    '守備は光る。肩の強さと安定感は他の候補者とは別格だ。',
    'グラブさばきが上手い。攻守のバランスを高めれば主力になれる。',
    '守りで試合を作れる選手だ。打撃が育てば理想の守備職人になれる。'
  ],
  contactHitter: [
    'バットコントロールが巧み。出塁率が高く、ラインナップに欠かせない存在になれる。',
    'ミートの精度が高い。選球眼を鍛えれば出塁マシンになれる原石だ。',
    '振り回さずしっかり当てる技術がある。打順の軸として活躍できそうだ。'
  ],
  eyeMaster: [
    '選球眼が素晴らしい。四球を稼げる選手は攻撃の起点になれる。',
    'ボール球に手を出さない冷静さがある。長打力が出れば面白い選手だ。',
    '見極めが抜群。長所を活かした打席を増やせれば化けそうだ。'
  ],
  baserunner: [
    '走塁センスが光る。バッティングが一人前になれば計算できる選手だ。',
    '塁上での判断力が良い。盗塁技術を磨けば相手チームの脅威になれる。',
    'スピードと判断力は独立リーグでも上位クラス。打撃が課題だ。'
  ],
  armStrong: [
    '肩の強さは一級品。外野からの矢のような返球は見ていて気持ちいい。',
    'この肩があれば外野はもちろん、右翼やサードでも使える可能性がある。',
    '強肩が光る。守備と打撃が整えば即戦力に近づける素材だ。'
  ],
  speedContact: [
    '俊足に加えてミートもなかなかある。磨けば上位打線を任せられる選手になれる。',
    '足も使えてバットもそこそこ。バランスが整ってきたら怖い選手だ。',
    '俊足巧打の素材。打撃をもう少し磨けばすぐに戦力計算できる。'
  ],
  powerArm: [
    '長打力と強肩を兼ね備えた外野手の素材。打撃の精度が上がれば大きい。',
    'パワーと肩が光る。バットコントロールさえ良くなれば主軸を任せたい。',
    '強肩強打の片鱗あり。荒削りだが将来性は十分ある選手だ。'
  ],
  // 投手特性
  fireballer: [
    'この球速は魅力。チェンジアップを覚えれば、緩急で三振が量産できる素材だ。',
    '球威は本物。変化球の精度を上げれば、打者は手こずるはずだ。',
    'ストレートで押せる力がある。あとは制球と変化球を磨くだけだ。'
  ],
  controlPitcher: [
    'コーナーへのコントロールが光る。球速を上げれば、打者は手も足も出ない。',
    '打者の内外角を丁寧につける投球術がある。球威があれば面白い存在だ。',
    '制球力は独立リーグでもトップクラス。あとは球威があればいうことなし。'
  ],
  ironman: [
    'スタミナは抜群。先発として長いイニングを任せたい素材だ。',
    '試合を通して安定して投げられる体力がある。技術面の成長が鍵だ。',
    '9回まで投げ切るタフネスがある。技術を磨けば安定感あるローテ投手になれる。'
  ],
  breakingBall: [
    '多彩な変化球が武器。制球が安定すれば、打者を翻弄できる投手になれる。',
    '変化球の種類が豊富。コントロールを磨けば面白い投手に育つ。',
    '曲がりの鋭い変化球がある。制球さえ安定すれば大きな武器になる。'
  ],
  sinkerballer: [
    'ゴロを打たせる技術がある。守備陣と連携して試合を作れる投手になれそうだ。',
    'バットの芯を外す投球ができる。制球とスタミナをさらに伸ばしたい素材だ。',
    '打ち取る術を持っている。守りのチームに合った投球スタイルだ。'
  ],
  strikeoutArtist: [
    '三振を取れる球威がある。変化球を覚えれば空振り量産型の投手になれる。',
    'もう一球種磨けば手がつけられない存在になれる。まだ磨かれていない原石だ。',
    '奪三振能力の片鱗を感じる。変化球を習得すれば一気に化ける素材だ。'
  ]
};

/**
 * 特性のコメントテンプレートが選手の実能力に合致するか判定
 * - 複数特性を持つ選手はgenerateAbilitiesで最大値が採用されるため、
 *   primaryTraitのコメントが実能力と矛盾することがある（例: controlPitcher+fireballer → 球速A）
 * - 本関数でコメントテンプレートの文言と実能力が矛盾しない特性だけを選ぶ
 * @returns {boolean} trait のテンプレート文言が player の実能力と整合するか
 */
function traitCommentMatches(trait, player) {
  const p = player.pitching || {};
  const b = player.batting || {};
  const ph = player.physical || {};
  const f = player.fielding || {};
  const arsenal = p.arsenal || [];
  const breakingBallCount = arsenal.filter(a => a.type !== 'straight').length;
  const hasSinkerType = arsenal.some(a => ['sinker', 'twoSeam', 'shoot', 'splitter'].includes(a.type));

  switch (trait) {
    // 投手特性
    case 'fireballer':
      // 「この球速は魅力」「球威は本物」→ 球速が高いこと
      return (p.velocity || 0) >= 140;
    case 'controlPitcher':
      // 「球速を上げれば打者は手も足も出ない」→ 制球が高く球速が足りないこと
      return (p.control || 0) >= 55 && (p.velocity || 0) < 140;
    case 'ironman':
      // 「スタミナは抜群」→ スタミナが高いこと
      return (p.stamina || 0) >= 85;
    case 'breakingBall':
      // 「多彩な変化球が武器」→ 変化球が複数あること
      return breakingBallCount >= 3;
    case 'sinkerballer':
      // 「ゴロを打たせる技術」→ 沈む系の球種を持ち、ある程度の制球があること
      return hasSinkerType && (p.control || 0) >= 50;
    case 'strikeoutArtist':
      // 「三振を取れる球威」「制球はまだ粗い」→ 球速が高く制球が不安定であること
      return (p.velocity || 0) >= 138 && (p.control || 0) < 58;
    // 野手特性
    case 'speedster':
      return (ph.speed || 0) >= 60;
    case 'slugger':
      return (b.power || 0) >= 55;
    case 'defender':
      return (f.defense || 0) >= 55;
    case 'contactHitter':
      return (b.meet || 0) >= 55;
    case 'eyeMaster':
      return (b.eye || 0) >= 55;
    case 'baserunner':
      return (ph.speed || 0) >= 50 && (b.steal || 0) >= 45;
    case 'armStrong':
      return (ph.arm || 0) >= 60;
    case 'speedContact':
      return (ph.speed || 0) >= 50 && (b.meet || 0) >= 50;
    case 'powerArm':
      return (b.power || 0) >= 50 && (ph.arm || 0) >= 50;
    default:
      return false;
  }
}

/**
 * スカウトコメントを生成
 * @param {Object} player - 選手データ（traits, position, batting, pitching, physical, fielding を含む）
 * @returns {{text: string, potentialHint: string, potentialLevel: number, talentHint: string}} スカウトコメント（構造化）
 *   potentialLevel: 5=最高, 4=高, 3=普通(表示なし), 2=低, 1=最低
 */
export function generateScoutComment(player) {
  const traits = player.traits || [];
  const gp = player.growthPotential || 1.0;

  let potentialHint = '';
  let potentialLevel = 3; // デフォルト: 普通（コメントなし）
  if (gp >= 1.35) {
    potentialHint = ['素材としては今年の目玉。大化けの予感がする。', '練習での吸収力が飛び抜けている。将来のスター候補だ。', 'ダイヤの原石。磨けばリーグを代表する選手になれる。'][Math.floor(Math.random() * 3)];
    potentialLevel = 5;
  } else if (gp >= 1.2) {
    potentialHint = Math.random() < 0.7 ? ['伸びしろは十分。成長次第で主力に化ける。', '練習への取り組み方を見ると、まだまだ伸びる印象だ。'][Math.floor(Math.random() * 2)] : '';
    potentialLevel = 4;
  } else if (gp <= 0.65) {
    potentialHint = Math.random() < 0.7 ? ['ただ、現状の能力がほぼ天井かもしれない。', '伸びしろという点では少し物足りない印象だ。'][Math.floor(Math.random() * 2)] : '';
    potentialLevel = 1;
  } else if (gp <= 0.8) {
    potentialHint = Math.random() < 0.4 ? '大きな成長を期待するより、即戦力として計算したい。' : '';
    potentialLevel = 2;
  }

  // 才能タイプのヒント（muscle/dexterityが高い場合のみ）
  const muscle = player.physical?.muscle || 50;
  const dext = player.physical?.dexterity || 50;
  let talentHint = '';
  if (muscle >= 70 && dext >= 70) {
    talentHint = '恵まれた体格に加え、手先の器用さも兼ね備えている。';
  } else if (muscle >= 70) {
    talentHint = ['恵まれた体格が目を引く。フィジカル面の成長が期待できる。', '体の強さは十分。パワー系の練習で大きく伸びる素材だ。'][Math.floor(Math.random() * 2)];
  } else if (dext >= 70) {
    talentHint = ['手先の器用さが光る。技術系の練習で伸びるタイプだ。', 'センスの良さを感じる。技術的な成長が早いだろう。'][Math.floor(Math.random() * 2)];
  } else if (muscle <= 35) {
    talentHint = Math.random() < 0.5 ? '線が細く、フィジカル面の上積みは厳しいかもしれない。' : '';
  } else if (dext <= 35) {
    talentHint = Math.random() < 0.5 ? '不器用な面があり、技術の習得に時間がかかるかもしれない。' : '';
  }

  const buildResult = (comment) => ({ text: comment, potentialHint, potentialLevel, talentHint });

  // 二刀流選手は専用コメントを生成
  if (player.isTwoWay) {
    const isPitcher = player.position === 'pitcher';
    const v = player.pitching?.velocity || 130;
    const meet = player.batting?.meet || 0;
    const power = player.batting?.power || 0;
    const speed = player.physical?.speed || 0;

    if (isPitcher) {
      const pitcherTwoWayComments = [
        '投手としての素材は十分。それに加えて打撃センスも光り、野手として育てる選択肢もある。',
        '投手だが、バットスイングの力強さが目を引く。二刀流で起用すれば面白い存在になれる。',
        'マウンドでの投球も魅力だが、打席での対応力が非凡。投打両面での活躍が期待できる。',
        '投手能力に加え、野手としてのポテンシャルも秘めている。使い方次第で大きな戦力になる。',
      ];
      if (v >= 145 && meet >= 45) return buildResult('速球派の投手でありながら打撃もプロ級。二刀流の逸材と言っていい。');
      if (v >= 140) return buildResult(pitcherTwoWayComments[Math.floor(Math.random() * pitcherTwoWayComments.length)]);
      if (meet >= 50 || power >= 45) return buildResult('投手としてはまだ発展途上だが、打撃の良さは光る。野手転向も視野に入る素材だ。');
      return buildResult(pitcherTwoWayComments[Math.floor(Math.random() * pitcherTwoWayComments.length)]);
    } else {
      const fielderTwoWayComments = [
        '野手としての打力が武器だが、マウンドに上がれば投手としても通用する腕を持っている。',
        '本職は野手だが、投手としても面白い。リリーフ起用で二刀流の真価を発揮できるタイプだ。',
        '打って投げて走れる万能型。投手としての起用も計算に入れられる貴重な存在だ。',
        '野手能力の高さに加え、投手経験も豊富。チーム事情に応じて柔軟に起用できる。',
      ];
      if (v >= 140 && (meet >= 50 || power >= 50)) return buildResult('打撃も投球も高水準。投手と野手、どちらでも一軍で勝負できる二刀流の逸材だ。');
      if (speed >= 55) return buildResult(fielderTwoWayComments[2]);
      return buildResult(fielderTwoWayComments[Math.floor(Math.random() * fielderTwoWayComments.length)]);
    }
  }

  // 実能力と合致する特性を優先して選ぶ（複数特性時の矛盾コメントを防止）
  for (const trait of traits) {
    const templates = SCOUT_COMMENT_TEMPLATES[trait];
    if (templates && traitCommentMatches(trait, player)) {
      return buildResult(templates[Math.floor(Math.random() * templates.length)]);
    }
  }

  // 特性なし or 実能力と合致する特性がなかった場合: 実能力ベースでコメントを生成
  const isPitcher = player.position === 'pitcher';
  if (isPitcher) {
    const v = player.pitching?.velocity || 130;
    const c = player.pitching?.control || 40;
    const s = player.pitching?.stamina || 60;
    const arsenal = player.pitching?.arsenal || [];
    const breakingBallCount = arsenal.filter(a => a.type !== 'straight').length;
    if (v >= 145 && c < 58) return buildResult('球速は魅力。制球が安定すれば打者を抑えられる素材だ。');
    if (v >= 145) return buildResult('球速は及第点以上。変化球と制球の精度次第で戦力になれる。');
    if (c >= 60 && v < 135) return buildResult('丁寧なピッチングができる。球威が増せば面白い存在になれる。');
    if (c >= 60) return buildResult('球の散らばりが少ない。持ち味を活かせば計算できる投手だ。');
    if (s >= 90) return buildResult('長いイニングを任せられる体力がある。技術を磨けばローテに入れる。');
    if (breakingBallCount >= 3) return buildResult('変化球の引き出しは多い。制球が整えば打者を翻弄できる。');
    return buildResult('平均的な能力だが、真摯に練習に取り組む姿勢が見えた。伸びしろに期待する。');
  } else {
    const meet = player.batting?.meet || 0;
    const power = player.batting?.power || 0;
    const eye = player.batting?.eye || 0;
    const speed = player.physical?.speed || 0;
    const defense = player.fielding?.defense || 0;
    const arm = player.physical?.arm || 0;
    const maxStat = Math.max(meet, power, eye, speed, defense, arm);
    if (maxStat === speed && speed >= 50) return buildResult('俊足が光る。守備範囲を広げて打撃を磨けば戦力になれる。');
    if (maxStat === meet && meet >= 45) return buildResult('バットコントロールがある。打撃の精度を磨けば計算できる選手だ。');
    if (maxStat === power && power >= 40) return buildResult('打球の飛距離は魅力的。当てる技術が身につけば大きな武器になる。');
    if (maxStat === eye && eye >= 50) return buildResult('選球眼に光るものがある。出塁率を稼げる打者に育てたい。');
    if (maxStat === defense && defense >= 50) return buildResult('守備の安定感がある。攻撃面を鍛えれば即戦力に近づける。');
    if (maxStat === arm && arm >= 50) return buildResult('肩の強さが光る。守備位置の適性を活かして育てたい。');
    return buildResult('全体的に粗削りだが、真面目な取り組みが見えた。時間をかけて育てたい素材だ。');
  }
}

/**
 * スネークドラフト順序を生成
 * @param {Array} teams - チーム名の配列（例: ['ユーザー', 'AI1', 'AI2', 'AI3']）
 * @param {number} rounds - ラウンド数
 * @returns {Array} ドラフト順序の配列
 */
export function generateSnakeDraftOrder(teams, rounds) {
  const draftOrder = [];

  for (let round = 0; round < rounds; round++) {
    if (round % 2 === 0) {
      // 偶数ラウンド: 通常順
      teams.forEach(team => draftOrder.push({ round: round + 1, team }));
    } else {
      // 奇数ラウンド: 逆順（スネークドラフト）
      [...teams].reverse().forEach(team => draftOrder.push({ round: round + 1, team }));
    }
  }

  return draftOrder;
};

/**
 * ロスターの能力バランスを分析
 * @param {Array} roster - 現在のロスター（配列形式）
 * @returns {Object} 能力バランス分析結果
 */
export function analyzeRosterBalance(roster) {
  if (!roster || roster.length === 0) {
    return {
      pitchers: { count: 0, avgStamina: 0, avgVelocity: 0, avgControl: 0 },
      fielders: { count: 0, avgOffense: 0, avgDefense: 0, avgSpeed: 0 }
    };
  }

  const pitchers = roster.filter(p => p.position === 'pitcher');
  const fielders = roster.filter(p => p.position !== 'pitcher');

  // 投手分析
  const pitcherAnalysis = {
    count: pitchers.length,
    avgStamina: 0,
    avgVelocity: 0,
    avgControl: 0
  };

  if (pitchers.length > 0) {
    pitcherAnalysis.avgStamina = pitchers.reduce((sum, p) => sum + p.pitching.stamina, 0) / pitchers.length;
    pitcherAnalysis.avgVelocity = pitchers.reduce((sum, p) => sum + p.pitching.velocity, 0) / pitchers.length;
    pitcherAnalysis.avgControl = pitchers.reduce((sum, p) => sum + p.pitching.control, 0) / pitchers.length;
  }

  // 野手分析
  const fielderAnalysis = {
    count: fielders.length,
    avgOffense: 0,  // ミート + パワーの平均
    avgDefense: 0,
    avgSpeed: 0,
    avgPower: 0
  };

  if (fielders.length > 0) {
    fielderAnalysis.avgOffense = fielders.reduce((sum, p) => sum + (p.batting.meet + p.batting.power) / 2, 0) / fielders.length;
    fielderAnalysis.avgDefense = fielders.reduce((sum, p) => sum + p.fielding.defense, 0) / fielders.length;
    fielderAnalysis.avgSpeed = fielders.reduce((sum, p) => sum + p.physical.speed, 0) / fielders.length;
    fielderAnalysis.avgPower = fielders.reduce((sum, p) => sum + p.batting.power, 0) / fielders.length;
  }

  return {
    pitchers: pitcherAnalysis,
    fielders: fielderAnalysis
  };
}

/**
 * 選手の価値をロスターバランスを考慮してスコア化
 * @param {Object} player - 選手データ
 * @param {Object} rosterAnalysis - ロスター分析結果
 * @returns {number} 選手の価値スコア（高いほど優先）
 */
export function calculatePlayerValueScore(player, rosterAnalysis) {
  const rank = calculatePlayerRank(player);
  const rankScore = { S: 100, A: 80, B: 60, C: 40, D: 20 }[rank] || 0;
  let bonusScore = 0;
  let specialistScore = 0;

  if (player.position === 'pitcher') {
    const { avgStamina, avgVelocity, avgControl, count: pitcherCount } = rosterAnalysis.pitchers;

    // === 一芸ボーナス（総合ランクが低くても突出した能力を評価） ===
    // 剛速球投手（150km/h以上）
    if (player.pitching.velocity >= 150) {
      specialistScore += 40;
    } else if (player.pitching.velocity >= 145) {
      specialistScore += 25;
    }
    // 精密制球（制球70以上）
    if (player.pitching.control >= 70) {
      specialistScore += 35;
    } else if (player.pitching.control >= 60) {
      specialistScore += 15;
    }
    // 鉄腕（スタミナ160以上）
    if (player.pitching.stamina >= 160) {
      specialistScore += 30;
    }
    // 魔球使い（変化球レベル最高が70以上）
    const bestBreaking = player.pitching.arsenal
      ? Math.max(...player.pitching.arsenal.map(p => p.level || 0))
      : 0;
    if (bestBreaking >= 70) {
      specialistScore += 30;
    }

    // === チーム補強ボーナス（不足を埋める） ===
    // スタミナ不足 → スタミナ型投手を優先
    if (avgStamina < 120 && player.pitching.stamina >= 140) {
      bonusScore += 35;
    } else if (avgStamina < 130 && player.pitching.stamina >= 140) {
      bonusScore += 20;
    }

    // 速球派ばかり → 制球派を求める
    if (avgVelocity >= 135 && player.pitching.control >= 60) {
      bonusScore += 25;
    }

    // 制球力不足 → 制球力の高い投手を優先
    if (avgControl < 50 && player.pitching.control >= 60) {
      bonusScore += 30;
    }

    // 速球派不足 → 剛速球投手を求める
    if (avgVelocity < 138 && player.pitching.velocity >= 145) {
      bonusScore += 25;
    }

    // 先発候補不足（投手が少ない時、スタミナ型を重視）
    if (pitcherCount < 5 && player.pitching.stamina >= 130) {
      bonusScore += 20;
    }

    // バランス型投手にもボーナス
    if (player.pitching.stamina >= 130 && player.pitching.velocity >= 135 && player.pitching.control >= 55) {
      bonusScore += 10;
    }

  } else {
    const { avgOffense, avgDefense, avgSpeed, count: fielderCount } = rosterAnalysis.fielders;

    // === 一芸ボーナス（突出した能力を評価） ===
    // スラッガー（パワー75以上）
    if (player.batting.power >= 75) {
      specialistScore += 40;
    } else if (player.batting.power >= 65) {
      specialistScore += 20;
    }
    // 安打製造機（ミート75以上）
    if (player.batting.meet >= 75) {
      specialistScore += 35;
    } else if (player.batting.meet >= 65) {
      specialistScore += 15;
    }
    // 韋駄天（走力75以上）
    if (player.physical.speed >= 75) {
      specialistScore += 35;
    } else if (player.physical.speed >= 65) {
      specialistScore += 15;
    }
    // 守備の名手（守備70以上）
    if (player.fielding.defense >= 70) {
      specialistScore += 30;
    }
    // 強肩（肩力75以上）
    if (player.physical.arm >= 75) {
      specialistScore += 20;
    }
    // 選球眼マスター（選球眼70以上）
    if (player.batting.eye >= 70) {
      specialistScore += 15;
    }

    // === チーム補強ボーナス（不足を埋める） ===
    // 打撃偏重チーム → 守備・走力を求める
    if (avgOffense >= 50) {
      if (player.fielding.defense >= 65) {
        bonusScore += 30; // 守備職人
      }
      if (player.physical.speed >= 65) {
        bonusScore += 25; // 俊足
      }
    }

    // 守備が弱いチーム → 守備の良い選手を優先
    if (avgDefense < 45 && player.fielding.defense >= 55) {
      bonusScore += 30;
    }

    // 足が遅いチーム → 俊足選手を優先
    if (avgSpeed < 45 && player.physical.speed >= 60) {
      bonusScore += 30;
    }

    // 打撃が弱いチーム → 強打者を優先
    if (avgOffense < 40) {
      const offense = (player.batting.meet + player.batting.power) / 2;
      if (offense >= 55) {
        bonusScore += 30;
      }
    }

    // パワー不足 → スラッガーを優先
    if (fielderCount > 0) {
      const avgPower = rosterAnalysis.fielders.avgPower || 0;
      if (avgPower < 45 && player.batting.power >= 60) {
        bonusScore += 25;
      }
    }

    // 5ツール型選手にボーナス
    const offense = (player.batting.meet + player.batting.power) / 2;
    if (offense >= 55 && player.physical.speed >= 60 && player.fielding.defense >= 60) {
      bonusScore += 15;
    }
    // ユーティリティ（守備の幅）ボーナス。控え・守備固め要員として価値が上がる。
    bonusScore += Math.round(getUtilityScore(player) * 0.15); // 最大+15
  }

  // 年齢による指名優先度補正（素材型 vs 即戦力）
  // 若手はやや加点されるが、能力差を覆すほどではない
  const age = player.age || 22;
  let ageBonus = 0;
  if (age <= 18)      ageBonus = 10;
  else if (age <= 19) ageBonus = 7;
  else if (age <= 20) ageBonus = 4;
  else if (age <= 21) ageBonus = 2;
  else if (age <= 22) ageBonus = 0;   // 大卒基準
  else if (age <= 23) ageBonus = -3;
  else if (age <= 24) ageBonus = -8;
  else                ageBonus = -15;

  return rankScore + bonusScore + specialistScore + ageBonus;
}

/**
 * AIチームの選手選択ロジック（改良版）
 * @param {Array} candidates - 残りの候補者
 * @param {Array} currentRoster - 現在のロスター（配列形式）
 * @returns {Object} 選択された選手
 */
/**
 * @param {object} targets 目標構成。⚠ **オンラインは枠が26人で別の表を使う**
 *    （`ONLINE_ROSTER_TARGETS`）。既定は一人用の `ROSTER_TARGETS`（24人）。
 *    ここを既定のままにしておくと、オンラインのCPUだけ24人で止まる。
 */
export function selectPlayerForAI(
  candidates,
  currentRoster = [],
  teamContext = null,
  targets = ROSTER_TARGETS,
) {
  // ロスター配列をオブジェクトから配列に変換（後方互換性のため）
  let rosterArray = currentRoster;
  if (!Array.isArray(currentRoster)) {
    rosterArray = Object.values(currentRoster);
  }

  // ポジション別カウント
  // ⚠ 区分の分け方も目標人数も `ROSTER_TARGETS` 側が正本。ここに書き直さないこと
  //    （人の希望リストの解決と食い違うと、人とCPUで別の名簿ができる）
  const rosterCounts = countRoster(rosterArray);

  // ロスターの能力バランスを分析
  const rosterAnalysis = analyzeRosterBalance(rosterArray);

  // 優先ポジション設定（不足しているポジション）
  let preferredPositions = [];
  if (rosterCounts.pitcher < targets.pitcher) preferredPositions.push('pitcher');
  if (rosterCounts.catcher < targets.catcher) preferredPositions.push('catcher');
  if (rosterCounts.infielder < targets.infielder) preferredPositions.push('first', 'second', 'third', 'short');
  if (rosterCounts.outfielder < targets.outfielder) preferredPositions.push('left', 'center', 'right');

  // 全候補者に価値スコアを付与
  const scoredCandidates = candidates.map(player => ({
    ...player,
    valueScore: calculatePlayerValueScore(player, rosterAnalysis),
    isPreferredPosition: preferredPositions.includes(player.position)
  }));

  // ポジション優先度ボーナスを適用
  scoredCandidates.forEach(candidate => {
    if (candidate.isPreferredPosition) {
      // 不足ポジションには大きなボーナス
      if (rosterCounts[rosterGroup(candidate.position)] === 0) {
        candidate.valueScore += 50; // 0人の場合は最優先
      } else {
        candidate.valueScore += 30; // 不足している場合
      }
    } else {
      // ⚠ **目標の人数に届いた区分は引く**（届いた時点で-20、1人超えるごとに-20）。
      //    引かないと、一芸ボーナス（球速145以上・制球60以上など）が大きい投手ばかり取り続け、
      //    10年の長期シミュで投手18〜20人・野手8人の球団ができた（控えの野手が居ないので
      //    同じ8人が毎日出て疲労が溜まり続け、チーム打率.115・10勝105敗）
      const group = rosterGroup(candidate.position);
      const over = (rosterCounts[group] ?? 0) - (targets[group] ?? Infinity);
      if (over >= 0) candidate.valueScore -= 20 + 20 * over;
    }
  });

  // チーム状況（勝率）に応じた指名方針: 再建中は若手・成長力、優勝狙いは即戦力
  const contendBias = Math.max(-1, Math.min(1, ((teamContext?.winRate ?? 0.5) - 0.5) * 2));
  if (contendBias !== 0) {
    // 年齢補正を含まない「現能力そのもの」（即戦力度の指標）
    const rawOverall = (p) => {
      if (p.position === 'pitcher') {
        const arr = p.pitching?.arsenal || [];
        const bestArs = arr.length ? Math.max(...arr.map(a => a.level || 0)) : 0;
        return ((p.pitching?.velocity || 130) - 130) * 2 * 0.3 + (p.pitching?.control || 0) * 0.25 + (p.pitching?.stamina || 0) / 2 * 0.25 + bestArs * 0.2;
      }
      return (p.batting?.meet || 0) * 0.3 + (p.batting?.power || 0) * 0.25 + (p.physical?.speed || 0) * 0.2 + (p.fielding?.defense || 0) * 0.15 + (p.physical?.arm || 0) * 0.1;
    };
    scoredCandidates.forEach(candidate => {
      const age = candidate.age || 22;
      if (contendBias < 0) {
        // 再建: 若さ＋成長力を重視、伸びしろの無い年長は敬遠
        const youth = age <= 18 ? 1 : age <= 20 ? 0.7 : age <= 22 ? 0.3 : 0;
        const growth = Math.max(0, (candidate.growthPotential || 1.0) - 1.0) * 2;
        candidate.valueScore += (-contendBias) * (youth * 25 + growth * 25);
        if (age >= 24) candidate.valueScore -= (-contendBias) * 15;
      } else {
        // 優勝狙い: 現能力の高さ（即戦力）＋出来上がった年齢を重視、未完成の若手は敬遠
        const ro = rawOverall(candidate);
        const ready = (age >= 21 && age <= 27) ? 1 : age >= 20 ? 0.5 : 0;
        candidate.valueScore += contendBias * ((ro - 40) * 0.9 + ready * 20);
        if (age <= 18) candidate.valueScore -= contendBias * 20;
      }
    });
  }

  // 球団の好み（オンラインの指導者: 速球派・長打などへの小さな加点。`src/online/coaches.js`）。
  // ⚠ 乱数は引かない（引くと、好みの無い球団まで選ぶ選手が変わる）
  if (typeof teamContext?.bonus === 'function') {
    scoredCandidates.forEach(candidate => {
      candidate.valueScore += teamContext.bonus(candidate) || 0;
    });
  }

  // ランダム要素を加えて各チームの個性を出す（±8pt。CPUが好素材を取り逃しにくくし、
  // ユーザーの人力ドラフトとの戦力差を縮める）
  scoredCandidates.forEach(candidate => {
    candidate.valueScore += (Math.random() - 0.5) * 16;
  });

  // スコアが高い順にソート
  scoredCandidates.sort((a, b) => b.valueScore - a.valueScore);

  // デバッグログ（トップ5を表示）
  if (scoredCandidates.length > 0) {
    // (debug logging removed)
  }

  return scoredCandidates[0];
}

/**
 * 新規参入チーム用のロスター（24人）を自動生成
 * 既存リーグの平均的な戦力の選手を生成し、AIドラフトで選出
 * @param {number} year - 現在の年度
 * @param {number} rosterSize - ロスターサイズ（デフォルト24）
 * @returns {Array} 選手配列
 */
/**
 * 新規参入チームのロスターを一括生成する。
 *
 * ⚠ **リーグの格（`independentLeagueRank`）を必ず渡すこと**。渡さないと
 *    `applyLeagueLevelShift` が `!rank` で素通りし、**どのリーグに入っても
 *    Aリーグ相当の選手**が生成される。実測（スタメン野手のミート+パワー）:
 *      初回トライアウト A 106.7 / B 84.0 / C 64.2 / D 50.1
 *      エキスパンション（ランクなし） 103.3  ← Cリーグなら +39 の格差
 *    ランクを渡せば 30人から24人を取る形のままでも既存チームと揃う
 *    （A で 103.3 対 106.7）。
 */
export function generateExpansionRoster(year = 1, rosterSize = 24, independentLeagueRank = null) {
  const candidates = generateTryoutCandidates(year, 1, true, independentLeagueRank);
  const roster = [];
  const remaining = [...candidates];

  // 必須ポジションを先に確保
  const requiredPositions = [
    'catcher', 'catcher', 'second', 'short', 'first', 'third', 'left', 'center', 'right'
  ];
  for (const reqPos of requiredPositions) {
    if (roster.length >= rosterSize) break;
    const posPool = remaining.filter(p => p.position === reqPos);
    if (posPool.length > 0) {
      posPool.sort((a, b) => (b.batting.meet + b.batting.power + b.fielding.defense) - (a.batting.meet + a.batting.power + a.fielding.defense));
      const pick = posPool[0];
      const idx = remaining.findIndex(c => c.id === pick.id);
      if (idx >= 0) remaining.splice(idx, 1);
      roster.push(pick);
    }
  }

  for (let i = roster.length; i < rosterSize && remaining.length > 0; i++) {
    const pick = selectPlayerForAI(remaining, roster);
    if (!pick) break;
    const idx = remaining.findIndex(c => c.id === pick.id);
    if (idx >= 0) remaining.splice(idx, 1);
    roster.push(pick);
  }

  return roster;
}
