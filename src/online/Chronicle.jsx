import React, { useState } from 'react';
import { POS } from './api.js';
import TeamRoster from './TeamRoster.jsx';
import { TeamPlayerButton } from './PlayerPerformance.jsx';
import { Page } from './Page.jsx';
import { teamLabel, teamShort } from './gameText.js';
import { raceText, milestoneText, worldText, honorRows, proDraftedAfter } from './chronicleText.js';

// ============================================================
// 球団史・記録（PC）。年表・歴代記録・引退した人・節目、リーグの話題。
//
// ⚠ いしだ依頼（2026-11-09）「リアリティを出す」の、試合の数字を変えない部分。
//    数字はサーバーが作る（`server/chronicle.mjs`）。画面は並べるだけ。
// ⚠ 文はアプリ（`mobile/.../Chronicle.kt`）と同じにすること（`chronicleText.js`）。
// ⚠ 自球団もサーバーから読み直す（`TeamRoster` の `always`）。球団史はビューに載せていない。
// ⚠ 年は**「N年目」**で出す。リーグの年は1, 2, …と数えるので「1年」だと西暦や
//    在籍年数に読める（ほかのページの「1年目オフの成長」「1年目 · 次の進行」と揃える）。
//    節目も年を出す（月日だけだと何年目の話か分からなかった。アプリは年を出している）。
// ============================================================

