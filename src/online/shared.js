// ⚠ `pyramidLeague` は `shared` を読まないので、ここから読んでも循環しない
import { SEASON_TURNS } from './pyramidLeague.js';
// ⚠ **保存された世界の形を変えたら上げること**。上げないと、古い形のリーグが
//    `assertLeagueVersion` を素通りして読み込まれ、どこか遠くで落ちる。
//    上げれば「ゲームのバージョンが対応していません」で止まるので原因が分かる。
//    12 = 指導者にビジョン（攻めの型・守りの型・時間軸）・育成観・語り口を足した、
//    11 = キャンプのサブ練習に対象（球種・守備位置）を足した、
//    10 = 指導者（監督・投手コーチ・野手コーチ）と人の球団の任せ方、
//    9 = 年代記（節目・引退・裏の大会）と年度の記録の部分け・昇降格、
//    8 = 初期メンバーのセットを型ごとに変えた（途中参加の人は版を持つ）・キャンプの伸び、
//    7 = 45分1ターン・1週224ターン（120試合・3連戦）、
//    6 = 球団間のトレード、5 = 初期メンバー選択（4 = 検証モード、
//    3 = 招待コード廃止、2 = 2部制12球団・招待制・毎正時24ターン、
//    1 = 固定4球団・2人・1日7枠）。
// ⚠ 上げてもリーグは**作り直せない**（`create` は既存リーグがあると拒む）。
//    `docs/online/PRODUCTION_SETUP.md` の作り直し手順で制御行を空にすること。
export const ONLINE_SCHEMA = 12;
export const ONLINE_ENGINE_VERSION = 'online-1';

// ---- ターンの長さ
/**
 * 1ターンの実時間（分）。
 *
 * ⚠ **1日を割り切る数にすること**。`nextProgressionAt` は「その日の枠を順に見て、
 *    今より後の最初の枠へ」で次の時刻を決めるので、割り切れないと日付が変わる
 *    ところで枠の間隔が狂う。45分なら 1440/45 = 32枠でちょうど収まる。
 * ⚠ **1週間の枠数が、シーズンの作りと噛み合っていること**（下の表）。
 *      45分 × 32枠 = 24時間 → 1日32ターン・1週224ターン
 *      月〜金 160ターン = 120試合 + 休養40（`SEASON_TURNS` / `REST_EVERY`）
 *      土 32ターン = 契約更改とトライアウト、日 32ターン = キャンプ
 *    合計 224。**シーズン1つ＝実時間1週間**は毎正時の頃から変えていない。
 * ⚠ 以前は1時間（1日24枠・1週168ターン）で、月〜金の120ターンに
 *    100試合（5試合に1休）を詰めていた。休養が足りず、実測でレギュラーの
 *    疲労が終盤190（最大829）まで積み上がり、打率 .237→.189、
 *    本塁打率 0.58→0.28 とシーズン後半が別のゲームになっていた。
 */
export const TURN_MINUTES = 45;
export const TURNS_PER_DAY = (24 * 60) / TURN_MINUTES;

// 進行する時刻。⚠ **手で並べないこと**（45分刻みは :00 :45 :30 :15 と巡るので
//    書き写すと必ず間違える）。`TURN_MINUTES` から作る。
// ⚠ **夜間も止めない**。以前は1日7回・夜間休止だったが、多人数ペナントの
//    設計で全時間帯に変えた。
export const PROGRESSION_TIMES = Array.from({ length: TURNS_PER_DAY }, (_, i) => {
  const minutes = i * TURN_MINUTES;
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
});

