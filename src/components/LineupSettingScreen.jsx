import React, { useState, useEffect, useMemo, useRef } from 'react';
import { TEAMS_DATA, LEAGUE_SETTINGS } from '../teams-data.js';
import { POSITION_NAMES, getAbilityRank, getRankColor, FORM_SHORT } from '../utils/constants.js';
import { getPitchTypeName } from '../season/yearProgressionSystem.js';
import { CONDITION_LEVELS, CONDITION_COLORS, CONDITION_ICONS } from '../game/condition.js';
import { generateOptimalLineup, generatePitchingRotation } from '../game/lineupGenerator.js';
import { TabBar } from './GameUIComponents.jsx';
import { AbilityValue } from './AbilityValue.jsx';
import TutorialHint from './TutorialHint.jsx';
import { ScreenShell, ScreenHeader } from './GameUIComponents.jsx';
import { ensureTeamJerseyNumbers } from '../utils/jerseyNumbers.js';
import { surnameOf } from '../data/playerNames.js';
import { showMessage } from '../utils/gameDialog.js';

// 投球フォームの短縮ラベル（カードの省スペース表示用）
const throwsLabel = (player) => (player.physical?.throws === 'left' ? '左投' : '右投');
const formLabel = (player) => FORM_SHORT[player.pitching?.form] || '';

