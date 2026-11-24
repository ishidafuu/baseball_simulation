#!/usr/bin/env node
// ============================================================
// 自然成長の検査（`naturalAgeCoef` の年齢曲線と `expectedNaturalGrowth` の表示）
//
// ⚠ いしだ 2026-11-20 の指定（この表を正本とする）:
//    「基本、成長係数は23歳まで徐々に上がり、出場試合数によってプラス変動、
//      疲労があるのに出場することでマイナス変動、26歳から徐々に減り始めます」
//    素質1.0の高卒選手（主要な能力1つあたり・1年の点）:
//      19歳 1.00 / 20 1.05 / 21 1.10 / 22 1.15 / 23〜25 1.20 /
//      26 1.15 / 27 1.05 / 28 0.90 / 29 0.70 / 30 0.45 / 31 0.15 /
//      32 -0.20 / 33 -0.60 / 34 -1.05 / 35 -1.55 / 36 -2.10 /
//      37 -2.70 / 38 -3.35 / 39 -4.05 / 40 -4.80
//    きっかけは「実際プレイしていると、なかなか衰えず、ずっとベテランが居座ります」。
//
// ⚠ **2つの基準で比べる**。伸びと衰えは別の要素で削られるので、同じ能力値では測れない。
//    伸びる側 … 能力38（天井の減衰にかからない若手の帯）
//    衰える側 … 能力50（`STAT_GROWTH[].ref` と同じ水準。`declineScale` が1倍になる）
//    どちらも 素質1.0・プロ意識50・レギュラー出場（450打数）・独立リーグのランクC。
// ⚠ **表の年齢は年度替わりの（加齢した後の）年齢**。年度送りは加齢してから伸ばすので、
//    表の「19歳」はシーズン中に18歳の選手の数字。`fielder(age)` はシーズン中の年齢を age-1 に置く。
//
// 見るのは7つ。
//   1. **表示＝実際**。シーズン中に出した `expectedNaturalGrowth`（一人用は `naturalGrowthOf`）が、
//      年度送りと同じ順（変動の半減 `updateGrowthModifiers` → 加齢 → `applyCorporatePlayerGrowth`）
//      で実際に動いた平均と合う。区分（独立・社会人・クラブ・オンライン）と球団の格ごとに見る。
//   2. **指定の表に乗る**（上の2基準で）。
//   3. **山は23〜27歳**。19歳より23歳の方が伸びる（指定どおり上がってから下がる）。
//   4. **素質が高いほど長持ちし、若いうちもよく伸びる**。
//   5. **プロ意識と出場の変動で曲線が後ろにずれる**（大事に使うと長持ちする）。
//   6. **30代後半は年2点以上落ちる**（ベテランが席を明け渡す）。
//   7. 表示の計算が選手を書き換えない（`peek`）・投手でも出る・画面の見た目。
// 終了コード: 全PASSで0、FAILで1。
// ============================================================
import assert from 'node:assert/strict';
import {
  expectedNaturalGrowth,
  naturalAgeCoef,
  naturalCoefOf,
  naturalPeakAge,
  STAT_GROWTH,
  updateGrowthModifiers,
  applyCorporatePlayerGrowth,
  teamRankMult,
} from '../../src/season/growthSystem.js';
import { withSeededRandom, hashSeed } from '../../src/game/rng.js';
import { estimatePeakAge } from '../../src/season/potential.js';
import { outlookOf } from '../../src/online/ageOutlook.js';
import { ABILITY_HELP } from '../../src/online/playerInfo.js';
import { growthStopAge } from '../../src/season/campTraining.js';
import { createCandidatePlayer } from '../../src/season/playerFactory.js';
import { naturalGrowthOf, naturalGrowthText, naturalGrowthColor } from '../../src/utils/naturalGrowth.js';

