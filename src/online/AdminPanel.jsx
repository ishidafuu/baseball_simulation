import React, { useState } from 'react';

// リーグ管理（停止・再開・バックアップ・検証モード）。PCとスマホで共用する。
// ⚠ スマホからも開けること。以前はPCだけで、外出先で止められなかった
export default function Admin({ view, busy, run, command, allowStep }) {
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
