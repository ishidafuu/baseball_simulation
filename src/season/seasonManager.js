// ============================================================
// シーズン管理システム - seasonManager.js
// 独立リーグをモデルにした年間スケジュール管理
// ============================================================

/**
 * シーズンフェーズ定義
 */
export const SEASON_PHASES = {
  SPRING_CAMP: 'spring_camp',      // 1-3月：春季キャンプ
  REGULAR_SEASON: 'regular_season', // 4-9月：レギュラーシーズン
  PLAYOFFS: 'playoffs',             // 10月前半：優勝決定シリーズ
  DRAFT: 'draft',                   // 10月後半：ドラフト会議
  CONTRACT: 'contract',             // 11月9日：契約更改
  TRYOUT: 'tryout',                 // 11月10日〜：トライアウト
  OFF_SEASON: 'off_season'          // 11月30日〜：オフシーズン
};

/**
 * フェーズ情報の定義
 */
export const PHASE_INFO = {
  [SEASON_PHASES.SPRING_CAMP]: {
    name: '春季キャンプ',
    months: [1, 2, 3],
    color: 'bg-green-100',
    description: '選手調整・練習試合'
  },
  [SEASON_PHASES.REGULAR_SEASON]: {
    name: 'レギュラーシーズン',
    months: [4, 5, 6, 7, 8, 9],
    color: 'bg-blue-100',
    description: '公式戦'
  },
  [SEASON_PHASES.PLAYOFFS]: {
    name: 'プレーオフ',
    months: [10],
    days: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    color: 'bg-yellow-100',
    description: '優勝決定シリーズ'
  },
  [SEASON_PHASES.DRAFT]: {
    name: 'ドラフト',
    months: [10],
    days: [24],
    color: 'bg-purple-100',
    description: 'プロ野球ドラフト会議'
  },
  [SEASON_PHASES.CONTRACT]: {
    name: '契約更改',
    months: [11],
    days: [9],
    color: 'bg-teal-100',
    description: '次年度の選手契約判断'
  },
  [SEASON_PHASES.TRYOUT]: {
    name: 'トライアウト',
    months: [11],
    days: [10],
    color: 'bg-orange-100',
    description: '選手補強'
  },
  [SEASON_PHASES.OFF_SEASON]: {
    name: 'オフシーズン',
    months: [11, 12],
    startDay: 30,
    color: 'bg-gray-100',
    description: 'レギュレーション変更可能'
  }
};

/**
 * 月の日数を取得
 */
export const getDaysInMonth = (year, month) => {
  return new Date(year, month, 0).getDate();
};

/**
 * 10月第4木曜日（NPBドラフト開催日）を返す
 * @param {number} year - ゲーム内年度
 * @returns {number} 日付（例: 24）
 */
export const getNPBDraftDay = (year) => {
  // 10月1日の曜日を取得（0=日, 1=月, ..., 4=木, 6=土）
  const oct1DayOfWeek = new Date(year, 9, 1).getDay();
  // 最初の木曜日までの日数
  const daysToFirstThursday = (4 - oct1DayOfWeek + 7) % 7;
  const firstThursday = 1 + daysToFirstThursday;
  return firstThursday + 21; // 第4木曜日 = 第1木曜日 + 21日
};

/**
 * 現在のフェーズを取得
 * @param {number} month
 * @param {number} day
 * @param {Object} [options] - { universityMode: bool }
 * @param {number} [year] - ゲーム内年度（ドラフト日の曜日計算に使用）
 */
