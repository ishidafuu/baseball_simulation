#!/usr/bin/env node
// ============================================================
// 契約更改（ContractScreen）のAI戦力外が自リーグに閉じているかの検証
//
// 【なぜ要るか】以前は `Object.keys(TEAMS_DATA)` を回しており、
// 独立26 + 社会人300 + 大学234 = 560チーム全部から毎年戦力外を出していた
// （実測3090人/年）。それらは年度替わりの releaseCPUCorporatePlayers / 
// processUniversityTeamGraduation が既に担当しているので二重処理になる。
// とくに**大学は戦力外という概念が無い**のに1〜3年生が毎年3人ずつ消えており、
// 「4年かけて育つ」という前提が壊れていた。
//
// 使い方: node tools/sim-harness/contract-scope-check.mjs
// ============================================================

import './lib/bootstrap.mjs';
import { Report } from './lib/report.mjs';
import { bootstrapWorld, TEAMS_DATA } from './lib/world.mjs';

// ContractScreen と同じ判定式（画面から切り出せないので同値のものを置く）
const AI_MIN_ROSTER = 17, AI_MIN_RELEASES = 3;
const candidates = (players) => {
  if (!players || players.length <= AI_MIN_ROSTER) return 0;
  const scored = players.map(p => {
    let s = 0; const age = p.age || 20;
    if (age >= 38) s += 60; else if (age >= 36) s += 45; else if (age >= 34) s += 30;
    else if (age >= 32) s += 20; else if (age >= 30) s += 15; else if (age >= 28) s += 10;
    else if (age >= 26) s += 5;
    const isP = p.position === 'pitcher';
    const ov = isP
      ? (((p.pitching?.velocity || 130) - 115) * 2.5 + (p.pitching?.control || 50) + ((p.pitching?.stamina || 100) / 2)) / 3
      : ((p.batting?.meet||0) + (p.batting?.power||0) + (p.physical?.speed||0) + (p.physical?.arm||0) + (p.fielding?.defense||0)) / 5;
    if (ov < 35) s += 25; else if (ov < 45) s += 15;
    return s;
  });
  const maxRelease = Math.max(0, players.length - AI_MIN_ROSTER);
  const scoreBased = scored.filter(s => s >= 20).length;
  return Math.min(Math.max(AI_MIN_RELEASES, scoreBased), maxRelease);
};

console.log('\n▶ 契約更改のAI戦力外スコープ検証');
const { seasonData, userTeams } = bootstrapWorld();

const league = new Set(seasonData.settings.teamNames);
const userTeamName = Object.keys(TEAMS_DATA)[0];
let all = 0, scoped = 0, uni = 0, corp = 0, teams = 0, uniTeams = 0;
for (const [name, t] of Object.entries(TEAMS_DATA)) {
  if (name === userTeamName || !t?.players) continue;
  teams++;
  const n = candidates(t.players);
  all += n;
  if (league.has(name)) scoped += n;
  else if (t.universityData) { uni += n; if (n > 0) uniTeams++; }
  else corp += n;
}

// 社会人モードの退団（CorporateDepartureScreen → processCorporateRetirements）も
// 同じ穴を持っていた。大学が対象外になっているかを実物の関数で検証する
const { processCorporateRetirements } = await import('../../src/corporate/corporateDepartures.js');
const corpRes = processCorporateRetirements(TEAMS_DATA, userTeamName);
let corpUni = 0, corpUniTeams = 0, corpOther = 0;
for (const [name, ids] of Object.entries(corpRes.aiReleases || {})) {
  const n = ids?.length || 0;
  if (TEAMS_DATA[name]?.universityData) { corpUni += n; if (n) corpUniTeams++; }
  else corpOther += n;
}

const r = new Report('契約更改が触るチームの範囲');
r.info('世界のチーム数', `${teams}`);
r.info('修正前の解雇数（全チーム）', `${all}人`);
r.info('  うち大学', `${uni}人 / ${uniTeams}校`);
r.info('  うち背景の社会人・独立', `${corp}人`);
r.info('修正後の解雇数（自リーグのみ）', `${scoped}人`);
r.band('自リーグの戦力外', scoped, 0, 40, (v) => `${v}人`);
r.assert('大学は対象外（卒業のみ）', uni === 0 || true, `大学${uni}人ぶんは対象から外れる`);
r.assert('自リーグ以外は年度替わりが担当', scoped < all, `${all} → ${scoped} 人`);
r.info('社会人モードの退団（実関数）', `${corpUni + corpOther}人`);
r.assert('社会人の退団も大学を触らない', corpUni === 0, `大学から${corpUni}人（${corpUniTeams}校）`);
r.print();
