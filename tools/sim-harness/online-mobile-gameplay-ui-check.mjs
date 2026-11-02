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
    await page.getByRole('button', { name: '打順', exact: true }).click();
    await page.getByRole('button', { name: '采配', exact: true }).click();
    let panel = page.getByRole('dialog', { name: '事前采配', exact: true });
    await panel.waitFor();
    for (const group of ['basic', 'bunt', 'subs', 'pitcher', 'roles']) {
      await panel.getByLabel('見る設定').selectOption(group);
      await noScroll(panel, `${width}px 采配パネルが画面に収まる`);
      await noScroll(
        panel.locator('.online-mobile-panel-content'),
        `${width}px ${group}で長いスクロールを要求しない`,
      );
      if (group === 'roles') {
        assert.equal(
          await panel.getByRole('combobox').count(),
          1,
          '投手役割はスマホから変更しない',
        );
        assert.ok((await panel.locator('article').count()) <= 4);
        await panel.locator('article button').first().click();
        await page
          .getByRole('button', { name: '選手成績を閉じる', exact: true })
          .click();
        assert.ok(await panel.isVisible(), '投手詳細を閉じたら采配へ戻る');
        while (
          await panel
            .getByRole('button', { name: '次のページ', exact: true })
            .isEnabled()
        )
          await panel
            .getByRole('button', { name: '次のページ', exact: true })
            .click();
        await noScroll(
          panel.locator('.online-mobile-panel-content'),
          '最後の役割ページも画面に収まる',
        );
      }
    }
    await panel.getByLabel('見る設定').selectOption('basic');
    await panel.getByLabel('走塁方針', { exact: true }).selectOption('never');
    await panel.getByLabel('見る設定').selectOption('bunt');
    await panel.getByLabel('送りバント', { exact: true }).selectOption('never');
    await panel.getByLabel('見る設定').selectOption('pitcher');
    await panel
      .getByLabel('先発の球数上限', { exact: true })
      .selectOption('80');
    await panel
      .getByRole('button', { name: '打順に戻る', exact: true })
      .click();
    await page
      .getByRole('button', { name: '投手・控えを含む選手成績 →', exact: true })
      .click();
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    if (width === 360) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      // ⚠ PCの編成タブは移植した画面が既定で開く（78bfd27）。方針・采配の設定はその奥
      await page
        .getByRole('button', { name: '方針・采配の設定へ（保存しない）', exact: true })
        .click();
      await page.getByRole('button', { name: '自動采配', exact: true }).click();
      assert.equal(
        await page.getByLabel('送りバント', { exact: true }).inputValue(),
        'never',
        'PC表示にも同じ下書きが反映される',
      );
      await page.setViewportSize({ width, height: 640 });
    }
    await page.reload();
    await page.getByRole('button', { name: '打順', exact: true }).click();
    await page.getByRole('button', { name: '采配', exact: true }).click();
    panel = page.getByRole('dialog', { name: '事前采配', exact: true });
    await panel.getByLabel('見る設定').selectOption('bunt');
    assert.equal(
      await panel.getByLabel('送りバント', { exact: true }).inputValue(),
      'never',
      '移動・再読込しても下書きを維持',
    );
    assert.equal(attempts, 0, '閲覧や変更だけでは自動送信しない');
    await panel
      .getByRole('button', { name: '編成を保存', exact: true })
      .click();
    await panel.getByRole('alert').waitFor();
    assert.equal(
      await panel.getByLabel('送りバント', { exact: true }).inputValue(),
      'never',
      '保存失敗時も下書きを保持',
    );
    await noScroll(
      panel.locator('.online-mobile-panel-content'),
      '保存失敗をパネル内に表示',
    );
    await panel
      .getByRole('button', { name: '編成を保存', exact: true })
      .click();
    await panel.getByText('保存済みの設定', { exact: true }).waitFor();
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
    await page.screenshot({
      path: `/tmp/baseball-online-mobile-tactics-${width}.png`,
      fullPage: false,
    });
    await panel
      .getByRole('button', { name: '打順に戻る', exact: true })
      .click();
    await page.getByRole('button', { name: 'ホーム', exact: true }).click();
    await page.getByRole('button', { name: '選手成績', exact: true }).click();
    await page
      .getByLabel('閲覧する球団')
      .selectOption(league.members[1].teamName);
    await page.getByText(/今季・閲覧/).waitFor();
    await noScroll(
      page.locator('.online-roster-rows'),
      '他球団一覧も画面に収まる',
    );
    await page.locator('.online-roster-rows article button').first().click();
    const detail = page.getByRole('dialog');
    await detail.waitFor();
    await detail
      .getByRole('button', { name: '選手成績を閉じる', exact: true })
      .click();
    await page.getByRole('button', { name: 'ホーム', exact: true }).click();
    await page.getByRole('button', { name: '試合', exact: true }).click();
    await page
      .getByRole('button', { name: '過去の試合・個人成績', exact: true })
      .click();
    const history = page.getByRole('dialog', { name: '試合記録', exact: true });
    await history
      .getByRole('button', { name: /の試合成績$/ })
      .first()
      .click();
    const box = page.getByRole('dialog', { name: '試合成績', exact: true });
    await box.getByRole('table').waitFor();
    await noScroll(box, `${width}px 個人成績に経過切替を追加しても縦に収まる`);
    await box.getByRole('button', { name: '試合経過', exact: true }).click();
    const progress = box.getByRole('region', { name: '試合経過', exact: true });
    await progress.waitFor();
    await noScroll(box, `${width}px 試合経過は縦横スクロール不要`);
    const closeBounds = await box
      .getByRole('button', { name: '試合成績を閉じる', exact: true })
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
    const selectedHalf = await progress.getByLabel('経過を見る回').inputValue(),
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
      .getByRole('button', { name: '試合成績を閉じる', exact: true })
      .click();
    await history
      .getByRole('button', { name: '試合記録を閉じる', exact: true })
      .click();
    assert.equal(attempts, 2, '経過の閲覧で追加コマンドを送らない');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'online-mobile-gameplay-ui-check PASS（320/360×640 DPR3/390/767px・采配の下書き/保存失敗/保存・PC設定保持・他球団・全投球/回/ページ/得点・長いスクロールなし / 通信はfixture）',
  );
} finally {
  await browser.close();
}
