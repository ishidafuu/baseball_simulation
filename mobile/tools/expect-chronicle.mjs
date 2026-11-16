// アプリの共通部（Chronicle.kt の honorRows・proDraftedAfter、AgeOutlook.kt、FirstWeek.kt）が
// Web 版と同じ答えを出すかの検査用に、期待値を書き出す。
//   node mobile/tools/expect-chronicle.mjs > mobile/shared/src/jvmTest/resources/chronicle-expected.json
// 材料は年代記のビュー（`chronicle-fixtures.mjs` が作る resources/chronicle/）。
// CI は `--check`（Web 版だけ直したときに気づく）。答え合わせは `HonorsTest`。
import fs from 'node:fs';
import { honorRows, proDraftedAfter } from '../../src/online/chronicleText.js';
import { inFirstWeek, firstWeekKey, FIRST_WEEK_DAYS } from '../../src/online/firstWeek.js';

const read = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../shared/src/jvmTest/resources/chronicle/${name}`, import.meta.url)));
const views = { late: read('view-late.json'), offseason: read('view-offseason.json'), pro: read('view-pro.json') };
// 球団名の短縮は目印を付けるだけ（名前の差し込み位置を見る）
const short = (team) => `[${team}]`;

const honors = {};
const proAfter = {};
const ageOutlook = {};
for (const [name, v] of Object.entries(views)) {
  honors[name] = {
    plain: honorRows(v.chronicle?.honors).map((r) => [r.head, r.body]),
    short: honorRows(v.chronicle?.honors, short).map((r) => [r.head, r.body]),
  };
  proAfter[name] = (v.chronicle?.proDrafted || []).map(proDraftedAfter);
  const o = v.ageOutlook;
  ageOutlook[name] = o
    ? {
        years: o.years,
        bands: o.bands.map((b) => [b.label, b.pitchers, b.fielders]),
        core: o.core.map((r) => [r.name, r.age, r.later, r.kind, !!r.veteran]),
        lines: o.lines,
        advice: o.advice,
      }
    : null;
}
const teamProAfter = (views.pro.teamChronicle?.proDrafted || []).map(proDraftedAfter);
const proNews = (views.pro.chronicle?.proNews || []).map((n) => [n.name, n.team, n.npbTeam, n.text, n.highlight ?? null]);

// はじめての1週間（時刻の読み方と期間の境目）
// ⚠ アプリの isoToMillis は秒まで読む（ミリ秒は捨てる）。比べる時刻はミリ秒の無いものにする
const DAY = 86400000;
const isoList = ['2026-11-16T09:30:47Z', '2026-11-16T00:00:00.000Z', '2027-02-28T23:59:59.000Z', '2028-02-29T12:00:00Z', '1999-12-31T23:59:59Z'];
const millis = isoList.map((iso) => [iso, Date.parse(iso)]);
const joined = '2026-11-16T09:30:47.000Z';
const at = Date.parse(joined);
const offsets = [-1000, 0, 1000, DAY, FIRST_WEEK_DAYS * DAY - 1000, FIRST_WEEK_DAYS * DAY - 1, FIRST_WEEK_DAYS * DAY, FIRST_WEEK_DAYS * DAY + 1000];
const firstWeek = {
  millis,
  joined,
  inWeek: offsets.map((d) => [at + d, inFirstWeek(joined, at + d)]),
  noJoined: inFirstWeek(null, at),
  key: firstWeekKey(views.pro.teamName, views.pro.joinedAt),
};

const text = JSON.stringify({ honors, proAfter, teamProAfter, proNews, ageOutlook, firstWeek });
if (process.argv.includes('--check')) {
  const file = new URL('../shared/src/jvmTest/resources/chronicle-expected.json', import.meta.url);
  if (fs.readFileSync(file, 'utf8').trim() !== text) {
    console.error(
      'chronicle-expected.json が古い。node mobile/tools/expect-chronicle.mjs > mobile/shared/src/jvmTest/resources/chronicle-expected.json で書き出し直し、アプリの Chronicle.kt・AgeOutlook.kt・FirstWeek.kt も揃えること',
    );
    process.exit(1);
  }
  console.log('chronicle-expected.json は Web 版の答えと一致しています');
} else {
  process.stdout.write(text + '\n');
}
