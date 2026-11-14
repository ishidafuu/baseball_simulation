// ============================================================
// 球団間のトレード。
//
// 【流れ】提案 → 相手が「受ける／逆提案／断る」。
//   - 受ける → その場で成立し、選手が入れ替わる
//   - 逆提案 → **提案した側に戻る**。そこで受ければ成立、断れば消える
//   - 断る   → 消える
// ⚠ **逆提案は1回だけ**。何度でも投げ返せると終わらない。2回目の返事は
//    「受ける」か「断る」だけにする。
//
// ⚠ **ここは純粋な計算だけを持つこと**。保存・通信・乱数の生成に触らない。
//    `Math.random()` を呼ばない（シードから決まる必要がある）。
//    配線（API・サーバー）は別のファイルで行う。
// ============================================================
import { requireOnline, ROSTER_LIMIT } from './shared.js';
import { rosterGroup } from '../utils/constants.js';
import { STRENGTH_GAP_LIMIT } from './tradeSearch.js';

/** 1球団が同時に抱えられる提案の数。⚠ 無制限だと相手の画面を埋められる */
export const MAX_OPEN_TRADES = 5;

/**
 * 名簿として成り立つか。⚠ トライアウトの解決と**同じ条件**にする
 *    （`resolveTryout` の最後の検査）。ここだけ緩めると、トレードで
 *    捕手のいない球団を作れてしまう。
 */
export function rosterShortfall(players) {
  const problems = [];
  if (players.length > ROSTER_LIMIT)
    problems.push(`${ROSTER_LIMIT}人を超えます（${players.length}人）`);
  if (!players.some((p) => p.position === 'pitcher')) problems.push('投手が居なくなります');
  if (!players.some((p) => p.position === 'catcher')) problems.push('捕手が居なくなります');
  const fielders = players.filter((p) => p.position !== 'pitcher').length;
  if (fielders < 8) problems.push(`野手が8人を割ります（${fielders}人）`);
  return problems;
}

/** トレード後の両球団の名簿。⚠ 元の配列は書き換えない */
export function rostersAfterTrade(fromPlayers, toPlayers, offerIds, wantIds) {
  const offer = new Set(offerIds);
  const want = new Set(wantIds);
  const moving = fromPlayers.filter((p) => offer.has(p.id));
  const coming = toPlayers.filter((p) => want.has(p.id));
  return {
    from: [...fromPlayers.filter((p) => !offer.has(p.id)), ...coming],
    to: [...toPlayers.filter((p) => !want.has(p.id)), ...moving],
    moving,
    coming,
  };
}

/**
 * 提案の中身が通るか。**提案のときと、成立のときの両方で呼ぶこと**。
 *
 * ⚠ 提案から成立までの間に、選手が別のトレードで移っていることがある。
 *    提案のときに見ただけだと、居ない選手を動かして名簿が壊れる。
 */
export function assertTradeAllowed(fromTeam, toTeam, offerIds, wantIds) {
  requireOnline(
    Array.isArray(offerIds) && Array.isArray(wantIds),
    'トレードの内容が不正です',
  );
  requireOnline(
    new Set(offerIds).size === offerIds.length &&
      new Set(wantIds).size === wantIds.length,
    '同じ選手を2回指定しています',
  );
  requireOnline(
    offerIds.length + wantIds.length >= 1,
    '選手を1人以上入れてください',
  );
  const has = (team, ids) =>
    ids.every((id) => team.players.some((p) => p.id === id));
  requireOnline(has(fromTeam, offerIds), '出す選手が名簿にいません', 409);
  requireOnline(has(toTeam, wantIds), '相手の名簿にいない選手です', 409);
  const after = rostersAfterTrade(
    fromTeam.players,
    toTeam.players,
    offerIds,
    wantIds,
  );
  // ⚠ **両方の球団を見る**。自分の名簿だけ見ていると、相手を壊すトレードが通る
  const mine = rosterShortfall(after.from);
  const theirs = rosterShortfall(after.to);
  requireOnline(!mine.length, `自球団の名簿が成り立ちません: ${mine.join('・')}`);
  requireOnline(
    !theirs.length,
    `相手の名簿が成り立ちません: ${theirs.join('・')}`,
  );
  return after;
}