/** いしだ指定の表（素質1.0・1能力あたり・1年） */
const TARGET = {
  19: 1.00, 20: 1.05, 21: 1.10, 22: 1.15, 23: 1.20, 24: 1.20, 25: 1.20,
  26: 1.15, 27: 1.05, 28: 0.90, 29: 0.70, 30: 0.45, 31: 0.15,
  32: -0.20, 33: -0.60, 34: -1.05, 35: -1.55, 36: -2.10,
  37: -2.70, 38: -3.35, 39: -4.05, 40: -4.80,
};
/** 平均を取る能力（`expectedNaturalGrowth` の野手側と同じ6つ） */
const KEYS = [
  ['batting', 'meet', 'meet'],
  ['batting', 'power', 'power'],
  ['batting', 'eye', 'eye'],
  ['physical', 'speed', 'speed'],
  ['physical', 'arm', 'arm'],
  ['fielding', 'defense', 'defense'],
];
const RANK_MULT = 0.90;  // 独立リーグ＝ランクC相当（`teamRankMult`）
const GROW_BASE = 38;    // 伸びる側を測る能力値（天井の減衰にかからない）
const DECLINE_BASE = 50; // 衰える側を測る能力値（`ref` と同じ＝比例が1倍）

const seedFielder = createCandidatePlayer({ position: 'shortstop' });
const seedPitcher = createCandidatePlayer({ position: 'pitcher' });

/** 年度替わりで age 歳になる野手（シーズン中は age-1 歳） */
function fielder(age, gp, discipline, base, atBats = 450, modifier = 0) {
  const p = structuredClone(seedFielder);
  p.age = age - 1;
  p.growthPotential = gp;
  p.growthModifier = modifier;
  p.personality = { ...(p.personality || {}), discipline, mental: 50 };
  for (const [box, key] of KEYS) p[box][key] = base;
  p.physical.dexterity = 50;
  p.physical.muscle = 50;
  p.physical.build = 'medium';
  p.seasonStats = {
    ...(p.seasonStats || {}),
    batting: { ...(p.seasonStats?.batting || {}), atBats },
  };
  return p;
}

/** 球団の形（`naturalGrowthPlanOf` がこれで区分と格を決める） */
const TEAM_SHAPES = {
  independent: { independentLeagueId: 'check-league' },            // ランクC相当 0.90
  corporate: { corporateData: { type: 'corporate', rank: 'A' } },  // 1.05
  club: { corporateData: { type: 'club', rank: 'C' } },            // 0.90
  online: { independentLeagueId: 'check-league' },                 // オンラインの12球団と同じ形
};
const teamOf = (category, players) => ({ name: 'T', ...structuredClone(TEAM_SHAPES[category]), players });

/**
 * 画面に出す数（シーズン中に見る）。一人用は `naturalGrowthOf`、オンラインは
 * `server/projection.mjs` と同じ呼び方
 */
function shownFor(player, category, team = teamOf(category, [player])) {
  if (category === 'online') return expectedNaturalGrowth(player, 'online', teamRankMult(team), { team });
  return naturalGrowthOf(player, team);
}

/**
 * **年度送りと同じ順**に n 年ぶん回し、主要な能力1つあたりの平均の動きを返す。
 *   2.5 変動の半減（`updateGrowthModifiers`。優勝なし）→ 3 成績を前季へ（`resetSeasonStats`）
 *   → 4 加齢 → 4.6 `applyCorporatePlayerGrowth`
 * ⚠ 乱数は種を固定する（`withSeededRandom`）。揺らぎ（年ごとのノイズ・調子・丸め）の平均を見るので
 *    回数は要るが、同じ入力なら毎回同じ結果になる
 */
