import React, { useState } from 'react';
import { Page } from './Page.jsx';
import { POS } from './api.js';
import { teamLabel, teamShort } from './gameText.js';
import { turnLabel } from './shared.js';
import { useRead } from './useRead.js';
import {
  lastSeenLabel,
  CHALLENGE_NOTE_MAX,
  STARTER_LOCK_TURNS,
  EXHIBITIONS_PER_DAY,
  AWAY_DAYS,
} from './social.js';
import { sinceLabel } from './awaySummary.js';
import { BoxScore, Panel } from './GameHistory.jsx';
import { ScoringPlays } from './ScoringPlays.jsx';

// ============================================================
// 人どうしの関わりの画面（PC）。
//   - 留守中のまとめの帯（ホームの上）
//   - あなたへのお知らせ・オーナーたち（ホームの右）
//   - 取引の記録（情報）
//   - 予告先発（ロスター管理）
//   - 練習試合（手続き）
//   - 得点経過（試合成績の小窓・練習試合の結果）
//   - 参加者の管理（リーグ管理。来なくなった人の球団をCPUに戻す）
// ⚠ 文はサーバーが作ったもの（お知らせ）をそのまま出す。アプリも同じ文を出す。
// ============================================================

/** 日本時間の「今日」（最終ログインの見せ方に使う） */
const nowIso = () => new Date().toISOString();
const seenText = (day) => (day ? lastSeenLabel(`${day}T03:00:00.000Z`, nowIso()) : '');

/** 留守中のまとめ（前に開いたときから何が起きたか）。閉じるまで出す */
export function AwaySummaryBanner({ away, close }) {
  if (!away?.lines?.length) return null;
  return (
    <div className="online-procedure-banner is-away" role="status" aria-label="留守中のまとめ">
      <div>
        <strong>前回{away.at ? `（${sinceLabel(away.at)}）` : ''}から</strong>
        <span>{away.lines.join(' · ')}</span>
      </div>
      <button onClick={close}>閉じる</button>
    </div>
  );
}

