import React, { useState, useEffect } from 'react';
import { RANK_COLORS, RANK_LABELS, RANK_ORDER } from '../utils/constants.js';
import SelectShell from './select/SelectShell.jsx';
import { REGIONS, CORPORATE_TEAMS, getTeamsByRegion, RANK_ABILITY_RANGE, setTeamDisplayName, resetTeamDisplayName, setTeamOverride, resetTeamOverrides, getAllTeamsEffective, getAllMasterTeamsEffective, addCustomTeam, updateCustomTeam, deleteTeam, restoreTeam, getDeletedTeams, clearGameSessionTeams, addGameSessionCustomTeam } from '../corporate/corporateTeamsData.js';
import { showMessage } from '../utils/gameDialog.js';

const TYPE_LABELS = {
  corporate: { label: '企業', color: 'bg-blue-800 text-blue-200' },
  club: { label: 'クラブ', color: 'bg-green-800 text-green-200' },
  custom: { label: '作成', color: 'bg-purple-800 text-purple-200' },
};

// 就任先を選ぶための判断材料。ランクは「チームの強さ」だが、
// プレイヤーが知りたいのは「どれくらい難しいか」。強いチームほど楽で、
// **クラブはキャンプが無く実践経験も少ない**ぶん1段階難しい
// （corporateInit.js の proChance / standout はクラブを除外している）。
const DIFFICULTY = ['やさしい', 'ふつう', 'ややむずかしい', 'むずかしい', '高難度'];
const DIFF_COLOR = ['text-green-400', 'text-emerald-400', 'text-yellow-400', 'text-orange-400', 'text-red-400'];
const difficultyOf = (team) =>
  Math.min(4, (RANK_ORDER[team.rank] ?? 3) + (team.type === 'club' ? 1 : 0));

/** 所属選手の能力の目安（RANK_ABILITY_RANGE と同じ値。クラブは初期能力が低い） */
function strengthOf(team) {
  const r = RANK_ABILITY_RANGE[team.rank] || RANK_ABILITY_RANGE.C;
  const scale = team.type === 'club' ? 0.75 : 1;
  return { min: Math.round(r.min * scale), max: Math.round(r.max * scale), star: r.starChance };
}

// モードごとの性格。**選ぶ前に「何が違うのか」が分かる**ようにする。
// 以前は幅384pxのカードを縦に3枚並べるだけで、1280px画面の左右が空いていた。
const MODES = [
  {
    key: 'university', title: '大学野球', sub: '4年で選手が入れ替わる',
    grad: 'from-amber-700 to-orange-700', hover: 'hover:from-amber-600 hover:to-orange-600',
    tagBg: 'bg-amber-900/60 text-amber-100', accent: 'text-amber-200',
    lead: '春季・秋季リーグを戦い、選手をプロへ送り出す。',
    points: [
      ['選手の集め方', 'スポーツ推薦スカウト'],
      ['育成の期間', '4年で卒業。回転が速い'],
      ['年に2度の優勝機会', '春秋のリーグ戦'],
    ],
    tags: ['春季・秋季リーグ', '全日本選手権', '明治神宮大会', '推薦スカウト', 'NPBドラフト'],
    difficulty: 2,
  },
  {
    key: 'corporate', title: '社会人野球', sub: '企業かクラブかで別ゲーム',
    grad: 'from-blue-700 to-indigo-700', hover: 'hover:from-blue-600 hover:to-indigo-600',
    tagBg: 'bg-blue-900/60 text-blue-100', accent: 'text-blue-200',
    lead: '企業チームまたはクラブチームの監督に就任する。',
    points: [
      ['選手の集め方', 'スカウトで交渉して獲る'],
      ['企業', '予算とスカウトで強化できる'],
      ['クラブ', 'キャンプが無く自然成長のみ'],
    ],
    tags: ['都市対抗予選', '都市対抗本戦', '日本選手権', 'スカウト入団', '企業 or クラブ'],
    difficulty: 3,
  },
  {
    key: 'independent', title: '独立リーグ', sub: 'リーグごと作る',
    grad: 'from-green-700 to-emerald-700', hover: 'hover:from-green-600 hover:to-emerald-600',
    tagBg: 'bg-green-900/60 text-green-100', accent: 'text-green-200',
    lead: 'リーグを立ち上げ、トライアウトで選手を集める。',
    points: [
      ['選手の集め方', 'トライアウトで指名'],
      ['自由度', 'チーム数・日程まで設計できる'],
      ['育つ理由', '出場機会そのものが経験値'],
    ],
    tags: ['トライアウト', 'リーグ戦', 'グランドCS', 'NPBドラフト', 'リーグ設計'],
    difficulty: 2,
  },
];

