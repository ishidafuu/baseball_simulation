// ============================================================
// 社会人野球 入団（スカウト）システム (scoutingSystem.js)
// 入団: スカウトによる選手獲得（トライアウトとは異なる仕組み）
// ⚠ 2026-11-24 に3つを分けた: 退団（11月末の引退+戦力外）は corporateDepartures.js、
//    大学のスカウトは src/university/universityScout.js、両方のスカウトが使う
//    見積もり（総合力・能力のぼかし・日付の差）は src/game/scoutReport.js
// ============================================================

import { TEAMS_DATA, releasedPlayersPool } from '../teams-data.js';
import { removeFromReleasedPoolById } from '../state/pools.js';
import { addToRoster, removeFromRosterById } from '../state/roster.js';
import { advanceDate, compareDates } from '../season/seasonManager.js';
import { getTeamStaffBonus } from './staffData.js';
import { getReputationScoutBonus } from './corporateInit.js';
import { universityPool, highSchoolPool } from '../state/schoolPools.js';
import { getUniversityPipes } from '../university/universityPipeSystem.js';
import { WORLD_DATA } from './worldData.js';
import { evaluatePlayerScore, obscureAbilities, dateDiffDays } from '../game/scoutReport.js';
import { CORPORATE_TARGET_ROSTER } from './corporateDepartures.js';

// ============================================================
// 入団（スカウト）システム
// スカウトがプール（大学・リリース）から有望選手を発掘し、候補に提示
// ============================================================

/**
 * スカウトおすすめ度をS〜Fで算出
 * 「自チームのランクに対して実力が上回っており、競合が少なく、交渉成功率が高い選手」を高評価
 */
const RANK_BASELINE = { S: 90, A: 75, B: 60, C: 48, D: 35 };
export function getScoutRecommendation(player, teamRank, teamData) {
  const rank = teamRank || 'C';
  const score = evaluatePlayerScore(player);
  const gp = player.growthPotential || 1.0;
  const age = player.age || 22;
  const rivals = estimateRivalCount(player);
  const baseline = RANK_BASELINE[rank] || 55;

  // 自チーム基準との差分
  const aboveTeamBonus = (score - baseline) * 1.2;

  // 競合ペナルティ
  const rivalPenalty = rivals === 0 ? 15 : rivals === 1 ? 0 : rivals === 2 ? -20 : -40;

  // 若さボーナス
  const youthBonus = Math.max(-10, (26 - age) * 2);

  // 成長力ボーナス
  const gpBonus = (gp - 1.0) * 50;

  // 交渉成功率による補正
  const rate = teamData ? calculateRecruitSuccessRate(player, teamData) : 50;
  const ratePenalty = (rate - 50) * 0.5;

  const total = aboveTeamBonus + rivalPenalty + youthBonus + gpBonus + ratePenalty;

  // 交渉成功率が低い場合、スコアに関係なく推薦ランクに上限を設ける
  // 獲れない選手を推薦しても意味がない
  const maxByRate = rate < 5 ? 'D' : rate < 15 ? 'C' : rate < 30 ? 'B' : rate < 50 ? 'A' : 'S';
  const grades = ['F', 'D', 'C', 'B', 'A', 'S'];
  const rawGrade = total >= 35 ? 'S' : total >= 20 ? 'A' : total >= 8 ? 'B' : total >= -5 ? 'C' : total >= -20 ? 'D' : 'F';
  const rawIdx = grades.indexOf(rawGrade);
  const capIdx = grades.indexOf(maxByRate);

  return grades[Math.min(rawIdx, capIdx)];
}

/**
 * 他球団の推定接触数を算出（決定論的、レンダリング安定）
 * 選手のスコアと知名度からライバル数を推定
 */
export function estimateRivalCount(player) {
  if (player._rivals) return player._rivals.length;
  return 0;
}

/**
 * 大学プールから在学中の有望選手を取得（3-4年生のみ）
 * @param {number} currentYear - 現在の年度
 * @returns {Array} { player, source: 'university', enrollYear, poolIndex }
 */
function getUniversityScoutPool(currentYear) {
  const pool = [];
  // 大学生の実体は TEAMS_DATA の大学の名簿（4年生のみ）。`teamName` を持たせて
  // `removeFromPool` が獲得した選手を名簿から外せるようにする
  const userUniTeam = WORLD_DATA.universityLeague?.userTeam || null;
  Object.entries(TEAMS_DATA).forEach(([teamName, team]) => {
    if (!team?.universityData || teamName === userUniTeam) return;
    (team.players || []).forEach((p, idx) => {
      if ((p.universityYear || 0) < 4 && (p.age || 18) < 22) return;
      p.universityTeamName = p.universityTeamName || teamName;
      p.universityTeamId = p.universityTeamId ?? team.universityTeamId;
      pool.push({ player: p, source: 'university', teamName, poolIndex: idx, yearsInUni: 3 });
    });
  });
  Object.entries(universityPool).forEach(([enrollYear, cohort]) => {
    const yr = parseInt(enrollYear);
    cohort.forEach((entry, idx) => {
      const yearsIn = currentYear - yr;
      // 4年生のみスカウト対象（在学3年以上 = 4年目）
      if (yearsIn >= 3) {
        if (entry.universityTeamName) {
          entry.player.universityTeamName = entry.universityTeamName;
        }
        if (entry.universityTeamId) {
          entry.player.universityTeamId = entry.universityTeamId;
        }
        pool.push({
          player: entry.player,
          source: 'university',
          enrollYear: yr,
          poolIndex: idx,
          yearsInUni: yearsIn
        });
      }
    });
  });
  return pool;
}

/**
 * リリースプールからスカウト対象の選手を取得
 * @returns {Array} { player, source: 'released', poolIndex }
 */
function getReleasedScoutPool() {
  return releasedPlayersPool.map((p, idx) => ({
    player: p,
    source: 'released',
    poolIndex: idx
  }));
}

/**
 * 高校生プールからスカウト対象の選手を取得
 * 4月に生成された高校3年生が対象
 * @returns {Array} { player, source: 'highschool', poolIndex }
 */
function getHighSchoolScoutPool() {
  if (!highSchoolPool.players || highSchoolPool.players.length === 0) return [];
  return highSchoolPool.players.map((p, idx) => ({
    player: p,
    source: 'highschool',
    poolIndex: idx
  }));
}

/**
 * スカウト候補者をプールから発掘
 * scoutingEye で発見数と精度が変わる。reputation で有望な選手が見つかりやすくなる。
 * @param {Object} teamData - チームデータ
 * @param {number} year - 年度
 * @returns {Array} スカウト候補者（scoutAccuracy, scoutedAbilities, _poolRef 付き）
 */
