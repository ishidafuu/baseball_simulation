// 一人用モードのお知らせ・確認ダイアログ。
// ⚠ **ブラウザ標準の alert / confirm を使わない**。標準のダイアログは
//    「127.0.0.1:3000 の内容」のようなURL付きの見た目で、ゲームの画面から浮いていた。
//    スマホでは画面全体が止まり、文字も小さかった。
// 出す関数は utils/gameDialog.js（showMessage / askConfirm）。ここは表示だけ。
import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { subscribe, finish, getQueue } from '../utils/gameDialog.js';

export function GameDialogHost() {
  const items = useSyncExternalStore(subscribe, getQueue);
  const item = items[0];
  if (!item) return null;
  return <GameDialog key={item.id} item={item} />;
}

function GameDialog({ item }) {
  const dialog = useRef(null);
  const ok = useRef(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal?.();
    ok.current?.focus();
    return () => node?.open && node.close();
  }, []);
  const isConfirm = item.kind === 'confirm';
  const close = (value) => finish(item, value);
  return (
    <dialog
      ref={dialog}
      className="game-dialog"
      aria-labelledby={item.title ? 'game-dialog-title' : undefined}
      aria-describedby="game-dialog-message"
      onCancel={(e) => {
        e.preventDefault();
        close(false);
      }}
    >
      {item.title && (
        <h2 id="game-dialog-title" className="text-base font-bold text-white mb-2">
          {item.title}
        </h2>
      )}
      <p id="game-dialog-message" className="text-sm text-gray-100 whitespace-pre-line leading-relaxed">
        {item.message}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        {isConfirm && (
          <button className="btn-secondary px-4 py-2 rounded-lg text-sm" onClick={() => close(false)}>
            {item.cancelLabel}
          </button>
        )}
        <button
          ref={ok}
          className={`${item.danger ? 'btn-danger' : 'btn-primary'} px-4 py-2 rounded-lg text-sm`}
          onClick={() => close(true)}
        >
          {isConfirm ? item.okLabel : 'OK'}
        </button>
      </div>
    </dialog>
  );
}