const DIFF_DOTS = (n) => (
  <span className="inline-flex gap-0.5 align-middle">
    {[0, 1, 2, 3, 4].map(i => (
      <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < n ? 'bg-white/90' : 'bg-white/25'}`} />
    ))}
  </span>
);

const ModeSelectScreen = ({ onSelectIndependent, onSelectCorporate, onSelectUniversity, onBack }) => {
  const handlers = {
    university: onSelectUniversity, corporate: onSelectCorporate, independent: onSelectIndependent,
  };
  return (
    <SelectShell
      kicker="GAME MODE"
      title="どの球界で始めるか"
      sub={<>どれも同じ1つの球界。違うのは<span className="text-white font-bold mx-1">どのチームを操作し、どのカレンダーで進むか</span>だけ</>}
      footer={(
        <div className="text-center">
          <button onClick={onBack} className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-surface-2 text-sm transition">← 戻る</button>
        </div>
      )}
    >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {MODES.map(m => (
            // ⚠ **カード全面を色で塗らないこと**。以前は本体ごと
            //    `from-blue-700 to-indigo-700` で、3枚が「色つきの紙」に見えていた。
            //    色は**見出しの帯だけ**が持ち、本体は本編と同じ暗い面にする。
            //    こうするとチーム選択のカードとも語彙が揃う
            <button
              key={m.key}
              onClick={handlers[m.key]}
              className="lift-card group text-white rounded-2xl text-left overflow-hidden flex flex-col border border-gray-700/70 hover:border-gray-500 bg-surface-2/80"
            >
              <div className={`bg-gradient-to-br ${m.grad} ${m.hover} px-5 pt-5 pb-4 transition-colors`}
                   style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)' }}>
                <div className="text-2xl font-black leading-tight">{m.title}</div>
                <div className="text-xs text-white/75 mt-0.5">{m.sub}</div>
              </div>
              <div className="px-5 pt-4 pb-3">
                <div className="text-sm font-normal text-gray-200">{m.lead}</div>
              </div>
              {/* 3つの軸で並べると、モード間の違いが縦に読み比べられる */}
              <div className="px-5 pb-3 space-y-1.5">
                {m.points.map(([k, v]) => (
                  <div key={k} className="text-xs">
                    <span className={`${m.accent} font-normal`}>{k}</span>
                    <span className="text-white ml-1.5 font-normal">{v}</span>
                  </div>
                ))}
              </div>
              <div className="px-5 pb-3 mt-auto">
                <div className="flex flex-wrap gap-1">
                  {m.tags.map(tag => (
                    <span key={tag} className={`text-xs px-1.5 py-0.5 rounded font-normal ${m.tagBg}`}>{tag}</span>
                  ))}
                </div>
              </div>
              <div className="px-5 py-2.5 bg-black/30 border-t border-white/5 flex items-center justify-between">
                <span className="text-xs font-normal text-gray-400">難易度の目安</span>
                {DIFF_DOTS(m.difficulty)}
              </div>
            </button>
          ))}
        </div>
    </SelectShell>
  );
};

const CorporateTeamSelectScreen = ({ onSelect, onBack }) => {
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [editingNameId, setEditingNameId] = useState(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', city: '' });

  // ゲームセッション用チームをコンポーネント初期化時にクリア（useEffectだとレンダー後で遅い）
  const [sessionCleared] = useState(() => { clearGameSessionTeams(); return true; });

  const regionTeams = selectedRegion
    ? getTeamsByRegion(selectedRegion)
    : [];
  const selectableTeams = regionTeams;

  const startEditName = (e, team) => {
    e.stopPropagation();
    setEditingNameId(team.id);
    setEditNameValue(team.displayName);
  };

  const saveEditName = (teamId) => {
    if (editNameValue.trim()) {
      setTeamDisplayName(teamId, editNameValue.trim());
    }
    setEditingNameId(null);
    setRefreshKey(prev => prev + 1);
  };

  const handleResetName = (e, teamId) => {
    e.stopPropagation();
    resetTeamDisplayName(teamId);
    setRefreshKey(prev => prev + 1);
  };

  const handleConfirm = () => {
    if (selectedTeam) {
      onSelect(selectedTeam);
    }
  };

  const handleCreateTeam = () => {
    if (!createForm.name.trim() || !createForm.city.trim()) {
      showMessage('チーム名と都市名を入力してください');
      return;
    }
    const newTeam = addGameSessionCustomTeam({
      name: createForm.name.trim(),
      city: createForm.city.trim(),
      region: selectedRegion,
      type: 'corporate',
      rank: 'D',
    });
    newTeam.displayName = newTeam.name;
    setShowCreateForm(false);
    setCreateForm({ name: '', city: '' });
    setRefreshKey(prev => prev + 1);
    setSelectedTeam(newTeam);
  };

  // 地区選択
  if (!selectedRegion) {
    return (
      <SelectShell kicker="CORPORATE" title="地区を選択" sub="監督として就任する地区を選んでください"
        footer={(
          <div className="text-center">
            <button onClick={onBack} className="text-gray-300 hover:text-white text-sm transition">← 戻る</button>
          </div>
        )}>
          <div className="grid grid-cols-3 gap-3">
            {REGIONS.map(region => {
              const teams = getTeamsByRegion(region.id);
              const corpCount = teams.filter(t => t.type === 'corporate').length;
              const clubCount = teams.filter(t => t.type === 'club').length;
              return (
                <button
                  key={region.id}
                  onClick={() => setSelectedRegion(region.id)}
                  className="lift-card bg-surface-2/80 border border-gray-700/70 hover:border-gray-500 rounded-xl p-4 text-left flex flex-col"
                >
                  <div className="text-white font-bold text-lg">{region.name}</div>
                  <div className="text-gray-300 text-sm">{teams.length}チーム</div>
                  <div className="text-xs mt-1 space-x-2">
                    <span className="text-blue-400">企業:{corpCount}</span>
                    <span className="text-green-400">クラブ:{clubCount}</span>
                  </div>
                </button>
              );
            })}
          </div>
      </SelectShell>
    );
  }

  // チーム選択
  // ⚠ ここは共通カード（`TeamSelectCard`）に置き換えないこと。行の中に
  //    改名・初期化の操作を持っていて、置き換えると機能が落ちる。
  //    外枠と質感だけ他の選択画面と揃える。
  return (
    <SelectShell
      kicker="TEAM SELECT"
      title={`${REGIONS.find(r => r.id === selectedRegion)?.name} のチーム`}
      sub={`監督として就任するチームを選んでください（全${regionTeams.length}チーム）`}
      fitHeight={false}
    >

        {/* 2列にして幅を使う。1列だと9チームでスクロールアウトしていた。
            ⚠ **下端にフェードを掛けること**。掛けないと最終行が途中でぶつ切りになり、
            「描画が壊れている」ように見える（実測で行の高さの半分で切れていた）。
            フェードがあれば「続きがある」と読める。 */}
        <div className="relative">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[58vh] overflow-y-auto pr-1">
          {regionTeams.map(team => {
            const typeInfo = TYPE_LABELS[team.type] || TYPE_LABELS.club;
            const isClub = team.type === 'club';
            const isSelected = selectedTeam?.id === team.id;
            const diff = difficultyOf(team);
            const st = strengthOf(team);
            return (
              <div
                key={team.id}
                onClick={() => { if (editingNameId !== team.id) setSelectedTeam(team); }}
                className={`lift-card group w-full p-2.5 rounded-lg border cursor-pointer ${
                  isSelected
                    ? (isClub ? 'bg-green-900/50 border-green-500' : 'bg-blue-900/50 border-blue-500')
                    : 'bg-surface-2/80 border-gray-700/70 hover:border-gray-500'
                }`}
              >
                {editingNameId === team.id ? (
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editNameValue}
                      onChange={(e) => setEditNameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEditName(team.id); if (e.key === 'Escape') setEditingNameId(null); }}
                      className="bg-gray-700 border border-gray-500 text-white px-2 py-1 rounded flex-1 min-w-0 focus:border-blue-400 focus:outline-none text-sm"
                      autoFocus
                    />
                    <button onClick={() => saveEditName(team.id)} className="btn-primary px-2 py-1 rounded text-xs shrink-0">保存</button>
                    <button onClick={() => setEditingNameId(null)} className="text-gray-300 hover:text-white text-xs shrink-0">取消</button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`font-bold text-lg w-5 shrink-0 text-center ${RANK_COLORS[team.rank]}`}>{team.rank}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${typeInfo.color}`}>{typeInfo.label}</span>
                      <span className="text-white font-bold truncate min-w-0">{team.displayName}</span>
                      <span className="text-gray-300 text-xs shrink-0">{team.city}</span>
                      <span className="ml-auto flex items-center gap-2 shrink-0">
                        {/* 改名は常時出すと全行の視覚ノイズになるのでホバー時だけ */}
                        {!team.isCustom && (
                          <button onClick={(e) => startEditName(e, team)}
                            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-blue-300 text-xs transition">改名</button>
                        )}
                        {team.displayName !== team.name && (
                          <button onClick={(e) => handleResetName(e, team.id)}
                            className="text-gray-300 hover:text-yellow-300 text-xs">戻す</button>
                        )}
                      </span>
                    </div>
                    {/* 就任先を決めるための材料。ランクだけでは中身が分からなかった */}
                    <div className="flex items-center gap-3 text-xs tabular-nums pl-7">
                      <span className="text-gray-300">{RANK_LABELS[team.rank]}</span>
                      <span className="text-gray-300">戦力<span className="text-gray-100 ml-0.5">{st.min}〜{st.max}</span></span>
                      <span className="text-gray-300">主力級<span className="text-gray-100 ml-0.5">{Math.round(st.star * 100)}%</span></span>
                      {team.budget != null && (
                        <span className="text-gray-300">予算<span className="text-gray-100 ml-0.5">{team.budget}</span></span>
                      )}
                      <span className={`ml-auto font-bold ${DIFF_COLOR[diff]}`}>{DIFFICULTY[diff]}</span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
             style={{ background: 'linear-gradient(0deg, #0a111a 0%, rgba(10,17,26,0) 100%)' }} />
        </div>

        <div className="text-xs text-gray-300 mt-2 text-center">
          戦力＝所属選手の能力の目安 ／ 主力級＝突出した選手が出る確率 ／
          クラブはキャンプが無く成長も遅いぶん難しい
        </div>

        {/* チーム作成（企業チーム・Dランク固定、Dクラブ1つと自動入れ替え） */}
        {showCreateForm ? (
          <div className="mt-4 bg-surface-2 border border-purple-600 rounded-lg p-4">
            <h3 className="text-white font-bold mb-1">企業チームを立ち上げる</h3>
            <p className="text-gray-300 text-xs mb-3">Dランクからのスタート。Dランクのクラブチーム1つと入れ替わります。</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-gray-300 text-xs">チーム名</label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded focus:border-purple-400 focus:outline-none"
                  placeholder="例: 札幌ベアーズ"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-gray-300 text-xs">所在都市</label>
                <input
                  type="text"
                  value={createForm.city}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, city: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded focus:border-purple-400 focus:outline-none"
                  placeholder="例: 札幌"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreateTeam} className="btn-secondary px-4 py-2 rounded transition">作成してゲーム開始</button>
              <button onClick={() => setShowCreateForm(false)} className="text-gray-300 hover:text-white px-4 py-2">取消</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCreateForm(true)}
            className="mt-4 w-full border-2 border-dashed border-gray-600 hover:border-purple-500 text-gray-300 hover:text-purple-400 rounded-lg py-3 transition text-sm"
          >
            + 企業チームを立ち上げる（Dランクスタート）
          </button>
        )}

        <div className="flex justify-between items-center mt-4">
          <button
            onClick={() => { setSelectedRegion(null); setSelectedTeam(null); }}
            className="text-gray-300 hover:text-white text-sm px-4 py-2"
          >
            地区選択に戻る
          </button>

          {selectedTeam && (
            <button
              onClick={handleConfirm}
              className="btn-primary px-8 py-3 rounded-lg transition"
            >
              {selectedTeam.displayName}（{selectedTeam.city}）で開始
            </button>
          )}
        </div>
    </SelectShell>
  );
};

