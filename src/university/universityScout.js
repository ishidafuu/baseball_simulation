// ============================================================
// 大学モード スカウトシステム - universityScout.js
// 4月から高校生をスカウトし、調査・注目で交渉率を上げ、推薦枠で確保
// ⚠ もとは corporate/scoutingSystem.js（社会人のスカウト）の後ろ半分にあった（2026-11-24 に分けた）。
//    社会人のスカウトとは見積もり（src/game/scoutReport.js）だけを分け合う。
// ============================================================

import { TEAMS_DATA } from '../teams-data.js';
import { RANK_INITIAL_REPUTATION } from '../corporate/corporateInit.js';
import { balanceRankByPosition } from '../season/universityPool.js';
import { highSchoolPool } from '../state/schoolPools.js';
import { WORLD_DATA } from '../corporate/worldData.js';
import { UNIVERSITY_TEAMS } from './universityTeamsData.js';
import { buildToolNorms, toolProfile } from '../game/scoutTools.js';
import { evaluatePlayerScore, obscureAbilities, dateDiffDays } from '../game/scoutReport.js';

const UNI_SCOUT_SLOTS = { S: 8, A: 7, B: 5, C: 4, D: 3 };

export function getUniversityScoutSlots(rank) {
  return UNI_SCOUT_SLOTS[rank] || 5;
}

// ランク別初期スカウト候補数: 強豪は広く発掘、弱小は絞り込まれた候補のみ
// 接触数(5人)は全ランク共通 → 弱小ほど候補に占める接触割合が高い
const INITIAL_SCOUT_COUNT = { S: 16, A: 13, B: 11, C: 9, D: 8 };

export function initUniversityScoutList(teamData, rank) {
  if (!highSchoolPool.players || highSchoolPool.players.length === 0) return [];

  const reputation = teamData?.universityData?.reputation ?? 30;
  const initialCount = INITIAL_SCOUT_COUNT[rank] || 10;

  // 4月初期発見は20%スタート（以前から目をつけていた選手）
  const candidates = discoverCandidatesFromPool(initialCount, rank, reputation, 20);
  return candidates;
}

