import React, { useState } from 'react';
import { Page, PageTabs, usePageTab } from './Page.jsx';
import TeamRoster from './TeamRoster.jsx';
import { CompactRoster, PlayerStatsButton } from './PlayerPerformance.jsx';
import { TeamLineupBody } from './TeamLineup.jsx';
import { CareerTeamBoard } from './CareerStats.jsx';
import TeamDiagnosis from './TeamDiagnosis.jsx';
import YearSummary from './YearSummary.jsx';
import AgeOutlook from './AgeOutlook.jsx';
import FieldDiagram from './FieldDiagram.jsx';
import { teamLabel, formatRate as rate3 } from './gameText.js';
import { PYRAMID_LEAGUES } from './pyramidLeague.js';
import { RATING_AXES, teamRatings } from './teamRatings.js';
import { positionFitness } from './lineupEdit.js';
import { defenseRange, defenseGrade } from '../utils/defenseRange.js';
import { AbilityNum, Delta, PlaceChip, PosChip, RangeGrade } from './look/Parts.jsx';

// ============================================================
// チーム分析（PC の左メニュー「チーム分析」）。1球団を選んで、戦力と成績をまとめて見る。
//
// ⚠ 先方要望（2026-11-20）「スタメン・チーム打率・チーム防御率・守備分析・年齢構成と3年後の見込み・選手成績・
//    通算成績をここに。先発投手力・リリーフ投手力・攻撃力・守備力・機動性・控え戦力をレーダーチャートで。
//    選手成績と通算成績内のチーム別を統合」。左メニューから「選手成績」「通算成績」を外し、ここの切り替えで開く
//    （通算成績のリーグ全体のランキングは「リーグ史」へ）。
// ⚠ 球団の選び直しは**切り替えをまたいで保つ**（`TeamRoster` の `selected`）。切り替えるたびに自球団へ戻ると、
//    他球団を続けて調べられない。
// ⚠ 年齢構成と3年後の見込み・チーム診断は**自球団だけ**（成長力を使うので他球団には作らない。サーバーの決まり）。
// ⚠ チーム能力値は見せるだけ（`teamRatings.js`）。強さには効かない。
// ============================================================

const TABS = [
  ['overview', 'チーム能力・成績'],
  ['lineup', 'スタメン・投手陣'],
  ['defense', '守備分析'],
  ['age', '年齢構成'],
  ['players', '選手成績'],
  ['careers', '通算成績'],
];

const sumOf = (roster, side, key) =>
  (roster || []).reduce((n, p) => n + (Number(p.seasonStats?.[side]?.[key]) || 0), 0);

/** 同じ部の球団の名前（部が分からない古いビューは全球団） */
function rivalsOf(view, team) {
  const id = view.teamLeagues?.[team];
  const names = view.teamNames || Object.keys(view.teamStats || {});
  return id ? names.filter((n) => view.teamLeagues[n] === id) : names;
}
const leagueNameOf = (view, team) =>
  PYRAMID_LEAGUES.find((l) => l.id === view.teamLeagues?.[team])?.name || 'リーグ';

/** 部の中の順位（`better` が true なら大きいほど上） */
function rankIn(values, own, better = true) {
  const list = values.filter((v) => v != null);
  if (own == null || !list.length) return null;
  return list.filter((v) => (better ? v > own : v < own)).length + 1;
}

// ------------------------------------------------------------
// レーダーチャート（チーム能力値）。この球団と部の平均の2本。凡例を上に置く
// ------------------------------------------------------------
const R = 110;
const CX = 200;
const CY = 145;
/**
 * 図の半径は**項目ごとにリーグ全球団の中の位置**（いちばん低い球団が内側 `INNER`、いちばん高い球団が外周）。
 * ⚠ 値そのもの（0〜100）で描くと、どの球団も 40〜65 に集まって同じ形に見えた（実測）。
 *    数字は横の表に出すので、図は「リーグの中で強いか弱いか」を読むためのもの
 */