export function generateScoutCandidates(teamData, year) {
  const staffBonus = getTeamStaffBonus(teamData.staff || []);
  const scoutEye = staffBonus.scoutingEye || 50;
  const reputation = teamData.corporateData?.reputation ?? 30;

  // 候補者数: スカウト眼で4〜12人（赤字ペナルティで減少）
  const baseCount = 4;
  const bonusCount = Math.floor(scoutEye / 12);
  const scoutPenalty = teamData.corporateData?.scoutPenalty || 0;
  const candidateCount = Math.max(3, baseCount + bonusCount - scoutPenalty);

  // 注目度が高いほど上位選手にアクセスしやすい
  const reputationMult = getReputationScoutBonus(reputation);

  // パイプ大学のIDセット（OBの繋がりで情報が入りやすい）
  const pipes = getUniversityPipes(teamData);
  const pipeMap = {};
  for (const p of pipes) pipeMap[p.universityId] = p.pipeStrength;

  // 大学プール + リリースプール + 高校生プール を統合
  const uniPool = getUniversityScoutPool(year);
  const relPool = getReleasedScoutPool();
  const hsPool = getHighSchoolScoutPool();
  // クラブからの引き上げ。**これが無いとクラブは行き止まりになる**。
  // クラブは「どこにも入団できなかった選手の受け皿」で、稀に非常に意識の高い
  // 選手が紛れ込んで突然変異のように伸びる。プロまで届かなくても
  // **社会人へ拾われて次の階層へ上がる**流れを作る。
  // ⚠ 既存の `getClubScoutPool`（視察用）を再利用する——同じプールの取得を
  //    二重に書かない。社会人が獲る年齢帯だけに絞る。
  const clubPool = getClubScoutPool().filter(e => {
    const age = e.player?.age || 22;
    return age >= 19 && age <= 27;
  });
  // ⚠ source は `club_team` のまま使うこと。`removeFromPool` がこの名前で
  //    移籍元のロスターから削除する。別名にすると**クラブに残ったまま
  //    社会人にも登録される**（二重登録）。
  const allPool = [...uniPool, ...relPool, ...hsPool, ...clubPool];

  if (allPool.length === 0) return [];

  // 総合力でスコアリングし、知名度+注目度補正+ランダムノイズでソート
  // 知名度が高い選手 → 誰でも見つけられる
  // 知名度が低い＋能力高い → scoutingEyeが高いスカウトだけが発掘できる
  const scored = allPool.map(entry => {
    const base = evaluatePlayerScore(entry.player);
    const fame = entry.player.fame || 0;
    const noise = (Math.random() - 0.5) * 30;
    const repBonus = (reputationMult - 1.0) * 20;
    // 知名度が低い選手は、スカウト能力が低いと見落とされる
    const discoveryPenalty = -((100 - fame) / 100) * ((100 - scoutEye) * 0.3);
    // パイプボーナス: OBの繋がりで情報が入る（強度1→+10, 2→+15, 3→+20）
    const uniId = entry.player.universityTeamId;
    const pipeBonus = uniId && pipeMap[uniId] ? 5 + pipeMap[uniId] * 5 : 0;
    return { ...entry, score: base + noise + repBonus + discoveryPenalty + pipeBonus, _pipeStrength: pipeMap[uniId] || 0 };
  });
  scored.sort((a, b) => b.score - a.score);

  // 上位からcandidateCount人を選出
  const selected = scored.slice(0, candidateCount);

  return selected.map(entry => {
    const p = JSON.parse(JSON.stringify(entry.player));
    const accuracy = calculateScoutAccuracy(scoutEye);
    p.scoutAccuracy = accuracy;
    p.scoutedAbilities = obscureAbilities(p, accuracy);
    // プールからの除去用の参照情報
    p._poolRef = { source: entry.source, poolIndex: entry.poolIndex, enrollYear: entry.enrollYear, teamName: entry.teamName };
    // パイプ強度を候補者に付与（交渉成功率計算で使用）
    p._pipeStrength = entry._pipeStrength || 0;
    // 出身表示用
    if (entry.source === 'highschool') {
      p._scoutSource = p.highSchool?.name ? p.highSchool.name + '高' : '高校';
    } else if (entry.source === 'university') {
      p._scoutSource = p.universityTeamName || '大学';
    } else {
      p._scoutSource = p.origin === 'university' ? (p.universityTeamName ? `${p.universityTeamName}卒` : '大学卒')
        : p.origin === 'corporate_candidate' ? '社会人候補'
        : p.origin === 'independent_candidate' ? '独立L候補'
        : p.previousTeam ? `元${p.previousTeam}` : 'フリー';
    }
    // 交渉成功率を事前計算
    p.recruitRate = calculateRecruitSuccessRate(p, teamData);
    return p;
  });
}

/**
 * スカウト精度を計算（0〜100）
 */
function calculateScoutAccuracy(scoutEye) {
  const base = 40 + Math.floor(scoutEye * 0.5);
  const variance = Math.floor(Math.random() * 15) - 7;
  return Math.max(20, Math.min(95, base + variance));
}

// ============================================================
// 交渉成功率システム
// 注目度・ランク・交渉力と選手の質で成功率が決まる
// 他球団からのスカウトも来ている場合、ランクの高い方が有利
// ============================================================

const RANK_RECRUIT_BONUS = { S: 0.10, A: 0.05, B: 0, C: -0.05, D: -0.10 };

/**
 * 選手獲得の成功率を計算（0〜100）
 * @param {Object} player - スカウト候補者
 * @param {Object} teamData - チームデータ（corporateData を持つ）
 * @returns {number} 成功率（0-100）
 */
export function calculateRecruitSuccessRate(player, teamData) {
  const cd = teamData?.corporateData;
  const reputation = cd?.reputation || 0;
  const rank = cd?.rank || 'C';
  const staffBonus = getTeamStaffBonus(cd?.staff || []);
  const negotiation = staffBonus.negotiation || 0;

  // ベース: 注目度 0→30%, 50→60%, 100→90%
  const baseRate = 0.30 + (reputation / 100) * 0.60;

  // 選手の質ペナルティ: 総合力が高いほど交渉が難しい
  const playerScore = evaluatePlayerScore(player);
  // スコア30(弱)→+10%, 60(平均)→0%, 90(有力)→-15%, 120(超有力)→-30%
  const qualityPenalty = Math.max(-0.10, Math.min(0.30, (playerScore - 60) / 200));

  // 交渉力ボーナス: 0〜25%
  const negotiationBonus = (negotiation / 100) * 0.25;

  // ランク補正
  const rankBonus = RANK_RECRUIT_BONUS[rank] || 0;

  // 調査ボーナス: 1回調査ごとに+7%
  const investigationBonus = ((player._investigationCount || 0) * 0.07);

  // お気に入りボーナス: 週ごとに+3%蓄積
  const favBonus = (getFavoriteBonus(teamData, player.id) / 100);

  // パイプボーナス: OBの繋がりで入団しやすい（強度1→+5%, 2→+8%, 3→+12%）
  const ps = player._pipeStrength || 0;
  const pipeBonus = ps >= 3 ? 0.12 : ps === 2 ? 0.08 : ps === 1 ? 0.05 : 0;

  const rate = baseRate - qualityPenalty + negotiationBonus + rankBonus + investigationBonus + favBonus + pipeBonus;
  return Math.max(1, Math.min(95, Math.round(rate * 100)));
}

