import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { POS, POS_FULL } from './api.js';
import { turnLabel, CONVERT_POSITIONS } from './shared.js';
import { useActions } from './ActionContext.jsx';
import { PageNav } from './PageNav.jsx';
import PlayerDetailBody, { PlayerTags } from './PlayerDetailBody.jsx';
import { useRead } from './useRead.js';
import { inOnlineRoot } from './dialogPortal.js';
import { useTradeStart } from './tradeStart.js';
import { ownOutcome, teamShort, teamLabel } from './gameText.js';
import SplitStats from './SplitStats.jsx';
import BatteryStats from './BatteryStats.jsx';
import { phaseStatusLabel } from './notices.js';
import {
  getAbilityRank,
  getRankColor,
  normalizeAbility,
} from '../utils/constants.js';
import {
  STAT_GROUPS,
  overviewGroup,
  statGroup,
  formatStat,
  sortedRoster,
  defaultSort,
  CONDITION_TEXT,
  conditionValue,
  statRank,
  isCatchingGroup,
} from './statsView.js';
import { CONDITION_ICONS } from '../game/condition.js';

// 能力値1つ。⚠ **PCは数字をランク色で出す**（一人用の `AbilityValue` と同じ）。
//    以前はオンラインだけ「C」のような字だけで、移植したスタメン設定は数字、
//    選手の詳細も数字と、画面ごとに数字と字が混ざっていた。
//    スマホは列が狭いので字のまま（CSS で出し分ける。`.online-ability-num` / `-rank`）。
/**
 * 段位がFのときの色。
 *
 * ⚠ **F（40未満）に入る値が多すぎる**。初期メンバーセット480人の表示値を数えると
 *    F 44.8% / E 19.3% / D 17.0% / C 11.8% / B 5.7% / A 1.3% / S 0.0% で、
 *    7色のうち1色に4割が入っていた。「3」と「39」が同じ灰色では見比べられない
 *    （いしだ指摘: 視認性を高めるため相応の色付けを）。
 * ⚠ **S〜Eは触らない**。ほかの画面（一人用の `getRankColor`）と同じ色を保ち、
 *    広すぎるFの帯だけを3つに割る。低いほど沈むので、良い値が浮き上がる。
 */
const lowTone = (v) =>
  v >= 30 ? 'online-ability-f1' : v >= 20 ? 'online-ability-f2' : 'online-ability-f3';

export function AbilityGrade({ value, velocity = false, stamina = false }) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return <span>—</span>;
  const rank = getAbilityRank(value, velocity, stamina);
  const tone =
    rank === 'F'
      ? lowTone(normalizeAbility(value, velocity, stamina))
      : getRankColor(rank);
  return (
    <span
      className={`online-ability-grade ${tone}`}
      title={`${rank}（${Math.round(value)}）`}
    >
      <span className="online-ability-num">{Math.round(value)}</span>
      <span className="online-ability-rank">{rank}</span>
    </span>
  );
}

export function TeamBrief({ view }) {
  const next = view.upcoming.find(
    (game) => game.home === view.teamName || game.away === view.teamName,
  );
  const starter = view.roster.find(
    (player) => player.id === view.nextStarterId,
  );
  const last = [...view.results]
    .reverse()
    .find((game) => ownOutcome(game, view.teamName));
  const lastOutcome = last && ownOutcome(last, view.teamName);
  return (
    <section className="online-team-brief" aria-label="次の行動の確認">
      {view.phase ? (
        <p>
          {view.phase.label} ·{' '}
          {view.members
            .map(
              (member) =>
                // ⚠ 球団の表示名で出す。`member.label`（「プレイヤー1」）だと
                //    他の画面の球団名と混ざってどの球団か分からない
                `${teamLabel(member.teamName)} ${phaseStatusLabel(member)}`,
            )
            .join('／')}
        </p>
      ) : (
        <>
          {last && (
            <p>
              前回：{turnLabel(last.date)}{' '}
              <span className={`online-outcome is-${lastOutcome.tone}`}>
                {lastOutcome.mark}
              </span>{' '}
              {last.home === view.teamName
                ? `${last.homeScore}–${last.awayScore}`
                : `${last.awayScore}–${last.homeScore}`}{' '}
              対{' '}
              {teamShort(last.home === view.teamName ? last.away : last.home)}
            </p>
          )}
          <p>
            次の試合：
            {next
              ? `${turnLabel(next.date)} 対 ${teamShort(next.home === view.teamName ? next.away : next.home)}`
              : '予定なし'}
          </p>
          {starter && (
            <p>
              先発枠：
              <PlayerStatsButton player={starter} panel="abilities" />{' '}
              <ConditionMark player={starter} /> 疲労{starter.fatigue ?? '—'}
            </p>
          )}
        </>
      )}
    </section>
  );
}

