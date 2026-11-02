// 配布HTMLでの読み込み失敗・状態の切替・保存中入力。APIはfixture。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { withDeadline } from './lib/deadline.mjs';
// ⚠ キャンプの主練習は2026-11からカード（role=radio）で選ぶ（以前はセレクト）
const campGroup = (page) => page.getByRole('radiogroup', { name: '主練習', exact: true });
const pickCamp = (page, label) =>
  campGroup(page).getByRole('radio', { name: new RegExp(`^${label}`) }).click();
const campValue = async (page) =>
  (await campGroup(page).locator('[aria-checked="true"] b').innerText()).trim();
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
      // 打順は手続きが無くても自動で保存される（2026-11）
      if (payload.battingOrder) {
        const { baseLineup, ...lineup } = payload;
        state.view.lineup = { ...state.view.lineup, ...lineup };
      } else
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
  // 2026-11 の作り直しで名前が変わったボタン（PCは左ナビ、スマホは☰メニューの中）
  text = { 更新: '最新の状態に更新', 進行時刻: '進行のしくみ' }[text] || text;
  // 画面幅を変えた直後は描き直しの途中なので、ボタンが出るのを少し待ってから判断する
  if (
    ['最新の状態に更新', 'ログアウト', '進行のしくみ', 'リーグ便り'].includes(text) &&
    !(await page
      .getByRole('button', { name: text, exact: true })
      .first()
      .waitFor({ timeout: 1500 })
      .then(() => true)
      .catch(() => false))
  )
    await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: text, exact: true }).click();
  // ⚠ 操作中は上端の細い進捗バーだけを出す（画面全体は止めない）
  await page.waitForTimeout(150);
  await page.locator('.online-progress').waitFor({ state: 'hidden' });
}
try {
  const oversized = await scene();
  await click(oversized.page, '手続き');
  await campGroup(oversized.page).waitFor();
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
  await pickCamp(draft.page, '球速練習');
  await click(draft.page, '今日');
  await click(draft.page, '手続き');
  assert.equal(await campValue(draft.page), '球速練習', '画面移動でも提出案を保持');
  // スマホ幅でも同じ画面で、未保存であることが分かる
  await draft.page.setViewportSize({ width: 390, height: 844 });
  await draft.page.getByText('● 未保存の変更があります', { exact: true }).waitFor();
  await draft.page.reload();
  await click(draft.page, '手続き');
  assert.equal(await campValue(draft.page), '球速練習');
  await draft.page.setViewportSize({ width: 1280, height: 844 });
  assert.equal(
    await campValue(draft.page),
    '球速練習',
    '再読込・表示切替後も未保存案を復元',
  );
  draft.view.phase.id = '2:camp';
  draft.view.revision++;
  await click(draft.page, '更新');
  await draft.page.waitForFunction(() =>
    document
      .querySelector('.online-camp-card[aria-checked="true"] b')
      ?.textContent.startsWith('標準'),
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
  // ⚠ 打順は**自動で保存する**（2026-11。以前は「編成を保存」を押すまで下書きのまま）。
  //    ↑を押すと1.2秒後に送られ、通知の「元に戻す」で戻せる
  const firstBatter = () =>
    lineupDraft.page
      .locator('.online-order-list.is-batting li .online-order-main')
      .first()
      .innerText();
  await lineupDraft.page.getByRole('button', { name: '2番を上げる', exact: true }).click();
  await lineupDraft.page
    .locator('.online-save-state', { hasText: '保存済み' })
    .waitFor({ timeout: 10000 });
  const saved = lineupDraft.payloads.at(-1);
  assert.equal(
    saved.battingOrder.find((e) => e.battingOrder === 1).playerId,
    2,
    '↑で打者2が1番になって保存される',
  );
  await click(lineupDraft.page, '今日');
  await click(lineupDraft.page, '編成');
  assert.match(await firstBatter(), /打者2/, '画面を移っても保存済みの打順');
  await lineupDraft.page.setViewportSize({ width: 390, height: 844 });
  await lineupDraft.page.reload();
  await lineupDraft.page.getByRole('button', { name: '編成', exact: true }).click();
  assert.match(await firstBatter(), /打者2/, 'スマホ幅・再読込でも同じ打順');
  await lineupDraft.page.getByRole('button', { name: '2番を上げる', exact: true }).click();
  await lineupDraft.page.getByRole('button', { name: '元に戻す', exact: true }).waitFor({ timeout: 10000 });
  await lineupDraft.page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await lineupDraft.page
    .locator('.online-save-state', { hasText: '保存済み' })
    .waitFor({ timeout: 10000 });
  await lineupDraft.page.waitForTimeout(1500);
  assert.match(await firstBatter(), /打者2/, '「元に戻す」で1つ前の打順に戻る');
  assert.equal(
    lineupDraft.view.lineup.battingOrder.find((e) => e.battingOrder === 1).playerId,
    2,
    '「元に戻す」もサーバーへ保存される',
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
  await campGroup(retry.page).waitFor();
  assert.equal(await retry.page.getByRole('alert').count(), 0);
  retry.hold = true;
  await pickCamp(retry.page, '打撃練習');
  await retry.page
    .getByRole('button', { name: '下書きを保存', exact: true })
    .click();
  await withDeadline(retry.commandStarted, '提出保存の開始');
  assert.ok(
    await campGroup(retry.page).getByRole('radio').first().isDisabled(),
    '提出の保存中は練習方針も変更できない',
  );
  retry.release();
  await retry.page.getByText('キャンプの下書きを保存しました', { exact: true }).waitFor();
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
    await campGroup(stale.page).count(),
    0,
    '別の手続きの標準案を表示しない',
  );
  stale.staleDefaults = false;
  stale.view.phase.id = '2:camp';
  stale.view.revision++;
  await click(stale.page, '更新');
  await campGroup(stale.page).waitFor();
  await stale.context.close();

  const mobile = await scene({ mobile: true });
  await click(mobile.page, '手続き');
  // ⚠ スマホでもPCと同じカードで選べる（以前は「練習方針: …」と出すだけで変えられなかった）
  await campGroup(mobile.page).waitFor();
  assert.ok((await campValue(mobile.page)).startsWith('標準'));
  mobile.view.phase.submission = { plan: { menu: 'velocity' }, ready: false };
  mobile.view.revision++;
  await click(mobile.page, '更新');
  await mobile.page.waitForFunction(
    () =>
      document.querySelector('.online-camp-card[aria-checked="true"] b')
        ?.textContent === '球速練習',
  );
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
  // ⚠ 選手一覧は2026-11からページ送りをやめ、野手・投手を1枚の表に並べる
  //    （21人程度なら送るより見渡せる方がよい）。人数が減ったら表も縮むことを見る
  await pages.page.waitForFunction(
    () => document.querySelectorAll('tbody tr').length === 21,
  );
  pages.view.roster = pages.view.roster.slice(0, 4);
  pages.view.revision++;
  await click(pages.page, '更新');
  await pages.page.waitForFunction(
    () => document.querySelectorAll('tbody tr').length === 4,
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
  await click(news.page, 'リーグ便り');
  // 便りが5件以下ならボタンで並べる（6件以上はセレクト）
  await news.page
    .getByRole('group', { name: '表示する便り', exact: true })
    .getByRole('button', { name: '4年 トライアウト', exact: true })
    .click();
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
    await news.page
      .getByRole('group', { name: '表示する便り', exact: true })
      .locator('[aria-pressed="true"]')
      .innerText(),
    '1年 初期編成',
  );
  // 1ページに収まるときはページ送り自体を出さない
  assert.equal(await news.page.locator('.online-pager').count(), 0);
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
