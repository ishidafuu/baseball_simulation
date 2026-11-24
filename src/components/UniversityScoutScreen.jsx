import React, { useState, useEffect } from 'react';
import PlayerDetailModal from './PlayerDetailModal.jsx';
import { TEAMS_DATA } from '../teams-data.js';
import { POSITION_NAMES, FORM_SHORT } from '../utils/constants.js';
import { AbilityValue } from './AbilityValue.jsx';
import {
  initUniversityScoutList,
  getUniversityScoutSlots,
  startUniversityInvestigation,
  toggleUniversityWatch,
  getUniversityScoutRecommendation,
  generateSelectionCandidates,
  startUniversityApproach,
  stopUniversityApproach,
  calculateDailyGaugeRate,
  getMaxApproaches,
  getRivalInfo,
} from '../university/universityScout.js';
import { addToWatchList, removeFromWatchList } from '../game/watchList.js';
import { highSchoolPool } from '../state/schoolPools.js';
import { WORLD_DATA } from '../corporate/worldData.js';
import ConfirmBar from './ConfirmBar.jsx';

const TOTAL_NEW_MEMBERS = { S: 15, A: 13, B: 11, C: 9, D: 7 };

const UniversityScoutScreen = ({ seasonData, onComplete, onBack }) => {
  const teamNames = Object.keys(TEAMS_DATA || {});
  const userTeamName = teamNames[0] || '';
  const teamData = TEAMS_DATA[userTeamName];
  const rank = teamData?.universityData?.rank || 'C';
  const reputation = teamData?.universityData?.reputation ?? 30;
  const maxSlots = getUniversityScoutSlots(rank);

  const maxApproaches = getMaxApproaches(rank);
  const gameYear = seasonData?.settings?.year || seasonData?.year || 1;

  const scoutData = WORLD_DATA._universityScout || {};
  const [candidates, setCandidates] = useState(scoutData.candidates || []);
  const [recruited, setRecruited] = useState(scoutData.recruited || []);
  const [phase, setPhase] = useState('scout');
  const [sortKey, setSortKey] = useState('gaugeRate');
  const [sortAsc, setSortAsc] = useState(false);
  const [newDiscoveryCount, setNewDiscoveryCount] = useState(0);
  const [gaugeCompleteCount, setGaugeCompleteCount] = useState(0);
  const [selectionCandidates, setSelectionCandidates] = useState([]);
  const [selectionPicked, setSelectionPicked] = useState([]);
  const [selSortKey, setSelSortKey] = useState(null);
  const [selSortAsc, setSelSortAsc] = useState(false);
  const [modalPlayer, setModalPlayer] = useState(null);
  // 取り消せない操作は、押したら帯を出して決める（選ぶ→確定の2段）。
  //   { type: 'recruit', id, force } 推薦で確保 / { type: 'close' } 推薦を締め切る /
  //   { type: 'finish' } セレクションの合格者を確定
  // ⚠ 以前はどれも1回押すだけで決まり、取り消せなかった
  const [pending, setPending] = useState(null);
  // 直前の推薦の確保を取り消すための写し（1人ぶんだけ。この画面を開いている間だけ）。
  // 確保は候補・確保済みの並びと高校生の「進学先」の印を変えるだけなので、写しに戻せば取り消せる
  const [undoRecruit, setUndoRecruit] = useState(null);

  useEffect(() => {
    if (candidates.length === 0 && highSchoolPool.players?.length > 0 && !scoutData.initialized) {
      const list = initUniversityScoutList(teamData, rank);
      setCandidates(list);
      WORLD_DATA._universityScout = { candidates: list, recruited: [], initialized: true };
    }
  }, []);

  useEffect(() => {
    if (WORLD_DATA._universityScout) {
      WORLD_DATA._universityScout.candidates = candidates;
      WORLD_DATA._universityScout.recruited = recruited;
    }
  }, [candidates, recruited]);

  useEffect(() => {
    const wd = WORLD_DATA._universityScout;
    if (!wd) return;
    const nd = wd._newDiscoveries || 0;
    if (nd > 0) {
      setNewDiscoveryCount(nd);
      setCandidates([...(wd.candidates || [])]);
      wd._newDiscoveries = 0;
    }
    const gc = wd._gaugeCompleteCount || 0;
    if (gc > 0) {
      setCandidates([...(wd.candidates || [])]);
      setGaugeCompleteCount(prev => prev + gc);
      wd._gaugeCompleteCount = 0;
    }
    if ((wd._rivalStolen || []).length > 0) {
      setCandidates([...(wd.candidates || [])]);
      wd._rivalStolen = [];
    }
  });

  const remainingSlots = maxSlots - recruited.length;

  const recColor = (g) => ({ S: 'text-red-400', A: 'text-orange-400', B: 'text-yellow-400', C: 'text-green-400', D: 'text-blue-400' }[g] || 'text-gray-400');

  const handleInvestigate = (id) => {
    const c = candidates.find(p => p.id === id);
    if (!c) return;
    const ok = startUniversityInvestigation(c, seasonData.currentDate);
    if (ok) setCandidates([...candidates]);
  };

  const handleWatch = (id) => {
    const c = candidates.find(p => p.id === id);
    if (!c) return;
    toggleUniversityWatch(c);
    // 注目した選手は「獲れなくても追い続けられる」ようにする。
    // スカウトの注目(_watching=交渉率が上がる)と、階層をまたいだ追跡リストを
    // 別概念にすると「注目」が2つ存在して混乱するため、ここで連動させる。
    if (c._watching) addToWatchList(c, gameYear, '推薦スカウトで注目');
    else removeFromWatchList(c.id);
    setCandidates([...candidates]);
  };

  const approachingCount = candidates.filter(c => c._approaching).length;

  const handleApproach = (id) => {
    if (approachingCount >= maxApproaches) return;
    if (remainingSlots <= 0) return;
    const c = candidates.find(p => p.id === id);
    if (!c) return;
    startUniversityApproach(c);
    setCandidates([...candidates]);
  };

  const handleStopApproach = (id) => {
    const c = candidates.find(p => p.id === id);
    if (!c) return;
    stopUniversityApproach(c);
    setCandidates([...candidates]);
  };

  const handleConfirmRecruit = (id, force = false) => {
    const c = candidates.find(p => p.id === id);
    const gauge = c?._approachGauge || 0;
    const eligible = c?._gaugeComplete || (force && gauge >= 80);
    if (!c || !eligible || c._reservedBy || remainingSlots <= 0) return;
    const orig = highSchoolPool.players?.find(hp => hp.id === c.id);
    setUndoRecruit({ player: c, index: candidates.indexOf(c), orig, reservedBefore: orig?._universityReserved });
    if (orig) orig._universityReserved = userTeamName;
    const newCandidates = candidates.filter(p => p.id !== id);
    const newRecruited = [...recruited, c];
    setCandidates(newCandidates);
    setRecruited(newRecruited);
    if (WORLD_DATA._universityScout) {
      WORLD_DATA._universityScout.candidates = newCandidates;
      WORLD_DATA._universityScout.recruited = newRecruited;
    }
  };

  // 直前の推薦の確保を取り消す（その選手を候補の元の位置へ戻し、印を確保する前に戻す）。
  // 並びを丸ごと写しに戻すと、確保のあとにした調査・注目が消えるので、その1人だけ戻す
  const undoLastRecruit = () => {
    if (!undoRecruit || phase !== 'scout') return;
    const { player, index, orig, reservedBefore } = undoRecruit;
    if (!recruited.includes(player)) { setUndoRecruit(null); return; }
    if (orig) orig._universityReserved = reservedBefore;
    const newCandidates = [...candidates];
    newCandidates.splice(Math.max(0, Math.min(index, newCandidates.length)), 0, player);
    const newRecruited = recruited.filter(p => p !== player);
    setCandidates(newCandidates);
    setRecruited(newRecruited);
    if (WORLD_DATA._universityScout) {
      WORLD_DATA._universityScout.candidates = newCandidates;
      WORLD_DATA._universityScout.recruited = newRecruited;
    }
    setUndoRecruit(null);
  };

  const totalSlots = TOTAL_NEW_MEMBERS[rank] || 9;
  const selectionSlots = Math.max(0, totalSlots - recruited.length);

  const handleFinalize = () => {
    setUndoRecruit(null);
    WORLD_DATA._universityScout = { ...WORLD_DATA._universityScout, finalized: true };
    const selCandidates = generateSelectionCandidates(rank, reputation, Math.max(15, selectionSlots * 3));
    setSelectionCandidates(selCandidates);
    setPhase('selection');
  };

  const handleSelectionPick = (player) => {
    const alreadyPicked = selectionPicked.some(p => p.id === player.id);
    if (alreadyPicked) {
      // 合格解除
      const orig = highSchoolPool.players?.find(hp => hp.id === player.id);
      if (orig && orig._universityReserved === userTeamName) orig._universityReserved = null;
      setSelectionPicked(prev => prev.filter(p => p.id !== player.id));
    } else {
      if (selectionPicked.length >= selectionSlots) return;
      const orig = highSchoolPool.players?.find(hp => hp.id === player.id);
      if (orig) { orig._universityReserved = userTeamName; orig._isSelectionPick = true; }
      setSelectionPicked(prev => [...prev, player]);
    }
  };

  const handleSelectionFinalize = () => {
    if (onComplete) onComplete({ recommended: recruited, selection: selectionPicked });
  };

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === 'age' || key === 'name'); }
  };

  const throwLabel = (t) => t === 'left' ? '左' : '右';
  const batLabel = (b) => b === 'left' ? '左' : b === 'switch' ? '両' : '右';
  const formLabel = (f) => FORM_SHORT[f] || '-';
  const gpLabel = (gp) => gp == null ? '-' : gp.toFixed(2);
  const gpColor = (gp) => gp >= 1.3 ? 'text-red-400' : gp >= 1.1 ? 'text-yellow-400' : gp >= 0.9 ? 'text-green-400' : 'text-gray-400';

  const getAbilityVal = (p, key) => {
    const sa = p.scoutedAbilities || {};
    const map = {
      velocity: sa.pitching?.velocity, control: sa.pitching?.control, stamina: sa.pitching?.stamina,
      meet: sa.batting?.meet, power: sa.batting?.power, eye: sa.batting?.eye,
      speed: sa.physical?.speed, arm: sa.physical?.arm, bodyStamina: sa.physical?.bodyStamina, dexterity: sa.physical?.dexterity, muscle: sa.physical?.muscle, defense: sa.fielding?.defense,
      professionalism: sa.professionalism,
      mental: sa.mental, growth: p.growthPotential,
    };
    const v = map[key];
    if (key === 'growth') return typeof v === 'number' ? v : -1;
    return (v === '?' || v === undefined) ? -1 : (typeof v === 'number' ? v : parseInt(v));
  };

  const getSortValue = (p, key) => {
    const recGradeOrder = { S: 5, A: 4, B: 3, C: 2, D: 1 };
    switch (key) {
      case 'gaugeRate': return calculateDailyGaugeRate(p, rank, reputation);
      case 'gauge': return p._approachGauge || 0;
      case 'rivalMax': { const ri = getRivalInfo(p); return ri ? ri.maxGauge : 0; }
      case 'age': return p.age || 99;
      case 'name': return p.name || '';
      case 'rec': return recGradeOrder[getUniversityScoutRecommendation(p, rank)] || 0;
      default: return getAbilityVal(p, key);
    }
  };

  const sortedCandidates = [...candidates].sort((a, b) => {
    const va = getSortValue(a, sortKey);
    const vb = getSortValue(b, sortKey);
    if (sortKey === 'name') return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    return sortAsc ? va - vb : vb - va;
  });

  const SortHeader = ({ k, label, w }) => (
    <th onClick={() => handleSort(k)}
      className={`py-1 px-1 cursor-pointer hover:text-white transition select-none whitespace-nowrap ${w || ''} ${sortKey === k ? 'text-cyan-400' : 'text-gray-400'}`}>
      {label}{sortKey === k ? (sortAsc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  // 能力表示は共通の AbilityValue に統一（球速/スタミナの正規化・S〜F色を一元化）
  const renderVal = (val, isVel, isSta) => <AbilityValue value={val} isVel={isVel} isSta={isSta} />;

  const revealLabel = (level) => {
    if (level >= 2) return <span className="text-green-400 text-xs">詳細</span>;
    if (level >= 1) return <span className="text-yellow-400 text-xs">概要</span>;
    return <span className="text-gray-400 text-xs">未知</span>;
  };

  const getSelVal = (p, key) => {
    const sa = p.scoutedAbilities || {};
    switch (key) {
      case 'velocity': return typeof sa.pitching?.velocity === 'number' ? sa.pitching.velocity : -Infinity;
      case 'control': return typeof sa.pitching?.control === 'number' ? sa.pitching.control : -Infinity;
      case 'stamina': return typeof sa.pitching?.stamina === 'number' ? sa.pitching.stamina : -Infinity;
      case 'meet': return typeof sa.batting?.meet === 'number' ? sa.batting.meet : -Infinity;
      case 'power': return typeof sa.batting?.power === 'number' ? sa.batting.power : -Infinity;
      case 'eye': return typeof sa.batting?.eye === 'number' ? sa.batting.eye : -Infinity;
      case 'speed': return typeof sa.physical?.speed === 'number' ? sa.physical.speed : -Infinity;
      case 'arm': return typeof sa.physical?.arm === 'number' ? sa.physical.arm : -Infinity;
      case 'bodyStamina': return typeof sa.physical?.bodyStamina === 'number' ? sa.physical.bodyStamina : -Infinity;
      case 'dexterity': return typeof sa.physical?.dexterity === 'number' ? sa.physical.dexterity : -Infinity;
      case 'muscle': return typeof sa.physical?.muscle === 'number' ? sa.physical.muscle : -Infinity;
      case 'defense': return typeof sa.fielding?.defense === 'number' ? sa.fielding.defense : -Infinity;
      case 'mental': return typeof sa.mental === 'number' ? sa.mental : -Infinity;
      case 'professionalism': return typeof sa.professionalism === 'number' ? sa.professionalism : -Infinity;
      case 'growthPotential': return p.growthPotential ?? -Infinity;
      case 'age': return p.age ?? 0;
      default: return 0;
    }
  };

  const handleSelSort = (key) => {
    if (selSortKey === key) setSelSortAsc(prev => !prev);
    else { setSelSortKey(key); setSelSortAsc(false); }
  };

  const sortedSelectionCandidates = selSortKey
    ? [...selectionCandidates].sort((a, b) => {
        const av = getSelVal(a, selSortKey);
        const bv = getSelVal(b, selSortKey);
        return selSortAsc ? av - bv : bv - av;
      })
    : selectionCandidates;

  if (phase === 'selection') {
    const SelTh = ({ label, sortK, title }) => (
      <th
        className={`py-1 px-1 cursor-pointer select-none whitespace-nowrap ${selSortKey === sortK ? 'text-amber-400' : 'text-gray-400'} hover:text-amber-300 transition`}
        onClick={() => handleSelSort(sortK)}
        title={title}
      >
        {label}{selSortKey === sortK ? (selSortAsc ? '▲' : '▼') : ''}
      </th>
    );
    return (
      <div className="p-4">
        <div className="max-w-[1800px] mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-xl font-bold text-ink">セレクション (一般入部試験)</h1>
              <p className="text-ink-sub text-xs mt-0.5">
                {userTeamName} ({rank}ランク) — 入部枠: 残り{selectionSlots - selectionPicked.length}/{selectionSlots}名
                {selectionPicked.length > 0 && <span className="text-ink-accent ml-2">選出済{selectionPicked.length}名</span>}
              </p>
            </div>
            <button onClick={() => setPending({ type: 'finish' })}
              className="btn-primary px-4 py-2 rounded-lg text-sm transition">
              確定してオフシーズンへ
            </button>
          </div>

          {recruited.length > 0 && (
            <div className="bg-blue-950 border border-blue-800 rounded-xl p-2 mb-2">
              <div className="text-xs text-blue-400 font-bold mb-1">推薦入部 ({recruited.length}名)</div>
              <div className="flex flex-wrap gap-2">
                {recruited.map((p, i) => (
                  <div key={i} className="bg-blue-900/40 rounded px-2 py-0.5 text-xs flex items-center gap-1">
                    <span className="text-white font-bold">{p.name}</span>
                    <span className="text-blue-300">{POSITION_NAMES[p.position]?.slice(0, 2)}</span>
                    <span className="text-blue-400/60">{p.highSchool?.name || ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectionPicked.length > 0 && (
            <div className="bg-green-950 border border-green-800 rounded-xl p-2 mb-2">
              <div className="text-xs text-green-400 font-bold mb-1">セレクション合格 ({selectionPicked.length}名)</div>
              <div className="flex flex-wrap gap-2">
                {selectionPicked.map((p, i) => (
                  <div key={i} className="bg-green-900/40 rounded px-2 py-0.5 text-xs flex items-center gap-1">
                    <span className="text-white font-bold">{p.name}</span>
                    <span className="text-green-300">{POSITION_NAMES[p.position]?.slice(0, 2)}</span>
                    <span className="text-green-400/60">{p.highSchool?.name || '高校'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectionCandidates.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-ink-sub text-lg mb-4">セレクション参加者がいません</p>
              <button onClick={() => setPending({ type: 'finish' })}
                className="btn-primary px-6 py-2 rounded-xl">
                オフシーズンへ
              </button>
            </div>
          ) : (
            <div className="bg-surface-2 rounded-xl border border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700/50 text-xs">
                      <th className="py-1 px-1 text-gray-400">名前</th>
                      <th className="py-1 px-1 text-gray-400">守</th>
                      <th className="py-1 px-1 text-gray-400">投打</th>
                      <th className="py-1 px-1 text-gray-400">フォーム</th>
                      <SelTh label="年" sortK="age" title="年齢でソート" />
                      <th className="py-1 px-1 text-gray-400">体</th>
                      <th className="py-1 px-1 text-gray-400">出身校</th>
                      <SelTh label="ミー" sortK="meet" title="ミートでソート" />
                      <SelTh label="パワ" sortK="power" title="パワーでソート" />
                      <SelTh label="走力" sortK="speed" title="走力でソート" />
                      <SelTh label="肩" sortK="arm" title="肩力でソート" />
                      <SelTh label="守備" sortK="defense" title="守備でソート" />
                      <SelTh label="選眼" sortK="eye" title="選球眼でソート" />
                      <SelTh label="球速" sortK="velocity" title="球速でソート" />
                      <SelTh label="制球" sortK="control" title="制球でソート" />
                      <SelTh label="スタ" sortK="stamina" title="スタミナでソート" />
                      <SelTh label="精神" sortK="mental" title="精神力でソート" />
                      <SelTh label="器用" sortK="dexterity" title="器用さでソート" />
                      <SelTh label="体力" sortK="bodyStamina" title="体力でソート" />
                      <SelTh label="体幹" sortK="muscle" title="体幹でソート" />
                      <SelTh label="プロ" sortK="professionalism" title="プロ意識でソート" />
                      <SelTh label="成長" sortK="growthPotential" title="成長力でソート" />
                      <th className="py-1 px-1 text-gray-400 sticky right-0 bg-surface-2 border-l border-gray-700/50">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSelectionCandidates.map(p => {
                      const sa = p.scoutedAbilities || {};
                      const isPicked = selectionPicked.some(sp => sp.id === p.id);
                      const canAdd = !isPicked && selectionPicked.length < selectionSlots;
                      return (
                        <tr key={p.id} className={`border-b border-gray-800/50 hover:bg-gray-700/20 transition ${isPicked ? 'bg-green-950/30' : ''}`}>
                          <td className="py-1.5 px-1 whitespace-nowrap">
                            {isPicked && <span className="text-green-400 text-xs mr-1">合格</span>}
                            <span className={`font-bold ${isPicked ? 'text-green-300' : 'text-white'}`}>{p.name}</span>
                          </td>
                          <td className="py-1.5 px-1 text-gray-300 whitespace-nowrap">{POSITION_NAMES[p.position]?.slice(0, 2) || p.position}</td>
                          <td className="py-1.5 px-1 text-gray-300 text-center whitespace-nowrap">{throwLabel(p.physical?.throws)}{batLabel(p.batting?.bats)}</td>
                          <td className="py-1.5 px-1 text-gray-300 text-center whitespace-nowrap">{formLabel(p.pitching?.form)}</td>
                          <td className="py-1.5 px-1 text-gray-300 text-center">{p.age}</td>
                          <td className="py-1.5 px-1 text-center whitespace-nowrap">
                            <span className={p.physical?.build === 'large' ? 'text-orange-400' : p.physical?.build === 'small' ? 'text-cyan-400' : 'text-gray-300'}>
                              {p.physical?.build === 'large' ? '大柄' : p.physical?.build === 'small' ? '小柄' : '中肉'}
                            </span>
                          </td>
                          <td className="py-1.5 px-1 text-gray-300 whitespace-nowrap">{p.highSchool?.name || '高校'}</td>
                          <td className="py-1.5 px-1 text-center">{renderVal(sa.batting?.meet)}</td>
                          <td className="py-1.5 px-1 text-center">{renderVal(sa.batting?.power)}</td>
                          <td className="py-1.5 px-1 text-center">{renderVal(sa.physical?.speed)}</td>
                          <td className="py-1.5 px-1 text-center">{renderVal(sa.physical?.arm)}</td>
                          <td className="py-1.5 px-1 text-center">{renderVal(sa.fielding?.defense)}</td>
                          <td className="py-1.5 px-1 text-center">{renderVal(sa.batting?.eye)}</td>
                          <td className="py-1.5 px-1 text-center">{renderVal(sa.pitching?.velocity, true)}</td>
                          <td className="py-1.5 px-1 text-center">{renderVal(sa.pitching?.control)}</td>
                          <td className="py-1.5 px-1 text-center">{renderVal(sa.pitching?.stamina, false, true)}</td>
                          <td className="py-1.5 px-1 text-center">{renderVal(sa.mental)}</td>
                          <td className="py-1.5 px-1 text-center">{renderVal(sa.physical?.dexterity)}</td>
                          <td className="py-1.5 px-1 text-center">{renderVal(sa.physical?.bodyStamina)}</td>
                          <td className="py-1.5 px-1 text-center">{renderVal(sa.physical?.muscle)}</td>
                          <td className="py-1.5 px-1 text-center">{renderVal(sa.professionalism)}</td>
                          <td className={`py-1.5 px-1 text-center font-bold ${gpColor(p.growthPotential)}`}>{gpLabel(p.growthPotential)}</td>
                          <td className="py-1.5 px-1 whitespace-nowrap sticky right-0 bg-surface-2 border-l border-gray-700/50">
                            {isPicked ? (
                              <button onClick={() => handleSelectionPick(p)}
                                className="btn-primary px-2 py-0.5 rounded text-xs transition">
                                合格 ✕
                              </button>
                            ) : canAdd ? (
                              <button onClick={() => handleSelectionPick(p)}
                                className="btn-primary px-2 py-0.5 rounded text-xs transition">
                                合格にする
                              </button>
                            ) : (
                              <span className="text-gray-400 text-xs">枠なし</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {pending?.type === 'finish' && (
            <ConfirmBar
              title="セレクションの合格者を確定して、オフシーズンへ進みますか？"
              detail={`推薦${recruited.length}名・セレクション合格${selectionPicked.length}名（セレクションの枠${selectionSlots}名）`}
              note={`確定すると取り消せません。${selectionPicked.length < selectionSlots ? `セレクションの枠があと${selectionSlots - selectionPicked.length}名あります。` : ''}`}
              confirmLabel="確定する"
              confirmClass="btn-warn"
              onConfirm={() => { setPending(null); handleSelectionFinalize(); }}
              onCancel={() => setPending(null)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="max-w-[1800px] mx-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {onBack && (
              <button onClick={onBack}
                className="btn-secondary px-3 py-1.5 rounded-lg text-sm font-bold transition flex items-center gap-1 flex-shrink-0">
                ← 戻る
              </button>
            )}
            <div>
              <h1 className="text-xl font-bold text-ink">スポーツ推薦スカウト</h1>
              <p className="text-ink-sub text-xs mt-0.5">
                {userTeamName} ({rank}ランク) — 推薦枠: {remainingSlots}/{maxSlots}名
                {recruited.length > 0 && <span className="text-ink-accent ml-2">確保済{recruited.length}名</span>}
                <span className="text-ink-accent ml-2">接近中: {approachingCount}/{maxApproaches}名</span>
              </p>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <div className="text-ink-sub text-xs mr-2">
              調査: 5日 / 注目: +ゲージ速度
            </div>
            {onComplete && (
              <button onClick={() => setPending({ type: 'close' })}
                className="btn-primary px-4 py-2 rounded-lg text-sm transition">
                推薦を締め切る → セレクションへ
              </button>
            )}
          </div>
        </div>

        {newDiscoveryCount > 0 && (
          <div className="bg-yellow-950 border border-yellow-800 rounded-xl p-2 mb-3 flex items-center justify-between">
            <span className="text-yellow-300 text-xs font-bold">
              新たに{newDiscoveryCount}名の候補者が見つかりました
            </span>
            <button onClick={() => setNewDiscoveryCount(0)}
              className="text-yellow-500 hover:text-yellow-300 text-xs px-2">
              ✕
            </button>
          </div>
        )}

        {gaugeCompleteCount > 0 && (
          <div className="bg-green-950 border border-green-700 rounded-xl p-2 mb-3 flex items-center justify-between">
            <span className="text-green-300 text-xs font-bold">
              ゲージが満タンになった選手が{gaugeCompleteCount}名います！「推薦で確保」を押して確保してください
            </span>
            <button onClick={() => setGaugeCompleteCount(0)}
              className="text-green-500 hover:text-green-300 text-xs px-2">
              ✕
            </button>
          </div>
        )}

        {recruited.length > 0 && (
          <div className="bg-green-950 border border-green-800 rounded-xl p-2 mb-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-xs text-green-400 font-bold">確保済み選手</div>
              {undoRecruit && (
                <button onClick={undoLastRecruit}
                  className="btn-secondary ml-auto px-2.5 py-0.5 rounded text-xs">
                  ↩ 直前の推薦（{undoRecruit.player.name}）を取り消す
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {recruited.map((p, i) => (
                <div key={i} className="bg-green-900/40 rounded px-2 py-0.5 text-xs flex items-center gap-1">
                  <span className="text-white font-bold">{p.name}</span>
                  <span className="text-green-300">{POSITION_NAMES[p.position]?.slice(0, 2)}</span>
                  <span className="text-green-400/60">{p.highSchool?.name || p._scoutSource || ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {candidates.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-ink-sub text-lg mb-4">
              {highSchoolPool.players?.length > 0 ? 'スカウト候補が見つかりませんでした' : '高校生プールがまだ生成されていません (4月以降)'}
            </p>
            {onComplete && (
              <button onClick={() => setPending({ type: 'close' })} className="btn-primary px-6 py-2 rounded-xl">
                オフシーズンへ
              </button>
            )}
          </div>
        ) : (
          <div className="bg-surface-2 rounded-xl border border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-700/50 text-xs">
                    <SortHeader k="rec" label="推" />
                    <SortHeader k="name" label="名前" />
                    <th className="py-1 px-1 text-gray-400">守</th>
                    <th className="py-1 px-1 text-gray-400">投打</th>
                    <th className="py-1 px-1 text-gray-400">フォーム</th>
                    <SortHeader k="age" label="年" />
                    <th className="py-1 px-1 text-gray-400">体</th>
                    <th className="py-1 px-1 text-gray-400">出身</th>
                    <th className="py-1 px-1 text-gray-400">情報</th>
                    <SortHeader k="velocity" label="球速" />
                    <SortHeader k="control" label="制球" />
                    <SortHeader k="stamina" label="スタ" />
                    <SortHeader k="meet" label="ミー" />
                    <SortHeader k="power" label="パワ" />
                    <SortHeader k="eye" label="選眼" />
                    <SortHeader k="speed" label="走力" />
                    <SortHeader k="arm" label="肩力" />
                    <SortHeader k="bodyStamina" label="体幹" />
                    <SortHeader k="dexterity" label="器用" />
                    <SortHeader k="defense" label="守備" />
                    <SortHeader k="mental" label="精神" />
                    <SortHeader k="professionalism" label="プロ" />
                    <SortHeader k="growth" label="成長" />
                    <SortHeader k="gaugeRate" label="速度" />
                    <SortHeader k="gauge" label="ゲージ" />
                    <SortHeader k="rivalMax" label="競合" />
                    {/* ⚠ 操作の列は右端に**貼り付ける**（sticky）。列が多く 1280〜1440 では表が
                        横に流れて、操作のボタンと競合の列が右の見えないところへ出ていた。
                        ボタンの文字も折り返さないこと（1文字ずつ縦に並んでいた） */}
                    <th className="py-1 px-1 text-gray-400 sticky right-0 bg-surface-2 border-l border-gray-700/50">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCandidates.map(p => {
                    const sa = p.scoutedAbilities || {};
                    const recGrade = getUniversityScoutRecommendation(p, rank);
                    const isInvestigating = p._investigating;
                    const canInvestigate = !isInvestigating && (p._revealLevel || 0) < 2;
                    const gauge = p._approachGauge || 0;
                    const gaugeRate = calculateDailyGaugeRate(p, rank, reputation);
                    const daysLeft = gauge < 100 ? Math.ceil((100 - gauge) / gaugeRate) : 0;
                    const canApproach = !p._approaching && approachingCount < maxApproaches && remainingSlots > 0;
                    const rival = getRivalInfo(p);
                    return (
                      <tr key={p.id} className={`border-b border-gray-800/50 hover:bg-gray-700/20 transition ${p._npbDrafted ? 'bg-red-950/20 opacity-70' : p._reservedBy ? 'bg-gray-900/60 opacity-60' : p._approaching ? 'bg-cyan-900/10' : ''}`}>
                        <td className={`py-1.5 px-1 text-center font-black ${recColor(recGrade)}`}>{recGrade}</td>
                        <td className="py-1.5 px-1 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {p._watching && <span className="text-yellow-400 text-xs" title="注目中">★</span>}
                            <span className="text-white font-bold">{p.name}</span>
                          </div>
                        </td>
                        <td className="py-1.5 px-1 text-gray-300 whitespace-nowrap">{POSITION_NAMES[p.position]?.slice(0, 2) || p.position}</td>
                        <td className="py-1.5 px-1 text-gray-300 text-center whitespace-nowrap">{throwLabel(p.physical?.throws)}{batLabel(p.batting?.bats)}</td>
                        <td className="py-1.5 px-1 text-gray-300 text-center whitespace-nowrap">{formLabel(p.pitching?.form)}</td>
                        <td className="py-1.5 px-1 text-gray-300 text-center">{p.age}</td>
                        <td className="py-1.5 px-1 text-center whitespace-nowrap">
                          <span className={p.physical?.build === 'large' ? 'text-orange-400' : p.physical?.build === 'small' ? 'text-cyan-400' : 'text-gray-300'}>
                            {p.physical?.build === 'large' ? '大柄' : p.physical?.build === 'small' ? '小柄' : '中肉'}
                          </span>
                        </td>
                        <td className="py-1.5 px-1 text-gray-300 whitespace-nowrap">{p._scoutSource}</td>
                        <td className="py-1.5 px-1 text-center whitespace-nowrap">{revealLabel(p._revealLevel || 0)}</td>
                        <td className="py-1.5 px-1 text-center">{renderVal(sa.pitching?.velocity, true)}</td>
                        <td className="py-1.5 px-1 text-center">{renderVal(sa.pitching?.control)}</td>
                        <td className="py-1.5 px-1 text-center">{renderVal(sa.pitching?.stamina, false, true)}</td>
                        <td className="py-1.5 px-1 text-center">{renderVal(sa.batting?.meet)}</td>
                        <td className="py-1.5 px-1 text-center">{renderVal(sa.batting?.power)}</td>
                        <td className="py-1.5 px-1 text-center">{renderVal(sa.batting?.eye)}</td>
                        <td className="py-1.5 px-1 text-center">{renderVal(sa.physical?.speed)}</td>
                        <td className="py-1.5 px-1 text-center">{renderVal(sa.physical?.arm)}</td>
                        <td className="py-1.5 px-1 text-center">{renderVal(sa.physical?.bodyStamina)}</td>
                        <td className="py-1.5 px-1 text-center">{renderVal(sa.physical?.dexterity)}</td>
                        <td className="py-1.5 px-1 text-center">{renderVal(sa.fielding?.defense)}</td>
                        <td className="py-1.5 px-1 text-center">{renderVal(sa.mental)}</td>
                        <td className="py-1.5 px-1 text-center">{renderVal(sa.professionalism)}</td>
                        <td className={`py-1.5 px-1 text-center font-bold ${gpColor(p.growthPotential)}`}>{gpLabel(p.growthPotential)}</td>
                        <td className="py-1.5 px-1 text-center whitespace-nowrap">
                          <span className={`font-bold ${gaugeRate >= 4 ? 'text-green-400' : gaugeRate >= 2.5 ? 'text-yellow-400' : gaugeRate >= 1.5 ? 'text-orange-400' : 'text-red-400'}`}>
                            +{gaugeRate}/日
                          </span>
                          {p._approaching && <span className="text-gray-400 text-xs ml-0.5">({daysLeft}日)</span>}
                        </td>
                        <td className="py-1.5 px-1" style={{ minWidth: '90px' }}>
                          {p._gaugeComplete ? (
                            <div className="flex items-center gap-1">
                              <div className="w-14 h-2.5 bg-gray-700 rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-green-400 animate-pulse" style={{ width: '100%' }} />
                              </div>
                              <span className="text-green-400 text-xs font-black">FULL!</span>
                            </div>
                          ) : p._approaching ? (
                            <div className="flex items-center gap-1">
                              <div className="w-14 h-2.5 bg-gray-700 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${gauge >= 80 ? 'bg-green-500' : gauge >= 50 ? 'bg-yellow-500' : 'bg-cyan-500'}`}
                                  style={{ width: `${gauge}%` }} />
                              </div>
                              <span className="text-white text-xs font-bold">{Math.floor(gauge)}%</span>
                            </div>
                          ) : gauge > 0 ? (
                            <span className="text-gray-400 text-xs">{Math.floor(gauge)}% (停止中)</span>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-1.5 px-1 whitespace-nowrap" style={{ minWidth: '80px' }}>
                          {p._npbDrafted ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-red-400 text-xs font-bold">NPB指名済</span>
                              <span className="text-red-300 text-xs">{p._npbDrafted.team.replace('ジャイアンツ','G').replace('タイガース','T').replace('ベイスターズ','De').replace('カープ','C').replace('ドラゴンズ','D').replace('スワローズ','S').replace('バファローズ','Bs').replace('ホークス','H').replace('ライオンズ','L').replace('ゴールデンイーグルス','E').replace('マリーンズ','M').replace('ファイターズ','F')}</span>
                              <span className="text-red-500 text-xs">{p._npbDrafted.round}</span>
                            </div>
                          ) : p._reservedBy ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-pink-400 text-xs font-bold">進学決定</span>
                              <span className="text-pink-300 text-xs">{p._reservedBy}</span>
                            </div>
                          ) : rival && rival.count > 0 ? (
                            <div className="flex flex-col gap-0.5">
                              {rival.rivals.map((r, ri) => (
                                <div key={ri} className="flex items-center gap-1">
                                  <span className={`text-xs font-bold ${r.gauge >= 70 ? 'text-red-400' : r.gauge >= 40 ? 'text-orange-400' : 'text-gray-300'}`}>
                                    {r.name.length > 4 ? r.name.slice(0, 4) + '..' : r.name}
                                  </span>
                                  <div className="w-8 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${r.gauge >= 70 ? 'bg-red-500' : r.gauge >= 40 ? 'bg-orange-500' : 'bg-gray-500'}`}
                                      style={{ width: `${r.gauge}%` }} />
                                  </div>
                                  <span className="text-gray-300 text-xs">{r.gauge}%</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-1.5 px-1 whitespace-nowrap sticky right-0 bg-surface-2 border-l border-gray-700/50">
                          {(p._npbDrafted || p._reservedBy) ? (
                            <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-surface-2 text-gray-400">
                              交渉不可
                            </span>
                          ) : p._gaugeComplete ? (
                            <button
                              onClick={() => setPending({ type: 'recruit', id: p.id, force: false })}
                              disabled={remainingSlots <= 0}
                              className={`px-2 py-0.5 rounded text-xs font-black transition animate-pulse ${
                                'btn-primary'
                              }`}>
                              {remainingSlots > 0 ? '✓ 推薦で確保' : '枠なし'}
                            </button>
                          ) : (onComplete && !p._npbDrafted && !p._reservedBy && (p._approachGauge || 0) >= 80 && remainingSlots > 0) ? (
                            <button
                              onClick={() => setPending({ type: 'recruit', id: p.id, force: true })}
                              className="btn-warn px-2 py-0.5 rounded text-xs font-black transition shadow-lg">
                              推薦で確保(80%+)
                            </button>
                          ) : (
                          <div className="flex gap-1">
                            <button onClick={() => handleWatch(p.id)}
                              className={`px-1.5 py-0.5 rounded text-xs font-bold transition ${
                                p._watching ? 'seg-on' : 'seg'}`}
                              title={p._watching ? '注目解除' : '注目'}>
                              {p._watching ? '★注目中' : '☆注目'}
                            </button>
                            {canInvestigate && (
                              <button onClick={() => handleInvestigate(p.id)}
                                className="btn-primary px-1.5 py-0.5 rounded text-xs transition">
                                調査
                              </button>
                            )}
                            {isInvestigating && (
                              <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-gray-700 text-gray-300">
                                調査中...
                              </span>
                            )}
                            {!p._approaching && canApproach && (
                              <button onClick={() => handleApproach(p.id)}
                                className="btn-primary px-1.5 py-0.5 rounded text-xs transition">
                                接近
                              </button>
                            )}
                            {p._approaching && (
                              <button onClick={() => handleStopApproach(p.id)}
                                className="btn-danger px-1.5 py-0.5 rounded text-xs transition">
                                中断
                              </button>
                            )}
                          </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {onBack && (
          <div className="mt-6 pt-4 border-t border-gray-600">
            <button onClick={onBack}
              className="btn-secondary px-6 py-2.5 rounded-lg font-bold text-sm transition flex items-center gap-2">
              ← 戻る
            </button>
          </div>
        )}
        {pending?.type === 'recruit' && (() => {
          const c = candidates.find(p => p.id === pending.id);
          if (!c) return null;
          return (
            <ConfirmBar
              title={`${c.name} を推薦で確保しますか？`}
              detail={`${POSITION_NAMES[c.position] || c.position}・${c.age}歳・${c.highSchool?.name || c._scoutSource || '高校'}・推薦枠 残り${remainingSlots}名`}
              note={pending.force ? 'ゲージは満タンではありませんが、80%以上なので確保できます。' : undefined}
              confirmLabel="確保する"
              onConfirm={() => { setPending(null); handleConfirmRecruit(c.id, pending.force); }}
              onCancel={() => setPending(null)}
            />
          );
        })()}
        {pending?.type === 'close' && (
          <ConfirmBar
            title="推薦をここで締め切って、セレクションへ進みますか？"
            detail={`推薦で確保 ${recruited.length}名・セレクションの枠 ${selectionSlots}名`}
            note="締め切ると取り消せません。推薦の交渉には戻れません。"
            confirmLabel="締め切る"
            confirmClass="btn-warn"
            onConfirm={() => { setPending(null); handleFinalize(); }}
            onCancel={() => setPending(null)}
          />
        )}
      </div>
      {modalPlayer && <PlayerDetailModal player={modalPlayer} onClose={() => setModalPlayer(null)} />}
    </div>
  );
};

export default UniversityScoutScreen;
