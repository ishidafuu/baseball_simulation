import { createContext, useContext, useEffect, useState } from 'react';
export const ReadContext = createContext(null);
/**
 * 読むだけの窓口を読む。⚠ 覚えている答え（`readCache.js`。版が同じ間）があれば、
 * 「読み込み中」を挟まずにすぐ出す（開き直すたびに待たされていた）。
 *
 * `keep`: 読み直している間も前の答えを残す（`loading` は true）。版（revision）が上がるたびに
 * 開いている小窓が一度閉じて開き直り、選んだ期間や場面が戻っていた（監査 2026-11-14）。
 * ⚠ 別のものを読み直すとき（球団を切り替えたなど）にも前の答えが残るので、使う側は答えの中身
 *    （`data.teamName` など）で今のものか確かめること
 */
export function useRead(action, query, { keep = false } = {}) {
  const read = useContext(ReadContext);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(() => {
    const hit = action ? read?.peek?.(action, query) : undefined;
    return hit !== undefined
      ? { data: hit, error: '', loading: false }
      : { data: null, error: '', loading: !!action };
  });
  const key = JSON.stringify(query);
  useEffect(() => {
    if (!action) return;
    let cancelled = false;
    const hit = read?.peek?.(action, JSON.parse(key));
    if (hit !== undefined) {
      setResult((old) =>
        old.data === hit && !old.loading && !old.error
          ? old
          : { data: hit, error: '', loading: false },
      );
      return;
    }
    setResult((old) =>
      keep && old.data != null
        ? { ...old, error: '', loading: true }
        : { data: null, error: '', loading: true },
    );
    Promise.resolve()
      .then(() => {
        if (!read) throw new Error('ログイン状態を確認できません');
        return read(action, JSON.parse(key));
      })
      .then((data) => {
        if (!cancelled) setResult({ data, error: '', loading: false });
      })
      .catch((error) => {
        if (!cancelled)
          setResult({ data: null, error: error.message, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [action, key, attempt, read, keep]);
  return { ...result, retry: () => setAttempt((n) => n + 1) };
}
