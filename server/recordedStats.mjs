import { createHash } from 'node:crypto';
import {
  PA_KEYS,
  BATTING_KEYS,
  PITCHING_KEYS,
  CATCH_KEYS,
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
/**
 * 捕手の記録に1打席（または走者だけのアウト）を足す。
 * ⚠ 捕手の側にだけ持つ。投手から見た「捕手別」は `batteryFor` が引き直す。
 */
function catchAdd(record, pitcherKey, line) {
  const c = (record.catching ||= { all: zeroLine(CATCH_KEYS), pitchers: {} });
  addCounts(c.all, line, CATCH_KEYS);
  const { starts, ...rest } = line;
  void starts;
  addCounts((c.pitchers[pitcherKey] ||= zeroLine(CATCH_KEYS.filter((k) => k !== 'starts'))), rest, CATCH_KEYS);
}
import { createReplay } from './replayRecord.mjs';

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
export function createRecorder(league, teams, { replay: keepReplay = false } = {}) {
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
      const replay = keepReplay ? createReplay() : null;
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
      // 先発マスク: その球団の最初の打席で受けた捕手
      const masked = new Set();
      const caught = (e, pitcherKey, line) => {
        if (e.catcherId === null || e.catcherId === undefined) return;
        const catcher = get(e.defense, e.catcherId);
        const first = !masked.has(e.defense);
        masked.add(e.defense);
        catchAdd(catcher.record, pitcherKey, first ? { ...line, starts: 1 } : line);
      };
      for (const e of observer.events) {
        if (e.runnerOnly) {
          const pitcher = get(e.defense, e.pitcherId),
            line = { outs: e.outs };
          caught(e, pitcher.record.key, line);
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
        const battery = {
          runs: e.runs,
          earnedRuns: e.earnedRuns,
          calls: e.calls,
          reads: e.reads,
        };
        if (!e.completed) {
          splitAdd(batter.record.splits.batting, 'all', extra);
          caught(e, pitcher.record.key, battery);
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
        caught(e, pitcher.record.key, { ...line, ...battery });
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
        // 紙面の「逆転」「サヨナラ」「決勝打」に使う（数百バイト）。古い試合には無い
        lineScore: result.lineScore ? clone(result.lineScore) : null,
        walkOff: !!result.walkOff,
        winningHit: winningHitOf(observer.events, result),
        // 得点経過（点が動いた打席と、打席の外で入った点）。乱数は引かない（記録を読むだけ）
        scoring: scoringPlaysOf(observer.events, result),
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
          // ⚠ **「何号本塁打」はここでしか作れない**。この行を足した直後の通算が
          //    その試合までの本数で、あとから数えるには年の全試合を舐めることになる。
          //    打った選手にだけ置く（1試合に2本なら `通算-1号` と `通算号`）。
          //    古い記録には無いので、画面は番号なしで名前だけ出す
          // ⚠ 記録を途中から取り始めた年（`complete: false`）は置かない。記録の
          //    通算はその年の本当の本数より少なく、10号を「3号」と出してしまう
          const seasonHomeruns = season.complete && b.homeruns > 0
            ? record.stats.batting.homeruns
            : undefined;
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
            ...(seasonHomeruns === undefined ? {} : { seasonHomeruns }),
          });
        }
      }
      season.games[game.id] = box;
      delete season.archiveToken;
    },
  };
}
/**
 * 決勝打: 勝った側が**最後に勝ち越した打席**（そのあと一度も追いつかれていない）。
 * 打点が付いた打席だけ（暴投・失策での勝ち越しは入れない）。`hit` は安打だったか
 * （犠飛・押し出しは安打でない）。引き分けは null。
 * ⚠ 打席の前後の得点（`scoreBefore` / `scoreAfter`）が無い古い記録では null。
 */