export class OnlineError extends Error {
  constructor(message, status = 400, code = 'invalid') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function requireOnline(
  condition,
  message,
  status = 400,
  code = 'invalid',
) {
  if (!condition) throw new OnlineError(message, status, code);
}

export function assertLeagueVersion(league) {
  requireOnline(
    league?.schema === ONLINE_SCHEMA &&
      league.engineVersion === ONLINE_ENGINE_VERSION,
    'ゲームのバージョンが対応していません。更新を確認してください',
    409,
    'version',
  );
}

// サーバー時刻を基準にする。日本時間に夏時間はない。
export function nextProgressionAt(now) {
  const ms = new Date(now).getTime();
  requireOnline(Number.isFinite(ms), '時刻が不正です');
  const jst = new Date(ms + 9 * 3600000);
  const midnight =
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) -
    9 * 3600000;
  for (const time of PROGRESSION_TIMES) {
    const [h, m] = time.split(':').map(Number);
    const candidate = midnight + (h * 60 + m) * 60000;
    if (candidate > ms) return new Date(candidate).toISOString();
  }
  // 今日のぶんを使い切ったら、翌日の最初の枠へ。
  // ⚠ **先頭の枠から求めること**。以前は 8時 を直に書いており、
  //    `PROGRESSION_TIMES` を変えても追従しなかった。
  const [fh, fm] = PROGRESSION_TIMES[0].split(':').map(Number);
  return new Date(midnight + 86400000 + (fh * 60 + fm) * 60000).toISOString();
}

/**
 * ゲーム内の日付を**ターン**に直す。開幕（4/1）が第1ターン。
 *
 * ⚠ オンラインは**ターンで進む**（1ターン＝実時間45分＝ゲーム内1日）。
 *    ゲーム内の日付は進行の副産物でしかなく、画面に出すと
 *    「4/18って何試合目？」と数え直すことになる。画面はターンで出す。
 * ⚠ 休養日もターンに数える（160ターン中120試合）。「何試合目か」は
 *    球団ごとに違うので、試合の予定では別に数える（`ownUpcomingGames`）。
 * ⚠ 開幕前・シーズン後は範囲の外。`null` を返して、呼ぶ側で文面を変える。
 */
export const SEASON_START_MONTH = 4;
export function turnOfDate(date, turns = SEASON_TURNS) {
  if (!date?.year) return null;
  const start = Date.UTC(date.year, SEASON_START_MONTH - 1, 1);
  const at = Date.UTC(date.year, (date.month || 1) - 1, date.day || 1);
  const turn = Math.floor((at - start) / 86400000) + 1;
  return turn >= 1 && turn <= turns ? turn : null;
}

/**
 * 一覧に出すターンの表記（「第23ターン」）。範囲の外なら「開幕前」「シーズン終了」。
 * ⚠ 一覧では総数（/160）を繰り返さない。6試合ぶん並ぶと同じ数字が6回出る。
 */
export function turnLabel(date, turns = SEASON_TURNS) {
  const turn = turnOfDate(date, turns);
  if (turn) return `第${turn}ターン`;
  if (!date?.year) return '';
  return date.month < SEASON_START_MONTH ? '開幕前' : 'シーズン終了';
}

/** 見出しに出すターンの表記（「第23ターン / 160」）。総数はここだけ出す */
export function formatTurn(date, turns = SEASON_TURNS) {
  const turn = turnOfDate(date, turns);
  return turn ? `${turnLabel(date, turns)} / ${turns}` : turnLabel(date, turns);
}

/**
 * 登録できる守備位置（コンバートの選択肢）。
 * ⚠ DHは守備位置ではない（打順の枠）ので入れない。
 * ⚠ サーバーと画面の**両方がここを読む**。別々に並べると、画面に出ているのに
 *    サーバーが弾く位置ができる。
 */
export const CONVERT_POSITIONS = [
  'pitcher',
  'catcher',
  'first',
  'second',
  'third',
  'short',
  'left',
  'center',
  'right',
];

export const PHASE_LABELS = {
  pack_select: '初期メンバー選択',
  // ⚠ 初期編成はセット選択に置き換えた。移行の途中でしか現れないが、
  //    古い保存を読んだ瞬間に空欄にしないため名前だけ残す
  initial_tryout: '初期編成',
  camp: 'キャンプ',
  contract: '契約更改',
  tryout: 'トライアウト',
  offseason: '年度更新',
};

