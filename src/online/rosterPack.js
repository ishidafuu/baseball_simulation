import { createCandidatePlayer } from '../season/playerFactory.js';
import { createSeededRandom } from '../game/rng.js';

// ============================================================
// 初期選手セット。リーグを作ると20セットできて、各球団が1つ選ぶ。
//
// ⚠ **初期編成（360人から希望リストを出す）の置き換え**。開幕前は
//    「どのセットを選ぶか」だけを決める。希望リストの画面はシーズン後の
//    トライアウトで使う。
// ⚠ **同じセットを2球団が使えない**。選手のidと名前が重複して、
//    記録がどちらの選手のものか分からなくなる。
// ⚠ 生成は**シードから決まる**こと。サーバーと再現で違う世界になると、
//    順位も成績も食い違う。
// ============================================================

/** 1セットの構成。⚠ 合計24人（標準の人数 `ROSTER_STANDARD`＝26 より2人少ない。上限 `ROSTER_LIMIT` は28）。足し引きするならここだけ直す */
export const PACK_COMPOSITION = [
  { group: 'pitcher', positions: ['pitcher'], count: 11 },
  { group: 'catcher', positions: ['catcher'], count: 2 },
  {
    group: 'infield',
    positions: ['first', 'second', 'third', 'short'],
    count: 5,
  },
  { group: 'outfield', positions: ['left', 'center', 'right'], count: 4 },
  // 二刀流は本職ごとに1人ずつ
  { group: 'pitcher', positions: ['pitcher'], count: 1, twoWay: true },
  {
    group: 'fielder',
    positions: ['first', 'second', 'third', 'short', 'left', 'center', 'right'],
    count: 1,
    twoWay: true,
  },
];

/** 格付けの内訳。⚠ 合計は1セットの人数と一致させること */
export const PACK_RANKS = { A: 2, B: 10, C: 12 };

/**
 * 格付けごとの能力の段差（平行移動）。
 *
 * ⚠ **リーグの格の表（`RANK_LEVEL_SHIFT`）を流用しないこと**。あれは
 *    「どのリーグか」の段差で、A=0・B=-8・C=-16。選手の格に当てると
 *    平均が11下がって**ほぼ全員がFランク**になった（実測）。
 *    ここは中心をB（±0）に置き、Aを上、Cを下にする。
 * ⚠ 上限や倍率ではなく**平行移動**。差＝選手の形が保たれるので、
 *    「走力だけ図抜けた選手」がCでも figure として残る。
 */
export const PACK_RANK_SHIFT = { A: 10, B: 0, C: -8 };

export const PACK_SIZE = PACK_COMPOSITION.reduce((n, g) => n + g.count, 0);
export const PACK_COUNT = 20;
/** ⚠ 19〜24歳。独立リーグを目指す若い選手という設定（版1・版2のセット） */
export const PACK_MAX_AGE = 24;

/**
 * 初期セットの年齢の配り方（版3から）。**19〜32歳**。
 *
 * ⚠ **衰える年齢の選手を最初から混ぜる**（いしだ指摘）。19〜24歳だけだと、
 *    開幕時点で全員が伸び盛りで、しかも同時に伸びる。リーグ全体が毎年
 *    上がるだけになり、2〜3年目から能力がインフレして見える
 *    （実測: 制球の平均が1年目49.8→5年目65.7）。
 * ⚠ 伸び盛り（19〜24）を厚いままにして、26歳以上は尾を引く形にする。
 *    上限32歳は「キャンプの成長が止まる年齢（`_stopAge` は最大32）」に合わせた。
 * ⚠ 能力そのものは25歳以上で頭打ち（`generateAbilities` の `ageBonus` が
 *    24歳で上限10に達する）。つまり**歳を取っても強くはならず、衰えだけ早い**。
 */
