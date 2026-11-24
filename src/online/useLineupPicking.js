import { useState } from 'react';
import {
  swapOrder,
  swapPositions,
  replaceStarter,
  positionFitness,
  LOW_FITNESS,
} from './lineupEdit.js';

// ============================================================
// スタメン設定の表の「選ぶ・入れ替える・ドラッグする」の中身。
// オンラインPC版（`LineupBoard.jsx`）と一人用（`components/lineup/SoloLineupBoard.jsx`）で共通。
// ⚠ 以前は2つの画面に同じ処理の写しがあった（2026-11-23 監査の「大きな整理の候補」9）。
//
// 【操作】行を押して選び、もう一方を押すと入れ替わる:
//   打順どうし＝打順（`swapOrder`）、守備位置どうし＝守備（`swapPositions`）、
//   打順と控え＝交代（`replaceStarter`）。ドラッグでも同じ（落とした先の行で決まる）。
//   ⚠ 打順の行 → 打順の行は「2人の打順を入れ替える」（間の選手は動かさない）。
//   前は「その打順へ動かす（間はずれる）」で、入れ替えたつもりが下の選手が全員1つずれた。
//
// `order` は今の並び、`byId` は名簿の引き当て、`commit(next)` は並びを書く関数
// （選択を外すのはここで行う）。`onPickPosition` は守備位置を選んだとき（守備図を開く）。
// ============================================================

export function useLineupPicking({ order, byId, commit, onPickPosition }) {
  const [selection, setSelection] = useState(null);
  const [drag, setDrag] = useState(null);
  const [dropAt, setDropAt] = useState(null);
  const apply = (next) => {
    setSelection(null);
    commit(next);
  };

  const selectedRow = selection?.kind === 'row' ? selection.index : null;
  const selectedPos = selection?.kind === 'pos' ? selection.index : null;
  const selectedBench =
    selection?.kind === 'bench' ? byId.get(selection.playerId) : null;
  const focusPosition =
    selectedRow !== null ? order[selectedRow]?.position : null;

  // ---- 操作（クリック）
  const clickRow = (index) => {
    if (selectedRow !== null && selectedRow !== index)
      apply(swapOrder(order, selectedRow, index));
    else if (selectedBench) apply(replaceStarter(order, index, selectedBench.id));
    else if (selectedPos !== null && selectedPos !== index)
      apply(swapPositions(order, selectedPos, index));
    else setSelection(selectedRow === index ? null : { kind: 'row', index });
  };
  const clickPosition = (index) => {
    if (selectedPos !== null && selectedPos !== index)
      apply(swapPositions(order, selectedPos, index));
    else {
      setSelection(selectedPos === index ? null : { kind: 'pos', index });
      onPickPosition?.();
    }
  };
  const clickBench = (playerId) => {
    if (selectedRow !== null) apply(replaceStarter(order, selectedRow, playerId));
    else
      setSelection(
        selection?.kind === 'bench' && selection.playerId === playerId
          ? null
          : { kind: 'bench', playerId },
      );
  };

  // ---- 操作（ドラッグ）。落とした先の行で、運んだものに応じて決まる
  //   打順の行 → 打順の行: 打順を入れ替える / 守備位置 → 打順の行: 守備位置を入れ替える
  //   控え → 打順の行 / 打順の行 → 控え: 交代
  const startDrag = (payload) => (e) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    // Firefox はデータが無いとドラッグを始めない
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    setDrag(payload);
    setSelection(null);
  };
  const endDrag = () => {
    setDrag(null);
    setDropAt(null);
  };
  const over = (target) => (e) => {
    if (!drag) return;
    if (target.kind === 'bench' && drag.kind !== 'row') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (
      dropAt?.kind !== target.kind ||
      dropAt?.index !== target.index ||
      dropAt?.playerId !== target.playerId
    )
      setDropAt(target);
  };
  const leave = () => setDropAt(null);
  const dropOn = (target) => (e) => {
    e.preventDefault();
    const d = drag;
    endDrag();
    if (!d) return;
    if (target.kind === 'row') {
      if (d.kind === 'row') apply(swapOrder(order, d.index, target.index));
      else if (d.kind === 'pos') apply(swapPositions(order, d.index, target.index));
      else if (d.kind === 'bench') apply(replaceStarter(order, target.index, d.playerId));
    } else if (target.kind === 'bench' && d.kind === 'row') {
      apply(replaceStarter(order, d.index, target.playerId));
    }
  };

  // 打順の行の印（選択・落とし先・運んでいる行・選んだ控えが守れる位置）。
  // ⚠ 指名打者の枠は守備の適性で光らせない（一人用のDH制）
  const rowClass = (index) =>
    [
      'online-lineup-row',
      selectedRow === index ? 'is-selected' : '',
      drag && dropAt?.kind === 'row' && dropAt.index === index
        ? `is-drop is-drop-${drag.kind}`
        : '',
      drag?.kind === 'row' && drag.index === index ? 'is-dragging' : '',
      selectedBench &&
      order[index]?.position !== 'dh' &&
      positionFitness(selectedBench, order[index]?.position) >= LOW_FITNESS
        ? 'is-fit'
        : '',
    ]
      .filter(Boolean)
      .join(' ');

  return {
    selection,
    setSelection,
    clearSelection: () => setSelection(null),
    selectedRow,
    selectedPos,
    selectedBench,
    focusPosition,
    drag,
    dropAt,
    clickRow,
    clickPosition,
    clickBench,
    startDrag,
    endDrag,
    over,
    leave,
    dropOn,
    rowClass,
  };
}
