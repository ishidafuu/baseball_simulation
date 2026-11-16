// 年代記の紙面の検査（ChronicleTest）に使う窓口の答えを作る。
//   node mobile/tools/chronicle-fixtures.mjs
// 1年目をレギュラーシーズンの終盤（マジックが出る頃）まで進めたビューと、
// 年度更新のあと（キャンプ）のビューを書き出す。
// もう1つ、プロのその後と便りの載ったビュー（view-pro.json。年代記・年齢構成・参加の時刻だけ）を書き出す。
// ⚠ 1年目のリーグには29歳以上がほとんど居ないので、年度更新で引退が出ないことが多い。
//    そのときは**記録の作り方（recordRetirements）で1人分を作って**載せる（紙面の文を確かめるため）。
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  createLeague,
  defaultPhasePlan,
  submitPhase,
  advanceLeagueDay,
} from '../../server/leagueEngine.mjs';
import { projectLeague, projectTeamInfo } from '../../server/projection.mjs';
import { recordRetirements } from '../../server/chronicle.mjs';
import { SEASON_PHASES } from '../../src/season/seasonManager.js';

const out = new URL('../shared/src/jvmTest/resources/chronicle/', import.meta.url);
mkdirSync(out, { recursive: true });
let now = new Date('2026-10-28T00:00:00Z');
const league = createLeague({ members: [{ userId: 'a' }, { userId: 'b' }], now: now.toISOString() });
const resolve = () => {
  // ⚠ 先の人の決定で手続きが済むことがある（待たれていない人がいる手続き）。済んだら止める
  for (const m of league.members)
    if (league.phase) submitPhase(league, m.userId, { phaseId: league.phase.id, plan: defaultPhasePlan(league, m.teamName), ready: true }, now.toISOString());
};
const bundle = () => ({ league, sessions: {} });
const write = (name, value) => writeFileSync(new URL(name, out), JSON.stringify(value));
const startYear = league.season.year;
let late = false;
for (let day = 0; day < 400; day++) {
  if (league.status === 'waiting') {
    if (league.phase?.kind === 'camp' && league.season.year > startYear) break;
    resolve();
    continue;
  }
  now = new Date(now.getTime() + 4 * 3600000);
  advanceLeagueDay(league, `fixture:${day}`, now.toISOString());
  const d = league.season.currentDate;
  // レギュラーシーズンの残りが10試合ほどで、マジックが出ている日
  const left = league.season.schedule.filter((g) => g.phase === SEASON_PHASES.REGULAR_SEASON && !g.result).length;
  if (!late && league.season.year === startYear && left > 0 && left <= 60) {
    const view = projectLeague(bundle(), 'a', null, null);
    if (view.races.some((r) => !r.clinched) && view.chronicle.milestones.length) {
      write('view-late.json', view);
      late = true;
      console.log(`終盤 ${d.month}/${d.day} 残り${left}試合 races=${view.races.length} milestones=${view.chronicle.milestones.length}`);
    }
  }
}
if (!league.chronicle.retired.length) {
  const season = league.records.seasons[startYear];
  const vet = Object.values(season.players).sort((a, b) => b.stats.batting.hits - a.stats.batting.hits)[0];
  const team = league.members[0].teamName;
  recordRetirements(league, [{ name: vet.name, team: vet.teams[0], age: 37, position: 'first', reason: '引退', secondCareer: { title: '打撃コーチ', team: vet.teams[0] } }], {
    year: startYear, teamNames: league.season.settings.teamNames, keys: new Map([[`${vet.teams[0]}:${vet.name}`, vet.key]]),
  });
  console.log(`引退は作り物 ${vet.name}（${team}）`);
}
write('view-offseason.json', projectLeague(bundle(), 'a', null, null));
// ⚠ プロのその後（`proCareer.mjs`）は指名の翌年の10月から出るので、リーグの写しの年だけ3年進めて作る
//    （保存しない飾りなので、年と月だけで決まる）。指名が無い年は1人分を作って載せる
if (!league.chronicle.proDrafted?.length) {
  const season = league.records.seasons[startYear];
  const star = Object.values(season.players).sort((a, b) => b.stats.batting.homeruns - a.stats.batting.homeruns)[0];
  league.chronicle.proDrafted = [
    { year: startYear, team: star.teams[0], name: star.name, key: star.key, position: 'short', age: 21, npbTeam: '読売ジャイアンツ', round: 2, reason: null },
  ];
  console.log(`プロ入りは作り物 ${star.name}`);
}
{
  const later = structuredClone(league);
  later.season.year = startYear + 3;
  later.season.currentDate = { ...later.season.currentDate, month: 11, day: 1 };
  const proTeam = later.chronicle.proDrafted[0].team;
  const v = projectLeague({ league: later, sessions: {} }, 'a', null, null);
  const t = projectTeamInfo({ league: later, sessions: {} }, 'a', proTeam);
  write('view-pro.json', {
    teamName: v.teamName,
    year: v.year,
    joinedAt: '2026-11-16T09:30:47.123Z',
    chronicle: v.chronicle,
    ageOutlook: v.ageOutlook,
    teamChronicle: { proDrafted: t.chronicle.proDrafted },
  });
  console.log(`プロの便り ${v.chronicle.proNews.length}件 / 一覧 ${v.chronicle.proDrafted.length}人`);
}
// 球団の窓口は名簿が大きいので、球団史（chronicle）だけを残す
const info = projectTeamInfo(bundle(), 'a', league.members[0].teamName);
write('team.json', { teamName: info.teamName, chronicle: info.chronicle });
console.log(`phase=${league.phase?.kind} world=${league.chronicle.world.length}`);