export const PACK_AGE_WEIGHTS = [
  { age: 19, weight: 12 },
  { age: 20, weight: 8 },
  { age: 21, weight: 8 },
  { age: 22, weight: 14 },
  { age: 23, weight: 12 },
  { age: 24, weight: 10 },
  { age: 25, weight: 8 },
  { age: 26, weight: 7 },
  { age: 27, weight: 6 },
  { age: 28, weight: 5 },
  { age: 29, weight: 4 },
  { age: 30, weight: 3 },
  { age: 31, weight: 2 },
  { age: 32, weight: 1 },
];

/**
 * 選手の「総合」。セット同士の釣り合いを測るためだけに使う。
 *
 * ⚠ **試合の強さではない**。重み付けを変えても試合結果は変わらない
 *    （釣り合いの測り方が変わるだけ）。
 * ⚠ 球速（115〜155）とスタミナ（0〜200）は0〜100ではない。揃えてから足す。
 */
export function packPlayerScore(player) {
  const b = player.batting || {};
  const q = player.pitching || {};
  const bat =
    (b.meet || 0) +
    (b.power || 0) +
    (b.eye || 0) +
    (player.physical?.speed || 0) +
    (player.fielding?.defense || 0);
  const pit =
    Math.max(0, ((q.velocity || 0) - 115) * 2.5) +
    (q.control || 0) +
    (q.stamina || 0) / 2 +
    (q.spinRate || 0);
  // 投手は投球、野手は打撃守備。二刀流は両方を数える（その価値ぶん重くなる）
  const pitcherSide = player.position === 'pitcher' || player.isTwoWay;
  const fielderSide = player.position !== 'pitcher' || player.isTwoWay;
  return (pitcherSide ? pit : 0) + (fielderSide ? bat : 0);
}

/** 1セットぶんの合計。釣り合いの検査もこれを使う */
export const packScore = (players) =>
  players.reduce((sum, p) => sum + packPlayerScore(p), 0);

/**
 * 格付けを24の枠へ**散らす**。
 *
 * ⚠ 枠の順に配ってはいけない。構成は投手から並んでいるので、Aの2人が
 *    どちらも投手になり、**野手にAが1人も居ない**セットになる（実測）。
 *    少ない格から、空いている枠へ等間隔に置く。
 * ⚠ 全セットで同じ並びになること。セットごとに変えると「当たり」ができる。
 */
export function spreadRanks(size, counts) {
  const slots = new Array(size).fill(null);
  let free = [...Array(size).keys()];
  for (const [rank, n] of Object.entries(counts).sort((a, b) => a[1] - b[1])) {
    const step = free.length / n;
    for (let i = 0; i < n; i += 1)
      slots[free[Math.floor(i * step + step / 2)]] = rank;
    free = free.filter((s) => slots[s] === null);
  }
  return slots;
}

/**
 * 20セットを作る（**版1**: 全セットが同じ構成・同じ格の内訳）。
 * 途中参加でセットを待っている人の、版が1のときだけ使う（`packStyle`）。
 *
 * ⚠ **作ってから配る**。セットごとに独立に生成すると、合計が偶然ばらついて
 *    「当たりのセット」ができる。枠ごとに20人まとめて作り、
 *    **強い順に、そのとき合計が一番低いセットへ**配ると構成を保ったまま揃う。
 * ⚠ 蛇行（1→20→1→20…）では足りない。実測で開きが7.2%残った
 *    （枠ごとの強弱の幅が大きく、向きを変えるだけでは埋まらない）。
 *    走っている合計を見て配ると 1% 未満になる。
 */
