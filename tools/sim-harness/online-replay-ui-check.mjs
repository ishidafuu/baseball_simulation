// 実際に消化した1試合の記録と実projectionを配布HTMLに接続。通信だけfixture。
// ⚠ 観戦記録は本番では残さない（容量）。この検査が使う fixture は
//    `online-records-check` 側で明示的に記録を有効にして作っている。
//    ここで `process.env` を立てても **ESM の import が先に走るので間に合わない**。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { recordedFixture } from './online-records-check.mjs';
import {
  projectLeague,
  projectGameInfo,
  projectGames,
  projectPlayerInfo,
  projectTeamInfo,
} from '../../server/projection.mjs';
import { saveLineup } from '../../server/lineupCommand.mjs';
import { STRATEGY_FIELDS } from '../../src/online/tactics.js';
import { shortLastLines, midWordBreaks } from './lib/textWrap.mjs';
import { setTeamLabels, teamNameParts } from '../../src/online/gameText.js';
import { failureShots } from './lib/failureShots.mjs';
const league = structuredClone(recordedFixture);
const html = await readFile(
  new URL('../../dist/index.html', import.meta.url),
  'utf8',
);
const base = 'http://localhost:3000',
  authKey = 'baseball-online-auth-v1';
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROME_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHROME_CHANNEL }
    : {}),
  headless: true,
});
const errors = [];
let commands = 0;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          userId: 'a',
          sessionId: 'fixture',
          accessToken: 'fixture',
        }),
      ),
    authKey,
  );
  await context.route(`${base}/**`, async (route) => {
    if (route.request().resourceType() === 'document')
      return route.fulfill({ contentType: 'text/html', body: html });
    const url = new URL(route.request().url()),
      action = url.searchParams.get('action');
    let data;
    if (action === 'config') data = { local: true };
    else if (action === 'view') {
      data = projectLeague(
        { league, sessions: { a: 'fixture' } },
        'a',
        'fixture',
        'a',
      );
      // ⚠ この fixture は記録（`records`）だけで、今季の結果（`season.results`）が空。
      //    試合結果のカードから小窓を開く検査のため、記録の試合をカードにも並べる
      if (!data.results.length)
        data.results = projectGames({ league }, 'a', {
          year: data.year,
          scope: 'league',
        }).games;
    }
    else if (action === 'game')
      data = projectGameInfo(
        { league },
        'a',
        url.searchParams.get('id'),
        url.searchParams.get('year'),
      );
    else if (action === 'games')
      data = projectGames(
        { league },
        'a',
        Object.fromEntries(url.searchParams),
      );
    else if (action === 'player')
      data = projectPlayerInfo({ league }, 'a', url.searchParams.get('id'));
    else if (action === 'team')
      data = projectTeamInfo({ league }, 'a', url.searchParams.get('team'));
    // 来たことの知らせ（画面を開くと送る。版は上がらない）
    else if (action === 'presence') data = { ok: true };
    else if (action === 'command') {
      const command = route.request().postDataJSON();
      assert.equal(command.type, 'lineup');
      saveLineup(league, 'a', command.payload);
      league.revision++;
      commands++;
      data = { ok: true, revision: league.revision };
    } else throw new Error(`unexpected action: ${action}`);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/online`);
  // ⚠ PCの方針と自動采配は左メニューの「方針・采配」で決める。選択肢は
  //    **ボタンの列**（`role="group"`、押されている＝今の値）で、コンボボックスは置かない
  await page.getByRole('button', { name: '方針・采配', exact: true }).click();
  const choose = (label, option) =>
    page
      .getByRole('group', { name: label, exact: true })
      .getByRole('button', { name: option, exact: true })
      .click();
  await choose('送りバント', 'しない');
  await choose('先発の球数上限', '最大80球');
  assert.equal(
    await page.getByRole('combobox').count(),
    0,
    '方針・采配に開かないと選べない選択肢を置かない',
  );
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('方針・采配を保存しました', { exact: true }).waitFor();
  assert.equal(commands, 1);
  const ownTeam = league.members[0].teamName;
  assert.equal(league.game.teams[ownTeam].onlineTactics.sacrificeBunt, 'never');
  assert.equal(league.game.teams[ownTeam].onlineTactics.starterLimit, 80);
  await page.getByRole('button', { name: '選手成績', exact: true }).click();
  assert.equal(
    await page
      .locator('.online-roster-columns .online-roster-values button')
      .count(),
    12,
    'PCは主要12項目を一覧表示',
  );
  await page.getByRole('button', { name: '試合結果', exact: true }).click();
  // ⚠ 長い球団名は2行に均して折る。「鹿児島ファルコン／ズ」と1文字だけ
  //    次の行に落ちていた（1280px・1440px とも）。記録の試合は1つだけなので、
  //    最初のカードの両球団の名前をリーグの全球団の名前に差し替えて見る
  // ⚠ 折るのは**都市と愛称の間**。均すだけだと「姫路シー／ホース」と愛称の途中で
  //    割れていた（再監査 F18）。画面と同じく `teamNameParts` で塊に分けて差し替える
  const nameCells = page.locator('.online-score > div').first().locator('> span');
  await nameCells.first().waitFor();
  assert.equal(
    await nameCells.first().locator('.online-team-part').count(),
    2,
    'PCの試合結果の球団名が都市と愛称の塊に分かれていない',
  );
  const shownNames = await nameCells.evaluateAll((list) =>
    list.map((span) => span.innerHTML),
  );
  setTeamLabels(
    projectLeague({ league, sessions: { a: 'fixture' } }, 'a', 'fixture', 'a')
      .teamLabels,
  );
  const setNames = (name) =>
    nameCells.evaluateAll((list, parts) => {
      for (const span of list)
        span.replaceChildren(
          ...parts.map((part) => {
            const node = document.createElement('span');
            node.className = 'online-team-part';
            node.textContent = part;
            return node;
          }),
        );
    }, teamNameParts(name));
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    const broken = [];
    const split = [];
    for (const { name } of league.teams) {
      assert.ok(teamNameParts(name).length === 2, `前提: 既定の球団名が都市と愛称に分かれない: ${name}`);
      await setNames(name);
      broken.push(...(await shortLastLines(page, '.online-score div span')));
      split.push(...(await midWordBreaks(page, '.online-score > div > span')));
    }
    assert.deepEqual(
      [...new Set(broken)],
      [],
      `試合結果の球団名が1文字だけ次の行に落ちる（${width}px）`,
    );
    assert.deepEqual(
      [...new Set(split)],
      [],
      `試合結果の球団名が都市と愛称の間でなく、語の途中で折れる（${width}px）`,
    );
  }
  await nameCells.evaluateAll((list, names) => {
    list.forEach((span, i) => {
      span.innerHTML = names[i];
    });
  }, shownNames);
  await page.setViewportSize({ width: 1440, height: 1000 });
  // ⚠ **試合結果のカードから開いても崩れない**。小窓をカード（`.online-score`）の
  //    中に描いていて、カードの3列の grid が観戦リプレイの中まで当たり、左右の
  //    メンバー表が 16px に潰れていた
  await page
    .locator('.online-score')
    .getByRole('button', { name: /の試合成績$/ })
    .first()
    .click();
  const cardBox = page.getByRole('dialog', { name: '試合成績', exact: true });
  await cardBox.locator('tbody tr').first().waitFor();
  // ⚠ PCは**ページを分けない**。12人で区切っていた頃は、出場した13人目以降が
  //    小窓の下のページ送りの先にあり、1280×800 では送りのボタンが見えなかった
  assert.equal(
    await cardBox.locator('.online-pager').count(),
    0,
    'PCの試合成績がページに分かれている',
  );
  // ⚠ PCの試合の小窓は**選手の詳細の 760px に押し込まない**。試合成績は1240px、
  //    観戦リプレイは画面の97%（1440pxなら1396px）
  assert.ok(
    (await cardBox.boundingBox()).width >= 1200,
    `PCの試合成績の小窓が狭い: ${(await cardBox.boundingBox()).width}`,
  );
  await cardBox
    .getByRole('button', { name: '観戦リプレイ', exact: true })
    .click();
  await cardBox
    .getByRole('region', { name: '観戦リプレイ', exact: true })
    .waitFor();
  assert.ok(
    (await cardBox.boundingBox()).width >= 1380,
    `PCの観戦リプレイの小窓が狭い: ${(await cardBox.boundingBox()).width}`,
  );
  assert.equal(
    await cardBox.evaluate((node) => !!node.closest('.online-score')),
    false,
    '試合の小窓はカードの外（`.online` の直下）に描く',
  );
  const teamWidths = await cardBox
    .locator('.online-replay-team')
    .evaluateAll((list) => list.map((n) => n.getBoundingClientRect().width));
  assert.ok(
    teamWidths.length === 2 && teamWidths.every((w) => w > 150),
    `カードから開いた観戦リプレイの左右のメンバー表が潰れない: ${teamWidths}`,
  );
  await cardBox
    .getByRole('button', { name: '試合成績を閉じる', exact: true })
    .click();
  await page
    .getByRole('button', { name: '過去の試合・個人成績', exact: true })
    .click();
  const history = page.getByRole('dialog', { name: '試合記録', exact: true });
  await history
    .getByRole('button', { name: /の試合成績$/ })
    .first()
    .click();
  const box = page.getByRole('dialog', { name: '試合成績', exact: true });
  await box.getByRole('button', { name: '観戦リプレイ', exact: true }).click();
  const watch = box.getByRole('region', { name: '観戦リプレイ', exact: true });
  await watch.waitFor();
  assert.ok(
    (await watch.locator('svg').count()) >= 2,
    '通常ゲームの球場・投球コースを再利用',
  );
  assert.equal(
    await watch.locator('input[type=range]').count(),
    1,
    '観戦から守備や采配の編集はできない',
  );
  await watch.getByRole('button', { name: '次のプレー', exact: true }).click();
  assert.equal(await watch.getByLabel('観戦位置').inputValue(), '1');
  await watch.getByRole('button', { name: '再生', exact: true }).click();
  await page.waitForFunction(
    () => Number(document.querySelector('[aria-label="観戦位置"]').value) > 1,
  );
  await watch.getByRole('button', { name: '一時停止', exact: true }).click();
  await watch.getByLabel('観戦位置').focus();
  await page.keyboard.press('End');
  const game = league.records.seasons[1].games[1];
  const walkIndex = game.replay.frames.findIndex((f) => f.result === 'walk');
  assert.ok(walkIndex >= 0, '四球のある実試合で投球図を検査');
  await watch.getByLabel('観戦位置').press('Home');
  for (let n = 0; n < walkIndex; n++)
    await watch.getByLabel('観戦位置').press('ArrowRight');
  const marker = watch.locator('.online-replay-pitch-zone svg > g').last();
  assert.ok(
    (await marker.locator('[stroke="#22c55e"]').count()) > 0,
    '四球の最後の投球をボールの緑で表示',
  );
  await watch.getByLabel('観戦位置').press('End');
  assert.deepEqual(
    await watch
      .getByRole('table', { name: 'イニングスコア' })
      .locator('tbody tr td:nth-last-child(3)')
      .allTextContents(),
    [String(game.awayScore), String(game.homeScore)],
    '観戦末尾と実試合結果の得点一致',
  );
  await watch.getByText('この試合の自球団の事前設定', { exact: true }).click();
  for (const [key, [label, options]] of Object.entries(STRATEGY_FIELDS)) {
    assert.equal(
      await watch
        .locator('.online-replay-applied dt')
        .filter({ hasText: new RegExp(`^${label}$`) })
        .locator('..')
        .locator('dd')
        .innerText(),
      options[
        game.replay.appliedPlans[ownTeam].strategy[key] ??
          Object.keys(options)[0]
      ],
      '実際の基本方針も観戦から確認できる',
    );
  }
  assert.ok(
    (await watch.locator('.online-replay-controls').boundingBox()).height < 70,
    'PCの再生操作は1行に収める',
  );
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
  await page.waitForLoadState('networkidle');
  assert.ok(
    await box.isVisible(),
    '定期更新でも観戦パネルと再生位置を保持する',
  );
  await box.evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({
    path: '/tmp/baseball-online-pc-replay.png',
    fullPage: false,
  });
  assert.ok(await box.isVisible(), '画面撮影後も観戦パネルが開いている');
  assert.equal(commands, 1, '再生・シーク・選手閲覧で試合や日付を書き換えない');
  await box
    .getByRole('button', { name: '試合成績を閉じる', exact: true })
    .click();
  await history
    .getByRole('button', { name: '試合記録を閉じる', exact: true })
    .click();
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    'online-replay-ui-check PASS（実記録・PC主要12項目・采配保存・球場/投球コース・再生/停止/シーク・最終得点・閲覧非破壊 / 通信はfixture）',
  );
} catch (error) {
  await failureShots(browser, 'online-replay-ui');
  throw error;
} finally {
  await browser.close();
}
