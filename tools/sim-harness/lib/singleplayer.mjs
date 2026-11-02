// 一人用の画面を Playwright で動かすための道具（singleplayer-ui-check と open-scene が使う）。
//
// - 配布用のビルド（dist/）を `vite preview` で配る。開発サーバーは StrictMode で
//   effect を2回走らせるので、成績の数え方が本番と変わる（CLAUDE.md 参照）。
// - URL に `?dev=1` を付けて、開発用の早送り（src/game/devTools.js）を出す。
// - ブラウザは Playwright のものを使う。別の場所の Chromium を使うときは
//   PW_CHROMIUM にその実行ファイルを指定する。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PORT = Number(process.env.SINGLE_TEST_PORT || 4173);
export const BASE = `http://127.0.0.1:${PORT}`;

export async function startPreview() {
  if (!existsSync(join(root, 'dist', 'index.html')))
    throw new Error('dist/index.html がありません。先に `npm run build` を実行してください');
  const child = spawn(
    process.execPath,
    [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } },
  );
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`vite preview が起動しませんでした\n${log}`);
    try {
      const res = await fetch(BASE);
      if (res.ok) return () => child.kill();
    } catch {
      // まだ起動中
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`vite preview が応答しません\n${log}`);
}

export async function launchBrowser({ headless = true } = {}) {
  const options = { headless };
  if (process.env.PW_CHROMIUM) options.executablePath = process.env.PW_CHROMIUM;
  return chromium.launch(options);
}

// 画面の操作。押せるボタンの名前で探す（文言が変わったらここを直す）。
export function driver(page) {
  const btn = (name) => page.getByRole('button', { name: typeof name === 'string' ? new RegExp(name) : name });
  const visible = async (name) => (await btn(name).count()) > 0;
  const dismissHint = async () => {
    const hint = btn('ヒントを今後表示しない');
    if (await hint.count()) await hint.first().click();
  };
  const click = async (name) => {
    await dismissHint();
    await btn(name).first().click();
    await page.waitForTimeout(250);
  };
  const devIdle = () =>
    page.waitForFunction(
      () => !document.querySelector('[data-testid=dev-advance]')?.textContent.includes('残り'),
      null,
      { timeout: 10 * 60 * 1000 },
    );
  return {
    btn,
    visible,
    click,
    // 画面に出ている日付（サイドバーの「1年目 | 2024/10/24」）
    async date() {
      const text = await page.locator('body').innerText();
      const m = text.match(/(\d+)年目\s*[|｜]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      return m ? { year: Number(m[1]), y: Number(m[2]), month: Number(m[3]), day: Number(m[4]) } : null;
    },
    // 大学野球（東京六大学・法政大学）で新しく始めて、キャンプを済ませ、開幕日に立つ
    async newUniversityGame() {
      await page.goto(`${BASE}/?dev=1`);
      for (const t of ['はじめから', '大学野球', '東京六大学野球リーグ', '法政大学', '法政大学で始める']) await click(t);
      await this.runCamp();
      await click('シーズン開始');
      await click('全て自動割り当て');
      await click('確定してシーズン開始');
      await page.getByTestId('dev-advance').waitFor();
    },
    // キャンプ・合宿: 各クールの練習を実行して終える
    async runCamp() {
      for (let i = 0; i < 12; i++) {
        await click('練習を実行');
        if (!(await visible('次のクールへ'))) break;
        await click('次のクールへ');
      }
      await click('キャンプ終了');
      const confirm = page.getByRole('button', { name: 'キャンプ終了', exact: true });
      if (await confirm.count()) await confirm.click();
      await page.waitForTimeout(500);
    },
    // 開発用の早送り。days は 7 / 30 / 'phase'（次の区切りまで）
    async advance(days) {
      await dismissHint();
      await page.getByTestId(`dev-advance-${days}`).click();
      await devIdle();
    },
    // セーブ＆ロード画面でスロット1に保存し、日程進行へ戻る
    async saveToSlot1() {
      await click('セーブ＆ロード');
      await btn(/新規保存|上書き保存/).first().click();
      await page.waitForFunction(() => !document.body.innerText.includes('セーブ中'), null, { timeout: 120000 });
      await click('日程進行');
    },
    // タイトルの「つづきから」でスロット1を開く
    async continueSlot1() {
      await page.goto(`${BASE}/?dev=1`);
      await click('つづきから');
      const slot = page.getByRole('button', { name: /スロット\s*1/ });
      if (await slot.count()) await slot.first().click();
      // 読み込みは数秒かかる（世界まるごと展開する）。サイドバーに日付が出るまで待つ
      await page.waitForFunction(() => /\d+年目\s*[|｜]\s*\d{4}\//.test(document.body.innerText), null, { timeout: 120000 });
    },
  };
}
