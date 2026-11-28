// 新しい見た目（試作）の画面検査。配布HTML（dist/index.html）を開く。サーバー不要（先に vite build）。
//   npm run check:online:look-ui
//
// 見ること:
//   - 既定は切。切のときは絵（`.online-look-art`）を1つも描かず、調子は今までの絵文字のまま
//   - PC の見出しの「新しい見た目（試作）」で入にすると、順位表・左メニューに球団マーク、
//     スタメン設定に選手の顔、選手の詳細に顔と段位の字、調子は自前の顔になる
//   - 入／切は端末に覚える（開き直しても入のまま）。リーグの球団でない名前にはマークを描かない
//   - スマホはメニュー（☰）から切り替えられる
//   - 字: 入のときだけ見出しが LookHead・本文が LookNum（数字と英字）＋LookJP（日本語）。見出しの中の注記と新聞は今までの字のまま。
//     字（public/fonts/。日本語は1つ約450KB）は配布HTMLに埋め込まず、入にするまで1つも読まない
//   - 段3: 入のときだけホームの頭に今日の一戦の札、試合の小窓に打席速報（送ると場面が進む）
//   - 動きで見る: 入のときだけ試合の小窓に出る。球場と選手を canvas に描き、動きが終わると自動で次の打席へ
//   - 段4: 入のときだけホームに番記者のメモ。優勝などが決まったら球団の出来事の場面を1度だけ出す
//   - ブラウザっぽさを減らす（`look/feel.css`・`chrome.js`・`motion.js`・`statGrade.js`）: 入のときだけ
//     アドレスバーの色と「ホーム画面に追加」の印、自前の矢印のプルダウン、選手成績の S〜F の札
//     （リーグ平均比）・並べ替えた列の棒・列のまとまり。切のときは何も足さない
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withDeadline } from './lib/deadline.mjs';
import { launchBrowser, distHtml } from './lib/browser.mjs';
import { seasonService, routeToService } from './lib/serviceRoute.mjs';

const html = await distHtml();
const base = 'http://localhost:3000';
const LOOK_KEY = 'baseball-online-look-v1';
const browser = await launchBrowser();
const errors = [];
// 新しい見た目の字（public/fonts/）。読んだ回数を名前ごとに数える
const fontLoads = {};
const loadedFonts = () => Object.keys(fontLoads).sort();
const fontOf = (p, selector) => p.evaluate((sel) => getComputedStyle(document.querySelector(sel)).fontFamily, selector);
const EMOJI = /[🔥😊😐😞😰]/u;
const LOOK_FONTS = [
  'look-alfaslab.woff2',
  'look-body-bold.woff2',
  'look-body-regular.woff2',
  'look-graduate.woff2',
  'look-head.woff2',
  'look-num-bold.woff2',
  'look-num-regular.woff2',
  'look-yellowtail.woff2',
];
// ⚠ 字を配布HTMLに埋め込むと、切の人まで重くなる
assert.doesNotMatch(html, /font\/woff2;base64|LookGraduate[^}]*data:/, '新しい見た目の字が配布HTMLに埋め込まれた');

/**
 * @param look 入にして開く
 * @param patchView ビューを書き換える（場面を出すために、決まったレースを足すなど）
 */
