import { TEAMS_DATA, releasedPlayersPool } from '../teams-data.js';
import { universityPool, highSchoolPool } from './schoolPools.js';

let lastIssuedId = 0;

export const getPlayerIdCounter = () => lastIssuedId;

export const setPlayerIdCounter = value => {
  lastIssuedId = Number.isSafeInteger(value) && value >= 0 ? value : 0;
};

// 未所属の候補も同一セッションでは再発行しない。ロード後は全所属先の最大値から再開する。
export const reservePlayerIds = (minimum = 0) => {
  let maxId = Math.max(lastIssuedId, minimum - 1);
  const include = player => {
    if (Number.isSafeInteger(player?.id) && player.id > maxId) maxId = player.id;
  };
  for (const team of Object.values(TEAMS_DATA)) {
    for (const player of team.players || []) include(player);
  }
  for (const player of highSchoolPool.players || []) include(player);
  for (const cohort of Object.values(universityPool)) {
    if (Array.isArray(cohort)) for (const entry of cohort) include(entry?.player || entry);
  }
  for (const player of releasedPlayersPool) include(player);
  lastIssuedId = maxId;
  return () => ++lastIssuedId;
};
