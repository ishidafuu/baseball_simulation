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
import { choose, chosen } from './lib/choose.mjs';
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
    else if (action === 'view')
      data = projectLeague(
        { league, sessions: { a: 'fixture' } },
        'a',
        'fixture',
        'a',
      );
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
  // ⚠ 2026-11 から采配は編成タブの「采配」で、選ぶとそのまま自動で保存される
  await page.getByRole('button', { name: '編成', exact: true }).click();
  await page.getByRole('button', { name: '采配', exact: true }).click();
  await choose(page, '送りバント', 'never');
  await choose(page, '先発の球数上限', '80');
  await page.getByText('打順・起用を保存しました', { exact: true }).waitFor();
  await page.locator('.online-save-state', { hasText: '保存済み' }).waitFor();
  const saved = commands;
  assert.ok(saved >= 1, '采配が自動で保存される');
  const ownTeam = league.members[0].teamName;
  assert.equal(league.game.teams[ownTeam].onlineTactics.sacrificeBunt, 'never');
  assert.equal(league.game.teams[ownTeam].onlineTactics.starterLimit, 80);
  await page.getByRole('button', { name: '投手', exact: true }).click();
  await page.getByRole('button', { name: /をローテから外す$/ }).first().waitFor();
  await page.getByRole('button', { name: '選手', exact: true }).click();
  assert.ok(
    (await page.locator('.online-roster-table').first().locator('thead button').count()) >= 10,
    'PCは主要項目を表で一覧表示',
  );
  await page.getByRole('button', { name: '試合', exact: true }).click();
  // ⚠ 試合の入口は一覧1つ（2026-11。以前の「過去の試合・個人成績」パネルは無い）
  await page
    .getByRole('button', { name: /の試合を見る$/ })
    .first()
    .click();
  const box = page.getByRole('dialog', { name: '試合結果', exact: true });
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
  assert.equal(await chosen(watch, '観戦位置'), '1');
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
  assert.equal(commands, saved, '再生・シーク・選手閲覧で試合や日付を書き換えない');
  await box
    .getByRole('button', { name: '試合結果を閉じる', exact: true })
    .click();
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    'online-replay-ui-check PASS（実記録・PC主要項目・采配の自動保存・球場/投球コース・再生/停止/シーク・最終得点・閲覧非破壊 / 通信はfixture）',
  );
} finally {
  await browser.close();
}
