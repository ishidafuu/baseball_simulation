import assert from 'node:assert/strict';
import { normalizePlayer } from '../../src/game/saveMigration.js';
import { reservePlayerIds } from '../../src/state/playerIds.js';
import { TEAMS_DATA, releasedPlayersPool } from '../../src/teams-data.js';
import { universityPool, highSchoolPool } from '../../src/state/schoolPools.js';
import { initializeStandings, updateStandings, updatePlayoffProgress, getPlayoffChampion, SEASON_PHASES } from '../../src/season/seasonManager.js';
import { handlePhaseTransition } from '../../src/season/dateProgression.js';
import { createSeededRandom, withSeededRandom } from '../../src/game/rng.js';
import { getModeCapabilities } from '../../src/game/modeCapabilities.js';
import { WORLD_DATA } from '../../src/corporate/worldData.js';
import { generateGrandChampionship } from '../../src/corporate/parallelWorldManager.js';
import { ensureCompleteLineup } from '../../src/game/lineup.js';

const fieldPositions = ['catcher', 'first', 'second', 'short', 'third', 'left', 'center', 'right'];
const lineupTeam = {
  players: [
    ...fieldPositions.map((position, index) => ({ id: index + 1, position })),
    { id: 9, position: 'pitcher' },
  ],
  pitchingRotation: { starters: [9], currentStarterIndex: 0 },
  lineupSettings: { battingOrder: [
    ...fieldPositions.slice(0, 7).map((position, index) => ({ playerId: index + 1, position, battingOrder: index + 1 })),
    { playerId: 1, position: 'right', battingOrder: 8 },
    { playerId: 8, position: 'right', battingOrder: 9 },
  ] },
};
assert.equal(ensureCompleteLineup(lineupTeam, false), true);
assert.equal(lineupTeam.lineupSettings.battingOrder.length, 9, '8野手と投手で9人を確保する');
assert.equal(new Set(lineupTeam.lineupSettings.battingOrder.map(entry => entry.playerId)).size, 9);
assert.equal(lineupTeam.lineupSettings.battingOrder[8].playerId, 9, '9番はローテーションの投手');
assert.equal(new Set(lineupTeam.lineupSettings.battingOrder.map(entry => entry.position)).size, 9);
const noPitcher = structuredClone(lineupTeam);
noPitcher.players = noPitcher.players.filter(player => player.position !== 'pitcher');
assert.equal(ensureCompleteLineup(noPitcher, false), false, '投手がいなければ9人完了と扱わない');
const dhTeam = structuredClone(lineupTeam);
dhTeam.players.push({ id: 10, position: 'first' });
assert.equal(ensureCompleteLineup(dhTeam, true), true, 'DH制でも9打順を揃える');
assert.equal(dhTeam.lineupSettings.battingOrder.filter(entry => entry.position === 'dh').length, 1);
// ⚠ DH制で次の先発投手を打順に入れても、その枠は控えで埋める
//    （試合では先発の打順が外れるので、残すと8人で戦うことになっていた）
const dhStarter = structuredClone(dhTeam);
dhStarter.players.push({ id: 11, position: 'left' });
dhStarter.lineupSettings.battingOrder[2] = { ...dhStarter.lineupSettings.battingOrder[2], playerId: 9 };
assert.equal(ensureCompleteLineup(dhStarter, true), true, 'DH制で先発投手を外しても9人揃う');
assert.ok(!dhStarter.lineupSettings.battingOrder.some(entry => entry.playerId === 9), 'DH制で次の先発投手が打順に残っている');
assert.equal(new Set(dhStarter.lineupSettings.battingOrder.map(entry => entry.playerId)).size, 9);

const oldPlayer = { id: 42, name: '旧選手', position: 'pitcher' };
const a = normalizePlayer(structuredClone(oldPlayer));
const b = normalizePlayer(structuredClone(oldPlayer));
assert.deepEqual(a, b, '旧セーブ補完がロード順に左右されない');

TEAMS_DATA.reviewTeam = { players: [{ id: 500 }] };
highSchoolPool.players = [{ id: 900 }];
universityPool.review = [{ player: { id: 1100 } }];
releasedPlayersPool.push({ id: 1200 });
const nextId = reservePlayerIds();
assert.ok(nextId() > 1200, '全プールを含めて採番する');
assert.notEqual(reservePlayerIds()(), nextId(), '未所属候補に発行したIDも再利用しない');
delete TEAMS_DATA.reviewTeam;
highSchoolPool.players = [];
delete universityPool.review;
releasedPlayersPool.pop();

const standings = initializeStandings(['A', 'B', 'C', 'D']);
const originalStandings = structuredClone(standings);
const updated = updateStandings(standings, { home: 'A', away: 'B', homeScore: 3, awayScore: 1 });
assert.deepEqual(standings, originalStandings, '順位表更新で入力を変えない');
assert.equal(updated.find(row => row.team === 'A').wins, 1);