const SHORT_LABELS = {
  average: 'アベヒ',
  power: 'パワヒ',
  'extra-base': '長打',
  eye: '選球眼',
  'on-base': '出塁',
  whiff: '扇風機',
  strikeout: '三振',
  'steal-good': '盗塁B',
  'steal-bad': '盗塁F',
  'pitch-k': '奪三振',
  'pitch-bb': '四球',
  control: '制球○',
  'pitch-hr': '一発',
  'chance-good': '好機B',
  'chance-bad': '好機F',
  'pinch-good': '対ピB',
  'pinch-bad': '対ピF',
  'left-good': '対左B',
  'left-bad': '対左F',
  'pinch-hit': '代打○',
  'first-pitch': '初球○',
  persistent: '粘り',
  'bunt-good': 'バン○',
  'bunt-bad': 'バン×',
  'double-play': '併殺',
  'start-good': '立上○',
  'start-bad': '出遅れ',
  'strong-finish': '尻上り',
  'multi-hit': '固打ち',
};

export function StatLabels({
  player,
  category = 'batting',
  limit = 3,
  compact = false,
}) {
  const labels = player?.performance?.[category]?.labels || [];
  return labels.length ? (
    <span className="online-stat-labels" aria-label="成績の特徴">
      {labels.slice(0, Math.min(limit, 3)).map((label) => (
        <span
          key={label.id}
          className={`online-stat-label online-stat-${label.tone === 'bad' ? 'bad' : 'good'}`}
          aria-label={label.text}
          title={label.text}
        >
          {compact ? SHORT_LABELS[label.id] || label.text : label.text}
        </span>
      ))}
    </span>
  ) : null;
}
function Category({ value, setValue }) {
  return (
    <div className="online-segments" aria-label="成績区分">
      {['batting', 'pitching'].map((id) => (
        <button
          key={id}
          aria-pressed={value === id}
          onClick={() => setValue(id)}
        >
          {id === 'batting' ? '打撃' : '投球'}
        </button>
      ))}
    </div>
  );
}
// 調子。⚠ **一人用と同じ顔の印にする**（`CONDITION_ICONS`）。
//    以前はオンラインの一覧が矢印、成績の表が「普通／不調」の文字、移植した
//    スタメン設定が顔で、同じ調子が画面ごとに3通りの見た目だった。
//    文字はマウスを乗せると出る（`title`）。
export function ConditionMark({ player }) {
  const level = conditionValue(player);
  const text = CONDITION_TEXT[level] || '未記録';
  return (
    <span
      className={`online-condition online-condition-${level ?? 'unknown'}`}
      title={`調子: ${text}`}
      aria-label={`調子: ${text}`}
      role="img"
    >
      {level === null ? '—' : CONDITION_ICONS[level]}
    </span>
  );
}
/**
 * 成績の表示区分。PCは**並んだタブ**（コンボボックスは開かないと何があるか
 * 分からず、隣の区分へ移るのに2手かかる、という指摘）。スマホは幅が無いので
 * コンボボックスのまま。
 * ⚠ 「調子・疲労」と能力の区分は、成績の区分と分けて右にまとめる。
 */
