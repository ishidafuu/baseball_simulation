// ============================================================
// 大学・高校のプール - src/state/schoolPools.js
//
// 生成した高校生と、初期化の途中の大学生の置き場（グローバルな可変の入れ物）。
// ⚠ もとは universityPool.js に置いていた。teams-data.js（全消去）と
//    playerIds.js（id の最大を数える）がプールを見るためだけに universityPool.js を読み、
//    universityPool.js も teams-data.js を読むので、読み込みが輪になっていた。
//    入れ物だけをここへ分け、ここは何も読まない（2026-11-24）。
//    作る・育てる・振り分ける処理は今まで通り universityPool.js。
// ============================================================

/**
 * 大学プール: **初期化の途中だけ使う仮置き場**。
 * { [enrollYear]: [ { player, enrollYear, graduateYear } ] }
 *
 * ⚠ **大学生の実体は TEAMS_DATA の大学チームの名簿ひとつだけ**。かつてはこのプールと
 *    名簿が別々に在学生を持っており、同じ「近畿大学」に名簿56人とプール60人が別人として
 *    居た（大学生の総数が設計の約2倍の 17,800人）。しかも成長はプール側にしか掛からず、
 *    画面に出る名簿の選手は伸びないまま、S校のスタメンが5年でミート63→30に落ちていた。
 *    いまは `enrollInUniversity` が名簿へ直接入れ、年次の成長・知名度・卒業は
 *    `processUniversityTeamGraduation`（名簿側）が担う。ここに入るのは
 *    **大学チームがまだ TEAMS_DATA に無い初期化の途中**だけで、
 *    `initializeUniversityTeamsForParallelWorld` / `absorbUniversityPoolIntoRosters` が名簿へ移す。
 */
export const universityPool = {};

/**
 * 高校生プール: 4月に生成、10月ドラフト→11月進路振り分けまで保持
 * { players: Array, year: number }
 */
export const highSchoolPool = { players: [], year: 0 };

export const clearUniversityPool = () => {
  Object.keys(universityPool).forEach(k => delete universityPool[k]);
};

export const clearHighSchoolPool = () => {
  highSchoolPool.players = [];
  highSchoolPool.year = 0;
};
