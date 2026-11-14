// ============================================================
// 多人数ペナントの階層リーグ（いまは2部制・12球団）
//
// 設計は docs/online/PYRAMID_LEAGUE.md。
//
//      A  1部（6球団）
//      B  2部（6球団）
//
// ⚠ **昇降格の出入りが各階層で釣り合うこと**が、この構造の肝。
//    いまは1部の最下位と2部の1位が入れ替わる（1つずつ）。
//    以前は7リーグ42球団（A / B1 B2 / C1〜C4）で設計していたが、保存の容量で見送った。
//    リーグを足すときは `pyramidBalance()` で釣り合いを確かめること。
//
// ⚠ **生成はシードから決まること**。サーバーと再現で同じ世界にならないと、
//    順位も成績も食い違う（試合の `scheduledGameSeed` と同じ理由）。
//    `Math.random()` をここで呼ばない。
// ============================================================
import { createSeededRandom } from '../game/rng.js';
import { advanceDate, SEASON_PHASES } from '../season/seasonManager.js';

export const TEAMS_PER_LEAGUE = 6;

/**
 * 階層の定義。
 *
 * - `up`   … 上位から順に、1位・2位…の行き先
 * - `down` … 下位から順に、5位・6位…の行き先
 *
 * ⚠ **どちらも配列で書くこと**。片方を単数にすると「1部は2つ落ちるのに
 *    2部からは1つしか上がらない」という不均衡に気づけない。
 *    7リーグ構成では B1 が C1 と C2 から1つずつ受け取る形になる。
 * ⚠ 構造を変えたら `pyramidBalance()` で出入りの釣り合いを確かめること。
 *    検査（`online-pyramid-check`）が自動で見ている。
 *
 * いまは**2部制12球団**。1部6・2部6で、1部の最下位が落ち、2部の1位が上がる。
 * 7リーグ42球団の構成は保存の容量が無料枠に収まらず見送った
 * （`docs/online/PYRAMID_LEAGUE.md` に実測を残してある）。
 */
export const PYRAMID_LEAGUES = [
  { id: 'A', name: '1部', tier: 0, up: [],    down: ['B'] },
  { id: 'B', name: '2部', tier: 1, up: ['A'], down: [] },
];

export const PYRAMID_TEAM_COUNT = PYRAMID_LEAGUES.length * TEAMS_PER_LEAGUE; // 12

/**
 * 昇格する順位（1始まり・上から数える）。`up` の並びと対応する。
 * 最上位リーグは `up` が空なので昇格しない。
 */
export const PROMOTION_PLACES = [1];
/**
 * 降格する順位（**下から数える**。1 なら最下位）。`down` の並びと対応する。
 * ⚠ **「6位」と上から書かないこと**。1リーグの球団数を変えたときに、
 *    最下位ではない球団が落ちる（6球団から8球団にしたら6位は真ん中になる）。
 */
export const RELEGATION_FROM_BOTTOM = [1];

/**
 * 各リーグの出入りが釣り合っているかを数える。
 * 返り値の `balanced` が false なら、どこかのリーグで球団数が増減する。
 */
export function pyramidBalance() {
  const out = {};
  const incoming = {};
  for (const l of PYRAMID_LEAGUES) {
    out[l.id] = 0;
    incoming[l.id] = 0;
  }
  for (const l of PYRAMID_LEAGUES) {
    for (const upper of l.up) {
      out[l.id] += 1;
      incoming[upper] += 1;
    }
    for (const lower of l.down) {
      out[l.id] += 1;
      incoming[lower] += 1;
    }
  }
  const rows = PYRAMID_LEAGUES.map((l) => ({
    id: l.id, out: out[l.id], in: incoming[l.id], net: incoming[l.id] - out[l.id],
  }));
  return { rows, balanced: rows.every((r) => r.net === 0) };
}