const season = {
  currentDate: { year: 2026, month: 10, day: 10 },
  phase: SEASON_PHASES.REGULAR_SEASON,
  schedule: [], standings: updated,
  settings: { teamNames: ['A', 'B', 'C', 'D'], playoffFormat: 'short' },
};
const playoff = handlePhaseTransition(season, SEASON_PHASES.PLAYOFFS);
assert.equal(playoff.schedule.length, 3, '独立リーグのプレーオフを生成する');
assert.equal(season.schedule.length, 0, 'フェーズ変更で入力日程を変えない');
assert.equal(handlePhaseTransition({ ...season, settings: { ...season.settings, corporateMode: true } }, SEASON_PHASES.PLAYOFFS).schedule.length, 0);
assert.equal(handlePhaseTransition({ ...season, settings: { ...season.settings, universityMode: true } }, SEASON_PHASES.PLAYOFFS).schedule.length, 0);
assert.equal(getModeCapabilities({ corporateMode: true }).grandChampionship, false);
assert.equal(getModeCapabilities({ universityMode: true }).leaguePlayoffs, false);

const games = playoff.schedule.map(game => ({ ...game }));
games[0].result = { homeScore: 2, awayScore: 1 };
games[1].result = { homeScore: 1, awayScore: 2 };
const beforeProgress = structuredClone(games);
const progressed = updatePlayoffProgress({ ...playoff, schedule: games });
assert.deepEqual(games, beforeProgress, 'シリーズ進行で元日程を変えない');
assert.equal(getPlayoffChampion(progressed.schedule), games[0].home);
assert.equal(progressed.schedule[2].result.cancelled, true);
// ⚠ 引き分けを挟んで全試合を終えても誰も2勝に届かないとき、以前は優勝が決まらなかった。
//    勝ち数の多い方、同数なら上位シード（第1戦のホーム）が勝ち上がる
{
  const seed = playoff.schedule[0].home;
  const other = playoff.schedule[0].away;
  const drawn = playoff.schedule.map(game => ({ ...game, result: { homeScore: 1, awayScore: 1 } }));
  assert.equal(getPlayoffChampion(drawn), seed, '全試合引き分けで上位シードが優勝にならない');
  const split = playoff.schedule.map(game => ({ ...game }));
  split[0].result = split[0].home === other ? { homeScore: 2, awayScore: 0 } : { homeScore: 0, awayScore: 2 };
  split[1].result = { homeScore: 3, awayScore: 3 };
  split[2].result = { homeScore: 1, awayScore: 1 };
  assert.equal(getPlayoffChampion(split), other, '1勝0敗2分のチームが優勝にならない');
  const pending = playoff.schedule.map(game => ({ ...game }));
  pending[0].result = { homeScore: 1, awayScore: 1 };
  assert.equal(getPlayoffChampion(pending), null, '試合が残っているのに優勝を決めた');
}
WORLD_DATA.independentLeagues = {
  other: { name: '他リーグ', teams: ['X', 'Y'], standings: [
    { team: 'X', winRate: 0.8, wins: 8 }, { team: 'Y', winRate: 0.2, wins: 2 },
  ] },
};
const championship = generateGrandChampionship('__user__', [
  { team: 'A', winRate: 0.9, wins: 9 }, { team: 'B', winRate: 0.5, wins: 5 },
], { teamNames: ['A', 'B'] }, 1, 'B');
assert.equal(championship.champions[0].team, 'B', '全国大会にはプレーオフ優勝チームを出す');
WORLD_DATA.independentLeagues = {};

const nativeRandom = Math.random;
assert.deepEqual(withSeededRandom(123, () => [Math.random(), Math.random()]),
  [createSeededRandom(123)(), (() => { const random = createSeededRandom(123); random(); return random(); })()]);
assert.equal(Math.random, nativeRandom, '試合後に標準乱数を復元する');
assert.throws(() => withSeededRandom(4, () => { throw new Error('途中失敗'); }), /途中失敗/);
assert.equal(Math.random, nativeRandom, '失敗時にも標準乱数を復元する');

const { buildLeague } = await import('./lib/league.mjs');
const { autoSimulateGame } = await import('../../src/game/autoSimulation.js');
const names = buildLeague(2, 28, 1);
const initialTeams = structuredClone(TEAMS_DATA);
const firstGame = autoSimulateGame(names[0], names[1], false, 98765);
for (const name of Object.keys(TEAMS_DATA)) delete TEAMS_DATA[name];
Object.assign(TEAMS_DATA, structuredClone(initialTeams));
const replay = autoSimulateGame(names[0], names[1], false, 98765);
assert.deepEqual(replay, firstGame, '同じ初期状態とシードの自動試合は再現できる');
assert.equal(Math.random, nativeRandom);

console.log('review-check PASS');
