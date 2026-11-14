import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PROGRESSION_TIMES, CAMP_ROUNDS, TURN_MINUTES, RETRY_ON_REVISION as RETRY_TYPES } from './shared.js';
import './online.css';
import { api, AUTH_KEY } from './api.js';
import { Login, JoinLeague } from './LeaguePanels.jsx';
import DesktopView from './DesktopView.jsx';
import MobileView from './MobileView.jsx';
import { ReadContext } from './useRead.js';
import { createReadCache } from './readCache.js';
import {
  readSavedView,
  readSavedViewAt,
  saveView,
  forgetView,
  readSavedConfig,
  saveConfig,
} from './savedView.js';
import { ActionContext } from './ActionContext.jsx';
import { useMobile } from './useMobile.js';
import { setTeamLabels } from './gameText.js';
import { Drafts } from './Drafts.jsx';
import { staffModesDoneText } from './notices.js';
import { awaySummary } from './awaySummary.js';
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
// PCにしか無いページを開いたままスマホの幅になったら、スマホで同じものを扱うタブを出す。
// ⚠ 無いタブのままだと何も出ない画面になる（投手起用を開いたまま横から縦へ回したときなど）。
//    スマホでは打順・投手起用・方針を「打順」のタブでまとめて扱う
const MOBILE_TABS = new Set([
  'today',
  'games',
  'players',
  'news',
  'lineup',
  'decisions',
  // 指導者（PCの「指導者」ページと同じ中身。ホームの入口から開く）
  'staff',
  // トレード（スマホは届いた提案への返事だけ。ホームの帯から開く）
  'transfer',
]);
const MOBILE_TAB_FOR = {
  rotation: 'lineup',
  tactics: 'lineup',
  ranking: 'players',
};
const mobileTab = (screen) =>
  MOBILE_TAB_FOR[screen] || (MOBILE_TABS.has(screen) ? screen : 'today');

// 操作が済んだときの文。文か、`(送った中身, 送る前のビュー) => 文` で書く。
// ⚠ **命令を足したらここにも足すこと**。無いと「保存しました」だけになり、決定したのか
//    下書きなのか、トレードが成立したのか申し込んだだけなのかが分からなかった
// ⚠ 画面の側で文を決めたいとき（トレードの相手の答えなど）は `command` の `message` で渡す
const COMMAND_MESSAGES = {
  create: 'リーグを作成しました',
  join: 'リーグに参加しました',
  migrate: '保存を新しい形式に移しました',
  pause: '進行を停止しました',
  resume: '進行を再開しました',
  backup: 'バックアップを取りました',
  restore: 'バックアップから戻しました',
  step: 'ターンを進めました',
  testmode: '検証モードを切り替えました',
  resolve: '手続きを締め切りました',
  // ⚠ 最後の1人が手続きの分野を任せると、その場で手続きが決まる。決まったら言い分ける（`notices.js`）
  staffModes: staffModesDoneText,
  staff: '指導者を入れ替えました',
  reset: 'すべて消しました。リーグを作り直してください',
  // 手続きの提出。決定・下書き・決定の取り消しで文を変える
  submit: (payload, before) =>
    payload?.ready
      ? '決定しました'
      : before?.phase?.submission?.ready
        ? '決定を取り消しました（下書きとして残っています）'
        : '下書きを保存しました',
  campRound: (payload) =>
    Number(payload?.round) >= CAMP_ROUNDS
      ? `第${payload.round}クールの練習を実行しました。キャンプの練習はこれで終わりです`
      : `第${payload?.round}クールの練習を実行しました`,
  lineup: '編成を保存しました',
  profile: (payload) =>
    payload && 'comment' in payload && !('teamName' in payload)
      ? 'ひとことを保存しました'
      : '名前とひとことを保存しました',
  convert: '守備位置を変えました（打順と投手起用は組み直しました）',
  pack: '初期メンバーのセットを選びました',
  tradeOffer: 'トレードを提案しました',
  tradeRespond: (payload) =>
    payload?.action === 'accept'
      ? 'トレードが成立しました'
      : payload?.action === 'counter'
        ? '逆提案を返しました'
        : '提案を断りました',
  // 予告先発（ローテのページ）
  starterPick: (payload) =>
    payload?.playerId == null ? '予告先発の指名を外しました' : '予告先発を指名しました',
  // 練習試合
  challenge: '練習試合を申し込みました',
  challengeRespond: (payload) =>
    payload?.action === 'accept'
      ? '練習試合をしました。結果は練習試合のページにあります'
      : payload?.action === 'withdraw'
        ? '練習試合の申し込みを取り下げました'
        : '練習試合の申し込みを見送りました',
  releaseMember: '球団をCPUに戻しました',
};

