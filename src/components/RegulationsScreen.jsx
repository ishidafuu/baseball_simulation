import React from 'react';
import { ScreenShell, ScreenHeader } from './GameUIComponents.jsx';
import { validateRegulations, getPlayoffFormatDescription, canModifyRegulations } from '../season/regulationSettings.js';
import { getValidTwoLeagueGameCounts } from '../season/scheduleGenerator.js';
import { PHASE_INFO } from '../season/seasonManager.js';
import { showMessage } from '../utils/gameDialog.js';

const RegulationsContent = ({ seasonData, setSeasonData, onConfirm }) => {
  const currentPhase = seasonData.phase || 'off_season';
  const canModify = onConfirm ? true : canModifyRegulations(currentPhase);
  const phaseInfo = currentPhase && PHASE_INFO[currentPhase]
    ? PHASE_INFO[currentPhase]
    : { name: '', color: 'bg-gray-100', description: '' };
  const [tempSettings, setTempSettings] = React.useState(seasonData.settings);

  // 半角→全角変換（略称用）
  const toFullWidth = (str) => str.replace(/[A-Za-z0-9]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0));
  const defaultAbbr = (i) => String.fromCharCode(0xFF21 + i);

  const handleTeamsCountChange = (newCount) => {
    if (isNaN(newCount) || newCount < 2 || newCount > 12 || newCount % 2 !== 0) return;
    const currentNames = tempSettings.teamNames || [];
    const currentAbbrs = tempSettings.teamAbbreviations || [];
    const newNames = [];
    const newAbbrs = [];
    for (let i = 0; i < newCount; i++) {
      newNames.push(currentNames[i] || `チーム${String.fromCharCode(65 + i)}`);
      newAbbrs.push(currentAbbrs[i] || defaultAbbr(i));
    }
    // 試合数を新しい(チーム数-1)の倍数に自動調整
    const oldGames = tempSettings.gamesPerSeason || 60;
    const oldD = Math.max(1, (tempSettings.teamsCount || 4) - 1);
    const newD = Math.max(1, newCount - 1);
    const roundsPerOpponent = Math.max(1, Math.round(oldGames / oldD));
    let adjustedGames = newD * roundsPerOpponent;
    if (adjustedGames < newD) adjustedGames = newD;
    if (adjustedGames > 150) adjustedGames = Math.floor(150 / newD) * newD;
    setTempSettings({
      ...tempSettings,
      teamsCount: newCount,
      teamNames: newNames,
      teamAbbreviations: newAbbrs,
      gamesPerSeason: adjustedGames
    });
  };

  const handleTeamNameChange = (index, newName) => {
    const newNames = [...(tempSettings.teamNames || [])];
    newNames[index] = newName;
    setTempSettings({ ...tempSettings, teamNames: newNames });
  };

  const handleTeamAbbrChange = (index, newAbbr) => {
    const converted = toFullWidth(newAbbr);
    const trimmed = [...converted].slice(0, 3).join('');
    const newAbbrs = [...(tempSettings.teamAbbreviations || [])];
    newAbbrs[index] = trimmed;
    setTempSettings({ ...tempSettings, teamAbbreviations: newAbbrs });
  };

  const handleSaveSettings = () => {
    const validation = validateRegulations(tempSettings);
    if (!validation.valid) {
      showMessage('設定エラー:\n' + validation.errors.join('\n'));
      return;
    }
    setSeasonData({ ...seasonData, settings: tempSettings });
    showMessage('レギュレーション設定を保存しました');
  };

  const SettingRow = ({ label, children }) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-700/50">
      <label className="text-gray-300 text-sm font-medium">{label}</label>
      {children}
    </div>
  );

  return (
    <ScreenShell width="form">
      <ScreenHeader title="レギュレーション設定" />

      {/* ⚠ この帯は**地色の上に直に載る**。半透明のままだと明るい紙の上で薄まり、
          載っている黄色い文字が 2.69:1 で読めなくなる（実測）。不透明にすること */}
      {!canModify && (
        <div className="bg-yellow-950 border border-yellow-700/50 rounded-lg p-3 mb-3">
          <p className="text-yellow-200 font-bold text-sm">レギュレーション変更はオフシーズンのみ可能です</p>
          <p className="text-yellow-300/70 text-xs mt-0.5">現在: {phaseInfo.name}</p>
        </div>
      )}

      <div className="bg-surface-2 rounded-lg p-4 mb-3">
        <h2 className="text-sm font-bold mb-2 text-white">詳細設定</h2>
        <div className="space-y-0">
          <SettingRow label="DH制（指名打者）">
            <input type="checkbox" checked={tempSettings.useDH} onChange={(e) => setTempSettings({ ...tempSettings, useDH: e.target.checked })} disabled={!canModify} className="w-5 h-5 rounded" />
          </SettingRow>
          <SettingRow label="チーム数">
            <select value={tempSettings.teamsCount} onChange={(e) => handleTeamsCountChange(parseInt(e.target.value))} disabled={!canModify} className="bg-gray-700 text-white px-3 py-1.5 rounded text-sm w-24">
              {[2, 4, 6, 8, 10, 12].map(n => <option key={n} value={n}>{n}チーム</option>)}
            </select>
          </SettingRow>
          <SettingRow label="リーグ形式">
            <select
              value={tempSettings.leagueFormat || 'single'}
              onChange={(e) => setTempSettings({ ...tempSettings, leagueFormat: e.target.value })}
              disabled={!canModify}
              className="bg-gray-700 text-white px-3 py-1.5 rounded text-sm"
            >
              <option value="single">1リーグ制</option>
              <option value="two" disabled={tempSettings.teamsCount < 4}>2リーグ制</option>
            </select>
          </SettingRow>
          {tempSettings.leagueFormat === 'two' && (
            <SettingRow label="リーグ名">
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={tempSettings.leagueNames?.[0] || 'リーグ1'}
                  onChange={(e) => setTempSettings({ ...tempSettings, leagueNames: [e.target.value, tempSettings.leagueNames?.[1] || 'リーグ2'] })}
                  disabled={!canModify} maxLength={15}
                  className="bg-gray-700 text-white px-2 py-1.5 rounded text-sm w-28"
                />
                <input
                  type="text"
                  value={tempSettings.leagueNames?.[1] || 'リーグ2'}
                  onChange={(e) => setTempSettings({ ...tempSettings, leagueNames: [tempSettings.leagueNames?.[0] || 'リーグ1', e.target.value] })}
                  disabled={!canModify} maxLength={15}
                  className="bg-gray-700 text-white px-2 py-1.5 rounded text-sm w-28"
                />
              </div>
            </SettingRow>
          )}
          <SettingRow label="年間試合数">
            <select
              value={tempSettings.gamesPerSeason}
              onChange={(e) => setTempSettings({ ...tempSettings, gamesPerSeason: parseInt(e.target.value) })}
              disabled={!canModify}
              className="bg-gray-700 text-white px-3 py-1.5 rounded text-sm"
            >
              {(() => {
                const tc = tempSettings.teamsCount || 4;
                const isTwoLeague = tempSettings.leagueFormat === 'two' && tc >= 4;
                if (isTwoLeague) {
                  const validCounts = getValidTwoLeagueGameCounts(tc, 150);
                  if (validCounts.length === 0) {
                    return <option value={tempSettings.gamesPerSeason}>{tempSettings.gamesPerSeason}試合</option>;
                  }
                  return validCounts.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.value}試合（リーグ内各{opt.intra}戦・交流各{opt.inter}戦）
                    </option>
                  ));
                }
                const d = Math.max(1, tc - 1);
                const options = [];
                for (let i = 1; d * i <= 150; i++) options.push(d * i);
                return options.map(v => (
                  <option key={v} value={v}>{v}試合（各{v / d}戦）</option>
                ));
              })()}
            </select>
          </SettingRow>
          <SettingRow label="プレーオフ形式">
            <select value={tempSettings.playoffFormat} onChange={(e) => setTempSettings({ ...tempSettings, playoffFormat: e.target.value })} disabled={!canModify} className="bg-gray-700 text-white px-3 py-1.5 rounded text-sm">
              <option value="short">3回戦制（2勝先取）</option>
              <option value="full">5回戦制（3勝先取）</option>
              <option value="tournament">4チームトーナメント</option>
            </select>
          </SettingRow>
          <div className="text-xs text-gray-400 py-1 pl-2">{getPlayoffFormatDescription(tempSettings.playoffFormat, tempSettings.leagueFormat)}</div>
          <SettingRow label="延長最大回数">
            <input type="number" value={tempSettings.maxExtraInnings} onChange={(e) => setTempSettings({ ...tempSettings, maxExtraInnings: parseInt(e.target.value) })} disabled={!canModify} min="0" max="30" className="bg-gray-700 text-white px-3 py-1.5 rounded text-sm w-20" />
          </SettingRow>
        </div>
        <div className="mt-3">
          <button onClick={handleSaveSettings} disabled={!canModify} className={`w-full py-2 rounded-lg font-bold text-sm transition ${'btn-primary'}`}>
            設定を保存
          </button>
        </div>
      </div>

      {/* チーム名設定 */}
      {canModify && (
        <div className="bg-surface-2 rounded-lg p-4 mb-3">
          <h2 className="text-sm font-bold mb-2 text-white">チーム名設定</h2>
          {tempSettings.leagueFormat === 'two' ? (
            <>
              <div className="mb-3">
                <h3 className="text-xs font-bold text-blue-400 mb-1.5">
                  {tempSettings.leagueNames?.[0] || 'リーグ1'}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {(tempSettings.teamNames || []).slice(0, Math.floor(tempSettings.teamsCount / 2)).map((name, index) => (
                    <div key={index} className="flex items-center gap-1.5">
                      <span className="text-blue-400 text-xs w-6">#{index + 1}</span>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => handleTeamNameChange(index, e.target.value)}
                        maxLength={15}
                        className="bg-gray-700 text-white rounded px-2 py-1 flex-1 text-sm border border-blue-600/50"
                        placeholder={`チーム${String.fromCharCode(65 + index)}`}
                      />
                      <input
                        type="text"
                        value={(tempSettings.teamAbbreviations || [])[index] || ''}
                        onChange={(e) => handleTeamAbbrChange(index, e.target.value)}
                        className="bg-gray-700 text-white rounded px-1.5 py-1 w-14 text-center border border-blue-600/30 text-xs"
                        placeholder="略称"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-xs font-bold text-orange-400 mb-1.5">
                  {tempSettings.leagueNames?.[1] || 'リーグ2'}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {(tempSettings.teamNames || []).slice(Math.floor(tempSettings.teamsCount / 2)).map((name, index) => {
                    const actualIndex = Math.floor(tempSettings.teamsCount / 2) + index;
                    return (
                      <div key={actualIndex} className="flex items-center gap-1.5">
                        <span className="text-orange-400 text-xs w-6">#{actualIndex + 1}</span>
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => handleTeamNameChange(actualIndex, e.target.value)}
                          maxLength={15}
                          className="bg-gray-700 text-white rounded px-2 py-1 flex-1 text-sm border border-orange-600/50"
                          placeholder={`チーム${String.fromCharCode(65 + actualIndex)}`}
                        />
                        <input
                          type="text"
                          value={(tempSettings.teamAbbreviations || [])[actualIndex] || ''}
                          onChange={(e) => handleTeamAbbrChange(actualIndex, e.target.value)}
                          className="bg-gray-700 text-white rounded px-1.5 py-1 w-14 text-center border border-orange-600/30 text-xs"
                          placeholder="略称"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {(tempSettings.teamNames || []).map((name, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <span className="text-gray-300 text-xs w-6">#{index + 1}</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => handleTeamNameChange(index, e.target.value)}
                    maxLength={15}
                    className="bg-gray-700 text-white rounded px-2 py-1 flex-1 text-sm"
                    placeholder={`チーム${String.fromCharCode(65 + index)}`}
                  />
                  <input
                    type="text"
                    value={(tempSettings.teamAbbreviations || [])[index] || ''}
                    onChange={(e) => handleTeamAbbrChange(index, e.target.value)}
                    className="bg-gray-700 text-white rounded px-1.5 py-1 w-14 text-center border border-gray-600 text-xs"
                    placeholder="略称"
                  />
                </div>
              ))}
            </div>
          )}
          <p className="text-gray-400 text-xs mt-2">※正式名（最大15文字）はドラフト・記録画面で使用。略称（全角3文字まで）はカレンダー・順位表で使用</p>
        </div>
      )}

      <div className="bg-surface-2 rounded-lg p-4">
        <h2 className="text-sm font-bold mb-2 text-white">現在の設定</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-300">
          <div>DH制: <span className="text-white">{seasonData.settings.useDH ? '有効' : '無効'}</span></div>
          <div>チーム数: <span className="text-white">{seasonData.settings.teamsCount}チーム</span></div>
          <div>形式: <span className="text-white">{seasonData.settings.leagueFormat === 'two' ? '2リーグ' : '1リーグ'}</span></div>
          <div>試合数: <span className="text-white">{seasonData.settings.gamesPerSeason}試合</span></div>
          <div className="col-span-2">PO: <span className="text-white">{getPlayoffFormatDescription(seasonData.settings.playoffFormat, seasonData.settings.leagueFormat)}</span></div>
          <div>延長: <span className="text-white">{seasonData.settings.maxExtraInnings}回</span></div>
        </div>
      </div>

      {onConfirm && (
        <div className="mt-4 text-center">
          <button
            onClick={() => {
              const validation = validateRegulations(tempSettings);
              if (!validation.valid) {
                showMessage('設定エラー:\n' + validation.errors.join('\n'));
                return;
              }
              setSeasonData(prev => ({ ...prev, settings: tempSettings }));
              onConfirm(tempSettings);
            }}
            className="btn-primary px-8 py-3 rounded-lg text-base transition shadow"
          >
            確定 → キャンプへ進む
          </button>
        </div>
      )}
    </ScreenShell>
  );
};

const RegulationsScreen = (props) => props.seasonData
  ? <RegulationsContent {...props} />
  : <div className="p-8 text-white">読み込み中...</div>;

export default RegulationsScreen;
