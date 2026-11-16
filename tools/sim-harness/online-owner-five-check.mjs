// 先方回答（2026-11-16）「すぐやりたい」の検査（軽い。1年は回さない）。
//   - C1 プロへ行った選手のその後: 出る時期・同じ答え・初勝利の年に勝ちがある
//   - A3 はじめての1週間: 出る期間と、済んだ順
//   - B4 年齢構成と3年後の見込み: 段の数え方と主力の人数
//   - A2 年間表彰の文: PC とアプリが同じ行を作る元（honorRows）
// 1年通しの表彰そのものは online-chronicle-check が見る。
//   node tools/sim-harness/online-owner-five-check.mjs
import assert from 'node:assert/strict';
import { proCareerOf, proNewsOf, withProCareer, PRO_SEASON_END_MONTH } from '../../server/proCareer.mjs';
import { firstWeekGuide, inFirstWeek, markFirstWeek, FIRST_WEEK_STEPS, FIRST_WEEK_DAYS } from '../../src/online/firstWeek.js';
import { ageOutlook, AGE_BANDS, CORE_FIELDERS, CORE_PITCHERS, outlookOf } from '../../src/online/ageOutlook.js';
import { honorRows } from '../../src/online/chronicleText.js';
import { honorsView, honorTitlesOf, isRookie, ROOKIE_MAX_AGE, selectHonors } from '../../server/seasonAwards.mjs';
import { createLeague } from '../../server/leagueEngine.mjs';

// ---------- C1 ----------
{
  const row = { key: 'k1', year: 2, team: 'T', name: '山田', npbTeam: '読売ジャイアンツ', round: 2, age: 21, position: 'pitcher' };
  assert.equal(proCareerOf(row, 1, { year: 2, month: 11 }).length, 0, '指名された年にもう成績が出た');
  assert.equal(proCareerOf(row, 1, { year: 3, month: PRO_SEASON_END_MONTH - 1 }).length, 0, 'プロのシーズンが終わる前に成績が出た');
  assert.equal(proCareerOf(row, 1, { year: 3, month: PRO_SEASON_END_MONTH }).length, 1, '1年目の成績が10月に出ない');
  const a = proCareerOf(row, 1, { year: 12, month: 11 });
  const b = proCareerOf(row, 1, { year: 12, month: 11 });
  assert.deepEqual(a, b, '同じ入力で答えが変わった（保存しないので、毎回同じでないといけない）');
  // 年をさかのぼっても、前の年の行は変わらない（見る時期で過去が書き換わらない）
  const earlier = proCareerOf(row, 1, { year: 8, month: 11 });
  assert.deepEqual(earlier, a.slice(0, earlier.length), '後の年を見ると前の年の成績が変わった');
  let starts = 0;
  let pairs = 0;
  let same = 0;
  for (let i = 0; i < 400; i++) {
    const r = { ...row, key: `k${i}`, round: 1 + (i % 5), position: i % 2 ? 'pitcher' : 'short', age: 19 + (i % 8) };
    const c = proCareerOf(r, 7, { year: 30, month: 11 });
    for (const x of c) {
      if (/プロ初勝利/.test(x.text)) {
        starts++;
        assert.ok(!/一軍で0勝/.test(x.text), `初勝利の年に0勝 ${x.text}`);
      }
    }
    // 引退・戦力外のあとに行が続かない
    const end = c.findIndex((x) => x.ended);
    assert.ok(end === -1 || end === c.length - 1, '引退のあとにも成績がある');
    // 同じ成績の年が続きすぎない（乱数の質。かき混ぜる前は年だけ違う2年が同じ数になることがあった）
    const strip = (t) => t.replace(/^\d+年目（[^）]*）: /, '');
    for (let k = 1; k < c.length; k++) {
      pairs++;
      if (strip(c[k].text) === strip(c[k - 1].text)) same++;
    }
  }
  assert.ok(starts > 20, '初勝利が少なすぎる');
  assert.ok(same / pairs < 0.005, `2年続けて同じ成績が多すぎる（${same}/${pairs}）`);
  const league = { seed: 3, season: { year: 4, currentDate: { month: 11 } } };
  const news = proNewsOf(league, [row, { ...row, key: 'k2', name: '佐藤', position: 'short' }]);
  assert.ok(news.length === 2 && news.every((n) => n.text.startsWith('2年目')), `今年の便り ${JSON.stringify(news)}`);
  const withAfter = withProCareer([row], league)[0];
  assert.ok(withAfter.after && withAfter.career.length === 2, 'その後の一行が付かない');
  console.log(`プロのその後: ${a.slice(0, 3).map((x) => x.text).join(' / ')}`);
}

// ---------- A3 ----------
{
  const joined = '2026-11-16T00:00:00.000Z';
  const at = Date.parse(joined);
  assert.ok(inFirstWeek(joined, at + 1000));
  assert.ok(!inFirstWeek(joined, at + FIRST_WEEK_DAYS * 86400000), '7日を過ぎても出る');
  assert.ok(!inFirstWeek(null, at), 'リーグを作ったときの人（参加の時刻なし）にも出る');
  let state = { done: [], closed: false };
  assert.equal(firstWeekGuide(joined, state, at).next.id, 'lineup');
  state = markFirstWeek(state, 'rotation');
  assert.equal(firstWeekGuide(joined, state, at).next.id, 'lineup', '済んでいない最初の手順から出す');
  for (const s of FIRST_WEEK_STEPS) state = markFirstWeek(state, s.id);
  assert.equal(firstWeekGuide(joined, state, at), null, '全部済んでも出る');
  assert.equal(firstWeekGuide(joined, { done: [], closed: true }, at), null, '閉じても出る');
  assert.equal(markFirstWeek(state, 'games'), state, '手順に無いページで状態が変わった');
}

