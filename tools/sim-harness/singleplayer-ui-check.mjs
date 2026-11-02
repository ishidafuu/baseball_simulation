// 一人用の通し検査（ブラウザ）。`npm run check:ui`（ビルドしてから実行）。
//
//   大学野球で新しく始める → 春のキャンプ → 開幕 → 30日早送り → 保存して読み直す
//   → 次の区切り（夏季合宿）→ 合宿 → 秋季リーグ → 次の区切り（ドラフト前のフェーズ移行）
//   → ドラフト会議の画面が出る
//
// 画面が真っ白になる・ボタンが反応しない・ページの例外、を遊ぶ前に捕まえるのが目的。
// 成績の数字の妥当性は season-check などのハーネスが見るので、ここでは見ない。
//
// `--scenes` を付けると、途中の区切りごとにブラウザの保存領域を
// tools/scenes/<名前>.json に書き出す（git には入れない）。
// `npm run scene -- <名前>` でその場面からブラウザを開ける。
//
// 所要時間は約2分。スクリーンショットは /tmp/baseball-single-*.png に残す。
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { driver, launchBrowser, root, startPreview } from './lib/singleplayer.mjs';

const writeScenes = process.argv.includes('--scenes');
const sceneDir = join(root, 'tools', 'scenes');
if (writeScenes) mkdirSync(sceneDir, { recursive: true });

const stopPreview = await startPreview();
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// 確認ダイアログ（上書き保存など）は「はい」で進める。alert はそのまま記録する
page.on('dialog', async (d) => {
  if (d.type() === 'alert') errors.push(`alert: ${d.message()}`);
  await d.accept();
});

const ui = driver(page);
const shot = (name) => page.screenshot({ path: `/tmp/baseball-single-${name}.png` });
const scene = async (name, note) => {
  if (!writeScenes) return;
  await ui.saveToSlot1();
  await context.storageState({ path: join(sceneDir, `${name}.json`), indexedDB: true });
  console.log(`  場面 ${name}: ${note}`);
};
const step = (label) => console.log(`- ${label}`);
const started = Date.now();

try {
  step('新しく始めて開幕まで');
  await ui.newUniversityGame();
  const opening = await ui.date();
  assert.ok(opening, '日付が画面に出ていない');
  await shot('opening');
  await scene('season-start', '大学1年目の開幕日');

  step('30日早送り');
  await ui.advance(30);
  const after30 = await ui.date();
  assert.ok(after30, '早送りのあと日付が読めない');
  assert.notDeepEqual(after30, opening, '早送りしても日付が動いていない');
  await shot('day30');
  await scene('mid-season', '開幕から30日ほど進めた日');

  step('保存して、タイトルから読み直す');
  await ui.saveToSlot1();
  await ui.continueSlot1();
  assert.deepEqual(await ui.date(), after30, '読み直したら日付が変わった');

  step('次の区切り（夏季合宿）まで');
  await ui.advance('phase');
  assert.ok(await ui.visible('練習を実行'), '夏季合宿の画面が出ていない');
  await shot('summer-camp');

  step('合宿を済ませて秋季リーグへ');
  await ui.runCamp();
  await ui.click('秋季リーグへ');
  await scene('autumn-league', '秋季リーグの開幕');

  step('次の区切り（ドラフト前）まで');
  await ui.advance('phase');
  assert.ok(await ui.visible(/^進む$/), 'フェーズ移行の確認が出ていない');
  await shot('before-draft');
  if (writeScenes) {
    // 確認を閉じて保存する。読み直すと同じ確認がもう一度出る
    await ui.click('キャンセル');
    await scene('before-draft', 'ドラフト会議の前日（フェーズ移行の確認が出る）');
    await ui.click('1日進める');
  }
  await ui.click(/^進む$/);
  await page.getByText('プロ野球ドラフト会議').first().waitFor({ timeout: 60000 });
  await shot('draft');

  assert.deepEqual(errors, [], `画面でエラーが出た:\n${errors.join('\n')}`);
  console.log(`singleplayer-ui-check PASS（${((Date.now() - started) / 1000).toFixed(0)}秒・開幕→30日→保存と読み直し→夏季合宿→秋季リーグ→ドラフト会議）`);
  await context.tracing.stop();
} catch (error) {
  await shot('failure').catch(() => {});
  await context.tracing.stop({ path: '/tmp/baseball-single-failure.zip' }).catch(() => {});
  console.error(`singleplayer-ui-check FAIL: ${error.message}`);
  if (errors.length) console.error(errors.join('\n'));
  console.error(`画面: /tmp/baseball-single-failure.png / 操作の記録: /tmp/baseball-single-failure.zip（npx playwright show-trace で開く）`);
  process.exitCode = 1;
} finally {
  await browser.close();
  stopPreview();
}