// ⚠ **都市と愛称は実在の球団名と重ならないものを使う**。
//    既存の `INDEPENDENT_LEAGUES` は実在球団（徳島インディゴソックス等）なので、
//    生成した球団がそれと同名になると、どちらの話をしているか分からなくなる。
// ⚠ **都市だけでなく地域名も混ぜる**（いしだ要望: 土地の名前の幅を増やす）。
//    「湘南」「瀬戸内」「信州」のような呼び方が入ると、12球団の顔ぶれが
//    市名の並びに見えなくなる。
// ⚠ 同じ土地を指す呼び方を両方入れない（「甲府」と「甲斐」が同じリーグに
//    並ぶと、別の球団だと読み取れない）。重複は文字列としてだけでなく、
//    指している土地でも避ける（市と地域の重なりは下の `SAME_PLACE`）。
const CITIES = [
  // 市の名前
  '札幌', '千歳', '苫小牧', '旭川', '函館', '青森', '八戸', '盛岡', '仙台', '秋田',
  '山形', '福島', '郡山', '水戸', '日立', '宇都宮', '前橋', '高崎', '川越', '大宮',
  '柏', '船橋', '浦安', '八王子', '立川', '横浜', '川崎', '相模原', '藤沢', '新潟',
  '長岡', '富山', '金沢', '福井', '甲府', '長野', '松本', '岐阜', '静岡', '沼津',
  '浜松', '豊田', '岡崎', '豊橋', '四日市', '鈴鹿', '大津', '堺', '東大阪', '西宮',
  '明石', '姫路', '奈良', '和歌山', '鳥取', '米子', '松江', '岡山', '倉敷', '福山',
  '呉', '下関', '宇部', '高松', '松山', '高知', '北九州', '久留米', '佐賀', '長崎',
  '佐世保', '熊本', '大分', '宮崎', '延岡', '鹿児島', '那覇', '名護', '石垣',
  // 地域の名前
  '道南', '道東', '十勝', '津軽', '三陸', '庄内', '会津', '常総', '上州', '武蔵',
  '多摩', '湘南', '房総', '信州', '越前', '能登', '飛騨', '遠州', '尾張', '三河',
  '伊勢', '近江', '北摂', '河内', '丹波', '但馬', '紀州', '石見', '瀬戸内', '安芸',
  '周防', '阿波', '讃岐', '伊予', '土佐', '筑豊', '島原', '天草', '阿蘇', '霧島',
];

// ⚠ **同じ土地を指す呼び方の組**。一覧には両方残し（顔ぶれの幅のため）、
//    生成するときに同じ組から2つ目を取らない。「高知」と「土佐」、「松本」と
//    「信州」が同じ12球団に並んでいた（監査 2026-11-13、約2割の seed で起きた）。
//    市が地域に含まれるときも同じ組に入れる。
const SAME_PLACE = [
  ['函館', '道南'], ['前橋', '高崎', '上州'], ['八王子', '立川', '多摩'],
  ['藤沢', '湘南'], ['福井', '越前'], ['長野', '松本', '信州'],
  ['浜松', '遠州'], ['豊田', '岡崎', '豊橋', '三河'], ['四日市', '鈴鹿', '伊勢'],
  ['大津', '近江'], ['東大阪', '河内'], ['和歌山', '紀州'], ['呉', '安芸'],
  ['高松', '讃岐'], ['松山', '伊予'], ['高知', '土佐'], ['下関', '宇部', '周防'],
  ['川越', '大宮', '武蔵'], ['松江', '石見'], ['熊本', '阿蘇', '天草'],
  ['鹿児島', '霧島'], ['長崎', '島原'], ['青森', '八戸', '津軽'], ['山形', '庄内'],
  ['福島', '郡山', '会津'], ['水戸', '日立', '常総'], ['名護', '那覇'],
  // 十勝は道東の一部（監査 2026-11-14。2000通りの種のうち24通りで並んでいた）
  ['道東', '十勝'],
];
const PLACE_OF = new Map(
  SAME_PLACE.flatMap((group) => group.map((name) => [name, group[0]])),
);
/** 土地の組の代表（組に入っていなければ自分） */
export const placeOf = (city) => PLACE_OF.get(city) || city;

// ⚠ **実在球団の愛称は入れない**（NPB・独立リーグ・Bリーグとも）。
//    「北九州ホークス」のような球団が出ると、どちらの話か分からなくなる。
//    （「サラマンダーズ」は独立リーグの火の国サラマンダーズ＝熊本と重なるので外した）
const NICKNAMES = [
  'ブレイブス', 'ファルコンズ', 'ドルフィンズ', 'サンダーズ', 'ウィングス', 'レンジャーズ',
  'クルセイダーズ', 'フェニックス', 'バイパーズ', 'サンライズ', 'ストライカーズ', 'ナイツ',
  'ハリケーンズ', 'シャークス', 'ウルブズ', 'コメッツ', 'ブリーズ', 'ジェッツ',
  'キングス', 'パンサーズ', 'ラビッツ', 'シーホース', 'ガーディアンズ', 'アローズ',
  'ブルズ', 'スターズ', 'オーシャンズ', 'ボルケーノズ', 'クレインズ', 'ホエールズ',
  'ロケッツ', 'タイフーンズ', 'サムライズ', 'ミラージュ', 'リバティーズ', 'アトラス',
  'ヴァンガード', 'セイバーズ', 'ダイヤモンズ', 'ノヴァ', 'オライオンズ', 'ゼニス',
  'タイタンズ', 'ペガサス', 'グリフィンズ', 'ユニコーンズ', 'レイヴンズ', 'ホーネッツ',
  'バジャーズ', 'オッターズ', 'ペンギンズ', 'シーガルズ', 'アルバトロス', 'コンドルズ',
  'オスプレイズ', 'ゲイルズ', 'ドラグーンズ', 'ランサーズ', 'パイオニアズ',
  'フロンティアズ', 'ヴォヤージャーズ', 'サミッツ', 'キャニオンズ', 'グレイシャーズ',
  'オーロラズ', 'エクリプス', 'メテオズ', 'パルサーズ', 'クエーサーズ', 'ソレイユ',
  'センチネルズ', 'パラディンズ', 'ヴァルキリーズ', 'グラディエーターズ',
  'マスケティアーズ', 'ブリザーズ', 'クエイクス', 'トルネーダーズ',
];

