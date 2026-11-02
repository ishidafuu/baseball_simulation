import React, { useContext, useEffect, useRef, useState } from 'react';
import { POS } from './api.js';
import { inOnlineRoot } from './portal.js';
import { FatigueMark, Segmented, useAppNav } from './ui.jsx';
import PlayerAbilities from './PlayerAbilities.jsx';
import { ReadContext, useRead } from './useRead.js';
import SplitStats from './SplitStats.jsx';
import { getAbilityRank, getRankColor } from '../utils/constants.js';
import { AbilityRadar, playerRadarAxes } from '../components/AbilityRadar.jsx';
import {
  STAT_GROUPS,
  overviewGroup,
  statGroup,
  formatStat,
  sortedRoster,
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
function Approximation({ columns, precise = false }) {
  return !precise && columns.some((column) => column.approximate) ? (
    <small className="online-stat-note">※ 出塁率・OPS・打席関連は概算</small>
  ) : null;
}
function Detail({ player: opened, list, initialCategory, initialGroup, initialPane, close }) {
  const dialog = useRef(null);
  // ⚠ 一覧から開いたら、閉じずに前後の選手へ移れる（以前は閉じて開き直していた）
  const [index, setIndex] = useState(() =>
    list ? list.findIndex((p) => p.id === opened.id) : -1,
  );
  const player = index >= 0 ? list[index] : opened;
  const canMove = index >= 0 && list.length > 1;
  const step = (delta) => {
    if (!canMove) return;
    setIndex((i) => Math.min(list.length - 1, Math.max(0, i + delta)));
  };
  const swipe = useRef(null);
  const nav = useAppNav();
  const own = nav.view?.roster?.some((p) => p.id === player.id) && !player.publicOnly;
  // ⚠ 試合結果などの上に重ねて開いたときは「編成で起用を変える」を出さない。
  //    下の画面（試合結果）が開いたまま編成へ移ってしまう
  const [nested] = useState(() => document.querySelectorAll('dialog[open]').length > 0);
  const [category, setCategory] = useState(initialCategory);
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
  const overview = overviewGroup(category);
  // ⚠ **全画面で縦に並べる**（スマホ）。以前はタブ（成績/能力・人物/場面別）→
  //    「見る能力」セレクト→数値の3段で、下半分のシートに6項目しか見えなかった。
  //    上に主要能力のレーダー、下に今季成績・能力すべて・場面別をスクロールで見せる
  return inOnlineRoot(
    <dialog
      ref={dialog}
      className="online-player-dialog online-player-sheet"
      aria-labelledby="online-player-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) dismiss();
      }}
      onKeyDown={(event) => {
        if (event.target.closest?.('select, input')) return;
        if (event.key === 'ArrowLeft') step(-1);
        if (event.key === 'ArrowRight') step(1);
      }}
      onTouchStart={(event) => {
        const t = event.touches[0];
        swipe.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(event) => {
        const start = swipe.current;
        swipe.current = null;
        const t = event.changedTouches[0];
        if (!start || !t) return;
        const dx = t.clientX - start.x;
        if (Math.abs(dx) > 70 && Math.abs(t.clientY - start.y) < 40) step(dx < 0 ? 1 : -1);
      }}
    >
      <header>
        {canMove && (
          <button
            className="online-icon-button"
            aria-label="前の選手"
            disabled={index <= 0}
            onClick={() => step(-1)}
          >
            ‹
          </button>
        )}
        <div>
          <h2 id="online-player-title">{player.name}</h2>
          <small>
            {POS[player.position]}
            {player.age ? ` · ${player.age}歳` : ''} ·{' '}
            <ConditionMark player={player} />
            {CONDITION_TEXT[conditionValue(player)] || '調子未記録'} ·{' '}
            <FatigueMark player={player} />
            {own && (
              <>
                {' · '}
                <RoleMark player={player} lineup={nav.view.lineup} />
              </>
            )}
          </small>
          {own && nav.go && !nested && (
            <button
              className="online-link"
              onClick={() => {
                dismiss();
                nav.go('lineup');
              }}
            >
              編成で起用を変える
            </button>
          )}
        </div>
        {canMove && (
          <button
            className="online-icon-button"
            aria-label="次の選手"
            disabled={index >= list.length - 1}
            onClick={() => step(1)}
          >
            ›
          </button>
        )}
        <button
          className="online-icon-button"
          onClick={dismiss}
          aria-label="選手成績を閉じる"
        >
          ×
        </button>
      </header>
      <div className="online-player-body">
        <section className="online-player-top">
          <AbilityRadar axes={playerRadarAxes(player)} size={180} />
          <StatLabels player={shown} category={category} />
        </section>
        <section id={`player-${initialPane}`}>
          <div className="online-card-heading">
            <h3>{period?.label || '今季'}の成績</h3>
            {info.data?.periods.length > 1 && (
              <select
                aria-label="成績の期間"
                value={period?.id || 'current'}
                onChange={(e) => setPeriodId(e.target.value)}
              >
                {info.data.periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <Category value={category} setValue={setCategory} />
          <dl className="online-stat-grid">
            {overview.columns.map((column) => (
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
            columns={overview.columns}
            precise={!!shown.seasonStats?.batting?.measured}
          />
          {period && (
            <small className="online-stat-note">
              {period.source}
              {period.partial ? '・記録開始後の場面集計' : ''}
            </small>
          )}
          {info.error && (
            <div role="alert">
              {info.error}
              <button onClick={info.retry}>選手記録を再取得</button>
            </div>
          )}
        </section>
        <section>
          <h3>場面別</h3>
          {info.loading ? (
            <p>記録を読み込んでいます…</p>
          ) : (
            <SplitStats period={period} category={category} />
          )}
        </section>
        <section>
          <h3>能力すべて</h3>
          <PlayerAbilities player={player} />
        </section>
      </div>
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
  list,
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
          list={list}
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

// 能力表の列（役割で分ける）。⚠ 以前は打者にも球速・制球が並んでいた
const fielderAbilityColumns = () => [
  ...statGroup('batting', 'abilities').columns,
  ...statGroup('batting', 'defense').columns.filter((c) => c.label !== '回復'),
];
const pitcherAbilityColumns = () => statGroup('pitching', 'abilities').columns;

/** 1つの表（列見出しを押して並べ替え） */
function RosterTable({ title, players, columns, view, category }) {
  const [sort, setSort] = useState(null);
  const rows = sort ? sortedRoster(players, sort.column, sort.direction) : players;
  const sortBy = (column) =>
    setSort((old) =>
      old?.column === column
        ? old.direction === (column === 'name' ? 'asc' : column.direction)
          ? { column, direction: old.direction === 'asc' ? 'desc' : 'asc' }
          : null
        : { column, direction: column === 'name' ? 'asc' : column.direction },
    );
  const head = (column, label) => (
    <button
      aria-label={`${label}で並べ替え`}
      aria-pressed={sort?.column === column}
      onClick={() => sortBy(column)}
    >
      {label}
      {sort?.column === column && (
        <span className="online-sort-direction" aria-hidden="true">
          {sort.direction === 'asc' ? '▲' : '▼'}
        </span>
      )}
    </button>
  );
  return (
    <div className="online-roster-block">
      <h3>
        {title} <small>{players.length}人</small>
      </h3>
      <div className="online-table-scroll">
        <table className="online-roster-table">
          <thead>
            <tr>
              <th>{head('name', '選手')}</th>
              {columns.map((column) => (
                <th key={column.id}>{head(column, column.label)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((player) => (
              <tr key={player.id}>
                <th>
                  <span className="online-roster-person">
                    <RoleMark player={player} lineup={view.lineup} />
                    <PlayerStatsButton
                      player={player}
                      list={rows}
                      category={category}
                      className="online-roster-player-name"
                    >
                      {player.name}
                    </PlayerStatsButton>
                    <small>{POS[player.position]}</small>
                    <ConditionMark player={player} />
                    <FatigueMark player={player} compact />
                    <StatLabels
                      player={player}
                      category={category}
                      limit={2}
                      compact
                    />
                  </span>
                </th>
                {columns.map((column) => {
                  const value = column.get(player);
                  const text = formatStat(column, value);
                  const rank = statRank(column, value);
                  return (
                    <td
                      key={column.id}
                      className={rank ? `online-ability-grade ${getRankColor(rank)}` : ''}
                      title={`${column.label}: ${text}`}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * 選手一覧（スマホ・PC共用）。
 * ⚠ **ページ送りにしない・全員を1画面に**。以前はスマホで8人前後、PCでも10人ずつで、
 *    打撃一覧に投手が混ざり、並びが打順でも守備順でもなかった。
 *    いまは野手（打順→控え）と投手（先発→救援）で表を分け、横に流れる表で全項目を見せる。
 */
export function CompactRoster({ view, desktop = false, teamSelector }) {
  const [mode, setMode] = useState(desktop ? 'stats' : 'batting');
  const ordered = rosterByRole(view.roster, view.lineup);
  const fielders = ordered.filter((p) => p.position !== 'pitcher');
  const pitchers = rosterByRole(view.roster, view.lineup, 'pitching').filter(
    (p) => p.position === 'pitcher',
  );
  const tables =
    mode === 'abilities'
      ? [
          ['野手', fielders, fielderAbilityColumns(), 'batting'],
          ['投手', pitchers, pitcherAbilityColumns(), 'pitching'],
        ]
      : mode === 'batting'
        ? [['野手', fielders, overviewGroup('batting').columns, 'batting']]
        : mode === 'pitching'
          ? [['投手', pitchers, overviewGroup('pitching').columns, 'pitching']]
          : [
              ['野手', fielders, overviewGroup('batting').columns, 'batting'],
              ['投手', pitchers, overviewGroup('pitching').columns, 'pitching'],
            ];
  return (
    <section className="online-card online-compact-roster">
      <div className="online-roster-toolbar">
        <div>
          {teamSelector || <h2>選手</h2>}
          <small>
            {view.readOnly ? '今季・閲覧' : '今季'} · {view.roster.length}人
          </small>
        </div>
        <Segmented
          label="表示する項目"
          value={mode}
          options={
            desktop
              ? [
                  ['stats', '成績'],
                  ['abilities', '能力'],
                ]
              : [
                  ['batting', '打撃'],
                  ['pitching', '投球'],
                  ['abilities', '能力'],
                ]
          }
          onChange={setMode}
        />
      </div>
      {tables.map(([title, players, columns, category]) => (
        <RosterTable
          key={`${mode}:${title}`}
          title={title}
          players={players}
          columns={columns}
          view={view}
          category={category}
        />
      ))}
      <Approximation
        columns={tables.flatMap((t) => t[2])}
        precise={view.roster.every((p) => p.seasonStats?.batting?.measured)}
      />
    </section>
  );
}

/**
 * 試合の成績表などで、選手IDから選手情報を開く名前。
 * ⚠ 自球団なら手元の名簿から、他球団なら押したときに球団の公開名簿を読んで開く
 *   （以前は成績表の名前が押せず、気になった選手は選手タブから探し直していた）。
 */
const teamCache = new Map();
export function PlayerById({ id, name, team, category = 'batting' }) {
  const nav = useAppNav();
  const read = useContext(ReadContext);
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(false);
  const view = nav.view;
  if (view && team === view.teamName) {
    const mine = view.roster.find((p) => String(p.id) === String(id));
    return mine ? (
      <PlayerStatsButton player={mine} category={category}>
        {name}
      </PlayerStatsButton>
    ) : (
      <span>{name}</span>
    );
  }
  if (!read || !view) return <span>{name}</span>;
  const open = async () => {
    setLoading(true);
    try {
      const key = `${team}:${view.revision}`;
      let info = teamCache.get(key);
      if (!info) {
        info = await read('team', { team, revision: view.revision });
        teamCache.set(key, info);
      }
      const found = info.roster.find((p) => String(p.id) === String(id));
      if (found) setPlayer(found);
    } catch {
      /* 読めなければ開かない（名前はそのまま） */
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <button
        className="online-player-name"
        onClick={open}
        disabled={loading}
        aria-label={`${name}の選手情報を見る`}
      >
        {name}
      </button>
      {player && (
        <Detail
          player={player}
          initialCategory={category}
          initialGroup="basic"
          initialPane="stats"
          close={() => setPlayer(null)}
        />
      )}
    </>
  );
}