function yearEndAverage(player, category, { mates = [], n = 1500 } = {}) {
  return withSeededRandom(hashSeed(`natural-growth:${category}:${player.age}:${player.growthPotential}`), () => {
    let total = 0;
    for (let i = 0; i < n; i += 1) {
      const p = structuredClone(player);
      const team = teamOf(category, [p, ...structuredClone(mates)]);
      const teams = { T: team };
      updateGrowthModifiers(teams, {});
      for (const q of team.players) {
        q.previousSeasonStats = q.seasonStats;
        q.seasonStats = {};
        q.age += 1;
      }
      const before = KEYS.map(([box, key]) => p[box][key]);
      applyCorporatePlayerGrowth(teams, { online: category === 'online' ? new Set(['T']) : null });
      total += KEYS.reduce((sum, [box, key], j) => sum + p[box][key] - before[j], 0) / KEYS.length;
    }
    return total / n;
  });
}
const shownOf = (player, category = 'independent') => shownFor(player, category);

// --- 1. 表示＝実際（年度送りの順に回して比べる） ---
// ⚠ 以前は makeGrower を直に回して比べていたので、年度送りの順（半減→加齢→成長）の
//    食い違いが映らなかった。33歳・変動+0.3 が +0.13 と出て実際は -0.71、
//    クラブ（ランクC）の20歳・能力40が +1.11 と出て実際は +0.04 だった
const NOISE_TOL = 0.10;
let compared = 0;
let worstGap = 0;
const compare = (label, player, category, opts) => {
  const shown = shownFor(player, category, opts?.mates ? teamOf(category, [player, ...opts.mates]) : undefined);
  const actual = yearEndAverage(player, category, opts);
  const gap = Math.abs(shown - actual);
  worstGap = Math.max(worstGap, gap);
  compared += 1;
  assert.ok(
    gap <= NOISE_TOL,
    `表示と実際がずれている（${label}）: 表示 ${shown.toFixed(2)} 実際 ${actual.toFixed(2)}`,
  );
  return { shown, actual };
};
for (const category of ['independent', 'online']) {
  for (const gp of [0.6, 1.0, 1.4]) {
    for (const base of [GROW_BASE, DECLINE_BASE]) {
      for (const age of [19, 25, 31, 36, 40]) {
        compare(`${category} 素質${gp} 能力${base} ${age}歳`, fielder(age, gp, 50, base), category);
      }
    }
  }
}
for (const category of ['corporate', 'club']) {
  for (const base of [40, DECLINE_BASE]) {
    for (const age of [20, 27, 34]) {
      compare(`${category} 能力${base} ${age}歳`, fielder(age, 1.0, 50, base), category);
    }
  }
}
assert.ok(compared >= 70, '見た組み合わせが少なすぎる（検査の作りが壊れている）');
{
  // 監査で見つかった食い違いそのもの
  const vet = compare('33歳・変動+0.3', fielder(34, 1.0, 50, DECLINE_BASE, 450, 0.3), 'independent');
  assert.ok(vet.shown < 0, `33歳・変動+0.3 の表示が ${vet.shown}（年度替わりでは衰える）`);
  const club = compare('クラブC 20歳・能力40', fielder(21, 1.0, 50, 40), 'club');
  assert.ok(club.shown < 0.3, `クラブの20歳の表示が ${club.shown}（独立リーグの式で出ている）`);
  // 同じ球団の30歳以上のベテラン（指導力60以上）の加算は25歳以下の変動に入る
  const mentor = fielder(33, 1.0, 95, DECLINE_BASE);
  mentor.personality.mental = 95;
  const young = fielder(22, 1.0, 50, GROW_BASE);
  const alone = shownFor(young, 'independent');
  const taught = compare('ベテランの指導つき 22歳', young, 'independent', { mates: [mentor, mentor, mentor] });
  assert.ok(taught.shown > alone, `ベテランの指導が表示に入っていない（${taught.shown} 対 ${alone}）`);
}
{
  // 出場量は今季と前季の大きい方。開幕日（今季0）と1試合後（4打数）で表示が跳ねない
  const p = fielder(23, 1.0, 50, GROW_BASE, 0);
  p.previousSeasonStats = { batting: { atBats: 450 } };
  const opening = shownOf(p);
  p.seasonStats = { batting: { atBats: 4 } };
  const afterOne = shownOf(p);
  assert.equal(afterOne, opening, `1試合出ただけで表示が ${opening} → ${afterOne} に下がる`);
  p.previousSeasonStats = {};
  assert.ok(shownOf(p) < opening, '前季も今季も出ていない選手が、レギュラーと同じに出る');
}
{
  // 年齢曲線で伸びない選手（大学・プロ・所属なし）は「—」
  const p = fielder(21, 1.0, 50, GROW_BASE);
  assert.equal(naturalGrowthOf(p, { universityData: {}, players: [p] }), null, '大学の在学生に自然成長が出る');
  assert.equal(naturalGrowthOf(p, { players: [p] }), null, 'プロ（社会人・独立でない球団）に自然成長が出る');
  assert.equal(naturalGrowthOf(p, null), null, '所属の無い選手に自然成長が出る');
  assert.equal(naturalGrowthText(null), '—', '出せない選手が「—」で出ない');
  // オンラインの選手はサーバーの値をそのまま使う（一人用の編成画面を流用している）
  assert.equal(naturalGrowthOf({ ...p, naturalGrowth: -1.23 }, null), -1.23, 'サーバーの自然成長を使っていない');
}

