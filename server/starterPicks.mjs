// ============================================================
// 予告先発（改善案 B1）。人の球団が、この先の試合の先発をローテの中から指名する。
//
//   - 指名・変更できるのは、試合の `STARTER_LOCK_TURNS` ターン前まで。そこから先は確定し、
//     相手にも「予告先発」として見える（確定の時刻は両軍同じなので、後出しの得は無い）。
//   - 確定する前の指名は本人にしか見えない。
//   - 試合の日に疲れていたら（`STARTER_SKIP_FATIGUE`）指名は使わず、いつもの決め方で投げる
//     （「回避」として本人に知らせる。`dailyLineup.prepareDailyLineup`）。
//   - 指名した投手が投げると、ローテはその投手の次から回る。飛ばした投手は後ろへずれる
//     （ただ得をする手にはしない）。
//   - CPU球団・投手起用を指導者に任せた人・おるすばん中の人は指名を使わない（今までどおりローテの順）。
//
// ⚠ 保存は `member.starterPicks`（試合の番号 → 選手id）。編成（`lineupSettings`）に入れないのは、
//    古い編成の保存で指名が巻き戻らないようにするため。年度更新で消す（日程の番号が変わる）。
// ============================================================
import { requireOnline } from '../src/online/shared.js';
import { STARTER_LOCK_TURNS, STARTER_PICK_GAMES } from '../src/online/social.js';
import { effectiveStaffModes } from './coachEngine.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const dayIndex = (d) => Math.round(Date.UTC(d.year, d.month - 1, d.day) / DAY_MS);
const dateKey = (d) => d.year * 10000 + d.month * 100 + d.day;

/** 自球団のまだ終わっていない試合（近い順） */
export function ownOpenGames(schedule, teamName) {
  return (schedule || [])
    .filter(
      (g) =>
        g.date &&
        !g.result &&
        g.home !== 'TBD' &&
        g.away !== 'TBD' &&
        (g.home === teamName || g.away === teamName),
    )
    .sort((a, b) => dateKey(a.date) - dateKey(b.date) || a.id - b.id);
}

/**
 * 試合までのターン数（0＝次の進行で行う）。
 * ⚠ 1ターン＝1日。シーズン後は空の日をまとめて進めるので、実際のターン数はこれ以下になる
 *    （確定が早まる側にずれるだけで、遅れることは無い）
 */
export function turnsUntil(league, game) {
  return dayIndex(game.date) - dayIndex(league.season.currentDate);
}

/** 先発が確定しているか（指名を変えられない・相手に見える） */
export function starterLocked(league, game) {
  return turnsUntil(league, game) < STARTER_LOCK_TURNS;
}

/** この人がいま予告先発を使えるか（投手起用を任せていない・おるすばんでない） */
export function canPickStarters(league, member) {
  return !!member && !member.away && effectiveStaffModes(league, member).pitching !== 'delegate';
}

/** 球団の、いま効いている指名（使えない人なら null） */
export function activePicks(league, teamName) {
  const member = (league.members || []).find((m) => m.teamName === teamName);
  if (!member?.starterPicks || !canPickStarters(league, member)) return null;
  return member.starterPicks;
}

/**
 * 予告先発を指名する・外す（`starterPick` 命令）。
 * `playerId` が null なら外す（ローテの順に戻す）。
 * ⚠ 球団は保存した世界（`league.game.teams`）から読む。エンジンを使わない命令なので、
 *    `TEAMS_DATA` は古いまま
 */
export function setStarterPick(league, userId, { gameId, playerId } = {}) {
  const member = (league.members || []).find((m) => m.userId === userId);
  requireOnline(member, '参加者ではありません', 403);
  requireOnline(
    canPickStarters(league, member),
    '投手起用を指導者に任せている間は、予告先発を選べません',
    409,
  );
  const open = ownOpenGames(league.season.schedule, member.teamName);
  const game = open.slice(0, STARTER_PICK_GAMES).find((g) => g.id === Number(gameId));
  requireOnline(game, `先発を選べるのは、この先の${STARTER_PICK_GAMES}試合です`, 409);
  requireOnline(
    !starterLocked(league, game),
    `試合の${STARTER_LOCK_TURNS}ターン前を過ぎたので、先発は確定しています`,
    409,
  );
  const picks = { ...(member.starterPicks || {}) };
  if (playerId === null || playerId === undefined || playerId === '') delete picks[game.id];
  else {
    const team = league.game.teams[member.teamName];
    const id = Number(playerId);
    requireOnline(
      (team?.pitchingRotation?.starters || []).includes(id),
      '先発ローテの投手から選んでください',
    );
    requireOnline(
      team.players.some((p) => p.id === id && p.isActive !== false),
      'その投手は登録を外れています',
      409,
    );
    picks[game.id] = id;
  }
  // 終わった試合の指名を掃除する
  const openIds = new Set(open.map((g) => String(g.id)));
  for (const key of Object.keys(picks)) if (!openIds.has(key)) delete picks[key];
  if (Object.keys(picks).length) member.starterPicks = picks;
  else delete member.starterPicks;
  return { gameId: game.id, playerId: picks[game.id] ?? null };
}

/** 試合の日に当てる指名（無ければ null） */
export function pickFor(league, teamName, gameId) {
  return activePicks(league, teamName)?.[gameId] ?? null;
}

/** 終わった試合の指名を消す（試合の日の後に呼ぶ） */
export function clearPlayedPicks(league) {
  for (const member of league.members || []) {
    if (!member.starterPicks) continue;
    const open = new Set(
      ownOpenGames(league.season.schedule, member.teamName).map((g) => String(g.id)),
    );
    for (const key of Object.keys(member.starterPicks))
      if (!open.has(key)) delete member.starterPicks[key];
    if (!Object.keys(member.starterPicks).length) delete member.starterPicks;
  }
}
