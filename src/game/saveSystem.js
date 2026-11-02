import { compressData, compressDataAsync, decompressData, decompressDataAsync, getLocalStorageUsage } from '../utils/compression.js';
import { TEAMS_DATA, releasedPlayersPool, clearReleasedPlayersPool } from '../teams-data.js';
import { addManyToReleasedPool } from '../state/pools.js';
import { createSeasonStats, createCareerStats } from '../players.js';
import { WORLD_DATA, initializeWorld } from '../corporate/worldData.js';
import { universityPool, highSchoolPool, serializeUniversityPool, deserializeUniversityPool, seedInitialUniversityClasses, absorbUniversityPoolIntoRosters } from '../season/universityPool.js';
import { UNIVERSITY_TEAMS, generateLeagueAbbreviations } from '../university/universityTeamsData.js';
import { isIndexedDBAvailable, idbGetItem, idbSetItem, idbRemoveItem, migrateLocalStorageToIDB, getIDBUsage, requestPersistentStorage } from '../utils/indexedDBStorage.js';
import { migrateSaveData, CURRENT_SAVE_VERSION } from './saveMigration.js';
import { getPlayerIdCounter, reservePlayerIds, setPlayerIdCounter } from '../state/playerIds.js';
import { showMessage } from '../utils/gameDialog.js';

export const SAVE_SLOT_KEYS = ['baseballSim_save_1', 'baseballSim_save_2', 'baseballSim_save_3'];

const useIDB = isIndexedDBAvailable();

let _migrationPromise = null;
export async function ensureMigration() {
  if (!useIDB) return;
  if (!_migrationPromise) {
    _migrationPromise = (async () => {
      // 同時に呼ばれた読み込みも移行の完了まで待つ。
      requestPersistentStorage().then(r => {
        if (r.supported && !r.persisted) console.warn('保存領域の永続化が許可されませんでした（空き容量が減ると消える可能性があります）');
      }).catch(() => {});
      const count = await migrateLocalStorageToIDB(SAVE_SLOT_KEYS);
      const oldKey = 'baseballSim_saveData';
      const oldData = localStorage.getItem(oldKey);
      if (oldData) {
        const existing = await idbGetItem(SAVE_SLOT_KEYS[0]);
        const localExisting = localStorage.getItem(SAVE_SLOT_KEYS[0]);
        // 既存スロットがあれば旧キーは残す。どちらが新しいか判定せず上書きしない。
        if (!existing && !localExisting) {
          await idbSetItem(SAVE_SLOT_KEYS[0], oldData);
          if (await idbGetItem(SAVE_SLOT_KEYS[0]) === oldData) localStorage.removeItem(oldKey);
        }
      }
      if (count > 0) console.log(`IndexedDBに${count}件のセーブデータを移行しました`);
    })().catch(e => {
      _migrationPromise = null;
      console.warn('IndexedDB移行失敗（localStorageにフォールバック）:', e);
    });
  }
  await _migrationPromise;
}

const savedAt = async (raw) => {
  try {
    const data = await decompressDataAsync(raw);
    const time = Date.parse(data?.timestamp || '');
    return Number.isFinite(time) ? time : -Infinity;
  } catch { return -Infinity; }
};

async function storageGetItem(key) {
  let localValue = null;
  try { localValue = localStorage.getItem(key); } catch { /* IndexedDB が使える場合は続行 */ }
  if (useIDB) {
    try {
      const val = await idbGetItem(key);
      if (val !== null && localValue !== null) {
        return (await savedAt(localValue)) >= (await savedAt(val)) ? localValue : val;
      }
      if (val !== null) return val;
    } catch { /* fall through */ }
  }
  return localValue;
}

// ⚠ **読みと書きで対称にすること**。読み（`storageGetItem`）は IndexedDB が
//    失敗したら localStorage へ落ちるのに、書きは落ちずにそのまま throw していた。
//    `isIndexedDBAvailable()` は `typeof indexedDB` を見るだけなので、
//    **「オブジェクトはあるが open が失敗する」環境**（Firefox の `file://`、
//    Safari のプライベート、容量超過）で保存だけが丸ごと失敗する。
//    IndexedDB が駄目なら localStorage に書く。両方駄目なら初めて throw する。
async function storageSetItem(key, value) {
  if (useIDB) {
    try {
      await idbSetItem(key, value);
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      return 'IndexedDB';
    } catch (e) {
      console.warn('IndexedDBへの保存に失敗。localStorageへ切り替えます:', e);
    }
  }
  localStorage.setItem(key, value);
  return 'localStorage';
}

