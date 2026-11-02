import React, { useState } from 'react';
import { useRead } from './useRead.js';
import { teamLabel } from './gameText.js';
import { TeamName } from './ui.jsx';
export default function TeamRoster({ view, children }) {
  const [selected, setSelected] = useState(view.teamName);
  // ⚠ 既定は自球団に固定し、他球団は押したときだけ選ばせる。以前は先頭に
  //    球団セレクトがあり、スマホでは「新潟フ」のように切れていた
  const [choosing, setChoosing] = useState(false);
  const own = selected === view.teamName;
  const result = useRead(own ? null : 'team', {
    team: selected,
    revision: view.revision,
  });
  const names = [
    ...new Set(
      [
        view.teamName,
        ...(view.teamNames || []),
        ...(view.standings || []).map((t) => t.teamName || t.team),
        ...(view.members || []).map((m) => m.teamName),
      ].filter(Boolean),
    ),
  ];
  const shown = own
    ? view
    : result.data?.teamName === selected
      ? result.data
      : null;
  const selector = !choosing && own ? (
    <span className="online-roster-team">
      <TeamName team={view.teamName} />
      <button className="online-link" onClick={() => setChoosing(true)}>
        他球団を見る
      </button>
    </span>
  ) : (
    <select
      aria-label="閲覧する球団"
      value={selected}
      onChange={(e) => setSelected(e.target.value)}
    >
      {names.map((name) => (
        <option key={name} value={name}>
          {/* ⚠ 値は内部名のまま（名簿の取得に使う）。見せる名前だけ差し替える */}
          {teamLabel(name)}
          {name === view.teamName ? '（自球団）' : ''}
        </option>
      ))}
    </select>
  );
  return (
    <section className="online-team-roster">
      {!own && (result.loading || result.error) ? (
        <>
          <div className="online-team-selector">{selector}</div>
          {result.loading ? (
            <p>球団情報を読み込んでいます…</p>
          ) : (
            <div role="alert">
              {result.error}
              <button onClick={result.retry}>再取得</button>
            </div>
          )}
        </>
      ) : (
        shown && children(shown, selector)
      )}
    </section>
  );
}
