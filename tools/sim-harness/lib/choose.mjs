// 選択肢を選ぶ／いま選ばれている値を読む。
// ⚠ 2026-11 から、選択肢が5個以下ならボタンの並び（`Segmented`、各ボタンに data-value）、
//    6個以上ならセレクトで出す（src/online/ui.jsx）。検査はどちらでも同じ書き方で済むようにする。
export async function choose(scope, label, value) {
  const control = scope.getByLabel(label, { exact: true }).first();
  await control.waitFor();
  const tag = await control.evaluate((e) => e.tagName);
  if (tag === 'SELECT') return control.selectOption(String(value));
  if (tag === 'INPUT') return control.fill(String(value));
  await control.locator(`button[data-value="${value}"]`).click();
}
export async function chosen(scope, label) {
  const control = scope.getByLabel(label, { exact: true }).first();
  await control.waitFor();
  if (['SELECT', 'INPUT'].includes(await control.evaluate((e) => e.tagName)))
    return control.inputValue();
  return control.locator('button[aria-pressed="true"]').getAttribute('data-value');
}

/**
 * 並べ替えの行を1つ動かす（打順・ローテ・獲得希望）。
 * ⚠ 2026-11 から ↑↓ ボタンは無く、行の「≡」つまみをドラッグするか、
 *    つまみにフォーカスして ↑ / ↓ キーで動かす。検査はキーで動かす。
 * `index` は0始まりの行番号、`key` は 'ArrowUp' か 'ArrowDown'。
 */
export async function moveRow(scope, listSelector, index, key = 'ArrowUp') {
  const handle = scope
    .locator(`${listSelector} > li`)
    .nth(index)
    .locator('.online-drag-handle');
  // ⚠ 押せるようになるまで待つ（開いた直後は端末に残した古い画面＝閲覧のみで、つまみが無効）
  await handle.click({ trial: true });
  await handle.focus();
  await handle.press(key);
}
/** 打順の n 番を1つ上げる（以前の「n番を上げる」ボタンと同じ） */
export const raiseBatter = (scope, n) =>
  moveRow(scope, '.online-order-list.is-batting', n - 1, 'ArrowUp');

/** 獲得希望人数を ± ボタンで n 人にする（2026-11 から数字の入力欄は無い） */
export async function setWantedCount(scope, n) {
  const output = scope.locator('.online-stepper output');
  for (let i = 0; i < 40; i++) {
    const now = Number((await output.innerText()).replace(/[^0-9]/g, ''));
    if (now === n) return;
    await scope
      .getByRole('button', {
        name: now < n ? '獲得希望人数を増やす' : '獲得希望人数を減らす',
        exact: true,
      })
      .click();
  }
  throw new Error(`獲得希望人数を${n}人にできない`);
}
export const wantedCount = async (scope) =>
  Number((await scope.locator('.online-stepper output').innerText()).replace(/[^0-9]/g, ''));