// ============================================================
// 1年の流れ（いまどの段階か）
//
// ⚠ いしだ指摘: シーズンが終わってから次が始まるまでの流れ・いまの段階・
//    何をすればいいかが分からない。左上は「シーズン終了」のままで、
//    手続きの合間は「決定待ちの手続きはありません」としか出ていなかった。
//    1年を7段階に並べ、**サーバーが段階を決めて**ビューに載せる（`stage`）。
//    画面（PC・スマホ・アプリ）はこの表で帯を描く。
// ⚠ アプリ（`mobile/.../Tables.kt` の `SEASON_STEPS`）と同じ文にすること。
// ⚠ 時刻の文は `PHASE_WINDOW_HOURS` と揃える（土曜の0〜12時・12〜21時）。
// ============================================================
export const SEASON_STEPS = [
  {
    key: 'season',
    label: 'シーズン',
    when: '月〜金',
    todo: '試合は自動で進みます。スタメン設定・投手起用を整えておきます。',
  },
  {
    key: 'postseason',
    label: 'プレーオフ',
    when: '土曜の未明',
    todo: '1部の上位でプレーオフを行い、今季の成績とタイトルを確定します（自動）。終わると契約更改が開きます。',
  },
  {
    key: 'contract',
    label: '契約更改',
    when: '土 0:00〜12:00',
    todo: '来季に残さない選手を選んで「この内容で決定」を押します。決めなければ標準案で進みます。',
  },
  {
    key: 'tryout',
    label: 'トライアウト',
    when: '土 12:00〜21:00',
    todo: '空いた枠に獲りたい選手の希望リストを作って決定します。決めなければ標準案で進みます。',
  },
  {
    key: 'year_end',
    label: '年度更新',
    when: '自動',
    todo: '加齢による伸び・衰え、引退、昇格・降格、新しい日程が入ります（決めることはありません）。結果は「オフの成長」で見られます。',
  },
  {
    key: 'camp',
    label: 'キャンプ',
    when: '日曜',
    todo: '育成方針と練習を決めて、4クールを1クールずつ実行します。終わらなかったぶんは締め切りで自動で行われます。',
  },
  {
    key: 'opening',
    label: '開幕',
    when: '月 0:00',
    todo: 'キャンプで伸びた能力を見て、スタメン設定・投手起用を整えて開幕を待ちます。',
  },
];

/**
 * いまの段階。`{ key, open }`。`open` が false なら**その段階の手前で待っている**
 * （例: 契約更改が済み、次の進行でトライアウトが開く）。
 *
 * ⚠ 手続きの合間を「何もない」にしないこと。契約更改→トライアウト、
 *    トライアウト→キャンプの間は次の進行（最大45分）まで手続きが無く、
 *    画面が止まって見えていた。
 * ⚠ 日付の境は `leagueEngine` の `openPhase` の呼び出し（11/9 契約更改・
 *    11/10 トライアウト・11/30 年度更新）と揃える。
 * @param {{ phaseKind?: string, regularLeft: boolean, regularPlayed: boolean, date: {month:number, day:number} }} s
 */
export function seasonStage({ phaseKind, regularLeft, regularPlayed, date }) {
  if (phaseKind === 'pack_select' || phaseKind === 'initial_tryout')
    return { key: 'pack_select', open: true };
  if (phaseKind === 'offseason') return { key: 'year_end', open: true };
  if (phaseKind) return { key: phaseKind, open: true };
  if (regularLeft)
    return regularPlayed
      ? { key: 'season', open: true }
      : { key: 'opening', open: false };
  const md = (date?.month || 0) * 100 + (date?.day || 0);
  if (md < 1109) return { key: 'postseason', open: true };
  if (md < 1110) return { key: 'tryout', open: false };
  return { key: 'year_end', open: false };
}

