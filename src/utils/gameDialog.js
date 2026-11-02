// 一人用モードのお知らせ・確認ダイアログ。
// ⚠ **ブラウザ標準の alert / confirm を使わない**。標準のダイアログは
//    「127.0.0.1:3000 の内容」のようなURL付きの見た目で、ゲームの画面から浮いていた。
//    スマホでは画面全体が止まり、文字も小さかった。
// 使い方:
//   showMessage('保存しました')                    … お知らせ（待たない）
//   if (!(await askConfirm('上書きしますか？'))) return;  … 確認（OK で true）
//   askConfirm(文, { danger: true, okLabel: '削除する' }) … 取り消せない操作は赤いボタン
// 画面には <GameDialogHost />（components/GameDialog.jsx）を1つだけ置く（main.jsx）。
// ⚠ ここは React を読み込まない。ノードで動く検証（tools/）からも読まれる game/ のファイルが使うため
let queue = [];
let nextId = 1;
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
export const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const push = (item) => {
  queue = [...queue, { ...item, id: nextId++ }];
  emit();
};
export const finish = (item, value) => {
  queue = queue.filter((q) => q.id !== item.id);
  emit();
  item.resolve?.(value);
};

/** お知らせを出す。閉じるのを待たずに処理は続く */
export function showMessage(message, { title } = {}) {
  push({ kind: 'message', message: String(message ?? ''), title });
}

/** 確認を出す。OK なら true、キャンセルなら false で解決する */
export function askConfirm(message, { title, okLabel = 'OK', cancelLabel = 'キャンセル', danger = false } = {}) {
  return new Promise((resolve) => {
    push({ kind: 'confirm', message: String(message ?? ''), title, okLabel, cancelLabel, danger, resolve });
  });
}

export const getQueue = () => queue;
