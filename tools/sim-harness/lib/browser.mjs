// ============================================================
// 画面検査のブラウザの起動と、配布HTML（dist/index.html）の読み込み。
//
// - ブラウザは Playwright のものを使う。別のものを使うときは
//   `PLAYWRIGHT_CHROME_CHANNEL`（chrome など、入っている Chrome の版）か
//   `PW_CHROMIUM`（実行ファイルの場所）を指定する。
// ⚠ 検査ごとに起動の書き方を写さない。以前は写しのうち2本が環境変数を見ておらず、
//    手元で版の合わないブラウザしか無いときにその2本だけ起動できなかった。
// ============================================================
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

/** オンラインの新しい見た目の入／切の鍵（`src/online/look/LookContext.jsx` の `LOOK_KEY` と同じ） */
export const LOOK_KEY = 'baseball-online-look-v1';

/**
 * ブラウザを開く（既定は画面なし）。`PLAYWRIGHT_CHROME_CHANNEL` と `PW_CHROMIUM` を見る。
 *
 * ⚠ **作る文脈（`newContext`）は、見た目の鍵が無ければ 'old'（切）を置いてから開く**。
 *    オンラインの新しい見た目は既定が入になった（2026-11-28）が、画面の検査は「切」の画面を
 *    確かめる前提で書いてある。ここで切に揃えないと、全部の検査が黙って入の画面を見ることになる。
 *    - 入で確かめたい検査は、これまでどおり自分で `addInitScript` で 'new' を置けばよい
 *      （こちらの印は「鍵が無いときだけ」置くので、後から置いた 'new' が勝つ。ページを移っても同じ）
 *    - **既定の入**を確かめたいときは `newContext({ lookDefault: true })` で開く（鍵を置かない）
 */
export async function launchBrowser({ headless = true } = {}) {
  const options = { headless };
  if (process.env.PLAYWRIGHT_CHROME_CHANNEL) options.channel = process.env.PLAYWRIGHT_CHROME_CHANNEL;
  if (process.env.PW_CHROMIUM) options.executablePath = process.env.PW_CHROMIUM;
  const browser = await chromium.launch(options);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (contextOptions = {}) => {
    const { lookDefault = false, ...rest } = contextOptions;
    const context = await newContext(rest);
    if (!lookDefault)
      await context.addInitScript((key) => {
        try {
          if (localStorage.getItem(key) == null) localStorage.setItem(key, 'old');
        } catch {
          // 保存の使えないページ（about:blank など）では何もしない
        }
      }, LOOK_KEY);
    return context;
  };
  return browser;
}

/** 配布HTML（先に `npm run build`）の中身 */
export function distHtml() {
  return readFile(new URL('../../../dist/index.html', import.meta.url), 'utf8');
}
