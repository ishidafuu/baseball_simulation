// ============================================================
// 新しい見た目 段3: ホームの頭の「今日の一戦」の札（PC）。
// 背景は本拠地の球場の夜景（`sceneArt.js` の `stadiumArt`。照明・旗・フェンスは本拠地の球団の色、
// 後ろの景色は土地で海か山、客の入りは順位と連勝で変わる。どれも見た目だけ）。
//
// ⚠ **切のときは何も出さない**（ホームは今までと同じ）。
// ⚠ 中身はビューの `nextGames`（先発予定つき。`server/leagueBoard.mjs` の `withStarters`）と順位表。
//    今日の試合が無い日（休養日・手続きの日）は次の試合を「次の一戦」として出す。
// ⚠ アプリの試合タブにも同じ札がある（`mobile/androidApp/.../LookScenes.kt` の `TodayGameCard`）。文を変えたら両方を直す。
//    札の作り（下の切り替え）は Web だけで、アプリは前の形（札の下にほかの試合を重ねる）のまま。
// ⚠ 縦は詰めてある（先方要望 #8「縦幅を縮めて視認性を高めて」）。球団は横並び（マーク・名前・順位）、
//    ひとことは VS の下、「スタメンを見る」は見出しの右。
// ⚠ **札は1枚で、中身が 自分の試合 → 同じ日のほかの試合 → … と数秒ごとに切り替わる**
//    （いしだ 2026-11-28「切り替わるところにチーム名と先発が出ているのに、上の自分のチームと対戦相手、
//    予告先発が被ってますよね。自分の試合のところを切り替わってほしい」）。
//    前は札の下に、ほかの試合を小さい札で重ねてめくっていた（先方要望 #8）が、球団と先発を2回並べていた。
//    - 球場の絵もその試合の本拠地に替わる（客の入りは `homeCrowd`）
//    - 顔つきの先発・成績・ひとこと・「スタメンを見る」は自分の試合だけ。ほかの試合は先発の名前だけ
//      （ほかの試合のデータは名前しか無い。名前から顔を作ると、同じ投手がほかの画面と違う顔になる）
//    - 乗せている間（マウス・フォーカス）は止める。下の点を押すとその試合へ
// ⚠ 球団（マーク・名前）は**中央の VS に寄せる**（2026-11-28「中心のVSから離れて見ずらい」。`look.css`）。
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import { useLook } from './LookContext.jsx';
import { PlayerFace, StadiumBackdrop, TeamMark } from './Art.jsx';
import { homeCrowd, otherGameCards, todayGameCard } from './todayGame.js';
import { teamLook } from './teamLook.js';
import { teamLabel } from '../gameText.js';

/** 札の中身を切り替える間隔（ミリ秒） */
export const OTHER_GAMES_MS = 4000;

function Side({ side, right }) {
  return (
    <div className={`online-today-side${right ? ' is-right' : ''}`}>
      <TeamMark team={side.team} size={56} className="online-today-mark" />
      <div>
        <strong>{teamLabel(side.team)}</strong>
        <small>{side.record}</small>
      </div>
    </div>
  );
}

function StarterCard({ side, right }) {
  const s = side.starter;
  return (
    <div className={`online-today-starter${right ? ' is-right' : ''}`} style={{ '--side-c': side.color }}>
      {/* ⚠ 顔は自分の試合だけ（`face`）。ほかの試合は名前しか無いので出さない（冒頭の注） */}
      {s && side.face !== false ? <PlayerFace player={s} team={side.team} size={40} /> : null}
      <div>
        <small>{s?.mark || '先発'}</small>
        <strong>{s?.name || '未定'}</strong>
        {/* ⚠ 成績の行は無くても場所を取る（`\u00a0`）。切り替わるたびに札の高さが変わると、
            下の画面が数秒ごとに上下に揺れる（ほかの試合は名前しか無いので、空けないと 217px ⇄ 181px） */}
        <span>{s?.line || '\u00a0'}</span>
      </div>
    </div>
  );
}