function generateFixedPacks(seed, count) {
  const packs = Array.from({ length: count }, () => []);
  let nextId = seed * 1000;
  const ranks = spreadRanks(PACK_SIZE, PACK_RANKS);
  let rankCursor = 0;
  for (const slot of PACK_COMPOSITION) {
    for (let i = 0; i < slot.count; i += 1) {
      const rank = ranks[rankCursor];
      rankCursor += 1;
      // この枠ぶんを全セット分まとめて作る
      const batch = Array.from({ length: count }, () => {
        const position =
          slot.positions[Math.floor(Math.random() * slot.positions.length)];
        return createCandidatePlayer({
          id: (nextId += 1),
          position,
          rank,
          levelShift: PACK_RANK_SHIFT[rank],
          maxAge: PACK_MAX_AGE,
          isTwoWay: slot.twoWay === true ? true : false,
        });
      });
      // ⚠ 強い順に、合計の低いセットから配る。同点はセット番号で決める
      //    （実行のたびに配り先が変わらないように）
      batch.sort(
        (a, b) => packPlayerScore(b) - packPlayerScore(a) || a.id - b.id,
      );
      const order = packs
        .map((players, index) => ({ index, total: packScore(players) }))
        .sort((a, b) => a.total - b.total || a.index - b.index);
      batch.forEach((player, i) => packs[order[i].index].push(player));
    }
  }
  return packs.map((players, index) => ({
    id: `pack-${index + 1}`,
    name: `セット${index + 1}`,
    players,
  }));
}

// ------------------------------------------------------------
// 版2: セットごとに**構成と格の内訳を変える**（いしだ指摘: 固定だと悩みどころが
// 無い。ランダムの方が面白い）。投手厚め／野手厚め、少数精鋭／粒ぞろい…の
// 組み合わせで、どれを取っても損にならないように揃える。
// ------------------------------------------------------------

/**
 * いま新しく作るセットの版。⚠ 作り方を変えたら上げ、古い版の作り方は残す。
 *   3 = 年齢を19〜32歳に広げた（`PACK_AGE_WEIGHTS`）
 *   2 = 構成の型（投手厚め／粒ぞろい…）を入れた
 *   1 = 固定構成
 */
export const PACK_STYLE = 3;
/** 年齢を19〜24歳で配っていた版（途中参加で待っている人のセットを作り直すため残す） */
export const YOUNG_PACK_STYLE = 2;
/** `packStyle` が無い（版1のときに配られた）種の版 */
export const LEGACY_PACK_STYLE = 1;

/**
 * 構成の型。⚠ どれも合計24人。投手は二刀流の投手を足して10人以上、
 *    捕手2人以上、野手（二刀流の野手を除く）9人以上（スタメン8人＋控え）。
 */
// ⚠ **どの型も捕手2・内野5・外野4以上**（どの守備のまとまりにも控えが1人は居る）。
//    控えの居ないまとまりのレギュラーは、疲れても休めずに出続ける
//    （`server/dailyLineup.mjs` の `restTiredFielders` は、守備を組み直しても下限以上で組めるときだけ休ませる）。
//    外野3人の型を作ったら、通年の検査（`check:online:season`）で中堅手が
//    疲労471まで積み上がった。厚みの違いは投手と野手の人数の差で出す。
export const PACK_SHAPES = [
  {
    id: 'standard',
    label: '標準',
    pitcher: 11,
    catcher: 2,
    infield: 5,
    outfield: 4,
    twoWayPitcher: 1,
    twoWayFielder: 1,
  },
  {
    id: 'pitching',
    label: '投手厚め',
    pitcher: 12,
    catcher: 2,
    infield: 5,
    outfield: 4,
    twoWayPitcher: 1,
    twoWayFielder: 0,
  },
  {
    id: 'hitting',
    label: '野手厚め',
    pitcher: 9,
    catcher: 2,
    infield: 6,
    outfield: 5,
    twoWayPitcher: 1,
    twoWayFielder: 1,
  },
  {
    id: 'twoWay',
    label: '二刀流',
    pitcher: 9,
    catcher: 2,
    infield: 5,
    outfield: 4,
    twoWayPitcher: 2,
    twoWayFielder: 2,
  },
  {
    id: 'catcher',
    label: '捕手3人',
    pitcher: 10,
    catcher: 3,
    infield: 5,
    outfield: 4,
    twoWayPitcher: 1,
    twoWayFielder: 1,
  },
];