async function storageRemoveItem(key) {
  let idbError = null;
  let localError = null;
  if (useIDB) {
    try { await idbRemoveItem(key); } catch (error) { idbError = error; }
  }
  try { localStorage.removeItem(key); } catch (error) { localError = error; }
  if (idbError || localError) throw idbError || localError;
}

// ============================================================
// バックアップ & 緊急保存
// ============================================================
const backupKey = (slotIndex) => `${SAVE_SLOT_KEYS[slotIndex]}_bak`;
export const EMERGENCY_KEY = 'baseballSim_emergency';

// スロット上書き前に既存データを1世代バックアップ（破損・誤上書きからの復旧用）
async function backupExistingSlot(slotIndex) {
  try {
    const existing = await storageGetItem(SAVE_SLOT_KEYS[slotIndex]);
    if (existing) await storageSetItem(backupKey(slotIndex), existing);
  } catch (e) { /* バックアップ失敗はセーブ本体を止めない */ }
}

// バックアップの有無・メタ情報を取得
export const getBackupInfo = async (slotIndex) => {
  try {
    const raw = await storageGetItem(backupKey(slotIndex));
    if (!raw) return null;
    const data = await decompressDataAsync(raw);
    if (!data) return null;
    return { timestamp: data.timestamp || null, year: data.seasonData?.year ?? null, gameMode: data.gameMode || null };
  } catch { return null; }
};

// バックアップをスロットへ復元
export const restoreBackup = async (slotIndex) => {
  try {
    const raw = await storageGetItem(backupKey(slotIndex));
    if (!raw) return { success: false, error: 'バックアップがありません' };
    await storageSetItem(SAVE_SLOT_KEYS[slotIndex], raw);
    return { success: true };
  } catch (e) {
    return { success: false, error: '復元に失敗しました: ' + e.message };
  }
};

// 緊急保存: クラッシュ時に同期的（localStorage）へ現在状態を書き出す。
// IndexedDBは非同期のためクラッシュ中は不確実 → 確実に残る localStorage を使う。
export const saveEmergency = (gameState) => {
  try {
    const saveData = buildSaveData(gameState, gameState?.slotIndex ?? 0);
    saveData._emergency = true;
    const compressed = compressData(saveData);
    localStorage.setItem(EMERGENCY_KEY, compressed);
    return true;
  } catch (e) {
    console.error('緊急保存失敗:', e);
    return false;
  }
};

// 緊急保存の有無・メタ情報
export const getEmergencyInfo = () => {
  try {
    const raw = localStorage.getItem(EMERGENCY_KEY);
    if (!raw) return null;
    const data = decompressData(raw);
    if (!data) return null;
    return { timestamp: data.timestamp || null, year: data.seasonData?.year ?? null, gameMode: data.gameMode || null };
  } catch { return null; }
};

export const clearEmergencySave = () => {
  try { localStorage.removeItem(EMERGENCY_KEY); } catch { /* ignore */ }
};

// ============================================================
// オートセーブ（節目で自動保存する専用スロット。手動3スロットとは別枠）
// ============================================================
export const AUTOSAVE_KEY = 'baseballSim_autosave';
const AUTOSAVE_ENABLED_KEY = 'baseballSim_autosave_enabled';

export const isAutosaveEnabled = () => {
  try {
    const v = localStorage.getItem(AUTOSAVE_ENABLED_KEY);
    return v === null ? true : v === '1'; // 既定ON
  } catch { return true; }
};
export const setAutosaveEnabled = (on) => {
  try { localStorage.setItem(AUTOSAVE_ENABLED_KEY, on ? '1' : '0'); } catch { /* ignore */ }
};

// 現在の状態をオートセーブ枠へ保存（非同期・圧縮）。
export const autoSave = async (gameState) => {
  try {
    const saveData = buildSaveData(gameState, gameState?.slotIndex ?? 0);
    saveData._autosave = true;
    const compressed = await compressDataAsync(saveData);
    await storageSetItem(AUTOSAVE_KEY, compressed);
    return { success: true };
  } catch (e) {
    console.warn('オートセーブ失敗:', e);
    return { success: false, error: e.message };
  }
};

