// 配布HTMLでの読み込み失敗・状態の切替・保存中入力。APIはfixture。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { withDeadline } from './lib/deadline.mjs';
import { TURN_MINUTES } from '../../src/online/shared.js';
import { shortLastLines } from './lib/textWrap.mjs';
import { failureShots } from './lib/failureShots.mjs';
// ⚠ PCの左メニューは「現在の手続き」「選手成績」「ホーム」（3a8592d で名前が変わった）。
//    スマホのホームのボタンは「手続き」「打順」のまま。
// ⚠ **PCのキャンプは「ホーム」に出す**（いしだ要望。「現在の手続き」の中に
//    畳むと、開いていることに気づかないまま締め切りで自動になっていた）。
//    スマホは「手続き」のまま（`MobileView` は変えていない）。
// ⚠ PCのキャンプは**選手ごとにメイン練習とサブ練習**を割り当て、1クールずつ
//    その場で実行する（`CampPlanner`）。以前は球団で1つ選ぶだけだった。
//    ここでは名簿の投手1人の「メイン練習」の欄で、未保存案の保持を見る。
//    割り当ての無い投手は「投げ込み」（`control`）になる
const PITCHER = '検証 投手';
const menuGroup = (page) =>
  page.getByRole('combobox', { name: `${PITCHER}のメイン練習`, exact: true });
const chooseMenu = (page, value) => menuGroup(page).selectOption(value);
const pressedMenu = (page) => menuGroup(page).inputValue();
const STANDARD_MENU = 'control';
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
  roster: [
    {
      id: 1,
      name: PITCHER,
      age: 24,
      position: 'pitcher',
      condition: 2,
      pitching: { velocity: 140, control: 50, stamina: 50 },
      batting: { meet: 20, power: 20, eye: 20 },
      physical: { speed: 40 },
      fielding: { defense: 40, arm: 50 },
    },
  ],
  standings: [],
  results: [],
  upcoming: [],
  history: [],
  notices: [],
  lineup: { battingOrder: [], starters: [], strategy: {} },
  phase: { id: '1:camp', kind: 'camp', label: 'キャンプ', submission: null },
});
// 契約更改（提出して決める手続き）。⚠ 標準案の読み込みはここで見る（キャンプは取りに行かない）
const contractPhase = () => ({
  id: '1:contract',
  kind: 'contract',
  label: '契約更改',
  submission: null,
});
async function scene({
  mobile = false,
  defaultsFail = false,
  staleDefaults = false,
  phase = null,
  defaultPlan = null,
  roster = null,
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
  if (phase) view.phase = phase;
  if (roster) view.roster = roster;
  const state = {
    view,
    defaultsRequests: 0,
    defaultsFail,
    staleDefaults,
    payloads: [],
    types: [],
    rejected: [],
    checkRevision: false,
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
      state.defaultsRequests++;
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
        phaseId: state.staleDefaults ? '0:other' : state.view.phase.id,
        revision: state.view.revision,
        plan:
          defaultPlan ||
          (state.view.phase.kind === 'contract'
            ? { releaseIds: [] }
            : { menu: 'standard' }),
      };
    } else if (action === 'presence') {
      // 来たことの知らせ（画面を開くと送る。版は上がらない）
      value = { ok: true };
    } else if (action === 'command') {
      const payload = route.request().postDataJSON().payload;
      // 本物のサーバーと同じく版を照合する（`checkRevision` のときだけ）
      if (
        state.checkRevision &&
        route.request().postDataJSON().revision !== state.view.revision
      ) {
        state.rejected.push({
          type: route.request().postDataJSON().type,
          round: payload?.round,
        });
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: '他の操作で更新されました。最新状態を読み直してください',
            code: 'revision',
          }),
        });
      }
      state.payloads.push(payload);
      state.types.push(route.request().postDataJSON().type);
      signal();
      if (state.hold)
        await new Promise((resolve) => {
          state.release = resolve;
        });
      // ⚠ キャンプの `campRound` は**提出ではない**（その場で実行する）。
      //    提出として記録すると、本物のサーバーには起きない
      //    「別の操作で提出が更新されました」が画面に出る
      if (state.view.phase && payload.plan !== undefined)
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
  // ⚠ スマホではこの3つがメニューの中にある。開いた直後（まだ描かれていない）に数えると
  //    どちらも0で、メニューを開かずに探して待ち切れなかった（混んでいるときに落ちた）。
  //    ボタンかメニューのどちらかが出るまで待ってから決める
  if (['更新', 'ログアウト', '進行時刻'].includes(text))
    await page
      .getByRole('button', { name: text, exact: true })
      .or(page.getByRole('button', { name: 'メニュー', exact: true }))
      .first()
      .waitFor();
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
/**
 * スマホの手続きの編集が 320〜390px に収まること（判断1・案B）。
 * 横スクロールが出ない・はみ出さない・文字が1字だけ次の行に落ちない・ボタンが指で押せる高さ。
 * ⚠ 一覧の中の小さな枠（`max-height` で中だけ動く）も「はみ出し」に数える（横に動く枠は作らない）
 */