async function open(contextOptions, { look = false, patchView = null } = {}) {
  const fixture = await seasonService({ days: 6 });
  if (patchView) {
    const view = fixture.service.view.bind(fixture.service);
    fixture.service.view = async (...args) => patchView(await view(...args));
  }
  const context = await browser.newContext(contextOptions);
  if (look) await context.addInitScript((key) => localStorage.setItem(key, 'new'), LOOK_KEY);
  await routeToService(context, fixture);
  await context.route(`${base}/online`, (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await context.route(`${base}/fonts/*.woff2`, async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    fontLoads[name] = (fontLoads[name] ?? 0) + 1;
    const body = await readFile(new URL(`../../public/fonts/${name}`, import.meta.url));
    return route.fulfill({ contentType: 'font/woff2', body });
  });
  // 球団ロゴの絵の形（public/look/。大きい球団マークを描くときに読む。`online-logo-ui-check` が詳しく見る）
  await context.route(`${base}/look/logo-icons.json`, async (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: await readFile(new URL('../../public/look/logo-icons.json', import.meta.url)),
    }),
  );
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${base}/online`);
  return { p, context };
}

await withDeadline(
  (async () => {
    // --- 何も選んでいない端末は入（既定。いしだ 2026-11-28「新しい見た目を、そのまま採用」） ---
    // ⚠ `lookDefault: true` で開くと、検査のブラウザは鍵を置かない（`lib/browser.mjs`）
    {
      const { p, context } = await open({ viewport: { width: 1440, height: 1000 }, lookDefault: true });
      await p.locator('.online.online-look').waitFor();
      const toggle = p.locator('.online-nav-account').getByRole('button', { name: /新しい見た目/ });
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true', '何も選んでいない端末が入になっていない');
      assert.equal(
        await p.evaluate((key) => localStorage.getItem(key), LOOK_KEY),
        null,
        '開いただけで入／切を書き込んだ（選んでいない端末は鍵を持たない）',
      );
      // 今日の一戦の札は1枚で、1枚目は自分の試合（2026-11-28「自分の試合のところを切り替わってほしい」）
      await p.locator('.online-today-game').first().waitFor();
      assert.equal(await p.locator('.online-today-game').count(), 1, '今日の一戦の札が1枚でない');
      assert.equal(await p.locator('.online-today-others, .online-today-other').count(), 0, 'ほかの試合の小さい札が残っている');
      assert.match(await p.locator('.online-today-game > header strong').textContent(), /^(今日|次)の一戦/, '1枚目が自分の試合でない');
      await context.close();
      // ⚠ 読んだ字の数え（`fontLoads`）は検査全体で1つなので空に戻す。入で開いたこの段の字が
      //    残ると、次の「切なのに新しい見た目の字を読んだ」が誤って落ちる
      for (const name of Object.keys(fontLoads)) delete fontLoads[name];
    }
    // --- PC -------------------------------------------------------------
    {
      const { p, context } = await open({ viewport: { width: 1440, height: 1000 } });
      const nav = p.locator('.online-page-nav');
      await nav.getByRole('button', { name: 'スタメン設定', exact: true }).waitFor();
      // ⚠ PCは**上の見出しの帯を出さない**。見た目の切り替え・一人用・ログアウトは左メニューの下（P5 2026-11-25）
      const toggle = p.locator('.online-nav-account').getByRole('button', { name: /新しい見た目（試作）/ });
      assert.equal(await p.locator('.online-header').count(), 0, 'PCに見出しの帯が残っている');
      await p.locator('.online-nav-account').getByRole('link', { name: '一人用', exact: true }).waitFor();
      await p.locator('.online-nav-account').getByRole('button', { name: 'ログアウト', exact: true }).waitFor();
      // 検査のブラウザは切で開く（`lib/browser.mjs` の `launchBrowser` が鍵の無い端末に 'old' を置く）。
      // ⚠ 本番の既定は入（2026-11-28）。既定の入は下の「何も選んでいない端末」で確かめる
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      assert.equal(await p.locator('.online-look-art').count(), 0, '切なのに絵が出ている');
      assert.equal(await p.locator('.online.online-look').count(), 0);
      const standingsNames = await p.locator('.online-standings tbody th').count();
      assert.ok(standingsNames >= 12, '順位表が出ていない');
      assert.doesNotMatch(await fontOf(p, '.online'), /LookNum/, '切なのに数字の字が変わっている');
      assert.doesNotMatch(await fontOf(p, '.online h2'), /LookHead/, '切なのに見出しの字が変わっている');
      await p.evaluate(() => document.fonts.ready);
      assert.deepEqual(loadedFonts(), [], '切なのに新しい見た目の字を読んだ');
      // 切のときはブラウザの枠の印を足さない
      assert.equal(await p.locator('head [data-look]').count(), 0, '切なのにアドレスバーの色などを足した');
      assert.equal(await p.locator('.online-nav-icon, .online-season-progress').count(), 0, '切なのに目次の絵・進み具合の棒が出ている');
      // 段3: 切のときは今日の一戦の札も打席速報も出さない
      assert.equal(await p.locator('.online-today-game').count(), 0, '切なのに今日の一戦の札が出ている');
      assert.equal(await p.locator('.online-reporter-memo').count(), 0, '切なのに番記者のメモが出ている');
      await p.locator('.online-slot-record').first().click();
      await p.locator('.online-scoreboard').first().waitFor();
      assert.equal(await p.getByRole('button', { name: '打席速報' }).count(), 0, '切なのに打席速報が出ている');
      assert.equal(await p.getByRole('button', { name: '動きで見る' }).count(), 0, '切なのに動きで見るが出ている');
      await p.keyboard.press('Escape');
      await p.locator('.online-scoreboard').first().waitFor({ state: 'detached' });

      // 入にする
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      await p.locator('.online.online-look').waitFor();
      assert.equal(
        await p.evaluate((key) => localStorage.getItem(key), LOOK_KEY),
        'new',
        '入／切を端末に覚えていない',
      );
      // 左メニューの自球団と、順位表の12球団にマーク
      assert.equal(await p.locator('.online-nav-context .online-team-mark').count(), 1);
      assert.equal(await p.locator('.online-standings .online-team-mark').count(), 12);
      // 左メニューの絵（ホーム・13ページ・リーグ管理）と、シーズンの進み具合の棒
      assert.ok((await nav.locator('.online-nav-icon').count()) >= 14, '左メニューに絵が無い');
      assert.match(
        await p.locator('.online-season-progress').evaluate((e) => e.style.getPropertyValue('--progress')),
        /^\d+(\.\d)?%$/,
        'シーズンの進み具合の棒が無い',
      );
      assert.ok(
        await nav.evaluate((n) => n.scrollHeight <= n.clientHeight),
        '左メニューが画面からはみ出した',
      );
      // 自球団の色が CSS に渡っている
      const c2 = await p.evaluate(() =>
        getComputedStyle(document.querySelector('.online')).getPropertyValue('--team-c2').trim(),
      );
      assert.match(c2, /^#[0-9a-f]{6}$/, '自球団の色が渡っていない');
      // マークの字が空でない（英字か漢字）
      const monos = await p.locator('.online-standings .online-team-mark text').allTextContents();
      assert.equal(monos.length, 12);
      assert.equal(new Set(monos).size, 12, `12球団の字が重なった: ${monos}`);
      // 字: 見出しと数字。見出しの中の注記は本文の字に戻す
      assert.match(await fontOf(p, '.online'), /^LookNum,/);
      assert.match(await fontOf(p, '.online h2'), /^LookHead,/);
      assert.match(await fontOf(p, '.online h2 small'), /^LookNum,/, '見出しの中の注記まで見出しの字になった');
      // 球団マークの字（Graduate・Alfa Slab・Yellowtail のどれか）も、描いたものは読む
      const markFonts = await p
        .locator('.online-standings .online-team-mark text')
        .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('font-family').split(',')[0]))]);
      const wanted = ['16px LookHead', '16px LookJP', 'bold 16px LookJP', '16px LookNum'];
      for (const f of markFonts) if (f.startsWith('Look')) wanted.push(`16px ${f}`);
      await p.waitForFunction((list) => list.every((f) => document.fonts.check(f)), wanted);
      for (const name of ['look-body-bold.woff2', 'look-body-regular.woff2', 'look-head.woff2', 'look-num-regular.woff2'])
        assert.ok(loadedFonts().includes(name), `入なのに ${name} を読んでいない`);
      for (const name of loadedFonts()) assert.ok(LOOK_FONTS.includes(name), `知らない字を読んだ: ${name}`);
      // 新聞は新聞の字のまま
      await p.locator('.online-paper-open').click();
      await p.locator('.online-paper h2').first().waitFor();
      assert.doesNotMatch(await fontOf(p, '.online-paper h2'), /LookHead/, '新聞の見出しまで変わった');
      await p.keyboard.press('Escape');
      await p.locator('.online-paper-dialog[open]').waitFor({ state: 'hidden' });

      // 段3: ホームの頭に今日の一戦の札（球場の夜景・両球団のマーク・先発の顔）
      const today = p.locator('.online-today-game');
      await today.waitFor();
      assert.equal(await today.locator('.online-stadium-art').count(), 1, '札に球場の絵が無い');
      assert.equal(await today.locator('.online-today-side .online-team-mark').count(), 2, '札に両球団のマークが無い');
      assert.ok((await today.locator('.online-today-starter .online-face').count()) >= 1, '札に先発の顔が無い');
      // 縦を詰めた（先方要望 #8）。前は 320px
      assert.ok((await today.boundingBox()).height <= 230, `今日の一戦の札が縦に長い: ${(await today.boundingBox()).height}px`);
      // ⚠ **札は1枚で、中身が 自分の試合 → 同じ日のほかの試合 → … と切り替わる**（2026-11-28。
      //    前は札の下に、ほかの試合を小さい札で重ねてめくっていたが、球団と先発を2回並べていた）
      const sides = () => today.locator('.online-today-vs .online-today-side strong').allTextContents();
      const cta = today.locator('.online-today-cta:not(.is-empty)');
      const dots = today.locator('.online-today-dots button');
      assert.ok((await dots.count()) >= 2, `切り替える試合が ${await dots.count()} 件`);
      assert.match(await today.locator('> header strong').textContent(), /^(今日|次)の一戦/, '1枚目が自分の試合でない');
      assert.equal(await cta.count(), 1, '自分の試合に「スタメンを見る」が無い');
      const ownSides = await sides();
      const ownHeight = (await today.boundingBox()).height;
      // 点を押すとその試合へ。ほかの試合では顔と「スタメンを見る」を出さない（名前しか無い）
      await dots.nth(1).click();
      assert.notDeepEqual(await sides(), ownSides, '点を押しても試合が切り替わらない');
      assert.match(await today.locator('> header strong').textContent(), /^ほかの試合/, '2枚目がほかの試合でない');
      assert.equal(await cta.count(), 0, 'ほかの試合に「スタメンを見る」が出ている');
      assert.equal(await today.locator('.online-today-starter .online-face').count(), 0, 'ほかの試合に先発の顔が出ている');
      // 切り替えても札の高さは変わらない（変わると下の画面が数秒ごとに上下に揺れる）
      assert.equal((await today.boundingBox()).height, ownHeight, '切り替えると札の高さが変わる');
      // 乗せていないと数秒ごとに次の試合へ進む
      await p.mouse.move(0, 0);
      const second = JSON.stringify(await sides());
      await p.waitForFunction(
        (text) => JSON.stringify([...document.querySelectorAll('.online-today-vs .online-today-side strong')].map((e) => e.textContent)) !== text,
        second,
        { timeout: 9000 },
      );
      // 段4: 番記者のメモ（背広の顔とひとこと）
      const memo = p.locator('.online-reporter-memo');
      await memo.waitFor();
      assert.equal(await memo.locator('.online-face').count(), 1, '番記者の顔が無い');
      assert.match(await memo.locator('small').textContent(), /番　\S/, '番記者の名前が無い');
      assert.ok((await memo.locator('p').count()) >= 1, '番記者のひとことが無い');
      // 試合の小窓に打席速報。送ると場面が進む
      await p.locator('.online-slot-record').first().click();
      await p.getByRole('button', { name: '打席速報' }).click();
      const live = p.locator('.online-live');
      await live.waitFor();
      assert.equal(await live.locator('.online-field-art').count(), 1, '打席速報に球場の図が無い');
      assert.ok((await live.locator('.online-live-telop strong').textContent()).trim(), '実況の文が無い');
      await live.getByRole('button', { name: '次の打席 ▶' }).click();
      assert.match(await live.locator('.online-live-controls small').textContent(), /^2 \//, '打席が進まない');
      // 動きで見る: canvas に球場が描かれ、自動にすると動きが終わってから次の打席へ進む
      await p.getByRole('button', { name: '動きで見る' }).click();
      const motion = p.locator('.online-live[data-motion]');
      await motion.waitFor();
      const canvas = motion.locator('canvas.online-motion-canvas');
      await canvas.waitFor();
      // 結果の文は、動きが終わるまで出さない（⚠ 絵を待つ前に見る。待つ間に短い打席の動きが終わることがある）
      assert.equal(await motion.locator('.online-live-telop[data-wait]').count(), 1, '動きが終わる前に結果の文が出ている');
      // 絵は字を読んでから描きはじめる（待つのは最大1.2秒）
      const colorsOf = () =>
        canvas.evaluate((c) => {
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          const colors = new Set();
          for (let i = 0; i < d.length; i += 4 * 97) colors.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
          return colors.size;
        });
      let painted = 0;
      for (let i = 0; i < 25 && painted <= 50; i++) {
        await p.waitForTimeout(200);
        painted = await colorsOf();
      }
      assert.ok(painted > 50, `動きで見るの絵が描かれていない（色${painted}）`);
      if (process.env.LOOK_SHOTS) await motion.screenshot({ path: `${process.env.LOOK_SHOTS}/motion-pc.png` });
      await motion.getByRole('button', { name: '×2' }).click();
      await motion.locator('.online-live-telop:not([data-wait])').waitFor({ timeout: 20000 });
      assert.equal(await motion.locator('.online-live-flow li[data-now]').count(), 1, '動きが終わっても結果の行が出ない');
      await motion.getByRole('button', { name: '▶ 自動' }).click();
      await p.waitForFunction(
        () => /^[2-9]|^\d{2}/.test(document.querySelector('.online-live[data-motion] .online-live-controls small')?.textContent || ''),
        null,
        { timeout: 20000 },
      );
      await p.keyboard.press('Escape');
      await motion.waitFor({ state: 'detached' });

      // ブラウザの枠: アドレスバーの色・ホーム画面に追加の印・暗い画面の宣言・自前の矢印
      assert.equal(await p.locator('head meta[name="theme-color"][data-look]').getAttribute('content'), '#293b4f');
      assert.equal(await p.locator('head link[rel="manifest"][data-look]').getAttribute('href'), '/online.webmanifest');
      assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark');
      // 選手成績: 成績の S〜F の札（リーグ平均比）・列のまとまり・並べ替えた列の棒
      await nav.getByRole('button', { name: 'チーム分析', exact: true }).click();
      await p.locator('.online-page-tabs').getByRole('button', { name: '選手成績', exact: true }).click();
      await p.locator('.online-roster-row').first().waitFor();
      assert.equal(
        await p.evaluate(() => getComputedStyle(document.querySelector('.online select')).appearance),
        'none',
        'プルダウンがブラウザの矢印のまま',
      );
      const graded = p.locator('.online-roster-values .online-stat-graded');
      assert.ok((await graded.count()) >= 3, '成績に S〜F の札が付いていない');
      assert.match(await graded.first().getAttribute('title'), /リーグ平均と比べて[SABCDEF]/);
      assert.ok((await graded.first().locator('.online-rank-chip').count()) === 1, '札の字が無い');
      assert.deepEqual(
        await p.locator('.online-roster-columns .online-look-section').evaluateAll((els) => els.map((e) => e.dataset.section)),
        ['出場', '打撃', '指標', '選球'],
      );
      assert.equal(await p.locator('.online-look-bar').count(), 0, '並べ替える前から棒が出ている');
      await p.getByRole('button', { name: 'OPSで並べ替え' }).click();
      assert.ok((await p.locator('.online-look-bar').count()) >= 9, '並べ替えた列に棒が無い');
      // 行の高さがそろっている（型の札で2行にならない）
      const heights = await p.locator('.online-compact-roster .online-roster-rows article').evaluateAll((els) => [...new Set(els.map((e) => e.offsetHeight))]);
      assert.deepEqual(heights, [44], `選手成績の行の高さがそろっていない: ${heights}`);

      // 数える項目の 0 は沈ませる
      assert.ok((await p.locator('.online-roster-values > .is-zero').count()) >= 1, '0 を沈ませていない');
      // 説明のふきだし: 乗せると自前のふきだしが出て、ブラウザの title は預かる。離すと戻す
      const tipTarget = graded.first();
      const tipText = await tipTarget.getAttribute('title');
      await tipTarget.hover();
      const tip = p.locator('.online-look-tip');
      await tip.waitFor();
      assert.equal(await tip.textContent(), tipText, 'ふきだしの字が title と違う');
      assert.equal(await tipTarget.getAttribute('title'), null, 'ブラウザのふきだしも出る（title が残っている）');
      await p.mouse.move(2, 2);
      await tip.waitFor({ state: 'detached' });
      assert.equal(await tipTarget.getAttribute('title'), tipText, '離しても title が戻らない');

      // どの表でも同じ部品: 守備位置の色の札・成績と能力の S〜F の札・順位の札・平均との差
      const tabs = p.locator('.online-page-tabs');
      await tabs.getByRole('button', { name: 'スタメン・投手陣', exact: true }).click();
      await p.locator('.online-team-lineup').first().waitFor();
      assert.ok((await p.locator('.online-team-lineup .online-pos-chip.has-pos').count()) >= 8, 'スタメンの守備位置が色の札でない');
      assert.ok((await p.locator('.online-team-lineup .online-stat-graded').count()) >= 3, 'スタメン・投手陣の成績に札が無い');
      await tabs.getByRole('button', { name: '守備分析', exact: true }).click();
      await p.locator('.online-defense-table').waitFor();
      assert.ok((await p.locator('.online-defense-table .online-pos-chip').count()) >= 8, '守備分析の守備位置が色の札でない');
      assert.ok((await p.locator('.online-defense-table .online-rank-chip').count()) >= 16, '守備分析の守備範囲・能力に札が無い');
      await tabs.getByRole('button', { name: 'チーム能力・成績', exact: true }).click();
      await p.locator('.online-radar-table').waitFor();
      assert.equal(await p.locator('.online-radar-table .online-place-chip').count(), 6, 'チーム能力値の順位が札でない');
      assert.equal(await p.locator('.online-radar-table .online-delta').count(), 6, 'チーム能力値に平均との差が無い');
      await tabs.getByRole('button', { name: '年齢構成', exact: true }).click();
      await p.locator('.online-age-core').waitFor();
      assert.ok((await p.locator('.online-age-core .online-tone-chip').count()) >= 1, '年齢構成の見込みが札でない');
      // 各球団の指導者: 球団マークと顔
      await nav.getByRole('button', { name: '指導者', exact: true }).click();
      await p.locator('.online-staff-table').waitFor();
      assert.equal(await p.locator('.online-staff-table .online-team-mark').count(), 12, '各球団の指導者に球団マークが無い');
      assert.ok((await p.locator('.online-staff-table .online-face').count()) >= 12, '各球団の指導者に顔が無い');
      // 折りたたみの三角は自前（ブラウザの印を消している）
      assert.equal(
        await p.locator('.online-staff-more summary').first().evaluate((e) => getComputedStyle(e).listStyleType),
        'none',
        '折りたたみがブラウザの三角のまま',
      );

      // スタメン設定: 顔・調子の顔
      await nav.getByRole('button', { name: 'スタメン設定', exact: true }).click();
      await p.locator('.online-lineup-person').first().waitFor();
      assert.ok((await p.locator('.online-lineup-person .online-face').count()) >= 9, '選手の顔が出ていない');
      const conditionText = await p.locator('.online-lineup-person .online-condition').first().textContent();
      assert.doesNotMatch(conditionText, EMOJI, '入なのに調子が絵文字のまま');
      assert.ok(await p.locator('.online-lineup-person .online-condition-face').count());

      // 選手の詳細: 顔と段位の字
      await p.locator('.online-lineup-person .online-player-name').first().click();
      const dialog = p.locator('.online-player-dialog[open]');
      await dialog.waitFor();
      assert.equal(await dialog.locator('header .online-face').count(), 1);
      const chips = await dialog.locator('.online-rank-chip').allTextContents();
      assert.ok(chips.length >= 10, '段位の字が出ていない');
      for (const c of chips) assert.match(c, /^[SABCDEF]$/);
      await p.keyboard.press('Escape');

      // 開き直しても入のまま
      await p.reload();
      await nav.getByRole('button', { name: 'スタメン設定', exact: true }).waitFor();
      await p.locator('.online.online-look').waitFor();

      // 切に戻すと絵が消え、調子は絵文字に戻る
      await toggle.click();
      await nav.getByRole('button', { name: 'スタメン設定', exact: true }).click();
      await p.locator('.online-lineup-person').first().waitFor();
      assert.equal(await p.locator('.online-look-art').count(), 0, '切に戻しても絵が残った');
      const emoji = await p.locator('.online-lineup-person .online-condition').first().textContent();
      assert.match(emoji, EMOJI);
      // ⚠ 切に戻したことを**覚える**（'old'）。前は鍵を消していたが、既定が入になったので
      //    消すと次に開いたとき入に戻ってしまう
      assert.equal(await p.evaluate((key) => localStorage.getItem(key), LOOK_KEY), 'old', '切に戻したのを端末に覚えていない');
      assert.doesNotMatch(await fontOf(p, '.online h1'), /LookHead/, '切に戻しても見出しの字が残った');
      assert.equal(await p.locator('head [data-look]').count(), 0, '切に戻してもアドレスバーの色などが残った');
      assert.equal(await p.evaluate(() => document.documentElement.classList.contains('online-look-root')), false);
      assert.equal(
        await p.locator('.online-nav-icon, .online-season-progress, .online-pos-chip, .online-look-tip').count(),
        0,
        '切に戻しても目次の絵・札が残った',
      );
      await context.close();
    }

    // --- 段4: 球団の出来事の場面（優勝が決まったビュー）。閉じたら2度は出さない ----
    {
      const won = (v) => ({
        ...v,
        races: [{ league: 'A', leagueName: '1部', kind: 'first', team: v.teamName, magic: 0, clinched: true, rival: null, left: 0 }],
      });
      const { p, context } = await open({ viewport: { width: 1440, height: 1000 } }, { look: true, patchView: won });
      const scene = p.getByRole('dialog', { name: '1部優勝！' });
      await scene.waitFor();
      assert.equal(await scene.locator('.online-stadium-art').count(), 1, '場面に球場の絵が無い');
      assert.ok((await scene.locator('.online-face').count()) >= 1, '場面に顔が無い');
      assert.ok((await scene.locator('.online-event-talk p').textContent()).trim(), '場面の台詞が無い');
      await scene.getByRole('button', { name: '閉じる' }).click();
      await scene.waitFor({ state: 'detached' });
      await p.reload();
      await p.locator('.online-today-game').waitFor();
      assert.equal(await p.locator('.online-event-scene').count(), 0, '見た場面がもう1度出た');
      await context.close();
    }
    // 切のときは決まっても出さない
    {
      const won = (v) => ({ ...v, races: [{ league: 'A', leagueName: '1部', kind: 'first', team: v.teamName, magic: 0, clinched: true, left: 0 }] });
      const { p, context } = await open({ viewport: { width: 1440, height: 1000 } }, { patchView: won });
      await p.locator('.online-page-nav').getByRole('button', { name: 'スタメン設定', exact: true }).waitFor();
      assert.equal(await p.locator('.online-event-scene').count(), 0, '切なのに場面が出た');
      await context.close();
    }
    // --- スマホ -----------------------------------------------------------
    {
      const { p, context } = await open({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      // 切のとき: 下の帯は今までの字（← ⌂ ☰）
      await p.locator('.online-mobile-controls button').first().waitFor();
      assert.deepEqual(await p.locator('.online-mobile-controls button').allTextContents(), ['←', '⌂', '☰']);
      await p.getByRole('button', { name: 'メニュー', exact: true }).click();
      const toggle = p.locator('.online-mobile-menu-panel').getByRole('button', { name: /新しい見た目（試作）/ });
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      await toggle.click();
      // 押すとメニューは閉じ、ホームの球団名にマークが付く
      await p.locator('.online.online-look').waitFor();
      assert.equal(await p.locator('.online-mobile-overview .online-team-mark').count(), 1);
      // 下の帯は絵と小さな字、ホームの近道にも絵
      assert.deepEqual(await p.locator('.online-mobile-controls button').allTextContents(), ['戻る', 'ホーム', 'メニュー']);
      assert.equal(await p.locator('.online-mobile-controls .online-nav-icon').count(), 3);
      assert.ok((await p.locator('.online-home-actions .online-nav-icon').count()) >= 5, 'ホームの近道に絵が無い');
      // 試合の「結果／日程」の切り替え: 帯は中身の幅だけ（画面いっぱいに伸びない）
      await p.getByRole('button', { name: '試合', exact: true }).first().click();
      const seg = p.locator('.online-segments').first();
      await seg.waitFor();
      assert.ok((await seg.evaluate((e) => e.offsetWidth)) < 200, '切り替えの帯が画面いっぱいに伸びた');
      await p.getByRole('button', { name: 'ホーム', exact: true }).click();
      // スマホの順位表は名前を1行に保つためマークを出さない
      const shown = await p
        .locator('.online-standings .online-team-mark')
        .evaluateAll((els) => els.filter((el) => getComputedStyle(el).display !== 'none').length);
      assert.equal(shown, 0, 'スマホの順位表にマークが出ている');
      // 打順: 顔
      await p.getByRole('button', { name: '打順', exact: true }).first().click();
      await p.locator('.online-tap-name').first().waitFor();
      assert.ok((await p.locator('.online-tap-line1 .online-face').count()) >= 9);
      await context.close();
    }
  })(),
  'online-look-ui-check',
  180_000,
);
await browser.close();
assert.deepEqual(errors, [], `画面のエラー: ${errors.join('\n')}`);
console.log('online-look-ui-check: ok');