/** あなたへのお知らせ（トレードの返事・取り下げ、練習試合、予告先発の回避、おるすばん） */
export function InboxCard({ view, limit = 5 }) {
  const items = (view.inbox || []).slice(0, limit);
  if (!items.length) return null;
  return (
    <section className="online-card online-inbox" aria-label="あなたへのお知らせ">
      <h2>あなたへのお知らせ</h2>
      <ul className="online-inbox-list">
        {items.map((n) => (
          <li key={n.id}>
            <small>{n.at ? sinceLabel(Date.parse(n.at)) : ''}</small>
            <span>{n.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** オーナーたち（人の球団・呼び名・ひとこと・最後に来た日） */
export function OwnersCard({ view }) {
  const members = view.members || [];
  if (members.length < 2) return null;
  return (
    <section className="online-card online-owners" aria-label="オーナーたち">
      <h2>オーナーたち</h2>
      <ul className="online-owner-list">
        {members.map((m) => (
          <li key={m.teamName} className={m.teamName === view.teamName ? 'is-own' : ''}>
            <b>{teamShort(m.teamName)}</b>
            <span>{m.label || 'プレイヤー'}</span>
            {m.away ? (
              <small className="online-owner-away" title={`${AWAY_DAYS}日来ていないので、指導者に任せています`}>
                おるすばん中
              </small>
            ) : (
              m.lastSeenDay && <small className="online-muted">{seenText(m.lastSeenDay)}</small>
            )}
            {m.comment && <q className="online-owner-comment">{m.comment}</q>}
          </li>
        ))}
      </ul>
    </section>
  );
}

const KIND_LABEL = { trade: 'トレード', release: '退団', signing: '入団' };

/** 取引の記録（トレード・退団・入団）。年度と球団で絞る */
export function TransactionsPage({ view }) {
  const [year, setYear] = useState(view.year);
  const [team, setTeam] = useState('');
  const result = useRead('transactions', { year: String(year), ...(team ? { team } : {}) });
  const years = [...new Set([view.year, ...(result.data?.years || [])])].sort((a, b) => b - a);
  const items = result.data?.items || [];
  return (
    <Page
      title="取引の記録"
      sub="成立したトレードと、契約更改の退団・トライアウトの入団です。"
      actions={
        <div className="online-stat-tools">
          <select aria-label="取引の記録の年度" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}年目
              </option>
            ))}
          </select>
          <select aria-label="取引の記録の球団" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">全球団</option>
            {(view.teamNames || []).map((name) => (
              <option key={name} value={name}>
                {teamLabel(name)}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <section className="online-card">
        {result.loading && <p className="online-muted">読み込んでいます…</p>}
        {result.error && <p className="online-error-text">{result.error}</p>}
        {result.data && !items.length && <p>この年度の取引はまだありません。</p>}
        <div className="online-transactions">
          {items.map((t) => (
            <article key={t.id} className={`is-${t.kind}`}>
              <header>
                <span className="online-transaction-kind">{KIND_LABEL[t.kind] || t.kind}</span>
                <small>
                  {t.kind === 'trade' ? turnLabel(t.date, view.seasonTurns) : t.kind === 'release' ? '契約更改' : 'トライアウト'}
                </small>
                <b>{t.teams.map((name) => teamShort(name)).join(' ⇄ ')}</b>
                {t.kind === 'trade' && t.cpu && <small className="online-muted">（相手はCPU）</small>}
              </header>
              <ul>
                {t.moves.map((m) => (
                  <li key={`${m.playerId}:${m.to}`}>
                    <span>{m.name}</span>
                    <small>{POS[m.position] || ''}</small>
                    <small className="online-muted">
                      {m.from ? teamShort(m.from) : t.kind === 'signing' ? '新人' : ''}
                      {' → '}
                      {m.to ? teamShort(m.to) : '退団'}
                    </small>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </Page>
  );
}

/** 予告先発（この先の試合の先発をローテから指名する） */
export function StarterPicksPage({ view, busy, run, command }) {
  const plan = view.starterPlan;
  const rotation = (view.lineup?.starters || [])
    .map((id) => view.roster?.find((p) => p.id === id))
    .filter(Boolean);
  const games = plan?.games || [];
  return (
    <Page
      title="予告先発"
      sub={`この先の試合の先発をローテの中から選べます。試合の${STARTER_LOCK_TURNS}ターン前に確定し、相手にも「予告先発」として見えます。確定までは相手に見えません。`}
    >
      <section className="online-card">
        {!plan?.canPick && (
          <p className="online-muted">
            投手起用を指導者に任せている間は、先発はローテの順に回ります（指導者のページで「自分で」か「意見を聞く」にすると選べます）。
          </p>
        )}
        {!games.length && <p>予定されている試合はありません。</p>}
        <table className="online-record-table online-starter-picks">
          <thead>
            <tr>
              <th>ターン</th>
              <th>相手</th>
              <th>相手の先発</th>
              <th>自軍の先発</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const home = g.home === view.teamName;
              const side = home ? 'home' : 'away';
              const foe = home ? 'away' : 'home';
              const pick = plan.picks?.[g.id];
              return (
                <tr key={g.id}>
                  <th>{turnLabel(g.date, view.seasonTurns)}</th>
                  <td>{teamShort(home ? g.away : g.home)}</td>
                  <td>
                    {g[`${foe}Starter`] || '未定'}
                    {g[`${foe}StarterMark`] === 'fixed' ? (
                      <small className="online-starter-mark is-fixed">予告</small>
                    ) : (
                      <small className="online-muted">（予定）</small>
                    )}
                  </td>
                  <td>
                    {g.starterLocked || !plan.canPick ? (
                      <>
                        {g[`${side}Starter`] || '未定'}
                        {g[`${side}StarterMark`] && (
                          <small className="online-starter-mark is-fixed">
                            {g.starterLocked ? '確定' : '指名'}
                          </small>
                        )}
                      </>
                    ) : (
                      <select
                        aria-label={`${turnLabel(g.date, view.seasonTurns)}の先発`}
                        value={pick ?? ''}
                        disabled={busy}
                        onChange={(e) =>
                          run(() =>
                            command('starterPick', {
                              gameId: g.id,
                              playerId: e.target.value === '' ? null : Number(e.target.value),
                            }),
                          )
                        }
                      >
                        <option value="">ローテの順（{pick == null ? g[`${side}Starter`] || '未定' : '指名を外す'}）</option>
                        {rotation.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.fatigue >= 40 ? '（疲れ）' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="online-muted">
          指名した投手が投げると、ローテはその投手の次から回ります。試合の日に疲れていたら回避して、いつもの順で投げます（お知らせが届きます）。
        </p>
      </section>
    </Page>
  );
}

/** 練習試合（人の球団どうしで1試合。成績・疲労・順位には入らない） */
export function ExhibitionPage({ view, busy, run, command }) {
  const [notes, setNotes] = useState({});
  const [shown, setShown] = useState(null);
  const others = (view.members || []).filter((m) => m.teamName !== view.teamName);
  const list = view.exhibitions || [];
  const incoming = list.filter((e) => e.status === 'offered' && !e.mine);
  const outgoing = list.filter((e) => e.status === 'offered' && e.mine);
  const played = list.filter((e) => e.status === 'played');
  const openWith = (team) =>
    list.some((e) => e.status === 'offered' && [e.fromTeam, e.toTeam].includes(team));
  return (
    <Page
      title="練習試合"
      sub={`人の球団どうしで1試合だけ行います。1部と2部に分かれていても当たれます。成績・疲労・順位には入りません。同じ相手とは1日${EXHIBITIONS_PER_DAY}試合まで。`}
    >
      {incoming.length > 0 && (
        <section className="online-card" aria-label="届いた申し込み">
          <h2>届いた申し込み</h2>
          {incoming.map((e) => (
            <div key={e.id} className="online-challenge">
              <p>
                <b>{teamLabel(e.fromTeam)}</b>から{e.note ? `「${e.note}」` : '申し込みが届いています'}
              </p>
              <div className="online-actions">
                <button
                  className="online-primary"
                  disabled={busy}
                  onClick={() => run(() => command('challengeRespond', { id: e.id, action: 'accept' }))}
                >
                  受けて試合をする
                </button>
                <button
                  disabled={busy}
                  onClick={() => run(() => command('challengeRespond', { id: e.id, action: 'decline' }))}
                >
                  見送る
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      <section className="online-card" aria-label="申し込む">
        <h2>申し込む</h2>
        {!others.length && <p>ほかに人の球団がまだありません。</p>}
        <ul className="online-challenge-list">
          {others.map((m) => (
            <li key={m.teamName}>
              <b>{teamLabel(m.teamName)}</b>
              <span className="online-muted">
                {m.label || 'プレイヤー'}
                {m.away ? '・おるすばん中' : m.lastSeenDay ? `・${seenText(m.lastSeenDay)}` : ''}
              </span>
              <input
                aria-label={`${teamLabel(m.teamName)}へのひとこと`}
                placeholder="ひとこと（任意）"
                maxLength={CHALLENGE_NOTE_MAX}
                value={notes[m.teamName] || ''}
                disabled={busy || openWith(m.teamName)}
                onChange={(e) => setNotes({ ...notes, [m.teamName]: e.target.value })}
              />
              <button
                disabled={busy || openWith(m.teamName)}
                onClick={() =>
                  run(() =>
                    command('challenge', { toTeam: m.teamName, note: (notes[m.teamName] || '').trim() }),
                  )
                }
              >
                {openWith(m.teamName) ? '申し込み中' : '申し込む'}
              </button>
            </li>
          ))}
        </ul>
        {outgoing.map((e) => (
          <p key={e.id} className="online-challenge-out">
            {teamLabel(e.toTeam)}の返事を待っています。
            <button
              disabled={busy}
              onClick={() => run(() => command('challengeRespond', { id: e.id, action: 'withdraw' }))}
            >
              取り下げる
            </button>
          </p>
        ))}
      </section>
      <section className="online-card" aria-label="練習試合の結果">
        <h2>結果</h2>
        {!played.length && <p className="online-muted">まだ練習試合はありません。</p>}
        <div className="online-game-history-list">
          {played.map((e) => (
            <article key={e.id}>
              <small>{e.playedAt ? sinceLabel(Date.parse(e.playedAt)) : ''}</small>
              <span className="online-game-line">
                <span title={teamLabel(e.result.away)}>{teamShort(e.result.away)}</span>{' '}
                <b>
                  {e.result.awayScore} – {e.result.homeScore}
                </b>{' '}
                <span title={teamLabel(e.result.home)}>{teamShort(e.result.home)}</span>
              </span>
              <button className="online-record-button" onClick={() => setShown(e)}>
                個人成績
              </button>
            </article>
          ))}
        </div>
      </section>
      {shown && <ExhibitionRecord view={view} ex={shown} close={() => setShown(null)} />}
    </Page>
  );
}

function ExhibitionRecord({ view, ex, close }) {
  const game = { ...ex.result, gameId: ex.id };
  return (
    <Panel title="練習試合の成績" close={close}>
      <p className="online-game-summary">
        <strong>
          <span title={teamLabel(game.away)}>{teamShort(game.away)}</span> {game.awayScore} – {game.homeScore}{' '}
          <span title={teamLabel(game.home)}>{teamShort(game.home)}</span>
        </strong>
      </p>
      <ScoringPlays game={game} />
      <BoxScore game={game} ownTeam={view.teamName} />
    </Panel>
  );
}

/** 参加者の管理（リーグ管理）。来なくなった人の球団をCPUに戻す */
export function MembersAdmin({ view, busy, run, command }) {
  // ⚠ 参加者の識別子は管理者のビューにだけ載る（`adminMembers`）
  const members = view.adminMembers;
  const [confirm, setConfirm] = useState(null);
  const rows = (view.members || []).filter((m) => m.teamName !== view.teamName);
  return (
    <section className="online-card">
      <h2>参加者</h2>
      <p className="online-muted">
        {AWAY_DAYS}日来ていない人の球団は「おるすばん」になり、スタメン・投手起用・采配・手続きを指導者に任せた扱いになります（来れば元に戻ります）。抜けた人の球団はCPUに戻せます。
      </p>
      {!rows.length && <p>ほかの参加者はいません。</p>}
      <ul className="online-owner-list">
        {rows.map((m) => (
          <li key={m.teamName}>
            <b>{teamLabel(m.teamName)}</b>
            <span>{m.label || 'プレイヤー'}</span>
            <small className="online-muted">
              {m.away ? 'おるすばん中' : m.lastSeenDay ? `最終ログイン ${seenText(m.lastSeenDay)}` : ''}
            </small>
            {members?.[m.teamName] && (
              <button disabled={busy} onClick={() => setConfirm(m)}>
                CPUに戻す
              </button>
            )}
          </li>
        ))}
      </ul>
      {confirm && (
        <div role="alert" className="online-confirm">
          <p>
            {teamLabel(confirm.teamName)}（{confirm.label}）をCPUの球団に戻します。選手と成績はそのまま残り、トレードの提案と練習試合の申し込みは取り下げられます。戻した人は、空いている球団にまた参加できます。
          </p>
          <div className="online-actions">
            <button
              className="online-danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await command('releaseMember', { userId: members[confirm.teamName] });
                  setConfirm(null);
                })
              }
            >
              CPUに戻す
            </button>
            <button disabled={busy} onClick={() => setConfirm(null)}>
              やめる
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