// ⚠ **オンライン版からも使う**（`src/online/OnlineLineup.jsx`）。
//    この部品は `team` を**プロップで受け取り、その場で書き換える**作りなので、
//    `TEAMS_DATA` の球団でなくても動く。オンライン側は view から組み立てた
//    複製を渡し、書き換えられた結果を読んでサーバーへ送る。
//    ⚠ ここで `TEAMS_DATA` を直に読まないこと（結合が戻る）。
// `canConvertPosition`: ポジション登録の変更を出すか。⚠ 一人用は既定の true のまま。
// オンラインはサーバーが登録変更を受け付けない（送る項目が無い）ので false で渡す。
// 出したままだと画面の上では変わって見え、保存すると黙って元に戻る
// `displayName`: 見出しに出す名前。省略時は teamName（一人用はこちら）。
// ⚠ teamName は名前による照合にも使うので、表示名で上書きしないこと
export const LineupSettingContent = ({ teamName, onBack, team, canConvertPosition = true, displayName }) => {
  const [tab, setTab] = useState('lineup');
  const [updateTrigger, setUpdateTrigger] = useState(0);
  const [selectedBattingOrder, setSelectedBattingOrder] = useState(null);
  const [benchSortKey, setBenchSortKey] = useState(null);
  const [benchSortAsc, setBenchSortAsc] = useState(false);
  const [selectedDefensePos, setSelectedDefensePos] = useState(null);
  const [swapSource, setSwapSource] = useState(null); // クリックで打順入れ替え用
  const [selectedBenchPlayer, setSelectedBenchPlayer] = useState(null); // 控え選手→スタメン入れ替え用
  const [posConvertPlayer, setPosConvertPlayer] = useState(null); // ポジション変更モーダル対象
  const [detailPlayer, setDetailPlayer] = useState(null); // 選手詳細モーダル対象
  const [benchFilter, setBenchFilter] = useState('all'); // ポジション別フィルタ
  const [benchCompact, setBenchCompact] = useState(true); // コンパクト表示
  const [compareIds, setCompareIds] = useState([]); // 選手比較用（最大3人）
  const [roleLegendOpen, setRoleLegendOpen] = useState(false); // ロール解説開閉
  // ドラッグ中の状態はrefで保持する（setStateするとインライン定義のカード/スロットが
  // 再マウントされ、ネイティブD&Dが中断されてしまうため）。ハイライトはDOM操作で行う。
  const draggedPitcherIdRef = useRef(null);
  // スタメンD&D: ドラッグ中の情報を保持（setStateするとインラインのスロット/行が
  // 再マウントされネイティブD&Dが中断されるため ref で保持）。{ kind:'bench'|'slot', playerId, order }
  const draggedLineupRef = useRef(null);
  const [tapSelectedPitcherId, setTapSelectedPitcherId] = useState(null); // 投手起用: タップ選択(タッチ用)
  const SLOT_OVER_CLASSES = ['ring-1', 'ring-blue-400/60', 'border-blue-400', 'bg-blue-900/20'];

  ensureTeamJerseyNumbers(team); // 背番号を（未設定なら）割り当て

  // 体力バーの色を値に応じて変える
  const getStaminaBarColor = (value) => {
    if (value >= 60) return 'bg-green-500';
    if (value >= 50) return 'bg-lime-500';
    if (value >= 40) return 'bg-yellow-400';
    if (value >= 30) return 'bg-orange-400';
    return 'bg-red-500';
  };

  const getVelocityRank = (velocity) => getAbilityRank(velocity, true);

  const getThrowsLabel = (throws) => throws === 'left' ? '左投' : '右投';
  const getBatsLabel = (bats) => bats === 'left' ? '左打' : bats === 'switch' ? '両打' : '右打';

  // メイン守備位置の右に適性80以上のサブポジションを色分け表示
  // 100=白, 90-99=黄, 80-89=オレンジ
  const getSubPositions = (player, mainPosition) => {
    if (!player?.positionFitness || mainPosition === 'pitcher') return [];
    const allPositions = ['catcher', 'first', 'second', 'short', 'third', 'left', 'center', 'right'];
    return allPositions
      .filter(pos => pos !== mainPosition && (player.positionFitness[pos] ?? 0) >= 80)
      .map(pos => {
        const fitness = player.positionFitness[pos] ?? 0;
        const color = fitness >= 100 ? 'text-white' : fitness >= 90 ? 'text-yellow-400' : 'text-orange-400';
        return { label: POSITION_NAMES[pos], color };
      });
  };

  const getFormLabel = (form) => {
    const forms = FORM_SHORT;
    return forms[form] || form;
  };

  if (!team.lineupSettings) {
    team.lineupSettings = {
      battingOrder: [],
      benchPlayers: [],
      substitutionRules: { pinchHitter: [], pinchRunner: [] }
    };
  }

  if (!team.pitchingRotation) {
    team.pitchingRotation = {
      starters: [],
      middleRelievers: [],
      closers: [],
      currentStarterIndex: 0
    };
  }

  const lineup = team.lineupSettings.battingOrder;

  const useDH = LEAGUE_SETTINGS.useDH;
  const maxFielderSlots = useDH ? 9 : 8;
  const activeFielderCount = lineup.filter(e => e.position !== 'pitcher' && e.battingOrder >= 1 && e.battingOrder <= maxFielderSlots).length;
  const pitcherEntry = lineup.find(e => e.position === 'pitcher' && e.battingOrder === 9);
  const rotationStarters = team.pitchingRotation?.starters || [];
  const nextStarterId = rotationStarters.length
    ? rotationStarters[(team.pitchingRotation.currentStarterIndex || 0) % rotationStarters.length]
    : pitcherEntry?.playerId;
  const nextStarter = team.players.find(p => p.id === nextStarterId && p.position === 'pitcher' && p.isActive !== false)
    || team.players.find(p => p.id === pitcherEntry?.playerId && p.position === 'pitcher' && p.isActive !== false);
  const activeStarterCount = activeFielderCount + (useDH ? 0 : Number(!!pitcherEntry && !!nextStarter));

  const { fielders, pitchers, lineupPlayerIds, benchPlayers } = useMemo(() => {
    // isActive=falseの選手（練習生）はスタメン・控えから除外。未設定は全員有効（大学モード以外）
    const isEligible = (p) => p.isActive !== false;
    const f = team.players.filter(p => p.position !== 'pitcher' && isEligible(p));
    const p = team.players.filter(p => p.position === 'pitcher' && isEligible(p));
    const lpIds = new Set(lineup.map(e => e.playerId));
    const maxSlot = useDH ? 9 : 8;
    const fieldIds = new Set(lineup.filter(e => e.battingOrder >= 1 && e.battingOrder <= maxSlot).map(e => e.playerId));
    const seen = new Set();
    const bench = team.players.filter(pl => {
      if (!isEligible(pl)) return false;
      if (lpIds.has(pl.id)) return false;
      if (seen.has(pl.id)) return false;
      seen.add(pl.id);
      return true;
    });
    return { fielders: f, pitchers: p, lineupPlayerIds: lpIds, benchPlayers: bench };
  }, [team.players, lineup, updateTrigger]);

  // 初期化：非DH制では投手枠がなければ9番に投手を自動設定
  useEffect(() => {
    if (!useDH) {
      const hasPitcherSlot = lineup.some(e => e.position === 'pitcher');
      if (!hasPitcherSlot && pitchers.length > 0) {
        const starterId = team.pitchingRotation?.starters?.[0] || pitchers[0].id;
        lineup.push({ playerId: starterId, position: 'pitcher', battingOrder: 9 });
        setUpdateTrigger(prev => prev + 1);
      }
    }
  }, []);

  const handleAddToLineup = (playerId) => {
    if (!selectedBattingOrder) {
      showMessage(`打順を選択してください（1-${maxFielderSlots}番の枠をクリック）`);
      return;
    }

    const player = team.players.find(p => p.id === playerId);
    const isPitcher = player.position === 'pitcher';

    const existingEntry = lineup.find(e => e.battingOrder === selectedBattingOrder);
    if (existingEntry?.position === 'pitcher') {
      // 投手枠に別の選手を入れる場合、投手として入れる
      if (existingEntry) {
        const idx = lineup.indexOf(existingEntry);
        lineup.splice(idx, 1);
      }
      lineup.push({ playerId, position: 'pitcher', battingOrder: selectedBattingOrder });
      lineup.sort((a, b) => a.battingOrder - b.battingOrder);
      setUpdateTrigger(prev => prev + 1);
      return;
    }

    if (existingEntry) {
      const idx = lineup.indexOf(existingEntry);
      lineup.splice(idx, 1);
    }
    const playerIndex = lineup.findIndex(entry => entry.playerId === playerId);
    if (playerIndex !== -1) lineup.splice(playerIndex, 1);

    // 投手が野手枠に入る場合、適正の高いポジションを選ぶ
    const fieldPositions = ['catcher', 'first', 'second', 'short', 'third', 'left', 'center', 'right'];
    let assignedPosition = isPitcher ? 'first' : player.position;
    if (isPitcher && player.positionFitness) {
      const usedPositions = lineup.filter(e => e.position !== 'pitcher').map(e => e.position);
      const availablePositions = fieldPositions.filter(pos => !usedPositions.includes(pos));
      if (availablePositions.length > 0) {
        availablePositions.sort((a, b) => (player.positionFitness[b] || 0) - (player.positionFitness[a] || 0));
        assignedPosition = availablePositions[0];
      } else if (useDH) {
        assignedPosition = 'dh';
      }
    } else {
      const existingPositionEntry = lineup.find(e => e.position === assignedPosition && e.position !== 'pitcher' && e.battingOrder !== selectedBattingOrder);
      if (existingPositionEntry) {
        const usedPositions = lineup.filter(e => e.position !== 'pitcher').map(e => e.position);
        const availablePositions = fieldPositions.filter(pos => !usedPositions.includes(pos));
        if (availablePositions.length > 0) {
          if (player.positionFitness) {
            availablePositions.sort((a, b) => (player.positionFitness[b] || 0) - (player.positionFitness[a] || 0));
          }
          assignedPosition = availablePositions[0];
        } else if (useDH && !usedPositions.includes('dh')) {
          assignedPosition = 'dh';
        }
      }
    }

    lineup.push({ playerId, position: assignedPosition, battingOrder: selectedBattingOrder });
    lineup.sort((a, b) => a.battingOrder - b.battingOrder);
    const nextOrder = selectedBattingOrder < maxFielderSlots ? selectedBattingOrder + 1 : 1;
    setSelectedBattingOrder(nextOrder);
    setUpdateTrigger(prev => prev + 1);
  };

  const handleChangePosition = (battingOrder, newPosition) => {
    const entry = lineup.find(e => e.battingOrder === battingOrder);
    if (!entry) return;
    // 投手枠（非DH制の9番投手）の場合は投手から変更不可
    if (!useDH) {
      const isPitcherSlot = entry.position === 'pitcher' && lineup.filter(e => e.position === 'pitcher').length === 1;
      if (isPitcherSlot && newPosition !== 'pitcher') {
        showMessage('投手枠は投手のまま維持する必要があります');
        return;
      }
    }
    const existingEntry = lineup.find(e => e.position === newPosition && e.battingOrder !== battingOrder);
    if (existingEntry) {
      const oldPosition = entry.position;
      existingEntry.position = oldPosition;
      entry.position = newPosition;
    } else {
      entry.position = newPosition;
    }
    setUpdateTrigger(prev => prev + 1);
  };

  const handleSwapBattingOrder = (order1, order2) => {
    const entry1 = lineup.find(e => e.battingOrder === order1);
    const entry2 = lineup.find(e => e.battingOrder === order2);
    if (entry1 && entry2) {
      entry1.battingOrder = order2;
      entry2.battingOrder = order1;
      lineup.sort((a, b) => a.battingOrder - b.battingOrder);
      setUpdateTrigger(prev => prev + 1);
    }
  };

  // ---- スタメン設定 ドラッグ&ドロップ ----
  // 控え選手を指定打順の枠へ配置（既存選手は控えへ戻る）。クリック操作と同じ挙動。
  const assignBenchToSlot = (benchPlayerId, order) => {
    if (order < 1 || order > maxFielderSlots) return;
    const bp = team.players.find(p => p.id === benchPlayerId);
    if (!bp) return;
    // 既に他枠にいる選手なら一旦除去（重複防止）
    const dupIdx = lineup.findIndex(e => e.playerId === benchPlayerId);
    if (dupIdx !== -1) lineup.splice(dupIdx, 1);
    const entry = lineup.find(e => e.battingOrder === order);
    if (entry) {
      if (entry.position === 'pitcher') return; // 投手枠には野手を入れない
      entry.playerId = benchPlayerId;
    } else {
      const pos = bp.position === 'pitcher' ? 'first' : (bp.position || 'first');
      lineup.push({ playerId: benchPlayerId, position: pos, battingOrder: order });
      lineup.sort((a, b) => a.battingOrder - b.battingOrder);
    }
    setSelectedBenchPlayer(null);
    setSwapSource(null);
    setSelectedBattingOrder(null);
    setUpdateTrigger(prev => prev + 1);
  };

  // 打順枠どうしのドラッグ: 相手がいれば入れ替え、空きならその打順へ移動。
  const moveSlotToOrder = (sourceOrder, targetOrder) => {
    if (sourceOrder === targetOrder) return;
    const src = lineup.find(e => e.battingOrder === sourceOrder);
    if (!src) return;
    const tgt = lineup.find(e => e.battingOrder === targetOrder);
    if (tgt) {
      src.battingOrder = targetOrder;
      tgt.battingOrder = sourceOrder;
    } else {
      if (targetOrder < 1 || targetOrder > maxFielderSlots) return;
      src.battingOrder = targetOrder;
    }
    lineup.sort((a, b) => a.battingOrder - b.battingOrder);
    setUpdateTrigger(prev => prev + 1);
  };

  // 打順枠へのドロップ処理（控えから配置 / 枠どうしの入れ替え）
  const handleDropToSlot = (order) => {
    const d = draggedLineupRef.current;
    draggedLineupRef.current = null;
    if (!d) return;
    if (d.kind === 'bench') assignBenchToSlot(d.playerId, order);
    else if (d.kind === 'slot') moveSlotToOrder(d.order, order);
  };

  // 控えエリアへのドロップ処理（スタメンから外す）
  const handleDropToBench = () => {
    const d = draggedLineupRef.current;
    draggedLineupRef.current = null;
    if (d && d.kind === 'slot' && d.playerId) handleRemoveFromLineup(d.playerId);
  };

  const handleRemoveFromLineup = (playerId) => {
    const entry = lineup.find(e => e.playerId === playerId);
    if (entry?.position === 'pitcher') {
      // 投手枠は削除せず、次のローテーション投手と自動交換
      const lineupPlayerIds = new Set(lineup.map(e => e.playerId));
      const rotation = team.pitchingRotation;
      const rotationPitchers = [...(rotation?.starters || []), ...(rotation?.relievers || [])];
      const replacement = rotationPitchers.find(pid => pid !== playerId && !lineupPlayerIds.has(pid))
        || team.players.find(p => p.position === 'pitcher' && p.id !== playerId && !lineupPlayerIds.has(p.id))?.id;
      if (replacement) {
        entry.playerId = replacement;
        setUpdateTrigger(prev => prev + 1);
      } else {
        showMessage('交換できる投手がベンチにいません');
      }
      return;
    }
    // splice で配列を直接変更（filter で新配列を作ると lineup 参照がずれてバグの原因になる）
    const idx = lineup.findIndex(e => e.playerId === playerId);
    if (idx !== -1) {
      lineup.splice(idx, 1);
    }
    setUpdateTrigger(prev => prev + 1);
  };

  const handleAddToRotation = (playerId, role) => {
    const rotation = team.pitchingRotation;
    if (role === 'starter') {
      if (!rotation.starters.includes(playerId)) rotation.starters.push(playerId);
    } else if (role === 'middle') {
      if (!rotation.middleRelievers) rotation.middleRelievers = [];
      if (!rotation.middleRelievers.includes(playerId)) rotation.middleRelievers.push(playerId);
    } else if (role === 'setup') {
      if (!rotation.setupMen) rotation.setupMen = [];
      if (!rotation.setupMen.includes(playerId)) rotation.setupMen.push(playerId);
    } else if (role === 'closer') {
      rotation.closer = playerId;
    }
    setUpdateTrigger(prev => prev + 1);
  };

  const handleRemoveFromRotation = (playerId, role) => {
    const rotation = team.pitchingRotation;
    if (role === 'starter') {
      rotation.starters = rotation.starters.filter(id => id !== playerId);
    } else if (role === 'middle') {
      rotation.middleRelievers = (rotation.middleRelievers || []).filter(id => id !== playerId);
    } else if (role === 'setup') {
      rotation.setupMen = (rotation.setupMen || []).filter(id => id !== playerId);
    } else if (role === 'closer') {
      if (rotation.closer === playerId) rotation.closer = null;
    }
    setUpdateTrigger(prev => prev + 1);
  };

  const handleChangePitcher = (newPitcherId) => {
    const pitcherEntry = lineup.find(e => e.position === 'pitcher');
    if (pitcherEntry) {
      pitcherEntry.playerId = newPitcherId;
    }
    setUpdateTrigger(prev => prev + 1);
  };

  // 投手起用法を設定（先発/リリーフの詳細ロール）
  const handleSetPitcherRole = (playerId, newRole) => {
    const rotation = team.pitchingRotation;
    if (!rotation.pitcherRoles) rotation.pitcherRoles = {};

    const wasStarter = (rotation.starters || []).includes(playerId);
    const isNewStarter = ['complete', 'short', 'quality', 'ace', 'opener', 'auto_s'].includes(newRole);

    // 先発→先発の変更時はstarters配列を触らない（順番維持）
    if (!(wasStarter && isNewStarter)) {
      rotation.starters = (rotation.starters || []).filter(id => id !== playerId);
    }
    rotation.middleRelievers = (rotation.middleRelievers || []).filter(id => id !== playerId);
    rotation.setupMen = (rotation.setupMen || []).filter(id => id !== playerId);
    if (rotation.closer === playerId) rotation.closer = null;

    if (newRole === 'none') {
      delete rotation.pitcherRoles[playerId];
    } else {
      rotation.pitcherRoles[playerId] = newRole;
      // レガシー配列にも反映（先発→先発は既に配列内なのでスキップ）
      if (isNewStarter) {
        if (!wasStarter) rotation.starters.push(playerId);
      } else if (['long', 'onepoint', 'ace_relief', 'mopup', 'behind', 'auto_r'].includes(newRole)) {
        if (!rotation.middleRelievers) rotation.middleRelievers = [];
        rotation.middleRelievers.push(playerId);
      } else if (newRole === 'setup') {
        if (!rotation.setupMen) rotation.setupMen = [];
        rotation.setupMen.push(playerId);
      } else if (newRole === 'closer') {
        rotation.closer = playerId;
      }
    }
    setUpdateTrigger(prev => prev + 1);
  };

  // 投手起用D&D: 選手を役割スロットにドロップしたときの割り当て
  const handleDropToRole = (playerId, roleKey) => {
    const player = team.players.find(p => p.id === playerId);
    if (!player) return;
    // 野手を投手枠にドロップしたら投手へコンバートしてから役割付与
    if (player.position !== 'pitcher') {
      handleConvertPosition(playerId, 'pitcher');
    }
    handleSetPitcherRole(playerId, roleKey);
    setTapSelectedPitcherId(null);
  };

  const handleConvertPosition = (playerId, newPosition) => {
    const player = team.players.find(p => p.id === playerId);
    if (!player) return;
    const oldPos = player.position;
    player.position = newPosition;
    if (oldPos === 'pitcher' && newPosition !== 'pitcher') {
      handleSetPitcherRole(playerId, 'none');
      // ラインナップの投手スロットを後任投手に差し替え
      const pitcherEntry = lineup.find(e => e.playerId === playerId && e.position === 'pitcher');
      if (pitcherEntry) {
        const lineupIds = new Set(lineup.map(e => e.playerId));
        const rotation = team.pitchingRotation;
        const candidates = [
          ...(rotation?.starters || []),
          ...(rotation?.middleRelievers || []),
          ...(rotation?.setupMen || []),
          rotation?.closer,
        ].filter(Boolean);
        const replacement = candidates.find(pid => pid !== playerId && !lineupIds.has(pid))
          || team.players.find(p => p.position === 'pitcher' && p.id !== playerId && !lineupIds.has(p.id))?.id;
        if (replacement) {
          pitcherEntry.playerId = replacement;
        } else {
          const idx = lineup.findIndex(e => e.playerId === playerId && e.position === 'pitcher');
          if (idx !== -1) lineup.splice(idx, 1);
        }
      }
      // 投手にpositionFitnessがなければ初期値を設定
      if (!player.positionFitness) {
        player.positionFitness = { catcher: 50, first: 50, second: 50, short: 50, third: 50, left: 60, center: 60, right: 60 };
      }
    }
    setUpdateTrigger(prev => prev + 1);
  };

  const POS_OPTIONS = [
    { key: 'pitcher', label: '投手', icon: '⚾' },
    { key: 'catcher', label: '捕手', icon: '🧤' },
    { key: 'first', label: '一塁手', icon: '1B' },
    { key: 'second', label: '二塁手', icon: '2B' },
    { key: 'short', label: '遊撃手', icon: 'SS' },
    { key: 'third', label: '三塁手', icon: '3B' },
    { key: 'left', label: '左翼手', icon: 'LF' },
    { key: 'center', label: '中堅手', icon: 'CF' },
    { key: 'right', label: '右翼手', icon: 'RF' },
  ];

  // ========== 全選手共通プロフィールモーダル ==========
  const PlayerDetailModal = ({ player, onClose }) => {
    if (!player) return null;
    const isPitcher = player.position === 'pitcher';
    const p = player.pitching || {};
    const b = player.batting || {};
    const ph = player.physical || {};
    const f = player.fielding || {};
    const ps = player.seasonStats?.pitching;
    const bs = player.seasonStats?.batting;
    const cs = player.careerStats?.pitching;
    const cbs = player.careerStats?.batting;
    const arsenal = (p.arsenal || []).filter(a => a.type !== 'straight');

    const era = ps?.inningsPitched > 0 ? ((ps.earnedRuns || 0) / (ps.inningsPitched / 3) * 9).toFixed(2) : '-';
    const whip = ps?.inningsPitched > 0 ? (((ps.walks || 0) + (ps.hits || 0)) / (ps.inningsPitched / 3)).toFixed(2) : '-';
    const ip = ps?.inningsPitched ? (ps.inningsPitched / 3).toFixed(1) : '0.0';
    const avg = bs?.atBats > 0 ? (bs.hits / bs.atBats).toFixed(3) : '-';
    const obp = bs?.atBats > 0 ? ((bs.hits + (bs.walks || 0) + (bs.hitByPitch || 0)) / (bs.atBats + (bs.walks || 0) + (bs.hitByPitch || 0))).toFixed(3) : '-';

    const StatBox = ({ label, value, isVelocity, isStamina, highlight }) => {
      const rank = isVelocity ? getVelocityRank(value) : getAbilityRank(value, false, isStamina);
      return (
        <div className={`text-center px-1 py-1 rounded ${highlight ? 'bg-gray-600/40' : ''}`}>
          <div className="text-xs text-gray-400">{label}</div>
          <div className={`text-sm font-bold ${getRankColor(rank)}`}>{value}</div>
        </div>
      );
    };

    const allFieldPositions = ['catcher', 'first', 'second', 'short', 'third', 'left', 'center', 'right'];
    const subPositions = !isPitcher && player.positionFitness
      ? allFieldPositions.filter(pos => (player.positionFitness[pos] ?? 0) >= 50).map(pos => ({
          pos, label: POSITION_NAMES[pos],
          fitness: player.positionFitness[pos] ?? 0,
          isCurrent: pos === player.position,
        })).sort((a, b) => b.fitness - a.fitness)
      : [];

    const rotation = team.pitchingRotation || {};
    const role = isPitcher ? getPitcherRole(player.id) : null;
    const roleInfo = role && role !== 'none' ? PITCHER_ROLES[role] : null;

    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-surface-2 rounded-xl shadow-2xl border border-gray-700 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          {/* ヘッダー */}
          <div className="border-b border-gray-700 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {player.number != null && player.number <= 99 && <span className="text-gray-300 font-bold tabular-nums">#{player.number}</span>}
                <span className="text-white font-black text-lg">{player.name}</span>
                <span className={`text-sm ${CONDITION_COLORS[player.condition ?? CONDITION_LEVELS.NORMAL]}`}>
                  {CONDITION_ICONS[player.condition ?? CONDITION_LEVELS.NORMAL]}
                </span>
                {roleInfo && (
                  <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${roleInfo.color} ${roleInfo.textColor}`}>
                    {roleInfo.label}
                  </span>
                )}
              </div>
              <button onClick={onClose} className="text-gray-300 hover:text-white text-xl px-2">✕</button>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-300">
              <span>{player.age}歳</span>
              <span>{getThrowsLabel(ph.throws)}{getBatsLabel(b.bats || ph.bats)}</span>
              {isPitcher && p.form && <span>{getFormLabel(p.form)}</span>}
              <span className="font-medium text-gray-300">{POSITION_NAMES[player.position]}</span>
              {canConvertPosition && <button
                onClick={() => { onClose(); setPosConvertPlayer(player); }}
                className="px-1.5 py-0.5 text-xs font-bold rounded bg-gray-700 hover:bg-gray-600 border border-gray-600 hover:border-blue-500 text-gray-300 hover:text-blue-300 transition"
              >変更</button>}
              <div className="flex items-center gap-1 ml-auto">
                <span className="text-xs">疲労</span>
                <div className="w-12 h-1.5 bg-gray-600 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${player.fatigue >= 50 ? 'bg-red-500' : player.fatigue >= 30 ? 'bg-orange-400' : 'bg-green-500'}`}
                    style={{ width: `${Math.min(100, player.fatigue || 0)}%` }}></div>
                </div>
                <span className="text-xs">{player.fatigue || 0}</span>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-3">
            {/* 全国大会成績（🏆）*/}
            {(player.careerHistory || []).some(h => h.type === 'achievement') && (
              <div className="flex flex-wrap gap-1">
                {(player.careerHistory || []).filter(h => h.type === 'achievement').map((a, i) => (
                  <span key={i} className={`text-xs rounded px-1.5 py-0.5 ${a.result === '優勝' ? 'bg-yellow-900/50 text-yellow-200 border border-yellow-700/50' : 'bg-surface-2 text-gray-300 border border-gray-600/50'}`}>
                    🏆 {a.grade ? `${a.grade}年時 ` : ''}{a.tournament}{a.result}
                  </span>
                ))}
              </div>
            )}
            {/* 投手能力 */}
            {isPitcher && (
              <div>
                <h4 className="text-blue-400 text-xs font-bold uppercase tracking-wider mb-1.5">投手能力</h4>
                <div className="grid grid-cols-6 gap-1 bg-gray-700/40 rounded-lg p-2">
                  <StatBox label="球速" value={p.velocity || 0} isVelocity highlight />
                  <StatBox label="制球" value={p.control || 0} highlight />
                  <StatBox label="スタミナ" value={p.stamina || 0} isStamina />
                  <StatBox label="肩力" value={ph.arm || 0} />
                  <StatBox label="守備" value={f.defense || 0} />
                  <StatBox label="走力" value={ph.speed || 0} />
                </div>
              </div>
            )}

            {/* 変化球。クリックで封印/解禁を切り替える。
                封印した球は**試合で投げないだけ**で練習・成長は続く。
                習熟度の低い球は「防御率はほぼ変わらず四球だけ増える」ので、
                Lv20〜30 まで磨いてから解禁するのが実際に得になる */}
            {isPitcher && (p.arsenal || []).length > 0 && (
              <div>
                <h4 className="text-green-400 text-xs font-bold uppercase tracking-wider mb-1.5">
                  変化球 <span className="text-gray-300 normal-case font-normal tracking-normal">
                    — クリックで封印／解禁（封印した球は試合で投げません）
                  </span>
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {(p.arsenal || []).map((a, i) => {
                    const rank = getAbilityRank(a.level || 0);
                    const sealed = !!a.sealed;
                    // 全部は封印できない（投げる球が無くなるため）
                    const canSeal = sealed || (p.arsenal || []).filter(x => !x.sealed).length > 1;
                    return (
                      <button key={i} type="button" disabled={!canSeal}
                        title={sealed ? '封印中：試合では投げません。クリックで解禁'
                          : canSeal ? '試合で投げています。クリックで封印'
                          : '最後の1球は封印できません'}
                        onClick={() => {
                          if (!canSeal) return;
                          a.sealed = !sealed;
                          setUpdateTrigger(prev => prev + 1);
                        }}
                        className={`px-2 py-0.5 rounded text-xs font-semibold transition ${
                          sealed ? 'bg-surface-2 text-gray-400 line-through ring-1 ring-gray-600'
                            : `bg-gray-700/60 ${getRankColor(rank)} hover:bg-gray-600`
                        } ${canSeal ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                        {sealed && '🔒'}{getPitchTypeName(a.type)} <span className="text-xs opacity-70">Lv{a.level}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 打撃・走塁能力 */}
            <div>
              <h4 className="text-orange-400 text-xs font-bold uppercase tracking-wider mb-1.5">
                {isPitcher ? '打撃能力' : '野手能力'}
              </h4>
              <div className={`grid ${isPitcher ? 'grid-cols-6' : 'grid-cols-5'} gap-1 bg-gray-700/40 rounded-lg p-2`}>
                <StatBox label="ミート" value={b.meet || 0} highlight={!isPitcher} />
                <StatBox label="パワー" value={b.power || 0} highlight={!isPitcher} />
                <StatBox label="選球眼" value={b.eye || 0} />
                {!isPitcher && <StatBox label="盗塁" value={b.steal || 0} />}
                {!isPitcher && <StatBox label="バント" value={b.bunt || 0} />}
                {isPitcher && <StatBox label="走力" value={ph.speed || 0} />}
                {isPitcher && <StatBox label="盗塁" value={b.steal || 0} />}
                {isPitcher && <StatBox label="バント" value={b.bunt || 0} />}
              </div>
            </div>

            {/* フィジカル能力（野手のみ） */}
            {!isPitcher && (
              <div>
                <h4 className="text-cyan-400 text-xs font-bold uppercase tracking-wider mb-1.5">フィジカル</h4>
                <div className="grid grid-cols-6 gap-1 bg-gray-700/40 rounded-lg p-2">
                  <StatBox label="走力" value={ph.speed || 0} highlight />
                  <StatBox label="肩力" value={ph.arm || 0} highlight />
                  <StatBox label="守備" value={f.defense || 0} highlight />
                  <StatBox label="器用さ" value={ph.dexterity || 50} />
                  <StatBox label="体力" value={ph.bodyStamina || 50} />
                  <StatBox label="回復" value={ph.recovery || 50} />
                </div>
              </div>
            )}

            {/* 内面（性格・成長） */}
            <div>
              <h4 className="text-purple-400 text-xs font-bold uppercase tracking-wider mb-1.5">内面</h4>
              <div className="grid grid-cols-4 gap-1 bg-gray-700/40 rounded-lg p-2">
                <StatBox label="成長率" value={player.growthPotential ? `×${player.growthPotential.toFixed(2)}` : '-'} />
                <StatBox label="プロ意識" value={player.personality?.discipline ?? 0} />
                <StatBox label="精神力" value={player.personality?.mental ?? 0} />
                {player.position === 'catcher' && <StatBox label="Cリード" value={player.catching?.lead ?? 0} />}
                {player.position !== 'catcher' && <StatBox label="経験" value={player.experience || 0} />}
              </div>
            </div>

            {/* サブポジション適性（野手のみ） */}
            {subPositions.length > 0 && (
              <div>
                <h4 className="text-yellow-400 text-xs font-bold uppercase tracking-wider mb-1.5">ポジション適性</h4>
                <div className="flex flex-wrap gap-1.5">
                  {subPositions.map(sp => {
                    const color = sp.isCurrent ? 'bg-blue-600/50 text-blue-200 border-blue-500/50'
                      : sp.fitness >= 100 ? 'bg-gray-700/60 text-white border-gray-500/50'
                      : sp.fitness >= 80 ? 'bg-gray-700/60 text-yellow-400 border-yellow-700/50'
                      : sp.fitness >= 60 ? 'bg-gray-700/60 text-orange-400 border-orange-700/50'
                      : 'bg-gray-700/60 text-red-400 border-red-700/50';
                    return (
                      <span key={sp.pos} className={`px-2 py-1 rounded border text-xs font-semibold ${color}`}>
                        {sp.label} <span className="text-xs opacity-70">{sp.fitness}</span>
                        {sp.isCurrent && <span className="ml-0.5 text-xs">*</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* シーズン成績 */}
            {isPitcher && ps?.games > 0 && (
              <div>
                <h4 className="text-yellow-400 text-xs font-bold uppercase tracking-wider mb-1.5">シーズン投手成績</h4>
                <div className="bg-gray-700/40 rounded-lg p-2">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="text-white font-bold">{ps.wins||0}勝{ps.losses||0}敗</span>
                    {ps.saves > 0 && <span className="text-white">{ps.saves}S</span>}
                    {ps.holds > 0 && <span className="text-white">{ps.holds}H</span>}
                    <span className="text-orange-300">防御率 {era}</span>
                    <span className="text-gray-300">{ip}回</span>
                    <span className="text-gray-300">WHIP {whip}</span>
                    <span className="text-gray-300">{ps.strikeouts||0}K</span>
                    <span className="text-gray-300">{ps.games}試合</span>
                  </div>
                </div>
              </div>
            )}
            {bs?.atBats > 0 && (
              <div>
                <h4 className="text-yellow-400 text-xs font-bold uppercase tracking-wider mb-1.5">シーズン打撃成績</h4>
                <div className="bg-gray-700/40 rounded-lg p-2">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="text-blue-300 font-bold">打率 {avg}</span>
                    <span className="text-gray-300">出塁率 {obp}</span>
                    <span className="text-gray-300">{bs.atBats}打数 {bs.hits}安打</span>
                    {(bs.homeruns || 0) > 0 && <span className="text-gray-300">{bs.homeruns}本塁打</span>}
                    {(bs.rbis || 0) > 0 && <span className="text-gray-300">{bs.rbis}打点</span>}
                    {(bs.stolenBases || 0) > 0 && <span className="text-gray-300">{bs.stolenBases}盗塁</span>}
                    <span className="text-gray-300">{bs.games || 0}試合</span>
                  </div>
                </div>
              </div>
            )}

            {/* 通算成績 */}
            {(cs?.games > 0 || cbs?.atBats > 0) && (
              <div>
                <h4 className="text-gray-300 text-xs font-bold uppercase tracking-wider mb-1.5">通算成績</h4>
                <div className="flex flex-wrap gap-x-4 text-xs text-gray-300 bg-gray-700/30 rounded-lg px-2 py-1.5">
                  {cs?.games > 0 && <>
                    <span>{cs.wins||0}勝{cs.losses||0}敗</span>
                    {cs.saves > 0 && <span>{cs.saves}S</span>}
                    <span>防{((cs.earnedRuns||0)+((ps?.earnedRuns||0))) > 0 && ((cs.inningsPitched||0)+(ps?.inningsPitched||0)) > 0 ? (((cs.earnedRuns||0)+(ps?.earnedRuns||0)) / (((cs.inningsPitched||0)+(ps?.inningsPitched||0)) / 3) * 9).toFixed(2) : '-'}</span>
                    <span>{(cs.games||0)+(ps?.games||0)}試合</span>
                  </>}
                  {cbs?.atBats > 0 && <>
                    <span>打率{((cbs.hits||0)+(bs?.hits||0)) > 0 ? (((cbs.hits||0)+(bs?.hits||0)) / ((cbs.atBats||0)+(bs?.atBats||0))).toFixed(3) : '-'}</span>
                    <span>{(cbs.homeruns||0)+(bs?.homeruns||0)}本</span>
                    <span>{(cbs.games||0)+(bs?.games||0)}試合</span>
                  </>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ========== 選手比較モーダル ==========
  const CompareModal = ({ playerIds, onClose }) => {
    const players = playerIds.map(id => team.players.find(p => p.id === id)).filter(Boolean);
    if (players.length < 2) return null;

    const StatRow = ({ label, getValue, isVelocity }) => {
      const values = players.map(pl => getValue(pl));
      const maxVal = Math.max(...values.filter(v => typeof v === 'number'));
      return (
        <tr className="border-b border-gray-700/20">
          <td className="py-1 px-2 text-xs text-gray-300 whitespace-nowrap">{label}</td>
          {values.map((val, i) => {
            const rank = isVelocity ? getVelocityRank(val) : getAbilityRank(val);
            const isBest = typeof val === 'number' && val === maxVal && values.filter(v => v === maxVal).length === 1;
            return (
              <td key={i} className={`py-1 px-2 text-center text-sm font-bold ${getRankColor(rank)} ${isBest ? 'bg-green-900/20' : ''}`}>
                {val}
              </td>
            );
          })}
        </tr>
      );
    };

    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-surface-2 rounded-xl shadow-2xl border border-gray-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="border-b border-gray-700 px-4 py-3 flex items-center justify-between">
            <h3 className="text-white font-bold">選手比較</h3>
            <button onClick={onClose} className="text-gray-300 hover:text-white text-xl px-2">✕</button>
          </div>
          <div className="p-4">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="py-2 px-2 text-xs text-gray-400">能力</th>
                  {players.map(pl => (
                    <th key={pl.id} className="py-2 px-2 text-center">
                      <div className="text-white font-bold text-sm">{pl.name}</div>
                      <div className="text-xs text-gray-300">
                        {pl.age}歳 {POSITION_NAMES[pl.position]}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr><td colSpan={players.length + 1} className="py-1 px-2 text-xs text-orange-400 font-bold bg-gray-700/30">打撃</td></tr>
                <StatRow label="ミート" getValue={pl => pl.batting?.meet || 0} />
                <StatRow label="パワー" getValue={pl => pl.batting?.power || 0} />
                <StatRow label="選球眼" getValue={pl => pl.batting?.eye || 0} />
                <StatRow label="盗塁" getValue={pl => pl.batting?.steal || 0} />
                <StatRow label="バント" getValue={pl => pl.batting?.bunt || 0} />
                <tr><td colSpan={players.length + 1} className="py-1 px-2 text-xs text-cyan-400 font-bold bg-gray-700/30">フィジカル</td></tr>
                <StatRow label="走力" getValue={pl => pl.physical?.speed || 0} />
                <StatRow label="肩力" getValue={pl => pl.physical?.arm || 0} />
                <StatRow label="守備" getValue={pl => pl.fielding?.defense || 0} />
                <StatRow label="体力" getValue={pl => pl.physical?.bodyStamina || 50} />
                <StatRow label="回復" getValue={pl => pl.physical?.recovery || 50} />
                {players.some(pl => pl.position === 'pitcher') && <>
                  <tr><td colSpan={players.length + 1} className="py-1 px-2 text-xs text-blue-400 font-bold bg-gray-700/30">投手</td></tr>
                  <StatRow label="球速" getValue={pl => pl.pitching?.velocity || 0} isVelocity />
                  <StatRow label="制球" getValue={pl => pl.pitching?.control || 0} />
                  <StatRow label="スタミナ" getValue={pl => pl.pitching?.stamina || 0} />
                </>}
                <tr><td colSpan={players.length + 1} className="py-1 px-2 text-xs text-purple-400 font-bold bg-gray-700/30">内面</td></tr>
                <StatRow label="成長率" getValue={pl => pl.growthPotential ? parseFloat(pl.growthPotential.toFixed(2)) : 0} />
                <StatRow label="プロ意識" getValue={pl => pl.personality?.discipline ?? 0} />
                <StatRow label="精神力" getValue={pl => pl.personality?.mental ?? 0} />
                <StatRow label="経験" getValue={pl => pl.experience || 0} />
                <tr><td colSpan={players.length + 1} className="py-1 px-2 text-xs text-yellow-400 font-bold bg-gray-700/30">シーズン成績</td></tr>
                <StatRow label="打率" getValue={pl => {
                  const bs2 = pl.seasonStats?.batting;
                  return bs2?.atBats > 0 ? parseFloat((bs2.hits / bs2.atBats).toFixed(3)) : 0;
                }} />
                <StatRow label="本塁打" getValue={pl => pl.seasonStats?.batting?.homeruns || 0} />
                <StatRow label="打点" getValue={pl => pl.seasonStats?.batting?.rbis || 0} />
                {players.some(pl => pl.position === 'pitcher') && (
                  <StatRow label="防御率" getValue={pl => {
                    const ps2 = pl.seasonStats?.pitching;
                    return ps2?.inningsPitched > 0 ? parseFloat(((ps2.earnedRuns || 0) / (ps2.inningsPitched / 3) * 9).toFixed(2)) : 99.99;
                  }} />
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const PosConvertModal = ({ player, onClose }) => {
    if (!player) return null;
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-surface-2 rounded-xl shadow-2xl border border-gray-700 max-w-sm w-full" onClick={e => e.stopPropagation()}>
          <div className="border-b border-gray-700 px-4 py-3 rounded-t-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-white font-bold">{player.name}</h3>
                <p className="text-gray-300 text-xs">
                  現在: <span className="text-white font-medium">{POSITION_NAMES[player.position] || player.position}</span>
                </p>
              </div>
              <button onClick={onClose} className="text-gray-300 hover:text-white text-xl px-2">✕</button>
            </div>
          </div>
          <div className="p-4">
            <p className="text-gray-300 text-xs mb-3">変更先のポジションを選択してください</p>
            <div className="grid grid-cols-3 gap-2">
              {POS_OPTIONS.map(pos => {
                const isCurrent = player.position === pos.key;
                const hasFitness = player.positionFitness != null;
                const fitness = player.positionFitness?.[pos.key] ?? 0;
                const fitnessColor = fitness >= 80 ? 'text-green-400' : fitness >= 50 ? 'text-yellow-400' : 'text-red-400';
                return (
                  <button
                    key={pos.key}
                    onClick={() => {
                      if (!isCurrent) {
                        handleConvertPosition(player.id, pos.key);
                        onClose();
                      }
                    }}
                    disabled={isCurrent}
                    className={`flex flex-col items-center gap-0.5 px-2 py-2.5 rounded-lg border transition-all ${
                      isCurrent
                        ? 'bg-blue-600/30 border-blue-500/50 ring-1 ring-blue-400/30'
                        : 'bg-gray-700/50 border-gray-600/50 hover:bg-gray-600/70 hover:border-gray-500'
                    }`}
                  >
                    <span className="text-base">{pos.icon}</span>
                    <span className={`text-xs font-bold ${isCurrent ? 'text-blue-300' : 'text-white'}`}>{pos.label}</span>
                    {pos.key !== 'pitcher' && (
                      hasFitness
                        ? <span className={`text-xs ${fitnessColor}`}>適性{fitness}</span>
                        : <span className="text-xs text-gray-400">適性-</span>
                    )}
                    {isCurrent && <span className="text-xs text-blue-400">現在</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // 投手の現在のロールを取得
  const getPitcherRole = (playerId) => {
    const rotation = team.pitchingRotation;
    if (rotation.pitcherRoles?.[playerId]) return rotation.pitcherRoles[playerId];
    // レガシーデータからの逆引き
    if (rotation.starters?.includes(playerId)) return 'quality';
    if (rotation.middleRelievers?.includes(playerId)) return 'long';
    if (rotation.setupMen?.includes(playerId)) return 'setup';
    if (rotation.closer === playerId) return 'closer';
    return 'none';
  };

  // ロールのラベルと色
  const PITCHER_ROLES = {
    none:       { label: '未設定', color: 'bg-gray-600', textColor: 'text-gray-300', group: 'none' },
    auto_s:     { label: 'おまかせ', color: 'bg-gray-500', textColor: 'text-gray-200', group: 'starter' },
    ace:        { label: 'ゲームメーカー', color: 'bg-red-600', textColor: 'text-red-200', group: 'starter' },
    complete:   { label: '完投型', color: 'bg-blue-700', textColor: 'text-blue-300', group: 'starter' },
    short:      { label: 'ショート', color: 'bg-blue-600', textColor: 'text-blue-300', group: 'starter' },
    quality:    { label: '勝ち権利', color: 'bg-blue-500', textColor: 'text-blue-200', group: 'starter' },
    opener:     { label: 'オープナー', color: 'bg-teal-700', textColor: 'text-teal-300', group: 'starter' },
    auto_r:     { label: 'おまかせ', color: 'bg-gray-500', textColor: 'text-gray-200', group: 'relief' },
    long:       { label: 'ロング', color: 'bg-green-700', textColor: 'text-green-300', group: 'relief' },
    ace_relief: { label: '中継ぎエース', color: 'bg-green-500', textColor: 'text-green-200', group: 'relief' },
    mopup:      { label: '敗戦処理', color: 'bg-gray-700', textColor: 'text-gray-300', group: 'relief' },
    behind:     { label: 'ビハインド', color: 'bg-yellow-700', textColor: 'text-yellow-300', group: 'relief' },
    onepoint:   { label: 'ワンポイント', color: 'bg-green-600', textColor: 'text-green-300', group: 'relief' },
    setup:      { label: 'セットアップ', color: 'bg-orange-600', textColor: 'text-orange-300', group: 'relief' },
    closer:     { label: '守護神', color: 'bg-purple-600', textColor: 'text-purple-300', group: 'relief' },
  };

  // 控え選手のポジションソート順（捕一二三遊左中右投）。投手は最後。
  const BENCH_POSITION_ORDER = ['catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right', 'pitcher'];

  // 控え選手のソート用値を取得
  const getBenchSortValue = (player, key) => {
    switch (key) {
      case 'name': return player.name;
      case 'age': return player.age || 0;
      case 'position': { const i = BENCH_POSITION_ORDER.indexOf(player.position); return i >= 0 ? i : 99; }
      case 'meet': return player.batting?.meet || 0;
      case 'power': return player.batting?.power || 0;
      case 'speed': return player.physical?.speed || 0;
      case 'arm': return player.physical?.arm || 0;
      case 'defense': return player.fielding?.defense || 0;
      case 'bodyStamina': return player.physical?.bodyStamina || 50;
      case 'recovery': return player.physical?.recovery || 50;
      case 'fatigue': return player.fatigue || 0;
      case 'velocity': return player.pitching?.velocity || 0;
      case 'control': return player.pitching?.control || 0;
      case 'stamina': return player.pitching?.stamina || 0;
      default: return 0;
    }
  };

  const handleBenchSort = (key) => {
    if (benchSortKey === key) {
      setBenchSortAsc(!benchSortAsc);
    } else {
      setBenchSortKey(key);
      // 守備は昇順（捕→投）から、それ以外は降順から始める
      setBenchSortAsc(key === 'position');
    }
  };

  const filteredBenchPlayers = useMemo(() => {
    if (benchFilter === 'all') return benchPlayers;
    return benchPlayers.filter(p => {
      const pos = p.position;
      if (benchFilter === 'pitcher') return pos === 'pitcher';
      if (benchFilter === 'catcher') return pos === 'catcher';
      if (benchFilter === 'infield') return ['first', 'second', 'short', 'third'].includes(pos);
      if (benchFilter === 'outfield') return ['left', 'center', 'right'].includes(pos);
      return true;
    });
  }, [benchPlayers, benchFilter]);

  const sortedBenchPlayers = useMemo(() => {
    if (!benchSortKey) return filteredBenchPlayers;
    return [...filteredBenchPlayers].sort((a, b) => {
      const va = getBenchSortValue(a, benchSortKey);
      const vb = getBenchSortValue(b, benchSortKey);
      if (typeof va === 'string') return benchSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return benchSortAsc ? va - vb : vb - va;
    });
  }, [filteredBenchPlayers, benchSortKey, benchSortAsc, updateTrigger]);

  const toggleCompare = (playerId) => {
    setCompareIds(prev => prev.includes(playerId) ? prev.filter(id => id !== playerId) : prev.length >= 3 ? prev : [...prev, playerId]);
  };

  // 1行表示用の控え選手行コンポーネント
  const BenchPlayerRow = ({ player }) => {
    const isPitcher = player.position === 'pitcher';
    const isInLineup = lineupPlayerIds.has(player.id);
    const rotation = team.pitchingRotation || {};
    const isStarter = rotation.starters?.includes(player.id);
    const isMiddle = rotation.middleRelievers?.includes(player.id);
    const isSetup = rotation.setupMen?.includes(player.id);
    const isCloser = rotation.closer === player.id;
    const roleLabel = isStarter ? '先発' : isMiddle ? '中継' : isSetup ? 'SU' : isCloser ? '抑え' : '';
    const isComparing = compareIds.includes(player.id);

    const StatCell = ({ value, isVelocity, className = '' }) => {
      const rank = isVelocity ? getVelocityRank(value) : getAbilityRank(value);
      return <td className={`py-1.5 px-1 text-xs text-center font-semibold ${getRankColor(rank)} ${className}`}>{value}</td>;
    };

    const handleRowClick = () => {
      if (isInLineup) return;
      if (swapSource !== null) {
        const entry = lineup.find(e => e.battingOrder === swapSource);
        if (entry && entry.position !== 'pitcher') {
          entry.playerId = player.id;
          setSwapSource(null);
          setSelectedBenchPlayer(null);
          setUpdateTrigger(prev => prev + 1);
        }
        return;
      }
      if (selectedBattingOrder && selectedBattingOrder >= 1 && selectedBattingOrder <= maxFielderSlots) {
        const slotEntry = lineup.find(e => e.battingOrder === selectedBattingOrder);
        if (!slotEntry) {
          handleAddToLineup(player.id);
          return;
        }
      }
      setSelectedBenchPlayer(prev => prev === player.id ? null : player.id);
      setSwapSource(null);
      setSelectedBattingOrder(null);
    };

    return (
      <tr
        className={`border-b border-gray-700/30 cursor-pointer transition-colors ${
          isInLineup ? 'opacity-30 bg-gray-800/50' :
          isComparing ? 'bg-purple-900/20 ring-1 ring-purple-400/30' :
          selectedBenchPlayer === player.id ? 'bg-blue-900/40 ring-1 ring-blue-400/30' :
          swapSource !== null || selectedBenchPlayer !== null ? 'hover:bg-blue-900/30' :
          'hover:bg-gray-700/40 hover:cursor-grab'
        }`}
        draggable={!isInLineup}
        onDragStart={(e) => {
          if (isInLineup) return;
          draggedLineupRef.current = { kind: 'bench', playerId: player.id };
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', String(player.id)); } catch (_) {}
          e.currentTarget.classList.add('opacity-50');
        }}
        onDragEnd={(e) => { draggedLineupRef.current = null; e.currentTarget.classList.remove('opacity-50'); }}
        onClick={handleRowClick}
        onDoubleClick={(e) => { e.stopPropagation(); if (!isInLineup) setDetailPlayer(player); }}
      >
        {/* 比較チェック */}
        <td className="py-1.5 pl-1.5 pr-0 w-6" onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={isComparing} onChange={() => toggleCompare(player.id)}
            className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-purple-500 focus:ring-0 cursor-pointer" />
        </td>
        <td className="py-1.5 pl-1 pr-1 text-sm text-white font-semibold whitespace-nowrap">
          <button onClick={(e) => { e.stopPropagation(); setDetailPlayer(player); }}
            className="hover:text-blue-300 hover:underline transition text-left">
            {player.name}
          </button>
          <span className={`ml-1 text-xs ${CONDITION_COLORS[player.condition ?? CONDITION_LEVELS.NORMAL]}`}>
            {CONDITION_ICONS[player.condition ?? CONDITION_LEVELS.NORMAL]}
          </span>
          {isInLineup && <span className="ml-1 text-xs text-blue-400 bg-blue-900/30 px-1 py-0.5 rounded">出場中</span>}
        </td>
        <td className="py-1.5 px-1 text-xs text-gray-300 text-center">{player.age}</td>
        <td className="py-1.5 px-1 text-xs whitespace-nowrap">
          {canConvertPosition ? <button
            onClick={(e) => { e.stopPropagation(); setPosConvertPlayer(player); }}
            className={`${isPitcher ? 'text-indigo-300 font-medium' : 'text-gray-300'} hover:underline hover:brightness-125`}
            title="ポジション登録変更"
          >
            {POSITION_NAMES[player.position] || player.position}
          </button> : <span className={isPitcher ? 'text-indigo-300 font-medium' : 'text-gray-300'}>
            {POSITION_NAMES[player.position] || player.position}
          </span>}
          {!isPitcher && (() => {
            const subs = getSubPositions(player, player.position);
            if (subs.length === 0) return null;
            return subs.map((s, i) => <span key={i} className={`${s.color} ml-0.5 text-xs`}>{s.label}</span>);
          })()}
          {roleLabel && <span className="ml-1 text-xs text-yellow-400 bg-yellow-900/30 px-1 py-0.5 rounded">{roleLabel}</span>}
        </td>
        {/* コンパクト: 主要能力のみ */}
        {benchCompact ? (<>
          <StatCell value={player.batting?.meet || 0} className="border-l border-gray-700/40" />
          <StatCell value={player.batting?.power || 0} />
          <StatCell value={player.physical?.speed || 0} />
          <StatCell value={player.physical?.arm || 0} />
          <StatCell value={player.fielding?.defense || 0} />
          <td className="py-1.5 px-1 text-xs text-center border-l border-gray-700/40">
            {(() => {
              const f = player.fatigue || 0;
              const color = f >= 80 ? 'text-red-400' : f >= 50 ? 'text-orange-400' : f >= 20 ? 'text-yellow-400' : 'text-green-400';
              return <span className={`font-semibold ${color}`}>{f}</span>;
            })()}
          </td>
          <td className="py-1.5 px-2 text-xs text-center whitespace-nowrap border-l border-gray-700/40">
            {isPitcher ? (() => {
              const ps2 = player.seasonStats?.pitching;
              if (!ps2 || !ps2.games) return <span className="text-gray-400">-</span>;
              const era2 = ps2.inningsPitched > 0 ? ((ps2.earnedRuns || 0) / (ps2.inningsPitched / 3) * 9).toFixed(2) : '-';
              return <span className="text-gray-300">{ps2.wins||0}勝{ps2.losses||0}敗 <span className="text-orange-300">防{era2}</span></span>;
            })() : (() => {
              const bs2 = player.seasonStats?.batting;
              if (!bs2 || !bs2.atBats) return <span className="text-gray-400">-</span>;
              return <><span className="text-blue-300 font-semibold">{(bs2.hits / bs2.atBats).toFixed(3)}</span><span className="text-gray-300 ml-1">{bs2.homeruns||0}本</span></>;
            })()}
          </td>
        </>) : (<>
          {/* 詳細: 全列 */}
          <td className="py-1.5 px-1 text-xs text-gray-300 whitespace-nowrap">
            {getThrowsLabel(player.physical?.throws)}{getBatsLabel(player.batting?.bats || player.physical?.bats)}
          </td>
          <StatCell value={player.batting?.meet || 0} className="border-l border-gray-700/40" />
          <StatCell value={player.batting?.power || 0} />
          <StatCell value={player.physical?.speed || 0} />
          <StatCell value={player.physical?.arm || 0} />
          <StatCell value={player.fielding?.defense || 0} />
          <StatCell value={player.physical?.bodyStamina || 50} />
          <StatCell value={player.physical?.recovery || 50} />
          <td className="py-1.5 px-1 text-xs text-center border-l border-gray-700/40">
            {(() => {
              const f = player.fatigue || 0;
              const color = f >= 80 ? 'text-red-400' : f >= 50 ? 'text-orange-400' : f >= 20 ? 'text-yellow-400' : 'text-green-400';
              return <span className={`font-semibold ${color}`}>{f}</span>;
            })()}
          </td>
          <td className="py-1.5 px-2 text-xs text-center whitespace-nowrap border-l border-gray-700/40">
            {isPitcher ? (() => {
              const ps2 = player.seasonStats?.pitching;
              if (!ps2 || !ps2.games) return <span className="text-gray-400">-</span>;
              const era2 = ps2.inningsPitched > 0 ? ((ps2.earnedRuns || 0) / (ps2.inningsPitched / 3) * 9).toFixed(2) : '-';
              return <span className="text-gray-300">{ps2.wins||0}勝{ps2.losses||0}敗 <span className="text-orange-300">防{era2}</span></span>;
            })() : (() => {
              const bs2 = player.seasonStats?.batting;
              if (!bs2 || !bs2.atBats) return <span className="text-gray-400">-</span>;
              return <><span className="text-blue-300 font-semibold">{(bs2.hits / bs2.atBats).toFixed(3)}</span><span className="text-gray-400 ml-1">{bs2.homeruns||0}本</span></>;
            })()}
          </td>
        </>)}
      </tr>
    );
  };

  const SortHeader = ({ label, sortKey, className = '' }) => (
    <th
      className={`py-1 px-1 cursor-pointer hover:text-white transition select-none ${className}`}
      onClick={() => handleBenchSort(sortKey)}
    >
      {label}{benchSortKey === sortKey ? (benchSortAsc ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <ScreenShell>
        <ScreenHeader title="ロスター管理" sub={displayName || teamName}
          right={onBack && (
            <button onClick={onBack} className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium">← 戻る</button>
          )} />

        {/* タブナビゲーション */}
        <TabBar
          tabs={[
            { key: 'lineup',   label: 'スタメン設定', icon: '👥' },
            { key: 'rotation', label: '投手起用',     icon: '⚾' },
            { key: 'defense',  label: '守備分析',     icon: '🛡' },
          ]}
          activeKey={tab}
          onChange={(key) => { setTab(key); setTapSelectedPitcherId(null); setSwapSource(null); setSelectedBenchPlayer(null); }}
          className="mb-4"
        />

        {tab === 'lineup' && (
          <>
          <TutorialHint id="lineup-dnd" title="スタメンの組み方">
            右の控え選手を<b className="text-cyan-200">ドラッグ＆ドロップ</b>で打順枠へ入れられます。枠どうしをドラッグすれば打順を入れ替えられます。<b className="text-cyan-200">守備位置は選手名の横のメニュー</b>から変更でき、使用中の位置を選ぶと交換します。「自動」ボタンで最適オーダーも組めます。
          </TutorialHint>
          <TutorialHint id="lineup-playing-time" title="起用は育成でもある">
            <b className="text-cyan-200">試合に出た選手ほど伸びます。</b>1年フル出場した若手は、ほとんど出番の無かった選手の<b className="text-cyan-200">2倍以上</b>成長します（実測: 300打席で能力合計 +12.7 に対し、0打席では +5.8）。
            いま勝つために主力を並べるか、数年後のために若手を我慢して使うか——<b className="text-cyan-200">スタメンを決めることは育成方針を決めること</b>でもあります。
          </TutorialHint>
          <div className="grid grid-cols-12 gap-4">
            {/* 左側: スタメン (4/12) */}
            <div className="bg-surface-2 rounded-xl border border-gray-700/50 col-span-4 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700/50">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold text-white text-sm whitespace-nowrap">スタメン設定</h2>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${
                    activeStarterCount === 9
                      ? 'bg-green-900/60 text-green-400 border border-green-700/40'
                      : 'bg-gray-700 text-gray-300'
                  }`}>
                    {activeStarterCount}/9
                  </span>
                  <span className="text-xs text-gray-400 basis-full whitespace-nowrap">{useDH ? '野手9人・DH制' : `野手${activeFielderCount}人＋投手${pitcherEntry && nextStarter ? 1 : 0}人`}</span>
                  {(swapSource !== null || selectedBenchPlayer !== null) && (
                    <span className="text-blue-400 text-xs basis-full">→ 入替先を選択</span>
                  )}
                </div>
                <div className="flex gap-1 mt-2">
                  {[
                    { mode: 'standard', label: '標準' },
                    { mode: 'offense', label: '打撃重視' },
                    { mode: 'defense', label: '守備重視' },
                  ].map(({ mode, label }) => (
                    <button key={mode} onClick={() => {
                      generateOptimalLineup(teamName, mode, team);
                      setSwapSource(null);
                      setSelectedBenchPlayer(null);
                      setSelectedBattingOrder(null);
                      setUpdateTrigger(prev => prev + 1);
                    }} className="btn-secondary text-xs px-2 py-1 rounded font-medium transition">
                      自動: {label}
                    </button>
                  ))}
                </div>
                {!lineup.some(e => e.position === 'catcher') && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400 bg-red-950/40 border border-red-700/30 rounded px-2 py-1">
                    <span className="font-bold">!</span>
                    <span>捕手が未設定です。スタメンに捕手を入れてください。</span>
                  </div>
                )}
              </div>
              <div className="p-2 space-y-1">
                {(useDH ? [1,2,3,4,5,6,7,8,9] : [1,2,3,4,5,6,7,8,9]).map(order => {
                  const entry = lineup.find(e => e.battingOrder === order);
                  const player = entry ? team.players.find(p => p.id === entry.playerId) : null;
                  const isSelected = selectedBattingOrder === order;
                  const isPitcherSlot = !useDH && entry?.position === 'pitcher';
                  const isDHSlot = useDH && entry?.position === 'dh';
                  const isSwapSource = swapSource === order;
                  const isSwapTarget = swapSource !== null && swapSource !== order;

                  const isBenchTarget = selectedBenchPlayer !== null;

                  const handleSlotClick = () => {
                    if (selectedBenchPlayer !== null) {
                      // 控え選手が選択済み → このスタメン枠に入れる
                      if (entry && entry.position !== 'pitcher') {
                        entry.playerId = selectedBenchPlayer;
                        setSelectedBenchPlayer(null);
                        setUpdateTrigger(prev => prev + 1);
                      } else if (!entry && order <= maxFielderSlots) {
                        const bp = team.players.find(p => p.id === selectedBenchPlayer);
                        const pos = bp?.position === 'pitcher' ? 'first' : (bp?.position || 'first');
                        lineup.push({ playerId: selectedBenchPlayer, position: pos, battingOrder: order });
                        lineup.sort((a, b) => a.battingOrder - b.battingOrder);
                        setSelectedBenchPlayer(null);
                        setUpdateTrigger(prev => prev + 1);
                      }
                      return;
                    }
                    if (swapSource !== null) {
                      // 入れ替え実行
                      if (swapSource !== order) {
                        handleSwapBattingOrder(swapSource, order);
                      }
                      setSwapSource(null);
                    } else if (entry) {
                      // 選手がいる枠をタップ → 入れ替えソースにする
                      setSwapSource(order);
                      setSelectedBenchPlayer(null);
                      setSelectedBattingOrder(null);
                    } else {
                      // 空枠をタップ → 追加モード
                      setSelectedBattingOrder(order);
                      setSelectedBenchPlayer(null);
                    }
                  };

                  return (
                    <div
                      key={order}
                      onClick={handleSlotClick}
                      draggable={!!player}
                      onDragStart={(e) => {
                        if (!player) return;
                        draggedLineupRef.current = { kind: 'slot', order, playerId: entry?.playerId };
                        e.dataTransfer.effectAllowed = 'move';
                        try { e.dataTransfer.setData('text/plain', String(order)); } catch (_) {}
                        e.currentTarget.classList.add('opacity-40');
                      }}
                      onDragEnd={(e) => {
                        draggedLineupRef.current = null;
                        e.currentTarget.classList.remove('opacity-40');
                      }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add(...SLOT_OVER_CLASSES); }}
                      onDragLeave={(e) => { e.currentTarget.classList.remove(...SLOT_OVER_CLASSES); }}
                      onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove(...SLOT_OVER_CLASSES); handleDropToSlot(order); }}
                      className={`rounded-lg cursor-pointer transition-all border ${player ? 'cursor-grab active:cursor-grabbing' : ''} ${
                      isSwapSource ? 'bg-blue-900/50 border-blue-500/70 ring-1 ring-blue-400/30' :
                      isSwapTarget ? 'bg-surface-2 border-blue-400/30 hover:border-blue-400/60 hover:bg-blue-900/20' :
                      isBenchTarget ? 'bg-surface-2 border-blue-400/30 hover:border-blue-400/60 hover:bg-blue-900/20' :
                      isSelected   ? 'bg-blue-900/40 border-blue-500/60 ring-1 ring-blue-400/30' :
                      player ? (isPitcherSlot
                        ? 'bg-indigo-950/60 border-indigo-700/40 hover:border-indigo-600/60'
                        : isDHSlot
                        ? 'bg-purple-950/60 border-purple-700/40 hover:border-purple-600/60'
                        : 'bg-gray-800/90 border-gray-700/50 hover:border-gray-600/70')
                      : 'bg-gray-900/30 border-gray-700/40 border-dashed hover:border-gray-500/60'
                    }`}>
                      <div className="flex items-center gap-2 px-2.5 py-1">
                        {/* 打順番号 */}
                        <div className={`text-lg font-bold w-5 text-center shrink-0 ${
                          isSwapSource || isSelected ? 'text-blue-400' : 'text-gray-400'
                        }`}>{order}</div>

                        {isPitcherSlot ? (
                          <div className="flex-1 flex items-center">
                            <span className="text-indigo-400 font-semibold text-base">投手</span>
                            <span className="text-xs text-gray-400 ml-2">{nextStarter ? `${nextStarter.name}（ローテーションから自動起用）` : '先発投手が未設定'}</span>
                          </div>
                        ) : player ? (
                          <div className="flex-1 min-w-0">
                            {/* 行1: 名前・コンディション・ポジション・投打・年齢 + 外すボタン */}
                            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                              <span className="font-bold text-white text-base leading-tight">{player.name}</span>
                              <span className={`text-xs leading-none ${CONDITION_COLORS[player.condition ?? CONDITION_LEVELS.NORMAL]}`}>
                                {CONDITION_ICONS[player.condition ?? CONDITION_LEVELS.NORMAL]}
                              </span>
                              <select
                                value={entry.position}
                                onChange={(e) => { e.stopPropagation(); handleChangePosition(order, e.target.value); }}
                                className="bg-gray-700/70 border border-gray-600/50 text-white rounded px-1 py-0 text-xs"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {(() => {
                                  const opts = [
                                    ...(!useDH ? [{ value: 'pitcher', label: '投手' }] : []),
                                    { value: 'catcher', label: '捕手' },
                                    { value: 'first', label: '一塁' },
                                    { value: 'second', label: '二塁' },
                                    { value: 'third', label: '三塁' },
                                    { value: 'short', label: '遊撃' },
                                    { value: 'left', label: '左翼' },
                                    { value: 'center', label: '中堅' },
                                    { value: 'right', label: '右翼' },
                                    ...(useDH ? [{ value: 'dh', label: 'DH' }] : []),
                                  ];
                                  return opts.map(({ value, label }) => (
                                    <option key={value} value={value} disabled={value === 'pitcher' && entry.position !== 'pitcher'}>
                                      {label}
                                    </option>
                                  ));
                                })()}
                              </select>
                              {(() => {
                                const subs = getSubPositions(player, entry.position);
                                if (subs.length === 0) return null;
                                return subs.map((s, i) => (
                                  <span key={i} className={`text-xs font-medium ${s.color}`}>{s.label}</span>
                                ));
                              })()}
                              <span className="text-xs text-gray-300">
                                {getThrowsLabel(player.physical?.throws)}{player.batting?.bats === 'left' ? '左打' : player.batting?.bats === 'switch' ? '両打' : '右打'}
                              </span>
                              <span className="text-xs text-gray-300">{player.age}歳</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRemoveFromLineup(player.id); }}
                                className="btn-danger ml-auto shrink-0 text-xs w-5 h-5 flex items-center justify-center rounded transition"
                              >✕</button>
                            </div>

                            {/* 行2: 能力値チップ + 体力/疲労バー + 成績 */}
                            <div className="flex items-center gap-1.5">
                              {/* 能力チップは「ラベルの下に数字」の2段固定。
                                  以前は <span>ミ<span>68</span></span> と1つのspanに
                                  インラインで入れていたため、幅が足りないと**チップの
                                  内側で勝手に改行**し、折り返す行と折り返さない行が
                                  混ざって縦の桁が揃わなかった。 */}
                              <div className="flex gap-1">
                                {[
                                  { label: 'ミ', value: player.batting?.meet || 0 },
                                  { label: 'パ', value: player.batting?.power || 0 },
                                  { label: '走', value: player.physical?.speed || 0 },
                                  { label: '肩', value: player.physical?.arm || 0 },
                                  { label: '守', value: player.fielding?.defense || 0 },
                                ].map(stat => {
                                  const rank = getAbilityRank(stat.value);
                                  return (
                                    <span key={stat.label}
                                      className={`flex flex-col items-center leading-tight w-6 shrink-0 text-xs font-semibold tabular-nums ${getRankColor(rank)}`}>
                                      <span>{stat.label}</span>
                                      <span className="opacity-90">{stat.value}</span>
                                    </span>
                                  );
                                })}
                              </div>
                              <div className="flex items-center gap-1 ml-auto">
                                {player.personality && (
                                  <div className="flex items-center gap-1 mr-1">
                                    {[
                                      { label: 'プ', title: 'プロ意識', value: player.personality.discipline ?? 50 },
                                      { label: '精', title: '精神力', value: player.personality.mental ?? 50 },
                                    ].map(stat => (
                                      <span key={stat.label} title={stat.title}
                                        className={`flex flex-col items-center leading-tight w-6 shrink-0 text-xs tabular-nums ${stat.value >= 80 ? 'text-red-400' : stat.value >= 60 ? 'text-orange-400' : stat.value >= 40 ? 'text-yellow-400' : stat.value >= 20 ? 'text-blue-400' : 'text-gray-300'}`}>
                                        <span>{stat.label}</span>
                                        <span className="opacity-90">{stat.value}</span>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="flex items-center gap-0.5">
                                  <span className="text-xs text-gray-300">体</span>
                                  <div className="w-10 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                    <div className={`h-full ${getStaminaBarColor(player.physical?.bodyStamina || 50)} rounded-full`} style={{width:`${player.physical?.bodyStamina || 50}%`}} />
                                  </div>
                                </div>
                                <div className="flex items-center gap-0.5">
                                  <span className="text-xs text-gray-300">疲</span>
                                  <div className="w-10 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-red-500/80 rounded-full" style={{width:`${Math.min(player.fatigue || 0, 100)}%`}} />
                                  </div>
                                </div>
                              </div>
                              {(() => {
                                const bs = player.seasonStats?.batting;
                                if (!bs || !bs.atBats) return null;
                                const avg = bs.atBats > 0 ? (bs.hits / bs.atBats).toFixed(3) : '.000';
                                return (
                                  <div className="text-xs text-gray-300 ml-1 shrink-0">
                                    <span className="text-blue-300 font-semibold">{avg}</span>
                                    <span className="ml-1">{bs.homeruns || 0}本</span>
                                    <span className="ml-1">{bs.rbis || 0}点</span>
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        ) : (
                          <div className="text-gray-400 text-base italic">未設定</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 中央: ミニダイアモンド */}
            <div className="bg-surface-2 rounded-xl border border-gray-700/50 col-span-4 overflow-hidden p-3">
              <h2 className="font-semibold text-white text-sm mb-2 text-center">守備配置</h2>
              {/* ⚠ **fontSize の数値は実寸ではない**。実寸 = 数値 × (表示幅 / 260)。
                  260px 表示のままでは 8〜9 が 8〜9px にしかならず、12px の下限
                  （UIデザイン原則1）を割る。**文字だけ大きくすると円(r=16)と座標が
                  固定なので名前が重なる**ので、表示幅を 260 → 300 に広げて
                  倍率 1.154 を稼ぎ、そのうえで 10.4（= 12 / 1.154）にしてある。
                  列も col-span-3 → 4 に広げた（3のままだと 1280 幅で 220px しか無い）。 */}
              <svg viewBox="0 0 260 240" className="w-full max-w-[300px] mx-auto">
                <defs>
                  <linearGradient id="miniField" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#166534" stopOpacity="0.3"/>
                    <stop offset="100%" stopColor="#14532d" stopOpacity="0.1"/>
                  </linearGradient>
                </defs>
                <polygon points="130,200 10,100 130,10 250,100" fill="url(#miniField)" stroke="#22543d" strokeWidth="1"/>
                <line x1="130" y1="200" x2="10" y2="100" stroke="#22543d" strokeWidth="0.5" strokeDasharray="4"/>
                <line x1="130" y1="200" x2="250" y2="100" stroke="#22543d" strokeWidth="0.5" strokeDasharray="4"/>
                <rect x="115" y="155" width="30" height="30" fill="#22543d" stroke="#2d6a4f" strokeWidth="0.5" transform="rotate(45 130 170)"/>
                {(() => {
                  const miniCoords = {
                    pitcher:  { x: 130, y: 145 },
                    catcher:  { x: 130, y: 215 },
                    first:    { x: 205, y: 125 },
                    second:   { x: 170, y: 90 },
                    short:    { x: 90,  y: 90 },
                    third:    { x: 55,  y: 125 },
                    left:     { x: 30,  y: 55 },
                    center:   { x: 130, y: 30 },
                    right:    { x: 230, y: 55 },
                  };
                  const posLabelsShort = { pitcher: '投', catcher: '捕', first: '一', second: '二', short: '遊', third: '三', left: '左', center: '中', right: '右' };
                  return Object.entries(miniCoords).map(([pos, coord]) => {
                    const entry = lineup.find(e => e.position === pos);
                    const player = entry ? team.players.find(p => p.id === entry.playerId) : null;
                    const fitness = player?.positionFitness?.[pos] ?? 50;
                    const fitnessColor = fitness >= 80 ? '#22c55e' : fitness >= 60 ? '#eab308' : fitness >= 40 ? '#f97316' : '#ef4444';
                    return (
                      <g key={pos}>
                        <circle cx={coord.x} cy={coord.y} r={player ? 16 : 12} fill={player ? '#1e293b' : '#0f172a'} stroke={player ? fitnessColor : '#475569'} strokeWidth={player ? 2 : 1} opacity={player ? 1 : 0.5}/>
                        {player ? (
                          <>
                            <text x={coord.x} y={coord.y - 3.5} textAnchor="middle" fill="white" fontSize="10.4" fontWeight="bold">{posLabelsShort[pos]}</text>
                            <text x={coord.x} y={coord.y + 8.5} textAnchor="middle" fill="#cbd5e1" fontSize="10.4">
                              {surnameOf(player.name)}
                            </text>
                          </>
                        ) : (
                          <text x={coord.x} y={coord.y + 3.6} textAnchor="middle" fill="#bdc6d6" fontSize="10.4">{posLabelsShort[pos]}</text>
                        )}
                      </g>
                    );
                  });
                })()}
              </svg>
              {(() => {
                const positionsCovered = new Set(lineup.filter(e => e.battingOrder >= 1).map(e => e.position));
                const fieldPos = ['catcher','first','second','short','third','left','center','right'];
                const missing = fieldPos.filter(p => !positionsCovered.has(p));
                const posNames = { catcher: '捕手', first: '一塁', second: '二塁', short: '遊撃', third: '三塁', left: '左翼', center: '中堅', right: '右翼' };
                if (missing.length === 0) return null;
                return (
                  <div className="mt-2 text-center text-xs">
                    未配置:{' '}
                    {missing.map((p, i) => (
                      <span key={p} className={p === 'catcher' ? 'text-red-400 font-bold' : 'text-yellow-400/80'}>
                        {i > 0 && '・'}{posNames[p]}
                      </span>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* 右側: 控え選手一覧 */}
            <div className="bg-surface-2 rounded-xl border border-gray-700/50 col-span-4 overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-gray-700/50 shrink-0 space-y-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-white text-sm">
                    控え選手
                    <span className="ml-1.5 text-gray-400 font-normal text-xs">{sortedBenchPlayers.length}/{benchPlayers.length}人</span>
                  </h2>
                  {selectedBenchPlayer !== null ? (
                    <span className="bg-blue-900/50 text-blue-300 border border-blue-700/40 text-xs px-2 py-0.5 rounded-full">
                      → スタメン枠を選択
                    </span>
                  ) : swapSource !== null ? (
                    <span className="bg-blue-900/50 text-blue-300 border border-blue-700/40 text-xs px-2 py-0.5 rounded-full">
                      {swapSource}番と入れ替え
                    </span>
                  ) : selectedBattingOrder ? (
                    <span className="bg-green-900/50 text-green-300 border border-green-700/40 text-xs px-2 py-0.5 rounded-full">
                      {selectedBattingOrder}番に追加
                    </span>
                  ) : null}
                  <div className="ml-auto flex items-center gap-1.5">
                    {compareIds.length >= 2 && (
                      <button onClick={() => setDetailPlayer('__compare__')}
                        className="btn-secondary text-xs px-2 py-1 rounded transition">
                        比較 ({compareIds.length})
                      </button>
                    )}
                    {compareIds.length > 0 && (
                      <button onClick={() => setCompareIds([])}
                        className="text-xs px-1.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition">
                        解除
                      </button>
                    )}
                    <button onClick={() => setBenchCompact(!benchCompact)}
                      className={`text-xs px-2 py-1 rounded border transition font-medium ${
                        benchCompact ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600' : 'bg-blue-900/50 border-blue-700/50 text-blue-300'
                      }`}>
                      {benchCompact ? '詳細表示' : '簡易表示'}
                    </button>
                  </div>
                </div>
                {/* ポジションフィルタ */}
                <div className="flex gap-1">
                  {[
                    { key: 'all', label: '全員' },
                    { key: 'pitcher', label: '投手' },
                    { key: 'catcher', label: '捕手' },
                    { key: 'infield', label: '内野' },
                    { key: 'outfield', label: '外野' },
                  ].map(f => (
                    <button key={f.key} onClick={() => setBenchFilter(f.key)}
                      className={`text-xs px-2 py-1 rounded transition font-medium ${
                        benchFilter === f.key
                          ? 'seg-on' : 'seg'
                      }`}>
                      {f.label}
                      <span className="ml-0.5 opacity-60">
                        {f.key === 'all' ? benchPlayers.length
                         : f.key === 'pitcher' ? benchPlayers.filter(p => p.position === 'pitcher').length
                         : f.key === 'catcher' ? benchPlayers.filter(p => p.position === 'catcher').length
                         : f.key === 'infield' ? benchPlayers.filter(p => ['first','second','short','third'].includes(p.position)).length
                         : benchPlayers.filter(p => ['left','center','right'].includes(p.position)).length}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div
                className="overflow-y-auto max-h-[700px]"
                onDragOver={(e) => { if (draggedLineupRef.current?.kind === 'slot') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('ring-1', 'ring-red-400/50', 'bg-red-950/10'); } }}
                onDragLeave={(e) => { e.currentTarget.classList.remove('ring-1', 'ring-red-400/50', 'bg-red-950/10'); }}
                onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('ring-1', 'ring-red-400/50', 'bg-red-950/10'); handleDropToBench(); }}
              >
                <table className="w-full text-left">
                  <thead className="sticky top-0 z-10">
                    {benchCompact ? (<>
                      {/* コンパクトヘッダー */}
                      <tr className="bg-surface-2 border-b border-gray-700/50 text-xs text-gray-300">
                        <th className="py-1 pl-1.5 w-6"></th>
                        <SortHeader label="名前" sortKey="name" className="pl-1" />
                        <SortHeader label="齢" sortKey="age" className="text-center" />
                        <SortHeader label="守備" sortKey="position" />
                        <SortHeader label="ミ" sortKey="meet" className="text-center border-l border-gray-700/40" />
                        <SortHeader label="パ" sortKey="power" className="text-center" />
                        <SortHeader label="足" sortKey="speed" className="text-center" />
                        <SortHeader label="肩" sortKey="arm" className="text-center" />
                        <SortHeader label="守" sortKey="defense" className="text-center" />
                        <SortHeader label="疲労" sortKey="fatigue" className="text-center border-l border-gray-700/40" />
                        <th className="py-1 px-1 text-center text-gray-400 border-l border-gray-700/40">成績</th>
                      </tr>
                    </>) : (<>
                      {/* 詳細ヘッダー */}
                      <tr className="bg-surface-2 border-b border-gray-700/30 text-xs font-medium">
                        <th className="py-1 pl-1.5 w-6"></th>
                        <th colSpan={3} className="py-1 pl-1 pr-1 text-left text-gray-400">選手情報</th>
                        <th colSpan={1} className="py-1 px-1 text-center text-gray-400">投打</th>
                        <th colSpan={7} className="py-1 px-1 text-center text-blue-400/60 border-l border-gray-700/40">野手能力</th>
                        <th colSpan={1} className="py-1 px-1 text-center text-yellow-400/60 border-l border-gray-700/40">状態</th>
                        <th colSpan={1} className="py-1 px-1 text-center text-gray-400 border-l border-gray-700/40">成績</th>
                      </tr>
                      <tr className="bg-surface-2 border-b border-gray-700/50 text-xs text-gray-300">
                        <th className="py-1 pl-1.5 w-6"></th>
                        <SortHeader label="名前" sortKey="name" className="pl-1" />
                        <SortHeader label="齢" sortKey="age" className="text-center" />
                        <SortHeader label="守備" sortKey="position" />
                        <th className="py-1 px-1 text-gray-400">投打</th>
                        <SortHeader label="ミ" sortKey="meet" className="text-center border-l border-gray-700/40" />
                        <SortHeader label="パ" sortKey="power" className="text-center" />
                        <SortHeader label="走" sortKey="speed" className="text-center" />
                        <SortHeader label="肩" sortKey="arm" className="text-center" />
                        <SortHeader label="守" sortKey="defense" className="text-center" />
                        <SortHeader label="体" sortKey="bodyStamina" className="text-center" />
                        <SortHeader label="回" sortKey="recovery" className="text-center" />
                        <SortHeader label="疲" sortKey="fatigue" className="text-center border-l border-gray-700/40" />
                        <th className="py-1 px-1 text-center border-l border-gray-700/40">成績</th>
                      </tr>
                    </>)}
                  </thead>
                  <tbody>
                    {sortedBenchPlayers.map(player => (
                      <BenchPlayerRow key={player.id} player={player} />
                    ))}
                    {sortedBenchPlayers.length === 0 && (
                      <tr><td colSpan={20} className="py-8 text-center text-gray-400 text-sm">該当する選手がいません</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          </>
        )}

        {tab === 'rotation' && (() => {
          // 全選手をロール別にグループ分け（ベンチ外選手=isActive:falseを除外）
          const allPlayers = (team.players || []).filter(p => p.isActive !== false);
          const starterPitchers = allPlayers.filter(p => ['ace', 'complete', 'short', 'quality', 'opener', 'auto_s'].includes(getPitcherRole(p.id)));
          const starterOrder = team.pitchingRotation.starters || [];
          starterPitchers.sort((a, b) => {
            const ia = starterOrder.indexOf(a.id);
            const ib = starterOrder.indexOf(b.id);
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
          });

          const handleSwapStarter = (displayIdx, direction) => {
            const starters = team.pitchingRotation.starters;
            if (!starters) return;
            const playerId = starterPitchers[displayIdx]?.id;
            const targetPlayerId = starterPitchers[displayIdx + direction]?.id;
            if (!playerId || !targetPlayerId) return;
            const idx = starters.indexOf(playerId);
            const targetIdx = starters.indexOf(targetPlayerId);
            if (idx === -1 || targetIdx === -1) return;
            starters[idx] = targetPlayerId;
            starters[targetIdx] = playerId;
            setUpdateTrigger(prev => prev + 1);
          };

          // リリーフをサブグループに分類
          const reliefByRole = {
            long: allPlayers.filter(p => ['long', 'auto_r'].includes(getPitcherRole(p.id))),
            middle: allPlayers.filter(p => ['mopup', 'behind', 'onepoint', 'ace_relief'].includes(getPitcherRole(p.id))),
            setup: allPlayers.filter(p => getPitcherRole(p.id) === 'setup'),
            closer: allPlayers.filter(p => getPitcherRole(p.id) === 'closer'),
          };
          const allReliefPitchers = [...reliefByRole.long, ...reliefByRole.middle, ...reliefByRole.setup, ...reliefByRole.closer];
          const unassignedPitchers = allPlayers.filter(p => p.position === 'pitcher' && getPitcherRole(p.id) === 'none');
          const fieldersForConvert = allPlayers.filter(p => p.position !== 'pitcher' && getPitcherRole(p.id) === 'none');

          const StatVal = ({ label, value, isVelocity }) => {
            const rank = isVelocity ? getVelocityRank(value) : getAbilityRank(value);
            return <span className={`${getRankColor(rank)}`}>{label}{value}</span>;
          };

          // ロールアイコン
          const ROLE_ICON = {
            ace: '👑', complete: '🏔', short: '⚡', quality: '✓', opener: '🚪', auto_s: '🤖',
            long: '🔄', mopup: '🧹', behind: '🛡', onepoint: '🎯',
            ace_relief: '🔥', setup: '⬆', closer: '🔒', auto_r: '🤖', none: '—',
          };

          // 選手カード左端のロール別アクセントカラー（Tailwindがpurgeしないよう静的リテラルで定義）
          const ROLE_BORDER = {
            ace: 'border-l-red-500', complete: 'border-l-blue-500', short: 'border-l-blue-400',
            quality: 'border-l-blue-300', opener: 'border-l-teal-400', auto_s: 'border-l-gray-400',
            long: 'border-l-green-500', ace_relief: 'border-l-green-400', mopup: 'border-l-gray-500',
            behind: 'border-l-yellow-500', onepoint: 'border-l-green-400', setup: 'border-l-orange-400',
            closer: 'border-l-purple-400', auto_r: 'border-l-gray-400', none: 'border-l-gray-600',
          };

          // 投手起用バランス警告
          const roleWarnings = (() => {
            const w = [];
            if (reliefByRole.closer.length === 0) w.push({ msg: '守護神が未設定です', level: 'error' });
            if (reliefByRole.closer.length >= 2) w.push({ msg: '守護神が2人以上設定されています', level: 'warn' });
            if (reliefByRole.setup.length === 0) w.push({ msg: 'セットアッパーが未設定です', level: 'warn' });
            if (starterPitchers.length < 4) w.push({ msg: `先発が${starterPitchers.length}人（推奨: 5-6人）`, level: 'error' });
            else if (starterPitchers.length < 5) w.push({ msg: `先発が${starterPitchers.length}人（推奨: 5-6人）`, level: 'warn' });
            if (starterPitchers.length > 7) w.push({ msg: `先発が${starterPitchers.length}人（多すぎる可能性）`, level: 'warn' });
            if (unassignedPitchers.length > 0) w.push({ msg: `${unassignedPitchers.length}人の投手がロール未設定`, level: 'info' });
            const totalRelief = allReliefPitchers.length;
            if (totalRelief < 3) w.push({ msg: `リリーフが${totalRelief}人（推奨: 4人以上）`, level: 'warn' });
            return w;
          })();

          // コンパクトブルペンフロー
          const BullpenFlowCompact = () => {
            const items = [
              { label: '先発', count: starterPitchers.length, target: 6, color: 'text-blue-400' },
              { label: '中継', count: reliefByRole.long.length + reliefByRole.middle.length, target: 3, color: 'text-green-400' },
              { label: 'SU', count: reliefByRole.setup.length, target: 1, color: 'text-orange-400' },
              { label: '抑', count: reliefByRole.closer.length, target: 1, color: 'text-purple-400' },
              { label: '未', count: unassignedPitchers.length, target: 0, color: 'text-gray-300' },
            ];
            return (
              <>
                <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700/50 mb-1">
                  {items.map((s, i) => (
                    <React.Fragment key={s.label}>
                      <div className="flex items-center gap-1">
                        <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>
                        <span className={`text-sm font-bold ${s.target > 0 && s.count >= s.target ? 'text-white' : s.count > 0 ? 'text-yellow-400' : 'text-gray-400'}`}>
                          {s.count}{s.target > 0 && <span className="text-gray-400 text-xs">/{s.target}</span>}
                        </span>
                      </div>
                      {i < items.length - 1 && <span className="text-gray-400 text-xs">▸</span>}
                    </React.Fragment>
                  ))}
                  {tapSelectedPitcherId ? (
                    <span className="text-blue-400 text-xs ml-auto animate-pulse">→ 役割枠をクリックで配置（もう一度クリックで詳細）</span>
                  ) : (
                    <span className="text-gray-400 text-xs ml-auto">ドラッグで役割変更 / クリックで選択</span>
                  )}
                </div>
                {roleWarnings.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-1 mb-2">
                    {roleWarnings.map((w, i) => (
                      <span key={i} className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        w.level === 'error' ? 'bg-red-900/40 text-red-400 border border-red-700/40' :
                        w.level === 'warn' ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-700/30' :
                        'bg-gray-800/60 text-gray-300 border border-gray-700/30'
                      }`}>
                        {w.level === 'error' ? '!' : w.level === 'warn' ? '!' : 'i'} {w.msg}
                      </span>
                    ))}
                  </div>
                )}
              </>
            );
          };

          const RoleLegend = () => {
            const open = roleLegendOpen;
            const setOpen = setRoleLegendOpen;
            const starterLegend = [
              { icon: '👑', role: 'ゲームメーカー', desc: '7-8回を責任投球。エース格。球数上限110球', color: 'text-red-400' },
              { icon: '🏔', role: '完投型', desc: 'スタミナ限界まで投げ抜く。球数上限120球', color: 'text-blue-400' },
              { icon: '✓', role: '勝ち権利', desc: '5-6回を投げて勝ちパターンへ。球数上限100球', color: 'text-blue-300' },
              { icon: '⚡', role: 'ショート', desc: '3-4回で中継ぎへ繋ぐ。球数上限65球', color: 'text-blue-200' },
            ];
            const reliefLegend = [
              { icon: '🔒', role: '守護神', desc: '9回・リード時に試合を締める。球数上限40球', color: 'text-purple-400' },
              { icon: '⬆', role: 'セットアッパー', desc: '7-8回の僅差で守護神に繋ぐ。球数上限35球', color: 'text-orange-400' },
              { icon: '🔥', role: '中継ぎエース', desc: '僅差の重要場面で登板。球数上限40球', color: 'text-green-300' },
              { icon: '🔄', role: 'ロングリリーフ', desc: '先発降板後をカバー。球数上限60球', color: 'text-green-500' },
              { icon: '🎯', role: 'ワンポイント', desc: '特定打者に対して登板。球数上限15球', color: 'text-green-400' },
              { icon: '🛡', role: 'ビハインド', desc: 'ビハインド時にイニングを繋ぐ。球数上限50球', color: 'text-yellow-400' },
              { icon: '🧹', role: '敗戦処理', desc: '大差で登板しスタミナ温存。球数上限50球', color: 'text-gray-300' },
            ];
            return (
              <details className="mb-2 bg-gray-800/40 rounded-lg border border-gray-700/30" open={open} onToggle={e => setOpen(e.target.open)}>
                <summary className="px-3 py-1.5 text-xs text-gray-300 cursor-pointer hover:text-gray-300 list-none flex items-center gap-1">
                  <span className="text-xs">{open ? '▼' : '▶'}</span> ロール解説
                </summary>
                <div className="px-3 pb-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
                  <div>
                    <div className="text-blue-400 text-xs font-bold uppercase tracking-wider mb-1">先発</div>
                    {starterLegend.map(r => (
                      <div key={r.role} className="flex items-start gap-1.5 text-xs py-0.5">
                        <span className="w-4 text-center shrink-0">{r.icon}</span>
                        <span className={`font-bold shrink-0 ${r.color}`}>{r.role}</span>
                        <span className="text-gray-400">{r.desc}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="text-green-400 text-xs font-bold uppercase tracking-wider mb-1">リリーフ</div>
                    {reliefLegend.map(r => (
                      <div key={r.role} className="flex items-start gap-1.5 text-xs py-0.5">
                        <span className="w-4 text-center shrink-0">{r.icon}</span>
                        <span className={`font-bold shrink-0 ${r.color}`}>{r.role}</span>
                        <span className="text-gray-400">{r.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            );
          };

          // 投手起用D&D: ドラッグ可能な投手カード
          const DnDPitcherCard = ({ player }) => {
            const p = player.pitching || {};
            const isTapSel = tapSelectedPitcherId === player.id;
            const isFielder = player.position !== 'pitcher';
            const role = getPitcherRole(player.id);
            // 今年の投手成績（登板・防御率・勝敗・H・S）。inningsPitchedはアウト数
            const s = player.seasonStats?.pitching || {};
            const outs = s.inningsPitched || 0;
            const era = outs > 0 ? ((s.earnedRuns || 0) * 27 / outs).toFixed(2) : '-.--';
            const accent = ROLE_BORDER[role] || 'border-l-gray-600';
            return (
              <div
                draggable
                onDragStart={(e) => {
                  draggedPitcherIdRef.current = player.id;
                  e.dataTransfer.effectAllowed = 'move';
                  // setDataがないとFirefox等でドラッグが開始されない
                  try { e.dataTransfer.setData('text/plain', String(player.id)); } catch (_) {}
                  e.currentTarget.classList.add('opacity-40');
                }}
                onDragEnd={(e) => {
                  draggedPitcherIdRef.current = null;
                  e.currentTarget.classList.remove('opacity-40');
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  // 1回目クリック=選択、選択中の再クリック=詳細能力を表示
                  if (isTapSel) setDetailPlayer(player);
                  else setTapSelectedPitcherId(player.id);
                }}
                title="ドラッグで役割変更／クリックで選択・選択中にもう一度で詳細"
                className={`flex flex-col gap-0.5 pl-3 pr-1.5 py-1 rounded cursor-grab active:cursor-grabbing border border-l-2 text-xs transition-colors select-none ${
                  isTapSel ? 'bg-blue-900/60 border-blue-400/60 ring-1 ring-blue-400/40'
                           : `bg-surface-2 border-gray-700 hover:bg-gray-700/70 ${accent}`}`}
              >
                {/* 1行目: 名前・調子・投げ手/フォーム・能力 */}
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 shrink-0 leading-none">⠿</span>
                  <span className={`font-bold truncate ${isFielder ? 'text-cyan-300' : 'text-white'}`} style={{ maxWidth: '4.5rem' }}>{player.name}</span>
                  <span className={`shrink-0 ${CONDITION_COLORS[player.condition ?? CONDITION_LEVELS.NORMAL]}`}>{CONDITION_ICONS[player.condition ?? CONDITION_LEVELS.NORMAL]}</span>
                  {/* 投げ手・フォーム */}
                  <span className="shrink-0 text-xs text-gray-300 bg-gray-900/50 border border-gray-700/60 rounded px-1 leading-tight hidden lg:inline">
                    {throwsLabel(player)}{formLabel(player) ? `・${formLabel(player)}` : ''}
                  </span>
                  {/* 能力（ラベル付き）: 速=球速 / 制=制球 / スタ=スタミナ */}
                  <span className="ml-auto flex items-center gap-1.5 shrink-0 tabular-nums">
                    <span className="inline-flex items-baseline gap-0.5"><span className="text-gray-300 text-xs">速</span><AbilityValue value={p.velocity || 0} isVel /></span>
                    <span className="inline-flex items-baseline gap-0.5"><span className="text-gray-300 text-xs">制</span><AbilityValue value={p.control || 0} /></span>
                    <span className="inline-flex items-baseline gap-0.5"><span className="text-gray-300 text-xs">スタ</span><AbilityValue value={p.stamina || 0} isSta /></span>
                  </span>
                </div>
                {/* 2行目: 今年の成績（登板・防御率・勝敗・ホールド・セーブ） */}
                {!isFielder && (
                  <div className="flex items-center gap-2 pl-4 text-xs tabular-nums leading-tight">
                    <span className="text-gray-400">登板<span className="text-gray-200 ml-0.5">{s.games || 0}</span></span>
                    <span className="text-gray-400">防<span className="text-yellow-300 ml-0.5">{era}</span></span>
                    <span className="text-gray-400"><span className="text-gray-200">{s.wins || 0}</span>勝<span className="text-gray-200">{s.losses || 0}</span>敗</span>
                    <span className="text-gray-400">H<span className="text-gray-200 ml-0.5">{s.holds || 0}</span></span>
                    <span className="text-gray-400">S<span className="text-gray-200 ml-0.5">{s.saves || 0}</span></span>
                  </div>
                )}
              </div>
            );
          };

          // 投手起用D&D: 役割スロット（ドロップ先）
          const RoleSlot = ({ roleKey, hint, wide }) => {
            const info = PITCHER_ROLES[roleKey];
            const members = allPlayers.filter(p => getPitcherRole(p.id) === roleKey);
            const canTapAssign = tapSelectedPitcherId !== null;
            const onDrop = (e) => {
              e.preventDefault();
              e.currentTarget.classList.remove(...SLOT_OVER_CLASSES);
              const id = draggedPitcherIdRef.current;
              draggedPitcherIdRef.current = null;
              if (id != null) handleDropToRole(id, roleKey);
            };
            return (
              <div
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add(...SLOT_OVER_CLASSES); }}
                onDragLeave={(e) => { e.currentTarget.classList.remove(...SLOT_OVER_CLASSES); }}
                onDrop={onDrop}
                onClick={() => { if (canTapAssign) handleDropToRole(tapSelectedPitcherId, roleKey); }}
                className={`rounded-lg border transition-colors ${wide ? 'col-span-2' : ''} ${
                  canTapAssign ? 'border-blue-500/30 bg-gray-800/40 cursor-pointer hover:border-blue-400/50'
                               : 'border-gray-700/60 bg-gray-800/40'}`}
              >
                <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-700/40">
                  <span className="text-sm leading-none">{ROLE_ICON[roleKey]}</span>
                  <span className={`text-xs font-bold ${info.textColor}`}>{info.label}</span>
                  {members.length > 0 && <span className="text-xs text-gray-300 bg-gray-900/60 rounded-full px-1.5 leading-tight">{members.length}</span>}
                  {hint && <span className="ml-auto text-xs text-gray-200 bg-gray-900/70 border border-gray-600/50 rounded px-1.5 py-0.5 leading-none hidden md:inline">{hint}</span>}
                </div>
                <div className="p-1 space-y-0.5 min-h-[2.25rem]">
                  {members.length === 0
                    ? <div className="text-xs text-gray-300 text-center py-2 select-none">{canTapAssign ? 'ここへ配置' : 'ここにドロップ'}</div>
                    : members.map(pl => <DnDPitcherCard key={pl.id} player={pl} />)}
                </div>
              </div>
            );
          };

          return (
            <div>
              <TutorialHint id="rotation-dnd" title="投手の役割を決める">
                投手カードを<b className="text-cyan-200">ドラッグ＆ドロップ</b>で「先発・守護神・セットアッパー・中継ぎ」等の役割枠へ配置します。先発は5〜6人、守護神・セットアッパーは各1人が目安（不足は警告表示）。「自動」で能力に応じて一括割り当ても可能です。
              </TutorialHint>
              {/* 自動設定バー: 能力に応じてロールを一括割り当て / 全員おまかせ */}
              <div className="flex items-center gap-2 mb-2 bg-gray-800/40 rounded-lg border border-gray-700/30 px-3 py-2">
                <span className="text-xs text-gray-300 shrink-0">投手起用</span>
                <button
                  onClick={() => {
                    generatePitchingRotation(teamName, team);
                    setUpdateTrigger(prev => prev + 1);
                  }}
                  className="btn-primary text-xs px-3 py-1 rounded font-medium transition"
                  title="能力に応じて先発ローテ・守護神・セット・中継ぎ等を自動で割り当てます"
                >
                  自動設定
                </button>
                <button
                  onClick={() => {
                    const rot = team.pitchingRotation;
                    if (rot) {
                      const starterSet = new Set(rot.starters || []);
                      const roles = {};
                      (team.players || []).forEach(p => {
                        if (p.position === 'pitcher' || (p.pitching?.stamina || 0) >= 100) {
                          roles[p.id] = starterSet.has(p.id) ? 'auto_s' : 'auto_r';
                        }
                      });
                      rot.pitcherRoles = roles;
                    }
                    setUpdateTrigger(prev => prev + 1);
                  }}
                  className="btn-secondary text-xs px-3 py-1 rounded font-medium transition"
                  title="全投手をおまかせにします（AIが登板場面を自動判断）"
                >
                  全員おまかせ
                </button>
                <span className="text-xs text-gray-400 hidden sm:inline">自動設定=能力で最適配置 / おまかせ=AIが場面判断</span>
              </div>

              <BullpenFlowCompact />
              <RoleLegend />

              {/* 先発 登板順（開幕から誰が先に投げるか）: ◀▶で入替 */}
              {starterPitchers.length > 0 && (
                <div className="mb-2 bg-gray-800/40 rounded-lg border border-gray-700/40 px-2 py-1.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-blue-300 text-xs font-bold">先発 登板順</span>
                    <span className="text-xs text-gray-300">◀▶ で入替（1番手から順に登板）</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {starterPitchers.map((pl, idx) => (
                      <div key={pl.id} className="flex items-center gap-0.5 bg-surface-2 border border-gray-700 rounded px-1 py-0.5">
                        <button
                          onClick={() => handleSwapStarter(idx, -1)}
                          disabled={idx === 0}
                          className={`text-xs px-0.5 ${idx === 0 ? 'text-gray-400' : 'text-gray-300 hover:text-white'}`}
                        >◀</button>
                        <span className="text-blue-400 font-bold text-xs w-3 text-center">{idx + 1}</span>
                        <span className="text-xs font-bold text-white truncate max-w-[4.5rem]">{pl.name}</span>
                        <span className="text-xs">{ROLE_ICON[getPitcherRole(pl.id)]}</span>
                        <button
                          onClick={() => handleSwapStarter(idx, 1)}
                          disabled={idx === starterPitchers.length - 1}
                          className={`text-xs px-0.5 ${idx === starterPitchers.length - 1 ? 'text-gray-400' : 'text-gray-300 hover:text-white'}`}
                        >▶</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 2カラム: 先発（左・縦積み） / リリーフ（右・縦積み） */}
              <div className="grid grid-cols-2 gap-2 mb-2 items-start">
                {/* 先発（左） */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-blue-400 text-sm">⚾</span>
                    <h2 className="text-sm font-bold text-blue-300">先発</h2>
                    <span className="text-xs text-gray-300">枠へドラッグ</span>
                  </div>
                  <div className="space-y-1.5">
                    <RoleSlot roleKey="complete" hint="スタミナ限界まで" />
                    <RoleSlot roleKey="ace" hint="7-8回を任せる" />
                    <RoleSlot roleKey="quality" hint="5-6回で交代" />
                    <RoleSlot roleKey="short" hint="3-4回で継投" />
                    <RoleSlot roleKey="opener" hint="初回〜2回で継投" />
                    <RoleSlot roleKey="auto_s" hint="AIが判断" />
                  </div>
                </div>

                {/* リリーフ（右） */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-green-400 text-sm">🔄</span>
                    <h2 className="text-sm font-bold text-green-300">リリーフ</h2>
                    <span className="text-xs text-gray-300">上ほど後ろのイニング</span>
                  </div>
                  <div className="space-y-1.5">
                    <RoleSlot roleKey="closer" hint="9回リード" />
                    <RoleSlot roleKey="setup" hint="8回僅差" />
                    <RoleSlot roleKey="ace_relief" hint="接戦の中盤〜" />
                    <RoleSlot roleKey="long" hint="複数回イニング" />
                    <RoleSlot roleKey="onepoint" hint="左打者対策" />
                    <RoleSlot roleKey="behind" hint="ビハインド時" />
                    <RoleSlot roleKey="mopup" hint="大差の敗戦処理" />
                    <RoleSlot roleKey="auto_r" hint="AIが判断" />
                  </div>
                </div>
              </div>

              {/* 控え・未設定: ドロップで役割解除 */}
              <div
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add(...SLOT_OVER_CLASSES); }}
                onDragLeave={(e) => { e.currentTarget.classList.remove(...SLOT_OVER_CLASSES); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove(...SLOT_OVER_CLASSES);
                  const id = draggedPitcherIdRef.current;
                  draggedPitcherIdRef.current = null;
                  if (id != null) handleDropToRole(id, 'none');
                }}
                onClick={() => { if (tapSelectedPitcherId != null) handleDropToRole(tapSelectedPitcherId, 'none'); }}
                className={`rounded-lg border mb-2 transition-colors ${
                  tapSelectedPitcherId != null ? 'border-blue-500/30 bg-gray-800/40 cursor-pointer'
                    : 'border-gray-700/60 bg-gray-800/40'}`}
              >
                <div className="flex items-center gap-1.5 px-2 py-1 border-b border-gray-700/40">
                  <span className="text-gray-300 text-sm">📋</span>
                  <h2 className="text-xs font-bold text-gray-300">控え・未設定</h2>
                  <span className="text-xs text-gray-300">{unassignedPitchers.length}人</span>
                  <span className="ml-auto text-xs text-gray-200 bg-gray-900/70 border border-gray-600/50 rounded px-1.5 py-0.5 leading-none hidden sm:inline">ここへ入れると役割解除</span>
                </div>
                <div className="p-1 flex flex-wrap gap-1">
                  {unassignedPitchers.length === 0
                    ? <div className="text-xs text-gray-400 py-1.5 px-2">未設定の投手なし</div>
                    : unassignedPitchers.map(pl => (
                        <div key={pl.id} className="w-[calc(50%-0.25rem)] sm:w-[calc(33.333%-0.34rem)] md:w-[calc(25%-0.375rem)]"><DnDPitcherCard player={pl} /></div>
                      ))}
                </div>
              </div>

              {/* 野手コンバート（折りたたみ）: 役割枠にドラッグで投手化 */}
              <details className="rounded-lg border border-gray-700/60 bg-gray-800/40">
                <summary className="flex items-center gap-1.5 px-2 py-1 cursor-pointer list-none hover:bg-gray-700/20">
                  <span className="text-cyan-400 text-sm">🔀</span>
                  <h2 className="text-xs font-bold text-cyan-300">野手をコンバート</h2>
                  <span className="text-xs text-gray-300">{fieldersForConvert.length}人</span>
                  <span className="ml-auto text-xs text-gray-400">役割枠へドラッグで投手化 ▶</span>
                </summary>
                <div className="p-1 flex flex-wrap gap-1">
                  {fieldersForConvert.map(pl => (
                    <div key={pl.id} className="w-[calc(50%-0.25rem)] sm:w-[calc(33.333%-0.34rem)] md:w-[calc(25%-0.375rem)]"><DnDPitcherCard player={pl} /></div>
                  ))}
                </div>
              </details>
            </div>
          );
        })()}

        {tab === 'defense' && (() => {
          // スタメン選手のポジション別配置を取得（スタメン+投手のみ）
          const positionPlayers = {};
          const positionEntries = {};
          lineup.forEach(entry => {
            if (entry.battingOrder < 1 && entry.position !== 'pitcher') return;
            if (entry.position !== 'pitcher' && entry.battingOrder > maxFielderSlots) return;
            const player = team.players.find(p => p.id === entry.playerId);
            if (player) {
              positionPlayers[entry.position] = player;
              positionEntries[entry.position] = entry;
            }
          });

          // ダイヤモンド上の各ポジション座標（SVG 500x470）
          const posCoords = {
            pitcher:  { x: 250, y: 270 },
            catcher:  { x: 250, y: 395 },
            first:    { x: 385, y: 240 },
            second:   { x: 320, y: 170 },
            short:    { x: 180, y: 170 },
            third:    { x: 115, y: 240 },
            left:     { x: 70,  y: 110 },
            center:   { x: 250, y: 65 },
            right:    { x: 430, y: 110 },
          };

          // 守備位置適正の取得（0-100）
          const getFitness = (player, pos) => {
            if (!player) return 0;
            return player.positionFitness?.[pos] ?? 50;
          };

          // 適正による能力補正倍率（適正100→100%、適正0→50%）
          const getFitnessMult = (player, pos) => {
            const fitness = getFitness(player, pos);
            return 0.5 + (fitness / 100) * 0.5;
          };

          // 守備範囲の計算（守備力+走力ベース × 適正補正）
          const getDefenseRange = (player, pos) => {
            if (!player) return 0;
            const def = player.fielding?.defense || 50;
            const spd = player.physical?.speed || 50;
            const arm = player.physical?.arm || 50;
            const mult = getFitnessMult(player, pos);
            let raw;
            if (['left', 'center', 'right'].includes(pos)) {
              raw = (def * 0.3 + spd * 0.5 + arm * 0.2) / 100;
            } else if (['second', 'short'].includes(pos)) {
              raw = (def * 0.4 + spd * 0.3 + arm * 0.3) / 100;
            } else if (pos === 'catcher') {
              raw = (def * 0.5 + arm * 0.5) / 100;
            } else {
              raw = (def * 0.5 + spd * 0.25 + arm * 0.25) / 100;
            }
            return raw * mult;
          };

          const posLabels = {
            pitcher: '投', catcher: '捕', first: '一', second: '二',
            short: '遊', third: '三', left: '左', center: '中', right: '右'
          };
          const posFullLabels = {
            pitcher: '投手', catcher: '捕手', first: '一塁', second: '二塁',
            short: '遊撃', third: '三塁', left: '左翼', center: '中堅', right: '右翼'
          };

          const getRangeColor = (range) => {
            if (range >= 0.90) return { fill: 'rgba(236,72,153,0.18)', stroke: '#ec4899' };
            if (range >= 0.82) return { fill: 'rgba(248,113,113,0.16)', stroke: '#f87171' };
            if (range >= 0.70) return { fill: 'rgba(251,146,60,0.14)', stroke: '#fb923c' };
            if (range >= 0.55) return { fill: 'rgba(251,191,36,0.14)', stroke: '#fbbf24' };
            if (range >= 0.42) return { fill: 'rgba(74,222,128,0.12)', stroke: '#4ade80' };
            if (range >= 0.30) return { fill: 'rgba(96,165,250,0.10)', stroke: '#60a5fa' };
            return { fill: 'rgba(148,163,184,0.08)', stroke: '#94a3b8' };
          };

          const getFitnessColor = (fitness) => {
            if (fitness >= 100) return '#ff1493'; // DeepPink
            if (fitness >= 90) return '#ec4899';  // Pink
            if (fitness >= 80) return '#f87171';  // Red
            if (fitness >= 70) return '#f97316';  // Orange
            if (fitness >= 60) return '#fbbf24';  // Amber
            if (fitness >= 50) return '#eab308';  // Yellow
            if (fitness >= 40) return '#84cc16';  // Lime
            if (fitness >= 30) return '#22c55e';  // Green
            if (fitness >= 20) return '#06b6d4';  // Cyan
            if (fitness >= 10) return '#3b82f6';  // Blue
            return '#6366f1';                     // Indigo
          };

          const getRangeGrade = (range) => {
            if (range >= 0.90) return { label: 'S', color: 'text-pink-400' };
            if (range >= 0.82) return { label: 'A', color: 'text-red-400' };
            if (range >= 0.70) return { label: 'B', color: 'text-orange-400' };
            if (range >= 0.55) return { label: 'C', color: 'text-yellow-400' };
            if (range >= 0.42) return { label: 'D', color: 'text-green-400' };
            if (range >= 0.30) return { label: 'E', color: 'text-blue-400' };
            return { label: 'F', color: 'text-slate-400' };
          };

          // 守備位置クリック → 選択 or スワップ
          const handleDefenseClick = (pos) => {
            if (pos === 'pitcher') return; // 投手は変更不可
            if (!selectedDefensePos) {
              setSelectedDefensePos(pos);
            } else if (selectedDefensePos === pos) {
              setSelectedDefensePos(null);
            } else {
              // 2つの位置をスワップ
              const entry1 = lineup.find(e => e.position === selectedDefensePos && e.battingOrder >= 1 && e.battingOrder <= maxFielderSlots);
              const entry2 = lineup.find(e => e.position === pos && e.battingOrder >= 1 && e.battingOrder <= maxFielderSlots);
              if (entry1 && entry2) {
                entry1.position = pos;
                entry2.position = selectedDefensePos;
              } else if (entry1 && !entry2) {
                entry1.position = pos;
              } else if (!entry1 && entry2) {
                entry2.position = selectedDefensePos;
              }
              setSelectedDefensePos(null);
              setUpdateTrigger(prev => prev + 1);
            }
          };

          // 野手ポジションのみ（投手除く）
          const fieldPositions = ['catcher', 'first', 'second', 'short', 'third', 'left', 'center', 'right'];

          // 選択中ポジションの候補者一覧
          const selectedPosSwapCandidates = selectedDefensePos ? lineup
            .filter(e => e.battingOrder >= 1 && e.battingOrder <= maxFielderSlots && e.position !== selectedDefensePos)
            .map(e => {
              const player = team.players.find(p => p.id === e.playerId);
              return player ? { player, entry: e } : null;
            })
            .filter(Boolean) : [];

          // 適正に基づくグラデーション色（10刻み）
          const getFitnessGradient = (fitness) => {
            if (fitness >= 100) return { main: '#ff1493', glow: 'rgba(255,20,147,0.6)', bg: 'rgba(255,20,147,0.12)' };
            if (fitness >= 90) return { main: '#ec4899', glow: 'rgba(236,72,153,0.55)', bg: 'rgba(236,72,153,0.11)' };
            if (fitness >= 80) return { main: '#f87171', glow: 'rgba(248,113,113,0.5)', bg: 'rgba(248,113,113,0.10)' };
            if (fitness >= 70) return { main: '#f97316', glow: 'rgba(249,115,22,0.45)', bg: 'rgba(249,115,22,0.09)' };
            if (fitness >= 60) return { main: '#fbbf24', glow: 'rgba(251,191,36,0.4)', bg: 'rgba(251,191,36,0.08)' };
            if (fitness >= 50) return { main: '#eab308', glow: 'rgba(234,179,8,0.38)', bg: 'rgba(234,179,8,0.07)' };
            if (fitness >= 40) return { main: '#84cc16', glow: 'rgba(132,204,22,0.35)', bg: 'rgba(132,204,22,0.07)' };
            if (fitness >= 30) return { main: '#22c55e', glow: 'rgba(34,197,94,0.32)', bg: 'rgba(34,197,94,0.06)' };
            if (fitness >= 20) return { main: '#06b6d4', glow: 'rgba(6,182,212,0.3)', bg: 'rgba(6,182,212,0.06)' };
            if (fitness >= 10) return { main: '#3b82f6', glow: 'rgba(59,130,246,0.28)', bg: 'rgba(59,130,246,0.05)' };
            return { main: '#6366f1', glow: 'rgba(99,102,241,0.25)', bg: 'rgba(99,102,241,0.04)' };
          };

          const getRangeGradient = (range) => {
            if (range >= 0.90) return { main: '#ec4899', glow: 'rgba(236,72,153,0.55)', bg: 'rgba(236,72,153,0.11)' };
            if (range >= 0.82) return { main: '#f87171', glow: 'rgba(248,113,113,0.5)', bg: 'rgba(248,113,113,0.10)' };
            if (range >= 0.70) return { main: '#fb923c', glow: 'rgba(251,146,60,0.45)', bg: 'rgba(251,146,60,0.09)' };
            if (range >= 0.55) return { main: '#fbbf24', glow: 'rgba(251,191,36,0.4)', bg: 'rgba(251,191,36,0.08)' };
            if (range >= 0.42) return { main: '#4ade80', glow: 'rgba(74,222,128,0.35)', bg: 'rgba(74,222,128,0.07)' };
            if (range >= 0.30) return { main: '#60a5fa', glow: 'rgba(96,165,250,0.3)', bg: 'rgba(96,165,250,0.06)' };
            return { main: '#94a3b8', glow: 'rgba(148,163,184,0.25)', bg: 'rgba(148,163,184,0.04)' };
          };

          return (
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-surface-2 rounded-lg p-4 col-span-2">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-white">守備分析 - ポジション配置</h2>
                  {selectedDefensePos && (
                    <div className="flex items-center gap-2">
                      <span className="text-yellow-400 text-sm font-bold">{posFullLabels[selectedDefensePos]}を選択中</span>
                      <span className="text-gray-300 text-xs">→ 交換先をクリック</span>
                      <button onClick={() => setSelectedDefensePos(null)} className="btn-secondary px-2 py-0.5 rounded text-xs">解除</button>
                    </div>
                  )}
                </div>
                {/* ⚠ 表示幅を固定しておくこと。実寸 = fontSize × (表示幅/500) なので、
                    max-w-2xl(672) だと 1280幅のとき列が 645px しか無く倍率が 1.29 に落ちて
                    fontSize 9 が 11.6px（12px未満）になる。600 に固定すれば倍率は常に 1.2。 */}
                <svg viewBox="0 -20 500 560" className="w-full max-w-[600px] mx-auto">
                  <defs>
                    {/* 各ポジションの守備範囲グラデーション（守備ランク色で表示） */}
                    {Object.entries(posCoords).map(([pos]) => {
                      const player = positionPlayers[pos];
                      const range = player ? getDefenseRange(player, pos) : 0;
                      const grad = getRangeGradient(range);
                      return (
                        <radialGradient key={`grad-${pos}-${player?.id || 'none'}`} id={`rangeGrad-${pos}`}>
                          <stop offset="0%" stopColor={grad.main} stopOpacity="0.35" />
                          <stop offset="60%" stopColor={grad.main} stopOpacity="0.12" />
                          <stop offset="100%" stopColor={grad.main} stopOpacity="0.02" />
                        </radialGradient>
                      );
                    })}
                    {/* マーカーの光彩フィルター */}
                    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <filter id="glowStrong" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    {/* テキスト影フィルター */}
                    <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.8" />
                    </filter>
                    <filter id="textShadowStrong" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="1" stdDeviation="3" floodColor="#000" floodOpacity="0.9" />
                    </filter>
                    {/* 芝のパターン */}
                    <pattern id="grassPattern" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
                      <rect width="8" height="8" fill="#1f5c33" />
                      <line x1="0" y1="4" x2="8" y2="4" stroke="#1a522d" strokeWidth="0.5" opacity="0.3" />
                    </pattern>
                  </defs>

                  {/* グラウンド背景（リッチ版） */}
                  <rect x="0" y="-20" width="500" height="490" fill="#142e1e" rx="12" />
                  <ellipse cx="250" cy="230" rx="230" ry="210" fill="url(#grassPattern)" />
                  {/* 外野の芝模様（同心弧） */}
                  {[140, 170, 200].map(r => (
                    <ellipse key={r} cx="250" cy="395" rx={r} ry={r} fill="none" stroke="#1a4a2c" strokeWidth="16" opacity="0.25" />
                  ))}
                  {/* 内野ダイヤモンド */}
                  <polygon points="250,200 350,275 250,350 150,275" fill="#8B6914" opacity="0.3" />
                  <polygon points="250,155 385,275 250,395 115,275" fill="none" stroke="#c4a35a" strokeWidth="1.5" strokeDasharray="6,3" opacity="0.45" />
                  {/* ファウルライン */}
                  <line x1="250" y1="395" x2="50" y2="210" stroke="#fff" strokeWidth="1.2" opacity="0.3" />
                  <line x1="250" y1="395" x2="450" y2="210" stroke="#fff" strokeWidth="1.2" opacity="0.3" />
                  {/* ベース */}
                  <rect x="244" y="389" width="12" height="12" fill="#fff" transform="rotate(45,250,395)" opacity="0.9" />
                  <rect x="379" y="269" width="10" height="10" fill="#fff" transform="rotate(45,384,274)" opacity="0.8" />
                  <rect x="245" y="189" width="10" height="10" fill="#fff" transform="rotate(45,250,194)" opacity="0.8" />
                  <rect x="110" y="269" width="10" height="10" fill="#fff" transform="rotate(45,115,274)" opacity="0.8" />
                  {/* マウンド */}
                  <ellipse cx="250" cy="290" rx="12" ry="8" fill="#8B6914" opacity="0.4" />

                  {/* 守備範囲の円（getDefenseRangeでサイズ、適正で色） */}
                  {Object.entries(posCoords).map(([pos, coord]) => {
                    const player = positionPlayers[pos];
                    if (!player) return null;
                    const range = getDefenseRange(player, pos);
                    const isOutfield = ['left', 'center', 'right'].includes(pos);
                    const baseRadius = isOutfield ? 55 : 35;
                    const radius = baseRadius * (0.15 + range * 1.3);
                    const grad = getRangeGradient(range);
                    const rangeDelay = `${Object.keys(posCoords).indexOf(pos) * 0.06}s`;
                    return (
                      <g key={`range-${pos}-${player.id}`}>
                        {/* 外側のぼかし円 */}
                        <circle cx={coord.x} cy={coord.y}
                          fill={grad.bg} stroke="none" opacity="0">
                          <animate attributeName="r" from="0" to={radius * 1.15} dur="0.7s" begin={rangeDelay} fill="freeze"
                            calcMode="spline" keySplines="0.25 0.46 0.45 0.94" />
                          <animate attributeName="opacity" from="0" to="0.6" dur="0.7s" begin={rangeDelay} fill="freeze" />
                        </circle>
                        {/* メインの守備範囲円 */}
                        <circle cx={coord.x} cy={coord.y}
                          fill={`url(#rangeGrad-${pos})`} stroke={grad.main}
                          strokeWidth="1.5" strokeDasharray="5,3" opacity="0">
                          <animate attributeName="r" from="0" to={radius} dur="0.6s" begin={rangeDelay} fill="freeze"
                            calcMode="spline" keySplines="0.25 0.46 0.45 0.94" />
                          <animate attributeName="opacity" from="0" to="0.9" dur="0.6s" begin={rangeDelay} fill="freeze" />
                        </circle>
                        {/* 内側の強調リング */}
                        <circle cx={coord.x} cy={coord.y} r={radius * 0.6}
                          fill="none" stroke={grad.main} strokeWidth="0.5" opacity="0.3"
                          strokeDasharray="3,5" />

                      </g>
                    );
                  })}

                  {/* 選手マーカー（クリック可能・アニメーション付き） */}
                  {Object.entries(posCoords).map(([pos, coord], posIndex) => {
                    const player = positionPlayers[pos];
                    const isSelected = selectedDefensePos === pos;
                    const fitness = player ? getFitness(player, pos) : 0;
                    const grad = getFitnessGradient(fitness);
                    const isPitcherPos = pos === 'pitcher';
                    const range = getDefenseRange(player, pos);
                    const grade = getRangeGrade(range);
                    // マーカーサイズ: 走力+守備力ベース
                    const def = player?.fielding?.defense || 50;
                    const spd = player?.physical?.speed || 50;
                    const markerSize = player ? 13 + ((spd * 0.5 + def * 0.5) / 100) * 8 : 14;
                    const animDelay = `${posIndex * 0.08}s`;

                    return (
                      <g key={pos} onClick={() => !isPitcherPos && handleDefenseClick(pos)}
                         style={{ cursor: isPitcherPos ? 'default' : 'pointer' }}>
                        {/* 選択リング */}
                        {isSelected && (
                          <>
                            <circle cx={coord.x} cy={coord.y} r={markerSize + 10} fill="none" stroke="#facc15" strokeWidth="2" opacity="0.25" />
                            <circle cx={coord.x} cy={coord.y} r={markerSize + 6} fill="none" stroke="#facc15" strokeWidth="2.5" strokeDasharray="5,3" />
                          </>
                        )}

                        {/* 光彩エフェクト（プレイヤー有の場合） */}
                        {player && !isSelected && (
                          <circle cx={coord.x} cy={coord.y} r={markerSize + 4}
                            fill="none" stroke={grad.main} strokeWidth="1" opacity="0.2" />
                        )}

                        {/* マーカー本体（グラデーション化・登場アニメーション） */}
                        <circle cx={coord.x} cy={coord.y}
                          fill={isSelected ? '#854d0e' : player ? '#1e3a5f' : '#2d3748'}
                          stroke={isSelected ? '#facc15' : player ? grad.main : '#4a5568'}
                          strokeWidth={isSelected ? 2.5 : 2}
                          filter={player ? 'url(#glow)' : undefined}
                          r={markerSize}>
                          <animate attributeName="r" from="0" to={markerSize} dur="0.4s" begin={animDelay} fill="freeze"
                            calcMode="spline" keySplines="0.34 0.80 0.64 1" />
                        </circle>
                        {/* マーカーのハイライト（立体感） */}
                        {player && (
                          <circle cx={coord.x - markerSize * 0.2} cy={coord.y - markerSize * 0.2}
                            r={markerSize * 0.5} fill="white" opacity="0.08" />
                        )}

                        {/* ポジションラベル */}
                        <text x={coord.x} y={coord.y + 1} textAnchor="middle" dominantBaseline="middle"
                          fill="white" fontSize={markerSize > 17 ? '15' : '13'} fontWeight="bold">{posLabels[pos]}</text>

                        {player && (
                          <>
                            {/* 選手名（影付き） */}
                            <text x={coord.x} y={coord.y - markerSize - 16} textAnchor="middle"
                              fill="white" fontSize="13" fontWeight="bold" filter="url(#textShadowStrong)">{player.name}</text>

                            {/* グレードバッジ */}
                            <circle cx={coord.x + markerSize + 3} cy={coord.y - markerSize + 1}
                              r="9" fill="#111827" stroke={grade.color === 'text-pink-400' ? '#ec4899' : grade.color === 'text-red-400' ? '#f87171' : grade.color === 'text-orange-400' ? '#fb923c' : grade.color === 'text-yellow-400' ? '#facc15' : grade.color === 'text-green-400' ? '#4ade80' : '#60a5fa'}
                              strokeWidth="1.5" />
                            <text x={coord.x + markerSize + 3} y={coord.y - markerSize + 2}
                              textAnchor="middle" dominantBaseline="middle"
                              fill={grade.color === 'text-pink-400' ? '#ec4899' : grade.color === 'text-red-400' ? '#f87171' : grade.color === 'text-orange-400' ? '#fb923c' : grade.color === 'text-yellow-400' ? '#facc15' : grade.color === 'text-green-400' ? '#4ade80' : '#60a5fa'}
                              fontSize="11" fontWeight="bold">{grade.label}</text>

                            {/* 適正バー（強化版） */}
                            <rect x={coord.x - 22} y={coord.y + markerSize + 8} width="44" height="6" rx="3" fill="#1f2937" stroke="#374151" strokeWidth="0.5" />
                            <rect x={coord.x - 22} y={coord.y + markerSize + 8} width={44 * fitness / 100} height="6" rx="3" fill={grad.main} opacity="0.85">
                              <animate attributeName="width" from="0" to={44 * fitness / 100} dur="0.6s" begin={animDelay} fill="freeze"
                                calcMode="spline" keySplines="0.25 0.46 0.45 0.94" />
                            </rect>
                            <text x={coord.x} y={coord.y + markerSize + 25} textAnchor="middle"
                              fill={grad.main} fontSize="10" fontWeight="bold" filter="url(#textShadow)">
                              適正{fitness}%
                            </text>

                            {/* 守力・走力の小アイコン */}
                            <text x={coord.x - 16} y={coord.y + markerSize + 37} textAnchor="middle"
                              fill="white" fontSize="10" fontWeight="bold" filter="url(#textShadow)">守{def}</text>
                            <text x={coord.x + 16} y={coord.y + markerSize + 37} textAnchor="middle"
                              fill="white" fontSize="10" fontWeight="bold" filter="url(#textShadow)">走{spd}</text>
                          </>
                        )}
                        {!player && (
                          <text x={coord.x} y={coord.y - 22} textAnchor="middle" fill="#abb9cf" fontSize="12" filter="url(#textShadow)">未配置</text>
                        )}
                      </g>
                    );
                  })}

                  {/* 凡例 */}
                  <g transform="translate(10, 510)">
                    <text x="0" y="0" fill="white" fontSize="10" fontWeight="bold" filter="url(#textShadow)">適正:</text>
                    {[
                      { label: '100', color: '#ff1493' }, { label: '90', color: '#ec4899' }, { label: '80', color: '#f87171' },
                      { label: '70', color: '#f97316' }, { label: '60', color: '#fbbf24' }, { label: '50', color: '#eab308' },
                      { label: '40', color: '#84cc16' }, { label: '30', color: '#22c55e' }, { label: '20', color: '#06b6d4' },
                      { label: '10', color: '#3b82f6' }, { label: '0', color: '#6366f1' }
                    ].map((item, i) => (
                      <g key={i} transform={`translate(${35 + i * 40}, 0)`}>
                        <circle cx="0" cy="-3" r="5" fill={item.color} opacity="0.8" />
                        <text x="8" y="0" fill="white" fontSize="10" filter="url(#textShadow)">{item.label}</text>
                      </g>
                    ))}
                  </g>
                </svg>
                <p className="text-xs text-gray-400 mt-2 text-center">
                  ポジションをクリックして選択 → 交換先をクリックで守備位置を入れ替え（投手は変更不可）
                </p>
              </div>

              {/* 右側: 守備力サマリー + 適正 */}
              <div className="bg-surface-2 rounded-lg p-4 col-span-1">
                <h2 className="text-lg font-bold text-white mb-3">守備力サマリー</h2>
                <div className="space-y-1.5">
                  {Object.entries(posCoords).map(([pos]) => {
                    const player = positionPlayers[pos];
                    const range = getDefenseRange(player, pos);
                    const grade = getRangeGrade(range);
                    const fitness = player ? getFitness(player, pos) : 0;
                    const fitColor = fitness >= 100 ? 'text-pink-500' : fitness >= 90 ? 'text-pink-400' : fitness >= 80 ? 'text-red-400' : fitness >= 70 ? 'text-orange-400' : fitness >= 60 ? 'text-amber-400' : fitness >= 50 ? 'text-yellow-400' : fitness >= 40 ? 'text-lime-400' : fitness >= 30 ? 'text-green-400' : fitness >= 20 ? 'text-cyan-400' : fitness >= 10 ? 'text-blue-400' : 'text-indigo-400';
                    const isSelected = selectedDefensePos === pos;
                    const isPitcherPos = pos === 'pitcher';

                    return (
                      <div key={pos}
                        onClick={() => !isPitcherPos && handleDefenseClick(pos)}
                        className={`rounded p-2 transition cursor-pointer ${isSelected ? 'bg-yellow-900 ring-1 ring-yellow-400' : 'bg-gray-700 hover:bg-gray-600'} ${isPitcherPos ? 'cursor-default opacity-60' : ''}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-blue-400 font-bold w-7 text-center text-base">{posLabels[pos]}</span>
                            <span className="text-white text-base font-bold">{player?.name || '-'}</span>
                          </div>
                          {player && <span className={`font-bold text-xl ${grade.color}`}>{grade.label}</span>}
                        </div>
                        {player && (
                          <div className="flex items-center justify-between mt-1">
                            <div className="flex items-center gap-2.5 text-sm">
                              <span className="text-white">守<span className={getRankColor(getAbilityRank(player.fielding?.defense || 0))}>{player.fielding?.defense || 0}</span></span>
                              <span className="text-white">走<span className={getRankColor(getAbilityRank(player.physical?.speed || 0))}>{player.physical?.speed || 0}</span></span>
                              <span className="text-white">肩<span className={getRankColor(getAbilityRank(player.physical?.arm || 0))}>{player.physical?.arm || 0}</span></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className="w-14 h-2.5 bg-gray-600 rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${fitness}%`, backgroundColor: getFitnessColor(fitness) }} />
                              </div>
                              <span className={`text-sm font-bold ${fitColor}`}>{fitness}%</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* 選択中ポジションの交換候補 */}
                {selectedDefensePos && selectedPosSwapCandidates.length > 0 && (
                  <div className="mt-3 bg-surface-1 rounded p-3">
                    <div className="text-yellow-400 text-sm font-bold mb-2">{posFullLabels[selectedDefensePos]}と交換:</div>
                    <div className="space-y-1">
                      {selectedPosSwapCandidates.map(({ player, entry }) => {
                        const targetFitness = getFitness(player, selectedDefensePos);
                        const currentFitness = getFitness(player, entry.position);
                        const diff = targetFitness - currentFitness;
                        return (
                          <div key={player.id} onClick={() => handleDefenseClick(entry.position)}
                            className="bg-gray-700 hover:bg-gray-600 rounded px-2 py-1.5 cursor-pointer flex items-center justify-between text-sm">
                            <span className="text-white font-bold">{posLabels[entry.position]} {player.name}</span>
                            <span className={`font-bold ${diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              適正{targetFitness}% ({diff >= 0 ? '+' : ''}{diff})
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* チーム守備総合評価 */}
                {(() => {
                  const allRanges = Object.keys(posCoords).map(pos => getDefenseRange(positionPlayers[pos], pos)).filter(r => r > 0);
                  const avgRange = allRanges.length > 0 ? allRanges.reduce((a, b) => a + b, 0) / allRanges.length : 0;
                  const teamGrade = getRangeGrade(avgRange);
                  return (
                    <div className="mt-3 bg-surface-1 rounded p-3 text-center">
                      <div className="text-white text-base font-bold mb-1">チーム守備総合</div>
                      <div className={`text-4xl font-bold ${teamGrade.color}`}>{teamGrade.label}</div>
                      <div className="text-gray-300 text-sm mt-1">平均実効守備力: {Math.round(avgRange * 100)}</div>
                    </div>
                  );
                })()}
              </div>

              {/* デプスチャート */}
              <div className="bg-surface-2 rounded-lg p-4 col-span-3 mt-4">
                <h2 className="text-lg font-bold text-white mb-3">デプスチャート</h2>
                <div className="grid grid-cols-4 gap-3">
                  {fieldPositions.map(pos => {
                    const starter = positionPlayers[pos];
                    const starterId = starter?.id;
                    const candidates = team.players
                      .filter(p => {
                        if (p.position === 'pitcher') return false;
                        if (p.id === starterId) return false;
                        return (p.positionFitness?.[pos] ?? 0) >= 30;
                      })
                      .map(p => ({ player: p, fitness: p.positionFitness?.[pos] ?? 0 }))
                      .sort((a, b) => b.fitness - a.fitness)
                      .slice(0, 4);
                    const starterFitness = starter ? getFitness(starter, pos) : 0;
                    const depthFitColor = (f) => f >= 100 ? 'text-pink-400' : f >= 80 ? 'text-red-400' : f >= 60 ? 'text-amber-400' : f >= 40 ? 'text-lime-400' : 'text-gray-300';
                    return (
                      <div key={pos} className="bg-gray-900/60 rounded-lg p-2.5 border border-gray-700/40">
                        <div className="text-sm font-bold text-blue-400 mb-1.5">{posFullLabels[pos]}</div>
                        {starter ? (
                          <div className="flex items-center justify-between bg-gray-700/50 rounded px-2 py-1 mb-1.5">
                            <span className="text-white font-bold text-sm truncate">{starter.name}</span>
                            <span className={`text-xs font-bold ${depthFitColor(starterFitness)}`}>{starterFitness}%</span>
                          </div>
                        ) : (
                          <div className="bg-gray-700/30 rounded px-2 py-1 mb-1.5 text-gray-400 text-sm">未配置</div>
                        )}
                        {candidates.length > 0 ? candidates.map(({ player: cp, fitness: cf }) => {
                          const inLineup = lineup.some(e => e.playerId === cp.id && e.battingOrder >= 1 && e.battingOrder <= maxFielderSlots);
                          return (
                            <div key={cp.id} className="flex items-center justify-between px-2 py-0.5 text-xs">
                              <span className={`truncate ${inLineup ? 'text-yellow-300' : 'text-gray-300'}`}>
                                {inLineup && <span className="text-yellow-500 mr-0.5">*</span>}{cp.name}
                              </span>
                              <span className={`font-bold ${depthFitColor(cf)}`}>{cf}%</span>
                            </div>
                          );
                        }) : (
                          <div className="text-gray-400 text-xs px-2 py-0.5">候補なし</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-2">適正30%以上の控え候補を適正順に表示。<span className="text-yellow-400">*</span>はスタメン出場中の選手。</p>
              </div>
            </div>
          );
        })()}

        {/* ポジション変更モーダル（全タブ共通） */}
        {posConvertPlayer && (
          <PosConvertModal player={posConvertPlayer} onClose={() => setPosConvertPlayer(null)} />
        )}

        {/* 選手詳細モーダル（全タブ共通） */}
        {detailPlayer && detailPlayer !== '__compare__' && (
          <PlayerDetailModal player={detailPlayer} onClose={() => setDetailPlayer(null)} />
        )}

        {/* 選手比較モーダル */}
        {detailPlayer === '__compare__' && compareIds.length >= 2 && (
          <CompareModal playerIds={compareIds} onClose={() => setDetailPlayer(null)} />
        )}
    </ScreenShell>
  );
};

const LineupSettingScreen = ({ teamName, onBack }) => {
  const team = TEAMS_DATA[teamName];
  if (!team) return <div className="p-8 text-white">チームが見つかりません</div>;
  return <LineupSettingContent teamName={teamName} onBack={onBack} team={team} />;
};

export default LineupSettingScreen;
