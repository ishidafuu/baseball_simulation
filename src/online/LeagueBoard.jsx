import { LeagueTopics } from './Chronicle.jsx';
import React from 'react';
import { teamShort, ownOutcome } from './gameText.js';
import { Standings } from './LeaguePanels.jsx';
import { GameRecordButton } from './GameHistory.jsx';
import { turnOfDate } from './shared.js';

// ============================================================
// 「ホーム」に出すリーグ全体の眺め。
//
//   上段      1. 直近5試合の結果（左）と 今後の5試合（右）
//   左（広い） 2. 個人成績ランキング（打撃部門・投手部門）
//   右（狭い） 3. リーグ順位（2部制・チーム打率とチーム防御率つき）
//
// ⚠ 順位表は**作り直さないこと**。昇格・降格の線まで入った実装が
//    `LeaguePanels` にある。ここで別に書くと同じものが2つになる。
// ⚠ 数字はサーバーが作る（`server/leagueBoard.mjs`）。ここでは並べるだけ。
// ⚠ 月間カレンダーは一度置いたが**外した**。12球団は全球団が毎試合日に試合を
//    するので1マスに6試合並び、自分に関係のある行を探すほうが手間だった。
//    見たいのは「次に誰とやるか」なので、自球団の5試合だけ出す。
// ⚠ **ターンで出す**（「〇試合目」ではない）。オンラインはターンで進むので、
//    画面のどこを見ても同じ単位になっていないと「いまどこか」が読めない。
// ⚠ **休養日も出す**。抜けていると、次の試合までに何ターンあるのか（疲労が
//    どれだけ抜けるのか）が分からない。続く休養日は1行にまとめる——
//    シーズン後のプレーオフまでは何十ターンも空くので、1ターン1行にすると
//    ホームが休養日で埋まる。
// ============================================================

/**
 * 先発予定の1人ぶん。名前・投げる手・今季の勝敗と防御率。
 * ⚠ 防御率は投げていなければ `null`。0.00 と出すと「無失点の好投手」に見える。
 * ⚠ 先頭の0は省かない（0.34 を .34 にすると桁を読み違える）。
 */
function Starter({ info, fallback }) {
  if (!info) return <small>{fallback || '先発未定'}</small>;
  return (
    <>
      <small className="online-starter-name">
        {info.name}
        <b>{info.throws === 'left' ? '左' : '右'}</b>
      </small>
      <small className="online-starter-line">
        {info.wins}勝{info.losses}敗
        <span>{info.era === null ? '防—' : `防${info.era.toFixed(2)}`}</span>
      </small>
    </>
  );
}

/**
 * 試合の並びに**休養日を挟む**。返すのは `{ turn, game }` か `{ turn, to }`（休養）。
 *
 * ⚠ ターンは `turnOfDate` が正本。画面で数え直さないこと（休養日のぶん
 *    ゲーム内の日付と試合数がずれる）。
 * ⚠ **続く休養日は1行にまとめる**。シーズン後はプレーオフまで何十ターンも
 *    空くので、1ターン1行にするとホームが休養日で埋まる。
 */
export function withRestTurns(games, turns, fromTurn = null, toTurn = null) {
  const byTurn = new Map();
  for (const game of games) {
    const turn = turnOfDate(game.date, turns);
    if (turn) byTurn.set(turn, game);
  }
  const played = [...byTurn.keys()].sort((a, b) => a - b);
  if (!played.length) return [];
  // ⚠ 開始は呼ぶ側が決める（今後の分は「いまのターン」から＝今日が休養日なら
  //    それも出す）。過去の分は最初の試合から。
  const start = Math.min(played[0], fromTurn ?? played[0]);
  const end = Math.max(played[played.length - 1], toTurn ?? 0);
  const rows = [];
  for (let turn = start; turn <= end; turn += 1) {
    const game = byTurn.get(turn);
    if (game) {
      rows.push({ turn, game });
      continue;
    }
    const last = rows[rows.length - 1];
    if (last && !last.game) last.to = turn;
    else rows.push({ turn, to: turn });
  }
  return rows;
}

