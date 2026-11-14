import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { buildArchiveIndex } from '../../server/archiveIndex.mjs';
import { SupabaseStore } from '../../server/storage/supabaseStore.mjs';
import { createHandler } from '../../server/http.mjs';
import { LeagueService } from '../../server/leagueService.mjs';
import { Readable } from 'node:stream';
import { ONLINE_SCHEMA, ONLINE_ENGINE_VERSION } from '../../src/online/shared.js';
let row = {
  generation: 0,
  snapshot_path: null,
  previous_paths: [],
  sessions: {},
  views: {},
};
const objects = new Map();
let lease = null;
let rejectPublish = false;
let loseResponse = false;
let gets = 0;
const downloads = [];
let beforeDownload = null;
let missingStatus = 404;
let missingDetail = null;
const controlSelects = [];
let rejectNarrowSelect = false;
const pickColumns = (source, select) =>
  Object.fromEntries(
    select.split(',').map((item) => {
      const [alias, expr] = item.includes(':') ? item.split(':') : [item, item];
      // `列->"キー"->キー` のように何段でもたどる
      const [column, ...keys] = expr.split('->');
      let value = source[column];
      for (const key of keys) value = value?.[key.replace(/^"|"$/g, '')];
      return [alias, value ?? null];
    }),
  );
const fetchImpl = async (url, options) => {
  const path = new URL(url).pathname;
  const body =
    options.headers['Content-Type'] === 'application/json'
      ? JSON.parse(options.body)
      : options.body;
  let value;
  if (path.endsWith('/online_claim')) {
    if (lease) value = [];
    else {
      lease = body.p_token;
      value = [{ ...row }];
    }
  } else if (path.endsWith('/online_release')) {
    if (lease === body.p_token) lease = null;
    value = null;
  } else if (path.endsWith('/online_publish')) {
    if (rejectPublish) {
      value = false;
      lease = null;
    } else {
      assert.equal(lease, body.p_token);
      assert.equal(row.generation, body.p_generation);
      row = {
        generation: row.generation + 1,
        snapshot_path: body.p_path,
        previous_paths: [row.snapshot_path, ...row.previous_paths]
          .filter(Boolean)
          .slice(0, 2),
        views: body.p_views,
        sessions: body.p_sessions,
      };
      lease = null;
      value = true;
      if (loseResponse) {
        loseResponse = false;
        throw new Error('応答喪失');
      }
    }
  } else if (path.endsWith('/online_control')) {
    // PostgREST の select（`列`・`別名:列->"キー"`）を最低限まねる
    const select = new URL(url).searchParams.get('select');
    controlSelects.push(select);
    if (select !== '*' && rejectNarrowSelect)
      return new Response(JSON.stringify({ message: 'bad select' }), { status: 400 });
    value = [select === '*' ? row : pickColumns(row, select)];
  }
  else if (path === '/storage/v1/object/online-world') {
    for (const p of body.prefixes) objects.delete(p);
    value = {};
  } else if (path.startsWith('/storage/v1/object/online-world/')) {
    const key = path.split('/online-world/')[1];
    if (options.method === 'POST') {
      assert.ok(!objects.has(key));
      objects.set(key, body);
      value = {};
    } else {
      if (beforeDownload) {
        const effect = beforeDownload;
        beforeDownload = null;
        await effect();
      }
      gets++;
      downloads.push(key);
      return objects.has(key)
        ? new Response(objects.get(key))
        : new Response(JSON.stringify(missingDetail), {
            status: missingStatus,
          });
    }
  } else throw new Error(path);
  return new Response(JSON.stringify(value));
};
const store = new SupabaseStore({
  url: 'https://fixture.test',
  serviceKey: 'test-only',
  members: [{ userId: 'a' }, { userId: 'b' }],
  adminId: 'a',
  fetchImpl,
});
await store.transaction((b) => {
  b.sessions.a = 'session';
  return { value: 1 };
});
assert.equal((await store.read()).sessions.a, 'session');
const count = gets;
assert.equal((await store.readView('a', 'session')).setupRequired, true);
assert.equal(gets, count, '閲覧で巨大スナップショットを読まない');
await assert.rejects(
  store.transaction((b) => {
    b.sessions.a = 'bad';
    throw new Error('failed');
  }),
);
assert.equal((await store.read()).sessions.a, 'session');
rejectPublish = true;
await assert.rejects(
  store.transaction((b) => {
    b.sessions.a = 'expired';
  }),
  (error) => error.code === 'lease',
);
assert.equal(
  (await store.read()).sessions.a,
  'session',
  '期限切れの処理は公開されない',
);
rejectPublish = false;
loseResponse = true;
await assert.rejects(
  store.transaction((b) => {
    b.sessions.a = 'committed';
  }),
);
assert.equal(
  (await store.read()).sessions.a,
  'committed',
  '公開応答を失っても公開済みオブジェクトを削除しない',
);
for (let i = 0; i < 5; i++)
  await store.transaction((b) => {
    b.sessions.a = String(i);
  });
