import React, { useState, useEffect, useRef } from 'react';
import { TEAMS_DATA, LEAGUE_SETTINGS } from '../teams-data.js';
import { POSITION_NAMES, getAbilityRank, getRankColor, FORM_SHORT } from '../utils/constants.js';
import { getPitchTypeName } from '../season/yearProgressionSystem.js';
import { CONDITION_LEVELS, CONDITION_COLORS, CONDITION_ICONS } from '../game/condition.js';
import { generateOptimalLineup, REST_POLICIES, DEFAULT_REST_POLICY } from '../game/lineupGenerator.js';

/** 「疲労を見る」の4段の説明（実測の目安。`solo-lineup-board-check` で固定） */
const REST_POLICY_HINT = {
  none: '疲労では外さない（疲れた選手の打撃の目減りだけは残る）',
  low: '控えめ。控えより一段上の主力なら疲労55まで出し続ける',
  normal: '標準。控えより一段上の主力を疲労40で休ませる',
  high: '積極的。疲労25で休ませる。主力を温存したいときに',
};
import { TabBar } from './GameUIComponents.jsx';
import TutorialHint from './TutorialHint.jsx';
import SoloLineupBoard from './lineup/SoloLineupBoard.jsx';
import SoloPitchingBoard from './lineup/SoloPitchingBoard.jsx';
import { ScreenShell, ScreenHeader } from './GameUIComponents.jsx';
import { ensureTeamJerseyNumbers } from '../utils/jerseyNumbers.js';
import { defenseRange, defenseGrade } from '../utils/defenseRange.js';
import { naturalGrowthOf, naturalGrowthText, naturalGrowthColor } from '../utils/naturalGrowth.js';


// ---- 元に戻す / やり直し 用の控え ----
// この画面が書き換えるのは「打順と守備（lineupSettings）」「投手の役割と登板順
// （pitchingRotation）」と、選手側の登録位置・旧形式の打順・DH印・球種の封印。
// ⚠ ここに無い項目を画面で書き換えるようにしたら、ここにも足すこと（戻らなくなる）
const HISTORY_LIMIT = 100;
const snapshotRoster = (team) => JSON.stringify({
  ls: team.lineupSettings || null,
  pr: team.pitchingRotation || null,
  pl: (team.players || []).map(p => [
    // ⚠ 球種は `player.pitching.arsenal`（`player.arsenal` ではない）
    p.id, p.position, p.battingOrder ?? null, !!p._isDH, (p.pitching?.arsenal || []).map(a => !!a.sealed),
  ]),
});
const replaceContents = (target, source) => {
  Object.keys(target).forEach(k => { delete target[k]; });
  Object.assign(target, source || {});
};
const restoreRoster = (team, json) => {
  const s = JSON.parse(json);
  // ⚠ 打順の配列は**同じ配列のまま中身を入れ替える**。新しい配列にすると、
  //    参照を握っている側（一人用の TEAMS_DATA を読む処理）とずれる（lineupGenerator と同じ注意）
  if (!team.lineupSettings) team.lineupSettings = {};
  const order = Array.isArray(team.lineupSettings.battingOrder) ? team.lineupSettings.battingOrder : [];
  replaceContents(team.lineupSettings, s.ls);
  order.splice(0, order.length, ...(s.ls?.battingOrder || []));
  team.lineupSettings.battingOrder = order;
  if (!team.pitchingRotation) team.pitchingRotation = {};
  replaceContents(team.pitchingRotation, s.pr);
  const byId = new Map(s.pl.map(row => [row[0], row]));
  (team.players || []).forEach(p => {
    const row = byId.get(p.id);
    if (!row) return;
    const [, position, battingOrder, isDH, sealed] = row;
    p.position = position;
    if (battingOrder === null) delete p.battingOrder; else p.battingOrder = battingOrder;
    if (isDH) p._isDH = true; else delete p._isDH;
    (p.pitching?.arsenal || []).forEach((a, i) => { if (sealed[i]) a.sealed = true; else delete a.sealed; });
  });
};

// 埋め込むとき（`embedded`）の枠。外側の ScreenShell の中に入るので余白を足さない
const EmbeddedShell = ({ children }) => <div>{children}</div>;