/** 休養日の1行。⚠ 続きは「第48〜52ターン」とまとめる */
function RestRow({ row }) {
  return (
    <li className="online-slot is-rest">
      <span className="online-slot-turn">
        第{row.turn}
        {row.to > row.turn ? `〜${row.to}` : ''}
        ターン
      </span>
      <span className="online-muted">休養日</span>
    </li>
  );
}

/**
 * 自球団の直近5試合の結果。
 * ⚠ 勝敗の印は `ownOutcome`（試合結果の画面と同じ）。ここで作り直さない。
 */
function RecentGames({ view }) {
  // ⚠ **いまのターンの1つ前まで**出す。試合の無いターンで切ると、左右の
  //    一覧の間にターンの抜けができて「この回は何だったのか」が分からない
  const now = turnOfDate(view.currentDate, view.seasonTurns);
  const rows = withRestTurns(
    view.recentGames || [],
    view.seasonTurns,
    null,
    now ? now - 1 : null,
  );
  return (
    <section className="online-card online-slots">
      <h2>直近5試合</h2>
      {rows.length ? (
        <ol>
          {rows.map((row) =>
            row.game ? (
              <Played key={row.game.id} row={row} view={view} />
            ) : (
              <RestRow key={`r${row.turn}`} row={row} />
            ),
          )}
        </ol>
      ) : (
        <p className="online-muted">まだ試合がありません。</p>
      )}
    </section>
  );
}

function Played({ row, view }) {
  const game = row.game;
  const home = game.home === view.teamName;
  const outcome = ownOutcome(game, view.teamName);
  const ours = home ? game.homeScore : game.awayScore;
  const theirs = home ? game.awayScore : game.homeScore;
  const score = (
    <>
      <b className="online-slot-score">
        {ours}–{theirs}
      </b>
      <span className="online-slot-foe">{teamShort(home ? game.away : game.home)}</span>
    </>
  );
  return (
    <li className="online-slot">
      <span className="online-slot-turn">第{row.turn}ターン</span>
      <span className="online-slot-side">{home ? 'ホーム' : 'ビジター'}</span>
      {outcome && (
        <span className={`online-outcome is-${outcome.tone}`}>
          {outcome.mark}
        </span>
      )}
      {/* ⚠ **スコアを押すと**試合結果の一覧と同じ小窓（個人成績・リプレイ）を開く。
          以前は押せず、直近の試合を見るのに「試合結果」を開き直して探していた。
          ⚠ 別のボタンを行の端に足すと、1280幅で「11–2」の行が箱からはみ出した。
          選手名と同じ「下線＝押せる」の語彙にする。
          ⚠ 日程の試合の `id` が記録の `gameId`（`daySimulation` が `game.id` で積む） */}
      {view.gameDetailsAvailable ? (
        <GameRecordButton
          className="online-slot-record"
          game={{ ...game, gameId: game.id }}
          year={view.year}
          ownTeam={view.teamName}
        >
          {score}
        </GameRecordButton>
      ) : (
        score
      )}
    </li>
  );
}

/**
 * 自球団のこれからの5試合。
 * ⚠ 「今日」で絞らないこと。休養日や手続きの日に開くと空になる。
 *    サーバーが近い順に渡す（`ownUpcomingGames`）。
 */
function NextGames({ view }) {
  // ⚠ 今日が休養日なら**それも出す**（「なぜ今日は試合が無いのか」が分かる）
  const rows = withRestTurns(
    view.nextGames || [],
    view.seasonTurns,
    turnOfDate(view.currentDate, view.seasonTurns),
  );
  return (
    <section className="online-card online-slots">
      <h2>今後の5試合</h2>
      {rows.length ? (
        <>
          <ol>
            {rows.map((row) =>
              row.game ? (
                <Upcoming key={row.game.id} row={row} view={view} />
              ) : (
                <RestRow key={`r${row.turn}`} row={row} />
              ),
            )}
          </ol>
          {/* ⚠ 先発は**予定**。当日の疲労で入れ替わることがある */}
          <p className="online-muted">先発は予定です（当日の疲労で変わります）。</p>
        </>
      ) : (
        <p className="online-muted">予定されている試合はありません。</p>
      )}
    </section>
  );
}

