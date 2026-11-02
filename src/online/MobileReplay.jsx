import React, { useLayoutEffect, useRef, useState } from 'react';
import { replayLabel } from './replayText.js';
import { teamShort } from './gameText.js';
import { PageNav } from './PageNav.jsx';
import { getPitchTypeName } from '../utils/constants.js';
export default function MobileReplay({ game, close }) {
  const frames = game.replay?.frames || [];
  const halves = [
    ...new Set(frames.map((f) => `${f.inning}:${f.top ? 1 : 0}`)),
  ];
  const [half, setHalf] = useState(halves[0]),
    [all, setAll] = useState(false),
    [page, setPage] = useState(0),
    [chosen, setChosen] = useState(null),
    [size, setSize] = useState(4);
  const rows = useRef(null),
    layout = useRef(null);
  useLayoutEffect(() => {
    const measure = () => {
      if (rows.current) {
        const next = Math.max(1, Math.floor(rows.current.clientHeight / 44));
        const current = layout.current;
        if (next !== current.size) {
          const anchor = Math.max(
            0,
            current.chosen === null
              ? current.page * current.size
              : current.entries.findIndex((e) => e.index === current.chosen),
          );
          setChosen(current.entries[anchor]?.index ?? null);
          setPage(Math.floor(anchor / next));
          setSize(next);
        }
      }
    };
    measure();
    const observer = new window.ResizeObserver(measure);
    observer.observe(rows.current);
    return () => observer.disconnect();
  }, []);
  const seen = {},
    entries = [];
  frames.forEach((frame, index) => {
    const side = frame.top ? game.home : game.away;
    const changed =
      frame.kind === 'matchup' &&
      seen[side] !== undefined &&
      seen[side] !== frame.pitcherId;
    if (frame.kind === 'matchup') seen[side] = frame.pitcherId;
    if (`${frame.inning}:${frame.top ? 1 : 0}` !== half) return;
    const keep =
      frame.completed ||
      ['steal', 'wild_pitch'].includes(frame.kind) ||
      frame.pinchHit ||
      changed ||
      (all && ['pitch', 'bunt'].includes(frame.kind));
    if (keep)
      entries.push({
        frame,
        index,
        changed,
        text: changed
          ? `投手交代${frame.pinchHit ? '・代打' : ''}`
          : replayLabel(frame),
      });
  });
  layout.current = { page, size, chosen, entries };
  const visible = entries.slice(page * size, page * size + size);
  const selected = visible.find((e) => e.index === chosen) || visible[0];
  const fallback = frames.find((f) => `${f.inning}:${f.top ? 1 : 0}` === half);
  const frame = selected?.frame || fallback;
  const find = (team, id) => game.replay.teams[team]?.find((p) => p.id === id);
  const offense = frame?.top ? game.away : game.home,
    defense = frame?.top ? game.home : game.away;
  return (
    <section className="online-mobile-replay" aria-label="試合経過">
      <div className="online-mobile-replay-tools">
        <select
          aria-label="経過を見る回"
          value={half}
          onChange={(e) => {
            setHalf(e.target.value);
            setPage(0);
            setChosen(null);
          }}
        >
          {halves.map((key) => {
            const [inning, top] = key.split(':');
            return (
              <option key={key} value={key}>
                {inning}回{top === '1' ? '表' : '裏'}
              </option>
            );
          })}
        </select>
        <button
          aria-pressed={!all}
          onClick={() => {
            setAll(false);
            setPage(0);
            setChosen(null);
          }}
        >
          打席・走塁
        </button>
        <button
          aria-pressed={all}
          onClick={() => {
            setAll(true);
            setPage(0);
            setChosen(null);
          }}
        >
          全投球
        </button>
      </div>
      {frame && (
        <div
          className="online-mobile-play-state"
          data-frame-index={selected?.index}
        >
          <strong aria-label="経過のスコア">
            {teamShort(game.away)} {frame.awayScore} – {frame.homeScore}{' '}
            {teamShort(game.home)}
          </strong>
          <p>
            Ｂ{frame.balls} Ｓ{frame.strikes} Ｏ{frame.outs}{' '}
            {frame.pitch && (
              <b>
                {getPitchTypeName(frame.pitch.type)}{' '}
                {Math.round(frame.pitch.velocity)}km/h
              </b>
            )}
            <span>
              <b>{selected?.text}</b> · {find(defense, frame.pitcherId)?.name} →{' '}
              {find(offense, frame.batterId)?.name}
            </span>
          </p>
          <div className="online-mobile-runners">
            {frame.bases.map((id, n) => (
              <span
                key={n}
                className={id !== null && id !== false ? 'is-occupied' : ''}
                title={
                  id !== null && id !== false
                    ? find(offense, id)?.name || '走者あり'
                    : '走者なし'
                }
              >
                {['一', '二', '三'][n]}塁{' '}
                {id !== null && id !== false ? '●' : '—'}
              </span>
            ))}
          </div>
        </div>
      )}
      <div
        ref={rows}
        className="online-mobile-play-list"
        role="list"
        aria-label="経過のプレー"
      >
        {visible.map(({ frame, index, text, changed }) => (
          <div key={index} role="listitem">
            <button
              aria-current={selected?.index === index ? 'true' : undefined}
              onClick={() => setChosen(index)}
            >
              <span>
                {['steal', 'wild_pitch'].includes(frame.kind)
                  ? '走塁'
                  : changed
                    ? find(frame.top ? game.home : game.away, frame.pitcherId)
                        ?.name
                    : find(frame.top ? game.away : game.home, frame.batterId)
                        ?.name || '打者'}
              </span>
              <b>{text}</b>
              <small>
                {frame.awayScore}–{frame.homeScore}
              </small>
            </button>
          </div>
        ))}
        {!entries.length && (
          <p>この攻撃に完了した打席・走塁の記録はありません。</p>
        )}
      </div>
      <div className="online-mobile-replay-footer">
        <PageNav
          page={page}
          count={entries.length}
          size={size}
          setPage={(n) => {
            setPage(n);
            setChosen(null);
          }}
        />
        <button onClick={close} aria-label="試合結果を閉じる">
          閉じる
        </button>
      </div>
      <small>記録済み試合の経過です。観戦再生はPCから。</small>
    </section>
  );
}