const INNER = 0.15;
function scalesOf(all) {
  return Object.fromEntries(
    RATING_AXES.map((a) => {
      const list = all.map((r) => r?.[a.key]).filter((v) => v != null);
      return [a.key, list.length ? [Math.min(...list), Math.max(...list)] : [0, 100]];
    }),
  );
}
const radiusOf = (scales, key, v) => {
  if (v == null) return 0;
  const [lo, hi] = scales[key] || [0, 100];
  const f = hi > lo ? (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) : 0.5;
  return R * (INNER + (1 - INNER) * f);
};
const pointAt = (i, r) => {
  const a = -Math.PI / 2 + (2 * Math.PI * i) / RATING_AXES.length;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
};
const polygon = (scales, values) =>
  RATING_AXES.map((axis, i) => pointAt(i, radiusOf(scales, axis.key, values?.[axis.key])).join(',')).join(' ');

export function TeamRadar({ ratings, average, ranks, label, league = [] }) {
  const scales = scalesOf([...league, ratings]);
  const [active, setActive] = useState(null);
  if (!ratings) return <p className="online-muted">起用がまだ無いので、チーム能力値を出せません。</p>;
  return (
    <div className="online-team-radar">
      <div className="online-radar-legend" aria-hidden="true">
        <span className="is-team">
          <i /> {label}
        </span>
        <span className="is-average">
          <i /> 部の平均
        </span>
      </div>
      <svg viewBox="0 0 400 290" role="img" aria-label={`チーム能力値。${RATING_AXES.map((a) => `${a.label}${ratings[a.key] ?? '—'}`).join('、')}`}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon
            key={f}
            className="online-radar-grid"
            points={RATING_AXES.map((_, i) => pointAt(i, R * f).join(',')).join(' ')}
          />
        ))}
        {RATING_AXES.map((axis, i) => {
          const [x, y] = pointAt(i, R);
          return <line key={axis.key} className="online-radar-grid" x1={CX} y1={CY} x2={x} y2={y} />;
        })}
        {average && <polygon className="online-radar-average" points={polygon(scales, average)} />}
        <polygon className="online-radar-team" points={polygon(scales, ratings)} />
        {RATING_AXES.map((axis, i) => {
          const [x, y] = pointAt(i, radiusOf(scales, axis.key, ratings[axis.key]));
          return (
            <circle
              key={axis.key}
              className={`online-radar-dot${active === i ? ' is-active' : ''}`}
              cx={x}
              cy={y}
              r={active === i ? 5 : 4}
            />
          );
        })}
        {RATING_AXES.map((axis, i) => {
          const [x, y] = pointAt(i, R + 18);
          return (
            <text
              key={axis.key}
              className="online-radar-label"
              x={x}
              y={y}
              textAnchor={Math.abs(x - CX) < 4 ? 'middle' : x > CX ? 'start' : 'end'}
              dominantBaseline="middle"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              {axis.label}
            </text>
          );
        })}
      </svg>
      {/* 数字の表（色だけに頼らない。目盛りの読み取りもこちらで） */}
      <table className="online-radar-table">
        <thead>
          <tr>
            <th>項目</th>
            <th>値</th>
            <th>部の平均</th>
            <th>部の順位</th>
          </tr>
        </thead>
        <tbody>
          {RATING_AXES.map((axis, i) => (
            <tr
              key={axis.key}
              className={active === i ? 'is-active' : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              <th>{axis.label}</th>
              <td>
                {ratings[axis.key] ?? '—'}
                <Delta value={ratings[axis.key]} base={average?.[axis.key]} />
              </td>
              <td className="online-muted">{average?.[axis.key] ?? '—'}</td>
              <td>{ranks?.[axis.key] ? <PlaceChip place={ranks[axis.key]} /> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** サーバーの能力値（全球団）。無い古いビューは、読み込んだ球団だけ画面で同じ式から作る */
function ratingsOf(view, shown) {
  return view.teamRatings?.[shown.teamName] ?? teamRatings(shown.roster, shown.lineup);
}

/**
 * チームの方針（先方要望 #9）。監督とコーチの型から作った6行（攻撃・投手起用・重心・編成・育成・いまの重点）。
 * 文はサーバーが作る（`teamPolicy.js`。アプリも同じ文を出す）。指導者の居ない古いリーグでは出さない
 */
export function TeamPolicy({ policy }) {
  if (!policy) return null;
  return (
    <section className="online-card online-team-policy" aria-label="チームの方針">
      <h2>チームの方針</h2>
      <p className="online-team-policy-head">
        <strong>{policy.headline}</strong>
        {policy.by && <small>{policy.by}</small>}
      </p>
      {policy.tags?.length > 0 && (
        <ul className="online-team-policy-tags">
          {policy.tags.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      <dl className="online-team-policy-rows">
        {policy.rows.map((r) => (
          <div key={r.key}>
            <dt>{r.label}</dt>
            <dd>
              <b>{r.value}</b>
              <span>{r.note}</span>
            </dd>
          </div>
        ))}
      </dl>
      {policy.note && <p className="online-muted">{policy.note}</p>}
    </section>
  );
}

function Overview({ view, shown, setTab }) {
  const own = shown.teamName === view.teamName;
  const rivals = rivalsOf(view, shown.teamName);
  const ratings = ratingsOf(view, shown);
  const all = rivals.map((n) => view.teamRatings?.[n]).filter(Boolean);
  const average = all.length
    ? Object.fromEntries(
        RATING_AXES.map((a) => {
          const list = all.map((r) => r[a.key]).filter((v) => v != null);
          return [a.key, list.length ? Math.round(list.reduce((x, y) => x + y, 0) / list.length) : null];
        }),
      )
    : null;
  const ranks = all.length
    ? Object.fromEntries(RATING_AXES.map((a) => [a.key, rankIn(all.map((r) => r[a.key]), ratings?.[a.key])]))
    : null;
  const stats = view.teamStats?.[shown.teamName] || {};
  const avgRank = rankIn(rivals.map((n) => view.teamStats?.[n]?.average ?? null), stats.average);
  const eraRank = rankIn(rivals.map((n) => view.teamStats?.[n]?.era ?? null), stats.era, false);
  const roster = shown.roster || [];
  const chances = sumOf(roster, 'batting', 'fieldingChances');
  const errors = sumOf(roster, 'batting', 'errors');
  const league = leagueNameOf(view, shown.teamName);
  const tiles = [
    ['チーム打率', rate3(stats.average), avgRank && league, avgRank],
    ['チーム防御率', stats.era != null ? stats.era.toFixed(2) : '—', eraRank && league, eraRank],
    ['本塁打', sumOf(roster, 'batting', 'homeruns'), null],
    ['盗塁', sumOf(roster, 'batting', 'stolenBases'), null],
    ['奪三振', sumOf(roster, 'pitching', 'strikeouts'), null],
    ['失策', errors, chances > 0 ? `守備率${rate3((chances - errors) / chances)}` : null],
  ];
  return (
    <>
      <section className="online-card">
        <h2>チーム能力値</h2>
        <p className="online-muted">
          いまの起用（スタメン・先発ローテ・リリーフ・控え）に就いている選手の能力の平均です（0〜100）。図は項目ごとにリーグ全球団の中で比べた位置で、外ほど上です。起用を変えると値も変わります。目安で、試合の強さを直接決める数字ではありません。
        </p>
        <TeamRadar
          ratings={ratings}
          average={average}
          ranks={ranks}
          label={teamLabel(shown.teamName)}
          league={Object.values(view.teamRatings || {}).filter(Boolean)}
        />
      </section>
      <TeamPolicy policy={shown.staff?.policy} />
      <section className="online-card">
        <h2>今季のチーム成績</h2>
        <div className="online-team-tiles">
          {tiles.map(([label, value, note, place]) => (
            <div key={label}>
              <small>{label}</small>
              <b>{value}</b>
              {note && (
                <small>
                  {note}
                  {place && <PlaceChip place={place} />}
                </small>
              )}
            </div>
          ))}
        </div>
        <p className="online-muted">順位は同じ部の中で比べています。</p>
      </section>
      {own && <TeamDiagnosis diagnosis={view.diagnosis} open={setTab} />}
    </>
  );
}

/** 守備分析: いまのスタメンの守備図と、位置ごとの守備範囲・適性・失策 */
function Defense({ shown }) {
  const lineup = shown.lineup;
  const byId = new Map((shown.roster || []).map((p) => [p.id, p]));
  if (!lineup?.battingOrder?.length)
    return (
      <section className="online-card">
        <p className="online-muted">この球団のスタメンはまだ読めません。次に日付が進むと出ます。</p>
      </section>
    );
  // 守備位置の順（捕・一・二・三・遊・左・中・右）。打順の並びより守備の穴を探しやすい
  const POSITION_ORDER = ['catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];
  const at = (e) => (POSITION_ORDER.includes(e.position) ? POSITION_ORDER.indexOf(e.position) : 99);
  const order = [...lineup.battingOrder].sort((a, b) => at(a) - at(b));
  const pitcher = byId.get(shown.nextStarterId) || byId.get(lineup.starters?.[0]) || null;
  return (
    <div className="online-board online-defense-board">
      <section className="online-card online-board-main">
        <h2>守備位置ごと</h2>
        <table className="online-standings online-defense-table">
          <thead>
            <tr>
              <th>守備</th>
              <th>選手</th>
              <th>守備範囲</th>
              <th>適性</th>
              <th>守備</th>
              <th>肩</th>
              <th>走力</th>
              <th>失策</th>
              <th>守備率</th>
            </tr>
          </thead>
          <tbody>
            {order.map((e) => {
              const p = byId.get(e.playerId);
              if (!p)
                return (
                  <tr key={e.battingOrder}>
                    <th>
                      <PosChip position={e.position} />
                    </th>
                    <td colSpan={8} className="online-muted">
                      （空き）
                    </td>
                  </tr>
                );
              const range = defenseRange(p, e.position, positionFitness(p, e.position));
              const grade = defenseGrade(range);
              const b = p.seasonStats?.batting || {};
              return (
                <tr key={e.battingOrder}>
                  <th>
                    <PosChip position={e.position} />
                  </th>
                  <td>
                    <PlayerStatsButton player={shown.own ? p : { ...p, tradeTeam: shown.teamName }} />
                  </td>
                  <td>
                    <RangeGrade grade={grade} /> <small>{Math.round(range * 100)}</small>
                  </td>
                  <td>{positionFitness(p, e.position)}</td>
                  <td>
                    <AbilityNum value={p.fielding?.defense} />
                  </td>
                  <td>
                    <AbilityNum value={p.physical?.arm} />
                  </td>
                  <td>
                    <AbilityNum value={p.physical?.speed} />
                  </td>
                  <td>{b.errors ?? 0}</td>
                  <td>{b.fieldingChances > 0 ? rate3((b.fieldingChances - (b.errors || 0)) / b.fieldingChances) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="online-muted">
          守備範囲は守備・走力・肩を位置ごとの重みで足し、適性で割り引いたものです（スタメン設定の守備図と同じ）。
        </p>
      </section>
      <section className="online-card online-board-side">
        <FieldDiagram
          order={order}
          playerOf={(id) => byId.get(id) || null}
          pitcher={pitcher}
          selected={null}
          target={null}
          focus={null}
        />
      </section>
    </div>
  );
}

/** 切り替えの中身（`TeamRoster` が読んだ球団 `shown` を受け取る） */
function TabBody({ tab, view, shown, selector, setTab }) {
  const own = shown.teamName === view.teamName;
  const actions = <div className="online-team-selector">{selector}</div>;
  if (tab === 'players')
    return (
      <Page
        title="選手成績"
        sub="列の見出しを押すと並べ替えます。選手名を押すと詳しい成績と能力を開きます。"
        actions={actions}
      >
        <section className="online-card">
          <CompactRoster
            key={shown.teamName}
            view={
              // ⚠ 他球団の選手には球団名を付ける（詳細の「この選手でトレードを考える」）
              own ? shown : { ...shown, roster: (shown.roster || []).map((p) => ({ ...p, tradeTeam: shown.teamName })) }
            }
            desktop
            league={view}
          />
        </section>
      </Page>
    );
  if (tab === 'lineup')
    return (
      <Page title="スタメン・投手陣" sub="いまの打順と守備位置、先発ローテとリリーフの役割です。" actions={actions}>
        <section className="online-card online-team-lineup-card">
          <TeamLineupBody team={shown} own={own} view={view} />
        </section>
      </Page>
    );
  if (tab === 'defense')
    return (
      <Page title="守備分析" sub="いまのスタメンの守備位置ごとの守備範囲と適性、今季の失策です。" actions={actions}>
        <Defense shown={{ ...shown, own }} />
      </Page>
    );
  if (tab === 'age')
    return (
      <Page title="年齢構成" sub="年齢と守備位置ごとの人数と、3年後の見込みです。" actions={actions}>
        {own && view.ageOutlook ? (
          <AgeOutlook outlook={view.ageOutlook} />
        ) : (
          <section className="online-card">
            <p className="online-muted">
              {own
                ? 'いまは出せません（途中参加で初期メンバーを待っている間は出ません）。'
                : '年齢構成と3年後の見込みは自球団だけです（成長の見込みは他球団には分かりません）。'}
            </p>
          </section>
        )}
      </Page>
    );
  return (
    <Page title="チーム能力・成績" sub="チーム能力値（レーダー）と今季のチーム成績です。" actions={actions}>
      {/* ⚠ **その年のまとめはここに置く**（いしだ 2026-11-22「ホームのトップに表示されている
          『〇年目のまとめ』は、各チーム分析に入れて下さい」）。ホームの先頭からは外した。
          選んだ球団のまとめが出る（順位はその球団の部、入退団はその球団の分）。
          ⚠ 時期（年度更新〜開幕した月の終わり）の判定にリーグの今日が要るので、
             選んだ球団のまとめに自分のビューの年と日付を添えて渡す */}
      <YearSummary view={{ yearSummary: shown.yearSummary, year: view.year, currentDate: view.currentDate }} />
      <Overview view={view} shown={shown} setTab={setTab} />
    </Page>
  );
}

/**
 * @param initial 最初に開く切り替え（古い入口「選手成績」「通算成績」から来たとき）
 * @param open 左メニューのページを開く（チーム診断の「スタメン設定へ」など）
 */
export default function TeamAnalysis({ view, initial = null, open }) {
  const [tab, setTab] = usePageTab('analysis', TABS.map(([id]) => id), initial);
  const [team, setTeam] = useState(view.teamName);
  return (
    <PageTabs title="チーム分析" tabs={TABS} current={tab} onChange={setTab}>
      {tab === 'careers' ? (
        // ⚠ 通算は自球団もサーバーから読み直す（ビューに載せていない。`CareerStats.jsx`）
        <TeamRoster view={view} always selected={team} onSelect={setTeam}>
          {(shown, selector) => <CareerTeamBoard shown={shown} selector={selector} />}
        </TeamRoster>
      ) : (
        <TeamRoster view={view} selected={team} onSelect={setTeam}>
          {(shown, selector) => <TabBody tab={tab} view={view} shown={shown} selector={selector} setTab={open} />}
        </TeamRoster>
      )}
    </PageTabs>
  );
}