function discoverCandidatesFromPool(count, rank, reputation, initialGauge = 0) {
  if (!highSchoolPool.players || highSchoolPool.players.length === 0) return [];

  const existingIds = new Set(
    (WORLD_DATA._universityScout?.candidates || []).map(c => c.id)
      .concat((WORLD_DATA._universityScout?.recruited || []).map(c => c.id))
  );

  const available = highSchoolPool.players
    .filter(p => !p._universityReserved && !existingIds.has(p.id));
  if (available.length === 0) return [];

  // ランク別スカウト帯: 大学ランクに応じて高校生プールのどの層が見えるかを決める
  // S大学=上位層(トップ人材)、D大学=中下位層(入部しやすい選手)
  // 帯はオーバーラップあり。「無名の逸材」はどのランクでも帯内で発掘可能
  const BAND_LO = { S: 0.00, A: 0.10, B: 0.22, C: 0.38, D: 0.55 };
  const BAND_HI = { S: 0.40, A: 0.58, B: 0.72, C: 0.84, D: 0.96 };
  const bandLo = BAND_LO[rank] ?? 0.38;
  const bandHi = BAND_HI[rank] ?? 0.84;

  // 全選手を能力順にソートして帯を切り出す
  // ⚠ **群ごとに順位を付け直してから切ること**（`balanceRankByPosition`）。
  //    `evaluatePlayerScore` は 投手 `(球速-120)×1.5+制球+スタミナ×0.4` / 野手
  //    `ミート+パワー+走×0.5+守×0.3+肩×0.3` と**スケールが揃っていない**ので、
  //    高校生では野手のスコアが systematically 高く出る。1本の順位表を帯で切ると
  //    **上の帯が野手だらけ・下の帯が投手だらけ**になっていた
  //    （実測 S大学の候補の投手 17% / D大学 86%。プールは51%）。
  //    S大学は投手を獲りたくても候補に居ない、という形になる。
  //    ⚠ 進路の振り分けで踏んだのと同じ轍。**並べ替えを書き写さず共有すること**
  const byAbility = balanceRankByPosition([...available]
    .map((p) => ({ player: p, poolIndex: highSchoolPool.players.indexOf(p), ability: evaluatePlayerScore(p), score: evaluatePlayerScore(p) }))
    .sort((a, b) => b.ability - a.ability));

  const n = byAbility.length;
  const loIdx = Math.floor(n * bandLo);
  const hiIdx = Math.min(n, Math.floor(n * bandHi));
  const band = byAbility.slice(loIdx, hiIdx);

  // ============================================================
  // ⚠ **1本の順位表から上位を取ると、毎年同じ顔ぶれになる**
  //
  // 旧実装は `知名度×0.5 + (成長率-1.0)×25 + ノイズ±15` の1本で上位を取っていた。
  // 4月は知名度がほぼ0（プール平均5.6）なので知名度の項が効かず、
  // **2300人の帯から9人を取ると「成長率の最上位＋運」だけが残る**。
  // 実測: 帯の中で成長率1.2以上は14.9%しかいないのに、**載った選手の99.7%が1.2以上**。
  // 載った選手の成長率の平均は S大学1.434 〜 D大学1.432 と**ランクを問わず同じ**だった。
  //
  // さらに `evaluatePlayerScore` は `+(成長率-0.9)×30` を含むので、
  // **選抜に使った成長率が評価点にも二重に乗り**、おすすめ度が S に張り付いていた
  // （実測 S大学79% / C大学54% が S評価。C・D評価は 0%）。
  // 「選ぶ基準と見せる基準は別」（`scoutTools` の節）と同じ轍。
  //
  // **枠を3つに分ける**。ドラフトの一芸指名で同じ問題を解いたのと同じ手で、
  // ⚠ 物差しは `scoutTools` を流用する（**道具の表を二重に作らないこと**）。
  //   ① 知名度 … 全国区の名前。**帯の上を越えて挙がる**（届かなくても話題には出る）
  //   ② 格相応 … 帯の中央。ライバルが少なく**実際に獲れる見込みのある層**
  //   ③ 一芸  … 総合力は帯の下でも、1つの道具が figure として立つ選手
  // ============================================================
  const nFame = Math.max(1, Math.round(count * 0.3));
  const nTool = Math.max(1, Math.round(count * 0.3));
  // ⚠ 3つの合計を `count` に一致させること。`Math.max(1, …)` にすると
  //    月次追加（D大学は2名）で合計3になり、`slice` で**一芸枠だけ毎回捨てられる**
  const nFit = Math.max(0, count - nFame - nTool);

  // ⚠ **道具の物差しはプール全体から作ること**（帯の中だけで標準化すると
  //    「その帯の中で相対的にマシな道具」になり、一芸の意味が薄まる）
  const norms = buildToolNorms(available);
  const taken = new Set();
  const out = [];
  // `balance` を立てた枠は**群ごとに順位を付けてから取る**。
  // ⚠ 一芸枠は立てること——投手の道具は4種・野手は8種なので、
  //    「最も突出した道具の偏差」で素直に並べると **max(8個) > max(4個)** で
  //    野手が構造的に勝つ（ドラフトの `HUNT_PITCHER_SHARE` と同じ話）
  const pick = (rows, k, scoreFn, balance = false) => {
    let cand = rows.filter(r => !taken.has(r.player.id))
      .map(r => ({ ...r, s: scoreFn(r) + (Math.random() - 0.5) * 12 }))
      .sort((a, b) => b.s - a.s);
    if (balance) cand = balanceRankByPosition(cand);
    for (const r of cand.slice(0, k)) { taken.add(r.player.id); out.push(r); }
  };

  // ① 知名度枠。⚠ **ここだけ帯の上限を越える**——甲子園に出た選手は
  //    どのランクの大学でも名前は挙がる（獲れるかは交渉率が決める）。
  //    ⚠ 注目度(reputation)はここで**実際に効かせる**。旧実装の `repBonus` は
  //    全候補に同じ値を足すだけで**順位を1つも動かしていなかった**（定数）。
  //    注目度が高い大学ほど上の層まで情報が入る、という形にする。
  const reach = 0.06 + (reputation / 100) * 0.14;          // 帯の上へ 6〜20%
  const fameBand = byAbility.slice(Math.floor(n * Math.max(0, bandLo - reach)), hiIdx);
  pick(fameBand, nFame, r => (r.player.fame || 0) * 1.5);

  // ② 格相応枠。帯の中央半分から素直に引く（＝その大学の水準どおりの選手）。
  //    ここに順位を付ける項を置かないこと——置いた瞬間にまた一色になる
  const fitLo = loIdx + Math.floor((hiIdx - loIdx) * 0.25);
  const fitHi = loIdx + Math.floor((hiIdx - loIdx) * 0.75);
  pick(byAbility.slice(fitLo, fitHi), nFit, () => 0);

  // ③ 一芸枠。`top` は「自分の中で最も突出した道具の偏差」
  //    ⚠ 成長力はここに**小さく**だけ残す（素材の良さが滲み出る程度）。
  //       ×25 は選抜を独占するので ×8 まで下げてある
  pick(band, nTool, r => toolProfile(r.player, norms).top * 10 + ((r.player.growthPotential || 1) - 1) * 8, true);

  return out.slice(0, count).map(entry => {
    const p = JSON.parse(JSON.stringify(entry.player));
    const accuracy = 40 + Math.floor(reputation * 0.2) + Math.floor(Math.random() * 10);
    p.scoutAccuracy = Math.min(75, accuracy);
    p.scoutedAbilities = obscureAbilities(p, p.scoutAccuracy, 'primary');
    p._poolRef = { source: 'highschool', poolIndex: entry.poolIndex };
    p._scoutSource = p.highSchool?.name ? p.highSchool.name : '高校';
    p._revealLevel = 0;
    p._investigationCount = 0;
    p._watchBonus = 0;
    p._investigating = false;
    p._investigateReturn = null;
    p.recruitRate = calculateUniversityRecruitRate(p, rank, reputation, 0);
    p._approachGauge = initialGauge;
    p._approaching = false;
    p._rivals = generateRivals(p, rank);
    return p;
  });
}

