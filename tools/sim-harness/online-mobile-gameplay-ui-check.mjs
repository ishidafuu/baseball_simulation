// 実試合の記録とサーバーprojectionを配布HTMLへ接続。通信/Authのみfixture。
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
import { TACTIC_DEFAULTS } from '../../src/online/tactics.js';
import { choose, chosen } from './lib/choose.mjs';

const html = await readFile(
  new URL('../../dist/index.html', import.meta.url),
  'utf8',
);
const base = 'http://localhost:3000';
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROME_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHROME_CHANNEL }
    : {}),
  headless: true,
});
const noScroll = async (locator, message) =>
  assert.ok(
    await locator.evaluate(
      (node) =>
        node.scrollHeight <= node.clientHeight + 1 &&
        node.scrollWidth <= node.clientWidth + 1,
    ),
    message,
  );
try {
  for (const width of [320, 360, 390, 767]) {
    const league = structuredClone(recordedFixture);
    const team = league.game.teams[league.members[0].teamName];
    // PCで設定した値を、スマホから一部変更しても失わない。
    team.onlineTactics = {
      ...TACTIC_DEFAULTS,
      pinchHitFrom: 8,
      defenseFrom: 9,
    };
    team.pitchingRotation.pitcherRoles = Object.fromEntries(
      team.players
        .filter((p) => p.position === 'pitcher' && p.isActive !== false)
        .map((p) => [
          p.id,
          team.pitchingRotation.starters[0] === p.id
            ? 'complete'
            : team.pitchingRotation.starters.includes(p.id)
              ? 'auto_s'
              : 'auto_r',
        ]),
    );
    const initial = projectLeague(
      { league, sessions: { a: 'fixture' } },
      'a',
      'fixture',
      'a',
    );
    let commands = 0,
      attempts = 0,
      failOnce = true;
    const errors = [];
    const context = await browser.newContext({
      viewport: { width, height: 640 },
      deviceScaleFactor: width === 360 ? 3 : 1,
    });
    await context.addInitScript(() =>
      localStorage.setItem(
        'baseball-online-auth-v1',
        JSON.stringify({
          userId: 'a',
          sessionId: 'fixture',
          accessToken: 'fixture',
        }),
      ),
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
        attempts++;
        if (failOnce) {
          failOnce = false;
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              error: '編成の保存に失敗しました。変更内容を確認してください',
            }),
          });
        }
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
    // ⚠ 2026-11 から采配は編成タブの「采配」で、ボタンを押すとそのまま自動で保存する
    //    （以前は別の「事前采配」パネルで下書きし、「編成を保存」を押していた）
    await page.getByRole('button', { name: '編成', exact: true }).click();
    await page.getByRole('button', { name: '采配', exact: true }).click();
    const card = page.locator('.online-lineup-card');
    await card.waitFor();
    await choose(page, '走塁方針', 'never');
    await choose(page, '送りバント', 'never');
    await choose(page, '先発の球数上限', '80');
    // 1回目の保存は失敗させてある。選んだ内容は残し、やり直しと破棄を選べる
    await card.getByRole('alert').waitFor({ timeout: 10000 });
    assert.equal(await chosen(page, '送りバント'), 'never', '保存失敗時も選んだ内容を保持');
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${width}px 采配が横にはみ出さない`,
    );
    await card.getByRole('button', { name: 'もう一度保存する', exact: true }).click();
    await card.locator('.online-save-state', { hasText: '保存済み' }).waitFor({ timeout: 10000 });
    assert.equal(commands, 1);
    const saved = projectLeague(
      { league, sessions: { a: 'fixture' } },
      'a',
      'fixture',
      'a',
    ).lineup;
    assert.equal(saved.strategy.baseRunning, 'never');
    assert.equal(saved.tactics.sacrificeBunt, 'never');
    assert.equal(saved.tactics.starterLimit, 80);
    assert.equal(saved.tactics.pinchHitFrom, 8);
    assert.equal(saved.tactics.defenseFrom, 9);
    for (const field of ['pitcherRoles', 'starters', 'battingOrder'])
      assert.deepEqual(
        saved[field],
        initial.lineup[field],
        `${field}をスマホ保存で失わない`,
      );
    const sentAfterSave = attempts;
    await page.screenshot({
      path: `/tmp/baseball-online-mobile-tactics-${width}.png`,
      fullPage: false,
    });
    // 投手の起用（ローテと役割）もスマホで見られる
    await page.getByRole('button', { name: '投手', exact: true }).click();
    await page.getByRole('button', { name: /をローテから外す$/ }).first().waitFor();
    if (width === 360) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('button', { name: '采配', exact: true }).click();
      assert.equal(
        await chosen(page, '送りバント'),
        'never',
        'PC表示にも同じ設定が出る',
      );
      await page.setViewportSize({ width, height: 640 });
    }
    await page.reload();
    await page.getByRole('button', { name: '編成', exact: true }).click();
    await page.getByRole('button', { name: '采配', exact: true }).click();
    assert.equal(await chosen(page, '送りバント'), 'never', '再読込しても保存済みの設定');
    // 他球団の選手一覧
    await page.getByRole('button', { name: '選手', exact: true }).click();
    await page.getByRole('button', { name: '他球団を見る', exact: true }).click();
    await choose(page, '閲覧する球団', league.members[1].teamName);
    await page.getByText(/今季・閲覧/).waitFor();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      '他球団一覧も横にはみ出さない',
    );
    await page.locator('.online-roster-player-name').first().click();
    const detail = page.getByRole('dialog');
    await detail.waitFor();
    await detail
      .getByRole('button', { name: '選手成績を閉じる', exact: true })
      .click();
    await page.getByRole('button', { name: 'ホーム', exact: true }).click();
    await page.getByRole('button', { name: '試合', exact: true }).click();
    // ⚠ 試合の入口は一覧1つ（2026-11。以前の「過去の試合・個人成績」パネルは無い）
    await page
      .getByRole('button', { name: /の試合を見る$/ })
      .first()
      .click();
    const box = page.getByRole('dialog', { name: '試合結果', exact: true });
    // ⚠ 試合結果はイニングスコア＋打撃＋投手の表を縦に並べ、画面いっぱいの中でスクロールする（2026-11）
    await box.locator('table.online-line-score').waitFor();
    assert.ok(
      await box.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      `${width}px 試合結果が横にはみ出さない`,
    );
    await box.getByRole('button', { name: '試合経過', exact: true }).click();
    const progress = box.getByRole('region', { name: '試合経過', exact: true });
    await progress.waitFor();
    await noScroll(box, `${width}px 試合経過は縦横スクロール不要`);
    const closeBounds = await box
      .getByRole('button', { name: '試合結果を閉じる', exact: true })
      .boundingBox();
    assert.ok(
      closeBounds.y > 520 && closeBounds.y + closeBounds.height <= 640,
      '試合経過の閉じる操作は下部に置く',
    );
    await page.screenshot({
      path: `/tmp/baseball-online-mobile-progress-start-${width}.png`,
      fullPage: false,
    });
    const game = league.records.seasons[1].games[1];
    const checkFrame = async () => {
      const i = Number(
        await progress
          .locator('.online-mobile-play-state')
          .getAttribute('data-frame-index'),
      );
      const frame = game.replay.frames[i];
      assert.ok(frame);
      assert.match(
        await progress.getByLabel('経過のスコア').innerText(),
        new RegExp(`${frame.awayScore} – ${frame.homeScore}`),
      );
      assert.equal(await progress.locator('[aria-current=true]').count(), 1);
      return frame;
    };
    await checkFrame();
    const pa = await progress.getByRole('listitem').count();
    await progress.getByRole('button', { name: '全投球', exact: true }).click();
    await progress.getByRole('listitem').last().getByRole('button').click();
    await checkFrame();
    assert.ok((await progress.getByRole('listitem').count()) >= pa);
    const selectedHalf = await chosen(progress, '経過を見る回'),
      seen = [];
    for (;;) {
      for (const button of await progress
        .getByRole('listitem')
        .getByRole('button')
        .all()) {
        await button.click();
        seen.push(
          Number(
            await progress
              .locator('.online-mobile-play-state')
              .getAttribute('data-frame-index'),
          ),
        );
      }
      if (
        !(await progress
          .getByRole('button', { name: '次のページ', exact: true })
          .isEnabled())
      )
        break;
      await progress
        .getByRole('button', { name: '次のページ', exact: true })
        .click();
    }
    for (const [index, f] of game.replay.frames.entries()) {
      if (
        `${f.inning}:${f.top ? 1 : 0}` === selectedHalf &&
        ['pitch', 'bunt'].includes(f.kind)
      )
        assert.ok(
          seen.includes(index),
          `全投球でバント・ファウルを含む投球${index}を落とさない`,
        );
    }
    assert.equal(
      new Set(seen).size,
      seen.length,
      'ページ間で経過を重複させない',
    );
    await progress.getByLabel('経過を見る回').selectOption({
      index:
        (await progress.getByLabel('経過を見る回').locator('option').count()) -
        1,
    });
    while (
      await progress
        .getByRole('button', { name: '次のページ', exact: true })
        .isEnabled()
    )
      await progress
        .getByRole('button', { name: '次のページ', exact: true })
        .click();
    await progress.getByRole('listitem').last().getByRole('button').click();
    const last = await checkFrame();
    assert.equal(last.awayScore, game.awayScore);
    assert.equal(last.homeScore, game.homeScore);
    if (width === 360) {
      const index = await progress
        .locator('.online-mobile-play-state')
        .getAttribute('data-frame-index');
      await page.setViewportSize({ width, height: 560 });
      await noScroll(box, 'ブラウザーの表示領域が縮んでも経過が収まる');
      assert.equal(
        await progress
          .locator('.online-mobile-play-state')
          .getAttribute('data-frame-index'),
        index,
        '高さが変わっても選択プレーとページ位置を維持する',
      );
      await page.setViewportSize({ width, height: 640 });
      assert.equal(
        await progress
          .locator('.online-mobile-play-state')
          .getAttribute('data-frame-index'),
        index,
      );
    }
    await noScroll(box, '最後の投球まで画面内で閲覧できる');
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    await page.waitForLoadState('networkidle');
    assert.ok(await box.isVisible(), '定期更新で経過を閉じない');
    await page.screenshot({
      path: `/tmp/baseball-online-mobile-progress-${width}.png`,
      fullPage: false,
    });
    await box
      .getByRole('button', { name: '試合結果を閉じる', exact: true })
      .click();
    assert.equal(attempts, sentAfterSave, '経過の閲覧で追加コマンドを送らない');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'online-mobile-gameplay-ui-check PASS（320/360×640 DPR3/390/767px・采配の自動保存/保存失敗とやり直し・PC設定保持・他球団・全投球/回/ページ/得点・長いスクロールなし / 通信はfixture）',
  );
} finally {
  await browser.close();
}
