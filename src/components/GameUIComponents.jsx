import React from 'react';
import { FORM_SHORT, getPitchTypeName, POSITION_NAMES, sortBenchByPosition, formatAtBatResult, atBatResultColor } from '../utils/constants.js';
import { formatInnings, getAbilityTextColor } from '../utils/physics.js';
import { CONDITION_LEVELS, CONDITION_COLORS, CONDITION_ICONS } from '../game/condition.js';
import { calculateDefensiveFitness } from '../simulation-logic.js';

// ============================================================
// 画面の外枠と見出し（全画面で共通）
//
// ⚠ **画面ごとに padding / max-w / 見出しの大きさを書かないこと**。
//    実測で余白が `p-3 / p-4 / p-6 / p-8` の4種類、本文幅が
//    `max-w-7xl / max-w-3xl / 指定なし` の3通り、見出しが
//    `text-lg / xl / 2xl / 3xl`（しかも資料室だけ黄色）に散っていて、
//    画面を移動するたび余白も本文幅も文字の大きさも変わっていた。
//    `.btn-*` や `.seg` と同じで、**語彙を1箇所に置く**。
//
// ⚠ 画面は**自前の背景を持たない**。地色は App.jsx の `bg-surface-0` ひとつで、
//    カードが `bg-surface-2`。画面ごとに `bg-surface-1 min-h-screen` を足すと
//    地色が2層になり、カードとの対比も画面ごとに変わる。
// ============================================================

// コンテンツ幅は3段だけ（CLAUDE.md「コンテンツ幅は3段だけ」と同じ区分）
const SHELL_WIDTH = {
  wide: 'max-w-7xl',        // 1280 表・一覧が主役（ロスター・日程・成績・資料室・チーム運営）
  mid:  'max-w-5xl',        // 1024 設定・選択・カード一覧（レギュレーション・マニュアル）
  form: 'max-w-3xl',        // 768  フォーム・確認（セーブ/ロード・オフシーズン）
  panel: 'max-w-[1800px]',  // 1800 多パネルの例外（試合画面の3カラム等）
};

export const ScreenShell = ({ width = 'wide', className = '', children }) => (
  <div className={`mx-auto p-4 ${SHELL_WIDTH[width] || SHELL_WIDTH.wide} ${className}`}>
    {children}
  </div>
);

/**
 * 画面の見出し。大きさ・色は1つに揃える。
 * @param title 画面名（絵文字は付けない。サイドバーのアイコンと重複するため）
 * @param sub   補足の1行
 * @param right 右端に置く操作（タブ・フィルタ・戻るなど）
 */
export const ScreenHeader = ({ title, sub = null, right = null }) => (
  <div className="flex items-end justify-between gap-4 mb-4">
    <div className="min-w-0">
      {/* 見出しはカードではなく**地色の上**に載る。地色が明るいのでここだけ暗い文字
          （`text-white` のままだと 1.4:1 で消える。実測） */}
      <h1 className="text-xl font-bold text-ink truncate">{title}</h1>
      {sub && <p className="text-xs text-ink-sub mt-1">{sub}</p>}
    </div>
    {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
  </div>
);

// --- PositionControl コンポーネント ---
export const PositionControl = ({ position, label, defense, setDefense }) => {
  const [show, setShow] = React.useState(false);
  if (!defense || !defense[position]) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="btn-primary w-8 h-8 rounded-full text-xs shadow-lg border-2 border-white"
      >
        {label}
      </button>
      {show && (
        <div className="absolute z-10 bg-surface-2 border border-gray-600 rounded-xl shadow-xl w-48 text-xs p-3"
             style={{left: '50%', transform: 'translateX(-50%)', marginTop: '4px'}}>
          <div className="mb-1.5">
            <label className="block font-bold text-gray-300">守:{defense[position].defense}</label>
            <input type="range" min="0" max="100" value={defense[position].defense}
              onChange={(e) => setDefense({...defense, [position]: {...defense[position], defense: Number(e.target.value)}})}
              className="w-full h-1 cursor-pointer accent-blue-500" />
          </div>
          <div className="mb-1.5">
            <label className="block font-bold text-gray-300">足:{defense[position].speed}</label>
            <input type="range" min="0" max="100" value={defense[position].speed}
              onChange={(e) => setDefense({...defense, [position]: {...defense[position], speed: Number(e.target.value)}})}
              className="w-full h-1 cursor-pointer accent-green-500" />
          </div>
          <div>
            <label className="block font-bold text-gray-300">肩:{defense[position].arm}</label>
            <input type="range" min="0" max="100" value={defense[position].arm}
              onChange={(e) => setDefense({...defense, [position]: {...defense[position], arm: Number(e.target.value)}})}
              className="w-full h-1 cursor-pointer accent-orange-500" />
          </div>
        </div>
      )}
    </div>
  );
};