// 版のずれ（`code: 'revision'`）だけなら最新の版で1回だけ送り直す命令（`command` の注記）。
// ⚠ 一覧は `shared.js` に1つだけ置く（アプリも同じ一覧を写して使う）
const RETRY_ON_REVISION = new Set(RETRY_TYPES);

export default function OnlineApp() {
  const [auth, setAuth] = useState(readAuth);
  // ⚠ 開いた直後は、前回の設定とビューをすぐ出す（`savedView.js`）。最新は裏で読み直して差し替える
  const [config, setConfig] = useState(readSavedConfig);
  const [view, setView] = useState(() => {
    const current = readAuth();
    const saved = readSavedView(current);
    return saved ? viewForSession(saved, current) : null;
  });
  // 留守中のまとめ（`awaySummary.js`）。⚠ **開いた直後に残っていたビュー**と、最初に届いた
  //    新しいビューを比べる。そのあとの読み直し（60秒ごと）は比べない（開いている間の変化は画面に出ている）
  const visit = useRef(null);
  if (visit.current === null) {
    const current = readAuth();
    visit.current = {
      view: readSavedView(current),
      at: readSavedViewAt(current),
      done: false,
    };
  }
  const [away, setAway] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showTimes, setShowTimes] = useState(false);
  const [busy, setBusy] = useState(false);
  // 表示幅でPC/スマホの部品が切り替わっても、選択中の画面は失わない。
  const [screen, setScreen] = useState('today');
  const locked = useRef(false);
  const viewSequence = useRef(0);
  // 手元のビューの世代。読み直しで `since` に送り、変わっていなければ中身を受け取らない
  // （前回のビューを出したときは、その世代から始める）
  const viewGeneration = useRef(
    Number.isInteger(view?.viewGeneration) ? view.viewGeneration : null,
  );
  // ⚠ **版は描画時の `view` ではなくここから読む**。命令は使い回される
  //    （選手の詳細へ渡す `actions`）ので、閉じ込めた `view` は定期の読み直しの
  //    後も古いまま残り、古い版を送って「他の操作で更新されました」になっていた
  const viewRef = useRef(view);
  viewRef.current = view;
  // ⚠ ビューを入れるときは必ずここを通す（世代を覚え、変わっていない返事なら今のビューを残す）
  const acceptView = useCallback((result, current) => {
    if (result?.unchanged) {
      // 前に開いたときから何も変わっていない（留守中のまとめは出さない）
      visit.current.done = true;
      return;
    }
    viewGeneration.current = Number.isInteger(result?.viewGeneration)
      ? result.viewGeneration
      : null;
    const next = viewForSession(result, current);
    viewRef.current = next;
    setView(next);
    if (!visit.current.done && next?.revision != null) {
      visit.current.done = true;
      const lines = awaySummary(visit.current.view, next);
      if (lines) setAway({ lines, at: visit.current.at });
    }
    saveView(current, result);
  }, []);
  const sinceQuery = () =>
    Number.isInteger(viewGeneration.current)
      ? { since: String(viewGeneration.current) }
      : {};
  // ⚠ 読むだけの窓口（選手・球団・試合一覧・試合・標準案）の答えを覚えておく（`readCache.js`）。
  //    同じ画面を開き直すたびに取りに行っていた。版（revision）が同じ間はサーバーの答えも同じ
  const readCache = useRef(createReadCache());
  const viewRevision = useRef(null);
  viewRevision.current = view?.revision ?? null;
  const refreshFlight = useRef(null);
  const timesDialog = useRef(null);
  const mobile = useMobile();
  const authRef = useRef(auth);
  authRef.current = auth;
  const saveAuth = useCallback((value) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify(value));
    authRef.current = value;
    viewSequence.current++;
    setAuth(value);
    setView(null);
    viewGeneration.current = null;
    readCache.current.clear();
    forgetView();
    setScreen('today');
  }, []);
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
        setView((old) => (old ? { ...old, writable: false } : old));
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    let cancelled = false;
    api('config')
      .then((value) => {
        if (!cancelled) {
          setConfig(value);
          saveConfig(value);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const reload = useCallback(async () => {
    const current = authRef.current;
    if (!current) return;
    const sequence = ++viewSequence.current;
    const result = await api('view', current, undefined, sinceQuery());
    if (
      sameSession(authRef.current, current) &&
      sequence === viewSequence.current
    )
      acceptView(result, current);
  }, [acceptView]);
  // 定期の読み直しが出した失敗の文言。⚠ **次に読み直せたら、その文言だけ消す**。
  //    以前は読み直しに成功しても赤い帯が残り、直ったのに「つながらない」と出続けた。
  //    操作の失敗（保存できなかった等）の文言は、読み直しでは消さない
  const pollError = useRef('');
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
        const result = await api('view', auth, undefined, sinceQuery());
        if (cancelled) return;
        if (sequence === viewSequence.current) acceptView(result, auth);
        const failed = pollError.current;
        if (failed) {
          pollError.current = '';
          setError((shown) => (shown === failed ? '' : shown));
        }
      } catch (e) {
        if (!cancelled) {
          pollError.current = e.message;
          setError(e.message);
        }
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
  }, [auth]);
  // 最後に来た時刻（しばらく来ないと「おるすばん」で指導者に任せた扱いになる。来たら解く）。
  // ⚠ 開いたとき・タブに戻ったときに知らせるだけ。サーバーは数時間に1回しか書かない
  //    （`touchPresence`）ので、ここでは10分より短い間隔で送らないだけにする
  useEffect(() => {
    if (!auth) return;
    let last = 0;
    const ping = () => {
      if (document.hidden || Date.now() - last < 10 * 60000) return;
      if (auth.refreshToken && auth.expiresAt <= Date.now()) return;
      last = Date.now();
      api('presence', auth, {}).catch(() => {});
    };
    ping();
    document.addEventListener('visibilitychange', ping);
    return () => document.removeEventListener('visibilitychange', ping);
  }, [auth]);
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
  const fetchDetail = useCallback(
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
  // ⚠ 画面には覚えを通した窓口を渡す。`peek` は覚えているときだけ答えを返す（読み込み中を出さずに描くため）
  const readDetail = useMemo(() => {
    const read = (action, query = {}) =>
      readCache.current.get(action, query, viewRevision.current, () =>
        fetchDetail(action, query),
      );
    read.peek = (action, query = {}) =>
      readCache.current.peek(action, query, viewRevision.current);
    return read;
  }, [fetchDetail]);
  // 結果を `{ ok, error }` で返す。⚠ 失敗しても例外は外へ出さない（文言は上の帯に出す）。
  //    呼ぶ側が成否で振る舞いを変えたいとき（全画面の編成を閉じるか）に使う
  const run = async (fn) => {
    if (locked.current) return { ok: false, error: '別の操作を処理中です' };
    locked.current = true;
    viewSequence.current++;
    setBusy(true);
    setError('');
    pollError.current = '';
    setMessage('');
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
      locked.current = false;
      setBusy(false);
    }
  };
  // 済んだら画面に出した文を返す。`message` は文か `(送ったあとのビュー, 送る前のビュー) => 文`
  //    （画面の側で結果を言い分けたいとき。返したものが空なら `COMMAND_MESSAGES` の文）
  // ⚠ `toast: false` は文を返すだけで、右上（PCは右下）の帯に出さない。画面の側が同じ文を
  //    すぐ横に出すときに使う（スマホのトレードの返事。帯が枠内の文に重なって2つ出ていた）
  const command = async (type, payload, { message, toast = true } = {}) => {
    const current = authRef.current;
    const before = viewRef.current;
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
    const send = (revision) =>
      api('command', credentials, {
        requestId: crypto.randomUUID(),
        revision,
        type,
        payload,
      });
    let result;
    try {
      result = await send(viewRef.current?.revision || 0);
    } catch (error) {
      // ⚠ **編成と手続きの提出は、版のずれだけなら最新の版で1回だけ送り直す**。
      //    版はリーグ全体で1つなので、定時の進行や他の参加者の操作だけで
      //    「他の操作で更新されました」になり、編成を保存し直す羽目になっていた。
      //    どちらも自分の保存済みの内容（`baseLineup` / `baseSubmission`）で
      //    本当の食い違いを別に確かめているので、送り直しても上書き事故は起きない。
      //    キャンプのクール（`campRound`）も同じ。サーバーがクール番号を照合して
      //    次の1つだけを受け付けるので、送り直しても同じクールは2回走らない。
      //    ⚠ トレードの申し込み・返事は足さない（送り直すと二重の申し込みになりうる）
      if (error?.code !== 'revision' || !RETRY_ON_REVISION.has(type))
        throw error;
      const latest = await api('view', credentials);
      result = await send(latest?.revision || 0);
    }
    // ⚠ 返事に最新のビューが載っていれば、それをそのまま使う（読み直しの往復を省く）。
    //    二重送信の控えから返ったときなど、載っていなければ従来どおり読み直す
    if (result?.view) {
      const sequence = ++viewSequence.current;
      if (
        sameSession(authRef.current, current) &&
        sequence === viewSequence.current
      )
        acceptView(result.view, current);
    } else await reload();
    // ⚠ 操作ごとに文言を変える。作成や参加でも「保存しました」と出ていた
    const known = COMMAND_MESSAGES[type];
    const text =
      (typeof message === 'function' ? message(viewRef.current, before) : message) ||
      (typeof known === 'function' ? known(payload, before, viewRef.current) : known) ||
      '保存しました';
    if (toast) setMessage(text);
    return text;
  };
  const login = (fields) =>
    run(async () => saveAuth(await api('login', null, fields)));
  // ⚠ 選手の詳細はどこからでも開かれるので、命令はコンテキストで渡す
  //    （`ActionContext.jsx` の注記）。毎回作り直すと小窓が作り直されるので、
  //    中身が変わったときだけ作り直す
  //    ⚠ `run` と `command` は**最新のものを呼ぶ包み**を渡す。作った時点の関数を
  //    渡すと、その描画の `view` などを閉じ込めたまま使われる
  const latest = useRef(null);
  latest.current = { run, command };
  const actions = useMemo(
    () => ({
      teamName: view?.teamName || null,
      writable: !!view?.writable,
      busy,
      run: (fn) => latest.current.run(fn),
      command: (...args) => latest.current.command(...args),
    }),
    [view?.teamName, view?.writable, busy],
  );
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 3500);
    return () => clearTimeout(timer);
  }, [message]);
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
        viewGeneration.current = null;
        readCache.current.clear();
        forgetView();
        setShowTimes(false);
        setScreen('today');
      }
    });
  // ⚠ 更新の取り込み待ちの画面ではヘッダー（ログアウト）を隠さない。
  //    スマホではここに戻る手段が他に無く、ログアウトできなくなっていた
  const compactMobile = mobile && view && !view.setupRequired && !view.versionMismatch;
  return (
    <div
      className={`online ${mobile ? 'online-mobile' : 'online-desktop'} ${compactMobile ? 'online-compact-shell' : ''}`}
    >
      {!compactMobile && (
        <header className="online-header">
          <a href="/online" className="online-brand">
            NEXT STAGE <span>オンラインペナント</span>
          </a>
          <TestControls
            view={view}
            allowStep={config?.allowStep}
            busy={busy}
            run={run}
            command={command}
          />
          <nav>
            {/* ⚠ PCは見出しの中に置く（本文の一番上に1行使っていた） */}
            {config?.local && !mobile && (
              <small className="online-dev">ローカル検証モード（公開環境では無効）</small>
            )}
            <a href="/">一人用</a>
            {auth && (
              <button onClick={logout} disabled={busy}>
                ログアウト
              </button>
            )}
          </nav>
        </header>
      )}
      <main>
        {config?.local && mobile && !compactMobile && (
          <p className="online-dev">ローカル検証モード（公開環境では無効）</p>
        )}
        {error && (
          <div role="alert" className="online-alert">
            {error}
            {(!config || auth) && (
              <button
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
        {message && (
          <p role="status" className="online-success">
            {message}
          </p>
        )}
        {!config ? (
          <p>接続を確認しています…</p>
        ) : !auth ? (
          <Login local={config.local} login={login} busy={busy} />
        ) : !view ? (
          /* ⚠ 読めなかったときに「読み込んでいます…」のまま残さない（上の帯に理由。
             定期の読み直し・画面に戻ったときにも読み直す） */
          <p>
            {error
              ? 'リーグを読み込めませんでした。上の「最新状態を確認」を押すか、しばらく待つと自動で読み直します。'
              : 'リーグを読み込んでいます…'}
          </p>
        ) : view.joinRequired ? (
          <JoinLeague
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
          <section className="online-card">
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
                {/* ⚠ 自動処理（定期の進行）は**5分ごと**に回る（`supabase/cron.example.sql`）。
                    以前は「次の正時」と書いており、毎正時に進めていた頃の説明が残っていた */}
                <p className="online-muted online-spaced">
                  数分以内に自動でも取り込まれます。取り込めない形式だった場合は、押すと理由が表示されます。
                </p>
              </>
            ) : (
              <p>管理者が取り込むまでお待ちください。自動でも取り込まれます。</p>
            )}
          </section>
        ) : view.setupRequired ? (
          <section className="online-card">
            <h1>リーグの準備</h1>
            <p>1部6球団・2部6球団の12球団でスタートします。</p>
            {view.isAdmin && !mobile ? (
              <button
                className="online-primary"
                disabled={busy || !view.writable}
                onClick={() => run(() => command('create'))}
              >
                リーグを作成
              </button>
            ) : (
              <p>管理者がPCからリーグを作成するまでお待ちください。</p>
            )}
          </section>
        ) : (
          <>
            {/* ⚠ 日付・次の進行は、PCは左メニュー（`DesktopView` の `NavStatus`）、
                スマホはホームの先頭（`MobileView`）に**1回だけ**出す。以前はPCの
                全ページの本文の上に同じ帯（約170px）があった */}
            {!view.writable && (
              <p role="alert" className="online-alert">
                {/* ⚠ 同時に操作できるのはブラウザ1台とアプリ1台（`server/sessions.mjs`）。
                    PCとスマホのブラウザは同じ「ブラウザ」に数える */}
                別のブラウザでログインしたため閲覧のみです（ブラウザとアプリはそれぞれ1台まで同時に使えます）。操作するにはログインし直してください。
              </p>
            )}
            {view.error && (
              <div role="alert" className="online-alert">
                <span>{view.error}</span>
                {/* ⚠ **行き止まりにしない**。止まったときは「1日程進める」も
                    押せなくなるので、再開をその場に出す。リーグ管理まで
                    辿り着けないと、進まない理由も直し方も分からない */}
                {view.isAdmin && ['paused', 'error'].includes(view.status) && (
                  <button
                    className="online-primary"
                    disabled={busy || !view.writable}
                    onClick={() => run(() => command('resume'))}
                  >
                    次の時刻から再開
                  </button>
                )}
              </div>
            )}
            <ActionContext.Provider value={actions}>
            <ReadContext.Provider value={readDetail}>
              {/* ⚠ **手続きの切り替わりで作り直さないこと**（鍵に手続きを入れない）。
                  以前は手続きが締め切られた瞬間に下の画面がまるごと作り直され、
                  編集中の打順（全画面の編成も含む）が黙って消えていた。
                  手続きごとの下書きは、名前に手続きの id を入れて分けている（`PhasePanel`）。 */}
              <Drafts
                key={`${auth.userId}:${auth.sessionId}:${view.year}:${view.teamName}`}
                scope={`${auth.userId}:${auth.sessionId}:${view.year}:${view.teamName}`}
                phaseId={view.phase?.id || null}
              >
                {mobile ? (
                  <MobileView
                    tab={mobileTab(screen)}
                    setTab={setScreen}
                    view={view}
                    local={config.local}
                    allowStep={config.allowStep}
                    loading={busy}
                    reloadView={() => run(reload)}
                    logout={logout}
                    showTimes={() => setShowTimes(true)}
                    auth={auth}
                    busy={busy || !view.writable}
                    run={run}
                    command={command}
                    away={away}
                    dismissAway={() => setAway(null)}
                  />
                ) : (
                  <DesktopView
                    tab={screen === 'news' ? 'games' : screen}
                    setTab={setScreen}
                    reload={reload}
                    showTimes={() => setShowTimes(true)}
                    view={view}
                    auth={auth}
                    local={config.local}
                    allowStep={config.allowStep}
                    busy={busy || !view.writable}
                    run={run}
                    command={command}
                    away={away}
                    dismissAway={() => setAway(null)}
                  />
                )}
              </Drafts>
            </ReadContext.Provider>
            </ActionContext.Provider>
          </>
        )}
        {showTimes && (
          <dialog
            ref={timesDialog}
            className="online-overlay"
            onClose={() => setShowTimes(false)}
            aria-label="進行時刻"
          >
            <section className="online-card">
              <h2>進行時刻（日本時間）</h2>
              <p>{PROGRESSION_TIMES.join(' / ')}</p>
              {/* ⚠ 「1日進みます」だけだと、実時間の1日かゲーム内の1日か分からない。
                  刻み（`TURN_MINUTES`）も手で書かない */}
              <p>
                {TURN_MINUTES}分ごとに1ターン（ゲーム内の1日）進みます。月〜金は試合、土日は手続きです。
                決定待ち・停止中の分は後からまとめて進めません。
              </p>
              <button autoFocus onClick={() => timesDialog.current.close()}>
                閉じる
              </button>
            </section>
          </dialog>
        )}
        {busy && (
          <p role="status" className="online-working">
            処理中です。画面を閉じずにお待ちください…
          </p>
        )}
      </main>
    </div>
  );
}

/**
 * 見出しに置く検証用のボタン（管理者・検証モードの間だけ）。
 *
 * ⚠ **遊んでいるリーグでは出さないこと**。1日進められる／全部消せるのは、
 *    作っている間に時間を待たずに試すためのもの。検証モード（`testMode`）か
 *    環境変数（`ONLINE_ALLOW_STEP`）が立っているときだけ出す。
 * ⚠ 「1日程進める」は、決定待ちの手続きがあれば**それを締め切る**。
 *    手続き中は試合が進まないので、そうしないとボタンが効かない日が続く。
 * ⚠ リセットは**二度押し**にする。押し間違いで全員の成績が消える。
 */
function TestControls({ view, allowStep, busy, run, command }) {
  const [confirming, setConfirming] = useState(false);
  // ⚠ **リーグがまだ無いときは出さない**。押しても「リーグがまだありません」で
  //    断られるだけで、リセット直後に押せるように見えるのが紛らわしい
  if (!view || view.setupRequired || view.joinRequired) return null;
  if (!view.isAdmin || !(view.testMode || allowStep)) return null;
  const waiting = !!view.phase;
  const stopped = ['paused', 'error'].includes(view.status);
  return (
    <div className="online-testbar">
      {/* ⚠ 止まっているときは**再開に変える**。以前は押せないだけで、
          なぜ進まないのかも、どこで直すのかも画面から分からなかった */}
      {stopped ? (
        <button
          className="online-danger"
          disabled={busy}
          title={view.error || '進行が止まっています'}
          onClick={() => run(() => command('resume'))}
        >
          止まっています（再開）
        </button>
      ) : (
        <button
          disabled={busy || (!waiting && view.status !== 'running')}
          title={
            waiting
              ? '決定待ちの手続きをいま締め切ります'
              : '1ターン（ゲーム内1日・1試合）進めます'
          }
          onClick={() => run(() => command(waiting ? 'resolve' : 'step'))}
        >
          1日程進める
        </button>
      )}
      {confirming ? (
        <>
          <button
            className="online-danger"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await command('reset');
                setConfirming(false);
              })
            }
          >
            本当に消す
          </button>
          <button disabled={busy} onClick={() => setConfirming(false)}>
            やめる
          </button>
        </>
      ) : (
        <button
          disabled={busy}
          title="リーグも成績もすべて消して、作成前の状態に戻します"
          onClick={() => setConfirming(true)}
        >
          全データリセット
        </button>
      )}
    </div>
  );
}