/**
 * 月初に新候補を発見（高校生プールから追加）
 * 月が進むほどスカウト網が広がり、発見数が増える
 */
// ランク別月次追加発掘数（ベース）
const MONTHLY_SCOUT_BASE = { S: 6, A: 5, B: 4, C: 3, D: 2 };

export function discoverNewScoutCandidates(rank, reputation, month) {
  // 4月=初期化済、5月〜10月に毎月追加発見
  if (month < 5 || month > 10) return [];
  const base = MONTHLY_SCOUT_BASE[rank] || 3;
  // 後半ほど少し増える（スカウト網が広がる）
  const phaseBonus = month >= 8 ? 1 : 0;
  const count = base + phaseBonus;

  // 月次追加は10%スタート（途中から注目した選手）
  return discoverCandidatesFromPool(count, rank, reputation, 10);
}

/**
 * セレクション候補を高校生プールから生成
 * スポーツ推薦で取れなかった枠を一般入部試験で埋める
 * 推薦候補より能力は低めの層が中心
 */
export function generateSelectionCandidates(rank, reputation, count = 15) {
  if (!highSchoolPool.players || highSchoolPool.players.length === 0) return [];

  const existingIds = new Set(
    (WORLD_DATA._universityScout?.candidates || []).map(c => c.id)
      .concat((WORLD_DATA._universityScout?.recruited || []).map(c => c.id))
  );

  // セレクション=推薦より一段下の帯から選ぶ（推薦で取れる上位層は除く）
  // ランク別に推薦帯の下半分〜さらに下位層を対象とする
  const SEL_BAND_LO = { S: 0.20, A: 0.32, B: 0.46, C: 0.60, D: 0.72 };
  const SEL_BAND_HI = { S: 0.60, A: 0.76, B: 0.88, C: 0.94, D: 1.00 };
  const selLo = SEL_BAND_LO[rank] ?? 0.60;
  const selHi = SEL_BAND_HI[rank] ?? 0.94;

  const available = highSchoolPool.players.filter(p => !p._universityReserved && !existingIds.has(p.id));
  const byAbility = [...available]
    .map(p => ({ player: p, ability: evaluatePlayerScore(p) }))
    .sort((a, b) => b.ability - a.ability);

  const n = byAbility.length;
  const band = byAbility.slice(Math.floor(n * selLo), Math.min(n, Math.floor(n * selHi)));

  // 投手比率を約32%に調整（投手過多バグ対策）
  const pitcherCount = Math.round(count * 0.32);
  const fielderCount = count - pitcherCount;
  const bandPitchers = band.filter(e => e.player.position === 'pitcher').sort(() => Math.random() - 0.5);
  const bandFielders = band.filter(e => e.player.position !== 'pitcher').sort(() => Math.random() - 0.5);
  const selected = [
    ...bandPitchers.slice(0, pitcherCount),
    ...bandFielders.slice(0, fielderCount),
  ].sort(() => Math.random() - 0.5);

  return selected.slice(0, count).map(entry => {
    const p = JSON.parse(JSON.stringify(entry.player));
    // セレクションでは能力がほぼ見える状態
    p.scoutAccuracy = 80;
    p.scoutedAbilities = obscureAbilities(p, 80, 'full');
    p._selectionCandidate = true;
    return p;
  });
}

