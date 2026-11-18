import React, { useState } from 'react';
import { TEAMS_DATA } from '../teams-data.js';
import { ScreenShell, ScreenHeader } from './GameUIComponents.jsx';
// ⚠ チーム戦力レーダーはこの画面から撤去した（下記）。`AbilityRadar` / `teamRadarAxes`
//    自体は試合前モーダルと選手詳細が使っているので消さないこと
import { ensureTeamJerseyNumbers } from '../utils/jerseyNumbers.js';
import PlayerDetailModal from './PlayerDetailModal.jsx';
import { CompactRoster } from '../online/PlayerPerformance.jsx';
// ⚠ 成績の率（打率・防御率など）と「アベレージヒッター」などの札は、オンラインの名簿と
//    **同じ式**で出す（サーバーの `performanceLabels.mjs`。今季成績を読むだけで書き換えない）
import { performanceFor, comparisonFromPlayers } from '../../server/performanceLabels.mjs';
import '../online/online.css';

// ============================================================
// 一人用のチーム情報（管理 → チーム情報）。
// **オンラインPC版の選手成績の表（`CompactRoster`）を流用**する。投手と野手を2つの表に
// 分けず1枚にし、打撃／投球の切り替え・成績と能力の区分のタブ・調子の顔・列の見出しで
// 並べ替え、をオンラインと同じにする（2026-11 いしだ「オンライン版のUIを1人用に流用」）。
// ⚠ オンラインの表は `view`（`roster` と `lineup`）を読むので、ここで球団から組み立てる。
//    `performance` はサーバーがビューに載せる項目なので、ここで同じ関数で作る。
// ⚠ 選手名を押すと一人用の選手詳細を開く（`onOpen`。オンラインの小窓は使わない）。
// ⚠ 見た目はオンラインの部品のクラスなので `.online.online-desktop.online-embed` の中に置く。
// ============================================================

const RECRUIT_TYPE_LABEL = {
  scouted: '推薦',
  selection: 'セレクション',
  // 自分のスカウトを通さずに決まった推薦入学（ほかの大学の新入生はみなこれ）。⚠ 「AI」は作る側の言葉なので出さない
  recommended: '推薦（自動）',
  general: '一般',
};

/** 球団からオンラインの名簿の表が読む形（`view`）を作る */
function viewOfTeam(teamName, team, comparison) {
  const rotation = team.pitchingRotation || {};
  return {
    teamName,
    roster: team.players.map((p) => ({ ...p, performance: performanceFor(p, comparison) })),
    lineup: {
      battingOrder: team.lineupSettings?.battingOrder || [],
      starters: rotation.starters || [],
      pitcherRoles: rotation.pitcherRoles || {},
    },
  };
}

const TeamInfoScreen = ({ gameMode }) => {
  const isUniversity = gameMode === 'university';
  const teamNames = Object.keys(TEAMS_DATA || {});
  const [selectedTeam, setSelectedTeam] = useState(teamNames[0] || 'チームA');
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  const team = TEAMS_DATA[selectedTeam];
  if (!team || !team.players) {
    return <div className="text-gray-300 text-center p-8">チームデータがありません</div>;
  }
  ensureTeamJerseyNumbers(team); // 背番号を（未設定なら）割り当て

  // 札（アベレージヒッターなど）は全球団の今季の平均と比べる（オンラインはリーグの平均）
  const comparison = comparisonFromPlayers(teamNames.flatMap((name) => TEAMS_DATA[name]?.players || []));
  const view = viewOfTeam(selectedTeam, team, comparison);
  // 大学は学年と入部の種類を名前の横に（以前の表の「出身校・入部」の列。出身校は印の説明に）
  const extraMark = isUniversity
    ? (player) => {
        const recruit = RECRUIT_TYPE_LABEL[player.recruitType];
        if (!player.universityYear && !recruit) return null;
        return (
          <small title={player.highSchool?.name ? `出身校: ${player.highSchool.name}` : undefined}>
            {[player.universityYear ? `${player.universityYear}年` : null, recruit].filter(Boolean).join('・')}
          </small>
        );
      }
    : undefined;
  const selector = (
    <span className="online-team-selector">
      <select
        aria-label="表示する球団"
        value={selectedTeam}
        onChange={(e) => {
          setSelectedTeam(e.target.value);
          setSelectedPlayer(null);
        }}
      >
        {teamNames.map((teamName) => (
          <option key={teamName} value={teamName}>
            {teamName}
          </option>
        ))}
      </select>
    </span>
  );

  return (
    <ScreenShell>
      {/* ⚠ かつてここに「総人数 / 投手 / 野手 ＋ チーム戦力レーダー」の全幅パネルがあったが
          **撤去した**。3つの数字は下の表の見出し（人数）と重複しており、
          大学・独立のチームでは実質それとレーダーだけで、1250×330px のパネルの大半が空白だった。
          ⚠ ただし**社会人チームだけはランクと注目度も持っていた**——これはこの画面に
          他に出る場所が無いので、見出しの右へ移して残す。数字と重複しているものだけ捨てる。
          ⚠ `teamRadarAxes` は消さないこと。試合前モーダル（相手チームの戦力）が使っている */}
      <ScreenHeader
        title="チーム情報"
        right={team?.corporateData ? (() => {
          const cd = team.corporateData;
          const rankColor = { S: 'text-yellow-400', A: 'text-blue-400', B: 'text-green-400', C: 'text-gray-300', D: 'text-gray-400' }[cd.rank] || 'text-gray-300';
          return (
            <div className="flex items-center gap-4 bg-surface-2 rounded-lg px-4 py-2">
              <div className="text-center">
                <div className="text-xs text-gray-300 leading-none">ランク</div>
                <div className={`text-xl font-black leading-tight ${rankColor}`}>{cd.rank}</div>
              </div>
              <div>
                <div className="text-xs text-gray-300 leading-none">注目度</div>
                <div className="flex items-center gap-2">
                  <div className="text-xl font-bold text-white leading-tight tabular-nums">{Math.round(cd.reputation)}</div>
                  <div className="w-16 bg-gray-700 rounded-full h-2">
                    <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full" style={{ width: `${cd.reputation}%` }} />
                  </div>
                </div>
              </div>
            </div>
          );
        })() : null}
      />

        <div className="online online-desktop online-embed">
          <section className="online-card" data-testid="solo-team-roster">
            <CompactRoster
              key={selectedTeam}
              view={view}
              desktop
              teamSelector={selector}
              // ⚠ 表の行は `performance` を足した写しなので、元の選手で開く（詳細で書き換える項目がある）
              onOpen={(p) => setSelectedPlayer(team.players.find((x) => x.id === p.id) || p)}
              extraMark={extraMark}
            />
          </section>
        </div>

      {selectedPlayer && <PlayerDetailModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />}
    </ScreenShell>
  );
};

export default TeamInfoScreen;
