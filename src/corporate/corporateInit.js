// ============================================================
// 社会人野球 初期化システム
// チーム選択後の選手生成・スタッフ生成・ゲーム開始処理
// ============================================================
//
// ドラフト指名バランス設計:
//   NPBドラフト全体 ~120名/年、うち社会人出身 ~15%(18名)
//   全300チーム(S:10 A:23 B:32 C:53 D:182)から18-20名前後
//   総選手数 ~6,700名、うちプロ注目 ~457名(6.8%)
//
//   2段階構造:
//   ① プロ注目（スカウトが視察）= スター枠 or 確率覚醒
//   ② ドラフト指名級（実際にNPBが獲る）= スターの中で更にエリート
//
//   期待値:
//     S 10×4.5星 ×20%エリート = ~9名  (注目率12.7%)
//     A 23×2.5星 ×12%         = ~7名  (注目率7.7%)
//     B 32×0.5星 ×6%          = ~1名  (注目率1.9%)
//     C 53チーム  確率覚醒10%   = ~1-2名 (注目率10.0%)
//     D 182チーム 確率覚醒6%   = ~0-1名 (注目率6.0%)
//     合計 ≒ 18-20名
// ============================================================

import { generateTryoutCandidates, selectPlayerForAI } from '../season/tryoutSystem.js';
import { generateScoutComment } from '../game/scoutComment.js';
import { generateRandomPlayerName } from '../data/playerNames.js';
import { taperLow, RANK_ORDER, RANK_DESC } from '../utils/constants.js';
import { generateStaff, STAFF_GRADE_CAP } from './staffData.js';
import { getTeamsByRegion, REGIONS, getAllTeamsEffective } from './corporateTeamsData.js';
import { initializeWorld, WORLD_DATA } from './worldData.js';
import { TEAMS_DATA, clearReleasedPlayersPool, initializeAllPitchingRotations } from '../teams-data.js';
import { reservePlayerIds } from '../state/playerIds.js';
import { INDEPENDENT_LEAGUES, ALL_INDEPENDENT_LEAGUE_IDS } from './independentLeagueData.js';
import { generateFullSeasonSchedule } from '../season/scheduleGenerator.js';
import { initializeStandings, compareStandings } from '../season/seasonManager.js';
import { initializeUniversityLeagues } from '../university/universityLeagueManager.js';
import { UNIVERSITY_TEAMS } from '../university/universityTeamsData.js';
import { seedInitialUniversityClasses, warmUpPlayerPipeline } from '../season/universityPool.js';
import { universityPool, clearUniversityPool, clearHighSchoolPool } from '../state/schoolPools.js';
import { assignInitialUniversityBackgrounds } from '../university/universityPipeSystem.js';
import { UNIVERSITY_REGIONS } from '../university/universityTeamsData.js';

// ============================================================
// ランク別チーム構成
// 独立リーグ ≒ A～Cの範囲
// ============================================================

const RANK_CONFIG = {
  S: {
    teamOffset: 12,        // 社会人強豪は独立リーグより大幅に上
    starCount: [4, 5],     // プロ注目選手（スカウトが視察するレベル）
    starBoost: [12, 18],   // 注目選手の能力追加（確実に頭一つ抜ける）
    starGrowth: 0.10,
    eliteChance: 0.22,     // 注目選手のうち22%が真のドラフト候補
    eliteBoost: [10, 15],  // エリートへの追加ブースト
    eliteGrowth: 0.15,
  },
  A: {
    teamOffset: 7,
    starCount: [2, 3],
    starBoost: [10, 16],
    starGrowth: 0.08,
    eliteChance: 0.12,
    eliteBoost: [10, 15],
    eliteGrowth: 0.13,
  },
  B: {
    teamOffset: 4,         // 独立リーグ平均より上
    starCount: [0, 1],
    starBoost: [8, 14],
    starGrowth: 0.06,
    eliteChance: 0.06,
    eliteBoost: [10, 15],
    eliteGrowth: 0.10,
    standoutCount: [1, 2],   // Sランク級の突出選手
    standoutTargetRank: 'S',
  },
  C: {
    teamOffset: 1,
    starCount: [0, 0],
    proChance: 0.10,       // 25人×10% ≈ 2.5人/チーム がプロ注目レベルに
    proBoost: [10, 16],
    proGrowth: 0.08,
    standoutCount: [1, 2],   // Aランク級の突出選手
    standoutTargetRank: 'A',
  },
  D: {
    teamOffset: -3,
    starCount: [0, 0],
    proChance: 0.06,       // 20人×6% ≈ 1.2人/チーム（クラブチームからプロ輩出もある）
    proBoost: [8, 14],
    proGrowth: 0.06,
    standoutCount: [1, 2],   // Bランク級の突出選手
    standoutTargetRank: 'B',
  },
};

// 独立リーグ専用設定（社会人より二段下の能力帯）
// 現実: 独立→NPBは年5-10名、最高でドラフト2位（10年に1人）、大半は育成〜5位
// 初期能力を大幅に抑え、シーズン中のfame蓄積＋成長でドラフト下位候補に浮上する設計
const INDEPENDENT_RANK_CONFIG = {
  B: {
    teamOffset: -1,
    starCount: [0, 1],
    starBoost: [5, 10],
    starGrowth: 0.04,
    eliteChance: 0.05,
    eliteBoost: [5, 8],
    eliteGrowth: 0.05,
  },
  C: {
    teamOffset: -4,
    starCount: [0, 0],
    starBoost: [4, 8],
    starGrowth: 0.03,
    eliteChance: 0.02,
    eliteBoost: [4, 7],
    eliteGrowth: 0.04,
    proChance: 0.05,
    proBoost: [5, 10],
    proGrowth: 0.04,
  },
  D: {
    teamOffset: -7,
    starCount: [0, 0],
    proChance: 0.03,
    proBoost: [4, 8],
    proGrowth: 0.03,
  },
};

const RANK_STAFF_CONFIG = {
  S: { coach: 4, manager: 2, trainer: 2 },
  A: { coach: 3, manager: 2, trainer: 1 },
  B: { coach: 3, manager: 1, trainer: 1 },
  C: { coach: 2, manager: 1, trainer: 1 },
  D: { coach: 2, manager: 1, trainer: 0 },
};

export const BUDGET_BY_RANK = { S: 25000, A: 22000, B: 19000, C: 16000, D: 13000 };

// ランク×種別ごとのロースターサイズ [min, max]
const ROSTER_SIZE = {
  S: { corporate: [33, 38], club: [28, 33] },
  A: { corporate: [30, 35], club: [25, 30] },
  B: { corporate: [25, 30], club: [22, 27] },
  C: { corporate: [22, 27], club: [19, 23] },
  D: { corporate: [16, 20], club: [13, 17] },
};

// ランク別球速キャップ・最低保証・追加減速（corporateモード用）
// floorは「チームで一番遅い投手」の下限、capは「スター以外の上限」
// D: クラブチーム → 105-133km（技巧派〜本格派まで幅広い）
// C: 育成型 → 112-138km
// B: 中堅 → 120-145km
// A: 強豪 → 125-150km（自然に150km出せる選手も）
// S: 超強豪 → 128-152km（プロ予備軍レベル）
const RANK_VELOCITY_CAP = { S: 152, A: 150, B: 145, C: 138, D: 133 };
const RANK_VELOCITY_FLOOR = { S: 128, A: 125, B: 120, C: 112, D: 105 };
const RANK_VELOCITY_REDUCTION = { S: 0, A: -3, B: -5, C: -8, D: -15 };

// ランク別の投手制球追加補正（teamOffsetだけでは不十分なので投手専用補正）
const RANK_CONTROL_OFFSET = { S: 4, A: 2, B: 0, C: -5, D: -15 };

// ランク別の制球キャップ（社会人野球はプロ未満）
// 通常選手の上限。スター/プロ注目は+8まで許容
// ⚠ S/A を下げてある（旧 78/72）。社会人Sの制球の中央値が 67 と NPB基準（60）を超えていたため
const RANK_CONTROL_CAP = { S: 70, A: 66, B: 62, C: 55, D: 45 };

// ランク別の変化球レベル倍率（Dランクはアマチュアレベル）
const RANK_ARSENAL_MULT = { S: 1.1, A: 1.0, B: 0.85, C: 0.65, D: 0.45 };

// ランク別の打撃能力キャップ（初期生成時）
// 成長してピークでS級ならOKだが、初期生成で85超は非現実的
// ⚠ **打撃はアマの水準に抑える**（`growthSystem` の `AMA_BAT` と同じ理由）。
//    旧値 S72/A66 と倍率そのままでは、社会人Sのスタメン野手の中央値が
//    ミート60/パワー59 から始まり、NPBレギュラー基準（58/55）を超えていた。
//    ソフトキャップなので上振れの逸材（超過分の2〜5割が残る）は出る。
const RANK_BATTING_CAP = { S: 64, A: 60, B: 55, C: 49, D: 43 };
const BAT_LEVEL = 0.88;   // ミート・パワー・選球眼だけに掛ける水準

// ランク別の初期注目度（0-100）
// 注目度が高い → スカウト成功率UP、企業資金UP、優秀な選手が集まる
// ⚠ オンラインの階層リーグからも使う（`applyIndependentRank`）。表を二重に持たない
export const RANK_INITIAL_REPUTATION = { S: 85, A: 65, B: 40, C: 20, D: 5 };

// ============================================================
// Eloランキングスコア（FIFAランキング方式）
// rankingScore: 試合結果に基づく加算型スコア（0-100上限の reputation とは独立）
// 式: ΔP = I × (W - We), We = 1 / (10^(-(self - opp)/400) + 1)
// ============================================================
export const INITIAL_RANKING_SCORE = { S: 1200, A: 1050, B: 900, C: 750, D: 600 };
const ELO_DIVISOR = 400;
const ELO_CLAMP_MIN = 100;
const ELO_CLAMP_MAX = 2000;

// 試合重要度係数（I）
// ランクの帯。**ここが唯一の定義**。
// ⚠ `TeamRankingScreen` にも同じ表がコピーされていて、片方だけ直した結果
//    画面には「上位5% / 6-20% / …」と旧い帯が出ていた。表を二重に作らないこと。
export const RANK_BAND_CUM = { S: 0.04, A: 0.12, B: 0.28, C: 0.56 };
export const RANK_BAND_LABEL = { S: '上位4%', A: '5-12%', B: '13-28%', C: '29-56%', D: '下位44%' };
export const buildRankBands = (total) => ([
  { rank: 'S', end: Math.max(1, Math.round(total * RANK_BAND_CUM.S)) },
  { rank: 'A', end: Math.max(2, Math.round(total * RANK_BAND_CUM.A)) },
  { rank: 'B', end: Math.max(3, Math.round(total * RANK_BAND_CUM.B)) },
  { rank: 'C', end: Math.max(4, Math.round(total * RANK_BAND_CUM.C)) },
  { rank: 'D', end: total },
]);
/** スコア降順に並んだ配列へランクを割り当てる（UIの暫定ランキングと共有） */
export const assignRankByPercentile = (entries, setRank = (e, r) => { e.rank = r; }) => {
  const bands = buildRankBands(entries.length);
  let bandIdx = 0;
  entries.forEach((e, i) => {
    while (bandIdx < bands.length - 1 && i >= bands[bandIdx].end) bandIdx++;
    setRank(e, bands[bandIdx].rank);
  });
};

const ELO_I = {
  regular: 50,      // 社会人レギュラーシーズン（シーズン全体を1単位として計算）
  league: 40,       // 大学・独立リーグ（春・秋それぞれ）
  tournament: 40,   // 社会人全国大会・独立GC（1試合あたり基礎値、後半戦ほど上昇）
  uniNational: 35,  // 大学全国大会（1試合あたり基礎値）
  gcChampion: 40,   // 独立グランドCS優勝（全国王座の栄誉）
  gcRunnerUp: 18,   // 独立グランドCS準優勝
  proDrafted: 15,   // プロ輩出1名あたり（育成実績はチームの格を直接押し上げる）
  // ⚠ **地域大会・都市対抗予選・クラブ選手権が一度も計上されていなかった**。
  //    低ランクのチームのシーズンはこの3つで出来ているので、
  //    「何をやってもランクが動かない」状態になっていた（実測: クラブ208チームの
  //    rankingScore は4年間で相異なる値が3〜5個しか無く、動く経路はプロ輩出+15 だけ）。
  //    全国大会より格は下なので重みは小さくする。
  qualifier: 20,    // 地域大会・都市対抗地区予選（1試合あたり基礎値）
  clubNational: 30, // クラブ選手権（クラブチームにとっての全国大会）
};

