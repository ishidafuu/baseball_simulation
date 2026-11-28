// 新しい見た目の入／切。⚠ **端末ごと**（この端末のブラウザに覚える）。**既定は入**。
//   保存・サーバーは触らない。切のときは今までと1画素も変わらないこと
//   （絵を描く部品は何も出さず、CSS は `.online-look` の下にだけ当てる。`look.css` の字の宣言と
//   絵の枠 `.online-look-art` は下に置かないが、切のときは使われないので字も読まない）。
// ⚠ 一人用の画面はこの文脈の外にある（`OnlineApp` だけが渡す）ので、いつも切。
// ⚠ **既定を切 → 入に変えた**（いしだ 2026-11-28「新しい見た目を、そのまま採用してください」）。
//    鍵は3つの状態を持つ: 'new'＝入（自分で選んだ）／'old'＝切（自分で選んだ）／無い＝既定（入）。
//    前は「無い＝切」で、切に戻すと鍵を消していた。その頃に切にしていた端末は鍵が無いので、
//    この変更で入になる（採用の趣旨どおり）。入にした字（`public/fonts/`。日本語は1つ約450KB）は
//    初めて開いたときに読むので、最初の表示が少し重くなる。
// ⚠ 画面の検査は「切」の画面を確かめる前提で書いてあるので、検査のブラウザは鍵が無ければ
//    'old' を置いてから開く（`tools/sim-harness/lib/browser.mjs` の `launchBrowser`）。
//    既定の入を確かめるときは `newContext({ lookDefault: true })` で開く。
import { createContext, useContext } from 'react';

export const LOOK_KEY = 'baseball-online-look-v1';

export function readLookSetting() {
  try {
    return globalThis.localStorage?.getItem(LOOK_KEY) !== 'old';
  } catch {
    return true;
  }
}
export function saveLookSetting(on) {
  try {
    globalThis.localStorage?.setItem(LOOK_KEY, on ? 'new' : 'old');
  } catch {
    // 保存できない（プライベートブラウズなど）ときは、この画面を開いている間だけ
  }
}

/**
 * `on` 入／切、`ownTeam` 自球団の内部名（顔の帽子に使う）、`setOn` 切り替え、
 * `baselineOf(team)` その球団の部の平均（成績の S〜F の札の物差し。`statGrade.js`）
 */
export const LookContext = createContext({ on: false, ownTeam: null, setOn: null, baselineOf: () => null });
export const useLook = () => useContext(LookContext);