function calculateUniversityRecruitRate(player, uniRank, reputation, watchBonus = 0) {
  const baseRate = 0.30 + (reputation / 100) * 0.50;
  const playerScore = evaluatePlayerScore(player);
  const rawPenalty = Math.max(-0.05, Math.min(0.30, (playerScore - 50) / 200));
  const qualityMult = { S: 0.15, A: 0.45, B: 1.0, C: 1.25, D: 1.5 }[uniRank] || 1.0;
  const qualityPenalty = rawPenalty * qualityMult;
  const rankBonus = { S: 0.15, A: 0.08, B: 0, C: -0.06, D: -0.12 }[uniRank] || 0;
  const invBonus = (player._investigationCount || 0) * 0.08;
  const wBonus = (watchBonus || player._watchBonus || 0) / 100;
  const rate = baseRate - qualityPenalty + rankBonus + invBonus + wBonus;
  return Math.max(5, Math.min(95, Math.round(rate * 100)));
}

export function startUniversityInvestigation(candidate, currentDate) {
  if (candidate._investigating) return false;
  if ((candidate._revealLevel || 0) >= 2) return false;
  candidate._investigating = true;
  const d = new Date(currentDate.year, currentDate.month - 1, currentDate.day);
  d.setDate(d.getDate() + 5);
  candidate._investigateReturn = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  return true;
}