export const getCurrentPhase = (month, day, options, year) => {
  const draftDay = year ? getNPBDraftDay(year) : 24;

  if (options?.universityMode) {
    // 大学モード: プレーオフ/契約更改/トライアウトなし
    if (month >= 1 && month <= 3) return SEASON_PHASES.SPRING_CAMP;
    if (month >= 4 && month <= 9) return SEASON_PHASES.REGULAR_SEASON;
    if (month === 10 && day < draftDay) return SEASON_PHASES.REGULAR_SEASON;
    if (month === 10 && day === draftDay) return SEASON_PHASES.DRAFT;
    if (month === 10 && day > draftDay) return SEASON_PHASES.REGULAR_SEASON;
    if (month === 11 && day < 30) return SEASON_PHASES.REGULAR_SEASON; // 明治神宮大会は11月中旬〜下旬
    return SEASON_PHASES.OFF_SEASON;
  }

  if (month >= 1 && month <= 3) {
    return SEASON_PHASES.SPRING_CAMP;
  } else if (month >= 4 && month <= 9) {
    return SEASON_PHASES.REGULAR_SEASON;
  } else if (month === 10 && day < 10) {
    return SEASON_PHASES.REGULAR_SEASON;
  } else if (month === 10 && day >= 10 && day <= 20) {
    return SEASON_PHASES.PLAYOFFS;
  } else if (month === 10 && day >= 21 && day < draftDay) {
    return SEASON_PHASES.OFF_SEASON;
  } else if (month === 10 && day === draftDay) {
    return SEASON_PHASES.DRAFT;
  } else if (month === 10 && day > draftDay) {
    return SEASON_PHASES.OFF_SEASON;
  } else if (month === 11 && day < 9) {
    return SEASON_PHASES.OFF_SEASON;
  } else if (month === 11 && day === 9) {
    return SEASON_PHASES.CONTRACT;
  } else if (month === 11 && day === 10) {
    return SEASON_PHASES.TRYOUT;
  } else if (month === 11 && day > 10 && day < 30) {
    return SEASON_PHASES.OFF_SEASON;
  } else if (month === 11 && day >= 30) {
    return SEASON_PHASES.OFF_SEASON;
  } else if (month === 12) {
    return SEASON_PHASES.OFF_SEASON;
  }
  return SEASON_PHASES.OFF_SEASON;
};

/** ゲームの年度（1年目=1）の暦年。1年目が2024年 */
export const calendarYearOf = (gameYear) => 2024 + gameYear - 1;

/**
 * 開幕の日（4月1日）とフェーズ。一人用の開幕（`soloSeasonSteps.js` の `openSoloSeason`）と
 * オンラインのキャンプ明け（`server/leagueEngine.mjs`）が同じものを使う。
 * 年度が無いとき（作りかけのデータ）は1年目として扱う。
 */
export const openingDayFields = (gameYear) => ({
  currentDate: { year: calendarYearOf(gameYear || 1), month: 4, day: 1 },
  phase: SEASON_PHASES.REGULAR_SEASON,
});

/**
 * シーズン初期データ作成
 */
export const createSeasonData = (year = 1) => {
  return {
    year,                           // シーズン年数
    currentDate: { year: calendarYearOf(year), month: 1, day: 1 },  // 現在の日付（年数に連動）
    phase: SEASON_PHASES.SPRING_CAMP,  // 現在のフェーズ
    schedule: [],                   // 試合スケジュール
    results: [],                    // 試合結果
    standings: [],                  // 順位表
    settings: {
      useDH: false,                 // DH制
      gamesPerSeason: 60,           // 年間試合数（チームあたり）
      teamsCount: 4,                // チーム数
      playoffFormat: 'short'        // プレーオフ形式（'short': 3回戦, 'full': 5回戦, 'tournament': 4チームトーナメント）
    }
  };
};

/**
 * オフシーズンの画面に、年度更新が済んだ後のデータ（翌年の1月1日・春季キャンプ）が来ているか。
 * ⚠ 大学は年度更新のあと卒業・入部レポートを挟み、その間も画面はオフシーズンのまま。
 *    年が替わった瞬間のオートセーブ・緊急保存は「翌年のデータ・画面はオフシーズン」で入る。
 *    以前はこれを読み直すとオフシーズンの画面が「3年目へ進む」を出し、1年遊ばないまま
 *    加齢・卒業・入部がもう一度走った。オフシーズンの画面はこの形なら年度更新をせず、
 *    レポートの続き（無ければ翌年の手続き）へ進める（`OffSeasonScreen.jsx`）
 */
export const isYearAdvanced = (seasonData) => seasonData?.phase === SEASON_PHASES.SPRING_CAMP;

/**
 * 日付を進める
 * @param {Object} currentDate - 現在の日付 {year, month, day}
 * @param {number} days - 進める日数
 * @returns {Object} 新しい日付
 */
