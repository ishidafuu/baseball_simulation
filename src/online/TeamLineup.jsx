import React, { useEffect, useRef, useState } from "react";
import { POS } from "./api.js";
import { useRead } from "./useRead.js";
import { inOnlineRoot } from "./dialogPortal.js";
import { teamLabel } from "./gameText.js";
import { PlayerStatsButton } from "./PlayerPerformance.jsx";
import { STARTER_ROLES, RELIEF_ROLES } from "./tactics.js";
import { RELIEF_ORDER } from "./pitchingEdit.js";
import { overviewGroup, formatStat } from "./statsView.js";

// ============================================================
// 球団のスタメンと投手陣（順位表から球団を押すと開く小窓）。先方要望 2026-11。
//
// ⚠ 中身はサーバーの球団の読み込み（`action=team` の `lineup`）。自球団は手元の view。
//    方針・作戦は載っていない（人の球団の采配は出さない）。
// ⚠ 選手名を押すと、選手成績と同じ選手の小窓を開く。
// ⚠ 古い保存（`lineup` の無い球団の索引）では「まだ読めない」と書く。次の進行で入る。
// ============================================================

// 列と見出し。⚠ 見出しは短くする（スマホ 390px で投手の表の右端が切れた）
const BATTING_COLUMNS = { avg: "打率", homeruns: "本", rbis: "点", ops: "OPS" };
const PITCHING_COLUMNS = {
  era: "防御率",
  wins: "勝",
  losses: "敗",
  saves: "S",
  holds: "H",
};

function columnsOf(category, labels) {
  const all = overviewGroup(category).columns;
  return Object.entries(labels)
    .map(([id, label]) => {
      const column = all.find((c) => c.id === id);
      return column && { ...column, label };
    })
    .filter(Boolean);
}

function StatCells({ player, columns }) {
  return columns.map((c) => (
    <td key={c.id} className="is-num">
      {player ? formatStat(c, c.get(player)) : "—"}
    </td>
  ));
}

function NameCell({ player, team, own }) {
  if (!player) return <td className="online-muted">（空き）</td>;
  return (
    <td className="is-name">
      <PlayerStatsButton
        player={own ? player : { ...player, tradeTeam: team }}
      />
    </td>
  );
}

/** 小窓の中身。`team` は読み込んだ球団（自球団なら view） */
export function TeamLineupBody({ team, own }) {
  const lineup = team.lineup;
  const byId = new Map((team.roster || []).map((p) => [p.id, p]));
  if (!lineup)
    return (
      <p className="online-muted">
        この球団のスタメンはまだ読めません。次に日付が進むと出ます。
      </p>
    );
  const batting = columnsOf("batting", BATTING_COLUMNS);
  const pitching = columnsOf("pitching", PITCHING_COLUMNS);
  const order = [...(lineup.battingOrder || [])].sort(
    (a, b) => a.battingOrder - b.battingOrder,
  );
  const starters = (lineup.starters || []).filter((id) => byId.has(id));
  const roles = lineup.pitcherRoles || {};
  const relievers = RELIEF_ORDER.flatMap((role) =>
    Object.entries(roles)
      .filter(
        ([id, r]) =>
          r === role && !starters.includes(Number(id)) && byId.has(Number(id)),
      )
      .map(([id]) => ({ id: Number(id), role })),
  );
  const startersShown = starters.length > 0;
  return (
    <>
      <section className="online-detail-section">
        <h3>スタメン</h3>
        <table className="online-team-lineup">
          <thead>
            <tr>
              <th>打順</th>
              <th>守備</th>
              <th>選手</th>
              {batting.map((c) => (
                <th key={c.id} className="is-num">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((e) => {
              const player = byId.get(e.playerId);
              return (
                <tr key={e.battingOrder}>
                  <td>{e.battingOrder}</td>
                  <td>{POS[e.position] || e.position}</td>
                  <NameCell player={player} team={team.teamName} own={own} />
                  <StatCells player={player} columns={batting} />
                </tr>
              );
            })}
          </tbody>
        </table>
        {order.length > 0 && (
          <p className="online-muted">
            9番は先発投手（その日の先発ローテの番）です。
          </p>
        )}
      </section>
      <section className="online-detail-section">
        <h3>投手陣</h3>
        <table className="online-team-lineup">
          <thead>
            <tr>
              <th>持ち場</th>
              <th>選手</th>
              {pitching.map((c) => (
                <th key={c.id} className="is-num">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {starters.map((id, i) => (
              <tr key={`s${id}`}>
                <td>
                  先発{i + 1}
                  {STARTER_ROLES[roles[id]] && roles[id] !== "auto_s" && (
                    <small className="online-muted online-team-role">
                      {STARTER_ROLES[roles[id]]}
                    </small>
                  )}
                </td>
                <NameCell
                  player={byId.get(id)}
                  team={team.teamName}
                  own={own}
                />
                <StatCells player={byId.get(id)} columns={pitching} />
              </tr>
            ))}
            {relievers.map(({ id, role }) => (
              <tr key={`r${id}`}>
                <td>{RELIEF_ROLES[role] || role}</td>
                <NameCell
                  player={byId.get(id)}
                  team={team.teamName}
                  own={own}
                />
                <StatCells player={byId.get(id)} columns={pitching} />
              </tr>
            ))}
            {!startersShown && !relievers.length && (
              <tr>
                <td colSpan={2 + pitching.length} className="online-muted">
                  投手起用がまだありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

function TeamLineupDialog({ view, team, close }) {
  const dialog = useRef(null);
  const own = team === view.teamName;
  // ⚠ 版が上がって読み直す間も前の起用を残す（中の選手の小窓が閉じないように）
  const result = useRead(
    own ? null : "team",
    { team, revision: view.revision },
    { keep: true },
  );
  const shown = own
    ? view
    : result.data?.teamName === team
      ? result.data
      : null;
  useEffect(() => {
    const node = dialog.current;
    const trigger = document.activeElement;
    node.showModal();
    return () => {
      if (node.open) node.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  const dismiss = () => {
    dialog.current.close();
    close();
  };
  return inOnlineRoot(
    <dialog
      ref={dialog}
      className="online-player-dialog online-team-dialog"
      aria-labelledby="online-team-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) dismiss();
      }}
    >
      <header>
        <div>
          <h2 id="online-team-title">{teamLabel(team)}</h2>
          <small>スタメンと投手陣（今の起用）</small>
        </div>
        <button onClick={dismiss} aria-label="球団の起用を閉じる">
          閉じる
        </button>
      </header>
      {shown ? (
        <TeamLineupBody team={shown} own={own} />
      ) : result.error ? (
        <div role="alert">
          {result.error}
          <button onClick={result.retry}>再取得</button>
        </div>
      ) : (
        <p>球団情報を読み込んでいます…</p>
      )}
    </dialog>,
  );
}

/** 球団名のボタン。押すとその球団のスタメンと投手陣を開く（順位表から） */
export default function TeamLineupButton({ view, team, children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="online-team-name"
        onClick={() => setOpen(true)}
        aria-label={`${teamLabel(team)}のスタメンと投手陣を見る`}
      >
        {children || teamLabel(team)}
      </button>
      {open && (
        <TeamLineupDialog
          view={view}
          team={team}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}
