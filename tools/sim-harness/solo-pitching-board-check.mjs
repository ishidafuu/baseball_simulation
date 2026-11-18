// 一人用の投手起用の表（`src/components/lineup/SoloPitchingBoard.jsx`）の編集の中身
// （`src/components/lineup/soloPitchingEdit.js`）。
//
// ⚠ 見るのは「表で書いた形を**試合の側がそのまま読める**」こと。自動試合の救援選びは
//    古い形の配列（`middleRelievers`・`setupMen`・`closer`）を読み、先発は `starters` から選ぶ。
//    それと、一人用だけの決まり（役割なし・野手は救援だけ）を崩さないこと。
import assert from 'node:assert/strict';
import { swapPitchers, setRole, insertStarter, addToStaff, removeFromStaff } from '../../src/online/pitchingEdit.js';
import {
  NO_ROLE,
  pitchingFromTeam,
  writePitching,
  nextStarterIdOf,
  unassignedPitchers,
  roleBlocked,
} from '../../src/components/lineup/soloPitchingEdit.js';

let id = 0;
const pitcher = (extra = {}) => ({ id: ++id, name: `投手${id}`, position: 'pitcher', pitching: { velocity: 145, control: 50, stamina: 60 }, ...extra });
const fielder = (position, extra = {}) => ({ id: ++id, name: `野手${id}`, position, pitching: { velocity: 130, control: 40, stamina: 30 }, ...extra });

function makeTeam() {
  id = 0;
  const starters = [pitcher(), pitcher(), pitcher(), pitcher(), pitcher()];
  const closer = pitcher();
  const setup = pitcher();
  const middle = [pitcher(), pitcher()];
  const idle = pitcher(); // 役割なし（以前の画面の「控え・未設定」）
  const legacy = pitcher(); // 役割が無く、古い形の配列だけに居る救援
  const away = pitcher({ isActive: false }); // 抹消中
  const fielders = [fielder('catcher'), fielder('short')];
  const players = [...starters, closer, setup, ...middle, idle, legacy, away, ...fielders];
  const pitcherRoles = {
    ...Object.fromEntries(starters.map((p, i) => [p.id, i === 0 ? 'ace' : 'quality'])),
    [closer.id]: 'closer',
    [setup.id]: 'setup',
    [middle[0].id]: 'long',
    [middle[1].id]: 'ace_relief',
    [away.id]: 'mopup',
  };
  return {
    team: {
      players,
      pitchingRotation: {
        starters: starters.map((p) => p.id),
        currentStarterIndex: 2,
        pitcherRoles,
        middleRelievers: [middle[0].id, middle[1].id, legacy.id],
        setupMen: [setup.id],
        closer: closer.id,
      },
    },
    starters,
    closer,
    setup,
    middle,
    idle,
    legacy,
    away,
    fielders,
  };
}

/** 書いた形が、試合の側が読む配列とそろっているか */
function consistent(team, label) {
  const r = team.pitchingRotation;
  const roles = r.pitcherRoles;
  const starterSet = new Set(r.starters);
  for (const id of r.middleRelievers) {
    assert.ok(!starterSet.has(id), `${label}: 先発が中継ぎの配列に居る`);
    assert.ok(roles[id] && !['setup', 'closer'].includes(roles[id]), `${label}: 中継ぎの配列の役割が合わない`);
  }
  for (const id of r.setupMen) assert.equal(roles[id], 'setup', `${label}: セットアッパーの配列の役割が合わない`);
  assert.equal(Object.values(roles).filter((x) => x === 'closer').length <= 1, true, `${label}: クローザーが2人居る`);
  if (r.closer != null) assert.equal(roles[r.closer], 'closer', `${label}: closer の役割が合わない`);
  for (const p of team.players) {
    if (p.isActive === false) continue;
    if (roles[p.id] === undefined) {
      assert.ok(!r.middleRelievers.includes(p.id) && !r.setupMen.includes(p.id) && r.closer !== p.id, `${label}: 役割なしが救援の配列に居る`);
    }
  }
}

