// ============================================================
// 新しい見た目（試作）段3: 「今日の一戦」の札の中身（`TodayGame.jsx`）。ビューから作る。
//
// ⚠ 試合はビューの `nextGames`（近い順。自球団の試合だけ）の先頭。今日の日付の試合なら
//    「今日の一戦」、先の試合なら「次の一戦」（休養日・手続きの日）。
// ⚠ 順位は部の中の順（`compareLeagueStanding`。順位表の画面と同じ並べ方）。
// ⚠ アプリ（共通部の `TodayGame.kt`、札は `LookScenes.kt` の `TodayGameCard`）に写してある。文を変えたら両方を直し、
//    `node mobile/tools/expect-look.mjs > mobile/shared/src/jvmTest/resources/look-expected.json`
//    で期待値を書き出し直す（答え合わせはアプリの `LookTest`）。
// ============================================================
import { compareLeagueStanding, PYRAMID_LEAGUES } from '../pyramidLeague.js';
import { turnOfDate } from '../shared.js';
import { sameDate } from '../paper/paperView.js';
import { teamLook } from './teamLook.js';
import { crowdLevel } from './sceneArt.js';

const DAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 先発の1行（「0勝1敗 防23.63」）。投げていなければ防御率は「—」。
 * ⚠ 防御率は丸めずに来る（自責点×27÷アウト）。`toFixed` だけだと 2.025 が 2.02 になり（2進数で 2.02499…）、
 *    アプリ（百分の一に四捨五入）とずれるので、先に `Math.round` で百分の一にする
 */
const starterLine = (info) =>
  `${info.wins || 0}勝${info.losses || 0}敗 ${info.era == null ? '防—' : `防${(Math.round(Number(info.era) * 100) / 100).toFixed(2)}`}`;

/** 部の中の順位と成績（「2部2位 5勝4敗」） */
function standingOf(view, team) {
  const league = view.teamLeagues?.[team];
  const rows = (view.standings || [])
    .filter((s) => !league || view.teamLeagues?.[s.team] === league)
    .slice()
    .sort(compareLeagueStanding);
  const index = rows.findIndex((s) => s.team === team);
  const row = rows[index];
  const name = PYRAMID_LEAGUES.find((l) => l.id === league)?.name || '';
  if (!row) return { rank: null, rows, record: '', teams: rows.length };
  const draws = row.draws ? `${row.draws}分` : '';
  return {
    rank: index + 1,
    rows,
    row,
    teams: rows.length,
    record: `${name}${index + 1}位　${row.wins || 0}勝${row.losses || 0}敗${draws}`,
  };
}

/** 自球団のひとこと（首位との差・連勝） */
function noteOf(view, standing) {
  const parts = [];
  const { rank, rows, row } = standing;
  if (row && rows.length > 1) {
    const gap = (a, b) => ((a.wins || 0) - (b.wins || 0) + ((b.losses || 0) - (a.losses || 0))) / 2;
    if (rank === 1) {
      const lead = gap(row, rows[1]);
      parts.push(lead > 0 ? `首位・2位と${lead.toFixed(1)}差` : '首位タイ');
    } else {
      const behind = gap(rows[0], row);
      parts.push(behind > 0 ? `首位と${behind.toFixed(1)}差` : '首位と0.0差');
    }
  }
  const streak = view.teamStreaks?.[view.teamName];
  if (streak?.count >= 2 && streak.kind === 'W') parts.push(`${streak.count}連勝中`);
  if (streak?.count >= 2 && streak.kind === 'L') parts.push(`${streak.count}連敗中`);
  return parts.join('　');
}

/**
 * 札の中身。自球団の試合が無ければ null。
 * @returns `{ title, when, place, home, city, crowd, note, own, foe }`。
 *   `own` / `foe` は `{ team, record, standing, color, starter: { id, name, age, condition, mark, line } | null }`
 *   （`standing` は `{ rank, rows, row, teams, record }`）
 */
