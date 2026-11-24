import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PitchingBoard from './PitchingBoard.jsx';
import {
  restoreFromFullLineup,
  fullLineupFromBoards,
  rebaseLineupSave,
  sameValue,
  LINEUP_BOARD_KEYS,
  PITCHING_BOARD_KEYS,
} from './lineupBridge.js';
import { restoreFromTapDraft } from './tapLineup.js';
import { teamLabel } from './gameText.js';
import { LINEUP_ORDER_DRAFT, useDraftMemoryStore, useDraftState } from './Drafts.jsx';
import { useLook } from './look/LookContext.jsx';

// ============================================================
// スマホ版の投手起用。**PC版と同じ1枚の表（`PitchingBoard.jsx`）を全画面で出す**。
//
// ⚠ スマホの打順・守備・控えは「打順」の2タップの表（`TapLineup.jsx`）で決める。
//    投手起用（ローテ・役割）だけをここで決める（横に長い表なので横向き推奨）。
//    入口は「打順」のタブの「投手起用を開く」（`MobileView.jsx`）。
// ⚠ 以前は一人用の編成画面（`LineupSettingContent` の従来の画面、約1000行）を
//    `team` 形の複製で動かしていた。PCと一人用が1枚の表になったあと、ここだけが
//    従来の画面を使っていたので、PCと同じ表に置き換えて従来の画面を消した。
// ⚠ 保存するのは投手起用の項目だけ（`PITCHING_BOARD_KEYS`。PCと同じ）。打順の
//    保存していない編集は「打順」の表に残る（以前は全画面で一緒に保存していた）。
//
// 【スマホとPCの受け渡し】スマホを横にするとPCの画面に切り替わる（逆も）。
//    保存していない編集は `lineup.full` に、PCと同じ形（`fullLineupFromBoards`）で写す。
//    打順の表の下書き（`lineup.order`）に編集があれば、それも一緒に写す
//    （PCではスタメン設定と投手起用の両方に未保存の編集が渡る）。
// ⚠ 全画面は `.online` の**外**（body 直下）へポータルで出す。PCの部品のクラスを
//    使うので、`.online.online-desktop` で包む（狭い幅への合わせは `online.css` の `.online-lineup-portal`）。
// ============================================================

/** スマホ版。横に長い表なので、押したときだけ全画面で被せる */
export default function MobilePitching({ view, busy, onSave, onClose }) {
  const memory = useDraftMemoryStore();
  const look = useLook();
  const [orderDraft] = useDraftState(LINEUP_ORDER_DRAFT, null);
  // 開いたときに1回だけ決める（回転して戻ってきた・PCから渡された編集）
  const [restore] = useState(() =>
    restoreFromFullLineup(memory?.get('lineup.full')),
  );
  const viewRef = useRef(view);
  viewRef.current = view;
  // 打順の保存していない編集（PCへ一緒に渡すため）。打順の表の下書きにあればそれ、
  // 無ければ開いたときに受け取った編集（PCのスタメン設定で編集してスマホに切り替えた）。
  // ⚠ 受け取った打順の編集を落とさないこと。ここで写し直すと `lineup.full` から消え、
  //    PCに戻したときにスタメン設定の編集が消えていた
  const [handedOrder] = useState(() =>
    restore && !sameValue(restore.lineup.battingOrder, restore.base?.battingOrder)
      ? {
          keys: LINEUP_BOARD_KEYS,
          plan: { battingOrder: restore.lineup.battingOrder },
          baseLineup: restore.base,
        }
      : null,
  );
  const orderPart = () => {
    const tap = restoreFromTapDraft(orderDraft);
    return tap
      ? {
          keys: LINEUP_BOARD_KEYS,
          plan: { battingOrder: tap.lineup.battingOrder },
          baseLineup: tap.base,
        }
      : handedOrder;
  };
  const write = (pitching) => {
    if (!memory) return;
    const full = fullLineupFromBoards(
      viewRef.current,
      [orderPart(), pitching].filter(Boolean),
    );
    if (full) memory.set('lineup.full', full);
    else memory.delete('lineup.full');
  };
  const writeRef = useRef(write);
  writeRef.current = write;
  const onDraft = useCallback((draft) => {
    writeRef.current(
      draft.dirty
        ? { keys: PITCHING_BOARD_KEYS, plan: draft.plan, baseLineup: draft.baseLineup }
        : null,
    );
  }, []);
  const close = () => {
    write(null);
    onClose();
  };
  const save = async (plan, baseLineup) => {
    // ⚠ **失敗したら閉じない**（PCと同じ）。閉じると編集がまるごと消える
    const result = await onSave(
      rebaseLineupSave(plan, baseLineup, view.lineup, PITCHING_BOARD_KEYS),
    );
    if (result?.ok) close();
    return result;
  };

  return createPortal(
    <div
      className={`online online-desktop online-lineup-portal fixed inset-0 z-50 overflow-y-auto${look.on ? ' online-look' : ''}`}
    >
      <div className="online-lineup-portal-bar">
        <strong>{teamLabel(view.teamName)}</strong>
        {/* ⚠ 閉じた先は「打順」の2タップの表（`MobileView.jsx`） */}
        <button type="button" disabled={busy} onClick={close}>
          打順に戻る（保存しない）
        </button>
      </div>
      <PitchingBoard
        view={view}
        busy={busy}
        restore={restore}
        onSave={save}
        onDraft={onDraft}
      />
    </div>,
    document.body,
  );
}
