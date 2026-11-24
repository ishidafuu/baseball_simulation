// ============================================================
// チームデータ - teams-data.js
// 動的チーム生成対応（最大12チーム）
// ============================================================

import { createPlayerStats, createSeasonStats, createCareerStats } from './players.js';
import { clearUniversityPool, clearHighSchoolPool } from './state/schoolPools.js';
import { autoStarterRole } from './utils/constants.js';

/**
 * チームデータ構造（動的に拡張可能）
 */
export const TEAMS_DATA = {};

/**
 * リーグ全体の設定（グローバルミュータブル）
 * seasonData.settings から同期される
 */
export const LEAGUE_SETTINGS = {
  useDH: false,
  // 延長の上限（この回の裏を終えて同点なら引き分け）。規定の `maxExtraInnings` を写す。
  // ⚠ 以前は規定で変えられるのに、自動試合は12回、采配試合も12回で固定だった
  maxExtraInnings: 12,
};

/** 規定の延長上限を試合で使える値にする（9回未満・不正値は扱えないので丸める） */
export const normalizeMaxExtraInnings = (value) => {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 12;
  return Math.min(30, Math.max(9, n));
};

/**
 * 解雇された選手のプール（グローバルミュータブル配列）
 * - 契約更改で解雇された選手がここに入り、次年度以降のトライアウトに再登場する
 * - 各エントリは通常の選手オブジェクト + { releasedYear, previousTeam, attemptsInPool }
 * - ドラフトで再獲得されたら削除、2回連続で指名されなければ引退扱いで削除
 */
export const releasedPlayersPool = [];

/**
 * 解雇プールを完全にクリアする（ニューゲーム時など）
 */
export const clearReleasedPlayersPool = () => {
  releasedPlayersPool.length = 0;
};

/**
 * 指定したチーム数でTEAMS_DATAを初期化
 * @param {number} teamCount - チーム数（2-12）
 * @param {Array<string>} customNames - カスタムチーム名（省略時はチームA, B, C...）
 * @param {Array<string>} customAbbreviations - カスタム略称（省略時はＡ, Ｂ, Ｃ...）
 */
export const initializeTeamsForCount = (teamCount, customNames = null, customAbbreviations = null) => {
  // 既存のデータをクリア
  Object.keys(TEAMS_DATA).forEach(key => delete TEAMS_DATA[key]);
  // 解雇プールもクリア
  clearReleasedPlayersPool();
  // 大学プール・高校生プールもクリア
  clearUniversityPool();
  clearHighSchoolPool();

  // チーム名を決定（カスタム名または自動生成）
  const teamNames = [];
  for (let i = 0; i < teamCount; i++) {
    if (customNames && customNames[i]) {
      teamNames.push(customNames[i]);
    } else {
      teamNames.push(`チーム${String.fromCharCode(65 + i)}`); // A, B, C, D, E, F...
    }
  }

  // チームを作成
  teamNames.forEach((teamName, i) => {
    const abbr = (customAbbreviations && customAbbreviations[i]) || String.fromCharCode(0xFF21 + i);
    TEAMS_DATA[teamName] = {
      name: teamName,
      abbreviation: abbr,
      players: [],
      pitchingRotation: null
    };
  });

  return teamNames;
};

/**
 * チーム名から略称を取得するヘルパー
 * @param {string} teamName - チーム名
 * @returns {string} 略称（見つからない場合はチーム名の先頭4文字）
 */
export const getTeamAbbreviation = (teamName) => {
  if (!teamName) return '';
  const team = TEAMS_DATA[teamName];
  if (team && team.abbreviation) return team.abbreviation;
  return (teamName || '').slice(0, 3);
};





/**
 * 全チームデータを初期化（4チームの場合）
 */
export const initializeTeamsData = () => {
  // デフォルト4チームを初期化
  initializeTeamsForCount(4);

  // 【削除済み】ここに players.js の固定ロスターを読み込む分岐があったが、
  // `typeof createDefaultPlayers === 'function'` というガードで囲まれており、
  // このファイルは players.js を import していないため**一度も実行されていなかった**
  // （ESモジュールなので typeof は必ず 'undefined'）。
  // 実際のロスターは initializeTeamsForCount() が生成している。
  // 今さら有効にすると新規ゲームのチームA/Bだけ固定ロスターに変わってしまうため、
  // 到達しないコードとして除去した。

  // 全選手に背番号と初期成績を設定
  Object.keys(TEAMS_DATA).forEach(teamName => {
    TEAMS_DATA[teamName].players = TEAMS_DATA[teamName].players.map((p, i) => ({
      ...p,
      number: p.id,
      stats: p.stats || createPlayerStats(),
      seasonStats: p.seasonStats || createSeasonStats(),
      careerStats: p.careerStats || createCareerStats()
    }));
  });

  // 全チームの投手ローテーションを初期化
  initializeAllPitchingRotations();
};

