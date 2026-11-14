import React, { useEffect, useRef, useState } from 'react';
import ReplayViewer from './ReplayViewer.jsx';
import MobileReplay from './MobileReplay.jsx';
import { useRead } from './useRead.js';
import { useMobile } from './useMobile.js';
import { PageNav } from './PageNav.jsx';
import { turnLabel } from './shared.js';
import { formatStat } from './statsView.js';
import { ownOutcome, teamShort, teamLabel } from './gameText.js';
import { inOnlineRoot } from './dialogPortal.js';
import { ScoringPlays } from './ScoringPlays.jsx';
const GROUPS = {
  batting: [
    [
      'basic',
      '打撃・基本',
      [
        ['atBats', '打数'],
        ['hits', '安打'],
        ['homeruns', '本'],
        ['rbis', '打点'],
      ],
    ],
    [
      'extra',
      '四死球・三振',
      [
        ['walks', '四球'],
        ['hitByPitch', '死球'],
        ['strikeouts', '三振'],
        ['sacrificeFlies', '犠飛'],
      ],
    ],
    [
      'running',
      '走塁・犠打',
      [
        ['stolenBases', '盗塁'],
        ['caughtStealing', '盗塁死'],
        ['sacrificeBunts', '犠打'],
        ['plateAppearances', '打席'],
      ],
    ],
    [
      'hits',
      '長打・守備',
      [
        ['doubles', '二塁打'],
        ['triples', '三塁打'],
        ['errors', '失策'],
        ['fieldingChances', '守備機会'],
      ],
    ],
  ],
  pitching: [
    [
      'basic',
      '投球・基本',
      [
        ['inningsPitched', '回', 'innings'],
        ['runsAllowed', '失点'],
        ['earnedRuns', '自責'],
        ['strikeouts', '奪三振'],
      ],
    ],
    [
      'allowed',
      '被安打・四死球',
      [
        ['hits', '被安打'],
        ['homeruns', '被本'],
        ['walks', '四球'],
        ['hitBatters', '死球'],
      ],
    ],
    [
      'record',
      '球数・勝敗',
      [
        ['pitches', '球数'],
        ['wins', '勝'],
        ['losses', '敗'],
        ['saves', 'S'],
      ],
    ],
    [
      'other',
      '救援・先発',
      [
        ['holds', 'H'],
        ['gamesStarted', '先発'],
        ['qualityStarts', 'QS'],
        ['highQualityStarts', 'HQS'],
      ],
    ],
  ],
};
export function Panel({ title, close, children, wide = false, mobileReplay = false }) {
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
  // ⚠ 試合結果のカード（`.online-score`）の中から開くので、`.online` の直下へ出す
  //    （`dialogPortal.js`）。カードの grid が観戦リプレイの中まで当たっていた
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
          <button aria-label={`${title}を閉じる`} onClick={dismiss}>
            閉じる
          </button>
        )}
      </header>
      {children}
    </dialog>,
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
// スマホで1ページに出す人数。⚠ PC はページを分けない（下記）
const COMPACT_PAGE_SIZE = 6;
export function BoxScore({ game, ownTeam }) {
  // ⚠ **PC はページを分けず全員を出す**（小窓の中を縦に送る）。以前は12人で区切っていて、
  //    1試合に出た打者は13〜16人いるので毎回2ページ目ができ、ページ送りは表の下
  //    （1280×800 では小窓の外）にあって、残りの数人が見えないままになっていた
  const [wide, setWide] = useState(
    () => window.matchMedia('(min-width: 768px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => {
      setWide(media.matches);
      setPage(0);
      setGroup(media.matches ? 'overview' : 'basic');
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [team, setTeam] = useState(
      [game.home, game.away].includes(ownTeam) ? ownTeam : game.home,
    ),
    [category, setCategory] = useState('batting'),
    [groupId, setGroup] = useState(() =>
      window.matchMedia('(min-width: 768px)').matches ? 'overview' : 'basic',
    ),
    [page, setPage] = useState(0),
    [sort, setSort] = useState(null);
  const overviewColumns = [
    ...new Map(
      GROUPS[category].flatMap((g) => g[2]).map((c) => [c[0], c]),
    ).values(),
  ];
  const group =
    wide && groupId === 'overview'
      ? ['overview', '主要成績一覧', overviewColumns]
      : GROUPS[category].find(([id]) => id === groupId) || GROUPS[category][0];
  const rows = [...(game.teams?.[team] || [])].filter((p) =>
    category === 'batting'
      ? (p.batting?.plateAppearances ||
          p.batting?.atBats ||
          p.batting?.walks ||
          p.batting?.hitByPitch ||
          p.batting?.sacrificeBunts ||
          p.battingOrder ||
          p.batting?.stolenBases ||
          p.batting?.caughtStealing ||
          p.batting?.fieldingChances) > 0
      : (p.pitching?.pitches || p.pitching?.inningsPitched) > 0,
  );
  rows.sort((a, b) => {
    if (!sort) return (a.battingOrder || 99) - (b.battingOrder || 99);
    const x = a[category]?.[sort.key],
      y = b[category]?.[sort.key];
    if (x == null || y == null)
      return x == null && y == null ? 0 : x == null ? 1 : -1;
    return (x - y) * (sort.asc ? 1 : -1);
  });
  return (
    <>
      <div className="online-stat-tools">
        <div className="online-segments" aria-label="試合成績の球団">
          {[game.away, game.home].map((name) => (
            <button
              key={name}
              title={name}
              aria-label={name}
              aria-pressed={team === name}
              onClick={() => {
                setTeam(name);
                setPage(0);
              }}
            >
              {teamShort(name)}
            </button>
          ))}
        </div>
        {wide ? (
          // ⚠ PCは**並んだタブ**（選手成績の表と同じ）。打撃・投球を選び、その区分を並べる
          <div
            className="online-group-tabs"
            role="group"
            aria-label="試合成績の表示項目"
          >
            <div className="online-segments">
              {['batting', 'pitching'].map((c) => (
                <button
                  key={c}
                  aria-pressed={category === c}
                  onClick={() => {
                    setCategory(c);
                    setGroup('overview');
                    setPage(0);
                    setSort(null);
                  }}
                >
                  {c === 'batting' ? '打撃' : '投球'}
                </button>
              ))}
            </div>
            <div className="online-segments">
              {[['overview', '主要成績'], ...GROUPS[category]].map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={group[0] === id}
                  onClick={() => {
                    setGroup(id);
                    setPage(0);
                    setSort(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <select
            aria-label="試合成績の表示項目"
            value={`${category}:${group[0]}`}
            onChange={(e) => {
              const [c, g] = e.target.value.split(':');
              setCategory(c);
              setGroup(g);
              setPage(0);
              setSort(null);
            }}
          >
            {Object.entries(GROUPS).flatMap(([c, groups]) =>
              groups.map(([id, label]) => (
                <option key={`${c}:${id}`} value={`${c}:${id}`}>
                  {label}
                </option>
              )),
            )}
          </select>
        )}
      </div>
      <table className="online-record-table">
        <thead>
          <tr>
            <th>選手</th>
            {group[2].map(([key, label]) => (
              <th key={key}>
                <button
                  aria-label={`${label}で並べ替え`}
                  aria-pressed={sort?.key === key}
                  onClick={() => {
                    setSort({
                      key,
                      asc: sort?.key === key ? !sort.asc : false,
                    });
                    setPage(0);
                  }}
                >
                  {label}
                  {sort?.key === key ? (sort.asc ? '▲' : '▼') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(wide
            ? rows
            : rows.slice(page * COMPACT_PAGE_SIZE, (page + 1) * COMPACT_PAGE_SIZE)
          ).map((p) => (
            <tr key={p.key || p.id}>
              <th title={p.name}>{p.name}</th>
              {group[2].map(([key, , format = 'count']) => (
                <td key={key}>{formatStat({ format }, p[category]?.[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p>この区分の出場記録はありません。</p>}
      {!wide && (
        <PageNav
          page={page}
          count={rows.length}
          size={COMPACT_PAGE_SIZE}
          setPage={setPage}
        />
      )}
      {game.legacy && (
        <small className="online-stat-note">
          記録を取り始める前の試合です。残っていない項目は「—」です。
        </small>
      )}
    </>
  );
}
export function GameRecordButton({
  game,
  year,
  ownTeam,
  children,
  className = 'online-record-button',
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={className}
        onClick={() => setOpen(true)}
        aria-label={`${teamLabel(game.home)}対${teamLabel(game.away)}の試合成績`}
      >
        {children || '個人成績'}
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
  const result = useRead('game', { id, year }),
    game = result.data;
  return (
    <Panel
      title="試合成績"
      close={close}
      wide={watch && !compact}
      mobileReplay={watch && compact && !!game}
    >
      <RequestState result={result} />
      {game && (
        <>
          {game.replay?.frames?.length > 0 && (
            <nav className="online-replay-launch" aria-label="試合の表示">
              <button aria-pressed={!watch} onClick={() => setWatch(false)}>
                個人成績
              </button>
              <button aria-pressed={watch} onClick={() => setWatch(true)}>
                {compact ? '試合経過' : '観戦リプレイ'}
              </button>
            </nav>
          )}
          {!watch && (
            <p className="online-game-summary">
              <small>{turnLabel(game.date)}</small>
              <strong>
                <span title={teamLabel(game.away)}>{teamShort(game.away)}</span>{' '}
                {game.awayScore} – {game.homeScore}{' '}
                <span title={teamLabel(game.home)}>{teamShort(game.home)}</span>
              </strong>
            </p>
          )}
          {watch ? (
            compact ? (
              <MobileReplay game={game} close={close} />
            ) : (
              <ReplayViewer game={game} />
            )
          ) : game.teams ? (
            <>
              {/* 得点経過（記録を取り始めた後の試合だけ。古い試合には無い） */}
              <ScoringPlays game={game} />
              <BoxScore game={game} ownTeam={ownTeam} />
            </>
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
  const mobile = useMobile();
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
        {!mobile ? (
          // ⚠ PCは試合結果のページと同じボタンの切り替え
          <div className="online-segments" role="group" aria-label="試合記録の範囲">
            {[
              ['own', '自球団'],
              ['league', 'リーグ全体'],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={scope === id}
                onClick={() => {
                  setScope(id);
                  setPage(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <select
            aria-label="試合記録の範囲"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setPage(0);
            }}
          >
            <option value="own">自球団</option>
            <option value="league">リーグ全体</option>
          </select>
        )}
      </div>
      <RequestState result={result} />
      {result.data && (
        <>
          <div className="online-game-history-list">
            {result.data.games.map((g) => {
              const outcome = ownOutcome(g, view.teamName);
              return (
                <article key={g.gameId}>
                  {/* ⚠ ゲーム内の日付は出さない。オンラインはターンで進む */}
                  <small>{turnLabel(g.date)}</small>
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
