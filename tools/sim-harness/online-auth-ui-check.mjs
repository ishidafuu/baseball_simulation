// 実React画面の認証競合を検査する。Auth/APIはfixtureで、実Supabase受入とは分ける。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { withDeadline } from './lib/deadline.mjs';
const html = await readFile(
  new URL('../../dist/index.html', import.meta.url),
  'utf8',
);
const base = 'http://localhost:3000';
const key = 'baseball-online-auth-v1';
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROME_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHROME_CHANNEL }
    : {}),
  headless: true,
});
const errors = [];
async function fixture({
  expired = false,
  hold = true,
  commands = false,
} = {}) {
  const old = {
    userId: 'a',
    sessionId: 'old-session',
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: Date.now() + (expired ? -1000 : 60000),
  };
  const context = await browser.newContext();
  await context.addInitScript(
    ({ key, auth }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(auth));
    },
    { key, auth: old },
  );
  let release = () => {};
  let refreshes = 0;
  let logouts = 0;
  let commandCount = 0;
  const views = [];
  const gameView = {
    revision: 1,
    status: 'running',
    teamName: '検証球団',
    year: 1,
    currentDate: { year: 2024, month: 4, day: 1 },
    nextAdvanceAt: '2026-10-28T04:00:00Z',
    isAdmin: true,
    writable: true,
    hasBackup: false,
    members: [],
    roster: [],
    standings: [],
    results: [],
    upcoming: [],
    notices: [],
    history: [],
    phase: null,
    lineup: { battingOrder: [], starters: [], strategy: {} },
  };
  let commandRequested;
  const commandStarted = new Promise((resolve) => {
    commandRequested = resolve;
  });
  let releaseCommand = () => {};

  let requested;
  const requestStarted = new Promise((resolve) => {
    requested = resolve;
  });
  let finished;
  const refreshFinished = new Promise((resolve) => {
    finished = resolve;
  });
  await context.route(`${base}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() === 'document')
      return route.fulfill({
        contentType: 'text/html',
        body:
          url.pathname === '/online'
            ? html
            : '<html><body>switch</body></html>',
      });
    const action = url.searchParams.get('action');
    let value;
    if (action === 'config') value = { local: false };
    else if (action === 'view') {
      views.push(route.request().headers().authorization);
      value = commands ? gameView : { setupRequired: true, isAdmin: false };
    } else if (action === 'logout') {
      logouts++;
      value = { ok: true };
    } else if (action === 'command' && commands) {
      commandCount++;
      commandRequested();
      await new Promise((resolve) => {
        releaseCommand = resolve;
      });
      gameView.status = 'paused';
      gameView.revision++;
      gameView.nextAdvanceAt = null;
      value = { ok: true, revision: gameView.revision };
    } else if (action === 'refresh') {
      refreshes++;
      requested();
      if (hold)
        await new Promise((resolve) => {
          release = resolve;
        });
      value = {
        userId: 'a',
        accessToken: 'renewed-access',
        refreshToken: 'renewed-refresh',
        expiresAt: Date.now() + 3600000,
      };
    } else throw new Error(`unexpected action ${action}`);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(value),
    });
    if (action === 'refresh') finished();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/online`);
  await withDeadline(requestStarted, '認証更新の開始');
  return {
    context,
    page,
    old,
    release: () => release(),
    refreshFinished,
    commandStarted,
    releaseCommand: () => releaseCommand(),
    refreshes: () => refreshes,
    logouts: () => logouts,
    commandCount: () => commandCount,
    views,
  };
}
try {
  const reconnect = await browser.newContext();
  let healthy = false;
  await reconnect.route(`${base}/**`, (route) =>
    route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: html })
      : route.fulfill({
          status: healthy ? 200 : 503,
          contentType: 'application/json',
          body: JSON.stringify(
            healthy ? { local: false } : { error: '一時的な接続失敗' },
          ),
        }),
  );
  const retryPage = await reconnect.newPage();
  retryPage.on('pageerror', (e) => errors.push(e.message));
  await retryPage.goto(`${base}/online`);
  await retryPage
    .getByRole('button', { name: '接続を再確認', exact: true })
    .waitFor();
  healthy = true;
  await retryPage
    .getByRole('button', { name: '接続を再確認', exact: true })
    .click();
  await retryPage.getByLabel('メールアドレス').waitFor();
  assert.equal(
    await retryPage.getByRole('alert').count(),
    0,
    '未ログインの接続失敗から画面内で復帰できる',
  );
  await reconnect.close();
  const logout = await fixture();
  await logout.page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
  assert.equal(logout.refreshes(), 1, '同じ端末で認証更新を重複実行しない');
  await logout.page
    .getByRole('button', { name: 'ログアウト', exact: true })
    .click();
  await logout.page.getByLabel('メールアドレス').waitFor();
  logout.release();
  await withDeadline(logout.refreshFinished, 'ログアウト中の認証更新');
  await logout.page.waitForLoadState('networkidle');
  await logout.page.waitForFunction(
    (key) => localStorage.getItem(key) === null,
    key,
  );
  assert.equal(logout.logouts(), 1);
  assert.ok(
    await logout.page.getByLabel('メールアドレス').isVisible(),
    '遅い更新応答でログイン画面から戻らない',
  );
  await logout.context.close();

  const tabs = await fixture();
  const newer = {
    ...tabs.old,
    sessionId: 'new-session',
    accessToken: 'new-access',
    refreshToken: 'new-refresh',
  };
  const other = await tabs.context.newPage();
  await other.goto(`${base}/switch`);
  await other.evaluate(
    ({ key, auth }) => localStorage.setItem(key, JSON.stringify(auth)),
    { key, auth: newer },
  );
  tabs.release();
  await withDeadline(tabs.refreshFinished, '別タブの認証更新');
  await tabs.page.waitForLoadState('networkidle');
  assert.equal(
    await tabs.page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).sessionId,
      key,
    ),
    'new-session',
    '古いタブの更新で新しいログインを巻き戻さない',
  );
  await tabs.context.close();

  const switched = await fixture({ commands: true });
  await switched.page
    .getByRole('button', { name: '管理', exact: true })
    .click();
  const switchTab = await switched.context.newPage();
  await switchTab.goto(`${base}/switch`);
  await switchTab.evaluate(
    ({ key, auth }) => localStorage.setItem(key, JSON.stringify(auth)),
    {
      key,
      auth: {
        ...switched.old,
        userId: 'b',
        sessionId: 'other-user',
        accessToken: 'other-access',
      },
    },
  );
  await switched.page
    .getByText(
      '別の端末でログインしたため閲覧のみです。操作するにはログインし直してください。',
      { exact: true },
    )
    .waitFor();
  const nextView = switched.page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get('action') === 'view',
  );
  await switched.page.bringToFront();
  await switched.page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
  await nextView;
  switched.release();
  await withDeadline(switched.refreshFinished, '交代後の古い認証更新');
  await switched.page.waitForLoadState('networkidle');
  assert.ok(
    await switched.page
      .getByRole('button', { name: '進行を停止', exact: true })
      .isDisabled(),
    '別アカウントへの交代後も再取得で旧タブの操作権限を復活させない',
  );
  await switched.context.close();

  const staleClick = await fixture({ commands: true });
  await staleClick.page
    .getByRole('button', { name: '管理', exact: true })
    .click();
  await staleClick.page.evaluate(
    ({ key, auth }) => {
      // storageイベントで画面が無効化されるより先に操作した場合も送信しない。
      localStorage.setItem(
        key,
        JSON.stringify({ ...auth, userId: 'b', sessionId: 'other-user' }),
      );
      [...document.querySelectorAll('button')]
        .find((button) => button.textContent === '進行を停止')
        .click();
    },
    { key, auth: staleClick.old },
  );
  staleClick.release();
  await withDeadline(staleClick.refreshFinished, '送信拒否後の古い認証更新');
  await staleClick.page
    .getByRole('alert')
    .filter({
      hasText:
        '別のタブでログインが変更されました。操作するにはログインし直してください。',
    })
    .waitFor();
  assert.equal(
    staleClick.commandCount(),
    0,
    '表示更新より早いクリックでも旧資格情報で送信しない',
  );
  await staleClick.context.close();

  const saving = await fixture({ commands: true });
  await saving.page.getByRole('button', { name: '管理', exact: true }).click();
  await saving.page
    .getByRole('button', { name: '進行を停止', exact: true })
    .click();
  await withDeadline(saving.commandStarted, '操作の開始');
  saving.release();
  await withDeadline(saving.refreshFinished, '操作中の認証更新');
  await saving.page.waitForFunction(
    (key) =>
      JSON.parse(localStorage.getItem(key)).accessToken === 'renewed-access',
    key,
  );
  saving.releaseCommand();
  await saving.page
    .getByRole('button', { name: '次の時刻から再開', exact: true })
    .waitFor();
  await saving.page.getByText('一時停止', { exact: true }).waitFor();
  assert.equal(
    saving.views.at(-1),
    'Bearer renewed-access',
    '操作中の認証更新でも最新状態を取り直す',
  );
  await saving.context.close();

  const expired = await fixture({ expired: true, hold: false });
  await expired.page
    .getByText('管理者がリーグを作成するまでお待ちください。', {
      exact: true,
    })
    .waitFor();
  assert.equal(expired.refreshes(), 1);
  assert.ok(
    expired.views.length > 0 &&
      expired.views.every((header) => header === 'Bearer renewed-access'),
    '期限切れ復帰時は更新後のトークンで状態を取得する',
  );
  assert.equal(await expired.page.getByRole('alert').count(), 0);
  await expired.context.close();
  assert.deepEqual(errors, []);
  console.log(
    'online-auth-ui-check PASS（配布HTML・ログアウト中の遅延更新・別タブログイン・期限切れ復帰 / Authはfixture）',
  );
} finally {
  await browser.close();
}