/**
 * 格の内訳の型。⚠ **格の点（A=3・B=2・C=1）の合計をどれも38にする**。
 *    段差が等間隔（`PACK_RANK_SHIFT_V2`）なので、点の合計が同じなら
 *    平均の段差も同じ＝どの型も力の総量は同じで、配り方だけが違う。
 */
export const PACK_RANK_PATTERNS = [
  { id: 'standard', label: 'バランス', ranks: { A: 2, B: 10, C: 12 } },
  { id: 'elite', label: '少数精鋭', ranks: { A: 4, B: 6, C: 14 } },
  { id: 'even', label: '粒ぞろい', ranks: { A: 0, B: 14, C: 10 } },
  { id: 'star', label: '大黒柱', ranks: { A: 1, B: 12, C: 11 } },
  { id: 'core', label: '主力3人', ranks: { A: 3, B: 8, C: 13 } },
];

/**
 * 版2の格の段差。⚠ **等間隔にすること**（A−B＝B−C）。等間隔でないと、
 *    点の合計が同じでも型によって平均の段差がずれ、少数精鋭が得になる。
 *    中心のBは版1と同じ±0。
 */
export const PACK_RANK_SHIFT_V2 = { A: 8, B: 0, C: -8 };

const FIELD = ['first', 'second', 'third', 'short', 'left', 'center', 'right'];
/** 構成の型の項目 → 守備位置・二刀流 */
const SHAPE_GROUPS = [
  ['pitcher', ['pitcher'], false],
  ['twoWayPitcher', ['pitcher'], true],
  ['catcher', ['catcher'], false],
  ['infield', ['first', 'second', 'third', 'short'], false],
  ['outfield', ['left', 'center', 'right'], false],
  ['twoWayFielder', FIELD, true],
];

/** 種から決まる並べ替え（Math.random は呼ぶ側で種付きに差し替えてある） */
function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 20セットぶんの型。⚠ 25通りを並べ替えて先頭から取る（同じ型ばかりにならない） */
function pickStyles(count) {
  const combos = PACK_SHAPES.flatMap((shape) =>
    PACK_RANK_PATTERNS.map((pattern) => ({ shape, pattern })),
  );
  const out = [];
  while (out.length < count) out.push(...shuffle(combos));
  return out.slice(0, count);
}

/**
 * 選手の守備のまとまり（構成の型の項目）。⚠ 選手の項目から決める
 * （選手に印を書き足すと、名簿に入ったあとも保存に残る）
 */
export function packGroupOf(player) {
  if (player.isTwoWay)
    return player.position === 'pitcher' ? 'twoWayPitcher' : 'twoWayFielder';
  if (player.position === 'pitcher' || player.position === 'catcher')
    return player.position;
  return ['first', 'second', 'third', 'short'].includes(player.position)
    ? 'infield'
    : 'outfield';
}

/**
 * 枠の種類（釣り合いはこの種類ごとに取る）。
 * ⚠ **守備位置まで含めること**。まとまり（内野・外野）×格だけだと、その種類の
 *    選手を最初に見た枠の守備位置で全員作ってしまい（内野のBが全員一塁手、など）、
 *    三塁手が1人も居ないセットばかりになった。控えが守れないのでレギュラーが休めず、
 *    通年の検査で疲労が470を超えた
 */
export const packSlotType = (player) =>
  `${packGroupOf(player)}:${player.position}:${player.rank}`;

/**
 * 20セットを作る（版2）。
 *
 * 1. セットごとに構成の型と格の型を引き、24の枠を作る。格は枠へ**ランダムに**
 *    置く（Aが投手に固まるセットも、野手に固まるセットもある）。
 * 2. 枠の種類（守備のまとまり×守備位置×格）ごとに、全セットぶんを**まとめて**作る。
 *    少し多めに作り、強すぎ・弱すぎを両端から落とす（人数の少ない種類で
 *    1人の当たり外れがそのまま残らないように）。
 * 3. 強い順に、**その種類の平均からの上振れの合計**が一番低いセットへ配る。
 *    構成が違うセット同士は合計の点では比べられない（投手と野手で物差しが
 *    違う）ので、「同じ枠の平均よりどれだけ上か」で揃える。
 */
