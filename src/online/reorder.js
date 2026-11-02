// 並べ替えの共通部品（打順・先発ローテ・獲得希望リストで使う）。
//
// ⚠ **ブラウザ標準のドラッグ（draggable / dragstart）は使わない**。スマホの指では
//    動かず、以前はPCでしかドラッグできなかった。ここではポインター操作で自前に動かす。
// ⚠ つまみ（≡）を押したときだけ動かす。行のどこでも動くようにすると、
//    スマホで画面をスクロールしようとしただけで並びが変わる。
//    つまみには CSS で `touch-action: none` を付ける（付けないとスクロールに取られる）。
// ⚠ キーボードでも動かせる：つまみにフォーカスして ↑ / ↓。以前の ↑↓ ボタンの代わり。
import { useEffect, useRef, useState } from 'react';

const EDGE = 72; // 画面の上下この幅に入ったら自動でスクロールする
const SPEED = 14;

/**
 * `onMove(from, to)` は「from の行を抜いて to の位置に入れる」。
 * 返す `rowProps(i)` を行に、`handleProps(i, label)` をつまみのボタンに付ける。
 */
export function useReorder({ count, onMove, disabled = false }) {
  const rows = useRef([]);
  const session = useRef(null);
  const [drag, setDrag] = useState(null);
  const focusAfter = useRef(null);

  useEffect(() => {
    if (focusAfter.current === null) return;
    const node = rows.current[focusAfter.current];
    focusAfter.current = null;
    node?.querySelector('.online-drag-handle')?.focus();
  });

  // 抜いた行を除いて、指の位置より中心が上にある行の数＝入る位置
  const targetFor = (s, pageY) => {
    let to = 0;
    s.mids.forEach((mid, i) => {
      if (i !== s.from && mid < pageY) to++;
    });
    return to;
  };
  const update = () => {
    const s = session.current;
    if (!s) return;
    const pageY = s.clientY + window.scrollY;
    const to = targetFor(s, pageY);
    setDrag({ from: s.from, to, dy: pageY - s.startY });
  };
  const loop = () => {
    const s = session.current;
    if (!s) return;
    const step =
      s.clientY < EDGE ? -SPEED : s.clientY > window.innerHeight - EDGE - 64 ? SPEED : 0;
    if (step) {
      window.scrollBy(0, step);
      update();
    }
    s.frame = requestAnimationFrame(loop);
  };
  const finish = (commit) => {
    const s = session.current;
    if (!s) return;
    cancelAnimationFrame(s.frame);
    session.current = null;
    const to = targetFor(s, s.clientY + window.scrollY);
    setDrag(null);
    if (commit && to !== s.from) onMove(s.from, to);
  };

  const rowProps = (i) => {
    const active = drag && drag.from === i;
    const drop =
      drag && drag.from !== i && drag.to === i
        ? drag.to > drag.from
          ? 'after'
          : 'before'
        : undefined;
    return {
      ref: (node) => {
        rows.current[i] = node;
      },
      'data-dragging': active || undefined,
      'data-drop': drop,
      style: active ? { transform: `translateY(${drag.dy}px)` } : undefined,
    };
  };

  const handleProps = (i, label) => ({
    type: 'button',
    className: 'online-drag-handle',
    'aria-label': label,
    title: 'ドラッグで並べ替え（↑↓キーでも動きます）',
    disabled,
    onPointerDown: (e) => {
      if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const mids = rows.current.slice(0, count).map((node) => {
        const r = node?.getBoundingClientRect();
        return r ? r.top + r.height / 2 + window.scrollY : Infinity;
      });
      session.current = {
        from: i,
        mids,
        clientY: e.clientY,
        startY: e.clientY + window.scrollY,
        frame: 0,
      };
      setDrag({ from: i, to: i, dy: 0 });
      session.current.frame = requestAnimationFrame(loop);
    },
    onPointerMove: (e) => {
      if (!session.current) return;
      session.current.clientY = e.clientY;
      update();
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onLostPointerCapture: () => finish(true),
    onKeyDown: (e) => {
      if (disabled) return;
      const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      if (!delta) return;
      e.preventDefault();
      const to = i + delta;
      if (to < 0 || to >= count) return;
      focusAfter.current = to;
      onMove(i, to);
    },
  });

  return { rowProps, handleProps, dragging: !!drag };
}

/** 配列の from 番目を抜いて to 番目に入れた新しい配列 */
export function moveItem(list, from, to) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