// リーグ最終順位ボーナス（優勝を明確に評価し、勝ち続ければ数年で昇格できるようにする）。
// 期待勝率ベースのElo変動(±10前後/年)だけでは、弱小リーグで優勝しても昇格が遅すぎるため加算する。
const finishBonus = (pos) => pos === 1 ? 30 : pos === 2 ? 15 : pos === 3 ? 6 : 0;
// 順位ボーナスを標準的な順位表配列(team/winRate/wins)に適用する
const applyFinishBonus = (rows, addDelta, scoreMap) => {
  if (!Array.isArray(rows) || rows.length < 2) return;
  const sorted = [...rows].sort((a, b) => (b.winRate || 0) - (a.winRate || 0) || (b.wins || 0) - (a.wins || 0));
  sorted.forEach((st, i) => {
    if (scoreMap[st.team] === undefined) return;
    const games = (st.wins || 0) + (st.losses || 0) + (st.draws || 0);
    if (games === 0) return;
    const b = finishBonus(i + 1);
    if (b) addDelta(st.team, b);
  });
};

// 期待勝率 We
const getExpectedWinRate = (selfScore, oppScore) =>
  1 / (Math.pow(10, -(selfScore - oppScore) / ELO_DIVISOR) + 1);

// トーナメントブラケットから勝者・敗者ペアを取得
const getBracketMatchResults = (bracket) => {
  const results = [];
  if (!bracket?.rounds) return results;
  const total = bracket.rounds.length;
  for (let r = 0; r < total; r++) {
    for (const match of bracket.rounds[r]) {
      if (match.winner && match.loser && !match.isBye) {
        results.push({ winner: match.winner, loser: match.loser, roundIdx: r, totalRounds: total });
      }
    }
  }
  return results;
};

let corporatePlayerIdBase = 20000;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// チーム全体のベース補正
// プロ注目/エリートのブースト（投手・野手で異なる）
const applyBoost = (player, boostRange, growthBonus) => {
  const isPitcher = player.position === 'pitcher';
  const boost = randInt(boostRange[0], boostRange[1]);

  if (isPitcher) {
    player.pitching.velocity = clamp(player.pitching.velocity + randInt(3, 7), 100, 155);
    player.pitching.control = clamp(player.pitching.control + boost, 1, 99);
    player.pitching.stamina = clamp(player.pitching.stamina + Math.floor(boost * 0.6), 30, 150);
    player.physical.arm = clamp(player.physical.arm + Math.floor(boost * 0.6), 1, 99);
    if (player.pitching.arsenal) {
      for (const pitch of player.pitching.arsenal) {
        if (pitch.name !== 'ストレート') {
          pitch.level = clamp((pitch.level || 30) + randInt(8, 20), 1, 99);
        }
      }
    }
  } else {
    player.batting.meet = clamp(player.batting.meet + boost, 1, 99);
    player.batting.power = clamp(player.batting.power + Math.floor(boost * 0.85), 1, 99);
    player.batting.eye = clamp(player.batting.eye + Math.floor(boost * 0.8), 1, 99);
    // 走力はブーストしない（生まれ持った身体能力）
    player.fielding.defense = clamp(player.fielding.defense + Math.floor(boost * 0.6), 1, 99);
    player.physical.arm = clamp(player.physical.arm + Math.floor(boost * 0.5), 1, 99);
  }
  // 成長力はブーストしない（生まれ持った素質）
};

const adjustCorporateAge = (player, isIndependent = false) => {
  const roll = Math.random();
  let targetAge;
  if (isIndependent) {
    // 独立リーグ: 若手中心（19-29）
    if (roll < 0.25) targetAge = 19 + Math.floor(Math.random() * 2);      // 19-20 (25%) HS直行組
    else if (roll < 0.50) targetAge = 21 + Math.floor(Math.random() * 2); // 21-22 (25%) 短大・早期転向
    else if (roll < 0.70) targetAge = 23 + Math.floor(Math.random() * 2); // 23-24 (20%) 大学卒・社会人落ち
    else if (roll < 0.85) targetAge = 25 + Math.floor(Math.random() * 2); // 25-26 (15%)
    else if (roll < 0.95) targetAge = 27 + Math.floor(Math.random() * 2); // 27-28 (10%)
    else targetAge = 29 + Math.floor(Math.random() * 2);                  // 29-30 (5%)
  } else {
    // 社会人: 幅広い年齢層（22-34）
    if (roll < 0.10) targetAge = 22 + Math.floor(Math.random() * 2);      // 22-23 (10%)
    else if (roll < 0.30) targetAge = 24 + Math.floor(Math.random() * 2); // 24-25 (20%)
    else if (roll < 0.55) targetAge = 26 + Math.floor(Math.random() * 2); // 26-27 (25%)
    else if (roll < 0.75) targetAge = 28 + Math.floor(Math.random() * 2); // 28-29 (20%)
    else if (roll < 0.88) targetAge = 30 + Math.floor(Math.random() * 2); // 30-31 (13%)
    else if (roll < 0.96) targetAge = 32 + Math.floor(Math.random() * 2); // 32-33 (8%)
    else targetAge = 34;                                                    // 34    (4%)
  }
  player.age = Math.max(player.age, targetAge);
};