// --- renderBases (フィールドSVG + ポジション設定UI) ---
// Returns JSX. Caller should invoke as: <RenderBases defense={...} setDefense={...} bases={...} />
export const RenderBases = ({ defense, setDefense, bases, readOnly = false }) => (
  <div className="relative w-full max-w-2xl mx-auto">
    {/* 全ポジション一括設定 */}
    {!readOnly && <div className="bg-gray-800/60 border border-gray-700/50 p-4 rounded-xl mb-4">
      <h4 className="font-bold text-sm mb-3 text-gray-300">全ポジション一括設定</h4>
      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="block text-xs font-semibold mb-1 text-gray-300">
            守備力: <span className="text-blue-400">{defense.first.defense}</span>
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={defense.first.defense}
            onChange={(e) => {
              const val = Number(e.target.value);
              setDefense({
                pitcher: { ...defense.pitcher, defense: val },
                catcher: { ...defense.catcher, defense: val },
                first: { ...defense.first, defense: val },
                second: { ...defense.second, defense: val },
                short: { ...defense.short, defense: val },
                third: { ...defense.third, defense: val },
                left: { ...defense.left, defense: val },
                center: { ...defense.center, defense: val },
                right: { ...defense.right, defense: val }
              });
            }}
            className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1 text-gray-300">
            足: <span className="text-green-400">{defense.first.speed}</span>
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={defense.first.speed}
            onChange={(e) => {
              const val = Number(e.target.value);
              setDefense({
                pitcher: { ...defense.pitcher, speed: val },
                catcher: { ...defense.catcher, speed: val },
                first: { ...defense.first, speed: val },
                second: { ...defense.second, speed: val },
                short: { ...defense.short, speed: val },
                third: { ...defense.third, speed: val },
                left: { ...defense.left, speed: val },
                center: { ...defense.center, speed: val },
                right: { ...defense.right, speed: val }
              });
            }}
            className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-green-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1 text-gray-300">
            肩: <span className="text-orange-400">{defense.first.arm}</span>
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={defense.first.arm}
            onChange={(e) => {
              const val = Number(e.target.value);
              setDefense({
                pitcher: { ...defense.pitcher, arm: val },
                catcher: { ...defense.catcher, arm: val },
                first: { ...defense.first, arm: val },
                second: { ...defense.second, arm: val },
                short: { ...defense.short, arm: val },
                third: { ...defense.third, arm: val },
                left: { ...defense.left, arm: val },
                center: { ...defense.center, arm: val },
                right: { ...defense.right, arm: val }
              });
            }}
            className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-orange-500"
          />
        </div>
      </div>
    </div>}

    <svg viewBox="0 0 400 350" className="w-full h-full">
      {/* スタジアム外周（グレー） */}
      <ellipse cx="200" cy="280" rx="180" ry="140" fill="#9ca3af" />

      {/* 観客席 */}
      <path d="M 50 200 Q 200 80 350 200 L 350 320 Q 200 360 50 320 Z" fill="#d1d5db" />

      {/* スコアボード（センター後方） */}
      <rect x="160" y="10" width="80" height="35" fill="#1e40af" stroke="#1e3a8a" strokeWidth="2" rx="3" />
      <rect x="165" y="15" width="70" height="10" fill="#16a34a" opacity="0.8" />

      {/* ファウルポール（黄色） */}
      <rect x="30" y="200" width="8" height="80" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1" />
      <rect x="362" y="200" width="8" height="80" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1" />

      {/* 外野フェンス（曲線） */}
      <path d="M 40 260 Q 200 120 360 260" fill="none" stroke="#8b7355" strokeWidth="4" />

      {/* 外野芝（深緑、ストライプ） */}
      <defs>
        <linearGradient id="grassStripes" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#15803d" />
          <stop offset="10%" stopColor="#16a34a" />
          <stop offset="20%" stopColor="#15803d" />
          <stop offset="30%" stopColor="#16a34a" />
          <stop offset="40%" stopColor="#15803d" />
          <stop offset="50%" stopColor="#16a34a" />
          <stop offset="60%" stopColor="#15803d" />
          <stop offset="70%" stopColor="#16a34a" />
          <stop offset="80%" stopColor="#15803d" />
          <stop offset="90%" stopColor="#16a34a" />
          <stop offset="100%" stopColor="#15803d" />
        </linearGradient>
      </defs>
      <path d="M 40 260 Q 200 120 360 260 L 270 300 L 200 265 L 130 300 Z" fill="url(#grassStripes)" />

      {/* 内野土（茶色、ダイヤモンド） */}
      <path d="M 200 310 L 270 250 L 200 190 L 130 250 Z" fill="#d4a574" stroke="#b8956a" strokeWidth="2" />

      {/* 内野グラス（円弧） */}
      <ellipse cx="200" cy="310" rx="80" ry="55" fill="#22c55e" opacity="0.6" />

      {/* ファウルライン（白線） */}
      <line x1="200" y1="310" x2="40" y2="260" stroke="white" strokeWidth="2.5" />
      <line x1="200" y1="310" x2="360" y2="260" stroke="white" strokeWidth="2.5" />

      {/* ベースパス */}
      <line x1="200" y1="310" x2="270" y2="250" stroke="#b8956a" strokeWidth="1.5" strokeDasharray="4,4" opacity="0.6" />
      <line x1="270" y1="250" x2="200" y2="190" stroke="#b8956a" strokeWidth="1.5" strokeDasharray="4,4" opacity="0.6" />
      <line x1="200" y1="190" x2="130" y2="250" stroke="#b8956a" strokeWidth="1.5" strokeDasharray="4,4" opacity="0.6" />
      <line x1="130" y1="250" x2="200" y2="310" stroke="#b8956a" strokeWidth="1.5" strokeDasharray="4,4" opacity="0.6" />

      {/* 投手マウンド */}
      <ellipse cx="200" cy="280" rx="12" ry="8" fill="#d4a574" stroke="#b8956a" strokeWidth="1.5" />
      <ellipse cx="200" cy="280" rx="4" ry="3" fill="#b8956a" />

      {/* ホームベース */}
      <path d="M 200 310 L 195 305 L 195 300 L 205 300 L 205 305 Z"
            fill="white" stroke="#333" strokeWidth="1.5" />

      {/* 一塁ベース */}
      <rect x="265" y="245" width="10" height="10"
            fill={bases[0] ? '#fbbf24' : 'white'}
            stroke="#333" strokeWidth="1.5"
            transform="rotate(45 270 250)" />
      {bases[0] && <circle cx="270" cy="250" r="5" fill="#ef4444" />}

      {/* 二塁ベース */}
      <rect x="195" y="185" width="10" height="10"
            fill={bases[1] ? '#fbbf24' : 'white'}
            stroke="#333" strokeWidth="1.5"
            transform="rotate(45 200 190)" />
      {bases[1] && <circle cx="200" cy="190" r="5" fill="#ef4444" />}

      {/* 三塁ベース */}
      <rect x="125" y="245" width="10" height="10"
            fill={bases[2] ? '#fbbf24' : 'white'}
            stroke="#333" strokeWidth="1.5"
            transform="rotate(45 130 250)" />
      {bases[2] && <circle cx="130" cy="250" r="5" fill="#ef4444" />}

      {/* ポジション表示（小さい円） */}
      {/* 投手 */}
      <circle cx="200" cy="280" r="3" fill="#1e40af" opacity="0.7" />

      {/* 捕手 */}
      <circle cx="200" cy="315" r="3" fill="#dc2626" opacity="0.7" />

      {/* 一塁手 */}
      <circle cx="260" cy="260" r="3" fill="#7c3aed" opacity="0.7" />

      {/* 二塁手 */}
      <circle cx="230" cy="230" r="3" fill="#7c3aed" opacity="0.7" />

      {/* 遊撃手 */}
      <circle cx="170" cy="230" r="3" fill="#7c3aed" opacity="0.7" />

      {/* 三塁手 */}
      <circle cx="140" cy="260" r="3" fill="#7c3aed" opacity="0.7" />

      {/* 左翼手 */}
      <circle cx="120" cy="200" r="3" fill="#059669" opacity="0.7" />

      {/* 中堅手 */}
      <circle cx="200" cy="160" r="3" fill="#059669" opacity="0.7" />

      {/* 右翼手 */}
      <circle cx="280" cy="200" r="3" fill="#059669" opacity="0.7" />
    </svg>

    {/* ポジション別パラメータ設定UI */}
    {!readOnly && <div className="absolute inset-0 pointer-events-none">
      {/* 投手 */}
      <div className="absolute pointer-events-auto" style={{left: '48%', top: '58%'}}>
        <PositionControl position="pitcher" label="投" defense={defense} setDefense={setDefense} />
      </div>

      {/* 捕手 */}
      <div className="absolute pointer-events-auto" style={{left: '48%', top: '72%'}}>
        <PositionControl position="catcher" label="捕" defense={defense} setDefense={setDefense} />
      </div>

      {/* 一塁手 */}
      <div className="absolute pointer-events-auto" style={{left: '68%', top: '52%'}}>
        <PositionControl position="first" label="一" defense={defense} setDefense={setDefense} />
      </div>

      {/* 二塁手 */}
      <div className="absolute pointer-events-auto" style={{left: '60%', top: '38%'}}>
        <PositionControl position="second" label="二" defense={defense} setDefense={setDefense} />
      </div>

      {/* 遊撃手 */}
      <div className="absolute pointer-events-auto" style={{left: '38%', top: '38%'}}>
        <PositionControl position="short" label="遊" defense={defense} setDefense={setDefense} />
      </div>

      {/* 三塁手 */}
      <div className="absolute pointer-events-auto" style={{left: '30%', top: '52%'}}>
        <PositionControl position="third" label="三" defense={defense} setDefense={setDefense} />
      </div>

      {/* 左翼手 */}
      <div className="absolute pointer-events-auto" style={{left: '25%', top: '28%'}}>
        <PositionControl position="left" label="左" defense={defense} setDefense={setDefense} />
      </div>

      {/* 中堅手 */}
      <div className="absolute pointer-events-auto" style={{left: '48%', top: '15%'}}>
        <PositionControl position="center" label="中" defense={defense} setDefense={setDefense} />
      </div>

      {/* 右翼手 */}
      <div className="absolute pointer-events-auto" style={{left: '71%', top: '28%'}}>
        <PositionControl position="right" label="右" defense={defense} setDefense={setDefense} />
      </div>
    </div>}
  </div>
);

