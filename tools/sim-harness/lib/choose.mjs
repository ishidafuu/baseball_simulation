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
