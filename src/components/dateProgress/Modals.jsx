import React from 'react';
import { KOSHIEN_STAGE_LABEL } from '../../season/koshien.js';
import { addToWatchList, removeFromWatchList, isWatched } from '../../game/watchList.js';
import { highSchoolPool } from '../../state/schoolPools.js';

// ============================================================
// 日程進行画面のモーダル（`DateProgressScreen` から抽出）
//
// どちらも**表示だけ**を持つ。開閉と副作用は呼び出し側の state に残してある
// （`DateProgressScreen` が持つ state を props で渡さないと、
//   同じ状態が2箇所に生まれる）。
// ============================================================

/**
 * 夏の甲子園の結果。操作はできないが、ここで見た選手がスカウト・ドラフトに繋がる。
 * @param onWatchChange 注目リストを触ったら呼ぶ（親の再描画トリガー）
 */
export const KoshienNoticeModal = ({ notice, year, gameYear, watchTick, onClose, onWatchChange }) => {
  if (!notice) return null;
  return (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => onClose()}>
    <div className="bg-surface-2 rounded-xl shadow-2xl border border-gray-700 max-w-3xl w-full flex flex-col"
         style={{ maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
      <div className="px-5 py-3 border-b border-gray-700 shrink-0">
        <div className="text-xs text-amber-300 font-bold tracking-widest">全国高等学校野球選手権</div>
        <h3 className="text-white font-bold text-lg mt-0.5">
          {notice.champion} <span className="text-sm text-gray-300 font-medium">が優勝</span>
        </h3>
        <p className="text-xs text-gray-300 mt-1">
          準優勝 {notice.runnerUp} ／ 出場{notice.entries.length}校
        </p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
        <div className="text-xs text-gray-300 mb-2">
          大会で名前を売った選手です。<b className="text-amber-200">知名度</b>はドラフト評価とスカウトでの発見しやすさに影響します。
        </div>
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-gray-300 border-b border-gray-700">
              <th className="text-left py-1 font-medium">成績</th>
              <th className="text-left py-1 font-medium">高校</th>
              <th className="text-left py-1 font-medium">選手</th>
              <th className="text-left py-1 font-medium">能力</th>
              <th className="text-right py-1 font-medium">知名度</th>
              <th className="text-center py-1 font-medium">注目</th>
            </tr>
          </thead>
          <tbody>
            {notice.notable.map((n, i) => (
              <tr key={i} className="border-b border-gray-700/50">
                <td className="py-1 text-amber-200">{KOSHIEN_STAGE_LABEL[n.stage]}</td>
                <td className="py-1 text-gray-200">{n.school}<span className="text-gray-300 ml-1">{n.pref}</span></td>
                <td className="py-1 text-white font-medium">{n.name}<span className="text-cyan-300 ml-1.5">{n.role}</span></td>
                <td className="py-1 text-gray-200">{n.detail}</td>
                <td className="py-1 text-right text-amber-300 font-bold">{n.fame}</td>
                <td className="py-1 text-center">
                  {(() => {
                    const watched = (watchTick, isWatched(n.playerId));
                    return (
                      <button
                        title={watched ? '注目リストから外す' : '注目リストに追加（進路先まで追えます）'}
                        onClick={() => {
                          if (watched) removeFromWatchList(n.playerId);
                          else {
                            const pl = (highSchoolPool.players || []).find(p => p.id === n.playerId);
                            if (pl) addToWatchList(pl, gameYear || 1, `甲子園${KOSHIEN_STAGE_LABEL[n.stage]}`);
                          }
                          onWatchChange();
                        }}
                        className={`px-1.5 rounded text-sm leading-none transition ${
                          watched ? 'text-amber-300 hover:text-amber-200' : 'text-gray-300 hover:text-gray-200'}`}>
                        {watched ? '★' : '☆'}
                      </button>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 border-t border-gray-700 flex justify-end shrink-0">
        <button onClick={() => onClose()}
          className="btn-warn px-4 py-2 rounded-lg text-sm transition">
          閉じる
        </button>
      </div>
    </div>
  </div>
  );
};

/** フェーズ移行の確認。「進む」で `onProceed(eventType)` を呼ぶ */
export const PhaseTransitionModal = ({ event, onClose, onProceed }) => {
  if (!event) return null;
  return (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
    <div className="bg-surface-2 rounded-xl shadow-2xl border border-gray-700 max-w-sm w-full">
      <div className="px-5 py-4 border-b border-gray-700">
        <h3 className="text-white font-bold text-lg">{event.label}</h3>
        <p className="text-gray-300 text-sm mt-1">{event.desc}</p>
      </div>
      <div className="px-5 py-4 flex justify-end gap-3">
        <button
          onClick={() => {
            onClose();
          }}
          className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium transition"
        >
          キャンセル
        </button>
        <button
          onClick={() => {
            onProceed(event.eventType);
          }}
          className="btn-primary px-4 py-2 rounded-lg text-sm transition"
        >
          進む
        </button>
      </div>
    </div>
  </div>
  );
};