// オートセーブのメタ情報（存在チェック・表示用）。
export const getAutosaveInfo = async () => {
  try {
    const raw = await storageGetItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const data = await decompressDataAsync(raw);
    if (!data) return null;
    return {
      timestamp: data.timestamp || null,
      year: data.seasonData?.year ?? null,
      date: data.seasonData?.currentDate || null,
      phase: data.seasonData?.phase || null,
      gameMode: data.gameMode || null,
    };
  } catch { return null; }
};

// 緊急保存をスロットへ書き込んで通常ロード可能にする
export const promoteEmergencyToSlot = async (slotIndex) => {
  try {
    const raw = localStorage.getItem(EMERGENCY_KEY);
    if (!raw) return { success: false, error: '緊急保存がありません' };
    await storageSetItem(SAVE_SLOT_KEYS[slotIndex], raw);
    return { success: true };
  } catch (e) {
    return { success: false, error: '復元に失敗しました: ' + e.message };
  }
};

// セーブスロット情報を読み取り（async版）
export const readSaveSlots = async () => {
  await ensureMigration();
  const results = [];
  for (const key of SAVE_SLOT_KEYS) {
    try {
      const savedData = await storageGetItem(key);
      if (!savedData) { results.push(null); continue; }
      const data = await decompressDataAsync(savedData);
      if (!data) { results.push(null); continue; }
      results.push({
        timestamp: data.timestamp,
        year: data.seasonData?.year || 1,
        date: data.seasonData?.currentDate || { month: 4, day: 1 },
        phase: data.seasonData?.phase || 'regular_season',
        teamName: data.seasonData?.settings?.teamNames?.[0]
          || (data.leagueConfig?.leagues || []).flatMap(l => l.teams || [])[0]
          || null,
        version: data.version || 'unknown'
      });
    } catch { results.push(null); }
  }
  return results;
};

// 同期版（後方互換用 — 既にロード済みデータがあればキャッシュから返す）
let _cachedSlots = null;
export const readSaveSlotsSync = () => _cachedSlots || [null, null, null];
export const setCachedSlots = (slots) => { _cachedSlots = slots; };

// 旧データ移行チェック（IndexedDBへの移行はensureMigrationで実施）
export const migrateOldSaveData = () => {
  if (useIDB) return false;
  const oldData = localStorage.getItem('baseballSim_saveData');
  if (oldData && !localStorage.getItem(SAVE_SLOT_KEYS[0])) {
    localStorage.setItem(SAVE_SLOT_KEYS[0], oldData);
    if (localStorage.getItem(SAVE_SLOT_KEYS[0]) === oldData) {
      localStorage.removeItem('baseballSim_saveData');
      return true;
    }
  }
  return false;
};

