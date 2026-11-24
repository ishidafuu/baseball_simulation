import { humanTeamNames } from '../game/teamControl.js';
// ============================================================
// CPU並行世界のロスター管理 - src/season/rosterProgression.js
//
// yearProgressionSystem.js から、大学チームの卒業/新入生補充と、社会人/独立リーグ
// チームの戦力外/補充を担う関数群を抽出したもの。相互に閉じたグループで、他の年間
// 進行ロジックを呼ばないため循環参照はない（import は生成・プール・ロスター系のみ）。
//
// 公開エントリポイント: processUniversityTeamGraduation / releaseCPUCorporatePlayers /
// replenishCorporateRosters / replenishIndependentLeagueRosters（advanceToNextYearから利用）。
// ============================================================

import { applyUniversityYear } from './universityPool.js';
import { highSchoolPool } from '../state/schoolPools.js';
import { generateCatcherLead, RANK_DESC, blankSeasonStats, blankCareerStats } from '../utils/constants.js';
import { generatePositionFitness } from './playerFactory.js';
import { syncPositionToFitness } from '../utils/physics.js';
import { generateHandedness, generateBats } from '../utils/handedness.js';
import { releasedPlayersPool, TEAMS_DATA } from '../teams-data.js';
import { addToReleasedPool, replaceReleasedPool, removeFromReleasedPoolByIds } from '../state/pools.js';
import { addToRoster, replaceRoster } from '../state/roster.js';
import { generateRandomPlayerName } from '../data/playerNames.js';
import { homeBlockOf, blockOfCorporate, HOME_WINDOW } from '../data/regions.js';
import { calcPlayerOverall } from './dispatchSystem.js';
import { reservePlayerIds } from '../state/playerIds.js';

// ============================================================
// プールからの補充の物差し（社会人・独立で共有）
//
// ⚠ **投打で別スケールの素点を使わないこと**。以前は2つの補充関数が
//    それぞれ独自の式を持っており、球速(130台)が正規化されずに乗るので
//    投手の典型値97〜105 対 野手38〜40 と**2.5倍の開き**があった。
//    プールから補充するたび投手が先に取られ、12年で
//    企業 44.5%→84.1% / 独立 40.5%→**92.6%** が投手になっていた。
//    （ポジション補正 ±20/+15 では60点差を覆せず、独立にはそれすら無かった）
// ⚠ 能力は `calcPlayerOverall` ひとつだけを使う。あれは投手側を実測の平均とσで
//    野手スケールへ平行移動してあり、**この作品で唯一 投打を比べられる絶対値**
//    （`dispatchSystem.js`。新しい係数を作らないこと——独自に持ったのが原因そのもの）。
// ⚠ 物差し（平均・σ）は**候補プールから毎回作る**。固定の表に持つと生成側を
//    触るたびに腐る（`scoutTools.buildToolNorms` と同じ理由）。
// ============================================================