function Seasons({ seasons }) {
  if (!seasons?.length)
    return <p>まだ終わったシーズンがありません。1年目を終えると、ここに年ごとの成績が並びます。</p>;
  return (
    <table className="online-standings online-chronicle-table">
      <thead>
        <tr>
          <th>年</th>
          <th>所属</th>
          <th>順位</th>
          <th>成績</th>
          <th>できごと</th>
        </tr>
      </thead>
      <tbody>
        {seasons.map((s) => (
          <tr key={s.year}>
            <th>{s.year}年目</th>
            <td>{s.league || '—'}</td>
            <td>{s.rank ? `${s.rank}位` : '—'}</td>
            <td>
              {s.wins != null ? `${s.wins}勝${s.losses}敗${s.draws ? `${s.draws}分` : ''}` : '—'}
            </td>
            <td>
              {[s.champion && 'プレーオフ優勝', s.move, ...(s.titles || [])].filter(Boolean).join('・') || ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Records({ records, view, team }) {
  // 現役（いま名簿にいる）の選手は名前を押すと選手の詳細を開く（`id` はサーバーが現役にだけ付ける）
  const name = (x) =>
    x.id != null ? (
      <TeamPlayerButton view={view} team={team} id={x.id} name={x.name} />
    ) : (
      x.name
    );
  if (!records?.length) return <p>記録がまだありません。</p>;
  return (
    <div className="online-leaders">
      {records.map((r) => (
        <div key={r.stat} className="online-leader-box">
          <h4>{r.label}</h4>
          <p className="online-chronicle-sub">シーズン最多</p>
          <ol>
            {r.season.map((x, i) => (
              <li key={`s:${i}`} className={x.active ? 'online-own-text' : ''}>
                <span className="online-leader-rank" data-rank={i + 1}>{i + 1}</span>
                <span className="online-leader-name">
                  {name(x)}
                  <small>{x.year}年目{x.current ? '（今季）' : ''}</small>
                </span>
                <span className="online-leader-value">{x.value}</span>
              </li>
            ))}
          </ol>
          <p className="online-chronicle-sub">球団通算</p>
          <ol>
            {r.career.map((x, i) => (
              <li key={`c:${i}`} className={x.active ? 'online-own-text' : ''}>
                <span className="online-leader-rank" data-rank={i + 1}>{i + 1}</span>
                <span className="online-leader-name">
                  {name(x)}
                  {x.active && <small>現役</small>}
                </span>
                <span className="online-leader-value">{x.value}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function Retired({ list }) {
  if (!list?.length) return <p>この球団から引退した選手はまだいません。</p>;
  return (
    <div className="online-news-list">
      {list.map((r, i) => (
        <article key={i}>
          <b>
            {r.year}年目 {r.name}（{r.age}歳）{r.hallOfFame ? ' 殿堂入り' : ''}
          </b>
          <span>
            {[r.seasons ? `在籍${r.seasons}年` : null, r.line, r.secondCareer && `→ ${r.secondCareer}`]
              .filter(Boolean)
              .join('　')}
          </span>
        </article>
      ))}
    </div>
  );
}

/**
 * プロ入りした選手（NPBのドラフトで指名された人。新しい順）。中身はサーバーの `proDraft.mjs` の記録。
 * ⚠ 先方要望（2026-11-16）: プロ指名を解禁し、プロ入りした選手はリーグ記録から確かめられるように。
 *    `showTeam` のとき（リーグ全体）は元の球団も出す
 */
function ProDrafted({ list, showTeam = false, empty }) {
  if (!list?.length) return <p>{empty}</p>;
  return (
    <div className="online-news-list">
      {list.map((r, i) => (
        <article key={i}>
          <b>
            {r.year}年目 {r.name}
            {r.position && `（${POS[r.position] || r.position}・${r.age}歳）`}
            {showTeam && ` ${teamShort(r.team)}`}
          </b>
          <span>
            {r.npbTeam} {r.round}位指名{r.reason ? `　${r.reason}` : ''}
          </span>
          {/* プロでのその後（球団史は全部の年、リーグ全体はいちばん新しい年。飾りでリーグには効かない） */}
          {proDraftedAfter(r).map((t, j) => (
            <small key={j} className="online-pro-after">
              {t}
            </small>
          ))}
        </article>
      ))}
    </div>
  );
}

/**
 * 入退団履歴（新しい順。入団・退団・トレード・引退）。中身はサーバーの `teamMoves`。
 * ⚠ 先方指摘「各チームの入退団履歴も見られるように。表示先は球団史・記録から」。
 *    年で絞れる（多い年は1年に10人を超える）
 */
function Moves({ list }) {
  const years = [...new Set((list || []).map((m) => m.year).filter((y) => y != null))];
  const [year, setYear] = useState(null);
  if (!list?.length) return <p>まだ入団・退団の記録がありません。</p>;
  const shown = year === null ? list : list.filter((m) => m.year === year);
  return (
    <>
      {years.length > 1 && (
        <div className="online-segments" role="group" aria-label="年">
          <button aria-pressed={year === null} onClick={() => setYear(null)}>
            すべて
          </button>
          {years.map((y) => (
            <button key={y} aria-pressed={year === y} onClick={() => setYear(y)}>
              {y}年目
            </button>
          ))}
        </div>
      )}
      <table className="online-moves-table">
        <thead>
          <tr>
            <th scope="col">時期</th>
            <th scope="col">入退</th>
            <th scope="col">選手</th>
            <th scope="col">経緯</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m, i) => (
            <tr key={i} data-side={m.side}>
              <td>
                {m.year}年目{m.month ? ` ${m.month}月${m.day}日` : ''}
              </td>
              <td className="online-moves-side">{m.side === 'in' ? '入' : '出'}</td>
              <td>
                {m.name}
                {m.position && <small>（{POS[m.position] || m.position}）</small>}
              </td>
              <td>
                {m.how}
                {m.other && (
                  <small title={teamLabel(m.other)}>
                    {m.side === 'in' ? '（前: ' : '（→ '}
                    {teamShort(m.other)}）
                  </small>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** 年間表彰（リーグ全体。いちばん新しい年） */
function Honors({ honors }) {
  const rows = honorRows(honors, teamShort);
  if (!rows.length)
    return <p>まだありません。10月下旬に成績が確定すると、タイトルと部ごとのMVP・新人王・ベストナイン・最優秀バッテリーが決まります。</p>;
  return (
    <div className="online-news-list">
      {rows.map((r, i) => (
        <article key={i}>
          <b>{r.head}</b>
          <span>{r.body}</span>
        </article>
      ))}
    </div>
  );
}

function Milestones({ list, showTeam = false }) {
  if (!list?.length) return <p>まだありません。通算100安打・シーズン20本塁打などに届くと、ここに残ります。</p>;
  return (
    <div className="online-news-list">
      {list.map((m, i) => (
        <article key={i}>
          <b>
            {m.year}年目 {m.month}月{m.day}日 {m.name}
            {showTeam && <small>（{teamShort(m.team)}）</small>}
          </b>
          <span>{milestoneText(m)}</span>
        </article>
      ))}
    </div>
  );
}

/**
 * リーグの話題（マジック・節目・裏の大会）。ホームの横に置く。
 *
 * ⚠ **件数に上限を置くこと**。ホームは1画面（1000px）に収める決まりで、
 *    右の列は順位表とこのカードだけ。ここが件数ぶん伸びると、順位表ごと
 *    画面から出る（実測: 話題が1件のとき898px、3件で1046px）。
 * ⚠ 続きは「球団史・記録」（`Chronicle`）に全部出るので、ここで落としても読める。
 *    `full` のとき（球団史・記録のページ）は件数で切らず、節目は出さない
 *    （節目はそのページに球団ごとの欄がある）。
 */
const HOME_TOPIC_LIMIT = 2;
export function LeagueTopics({ view, full = false }) {
  const limit = full ? Infinity : HOME_TOPIC_LIMIT;
  const races = (view.races || [])
    .map((r) => raceText(r, teamShort))
    .filter(Boolean)
    .slice(0, limit);
  // ⚠ 年をまたいでも残す（PCは「話題」の一覧なので、紙面のように日付で切らない）。年を見出しに添える
  const world = (view.chronicle?.world || [])
    .map((w, i) => ({ text: worldText(w, teamShort), year: w?.year, i }))
    .filter((x) => x.text)
    .slice(0, limit);
  const milestones = full ? [] : view.chronicle?.milestones || [];
  // 今年のプロの便り（10月から年度更新まで）
  const pro = (view.chronicle?.proNews || []).slice(0, limit);
  if (!races.length && !world.length && !milestones.length && !pro.length) return null;
  return (
    <section className="online-card">
      {/* ⚠ 続きの案内は**見出しの行に置く**。1行足すと24px取られ、順位表ごと
          1画面から出る（実測 982px→1006px） */}
      <h2 className="online-topics-head">
        リーグの話題
        {!full && <small>続きは「球団史・記録」で</small>}
      </h2>
      {races.length > 0 && (
        <div className="online-news-list">
          {races.map((t, i) => (
            <article key={`r:${i}`}>
              <b>{t.head}</b>
              <span>{t.body}</span>
            </article>
          ))}
        </div>
      )}
      {milestones.length > 0 && (
        <>
          <h3>最近の節目</h3>
          <Milestones list={milestones.slice(0, HOME_TOPIC_LIMIT)} showTeam />
        </>
      )}
      {pro.length > 0 && (
        <>
          <h3>プロの便り</h3>
          <div className="online-news-list">
            {pro.map((p, i) => (
              <article key={`p:${i}`}>
                <b>
                  {p.name}（元{teamShort(p.team)}）
                </b>
                <span>{p.text}</span>
              </article>
            ))}
          </div>
        </>
      )}
      {world.length > 0 && (
        <>
          <h3>球界の外から</h3>
          <div className="online-news-list">
            {world.map(({ text, year, i }) => (
              <article key={`w:${i}`}>
                <b>
                  {year}年目 {text.head}
                </b>
                <span>{text.body}</span>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default function Chronicle({ view }) {
  return (
    <TeamRoster view={view} always>
      {(shown, selector) => {
        const c = shown.chronicle || {};
        return (
          <Page
            title="球団史・記録"
            sub={`${teamLabel(shown.teamName)}の年ごとの成績と、このリーグでの歴代記録。記録はリーグを始めてからのものです。`}
            actions={<div className="online-team-selector">{selector}</div>}
          >
            <section className="online-card">
              <h2>年表</h2>
              <Seasons seasons={c.seasons} />
            </section>
            <section className="online-card">
              <h2>歴代記録</h2>
              <Records records={c.records} view={view} team={shown.teamName} />
            </section>
            <div className="online-board">
              <div className="online-board-main">
                <section className="online-card">
                  <h2>節目の記録</h2>
                  <Milestones list={c.milestones} />
                </section>
                {/* ホームで2件に切った優勝争い・球界の外からの続き（リーグ全体の話題） */}
                <LeagueTopics view={view} full />
              </div>
              <div className="online-board-side">
                <section className="online-card">
                  <h2>入退団履歴</h2>
                  <Moves key={shown.teamName} list={c.moves} />
                </section>
                <section className="online-card">
                  <h2>プロ入りした選手</h2>
                  <ProDrafted
                    list={c.proDrafted}
                    empty="この球団からプロ入りした選手はまだいません。指名されるとチームメイトのプロ意識と経験が上がります。"
                  />
                </section>
                <section className="online-card">
                  <h2>引退した選手</h2>
                  <Retired list={c.retired} />
                </section>
                {/* リーグ全体の記録（球団を選び直しても同じ） */}
                <section className="online-card">
                  <h2>年間表彰{view.chronicle?.honors?.year ? `（${view.chronicle.honors.year}年目）` : ''}</h2>
                  <Honors honors={view.chronicle?.honors} />
                </section>
                <section className="online-card">
                  <h2>リーグからプロへ</h2>
                  <ProDrafted
                    list={view.chronicle?.proDrafted}
                    showTeam
                    empty="まだこのリーグからプロ入りした選手はいません（指名は10月下旬、リーグ全体で年0〜3人）。"
                  />
                </section>
              </div>
            </div>
          </Page>
        );
      }}
    </TeamRoster>
  );
}