// ゲームデータを保存（async版）
// セーブ用データオブジェクトを構築（saveGameToSlot / 緊急バックアップで共用）
export const buildSaveData = (gameState, slotIndex = 0) => {
  const worldDataSnapshot = WORLD_DATA.initialized ? {
    initialized: WORLD_DATA.initialized,
    mode: WORLD_DATA.mode,
    userLeagueId: WORLD_DATA.userLeagueId,
    year: WORLD_DATA.year,
    independentLeagues: JSON.parse(JSON.stringify(WORLD_DATA.independentLeagues)),
    universityLeagues: WORLD_DATA.universityLeagues ? JSON.parse(JSON.stringify(WORLD_DATA.universityLeagues)) : {},
    corporateLeague: { teams: Object.keys(WORLD_DATA.corporateLeague?.teams || {}), userTeam: WORLD_DATA.corporateLeague?.userTeam },
    draft: JSON.parse(JSON.stringify(WORLD_DATA.draft)),
    // 夏の甲子園。ブラケット全体は嵩むので、表示に使う結果だけを残す
    koshien: WORLD_DATA.koshien ? {
      year: WORLD_DATA.koshien.year,
      champion: WORLD_DATA.koshien.champion,
      runnerUp: WORLD_DATA.koshien.runnerUp,
      entries: WORLD_DATA.koshien.entries,
      notable: WORLD_DATA.koshien.notable,
    } : null,
    corporateToshitaikou: WORLD_DATA.corporateToshitaikou ? {
      generated: WORLD_DATA.corporateToshitaikou.generated,
      qualifiersDone: WORLD_DATA.corporateToshitaikou.qualifiersDone,
      mainDone: WORLD_DATA.corporateToshitaikou.mainDone,
      champion: WORLD_DATA.corporateToshitaikou.champion,
      runnerUp: WORLD_DATA.corporateToshitaikou.runnerUp,
    } : null,
    // 注目選手リスト（playerIdだけ保持。現在地は表示時に各プールを引いて解決する）
    watchList: Array.isArray(WORLD_DATA.watchList) ? JSON.parse(JSON.stringify(WORLD_DATA.watchList)) : [],
    corporateNihonSenshuken: WORLD_DATA.corporateNihonSenshuken ? {
      generated: WORLD_DATA.corporateNihonSenshuken.generated,
      done: WORLD_DATA.corporateNihonSenshuken.done,
      champion: WORLD_DATA.corporateNihonSenshuken.champion,
      runnerUp: WORLD_DATA.corporateNihonSenshuken.runnerUp,
    } : null,
    corporateClubSenshuken: WORLD_DATA.corporateClubSenshuken ? {
      generated: WORLD_DATA.corporateClubSenshuken.generated,
      done: WORLD_DATA.corporateClubSenshuken.done,
      champion: WORLD_DATA.corporateClubSenshuken.champion,
      runnerUp: WORLD_DATA.corporateClubSenshuken.runnerUp,
    } : null,
    corporateRegionalTournament: WORLD_DATA.corporateRegionalTournament ? {
      generated: WORLD_DATA.corporateRegionalTournament.generated,
      done: WORLD_DATA.corporateRegionalTournament.phase === 'done' || !!WORLD_DATA.corporateRegionalTournament.done,
    } : null,
    universityLeague: WORLD_DATA.universityLeague ? JSON.parse(JSON.stringify(WORLD_DATA.universityLeague)) : null,
    _uniTournaments: WORLD_DATA._uniTournaments ? JSON.parse(JSON.stringify(WORLD_DATA._uniTournaments)) : null,
    grandChampionship: WORLD_DATA.grandChampionship ? JSON.parse(JSON.stringify(WORLD_DATA.grandChampionship)) : null,
    _universityScout: WORLD_DATA._universityScout ? JSON.parse(JSON.stringify(WORLD_DATA._universityScout)) : null,
    _teamRanking: WORLD_DATA._teamRanking ? JSON.parse(JSON.stringify(WORLD_DATA._teamRanking)) : null,
    managerCareer: Array.isArray(WORLD_DATA.managerCareer) ? JSON.parse(JSON.stringify(WORLD_DATA.managerCareer)) : [],
    _uniTeamRepData: UNIVERSITY_TEAMS.reduce((acc, t) => {
      if (t.reputation !== undefined || t.reputationHistory || t.rankPosition !== undefined || t.rankingScore !== undefined) {
        acc[t.name] = { rank: t.rank, reputation: t.reputation, reputationHistory: t.reputationHistory, rankPosition: t.rankPosition, rankingScore: t.rankingScore };
      }
      return acc;
    }, {}),
  } : null;

  return {
    version: CURRENT_SAVE_VERSION,
    timestamp: new Date().toISOString(),
    slotIndex,
    seasonData: gameState.seasonData,
    leagueConfig: gameState.leagueConfig,
    teamsData: JSON.parse(JSON.stringify(TEAMS_DATA)),
    worldData: worldDataSnapshot,
    screenMode: gameState.screenMode,
    managementView: gameState.managementView,
    gameFlowState: gameState.gameFlowState,
    gameMode: gameState.gameMode,
    selectedMonth: gameState.selectedMonth,
    hallOfFamePlayers: gameState.hallOfFamePlayers,
    teamHistory: gameState.teamHistory,
    universityPool: serializeUniversityPool(),
    releasedPlayersPool: JSON.parse(JSON.stringify(releasedPlayersPool)),
    playerIdCounter: getPlayerIdCounter(),
  };
};

