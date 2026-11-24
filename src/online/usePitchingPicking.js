import { useCallback, useState } from 'react';

// ============================================================
// 投手起用の表の「選ぶ・入れ替える・見出しへ移す・ドラッグ・役割の一覧の位置」の中身。
// オンラインPC版（`PitchingBoard.jsx`）と一人用（`components/lineup/SoloPitchingBoard.jsx`）で共通。
// ⚠ 以前は2つの画面に同じ処理の写しがあった（2026-11-23 監査の「大きな整理の候補」9）。
//
// 【操作】行を押して選び、ほかの行を押すと持ち場を入れ替える（`swap`）。
//   選んでから見出しを押す・見出しへ落とすと、そこへ移す（`moveTo`）。ドラッグでも同じ。
//   役割の札を押すと、札の下に役割の一覧が出る（`openMenu`）。
// 違い（一人用の「役割なし」・野手は先発に入れない）は渡す関数で決める:
//   `swap(a, b)` / `moveTo(id, head)` は次の状態を返す（動かせないなら今の状態をそのまま）。
//   `canMoveTo(id, head)` は見出しを光らせるか、`canSwap(a, b)`（省略可）は行へ落とせるか。
//   `heads` は見出しの名前（'rotation' など）。`commit(next)` は次の状態を書く関数。
//   `menuHeight(player)` は役割の一覧の背の高さ（画面の下で切れないように上へずらす）。
// ⚠ 関数は押したときに呼ぶ（描画のときには呼ばない）。今の状態はその時の値を使う。
// ============================================================

const MENU_WIDTH = 420;

export function usePitchingPicking({
  commit,
  swap,
  canSwap,
  canMoveTo,
  moveTo,
  heads,
  menuHeight,
}) {
  const [selection, setSelection] = useState(null);
  const [menu, setMenu] = useState(null);
  const [drag, setDrag] = useState(null);
  const [dropAt, setDropAt] = useState(null);
  const clearSelection = useCallback(() => {
    setSelection(null);
    setMenu(null);
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const apply = (next) => {
    setSelection(null);
    setMenu(null);
    commit(next);
  };
  const isHead = (target) => heads.includes(target);

  // ---- クリック
  const clickRow = (id) => {
    if (selection !== null && selection !== id) apply(swap(selection, id));
    else setSelection(selection === id ? null : id);
  };
  const clickHead = (target) => {
    if (selection !== null) apply(moveTo(selection, target));
  };
  const openMenu = (player) => (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setSelection(null);
    setMenu(
      menu?.id === player.id
        ? null
        : {
            id: player.id,
            name: player.name,
            fielder: player.position !== 'pitcher',
            top: Math.max(
              8,
              Math.min(rect.bottom + 4, window.innerHeight - menuHeight(player)),
            ),
            left: Math.max(
              8,
              Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8),
            ),
          },
    );
  };

  // ---- ドラッグ: 落とした先で決まる（行＝入れ替え、見出し＝そこへ移す）
  const startDrag = (id) => (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
    setDrag(id);
    setSelection(null);
    setMenu(null);
  };
  const endDrag = () => {
    setDrag(null);
    setDropAt(null);
  };
  const over = (target) => (e) => {
    if (drag === null) return;
    if (isHead(target) ? !canMoveTo(drag, target) : canSwap && !canSwap(drag, target))
      return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropAt !== target) setDropAt(target);
  };
  const dropOn = (target) => (e) => {
    e.preventDefault();
    const id = drag;
    endDrag();
    if (id === null) return;
    if (isHead(target)) apply(moveTo(id, target));
    else if (target !== id) apply(swap(id, target));
  };
  const dropProps = (target) => ({
    onDragOver: over(target),
    onDragLeave: () => setDropAt(null),
    onDrop: dropOn(target),
  });

  // ---- 表示の印
  const rowClass = (id, extra = []) =>
    [
      'online-lineup-row',
      selection === id ? 'is-selected' : '',
      drag === id ? 'is-dragging' : '',
      dropAt === id ? 'is-drop' : '',
      ...extra,
    ]
      .filter(Boolean)
      .join(' ');
  const headClass = (target) =>
    [
      'online-lineup-bench-head',
      dropAt === target ? 'is-drop' : '',
      selection !== null && canMoveTo(selection, target) ? 'is-target' : '',
    ]
      .filter(Boolean)
      .join(' ');
  const pickLabel = (id, name) =>
    selection !== null && selection !== id ? `${name}と入れ替える` : `${name}を選ぶ`;

  return {
    selection,
    menu,
    clearSelection,
    closeMenu,
    apply,
    clickRow,
    clickHead,
    openMenu,
    startDrag,
    endDrag,
    dropProps,
    rowClass,
    headClass,
    pickLabel,
  };
}
