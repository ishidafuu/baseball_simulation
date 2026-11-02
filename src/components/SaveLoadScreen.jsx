import React, { useState, useEffect } from 'react';
import { ScreenShell, ScreenHeader } from './GameUIComponents.jsx';
import { getEmergencyInfo, promoteEmergencyToSlot, clearEmergencySave, getBackupInfo, restoreBackup, getAutosaveInfo, exportSaveSlotToFile, importSaveFileToSlot } from '../game/saveSystem.js';
import { askConfirm } from '../utils/gameDialog.js';

// セーブ＆ロード画面（3スロット対応）
const SaveLoadScreen = ({ onSave, onLoad, onLoadAutosave, onDelete, saveSlots, seasonData, onReturnToTitle, onSlotsChanged }) => {
  const [saveStatus, setSaveStatus] = useState(null);
  const [saveProgress, setSaveProgress] = useState(0);
  const [emergencyInfo, setEmergencyInfo] = useState(null);
  const [backupInfos, setBackupInfos] = useState([null, null, null]);
  const [autosaveInfo, setAutosaveInfo] = useState(null);

  // 緊急バックアップ・各スロットの世代バックアップ・オートセーブの有無を取得
  useEffect(() => {
    let alive = true;
    (async () => {
      setEmergencyInfo(getEmergencyInfo());
      setAutosaveInfo(await getAutosaveInfo());
      const infos = await Promise.all([0, 1, 2].map(i => getBackupInfo(i)));
      if (alive) setBackupInfos(infos);
    })();
    return () => { alive = false; };
  }, [saveSlots]);

  const handleLoadAutosave = async () => {
    if (!onLoadAutosave) return;
    if (!(await askConfirm('オートセーブをロードします。現在の進行データは失われます。よろしいですか？'))) return;
    setSaveStatus({ type: 'loading' });
    const result = await onLoadAutosave();
    setSaveStatus(result?.success ? { type: 'loaded' } : { type: 'error', message: result?.error || 'ロードに失敗しました' });
    setTimeout(() => setSaveStatus(null), 4000);
  };

  const handleSave = async (slotIndex) => {
    setSaveProgress(0);
    setSaveStatus({ type: 'saving' });
    const result = await onSave(slotIndex, (pct) => setSaveProgress(pct));
    if (result?.success) {
      setSaveStatus({ type: 'saved' });
    } else {
      setSaveStatus({ type: 'error', message: result?.error || 'セーブに失敗しました' });
    }
    setTimeout(() => setSaveStatus(null), 4000);
  };

  const handleLoad = async (slotIndex, skipConfirm = false) => {
    if (skipConfirm || (await askConfirm('現在の進行データは失われます。ロードしますか？', { okLabel: 'ロードする' }))) {
      setSaveStatus({ type: 'loading' });
      const result = await onLoad(slotIndex);
      if (result?.success) {
        setSaveStatus({ type: 'loaded' });
      } else {
        setSaveStatus({ type: 'error', message: result?.error || 'ロードに失敗しました' });
      }
      setTimeout(() => setSaveStatus(null), 4000);
    }
  };

  // ファイルへ書き出す／ファイルから読み込む。
  // ⚠ **ブラウザの保存領域はオリジンを跨げない**ので、ポートが変わった・別のブラウザ・
  //    別のPCへ移す、のいずれもここを通すしかない。バックアップの正規の手段でもある。
  const handleExport = async (slotIndex) => {
    const r = await exportSaveSlotToFile(slotIndex);
    if (!r.success) { setSaveStatus({ type: 'error', message: r.error }); setTimeout(() => setSaveStatus(null), 4000); }
  };

  const handleImport = (slotIndex) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (saveSlots[slotIndex] && !(await askConfirm(`スロット${slotIndex + 1}を上書きします。よろしいですか？（上書き前のデータは「1つ前のセーブに戻す」で戻せます）`, { okLabel: '上書きする' }))) return;
      setSaveStatus({ type: 'loading' });
      const r = await importSaveFileToSlot(slotIndex, file);
      setSaveStatus(r.success ? { type: 'imported' } : { type: 'error', message: r.error });
      if (r.success && onSlotsChanged) await onSlotsChanged();
      setTimeout(() => setSaveStatus(null), 4000);
    };
    input.click();
  };

  // 緊急バックアップを指定スロットへ復元してロード
  const handleRestoreEmergency = async (slotIndex) => {
    if (!(await askConfirm(`緊急バックアップをスロット${slotIndex + 1}へ復元してプレイします。よろしいですか？`))) return;
    const r = await promoteEmergencyToSlot(slotIndex);
    if (r.success) {
      clearEmergencySave();
      setEmergencyInfo(null);
      await handleLoad(slotIndex, true);
    } else {
      setSaveStatus({ type: 'error', message: r.error || '復元に失敗しました' });
      setTimeout(() => setSaveStatus(null), 4000);
    }
  };

  // 1世代前のバックアップへ戻してロード
  const handleRestoreBackup = async (slotIndex) => {
    if (!(await askConfirm(`スロット${slotIndex + 1}を1つ前のバックアップに戻してプレイします。現在のスロット内容は上書きされます。よろしいですか？`))) return;
    const r = await restoreBackup(slotIndex);
    if (r.success) {
      await handleLoad(slotIndex, true);
    } else {
      setSaveStatus({ type: 'error', message: r.error || '復元に失敗しました' });
      setTimeout(() => setSaveStatus(null), 4000);
    }
  };

  const handleDelete = async (slotIndex) => {
    if (await askConfirm('セーブデータを削除しますか？この操作は取り消せません。', { danger: true, okLabel: '削除する' })) {
      const success = await onDelete(slotIndex);
      setSaveStatus(success ? { type: 'deleted' } : { type: 'error', message: '削除に失敗しました' });
      setTimeout(() => setSaveStatus(null), 4000);
    }
  };

  const formatTimestamp = (ts) => {
    if (!ts) return '---';
    const date = new Date(ts);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  const getPhaseLabel = (phase) => {
    const labels = {
      spring_camp: '春季キャンプ',
      regular_season: 'レギュラーシーズン',
      playoffs: 'プレーオフ',
      draft: 'ドラフト',
      tryout: 'トライアウト',
      offseason: 'オフシーズン'
    };
    return labels[phase] || phase;
  };

  const slotNames = ['セーブスロット 1', 'セーブスロット 2', 'セーブスロット 3'];

  return (
    <ScreenShell width="form">
      <ScreenHeader title="セーブ＆ロード" />

      {/* ステータスメッセージ */}
      {saveStatus && (
        <div className={`mb-6 p-4 rounded-lg font-bold text-center ${
          saveStatus.type === 'saving' ? 'bg-gray-700 text-white' :
          saveStatus.type === 'loading' ? 'bg-gray-600 text-white animate-pulse' :
          saveStatus.type === 'saved' ? 'bg-green-600 text-white' :
          saveStatus.type === 'loaded' ? 'bg-blue-600 text-white' :
          saveStatus.type === 'imported' ? 'bg-blue-600 text-white' :
          saveStatus.type === 'deleted' ? 'bg-yellow-600 text-white' :
          'bg-red-600 text-white'
        }`}>
          {saveStatus.type === 'saving' && (
            <div>
              <div className="mb-2">💾 セーブ中...</div>
              <div className="w-full bg-gray-500 rounded-full h-3 overflow-hidden">
                <div
                  className="h-3 rounded-full bg-green-400 transition-all duration-300"
                  style={{ width: `${saveProgress}%` }}
                />
              </div>
              <div className="text-xs text-gray-300 mt-1">{saveProgress}%</div>
            </div>
          )}
          {saveStatus.type === 'loading' && '📂 ロード中...'}
          {saveStatus.type === 'saved' && '✅ セーブしました'}
          {saveStatus.type === 'loaded' && '✅ ロードしました'}
          {saveStatus.type === 'deleted' && '🗑️ 削除しました'}
          {saveStatus.type === 'imported' && '✅ ファイルからセーブを読み込みました'}
          {saveStatus.type === 'error' && (
            <div>
              <div>❌ エラーが発生しました</div>
              {saveStatus.message && <div className="text-sm font-normal mt-1">{saveStatus.message}</div>}
            </div>
          )}
        </div>
      )}

      {/* 緊急バックアップ復旧バナー（前回クラッシュ時に自動保存されたデータ） */}
      {emergencyInfo && (
        <div className="mb-6 p-4 rounded-lg border-2 border-amber-500/60 bg-amber-900/20">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-amber-300 font-bold">🛟 緊急バックアップが見つかりました</span>
          </div>
          <p className="text-sm text-gray-300 mb-3">
            前回アプリが予期せず終了した際の進行データです（{emergencyInfo.year ? `${emergencyInfo.year}年目・` : ''}{emergencyInfo.gameMode || ''}／{formatTimestamp(emergencyInfo.timestamp)}）。復元先のスロットを選んでください。
          </p>
          <div className="flex gap-2 flex-wrap">
            {[0, 1, 2].map(i => (
              <button key={i} onClick={() => handleRestoreEmergency(i)}
                className="btn-warn px-3 py-1.5 rounded text-sm">
                スロット{i + 1}へ復元
              </button>
            ))}
            <button onClick={() => { clearEmergencySave(); setEmergencyInfo(null); }}
              className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">
              破棄
            </button>
          </div>
        </div>
      )}

      {/* 現在の進行状況 */}
      <div className="bg-surface-2 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-bold text-white mb-4">📍 現在の進行状況</h2>
        {seasonData ? (
          <div className="text-gray-300">
            <p className="mb-2">シーズン: <span className="text-yellow-400 font-bold">{seasonData.year}年目</span></p>
            <p className="mb-2">日付: <span className="text-white">{seasonData.currentDate?.month}月{seasonData.currentDate?.day}日</span></p>
            <p>フェーズ: <span className="text-blue-400">{getPhaseLabel(seasonData.phase)}</span></p>
          </div>
        ) : (
          <p className="text-gray-400">ゲームが開始されていません</p>
        )}
      </div>

      {/* オートセーブ枠 */}
      {autosaveInfo && (
        <div className="bg-surface-2 rounded-lg p-4 mb-4 border border-cyan-800/40">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-cyan-200 font-bold text-sm">💾 オートセーブ</div>
              <div className="text-xs text-gray-300 mt-0.5">
                {autosaveInfo.year ? `${autosaveInfo.year}年目` : ''}{autosaveInfo.date ? ` | ${autosaveInfo.date.month}月${autosaveInfo.date.day}日` : ''} | 保存日時: {formatTimestamp(autosaveInfo.timestamp)}
              </div>
            </div>
            <button onClick={handleLoadAutosave} disabled={!onLoadAutosave}
              className="btn-primary px-4 py-2 rounded text-sm disabled: disabled:">
              オートセーブをロード
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">※月替わり・年替わりの節目で自動保存されます（タイトル画面でON/OFF切り替え可）。</p>
        </div>
      )}

      {/* 3つのセーブスロット */}
      <div className="bg-surface-2 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-bold text-white mb-4">💾 セーブスロット</h2>
        <div className="space-y-4">
          {slotNames.map((name, idx) => {
            const info = saveSlots[idx];
            return (
              <div key={idx} className="border border-gray-600 rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="text-white font-bold text-lg">{name}</div>
                    {info ? (
                      <div className="text-sm text-gray-300 mt-1">
                        <p>{info.year}年目 | {info.date?.month}月{info.date?.day}日{info.teamName ? ` | ${info.teamName}` : ''}</p>
                        <p>保存日時: {formatTimestamp(info.timestamp)}</p>
                      </div>
                    ) : (
                      <p className="text-gray-400 text-sm mt-1">セーブデータなし</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleSave(idx)}
                    disabled={!seasonData}
                    className={`flex-1 px-4 py-2 rounded font-bold transition ${
                      'btn-primary'
                    }`}
                  >
                    {info ? '上書き保存' : '新規保存'}
                  </button>
                  <button
                    onClick={() => handleLoad(idx)}
                    disabled={!info}
                    className={`flex-1 px-4 py-2 rounded font-bold transition ${
                      'btn-primary'
                    }`}
                  >
                    ロード
                  </button>
                  <button
                    onClick={() => handleDelete(idx)}
                    disabled={!info}
                    className={`px-4 py-2 rounded font-bold transition ${
                      'btn-primary'
                    }`}
                  >
                    🗑️
                  </button>
                </div>
                {/* 1世代前のバックアップ（上書き前の自動保存）から復元 */}
                {backupInfos[idx] && (
                  <button onClick={() => handleRestoreBackup(idx)}
                    className="mt-2 text-xs text-amber-300 hover:text-amber-200 hover:underline">
                    ↩ 1つ前のセーブに戻す（{formatTimestamp(backupInfos[idx].timestamp)} 時点）
                  </button>
                )}
                {/* ファイルへの書き出し／読み込み。ブラウザの外へ持ち出せる唯一の経路 */}
                <div className="mt-2 flex gap-3 text-xs">
                  <button onClick={() => handleExport(idx)} disabled={!info}
                    className="text-gray-300 hover:text-white hover:underline disabled:text-gray-500 disabled:no-underline disabled:cursor-not-allowed">
                    ⬇ ファイルに書き出す
                  </button>
                  <button onClick={() => handleImport(idx)}
                    className="text-gray-300 hover:text-white hover:underline">
                    ⬆ ファイルから読み込む
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-xs text-gray-300 mt-4 rounded-lg border border-gray-600/60 bg-gray-800/40 p-3 space-y-1">
          <p className="font-bold text-gray-200">セーブデータの置き場所について</p>
          <p>※ セーブデータは<b className="text-gray-100">ブラウザの中</b>（このアドレス専用の領域）に保存されます。ゲームのフォルダには入りません。</p>
          <p>※ <b className="text-amber-300">アドレスが変わると別のセーブ置き場になります。</b>
            {' '}このゲームは必ず <span className="tabular-nums">http://localhost:3000</span> で開いてください
            （現在: <span className="tabular-nums text-gray-100">{typeof location !== 'undefined' ? location.origin : ''}</span>）。
            ポート番号が違うと、前のセーブは消えたわけではなく<b className="text-gray-100">見えなくなっている</b>だけです。</p>
          <p>※ ブラウザのデータを消去すると削除されます。<b className="text-gray-100">大事な進行は「ファイルに書き出す」で控えを取ってください。</b></p>
        </div>
      </div>

      {/* タイトルへ戻るボタン */}
      <div className="text-center">
        <button
          onClick={async () => {
            if (await askConfirm('タイトル画面に戻りますか？セーブしていない進行データは失われます。', { okLabel: 'タイトルへ戻る' })) {
              onReturnToTitle();
            }
          }}
          className="px-8 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold transition"
        >
          🏠 タイトルへ戻る
        </button>
      </div>
    </ScreenShell>
  );
};

export default SaveLoadScreen;
