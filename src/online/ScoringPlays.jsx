import React from 'react';
import { teamShort } from './gameText.js';
import { scoringLine } from './social.js';

/** 得点経過（「7回裏 佐藤 2ランホームラン（3-2）」） */
export function ScoringPlays({ game }) {
  const plays = game?.scoring;
  if (!Array.isArray(plays)) return null;
  return (
    <section className="online-scoring" aria-label="得点経過">
      <h3>得点経過</h3>
      {plays.length ? (
        <ol>
          {plays.map((p, i) => (
            <li key={i}>
              {scoringLine(p, {
                awayShort: teamShort(game.away),
                homeShort: teamShort(game.home),
              })}
            </li>
          ))}
        </ol>
      ) : (
        <p className="online-muted">両チーム無得点でした。</p>
      )}
    </section>
  );
}