export const saveGameToSlot = async (slotIndex, gameState, onProgress) => {
  const progress = (pct) => { if (onProgress) onProgress(pct); };
  try {
    progress(10);
    const saveData = buildSaveData(gameState, slotIndex);
    progress(30);
    // 上書き前に既存セーブをバックアップ（新セーブ破損時に復旧できるよう1世代保持）
    await backupExistingSlot(slotIndex);
    progress(45);
    const compressed = await compressDataAsync(saveData);
    progress(85);
    const storage = await storageSetItem(SAVE_SLOT_KEYS[slotIndex], compressed);
    progress(100);
    return { success: true, storage };
  } catch (error) {
    console.error('セーブ失敗:', error);
    if (error.name === 'QuotaExceededError') {
      return { success: false, error: 'ストレージ容量が不足しています。古いセーブデータを削除してください。' };
    }
    return { success: false, error: 'セーブに失敗しました: ' + error.message };
  }
};

// セーブデータの基本バリデーション
const validateSaveData = (data) => {
  if (!data || typeof data !== 'object') return 'セーブデータが空または不正です';
  if (!data.seasonData) return 'シーズンデータが含まれていません';
  if (!data.teamsData || typeof data.teamsData !== 'object') return 'チームデータが含まれていません';
  const teamNames = Object.keys(data.teamsData);
  if (teamNames.length === 0) return 'チームデータが空です';
  for (const name of teamNames) {
    const team = data.teamsData[name];
    if (!team.players || !Array.isArray(team.players)) return `${name}の選手データが不正です`;
  }
  return null;
};