function generateStyledPacks(seed, count, ageWeights) {
  const styles = pickStyles(count);
  const slots = styles.map(({ shape, pattern }) => {
    // ⚠ **8つの守備位置をどのセットにも1人ずつ置く**。まとまりの中で守備位置を
    //    くじで決めると、遊撃手や中堅手が居ないセットができ、開幕前の打順作りが
    //    投手や他の位置の選手を勝手にコンバートする（実測: 二刀流の投手が右翼へ）
    const positions = SHAPE_GROUPS.flatMap(([group, list, twoWay]) => {
      const n = shape[group];
      const base =
        group === 'infield' || group === 'outfield' ? list.slice(0, n) : [];
      // ⚠ 内野の控えは**遊撃手か三塁手**から引く。疲れたレギュラーの代役は
      //    守備を組み直して適性60以上で組めるときだけ（`restTiredFielders`）で、一塁手・
      //    二塁手の控えは三塁や遊撃をほとんど守れない（実測: 一塁手で二塁60以上は1割）。
      //    遊撃手は二塁・三塁、三塁手は一塁・遊撃を守れる。一塁は控えの捕手も守れる
      const pool = group === 'infield' ? ['short', 'third'] : list;
      const rest = Array.from(
        { length: n - base.length },
        () => pool[Math.floor(Math.random() * pool.length)],
      );
      return [...base, ...rest].map((position) => ({ position, twoWay }));
    });
    const ranks = shuffle(
      Object.entries(pattern.ranks).flatMap(([rank, n]) =>
        Array.from({ length: n }, () => rank),
      ),
    );
    return positions.map((slot, i) => ({ ...slot, rank: ranks[i] }));
  });
  const need = new Map();
  slots.forEach((list, index) =>
    list.forEach((slot) => {
      const key = packSlotType({ ...slot, isTwoWay: slot.twoWay });
      if (!need.has(key)) need.set(key, { slot, wants: [] });
      need.get(key).wants.push(index);
    }),
  );
  const packs = Array.from({ length: count }, () => []);
  const lift = new Array(count).fill(0);
  let nextId = seed * 1000;
  // ⚠ 作る順は決め打ち（Map の順は枠を作った順なので、種から決まる）
  const batches = [...need.values()].map(({ slot, wants }, order) => {
    const { position, twoWay, rank } = slot;
    const extra = Math.ceil(wants.length / 4) + 2;
    const made = Array.from({ length: wants.length + extra }, () => {
      const player = createCandidatePlayer({
        id: (nextId += 1),
        position,
        rank,
        levelShift: PACK_RANK_SHIFT_V2[rank],
        // ⚠ 版2は19〜24歳のまま。版を上げたら古い作り方は変えない
        //    （途中参加で待っている人のセットは種から作り直すため）
        ...(ageWeights
          ? { ageWeights, maxAge: ageWeights.at(-1).age }
          : { maxAge: PACK_MAX_AGE }),
        isTwoWay: twoWay,
      });
      return { player, score: packPlayerScore(player) };
    });
    made.sort((x, y) => y.score - x.score || x.player.id - y.player.id);
    const top = Math.floor(extra / 2);
    const kept = made.slice(top, top + wants.length);
    const mean = kept.reduce((n, m) => n + m.score, 0) / kept.length;
    const range = kept[0].score - kept[kept.length - 1].score;
    return { wants, kept, mean, range, order };
  });
  // ⚠ **振れ幅の大きい種類から配る**。後に回すと、最後に大きな差が付いたまま
  //    埋め合わせる種類が残らない（実測で開きが2.4%残った）
  batches.sort((x, y) => y.range - x.range || x.order - y.order);
  for (const { wants, kept, mean } of batches) {
    // 配り先の残り（同じセットが2枠欲しいこともある）
    const left = new Map();
    for (const index of wants) left.set(index, (left.get(index) || 0) + 1);
    for (const { player, score } of kept) {
      let best = null;
      for (const [index, n] of left)
        if (
          n > 0 &&
          (best === null ||
            lift[index] < lift[best] ||
            (lift[index] === lift[best] && index < best))
        )
          best = index;
      left.set(best, left.get(best) - 1);
      lift[best] += score - mean;
      packs[best].push(player);
    }
  }
  const order = SHAPE_GROUPS.map(([g]) => g);
  return packs.map((players, index) => {
    const { shape, pattern } = styles[index];
    players.sort(
      (a, b) =>
        order.indexOf(packGroupOf(a)) - order.indexOf(packGroupOf(b)) ||
        a.rank.localeCompare(b.rank) ||
        a.id - b.id,
    );
    return {
      id: `pack-${index + 1}`,
      name: `セット${index + 1}`,
      shape: shape.id,
      pattern: pattern.id,
      feature: `${shape.label}・${pattern.label}`,
      players,
    };
  });
}