/**
 * 全チームの投手ローテーションを初期化
 */
export const initializeAllPitchingRotations = () => {
  Object.keys(TEAMS_DATA).forEach(teamName => {
    initializePitchingRotation(teamName);
  });
};

/**
 * 指定チームの投手ローテーションを初期化（リリーフ役割対応）
 */
export const initializePitchingRotation = (teamName) => {
  const team = TEAMS_DATA[teamName];
  if (!team || !team.players || team.players.length === 0) {
    return;
  }

  // 投手を抽出してスタミナでソート
  const pitchers = team.players.filter(p => p.position === 'pitcher');
  if (pitchers.length === 0) {
    return;
  }

  const sortedPitchers = [...pitchers].sort((a, b) =>
    (b.pitching?.stamina || 0) - (a.pitching?.stamina || 0)
  );

  // 先発（スタミナ130以上、最大5人）
  const starters = sortedPitchers
    .filter(p => (p.pitching?.stamina || 0) >= 130)
    .slice(0, 5);

  // スタミナ130以上が5人未満の場合、スタミナ上位から補充
  if (starters.length < 5) {
    const remaining = sortedPitchers
      .filter(p => !starters.includes(p))
      .slice(0, 5 - starters.length);
    starters.push(...remaining);
  }

  // 残りの投手（リリーフ候補）
  const relievers = sortedPitchers.filter(p => !starters.includes(p));

  // リリーフの役割を決定
  // 能力スコア = 球速×0.4 + 制球×0.4 + スタミナ×0.2
  const scoredRelievers = relievers.map(p => ({
    ...p,
    reliefScore: (p.pitching?.velocity || 130) * 0.4 +
                 (p.pitching?.control || 50) * 0.4 +
                 (p.pitching?.stamina || 80) * 0.2
  })).sort((a, b) => b.reliefScore - a.reliefScore);

  // 特性に基づいて適材適所で配置
  const pitcherRoles = {};
  const assigned = new Set();

  // 先発ロールを特性に基づいて振り分け
  // 総合スコア = 球速×0.3 + 制球×0.3 + スタミナ×0.4
  const scoredStarters = starters.map(p => ({
    ...p,
    starterScore: (p.pitching?.velocity || 130) * 0.3 +
                  (p.pitching?.control || 50) * 0.3 +
                  (p.pitching?.stamina || 80) * 0.4
  })).sort((a, b) => b.starterScore - a.starterScore);

  scoredStarters.forEach((p, i) => {
    pitcherRoles[p.id] = autoStarterRole(i, p.pitching?.stamina || 80);
  });

  // 1. 守護神: 最高能力の投手（球速・制球重視）
  const closer = scoredRelievers[0] || null;
  if (closer) {
    pitcherRoles[closer.id] = 'closer';
    assigned.add(closer.id);
  }

  // 2. セットアッパー: 2番手（1人）
  const setupMen = [];
  if (scoredRelievers[1]) {
    setupMen.push(scoredRelievers[1]);
    pitcherRoles[scoredRelievers[1].id] = 'setup';
    assigned.add(scoredRelievers[1].id);
  }

  // 残りの未割り当てリリーフ
  const unassigned = scoredRelievers.filter(p => !assigned.has(p.id));

  // 3. 中継ぎエース: 残りの中で最も能力が高い投手（1人）
  const aceCandidate = unassigned[0];
  if (aceCandidate) {
    pitcherRoles[aceCandidate.id] = 'ace_relief';
    assigned.add(aceCandidate.id);
  }

  // 4. ワンポイント: 左投げ＆スタミナ低めの投手（1人まで）
  const unassigned2 = scoredRelievers.filter(p => !assigned.has(p.id));
  const onepointCandidate = unassigned2.find(p =>
    p.physical?.throws === 'left' && (p.pitching?.stamina || 0) < 110
  );
  if (onepointCandidate) {
    pitcherRoles[onepointCandidate.id] = 'onepoint';
    assigned.add(onepointCandidate.id);
  }

  // 5. ロングリリーフ: スタミナが高い投手（1人）
  const unassigned3 = scoredRelievers.filter(p => !assigned.has(p.id));
  const longCandidate = [...unassigned3].sort((a, b) =>
    (b.pitching?.stamina || 0) - (a.pitching?.stamina || 0)
  )[0];
  if (longCandidate) {
    pitcherRoles[longCandidate.id] = 'long';
    assigned.add(longCandidate.id);
  }

  // 6. 残りを能力順にビハインド→敗戦処理
  const unassigned4 = scoredRelievers.filter(p => !assigned.has(p.id));
  unassigned4.forEach((p, i) => {
    if (i === 0) {
      pitcherRoles[p.id] = 'behind';
    } else {
      pitcherRoles[p.id] = 'mopup';
    }
    assigned.add(p.id);
  });

  // レガシー配列を構築
  const middleRelievers = scoredRelievers.filter(p =>
    p.id !== closer?.id && !setupMen.some(s => s.id === p.id)
  );

  const leftSpecialists = relievers.filter(p =>
    p.physical?.throws === 'left' && (p.pitching?.stamina || 0) < 100
  );

  // ローテーション情報を保存
  team.pitchingRotation = {
    starters: starters.map(p => p.id),
    closer: closer ? closer.id : null,
    setupMen: setupMen.map(p => p.id),
    middleRelievers: middleRelievers.map(p => p.id),
    leftSpecialists: leftSpecialists.map(p => p.id),
    currentStarterIndex: 0,
    pitcherRoles,
    // リリーフ疲労管理
    reliefFatigue: {}
  };

  // 初期疲労を設定
  [...(closer ? [closer] : []), ...setupMen, ...middleRelievers].forEach(p => {
    team.pitchingRotation.reliefFatigue[p.id] = 0;
  });

};