// ゲームデータを読み込み（async版）。keyOverride指定時はそのキーから読む（オートセーブ等）。
export const loadGameFromSlot = async (slotIndex, keyOverride = null) => {
  let previousState = null;
  try {
    const savedData = await storageGetItem(keyOverride || SAVE_SLOT_KEYS[slotIndex]);
    if (!savedData) {
      return { success: false, error: 'セーブデータがありません' };
    }

    const rawData = await decompressDataAsync(savedData);
    if (!rawData) {
      return { success: false, error: 'セーブデータの解凍に失敗しました。データが破損している可能性があります。' };
    }

    // バージョン移行＋正規化（旧セーブの欠損フィールドをここでバックフィル）
    const { data: saveData, fromVersion, applied, warnings } = migrateSaveData(rawData);
    if (warnings.length) console.warn('セーブ移行の注意:', warnings.join(' / '));
    if (applied.length) console.log(`セーブを ${fromVersion} → ${CURRENT_SAVE_VERSION} に移行しました`);

    const validationError = validateSaveData(saveData);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // 後続の復元処理が失敗しても、実行中の世界全体を元に戻せるよう参照を保持する。
    // ここからの処理は旧オブジェクトを変更せず、新しい枝へ差し替える。
    const uniKeys = ['rank', 'reputation', 'reputationHistory', 'rankPosition', 'rankingScore'];
    previousState = {
      teams: { ...TEAMS_DATA },
      world: { ...WORLD_DATA },
      university: UNIVERSITY_TEAMS.map(team => Object.fromEntries(
        uniKeys.filter(key => Object.hasOwn(team, key)).map(key => [key, team[key]])
      )),
      universityPool: { ...universityPool },
      highSchoolPool: { players: highSchoolPool.players, year: highSchoolPool.year },
      releasedPlayers: [...releasedPlayersPool],
      playerIdCounter: getPlayerIdCounter(),
    };
    Object.keys(TEAMS_DATA).forEach(k => delete TEAMS_DATA[k]);
    Object.assign(TEAMS_DATA, saveData.teamsData);

    // ⚠ 旧セーブの幽霊OBレコードの除去は `saveMigration.normalizeSaveData` が担当する
    //    （`pruneGhostAlumni`）。ここに書き写さないこと——移行の置き場所は1つ。

    // 大学チームの略称をリーグ内で一意化（旧セーブの3文字重複を解消）
    const uniNames = Object.keys(TEAMS_DATA).filter(n => TEAMS_DATA[n]?.universityTeamId);
    if (uniNames.length > 0) {
      const abbrs = generateLeagueAbbreviations(uniNames);
      uniNames.forEach(n => { TEAMS_DATA[n].abbreviation = abbrs[n]; });
    }

    // WORLD_DATA復元。旧セーブにworldDataが無くても前のゲームの世界を残さない。
    const mode = saveData.gameMode === 'normal' ? 'independent' : (saveData.gameMode || 'independent');
    initializeWorld(mode, saveData.seasonData?.settings?.preset || null);
    WORLD_DATA.year = saveData.seasonData?.year || 1;
    WORLD_DATA.initialized = false;
    if (saveData.worldData && saveData.worldData.initialized) {
      const wd = saveData.worldData;
      WORLD_DATA.initialized = true;
      WORLD_DATA.mode = wd.mode;
      WORLD_DATA.userLeagueId = wd.userLeagueId;
      WORLD_DATA.year = wd.year;
      WORLD_DATA.independentLeagues = wd.independentLeagues || {};
      WORLD_DATA.universityLeagues = wd.universityLeagues || {};
      WORLD_DATA.corporateLeague = {
        teams: {},
        userTeam: wd.corporateLeague?.userTeam || null,
      };
      if (wd.corporateLeague?.teams) {
        for (const name of wd.corporateLeague.teams) {
          if (TEAMS_DATA[name]) WORLD_DATA.corporateLeague.teams[name] = TEAMS_DATA[name];
        }
      }
      WORLD_DATA.draft = wd.draft || { draftedPlayers: [], history: [] };
      WORLD_DATA.koshien = wd.koshien || null;
      WORLD_DATA.watchList = Array.isArray(wd.watchList) ? wd.watchList : [];
      // 未完了トーナメントはnullにリセット → checkAndTriggerEventsで再生成＋キャッチアップ
      const ctd = wd.corporateToshitaikou;
      WORLD_DATA.corporateToshitaikou = (ctd && ctd.mainDone) ? ctd : null;
      const cns = wd.corporateNihonSenshuken;
      WORLD_DATA.corporateNihonSenshuken = (cns && cns.done) ? cns : null;
      const ccs = wd.corporateClubSenshuken;
      WORLD_DATA.corporateClubSenshuken = (ccs && ccs.done) ? ccs : null;
      const crt = wd.corporateRegionalTournament;
      WORLD_DATA.corporateRegionalTournament = (crt && crt.done) ? { generated: true, done: true, phase: 'done' } : null;
      WORLD_DATA.universityLeague = wd.universityLeague || null;
      WORLD_DATA._uniTournaments = wd._uniTournaments || null;
      WORLD_DATA.grandChampionship = wd.grandChampionship || null;
      WORLD_DATA._universityScout = wd._universityScout || null;
      WORLD_DATA._teamRanking = wd._teamRanking || null;
      WORLD_DATA.managerCareer = Array.isArray(wd.managerCareer) ? wd.managerCareer : [];
      // UNIVERSITY_TEAMSの注目度データを復元
      if (wd._uniTeamRepData) {
        for (const teamDef of UNIVERSITY_TEAMS) {
          const d = wd._uniTeamRepData[teamDef.name];
          if (d) {
            if (d.rank) teamDef.rank = d.rank;
            if (d.reputation !== undefined) teamDef.reputation = d.reputation;
            if (d.reputationHistory) teamDef.reputationHistory = d.reputationHistory;
            if (d.rankPosition !== undefined) teamDef.rankPosition = d.rankPosition;
            if (d.rankingScore !== undefined) teamDef.rankingScore = d.rankingScore;
          }
        }
      }
    }

    // 大学プール復元
    deserializeUniversityPool(saveData.universityPool || null);
    const loadedYear = saveData.seasonData?.year || 1;
    // 旧セーブはプールにも在学生を持つ。大学生の実体は名簿ひとつなので名簿へ移す
    absorbUniversityPoolIntoRosters(TEAMS_DATA, loadedYear);
    seedInitialUniversityClasses(loadedYear);

    // リリースプール復元
    clearReleasedPlayersPool();
    if (saveData.releasedPlayersPool && Array.isArray(saveData.releasedPlayersPool)) {
      addManyToReleasedPool(saveData.releasedPlayersPool);
    }

    setPlayerIdCounter(saveData.playerIdCounter);
    reservePlayerIds();

    // ※旧セーブの選手フィールド補完（バント/性格/DH等）は migrateSaveData で
    //   復元前に済ませているため、ここでの追加処理は不要。

    return { success: true, data: saveData };
  } catch (error) {
    if (previousState) {
      Object.keys(TEAMS_DATA).forEach(k => delete TEAMS_DATA[k]);
      Object.assign(TEAMS_DATA, previousState.teams);
      Object.keys(WORLD_DATA).forEach(k => delete WORLD_DATA[k]);
      Object.assign(WORLD_DATA, previousState.world);
      const uniKeys = ['rank', 'reputation', 'reputationHistory', 'rankPosition', 'rankingScore'];
      UNIVERSITY_TEAMS.forEach((team, index) => {
        for (const key of uniKeys) {
          if (Object.hasOwn(previousState.university[index], key)) team[key] = previousState.university[index][key];
          else delete team[key];
        }
      });
      deserializeUniversityPool({ university: previousState.universityPool, highSchool: previousState.highSchoolPool });
      clearReleasedPlayersPool();
      addManyToReleasedPool(previousState.releasedPlayers);
      setPlayerIdCounter(previousState.playerIdCounter);
    }
    console.error('ロード失敗:', error);
    return { success: false, error: 'ロードに失敗しました: ' + error.message };
  }
};