// ---- 日々の編成の決まり（サーバーの `server/dailyLineup.mjs` と、PC版の編成ページの両方が使う）
// ⚠ 画面はこの値で色を変え・説明を書く。サーバーと別に持つとずれるので、ここだけに置く。
/** 野手はこの疲労以上だと、その日だけ控えと入れ替えて休ませる */
export const FIELDER_REST_FATIGUE = 80;
/** 休ませる野手の代役に選べる守備適性の下限 */
export const SUBSTITUTE_MIN_FITNESS = 60;
/** 休ませる野手の代役に選べる控えの疲労（これ未満の控えだけが代役になる） */
export const SUBSTITUTE_FRESH_FATIGUE = 40;
/**
 * これを超えたら、**守備適性を問わず**その日は下げる。
 *
 * ⚠ 「守れる控えが居なければ休ませない」だけだと、その守備位置に代役の居ない
 *    レギュラーが**一度も休めないまま**シーズンを終える。実測で二塁手が疲労193
 *    （控えの二塁適性が最高53で、下限60に届かなかった）。疲労193の打者は
 *    1年打てないので、**1日の守備の穴より明らかに悪い**。
 * ⚠ 下限（`SUBSTITUTE_MIN_FITNESS`）は残す。ここは最後の逃げ道で、
 *    普段は適性のある控えが入る
 */
export const FIELDER_FORCE_REST_FATIGUE = 120;
/** 先発はこの疲労以上だと、その日の登板を飛ばして次の先発が投げる */
export const STARTER_SKIP_FATIGUE = 40;

export function validateLineup(team, plan) {
  requireOnline(plan && typeof plan === 'object', '編成が不正です');
  requireOnline(
    Array.isArray(plan.battingOrder) && plan.battingOrder.length === 8,
    '野手8人の打順を指定してください',
  );
  requireOnline(
    plan.battingOrder.every((e) => e && typeof e === 'object'),
    '打順の指定が不正です',
  );
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
  requireOnline(
    new Set(plan.battingOrder.map((e) => e.playerId)).size === 8,
    '同じ選手を重複して指定できません',
  );
  requireOnline(
    new Set(plan.battingOrder.map((e) => e.battingOrder)).size === 8 &&
      plan.battingOrder.every(
        (e) =>
          Number.isInteger(e.battingOrder) &&
          e.battingOrder >= 1 &&
          e.battingOrder <= 8,
      ),
    '打順は1〜8番を一度ずつ指定してください',
  );
  requireOnline(
    positions.every((pos) => plan.battingOrder.some((e) => e.position === pos)),
    '野手の守備位置を一度ずつ指定してください',
  );
  // ⚠ **投手もスタメンの野手に入れてよい**（二刀流。いしだ指摘: 投手でも野手で
  //    出られるように）。守備の上手い下手は適性が試合で効くだけ
  requireOnline(
    plan.battingOrder.every((e) =>
      team.players.some((p) => p.id === e.playerId && p.isActive !== false),
    ),
    '登録できない選手が含まれています',
  );
  requireOnline(
    Array.isArray(plan.starters) &&
      plan.starters.length > 0 &&
      plan.starters.length <= 8 &&
      new Set(plan.starters).size === plan.starters.length,
    '先発投手を1〜8人指定してください',
  );
  // ⚠ **野手も先発ローテに入れてよい**（二刀流）。投球の能力（`pitching`）は
  //    全員が持っている。先発と野手の兼任もよい: 先発の日だけ9番・投手に回り、
  //    空いた打順には控えが入る（`server/dailyLineup.mjs`）
  requireOnline(
    plan.starters.every((id) =>
      team.players.some(
        (p) => p.id === id && p.pitching && p.isActive !== false,
      ),
    ),
    '先発投手の指定が不正です',
  );
}

