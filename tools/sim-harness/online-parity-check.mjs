// オンラインの成績が、一人用の独立リーグと同じように出るかを検査する。
//
// ⚠ **これが無かったせいで3つの不具合を見逃した。** 34項目すべてPASSしていたのに、
//    実際に遊ぶと数字が別物だった（遊んでいる人の指摘で発覚）。
//      1. 人の球団だけ投手15人・野手9人（控えゼロ）
//      2. 休養日が1日も無く、レギュラーの疲労が一度も回復しない
//      3. 全12球団が格付け 'D'（最弱）で登録され、候補選手が弱かった
//    どれも「試合の処理」は正しく、**世界の作り方**が違っていた。個々の部品を
//    見る検査では捕まらない。出てきた数字を一人用と並べるしかない。
//
// ⚠ **土台を揃えること**。一人用側も同じ初期トライアウト・同じ格付け・同じ試合数で
//    組む。既定の `generateExpansionRoster` で組むと別の生成経路になり、
//    能力が最初から違うので比較にならない（最初それで測って見当違いの結論を出した）。
//
// ⚠ 許容幅は**実測から決めている**。狭すぎると乱数の揺れで落ち、広すぎると
//    今回の不具合を通してしまう。各項目に「この幅なら何を捕まえるか」を書くこと。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import './lib/bootstrap.mjs';
import { createTestStore } from './lib/testStore.mjs';
import { LeagueService } from '../../server/leagueService.mjs';
import { defaultPhasePlan } from '../../server/leagueEngine.mjs';
import { buildLeague, runSeason, TEAMS_DATA } from './lib/league.mjs';
import {
  generateTryoutCandidates,
  selectPlayerForAI,
} from '../../src/season/tryoutSystem.js';
import { getLeagueRankFromTeams } from '../../src/corporate/corporateInit.js';
import { initializeAllPitchingRotations } from '../../src/teams-data.js';
import { createSeededRandom } from '../../src/game/rng.js';
import { PYRAMID_TEAM_COUNT } from '../../src/online/pyramidLeague.js';

const TURNS = Number(process.env.PARITY_TURNS || 18);
const quiet = (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
};

/** 両者から同じ形で数字を取り出す */
function summarize(teams) {
  let ab = 0, hits = 0, hr = 0, bb = 0, so = 0, er = 0, outs = 0;
  const fatigue = [], pitcherFatigue = [], games = [];
  const fielders = [], pitchers = [];
  for (const team of teams) {
    for (const p of team.players) {
      const b = p.seasonStats?.batting || {};
      const q = p.seasonStats?.pitching || {};
      ab += b.atBats || 0;
      hits += b.hits || 0;
      hr += b.homeruns || 0;
      bb += b.walks || 0;
      so += b.strikeouts || 0;
      er += q.earnedRuns || 0;
      outs += q.inningsPitched || 0;
      if (p.position === 'pitcher') {
        pitchers.push(p);
        pitcherFatigue.push(p.fatigue || 0);
      } else {
        fielders.push(p);
        fatigue.push(p.fatigue || 0);
        games.push(b.games || 0);
      }
    }
  }
  const mean = (list) =>
    list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  return {
    打率: hits / ab,
    本塁打率: hr / (outs / 27),
    四球率: bb / (ab + bb),
    三振率: so / (ab + bb),
    防御率: (er * 27) / outs,
    野手の疲労: mean(fatigue),
    投手の疲労: mean(pitcherFatigue),
    'ミート': mean(fielders.map((p) => p.batting?.meet || 0)),
    'パワー': mean(fielders.map((p) => p.batting?.power || 0)),
    '制球': mean(pitchers.map((p) => p.pitching?.control || 0)),
    野手の人数: fielders.length / teams.length,
    投手の人数: pitchers.length / teams.length,
    // ⚠ **最小・最大も見ること**。12球団の平均は1球団が壊れてもほとんど動かない。
    //    実際、人の球団だけ野手9人（他は14人）になっても平均は13.6で埋もれた
    野手の最少: Math.min(
      ...teams.map((t) => t.players.filter((p) => p.position !== 'pitcher').length),
    ),
    投手の最多: Math.max(
      ...teams.map((t) => t.players.filter((p) => p.position === 'pitcher').length),
    ),
  };
}