// 社会人/独立リーグチームの選手を生成（ランク×種別でロースターサイズが変動）
export const generateCorporateRoster = (teamDef, year = 1, sizeOverride = null) => {
  const rank = teamDef.rank || 'C';
  const type = teamDef.type || 'corporate';
  const isIndependent = String(teamDef.id || '').startsWith('il_');
  const cfg = (isIndependent ? INDEPENDENT_RANK_CONFIG[rank] : null) || RANK_CONFIG[rank] || RANK_CONFIG.C;
  const sizeRange = ROSTER_SIZE[rank]?.[type] || ROSTER_SIZE.C.corporate;
  const rosterSize = sizeOverride ?? randInt(sizeRange[0], sizeRange[1]);

  // 候補者数をロースターの1.5倍以上確保
  const candidateTeams = Math.max(2, Math.ceil(rosterSize / 25));
  const candidates = generateTryoutCandidates(year, candidateTeams, true);

  const nextId = reservePlayerIds(corporatePlayerIdBase + 1000);
  candidates.forEach(p => { p.id = nextId(); });
  corporatePlayerIdBase = candidates.at(-1)?.id || corporatePlayerIdBase;

  // 独立リーグは球速・制球・変化球すべて社会人より低い
  const IL_VEL_CAP = { B: 145, C: 138, D: 131 };
  const IL_VEL_FLOOR = { B: 120, C: 114, D: 108 };
  const IL_VEL_REDUCTION = { B: -5, C: -9, D: -16 };
  const IL_CONTROL_OFFSET = { B: -3, C: -7, D: -16 };
  const IL_CONTROL_CAP = { B: 63, C: 53, D: 43 };
  const IL_ARSENAL_MULT = { B: 0.78, C: 0.62, D: 0.42 };

  const velReduction = (isIndependent ? IL_VEL_REDUCTION[rank] : null) ?? (RANK_VELOCITY_REDUCTION[rank] || 0);
  const velCap = (isIndependent ? IL_VEL_CAP[rank] : null) ?? (RANK_VELOCITY_CAP[rank] || 155);
  const velFloor = (isIndependent ? IL_VEL_FLOOR[rank] : null) ?? (RANK_VELOCITY_FLOOR[rank] || 120);
  const controlOffset = (isIndependent ? IL_CONTROL_OFFSET[rank] : null) ?? (RANK_CONTROL_OFFSET[rank] || 0);
  const controlCap = (isIndependent ? IL_CONTROL_CAP[rank] : null) ?? (RANK_CONTROL_CAP[rank] || 65);
  const arsenalMult = (isIndependent ? IL_ARSENAL_MULT[rank] : null) ?? (RANK_ARSENAL_MULT[rank] || 1.0);

  // ランク別能力スケーリング（乗算式）
  // キャップ付近に集中しないよう、スケール係数はキャップの60-70%あたりを中央に設定
  // S: 中央45前後(cap72), A: 中央42(cap66), B: 中央37(cap60), C: 中央32(cap52), D: 中央27(cap45)
  const RANK_SCALE = { S: 0.95, A: 0.88, B: 0.80, C: 0.70, D: 0.58 };
  const INDEPENDENT_RANK_SCALE = { B: 0.71, C: 0.61, D: 0.51 };
  const scale = (isIndependent ? INDEPENDENT_RANK_SCALE[rank] : null) || RANK_SCALE[rank] || 0.70;

  // 三角分布ジッター（2つのrandIntの合算で中央寄り正規分布に近似）
  const scaleAndJitter = (val, jitter = 5) => {
    const j = randInt(-jitter, jitter) + randInt(-jitter, jitter);
    return clamp(Math.round(val * scale) + j, 1, 99);
  };

  // ============================================================
  // 「実在しない水準」だけを畳む（`taperLow`）
  //
  // ⚠ **倍率スケール（RANK_SCALE 0.58〜0.95）は左の裾を0へ引きずる**。
  //    守備30の候補が D ランクでは 17、守備10なら 6 になり、実測で
  //    社会人・独立の野手の約1割が**守備20未満＝小学生以下**だった
  //    （能力値の水準: 20=小学生 / 30=中学生 / 40=高校生 / 50=大学生 / 60=プロ）。
  //    走力8・肩7・制球1 のように「走れない・投げられない・ストライクが入らない」
  //    選手がチームに載っていた。
  //
  // ⚠ **`clamp` で下限を切ってはいけない**。平均が押し上がってリーグの較正が動く
  //    （守備で試算すると clamp(28) は平均 +2.3）。境より下だけを境に向かって
  //    圧縮すれば、**中央値と99%点は完全に不変**のまま最小値だけが上がる（平均 +0.9）。
  //
  // ⚠ 対象は **全員が必ずやる身体動作**（守る・走る・投げる）に限る。
  //    ミート・パワー・選球眼・走塁・バント・**制球**には入れない——
  //    「守備の名手で打てない」「ノーコンだが速い」という一芸型を潰してしまうため。
  // ⚠ 実際に制球へ入れたら **防御率 -0.27 / BB/9 -0.51** と実害が出た。
  //    制球は捨ててよい能力（ノーコン速球派は成立する）なので対象外にしてある。
  // `taperLow` は utils/constants.js に一本化してある（高校生プールと共有）

  candidates.forEach(p => {
    p.batting.meet = scaleAndJitter(p.batting.meet * BAT_LEVEL, 6);
    p.batting.power = scaleAndJitter(p.batting.power * BAT_LEVEL, 6);
    p.batting.eye = scaleAndJitter(p.batting.eye * BAT_LEVEL, 5);
    p.batting.steal = scaleAndJitter(p.batting.steal, 5);
    // 走力・体力・回復はランクに依存しない（生まれ持った身体能力）
    p.physical.speed = taperLow(clamp(p.physical.speed + randInt(-8, 8) + randInt(-5, 5), 1, 99));
    p.physical.arm = taperLow(scaleAndJitter(p.physical.arm, 5));
    p.fielding.defense = taperLow(scaleAndJitter(p.fielding.defense, 5));
    p.physical.bodyStamina = clamp((p.physical.bodyStamina || 50) + randInt(-8, 8) + randInt(-5, 5), 15, 99);
    p.physical.recovery = clamp((p.physical.recovery || 50) + randInt(-8, 8) + randInt(-5, 5), 15, 99);

    adjustCorporateAge(p, isIndependent);

    if (p.position === 'pitcher') {
      // 球速: ランク補正 + 個人差（三角分布 -12〜+12）
      const velJitter = randInt(-6, 6) + randInt(-6, 6);
      const rawVel = p.pitching.velocity + velReduction + velJitter;
      // ソフトキャップ: キャップ超過分を50-80%カットして自然な分布に
      if (rawVel > velCap) {
        const velExcess = rawVel - velCap;
        p.pitching.velocity = clamp(velCap + Math.round(velExcess * (0.2 + Math.random() * 0.3)), velFloor, velCap + 3);
      } else {
        p.pitching.velocity = clamp(rawVel, velFloor, velCap);
      }
      // 制球: ランク補正 + 個人差（三角分布 -10〜+10）
      const ctrlJitter = randInt(-5, 5) + randInt(-5, 5);
      const rawCtrl = p.pitching.control + controlOffset + ctrlJitter;
      if (rawCtrl > controlCap) {
        const ctrlExcess = rawCtrl - controlCap;
        p.pitching.control = clamp(controlCap + Math.round(ctrlExcess * (0.2 + Math.random() * 0.3)), 1, controlCap + 3);
      } else {
        p.pitching.control = clamp(rawCtrl, 1, controlCap);
      }
      // 変化球: ランク倍率 + 個人差
      if (p.pitching.arsenal) {
        for (const pitch of p.pitching.arsenal) {
          if (pitch.name !== 'ストレート' && pitch.type !== 'straight') {
            const arsenalJitter = randInt(-10, 10);
            pitch.level = clamp(Math.round(pitch.level * arsenalMult) + arsenalJitter, 5, 99);
          }
        }
      }
    } else {
      p.pitching.velocity = clamp(p.pitching.velocity + velReduction, 100, velCap);
    }

    // 10%: 一芸特化選手（ひとつの分野だけ突出）
    if (Math.random() < 0.10) {
      if (p.position === 'pitcher') {
        const roll = Math.random();
        if (roll < 0.35) {
          p.pitching.velocity = clamp(p.pitching.velocity + randInt(5, 10), velFloor, velCap + 5);
        } else if (roll < 0.70) {
          p.pitching.control = clamp(p.pitching.control + randInt(8, 15), 1, controlCap + 5);
        } else {
          if (p.pitching.arsenal) {
            for (const pitch of p.pitching.arsenal) {
              if (pitch.name !== 'ストレート' && pitch.type !== 'straight') {
                pitch.level = clamp(pitch.level + randInt(10, 20), 5, 99);
              }
            }
          }
        }
      } else {
        const roll = Math.random();
        const boost = randInt(5, 12);
        if (roll < 0.25) {
          p.batting.meet = clamp(p.batting.meet + boost, 1, 99);
        } else if (roll < 0.50) {
          p.batting.power = clamp(p.batting.power + boost, 1, 99);
        } else if (roll < 0.75) {
          p.physical.speed = clamp(p.physical.speed + boost, 1, 99);
        } else {
          p.fielding.defense = clamp(p.fielding.defense + boost, 1, 99);
        }
      }
    }
  });

  // 野手にも投球フォームを保証
  const FORMS = ['overhand', 'threeQuarter', 'sidearm', 'submarine'];
  const FORM_WEIGHTS = [45, 40, 10, 5];
  const pickForm = () => {
    const r = Math.random() * 100;
    let cum = 0;
    for (let i = 0; i < FORMS.length; i++) { cum += FORM_WEIGHTS[i]; if (r < cum) return FORMS[i]; }
    return 'overhand';
  };
  candidates.forEach(p => {
    if (!p.pitching.form) p.pitching.form = pickForm();
  });

  const roster = [];
  const remaining = [...candidates];
  const maxPitchers = Math.max(6, Math.min(15, Math.round(rosterSize * 0.4)));

  // 必須ポジションを先に確保: 捕手2、内野手4(二遊間各1)、外野手3
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
    } else {
      // 候補にいない場合、最も近いポジションの選手を転向
      const fielders = remaining.filter(p => p.position !== 'pitcher');
      if (fielders.length > 0) {
        const pick = fielders[Math.floor(Math.random() * fielders.length)];
        pick.position = reqPos;
        // 転向後のメインポジションは100に設定（元のpositionFitnessを引き継ぎつつ上書き）
        if (pick.positionFitness) pick.positionFitness[reqPos] = 100;
        const idx = remaining.findIndex(c => c.id === pick.id);
        if (idx >= 0) remaining.splice(idx, 1);
        roster.push(pick);
      }
    }
  }

  // 投手の最低人数を先に確保する。
  // ⚠ 残りの枠を能力だけで選ぶと野手ばかりになることがあり、D ランクのクラブ（13〜17人）は
  //    約3%が投手1人で始まっていた。その1人がドラフトや移籍で抜けると投手0人になり、
  //    大学モードの2年目に試合が「投手が取得できません」で壊れた（打席数の上限まで回り続ける）
  const minPitchers = Math.min(maxPitchers, rosterSize - roster.length, Math.max(4, Math.round(rosterSize * 0.3)));
  while (roster.filter(p => p.position === 'pitcher').length < minPitchers) {
    const pick = selectPlayerForAI(remaining.filter(p => p.position === 'pitcher'), roster);
    if (!pick) break;
    remaining.splice(remaining.findIndex(c => c.id === pick.id), 1);
    roster.push(pick);
  }

  for (let i = roster.length; i < rosterSize && remaining.length > 0; i++) {
    const pitcherCount = roster.filter(p => p.position === 'pitcher').length;
    let pool = remaining;
    if (pitcherCount >= maxPitchers) {
      pool = remaining.filter(p => p.position !== 'pitcher');
      if (pool.length === 0) pool = remaining;
    }
    const pick = selectPlayerForAI(pool, roster);
    if (!pick) break;
    const idx = remaining.findIndex(c => c.id === pick.id);
    if (idx >= 0) remaining.splice(idx, 1);
    roster.push(pick);
  }

  // S/A/Bランク: スター選手を選出してブースト
  const starCount = randInt(cfg.starCount[0], cfg.starCount[1]);
  if (starCount > 0) {
    const pitchers = roster.filter(p => p.position === 'pitcher');
    const fielders = roster.filter(p => p.position !== 'pitcher');
    const starPitcherCount = Math.min(pitchers.length, Math.max(1, Math.floor(starCount * 0.4)));
    const starFielderCount = starCount - starPitcherCount;

    pitchers.sort((a, b) => (b.pitching.velocity + b.pitching.control) - (a.pitching.velocity + a.pitching.control));
    fielders.sort((a, b) => (b.batting.meet + b.batting.power) - (a.batting.meet + a.batting.power));

    const stars = [];
    for (let i = 0; i < starPitcherCount && i < pitchers.length; i++) {
      applyBoost(pitchers[i], cfg.starBoost, cfg.starGrowth);
      stars.push(pitchers[i]);
    }
    for (let i = 0; i < starFielderCount && i < fielders.length; i++) {
      applyBoost(fielders[i], cfg.starBoost, cfg.starGrowth);
      stars.push(fielders[i]);
    }

    // スターの中からエリート（真のドラフト候補）を抽選
    if (cfg.eliteChance) {
      for (const star of stars) {
        if (Math.random() < cfg.eliteChance) {
          applyBoost(star, cfg.eliteBoost, cfg.eliteGrowth);
        }
      }
    }
  }

  // C/Dランク: 低確率でプロ注目レベルが出現（クラブチームは成長で到達する設計のため除外）
  if (cfg.proChance && cfg.proBoost && type !== 'club') {
    for (const p of roster) {
      if (Math.random() < cfg.proChance) {
        applyBoost(p, cfg.proBoost, cfg.proGrowth || 0.06);
      }
    }
  }

  // B/C/Dランク: 1-2名の突出選手（2ランク上の実力で生成）
  // クラブチームは除外: 初期能力ではなくプロ意識×成長率で数年かけてドラフト候補に成長する設計
  if (cfg.standoutCount && cfg.standoutTargetRank && type !== 'club') {
    const targetRank = cfg.standoutTargetRank;
    const targetScale = RANK_SCALE[targetRank] || 0.80;
    const rescale = targetScale / scale;
    const tgtVelCap = RANK_VELOCITY_CAP[targetRank] || 145;
    const tgtCtrlCap = RANK_CONTROL_CAP[targetRank] || 65;
    const tgtArsenalMult = RANK_ARSENAL_MULT[targetRank] || 1.0;
    const count = randInt(cfg.standoutCount[0], cfg.standoutCount[1]);
    const shuffled = [...roster].sort(() => Math.random() - 0.5);
    const standouts = shuffled.slice(0, count);

    for (const p of standouts) {
      p._standoutRank = targetRank;
      p.batting.meet = clamp(Math.round(p.batting.meet * rescale) + randInt(0, 3), 1, 99);
      p.batting.power = clamp(Math.round(p.batting.power * rescale) + randInt(0, 3), 1, 99);
      p.batting.eye = clamp(Math.round(p.batting.eye * rescale) + randInt(0, 2), 1, 99);
      p.physical.speed = clamp(Math.round(p.physical.speed * rescale) + randInt(0, 2), 1, 99);
      p.fielding.defense = clamp(Math.round(p.fielding.defense * rescale) + randInt(0, 2), 1, 99);
      p.physical.arm = clamp(Math.round(p.physical.arm * rescale) + randInt(0, 2), 1, 99);
      if (p.position === 'pitcher') {
        const velBoost = tgtVelCap - velCap;
        p.pitching.velocity = clamp(p.pitching.velocity + velBoost + randInt(-2, 3), velFloor, tgtVelCap + 3);
        p.pitching.control = clamp(Math.round(p.pitching.control * rescale) + randInt(0, 3), 1, tgtCtrlCap + 5);
        if (p.pitching.arsenal) {
          const multBoost = tgtArsenalMult / arsenalMult;
          for (const pitch of p.pitching.arsenal) {
            if (pitch.name !== 'ストレート' && pitch.type !== 'straight') {
              pitch.level = clamp(Math.round(pitch.level * multBoost) + randInt(2, 8), 5, 99);
            }
          }
        }
      }
      p.growthPotential = clamp((p.growthPotential || 1.0) + 0.10, 0.5, 1.5);
      p.fame = clamp((p.fame || 0) + randInt(5, 15), 0, 100);
    }
  }

  // ソフトキャップ: キャップを超過した分を確率的に削減（上限に張り付かない自然な分布）
  const ctrlMax = controlCap + 8;
  const IL_BATTING_CAP = { B: 55, C: 49, D: 41 };
  const batCap = (isIndependent ? IL_BATTING_CAP[rank] : null) ?? (RANK_BATTING_CAP[rank] || 52);
  const softCap = (val, cap) => {
    if (val <= cap) return val;
    const excess = val - cap;
    const cut = Math.round(excess * (0.5 + Math.random() * 0.3));
    return cap + Math.max(0, excess - cut);
  };
  // ⚠ **経歴を組み立てる前に大学歴を決めること**。以前はこの呼び出しが下の
  //    `careerHistory` ループの**後**にあり、L639 の
  //    `const uniName = p.universityTeamName || p.universityName` が常に undefined で、
  //    **生成された社会人・独立・クラブの選手は1人も `type:'university'` を持たなかった**
  //    （実測 6563人中 0人。`universityTeamId` の方は 56% に付いていたので、
  //     大学パイプだけが動き、経歴とドラフトの大卒判定だけが死んでいた）。
  //    `npbDraft` の「大卒は2年（age<24 は対象外）」がこれで一度も発火していない。
  //    「名前より先に高校を決めること」（`generateHighSchoolPlayer`）と同じ型の順序バグ。
  assignInitialUniversityBackgrounds(roster, { teamRank: rank });

  roster.forEach(p => {
    const pCtrlMax = p._standoutRank ? (RANK_CONTROL_CAP[p._standoutRank] + 8) : ctrlMax;
    const pBatCap = p._standoutRank ? (RANK_BATTING_CAP[p._standoutRank] || batCap) : batCap;
    if (p.position === 'pitcher') {
      p.pitching.control = Math.min(p.pitching.control, pCtrlMax);
    }
    p.batting.meet = softCap(p.batting.meet, pBatCap);
    p.batting.power = softCap(p.batting.power, pBatCap);
    p.batting.eye = softCap(p.batting.eye, pBatCap);
    const batFloor = p.position === 'pitcher' ? 10 : 15;
    p.batting.meet = Math.max(p.batting.meet, batFloor);
    p.batting.power = Math.max(p.batting.power, batFloor);
    p.batting.eye = Math.max(p.batting.eye, batFloor);

    // 独立リーグ: 成長力を抑制（プロに届かなかった選手が大半）
    if (isIndependent) {
      // 独立リーグは「高成長の原石」が集まる場 → キャップを社会人より高く設定
      const gpCap = rank === 'B' ? 1.42 : rank === 'C' ? 1.32 : 1.22;
      p.growthPotential = Math.min(p.growthPotential || 1.0, gpCap);
    }

    p.scoutComment = generateScoutComment(p);
    if (!p.careerHistory) p.careerHistory = [];
    if (p.careerHistory.length === 0) {
      p.careerHistory.push({ type: 'highschool', label: '高校卒' });
    }
    const uniName = p.universityTeamName || p.universityName;
    if (uniName && !p.careerHistory.some(h => h.type === 'university')) {
      p.careerHistory.push({ type: 'university', label: uniName });
    }
    // ⚠ 経歴の type は**そのチームの種別**にすること。クラブ・独立の選手まで
    //    `corporate` で積むと、経歴を見ても「どこで苦労したか」が分からない。
    //    ラベルが無いと `[corporate]undefined` という壊れたチップが出る。
    const originType = teamDef.type === 'club' ? 'club'
      : teamDef.type === 'independent' ? 'independent' : 'corporate';
    const originLabel = teamDef.name || teamDef.displayName || teamDef.id;
    if (originLabel) p.careerHistory.push({ type: originType, label: originLabel });
  });

  // 二刀流選手の保証（1-2人）
  const twoWayCount = roster.filter(p => p.isTwoWay).length;
  if (twoWayCount < 1) {
    const targetCount = Math.random() < 0.5 ? 1 : 2;
    const young = roster
      .filter(p => p.position !== 'pitcher' && p.age <= 25 && !p.isTwoWay)
      .sort((a, b) => (b.physical.arm + b.physical.speed) - (a.physical.arm + a.physical.speed));
    for (let i = 0; i < targetCount && i < young.length; i++) {
      const p = young[i];
      p.isTwoWay = true;
      p.twoWaySubPosition = p.position;
      p.pitching.velocity = clamp(p.pitching.velocity + randInt(5, 15), 120, velCap);
      p.pitching.control = clamp(p.pitching.control + randInt(5, 15), 20, controlCap);
      p.pitching.stamina = clamp(p.pitching.stamina + randInt(10, 30), 50, 120);
      if (!p.pitching.arsenal || p.pitching.arsenal.length < 2) {
        const BREAKING_BALLS = ['スライダー', 'カーブ', 'チェンジアップ', 'フォーク', 'カットボール'];
        const ball1 = BREAKING_BALLS[Math.floor(Math.random() * BREAKING_BALLS.length)];
        let ball2 = BREAKING_BALLS[Math.floor(Math.random() * BREAKING_BALLS.length)];
        while (ball2 === ball1) ball2 = BREAKING_BALLS[Math.floor(Math.random() * BREAKING_BALLS.length)];
        p.pitching.arsenal = [
          { name: 'ストレート', type: 'straight', level: 50 },
          { name: ball1, type: 'breaking', level: randInt(25, 50) },
          { name: ball2, type: 'breaking', level: randInt(20, 40) },
        ];
      }
      if (p.positionFitness) {
        p.positionFitness.pitcher = randInt(30, 60);
      }
    }
  }

  return roster;
};

