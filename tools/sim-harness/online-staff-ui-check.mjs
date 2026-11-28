// 指導者（監督・コーチ）の画面（`src/online/StaffPage.jsx`）を実画面で操作する。
// 配布HTML（dist/index.html）を開き、通信はこの検査の中のリーグへつなぐ
// （`lib/serviceRoute.mjs`。サーバーもシーズンの進行も要らない）。
//   npm run build && node tools/sim-harness/online-staff-ui-check.mjs
//
// 見ること（リーグはセットを選んだ直後＝キャンプの間）:
//  - PC の左メニュー「指導者」: 3人のカード・任せ方・采配の内訳・市場・各球団の指導者
//  - 任せ方は押しただけでは送らず、「任せ方を保存」でまとめて1回だけ送る
//  - 野手コーチを解任すると空席になり、スタメンと打順の任せ方は「自分で」しか選べない
//  - 市場から呼ぶと席が埋まる
//  - 方針・采配の項目の下に「→ 中身（決めた人）」が出る
//  - 任せ方・方針・采配を変えたまま別のページへ移ると、左メニューに未保存の印が出る
//  - 他球団を選ぶと、その球団の指導者（CPU球団なら采配の内訳も）が出る
//  - スマホ（390px）のホームの「指導者」から同じ中身が開く
//  - 手続き（トライアウト）を開いたあとに任せ方を変えると、手続きの標準案が取り直される
//  - 任せた手続きは指導者の案を読むだけで、決定・下書き・編集を出さない（指導者のページへの入口）
//  - 待たれている最後の1人が手続きを任せる前に確認を挟み、決まったら知らせを言い分ける
// 画面の写しは /tmp/baseball-online-staff-*.png
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { launchBrowser, distHtml } from './lib/browser.mjs';
import { routeToService, tryoutService } from './lib/serviceRoute.mjs';
import { plannedPicks } from '../../src/online/tryoutPlan.js';
import {
  loadLeagueWorld,
  openPhase,
  captureLeagueWorld,
  defaultPhasePlan,
} from '../../server/leagueEngine.mjs';
import { withSeededRandom, hashSeed } from '../../src/game/rng.js';
import { join } from 'node:path';
import { createTestStore } from './lib/testStore.mjs';
import { shortLastLines, midWordBreaks } from './lib/textWrap.mjs';
import { LeagueService } from '../../server/leagueService.mjs';
import { failureShots } from './lib/failureShots.mjs';

const html = await distHtml();
const base = 'http://localhost:3000';

/** セットを選んでキャンプに入ったリーグ（参加者は管理者1人） */
async function campService() {
  const dir = await mkdtemp(join(tmpdir(), 'online-staff-ui-'));
  const store = createTestStore(join(dir, 'league.json'));
  const clock = () => '2026-10-26T15:00:00.000Z';
  const service = new LeagueService(store, {
    members: [{ userId: 'admin', label: '管理者' }],
    adminId: 'admin',
    clock,
  });
  const sessionId = (await service.login('admin')).sessionId;
  await service.command('admin', sessionId, { requestId: 'create-0', revision: 0, type: 'create' });
  const created = (await store.read()).league;
  await service.command('admin', sessionId, {
    requestId: 'packpick-0',
    revision: created.revision,
    type: 'submit',
    payload: { phaseId: created.phase.id, plan: { packId: created.packs[0].id }, ready: true, baseSubmission: null },
  });
  const league = (await store.read()).league;
  assert.equal(league.phase?.kind, 'camp', 'セットを選んでもキャンプに入らない');
  // 年度更新を終えた形にする（2年目のキャンプ。ホームのキャンプの下に「その年のまとめ」が出る）
  // ⚠ まとめの材料は**年度の記録と取引の記録**（`server/yearSummary.mjs`）。
  //    以前はオフの成長（`offseasonResults`）を出していたので、その作り物で足りていた
  await store.transaction((bundle) => {
    const l = bundle.league;
    const mine = l.members[0].teamName;
    const leagues = Object.fromEntries((l.teams || []).map((t) => [t.name, t.league]));
    l.season.year = 2;
    l.history = [
      {
        year: 1,
        standings: l.season.settings.teamNames.map((team, i) => ({
          team,
          wins: 70 - i * 5,
          losses: 50 + i * 5,
          draws: 0,
          winRate: (70 - i * 5) / 120,
        })),
        leagues,
        playoffChampion: mine,
        awards: {},
      },
    ];
    l.transactions = [
      {
        year: 1,
        kind: 'signing',
        teams: [mine],
        date: { month: 11, day: 10 },
        moves: [{ name: '入団一郎', position: 'pitcher', from: null, to: mine }],
      },
      {
        year: 1,
        kind: 'release',
        teams: [mine],
        date: { month: 11, day: 1 },
        moves: [{ name: '退団二郎', position: 'left', from: mine, to: null }],
      },
    ];
    return { value: null };
  });
  return { service, store, userId: 'admin', sessionId };
}