// --- 2. 指定の表に乗る ---
const fit = [];
for (let age = 19; age <= 31; age += 1) {
  const got = shownOf(fielder(age, 1.0, 50, GROW_BASE));
  fit.push([age, got]);
  assert.ok(
    Math.abs(got - TARGET[age]) <= 0.35,
    `伸びる側が指定の表から外れている（${age}歳・能力${GROW_BASE}）: `
      + `${got.toFixed(2)} 対 指定 ${TARGET[age].toFixed(2)}`,
  );
}
for (let age = 32; age <= 40; age += 1) {
  const got = shownOf(fielder(age, 1.0, 50, DECLINE_BASE));
  fit.push([age, got]);
  assert.ok(
    Math.abs(got - TARGET[age]) <= 0.85,
    `衰える側が指定の表から外れている（${age}歳・能力${DECLINE_BASE}）: `
      + `${got.toFixed(2)} 対 指定 ${TARGET[age].toFixed(2)}`,
  );
}

// --- 3. 山は23〜27歳（19歳より23歳の方が伸びる） ---
{
  const at = (age) => shownOf(fielder(age, 1.0, 50, GROW_BASE));
  assert.ok(at(23) > at(19), `19歳(${at(19).toFixed(2)})より23歳(${at(23).toFixed(2)})の方が伸びること`);
  const peak = [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]
    .map((age) => [age, at(age)])
    .sort((a, b) => b[1] - a[1])[0][0];
  assert.ok(peak >= 23 && peak <= 27, `山が${peak}歳にある（23〜27歳に来ること）`);
  // 曲線そのものも指定どおり（丸めの外側で確かめる）
  assert.equal(Math.round(naturalAgeCoef(19) * 100) / 100, 1.00, '曲線の19歳が1.00でない');
  assert.equal(Math.round(naturalAgeCoef(23) * 100) / 100, 1.20, '曲線の23歳が1.20でない');
  assert.equal(Math.round(naturalAgeCoef(25) * 100) / 100, 1.20, '曲線の25歳が1.20でない');
  for (const age of [26, 30, 32, 36, 40])
    assert.equal(
      Math.round(naturalAgeCoef(age) * 100) / 100,
      TARGET[age],
      `曲線の${age}歳が指定（${TARGET[age]}）でない`,
    );
}

