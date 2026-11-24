// ============================================================
// sim-harness ドラフト検証用の合成ワールド構築
//
// 実物の processNPBDraft をそのまま呼ぶために、各ソース(高校/大学/社会人/
// クラブ/独立)の候補を実ジェネレーターで用意する。
//
// 【設計意図】クラブチームの「過剰指名」バグは、クラブの初期能力スケールが
// 高すぎることに起因する（実際に修正されてきた: 都市対抗優勝防止・成長式調整・
// 年最大6人制限）。正しくスケールされていれば、新規生成のクラブ選手は素材が
// 低く draft にほぼ乗らない（設計目標: クラブからのプロ輩出は年約2名）。
// よって「新規ロスターでのクラブ指名シェア」を監視すれば、クラブ初期能力を
// 引き上げるような回帰を直接踏み抜ける。多年次の discipline 成長ダイナミクスは
// 別途プログレッション・ハーネス(将来)の領分とする。
// ============================================================

import { SRC } from './bootstrap.mjs';

const { generateHighSchoolClass, enrollInUniversity, processUniversityYear } =
  await import(SRC + '/season/universityPool.js');
const { highSchoolPool, universityPool, clearUniversityPool, clearHighSchoolPool } =
  await import(SRC + '/state/schoolPools.js');
const { generateCorporateRoster } = await import(SRC + '/corporate/corporateInit.js');
const { applyCorporatePlayerGrowth } = await import(SRC + '/season/growthSystem.js');
const { processNPBDraft } = await import(SRC + '/season/npbDraft.js');

const UNIV_RANKS = ['S', 'A', 'B', 'C', 'C', 'D'];
const CORP_RANKS = ['A', 'A', 'B', 'B', 'B', 'C', 'C', 'C', 'C', 'D'];
const REP_BY_RANK = { S: 85, A: 65, B: 40, C: 20, D: 5 };