assert.equal(row.previous_paths.length, 2);
// 失敗時に残す未参照オブジェクト以外は3世代だけ。公開済み世代はすべて存在する。
for (const p of [row.snapshot_path, ...row.previous_paths])
  assert.ok(objects.has(p));
lease = 'other';
await assert.rejects(
  store.transaction(() => {}),
  (error) => error.code === 'busy',
);
lease = null;
// メタデータ取得後に3世代進み、読もうとした旧オブジェクトが削除される競合。
for (const [status, detail] of [
  [404, null],
  [400, { statusCode: '404', code: 'NoSuchKey', error: 'not_found' }],
  [400, { statusCode: '404', error: 'not_found' }],
]) {
  missingStatus = status;
  missingDetail = detail;
  const oldPath = row.snapshot_path;
  beforeDownload = async () => {
    for (let i = 0; i < 3; i++)
      await store.transaction((b) => {
        b.sessions.a = `concurrent:${i}`;
      });
  };
  assert.equal(
    (await store.read()).sessions.a,
    'concurrent:2',
    `不存在応答 ${status} から最新の一式へ再取得する`,
  );
  assert.equal(objects.has(oldPath), false);
  const currentObject = objects.get(row.snapshot_path);
  objects.delete(row.snapshot_path);
  await assert.rejects(
    store.read(),
    (error) => error.code === 'storage',
    '現行の保存自体が欠けた場合は空のリーグとして初期化しない',
  );
  objects.set(row.snapshot_path, currentObject);
}
// 本文が404以外のエラーは、ポインタが変わっていても再取得しない。
for (const detail of [
  { statusCode: '403', code: 'AccessDenied' },
  { statusCode: '400', code: 'InvalidRequest' },
]) {
  missingStatus = 400;
  missingDetail = detail;
  beforeDownload = async () => {
    for (let i = 0; i < 3; i++)
      await store.transaction((b) => {
        b.sessions.a = `blocked:${i}`;
      });
  };
  await assert.rejects(store.read(), (error) => error.storageStatus === 400);
}
// 詳細閲覧用の小さい派生記録も同じ公開世代で切り替え、世界一式を読み出さない。
beforeDownload = null;
missingStatus = 404;
missingDetail = null;
await store.transaction((bundle) => {
  const player = (id) => ({
    id,
    name: `参照選手${id}`,
    position: 'center',
    seasonStats: { batting: {}, pitching: {} },
  });
  bundle.league = {
    schema: ONLINE_SCHEMA,
    engineVersion: ONLINE_ENGINE_VERSION,
    revision: 1,
    status: 'running',
    members: [
      { userId: 'a', teamName: 'A' },
      { userId: 'b', teamName: 'B' },
    ],
    history: [],
    notices: [],
    game: {
      teams: { A: { players: [player(1)] }, B: { players: [player(2)] } },
    },
    season: {
      year: 1,
      currentDate: { year: 2024, month: 4, day: 2 },
      settings: { teamNames: ['A', 'B'] },
      standings: [],
      schedule: [],
      results: [
        {
          gameId: 1,
          date: { year: 2024, month: 4, day: 1 },
          home: 'A',
          away: 'B',
          result: { homeScore: 1, awayScore: 0 },
        },
      ],
    },
  };
});
downloads.length = 0;
controlSelects.length = 0;
assert.equal((await store.readPlayerInfo('a', 1)).name, '参照選手1');
assert.equal((await store.readGames('a', {})).count, 1);
assert.equal((await store.readGameInfo('a', 1, 1)).homeScore, 1);
// ⚠ 記録の読み出しで全員のビュー（select=*）を運ばない。要るのは索引と自分の球団名・年度だけ
assert.ok(
  controlSelects.length > 0 && controlSelects.every((sel) => sel !== '*'),
  `記録の読み出しで全員のビューを読んでいる: ${controlSelects.join(' / ')}`,
);
assert.ok(
  downloads.length > 0 &&
    downloads.every((path) => path.startsWith('archives/')),
  '閲覧は派生記録だけを読む',
);
assert.equal(
  (await store.readView('a', 'session'))._records,
  undefined,
  '内部Storageパスを画面へ渡さない',
);
await assert.rejects(
  store.readPlayerInfo('a', 2),
  (error) => error.status === 404,
  '相手の選手詳細を返さない',
);
await assert.rejects(
  store.readPlayerInfo('stranger', 1),
  (error) => error.status === 403,
);
await assert.rejects(
  store.readGameInfo('a', 'constructor', 1),
  (error) => error.status === 400,
);
await assert.rejects(
  store.readGames('a', { year: 'bad' }),
  (error) => error.status === 400,
);
downloads.length = 0;
assert.equal((await store.readGames('a', { year: 9999 })).count, 0);
await assert.rejects(store.readGameInfo('a', 1, 9999), (e) => e.status === 404);
assert.deepEqual(downloads, [], '存在しない年度で世界本体を取得しない');
// 保持対象年度の試合本文へ触れず、確定済み識別子が一致する場合のみ参照を再利用する。
const skipBundle = {
  league: {
    members: [],
    game: { teams: {} },
    season: { year: 2, results: [] },
    records: { seasons: { 1: {} } },
  },
};
Object.defineProperty(skipBundle.league.records.seasons[1], 'games', {
  get() {
    throw new Error('確定年度本文を再生成した');
  },
});
assert.deepEqual(buildArchiveIndex(skipBundle, ['1']).games, { 2: {} });
downloads.length = 0;
assert.equal((await store.readTeamInfo('a', 'B')).roster[0].id, 2);
assert.ok(
  downloads.every((p) => p.startsWith('archives/')),
  '相手球団も世界本体を展開しない',
);
await assert.rejects(
  store.readTeamInfo('stranger', 'B'),
  (e) => e.status === 403,
);
await assert.rejects(
  store.readTeamInfo('a', '__proto__'),
  (e) => e.status === 404,
);
const archived = row.views._records;
assert.ok(Number.isInteger(row.views._meta?.revision) && 'status' in row.views._meta, '保存にリーグ全体の進行情報（_meta）が無い');
// 直せる版かどうかも載せる（`isDue` が直せない版で起こさないため）
assert.equal(typeof row.views._meta.migratable, 'boolean', '_meta に直せるかの印が無い');
await store.transaction((bundle) => {
  bundle.sessions.a = 'archive-session';
});
assert.equal(
  row.views._records.players.path,
  archived.players.path,
  'ログインだけで不変の詳細記録を再転送しない',
);
assert.equal(row.views._records.games[1].path, archived.games[1].path);
// 記録に関わらない命令（archiveUnchanged）は索引を作り直さず、前の索引をそのまま公開する
{
  const before = row.views._records;
  const uploads = objects.size;
  await store.transaction((bundle) => {
    bundle.league.revision++;
    return { value: { ok: true }, archiveUnchanged: true };
  });
  assert.deepEqual(row.views._records, before, '索引の作り直しを省いても前の索引が残る');
  assert.equal(objects.size, uploads, '索引を作り直さないので新しい記録を上げない（世界一式の差し替えのみ）');
}
// ⚠ ただし**球団の索引は作り直す**（球団情報に今の起用が入る）。以前は前の索引を丸ごと使い、
//    他球団の画面に次の進行まで古いスタメンが出ていた（監査 2026-11-14）
{
  const before = row.views._records;
  await store.transaction((bundle) => {
    bundle.league.revision++;
    bundle.league.game.teams.B.players[0].name = '起用替え';
    return { value: { ok: true }, archiveUnchanged: true };
  });
  assert.notEqual(row.views._records.teams.path, before.teams.path, '球団の索引を作り直していない');
  assert.equal(row.views._records.players.path, before.players.path, '選手の索引まで作り直している');
  assert.equal(row.views._records.games[1].path, before.games[1].path, '試合の索引まで作り直している');
  const info = await store.readTeamInfo('a', 'B');
  assert.ok(JSON.stringify(info).includes('起用替え'), '他球団の球団情報が古いまま');
  assert.ok(
    (row.views._records.previous || []).some((x) => x.teams?.path === before.teams.path),
    '古い球団の索引を前の世代に残していない',
  );
  await store.transaction((bundle) => {
    bundle.league.game.teams.B.players[0].name = '参照選手2';
  });
}
// 命令の返事に載せたビューには、公開した世代が押される（端末は次の読み直しでビューを取り直さずに済む）
{
  const replied = await store.transaction((bundle) => {
    bundle.league.revision++;
    return { value: { ok: true, view: { teamName: 'A' } }, archiveUnchanged: true };
  });
  assert.equal(replied.view.viewGeneration, row.generation, '返事のビューに公開した世代が無い');
  const plain = await store.transaction((bundle) => {
    bundle.league.revision++;
    return { value: { ok: true }, archiveUnchanged: true };
  });
  assert.deepEqual(plain, { ok: true }, 'ビューの無い返事に世代を足している');
}
const oldArchivePath = row.views._records.players.path;
store.archiveCache.clear();
beforeDownload = async () => {
  for (let i = 0; i < 3; i++)
    await store.transaction((bundle) => {
      bundle.league.game.teams.A.players[0].name = `更新${i}`;
    });
};
assert.equal(
  (await store.readPlayerInfo('a', 1)).name,
  '更新2',
  '読取り中に旧派生記録が整理されたら最新世代へ再取得',
);
assert.equal(objects.has(oldArchivePath), false, '派生記録も3世代で整理する');
beforeDownload = null;
await store.transaction((bundle) => {
  bundle.league.records = {
    seasons: {
      1: {
        year: 1,
        players: {},
        games: {},
        comparison: {
          stats: { batting: {}, pitching: {} },
          splits: { batting: {}, pitching: {} },
        },
        archiveToken: 'finalized-year-1',
      },
    },
  };
});
const finalized = row.views._records.games[1];
await store.transaction((bundle) => {
  bundle.league.season.year = 2;
  bundle.league.season.results = [];
});
assert.deepEqual(
  row.views._records.games[1],
  finalized,
  '年度更新後は確定年度の参照をそのまま保持',
);
await store.transaction((bundle) => {
  bundle.league.records.seasons[1].archiveToken = 'restored-another-year-1';
});
assert.equal(
  row.views._records.games[1].finalizedToken,
  'restored-another-year-1',
  '異なるバックアップの確定年度を以前の参照で上書きしない',
);
// HTTP認証、メソッド、JSON/CORS、ユーザーID偽装の入口を確認する。
const handler = createHandler(
  {
    members: [{ userId: 'a' }],
    view: async () => ({ ok: true }),
    login: async () => ({ sessionId: 'fixture' }),
  },
  {
    local: false,
    authenticate: async (header) => {
      assert.equal(header, 'Bearer valid');
      return 'a';
    },
    cronSecret: 'secret',
    signIn: async (body) => {
      assert.equal(body.password, '検証用の日本語');
      return { userId: 'a' };
    },
  },
);
async function http(action, method, body, headers = {}) {
  const req = Readable.from(Array.isArray(body) ? body : body ? [body] : []);
  Object.assign(req, {
    url: `/?action=${action}`,
    method,
    headers: { host: 'site.test', authorization: 'Bearer valid', ...headers },
  });
  const res = {
    statusCode: 200,
    setHeader() {},
    end(v) {
      this.body = JSON.parse(v);
    },
  };
  await handler(req, res);
  return res;
}
assert.equal((await http('view', 'GET')).statusCode, 200);
assert.equal(
  (await http('view', 'GET', null, { origin: 'https://other.test' }))
    .statusCode,
  403,
);
assert.equal((await http('command', 'POST', '{')).statusCode, 400);
assert.equal((await http('tick', 'POST', '{}')).statusCode, 401);
assert.equal((await http('view', 'DELETE')).statusCode, 405);
const encoded = Buffer.from(JSON.stringify({ password: '検証用の日本語' }));
const split = encoded.indexOf(Buffer.from('検')) + 1;
assert.equal(
  (
    await http('login', 'POST', [
      encoded.subarray(0, split),
      encoded.subarray(split),
    ])
  ).statusCode,
  200,
  'UTF-8の途中で分割されたHTTPチャンクを壊さない',
);
// --- 招待された人（まだ参加者でない）が画面を開けるか -----------------
// ⚠ **本番だけで起きた抜け**。ローカルは毎回リーグ本体から画面を作るので
//    「招待コードを入れる」画面に辿り着くが、本番は**保存済みの画面データ**を
//    返す作りで、それは参加者ぶんしか無かった。該当なし → 403
//    「このリーグの参加者ではありません」で、招待された人が永久に参加できない。
//    ハーネスは `LeagueService` を直に呼ぶか FileStore を使うので捕まらなかった。
{
  const before = gets;
  row = {
    ...row,
    snapshot_path: 'snapshots/live.json.gz',
    sessions: { a: 'sa', c: 'sc' },
    views: {
      a: { teamName: '甲', revision: 7, schema: ONLINE_SCHEMA },
      _records: { games: {} },
    },
  };
  const join = await store.readView('c', 'sc');
  assert.equal(join.joinRequired, true, '招待された人が参加画面に辿り着けない');
  // ⚠ `revision` が要る。参加の命令は版を照合するので、0のままだと弾かれる。
  //    参加者のビューから借りる（全員同じ値）
  assert.equal(join.revision, 7, '参加の命令に使う revision が取れていない');
  assert.equal(join.writable, true, '参加の操作ができない');
  assert.equal(join.isAdmin, false);
  assert.ok(!('teamName' in join), '他球団の中身が漏れている');
  // ⚠ **スナップショットを取りに行かないこと**。参加していない人が画面を開く
  //    たびに数MBを読むことになる
  assert.equal(gets, before, '参加前の画面で巨大スナップショットを読んでいる');
  // 参加者は自分のビューのまま
  assert.equal((await store.readView('a', 'sa')).teamName, '甲');
  // ⚠ `_records` は参加者のビューではない。これを参加者と取り違えない
  row = { ...row, views: { _records: { games: {} } } };
  assert.equal(
    await store.readView('c', 'sc'),
    null,
    '_records を参加者のビューと取り違えている',
  );
  // リーグがまだ無ければ、参加ではなく作成の画面
  row = { ...row, snapshot_path: null, views: {} };
  assert.equal((await store.readView('a', 'sa')).setupRequired, true);
}