/** 土地の名前と愛称の組み合わせの数（検査と画面の説明で使う） */
export const TEAM_NAME_VARIATIONS = CITIES.length * NICKNAMES.length;

// 階層ごとの強さ。⚠ 上の階層ほど強いこと（昇降格に意味を持たせるため）
//    ⚠ 階層を増やすときはここも足すこと。足りないと `undefined` を引く
const TIER_RANKS = [
  ['S', 'S', 'A', 'A'],  // 1部
  ['B', 'B', 'C', 'D'],  // 2部
];

/** 配列をシード乱数で並べ替える（元の配列は変えない） */
const shuffled = (list, rand) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * 全球団（いまは12）を生成する。`{ id, name, abbreviation, city, rank, league }`。
 * ⚠ 同じ `seed` なら必ず同じ球団になる。
 */
export function generatePyramidTeams(seed = 20261029) {
  const rand = createSeededRandom(seed);
  // 同じ土地の組からは最初に出た1つだけ使う（`SAME_PLACE`）
  const usedPlaces = new Set();
  const cities = shuffled(CITIES, rand).filter((city) => {
    const place = placeOf(city);
    if (usedPlaces.has(place)) return false;
    usedPlaces.add(place);
    return true;
  });
  const nicknames = shuffled(NICKNAMES, rand);
  const teams = [];
  let index = 0;
  for (const league of PYRAMID_LEAGUES) {
    const ranks = TIER_RANKS[league.tier];
    for (let n = 0; n < TEAMS_PER_LEAGUE; n++) {
      const city = cities[index % cities.length];
      const nickname = nicknames[index % nicknames.length];
      teams.push({
        id: `py_${league.id}_${n + 1}`,
        name: `${city}${nickname}`,
        abbreviation: city,
        city,
        rank: ranks[Math.floor(rand() * ranks.length)],
        league: league.id,
      });
      index++;
    }
  }
  return teams;
}

/**
 * シーズン終了時の入れ替えを決める。
 * `standings` は `{ [リーグID]: [1位のチームID, 2位, …] }`。
 * 返り値は `{ teamId, from, to }` の配列で、**移動するものだけ**を含む。
 *
 * ⚠ **降格は降格先リーグへ1つずつ割り当てる**。5位を1つ目の降格先へ、6位を2つ目へ。
 *    まとめて同じリーグへ落とすと、そのリーグだけ球団が増える。
 */
export function pyramidMovements(standings) {
  const moves = [];
  for (const league of PYRAMID_LEAGUES) {
    const order = standings[league.id] || [];
    league.up.forEach((target, i) => {
      const teamId = order[PROMOTION_PLACES[i] - 1];
      if (teamId) moves.push({ teamId, from: league.id, to: target });
    });
    league.down.forEach((target, i) => {
      // 下から数える。order.length が球団数なので、1 なら最後尾
      const teamId = order[order.length - RELEGATION_FROM_BOTTOM[i]];
      if (teamId) moves.push({ teamId, from: league.id, to: target });
    });
  }
  return moves;
}

// ============================================================
// 日程
//
// ⚠ **既存の `generateFullSeasonSchedule` は使えない**。あちらは
//    `leagueFormat` が `'single'` か `'two'` の2通りしか対応しておらず、
//    階層リーグ（部ごとの総当たり）は作れない（実装を読んで確認した）。
//    階層リーグの日程は単純（各リーグ6球団の総当たりの繰り返し）なので、
//    ここで独自に組む。
// ============================================================