// ---- 読む: 役割・古い形・役割なし・抹消中
{
  const t = makeTeam();
  const state = pitchingFromTeam(t.team);
  assert.deepEqual(state.starters, t.starters.map((p) => p.id), '先発の順');
  assert.equal(state.roles[t.starters[0].id], 'ace');
  assert.equal(state.roles[t.closer.id], 'closer');
  assert.equal(state.roles[t.legacy.id], 'auto_r', '古い形の配列だけの救援は「おまかせ」で読む');
  assert.equal(state.roles[t.idle.id], NO_ROLE, '役割の無い投手は「役割なし」');
  assert.equal(state.roles[t.away.id], undefined, '抹消中は表に出さない');
  assert.equal(state.roles[t.fielders[0].id], undefined, '加えていない野手は投手起用に居ない');
  assert.deepEqual(unassignedPitchers(state, t.team.players).map((p) => p.id), [t.idle.id]);
  assert.equal(nextStarterIdOf(t.team), t.starters[2].id, '次の先発は currentStarterIndex の位置');

  // 何も変えずに書いても、試合の側の配列がそろう
  writePitching(t.team, state);
  consistent(t.team, '書き直し');
  assert.equal(t.team.pitchingRotation.pitcherRoles[t.away.id], 'mopup', '抹消中の役割は残す');
  assert.ok(t.team.pitchingRotation.middleRelievers.includes(t.legacy.id), '古い形の救援は顔ぶれに残る');
  assert.ok(!t.team.pitchingRotation.middleRelievers.includes(t.idle.id), '役割なしは顔ぶれに入らない');
}

// ---- 以前の画面の形: 先発の役割なのにローテの配列に居ない投手はローテの最後へ
{
  const t = makeTeam();
  t.team.pitchingRotation.pitcherRoles[t.idle.id] = 'complete';
  const state = pitchingFromTeam(t.team);
  assert.equal(state.starters.at(-1), t.idle.id);
  assert.equal(state.roles[t.idle.id], 'complete');
}

// ---- 操作して書く
{
  const t = makeTeam();
  let state = pitchingFromTeam(t.team);
  // 救援と先発を入れ替える → 救援が先発の登板順と型を引き継ぐ
  state = swapPitchers(state, t.middle[0].id, t.starters[1].id);
  assert.equal(state.starters[1], t.middle[0].id);
  assert.equal(state.roles[t.starters[1].id], 'long');
  // 役割なしの投手をクローザーに → 前のクローザーは「役割なし」を引き継ぐ
  state = setRole(state, t.idle.id, 'closer');
  assert.equal(state.roles[t.closer.id], NO_ROLE);
  // 先発を役割なしへ（ローテから外れる）
  state = setRole(state, t.starters[4].id, NO_ROLE);
  assert.ok(!state.starters.includes(t.starters[4].id));
  // 役割なしの投手をローテへ
  state = insertStarter(state, t.closer.id, state.starters.length);
  assert.equal(state.starters.at(-1), t.closer.id);
  // 野手を救援に加え、外す
  state = addToStaff(state, t.fielders[0]);
  assert.equal(state.roles[t.fielders[0].id], 'auto_r');
  writePitching(t.team, state);
  consistent(t.team, '操作のあと');
  const r = t.team.pitchingRotation;
  assert.equal(r.closer, t.idle.id);
  assert.ok(r.middleRelievers.includes(t.fielders[0].id), '加えた野手は救援の顔ぶれに入る');
  assert.ok(!r.middleRelievers.includes(t.starters[4].id), '役割なしにした投手は顔ぶれから外れる');
  assert.equal(r.pitcherRoles[t.starters[4].id], undefined);
  // 読み直すと同じ形
  const again = pitchingFromTeam(t.team);
  assert.deepEqual(again.starters, state.starters, '読み直した先発の順');
  assert.deepEqual(again.roles, state.roles, '読み直した役割');
  // 外す
  state = removeFromStaff(again, t.fielders[0].id, t.team.players);
  writePitching(t.team, state);
  assert.ok(!t.team.pitchingRotation.middleRelievers.includes(t.fielders[0].id));
  assert.equal(pitchingFromTeam(t.team).roles[t.fielders[0].id], undefined, '外した野手は投手起用に居ない');
}

// ---- 選べない役割
{
  const t = makeTeam();
  const state = addToStaff(pitchingFromTeam(t.team), t.fielders[1]);
  assert.ok(roleBlocked(state, t.fielders[1], 'ace'), '野手は先発の型を選べない');
  assert.equal(roleBlocked(state, t.fielders[1], 'setup'), null);
  const one = { starters: [t.starters[0].id], roles: { [t.starters[0].id]: 'ace' } };
  assert.ok(roleBlocked(one, t.starters[0], 'closer'), '最後の1人の先発は救援にできない');
  assert.ok(roleBlocked(one, t.starters[0], NO_ROLE), '最後の1人の先発は役割なしにできない');
}

// ---- 先発が減って currentStarterIndex が範囲の外になったら先頭へ
{
  const t = makeTeam();
  t.team.pitchingRotation.currentStarterIndex = 4;
  let state = pitchingFromTeam(t.team);
  state = setRole(state, t.starters[4].id, 'auto_r');
  writePitching(t.team, state);
  assert.equal(t.team.pitchingRotation.currentStarterIndex, 0);
}

console.log('solo-pitching-board-check: ok');
