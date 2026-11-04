import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { POS } from './api.js';
import { formatGameDate } from './shared.js';
import { PageNav } from './PageNav.jsx';
import PlayerAbilities from './PlayerAbilities.jsx';
import { useRead } from './useRead.js';
import { useMobile } from './useMobile.js';
import { ownOutcome, teamShort, teamLabel } from './gameText.js';
import SplitStats from './SplitStats.jsx';
import { getAbilityRank, getRankColor } from '../utils/constants.js';
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
} from './statsView.js';
import { CONDITION_ICONS } from '../game/condition.js';

// 能力値1つ。⚠ **PCは数字をランク色で出す**（一人用の `AbilityValue` と同じ）。
//    以前はオンラインだけ「C」のような字だけで、移植したスタメン設定は数字、
//    選手の詳細も数字と、画面ごとに数字と字が混ざっていた。
//    スマホは列が狭いので字のまま（CSS で出し分ける。`.online-ability-num` / `-rank`）。
export function AbilityGrade({ value, velocity = false, stamina = false }) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return <span>—</span>;
  const rank = getAbilityRank(value, velocity, stamina);
  return (
    <span
      className={`online-ability-grade ${getRankColor(rank)}`}
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
                `${teamLabel(member.teamName)} ${member.ready ? '決定済み' : '検討中'}`,
            )
            .join('／')}
        </p>
      ) : (
        <>
          {last && (
            <p>
              前回：{last.date.month}/{last.date.day}{' '}
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
              ? `${formatGameDate(next.date)} 対 ${teamShort(next.home === view.teamName ? next.away : next.home)}`
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
      !historic || !['state', 'abilities', 'defense'].includes(group.id),
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
            !historic || !['state', 'abilities', 'defense'].includes(group.id),
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
function Detail({ player, initialCategory, initialGroup, initialPane, close }) {
  const mobile = useMobile();
  const dialog = useRef(null);
  const [category, setCategory] = useState(initialCategory);
  const [groupId, setGroupId] = useState(initialGroup);
  const [pane, setPane] = useState(initialPane);
  const [periodId, setPeriodId] = useState('current');
  const info = useRead(player.detailAvailable ? 'player' : null, {
    id: player.id,
  });
  const period =
    info.data?.periods.find((p) => p.id === periodId) ||
    info.data?.periods[0] ||
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
  const group = statGroup(category, groupId);
  return (
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
          <small>
            {pane === 'abilities' ? '現在' : period?.label || '今季'} ·{' '}
            {POS[player.position]} ·{' '}
            {(pane === 'abilities' || periodId === 'current') && (
              <>
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
      <nav className="online-player-tabs" aria-label="選手情報の種類">
        <button
          aria-pressed={pane === 'stats'}
          onClick={() => setPane('stats')}
        >
          成績
        </button>
        <button
          aria-pressed={pane === 'abilities'}
          onClick={() => setPane('abilities')}
        >
          能力・人物
        </button>
        <button
          aria-pressed={pane === 'splits'}
          onClick={() => setPane('splits')}
        >
          場面別
        </button>
      </nav>
      {pane !== 'abilities' && (
        <>
          {info.data?.periods.length > 1 && (
            <select
              aria-label="成績の期間"
              value={period?.id || 'current'}
              onChange={(e) => {
                setPeriodId(e.target.value);
                setGroupId('basic');
              }}
            >
              {info.data.periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          {period && (
            <small className="online-stat-note">
              {period.source}
              {period.partial ? '・記録開始後の場面集計' : ''}
              {period.splits ? '／打撃の試合数は完了打席のある試合' : ''}
            </small>
          )}
          {info.error && (
            <div role="alert">
              {info.error}
              <button onClick={info.retry}>選手記録を再取得</button>
            </div>
          )}
        </>
      )}
      {pane === 'stats' ? (
        <>
          <div className="online-stat-tools">
            <Category
              value={category}
              setValue={(next) => {
                setCategory(next);
                setGroupId('basic');
              }}
            />
            {/* ⚠ PCはタブ、スマホはコンボボックス（幅）。
                ⚠ 両方置いて CSS で隠すと、同じ名前の操作が2つになる（検査も読み上げも迷う） */}
            {!mobile ? (
              <GroupTabs
                category={category}
                value={group.id}
                onChange={setGroupId}
                historic={periodId !== 'current'}
              />
            ) : (
              <GroupSelect
                category={category}
                value={group.id}
                onChange={setGroupId}
                historic={periodId !== 'current'}
              />
            )}
          </div>
          <StatLabels player={shown} category={category} />
          <dl className="online-stat-grid">
            {group.columns.map((column) => (
              <div key={column.id}>
                <dt>
                  {column.label}
                  {column.approximate && !shown.seasonStats?.batting?.measured
                    ? '※'
                    : ''}
                </dt>
                <dd>{formatStat(column, column.get(shown), true)}</dd>
              </div>
            ))}
          </dl>
          <Approximation
            columns={group.columns}
            precise={!!shown.seasonStats?.batting?.measured}
          />
        </>
      ) : pane === 'splits' ? (
        <>
          <Category value={category} setValue={setCategory} />
          <StatLabels player={shown} category={category} />
          {info.loading ? (
            <p>記録を読み込んでいます…</p>
          ) : (
            <SplitStats period={period} category={category} />
          )}
        </>
      ) : (
        <PlayerAbilities player={player} />
      )}
    </dialog>
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

// `initialCategory`: 最初に開く区分（打撃/投球）。編成ページの横の表は、
// 投手起用なら投球から見せる
export function CompactRoster({
  view,
  desktop = false,
  teamSelector,
  initialCategory = 'batting',
}) {
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState(initialCategory);
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
  const active = sort || (desktop ? null : defaultSort(category));
  const order = active
    ? sortedRoster(view.roster, active.column, active.direction)
    : rosterByRole(view.roster, view.lineup, category);
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
          {teamSelector || <h2>選手成績</h2>}
          <small>
            {view.readOnly ? '今季・閲覧' : '今季'} · {view.roster.length}人
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
          {active && (
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
      <Approximation
        columns={group.columns}
        precise={view.roster.every((p) => p.seasonStats?.batting?.measured)}
      />
      {!desktop && (
        <PageNav
          page={page}
          count={view.roster.length}
          size={size}
          setPage={setPage}
        />
      )}
    </section>
  );
}