// --- オンライン側 -----------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'pennant-parity-'));
let online, onlineRank, onlineGames;
try {
  const store = createTestStore(join(dir, 'state.gz'));
  let now = '2026-10-26T15:00:00.000Z';
  const service = new LeagueService(store, {
    members: [{ userId: 'admin', label: '管理者' }],
    adminId: 'admin',
    allowStep: true,
    clock: () => now,
  });
  const sessionId = (await service.login('admin')).sessionId;
  // ⚠ **操作IDに乱数を使わないこと**。進行の乱数はこのIDから作られるので
  //    （`seeded(league, 'day:' + operationId)`）、毎回違うIDだと結果が揺れて
  //    検査が当てにならなくなる。実測で打率が .227〜.245 まで振れた
  let seq = 0;
  const send = async (type, payload) => {
    const l = (await store.read()).league;
    seq += 1;
    return service.command('admin', sessionId, {
      requestId: `parity-${type}-${seq}`,
      revision: l?.revision ?? 0,
      type,
      payload,
    });
  };
  await quiet(() => send('create'));
  for (let i = 0; i < 4; i += 1) {
    const l = (await store.read()).league;
    if (!l.phase) break;
    await send('submit', {
      phaseId: l.phase.id,
      plan: defaultPhasePlan(l, l.members[0].teamName),
      ready: true,
      baseSubmission: null,
    });
  }
  for (let i = 0; i < TURNS; i += 1) {
    await send('step');
    now = new Date(Date.parse(now) + 3600000).toISOString();
  }
  const league = (await store.read()).league;
  const names = league.season.settings.teamNames;
  assert.equal(names.length, PYRAMID_TEAM_COUNT);
  // ⚠ **登録された格付けが、生成時に決めた格付けと一致すること**。
  //    `ensureUserIndependentLeagueTagged` はプリセット定義と名前で照合するので、
  //    その場で作った球団名は全部 'D'（最弱）になる。初期トライアウトの候補の質は
  //    これで決まるため、気づかないままリーグ全体の選手が弱くなる。
  // ⚠ ここを「オンライン側から読んだ格付け」で済ませてはいけない。一人用側にも
  //    同じ 'D' を渡すことになり、**間違いを基準にした比較**になって素通りする
  //    （実際に一度そう書いて、故意の破壊を通してしまった）。
  for (const def of league.teams) {
    const tagged = league.game.teams[def.name]?.corporateData?.rank;
    assert.equal(
      tagged,
      def.rank,
      `${def.name} の格付けが生成時（${def.rank}）と違う: ${tagged}`,
    );
  }
  // 一人用側には**本来あるべき格付け**（生成時の最頻値）を渡す
  const counts = {};
  for (const def of league.teams) counts[def.rank] = (counts[def.rank] || 0) + 1;
  onlineRank = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(
    getLeagueRankFromTeams(names),
    onlineRank,
    'リーグ全体の格付けが生成時の最頻値と違う',
  );
  const teams = names.map((n) => league.game.teams[n]);
  onlineGames = Math.max(
    ...teams.flatMap((t) =>
      t.players.map((p) => p.seasonStats?.batting?.games || 0),
    ),
  );
  online = summarize(teams);
} finally {
  await rm(dir, { recursive: true, force: true });
}

// ⚠ 休養日のぶん、消化した試合はターン数より少ない。一人用もその試合数で揃える
assert.ok(
  onlineGames >= 8,
  `オンラインの試合が少なすぎて比較にならない: ${onlineGames}`,
);
assert.ok(
  onlineGames < TURNS,
  `休養日が入っていない（${TURNS}ターンで${onlineGames}試合）`,
);