/**
 * 交渉を試みて成否を判定
 * @param {Object} team - チームオブジェクト
 * @param {Object} player - スカウト候補者
 * @param {Object} teamData - チームデータ（corporateData付き）
 * @returns {{ success: boolean, rate: number }}
 */
export function attemptRecruitment(team, player, teamData) {
  const rate = calculateRecruitSuccessRate(player, teamData);
  const roll = Math.random() * 100;
  const success = roll < rate;

  if (success) {
    recruitPlayer(team, player);
  }

  return { success, rate };
}

/**
 * 獲得した選手をプールから除去
 * @param {Object} player - _poolRef を持つスカウト候補者
 */
function removeFromPool(player) {
  const ref = player._poolRef;
  if (!ref) return;

  if (ref.source === 'highschool') {
    removeFromRosterById(highSchoolPool, player.id);
  } else if (ref.source === 'university' && ref.teamName && TEAMS_DATA[ref.teamName]?.universityData) {
    removeFromRosterById(TEAMS_DATA[ref.teamName], player.id);
  } else if (ref.source === 'university') {
    const cohort = universityPool[ref.enrollYear];
    if (cohort) {
      const idx = cohort.findIndex(e => e.player.id === player.id);
      if (idx >= 0) cohort.splice(idx, 1);
      if (cohort.length === 0) delete universityPool[ref.enrollYear];
    }
  } else if (ref.source === 'released') {
    removeFromReleasedPoolById(player.id);
  } else if ((ref.source === 'independent' || ref.source === 'corporate_team' || ref.source === 'club_team') && ref.teamName) {
    const srcTeam = TEAMS_DATA[ref.teamName];
    if (srcTeam?.players) {
      removeFromRosterById(srcTeam, player.id);
    }
  }
}

/**
 * 入団時に「どこから来たか」を経歴へ残す。
 *
 * 【なぜ必要か】経歴が全部追えると、指名された社会人の経歴に「クラブ」があって
 * 「苦労したんだな」と分かる——それ自体が読み物になる。
 * ⚠ 経歴を残すのは `_poolRef` を消す**前**。消した後だと出身が分からなくなる。
 */
function pushOriginHistory(recruit, ref, year) {
  if (!ref) return;
  if (!recruit.careerHistory) recruit.careerHistory = [];
  const has = (t) => recruit.careerHistory.some(h => h.type === t);
  if (ref.source === 'club_team' && ref.teamName && !has('club')) {
    recruit.careerHistory.push({ type: 'club', year, label: ref.teamName });
  } else if (ref.source === 'independent' && ref.teamName && !has('independent')) {
    recruit.careerHistory.push({ type: 'independent', year, label: ref.teamName });
  } else if (ref.source === 'corporate_team' && ref.teamName) {
    recruit.careerHistory.push({ type: 'corporate', year, label: ref.teamName });
  }
}

/**
 * ユーザーがスカウト候補者を獲得
 * プールから除去し、チームに追加
 */
export function recruitPlayer(team, player) {
  removeFromPool(player);
  const recruit = { ...player };
  const originRef = player._poolRef;
  delete recruit.scoutAccuracy;
  delete recruit.scoutedAbilities;
  delete recruit._poolRef;
  delete recruit._scoutSource;
  recruit.origin = 'scout';
  // 今オフに入団した印。⚠ これが無いと、入団したばかりの選手が次のチームのスカウト候補
  //   （他球団の選手）として拾い直され、同じ日に4球団を渡り歩いていた。年度替わりで消す
  recruit._justRecruited = true;
  recruit.isStarter = false;
  recruit.battingOrder = 0;
  recruit.fatigue = 0;
  pushOriginHistory(recruit, originRef, null);
  if (!recruit.careerHistory) recruit.careerHistory = [];
  recruit.careerHistory.push({ type: 'corporate', year: null, label: team.name });
  addToRoster(team, recruit);
}

/**
 * AIチームの残りスカウト入団処理
 * ユーザー交渉フェーズでライバルとして入団済みの分を考慮し、
 * まだ定員に達していないチームのみ追加獲得
 */
export function processAIScoutRecruitment(allTeams, userTeamName, year) {
  const results = {};

  Object.entries(allTeams).forEach(([teamName, team]) => {
    if (teamName === userTeamName) return;
    if (!team?.players) return;

    const currentSize = team.players.length;
    if (currentSize >= CORPORATE_TARGET_ROSTER) return;

    const need = Math.min(2, CORPORATE_TARGET_ROSTER - currentSize);
    if (need <= 0) return;

    const candidates = generateScoutCandidates(team, year);
    if (candidates.length === 0) return;
    const acquired = [];

    const posCount = { pitcher: 0, catcher: 0, infield: 0, outfield: 0 };
    team.players.forEach(p => {
      if (p.position === 'pitcher') posCount.pitcher++;
      else if (p.position === 'catcher') posCount.catcher++;
      else if (['first', 'second', 'third', 'short'].includes(p.position)) posCount.infield++;
      else posCount.outfield++;
    });

    const sortedCandidates = [...candidates].sort((a, b) => {
      const scoreA = getPositionNeedScore(a.position, posCount);
      const scoreB = getPositionNeedScore(b.position, posCount);
      return scoreB - scoreA;
    });

    for (let i = 0; i < sortedCandidates.length && acquired.length < need; i++) {
      const { success } = attemptRecruitment(team, sortedCandidates[i], team);
      if (success) {
        acquired.push({ name: sortedCandidates[i].name, position: sortedCandidates[i].position });
      }
    }

    if (acquired.length > 0) {
      results[teamName] = acquired;
    }
  });

  return results;
}

function getPositionNeedScore(position, posCount) {
  if (position === 'pitcher' && posCount.pitcher < 8) return 30;
  if (position === 'catcher' && posCount.catcher < 2) return 40;
  if (['first', 'second', 'third', 'short'].includes(position) && posCount.infield < 5) return 20;
  if (['left', 'center', 'right'].includes(position) && posCount.outfield < 4) return 20;
  return 0;
}

