/**
 * 最後に受け取ったビュー（と接続の設定）を端末に残し、次に開いたときにすぐ出す。
 *
 * 【なぜ】PC版は開くたびに「接続を確認しています…」「リーグを読み込んでいます…」を待っていた。
 *   アプリは前回のビューをすぐ出して裏で読み直している（`SessionStore.viewJson`）。同じ形にする。
 *
 * ⚠ 出すのは**同じ人・同じ端末のログイン**のときだけ（`userId` と `sessionId` が一致）。
 * ⚠ 残したビューの世代（`viewGeneration`）を読み直しの `since` に使う。何も変わっていなければ
 *    サーバーはビューを送らず、残したものがそのまま最新になる。変わっていれば差し替わる。
 * ⚠ 参加前・作成前・形の取り込み待ちの画面は残さない（そこは毎回サーバーの答えで出す）。
 * ⚠ 容量が足りないなどで残せなくても、黙って残さないだけにする（画面は普段どおり読む）。
 * ⚠ **残すのは、いま端末でログインしている人のビューだけ**（`saveView` が保存のログインと照らす）。
 *    別のタブでログアウトしたあとも、古いタブの定期の読み直しが前の人のビューを書き戻していた
 *    （ログアウトしたのに前の人の名簿・成績が端末に残る）。
 * ⚠ **版（`schema`）が今のコードと違うビューは出さない**。ゲームを更新した直後に前の形の
 *    ビューをそのまま描くと、無い項目を読んで画面ごと落ちうる。落ちたときは
 *    `main.jsx` の `OnlineBoundary` が残したビューを忘れる（再読込でまた同じビューで落ちないように）。
 */
import { ONLINE_SCHEMA } from './shared.js';
import { readAuth, sameSession } from './authState.js';

export const VIEW_KEY = 'baseball-online-view-v1';
export const CONFIG_KEY = 'baseball-online-config-v1';

const local = () => (typeof localStorage === 'undefined' ? null : localStorage);

export function readSavedView(auth, storage = local()) {
  if (!auth || !storage) return null;
  try {
    const saved = JSON.parse(storage.getItem(VIEW_KEY) || 'null');
    if (
      !saved?.view ||
      typeof saved.view !== 'object' ||
      saved.userId !== auth.userId ||
      saved.sessionId !== auth.sessionId ||
      saved.view.schema !== ONLINE_SCHEMA
    )
      return null;
    return saved.view;
  } catch {
    return null;
  }
}

/** 残したビューの時刻（`readSavedView` と同じ照合。無ければ null） */
export function readSavedViewAt(auth, storage = local()) {
  if (!readSavedView(auth, storage)) return null;
  try {
    const at = JSON.parse(storage.getItem(VIEW_KEY) || 'null')?.savedAt;
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

export function saveView(auth, view, storage = local()) {
  if (!auth || !storage || !view) return;
  // 端末のログインが別の人（またはログアウト済み）なら書かない。消しもしない
  // （今ログインしている人の残したビューは、その人のもの）
  if (!sameSession(readAuth(storage), auth)) return;
  if (view.setupRequired || view.joinRequired || view.versionMismatch) {
    forgetView(storage);
    return;
  }
  try {
    storage.setItem(
      VIEW_KEY,
      // ⚠ 残した時刻も持つ（留守中のまとめの「前回（11/14 7:00）から」。`awaySummary.js`）
      JSON.stringify({ userId: auth.userId, sessionId: auth.sessionId, view, savedAt: Date.now() }),
    );
  } catch {
    forgetView(storage);
  }
}

export function forgetView(storage = local()) {
  try {
    storage?.removeItem(VIEW_KEY);
  } catch {
    /* 消せなくても、次に開いたときに別の人のものとしては出さない（照合している） */
  }
}

/** 接続の設定（`config`）。中身は小さく、変わることはまず無い。開いた直後に使い、裏で取り直す */
export function readSavedConfig(storage = local()) {
  try {
    const saved = JSON.parse(storage?.getItem(CONFIG_KEY) || 'null');
    return saved && typeof saved === 'object' && typeof saved.local === 'boolean'
      ? saved
      : null;
  } catch {
    return null;
  }
}

export function saveConfig(config, storage = local()) {
  try {
    storage?.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* 残せなくても次は取りに行くだけ */
  }
}
