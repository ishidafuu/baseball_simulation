import { isLiveSession, sessionIdsOf } from '../sessions.mjs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID, createHash } from 'node:crypto';
import {
  requireOnline,
  OnlineError,
  ONLINE_SCHEMA,
  ONLINE_ENGINE_VERSION,
} from '../../src/online/shared.js';
import {
  projectLeague,
  projectGames,
  projectGameInfo,
  projectPlayerInfo,
  projectTeamInfo,
} from '../projection.mjs';
import { buildArchiveIndex, buildTeamsIndex, archiveReferences } from '../archiveIndex.mjs';
import {
  isCurrent,
  migrationState,
  OLDEST_MIGRATABLE,
} from '../../src/online/leagueMigration.js';
import {
  SNAPSHOT_FORMAT,
  isSplitSnapshot,
  splitBundle,
  assembleBundle,
  assembleLight,
  runWithLightRead,
} from './snapshotParts.mjs';
/** 部分の履歴（`views._parts.history`）が指すオブジェクトのパス */
const partReferences = (history) =>
  new Set(
    (history || []).flatMap((refs) =>
      Object.values(refs || {}).map((ref) => ref?.path),
    ).filter(Boolean),
  );
/**
 * リーグ全体の進行情報（全員のビューで同じ値）を1つ取り出す。
 * 定期処理の判定（`isDue`）と、まだ参加していない人の版（`revision`）に使う。
 */
function leagueMeta(views) {
  const view = Object.entries(views || {}).find(
    ([key, v]) => !key.startsWith('_') && Number.isInteger(v?.revision) && 'status' in v,
  )?.[1];
  if (!view) return null;
  const { schema, revision, status, nextAdvanceAt, phaseDeadline } = view;
  return { schema, revision, status, nextAdvanceAt, phaseDeadline };
}
/**
 * 保存するリーグ本体から、進行情報（`views._meta`）を作る。
 *
 * ⚠ **ビューからではなくリーグから作ること**。リーグが古い形のままだと、
 *    参加者のビューは「版が合いません」（`versionMismatch`）だけになり、
 *    版も進行時刻も載らない。ビューから作ると `_meta` が消えて、定期処理が
 *    「古い形なので移行する」の判定（`isDue`）まで読めなくなり、管理者が
 *    手で取り込むまで定期進行が止まっていた。
 * ⚠ リーグが無いとき（リセット直後）も入れる。無いと読み出しのたびに
 *    全列の読み直し（`controlFor` の予備経路）に落ちて、往復が2回になる。
 */
