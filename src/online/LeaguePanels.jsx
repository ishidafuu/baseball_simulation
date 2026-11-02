import React, { useContext, useEffect, useRef, useState } from 'react';
import { ReadContext } from './useRead.js';
import {
  roleFor,
  STRATEGY_FIELDS,
  STARTER_ROLES,
  RELIEF_ROLES,
  TACTIC_FIELDS,
  TACTIC_DEFAULTS,
} from './tactics.js';
import { useDraftState } from './Drafts.jsx';
import { GameRecordButton, usePrefetchGames } from './GameHistory.jsx';
import {
  decisionText,
  formatRate,
  ownOutcome,
  teamShort,
  teamLabel,
} from './gameText.js';
import { api, POS, MENUS } from './api.js';
import { MAX_MEMBERS } from './membership.js';
import { PHASE_LABELS, sameEditState } from './shared.js';
import { pickColumns, formatStat } from './statsView.js';
import { useReorder, moveItem } from './reorder.js';
import { getPositionFitness } from '../utils/physics.js';
import { setRecommendedLineup } from '../game/autoSimulation.js';
import { LEAGUE_SETTINGS } from '../teams-data.js';
import { teamFromView, planFromTeam } from './lineupBridge.js';
import {
  AbilityGrade,
  ConditionMark,
  PlayerStatsButton,
  rosterByRole,
} from './PlayerPerformance.jsx';
import { Deadline, PhaseProgress } from './Home.jsx';
import { TRAINING_MENUS } from '../season/campTraining.js';
import { PageNav } from './PageNav.jsx';
import {
  Segmented,
  TeamName,
  TeamBadge,
  TeamLink,
  FatigueMark,
  fatigueLevel,
  gameDay,
  Sheet,
  useNotify,
} from './ui.jsx';
import TryoutPlanner from './TryoutPlanner.jsx';
import {
  PYRAMID_LEAGUES,
  PROMOTION_PLACES,
  RELEGATION_FROM_BOTTOM,
} from './pyramidLeague.js';
export { PageNav } from './PageNav.jsx';

/**
 * リーグに参加する画面。
 *
 * ⚠ **ログイン直後の非参加者がここに来る**。参加するにはログインが要るが、
 *    ログインに参加者であることを求めると永遠に入れない（鶏と卵）。
 *    サーバーは非参加者にも `joinRequired` のビューを返す。
 * ⚠ **招待コードは廃止した**。アカウントは管理者が Supabase で作らない限り
 *    増えない（公開サインアップは無効）ので、入口はそこで絞れている。
 *    その上にコードを重ねると、人を呼ぶたびに発行と受け渡しの手間が増えるだけだった。
 * ⚠ 球団名は**表示名**として扱われる。内部の球団名は引き継いだ球団のまま
 *    （記録の選手キーまで名前で繋がっているため）。
 */
export function JoinLeague({ view, busy, join, logout }) {
  const [teamName, setTeamName] = useState('');
  const team = view?.joinTeam;
  return (
    <section className="online-card online-login">
      <p className="online-eyebrow">JOIN</p>
      <h1>リーグに参加する</h1>
      {team ? (
        <div className="online-join-team">
          <span>あなたが引き継ぐ球団</span>
          <strong>{team.name}</strong>
          <small>
            {team.league}
            {team.rank ? ` · 戦力${team.rank}` : ''}
            {team.wins + team.losses > 0 ? ` · ${team.wins}勝${team.losses}敗` : ''}
          </small>
        </div>
      ) : (
        <p>空いている球団のうち、下の階層で一番弱いものを引き継ぎます。</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          join({ teamName: teamName.trim() });
        }}
      >
        <label>
          球団名を変える（任意）
          <input
            value={teamName}
            maxLength={24}
            placeholder={team?.name || '元の名前のまま'}
            onChange={(e) => setTeamName(e.target.value)}
          />
        </label>
        <button className="online-primary" type="submit" disabled={busy}>
          {teamName.trim() ? `「${teamName.trim()}」で参加する` : 'この球団で参加する'}
        </button>
      </form>
      <button className="online-link" disabled={busy} onClick={logout}>
        別のアカウントでログインし直す
      </button>
    </section>
  );
}

export function Login({ local, login, busy }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <section className="online-card online-login">
      <p className="online-eyebrow">ONLINE LEAGUE</p>
      <h1>今日の球団を、見に行こう。</h1>
      <p>
        最大{MAX_MEMBERS}人で、1部・2部の12球団を育てる独立リーグ。1時間ごとに1日進み、留守の間もペナントは続きます。
      </p>
      {local ? (
        <>
          <div className="online-actions">
            <button disabled={busy} onClick={() => login({ user: 'player1' })}>
              プレイヤー1で入る
            </button>
            <button disabled={busy} onClick={() => login({ user: 'player2' })}>
              プレイヤー2で入る
            </button>
          </div>
          {/* ⚠ 検査（online-*-ui-check）はこの文言で検証モードの画面か確かめる */}
          <small className="online-muted">ローカル検証モード（公開環境では無効）</small>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login({ email, password });
          }}
        >
          <label>
            メールアドレス
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            パスワード
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="online-primary" disabled={busy}>
            ログイン
          </button>
        </form>
      )}
    </section>
  );
}
// ゲーム差（首位との差）。⚠ 引き分けは勝率に入れない慣例どおり、勝ち越し数の差の半分
const gamesBehind = (leader, row) => {
  const gb = (leader.wins - leader.losses - (row.wins - row.losses)) / 2;
  return gb <= 0 ? '—' : Number.isInteger(gb) ? String(gb) : gb.toFixed(1);
};
/**
 * 順位表。部ごとに分け、昇格・降格の線を引く。
 * ⚠ **`view.standings` は全球団を通した並び**。1部と2部を混ぜたまま出すと、
 *    2部の首位が表の1位に見えて「優勝争い」と取り違える（実測で起きた）。
 *    `teamLeagues` が無い古いビューでは従来どおり1つの表で出す。
 * `around` を付けると自球団の部だけ・自球団の前後1球団だけを出す（ホーム用）。
 */