// --- Tooltip 共通ツールチップコンポーネント ---
export const Tooltip = ({ text, children, position = 'top' }) => {
  const [show, setShow] = React.useState(false);
  const posStyles = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  };
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && text && (
        <span className={`absolute z-50 px-2 py-1 rounded text-xs text-gray-100 bg-surface-1 border border-gray-700 shadow-lg whitespace-nowrap pointer-events-none ${posStyles[position] || posStyles.top}`}>
          {text}
        </span>
      )}
    </span>
  );
};

// --- StatHeader ツールチップ付き略称ヘッダー ---
const STAT_TOOLTIPS = {
  'ミ': 'ミート（打撃精度）', 'パ': 'パワー（長打力）', '走': '走力', '肩': '肩力', '守': '守備力',
  '眼': '選球眼', '盗': '盗塁技術', '速': '球速（km/h）', '制': '制球力', 'ス': 'スタミナ',
  '体': '体力（疲労耐性）', '回': '回復力', '伸': '球の伸び', 'バ': 'バント技術',
  'Cリ': 'キャッチャーリード', '齢': '年齢', '位': 'ポジション', '成長': '成長率（基礎+変動）',
  'プ意': 'プロ意識', '精神': '精神力', '野': '野手総合力', '投': '投手総合力',
  '試': '試合出場数', 'HR': '本塁打', '打点': '打点',
};

// ツールチップは native title で付ける（Tooltipで<th>をラップすると<tr>直下が
// <span>になり、テーブルの列がデータ行とズレるため）
export const StatHeader = ({ label, sortKey, sortActive, sortAsc, onClick, className = '' }) => (
  <th
    title={STAT_TOOLTIPS[label]}
    className={`py-1 px-1 cursor-pointer hover:text-white hover:bg-gray-600/40 transition select-none text-center ${sortActive ? 'text-yellow-400' : ''} ${className}`}
    onClick={onClick}
  >
    {label}{sortActive ? (sortAsc ? '↑' : '↓') : ''}
  </th>
);

// --- AbilityLegend 能力値凡例 ---
export const AbilityLegend = ({ className = '' }) => (
  <div className={`flex items-center gap-1.5 text-xs ${className}`}>
    <span className="text-gray-400 font-bold">能力:</span>
    {[
      { min: 90, color: 'text-pink-400', label: '90+' },
      { min: 80, color: 'text-red-400', label: '80+' },
      { min: 70, color: 'text-orange-400', label: '70+' },
      { min: 60, color: 'text-yellow-400', label: '60+' },
      { min: 50, color: 'text-green-400', label: '50+' },
      { min: 40, color: 'text-blue-400', label: '40+' },
      { min: 0, color: 'text-gray-300', label: '40未満' },
    ].map(t => (
      <span key={t.min} className={t.color}>{t.label}</span>
    ))}
  </div>
);

// --- GameButton 共通ボタンコンポーネント ---
const BUTTON_VARIANTS = {
  primary: 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm',
  secondary: 'btn-secondary',
  danger: 'bg-red-600 hover:bg-red-500 text-white',
  success: 'bg-green-600 hover:bg-green-500 text-white',
  ghost: 'bg-transparent hover:bg-gray-700/60 text-gray-300 hover:text-white',
};
const BUTTON_SIZES = {
  sm: 'px-2.5 py-1 text-xs rounded',
  md: 'px-4 py-1.5 text-sm rounded-lg',
  lg: 'px-6 py-2.5 text-base rounded-lg',
};
export const GameButton = ({ variant = 'primary', size = 'md', className = '', disabled = false, children, ...props }) => (
  <button
    className={`font-bold transition-all ${BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary} ${BUTTON_SIZES[size] || BUTTON_SIZES.md} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    disabled={disabled}
    {...props}
  >
    {children}
  </button>
);

// --- TabBar 共通タブコンポーネント ---
export const TabBar = ({ tabs, activeKey, onChange, className = '' }) => (
  <div className={`flex gap-1 bg-gray-800/60 rounded-xl p-1 border border-gray-700/50 ${className}`}>
    {tabs.map(({ key, label, icon, count }) => (
      <button
        key={key}
        onClick={() => onChange(key)}
        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
          activeKey === key
            ? 'seg-on' : 'seg'
        }`}
      >
        {icon && <span className="text-base leading-none">{icon}</span>}
        <span>{label}</span>
        {count !== undefined && <span className="text-xs opacity-60 ml-0.5">({count})</span>}
      </button>
    ))}
  </div>
);