/** ほかの試合の1枚を、札の形（左がビジター・右が本拠地）にそろえる */
function otherSlide(view, card, g) {
  const side = (team, record, starter) => ({
    team,
    record,
    color: teamLook(team)?.c2 || '#94a3b8',
    face: false,
    starter: starter ? { name: starter, mark: '先発予定' } : null,
  });
  return {
    key: g.id ?? `${g.away}-${g.home}`,
    own: false,
    title: 'ほかの試合',
    when: card.when,
    place: g.city ? `${g.city}` : '',
    home: g.home,
    city: g.city,
    crowd: homeCrowd(view, g.home),
    note: '',
    left: side(g.away, g.awayRecord, g.awayStarter),
    right: side(g.home, g.homeRecord, g.homeStarter),
    label: `${teamLabel(g.away)}対${teamLabel(g.home)}`,
  };
}

export default function TodayGame({ view, onLineup }) {
  const { on } = useLook();
  const card = useMemo(() => (on ? todayGameCard(view) : null), [on, view]);
  // 1枚目は自分の試合、続けて同じ日のほかの試合
  const slides = useMemo(() => {
    if (!card) return [];
    const own = {
      key: 'own',
      own: true,
      title: card.title,
      when: card.when,
      place: card.place,
      home: card.home,
      city: card.city,
      crowd: card.crowd,
      note: card.note,
      left: card.own,
      right: card.foe,
      label: card.title,
    };
    return [own, ...otherGameCards(view).map((g) => otherSlide(view, card, g))];
  }, [card, view]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = slides.length;
  const at = count ? index % count : 0;
  useEffect(() => {
    if (paused || count < 2) return undefined;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), OTHER_GAMES_MS);
    return () => clearInterval(timer);
  }, [paused, count]);
  if (!card) return null;
  const slide = slides[at];
  return (
    <section
      className={`online-today-game${slide.own ? '' : ' is-other'}`}
      aria-label={slide.label}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <StadiumBackdrop team={slide.home} city={slide.city} crowd={slide.crowd} />
      <header>
        <strong>
          {slide.title}　{slide.when}
        </strong>
        <span>{slide.place}</span>
        {onLineup &&
          (slide.own ? (
            <button type="button" className="online-today-cta" onClick={onLineup}>
              スタメンを見る ›
            </button>
          ) : (
            // ほかの試合では押せない形で場所だけ取る（見出しの高さをそろえる。成績の行と同じ理由）
            <button type="button" className="online-today-cta is-empty" tabIndex={-1} aria-hidden="true" disabled>
              スタメンを見る ›
            </button>
          ))}
      </header>
      {/* ⚠ `key` で切り替わるたびに入れ直す（`look.css` の薄く出す動き。動きを減らす設定では出さない） */}
      <div className="online-today-vs" key={`vs-${slide.key}`}>
        <Side side={slide.left} />
        <div className="online-today-mid">
          <b aria-hidden="true">VS</b>
          {/* ひとことも無いときは場所だけ取る（高さをそろえる。上の成績の行と同じ理由） */}
          {slide.note ? (
            <p className="online-today-note">{slide.note}</p>
          ) : (
            <p className="online-today-note is-empty" aria-hidden="true">
              {'\u00a0'}
            </p>
          )}
        </div>
        <Side side={slide.right} right />
      </div>
      <div className="online-today-starters" key={`st-${slide.key}`}>
        <StarterCard side={slide.left} />
        <StarterCard side={slide.right} right />
      </div>
      {count > 1 && (
        <div className="online-today-dots" role="tablist" aria-label="試合を選ぶ">
          {slides.map((sl, i) => (
            <button
              key={sl.key}
              type="button"
              role="tab"
              aria-selected={i === at}
              aria-label={sl.label}
              className={i === at ? 'is-on' : ''}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