// セーブデータを削除（async版）
export const deleteSaveSlot = async (slotIndex) => {
  try {
    await storageRemoveItem(SAVE_SLOT_KEYS[slotIndex]);
    return true;
  } catch (error) {
    console.error('削除失敗:', error);
    return false;
  }
};

// ============================================================
// セーブのファイル書き出し／読み込み
//
// ⚠ **ブラウザの保存領域はオリジン（scheme+ホスト+ポート）に閉じている**。
//    `localhost:3000` で作ったセーブは `localhost:3001` からは1件も見えず、
//    **ページ内のコードでは絶対に跨げない**（同一オリジンポリシー）。
//    ポートがずれた・別のブラウザに乗り換えた・PCを変えた、のいずれでも
//    ファイルに出す以外の持ち出し手段が無いので、ここが唯一の避難経路になる。
// ⚠ 中身は保存されている圧縮文字列**そのまま**を包むだけにすること。
//    ここで作り直すと、セーブの形式が2箇所に分かれて必ず腐る。
// ============================================================
const SAVE_FILE_TYPE = 'baseball_sim_save';

const downloadJson = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
};

export const exportSaveSlotToFile = async (slotIndex) => {
  try {
    const raw = await storageGetItem(SAVE_SLOT_KEYS[slotIndex]);
    if (!raw) return { success: false, error: 'このスロットにセーブがありません' };
    // メタはファイル名と取り違え防止のためだけに持つ（正本は payload）
    let meta = {};
    try {
      const d = await decompressDataAsync(raw);
      meta = {
        year: d?.seasonData?.year ?? null,
        timestamp: d?.timestamp ?? null,
        // ⚠ チーム名の引き方は `readSaveSlots` と同じにすること（表を二重に作らない）
        teamName: d?.seasonData?.settings?.teamNames?.[0]
          || (d?.leagueConfig?.leagues || []).flatMap(l => l.teams || [])[0]
          || null,
      };
    } catch { /* メタが読めなくても書き出しは通す */ }
    const blob = new Blob([JSON.stringify({
      type: SAVE_FILE_TYPE, version: CURRENT_SAVE_VERSION,
      exportDate: new Date().toISOString(), slotIndex, meta, payload: raw,
    })], { type: 'application/json' });
    // ⚠ **ファイル名は ASCII にすること**。日本語を入れると Chromium が
    //    `download` 属性ごと無視して、**拡張子の無い `download` という名前**で落とす
    //    （実測: `野球シミュレーター_セーブ1_….json` → `download` /
    //    `baseball-sim_save1_….json` → そのまま）。拡張子が消えると読み込みで選べない。
    // ⚠ アンカーはDOMに挿してからクリックし、revoke は次のタスクまで待つ
    //    （4MBのセーブは即 revoke すると転送が間に合わないことがある）。
    downloadJson(blob, `baseball-sim_save${slotIndex + 1}_${new Date().toISOString().slice(0, 10)}.json`);
    return { success: true };
  } catch (e) {
    return { success: false, error: '書き出しに失敗しました: ' + e.message };
  }
};