// ============================================================
// スカウト派遣システム
// スタッフを選んで派遣先に送り、帰還後に候補をリストアップ
// 発見した選手は段階的に能力が判明する（初回は概要のみ）
// ============================================================

const SCOUT_TARGETS = {
  highschool:   { label: '高校',       days: 14 },
  university:   { label: '大学',       days: 14 },
  independent:  { label: '独立リーグ', days: 10 },
  corporate:    { label: '社会人',     days: 10 },
};

export { SCOUT_TARGETS };

// ============================================================
// スカウト継続タスクシステム
// 各スカウトに「巡回」「自動調査」タスクを割り当て
// キャンセルされるまで自動で繰り返す
// ============================================================

export const MAX_FAVORITES_PER_SCOUT = 3;

/**
 * スカウトに継続タスクを割り当て、初回ミッションを開始する
 * @param {'dispatch'|'investigation'} taskType
 * @param {Object} params - dispatch: { target }, investigation: {}
 */
export function assignScoutTask(teamData, staffId, taskType, params, currentDate, gameYear) {
  const cd = teamData?.corporateData;
  if (!cd) return { success: false, message: '社会人チームではありません' };

  const staff = (cd.staff || []).find(s => s.id === staffId);
  if (!staff) return { success: false, message: 'スタッフが見つかりません' };

  if (!cd.scoutTasks) cd.scoutTasks = {};

  if (cd.scoutTasks[staffId]) {
    cancelScoutTask(teamData, staffId);
  }

  cd.scoutTasks[staffId] = {
    type: taskType,
    target: params?.target || null,
    active: true,
    staffName: staff.name,
    assignedDate: currentDate ? { ...currentDate } : null,
  };

  if (taskType === 'dispatch') {
    const result = dispatchScout(teamData, params.target, staffId, currentDate);
    if (!result.success) {
      delete cd.scoutTasks[staffId];
      return result;
    }
    const targetLabel = SCOUT_TARGETS[params.target]?.label || params.target;
    return { success: true, message: `${staff.name}を${targetLabel}の巡回に配置しました` };
  } else if (taskType === 'investigation') {
    const result = autoStartNextInvestigation(teamData, staffId, currentDate);
    if (result?.success) {
      return { success: true, message: `${staff.name}の自動調査を開始しました` };
    }
    return { success: true, message: `${staff.name}を自動調査に配置しました（調査対象が見つかり次第開始）` };
  }

  return { success: true };
}

/**
 * スカウトの継続タスクをキャンセル（進行中ミッションも中止）
 */
export function cancelScoutTask(teamData, staffId) {
  const cd = teamData?.corporateData;
  if (!cd?.scoutTasks) return;
  delete cd.scoutTasks[staffId];

  if (cd.scoutMissions) {
    cd.scoutMissions.forEach(m => {
      if (m.staffId === staffId && !m.completed) {
        m.completed = true;
        m.cancelled = true;
      }
    });
  }
}


export function getAllScoutTasks(teamData) {
  return teamData?.corporateData?.scoutTasks || {};
}

/**
 * スカウト派遣を開始（スタッフ指定）
 * @param {Object} teamData - TEAMS_DATA[teamName]
 * @param {string} target - 派遣先キー
 * @param {number} staffId - 派遣するスタッフのID
 * @param {{ year, month, day }} currentDate
 */
export function dispatchScout(teamData, target, staffId, currentDate) {
  const cd = teamData?.corporateData;
  if (!cd) return { success: false, message: '社会人チームではありません' };

  const targetDef = SCOUT_TARGETS[target];
  if (!targetDef) return { success: false, message: '無効な派遣先です' };

  const staff = (cd.staff || []).find(s => s.id === staffId);
  if (!staff) return { success: false, message: 'スタッフが見つかりません' };

  if (!cd.scoutMissions) cd.scoutMissions = [];

  // 同じスタッフが既に派遣中なら不可
  if (cd.scoutMissions.find(m => !m.completed && m.staffId === staffId)) {
    return { success: false, message: `${staff.name}は既に派遣中です` };
  }
  // 同じ派遣先に既に派遣中なら不可
  if (cd.scoutMissions.find(m => !m.completed && m.target === target)) {
    return { success: false, message: `${targetDef.label}には既に派遣中です` };
  }

  const returnDate = advanceDate(currentDate, targetDef.days);
  cd.scoutMissions.push({
    target,
    staffId,
    staffName: staff.name,
    staffScoutEye: staff.abilities?.scoutingEye || 30,
    dispatchDate: { ...currentDate },
    returnDate,
    completed: false,
    results: null,
  });

  return { success: true, message: `${staff.name}を${targetDef.label}に派遣しました（${returnDate.month}/${returnDate.day}帰還予定）` };
}

/**
 * 日付進行時にスカウト派遣の完了をチェック（発掘+調査の両方を処理）
 */
export function checkScoutMissionCompletion(teamData, currentDate, gameYear) {
  const cd = teamData?.corporateData;
  if (!cd?.scoutMissions) return [];

  const completed = [];
  cd.scoutMissions.forEach(mission => {
    if (mission.completed) return;
    if (compareDates(currentDate, mission.returnDate) < 0) return;

    mission.completed = true;

    if (mission.type === 'investigation') {
      const targetId = mission.targetPlayerId;
      for (const m of cd.scoutMissions) {
        if (m.type === 'investigation' || !m.results) continue;
        const found = m.results.find(p => p.id === targetId);
        if (found) {
          const prevAbilities = JSON.parse(JSON.stringify(found.scoutedAbilities || {}));
          investigatePlayer(found);
          found.recruitRate = calculateRecruitSuccessRate(found, teamData);
          // 新たに判明した能力を記録
          const newAbilities = found.scoutedAbilities || {};
          const revealed = [];
          const abilityLabels = { meet: 'ミート', power: 'パワー', eye: '選球眼', speed: '走力', defense: '守備', velocity: '球速', control: '制球', stamina: 'スタミナ' };
          const checkPairs = [
            ['batting', 'meet'], ['batting', 'power'], ['batting', 'eye'],
            ['physical', 'speed'], ['fielding', 'defense'],
            ['pitching', 'velocity'], ['pitching', 'control'], ['pitching', 'stamina'],
          ];
          for (const [cat, key] of checkPairs) {
            const prev = prevAbilities[cat]?.[key];
            const curr = newAbilities[cat]?.[key];
            if ((prev === '?' || prev === undefined) && curr !== '?' && curr !== undefined) {
              revealed.push(abilityLabels[key] || key);
            }
          }
          mission._revealedAbilities = revealed;
          mission._newRevealLevel = found._revealLevel;
          break;
        }
      }
    } else {
      mission.results = generateScoutReport(teamData, mission.target, mission.staffScoutEye, gameYear);
    }
    completed.push(mission);

    // Auto-restart for continuous tasks
    const task = cd.scoutTasks?.[mission.staffId];
    if (task?.active && !mission.cancelled) {
      if (task.type === 'dispatch' && !mission.type) {
        dispatchScoutInternal(teamData, task.target, mission.staffId, currentDate);
      } else if (task.type === 'investigation' && mission.type === 'investigation') {
        autoStartNextInvestigation(teamData, mission.staffId, currentDate);
      }
    }
  });

  return completed;
}

