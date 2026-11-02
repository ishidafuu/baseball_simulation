// 開発用の道具（早送りなど）を出すかどうか。
//
// - `npm run dev` の開発サーバーでは常に出す。
// - 配布用のビルドでも、URL に `?dev=1` を付けて開けば出す（そのタブの間は覚えておく）。
//   画面検査（Playwright）は本番と同じビルドで回すので、こちらで出す。
//   ⚠ 開発サーバーは StrictMode で effect を2回走らせるので、成績の数え方を確かめるときは
//      ビルド＋ `?dev=1` を使う（CLAUDE.md「采配後の日の再開」を参照）。
// - `?dev=0` で消せる。
//
// 遊ぶ人の画面には出ない。ゲームの進み方そのものは変えない（早送りは「1日進める」を
// 押すのと同じ処理を繰り返すだけ）。
const KEY = 'baseballSim_devTools';

export function isDevToolsEnabled() {
  try {
    const flag = new window.URLSearchParams(window.location.search).get('dev');
    if (flag === '1') sessionStorage.setItem(KEY, '1');
    if (flag === '0') sessionStorage.removeItem(KEY);
    if (flag === '0') return false;
    return Boolean(import.meta.env?.DEV) || sessionStorage.getItem(KEY) === '1';
  } catch {
    return Boolean(import.meta.env?.DEV);
  }
}