export const generateInitialStaff = (rank) => {
  const config = RANK_STAFF_CONFIG[rank] || RANK_STAFF_CONFIG.C;
  const maxGrade = STAFF_GRADE_CAP[rank] || 'C';
  const staff = [];
  for (const [role, count] of Object.entries(config)) {
    for (let i = 0; i < count; i++) {
      staff.push(generateStaff(role, null, maxGrade));
    }
  }
  assignInitialUniversityBackgrounds(staff, { universityRate: 0.65, teamRank: rank });
  return staff;
};

// 同地区＋近隣地区からリーグ参加チームを選出

const makeAbbreviation = (name) => {
  if (name.length <= 3) return name;
  if (/^[A-Za-z]/.test(name)) return name.slice(0, 3).toUpperCase();
  return name.slice(0, 3);
};

// ============================================================
// 独立リーグチームの初期化（全4リーグ、ユーザーリーグは除外可）
// ============================================================

export const initializeIndependentLeagues = (excludeLeagueId = null, existingTeamNames = []) => {
  const existingSet = new Set(existingTeamNames);

  for (const leagueId of ALL_INDEPENDENT_LEAGUE_IDS) {
    if (leagueId === excludeLeagueId) continue;

    const leagueDef = INDEPENDENT_LEAGUES[leagueId];
    const teamNames = [];

    for (const teamDef of leagueDef.teams) {
      if (TEAMS_DATA[teamDef.name] || existingSet.has(teamDef.name)) continue;

      const roster = generateCorporateRoster(teamDef, 1);
      const indRank = teamDef.rank || 'C';
      TEAMS_DATA[teamDef.name] = {
        name: teamDef.name,
        abbreviation: teamDef.abbreviation || makeAbbreviation(teamDef.name),
        players: roster,
        pitchingRotation: null,
        independentLeagueId: leagueId,
        corporateData: {
          rank: indRank,
          type: 'independent',
          reputation: RANK_INITIAL_REPUTATION[indRank] || 20,
          rankingScore: INITIAL_RANKING_SCORE[indRank] || 900,
          proDraftCount: 0,
          tournamentWins: 0,
        },
      };
      teamNames.push(teamDef.name);
    }

    const schedule = generateFullSeasonSchedule({
      teams: teamNames,
      gamesPerSeason: leagueDef.gamesPerSeason,
      startDate: { year: 2024, month: 4, day: 1 },
      endDate: { year: 2024, month: 9, day: 30 },
      leagueFormat: leagueDef.leagueFormat || 'single',
      leagueNames: leagueDef.leagueNames,
    });

    WORLD_DATA.independentLeagues[leagueId] = {
      name: leagueDef.name,
      teams: teamNames,
      schedule,
      standings: initializeStandings(teamNames),
      results: [],
    };
  }
};

// 年度移行時に独立リーグのスケジュール・順位表を新年度でリセット
export const resetIndependentLeagueSchedules = (calendarYear) => {
  for (const [leagueId, leagueData] of Object.entries(WORLD_DATA.independentLeagues)) {
    if (!leagueData) continue;
    // プリセット定義が無いリーグ（監督移籍で背景へ回ったカスタムリーグ等）は、
    // 登録時に控えたレギュレーションを使う。ここで弾くと翌年以降シミュが止まる。
    const leagueDef = INDEPENDENT_LEAGUES[leagueId] || leagueData.regulation;
    if (!leagueDef) continue;
    const teams = leagueData.teams;
    if (!teams || teams.length === 0) continue;

    const schedule = generateFullSeasonSchedule({
      teams,
      gamesPerSeason: leagueDef.gamesPerSeason || 60,
      startDate: { year: calendarYear, month: 4, day: 1 },
      endDate: { year: calendarYear, month: 9, day: 30 },
      leagueFormat: leagueDef.leagueFormat || 'single',
      leagueNames: leagueDef.leagueNames,
    });

    leagueData.schedule = schedule;
    leagueData.standings = initializeStandings(teams);
    leagueData.results = [];
  }
};

// ============================================================
// 全234大学チームをTEAMS_DATAに追加（並行世界として全モードで選手追跡・移籍を有効化）
// warmUpPlayerPipeline() 実行後に呼ぶこと。
// universityPool のプレイヤーを各大学チームのロスターに移動し、
// 翌年以降の processUniversityTeamGraduation で正しく卒業処理される。
// ============================================================

const UNI_VELOCITY_CAP_PW = { S: 150, A: 148, B: 143, C: 136, D: 130 };
const UNI_CONTROL_CAP_PW  = { S: 72,  A: 66,  B: 58,  C: 48,  D: 38  };
const UNI_BATTING_CAP_PW  = { S: 68,  A: 62,  B: 55,  C: 47,  D: 40  };
const UNI_GRADE_SIZE_PW   = { S: 14,  A: 12,  B: 10,  C: 8,   D: 6   };

const generateUniversityRosterPW = (def) => {
  const rank = def.rank || 'C';
  const perGrade = UNI_GRADE_SIZE_PW[rank] || 8;
  const fakeDef = { ...def, type: 'corporate', id: `uni_${def.id}` };
  const roster = generateCorporateRoster(fakeDef, 1, perGrade * 4);
  roster.forEach((p, i) => {
    const grade = (i % 4) + 1;
    p.age = 18 + grade;
    p.universityYear = grade;
    p.universityTeamId = def.id;
    p.universityTeamName = def.name;
    if (p.position === 'pitcher') {
      const velCap = UNI_VELOCITY_CAP_PW[rank] || 140;
      const ctrlCap = UNI_CONTROL_CAP_PW[rank] || 50;
      if (p.pitching.velocity > velCap) p.pitching.velocity = velCap + Math.round((p.pitching.velocity - velCap) * 0.3);
      if (p.pitching.control > ctrlCap) p.pitching.control = ctrlCap + Math.round((p.pitching.control - ctrlCap) * 0.3);
    }
    const batCap = UNI_BATTING_CAP_PW[rank] || 50;
    p.batting.meet  = Math.min(p.batting.meet,  batCap + Math.floor(Math.random() * 6));
    p.batting.power = Math.min(p.batting.power, batCap + Math.floor(Math.random() * 6));
    p.batting.eye   = Math.min(p.batting.eye,   batCap + Math.floor(Math.random() * 4));
    p.careerHistory = [{ type: 'highschool', label: '高校卒' }, { type: 'university', year: 1, label: def.name }];
  });
  return roster;
};

const initializeUniversityTeamsForParallelWorld = () => {
  // universityPool プレイヤーを大学チーム名でグループ化
  const teamPlayers = {};
  for (const [enrollYear, entries] of Object.entries(universityPool || {})) {
    if (!entries) continue;
    for (const entry of entries) {
      const teamName = entry.universityTeamName;
      if (!teamName) continue;
      if (!teamPlayers[teamName]) teamPlayers[teamName] = [];
      // 在学年数（WORLD_DATA.year=1 時点）: enrollYear -2 → 4年生 など
      const yearsInUni = (WORLD_DATA.year || 1) - entry.enrollYear;
      entry.player.universityYear = Math.max(1, Math.min(4, yearsInUni + 1));
      entry.player.universityTeamId = entry.universityTeamId || null;
      entry.player.universityTeamName = teamName;
      teamPlayers[teamName].push(entry.player);
    }
  }

  // 使用したプレイヤーをプールから除去（TEAMS_DATA で管理するため二重管理を防止）
  for (const enrollYear of Object.keys(universityPool || {})) {
    const entries = universityPool[enrollYear] || [];
    universityPool[enrollYear] = entries.filter(e => !e.universityTeamName || !teamPlayers[e.universityTeamName]);
    if (!universityPool[enrollYear].length) delete universityPool[enrollYear];
  }

  // 全234大学チームを TEAMS_DATA に追加
  for (const def of UNIVERSITY_TEAMS) {
    if (TEAMS_DATA[def.name]) continue;
    const poolRoster = teamPlayers[def.name] || [];
    const roster = poolRoster.length > 0 ? poolRoster : generateUniversityRosterPW(def);
    TEAMS_DATA[def.name] = {
      name: def.name,
      abbreviation: makeAbbreviation(def.name),
      players: roster,
      pitchingRotation: null,
      universityTeamId: def.id,
      universityData: {
        rank: def.rank,
        region: def.region,
        budget: def.budget || 5000,
        leagueName: (UNIVERSITY_REGIONS.find(r => r.id === def.region)?.name || ''),
        reputation: ({ S: 85, A: 65, B: 40, C: 20, D: 5 }[def.rank] || 20),
        proDraftCount: 0,
        tournamentWins: 0,
      },
    };
  }
};

// ============================================================
// 社会人モードの完全初期化（全チーム＋独立リーグのロスターを生成）
// ============================================================

