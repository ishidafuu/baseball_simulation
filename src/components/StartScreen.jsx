import React, { useState, useEffect } from 'react';
import { getEmergencyInfo, promoteEmergencyToSlot, clearEmergencySave, getAutosaveInfo, isAutosaveEnabled, setAutosaveEnabled } from '../game/saveSystem.js';
import { isTutorialEnabled, setTutorialEnabled, resetTutorialProgress } from '../game/tutorial.js';
import { getUiScale, cycleUiScale, UI_SCALE_LABEL } from '../game/uiSettings.js';
import { askConfirm } from '../utils/gameDialog.js';

/**
 * タイトル画面の球場パレット。
 * ⚠ ここは**タイトル画面専用**。本編のUIは surface-*／accent の語彙で、
 *   試合画面は電光掲示板（オレンジのLED）の語彙。混ぜないこと。
 */
const FIELD = {
  night:  '#141b24',   // ナイターの空・スタンドの影
  sky:    '#0a111a',   // 空の天頂（夜はてっぺんが一番暗い）
  stand:  '#0d141d',   // スタンドのシルエット
  lamp:   '#dbeafe',   // 照明の光（⚠ 白ではなく**青白い**。白だと電球色に見える）
  turfHi: '#2c4a33',   // 芝（手前）
  turfLo: '#1d3324',   // 芝（奥）
  dirtHi: '#7a5540',   // 内野の土（手前）
  dirtLo: '#5b3f2f',   // 内野の土（奥）
  chalk:  '#f2f0e8',   // 白線・チョーク
  ball:   '#22c55e',   // 本編と同じ意味色: 緑=ボール
  strike: '#facc15',   // 黄=ストライク
  out:    '#ef4444',   // 赤=アウト
};

/**
 * 照明塔。⚠ **x は 290〜1310 の内側に置くこと**。
 *   viewBox は `slice` なので縦長の画面では左右が切られ、実測（1440×900）で
 *   見えているのは x=240〜1360 だけだった。端に置くと画面から消える。
 */
const LightTower = ({ x, flip = false }) => (
  <g transform={`translate(${x},0)${flip ? ' scale(-1,1)' : ''}`}>
    {/* 支柱。⚠ **空より明るい灰**にすること。`stand` と同じ色だと夜空に沈んで、
        ランプだけが宙に浮いた「点の格子」に見えた（実測でそうなった） */}
    <rect x="-5" y="150" width="10" height="210" fill="#243040" />
    <rect x="-5" y="150" width="2" height="210" fill="#3b4b60" />
    <path d="M-5,360 L-24,360 L-5,248 Z" fill="#1c2634" />
    {/* ランプの箱（格子） */}
    <rect x="-54" y="94" width="108" height="60" rx="5" fill="#222d3c" />
    <rect x="-54" y="94" width="108" height="2" rx="1" fill="#44566e" />
    <g className="ns-flicker">
      {/* にじみ（先に敷く） */}
      {[0, 1, 2].map(r => [0, 1, 2, 3, 4].map(c => (
        <circle key={`g${r}-${c}`} cx={-40 + c * 20} cy={110 + r * 17} r="13"
                fill={FIELD.lamp} opacity={0.16} />
      )))}
      {[0, 1, 2].map(r => [0, 1, 2, 3, 4].map(c => (
        <circle key={`${r}-${c}`} cx={-40 + c * 20} cy={110 + r * 17} r="6.5"
                fill="#f8fbff" />
      )))}
    </g>
    {/* 光のにじみ。⚠ これが無いとランプが「ただの白い点の列」に見える */}
    <g className="ns-flicker">
      <ellipse cx="0" cy="124" rx="190" ry="130" fill="url(#ns-flare)" />
      <ellipse cx="0" cy="124" rx="70" ry="52" fill="url(#ns-flare)" />
    </g>
  </g>
);

/**
 * 捕手の後ろから内野を見た画。画像を持たずSVGだけで描く。
 * ⚠ **下端を基準に置くこと**（`xMidYMax slice`）。`xMidYMid` だと縦の短い画面で
 *   ホームベースと打席が下に切れ、土だけが残って「茶色いドーム」に見える。
 * ⚠ **土の扇は大きくしすぎない**。半径を上げると画面の主役が土になり、
 *   メニューが読みにくくなる。あくまで下3分の1に収める。
 */
