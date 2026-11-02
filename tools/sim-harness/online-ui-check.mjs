import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { withDeadline } from './lib/deadline.mjs';
const base = process.env.ONLINE_TEST_URL || 'http://localhost:3000';
assert.ok(
  ['localhost', '127.0.0.1'].includes(new URL(base).hostname),
  'ローカル環境だけを検証する',
);
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROME_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHROME_CHANNEL }
    : {}),
  headless: true,
});
const errors = [];
try {
  const pc = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const other = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const p = await pc.newPage();
  const b = await other.newPage();
  const m = await phone.newPage();
  for (const page of [p, b, m])
    page.on('pageerror', (e) => errors.push(e.message));
  const waitIdle = async (page) => {
    await page
      .getByText('処理中です。画面を閉じずにお待ちください…')
      .waitFor({ state: 'hidden', timeout: 290000 });
  };
  const click = async (page, text) => {
    if (
      ['更新', 'ログアウト', '進行時刻'].includes(text) &&
      !(await page.getByRole('button', { name: text, exact: true }).count()) &&
      (await page
        .getByRole('button', { name: 'メニュー', exact: true })
        .count())
    )
      await page.getByRole('button', { name: 'メニュー', exact: true }).click();
    await page.getByRole('button', { name: text, exact: true }).click();
    await waitIdle(page);
    if (text === '編成') await onlinePanel(page);
  };
  // ⚠ 編成タブは一人用から移植した画面を既定で開く（画面を作り直すと開き直す）。
  //    この検査で見るのはオンライン側だけのパネル（方針・采配）なので、出ていたら閉じる
  const onlinePanel = async (page) => {
    const close = page.getByRole('button', {
      name: '方針・采配の設定へ（保存しない）',
      exact: true,
    });
    if (await close.count()) await close.click();
  };
  async function login(page, player) {
    await page.goto(`${base}/online`);
    await page.getByText('ローカル検証モード', { exact: false }).waitFor();
    await click(page, `プレイヤー${player}で入る`);
  }
  await p.goto(base);
  await p
    .getByRole('link', { name: 'オンラインペナント', exact: true })
    .waitFor();
  await login(p, 1);
  await p
    .getByRole('button', { name: 'リーグを作成', exact: true })
    .waitFor({ timeout: 30000 });
  await click(p, 'リーグを作成');
  await click(p, '手続き');
  await p
    .getByRole('button', { name: 'この内容で決定', exact: true })
    .waitFor();
  // ⚠ 初期編成は「希望リスト＋候補を探す」の2欄になった。候補が1行も出ない
  //    （＝選べない）状態で先へ進まないよう、両方が描けていることを見る
  await p.locator('.online-tryout-wanted .online-tryout-list li').first().waitFor();
  await p.locator('.online-tryout-pool .online-tryout-list li').first().waitFor();
  // ⚠ 希望リストの操作は**獲得予定を基準に**動くこと。以前は希望順の位置で
  //    動かしていて、初期編成（24人＝目標構成の合計ちょうど）では
  //    「指名に加える」が候補の約9割で何も起きず、「↓」で選手が消えたりした
  {
    const wantedNames = async () =>
      (
        await p
          .locator('.online-tryout-wanted > ol.online-tryout-list > li .online-tryout-person button')
          .allInnerTexts()
      ).map((s) => s.trim());
    const start = await wantedNames();
    await p
      .locator('.online-tryout-pool .online-segments button', { hasText: '投手' })
      .click();
    const row = p
      .locator('.online-tryout-pool .online-tryout-list li:not([data-wanted])')
      .first();
    const name = (
      await row.locator('.online-tryout-person button').first().innerText()
    ).trim();
    await row.getByRole('button', { name: '指名に加える', exact: true }).click();
    const added = await wantedNames();
    assert.ok(added.includes(name), '「指名に加える」で獲得予定に入らない');
    assert.equal(added.length, start.length, '指名で獲得予定の人数が変わった');
    assert.equal(
      (
        await p
          .locator('.online-tryout-pool .online-tryout-list li', { hasText: name })
          .locator('.online-tryout-mark')
          .innerText()
      ).trim(),
      `指名中 ${added.indexOf(name) + 1}位`,
      '「指名中 N位」が獲得予定の番号とずれる',
    );
    await p
      .getByRole('button', { name: `${added[0]}の希望順位を下げる`, exact: true })
      .click();
    const moved = await wantedNames();
    assert.equal(moved[1], added[0], '↓で1つ下がらない');
    assert.deepEqual([...moved].sort(), [...added].sort(), '↓で顔ぶれが変わった');
    await click(p, '標準案に戻す');
    assert.deepEqual(await wantedNames(), start, '標準案に戻らない');
    // 重視する能力の重みから、評価値の順でおすすめを作れる
    const scoresOf = async (selector) =>
      (await p.locator(`${selector} .online-tryout-score`).allInnerTexts()).map((t) =>
        Number(t.replace(/[^0-9]/g, '')),
      );
    await p.getByText('重視する能力（評価値の重み）', { exact: true }).click();
    await p.getByLabel('パワーの重み', { exact: true }).fill('5');
    await p.getByLabel('ミートの重み', { exact: true }).fill('0');
    await p
      .getByRole('button', { name: 'この重みでおすすめ順を作る', exact: true })
      .click();
    const weighted = await scoresOf('.online-tryout-wanted > ol.online-tryout-list');
    assert.equal(weighted.length, start.length, '重みのおすすめで獲得予定の人数が変わった');
    assert.ok(
      weighted.every((v, i) => i === 0 || weighted[i - 1] >= v),
      `獲得予定が評価の高い順になっていない: ${weighted.join(',')}`,
    );
    assert.notDeepEqual(await wantedNames(), start, '重みを変えてもおすすめが変わらない');
    const poolScores = await scoresOf('.online-tryout-pool .online-tryout-list');
    assert.ok(
      poolScores.every((v, i) => i === 0 || poolScores[i - 1] >= v),
      '候補が評価値の順に並んでいない',
    );
    await p.getByRole('button', { name: '重みを標準に戻す', exact: true }).click();
    await click(p, '標準案に戻す');
    assert.deepEqual(await wantedNames(), start, '標準案に戻らない');
    assert.equal(
      await p.getByText('おすすめ順を作り直しました', { exact: false }).count(),
      0,
      '標準案に戻したのに「作り直しました」が残っている',
    );
    await p
      .locator('.online-tryout-pool .online-segments button', { hasText: '全部' })
      .click();
  }
  await login(m, 2);
  // ⚠ 開発用サーバーの初期参加者は管理者1人だけ。プレイヤー2はログイン直後に
  //    参加画面が出るので、先に参加する（招待コードを廃止したときに取り残された）
  await m
    .getByLabel('球団名（空なら元の名前のまま）')
    .fill('検査ドリーマーズ');
  await click(m, '参加する');
  await m.setViewportSize({ width: 320, height: 640 });
  await click(m, '手続き');
  await m
    .getByRole('button', { name: 'この内容で決定', exact: true })
    .waitFor();
  const decisionBox = await m
    .getByRole('button', { name: 'この内容で決定', exact: true })
    .boundingBox();
  assert.ok(
    decisionBox.y >= 0 && decisionBox.y + decisionBox.height <= 640 - 48,
    '小さいスマホでも決定ボタンがスクロールせず押せる',
  );
  assert.ok(
    await m.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight * 1.3,
    ),
    '初期編成の確認も長いスクロールにしない',
  );
  await m.screenshot({
    path: '/tmp/baseball-online-mobile-decision.png',
    fullPage: true,
  });
  await click(m, 'ホーム');
  await click(m, 'ログアウト');
  await m.setViewportSize({ width: 390, height: 844 });

  const draftTab = await pc.newPage();
  draftTab.on('pageerror', (e) => errors.push(e.message));
  await draftTab.goto(`${base}/online`);
  await click(draftTab, '手続き');
  await draftTab.locator('input[type=number]').fill('23');
  await click(draftTab, '下書きを保存');
  await click(p, '更新');
  await click(p, '下書きを保存');
  await p
    .getByText(
      '保存済みの提出が更新されています。最新の提出を読み直してください',
      { exact: false },
    )
    .waitFor();
  await click(p, '最新の提出を読み直す');
  assert.equal(await p.locator('input[type=number]').inputValue(), '23');
  await p.locator('input[type=number]').fill('24');
  await click(p, '下書きを保存');
  assert.equal(
    await p.locator('.online-edit-notice').count(),
    0,
    'キー順が異なる自分の提出を競合と誤認しない',
  );
  await draftTab.close();
  await p.screenshot({
    path: '/tmp/baseball-online-desktop-tryout.png',
    fullPage: true,
  });
  await click(p, 'この内容で決定');
  await login(b, 2);
  await click(b, '手続き');
  await click(b, 'この内容で決定');
  await click(p, '更新');
  await click(p, 'この内容で決定');
  await click(b, '更新');
  await click(b, 'この内容で決定');
  await click(p, '更新');
  await click(p, '進行時刻');
  await p.getByRole('dialog', { name: '進行時刻', exact: true }).waitFor();
  await p.keyboard.press('Escape');
  await p
    .getByRole('dialog', { name: '進行時刻', exact: true })
    .waitFor({ state: 'hidden' });
  await click(p, '編成');
  await p.getByRole('heading', { name: '編成・采配', exact: true }).waitFor();
  // 数値選手IDを文字列へ変えずに保存できることを実画面から確認。
  const selects = p.locator('.online-lineup select');
  const first = await selects.nth(0).inputValue();
  const second = await selects.nth(1).inputValue();
  await selects.nth(0).selectOption(second);
  await selects.nth(1).selectOption(first);
  let releaseSave;
  let saveStarted;
  const savingStarted = new Promise((resolve) => {
    saveStarted = resolve;
  });
  await p.route('**/api/online?*', async (route) => {
    if (
      new URL(route.request().url()).searchParams.get('action') === 'command'
    ) {
      saveStarted();
      await new Promise((resolve) => {
        releaseSave = resolve;
      });
    }
    await route.continue();
  });
  await p.getByRole('button', { name: '編成を保存', exact: true }).click();
  await withDeadline(savingStarted, '編成保存の開始');
  assert.ok(
    await selects.nth(0).isDisabled(),
    '保存の応答待ち中は入力を変更できない',
  );
  releaseSave();
  await waitIdle(p);
  await p.unroute('**/api/online?*');
  assert.ok(await selects.nth(0).isEnabled());
  await p.getByText('保存しました', { exact: true }).waitFor();
  await p.screenshot({
    path: '/tmp/baseball-online-desktop.png',
    fullPage: true,
  });
  const lineupTab = await pc.newPage();
  lineupTab.on('pageerror', (e) => errors.push(e.message));
  await lineupTab.goto(`${base}/online`);
  await click(lineupTab, '編成');
  await onlinePanel(p);
  await p.getByRole('button', { name: '2番を上げる', exact: true }).click();
  await click(lineupTab, '基本方針');
  await lineupTab.getByLabel('打撃方針').selectOption('patient');
  await click(lineupTab, '編成を保存');
  await click(p, '更新');
  await click(p, '編成を保存');
  await p.getByText('編成が更新されています。', { exact: false }).waitFor();
  await click(p, '編集を戻す');
  await click(p, '基本方針');
  assert.equal(await p.getByLabel('打撃方針').inputValue(), 'patient');
  await click(p, '打順・守備');
  await lineupTab.close();
  await login(m, 1);
  await m.getByRole('button', { name: '打順', exact: true }).click();
  await m.getByRole('button', { name: '2番を上げる', exact: true }).click();
  await click(m, '編成を保存');
  assert.equal(
    await m.getByRole('heading', { name: '編成・采配', exact: true }).count(),
    0,
    'スマホでPC画面をマウントしない',
  );
  assert.ok(
    await m.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    '390pxで横にはみ出さない',
  );
  await m.screenshot({
    path: '/tmp/baseball-online-mobile-lineup.png',
    fullPage: true,
  });
  const saveBox = await m
    .getByRole('button', { name: '編成を保存', exact: true })
    .boundingBox();
  assert.ok(
    saveBox.y >= 0 && saveBox.y + saveBox.height <= 844 - 48,
    '打順の保存ボタンがスクロールせず押せる',
  );
  await click(p, '更新');
  await p
    .getByText('別の端末でログインしたため閲覧のみです。', { exact: false })
    .waitFor();
  await m.getByRole('button', { name: 'ホーム', exact: true }).click();
  await m.screenshot({
    path: '/tmp/baseball-online-mobile.png',
    fullPage: true,
  });
  // 別のプロフィールからログインし、実試合の結果が両端末へ届くことを確認。
  const admin = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const a = await admin.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  await login(a, 1);
  await click(a, '管理');
  // ⚠ ボタンの名前は「1ターン進める（ゲーム内1日）」（検証モードを足したときに変わった）
  for (let i = 0; i < 3; i++) await click(a, '1ターン進める（ゲーム内1日）');
  await click(m, '更新');
  await m.getByRole('button', { name: '試合', exact: true }).click();
  await m.locator('.online-score').first().waitFor();
  assert.ok(
    await m.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await m.screenshot({
    path: '/tmp/baseball-online-mobile-results.png',
    fullPage: true,
  });
  const boxResponse = m.waitForResponse(
    (response) => new URL(response.url()).searchParams.get('action') === 'game',
  );
  await m
    .getByRole('button', { name: /の試合成績$/ })
    .first()
    .click();
  const boxData = await (await boxResponse).json();
  assert.ok(
    boxData.teams?.[boxData.home]?.length > 0,
    '実試合から保存された個人成績を取得',
  );
  const box = m.getByRole('dialog', { name: '試合成績', exact: true });
  await box.locator('tbody tr').first().waitFor();
  await box
    .getByRole('button', { name: '試合成績を閉じる', exact: true })
    .click();
  const historyResponse = m.waitForResponse(
    (response) =>
      new URL(response.url()).searchParams.get('action') === 'games',
  );
  await click(m, '過去の試合・個人成績');
  assert.ok((await (await historyResponse).json()).count > 0);
  await m
    .getByRole('button', { name: '試合記録を閉じる', exact: true })
    .click();
  await click(m, 'ホーム');
  await click(m, '選手成績');
  const playerResponse = m.waitForResponse(
    (response) =>
      new URL(response.url()).searchParams.get('action') === 'player',
  );
  await m.locator('.online-roster-row').first().click();
  const playerData = await (await playerResponse).json();
  assert.ok(
    playerData.periods.find((period) => period.id === 'current')?.seasonStats
      ?.batting?.measured,
    '実APIの対人記録と期間を閲覧',
  );
  const playerDialog = m.getByRole('dialog');
  await playerDialog
    .getByRole('button', { name: '場面別', exact: true })
    .click();
  await playerDialog
    .getByRole('button', { name: '選手成績を閉じる', exact: true })
    .click();
  // 同じoriginでも一人用の保存キーへ書き込まない。
  assert.deepEqual(await m.evaluate(() => Object.keys(localStorage)), [
    'baseball-online-auth-v1',
  ]);
  for (const width of [320, 375, 430, 767]) {
    await m.setViewportSize({ width, height: 844 });
    for (const tab of ['ホーム', '試合', '打順', '手続き']) {
      await click(m, 'ホーム');
      if (tab !== 'ホーム') await click(m, tab);
      const metrics = await m.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        viewport: innerHeight,
        viewportWidth: innerWidth,
      }));
      assert.ok(
        metrics.width <= metrics.viewportWidth,
        `${width}px ${tab}で横にはみ出さない`,
      );
      assert.ok(
        metrics.height <= metrics.viewport * 1.3,
        `${width}px ${tab}で長いスクロールを要求しない: ${JSON.stringify(metrics)}`,
      );
    }
  }
  await m.setViewportSize({ width: 390, height: 844 });
  await click(m, 'ホーム');
  await m
    .getByRole('button', { name: 'リーグ便り・過去のシーズン →', exact: true })
    .click();
  assert.ok((await m.locator('.online-news-list article').count()) <= 8);
  assert.ok(
    await m.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight * 1.3,
    ),
    '96人のトライアウト結果も1行8件ずつ表示する',
  );
  await m.screenshot({
    path: '/tmp/baseball-online-mobile-news.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'online-ui-check PASS（PC2人・別スマホ・編成保存・端末交代・実試合結果・320〜767px / Chrome実操作）',
  );
} finally {
  await browser.close();
}
