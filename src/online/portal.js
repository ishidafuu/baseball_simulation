import { createPortal } from 'react-dom';
// ⚠ **ダイアログは一覧の外（`.online` の直下）へ描くこと**。
//    試合カード（`.online-score`）の中で描くと、カード用の
//    `.online-score div { grid 1fr auto 1fr }` などがダイアログの中まで効き、
//    観戦リプレイのメンバー表が幅16pxに潰れ、スマホの試合経過も崩れていた。
//    `.online` の外（body）へ出すと、今度はボタンや文字の基本の見た目が外れる。
export function inOnlineRoot(node) {
  const root =
    typeof document === 'undefined' ? null : document.querySelector('.online');
  return root ? createPortal(node, root) : node;
}