const FieldBackdrop = () => (
  // ⚠ **viewBox の下端(700)は絵の下端(800)より上**。ベースを描かなくなったので、
  //    ファウルラインの**合流点が画面に写ると「線が1点で終わっている」不自然さ**が出る。
  //    座標はそのままに viewBox で下を切り落とし、合流点を画面外へ逃がしてある。
  //    ⚠ 高さを 800 に戻すと合流点が戻ってくる。
  <svg aria-hidden viewBox="0 0 1600 700" preserveAspectRatio="xMidYMax slice"
       className="pointer-events-none absolute inset-0 w-full h-full">
    <defs>
      <linearGradient id="ns-turf" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={FIELD.turfLo} /><stop offset="100%" stopColor={FIELD.turfHi} />
      </linearGradient>
      <linearGradient id="ns-dirt" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={FIELD.dirtLo} /><stop offset="100%" stopColor={FIELD.dirtHi} />
      </linearGradient>
      {/* 夜空。⚠ **てっぺんを一番暗く**すること。地平線side を暗くすると
          照明に照らされた空気の感じが消えて「ただの濃紺の板」になる */}
      <linearGradient id="ns-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={FIELD.sky} />
        <stop offset="70%" stopColor={FIELD.night} />
        <stop offset="100%" stopColor="#1b2634" />
      </linearGradient>
      {/* 照明のにじみ */}
      <radialGradient id="ns-flare">
        <stop offset="0%" stopColor={FIELD.lamp} stopOpacity="0.55" />
        <stop offset="45%" stopColor={FIELD.lamp} stopOpacity="0.16" />
        <stop offset="100%" stopColor={FIELD.lamp} stopOpacity="0" />
      </radialGradient>
      {/* 照明に照らされた空気。芝の上にうっすら乗せる */}
      <linearGradient id="ns-air" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={FIELD.lamp} stopOpacity="0.12" />
        <stop offset="100%" stopColor={FIELD.lamp} stopOpacity="0" />
      </linearGradient>
      {/* 空から芝への継ぎ目を溶かす（硬い水平線だと「帯」に見える） */}
      <linearGradient id="ns-haze" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={FIELD.night} stopOpacity="1" />
        <stop offset="100%" stopColor={FIELD.night} stopOpacity="0" />
      </linearGradient>
      {/* メニューの背後を落として文字を読ませる。球場の絵より可読性が優先 */}
      <radialGradient id="ns-scrim" cx="50%" cy="40%" r="56%">
        <stop offset="0%" stopColor={FIELD.night} stopOpacity="0.90" />
        <stop offset="65%" stopColor={FIELD.night} stopOpacity="0.55" />
        <stop offset="100%" stopColor={FIELD.night} stopOpacity="0" />
      </radialGradient>
      {/* 四隅を落とす（中継のレンズの感じ） */}
      <radialGradient id="ns-vignette" cx="50%" cy="50%" r="75%">
        <stop offset="62%" stopColor="#000" stopOpacity="0" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.38" />
      </radialGradient>
      {/* 粒子。⚠ **ごく薄く**（0.04 を超えると画面が汚れて見える） */}
      <filter id="ns-grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
    </defs>

    {/* 夜空 */}
    <rect width="1600" height="380" fill="url(#ns-sky)" />

    {/* スタンドのシルエット。⚠ 観客を描き込まないこと——この距離では
        粒が見えるだけで、描くほど density が上がって「砂嵐」になる。
        輪郭（屋根の傾き）と、まばらな光の粒だけで足りる */}
    <path d="M0,318 L300,292 L640,282 L960,282 L1300,292 L1600,318 V372 H0 Z" fill={FIELD.stand} />
    <g fill={FIELD.lamp} opacity="0.16">
      {Array.from({ length: 64 }, (_, i) => (
        <circle key={i} cx={20 + i * 25 + (i % 3) * 7} cy={300 + (i % 5) * 9} r="1.6" />
      ))}
    </g>

    {/* 芝 */}
    <path d="M0,360 H1600 V800 H0 Z" fill="url(#ns-turf)" />
    {/* 刈り跡。⚠ **手前ほど太くする**（等間隔だと遠近が消えて「縞の壁」になる） */}
    <g fill={FIELD.chalk} opacity="0.028">
      {(() => {
        const bands = []; let y = 360, h = 13;
        for (let i = 0; i < 11; i++) {
          if (i % 2 === 0) bands.push(<rect key={i} x="0" y={y} width="1600" height={h} />);
          y += h; h = Math.round(h * 1.30);
        }
        return bands;
      })()}
    </g>
    {/* 内野の土。⚠ **半円にしないこと**——真ん中が盛り上がって「茶色いドーム」に見える。
        実際の内野はホームから外へ広がる楔なので、**ファウルラインで挟んだ形**にする。 */}
    {/* ホーム周りの土（実際の球場にある円）。これが無いと楔の先端が尖って矢印に見える */}
    <ellipse cx="800" cy="770" rx="240" ry="118" fill={FIELD.dirtHi} fillOpacity="0.92" />
    <path d="M800,800 L332,474 Q800,398 1268,474 Z" fill="url(#ns-dirt)" />
    <path d="M332,474 Q800,398 1268,474"
          fill="none" stroke={FIELD.chalk} strokeOpacity="0.16" strokeWidth="3" />
    {/* 投手板。楔の中心に置くと一気に「球場」に見える */}
    <ellipse cx="800" cy="596" rx="62" ry="20" fill={FIELD.dirtHi} fillOpacity="0.75" />
    <rect x="782" y="590" width="36" height="6" rx="2" fill={FIELD.chalk} fillOpacity="0.55" />
    {/* ファウルライン。⚠ **ホームベースと打席は描かない**——手前に来るものほど
        遠近の圧縮が強く、線・ベース・打席の3つを1枚の絵で辻褄を合わせられなかった
        （打席をラインの外へ出すと今度はベースから離れて浮く）。
        球場に見せているのは**土の楔と白線と投手板**で、そこは成立している。
        手前の小物は無い方が絵が締まるので、描かないことにした。 */}
    <g stroke={FIELD.chalk} strokeOpacity="0.45" strokeWidth="4" fill="none" strokeLinecap="round">
      <path d="M800,806 L140,372" />
      <path d="M800,806 L1460,372" />
    </g>

    <rect y="300" width="1600" height="120" fill="url(#ns-haze)" />
    {/* 照明に照らされた空気。芝の上に薄く乗せると奥行きが出る */}
    <rect className="ns-drift" y="330" width="1600" height="230" fill="url(#ns-air)" />
    <rect width="1600" height="800" fill="url(#ns-scrim)" />
    {/* ⚠ **照明塔はスクリムより手前に描くこと**。スクリムはメニューの背後を
        落とすための暗幕だが、半径が広いので塔にも掛かる。先に描いていたときは
        実測で**不透明度0.62の黒**が光源に乗り、ランプが灰色の点の格子に見えた。
        照明は画面で一番明るいものなので、暗幕の影響を受けさせない。 */}
    <LightTower x={380} />
    <LightTower x={1220} flip />
    <rect width="1600" height="800" fill="url(#ns-vignette)" />
    <rect width="1600" height="800" filter="url(#ns-grain)" opacity="0.035" />
  </svg>
);