const HistoryButtons = ({ canUndo, canRedo, undo, redo }) => (
  <>
    <button type="button" onClick={undo} disabled={!canUndo} title="元に戻す（Ctrl+Z）"
      className="btn-secondary px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40">元に戻す</button>
    <button type="button" onClick={redo} disabled={!canRedo} title="やり直す（Ctrl+Shift+Z）"
      className="btn-secondary px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40">やり直す</button>
  </>
);

// 一人用のロスター管理（スタメン設定・投手起用・守備分析）。
// ⚠ オンラインはこの画面を使わない。PC版もスマホ版も `src/online/LineupBoard.jsx`・
//    `PitchingBoard.jsx`（スマホの打順は `TapLineup.jsx`）。以前はオンラインのスマホ版が
//    投手起用のためにここの従来の画面（約1000行）を使っていたが、PCと同じ表に置き換えて消した。
// ⚠ `team` はプロップで受け取り、その場で書き換える（`TEAMS_DATA` を直に読まないこと）。
// `embedded`: 一人用の大学のロスター管理（RosterScreen）のタブの中に置くとき。外側が枠と見出しを
//   持つので、ここでは枠（ScreenShell）と見出しを出さず、元に戻す・やり直すだけを右に置く。
//   ⚠ 以前は外と中に「ロスター管理」の見出しが2つ並び、枠の余白も二重で控えの表の右が切れていた
/**
 * スタメンの「自動: 標準/打撃重視/守備重視」と「疲労を見る」の4段。
 * ⚠ 【疲れをどれだけ気にするか】いしだ 2026-11-22「もっと敏感に、疲労を感じ取ってほしいです。
 *    設定方法もスタメン設定でできるように」。選んだ値は球団に残り（`team.restPolicy`）、
 *    「自動」が次からそれで組む。
 * ⚠ 疲れた選手の**打撃の目減り**はどの設定でも掛かる（実際に起きることなので好みの問題に
 *    しない）。ここで変わるのは「誰をスタメンから外すか」だけ。
 */
