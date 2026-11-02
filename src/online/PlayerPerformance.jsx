import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { POS } from './api.js';
import { formatGameDate } from './shared.js';
import { PageNav } from './PageNav.jsx';
import { inOnlineRoot } from './portal.js';
import PlayerAbilities from './PlayerAbilities.jsx';
import { useRead } from './useRead.js';
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

export function AbilityGrade({ value, velocity = false, stamina = false }) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return <span>—</span>;
  const rank = getAbilityRank(value, velocity, stamina);
  return (
    <span className={`online-ability-grade ${getRankColor(rank)}`}>{rank}</span>
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
export function ConditionMark({ player }) {
  const level = conditionValue(player);
  return (
    <span
      className={`online-condition online-condition-${level ?? 'unknown'}`}
      title={`調子: ${CONDITION_TEXT[level] || '未記録'}`}
      aria-label={`調子: ${CONDITION_TEXT[level] || '未記録'}`}
    >
      {level === null ? '—' : ['↓', '↘', '→', '↗', '↑'][level]}
    </span>
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
            <GroupSelect
              category={category}
              value={group.id}
              onChange={setGroupId}
              historic={periodId !== 'current'}
            />
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

export function CompactRoster({ view, desktop = false, teamSelector }) {
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState('batting');
  const [groupId, setGroupId] = useState(desktop ? 'overview' : 'basic');
  const [sort, setSort] = useState(null);
  const group =
    desktop && groupId === 'overview'
      ? overviewGroup(category)
      : statGroup(category, groupId);
  // ⚠ 指定が無いときは**出場量の多い順**。名簿の順のままだと、打撃の
  //    1ページ目が投手だけで埋まり、スタメンが3ページ目まで出てこない
  const active = sort || defaultSort(category);
  const order = sortedRoster(view.roster, active.column, active.direction);
  const chooseCategory = (next) => {
    setCategory(next);
    setGroupId(desktop ? 'overview' : 'basic');
    setSort(null);
    setPage(0);
  };
  const chooseGroup = (next) => {
    setGroupId(next);
    setSort(null);
    setPage(0);
  };
  const sortBy = (column) => {
    setSort((old) => ({
      column,
      direction:
        old?.column === column
          ? old.direction === 'asc'
            ? 'desc'
            : 'asc'
          : column === 'name'
            ? 'asc'
            : column.direction,
    }));
    setPage(0);
  };
  const sortButton = (column, label) => (
    <button
      aria-label={`${label}で並べ替え`}
      aria-pressed={active.column === column}
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
      {active.column === column && (
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
    if (desktop) {
      setSize(10);
      return;
    }
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
        <GroupSelect
          category={category}
          value={group.id}
          onChange={chooseGroup}
          overview={desktop}
        />
        <Category value={category} setValue={chooseCategory} />
      </div>
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
        {order.slice(page * size, page * size + size).map((player) => (
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
                  const text = formatStat(column, value);
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
                      title={`${column.label}: ${text}`}
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
      <PageNav
        page={page}
        count={view.roster.length}
        size={size}
        setPage={setPage}
      />
    </section>
  );
}
