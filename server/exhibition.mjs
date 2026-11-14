// ============================================================
// 練習試合・挑戦状（改善案 B4）。人の球団どうしで、部をまたいでも1試合できる。
//
//   - 申し込み（`challenge`）→ 相手が受ける（`challengeRespond` の accept）とその場で1試合。
//     断る（decline）・取り下げる（withdraw）もできる。
//   - **成績・疲労・調子・記録・順位には一切入れない**。試合の間だけ2球団を写しに差し替え、
//     終わったら元に戻す（`playExhibition`）。呼ぶ側も世界を保存し直さない。
//   - 乱数は申し込みの番号から決める（何度やり直しても同じ試合になる）。
//   - 同じ相手とは1日（日本時間）に `EXHIBITIONS_PER_DAY` 試合まで。
//
// ⚠ 結果はボックスの一部（打撃・投球の主な数字）と得点経過だけを残す。1試合で数KBあるので、
//    リーグ全体で `EXHIBITION_LIMIT` 件まで。
// ============================================================
import { TEAMS_DATA } from '../src/teams-data.js';
import { autoSimulateGame } from '../src/game/autoSimulation.js';
import { requireOnline } from '../src/online/shared.js';
import {
  cleanText,
  tokyoDay,
  CHALLENGE_NOTE_MAX,
  EXHIBITIONS_PER_DAY,
  MAX_OPEN_CHALLENGES,
  EXHIBITION_LIMIT,
} from '../src/online/social.js';
import { prepareDailyLineup } from './dailyLineup.mjs';
import { applyStaffTactics } from './coachEngine.mjs';
import { scoringPlaysOf, winningHitOf } from './recordedStats.mjs';
import { pushInbox, teamLabelIn } from './social.mjs';

const BATTING = ['atBats', 'hits', 'homeruns', 'rbis', 'walks', 'strikeouts', 'doubles', 'triples', 'stolenBases'];
const PITCHING = ['runsAllowed', 'earnedRuns', 'strikeouts', 'hits', 'walks', 'homeruns', 'pitches'];

const memberOfTeam = (league, teamName) =>
  (league.members || []).find((m) => m.teamName === teamName) || null;
const pairKey = (a, b) => [a, b].sort().join('|');

/** その2球団が、その日（日本時間）にもう何試合したか */
function playedOn(league, a, b, now) {
  const day = tokyoDay(now);
  return (league.exhibitions || []).filter(
    (e) =>
      e.status === 'played' &&
      pairKey(e.fromTeam, e.toTeam) === pairKey(a, b) &&
      tokyoDay(e.playedAt) === day,
  ).length;
}

/** 練習試合を申し込む（`challenge` 命令） */
export function openChallenge(league, userId, { toTeam, note } = {}, now) {
  const me = (league.members || []).find((m) => m.userId === userId);
  requireOnline(me, '参加者ではありません', 403);
  const them = memberOfTeam(league, toTeam);
  requireOnline(them, '練習試合は、人が持っている球団に申し込めます', 409);
  requireOnline(them.userId !== userId, '自分の球団とは練習試合をできません');
  const list = (league.exhibitions ||= []);
  requireOnline(
    list.filter((e) => e.status === 'offered' && e.from === userId).length < MAX_OPEN_CHALLENGES,
    `出しておける申し込みは${MAX_OPEN_CHALLENGES}件までです`,
    409,
  );
  requireOnline(
    !list.some(
      (e) => e.status === 'offered' && pairKey(e.fromTeam, e.toTeam) === pairKey(me.teamName, toTeam),
    ),
    'この球団とは、もう申し込みが出ています',
    409,
  );
  requireOnline(
    playedOn(league, me.teamName, toTeam, now) < EXHIBITIONS_PER_DAY,
    `同じ相手との練習試合は1日${EXHIBITIONS_PER_DAY}試合までです`,
    409,
  );
  const { text, tooLong } = cleanText(note, CHALLENGE_NOTE_MAX);
  requireOnline(!tooLong, `ひとことは${CHALLENGE_NOTE_MAX}字までです`);
  const id = `ex-${(league.exhibitionSeq = (league.exhibitionSeq || 0) + 1)}`;
  list.push({
    id,
    from: userId,
    fromTeam: me.teamName,
    to: them.userId,
    toTeam,
    ...(text ? { note: text } : {}),
    status: 'offered',
    createdAt: now,
  });
  pushInbox(
    league,
    them.userId,
    {
      type: 'challenge',
      exhibitionId: id,
      text: `${teamLabelIn(league, me.teamName)}から練習試合の申し込みが届きました${text ? `「${text}」` : ''}`,
    },
    now,
  );
  return { id };
}

