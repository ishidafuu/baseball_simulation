// ============================================================
// 一人用の投手起用の表（`SoloPitchingBoard.jsx`）の編集の中身。
// 画面と分けてあるのは、ハーネス（node）から直に検査するため
// （`tools/sim-harness/solo-pitching-board-check.mjs`）。
//
// 【流用元】オンラインPC版の投手起用（`src/online/PitchingBoard.jsx`・`pitchingEdit.js`）。
//   編集の単位も同じ `{ starters, roles }`。操作（入れ替え・役割の選び直し・見出しへ移す）は
//   `pitchingEdit.js` の関数をそのまま使う。
// 【オンラインとの違い】
//   - **「役割なし」がある**（`NO_ROLE`）。一人用の以前の画面の「控え・未設定」。役割の無い投手は
//     救援の顔ぶれ（`middleRelievers` など）に入らず、ほかに投げる投手が居ないときだけ投げる
//     （`src/game/autoSimulation.js` の「緊急登板」）。オンラインはサーバーが「おまかせ」に
//     読み替えるので無い。
//   - **野手は救援にだけ加えられる**（二刀流）。一人用の先発選び（`generateAILineup`）は
//     投手登録の選手（`isPitcherPlayer`）からしか選ばないので、野手を先発ローテに入れても
//     投げない。先発にしたい野手は、選手の詳細の「ポジション変更」で投手登録にする。
//   - 編集は**その場で `team` に書く**（保存ボタンは無い。元に戻すは `LineupSettingContent`
//     の履歴が受け持つ。`pitchingRotation` は丸ごと控えに入っている）。
// ⚠ 書くときは**試合の側が読む古い形の配列もそろえる**（`middleRelievers`・`setupMen`・
//    `closer`・`relievers`）。自動試合の救援選び・AI監督はこれを読む（`autoSimulation.js`・
//    `aiManager.js`）。並べ方はサーバーの保存（`server/lineupTactics.mjs`）と同じ。
// ============================================================

import { STARTER_ROLES, RELIEF_ROLES } from '../../online/tactics.js';
import {
  MAX_STARTERS,
  isPitcher,
  isStaffableFielder,
  isStarterRole,
  onStaff,
  roleLabel,
  ROLE_HINT,
} from '../../online/pitchingEdit.js';

/** 役割なし（救援の顔ぶれに入らない。ほかに投手が居ないときだけ投げる） */
export const NO_ROLE = 'none';
export const soloRoleLabel = (role) => (role === NO_ROLE ? '役割なし' : roleLabel(role));
export const soloRoleHint = (role) =>
  role === NO_ROLE ? 'ほかに投げる投手が居ないときだけ' : ROLE_HINT[role];

const isStarterId = (rotation, id) => (rotation?.starters || []).includes(id);

/** 保存されている役割を、先発か救援かに合う役割に読む（合わなければ「おまかせ」） */
function savedRole(rotation, id, starter) {
  const raw = rotation?.pitcherRoles?.[id];
  if (starter) return Object.hasOwn(STARTER_ROLES, raw) ? raw : 'auto_s';
  if (Object.hasOwn(RELIEF_ROLES, raw)) return raw;
  // 役割の無い古い保存: 古い形の配列から読む（サーバーの `lineupTactics.mjs` と同じ順）
  if (rotation?.closer === id) return 'closer';
  if ((rotation?.setupMen || []).includes(id)) return 'setup';
  if ((rotation?.middleRelievers || []).includes(id)) return 'auto_r';
  return NO_ROLE;
}

/** 投手起用に入っている野手か（加えた野手＝救援の役割か古い形の配列に居る） */
function fielderOnStaff(rotation, p) {
  if (!isStaffableFielder(p)) return false;
  const raw = rotation?.pitcherRoles?.[p.id];
  return (
    Object.hasOwn(RELIEF_ROLES, raw) ||
    rotation?.closer === p.id ||
    (rotation?.setupMen || []).includes(p.id) ||
    (rotation?.middleRelievers || []).includes(p.id)
  );
}

/**
 * 球団（`team.pitchingRotation` と名簿）から編集の形 `{ starters, roles }` を作る。
 * ⚠ 名簿に居ない・抹消中の先発も外さない（オンラインと同じ。行を出して入れ替えで直せるように）。
 * ⚠ 以前の一人用の画面は**役割で先発を数えていた**ので、先発の役割なのにローテの配列に
 *    居ない投手がいることがある。その画面で先発に見えていたので、ローテの最後へ足す。
 */
