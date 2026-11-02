import React, { useContext, useEffect, useRef, useState } from 'react';
import ReplayViewer from './ReplayViewer.jsx';
import MobileReplay from './MobileReplay.jsx';
import { ReadContext, useRead } from './useRead.js';
import { PageNav } from './PageNav.jsx';
import { inOnlineRoot } from './portal.js';
import { formatStat } from './statsView.js';
import { decisionText, ownOutcome, teamShort, teamLabel } from './gameText.js';
import { POS } from './api.js';
import { Segmented, TeamName, gameDay } from './ui.jsx';
function Panel({ title, close, children, wide = false, mobileReplay = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current,
      trigger = document.activeElement;
    node.showModal();
    return () => {
      if (node.open) node.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  const dismiss = () => {
    ref.current.close();
    close();
  };
  return inOnlineRoot(
    <dialog
      ref={ref}
      className={`online-player-dialog online-game-dialog ${wide ? 'online-replay-dialog' : ''} ${mobileReplay ? 'online-mobile-replay-dialog' : ''}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      onClick={(e) => {
        if (e.target === ref.current) dismiss();
      }}
    >
      <header>
        <h2>{title}</h2>
        {!mobileReplay && (
          <button
            className="online-icon-button"
            aria-label={`${title}を閉じる`}
            onClick={dismiss}
          >
            ×
          </button>
        )}
      </header>
      {children}
    </dialog>
  );
}
function RequestState({ result }) {
  return result.loading ? (
    <p>記録を読み込んでいます…</p>
  ) : result.error ? (
    <div role="alert">
      {result.error}
      <button onClick={result.retry}>再取得</button>
    </div>
  ) : null;
}
// ボックススコア（新聞の形）。スコアボード → 勝敗投手 → 打順どおりの打撃 → 投手。
// ⚠ **ページ送りにしない**。以前は6人ずつ送り、打者が打順どおりに並ばず、
//    項目群をラベルの無いセレクトで切り替えていて「試合の結果」として読めなかった。
const BAT_COLUMNS = [
  ['atBats', '打数'],
  ['hits', '安打'],
  ['rbis', '打点'],
  ['homeruns', '本'],
  ['walks', '四死', (b) => (b.walks || 0) + (b.hitByPitch || 0)],
  ['strikeouts', '三振'],
  ['stolenBases', '盗塁'],
];
const PITCH_COLUMNS = [
  ['inningsPitched', '回', null, 'innings'],
  ['pitches', '球数'],
  ['hits', '被安'],
  ['runsAllowed', '失点'],
  ['earnedRuns', '自責'],
  ['walks', '四死', (q) => (q.walks || 0) + (q.hitBatters || 0)],
  ['strikeouts', '三振'],
];
const sum = (rows, get) => rows.reduce((total, p) => total + (get(p) || 0), 0);
function LineScore({ game }) {
  const innings = game.lineScore;
  if (!innings) return null;
  const count = Math.max(9, innings[game.away]?.length || 0, innings[game.home]?.length || 0);
  const hits = (team) => sum(game.teams?.[team] || [], (p) => p.batting?.hits);
  const errors = (team) => sum(game.teams?.[team] || [], (p) => p.batting?.errors);
  return (
    <div className="online-line-score-wrap">
      <table className="online-line-score">
        <thead>
          <tr>
            <th aria-label="球団" />
            {Array.from({ length: count }, (_, i) => (
              <th key={i}>{i + 1}</th>
            ))}
            <th className="is-total">計</th>
            <th>安</th>
            <th>失</th>
          </tr>
        </thead>
        <tbody>
          {[game.away, game.home].map((team) => {
            const runs = innings[team] || [];
            const total = team === game.home ? game.homeScore : game.awayScore;
            return (
              <tr key={team}>
                <th>
                  <TeamName team={team} short />
                </th>
                {Array.from({ length: count }, (_, i) => (
                  <td key={i}>
                    {i < runs.length ? runs[i] : team === game.home && i === runs.length && i >= 8 ? 'x' : ''}
                  </td>
                ))}
                <td className="is-total">{total}</td>
                <td>{hits(team)}</td>
                <td>{errors(team)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function BoxScore({ game, ownTeam }) {
  const [team, setTeam] = useState(
    [game.home, game.away].includes(ownTeam) ? ownTeam : game.away,
  );
  const players = game.teams?.[team] || [];
  const batters = players
    .filter(
      (p) =>
        (p.batting?.plateAppearances ||
          p.batting?.atBats ||
          p.batting?.walks ||
          p.batting?.hitByPitch ||
          p.batting?.sacrificeBunts ||
          p.battingOrder ||
          p.batting?.stolenBases ||
          p.batting?.caughtStealing) > 0,
    )
    .sort((a, b) => (a.battingOrder || 99) - (b.battingOrder || 99));
  const pitchers = players.filter(
    (p) => (p.pitching?.pitches || p.pitching?.inningsPitched) > 0,
  );
  const decisions = decisionText(game.decisions);
  return (
    <>
      <LineScore game={game} />
      {decisions && <p className="online-box-decisions">{decisions}</p>}
      <Segmented
        label="試合成績の球団"
        value={team}
        options={[game.away, game.home].map((name) => [name, teamShort(name)])}
        onChange={setTeam}
      />
      <h3 className="online-box-heading">打撃</h3>
      <div className="online-table-scroll">
        <table className="online-record-table">
          <thead>
            <tr>
              <th>選手</th>
              {BAT_COLUMNS.map(([key, label]) => (
                <th key={key}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batters.map((p) => (
              <tr key={p.key || p.id} className={p.battingOrder ? '' : 'is-sub'}>
                <th title={p.name}>
                  <span className="online-box-order">{p.battingOrder || ''}</span>
                  <small>{POS[p.position] || ''}</small> {p.name}
                </th>
                {BAT_COLUMNS.map(([key, , get]) => (
                  <td key={key}>{(get ? get(p.batting || {}) : p.batting?.[key]) ?? '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="online-box-heading">投手</h3>
      <div className="online-table-scroll">
        <table className="online-record-table">
          <thead>
            <tr>
              <th>投手</th>
              {PITCH_COLUMNS.map(([key, label]) => (
                <th key={key}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pitchers.map((p) => (
              <tr key={p.key || p.id}>
                <th title={p.name}>
                  {p.name}
                  {p.pitching?.wins ? <small className="online-box-mark is-win">勝</small> : null}
                  {p.pitching?.losses ? <small className="online-box-mark is-loss">敗</small> : null}
                  {p.pitching?.saves ? <small className="online-box-mark">S</small> : null}
                  {p.pitching?.holds ? <small className="online-box-mark">H</small> : null}
                </th>
                {PITCH_COLUMNS.map(([key, , get, format = 'count']) => (
                  <td key={key}>
                    {get ? get(p.pitching || {}) : formatStat({ format }, p.pitching?.[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {game.legacy && (
        <small className="online-stat-note">
          既存試合の保存値です。未記録の項目は「—」です。
        </small>
      )}
    </>
  );
}
// 試合記録の取得を端末内に残す（同じ試合を開き直しても待たない）。
// ⚠ 年度と試合IDで引く。試合記録は確定後に変わらないので、捨てるのは画面を閉じたときだけでよい
const gameCache = new Map();
function useGame(id, year) {
  const key = `${year}:${id}`;
  const cached = gameCache.get(key);
  const result = useRead(cached ? null : 'game', { id, year });
  useEffect(() => {
    if (result.data) gameCache.set(key, result.data);
  }, [key, result.data]);
  return cached ? { data: cached, loading: false, error: '', retry() {} } : result;
}
/** 自球団の直近の試合を先に読んでおく（一覧を開いた時点で、裏で） */
export function usePrefetchGames(view, count = 3) {
  const read = useContext(ReadContext);
  const ids = (view.results || [])
    .filter((g) => g.gameId && (g.home === view.teamName || g.away === view.teamName))
    .slice(-count)
    .map((g) => g.gameId)
    .join(',');
  useEffect(() => {
    if (!read || !ids || !view.gameDetailsAvailable) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const id of ids.split(',')) {
        const key = `${view.year}:${id}`;
        if (cancelled || gameCache.has(key)) continue;
        try {
          gameCache.set(key, await read('game', { id, year: view.year }));
        } catch {
          /* 先読みの失敗は無視（開いたときに読み直す） */
        }
      }
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [read, ids, view.year, view.gameDetailsAvailable]);
}
// 試合カードそのものを押して開く。⚠ 以前は「個人成績」という小さなボタンで、
// 試合の中身（スコアボード）が見られるとは分からなかった
export function GameRecordButton({ game, year, ownTeam, children, className }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={className || 'online-record-button'}
        onClick={() => setOpen(true)}
        aria-label={`${teamLabel(game.away)}対${teamLabel(game.home)}の試合を見る`}
      >
        {children || '試合を見る'}
      </button>
      {open && (
        <GameRecord
          id={game.gameId}
          year={year}
          ownTeam={ownTeam}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}
function GameRecord({ id, year, ownTeam, close }) {
  const compact = window.matchMedia('(max-width: 767px)').matches;
  const [watch, setWatch] = useState(false);
  const result = useGame(id, year),
    game = result.data;
  const outcome = game && ownOutcome(game, ownTeam);
  return (
    <Panel
      title="試合結果"
      close={close}
      wide={watch && !compact}
      mobileReplay={watch && compact && !!game}
    >
      <RequestState result={result} />
      {game && (
        <>
          {!watch && (
            <div className={`online-game-summary ${outcome ? `is-${outcome.tone}` : ''}`}>
              <small>{gameDay(game.date)}</small>
              <div>
                <TeamName team={game.away} short />
                <strong>
                  {game.awayScore} – {game.homeScore}
                </strong>
                <TeamName team={game.home} short />
              </div>
            </div>
          )}
          {game.replay?.frames?.length > 0 && (
            <Segmented
              label="試合の表示"
              value={watch ? 'watch' : 'box'}
              options={[
                ['box', '成績'],
                ['watch', compact ? '試合経過' : '観戦リプレイ'],
              ]}
              onChange={(id) => setWatch(id === 'watch')}
            />
          )}
          {watch ? (
            compact ? (
              <MobileReplay game={game} close={close} />
            ) : (
              <ReplayViewer game={game} />
            )
          ) : game.teams ? (
            <BoxScore game={game} ownTeam={ownTeam} />
          ) : (
            <p>この試合は得点のみの記録です。</p>
          )}
        </>
      )}
    </Panel>
  );
}
export default function GameHistory({ view }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="online-history-button" onClick={() => setOpen(true)}>
        過去の試合・個人成績
      </button>
      {open && <History view={view} close={() => setOpen(false)} />}
    </>
  );
}
function History({ view, close }) {
  const [year, setYear] = useState(view.year),
    [page, setPage] = useState(0),
    [scope, setScope] = useState('own');
  const result = useRead('games', { year, page, scope });
  return (
    <Panel title="試合記録" close={close}>
      <div className="online-stat-tools">
        <select
          aria-label="試合記録の年度"
          value={year}
          onChange={(e) => {
            setYear(Number(e.target.value));
            setPage(0);
          }}
        >
          {(view.seasonYears || [view.year]).map((n) => (
            <option key={n} value={n}>
              {n}年目
            </option>
          ))}
        </select>
<Segmented
          label="試合記録の範囲"
          value={scope}
          options={[
            ['own', '自球団'],
            ['league', 'リーグ全体'],
          ]}
          onChange={(id) => {
            setScope(id);
            setPage(0);
          }}
        />
      </div>
      <RequestState result={result} />
      {result.data && (
        <>
          <div className="online-game-history-list">
            {result.data.games.map((g) => {
              const outcome = ownOutcome(g, view.teamName);
              return (
                <article key={g.gameId}>
                  <small>
                    {g.date.month}/{g.date.day}
                  </small>
                  <span
                    className={`online-outcome ${outcome ? `is-${outcome.tone}` : 'is-none'}`}
                    aria-label={outcome ? `自球団の${outcome.mark}` : undefined}
                  >
                    {outcome?.mark || ''}
                  </span>
                  <span className="online-game-line">
                    <span title={teamLabel(g.away)}>{teamShort(g.away)}</span>{' '}
                    <b>
                      {g.awayScore} – {g.homeScore}
                    </b>{' '}
                    <span title={teamLabel(g.home)}>{teamShort(g.home)}</span>
                  </span>
                  <GameRecordButton
                    game={g}
                    year={year}
                    ownTeam={view.teamName}
                  />
                </article>
              );
            })}
          </div>
          {!result.data.count && <p>この年度の試合記録はありません。</p>}
          <PageNav
            page={page}
            count={result.data.count}
            size={result.data.size}
            setPage={setPage}
          />
        </>
      )}
    </Panel>
  );
}