export function processUniversityScoutDay(candidates, currentDate, uniRank, reputation) {
  if (!candidates) return [];
  const completed = [];
  const cd = currentDate.year * 10000 + currentDate.month * 100 + currentDate.day;

  // 月初（1日）に新候補を発見して追加
  if (currentDate.day === 1 && currentDate.month >= 5 && currentDate.month <= 10) {
    const lastDiscoveryMonth = WORLD_DATA._universityScout?._lastDiscoveryMonth || 4;
    if (currentDate.month > lastDiscoveryMonth) {
      const newCandidates = discoverNewScoutCandidates(uniRank, reputation, currentDate.month);
      if (newCandidates.length > 0) {
        candidates.push(...newCandidates);
        if (WORLD_DATA._universityScout) {
          WORLD_DATA._universityScout._lastDiscoveryMonth = currentDate.month;
          WORLD_DATA._universityScout._newDiscoveries = newCandidates.length;
        }
      }
    }
  }

  for (const c of candidates) {
    if (c._investigating && c._investigateReturn) {
      const rd = c._investigateReturn.year * 10000 + c._investigateReturn.month * 100 + c._investigateReturn.day;
      if (cd >= rd) {
        c._investigating = false;
        c._investigateReturn = null;
        c._investigationCount = (c._investigationCount || 0) + 1;
        c._revealLevel = Math.min(2, (c._revealLevel || 0) + 1);
        const stage = c._revealLevel === 1 ? 'secondary' : 'full';
        const newAccuracy = Math.min(90, (c.scoutAccuracy || 50) + 10);
        c.scoutAccuracy = newAccuracy;
        c.scoutedAbilities = obscureAbilities(c, newAccuracy, stage);
        c.recruitRate = calculateUniversityRecruitRate(c, uniRank, reputation);
        completed.push(c);
      }
    }
  }

  // Weekly watch bonus
  for (const c of candidates) {
    if (c._watching) {
      if (!c._watchStart) {
        c._watchStart = cd;
        c._lastWatchAdvance = cd;
      }
      if (c._lastWatchAdvance) {
        const diff = dateDiffDays(c._lastWatchAdvance, cd);
        if (diff >= 7) {
          const weeks = Math.floor(diff / 7);
          c._watchBonus = (c._watchBonus || 0) + weeks * 4;
          c._lastWatchAdvance = cd;
          c.recruitRate = calculateUniversityRecruitRate(c, uniRank, reputation);
        }
      }
    }
  }

  // ライバル大学のゲージ進行 → 先に100%到達で横取り
  const rivalStolen = advanceRivalGauges(candidates, uniRank);
  if (rivalStolen.length > 0 && WORLD_DATA._universityScout) {
    const wd = WORLD_DATA._universityScout;
    if (!wd._rivalStolen) wd._rivalStolen = [];
    for (const s of rivalStolen) {
      const c = s.candidate;
      const orig = highSchoolPool.players?.find(hp => hp.id === c.id);
      if (orig) orig._universityReserved = s.rivalName;
      // リストから削除せず_reservedByを付与して残す（競合欄に進学先を表示するため）
      c._reservedBy = s.rivalName;
      c._approaching = false;
      wd._rivalStolen.push({ name: c.name, position: c.position, rivalName: s.rivalName, rivalRank: s.rivalRank });
    }
  }

  // 接近ゲージの日次蓄積
  const gaugeCompleted = [];
  for (const c of candidates) {
    if (!c._approaching) continue;
    const rate = calculateDailyGaugeRate(c, uniRank, reputation);
    c._approachGauge = Math.min(100, (c._approachGauge || 0) + rate);
    if (c._approachGauge >= 100) {
      gaugeCompleted.push(c);
    }
  }

  // ゲージMAXの選手を確定待ち状態に（手動確定に変更 → 自動追加しない）
  if (gaugeCompleted.length > 0 && WORLD_DATA._universityScout) {
    const wd = WORLD_DATA._universityScout;
    for (const c of gaugeCompleted) {
      c._gaugeComplete = true;
      c._approaching = false;
    }
    wd._gaugeCompleteCount = (wd._gaugeCompleteCount || 0) + gaugeCompleted.length;
  }

  return completed;
}

export function toggleUniversityWatch(candidate) {
  candidate._watching = !candidate._watching;
  if (!candidate._watching) {
    candidate._watchStart = null;
    candidate._lastWatchAdvance = null;
  }
  return candidate._watching;
}


// ============================================================
// 接近ゲージシステム
// 候補に「接近」して毎日ゲージを蓄積、100%で推薦確定
// ============================================================

// 同時接触数は全ランク共通5人。差別化は候補数（S=16人中5、D=8人中5）
const MAX_CONCURRENT_APPROACHES = { S: 5, A: 5, B: 5, C: 5, D: 5 };

export function getMaxApproaches(rank) {
  return MAX_CONCURRENT_APPROACHES[rank] || 3;
}

export function startUniversityApproach(candidate) {
  if (candidate._approaching) return false;
  candidate._approaching = true;
  if (candidate._approachGauge == null) candidate._approachGauge = 0;
  return true;
}

export function stopUniversityApproach(candidate) {
  candidate._approaching = false;
  return true;
}

/**
 * 1日あたりのゲージ蓄積量を計算
 * 選手の質が高いほど遅く、大学ランク・注目度・調査で加速
 */
export function calculateDailyGaugeRate(player, uniRank, reputation) {
  const baseRate = 2.5 + (reputation / 100) * 2.0;
  const rankBonus = { S: 1.5, A: 0.5, B: 0, C: -0.3, D: -0.5 }[uniRank] || 0;
  const playerScore = evaluatePlayerScore(player);
  const qualityPenalty = Math.max(0, (playerScore - 30) * 0.04);
  const invBonus = (player._investigationCount || 0) * 0.5;
  const watchBonus = ((player._watchBonus || 0) / 100) * 2.0;
  const rate = baseRate + rankBonus - qualityPenalty + invBonus + watchBonus;
  return Math.max(0.5, Math.round(rate * 10) / 10);
}

