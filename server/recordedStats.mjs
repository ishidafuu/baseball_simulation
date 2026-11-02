import { createHash } from 'node:crypto';
import {
  PA_KEYS,
  BATTING_KEYS,
  PITCHING_KEYS,
  zeroLine,
  addCounts,
} from '../src/online/recordStats.js';

export const RECORD_VERSION = 1;
const clone = (value) => structuredClone(value);
const keyFor = (team, player) =>
  player.onlinePlayerId || `${team}:${player.id}:${player.name}`;
export function observedSeason(league) {
  return league.records?.seasons?.[league.season.year] || null;
}
export function completeCoverage(league, season) {
  return (
    !!season?.complete &&
    (season.year !== league.season.year ||
      league.season.results.every((game) =>
        Object.hasOwn(season.games, String(game.gameId)),
      ))
  );
}
function seasonFor(league) {
  league.records ||= { version: RECORD_VERSION, seasons: {} };
  return (league.records.seasons[league.season.year] ||= {
    year: league.season.year,
    league: 'shikoku',
    version: RECORD_VERSION,
    complete: league.season.results.length === 0,
    players: {},
    games: {},
    comparison: null,
  });
}
function playerRecord(season, team, player) {
  const key = keyFor(team, player);
  return (season.players[key] ||= {
    key,
    id: player.id,
    name: player.name,
    bats: player.batting?.bats || null,
    teams: [],
    stats: {
      batting: zeroLine(BATTING_KEYS),
      pitching: zeroLine(PITCHING_KEYS),
    },
    splits: { batting: {}, pitching: {} },
    games: [],
    starts: [],
  });
}
export function recordForPlayer(
  league,
  player,
  team,
  year = league.season.year,
) {
  return (
    league.records?.seasons?.[year]?.players?.[keyFor(team, player)] || null
  );
}
const splitAdd = (splits, key, line) =>
  addCounts((splits[key] ||= zeroLine()), line);
import { createReplay } from './replayRecord.mjs';

// 観戦記録を残した球団ごとに、新しい方から `keep` 試合分だけ残す。
// `tracked(team)` が真の球団（既定は人の球団）だけを数える。どちらかの
// 球団の直近 `keep` 試合に入っていれば残す。
// ⚠ 成績（box の teams）は消さない。消すのは1球ごとの記録だけ
export function pruneReplays(season, box, keep, tracked = () => true) {
  const order = (g) => g.date.year * 10000 + g.date.month * 100 + g.date.day;
  const latest = (team) =>
    new Set(
      Object.values(season.games)
        .filter((g) => g.replay && (g.home === team || g.away === team))
        .sort((x, y) => order(y) - order(x) || y.gameId - x.gameId)
        .slice(0, keep),
    );
  const sets = new Map();
  const keptBy = (team) => {
    if (!sets.has(team)) sets.set(team, latest(team));
    return sets.get(team);
  };
  for (const team of [box.home, box.away].filter(tracked)) {
    for (const g of Object.values(season.games)) {
      if (!g.replay || (g.home !== team && g.away !== team)) continue;
      const inAny = [g.home, g.away].filter(tracked).some((t) => keptBy(t).has(g));
      if (!inAny) g.replay = null;
    }
  }
}

/**
 * `replay`: 1球ごとの観戦記録を残すか。**既定は残さない**。
 *
 * ⚠ 実測で1試合218KBのうち182KB＝84%を占め、42球団3024試合では670MBとなり
 *    `JSON.stringify` の上限（約512MB）を超えて保存が成立しない。
 *    成績だけなら1試合30KB・1シーズン89MBで収まる。
 * ⚠ 観戦の画面そのものは残してある。球団数の少ないリーグで観戦したいときは
 *    `ONLINE_RECORD_REPLAY=1` で有効にする。容量は球団数と試合数に比例するので、
 *    有効にする前に上の数字で見積もること。
 */
/**
 * `replay` は真偽値か、試合を受け取って真偽を返す関数。
 * `keepLatest` を付けると、観戦記録を残した球団ごとに新しい方からその数だけ残し、
 * それより古い試合の観戦記録は捨てる（成績は残す）。
 */
