import React, { useState, useMemo } from 'react';
import PlayerDetailModal from './PlayerDetailModal.jsx';
import { ScreenShell, ScreenHeader } from './GameUIComponents.jsx';
import { TEAMS_DATA } from '../teams-data.js';
import { highSchoolPool, universityPool } from '../state/schoolPools.js';
import { releasedPlayersPool } from '../teams-data.js';
import { POSITION_NAMES, POSITION_ORDER, FORM_SHORT, FORM_CODE } from '../utils/constants.js';
import { AbilityValue, overallRating } from './AbilityValue.jsx';
import { WORLD_DATA } from '../corporate/worldData.js';
import { addHighSchoolPlayerToScoutList } from '../university/universityScout.js';

const SOURCES = [
  { key: 'highschool', label: '高校生' },
  { key: 'university', label: '大学生' },
  { key: 'corporate', label: '社会人' },
  { key: 'club', label: 'クラブ' },
  { key: 'independent', label: '独立' },
  { key: 'released', label: '自由契約' },
];

// TEAMS_DATA のチームを所属種別に振り分ける。ユーザー自チームはマーカーが無いため
// gameMode から推定する（独立/社会人/大学）。
function teamSourceOf(t, gameMode) {
  if (t.universityData || t.universityTeamId) return 'university';
  if (t.independentLeagueId || t.corporateData?.type === 'independent') return 'independent';
  if (t.corporateData?.type === 'club') return 'club';
  if (t.corporateData?.type === 'corporate') return 'corporate';
  if (gameMode === 'university') return 'university';
  if (gameMode === 'corporate') return 'corporate';
  return 'independent';
}

const FILTER_DEFS = [
  { key: 'age', label: '年齢', get: p => p.age || 18, min: 15, max: 45, step: 1 },
  { key: 'meet', label: 'ミート', get: p => p.batting?.meet || 0 },
  { key: 'power', label: 'パワー', get: p => p.batting?.power || 0 },
  { key: 'eye', label: '選球眼', get: p => p.batting?.eye || 0 },
  { key: 'speed', label: '走力', get: p => p.physical?.speed || 0 },
  { key: 'arm', label: '肩力', get: p => p.physical?.arm || 0 },
  { key: 'bodyStamina', label: '体力', get: p => p.physical?.bodyStamina || 0 },
  { key: 'dexterity', label: '器用さ', get: p => p.physical?.dexterity || 0 },
  { key: 'defense', label: '守備', get: p => p.fielding?.defense || 0 },
  { key: 'steal', label: '盗塁', get: p => p.batting?.steal || 0 },
  { key: 'velocity', label: '球速', get: p => p.pitching?.velocity || 0, min: 100, max: 170, step: 1 },
  { key: 'control', label: '制球', get: p => p.pitching?.control || 0 },
  { key: 'stamina', label: 'スタミナ', get: p => p.pitching?.stamina || 0, min: 0, max: 200, step: 1 },
  { key: 'growth', label: '成長率', get: p => p.growthPotential || 1.0, min: 0.5, max: 1.5, step: 0.05, decimal: true },
  { key: 'discipline', label: 'プロ意識', get: p => p.personality?.discipline ?? 50 },
  { key: 'fame', label: '知名度', get: p => p.fame || 0 },
  { key: 'muscle', label: '体幹', get: p => p.physical?.muscle ?? 50 },
  { key: 'catcherLead', label: 'Cリード', get: p => p.catching?.lead || 0 },
  { key: 'breakingCount', label: '球種数', get: p => (p.pitching?.arsenal || []).filter(a => (a.level || 0) >= 20).length, min: 0, max: 9, step: 1 },
];

const DEFAULT_FILTERS = {};
FILTER_DEFS.forEach(f => {
  DEFAULT_FILTERS[f.key] = { enabled: false, min: f.min || 0, max: f.max || 99 };
});