// ============================================================
// ライバル大学競合システム
// 他大学も同じ高校生に接近 → 先にゲージ100%にした方が獲得
// ============================================================

function generateRivals(player, userRank) {
  const score = evaluatePlayerScore(player);
  const fame = player.fame || 0;

  // 知名度が低い選手は他大学のスカウトに発見されにくい
  // fame=0: 25% / fame=10: 48% / fame=20: 72% / fame=30: 95%
  const discoverChance = Math.min(0.95, 0.25 + (fame / 30) * 0.70);
  if (Math.random() > discoverChance) return [];

  // 知名度で上限人数を制限
  const maxByFame = fame < 6 ? 1 : fame < 15 ? 2 : fame < 28 ? 3 : 4;
  // 能力でも上限を設定（低能力選手にも最低1校は接近）
  const maxByScore = score >= 70 ? 4 : score >= 50 ? 3 : score >= 30 ? 2 : 1;
  const rivalCount = Math.min(maxByScore, maxByFame);

  const userTeamName = Object.keys(TEAMS_DATA)[0] || '';
  const userTeamId = UNIVERSITY_TEAMS.find(t => t.name === userTeamName)?.id;

  const eligibleRanks = [];
  if (score >= 60) eligibleRanks.push('S', 'A', 'B');
  else if (score >= 40) eligibleRanks.push('A', 'B', 'C');
  else eligibleRanks.push('B', 'C', 'D');

  const pool = UNIVERSITY_TEAMS.filter(t =>
    t.id !== userTeamId && eligibleRanks.includes(t.rank)
  );
  if (pool.length === 0) return [];

  const shuffled = pool.sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, rivalCount);

  return picked.map(t => {
    const rep = RANK_INITIAL_REPUTATION[t.rank] || 40;
    // 知名度が高い選手は4月から即座に動き出す
    // fame=30: delay 0-14日(4月) / fame=15: delay 7-22日(4月中〜下) / fame=0: delay 15-30日(4月下〜5月)
    const fameOffset = Math.floor((30 - Math.min(30, fame)) * 0.5);
    const startDelay = Math.floor(Math.random() * 15) + fameOffset;
    return {
      universityName: t.name,
      rank: t.rank,
      reputation: rep,
      gauge: 0,
      approaching: false,
      _startDelay: startDelay,
      _daysPassed: 0,
    };
  });
}

function advanceRivalGauges(candidates, userRank) {
  const stolen = [];
  for (const c of candidates) {
    if (!c._rivals || c._rivals.length === 0) continue;
    for (const rival of c._rivals) {
      rival._daysPassed = (rival._daysPassed || 0) + 1;
      if (!rival.approaching && rival._daysPassed >= rival._startDelay) {
        rival.approaching = true;
      }
      if (!rival.approaching) continue;
      const rate = calculateRivalGaugeRate(c, rival.rank, rival.reputation);
      rival.gauge = Math.min(100, rival.gauge + rate);
      if (rival.gauge >= 100) {
        stolen.push({ candidate: c, rivalName: rival.universityName, rivalRank: rival.rank });
        break;
      }
    }
  }
  return stolen;
}

function calculateRivalGaugeRate(player, rivalRank, rivalRep) {
  const baseRate = 2.5 + (rivalRep / 100) * 2.0;
  const rankBonus = { S: 1.5, A: 0.5, B: 0, C: -0.3, D: -0.5 }[rivalRank] || 0;
  const playerScore = evaluatePlayerScore(player);
  const qualityPenalty = Math.max(0, (playerScore - 30) * 0.04);
  const rate = baseRate + rankBonus - qualityPenalty;
  return Math.max(0.5, Math.round(rate * 10) / 10);
}

export function getRivalInfo(candidate) {
  if (!candidate._rivals || candidate._rivals.length === 0) return null;
  const active = candidate._rivals.filter(r => r.approaching);
  if (active.length === 0) return { count: 0, maxGauge: 0, rivals: [] };
  const maxGauge = Math.max(...active.map(r => r.gauge));
  return {
    count: active.length,
    maxGauge,
    rivals: active.map(r => ({ name: r.universityName, rank: r.rank, gauge: Math.floor(r.gauge) })),
  };
}