// --- 4. 素質（19歳の伸びの順序と、衰え始めの年齢） ---
const crossOf = (gp, discipline = 50, modifier = 0) => {
  for (let age = 20; age <= 50; age += 1)
    if (shownOf(fielder(age, gp, discipline, DECLINE_BASE, 450, modifier)) < 0) return age;
  return 99;
};
{
  const young = [0.6, 1.0, 1.4].map((gp) => shownOf(fielder(19, gp, 50, GROW_BASE)));
  assert.ok(
    young[0] < young[1] && young[1] < young[2],
    `19歳の伸びが素質の順になっていない（${young.map((v) => v.toFixed(2)).join(' / ')}）`,
  );
  const cross = [0.6, 1.0, 1.4].map((gp) => crossOf(gp));
  assert.ok(
    cross[0] < cross[1] && cross[1] < cross[2],
    `衰え始めが素質の順になっていない（${cross.join(' / ')}歳）`,
  );
  assert.ok(
    cross[1] >= 29 && cross[1] <= 33,
    `素質1.0の衰え始めが${cross[1]}歳（指定の表は31〜32歳で0を割る）`,
  );
}

// --- 5. プロ意識と変動で長持ちする（いしだ「大事に使われたら毎年+0.1程度増える」） ---
{
  const base = crossOf(1.0, 50, 0);
  assert.ok(crossOf(1.0, 90, 0) > base, 'プロ意識が高くても衰え始めが遅くならない');
  assert.ok(crossOf(1.0, 20, 0) < base, 'プロ意識が低くても衰え始めが早くならない');
  // ⚠ いしだ 2026-11-21「低いプロ意識による成長係数の下落をもう2年程早めたい。
  //    高プロ意識はそのままでOK」。**50を境に幅が違う**（`discAgeShift`）。
  //    左右対称に戻すと低い側が2年うしろへ戻る
  assert.ok(
    base - crossOf(1.0, 20, 0) >= 3,
    `プロ意識20の衰え始めが基準の${base}歳から${base - crossOf(1.0, 20, 0)}年しか早まっていない（3年以上）`,
  );
  assert.equal(
    crossOf(1.0, 90, 0) - base,
    2,
    'プロ意識90の側は動かさない（基準から2年遅い）',
  );
  // ⚠ `growthModifier`（出場で積み・疲労で削れる変動）が**年度替わりの成長に効くこと**。
  //    以前は `makeGrower` が `growthPotential` しか読まず、変動は効いていなかった
  const withUse = shownOf(fielder(30, 1.0, 50, DECLINE_BASE, 450, 0.3));
  const plain = shownOf(fielder(30, 1.0, 50, DECLINE_BASE, 450, 0));
  const abused = shownOf(fielder(30, 1.0, 50, DECLINE_BASE, 450, -0.3));
  assert.ok(withUse > plain, `変動プラスが効いていない（${withUse.toFixed(2)} 対 ${plain.toFixed(2)}）`);
  assert.ok(abused < plain, `変動マイナスが効いていない（${abused.toFixed(2)} 対 ${plain.toFixed(2)}）`);
  // 出場量（控えはレギュラーより伸びない）
  const bench = shownOf(fielder(22, 1.0, 50, GROW_BASE, 120));
  const regular = shownOf(fielder(22, 1.0, 50, GROW_BASE, 450));
  assert.ok(regular > bench, `出場量が伸びに効いていない（${regular.toFixed(2)} 対 ${bench.toFixed(2)}）`);
}

// --- 6. 30代後半は席を明け渡す（いしだ「なかなか衰えず、ずっとベテランが居座ります」） ---
for (const age of [37, 38, 39, 40]) {
  const v = shownOf(fielder(age, 1.0, 50, DECLINE_BASE));
  assert.ok(
    v <= -2.0,
    `${age}歳・素質1.0・能力${DECLINE_BASE}の衰えが${v.toFixed(2)}。`
      + '年2点以上落ちないとベテランが席を明け渡さない',
  );
}
{
  // 素質1.4のベテランは長持ちする（40歳でも年1点台まで）
  const star = shownOf(fielder(40, 1.4, 70, DECLINE_BASE));
  assert.ok(star > -2.6, `素質1.4・意識70の40歳が${star.toFixed(2)}。素質が高い選手は長持ちすること`);
}

