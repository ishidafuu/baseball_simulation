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
    // 来たことの知らせ（`presence`）は画面を開くと送る。最終ログインを書くだけで版は上がらない
    if (action === 'presence')
      return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
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
try {
  const { page: p, context } = await scene(1440, 1000);
  // ⚠ 名前を変える小窓は 440px（選手の詳細の 760px に押し込まない）。説明は
  //    濃い面の上で読める明るい色（地色用の濃い文字だと読めなかった）
  await p.getByRole('button', { name: '名前を変える', exact: true }).click();
  const rename = p.getByRole('dialog', { name: '球団名・名前・ひとこと' });
  await rename.waitFor();
  // ⚠ 色は rgb の値そのものではなく、下の面とのコントラスト比で見る。値で縛ると、読める色へ
  //    少し変えただけで落ち、逆に面のほうが明るくなって読めなくなっても気づけない
  const renameLook = await rename.evaluate((node) => {
    const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const note = node.querySelector('.online-muted');
    let el = note;
    let bg = null;
    while (el) {
      const c = rgb(getComputedStyle(el).backgroundColor);
      if (c.length >= 3 && (c.length < 4 || c[3] >= 0.99)) { bg = c; break; }
      el = el.parentElement;
    }
    const fg = rgb(getComputedStyle(note).color);
    const [hi, lo] = [lum(fg), lum(bg || [255, 255, 255])].sort((x, y) => y - x);
    return {
      width: Math.round(node.getBoundingClientRect().width),
      contrast: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
      foundBg: Boolean(bg),
    };
  });
  assert.ok(renameLook.width <= 460, `名前を変える小窓が広い: ${renameLook.width}`);
  assert.ok(renameLook.foundBg, '名前を変える小窓の説明の下に不透明な面が見つからない');
  assert.ok(renameLook.contrast >= 4.5, `名前を変える小窓の説明が読めない色（コントラスト ${renameLook.contrast}:1）`);
  await rename.getByRole('button', { name: '閉じる', exact: true }).click();
  await rename.waitFor({ state: 'hidden' });
  await p.getByRole('button', { name: '選手成績', exact: true }).click();
  await p.getByLabel('閲覧する球団').selectOption('B');
  await p
    .getByRole('button', { name: '成績選手100の選手情報を見る', exact: true })
    .waitFor();
  await p
    .getByRole('button', { name: '成績選手100の選手情報を見る', exact: true })
    .click();
  // ⚠ 詳細は**1画面**。以前は「成績／能力・人物／場面別」の3タブに分かれて
  //    いた。札と経歴・成績・能力を一度に出す（`PlayerDetailBody`）
  const other = p.getByRole('dialog', { name: '成績選手100', exact: true });
  await other.locator('.online-career').waitFor();
  await other.getByRole('heading', { level: 3, name: /^成績/ }).waitFor();
  await other.getByRole('heading', { level: 3, name: /^能力/ }).waitFor();
  assert.equal(
    await other.getByRole('button', { name: '能力・人物', exact: true }).count(),
    0,
    '能力をタブで分けない',
  );
  await p.keyboard.press('Escape');
  await p.getByLabel('閲覧する球団').selectOption('A');
  await p
    .getByRole('button', { name: '成績選手1の選手情報を見る', exact: true })
    .waitFor();
  const first = p.locator('.online-roster-rows article').first();
  assert.equal(await first.locator('.online-stat-label').count(), 3);
  await p
    .getByRole('button', { name: '成績選手1の選手情報を見る', exact: true })
    .click();
  const dialog = p.getByRole('dialog', { name: '成績選手1', exact: true });
  await dialog.waitFor();
  await dialog.getByText('.450', { exact: true }).waitFor();
  await p.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(
    await p
      .getByRole('button', { name: '成績選手1の選手情報を見る', exact: true })
      .evaluate((e) => document.activeElement === e),
    'Escape後に選手名へフォーカスを戻す',
  );
  await p.getByRole('button', { name: '投球', exact: true }).click();
  await p
    .getByRole('button', { name: '成績選手9の選手情報を見る', exact: true })
    .click();
  // ⚠ 投手は**球種も同じ画面に**出す（以前は「能力・人物」タブの中の
  //    さらに別の区分だった）。成績の特徴の札は一覧の行で出す
  await p
    .getByRole('dialog', { name: '成績選手9', exact: true })
    .getByText('スライダー', { exact: true })
    .waitFor();
  await p.keyboard.press('Escape');
  await p
    .getByRole('dialog', { name: '成績選手9', exact: true })
    .waitFor({ state: 'hidden' });
  assert.equal(
    await p
      .locator('.online-page-nav [aria-current="page"]')
      .getAttribute('aria-label'),
    '選手成績',
    '詳細を閉じても元の一覧に留まる',
  );
  await p.setViewportSize({ width: 700, height: 1000 });
  await p.locator('.online-mobile-controls').waitFor();
  await p.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(
    await p
      .locator('.online-page-nav [aria-current="page"]')
      .getAttribute('aria-label'),
    '選手成績',
    '表示形式を往復しても選手画面を維持する',
  );
  await p.screenshot({
    path: '/tmp/baseball-online-labels-desktop.png',
    fullPage: true,
  });
  assert.equal(
    await p
      .locator('.online-page-nav [aria-current="page"]')
      .getAttribute('aria-label'),
    '選手成績',
    '全体キャプチャ後も選手画面を維持する',
  );
  // ⚠ PCの選手成績は**表が1つ**（能力一覧／成績一覧の切替は無くした）。
  //    区分はコンボボックスではなくボタンの列
  await p.getByRole('button', { name: '打撃', exact: true }).click();
  await p
    .getByRole('group', { name: '成績の表示項目', exact: true })
    .getByRole('button', { name: '打撃指標', exact: true })
    .click();
  await p.getByRole('button', { name: 'OPSで並べ替え', exact: true }).click();
  await p
    .locator('.online-roster-rows article')
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
    await m.getByRole('button', { name: '打順', exact: true }).click();
    // ⚠ スマホの打順は2タップの表（`TapLineup.jsx`）。名前を押すと**選ぶ**だけで、
    //    選手情報は選んでいる間に下の帯の「選手情報」から開く
    await m
      .getByRole('button', { name: '1番 成績選手1を選ぶ', exact: true })
      .click();
    await m
      .getByRole('button', { name: '成績選手1の選手情報を見る', exact: true })
      .click();
    const d = m.getByRole('dialog', { name: '成績選手1', exact: true });
    await d.waitFor();
    // ⚠ 詳細は**1画面**。タブも「表示項目」の選択も無く、経歴・成績・能力を
    //    まとめて出す（`PlayerDetailBody`）。走力は「身体」の中
    await d.locator('.online-career').waitFor();
    await d.getByRole('heading', { level: 3, name: /^成績/ }).waitFor();
    await d.getByRole('heading', { level: 3, name: /^能力/ }).waitFor();
    assert.equal(
      await d.getByLabel('能力の表示項目').count(),
      0,
      '能力を表示項目で分けない',
    );
    assert.equal(
      await d
        .locator('dt')
        .filter({ hasText: /^走力$/ })
        .first()
        .locator('..')
        .locator('dd')
        .innerText(),
      '70',
    );
    const detailBounds = await d.boundingBox();
    assert.ok(
      Math.abs(detailBounds.width - width) <= 1,
      'スマホの詳細パネルは画面幅いっぱいに使う',
    );
    await m.screenshot({
      path: `/tmp/baseball-online-mobile-abilities-${width}.png`,
      fullPage: true,
    });
    assert.ok(
      await m.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      '名前とラベルが横にはみ出さない',
    );
    await m.screenshot({
      path: `/tmp/baseball-online-labels-mobile-${width}.png`,
      fullPage: true,
    });
    await d.getByLabel('成績の期間').selectOption('online:1');
    // ⚠ 場面別だけは**畳んでおく**（打者×投手で行が多い）。開けること、
    //    閉じて元の1画面に戻れることを見る
    await d
      .getByRole('button', { name: '場面別の成績を見る', exact: true })
      .click();
    assert.deepEqual(
      await d.locator('.online-stat-grid dd').allTextContents(),
      ['20', '.500', '.500', '1.000'],
      '過去年の場面別集計を取得できる',
    );
    await d.getByLabel('場面別の区分').selectOption('emptyRisp');
    assert.deepEqual(
      await d.locator('.online-stat-grid dd').allTextContents(),
      ['20', '.100', '.100', '.200'],
    );
    await d
      .getByRole('button', { name: '場面別の成績を閉じる', exact: true })
      .click();
    assert.equal(
      await d.locator('.online-stat-grid').count(),
      0,
      '場面別を閉じたら消える',
    );
    await d.getByLabel('成績の期間').selectOption('career');
    await d.getByText('.300', { exact: true }).waitFor();
    await d.getByLabel('成績の期間').selectOption('legacy-career');
    await d.getByRole('heading', { level: 3, name: /^能力/ }).waitFor();
    await d.getByLabel('成績の期間').selectOption('current');
    await d
      .getByRole('button', { name: '選手成績を閉じる', exact: true })
      .click();
    // 選んだままの1番を2番と入れ替える（以前の「2番を上げる」と同じ並びになる）
    // （守備位置の札も同じ名前で同じ動き。名前の側を押す）
    await m
      .locator('[data-slot="2"] .online-tap-main')
      .getByText('成績選手2', { exact: true })
      .click();
    await m.getByRole('button', { name: 'メニュー', exact: true }).click();
    const menu = m.getByRole('dialog', { name: 'メニュー', exact: true });
    await menu.waitFor();
    await menu.getByRole('button', { name: '更新', exact: true }).waitFor();
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
      'メニューを閉じて下部ボタンにフォーカスが戻る',
    );
    // ⚠ 進行時刻の小窓は**カードの地色で出す**。スマホは本文のカードを一枚の面に
    //    溶かす指定（背景なし）が小窓のカードにも当たり、暗い幕の上に文字だけが浮いていた
    await m.getByRole('button', { name: 'メニュー', exact: true }).click();
    await menu.getByRole('button', { name: '進行時刻', exact: true }).click();
    const times = m.getByRole('dialog', { name: '進行時刻', exact: true });
    await times.waitFor();
    assert.match(
      await times
        .locator('.online-card')
        .evaluate((node) => getComputedStyle(node).backgroundColor),
      /^rgb\(/,
      `${width}px 進行時刻の小窓のカードに地色が無い`,
    );
    await m.keyboard.press('Escape');
    await times.waitFor({ state: 'hidden' });
    await m
      .getByRole('button', { name: '投手・控えを含む選手成績 →', exact: true })
      .click();
    await m.waitForFunction(
      () =>
        document.querySelectorAll('.online-compact-roster article').length >= 9,
    );
    const labels = m
      .locator('.online-compact-roster article')
      .first()
      .locator('.online-stat-label');
    assert.equal(
      await labels.count(),
      3,
      '行の高さを変えずにラベルを最大3個表示する',
    );
    assert.deepEqual(await labels.allTextContents(), [
      'アベヒ',
      '選球眼',
      '扇風機',
    ]);
    assert.ok(
      (await labels.allTextContents()).every((text) => [...text].length <= 3),
      '一覧の略称は3文字以内',
    );
    assert.equal(
      await labels.first().getAttribute('aria-label'),
      'アベレージヒッター',
      '略称でも正式名を読み上げる',
    );
    assert.equal(
      await labels.first().getAttribute('title'),
      'アベレージヒッター',
    );
    assert.ok(
      await labels.evaluateAll((nodes) =>
        nodes.every((node) => {
          const box = node.getBoundingClientRect();
          return (
            box.right <=
              node
                .closest('button')
                .querySelector('.online-roster-values')
                .getBoundingClientRect().left -
                1 && box.height <= 20
          );
        }),
      ),
      '3個の札が成績の数値を圧迫せず44px行に収まる',
    );
    const firstRow = m.locator('.online-compact-roster article').first();
    assert.deepEqual(
      await firstRow.locator('.online-roster-values > span').allTextContents(),
      ['.450', '2', '42', '0'],
      '基本成績を4列で比較できる',
    );
    await m
      .getByRole('button', { name: '打点で並べ替え', exact: true })
      .click();
    await firstRow
      .getByRole('button', { name: '成績選手24の選手情報を見る', exact: true })
      .waitFor();
    await m
      .getByRole('button', { name: '打点で並べ替え', exact: true })
      .click();
    await firstRow
      .getByRole('button', { name: '成績選手1の選手情報を見る', exact: true })
      .waitFor();
    const groups = m.getByLabel('成績の表示項目');
    await groups.selectOption('sabers');
    assert.deepEqual(
      await firstRow.locator('.online-roster-values > span').allTextContents(),
      ['1.127', '.577', '.550', '.100'],
    );
    await m
      .getByText('※ 出塁率・OPS・打席関連は概算', { exact: true })
      .waitFor();
    await m.getByRole('button', { name: 'OPSで並べ替え', exact: true }).click();
    await firstRow
      .getByRole('button', { name: '成績選手1の選手情報を見る', exact: true })
      .waitFor();
    await m.getByRole('button', { name: 'OPSで並べ替え', exact: true }).click();
    await firstRow
      .getByRole('button', { name: '成績選手2の選手情報を見る', exact: true })
      .waitFor();
    await m.screenshot({
      path: `/tmp/baseball-online-mobile-sabers-${width}.png`,
      fullPage: true,
    });
    for (const id of await groups
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value))) {
      await groups.selectOption(id);
      // ⚠ **捕手の区分は数に入れない**。受けた選手と捕手だけに絞るので
      //    （`isCatchingGroup`）、まだ誰も受けていなければ一覧は空になる。
      //    そのときに何も出ないと「読めていないのか記録が無いのか」が
      //    分からないので、一文を出すことだけを見る
      if (id === 'catching' || id === 'catchingAllowed') {
        const rows = await m.locator('.online-compact-roster article').count();
        if (!rows)
          await m
            .getByText('まだ捕手の記録がありません', { exact: false })
            .waitFor({ timeout: 3000 });
        continue;
      }
      assert.equal(
        await firstRow.locator('.online-roster-values > span').count(),
        4,
      );
      assert.ok(
        await firstRow
          .locator('.online-roster-values > span')
          .evaluateAll((cells) =>
            cells.every((cell) => cell.scrollWidth <= cell.clientWidth + 1),
          ),
        `${width}px ${id}で数値を切り落とさない: ${JSON.stringify(await firstRow.locator('.online-roster-values > span').evaluateAll((cells) => cells.map((cell) => ({ text: cell.textContent, w: cell.clientWidth, s: cell.scrollWidth, font: getComputedStyle(cell).fontSize }))))}`,
      );
      assert.ok(
        await m
          .locator('main')
          .evaluate(
            (element) => element.scrollHeight <= element.clientHeight + 1,
          ),
        '各項目群で縦スクロールなし',
      );
    }
    await groups.selectOption('abilities');
    await m.screenshot({
      path: `/tmp/baseball-online-mobile-grades-${width}.png`,
      fullPage: true,
    });
    assert.deepEqual(
      await firstRow.locator('.online-roster-values > span').allTextContents(),
      ['D', 'D', '—', 'B'],
      '一覧は既存PC判定の色付きランク',
    );
    await firstRow.getByRole('button').click();
    const numericDetail = m.getByRole('dialog');
    // ⚠ 一覧はランク、**詳細は実数値**。詳細は1画面になったので、能力は
    //    「打撃・走塁」「身体」などのかたまりに分かれて並んでいる
    const abilityValue = (label) =>
      numericDetail
        .locator('.online-detail-block dt')
        .filter({ hasText: new RegExp(`^${label}$`) })
        .first()
        .locator('..')
        .locator('dd')
        .innerText();
    assert.deepEqual(
      [
        await abilityValue('ミート'),
        await abilityValue('パワー'),
        await abilityValue('走力'),
      ],
      ['50', '50', '70'],
      '同じ能力でも詳細は実数値',
    );
    await m.keyboard.press('Escape');
    await groups.selectOption('state');
    await m
      .getByRole('button', { name: '調子で並べ替え', exact: true })
      .click();
    // ⚠ 調子は名前の横と「調子」の列の両方に同じ顔の印が出る（列で並べ替えるため）
    await firstRow
      .locator('.online-stat-condition')
      .getByLabel('調子: 絶好調', { exact: true })
      .waitFor();
    await m.screenshot({
      path: `/tmp/baseball-online-mobile-state-${width}.png`,
      fullPage: true,
    });
    await groups.selectOption('basic');
    assert.equal(
      await m.locator('.online-mobile-controls button').count(),
      3,
      '下部の共通操作は戻る・ホーム・メニューのみ',
    );
    const controls = await m.locator('.online-mobile-controls').boundingBox();
    assert.ok(
      controls.y >= 590 && controls.y + controls.height <= 640,
      '操作を親指の届く下部に置く',
    );
    assert.equal(
      await m.locator('.online-header').count(),
      0,
      'ブランドヘッダを重ねない',
    );
    await m.screenshot({
      path: `/tmp/baseball-online-labels-roster-${width}.png`,
      fullPage: true,
    });
    assert.ok(
      await m.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
      '一覧のために画面全体をスクロールしない',
    );
    await m.getByRole('button', { name: '投球', exact: true }).click();
    for (const id of await groups
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value))) {
      await groups.selectOption(id);
      assert.ok(
        await firstRow
          .locator('.online-roster-values > span')
          .evaluateAll((cells) =>
            cells.every((cell) => cell.scrollWidth <= cell.clientWidth + 1),
          ),
        `${width}px 投球${id}で数値が収まる`,
      );
    }
    await groups.selectOption('basic');
    // ⚠ 投球の一覧は既定で「投球回の多い順」になった（c2c46b9）。防御率108.00の
    //    選手（1/3回・4失点）は先頭に来ないので、防御率で並べ替えて先頭に出す。
    //    以前は先頭に来る前提のまま取り残され、ここで落ちていた
    const eraSort = m.getByRole('button', { name: '防御率で並べ替え', exact: true });
    await eraSort.click();
    if (!(await firstRow.getByText('108.00', { exact: true }).count()))
      await eraSort.click();
    await firstRow.getByText('108.00', { exact: true }).waitFor();
    assert.ok(
      await firstRow
        .locator('.online-roster-values > span')
        .evaluateAll((cells) =>
          cells.every((cell) => cell.scrollWidth <= cell.clientWidth + 1),
        ),
      `${width}px 防御率108.00でも列を跨がない`,
    );
    await firstRow.getByRole('button').click();
    // ⚠ 詳細に出す成績は**守備位置で決まる**（投手は投球、野手は打撃、
    //    二刀流は両方）。投球の一覧から野手を開いても打撃の成績が出る
    await m
      .getByRole('dialog', { name: '成績選手1', exact: true })
      .getByText('.450', { exact: true })
      .waitFor();
    await m.keyboard.press('Escape');
    await m
      .getByRole('button', { name: '成績選手9の選手情報を見る', exact: true })
      .click();
    await m
      .getByRole('dialog', { name: '成績選手9', exact: true })
      .getByText('スライダー', { exact: true })
      .waitFor();
    await m.keyboard.press('Escape');
    const pager = await m
      .getByRole('button', { name: '次のページ', exact: true })
      .boundingBox();
    assert.ok(pager.y + pager.height <= 592, 'ページ送りが画面内に収まる');
    const row = await m
      .locator('.online-compact-roster article')
      .last()
      .boundingBox();
    assert.ok(row.y + row.height <= pager.y, '最終行とページ送りが重ならない');
    await m.setViewportSize({ width, height: 844 });
    await m.waitForFunction(
      () =>
        document.querySelectorAll('.online-compact-roster article').length >=
        14,
    );
    while (
      await m
        .getByRole('button', { name: '次のページ', exact: true })
        .isEnabled()
    )
      await m.getByRole('button', { name: '次のページ', exact: true }).click();
    await m
      .getByRole('button', { name: '成績選手24の選手情報を見る', exact: true })
      .waitFor();
    await m.getByRole('button', { name: '戻る', exact: true }).click();
    await m.getByRole('heading', { name: '打順', exact: true }).waitFor();
    assert.equal(
      await m
        .getByRole('button', { name: '1番 成績選手2を選ぶ', exact: true })
        .count(),
      1,
      '選手成績を見て戻っても編集中の打順を維持する',
    );
    await m.setViewportSize({ width, height: 640 });
    await m.getByRole('button', { name: 'ホーム', exact: true }).click();
    await m.getByRole('button', { name: '試合', exact: true }).click();
    await m
      .getByRole('button', { name: '過去の試合・個人成績', exact: true })
      .click();
    const historyPanel = m.getByRole('dialog', {
      name: '試合記録',
      exact: true,
    });
    await historyPanel.getByLabel('試合記録の年度').selectOption('1');
    await historyPanel
      .locator('.online-game-history-list article')
      .first()
      .waitFor();
    await historyPanel.getByLabel('試合記録の範囲').selectOption('league');
    await historyPanel
      .getByRole('button', { name: 'A対Bの試合成績', exact: true })
      .first()
      .click();
    const box = m.getByRole('dialog', { name: '試合成績', exact: true });
    await box
      .getByRole('button', { name: '安打で並べ替え', exact: true })
      .click();
    assert.equal(
      await box.locator('tbody tr').first().locator('th').innerText(),
      '成績選手12',
      '試合の全出場選手をソートしてからページ分割',
    );
    assert.ok(
      await box.evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
      '打撃成績も6人ずつで縦スクロールなし',
    );
    await box.getByLabel('試合成績の表示項目').selectOption('pitching:basic');
    await box.getByText('6.0', { exact: true }).waitFor();
    await m.setViewportSize({ width, height: 640 });
    assert.ok(
      await box.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      '試合成績が横にはみ出さない',
    );
    assert.ok(
      await box.evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
      '試合成績で長いスクロールを要求しない',
    );
    await m.screenshot({
      path: `/tmp/baseball-online-game-record-${width}.png`,
      fullPage: true,
    });
    await box
      .getByRole('button', { name: '試合成績を閉じる', exact: true })
      .click();
    await historyPanel
      .getByRole('button', { name: '試合記録を閉じる', exact: true })
      .click();
    await c.close();
  }
  const switched = await scene(1440, 1000);
  await switched.page
    .getByRole('button', { name: '選手成績', exact: true })
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
    .getByRole('button', { name: '選手成績', exact: true })
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
    'online-label-ui-check PASS（配布HTMLと実projection・PC/スマホ320〜767px・1080x1920縦持ち・投打切替・詳細/閉じる/フォーカス・高さに応じた行数・ページ送り・閲覧のみ / 通信はfixture）',
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