/**
 * 発見済み選手を追加調査して能力を明らかにする
 * revealLevel: 0=概要のみ → 1=主要能力 → 2=全能力
 */
export function investigatePlayer(player) {
  const current = player._revealLevel || 0;
  if (current >= 2) return { success: false, message: 'これ以上調査できません' };

  player._revealLevel = current + 1;
  player._investigationCount = (player._investigationCount || 0) + 1;

  const accuracy = player.scoutAccuracy || 50;
  if (player._revealLevel === 1) {
    player.scoutedAbilities = obscureAbilities(player, Math.min(95, accuracy + 15), 'secondary');
  } else if (player._revealLevel === 2) {
    player.scoutedAbilities = obscureAbilities(player, Math.min(99, accuracy + 30), 'full');
  }

  return { success: true, level: player._revealLevel };
}

const INVESTIGATION_DAYS = 3;

/**
 * スカウトを選手の能力調査に派遣する
 * 調査中のスカウトは発掘に行けない
 */
export function startInvestigation(teamData, playerId, playerName, staffId, currentDate) {
  const cd = teamData?.corporateData;
  if (!cd) return { success: false, message: '社会人チームではありません' };

  const staff = (cd.staff || []).find(s => s.id === staffId);
  if (!staff) return { success: false, message: 'スタッフが見つかりません' };

  if (!cd.scoutMissions) cd.scoutMissions = [];

  if (cd.scoutMissions.find(m => !m.completed && m.staffId === staffId)) {
    return { success: false, message: `${staff.name}は現在別の任務中です` };
  }

  const returnDate = advanceDate(currentDate, INVESTIGATION_DAYS);
  cd.scoutMissions.push({
    type: 'investigation',
    targetPlayerId: playerId,
    targetPlayerName: playerName,
    staffId,
    staffName: staff.name,
    staffScoutEye: staff.abilities?.scoutingEye || 30,
    dispatchDate: { ...currentDate },
    returnDate,
    completed: false,
  });

  return { success: true, message: `${staff.name}が${playerName}の調査を開始しました（${returnDate.month}/${returnDate.day}完了）` };
}

/**
 * 自動調査フィルタを設定し、条件に合う選手を順次調査する
 * フィルタ: 年齢範囲、ポジション、能力値範囲
 * スカウトが空いていれば自動的に次の対象を調査開始
 */
export function setAutoInvestigationFilter(teamData, filter) {
  const cd = teamData?.corporateData;
  if (!cd) return;
  cd.autoInvestFilter = filter; // { ageMin, ageMax, positions, abilityMin, abilityMax }
}

export function getAutoInvestigationFilter(teamData) {
  return teamData?.corporateData?.autoInvestFilter || null;
}

/**
 * 自動調査を実行
 * 1. 継続調査タスクを持つ待機中スカウトの次ターゲットを開始
 * 2. グローバルフィルタでタスク未割当スカウトも調査開始
 */
export function processAutoInvestigation(teamData, currentDate) {
  const cd = teamData?.corporateData;
  if (!cd) return [];
  if (!cd.scoutMissions) cd.scoutMissions = [];

  const busyIds = new Set(cd.scoutMissions.filter(m => !m.completed).map(m => m.staffId));
  const started = [];

  // 1. 継続調査タスクを持つ待機中スカウト
  if (cd.scoutTasks) {
    for (const [staffIdStr, task] of Object.entries(cd.scoutTasks)) {
      if (task.type !== 'investigation' || !task.active) continue;
      const staffId = parseInt(staffIdStr);
      if (busyIds.has(staffId)) continue;

      const result = autoStartNextInvestigation(teamData, staffId, currentDate);
      if (result?.success) {
        busyIds.add(staffId);
        started.push({ playerName: result._targetName || '?', staffName: task.staffName });
      }
    }
  }

  // 2. グローバルフィルタ（タスク未割当スカウトのみ）
  if (!cd.autoInvestFilter) return started;
  const filter = cd.autoInvestFilter;
  const allPlayers = getAllScoutedPlayers(cd);
  const pendingInvIds = new Set(cd.scoutMissions.filter(m => m.type === 'investigation' && !m.completed).map(m => m.targetPlayerId));
  const availableStaff = (cd.staff || []).filter(s => !busyIds.has(s.id) && !(cd.scoutTasks || {})[s.id]);

  if (availableStaff.length === 0) return started;

  const targets = filterInvestigationTargets(allPlayers, pendingInvIds, filter);

  for (const target of targets) {
    if (availableStaff.length === 0) break;
    const scout = availableStaff.shift();
    const result = startInvestigation(teamData, target.id, target.name, scout.id, currentDate);
    if (result.success) started.push({ playerName: target.name, staffName: scout.name });
  }
  return started;
}

/**
 * 選手をお気に入りに指定（担当スカウト付き、毎週交渉ボーナス蓄積）
 * assignedStaff: { id, name, negotiation } - 担当スカウト情報
 * 解除時はボーナスを保持し、再登録時に引き継ぐ
 */
export function toggleFavoritePlayer(teamData, playerId, assignedStaff) {
  const cd = teamData?.corporateData;
  if (!cd) return { success: false, message: '社会人チームではありません' };
  if (!cd.favoritePlayerIds) cd.favoritePlayerIds = {};
  if (!cd._favoriteHistory) cd._favoriteHistory = {};

  if (cd.favoritePlayerIds[playerId]) {
    cd._favoriteHistory[playerId] = cd.favoritePlayerIds[playerId].bonus || 0;
    delete cd.favoritePlayerIds[playerId];
    return { success: true, action: 'removed' };
  } else {
    if (assignedStaff?.id) {
      const assignmentCount = Object.values(cd.favoritePlayerIds)
        .filter(f => f.staffId === assignedStaff.id).length;
      if (assignmentCount >= MAX_FAVORITES_PER_SCOUT) {
        return { success: false, message: `${assignedStaff.name}は既に${MAX_FAVORITES_PER_SCOUT}人の選手を担当しています` };
      }
    }
    const prevBonus = cd._favoriteHistory[playerId] || 0;
    cd.favoritePlayerIds[playerId] = {
      startDate: null,
      bonus: prevBonus,
      staffId: assignedStaff?.id || null,
      staffName: assignedStaff?.name || null,
      staffNegotiation: assignedStaff?.negotiation || 0,
    };
    return { success: true, action: 'added' };
  }
}

