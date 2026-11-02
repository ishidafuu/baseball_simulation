import React, { useState } from 'react';
import { ScreenShell } from './GameUIComponents.jsx';
import { TEAMS_DATA } from '../teams-data.js';
import { POSITION_NAMES, FORM_OPTIONS } from '../utils/constants.js';
import { showMessage } from '../utils/gameDialog.js';

const EditScreen = ({ generateOptimalLineup, generatePitchingRotation, generateAllTeamsLineup, allTeams }) => {
  const [editingTeam, setEditingTeam] = useState(allTeams[0] || 'チームA');
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [editFormData, setEditFormData] = useState(null);
  const [editingTeamName, setEditingTeamName] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [localTrigger, setLocalTrigger] = useState(0);

  const currentTeams = Object.keys(TEAMS_DATA);

  const getTeamData = (teamName) => {
    if (TEAMS_DATA && TEAMS_DATA[teamName]) {
      return TEAMS_DATA[teamName];
    }
    return { name: teamName, players: [] };
  };

  const team = getTeamData(editingTeam);
  const teamColorList = ['bg-blue-600', 'bg-red-600', 'bg-green-600', 'bg-yellow-600', 'bg-purple-600', 'bg-pink-600', 'bg-indigo-600', 'bg-teal-600', 'bg-orange-600', 'bg-cyan-600', 'bg-lime-600', 'bg-amber-600'];
  const teamColors = {};
  currentTeams.forEach((name, idx) => {
    teamColors[name] = teamColorList[idx % teamColorList.length];
  });

  const startEditPlayer = (player) => {
    setEditingPlayer(player);
    setEditFormData(JSON.parse(JSON.stringify(player)));
  };

  const cancelEdit = () => {
    setEditingPlayer(null);
    setEditFormData(null);
  };

  const updateAbility = (category, field, value) => {
    const numValue = Math.max(0, Math.min(100, parseInt(value) || 0));
    setEditFormData(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [field]: numValue
      }
    }));
  };

  const updatePitchingForm = (value) => {
    setEditFormData(prev => ({
      ...prev,
      pitching: {
        ...prev.pitching,
        form: value
      }
    }));
  };

  const updateHand = (category, value) => {
    if (category === 'batting') {
      setEditFormData(prev => ({
        ...prev,
        batting: { ...prev.batting, bats: value }
      }));
    } else if (category === 'physical') {
      setEditFormData(prev => ({
        ...prev,
        physical: { ...prev.physical, throws: value }
      }));
    }
  };

  const savePlayerEdit = () => {
    if (!editFormData || !editingPlayer) return;
    const playerIndex = TEAMS_DATA[editingTeam].players.findIndex(p => p.id === editingPlayer.id);
    if (playerIndex !== -1) {
      TEAMS_DATA[editingTeam].players[playerIndex] = editFormData;
      cancelEdit();
      showMessage(`${editFormData.name}の能力値を保存しました！`);
    }
  };

  const startEditTeamName = () => {
    setNewTeamName(editingTeam);
    setEditingTeamName(true);
  };

  const saveTeamName = () => {
    const trimmed = newTeamName.trim();
    if (!trimmed || trimmed === editingTeam) {
      setEditingTeamName(false);
      return;
    }
    if (TEAMS_DATA[trimmed]) {
      showMessage('その名前は既に使われています');
      return;
    }
    TEAMS_DATA[trimmed] = TEAMS_DATA[editingTeam];
    TEAMS_DATA[trimmed].name = trimmed;
    delete TEAMS_DATA[editingTeam];
    setEditingTeam(trimmed);
    setEditingTeamName(false);
    setLocalTrigger(prev => prev + 1);
  };

  return (
    <ScreenShell>
      <h1 className="text-xl font-bold mb-6 text-white">エディット画面（開発用）</h1>

      <div className="mb-6 flex gap-4 flex-wrap">
        {currentTeams.map((teamName) => (
          <button
            key={teamName}
            onClick={() => setEditingTeam(teamName)}
            className={`px-6 py-3 rounded font-bold transition ${
              editingTeam === teamName
                ? `${teamColors[teamName]} text-white`
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {teamName}
          </button>
        ))}
      </div>

      <div className="bg-surface-2 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-bold mb-4 text-white">チーム情報</h2>
        <div className="text-white">
          {editingTeamName ? (
            <div className="mb-2 flex items-center gap-2">
              <span>チーム名:</span>
              <input
                type="text"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveTeamName(); if (e.key === 'Escape') setEditingTeamName(false); }}
                className="bg-gray-700 border border-gray-500 text-white px-3 py-1 rounded w-48 focus:border-blue-400 focus:outline-none"
                autoFocus
              />
              <button onClick={saveTeamName} className="btn-primary px-3 py-1 rounded text-sm">保存</button>
              <button onClick={() => setEditingTeamName(false)} className="text-gray-300 hover:text-white px-2 py-1 text-sm">取消</button>
            </div>
          ) : (
            <div className="mb-2 flex items-center gap-2">
              <span>チーム名: <span className="font-bold">{team.name}</span></span>
              <button onClick={startEditTeamName} className="text-blue-400 hover:text-blue-300 text-sm ml-2">変更</button>
            </div>
          )}
          <div className="text-sm text-gray-300">選手数: {team.players.length}人</div>
        </div>
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => {
              generateOptimalLineup(editingTeam);
              generatePitchingRotation(editingTeam);
              showMessage(`${editingTeam}のAIオーダー編成と投手ローテーションを設定しました！`);
            }}
            className="btn-secondary px-4 py-2 rounded transition"
          >
            🤖 AIオーダー編成
          </button>
          <button
            onClick={() => generateAllTeamsLineup()}
            className="btn-primary px-4 py-2 rounded transition"
          >
            🤖 全チーム一括編成
          </button>
        </div>
      </div>

      <div className="bg-surface-2 rounded-lg p-6">
        <h2 className="text-xl font-bold mb-4 text-white">選手一覧（{team.players.length}人）</h2>
        <div className="text-sm text-blue-400 mb-4">💡 選手カードをクリックして能力値を編集できます</div>

        {team.players.length === 0 ? (
          <div className="text-center text-gray-400 py-8">選手データがありません。</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {team.players.map((player) => (
              <div
                key={player.id}
                className="bg-gray-700 rounded p-4 cursor-pointer hover:bg-gray-600 transition"
                onClick={() => startEditPlayer(player)}
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-white">{player.name}</span>
                  <span className="text-xs text-gray-300">#{player.number || player.id}</span>
                </div>
                <div className="text-sm text-gray-300">
                  <div>ポジション: {POSITION_NAMES[player.position] || player.position}</div>
                  <div>打: {player.batting?.meet || 0} / 力: {player.batting?.power || 0}</div>
                  {player.pitching && <div>球速: {player.pitching.velocity}km/h</div>}
                </div>
                <div className="text-xs text-blue-400 mt-2">クリックして編集</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingPlayer && editFormData && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-2 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <input type="text" value={editFormData.name || ''}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="text-2xl font-bold text-white bg-gray-700 border border-gray-600 rounded px-3 py-1 focus:border-blue-500 focus:outline-none"
                  placeholder="選手名" />
                <span className="text-gray-300 text-sm">の能力値編集</span>
              </div>
              <button onClick={cancelEdit} className="text-gray-300 hover:text-white text-2xl">✕</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gray-700 rounded p-4">
                <h3 className="text-lg font-bold text-white mb-4">打撃能力</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">ミート (0-100)</label>
                    <input type="number" min="0" max="100" value={editFormData.batting?.meet || 0}
                      onChange={(e) => updateAbility('batting', 'meet', e.target.value)}
                      className="w-full bg-gray-600 text-white px-3 py-2 rounded" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">パワー (0-100)</label>
                    <input type="number" min="0" max="100" value={editFormData.batting?.power || 0}
                      onChange={(e) => updateAbility('batting', 'power', e.target.value)}
                      className="w-full bg-gray-600 text-white px-3 py-2 rounded" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">選球眼 (0-100)</label>
                    <input type="number" min="0" max="100" value={editFormData.batting?.eye || 0}
                      onChange={(e) => updateAbility('batting', 'eye', e.target.value)}
                      className="w-full bg-gray-600 text-white px-3 py-2 rounded" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">バント (0-100)</label>
                    <input type="number" min="0" max="100" value={editFormData.batting?.bunt || 0}
                      onChange={(e) => updateAbility('batting', 'bunt', e.target.value)}
                      className="w-full bg-gray-600 text-white px-3 py-2 rounded" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">打席</label>
                    <select value={editFormData.batting?.bats || 'right'}
                      onChange={(e) => updateHand('batting', e.target.value)}
                      className="w-full bg-gray-600 text-white px-3 py-2 rounded">
                      <option value="right">右打ち</option>
                      <option value="left">左打ち</option>
                      <option value="switch">スイッチ</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="bg-gray-700 rounded p-4">
                <h3 className="text-lg font-bold text-white mb-4">身体能力</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">走力 (0-100)</label>
                    <input type="number" min="0" max="100" value={editFormData.physical?.speed || 0}
                      onChange={(e) => updateAbility('physical', 'speed', e.target.value)}
                      className="w-full bg-gray-600 text-white px-3 py-2 rounded" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">肩力 (0-100)</label>
                    <input type="number" min="0" max="100" value={editFormData.physical?.arm || 0}
                      onChange={(e) => updateAbility('physical', 'arm', e.target.value)}
                      className="w-full bg-gray-600 text-white px-3 py-2 rounded" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">投げ手</label>
                    <select value={editFormData.physical?.throws || 'right'}
                      onChange={(e) => updateHand('physical', e.target.value)}
                      className="w-full bg-gray-600 text-white px-3 py-2 rounded">
                      <option value="right">右投げ</option>
                      <option value="left">左投げ</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="bg-gray-700 rounded p-4">
                <h3 className="text-lg font-bold text-white mb-4">守備能力</h3>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">守備力 (0-100)</label>
                  <input type="number" min="0" max="100" value={editFormData.fielding?.defense || 0}
                    onChange={(e) => updateAbility('fielding', 'defense', e.target.value)}
                    className="w-full bg-gray-600 text-white px-3 py-2 rounded" />
                </div>
              </div>

              <div className="bg-gray-700 rounded p-4 md:col-span-2">
                <h3 className="text-lg font-bold text-white mb-4">守備位置適正 (0-100)</h3>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                  {[
                    { key: 'pitcher', label: '投手' },
                    { key: 'catcher', label: '捕手' },
                    { key: 'first', label: '一塁' },
                    { key: 'second', label: '二塁' },
                    { key: 'third', label: '三塁' },
                    { key: 'short', label: '遊撃' },
                    { key: 'left', label: '左翼' },
                    { key: 'center', label: '中堅' },
                    { key: 'right', label: '右翼' }
                  ].map(pos => (
                    <div key={pos.key}>
                      <label className="block text-xs text-gray-300 mb-1">{pos.label}</label>
                      <input type="number" min="0" max="100"
                        value={editFormData.positionFitness?.[pos.key] || 0}
                        onChange={(e) => {
                          const numValue = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                          setEditFormData(prev => ({
                            ...prev,
                            positionFitness: { ...prev.positionFitness, [pos.key]: numValue }
                          }));
                        }}
                        className="w-full bg-gray-600 text-white px-2 py-1 rounded text-sm" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-gray-700 rounded p-4">
                <h3 className="text-lg font-bold text-white mb-4">捕手能力</h3>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">リード (0-100)</label>
                  <input type="number" min="0" max="100" value={editFormData.catching?.lead || 0}
                    onChange={(e) => updateAbility('catching', 'lead', e.target.value)}
                    className="w-full bg-gray-600 text-white px-3 py-2 rounded" />
                </div>
              </div>

              <div className="bg-gray-700 rounded p-4 md:col-span-2">
                <h3 className="text-lg font-bold text-white mb-4">投手能力</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">球速 (km/h)</label>
                    <input type="number" min="80" max="170" value={editFormData.pitching?.velocity || 0}
                      onChange={(e) => {
                        const numValue = Math.max(80, Math.min(170, parseInt(e.target.value) || 0));
                        setEditFormData(prev => ({ ...prev, pitching: { ...prev.pitching, velocity: numValue } }));
                      }}
                      className="w-full bg-gray-600 text-white px-3 py-2 rounded" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">制球力 (0-100)</label>
                    <input type="number" min="0" max="100" value={editFormData.pitching?.control || 0}
                      onChange={(e) => updateAbility('pitching', 'control', e.target.value)}
                      className="w-full bg-gray-600 text-white px-3 py-2 rounded" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">スタミナ (0-200)</label>
                    <input type="number" min="0" max="200" value={editFormData.pitching?.stamina || 0}
                      onChange={(e) => {
                        const numValue = Math.max(0, Math.min(200, parseInt(e.target.value) || 0));
                        setEditFormData(prev => ({ ...prev, pitching: { ...prev.pitching, stamina: numValue } }));
                      }}
                      className="w-full bg-gray-600 text-white px-3 py-2 rounded" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">投球フォーム</label>
                    <select value={editFormData.pitching?.form || 'threeQuarter'}
                      onChange={(e) => updatePitchingForm(e.target.value)}
                      className="w-full bg-gray-600 text-white px-3 py-2 rounded">
                      {FORM_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}
                    </select>
                  </div>
                </div>

                <h4 className="text-md font-bold text-white mb-3 mt-4">変化球</h4>
                <div className="space-y-3">
                  {[1, 2, 3].map((num) => {
                    const ballKey = `breaking${num}`;
                    const ballData = editFormData.pitching?.[ballKey] || { type: 'slider', level: 0 };
                    return (
                      <div key={num} className="grid grid-cols-2 gap-3 bg-gray-600 p-3 rounded">
                        <div>
                          <label className="block text-xs text-gray-300 mb-1">変化球{num} タイプ</label>
                          <select value={ballData.type || 'slider'}
                            onChange={(e) => {
                              setEditFormData(prev => ({
                                ...prev,
                                pitching: { ...prev.pitching, [ballKey]: { ...ballData, type: e.target.value } }
                              }));
                            }}
                            className="w-full bg-gray-700 text-white px-2 py-1 rounded text-sm">
                            <option value="slider">スライダー</option>
                            <option value="curve">カーブ</option>
                            <option value="fork">フォーク</option>
                            <option value="sinker">シンカー</option>
                            <option value="cutter">カッター</option>
                            <option value="changeup">チェンジアップ</option>
                            <option value="shoot">シュート</option>
                            <option value="slurve">スラーブ</option>
                            <option value="screwball">スクリューボール</option>
                            <option value="sweeper">スイーパー</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-300 mb-1">変化量 (0-100)</label>
                          <input type="number" min="0" max="100" value={ballData.level || 0}
                            onChange={(e) => {
                              const numValue = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                              setEditFormData(prev => ({
                                ...prev,
                                pitching: { ...prev.pitching, [ballKey]: { ...ballData, level: numValue } }
                              }));
                            }}
                            className="w-full bg-gray-700 text-white px-2 py-1 rounded text-sm" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-4 mt-6">
              <button onClick={cancelEdit} className="px-6 py-2 btn-secondary rounded transition">キャンセル</button>
              <button onClick={savePlayerEdit} className="btn-primary px-6 py-2 rounded transition">保存</button>
            </div>
          </div>
        </div>
      )}
    </ScreenShell>
  );
};

export default EditScreen;