/**
 * 考え方・性格の行（`Scale`）の文字が重ならず、行からはみ出さないこと。
 * ⚠ 1段に「見出し・目盛り・言い表し」を並べていて、目盛りの両端の言葉が
 *    言い表しの欄に重なっていた（PC 1440 でも）
 */
async function scaleProblems(p) {
  await p.evaluate(() =>
    document.querySelectorAll('details.online-staff-more').forEach((d) => {
      d.open = true;
    }),
  );
  return p.evaluate(() => {
    const out = [];
    for (const li of document.querySelectorAll('.online-staff-scale')) {
      const box = li.getBoundingClientRect();
      const parts = [
        ...li.querySelectorAll(
          '.online-staff-scale-label, .online-staff-scale-ends small, .online-staff-scale-bar, :scope > b',
        ),
      ].map((n) => n.getBoundingClientRect());
      const text = li.innerText.replace(/\n/g, '/');
      if (parts.some((r) => r.right > box.right + 1 || r.left < box.left - 1)) out.push(`はみ出し ${text}`);
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i];
          const b = parts[j];
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
            out.push(`重なり ${text}`);
        }
    }
    return [...new Set(out)];
  });
}

const browser = await launchBrowser();
const errors = [];
try {
  const fixture = await campService();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const { commands } = await routeToService(context, fixture);
  await context.route(`${base}/online`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${base}/online`);
  const nav = p.locator('.online-page-nav');
  const go = (label) => nav.getByRole('button', { name: label, exact: true }).click();
  // 左メニューの未保存の印（u1 中11）。⚠ 以前はスタメン設定・投手起用にしか出ず、
  //   任せ方・方針・采配は変えたまま移っても何も出なかった
  const unsavedMark = (label) =>
    nav.getByRole('button', { name: label, exact: true }).getByLabel('保存していない変更');
  const goHome = async () => {
    await go('ホーム');
    await nav.locator('.online-nav-home[aria-current="page"]').waitFor();
  };
  await nav.getByRole('button', { name: '指導者', exact: true }).waitFor();
  // ⚠ 年が替わったら**キャンプ中のホーム**に「その年のまとめ」を、カードの地色で出す。
  //    ⚠ 以前はここに年度更新の伸び（オフの成長）を出していたが、いしだ 2026-11-18
  //       「キャンプの結果やオフの成長は要りません。その年の順位、入退団の選手、
  //       主なトピックに止めて下さい」で入れ替えた。
  //    ⚠ カードの地色に載せること（薄い箱の地色がカードを消して、明るいグレーの地に
  //       明るい文字が載っていたことがある）
  const summary = p.getByRole('region', { name: 'その年のまとめ' });
  await summary.waitFor();
  assert.ok(await p.locator('.online-camp').isVisible(), 'その年のまとめはキャンプと同じホームに出す');
  const summaryPaint = await summary.evaluate((node) => ({
    card: getComputedStyle(node).backgroundColor,
    ground: getComputedStyle(node.closest('.online')).backgroundColor,
  }));
  assert.ok(
    summaryPaint.card.startsWith('rgb(') && summaryPaint.card !== summaryPaint.ground,
    `その年のまとめがカードの地色に載っていない: ${JSON.stringify(summaryPaint)}`,
  );
  // ⚠ **オフの成長・キャンプの結果は出さない**（年度更新のあとはまとめだけ）
  for (const name of ['オフの成長', 'キャンプ結果'])
    assert.equal(
      await p.getByRole('region', { name }).count(),
      0,
      `年が替わったのに「${name}」が出ている`,
    );
  // まとめの中身は3つ（順位・入退団・主なトピック）
  for (const head of ['順位', '入退団', '主なトピック'])
    assert.ok(
      (await summary.innerText()).includes(head),
      `まとめに「${head}」が無い`,
    );
  // ⚠ キャンプの表は 1440px で横に送らずに右端まで見える。選択欄が 150px で、
  //    投手の表が 11px はみ出して右端の列が切れていた
  const campOverflow = await p
    .locator('.online-camp-scroll')
    .evaluate((n) => n.scrollWidth - n.clientWidth);
  assert.ok(campOverflow <= 1, `1440px でキャンプの表が横にはみ出す（${campOverflow}px）`);
  await go('指導者');
  const cards = p.locator('.online-staff-grid').first().locator('.online-staff-card');
  await cards.first().waitFor();
  assert.equal(await cards.count(), 3, '首脳陣のカードが3枚でない');
  assert.deepEqual(await scaleProblems(p), [], '考え方・性格の行の文字が重なる（PC）');
  // ⚠ カードの表の値・好む選手・左メニューの時刻は区切りで折る。字の途中で折って
  //    「…先発で押す・中／間」「手続きの決定待／ち」と1文字だけ次の行に落ちていた
  assert.deepEqual(
    await shortLastLines(p, '.online-staff-facts dd, .online-staff-prefs, .online-nav-clock small'),
    [],
    '1文字だけ次の行に落ちる文がある（PC）',
  );
  for (const role of ['監督', '投手コーチ', '野手コーチ'])
    assert.ok((await cards.allInnerTexts()).some((t) => t.includes(role)), `${role}のカードが無い`);
  assert.ok(await p.getByRole('heading', { name: '市場（呼べる指導者）' }).isVisible(), 'キャンプなのに市場が出ない');
  assert.ok(await p.getByRole('heading', { name: '各球団の指導者' }).isVisible(), '各球団の指導者の表が無い');
  assert.ok(await p.getByRole('heading', { name: '試合中の采配（実際の動き）' }).isVisible(), '采配の内訳が無い');
  await p.screenshot({ path: '/tmp/baseball-online-staff-pc.png', fullPage: true });

  // 任せ方: 投手起用を「任せる」、キャンプを「自分で」に。⚠ 押しただけでは送らず、
  //   「任せ方を保存」で1回だけ送る（いしだ指摘 2026-11-10: 1つ押すたびに保存が走るのは微妙）
  const area = (label) => p.locator('.online-choice', { has: p.locator('.online-choice-label', { hasText: label }) });
  const pressed = (label) => area(label).locator('button[aria-pressed="true"]').innerText();
  const modesCard = p.locator('section.online-card', { has: p.getByRole('heading', { name: '任せ方', exact: true }) });
  const saveModes = modesCard.getByRole('button', { name: '任せ方を保存', exact: true });
  assert.equal(await pressed('投手起用'), '意見を聞く', '既定の任せ方が「意見を聞く」でない');
  assert.ok(await saveModes.isDisabled(), '変えていないのに任せ方を保存できる');
  const sentBefore = commands.length;
  await area('投手起用').getByRole('button', { name: '任せる', exact: true }).click();
  await area('キャンプ').getByRole('button', { name: '自分で', exact: true }).click();
  assert.equal(await pressed('投手起用'), '任せる', '押した任せ方が画面に出ない');
  assert.equal(commands.length, sentBefore, '保存を押す前に任せ方を送っている');
  assert.ok(await modesCard.getByText('保存していない変更があります（2件）').isVisible(), '未保存の件数が出ない');
  // 変えたまま別のページへ移ると、左メニューの「指導者」に印。戻ると下書きはそのまま
  await goHome();
  assert.equal(await unsavedMark('指導者').count(), 1, '任せ方を変えたまま移っても左メニューに印が出ない');
  assert.equal(await unsavedMark('方針・采配').count(), 0, '変えていない方針・采配に印が出る');
  await go('指導者');
  await modesCard.getByText('保存していない変更があります（2件）').waitFor();
  // 戻して押し直すと、その分野は変更なしに戻る
  await area('キャンプ').getByRole('button', { name: '意見を聞く', exact: true }).click();
  await area('キャンプ').getByRole('button', { name: '自分で', exact: true }).click();
  await saveModes.click();
  await p.getByText('任せ方を変えました', { exact: false }).waitFor();
  assert.equal(commands.length, sentBefore + 1, '任せ方の保存が1回でない');
  assert.deepEqual(commands.at(-1).payload, { modes: { pitching: 'delegate', camp: 'self' } });
  assert.equal(await pressed('投手起用'), '任せる', '保存した任せ方が出ない');
  assert.ok(await modesCard.getByText('保存済み', { exact: true }).isVisible(), '保存したのに未保存のまま');
  await goHome();
  assert.equal(await unsavedMark('指導者').count(), 0, '任せ方を保存したのに印が残る');
  await go('指導者');
  await cards.first().waitFor();

  // 野手コーチを解任 → 空席・スタメンと打順は「自分で」だけ
  // ⚠ 席は 監督・投手コーチ・野手コーチ の順（どのカードにも「野手コーチと入れ替える」がある）
  const battingCard = cards.nth(2);
  assert.equal(await battingCard.locator('.online-eyebrow').innerText(), '野手コーチ');
  // ⚠ 解任と市場から呼ぶは確認を1段挟む（押した瞬間には送らない）。済んだ知らせは操作ごとの文
  const sentBeforeRelease = commands.length;
  await battingCard.getByRole('button', { name: '解任する', exact: true }).click();
  const releaseAsk = battingCard.getByRole('group', { name: '指導者の操作の確認' });
  await releaseAsk.waitFor();
  assert.match(await releaseAsk.innerText(), /野手コーチを解任しますか[\s\S]*ほかの球団に呼ばれることがあります/);
  assert.equal(commands.length, sentBeforeRelease, '確認の前に解任が送られた');
  await releaseAsk.getByRole('button', { name: '戻る', exact: true }).click();
  assert.equal(await releaseAsk.count(), 0, '戻るで確認が閉じない');
  assert.equal(commands.length, sentBeforeRelease, '戻るで解任が送られた');
  await battingCard.getByRole('button', { name: '解任する', exact: true }).click();
  await releaseAsk.getByRole('button', { name: '解任する', exact: true }).click();
  await p.getByText('野手コーチを解任しました', { exact: false }).waitFor();
  assert.equal(commands.length, sentBeforeRelease + 1, '解任が1回でない');
  await cards.filter({ hasText: '空席' }).first().waitFor();
  assert.equal(await pressed('スタメンと打順'), '自分で', '野手コーチがいないのに任せ方が自分でにならない');
  assert.ok(
    await area('スタメンと打順').getByRole('button', { name: '任せる', exact: true }).isDisabled(),
    '空いた席の分野を任せられる',
  );
  // 市場から野手コーチに呼ぶ
  const market = p.locator('section', { has: p.getByRole('heading', { name: '市場（呼べる指導者）' }) });
  await market.getByRole('button', { name: '野手コーチに呼ぶ', exact: true }).first().click();
  const hireAsk = market.getByRole('group', { name: '指導者の操作の確認' });
  await hireAsk.waitFor();
  assert.match(await hireAsk.innerText(), /を野手コーチに呼びますか/);
  assert.equal(commands.length, sentBeforeRelease + 1, '確認の前に呼ぶが送られた');
  await hireAsk.getByRole('button', { name: '呼ぶ', exact: true }).click();
  await p.getByText('を野手コーチに呼びました', { exact: false }).waitFor();
  await p.waitForFunction(() => !document.querySelector('.online-staff-card.is-empty'));
  assert.equal(await pressed('スタメンと打順'), '意見を聞く', '呼んだあとも自分でのまま');
  await p.screenshot({ path: '/tmp/baseball-online-staff-pc-after.png', fullPage: true });

  // 他球団（CPU）の指導者
  const selector = p.locator('.online-team-selector select');
  const options = await selector.locator('option').evaluateAll((list) => list.map((o) => o.value));
  await selector.selectOption(options.find((v, i) => i > 0 && v));
  await p.getByText('球団の期待', { exact: false }).first().waitFor();
  assert.ok(await p.getByRole('heading', { name: '試合中の采配（実際の動き）' }).isVisible(), 'CPU球団の采配の内訳が出ない');
  await p.screenshot({ path: '/tmp/baseball-online-staff-pc-other.png', fullPage: true });

  // チーム分析の「チームの方針」（先方要望 #9）: 自球団も他球団（CPU）も、監督の型から6行と札
  await go('チーム分析');
  {
    const policy = p.getByRole('region', { name: 'チームの方針' });
    await policy.waitFor();
    const labels = await policy.locator('dt').allInnerTexts();
    for (const l of ['攻撃', '投手起用', '重心', '編成', '育成', 'いまの重点'])
      assert.ok(labels.includes(l), `自球団のチームの方針に「${l}」が無い（${labels.join('・')}）`);
    assert.ok((await policy.locator('.online-team-policy-tags li').count()) >= 3, 'チームの方針の札が出ない');
    assert.match(await policy.innerText(), /あなたの球団/, '自球団のチームの方針に注が無い');
    const teams = p.getByLabel('閲覧する球団');
    const values = await teams.locator('option').evaluateAll((list) => list.map((o) => o.value));
    await teams.selectOption(values.find((v) => v && v !== values[0]));
    await p.waitForFunction(() => !/あなたの球団/.test(document.querySelector('.online-team-policy')?.innerText || 'あなたの球団'));
    const other = await policy.innerText();
    assert.match(other, /監督/, '他球団のチームの方針に監督の名前が無い');
    await policy.scrollIntoViewIfNeeded();
    await p.screenshot({ path: '/tmp/baseball-online-staff-policy.png', fullPage: true });
  }

  // 方針・采配の項目の下に「→ 中身（決めた人）」
  await go('方針・采配');
  await p.locator('.online-staff-actual').first().waitFor();
  assert.ok((await p.locator('.online-staff-actual').count()) > 0, '方針・采配に指導者の中身が出ない');
  // 方針・采配を変えたまま移ると、左メニューの「方針・采配」に印。取り消すと消える
  await p
    .locator('.online-staff-choice')
    .first()
    .locator('button[aria-pressed="false"]')
    .first()
    .click();
  await goHome();
  assert.equal(await unsavedMark('方針・采配').count(), 1, '方針・采配を変えたまま移っても左メニューに印が出ない');
  await go('方針・采配');
  await p.getByRole('button', { name: '変更を取り消す', exact: true }).click();
  await goHome();
  assert.equal(await unsavedMark('方針・采配').count(), 0, '取り消したのに方針・采配の印が残る');
  await go('方針・采配');
  await p.locator('.online-staff-actual').first().waitFor();
  await p.screenshot({ path: '/tmp/baseball-online-staff-tactics.png', fullPage: true });

  // スマホ: ホームの「指導者」から
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${base}/online`);
  await p.getByRole('button', { name: '指導者', exact: true }).first().click();
  await p.locator('.online-staff-card').first().waitFor();
  assert.ok((await p.locator('.online-staff-card').count()) >= 3, 'スマホで指導者のカードが出ない');
  assert.deepEqual(await scaleProblems(p), [], '考え方・性格の行の文字が重なる（スマホ）');
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, `スマホで横にはみ出す（${overflow}px）`);
  await p.screenshot({ path: '/tmp/baseball-online-staff-mobile.png', fullPage: true });

  // ---- 手続きの最中に任せ方を変える（年末のトライアウト・参加者1人・スマホ 390px）--------
  {
    const fx = await tryoutService();
    // ⚠ 候補の作り直しを種で決める（`openPhase` の候補は乱数）。種が無いと、監督の案と
    //    「自分で」の標準案がたまたま同じ顔ぶれになる回があり、B2 の食い違いが見えない
    // ⚠ **種は1つに決め打ちしない**。候補の作り方や AI の選び方が変わると、決め打ちの種で
    //    2つの案が同じ顔ぶれになり、前提の確かめで落ちた（main の取り込みで起きた）。
    //    種を順に試し、監督の案と「自分で」の案が違う顔ぶれになる最初の種で開く
    await fx.store.transaction((bundle) => {
      const before = structuredClone(bundle.league);
      const picksBy = (l, mode) => {
        const member = l.members[0];
        const saved = member.staffModes;
        member.staffModes = mode ? { ...(saved || {}), tryout: mode } : saved;
        const plan = defaultPhasePlan(l, member.teamName);
        member.staffModes = saved;
        const count = Math.min(plan.count, plan.rankedIds.length);
        const roster = l.game.teams[member.teamName].players;
        return plannedPicks(plan.rankedIds, l.phase.candidates, count, roster).map((x) => x.name);
      };
      for (let i = 0; i < 30; i += 1) {
        const l = structuredClone(before);
        loadLeagueWorld(l);
        withSeededRandom(hashSeed(`staff-ui-tryout:${i}`), () =>
          openPhase(l, 'tryout', '2026-11-10T15:00:00.000Z'),
        );
        l.game = captureLeagueWorld();
        const byCoach = picksBy(l, null);
        if (byCoach.length === 0 || isDeepStrictEqual(byCoach, picksBy(l, 'self'))) continue;
        l.revision += 1;
        bundle.league = l;
        return { value: null };
      }
      throw new Error('前提: 監督の案と「自分で」の案が違う顔ぶれになる種が見つからない');
      // ⚠ リーグを丸ごと差し替えるので全体で読む（軽い読みの見張りは差し替えを追えない）
    }, { full: true });
    // ⚠ PCの左上のいまの段階は区切りで折る。「オフ · トライア／ウト」と語の途中で
    //    割れていた（再監査 F18。右の「決定待ち」の札で幅が減る）
    {
      const pc = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await routeToService(pc, fx);
      await pc.route(`${base}/online`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      const d = await pc.newPage();
      d.on('pageerror', (e) => errors.push(e.message));
      await d.goto(`${base}/online`);
      await d.locator('.online-nav-clock b').filter({ hasText: 'トライアウト' }).waitFor();
      assert.deepEqual(
        await midWordBreaks(d, '.online-nav-clock b'),
        [],
        'PCの左上のいまの段階が語の途中で折れる',
      );
      await pc.close();
    }
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const { commands: sentCommands } = await routeToService(ctx, fx);
    await ctx.route(`${base}/online`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
    const m = await ctx.newPage();
    m.on('pageerror', (e) => errors.push(e.message));
    await m.goto(`${base}/online`);
    const press = (name) => m.getByRole('button', { name, exact: true }).first().click();
    const openProcedure = async () => {
      await press('ホーム');
      await m.getByRole('button', { name: '手続き', exact: true }).first().click();
      await m.locator('.online-phase-contents').waitFor();
    };
    const openStaff = async () => {
      await press('ホーム');
      await press('指導者');
      await m.locator('.online-staff-modes').waitFor();
    };
    const tryoutArea = m.locator('.online-choice', {
      has: m.locator('.online-choice-label', { hasText: 'トライアウト' }),
    });
    const shownPicks = () => m.locator('.online-phase-contents li button').allInnerTexts();
    // サーバーのいまの標準案で実際に取る顔ぶれ（画面と同じ決め方 `plannedPicks`）
    const serverPicks = async () => {
      const d = await fx.service.defaults(fx.userId, fx.sessionId);
      const v = await fx.service.view(fx.userId, fx.sessionId);
      const count = Math.min(d.plan.count, d.plan.rankedIds.length);
      return plannedPicks(d.plan.rankedIds, v.phase.candidates, count, v.roster).map((x) => x.name);
    };

    // B2: 手続きを開いて（監督の案が下書きに入る）から任せ方を「自分で」に変えて戻ると、
    //     いまの標準案に置き換わる。以前は監督の案が「標準案です。」のまま残り、そのまま決定できた
    await openProcedure();
    const byManager = await shownPicks();
    assert.deepEqual(byManager, await serverPicks(), '前提: 開いた手続きに監督の案が出る');
    await openStaff();
    await tryoutArea.getByRole('button', { name: '自分で', exact: true }).click();
    await press('任せ方を保存');
    await m.getByText('任せ方を変えました', { exact: false }).first().waitFor();
    const bySelf = await serverPicks();
    assert.notDeepEqual(bySelf, byManager, '前提: 「自分で」の標準案は監督の案と違う');
    await openProcedure();
    await m.waitForFunction(
      (want) =>
        JSON.stringify([...document.querySelectorAll('.online-phase-contents li button')].map((b) => b.innerText)) ===
        JSON.stringify(want),
      bySelf,
      { timeout: 5000 },
    ).catch(() => {});
    assert.deepEqual(
      await shownPicks(),
      bySelf,
      '任せ方を変えたあとも、前に開いたときの監督の案が「標準案です。」のまま残る',
    );
    assert.match(await m.locator('.online-phase-status').innerText(), /標準案です/);

    // B4: 任せた手続きは指導者の案を読むだけで見せる。決定・下書き・編集は出さず、
    //     自分で決めるときの入口（指導者のページ）を置く。以前は編集→決定→「決定しました」まで
    //     進めたが、サーバーは任せた手続きを提出があっても指導者の案で決めていた
    // ⚠ 手続きが開く前から任せていた形（全員が任せていても、開いただけでは進まない）
    await fx.store.transaction((bundle) => {
      const l = bundle.league;
      l.members[0].staffModes = { ...(l.members[0].staffModes || {}), tryout: 'delegate' };
      l.revision += 1;
      return { value: null };
    });
    await m.goto(`${base}/online`);
    await press('手続き');
    const delegatedNote = m.locator('.online-phase-delegated');
    await delegatedNote.waitFor();
    assert.match(
      await delegatedNote.innerText(),
      /指導者に任せています。この手続きは指導者の案で決まります。自分で決めるなら「指導者」で任せ方を「意見を聞く」にしてください。/,
    );
    await m.locator('.online-phase-contents').waitFor();
    assert.deepEqual(await shownPicks(), await serverPicks(), '任せた手続きに指導者の案が出ない');
    for (const name of ['この内容で決定', '下書きを保存', '獲得の希望を変える', '決定を取り消す'])
      assert.equal(
        await m.getByRole('button', { name, exact: true }).count(),
        0,
        `任せた手続きに「${name}」が出る（押しても指導者の案で決まる）`,
      );
    await press('指導者のページへ');
    await m.locator('.online-staff-modes').waitFor();
    assert.equal(
      await tryoutArea.locator('button[aria-pressed="true"]').innerText(),
      '任せる',
      '前提: トライアウトを任せている',
    );

    // A2: 待たれている最後の1人（1人リーグなら本人）が手続きの分野を「任せる」にして保存すると、
    //     その場で手続きが指導者の案で決まる。取り消せないので保存の前に確認を1段挟み、
    //     済んだ知らせも言い分ける。以前は確認が無く、知らせは「任せ方を変えました」だけだった
    await tryoutArea.getByRole('button', { name: '意見を聞く', exact: true }).click();
    await press('任せ方を保存');
    await m.getByText('保存済み', { exact: true }).waitFor();
    assert.equal(
      await m.getByRole('group', { name: '任せ方の確認' }).count(),
      0,
      '手続きが決まらない変更（任せる → 意見を聞く）で確認を出した',
    );
    const sent = sentCommands.length;
    await tryoutArea.getByRole('button', { name: '任せる', exact: true }).click();
    await press('任せ方を保存');
    const ask = m.getByRole('group', { name: '任せ方の確認' });
    await ask.waitFor({ timeout: 5000 }).catch(() => {
      throw new Error('最後の1人が手続きを任せる前に確認が出ない（保存した瞬間にトライアウトが決まる）');
    });
    assert.equal(
      await ask.locator('.online-trade-confirm-head').innerText(),
      'いま決めていないのはあなただけです。任せると、この場でトライアウトが指導者の案で決まり、取り消せません。任せますか？',
    );
    assert.equal(sentCommands.length, sent, '確認の前に任せ方を送った');
    await ask.getByRole('button', { name: 'やめる', exact: true }).click();
    assert.equal(await ask.count(), 0, '「やめる」で確認が閉じない');
    assert.equal(sentCommands.length, sent, '「やめる」で任せ方を送った');
    assert.equal((await fx.store.read()).league.phase?.kind, 'tryout', '「やめる」でトライアウトが決まった');
    await press('任せ方を保存');
    await ask.getByRole('button', { name: '任せる', exact: true }).click();
    await m
      .getByText('任せ方を変えました。トライアウトは指導者の案で決まりました', { exact: true })
      .first()
      .waitFor({ timeout: 5000 })
      .catch(() => {
        throw new Error('任せたその場で手続きが決まったのに、知らせが「任せ方を変えました」だけ');
      });
    assert.equal(sentCommands.length, sent + 1, '任せ方の保存が1回でない');
    assert.equal((await fx.store.read()).league.phase, null, '前提: 任せたその場でトライアウトが決まる');
    await ctx.close();
  }

  assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
  console.log('online-staff-ui-check PASS（PC の指導者ページ・任せ方・解任と市場・他球団・方針の中身・スマホ・手続きの最中の任せ方）');
} catch (error) {
  await failureShots(browser, 'online-staff-ui');
  throw error;
} finally {
  await browser.close();
}