// --- AccordionSection コンポーネント ---
export const AccordionSection = ({ title, isExpanded, onToggle, children }) => (
  <div className="bg-gray-800/80 rounded-xl border border-gray-700/50 overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-700/40 transition text-left"
    >
      <span className="font-semibold text-gray-200">{title}</span>
      <span className={`text-gray-300 text-xs transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
    </button>
    <div className={`grid transition-all duration-200 ease-in-out ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
      <div className="overflow-hidden">
        <div className="p-4 border-t border-gray-700/50">
          {children}
        </div>
      </div>
    </div>
  </div>
);

// --- SidebarButton コンポーネント ---
// この画面を開いている間はサイドバーで抜けさせない（その年のイベントを飛ばせてしまうため）
const BLOCKING_VIEWS = new Set(['draft', 'contract', 'tryout', 'corporate_departure', 'corporate_scout', 'club_recruit', 'budget_settlement']);

// ⚠ **推薦スカウトは日付で判定する**。シーズン中はサイドバーから随時見に行ける画面なので
//   常時ブロックすると戻れなくなる。11/29 の強制イベントのときだけ抜けさせない
//   （`ManagementScreen` の `isForced` と同じ条件。あちらは「戻る」ボタンを消している）。
const isNavBlocked = (managementView, seasonData) => {
  if (BLOCKING_VIEWS.has(managementView)) return true;
  if (managementView === 'university_scout') {
    const d = seasonData?.currentDate;
    return d?.month === 11 && (d?.day ?? 0) >= 29;
  }
  return false;
};

export const SidebarButton = ({ view, icon, label, onActiveClick, screenMode, managementView, seasonData, setScreenMode, setManagementView }) => {
  const isActive = screenMode === 'management' && managementView === view;
  const isBlocked = screenMode === 'management' && isNavBlocked(managementView, seasonData) && !isActive;
  return (
    <button
      onClick={() => {
        if (isBlocked) return;
        if (isActive && onActiveClick) { onActiveClick(); return; }
        setScreenMode('management'); setManagementView(view);
      }}
      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2.5 ${
        isBlocked
          ? 'text-gray-400 border-l-[3px] border-transparent cursor-not-allowed'
          : isActive
          ? 'seg-on border-l-[3px] border-l-[var(--accent)] shadow-sm'
          : 'text-gray-300 hover:bg-gray-700/60 hover:text-white border-l-[3px] border-transparent'
      }`}
    >
      <span className="text-base w-5 text-center shrink-0">{icon}</span>
      <span>{label}</span>
    </button>
  );
};

// --- Sidebar コンポーネント ---
export const Sidebar = ({
  gameMode,
  userTeamName,
  seasonData,
  formatDate,
  screenMode,
  managementView,
  setScreenMode,
  setManagementView,
  advanceDayRef
}) => (
  <div className="w-56 bg-gray-900/95 backdrop-blur text-white h-screen fixed left-0 top-0 flex flex-col border-r border-gray-700/50">
    <div className="px-4 py-4 border-b border-gray-700/50 bg-gray-800/30">
      <h2 className={`text-lg font-black tracking-tight ${gameMode === 'sandbox' ? 'text-orange-400' : 'text-green-400'}`}>⚾ {userTeamName}</h2>
      <div className="text-xs text-gray-300 mt-1 flex items-center gap-1.5">
        {gameMode === 'sandbox' && <span className="text-orange-400/80 bg-orange-400/10 px-1.5 py-0.5 rounded text-xs font-bold">箱庭</span>}
        {gameMode === 'university' && <span className="text-amber-400/80 bg-amber-400/10 px-1.5 py-0.5 rounded text-xs font-bold">大学</span>}
        <span>{seasonData?.year || 1}年目</span>
        <span className="text-gray-400">|</span>
        <span>{seasonData?.currentDate ? formatDate(seasonData.currentDate) : ''}</span>
      </div>
    </div>

    <nav className="flex-1 min-h-0 overflow-y-auto px-2 py-3 space-y-0.5">
      <div className="text-xs uppercase tracking-widest text-gray-400 font-bold px-3 pt-1 pb-2">進行</div>
      {/* ⚠ 表示中の「日程進行」をもう一度押しても日は進めない。以前は再クリックで1日進み、
          画面を戻すつもりで押した人が意図せず日程を進めていた。進めるのはカレンダー見出しの「1日進める」だけ */}
      <SidebarButton view="dateprogress" icon="📅" label="日程進行" screenMode={screenMode} managementView={managementView} seasonData={seasonData} setScreenMode={setScreenMode} setManagementView={setManagementView} />
      <SidebarButton view="roster" icon="📋" label="ロスター管理" screenMode={screenMode} managementView={managementView} seasonData={seasonData} setScreenMode={setScreenMode} setManagementView={setManagementView} />
      <SidebarButton view="stats" icon="📊" label="選手成績" screenMode={screenMode} managementView={managementView} seasonData={seasonData} setScreenMode={setScreenMode} setManagementView={setManagementView} />
      <SidebarButton view="ranking" icon="📰" label="能力ランキング" screenMode={screenMode} managementView={managementView} seasonData={seasonData} setScreenMode={setScreenMode} setManagementView={setManagementView} />
      <SidebarButton view="team_ranking" icon="🏅" label="チームランキング" screenMode={screenMode} managementView={managementView} seasonData={seasonData} setScreenMode={setScreenMode} setManagementView={setManagementView} />

      <div className="border-t border-gray-700/40 my-2"></div>
      <div className="text-xs uppercase tracking-widest text-gray-400 font-bold px-3 pt-1 pb-2">チーム</div>
      <SidebarButton view="teaminfo" icon="👥" label="チーム情報" screenMode={screenMode} managementView={managementView} seasonData={seasonData} setScreenMode={setScreenMode} setManagementView={setManagementView} />
      {gameMode === 'corporate' && !seasonData?.settings?.clubMode && <SidebarButton view="corporate_management" icon="🏢" label="チーム運営" screenMode={screenMode} managementView={managementView} seasonData={seasonData} setScreenMode={setScreenMode} setManagementView={setManagementView} />}
      {gameMode === 'university' && <SidebarButton view="university_scout" icon="🔍" label="スカウト" screenMode={screenMode} managementView={managementView} seasonData={seasonData} setScreenMode={setScreenMode} setManagementView={setManagementView} />}
      {gameMode !== 'corporate' && gameMode !== 'university' && <SidebarButton view="trade" icon="🔄" label="トレード" screenMode={screenMode} managementView={managementView} seasonData={seasonData} setScreenMode={setScreenMode} setManagementView={setManagementView} />}
      <SidebarButton view="halloffame" icon="🏆" label="資料室" screenMode={screenMode} managementView={managementView} seasonData={seasonData} setScreenMode={setScreenMode} setManagementView={setManagementView} />
      <SidebarButton view="player_search" icon="🔎" label="選手検索" screenMode={screenMode} managementView={managementView} seasonData={seasonData} setScreenMode={setScreenMode} setManagementView={setManagementView} />

      <div className="border-t border-gray-700/40 my-2"></div>
      <div className="text-xs uppercase tracking-widest text-gray-400 font-bold px-3 pt-1 pb-2">システム</div>
      <SidebarButton view="save" icon="💾" label="セーブ＆ロード" screenMode={screenMode} managementView={managementView} seasonData={seasonData} setScreenMode={setScreenMode} setManagementView={setManagementView} />
      <SidebarButton view="regulations" icon="⚙️" label="レギュレーション" screenMode={screenMode} managementView={managementView} seasonData={seasonData} setScreenMode={setScreenMode} setManagementView={setManagementView} />
    </nav>
  </div>
);

// ============================================================
// 試合画面 左右カラムの投手欄（試合中=投手成績 / 試合前=予告先発）
//
// ⚠ **アウェイ用とホーム用で115行を丸ごとコピペしていた**（L3388-3502 と
//    L4914-5028）。チーム参照を置換するとバイト単位で一致しており、
//    片方だけ直す事故が起きる形だった（この作品が繰り返し踏んでいる
//    「表を二重に作らない」違反そのもの）。
//
// ⚠ **ここの getValueColor / getBgColor が使う正規化は共有の物差しと違う**
//    （球速 `(v-100)*2` / スタミナ `v/2`。共有は `normVelocity` = `(v-115)*2.5`）。
//    抽出時は**挙動を変えないため元の係数のまま**にしてある。
//    揃えると色が変わる（140km は 赤 → 黄）ので、直すなら別の変更として測ること。
// ============================================================
const panelValueColor = (val) => {
  if (val >= 80) return 'text-red-400';
  if (val >= 70) return 'text-orange-400';
  if (val >= 60) return 'text-yellow-400';
  if (val >= 50) return 'text-green-400';
  return 'text-gray-300';
};
const panelBgColor = (val) => {
  if (val >= 80) return 'bg-red-500';
  if (val >= 70) return 'bg-orange-500';
  if (val >= 60) return 'bg-yellow-500';
  if (val >= 50) return 'bg-green-500';
  return 'bg-gray-500';
};

export const TeamPitcherPanel = ({ team, gameStarted }) => (
  <div className="mt-2 pt-2 border-t border-gray-700">
    {gameStarted ? (
      <>
        <div className="text-sm text-gray-300 mb-1 font-semibold">📊 試合スタッツ</div>
        {/* 投手成績 */}
        <div className="bg-surface-2 rounded p-2 mb-1">
          <div className="text-xs text-blue-400 mb-0.5">投手</div>
          <div className="text-sm">
            {(() => {
              const pitchers = team.players.filter(p => (p.stats?.pitching?.outs || 0) > 0);
              const totalOuts = pitchers.reduce((sum, p) => sum + (p.stats?.pitching?.outs || 0), 0);
              const totalIP = totalOuts > 0 ? formatInnings(totalOuts) : '0回0/3';
              return (
                <>
                  {pitchers.map(p => {
                    const s = p.stats?.pitching || {};
                    const outs = s.outs || 0;
                    const ip = outs > 0 ? formatInnings(outs) : '0回0/3';
                    const era = outs > 0 ? ((s.runsAllowed || 0) * 27 / outs).toFixed(2) : '-.--';
                    return (
                      <div key={p.id} className="flex justify-between text-gray-300 gap-1">
                        <span className="truncate">{p.name}</span>
                        <span className="text-gray-300 whitespace-nowrap text-xs">
                          {ip} {s.strikeouts || 0}K {s.walks || 0}BB 防{era}
                        </span>
                      </div>
                    );
                  })}
                  {pitchers.length > 1 && (
                    <div className="flex justify-between text-yellow-400 text-xs mt-1 pt-1 border-t border-gray-700">
                      <span>合計イニング</span>
                      <span>{totalIP}</span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </>
    ) : (
      <>
        <div className="text-sm font-bold text-gray-300 mb-1">⚾ 予告先発</div>
        {(() => {
          const pitcher = team.players.find(p => p.isStarter && p.position === 'pitcher');
          if (!pitcher) return null;
          const formNames = FORM_SHORT;
          const velocityScore = Math.min(100, (pitcher.pitching.velocity - 100) * 2);
          const staminaScore = Math.min(100, pitcher.pitching.stamina / 2);
          return (
            <div className="bg-surface-2 rounded p-3 border-2 border-gray-700">
              <div className="text-base text-white mb-2 font-bold flex items-center gap-2">
                <span>⚾</span>
                <span>{pitcher.name}</span>
                {pitcher.number != null && pitcher.number !== '' && <span className="text-sm text-gray-300">#{pitcher.number}</span>}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-gray-300">投げ手:</span>
                  <span className="text-white font-bold">{pitcher.physical.throws === 'right' ? '右投' : '左投'}</span>
                  <span className="text-gray-400">|</span>
                  <span className="text-white">{formNames[pitcher.pitching.form]}</span>
                  <span className="text-gray-400">|</span>
                  <span className="text-xs text-gray-300">球速:</span>
                  <span className={`text-lg font-bold ${panelValueColor(velocityScore)}`}>{pitcher.pitching.velocity}</span>
                  <span className="text-xs text-gray-400">km/h</span>
                  <span className="text-gray-400">|</span>
                  <span className="text-xs text-gray-300">回転:</span>
                  <span className={`text-sm font-bold ${panelValueColor(pitcher.pitching.spinRate ?? 50)}`}>{pitcher.pitching.spinRate ?? 50}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-300 w-12">制球</span>
                  <div className="flex-1 bg-gray-700 rounded h-3 overflow-hidden">
                    <div className={`h-full ${panelBgColor(pitcher.pitching.control)}`} style={{ width: `${pitcher.pitching.control}%` }} />
                  </div>
                  <span className={`text-sm font-bold ${panelValueColor(pitcher.pitching.control)}`}>{pitcher.pitching.control}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-300 w-12">体力</span>
                  <div className="flex-1 bg-gray-700 rounded h-3 overflow-hidden">
                    <div className={`h-full ${panelBgColor(staminaScore)}`} style={{ width: `${staminaScore}%` }} />
                  </div>
                  <span className={`text-sm font-bold ${panelValueColor(staminaScore)}`}>{pitcher.pitching.stamina}</span>
                </div>
                <div className="pt-1 border-t border-gray-700">
                  <div className="text-xs text-gray-300 mb-1">変化球</div>
                  <div className="flex flex-wrap gap-1.5">
                    {pitcher.pitching.arsenal.map((ball, i) => (
                      <span key={i} className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded font-semibold">
                        {getPitchTypeName(ball.type)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </>
    )}
  </div>
);

/**
 * 左右のメンバー表（打順・守備位置・成績・打席結果）。
 * ⚠ かつて App.jsx の RENDER にアウェイ用とホーム用が並んで書かれており、
 *    正規化して比べると 335行中 328行が同一だった。ドリフトも実際に起きていて、
 *    アウェイ側だけ `text-red-400`（チーム色分け。表と裏で意味が反転するので使わない決まり）と
 *    `truncate min-w-0` 無しが残っていた。ホーム側を正として1つに畳んである。
 * - `side` は 'away' | 'home'。ヘッダーの並び（得点とチーム名の左右）と
 *   handleXxxClick の teamType を兼ねる
 * - `isBatting` はこのチームが攻撃中か（旧: アウェイ=isTopInning / ホーム=!isTopInning）
 */
/**
 * ベンチメンバーの行（交代要員の一覧）。
 * ⚠ **`TeamMemberPanel` の中に同じ38行が2度書かれていた**——試合前の「右: 控え選手」の欄と、
 *    試合中の「⚡ 選手交代」アコーディオンの中。正規化すると完全に一致していた。
 *    `TeamMemberPanel` 自体が「左右で335行中328行が同一だった」のを畳んだものなので、
 *    同じファイルの中で同じことをもう一度やっていたことになる。
 *    ⚠ 外側の枠（高さ・余白）だけ2箇所で違うので、**枠は呼び出し側に残して中身だけ共有する**。
 */
const BenchList = ({ team, side, selectedSubstitute, handleSubstituteClick, getPositionColor }) => (
  <>
    {/* 控えは 捕→一→二→三→遊→左→中→右→投 の順に並べる（constants.js）。
        ロスター順のままだと投手と野手が混ざって交代要員を探せない */}
    {sortBenchByPosition(team.players.filter(p => !p.isStarter))
      .map(player => {
        const isPitcher = player.position === 'pitcher';
        const throwHand = player.physical.throws === 'right' ? '右' : '左';
        const batHand = player.batting.bats === 'right' ? '右' : player.batting.bats === 'left' ? '左' : '両';
        const isSubSelected = selectedSubstitute === player.id;
        const isSubbedOut = player.hasSubbedOut;

        return (
          <div
            key={player.id}
            onClick={() => !isSubbedOut && handleSubstituteClick(side, player.id)}
            className={`p-1.5 rounded transition ${
              isSubbedOut
                ? 'bg-surface-1 opacity-50 cursor-not-allowed'
                : isSubSelected
                  ? 'seg-on ring-2 cursor-pointer' : 'seg cursor-pointer'
            }`}
          >
            <div className="flex items-center gap-1">
              <span className={`w-6 text-center text-sm font-bold ${getPositionColor(player.position)} rounded`}>{POSITION_NAMES[player.position]}</span>
              <span className="font-medium text-sm truncate flex-1">{player.name}</span>
              <span className="text-xs text-gray-300 shrink-0">{throwHand}{batHand}</span>
              {isSubbedOut && <span className="text-red-400 text-xs">交代済</span>}
              {isSubSelected && <span className="text-blue-300">👆</span>}
            </div>
            <div className="grid grid-cols-3 gap-1 text-xs ml-6 text-gray-300 tabular-nums">
              <span>M{player.batting.meet}</span>
              <span>P{player.batting.power}</span>
              <span className="text-blue-300">{isPitcher ? `⚡${player.pitching.velocity}` : ''}</span>
            </div>
          </div>
        );
      })}
  </>
);

export const TeamMemberPanel = ({
  side, team, score, isBatting, gameStarted, gameOver,
  selectedBatter, selectedPosition, selectedSubstitute, showBench, setShowBench,
  handleBatterClick, handlePositionClick, handleSubstituteClick,
  getPositionColor, getPositionColorHighlighted,
}) => (
  <div className="bg-surface-1 rounded-lg p-2 text-white min-w-0 overflow-hidden">
    {/* 長いチーム名で2行にならないよう truncate。チーム色分けは使わない
        （表と裏で色の意味が反転するため）。左右で得点とチーム名の並びだけ鏡像にする */}
    <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-700">
      {side === 'away' ? (
        <>
          <h3 className="font-bold text-gray-100 truncate min-w-0" title={team.name}>✈️ {team.name}</h3>
          <span className="text-2xl font-bold text-gray-100 tabular-nums shrink-0 ml-2">{score || 0}</span>
        </>
      ) : (
        <>
          <span className="text-2xl font-bold text-gray-100 tabular-nums shrink-0 mr-2">{score || 0}</span>
          <h3 className="font-bold text-gray-100 truncate min-w-0 text-right" title={team.name}>🏠 {team.name}</h3>
        </>
      )}
    </div>
    
    {/* スタメンと控え選手を横並び表示 */}
    {!gameStarted ? (
      <div className="grid grid-cols-2 gap-2 mb-2">
        {/* 左: スタメン */}
        <div>
          <div className="text-xs text-gray-300 mb-1 px-1 font-semibold">スターティングメンバー</div>
          <div className="space-y-1 text-xs max-h-[calc(100vh-350px)] overflow-y-auto">
            {team.players
              .filter(p => p.isStarter)
              .sort((a, b) => a.battingOrder - b.battingOrder)
              .map(player => {
                const isPitcher = player.position === 'pitcher';
                const posNames = POSITION_NAMES;
                const throwHand = player.physical.throws === 'right' ? '右' : '左';
                const batHand = player.batting.bats === 'right' ? '右' : player.batting.bats === 'left' ? '左' : '両';
                const isSubSelected = selectedSubstitute === player.id;
                const isSelected = selectedBatter === player.battingOrder;
                const isPositionSelected = selectedPosition === player.id;

                return (
                  <div
                    key={player.id}
                    onClick={() => handleSubstituteClick(side, player.id)}
                    className={`p-1.5 rounded cursor-pointer transition ${
                      isSubSelected ? 'seg-on ring-2' : 'seg'
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBatterClick(side, player.battingOrder);
                        }}
                        className="w-4 text-gray-300 text-xs hover:text-blue-400 transition font-bold"
                      >
                        {player.battingOrder}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePositionClick(side, player.id);
                        }}
                        className={`w-6 text-center rounded text-sm py-0.5 font-bold transition ${
                          isPositionSelected
                            ? 'bg-purple-600 text-white ring-2 ring-purple-400'
                            : getPositionColor(player.position) + ' hover:opacity-80'
                        }`}
                      >
                        {posNames[player.position]}
                      </button>
                      <span className="font-medium text-base truncate flex-1">
                        {player.name}
                        <span className={`ml-0.5 text-xs ${CONDITION_COLORS[player.condition ?? CONDITION_LEVELS.NORMAL]}`}>{CONDITION_ICONS[player.condition ?? CONDITION_LEVELS.NORMAL]}</span>
                      </span>
                      {player.number != null && player.number !== '' && <span className="text-xs text-gray-400 font-mono font-bold">#{player.number}</span>}
<span className="text-sm text-gray-300 font-semibold">{throwHand}{batHand}</span>
                      {isSubSelected && <span className="text-blue-300 animate-pulse">◀</span>}
                      {isSelected && <span className="text-blue-300 animate-pulse">◀</span>}
                      {isPositionSelected && <span className="text-purple-300 animate-pulse">◀</span>}
                    </div>
                    <div className="ml-9 mt-0.5">
                      <div className="flex gap-3 text-xs text-gray-400 font-bold">
                        <span className="w-7 text-center">ミ</span>
                        <span className="w-7 text-center">パ</span>
                        <span className="w-7 text-center">走</span>
                        <span className="w-7 text-center">肩</span>
                        <span className="w-7 text-center">守</span>
                      </div>
                      <div className="flex gap-3 text-sm font-bold">
                        <span className={`w-7 text-center ${getAbilityTextColor(player.batting.meet)}`}>{player.batting.meet}</span>
                        <span className={`w-7 text-center ${getAbilityTextColor(player.batting.power)}`}>{player.batting.power}</span>
                        <span className={`w-7 text-center ${getAbilityTextColor(player.physical.speed)}`}>{player.physical.speed}</span>
                        <span className={`w-7 text-center ${getAbilityTextColor(player.physical.arm)}`}>{player.physical.arm}</span>
                        <span className={`w-7 text-center ${getAbilityTextColor(player.fielding.defense)}`}>{player.fielding.defense}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* 右: 控え選手 */}
        <div>
          <div className="text-xs text-gray-300 mb-1 px-1 font-semibold">ベンチメンバー</div>
          <div className="space-y-0.5 text-xs max-h-[calc(100vh-350px)] overflow-y-auto">
            <BenchList team={team} side={side} selectedSubstitute={selectedSubstitute}
              handleSubstituteClick={handleSubstituteClick} getPositionColor={getPositionColor} />
          </div>
        </div>
      </div>
    ) : (
      /* 試合中/試合終了後は現在フィールドにいる選手のみ表示 */
      <div className="mb-2">
        <div className="space-y-1 text-sm max-h-[calc(100vh-200px)] overflow-y-auto">
          {team.players
            .filter(p => {
              // 試合終了後：実際に出場した選手のみ
              if (gameOver) {
                const hasBattingStats = p.stats?.batting && (p.stats.batting.atBats > 0 || p.stats.batting.walks > 0 || p.stats.batting.hits > 0);
                const hasPitchingStats = p.stats?.pitching && p.stats.pitching.outs > 0;
                const isOnField = p.isStarter && !p.hasSubbedOut && p.battingOrder > 0;
                return hasBattingStats || hasPitchingStats || isOnField;
              }
              // 試合中：現在フィールドにいる選手
              return p.isStarter && !p.hasSubbedOut && p.battingOrder > 0;
            })
            .sort((a, b) => a.battingOrder - b.battingOrder)
            .map(player => {
            const isCurrentBatter = gameStarted && isBatting && player.battingOrder === team.currentBatterOrder;
            const isPitcher = player.position === 'pitcher';
            const posNames = POSITION_NAMES;
            const getPosColor = (pos) => getPositionColorHighlighted(pos, isCurrentBatter);

          const throwHand = player.physical.throws === 'right' ? '右' : '左';
          const batHand = player.batting.bats === 'right' ? '右' : player.batting.bats === 'left' ? '左' : '両';

          const isSelected = !gameStarted && selectedBatter === player.battingOrder;
          const isPositionSelected = !gameStarted && selectedPosition === player.id;
          const isSubSelected = gameStarted && selectedSubstitute === player.id;
          const isSubbedOut = player.hasSubbedOut;
          const fitness = calculateDefensiveFitness(player, player.position);

          return (
            <div
              key={player.id}
              onClick={() => {
                if (gameStarted && !isSubbedOut) {
                  handleSubstituteClick(side, player.id);
                } else if (!gameStarted) {
                  handleBatterClick(side, player.battingOrder);
                }
              }}
              className={`p-2 rounded transition ${
                isSubbedOut ? 'opacity-50 cursor-not-allowed' :
                isCurrentBatter ? 'bg-yellow-500 text-black cursor-pointer' :
                isSubSelected ? 'bg-orange-600 text-white ring-2 ring-orange-400 cursor-pointer' :
                isSelected ? 'seg-on cursor-pointer' : 'seg cursor-pointer'
              }`}
            >
              <div className="flex items-center gap-1.5 overflow-hidden">
                <span className={`w-5 shrink-0 ${isCurrentBatter ? 'text-black font-bold' : isSelected ? 'text-white font-bold' : 'text-gray-300'}`}>{player.battingOrder}</span>
                {!gameStarted ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePositionClick(side, player.id);
                    }}
                    className={`w-6 shrink-0 text-center rounded text-xs py-0.5 font-semibold transition ${
                      isPositionSelected
                        ? 'bg-purple-600 text-white ring-2 ring-purple-400'
                        : getPosColor(player.position) + ' hover:opacity-80'
                    }`}
                  >
                    {posNames[player.position]}
                  </button>
                ) : (
                  <span className={`w-6 shrink-0 text-center rounded text-sm py-0.5 font-bold ${getPosColor(player.position)}`}>{posNames[player.position]}</span>
                )}
                <span className="font-bold truncate">{player.name}</span>
                <span className={`text-xs shrink-0 ${CONDITION_COLORS[player.condition ?? CONDITION_LEVELS.NORMAL]}`}>{CONDITION_ICONS[player.condition ?? CONDITION_LEVELS.NORMAL]}</span>
                <span className={`text-xs shrink-0 ${isCurrentBatter ? 'text-yellow-800' : isSelected ? 'text-blue-200' : 'text-gray-300'}`}>{throwHand}{batHand}</span>
                <span className="flex-1"></span>
                {isSubbedOut && <span className="text-red-400 text-xs shrink-0">交代済</span>}
                {isCurrentBatter && <span className="shrink-0">⚾</span>}
                {isSubSelected && <span className="text-orange-300 shrink-0">⚡</span>}
                {isSelected && <span className="shrink-0">👆</span>}
                {isPositionSelected && <span className="shrink-0">🔄</span>}
              </div>
              {/* 2行目: 成績（打率・本塁打・打点）と打席結果。
                  打席結果を1行目に置くと選手名が切れるのでこちらへ移した。
                  成績は固定幅の右寄せで縦に揃えつつ、間隔を詰めて1かたまりに見せる。
                  バッジは右端に寄せ、入り切らない場合は**古い方から隠れる**
                  （justify-end + overflow-hidden） */}
              {gameStarted ? (
                <div className="flex items-center gap-2 ml-6 mt-0.5 text-xs">
                  <div className={`flex gap-1 font-bold tabular-nums shrink-0 ${isCurrentBatter ? 'text-yellow-800' : 'text-white'}`}>
                    {(() => {
                      const ss = player.seasonStats?.batting;
                      if (ss && ss.atBats > 0) {
                        const avg = (ss.hits / ss.atBats).toFixed(3);
                        return <>
                          <span className="w-8 text-right">.{avg.split('.')[1]}</span>
                          <span className="w-9 text-right">{ss.homeruns || 0}本</span>
                          <span className="w-10 text-right">{ss.rbis || 0}点</span>
                        </>;
                      }
                      if (isPitcher) {
                        const ps = player.seasonStats?.pitching;
                        if (ps && ps.inningsPitched > 0) {
                          const era = ((ps.earnedRuns || 0) * 27 / ps.inningsPitched).toFixed(2);
                          return <span>防御率 {era}</span>;
                        }
                      }
                      return <span className={isCurrentBatter ? '' : 'text-gray-300'}>出場なし</span>;
                    })()}
                  </div>
                  {player.gameStats?.atBatResults?.length > 0 && (
                    /* **左から右へ増やす**。右寄せ(justify-end)にすると
                       打席が増えるたびに既存のバッジが左へずれて落ち着かない。
                       先頭から並べれば N打席目は常に同じ位置に出る。
                       slice も先頭からにすること（-6 だと6打席目で全部ずれる） */
                    <div className="flex gap-0.5 flex-1 min-w-0 overflow-hidden">
                      {player.gameStats.atBatResults.slice(0, 6).map((r, i) => (
                        <span key={i} title={r}
                          style={{ textAlignLast: 'justify' }}
                          className={`w-10 shrink-0 px-0.5 rounded text-white font-bold tracking-tight ${atBatResultColor(r)}`}>
                          {formatAtBatResult(r)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className={`grid grid-cols-4 gap-1 text-xs ml-6 mt-0.5 tabular-nums ${isSelected ? 'text-blue-200' : 'text-gray-300'}`}>
                    <span>M{player.batting.meet}</span>
                    <span>P{player.batting.power}</span>
                    <span>E{player.batting.eye}</span>
                    <span className={isSelected ? 'text-blue-200' : 'text-blue-300'}>
                      {isPitcher ? `⚡${player.pitching.velocity}` : ''}
                    </span>
                  </div>
                  <div className={`text-xs ml-6 mt-0.5 ${
                    fitness.grade === 'S' ? 'text-yellow-400' :
                    fitness.grade === 'A' ? 'text-green-400' :
                    fitness.grade === 'B' ? 'text-blue-400' :
                    fitness.grade === 'D' ? 'text-red-400' :
                    'text-gray-300'
                  }`}>
                    守備適性 [{fitness.grade}] {fitness.comments}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* 試合中の選手交代アコーディオン */}
      <div className="mt-2">
        <button
          onClick={() => setShowBench(!showBench)}
          className="w-full p-2 bg-surface-2 hover:bg-gray-700 rounded text-sm text-orange-400 font-semibold transition flex items-center justify-between"
        >
          <span>⚡ 選手交代</span>
          <span>{showBench ? '▼' : '▶'}</span>
        </button>

        {showBench && (
          <div className="mt-2 space-y-1 text-xs max-h-64 overflow-y-auto">
            <BenchList team={team} side={side} selectedSubstitute={selectedSubstitute}
              handleSubstituteClick={handleSubstituteClick} getPositionColor={getPositionColor} />
          </div>
        )}
      </div>
    </div>
    )}

    {/* このチームの試合スタッツ/投手詳細 */}
    <TeamPitcherPanel team={team} gameStarted={gameStarted} />
  </div>
);
