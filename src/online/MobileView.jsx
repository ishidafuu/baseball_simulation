import React, { useEffect, useRef } from 'react';
import {
  Standings,
  Results,
  Notices,
  PhasePanel,
  LineupPanel,
} from './LeaguePanels.jsx';
import TeamRoster from './TeamRoster.jsx';
import { CompactRoster } from './PlayerPerformance.jsx';
import Admin from './AdminPanel.jsx';
import { NowCard, LastGame, LatestNews } from './Home.jsx';
import { STATUS } from './api.js';
import { teamLabel } from './gameText.js';
import { TeamBadge, gameDay } from './ui.jsx';

// スマホの画面。
// ⚠ **下に4つのタブ（ホーム / 試合 / 編成 / 選手）を常に出す**。以前は
//    「← ⌂ ☰」だけで、いまどこにいるか分からず、画面間の移動が必ずホーム経由だった。
// ⚠ 手続きはホームの「いまやること」から入る（手続き中だけタブにも出す）。
// ⚠ **「PCで」と言わない**。手続き・控えの入れ替え・管理もスマホで最後までできる。
// 下タブの印（線画のSVG。絵文字だと端末ごとに色や形が変わる）
const ICON_PATHS = {
  today: 'M4 11 12 4l8 7v9h-5v-6H9v6H4z',
  games: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7 6c2 2 2 10 0 12M17 6c-2 2-2 10 0 12',
  lineup: 'M5 6h14M5 12h14M5 18h14',
  decisions: 'M6 3h9l3 3v15H6zM9 12l2 2 4-4',
  players: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
};
const Icon = ({ id }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path
      d={ICON_PATHS[id]}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const TABS = [
  ['today', 'ホーム'],
  ['games', '試合'],
  ['lineup', '編成'],
  ['players', '選手'],
];
const SUB_TITLES = {
  decisions: '手続き',
  news: 'リーグ便り',
  standings: '順位表',
  admin: 'リーグ管理',
};
export default function MobileView(props) {
  const { view, tab, setTab } = props;
  const [menuOpen, setMenuOpen] = React.useState(false);
  const tabs = view.phase
    ? [...TABS.slice(0, 3), ['decisions', '手続き'], TABS[3]]
    : TABS;
  const sub = SUB_TITLES[tab] && !(tab === 'decisions' && view.phase);
  const screen = tab === 'admin' && !view.isAdmin ? 'today' : tab;
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [screen]);
  return (
    <>
      <header className="online-mobile-top">
        {sub ? (
          <button
            className="online-icon-button"
            aria-label="戻る"
            onClick={() => setTab('today')}
          >
            ‹
          </button>
        ) : (
          <TeamBadge team={view.teamName} />
        )}
        <div className="online-mobile-title">
          <strong>{sub ? SUB_TITLES[tab] : teamLabel(view.teamName)}</strong>
          <small>
            {view.year}年目 · {gameDay(view.currentDate)} ·{' '}
            {STATUS[view.status]}
          </small>
        </div>
        <button
          className="online-icon-button"
          aria-label="メニュー"
          onClick={() => setMenuOpen(true)}
        >
          ☰
        </button>
      </header>
      <div className="online-mobile-body">
        {screen === 'today' && (
          <>
            <NowCard view={view} setTab={setTab} />
            <LastGame view={view} />
            <Standings
              view={view}
              around
              title="順位"
              onShowAll={() => setTab('standings')}
            />
            <LatestNews view={view} open={() => setTab('news')} />
          </>
        )}
        {screen === 'games' && <Results view={view} compact />}
        {screen === 'players' && (
          <TeamRoster view={view}>
            {(shown, selector) => (
              <CompactRoster
                key={shown.teamName}
                view={shown}
                teamSelector={selector}
              />
            )}
          </TeamRoster>
        )}
        {screen === 'lineup' && (
          <LineupPanel key={`${view.year}:${view.teamName}`} {...props} mobile />
        )}
        {screen === 'decisions' &&
          (view.phase ? (
            <PhasePanel key={view.phase.id} {...props} mobile />
          ) : (
            <section className="online-card">
              <p className="online-empty">
                いま決める手続きはありません。土日に手続きがあると、ここに出ます。
              </p>
            </section>
          ))}
        {screen === 'news' && <Notices view={view} compact />}
        {screen === 'standings' && <Standings view={view} />}
        {screen === 'admin' && <Admin {...props} />}
      </div>
      <nav className="online-tabbar" aria-label="オンラインの画面">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            aria-label={label}
            aria-current={screen === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            <Icon id={id} />
            {label}
            {id === 'decisions' &&
              !view.members.find((m) => m.teamName === view.teamName)?.ready && (
                <span className="online-dot" aria-label="未決定の手続き" />
              )}
          </button>
        ))}
      </nav>
      {menuOpen && (
        <MobileMenu
          {...props}
          go={(id) => setTab(id)}
          close={() => setMenuOpen(false)}
        />
      )}
    </>
  );
}

function MobileMenu({
  view,
  close,
  go,
  loading,
  local,
  reloadView,
  showTimes,
  logout,
}) {
  const dialog = useRef(null);
  useEffect(() => {
    const node = dialog.current;
    const trigger = document.activeElement;
    node.showModal();
    return () => {
      if (node.open) node.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  const act = (action) => {
    dialog.current.close();
    close();
    action?.();
  };
  return (
    <dialog
      ref={dialog}
      className="online-mobile-menu-panel"
      aria-labelledby="online-menu-title"
      onCancel={(e) => {
        e.preventDefault();
        act();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) act();
      }}
    >
      <header>
        <h2 id="online-menu-title">メニュー</h2>
        <button
          className="online-icon-button"
          onClick={() => act()}
          aria-label="メニューを閉じる"
        >
          ×
        </button>
      </header>
      <div>
        <button onClick={() => act(() => go('decisions'))}>手続き</button>
        <button onClick={() => act(() => go('news'))}>リーグ便り</button>
        <button onClick={() => act(() => go('standings'))}>順位表</button>
        {view.isAdmin && (
          <button onClick={() => act(() => go('admin'))}>リーグ管理</button>
        )}
        <hr />
        <button disabled={loading} onClick={() => act(reloadView)}>
          最新の状態に更新
        </button>
        <button onClick={() => act(showTimes)}>進行のしくみ</button>
        <a href="/">一人用モードへ</a>
        <button disabled={loading} onClick={() => act(logout)}>
          ログアウト
        </button>
      </div>
      {local && <small>ローカル検証モード（公開環境では無効）</small>}
    </dialog>
  );
}