function GroupTabs({
  category,
  value,
  onChange,
  overview = false,
  historic = false,
}) {
  // ⚠ 過去の期間には調子・能力が残っていない（`GroupSelect` と同じ絞り方）
  const groups = STAT_GROUPS[category].filter(
    (group) =>
      !historic ||
      !['state', 'abilities', 'defense', 'catching', 'catchingAllowed'].includes(
        group.id,
      ),
  );
  const state = new Set(['state', 'abilities', 'defense']);
  const tab = (id, label) => (
    <button key={id} aria-pressed={value === id} onClick={() => onChange(id)}>
      {label}
    </button>
  );
  return (
    <div className="online-group-tabs" role="group" aria-label="成績の表示項目">
      <div className="online-segments">
        {overview && tab('overview', '主要成績')}
        {groups.filter((g) => !state.has(g.id)).map((g) => tab(g.id, g.label))}
      </div>
      <div className="online-segments">
        {groups.filter((g) => state.has(g.id)).map((g) => tab(g.id, g.label))}
      </div>
    </div>
  );
}
function GroupSelect({
  category,
  value,
  onChange,
  historic = false,
  overview = false,
}) {
  return (
    <select
      className="online-stat-group"
      aria-label="成績の表示項目"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {overview && <option value="overview">主要成績一覧</option>}
      {STAT_GROUPS[category]
        .filter(
          (group) =>
            !historic ||
            ![
              'state',
              'abilities',
              'defense',
              'catching',
              'catchingAllowed',
            ].includes(group.id),
        )
        .map((group) => (
          <option key={group.id} value={group.id}>
            {group.label}
          </option>
        ))}
    </select>
  );
}
function Approximation({ columns, precise = false }) {
  return !precise && columns.some((column) => column.approximate) ? (
    <small className="online-stat-note">※ 出塁率・OPS・打席関連は概算</small>
  ) : null;
}
/**
 * 守備位置の登録を変える（コンバート）。
 *
 * ⚠ **自球団の選手だけに出す**。他球団の登録は変えられない（サーバーも弾く）。
 * ⚠ **何が起きるかを先に書く**。押すと打順と投手起用が組み直されるので、
 *    知らずに押すと「設定が消えた」と見える。
 * ⚠ 新しい位置の適性（`positionFitness`）は**上げない**。下手なまま守るのが
 *    コンバートで、守備適性の列にそのまま出る。
 */