/**
 * お気に入り選手の週次ボーナス加算（日付進行で毎週呼ぶ）
 * 担当スカウトの交渉力が高いほどボーナス蓄積が大きい
 * 基本+3%/週、交渉力50以上で+4%、80以上で+5%
 */
export function advanceFavoriteBonus(teamData, currentDate) {
  const cd = teamData?.corporateData;
  if (!cd?.favoritePlayerIds) return;

  const dayNum = currentDate.year * 10000 + currentDate.month * 100 + currentDate.day;
  for (const [pid, info] of Object.entries(cd.favoritePlayerIds)) {
    if (!info.startDate) {
      info.startDate = dayNum;
      info.lastAdvance = dayNum;
      continue;
    }
    // 担当スカウトが退団していないか確認し、最新の交渉力を反映
    if (info.staffId) {
      const assignedStaff = (cd.staff || []).find(s => s.id === info.staffId);
      if (assignedStaff) {
        info.staffNegotiation = assignedStaff.abilities?.negotiation || 0;
      }
    }
    if (!info.lastAdvance) info.lastAdvance = info.startDate;
    const daysSince = dateDiffDays(info.lastAdvance, dayNum);
    if (daysSince >= 7) {
      const weeks = Math.floor(daysSince / 7);
      const neg = info.staffNegotiation || 0;
      const weeklyRate = neg >= 80 ? 5 : neg >= 50 ? 4 : 3;
      info.bonus = (info.bonus || 0) + weeks * weeklyRate;
      info.lastAdvance = dayNum;
    }
  }
}

/**
 * お気に入りボーナスを取得（解除中でも蓄積分は残る）
 */
export function getFavoriteBonus(teamData, playerId) {
  const cd = teamData?.corporateData;
  if (cd?.favoritePlayerIds?.[playerId]) {
    return cd.favoritePlayerIds[playerId].bonus || 0;
  }
  return cd?._favoriteHistory?.[playerId] || 0;
}

/**
 * 全スカウトレポートから発見済み選手を統合取得
 */
export function getAllScoutedPlayers(cd) {
  const players = [];
  const seenIds = new Set();
  (cd.scoutMissions || []).forEach(m => {
    if (m.type === 'investigation' || !m.results) return;
    m.results.forEach(p => {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        players.push(p);
      }
    });
  });
  return players;
}

/**
 * スカウト派遣結果を生成（スタッフ個人の能力で判定）
 * 派遣回数に関わらず安定した候補数を返す。
 * 毎回異なる視点（能力重視/交渉容易/将来性/掘り出し物）でピックする。
 */
function generateScoutReport(teamData, target, staffScoutEye, gameYear) {
  const scoutEye = staffScoutEye || 30;
  const reputation = teamData.corporateData?.reputation ?? 30;
  const reputationMult = getReputationScoutBonus(reputation);

  let pool = [];
  if (target === 'highschool') {
    pool = getHighSchoolScoutPool();
  } else if (target === 'university') {
    pool = getUniversityScoutPool(gameYear);
  } else if (target === 'independent') {
    pool = getIndependentScoutPool(teamData);
  } else if (target === 'corporate') {
    pool = [...getCorporateScoutPool(teamData), ...getClubScoutPool(teamData)];
  }

  if (pool.length === 0) return [];

  const candidateCount = Math.min(pool.length, 3 + Math.floor(scoutEye / 14)); // 3〜10人

  // 既にスカウト済みのIDを除外
  const existingIds = new Set();
  (teamData.corporateData?.scoutMissions || []).forEach(m => {
    if (m.results) m.results.forEach(p => existingIds.add(p.id));
  });
  const freshPool = pool.filter(e => !existingIds.has(e.player.id));
  const usePool = freshPool.length >= candidateCount ? freshPool : pool;

  // 4つの視点でスコアリングし、各視点から候補を選出
  const strategies = [
    { name: 'ability', weight: 0.35, score: (entry) => {
      const base = evaluatePlayerScore(entry.player);
      const noise = (Math.random() - 0.5) * 15;
      return base + noise + (reputationMult - 1.0) * 15;
    }},
    { name: 'negotiable', weight: 0.25, score: (entry) => {
      const base = evaluatePlayerScore(entry.player);
      const quality = Math.max(0, 80 - base) * 0.5;
      const age = entry.player.age || 22;
      const ageBonus = age <= 22 ? 10 : age >= 28 ? -5 : 0;
      return quality + ageBonus + (Math.random() - 0.5) * 20;
    }},
    { name: 'growth', weight: 0.2, score: (entry) => {
      const gp = entry.player.growthPotential || 1.0;
      const age = entry.player.age || 22;
      const youth = Math.max(0, (25 - age) * 5);
      return gp * 40 + youth + (Math.random() - 0.5) * 20;
    }},
    { name: 'hidden', weight: 0.2, score: (entry) => {
      const base = evaluatePlayerScore(entry.player);
      const fame = entry.player.fame || 0;
      const hiddenGem = (100 - fame) * 0.3 + base * 0.3;
      const eyeBonus = scoutEye * 0.2;
      return hiddenGem + eyeBonus + (Math.random() - 0.5) * 25;
    }},
  ];

  const selectedMap = new Map();
  strategies.forEach(strat => {
    const count = Math.max(1, Math.round(candidateCount * strat.weight));
    const scored = usePool.map(e => ({ ...e, _stratScore: strat.score(e) }));
    scored.sort((a, b) => b._stratScore - a._stratScore);
    for (const entry of scored) {
      if (selectedMap.size >= candidateCount) break;
      if (!selectedMap.has(entry.player.id)) {
        selectedMap.set(entry.player.id, { ...entry, _strategy: strat.name });
        if ([...selectedMap.values()].filter(e => e._strategy === strat.name).length >= count) break;
      }
    }
  });

  // まだ足りなければ能力順で補充
  if (selectedMap.size < candidateCount) {
    const byAbility = usePool.map(e => ({ ...e, _s: evaluatePlayerScore(e.player) + (Math.random() - 0.5) * 20 }));
    byAbility.sort((a, b) => b._s - a._s);
    for (const entry of byAbility) {
      if (selectedMap.size >= candidateCount) break;
      if (!selectedMap.has(entry.player.id)) selectedMap.set(entry.player.id, entry);
    }
  }

  return [...selectedMap.values()].map(entry => {
    const p = JSON.parse(JSON.stringify(entry.player));
    const accuracy = calculateScoutAccuracy(scoutEye);
    p.scoutAccuracy = accuracy;
    const initialStage = scoutEye >= 90 ? 'full' : scoutEye >= 70 ? 'secondary' : 'primary';
    const initialLevel = initialStage === 'full' ? 2 : initialStage === 'secondary' ? 1 : 0;
    p.scoutedAbilities = obscureAbilities(p, accuracy, initialStage);
    p._revealLevel = initialLevel;
    p._poolRef = { source: entry.source, poolIndex: entry.poolIndex, enrollYear: entry.enrollYear, teamName: entry.teamName };
    p._scoutSource = getSourceLabel(entry);
    p._dispatchTarget = target;
    p._strategy = entry._strategy;
    // 交渉成功率を事前計算
    p.recruitRate = calculateRecruitSuccessRate(p, teamData);
    return p;
  });
}