function Upcoming({ row, view }) {
  const game = row.game;
  const home = game.home === view.teamName;
  return (
    <li className="online-slot is-next">
      <span className="online-slot-turn">第{row.turn}ターン</span>
      <span className="online-slot-side">{home ? 'ホーム' : 'ビジター'}</span>
      <span className="online-slot-foe">{teamShort(home ? game.away : game.home)}</span>
      {/* ⚠ 先発は**2行目**に置く。1行に詰めると勝敗と防御率が切れて、
          「右投げかどうか」しか読めなくなる（実測で相手の成績が消えていた） */}
      <span className="online-slot-starters">
        <Starter
          info={home ? game.homeStarterInfo : game.awayStarterInfo}
          fallback={home ? game.homeStarter : game.awayStarter}
        />
        <em>vs</em>
        <Starter
          info={home ? game.awayStarterInfo : game.homeStarterInfo}
          fallback={home ? game.awayStarter : game.homeStarter}
        />
      </span>
    </li>
  );
}

/** ⚠ 先頭の0を省くのは3桁の率（打率・勝率）だけ。防御率は 0.34 のまま出す */
const formatLeaderValue = (category, value) =>
  category.digits === 3
    ? value.toFixed(3).replace(/^0\./, '.')
    : category.digits
      ? value.toFixed(category.digits)
      : value;

// ⚠ 部門の分け方は**サーバーの項目idで決める**。並び順で切ると、項目を
//    足したときに打撃と投球が入れ替わる
const PITCHING_IDS = new Set(['era', 'wins', 'strikeouts', 'saves']);
const SECTIONS = [
  { id: 'batting', label: '打撃部門', has: (c) => !PITCHING_IDS.has(c.id) },
  { id: 'pitching', label: '投手部門', has: (c) => PITCHING_IDS.has(c.id) },
];

/** 個人成績ランキングの1つの箱に出す人数 */
const LEADERS_SHOWN = 5;

function Leaders({ leaders, ownTeam }) {
  const shown = (leaders || []).filter((c) => c.rows.length);
  if (!shown.length) return null;
  return (
    <section className="online-card">
      <h2>個人成績ランキング</h2>
      {SECTIONS.map((section) => {
        const categories = shown.filter(section.has);
        if (!categories.length) return null;
        return (
          <div key={section.id} className="online-leader-section">
            <h3>{section.label}</h3>
            <div className="online-leaders">
              {categories.map((category) => (
                <div key={category.id} className="online-leader-box">
                  <h4>{category.label}</h4>
                  <ol>
                    {/* ⚠ サーバーは10人まで返す（アプリ用）。Web の箱は5人に揃える */}
                    {category.rows.slice(0, LEADERS_SHOWN).map((row, i) => (
                      <li
                        key={`${row.team}:${row.name}`}
                        /* ⚠ 自球団の選手は黄色で強調する */
                        className={row.team === ownTeam ? 'online-own-text' : ''}
                      >
                        <span className="online-leader-rank" data-rank={i + 1}>
                          {i + 1}
                        </span>
                        <span className="online-leader-name">
                          {row.name}
                          <small>{teamShort(row.team)}</small>
                        </span>
                        <span className="online-leader-value">
                          {/* ⚠ 先頭の0を省くのは**率の項目だけ**（打率 .525）。
                              防御率に掛けると 0.34 が .34 になって桁を読み違える */}
                          {formatLeaderValue(category, row.value)}
                          {/* 「このままなら年間○」。1位だけ（並べると数字が多すぎる） */}
                          {i === 0 && row.pace > row.value && (
                            <small className="online-leader-pace">ペース{row.pace}</small>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export default function LeagueBoard({ view }) {
  return (
    <div className="online-board">
      <div className="online-board-main">
        {/* ⚠ 直近と今後を**横に並べる**。縦に積むと、順位表を見るまでに
            1画面ぶんスクロールすることになる */}
        <div className="online-home-games">
          <RecentGames view={view} />
          <NextGames view={view} />
        </div>
        <Leaders leaders={view.leaders} ownTeam={view.teamName} />
      </div>
      <div className="online-board-side">
        <Standings view={view} />
        <LeagueTopics view={view} />
      </div>
    </div>
  );
}
