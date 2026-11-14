// ============================================================
// 人どうしの関わり（ひとこと・お知らせ・留守・予告先発・練習試合）の決まり。
// サーバーと PC の画面が同じ数字を使う。アプリ（Kotlin）は数字を `Tables.kt`（`gen-tables.mjs` が書き出す）
// から、文の作り方を `mobile/shared/.../Social.kt` に写している。文を変えたらそちらも直す
// （`mobile/tools/expect-social.mjs` の答えと `SocialTest` が照らし合わせる）。
// ============================================================

/** トレードの提案・逆提案に添える「ひとこと」の字数 */
export const TRADE_NOTE_MAX = 100;
/** オーナーのひとこと（順位表・球団の画面・紙面に出す）の字数 */
export const OWNER_COMMENT_MAX = 40;
/** 練習試合の申し込みに添えるひとことの字数 */
export const CHALLENGE_NOTE_MAX = 60;
/** 人ごとの「あなたへのお知らせ」を残す件数 */
export const INBOX_LIMIT = 20;
/** リーグの取引の記録を残す件数（およそ2年ぶん） */
export const TRANSACTIONS_LIMIT = 200;
/**
 * この日数来ていない人の球団は「おるすばん」（スタメン・投手起用・試合中の采配・手続きを指導者に任せた扱い）。
 * ⚠ 本人の任せ方の設定は書き換えない。来ればその場で元に戻る
 */
export const AWAY_DAYS = 3;
/**
 * 最後に来た時刻を書き直す間隔。読むだけの人も画面を開くたびに知らせてくるので、
 * 毎回書くと保存が増える。表示は「今日・昨日・N日前」なので、この粗さで足りる
 */
export const PRESENCE_REFRESH_HOURS = 3;
/**
 * 予告先発: 試合のこのターン数より前なら先発を指名・変更できる。ここから先は確定して相手にも見える。
 * ⚠ 確定の時刻は両軍で同じ。指名していない球団はこれまでどおりローテの順で回る
 */
export const STARTER_LOCK_TURNS = 3;
/** 予告先発を指名できる、自球団の先の試合の数（ホームの「今後の試合」と同じ） */
export const STARTER_PICK_GAMES = 6;
/** 練習試合: 同じ相手とは1日（日本時間）にこの数まで */
export const EXHIBITIONS_PER_DAY = 1;
/** 練習試合: 自分から出しておける申し込みの数 */
export const MAX_OPEN_CHALLENGES = 3;
/** 練習試合: 結果を残す件数（リーグ全体） */
export const EXHIBITION_LIMIT = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 人が書いた文を保存できる形にする。前後の空白を落とし、改行・制御文字を空白に、
 * 長すぎれば断る（黙って切ると、読んだ人に違う文が届く）。
 */
export function cleanText(value, max) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, tooLong: [...text].length > max };
}

/** 最後に来てからの日数（来た記録が無ければ null） */
export function daysSince(lastSeenAt, now) {
  if (!lastSeenAt || !now) return null;
  const ms = Date.parse(now) - Date.parse(lastSeenAt);
  return Number.isFinite(ms) ? Math.max(0, ms / DAY_MS) : null;
}

/**
 * 「おるすばん」か。⚠ 来た記録の無い人は留守にしない（版13へ上げたときは全員に今の時刻を入れる）
 */
export function isAwayAt(member, now) {
  const days = daysSince(member?.lastSeenAt, now);
  return days !== null && days >= AWAY_DAYS;
}

/** 日本時間の日付（'2026-11-14'）。練習試合の1日の数え方に使う */
export function tokyoDay(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 最終ログインの見せ方（「今日」「昨日」「3日前」）。細かい時刻は出さない
 * （見せたくない人もいるので、粗く出す）。
 */
export function lastSeenLabel(lastSeenAt, now) {
  if (!lastSeenAt) return '';
  const today = tokyoDay(now);
  const seen = tokyoDay(lastSeenAt);
  if (!today || !seen) return '';
  const days = Math.round((Date.parse(today) - Date.parse(seen)) / DAY_MS);
  if (days <= 0) return '今日';
  if (days === 1) return '昨日';
  return `${days}日前`;
}

/**
 * 得点経過の1行の言い方（「2ラン」「タイムリー二塁打」「押し出し」）。
 * ⚠ アプリにも同じ表がある（`Social.kt` の `scoringLabel`）
 */
export function scoringLabel(play) {
  const runs = play?.runs || 0;
  switch (play?.kind) {
    case 'homerun':
      return runs >= 4 ? '満塁ホームラン' : runs === 1 ? 'ソロホームラン' : `${runs}ランホームラン`;
    case 'single':
      return 'タイムリー';
    case 'double':
      return 'タイムリー二塁打';
    case 'triple':
      return 'タイムリー三塁打';
    case 'walk':
      return '押し出し四球';
    case 'hit_by_pitch':
      return '押し出し死球';
    case 'error':
      return '相手の失策の間に';
    case 'other':
      return '暴投・盗塁などで';
    default:
      return '凡打の間に';
  }
}

/** 得点経過の1行（「7回裏 佐藤 2ランホームラン（3-2）」）。名前の無い行は言い方だけ */
export function scoringLine(play, { awayShort = '', homeShort = '' } = {}) {
  const half = play.half === 'top' ? '表' : '裏';
  const who = play.name ? `${play.name} ` : '';
  const score = `${play.away}-${play.home}`;
  const team = play.half === 'top' ? awayShort : homeShort;
  return `${play.inning}回${half}${team ? ` ${team}` : ''} ${who}${scoringLabel(play)}（${score}）`;
}
