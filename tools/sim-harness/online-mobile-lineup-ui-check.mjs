// スマホ（767px以下）の打順（`src/online/TapLineup.jsx`。**2回のタップで入れ替える表**）を
// 実画面で操作する。配布HTML（dist/index.html）を開き、通信はこの検査の中のリーグへつなぐ
// （`lib/serviceRoute.mjs`。保存はサーバーの `validateLineup` を通る）。
//
// 見ること:
//  - 320px（縦）と 667×375（横向き）で横にはみ出さない・文を1字だけ次の行へ落とさない・
//    押す的（守備位置の札・名前の行）が44px
//  - 名前 → 名前で打順、守備位置の札 → 相手で守備位置、スタメン ⇔ 控えで交代
//  - 選んだ行に「選択中」が付く。同じ行をもう一度押す・「やめる」で選ぶのをやめる
//  - 守れない位置へ入れると、知らせと「気になる所」に注意が出る（PCと同じ適性の線）
//  - DHなし: 投手は9番で固定（押しても選べない）。保存は野手8人（1〜8番）
//  - 元に戻す（1手ずつ）・変更を取り消す
//  - タブの移動・再読み込みで保存していない編集が残る。PCの幅（スタメン設定）へ切り替えても渡る
//  - 保存して読み直しても残る
import assert from 'node:assert/strict';
import { copyFile } from 'node:fs/promises';
import { launchBrowser, distHtml } from './lib/browser.mjs';
import { seasonService, routeToService } from './lib/serviceRoute.mjs';
import { shortLastLines } from './lib/textWrap.mjs';
import { positionFitness, LOW_FITNESS } from '../../src/online/lineupEdit.js';
import { failureShots } from './lib/failureShots.mjs';