/**
 * 6球団の総当たり表を作る（サークル法）。
 * 1巡は5節で、**どの節も全球団が1試合する**。
 * これが「1ターンで全球団が1試合」という設計にそのまま対応する。
 */
function roundRobin(ids) {
  const n = ids.length;
  requireEven(n);
  const arr = [...ids];
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) pairs.push([arr[i], arr[n - 1 - i]]);
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop()); // 先頭を固定して残りを回す
  }
  return rounds;
}

function requireEven(n) {
  if (n % 2 !== 0 || n < 2) {
    throw new Error(`総当たりは偶数の球団数が必要です: ${n}`);
  }
}

/**
 * 1シーズンのターン数。**月〜金の32ターン×5日＝160**（1ターン45分）。
 * 土曜はストーブリーグ、日曜はキャンプ・編成に充てる（各32ターン）。
 *
 * ⚠ **160は3連戦と6球団の総当たりの両方に割り切れる数**。
 *    4ターンで1カード（3試合＋休養1）なので 160/4 = 40カード。
 *    1巡は5節なので 40/5 = 8巡ちょうど、どの相手とも 8カード＝24試合、
 *    本拠地はカードごとに入れ替わって 12/12、全体で60ホーム・60ビジター。
 *    144だと36カードで7.2巡になり、最後の1巡が途中で切れる（実測で
 *    「相手によって28試合と29試合」「ホームが71〜74」とばらついた）。
 * ⚠ 変えるときは `SEASON_TURNS / REST_EVERY / (TEAMS_PER_LEAGUE - 1)` が
 *    整数になることを確かめる（`online-pyramid-check` が見ている）。
 */
export const SEASON_TURNS = 160;

/**
 * 同じ相手と続ける試合数（1カード）。
 *
 * ⚠ **`REST_EVERY` と揃えること**（カード＋休養1＝`REST_EVERY`）。
 *    ずれると、カードの途中に休養日が入って本拠地の割り当てが崩れる。
 */
export const CARD_GAMES = 3;

/**
 * 何ターンに1回を休養日にするか。
 *
 * ⚠ **休養日が無いと、レギュラーは一度も疲労が回復しない。**
 *    `recoverAllPitcherFatigue` は「その日出場した選手は回復させない」
 *    （`_playedToday`）ので、毎ターン試合があると出ずっぱりの選手の疲労が
 *    積み上がり続ける。実測で、20試合の時点で一人用が平均24（最大97）なのに対し
 *    オンラインは平均104（最大281）。疲れた打者は打てないので、
 *    **本塁打が一人用の1/5**（1試合あたり 0.68 → 0.13）になっていた。
 * ⚠ **6ターンに1回（5試合→1休）では足りない**。野手は1試合で約+11
 *    （`15 - 体力/100*8`）、休養日に約-28（`体力×(0.25+回復/100*0.60)`）なので、
 *    5試合→1休は1巡ごとに**+27の積み残し**になる。1シーズン通した実測で
 *    レギュラーの疲労が終盤190（最大829）、打率 .237→.189、
 *    本塁打率 0.58→0.28。3試合→1休なら積み残しは+5.5まで下がり、
 *    `FIELDER_REST_FATIGUE` の入れ替えと合わせて疲労が平ら（平均15・最大80）に
 *    なり、打率 .241→.237、本塁打率 0.58→0.58 で最後まで揃う。
 */
export const REST_EVERY = CARD_GAMES + 1;

/** 休養日を除いた、1球団あたりの試合数 */
export const gamesPerTeam = (turns = SEASON_TURNS) =>
  turns - Math.floor(turns / REST_EVERY);

/** そのターンが休養日か。⚠ 巡の区切りとずらさないこと（下の注記） */
export const isRestTurn = (turn) => turn % REST_EVERY === REST_EVERY - 1;

/**
 * 階層リーグ全体の日程を組む。
 * 返り値は `{ turn, league, home, away }` の配列（`turn` は0始まり）。
 *
 * ⚠ **同じ相手と `CARD_GAMES` 試合続ける**（3連戦）。本拠地もカードの中では
 *    変えない（実際の興行と同じで、移動が1カードに1回で済む）。
 * ⚠ **1巡ごとに本拠地を入れ替えること**。入れ替えないと、同じ相手に対して
 *    片方がずっとホームになり、シーズンぶん積み上がって有利不利が出る。
 */