/**
 * 独立リーグの選手プールを取得
 */
function getIndependentScoutPool(excludeTeam) {
  const pool = [];
  const excludeName = Object.keys(TEAMS_DATA)[0];
  Object.entries(TEAMS_DATA).forEach(([teamName, team]) => {
    if (!team?.players || !team.independentLeagueId) return;
    if (teamName === excludeName) return;
    team.players.forEach((p, idx) => {
      if (p._justRecruited) return;   // 今オフに入団したばかりの選手は引き抜かない
      pool.push({ player: p, source: 'independent', teamName, poolIndex: idx });
    });
  });
  return pool;
}

/**
 * 社会人チーム（企業チーム）の選手プールを取得
 */
function getCorporateScoutPool(excludeTeam) {
  const pool = [];
  const excludeName = Object.keys(TEAMS_DATA)[0];
  Object.entries(TEAMS_DATA).forEach(([teamName, team]) => {
    if (!team?.players || !team.corporateData) return;
    if (team.corporateData.type === 'club') return;
    if (teamName === excludeName) return;
    team.players.forEach((p, idx) => {
      if (p._justRecruited) return;   // 今オフに入団したばかりの選手は引き抜かない
      pool.push({ player: p, source: 'corporate_team', teamName, poolIndex: idx });
    });
  });
  return pool;
}

/**
 * クラブチームの選手プールを取得（社会人視察で発見可能）
 */
function getClubScoutPool(excludeTeam) {
  const pool = [];
  const excludeName = Object.keys(TEAMS_DATA)[0];
  Object.entries(TEAMS_DATA).forEach(([teamName, team]) => {
    if (!team?.players || !team.corporateData) return;
    if (team.corporateData.type !== 'club') return;
    if (teamName === excludeName) return;
    team.players.forEach((p, idx) => {
      if (p._justRecruited) return;   // 今オフに入団したばかりの選手は引き抜かない
      pool.push({ player: p, source: 'club_team', teamName, poolIndex: idx });
    });
  });
  return pool;
}

/**
 * スカウトリストの選手に対する他球団の興味を生成
 * 選手の知名度・能力が高いほど、高ランクチームからの関心が多い
 */
/**
 * AIチームの入札を生成し、各スカウト候補に実際のライバルチーム情報を付与
 * AIチームはポジション不足に応じて候補者を狙う
 */
export function generateRivalInterest(scoutedPlayers) {
  const userTeamName = Object.keys(TEAMS_DATA)[0] || '';
  const playerIdSet = new Set(scoutedPlayers.map(p => p.id));

  // AIチームのポジション需要を分析し、入札を生成
  const bidsPerPlayer = {};
  scoutedPlayers.forEach(p => { bidsPerPlayer[p.id] = []; });

  Object.entries(TEAMS_DATA).forEach(([teamName, team]) => {
    if (teamName === userTeamName) return;
    if (!team?.players || !team.corporateData) return;
    const currentSize = team.players.length;
    if (currentSize >= CORPORATE_TARGET_ROSTER) return;

    const need = Math.min(3, CORPORATE_TARGET_ROSTER - currentSize);
    if (need <= 0) return;

    const rank = team.corporateData?.rank || 'C';
    const reputation = team.corporateData?.reputation || 0;

    // ポジション不足を分析
    const posCount = { pitcher: 0, catcher: 0, infield: 0, outfield: 0 };
    team.players.forEach(p => {
      if (p.position === 'pitcher') posCount.pitcher++;
      else if (p.position === 'catcher') posCount.catcher++;
      else if (['first', 'second', 'third', 'short'].includes(p.position)) posCount.infield++;
      else posCount.outfield++;
    });

    // スカウト候補をポジション需要＋能力でスコアリング
    const scored = scoutedPlayers.map(p => {
      const posNeed = getPositionNeedScore(p.position, posCount);
      if (posNeed <= 0) return null;
      const ability = evaluatePlayerScore(p);
      const interestChance = (posNeed * 2 + ability + reputation * 0.3) / 150;
      if (Math.random() > Math.min(0.8, interestChance)) return null;
      return { player: p, score: posNeed + ability * 0.5 + Math.random() * 20 };
    }).filter(Boolean);

    scored.sort((a, b) => b.score - a.score);
    const bidCount = Math.min(need, scored.length);
    for (let i = 0; i < bidCount; i++) {
      const pid = scored[i].player.id;
      if (bidsPerPlayer[pid]) {
        bidsPerPlayer[pid].push({ teamName, rank, reputation });
      }
    }
  });

  return scoutedPlayers.map(player => {
    player._rivals = bidsPerPlayer[player.id] || [];
    return player;
  });
}

/**
 * 他球団との競合を考慮した交渉
 * player.recruitRate が設定されていれば（スカウトボーナス等含む）それを使う
 * ライバルがいる場合、表示成功率をベースに競合ペナルティを適用
 * 他チームに入団と判定された場合、実際にそのチームに入団させる
 */
