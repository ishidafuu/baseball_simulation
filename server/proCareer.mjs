// ============================================================
// プロへ行った選手のその後（飾りの記事）。
//
// ⚠ 先方回答（2026-11-16）「すぐやりたい」C1。リーグからプロ入りした選手（`proDraft.mjs` の
//    `league.chronicle.proDrafted`）の、プロでの1年ごとの歩みを作る。
// ⚠ **飾り**。プロの試合は回さない。能力・リーグ・球団には何も効かない。
// ⚠ **何も保存しない**。リーグの種×選手の鍵×年から毎回同じ答えを作り直す（`hashSeed`）。
//    見るたびに同じ文になり、保存の形も変えない。
// ⚠ その年の成績が出るのは**10月（その年のプロのシーズンが終わった頃）から**。
//    指名された年（10月下旬）はまだ入団だけ。
// ⚠ 文はサーバーが作り、PC・スマホWeb・アプリはそのまま出す（同じ文になる）。
// ============================================================
import { hashSeed } from '../src/game/rng.js';

/** その年のプロの成績を出し始める月 */
export const PRO_SEASON_END_MONTH = 10;
/** 何年分まで作るか（指名から） */
const MAX_PRO_YEARS = 18;

/**
 * 0〜1 の決まった乱数。⚠ `hashSeed`（FNV-1a）は似た文字列で似た値になりやすく、年だけ違う
 * 2つの年が同じ成績になった。仕上げにかき混ぜる（murmur3 の fmix32）
 */