const html = await distHtml();
const base = 'http://localhost:3000';
const browser = await launchBrowser();
const errors = [];
const shots = [];
try {
  const fixture = await seasonService({ days: 6 });
  const serverView = () =>
    fixture.service.view(fixture.userId, fixture.sessionId);
  const context = await browser.newContext({
    viewport: { width: 320, height: 640 },
  });
  const { commands } = await routeToService(context, fixture);
  await context.route(`${base}/online`, (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${base}/online`);
  const openLineup = async () => {
    await p.getByRole('button', { name: '打順', exact: true }).click();
    await p
      .locator('ol[aria-label="スタメン"] > li[data-slot]')
      .first()
      .waitFor({ timeout: 10000 })
      .catch(() => {
        throw new Error('スマホの「打順」に2回のタップで入れ替える表が無い');
      });
  };
  await openLineup();

  const row = (n) => p.locator(`ol[aria-label="スタメン"] > li[data-slot="${n}"]`);
  const tapName = (n) => row(n).locator('button.online-tap-main').click();
  const tapPos = (n) => row(n).locator('button.online-tap-pos').click();
  const bench = (id) => p.locator(`li[data-bench="${id}"]`);
  const click = (name) => p.getByRole('button', { name, exact: true }).click();
  // 打順1〜8の「守備位置:名前」
  const slots = () =>
    p
      .locator('ol[aria-label="スタメン"] > li[data-slot]')
      .evaluateAll((list) =>
        list
          .filter((li) => li.dataset.slot !== '9')
          .map(
            (li) =>
              `${li.querySelector('.online-tap-pos').textContent}:${li.querySelector('.online-tap-name')?.textContent ?? ''}`,
          ),
      );
  const selected = () =>
    p.locator('.online-tap-row.is-selected, .online-tap-row.is-picking').count();
  const status = () => p.locator('.online-tap-status p').innerText();

  // ---- 見た目（320px）--------------------------------------------------
  const layout = async (label) => {
    const overflow = await p.evaluate(() => {
      const main = document.querySelector('main');
      const bad = [...document.querySelectorAll('.online-tap *')]
        .filter((el) => el.checkVisibility?.())
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.left < -1 || r.right > window.innerWidth + 1);
        })
        .map((el) => el.className || el.tagName)
        .slice(0, 5);
      return {
        page: document.documentElement.scrollWidth - window.innerWidth,
        main: main.scrollWidth - main.clientWidth,
        bad,
      };
    });
    assert.ok(
      overflow.page <= 0 && overflow.main <= 0 && !overflow.bad.length,
      `${label} 横にはみ出す: ${JSON.stringify(overflow)}`,
    );
    assert.deepEqual(
      await shortLastLines(p, '.online-tap'),
      [],
      `${label} 文が1字だけ次の行へ落ちる`,
    );
    const small = await p
      .locator('.online-tap button')
      .evaluateAll((list) =>
        list
          .filter((b) => b.checkVisibility?.())
          .map((b) => {
            const r = b.getBoundingClientRect();
            return [b.textContent.trim().slice(0, 8), Math.round(r.width), Math.round(r.height)];
          })
          .filter(([, w, h]) => h < 44 || w < 44),
      );
    assert.deepEqual(small, [], `${label} 押す的が44pxに足りない`);
  };
  await layout('320px');
  for (const mode of ['今季成績', '守備適性', '能力']) {
    await click(mode);
    await layout(`320px（${mode}）`);
  }

  // ---- DHなし: 投手は9番で固定 ------------------------------------------
  const saved = await slots();
  assert.equal(saved.length, 8, 'スタメンの野手が8行でない');
  assert.equal(await row(9).locator('button').count(), 0, '9番（投手）の行が押せる');
  assert.equal(
    (await row(9).locator('.online-tap-pos').innerText()).trim(),
    '投',
    '9番が投手でない',
  );
  assert.match(await row(9).innerText(), /投手は9番で打ちます/);
  await row(9).click();
  assert.equal(await selected(), 0, '9番（投手）の行を押すと選べてしまう');

  // ---- 名前 → 名前: 打順の入れ替え（守備位置は選手に付いたまま）----------
  await tapName(1);
  assert.match(await row(1).getAttribute('class'), /is-selected/, '選んだ行が目立たない');
  assert.equal(await row(1).locator('.online-tap-picked').innerText(), '選択中');
  assert.match(await status(), /1番 .+を選択中/);
  await p.screenshot({ path: '/tmp/baseball-online-mobile-lineup-320-selected.png' });
  shots.push('/tmp/baseball-online-mobile-lineup-320-selected.png');
  await tapName(3);
  const swapped = [saved[2], saved[1], saved[0], ...saved.slice(3)];
  assert.deepEqual(await slots(), swapped, '名前→名前で打順が入れ替わらない');
  assert.equal(await selected(), 0, '入れ替えたあとも選んだままになっている');
  assert.match(await status(), /にしました/, '何をしたかの知らせが出ない');

  // ---- 選び直し: 同じ行をもう一度・「やめる」-----------------------------
  await tapName(2);
  await tapName(2);
  assert.equal(await selected(), 0, '同じ行をもう一度押しても選ぶのをやめない');
  await tapName(2);
  await click('やめる');
  assert.equal(await selected(), 0, '「やめる」で選ぶのをやめない');
  assert.deepEqual(await slots(), swapped, '選び直しで打順が変わった');

  // ---- 2回目は相手の行のどこでもよい: 名前 → 相手の札でも打順の入れ替え -------
  await tapName(1);
  await tapPos(3);
  assert.deepEqual(await slots(), saved, '名前→相手の守備位置の札で打順が入れ替わらない');
  await tapName(3);
  await tapName(1);
  assert.deepEqual(await slots(), swapped);

  // ---- 守備位置の札 → 相手: 守備位置の入れ替え（打順はそのまま）-----------
  await tapPos(1);
  assert.match(await status(), /の守備（.+）を選択中/);
  await tapName(2);
  const [pos1, name1] = swapped[0].split(':');
  const [pos2, name2] = swapped[1].split(':');
  const positioned = [`${pos2}:${name1}`, `${pos1}:${name2}`, ...swapped.slice(2)];
  assert.deepEqual(await slots(), positioned, '守備位置の札→相手で守備位置が入れ替わらない');

  // ---- スタメン → 控え・控え → スタメン: 交代 -----------------------------
  await tapName(4);
  const candidates = p.locator('li[data-bench-group="candidates"]');
  await candidates.first().waitFor();
  const firstId = await candidates.first().getAttribute('data-bench');
  const firstName = await bench(firstId).locator('.online-tap-name').innerText();
  await bench(firstId).locator('button.online-tap-main').click();
  const replaced = [...positioned];
  replaced[3] = `${positioned[3].split(':')[0]}:${firstName}`;
  assert.deepEqual(await slots(), replaced, 'スタメン→控えで交代しない（打順・守備位置を引き継ぐ）');
  const otherId = await p
    .locator('li[data-bench]:not([data-bench-group="pitcher"])')
    .first()
    .getAttribute('data-bench');
  const otherName = await bench(otherId).locator('.online-tap-name').innerText();
  await bench(otherId).locator('button.online-tap-main').click();
  assert.match(await status(), /控えの.+を選択中/);
  await tapName(5);
  const replaced2 = [...replaced];
  replaced2[4] = `${replaced[4].split(':')[0]}:${otherName}`;
  assert.deepEqual(await slots(), replaced2, '控え→スタメンで交代しない');

  // ---- 守れない位置へ入れたときの注意 ----------------------------------
  const view = await serverView();
  const byName = new Map(view.roster.map((pl) => [pl.name, pl]));
  const POS_KEY = { 捕: 'catcher', 一: 'first', 二: 'second', 三: 'third', 遊: 'short', 左: 'left', 中: 'center', 右: 'right' };
  const current = await slots();
  const catcherAt = current.findIndex((s) => s.startsWith('捕:'));
  const unfitAt = current.findIndex(
    (s, i) =>
      i !== catcherAt &&
      positionFitness(byName.get(s.split(':')[1]), 'catcher') < LOW_FITNESS,
  );
  assert.ok(catcherAt >= 0 && unfitAt >= 0, '捕手を守れない野手が居ない（検査の前提）');
  await tapPos(catcherAt + 1);
  await tapName(unfitAt + 1);
  assert.match(
    await status(),
    /守備で失点しやすい位置です：.*捕手の適性\d+/,
    '守れない位置へ入れても注意が出ない',
  );
  const notes = p.getByRole('region', { name: '気になる所' });
  assert.match(await notes.innerText(), /捕手の適性\d+。守備で失点しやすい/);
  assert.ok(
    (await row(unfitAt + 1).locator('.online-tap-fit.is-low').count()) === 1,
    '守れない位置の適性が赤くならない',
  );
  await layout('320px（気になる所と注意を出したとき）');
  await p.screenshot({ path: '/tmp/baseball-online-mobile-lineup-320-warning.png' });
  shots.push('/tmp/baseball-online-mobile-lineup-320-warning.png');

  // ---- 元に戻す（1手ずつ）--------------------------------------------
  await click('元に戻す');
  assert.deepEqual(await slots(), replaced2, '元に戻すで1手前に戻らない');
  await click('元に戻す');
  assert.deepEqual(await slots(), replaced, '元に戻すを2回で2手前に戻らない');
  const edited = replaced;

  // ---- タブの移動・再読み込み・PCの幅への切り替えで残る ----------------
  await click('ホーム');
  await openLineup();
  assert.deepEqual(await slots(), edited, 'タブを移ると編集が消える');
  await p.reload();
  await openLineup();
  assert.deepEqual(await slots(), edited, '再読み込みで編集が消える');
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p
    .locator('.online-page-nav')
    .getByRole('button', { name: 'スタメン設定', exact: true })
    .click();
  await p.locator('tbody[aria-label="スタメン"] tr[data-slot]').first().waitFor();
  const pcSlots = await p
    .locator('tbody[aria-label="スタメン"] tr[data-slot]')
    .evaluateAll((list) =>
      list.map(
        (r) =>
          `${r.querySelector('.online-lineup-pos').textContent}:${r.querySelector('.online-player-name').textContent}`,
      ),
    );
  assert.deepEqual(pcSlots, edited, 'PCの幅に切り替えるとスタメン設定に編集が渡らない');
  // PCで「スタメン設定」を開いていたので、スマホの幅に戻すと「打順」のタブのまま始まる
  await p.setViewportSize({ width: 320, height: 640 });
  await p.locator('ol[aria-label="スタメン"] > li[data-slot]').first().waitFor();
  assert.equal(
    await p.locator('.online-lineup-portal').count(),
    0,
    '打順だけの編集で全画面の編成が開いた',
  );
  assert.deepEqual(await slots(), edited, 'PCの幅から戻ると編集が消える');
  assert.equal(
    commands.filter((c) => c.type === 'lineup').length,
    0,
    '保存を押す前に送った',
  );

  // ---- 保存 → 読み直し -------------------------------------------------
  await click('保存');
  await p.getByText('編成を保存しました', { exact: true }).first().waitFor();
  const lineup = (await serverView()).lineup;
  assert.deepEqual(
    lineup.battingOrder.map((e) => e.battingOrder),
    [1, 2, 3, 4, 5, 6, 7, 8],
    '保存した打順が1〜8番でない',
  );
  assert.ok(
    lineup.battingOrder.every((e) => e.position !== 'pitcher'),
    '保存した野手の枠に投手の守備位置が入っている（DHなし）',
  );
  const after = await serverView();
  const names = new Map(after.roster.map((pl) => [pl.id, pl.name]));
  const POS_SHORT = Object.fromEntries(Object.entries(POS_KEY).map(([k, v]) => [v, k]));
  assert.deepEqual(
    lineup.battingOrder.map((e) => `${POS_SHORT[e.position]}:${names.get(e.playerId)}`),
    edited,
    'サーバーに保存した打順が画面と違う',
  );
  assert.match(await status(), /保存済み/);
  await p.reload();
  await openLineup();
  assert.deepEqual(await slots(), edited, '保存して読み直すと残らない');

  // ---- 変更を取り消す ------------------------------------------------
  await tapName(1);
  await tapName(8);
  assert.notDeepEqual(await slots(), edited);
  await click('変更を取り消す');
  assert.deepEqual(await slots(), edited, '変更を取り消すで保存済みに戻らない');
  await p.screenshot({ path: '/tmp/baseball-online-mobile-lineup-320.png' });
  shots.push('/tmp/baseball-online-mobile-lineup-320.png');

  // ---- 投手起用（PCと同じ表を全画面で出す。`MobilePitching.jsx`）-------------------
  await click('投手起用を開く（横向き推奨）');
  const portal = p.locator('.online-lineup-portal');
  await portal.waitFor();
  await portal.locator('tr[data-starter]').first().waitFor();
  await p.screenshot({ path: '/tmp/baseball-online-mobile-pitching-320.png' });
  shots.push('/tmp/baseball-online-mobile-pitching-320.png');
  // 2回のタップで先発の登板順を入れ替えて保存する（打順は触らない）
  const startersBefore = (await serverView()).lineup.starters;
  await portal.locator('tr[data-starter] .online-lineup-slot button').nth(0).click();
  await portal.locator('tr[data-starter] .online-lineup-slot button').nth(1).click();
  await portal.getByRole('button', { name: '保存', exact: true }).click();
  await portal.waitFor({ state: 'detached' });
  const afterPitching = (await serverView()).lineup;
  assert.deepEqual(
    afterPitching.starters,
    [startersBefore[1], startersBefore[0], ...startersBefore.slice(2)],
    'スマホの投手起用で入れ替えた登板順が保存されない',
  );
  assert.deepEqual(await slots(), edited, '投手起用を保存したら打順が変わった');
  await click('投手起用を開く（横向き推奨）');
  await portal.waitFor();
  // ⚠ 閉じた先は「打順」の表。ボタンの名前もそう書く（以前は「方針・采配の設定へ」。再監査 B6）
  await portal.getByRole('button', { name: '打順に戻る（保存しない）' }).click();
  await portal.waitFor({ state: 'detached' });
  assert.deepEqual(await slots(), edited, '全画面の編成を開いて閉じたら打順が変わった');
  // 方針・采配の「投手の役割（確認）」は、変える入口（投手起用を開く）を指す（以前は「PCから」）
  await click('方針・采配');
  const tactics = p.getByRole('dialog', { name: '方針・采配' });
  await tactics.waitFor();
  await tactics.getByRole('combobox', { name: '見る設定' }).selectOption('roles');
  assert.equal(
    await tactics.locator('.online-mobile-tactic-note').innerText(),
    '役割・ローテーションは「打順」の「投手起用を開く」で変えられます',
    '投手の役割の注記が、同じ画面にある入口を指していない',
  );
  await tactics.getByRole('button', { name: '打順に戻る', exact: true }).click();
  await tactics.waitFor({ state: 'detached' });

  // ---- 横向き（667×375。767px以下なのでスマホの表のまま）----------------
  await p.setViewportSize({ width: 667, height: 375 });
  await layout('667×375');
  await tapName(2);
  const bar = await p.locator('.online-tap-bar').boundingBox();
  assert.ok(
    bar.y >= 0 && bar.y + bar.height <= 375 - 48 + 1,
    `横向きで保存の帯が画面に収まらない: ${JSON.stringify(bar)}`,
  );
  assert.ok(bar.height <= 80, `横向きで保存の帯が高すぎる: ${bar.height}`);
  await p.screenshot({ path: '/tmp/baseball-online-mobile-lineup-667x375.png' });
  shots.push('/tmp/baseball-online-mobile-lineup-667x375.png');
  await click('やめる');

  // ---- 保存の応答を待つ間に別のタブへ移っても、戻ると「保存済み」（再監査 B1）----------
  // ⚠ 以前は保存できたのに、表が外れていたので保存済みの印が届かず、「打順」に戻ると
  //    「保存していない変更があります」「別の画面で打順が保存されました」が出て、
  //    もう一度保存すると断られた（409）。応答を止めて、その間に「⌂」を押す
  await p.setViewportSize({ width: 320, height: 640 });
  await tapName(1);
  await tapName(2);
  const savedSwap = await slots();
  assert.notDeepEqual(savedSwap, edited, '前提: 打順を入れ替えた');
  const command = fixture.service.command.bind(fixture.service);
  let release = null;
  const held = new Promise((resolve) => (release = resolve));
  fixture.service.command = async (...args) => {
    await held;
    return command(...args);
  };
  await click('保存');
  await p.locator('.online-tap-actions button.online-primary:disabled').waitFor();
  assert.ok(
    await p.getByRole('button', { name: '投手起用を開く（横向き推奨）' }).isDisabled(),
    '保存の応答を待つ間に「投手起用を開く」が押せる（古い起点の編集が全画面へ渡る）',
  );
  await click('ホーム');
  release();
  await p.getByText('編成を保存しました', { exact: true }).first().waitFor();
  fixture.service.command = command;
  await openLineup();
  assert.deepEqual(await slots(), savedSwap, '保存の途中でタブを移ると、保存した打順で開かない');
  assert.match(
    await status(),
    /保存済み/,
    '保存の途中でタブを移ると、戻ったときに保存した編集が「未保存」のまま残る',
  );
  assert.equal(
    await p.locator('.online-tap-warning').count(),
    0,
    '保存の途中でタブを移ると、戻ったときに「別の画面で打順が保存されました」が出る',
  );
  assert.deepEqual(
    (await serverView()).lineup.battingOrder.map((e) => names.get(e.playerId)),
    savedSwap.map((s) => s.split(':')[1]),
    '前提: サーバーに保存されている',
  );

  assert.deepEqual(errors, []);
  if (process.env.MOBILE_LINEUP_SHOTS)
    for (const shot of shots)
      await copyFile(shot, `${process.env.MOBILE_LINEUP_SHOTS}/${shot.split('/').pop()}`);
  console.log(
    'online-mobile-lineup-ui-check PASS（320px・667×375・打順/守備/交代の2タップ・2回目は相手の行のどこでも・選び直し・守れない位置の注意・DHなしの9番・元に戻す・取り消す・タブ移動/再読み込み/PCの幅で保持・保存して読み直し・投手起用の入口・保存の途中でタブを移っても保存済み）',
  );
} catch (error) {
  await failureShots(browser, 'online-mobile-lineup-ui');
  throw error;
} finally {
  await browser.close();
}