export function createRecorder(
  league,
  teams,
  { replay: keepReplay = false, keepLatest = 0, tracked } = {},
) {
  const wantsReplay =
    typeof keepReplay === 'function' ? keepReplay : () => !!keepReplay;
  const season = seasonFor(league);
  if (!completeCoverage(league, season)) season.complete = false;
  // IDは対人サーバーだけで付与。移籍・年度更新・退団プールへの複製でも引き継ぐ。
  for (const name of league.season.settings.teamNames)
    for (const player of teams[name].players)
      player.onlinePlayerId ||= keyFor(name, player);
  // ⚠ **記録の範囲は「公式日程の全試合」**。CPU同士も含む
  //    （`RECORDED_STATISTICS.md`「対人サーバーの公式日程で自動消化する試合」）。
  //    「対人」はオンライン版のサーバーという意味で、人間同士という意味ではない。
  //    相手球団・CPU球団の成績を閲覧する機能がこの記録に依存しているので、
  //    人間同士に絞ってはいけない（一度絞って通年検査に止められた）。
  return {
    begin(game) {
      const events = [];
      // ⚠ 観戦記録を残さないときは `start` / `replay` / `pitchDetail` を**渡さない**。
      //    `autoSimulation` 側は `observer?.replay` のように保護されているので、
      //    渡さなければ記録が飛ぶ。箱の `replay` は null になり、画面は
      //    「記録が無い試合」として扱う（元から旧試合のためにその経路がある）。
      const replay = wantsReplay(game) ? createReplay() : null;
      return {
        events,
        ...(replay
          ? {
              replayRecord: replay.value,
              start: replay.start,
              replay: replay.frame,
              pitchDetail: replay.pitchDetail,
            }
          : {}),
        plateAppearance(event) {
          events.push(event);
        },
        runnerOut(event) {
          events.push({ ...event, runnerOnly: true });
        },
      };
    },
    finish(game, result, observer) {
      if (season.games[game.id])
        throw new Error('対人の試合記録を重複適用できません');
      const local = new Map();
      const starterStages = new Map();
      const get = (teamName, id) => {
        const player = teams[teamName].players.find((p) => p.id === id);
        if (!player) throw new Error('記録対象の選手が見つかりません');
        const record = playerRecord(season, teamName, player);
        if (!record.teams.includes(teamName)) record.teams.push(teamName);
        if (!local.has(record.key))
          local.set(record.key, {
            record,
            batting: zeroLine(),
            pitching: zeroLine(),
          });
        return local.get(record.key);
      };
      for (const e of observer.events) {
        if (e.runnerOnly) {
          const pitcher = get(e.defense, e.pitcherId),
            line = { outs: e.outs };
          splitAdd(pitcher.record.splits.pitching, 'all', line);
          splitAdd(
            pitcher.record.splits.pitching,
            e.risp ? 'risp' : 'emptyRisp',
            line,
          );
          if (e.starter) {
            const stage =
              e.inning <= 2 ? 'early' : e.inning <= 5 ? 'middle' : 'late';
            const stages = starterStages.get(pitcher.record.key) || {
              early: zeroLine(),
              middle: zeroLine(),
              late: zeroLine(),
            };
            starterStages.set(pitcher.record.key, stages);
            addCounts(stages[stage], line);
            splitAdd(pitcher.record.splits.pitching, stage, line);
          }
          continue;
        }
        const batter = get(e.offense, e.batterId),
          pitcher = get(e.defense, e.pitcherId);
        const extra = {
          buntAttempts: 0,
          buntSuccess: 0,
          safetyAttempts: 0,
          squeezeAttempts: 0,
        };
        if (
          e.bunt === 'sacrifice' &&
          ['bunt_fair', 'bunt_popup'].includes(e.buntOutcome)
        ) {
          extra.buntAttempts = 1;
          extra.buntSuccess =
            e.buntOutcome === 'bunt_fair' &&
            e.completed &&
            (e.delta.sacrificeBunts > 0 || e.delta.hits > 0)
              ? 1
              : 0;
        }
        if (e.bunt === 'safety') extra.safetyAttempts = 1;
        if (e.bunt === 'squeeze') extra.squeezeAttempts = 1;
        if (e.starter)
          starterStages.set(
            pitcher.record.key,
            starterStages.get(pitcher.record.key) || {
              early: zeroLine(),
              middle: zeroLine(),
              late: zeroLine(),
            },
          );
        if (!e.completed) {
          splitAdd(batter.record.splits.batting, 'all', extra);
          continue;
        }
        const line = addCounts(zeroLine(), e.delta);
        Object.assign(line, extra);
        // 元の自動試合では犠飛を打数に含めるため、観測集計の打数だけを補正する。
        if (e.result?.isOutfieldFly && e.delta.rbis > 0) {
          line.sacrificeFlies = 1;
          line.atBats--;
        }
        line.pa = 1;
        line.outs = e.outs || 0;
        line.fouls = e.fouls;
        line.twoStrikeFouls = e.twoStrikeFouls || 0;
        line.dpChances = e.dpPossible ? 1 : 0;
        line.doublePlays = e.result?.type === 'double_play' ? 1 : 0;
        addCounts(batter.batting, line);
        addCounts(pitcher.pitching, line);
        for (const [record, category] of [
          [batter.record, 'batting'],
          [pitcher.record, 'pitching'],
        ]) {
          splitAdd(record.splits[category], 'all', line);
          splitAdd(
            record.splits[category],
            e.risp ? 'risp' : 'emptyRisp',
            line,
          );
        }
        splitAdd(
          batter.record.splits.batting,
          e.throws === 'left' ? 'left' : 'right',
          line,
        );
        splitAdd(
          batter.record.splits.batting,
          e.pinchHit ? 'pinch' : 'normal',
          line,
        );
        if (e.twoStrikes)
          splitAdd(batter.record.splits.batting, 'twoStrikes', line);
        if (
          !e.bunt &&
          e.pitches === 1 &&
          [
            'single',
            'double',
            'triple',
            'homerun',
            'out',
            'double_play',
          ].includes(e.result?.type)
        )
          splitAdd(batter.record.splits.batting, 'firstPitch', line);
        if (e.starter) {
          const stage =
            e.inning <= 2 ? 'early' : e.inning <= 5 ? 'middle' : 'late';
          splitAdd(pitcher.record.splits.pitching, stage, line);
          addCounts(starterStages.get(pitcher.record.key)[stage], line);
        }
      }
      const box = {
        gameId: game.id,
        year: season.year,
        date: clone(game.date),
        home: game.home,
        away: game.away,
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        decisions: clone(result.decisions),
        teams: {},
        replay: observer.replayRecord?.frames.length
          ? observer.replayRecord
          : null,
        pitcherChanges: clone(result.pitcherChanges || []),
      };
      for (const team of [result.homeTeam, result.awayTeam]) {
        box.teams[team.name] = [];
        for (const p of team.players) {
          const gb = p.gameStats?.batting || {},
            gp = p.gameStats?.pitching || {},
            gf = p.gameStats?.fielding || {};
          const appeared =
            (gb.atBats ||
              gb.walks ||
              gb.hitByPitch ||
              gb.sacrificeBunts ||
              gp.pitches ||
              gp.outs ||
              p.battingOrder ||
              gb.stolenBases ||
              gb.caughtStealing) > 0;
          if (!appeared && !gf.chances) continue;
          const data = get(team.name, p.id),
            record = data.record;
          const b = addCounts(zeroLine(BATTING_KEYS), gb, BATTING_KEYS);
          b.games = data.batting.pa > 0 ? 1 : 0;
          b.atBats = data.batting.atBats;
          b.sacrificeFlies = data.batting.sacrificeFlies;
          b.plateAppearances = data.batting.pa;
          b.errors = gf.errors || 0;
          b.fieldingChances = gf.chances || 0;
          b.assists = gf.assists || 0;
          const q = addCounts(zeroLine(PITCHING_KEYS), gp, PITCHING_KEYS);
          q.inningsPitched = gp.outs || 0;
          q.games = (gp.pitches || gp.outs) > 0 ? 1 : 0;
          q.battersFaced = data.pitching.pa;
          q.gamesStarted = q.games && starterStages.has(record.key) ? 1 : 0;
          q.qualityStarts =
            q.gamesStarted && q.inningsPitched >= 18 && q.earnedRuns <= 3
              ? 1
              : 0;
          q.highQualityStarts =
            q.gamesStarted && q.inningsPitched >= 21 && q.earnedRuns <= 2
              ? 1
              : 0;
          const d = result.decisions;
          q.wins =
            result.winner === team.name && d?.winningPitcher?.id === p.id
              ? 1
              : 0;
          q.losses =
            result.winner &&
            result.winner !== team.name &&
            d?.losingPitcher?.id === p.id
              ? 1
              : 0;
          q.saves =
            result.winner === team.name && d?.savePitcher?.id === p.id ? 1 : 0;
          q.holds =
            result.winner === team.name &&
            d?.holdPitchers?.some((h) => h.id === p.id)
              ? 1
              : 0;
          addCounts(record.stats.batting, b, BATTING_KEYS);
          addCounts(record.stats.pitching, q, PITCHING_KEYS);
          record.games.push({
            gameId: game.id,
            atBats: b.atBats,
            hits: b.hits,
          });
          if (q.gamesStarted)
            record.starts.push({
              gameId: game.id,
              ...starterStages.get(record.key),
            });
          box.teams[team.name].push({
            id: p.id,
            key: record.key,
            name: p.name,
            position: p.position,
            battingOrder: p.battingOrder,
            batting: b,
            pitching: q,
          });
        }
      }
      season.games[game.id] = box;
      if (box.replay && keepLatest > 0) pruneReplays(season, box, keepLatest, tracked);
      delete season.archiveToken;
    },
  };
}
export function recordedStats(record) {
  if (!record) return null;
  return {
    batting: { ...record.stats.batting, measured: true },
    pitching: { ...record.stats.pitching, measured: true },
  };
}
export function freezeComparison(league) {
  const season = observedSeason(league);
  if (season && !season.comparison)
    season.comparison = clone(comparisonForSeason(season));
  if (season && !season.archiveToken) {
    // ⚠ **全試合を1本の文字列にしないこと**。42球団3024試合では
    //    `JSON.stringify(season.games)` が文字列の上限を超えて落ちる
    //    （通年検査の200日目で RangeError: Invalid string length）。
    //    試合ごとに流し込めば同じ識別子が得られて上限にも当たらない。
    //    ⚠ 順序を固定すること（キー順）。順序が変わると内容が同じでも別物になる。
    const hash = createHash('sha256');
    for (const key of Object.keys(season.games).sort()) {
      hash.update(key);
      hash.update(JSON.stringify(season.games[key]));
    }
    season.archiveToken = hash.digest('hex');
  }
}
export function comparisonForSeason(season) {
  if (!season) return null;
  if (season.comparison) return season.comparison;
  const totals = {
    stats: {
      batting: zeroLine(BATTING_KEYS),
      pitching: zeroLine(PITCHING_KEYS),
    },
    splits: { batting: {}, pitching: {} },
    byBats: {},
  };
  for (const r of Object.values(season.players)) {
    if (r.bats) {
      const splits = (totals.byBats[r.bats] ||= {});
      for (const [key, line] of Object.entries(r.splits.batting))
        splitAdd(splits, key, line);
    }
    addCounts(totals.stats.batting, r.stats.batting, BATTING_KEYS);
    addCounts(totals.stats.pitching, r.stats.pitching, PITCHING_KEYS);
    for (const category of ['batting', 'pitching'])
      for (const [key, line] of Object.entries(r.splits[category]))
        splitAdd(totals.splits[category], key, line);
  }
  return totals;
}