async function fitsPhone(page, what) {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const problems = await page.evaluate(() => {
      const out = [];
      const page = document.documentElement.scrollWidth;
      if (page > innerWidth + 1) out.push(`横スクロール ${page}px`);
      for (const n of document.querySelectorAll('.online-decision *')) {
        // 1年の流れの帯は、手続きの段を横に送って見る作り（`SeasonFlow`。ここの対象外）
        if (!n.checkVisibility() || n.closest('.online-season-flow')) continue;
        const r = n.getBoundingClientRect();
        if (r.width && (r.right > innerWidth + 1 || r.left < -1))
          out.push(`はみ出し ${n.tagName}.${n.className} ${(n.innerText || '').slice(0, 20)}`);
        if (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'visible')
          out.push(`中で横に動く ${n.tagName}.${n.className}`);
      }
      for (const n of document.querySelectorAll(
        '.online-phase-editor button, .online-phase-editor input, .online-phase-editor select, .online-decision .online-actions button',
      )) {
        if (!n.checkVisibility() || n.type === 'range') continue;
        // チェックは押せる枠（label）の大きさで見る
        const target = n.type === 'checkbox' && n.closest('label') ? n.closest('label') : n;
        const r = target.getBoundingClientRect();
        if (r.height < 40 || r.width < 36)
          out.push(`指で押しにくい ${n.innerText || n.getAttribute('aria-label') || n.type} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return [...new Set(out)].slice(0, 12);
    });
    assert.deepEqual(problems, [], `${width}px で${what}が幅に収まらない`);
    assert.deepEqual(
      await shortLastLines(page, '.online-decision'),
      [],
      `${width}px で${what}の文字が1字だけ次の行に落ちる`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
}
try {
  const oversized = await scene();
  await click(oversized.page, 'ホーム');
  await menuGroup(oversized.page).waitFor();
  await oversized.page.evaluate(() =>
    sessionStorage.setItem(
      'baseball-online-draft:a:fixture:1:検証球団',
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
  await click(draft.page, 'ホーム');
  await chooseMenu(draft.page, 'velocity');
  // ⚠ ページを移って戻る（キャンプはホームなので、移る先は別のページ）
  await click(draft.page, '選手成績');
  // ⚠ ほかのページの帯の「キャンプを開く」は**ホームへ直に飛ぶ**（u1 低28）。以前は
  //    「現在の手続き」（「ホームへ」の案内だけ）へ飛び、2回押さないと着かなかった
  await click(draft.page, 'キャンプを開く');
  await menuGroup(draft.page)
    .or(draft.page.getByRole('button', { name: 'ホームへ', exact: true }))
    .first()
    .waitFor();
  assert.equal(
    await menuGroup(draft.page).count(),
    1,
    '帯の「キャンプを開く」でホームのキャンプへ行かない',
  );
  // 左メニューの数も、キャンプの間はホームに付ける（「現在の手続き」は案内だけ）
  assert.equal(
    await draft.page.locator('.online-nav-home .online-count').innerText(),
    '1',
    'キャンプの間、ホームに手続きの数が出ていない',
  );
  assert.equal(
    await draft.page
      .getByRole('button', { name: '現在の手続き', exact: true })
      .locator('.online-count')
      .count(),
    0,
    'キャンプの間も「現在の手続き」に数が出ている（押しても案内だけ）',
  );
  assert.equal(await pressedMenu(draft.page), 'velocity', '画面移動でも提出案を保持');
  // ⚠ スマホは**選手ごとの表を出さない**（23列は入らない）。育成方針と
  //    「第Nクール練習を実行」だけを出す（`CampPlanner` の `compact`）。
  //    出さないと、携帯だけの人は4クールとも自動になってしまう。
  await draft.page.setViewportSize({ width: 390, height: 844 });
  // ⚠ スマホのキャンプは「手続き」のまま（ホームへ移したのはPCだけ）
  await click(draft.page, '手続き');
  await draft.page
    .getByText('選手ごとの練習はPCで選べます', { exact: false })
    .waitFor();
  await draft.page
    .getByRole('button', { name: '第1クール練習を実行', exact: true })
    .waitFor();
  assert.equal(
    await draft.page.locator('.online-camp-scroll').count(),
    0,
    'スマホに選手ごとの表を出している',
  );
  await draft.page.reload();
  await click(draft.page, '手続き');
  await draft.page
    .getByRole('button', { name: '第1クール練習を実行', exact: true })
    .waitFor();
  await draft.page.setViewportSize({ width: 1280, height: 844 });
  await click(draft.page, 'ホーム');
  assert.equal(
    await pressedMenu(draft.page),
    'velocity',
    '再読込・表示切替後も未保存案を復元',
  );
  // ⚠ 1280px でも**練習を選ぶ2列（メイン・サブ）は送らずに見える**。右に留めていな
  //    かったので、サブの列が丸ごと枠の外にあった（中身 1129px・枠 978px。再監査 F11）。
  //    送っても見えたまま・2列が重ならないことも見る
  const practiceStays = await draft.page
    .locator('.online-camp-scroll')
    .evaluate(async (box) => {
      const out = [];
      for (const at of [0, box.scrollWidth / 3, box.scrollWidth]) {
        box.scrollLeft = at;
        await new Promise(requestAnimationFrame);
        const edge = box.getBoundingClientRect();
        const [main, sub] = ['メイン', 'サブ'].map((kind) =>
          box
            .querySelector(`tbody tr:first-child select[aria-label$="の${kind}練習"]`)
            .getBoundingClientRect(),
        );
        if (main.left < edge.left - 1 || main.right > edge.right + 1) out.push(`メインが見えない ${at}`);
        if (sub.left < edge.left - 1 || sub.right > edge.right + 1) out.push(`サブが見えない ${at}`);
        if (main.right > sub.left + 1) out.push(`メインとサブが重なる ${at}`);
      }
      box.scrollLeft = 0;
      return { scrollable: box.scrollWidth > box.clientWidth, out };
    });
  assert.deepEqual(
    practiceStays,
    { scrollable: true, out: [] },
    '1280px でキャンプの表のメイン・サブの練習が見えない',
  );
  // ⚠ PCでも決め方の説明を … で止めない。「…『短所を埋める』を望むとき…」と肝心の
  //    ところで切れていた（再監査 F18。スマホは下で見る）
  assert.equal(
    await draft.page
      .locator('.online-camp-guide-note')
      .evaluate((note) => note.scrollWidth > note.clientWidth + 1),
    false,
    '1280px でキャンプの決め方の説明が … で切れる',
  );
  // ⚠ 1280px では表が横に送れる。**氏名の列は左に留める**（右端の練習・希望の
  //    列を見ているとき、誰の行か分からなくなっていた）
  const nameStays = await draft.page
    .locator('.online-camp-scroll')
    .evaluate((box) => {
      box.scrollLeft = box.scrollWidth;
      const left = box.getBoundingClientRect().left;
      const name = box.querySelector('tbody th').getBoundingClientRect();
      return {
        scrolled: box.scrollLeft > 0,
        visible: name.left >= left - 1 && name.right > left + 40,
      };
    });
  assert.deepEqual(
    nameStays,
    { scrolled: true, visible: true },
    '1280px でキャンプの表を右へ送ると氏名が隠れる',
  );
  draft.view.phase.id = '2:camp';
  draft.view.revision++;
  await click(draft.page, '更新');
  await draft.page.waitForFunction(
    ([name, value]) =>
      document.querySelector(`select[aria-label="${name}"]`)?.value === value,
    [`${PITCHER}のメイン練習`, STANDARD_MENU],
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
  // ⚠ 打順の未保存案を再読み込みまで残すのは**スマホの「打順」**（2タップの表。
  //    `TapLineup.jsx` の下書き `lineup.order`）。PCのスタメン設定は、未保存の編集を
  //    ページを移っても残す（隠すだけ）が、再読み込みまでは持ち越さない（online-ui-check で見る）
  await lineupDraft.page.setViewportSize({ width: 390, height: 844 });
  const leadoff = () =>
    lineupDraft.page
      .locator('ol[aria-label="スタメン"] > li[data-slot="1"] .online-tap-name')
      .innerText();
  const tapName = (slot) =>
    lineupDraft.page
      .locator(`ol[aria-label="スタメン"] > li[data-slot="${slot}"] button.online-tap-main`)
      .click();
  await click(lineupDraft.page, '打順');
  // 2番を選んで1番を押す（打順の入れ替え）
  await tapName(2);
  await tapName(1);
  await click(lineupDraft.page, 'ホーム');
  await click(lineupDraft.page, '打順');
  assert.equal(await leadoff(), '打者2', '画面移動でも打順の編集を保持');
  await lineupDraft.page.setViewportSize({ width: 1280, height: 844 });
  await lineupDraft.page
    .getByRole('button', { name: 'スタメン設定', exact: true })
    .waitFor();
  await lineupDraft.page.setViewportSize({ width: 390, height: 844 });
  await lineupDraft.page.reload();
  await click(lineupDraft.page, '打順');
  assert.equal(
    await leadoff(),
    '打者2',
    '編成もホーム移動・表示切替・再読込を通して保持',
  );
  await click(lineupDraft.page, '変更を取り消す');
  assert.equal(await leadoff(), '打者1');
  await lineupDraft.context.close();

  const retry = await scene({ defaultsFail: true, phase: contractPhase() });
  // ⚠ **標準案を取りに行くのは、提出して決める手続き（契約更改など）だけ**。キャンプは
  //    PC・スマホとも取りに行かない（1クールずつその場で実行する。`CampPlanner` は
  //    `view.phase.camp` を見る）。失敗したときの知らせと取り直しは契約更改で見る
  await retry.page.setViewportSize({ width: 390, height: 844 });
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
  await retry.page
    .getByRole('button', { name: 'この内容で決定', exact: true })
    .waitFor();
  assert.equal(await retry.page.getByRole('alert').count(), 0);
  // ここからはキャンプを、PCの割り当ての欄で見る
  retry.view.phase = initial().phase;
  retry.view.revision++;
  await click(retry.page, '更新');
  await retry.page.setViewportSize({ width: 1280, height: 844 });
  await retry.page.locator('.online-page-nav').waitFor();
  await click(retry.page, 'ホーム');
  await menuGroup(retry.page).waitFor();
  // ⚠ キャンプに「下書きを保存」「この内容で決定」は無い。1クールずつその場で
  //    実行する。送っている間は**割り当ても変えられない**こと——変えられると、
  //    送った内容と画面の内容が食い違う
  retry.hold = true;
  await retry.page
    .getByRole('button', { name: '第1クール練習を実行', exact: true })
    .click();
  await withDeadline(retry.commandStarted, '練習の実行の開始');
  assert.ok(
    await menuGroup(retry.page).isDisabled(),
    '練習を送っている間は割り当ても変更できない',
  );
  retry.release();
  // ⚠ 済んだときの文は操作ごと（以前はどの操作も「保存しました」）
  await retry.page.getByText('第1クールの練習を実行しました', { exact: true }).waitFor();
  assert.equal(await retry.page.locator('.online-edit-notice').count(), 0);
  // ⚠ **キャンプのクールも、版のずれだけなら最新の版で1回だけ送り直す**。
  //    版はリーグ全体で1つなので、毎正時の進行や他の参加者の操作だけで
  //    「他の操作で更新されました」になっていた。サーバーはクール番号を照合して
  //    同じクールを2回走らせないので、送り直しても二重には積まれない
  retry.hold = false;
  retry.checkRevision = true;
  retry.view.revision += 5; // 画面の知らない進行
  const sentBefore = retry.payloads.length;
  await retry.page
    .getByRole('button', { name: '第1クール練習を実行', exact: true })
    .click();
  await retry.page
    .getByText('処理中です。画面を閉じずにお待ちください…', { exact: true })
    .waitFor({ state: 'hidden' });
  assert.equal(
    await retry.page.getByRole('alert').count(),
    0,
    '版のずれだけでキャンプのクールが断られた',
  );
  assert.deepEqual(
    retry.rejected,
    [{ type: 'campRound', round: 1 }],
    '古い版で1回断られていない',
  );
  assert.deepEqual(
    retry.payloads.slice(sentBefore).map((x) => x.round),
    [1],
    '送り直しで同じクール番号を送っていない',
  );
  await retry.context.close();

  // ⚠ ここも契約更改で見る（キャンプは標準案を取りに行かない）
  const stale = await scene({ staleDefaults: true, phase: contractPhase() });
  await stale.page.setViewportSize({ width: 390, height: 844 });
  await click(stale.page, '手続き');
  await stale.page
    .getByText('手続きが更新されました。最新状態を確認してください', {
      exact: true,
    })
    .waitFor();
  const staleRun = () =>
    stale.page.getByRole('button', { name: 'この内容で決定', exact: true });
  // ⚠ **別の手続きの標準案は使わない**。黙って当てると、前の手続きの内容で
  //    決定してしまう。取り直せる口を出すこと
  await stale.page
    .getByRole('button', { name: '標準案を再取得', exact: true })
    .waitFor();
  stale.staleDefaults = false;
  stale.view.phase.id = '2:contract';
  stale.view.revision++;
  await click(stale.page, '更新');
  await stale.page
    .getByText('手続きが更新されました。最新状態を確認してください', {
      exact: true,
    })
    .waitFor({ state: 'hidden' });
  await staleRun().waitFor();
  await stale.context.close();

  // --- 締め切りの日時を1画面に何度も並べない（u1 低31） ---------------------
  // ⚠ 以前は手続きのページに「見出しの下」「1年の流れの帯」「決まりの文」と3回出ていた。
  //    決まりの文には日時を書かない
  {
    const due = await scene({
      phase: { ...contractPhase(), deadline: '2026-11-07T15:00:00.000Z' },
    });
    due.view.stage = { key: 'contract', open: true };
    due.view.revision++;
    await click(due.page, '更新');
    await click(due.page, '現在の手続き');
    await due.page.getByRole('button', { name: 'この内容で決定', exact: true }).waitFor();
    const times = async () =>
      (await due.page.locator('main').innerText()).split('11/8(日) 0:00').length - 1;
    // ⚠ 下限も見る。日時の書き方が変わって1回も見つからないと、上限だけでは素通りする
    const pcTimes = await times();
    assert.ok(pcTimes >= 1 && pcTimes <= 2, `PCの手続きのページに締め切りが${pcTimes}回出ている（1〜2回のはず）`);
    // 幅を変えても開いている画面（手続き）はそのまま
    await due.page.setViewportSize({ width: 390, height: 844 });
    await due.page.locator('.online-mobile-controls').waitFor();
    await due.page.getByRole('button', { name: 'この内容で決定', exact: true }).waitFor();
    const spTimes = await times();
    assert.equal(spTimes, 1, `スマホの手続きに締め切りが${spTimes}回出ている（1回のはず）`);
    await due.context.close();
  }

  // --- スマホの手続き: 決める中身を見せ、決定の前に確認を1段挟む（u1 高4） ---
  // ⚠ 以前は「退団予定 1人」の1行だけで、誰を出すのかを見ないまま1回押すと決定した
  {
    const decide = await scene({
      mobile: true,
      phase: contractPhase(),
      defaultPlan: { releaseIds: [1] },
    });
    await click(decide.page, '手続き');
    const contents = decide.page.locator('.online-phase-contents');
    await contents.waitFor();
    const listed = await contents.innerText();
    assert.match(listed, /退団させる選手 1人/, `退団させる人数が出ない: ${listed}`);
    assert.ok(listed.includes(PITCHER), `退団させる選手の名前が出ない: ${listed}`);
    const decideButton = decide.page.getByRole('button', { name: 'この内容で決定', exact: true });
    const confirm = decide.page.getByRole('group', { name: '決定の確認', exact: true });
    await decideButton.click();
    await confirm.waitFor();
    assert.match(await confirm.innerText(), /取り消せません/, '確認に取り消せないことが書かれていない');
    assert.equal(decide.payloads.length, 0, '確認の前に決定を送っている');
    // 「戻る」なら送らずに閉じる
    await confirm.getByRole('button', { name: '戻る', exact: true }).click();
    await confirm.waitFor({ state: 'detached' });
    assert.equal(decide.payloads.length, 0, '「戻る」で決定を送っている');
    // 確認の帯が出ても、中身の最後が帯に隠れない（下までスクロールして見える）
    await decideButton.click();
    await confirm.waitFor();
    await decide.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const lastRow = await contents.locator('li').last().boundingBox();
    const bar = await confirm.boundingBox();
    assert.ok(
      lastRow.y + lastRow.height <= bar.y,
      `確認の帯が中身の最後を隠す（${lastRow.y + lastRow.height} > ${bar.y}）`,
    );
    await confirm.getByRole('button', { name: '決定する', exact: true }).click();
    await decide.page.getByText('決定しました', { exact: true }).waitFor();
    assert.deepEqual(decide.payloads.at(-1).plan, { releaseIds: [1] });
    assert.equal(decide.payloads.at(-1).ready, true);
    await decide.context.close();

    // ⚠ **スマホでも退団させる選手を選び直して決められる**（判断1・案B ③）。以前は標準案の
    //    退団（監督の案）のまま決めるしかなかった。PCと同じ `ContractPlanner`・同じ `submit`
    const fielder = (id, name, position, age) => ({
      id,
      name,
      age,
      position,
      condition: 2,
      batting: { meet: 40, power: 35, eye: 30 },
      physical: { speed: 50, arm: 50 },
      fielding: { defense: 45 },
      pitching: {},
    });
    const coachNote = '照屋監督の案です。変えてから決定できます';
    const release = await scene({
      mobile: true,
      phase: {
        ...contractPhase(),
        planBy: { mode: 'advise', by: '照屋監督', text: coachNote },
      },
      defaultPlan: { releaseIds: [1] },
      roster: [
        ...initial().roster,
        fielder(2, '検証 外野手', 'left', 31),
        fielder(3, '検証 捕手', 'catcher', 23),
      ],
    });
    await click(release.page, '手続き');
    // ⚠ 「○○監督の案です」は、出ている案が指導者の案のままの間だけ出す。自分で入れ替えて
    //    決定したあとも残り、決定した中身が指導者の案に読めた（再監査 F18）
    const coachNoteShown = () =>
      release.page.locator('.online-staff-note').filter({ hasText: coachNote }).count();
    await release.page.locator('.online-staff-note').filter({ hasText: coachNote }).waitFor();
    await release.page.getByRole('button', { name: '退団させる選手を変える', exact: true }).click();
    const releaseBox = (name) =>
      release.page.getByRole('checkbox', { name: new RegExp(`^${name}（.*）を退団させる$`) });
    await releaseBox(PITCHER).uncheck();
    await releaseBox('検証 外野手').check();
    await fitsPhone(release.page, '契約更改の退団選び');
    // 「変更を取り消す」で標準案に戻る
    await release.page.getByRole('button', { name: '変更を取り消す', exact: true }).click();
    await release.page.locator('.online-phase-status').filter({ hasText: '標準案です。' }).waitFor();
    assert.ok(await releaseBox(PITCHER).isChecked(), '「変更を取り消す」で標準案の退団に戻らない');
    assert.ok(!(await releaseBox('検証 外野手').isChecked()), '「変更を取り消す」で選んだ退団が残る');
    await releaseBox(PITCHER).uncheck();
    await releaseBox('検証 外野手').check();
    assert.equal(await coachNoteShown(), 0, '退団を選び直したのに「監督の案です」が出ている');
    await release.page.getByRole('button', { name: 'この内容で決定', exact: true }).click();
    await release.page.getByRole('group', { name: '決定の確認', exact: true }).waitFor();
    const releasing = await release.page.locator('.online-phase-contents').innerText();
    assert.ok(
      releasing.includes('検証 外野手') && !releasing.includes(PITCHER),
      `確認で選び直した退団が出ない: ${releasing}`,
    );
    await release.page.getByRole('button', { name: '決定する', exact: true }).click();
    await release.page.getByText('決定しました', { exact: true }).waitFor();
    assert.deepEqual(
      release.payloads.at(-1),
      { phaseId: '1:contract', plan: { releaseIds: [2] }, ready: true, baseSubmission: null },
      'スマホで選び直した退団が送られない',
    );
    assert.equal(await coachNoteShown(), 0, '自分で選び直して決定したあとも「監督の案です」が出ている');
    await release.context.close();

    // トライアウト: 実際に取る顔ぶれ（希望順の上から count 人。目標構成で飛ばさない）
    const candidate = (id, name, position) => ({
      id,
      name,
      age: 22,
      position,
      pitching: {},
      batting: {},
      fielding: {},
    });
    const tryout = await scene({
      mobile: true,
      phase: {
        id: '1:tryout',
        kind: 'tryout',
        label: 'トライアウト',
        submission: null,
        candidates: [
          candidate(101, '候補一郎', 'catcher'),
          candidate(102, '候補二郎', 'short'),
          candidate(103, '候補三郎', 'left'),
        ],
      },
      defaultPlan: { count: 2, rankedIds: [101, 102, 103] },
    });
    await click(tryout.page, '手続き');
    await tryout.page.locator('.online-phase-contents li').nth(1).waitFor();
    const picks = await tryout.page.locator('.online-phase-contents').innerText();
    // ⚠ 見出しは**獲得する人数**（`total`。無ければ空き枠いっぱい）。交渉から取る人数と、
    //    自動で埋める人数を添える（先方指摘「指名選手の人数を決められない」で人数を足した）
    assert.match(picks, /獲得する人数 \d+人/, `獲得する人数が出ない: ${picks}`);
    assert.match(picks, /交渉した3人から2人/, `交渉から取る人数が出ない: ${picks}`);
    assert.ok(
      picks.includes('候補一郎') && picks.includes('候補二郎') && !picks.includes('候補三郎'),
      `獲得予定の顔ぶれが違う: ${picks}`,
    );
    // ⚠ **スマホでも獲得の希望を入れ替えて決められる**（判断1・案B ④）。PCと同じ
    //    `TryoutPlanner`。指ではドラッグできないので ↑↓ と「やめる」で動かす
    //    （いしだ要望で「交渉」ボタン1つの形にしたので、「控えへ回す」は無くなった。
    //     交渉をやめた選手は希望リストから消え、空いた枠はサーバーが自動で埋める）
    await tryout.page.getByRole('button', { name: '獲得の希望を変える', exact: true }).click();
    await tryout.page.getByRole('button', { name: '候補二郎の希望順位を上げる', exact: true }).click();
    // ⚠ 「やめる」は希望リストと候補一覧の両方に出る（同じ選手・同じ働き）ので、
    //    希望リスト側に絞って押す
    await tryout.page
      .locator('.online-tryout-wanted')
      .getByRole('button', { name: '候補一郎との交渉をやめる', exact: true })
      .click();
    const wantedNames = () =>
      tryout.page.locator('.online-tryout-wanted > ol > li .online-player-name').allInnerTexts();
    assert.deepEqual(await wantedNames(), ['候補二郎', '候補三郎'], 'スマホで希望順を入れ替えられない');
    await fitsPhone(tryout.page, 'トライアウトの獲得の希望');
    await tryout.page.getByRole('button', { name: 'この内容で決定', exact: true }).click();
    await tryout.page.getByRole('group', { name: '決定の確認', exact: true }).waitFor();
    const planned = await tryout.page.locator('.online-phase-contents').innerText();
    assert.ok(
      planned.includes('候補二郎') && planned.includes('候補三郎') && !planned.includes('候補一郎'),
      `確認で入れ替えた獲得予定が出ない: ${planned}`,
    );
    await tryout.page.getByRole('button', { name: '決定する', exact: true }).click();
    await tryout.page.getByText('決定しました', { exact: true }).waitFor();
    assert.deepEqual(
      tryout.payloads.at(-1).plan,
      // ⚠ 獲得する人数（`total`）も一緒に送る。触っていなければ空き枠いっぱい（名簿1人＝空き25）
      { count: 2, rankedIds: [102, 103], total: 25 },
      'スマホで入れ替えた希望順が送られない（やめた人は希望リストから消える）',
    );
    await tryout.context.close();

    // 初期メンバー: どんなセットか（特徴と構成）
    const packPhase = () => ({
      id: '1:pack_select',
      kind: 'pack_select',
      label: '初期メンバー選択',
      submission: null,
      packs: [
        {
          id: 'p1',
          name: '検証セット',
          feature: '投手厚め',
          counts: { pitcher: 13, catcher: 2, infield: 5, outfield: 4 },
          ranks: { A: 2, B: 10, C: 12 },
          averageAge: 21.5,
          twoWay: 2,
          players: [],
        },
        {
          id: 'p2',
          name: '検証セット2',
          feature: '野手厚め・粒ぞろい',
          counts: { pitcher: 10, catcher: 2, infield: 7, outfield: 5 },
          ranks: { A: 0, B: 14, C: 10 },
          averageAge: 21.8,
          twoWay: 1,
          players: [
            {
              id: 201,
              name: '検証 二塁手',
              rank: 'B',
              age: 22,
              position: 'second',
              isTwoWay: true,
              batting: { meet: 55, power: 40 },
              physical: { speed: 60 },
              fielding: { defense: 55 },
              pitching: { velocity: 130, control: 30 },
            },
          ],
        },
      ],
    });
    const pack = await scene({ mobile: true, phase: packPhase(), defaultPlan: { packId: 'p1' } });
    await click(pack.page, '手続き');
    await pack.page.locator('.online-phase-contents').waitFor();
    const chosen = await pack.page.locator('.online-phase-contents').innerText();
    assert.match(chosen, /初期メンバー「検証セット」/, `選んだセットが出ない: ${chosen}`);
    assert.match(chosen, /投手厚め · 投13 捕2 内5 外4/, `セットの中身が出ない: ${chosen}`);
    // ⚠ **名前の欄はセットの一覧（編集）を開かなくても出る**（再監査 B5）。以前は編集の中に
    //    しか無く、標準のセットのまま決定すると名前を一度も見ずに終わっていた
    await pack.page
      .getByRole('button', { name: 'この名前にする', exact: true })
      .waitFor({ timeout: 3000 })
      .catch(() => {
        throw new Error('スマホの初期メンバー選択で、編集を開かないと名前の欄が出ない');
      });
    await fitsPhone(pack.page, '初期メンバーの選択（名前の欄）');
    // あとから変える入口も下の「☰」にある（PCの左メニューの「名前を変える」と同じ小窓）
    await pack.page.getByRole('button', { name: 'メニュー', exact: true }).click();
    await pack.page.getByRole('button', { name: '名前を変える', exact: true }).click();
    const renameDialog = pack.page.getByRole('dialog', { name: '球団名・名前・ひとこと' });
    await renameDialog.waitFor();
    await fitsPhone(pack.page, '名前を変える小窓');
    await renameDialog.getByRole('button', { name: '閉じる', exact: true }).click();
    await renameDialog.waitFor({ state: 'detached' });
    // ⚠ **スマホでもセットを選び直して決められる**（判断1・案B）。以前は「変えるときはPCで」と
    //    書くだけで、スマホだけの人は標準案のセットのまま決めるしかなかった
    await pack.page.getByRole('button', { name: 'セットを見比べて選ぶ', exact: true }).click();
    const chosenNote = pack.page.locator('.online-actions .online-phase-chosen');
    assert.equal(await chosenNote.count(), 0, '選択中のセットを見ているのに添え書きが出る');
    await pack.page.locator('.online-pack-card').filter({ hasText: '検証セット2' }).click();
    // ⚠ **別のセットを見ている間は、下の帯に決定するのは選択中のセットだと添える**（画面の見回り F13）。
    //    以前は見ているセットと関係なく「この内容で決定」だけで、確認に出るのは選択中のセットだった
    await chosenNote.waitFor({ timeout: 3000 }).catch(() => {
      throw new Error('別のセットを見ている間、下の帯に「決定するのは選択中の…」が出ない');
    });
    assert.equal(await chosenNote.innerText(), '決定するのは選択中の「検証セット」です');
    await fitsPhone(pack.page, '初期メンバーの選択（選択中の添え書き）');
    await pack.page.getByRole('button', { name: 'このセットにする', exact: true }).click();
    await pack.page.getByRole('button', { name: '選択中', exact: true }).waitFor();
    assert.equal(await chosenNote.count(), 0, '見ているセットを選んだのに添え書きが残る');
    assert.match(
      await pack.page.locator('.online-phase-status').innerText(),
      /編集中の内容（未保存）です。/,
      '選び直しても編集中と出ない',
    );
    // 名前の欄もセットの下に出る（PCと同じ手順: セット → 名前 → 決定）。編集の外の欄と2つ並ばない
    await pack.page.getByRole('button', { name: 'この名前にする', exact: true }).waitFor();
    assert.equal(await pack.page.locator('.online-identity').count(), 1, '名前の欄が2つ並ぶ');
    await fitsPhone(pack.page, '初期メンバーの選択');
    // 決める前の確認では、選び直したセットを見せる（編集は閉じる）
    await pack.page.getByRole('button', { name: 'この内容で決定', exact: true }).click();
    const packConfirm = pack.page.getByRole('group', { name: '決定の確認', exact: true });
    await packConfirm.waitFor();
    assert.match(
      await pack.page.locator('.online-phase-contents').innerText(),
      /初期メンバー「検証セット2」/,
      '確認で選び直したセットが出ない',
    );
    assert.equal(pack.payloads.length, 0, '確認の前に決定を送っている');
    await packConfirm.getByRole('button', { name: '決定する', exact: true }).click();
    await pack.page.getByText('決定しました', { exact: true }).waitFor();
    assert.deepEqual(pack.payloads.at(-1).plan, { packId: 'p2' }, 'スマホで選び直したセットが送られない');
    assert.equal(pack.payloads.at(-1).ready, true);
    await pack.context.close();

    // ⚠ **決めずに下書きとして残せる**（PC・アプリと同じ「下書きを保存」）。決定しか無いと、
    //    決めかねて離れた編集は締め切りで標準案に戻る
    const draftPack = await scene({ mobile: true, phase: packPhase(), defaultPlan: { packId: 'p1' } });
    await click(draftPack.page, '手続き');
    await draftPack.page.getByRole('button', { name: 'セットを見比べて選ぶ', exact: true }).click();
    await draftPack.page.locator('.online-pack-card').filter({ hasText: '検証セット2' }).click();
    await draftPack.page.getByRole('button', { name: 'このセットにする', exact: true }).click();
    await draftPack.page.getByRole('button', { name: '下書きを保存', exact: true }).click();
    await draftPack.page.getByText('下書きを保存しました', { exact: true }).waitFor();
    assert.deepEqual(
      [draftPack.payloads.at(-1).plan, draftPack.payloads.at(-1).ready],
      [{ packId: 'p2' }, false],
      '「下書きを保存」で選び直したセットが下書きとして送られない',
    );
    await draftPack.page.locator('.online-phase-status').filter({ hasText: '保存済みの内容です。' }).waitFor();
    await draftPack.context.close();
  }

  // --- 進行時刻の説明は刻みから作る（u1 低19） -----------------------------
  // ⚠ 以前は「各時刻に1日進みます」で、実時間の1日かゲーム内の1日か分からなかった。
  //    検証モードの説明も「実時間1時間」のまま（いまは45分）だった
  {
    const clock = await scene();
    await click(clock.page, '進行時刻');
    const dialog = clock.page.getByRole('dialog', { name: '進行時刻', exact: true });
    await dialog.waitFor();
    assert.ok(
      (await dialog.innerText()).includes(`${TURN_MINUTES}分ごとに1ターン（ゲーム内の1日）進みます`),
      `進行時刻の説明が刻みと合っていない: ${await dialog.innerText()}`,
    );
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await clock.context.close();
  }

  // --- 止まったときに、その場から再開できること --------------------------
  // ⚠ **行き止まりにしない**。定期進行が止まると「1日程進める」も押せなくなり、
  //    なぜ進まないのかも、どこで直すのかも画面から分からなかった。
  //    （45分ターンにしたとき、毎時のcronのままだと必ずここへ落ちていた）
  {
    const stopped = await scene();
    stopped.view.testMode = true;
    stopped.view.status = 'error';
    stopped.view.phase = null;
    stopped.view.error = '定期進行が長く止まっていました。状態を確認して管理者が再開してください';
    stopped.view.revision++;
    await click(stopped.page, '更新');
    // 知らせの中にも、検証用の帯にも再開を出す
    await stopped.page
      .getByRole('alert')
      .filter({ hasText: '長く止まって' })
      .getByRole('button', { name: '次の時刻から再開', exact: true })
      .waitFor();
    await stopped.page
      .getByRole('button', { name: '止まっています（再開）', exact: true })
      .click();
    await withDeadline(stopped.commandStarted, '再開の送信');
    assert.deepEqual(stopped.types, ['resume'], '再開以外の命令を送っている');
    await stopped.context.close();
  }

  const mobile = await scene({ mobile: true });
  // 締め切りを出す（見出しの横に並び、360px で見出しを押し縮めていた）
  mobile.view.phase.deadline = '2026-11-02T15:00:00.000Z';
  await mobile.page.reload();
  await click(mobile.page, '手続き');
  // ⚠ 携帯でも**4クールを自分で回せること**。表は出せない（23列は入らない）が、
  //    育成方針と実行だけ出す。出さないと携帯だけの人は全部自動になる
  await mobile.page
    .getByText('選手ごとの練習はPCで選べます', { exact: false })
    .waitFor();
  // ⚠ 既定の決め方は**おすすめ**（方針は選手ごと）。全員同じ方針にすると
  //    育成方針・段階が出る
  assert.equal(
    await mobile.page
      .getByRole('button', { name: '⚔️ 長所を伸ばす', exact: true })
      .count(),
    0,
    'おすすめなのに全員の育成方針が出ている',
  );
  await mobile.page
    .getByRole('button', { name: '全員同じ方針', exact: true })
    .click();
  await mobile.page
    .getByRole('button', { name: '⚔️ 長所を伸ばす', exact: true })
    .click();
  // ⚠ スマホのキャンプの決め方は**画面の幅に収める**。PCと同じく見出しの横に
  //    ボタンを並べていて、見出しが縦に割れ（決／め／方）、ボタンが右へはみ出していた。
  //    決め方の説明も … で止めず全文を出す（title はタッチで読めない）
  const campFit = await mobile.page.evaluate(() => {
    const out = [];
    for (const n of document.querySelectorAll(
      '.online-camp-bulk .online-choice-label, .online-camp-bulk button',
    )) {
      const r = n.getBoundingClientRect();
      if (r.right > innerWidth + 1) out.push(`はみ出し ${n.innerText}`);
      if (n.matches('.online-choice-label') && r.height > parseFloat(getComputedStyle(n).lineHeight) * 1.5)
        out.push(`見出しが割れる ${n.innerText}`);
    }
    const note = document.querySelector('.online-camp-guide-note');
    if (note && note.scrollWidth > note.clientWidth + 1) out.push('決め方の説明が切れる');
    return out;
  });
  assert.deepEqual(campFit, [], 'スマホのキャンプの決め方が幅に収まらない');
  // ⚠ 見出し「春季キャンプ」は縮めない。360px で「春季キャン／プ」と割れた
  await mobile.page.setViewportSize({ width: 360, height: 844 });
  assert.deepEqual(
    await shortLastLines(mobile.page, '.online-camp-head h3'),
    [],
    '360px でキャンプの見出しが1文字だけ次の行に落ちる',
  );
  await mobile.page.setViewportSize({ width: 390, height: 844 });
  await mobile.page
    .getByRole('button', { name: '第1クール練習を実行', exact: true })
    .click();
  await mobile.page.getByText('第1クールの練習を実行しました', { exact: true }).waitFor();
  // ⚠ **キャンプでは標準案を取りに行かない**（提出する案が無い。世界を読むので重い）
  assert.equal(mobile.defaultsRequests, 0, 'スマホのキャンプで使わない標準案を取りに行っている');
  assert.equal(
    await mobile.page.getByText('標準案を準備しています…', { exact: true }).count(),
    0,
    'キャンプで「標準案を準備しています」が出ている',
  );
  // ⚠ スマホの「保存しました」は**浮かせる**（本文を押し下げない・左を切らない）。
  //    重なりの順を上げる指定で `position: relative` に上書きされ、本文の流れに入っていた
  const toast = await mobile.page.locator('.online-success').evaluate((node) => {
    const r = node.getBoundingClientRect();
    return {
      position: getComputedStyle(node).position,
      left: Math.round(r.left),
      right: Math.round(r.right),
      width: innerWidth,
    };
  });
  assert.ok(
    toast.position === 'fixed' && toast.left >= 0 && toast.right <= toast.width,
    `スマホの「保存しました」が浮いていない・はみ出す: ${JSON.stringify(toast)}`,
  );
  assert.equal(mobile.payloads[0].round, 1, '何クール目かを送る');
  assert.equal(mobile.payloads[0].policy.direction, 'sharpen');
  assert.equal(mobile.payloads[0].policy.mode, 'team');
  // ⚠ 携帯でも**選手ごとの割り当てを送る**（方針から決まる既定）。送らないと
  //    サーバー側の既定と食い違う
  assert.deepEqual(Object.keys(mobile.payloads[0].main), ['1']);
  assert.deepEqual(Object.keys(mobile.payloads[0].sub), ['1']);
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
  // ⚠ PCの選手成績は**ページ送りをしない**（全員を1枚に）。人数が減っても
  //    取り残された行が出ないことを見る（ページ送りの縮小はリーグ便りで見る）
  await click(pages.page, '選手成績');
  const rosterRows = pages.page.locator('.online-roster-rows article');
  await pages.page.waitForFunction(
    () => document.querySelectorAll('.online-roster-rows article').length === 21,
  );
  assert.equal(await pages.page.locator('.online-pager').count(), 0, 'PCはページ送りなし');
  pages.view.roster = pages.view.roster.slice(0, 4);
  pages.view.revision++;
  await click(pages.page, '更新');
  await pages.page.waitForFunction(
    () => document.querySelectorAll('.online-roster-rows article').length === 4,
  );
  assert.equal(await rosterRows.count(), 4);
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
  // ⚠ 入口の名前は、行った先の見出しの名前（u1 低30）
  await click(news.page, 'リーグの話題・リーグ便り →');
  await news.page.getByRole('heading', { name: 'リーグ便り', exact: true }).waitFor();
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
    'online-edit-ui-check PASS（配布HTML・標準案の再取得/世代検証・送信中入力・スマホ確認・一覧縮小・キャンプのクールの版ずれの送り直し / APIはfixture）',
  );
} catch (error) {
  await failureShots(browser, 'online-edit-ui');
  throw error;
} finally {
  await browser.close();
}