// ============================================================
// 社会人（企業＋クラブ）全チームの生成 — 3つの初期化経路で共有する
//
// ⚠ **同じ 28行が 社会人 / 独立 / 大学 の3経路にコピペされており、
//    片方にしか無い処理が2種類あった**（実測）:
//
//   | | 社会人 | 独立 | 大学 |
//   |---|---|---|---|
//   | クラブがスタッフを持つ（本来0） | 0 | **208** | **208** |
//   | クラブの予算>0（本来0） | 0 | **208** | **208** |
//   | 同名の改名 | 無し(同名17件) | 無し(10件) | **有り(1件)** |
//
//   クラブは「キャンプも無く指導者も居ない」前提で成長モデルが組まれているのに
//   （CLAUDE.md「クラブチームのプロ意識駆動成長」）、独立・大学モードでは
//   208クラブ全部がスタッフと予算12000を持っていた。
//   **コピペを関数にすれば、この種の食い違いは構造的に起きなくなる。**
// ============================================================

/** 社会人チーム1つぶんの TEAMS_DATA エントリを作る */
const createCorporateTeamEntry = (def) => {
  const name = def.displayName || def.name;
  const roster = generateCorporateRoster(def, 1);
  // ⚠ クラブはスタッフも予算も持たない。3経路のうち社会人モードにしか無かった分岐
  const isClub = def.type === 'club';
  const staff = isClub ? [] : generateInitialStaff(def.rank);
  TEAMS_DATA[name] = {
    name,
    abbreviation: makeAbbreviation(name),
    players: roster,
    pitchingRotation: null,
    corporateTeamId: def.id,
    corporateData: {
      rank: def.rank, region: def.region, city: def.city, type: def.type,
      budget: isClub ? 0 : (BUDGET_BY_RANK[def.rank] || 12000),
      staff,
      reputation: RANK_INITIAL_REPUTATION[def.rank] || 5,
      proDraftCount: 0, tournamentWins: 0, yearlyBudgetBonus: 0,
      tournamentBudgetBonus: 0, sponsors: [],
    },
  };
  return { name, roster, staff };
};

/**
 * 同名の選手を改名する（リリースプール経由で同じ名前が複数チームに入るため）。
 * ⚠ 母集団が約1.6万人・実効の組み合わせが169万通りなので**同名そのものは自然に出る**。
 *    ここで消しているのは「初期化で同時に生まれた同名」だけ。
 */
const dedupeCorporatePlayerNames = (teamNames) => {
  const seenPlayerNames = new Set();
  for (const teamName of teamNames) {
    for (const player of TEAMS_DATA[teamName]?.players || []) {
      if (!player.name) continue;
      if (seenPlayerNames.has(player.name)) {
        let newName = generateRandomPlayerName();
        while (seenPlayerNames.has(newName)) newName = generateRandomPlayerName();
        player.name = newName;
      }
      seenPlayerNames.add(player.name);
    }
  }
};

/**
 * 社会人全チームを TEAMS_DATA に作り、`WORLD_DATA.corporateLeague.teams` へ登録する。
 * @param {string|null} userTeamName 指定するとそのチームを**最初に**作る
 *   （⚠ App.jsx が `Object.keys(TEAMS_DATA)[0]` を自チームとして読むため順序が意味を持つ）
 */
const buildAllCorporateTeams = (userTeamName = null) => {
  const allTeamDefs = getAllTeamsEffective();
  const allTeamNames = [];
  let userRoster = null;
  let userStaff = null;

  const add = (def) => {
    const { name, roster, staff } = createCorporateTeamEntry(def);
    allTeamNames.push(name);
    return { roster, staff };
  };

  if (userTeamName) {
    const userDef = allTeamDefs.find(d => (d.displayName || d.name) === userTeamName);
    if (userDef) {
      const { roster, staff } = add(userDef);
      userRoster = roster;
      userStaff = staff;
    }
  }
  for (const def of allTeamDefs) {
    const name = def.displayName || def.name;
    if (TEAMS_DATA[name]) continue;
    add(def);
  }

  WORLD_DATA.corporateLeague.teams = {};
  for (const name of allTeamNames) {
    WORLD_DATA.corporateLeague.teams[name] = TEAMS_DATA[name];
  }
  dedupeCorporatePlayerNames(allTeamNames);

  return { allTeamNames, userRoster, userStaff };
};

export const initializeCorporateGame = (teamDef) => {
  corporatePlayerIdBase = 20000;

  initializeWorld('corporate', 'corporate');
  Object.keys(TEAMS_DATA).forEach(key => delete TEAMS_DATA[key]);
  clearReleasedPlayersPool();
  // ⚠ 高校生・大学のプールも空にする（前のゲームの高校生が残ると、ウォームアップが
  //    それを引き継いだまま動く。大学モードの初期化だけが空にしていた）
  clearUniversityPool();
  clearHighSchoolPool();

  // 社会人179チーム生成
  const userTeamName = teamDef.displayName || teamDef.name;
  const userRegion = teamDef.region;
  const { allTeamNames, userRoster, userStaff } = buildAllCorporateTeams(userTeamName);

  WORLD_DATA.corporateLeague.userTeam = userTeamName;

  // 独立リーグ4つも生成
  initializeIndependentLeagues(null, allTeamNames);

  // 全チームの投手ローテーション初期化
  initializeAllPitchingRotations();

  // 大学リーグ初期化
  initializeUniversityLeagues(2024);
  // パイプラインウォームアップ: 4年分の高校→ドラフト→進路→大学成長→卒業→社会人補充を事前シミュレート
  // これによりYear2以降のドラフトでも全ソースからバランスよく候補が出る
  warmUpPlayerPipeline(1);
  // 全234大学チームをTEAMS_DATAに追加（並行世界として選手追跡・移籍を有効化）
  initializeUniversityTeamsForParallelWorld();

  return {
    userTeamName, allTeamNames, roster: userRoster, staff: userStaff,
  };
};

// ============================================================
// 独立リーグモードの平行世界初期化
// ユーザーが独立リーグで遊ぶ時に、社会人+他の独立リーグを生成
// ============================================================

export const initializeParallelWorldForIndependent = (userLeagueId, userTeamNames) => {
  initializeWorld('independent', userLeagueId);
  corporatePlayerIdBase = 20000;
  clearUniversityPool();
  clearHighSchoolPool();

  // 社会人チーム全179チーム生成（3経路で共有。クラブのスタッフ・予算と同名の改名もここ）
  const { allTeamNames: corpTeamNames } = buildAllCorporateTeams();

  // ユーザーのリーグ以外の独立リーグを生成
  initializeIndependentLeagues(userLeagueId, [...userTeamNames, ...corpTeamNames]);

  // 大学リーグ初期化
  initializeUniversityLeagues(2024);
  warmUpPlayerPipeline(1);
  // 全234大学チームをTEAMS_DATAに追加
  initializeUniversityTeamsForParallelWorld();
};

// 独立リーグモードの「自リーグ」チームに独立リーグ用のマーカーを付与する。
// 自リーグは initializeNewGame(=通常のチーム生成) で作られ corporateData を持たないため、
// チームランキング(Elo)・注目度・トレードなど独立リーグ系システムから漏れていた。
// リーグの「格」＝所属チームの現ランクの最頻値（同数なら上位ランクを採用）。
// トライアウト受験者の質もこの値でスケールされるため、表示と挙動を一致させる目的で共有する。
/**
 * 独立リーグの球団に**格付けを直に当てる**。
 *
 * ⚠ `ensureUserIndependentLeagueTagged` は既存のプリセット定義と**名前で**
 *    照合するので、定義に無い球団は全部 'D'（最弱）になる。オンラインの
 *    階層リーグは球団名をその場で作るため、全12球団が 'D' で登録されていた。
 *    初期トライアウトの候補の質はこの格付けで決まるので、リーグ全体の選手が
 *    弱くなる（実測でミート43.9→36.8、制球44.5→36.6）。
 */
export const applyIndependentRank = (teamName, rank, leagueId) => {
  const team = TEAMS_DATA[teamName];
  if (!team) return;
  team.independentLeagueId = leagueId || team.independentLeagueId || '__custom__';
  team.corporateData = {
    ...(team.corporateData || {}),
    rank,
    type: 'independent',
    reputation: RANK_INITIAL_REPUTATION[rank] ?? 20,
    rankingScore: INITIAL_RANKING_SCORE[rank] ?? 900,
    proDraftCount: team.corporateData?.proDraftCount || 0,
    tournamentWins: team.corporateData?.tournamentWins || 0,
  };
};

export const getLeagueRankFromTeams = (teamNames) => {
  if (!Array.isArray(teamNames) || teamNames.length === 0) return null;
  const counts = {};
  teamNames.forEach(n => {
    const r = TEAMS_DATA[n]?.corporateData?.rank || TEAMS_DATA[n]?.universityData?.rank;
    if (r) counts[r] = (counts[r] || 0) + 1;
  });
  const ranks = Object.keys(counts);
  if (ranks.length === 0) return null;
  ranks.sort((a, b) => (counts[b] - counts[a]) || (RANK_DESC.indexOf(a) - RANK_DESC.indexOf(b)));
  return ranks[0];
};

// 名前一致でリーグ定義のランクを引く。定義が無い新規カスタム独立リーグは 'D' スタート
// （弱小から勝ち上がって昇格を目指す設計）。既存プリセットは定義のランクを使う。新規/ロード両対応。
export const ensureUserIndependentLeagueTagged = (teamNames, preset) => {
  if (!Array.isArray(teamNames)) return;
  const leagueDef = preset ? INDEPENDENT_LEAGUES[preset] : null;
  for (const name of teamNames) {
    const team = TEAMS_DATA[name];
    if (!team || team.corporateData || team.universityData) continue;
    const def = leagueDef?.teams?.find(t => t.name === name);
    const rank = def?.rank || 'D';
    team.independentLeagueId = preset || '__custom__';
    team.corporateData = {
      rank,
      type: 'independent',
      reputation: RANK_INITIAL_REPUTATION[rank] ?? 20,
      rankingScore: INITIAL_RANKING_SCORE[rank] ?? 900,
      proDraftCount: 0,
      tournamentWins: 0,
    };
  }
};

// 欠落した並行世界チーム（他の独立リーグ・社会人・大学）を静的定義から復旧する。
// 旧バージョンの年度移行バグで並行世界が削除されたセーブを、WORLD_DATAを壊さずに
// 修復するための関数。既存チームはスキップし、欠けているチームだけ再生成する。
// ロスターは新規生成（元の選手は復元不可）だが、背景世界として機能を回復させる。
export const recoverMissingParallelTeams = (userLeagueId) => {
  corporatePlayerIdBase = reservePlayerIds(20001)() - 1;
  const year = WORLD_DATA.year || 1;
  let recovered = 0;

  // 社会人（企業/クラブ）
  for (const def of getAllTeamsEffective()) {
    const name = def.displayName || def.name;
    if (TEAMS_DATA[name]) continue;
    const rank = def.rank;
    TEAMS_DATA[name] = {
      name, abbreviation: makeAbbreviation(name),
      players: generateCorporateRoster(def, year),
      pitchingRotation: null, corporateTeamId: def.id,
      corporateData: {
        rank, region: def.region, city: def.city, type: def.type,
        budget: BUDGET_BY_RANK[rank] || 12000, staff: generateInitialStaff(rank),
        reputation: RANK_INITIAL_REPUTATION[rank] || 5, rankingScore: INITIAL_RANKING_SCORE[rank] || 900,
        proDraftCount: 0, tournamentWins: 0, yearlyBudgetBonus: 0, tournamentBudgetBonus: 0, sponsors: [],
      },
    };
    recovered++;
  }

  // 他の独立リーグ（自リーグは除く）
  for (const lid of ALL_INDEPENDENT_LEAGUE_IDS) {
    if (lid === userLeagueId) continue;
    const leagueDef = INDEPENDENT_LEAGUES[lid];
    for (const teamDef of (leagueDef?.teams || [])) {
      if (TEAMS_DATA[teamDef.name]) continue;
      const rank = teamDef.rank || 'C';
      TEAMS_DATA[teamDef.name] = {
        name: teamDef.name, abbreviation: teamDef.abbreviation || makeAbbreviation(teamDef.name),
        players: generateCorporateRoster(teamDef, year), pitchingRotation: null,
        independentLeagueId: lid,
        corporateData: {
          rank, type: 'independent',
          reputation: RANK_INITIAL_REPUTATION[rank] || 20, rankingScore: INITIAL_RANKING_SCORE[rank] || 900,
          proDraftCount: 0, tournamentWins: 0,
        },
      };
      recovered++;
    }
  }

  // 大学（欠落分のみ再生成）
  if (UNIVERSITY_TEAMS.some(d => !TEAMS_DATA[d.name])) {
    initializeUniversityTeamsForParallelWorld();
    recovered++;
  }

  return recovered;
};

