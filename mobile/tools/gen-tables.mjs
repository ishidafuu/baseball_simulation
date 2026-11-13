// ============================================================
// Web 版の表（練習メニュー・采配の選択肢・投手の役割・しきい値など）から
// アプリの Kotlin の表（shared/.../Tables.kt）を書き出す。
//
// ⚠ **表を手で写さないこと**。Web 側で選択肢やしきい値を変えたとき、写しだけ古くなる。
//    `node mobile/tools/gen-tables.mjs` で作り直し、`--check` で食い違いを検査する（CI で回す）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const at = (p) => path.join(root, p);
const { TRAINING_MENUS, SUB_TRAINING_MENUS } = await import(at('src/season/campTraining.js'));
const { DIRECTIONS, PHASES } = await import(at('src/season/trainingPolicy.js'));
const tactics = await import(at('src/online/tactics.js'));
const shared = await import(at('src/online/shared.js'));
const pitching = await import(at('src/online/pitchingEdit.js'));
const constants = await import(at('src/utils/constants.js'));
const pyramid = await import(at('src/online/pyramidLeague.js'));
const api = await import(at('src/online/api.js'));

// ⚠ Kotlin の文字列では `$` が式の始まりになるので逃がす
const q = (s) => JSON.stringify(String(s)).replaceAll('$', '\\$');
const lines = [];
const out = (s = '') => lines.push(s);
out('// このファイルは mobile/tools/gen-tables.mjs が Web 版の表から書き出したもの。手で直さないこと。');
out('package jp.icenorth.baseball.shared');
out('');
out('data class Menu(val key: String, val name: String, val icon: String, val description: String, val category: String? = null, val only: String? = null)');
out('data class Choice(val key: String, val label: String)');
out('data class ChoiceField(val key: String, val label: String, val numeric: Boolean, val options: List<Choice>, val default: String)');
out('');
const only = { breaking: 'pitcher', newpitch: 'pitcher', spin_analysis: 'pitcher', clead_study: 'catcher' };
// 守備位置で決まる「その練習が効くか」は campTraining.js の関数で確かめてから書く
for (const key of Object.keys(only))
  if (SUB_TRAINING_MENUS[key] && shared.CAMP_SUB_MENUS.includes(key)) {
    const pos = only[key];
    const other = pos === 'pitcher' ? 'catcher' : 'pitcher';
    const { subMenuFitsPlayer } = await import(at('src/season/campTraining.js'));
    if (!subMenuFitsPlayer(key, { position: pos }) || subMenuFitsPlayer(key, { position: other }))
      throw new Error(`サブ練習 ${key} の対象が変わった。gen-tables.mjs の only を直す`);
  }
