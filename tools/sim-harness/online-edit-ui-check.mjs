// 配布HTMLでの読み込み失敗・状態の切替・保存中入力。APIはfixture。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { withDeadline } from './lib/deadline.mjs';
// ⚠ PCの編成タブは移植した画面が既定で開く（78bfd27）。方針・采配の設定・簡易の打順は
//    その奥にあるので、開いていたら閉じる（開いていなければ何もしない）
const closeFullLineup = async (page) => {
  const button = page.getByRole('button', { name: '方針・采配の設定へ（保存しない）', exact: true });
  // 描画を少し待つ（タブを押した直後はまだ無いことがある）
  const shown = await button
    .waitFor({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (shown) await button.click();
};
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
const errors = [];
const initial = () => ({
  revision: 1,
  status: 'waiting',
  year: 1,
  teamName: '検証球団',
  currentDate: { year: 2024, month: 4, day: 1 },
  nextAdvanceAt: null,
  writable: true,
  isAdmin: true,
  hasBackup: false,
  members: [],
  roster: [],
  standings: [],
  results: [],
  upcoming: [],
  history: [],
  notices: [],
  lineup: { battingOrder: [], starters: [], strategy: {} },
  phase: { id: '1:camp', kind: 'camp', label: 'キャンプ', submission: null },
});
async function scene({
  mobile = false,
  defaultsFail = false,
  staleDefaults = false,
} = {}) {
  const context = await browser.newContext({
    viewport: { width: mobile ? 390 : 1280, height: 844 },
    isMobile: mobile,
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
  const view = initial();
  const state = {
    view,
    defaultsFail,
    staleDefaults,
    payloads: [],
    hold: false,
    release: () => {},
  };
  let signal;
  state.commandStarted = new Promise((resolve) => {
    signal = resolve;
  });
  await context.route(`${base}/**`, async (route) => {
    if (route.request().resourceType() === 'document')
      return route.fulfill({ contentType: 'text/html', body: html });
    const action = new URL(route.request().url()).searchParams.get('action');
    let value;
    if (action === 'config') value = { local: true };
    else if (action === 'view') value = state.view;
    else if (action === 'defaults') {
      if (state.defaultsFail === 'html')
        return route.fulfill({
          status: 503,
          contentType: 'text/html',
          body: '<html>temporarily unavailable</html>',
        });
      if (state.defaultsFail)
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: '標準案の一時的な読込み失敗' }),
        });
      value = {
        phaseId: state.staleDefaults ? '2:camp' : state.view.phase.id,
        revision: state.view.revision,
        plan: { menu: 'standard' },
      };
    } else if (action === 'command') {
      const payload = route.request().postDataJSON().payload;
      state.payloads.push(payload);
      signal();
      if (state.hold)
        await new Promise((resolve) => {
          state.release = resolve;
        });
      state.view.phase.submission = {
        plan: payload.plan,
        ready: payload.ready,
      };
      state.view.revision++;
      value = { ok: true, revision: state.view.revision };
    } else throw new Error(`unexpected action ${action}`);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(value),
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/online`);
  state.page = page;
  state.context = context;
  return state;
}
async function click(page, text) {
  if (
    ['更新', 'ログアウト', '進行時刻'].includes(text) &&
    !(await page.getByRole('button', { name: text, exact: true }).count()) &&
    (await page.getByRole('button', { name: 'メニュー', exact: true }).count())
  )
    await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: text, exact: true }).click();
  await page
    .getByText('処理中です。画面を閉じずにお待ちください…', { exact: true })
    .waitFor({ state: 'hidden' });
}
try {
  const oversized = await scene();
  await click(oversized.page, '手続き');
  await oversized.page.getByLabel('球団の主練習（全4回）').waitFor();
  await oversized.page.evaluate(() =>
    sessionStorage.setItem(
      'baseball-online-draft:a:fixture:1:検証球団:1:camp',
      'x'.repeat(64000),
    ),
  );
  await oversized.page.reload();
  await oversized.page
    .getByText(
      '未保存案が大きすぎるため復元できませんでした。サーバーに保存済みの内容を表示します。',
      { exact: true },
    )
    .waitFor();
  await oversized.context.close();

  const draft = await scene();
  draft.page.on('dialog', (dialog) => dialog.accept());
  await click(draft.page, '手続き');
  await draft.page.getByLabel('球団の主練習（全4回）').selectOption('velocity');
  await click(draft.page, '今日');
  await click(draft.page, '手続き');
  assert.equal(
    await draft.page.getByLabel('球団の主練習（全4回）').inputValue(),
    'velocity',
    '画面移動でも提出案を保持',
  );
  await draft.page.setViewportSize({ width: 390, height: 844 });
  await draft.page.getByText('練習方針: 球速練習', { exact: false }).waitFor();
  await draft.page
    .getByText('編集中の内容（未保存）です。', { exact: false })
    .waitFor();
  await draft.page.reload();
  await click(draft.page, '手続き');
  await draft.page.getByText('練習方針: 球速練習', { exact: false }).waitFor();
  await draft.page.setViewportSize({ width: 1280, height: 844 });
  assert.equal(
    await draft.page.getByLabel('球団の主練習（全4回）').inputValue(),
    'velocity',
    '再読込・表示切替後も未保存案を復元',
  );
  draft.view.phase.id = '2:camp';
  draft.view.revision++;
  await click(draft.page, '更新');
  await draft.page.waitForFunction(
    () =>
      document.querySelector('.online-decision select')?.value === 'standard',
  );
  assert.equal(draft.payloads.length, 0, '復元するだけで自動送信しない');
  await draft.context.close();

  const lineupDraft = await scene();
  lineupDraft.page.on('dialog', (dialog) => dialog.accept());
  lineupDraft.view.phase = null;
  lineupDraft.view.status = 'running';
  const positions = [
    'catcher',
    'first',
    'second',
    'third',
    'short',
    'left',
    'center',
    'right',
  ];
  lineupDraft.view.roster = positions.map((position, i) => ({
    id: i + 1,
    name: `打者${i + 1}`,
    position,
    condition: 2,
  }));
  lineupDraft.view.lineup.battingOrder = positions.map((position, i) => ({
    playerId: i + 1,
    position,
    battingOrder: i + 1,
  }));
  await click(lineupDraft.page, '更新');
  await click(lineupDraft.page, '編成');
  await closeFullLineup(lineupDraft.page);
  await click(lineupDraft.page, '2番を上げる');
  await click(lineupDraft.page, '今日');
  await click(lineupDraft.page, '編成');
  await closeFullLineup(lineupDraft.page);
  assert.equal(
    await lineupDraft.page
      .getByLabel('1番の選手', { exact: true })
      .inputValue(),
    '2',
  );
  await lineupDraft.page.setViewportSize({ width: 390, height: 844 });
  await lineupDraft.page
    .getByRole('button', { name: '打者2の選手情報を見る', exact: true })
    .waitFor();
  await lineupDraft.page.reload();
  await click(lineupDraft.page, '打順');
  await lineupDraft.page.setViewportSize({ width: 1280, height: 844 });
  await closeFullLineup(lineupDraft.page);
  assert.equal(
    await lineupDraft.page
      .getByLabel('1番の選手', { exact: true })
      .inputValue(),
    '2',
    '編成もホーム移動・表示切替・再読込を通して保持',
  );
  await click(lineupDraft.page, '編集を戻す');
  assert.equal(
    await lineupDraft.page
      .getByLabel('1番の選手', { exact: true })
      .inputValue(),
    '1',
  );
  await lineupDraft.context.close();

  const retry = await scene({ defaultsFail: true });
  await click(retry.page, '手続き');
  await retry.page
    .getByRole('button', { name: '標準案を再取得', exact: true })
    .waitFor();
  retry.defaultsFail = 'html';
  await click(retry.page, '標準案を再取得');
  await retry.page
    .getByText(
      'サーバーの応答を確認できません。再読み込みして状態を確認してください',
      { exact: false },
    )
    .first()
    .waitFor();
  retry.defaultsFail = false;
  await click(retry.page, '標準案を再取得');
  await retry.page.getByLabel('球団の主練習（全4回）').waitFor();
  assert.equal(await retry.page.getByRole('alert').count(), 0);
  retry.hold = true;
  await retry.page
    .getByRole('button', { name: '下書きを保存', exact: true })
    .click();
  await withDeadline(retry.commandStarted, '提出保存の開始');
  assert.ok(
    await retry.page.getByLabel('球団の主練習（全4回）').isDisabled(),
    '提出の保存中は練習方針も変更できない',
  );
  retry.release();
  await retry.page.getByText('保存しました', { exact: true }).waitFor();
  assert.equal(await retry.page.locator('.online-edit-notice').count(), 0);
  await retry.context.close();

  const stale = await scene({ staleDefaults: true });
  await click(stale.page, '手続き');
  await stale.page
    .getByText('手続きが更新されました。最新状態を確認してください', {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await stale.page.locator('.online-decision select').count(),
    0,
    '別の手続きの標準案を表示しない',
  );
  stale.staleDefaults = false;
  stale.view.phase.id = '2:camp';
  stale.view.revision++;
  await click(stale.page, '更新');
  await stale.page.getByLabel('球団の主練習（全4回）').waitFor();
  await stale.context.close();

  const mobile = await scene({ mobile: true });
  await click(mobile.page, '手続き');
  await mobile.page
    .getByText('練習方針: 標準（投手は制球・野手は打撃）', { exact: false })
    .waitFor();
  mobile.view.phase.submission = { plan: { menu: 'velocity' }, ready: false };
  mobile.view.revision++;
  await click(mobile.page, '更新');
  await mobile.page.getByText('練習方針: 球速練習', { exact: false }).waitFor();
  await click(mobile.page, 'この内容で決定');
  assert.equal(mobile.payloads[0].plan.menu, 'velocity');
  assert.deepEqual(mobile.payloads[0].baseSubmission, {
    plan: { menu: 'velocity' },
    ready: false,
  });
  await mobile.context.close();

  const pages = await scene();
  pages.view.status = 'running';
  pages.view.phase = null;
  pages.view.roster = Array.from({ length: 21 }, (_, i) => ({
    id: i,
    name: `選手${i}`,
    age: 20,
    position: 'left',
    fatigue: 0,
  }));
  await click(pages.page, '更新');
  await click(pages.page, '選手');
  await click(pages.page, '次のページ');
  await click(pages.page, '次のページ');
  assert.equal(await pages.page.locator('tbody tr').count(), 1);
  pages.view.roster = pages.view.roster.slice(0, 4);
  pages.view.revision++;
  await click(pages.page, '更新');
  await pages.page.waitForFunction(
    () => document.querySelectorAll('tbody tr').length === 4,
  );
  assert.equal(
    (await pages.page.locator('.online-pager span').innerText()).trim(),
    '1 / 1',
  );
  await pages.context.close();

  const news = await scene({ mobile: true });
  news.view.phase = null;
  news.view.status = 'running';
  news.view.notices = Array.from({ length: 4 }, (_, n) => ({
    year: n + 1,
    type: 'tryout',
    picks: Array.from({ length: 24 }, (_, i) => ({
      name: `選手${i}`,
      round: i + 1,
      team: 'A',
    })),
  }));
  await click(news.page, '更新');
  await click(news.page, 'リーグ便り・過去のシーズン →');
  await news.page.getByLabel('見るお知らせ').selectOption('notice:3');
  await click(news.page, '次のページ');
  await click(news.page, '次のページ');
  news.view.notices = [news.view.notices[0]];
  news.view.notices[0].picks = news.view.notices[0].picks.slice(0, 1);
  news.view.revision++;
  await click(news.page, '更新');
  await news.page.waitForFunction(
    () => document.querySelectorAll('.online-news-list article').length === 1,
  );
  assert.equal(
    await news.page.getByLabel('見るお知らせ').inputValue(),
    'notice:0',
  );
  assert.equal(
    (await news.page.locator('.online-pager span').innerText()).trim(),
    '1 / 1',
  );
  assert.ok(
    await news.page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight * 1.3,
    ),
  );
  await news.context.close();
  assert.deepEqual(errors, []);
  console.log(
    'online-edit-ui-check PASS（配布HTML・標準案の再取得/世代検証・送信中入力・スマホ確認・一覧縮小 / APIはfixture）',
  );
} finally {
  await browser.close();
}
