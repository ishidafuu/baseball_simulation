import React from 'react';
import { POS } from './api.js';
import { PlayerStatsButton } from './PlayerPerformance.jsx';
import { teamLabel } from './gameText.js';

// ============================================================
// トライアウトの結果（自分の球団に入った選手と、交渉したのに他球団に取られた選手）。
//
// ⚠ 先方（main の持ち主）指摘「トライアウト後の入団選手の一覧が無く、誰が入ったか
//    わからない」。リーグ便りには全球団の指名が混ざって並ぶだけだった。
//    サーバーが参加者ごとに残す（`resolveTryout` → `view.lastTryout`）。
// ⚠ 見せ方は「オフの成長」（`OffseasonGrowth`）と同じカード。
//    名簿に居る人は名前を押すと能力が開く（退団などで居なければ名前だけ）。
// ============================================================

export default function TryoutResult({ view }) {
  const result = view?.lastTryout;
  if (!result) return null;
  const byId = new Map((view.roster || []).map((p) => [String(p.id), p]));
  const picks = result.picks || [];
  const lost = result.lost || [];
  const wished = picks.filter((p) => p.wish).length;
  return (
    <section className="online-card" aria-label="トライアウトの結果">
      <h2>
        {result.year}年目のトライアウトで入団した選手（{picks.length}人）
      </h2>
      <p className="online-muted">
        {picks.length === 0
          ? '今年のトライアウトで入団した選手はいません。'
          : `交渉して獲得 ${wished}人・自動で獲得 ${picks.length - wished}人。`}
      </p>
      {picks.length > 0 && (
        <ul className="online-camp-gain-list online-tryout-result">
          {picks.map((p) => {
            const player = byId.get(String(p.playerId));
            return (
              <li key={p.playerId}>
                <span className="online-camp-gain-name">
                  {player ? (
                    <PlayerStatsButton player={player} panel="abilities" />
                  ) : (
                    <span>{p.name}</span>
                  )}
                  <small>{POS[p.position]}</small>
                </span>
                <span className="online-camp-gain-items">
                  {/* ⚠ 年齢は名簿の今の値を出す。結果の年齢はトライアウト時点（11/10）で、
                      11/30 の年度更新で1つ上がるので、キャンプや翌シーズンには1つ若く出ていた */}
                  <span>{player?.age ?? p.age}歳</span>
                  <span>{p.round}巡目</span>
                  <strong className={p.wish ? 'is-wish' : undefined}>
                    {p.wish ? `交渉${p.wish}位` : '自動'}
                  </strong>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {lost.length > 0 && (
        <p className="online-muted">
          交渉したが他球団が獲得:{' '}
          {lost
            .map(
              (p) =>
                `${p.name}（交渉${p.wish}位・${POS[p.position] || ''}）→ ${teamLabel(p.takenBy)}`,
            )
            .join('、')}
        </p>
      )}
    </section>
  );
}