/** この作品の守備位置キー。⚠ `first_base` / `shortstop` などは**存在しない** */
const RECRUIT_POS_KEYS = ['catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];

/** ロスターの投手需要（トライアウトの `buildPositionBag` と同じ 10/24） */
const PITCHER_TARGET = 10 / 24;
/** 投打比のズレを z に変える係数。ズレ0.10 で ±0.5σ */
const RATIO_Z_W = 5.0;
/** そのポジションが不在 / 1人だけ のときの上積み（z） */
const POS_MISSING_Z = 0.9;
const POS_THIN_Z = 0.55;
/** 地元の上積み（z）。⚠ 加点は「他の項の大きさ」ではなく**能力の幅**で決めること
 *  （以前の能力スコアへの加点 HOME_BONUS は「30点満点のポジション補正より小さいから安全」と
 *   見積もって 10 にしたら同じ地区が85.2%になった。高卒の能力スコアは31前後に密集していて
 *   幅が狭く、+10 は分布そのものより大きい。実測: 1→25.6% / 2→42.9% / 3→54.3% /
 *   5→68.6% / 10→85.2%（無作為 8.5%）） */
const HOME_Z = 0.25;
/** 1人選ぶときに見る窓。能力順に並んだ中の上位N人からポジション需要で選び直す */
const PICK_WINDOW = 24;
/** 放出候補に挙げる総合力の床。チーム所属選手の平均が約40なので、下位3割あたり */
const RELEASE_ABILITY_FLOOR = 36;

/** ポジション群。`playerValue.valueGroup` と同じ切り方（捕手は別に見る） */
const recruitGroup = (p) =>
  p?.position === 'pitcher' ? 'P' : p?.position === 'catcher' ? 'C' : 'F';

/**
 * 候補プールから**群ごとに**能力の平均・σを作る。
 *
 * ⚠ **群ごとにすること**。`calcPlayerOverall` は投打で揃えてあるが、その較正の
 *    母集団は「チームに所属している選手」で、**リリースプール（大学卒業生が主体）
 *    では揃っていない**（CLAUDE.md の実測: 高校生プールで 投手27.5 対 野手35.5）。
 *    群をまたいで1本の順位表にすると、能力順に並べた時点で野手が全部先に取られる
 *    ——実測で補充後のプールが **400名すべて投手**になり、余った投手がクラブへ
 *    流れて クラブ67.6% / 企業20.3% という逆向きの偏りが出た。
 * ⚠ 平均・σは**プールから毎回作る**（固定の表に持つと生成側を触るたびに腐る）。
 */
export function buildRecruitNorms(pool) {
  const by = { P: [], C: [], F: [] };
  for (const p of pool) {
    const v = calcPlayerOverall(p);
    if (Number.isFinite(v)) by[recruitGroup(p)].push(v);
  }
  const stat = (vals, fallback) => {
    if (vals.length < 8) return fallback;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
    return { mean, sd };
  };
  const all = stat([...by.P, ...by.C, ...by.F], { mean: 40, sd: 8 });
  // 捕手は人数が少ないので、足りなければ野手の物差しを借りる
  const f = stat(by.F, all);
  return { P: stat(by.P, all), C: stat(by.C, f), F: f };
}

export function abilityZ(player, norms) {
  const n = norms[recruitGroup(player)] || norms.F;
  return (calcPlayerOverall(player) - n.mean) / n.sd;
}

/**
 * C/Dランク向けの将来性寄りの並び。旧 `calcProspectScore` の重み（0.60/0.25/0.15）を
 * そのまま z の世界へ移したもの。プロ意識 N(50,18) / 成長率は 1.0 からの上振れを見る。
 */
function prospectZ(player, norms) {
  const disc = ((player.personality?.discipline ?? 50) - 50) / 18;
  const gp = Math.max(0, (player.growthPotential || 1.0) - 1.0) / 0.2;
  return abilityZ(player, norms) * 0.60 + disc * 0.25 + gp * 0.15;
}

/** ロスターの野手をポジション別に数える（投手は除く） */
function rosterPositionCounts(team) {
  const counts = {};
  RECRUIT_POS_KEYS.forEach(pos => { counts[pos] = 0; });
  for (const p of (team.players || [])) {
    if (p.position === 'pitcher') continue;
    const pos = p.subPosition || p.position;
    if (pos in counts) counts[pos]++;
  }
  return counts;
}

/**
 * 「今このチームに足りているか」を z で返す。
 * ⚠ 投打の偏りは**連続的に**効かせること。閾値でしか動かないと、境界の内側では
 *    どれだけ偏っても補正がゼロになり、偏りが戻らない。
 */
const scarcityOf = (cnt) => (cnt === 0 ? POS_MISSING_Z : cnt === 1 ? POS_THIN_Z : 0);

function recruitPositionBoost(player, team) {
  const players = team.players || [];
  const total = players.length;
  const pitchers = players.filter(p => p.position === 'pitcher').length;
  const ratio = total > 0 ? pitchers / total : PITCHER_TARGET;
  const gap = ratio - PITCHER_TARGET;          // + なら投手過多
  if (player.position === 'pitcher') return -gap * RATIO_Z_W;

  // ⚠ **不在の加点は「野手の中での並べ替え」にしか使わないこと**。守備位置は8つ
  //    あるので、どのロスターでも必ずどれかが 0〜1人になる。素のまま足すと
  //    **野手だけが常に加点される**ことになり、投打の釣り合いそのものが野手側へ
  //    ずれる（実測: 企業 44.5%→19.7% / 独立 40.5%→**9.7%** と逆に振り切れた）。
  //    そのチームの8ポジションの平均を引いて、合計が0になるようにする。
  const counts = rosterPositionCounts(team);
  const meanScarcity =
    RECRUIT_POS_KEYS.reduce((s, k) => s + scarcityOf(counts[k]), 0) / RECRUIT_POS_KEYS.length;
  const pos = player.subPosition || player.position;
  const scarcity = (pos in counts) ? scarcityOf(counts[pos]) : 0;
  return gap * RATIO_Z_W + (scarcity - meanScarcity);
}

const homeZ = (player, teamBlock) =>
  (teamBlock && homeBlockOf(player) === teamBlock) ? HOME_Z : 0;

// ============================================================
// 入団ルート（今年どこから出てきた選手か）
//
// リリースプールには 大学の新卒 / 高校の新卒 / 放出されたベテラン / 独立を
// 辞めた選手 が**1本に混ざる**。能力順に取ると、19歳の高卒は大卒やベテランに
// 必ず負けるので、企業に若手が1人も入らなくなっていた
// （実測: 企業の22歳以下が 初年6% → 3年で2% → 15年で**0%**）。
// 実際の社会人の入社は 大卒6割 / 高卒3割 / クラブ・独立などは例外。
// ⚠ 印は**その年だけ**有効（`_freshYear`）。拾われずにプールに残った選手は
//    翌年は「その他」になる——新卒は1年しか新卒ではない。
// ============================================================
export const ENTRY_ROUTE_SHARE = { university: 0.60, highschool: 0.30, other: 0.10 };
const ENTRY_ROUTES = ['university', 'highschool', 'other'];

export function markFreshRoute(p, route, year) {
  p._freshRoute = route;
  p._freshYear = year;
}
const freshRouteOf = (p, year) => (p?._freshYear === year ? p._freshRoute : null);
const corpEntryRoute = (p, year) => {
  const r = freshRouteOf(p, year);
  return (r === 'university' || r === 'highschool') ? r : 'other';
};
const clearFreshRoute = (p) => { delete p._freshRoute; delete p._freshYear; };

// ============================================================
// 独立・クラブの新陳代謝（`processLowerTierTurnover`）
// ============================================================
// 独立はプロへの通過点。プロの目が届くのはせいぜい24歳までなので、
// 25歳から年齢とともに去る。⚠ 旧実装は「30歳以上かつ出場が少ない」ときしか
// 放出候補にならず、20代は一度も入れ替わらなかった（実測 入れ替わり 年1〜8%、
// 平均年齢 23→28歳、28〜32歳が最大66%）。
const IND_LEAVE_BY_AGE = (age) =>
  age >= 28 ? 0.85 : age === 27 ? 0.70 : age === 26 ? 0.55 : age === 25 ? 0.40 : 0;
/** 24歳以下でもチーム内の下位3分の1は見切りをつける */
const IND_YOUNG_WEAK_LEAVE = 0.25;
/** 独立が新たに受け入れる年齢の上限（去る年齢帯の手前） */
const IND_MAX_ENTRY_AGE = 26;
/**
 * 独立の入団ルート。トライアウトは高卒も大卒も大勢受ける。
 * ⚠ 企業（大卒6割）より高卒を厚くする——大学4年を待たずに試合で勝負したい
 * 高卒が集まる場所（`distributeHighSchoolGraduates` の「即戦力志向型」と同じ考え）
 */
export const IND_ENTRY_ROUTE_SHARE = { university: 0.45, highschool: 0.40, other: 0.15 };
/** これ以上の実力（独立の中の同じ群での z）なら社会人・クラブへ続ける道を残す */
const IND_RESCUE_Z = -0.3;
/**
 * クラブは実力が低いか、趣味で続ける場所。辞める理由は能力より生活なので
 * **年齢だけ**で決める。⚠ 旧実装にはクラブ固有の引退が無く、最年長が
 * 34歳→47歳と伸び続けた。40代が居るのは良いが、細らせる。
 */
const CLUB_RETIRE_BY_AGE = (age) =>
  age >= 45 ? 0.50 : age >= 40 ? 0.25 : age >= 35 ? 0.12 : age >= 30 ? 0.06 : 0.03;

const toRetirementEntry = (player, teamName, reason) => ({
  name: player.name, team: teamName, age: player.age, position: player.position,
  throws: player.physical?.throws || 'right', bats: player.batting?.bats || 'right',
  hallOfFame: false, reason, careerStats: player.careerStats,
  careerHistory: player.careerHistory || null, secondCareer: null,
  draftInfo: player.draftInfo || null, yearsPlayed: player.yearsPlayed,
});

/**
 * 独立・クラブの年ごとの入れ替わり。**独立の戦力外はここが唯一の担当**
 * （`releaseCPUCorporatePlayers` / `processCorporateRetirements` は独立を扱わない。
 * 「戦力外は1チーム年1回・1箇所」）。
 * 自リーグ（`excludeTeams`）と自チームは対象外——`ContractScreen` が担当する。
 * @returns {{ retirements: Array, rescued: number }}
 */
export function processLowerTierTurnover(allTeams, currentYear, excludeTeams = []) {
  const userTeamName = Object.keys(allTeams)[0];
  const skip = new Set([...humanTeamNames(allTeams, userTeamName), ...excludeTeams]);
  const retirements = [];
  let rescued = 0;

  // 独立の実力の物差しは独立の全選手から作る（群ごと）
  const indNorms = buildRecruitNorms(
    Object.values(allTeams).filter(t => t?.independentLeagueId).flatMap(t => t.players || []));

  for (const [teamName, team] of Object.entries(allTeams)) {
    if (skip.has(teamName) || !team?.players?.length) continue;
    const isInd = !!team.independentLeagueId;
    const isClub = !isInd && team.corporateData?.type === 'club';
    if (!isInd && !isClub) continue;

    const leaving = new Set();   // ⚠ id ではなく実体で消す（id はチーム間で衝突する）
    if (isInd) {
      const zOf = new Map(team.players.map(p => [p, abilityZ(p, indNorms)]));
      const sorted = [...zOf.values()].sort((a, b) => a - b);
      const weakCut = sorted[Math.floor(sorted.length / 3)] ?? -Infinity;
      for (const p of team.players) {
        const age = p.age || 20;
        const z = zOf.get(p);
        const prob = age >= 25 ? IND_LEAVE_BY_AGE(age) : (z <= weakCut ? IND_YOUNG_WEAK_LEAVE : 0);
        if (Math.random() >= prob) continue;
        leaving.add(p);
        if (z >= IND_RESCUE_Z) {
          // 救済: 実力があれば社会人・クラブで続ける道を残す（リリースプールへ）
          const c = JSON.parse(JSON.stringify(p));
          c.isStarter = false;
          c.battingOrder = 0;
          c.releasedYear = currentYear;
          c.previousTeam = teamName;
          c.isReleasedCandidate = true;
          if (!c.careerHistory) c.careerHistory = [];
          c.careerHistory.push({ type: 'released', year: currentYear, label: `${teamName}退団` });
          markFreshRoute(c, 'independent', currentYear);
          addToReleasedPool(c);
          rescued++;
        } else {
          retirements.push(toRetirementEntry(p, teamName, '引退（独立）'));
        }
      }
    } else {
      for (const p of team.players) {
        if (Math.random() < CLUB_RETIRE_BY_AGE(p.age || 20)) {
          leaving.add(p);
          retirements.push(toRetirementEntry(p, teamName, '引退（クラブ）'));
        }
      }
    }
    if (leaving.size) team.players = team.players.filter(p => !leaving.has(p));
  }
  return { retirements, rescued };
}

/**
 * 大学モード: TEAMS_DATA上のチームから4年生を卒業させ、新入生を補充
 * - 4年生(age>=22)は卒業 → NPBドラフト済みは除去済み、残りは進路振り分け
 * - 全チームに推薦入学+一般入部で新1年生を補充
 */
export function processUniversityTeamGraduation(allTeams, seasonData, currentYear) {
  const userTeamName = seasonData.userTeamName || Object.keys(allTeams)[0];
  const report = {
    graduated: [],    // ユーザーチームの卒業生のみ
    recruited: [],    // ユーザーチームの新入生のみ
    npbDrafted: [],
    postGradPaths: { corporate: 0, independent: 0, club: 0, retired: 0 },
    clubGraduates: [], // クラブ行き卒業生（step 5.65で使用）
  };

  // === Pass 1: 全チームの卒業生を収集し合算スコアで相対評価 ===
  // 絶対値閾値ではなく順位ベースで振り分けることで、ランクに関係なく適切な比率が保たれる
  const allGradsScored = [];
  const perTeamData = {};

  for (const [teamName, teamData] of Object.entries(allTeams)) {
    if (!teamData?.players || !teamData.universityData) continue;
    const rank = teamData.universityData.rank || 'C';
    const isUserTeam = teamName === userTeamName;

    const graduates = [];
    const remaining = [];
    teamData.players.forEach(p => {
      if (p.age >= 23 || (p.universityYear && p.universityYear >= 4)) {
        graduates.push(p);
      } else {
        remaining.push(p);
      }
    });

    graduates.forEach(grad => {
      const gp = grad.growthPotential || 1.0;
      const discipline = grad.personality?.discipline ?? 50;
      allGradsScored.push({ player: grad, teamName, gp, discipline });
    });

    perTeamData[teamName] = { graduates, remaining, rank, isUserTeam, teamData };
  }

  // 進路の順位。⚠ **能力は群ごとの z（`abilityZ`）で比べること**。以前は
  //    投手 `(球速-120)×1.5+制球+…` 対 野手 `ミート+パワー+…` の投打で別スケールで、
  //    上位（社会人・独立）が片方の群に偏っていた（社会人・独立の投手偏重と同じ型の誤り）。
  //    成長力・プロ意識は「低能力でも伸びしろがある選手が一定数残れる」ための上乗せ。
  const gradNorms = buildRecruitNorms(allGradsScored.map(e => e.player));
  allGradsScored.forEach(e => {
    e.compositeScore = abilityZ(e.player, gradNorms)
      + Math.max(0, (e.gp - 0.9) * 1.2) + Math.max(0, (e.discipline - 40) * 0.008);
  });
  allGradsScored.sort((a, b) => b.compositeScore - a.compositeScore);
  const total = allGradsScored.length;
  // ⚠ 割合は旧・プール側の卒業（社会人35% / 独立25%）に揃える。大学生の実体を名簿へ
  //    一本化したので、旧・名簿側の 22% / 15% のままだと社会人・独立へ流れる大卒が
  //    ほぼ半減し、企業の入団ルート（大卒6割）が細る
  const corpCut = Math.floor(total * 0.35);
  const indCut  = Math.floor(total * 0.60);
  // 残り: gp≥1.1かつdiscipline≥60 → クラブ、それ以外 → 引退

  allGradsScored.forEach(({ player: grad, gp, discipline }, idx) => {
    grad.isStarter = false;
    grad.battingOrder = 0;
    grad.origin = 'university';
    grad.isReleasedCandidate = true;

    if (idx < corpCut) {
      grad.postGradPath = 'corporate';
      markFreshRoute(grad, 'university', currentYear);
      addToReleasedPool(grad);
    } else if (idx < indCut) {
      grad.postGradPath = 'independent';
      markFreshRoute(grad, 'university', currentYear);
      addToReleasedPool(grad);
    } else if (gp >= 1.1 && discipline >= 60) {
      grad.postGradPath = 'club';
      report.clubGraduates.push(grad);
    } else {
      grad.postGradPath = 'retired';
    }
  });

  // === Pass 2: チームごとにロスター更新 / ユーザーチームのみレポート生成 ===
  for (const [teamName, { graduates, remaining, rank, isUserTeam, teamData }] of Object.entries(perTeamData)) {
    if (isUserTeam) {
      graduates.forEach(grad => {
        report.postGradPaths[grad.postGradPath]++;
        report.graduated.push({
          name: grad.name,
          team: teamName,
          position: grad.position,
          age: grad.age,
          path: grad.postGradPath,
          gp: grad.growthPotential,
          discipline: grad.personality?.discipline,
          stats: grad.position === 'pitcher'
            ? { velocity: grad.pitching?.velocity, control: grad.pitching?.control, stamina: grad.pitching?.stamina }
            : { meet: grad.batting?.meet, power: grad.batting?.power, eye: grad.batting?.eye, speed: grad.physical?.speed },
          careerStats: grad.careerStats ? {
            batting: { atBats: grad.careerStats.batting?.atBats || 0, hits: grad.careerStats.batting?.hits || 0, homeruns: grad.careerStats.batting?.homeruns || 0 },
            pitching: { wins: grad.careerStats.pitching?.wins || 0, saves: grad.careerStats.pitching?.saves || 0, inningsPitched: grad.careerStats.pitching?.inningsPitched || 0 },
          } : null,
          _playerRef: grad, // 配属完了後に nextYearTeam を転記するための一時参照
        });
      });
    }

    // 在学生の1年（成長＋知名度）→ 進級。⚠ 大学生の成長はここが唯一の経路。
    //    以前は裏の大学プールにしか掛からず、名簿の大学生は伸びなかった
    graduates.forEach(p => applyUniversityYear(p, {
      rank, teamId: teamData.universityTeamId, teamName, universityYear: 4, currentYear, grow: false,
    }));
    remaining.forEach(p => {
      const uy = Math.max(1, Math.min(3, p.universityYear || ((p.age || 19) - 19)));
      applyUniversityYear(p, { rank, teamId: teamData.universityTeamId, teamName, universityYear: uy, currentYear });
      p.universityYear = uy + 1;
    });

    // スカウト推薦入部者（ユーザーチームのみ）
    //
    // ⚠ **プールから外す対象は、フラグを消す「前」に確保すること**。
    //    以前は `delete p._universityReserved` を先に実行してから
    //    `filter(p => p._universityReserved !== teamName)` で除去していたので、
    //    **フラグが既に消えていて条件が全員 true になり、誰も除去されなかった**。
    //    推薦入部した選手が高校生プールに残り続け、その後
    //    `distributeHighSchoolGraduates` が社会人・独立へも配るため、
    //    **同じ選手が「大学 ＋ 社会人 ＋ 自由契約」と3箇所に増える**。
    //    実際に選手検索で同名3人（不変量の 器用さ・成長率・左右が完全一致）として現れた。
    //    ⚠ 一般入部の経路（`generateUniversityFreshmen`）は `takenIds` を先に取って
    //    いて正しい。**同じ処理の片方だけ順序が違う**という形の欠陥だった。
    //    ⚠ id ではなく**オブジェクトの同一性**で除去する。id はチーム内でしか
    //    一意でない（実測で自リーグ4チーム間に157件の衝突がある）。
    const scoutedPlayers = [];
    if (isUserTeam && highSchoolPool.players) {
      const reserved = highSchoolPool.players.filter(p => p._universityReserved === teamName);
      const reservedSet = new Set(reserved);
      reserved.forEach(p => {
        delete p._universityReserved;
        p.universityTeamId = teamData.universityTeamId;
        p.universityTeamName = teamName;
        p.universityYear = 1;
        p.recruitType = p._isSelectionPick ? 'selection' : 'scouted';
        p.age = 19;
        p.isStarter = false;
        p.battingOrder = 0;
        if (!p.positionFitness) p.positionFitness = generatePositionFitness(p.position);
        syncPositionToFitness(p);
        if (!p.careerHistory) p.careerHistory = [];
        p.careerHistory = p.careerHistory.filter(h => h.type !== 'university');
        p.careerHistory.push({ type: 'university', year: currentYear + 1, label: teamName });
        p.seasonStats = blankSeasonStats();
        if (!p.careerStats) p.careerStats = blankCareerStats();
        scoutedPlayers.push(p);
      });
      highSchoolPool.players = highSchoolPool.players.filter(p => !reservedSet.has(p));
    }

    // ⚠ **AIの大学の新入生は `enrollInUniversity`（高校生の進路振り分け）だけが入れる**。
    //    以前はここでも全校に「一般入部」を高校生プールの下位帯から取り、足りなければ
    //    `generateFreshmanPlayer` で作っていた（年約700人。直球を持たない投手・
    //    存在しないフォーム名が混じる）。入口が2つあったせいで大学生が設計の2倍いた。
    //    自チーム（大学モード）だけは推薦・セレクション・一般入部をここで入れる。
    const maxRoster = isUserTeam ? 60 : Infinity;
    const targetSize = Math.min(getUniversityTargetRosterSize(rank), maxRoster);
    const rawNeeded = isUserTeam
      ? Math.max(0, Math.max(graduates.length, targetSize - remaining.length) - scoutedPlayers.length)
      : 0;
    const neededCount = (isUserTeam && scoutedPlayers.length > 0)
      ? Math.min(rawNeeded, Math.ceil(scoutedPlayers.length / 2))
      : rawNeeded;
    const newPlayers = generateUniversityFreshmen(neededCount, rank, teamName, teamData, currentYear);
    const allNewPlayers = [...scoutedPlayers, ...newPlayers];

    if (isUserTeam) {
      report.recruited.push(...allNewPlayers.map(p => ({
        name: p.name, team: teamName, position: p.position, type: p.recruitType,
      })));
      allNewPlayers.forEach(p => { p.isActive = false; });
    }

    const finalRoster = [...remaining, ...allNewPlayers];
    if (isUserTeam && finalRoster.length > 60) finalRoster.splice(60);
    replaceRoster(teamData, finalRoster);
  }

  return report;
}

// ランク別目標ロスターサイズ
function getUniversityTargetRosterSize(rank) {
  // 学年あたり人数×4学年（S:14, A:12, B:10, C:8, D:6）
  const sizes = { S: 56, A: 48, B: 40, C: 32, D: 24 };
  return sizes[rank] || 32;
}

// 選手能力の簡易スコア（円環インポート回避のためローカル定義）
function calcFreshmanScore(p) {
  if (p.position === 'pitcher') {
    return ((p.pitching?.velocity || 130) - 120) * 1.5 + (p.pitching?.control || 40) + (p.pitching?.stamina || 60) * 0.4;
  }
  return (p.batting?.meet || 0) + (p.batting?.power || 0) + (p.physical?.speed || 0) * 0.5 + (p.fielding?.defense || 0) * 0.3;
}

// 新入生を高校生プールから選出（セレクション・一般入部ともにプール由来）
function generateUniversityFreshmen(count, rank, teamName, teamData, currentYear) {
  if (count <= 0) return [];
  const newPlayers = [];

  if (highSchoolPool.players && highSchoolPool.players.length > 0) {
    const available = highSchoolPool.players.filter(p => !p._universityReserved);

    // ランク別能力帯（セレクション帯より若干下位）
    const GEN_BAND_LO = { S: 0.35, A: 0.48, B: 0.60, C: 0.70, D: 0.78 };
    const GEN_BAND_HI = { S: 0.85, A: 0.90, B: 0.93, C: 0.96, D: 1.00 };
    const lo = GEN_BAND_LO[rank] ?? 0.70;
    const hi = GEN_BAND_HI[rank] ?? 0.96;

    const scored = available
      .map(p => ({ p, score: calcFreshmanScore(p) }))
      .sort((a, b) => b.score - a.score);

    const n = scored.length;
    const band = scored.slice(Math.floor(n * lo), Math.min(n, Math.ceil(n * hi)));

    // 投手比率を約35%に制限（能力スコアで投手に偏らないよう位置別均等選出）
    const pitcherTarget = Math.round(count * 0.35);
    const fielderTarget = count - pitcherTarget;
    const bandPitchers = band.filter(e => e.p.position === 'pitcher').sort(() => Math.random() - 0.5);
    const bandFielders = band.filter(e => e.p.position !== 'pitcher').sort(() => Math.random() - 0.5);
    const picks = [
      ...bandPitchers.slice(0, pitcherTarget),
      ...bandFielders.slice(0, fielderTarget),
    ].sort(() => Math.random() - 0.5);

    if (picks.length > 0) {
      const takenIds = new Set(picks.map(({ p }) => p.id));
      // 選んだ選手をプールから即除去（他チームとの重複を防ぐ）
      highSchoolPool.players = highSchoolPool.players.filter(p => !takenIds.has(p.id));

      for (const { p: orig } of picks) {
        const p = JSON.parse(JSON.stringify(orig));
        p.universityTeamId = teamData.universityTeamId;
        p.universityTeamName = teamName;
        p.universityYear = 1;
        p.recruitType = 'general';
        p.age = 19;
        p.isStarter = false;
        p.battingOrder = 0;
        if (!p.positionFitness) p.positionFitness = generatePositionFitness(p.position);
        syncPositionToFitness(p);
        if (!p.careerHistory) p.careerHistory = [];
        p.careerHistory.push({ type: 'university', year: currentYear + 1, label: teamName });
        p.seasonStats = blankSeasonStats();
        if (!p.careerStats) p.careerStats = blankCareerStats();
        newPlayers.push(p);
      }
    }
  }

  // プール不足時のフォールバック生成
  if (newPlayers.length < count) {
    const remaining = count - newPlayers.length;
    const nextId = reservePlayerIds(10001);
    for (let i = 0; i < remaining; i++) {
      const player = generateFreshmanPlayer(nextId(), rank, false);
      player.universityTeamId = teamData.universityTeamId;
      player.universityTeamName = teamName;
      player.universityYear = 1;
      player.recruitType = 'general';
      if (!player.careerHistory) player.careerHistory = [];
      player.careerHistory.push({ type: 'university', year: currentYear + 1, label: teamName });
      newPlayers.push(player);
    }
  }

  return newPlayers;
}

// 新入生1人を生成
function generateFreshmanPlayer(id, teamRank, isRecommended) {
  const name = generateRandomPlayerName();

  const isPitcher = Math.random() < 0.35;
  const position = isPitcher ? 'pitcher' : ['catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'][Math.floor(Math.random() * 8)];

  // 左右比率は src/utils/handedness.js に一元化（右打56% / 左打41% / 両打3%）
  const { throws, bats } = generateHandedness();

  // 推薦入学は能力が高い、一般入部は低め
  const rankBase = { S: 40, A: 35, B: 30, C: 25, D: 20 };
  const base = (rankBase[teamRank] || 25) + (isRecommended ? 10 : 0);
  const variance = () => Math.floor(Math.random() * 15) - 5;

  const meet = Math.max(5, base + variance());
  const power = Math.max(5, base + variance());
  const eye = Math.max(5, base - 5 + variance());
  const speed = Math.max(5, base + variance());
  const arm = Math.max(5, base + variance());
  const defense = Math.max(5, base + variance());
  const steal = Math.max(5, base - 10 + variance());

  const velBase = { S: 138, A: 135, B: 131, C: 127, D: 123 };
  const velocity = (velBase[teamRank] || 128) + (isRecommended ? 3 : 0) + Math.floor(Math.random() * 6) - 2;
  const control = Math.max(10, base + variance());
  const stamina = 60 + Math.floor(Math.random() * 40);

  const forms = ['overhand', 'three_quarter', 'sidearm', 'underhand'];
  const formWeights = [50, 30, 15, 5];
  let formRoll = Math.random() * 100, formIdx = 0;
  for (let i = 0; i < formWeights.length; i++) {
    formRoll -= formWeights[i];
    if (formRoll <= 0) { formIdx = i; break; }
  }

  const pitchTypes = ['slider', 'curve', 'fork', 'changeup', 'sinker', 'cutter', 'shoot'];
  const arsenal = [{ id: 1, type: pitchTypes[Math.floor(Math.random() * pitchTypes.length)], level: 15 + Math.floor(Math.random() * 25) }];
  if (Math.random() < 0.4) {
    let second = pitchTypes[Math.floor(Math.random() * pitchTypes.length)];
    if (second !== arsenal[0].type) arsenal.push({ id: 2, type: second, level: 10 + Math.floor(Math.random() * 20) });
  }

  const positionFitness = generatePositionFitness(position);

  const norm = () => Math.max(1, Math.min(100, Math.round(50 + (Math.sqrt(-2 * Math.log(Math.random() || 0.001)) * Math.cos(2 * Math.PI * Math.random())) * 18)));
  const growthPotential = 0.7 + Math.random() * 0.6;

  return {
    id,
    name,
    age: 19,
    position,
    battingOrder: 0,
    isStarter: false,
    isTwoWay: false,
    batting: { meet, power, eye, bats, steal, bunt: Math.max(5, Math.round(meet * 0.4 + speed * 0.3 + Math.random() * 15)) },
    physical: { speed, arm, throws, bodyStamina: 40 + Math.floor(Math.random() * 20), recovery: 40 + Math.floor(Math.random() * 20), muscle: 30 + Math.floor(Math.random() * 20), dexterity: 30 + Math.floor(Math.random() * 20) },
    fielding: { defense },
    catching: { lead: position === 'catcher' ? generateCatcherLead(19) : 10 },
    pitching: { velocity, control, stamina, form: forms[formIdx], arsenal },
    traits: [],
    positionFitness,
    personality: { discipline: norm(), mental: norm() },
    growthPotential,
    growthModifier: 0,
    fame: 0,
    experience: 0,
    fatigue: 0,
    seasonStats: blankSeasonStats(),
    careerStats: blankCareerStats(),
    careerHistory: [{ type: 'highschool', label: '高校卒' }],
  };
}

// ============================================================
// 独立リーグAIチームのロスター補充
// リリースプール（高卒/大卒/社会人/元チーム選手）から獲得し、
// 不足分は新規生成で埋める
// ============================================================

// ============================================================
// 社会人AIチームのロスター補充
// 毎年のオフシーズンにリリースプールから選手を獲得し、
// 退団・ドラフト指名で減った選手を補充する
// ============================================================

const CORP_ROSTER_TARGET = { S: 35, A: 32, B: 28, C: 25, D: 18 };

// ============================================================
// CPU社会人チームの自動戦力外通告（非社会人モード用）
// 社会人モードでは CorporateDepartureScreen が担当するため、
// 独立・大学モードでのみ呼び出す
//
// ⚠ **1チームの戦力外は年1回・1箇所だけ**。担当は以下のとおり分かれている:
//     自リーグ（プレイヤーが対戦するチーム）… `ContractScreen`（11/9）
//     背景の社会人・独立                     … この関数（年度替わり）
//     クラブ                                 … step 5.65
//     大学                                   … `processUniversityTeamGraduation`（卒業のみ・放出なし）
//   `excludeTeams` に自リーグを渡して二重処理を避ける。
// ============================================================
export function releaseCPUCorporatePlayers(allTeams, currentYear, excludeTeams = []) {
  const userTeamName = Object.keys(allTeams)[0];
  const skip = new Set([...humanTeamNames(allTeams, userTeamName), ...excludeTeams]);

  for (const [teamName, team] of Object.entries(allTeams)) {
    if (skip.has(teamName)) continue;   // 自チーム＋自リーグは ContractScreen が担当
    if (!team?.corporateData) continue;
    if (team.corporateData.type === 'club') continue;  // クラブは processLowerTierTurnover
    // ⚠ 独立は `processLowerTierTurnover` が唯一の担当（ここでも切ると年に二度放出になる）
    if (team.independentLeagueId) continue;

    const players = team.players;
    if (!players || players.length === 0) continue;

    const MIN_KEEP = team.independentLeagueId ? 16 : 18;
    if (players.length <= MIN_KEEP) continue;

    // 出場数は**同じ群（投手/野手）の中での相対**で見る。
    // ⚠ **投手と野手を同じ試合数で測らないこと**。1年の出場は投手が登板数・
    //    野手が出場試合数で、そもそも桁が違う（実測 平均 投手5.8 対 野手22.8）。
    //    旧実装の「5試合未満」は野手の 0.9% にしか当たらないのに**投手の59%**に
    //    当たり、+25 の加点が事実上投手専用になって**放出が投手に偏って**いた
    //    （在籍30%の投手が流出の50%を占めていた）。
    //    チーム内の同じ群の中央値を基準にすれば、injection の桁が変わっても腐らない。
    const gamesOf = (p) => (p.seasonStats?.batting?.games || 0)
      + (p.seasonStats?.pitching?.gamesStarted || 0)
      + (p.seasonStats?.pitching?.gamesRelieved || 0);
    const medianOf = (arr) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const groupMedian = {
      P: medianOf(players.filter(p => p.position === 'pitcher').map(gamesOf)),
      F: medianOf(players.filter(p => p.position !== 'pitcher').map(gamesOf)),
    };

    // 放出スコア: 高いほど放出候補（年齢 + 出場数不足 + 能力低下）
    const scored = players.map(p => {
      const age = p.age || 25;
      const games = gamesOf(p);
      const med = groupMedian[p.position === 'pitcher' ? 'P' : 'F'];
      let score = 0;

      if (age >= 38) score += 60;
      else if (age >= 36) score += 40;
      else if (age >= 34) score += 20;
      else if (age >= 32) score += 8;

      // 中央値が0（成績が入っていない年）は判断材料が無いので加点しない
      if (med > 0) {
        if (games < med * 0.30 && age >= 30) score += 25;
        else if (games < med * 0.60 && age >= 28) score += 10;
      }

      // 能力低下: 同じ水準の選手より明らかに落ちる選手
      // ⚠ **ここも投打で別スケールだった**。旧式は 投手 `球速×0.5+制球`（典型110）
      //    対 野手 `ミート+パワー×0.5`（典型55）で、閾値55は**投手には構造的に
      //    到達不能**（球速110km でも 55＋制球）。結果、加点は野手にしか乗らず
      //    **放出が野手に偏って**いた。投打で揃えてある `calcPlayerOverall` を使う
      //    （この関数の較正母集団は「チームに所属している選手」＝まさにここ）。
      if (calcPlayerOverall(p) < RELEASE_ABILITY_FLOOR && age >= 28) score += 12;

      return { player: p, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // スコア20以上を放出候補、最大3名/年（MIN_KEEPを下回らない）
    const maxRelease = Math.min(
      scored.filter(e => e.score >= 20).length,
      Math.max(0, players.length - MIN_KEEP),
      3
    );
    if (maxRelease <= 0) continue;

    const releaseSet = new Set(scored.slice(0, maxRelease).map(e => e.player.id));

    scored.slice(0, maxRelease).forEach(({ player }) => {
      if ((player.age || 0) < 33) {  // 33歳以上は引退扱い（プールに入れない）
        const p = JSON.parse(JSON.stringify(player));
        p.isStarter = false;
        p.battingOrder = 0;
        p.releasedYear = currentYear;
        p.previousTeam = teamName;
        p.isReleasedCandidate = true;
        if (!p.careerHistory) p.careerHistory = [];
        p.careerHistory.push({ type: 'released', year: currentYear, label: `${teamName}退団` });
        addToReleasedPool(p);
      }
    });

    team.players = players.filter(p => !releaseSet.has(p.id));
  }
}

// tierFilter: 処理するランクの配列 (例: ['S','A'] or ['B','C','D'])。省略時は全ランク
// 優先度: S→A→独立(別関数)→B→C→D の順で処理することで、上位チームが良い選手を先に確保できる
export function replenishCorporateRosters(allTeams, currentYear, tierFilter) {
  const humanTeams = new Set(humanTeamNames(allTeams));
  const allowedRanks = tierFilter ? new Set(tierFilter) : new Set(['S', 'A', 'B', 'C', 'D']);

  const teamsNeedingPlayers = [];
  for (const [teamName, team] of Object.entries(allTeams)) {
    if (humanTeams.has(teamName)) continue;
    if (!team?.corporateData) continue;
    if (team.corporateData.type === 'club') continue;  // クラブは別処理
    if (team.independentLeagueId) continue;            // 独立は replenishIndependentLeagueRosters で処理
    const rank = team.corporateData.rank || 'D';
    if (!allowedRanks.has(rank)) continue;
    const target = CORP_ROSTER_TARGET[rank] || 20;
    const current = team.players?.length || 0;
    const needed = Math.max(0, target - current);
    if (needed > 0) {
      teamsNeedingPlayers.push({ teamName, team, needed, rank });
    }
  }

  if (teamsNeedingPlayers.length === 0 || releasedPlayersPool.length === 0) return;

  // 能力・将来性・ポジション需要はすべて**同じ z の単位**で足す
  // （冒頭の「プールからの補充の物差し」を参照。旧実装は投打で別スケールだった）
  const norms = buildRecruitNorms(releasedPlayersPool);

  // ランク順に処理（S→A→B→C→D）
  teamsNeedingPlayers.sort((a, b) => RANK_DESC.indexOf(a.rank) - RANK_DESC.indexOf(b.rank));

  const usedIndices = new Set();

  for (const teamInfo of teamsNeedingPlayers) {
    const isCDRank = teamInfo.rank === 'C' || teamInfo.rank === 'D';
    const teamBlock = blockOfCorporate(teamInfo.team);
    let added = 0;

    // 能力と地元はチームの中では動かないので、ここで一度だけ並べる
    const candidates = releasedPlayersPool
      .map((p, idx) => {
        if (usedIndices.has(idx)) return null;
        if (p.age && p.age > 32) return null;
        const base = isCDRank ? prospectZ(p, norms) : abilityZ(p, norms);
        return { player: p, idx, base: base + homeZ(p, teamBlock), route: corpEntryRoute(p, currentYear) };
      })
      .filter(Boolean)
      .sort((a, b) => b.base - a.base);
    // 入団ルートごとに分けて並べておく（大卒6割 / 高卒3割 / その他1割）
    // ⚠ **ルートの中で能力を比べること**。1本の順位表にすると、19歳の高卒は
    //    大卒やベテランに必ず負けて企業に若手が入らなくなる（冒頭の注記参照）
    const byRoute = Object.fromEntries(ENTRY_ROUTES.map(r => [r, candidates.filter(e => e.route === r)]));
    const takenByRoute = { university: 0, highschool: 0, other: 0 };
    // 今いちばん枠に足りていないルートから順に。空ならその次へ
    const routeOrder = () => ENTRY_ROUTES
      .map(r => [r, ENTRY_ROUTE_SHARE[r] * (added + 1) - takenByRoute[r]])
      .sort((a, b) => b[1] - a[1])
      .map(([r]) => r);

    // ⚠ **ポジション需要は1人取るごとに測り直すこと**。以前は補充を始める前に
    //    1回だけ計算していたので、Sランク（17人補充）が最初の判断のまま
    //    投手を取り続けられた。窓の中は能力がほぼ並ぶので、ここで需要が主になる。
    const pickFrom = (list) => {
      let best = null, bestScore = -Infinity, scanned = 0;
      for (const e of list) {
        if (usedIndices.has(e.idx)) continue;
        const s = e.base + recruitPositionBoost(e.player, teamInfo.team);
        if (s > bestScore) { bestScore = s; best = e; }
        if (++scanned >= PICK_WINDOW) break;
      }
      return best;
    };

    while (added < teamInfo.needed) {
      let entry = null;
      for (const r of routeOrder()) {
        entry = pickFrom(byRoute[r]);
        if (entry) break;
      }
      if (!entry) break;

      const p = entry.player;
      p._nextYearTeam = teamInfo.teamName;
      const player = { ...p };
      player.isStarter  = false;
      player.battingOrder = 0;
      clearFreshRoute(player);
      // ⚠ 経歴は配列ごとコピーしてから積む（`{...p}` は浅いのでプール側と共有してしまう）
      player.careerHistory = [...(p.careerHistory || [])];
      player.careerHistory.push({ type: 'corporate_join', year: currentYear + 1, label: teamInfo.teamName, route: entry.route });
      takenByRoute[entry.route]++;
      addToRoster(teamInfo.team, player);
      usedIndices.add(entry.idx);
      added++;
    }
  }

  // 使用した選手をリリースプールから除去
  if (usedIndices.size > 0) {
    const remaining = releasedPlayersPool.filter((_, idx) => !usedIndices.has(idx));
    replaceReleasedPool(remaining);
  }

  // 最終パス（Dランクを含む）のみ: 未配属の社会人進路卒業生に表示用の行き先を付与
  if (!tierFilter || tierFilter.includes('D')) {
    const allCorpNames = Object.keys(allTeams).filter(name =>
      allTeams[name]?.corporateData && !allTeams[name]?.independentLeagueId
    );
    if (allCorpNames.length > 0) {
      releasedPlayersPool.forEach(p => {
        if (p.postGradPath === 'corporate' && !p._nextYearTeam) {
          p._nextYearTeam = allCorpNames[Math.floor(Math.random() * allCorpNames.length)];
        }
      });
    }
  }
}

// ============================================================



const TARGET_ROSTER_SIZE = 24;

/**
 * 独立の候補スコア（z）。⚠ 能力は共有の `abilityZ` を使うこと——ここは以前
 * `(球速-115)×2 + 制球 + スタミナ×0.3` 対 `(ミート+パワー+走+守)/4` という
 * 投打で別スケールの式を持っており、投手105 対 野手40 で常に投手が先に取られ、
 * 12年で独立が **92.6% 投手**になっていた。
 * 独立志向の候補への上積みだけがこの関数の固有分。
 */
function recruitBaseZ(p, norms) {
  const originBonus = (p.origin === 'independent_candidate' || p.postGradPath === 'independent') ? 0.5 : 0;
  return abilityZ(p, norms) + originBonus;
}

export function replenishIndependentLeagueRosters(allTeams, currentYear) {
  const humanTeams = new Set(humanTeamNames(allTeams));

  // 補充が必要なAI独立リーグチームを収集（ユーザーのリーグのライバルも含む）
  // 独立リーグチームは corporateData と independentLeagueId の両方を持つ
  const teamsNeedingPlayers = [];
  for (const [teamName, team] of Object.entries(allTeams)) {
    if (humanTeams.has(teamName)) continue;
    if (!team?.players) continue;
    // 独立リーグID を持つチームのみ対象（社会人・大学は replenishCorporateRosters で処理）
    if (!team.independentLeagueId) continue;

    const needed = Math.max(0, TARGET_ROSTER_SIZE - team.players.length);
    if (needed > 0) {
      teamsNeedingPlayers.push({ teamName, team, needed });
    }
  }

  if (teamsNeedingPlayers.length === 0) return;

  // プール候補をスコア順にソート（能力は社会人と同じ z の物差し）
  const norms = buildRecruitNorms(releasedPlayersPool);
  // ⚠ **独立を辞めた選手・年長の選手を独立が拾い直さないこと**。拾い直すと
  //    `processLowerTierTurnover` で退団させた意味が消える（25歳以降は去る場所）
  const poolCandidates = releasedPlayersPool
    .filter(p => freshRouteOf(p, currentYear) !== 'independent' && (p.age || 0) <= IND_MAX_ENTRY_AGE)
    .map(p => ({ player: p, score: recruitBaseZ(p, norms), route: corpEntryRoute(p, currentYear) }))
    .sort((a, b) => b.score - a.score);
  // 入団ルートごとの列（大卒 / 高卒 / その他）。⚠ **ルートの中で能力を比べること**。
  //    1本の列だと先頭の窓が大卒で埋まり、19歳の高卒は窓に入る前に取り尽くされる
  //    （実測: 独立の22歳以下がほぼ0%、23〜27歳が100%）。
  const byRoute = Object.fromEntries(ENTRY_ROUTES.map(r => [r, poolCandidates.filter(e => e.route === r)]));

  // プールの60%をAIチームに配分、40%はユーザーのトライアウト用に残す
  const maxTake = Math.floor(poolCandidates.length * 0.6);
  const totalNeeded = teamsNeedingPlayers.reduce((sum, t) => sum + t.needed, 0);
  const availableFromPool = Math.min(maxTake, totalNeeded);

  // チーム順をシャッフルして公平に配分（ラウンドロビン）
  const shuffled = [...teamsNeedingPlayers].sort(() => Math.random() - 0.5);
  shuffled.forEach(t => { t.taken = { university: 0, highschool: 0, other: 0 }; t.added = 0; });
  const recruitedIds = new Set();
  const recruited = new Set();   // ⚠ 取った判定は実体で（id はプール間で衝突する）
  let taken = 0;

  // ⚠ **列全体から探してはいけない**——能力順に並んでいるので、地元や
  //    ポジションというだけで下位の選手まで拾いに行くとチーム戦力がそれで決まる。
  //    まだ取られていない先頭から窓の分だけを見て、ポジション需要＋地元が最も高い選手を取る。
  // ⚠ **ポジション需要をここで見ること**。以前は純粋な能力順のラウンドロビンで
  //    均衡を一切見ておらず、12年で独立が 92.6% 投手になっていた。
  // ⚠ **窓は群（投手/捕手/野手）ごとに取ること**。1本の窓だと、プール（投手28%前後）の
  //    先頭8人に投手が1人も居ない列ではポジション需要の加点が何も効かず、
  //    入団がルート枠の導入後に野手へ偏って独立の投手比が 37%→25%（15年）まで落ちた。
  //    群ごとに先頭 HOME_WINDOW 人までなら「群の中で下位まで拾いに行く」ことにはならない。
  const pickInWindow = (list, teamInfo) => {
    const teamBlock = blockOfCorporate(teamInfo.team);
    let best = null, bestAdj = -Infinity;
    const seen = { pitcher: 0, catcher: 0, fielder: 0 };
    for (const e of list) {
      if (recruited.has(e.player)) continue;
      const g = e.player.position === 'pitcher' ? 'pitcher'
        : e.player.position === 'catcher' ? 'catcher' : 'fielder';
      if (seen[g] >= HOME_WINDOW) {
        if (seen.pitcher >= HOME_WINDOW && seen.catcher >= HOME_WINDOW && seen.fielder >= HOME_WINDOW) break;
        continue;
      }
      seen[g]++;
      const adj = e.score + recruitPositionBoost(e.player, teamInfo.team) + homeZ(e.player, teamBlock);
      if (adj > bestAdj) { bestAdj = adj; best = e; }
    }
    return best;
  };
  const routeOrderFor = (t) => ENTRY_ROUTES
    .map(r => [r, IND_ENTRY_ROUTE_SHARE[r] * (t.added + 1) - t.taken[r]])
    .sort((a, b) => b[1] - a[1])
    .map(([r]) => r);

  // ラウンドロビン: 各チームに1人ずつ順番に配る
  let anyRecruited = true;
  while (anyRecruited && taken < availableFromPool) {
    anyRecruited = false;
    for (const teamInfo of shuffled) {
      if (teamInfo.needed <= 0) continue;
      if (taken >= availableFromPool) break;
      let candidate = null;
      for (const r of routeOrderFor(teamInfo)) {
        candidate = pickInWindow(byRoute[r], teamInfo);
        if (candidate) break;
      }
      if (!candidate) break;
      candidate.player._nextYearTeam = teamInfo.teamName; // レポート転記用
      const p = JSON.parse(JSON.stringify(candidate.player));
      p.isStarter = false;
      p.battingOrder = 0;
      p.seasonStats = { batting: {}, pitching: {}, fielding: {} };
      clearFreshRoute(p);
      p.careerHistory = p.careerHistory || [];
      p.careerHistory.push({ type: 'independent', label: `${teamInfo.teamName}入団`, year: currentYear + 1, route: candidate.route });
      addToRoster(teamInfo.team, p);
      recruited.add(candidate.player);
      recruitedIds.add(candidate.player.id);
      teamInfo.taken[candidate.route]++;
      teamInfo.added++;
      teamInfo.needed--;
      taken++;
      anyRecruited = true;
    }
  }

  // プールから獲得した選手を削除（残りはユーザーのトライアウト候補として残る）
  removeFromReleasedPoolByIds(recruitedIds);

  // プールで足りない分は新規選手を生成
  const nextId = reservePlayerIds((currentYear + 1) * 10000 + 8000);
  for (const teamInfo of shuffled) {
    while (teamInfo.needed > 0) {
      const newPlayer = generateIndependentNewcomer(nextId(), currentYear + 1);
      newPlayer.careerHistory = [{ type: 'independent', label: `${teamInfo.teamName}入団`, year: currentYear + 1 }];
      addToRoster(teamInfo.team, newPlayer);
      teamInfo.needed--;
    }
  }
}

function generateIndependentNewcomer(id, year) {
  const isPitcher = Math.random() < 0.45;
  const age = 18 + Math.floor(Math.random() * 5);
  const nameObj = generateRandomPlayerName();

  const baseAbility = () => 20 + Math.floor(Math.random() * 30);
  const lowAbility = () => 10 + Math.floor(Math.random() * 25);

  if (isPitcher) {
    // 投手は左投げが多め(30%)、野手は少なめ(15%)。打席は投げ手で条件付けして決める
    const pitcherThrows = Math.random() < 0.3 ? 'left' : 'right';
    return {
      id,
      name: nameObj.last + nameObj.first,
      age,
      position: 'pitcher',
      throws: pitcherThrows,
      bats: generateBats(pitcherThrows),
      pitching: {
        velocity: 125 + Math.floor(Math.random() * 15),
        control: baseAbility(),
        stamina: 50 + Math.floor(Math.random() * 40),
        breakingBalls: [
          { type: 'slider', level: 20 + Math.floor(Math.random() * 30) },
          ...(Math.random() < 0.5 ? [{ type: 'curve', level: 15 + Math.floor(Math.random() * 25) }] : []),
        ],
      },
      batting: { meet: lowAbility(), power: lowAbility(), eye: lowAbility() },
      physical: { speed: baseAbility(), arm: baseAbility(), stamina: 50 + Math.floor(Math.random() * 30), bodyStamina: 40 + Math.floor(Math.random() * 30), recovery: 40 + Math.floor(Math.random() * 30) },
      fielding: { defense: lowAbility(), catcher: 0 },
      positionFitness: generatePositionFitness('pitcher'),
      experience: 0,
      growthPotential: 0.7 + Math.random() * 0.6,
      growthModifier: 0,
      fame: 0,
      seasonStats: { batting: {}, pitching: {}, fielding: {} },
      careerStats: { batting: {}, pitching: {}, fielding: {} },
      form: Math.random() < 0.85 ? 'overhand' : (Math.random() < 0.5 ? 'sidearm' : 'threeQuarter'),
      isStarter: false,
      battingOrder: 0,
      traits: [],
    };
  }

  const fieldPositions = ['catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];
  const position = fieldPositions[Math.floor(Math.random() * fieldPositions.length)];
  const fielderThrows = Math.random() < 0.15 ? 'left' : 'right';

  return {
    id,
    name: nameObj.last + nameObj.first,
    age,
    position,
    throws: fielderThrows,
    bats: generateBats(fielderThrows),
    pitching: { velocity: 110 + Math.floor(Math.random() * 15), control: lowAbility(), stamina: 30 + Math.floor(Math.random() * 20), breakingBalls: [] },
    batting: { meet: baseAbility(), power: baseAbility(), eye: baseAbility() },
    physical: { speed: baseAbility(), arm: baseAbility(), stamina: 50 + Math.floor(Math.random() * 30), bodyStamina: 40 + Math.floor(Math.random() * 30), recovery: 40 + Math.floor(Math.random() * 30) },
    // positionFitness は選手直下に置く。fielding の中に入れると
    // player.positionFitness?.[player.position] を見る守備計算から参照されず、
    // 適性が常に既定値(50)扱いになる
    fielding: { defense: baseAbility(), catcher: position === 'catcher' ? 30 + Math.floor(Math.random() * 30) : 0 },
    positionFitness: generatePositionFitness(position),
    experience: 0,
    growthPotential: 0.7 + Math.random() * 0.6,
    growthModifier: 0,
    fame: 0,
    seasonStats: { batting: {}, pitching: {}, fielding: {} },
    careerStats: { batting: {}, pitching: {}, fielding: {} },
    isStarter: false,
    battingOrder: 0,
    traits: [],
  };
}