export function getUniversityScoutRecommendation(player, uniRank) {
  const score = evaluatePlayerScore(player);
  // ⚠ **baseline はその大学に見えている帯の中央に置くこと**。旧値
  //    （S80/A65/B50/C40/D30）は帯の中央より 22〜28 も低く、`diff>=30 で S` の
  //    閾値に対して**帯の中央がほぼ A〜S の境目**に来ていた。そのため候補の
  //    46〜79% が S評価で、**C・D評価は1件も出なかった**——「どの選手も
  //    Sランクに見える」の正体。帯の中央を 0（＝B＝その大学にとって普通）に置く。
  // ⚠ **投手と野手で別の baseline を持つこと**。`evaluatePlayerScore` は
  //    投手 `(球速-120)×1.5+制球+スタミナ×0.4` / 野手 `ミート+パワー+走×0.5+…` と
  //    スケールが揃っておらず、実測で**同じ帯の中央でも 40〜50点ひらく**
  //    （C大学で 投手49 対 野手92）。1つの baseline では投手だけ不当に低く出る。
  // ⚠ 閾値も**baseline に対する割合**で持つこと。絶対値だと野手のほうが
  //    スケールが大きいぶん同じ +30 が別の意味になる。
  // ⚠ 高校生プールの生成や `evaluatePlayerScore` を変えたら**測り直すこと**
  //    （`VALUE_DIST` / `BAND_SD` と同じ性質の、実測から取った定数）
  const isP = player.position === 'pitcher';
  const base = (isP ? { S: 74, A: 64, B: 57, C: 50, D: 41 }
                    : { S: 122, A: 110, B: 100, C: 91, D: 80 })[uniRank]
             ?? (isP ? 57 : 100);
  // 最終測定: 高校生の打撃の上の裾を畳んだ（`batTaperHigh`）後に
  // `tools/sim-harness/scout-grade-probe.mjs` で測った帯の中央。野手が 1〜2 下がった
  const rel = (score - base) / base;
  if (rel >= 0.50) return 'S';
  if (rel >= 0.25) return 'A';
  if (rel >= 0) return 'B';
  if (rel >= -0.25) return 'C';
  return 'D';
}

/**
 * 選手検索から高校生をスカウト候補リストに追加する
 * 直接検索で見つけているため _revealLevel=2（能力完全開示）
 */
export function addHighSchoolPlayerToScoutList(player, uniRank, reputation) {
  // スカウトシステム未初期化なら空リストで自動初期化（4月前・年度末リセット後に対応）
  if (!WORLD_DATA._universityScout) {
    WORLD_DATA._universityScout = { candidates: [], recruited: [], initialized: false };
  }

  const existingIds = new Set(
    (WORLD_DATA._universityScout.candidates || []).map(c => c.id)
      .concat((WORLD_DATA._universityScout.recruited || []).map(c => c.id))
  );
  if (existingIds.has(player.id)) return { success: false, reason: 'already_exists' };

  const p = JSON.parse(JSON.stringify(player));
  p.scoutAccuracy = 95;
  p.scoutedAbilities = obscureAbilities(p, 95, 'full');
  p._scoutSource = p.highSchool?.name ? p.highSchool.name : '高校（検索）';
  p._revealLevel = 2;
  p._investigationCount = 2;
  p._watchBonus = 0;
  p._investigating = false;
  p._investigateReturn = null;
  p.recruitRate = calculateUniversityRecruitRate(p, uniRank, reputation, 0);
  p._approachGauge = 0;
  p._approaching = false;
  p._rivals = generateRivals(p, uniRank);
  p._addedBySearch = true;

  if (highSchoolPool.players) {
    const idx = highSchoolPool.players.findIndex(hp => hp.id === player.id);
    if (idx !== -1) p._poolRef = { source: 'highschool', poolIndex: idx };
  }

  if (!WORLD_DATA._universityScout.candidates) WORLD_DATA._universityScout.candidates = [];
  WORLD_DATA._universityScout.candidates.push(p);
  return { success: true };
}
