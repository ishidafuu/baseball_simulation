import './engine-bootstrap.mjs';
import {
  getStaffIdCounter,
  setStaffIdCounter,
  getStaffNameHistory,
  setStaffNameHistory,
} from '../src/corporate/staffData.js';
import {
  TEAMS_DATA,
  LEAGUE_SETTINGS,
  releasedPlayersPool,
} from '../src/teams-data.js';
import { WORLD_DATA, initializeWorld } from '../src/corporate/worldData.js';
import { UNIVERSITY_TEAMS } from '../src/university/universityTeamsData.js';
import {
  serializeUniversityPool,
  deserializeUniversityPool,
} from '../src/season/universityPool.js';
import {
  getPlayerIdCounter,
  setPlayerIdCounter,
} from '../src/state/playerIds.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const rankKeys = [
  'rank',
  'reputation',
  'reputationHistory',
  'rankPosition',
  'rankingScore',
];

// 一人用セーブは未完了の背景大会を省略するため、そのままサーバー保存に流用しない。
export function captureWorld() {
  return clone({
    teams: TEAMS_DATA,
    settings: LEAGUE_SETTINGS,
    world: {
      ...WORLD_DATA,
      corporateLeague: {
        ...WORLD_DATA.corporateLeague,
        teams: Object.keys(WORLD_DATA.corporateLeague?.teams || {}),
      },
    },
    universityRanks: UNIVERSITY_TEAMS.map((team) => ({
      id: team.id,
      ...Object.fromEntries(
        rankKeys.filter((k) => team[k] !== undefined).map((k) => [k, team[k]]),
      ),
    })),
    pools: serializeUniversityPool(),
    released: releasedPlayersPool,
    playerIdCounter: getPlayerIdCounter(),
    staffIdCounter: getStaffIdCounter(),
    staffNames: getStaffNameHistory(),
  });
}

/**
 * 保存しておいた世界を、ゲームの大域状態（TEAMS_DATA など）へ戻す。
 *
 * 既定では `snapshot` を複製してから戻すので、同じ写しから何度でも戻せる。
 *
 * `{ take: true }` は**写しの持ち主ごと渡す**指定。複製せず、写しの中身をそのまま
 * 大域状態にする（以後の試合で写しの中身も書き換わる）。世界を丸ごと複製する処理が
 * 定期進行の時間の半分近くを占めていたので、1日を進める経路だけこれを使う。
 * ⚠ 使ってよいのは、戻した後に `captureWorld()` で写しを**作り直して差し替える**
 *    呼び出しだけ（`advanceLeagueDay`）。途中で例外が出たら、その写しは捨てること
 *    （保存の transaction は書かずに終わるので、保存側はそうなっている）。
 * ⚠ 下で書き換える小さな部分（企業リーグの球団一覧）だけは浅く写して、
 *    写しの側を壊さない。
 */
export function restoreWorld(snapshot, { take = false } = {}) {
  const data = take
    ? {
        ...snapshot,
        world: {
          ...snapshot.world,
          corporateLeague: { ...snapshot.world?.corporateLeague },
        },
      }
    : clone(snapshot);
  for (const key of Object.keys(TEAMS_DATA)) delete TEAMS_DATA[key];
  Object.assign(TEAMS_DATA, data.teams);
  for (const key of Object.keys(WORLD_DATA)) delete WORLD_DATA[key];
  initializeWorld('independent', data.world.userLeagueId);
  Object.assign(WORLD_DATA, data.world);
  WORLD_DATA.corporateLeague.teams = Object.fromEntries(
    (data.world.corporateLeague?.teams || [])
      .map((name) => [name, TEAMS_DATA[name]])
      .filter(([, team]) => team),
  );
  for (const key of Object.keys(LEAGUE_SETTINGS)) delete LEAGUE_SETTINGS[key];
  Object.assign(LEAGUE_SETTINGS, data.settings);
  deserializeUniversityPool(data.pools);
  releasedPlayersPool.splice(0, releasedPlayersPool.length, ...data.released);
  setPlayerIdCounter(data.playerIdCounter);
  const minimumStaffId = Object.values(TEAMS_DATA).reduce(
    (next, team) =>
      (team.corporateData?.staff || []).reduce(
        (id, staff) => Math.max(id, (staff.id || 4999) + 1),
        next,
      ),
    5000,
  );
  const savedCounter = Number.isSafeInteger(data.staffIdCounter)
    ? data.staffIdCounter
    : minimumStaffId;
  setStaffIdCounter(Math.max(minimumStaffId, savedCounter));
  setStaffNameHistory(
    Array.isArray(data.staffNames)
      ? data.staffNames
      : Object.values(TEAMS_DATA).flatMap((team) =>
          (team.corporateData?.staff || []).map((staff) => staff.name),
        ),
  );
  const ranks = new Map(data.universityRanks.map((team) => [team.id, team]));
  for (const team of UNIVERSITY_TEAMS) {
    const rank = ranks.get(team.id);
    for (const key of rankKeys) {
      if (rank && Object.hasOwn(rank, key)) team[key] = rank[key];
      else if (key !== 'rank') delete team[key];
    }
  }
}
