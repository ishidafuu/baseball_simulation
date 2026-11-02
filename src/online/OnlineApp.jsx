import React, { useCallback, useEffect, useRef, useState } from 'react';
import './online.css';
import { api, AUTH_KEY } from './api.js';
import { Login, JoinLeague } from './LeaguePanels.jsx';
import DesktopView from './DesktopView.jsx';
import MobileView from './MobileView.jsx';
import { ReadContext } from './useRead.js';
import { setTeamLabels, teamLabel, teamShort } from './gameText.js';
import { NotifyContext, formatJst, gameDay } from './ui.jsx';
import { Drafts } from './Drafts.jsx';
import {
  readAuth,
  sameSession,
  isCurrentAuth,
  persistRefresh,
  clearAuth,
} from './authState.js';
// 別アカウントへ切替後も、旧タブの読取り応答で書込み権限を復活させない。
const viewForSession = (result, current) => {
  // ⚠ **描画より前に差し替えること**。球団名の表示は
  //    `gameText` のモジュール変数を引くので、ビューを受け取った時点で入れる
  setTeamLabels(result.teamLabels);
  return {
  ...result,
  // ⚠ `versionMismatch` も書ける扱いにする。ここを外すと「更新を取り込む」が
  //    押せず、古い形から抜け出せなくなる（取り込みは書き込みなので）
  writable:
    sameSession(readAuth(), current) &&
    !!(result.setupRequired || result.versionMismatch || result.writable),
  };
};
function useMobile() {
  const [mobile, setMobile] = useState(
    () => window.matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const change = () => setMobile(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return mobile;
}
// 操作ごとの通知の文言。⚠ **一律に「保存しました」と出さないこと**。
// リーグの作成・参加・手続きの決定・管理操作でも同じ文言が出て、何が起きたか分からなかった。
const COMMAND_MESSAGES = {
  create: () => 'リーグを作成しました',
  join: (view) => `${teamLabel(view?.teamName) || '球団'}で参加しました`,
  migrate: () => '保存を新しい形式に移しました',
  pause: () => '進行を停止しました',
  resume: () => '進行を再開しました',
  backup: () => 'バックアップを取りました',
  restore: () => 'バックアップから戻しました',
  step: (view, payload) =>
    payload?.turns > 1 ? `${payload.turns}日ぶん進めました` : '1日進めました',
  resolve: () => '手続きを締め切りました',
  testmode: (view, payload) =>
    payload?.on ? '検証モードにしました' : '検証モードを外しました',
  lineup: () => '打順・起用を保存しました',
  submit: (view, payload) => {
    const label = view?.phase?.label || '手続き';
    if (!payload?.ready) return `${label}の下書きを保存しました`;
    const waiting = (view?.members || []).filter(
      (m) => m.teamName !== view.teamName && !m.ready,
    ).length;
    return waiting
      ? `${label}を決定しました。他の人を待っています（あと${waiting}人）`
      : `${label}を決定しました`;
  },
};
// 送ったあと全体を読み直すまで待たず、手元の画面を先に書き換える操作。
// ⚠ 書き換えは**サーバーが受け付けた後**に行う（失敗したら何も変えない）。
//    続く読み直しは裏で走らせ、届いたら差し替える。
const OPTIMISTIC = {
  lineup: (view, payload) => {
    const { baseLineup, ...lineup } = payload;
    return { ...view, lineup: { ...view.lineup, ...lineup } };
  },
  submit: (view, payload) =>
    view.phase?.id === payload.phaseId
      ? {
          ...view,
          phase: {
            ...view.phase,
            submission: { plan: payload.plan, ready: !!payload.ready },
          },
          members: view.members.map((m) =>
            m.teamName === view.teamName ? { ...m, ready: !!payload.ready } : m,
          ),
        }
      : view,
};
// 前回のビューを端末に残し、開いた瞬間はそれを出す（届いたら差し替える）。
// ⚠ **残したビューでは操作させない**（`stale` の間は書き込み不可）。古い revision の
//    まま送ると、別の端末の変更を上書きしかねない。
const VIEW_CACHE = 'baseball-online-view-cache:';
function readCachedView(auth) {
  try {
    const raw = auth && localStorage.getItem(VIEW_CACHE + auth.userId);
    if (!raw) return null;
    const view = JSON.parse(raw);
    setTeamLabels(view.teamLabels);
    return { ...view, writable: false, stale: true };
  } catch {
    return null;
  }
}
function storeCachedView(auth, view) {
  try {
    if (!auth || !view || view.joinRequired || view.setupRequired) return;
    localStorage.setItem(VIEW_CACHE + auth.userId, JSON.stringify(view));
  } catch {
    /* 容量超過などは無視（次回は普通に読み込む） */
  }
}
// 新しく終わった自球団の試合を1行にする（自動で読み直したときの通知）。
function newResultText(before, after) {
  if (!before || !after || before.year !== after.year) return '';
  const seen = new Set(before.results.map((g) => g.gameId || g.id));
  const own = after.results.filter(
    (g) =>
      !seen.has(g.gameId || g.id) &&
      (g.home === after.teamName || g.away === after.teamName),
  );
  const last = own[own.length - 1];
  if (!last) return '';
  const home = last.home === after.teamName;
  const mine = home ? last.homeScore : last.awayScore;
  const theirs = home ? last.awayScore : last.homeScore;
  const mark = mine > theirs ? '○' : mine < theirs ? '●' : '△';
  return `${last.date.month}/${last.date.day}の試合が終わりました ${mark}${mine}-${theirs} 対${teamShort(home ? last.away : last.home)}`;
}

export default function OnlineApp() {
  const [auth, setAuth] = useState(readAuth);
  const [config, setConfig] = useState(null);
  const [view, setViewState] = useState(() => readCachedView(readAuth()));
  const [error, setError] = useState('');
  // 通知は `{ text, undo? }`。⚠ 画面下（スマホは下タブのすぐ上）に出し、ボタンに重ねない
  const [toast, setToast] = useState(null);
  const [showTimes, setShowTimes] = useState(false);
  const [busy, setBusy] = useState(false);
  // 表示幅でPC/スマホの部品が切り替わっても、選択中の画面は失わない。
  const [screen, setScreen] = useState('today');
  const locked = useRef(false);
  const viewSequence = useRef(0);
  const refreshFlight = useRef(null);
  const timesDialog = useRef(null);
  const mobile = useMobile();
  const authRef = useRef(auth);
  authRef.current = auth;
  const viewRef = useRef(view);
  const notify = useCallback((text, options = {}) => {
    if (text) setToast({ text, id: Date.now(), ...options });
  }, []);
  // ビューを受け取る口を1つにする（端末への保存と、試合結果の通知をここで行う）
  const setView = useCallback(
    (next, { announce = false } = {}) => {
      const before = viewRef.current;
      viewRef.current = next;
      setViewState(next);
      if (next && !next.stale) storeCachedView(authRef.current, next);
      if (announce && before && !before.stale) {
        const text = newResultText(before, next);
        if (text) notify(text);
      }
    },
    [notify],
  );
  const saveAuth = useCallback((value) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify(value));
    authRef.current = value;
    viewSequence.current++;
    setAuth(value);
    setView(readCachedView(value));
    setScreen('today');
  }, [setView]);
  const renewAuth = useCallback(async (expected) => {
    const pending = refreshFlight.current;
    if (
      pending &&
      pending.auth.accessToken === expected.accessToken &&
      sameSession(pending.auth, expected)
    )
      return pending.promise;
    const promise = api('refresh', null, {
      refreshToken: expected.refreshToken,
    }).then((result) => {
      const next = { ...expected, ...result };
      if (authRef.current === expected && persistRefresh(expected, next)) {
        authRef.current = next;
        setAuth(next);
        setError('');
      }
      return next;
    });
    const flight = { auth: expected, promise };
    refreshFlight.current = flight;
    try {
      return await promise;
    } finally {
      if (refreshFlight.current === flight) refreshFlight.current = null;
    }
  }, []);
  useEffect(() => {
    const sync = (event) => {
      if (event.key !== AUTH_KEY) return;
      const next = readAuth();
      if (sameSession(next, authRef.current)) {
        authRef.current = next;
        setAuth(next);
      } else {
        viewSequence.current++;
        const old = viewRef.current;
        if (old) setView({ ...old, writable: false });
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [setView]);
  useEffect(() => {
    let cancelled = false;
    api('config')
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const reload = useCallback(
    async ({ announce = false } = {}) => {
      const current = authRef.current;
      if (!current) return;
      const sequence = ++viewSequence.current;
      const result = await api('view', current);
      if (
        sameSession(authRef.current, current) &&
        sequence === viewSequence.current
      )
        setView(viewForSession(result, current), { announce });
    },
    [setView],
  );
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (
        document.hidden ||
        locked.current ||
        (auth?.refreshToken && auth.expiresAt <= Date.now())
      )
        return;
      try {
        const sequence = ++viewSequence.current;
        const result = await api('view', auth);
        if (!cancelled && sequence === viewSequence.current)
          setView(viewForSession(result, auth), { announce: true });
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    if (!auth) return;
    poll();
    const timer = setInterval(poll, 60000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [auth, setView]);
  // 次の進行時刻（または手続きの締め切り）を過ぎたら、待たずに読み直す。
  // ⚠ 1分ごとの読み直しだけだと、試合が終わってから最大1分は古い画面のまま。
  //    進行の処理に数秒かかるので、時刻の20秒後に読む
  const nextAt = view?.nextAdvanceAt || view?.phase?.deadline || null;
  useEffect(() => {
    if (!auth || !nextAt) return;
    const wait = new Date(nextAt).getTime() + 20000 - Date.now();
    if (!(wait > 0) || wait > 6 * 3600000) return;
    const timer = setTimeout(() => {
      if (!locked.current) reload({ announce: true }).catch(() => {});
    }, wait);
    return () => clearTimeout(timer);
  }, [auth, nextAt, reload]);
  useEffect(() => {
    if (!auth?.refreshToken) return;
    let cancelled = false;
    const refresh = async () => {
      if (
        cancelled ||
        locked.current ||
        !isCurrentAuth(auth) ||
        auth.expiresAt > Date.now() + 120000
      )
        return;
      try {
        await renewAuth(auth);
      } catch (e) {
        if (!cancelled && authRef.current === auth && isCurrentAuth(auth))
          setError(e.message);
      }
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [auth, renewAuth]);
  const readDetail = useCallback(
    async (action, query) => {
      const expected = authRef.current;
      const check = () => {
        if (
          !sameSession(readAuth(), expected) ||
          !sameSession(authRef.current, expected)
        )
          throw new Error(
            '別のタブでログインが変更されました。ログインし直してください。',
          );
      };
      check();
      const credentials =
        expected.refreshToken && expected.expiresAt <= Date.now()
          ? await renewAuth(expected)
          : expected;
      check();
      const result = await api(action, credentials, undefined, query);
      check();
      return result;
    },
    [renewAuth],
  );
  // 結果を `{ ok, error }` で返す。⚠ 失敗しても例外は外へ出さない（文言は上の帯に出す）。
  //    呼ぶ側が成否で振る舞いを変えたいとき（編成を閉じるか）に使う。
  // ⚠ **画面全体は止めない**。以前は「処理中です。画面を閉じずにお待ちください…」を
  //    出して全入力を止めていた。いまは押したボタンにだけ回転の印を付け、
  //    画面上端に細い帯を出す（同時に2つ送らないための排他は残す）。
  const run = async (fn) => {
    if (locked.current) return { ok: false, error: '別の操作を処理中です' };
    locked.current = true;
    viewSequence.current++;
    const pressed =
      document.activeElement?.tagName === 'BUTTON' ? document.activeElement : null;
    pressed?.classList.add('is-pending');
    setBusy(true);
    setError('');
    try {
      await fn();
      return { ok: true };
    } catch (e) {
      setError(e.message);
      try {
        await reload();
      } catch {
        /* 通信失敗の文言を保持 */
      }
      return { ok: false, error: e.message };
    } finally {
      pressed?.classList.remove('is-pending');
      locked.current = false;
      setBusy(false);
    }
  };
  const command = async (type, payload, { quiet = false } = {}) => {
    const current = authRef.current;
    const checkSession = (credentials) => {
      if (!sameSession(readAuth(), credentials))
        throw new Error(
          '別のタブでログインが変更されました。操作するにはログインし直してください。',
        );
    };
    checkSession(current);
    const credentials =
      current?.refreshToken && current.expiresAt <= Date.now()
        ? await renewAuth(current)
        : current;
    checkSession(credentials);
    await api('command', credentials, {
      requestId: crypto.randomUUID(),
      revision: viewRef.current?.revision || 0,
      type,
      payload,
    });
    const patch = OPTIMISTIC[type];
    if (patch && viewRef.current) {
      // 先に手元を書き換えて操作を返し、全体の読み直しは裏で行う
      const patched = patch(viewRef.current, payload);
      setView(patched);
      reload().catch((e) => setError(e.message));
      if (!quiet) notify(COMMAND_MESSAGES[type]?.(patched, payload));
      return;
    }
    await reload();
    if (!quiet) notify(COMMAND_MESSAGES[type]?.(viewRef.current, payload) || '保存しました');
  };
  const login = (fields) =>
    run(async () => saveAuth(await api('login', null, fields)));
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.undo ? 6000 : 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (showTimes) timesDialog.current?.showModal();
  }, [showTimes]);
  const logout = () =>
    run(async () => {
      const expected = authRef.current;
      try {
        const current =
          expected.refreshToken && expected.expiresAt <= Date.now()
            ? await renewAuth(expected)
            : expected;
        await api('logout', current, {});
      } finally {
        clearAuth(expected);
        authRef.current = null;
        viewSequence.current++;
        setAuth(null);
        setView(null);
        setShowTimes(false);
        setScreen('today');
      }
    });
  const inLeague =
    view && !view.setupRequired && !view.joinRequired && !view.versionMismatch;
  const shared = {
    view,
    local: config?.local,
    allowStep: config?.allowStep,
    loading: busy,
    reloadView: () => run(() => reload({ announce: true })),
    logout,
    showTimes: () => setShowTimes(true),
    auth,
    busy: busy || !view?.writable,
    run,
    command,
  };
  return (
    <NotifyContext.Provider value={notify}>
      <div
        className={`online ${mobile ? 'online-mobile' : 'online-desktop'} ${inLeague ? 'online-in-league' : ''}`}
        aria-busy={busy || undefined}
      >
        {busy && <div className="online-progress" role="progressbar" aria-label="送信中" />}
        {!inLeague && (
          <header className="online-header">
            <a href="/online" className="online-brand">
              NEXT STAGE <span>オンラインペナント</span>
            </a>
            <nav>
              <a href="/">一人用</a>
              {auth && (
                <button className="online-link" onClick={logout} disabled={busy}>
                  ログアウト
                </button>
              )}
            </nav>
          </header>
        )}
        <main>
          {error && (
            <div role="alert" className="online-alert">
              <span>{error}</span>
              {(!config || auth) && (
                <button
                  className="online-link"
                  onClick={() =>
                    run(
                      config
                        ? reload
                        : async () => setConfig(await api('config')),
                    )
                  }
                  disabled={busy}
                >
                  {config ? '最新状態を確認' : '接続を再確認'}
                </button>
              )}
            </div>
          )}
          {!config && !view ? (
            <Skeleton />
          ) : !auth ? (
            config ? (
              <Login local={config.local} login={login} busy={busy} />
            ) : (
              <Skeleton />
            )
          ) : !view ? (
            <Skeleton />
          ) : view.joinRequired ? (
            <JoinLeague
              view={view}
              busy={busy || !view.writable}
              logout={logout}
              join={(payload) => run(() => command('join', payload))}
            />
          ) : view.versionMismatch ? (
            /* ⚠ 古い形のリーグ。**黙って表示しないこと**。以前は版の印が無く、
               4球団の頃のリーグが2部制のコードでそのまま出ていた。
               ⚠ `canMigrate` が false でも管理者には押させる。保存済みのビューを
               返す経路では中身を見られないので判定できず、ここで隠すと
               「取り込めるのにボタンが無い」が起きる。押せば理由が返る */
            <section className="online-card online-narrow">
              <h1>ゲームの更新を取り込みます</h1>
              <p>
                保存されている世界の形が、いまのゲームと違います。取り込むまで試合は進みません。
              </p>
              {view.reason && <p className="online-muted">{view.reason}</p>}
              {view.isAdmin ? (
                <>
                  <button
                    className="online-primary"
                    disabled={busy || !view.writable}
                    onClick={() => run(() => command('migrate'))}
                  >
                    更新を取り込む
                  </button>
                  <p className="online-muted online-spaced">
                    次の正時の自動処理でも取り込まれます。取り込めない形式だった場合は、押すと理由が表示されます。
                  </p>
                </>
              ) : (
                <p>管理者が取り込むまでお待ちください。自動でも取り込まれます。</p>
              )}
            </section>
          ) : view.setupRequired ? (
            <section className="online-card online-narrow">
              <h1>リーグの準備</h1>
              <p>1部6球団・2部6球団の12球団でスタートします。</p>
              {/* ⚠ スマホからも作れるようにする。以前は「管理者がPCから」で止めていた */}
              {view.isAdmin ? (
                <button
                  className="online-primary"
                  disabled={busy || !view.writable}
                  onClick={() => run(() => command('create'))}
                >
                  リーグを作成
                </button>
              ) : (
                <p>管理者がリーグを作成するまでお待ちください。</p>
              )}
            </section>
          ) : (
            <>
            {!view.writable && !view.stale && (
              <p role="alert" className="online-alert">
                別の端末でログインしたため閲覧のみです。操作するにはログインし直してください。
              </p>
            )}
            {view.error && (
              <p role="alert" className="online-alert">
                {view.error}
              </p>
            )}
            <ReadContext.Provider value={readDetail}>
              <Drafts
                key={`${auth.userId}:${auth.sessionId}:${view.year}:${view.teamName}:${view.phase?.id || 'season'}`}
                scope={`${auth.userId}:${auth.sessionId}:${view.year}:${view.teamName}:${view.phase?.id || 'season'}`}
              >
                {mobile ? (
                  <MobileView {...shared} tab={screen} setTab={setScreen} />
                ) : (
                  <DesktopView {...shared} tab={screen} setTab={setScreen} />
                )}
              </Drafts>
            </ReadContext.Provider>
            </>
          )}
          {showTimes && (
            <dialog
              ref={timesDialog}
              className="online-overlay"
              onClose={() => setShowTimes(false)}
              aria-label="進行のしくみ"
            >
              <section className="online-card">
                <h2>進行のしくみ</h2>
                {/* ⚠ 24個の時刻を並べない。「1時間ごとに1日」と次の1回が分かれば足りる */}
                <p>
                  1時間ごと（毎正時）にゲーム内の1日が進みます。月〜金は試合、土日は手続きです。
                </p>
                {view?.nextAdvanceAt && (
                  <p>
                    次は <strong>{formatJst(view.nextAdvanceAt)}</strong> に
                    {view.currentDate ? ` ${gameDay(nextGameDate(view.currentDate))} ` : ''}
                    へ進みます。
                  </p>
                )}
                <p className="online-muted">
                  決定待ち・停止中の間は進みません。止まっていた分を後からまとめて進めることもありません。
                </p>
                <button autoFocus onClick={() => timesDialog.current.close()}>
                  閉じる
                </button>
              </section>
            </dialog>
          )}
        </main>
        {view?.stale && (
          <p className="online-stale" role="status">
            最新の状態を読み込んでいます…
          </p>
        )}
        {toast && (
          <div key={toast.id} className="online-toast" role="status">
            <span>{toast.text}</span>
            {toast.undo && (
              <button
                className="online-link"
                onClick={() => {
                  const undo = toast.undo;
                  setToast(null);
                  undo();
                }}
              >
                元に戻す
              </button>
            )}
          </div>
        )}
      </div>
    </NotifyContext.Provider>
  );
}
function nextGameDate({ year, month, day }) {
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
// 読み込み中の骨組み。⚠ 「読み込んでいます…」の1行だけだと、壊れたように見えた
function Skeleton() {
  return (
    <div className="online-skeleton" aria-label="読み込み中">
      <div />
      <div />
      <div />
    </div>
  );
}
