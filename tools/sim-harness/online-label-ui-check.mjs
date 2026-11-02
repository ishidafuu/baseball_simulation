// 配布HTMLと実際のサーバーprojectionを接続する。通信/Authのみfixture。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { withDeadline } from './lib/deadline.mjs';
import {
  ONLINE_SCHEMA,
  ONLINE_ENGINE_VERSION,
} from '../../src/online/shared.js';
import {
  projectLeague,
  projectPlayerInfo,
  projectTeamInfo,
  projectGameInfo,
  projectGames,
} from '../../server/projection.mjs';
import {
  zeroLine,
  BATTING_KEYS,
  PITCHING_KEYS,
} from '../../src/online/recordStats.js';
import { choose, chosen } from './lib/choose.mjs';
const html = await readFile(
  new URL('../../dist/index.html', import.meta.url),
  'utf8',
);
const player = (id, overrides = {}) => ({
  id,
  name: `成績選手${id}`,
  age: 22,
  condition: id % 5,
  fatigue: (id % 10) * 2,
  position: id === 9 ? 'pitcher' : 'center',
  batting: { meet: 50, power: 50 },
  pitching: {
    velocity: 140,
    control: 50,
    stamina: 120,
    spinRate: 65,
    form: 'threeQuarter',
    arsenal: [
      { type: 'straight', level: 100 },
      { type: 'slider', level: 45 },
    ],
  },
  physical: {
    speed: 70,
    arm: 65,
    throws: 'right',
    bodyStamina: 72,
    recovery: 68,
    muscle: 55,
    dexterity: 62,
    build: 'medium',
  },
  personality: { discipline: 70, mental: 55 },
  catching: { lead: 60 },
  positionFitness: {
    pitcher: 20,
    catcher: 50,
    first: 70,
    second: 80,
    third: 60,
    short: 50,
    left: 80,
    center: 100,
    right: 80,
  },
  seasonStats: {
    batting: {
      games: 30,
      atBats: 100,
      rbis: id === 24 ? 200 : 42,
      hitByPitch: 0,
      caughtStealing: 0,
      errors: 1,
      fieldingChances: 20,
      hits: 25,
      doubles: 4,
      triples: 0,
      homeruns: 2,
      walks: 10,
      strikeouts: 20,
      stolenBases: 0,
      sacrificeBunts: 0,
      ...overrides,
    },
    pitching: {
      games: 10,
      wins: 2,
      losses: 1,
      saves: 0,
      holds: 0,
      hits: 10,
      runsAllowed: 6,
      pitches: 500,
      qualityStarts: 4,
      highQualityStarts: 1,
      inningsPitched: 54,
      strikeouts: id === 9 ? 40 : 12,
      walks: id === 9 ? 0 : 4,
      homeruns: 2,
      earnedRuns: 4,
    },
  },
});
const stars = [
  player(1, { hits: 45, walks: 30, strikeouts: 65 }),
  ...Array.from({ length: 23 }, (_, i) => player(i + 2)),
];
// 初登板で1/3回・4失点なら防御率108.00。通常範囲の大きな値でも列を跨がない。
Object.assign(stars[0].seasonStats.pitching, {
  games: 1,
  wins: 0,
  losses: 1,
  hits: 3,
  walks: 2,
  strikeouts: 1,
  inningsPitched: 1,
  runsAllowed: 4,
  earnedRuns: 4,
  pitches: 30,
  qualityStarts: 0,
  highQualityStarts: 0,
});
const positions = [
  'catcher',
  'first',
  'second',
  'third',
  'short',
  'left',
  'center',
  'right',
];
const league = {
  // ⚠ 版を載せること。`projectLeague` は古い形のリーグを投影せず
  //    「更新を取り込みます」だけ返すので、載せ忘れると名簿が空になる
  schema: ONLINE_SCHEMA,
  engineVersion: ONLINE_ENGINE_VERSION,
  revision: 1,
  status: 'running',
  season: {
    year: 1,
    currentDate: { year: 2024, month: 6, day: 1 },
    settings: { teamNames: ['A', 'B', 'C', 'D'] },
    results: [],
    schedule: [],
    standings: [],
  },
  members: [{ userId: 'a', teamName: 'A', label: '自分' }],
  history: [],
  notices: [],
  game: {
    teams: Object.fromEntries(
      ['A', 'B', 'C', 'D'].map((name) => [
        name,
        {
          players: name === 'A' ? stars : [player(100)],
          lineupSettings: {
            battingOrder: positions.map((position, i) => ({
              playerId: i + 1,
              position,
              battingOrder: i + 1,
            })),
          },
          pitchingRotation: { starters: [9] },
          strategy: {},
        },
      ]),
    ),
  },
};
league.season.year = 2;
const line = (hits) => ({ ...zeroLine(), pa: 20, atBats: 20, hits });
const key = `A:1:${stars[0].name}`;
const annual = {
  key,
  id: 1,
  name: stars[0].name,
  teams: ['A'],
  stats: {
    batting: {
      ...zeroLine(BATTING_KEYS),
      games: 20,
      plateAppearances: 40,
      atBats: 40,
      hits: 12,
    },
    pitching: zeroLine(PITCHING_KEYS),
  },
  splits: {
    batting: {
      all: { ...zeroLine(), pa: 40, atBats: 40, hits: 12 },
      risp: line(10),
      emptyRisp: line(2),
    },
    pitching: {},
  },
  games: [],
  starts: [],
};
const oldGames = Object.fromEntries(
  Array.from({ length: 20 }, (_, i) => {
    const home = i % 3 === 0 ? 'C' : 'A',
      away = i % 3 === 0 ? 'D' : 'B';
    return [
      i + 1,
      {
        gameId: i + 1,
        year: 1,
        date: { year: 2024, month: 4, day: i + 1 },
        home,
        away,
        homeScore: 4,
        awayScore: 2,
        teams: {
          [home]: stars.slice(0, 12).map((p, n) => ({
            id: p.id,
            name: p.name,
            battingOrder: n < 9 ? n + 1 : 0,
            batting: {
              ...zeroLine(BATTING_KEYS),
              plateAppearances: 12,
              atBats: 12,
              hits: n + 1,
              rbis: n,
            },
            pitching: {
              ...zeroLine(PITCHING_KEYS),
              pitches: n === 8 ? 80 : 0,
              inningsPitched: n === 8 ? 18 : 0,
            },
          })),
          [away]: [],
        },
      },
    ];
  }),
);
league.records = {
  version: 1,
  seasons: {
    1: {
      year: 1,
      league: 'shikoku',
      complete: true,
      players: { [key]: annual },
      games: oldGames,
      comparison: null,
    },
  },
};
stars[0].statsHistory = [
  {
    year: 1,
    batting: { ...stars[0].seasonStats.batting, hitByPitch: 2 },
    pitching: stars[0].seasonStats.pitching,
  },
];
stars[0].careerStats = {
  batting: { atBats: 100, hits: 45 },
  pitching: { inningsPitched: 54, strikeouts: 10 },
};
const view = projectLeague(
  { league, sessions: { a: 'fixture' } },
  'a',
  'fixture',
  'a',
);
const beforeProjection = JSON.stringify(league);
const previousRandom = Math.random;
try {
  Math.random = () => {
    throw new Error('閲覧projectionで乱数を消費しない');
  };
  projectLeague({ league, sessions: { a: 'fixture' } }, 'a', 'fixture', 'a');
} finally {
  Math.random = previousRandom;
}
assert.equal(
  JSON.stringify(league),
  beforeProjection,
  '閲覧で元の世界を変更しない',
);
assert.equal(view.roster[0].physical.speed, 70);
assert.equal(view.roster[4].condition, 0, '絶不調0を欠損にしない');
assert.equal(
  view.roster[0].pitching.velocity,
  140,
  '野手の投球能力も閲覧できる',
);
assert.equal(view.nextStarterId, 9);
assert.equal(view.roster[0].performance.batting.labels.length, 3);
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROME_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHROME_CHANNEL }
    : {}),
  headless: true,
});
const errors = [];
let activeContext;
async function scene(width, height = 844, scale = 1, holdDetail = false) {
  let requests = 0,
    signalDetail,
    releaseDetail;
  const started = new Promise((resolve) => {
    signalDetail = resolve;
  });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    isMobile: width < 768,
  });
  activeContext = context;
  await context.tracing.start({ screenshots: true, snapshots: true });
  context.on('close', () => {
    if (activeContext === context) activeContext = null;
  });
  await context.addInitScript(() => {
    localStorage.setItem(
      'baseball-online-auth-v1',
      JSON.stringify({
        userId: 'a',
        sessionId: 'fixture',
        accessToken: 'fixture',
      }),
    );
    window.__onlineViewportChanges = [];
    const media = matchMedia('(max-width: 767px)');
    media.addEventListener('change', (event) => {
      window.__onlineViewportChanges.push({
        matches: event.matches,
        width: innerWidth,
        height: innerHeight,
      });
    });
  });
  await context.route('http://localhost:3000/**', async (route) => {
    if (route.request().resourceType() === 'document')
      return route.fulfill({ contentType: 'text/html', body: html });
    const action = new URL(route.request().url()).searchParams.get('action');
    if (['player', 'game', 'games'].includes(action)) requests++;
    if (action === 'player' && holdDetail) {
      signalDetail();
      await new Promise((resolve) => {
        releaseDetail = resolve;
      });
    }
    assert.ok(
      ['config', 'view', 'player', 'game', 'games', 'team'].includes(action),
      '閲覧だけで更新APIを呼ばない',
    );
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        action === 'config'
          ? { local: true }
          : action === 'team'
            ? projectTeamInfo(
                { league },
                'a',
                new URL(route.request().url()).searchParams.get('team'),
              )
            : action === 'player'
              ? projectPlayerInfo(
                  { league },
                  'a',
                  new URL(route.request().url()).searchParams.get('id'),
                )
              : action === 'game'
                ? projectGameInfo(
                    { league },
                    'a',
                    new URL(route.request().url()).searchParams.get('id'),
                    new URL(route.request().url()).searchParams.get('year'),
                  )
                : action === 'games'
                  ? projectGames(
                      { league },
                      'a',
                      Object.fromEntries(
                        new URL(route.request().url()).searchParams,
                      ),
                    )
                  : view,
      ),
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:3000/online');
  return {
    page,
    context,
    detailRequests: () => requests,
    started,
    release: () => releaseDetail(),
  };
}
// 表は左の選手名の列が固定で、狭い画面では横に流す。列見出しを押す前に、
// その列を右端へ寄せて固定列に隠れないようにする（指で横に送るのと同じ）
const sortBy = async (page, label) => {
  const button = page.getByRole('button', { name: `${label}で並べ替え`, exact: true }).first();
  await button.evaluate((e) => e.scrollIntoView({ inline: 'end', block: 'nearest' }));
  await button.click();
};
try {
  // ⚠ 2026-11 の作り直しで、選手一覧は「野手・投手の2つの表を1画面に」（ページ送りと
  //    成績の項目群セレクトは無くした）、選手詳細は「タブ切替」から「縦に並べた1枚」になった。
  //    この検査は、成績の札（略称と正式名）・詳細の開閉とフォーカス・期間と場面別・
  //    並べ替え・横にはみ出さないこと、を新しい画面で見る
  const { page: p, context } = await scene(1440, 1000);
  await p.getByRole('button', { name: '選手', exact: true }).click();
  // 他球団は「他球団を見る」を押したときだけ選ぶ
  await p.getByRole('button', { name: '他球団を見る', exact: true }).click();
  await choose(p, '閲覧する球団', 'B');
  await p
    .getByRole('button', { name: '成績選手100の選手情報を見る', exact: true })
    .click();
  await p
    .getByRole('dialog', { name: '成績選手100', exact: true })
    .getByRole('heading', { name: '能力すべて', exact: true })
    .waitFor();
  await p.keyboard.press('Escape');
  await choose(p, '閲覧する球団', 'A');
  await p
    .getByRole('button', { name: '成績選手1の選手情報を見る', exact: true })
    .waitFor();
  const first = p.locator('tbody tr').first();
  // 一覧の札は2個まで・3文字以内の略称。読み上げと title は正式名
  const listLabels = first.locator('.online-stat-label');
  assert.equal(await listLabels.count(), 2, '一覧の札は2個まで');
  assert.ok(
    (await listLabels.allTextContents()).every((t) => [...t].length <= 3),
    '一覧の略称は3文字以内',
  );
  assert.equal(
    await listLabels.first().getAttribute('aria-label'),
    'アベレージヒッター',
    '略称でも正式名を読み上げる',
  );
  await p
    .getByRole('button', { name: '成績選手1の選手情報を見る', exact: true })
    .click();
  const dialog = p.getByRole('dialog', { name: '成績選手1', exact: true });
  await dialog.waitFor();
  await dialog.getByText('.450', { exact: true }).first().waitFor();
  assert.equal(
    await dialog.locator('.online-player-top .online-stat-label').count(),
    3,
    '詳細では札を3個まで正式名で出す',
  );
  await dialog.getByText('アベレージヒッター', { exact: true }).waitFor();
  await p.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(
    await p
      .getByRole('button', { name: '成績選手1の選手情報を見る', exact: true })
      .evaluate((e) => document.activeElement === e),
    'Escape後に選手名へフォーカスを戻す',
  );
  // 投手の表も同じ画面にある
  await p
    .getByRole('button', { name: '成績選手9の選手情報を見る', exact: true })
    .click();
  await p
    .getByRole('dialog', { name: '成績選手9', exact: true })
    .getByText('制球安定', { exact: true })
    .first()
    .waitFor();
  await p.keyboard.press('Escape');
  await p
    .getByRole('dialog', { name: '成績選手9', exact: true })
    .waitFor({ state: 'hidden' });
  const currentNav = () =>
    p.locator('.online-nav-items [aria-current="page"]').getAttribute('aria-label');
  assert.equal(await currentNav(), '選手', '詳細を閉じても元の一覧に留まる');
  await p.setViewportSize({ width: 700, height: 1000 });
  await p.locator('.online-tabbar').waitFor();
  assert.equal(
    await p.locator('.online-tabbar [aria-current="page"]').getAttribute('aria-label'),
    '選手',
    'スマホ表示に切り替えても選手画面のまま',
  );
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.locator('.online-nav-items').waitFor();
  assert.equal(await currentNav(), '選手', '表示形式を往復しても選手画面を維持する');
  await p.screenshot({
    path: '/tmp/baseball-online-labels-desktop.png',
    fullPage: true,
  });
  // 列見出しで並べ替え（OPSの高い順 → 成績選手1）
  await p.getByRole('button', { name: 'OPSで並べ替え', exact: true }).first().click();
  await p
    .locator('tbody tr')
    .first()
    .getByRole('button', { name: '成績選手1の選手情報を見る', exact: true })
    .waitFor();
  await context.close();
  for (const width of [320, 360, 390, 767]) {
    const { page: m, context: c } = await scene(
      width,
      640,
      width === 360 ? 3 : 1,
    );
    await m.getByRole('button', { name: '選手', exact: true }).click();
    await m
      .getByRole('button', { name: '成績選手1の選手情報を見る', exact: true })
      .click();
    const d = m.getByRole('dialog', { name: '成績選手1', exact: true });
    await d.waitFor();
    const detailBounds = await d.boundingBox();
    assert.ok(
      Math.abs(detailBounds.width - width) <= 1,
      'スマホの詳細パネルは画面幅いっぱいに使う',
    );
    await d.getByRole('heading', { name: '能力すべて', exact: true }).waitFor();
    await d.getByRole('heading', { name: '場面別', exact: true }).waitFor();
    assert.ok(
      await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      '名前とラベルが横にはみ出さない',
    );
    await m.screenshot({
      path: `/tmp/baseball-online-labels-mobile-${width}.png`,
      fullPage: true,
    });
    // 期間を変えると、成績と場面別がその期間の記録になる
    const splits = d.locator('section').filter({
      has: m.getByRole('heading', { name: '場面別', exact: true }),
    });
    await choose(d, '成績の期間', 'online:1');
    assert.deepEqual(
      await splits.locator('.online-stat-grid dd').allTextContents(),
      ['20', '.500', '.500', '1.000'],
      '過去年の場面別集計を取得できる',
    );
    await choose(d, '場面別の区分', 'emptyRisp');
    assert.deepEqual(
      await splits.locator('.online-stat-grid dd').allTextContents(),
      ['20', '.100', '.100', '.200'],
    );
    await choose(d, '成績の期間', 'career');
    await d.getByText('.300', { exact: true }).first().waitFor();
    await choose(d, '成績の期間', 'current');
    await d.getByRole('button', { name: '選手成績を閉じる', exact: true }).click();
    // 一覧：札は略称、打点で並べ替え
    const firstRow = m.locator('.online-roster-table tbody tr').first();
    const labels = firstRow.locator('.online-stat-label');
    assert.ok((await labels.count()) <= 2, '一覧の札は2個まで');
    assert.equal(await labels.first().getAttribute('title'), 'アベレージヒッター');
    await sortBy(m, '打点');
    await firstRow
      .getByRole('button', { name: '成績選手24の選手情報を見る', exact: true })
      .waitFor();
    assert.ok(
      await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      '表は枠の中で横に流し、画面ははみ出さない',
    );
    // 投手の表（野手と分けて出す）
    await choose(m, '表示する項目', 'pitching');
    await m
      .locator('.online-roster-table tbody tr')
      .first()
      .getByRole('button', { name: '成績選手9の選手情報を見る', exact: true })
      .waitFor();
    // 下タブとメニュー
    const tabbar = await m.locator('.online-tabbar').boundingBox();
    assert.ok(tabbar.y + tabbar.height <= 640 + 1, '下タブは画面の下端に収まる');
    await m.getByRole('button', { name: 'メニュー', exact: true }).click();
    const menu = m.getByRole('dialog', { name: 'メニュー', exact: true });
    await menu.getByRole('button', { name: '最新の状態に更新', exact: true }).waitFor();
    await m.screenshot({
      path: `/tmp/baseball-online-mobile-menu-${width}.png`,
      fullPage: true,
    });
    await m.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    assert.ok(
      await m
        .getByRole('button', { name: 'メニュー', exact: true })
        .evaluate((e) => e === document.activeElement),
      'メニューを閉じてメニューボタンにフォーカスが戻る',
    );
    // 試合記録と試合結果
    await m.getByRole('button', { name: '試合', exact: true }).click();
    // ⚠ 試合の入口は一覧1つ（2026-11。以前の「過去の試合・個人成績」パネルは無い）。
    //    年度は2年目以降だけ選べる
    if (await m.getByLabel('試合記録の年度', { exact: true }).count())
      await choose(m, '試合記録の年度', '1');
    await choose(m, '試合の表示範囲', 'league');
    await m
      .getByRole('button', { name: /の試合を見る$/ })
      .first()
      .click();
    const box = m.getByRole('dialog', { name: '試合結果', exact: true });
    await box.locator('tbody tr').first().waitFor();
    assert.ok(
      await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      '試合結果が横にはみ出さない',
    );
    await m.screenshot({
      path: `/tmp/baseball-online-game-record-${width}.png`,
      fullPage: true,
    });
    await box.getByRole('button', { name: '試合結果を閉じる', exact: true }).click();
    await c.close();
  }
  const switched = await scene(1440, 1000);
  await switched.page
    .getByRole('button', { name: '選手', exact: true })
    .click();
  const switchAuth = async (page) =>
    page.evaluate(() => {
      localStorage.setItem(
        'baseball-online-auth-v1',
        JSON.stringify({
          userId: 'b',
          sessionId: 'other-session',
          accessToken: 'other-account',
        }),
      );
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'baseball-online-auth-v1' }),
      );
    });
  await switchAuth(switched.page);
  await switched.page
    .getByRole('button', { name: '成績選手1の選手情報を見る', exact: true })
    .click();
  await switched.page
    .getByText(
      '別のタブでログインが変更されました。ログインし直してください。',
      { exact: false },
    )
    .waitFor();
  assert.equal(
    switched.detailRequests(),
    0,
    '別アカウントの認証で旧画面の詳細を取得しない',
  );
  await switched.context.close();
  const staleRead = await scene(1440, 1000, 1, true);
  await staleRead.page
    .getByRole('button', { name: '選手', exact: true })
    .click();
  await staleRead.page
    .getByRole('button', { name: '成績選手1の選手情報を見る', exact: true })
    .click();
  await withDeadline(staleRead.started, '選手詳細の取得開始');
  await switchAuth(staleRead.page);
  staleRead.release();
  await staleRead.page
    .getByText(
      '別のタブでログインが変更されました。ログインし直してください。',
      { exact: false },
    )
    .waitFor();
  assert.equal(
    staleRead.detailRequests(),
    1,
    'セッション変更前の応答も画面へ適用しない',
  );
  await staleRead.context.close();
  assert.deepEqual(errors, []);
  console.log(
    'online-label-ui-check PASS（配布HTMLと実projection・PC/スマホ320〜767px・成績の札・詳細/閉じる/フォーカス・期間と場面別・並べ替え・閲覧のみ / 通信はfixture）',
  );
} catch (error) {
  if (activeContext) {
    for (const page of activeContext.pages())
      console.error(
        '失敗時の画面',
        JSON.stringify({
          url: page.url(),
          errors,
          viewportChanges: await page
            .evaluate(() => window.__onlineViewportChanges)
            .catch(() => null),
          state: await page
            .locator('body')
            .innerText()
            .catch(() => null),
        }),
      );
    await activeContext.tracing
      .stop({ path: '/tmp/baseball-online-label-ui-failure.zip' })
      .catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