/**
 * 練習試合の申し込みに返事をする（`challengeRespond` 命令）。`action` は accept / decline / withdraw。
 * accept のときは `play(ex)` で1試合して結果を返す（世界は読み込んであること。呼ぶ側は保存し直さない）。
 */
export function respondChallenge(league, userId, { id, action } = {}, now, play) {
  const list = league.exhibitions || [];
  const ex = list.find((e) => e.id === id && e.status === 'offered');
  requireOnline(ex, 'その申し込みはもうありません', 409);
  requireOnline(ex.from === userId || ex.to === userId, 'この申し込みの当事者ではありません', 403);
  const drop = () => {
    league.exhibitions = list.filter((e) => e !== ex);
  };
  if (action === 'withdraw') {
    requireOnline(ex.from === userId, '取り下げられるのは申し込んだ側です', 403);
    drop();
    pushInbox(
      league,
      ex.to,
      { type: 'challengeWithdrawn', exhibitionId: ex.id, text: `${teamLabelIn(league, ex.fromTeam)}が練習試合の申し込みを取り下げました` },
      now,
    );
    return { status: 'withdrawn' };
  }
  requireOnline(ex.to === userId, '返事をするのは申し込まれた側です', 403);
  if (action === 'decline') {
    drop();
    pushInbox(
      league,
      ex.from,
      { type: 'challengeDeclined', exhibitionId: ex.id, text: `${teamLabelIn(league, ex.toTeam)}は練習試合の申し込みを見送りました` },
      now,
    );
    return { status: 'declined' };
  }
  requireOnline(action === 'accept', '練習試合の操作が不正です');
  requireOnline(
    memberOfTeam(league, ex.fromTeam)?.userId === ex.from,
    '申し込んだ球団のオーナーが替わったので、この申し込みは使えません',
    409,
  );
  requireOnline(
    playedOn(league, ex.fromTeam, ex.toTeam, now) < EXHIBITIONS_PER_DAY,
    `同じ相手との練習試合は1日${EXHIBITIONS_PER_DAY}試合までです`,
    409,
  );
  ex.result = play(ex);
  ex.status = 'played';
  ex.playedAt = now;
  // ⚠ 結果を残すのはリーグ全体で決まった件数まで（古い順に捨てる）
  const played = league.exhibitions.filter((e) => e.status === 'played');
  if (played.length > EXHIBITION_LIMIT) {
    const drops = new Set(
      played
        .sort((a, b) => String(a.playedAt).localeCompare(String(b.playedAt)))
        .slice(0, played.length - EXHIBITION_LIMIT),
    );
    league.exhibitions = league.exhibitions.filter((e) => !drops.has(e));
  }
  const r = ex.result;
  pushInbox(
    league,
    ex.from,
    {
      type: 'challengePlayed',
      exhibitionId: ex.id,
      text: `${teamLabelIn(league, ex.toTeam)}が練習試合を受けました。結果は ${teamLabelIn(league, ex.fromTeam)} ${r.awayScore}-${r.homeScore} ${teamLabelIn(league, ex.toTeam)}`,
    },
    now,
  );
  return { status: 'played', result: r };
}

/**
 * 1試合する。⚠ **2球団を写しに差し替えて行い、必ず元に戻す**（成績・疲労・調子を残さない）。
 * 申し込んだ側がビジター、受けた側がホーム。世界は読み込んであること。
 */
export function playExhibition(league, ex) {
  const home = ex.toTeam;
  const away = ex.fromTeam;
  const saved = { [home]: TEAMS_DATA[home], [away]: TEAMS_DATA[away] };
  requireOnline(saved[home] && saved[away], '球団が見つかりません', 409);
  TEAMS_DATA[home] = structuredClone(saved[home]);
  TEAMS_DATA[away] = structuredClone(saved[away]);
  try {
    for (const name of [home, away]) {
      prepareDailyLineup(TEAMS_DATA[name], name);
      applyStaffTactics(league, name, TEAMS_DATA[name]);
    }
    const events = [];
    const observer = {
      events,
      plateAppearance: (event) => events.push(event),
      runnerOut: (event) => events.push({ ...event, runnerOnly: true }),
    };
    const result = autoSimulateGame(home, away, false, null, observer);
    return exhibitionBox(result, events);
  } finally {
    TEAMS_DATA[home] = saved[home];
    TEAMS_DATA[away] = saved[away];
  }
}