// JSONで往復する編集内容を比較する。オブジェクトのキー順は変更と扱わない。
export function sameEditState(a, b) {
  const canonical = (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value;
  return JSON.stringify(a, canonical) === JSON.stringify(b, canonical);
}

// ============================================================
// フェーズの締め切り
//
// ⚠ **1人が決めないと全員が止まる**のを避けるための仕組み。
//    非同期で遊ぶゲームなので、待ち続ける設計だと誰かの都合で週が進まない。
//    締め切りを過ぎたら未提出の人に既定案を当てて先へ進める。
//
// 曜日の割り当ては締め切りの置き方で決まる。シーズンは月曜0時に始まり、
// 160ターン（32×5日）で**金曜23時15分に終わる**。そこから、
//
//   土曜  ストーブリーグ（契約更改・トライアウト・オフシーズン）→ 締め切り 日曜0時
//   日曜  キャンプ・編成                                       → 締め切り 月曜0時
//   月曜  新シーズン開幕
//
// ⚠ 締め切りが曜日合わせを兼ねている。全員が早く決めても、次の開幕は
//    月曜0時まで来ない（曜日がずれない）。
// ============================================================

/**
 * キャンプで選べる練習。**サーバーと画面で同じ表を見る**。
 *
 * ⚠ 画面にだけメニューを増やさないこと。`TRAINING_MENUS` には
 *    「新球種習得（newpitch）」のようにオンラインのエンジンが動かさないものが
 *    あり、出すと選べるのに提出で弾かれる（実測で画面に出ていた）。
 */
export const CAMP_MENUS = [
  'batting',
  'baserunning',
  'fielding',
  'control',
  'velocity',
  'intensive_power',
  'intensive_meet',
  'intensive_speed',
  'intensive_control',
  'intensive_velocity',
  'intensive_defense',
  'intensive_eye',
];

/**
 * フェーズを行う曜日（JST。0=日曜 … 6=土曜）。締め切りはその翌日0時。
 *
 * ⚠ **初期編成にも締め切りを置くこと**。以前は「最初の1回くらいは全員を待とう」と
 *    締め切りを設けなかったが、1人が決めないだけでリーグが永久に止まった
 *    （実際、開幕前の日付のまま何日も動かなくなった）。
 *    **時間による進行が絶対**で、決めていない人は標準案で押し通す。
 * ⚠ 初期編成を土曜（＝締め切り日曜0時）に置くのは、その次のキャンプが
 *    月曜0時に締め切られて**月曜開幕**になるため。初期編成を日曜に置くと、
 *    キャンプの締め切りが1週間先になって開幕が遅れる。
 */

/**
 * 新球種習得で狙える球種。
 * ⚠ **表はここに書かない**。正本は `campTraining.js` の `PITCH_TYPES`（実際に
 *    覚えられる球種）で、ここはそれを別名で出すだけ。書き写すと、画面に
 *    出ているのに覚えられない球種ができる。
 */
export { PITCH_TYPES as CAMP_PITCH_TYPES } from '../season/campTraining.js';

/**
 * サブ練習で**対象を選べるもの**と、その対象の種類。
 *
 * ⚠ **選べるのに選ばせない、をやめる**。`executeSubTraining` は新球種の球種も
 *    サブポジの守備位置も `options` で受け取れるのに、オンラインは何も渡して
 *    いなかった。そのため新球種は中で抽選され、サブポジ練習は「対象の置き場が
 *    無い」という理由でメニューごと外れて、**野手のサブ練習が体づくり系だけ**に
 *    なっていた。
 * ⚠ 指定しても**成功率は上がらない**。新球種はフォーム適性と器用さで決まる。
 * ⚠ 「おまかせ」を残すこと（指定が無ければ従来どおり中で選ぶ）。
 * ⚠ フォーム改造・打席変更はまだ入れない（対象の種類が増える）。
 */
export const CAMP_SUB_TARGETS = {
  // 覚えたい球種（まだ持っていないもの）
  newpitch: 'pitch',
  // 磨きたい球種（持っているもの）。分散させず1つに注ぐので伸びが速い
  breaking: 'ownPitch',
  // 覚えさせたい守備位置
  subposition: 'position',
};

/**
 * キャンプのサブ練習。**サーバーと画面で同じ表を見る**。
 *
 * ⚠ 対象を選ぶものは `CAMP_SUB_TARGETS` に載せ、画面が対象の欄を出す。
 *    載せずに入れると、中で勝手に選ばれる。
 * ⚠ 変化球練習は対象を選べる（磨きたい持ち球。`CAMP_SUB_TARGETS` の ownPitch）。選ばなければ
 *    持っている変化球へ自動で振り分ける。
 */
export const CAMP_SUB_MENUS = [
  'physique',
  'weight',
  'stretch',
  'defense_sub',
  'long_throw',
  'eye',
  'clead_study',
  'breaking',
  'newpitch',
  'spin_analysis',
  // ⚠ **野手のサブ練習がこれ1つだけ欠けていた**（体づくり系しか選べなかった）
  'subposition',
];

/**
 * 1球団が抱えられる選手の上限。
 * ⚠ **1か所に置くこと**。トライアウトの獲得人数・画面の上限・トレードの検査が
 *    別々に 24 と書いていると、変えたときに片方だけ残る。
 */
export const ROSTER_LIMIT = 26;

/**
 * オンラインの目標構成（合計26人）。
 *
 * ⚠ **一人用の `ROSTER_TARGETS`（24人）とは別**。一人用の名簿と試合の釣り合いは
 *    24人で測ってあり、そこを動かすとドラフト・トライアウト・戦力外の
 *    釣り合いが全部ずれる。オンラインだけ枠を2つ増やすので、表を分けた。
 * ⚠ 合計は `ROSTER_LIMIT` と揃えること。ずれると、トライアウトが枠を
 *    埋めきれない（目標に達して止まる）か、上限で弾かれる。
 */
export const ONLINE_ROSTER_TARGETS = {
  pitcher: 11,
  catcher: 2,
  infielder: 6,
  outfielder: 7,
};

/** キャンプのクール数。一人用と同じ4回 */
export const CAMP_ROUNDS = 4;

/**
 * 版のずれ（`code: 'revision'`）だけなら、最新の版で1回だけ送り直す命令。
 *
 * ⚠ **PC・スマホ（`OnlineApp.jsx`）とアプリ（`OnlineApi.kt`、`gen-tables.mjs` で写す）が
 *    ここを読む**。別々に書いていたので、アプリだけ `campRound` が抜けて、45分ごとの進行や
 *    他の参加者の操作のあとにクールを実行すると「他の操作で更新されました」で止まっていた。
 * ⚠ 足してよいのは、版とは別に本当の食い違いを確かめている命令だけ。編成と提出は
 *    `baseLineup` / `baseSubmission`、キャンプはクール番号（同じクールは2回走らない）。
 *    トレードの申し込み・返事は足さない（送り直すと二重の申し込みになりうる）。
 */
export const RETRY_ON_REVISION = ['lineup', 'submit', 'campRound'];

/**
 * 育成方針ごとの「4クールでの伸びの目安」（1人あたりの平均。画面に出す）。
 *
 * ⚠ いしだ指摘: キャンプでどれくらい上がるのか、おまかせ（標準＝全体を伸ばす×技術）で
 *    いいのかが分からない。**実測の数字**を置く（`tools/sim-harness/camp-policy-probe.mjs`、
 *    初期セット26人×8回、2026-11-08。確率で丸める・まとめて1回丸める直しの後に測り直した 2026-11-14）。
 *    練習の式を変えたら測り直して書き直すこと。
 * ⚠ 体力・体幹は数字が大きく出るが、試合への効き方は打撃・制球より緩い
 *    （`ABILITY_HELP` の説明どおり）。合計の大きさで方針を選ばせないこと。
 */
export const CAMP_POLICY_GUIDE = {
  'balanced:skill': {
    fielder: 'ミート+3 パワー+2 回復+1 選球眼+1',
    pitcher: 'スタミナ+4 制球+2 回復+1 球速+1',
  },
  'balanced:physique': {
    fielder: '体力+12 体幹+8 盗塁+2 バント+1',
    pitcher: '体力+12 スタミナ+10 体幹+8 球速+2 肩力+2',
  },
  'sharpen:skill': {
    fielder: 'ミート+2 選球眼+2（いちばん高い能力に集中）',
    pitcher: '制球+2 守備+1',
  },
  'sharpen:physique': {
    fielder: '体幹+8 肩力+2 盗塁+2 パワー+2',
    pitcher: '体幹+8 肩力+3 球速+2 守備+1 スタミナ+1',
  },
  'patch:skill': {
    fielder: 'バント+2 守備+2 ミート+1 盗塁+1（いちばん低い能力を底上げ）',
    pitcher: '守備+3 スタミナ+2',
  },
  'patch:physique': {
    fielder: '体力+12 体幹+8 盗塁+2 バント+1',
    pitcher: '体力+12 スタミナ+10 体幹+8 球速+1 肩力+1',
  },
};

/** 育成方針（やる気に効く）。`trainingPolicy` の `DIRECTIONS` / `PHASES` と揃える */
export const CAMP_DIRECTIONS = ['sharpen', 'balanced', 'patch'];
export const CAMP_PHASES = ['physique', 'skill'];

export const PHASE_WEEKDAY = {
  // ⚠ 初期メンバー選択も土曜扱い（締め切り日曜0時）。続くキャンプが
  //    月曜0時に締め切られて月曜開幕になる
  pack_select: 6,
  // ⚠ 3→4 の移行が、締め切りの無い初期編成に締め切りを入れるときに使う。
  //    4→5 でセット選択へ差し替わるので、新しいリーグには出てこない
  initial_tryout: 6,
  contract: 6,
  tryout: 6,
  offseason: 6,
  camp: 0,
};

/** JSTでの曜日（0=日曜 … 6=土曜） */
export function jstWeekday(iso) {
  return new Date(new Date(iso).getTime() + 9 * 3600000).getUTCDay();
}

/**
 * 指定した曜日の0時（JST）のうち、`now` より後で一番近いものを返す。
 * ⚠ `now` がちょうどその曜日の0時でも、**次の週**を返す（先へ進むため）。
 */
export function nextWeekdayStart(now, weekday) {
  const ms = new Date(now).getTime();
  requireOnline(Number.isFinite(ms), '時刻が不正です');
  const jst = new Date(ms + 9 * 3600000);
  const midnight =
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) -
    9 * 3600000;
  const diff = (weekday - jst.getUTCDay() + 7) % 7 || 7;
  return new Date(midnight + diff * 86400000).toISOString();
}