// --- 6.5 ピーク年齢の見込み（将来性の札・オンラインの「3年後の見込み」）は年齢曲線から ---
// ⚠ 以前は別の式（素質1.0で25歳）で、ゲームでは伸びる28歳を「3年後は下り坂」と出していた
for (const gp of [0.6, 1.0, 1.4]) {
  for (const discipline of [20, 50, 90]) {
    const peak = estimatePeakAge(gp, discipline);
    assert.ok(
      naturalCoefOf(peak, gp, discipline) > 0 && naturalCoefOf(peak + 1, gp, discipline) <= 0,
      `ピーク年齢の見込み（素質${gp}・意識${discipline}で${peak}歳）が年齢曲線の伸びの終わりと合わない`,
    );
  }
}
assert.equal(estimatePeakAge(1.0, 50), 31, '素質1.0・意識50のピーク年齢は31歳（32歳から衰える）');
assert.notEqual(
  outlookOf({ age: 28, growthPotential: 1.0, personality: { discipline: 50 } }).kind,
  'decline',
  '28歳・素質1.0（31歳まで伸びる）が「3年後は下り坂」と出る',
);
assert.equal(
  outlookOf({ age: 33, growthPotential: 1.0, personality: { discipline: 50 } }).kind,
  'decline',
  '33歳・素質1.0 が3年後に下り坂と出ない',
);

// --- 6.6 プロ意識の説明の数字が式と合う（Web とアプリは同じ文。online-ability-help-check） ---
{
  const help = ABILITY_HELP['プロ意識'];
  // 年度替わりの山のずれ。⚠ **50を境に上下で幅が違う**（いしだ 2026-11-21「低いプロ意識に
  //    よる成長係数の下落をもう2年程早めたい。高プロ意識はそのままでOK」）。
  //    上は10ごとに0.5歳（100で+2.5歳）、下は10ごとに1.15歳（20で-3.45歳・0で-5.75歳）
  for (const [discipline, shift] of [[100, 2.5], [60, 0.5], [20, -3.45], [0, -5.75]]) {
    for (const age of [27, 31, 35]) {
      assert.ok(
        Math.abs(naturalCoefOf(age, 1.0, discipline) - naturalCoefOf(age - shift, 1.0, 50)) < 1e-9,
        `プロ意識${discipline}の曲線のずれが説明（${shift}歳）と合わない`,
      );
    }
  }
  assert.ok(
    help.includes('100で2.5歳遅く') && help.includes('20で3.5歳早く'),
    'プロ意識の説明に年度替わりのずれ（上下で幅が違うこと）が無い',
  );
  // キャンプの伸びが止まる年齢: 80で+1歳・100で+2歳
  const stopOf = (discipline) => growthStopAge({ growthPotential: 1.0, personality: { discipline } });
  assert.equal(stopOf(80) - stopOf(60), 1, 'プロ意識80のキャンプの停止年齢が説明（+1歳）と合わない');
  assert.equal(stopOf(100) - stopOf(60), 2, 'プロ意識100のキャンプの停止年齢が説明（+2歳）と合わない');
  assert.ok(help.includes('キャンプの伸びが止まる年齢（80で+1歳、100で+2歳）'), 'プロ意識の説明にキャンプの停止年齢が無い');
}

