import React, { useMemo, useState } from 'react';
import { POS } from './api.js';
import { AbilityGrade, PlayerStatsButton } from './PlayerPerformance.jsx';
import { Sheet } from './ui.jsx';
import { useReorder } from './reorder.js';
import { rosterGroup } from '../utils/constants.js';
import {
  POSITION_GROUPS,
  SORT_KEYS,
  filterCandidates,
  planSummary,
  plannedPicks,
  addToPlan,
  benchFromPlan,
  shiftInPlan,
  WEIGHT_FIELDS,
  WEIGHT_MAX,
  WEIGHT_LEVELS,
  WEIGHTED_SORT_KEY,
  DEFAULT_WEIGHTS,
  sanitizeWeights,
  weightedScore,
  weightedRanked,
} from './tryoutPlan.js';

// ============================================================
// 初期編成・トライアウトの希望リストを組み立てる画面（PC）。
//
// ⚠ **一人用のトライアウト画面は移植できない**。あちらは「順番が回ってきたら
//    1人選ぶ」生のドラフトで、こちらは非同期なので「希望リストを1回出す」。
//    操作の型が違うので、見せ方だけ借りて作り直している。
//
// ⚠ 候補は実測360人。以前は360行を1本のリストにして ↑↓ で並べ替えており、
//    300番目を1番にするのに299回押す必要があった。ここでは
//    「獲得予定の上位だけを並べ、残りは推奨順のまま控える」形にする。
//
// ⚠ `rankedIds` からは**誰も取り除かない**。サーバーは上から見て空いている人を
//    取るので、全員残しておくと競合したとき繰り上がる。「外す」は末尾送り。
// ============================================================

const PAGE = 12;
const GROUP_LABELS = {
  pitcher: '投手',
  catcher: '捕手',
  infielder: '内野手',
  outfielder: '外野手',
};

// 重みはこのブラウザにだけ覚える（サーバーへは送らない。保存の形を変えない）。
// ⚠ 読めない・書けないブラウザ（プライベートモードなど）でも画面は動かす
const WEIGHTS_KEY = 'baseball-online-tryout-weights';
function loadWeights() {
  try {
    const raw = localStorage.getItem(WEIGHTS_KEY);
    if (raw) return sanitizeWeights(JSON.parse(raw));
  } catch {
    /* 既定の重みで続ける */
  }
  return { ...DEFAULT_WEIGHTS };
}
function storeWeights(weights) {
  try {
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify(weights));
  } catch {
    /* 覚えられなくても、この画面の間は使える */
  }
}

// スマホでは候補探しを畳む（開くと同じ中身）
function PoolWrap({ compact, count, children }) {
  return compact ? (
    <details className="online-tryout-pool-fold">
      <summary>候補から選手を加える（{count}人）</summary>
      {children}
    </details>
  ) : (
    children
  );
}

function Line({ player, score }) {
  if (!player) return null;
  return (
    <>
      <PlayerStatsButton player={player} panel="abilities" />
      <small>
        {score !== undefined && (
          <b className="online-tryout-score" title="重視する能力から出した評価値（0〜100）">
            評価{Math.round(score)}{' '}
          </b>
        )}
        {player.age}歳 / {POS[player.position]} /{' '}
        {player.position === 'pitcher' ? (
          <>
            球速<AbilityGrade value={player.pitching?.velocity} velocity />{' '}
            制球<AbilityGrade value={player.pitching?.control} /> スタミナ
            <AbilityGrade value={player.pitching?.stamina} stamina />
          </>
        ) : (
          <>
            ミート<AbilityGrade value={player.batting?.meet} /> パワー
            <AbilityGrade value={player.batting?.power} /> 守備
            <AbilityGrade value={player.fielding?.defense} />
          </>
        )}
      </small>
    </>
  );
}