/** 残す結果（試合の記録の箱と同じ形の一部。PC の試合成績の表をそのまま使える） */
function exhibitionBox(result, events) {
  const pick = (source, keys) =>
    Object.fromEntries(keys.map((k) => [k, source?.[k] || 0]));
  const teams = {};
  for (const team of [result.homeTeam, result.awayTeam]) {
    teams[team.name] = (team.players || [])
      .filter((p) => {
        const b = p.gameStats?.batting || {};
        const q = p.gameStats?.pitching || {};
        return (b.atBats || b.walks || b.hitByPitch || b.sacrificeBunts || q.pitches || q.outs || 0) > 0;
      })
      .map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        battingOrder: p.battingOrder || 0,
        batting: pick(p.gameStats?.batting, BATTING),
        pitching: {
          ...pick(p.gameStats?.pitching, PITCHING),
          inningsPitched: p.gameStats?.pitching?.outs || 0,
        },
      }));
  }
  const ref = (p) => (p ? { id: p.id, name: p.name } : null);
  return {
    home: result.homeTeam.name,
    away: result.awayTeam.name,
    homeScore: result.homeScore,
    awayScore: result.awayScore,
    lineScore: result.lineScore ? structuredClone(result.lineScore) : null,
    walkOff: !!result.walkOff,
    decisions: {
      winningPitcher: ref(result.decisions?.winningPitcher),
      losingPitcher: ref(result.decisions?.losingPitcher),
      savePitcher: ref(result.decisions?.savePitcher),
    },
    winningHit: winningHitOf(events, result),
    scoring: scoringPlaysOf(events, result),
    teams,
  };
}

/**
 * 申し込み中の練習試合を全部取り下げる（年度更新）。結果の残っている試合はそのまま。
 */
export function clearOpenChallenges(league, now, text) {
  for (const ex of (league.exhibitions || []).filter((e) => e.status === 'offered'))
    for (const userId of [ex.from, ex.to])
      pushInbox(league, userId, { type: 'challengeWithdrawn', exhibitionId: ex.id, text }, now);
  league.exhibitions = (league.exhibitions || []).filter((e) => e.status !== 'offered');
}

/** 抜けた人の申し込みを取り下げる（球団をCPUに戻したとき） */
export function dropChallengesOf(league, userId, now) {
  for (const ex of (league.exhibitions || []).filter(
    (e) => e.status === 'offered' && (e.from === userId || e.to === userId),
  )) {
    const other = ex.from === userId ? ex.to : ex.from;
    pushInbox(
      league,
      other,
      {
        type: 'challengeWithdrawn',
        exhibitionId: ex.id,
        text: `${teamLabelIn(league, ex.from === userId ? ex.fromTeam : ex.toTeam)}のオーナーが替わったため、練習試合の申し込みは取り下げられました`,
      },
      now,
    );
  }
  league.exhibitions = (league.exhibitions || []).filter(
    (e) => !(e.status === 'offered' && (e.from === userId || e.to === userId)),
  );
}

/** ビューに載せる、その人の練習試合（申し込み中と、最近の結果） */
export function exhibitionsView(league, userId, shownResults = 5) {
  const mine = (league.exhibitions || []).filter((e) => e.from === userId || e.to === userId);
  const open = mine.filter((e) => e.status === 'offered');
  const played = mine
    .filter((e) => e.status === 'played')
    .sort((a, b) => String(b.playedAt).localeCompare(String(a.playedAt)))
    .slice(0, shownResults);
  return [...open, ...played].map((e) => ({
    id: e.id,
    status: e.status,
    mine: e.from === userId,
    fromTeam: e.fromTeam,
    toTeam: e.toTeam,
    note: e.note || null,
    createdAt: e.createdAt,
    playedAt: e.playedAt || null,
    result: e.result || null,
  }));
}
