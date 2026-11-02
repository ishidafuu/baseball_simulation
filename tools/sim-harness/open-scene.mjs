// 書き出しておいた場面から、ブラウザを開いて続きを遊べるようにする。
//
//   npm run scenes                 # 場面を作る（約2分。tools/scenes/ に書き出す）
//   npm run scene -- before-draft  # その場面でブラウザを開く（ビルド済みの dist/ を使う）
//   npm run scene                  # 作ってある場面の一覧
//
// 場面はブラウザの保存領域（IndexedDB）をまるごと写したもの。セーブの形を変えたら
// 作り直すこと（古い場面は読み込みで弾かれるか、移行を通って開く）。
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { driver, launchBrowser, root, startPreview } from './lib/singleplayer.mjs';

const dir = join(root, 'tools', 'scenes');
const headless = process.argv.includes('--headless'); // 開けるかだけ確かめる（日付を出して終わる）
const name = process.argv.slice(2).find((a) => !a.startsWith('--'));
const available = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
if (!name || !available.includes(name)) {
  if (name) console.error(`場面 "${name}" がありません。`);
  console.log(available.length ? `作ってある場面: ${available.join(', ')}` : '場面がありません。先に `npm run scenes` を実行してください。');
  process.exit(name ? 1 : 0);
}

const stopPreview = await startPreview();
const browser = await launchBrowser({ headless });
const context = await browser.newContext({ storageState: join(dir, `${name}.json`), viewport: null });
const page = await context.newPage();
page.on('dialog', (d) => d.accept());
const ui = driver(page);
await ui.continueSlot1();
const date = await ui.date();
if (headless) {
  console.log(date ? `場面 ${name}: ${date.year}年目 ${date.month}月${date.day}日` : `場面 ${name}: 日付が読めない`);
  await browser.close();
  stopPreview();
  process.exit(date ? 0 : 1);
}
console.log(`場面 ${name} を開きました。ブラウザを閉じると終わります。`);
await new Promise((resolve) => browser.on('disconnected', resolve));
stopPreview();