export function winningHitOf(events, result) {
  if (!result?.winner) return null;
  const side = result.winner === result.homeTeam?.name ? 'home' : 'away';
  const other = side === 'home' ? 'away' : 'home';
  let hit = null,
    last = 0; // 前の打席が終わったときの点差（勝った側から見て）
  for (const e of events || []) {
    if (e.runnerOnly || !e.scoreBefore || !e.scoreAfter) continue;
    const before = e.scoreBefore[side] - e.scoreBefore[other];
    const after = e.scoreAfter[side] - e.scoreAfter[other];
    // 打席の外（暴投・盗塁など）でリードが動いたら、それまでの決勝打の候補は消える
    if ((last > 0) !== (before > 0)) hit = null;
    last = after;
    if (before > 0 && after <= 0) hit = null; // 追いつかれた・逆転された
    if (before <= 0 && after > 0)
      hit =
        e.offense === result.winner && (e.delta?.rbis || 0) > 0
          ? {
              team: e.offense,
              id: e.batterId,
              name: e.batterName,
              inning: e.inning,
              homerun: (e.delta?.homeruns || 0) > 0,
              hit: (e.delta?.hits || 0) > 0,
              rbis: e.delta.rbis,
            }
          : null;
  }
  return hit;
}
/** 得点経過を残す行の上限（大差の試合でも箱を膨らませない） */
export const SCORING_PLAYS_LIMIT = 30;

/**
 * 得点経過: 点が動いた打席（打った人・何点・その後の点）と、打席の外で入った点（暴投・盗塁など）。
 * 行は `{ inning, half: 'top'|'bottom', team, id, name, kind, runs, away, home }`。
 * `kind` は打席の結果（'homerun' / 'single' / 'double' / 'triple' / 'walk' / 'error' / 'out' など）、
 * 打席の外は 'other'（名前なし）。`away` / `home` はその行の後の点。
 * ⚠ 打席の前後の得点（`scoreBefore` / `scoreAfter`）が無い古い記録では空の配列。
 * ⚠ 練習試合（`exhibition.mjs`）も同じ関数で作る。
 */
export function scoringPlaysOf(events, result) {
  const homeName = result?.homeTeam?.name;
  const awayName = result?.awayTeam?.name;
  const plays = [];
  let last = { home: 0, away: 0 };
  let lastInning = 1;
  let lastHalf = 'top';
  const gap = (score, inning, half) => {
    // 打席の外で入った点。⚠ 次の打席が相手の攻撃なら、点はその前の半回に入っている
    for (const side of ['away', 'home']) {
      const runs = (score[side] || 0) - (last[side] || 0);
      if (runs <= 0) continue;
      const ownHalf = side === 'away' ? 'top' : 'bottom';
      const at = ownHalf === half ? inning : ownHalf === 'top' ? inning : Math.max(1, inning - 1);
      plays.push({
        inning: at,
        half: ownHalf,
        team: side === 'away' ? awayName : homeName,
        id: null,
        name: null,
        kind: 'other',
        runs,
        away: score.away,
        home: score.home,
      });
      last = { ...last, [side]: score[side] };
    }
  };
  for (const e of events || []) {
    if (e.runnerOnly || !e.scoreBefore || !e.scoreAfter) continue;
    const half = e.offense === homeName ? 'bottom' : 'top';
    gap(e.scoreBefore, e.inning, half);
    const side = half === 'top' ? 'away' : 'home';
    const runs = (e.scoreAfter[side] || 0) - (e.scoreBefore[side] || 0);
    if (runs > 0)
      plays.push({
        inning: e.inning,
        half,
        team: e.offense,
        id: e.batterId ?? null,
        name: e.batterName || null,
        kind: scoringKind(e),
        runs,
        away: e.scoreAfter.away,
        home: e.scoreAfter.home,
      });
    last = { home: e.scoreAfter.home, away: e.scoreAfter.away };
    lastInning = e.inning;
    lastHalf = half;
  }
  // 最後の打席の後に入った点（暴投でのサヨナラなど）
  if (events?.length && Number.isFinite(result?.homeScore) && Number.isFinite(result?.awayScore))
    gap({ home: result.homeScore, away: result.awayScore }, lastInning, lastHalf);
  return plays.slice(0, SCORING_PLAYS_LIMIT);
}

/** 打席の結果の種類。⚠ 打者の成績の増えた分から読む（投球の結果の形は打席の種類で違う） */
function scoringKind(e) {
  const d = e.delta || {};
  if (d.homeruns > 0) return 'homerun';
  if (d.triples > 0) return 'triple';
  if (d.doubles > 0) return 'double';
  if (d.hits > 0) return 'single';
  if (d.walks > 0) return 'walk';
  if (d.hitByPitch > 0) return 'hit_by_pitch';
  if (e.result?.isError && !e.result?.hitWithError) return 'error';
  return 'out';
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