/**
 * リリーフ投手を役割に基づいて選択
 * @param {string} teamName - チーム名
 * @param {string} situation - 状況 ('save', 'hold', 'middle', 'long', 'lefty')
 * @param {number} inning - 現在のイニング
 * @param {number} scoreDiff - 点差（正なら勝ち、負なら負け）
 * @returns {Object|null} 選択された投手
 */
export const selectReliefPitcher = (teamName, situation, inning, scoreDiff) => {
  const team = TEAMS_DATA[teamName];
  if (!team || !team.pitchingRotation) return null;

  const rotation = team.pitchingRotation;
  const fatigue = rotation.reliefFatigue || {};

  // 疲労が50以下の投手のみ選択可能
  const isAvailable = (pitcherId) => (fatigue[pitcherId] || 0) < 50;

  // 状況に応じた投手選択
  if (situation === 'save' && rotation.closer) {
    // セーブ場面: クローザー
    if (isAvailable(rotation.closer)) {
      return team.players.find(p => p.id === rotation.closer);
    }
  }

  if (situation === 'hold' || (inning >= 7 && Math.abs(scoreDiff) <= 2)) {
    // セットアップ場面: セットアッパー
    for (const id of rotation.setupMen) {
      if (isAvailable(id)) {
        return team.players.find(p => p.id === id);
      }
    }
  }

  if (situation === 'lefty' && rotation.leftSpecialists.length > 0) {
    // 左打者対策: 左のワンポイント
    for (const id of rotation.leftSpecialists) {
      if (isAvailable(id)) {
        return team.players.find(p => p.id === id);
      }
    }
  }

  // 通常の中継ぎ（疲労が少ない順）
  const availableMiddle = rotation.middleRelievers
    .filter(isAvailable)
    .sort((a, b) => (fatigue[a] || 0) - (fatigue[b] || 0));

  if (availableMiddle.length > 0) {
    return team.players.find(p => p.id === availableMiddle[0]);
  }

  // 全員疲労している場合、セットアッパーから選択
  for (const id of [...rotation.setupMen, rotation.closer].filter(Boolean)) {
    const p = team.players.find(p => p.id === id);
    if (p) return p;
  }

  return null;
};

/**
 * リリーフ投手の疲労を更新
 * @param {string} teamName - チーム名
 * @param {number} pitcherId - 投手ID
 * @param {number} pitchCount - 投球数
 */
export const updateReliefFatigue = (teamName, pitcherId, pitchCount) => {
  const team = TEAMS_DATA[teamName];
  if (!team || !team.pitchingRotation) return;

  if (!team.pitchingRotation.reliefFatigue) {
    team.pitchingRotation.reliefFatigue = {};
  }

  // 疲労を加算（投球数の半分）
  const currentFatigue = team.pitchingRotation.reliefFatigue[pitcherId] || 0;
  team.pitchingRotation.reliefFatigue[pitcherId] = currentFatigue + Math.floor(pitchCount / 2);
};

/**
 * 日付進行時にリリーフ疲労を回復
 * @param {string} teamName - チーム名
 * @param {number} days - 経過日数
 */
export const recoverReliefFatigue = (teamName, days = 1) => {
  const team = TEAMS_DATA[teamName];
  if (!team || !team.pitchingRotation || !team.pitchingRotation.reliefFatigue) return;

  Object.keys(team.pitchingRotation.reliefFatigue).forEach(id => {
    team.pitchingRotation.reliefFatigue[id] = Math.max(0,
      team.pitchingRotation.reliefFatigue[id] - (20 * days)
    );
  });
};

// ES module exports