function collectAllPlayers(gameMode) {
  const results = [];
  const seen = new Set();

  const push = (p, source, label, extra = {}) => {
    if (!p || !p.name) return;
    const key = `${source}::${p.id ?? p.name}::${label}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ ...p, _source: source, _sourceLabel: label, ...extra });
  };

  if (highSchoolPool.players?.length > 0) {
    highSchoolPool.players.forEach(p => {
      push(p, 'highschool', p.highSchool?.name || '高校生');
    });
  }

  if (universityPool) {
    Object.entries(universityPool).forEach(([year, entries]) => {
      if (!entries) return;
      entries.forEach(entry => {
        const p = entry.player || entry;
        push(p, 'university',
          entry.universityTeamName || p.universityTeamName || `大学(${entry.universityRank || '?'}ランク)`,
          { _uniRank: entry.universityRank || p._destinationRank || '?' }
        );
      });
    });
  }

  if (releasedPlayersPool?.length > 0) {
    releasedPlayersPool.forEach(p => {
      push(p, 'released', p.previousTeam || '自由契約');
    });
  }

  Object.entries(TEAMS_DATA || {}).forEach(([teamName, teamData]) => {
    const src = teamSourceOf(teamData, gameMode);
    (teamData.players || []).forEach(p => {
      push(p, src, teamName);
    });
  });

  return results;
}

const PlayerSearchScreen = ({ onBack, gameMode, userTeamName }) => {
  const [filters, setFilters] = useState(() => JSON.parse(JSON.stringify(DEFAULT_FILTERS)));
  const [sources, setSources] = useState({ highschool: true, university: true, corporate: true, club: true, independent: true, released: true });
  const [posFilter, setPosFilter] = useState('all');
  const [nameQuery, setNameQuery] = useState('');
  const [sortKey, setSortKey] = useState('meet');
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [scoutAddMsg, setScoutAddMsg] = useState(null);
  const [scoutTick, setScoutTick] = useState(0); // スカウト追加後の再描画トリガー

  const allPlayers = useMemo(() => collectAllPlayers(gameMode), [gameMode]);

  const filtered = useMemo(() => {
    let list = allPlayers.filter(p => sources[p._source]);

    if (nameQuery.trim()) {
      const q = nameQuery.trim();
      list = list.filter(p => p.name?.includes(q) || p._sourceLabel?.includes(q));
    }

    if (posFilter === 'pitcher') list = list.filter(p => p.position === 'pitcher');
    else if (posFilter === 'fielder') list = list.filter(p => p.position !== 'pitcher');
    else if (posFilter !== 'all') list = list.filter(p => p.position === posFilter);

    for (const def of FILTER_DEFS) {
      const f = filters[def.key];
      if (!f?.enabled) continue;
      list = list.filter(p => {
        const val = def.get(p);
        return val >= f.min && val <= f.max;
      });
    }

    const getDef = FILTER_DEFS.find(d => d.key === sortKey);
    const getVal = sortKey === 'overall'
      ? (p => overallRating(p) ?? -1)
      : (getDef ? getDef.get : (p => 0));
    list.sort((a, b) => {
      const diff = getVal(a) - getVal(b);
      return sortAsc ? diff : -diff;
    });

    return list.slice(0, 200);
  }, [allPlayers, sources, posFilter, nameQuery, filters, sortKey, sortAsc]);

  const updateFilter = (key, field, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value }
    }));
  };

  const toggleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const resetFilters = () => {
    setFilters(JSON.parse(JSON.stringify(DEFAULT_FILTERS)));
    setPosFilter('all');
    setNameQuery('');
  };

  const SortTh = ({ k, children, w, cls = '' }) => (
    <th className={`py-1 px-1 text-center ${w || ''} ${cls} cursor-pointer hover:text-white transition ${sortKey === k ? 'text-yellow-400' : ''}`}
      onClick={() => toggleSort(k)} title={children}>
      {children}{sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  );

  const handLabel = (v) => v === 'right' ? '右' : v === 'left' ? '左' : v === 'switch' ? '両' : '?';

  // 能力表示は共通の AbilityValue に集約（配色の単一の真実の源）
  const StatVal = ({ value, isVel, isSta }) => <AbilityValue value={value} isVel={isVel} isSta={isSta} />;

  return (
    <ScreenShell className="text-white">
        <ScreenHeader title="選手検索"
          right={<button onClick={onBack} className="btn-secondary px-3 py-1.5 rounded text-sm">戻る</button>} />

        {/* Source toggles */}
        <div className="flex flex-wrap gap-2 mb-3">
          {SOURCES.map(s => (
            <button key={s.key}
              onClick={() => setSources(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
              className={`px-3 py-1 rounded text-xs font-bold transition ${sources[s.key] ? 'seg-on' : 'seg'}`}
            >{s.label}</button>
          ))}
          <span className="text-ink-sub text-xs self-center ml-2">|</span>
          {[{ key: 'all', label: '全ポジ' }, { key: 'pitcher', label: '投手' }, { key: 'fielder', label: '野手' },
            ...POSITION_ORDER.filter(p => p !== 'pitcher').map(p => ({ key: p, label: POSITION_NAMES[p] }))
          ].map(p => (
            <button key={p.key}
              onClick={() => setPosFilter(p.key)}
              className={`px-2 py-1 rounded text-xs font-bold transition ${posFilter === p.key ? 'seg-on' : 'seg'}`}
            >{p.label}</button>
          ))}
          <button onClick={resetFilters} className="btn-danger px-2 py-1 rounded text-xs transition ml-auto">リセット</button>
        </div>

        {/* Name search */}
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            value={nameQuery}
            onChange={e => setNameQuery(e.target.value)}
            placeholder="選手名・所属で検索..."
            className="bg-surface-2 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 w-64 focus:outline-none focus:border-blue-500"
          />
          {nameQuery && <button onClick={() => setNameQuery('')} className="text-ink-sub hover:text-ink text-sm" aria-label="検索の文字を消す">✕</button>}
          {/* ⚠ この行は**地色の上に直に載る**（カードの外）ので暗い文字にすること */}
          <span className="text-ink-sub text-xs ml-2">※ スカウト画面の能力値は推定値です。実際の数値と異なる場合があります</span>
        </div>

        {/* Filters */}
        <div className="bg-surface-2 rounded-lg p-3 mb-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {FILTER_DEFS.map(def => {
              const f = filters[def.key];
              const fMin = def.min ?? 0;
              const fMax = def.max ?? 99;
              const step = def.step ?? 1;
              return (
                <div key={def.key} className={`flex flex-col gap-0.5 p-1.5 rounded ${f.enabled ? 'bg-gray-700' : 'bg-surface-2'}`}>
                  <label className="flex items-center gap-1 text-xs text-gray-300">
                    <input type="checkbox" checked={f.enabled}
                      onChange={e => updateFilter(def.key, 'enabled', e.target.checked)}
                      className="w-3 h-3" />
                    {def.label}
                  </label>
                  {f.enabled && (
                    <div className="flex items-center gap-1 text-xs">
                      <input type="number" value={f.min} min={fMin} max={fMax} step={step}
                        onChange={e => updateFilter(def.key, 'min', def.decimal ? parseFloat(e.target.value) : parseInt(e.target.value))}
                        className="w-14 bg-gray-600 rounded px-1 py-0.5 text-white text-center" />
                      <span className="text-gray-400">〜</span>
                      <input type="number" value={f.max} min={fMin} max={fMax} step={step}
                        onChange={e => updateFilter(def.key, 'max', def.decimal ? parseFloat(e.target.value) : parseInt(e.target.value))}
                        className="w-14 bg-gray-600 rounded px-1 py-0.5 text-white text-center" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Results */}
        <div className="text-xs text-ink-sub mb-1">{filtered.length}件{filtered.length >= 200 ? '（上位200件表示）' : ''}</div>
        <div className="bg-surface-2 rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              {/* グループ行 */}
              <tr className="bg-gray-700/60 text-gray-400 text-xs border-b border-gray-600/50">
                <th colSpan={6} className="py-0.5 px-2 text-left text-gray-300 font-bold">選手</th>
                <th colSpan={8} className="py-0.5 px-1 text-center border-l border-gray-600/50 text-blue-300 font-bold">野手</th>
                <th colSpan={3} className="py-0.5 px-1 text-center border-l border-gray-600/50 text-gray-300 font-bold">フィジカル</th>
                <th colSpan={4} className="py-0.5 px-1 text-center border-l border-gray-600/50 text-red-300 font-bold">投手</th>
                <th colSpan={gameMode === 'university' ? 6 : 5} className="py-0.5 px-1 text-center border-l border-gray-600/50 text-gray-300 font-bold">属性</th>
              </tr>
              <tr className="bg-gray-700/80 text-gray-300 text-xs">
                <th className="py-1 px-2 text-left w-20">選手名</th>
                <SortTh k="overall" w="w-9">総合</SortTh>
                <th className="py-1 px-1 text-center w-8">ポジ</th>
                <SortTh k="age" w="w-7">年齢</SortTh>
                <th className="py-1 px-1 text-center w-8">体格</th>
                <th className="py-1 px-1 text-left w-24 max-w-[96px] truncate">所属</th>
                <SortTh k="meet" w="w-8" cls="border-l border-gray-600/50">ミート</SortTh>
                <SortTh k="power" w="w-8">パワー</SortTh>
                <SortTh k="speed" w="w-7">走力</SortTh>
                <SortTh k="arm" w="w-7">肩力</SortTh>
                <SortTh k="defense" w="w-7">守備</SortTh>
                <SortTh k="catcherLead" w="w-8">Cリード</SortTh>
                <SortTh k="eye" w="w-8">選球眼</SortTh>
                <SortTh k="steal" w="w-7">盗塁</SortTh>
                <SortTh k="bodyStamina" w="w-7" cls="border-l border-gray-600/50">体力</SortTh>
                <SortTh k="muscle" w="w-7">体幹</SortTh>
                <SortTh k="dexterity" w="w-7">器用</SortTh>
                <SortTh k="velocity" w="w-9" cls="border-l border-gray-600/50">球速</SortTh>
                <SortTh k="control" w="w-8">制球</SortTh>
                <SortTh k="stamina" w="w-8">スタ</SortTh>
                <SortTh k="breakingCount" w="w-8">球種</SortTh>
                <SortTh k="growth" w="w-9" cls="border-l border-gray-600/50">成長率</SortTh>
                {/* ⚠ ここだけ生のプロ意識を出す（「誰の目でもない全知の資料室」という切り分け）。
                    キャンプの「意欲」列は別物（本人が方針をどう受け止めているか）なので、
                    同じ語を使うと2つの違う情報が同じ名前になる */}
                <SortTh k="discipline" w="w-8">プロ意識</SortTh>
                <SortTh k="fame" w="w-8">知名度</SortTh>
                <th className="py-1 px-1 text-center w-10">投/打</th>
                <th className="py-1 px-1 text-center w-8">投法</th>
                {gameMode === 'university' && <th className="py-1 px-1 text-center w-8 text-purple-400">スカ</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, idx) => {
                const isScoutable = gameMode === 'university' && p._source === 'highschool';
                const scout = WORLD_DATA._universityScout;
                const alreadyScouted = isScoutable && scout && (
                  (scout.candidates || []).some(c => c.id === p.id)
                  || (scout.recruited || []).some(c => c.id === p.id)
                );
                return (
                <tr key={`${p._source}-${p.id || idx}`}
                  className={`border-b border-gray-700/30 hover:bg-gray-700/40 cursor-pointer ${selectedPlayer?.id === p.id && selectedPlayer?._source === p._source ? 'bg-gray-700/50' : ''}`}
                  onClick={() => setSelectedPlayer(selectedPlayer?.id === p.id && selectedPlayer?._source === p._source ? null : p)}
                >
                  <td className="py-0.5 px-2 font-bold text-xs truncate max-w-[80px]">{p.name}</td>
                  <td className="py-0.5 px-1 text-center"><AbilityValue value={overallRating(p)} showRank /></td>
                  <td className="py-0.5 px-1 text-center text-gray-300">{POSITION_NAMES[p.position] || p.position}</td>
                  <td className="py-0.5 px-1 text-center text-gray-300">{p.age || '?'}</td>
                  <td className="py-0.5 px-1 text-center">
                    <span className={p.physical?.build === 'large' ? 'text-orange-400' : p.physical?.build === 'small' ? 'text-cyan-400' : 'text-gray-300'}>
                      {p.physical?.build === 'large' ? '大柄' : p.physical?.build === 'small' ? '小柄' : '中肉'}
                    </span>
                  </td>
                  <td className="py-0.5 px-1 text-left text-gray-300 truncate max-w-[96px]" title={p._sourceLabel}>{p._sourceLabel}</td>
                  <td className="py-0.5 px-1 text-center border-l border-gray-700/50"><StatVal value={p.batting?.meet || 0} /></td>
                  <td className="py-0.5 px-1 text-center"><StatVal value={p.batting?.power || 0} /></td>
                  <td className="py-0.5 px-1 text-center"><StatVal value={p.physical?.speed || 0} /></td>
                  <td className="py-0.5 px-1 text-center"><StatVal value={p.physical?.arm || 0} /></td>
                  <td className="py-0.5 px-1 text-center"><StatVal value={p.fielding?.defense || 0} /></td>
                  <td className="py-0.5 px-1 text-center">
                    {p.position === 'catcher' && (p.catching?.lead ?? null) !== null
                      ? <StatVal value={p.catching?.lead || 0} />
                      : <span className="text-gray-400">-</span>}
                  </td>
                  <td className="py-0.5 px-1 text-center"><StatVal value={p.batting?.eye || 0} /></td>
                  <td className="py-0.5 px-1 text-center"><StatVal value={p.batting?.steal || 0} /></td>
                  <td className="py-0.5 px-1 text-center border-l border-gray-700/50"><StatVal value={p.physical?.bodyStamina || 0} /></td>
                  <td className="py-0.5 px-1 text-center"><StatVal value={p.physical?.muscle ?? 50} /></td>
                  <td className="py-0.5 px-1 text-center"><StatVal value={p.physical?.dexterity || 0} /></td>
                  <td className="py-0.5 px-1 text-center border-l border-gray-700/50"><StatVal value={p.pitching?.velocity || 0} isVel /></td>
                  <td className="py-0.5 px-1 text-center"><StatVal value={p.pitching?.control || 0} /></td>
                  <td className="py-0.5 px-1 text-center"><StatVal value={p.pitching?.stamina || 0} isSta /></td>
                  <td className="py-0.5 px-1 text-center">
                    {p.position === 'pitcher'
                      ? (() => {
                          const cnt = (p.pitching?.arsenal || []).filter(a => (a.level || 0) >= 20).length;
                          const color = cnt >= 5 ? 'text-pink-400' : cnt >= 4 ? 'text-orange-400' : cnt >= 3 ? 'text-yellow-400' : cnt >= 2 ? 'text-gray-300' : 'text-gray-300';
                          return <span className={`${color} font-bold`}>{cnt}</span>;
                        })()
                      : <span className="text-gray-400">-</span>}
                  </td>
                  <td className="py-0.5 px-1 text-center border-l border-gray-700/50">
                    {(() => {
                      const g = p.growthPotential || 1.0;
                      const color = g >= 1.3 ? 'text-pink-400' : g >= 1.15 ? 'text-orange-400' : g >= 1.0 ? 'text-yellow-400' : 'text-gray-300';
                      return <span className={`${color} font-bold`}>{g.toFixed(2)}</span>;
                    })()}
                  </td>
                  <td className="py-0.5 px-1 text-center">
                    {(() => {
                      const d = p.personality?.discipline ?? 50;
                      const color = d >= 80 ? 'text-pink-400' : d >= 65 ? 'text-orange-400' : d >= 50 ? 'text-yellow-400' : 'text-gray-300';
                      return <span className={`${color} font-bold`}>{d}</span>;
                    })()}
                  </td>
                  <td className="py-0.5 px-1 text-center text-gray-300">{p.fame || 0}</td>
                  <td className="py-0.5 px-1 text-center text-gray-300 whitespace-nowrap text-xs">
                    {handLabel(p.physical?.throws)}/{handLabel(p.batting?.bats)}
                  </td>
                  <td className="py-0.5 px-1 text-center text-gray-300 text-xs">
                    {p.position === 'pitcher' ? (FORM_CODE[p.pitching?.form] || '-') : '-'}
                  </td>
                  {isScoutable && (
                    <td className="py-0.5 px-1 text-center" onClick={e => e.stopPropagation()}>
                      {alreadyScouted
                        ? <span className="text-xs text-green-400 font-bold">済</span>
                        : <button
                            className="btn-secondary text-xs px-1.5 py-0.5 rounded transition"
                            onClick={() => {
                              const teamData = TEAMS_DATA[userTeamName];
                              const uniRank = teamData?.universityData?.rank || 'C';
                              const reputation = teamData?.universityData?.reputation ?? 30;
                              const result = addHighSchoolPlayerToScoutList(p, uniRank, reputation);
                              setScoutAddMsg(result.success ? `${p.name} を候補追加` : '追加失敗');
                              setTimeout(() => setScoutAddMsg(null), 2000);
                              setScoutTick(v => v + 1);
                            }}
                          >+</button>
                      }
                    </td>
                  )}
                  {gameMode === 'university' && p._source !== 'highschool' && <td />}
                </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={gameMode === 'university' ? 26 : 25} className="py-8 text-center text-gray-400">
                  {sources.highschool && !sources.university && !sources.released && !sources.teams && highSchoolPool.players.length === 0
                    ? '高校生プールは4月に生成されます。4月以降に再度確認してください。'
                    : sources.highschool && highSchoolPool.players.length === 0
                    ? '高校生は4月以降に表示されます（現在プール未生成）'
                    : '条件に一致する選手が見つかりません'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedPlayer && <PlayerDetailModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />}
    </ScreenShell>
  );
};

export default PlayerSearchScreen;