// --- 6.7 マニュアル（ManualScreen の「年次成長」）とアプリの TIPS（Tips.kt）に書いた数字 ---
// ⚠ ここが落ちたら、式を変えた側に合わせて文を直す（数字は式から計算して書いてある）
{
  // 衰え始める年齢（主な能力の平均）: 素質 × プロ意識20/35/50/65/80/100
  // ⚠ 意識20・35の列は 2026-11-21 の非対称化（下だけ急）で2年ほど早まっている
  const DOC_DECLINE = { 0.6: [25, 27, 29, 29, 30, 31], 1.0: [28, 30, 32, 33, 33, 34], 1.4: [32, 33, 35, 36, 37, 38] };
  for (const [gp, ages] of Object.entries(DOC_DECLINE))
    [20, 35, 50, 65, 80, 100].forEach((discipline, i) =>
      assert.equal(naturalPeakAge(Number(gp), discipline) + 1, ages[i], `マニュアルの衰え始め（素質${gp}・意識${discipline}）が式と違う`));
  // 能力ごとの衰え始め（素質1.0・意識50）
  const DOC_STAT = { speed: 28, arm: 30, velocity: 30, armP: 30, stamina: 31, meet: 32, defense: 32, power: 33, eye: 35, control: 35, breaking: 35 };
  for (const [key, age] of Object.entries(DOC_STAT))
    assert.equal(naturalPeakAge(1.0, 50, STAT_GROWTH[key].peakAge) + 1, age, `マニュアル・TIPSの${key}の衰え始めが式と違う`);
  // 選手情報の自然成長（6能力の平均・能力50）は、走力・肩のぶん曲線より早くマイナスになる（素質1.0で1年・0.6で3年）
  assert.equal(naturalPeakAge(1.0, 50) + 1 - crossOf(1.0), 1, 'マニュアルの「素質1.0なら1年早い」が式と違う');
  assert.equal(naturalPeakAge(0.6, 50) + 1 - crossOf(0.6), 3, 'マニュアルの「素質0.6なら3年早い」が式と違う');
  // 出場量: 年300打席は0打席の約2.7倍（伸びる年）
  const ratio = shownOf(fielder(21, 1.0, 50, GROW_BASE, 300)) / shownOf(fielder(21, 1.0, 50, GROW_BASE, 0));
  assert.ok(Math.abs(ratio - 2.7) < 0.1, `300打席と0打席の伸びの比が${ratio.toFixed(2)}（マニュアル・TIPSは約2.7倍）`);
}

// --- 7. 表示の計算は選手を書き換えない（`peek`）・投手・見た目 ---
for (const seed of [seedFielder, seedPitcher]) {
  const p = structuredClone(seed);
  p.age = 24;
  p.growthPotential = 1.2;
  const before = JSON.stringify(p);
  for (const category of ['independent', 'online']) shownOf(p, category);
  naturalGrowthOf(p, teamOf('club', [p]));
  assert.equal(JSON.stringify(p), before, '自然成長の表示を出すと選手の中身が変わる（`peek` が効いていない）');
}
{
  const p = structuredClone(seedPitcher);
  p.age = 21;
  p.growthPotential = 1.2;
  p.growthModifier = 0;
  const young = shownOf(p);
  const old = shownOf({ ...structuredClone(p), age: 38 });
  assert.ok(Number.isFinite(young) && Number.isFinite(old), '投手の自然成長が数字にならない');
  assert.ok(young > 0 && old < 0, `投手の自然成長が年齢で裏返らない（21歳${young} 38歳${old}）`);
}
assert.equal(naturalGrowthText(0.42), '+0.42', '自然成長の表示に + が付かない');
assert.equal(naturalGrowthText(-0.06), '-0.06', '自然成長のマイナスの表示が違う');
assert.equal(naturalGrowthText(0.001), '±0.00', '横ばいが ±0.00 で出ない');
assert.equal(naturalGrowthColor(-0.3), 'text-blue-400', '衰えが青で出ない');
assert.notEqual(naturalGrowthColor(0.9), naturalGrowthColor(-0.3), '伸びと衰えが同じ色になっている');

console.log(
  `■ 自然成長: OK（表示と実際の差は最大${worstGap.toFixed(2)}・${compared}組 / `
    + `素質1.0の実測 ${fit.filter(([a]) => [19, 23, 27, 31, 35, 40].includes(a))
      .map(([a, v]) => `${a}歳${v >= 0 ? '+' : ''}${v.toFixed(2)}`).join('・')} / `
    + `衰え始め 素質0.6・1.0・1.4 で ${[0.6, 1.0, 1.4].map((gp) => crossOf(gp)).join('・')}歳）`,
);