/**
 * 20セットを作る。⚠ **版を渡すこと**（途中参加の人のセットは種から作り直すので、
 * 配ったときの版で作らないと中身が変わる）。
 */
export function generateRosterPacks(
  seed,
  { count = PACK_COUNT, style = PACK_STYLE } = {},
) {
  const previous = Math.random;
  Math.random = createSeededRandom(seed);
  try {
    if (style === LEGACY_PACK_STYLE) return generateFixedPacks(seed, count);
    return generateStyledPacks(
      seed,
      count,
      style === YOUNG_PACK_STYLE ? null : PACK_AGE_WEIGHTS,
    );
  } finally {
    Math.random = previous;
  }
}

const packCache = new Map();
/**
 * **読むだけ**の呼び出し用。同じ種のセットを作り直さない。
 *
 * ⚠ 1回作るのに約0.1秒（480人）かかる。途中参加でセットを待っている人の
 *    ビューを作るたび（保存のたびに全員ぶん）と、選ぶ命令の検証のたびに
 *    作り直していた。種から決まるので、同じ種なら同じものを使い回してよい。
 * ⚠ 返した値は**書き換えないこと**（名簿に入れるときは複製する）。
 */
export function rosterPacksFor(seed, style = PACK_STYLE) {
  const key = `${seed}:${style}`;
  if (!packCache.has(key)) {
    if (packCache.size >= 16) packCache.delete(packCache.keys().next().value);
    packCache.set(key, generateRosterPacks(seed, { style }));
  }
  return packCache.get(key);
}

/**
 * 途中参加した人のセット。⚠ `packStyle` が無い人は版1のときに種を配られた人
 * （移行で1を入れてある）。
 */
export const packsForMember = (member) =>
  rosterPacksFor(member.packSeed, member.packStyle ?? LEGACY_PACK_STYLE);

/** 画面に出す要約。⚠ 選ぶのに必要な情報だけ。全選手は別に渡す */
export function packSummary(pack) {
  const counts = { pitcher: 0, catcher: 0, infield: 0, outfield: 0 };
  const ranks = {};
  let twoWay = 0;
  for (const p of pack.players) {
    const group =
      p.position === 'pitcher'
        ? 'pitcher'
        : p.position === 'catcher'
          ? 'catcher'
          : ['first', 'second', 'third', 'short'].includes(p.position)
            ? 'infield'
            : 'outfield';
    counts[group] += 1;
    ranks[p.rank || 'C'] = (ranks[p.rank || 'C'] || 0) + 1;
    if (p.isTwoWay) twoWay += 1;
  }
  const ages = pack.players.map((p) => p.age);
  return {
    id: pack.id,
    name: pack.name,
    // ⚠ 版1のセットには無い（全セットが同じ構成）
    feature: pack.feature || null,
    counts,
    ranks,
    twoWay,
    averageAge:
      Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10,
    score: Math.round(packScore(pack.players)),
  };
}