const PHASE_NAMES = {
  regular_season: 'レギュラーシーズン',
  playoff: 'プレーオフ',
  draft: 'ドラフト',
  offseason: 'オフシーズン',
  camp: 'キャンプ',
  tryout: 'トライアウト',
};

const StartScreen = ({ onNewGame, onSandbox, onContinue, onEdit, onEditCorporateNames, onManual, onContinueAutosave, hasSaveData, saveSlots = [] }) => {
  const [showSlotSelect, setShowSlotSelect] = useState(false);
  const [showEditSlotSelect, setShowEditSlotSelect] = useState(false);
  const [emergencyInfo, setEmergencyInfo] = useState(null);
  const [autosaveInfo, setAutosaveInfo] = useState(null);
  const [tutorialOn, setTutorialOn] = useState(isTutorialEnabled());
  const [autosaveOn, setAutosaveOn] = useState(isAutosaveEnabled());
  const [uiScale, setUiScaleState] = useState(getUiScale());

  // 前回クラッシュ時の緊急バックアップ／オートセーブの有無をチェック
  useEffect(() => {
    setEmergencyInfo(getEmergencyInfo());
    getAutosaveInfo().then(setAutosaveInfo);
  }, []);

  const fmtDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const handleRestoreEmergency = async (slotIndex) => {
    if (!(await askConfirm(`緊急バックアップをスロット${slotIndex + 1}へ復元してプレイします。よろしいですか？`))) return;
    const r = await promoteEmergencyToSlot(slotIndex);
    if (r.success) {
      clearEmergencySave();
      setEmergencyInfo(null);
      onContinue(slotIndex);
    }
  };

  const hasAutosave = !!(autosaveInfo && onContinueAutosave);
  const canContinue = hasSaveData || hasAutosave;

  const handleContinue = () => {
    const filledSlots = saveSlots.map((s, i) => s ? i : -1).filter(i => i >= 0);
    // オートセーブ選択肢が無く、スロットが1つだけなら直接その1件を続行
    if (filledSlots.length === 1 && !hasAutosave) {
      onContinue(filledSlots[0]);
      return;
    }
    setShowSlotSelect(true);
  };

  const handleEdit = () => {
    setShowEditSlotSelect(true);
  };

  // セーブスロット1件ぶんの行。コンティニュー／エディットで共有する
  const SlotRow = ({ slot, index, onPick }) => (
    <button
      key={index}
      onClick={() => slot && onPick(index)}
      disabled={!slot}
      className={`w-full text-left px-4 py-2.5 rounded-lg border transition ${
        slot ? 'bg-surface-2 border-gray-700 hover:border-[var(--accent)] hover:bg-gray-700/60'
             : 'bg-transparent border-gray-800 cursor-not-allowed'}`}
    >
      {/* ⚠ **1行に収めること**。各要素に `whitespace-nowrap shrink-0` を付けないと、
          長いチーム名（「埼玉武蔵ヒートベアーズ」等）に押されて「スロット」と「1」の
          間で折り返し、行が2段になる。**伸縮していいのはチーム名だけ**。 */}
      <div className="flex items-baseline gap-2">
        <span className={`text-base font-bold whitespace-nowrap shrink-0 ${slot ? 'text-white' : 'text-gray-400'}`}>
          スロット{index + 1}
        </span>
        {slot ? (
          <>
            <span className="text-xs text-gray-300 tabular-nums whitespace-nowrap shrink-0">
              {slot.year}年目 {slot.date.month}/{slot.date.day}
            </span>
            {slot.teamName && (
              <span className="text-xs text-gray-100 truncate min-w-0 flex-1">{slot.teamName}</span>
            )}
            {slot.timestamp && (
              <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap shrink-0 ml-auto">
                {new Date(slot.timestamp).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-gray-400">空</span>
        )}
      </div>
    </button>
  );

  // メニューを載せるカード。本編のカード（surface-2 + gray-700）と同じ見た目にする
  // メニューを載せるカード。⚠ 導入画面だけの素材（`.glass-panel`）を使う。
  //    本編のカード（surface-2 + gray-700）と同じ見た目だと、球場の絵の上で
  //    ただの灰色の箱になって浮かなかった
  const MenuCard = ({ title, children }) => (
    <div className="w-full max-w-xl rounded-2xl glass-panel p-7">
      {title && <p className="text-sm text-gray-300 mb-3">{title}</p>}
      {children}
    </div>
  );

  return (
    // ⚠ **タイトル画面の地は「球場」**。捕手の後ろから内野を見た画を土色と白線で描く。
    //    以前は `radial-gradient` のアクセントのにじみ＋大文字字間空けのサブタイトルという、
    //    **題材と無関係な定番の意匠**だった（洗練はされているが野球に見えない）。
    //    ⚠ **電光掲示板の語彙（オレンジのLED・グロー）は持ち込まないこと**。
    //    あれは「現地で試合を見ている」ための演出で、試合画面だけのもの。
    // ⚠ **中央に据える**。以前は「メニューがホームベースの真上に重なる」ので
    //    上寄せにしていたが、**そのベースと打席はもう描いていない**（遠近が
    //    合わなかったため撤去）。隠れて困るものが無くなったので前提が消えている。
    // data-fit-height: 1画面に収める設計の画面という印。縦が足りない端末
    // （1366×640 / 1280×600）では App.jsx の自動フィットが縮めて収める。
    // ⚠ これが無いと 640 で44px・600 で84px はみ出す。
    <div data-fit-height className="min-h-screen relative overflow-hidden flex items-center justify-center py-8"
         style={{ backgroundColor: FIELD.sky }}>
      <FieldBackdrop />

      <div className="relative w-full max-w-xl px-6 flex flex-col items-center">
        {/* タイトル。白線と同じチョーク色を基調に、上を明るく下を沈めて厚みを出す。
            ⚠ `background-clip: text` を使うので、影は `text-shadow` ではなく
            `drop-shadow` で掛けること（文字色が transparent になるため）。
            ⚠ 2本目の drop-shadow は**照明の色**（青白）。ここを白にすると
            ただのボケになり、球場の光に照らされている感じが出ない。 */}
        <h1 className="text-7xl font-black tracking-tight leading-none"
            style={{
              backgroundImage: 'linear-gradient(180deg,#ffffff 0%,#f2f0e8 44%,#aeb8c4 100%)',
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
              filter: `drop-shadow(0 3px 20px rgba(0,0,0,0.65)) drop-shadow(0 0 30px ${FIELD.lamp}30)`,
            }}>
          NEXT STAGE
        </h1>
        {/* ロゴの下に1本。両端を消してアクセントの帯に見せる（枠にしない） */}
        <div className="mt-4 h-px w-72"
             style={{ background: `linear-gradient(90deg,transparent,var(--accent),transparent)`, opacity: 0.75 }} />
        {/* ⚠ 罫線で挟んだ大文字サブタイトルは定番手なのでやめた。
            代わりに**カウントのランプ**（緑=ボール / 黄=ストライク / 赤=アウト）を置く。
            本編の意味色そのままなので、この作品の語彙で「野球」と言える。 */}
        <div className="mt-5 mb-8 flex items-center gap-3">
          {[FIELD.ball, FIELD.ball, FIELD.strike, FIELD.strike, FIELD.out].map((c, i) => (
            <span key={i} className="w-3.5 h-3.5 rounded-full"
                  style={{ backgroundColor: c, boxShadow: `0 0 8px ${c}` }} />
          ))}
          <span className="ml-2 text-base font-bold" style={{ color: FIELD.chalk }}>野球シミュレーター</span>
        </div>

        {/* 緊急バックアップ復旧（前回クラッシュ時に自動保存されたデータ） */}
        {emergencyInfo && !showSlotSelect && !showEditSlotSelect && (
          <div className="w-full max-w-sm mb-4 p-3 rounded-xl border border-amber-600/60 bg-amber-900/20 text-left">
            <div className="text-amber-300 font-bold text-sm mb-1">緊急バックアップが見つかりました</div>
            <p className="text-xs text-gray-300 mb-2">
              前回アプリが予期せず終了した際の進行データ（{emergencyInfo.year ? `${emergencyInfo.year}年目・` : ''}{emergencyInfo.gameMode || ''}）です。復元先を選んでください。
            </p>
            <div className="flex gap-2 flex-wrap">
              {[0, 1, 2].map(i => (
                <button key={i} onClick={() => handleRestoreEmergency(i)} className="btn-warn px-3 py-1.5 rounded text-xs">
                  スロット{i + 1}へ復元
                </button>
              ))}
              <button onClick={() => { clearEmergencySave(); setEmergencyInfo(null); }}
                className="btn-secondary px-3 py-1.5 rounded text-xs">破棄</button>
            </div>
          </div>
        )}

        {/* メニュー */}
        {showSlotSelect ? (
          <MenuCard title="つづきから">
            <div className="space-y-2">
              {saveSlots.map((slot, index) => <SlotRow key={index} slot={slot} index={index} onPick={onContinue} />)}
            </div>
            {autosaveInfo && onContinueAutosave && (
              <>
                <div className="border-t border-gray-700/60 my-3" />
                <button onClick={onContinueAutosave}
                  className="btn-primary w-full px-4 py-2.5 rounded-lg text-sm transition active:scale-[0.99]">
                  オートセーブから続ける
                  <span className="ml-2 text-xs font-normal opacity-70 tabular-nums">
                    {autosaveInfo.year ? `${autosaveInfo.year}年目` : ''}{autosaveInfo.date ? ` ${autosaveInfo.date.month}月` : ''}{fmtDate(autosaveInfo.timestamp) ? `・${fmtDate(autosaveInfo.timestamp)}` : ''}
                  </span>
                </button>
              </>
            )}
            <button onClick={() => setShowSlotSelect(false)}
              className="mt-3 w-full text-sm text-gray-300 hover:text-white py-2 transition">← 戻る</button>
          </MenuCard>
        ) : showEditSlotSelect ? (
          <MenuCard title="編集するデータ">
            <div className="space-y-2">
              {saveSlots.map((slot, index) => <SlotRow key={index} slot={slot} index={index} onPick={onEdit} />)}
            </div>
            <div className="border-t border-gray-700/60 my-3" />
            <button onClick={onEditCorporateNames}
              className="btn-secondary w-full px-4 py-2.5 rounded-lg text-sm text-left transition">
              社会人チーム設定
              <span className="block text-xs font-normal opacity-70 mt-0.5">地域・強さ・種別・名前を編集（全セーブ共通）</span>
            </button>
            <button onClick={() => setShowEditSlotSelect(false)}
              className="mt-3 w-full text-sm text-gray-300 hover:text-white py-2 transition">← 戻る</button>
          </MenuCard>
        ) : (
          <MenuCard>
            {/* ⚠ `.btn-primary` は「次に押すもの」1つだけ。セーブがあれば
                つづきから、無ければ はじめから が次の一手になる */}
            <div className="space-y-2">
              <button
                onClick={handleContinue}
                disabled={!canContinue}
                className={`${canContinue ? 'btn-primary' : 'btn-secondary'} w-full px-6 py-4 rounded-xl text-xl transition active:scale-[0.99]`}
              >
                つづきから
              </button>
              <button
                onClick={onNewGame}
                className={`${canContinue ? 'btn-secondary' : 'btn-primary'} w-full px-6 py-4 rounded-xl text-xl transition active:scale-[0.99]`}
              >
                はじめから
              </button>
            </div>
            {window.location.protocol.startsWith('http') && <a href="/online" className="block mt-3 w-full text-center text-cyan-200 hover:text-white py-3 rounded-lg border border-cyan-700/60">オンラインペナント</a>}

            <div className="border-t border-gray-700/60 my-3" />

            <div className="grid grid-cols-2 gap-2">
              <button onClick={onSandbox} className="btn-secondary px-4 py-3 rounded-lg text-lg transition">箱庭モード</button>
              <button onClick={handleEdit} className="btn-secondary px-4 py-3 rounded-lg text-lg transition">エディット</button>
            </div>
            <button onClick={onManual}
              className="mt-2 w-full text-lg text-gray-300 hover:text-white py-2.5 rounded-lg hover:bg-gray-700/40 transition">
              マニュアル
            </button>

            <div className="border-t border-gray-700/60 my-3" />

            {/* 設定は主要アクションと同じ格にしない。1行に畳んで下に置く */}
            <div className="space-y-0.5">
              {[
                { label: 'チュートリアル', value: tutorialOn ? 'ON' : 'OFF', on: tutorialOn,
                  onClick: () => { const n = !tutorialOn; setTutorialEnabled(n); setTutorialOn(n); if (n) resetTutorialProgress(); },
                  title: 'ゲーム中に操作ヒントを表示するかどうか' },
                { label: 'オートセーブ', value: autosaveOn ? 'ON' : 'OFF', on: autosaveOn,
                  onClick: () => { const n = !autosaveOn; setAutosaveEnabled(n); setAutosaveOn(n); },
                  title: '月替わり・年替わりの節目で自動保存します' },
                { label: '画面スケール', value: UI_SCALE_LABEL[uiScale] || uiScale, on: true,
                  onClick: () => setUiScaleState(cycleUiScale()),
                  title: '画面が横にはみ出す場合は「自動」または縮小を選ぶと1画面に収まります' },
              ].map(o => (
                <button key={o.label} onClick={o.onClick} title={o.title}
                  className="w-full flex items-center justify-between text-base text-gray-300 hover:text-white px-1 py-1.5 transition">
                  <span>{o.label}</span>
                  <span className={`text-sm font-bold px-2.5 py-1 rounded ${o.on ? 'seg-on' : 'seg'}`}>{o.value}</span>
                </button>
              ))}
            </div>
          </MenuCard>
        )}

      </div>
    </div>
  );
};

export default StartScreen;
