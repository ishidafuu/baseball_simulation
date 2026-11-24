import React, { useState, useMemo, useRef } from 'react';
import { rosterIndex, departedSince } from '../season/departedStats.js';
import { TEAMS_DATA } from '../teams-data.js';
import { POSITION_NAMES, getAbilityColor, getPositionSortIndex } from '../utils/constants.js';
import { AbilityValue } from './AbilityValue.jsx';
import { processCorporateRetirements, executeDepartures } from '../corporate/corporateDepartures.js';
import { getPlayerSalary, getStaffSalary, convertPlayerToStaff, STAFF_ABILITIES, MAX_STAFF } from '../corporate/staffData.js';
import { budgetBreakdown, generateSponsorOffers, acceptSponsor, SPONSOR_TIERS } from '../corporate/corporateInit.js';
import { getTeamStaffBonus, STAFF_GRADES } from '../corporate/staffData.js';
import { hashSeed, withSeededRandom } from '../game/rng.js';
import ConfirmBar from './ConfirmBar.jsx';

const CorporateDepartureScreen = ({ seasonData, allTeams, onComplete }) => {
  const teamNames = Object.keys(TEAMS_DATA || {});
  const userTeamName = teamNames[0] || '';
  const [{ retirements, aiReleases }] = useState(() => processCorporateRetirements(TEAMS_DATA, userTeamName));
  const [playerDecisions, setPlayerDecisions] = useState({});
  const [confirmed, setConfirmed] = useState(false);
  // 確定で名簿から外れた選手の、その年の成績の写し（次へ進むときに seasonData へ渡す）
  const departedRef = useRef([]);
  const [sortKey, setSortKey] = useState('salary');
  const [sortAsc, setSortAsc] = useState(false);
  const [sponsorOffers, setSponsorOffers] = useState(() => withSeededRandom(
    hashSeed(`sponsor:${seasonData?.year}:${userTeamName}`),
    () => generateSponsorOffers(TEAMS_DATA[userTeamName]?.corporateData)
  ));
  const [staffConversions, setStaffConversions] = useState({});
  const [staffPreviews, setStaffPreviews] = useState({});
  const [replaceStaffFor, setReplaceStaffFor] = useState(null);
  const [staffReplacements, setStaffReplacements] = useState({});
  // 確定の前の帯。⚠ 以前は「契約更改を確定」を1回押すだけで、解雇・引退・スタッフ転向が
  //    確定して取り消せなかった（赤字のままでも同じ）
  const [reviewing, setReviewing] = useState(false);

  const teamData = TEAMS_DATA[userTeamName];
  const cd = teamData?.corporateData;
  const isClub = cd?.type === 'club';
  const players = teamData?.players || [];
  const staff = cd?.staff || [];

  const userRetiredIds = new Set(retirements.filter(r => r.team === userTeamName).map(r => r.id));
  const activePlayers = players.filter(p => !userRetiredIds.has(p.id));

  // 予算計算
  const staffBonus = getTeamStaffBonus(staff);
  const { baseBudget, reputationBonus, managingBonus, tournamentBonus, sponsorIncome: currentSponsorIncome } = budgetBreakdown(cd, staff);
  const staffSalaryTotal = staff.reduce((sum, s) => sum + getStaffSalary(s), 0);

  // スタッフ転向する選手の追加人件費
  const conversionSalaryTotal = Object.entries(staffPreviews).reduce((sum, [pid, sp]) => {
    if (!staffConversions[pid]) return sum;
    const numPid = parseInt(pid);
    const decision = playerDecisions[numPid] || playerDecisions[pid] || 'contract';
    const isAutoRetired = userRetiredIds.has(numPid) || userRetiredIds.has(pid);
    if (decision === 'retire' || isAutoRetired) {
      return sum + getStaffSalary(sp);
    }
    return sum;
  }, 0);

  // 契約中の選手の総年俸（解雇/引退でない選手）
  const projectedPlayerSalary = activePlayers.reduce((sum, p) => {
    const decision = playerDecisions[p.id];
    if (decision === 'release' || decision === 'retire') return sum;
    return sum + getPlayerSalary(p);
  }, 0);
  const totalSalary = projectedPlayerSalary + staffSalaryTotal + conversionSalaryTotal;
  const totalBudget = baseBudget + reputationBonus + managingBonus + tournamentBonus + currentSponsorIncome;
  const budgetBalance = totalBudget - totalSalary;

  const releaseCount = activePlayers.filter(p => playerDecisions[p.id] === 'release').length;
  const retireCount = activePlayers.filter(p => playerDecisions[p.id] === 'retire').length;
  const contractCount = activePlayers.length - releaseCount - retireCount;

  const getSortValue = (player, key) => {
    const isPitcher = player.position === 'pitcher';
    switch (key) {
      case 'name': return player.name;
      case 'age': return player.age || 0;
      case 'position': return getPositionSortIndex(player.position);
      case 'salary': return getPlayerSalary(player);
      case 'meet': return player.batting?.meet || 0;
      case 'power': return player.batting?.power || 0;
      case 'speed': return player.physical?.speed || 0;
      case 'defense': return player.fielding?.defense || 0;
      case 'velocity': return player.pitching?.velocity || 0;
      case 'control': return player.pitching?.control || 0;
      case 'stamina': return player.pitching?.stamina || 0;
      case 'games': return isPitcher ? (player.seasonStats?.pitching?.games || 0) : (player.seasonStats?.batting?.games || 0);
      default: return 0;
    }
  };

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const sortedPlayers = useMemo(() => {
    if (!sortKey) return activePlayers;
    return [...activePlayers].sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortAsc ? va - vb : vb - va;
    });
  }, [activePlayers, sortKey, sortAsc]);

  const cycleDecision = (playerId) => {
    const current = playerDecisions[playerId] || 'contract';
    const next = current === 'contract' ? 'release' : current === 'release' ? 'retire' : 'contract';
    setPlayerDecisions({ ...playerDecisions, [playerId]: next });
    if (next !== 'retire' && staffConversions[playerId]) {
      const nextConv = { ...staffConversions };
      delete nextConv[playerId];
      setStaffConversions(nextConv);
      const nextPrev = { ...staffPreviews };
      delete nextPrev[playerId];
      setStaffPreviews(nextPrev);
    }
  };

  const pendingConversionCount = Object.values(staffConversions).filter(Boolean).length;
  const pendingReplacementCount = Object.values(staffReplacements).filter(Boolean).length;
  const effectiveStaffCount = staff.length + pendingConversionCount - pendingReplacementCount;

  const toggleStaffConversion = (playerId) => {
    const player = players.find(p => p.id === playerId);
    if (!player) return;
    if (staffConversions[playerId]) {
      const next = { ...staffConversions };
      delete next[playerId];
      setStaffConversions(next);
      const nextPrev = { ...staffPreviews };
      delete nextPrev[playerId];
      setStaffPreviews(nextPrev);
      const nextRepl = { ...staffReplacements };
      delete nextRepl[playerId];
      setStaffReplacements(nextRepl);
      setReplaceStaffFor(null);
    } else if (effectiveStaffCount >= MAX_STAFF) {
      const preview = convertPlayerToStaff(player, seasonData?.year);
      setStaffPreviews({ ...staffPreviews, [playerId]: preview });
      setReplaceStaffFor(playerId);
    } else {
      const preview = convertPlayerToStaff(player, seasonData?.year);
      setStaffConversions({ ...staffConversions, [playerId]: true });
      setStaffPreviews({ ...staffPreviews, [playerId]: preview });
    }
  };

  const selectStaffToReplace = (playerId, staffId) => {
    setStaffReplacements({ ...staffReplacements, [playerId]: staffId });
    setStaffConversions({ ...staffConversions, [playerId]: true });
    setReplaceStaffFor(null);
  };

  const handleAcceptSponsor = (offer, index) => {
    acceptSponsor(cd, offer);
    setSponsorOffers(prev => prev.filter((_, i) => i !== index));
  };

  const handleConfirm = () => {
    const currentYear = seasonData?.year || 1;
    const allReleases = { ...aiReleases };

    const userReleaseIds = activePlayers
      .filter(p => playerDecisions[p.id] === 'release')
      .map(p => p.id);
    if (userReleaseIds.length > 0) {
      allReleases[userTeamName] = userReleaseIds;
    }

    const userRetireIds = activePlayers
      .filter(p => playerDecisions[p.id] === 'retire')
      .map(p => p.id);
    const allRetiredIds = [
      ...retirements.map(r => r.id),
      ...userRetireIds,
    ];

    // ⚠ 名簿から外す前後で比べて、外れた選手のその年の成績を写しておく
    //    （選手成績の画面が年度末まで出す。`departedStats.js`）
    const rosterBefore = rosterIndex(TEAMS_DATA);
    executeDepartures(TEAMS_DATA, allRetiredIds, allReleases, currentYear);
    departedRef.current = departedSince(rosterBefore, TEAMS_DATA);

    // 赤字判定は11/30の年度末決算で行う（退団・入団・スタッフ・スポンサー確定後）

    // スタッフ転向処理（入替がある場合は先に既存スタッフを除去）
    Object.entries(staffConversions).forEach(([pid, enabled]) => {
      if (!enabled) return;
      const numPid = typeof pid === 'string' ? parseInt(pid) : pid;
      const decision = playerDecisions[numPid] || 'contract';
      const isAutoRetired = userRetiredIds.has(numPid);
      if (decision === 'retire' || isAutoRetired) {
        const preview = staffPreviews[pid];
        if (preview && cd) {
          const replaceId = staffReplacements[pid];
          if (replaceId) {
            const idx = cd.staff.findIndex(s => s.id === replaceId);
            if (idx >= 0) cd.staff.splice(idx, 1);
          }
          cd.staff.push(preview);
        }
      }
    });

    setConfirmed(true);
  };

  const SortHeader = ({ label, sortKeyVal, className = '' }) => (
    <th
      className={`py-1 px-1 cursor-pointer hover:text-white hover:bg-gray-600 transition select-none text-xs ${sortKey === sortKeyVal ? 'bg-gray-600 text-white' : ''} ${className}`}
      onClick={() => handleSort(sortKeyVal)}
    >
      {label}{sortKey === sortKeyVal ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  );

  const totalAiReleases = Object.values(aiReleases).reduce((sum, arr) => sum + arr.length, 0);
  const totalRetirements = retirements.length;

  const gradeColor = (grade) => {
    const colors = { S: 'text-red-400', A: 'text-orange-400', B: 'text-yellow-400', C: 'text-green-400', D: 'text-gray-300' };
    return colors[grade] || 'text-gray-300';
  };

  const StaffPreview = ({ preview }) => (
    <div className="mt-1 pl-2 border-l-2 border-cyan-700/50">
      <div className="flex items-center gap-2 text-xs">
        <span className={`font-bold ${gradeColor(preview.grade)}`}>{STAFF_GRADES[preview.grade]?.label}</span>
        <span className="text-cyan-400">コーチ</span>
        <span className="text-gray-300">年俸{getStaffSalary(preview).toLocaleString()}万</span>
        <span className="text-cyan-600">元選手</span>
      </div>
      <div className="flex gap-2 mt-0.5 text-xs flex-wrap">
        {preview.strengths.map(key => (
          <span key={key} className="bg-cyan-900/30 text-cyan-400 px-1 py-0.5 rounded">
            {STAFF_ABILITIES[key]?.name || key}
          </span>
        ))}
      </div>
      <div className="flex gap-2 mt-0.5 text-xs text-gray-400">
        {Object.entries(STAFF_ABILITIES).slice(0, 5).map(([key, info]) => (
          <span key={key}>
            {info.name.slice(0, 2)}
            <span className={`font-bold ml-0.5 ${getAbilityColor(preview.abilities[key] || 0)}`}>
              {preview.abilities[key] || 0}
            </span>
          </span>
        ))}
      </div>
    </div>
  );

  const StaffReplaceSelector = ({ playerId }) => {
    if (replaceStaffFor !== playerId) {
      if (staffReplacements[playerId]) {
        const replaced = staff.find(s => s.id === staffReplacements[playerId]);
        return replaced ? (
          <div className="mt-1 text-xs text-orange-400">
            → {replaced.name}（{STAFF_GRADES[replaced.grade]?.label}）と入替
            <button onClick={() => {
              const next = { ...staffReplacements };
              delete next[playerId];
              setStaffReplacements(next);
              const nextConv = { ...staffConversions };
              delete nextConv[playerId];
              setStaffConversions(nextConv);
            }} className="ml-2 text-gray-400 hover:text-gray-300">取消</button>
          </div>
        ) : null;
      }
      return null;
    }
    return (
      <div className="mt-2 p-2 bg-surface-2 rounded border border-orange-700/50">
        <p className="text-xs text-orange-400 mb-1.5 font-bold">スタッフ枠が上限（{MAX_STAFF}名）です。入替えるスタッフを選んでください：</p>
        <div className="space-y-1">
          {staff.map(s => (
            <button key={s.id}
              onClick={() => selectStaffToReplace(playerId, s.id)}
              className="btn-danger w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs transition">
              <span className={`font-bold ${gradeColor(s.grade)}`}>{STAFF_GRADES[s.grade]?.label}</span>
              <span className="text-white">{s.name}</span>
              <span className="text-gray-300">{s.role === 'coach' ? 'コーチ' : s.role === 'manager' ? 'マネ' : 'トレ'}</span>
              <span className="text-gray-400">年俸{getStaffSalary(s).toLocaleString()}万</span>
              {s.isFormerPlayer && <span className="text-cyan-600">元選手</span>}
              <span className="ml-auto text-gray-400">{s.strengths?.map(k => STAFF_ABILITIES[k]?.name?.slice(0, 2)).join(' ')}</span>
            </button>
          ))}
        </div>
        <button onClick={() => setReplaceStaffFor(null)}
          className="mt-1.5 text-xs text-gray-400 hover:text-gray-300">キャンセル</button>
      </div>
    );
  };

  const DecisionBadge = ({ decision }) => {
    if (decision === 'release') return <span className="text-red-400 font-bold text-xs bg-red-900/40 px-1.5 py-0.5 rounded">解雇</span>;
    if (decision === 'retire') return <span className="text-yellow-400 font-bold text-xs bg-yellow-900/40 px-1.5 py-0.5 rounded">引退</span>;
    return <span className="text-green-400 font-bold text-xs bg-green-900/40 px-1.5 py-0.5 rounded">契約</span>;
  };

  if (confirmed) {
    return (
      <div className="p-4">
        {/* 背景は全幅のまま、本文だけ 7xl で止める（他の画面と本文の位置を揃える） */}
        <div className="max-w-7xl mx-auto">
        <h1 className="text-xl font-bold text-ink mb-3">契約更改完了</h1>
        {totalRetirements + retireCount > 0 && (
          <div className="mb-4">
            <h2 className="text-sm font-bold text-ink mb-2">
              引退選手 ({totalRetirements + retireCount}名)
            </h2>
            <div className="grid grid-cols-2 gap-1">
              {retirements.map(r => (
                <div key={r.id} className="text-xs text-gray-300 bg-surface-2 p-1 rounded">
                  <span className="text-yellow-300">{POSITION_NAMES[r.position]}</span> {r.name}
                  <span className="text-gray-400 ml-1">({r.age}歳・{r.team})</span>
                  <span className="text-gray-400 ml-1">{r.reason}</span>
                </div>
              ))}
              {activePlayers.filter(p => playerDecisions[p.id] === 'retire').map(p => (
                <div key={p.id} className="text-xs text-gray-300 bg-surface-2 p-1 rounded">
                  <span className="text-yellow-300">{POSITION_NAMES[p.position]}</span> {p.name}
                  <span className="text-gray-400 ml-1">({p.age}歳・自チーム)</span>
                  <span className="text-gray-400 ml-1">引退勧告</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {(releaseCount > 0 || totalAiReleases > 0) && (
          <div className="mb-4">
            <h2 className="text-sm font-bold text-ink-warn mb-2">解雇 ({releaseCount + totalAiReleases}名)</h2>
            <p className="text-xs text-ink-sub mb-1">
              自チーム: {releaseCount}名 / 他チーム: {totalAiReleases}名
            </p>
          </div>
        )}
        {/* スタッフ転向 */}
        {Object.keys(staffConversions).filter(pid => staffConversions[pid] && staffPreviews[pid]).length > 0 && (
          <div className="mb-4">
            <h2 className="text-sm font-bold text-ink mb-2">スタッフ転向</h2>
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(staffConversions).filter(([, v]) => v).map(([pid]) => {
                const preview = staffPreviews[pid];
                if (!preview) return null;
                return (
                  <div key={pid} className="text-xs text-gray-300 bg-surface-2 p-1.5 rounded flex items-center gap-2">
                    <span className={`font-bold ${gradeColor(preview.grade)}`}>{STAFF_GRADES[preview.grade]?.label}</span>
                    <span className="text-cyan-400">コーチ</span>
                    <span className="text-white font-medium">{preview.name}</span>
                    <span className="text-gray-400">({preview.age}歳)</span>
                    <span className="text-cyan-600 text-xs">元選手</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="mb-4 bg-surface-2 rounded p-3">
          <div className="text-xs text-gray-300">来季ロスター: <span className="text-white font-bold">{contractCount}名</span></div>
          {!isClub && (
            <div className="text-xs text-gray-300 mt-1">
              来季予算残: <span className={`font-bold ${budgetBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {budgetBalance >= 0 ? '+' : ''}{budgetBalance.toLocaleString()}万円
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => onComplete?.(departedRef.current)}
          className="btn-primary mt-4 px-6 py-2 rounded"
        >
          {isClub ? '入部希望者の受付へ進む' : 'スカウト入団へ進む'}
        </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* 背景は全幅のまま、本文だけ 7xl で止める（4Kで列が伸びきるのを防ぐ） */}
      <div className="max-w-7xl mx-auto">
      {/* ⚠ 地色（明るい紙）の上に直に載る見出しは text-ink。11/9 の画面なので「11月末」ではない */}
      <h1 className="text-xl font-bold text-ink mb-1">契約更改 - {seasonData?.year || 1}年目 11月</h1>
      <p className="text-ink-sub text-xs mb-2">選手をクリックして「契約 → 解雇 → 引退」を切り替えてください</p>

      {/* 予算サマリー（クラブチームは予算なし） */}
      {!isClub && <div className="mb-3 bg-surface-2 rounded-lg p-3">
        <div className="flex items-center gap-4 text-xs">
          <div>
            <span className="text-gray-300">総予算: </span>
            <span className="text-white font-bold">{totalBudget.toLocaleString()}万</span>
          </div>
          <div>
            <span className="text-gray-300">人件費: </span>
            <span className="text-white font-bold">{totalSalary.toLocaleString()}万</span>
            <span className="text-gray-400 ml-1">(選手{projectedPlayerSalary.toLocaleString()} + スタッフ{staffSalaryTotal.toLocaleString()})</span>
          </div>
          <div>
            <span className="text-gray-300">残額: </span>
            <span className={`font-bold ${budgetBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {budgetBalance >= 0 ? '+' : ''}{budgetBalance.toLocaleString()}万
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
          <span>基本{baseBudget.toLocaleString()}</span>
          {reputationBonus > 0 && <span className="text-green-500">+注目度{reputationBonus.toLocaleString()}</span>}
          {managingBonus > 0 && <span className="text-cyan-500">+マネージング{managingBonus.toLocaleString()}</span>}
          {tournamentBonus > 0 && <span className="text-yellow-500">+大会{tournamentBonus.toLocaleString()}</span>}
          {currentSponsorIncome > 0 && <span className="text-purple-500">+スポンサー{currentSponsorIncome.toLocaleString()}</span>}
        </div>
      </div>}

      {/* スポンサーオファー */}
      {!isClub && sponsorOffers && sponsorOffers.length > 0 && (
        <div className="mb-3 bg-surface-2 border border-purple-700/50 rounded-lg p-3">
          <h2 className="text-sm font-bold text-purple-300 mb-2">スポンサーオファー</h2>
          <div className="space-y-1.5">
            {sponsorOffers.map((offer, i) => {
              const tierInfo = SPONSOR_TIERS[offer.tier];
              return (
                <div key={i} className="flex items-center gap-3 bg-gray-800/80 rounded p-2">
                  <span className={`text-xs font-bold w-16 ${tierInfo?.color || 'text-gray-300'}`}>
                    {tierInfo?.label || offer.tier}
                  </span>
                  <span className="text-white text-sm font-medium flex-1">{offer.name}</span>
                  <span className="text-yellow-400 text-xs font-bold">+{offer.income.toLocaleString()}万/年</span>
                  <span className="text-gray-400 text-xs">{offer.duration}年契約</span>
                  <button
                    onClick={() => handleAcceptSponsor(offer, i)}
                    className="btn-secondary px-3 py-1 text-xs rounded"
                  >
                    契約
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 引退選手（自動） */}
      {totalRetirements > 0 && (() => {
        const userRetirements = retirements.filter(r => r.team === userTeamName);
        const otherCount = retirements.filter(r => r.team !== userTeamName).length;
        return (
          <div className="mb-2 p-2 bg-surface-2 border border-yellow-700 rounded">
            <p className="text-yellow-400 text-xs font-bold mb-1">
              自動引退{otherCount > 0 ? ` (他チーム${otherCount}名)` : ''}
            </p>
            {userRetirements.length > 0 && (
              <div className="space-y-1">
                {userRetirements.map(r => {
                  const player = players.find(p => p.id === r.id);
                  const isConverting = staffConversions[r.id];
                  const preview = staffPreviews[r.id];
                  return (
                    <div key={r.id} className="bg-gray-800/60 rounded p-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-yellow-300 text-xs">{POSITION_NAMES[r.position]}</span>
                        <span className="text-gray-300 text-xs font-medium">{r.name}</span>
                        <span className="text-gray-400 text-xs">{r.age}歳 / {r.reason}</span>
                        {!isClub && <button
                          onClick={() => {
                            if (player) toggleStaffConversion(r.id);
                          }}
                          className={`ml-auto px-2 py-0.5 text-xs font-bold rounded transition ${
                            isConverting
                              ? 'seg-on' : 'seg'
                          }`}
                        >
                          {isConverting ? 'コーチ就任' : 'スタッフ転向'}
                        </button>}
                      </div>
                      {isConverting && preview && (
                        <StaffPreview preview={preview} />
                      )}
                      <StaffReplaceSelector playerId={r.id} />
                    </div>
                  );
                })}
              </div>
            )}
            {userRetirements.length === 0 && (
              <p className="text-gray-400 text-xs">自チーム: なし</p>
            )}
          </div>
        );
      })()}

      {totalAiReleases > 0 && (
        <p className="text-xs text-ink-sub mb-2">他チーム自動戦力外: {totalAiReleases}名</p>
      )}

      {/* 選手一覧。⚠ 表の行は背景を持たないので、不透明なカードの上に載せる
           （以前は明るい地色の上に直に載り、選手名がほぼ読めなかった） */}
      <div className="overflow-x-auto mb-3 bg-surface-2 rounded-lg">
        <table className="w-full text-xs text-gray-300 border-collapse">
          <thead className="bg-surface-2 text-gray-300">
            <tr>
              <th className="py-1 px-1 w-12 text-xs">判定</th>
              <SortHeader label="名前" sortKeyVal="name" />
              <SortHeader label="年齢" sortKeyVal="age" />
              <SortHeader label="守" sortKeyVal="position" />
              {!isClub && <SortHeader label="年俸" sortKeyVal="salary" />}
              <SortHeader label="ミ" sortKeyVal="meet" />
              <SortHeader label="パ" sortKeyVal="power" />
              <SortHeader label="走" sortKeyVal="speed" />
              <SortHeader label="守備" sortKeyVal="defense" />
              <SortHeader label="球速" sortKeyVal="velocity" />
              <SortHeader label="制球" sortKeyVal="control" />
              <SortHeader label="ス" sortKeyVal="stamina" />
              <SortHeader label="試合" sortKeyVal="games" />
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map(player => {
              const decision = playerDecisions[player.id] || 'contract';
              const isPitcher = player.position === 'pitcher';
              const games = isPitcher
                ? (player.seasonStats?.pitching?.games || 0)
                : (player.seasonStats?.batting?.games || 0);
              const salary = getPlayerSalary(player);
              return (
                <React.Fragment key={player.id}>
                <tr
                  onClick={() => cycleDecision(player.id)}
                  className={`cursor-pointer border-b border-gray-800 transition ${
                    decision === 'release' ? 'bg-red-900/30 opacity-70' :
                    decision === 'retire' ? 'bg-yellow-900/20 opacity-70' :
                    'hover:bg-surface-2'
                  }`}
                >
                  <td className="py-0.5 px-1 text-center">
                    <DecisionBadge decision={decision} />
                  </td>
                  <td className={`py-0.5 px-1 font-medium ${decision !== 'contract' ? 'line-through' : ''}`}>{player.name}</td>
                  <td className="py-0.5 px-1 text-center">{player.age}</td>
                  <td className="py-0.5 px-1 text-center">{POSITION_NAMES[player.position]}</td>
                  {!isClub && <td className={`py-0.5 px-1 text-right ${decision === 'contract' ? 'text-yellow-400' : 'text-gray-400'}`}>
                    {salary.toLocaleString()}万
                  </td>}
                  <td className={`py-0.5 px-1 text-center ${isPitcher ? 'text-gray-400' : getAbilityColor(player.batting?.meet)}`}>
                    {player.batting?.meet || 0}
                  </td>
                  <td className={`py-0.5 px-1 text-center ${isPitcher ? 'text-gray-400' : getAbilityColor(player.batting?.power)}`}>
                    {player.batting?.power || 0}
                  </td>
                  <td className={`py-0.5 px-1 text-center ${getAbilityColor(player.physical?.speed)}`}>
                    {player.physical?.speed || 0}
                  </td>
                  <td className={`py-0.5 px-1 text-center ${getAbilityColor(player.fielding?.defense)}`}>
                    {player.fielding?.defense || 0}
                  </td>
                  <td className="py-0.5 px-1 text-center">
                    {isPitcher ? <AbilityValue value={player.pitching?.velocity} isVel placeholder="-" /> : <span className="text-gray-400">-</span>}
                  </td>
                  <td className={`py-0.5 px-1 text-center ${!isPitcher ? 'text-gray-400' : getAbilityColor(player.pitching?.control)}`}>
                    {player.pitching?.control || '-'}
                  </td>
                  <td className="py-0.5 px-1 text-center">
                    {isPitcher ? <AbilityValue value={player.pitching?.stamina} isSta placeholder="-" /> : <span className="text-gray-400">-</span>}
                  </td>
                  <td className="py-0.5 px-1 text-center">{games}</td>
                </tr>
                {decision === 'retire' && (
                  <tr key={`${player.id}-staff`} className="bg-yellow-900/10 border-b border-gray-800">
                    <td colSpan={13} className="py-1 px-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleStaffConversion(player.id); }}
                          className={`px-2 py-0.5 text-xs font-bold rounded transition ${
                            staffConversions[player.id]
                              ? 'seg-on' : 'seg'
                          }`}
                        >
                          {staffConversions[player.id] ? 'コーチ就任確定' : 'スタッフとして残す'}
                        </button>
                        {staffConversions[player.id] && staffPreviews[player.id] && (
                          <StaffPreview preview={staffPreviews[player.id]} />
                        )}
                      </div>
                      <StaffReplaceSelector playerId={player.id} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 予算超過警告 */}
      {!isClub && budgetBalance < 0 && (
        <div className="mb-2 p-2 bg-surface-2 border border-red-700 rounded">
          <p className="text-red-400 text-xs font-bold mb-1">
            ⚠️ 予算超過: {Math.abs(budgetBalance).toLocaleString()}万円の赤字です
          </p>
          <div className="text-xs text-red-300 space-y-0.5">
            <p>赤字のまま確定すると以下のペナルティが発生します:</p>
            <p>• 注目度低下（最大-15）</p>
            <p>• スポンサー離脱リスク</p>
            <p>• スカウト候補数の減少</p>
          </div>
        </div>
      )}

      {/* 入替未完了警告 */}
      {replaceStaffFor !== null && (
        <div className="mb-2 p-2 bg-surface-2 border border-orange-700 rounded">
          <p className="text-orange-400 text-xs font-bold">
            ⚠ スタッフ入替の選択が完了していません。入替先を選ぶか、転向を取消してから確定してください。
          </p>
        </div>
      )}

      {/* 操作ボタン */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => setReviewing(true)}
          disabled={replaceStaffFor !== null}
          className={`px-5 py-2 rounded font-bold text-sm ${
            !isClub && budgetBalance < 0 ? 'btn-danger' : 'btn-primary'
          }`}
        >
          {!isClub && budgetBalance < 0 ? '赤字のまま確定' : '契約更改を確定'}
        </button>
        {/* 人数の内訳は色で区別するのでカードに載せる（地色の上では意味色が消える。index.css の文字色の決まり） */}
        <div className="text-xs text-gray-300 space-x-3 bg-surface-2 rounded-lg px-3 py-1.5">
          <span className="text-green-400">契約{contractCount}名</span>
          {releaseCount > 0 && <span className="text-red-400">解雇{releaseCount}名</span>}
          {retireCount > 0 && <span className="text-yellow-400">引退{retireCount}名</span>}
          {Object.values(staffConversions).filter(Boolean).length > 0 && (
            <span className="text-cyan-400">スタッフ転向{Object.values(staffConversions).filter(Boolean).length}名</span>
          )}
          <span className="text-gray-400">→ 来季{contractCount}名</span>
        </div>
      </div>

      {reviewing && replaceStaffFor === null && (() => {
        const deficit = !isClub && budgetBalance < 0;
        const conversions = Object.values(staffConversions).filter(Boolean).length;
        return (
          <ConfirmBar
            title={deficit ? '赤字のまま、契約更改を確定しますか？' : '契約更改を確定しますか？'}
            detail={[
              `契約${contractCount}名`,
              releaseCount > 0 && `解雇${releaseCount}名`,
              retireCount > 0 && `引退${retireCount}名`,
              conversions > 0 && `スタッフ転向${conversions}名`,
            ].filter(Boolean).join('・') + ` → 来季${contractCount}名`}
            note={deficit
              ? `確定すると取り消せません。このままだと年度末（11/30）の決算で${Math.abs(budgetBalance).toLocaleString()}万円の赤字になり、注目度の低下などのペナルティが出ます。`
              : '確定すると取り消せません。'}
            confirmLabel={releaseCount > 0 ? '解雇して確定する' : '確定する'}
            confirmClass={releaseCount > 0 || deficit ? 'btn-danger' : 'btn-warn'}
            onConfirm={() => { setReviewing(false); handleConfirm(); }}
            onCancel={() => setReviewing(false)}
          />
        );
      })()}
    </div>
    </div>
  );
};

export default CorporateDepartureScreen;
