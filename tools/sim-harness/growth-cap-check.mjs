#!/usr/bin/env node
// ============================================================
// 年齢の伸びの上限と、その報告の検査（`applyAgeCurveChanges`）
//
// 上限（`STAT_GROWTH` の cap）で止まった分は、能力にも報告にも載せない。
// キャンプの成長レポートは報告の `change` を「うち年齢による変化」としてそのまま出すので、
// 体力98に+3で99なら +1 と出ること、99→99 の行が出ないことを見る（監査 2026-11-19）。
// 終了コード: 全PASSで0、FAILで1。
// ============================================================
import assert from 'node:assert/strict';
import { applyAgeCurveChanges } from '../../src/season/growthSystem.js';
import { createCandidatePlayer } from '../../src/season/playerFactory.js';
import { normalizePlayer } from '../../src/game/saveMigration.js';
import { ABILITY_CAP } from '../../src/utils/constants.js';

const players = [];
for (let i = 0; i < 40; i += 1) {
  const p = createCandidatePlayer({ position: i % 2 ? 'pitcher' : 'shortstop' });
  p.name = `上限${i}`;
  p.age = 20;
  // 上限の手前に寄せる（伸びが上限で止まる場面を作る）
  for (const box of [p.batting, p.pitching, p.physical, p.fielding])
    if (box) for (const [k, v] of Object.entries(box)) if (typeof v === 'number' && v >= 40 && v <= 100) box[k] = 98;
  p.growthPotential = 1.8;
  players.push(p);
}
let reported = 0;
for (let round = 0; round < 20; round += 1) {
  const { updatedTeams, ageReports } = applyAgeCurveChanges({ 検査: { players } });
  const after = new Map(updatedTeams['検査'].players.map((p) => [p.name, p]));
  for (const r of ageReports)
    for (const c of r.changes) {
      reported += 1;
      assert.notEqual(c.change, 0, `${r.name} の ${c.statName} が ±0 で報告に出た`);
      assert.equal(c.change, c.after - c.before, `${r.name} の ${c.statName}: 報告 ${c.change} と実際 ${c.before}→${c.after} が違う`);
    }
  assert.ok(after.size === players.length);
}
assert.ok(reported > 0, '報告が1件も無い（検査の作りが壊れている）');
// 上限が無かった頃の保存はロードで丸める（一人用。オンラインは版15の移行）
{
  const p = createCandidatePlayer({ position: 'pitcher' });
  p.physical.bodyStamina = 118;
  p.pitching.control = 100;
  p.fatigue = 2400;
  normalizePlayer(p);
  assert.deepEqual([p.physical.bodyStamina, p.pitching.control, p.fatigue], [ABILITY_CAP, ABILITY_CAP, 150], 'ロードで上限を超えた値を丸めていない');
}
console.log(`growth-cap-check: ok（報告 ${reported} 件）`);