// ============================================================
// CPU球団の返事。
//
// ⚠ **乱数を使わないこと**。同じ提案には同じ答えを返す（やり直しても結果が
//    変わらない）。`seeded` の中で呼ばれるとしても、乱数に頼ると
//    「断られたので出し直す」を繰り返すだけで通るようになってしまう。
// ⚠ **価値の物差しを新しく作らないこと**。`valueOf` を受け取る形にして、
//    呼ぶ側（サーバー）が値段を渡す（`server/tradeJudge.mjs`。素質はドラフトと
//    同じ `deviationValue`、そこへいまの力・成績・球団の事情を掛けたもの）。
//    ここで別の式を書くと、**画面に出ている値段と食い違う**（画面の見込み
//    メーターはサーバーが渡した値段で境目を引いている）。
// ============================================================

/**
 * CPUが求める上乗せ。
 *
 * ⚠ **1.0 にしないこと**。釣り合っているだけの交換をCPUが受けると、
 *    「少しだけ得な提案」を何度も通して一方的に戦力を集められる。
 *    5%の上乗せを求めると、等価交換は逆提案に回り、明らかに得な交換だけ通る。
 */
export const CPU_ACCEPT_MARGIN = 1.05;

/**
 * 守備の括り。⚠ 内野を頼まれて投手を出すような逆提案をしないため。
 *
 * ⚠ **内野と外野を分けること**（いしだ 2026-11-13「外野が欲しいのに内野を
 *    提案される」）。以前は投手・捕手・**野手**の3つしかなく、外野手を頼むと
 *    内野手で返ってきた。名簿の区分（`rosterGroup`。目標構成と同じ4つ）に揃える。
 * ⚠ 括りが足りずに差し替えられないときは**断る**のが正しい。別の持ち場の選手を
 *    返しても、相手が欲しいものにならない。
 */
const tradeKind = (p) => (p?.position ? rosterGroup(p.position) : undefined);

/**
 * CPU球団の返事を決める。`{ action: 'accept' | 'counter' | 'reject' }`。
 *
 * - 受ける … 受け取る価値が、出す価値の `CPU_ACCEPT_MARGIN` 倍以上
 * - 逆提案 … 受け取る選手はそのままで、**出す選手を釣り合うものに差し替える**
 *            （人数と守備の括りは変えない。予算に収まる中で最も価値が高い選手）
 * - 断る   … 差し替えても釣り合わない（＝払える選手が居ない）
 *
 * ⚠ `offer` は**提案した側が出す選手**。CPUから見ると受け取る側。
 * ⚠ 価値は 1 を下回らせない。負の値があると予算の計算が壊れる
 *    （弱い選手を足すほど「安くなる」ことになってしまう）。
 * ⚠ `valueOfOwn` は**CPU自身の選手に付ける値段**（無ければ `valueOf`）。自分の
 *    名簿の事情（抜けると穴が空く選手は高く、代わりが居る選手は等倍）を入れるため
 *    に分けてある。受け取る選手にも同じ事情を掛けると、足りない持ち場へ**弱い選手を
 *    押し込むだけで上乗せを満たせる**（`server/tradeJudge.mjs`）。
 * ⚠ `lossOf` は**CPU自身の選手をまとめて出すときの値段**（1人ずつの配列）。何人か
 *    まとめて抜けると1人ずつの穴の合計より大きな穴が空くので、まとめて測る
 *    （`tradeSearch.js` の `needFactors`）。無ければ `valueOfOwn` を1人ずつ足す。
 *    逆提案も、組んだ顔ぶれをまとめた値段で予算に収まるかを確かめる。
 * ⚠ `strengthGap(offerIds, wantIds)` は**交換で開く戦力の差**（提案した側の伸び − CPUの伸び。
 *    `tradeSearch.js` の `tradeStrengthGap`）。`STRENGTH_GAP_LIMIT` を超える交換は値段が
 *    釣り合っても断る（`reason: 'lopsided'`）。逆提案の顔ぶれにも同じ線を当てる。
 *    値段は1人ずつの合計なので、これが無いと弱い2人で強い1人が取れる（いしだ 2026-11-14）。
 *    無ければ値段だけで決める（検査の古い呼び出し）。
 */