export function todayGameCard(view) {
  const game = (view?.nextGames || []).find((g) => g.home === view.teamName || g.away === view.teamName);
  if (!game) return null;
  const turn = turnOfDate(game.date, view.seasonTurns);
  // ⚠ 日付で比べる（ターンはシーズンの中だけなので、10月のプレーオフの試合を「次の一戦」にしていた）
  const today = sameDate(game.date, view.currentDate);
  const homeGame = game.home === view.teamName;
  const d = game.date || {};
  const weekday = d.year ? DAYS[new Date(Date.UTC(d.year, (d.month || 1) - 1, d.day || 1)).getUTCDay()] : '';
  const sideOf = (team) => {
    const isHome = team === game.home;
    const info = isHome ? game.homeStarterInfo : game.awayStarterInfo;
    const name = info?.name || (isHome ? game.homeStarter : game.awayStarter) || null;
    const mark = isHome ? game.homeStarterMark : game.awayStarterMark;
    const standing = standingOf(view, team);
    return {
      team,
      record: standing.record,
      standing,
      color: teamLook(team)?.c2 || '#94a3b8',
      starter: name
        ? {
            id: info?.id ?? null,
            name,
            age: info?.age,
            condition: info?.condition,
            mark: mark === 'fixed' ? '予告先発' : '先発予定',
            line: info ? starterLine(info) : '',
          }
        : null,
    };
  };
  const own = sideOf(view.teamName);
  const foe = sideOf(homeGame ? game.away : game.home);
  const homeSide = homeGame ? own : foe;
  const city = view.teamLabels?.[game.home]?.city || '';
  return {
    title: today ? '今日の一戦' : '次の一戦',
    when: `${d.month || ''}月${d.day || ''}日${weekday ? `（${weekday}）` : ''}${turn ? `　第${turn}ターン` : ''}`,
    place: homeGame ? 'ホーム' : `ビジター（${city || '相手の本拠地'}）`,
    home: game.home,
    city,
    crowd: crowdLevel(homeSide.standing.rank, homeSide.standing.teams, streakValue(view.teamStreaks?.[game.home])),
    note: noteOf(view, own.standing),
    own,
    foe,
  };
}

/** 連勝はプラス・連敗はマイナス（客の入り） */
const streakValue = (s) => (!s ? 0 : s.kind === 'W' ? s.count : s.kind === 'L' ? -s.count : 0);

/**
 * その球団の本拠地の客の入り（球場の絵の観客の量）。`todayGameCard` の `crowd` と同じ物差し。
 * ⚠ **Web の札だけ**が使う（2026-11-28。ほかの試合を大きい札に切り替えて見せるとき、その試合の
 *    本拠地の絵を描くため）。`otherGameCards` の出力は変えていない（あちらはアプリの
 *    `TodayGame.kt` の写し元で、`expect-look.mjs` が答え合わせする）
 */
export function homeCrowd(view, home) {
  const standing = standingOf(view, home);
  return crowdLevel(standing.rank, standing.teams, streakValue(view?.teamStreaks?.[home]));
}

/**
 * 同じ日のほかの試合（先方要望 #8「他のチームの対戦カードも数秒ごとに切り替えて見たい」）。
 * 今日の一戦の札の下で、数秒ごとに1枚ずつめくって見せる（`TodayGame.jsx` の `OtherGames`）。
 *
 * ⚠ 試合はビューの `upcoming`（リーグ全体のこれからの試合。先発予定は名前だけ）から、
 *    自球団の一戦と**同じ日**の、自球団の出ない試合。並びは `upcoming` のまま（日程の順）。
 * ⚠ 自球団の試合が無ければ（札が出ないとき）空。
 * @returns `[{ id, home, away, city, homeRecord, awayRecord, homeStarter, awayStarter }]`
 *   （`*Record` は「1部2位　5勝4敗」、`*Starter` は先発予定の名前。未定なら null）
 */
export function otherGameCards(view) {
  const me = view?.teamName;
  const own = (view?.nextGames || []).find((g) => g.home === me || g.away === me);
  if (!own) return [];
  return (view.upcoming || [])
    .filter((g) => g.home !== me && g.away !== me && sameDate(g.date, own.date))
    .map((g) => ({
      id: g.id ?? null,
      home: g.home,
      away: g.away,
      city: view.teamLabels?.[g.home]?.city || '',
      homeRecord: standingOf(view, g.home).record,
      awayRecord: standingOf(view, g.away).record,
      homeStarter: g.homeStarter || null,
      awayStarter: g.awayStarter || null,
    }));
}