// ⚠ 閲覧と定期処理の判定は、自分のビューとリーグ全体の進行情報（`_meta`）だけを読む。
//    以前は `select=*` で全参加者のビューを毎回取り、60秒ごとの更新のたびに
//    参加人数ぶんの転送が発生していた
{
  const others = Object.fromEntries(
    Array.from({ length: 11 }, (_, i) => [`m${i}`, { teamName: `T${i}`, revision: 9, status: 'running', schema: ONLINE_SCHEMA, big: 'x'.repeat(1000) }]),
  );
  row = {
    ...row,
    snapshot_path: 'snapshots/live.json.gz',
    sessions: { m0: 's0' },
    views: {
      ...others,
      _meta: { schema: ONLINE_SCHEMA, revision: 9, status: 'running', nextAdvanceAt: '2026-01-01T00:00:00.000Z', phaseDeadline: null },
    },
  };
  controlSelects.length = 0;
  const own = await store.readView('m0', 's0');
  assert.equal(own.teamName, 'T0');
  assert.equal(own.writable, true);
  assert.ok(controlSelects.every((sel) => sel !== '*'), '閲覧で全員のビューを読んでいる');
  // 参加前の人は `_meta` の版で参加画面へ
  assert.equal((await store.readView('newcomer', 's9')).revision, 9);
  // ⚠ 管理者（a）がリーグに参加していなくても、定期処理は締め切り・進行時刻で起きる
  assert.equal(await store.isDue('2026-06-01T00:00:00.000Z'), true, '管理者が不参加だと定期処理が動かない');
  assert.equal(await store.isDue('2025-06-01T00:00:00.000Z'), false);
  assert.ok(controlSelects.every((sel) => sel !== '*'), '定期処理の判定で全員のビューを読んでいる');
  // ⚠ **直せない版のリーグで起こさない**。新しすぎる版・計算方法の違う版は
  //    定期処理でも直せないのに、毎回ロックと全体の読み込みをして失敗し、
  //    その間の参加者の操作を「処理中」で弾いていた（進行時刻が来ていても同じ）
  const liveMeta = row.views._meta;
  const dueWith = async (meta) => {
    row = { ...row, views: { ...row.views, _meta: { ...liveMeta, ...meta } } };
    return store.isDue('2025-06-01T00:00:00.000Z');
  };
  assert.equal(await dueWith({ schema: ONLINE_SCHEMA + 1, migratable: false }), false, '新しすぎる版で毎回起こしている');
  assert.equal(
    await dueWith({ schema: ONLINE_SCHEMA - 1, migratable: false, nextAdvanceAt: '2025-01-01T00:00:00.000Z' }),
    false,
    '計算方法の違う版で毎回起こしている',
  );
  assert.equal(await dueWith({ schema: ONLINE_SCHEMA - 1, migratable: true }), true, '直せる版を起こしていない');
  // `migratable` を持たない以前の `_meta` は版の範囲で判定する
  assert.equal(await dueWith({ schema: ONLINE_SCHEMA - 1 }), true, '以前の _meta で直せる版を起こしていない');
  // ⚠ 版が同じで計算方法だけ違うリーグも起こさない（直せない。前のサーバーが書いた `_meta` は
  //    版がいまと同じなので、版だけでは区別できなかった）
  assert.equal(
    await dueWith({ schema: ONLINE_SCHEMA, engineVersion: 'older-engine', nextAdvanceAt: '2025-01-01T00:00:00.000Z' }),
    false,
    '計算方法だけ違う版で毎回起こしている',
  );
  assert.equal(await dueWith({ schema: ONLINE_SCHEMA, engineVersion: ONLINE_ENGINE_VERSION, nextAdvanceAt: '2025-01-01T00:00:00.000Z' }), true, '同じ計算方法の進行時刻で起こしていない');
  assert.equal(await dueWith({ schema: ONLINE_SCHEMA + 1 }), false, '以前の _meta で新しすぎる版を起こしている');
  row = { ...row, views: { ...row.views, _meta: liveMeta } };
  // ⚠ 世代の近道（`since`）でも版の門番を飛ばさない。保存の形が古いまま
  //    （更新でサーバーの版が上がった直後）でも世代は変わらないので、
  //    世代だけ比べると開いていた画面に古いビューが残り、操作だけ弾かれていた
  {
    const viewer = new LeagueService(store, { adminId: 'a', members: [] });
    const fresh = await viewer.view('m0', 's0');
    assert.ok(Number.isInteger(fresh.viewGeneration), '前提: ビューに世代が載る');
    assert.equal((await viewer.view('m0', 's0', fresh.viewGeneration)).unchanged, true, '同じ世代なら送らない');
    row = {
      ...row,
      views: {
        ...row.views,
        m0: { ...row.views.m0, schema: ONLINE_SCHEMA - 1 },
        _meta: { ...liveMeta, schema: ONLINE_SCHEMA - 1 },
      },
    };
    const stale = await viewer.view('m0', 's0', fresh.viewGeneration);
    assert.equal(stale.unchanged, undefined, '保存の版が古いのに「変わっていない」と返す');
    assert.equal(stale.versionMismatch, true, '世代の近道で版の門番を飛ばしている');
    row = { ...row, views: { ...row.views, m0: others.m0, _meta: liveMeta } };
  }
  // 絞り込みが通らない環境では全列を読んで動く
  rejectNarrowSelect = true;
  const fallbackStore = new SupabaseStore({ url: 'https://fixture.test', serviceKey: 'test-only', members: [], adminId: 'a', fetchImpl });
  assert.equal((await fallbackStore.readView('m1', 'x')).teamName, 'T1');
  assert.equal(await fallbackStore.isDue('2026-06-01T00:00:00.000Z'), true);
  // ⚠ 世代だけの読み出し（定期の読み直し）にも予備の経路がある。以前はここだけ 400 で落ち、
  //    その環境では画面の読み直しが毎回失敗していた
  {
    const fresh = new SupabaseStore({ url: 'https://fixture.test', serviceKey: 'test-only', members: [], adminId: 'a', fetchImpl });
    const current = await fresh.readGeneration('m0', 's0');
    assert.equal(current.generation, row.generation, '絞り込みが通らない環境で世代を読めない');
    assert.equal(current.schema, ONLINE_SCHEMA);
    assert.equal(current.writable, true);
    const viewer = new LeagueService(fresh, { adminId: 'a', members: [] });
    const first = await viewer.view('m0', 's0');
    assert.equal((await viewer.view('m0', 's0', first.viewGeneration)).unchanged, true, '絞り込みが通らない環境で世代の近道が動かない');
  }
  rejectNarrowSelect = false;
}

console.log(
  'online-storage-check PASS（Storage公開境界・リース失効・応答喪失・小さい閲覧・招待された人の入口・HTTP入口 / 外部サービスはfixture）',
);
