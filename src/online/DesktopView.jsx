import React, { useEffect, useState } from 'react';
import {
  Standings,
  Results,
  Notices,
  PhasePanel,
  LineupPanel,
} from './LeaguePanels.jsx';
import TeamRoster from './TeamRoster.jsx';
import OnlineLineup from './OnlineLineup.jsx';
import Admin from './AdminPanel.jsx';
import { CompactRoster } from './PlayerPerformance.jsx';
import {
  NowCard,
  LastGame,
  LatestNews,
  StartersCondition,
  LeagueToday,
} from './Home.jsx';
import { STATUS } from './api.js';
import { teamLabel } from './gameText.js';
import { TeamBadge, formatJst, gameDay, remaining } from './ui.jsx';

// PCの画面。
// ⚠ **上の帯（共通ヘッダー）は置かない**。以前は「NEXT STAGE」の帯・検証モード・
//    SEASON・大きな日付・進行の説明・進行時刻ボタンで約260pxを使い、球団名は左ナビと
//    重複していた。球団・日付・次の進行は左ナビの上にまとめる。
// ⚠ 左ナビは画面の高さいっぱい（以前は900pxで切れて、下に地色が見えていた）。
// ⚠ キーボード: 1〜7 で画面切り替え、←→ でページ送り（入力欄にいるときは効かない）。
export default function DesktopView(props) {
  const { view, tab, setTab, busy, run, command, local } = props;
  const [detailLineup, setDetailLineup] = useState(false);
  const tabs = [
    ['today', '今日'],
    ['games', '試合'],
    ['players', '選手'],
    ['lineup', '編成'],
    ['decisions', '手続き'],
    ['news', 'リーグ便り'],
    ...(view.isAdmin ? [['admin', '管理']] : []),
  ];
  const screen = tabs.some(([id]) => id === tab) ? tab : 'today';
  useEffect(() => {
    const onKey = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target?.closest?.('input, select, textarea, [contenteditable]')) return;
      const n = Number(event.key);
      if (Number.isInteger(n) && n >= 1 && n <= tabs.length) {
        setTab(tabs[n - 1][0]);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const scope =
          [...document.querySelectorAll('dialog[open]')].pop() ||
          document.querySelector('.online-content');
        const button = scope?.querySelector(
          `.online-pager button[aria-label="${event.key === 'ArrowLeft' ? '前のページ' : '次のページ'}"]`,
        );
        if (button && !button.disabled) {
          event.preventDefault();
          button.click();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabs.length, setTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = view.members.find((m) => m.teamName === view.teamName);
  return (
    <div className="online-desktop-layout">
      <nav className="online-side" aria-label="オンラインの画面">
        <a href="/online" className="online-brand">
          NEXT STAGE <span>オンラインペナント</span>
        </a>
        <div className="online-nav-context">
          <TeamBadge team={view.teamName} size="lg" />
          <div>
            <strong>{teamLabel(view.teamName)}</strong>
            <small>
              {view.year}年目 · {gameDay(view.currentDate)}
            </small>
          </div>
        </div>
        <p className="online-nav-status">
          <span className={`online-status-dot is-${view.status}`} />
          {STATUS[view.status]}
          {view.status === 'running' && view.nextAdvanceAt && (
            <small>
              次の進行 {formatJst(view.nextAdvanceAt)}（
              {remaining(view.nextAdvanceAt)}）
            </small>
          )}
        </p>
        <div className="online-nav-items">
          {tabs.map(([id, label], i) => (
            <button
              key={id}
              aria-label={label}
              aria-current={screen === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              {label}
              {id === 'decisions' && view.phase && !mine?.ready && (
                <span className="online-dot" aria-label="未決定の手続き" />
              )}
              <kbd aria-hidden="true">{i + 1}</kbd>
            </button>
          ))}
        </div>
        <div className="online-nav-footer">
          <button className="online-link" disabled={busy && !view.stale} onClick={props.reloadView}>
            最新の状態に更新
          </button>
          <button className="online-link" onClick={props.showTimes}>
            進行のしくみ
          </button>
          <a href="/">一人用モードへ</a>
          <button className="online-link" onClick={props.logout}>
            ログアウト
          </button>
          {local && <small>ローカル検証モード</small>}
        </div>
      </nav>
      <div className="online-content">
        {screen === 'today' && (
          <div className="online-dashboard">
            <div className="online-dashboard-main">
              <NowCard view={view} setTab={setTab} />
              <LastGame view={view} />
              <LeagueToday view={view} />
            </div>
            <div className="online-dashboard-side">
              <Standings view={view} />
              <StartersCondition view={view} />
              <LatestNews view={view} open={() => setTab('news')} />
            </div>
          </div>
        )}
        {screen === 'games' && (
          <div className="online-dashboard">
            <div className="online-dashboard-main">
              <Results view={view} mode="results" />
            </div>
            <div className="online-dashboard-side">
              <Results view={view} mode="upcoming" compact />
            </div>
          </div>
        )}
        {screen === 'players' && (
          <TeamRoster view={view}>
            {(shown, selector) => (
              <CompactRoster
                key={shown.teamName}
                view={shown}
                teamSelector={selector}
                desktop
              />
            )}
          </TeamRoster>
        )}
        {screen === 'lineup' && (
          <div className="online-form-width is-wide">
            <div className="online-lineup-tools">
              <button onClick={() => setDetailLineup(true)}>
                一人用と同じ詳しい編成画面を開く
              </button>
            </div>
            <LineupPanel key={`${view.year}:${view.teamName}`} {...props} />
            {detailLineup && (
              <OnlineLineup
                view={view}
                busy={busy}
                onClose={() => setDetailLineup(false)}
                onSave={async (plan, baseLineup) => {
                  // ⚠ **失敗したら閉じない**。以前は成否に関係なく閉じていて、
                  //    保存に失敗すると編集がまるごと消えた
                  const result = await run(() =>
                    command('lineup', { ...plan, baseLineup }),
                  );
                  if (result?.ok) setDetailLineup(false);
                  return result;
                }}
              />
            )}
          </div>
        )}
        {screen === 'decisions' &&
          (view.phase ? (
            /* ⚠ 初期編成・トライアウトだけ横に広げる。希望リストと候補を
               左右に並べるので、740pxだと能力の表示が折り返して読めない */
            <div
              className={
                view.phase.candidates ? 'online-wide-width' : 'online-form-width'
              }
            >
              <PhasePanel key={view.phase.id} {...props} />
            </div>
          ) : (
            <section className="online-card online-form-width">
              <h2>手続き</h2>
              <p className="online-empty">
                いま決める手続きはありません。土日に手続きがあると、ここに出ます。
              </p>
            </section>
          ))}
        {screen === 'news' && (
          <div className="online-form-width">
            <Notices view={view} />
          </div>
        )}
        {screen === 'admin' && (
          <div className="online-form-width">
            <Admin {...props} />
          </div>
        )}
      </div>
    </div>
  );
}