/**
 * 締め切りまでに最低限残す時間（時間）。足りなければ翌週の同じ締め切りにする。
 *
 * ⚠ **リーグの最初の手続きに付けること**。いまの最初の手続きは初期メンバー選択
 *    （`pack_select`）。`initial_tryout` は 3→4 の移行でしか出てこない古い形で、
 *    以前はそちらにしか付いておらず、土曜の夜にリーグを作ると数分で締め切られて
 *    全員が標準のセットになっていた。
 */
export const MIN_PHASE_HOURS = {
  pack_select: 12,
  initial_tryout: 12,
};

/**
 * 担当の曜日を過ぎてから開いた手続きに与える猶予（時間）。
 *
 * ⚠ **ストーブリーグの3つは同じ土曜に並んでいる**。契約更改が日曜0時の
 *    締め切りまでかかると、続くトライアウトは日曜に開く。そのまま
 *    「次の日曜0時」を締め切りにすると**丸1週間待つ**ことになり、
 *    シーズンの曜日も1週ずれる（以前は実際にそうなっていた）。
 *    担当の曜日を過ぎていたら翌週を待たせず、この時間で締める。
 *    トライアウト12時間＋オフシーズン4時間で日曜のうちに収まり、
 *    キャンプは従来どおり月曜0時に締まる。
 */