export function cpuTradeDecision({
  valueOf,
  valueOfOwn = valueOf,
  lossOf = null,
  fromPlayers,
  toPlayers,
  offerIds,
  wantIds,
  strengthGap = null,
}) {
  const lopsided = (ids) =>
    !!strengthGap && strengthGap(offerIds, ids) > STRENGTH_GAP_LIMIT;
  const value = (p) => Math.max(1, valueOf(p) || 0);
  const ownValue = (p) => Math.max(1, valueOfOwn(p) || 0);
  const pick = (players, ids) =>
    ids.map((id) => players.find((p) => p.id === id)).filter(Boolean);
  const total = (players, of) => players.reduce((a, p) => a + of(p), 0);
  const incoming = pick(fromPlayers, offerIds);
  const outgoing = pick(toPlayers, wantIds);
  const gain = total(incoming, value);
  const setLoss = (players) =>
    lossOf
      ? lossOf(players).reduce((a, v) => a + Math.max(1, v || 0), 0)
      : total(players, ownValue);
  const loss = setLoss(outgoing);
  if (gain >= loss * CPU_ACCEPT_MARGIN) {
    if (lopsided(wantIds)) return { action: 'reject', gain, loss, reason: 'lopsided' };
    return { action: 'accept', gain, loss };
  }
  // 逆提案を組む。⚠ 並べ方を決定的にすること（同値はidで分ける）
  const budget = gain / CPU_ACCEPT_MARGIN;
  const pool = [...toPlayers]
    .filter((p) => tradeKind(p) !== undefined)
    .sort((a, b) => ownValue(b) - ownValue(a) || a.id - b.id);
  const picked = [];
  let left = budget;
  for (const asked of outgoing) {
    const slot = pool.find(
      (p) =>
        !picked.includes(p) &&
        tradeKind(p) === tradeKind(asked) &&
        ownValue(p) <= left,
    );
    // 払える選手が居ない＝どう組んでも釣り合わない
    if (!slot) return { action: 'reject', gain, loss };
    picked.push(slot);
    left -= ownValue(slot);
  }
  // まとめて抜けた穴の上乗せで予算を超えるなら、どう組んでも釣り合わない
  if (lossOf && setLoss(picked) > budget) return { action: 'reject', gain, loss };
  // ⚠ 差し替えた顔ぶれでも戦力の差が開きすぎるなら、逆提案にしない（受けない案を返さない）
  if (lopsided(picked.map((p) => p.id)))
    return { action: 'reject', gain, loss, reason: 'lopsided' };
  // ⚠ 中身が同じなら逆提案にならない（受けないのだから断る）
  if (picked.length === outgoing.length &&
      picked.every((p, i) => p.id === outgoing[i].id))
    return { action: 'reject', gain, loss };
  return { action: 'counter', want: picked.map((p) => p.id), gain, loss };
}

/**
 * 返事ができるのは誰か。
 * ⚠ **手番を持っている側だけ**。両方が同時に受けられると、二重に成立する。
 */
export const canRespond = (trade, userId) =>
  trade.turn === 'to' ? trade.to === userId : trade.from === userId;

/**
 * 逆提案を出せるか。
 * ⚠ **最初の返事のときだけ**。投げ返しが続くと終わらない。
 */
export const canCounter = (trade, userId) =>
  canRespond(trade, userId) && !trade.countered && trade.turn === 'to';
