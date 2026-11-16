import React from 'react';
import { POS } from './api.js';

// ============================================================
// 年齢構成と3年後の見込み（自球団）。出す場所: PC の選手成績（自球団を見ているとき。`DesktopView.jsx`）と、
// 手続きのトライアウト・契約更改（PC・スマホWeb とも `LeaguePanels.jsx` の PhasePanel。compact）。
// アプリは選手の「年齢」と、手続きのトライアウト・契約更改（compact）。
// ⚠ 数字と文はサーバーが作る（`ageOutlook.js`）。アプリ（`PlayersScreen.kt` の AgeOutlookCard）と同じ並び。
// ============================================================

const KIND_LABEL = { rising: 'まだ伸びる', peak: 'ピークの近く', decline: '下り坂の見込み' };

export default function AgeOutlook({ outlook, compact = false }) {
  if (!outlook) return null;
  const most = Math.max(1, ...outlook.bands.map((b) => b.pitchers + b.fielders));
  return (
    <section className="online-card online-age-outlook" aria-label="年齢構成と3年後の見込み">
      <h2>年齢構成と{outlook.years}年後の見込み</h2>
      <div className="online-age-bands">
        {outlook.bands.map((b) => (
          <div key={b.label} className="online-age-band">
            <span>{b.label}</span>
            <div className="online-age-bar" aria-hidden="true">
              <i className="is-fielder" style={{ width: `${(b.fielders / most) * 100}%` }} />
              <i className="is-pitcher" style={{ width: `${(b.pitchers / most) * 100}%` }} />
            </div>
            <small>
              野手{b.fielders}・投手{b.pitchers}
            </small>
          </div>
        ))}
      </div>
      <div className="online-news-list">
        {outlook.lines.map((t, i) => (
          <article key={i}>
            <span>{t}</span>
          </article>
        ))}
        <article>
          <b>{outlook.advice}</b>
        </article>
      </div>
      {!compact && (
        <table className="online-standings online-age-core">
          <thead>
            <tr>
              <th>主力</th>
              <th>位置</th>
              <th>いま</th>
              <th>{outlook.years}年後</th>
              <th>見込み</th>
            </tr>
          </thead>
          <tbody>
            {outlook.core.map((r) => (
              <tr key={r.id} className={r.kind === 'decline' || r.veteran ? 'is-warn' : ''}>
                <th>{r.name}</th>
                <td>{POS[r.position] || '—'}</td>
                <td>{r.age}歳</td>
                <td>{r.later}歳</td>
                <td>
                  {KIND_LABEL[r.kind]}
                  {r.veteran ? '・引退が近い年齢' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="online-muted">
        見込みは成長力とプロ意識から決まるピーク年齢で見ています（乱数なし）。練習や出場で前後します。
      </p>
    </section>
  );
}