export function Standings({ view, around = false, onShowAll, title = 'リーグ順位' }) {
  let leagues = view.teamLeagues
    ? PYRAMID_LEAGUES.map((league) => ({
        league,
        rows: view.standings.filter(
          (s) => view.teamLeagues[s.team] === league.id,
        ),
      })).filter((group) => group.rows.length)
    : [{ league: null, rows: view.standings }];
  if (around) {
    const mine = leagues.find(({ rows }) =>
      rows.some((s) => s.team === view.teamName),
    );
    if (mine) leagues = [mine];
  }
  return (
    <section className="online-card online-standings">
      <div className="online-card-heading">
        <h2>{title}</h2>
        {onShowAll && (
          <button className="online-link" onClick={onShowAll}>
            すべて見る
          </button>
        )}
      </div>
      {leagues.map(({ league, rows }) => {
        const at = rows.findIndex((s) => s.team === view.teamName);
        const from = around && at >= 0 ? Math.max(0, Math.min(at - 1, rows.length - 3)) : 0;
        const shown = around ? rows.slice(from, from + 3) : rows;
        return (
          <table key={league?.id || 'all'}>
            {league && <caption>{league.name}</caption>}
            <thead>
              <tr>
                <th>球団</th>
                <th>勝</th>
                <th>敗</th>
                <th>分</th>
                <th>勝率</th>
                <th>差</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const i = rows.indexOf(s);
                const up = league && league.up.length && i < PROMOTION_PLACES[0];
                const down =
                  league &&
                  league.down.length &&
                  i >= rows.length - RELEGATION_FROM_BOTTOM[0];
                return (
                  <tr
                    key={s.team}
                    className={[
                      s.team === view.teamName ? 'online-own' : '',
                      up ? 'is-promotion' : '',
                      down ? 'is-relegation' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <th>
                      <span className="online-rank">{i + 1}</span>
                      <TeamLink team={s.team}>
                        <TeamBadge team={s.team} size="sm" />
                        <span className="online-standing-name">{teamLabel(s.team)}</span>
                      </TeamLink>
                      {up ? <small className="online-move">昇格圏</small> : null}
                      {down ? (
                        <small className="online-move">降格圏</small>
                      ) : null}
                    </th>
                    <td>{s.wins}</td>
                    <td>{s.losses}</td>
                    <td>{s.draws || 0}</td>
                    <td>{formatRate(s.winRate)}</td>
                    <td>{gamesBehind(rows[0], s)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      })}
    </section>
  );
}

/** 試合1件のカード。自球団の試合は勝敗の色帯を付け、押すと試合結果を開く */
export function ScoreCard({
  game,
  view,
  upcoming = false,
  compact = false,
  year = view.year,
  sequence,
}) {
  const outcome = !upcoming && ownOutcome(game, view.teamName);
  const own = game.home === view.teamName || game.away === view.teamName;
  const decisions = !upcoming && decisionText(game.decisions);
  const name = compact ? teamShort : teamLabel;
  const body = (
    <>
      <span className="online-score-date">{gameDay(game.date)}</span>
      <span className="online-score-teams">
        <span className="online-score-team">
          <TeamBadge team={game.away} size="sm" />
          <span title={teamLabel(game.away)}>{name(game.away)}</span>
        </span>
        <strong>
          {upcoming ? 'vs' : `${game.awayScore} – ${game.homeScore}`}
        </strong>
        <span className="online-score-team is-home">
          <span title={teamLabel(game.home)}>{name(game.home)}</span>
          <TeamBadge team={game.home} size="sm" />
        </span>
      </span>
      {outcome && (
        <span className={`online-outcome is-${outcome.tone}`}>{outcome.mark}</span>
      )}
      {decisions && <small className="online-score-decisions">{decisions}</small>}
    </>
  );
  const className = `online-score ${own ? 'is-own' : ''} ${outcome ? `is-${outcome.tone}` : ''}`;
  return !upcoming && view.gameDetailsAvailable && game.gameId ? (
    <GameRecordButton
      game={game}
      year={year}
      sequence={sequence}
      ownTeam={view.teamName}
      className={className}
    >
      {body}
    </GameRecordButton>
  ) : (
    <div className={className}>{body}</div>
  );
}

// 試合の一覧。⚠ **ページ送りにしない**（「もっと見る」で継ぎ足す）。
// 自球団の試合は色帯付きで先に目に入るようにする。
// ⚠ **試合の入口はここ1つ**。以前は「試合」一覧（手元の直近14試合）と、別の
//    「過去の試合・個人成績」パネル（年度・6件ずつのページ送り）が同じ情報を別々に出していた。
//    手元に無い古い試合と過去の年度は、「もっと見る」で20件ずつ読み足す。
const MORE = 20;
const dayKey = (g) => (g.date?.month || 0) * 100 + (g.date?.day || 0);
function mergeGames(...lists) {
  const byId = new Map();
  for (const list of lists) for (const g of list) byId.set(String(g.gameId), g);
  return [...byId.values()].sort(
    (a, b) => dayKey(b) - dayKey(a) || (b.gameId || 0) - (a.gameId || 0),
  );
}
export function Results({ view, compact = false, mode: fixedMode }) {
  const [modeState, setMode] = useState('results');
  const mode = fixedMode || modeState;
  const [limit, setLimit] = useState(10);
  const [scope, setScope] = useState(compact ? 'own' : 'league');
  const [year, setYear] = useState(view.year);
  const read = useContext(ReadContext);
  const [remote, setRemote] = useState({ key: '', games: [], count: null, pages: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  usePrefetchGames(view);
  const key = `${year}:${scope}`;
  const current = year === view.year;
  const isOwn = (game) => game.home === view.teamName || game.away === view.teamName;
  const scoped = (list) => (scope === 'own' ? list.filter(isOwn) : list);
  const fetched = remote.key === key ? remote : { games: [], count: null, pages: 0 };
  const list =
    mode === 'results'
      ? mergeGames(scoped(current ? view.results : []), fetched.games)
      : scoped(view.upcoming);
  const total =
    mode === 'results' && fetched.count !== null
      ? Math.max(fetched.count, list.length)
      : null;
  const canFetch = mode === 'results' && view.gameDetailsAvailable && !!read;
  const loadMore = async () => {
    if (!canFetch || loading) return;
    setLoading(true);
    setError('');
    try {
      const page = fetched.pages;
      const data = await read('games', { year, page, scope, size: MORE });
      setRemote((old) => ({
        key,
        games: mergeGames(old.key === key ? old.games : [], data.games),
        count: data.count,
        pages: page + 1,
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  // ⚠ 手元の結果はリーグ全体の直近14試合だけ。自球団の試合はその中に2〜3試合しか
  //    無いことが多いので、表示する数に足りなければ（過去の年度は常に）すぐ読み足す
  const short = list.length < limit;
  useEffect(() => {
    if (mode === 'results' && canFetch && remote.key !== key && (!current || short)) loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode, canFetch]);
  const more = list.length > limit || (canFetch && (total === null || list.length < total));
  const showMore = () => {
    setLimit(limit + MORE);
    if (list.length < limit + MORE && (total === null || list.length < total)) loadMore();
  };
  const years = view.seasonYears || [view.year];
  // 前後の試合へ移るときの並び（日付の古い順）
  const sequence = mode === 'results' ? [...list].reverse() : [];
  return (
    <section className="online-card">
      <div className="online-card-heading">
        <h2>{fixedMode === 'upcoming' ? '今後の日程' : '試合'}</h2>
        {mode !== 'standings' && (
        <Segmented
          small
          label="試合の表示範囲"
          value={scope}
          options={[
            ['own', '自球団'],
            ['league', 'リーグ全体'],
          ]}
          onChange={(value) => {
            setScope(value);
            setLimit(10);
          }}
        />
        )}
      </div>
      {!fixedMode && (
        <div className="online-results-tools">
          <Segmented
            label="結果と日程"
            value={mode}
            options={[
              ['results', '結果'],
              ['upcoming', '日程'],
              ...(compact ? [['standings', '順位表']] : []),
            ]}
            onChange={(value) => {
              setMode(value);
              setLimit(10);
            }}
          />
          {mode === 'results' && years.length > 1 && (
            <select
              aria-label="試合記録の年度"
              value={year}
              onChange={(e) => {
                setYear(Number(e.target.value));
                setLimit(10);
              }}
            >
              {years.map((n) => (
                <option key={n} value={n}>
                  {n}年目
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {mode === 'standings' ? (
        <Standings view={view} title="順位表" />
      ) : list.length ? (
        <div className="online-score-list">
          {list.slice(0, limit).map((g) => (
            <ScoreCard
              key={g.gameId || g.id || `${g.date?.month}/${g.date?.day}:${g.home}`}
              game={g}
              view={view}
              year={year}
              sequence={sequence}
              upcoming={mode !== 'results'}
              compact={compact}
            />
          ))}
        </div>
      ) : loading ? (
        <p className="online-empty">試合記録を読み込んでいます…</p>
      ) : (
        <p className="online-empty">
          {mode === 'results'
            ? 'この年度の試合結果はまだありません。'
            : '今後の試合予定はありません。'}
        </p>
      )}
      {error && (
        <div role="alert" className="online-alert">
          <span>{error}</span>
          <button className="online-link" onClick={loadMore}>
            再取得
          </button>
        </div>
      )}
      {mode !== 'standings' && more && (
        <button className="online-more" disabled={loading} onClick={showMore}>
          {loading
            ? '読み込み中…'
            : total !== null
              ? `もっと見る（残り${Math.max(0, total - Math.min(limit, list.length))}試合）`
              : 'もっと見る'}
        </button>
      )}
    </section>
  );
}
/**
 * お知らせの種類ごとの見出し。
 * ⚠ **種類を足したらここにも足すこと**。昇降格（`promotion`）は
 *    `picks` ではなく `moves` を持つので、`noticeItems` も合わせて見る。
 *    以前は `n.picks.length` を直接読んでいて、1年目の終わりに
 *    昇降格のお知らせが入るとリーグ便りごと画面が落ちていた。
 */
const NOTICE_LABELS = {
  draft: 'NPBドラフト',
  tryout: 'トライアウト',
  promotion: '昇格・降格',
};
/** 締め切りの日時を日本時間で「11/8(日) 0:00」の形にする */
export function formatDeadline(iso) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  if (Number.isNaN(d.getTime())) return '';
  const week = '日月火水木金土'[d.getUTCDay()];
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${week}) ${d.getUTCHours()}:${minutes}`;
}
const noticeItems = (notice) => notice?.picks || notice?.moves || [];
const leagueName = (id) =>
  PYRAMID_LEAGUES.find((league) => league.id === id)?.name || id;
const tierOf = (id) =>
  PYRAMID_LEAGUES.find((league) => league.id === id)?.tier ?? 0;
const isPromotion = (move) => tierOf(move.to) < tierOf(move.from);

// ⚠ 種類（kind）を持たない古いお知らせは、1年目の最初のトライアウト＝初期編成とみなす
export const isInitialTryout = (n, notices = []) =>
  n?.type === 'tryout' &&
  (n.kind
    ? n.kind === 'initial_tryout'
    : n.year === 1 &&
      notices.filter((x) => x.type === 'tryout' && x.year === 1).at(-1) === n);
const noticeTitle = (n, notices) =>
  isInitialTryout(n, notices) ? '初期編成' : NOTICE_LABELS[n.type] || 'お知らせ';
// 自球団に関係する項目か（獲得した選手・指名された自球団の選手・自球団の昇降格）
const isOwnItem = (notice, item, teamName) =>
  notice.type === 'promotion' ? item.teamId === teamName : item.team === teamName;
/**
 * リーグ便り。⚠ **既定は自球団に関係するもの**。以前は初期編成の全288人の
 * 指名リスト（1/36ページ）が既定で開き、「誰を獲ったか」が分からなかった。
 * 自球団の分を先に「あなたが獲得した24人」として出し、全体は切り替えで見せる。
 */
export function Notices({ view, compact = false }) {
  const [selected, setSelected] = useState('notice:0');
  const [page, setPage] = useState(0);
  const [scope, setScope] = useState('own');
  const [kind, index] = selected.split(':');
  const notice = view.notices[Number(index)];
  const history = view.history[Number(index)];
  const all = kind === 'notice' ? noticeItems(notice) : [];
  const own = notice ? all.filter((p) => isOwnItem(notice, p, view.teamName)) : [];
  const picks = scope === 'own' && own.length ? own : all;
  const label = compact ? teamShort : teamLabel;
  const size = 8;
  useEffect(() => {
    if (!view.notices.length && !view.history.length) return;
    if ((kind === 'notice' && !notice) || (kind === 'history' && !history)) {
      setSelected(view.notices.length ? 'notice:0' : 'history:0');
      setPage(0);
    }
  }, [kind, notice, history, view.notices.length, view.history.length]);
  const options = [
    ...view.notices.map((n, i) => [
      `notice:${i}`,
      `${n.year}年 ${noticeTitle(n, view.notices)}`,
    ]),
    ...view.history.map((h, i) => [`history:${i}`, `${h.year}年の最終順位`]),
  ];
  const ownHeading =
    notice?.type === 'promotion'
      ? '自球団の昇格・降格'
      : notice?.type === 'draft'
        ? `自球団から指名された${own.length}人`
        : `あなたが獲得した${own.length}人`;
  return (
    <section className="online-card">
      <h2>リーグ便り</h2>
      {options.length ? (
        <>
          <Segmented
            label="表示する便り"
            value={selected}
            options={options}
            onChange={(value) => {
              setSelected(value);
              setPage(0);
              setScope('own');
            }}
          />
          {kind === 'notice' ? (
            <>
              <p className="online-news-summary">
                {noticeTitle(notice || {}, view.notices)}（{all.length}
                {notice?.type === 'promotion' ? '球団' : '人'}）
              </p>
              {own.length > 0 && own.length < all.length && (
                <Segmented
                  small
                  label="便りの範囲"
                  value={scope}
                  options={[
                    ['own', ownHeading],
                    ['all', `全体（${all.length}）`],
                  ]}
                  onChange={(value) => {
                    setScope(value);
                    setPage(0);
                  }}
                />
              )}
              <div
                className={`online-news-list ${compact ? 'is-compact' : ''}`}
              >
                {picks.slice(page * size, page * size + size).map((p, j) =>
                  notice?.type === 'promotion' ? (
                    <article key={j}>
                      <b>
                        <TeamName team={p.teamId} short={compact} />
                      </b>
                      <span>
                        {leagueName(p.from)} → {leagueName(p.to)}
                        {isPromotion(p) ? '（昇格）' : '（降格）'}
                      </span>
                    </article>
                  ) : (
                    <article
                      key={j}
                      className={isOwnItem(notice, p, view.teamName) ? 'is-own' : ''}
                    >
                      <b>
                        {typeof p.round === 'number' ? `${p.round}巡` : p.round}{' '}
                        {p.name}
                      </b>
                      <span>→ {label(p.npbTeam || p.team)}</span>
                    </article>
                  ),
                )}
              </div>
              <PageNav
                page={page}
                count={picks.length}
                size={size}
                setPage={setPage}
              />
            </>
          ) : (
            history?.standings.map((s, i) => (
              <p className="online-history-row" key={s.team}>
                {i + 1}. {teamLabel(s.team)}　{s.wins}勝{s.losses}敗
              </p>
            ))
          )}
        </>
      ) : (
        <p className="online-empty">リーグの動きがここに届きます。</p>
      )}
    </section>
  );
}

export function PhasePanel({ view, auth, busy, run, command, mobile }) {
  const phase = view.phase;
  const [plan, setPlan] = useDraftState(
    'phase.plan',
    phase.submission?.plan || null,
  );
  const [dirty, setDirty] = useDraftState('phase.dirty', false);
  const [planRevision, setPlanRevision] = useState(null);
  const [baseSubmission, setBaseSubmission] = useDraftState('phase.base', () =>
    structuredClone(phase.submission || null),
  );
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!phase.submission)
      api('defaults', auth)
        .then((d) => {
          if (!cancelled) {
            if (d.phaseId !== phase.id) {
              setError('手続きが更新されました。最新状態を確認してください');
              return;
            }
            setError('');
            setPlan((old) => old || d.plan);
            setPlanRevision(d.revision);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [auth, phase.id, phase.submission]);
  const submissionChanged = !sameEditState(
    baseSubmission,
    phase.submission || null,
  );
  useEffect(() => {
    if (submissionChanged && !dirty) {
      setPlan(phase.submission ? structuredClone(phase.submission.plan) : null);
      setBaseSubmission(structuredClone(phase.submission || null));
    }
  }, [
    mobile,
    submissionChanged,
    phase.submission,
    dirty,
    setPlan,
    setBaseSubmission,
  ]);
  const planRef = useRef(plan);
  planRef.current = plan;
  const submit = (ready, { quiet = false } = {}) => {
    const sent = planRef.current;
    return run(async () => {
      await command(
        'submit',
        {
          phaseId: phase.id,
          plan: sent,
          ready,
          baseSubmission,
        },
        { quiet },
      );
      setBaseSubmission({ plan: structuredClone(sent), ready });
      // 送っている間に変えた分は、次の自動保存で送る
      if (planRef.current === sent) setDirty(false);
    });
  };
  // ⚠ **下書きは自動で保存する**（打順と同じ1.2秒後）。以前は「下書きを保存」と
  //    「この内容で決定」の2つのボタンがあり、画面ごとに保存の仕方が違っていた。
  // ⚠ 決定済みのときは自動で送らない。下書きとして送ると決定が取り消されてしまう
  //    （決定済みで変えたら「変更して決定」を押す）。
  // ⚠ 失敗した内容は繰り返し送らない。保存中も入力は止めない。
  const [autoSaving, setAutoSaving] = useState(false);
  const failedPlan = useRef(null);
  const mineReady = view.members.find((m) => m.teamName === view.teamName)?.ready;
  useEffect(() => {
    if (!dirty || busy || !plan || mineReady || phase.submission?.ready) return;
    if (failedPlan.current === plan) return;
    const timer = setTimeout(async () => {
      setAutoSaving(true);
      const sent = planRef.current;
      const result = await submit(false, { quiet: true });
      setAutoSaving(false);
      if (!result?.ok && result?.error !== '別の操作を処理中です') failedPlan.current = sent;
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, dirty, busy, mineReady]);
  const resetSubmission = () =>
    run(async () => {
      setError('');
      try {
        let next = phase.submission?.plan;
        if (!next) {
          const defaults = await api('defaults', auth);
          if (defaults.phaseId !== phase.id)
            throw new Error(
              '手続きが更新されました。最新状態を確認してください',
            );
          next = defaults.plan;
        }
        setPlan(structuredClone(next));
        setBaseSubmission(structuredClone(phase.submission || null));
        setDirty(false);
      } catch (error) {
        setError(error.message);
        throw error;
      }
    });
  // 「標準案に戻す」（以前の「おすすめ順に戻す」）。⚠ **保存済みの下書きではなく、いつも標準案を取り直す**。
  //    以前は上の `resetSubmission`（保存案を読み直す）を流用しており、
  //    下書きを一度保存すると、押しても下書きに戻るだけで、おすすめ順には戻らなかった。
  //    保存済みの提出があるなら、戻した内容は未保存の編集として扱う
  const resetToDefaults = () =>
    run(async () => {
      setError('');
      try {
        const defaults = await api('defaults', auth);
        if (defaults.phaseId !== phase.id)
          throw new Error('手続きが更新されました。最新状態を確認してください');
        setPlan(structuredClone(defaults.plan));
        setDirty(!!phase.submission);
      } catch (error) {
        setError(error.message);
        throw error;
      }
    });
  const mine = view.members.find((m) => m.teamName === view.teamName);
  const update = (next) => {
    failedPlan.current = null;
    setDirty(true);
    setPlan(next);
  };
  // 自動保存の間は入力を止めない（押した ± や順位の操作が消えないように）
  const locked = busy && !autoSaving;
  return (
    <section className="online-card online-decision">
      <fieldset className="online-form-fields" disabled={locked}>
        <div className="online-decision-head">
          <h2>{PHASE_LABELS[phase.kind]}</h2>
          {/* ⚠ 締め切りは先頭に、残り時間つきで出す。以前は「締め切りで進みます」と
              書いてあるのに、いつかがスマホのどこにも出なかった */}
          <Deadline phase={phase} view={view} />
          <PhaseProgress view={view} />
        </div>
        {error && (
          <div role="alert" className="online-alert">
            <span>{error}</span>
            <button className="online-link" onClick={resetSubmission}>
              {phase.submission ? '保存案を読み直す' : '標準案を再取得'}
            </button>
          </div>
        )}
        {submissionChanged && dirty && (
          <div role="alert" className="online-edit-notice">
            <p>
              別の端末で提出が更新されました。いまの入力を捨てて、保存済みの内容を読み直せます。
            </p>
            <button onClick={resetSubmission}>最新の提出を読み直す</button>
          </div>
        )}
        {plan && (
          <>
            {plan.rankedIds && (
              <TryoutPlanner
                plan={plan}
                candidates={phase.candidates}
                roster={view.roster}
                maxCount={Math.max(0, 24 - view.roster.length)}
                busy={locked}
                compact={mobile}
                onChange={update}
                onReset={resetToDefaults}
              />
            )}
            {plan.releaseIds && (
              <ReleaseList view={view} plan={plan} update={update} />
            )}
            {plan.menu && <CampMenus view={view} plan={plan} update={update} />}
            {phase.kind === 'offseason' && (
              <p>最終順位を保存し、次年度のキャンプへ進みます。</p>
            )}
            <div className="online-decision-bar">
              <span className="online-save-state" role="status">
                {autoSaving
                  ? '下書きを保存中…'
                  : dirty
                    ? mine?.ready
                      ? '● 決定後に変更があります'
                      : failedPlan.current === plan
                        ? '下書きを保存できませんでした'
                        : '● 未保存'
                    : mine?.ready
                      ? '決定済み'
                      : phase.submission
                        ? '下書きは自動で保存済み'
                        : '標準案のままです'}
              </span>
              {phase.submission?.ready && (
                <button disabled={busy} onClick={() => submit(false)}>
                  決定を取り消す
                </button>
              )}
              <button
                className="online-primary"
                disabled={busy || (mine?.ready && !dirty)}
                onClick={() => submit(true)}
              >
                {mine?.ready && dirty ? '変更して決定' : 'この内容で決定'}
              </button>
            </div>
          </>
        )}
        {!plan && !error && <p className="online-empty">標準案を準備しています…</p>}
      </fieldset>
    </section>
  );
}

// 退団の選択（チェックリスト）。年齢・能力を並べ、選んだ人数を出す
function ReleaseList({ view, plan, update }) {
  const left = view.roster.length - plan.releaseIds.length;
  return (
    <>
      <p>
        チェックした選手が退団します。残り <strong>{left}人</strong>
        （最低9人は残してください）。
      </p>
      <ul className="online-release-list">
        {rosterByRole(view.roster, view.lineup).map((p) => (
          <li key={p.id}>
            <label className="online-check">
              <input
                type="checkbox"
                checked={plan.releaseIds.includes(p.id)}
                onChange={(e) =>
                  update({
                    releaseIds: e.target.checked
                      ? [...plan.releaseIds, p.id]
                      : plan.releaseIds.filter((id) => id !== p.id),
                  })
                }
              />
              <span className="online-pick-name">
                <b>{p.name}</b>
                <small>
                  {p.age}歳 · {POS[p.position]}
                </small>
              </span>
            </label>
            {p.position === 'pitcher' ? (
              <PitcherAbilities player={p} />
            ) : (
              <FielderAbilities player={p} />
            )}
            <PlayerStatsButton player={p} panel="abilities">
              詳細
            </PlayerStatsButton>
          </li>
        ))}
      </ul>
    </>
  );
}

// キャンプの練習メニュー（カード）。⚠ 以前は12個をセレクトで選ぶだけで、
// 何が伸びるのかが画面のどこにも出なかった。効果と、いまのチームの弱点を添える
const avg = (list) =>
  list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
function teamWeakness(roster) {
  const fielders = roster.filter((p) => p.position !== 'pitcher');
  const pitchers = roster.filter((p) => p.position === 'pitcher');
  const scores = [
    ['intensive_meet', 'ミート', avg(fielders.map((p) => p.batting?.meet || 0))],
    ['intensive_power', 'パワー', avg(fielders.map((p) => p.batting?.power || 0))],
    ['intensive_speed', '走力', avg(fielders.map((p) => p.physical?.speed || 0))],
    ['intensive_defense', '守備', avg(fielders.map((p) => p.fielding?.defense || 0))],
    ['intensive_control', '制球', avg(pitchers.map((p) => p.pitching?.control || 0))],
    [
      'intensive_velocity',
      '球速',
      avg(pitchers.map((p) => ((p.pitching?.velocity || 120) - 115) * 2.5)),
    ],
  ];
  return scores.sort((a, b) => a[2] - b[2])[0];
}
function CampMenus({ view, plan, update }) {
  const weak = teamWeakness(view.roster);
  return (
    <>
      <p>
        キャンプ（全4回）の主練習を選びます。いまのチームの弱点は
        <strong>{weak[1]}</strong>です。
      </p>
      <div className="online-camp-cards" role="radiogroup" aria-label="主練習">
        {Object.entries(MENUS).map(([id, label]) => {
          const menu = TRAINING_MENUS[id];
          return (
            <button
              key={id}
              role="radio"
              aria-checked={plan.menu === id}
              className="online-camp-card"
              onClick={() => update({ menu: id })}
            >
              <span className="online-camp-icon" aria-hidden="true">
                {menu?.icon || '⚾'}
              </span>
              <b>{label}</b>
              <small>
                {id === 'standard'
                  ? '投手は制球、野手は打撃を中心にまんべんなく'
                  : menu?.description}
              </small>
              {id === weak[0] && <span className="online-tag">弱点の補強</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}
const FIELD_POSITIONS = [
  'catcher',
  'first',
  'second',
  'third',
  'short',
  'left',
  'center',
  'right',
];
/** 能力の小さな棒（英字ランク＋長さ）。⚠ 英字だけだと比べにくかった */
export function AbilityBar({ label, value, velocity = false, stamina = false }) {
  const ratio = Math.max(
    0,
    Math.min(1, velocity ? (value - 120) / 40 : stamina ? value / 200 : value / 100),
  );
  return (
    <span className="online-ability-bar" title={`${label} ${value ?? '—'}`}>
      <small>{label}</small>
      <AbilityGrade value={value} velocity={velocity} stamina={stamina} />
      <span className="online-ability-track">
        <span style={{ width: `${Math.round(ratio * 100)}%` }} />
      </span>
    </span>
  );
}
function FielderAbilities({ player }) {
  return (
    <span className="online-ability-row">
      <AbilityBar label="ミ" value={player.batting?.meet} />
      <AbilityBar label="パ" value={player.batting?.power} />
      <AbilityBar label="走" value={player.physical?.speed} />
      <AbilityBar label="守" value={player.fielding?.defense} />
    </span>
  );
}
function PitcherAbilities({ player }) {
  return (
    <span className="online-ability-row">
      <AbilityBar label="速" value={player.pitching?.velocity} velocity />
      <AbilityBar label="制" value={player.pitching?.control} />
      <AbilityBar label="ス" value={player.pitching?.stamina} stamina />
    </span>
  );
}

/**
 * 打順の1行を押したときのシート。打順の入れ替え・守備位置・控えとの交代。
 * ⚠ 守備位置は**入れ替え**で変える（同じ位置が2人にならないように、
 *    その位置にいた選手が元の位置へ回る）。サーバーは位置の重複を受け付けない。
 * ⚠ **1回変えても閉じない**。以前は控えと交代するとすぐ閉じ、続けて守備位置を
 *    変えるにはもう一度開き直していた。閉じるのは「閉じる」か外側を押したとき。
 * ⚠ シートは**選手を追いかける**（打順の番号ではなく選手IDで開いている）。
 *    打順を入れ替えたあとも、同じ選手のシートのまま続けて操作できる。
 */
function BatterSheet({ playerId, plan, view, change, follow, close }) {
  const entry = plan.battingOrder.find((e) => e.playerId === playerId);
  const player = view.roster.find((p) => p.id === playerId);
  if (!entry) return null;
  const used = new Set(plan.battingOrder.map((e) => e.playerId));
  const fit = (p, pos) =>
    p.position === pos ? 100 : getPositionFitness(p, pos, 0);
  // ⚠ 控えは**いまの守備位置を守れる順**に並べる（以前は名簿の順で、探す手間がかかった）
  const bench = view.roster
    .filter((p) => p.position !== 'pitcher' && p.isActive !== false && !used.has(p.id))
    .sort(
      (a, b) =>
        fit(b, entry.position) - fit(a, entry.position) ||
        (a.fatigue || 0) - (b.fatigue || 0),
    );
  const order = [...plan.battingOrder].sort((a, b) => a.battingOrder - b.battingOrder);
  const swapOrder = (battingOrder) => {
    const other = plan.battingOrder.find((e) => e.battingOrder === battingOrder);
    if (!other || other === entry) return;
    change({
      ...plan,
      battingOrder: plan.battingOrder.map((e) =>
        e === entry
          ? { ...e, battingOrder }
          : e === other
            ? { ...e, battingOrder: entry.battingOrder }
            : e,
      ),
    });
  };
  const swapPlayer = (id) => {
    change({
      ...plan,
      battingOrder: plan.battingOrder.map((e) =>
        e === entry ? { ...e, playerId: id } : e,
      ),
    });
    follow(id);
  };
  const movePosition = (position) => {
    const other = plan.battingOrder.find((e) => e.position === position);
    change({
      ...plan,
      battingOrder: plan.battingOrder.map((e) =>
        e === entry
          ? { ...e, position }
          : e === other
            ? { ...e, position: entry.position }
            : e,
      ),
    });
  };
  return (
    <Sheet
      title={`${entry.battingOrder}番 ${player?.name || ''}`}
      close={close}
      footer={
        <button className="online-primary" onClick={close}>
          閉じる
        </button>
      }
    >
      <h3>打順を入れ替える</h3>
      <div className="online-order-grid" role="group" aria-label="入れ替える打順">
        {order.map((e) => {
          const p = view.roster.find((x) => x.id === e.playerId);
          return (
            <button
              key={e.battingOrder}
              aria-pressed={e === entry}
              aria-label={`${e.battingOrder}番（${p?.name || ''}）と入れ替える`}
              onClick={() => swapOrder(e.battingOrder)}
            >
              <b>{e.battingOrder}</b>
              <small>{p?.name?.split(/\s/)[0] || ''}</small>
            </button>
          );
        })}
      </div>
      <h3>守備位置を変える</h3>
      <div className="online-position-grid">
        {FIELD_POSITIONS.map((pos) => {
          const value = player?.positionFitness?.[pos];
          return (
            <button
              key={pos}
              aria-pressed={entry.position === pos}
              onClick={() => movePosition(pos)}
            >
              <b>{POS[pos]}</b>
              {typeof value === 'number' && <small>適性{value}</small>}
            </button>
          );
        })}
      </div>
      <h3>控えと交代（{bench.length}人・{POS[entry.position]}を守れる順）</h3>
      {bench.length ? (
        <ul className="online-pick-list">
          {bench.map((p) => (
            <li key={p.id}>
              <button onClick={() => swapPlayer(p.id)}>
                <span className="online-pick-name">
                  <b>{p.name}</b>
                  <small>
                    {POS[p.position]}
                    {typeof p.positionFitness?.[entry.position] === 'number' &&
                      ` · ${POS[entry.position]}適性${p.positionFitness[entry.position]}`}
                  </small>
                </span>
                <span className="online-pick-state">
                  <ConditionMark player={p} />
                  <FatigueMark player={p} compact />
                </span>
                <FielderAbilities player={p} />
                <BatterStats player={p} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="online-empty">控えの野手がいません。</p>
      )}
    </Sheet>
  );
}

/** 今季の打撃成績を短く（打率・本塁打・出塁率・OPS） */
const BATTER_STAT_COLUMNS = pickColumns('batting', ['avg', 'homeruns', 'obp', 'ops']);
const PITCHER_STAT_COLUMNS = pickColumns('pitching', ['era', 'wins', 'losses', 'outs', 'whip']);
function ShortStats({ player, columns }) {
  return (
    <span className="online-short-stats">
      {columns.map((column) => (
        <span key={column.id}>
          <small>{column.label}</small>
          {formatStat(column, column.get(player))}
        </span>
      ))}
    </span>
  );
}
const BatterStats = ({ player }) => <ShortStats player={player} columns={BATTER_STAT_COLUMNS} />;
const PitcherStats = ({ player }) => <ShortStats player={player} columns={PITCHER_STAT_COLUMNS} />;

/**
 * 采配の設定。⚠ **2〜5択はボタンを並べる**（以前はセレクトで区分を選び、
 * さらにセレクトを4つ選ぶ形で、開くまで何が変えられるか分からなかった）。
 */
const TACTIC_SECTIONS = [
  ['バント', ['sacrificeBunt', 'squeeze', 'safetyBunt']],
  ['代打・守備固め', ['pinchHit', 'pinchHitFrom', 'defensiveSub', 'defenseFrom']],
  ['先発の交代', ['hook', 'starterLimit']],
];
function TacticsEditor({ plan, change }) {
  return (
    <div className="online-tactics">
      <section>
        <h3>基本方針</h3>
        {Object.entries(STRATEGY_FIELDS).map(([key, [label, values]]) => (
          <div className="online-setting" key={key}>
            <span>{label}</span>
            <Segmented
              small
              label={label}
              value={plan.strategy?.[key] || Object.keys(values)[0]}
              options={values}
              onChange={(value) =>
                change({
                  ...plan,
                  strategy: { ...(plan.strategy || {}), [key]: value },
                })
              }
            />
          </div>
        ))}
      </section>
      {TACTIC_SECTIONS.map(([title, keys]) => (
        <section key={title}>
          <h3>{title}</h3>
          {keys.map((key) => {
            const [label, options] = TACTIC_FIELDS[key];
            return (
              <div className="online-setting" key={key}>
                <span>{label}</span>
                <Segmented
                  small
                  label={label}
                  value={plan.tactics?.[key] ?? TACTIC_DEFAULTS[key]}
                  options={options}
                  onChange={(value) =>
                    change({
                      ...plan,
                      tactics: {
                        ...(plan.tactics || {}),
                        [key]:
                          typeof TACTIC_DEFAULTS[key] === 'number'
                            ? Number(value)
                            : value,
                      },
                    })
                  }
                />
              </div>
            );
          })}
        </section>
      ))}
      <p className="online-muted">試合中の細かな判断はAIが行います。</p>
    </div>
  );
}

/**
 * 先発ローテーションと投手の役割
 * ⚠ 並べ替えは**つまみ（≡）のドラッグ**（↑↓キーでも動く）。以前は ↑↓ ボタンで
 *    1つずつしか動かせず、救援をエースと入れ替えるのに最大9回押していた。
 * ⚠ 救援から先発へは「何番手と入れ替えるか」を選ぶ（末尾に足すだけだと、また上へ動かす手間が出る）。
 */
function PitcherEditor({ view, plan, change, info }) {
  const [promoting, setPromoting] = useState(null);
  const pitchers = view.roster.filter(
    (p) => p.position === 'pitcher' && p.isActive !== false,
  );
  const rotation = plan.starters
    .map((id) => pitchers.find((p) => p.id === id))
    .filter(Boolean);
  const others = pitchers.filter((p) => !plan.starters.includes(p.id));
  const setStarters = (starters) => change({ ...plan, starters });
  const { rowProps, handleProps } = useReorder({
    count: rotation.length,
    onMove: (from, to) => setStarters(moveItem(rotation.map((p) => p.id), from, to)),
  });
  const role = (p, starter) => (
    <Segmented
      small
      label={`${p.name}の投手役割`}
      value={roleFor(plan.pitcherRoles?.[p.id], starter)}
      options={starter ? STARTER_ROLES : RELIEF_ROLES}
      onChange={(value) =>
        change({
          ...plan,
          pitcherRoles: { ...(plan.pitcherRoles || {}), [p.id]: value },
        })
      }
    />
  );
  const detail = (p) =>
    info === 'stats' ? <PitcherStats player={p} /> : <PitcherAbilities player={p} />;
  const promote = (p, slot) => {
    const ids = rotation.map((x) => x.id);
    if (slot === null) ids.push(p.id);
    else ids[slot] = p.id;
    setStarters(ids);
    setPromoting(null);
  };
  return (
    <div className="online-pitcher-editor">
      <h3>先発ローテーション（{rotation.length}人）</h3>
      <p className="online-muted">上から順に先発します。≡ をドラッグして並べ替え。</p>
      <ol className="online-order-list">
        {rotation.map((p, i) => (
          <li key={p.id} {...rowProps(i)}>
            <b className="online-order-no">{i + 1}</b>
            <span className="online-order-main">
              <PlayerStatsButton player={p} panel="abilities" />
              {detail(p)}
            </span>
            <span className="online-pick-state">
              <ConditionMark player={p} />
              <FatigueMark player={p} compact />
            </span>
            {role(p, true)}
            <span className="online-row-actions">
              <button
                aria-label={`${p.name}をローテから外す`}
                disabled={rotation.length <= 1}
                onClick={() => setStarters(plan.starters.filter((id) => id !== p.id))}
              >
                外す
              </button>
              <button {...handleProps(i, `${p.name}の順番を動かす`)}>≡</button>
            </span>
          </li>
        ))}
      </ol>
      <h3>救援（{others.length}人）</h3>
      <ul className="online-order-list">
        {others.map((p) => (
          <li key={p.id}>
            <span className="online-order-main">
              <PlayerStatsButton player={p} panel="abilities" />
              {detail(p)}
            </span>
            <span className="online-pick-state">
              <ConditionMark player={p} />
              <FatigueMark player={p} compact />
            </span>
            {role(p, false)}
            <span className="online-row-actions">
              <button
                aria-label={`${p.name}をローテに入れる`}
                onClick={() => setPromoting(p)}
              >
                先発へ
              </button>
            </span>
          </li>
        ))}
      </ul>
      {promoting && (
        <Sheet title={`${promoting.name}を先発に`} close={() => setPromoting(null)}>
          <h3>入れ替える先発（入れ替えた投手は救援に回ります）</h3>
          <ul className="online-pick-list">
            {rotation.map((p, i) => (
              <li key={p.id}>
                <button onClick={() => promote(promoting, i)}>
                  <span className="online-pick-name">
                    <b>
                      {i + 1}番手 {p.name}と入れ替え
                    </b>
                  </span>
                  <span className="online-pick-state">
                    <ConditionMark player={p} />
                    <FatigueMark player={p} compact />
                  </span>
                </button>
              </li>
            ))}
            {rotation.length < 8 && (
              <li>
                <button onClick={() => promote(promoting, null)}>
                  <span className="online-pick-name">
                    <b>{rotation.length + 1}番手として加える</b>
                    <small>ローテは最大8人</small>
                  </span>
                </button>
              </li>
            )}
          </ul>
        </Sheet>
      )}
    </div>
  );
}

// 疲れた野手を控えと入れ替える。⚠ 選び方はサーバーの「その日だけ休ませる」
// （`server/dailyLineup.mjs` の restTiredFielders）に揃える：守備適性60以上で、
// 疲労40未満の控えのうち、その位置を一番守れる人。守れる控えが居なければ休ませない。
const FRESH_FATIGUE = 40;
const MIN_FITNESS = 60;
export function restTiredPlan(plan, roster) {
  const used = new Set(plan.battingOrder.map((e) => e.playerId));
  const bench = roster.filter(
    (p) =>
      p.isActive !== false &&
      p.position !== 'pitcher' &&
      !used.has(p.id) &&
      (p.fatigue || 0) < FRESH_FATIGUE,
  );
  const swaps = [];
  const battingOrder = plan.battingOrder.map((entry) => {
    const player = roster.find((p) => p.id === entry.playerId);
    if (!player || (fatigueLevel(player) ?? 0) < 1) return entry;
    const fit = (p) =>
      p.position === entry.position ? 100 : getPositionFitness(p, entry.position, 0);
    const substitute = bench
      .filter((p) => fit(p) >= MIN_FITNESS)
      .sort((a, b) => fit(b) - fit(a) || (a.fatigue || 0) - (b.fatigue || 0))[0];
    if (!substitute) return entry;
    bench.splice(bench.indexOf(substitute), 1);
    swaps.push([player, substitute]);
    return { ...entry, playerId: substitute.id };
  });
  return { plan: { ...plan, battingOrder }, swaps };
}

// 「おすすめの打順」。⚠ CPUの球団が毎試合使う組み方（`setRecommendedLineup`）を
// 複製した名簿に当てて、野手の打順と守備位置だけを受け取る（先発ローテ・采配は変えない）。
// ⚠ 組めなかったとき（野手が8人に足りない・守備位置が重なる）は null を返し、打順は変えない。
//    サーバーは野手8人ちょうど・守備位置の重複なしでないと受け付けない
function recommendedPlan(view, plan) {
  try {
    const team = teamFromView({ ...view, lineup: plan });
    LEAGUE_SETTINGS.useDH = !!view.useDH;
    // ⚠ 球団名は渡さない。渡すと一人用の TEAMS_DATA のローテ位置を書き換える
    setRecommendedLineup(team, '__online_recommend__');
    const order = planFromTeam(team).battingOrder;
    const positions = new Set(order.map((e) => e.position));
    const players = new Set(order.map((e) => e.playerId));
    const valid =
      order.length === FIELD_POSITIONS.length &&
      positions.size === order.length &&
      players.size === order.length &&
      order.every((e) => FIELD_POSITIONS.includes(e.position));
    return valid ? { ...plan, battingOrder: order } : null;
  } catch {
    return null;
  }
}

const INFO_KEY = 'baseball-online-lineup-info';
function readInfo() {
  try {
    const value = localStorage.getItem(INFO_KEY);
    return value === 'stats' ? 'stats' : 'abilities';
  } catch {
    return 'abilities';
  }
}

/**
 * 打順・投手・采配の編集（スマホ・PC共用）。
 * ⚠ **自動で保存する**。以前は「編集→保存」の2段階で、↑↓を1回押しても
 *    「編成を保存」を押し忘れると反映されなかった。変更から1.2秒後にまとめて送り、
 *    保存したら「元に戻す」付きの通知を出す。
 * ⚠ 保存中も編集は止めない。送った内容と手元が違えば、次の保存でまた送る。
 * ⚠ 失敗した内容は繰り返し送らない（同じ内容のまま再送すると延々と失敗する）。
 * ⚠ 「取り消す」は通知とは別に**見出しに常に置く**（通知は6秒で消え、見逃すと戻せなかった）。
 * ⚠ 行には能力か今季成績を出す（切り替え）。以前のスマホは調子と疲労しか出ず、
 *    打順を考える材料が足りなかった。
 */
export function LineupPanel({
  view,
  mobile,
  busy,
  run,
  command,
  hidden = false,
  extraSections = [],
  renderExtra,
}) {
  const notify = useNotify();
  const [plan, setPlan] = useDraftState('lineup.plan', () =>
    structuredClone(view.lineup),
  );
  const [dirty, setDirty] = useDraftState('lineup.dirty', false);
  const [baseLineup, setBaseLineup] = useDraftState('lineup.base', () =>
    structuredClone(view.lineup),
  );
  // ⚠ 取り消しの履歴は下書き（sessionStorage）に入れない。30件ぶんで復元の上限（64KB）を超える
  const [history, setHistory] = useState([]);
  const [section, setSection] = useState('batting');
  const [info, setInfoState] = useState(readInfo);
  const setInfo = (value) => {
    setInfoState(value);
    try {
      localStorage.setItem(INFO_KEY, value);
    } catch {
      /* 覚えられなくても表示は切り替わる */
    }
  };
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const planRef = useRef(plan);
  planRef.current = plan;
  const failed = useRef(null);
  const [failedError, setFailedError] = useState('');
  const readOnly = !view.writable;
  useEffect(() => {
    if (!dirty) {
      setPlan(structuredClone(view.lineup));
      setBaseLineup(structuredClone(view.lineup));
    }
  }, [view.lineup, dirty, setPlan, setBaseLineup]);
  const save = async () => {
    const sent = planRef.current;
    const before = baseLineup;
    setSaving(true);
    const result = await run(async () => {
      await command('lineup', { ...sent, baseLineup }, { quiet: true });
    });
    setSaving(false);
    if (result.ok) {
      failed.current = null;
      setFailedError('');
      if (planRef.current === sent) setDirty(false);
      setBaseLineup(structuredClone(sent));
      notify('打順・起用を保存しました', {
        undo: () => {
          setHistory((h) => [...h, planRef.current].slice(-30));
          setPlan(structuredClone(before));
          setDirty(true);
        },
      });
    } else if (result.error !== '別の操作を処理中です') {
      failed.current = sent;
      setFailedError(result.error || '保存できませんでした');
    }
  };
  // 保存に失敗した下書きを捨てて、サーバーの最新の内容に戻す
  // （別の端末で先に保存された場合など。古い内容を基にしたままでは何度送っても弾かれる）
  const discardDraft = () => {
    failed.current = null;
    setFailedError('');
    setPlan(structuredClone(view.lineup));
    setBaseLineup(structuredClone(view.lineup));
    setHistory([]);
    setDirty(false);
  };
  // ⚠ **画面を離れても、待っている保存は捨てない**。変更から1.2秒以内に別のタブへ
  //    移ると、下の待ち時間ごと消えて、次の試合が古い打順のまま進んでいた。
  //    離れるときに、まだ送っていない変更があればその場で送る
  const saveRef = useRef(save);
  saveRef.current = save;
  const pendingRef = useRef(false);
  pendingRef.current = dirty && !readOnly && failed.current !== plan;
  useEffect(
    () => () => {
      if (pendingRef.current) saveRef.current();
    },
    [],
  );
  useEffect(() => {
    if (!dirty || busy || readOnly || failed.current === plan) return;
    const timer = setTimeout(save, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, dirty, busy, readOnly]);
  const change = (next) => {
    if (next.starters && next.starters !== plan.starters && next.pitcherRoles) {
      next = {
        ...next,
        pitcherRoles: Object.fromEntries(
          Object.entries(next.pitcherRoles).map(([id, role]) => [
            id,
            roleFor(
              role,
              next.starters.some((x) => String(x) === id),
            ),
          ]),
        ),
      };
    }
    failed.current = null;
    setHistory((h) => [...h, plan].slice(-30));
    setPlan(next);
    setDirty(true);
  };
  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    failed.current = null;
    setHistory(history.slice(0, -1));
    setPlan(previous);
    setDirty(true);
  };
  const order = [...plan.battingOrder].sort(
    (a, b) => a.battingOrder - b.battingOrder,
  );
  const { rowProps, handleProps } = useReorder({
    count: order.length,
    disabled: readOnly,
    onMove: (from, to) =>
      change({
        ...plan,
        battingOrder: moveItem(order, from, to).map((e, j) => ({
          ...e,
          battingOrder: j + 1,
        })),
      }),
  });
  const rest = restTiredPlan(plan, view.roster);
  const applyRest = () => {
    change(rest.plan);
    notify(
      `${rest.swaps.map(([out, sub]) => `${out.name}→${sub.name}`).join('、')} に入れ替えました`,
    );
  };
  const applyRecommended = () => {
    const next = recommendedPlan(view, plan);
    if (!next) {
      notify('おすすめの打順を組めませんでした（守れる野手が足りません）');
      return;
    }
    change(next);
    notify('おすすめの打順・守備位置にしました（「取り消す」で戻せます）');
  };
  const starter = view.roster.find(
    (p) => p.id === (view.nextStarterId ?? plan.starters[0]),
  );
  const sections = [
    ['batting', '打順・守備'],
    ['pitchers', '投手'],
    ['tactics', '采配'],
    ...extraSections,
  ];
  return (
    <section
      className={`online-card online-lineup-card ${mobile ? 'is-mobile' : ''}`}
      hidden={hidden}
    >
      <div className="online-card-heading">
        <Segmented
          label="編成の区分"
          value={section}
          options={sections}
          onChange={setSection}
        />
        <span className="online-save-tools">
          {!readOnly && (
            <button
              className="online-link"
              disabled={!history.length}
              onClick={undo}
              aria-label="直前の変更を取り消す"
            >
              ↶ 取り消す
            </button>
          )}
          <span className="online-save-state" role="status">
            {readOnly
              ? '閲覧のみ'
              : saving
                ? '保存中…'
                : dirty
                  ? failed.current === plan
                    ? '保存できませんでした'
                    : '● 未保存'
                  : '保存済み'}
          </span>
        </span>
      </div>
      {failedError && dirty && failed.current === plan && (
        <div role="alert" className="online-alert">
          <span>保存できませんでした：{failedError}</span>
          {/* 通信の一時的な失敗なら、同じ内容をもう一度送れば済む */}
          <button
            className="online-link"
            disabled={busy || readOnly}
            onClick={() => {
              failed.current = null;
              setFailedError('');
              save();
            }}
          >
            もう一度保存する
          </button>
          <button className="online-link" onClick={discardDraft}>
            編集を捨てて最新の内容に戻す
          </button>
        </div>
      )}
      {(section === 'batting' || section === 'pitchers') && (
        <div className="online-lineup-toolbar">
          <Segmented
            small
            label="行に出す情報"
            value={info}
            options={[
              ['abilities', '能力'],
              ['stats', '今季成績'],
            ]}
            onChange={setInfo}
          />
          {section === 'batting' && !readOnly && (
            <span className="online-lineup-actions">
              {rest.swaps.length > 0 && (
                <button onClick={applyRest}>
                  疲れた野手を休ませる（{rest.swaps.length}人）
                </button>
              )}
              <button onClick={applyRecommended}>おすすめの打順にする</button>
            </span>
          )}
        </div>
      )}
      {section === 'batting' && (
        <>
          <p className="online-muted">
            行を押すと打順の入れ替え・守備位置・控えとの交代。≡ をドラッグしても並べ替えられます。
            疲労80以上の野手は、その日だけ自動で控えと入れ替わります。
          </p>
          <ol className="online-order-list is-batting">
            {order.map((entry, i) => {
              const player = view.roster.find((p) => p.id === entry.playerId) || {};
              return (
                <li key={entry.playerId} {...rowProps(i)}>
                  <b className="online-order-no">{entry.battingOrder}</b>
                  <button
                    className="online-order-main"
                    disabled={readOnly}
                    onClick={() => setEditing(entry.playerId)}
                    aria-label={`${entry.battingOrder}番 ${player.name}を変更`}
                  >
                    {/* ⚠ 調子・疲労は名前の横に置く。右端の列にすると、スマホで
                        成績を出す幅が足りずに折り返していた */}
                    <span className="online-order-line">
                      <span className="online-pos">{POS[entry.position]}</span>
                      <span className="online-order-name">{player.name}</span>
                      <ConditionMark player={player} />
                      <FatigueMark player={player} compact />
                    </span>
                    {info === 'stats' ? (
                      <BatterStats player={player} />
                    ) : (
                      <FielderAbilities player={player} />
                    )}
                  </button>
                  <span className="online-row-actions">
                    <button {...handleProps(i, `${entry.battingOrder}番 ${player.name}の打順を動かす`)}>
                      ≡
                    </button>
                  </span>
                </li>
              );
            })}
            {/* ⚠ DHなしのリーグなので9番は投手。以前は8番までしか並ばなかった */}
            {!view.useDH && (
              <li className="is-pitcher-slot">
                <b className="online-order-no">9</b>
                <span className="online-order-main">
                  <span className="online-order-line">
                    <span className="online-pos">投</span>
                    <span className="online-order-name">
                      {starter ? `${starter.name}（予告先発）` : '先発投手'}
                    </span>
                    {starter && <FatigueMark player={starter} compact />}
                  </span>
                </span>
                <span className="online-row-actions" />
              </li>
            )}
          </ol>
        </>
      )}
      {section === 'pitchers' && (
        <fieldset className="online-form-fields" disabled={readOnly}>
          <PitcherEditor view={view} plan={plan} change={change} info={info} />
        </fieldset>
      )}
      {section === 'tactics' && (
        <fieldset className="online-form-fields" disabled={readOnly}>
          <TacticsEditor plan={plan} change={change} />
        </fieldset>
      )}
      {extraSections.some(([id]) => id === section) && renderExtra?.(section)}
      {editing && (
        <BatterSheet
          playerId={editing}
          plan={plan}
          view={view}
          change={change}
          follow={setEditing}
          close={() => setEditing(null)}
        />
      )}
    </section>
  );
}