// ドラフト対象年 YEAR の直前(卒業処理前)の合成ワールドを構築し、
// 実物の processNPBDraft を回して結果を返す。
export function runDraft(YEAR = 6, opts = {}) {
  const {
    highSchoolSize = 5000,
    corpTeams = 40,
    clubTeams = 15,
    indieTeams = 26,
    // ⚠ 実ゲームの `distributeHighSchoolGraduates` は毎年 **2230人**を大学へ送る。
    //    560 だと大学プールが実際の1/4しかなく、大学の指名シェアが構造的に
    //    低く出る（母集団が小さいので上位に食い込む人数が足りない）。
    univCohortSize = 2230,
    // 社会人・独立・クラブを何年ぶん育ててから指名するか。
    // ⚠ **0 だと `applyCorporatePlayerGrowth` を一度も呼ばない**。
    //    ロスターを作ってすぐ指名するので、カテゴリ別の成長を変えても
    //    構成比が1%も動かない（実際にこれで空振りした）。
    //    社会人・独立・クラブの構成比を較正するときは必ず 3〜4 を指定すること。
    growYears = 0,
  } = opts;

  clearUniversityPool();
  clearHighSchoolPool();

  // 高校生プール（当年高卒）
  highSchoolPool.players = generateHighSchoolClass(YEAR, highSchoolSize);
  highSchoolPool.year = YEAR;

  // 大学プール: YEAR-4〜YEAR-1 に入学した4学年分を、各年 processUniversityYear で
  // 成長・加齢させる。ドラフト時点で最上級学年(age22相当)が指名対象になる。
  for (let y = YEAR - 4; y <= YEAR - 1; y++) {
    const hs = generateHighSchoolClass(y, Math.round(univCohortSize * 1.25));
    for (const p of hs) p._destinationRank = UNIV_RANKS[Math.floor(Math.random() * UNIV_RANKS.length)];
    enrollInUniversity(hs.slice(0, univCohortSize), y);
    processUniversityYear(y);
  }

  // 社会人・クラブ・独立チーム（新規ロスター）
  const allTeams = {};
  for (let i = 0; i < corpTeams; i++) {
    const rank = CORP_RANKS[i % CORP_RANKS.length];
    allTeams['社' + i] = {
      corporateData: { type: 'corporate', rank, reputation: REP_BY_RANK[rank] },
      players: generateCorporateRoster({ id: 'corp' + i, rank, type: 'corporate' }, YEAR),
    };
  }
  const boostClub = process.env.SIM_HARNESS_BOOST_CLUB === '1';
  for (let i = 0; i < clubTeams; i++) {
    const rank = i % 2 ? 'D' : 'C';
    const players = generateCorporateRoster({ id: 'club' + i, rank, type: 'club' }, YEAR);
    if (boostClub) {
      // クラブ初期能力を故意に引き上げる自己検証モード。過去に修正された
      // 「クラブ過剰指名」バグを模擬し、クラブシェアのトリップワイヤが発火するか確認する。
      for (const p of players) {
        p.age = 22; // 社会人の指名資格(高卒ルート age>=21)を満たす年齢にする

        if (p.pitching) { p.pitching.velocity = (p.pitching.velocity || 130) + 18; p.pitching.control = Math.min(99, (p.pitching.control || 50) + 25); }
        if (p.batting) { p.batting.meet = Math.min(99, (p.batting.meet || 50) + 25); p.batting.power = Math.min(99, (p.batting.power || 40) + 30); }
      }
    }
    allTeams['ク' + i] = {
      corporateData: { type: 'club', rank, reputation: REP_BY_RANK[rank] },
      players,
    };
  }
  for (let i = 0; i < indieTeams; i++) {
    const rank = ['B', 'C', 'C', 'D'][i % 4];
    allTeams['独' + i] = {
      independentLeagueId: 'il' + i,
      corporateData: { type: 'independent', rank, reputation: 20 },
      players: generateCorporateRoster({ id: 'il_' + i, rank, type: 'independent' }, YEAR),
    };
  }

  // === 社会人・独立・クラブを growYears 年ぶん育てる ===
  // 実ゲームは毎年 applyCorporatePlayerGrowth を通るので、それを再現する。
  // 加齢で抜けた分は高卒新人（19歳）で補充し、年齢構成を定常に保つ。
  if (growYears > 0) {
    const intakePool = generateHighSchoolClass(YEAR - growYears, 4000);
    let intakeIdx = 0;
    for (let y = 0; y < growYears; y++) {
      for (const t of Object.values(allTeams)) {
        for (const p of (t.players || [])) {
          p.seasonStats = p.position === 'pitcher'
            ? { pitching: { gamesStarted: 12, gamesRelieved: 8 } }
            : { batting: { atBats: 240 } };
        }
      }
      applyCorporatePlayerGrowth(allTeams);
      for (const t of Object.values(allTeams)) {
        if (!t.players) continue;
        t.players.forEach(p => { p.age = (p.age || 22) + 1; });
        const kept = t.players.filter(p => (p.age || 22) < 30);
        const need = t.players.length - kept.length;
        for (let i = 0; i < need && intakeIdx < intakePool.length; i++) {
          const rookie = JSON.parse(JSON.stringify(intakePool[intakeIdx++]));
          rookie.age = 19;
          kept.push(rookie);
        }
        t.players = kept;
      }
    }
  }

  // 指名前の候補スナップショット。processNPBDraft は指名した選手をプールから
  // 取り除くので、**呼ぶ前に**取らないと「指名された選手」が母集団から消える。
  const candidateSnapshot = [...highSchoolPool.players];
  for (const k of Object.keys(universityPool)) {
    for (const e of (universityPool[k] || [])) candidateSnapshot.push(e.player);
  }
  for (const t of Object.values(allTeams)) {
    for (const p of (t.players || [])) candidateSnapshot.push(p);
  }

  // processNPBDraft は内部で診断用 console.log を多数出すため一時的に抑制する。
  const origLog = console.log;
  console.log = () => {};
  let res;
  try {
    res = processNPBDraft(allTeams, YEAR);
  } finally {
    console.log = origLog;
  }
  const drafted = res.draftedPlayers || [];
  const s = res.draftBySource || {};
  const clubDrafted = drafted.filter(p => p.isClub).length;

  return {
    total: drafted.length,
    // 指名結果そのもの（巡目別の中身を調べる検証で使う）
    picks: drafted,
    // 指名前の全候補（「その道具の上位が指名されたか」の検証で使う）
    candidates: candidateSnapshot,
    bySource: {
      highschool: s.highschool || 0,
      university: s.university || 0,
      corporate: s.corporate || 0,
      independent: s.independent || 0,
    },
    club: clubDrafted,
    eligibleUniversity: countEligibleUniversity(YEAR),
  };
}

// ドラフト時点で指名対象になり得た大学生の数（収集ロジックの回帰検出用）。
function countEligibleUniversity(YEAR) {
  let n = 0;
  for (const k of Object.keys(universityPool)) {
    const ey = parseInt(k);
    for (const e of (universityPool[k] || [])) {
      if ((YEAR - ey) >= 4 || (e.player.age || 0) >= 22) n++;
    }
  }
  return n;
}