const CorporateNameEditScreen = ({ onBack }) => {
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [editingTeamId, setEditingTeamId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', city: '', type: 'club', rank: 'C' });
  const [showDeleted, setShowDeleted] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const allTeams = getAllMasterTeamsEffective();
  const regionTeams = selectedRegion ? allTeams.filter(t => t.region === selectedRegion) : [];
  const deletedTeams = getDeletedTeams();

  const filteredTeams = searchQuery.trim()
    ? allTeams.filter(t =>
        t.name.includes(searchQuery) ||
        t.city.includes(searchQuery) ||
        t.originalName?.includes(searchQuery)
      )
    : null;

  const startEdit = (team) => {
    setEditingTeamId(team.id);
    setConfirmDeleteId(null);
    setEditForm({
      name: team.name,
      city: team.city,
      region: team.region,
      type: team.type,
      rank: team.rank,
    });
  };

  const saveEdit = (teamId) => {
    const orig = CORPORATE_TEAMS.find(t => t.id === teamId);
    if (orig) {
      for (const field of ['name', 'city', 'region', 'type', 'rank']) {
        if (editForm[field] !== undefined && editForm[field] !== orig[field]) {
          setTeamOverride(teamId, field, editForm[field]);
        } else {
          setTeamOverride(teamId, field, orig[field]);
        }
      }
    } else {
      updateCustomTeam(teamId, editForm);
    }
    setEditingTeamId(null);
    setRefreshKey(prev => prev + 1);
  };

  const resetAll = (teamId) => {
    resetTeamOverrides(teamId);
    setEditingTeamId(null);
    setRefreshKey(prev => prev + 1);
  };

  const handleDelete = (teamId) => {
    deleteTeam(teamId);
    setEditingTeamId(null);
    setConfirmDeleteId(null);
    setRefreshKey(prev => prev + 1);
  };

  const handleRestore = (teamId) => {
    restoreTeam(teamId);
    setRefreshKey(prev => prev + 1);
  };

  const handleAdd = () => {
    if (!addForm.name.trim() || !addForm.city.trim()) {
      showMessage('チーム名と都市名を入力してください');
      return;
    }
    addCustomTeam({
      name: addForm.name.trim(),
      city: addForm.city.trim(),
      region: selectedRegion || 'tokyo',
      type: addForm.type,
      rank: addForm.rank,
    });
    setShowAddForm(false);
    setAddForm({ name: '', city: '', type: 'club', rank: 'C' });
    setRefreshKey(prev => prev + 1);
  };

  const renderTeamRow = (team) => {
    const typeInfo = TYPE_LABELS[team.type] || TYPE_LABELS.club;
    const isEditing = editingTeamId === team.id;

    if (isEditing) {
      return (
        <div key={`${team.id}-${refreshKey}`} className="bg-surface-2 border-2 border-indigo-500 rounded-lg p-4">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-gray-300 text-xs block mb-1">チーム名</label>
              <input
                type="text"
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-500 text-white px-3 py-1.5 rounded focus:border-indigo-400 focus:outline-none text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="text-gray-300 text-xs block mb-1">都市</label>
              <input
                type="text"
                value={editForm.city}
                onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-500 text-white px-3 py-1.5 rounded focus:border-indigo-400 focus:outline-none text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-gray-300 text-xs block mb-1">地域</label>
              <select
                value={editForm.region}
                onChange={e => setEditForm(f => ({ ...f, region: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-500 text-white px-2 py-1.5 rounded focus:border-indigo-400 focus:outline-none text-sm"
              >
                {REGIONS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-gray-300 text-xs block mb-1">種別</label>
              <div className="flex gap-1">
                {[['corporate', '企業'], ['club', 'クラブ']].map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setEditForm(f => ({ ...f, type: val }))}
                    className={`flex-1 px-2 py-1.5 rounded text-sm font-bold transition ${
                      editForm.type === val
                        ? val === 'corporate' ? 'seg-on' : 'seg'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >{label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-gray-300 text-xs block mb-1">強さ</label>
              <div className="flex gap-1">
                {['S', 'A', 'B', 'C', 'D'].map(r => (
                  <button
                    key={r}
                    onClick={() => setEditForm(f => ({ ...f, rank: r }))}
                    className={`flex-1 px-1 py-1.5 rounded text-sm font-bold transition ${
                      editForm.rank === r
                        ? `${RANK_COLORS[r].replace('text-', 'bg-').replace('-400', '-600')} text-white`
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >{r}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2 items-center">
            <button onClick={() => saveEdit(team.id)} className="btn-secondary px-4 py-1.5 rounded text-sm transition">保存</button>
            <button onClick={() => setEditingTeamId(null)} className="text-gray-300 hover:text-white text-sm px-3 py-1.5">取消</button>
            {team.hasOverrides && !team.isCustom && (
              <button onClick={() => resetAll(team.id)} className="text-yellow-500 hover:text-yellow-400 text-sm px-3 py-1.5">初期値に戻す</button>
            )}
            <div className="ml-auto">
              {confirmDeleteId === team.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-red-400 text-xs">削除しますか？</span>
                  <button onClick={() => handleDelete(team.id)} className="btn-danger px-3 py-1 rounded text-xs transition">削除</button>
                  <button onClick={() => setConfirmDeleteId(null)} className="text-gray-300 hover:text-white text-xs">取消</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDeleteId(team.id)} className="text-red-500/60 hover:text-red-400 text-sm px-3 py-1.5">削除</button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        key={`${team.id}-${refreshKey}`}
        onClick={() => startEdit(team)}
        className="flex items-center gap-3 bg-surface-2 border border-gray-700 hover:border-indigo-500 rounded-lg p-3 cursor-pointer transition group"
      >
        <span className={`font-bold text-lg w-6 shrink-0 ${RANK_COLORS[team.rank]}`}>{team.rank}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${typeInfo.color}`}>{typeInfo.label}</span>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-white font-bold truncate">{team.name}</span>
          <span className="text-gray-400 text-xs shrink-0">({team.city})</span>
          {team.isCustom && <span className="text-purple-400 text-xs shrink-0">追加</span>}
          {!team.isCustom && team.hasOverrides && <span className="text-indigo-400 text-xs shrink-0">変更済</span>}
        </div>
        <span className="text-gray-400 text-xs opacity-0 group-hover:opacity-100 transition shrink-0">クリックで編集</span>
      </div>
    );
  };

  const renderAddForm = () => (
    <div className="mt-3 bg-surface-2 border-2 border-purple-500 rounded-lg p-4">
      <h3 className="text-white font-bold mb-3">チームを追加</h3>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-gray-300 text-xs block mb-1">チーム名</label>
          <input
            type="text"
            value={addForm.name}
            onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
            className="w-full bg-gray-700 border border-gray-600 text-white px-3 py-1.5 rounded focus:border-purple-400 focus:outline-none text-sm"
            placeholder="例: 札幌ベアーズ"
            autoFocus
          />
        </div>
        <div>
          <label className="text-gray-300 text-xs block mb-1">都市</label>
          <input
            type="text"
            value={addForm.city}
            onChange={e => setAddForm(f => ({ ...f, city: e.target.value }))}
            className="w-full bg-gray-700 border border-gray-600 text-white px-3 py-1.5 rounded focus:border-purple-400 focus:outline-none text-sm"
            placeholder="例: 札幌"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-gray-300 text-xs block mb-1">種別</label>
          <div className="flex gap-1">
            {[['corporate', '企業'], ['club', 'クラブ']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setAddForm(f => ({ ...f, type: val }))}
                className={`flex-1 px-2 py-1.5 rounded text-sm font-bold transition ${
                  addForm.type === val
                    ? val === 'corporate' ? 'seg-on' : 'seg'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >{label}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-gray-300 text-xs block mb-1">強さ</label>
          <div className="flex gap-1">
            {['S', 'A', 'B', 'C', 'D'].map(r => (
              <button
                key={r}
                onClick={() => setAddForm(f => ({ ...f, rank: r }))}
                className={`flex-1 px-1 py-1.5 rounded text-sm font-bold transition ${
                  addForm.rank === r
                    ? `${RANK_COLORS[r].replace('text-', 'bg-').replace('-400', '-600')} text-white`
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >{r}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={handleAdd} className="btn-secondary px-4 py-1.5 rounded text-sm transition">追加</button>
        <button onClick={() => setShowAddForm(false)} className="text-gray-300 hover:text-white text-sm px-3 py-1.5">取消</button>
      </div>
    </div>
  );

  const renderDeletedSection = () => {
    if (deletedTeams.length === 0) return null;
    return (
      <div className="mt-4">
        <button
          onClick={() => setShowDeleted(prev => !prev)}
          className="text-gray-400 hover:text-gray-300 text-sm flex items-center gap-1"
        >
          <span>{showDeleted ? '▼' : '▶'}</span>
          <span>削除済みチーム ({deletedTeams.length})</span>
        </button>
        {showDeleted && (
          <div className="mt-2 space-y-1">
            {deletedTeams.map(team => (
              <div key={team.id} className="flex items-center gap-3 bg-gray-900/50 border border-gray-800 rounded-lg p-2.5 opacity-60">
                <span className={`font-bold w-6 shrink-0 ${RANK_COLORS[team.rank]}`}>{team.rank}</span>
                <span className="text-gray-300 text-sm flex-1">{team.name} ({team.city})</span>
                <button
                  onClick={() => handleRestore(team.id)}
                  className="text-green-500 hover:text-green-400 text-xs px-2 py-1"
                >復元</button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // 検索結果表示
  if (filteredTeams) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 p-6">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-2 text-center">社会人チーム設定</h1>
          <p className="text-gray-300 mb-4 text-center">チームの編集・追加・削除（全セーブ共通）</p>

          <div className="mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="チーム名・都市名で検索..."
              className="w-full bg-gray-700 border border-gray-600 text-white px-4 py-2 rounded-lg focus:border-indigo-400 focus:outline-none"
            />
          </div>

          <p className="text-gray-300 text-sm mb-3">{filteredTeams.length}件の結果</p>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {filteredTeams.map(team => renderTeamRow(team))}
          </div>

          <div className="text-center mt-4">
            <button onClick={() => setSearchQuery('')} className="text-gray-300 hover:text-white px-4 py-2 text-sm">検索をクリア</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2 text-center">社会人チーム設定</h1>
        <p className="text-gray-300 mb-4 text-center">チームの編集・追加・削除（全セーブ共通）</p>

        <div className="mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="チーム名・都市名で検索..."
            className="w-full bg-gray-700 border border-gray-600 text-white px-4 py-2 rounded-lg focus:border-indigo-400 focus:outline-none"
          />
        </div>

        {!selectedRegion ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              {REGIONS.map(region => {
                const teams = allTeams.filter(t => t.region === region.id);
                const customCount = teams.filter(t => t.hasOverrides || t.isCustom).length;
                const corpCount = teams.filter(t => t.type === 'corporate').length;
                const clubCount = teams.filter(t => t.type === 'club').length;
                return (
                  <button
                    key={region.id}
                    onClick={() => setSelectedRegion(region.id)}
                    className="bg-surface-2 hover:bg-gray-700 border border-gray-700 hover:border-indigo-500 rounded-lg p-4 text-left transition flex flex-col"
                  >
                    <div className="text-white font-bold">{region.name}</div>
                    <div className="text-gray-300 text-sm">{teams.length}チーム</div>
                    <div className="text-xs mt-1 space-x-2">
                      <span className="text-blue-400">企業:{corpCount}</span>
                      <span className="text-green-400">クラブ:{clubCount}</span>
                    </div>
                    {/* 条件付きの行は下端へ。無いカードだけ段が欠けて揃わなくなるため */}
                    {customCount > 0 && <div className="text-indigo-400 text-xs mt-auto pt-1">{customCount}件変更済</div>}
                  </button>
                );
              })}
            </div>

            {renderDeletedSection()}

            <div className="text-center mt-6">
              <button onClick={onBack} className="text-gray-300 hover:text-white px-4 py-2">タイトルに戻る</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-white">
                {REGIONS.find(r => r.id === selectedRegion)?.name}
                <span className="text-gray-300 text-sm font-normal ml-2">{regionTeams.length}チーム</span>
              </h2>
            </div>
            <div className="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
              {regionTeams.map(team => renderTeamRow(team))}
            </div>

            {showAddForm ? renderAddForm() : (
              <button
                onClick={() => setShowAddForm(true)}
                className="mt-3 w-full border-2 border-dashed border-gray-600 hover:border-purple-500 text-gray-300 hover:text-purple-400 rounded-lg py-2.5 transition text-sm"
              >
                + この地区にチームを追加
              </button>
            )}

            {renderDeletedSection()}

            <div className="text-center mt-4">
              <button onClick={() => { setSelectedRegion(null); setEditingTeamId(null); setShowAddForm(false); }} className="text-gray-300 hover:text-white px-4 py-2">地区選択に戻る</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export { ModeSelectScreen, CorporateTeamSelectScreen, CorporateNameEditScreen };
