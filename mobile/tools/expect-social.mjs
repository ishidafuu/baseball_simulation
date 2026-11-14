// アプリの共通部（Kotlin の Social.kt・AwaySummary.kt）に写した文の作り方が Web 版と同じ答えを出すかの検査用に、
// 期待値を書き出す。
//   node mobile/tools/expect-social.mjs > mobile/shared/src/jvmTest/resources/social-expected.json
// CI は `--check`（Web 版だけ直したときに気づく）。答え合わせは `SocialTest`。
import fs from 'node:fs';
import { lastSeenLabel, scoringLine, tokyoDay } from '../../src/online/social.js';
import { awaySummary, divisionRank, sinceLabel } from '../../src/online/awaySummary.js';

// ⚠ まとめが見る項目だけ残す（ビューまるごとを14回入れると 1.5MB になる）
const full = JSON.parse(
  fs.readFileSync(new URL('../shared/src/jvmTest/resources/view-running.json', import.meta.url)),
);
const KEYS = ['teamName', 'revision', 'year', 'standings', 'teamLeagues', 'chronicle', 'phase', 'trades', 'exhibitions', 'inbox'];
const base = Object.fromEntries(KEYS.filter((k) => k in full).map((k) => [k, full[k]]));
base.chronicle = { milestones: full.chronicle?.milestones || [] };
// 節目の記録に使う選手（名前と id だけ）
const roster = full.roster.slice(0, 4).map((p) => ({ id: p.id, name: p.name }));
const clone = (v) => JSON.parse(JSON.stringify(v));

// 得点経過の言い方（種類・人数・名前の有無）
const plays = [
  { inning: 1, half: 'top', name: '佐藤', kind: 'homerun', runs: 1, away: 1, home: 0 },
  { inning: 3, half: 'bottom', name: '鈴木', kind: 'homerun', runs: 2, away: 1, home: 2 },
  { inning: 4, half: 'top', name: '高橋', kind: 'homerun', runs: 3, away: 4, home: 2 },
  { inning: 5, half: 'bottom', name: '田中', kind: 'homerun', runs: 4, away: 4, home: 6 },
  { inning: 6, half: 'top', name: '伊藤', kind: 'single', runs: 1, away: 5, home: 6 },
  { inning: 6, half: 'top', name: '渡辺', kind: 'double', runs: 2, away: 7, home: 6 },
  { inning: 7, half: 'bottom', name: '山本', kind: 'triple', runs: 1, away: 7, home: 7 },
  { inning: 8, half: 'top', name: '中村', kind: 'walk', runs: 1, away: 8, home: 7 },
  { inning: 8, half: 'top', name: '小林', kind: 'hit_by_pitch', runs: 1, away: 9, home: 7 },
  { inning: 9, half: 'bottom', name: '加藤', kind: 'error', runs: 1, away: 9, home: 8 },
  { inning: 9, half: 'bottom', name: null, kind: 'other', runs: 1, away: 9, home: 9 },
  { inning: 10, half: 'bottom', name: '吉田', kind: 'out', runs: 1, away: 9, home: 10 },
];
const scoring = plays.map((play) => ({
  play,
  line: scoringLine(play, { awayShort: '宮崎', homeShort: '那覇' }),
  plain: scoringLine(play),
}));

// 日本時間の日付・前回の時刻・最終ログイン（日付の境目の前後）
const times = [
  Date.UTC(2026, 10, 13, 14, 59), // 日本時間 11/13 23:59
  Date.UTC(2026, 10, 13, 15, 0), // 日本時間 11/14 0:00
  Date.UTC(2026, 10, 14, 7, 5),
  Date.UTC(2027, 0, 1, 0, 0),
  Date.UTC(2028, 1, 28, 20, 30), // うるう年の 2/29 の朝
];
const clock = times.map((at) => ({ at, day: tokyoDay(new Date(at).toISOString()), since: sinceLabel(at) }));
const days = ['2026-11-14', '2026-11-13', '2026-11-11', '2026-10-31', '', null];
const lastSeen = [];
for (const now of times)
  for (const day of days)
    lastSeen.push({
      day,
      now,
      label: day ? lastSeenLabel(`${day}T03:00:00.000Z`, new Date(now).toISOString()) : '',
    });

