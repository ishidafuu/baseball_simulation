// ============================================================
// 夏の甲子園（全国高等学校野球選手権） - koshien.js
//
// 【役割】高校野球を「操作はできないが見える階層」として世界に足す。
//
// 高校生プール(5000人)は既に highSchool = { name, rank, pref } を持っており、
// 996校・47都道府県に分布している。この構造をそのまま使って
//   都道府県予選（各県の最強校が代表になる）→ 甲子園本戦（トーナメント）
// を毎年8月に消化し、勝ち上がりに応じて選手の知名度(fame)を上げる。
//
// fame はドラフト評価(fame × 0.3)とスカウト発見率に効くため、
// 「甲子園で活躍した選手は指名されやすく、無名校の逸材は自分で見つけるしかない」
// という関係がここで生まれる。プレイヤーは大会を観て、スカウト先を決める。
//
// センバツ(3月)は対象外。高校生プールの生成が4月なので、
// 同学年の選手が存在するのは夏の大会だけになる。
// ============================================================

import { highSchoolPool } from '../state/schoolPools.js';
import { WORLD_DATA } from '../corporate/worldData.js';
import { createBracket } from '../corporate/toshitaikou.js';

// 校ランク → 基礎戦力。所属選手の能力が上乗せされるので、ここは「学校の地力」
// 校ランク → 地力。所属選手の能力が上乗せされるので幅は控えめにする。
// ここを広く取ると（旧: S62〜F18）結果が校ランクだけで決まり、
// エースや主砲の出来が甲子園の勝ち上がりに反映されなくなる。
const SCHOOL_RANK_STRENGTH = { S: 52, A: 47, B: 42, C: 37, D: 32, E: 28, F: 24 };

// 勝ち上がりに応じた知名度。優勝校のエースで概ね +18 になる
const FAME_BY_RESULT = { champion: 12, runnerUp: 9, best4: 7, best8: 5, entry: 3 };

/** 高校生プールを学校ごとにまとめる */
function groupBySchool() {
  const schools = new Map();
  for (const p of highSchoolPool.players || []) {
    const h = p.highSchool;
    if (!h?.name) continue;
    if (!schools.has(h.name)) {
      schools.set(h.name, { name: h.name, rank: h.rank || 'D', pref: h.pref || '不明', players: [] });
    }
    schools.get(h.name).players.push(p);
  }
  return schools;
}

/** 学校の戦力値。地力(ランク) + エースの出来 + 打線の厚み */
function evaluateSchool(school) {
  const pitchers = school.players.filter(p => p.position === 'pitcher');
  const batters = school.players.filter(p => p.position !== 'pitcher');

  // エース: 球速と制球で選ぶ（高校野球はエース1枚で勝ち上がる）
  const aceScore = (p) => (p.pitching?.velocity ?? 120) * 0.45
    + (p.pitching?.control ?? 20) * 0.5 + (p.pitching?.stamina ?? 60) * 0.15;
  const ace = pitchers.length
    ? pitchers.reduce((best, p) => (aceScore(p) > aceScore(best) ? p : best))
    : null;

  // 主砲: パワーとミート
  const sluggerScore = (p) => (p.batting?.power ?? 10) * 0.7 + (p.batting?.meet ?? 20) * 0.4;
  const slugger = batters.length
    ? batters.reduce((best, p) => (sluggerScore(p) > sluggerScore(best) ? p : best))
    : null;

  const base = SCHOOL_RANK_STRENGTH[school.rank] ?? 30;
  const aceBonus = ace ? (aceScore(ace) - 88) * 0.75 : -8;   // 高校野球はエース1枚の出来が大きい
  const lineup = batters.slice().sort((a, b) => sluggerScore(b) - sluggerScore(a)).slice(0, 5);
  const lineupBonus = lineup.length
    ? (lineup.reduce((s, p) => s + sluggerScore(p), 0) / lineup.length - 26) * 0.55 : -6;

  return {
    // ⚠ 素の値は 19〜77（σ16）と開きすぎで、一発勝負でも戦力上位4校が40年で35回優勝した。
    //    50を中心に0.55倍へ縮める（順位は変えずに番狂わせの余地だけ作る）
    strength: Math.max(8, 50 + (base + aceBonus + lineupBonus - 50) * 0.55),
    ace, slugger,
  };
}