export const advanceDate = (currentDate, days = 1) => {
  let { year, month, day } = currentDate;

  day += days;

  while (day > getDaysInMonth(year, month)) {
    day -= getDaysInMonth(year, month);
    month++;

    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return { year, month, day };
};

/**
 * 日付を比較
 * @returns {number} -1: date1が前, 0: 同じ, 1: date1が後
 */
export const compareDates = (date1, date2) => {
  if (date1.year !== date2.year) return date1.year - date2.year;
  if (date1.month !== date2.month) return date1.month - date2.month;
  return date1.day - date2.day;
};

/**
 * 日付を文字列に変換
 */
export const formatDate = (date) => {
  return `${date.year}/${date.month}/${date.day}`;
};

/**
 * 日付から曜日を取得（0:日曜日 - 6:土曜日）
 */
export const getDayOfWeek = (date) => {
  return new Date(date.year, date.month - 1, date.day).getDay();
};

/**
 * 試合日かどうかを判定
 * - レギュラーシーズン：火・水・木・金・土・日（月曜休み）
 * - プレーオフ：全日
 */
export const isGameDay = (date, phase) => {
  const dayOfWeek = getDayOfWeek(date);

  if (phase === SEASON_PHASES.REGULAR_SEASON) {
    return dayOfWeek !== 1; // 月曜以外
  } else if (phase === SEASON_PHASES.PLAYOFFS) {
    return true; // 全日
  }

  return false;
};


/**
 * プレーオフスケジュールを生成
 * @param {Array} teams - 上位チーム配列（順位順）
 * @param {string} format - 'short'（3回戦2勝先取）/ 'full'（5回戦3勝先取）/ 'tournament'（4チームトーナメント）
 * @param {number} year - 年
 * @returns {Array} プレーオフスケジュール
 */
export const generatePlayoffSchedule = (teams, format = 'short', year = 2024) => {
  const schedule = [];
  const startDate = { year, month: 10, day: 10 };
  let playoffId = 90001; // レギュラーシーズンのidと重複しない番号帯

  // シリーズ試合を生成するヘルパー
  const addSeries = (team1, team2, maxGames, round, seriesId, dayOffset = 0) => {
    for (let game = 1; game <= maxGames; game++) {
      const date = advanceDate(startDate, dayOffset + game - 1);
      // 上位チームにホームアドバンテージ（3戦: 第1,3戦、5戦: 第1,2,5戦）
      const isHomeTeam1 = maxGames === 3
        ? (game <= 1 || game === 3)
        : (game <= 2 || game === 5);
      schedule.push({
        id: playoffId++,
        date,
        home: isHomeTeam1 ? team1 : team2,
        away: isHomeTeam1 ? team2 : team1,
        homePitcher: null, awayPitcher: null, result: null,
        phase: SEASON_PHASES.PLAYOFFS,
        playoffRound: round,
        seriesGame: game,
        seriesId
      });
    }
  };

  if (format === 'short') {
    // 1位 vs 2位：3回戦2勝先取制
    addSeries(teams[0], teams[1], 3, 'final', 'final');
  } else if (format === 'full') {
    // 1位 vs 2位：5回戦3勝先取制
    addSeries(teams[0], teams[1], 5, 'final', 'final');
  } else if (format === 'tournament' && teams.length >= 4) {
    // 4チームトーナメント: 準決勝5回戦×2 + 決勝5回戦
    // 準決勝1: 1位 vs 4位
    addSeries(teams[0], teams[3], 5, 'semi', 'semi1', 0);
    // 準決勝2: 2位 vs 3位
    addSeries(teams[1], teams[2], 5, 'semi', 'semi2', 0);
    // 決勝（TBD - 準決勝結果で埋まる）
    for (let game = 1; game <= 5; game++) {
      const date = advanceDate(startDate, 6 + game - 1);
      schedule.push({
        id: playoffId++,
        date,
        home: 'TBD', away: 'TBD',
        homePitcher: null, awayPitcher: null, result: null,
        phase: SEASON_PHASES.PLAYOFFS,
        playoffRound: 'final',
        seriesGame: game,
        seriesId: 'final'
      });
    }
  }

  return schedule;
};

/**
 * オフシーズンの画面の「CHAMPION」。プレーオフで優勝が決まった年はその球団、
 * プレーオフが無い（大学・箱庭の途中など）・決着していない年は勝率の1番。
 * ⚠ 以前はいつも勝率の1番（レギュラーシーズン1位）を出していて、プレーオフを勝った球団と
 *    違った。レギュラーシーズン1位は `leagueFirst` で別に添える。
 * 順位表が無い（社会人は大会だけ）ときは null。
 * @returns {{ champion: object, leagueFirst: object, byPlayoff: boolean } | null}
 */
export const seasonChampion = (standings = [], schedule = []) => {
  if (!standings || standings.length === 0) return null;
  const sorted = [...standings].sort((a, b) => b.winRate - a.winRate);
  const playoffWinner = getPlayoffChampion(schedule || []);
  const byPlayoff = playoffWinner ? sorted.find(s => s.team === playoffWinner) : null;
  return { champion: byPlayoff || sorted[0], leagueFirst: sorted[0], byPlayoff: !!byPlayoff };
};

export const getPlayoffChampion = (schedule = [], options = {}) => {
  const finals = schedule.filter(game => game.phase === SEASON_PHASES.PLAYOFFS && game.playoffRound === 'final');
  if (finals.length === 0) return null;
  return decideSeriesWinner(finals, options);
};

/**
 * プレーオフの1シリーズの勝者。決まっていなければ null。
 * ⚠ **引き分けを挟んで全試合を終えても決まらないときは、勝ち数の多い方、
 *    同数なら上位シード（第1戦のホーム）が勝ち上がる**（NPBのクライマックスシリーズと
 *    同じ考え方）。以前は誰も必要勝数に届かないとシリーズが永久に決着せず、
 *    優勝チームが空のまま・トーナメント形式では決勝が「未定」のまま残っていた。
 * ⚠ **対人版（server/）は `settleDraws: false` を渡す**。対人版は未決着なら翌日に
 *    再試合を足す設計（`server/playoffReplay.mjs`）で、ここで決めてしまうと
 *    再試合が組まれずにシードの上の球団が優勝する。一人用は再試合を持たないので既定で決める。
 */
export const decideSeriesWinner = (games = [], { settleDraws = true } = {}) => {
  if (games.length === 0) return null;
  const wins = new Map();
  for (const game of games) {
    if (!game.result || game.result.cancelled) continue;
    const winner = game.result.homeScore > game.result.awayScore ? game.home
      : game.result.awayScore > game.result.homeScore ? game.away : null;
    if (winner) wins.set(winner, (wins.get(winner) || 0) + 1);
  }
  const required = games[0].seriesWinsRequired || (games.length === 1 ? 1 : Math.ceil(games.length / 2));
  const clinched = [...wins].find(([, count]) => count >= required)?.[0];
  if (clinched) return clinched;
  if (!settleDraws) return null;
  if (games.some(game => !game.result)) return null; // まだ試合が残っている
  const first = [...games].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))[0];
  if (!first || first.home === 'TBD' || first.away === 'TBD') return null;
  return (wins.get(first.away) || 0) > (wins.get(first.home) || 0) ? first.away : first.home;
};