export const LATE_PHASE_GRACE_HOURS = {
  contract: 12,
  tryout: 12,
  offseason: 4,
};

/**
 * 手続きが閉じる時刻＝**担当曜日の0時から何時間後か**（JST）。
 *
 * ⚠ **土曜の3つで土曜（32ターン）を分け合うこと**。以前はどれも「翌日0時」を
 *    締め切りにしていたので、契約更改が締め切りまでかかると続くトライアウトは
 *    日曜に開き、キャンプの32ターンを食っていた。実測で
 *    **ストーブリーグ52ターン・キャンプ8ターン**になっていた（本来 32 / 32）。
 * ⚠ 担当日の合計が24時間（32ターン）を超えないこと。超えると次の曜日の枠が
 *    削られる。
 * ⚠ ここを動かすと**考える時間の長さ**が変わる。非同期で遊ぶゲームなので、
 *    短くしすぎると寝ている間に標準案で決まる。
 */
export const PHASE_WINDOW_HOURS = {
  // 土曜（ストーブリーグ）= 32ターン
  contract: 12, //  0:00〜12:00（16ターン）
  tryout: 21, // 12:00〜21:00（12ターン）
  offseason: 24, // 21:00〜24:00（4ターン）
  // 日曜（キャンプ）= 32ターン
  camp: 24,
  // 開幕前の初期メンバー選択は1日まるごと使う
  pack_select: 24,
  initial_tryout: 24,
};

