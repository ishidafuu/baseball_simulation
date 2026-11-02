// オンライン画面で共用する小さな部品（ボタンの並び・球団マーク・疲労・残り時間・下から出るシート）。
// ⚠ 見た目の値は online.css のトークン（`--ol-*`）を使う。ここで色を直書きしない
//    （球団色だけは例外。球団名から決まる色なので計算で出す）。
import React, { useEffect, useRef } from 'react';
import { teamLabel, teamShort } from './gameText.js';
import { inOnlineRoot } from './portal.js';

/**
 * 横並びの切り替えボタン（セグメント）。
 * ⚠ **選択肢が6個以上ならセレクトにする**。ボタンを並べると折り返して読めない。
 *    5個以下はボタンの方が「何が選べるか」が開かずに分かる（スマホのOSピッカーも出ない）。
 */
export function Segmented({ label, value, options, onChange, disabled, small }) {
  const entries = Array.isArray(options) ? options : Object.entries(options);
  if (entries.length > 5)
    return (
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {entries.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    );
  return (
    <div
      className={`online-segments${small ? ' is-small' : ''}`}
      role="group"
      aria-label={label}
    >
      {entries.map(([id, text]) => (
        <button
          key={id}
          type="button"
          data-value={id}
          aria-pressed={String(value) === String(id)}
          disabled={disabled}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

// 球団の色。名前から決めるので、保存データには持たない（表示専用）。
// ⚠ 色相だけ散らし、明度・彩度は揃える（暗い地の上で同じ読みやすさにするため）。
const HUES = [4, 28, 48, 96, 150, 176, 198, 218, 248, 276, 304, 334];
export function teamHue(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return HUES[h % HUES.length];
}
/** 球団の頭文字の丸マーク */
export function TeamBadge({ team, size = 'md' }) {
  const short = teamShort(team) || '';
  return (
    <span
      className={`online-team-badge is-${size}`}
      style={{ '--team-hue': teamHue(team) }}
      title={teamLabel(team)}
      aria-hidden="true"
    >
      {short.slice(0, 1)}
    </span>
  );
}
/** 球団マーク＋名前 */
export function TeamName({ team, short = false }) {
  return (
    <span className="online-team-name">
      <TeamBadge team={team} size="sm" />
      <span>{short ? teamShort(team) : teamLabel(team)}</span>
    </span>
  );
}

/**
 * 疲労の3段階。
 * ⚠ **投手と野手で尺度が違う**。投手は40以上で先発・登板の候補から外れる
 *    （`autoSimulation.js` の `PITCHER_REST_FATIGUE_THRESHOLD`）。野手は
 *    能力の減り方が 疲労²÷1200 なので、100で約8、190で約30下がる。
 *    数値をそのまま出すと「191」が危険なのか分からなかった。
 */
export function fatigueLevel(player) {
  const f = player?.fatigue;
  if (typeof f !== 'number' || !Number.isFinite(f)) return null;
  const [tired, rest] = player.position === 'pitcher' ? [20, 40] : [40, 100];
  return f >= rest ? 2 : f >= tired ? 1 : 0;
}
const FATIGUE_TEXT = ['元気', '疲れ気味', '要休養'];
export function FatigueMark({ player, compact = false }) {
  const level = fatigueLevel(player);
  if (level === null) return <span className="online-fatigue">—</span>;
  return (
    <span
      className={`online-fatigue is-${level}`}
      title={`疲労 ${player.fatigue}（${FATIGUE_TEXT[level]}）`}
      aria-label={`疲労: ${FATIGUE_TEXT[level]}`}
    >
      {compact ? ['○', '△', '×'][level] : FATIGUE_TEXT[level]}
    </span>
  );
}

const WEEK = '日月火水木金土';
/** 日本時間の「11/8(日) 21:00」 */
export function formatJst(iso, { time = true } = {}) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 9 * 3600000);
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]})${time ? ` ${d.getUTCHours()}:${minutes}` : ''}`;
}
/** 「あと6時間」「あと25分」。過ぎていれば「まもなく」 */
export function remaining(iso, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 60000) return 'まもなく';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `あと${minutes}分`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `あと${hours}時間`;
  return `あと${Math.floor(hours / 24)}日`;
}
/** ゲーム内の日付に曜日を付ける（「4/29(月)」） */
export function gameDay(date) {
  if (!date) return '';
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return `${date.month}/${date.day}(${WEEK[d.getUTCDay()]})`;
}

/**
 * 下から出るシート（スマホの選択用）。PCでは中央のダイアログになる。
 * ⚠ `.online` の中へポータルで出す。スコア欄などの中で描くと、
 *    親の `display:grid` 指定が漏れて崩れる（観戦リプレイで実際に起きた）。
 */
export function Sheet({ title, close, children, footer }) {
  const dialog = useRef(null);
  useEffect(() => {
    const node = dialog.current;
    const trigger = document.activeElement;
    node?.showModal?.();
    return () => {
      if (node?.open) node.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return inOnlineRoot(
    <dialog
      ref={dialog}
      className="online-sheet"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="online-icon-button" aria-label="閉じる" onClick={close}>
          ×
        </button>
      </header>
      <div className="online-sheet-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>,
  );
}

/**
 * 画面下の通知（トースト）を出す関数を配る。
 * `notify('打順を保存しました', { undo: () => … })` のように「元に戻す」を付けられる。
 */
export const NotifyContext = React.createContext(() => {});
export const useNotify = () => React.useContext(NotifyContext);