// --- 一人用側 ---------------------------------------------------------
// ⚠ **一人用側は種を変えて3回組み、平均を取る**。15試合ほどでは本塁打率が
//    1回ごとに大きく振れ、旧コードでも種を変えるだけで 0.49〜0.66 まで動いた
//    （2026-11 の継投修正のあと、たまたま 0.357 を引いて落ちた）。1回だけだと
//    「乱数の当たり外れ」と「本物のずれ」を区別できない。平均で揺れを抑え、
//    許容幅は変えない。
// ⚠ 最少・最多だけは平均でなく最も厳しい値を取る（1球団の崩れを埋もれさせない）
const SINGLE_SEEDS = [20261101, 1, 2];
const singleRuns = SINGLE_SEEDS.map((seed) => {
  Math.random = createSeededRandom(seed);
  const names = quiet(() => buildLeague(PYRAMID_TEAM_COUNT, 24, 1));
  quiet(() => {
    // ⚠ オンラインと同じ初期トライアウトから名簿を作る
    const pool = generateTryoutCandidates(1, names.length, true, onlineRank, 0);
    for (const n of names) TEAMS_DATA[n].players = [];
    for (let round = 0; round < 24; round += 1)
      for (const n of names) {
        const picked = selectPlayerForAI(pool, TEAMS_DATA[n].players) || pool[0];
        if (!picked) break;
        pool.splice(
          pool.findIndex((p) => p.id === picked.id),
          1,
        );
        TEAMS_DATA[n].players.push(picked);
      }
    initializeAllPitchingRotations();
    runSeason(names, onlineGames);
  });
  return summarize(names.map((n) => TEAMS_DATA[n]));
});
const single = {};
for (const key of Object.keys(singleRuns[0])) {
  const values = singleRuns.map((r) => r[key]);
  single[key] =
    key === '野手の最少'
      ? Math.min(...values)
      : key === '投手の最多'
        ? Math.max(...values)
        : values.reduce((a, b) => a + b, 0) / values.length;
}

// --- 突き合わせ -------------------------------------------------------
// 各項目: [差の許容, 何を捕まえるか]
const BANDS = {
  // 疲れた打者は打てない。休養日が無かったとき .238→.221 までずれた
  打率: [0.03, '休養日・名簿の偏り'],
  // いちばん敏感。休養日が無いと 0.68→0.13（1/5）まで落ちた
  本塁打率: [0.25, '疲労の蓄積'],
  四球率: [0.04, '投手の質'],
  三振率: [0.04, '打者の質'],
  防御率: [1.0, '全体の攻守バランス'],
  // 休養日が無いと 21→104（5倍）。2.5倍で止める
  野手の疲労: [null, '休養日'],
  投手の疲労: [null, '休養日'],
  // 格付けが 'D' に落ちていたとき 42.8→36.8（-6）
  'ミート': [5, '球団の格付け'],
  'パワー': [5, '球団の格付け'],
  '制球': [5, '球団の格付け'],
  // 人の球団が投手だらけになったとき 14→9
  野手の人数: [2, 'ドラフトの構成'],
  投手の人数: [2, 'ドラフトの構成'],
  // ⚠ 平均では埋もれる。1球団でも控えが出せない名簿になったらここで落ちる
  野手の最少: [2, '特定の球団のドラフト'],
  投手の最多: [2, '特定の球団のドラフト'],
};

const rows = [];
const problems = [];
for (const [key, [band, why]] of Object.entries(BANDS)) {
  const a = single[key];
  const b = online[key];
  const diff = b - a;
  let ok;
  if (band === null) {
    // 疲労は**絶対差でなく倍率**で見る。試合数で絶対値が動くため
    ok = b <= Math.max(a * 2.5, a + 15);
  } else {
    ok = Math.abs(diff) <= band;
  }
  rows.push(
    `${key.padEnd(8)} 一人用 ${a.toFixed(3).padStart(8)} / オンライン ${b.toFixed(3).padStart(8)} ${ok ? '' : `← ずれ（${why}）`}`,
  );
  if (!ok) problems.push(`${key}: ${a.toFixed(3)} → ${b.toFixed(3)}（${why}）`);
}

if (problems.length) {
  console.error(`■ 一人用との突き合わせ（${onlineGames}試合）`);
  for (const row of rows) console.error('  ' + row);
}
assert.deepEqual(
  problems,
  [],
  `オンラインの成績が一人用とずれている:\n  ${problems.join('\n  ')}`,
);

console.log(
  `■ 一人用との突き合わせ: OK（${onlineGames}試合・${PYRAMID_TEAM_COUNT}球団・格付け${onlineRank} / 打率${online.打率.toFixed(3)} 本塁打率${online.本塁打率.toFixed(2)} 防御率${online.防御率.toFixed(2)} 野手疲労${Math.round(online.野手の疲労)}）`,
);
