import { validateTactics } from './lineupTactics.mjs';
import { placeholderPitcherId } from '../src/game/lineup.js';
import { staffModesOf } from '../src/online/coaches.js';
import { TACTIC_DEFAULTS, STRATEGY_DEFAULTS, STRATEGY_FIELDS } from '../src/online/tactics.js';
import { projectLineup } from './projection.mjs';
import {
  requireOnline,
  validateLineup,
  assertLeagueVersion,
} from '../src/online/shared.js';

/**
 * 任せ方の分野ごとの「中身」（見比べるための文字列）。保存の前後で比べて、
 * 人が自分で変えた分野だけを知る。
 * ⚠ 形の違い（項目が無い／既定値が書いてある、救援の欄と役割の書き方）では変わったことにしない。
 *    画面と同じ形（`projectLineup`）と、既定値を埋めた采配で比べる
 */
function staffAreasOf(team) {
  const view = projectLineup(team);
  return {
    order: JSON.stringify(
      view.battingOrder.map(({ playerId, battingOrder, position }) => [playerId, battingOrder, position]),
    ),
    rotation: JSON.stringify([view.starters, view.pitcherRoles || null]),
    tactics: JSON.stringify([
      { ...TACTIC_DEFAULTS, ...(team.onlineTactics || {}) },
      { ...STRATEGY_DEFAULTS, ...(team.strategy || {}) },
    ]),
  };
}

export function saveLineup(league, userId, plan) {
  assertLeagueVersion(league);
  // ⚠ **手続きの間（waiting）も保存できること**。画面は手続き中も編成を開ける
  //    設計（「打順や投手起用はいつ決めてもよい」）なのに、以前はここで弾いており、
  //    キャンプ中に決めた打順を保存しようとすると毎回「この期間は編成変更できません」
  //    になっていた。手続きの解決は、成り立つ限り人の編成を残す（`refreshTeamPlan`）。
  requireOnline(
    ['running', 'paused', 'waiting'].includes(league.status),
    'この期間は編成変更できません',
    409,
  );
  const member = league.members.find((m) => m.userId === userId);
  requireOnline(member, '参加者ではありません', 403);
  const team = league.game.teams[member.teamName];
  validateLineup(team, plan);
  // 指導者に任せていた分野を見比べるための、保存前の写し（`staffAreasOf`）
  const before = staffAreasOf(team);
  let strategy = team.strategy;
  if (plan.strategy) {
    // ⚠ 許す値は画面と同じ表（`STRATEGY_FIELDS`）から作る。手で写すと、方針を足したときに保存だけ弾かれる
    strategy = {};
    for (const [key, [, options]] of Object.entries(STRATEGY_FIELDS)) {
      const values = Object.keys(options);
      const value = plan.strategy[key] ?? team.strategy?.[key] ?? STRATEGY_DEFAULTS[key];
      requireOnline(values.includes(value), '采配方針が不正です');
      strategy[key] = value;
    }
  }
  const rotationChanged =
    team.pitchingRotation.starters.length !== plan.starters.length ||
    team.pitchingRotation.starters.some(
      (id, index) => id !== plan.starters[index],
    );
  const tactical = validateTactics(team, plan, rotationChanged);
  const index = rotationChanged
    ? 0
    : (team.pitchingRotation.currentStarterIndex || 0) % plan.starters.length;
  // 9番（投手）は次の先発。⚠ 次の先発が野手の打順にも入っている（二刀流）ときは、
  //    同じ選手を2回並べない。9番は試合の日に組み直す（`prepareDailyLineup`）ので、
  //    ここは野手に入っていない先発で仮に埋めておく
  //    決め方は `placeholderPitcherId`（試合の後の戻し・スマホの編成と同じ）
  const fielding = new Set(plan.battingOrder.map((e) => e.playerId));
  const ninth = placeholderPitcherId(
    team.players,
    plan.starters,
    index,
    fielding,
  );
  requireOnline(ninth !== undefined, '投手を含む9人の選手が必要です');
  team.lineupSettings = {
    battingOrder: plan.battingOrder.map(
      ({ playerId, battingOrder, position }) => ({
        playerId,
        battingOrder,
        position,
      }),
    ),
    benchPlayers: [],
    substitutionRules: { pinchHitter: [], pinchRunner: [] },
  };
  team.lineupSettings.battingOrder.push({
    playerId: ninth,
    battingOrder: 9,
    position: 'pitcher',
  });
  team.pitchingRotation.starters = [...plan.starters];
  team.pitchingRotation.currentStarterIndex = index;
  if (strategy) team.strategy = strategy;
  if (tactical.tactics) team.onlineTactics = tactical.tactics;
  if (tactical.rotation)
    Object.assign(team.pitchingRotation, tactical.rotation);
  // ⚠ **任せていた分野を自分で変えたら、その分野は「意見を聞く」に戻す**（仕様書は「自分で」。
  //    采配は1項目だけ変えても残りの「AI判断」が標準に戻ってしまうので、指導者の考えは残す）。
  //    変えていない分野は任せたまま（采配だけ直した保存で、打順まで自分持ちにならないように）
  const modes = staffModesOf(member);
  const after = staffAreasOf(team);
  const changed = (key) => before[key] !== after[key];
  const flips = {};
  if (modes.lineup === 'delegate' && changed('order')) flips.lineup = 'advice';
  if (modes.pitching === 'delegate' && changed('rotation')) flips.pitching = 'advice';
  if (modes.tactics === 'delegate' && changed('tactics')) flips.tactics = 'advice';
  if (Object.keys(flips).length) member.staffModes = { ...modes, ...flips };
}
