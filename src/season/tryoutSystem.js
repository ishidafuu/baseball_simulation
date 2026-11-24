// ============================================================
// トライアウトシステム - tryoutSystem.js
// 選手獲得システム（年次トライアウト、ドラフト）
// ============================================================

import { releasedPlayersPool, TEAMS_DATA } from '../teams-data.js';
import {
  getHighSchoolTryoutCandidates,
  getHighSchoolEliteTryoutCandidates,
  getHighSchoolToolTryoutCandidates,
  getUniversitySeniorTryoutCandidates,
} from './universityPool.js';
import {
  getUtilityScore,
  RANK_ASC,
  ROSTER_TARGETS,
  rosterGroup,
  rosterCounts as countRoster,
} from '../utils/constants.js';
import { reservePlayerIds } from '../state/playerIds.js';
// 選手1人を作る部品とスカウトコメントは別のファイルに分けた（playerFactory.js の頭の注）
import { createCandidatePlayer } from './playerFactory.js';
import { generateScoutComment } from '../game/scoutComment.js';

// 2年目以降トライアウトの1チームあたり基準受験者数
// 構成比はリーグ注目度(developmentReputation)で変動する（下記 generateTryoutCandidates 参照）:
//   低注目度: 素材型の高校生中心 / 高注目度: 大学卒・元プロ(FA)が集まる
const TRYOUT_TOTAL_PER_TEAM = 10;


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
/**
 * 高校生の受験者のうち、帯の外から来る枠の割合。
 * ⚠ **小さく保つこと**（実測で合わせた値）。逸材枠はDリーグで約5%・Sリーグで9%、
 *    素材枠はどのリーグでも8%。いしだ要望は「9割くらい大学生が強くていい」なので、
 *    これ以上増やすとその釣り合いが崩れる（実測: 逸材枠を12%にすると、受験者全体の
 *    1位が高卒になる年が6割を超えた）。
 */
const HS_ELITE_SHARE = 0.045;
const HS_ELITE_SHARE_BY_RANK = 0.045;
const HS_TOOL_SHARE = 0.08;
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
      // ⚠ 一人用は高校だけ（大学歴は `assignInitialUniversityBackgrounds` などの一人用の仕組みが持つ）
      createCandidatePlayer({ id: nextId(), position: positionBag[i - 1], rank, withUniversity: false }),
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
  // ⚠ 高校生だけ、帯の外から来る2枠を先に取り分ける（いしだ 2026-11-18
  //    「高卒が軒並み大学生より弱い。一部強い高校生や、荒削りな素材型がいてほしい」）。
  //    - 逸材枠: プールの最上位から。**リーグの格で人数が変わる**（格が上がるほど来る）
  //    - 素材枠: 走・肩・球速・体幹のどれかが図抜けた人から。格では変えない（誰も誘わないので、
  //      どのリーグにも同じだけ流れてくる）
  // ⚠ **帯そのものは広げない**。広げると高卒全体が底上げされ、「9割は大学生のほうが
  //    強い」という釣り合いが崩れる。人数で混ぜるだけにする。
  const hsElite = Math.max(1, Math.round(hsCount * (HS_ELITE_SHARE + HS_ELITE_SHARE_BY_RANK * qualityBias)));
  const hsTool = Math.max(1, Math.round(hsCount * HS_TOOL_SHARE));
  const hsRest = Math.max(0, hsCount - hsElite - hsTool);
  const hsS = split(hsRest), uniS = split(uniCount);
  // 多めに引いてから守備位置の群で間引く（プールの評価順に構成比が引きずられるのを断つ）
  const drawHS = (n, bias) => balanceByPosition(getHighSchoolTryoutCandidates(n * TRYOUT_OVERDRAW, bias), n);
  const drawUni = (n, bias) => balanceByPosition(getUniversitySeniorTryoutCandidates(year, n * TRYOUT_OVERDRAW, bias), n);
  // 1. 高校卒業予定
  drawHS(hsS.main, qualityBias).forEach(addCandidate);
  drawHS(hsS.gem, gemBias).forEach(c => { c._gem = true; addCandidate(c); });
  // ⚠ この2枠は**多めに引かない**（`TRYOUT_OVERDRAW` を掛けない）。多めに引くと
  //    最上位が混ざる確率がそのぶん上がり、実測で「受験者の1位が高卒」の年が8割に
  //    なった（引く人数ぶんだけ上へ寄せた抽選をしているため）。守備位置の散らばりは、
  //    逸材枠は人数が少ないので気にせず、素材枠は一芸ごとに順番に取ることで作る。
  getHighSchoolEliteTryoutCandidates(hsElite).forEach(addCandidate);
  getHighSchoolToolTryoutCandidates(hsTool).forEach(addCandidate);
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
    // 野手評価: ミート、パワー、選球眼、走力、守備、肩
    // ⚠ **選球眼も入れる**。入れていなかったので、トライアウトでも戦力外でも選球眼が一度も
    //    選ばれず、10年でリーグの選球眼だけが横ばい（制球は+20）→四球が半分になっていた
    //    （10年の長期シミュ 2026-11-23）
    const meetScore = player.batting.meet;
    const powerScore = player.batting.power;
    const eyeScore = player.batting.eye ?? 40;
    const speedScore = player.physical.speed;
    const defenseScore = player.fielding.defense;
    const armScore = player.physical.arm;

    totalScore = (meetScore * 0.27) + (powerScore * 0.22) + (eyeScore * 0.1) + (speedScore * 0.18) + (defenseScore * 0.14) + (armScore * 0.09);
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