const AutoLineupControls = ({ team, teamName, onDone }) => {
  const currentKey = team.restPolicy || DEFAULT_REST_POLICY;
  return (
    <>
      <div className="flex gap-1 mt-2">
        {[
          { mode: 'standard', label: '標準' },
          { mode: 'offense', label: '打撃重視' },
          { mode: 'defense', label: '守備重視' },
        ].map(({ mode, label }) => (
          <button key={mode} type="button" onClick={() => {
            generateOptimalLineup(teamName, mode, team);
            onDone();
          }} className="btn-secondary text-xs px-2 py-1 rounded font-medium transition">
            自動: {label}
          </button>
        ))}
      </div>
      <>
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          <span className="text-xs text-gray-400 shrink-0">疲労を見る:</span>
          {Object.entries(REST_POLICIES).map(([key, { label }]) => (
            <button
              key={key}
              type="button"
              aria-pressed={currentKey === key}
              title={REST_POLICY_HINT[key]}
              onClick={() => {
                team.restPolicy = key;
                if (TEAMS_DATA[teamName]) TEAMS_DATA[teamName].restPolicy = key;
                onDone();
              }}
              className={`text-xs px-2 py-1 rounded font-medium transition border ${
                currentKey === key
                  ? 'bg-cyan-700 text-white border-cyan-500'
                  : 'bg-surface-2 text-gray-300 border-gray-600 hover:border-gray-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1 leading-snug">{REST_POLICY_HINT[currentKey]}</p>
      </>
    </>
  );
};

const LineupSettingContent = ({
  teamName,
  onBack,
  team,
  embedded = false,
}) => {
  const [tab, setTab] = useState('lineup');
  const [updateTrigger, setUpdateTrigger] = useState(0);
  const [selectedDefensePos, setSelectedDefensePos] = useState(null);
  const [posConvertPlayer, setPosConvertPlayer] = useState(null); // ポジション変更モーダル対象
  const [detailPlayer, setDetailPlayer] = useState(null); // 選手詳細モーダル対象
  // 守備分析のドラッグ（守備位置どうしの入れ替え）。{ from, over }
  const [defenseDrag, setDefenseDrag] = useState(null);
  const defenseDragRef = useRef(null);
  const suppressDefenseClickRef = useRef(false);

  ensureTeamJerseyNumbers(team); // 背番号を（未設定なら）割り当て

  const getVelocityRank = (velocity) => getAbilityRank(velocity, true);

  const getThrowsLabel = (throws) => throws === 'left' ? '左投' : '右投';
  const getBatsLabel = (bats) => bats === 'left' ? '左打' : bats === 'switch' ? '両打' : '右打';

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
  const pitcherEntry = lineup.find(e => e.position === 'pitcher' && e.battingOrder === 9);
  const rotationStarters = team.pitchingRotation?.starters || [];
  const nextStarterId = rotationStarters.length
    ? rotationStarters[(team.pitchingRotation.currentStarterIndex || 0) % rotationStarters.length]
    : pitcherEntry?.playerId;
  const nextStarter = team.players.find(p => p.id === nextStarterId && p.position === 'pitcher' && p.isActive !== false)
    || team.players.find(p => p.id === pitcherEntry?.playerId && p.position === 'pitcher' && p.isActive !== false);

  // isActive=falseの選手（練習生）は除外。未設定は全員有効（大学モード以外）
  const pitchers = team.players.filter(p => p.position === 'pitcher' && p.isActive !== false);

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

  // ---- 元に戻す / やり直し ----
  // この画面は `team` をその場で書き換え、そのたびに `setUpdateTrigger` を呼ぶ。
  // 呼ばれた後の描画で「編成に関わる部分」の控えを取り、直前と違えば履歴に積む。
  // ⚠ 1回の操作の中で何度呼ばれても（役割の付け替え＋コンバート等）描画は1回なので1手になる。
  //    「自動設定」「全員おまかせ」「自動: 標準」のような一括操作も1手として戻せる
  // ⚠ 上の初期化（投手枠の自動設定）より後に宣言すること。起点にその結果を含めるため
  const historyRef = useRef({ stack: [], index: -1, base: null });
  // 履歴が動いたら描き直す（元に戻す・やり直すの押せる・押せないを更新する）
  const [, setHistoryTick] = useState(0);
  useEffect(() => {
    const h = historyRef.current;
    const snap = snapshotRoster(team);
    if (h.index < 0) {
      h.stack = [snap];
      h.index = 0;
      h.base = snap;
      setHistoryTick(t => t + 1);
      return;
    }
    if (snap === h.stack[h.index]) return; // 戻した直後、または何も変わっていない
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push(snap);
    if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
    h.index = h.stack.length - 1;
    setHistoryTick(t => t + 1);
  }, [updateTrigger, team]);

  const clearSelections = () => {
    setSelectedDefensePos(null);
    defenseDragRef.current = null; // ドラッグの途中で Esc → 離しても入れ替えない
    setDefenseDrag(null);
  };
  const stepHistory = (delta) => {
    const h = historyRef.current;
    const next = h.index + delta;
    if (next < 0 || next >= h.stack.length) return;
    h.index = next;
    restoreRoster(team, h.stack[next]);
    clearSelections();
    setUpdateTrigger(prev => prev + 1);
    setHistoryTick(t => t + 1);
  };
  const undo = () => stepHistory(-1);
  const redo = () => stepHistory(1);
  const historyState = historyRef.current;
  const canUndo = historyState.index > 0;
  const canRedo = historyState.index >= 0 && historyState.index < historyState.stack.length - 1;
  const keyActionsRef = useRef(null);
  keyActionsRef.current = { undo, redo, cancel: clearSelections };
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      // ⚠ 文字の入力欄では効かせない（入力欄自身の元に戻すを奪わない）
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) keyActionsRef.current.redo();
        else keyActionsRef.current.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        keyActionsRef.current.redo();
      } else if (e.key === 'Escape') {
        keyActionsRef.current.cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

    // `colorClass` は能力値でない数（自然成長）のため。能力のランクの色で塗ると全部「F」の灰色になる
    const StatBox = ({ label, value, isVelocity, isStamina, highlight, colorClass }) => {
      const rank = isVelocity ? getVelocityRank(value) : getAbilityRank(value, false, isStamina);
      return (
        <div className={`text-center px-1 py-1 rounded ${highlight ? 'bg-gray-600/40' : ''}`}>
          <div className="text-xs text-gray-400">{label}</div>
          <div className={`text-sm font-bold ${colorClass || getRankColor(rank)}`}>{value}</div>
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
              <button
                onClick={() => { onClose(); setPosConvertPlayer(player); }}
                className="px-1.5 py-0.5 text-xs font-bold rounded bg-gray-700 hover:bg-gray-600 border border-gray-600 hover:border-blue-500 text-gray-300 hover:text-blue-300 transition"
              >変更</button>
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
                    const canSeal = (sealed || (p.arsenal || []).filter(x => !x.sealed).length > 1);
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
                {/* ⚠ 素質（`growthPotential`）そのままの「成長率 ×1.20」は年齢が入らず、
                    30代でも大きく出ていた。契約更改・キャンプ・選手情報と同じ
                    「来季の自然成長」に揃える（`src/utils/naturalGrowth.js`） */}
                <StatBox label="自然成長" value={naturalGrowthText(naturalGrowthOf(player, team))}
                  colorClass={naturalGrowthColor(naturalGrowthOf(player, team))} />
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
    closer:     { label: 'クローザー', color: 'bg-purple-600', textColor: 'text-purple-300', group: 'relief' },
  };

  const Shell = embedded ? EmbeddedShell : ScreenShell;
  return (
    <Shell>
            {embedded ? (
              <div className="flex justify-end mb-2">
                <HistoryButtons canUndo={canUndo} canRedo={canRedo} undo={undo} redo={redo} />
              </div>
            ) : (
            <ScreenHeader title="ロスター管理" sub={teamName}
              right={(
                <>
                  <HistoryButtons canUndo={canUndo} canRedo={canRedo} undo={undo} redo={redo} />
                  {onBack && <button onClick={onBack} className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium">← 戻る</button>}
                </>
              )} />
            )}

            {/* タブナビゲーション */}
            <TabBar
              tabs={[
                { key: 'lineup',   label: 'スタメン設定', icon: '👥' },
                { key: 'rotation', label: '投手起用',     icon: '⚾' },
                { key: 'defense',  label: '守備分析',     icon: '🛡' },
              ]}
              activeKey={tab}
              onChange={(key) => { setTab(key); clearSelections(); }}
              className="mb-4"
            />

        {/* スタメン設定は、オンラインPC版と同じ1枚の表（`lineup/SoloLineupBoard.jsx`） */}
        {tab === 'lineup' && (
          <>
          <TutorialHint id="lineup-playing-time" title="起用は育成でもある">
            <b className="text-cyan-200">試合に出た選手ほど伸びます。</b>1年フル出場した若手は、ほとんど出番の無かった選手の<b className="text-cyan-200">2倍以上</b>成長します（実測: 300打席で能力合計 +12.7 に対し、0打席では +5.8）。
            いま勝つために主力を並べるか、数年後のために若手を我慢して使うか——<b className="text-cyan-200">スタメンを決めることは育成方針を決めること</b>でもあります。
          </TutorialHint>
          {/* ⚠ 一人用の表にも「自動」と「疲労を見る」を置く（いしだ 2026-11-23 の判断カード
              「スタメン表に自動を出す」）。11-04 に外した自動ボタンを一人用では戻した。
              表（`.online-embed`）の中に Tailwind の部品は入れられないので、表の上に置く */}
          <div className="mb-3 rounded-xl border border-gray-700/50 bg-surface-2 px-4 py-3" data-testid="solo-auto-lineup">
            <AutoLineupControls
              team={team}
              teamName={teamName}
              onDone={() => setUpdateTrigger(prev => prev + 1)}
            />
          </div>
          <SoloLineupBoard
            team={team}
            useDH={useDH}
            nextStarter={nextStarter}
            onChange={() => setUpdateTrigger(prev => prev + 1)}
            onOpen={setDetailPlayer}
            resetKey={historyState.index}
          />
          </>
        )}
        {/* 投手起用も、オンラインPC版と同じ1枚の表（`lineup/SoloPitchingBoard.jsx`） */}
        {tab === 'rotation' && (
          <>
          <TutorialHint id="rotation-board" title="投手の役割を決める">
            全投手を<b className="text-cyan-200">1枚の表</b>に、先発ローテ（登板順）→ 救援（使われる場面の順）→ 役割なし と並べています。
            役割の札を押すと役割を選び直せます。行を選んでほかの行を押すと、登板順や役割を入れ替えます。先発は5〜6人、クローザーは1人が目安です。
          </TutorialHint>
          <SoloPitchingBoard
            team={team}
            onChange={() => setUpdateTrigger(prev => prev + 1)}
            onOpen={setDetailPlayer}
            resetKey={historyState.index}
          />
          </>
        )}
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

          // 守備範囲の計算（守備力+走力ベース × 適正補正）。
          // ⚠ 計算はオンラインの守備図と共通（`src/utils/defenseRange.js`）
          const getDefenseRange = (player, pos) =>
            defenseRange(player, pos, getFitness(player, pos));

          const posLabels = {
            pitcher: '投', catcher: '捕', first: '一', second: '二',
            short: '遊', third: '三', left: '左', center: '中', right: '右'
          };
          const posFullLabels = {
            pitcher: '投手', catcher: '捕手', first: '一塁', second: '二塁',
            short: '遊撃', third: '三塁', left: '左翼', center: '中堅', right: '右翼'
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

          // ランクの境目はオンラインの守備図と共通（`defenseGrade`）
          const RANGE_GRADE_TEXT = {
            S: 'text-pink-400', A: 'text-red-400', B: 'text-orange-400', C: 'text-yellow-400',
            D: 'text-green-400', E: 'text-blue-400', F: 'text-slate-400',
          };
          const getRangeGrade = (range) => {
            const { label } = defenseGrade(range);
            return { label, color: RANGE_GRADE_TEXT[label] };
          };

          // 2つの守備位置を入れ替える（片方が空きなら、いる側がそこへ移る）
          const swapDefense = (posA, posB) => {
            if (!posA || !posB || posA === posB || posA === 'pitcher' || posB === 'pitcher') return;
            const inField = (e) => e.battingOrder >= 1 && e.battingOrder <= maxFielderSlots;
            const entry1 = lineup.find(e => e.position === posA && inField(e));
            const entry2 = lineup.find(e => e.position === posB && inField(e));
            if (entry1) entry1.position = posB;
            if (entry2) entry2.position = posA;
            setUpdateTrigger(prev => prev + 1);
          };

          // 守備位置クリック → 選択 or スワップ。
          // ⚠ 取り消しは「同じ選手をもう一度クリック」「Esc」「何も無いところをクリック」。
          //    以前あった「解除」ボタンは使われないので無くした
          const handleDefenseClick = (pos) => {
            if (suppressDefenseClickRef.current) return; // ドラッグを終えた直後のクリックは無視
            if (pos === 'pitcher') return; // 投手は変更不可
            if (!selectedDefensePos) {
              setSelectedDefensePos(pos);
            } else if (selectedDefensePos === pos) {
              setSelectedDefensePos(null);
            } else {
              swapDefense(selectedDefensePos, pos);
              setSelectedDefensePos(null);
            }
          };

          // ドラッグで入れ替え。⚠ SVG の要素はブラウザ標準のドラッグ（draggable）が効かないので、
          //    ポインターの動きを自前で追い、離した位置にある `data-defpos` を探す。
          //    ダイヤモンドの上と右の一覧のどちらからどちらへでも動かせる
          // ⚠ 右の一覧はタッチでは動かさない（指で縦に送れなくなる）。タッチはタップで選ぶ
          const findDefensePos = (ev) => {
            const el = document.elementFromPoint(ev.clientX, ev.clientY);
            const pos = el?.closest?.('[data-defpos]')?.getAttribute('data-defpos');
            return pos && pos !== 'pitcher' ? pos : null;
          };
          const startDefenseDrag = (pos, e, { allowTouch = true } = {}) => {
            if (pos === 'pitcher' || !positionPlayers[pos]) return;
            if (e.button !== undefined && e.button !== 0) return;
            if (!allowTouch && e.pointerType === 'touch') return;
            defenseDragRef.current = { from: pos, x: e.clientX, y: e.clientY, moved: false, over: undefined };
            const stop = () => {
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
              window.removeEventListener('pointercancel', onCancel);
            };
            const onMove = (ev) => {
              const d = defenseDragRef.current;
              if (!d) { stop(); return; }
              if (!d.moved && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 6) return;
              d.moved = true;
              const over = findDefensePos(ev);
              if (over !== d.over) {
                d.over = over;
                setDefenseDrag({ from: d.from, over: over && over !== d.from ? over : null });
              }
            };
            const onUp = (ev) => {
              stop();
              const d = defenseDragRef.current;
              defenseDragRef.current = null;
              if (!d?.moved) return; // 動かしていない＝ただのクリック（onClick に任せる）
              setDefenseDrag(null);
              suppressDefenseClickRef.current = true;
              setTimeout(() => { suppressDefenseClickRef.current = false; }, 0);
              const target = findDefensePos(ev);
              if (target && target !== d.from) {
                swapDefense(d.from, target);
                setSelectedDefensePos(null);
              }
            };
            const onCancel = () => {
              stop();
              defenseDragRef.current = null;
              setDefenseDrag(null);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onCancel);
          };

          // 入れ替えたときの適性の変化。ドラッグ中は「元 → 先」、選んだだけなら元の側だけ
          const swapPreview = (() => {
            const from = defenseDrag?.from || selectedDefensePos;
            if (!from) return null;
            const to = defenseDrag ? defenseDrag.over : null;
            const sides = [{ pos: from, to }];
            if (to) sides.push({ pos: to, to: from });
            return sides.map(({ pos, to: dest }) => {
              const player = positionPlayers[pos] || null;
              return {
                pos,
                dest,
                player,
                now: player ? getFitness(player, pos) : null,
                next: player && dest ? getFitness(player, dest) : null,
              };
            });
          })();
          const fitnessChange = (side) => (
            <span className="inline-flex items-baseline gap-1 tabular-nums">
              <span className="text-gray-300">{posLabels[side.pos]}</span>
              <span className="font-bold text-white">{side.now}%</span>
              {side.dest && (
                <>
                  <span className="text-gray-400">→</span>
                  <span className="text-gray-300">{posLabels[side.dest]}</span>
                  <span className={`font-bold ${side.next >= side.now ? 'text-green-400' : 'text-red-400'}`}>{side.next}%</span>
                </>
              )}
            </span>
          );

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

          // 適正に基づくグラデーション色（10刻み）。text は図の上の「適正N%」の字の色。
          // ⚠ 字は main（濃い原色）にしないこと。芝（#1f5c33）の上で deep pink が 2.2:1、
          //    赤・橙でも 2.9:1 で読めなかった。同じ色相の淡い段（Tailwind の *-100〜300）にして
          //    芝の上で 4.7〜6.8:1（AA 4.5 を確保。字の影も付く）。*-300 でも pink・red・blue・indigo は
          //    4.0〜4.4 で足りないので、その4つは *-200（100% だけ pink-100）。バーと円の色は main のまま
          const getFitnessGradient = (fitness) => {
            if (fitness >= 100) return { main: '#ff1493', text: '#fce7f3', glow: 'rgba(255,20,147,0.6)', bg: 'rgba(255,20,147,0.12)' };
            if (fitness >= 90) return { main: '#ec4899', text: '#fbcfe8', glow: 'rgba(236,72,153,0.55)', bg: 'rgba(236,72,153,0.11)' };
            if (fitness >= 80) return { main: '#f87171', text: '#fecaca', glow: 'rgba(248,113,113,0.5)', bg: 'rgba(248,113,113,0.10)' };
            if (fitness >= 70) return { main: '#f97316', text: '#fdba74', glow: 'rgba(249,115,22,0.45)', bg: 'rgba(249,115,22,0.09)' };
            if (fitness >= 60) return { main: '#fbbf24', text: '#fcd34d', glow: 'rgba(251,191,36,0.4)', bg: 'rgba(251,191,36,0.08)' };
            if (fitness >= 50) return { main: '#eab308', text: '#fde047', glow: 'rgba(234,179,8,0.38)', bg: 'rgba(234,179,8,0.07)' };
            if (fitness >= 40) return { main: '#84cc16', text: '#bef264', glow: 'rgba(132,204,22,0.35)', bg: 'rgba(132,204,22,0.07)' };
            if (fitness >= 30) return { main: '#22c55e', text: '#86efac', glow: 'rgba(34,197,94,0.32)', bg: 'rgba(34,197,94,0.06)' };
            if (fitness >= 20) return { main: '#06b6d4', text: '#67e8f9', glow: 'rgba(6,182,212,0.3)', bg: 'rgba(6,182,212,0.06)' };
            if (fitness >= 10) return { main: '#3b82f6', text: '#bfdbfe', glow: 'rgba(59,130,246,0.28)', bg: 'rgba(59,130,246,0.05)' };
            return { main: '#6366f1', text: '#c7d2fe', glow: 'rgba(99,102,241,0.25)', bg: 'rgba(99,102,241,0.04)' };
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
            <div className="grid grid-cols-3 gap-4"
              onClick={(e) => {
                // 何も無いところをクリック → 選択を取り消す
                if (selectedDefensePos && !e.target.closest?.('[data-defpos]')) setSelectedDefensePos(null);
              }}>
              <div className="bg-surface-2 rounded-lg p-4 col-span-2">
                <div className="flex items-center justify-between gap-3 mb-4 min-h-[1.75rem]">
                  <h2 className="text-xl font-bold text-white shrink-0">守備分析 - ポジション配置</h2>
                  {/* 入れ替えたときの適性（自分の今の位置 → 入れ替え先）を2人分並べる */}
                  {swapPreview ? (
                    <div className="flex items-center gap-2 flex-wrap justify-end text-sm" aria-live="polite">
                      {swapPreview.map((side, i) => (
                        <React.Fragment key={side.pos}>
                          {i > 0 && <span className="text-yellow-400 font-bold">⇄</span>}
                          <span className="inline-flex items-baseline gap-1.5">
                            <span className="text-yellow-300 font-bold">{side.player?.name || '（空き）'}</span>
                            {side.player && fitnessChange(side)}
                          </span>
                        </React.Fragment>
                      ))}
                      {!defenseDrag?.over && (
                        <span className="text-gray-300 text-xs">→ 入れ替え先をクリックかドラッグ（Esc で取り消し）</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-400 text-xs">選手をドラッグして守備位置を入れ替え</span>
                  )}
                </div>
                {/* ⚠ 表示幅を固定しておくこと。実寸 = fontSize × (表示幅/500) なので、
                    max-w-2xl(672) だと 1280幅のとき列が 645px しか無く倍率が 1.29 に落ちて
                    fontSize 9 が 11.6px（12px未満）になる。600 に固定すれば倍率は常に 1.2。 */}
                <svg viewBox="0 -20 500 560" className="w-full max-w-[600px] mx-auto select-none">
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
                    // ドラッグ中は「持っている選手」と「離すと入れ替わる先」も選択と同じ印にする
                    const isSelected = selectedDefensePos === pos || defenseDrag?.from === pos || defenseDrag?.over === pos;
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
                      <g key={pos} data-defpos={pos}
                         onClick={() => !isPitcherPos && handleDefenseClick(pos)}
                         onPointerDown={(e) => !isPitcherPos && startDefenseDrag(pos, e)}
                         style={{ cursor: isPitcherPos ? 'default' : player ? 'grab' : 'pointer', touchAction: isPitcherPos ? 'auto' : 'none' }}>
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
                              fill={grad.text} fontSize="10" fontWeight="bold" filter="url(#textShadow)">
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
                  選手を別の守備位置へドラッグ（またはクリックで選んで入れ替え先をクリック）で入れ替え。右の一覧からも動かせます（投手は変更不可）
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
                    // ⚠ 100 も pink-400（素の pink-500 は行の地の上で 1.8:1 で読めなかった）。ランク色の段は
                    //    能力の S（getRankColor）と同じ pink-400 に揃える
                    const fitColor = fitness >= 90 ? 'text-pink-400' : fitness >= 80 ? 'text-red-400' : fitness >= 70 ? 'text-orange-400' : fitness >= 60 ? 'text-amber-400' : fitness >= 50 ? 'text-yellow-400' : fitness >= 40 ? 'text-lime-400' : fitness >= 30 ? 'text-green-400' : fitness >= 20 ? 'text-cyan-400' : fitness >= 10 ? 'text-blue-400' : 'text-indigo-400';
                    const isSelected = selectedDefensePos === pos || defenseDrag?.from === pos;
                    const isDropTarget = defenseDrag?.over === pos;
                    const isPitcherPos = pos === 'pitcher';

                    return (
                      <div key={pos} data-defpos={pos}
                        onClick={() => !isPitcherPos && handleDefenseClick(pos)}
                        onPointerDown={(e) => !isPitcherPos && startDefenseDrag(pos, e, { allowTouch: false })}
                        title={isPitcherPos ? undefined : 'ドラッグで守備位置を入れ替え'}
                        // ⚠ 行の地は受け皿（bg-surface-1）。カードより明るい gray-700 にすると、載っている
                        //    ランク色（pink/red/blue-400 など）が 3.4〜3.6:1 まで落ちていた（index.css の文字色の決まり）。
                        //    hover は地を明るくせず枠で示す
                        className={`rounded p-2 transition select-none ${isSelected ? 'bg-yellow-900 ring-1 ring-yellow-400' : isDropTarget ? 'bg-blue-900/60 ring-1 ring-blue-400' : 'bg-surface-1 hover:ring-1 hover:ring-gray-500'} ${isPitcherPos ? 'cursor-default opacity-60' : player ? 'cursor-grab' : 'cursor-pointer'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {!isPitcherPos && player && <span className="text-gray-400 text-xs leading-none" aria-hidden="true">⠿</span>}
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
                {/* 選んだ位置と入れ替えたときの、2人それぞれの適性（今の位置 → 入れ替え先） */}
                {selectedDefensePos && selectedPosSwapCandidates.length > 0 && (() => {
                  const selPlayer = positionPlayers[selectedDefensePos];
                  return (
                    <div className="mt-3 bg-surface-1 rounded p-3">
                      <div className="text-yellow-400 text-sm font-bold mb-2">
                        {posFullLabels[selectedDefensePos]}{selPlayer ? `（${selPlayer.name}）` : ''}と入れ替えると
                      </div>
                      <div className="space-y-1">
                        {selectedPosSwapCandidates.map(({ player, entry }) => {
                          const them = { pos: entry.position, dest: selectedDefensePos,
                            now: getFitness(player, entry.position), next: getFitness(player, selectedDefensePos) };
                          const me = selPlayer ? { pos: selectedDefensePos, dest: entry.position,
                            now: getFitness(selPlayer, selectedDefensePos), next: getFitness(selPlayer, entry.position) } : null;
                          const total = (them.next - them.now) + (me ? me.next - me.now : 0);
                          return (
                            <div key={player.id} data-defpos={entry.position}
                              onClick={() => handleDefenseClick(entry.position)}
                              className="bg-surface-2 hover:ring-1 hover:ring-gray-500 rounded px-2 py-1.5 cursor-pointer text-sm">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-white font-bold truncate">{posLabels[entry.position]} {player.name}</span>
                                <span className={`text-xs font-bold tabular-nums ${total >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  計{total >= 0 ? '+' : ''}{total}
                                </span>
                              </div>
                              <div className="flex flex-col gap-0.5 text-xs mt-0.5">
                                <span className="flex items-baseline gap-1.5"><span className="text-gray-400 w-14 truncate">{player.name}</span>{fitnessChange(them)}</span>
                                {me && <span className="flex items-baseline gap-1.5"><span className="text-gray-400 w-14 truncate">{selPlayer.name}</span>{fitnessChange(me)}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

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
        {detailPlayer && (
          <PlayerDetailModal player={detailPlayer} onClose={() => setDetailPlayer(null)} />
        )}
    </Shell>
  );
};

const LineupSettingScreen = ({ teamName, onBack, embedded = false }) => {
  const team = TEAMS_DATA[teamName];
  if (!team) return <div className="p-8 text-white">チームが見つかりません</div>;
  return <LineupSettingContent teamName={teamName} onBack={onBack} team={team} embedded={embedded} />;
};

export default LineupSettingScreen;