function leagueMetaOf(league) {
  if (!league)
    return { schema: ONLINE_SCHEMA, revision: null, status: null, nextAdvanceAt: null, phaseDeadline: null };
  return {
    // 古い形のリーグは自分の版を載せる（`isDue` が移行のために起こす）
    schema: isCurrent(league) ? ONLINE_SCHEMA : (league.schema ?? null),
    // ⚠ 古い形でも**直せるときだけ** `isDue` が起こす。新しすぎる版・計算方法の
    //    違うリーグは定期処理でも直せないので、起こすと毎回ロックと全体の
    //    読み込みをして失敗し、その間の参加者の操作が弾かれる
    migratable: migrationState(league).state === 'migratable',
    // 試合の計算方法。版（schema）が同じでも計算方法が違えば直せない（作り直すしかない）。
    // 版だけ見ると区別できず、定期処理が毎回起きて失敗していた（`isDue`）
    engineVersion: league.engineVersion ?? null,
    revision: league.revision,
    status: league.status,
    nextAdvanceAt: league.nextAdvanceAt ?? null,
    phaseDeadline: league.phase?.deadline || null,
  };
}
function memberRevision(views) {
  return Object.entries(views || {}).find(
    ([key, v]) => !key.startsWith('_') && Number.isInteger(v?.revision),
  )?.[1]?.revision;
}
export class SupabaseStore {
  constructor({ url, serviceKey, members, adminId, fetchImpl = fetch }) {
    requireOnline(
      url?.startsWith('https://') && serviceKey,
      'Supabaseのサーバー設定が必要です',
      503,
    );
    this.url = url.replace(/\/$/, '');
    this.key = serviceKey;
    this.members = members;
    this.adminId = adminId;
    this.fetch = fetchImpl;
    this.archiveCache = new Map();
  }
  async request(path, { method = 'GET', body, raw = false } = {}) {
    const response = await this.fetch(`${this.url}${path}`, {
      method,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        ...(body
          ? { 'Content-Type': raw ? 'application/gzip' : 'application/json' }
          : {}),
      },
      body: body ? (raw ? body : JSON.stringify(body)) : undefined,
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) {
      const error = new OnlineError(
        '共有保存先との通信に失敗しました',
        503,
        'storage',
      );
      error.storageStatus = response.status;
      if (raw && method === 'GET' && response.status === 400) {
        // Storage RESTは不存在をHTTP 400と本文内404で返す形式もある。
        const detail = await response.json().catch(() => null);
        if (
          detail?.code === 'NoSuchKey' ||
          (String(detail?.statusCode) === '404' &&
            detail?.error === 'not_found')
        )
          error.storageStatus = 404;
      }
      throw error;
    }
    if (raw && method === 'GET')
      return Buffer.from(await response.arrayBuffer());
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  rpc(name, body) {
    return this.request(`/rest/v1/rpc/${name}`, { method: 'POST', body });
  }
  async control() {
    return (
      await this.request('/rest/v1/online_control?id=eq.pennant&select=*')
    )[0];
  }
  /**
   * 管理行を列を絞って読む（`columns` は PostgREST の `select` の項目）。
   * 絞り込みが通らない環境（PostgREST が式を受け付けず 400 を返す）では印を立てて
   * `null` を返すので、呼ぶ側は全列（`control()`）で読み直す。印が立った後は問い合わせない。
   * ⚠ 絞った読み出しはここを通す。1か所だけ予備の経路が無いと、その環境では
   *    その操作だけが毎回失敗する（以前は `readGeneration` に無く、定期の読み直しが 400 で落ちていた）
   */
  async selectControl(columns) {
    if (this.narrowSelectUnsupported) return null;
    try {
      return (
        await this.request(
          `/rest/v1/online_control?id=eq.pennant&select=${encodeURIComponent(columns.join(','))}`,
        )
      )[0];
    } catch (error) {
      if (error.storageStatus !== 400) throw error;
      this.narrowSelectUnsupported = true;
      return null;
    }
  }
  /**
   * 閲覧と定期処理の判定に要る列だけを読む。
   * ⚠ `select=*` だと全参加者のビュー（1人あたり数十〜数百KB）を毎回取り、
   *    画面の60秒ごとの更新のたびに参加人数ぶんの転送が発生していた。
   *    ここでは自分のビューと、リーグ全体の進行情報（`views._meta`）だけを取る。
   * ⚠ 絞り込みが通らない環境（古い保存で `_meta` が無い、PostgREST が式を
   *    受け付けない）では、従来どおり全列を読む。
   */
  async controlFor(userId) {
    const full = async () => {
      const row = await this.control();
      return {
        ...row,
        view: userId ? row?.views?.[userId] ?? null : null,
        meta: row?.views?._meta ?? leagueMeta(row?.views),
        anyRevision: memberRevision(row?.views),
      };
    };
    if (userId && !/^[\w-]+$/.test(userId)) return full();
    const columns = ['generation', 'snapshot_path', 'sessions', 'meta:views->_meta'];
    if (userId) columns.push(`view:views->"${userId}"`);
    const row = await this.selectControl(columns);
    if (row === null) return full();
    // `_meta` は次の保存から付く。無いうちは全列を読んで補う
    if (row?.snapshot_path && !row.meta) return full();
    return { ...row, view: row?.view ?? null, anyRevision: row?.meta?.revision };
  }
  async load(row) {
    return (await this.loadSnapshot(row)).bundle;
  }
  async object(path) {
    return JSON.parse(
      gunzipSync(
        await this.request(`/storage/v1/object/online-world/${path}`, {
          raw: true,
        }),
      ),
    );
  }
  /**
   * 世代を読む。古い形（bundle をまるごと1つ）も分けた形（芯＋部分）も読める。
   * `light` なら芯と記録だけ読み、世界の部分は番人にする（`assembleLight`）。
   */
  async loadSnapshot(row, { light = false, records = true } = {}) {
    if (!row?.snapshot_path)
      return { bundle: { league: null, sessions: {}, receipts: {} }, refs: {} };
    const snapshot = await this.object(row.snapshot_path);
    if (!isSplitSnapshot(snapshot)) return { bundle: snapshot, refs: {} };
    const { core, order, parts: refs } = snapshot;
    const names = Object.keys(refs).filter(
      (name) => !light || (records && name === 'records'),
    );
    const data = Object.fromEntries(
      await Promise.all(
        names.map(async (name) => [name, await this.object(refs[name].path)]),
      ),
    );
    if (light) {
      const run = assembleLight(core, order, data, refs);
      return { bundle: run.bundle, light: run, refs };
    }
    return { bundle: assembleBundle(core, order, data), refs };
  }
  async read() {
    const row = await this.control();
    try {
      return await this.load(row);
    } catch (error) {
      if (error.storageStatus !== 404) throw error;
      const current = await this.control();
      if (
        !current?.snapshot_path ||
        current.snapshot_path === row?.snapshot_path
      )
        throw error;
      // 読取り中に旧世代が整理された場合だけ、最新の一式を一度再取得する。
      return this.load(current);
    }
  }
  /**
   * 読むだけの処理（手続きの標準案）向けに、芯だけを読む。世界・記録・退避は読まずに番人にする
   * （触ると `NeedsFullWorld`）。触ったかは `touched()` でも分かる（例外を握りつぶされても印は残る）。
   * ⚠ 以前は標準案のために世界まるごと（展開して数十MB）を読んでおり、手続きの画面を開くたびに数秒待った
   */
  async readLight() {
    const row = await this.controlFor(null);
    const loaded = await this.loadSnapshot(row, { light: true, records: false });
    return {
      bundle: loaded.bundle,
      touched: () => loaded.light?.tracker.touched ?? null,
    };
  }
  async isDue(now) {
    // ⚠ リーグ全体の進行情報（`views._meta`）で判定する。以前は管理者のビューを
    //    見ていたので、管理者がリーグに参加していないと締め切りも進行時刻も
    //    読めず、定期処理が一度も動かなかった
    const row = await this.controlFor(null);
    const view = row.meta;
    // ⚠ **フェーズの締め切り超過でも起動すること**。手続き中は status が
    //    running でないので、進行時刻だけ見ていると締め切りが来ても
    //    誰も動かさず、1人の未提出で全員の週が止まる。
    // ⚠ **古い形のまま放置しない**。更新で保存の形が変わったとき、
    //    進行時刻だけ見ていると誰も触らない限り直らない。次の cron（5分以内）で
    //    定期処理が入って移行できるよう、ここでも起こす
    // ⚠ **直せない版では起こさない**（新しすぎる・計算方法が違う）。起こしても
    //    移行に失敗して何もしないのに、毎回ロックを取って全体を読み、その間の
    //    参加者の操作を「処理中」で弾いていた。進行時刻が来ていても同じ
    //    （定期処理は移行に失敗した時点で止まる）なので、ここで答えを決める。
    //    `migratable` の無い古い `_meta` は版の範囲で判定する
    // ⚠ 版が同じでも**計算方法が違えば**直せない。サーバーの計算方法だけ上がった直後は、
    //    前のサーバーが書いた `_meta` の版がいまの版と同じなので、版だけでは区別できない
    //    （`engineVersion` の無い古い `_meta` は従来どおり）
    if (row.snapshot_path && view?.engineVersion != null && view.engineVersion !== ONLINE_ENGINE_VERSION)
      return false;
    if (row.snapshot_path && view && view.schema !== ONLINE_SCHEMA)
      return !!(
        view.migratable ??
        (Number.isInteger(view.schema) &&
          view.schema >= OLDEST_MIGRATABLE &&
          view.schema < ONLINE_SCHEMA)
      );
    // ⚠ 自動決定に失敗して止まっている間（status: error）は起こさない。
    //    定期処理はその状態では何もしない（管理者の再開を待つ）のに、毎回
    //    ロックを取って保存一式を読み、その間の参加者の操作を「処理中」で弾いていた
    if (view?.phaseDeadline && view.phaseDeadline <= now && view.status !== 'error')
      return true;
    return !!(
      view?.status === 'running' &&
      view.nextAdvanceAt &&
      view.nextAdvanceAt <= now
    );
  }
  async readView(userId, sessionId) {
    const row = await this.controlFor(userId);
    const writable = isLiveSession(row.sessions, userId, sessionId);
    const view = row.view;
    if (!view) {
      if (!row.snapshot_path)
        return { setupRequired: true, isAdmin: userId === this.adminId };
      // ⚠ **招待された人は、まだ参加者ではないのでビューが無い**。ここで
      //    null（＝403「このリーグの参加者ではありません」）を返すと、
      //    招待コードを入れる画面に辿り着けず、永久に参加できない。
      //    ローカル（`projectLeague`）は毎回リーグ本体から作るので通ってしまい、
      //    本番だけで起きる。実際にそれで友人がログインできなかった。
      // ⚠ 名簿の中身を読むためにスナップショットを取りに行かないこと。
      //    参加していない人が画面を開くたびに数MBを読むことになる。
      //    必要なのは `revision` だけで、それは参加者のビューに載っている
      //    （全員同じ値）。
      if (!Number.isInteger(row.anyRevision)) return null;
      return {
        joinRequired: true,
        isAdmin: userId === this.adminId,
        revision: row.anyRevision,
        writable,
        viewGeneration: row.generation ?? null,
      };
    }
    // `viewGeneration` は保存の世代（公開のたびに1つ上がる）。画面はこれを `since` で送り返し、
    // 変わっていなければビューを受け取らずに済ませる（`readGeneration`）
    return { ...view, writable, viewGeneration: row.generation ?? null };
  }
  /**
   * 保存の世代だけを読む（ビューは読まない）。画面の定期の読み直しで「変わったか」を見るため。
   * ⚠ 版（revision）ではなく世代を見ること。版を上げない書き込み（ログイン・形の移行）でも
   *    ビューは変わる（書けるか・形）が、世代は公開のたびに必ず上がる。
   * ⚠ 保存の版（`_meta.schema`）も返す。サーバーを更新して版が上がっても
   *    世代は変わらないので、世代だけで「変わっていない」と答えると、
   *    開いていた画面が版の門番（`versionMismatch`）を通らない。
   */
  async readGeneration(userId, sessionId) {
    const narrow = await this.selectControl(['generation', 'sessions', 'meta:views->_meta']);
    const row = narrow === null ? await this.control() : narrow;
    return {
      generation: row?.generation ?? null,
      writable: isLiveSession(row?.sessions, userId, sessionId),
      // 絞り込みを通さない環境（全列が返る）でも読めるように、元の列も見る
      schema: (row?.meta ?? row?.views?._meta)?.schema ?? null,
    };
  }
  async archive(row, kind, year) {
    const meta = row.views?._records;
    const descriptor =
      kind === 'players'
        ? meta?.players
        : kind === 'teams'
          ? meta?.teams
          : meta?.games?.[year];
    if (!descriptor) return null;
    if (this.archiveCache.has(descriptor.path))
      return this.archiveCache.get(descriptor.path);
    const value = JSON.parse(
      gunzipSync(
        await this.request(
          `/storage/v1/object/online-world/${descriptor.path}`,
          { raw: true },
        ),
      ),
    );
    this.archiveCache.set(descriptor.path, value);
    // 選手・球団・今季の試合に、前の年度を見に行ったぶんを足しても入る数
    while (this.archiveCache.size > 6)
      this.archiveCache.delete(this.archiveCache.keys().next().value);
    return value;
  }
  /**
   * 記録の読み出し（選手・球団・試合）に要る列だけを読む。
   * ⚠ `select=*`（`control()`）だと全参加者のビュー（1人あたり数十〜百KB）を毎回取っていた。
   *    選手を1人押すだけで参加人数ぶんを運んでいた。要るのは記録の索引（`views._records`）と、
   *    自分の球団名・年度だけ。
   * ⚠ 自分のビューが無い（参加していない）・球団名の無い形のときは、全列を読んで従来どおり判断する
   */
  async recordRow(userId) {
    if (!/^[\w-]+$/.test(userId || '')) return this.control();
    const row = await this.selectControl([
      'snapshot_path',
      'records:views->_records',
      `teamName:views->"${userId}"->teamName`,
      `year:views->"${userId}"->year`,
    ]);
    if (!row || row.teamName == null) return this.control();
    return {
      snapshot_path: row.snapshot_path,
      views: {
        ...(row.records ? { _records: row.records } : {}),
        [userId]: { teamName: row.teamName, year: row.year },
      },
    };
  }
  async readRecord(userId, kind, query, project) {
    let row = await this.recordRow(userId);
    for (let attempt = 0; attempt < 2; attempt++) {
      requireOnline(row.views?.[userId], '参加者ではありません', 403);
      const year = Number(query.year || row.views[userId].year);
      if (kind === 'games')
        requireOnline(
          Number.isSafeInteger(year) && year > 0,
          '年度の指定が不正です',
        );
      try {
        const missingYear =
          kind === 'games' &&
          row.views?._records?.games &&
          !Object.hasOwn(row.views._records.games, year);
        const index = missingYear ? {} : await this.archive(row, kind, year);
        if (!index) return project(await this.read(), year);
        if (kind === 'teams') {
          requireOnline(
            Object.hasOwn(index, query.team),
            '球団が見つかりません',
            404,
          );
          return structuredClone(index[query.team]);
        }
        if (kind === 'players') {
          const own = index[userId];
          requireOnline(
            own && Object.hasOwn(own, query.id),
            '選手が見つかりません',
            404,
          );
          return structuredClone(own[query.id]);
        }
        // 共通の権限・ページ検証を使い、世界本体を展開しない。
        return project(
          {
            league: {
              members: [{ userId, teamName: row.views[userId].teamName }],
              season: { year: row.views[userId].year, results: [] },
              records: { seasons: { [year]: { games: index } } },
            },
          },
          year,
        );
      } catch (error) {
        if (error.storageStatus !== 404 || attempt === 1) throw error;
        row = await this.recordRow(userId);
      }
    }
  }
  readTeamInfo(userId, teamName) {
    return this.readRecord(userId, 'teams', { team: teamName }, (bundle) =>
      projectTeamInfo(bundle, userId, teamName),
    );
  }
  readPlayerInfo(userId, id) {
    return this.readRecord(userId, 'players', { id }, (bundle) =>
      projectPlayerInfo(bundle, userId, id),
    );
  }
  readGames(userId, query) {
    return this.readRecord(userId, 'games', query, (bundle) =>
      projectGames(bundle, userId, query),
    );
  }
  readGameInfo(userId, id, year) {
    return this.readRecord(userId, 'games', { id, year }, (bundle, resolved) =>
      projectGameInfo(bundle, userId, id, resolved),
    );
  }
  async publishArchive(data, previous) {
    const json = JSON.stringify(data),
      hash = createHash('sha256').update(json).digest('hex');
    if (previous?.hash === hash) return previous;
    const path = `archives/${randomUUID()}.json.gz`;
    await this.request(`/storage/v1/object/online-world/${path}`, {
      method: 'POST',
      raw: true,
      body: gzipSync(json),
    });
    return { path, hash };
  }
  async createArchive(bundle, previous) {
    const retainedYears = Object.keys(previous?.games || {}).filter(
      (year) =>
        previous?.version === 2 &&
        Number(year) < bundle.league?.season.year &&
        bundle.league.records?.seasons?.[year]?.archiveToken &&
        previous.games[year].finalizedToken ===
          bundle.league.records.seasons[year].archiveToken,
    );
    const data = buildArchiveIndex(bundle, retainedYears);
    if (!data) return null;
    const players = await this.publishArchive(data.players, previous?.players),
      teams = await this.publishArchive(data.teams, previous?.teams),
      games = Object.fromEntries(
        retainedYears.map((year) => [year, previous.games[year]]),
      );
    for (const [year, value] of Object.entries(data.games))
      games[year] = {
        ...(await this.publishArchive(value, previous?.games?.[year])),
        finalizedToken:
          bundle.league.records?.seasons?.[year]?.archiveToken || null,
      };
    return {
      version: 2,
      players,
      teams,
      games,
      previous: [
        previous
          ? {
              players: previous.players,
              teams: previous.teams,
              games: previous.games,
            }
          : null,
        ...(previous?.previous || []),
      ]
        .filter(Boolean)
        .slice(0, 2),
    };
  }
  /** 球団の索引だけ作り直す（選手・試合の索引は前のまま）。中身が同じなら前の索引をそのまま返す */
  async refreshTeamsArchive(bundle, previous) {
    const data = buildTeamsIndex(bundle);
    if (!data) return previous;
    const teams = await this.publishArchive(data, previous.teams);
    if (teams === previous.teams) return previous;
    return {
      ...previous,
      teams,
      // ⚠ 古い球団の索引も前の世代として残す（読んでいる途中の人が消えたファイルを踏まないように。
      //    `createArchive` と同じ）
      previous: [
        { players: previous.players, teams: previous.teams, games: previous.games },
        ...(previous.previous || []),
      ].slice(0, 2),
    };
  }
  /**
   * 保存一式を書き換える（リースを取って読み、命令を当て、新しい世代として公開する）。
   *
   * ⚠ **まず軽く読む**（芯と記録だけ。`snapshotParts.mjs`）。命令かビュー作りが世界の部分に
   *    触ったら、読み直して全体でやり直す。世界を必ず読む処理（定期進行・トレード・キャンプなど）は
   *    `{ full: true }` で最初から全体を読む（やり直しの1回ぶんを省くため。正しさはどちらでも同じ）。
   */
  /**
   * 命令を1回走らせ、変更があれば公開するビュー・記録の索引・保存する形を作る（`transaction` の1回ぶん）。
   * `loaded.run` があれば軽い読み（保存する形は `run.inspect`。null なら全体で読み直す）
   */
  async attemptCommand(fn, loaded, row) {
    let views, archives, prepared;
    const value = loaded.bundle;
    const outcome = await fn(value);
    if (!outcome?.unchanged) {
      // ⚠ **ビューはリーグの参加者ぶん作る**。環境変数で固定していた頃の
      //    `this.members` を使うと、招待で増えた人のぶんが作られず、
      //    その人は自分の球団を見られなくなる。
      const viewMembers = value.league?.members?.length
        ? value.league.members
        : this.members;
      views = Object.fromEntries(
        viewMembers.map((m) => [
          m.userId,
          projectLeague(
            value,
            m.userId,
            // 書けるかは読むときに端末ごとに決め直す（`readView`）。ここは目安
            sessionIdsOf(value.sessions[m.userId])[0],
            this.adminId,
          ),
        ]),
      );
      // ⚠ 記録に関わらない命令（編成の保存）は、選手・試合の索引に前のものを使う（作り直しは全試合をなめて重い）。
      //    **球団の索引だけは作り直す**。球団情報に今の起用（打順・ローテ）が入るので、前のままだと
      //    他球団の画面に次の進行まで古いスタメンが出ていた（ファイル保存は毎回作るので本番だけ食い違った）
      archives =
        outcome?.archiveUnchanged && row.views?._records
          ? await this.refreshTeamsArchive(value, row.views._records)
          : await this.createArchive(value, row.views?._records);
      if (archives) views._records = archives;
      views._meta = leagueMetaOf(value.league);
      prepared = loaded.run
        ? loaded.run.inspect(value)
        : { bundle: value };
    }
    return { outcome, views, archives, prepared };
  }
  async transaction(fn, { full = false } = {}) {
    const token = randomUUID();
    const row = (await this.rpc('online_claim', { p_token: token }))[0];
    requireOnline(
      row,
      '他の処理が実行中です。少し待って再読込してください',
      409,
      'busy',
    );
    let published = false;
    try {
      // ⚠ まず軽い読み、だめなら全体で読み直す判定は `runWithLightRead`（検査用の保存と共通）
      const { loaded, outcome, views, archives, prepared } = await runWithLightRead({
        full,
        load: async (light) => {
          const loaded = await this.loadSnapshot(row, { light });
          return { ...loaded, run: loaded.light || null };
        },
        attempt: (loaded) => this.attemptCommand(fn, loaded, row),
      });
      if (outcome?.unchanged) return outcome.value;
      const { path, refs } = await this.writeSnapshot(prepared, loaded.refs);
      const partHistory = [refs, ...(row.views?._parts?.history || [])].slice(0, 3);
      views._parts = { history: partHistory };
      published = await this.rpc('online_publish', {
        p_token: token,
        p_generation: row.generation,
        p_path: path,
        p_views: views,
        p_sessions: loaded.bundle.sessions,
      });
      requireOnline(
        published,
        '処理の有効期限が切れたため更新しませんでした。再読込してください',
        409,
        'lease',
      );
      // ⚠ 命令の返事に載せた自分のビューに、いま公開した世代を押す（公開は世代を必ず1つ上げる。
      //    `online_publish`）。押さないと、端末は次の読み直しで同じビューをまるごと取り直していた
      const replied = outcome?.value?.view;
      if (replied && typeof replied === 'object' && !Array.isArray(replied))
        replied.viewGeneration = row.generation + 1;
      // current + 直前2世代を残す。削除失敗は公開済みの更新を失敗扱いにしない。
      // 部分（world・records など）は、残す3世代のどれかが指していれば残す
      const keep = [row.snapshot_path, ...(row.previous_paths || [])].filter(
        Boolean,
      );
      const retainedArchives = archiveReferences(archives);
      const retainedParts = partReferences(partHistory);
      const obsolete = [
        ...keep.slice(2),
        ...[...archiveReferences(row.views?._records)].filter(
          (path) => !retainedArchives.has(path),
        ),
        ...[...partReferences(row.views?._parts?.history)].filter(
          (path) => !retainedParts.has(path),
        ),
      ];
      if (obsolete.length)
        await this.request('/storage/v1/object/online-world', {
          method: 'DELETE',
          body: { prefixes: obsolete },
        }).catch(() =>
          console.error('online: 古いスナップショットの削除が必要です'),
        );
      return outcome?.value;
    } finally {
      // publishの応答喪失時にも新オブジェクトを削除しない（既に公開済みの可能性）。
      if (!published)
        await this.rpc('online_release', { p_token: token }).catch(() => {});
    }
  }
  /**
   * 新しい世代を書く。部分は中身が変わったときだけ上げ直し、変わらなければ前の参照を使う。
   * `prepared` は全体の bundle（`{ bundle }`）か、軽い読みの `inspect` の結果。
   */
  async writeSnapshot(prepared, previous = {}) {
    let core, order, refs;
    if (prepared.bundle) {
      const split = splitBundle(prepared.bundle);
      core = split.core;
      order = split.order;
      refs = {};
      for (const [name, data] of Object.entries(split.parts))
        refs[name] = await this.publishPart(name, data, previous[name]);
    } else {
      core = prepared.core;
      order = prepared.order;
      // 軽い読みで読んでいない部分（world・backup）は前のまま。記録は変わったときだけ上げ直す
      refs = { ...previous };
      if (prepared.whole || prepared.records === undefined) delete refs.records;
      else refs.records = await this.publishPart('records', prepared.records, previous.records);
    }
    // ⚠ 包みの一番上に `sessions` や `league` を置かないこと。この形を知らない古いコードに
    //    戻したとき、古いコードは包みを bundle として読み、`bundle.sessions[...]` で例外になって
    //    **何も書かずに断る**（閲覧は保存済みのビューで続く）。`league` が見えないまま
    //    「リーグが無い」と判断して作り直す、という事故を起こさないため
    const path = `snapshots/${randomUUID()}.json.gz`;
    await this.request(`/storage/v1/object/online-world/${path}`, {
      method: 'POST',
      raw: true,
      body: gzipSync(
        JSON.stringify({ snapshotFormat: SNAPSHOT_FORMAT, order, parts: refs, core }),
      ),
    });
    return { path, refs };
  }
  async publishPart(name, data, previous) {
    const json = JSON.stringify(data),
      hash = createHash('sha256').update(json).digest('hex');
    if (previous?.hash === hash) return previous;
    const path = `parts/${name}-${randomUUID()}.json.gz`;
    await this.request(`/storage/v1/object/online-world/${path}`, {
      method: 'POST',
      raw: true,
      body: gzipSync(json),
    });
    return { path, hash };
  }
}
