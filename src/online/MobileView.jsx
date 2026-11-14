import { LeagueTopics } from './Chronicle.jsx';
import React, { useEffect, useRef, useState } from 'react';
import {
  useDraftMemoryPeek,
  useDraftState,
  LINEUP_ORDER_DRAFT,
} from './Drafts.jsx';
import {
  Standings,
  Results,
  Notices,
  PhasePanel,
  PendingPackPanel,
  LineupPanel,
  packStartText,
} from './LeaguePanels.jsx';
import TeamRoster from './TeamRoster.jsx';
import OnlineLineup from './OnlineLineup.jsx';
import { fullLineupTouchesPitching } from './lineupBridge.js';
import { CompactRoster, TeamBrief } from './PlayerPerformance.jsx';
import { formatTurn } from './shared.js';
import { nextAdvanceText, STATUS } from './api.js';
import { teamLabel } from './gameText.js';
import { noticeCounts, packWaiting, pendingProcedure } from './notices.js';
import { CompletedCamp } from './CampPlanner.jsx';
import TryoutResult from './TryoutResult.jsx';
import SeasonFlow, { stageLines } from './SeasonFlow.jsx';
import OffseasonGrowth from './OffseasonGrowth.jsx';
import { StaffBody } from './StaffPage.jsx';
import { MobileTradeReplies } from './TradeScreen.jsx';
import { RenameDialog } from './DesktopView.jsx';
import { AwaySummaryBanner, InboxCard } from './SocialPages.jsx';
export default function MobileView(props) {
  const { view, local, loading, reloadView, logout, showTimes, tab, setTab, away, dismissAway } =
    props;
  const [playersFrom, setPlayersFrom] = useState('today');
  const [menuOpen, setMenuOpen] = useState(false);
  // 球団名・名前を変える小窓（PCの左メニューの「名前を変える」と同じ部品）
  const [renaming, setRenaming] = useState(false);
  // ⚠ 全画面の編成に保存していない編集が残っていれば開いたまま始める。
  //    スマホを回すとPC用の画面と入れ替わって作り直され、以前は編集が消えていた。
  //    ⚠ 打順だけの編集なら開かない（「打順」の2タップの表が引き取る。`TapLineup.jsx`）
  const unsavedFull = fullLineupTouchesPitching(
    useDraftMemoryPeek('lineup.full'),
  );
  const [fullLineup, setFullLineup] = useState(unsavedFull);
  // 全画面の編成で保存したら、2タップの表の下書きを捨てる（打順の編集も一緒に保存したので。
  // 残すと、保存した後に古い打順の編集が戻ってくる）
  const [, setOrderDraft] = useDraftState(LINEUP_ORDER_DRAFT, null);
  const tabs = [
    ['today', '今日'],
    ['games', '試合'],
    ['lineup', '打順'],
    ['decisions', '手続き'],
  ];
  const counts = noticeCounts(view);
  const procedure = pendingProcedure(view);
  const waiting = packWaiting(view);
  return (
    <>
      {/* ⚠ 自分が決める手続きは、どの画面にいても上に帯で出す（PC版と同じ。見逃し防止） */}
      {procedure && tab !== 'decisions' && (
        <div className="online-procedure-banner" role="alert">
          <div>
            <strong>{procedure.label}を決めてください</strong>
            {procedure.progress && <span>{procedure.progress}</span>}
          </div>
          <button className="online-primary" onClick={() => setTab('decisions')}>
            開く
          </button>
        </div>
      )}
      {/* 途中参加でセットを選び終えたら、いつ自分の球団になるかをホームに出す（PC版と同じ） */}
      {waiting && tab === 'today' && (
        <div className="online-procedure-banner is-waiting" role="status">
          <div>
            <strong>開幕待ち: 「{waiting.packName}」で始まります</strong>
            <span>{packStartText(waiting)}あなたの球団になります</span>
          </div>
          <button onClick={() => setTab('decisions')}>確かめる</button>
        </div>
      )}
      {/* ⚠ **返事が必要なトレードの提案もホームで知らせる**（PC版の左メニューの数と
          同じ数え方。`notices.js`）。知らせないと提案に気づかないまま残り続ける（提案に期限は無く、
          返事か取り下げまで残る。提案した側の同時5件の枠も埋めたまま）。
          帯から返事の画面（受ける・断る）へ行ける。以前は「PCかアプリで返事してください」
          と書くだけで、スマホWebでは返事ができなかった */}
      {counts.trades > 0 && tab === 'today' && (
        <div
          className="online-procedure-banner is-waiting"
          role="status"
        >
          <div>
            <strong>返事が必要なトレードの提案が{counts.trades}件あります</strong>
            <span>受けるか断るかを選びます</span>
          </div>
          <button className="online-primary" onClick={() => setTab('transfer')}>
            返事する
          </button>
        </div>
      )}
      {/* 前に開いたときから起きたこと（PC版と同じ文。閉じるまで出す） */}
      {tab === 'today' && <AwaySummaryBanner away={away} close={dismissAway} />}
      {tab === 'today' && (
        <>
          <section className="online-mobile-overview">
            <strong>{teamLabel(view.teamName)}</strong>
            <span>
              {/* ⚠ 総数はビューの値で出す（PC版と同じ理由） */}
              {view.stage && !['season', 'pack_select'].includes(view.stage.key)
                ? `オフ · ${stageLines(view)?.step.label || ''}${view.stage.open ? '' : '待ち'}`
                : formatTurn(view.currentDate, view.seasonTurns)}{' '}
              ·{' '}
              {STATUS[view.status]}
            </span>
            <small>次の進行 {nextAdvanceText(view)}</small>
          </section>
          {view.stage?.key !== 'season' && <SeasonFlow view={view} compact />}
          <TeamBrief view={view} />
          <InboxCard view={view} limit={3} />
          <nav className="online-home-actions" aria-label="オンラインの画面">
            {tabs
              .filter(([id]) => id !== 'today')
              .map(([id, label]) => (
                <button key={id} aria-label={label} onClick={() => setTab(id)}>
                  {label}
                  {/* ⚠ 印は数で出す（PC版の左メニューと同じ数え方。`notices.js`） */}
                  {id === 'decisions' && counts.procedure > 0 && (
                    <span className="online-count" aria-label="未完了の手続き">
                      {counts.procedure}
                    </span>
                  )}
                </button>
              ))}
            <button
              onClick={() => {
                setPlayersFrom('today');
                setTab('players');
              }}
            >
              選手成績
            </button>
            {/* 監督・コーチと任せ方（PCの「指導者」ページと同じ中身） */}
            <button onClick={() => setTab('staff')}>指導者</button>
          </nav>
          <Standings view={view} />
          {/* ⚠ **行った先の見出しの名前で書く**（「リーグの話題」と「リーグ便り」）。以前は
              「リーグ便り・過去のシーズン →」で、開くと先頭は「リーグの話題」、1年目は
              過去のシーズンも無かった（過去の最終順位は「リーグ便り」の中で選ぶ） */}
          <button className="online-news-link" onClick={() => setTab('news')}>
            リーグの話題・リーグ便り →
          </button>
        </>
      )}
      {tab === 'games' && <Results view={view} compact />}
      {tab === 'players' && (
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
      {tab === 'staff' && <StaffBody {...props} mobile />}
      {/* トレードの返事（受ける・断る）。⚠ 名前はPCのトレードのページと同じ（回しても同じ画面へ） */}
      {tab === 'transfer' && <MobileTradeReplies {...props} />}
      {tab === 'news' && (
        <>
          <LeagueTopics view={view} />
          <Notices view={view} compact />
        </>
      )}
      {(tab === 'lineup' || tab === 'players') && (
        <div hidden={tab === 'players'}>
          {/* ⚠ **手続き中でも開けること**。以前は「決定待ちです」で塞いでいたが、
              打順や投手起用はいつ決めてもよく、止める理由が無い */}
          {fullLineup ? (
            <OnlineLineup
              view={view}
              busy={props.busy}
              tab="rotation"
              onClose={() => setFullLineup(false)}
              onSave={async (plan, baseLineup) => {
                // ⚠ **失敗したら閉じない**（PCと同じ）。閉じると編集がまるごと消える
                const result = await props.run(() =>
                  props.command('lineup', { ...plan, baseLineup }),
                );
                if (result?.ok) {
                  setOrderDraft(null);
                  setFullLineup(false);
                }
                return result;
              }}
            />
          ) : (
            <>
              {/* ⚠ スマホからも一人用の編成画面（`OnlineLineup.jsx`）へ入れるようにする。
                  横に長い画面なので既定では開かず、押したときだけ出す。
                  ⚠ 打順・守備・控えは下の2タップの表で決めるので、ここは**投手起用の入口**
                  （開くと投手起用のタブから始まる）。打順のタブも中にはある */}
              {/* ⚠ **保存の応答を待つ間は開かない**。開くと「打順」の表が外れ、保存する前の
                  起点の編集が全画面へ渡る（そこで保存すると「編成が更新されています」で断られる） */}
              <button
                className="online-primary online-full-width"
                disabled={props.busy}
                onClick={() => setFullLineup(true)}
              >
                投手起用を開く（横向き推奨）
              </button>
              <LineupPanel
                key={`${view.year}:${view.teamName}`}
                {...props}
                mobile
                onShowRoster={() => {
                  setPlayersFrom('lineup');
                  setTab('players');
                }}
                hidden={tab === 'players'}
              />
            </>
          )}
        </div>
      )}
      {/* ⚠ **途中参加の初期メンバー選択は携帯でも出す**。PCでしか選べないと、
          携帯で参加した人は名簿が決まらないままキャンプを迎える */}
      {tab === 'decisions' && view.pendingPack && (
        <PendingPackPanel {...props} mobile />
      )}
      {tab === 'decisions' &&
        !view.pendingPack &&
        (view.phase ? (
          <PhasePanel key={view.phase.id} {...props} mobile />
        ) : (
          <>
            <section className="online-card">
              <h2>手続き</h2>
              <p>
                {view.stage?.key !== 'season' && stageLines(view)
                  ? `いま決めることはありません。${stageLines(view).head}。`
                  : '現在、決定待ちの手続きはありません。'}
              </p>
            </section>
            <SeasonFlow view={view} compact />
            <CompletedCamp key={view.lastCamp?.year} view={view} />
            <OffseasonGrowth key={view.lastOffseason?.year} view={view} />
            <TryoutResult view={view} />
          </>
        ))}
      <nav className="online-mobile-controls" aria-label="画面操作">
        <button
          aria-label="戻る"
          disabled={tab === 'today'}
          onClick={() => setTab(tab === 'players' ? playersFrom : 'today')}
        >
          ←
        </button>
        <button aria-label="ホーム" onClick={() => setTab('today')}>
          ⌂
        </button>
        <button aria-label="メニュー" onClick={() => setMenuOpen(true)}>
          ☰
        </button>
      </nav>
      {menuOpen && (
        <MobileMenu
          loading={loading}
          local={local}
          close={() => setMenuOpen(false)}
          reloadView={reloadView}
          showTimes={showTimes}
          logout={logout}
          rename={() => setRenaming(true)}
        />
      )}
      {renaming && <RenameDialog {...props} close={() => setRenaming(false)} />}
    </>
  );
}

function MobileMenu({ close, loading, local, reloadView, showTimes, logout, rename }) {
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
        <button onClick={() => act()} aria-label="メニューを閉じる">
          閉じる
        </button>
      </header>
      <div>
        <button disabled={loading} onClick={() => act(reloadView)}>
          更新
        </button>
        <button onClick={() => act(showTimes)}>進行時刻</button>
        {/* ⚠ **スマホにも名前を変える入口を置く**（再監査 B5）。以前はPCの左メニューにしか無く、
            初期メンバーの選択で名前の欄を開かずに決定すると、スマホだけの人は名前を変えられなかった */}
        <button onClick={() => act(rename)}>名前を変える</button>
        <a href="/">一人用</a>
        <button disabled={loading} onClick={() => act(logout)}>
          ログアウト
        </button>
      </div>
      {local && <small>ローカル検証モード（公開環境では無効）</small>}
    </dialog>
  );
}
