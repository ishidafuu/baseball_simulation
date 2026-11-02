import React, { useState } from 'react';
import {
  Standings,
  Results,
  Notices,
  PhasePanel,
  LineupPanel,
  PageNav,
} from './LeaguePanels.jsx';
import TeamRoster from './TeamRoster.jsx';
import OnlineLineup from './OnlineLineup.jsx';
import { POS } from './api.js';
import { teamLabel } from './gameText.js';
import {
  CompactRoster,
  AbilityGrade,
  TeamBrief,
  ConditionMark,
  PlayerStatsButton,
  StatLabels,
  RoleMark,
  rosterByRole,
} from './PlayerPerformance.jsx';
export default function DesktopView(props) {
  const { view, tab, setTab, busy, run, command } = props;
  // ⚠ 一人用の編成画面を**既定で**全画面で開く。閉じると、オンライン側だけの
  //    設定（基本方針・自動采配）が並ぶパネルに戻る
  const [fullLineup, setFullLineup] = useState(true);
  const tabs = [
    ['today', '今日'],
    ['games', '試合'],
    ['players', '選手'],
    ['lineup', '編成'],
    ['decisions', '手続き'],
    ...(view.isAdmin ? [['admin', '管理']] : []),
  ];
  return (
    <>
      <nav className="online-page-nav" aria-label="オンラインの画面">
        <div className="online-nav-context">
          <strong>{teamLabel(view.teamName)}</strong>
          <small>独立リーグ · {view.year}年目</small>
        </div>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            aria-label={label}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
            {id === 'decisions' && view.phase && (
              <span className="online-dot" aria-label="未完了の手続き" />
            )}
          </button>
        ))}
      </nav>
      {tab === 'today' && (
        <div className="online-dashboard">
          <Standings view={view} />
          <section className="online-card">
            <h2>今日の球団</h2>
            <TeamBrief view={view} />
            <p>
              {teamLabel(view.teamName)} · 所属{view.roster.length}人
            </p>
            {view.phase ? (
              <>
                <p>{view.phase.label}の決定を待っています。</p>
                <button
                  className="online-primary"
                  onClick={() => setTab('decisions')}
                >
                  手続きの内容を確認
                </button>
              </>
            ) : (
              <>
                <p>次の進行までに編成を見直せます。</p>
                <button onClick={() => setTab('lineup')}>編成を確認</button>
              </>
            )}
            <p className="online-muted online-spaced">
              試合結果・選手一覧・管理操作は、それぞれの画面から確認できます。
            </p>
          </section>
        </div>
      )}
      {tab === 'games' && (
        <div className="online-dashboard">
          <Results view={view} />
          <Notices view={view} />
        </div>
      )}
      {tab === 'players' && (
        <TeamRoster view={view}>
          {(shown, selector) => (
            <Roster key={shown.teamName} view={shown} teamSelector={selector} />
          )}
        </TeamRoster>
      )}
      {tab === 'lineup' &&
        /* ⚠ **手続き中でも開けること**。以前は「決定待ちです」の1行だけにして
           いたが、移植した編成画面に一度も辿り着けないという指摘を受けた。
           打順や投手起用はいつ決めてもよく、止める理由が無い。
           ⚠ **既定で移植した画面を出す**。ボタンの奥に隠すと、タブを開いた
           時点の見た目が以前と変わらず「移植されていない」ように見える。 */
        (fullLineup ? (
          <OnlineLineup
            view={view}
            busy={busy}
            onClose={() => setFullLineup(false)}
            onSave={async (plan, baseLineup) => {
              // ⚠ **失敗したら閉じない**。以前は成否に関係なく閉じていて、
              //    保存に失敗すると編集がまるごと消えた（文言も全画面の裏に隠れていた）
              const result = await run(() =>
                command('lineup', { ...plan, baseLineup }),
              );
              if (result?.ok) setFullLineup(false);
              return result;
            }}
          />
        ) : (
          <div className="online-form-width">
            <button className="online-primary" onClick={() => setFullLineup(true)}>
              打順・守備・投手起用を開く
            </button>
            <LineupPanel key={`${view.year}:${view.teamName}`} {...props} />
          </div>
        ))}
      {tab === 'decisions' &&
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
          <section className="online-card">
            <h2>手続き</h2>
            <p>現在、決定待ちの手続きはありません。</p>
          </section>
        ))}
      {tab === 'admin' && (
        <div className="online-form-width">
          <Admin {...props} />
        </div>
      )}
    </>
  );
}
function Roster({ view, teamSelector }) {
  const [page, setPage] = useState(0);
  // ⚠ 名簿の順のままだと1ページ目が投手だけになり、スタメンが出てこない
  const [category, setCategory] = useState('batting');
  const order = rosterByRole(view.roster, view.lineup, category);
  const [stats, setStats] = useState(false);
  return (
    <section className="online-card">
      <div className="online-team-selector">{teamSelector}</div>
      <div className="online-segments">
        <button onClick={() => setStats(false)} aria-pressed={!stats}>
          能力一覧
        </button>
        <button onClick={() => setStats(true)} aria-pressed={stats}>
          成績一覧
        </button>
      </div>
      {stats ? (
        <CompactRoster view={view} desktop />
      ) : (
        <>
          <h2>所属選手 · {view.roster.length}人</h2>
          <div className="online-segments" aria-label="成績区分">
            {['batting', 'pitching'].map((id) => (
              <button
                key={id}
                aria-pressed={category === id}
                onClick={() => {
                  setCategory(id);
                  setPage(0);
                }}
              >
                {id === 'batting' ? '打撃' : '投球'}
              </button>
            ))}
          </div>
          <table>
            <thead>
              <tr>
                <th>選手</th>
                <th>年齢</th>
                <th>位置</th>
                <th>ミート</th>
                <th>パワー</th>
                <th>球速</th>
                <th>制球</th>
                <th>調子</th>
                <th>疲労</th>
              </tr>
            </thead>
            <tbody>
              {order.slice(page * 10, page * 10 + 10).map((p) => (
                <tr key={p.id}>
                  <th>
                    <PlayerStatsButton player={p} category={category} />
                    <RoleMark player={p} lineup={view.lineup} />
                    <StatLabels player={p} category={category} />
                  </th>
                  <td>{p.age}</td>
                  <td>{POS[p.position]}</td>
                  <td>
                    <AbilityGrade value={p.batting?.meet} />
                  </td>
                  <td>
                    <AbilityGrade value={p.batting?.power} />
                  </td>
                  <td>
                    <AbilityGrade value={p.pitching?.velocity} velocity />
                  </td>
                  <td>
                    <AbilityGrade value={p.pitching?.control} />
                  </td>
                  <td>
                    <ConditionMark player={p} />
                  </td>
                  <td>{p.fatigue}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <PageNav
            page={page}
            count={view.roster.length}
            size={10}
            setPage={setPage}
          />
        </>
      )}
    </section>
  );
}
function Admin({ view, busy, run, command, allowStep }) {
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  return (
    <section className="online-card">
      <h2>リーグ管理</h2>
      <div className="online-actions">
        {view.status === 'running' && (
          <button disabled={busy} onClick={() => run(() => command('pause'))}>
            進行を停止
          </button>
        )}
        {['paused', 'error'].includes(view.status) && (
          <button disabled={busy} onClick={() => run(() => command('resume'))}>
            次の時刻から再開
          </button>
        )}
        {view.status !== 'running' && (
          <button disabled={busy} onClick={() => run(() => command('backup'))}>
            現在の状態をバックアップ
          </button>
        )}
        {view.hasBackup && ['paused', 'error'].includes(view.status) && (
          <button disabled={busy} onClick={() => setRestoreConfirm(true)}>
            バックアップから復元
          </button>
        )}
      </div>
      {/* ⚠ **検証モード**。ONの間だけ管理者が手で進められる。
          遊び始めたらOFFに戻すこと（好きな時に進められるのは公平ではない）。
          環境変数（`ONLINE_ALLOW_STEP`）でも立つが、そちらは再デプロイが要る。 */}
      <div className="online-testmode">
        <label className="online-check">
          <input
            type="checkbox"
            checked={!!view.testMode}
            disabled={busy}
            onChange={(e) =>
              run(() => command('testmode', { on: e.target.checked }))
            }
          />
          検証モード（手で進められるようにする）
        </label>
        <p className="online-muted">
          時間を待たずに試すための設定です。遊び始めたら外してください。
          1ターン＝実時間1時間＝ゲーム内1日（＝1試合）です。
        </p>
        {(view.testMode || allowStep) && (
          <div className="online-actions">
            {view.phase && (
              <button disabled={busy} onClick={() => run(() => command('resolve'))}>
                手続きをいま締め切る
              </button>
            )}
            {view.status === 'running' && (
              <>
                {/* ⚠ **1ターン＝実時間1時間＝ゲーム内1日**。「1日進める」と書くと
                    どちらの1日か分からない（24ターンでゲーム内は24日進む）。
                    ターン数とゲーム内の日数を両方書く */}
                <button disabled={busy} onClick={() => run(() => command('step'))}>
                  1ターン進める（ゲーム内1日）
                </button>
                <button
                  disabled={busy}
                  onClick={() => run(() => command('step', { turns: 24 }))}
                >
                  24ターン進める（ゲーム内24日）
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {restoreConfirm && (
        <div role="alert">
          <p>
            現在の進行を保存済みのバックアップへ戻します。復元後は停止したままです。
          </p>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await command('restore');
                setRestoreConfirm(false);
              })
            }
          >
            復元を実行
          </button>
          <button disabled={busy} onClick={() => setRestoreConfirm(false)}>
            キャンセル
          </button>
        </div>
      )}
    </section>
  );
}
