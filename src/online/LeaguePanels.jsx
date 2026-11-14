import React, { useContext, useEffect, useRef, useState } from 'react';
import SeasonFlow from './SeasonFlow.jsx';
import OffseasonGrowth from './OffseasonGrowth.jsx';
import MobileTactics from './MobileTactics.jsx';
import TapLineup, { useTapLineup } from './TapLineup.jsx';
import {
  rebaseLineupParts,
  LINEUP_BOARD_KEYS,
  TACTICS_EDITOR_KEYS,
} from './lineupBridge.js';
import { roleFor } from './tactics.js';
import { useDraftState, phaseDraftName } from './Drafts.jsx';
import GameHistory, { GameRecordButton } from './GameHistory.jsx';
import {
  decisionText,
  formatRate,
  ownOutcome,
  teamShort,
  teamLabel,
  teamNameParts,
} from './gameText.js';
import { api, POS } from './api.js';
import {
  turnLabel,
  PHASE_LABELS,
  sameEditState,
  ROSTER_LIMIT,
} from './shared.js';
import { PlayerStatsButton } from './PlayerPerformance.jsx';
import TeamLineupButton from './TeamLineup.jsx';
import { PageNav } from './PageNav.jsx';
import { Page } from './Page.jsx';
import TryoutPlanner from './TryoutPlanner.jsx';
import TryoutResult from './TryoutResult.jsx';
import { plannedPicks, signTotal } from './tryoutPlan.js';
import PackSelect, { TeamIdentity } from './PackSelect.jsx';
import { packWaiting, phaseStatusLabel } from './notices.js';
import { ReadContext } from './useRead.js';
import CampPlanner from './CampPlanner.jsx';
import ContractPlanner from './ContractPlanner.jsx';
import {
  PYRAMID_LEAGUES,
  PROMOTION_PLACES,
  RELEGATION_FROM_BOTTOM,
  compareLeagueStanding,
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
export function JoinLeague({ busy, join, logout }) {
  return (
    <section className="online-card online-login">
      <p className="online-eyebrow">JOIN</p>
      <h1>リーグに参加する</h1>
      {/* ⚠ **ここでは名前を聞かない**。始める手順は
          「参加する → セットを選ぶ → 球団名とプレイヤー名 → 決定」で、
          名前はセットの下で決める。2か所で聞くと、どちらが効くのか分からない */}
      <p>
        空いている球団のうち、下の階層で一番弱いものを引き継ぎます。
        このあと初期メンバーのセットを選び、球団名とプレイヤー名を決めます。
      </p>
      <button
        className="online-primary"
        disabled={busy}
        onClick={() => join({})}
      >
        参加する
      </button>
      <button disabled={busy} onClick={logout}>
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
      <p>参加者みんなで育てる独立リーグ。留守の間も、ペナントは少しずつ進みます。</p>
      {local ? (
        <div className="online-actions">
          <button disabled={busy} onClick={() => login({ user: 'player1' })}>
            プレイヤー1で入る
          </button>
          <button disabled={busy} onClick={() => login({ user: 'player2' })}>
            プレイヤー2で入る
          </button>
        </div>
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
/** 順位表の印（「M3」「昇格決定」など）。マジックはサーバーが数える（`leagueRaces`） */
function raceTag(races, team) {
  const r = (races || []).find((x) => x.team === team);
  if (!r) return null;
  const done = { first: '1位決定', promotion: '昇格決定', survive: '残留決定', relegated: '降格決定' };
  const magic = { first: '1位', promotion: '昇格', survive: '残留' };
  return r.clinched ? done[r.kind] : `${magic[r.kind]}M${r.magic}`;
}
/**
 * 順位表。部ごとに分け、昇格・降格の線を引く。
 * ⚠ **`view.standings` は全球団を通した並び**。1部と2部を混ぜたまま出すと、
 *    2部の首位が表の1位に見えて「優勝争い」と取り違える（実測で起きた）。
 *    `teamLeagues` が無い古いビューでは従来どおり1つの表で出す。
 */

/**
 * その部でいちばん良い値（打率は大きい方、防御率は小さい方）。
 * ⚠ 値の無い球団（開幕前）は数えない。全球団が「—」のときは `null`。
 */
function bestOf(rows, pick, lowerIsBetter = false) {
  const list = rows.map(pick).filter((v) => v != null);
  if (!list.length) return null;
  return lowerIsBetter ? Math.min(...list) : Math.max(...list);
}

export function Standings({ view }) {
  const leagues = view.teamLeagues
    ? PYRAMID_LEAGUES.map((league) => ({
        league,
        rows: view.standings
          .filter((s) => view.teamLeagues[s.team] === league.id)
          .sort(compareLeagueStanding),
      })).filter((group) => group.rows.length)
    : [{ league: null, rows: view.standings }];
  return (
    <section className="online-card">
      <h2>リーグ順位</h2>
      {leagues.map(({ league, rows }) => {
        // ⚠ 最良の印は**その部の中**で比べる（1部と2部を通すと、2部の表に
        //    印がひとつも付かない）
        const bestAverage = bestOf(
          rows,
          (r) => view.teamStats?.[r.team]?.average ?? null,
        );
        const bestEra = bestOf(
          rows,
          (r) => view.teamStats?.[r.team]?.era ?? null,
          true,
        );
        return (
        <table key={league?.id || 'all'} className="online-standings">
          {league && <caption>{league.name}</caption>}
          <thead>
            <tr>
              <th>球団</th>
              <th>勝</th>
              <th>敗</th>
              <th>分</th>
              <th>勝率</th>
              {/* ⚠ チーム打率・チーム防御率は**サーバーが選手成績から足し上げる**
                  （`teamSeasonStats`）。順位表は勝敗しか持っていない */}
              <th>打率</th>
              <th>防</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const up = league && league.up.length && i < PROMOTION_PLACES[0];
              const down =
                league &&
                league.down.length &&
                i >= rows.length - RELEGATION_FROM_BOTTOM[0];
              const race = raceTag(view.races, s.team);
              const stats = view.teamStats?.[s.team];
              return (
                <tr
                  key={s.team}
                  className={[
                    s.team === view.teamName ? 'online-own online-own-text' : '',
                    up ? 'is-promotion' : '',
                    down ? 'is-relegation' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <th>
                    {/* ⚠ 順位は**バッジ**にする（中継の順位表と同じ見え方）。
                        1位・2位・3位で色を変え、表彰台が一目で分かるように */}
                    <span
                      className={`online-rank${
                        i < 3 ? ` is-podium is-podium-${i + 1}` : ''
                      }`}
                    >
                      {i + 1}
                    </span>
                    {/* 球団名を押すと、その球団のスタメンと投手陣を開く（先方要望 2026-11） */}
                    <TeamLineupButton view={view} team={s.team} />
                    {/* ⚠ 人が持っている球団だけ、名前を括弧で添える。
                        CPUに付けると誰かが持っているように見える。
                        呼び名が球団名と同じときはサーバーが空で返す */}
                    {view.teamOwners &&
                      Object.hasOwn(view.teamOwners, s.team) && (
                        <small
                          className="online-owner"
                          // オーナーのひとこと（ホームの「オーナーたち」にも出す）
                          title={
                            view.members?.find((m) => m.teamName === s.team)?.comment ||
                            undefined
                          }
                        >
                          （{view.teamOwners[s.team] || 'プレイヤー'}）
                        </small>
                      )}
                    {up ? <small className="online-move">昇格圏</small> : null}
                    {down ? (
                      <small className="online-move">降格圏</small>
                    ) : null}
                    {race && <small className="online-move is-race">{race}</small>}
                  </th>
                  <td className="is-win">{s.wins}</td>
                  <td className="is-loss">{s.losses}</td>
                  <td className="online-muted">{s.draws || 0}</td>
                  {/* ⚠ 勝率のセルの後ろに**横棒**を敷く（中継の順位表と同じ。
                      数字を読まなくても差が見える）。5割を真ん中にすると
                      ほとんどの球団が同じ長さになるので、.300〜.700 を
                      セル幅いっぱいに割り当てる */}
                  <td
                    className="online-standings-rate"
                    style={{
                      '--rate': `${Math.max(
                        0,
                        Math.min(100, ((s.winRate || 0) - 0.3) * 250),
                      )}%`,
                    }}
                  >
                    {formatRate(s.winRate)}
                  </td>
                  {/* ⚠ 打席・投球回が0なら「—」。開幕前は全球団がこれ */}
                  <td
                    className={
                      stats?.average != null && stats.average === bestAverage
                        ? 'is-best'
                        : undefined
                    }
                  >
                    {stats?.average != null ? formatRate(stats.average) : '—'}
                  </td>
                  <td
                    className={
                      stats?.era != null && stats.era === bestEra
                        ? 'is-best'
                        : undefined
                    }
                  >
                    {stats?.era != null ? stats.era.toFixed(2) : '—'}
                  </td>
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

export function Results({ view, compact = false }) {
  const [mode, setMode] = useState('results');
  const [page, setPage] = useState(0);
  const [scope, setScope] = useState(compact ? 'own' : 'league');
  const all = mode === 'results' ? [...view.results].reverse() : view.upcoming;
  const list =
    scope === 'own'
      ? all.filter(
          (game) => game.home === view.teamName || game.away === view.teamName,
        )
      : all;
  // ⚠ PCは1日ぶん（リーグ全体なら6試合）を1ページにする
  const size = compact ? 2 : 6;
  const scopes = [
    ['own', '自球団'],
    ['league', 'リーグ全体'],
  ];
  return (
    <section className="online-card online-results">
      <div className="online-card-heading">
        <h2>試合</h2>
        {compact ? (
          <select
            aria-label="試合の表示範囲"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
              setPage(0);
            }}
          >
            {scopes.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          // ⚠ PCは切り替えをボタンで並べる（ほかのページの切り替えと同じ形）
          <div className="online-segments" role="group" aria-label="試合の表示範囲">
            {scopes.map(([id, label]) => (
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
        )}
      </div>
      <div className="online-segments">
        {[
          ['results', '結果'],
          ['upcoming', '日程'],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={mode === id}
            onClick={() => {
              setMode(id);
              setPage(0);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="online-score-list">
      {list.length ? (
        list.slice(page * size, page * size + size).map((g) => {
          const outcome = mode === 'results' && ownOutcome(g, view.teamName);
          const decisions = decisionText(g.decisions);
          // ⚠ PCは正式名を**都市と愛称の間で**折る（`teamNameParts`）。字の途中で折ると
          //    「姫路シー／ホース」と愛称が割れていた（再監査 F18）。スマホは略称
          const name = (team) =>
            compact
              ? teamShort(team)
              : teamNameParts(team).map((part, i) => (
                  <span className="online-team-part" key={i}>
                    {part}
                  </span>
                ));
          return (
            <article className="online-score" key={g.gameId || g.id}>
              <header>
                {/* ⚠ 日付ではなくターン。オンラインはターンで進む */}
                <small>{turnLabel(g.date)}</small>
                {outcome && (
                  <span className={`online-outcome is-${outcome.tone}`}>
                    {outcome.mark}
                  </span>
                )}
                {mode === 'results' && view.gameDetailsAvailable && (
                  <GameRecordButton
                    game={g}
                    year={view.year}
                    ownTeam={view.teamName}
                  />
                )}
              </header>
              <div>
                <span title={teamLabel(g.away)}>{name(g.away)}</span>
                {/* ⚠ 日程の対戦は「vs」を小さく薄く出す。以前の大きな白い「×」は、
                    野球の表では負け・中止の印に読めた */}
                {mode === 'results' ? (
                  <strong>{`${g.awayScore} – ${g.homeScore}`}</strong>
                ) : (
                  <em className="online-score-vs">vs</em>
                )}
                <span title={teamLabel(g.home)}>{name(g.home)}</span>
              </div>
              {decisions && (
                <small className="online-score-decisions">{decisions}</small>
              )}
            </article>
          );
        })
      ) : (
        <p className="online-empty">
          {mode === 'results'
            ? '試合結果はまだありません。'
            : '今後の試合予定はありません。'}
        </p>
      )}
      </div>
      <PageNav page={page} count={list.length} size={size} setPage={setPage} />
      {view.gameDetailsAvailable && <GameHistory view={view} />}
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
  // ⚠ **消さないこと**。オンラインではもうドラフトを行わないが、外す前の年度の
  //    お知らせが保存に残っている。消すと、その年だけ「お知らせ」になる
  draft: 'NPBドラフト',
  tryout: 'トライアウト',
  promotion: '昇格・降格',
  trade: 'トレード',
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

export function Notices({ view, compact = false }) {
  const [selected, setSelected] = useState('notice:0');
  const [page, setPage] = useState(0);
  const [kind, index] = selected.split(':');
  const notice = view.notices[Number(index)];
  const history = view.history[Number(index)];
  const picks = kind === 'notice' ? noticeItems(notice) : [];
  const label = compact ? teamShort : teamLabel;
  const size = 8;
  useEffect(() => {
    if (!view.notices.length && !view.history.length) return;
    if ((kind === 'notice' && !notice) || (kind === 'history' && !history)) {
      setSelected(view.notices.length ? 'notice:0' : 'history:0');
      setPage(0);
    }
  }, [kind, notice, history, view.notices.length, view.history.length]);
  return (
    <section className="online-card">
      <h2>リーグ便り</h2>
      {view.notices.length + view.history.length ? (
        <>
          <label className="online-sr-only" htmlFor="online-news-select">
            見るお知らせ
          </label>
          <select
            id="online-news-select"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setPage(0);
            }}
          >
            {view.notices.map((n, i) => (
              <option key={`n:${i}`} value={`notice:${i}`}>
                {n.year}年 {NOTICE_LABELS[n.type] || 'お知らせ'}
                （{noticeItems(n).length}
                {n.type === 'promotion' ? '球団' : '人'}）
              </option>
            ))}
            {view.history.map((h, i) => (
              <option key={`h:${i}`} value={`history:${i}`}>
                {h.year}年の最終順位
              </option>
            ))}
          </select>
          {kind === 'notice' ? (
            <>
              <div
                className={`online-news-list ${compact ? 'is-compact' : ''}`}
              >
                {picks.slice(page * size, page * size + size).map((p, j) =>
                  notice?.type === 'promotion' ? (
                    <article key={j}>
                      <b>{label(p.teamId)}</b>
                      <span>
                        {leagueName(p.from)} → {leagueName(p.to)}
                        {isPromotion(p) ? '（昇格）' : '（降格）'}
                      </span>
                    </article>
                  ) : (
                    <article key={j}>
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
        <p>リーグの動きがここに届きます。</p>
      )}
    </section>
  );
}

/**
 * 途中参加した人の初期メンバー選択。
 *
 * ⚠ **リーグ全体の手続きではない**。締め切りも全員の決定も関係しないので、
 *    選んだ時点で保存する（`pack` 命令）。
 * ⚠ 名簿に入るのは**次のキャンプ**。それまで球団はCPUが動かす。
 *    画面にそう書くこと——書かないと「選んだのに選手が変わらない」と見える。
 */
/**
 * 途中参加した人の球団が、選んだセットで始まる日時の文。
 * 「11/9(月) 0:00 の開幕から」。キャンプの前なら見込みなので「（予定）」を付ける。
 */
export function packStartText(waiting) {
  if (!waiting?.joinsAt) return '次のキャンプが終わった後の開幕から';
  return `${formatDeadline(waiting.joinsAt)} の開幕から${waiting.estimated ? '（予定）' : ''}`;
}

export function PendingPackPanel({ view, busy, run, command, mobile, setTab }) {
  // 選び終えた後に「セットを選び直す」を押したか
  const [choosing, setChoosing] = useState(false);
  const pending = view.pendingPack;
  if (!pending) return null;
  const waiting = packWaiting(view);
  // ⚠ **選び終えたら「参加の準備ができました」に切り替える**。以前は選んだ後も
  //    セットの一覧がそのまま残り、変わるのは上の一文と「保存しました」だけだった。
  //    いしだが実際に「決めた後も画面がそのまま」と止まったと思った。
  //    選び直しはキャンプまでできるので、一覧は「セットを選び直す」で開く
  if (waiting && !choosing) {
    const body = (
      <>
        <dl className="online-join-ready">
          <div>
            <dt>初期メンバー</dt>
            <dd>
              「{waiting.packName}」
              {waiting.feature && <small>{waiting.feature}</small>}
            </dd>
          </div>
          <div>
            <dt>あなたの球団になる日</dt>
            <dd>{packStartText(waiting)}</dd>
          </div>
        </dl>
        {/* ⚠ 日本語の文は JSX の中で改行しない（改行が空白になって「それまでは 引き継いだ」と出る） */}
        <p className="online-muted">
          {'選んだ24人は、キャンプが終わった時点で名簿に入ります。' +
            'それまでは引き継いだ選手でCPUが戦い、ストーブリーグとキャンプの手続きもCPUが決めます。' +
            'トレードもそれまではできません。セットはキャンプが終わるまで選び直せます。'}
        </p>
        <TeamIdentity view={view} busy={busy} run={run} command={command} />
        <div className="online-actions">
          {setTab && (
            <button className="online-primary" onClick={() => setTab('today')}>
              ホームへ
            </button>
          )}
          <button disabled={busy} onClick={() => setChoosing(true)}>
            セットを選び直す
          </button>
        </div>
      </>
    );
    if (!mobile)
      return (
        <Page title="初期メンバー選択" sub="参加の準備ができました。">
          <section className="online-card online-decision">{body}</section>
        </Page>
      );
    return (
      <section className="online-card online-decision">
        <h2>参加の準備ができました</h2>
        {body}
      </section>
    );
  }
  const chosen = pending.packs.find((p) => p.id === pending.chosen);
  const status = chosen
    ? `いま選んでいるのは「${chosen.name}」です。キャンプまでは何度でも選び直せます。`
    : 'まだ選んでいません。決めずにキャンプを迎えると、1つ目のセットになります。';
  const body = (
    <>
      {/* ⚠ PCは「20セットから1つ選びます」をセットの一覧の説明に任せる（2回出さない） */}
      <p>
        {mobile && '20セットから1つ選びます。'}
        {'選んだ24人は'}
        <strong>キャンプが終わった時点で名簿に入り</strong>
        {`、${packStartText({ joinsAt: pending.joinsAt, estimated: !pending.joinsInCamp })}あなたの球団になります。` +
          'それまでは引き継いだ選手でCPUが戦い、ストーブリーグとキャンプの手続きもCPUが決めます。'}
      </p>
      {mobile && <p className="online-muted">{status}</p>}
      {waiting && (
        <div className="online-actions">
          <button disabled={busy} onClick={() => setChoosing(false)}>
            選び直さずに戻る
          </button>
        </div>
      )}
      <PackSelect
        packs={pending.packs}
        plan={{ packId: pending.chosen }}
        busy={busy}
        view={view}
        run={run}
        command={command}
        onChange={(next) =>
          run(async () => {
            await command('pack', { packId: next.packId });
            setChoosing(false);
          })
        }
      />
    </>
  );
  // ⚠ PCはほかのページと同じ枠（見出し・補足はページの上）
  if (!mobile)
    return (
      <Page title="初期メンバー選択" sub={status}>
        <section className="online-card online-decision">{body}</section>
      </Page>
    );
  return (
    <section className="online-card online-decision">
      <h2>初期メンバー選択</h2>
      {body}
    </section>
  );
}

/** セットの構成の書き方（`PackSelect` のカードと同じ） */
const PACK_GROUPS = [
  ['pitcher', '投'],
  ['catcher', '捕'],
  ['infield', '内'],
  ['outfield', '外'],
];
/**
 * スマホの手続きで「この内容」を見せる（変えるのは下のボタンで開く編集。`PhasePanel`）。
 * ⚠ 以前は「初期メンバー: セット3」「退団予定 3人」「5人を獲得する希望リスト（119候補）」の
 *    1行だけで、どんなセットか・誰を出すのか・誰を取るのかを見ないまま「この内容で決定」を
 *    押せた（u1 高4）。選手の名前は押すと能力が見られる（`PlayerStatsButton`）
 * ⚠ トライアウトは希望順の上からではなく**実際に取る顔ぶれ**（`plannedPicks`。PCの
 *    「獲得予定」とサーバーと同じ決め方）
 */
function MobilePlanContents({ phase, plan, view }) {
  let head;
  let note = '';
  let players = [];
  if (plan.packId !== undefined) {
    const pack = phase.packs?.find((p) => p.id === plan.packId);
    head = pack ? `初期メンバー「${pack.name}」` : '初期メンバー: 未選択';
    if (pack)
      note = [
        pack.feature,
        PACK_GROUPS.map(([key, label]) => `${label}${pack.counts?.[key] ?? 0}`).join(' '),
        pack.averageAge !== undefined && `平均${pack.averageAge}歳`,
        pack.twoWay !== undefined && `二刀流${pack.twoWay}`,
      ]
        .filter(Boolean)
        .join(' · ');
  } else if (plan.rankedIds) {
    players = plannedPicks(
      plan.rankedIds,
      phase.candidates || [],
      Math.min(plan.count, plan.rankedIds.length),
      view.roster,
    );
    // 獲得する人数（`signTotal`。決めていなければ空き枠いっぱい）
    const total = signTotal(plan, Math.max(0, ROSTER_LIMIT - view.roster.length));
    const autoFill = Math.max(0, total - players.length);
    head = `獲得する人数 ${total}人`;
    note = `交渉した${plan.rankedIds.length}人から${players.length}人${
      autoFill ? `＋自動で${autoFill}人` : ''
    }。他球団と重なったら下位が繰り上がります。`;
  } else if (plan.releaseIds) {
    const byId = new Map(view.roster.map((p) => [p.id, p]));
    players = plan.releaseIds.map((id) => byId.get(id)).filter(Boolean);
    head = `退団させる選手 ${plan.releaseIds.length}人`;
    if (!plan.releaseIds.length) note = '全員と来季も契約します。';
  } else return <p>シーズンを締めて次年度へ進みます。</p>;
  return (
    <div className="online-phase-contents">
      <p>
        <strong>{head}</strong>
        {note && <small>{note}</small>}
      </p>
      {players.length > 0 && (
        <ul>
          {players.map((p) => (
            <li key={p.id}>
              <PlayerStatsButton player={p} panel="abilities" />
              <small>{`${POS[p.position] || ''} · ${p.age}歳`}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PhasePanel({ view, auth, busy, run, command, mobile, setTab }) {
  const phase = view.phase;
  const [plan, setPlan] = useDraftState(
    phaseDraftName(phase.id, 'plan'),
    phase.submission?.plan || null,
  );
  const [dirty, setDirty] = useDraftState(phaseDraftName(phase.id, 'dirty'), false);
  const [planRevision, setPlanRevision] = useState(null);
  const [baseSubmission, setBaseSubmission] = useDraftState(phaseDraftName(phase.id, 'base'), () =>
    structuredClone(phase.submission || null),
  );
  const [error, setError] = useState('');
  // スマホの「この内容で決定」の確認を開いているか（下の `mobile` の枝）
  const [confirming, setConfirming] = useState(false);
  // スマホでPCと同じ編集を開いているか（下の `mobile` の枝）
  const [editing, setEditing] = useState(false);
  // 初期メンバー選択で、いま中身を見ているセット（`PackSelect` の `onShow`）
  const [viewedPack, setViewedPack] = useState(null);
  // 標準案は覚えを通して読む（`readCache.js`。版が同じ間は取りに行かない）。
  // ⚠ 覚えた答えを編集で書き換えないよう、受け取った案は写してから使う
  const read = useContext(ReadContext);
  const loadDefaults = async () =>
    structuredClone(await (read ? read('defaults', {}) : api('defaults', auth)));
  // ⚠ **キャンプでは標準案を取りに行かない**。キャンプは1クールずつその場で実行する形で、
  //    提出する案が無い（`CampPlanner` は `view.phase.camp` を見る）。以前はスマホで手続きを
  //    開くたびに、使わない標準案を取りに行っていた（世界を読むので重い）
  const needsPlan = phase.kind !== 'camp';
  // ⚠ 標準案を出す人（任せ方）が変わったら取り直す。PCとスマホは画面を移ると作り直すので
  //    ふだんはそれで取り直すが、ほかの端末で任せ方を変えたときは開いたまま変わる
  const planBy = phase.planBy ? `${phase.planBy.mode}:${phase.planBy.by}` : 'self';
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // ⚠ **指導者に任せた手続き（トライアウト・契約更改）は、指導者の案を読むだけで見せる**
  //    （再監査 B4）。サーバーは任せた手続きを提出があっても指導者の案で決める
  //    （`leagueEngine` の `resolvePhase`）。以前は編集・「この内容で決定」・確認がそのまま出て、
  //    「決定しました」と出るのに案は使われなかった。キャンプは `CampPlanner` が受け持つ
  //    （自分でクールを回すと任せ方は「意見を聞く」に戻る）ので、ここでは扱わない。
  // ⚠ 見せる案は**下書きとは別に持つ**（`coachPlan`）。任せる前に編集していた下書きは、
  //    「意見を聞く」に戻したときにそのまま続きから使えるよう残す
  const delegated = needsPlan && !!phase.delegated;
  const [coachPlan, setCoachPlan] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (needsPlan && (delegated || !phase.submission))
      loadDefaults()
        .then((d) => {
          if (!cancelled) {
            if (d.phaseId !== phase.id) {
              setError('手続きが更新されました。最新状態を確認してください');
              return;
            }
            setError('');
            if (delegated) {
              setCoachPlan(d.plan);
              return;
            }
            // ⚠ **編集していなければ、取り直した標準案で置き換える**。以前は一度下書きに入った
            //    案を残していて（`old || d.plan`）、手続きを開いたあとに任せ方を変えると
            //    （監督の案 → 自分で、など）前の人の案が「標準案です。」のまま残り、そのまま
            //    決定できた（再監査 B2）。提出が無く編集もしていない下書きは、前に取った標準案
            setPlan((old) => (old && dirtyRef.current ? old : d.plan));
            setPlanRevision(d.revision);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [auth, phase.id, phase.submission, needsPlan, planBy, delegated]);
  const submissionChanged = !sameEditState(
    baseSubmission,
    phase.submission || null,
  );
  useEffect(() => {
    if (mobile && submissionChanged && !dirty) {
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
  const submit = (ready) =>
    run(async () => {
      await command('submit', {
        phaseId: phase.id,
        plan,
        ready,
        baseSubmission,
      });
      setBaseSubmission({ plan: structuredClone(plan), ready });
      setDirty(false);
    });
  const resetSubmission = () =>
    run(async () => {
      setError('');
      try {
        let next = phase.submission?.plan;
        if (!next) {
          const defaults = await loadDefaults();
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
        const defaults = await loadDefaults();
        if (defaults.phaseId !== phase.id)
          throw new Error('手続きが更新されました。最新状態を確認してください');
        setPlan(structuredClone(defaults.plan));
        setDirty(!!phase.submission);
      } catch (error) {
        setError(error.message);
        throw error;
      }
    });
  // ⚠ **キャンプは文面が別**。提出して待つものではなく、その場で1クールずつ
  //    実行する。「下書き」「決定」の言い方をすると、何を押せば進むのか
  //    分からなくなる
  // ⚠ **締め切りの日時はここに書かない**。1年の流れの帯（`SeasonFlow`）が「いまは○○
  //    （締め切り …）」と出し、PCはページの見出しの下・キャンプは `CampPlanner` の見出しの
  //    横にも出している。ここにも書くと同じ日時が1画面に3回並んでいた。ここは決まりだけ
  const rulesText =
    phase.kind === 'camp'
      ? phase.deadline
        ? '全員が4クール終えた時点で次へ進みます（指導者に任せた球団は待ちません）。締め切りまでに終わらなかったぶんは、最後に指示した内容で自動で行われます。'
        : '全員が4クール終えると次へ進みます（指導者に任せた球団は待ちません）。'
      : phase.deadline
    ? mobile
      ? '全員が決定するか、締め切りで進みます。'
      : '全員が決定した時点で処理します（指導者に任せた球団は待ちません）。締め切りを過ぎると、未決定の球団は保存した下書き（無ければ標準案）で進みます。ほかに検討中の球団がいる間は、決定後も出し直せます。'
    : mobile
      ? '全員が決定すると進みます。'
      : '全員が決定した時点で処理します（指導者に任せた球団は待ちません）。この手続きに締め切りはありません。ほかに検討中の球団がいる間は、決定後も出し直せます。';
  // 標準案を出した指導者（「山田監督の案です」）と、キャンプでの指導者の入れ替え。
  // ⚠ 文はサーバーが作る（`projection.mjs` の `phasePlanBy`）
  // ⚠ **キャンプのぶんは出さない**。キャンプはPCではホームに出していて
  //    ここを通らないので、`CampPlanner` が自分で出す（スマホもそれを通る）。
  //    ここでも出すと、スマホだけ同じ文が2回並ぶ
  // ⚠ **出すのは、出ている案が指導者の案のままの間だけ**（変えていない・保存も決定も
  //    していない）。自分で入れ替えて決定したあとも「照屋監督の案です。変えてから決定
  //    できます」が残り、決定した中身が指導者の案に読めた（再監査 F18）
  const staffNote = phase.kind !== 'camp' &&
    phase.planBy &&
    !dirty &&
    !phase.submission && (
      <p className="online-staff-note">{phase.planBy.text}</p>
    );
  const readyList = (
    <ul className="online-ready">
      {view.members.map((m) => (
        <li key={m.teamName} data-ready={m.ready || undefined}>
          {/* ⚠ 参加者が付けた球団名を出す。`label` は作成時の呼び名のまま */}
          {teamLabel(m.teamName)} · {phaseStatusLabel(m)}
        </li>
      ))}
    </ul>
  );
  const alerts = (
    <>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button onClick={resetSubmission}>
            {phase.submission ? '保存案を読み直す' : '標準案を再取得'}
          </button>
        </div>
      )}
      {submissionChanged && (!mobile || dirty) && (
        <div role="alert" className="online-edit-notice">
          <p>
            別の操作で提出が更新されました。現在の入力を破棄して保存済みの内容を読み直せます。
          </p>
          <button onClick={resetSubmission}>最新の提出を読み直す</button>
        </div>
      )}
    </>
  );
  const staleNote = planRevision !== null &&
    planRevision !== view.revision &&
    !phase.submission && (
      <p className="online-muted">
        他の操作で更新がありました。提出時に現在の内容を再検証します。
      </p>
    );
  const editor = plan && (
    <>
      {/* ⚠ 初期メンバー選択。開幕前はこれだけで、希望リストは出さない */}
      {phase.packs && (
        <PackSelect
          packs={phase.packs}
          plan={plan}
          busy={busy}
          view={view}
          run={run}
          command={command}
          onShow={setViewedPack}
          onChange={(next) => {
            setDirty(true);
            setPlan(next);
          }}
        />
      )}
      {plan.rankedIds && (
        <TryoutPlanner
          plan={plan}
          candidates={phase.candidates}
          roster={view.roster}
          maxCount={Math.max(0, ROSTER_LIMIT - view.roster.length)}
          busy={busy}
          onChange={(next) => {
            setDirty(true);
            setPlan(next);
          }}
          onReset={resetToDefaults}
        />
      )}
      {plan.releaseIds && (
        <ContractPlanner
          roster={view.roster}
          plan={plan}
          advice={phase.releaseAdvice || {}}
          onChange={(next) => {
            setDirty(true);
            setPlan(next);
          }}
        />
      )}
      {/* ⚠ キャンプはここに書かない。PCはホーム（`DesktopView` の `campHere`）に出していて
          この `editor`（PC専用）を通らない。スマホは下の `mobile` の枝で出す */}
      {phase.kind === 'offseason' && (
        <p>最終順位を保存し、次年度のキャンプへ進みます。決めることはありません（「この内容で決定」を押すと早く進みます）。</p>
      )}
    </>
  );

  // 初期メンバー選択で、選択中と違うセットを見ているときの添え書き（下の `mobile` の帯）
  const chosenPack =
    editing && phase.packs && plan?.packId && viewedPack && viewedPack !== plan.packId
      ? phase.packs.find((p) => p.id === plan.packId)
      : null;
  const chosenNote = chosenPack ? `決定するのは選択中の「${chosenPack.name}」です` : null;

  // スマホで編集を開くボタンの名前。編集できる手続きだけ（年度更新は決めることが無い）
  const mobileEditLabel = !plan
    ? null
    : phase.packs
      ? 'セットを見比べて選ぶ'
      : plan.releaseIds
        ? '退団させる選手を変える'
        : plan.rankedIds
          ? '獲得の希望を変える'
          : null;

  // 指導者に任せた手続き: 指導者の案を読むだけ。決定・下書き・編集は出さない（上の `delegated` の注）。
  // ⚠ 文はアプリ（ProceduresScreen）と同じ。自分で決めるときの入口は「指導者」のページ
  if (delegated) {
    const readyCount = view.members.filter((m) => m.ready).length;
    const body = (
      <>
        <div className="online-phase-delegated" role="status">
          <p>
            指導者に任せています。この手続きは指導者の案で決まります。自分で決めるなら「指導者」で任せ方を「意見を聞く」にしてください。
          </p>
          {setTab && (
            <button type="button" onClick={() => setTab('staff')}>
              指導者のページへ
            </button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        {coachPlan ? (
          <>
            {phase.planBy?.by && (
              <p className="online-muted">{`${phase.planBy.by}の案`}</p>
            )}
            <MobilePlanContents phase={phase} plan={coachPlan} view={view} />
          </>
        ) : (
          !error && <p>指導者の案を準備しています…</p>
        )}
      </>
    );
    if (!mobile)
      return (
        <Page
          title={PHASE_LABELS[phase.kind]}
          sub={`${phase.deadline ? `締め切り ${formatDeadline(phase.deadline)} · ` : ''}決定済み ${readyCount}/${view.members.length}球団 · 指導者に任せています`}
        >
          <SeasonFlow view={view} />
          <section className="online-card online-phase-rules">
            <p>{rulesText}</p>
            {readyList}
          </section>
          <section className="online-card online-decision">{body}</section>
        </Page>
      );
    return (
      <section className="online-card online-decision">
        <SeasonFlow view={view} compact />
        <h2>{PHASE_LABELS[phase.kind]}</h2>
        <p>{rulesText}</p>
        {readyList}
        {body}
      </section>
    );
  }

  if (!mobile) {
    // ⚠ PCは**ほかの編集ページと同じ形**: 見出しの右に操作、本文にカード。
    //    以前は決定・下書きの保存が一番下（長い一覧の後ろ）にあり、
    //    ページごとに保存の場所が違うという指摘を受けた
    const readyCount = view.members.filter((m) => m.ready).length;
    return (
      <Page
        title={PHASE_LABELS[phase.kind]}
        sticky
        sub={
          `${phase.deadline ? `締め切り ${formatDeadline(phase.deadline)} · ` : ''}決定済み ${readyCount}/${view.members.length}球団` +
          (dirty ? ' · 保存していない変更があります' : phase.submission?.ready ? ' · あなたは決定済みです' : '')
        }
        actions={
          /* ⚠ **キャンプには決定の操作を出さない**（PCのキャンプはホームで、ここへは来ない。
             来ても出さない）。1クールずつその場で実行する形なので、提出して締め切りを
             待つものが無い。出すと「決定したのにクールが残っている」状態が作れてしまう */
          plan && phase.kind !== 'camp' && (
            <>
              <button disabled={busy || !dirty} onClick={resetSubmission}>
                変更を取り消す
              </button>
              <button disabled={busy} onClick={() => submit(false)}>
                {phase.submission?.ready ? '決定を取り消す' : '下書きを保存'}
              </button>
              <button
                className="online-primary"
                disabled={busy}
                onClick={() => submit(true)}
              >
                この内容で決定
              </button>
            </>
          )
        }
      >
        <fieldset className="online-form-fields online-phase" disabled={busy}>
          <SeasonFlow view={view} />
          <section className="online-card online-phase-rules">
            <p>{rulesText}</p>
            {staffNote}
            {readyList}
            {alerts}
          </section>
          {editor && (
            <section className="online-card online-decision">
              {staleNote}
              {editor}
            </section>
          )}
          {!plan && !error && (
            <section className="online-card">
              <p>標準案を準備しています…</p>
            </section>
          )}
        </fieldset>
      </Page>
    );
  }

  return (
    <section className="online-card online-decision">
      <SeasonFlow view={view} compact />
      <fieldset className="online-form-fields" disabled={busy}>
        <h2>{PHASE_LABELS[phase.kind]}</h2>
        {/* ⚠ 2人固定だった頃の「両者」という書き方を残さない。
            いまは1〜12人で、締め切りが来れば未提出でも先へ進む */}
        {/* ⚠ 「決定後も出し直せる」のは**ほかに検討中の人がいる間だけ**。
            最後の1人が決定した瞬間に処理されるので、無条件には書かない */}
        <p>{rulesText}</p>
        {staffNote}
        {readyList}
        {alerts}
        {/* ⚠ **キャンプは携帯でも回せるようにする**。表は23列あって携帯には
            入らないが、1クールずつ実行するのは携帯からでもできる必要がある
            （携帯だけの人は、出せないと4クールとも自動になる） */}
        {phase.kind === 'camp' && (
          <OffseasonGrowth key={view.lastOffseason?.year} view={view} />
        )}
        {phase.kind === 'camp' && <TryoutResult view={view} />}
        {phase.kind === 'camp' && (
          <CampPlanner
            view={view}
            busy={busy}
            run={run}
            command={command}
            compact
          />
        )}
        {plan && phase.kind !== 'camp' && (
          <>
            {/* ⚠ **中身はスマホでも変えられる**（PCと同じ部品・同じ `submit`）。以前は
                「変えるときはPCで」と書くだけで、スマホだけの人は標準案のまま決めるしかなかった。
                ふだんは決める中身（`MobilePlanContents`）を見せ、ボタンで編集に切り替える。
                編集の間は中身を隠す（編集の画面に同じ顔ぶれが出ている） */}
            {editing ? (
              <div className="online-phase-editor">
                <button
                  type="button"
                  className="online-phase-edit-toggle"
                  aria-expanded="true"
                  onClick={() => setEditing(false)}
                >
                  編集を閉じる
                </button>
                {editor}
              </div>
            ) : (
              <>
                <MobilePlanContents phase={phase} plan={plan} view={view} />
                {mobileEditLabel && (
                  <button
                    type="button"
                    className="online-phase-edit-toggle"
                    aria-expanded="false"
                    onClick={() => {
                      setConfirming(false);
                      setEditing(true);
                    }}
                  >
                    {mobileEditLabel}
                  </button>
                )}
                {/* ⚠ **初期メンバー選択では名前の欄を編集の外にも出す**（再監査 B5）。始める手順は
                    「セットを選ぶ → 球団名とプレイヤー名 → 決定」だが、欄はセットの一覧（編集）の
                    中にしか無く、標準のセットのまま決定すると名前を一度も見ずに終わっていた。
                    編集を開いている間は一覧の下（`PackSelect`）に出るので、ここでは出さない */}
                {phase.packs && (
                  <TeamIdentity view={view} busy={busy} run={run} command={command} />
                )}
              </>
            )}
            <p className="online-phase-status">
              {dirty
                ? '編集中の内容（未保存）です。'
                : phase.submission
                  ? '保存済みの内容です。'
                  : '標準案です。'}
              {dirty && (
                <button type="button" onClick={resetSubmission}>
                  変更を取り消す
                </button>
              )}
            </p>
            {staleNote}
            {/* ⚠ **決定の前に確認を1段挟む**（年度更新は決めることが無いので挟まない）。
                全員がそろった時点で処理され、そのあとは取り消せない。確認の文は下に固定した
                帯の中に出す（上の中身を見ながら決められるように） */}
            {confirming ? (
              <div
                className="online-actions online-phase-confirm"
                role="group"
                aria-label="決定の確認"
              >
                <p>
                  {view.members.every(
                    (m) => m.teamName === view.teamName || m.ready || m.cpu,
                  )
                    ? 'ほかの球団は決定済みです。決定するとすぐに処理され、取り消せません。'
                    : '全員が決定した時点で処理され、そのあとは取り消せません。'}
                </p>
                <button
                  className="online-primary"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    submit(true);
                  }}
                >
                  決定する
                </button>
                <button disabled={busy} onClick={() => setConfirming(false)}>
                  戻る
                </button>
              </div>
            ) : (
              <div className="online-actions">
                {/* ⚠ **別のセットを見ている間は、決定するのが選択中のセットだと添える**（画面の
                    見回り F13）。セットの中身を見ながら下の「この内容で決定」を押すと、見ている
                    セットではなく選択中のセットで確認に進むので、押す前に分かるようにする */}
                {chosenNote && <p className="online-phase-chosen">{chosenNote}</p>}
                <button
                  className="online-primary"
                  disabled={busy}
                  onClick={() => {
                    if (phase.kind === 'offseason') return submit(true);
                    // ⚠ 確かめるときは**編集を閉じて中身を見せる**（何を決めるのかを見て押す）
                    setEditing(false);
                    setConfirming(true);
                  }}
                >
                  この内容で決定
                </button>
                {/* ⚠ **PC・アプリと同じ2つ目のボタン**（決定前は「下書きを保存」）。編集できるのに
                    保存の手段が決定しか無いと、決めかねたまま離れた編集は締め切りで標準案に戻る */}
                {(phase.submission?.ready || mobileEditLabel) && (
                  <button disabled={busy} onClick={() => submit(false)}>
                    {phase.submission?.ready ? '決定を取り消す' : '下書きを保存'}
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {needsPlan && !plan && !error && <p>標準案を準備しています…</p>}
      </fieldset>
    </section>
  );
}
/**
 * スマホ版の「打順」カード（打順・守備・控えの2タップの表＋采配の入口）。
 *
 * ⚠ **スマホ専用**。PCの打順・先発・投手の役割はスタメン設定・投手起用（PC専用の表）、
 *    方針と自動采配は `DesktopTactics` で決める。以前はPCもここを使っていて、
 *    同じものがコンボボックス版と一人用の画面の移植の2通りで編集できていた。
 * ⚠ 打順の編集は2タップの表（`TapLineup.jsx`）、方針・采配は下書き（`lineup.plan`。
 *    PCの「方針・采配」と同じ入れ物）。保存は**まとめて1回**送る（どちらの「保存」でも
 *    両方を送る）。それぞれ自分の項目だけを最新の編成に載せる（`rebaseLineupParts`）ので、
 *    PCや別の端末で保存されたほかの項目を古い値に戻さない。
 */
export function LineupPanel({
  view,
  busy,
  run,
  command,
  onShowRoster,
  hidden = false,
}) {
  const [plan, setPlan] = useDraftState('lineup.plan', () =>
    structuredClone(view.lineup),
  );
  const [dirty, setDirty] = useDraftState('lineup.dirty', false);
  const [baseLineup, setBaseLineup] = useDraftState('lineup.base', () =>
    structuredClone(view.lineup),
  );
  const tap = useTapLineup(view);
  const [showTactics, setShowTactics] = useState(false);
  const [saveError, setSaveError] = useState('');
  const save = () =>
    run(async () => {
      setSaveError('');
      try {
        const parts = [];
        if (tap.dirty)
          parts.push({
            keys: LINEUP_BOARD_KEYS,
            plan: tap.plan,
            base: tap.baseLineup,
          });
        if (dirty)
          parts.push({ keys: TACTICS_EDITOR_KEYS, plan, base: baseLineup });
        await command('lineup', rebaseLineupParts(parts, view.lineup));
        setDirty(false);
        if (tap.dirty) tap.markSaved();
      } catch (error) {
        setSaveError(error.message);
        throw error;
      }
    });
  const discard = () => {
    tap.discard();
    setPlan(structuredClone(view.lineup));
    setBaseLineup(structuredClone(view.lineup));
    setDirty(false);
    setSaveError('');
  };
  useEffect(() => {
    if (!dirty) {
      setPlan(structuredClone(view.lineup));
      setBaseLineup(structuredClone(view.lineup));
    }
  }, [view.lineup, dirty, setPlan, setBaseLineup]);
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
    setPlan(next);
    setDirty(true);
  };
  return (
    <section className="online-card online-lineup-card" hidden={hidden}>
      <div className="online-card-heading">
        <div>
          <h2>打順</h2>
          <p className="online-muted">次の試合から反映</p>
        </div>
        <button onClick={() => setShowTactics(true)}>方針・采配</button>
        {onShowRoster && (
          <button
            onClick={onShowRoster}
            aria-label="投手・控えを含む選手成績 →"
          >
            選手成績
          </button>
        )}
      </div>
      <TapLineup
        view={view}
        tap={tap}
        busy={busy}
        otherDirty={dirty}
        saveError={saveError}
        onSave={save}
        onDiscard={discard}
      />
      {showTactics && (
        <MobileTactics
          view={view}
          plan={plan}
          change={change}
          busy={busy}
          dirty={dirty || tap.dirty}
          save={save}
          error={saveError}
          close={() => setShowTactics(false)}
        />
      )}
    </section>
  );
}