out('val CAMP_MENUS: List<Menu> = listOf(');
for (const key of shared.CAMP_MENUS) {
  const m = TRAINING_MENUS[key];
  out(`    Menu(${q(key)}, ${q(m.name)}, ${q(m.icon || '')}, ${q(m.description || '')}, category = ${q(m.category)}),`);
}
out(')');
out('val CAMP_SUB_MENUS: List<Menu> = listOf(');
for (const key of shared.CAMP_SUB_MENUS) {
  const m = SUB_TRAINING_MENUS[key];
  out(`    Menu(${q(key)}, ${q(m.name)}, ${q(m.icon || '')}, ${q(m.description || '')}, only = ${only[key] ? q(only[key]) : 'null'}),`);
}
out(')');
out('val CAMP_DIRECTIONS: List<Menu> = listOf(');
for (const key of shared.CAMP_DIRECTIONS) out(`    Menu(${q(key)}, ${q(DIRECTIONS[key].name)}, ${q(DIRECTIONS[key].icon)}, ${q(DIRECTIONS[key].description)}),`);
out(')');
out('val CAMP_PHASES: List<Menu> = listOf(');
for (const key of shared.CAMP_PHASES) out(`    Menu(${q(key)}, ${q(PHASES[key].name)}, ${q(PHASES[key].icon)}, ${q(PHASES[key].description)}),`);
out(')');
const fields = (obj, defaults = {}) => {
  out('listOf(');
  for (const [key, [label, options]] of Object.entries(obj)) {
    const numeric = typeof defaults[key] === 'number';
    const def = defaults[key] ?? Object.keys(options)[0];
    out(`    ChoiceField(${q(key)}, ${q(label)}, ${numeric}, listOf(${Object.entries(options).map(([k, v]) => `Choice(${q(k)}, ${q(v)})`).join(', ')}), ${q(def)}),`);
  }
  out(')');
};
lines.push('val STRATEGY_FIELDS: List<ChoiceField> = '); fields(tactics.STRATEGY_FIELDS);
lines.push('val TACTIC_FIELDS: List<ChoiceField> = '); fields(tactics.TACTIC_FIELDS, tactics.TACTIC_DEFAULTS);
const map = (name, obj) => out(`val ${name}: Map<String, String> = mapOf(${Object.entries(obj).map(([k, v]) => `${q(k)} to ${q(v)}`).join(', ')})`);
// 方針の効き目（Web 版の作戦画面と同じ文。キーは「項目.値」。`strategyEffectText`）
{
  const effects = {};
  for (const [key, [, options]] of Object.entries(tactics.STRATEGY_FIELDS))
    for (const value of Object.keys(options)) effects[`${key}.${value}`] = tactics.strategyEffectText(key, value);
  map('STRATEGY_EFFECTS', effects);
}
map('STARTER_ROLES', tactics.STARTER_ROLES);
map('RELIEF_ROLES', tactics.RELIEF_ROLES);
map('ROLE_HINT', pitching.ROLE_HINT);
map('PHASE_LABELS', shared.PHASE_LABELS);
map('FORM_SHORT', constants.FORM_SHORT);
const pitchTypes = {};
for (const key of Object.keys(constants.BALL_EFFECTS || {})) pitchTypes[key] = constants.getPitchTypeName(key);
map('PITCH_TYPE_NAMES', pitchTypes);
out(`val RELIEF_ORDER: List<String> = listOf(${pitching.RELIEF_ORDER.map(q).join(', ')})`);
out(`val STARTER_ORDER: List<String> = listOf(${pitching.STARTER_ORDER.map(q).join(', ')})`);
const ints = {
  MAX_STARTERS: pitching.MAX_STARTERS,
  RELIEF_REST_FATIGUE: pitching.RELIEF_REST_FATIGUE,
  STARTER_SKIP_FATIGUE: shared.STARTER_SKIP_FATIGUE,
  FIELDER_REST_FATIGUE: shared.FIELDER_REST_FATIGUE,
  SUBSTITUTE_MIN_FITNESS: shared.SUBSTITUTE_MIN_FITNESS,
  SUBSTITUTE_FRESH_FATIGUE: shared.SUBSTITUTE_FRESH_FATIGUE,
  ROSTER_LIMIT: shared.ROSTER_LIMIT,
  CAMP_ROUNDS: shared.CAMP_ROUNDS,
};
for (const [k, v] of Object.entries(ints)) {
  if (!Number.isInteger(v)) throw new Error(`${k} が読めない`);
  out(`const val ${k}: Int = ${v}`);
}
// 1年の流れの帯（`SEASON_STEPS`）と、キャンプの方針ごとの伸びの目安（`CAMP_POLICY_GUIDE`）
out('data class SeasonStep(val key: String, val label: String, val time: String, val todo: String)');
out('val SEASON_STEPS: List<SeasonStep> = listOf(');
for (const s of shared.SEASON_STEPS) out(`    SeasonStep(${q(s.key)}, ${q(s.label)}, ${q(s.when)}, ${q(s.todo)}),`);
out(')');
out('val CAMP_POLICY_GUIDE: Map<String, Pair<String, String>> = mapOf(');
for (const [k, v] of Object.entries(shared.CAMP_POLICY_GUIDE)) out(`    ${q(k)} to (${q(v.fielder)} to ${q(v.pitcher)}),`);
out(')');
out(`val ONLINE_ROSTER_TARGETS: Map<String, Int> = mapOf(${Object.entries(shared.ONLINE_ROSTER_TARGETS).map(([k, v]) => `${q(k)} to ${v}`).join(', ')})`);
// 版のずれだけなら送り直す命令（OnlineApi.kt の command）。⚠ Web 版と同じ一覧を使う（アプリだけ campRound が抜けていた）
if (!Array.isArray(shared.RETRY_ON_REVISION)) throw new Error('RETRY_ON_REVISION が読めない');
out(`val RETRY_ON_REVISION: Set<String> = setOf(${shared.RETRY_ON_REVISION.map(q).join(', ')})`);
// 順位表の昇格圏・降格圏（Web 版 LeaguePanels.jsx の Standings と同じ決まり。上から PROMOTION_PLACES 位まで・下から RELEGATION_FROM_BOTTOM 位まで）
out('data class PyramidLeague(val id: String, val name: String, val promotes: Boolean, val relegates: Boolean)');
out('val PYRAMID_LEAGUES: List<PyramidLeague> = listOf(');
for (const l of pyramid.PYRAMID_LEAGUES) out(`    PyramidLeague(${q(l.id)}, ${q(l.name)}, ${l.up.length > 0}, ${l.down.length > 0}),`);
out(')');
for (const [k, v] of Object.entries({ PROMOTION_PLACES: pyramid.PROMOTION_PLACES[0], RELEGATION_FROM_BOTTOM: pyramid.RELEGATION_FROM_BOTTOM[0] })) {
  if (!Number.isInteger(v)) throw new Error(`${k} が読めない`);
  out(`const val ${k}: Int = ${v}`);
}
// キャンプのサブ練習で選べる対象（Web 版 CampPlanner.jsx の subTargetChoices と同じ材料）。
// ⚠ アプリは対象を送っていなかった（新球種は中で抽選、サブポジ練習は置き場が無いとして外れていた）
const list = (name, values) => {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${name} が読めない`);
  out(`val ${name}: List<String> = listOf(${values.map(q).join(', ')})`);
};
map('CAMP_SUB_TARGETS', shared.CAMP_SUB_TARGETS);
list('CAMP_PITCH_TYPES', shared.CAMP_PITCH_TYPES);
list('CONVERT_POSITIONS', shared.CONVERT_POSITIONS);
map('POSITION_NAMES', api.POS_FULL);
const text = lines.join('\n') + '\n';
const file = path.join(root, 'mobile/shared/src/commonMain/kotlin/jp/icenorth/baseball/shared/Tables.kt');
if (process.argv.includes('--check')) {
  const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (now !== text) {
    console.error('Tables.kt が Web 版の表と食い違っています。node mobile/tools/gen-tables.mjs で作り直してください');
    process.exit(1);
  }
  console.log('Tables.kt は Web 版の表と一致しています');
} else {
  fs.writeFileSync(file, text);
  console.log('wrote', path.relative(root, file));
}