function mix(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
const unit = (seed, key, year, tag) => mix(hashSeed(`${seed}:${key}:${year}:pro:${tag}`)) / 4294967296;
const between = (u, lo, hi) => lo + (hi - lo) * u;
const rate3 = (v) => v.toFixed(3).replace(/^0/, '');

/** 指名順位ごとの素質（一軍に上がる・主力になる起きやすさ） */
const TALENT = { 1: 0.45, 2: 0.35, 3: 0.27, 4: 0.2, 5: 0.15 };
/** 立場（0=二軍、1=一軍に上がった、2=一軍定着、3=主力） */
const LEVELS = ['二軍', '一軍', '一軍定着', '主力'];

/** 打者の1年の成績（立場で幅を変える）。`min`: その年に最低限残す数（初安打の年は1本以上など） */
function batterYear(level, u) {
  if (level === 0) return { text: `二軍で${Math.round(between(u(), 40, 95))}試合 打率${rate3(between(u(), 0.22, 0.3))}` };
  const games = Math.round(level === 1 ? between(u(), 8, 45) : level === 2 ? between(u(), 70, 125) : between(u(), 120, 143));
  const avg = level === 1 ? between(u(), 0.18, 0.27) : level === 2 ? between(u(), 0.235, 0.285) : between(u(), 0.262, 0.318);
  const hr = Math.round(level === 1 ? between(u(), 0, 3) : level === 2 ? between(u(), 2, 14) : between(u(), 9, 33));
  return { text: `一軍で${games}試合 打率${rate3(avg)} ${hr}本`, avg, hr };
}
/** 投手の1年の成績（先発か救援かは選手ごとに決める）。`first`: 初勝利・初登板の年（1勝以上にする） */
function pitcherYear(level, u, starter, first) {
  if (level === 0) return { text: `二軍で${Math.round(between(u(), 12, 30))}試合 防御率${between(u(), 2.6, 4.8).toFixed(2)}` };
  const era = level === 1 ? between(u(), 3.4, 6.2) : level === 2 ? between(u(), 2.7, 4.1) : between(u(), 1.9, 3.3);
  if (starter) {
    const wins = Math.max(first ? 1 : 0, Math.round(level === 1 ? between(u(), 0, 3) : level === 2 ? between(u(), 4, 10) : between(u(), 10, 17)));
    const losses = Math.round(Math.max(0, wins * between(u(), 0.5, 1.1)));
    return { text: `一軍で${wins}勝${losses}敗 防御率${era.toFixed(2)}`, wins };
  }
  const games = Math.round(level === 1 ? between(u(), 5, 25) : level === 2 ? between(u(), 35, 55) : between(u(), 50, 65));
  const saves = level === 3 && u() < 0.5 ? Math.round(between(u(), 15, 42)) : 0;
  return { text: `一軍で${games}試合 ${saves ? `${saves}セーブ ` : ''}防御率${era.toFixed(2)}`, saves };
}

/**
 * タイトル（主力で、数字が飛び抜けた年だけ。⚠ 12球団の中の1位なので、数字が届いても5回に1回ほど）。
 * 本塁打王=28本〜、首位打者=打率.305〜、最多勝=15勝〜、最多セーブ=35〜
 */
function titleOf(y, pitcher, u) {
  const hit = pitcher
    ? y.wins >= 15
      ? '最多勝'
      : y.saves >= 35
        ? '最多セーブ'
        : null
    : y.hr >= 28
      ? '本塁打王'
      : y.avg >= 0.305
        ? '首位打者'
        : null;
  return hit && u() < 0.2 ? `${hit}のタイトルを獲った` : null;
}

/**
 * プロでの歩み（古い順）。`now`: リーグのいまの年・月。
 * @returns {{ year: number, proYear: number, text: string, highlight: string|null, ended: boolean }[]}
 */
export function proCareerOf(row, seed, now) {
  const key = row.key || `${row.team}:${row.name}`;
  const pitcher = row.position === 'pitcher';
  const talent = (TALENT[row.round] ?? 0.2) + ((row.age ?? 22) <= 20 ? 0.05 : 0);
  const starter = unit(seed, key, 0, 'starter') < 0.55;
  const out = [];
  let level = 0;
  let firstUp = false;
  let allStars = 0;
  for (let n = 1; n <= MAX_PRO_YEARS; n++) {
    const year = row.year + n;
    if (year > now.year || (year === now.year && (now.month || 0) < PRO_SEASON_END_MONTH)) break;
    const age = (row.age ?? 22) + n;
    let draw = 0;
    const u = () => unit(seed, key, year, `d${draw++}`);
    // 立場の上がり下がり（若いうちは上がりやすく、30代は下がりやすい）
    const up = talent * (age <= 27 ? 1 : age <= 31 ? 0.6 : 0.25);
    const r = u();
    if (r < up && level < 3) level += 1;
    else if (age >= 31 && r > 1 - (age - 29) * 0.07 && level > 0) level -= 1;
    // 戦力外・引退（二軍のまま4年目以降、または35歳から）
    const leave = level === 0 && n >= 4 ? 0.35 : age >= 35 ? (age - 33) * 0.12 : 0;
    if (u() < leave) {
      const text =
        age >= 35 || level >= 2
          ? `${n}年目（${age}歳）: ${row.npbTeam}で現役を引退した。プロ通算${n}年`
          : `${n}年目（${age}歳）: ${row.npbTeam}から戦力外通告。再起を期す`;
      out.push({ year, proYear: n, text, highlight: null, ended: true });
      break;
    }
    const first = level >= 1 && !firstUp;
    const y = pitcher ? pitcherYear(level, u, starter, first) : batterYear(level, u);
    const line = y.text;
    let highlight = null;
    if (first) {
      firstUp = true;
      highlight = pitcher ? (starter ? 'プロ初勝利を挙げた' : 'プロ初登板を果たした') : 'プロ初安打を放った';
    } else if (level === 3) {
      highlight = titleOf(y, pitcher, u);
      if (!highlight && u() < 0.3) {
        allStars += 1;
        highlight = allStars === 1 ? 'オールスターに初めて選ばれた' : `オールスターに${allStars}度目の出場`;
      }
    }
    out.push({
      year,
      proYear: n,
      text: `${n}年目（${row.npbTeam}・${LEVELS[level]}）: ${line}${highlight ? `。${highlight}` : ''}`,
      highlight,
      ended: false,
    });
  }
  return out;
}

const nowOf = (league) => ({ year: league.season?.year ?? 0, month: league.season?.currentDate?.month ?? 0 });

/**
 * プロ入りした選手の行ごとに、その後を1回だけ作る（`{ row, career }`）。
 * 一覧（`withProCareer`）と便り（`proNewsOf`）の両方に使うときは、これを1回呼んで渡す
 * （同じ行の `proCareerOf` を2回回さない）。
 */
export function proCareersOf(rows, league) {
  const now = nowOf(league);
  return (rows || []).map((row) => ({ row, career: proCareerOf(row, league.seed ?? 0, now) }));
}

/** `proCareersOf` の結果から、行にその後（いちばん新しい年と、全部）を足す */
export function rowsWithCareer(careers) {
  return careers.map(({ row, career }) =>
    career.length ? { ...row, after: career.at(-1).text, career: career.map((c) => c.text) } : row,
  );
}

/** `proCareersOf` の結果から、今年の便り（`proNewsOf` と同じ） */
export function newsOfCareers(careers, league) {
  const { year } = nowOf(league);
  const news = [];
  for (const { row: r, career } of careers) {
    const last = career.at(-1);
    if (last && last.year === year)
      news.push({ name: r.name, team: r.team, npbTeam: r.npbTeam, text: last.text, highlight: last.highlight || (last.ended ? 'ended' : null) });
  }
  return news.sort((a, b) => (b.highlight ? 1 : 0) - (a.highlight ? 1 : 0)).slice(0, 3);
}

/** プロ入りした選手の行に、その後（いちばん新しい年と、全部）を足す */
export function withProCareer(rows, league) {
  return rowsWithCareer(proCareersOf(rows, league));
}

/**
 * 紙面に出す、今年の便り（その年の10月から年度更新まで。目立った出来事のある人を先に、3人まで）。
 * @returns {{ name, team, npbTeam, text, highlight }[]}
 */
export function proNewsOf(league, rows) {
  return newsOfCareers(proCareersOf(rows, league), league);
}
