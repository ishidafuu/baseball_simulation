// ホーム（スマホ）と「今日」（PC）の中身。
// ⚠ **先頭は「いまやること」**。以前のホームは12球団の順位表が主役で、
//    手続きの締め切りも次の試合も目立たず、「何をすればいいか」が分からなかった。
import React, { useEffect, useState } from 'react';
import { STATUS } from './api.js';
import { teamShort } from './gameText.js';
import { PHASE_LABELS } from './shared.js';
import {
  ConditionMark,
  PlayerStatsButton,
  RoleMark,
} from './PlayerPerformance.jsx';
import { ScoreCard, isInitialTryout } from './LeaguePanels.jsx';
import {
  FatigueMark,
  TeamBadge,
  TeamName,
  TeamLink,
  formatJst,
  gameDay,
  remaining,
} from './ui.jsx';

// 残り時間の表示を1分ごとに進める
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** 締め切りの1行（「締め切り 11/3(日) 0:00（あと6時間）」） */
export function Deadline({ phase, view }) {
  const now = useNow();
  if (!phase?.deadline) return null;
  const mine = view.members.find((m) => m.teamName === view.teamName);
  return (
    <p className={`online-deadline ${mine?.ready ? '' : 'is-urgent'}`}>
      締め切り <strong>{formatJst(phase.deadline)}</strong>（
      {remaining(phase.deadline, now)}）
    </p>
  );
}

/** 手続きの進み具合（「他の人を待っています（1/2）」） */
export function PhaseProgress({ view }) {
  const done = view.members.filter((m) => m.ready).length;
  const mine = view.members.find((m) => m.teamName === view.teamName);
  return (
    <div className="online-phase-progress">
      <p>
        {mine?.ready
          ? view.members.length > 1
            ? `決定済み・他の人を待っています（${done}/${view.members.length}）`
            : '決定済み'
          : `まだ決めていません（決定 ${done}/${view.members.length}）`}
      </p>
      <ul>
        {view.members.map((m) => (
          <li key={m.teamName} className={m.ready ? 'is-ready' : ''}>
            <TeamBadge team={m.teamName} size="sm" />
            {teamShort(m.teamName)}
            <small>{m.ready ? '決定' : '検討中'}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ownGames = (games, team) =>
  games.filter((g) => g.home === team || g.away === team);

/** いまやることカード */
export function NowCard({ view, setTab }) {
  const now = useNow();
  if (view.phase) {
    const mine = view.members.find((m) => m.teamName === view.teamName);
    const label = PHASE_LABELS[view.phase.kind] || view.phase.label;
    return (
      <section className={`online-now ${mine?.ready ? '' : 'is-action'}`}>
        <p className="online-eyebrow">いまやること</p>
        <h2>{mine?.ready ? `${label}は決定済みです` : `${label}を決めてください`}</h2>
        <Deadline phase={view.phase} view={view} />
        <PhaseProgress view={view} />
        <button className="online-primary" onClick={() => setTab('decisions')}>
          {mine?.ready ? '内容を見直す' : `${label}を開く`}
        </button>
      </section>
    );
  }
  const next = ownGames(view.upcoming, view.teamName)[0];
  const starter = view.roster.find((p) => p.id === view.nextStarterId);
  const opponent = next && (next.home === view.teamName ? next.away : next.home);
  return (
    <section className="online-now">
      <p className="online-eyebrow">次の試合</p>
      {next ? (
        <>
          <h2 className="online-now-match">
            <span>{gameDay(next.date)}</span>
            <span>
              {next.home === view.teamName ? 'vs' : '@'}{' '}
              <TeamLink team={opponent} />
            </span>
          </h2>
          {starter && (
            <p className="online-now-starter">
              予告先発 <PlayerStatsButton player={starter} panel="abilities" />{' '}
              <ConditionMark player={starter} /> <FatigueMark player={starter} />
            </p>
          )}
        </>
      ) : (
        <h2>予定されている試合はありません</h2>
      )}
      <p className="online-muted">
        {view.status === 'running' && view.nextAdvanceAt
          ? `次の進行 ${formatJst(view.nextAdvanceAt)}（${remaining(view.nextAdvanceAt, now)}）`
          : STATUS[view.status]}
      </p>
      <button onClick={() => setTab('lineup')}>打順・起用を確認</button>
    </section>
  );
}

/** 前回の試合（大きなスコア。押すと試合結果） */
export function LastGame({ view }) {
  const last = ownGames(view.results, view.teamName).at(-1);
  if (!last) return null;
  return (
    <section className="online-last-game">
      <p className="online-eyebrow">前回の試合</p>
      <ScoreCard game={last} view={view} compact />
    </section>
  );
}

/** 最新のリーグ便りの1行 */
export function LatestNews({ view, open }) {
  const notice = view.notices[0];
  if (!notice) return null;
  const items = notice.picks || notice.moves || [];
  const own = items.filter((p) => (p.team || p.teamId) === view.teamName);
  const title =
    notice.type === 'tryout'
      ? isInitialTryout(notice, view.notices)
        ? '初期編成'
        : 'トライアウト'
      : notice.type === 'draft'
        ? 'NPBドラフト'
        : '昇格・降格';
  return (
    <button className="online-news-teaser" onClick={open}>
      <span className="online-eyebrow">リーグ便り</span>
      <span>
        {notice.year}年 {title}
        {notice.type === 'tryout' && own.length
          ? `：あなたは${own.length}人を獲得`
          : notice.type === 'draft' && own.length
            ? `：自球団から${own.length}人が指名`
            : `（${items.length}${notice.type === 'promotion' ? '球団' : '人'}）`}
      </span>
      <span aria-hidden="true">›</span>
    </button>
  );
}

/** 先発メンバーの調子と疲労（PCの「今日」） */
export function StartersCondition({ view }) {
  const order = [...(view.lineup?.battingOrder || [])].sort(
    (a, b) => a.battingOrder - b.battingOrder,
  );
  const players = order
    .map((e) => view.roster.find((p) => p.id === e.playerId))
    .filter(Boolean);
  const starter = view.roster.find((p) => p.id === view.nextStarterId);
  if (starter) players.push(starter);
  const tired = players.filter((p) => (p.fatigue ?? 0) > 0);
  return (
    <section className="online-card">
      <h2>スタメンの状態</h2>
      <ul className="online-condition-list">
        {players.map((p) => (
          <li key={p.id}>
            <RoleMark player={p} lineup={view.lineup} />
            <PlayerStatsButton player={p} panel="abilities" />
            <ConditionMark player={p} />
            <FatigueMark player={p} />
          </li>
        ))}
      </ul>
      {!tired.length && <p className="online-muted">全員元気です。</p>}
    </section>
  );
}

/** リーグ全体の直近の結果（PCの「今日」） */
export function LeagueToday({ view }) {
  const last = view.results.at(-1);
  if (!last) return null;
  const sameDay = view.results.filter(
    (g) =>
      g.date.year === last.date.year &&
      g.date.month === last.date.month &&
      g.date.day === last.date.day,
  );
  return (
    <section className="online-card">
      <h2>{gameDay(last.date)}の結果</h2>
      <div className="online-score-list">
        {sameDay.map((g) => (
          <ScoreCard key={g.gameId || g.id} game={g} view={view} compact />
        ))}
      </div>
    </section>
  );
}