/** 都道府県予選: 各県の代表を戦力の重み付き抽選で決める（強豪でも負けることがある） */
function runPrefectureQualifiers(schools) {
  const byPref = new Map();
  for (const s of schools.values()) {
    if (!byPref.has(s.pref)) byPref.set(s.pref, []);
    byPref.get(s.pref).push(s);
  }

  const reps = [];
  for (const [pref, list] of byPref) {
    // 北海道・東京は2代表（実際の大会と同じ。学校が1つしか無ければ1代表）
    const slots = (pref === '北海道' || pref === '東京') ? Math.min(2, list.length) : 1;
    const pool = list.slice();
    for (let n = 0; n < slots; n++) {
      // 戦力の3乗で重み付け。地力差が予選ではっきり出るようにする
      const weights = pool.map(s => Math.pow(evaluateSchool(s).strength, 3));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total, idx = 0;
      for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) { idx = i; break; } }
      reps.push({ ...pool[idx], pref, repNo: slots > 1 ? n + 1 : null });
      pool.splice(idx, 1);
      if (pool.length === 0) break;
    }
  }
  return reps;
}

/** 1試合。戦力差から勝敗とスコアを決める */
// ⚠ 1試合の振れ幅（`KOSHIEN_NOISE`）。±13 では戦力上位4校が40年で35回優勝し、
//    一発勝負の番狂わせがほとんど起きなかった。±20 で広げてある
const KOSHIEN_NOISE = 20;
function playGame(a, b, strengthOf) {
  const sa = strengthOf(a) + (Math.random() * 2 - 1) * KOSHIEN_NOISE;
  const sb = strengthOf(b) + (Math.random() * 2 - 1) * KOSHIEN_NOISE;
  const aWins = sa >= sb;
  // 高校野球は点差が開きやすい。ロースコアの接戦も残す
  const base = () => Math.floor(Math.random() * 4) + Math.floor(Math.random() * 4);
  let scoreA = base(), scoreB = base();
  const gap = Math.abs(sa - sb);
  // 力の差が大きいと大差になる（高校野球は10点差のコールドも珍しくない）
  const bonus = Math.floor(gap / 8) + 1 + (gap > 30 ? Math.floor(Math.random() * 6) : 0);
  if (aWins && scoreA <= scoreB) scoreA = scoreB + bonus;
  if (!aWins && scoreB <= scoreA) scoreB = scoreA + bonus;
  return { scoreA, scoreB, winner: aWins ? a : b };
}

/**
 * 夏の甲子園を1年分シミュレートし、WORLD_DATA.koshien に格納する。
 * 冪等: 同じ年に2回呼んでも2回目は何もしない。
 * @returns {Object|null} 大会結果。プールが空なら null
 */