// ============================================================
// 社会人＋独立リーグの並行世界生成（大学モード等から呼ばれる）
// ============================================================

export const initializeCorporateParallelWorld = (existingTeamNames = []) => {
  corporatePlayerIdBase = 20000;
  // 3経路で共有（クラブのスタッフ・予算と同名の改名もここが持つ）
  const { allTeamNames: corpTeamNames } = buildAllCorporateTeams();
  initializeIndependentLeagues(null, [...existingTeamNames, ...corpTeamNames]);
};

// ============================================================
// 注目度システム
// 勝つ → 注目度UP → 資金UP → 良いスタッフ → 良い選手 → 勝つ
// ============================================================

// 注目度の変動要因
const REPUTATION_GAINS = {
  win: 0.5,                // 地域リーグ1勝ごと
  seasonChampion: 3,       // 地域リーグ優勝
  tournamentRoundWin: 2,   // 全国大会1勝ごと
  proDrafted: 4,           // プロ選手輩出
};

const REPUTATION_DECAY = 3; // 年間自然減衰（実績なしなら忘れられる）

// 注目度 → 企業の年間追加予算（万円）
export const getReputationBudgetBonus = (reputation) => {
  if (reputation >= 80) return 3000;
  if (reputation >= 60) return 2000;
  if (reputation >= 40) return 1000;
  if (reputation >= 20) return 500;
  return 0;
};

// マネージング能力 → 予算ボーナス（万円）: 0→0万、50→1000万、100→2000万
export const getManagingBudgetBonus = (managingValue) =>
  Math.round((managingValue || 0) * 20);

// 大会成績 → 予算ボーナス（万円）
// 都市対抗/日本選手権（クラブはクラブ選手権）の成績が翌年の企業からの追加支援に反映
// 年度更新（advanceToNextYear）で updateAllTournamentBudgetBonuses が cd.tournamentBudgetBonus を決める
const TOURNAMENT_BUDGET_BONUS = {
  champion: 2000,    // 優勝
  runnerUp: 1000,    // 準優勝
  semiFinal: 500,    // ベスト4
  entry: 300,        // 本戦出場
};

export const getTournamentBudgetBonus = (cd) => cd?.tournamentBudgetBonus || 0;

// 1つの本戦ブラケットでの成績 → ボーナス額（本戦に出ていなければ0）
// ⚠ 本戦は「日付で1回戦ずつ」も「まとめて自動」も recordResult / autoPlayBracket で
//    bracket.champion と各試合の loser を埋める。ここはそれだけを読む
const bracketBudgetBonus = (bracket, teamName) => {
  const rounds = bracket?.rounds;
  if (!rounds?.length) return 0;
  if (bracket.champion && bracket.champion === teamName) return TOURNAMENT_BUDGET_BONUS.champion;
  if (bracket.champion && rounds[rounds.length - 1][0]?.loser === teamName) return TOURNAMENT_BUDGET_BONUS.runnerUp;
  if (rounds.length >= 2 && rounds[rounds.length - 2].some(m => !m.isBye && m.loser === teamName)) return TOURNAMENT_BUDGET_BONUS.semiFinal;
  if (rounds[0].some(m => m.team1 === teamName || m.team2 === teamName)) return TOURNAMENT_BUDGET_BONUS.entry;
  return 0;
};

// その年の全国大会（都市対抗・日本選手権・クラブ選手権の本戦）の成績 → 翌年の予算ボーナス（万円）
// 複数の大会に出たら**いちばん良い成績の額だけ**（足さない。チーム運営画面の「大会成績ボーナス条件」の注記どおり）
// 例: 都市対抗優勝＋日本選手権初戦負け = 2000
export const computeTournamentBudgetBonus = (teamName, { toshitaikou, nihonSenshuken, clubSenshuken } = {}) =>
  Math.max(0, ...[toshitaikou, nihonSenshuken, clubSenshuken]
    .map(t => bracketBudgetBonus(t?.mainTournament?.bracket, teamName)));

// 年度更新で1回呼ぶ: 全社会人チームの cd.tournamentBudgetBonus をその年の大会成績で**置き換える**
// （足し込まないので、同じ年に2回呼んでも二重に入らない。前年の分も残らない）
// ⚠ 置き場所はモードで変わる（updateAllRanks と同じ）。社会人モードは seasonData、ほかは WORLD_DATA
export const updateAllTournamentBudgetBonuses = (seasonData, teams = TEAMS_DATA) => {
  const tournaments = {
    toshitaikou: seasonData?.toshitaikou || WORLD_DATA.corporateToshitaikou,
    nihonSenshuken: seasonData?.nihonSenshuken || WORLD_DATA.corporateNihonSenshuken,
    clubSenshuken: seasonData?.clubSenshuken || WORLD_DATA.corporateClubSenshuken,
  };
  for (const [teamName, teamData] of Object.entries(teams)) {
    const cd = teamData?.corporateData;
    if (!cd || teamData.independentLeagueId) continue;
    cd.tournamentBudgetBonus = computeTournamentBudgetBonus(teamName, tournaments);
  }
};

// 基本予算（万円）。cd.budget が無い古いデータはランクの表から
export const getBaseBudget = (cd) => cd?.budget || BUDGET_BY_RANK[cd?.rank] || 12000;

// 予算の内訳（年度末決算・チーム運営・退団画面の3つが同じ式を使う）
export const budgetBreakdown = (cd, staff = cd?.staff || []) => {
  const baseBudget = getBaseBudget(cd);
  const reputationBonus = cd?.yearlyBudgetBonus ?? getReputationBudgetBonus(cd?.reputation || 0);
  const managingValue = Math.max(...staff.map(s => s.abilities?.managing || 0), 0);
  const managingBonus = getManagingBudgetBonus(managingValue);
  const tournamentBonus = getTournamentBudgetBonus(cd);
  const sponsorIncome = getSponsorIncome(cd);
  return {
    baseBudget, reputationBonus, managingValue, managingBonus, tournamentBonus, sponsorIncome,
    total: baseBudget + reputationBonus + managingBonus + tournamentBonus + sponsorIncome,
  };
};


// スポンサー契約 → 年間収入（万円）
// 注目度と実績に応じてスポンサーが付く
export const SPONSOR_TIERS = {
  platinum: { label: 'プラチナ', income: 3000, minReputation: 80, color: 'text-purple-400' },
  gold:     { label: 'ゴールド', income: 1500, minReputation: 60, color: 'text-yellow-400' },
  silver:   { label: 'シルバー', income: 800,  minReputation: 40, color: 'text-gray-300' },
  bronze:   { label: 'ブロンズ', income: 400,  minReputation: 20, color: 'text-orange-600' },
};

const SPONSOR_NAMES = {
  platinum: [
    '大和重工業', '東洋自動車', '帝都銀行', '日本製鉄グループ', '太平洋電力',
    '三菱化学工業', 'セントラル保険', '富士通信工業', '国際航空',
  ],
  gold: [
    '東海建設', 'サクラ食品', 'マルナカ不動産', '北斗電機', '東京精密',
    'オーシャン運輸', '日光化成', 'トップバリュー', '朝日ソフトウェア',
  ],
  silver: [
    '地元タクシー', '町田製パン', 'さくら薬局', 'みどり信用金庫', '富士見印刷',
    '中央スポーツ用品', 'やまと弁当', '武蔵野測量', '星野接骨院',
  ],
  bronze: [
    '駅前商店会', '田中鮮魚店', '山下理容室', '佐藤工務店', '鈴木自動車整備',
    '町内会有志', '地元ラーメン店', '中田酒店', '渡辺畳店',
  ],
};

export const getSponsorIncome = (cd) => {
  if (!cd?.sponsors || cd.sponsors.length === 0) return 0;
  return cd.sponsors.reduce((sum, s) => sum + (SPONSOR_TIERS[s.tier]?.income || 0), 0);
};

// スポンサー候補を生成（シーズン終了時に呼ばれる）
export const generateSponsorOffers = (cd) => {
  if (!cd) return [];
  const rep = cd.reputation || 0;
  const offers = [];

  // 各ティアについて、注目度に応じた確率でオファーが来る
  for (const [tier, info] of Object.entries(SPONSOR_TIERS)) {
    if (rep < info.minReputation) continue;
    const overRep = rep - info.minReputation;
    const chance = Math.min(0.8, 0.3 + overRep * 0.015);
    if (Math.random() < chance) {
      const names = SPONSOR_NAMES[tier];
      const existing = new Set((cd.sponsors || []).map(s => s.name));
      const available = names.filter(n => !existing.has(n));
      if (available.length > 0) {
        const name = available[Math.floor(Math.random() * available.length)];
        offers.push({ tier, name, income: info.income, duration: 1 + Math.floor(Math.random() * 3) });
      }
    }
  }
  return offers;
};

// スポンサー契約を適用（年始に呼ばれる）
export const advanceSponsors = (cd) => {
  if (!cd?.sponsors) return;
  cd.sponsors = cd.sponsors.filter(s => {
    s.remainingYears = (s.remainingYears || 1) - 1;
    return s.remainingYears > 0;
  });
};

// スポンサー契約を追加
export const acceptSponsor = (cd, offer) => {
  if (!cd) return;
  if (!cd.sponsors) cd.sponsors = [];
  cd.sponsors.push({
    tier: offer.tier,
    name: offer.name,
    income: offer.income,
    remainingYears: offer.duration,
  });
};

// 注目度 → スカウト成功率補正（1.0基準）
export const getReputationScoutBonus = (reputation) => {
  return 0.6 + (reputation / 100) * 0.8; // 0→0.6倍、50→1.0倍、100→1.4倍
};

// 注目度 → 入団希望選手の質補正
export const getReputationRecruitBonus = (reputation) => {
  return Math.floor(reputation / 10) - 2; // 0→-2、50→3、100→8
};

// シーズン中の注目度更新（減衰なし、累積獲得ポイントの差分を反映）
export const updateReputation = (teamData, seasonResults) => {
  const cd = teamData.corporateData;
  if (!cd) return;

  let totalGain = 0;
  // 地域リーグ成績
  totalGain += (seasonResults.wins || 0) * REPUTATION_GAINS.win;
  if (seasonResults.isChampion) totalGain += REPUTATION_GAINS.seasonChampion;
  // 全国大会（勝利数のみ、順位ボーナスなし）
  const tWins = seasonResults.tournamentMainWins || 0;
  totalGain += tWins * REPUTATION_GAINS.tournamentRoundWin;
  // プロ輩出
  if (seasonResults.proDraftedCount) totalGain += seasonResults.proDraftedCount * REPUTATION_GAINS.proDrafted;

  // 前回更新時との差分だけ反映
  const prevGain = cd.currentSeasonGain || 0;
  const delta = Math.max(0, totalGain - prevGain);
  cd.currentSeasonGain = totalGain;
  cd.reputation = clamp((cd.reputation || 0) + delta, 0, 100);
  cd.yearlyBudgetBonus = getReputationBudgetBonus(cd.reputation);
};

// 年度末の自然減衰（オフシーズンに1回だけ呼ぶ）
export const applyReputationDecay = (teamData) => {
  const cd = teamData.corporateData;
  if (!cd) return;
  if (!cd.reputationHistory) cd.reputationHistory = [];
  cd.reputationHistory.push(cd.reputation || 0);
  if (cd.reputationHistory.length > 2) cd.reputationHistory.shift();
  cd.reputation = clamp((cd.reputation || 0) - REPUTATION_DECAY, 0, 100);
  cd.currentSeasonGain = 0;
  cd.yearlyBudgetBonus = getReputationBudgetBonus(cd.reputation);
  cd.proDraftCount = cd.proDraftCount || 0;
  // ※ proDraftCountSeason は updateAllRanks が読むため、ここではリセットしない
  //   （減衰はランク判定より先に走る）。リセットは updateAllRanks の末尾で行う。
};

