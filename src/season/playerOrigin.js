import { assignHighSchool } from '../data/highSchoolData.js';
import { UNIVERSITY_TEAMS } from '../university/universityTeamsData.js';
import { isPlaceholderHighSchool, PLACEHOLDER_HIGH_SCHOOL } from '../utils/careerHistory.js';

// ============================================================
// 生成した選手の出身（高校・大学）。
//
// ⚠ いしだ 2026-11-20「初期メンバーにも、高校や大学のラベル付けをしてほしいです」。
//    初期セット（`rosterPack.js`）とトライアウトの生成候補（`createCandidatePlayer`）には
//    出身が無く、選手情報の「出身高校・出身大学」も経歴も空で、同窓・地元の縁
//    （`src/online/hometown.js`）にも一度も引っかからなかった。
//
// ⚠ **在学中の印（`universityTeamId` / `universityYear`）は付けないこと**。
//    あれは大学モードの在学生で、付けるとプロ指名で「大学4年生のみ指名可」に
//    引っかかり（`checkNPBDraftEligibility`）、年度末の戦力外でも在学生扱いになる。
//    ここで付けるのは**出た学校の名前**だけ（`universityName`）。
// ⚠ 高校は `assignHighSchool`（才能の帯で校の格が決まる）をそのまま使う。
//    県（`pref`）が入るので、地元出身の記事もここから引ける。
// ============================================================

/** 大学を出ているとみなす最低の年齢（大学を出てすぐが22歳） */
export const UNIVERSITY_MIN_AGE = 22;
/** その年齢以上の選手が大学を出ている割合（残りは高卒） */
export const UNIVERSITY_SHARE = 0.45;

/**
 * 選手の帯（S〜E）ごとの、出た大学の格の重み。
 * ⚠ 独立リーグの選手なので、上の帯ほど強い大学から来やすい、という程度の傾き。
 */
const UNIVERSITY_RANK_WEIGHTS = {
  S: { S: 30, A: 30, B: 25, C: 10, D: 5 },
  A: { S: 18, A: 28, B: 30, C: 16, D: 8 },
  B: { S: 8, A: 20, B: 32, C: 26, D: 14 },
  C: { S: 3, A: 12, B: 30, C: 35, D: 20 },
  D: { S: 1, A: 6, B: 23, C: 40, D: 30 },
  E: { S: 1, A: 4, B: 20, C: 40, D: 35 },
};

const pickWeighted = (weights) => {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const [key, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return Object.keys(weights)[0];
};

/** 出た大学（名前だけ）。帯に合う格の大学から引く */
function pickUniversityName(rank) {
  const weights = UNIVERSITY_RANK_WEIGHTS[rank] || UNIVERSITY_RANK_WEIGHTS.C;
  const wanted = pickWeighted(weights);
  const list = UNIVERSITY_TEAMS.filter((t) => t.rank === wanted);
  const pool = list.length ? list : UNIVERSITY_TEAMS;
  return pool[Math.floor(Math.random() * pool.length)]?.name || null;
}

/**
 * 出身を決める。⚠ 乱数は `Math.random`（呼ぶ側が `withSeededRandom` で包めば決まった答えになる）。
 * @param age 年齢（`UNIVERSITY_MIN_AGE` 未満は高卒。大学を出るには若すぎる）
 * @param rank 選手の帯（S〜E）。無ければ C とみなす
 * @returns `{ highSchool: {name, rank, pref}|null, universityName: string|null, careerHistory }`
 */
export function assignPlayerOrigin(age, rank = 'C', { university = true } = {}) {
  const school = assignHighSchool(rank) || null;
  const highSchool = school
    ? { name: school.name, rank: school.rank, pref: school.pref }
    : null;
  const universityName =
    university && (age ?? 0) >= UNIVERSITY_MIN_AGE && Math.random() < UNIVERSITY_SHARE
      ? pickUniversityName(rank)
      : null;
  // ⚠ 経歴は**古い順**に積む（画面は新しい順に並べ替えて出す。`PlayerDetailBody` の `CareerLine`）
  const careerHistory = [
    { type: 'highschool', year: null, label: highSchool ? highSchool.name : PLACEHOLDER_HIGH_SCHOOL },
    ...(universityName ? [{ type: 'university', year: null, label: universityName }] : []),
  ];
  return { highSchool, universityName, careerHistory };
}

/**
 * 出身の無い選手に出身を付ける（既に分かっている選手は触らない）。
 * 初期セットの生成と、前からあるリーグの移行（`leagueMigration.js`）の両方で使う。
 * @param options.university false なら高校だけ付ける（一人用の生成候補。`playerFactory.js` の `createCandidatePlayer` の注）
 * @returns 付けたら true
 */
export function fillPlayerOrigin(player, { university = true } = {}) {
  if (!player) return false;
  const known =
    player.highSchool?.name ||
    player.universityTeamName ||
    player.universityName ||
    player.universityTeamId;
  if (known) return false;
  const origin = assignPlayerOrigin(player.age, player.rank, { university });
  player.highSchool = origin.highSchool;
  if (origin.universityName) player.universityName = origin.universityName;
  // ⚠ 既にある経歴（入団・トレードなど）の**前**に置く（古い順に積む決まり）
  // ⚠ 生成のときに積んである仮の「高校卒」は外す（付けた高校と2つ並び、経歴が
  //    「〇〇高 → 高校卒 → …」になっていた。2026-11-20 監査）
  player.careerHistory = [
    ...origin.careerHistory,
    ...(player.careerHistory || []).filter((h) => !isPlaceholderHighSchool(h)),
  ];
  return true;
}