// ---------- B4 ----------
{
  const league = createLeague({ members: [{ userId: 'a' }], now: '2026-11-16T00:00:00.000Z' });
  // ⚠ 作ったばかりのリーグは名簿が空（初期メンバーセットを選ぶ前）。セットの選手で見る
  const team = { players: league.packs[0].players };
  const all = league.packs.flatMap((p) => p.players.map((x) => x.age));
  const o = ageOutlook(team.players, all);
  assert.equal(o.bands.length, AGE_BANDS.length);
  assert.equal(o.bands.reduce((n, b) => n + b.pitchers + b.fielders, 0), team.players.length, '段の人数の合計が名簿と違う');
  assert.equal(o.core.length, CORE_FIELDERS + CORE_PITCHERS, '主力の人数');
  assert.ok(o.lines.length >= 3 && o.advice, '文が無い');
  for (const r of o.core) assert.equal(r.later, r.age + o.years);
  // 見込みの分け方: ピーク年齢を過ぎて4年以上なら下り坂
  const old = outlookOf({ age: 33, growthPotential: 1.0, personality: { discipline: 50 } });
  assert.equal(old.kind, 'decline');
  assert.ok(old.veteran, '36歳が引退の近い年齢にならない');
  const young = outlookOf({ age: 19, growthPotential: 1.3, personality: { discipline: 70 } });
  assert.equal(young.kind, 'rising');
  console.log(`年齢構成: ${o.lines.join(' ')} / ${o.advice}`);
}

// ---------- A2 の文 ----------
{
  const awards = {
    battingChampion: { name: '甲', team: 'X', avg: '0.321' },
    honors: {
      A: {
        mvp: { name: '甲', team: 'X', line: '打率.321 20本 80打点' },
        rookie: null,
        bestNine: [{ name: '乙', team: 'Y', label: '捕手' }],
        battery: { team: 'Y', pitcher: '丙', catcher: '乙', line: '100回 防御率1.80' },
      },
    },
  };
  const view = honorsView({ season: { year: 3, frozenAwards: awards }, history: [] }, { A: '1部' });
  const rows = honorRows(view, (n) => `${n}短`);
  assert.deepEqual(
    rows.map((r) => r.head),
    ['タイトル', '1部 MVP', '1部 最優秀バッテリー', '1部 ベストナイン'],
  );
  assert.equal(rows[0].body, '首位打者 甲（X短） 打率.321');
  assert.deepEqual(honorTitlesOf(awards, 'Y'), ['最優秀バッテリー 丙・乙', 'ベストナイン 乙']);
  // 表彰を足す前の年（honors なし）はタイトルだけ
  const old = honorsView({ season: { year: 3 }, history: [{ year: 2, awards: { homeRunKing: { name: '丁', team: 'Z', homeruns: 30 } } }] });
  assert.equal(old.year, 2);
  assert.equal(old.leagues.length, 0);
}

// ---------- A2 新人王の決まり（どの年も「22歳以下」かつ「去年までの記録に無い」） ----------
{
  const records = { seasons: { 1: { players: { played: {} } } } };
  const y1 = { records: { seasons: {} } };
  const y2 = { records };
  const p = (age, key) => ({ age, onlinePlayerId: key });
  assert.ok(isRookie(y1, p(ROOKIE_MAX_AGE, 'a'), 1), '1年目の22歳が新人にならない');
  assert.ok(!isRookie(y1, p(ROOKIE_MAX_AGE + 1, 'a'), 1), '1年目の23歳が新人になった');
  // 2年目以降も年齢を見る（30歳のトライアウト入団・途中参加の人の初期メンバーのベテラン）
  assert.ok(!isRookie(y2, p(30, 'tryout30'), 2), '2年目に入った30歳が新人になった');
  assert.ok(!isRookie(y2, p(25, 'pack25'), 2), '途中参加の初期メンバーの25歳が新人になった');
  assert.ok(isRookie(y2, p(19, 'tryout19'), 2), '2年目に入った19歳が新人にならない');
  assert.ok(!isRookie(y2, p(20, 'played'), 2), '去年出た20歳が新人のまま');
  // 名簿にいて出なかった若手も、23歳になれば外れる（ずっと新人のままにならない）
  assert.ok(!isRookie({ records: { seasons: { 1: { players: {} }, 2: { players: {} } } } }, p(ROOKIE_MAX_AGE + 1, 'bench'), 3), '出ないまま23歳になっても新人');
}

// ---------- A2 最優秀バッテリーはいまの球団で数える（記録の teams は足すだけ） ----------
{
  // A→B→A と戻った投手と捕手。記録の teams は [A, B] のまま
  const league = {
    season: { year: 1, settings: { gamesPerSeason: 20, teamNames: ['A', 'B'] }, standings: [] },
    teams: [{ name: 'A', league: 'L' }, { name: 'B', league: 'L' }],
    records: {
      seasons: {
        1: {
          players: {
            c: { name: '捕', teams: ['A', 'B'], catching: { pitchers: { p: { outs: 300, earnedRuns: 10 } } } },
            p: { name: '投', teams: ['A', 'B'] },
          },
        },
      },
    },
  };
  const teams = {
    A: { players: [{ id: 1, name: '捕', onlinePlayerId: 'c', position: 'catcher' }, { id: 2, name: '投', onlinePlayerId: 'p', position: 'pitcher' }] },
    B: { players: [{ id: 3, name: '他', onlinePlayerId: 'o', position: 'short' }] },
  };
  assert.equal(selectHonors(league, teams).L.battery?.team, 'A', 'A→B→A と戻った組がいまの球団で数えられない');
}
console.log('online-owner-five-check PASS');