export function simulateKoshien(year) {
  if (WORLD_DATA.koshien?.year === year) return WORLD_DATA.koshien;
  const schools = groupBySchool();
  if (schools.size < 4) return null;

  const reps = runPrefectureQualifiers(schools);
  if (reps.length < 4) return null;

  // 戦力はここで固定する（試合ごとに再評価すると同じ校の強さがぶれる）
  const strengthMap = new Map();
  const detail = new Map();
  for (const s of reps) {
    const ev = evaluateSchool(s);
    strengthMap.set(s.name, ev.strength);
    detail.set(s.name, { ...s, ...ev });
  }
  // ⚠ 甲子園に**シードは無い**（組み合わせは抽選）。以前は強い順に並べて
  //    createBracket（シード順を前提にする）へ渡しており、戦力上位が必ず1回戦を
  //    免除され、40年で39回 戦前の上位4校が優勝していた。抽選どおり無作為に並べる
  for (let i = reps.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [reps[i], reps[j]] = [reps[j], reps[i]];
  }

  const bracket = createBracket(reps.map(s => s.name));
  if (!bracket) return null;

  const strengthOf = (name) => strengthMap.get(name) ?? 30;
  // ラウンドごとに消化する。勝者の繰り上げは自前で行う
  //（toshitaikou の recordResult は TEAMS_DATA を引いて経歴を書くため、
  //  TEAMS_DATA に存在しない高校では使えない）
  for (let round = 0; round < bracket.rounds.length; round++) {
    bracket.rounds[round].forEach((match, m) => {
      if (!match.winner && match.team1 && match.team2) {
        const g = playGame(match.team1, match.team2, strengthOf);
        match.winner = g.winner;
        match.loser = g.winner === match.team1 ? match.team2 : match.team1;
        match.score = { team1: g.scoreA, team2: g.scoreB };
      }
      if (match.winner && round < bracket.rounds.length - 1) {
        const nm = Math.floor(m / 2);
        if (m % 2 === 0) bracket.rounds[round + 1][nm].team1 = match.winner;
        else bracket.rounds[round + 1][nm].team2 = match.winner;
      }
    });
  }
  bracket.champion = bracket.rounds[bracket.rounds.length - 1]?.[0]?.winner || null;

  // 到達段階を集計する
  const stageOf = new Map(reps.map(s => [s.name, 'entry']));
  const rounds = bracket.rounds;
  const last = rounds[rounds.length - 1];
  const champion = last?.[0]?.winner || null;
  const runnerUp = last?.[0]?.loser || null;
  if (champion) stageOf.set(champion, 'champion');
  if (runnerUp) stageOf.set(runnerUp, 'runnerUp');
  if (rounds.length >= 2) for (const m of rounds[rounds.length - 2]) {
    if (m.loser && stageOf.get(m.loser) === 'entry') stageOf.set(m.loser, 'best4');
  }
  if (rounds.length >= 3) for (const m of rounds[rounds.length - 3]) {
    if (m.loser && stageOf.get(m.loser) === 'entry') stageOf.set(m.loser, 'best8');
  }

  // 知名度を付与する。勝ち上がった校ほど、そしてエース・主砲ほど名前が売れる
  const notable = [];
  for (const s of reps) {
    const stage = stageOf.get(s.name) || 'entry';
    const gain = FAME_BY_RESULT[stage] ?? 3;
    const d = detail.get(s.name);
    for (const p of s.players) {
      p.fame = Math.min(100, (p.fame || 0) + gain);
    }
    // エースと主砲は看板なので上乗せ
    const extra = stage === 'champion' ? 6 : stage === 'runnerUp' ? 4
      : stage === 'best4' ? 3 : stage === 'best8' ? 2 : 1;
    for (const star of [d?.ace, d?.slugger]) {
      if (!star) continue;
      star.fame = Math.min(100, (star.fame || 0) + extra);
    }
    if (['champion', 'runnerUp', 'best4', 'best8'].includes(stage)) {
      if (d?.ace) notable.push({
        playerId: d.ace.id, name: d.ace.name, school: s.name, pref: s.pref,
        role: 'エース', stage,
        detail: `${d.ace.pitching?.velocity ?? 0}km/h 制球${d.ace.pitching?.control ?? 0}`,
        fame: d.ace.fame,
      });
      if (d?.slugger) notable.push({
        playerId: d.slugger.id, name: d.slugger.name, school: s.name, pref: s.pref,
        role: '主砲', stage,
        detail: `パワー${d.slugger.batting?.power ?? 0} ミート${d.slugger.batting?.meet ?? 0}`,
        fame: d.slugger.fame,
      });
    }
  }
  const stageRank = { champion: 0, runnerUp: 1, best4: 2, best8: 3 };
  notable.sort((a, b) => (stageRank[a.stage] - stageRank[b.stage]) || (b.fame - a.fame));

  const result = {
    year,
    champion,
    runnerUp,
    entries: reps.map(s => ({
      name: s.name, pref: s.pref, rank: s.rank,
      stage: stageOf.get(s.name) || 'entry',
      strength: Math.round(strengthMap.get(s.name)),
    })),
    bracket,
    notable: notable.slice(0, 24),
  };
  WORLD_DATA.koshien = result;
  return result;
}

/** 大会結果を1行のニュースにまとめる（日程進行画面などでの表示用） */
export function getKoshienHeadline(koshien) {
  if (!koshien?.champion) return null;
  const champ = koshien.entries.find(e => e.name === koshien.champion);
  const star = koshien.notable[0];
  const head = `第${koshien.year}回 全国高校野球選手権 — ${koshien.champion}（${champ?.pref ?? ''}）が優勝`;
  return star ? `${head}。大会の顔は${star.school}の${star.role}・${star.name}` : head;
}

export const KOSHIEN_STAGE_LABEL = {
  champion: '優勝', runnerUp: '準優勝', best4: 'ベスト4', best8: 'ベスト8', entry: '出場',
};