export function negotiateWithCompetition(team, player, teamData) {
  const rivals = player._rivals || [];

  // 表示済みの成功率を使う（スカウトボーナス・調査・絆を含む）
  const displayedRate = player.recruitRate ?? calculateRecruitSuccessRate(player, teamData);

  if (rivals.length === 0) {
    // ライバルなし: 行き先がないため交渉が有利（+12%）
    const noRivalBonus = 12;
    const boostedRate = Math.min(95, displayedRate + noRivalBonus);
    const roll = Math.random() * 100;
    const success = roll < boostedRate;
    if (success) recruitPlayer(team, player);
    return { success, rate: boostedRate, rivalResult: null, rivalTeamName: null, noRivalBonus };
  }

  // ライバルがいる場合：表示成功率に競合ペナルティを適用
  // ライバル1社ごとに成功率×0.75（2社で×0.56、3社で×0.42）
  const rivalPenalty = Math.pow(0.75, rivals.length);
  const adjustedRate = Math.max(1, Math.min(95, Math.round(displayedRate * rivalPenalty)));

  const roll = Math.random() * 100;
  const success = roll < adjustedRate;

  if (success) {
    recruitPlayer(team, player);
    return { success, rate: adjustedRate, rivalResult: null, rivalTeamName: null };
  }

  // 失敗時：条件折り合わず(再交渉可) / 他チーム入団 / 辞退
  // ライバルが多いほど他チームに取られやすい
  const rivalTakeChance = Math.min(0.7, rivals.length * 0.2);
  const declineChance = 0.15;

  const fate = Math.random();
  if (fate < rivalTakeChance) {
    // ライバルチームが獲得 → 実際にそのチームに入団させる
    const winnerRival = rivals[Math.floor(Math.random() * rivals.length)];
    const rivalTeam = TEAMS_DATA[winnerRival.teamName];
    if (rivalTeam) {
      recruitPlayerToTeam(rivalTeam, player);
    }
    return { success: false, rate: adjustedRate, rivalResult: winnerRival.rank, rivalTeamName: winnerRival.teamName };
  } else if (fate < rivalTakeChance + declineChance) {
    // 辞退 → ライバルがいればそのチームへ、いなければランダムなチームへ
    const destTeam = pickRandomDestination(player, team);
    return { success: false, rate: adjustedRate, rivalResult: 'declined', rivalTeamName: destTeam };
  }
  // 条件折り合わず → 再交渉可能（candidatesから除去しない）
  return { success: false, rate: adjustedRate, rivalResult: null, rivalTeamName: null };
}

export function pickRandomDestination(player, excludeTeam) {
  const rivals = player._rivals || [];
  if (rivals.length > 0) {
    const pick = rivals[Math.floor(Math.random() * rivals.length)];
    return pick.teamName;
  }
  return null;
}

/**
 * 指定チームに選手を入団させる（ライバルチーム用）
 */
function recruitPlayerToTeam(team, player) {
  removeFromPool(player);
  const recruit = { ...player };
  const originRef = player._poolRef;
  delete recruit.scoutAccuracy;
  delete recruit.scoutedAbilities;
  delete recruit._poolRef;
  delete recruit._scoutSource;
  delete recruit._rivals;
  delete recruit._investigationCount;
  delete recruit._revealLevel;
  recruit.origin = 'scout';
  // 今オフに入団した印。⚠ これが無いと、入団したばかりの選手が次のチームのスカウト候補
  //   （他球団の選手）として拾い直され、同じ日に4球団を渡り歩いていた。年度替わりで消す
  recruit._justRecruited = true;
  recruit.isStarter = false;
  recruit.battingOrder = 0;
  recruit.fatigue = 0;
  pushOriginHistory(recruit, originRef, null);
  if (!recruit.careerHistory) recruit.careerHistory = [];
  recruit.careerHistory.push({ type: 'corporate', year: null, label: team.name });
  addToRoster(team, recruit);
}

/**
 * スカウトリストから交渉可能な選手を集約
 * 完了済みの全派遣ミッションから候補を統合
 */
export function getScoutedCandidates(teamData) {
  const cd = teamData?.corporateData;
  if (!cd?.scoutMissions) return [];

  const candidates = [];
  const seenIds = new Set();
  cd.scoutMissions.forEach(mission => {
    if (!mission.completed || !mission.results) return;
    mission.results.forEach(p => {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        candidates.push(p);
      }
    });
  });
  return candidates;
}

function getSourceLabel(entry) {
  if (entry.source === 'highschool') return entry.player?.highSchool?.name ? entry.player.highSchool.name + '高' : '高校';
  if (entry.source === 'university') return entry.player?.universityTeamName || '大学';
  if (entry.source === 'independent') return entry.teamName || '独立L';
  if (entry.source === 'corporate_team') return entry.teamName || '社会人';
  if (entry.source === 'club_team') return entry.teamName || 'クラブ';
  return 'フリー';
}

// ============================================================
// 継続タスク内部ヘルパー
// ============================================================

function dispatchScoutInternal(teamData, target, staffId, currentDate) {
  const cd = teamData?.corporateData;
  if (!cd) return;
  const targetDef = SCOUT_TARGETS[target];
  if (!targetDef) return;
  const staff = (cd.staff || []).find(s => s.id === staffId);
  if (!staff) return;
  if (!cd.scoutMissions) cd.scoutMissions = [];

  const returnDate = advanceDate(currentDate, targetDef.days);
  cd.scoutMissions.push({
    target,
    staffId,
    staffName: staff.name,
    staffScoutEye: staff.abilities?.scoutingEye || 30,
    dispatchDate: { ...currentDate },
    returnDate,
    completed: false,
    results: null,
    isAutoRedispatch: true,
  });
}

function autoStartNextInvestigation(teamData, staffId, currentDate) {
  const cd = teamData?.corporateData;
  if (!cd) return null;

  const filter = cd.autoInvestFilter;
  const allPlayers = getAllScoutedPlayers(cd);
  const pendingInvIds = new Set(
    (cd.scoutMissions || [])
      .filter(m => m.type === 'investigation' && !m.completed)
      .map(m => m.targetPlayerId)
  );

  const targets = filterInvestigationTargets(allPlayers, pendingInvIds, filter);
  if (targets.length === 0) return null;

  const target = targets[0];
  const result = startInvestigation(teamData, target.id, target.name, staffId, currentDate);
  if (result) result._targetName = target.name;
  return result;
}

function filterInvestigationTargets(allPlayers, pendingInvIds, filter) {
  const getVisibleVal = (p, key) => {
    const sa = p.scoutedAbilities || {};
    const map = {
      velocity: sa.pitching?.velocity, control: sa.pitching?.control, stamina: sa.pitching?.stamina,
      meet: sa.batting?.meet, power: sa.batting?.power, eye: sa.batting?.eye,
      speed: sa.physical?.speed, defense: sa.fielding?.defense,
    };
    const v = map[key];
    return (v === '?' || v === undefined) ? null : (typeof v === 'number' ? v : parseInt(v));
  };

  return allPlayers.filter(p => {
    if ((p._revealLevel || 0) >= 2) return false;
    if (pendingInvIds.has(p.id)) return false;
    if (!filter) return true;
    if (filter.ageMin && p.age < filter.ageMin) return false;
    if (filter.ageMax && p.age > filter.ageMax) return false;
    if (filter.positions && filter.positions.length > 0 && !filter.positions.includes(p.position)) return false;
    if (filter.abilities) {
      for (const [key, range] of Object.entries(filter.abilities)) {
        const val = getVisibleVal(p, key);
        if (val === null) continue;
        if (range.min != null && val < range.min) return false;
        if (range.max != null && val > range.max) return false;
      }
    }
    return true;
  });
}