// ⚠ **ランクの権威は `updateAllRanks`（rankingScore のパーセンタイル）ひとつだけ**。
//    以前はここに注目度(reputation)の閾値でランクを決める
//    `updateRankFromReputation` / `updateUniversityRankFromReputation` があり、
//    CLAUDE.md にも「昇格閾値 S≥75 / A≥55 …」と書かれていたが、
//    **どちらも一度も呼ばれていない死んだコード**だった（export だけされていた）。
//    ランクを決める式が2つあると必ず食い違うので、表を二重に作らずここには置かない。
//    注目度はスカウト・予算・入団交渉の成功率にだけ効く別系統。

// トーナメントブラケットからチームごとの勝利数を集計
const countBracketWins = (bracket) => {
  const wins = {};
  if (!bracket?.rounds) return wins;
  for (const round of bracket.rounds) {
    for (const match of round) {
      if (match.winner && !match.isBye) {
        wins[match.winner] = (wins[match.winner] || 0) + 1;
      }
    }
  }
  return wins;
};

// 全チームの注目度をシーズン中の成績で更新（減衰なし、差分反映）
// 2ヶ月ごと（6月/8月/10月）＋年度末に呼ばれる
export const updateAllTeamReputations = (seasonData) => {
  const standings = seasonData.standings || [];
  const standingsMap = {};
  standings.forEach(s => { standingsMap[s.team] = s; });

  const champion = standings.length > 0
    ? [...standings].sort(compareStandings)[0]?.team
    : null;

  // 大会結果を集計
  const mainTournamentWinsMap = {};
  const toshitaikouEntries = new Set();
  const senshukenEntries = new Set();
  const td = seasonData.toshitaikou;
  // 都市対抗: 予選突破チームを収集
  if (td?.qualifiers) {
    for (const regionId of Object.keys(td.qualifiers)) {
      const q = td.qualifiers[regionId];
      if (q.qualifiedTeams) q.qualifiedTeams.forEach(t => toshitaikouEntries.add(t));
    }
  }
  // 都市対抗本戦の勝利数
  // ⚠ 勝ち数は組み合わせ（`.bracket`。`rounds` を持つ）から数える。以前は `mainTournament` を
  //    そのまま渡していて、都市対抗の勝ちが注目度にいつも0で入っていた（監査 2026-11-23）
  if (td?.mainTournament?.bracket) {
    const mtWins = countBracketWins(td.mainTournament.bracket);
    for (const [team, w] of Object.entries(mtWins)) {
      mainTournamentWinsMap[team] = (mainTournamentWinsMap[team] || 0) + w;
    }
  }
  // 日本選手権
  const ns = seasonData.nihonSenshuken;
  if (ns?.mainTournament?.bracket) {
    if (ns.mainTournament.bracket.rounds?.[0]) {
      for (const match of ns.mainTournament.bracket.rounds[0]) {
        if (match.team1) senshukenEntries.add(match.team1);
        if (match.team2) senshukenEntries.add(match.team2);
      }
    }
    const nsWins = countBracketWins(ns.mainTournament.bracket);
    for (const [team, w] of Object.entries(nsWins)) {
      mainTournamentWinsMap[team] = (mainTournamentWinsMap[team] || 0) + w;
    }
  } else if (ns?.qualifiers) {
    for (const q of Object.values(ns.qualifiers)) {
      if (q.qualifiedTeams) q.qualifiedTeams.forEach(t => senshukenEntries.add(t));
    }
  }

  const rankChanges = [];

  for (const teamName of Object.keys(TEAMS_DATA)) {
    const teamData = TEAMS_DATA[teamName];
    if (!teamData?.corporateData) continue;

    // 独立リーグは順位ベース（大学と同じ）
    if (teamData.independentLeagueId) {
      const sorted = [...standings].sort(compareStandings);
      const leaguePosition = sorted.findIndex(st => st.team === teamName) + 1;
      const seasonResults = {
        leaguePosition: leaguePosition || 0,
        // プロ輩出を注目度に反映（ドラフトで記録した今季分）
        proDraftedCount: teamData.corporateData.proDraftCountSeason || 0,
      };
      updateUniversityReputation(teamData, seasonResults);
      continue;
    }

    // 社会人: 勝利数ベース
    const s = standingsMap[teamName];
    const seasonResults = {
      wins: s?.wins || 0,
      isChampion: teamName === champion,
      tournamentMainWins: mainTournamentWinsMap[teamName] || 0,
      // プロ輩出を注目度に反映（ドラフトで記録した今季分）
      proDraftedCount: teamData.corporateData.proDraftCountSeason || 0,
    };

    updateReputation(teamData, seasonResults);
  }

  return [];
};

// ============================================================
// 大学・独立リーグ向けランク変動システム
// ============================================================

// 大学・独立リーグ: 勝利数ではなく順位ベース
const UNI_REPUTATION_GAINS = {
  position1st: 5,          // リーグ1位
  position2nd: 3,          // リーグ2位
  position3rd: 1,          // リーグ3位
  proDrafted: 4,           // プロ選手輩出
  tournamentWin: 2,        // 全国大会1勝ごと
  tournamentChampion: 5,   // 全国大会優勝
  tournamentRunnerUp: 3,   // 全国大会準優勝
};
const UNI_REPUTATION_DECAY = 3;

export const updateUniversityReputation = (teamData, seasonResults) => {
  const ud = teamData.universityData || teamData.corporateData;
  if (!ud) return;
  let totalGain = 0;
  // 順位ベース（1位+5, 2位+3, 3位+1, 4位以下+0）
  const pos = seasonResults.leaguePosition || 0;
  if (pos === 1) totalGain += UNI_REPUTATION_GAINS.position1st;
  else if (pos === 2) totalGain += UNI_REPUTATION_GAINS.position2nd;
  else if (pos === 3) totalGain += UNI_REPUTATION_GAINS.position3rd;
  // プロ輩出
  if (seasonResults.proDraftedCount) totalGain += seasonResults.proDraftedCount * UNI_REPUTATION_GAINS.proDrafted;

  const prevGain = ud.currentSeasonGain || 0;
  const delta = Math.max(0, totalGain - prevGain);
  ud.currentSeasonGain = totalGain;
  ud.reputation = clamp((ud.reputation || 0) + delta, 0, 100);
};

// 大学・独立リーグの年度末減衰
export const applyUniversityReputationDecay = (teamData) => {
  const ud = teamData.universityData || teamData.corporateData;
  if (!ud) return;
  if (!ud.reputationHistory) ud.reputationHistory = [];
  ud.reputationHistory.push(ud.reputation || 0);
  if (ud.reputationHistory.length > 2) ud.reputationHistory.shift();
  ud.reputation = clamp((ud.reputation || 0) - UNI_REPUTATION_DECAY, 0, 100);
  ud.currentSeasonGain = 0;
  // ※ proDraftCountSeason は updateAllRanks が読むため、ここではリセットしない
};