export function pitchingFromTeam(team) {
  const rotation = team?.pitchingRotation || {};
  const roster = team?.players || [];
  const starters = [...new Set(rotation.starters || [])];
  for (const p of roster) {
    if (
      isPitcher(p) &&
      !starters.includes(p.id) &&
      Object.hasOwn(STARTER_ROLES, rotation.pitcherRoles?.[p.id]) &&
      starters.length < MAX_STARTERS
    )
      starters.push(p.id);
  }
  const roles = {};
  for (const p of roster) {
    if (p.isActive === false) continue;
    const starter = starters.includes(p.id);
    if (isPitcher(p)) roles[p.id] = savedRole(rotation, p.id, starter);
    // 野手は救援にだけ入る（先発に居る野手は崩れた保存。役割は持たせず、行を出して直させる）
    else if (!starter && fielderOnStaff(rotation, p)) roles[p.id] = savedRole(rotation, p.id, false);
  }
  return { starters, roles };
}

/**
 * 編集の形を球団に書く。
 * ⚠ 抹消中の選手の役割は残す（戻ったときに前の役割で入るように。名簿の画面の外のこと）。
 */
export function writePitching(team, state) {
  if (!team.pitchingRotation) team.pitchingRotation = {};
  const rotation = team.pitchingRotation;
  const roster = team.players || [];
  const kept = Object.fromEntries(
    Object.entries(rotation.pitcherRoles || {}).filter(([id]) =>
      roster.some((p) => String(p.id) === id && p.isActive === false),
    ),
  );
  const staff = roster.filter((p) => p.isActive !== false && onStaff(state, p.id));
  const roleOf = (p) => state.roles[p.id];
  const relievers = staff.filter((p) => !state.starters.includes(p.id) && roleOf(p) !== NO_ROLE);
  const roles = { ...kept };
  for (const p of staff) if (roleOf(p) !== NO_ROLE) roles[p.id] = roleOf(p);
  rotation.starters = [...state.starters];
  rotation.pitcherRoles = roles;
  rotation.relievers = relievers.map((p) => p.id);
  rotation.middleRelievers = relievers
    .filter((p) => !['setup', 'closer'].includes(roleOf(p)))
    .map((p) => p.id);
  rotation.setupMen = relievers.filter((p) => roleOf(p) === 'setup').map((p) => p.id);
  rotation.closer = relievers.find((p) => roleOf(p) === 'closer')?.id ?? null;
  if (rotation.starters.length && (rotation.currentStarterIndex || 0) >= rotation.starters.length)
    rotation.currentStarterIndex = 0;
}

/** 次の試合の先発（試合の側と同じく `currentStarterIndex` の位置） */
export function nextStarterIdOf(team) {
  const rotation = team?.pitchingRotation;
  const starters = rotation?.starters || [];
  if (!starters.length) return null;
  return starters[(rotation.currentStarterIndex || 0) % starters.length];
}

/** 役割を持たない投手（「役割なし」の括り） */
export function unassignedPitchers(state, roster) {
  return (roster || []).filter(
    (p) =>
      p.isActive !== false &&
      onStaff(state, p.id) &&
      !state.starters.includes(p.id) &&
      state.roles[p.id] === NO_ROLE,
  );
}

/** その役割を選べるか（選べないときは理由。選べるときは null） */
export function roleBlocked(state, player, role) {
  const starter = state.starters.includes(player.id);
  if (isStarterRole(role)) {
    if (player.position !== 'pitcher')
      return '野手は先発に入れられません（選手の詳細の「ポジション変更」で投手登録にすると入れられます）';
    if (!starter && state.starters.length >= MAX_STARTERS) return `先発は${MAX_STARTERS}人までです`;
    return null;
  }
  if (starter && state.starters.length <= 1) return '先発が1人も居なくなります';
  return null;
}

/** 一人用で足りない形（崩れてはいないが試合で困るもの）。表の上に出す注意 */
export function pitchingNotes(state, roster) {
  const notes = [];
  const relief = (roster || []).filter(
    (p) => p.isActive !== false && onStaff(state, p.id) && !state.starters.includes(p.id),
  );
  if (!relief.some((p) => state.roles[p.id] === 'closer')) notes.push('クローザーが居ません');
  if (state.starters.length && state.starters.length < 4)
    notes.push(`先発が${state.starters.length}人です（5〜6人が目安）`);
  return notes;
}