/**
 * フェーズの締め切り。担当曜日の0時 ＋ `PHASE_WINDOW_HOURS`（JST）。
 * 担当が決まっていないフェーズ（初期編成）は `null`＝待ち続ける。
 * 担当の曜日を過ぎてから開いたときは `LATE_PHASE_GRACE_HOURS` だけ待つ。
 */
export function phaseDeadlineAt(kind, now) {
  const weekday = PHASE_WEEKDAY[kind];
  if (weekday === undefined) return null;
  const windowHours = PHASE_WINDOW_HOURS[kind] ?? 24;
  const ms = new Date(now).getTime();
  // ⚠ **担当曜日の0時から数えること**。「翌日0時」だと、土曜の3つが全部
  //    同じ時刻を締め切りにしてしまい、順番に開く2つ目以降が日曜へはみ出す
  let close =
    new Date(nextWeekdayStart(now, weekday)).getTime() -
    7 * 86400000 +
    windowHours * 3600000;
  while (close <= ms) close += 7 * 86400000;
  let regular = new Date(close).toISOString();
  const grace = LATE_PHASE_GRACE_HOURS[kind];
  // ⚠ 初期編成は最初の手続きで、ドラフトの希望を考える時間が要る。土曜の夜に
  //    リーグを作ると締め切り（日曜0時）まで数分しかなく、全員が標準案で
  //    決まっていた。短すぎるときは翌週の日曜0時にする（全員が決めれば待たずに進む）
  const minimum = MIN_PHASE_HOURS[kind];
  if (minimum && new Date(regular).getTime() - ms < minimum * 3600000)
    regular = new Date(new Date(regular).getTime() + 7 * 86400000).toISOString();
  // 締め切りが5日以上先＝担当の曜日を過ぎた直後に開いた（遅れて開いた）
  if (grace === undefined || new Date(regular).getTime() - ms < 5 * 86400000)
    return regular;
  return new Date(ms + grace * 3600000).toISOString();
}

/**
 * キャンプが終わったあと、新シーズンの最初の試合を進める時刻。
 *
 * ⚠ **開幕は月曜0時に揃える**。以前はキャンプが決まった次の正時に始めていたため、
 *    全員が早く決めると火曜に開幕して、シーズン（160ターン）の終わりも
 *    土曜にずれ込んでいた（ストーブリーグの土曜とぶつかる）。
 * ⚠ 月曜に入ってから決まった（締め切りの月曜0時の自動決定を含む）ときは、
 *    次の週まで待たせず次の刻み（45分ごと）から始める。
 */
export function seasonStartAt(now) {
  return jstWeekday(now) === 1
    ? nextProgressionAt(now)
    : nextWeekdayStart(now, 1);
}