// 全チーム（社会人＋独立＋大学）のランク変動を一括処理（FIFAスタイルElo方式）
export const updateAllRanks = (seasonData) => {
  const standings = seasonData.standings || [];

  // === Step 1: reputation更新（game mechanics用: スカウト・予算・リクルート成功率など）===
  updateAllTeamReputations(seasonData);

  // TEAMS_DATA大学チームのreputation更新
  const sortedStandings = [...standings].sort(compareStandings);
  const ucChampion = seasonData.universityChampionship?.champion || null;
  const mjChampion = seasonData.meijiJingu?.champion || null;
  for (const teamName of Object.keys(TEAMS_DATA)) {
    const teamData = TEAMS_DATA[teamName];
    if (!teamData?.universityData) continue;
    const leaguePosition = sortedStandings.findIndex(st => st.team === teamName) + 1;
    updateUniversityReputation(teamData, {
      leaguePosition,
      tournamentChampion: teamName === ucChampion || teamName === mjChampion,
      // プロ輩出を注目度に反映（ドラフトで記録した今季分）
      proDraftedCount: teamData.universityData.proDraftCountSeason || 0,
    });
  }

  // WORLD_DATA大学チームのreputation更新（注目度・歴史記録）
  const ucSource = seasonData.universityChampionship || WORLD_DATA._uniTournaments?.uc;
  const mjSource = seasonData.meijiJingu || WORLD_DATA._uniTournaments?.mj;
  const worldUcWins = ucSource?.bracket ? countBracketWins(ucSource.bracket) : {};
  const worldMjWins = mjSource?.bracket ? countBracketWins(mjSource.bracket) : {};
  const worldUcChampion = ucSource?.champion || null;
  const worldUcRunnerUp = ucSource?.runnerUp || null;
  const worldMjChampion = mjSource?.champion || null;
  const worldMjRunnerUp = mjSource?.runnerUp || null;

  const worldTeamGains = {};
  const uniLeagues = WORLD_DATA.universityLeagues;
  if (uniLeagues) {
    for (const league of Object.values(uniLeagues)) {
      for (const seasonKey of ['spring', 'fall']) {
        const sd = league[seasonKey];
        if (!sd?.done) continue;
        const allSt = league.divisions
          ? [...(sd.standings1 || []), ...(sd.standings2 || [])]
          : (sd.standings || []);
        if (allSt.length === 0) continue;
        const sorted = [...allSt].sort(compareStandings);
        for (const st of allSt) {
          if (!worldTeamGains[st.team]) worldTeamGains[st.team] = 0;
          const pos = sorted.findIndex(s => s.team === st.team) + 1;
          if (pos === 1) worldTeamGains[st.team] += UNI_REPUTATION_GAINS.position1st;
          else if (pos === 2) worldTeamGains[st.team] += UNI_REPUTATION_GAINS.position2nd;
          else if (pos === 3) worldTeamGains[st.team] += UNI_REPUTATION_GAINS.position3rd;
        }
      }
    }
  }
  for (const teamName of Object.keys(worldTeamGains)) {
    const tWins = (worldUcWins[teamName] || 0) + (worldMjWins[teamName] || 0);
    if (tWins > 0) worldTeamGains[teamName] += tWins * UNI_REPUTATION_GAINS.tournamentWin;
    if (teamName === worldUcChampion || teamName === worldMjChampion) worldTeamGains[teamName] += UNI_REPUTATION_GAINS.tournamentChampion;
    else if (teamName === worldUcRunnerUp || teamName === worldMjRunnerUp) worldTeamGains[teamName] += UNI_REPUTATION_GAINS.tournamentRunnerUp;
  }
  const managedTeamNames = new Set(Object.keys(TEAMS_DATA));
  for (const teamDef of UNIVERSITY_TEAMS) {
    if (managedTeamNames.has(teamDef.name)) continue;
    if (teamDef.reputation === undefined) teamDef.reputation = RANK_INITIAL_REPUTATION[teamDef.rank] || 20;
    if (!teamDef.reputationHistory) teamDef.reputationHistory = [];
    teamDef.reputationHistory.push(teamDef.reputation);
    if (teamDef.reputationHistory.length > 2) teamDef.reputationHistory.shift();
    teamDef.reputation = clamp(teamDef.reputation - UNI_REPUTATION_DECAY + (worldTeamGains[teamDef.name] || 0), 0, 100);
  }

  // === Step 2: 全エントリー収集・rankingScore初期化 ===
  const allEntries = [];
  for (const [teamName, teamData] of Object.entries(TEAMS_DATA)) {
    if (teamData?.corporateData) {
      const cd = teamData.corporateData;
      if (cd.rankingScore === undefined) cd.rankingScore = INITIAL_RANKING_SCORE[cd.rank] || 900;
      allEntries.push({ name: teamName, dataObj: cd, type: teamData.independentLeagueId ? 'independent' : 'corporate' });
    }
    if (teamData?.universityData) {
      const ud = teamData.universityData;
      if (ud.rankingScore === undefined) ud.rankingScore = INITIAL_RANKING_SCORE[ud.rank] || 900;
      allEntries.push({ name: teamName, dataObj: ud, type: 'university' });
    }
  }
  for (const teamDef of UNIVERSITY_TEAMS) {
    if (managedTeamNames.has(teamDef.name)) continue;
    if (teamDef.rankingScore === undefined) teamDef.rankingScore = INITIAL_RANKING_SCORE[teamDef.rank] || 900;
    allEntries.push({ name: teamDef.name, dataObj: teamDef, type: 'worldUniversity', teamDef });
  }

  // === Step 3: Eloデルタ計算（試合前スコアのスナップショットを使用）===
  const scoreMap = {};
  allEntries.forEach(e => { scoreMap[e.name] = e.dataObj.rankingScore; });

  const deltas = {};
  const addDelta = (name, d) => { deltas[name] = (deltas[name] || 0) + d; };

  // 3a. 社会人レギュラーシーズン（シーズン全体のW vs We）
  const corpSt = standings.filter(s => {
    const td = TEAMS_DATA[s.team];
    return td?.corporateData && !td.independentLeagueId;
  });
  if (corpSt.length > 1) {
    const avgScore = corpSt.reduce((acc, s) => acc + (scoreMap[s.team] || 900), 0) / corpSt.length;
    for (const st of corpSt) {
      const selfScore = scoreMap[st.team];
      if (selfScore === undefined) continue;
      const games = (st.wins || 0) + (st.losses || 0) + (st.draws || 0);
      if (games === 0) continue;
      const W = ((st.wins || 0) + (st.draws || 0) * 0.5) / games;
      addDelta(st.team, ELO_I.regular * (W - getExpectedWinRate(selfScore, avgScore)));
    }
    applyFinishBonus(corpSt, addDelta, scoreMap);
  }

  // 3b. 独立リーグ（全独立チームをひとまとめに）
  const indSt = standings.filter(s => TEAMS_DATA[s.team]?.independentLeagueId);
  if (indSt.length > 1) {
    const avgScore = indSt.reduce((acc, s) => acc + (scoreMap[s.team] || 900), 0) / indSt.length;
    for (const st of indSt) {
      const selfScore = scoreMap[st.team];
      if (selfScore === undefined) continue;
      const games = (st.wins || 0) + (st.losses || 0) + (st.draws || 0);
      if (games === 0) continue;
      const W = ((st.wins || 0) + (st.draws || 0) * 0.5) / games;
      addDelta(st.team, ELO_I.league * (W - getExpectedWinRate(selfScore, avgScore)));
    }
    applyFinishBonus(indSt, addDelta, scoreMap);
  }

  // 3c. TEAMS_DATA大学チームのリーグElo
  const uniMgSt = standings.filter(s => TEAMS_DATA[s.team]?.universityData);
  if (uniMgSt.length > 1) {
    const avgScore = uniMgSt.reduce((acc, s) => acc + (scoreMap[s.team] || 900), 0) / uniMgSt.length;
    for (const st of uniMgSt) {
      const selfScore = scoreMap[st.team];
      if (selfScore === undefined) continue;
      const games = (st.wins || 0) + (st.losses || 0) + (st.draws || 0);
      if (games === 0) continue;
      const W = ((st.wins || 0) + (st.draws || 0) * 0.5) / games;
      addDelta(st.team, ELO_I.league * (W - getExpectedWinRate(selfScore, avgScore)));
    }
    applyFinishBonus(uniMgSt, addDelta, scoreMap);
  }

  // 3d. WORLD_DATA大学リーグ（春・秋、部別に適用）
  if (uniLeagues) {
    for (const league of Object.values(uniLeagues)) {
      for (const seasonKey of ['spring', 'fall']) {
        const sd = league[seasonKey];
        if (!sd?.done) continue;
        const divGroups = league.divisions
          ? [sd.standings1 || [], sd.standings2 || []]
          : [sd.standings || []];
        for (const divSt of divGroups) {
          if (divSt.length < 2) continue;
          const avgScore = divSt.reduce((acc, s) => acc + (scoreMap[s.team] || 900), 0) / divSt.length;
          for (const st of divSt) {
            const selfScore = scoreMap[st.team];
            if (selfScore === undefined) continue;
            const games = (st.wins || 0) + (st.losses || 0) + (st.draws || 0);
            if (games === 0) continue;
            const W = ((st.wins || 0) + (st.draws || 0) * 0.5) / games;
            addDelta(st.team, ELO_I.league * (W - getExpectedWinRate(selfScore, avgScore)));
          }
          applyFinishBonus(divSt, addDelta, scoreMap);
        }
      }
    }
  }

  // 3e. トーナメントElo（ブラケットの勝者・敗者ペアから直接計算）
  const applyBracketElo = (bracket, baseI) => {
    if (!bracket) return;
    for (const { winner, loser, roundIdx, totalRounds } of getBracketMatchResults(bracket)) {
      const ws = scoreMap[winner], ls = scoreMap[loser];
      if (ws === undefined || ls === undefined) continue;
      // 後半戦ほど重要度を1.0〜1.5倍にスケール
      const I = baseI * (1 + (roundIdx / Math.max(totalRounds - 1, 1)) * 0.5);
      const We = getExpectedWinRate(ws, ls);
      addDelta(winner, I * (1 - We));
      addDelta(loser,  I * (0 - (1 - We)));
    }
  };
  // 社会人全国大会
  // ⚠ **置き場所はモードで変わる**。社会人モードでは seasonData、独立・大学モードでは
  //    WORLD_DATA 側に入る。片方だけ見ていると、そのモードでは丸ごと計上されない。
  const td = seasonData.toshitaikou || WORLD_DATA.corporateToshitaikou;
  const ns = seasonData.nihonSenshuken || WORLD_DATA.corporateNihonSenshuken;
  const cs = seasonData.clubSenshuken || WORLD_DATA.corporateClubSenshuken;
  const rt = seasonData.regionalTournament || WORLD_DATA.corporateRegionalTournament;
  applyBracketElo(td?.mainTournament?.bracket, ELO_I.tournament);
  applyBracketElo(ns?.mainTournament?.bracket, ELO_I.tournament);
  // クラブの全国大会。208チームのクラブにとってはここが最上位の舞台
  applyBracketElo(cs?.mainTournament?.bracket, ELO_I.clubNational);
  // 地域大会・都市対抗地区予選。下位チームのシーズンはここで出来ている
  for (const reg of Object.values(rt?.brackets || {})) applyBracketElo(reg?.bracket, ELO_I.qualifier);
  for (const q of Object.values(td?.qualifiers || {})) {
    applyBracketElo(q?.mainBracket, ELO_I.qualifier);
    applyBracketElo(q?.losersBracket, ELO_I.qualifier);
  }
  for (const q of Object.values(ns?.qualifiers || {})) applyBracketElo(q?.mainBracket, ELO_I.qualifier);
  for (const q of Object.values(cs?.qualifiers || {})) applyBracketElo(q?.mainBracket, ELO_I.qualifier);
  // 大学全国大会
  applyBracketElo(ucSource?.bracket, ELO_I.uniNational);
  applyBracketElo(mjSource?.bracket, ELO_I.uniNational);
  // 独立リーグ グランドチャンピオンシップ（各リーグ王者による全国王座決定戦）
  const gcSource = seasonData.grandChampionship || WORLD_DATA.grandChampionship;
  applyBracketElo(gcSource?.bracket, ELO_I.tournament);
  // 王者・準優勝には追加の栄誉ボーナス
  if (gcSource?.bracket?.champion) addDelta(gcSource.bracket.champion, ELO_I.gcChampion);
  if (gcSource?.bracket?.runnerUp) addDelta(gcSource.bracket.runnerUp, ELO_I.gcRunnerUp);

  // 3f. プロ輩出Elo（NPBに選手を送り出した実績はチームの格を直接押し上げる）
  for (const e of allEntries) {
    const produced = e.dataObj?.proDraftCountSeason || 0;
    if (produced > 0) addDelta(e.name, produced * ELO_I.proDrafted);
  }

  // === Step 4: デルタをrankingScoreに一括適用 ===
  for (const e of allEntries) {
    const d = deltas[e.name] || 0;
    e.dataObj.rankingScore = clamp((e.dataObj.rankingScore || 900) + d, ELO_CLAMP_MIN, ELO_CLAMP_MAX);
  }

  // === Step 5: rankingScoreでソートしてパーセンテージ別ランク割り当て ===
  allEntries.sort((a, b) => b.dataObj.rankingScore - a.dataObj.rankingScore);

  // ⚠ **帯は初期分布と一致していなければならない**。
  //    初期のランクは RANK_CONFIG が team ごとに手で割り当てており、実測の内訳は
  //    S20 / A45 / B88 / C160 / D243（＝3.6 / 8.1 / 15.8 / 28.8 / 43.7%）。
  //    ところが帯は S5 / A20 / B45 / C75% で、**D の枠が139しか無いのに D が243チーム**
  //    あった。そのため初年度の年度末に **104チームが成績と無関係に D→C へ機械的に
  //    昇格**していた（実測: Dスタートの43%が1年目に昇格し、以後6年間まったく動かない）。
  //    「1年ですぐ上がって、その後は何をしても動かない」の正体はこれ。
  //    クラブ208チームを含む母集団なので、下位が厚いのが正しい姿。
  const total = allEntries.length;
  const PCT_BANDS = buildRankBands(total);

  const rankChanges = [];
  let bandIdx = 0;
  for (let i = 0; i < total; i++) {
    while (bandIdx < PCT_BANDS.length - 1 && i >= PCT_BANDS[bandIdx].end) bandIdx++;
    const newRank = PCT_BANDS[bandIdx].rank;
    const e = allEntries[i];
    e.position = i + 1;
    e.newRank = newRank;

    if (e.type === 'corporate' || e.type === 'university' || e.type === 'independent') {
      const oldRank = e.dataObj.rank;
      e.dataObj.rankPosition = i + 1;
      if (newRank !== oldRank) {
        e.dataObj.rank = newRank;
        rankChanges.push({ team: e.name, from: oldRank, to: newRank, score: e.dataObj.rankingScore, type: e.type });
      }
    } else {
      const oldRank = e.teamDef.rank;
      e.teamDef.rankPosition = i + 1;
      if (newRank !== oldRank) {
        e.teamDef.rank = newRank;
        rankChanges.push({ team: e.name, from: oldRank, to: newRank, score: e.dataObj.rankingScore, type: 'university' });
      }
    }
  }

  // 今季のプロ輩出数をリセット（注目度・Eloへの反映が済んだのでここで消費する。
  // 通算 proDraftCount は保持）
  for (const e of allEntries) {
    if (e.dataObj) e.dataObj.proDraftCountSeason = 0;
  }

  // === Step 6: ランキングスナップショット保存（TeamRankingScreenで参照）===
  WORLD_DATA._teamRanking = allEntries.map(e => ({
    position: e.position,
    name: e.name,
    rank: e.newRank,
    score: Math.round(e.dataObj.rankingScore),
    reputation: Math.round(e.dataObj?.reputation ?? 0),
    type: e.type,
  }));

  return rankChanges;
};

// 赤字ペナルティを適用（年度移行時に呼ばれる）
export const applyBudgetDeficitPenalty = (teamData) => {
  const cd = teamData?.corporateData;
  if (!cd || !cd.budgetDeficit || cd.budgetDeficit <= 0) return null;

  const deficit = cd.budgetDeficit;
  const totalBudget = getBaseBudget(cd);
  const deficitRate = Math.min(1, deficit / totalBudget);
  const penalties = [];

  // 1. 注目度低下（赤字額/1000 * 3、最大-15）
  const repPenalty = Math.min(15, Math.round((deficit / 1000) * 3));
  if (repPenalty > 0) {
    cd.reputation = Math.max(0, (cd.reputation || 0) - repPenalty);
    penalties.push({ type: 'reputation', value: -repPenalty });
  }

  // 2. スポンサー離脱リスク（赤字率 × 60%の確率で各スポンサーが離脱）
  if (cd.sponsors && cd.sponsors.length > 0) {
    const lostSponsors = [];
    cd.sponsors = cd.sponsors.filter(s => {
      const leaveChance = deficitRate * 0.6;
      if (Math.random() < leaveChance) {
        lostSponsors.push(s.name);
        return false;
      }
      return true;
    });
    if (lostSponsors.length > 0) {
      penalties.push({ type: 'sponsor_loss', names: lostSponsors });
    }
  }

  // 3. スカウト制限（契約更改時に既に適用済み、レポートに含める）
  const scoutReduction = cd.scoutPenalty || 0;
  if (scoutReduction > 0) {
    penalties.push({ type: 'scout', value: -scoutReduction });
  }

  cd.budgetDeficit = 0;
  cd.scoutPenalty = 0;
  cd.lastDeficitPenalties = penalties;
  return penalties;
};