export default function TryoutPlanner({
  plan,
  candidates,
  roster,
  maxCount,
  busy,
  onChange,
  onReset,
  compact = false,
}) {
  // ⚠ スマホでも同じ画面で最後まで決められるようにする（以前は「詳細はPCで」）。
  //    スマホでは獲得予定を上位10人だけ出し、候補探しは畳んでおく
  const [showAllWanted, setShowAllWanted] = useState(false);
  // 順位を数字で選ぶシート（押した選手の、獲得予定の中の位置）
  const [ranking, setRanking] = useState(null);
  const [group, setGroup] = useState('all');
  // ⚠ 既定は「評価値」。重みを変えたら、候補の並びもその重みで見えるようにする
  const [sortKey, setSortKey] = useState(WEIGHTED_SORT_KEY);
  const [weights, setWeightsState] = useState(loadWeights);
  const setWeights = (next) => {
    const clean = sanitizeWeights(next);
    setWeightsState(clean);
    storeWeights(clean);
  };
  const scores = useMemo(
    () => new Map(candidates.map((p) => [p.id, weightedScore(p, weights)])),
    [candidates, weights],
  );
  const scoreOf = (p) => scores.get(p.id) ?? 0;
  const [query, setQuery] = useState('');
  // ⚠ ページ送りにしない。候補は約360人で、12人ずつだと30ページ送ることになった。
  //    「もっと見る」で続きを足していく
  const [limit, setLimit] = useState(PAGE);
  const setPage = () => setLimit(PAGE);
  const [showBench, setShowBench] = useState(false);
  // ⚠ お知らせは**出したときの希望順と組で持つ**。「標準案に戻す」など外から
  //    希望順が変わったら出さない（「作り直しました」が標準案の上に残っていた）
  const [noticeState, setNoticeState] = useState(null);
  const notice =
    noticeState && noticeState.for === plan.rankedIds ? noticeState.text : '';
  const setNotice = (text, rankedIds = plan.rankedIds) =>
    setNoticeState(text ? { text, for: rankedIds } : null);

  const byId = useMemo(
    () => new Map(candidates.map((p) => [p.id, p])),
    [candidates],
  );
  const count = Math.min(plan.count, plan.rankedIds.length);
  // ⚠ **希望順の上から count 人、ではない**。サーバーは目標構成
  //    （投手10・捕手2・内野6・外野6）を超える区分を飛ばすので、
  //    同じ規則で「実際に取る顔ぶれ」を出す。ここを希望順の先頭にすると、
  //    画面に並んでいる顔ぶれと実際に取る顔ぶれが食い違う
  const { counts, picked, targets, blocking, warnings } = planSummary(
    plan.rankedIds,
    candidates,
    count,
    roster,
  );
  const wanted = picked.map((p) => p.id);
  const wantedSet = useMemo(() => new Set(wanted), [wanted.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const bench = plan.rankedIds.filter((id) => !wantedSet.has(id));

  const pool = useMemo(
    () => filterCandidates(candidates, { group, query, sortKey, scoreOf }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scoreOf は scores から決まる
    [candidates, group, query, sortKey, scores],
  );
  const shown = pool.slice(0, limit);

  const setRanked = (rankedIds) => {
    setNotice('');
    onChange({ ...plan, rankedIds });
  };
  // ⚠ 操作は**獲得予定を基準に**行う（`tryoutPlan.js` の説明を参照）。
  //    `rankedIds` の位置で動かすと、目標構成で飛ばされる選手が挟まったときに
  //    押した選手が入らない・消える・別の選手が入る、が起きていた
  // ⚠ 「外す」は**消さずに末尾へ**。消すと競合したときの繰り上がりが無くなる
  const drop = (id) =>
    setRanked(benchFromPlan(plan.rankedIds, candidates, count, roster, id));
  const shift = (index, delta) =>
    setRanked(shiftInPlan(plan.rankedIds, candidates, count, roster, index, delta));
  // ドラッグ・順位の指定で動かす。1つずつ隣と入れ替えるのと同じ結果にする
  const moveTo = (from, to) => {
    if (from === to) return;
    let ids = plan.rankedIds;
    const step = to > from ? 1 : -1;
    for (let i = from; i !== to; i += step)
      ids = shiftInPlan(ids, candidates, count, roster, i, step);
    setRanked(ids);
  };
  const add = (id, first) => {
    const next = addToPlan(plan.rankedIds, candidates, count, roster, id, { first });
    // ⚠ 黙って何も起きない、を作らない。今の名簿だけでその区分が目標を超えていると、
    //    サーバーも取りにいかないので、獲得予定には入れられない
    if (!plannedPicks(next, candidates, count, roster).some((p) => p.id === id)) {
      setNotice(
        `${byId.get(id)?.name}は、今の名簿だけで${GROUP_LABELS[rosterGroup(byId.get(id)?.position)]}が目標人数に達しているため、獲得予定に入れられません。`,
      );
      return;
    }
    setRanked(next);
  };

  // ⚠ 整数に丸めて範囲に収める。不正な値を送ると、サーバーの「獲得人数が不正です」で弾かれる
  const setCount = (value) =>
    onChange({
      ...plan,
      count: Math.max(0, Math.min(maxCount, Math.trunc(Number(value)) || 0)),
    });
  const visibleWanted = compact && !showAllWanted ? wanted.slice(0, 10) : wanted;
  const { rowProps, handleProps } = useReorder({
    count: visibleWanted.length,
    disabled: busy,
    onMove: moveTo,
  });

  return (
    <div className="online-tryout">
      <div className="online-tryout-head">
        {/* ⚠ 数字の入力欄にしない。スマホでキーボードが出て画面の半分が隠れていた */}
        <div className="online-stepper" role="group" aria-label="獲得希望人数">
          <span>
            獲得希望人数<small>（最大{maxCount}人）</small>
          </span>
          <button
            type="button"
            aria-label="獲得希望人数を減らす"
            disabled={busy || plan.count <= 0}
            onClick={() => setCount(plan.count - 1)}
          >
            −
          </button>
          <output aria-live="polite">{plan.count}人</output>
          <button
            type="button"
            aria-label="獲得希望人数を増やす"
            disabled={busy || plan.count >= maxCount}
            onClick={() => setCount(plan.count + 1)}
          >
            ＋
          </button>
        </div>
        <button type="button" disabled={busy} onClick={onReset}>
          標準案に戻す
        </button>
      </div>
      {/* ⚠ 標準案（サーバーが作る既定の希望順）は決まった配分でしか見ない。
          どの能力を重く見るかを参加者が決め、その評価値でおすすめ順を作れるようにする */}
      <details className="online-tryout-weights">
        <summary>重視する能力（評価値の重み）</summary>
        <p className="online-muted">
          能力ごとに「軽視・やや軽視・普通・やや重視・重視・最重視」を選ぶと、
          0.6・0.8・1.0・1.2・1.4・1.6 倍で重み付けした平均を「評価」（0〜100）として出します。
          投手と野手は別の能力で計算します。重みはこのブラウザに覚えます。
        </p>
        {[
          ['fielder', '野手'],
          ['pitcher', '投手'],
          ['common', '共通'],
        ].map(([side, title]) => (
          <fieldset key={side}>
            <legend>{title}</legend>
            {WEIGHT_FIELDS.filter((f) => f.group === side).map((f) => (
              <label key={f.key}>
                <span>{f.label}</span>
                <input
                  type="range"
                  min="0"
                  max={WEIGHT_MAX}
                  step="1"
                  value={weights[f.key]}
                  aria-label={`${f.label}の重み`}
                  aria-valuetext={WEIGHT_LEVELS[weights[f.key]]?.label}
                  onChange={(e) =>
                    setWeights({ ...weights, [f.key]: e.target.value })
                  }
                />
                <output>{WEIGHT_LEVELS[weights[f.key]]?.label}</output>
              </label>
            ))}
          </fieldset>
        ))}
        <div className="online-tryout-weight-actions">
          <button
            type="button"
            className="online-primary"
            disabled={busy}
            onClick={() => {
              const next = weightedRanked(candidates, weights, roster);
              setRanked(next);
              setNotice(
                '評価の高い順に、投・捕・内・外の目標人数を守っておすすめ順を作り直しました。',
                next,
              );
            }}
          >
            この重みでおすすめ順を作る
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setWeights(DEFAULT_WEIGHTS)}
          >
            重みを標準に戻す
          </button>
        </div>
      </details>
      <p className="online-muted">
        上から順に取りにいきます。他球団に先を越された選手は飛ばして、控えから繰り上がります。
        名簿が偏らないよう、<strong>投{targets.pitcher}・捕{targets.catcher}・内
        {targets.infielder}・外{targets.outfielder}</strong>
        を超える区分は飛ばします（CPUの球団も同じ目標です）。
      </p>

      <div className="online-tryout-grid">
        <section className="online-tryout-wanted">
          <h3>
            獲得予定 {wanted.length}人
            {/* ⚠ 目標も並べて出す。超えたぶんは飛ばされるので、
                数字だけだと「希望したのに入らない」理由が分からない */}
            <small>
              　投{counts.pitcher}/{targets.pitcher} 捕{counts.catcher}/
              {targets.catcher} 内{counts.infielder}/{targets.infielder} 外
              {counts.outfielder}/{targets.outfielder}
            </small>
          </h3>
          {/* ⚠ 成り立たない編成は、提出した瞬間ではなく**ここ**で知らせる。
              手続きは全員ぶんまとめて処理されるので、1球団が成り立たないと
              全員が先へ進めない */}
          {blocking.length > 0 && (
            <p role="alert" className="online-tryout-block">
              このままでは決定できません: {blocking.join(' / ')}
              　獲得希望人数を増やすか、希望順位を入れ替えてください。
            </p>
          )}
          {warnings.length > 0 && (
            <p role="alert" className="online-tryout-warn">
              {warnings.join(' / ')}
              　この位置は人数が足りないと自動で埋められます。
            </p>
          )}
          {notice && (
            <p role="status" className="online-tryout-warn">
              {notice}
            </p>
          )}
          {wanted.length === 0 && <p>獲得希望人数を1人以上にしてください。</p>}
          <ol className="online-tryout-list is-wanted">
            {visibleWanted.map((id, i) => (
              <li key={id} {...rowProps(i)}>
                {/* ⚠ 順位の数字を押すと、入れたい順位を選べる。以前は ↑↓ で1つずつで、
                    20位を上位へ上げるのに19回押していた */}
                <button
                  type="button"
                  className="online-tryout-rank"
                  aria-label={`${byId.get(id)?.name}の希望順位（${i + 1}位）を変える`}
                  disabled={busy}
                  onClick={() => setRanking(i)}
                >
                  {i + 1}
                </button>
                <span className="online-tryout-person">
                  <Line player={byId.get(id)} score={scores.get(id)} />
                </span>
                <span className="online-row-actions">
                  <button
                    type="button"
                    aria-label={`${byId.get(id)?.name}を控えへ回す`}
                    disabled={busy}
                    onClick={() => drop(id)}
                  >
                    外す
                  </button>
                  <button {...handleProps(i, `${byId.get(id)?.name}の希望順位を動かす`)}>≡</button>
                </span>
              </li>
            ))}
          </ol>
          {compact && wanted.length > 10 && (
            <button
              type="button"
              className="online-more"
              onClick={() => setShowAllWanted(!showAllWanted)}
            >
              {showAllWanted ? '上位10人だけ表示' : `残り${wanted.length - 10}人も表示`}
            </button>
          )}
          <button
            type="button"
            className="online-tryout-bench-toggle"
            aria-expanded={showBench}
            onClick={() => setShowBench(!showBench)}
          >
            控え {bench.length}人{showBench ? ' を閉じる' : ' を見る'}
          </button>
          {showBench && (
            <ol className="online-tryout-list online-tryout-bench" start={wanted.length + 1}>
              {bench.slice(0, 40).map((id) => (
                <li key={id}>
                  <span className="online-tryout-person">
                    <Line player={byId.get(id)} score={scores.get(id)} />
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => add(id, true)}
                  >
                    最優先へ
                  </button>
                </li>
              ))}
              {bench.length > 40 && (
                <li className="online-muted">
                  ほか{bench.length - 40}人（下の「候補を探す」から指名できます）
                </li>
              )}
            </ol>
          )}
        </section>

        <PoolWrap compact={compact} count={pool.length}>
        <section className="online-tryout-pool">
          {!compact && <h3>候補を探す（{pool.length}人）</h3>}
          <div className="online-segments" aria-label="守備位置">
            {POSITION_GROUPS.map((g) => (
              <button
                type="button"
                key={g.key}
                aria-pressed={group === g.key}
                onClick={() => {
                  setGroup(g.key);
                  setPage(0);
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
          <div className="online-tryout-tools">
            <label>
              並べ替え
              <select
                value={sortKey}
                onChange={(e) => {
                  setSortKey(e.target.value);
                  setPage(0);
                }}
              >
                <option value={WEIGHTED_SORT_KEY}>評価値（重み）</option>
                {SORT_KEYS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              名前
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </label>
          </div>
          <ul className="online-tryout-list">
            {shown.map((p) => (
              <li key={p.id} data-wanted={wantedSet.has(p.id) || undefined}>
                <span className="online-tryout-person">
                  <Line player={p} score={scores.get(p.id)} />
                </span>
                {wantedSet.has(p.id) ? (
                  <span className="online-tryout-mark">
                    {/* ⚠ 獲得予定の番号で出す。希望リスト全体の位置だと、
                        飛ばされた選手のぶん左の一覧の番号とずれる */}
                    指名中 {wanted.indexOf(p.id) + 1}位
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => add(p.id, true)}
                    >
                      最優先へ
                    </button>
                    <button
                      type="button"
                      disabled={busy || count === 0}
                      onClick={() => add(p.id, false)}
                    >
                      指名に加える
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {pool.length > limit && (
            <button
              type="button"
              className="online-more"
              onClick={() => setLimit(limit + PAGE * 2)}
            >
              もっと見る（残り{pool.length - limit}人）
            </button>
          )}
        </section>
        </PoolWrap>
      </div>
      {ranking !== null && wanted[ranking] && (
        <Sheet
          title={`${byId.get(wanted[ranking])?.name}の希望順位`}
          close={() => setRanking(null)}
        >
          <h3>何位にしますか（いま{ranking + 1}位）</h3>
          <div className="online-order-grid" role="group" aria-label="希望順位">
            {wanted.map((other, n) => (
              <button
                type="button"
                key={other}
                aria-pressed={n === ranking}
                aria-label={`${n + 1}位にする`}
                onClick={() => {
                  moveTo(ranking, n);
                  setRanking(null);
                }}
              >
                <b>{n + 1}</b>
                <small>{byId.get(other)?.name}</small>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