/**
 * プレーオフシリーズの進行を管理
 * 3戦先取なら3勝した時点でシリーズ終了、残りの試合をスキップ
 * 準決勝が終わったら決勝のTBDチームを確定
 */
export const updatePlayoffProgress = (seasonData, options = {}) => {
  const schedule = seasonData.schedule.map(game => ({ ...game }));
  const playoffGames = schedule.filter(g => g.phase === SEASON_PHASES.PLAYOFFS);
  if (playoffGames.length === 0) return seasonData;

  // シリーズIDごとに勝敗を集計
  const seriesMap = {};
  playoffGames.forEach(g => {
    if (!g.seriesId) return;
    if (!seriesMap[g.seriesId]) seriesMap[g.seriesId] = { games: [], teams: new Set() };
    seriesMap[g.seriesId].games.push(g);
    if (g.home !== 'TBD') seriesMap[g.seriesId].teams.add(g.home);
    if (g.away !== 'TBD') seriesMap[g.seriesId].teams.add(g.away);
  });

  let updated = false;

  // 各シリーズの勝敗チェック
  Object.entries(seriesMap).forEach(([seriesId, series]) => {
    const teams = [...series.teams];
    if (teams.length < 2 || teams.includes('TBD')) return;

    // シリーズ決着判定: 最大試合数から必要勝数を計算（5試合→3勝、3試合→2勝、1試合→1勝）。
    // 引き分けで誰も届かずに全試合を終えたときの扱いは `decideSeriesWinner` を参照
    const winner = decideSeriesWinner(series.games, options);
    if (winner) {
      series.games.forEach(g => {
        if (!g.result) {
          g.result = { homeScore: 0, awayScore: 0, cancelled: true };
          updated = true;
        }
      });
      series.winner = winner;
    }
  });

  // 準決勝が両方終わったら決勝のTBDを確定
  const semi1 = seriesMap['semi1'];
  const semi2 = seriesMap['semi2'];
  const final = seriesMap['final'];

  if (semi1?.winner && semi2?.winner && final) {
    const hasRealTeams = final.games.some(g => g.home !== 'TBD');
    if (!hasRealTeams) {
      final.games.forEach(g => {
        // 上位シードがホーム
        g.home = semi1.winner;
        g.away = semi2.winner;
      });
      updated = true;
    }
  }

  return updated ? { ...seasonData, schedule: [...schedule] } : seasonData;
};