function ConvertPosition({ player }) {
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(player.position);
  const [error, setError] = useState('');
  // ⚠ 包まれていないところ（検査の fixture など）では出さない
  if (!actions?.command) return null;
  const fitness = (pos) => player.positionFitness?.[pos];
  // ⚠ `run` は**例外を投げない**（`{ ok, error }` を返す）。`catch` で受けると
  //    断られたことに気づかず、成功したように閉じてしまう
  const submit = async () => {
    const result = await actions.run(() =>
      actions.command('convert', { playerId: player.id, position: choice }),
    );
    if (result?.ok) setOpen(false);
    else setError(result?.error || '守備位置を変えられませんでした');
  };
  return (
    <div className="online-convert">
      <p>
        いまの登録: <b>{POS_FULL[player.position] || player.position}</b>
        <button
          disabled={actions.busy || !actions.writable}
          aria-expanded={open}
          onClick={() => {
            setChoice(player.position);
            setError('');
            setOpen(!open);
          }}
        >
          {open ? 'やめる' : '守備位置を変える'}
        </button>
      </p>
      {open && (
        <>
          <p className="online-muted">
            登録を変えると<strong>打順と投手起用が組み直されます</strong>。
            能力は変わらないので、慣れない位置の守備適性は低いままです。
          </p>
          <div className="online-segments" role="group" aria-label="新しい守備位置">
            {CONVERT_POSITIONS.map((pos) => (
              <button
                key={pos}
                aria-pressed={choice === pos}
                disabled={actions.busy}
                onClick={() => setChoice(pos)}
              >
                {POS_FULL[pos]}
                {Number.isFinite(fitness(pos)) && <small>{fitness(pos)}%</small>}
              </button>
            ))}
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="online-actions">
            <button
              className="online-primary"
              disabled={
                actions.busy || !actions.writable || choice === player.position
              }
              onClick={submit}
            >
              {POS_FULL[choice]}へ変える
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Detail({ player, close }) {
  const dialog = useRef(null);
  const [periodId, setPeriodId] = useState('current');
  const [splits, setSplits] = useState(false);
  const [battery, setBattery] = useState(false);
  const [splitCategory, setSplitCategory] = useState(
    player.position === 'pitcher' ? 'pitching' : 'batting',
  );
  const info = useRead(player.detailAvailable ? 'player' : null, {
    id: player.id,
  });
  // ⚠ **他球団の選手にも過去の年と通算を出すこと**。以前は今季だけを組み立てて
  //    いて、CPU球団の選手を開くと「成績が残っていない」ように見えた。
  //    自球団は `action=player`（場面別まで）、他球団は球団ごとの読み込みに
  //    載った `periods`（場面別は外してある）を使う。
  const periods = info.data?.periods || player.periods || null;
  const found = periods?.find((p) => p.id === periodId) || periods?.[0] || null;
  // ⚠ 今季の場面別は `publicSplits` に別に載っている（期間からは外してある）。
  //    重ねないと、他球団の選手で「場面別の成績を見る」が空になる
  const period =
    found && found.id === 'current' && !found.splits && player.publicSplits
      ? { ...found, splits: player.publicSplits }
      : found ||
        (player.publicOnly
          ? {
              id: 'current',
              label: '今季',
              source: player.publicSource,
              seasonStats: player.seasonStats,
              performance: player.performance,
              splits: player.publicSplits,
              partial: player.publicPartial,
            }
          : null);
  const shown = period
    ? {
        ...player,
        seasonStats: period.seasonStats,
        performance: period.performance,
      }
    : player;
  useEffect(() => {
    const node = dialog.current;
    const trigger = document.activeElement;
    node.showModal();
    return () => {
      if (node.open) node.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  const dismiss = () => {
    dialog.current.close();
    close();
  };
  const startTrade = useTradeStart();
  // ⚠ 表のセル（キャンプの表など）の中から開くので、`.online` の直下へ出す
  //    （`dialogPortal.js`）。セルの `white-space: nowrap` が説明まで当たっていた
  return inOnlineRoot(
    <dialog
      ref={dialog}
      className="online-player-dialog"
      aria-labelledby="online-player-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) dismiss();
      }}
    >
      <header>
        <div>
          <h2 id="online-player-title">{player.name}</h2>
          {/* ⚠ 札は**1行にまとめる**。守備位置・年齢・背番号・利き手・体格・
              出身。調子と疲労は今季のときだけ（過去の期間では今の調子は無関係） */}
          <small>
            <PlayerTags player={player} />
            {periodId === 'current' && (
              <>
                {' · '}
                <ConditionMark player={player} />
                {CONDITION_TEXT[conditionValue(player)] || '調子未記録'} · 疲労
                {player.fatigue ?? '—'}
              </>
            )}
          </small>
        </div>
        <button onClick={dismiss} aria-label="選手成績を閉じる">
          閉じる
        </button>
      </header>
      {/* ⚠ **自球団の選手だけ**（`detailAvailable`）。他球団の登録は変えられない */}
      {player.detailAvailable && <ConvertPosition player={player} />}
      {/* 他球団の選手から、そのままトレードを考える（アプリの選手シートと同じ入口）。
          ⚠ PCの選手成績の他球団だけ（`tradeTeam` が付いている）。閉じてからトレードへ移る */}
      {startTrade && player.tradeTeam && (
        <div className="online-actions">
          <button
            type="button"
            onClick={() => {
              dismiss();
              startTrade(player.tradeTeam, player);
            }}
          >
            この選手でトレードを考える（{teamShort(player.tradeTeam)}）
          </button>
        </div>
      )}
      {/* ⚠ **タブで分けない**。以前は「成績／能力・人物／場面別」の3タブ＋
          その中でさらに区分の切り替えがあり、1人を見るのに何度も押していた。
          見たいもの（札と経歴・成績・能力）は一度に出す。 */}
      {periods?.length > 1 && (
        <select
          aria-label="成績の期間"
          value={period?.id || 'current'}
          onChange={(e) => setPeriodId(e.target.value)}
        >
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      )}
      {info.error && (
        <div role="alert">
          {info.error}
          <button onClick={info.retry}>選手記録を再取得</button>
        </div>
      )}
      <PlayerDetailBody
        player={player}
        shown={shown}
        periodLabel={period?.label || '今季'}
      />
      {/* ⚠ 場面別だけは**任意で開く**。打者×投手の組み合わせで行数が多く、
          1画面には入らない。上の3つ（札と経歴・成績・能力）は常に見える */}
      <div className="online-actions">
        <button onClick={() => setSplits(!splits)} aria-expanded={splits}>
          {splits ? '場面別の成績を閉じる' : '場面別の成績を見る'}
        </button>
        {/* 投手×捕手の組み合わせ。⚠ 自球団の選手だけ（`action=player` の期間に載る。
            球団ごとの索引には大きいので載せていない） */}
        {period?.battery && (
          <button onClick={() => setBattery(!battery)} aria-expanded={battery}>
            {battery
              ? 'バッテリーの成績を閉じる'
              : period.battery.caught
                ? '受けた投手ごとの成績を見る'
                : '組んだ捕手ごとの成績を見る'}
          </button>
        )}
      </div>
      {splits && (
        <section className="online-detail-section">
          <Category value={splitCategory} setValue={setSplitCategory} />
          {info.loading ? (
            <p>記録を読み込んでいます…</p>
          ) : (
            <SplitStats period={period} category={splitCategory} />
          )}
        </section>
      )}
      {battery && period?.battery && (
        <section className="online-detail-section online-battery">
          <BatteryStats battery={period.battery} />
        </section>
      )}
    </dialog>,
  );
}
export function PlayerStatsButton({
  player,
  category = 'batting',
  group = 'basic',
  panel = 'stats',
  children,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  if (!player) return null;
  return (
    <>
      <button
        className={`online-player-name ${className}`}
        onClick={() => setOpen(true)}
        aria-label={`${player.name}の選手情報を見る`}
      >
        {children || player.name}
      </button>
      {open && (
        <Detail
          player={player}
          initialCategory={category}
          initialGroup={group}
          initialPane={panel}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * 球団と id だけ分かっている選手（個人成績ランキング・能力ランキング・スタメンの表など）の
 * 選手情報を開くボタン。押してから球団の名簿を読み（自球団は手元の view）、
 * 選手成績の名前を押したときと同じ小窓を開く。
 * ⚠ **id で探す**（名前で探すと、同じ球団の同名の別人に当たる。アプリの `findRosterPlayer` と同じ）。
 * ⚠ 読み込みは `TeamRoster` と同じ問い合わせ（球団名＋版）にして、読んだ名簿を使い回す。
 * ⚠ 以前はランキングの名前が押せなかった（先方要望 2026-11 で直した）。能力ランキングは
 *    行に載せた一部の能力だけで小窓を開いていたので、ここでも名簿の全項目で開く。
 */
export function TeamPlayerButton({
  view,
  team,
  id,
  name,
  panel = 'stats',
  className = '',
  children,
}) {
  const [open, setOpen] = useState(false);
  const own = team === view.teamName;
  // ⚠ 版が上がって読み直す間も前の名簿を残す（`keep`）。残さないと開いている小窓が閉じて開き直り、
  //    スタメンの小窓から開いた選手の小窓は閉じたままになっていた
  const result = useRead(
    open && !own ? 'team' : null,
    { team, revision: view.revision },
    { keep: true },
  );
  const roster = own
    ? view.roster
    : result.data?.teamName === team
      ? result.data.roster
      : null;
  const found =
    open && roster
      ? roster.find((p) => String(p.id) === String(id)) ||
        (id == null ? roster.find((p) => p.name === name) : null)
      : null;
  const player =
    found && !own && !found.tradeTeam ? { ...found, tradeTeam: team } : found;
  return (
    <>
      <button
        type="button"
        className={`online-player-name ${className}`}
        onClick={() => setOpen(true)}
        aria-label={`${name}の選手情報を見る`}
        aria-busy={open && !roster && !result.error ? true : undefined}
      >
        {children || name}
      </button>
      {open && !roster && !result.error && (
        <small className="online-muted"> 読み込み中…</small>
      )}
      {open && result.error && (
        <small role="alert">
          {' '}
          {result.error}
          <button type="button" onClick={result.retry}>
            再取得
          </button>
        </small>
      )}
      {open && roster && !player && (
        <small role="alert"> いまこの球団の名簿にいません</small>
      )}
      {player && (
        <Detail
          player={player}
          initialPane={panel}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

// 起用の札（自球団だけ）。
// ⚠ **「スタメンが誰か」「誰がリリーフか」が一覧から分からない**という指摘への対応。
//    打順と投手の役割は view に載っているので、名前の横に短く出す。
//    他球団の閲覧（`readOnly`）には編成が載らないので何も出さない。
const ROLE_SHORT = {
  ace: '先発', complete: '先発', quality: '先発', short: '先発', opener: '先発', auto_s: '先発',
  long: 'ロング', ace_relief: '中継', setup: 'セット', closer: '抑え',
  onepoint: 'ワンP', behind: 'ビハ', mopup: '敗戦',
};
/**
 * 起用の順に並べる（スタメン → 控え野手 → 先発ローテ → リリーフ）。
 * ⚠ 名簿の順（ドラフト順）のままだと**1ページ目が投手だけ**になり、
 *    スタメンが3ページ目まで出てこない。実測でそうなっていた。
 * ⚠ 編成が分からない他球団（`readOnly`）は元の順のまま。
 */
// `category` が 'pitching' のときは投手を先に並べる（先発→救援→スタメン→控え）。
// ⚠ 「投球」に切り替えても野手が先だと、投手の成績が3ページ目まで出てこなかった
export function rosterByRole(roster, lineup, category = 'batting') {
  if (!lineup) return roster;
  const slot = new Map(
    (lineup.battingOrder || []).map((e) => [e.playerId, e.battingOrder]),
  );
  const rotation = new Map((lineup.starters || []).map((id, i) => [id, i]));
  const pitchingFirst = category === 'pitching';
  const rank = (p) => {
    if (slot.has(p.id)) return [pitchingFirst ? 2 : 0, slot.get(p.id)];
    if (rotation.has(p.id)) return [pitchingFirst ? 0 : 2, rotation.get(p.id)];
    if (p.position === 'pitcher') return [pitchingFirst ? 1 : 3, 0];
    return [pitchingFirst ? 3 : 1, 0];
  };
  return roster
    .map((player, index) => ({ player, index, key: rank(player) }))
    .sort(
      (a, b) =>
        a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.index - b.index,
    )
    .map((e) => e.player);
}

export function RoleMark({ player, lineup }) {
  if (!lineup) return null;
  if (player.position === 'pitcher') {
    const starter = lineup.starters?.indexOf(player.id) ?? -1;
    if (starter >= 0)
      return <span className="online-role-mark is-starter">先発{starter + 1}</span>;
    const role = lineup.pitcherRoles?.[player.id];
    const label = ROLE_SHORT[role];
    return label ? <span className="online-role-mark">{label}</span> : null;
  }
  const slot = lineup.battingOrder?.find((e) => e.playerId === player.id);
  return slot ? (
    <span className="online-role-mark is-starter">{slot.battingOrder}番</span>
  ) : (
    <span className="online-role-mark is-bench">控え</span>
  );
}

/**
 * 名簿の表（選手成績・通算成績で共通）。
 * ⚠ `periodLabel` は見出しの脇に出す期間の名前。**合計の出し方は呼ぶ側が決める**
 *    （通算は `careerTotals` が出した値を `seasonStats` に差し替えて渡す）。
 */
export function CompactRoster({
  view,
  desktop = false,
  teamSelector,
  periodLabel = '今季',
  title = '選手成績',
  volumeOrder = false,
}) {
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState('batting');
  const [groupId, setGroupId] = useState(desktop ? 'overview' : 'basic');
  const [sort, setSort] = useState(null);
  const group =
    desktop && groupId === 'overview'
      ? overviewGroup(category)
      : statGroup(category, groupId);
  // ⚠ 指定が無いときの並び。スマホは**出場量の多い順**（名簿の順のままだと、
  //    打撃の1ページ目が投手だけで埋まり、スタメンが3ページ目まで出てこない）。
  //    PCは全員を1枚に出すので**起用の順**（スタメン→控え→先発→救援）。
  //    能力一覧の表がこの順だったので、表を1つにしても並びは変わらない。
  // ⚠ `volumeOrder` は**起用の順を使えない画面**のため（通算成績）。打順や
  //    投手の役割は「いまの起用」なので、何年ぶんの合計を並べる順にはならない
  // ⚠ 捕手の区分は**受けた選手と捕手だけ**を、守った回の多い順に出す。
  //    全員を並べると「—」の行ばかりで、正捕手と控えの差が見えない
  const catching = isCatchingGroup(group.id);
  const roster = catching
    ? view.roster.filter((p) => p.catcherStats || p.position === 'catcher')
    : view.roster;
  const chosen =
    sort || (desktop && !volumeOrder ? null : defaultSort(category));
  // PCは区分を変えても並びを残すが、打撃の列（打率など）で並べたまま捕手の区分へ
  // 来ても意味が無いので、捕手の区分では捕手の列か名前のときだけ従う
  const catchingColumns = STAT_GROUPS.batting
    .filter((g) => isCatchingGroup(g.id))
    .flatMap((g) => g.columns);
  const active =
    catching &&
    (!chosen ||
      (chosen.column !== 'name' &&
        !catchingColumns.some((c) => c.id === chosen.column.id)))
      ? { column: catchingColumns[0], direction: 'desc' }
      : chosen;
  const order = active
    ? sortedRoster(roster, active.column, active.direction)
    : rosterByRole(roster, view.lineup, category);
  const chooseCategory = (next) => {
    setCategory(next);
    setGroupId(desktop ? 'overview' : 'basic');
    setSort(null);
    setPage(0);
  };
  // ⚠ PCは**区分を変えても並びを保つ**。「今の表のメンバーのまま成績と能力を
  //    切り替えたい」という指摘。並べ替えた列が次の区分に無くても、並びは残す
  const chooseGroup = (next) => {
    setGroupId(next);
    if (!desktop) setSort(null);
    setPage(0);
  };
  // ⚠ 同じ列かは**id で比べる**（`sameColumn`）。PCは区分を変えても並びを残すが、
  //    本塁打・試合数などは区分ごとに別の列として定義されているため、
  //    物で比べると見出しは▼なのに押しても逆順にならなかった
  const sortBy = (column) => {
    setSort((old) => ({
      column,
      direction:
        old?.column && sameColumn(old.column, column)
          ? old.direction === 'asc'
            ? 'desc'
            : 'asc'
          : column === 'name'
            ? 'asc'
            : column.direction,
    }));
    setPage(0);
  };
  const sameColumn = (a, b) =>
    a === b || (a && b && a !== 'name' && b !== 'name' && a.id === b.id);
  const sortButton = (column, label) => (
    <button
      aria-label={`${label}で並べ替え`}
      aria-pressed={!!active && sameColumn(active.column, column)}
      title={label}
      onClick={() => sortBy(column)}
    >
      <span>
        {label === '被本塁打'
          ? '被本'
          : label === '本塁打率'
            ? '本塁率'
            : label}
      </span>
      {active && sameColumn(active.column, column) && (
        <span className="online-sort-direction" aria-hidden="true">
          {active.direction === 'asc' ? '▲' : '▼'}
        </span>
      )}
    </button>
  );
  const [size, setSize] = useState(8);
  const rows = useRef(null);
  const previousSize = useRef(8);
  useLayoutEffect(() => {
    if (desktop) return;
    const measure = () => {
      if (!rows.current) return;
      const next = Math.max(1, Math.floor(rows.current.clientHeight / 44));
      const old = previousSize.current;
      if (next === old) return;
      previousSize.current = next;
      setPage((p) => Math.floor((p * old) / next));
      setSize(next);
    };
    measure();
    const observer = new window.ResizeObserver(measure);
    observer.observe(rows.current);
    return () => observer.disconnect();
  }, [desktop]);
  // ⚠ PCは**ページ送りをしない**（全員を1枚に）。24〜30人なら1画面で見渡せ、
  //    送るたびに見出しの位置を探し直すほうが手間だった
  const shown = desktop
    ? order
    : order.slice(page * size, page * size + size);
  const sortedBy =
    active && (active.column === 'name' ? '選手名' : active.column.label);
  return (
    <section
      data-wide={desktop && group.columns.length > 4}
      className={`${desktop ? '' : 'online-card '}online-compact-roster`}
    >
      <div className="online-roster-toolbar">
        <div>
          {teamSelector || <h2>{title}</h2>}
          <small>
            {view.readOnly ? `${periodLabel}・閲覧` : periodLabel} ·{' '}
            {view.roster.length}人
          </small>
        </div>
        {desktop ? (
          <>
            <Category value={category} setValue={chooseCategory} />
            <GroupTabs
              category={category}
              value={group.id}
              onChange={chooseGroup}
              overview
            />
          </>
        ) : (
          <>
            <GroupSelect
              category={category}
              value={group.id}
              onChange={chooseGroup}
            />
            <Category value={category} setValue={chooseCategory} />
          </>
        )}
      </div>
      {desktop && (
        <p className="online-roster-order">
          並び：
          {active
            ? `${sortedBy}${active.direction === 'asc' ? '（小さい順）' : '（大きい順）'}`
            : '起用の順'}
          {active && !volumeOrder && (
            <button onClick={() => setSort(null)}>起用の順に戻す</button>
          )}
        </p>
      )}
      <div className="online-roster-columns">
        {sortButton('name', '選手名')}
        <div className="online-roster-values">
          {group.columns.map((column) => (
            <React.Fragment key={column.id}>
              {sortButton(column, column.label)}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="online-roster-rows" ref={rows}>
        {/* ⚠ **空のまま出さない**。捕手の区分は受けた選手と捕手だけに絞るので
            （`isCatchingGroup`）、まだ誰も受けていない時期は一覧が空になる。
            何も出さないと「読み込めていないのか、記録が無いのか」が分からない */}
        {!shown.length && (
          <p className="online-muted online-roster-empty">
            {catching
              ? 'まだ捕手の記録がありません。試合が進むと出ます。'
              : '出す選手がいません。'}
          </p>
        )}
        {shown.map((player) => (
          <article key={player.id}>
            <PlayerStatsButton
              player={player}
              category={category}
              group={group.id}
              className="online-roster-row"
            >
              <span className="online-roster-person">
                <span className="online-roster-name">
                  <span className="online-roster-player-name">
                    {player.name}
                  </span>
                  <ConditionMark player={player} />
                  <small>{POS[player.position]}</small>
                  <RoleMark player={player} lineup={view.lineup} />
                </span>
                <StatLabels
                  player={player}
                  category={category}
                  compact={!desktop}
                />
              </span>
              <span className="online-roster-values">
                {group.columns.map((column) => {
                  const value = column.get(player);
                  if (column.format === 'condition')
                    return (
                      <span key={column.id} className="online-stat-condition">
                        <ConditionMark player={player} />
                      </span>
                    );
                  const text = formatStat(column, value, desktop);
                  const rank = statRank(column, value);
                  return (
                    <span
                      key={column.id}
                      className={`online-stat-${column.format} ${rank ? `online-ability-grade ${getRankColor(rank)}` : ''}`}
                      style={
                        !desktop && text.length > 5
                          ? { fontSize: `${60 / text.length}px` }
                          : undefined
                      }
                      title={`${column.label}: ${text}${rank && desktop ? `（${rank}）` : ''}`}
                    >
                      {text}
                    </span>
                  );
                })}
              </span>
            </PlayerStatsButton>
          </article>
        ))}
      </div>
      {catching ? (
        <small className="online-stat-note">
          ※ マスクをかぶった時の投手成績（記録を取り始めた後の試合だけ）。読まれ率は、打者に狙い球を当てられた球の割合で、低いほどリードが効いています
        </small>
      ) : (
        <Approximation
          columns={group.columns}
          precise={view.roster.every((p) => p.seasonStats?.batting?.measured)}
        />
      )}
      {!desktop && (
        <PageNav
          page={page}
          count={order.length}
          size={size}
          setPage={setPage}
        />
      )}
    </section>
  );
}