export function pyramidSchedule(teams, { turns = SEASON_TURNS } = {}) {
  const games = [];
  for (const league of PYRAMID_LEAGUES) {
    const ids = teams.filter((t) => t.league === league.id).map((t) => t.name);
    if (ids.length < 2) continue;
    const rounds = roundRobin(ids);
    // ⚠ **巡は試合のあるターンだけで数えること**。`turn` で数えると休養日のぶん
    //    巡が飛び、同じ相手との対戦数と本拠地の割り当てが崩れる
    let played = 0;
    for (let turn = 0; turn < turns; turn++) {
      if (isRestTurn(turn)) continue;
      // ⚠ 節と本拠地は**カード単位**で決める（試合ごとに進めると3連戦にならない）
      const card = Math.floor(played / CARD_GAMES);
      const round = rounds[card % rounds.length];
      const flip = Math.floor(card / rounds.length) % 2 === 1;
      played += 1;
      for (const [a, b] of round) {
        games.push({
          turn,
          league: league.id,
          home: flip ? b : a,
          away: flip ? a : b,
        });
      }
    }
  }
  return games;
}

/**
 * エンジンが食べられる形の年間日程に変換する。
 * 1ターン＝1日。144ターンぶんの日付を 4/1 から連続で割り当てる。
 *
 * ⚠ **1ターンに1つの日付**。エンジンは `getScheduleByDate` で日付ごとに試合を拾い、
 *    `simulateScheduledGamesOnDate` がその日ぶんを消化する。ターンと日付が
 *    1対1でないと「1ターンで全球団が1試合」が崩れる。
 * ⚠ 4/1 から144日は 8月下旬まで。既存の 4/1〜9/30 の枠に収まる。
 */
export function pyramidSeasonSchedule(teams, { year, turns = SEASON_TURNS } = {}) {
  const dates = [];
  let date = { year, month: 4, day: 1 };
  for (let t = 0; t < turns; t++) {
    dates.push({ ...date });
    date = advanceDate(date, 1);
  }
  return pyramidSchedule(teams, { turns }).map((g, i) => ({
    id: i + 1,
    date: dates[g.turn],
    home: g.home,
    away: g.away,
    starterHome: null,
    starterAway: null,
    result: null,
    phase: SEASON_PHASES.REGULAR_SEASON,
    league: g.league,
  }));
}

/**
 * 順位表をリーグごとの並び（1位から最下位）に分ける。
 *
 * ⚠ **順位表は全球団を通した並び**（勝率順）なので、そのままでは
 *    「2部の1位」が分からない。リーグで絞り直してから順位を見ること。
 * ⚠ 最後に球団名まで見て並びを決める。勝率も勝利数も並んだとき、
 *    順序が実行のたびに変わると昇降格の相手が変わってしまう。
 */
/**
 * 部の中の並べ方（昇降格を決める順）。勝率→勝利数→球団名。
 * ⚠ 順位表の画面もこれで並べること。全体の並び（勝率→勝利数）のまま出すと、
 *    同率のとき画面の「昇格圏・降格圏」の印と実際に動く球団が食い違う
 */
export function compareLeagueStanding(sa = {}, sb = {}) {
  const a = sa.team ?? '';
  const b = sb.team ?? '';
  return (
    (sb.winRate || 0) - (sa.winRate || 0) ||
    (sb.wins || 0) - (sa.wins || 0) ||
    (a < b ? -1 : a > b ? 1 : 0)
  );
}

export function standingsByLeague(teams, standings = []) {
  const leagueOf = Object.fromEntries(teams.map((t) => [t.name, t.league]));
  const byName = Object.fromEntries(standings.map((s) => [s.team, s]));
  const result = {};
  for (const league of PYRAMID_LEAGUES) {
    result[league.id] = teams
      .filter((t) => leagueOf[t.name] === league.id)
      .map((t) => t.name)
      .sort((a, b) =>
        compareLeagueStanding({ ...byName[a], team: a }, { ...byName[b], team: b }),
      );
  }
  return result;
}

/** 最上位リーグ（1部）の球団名。プレーオフに出られるのはここだけ */
export function topTierTeamNames(teams = []) {
  const top = PYRAMID_LEAGUES.find((league) => league.tier === 0)?.id;
  return teams.filter((t) => t.league === top).map((t) => t.name);
}

/**
 * 昇降格を `teams` へ反映する。移動した一覧を返す。
 * ⚠ **日程を作り直す前に呼ぶこと**。所属が変わってから日程を組まないと、
 *    昇格した球団が元のリーグの相手と戦い続ける。
 */
export function applyPyramidMovements(teams, standings) {
  const moves = pyramidMovements(standingsByLeague(teams, standings));
  for (const move of moves) {
    const team = teams.find((t) => t.name === move.teamId);
    if (team) team.league = move.to;
  }
  return moves;
}
