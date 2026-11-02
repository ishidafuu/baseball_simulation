// 観戦記録の残し方の検査。
// ⚠ 既定は「人の球団の試合だけ・球団ごとに直近10試合」。以前は既定で残さず、
//    観戦の画面があるのに遊ぶ人は一度も見られなかった。
import assert from 'node:assert/strict';
import { replayPolicy, REPLAY_KEEP_LATEST } from '../../server/leagueEngine.mjs';
import { pruneReplays } from '../../server/recordedStats.mjs';

const league = { members: [{ teamName: '人A' }, { teamName: '人B' }] };
const def = replayPolicy(league, undefined);
assert.equal(typeof def.replay, 'function', '既定は試合ごとに判定する');
assert.equal(def.keepLatest, REPLAY_KEEP_LATEST);
assert.ok(def.tracked('人A') && !def.tracked('CPU1'), '数えるのは人の球団だけ');
assert.ok(def.replay({ home: '人A', away: 'CPU1' }), '人の球団の試合は残す');
assert.ok(def.replay({ home: 'CPU2', away: '人B' }), 'ビジターでも残す');
assert.ok(!def.replay({ home: 'CPU1', away: 'CPU2' }), 'CPU同士は残さない');
assert.equal(replayPolicy(league, '1').replay, true, '1 で全試合');
assert.equal(replayPolicy(league, 'all').replay, true, 'all で全試合');
assert.equal(replayPolicy(league, '0').replay, false, '0 で残さない');
assert.equal(replayPolicy(league, 'off').replay, false, 'off で残さない');

// 古い観戦記録は捨て、成績は残す
const season = { games: {} };
const add = (id, day, home, away) => {
  const box = {
    gameId: id,
    date: { year: 2024, month: 4, day },
    home,
    away,
    teams: { [home]: [1], [away]: [2] },
    replay: { frames: [1] },
  };
  season.games[id] = box;
  pruneReplays(season, box, 3, (t) => t.startsWith('人'));
};
for (let d = 1; d <= 6; d += 1) add(d, d, '人A', `CPU${d}`);
const kept = Object.values(season.games).filter((g) => g.replay).map((g) => g.gameId);
assert.deepEqual(kept.sort(), [4, 5, 6], '新しい3試合だけ残る');
assert.ok(Object.values(season.games).every((g) => g.teams), '成績は消さない');
// 相手の人の球団でまだ枠に入っている試合は残す
add(7, 7, '人A', '人B');
add(8, 8, '人A', 'CPU8');
add(9, 9, '人A', 'CPU9');
assert.ok(season.games[7].replay, '人Bの直近3試合に入っている試合は残る');
console.log('■ 観戦記録の残し方: OK（既定は人の試合だけ・直近だけ残す / 1・0で切替 / 成績は消さない）');