export const importSaveFileToSlot = async (slotIndex, file) => {
  try {
    const text = await file.text();
    let env;
    try { env = JSON.parse(text); } catch { return { success: false, error: 'セーブファイルとして読めませんでした' }; }
    if (env?.type !== SAVE_FILE_TYPE || typeof env.payload !== 'string') {
      return { success: false, error: 'このゲームのセーブファイルではありません' };
    }
    // ⚠ **書き込む前に必ず中身を検証する**。壊れたファイルでスロットを潰さない
    const data = await decompressDataAsync(env.payload);
    const invalid = validateSaveData(data);
    if (invalid) return { success: false, error: 'セーブデータが壊れています: ' + invalid };
    await backupExistingSlot(slotIndex);
    await storageSetItem(SAVE_SLOT_KEYS[slotIndex], env.payload);
    return { success: true };
  } catch (e) {
    return { success: false, error: '読み込みに失敗しました: ' + e.message };
  }
};

// ストレージ使用量を取得
// ⚠ **今は誰も呼んでいない**（未使用exportの掃除で見つかった）。消さずに残してあるのは、
//    これが `getIDBUsage` / `getLocalStorageUsage` の唯一の呼び出し口で、消すと3ファイルに
//    またがって道連れになるため。セーブは約1.46MB あり、容量が逼迫するとブラウザが
//    IndexedDB を捨てる（`requestPersistentStorage` を足したのはそのため）ので、
//    セーブ画面に使用量を出すときにここを使う。
export async function getStorageUsage() {
  if (useIDB) {
    return getIDBUsage();
  }
  return getLocalStorageUsage();
}

// ============================================================
// ドラフト指名選手のエクスポート/インポート
// （資料室 → 箱庭モードの選手設定 にデータを引き渡すための機能）
// ============================================================

// ドラフト指名選手をJSONファイルとしてエクスポート
export const exportDraftedPlayers = (draftedPlayers) => {
  if (!draftedPlayers || draftedPlayers.length === 0) {
    showMessage('エクスポートするドラフト指名選手がいません');
    return;
  }
  const exportData = {
    version: '1.0',
    type: 'drafted_players',
    exportDate: new Date().toISOString(),
    count: draftedPlayers.length,
    players: draftedPlayers.map(p => ({
      name: p.name,
      age: p.age,
      position: p.position,
      batting: p.batting,
      pitching: p.pitching,
      physical: p.physical,
      fielding: p.fielding,
      positionFitness: p.positionFitness,
      growthPotential: p.growthPotential,
      personality: p.personality,
      origin: p.origin,
      draftRound: p.draftRound,
      draftTeam: p.draftTeam
    }))
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  downloadJson(blob, `drafted_players_${new Date().toISOString().slice(0, 10)}.json`);
};

// ドラフト指名選手をJSONファイルからインポート
export const importDraftedPlayers = (onImported) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.type !== 'drafted_players' || !data.players || !Array.isArray(data.players)) {
          showMessage('ドラフト指名選手データではありません');
          return;
        }
        if (onImported) onImported(data.players);
      } catch (err) {
        showMessage('インポートに失敗しました: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
};

// インポートされたドラフト選手を箱庭用に変換
export const convertDraftedPlayerToSandboxPlayer = (draftedPlayer, id) => {
  return {
    id,
    name: draftedPlayer.name,
    age: draftedPlayer.age || 18,
    position: draftedPlayer.position || 'pitcher',
    batting: draftedPlayer.batting || { meet: 50, power: 50, eye: 50, bats: 'right', bunt: 50 },
    pitching: draftedPlayer.pitching || { velocity: 140, control: 50, stamina: 100, form: 'overhand', arsenal: [{ type: 'straight', level: 50 }] },
    physical: draftedPlayer.physical || { speed: 50, arm: 50, throws: 'right' },
    fielding: draftedPlayer.fielding || { defense: 50, steal: 50, cLead: 50 },
    positionFitness: draftedPlayer.positionFitness || {},
    growthPotential: draftedPlayer.growthPotential || 1.0,
    personality: draftedPlayer.personality || { discipline: 50, mental: 50 },
    battingOrder: 0,
    seasonStats: createSeasonStats(),
    careerStats: createCareerStats(),
    condition: 2,
    fatigue: 0,
    fame: 0,
    origin: draftedPlayer.origin || 'draft',
  };
};