/**
 * 順位表を更新
 * @param {Array} standings - 順位表
 * @param {Object} gameResult - 試合結果
 */
export const updateStandings = (standings, gameResult) => {
  const { home, away, homeScore, awayScore } = gameResult;

  const updated = standings.map(team => ({ ...team }));
  const homeTeam = updated.find(t => t.team === home);
  const awayTeam = updated.find(t => t.team === away);

  if (!homeTeam || !awayTeam) return standings;

  homeTeam.gamesPlayed = (homeTeam.gamesPlayed || 0) + 1;
  awayTeam.gamesPlayed = (awayTeam.gamesPlayed || 0) + 1;

  if (homeScore > awayScore) {
    homeTeam.wins++;
    awayTeam.losses++;
  } else if (awayScore > homeScore) {
    awayTeam.wins++;
    homeTeam.losses++;
  } else {
    homeTeam.draws++;
    awayTeam.draws++;
  }

  homeTeam.winRate = standingWinRate(homeTeam);
  awayTeam.winRate = standingWinRate(awayTeam);

  // 順位でソート
  return updated.sort(compareStandings);
};

/**
 * 順位表の勝率（引き分けを除く: 勝利 / (勝利 + 敗北)。NPBと同じ）。
 * ⚠ **勝率と並べ方はここだけで決める**。以前は自動の日（`daySimulation`）と
 *    並行世界が「勝利 / 試合数」、采配した試合（このファイル）と画面が
 *    「勝利 / (勝利+敗北)」で、采配した試合の直後だけ順位が入れ替わり、
 *    プレーオフの進出・シードがどちらで締まったかで変わっていた。
 */
export const standingWinRate = (s) =>
  (s.wins + s.losses) > 0 ? s.wins / (s.wins + s.losses) : 0;

/** 順位の並べ方: 勝率の高い順、同率なら勝利数の多い順 */
export const compareStandings = (a, b) => (b.winRate - a.winRate) || (b.wins - a.wins);

/**
 * 順位表を初期化
 * @param {Array} teams - チーム配列
 */
export const initializeStandings = (teams) => {
  return teams.map(team => ({
    team,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: 0.000,
    gamesPlayed: 0
  }));
};

// ============================================================
// 規定打席・規定投球回（タイトルの資格）
//
// ⚠ **定義をここ以外に書かないこと**。以前は3箇所にバラバラの式があった:
//     シーズン中のランキング(DateProgressScreen) … 試合数×3.1 / 試合数×1.0
//     シーズン終了時のタイトル(processSeasonEnd)  … **100打数 / 30 固定**
//     検証ハーネス(lib/stats.mjs)                 … 試合数×2.5 / 試合数×0.5
//   その結果「防御率ランキング1位」と「防御率王」が別人になっていた。
//
// ⚠ **`inningsPitched` はアウト数を持っている**（`+= p.outs`、ERAは `×27/outs`）。
//   タイトル側の `inningsPitched >= 30` は「30回」のつもりが**30アウト＝10回**で、
//   実測75試合のシーズンで投手78人中74人が規定到達、
//   **17.7回で防御率0.00の中継ぎが防御率王**になっていた（首位打者は.454）。
//
// 実NPB: 規定打席 = 試合数 × 3.1（**打席**であって打数ではない） /
//        規定投球回 = 試合数 × 1.0（イニング）
// ============================================================
export const PA_PER_GAME = 3.1;
export const INNINGS_PER_GAME = 1.0;

/** 規定打席（打席数）。シーズン途中は進行度で按分する */
export const qualifiedPA = (totalGames, progress = 1) =>
  Math.max(1, Math.floor((totalGames || 0) * PA_PER_GAME * Math.max(0, Math.min(1, progress))));

/** 規定投球回を**アウト数**で返す（seasonStats.pitching.inningsPitched と同じ単位） */
export const qualifiedOuts = (totalGames, progress = 1) =>
  Math.max(3, Math.floor((totalGames || 0) * INNINGS_PER_GAME * Math.max(0, Math.min(1, progress))) * 3);

/**
 * 打席数。打席そのものは保存していないので 打数+四球+死球+犠飛 で近似する（犠打は数えない）。
 * ⚠ 犠飛は 2026-11-23 から打数に入れず `sacrificeFlies` に数える。前は打数に入っていたので、
 *    犠飛を足しておくと規定打席の判定が前と同じになる
 */
export const plateAppearances = (b) =>
  (b?.atBats || 0) + (b?.walks || 0) + (b?.hitByPitch || 0) + (b?.sacrificeFlies || 0);

// ES module exports