// 留守中のまとめ。開幕3日目のビューを前に、試合が進んだ・手続きが始まった…などを足した後と比べる
const after = (edit) => {
  const v = clone(base);
  v.revision = (v.revision || 0) + 5;
  edit(v);
  return v;
};
const own = (v) => v.standings.find((s) => s.team === v.teamName);
const resort = (v) =>
  v.standings.sort((a, b) => b.wins - a.wins || a.losses - b.losses);
const milestone = (v, extra) => ({
  year: v.year,
  playerId: roster[0].id,
  name: roster[0].name,
  team: v.teamName,
  label: '通算100安打',
  ...extra,
});
const before = clone(base);
before.trades = [{ id: 'tr-1', myTurn: true, updatedAt: '2026-11-13T00:00:00.000Z' }];
before.exhibitions = [{ id: 'ex-1', status: 'offered', mine: false }];
before.inbox = [{ id: 'n1', text: '前からあるお知らせ' }];
const cases = {
  sameRevision: { before, after: clone(before) },
  otherTeam: { before, after: after((v) => (v.teamName = '那覇ハリケーンズ')) },
  nothing: { before, after: after((v) => Object.assign(v, { trades: before.trades, exhibitions: before.exhibitions, inbox: before.inbox })) },
  games: {
    before,
    after: after((v) => {
      const row = own(v);
      row.wins += 5;
      row.losses += 1;
      resort(v);
      Object.assign(v, { trades: before.trades, exhibitions: before.exhibitions, inbox: before.inbox });
    }),
  },
  everything: {
    before,
    after: after((v) => {
      const row = own(v);
      row.wins += 1;
      row.losses += 4;
      row.draws = (row.draws || 0) + 2;
      resort(v);
      v.chronicle = {
        ...(v.chronicle || {}),
        milestones: [
          milestone(v),
          milestone(v, { label: '通算50本塁打', playerId: roster[1].id, name: roster[1].name }),
          milestone(v, { label: '通算100試合登板', playerId: roster[2].id, name: roster[2].name }),
          milestone(v, { label: '通算200安打', playerId: roster[3].id, name: roster[3].name }),
          milestone(v, { team: '那覇ハリケーンズ', label: 'よその記録' }),
        ],
      };
      v.phase = { id: 'contract:1', kind: 'contract', label: '契約更改' };
      v.trades = [
        ...before.trades,
        { id: 'tr-1', myTurn: true, updatedAt: '2026-11-14T00:00:00.000Z' },
        { id: 'tr-2', myTurn: true, updatedAt: '2026-11-14T00:00:00.000Z' },
        { id: 'tr-3', myTurn: false, updatedAt: '2026-11-14T00:00:00.000Z' },
      ];
      v.exhibitions = [
        ...before.exhibitions,
        { id: 'ex-2', status: 'offered', mine: false },
        { id: 'ex-3', status: 'offered', mine: true },
        { id: 'ex-4', status: 'played', mine: false },
      ];
      v.inbox = [{ id: 'n3' }, { id: 'n2' }, ...before.inbox];
    }),
  },
  newYear: { before, after: after((v) => (v.year += 1)) },
  noDivision: {
    before: (() => {
      const v = clone(before);
      delete v.teamLeagues;
      return v;
    })(),
    after: after((v) => {
      delete v.teamLeagues;
      own(v).wins += 2;
      resort(v);
    }),
  },
};
const summaries = Object.fromEntries(
  Object.entries(cases).map(([key, c]) => [
    key,
    {
      before: c.before,
      after: c.after,
      lines: awaySummary(c.before, c.after),
      rank: [divisionRank(c.before), divisionRank(c.after)],
    },
  ]),
);

const text = JSON.stringify({ scoring, clock, lastSeen, summaries });
if (process.argv.includes('--check')) {
  const file = new URL('../shared/src/jvmTest/resources/social-expected.json', import.meta.url);
  if (fs.readFileSync(file, 'utf8').trim() !== text) {
    console.error(
      'social-expected.json が古い。node mobile/tools/expect-social.mjs > mobile/shared/src/jvmTest/resources/social-expected.json で書き出し直し、アプリの Social.kt・AwaySummary.kt も揃えること',
    );
    process.exit(1);
  }
  console.log('social-expected.json は Web 版の答えと一致しています');
} else {
  process.stdout.write(text + '\n');
}
