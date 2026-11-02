// 対人画面専用。既存の今季記録の閲覧・並べ替えに使い、記録や判定には書き戻さない。
import { getAbilityRank } from '../utils/constants.js';
const known = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const CONDITION_TEXT = ['絶不調', '不調', '普通', '好調', '絶好調'];
export const conditionValue = (player) =>
  Number.isInteger(player.condition) &&
  player.condition >= 0 &&
  player.condition <= 4
    ? player.condition
    : null;
const status = (category) => ({
  id: 'state',
  label: '調子・疲労',
  columns: [
    field('condition', '調子', conditionValue, 'condition'),
    field(
      'fatigue',
      '疲労',
      (player) => (known(player.fatigue) ? player.fatigue : null),
      'count',
      'asc',
    ),
    field('age', '年齢', (player) => (known(player.age) ? player.age : null)),
    field(
      'ability',
      category === 'batting' ? '走力' : '球速',
      (player) => {
        const value =
          category === 'batting'
            ? player.physical?.speed
            : player.pitching?.velocity;
        return known(value) ? value : null;
      },
      category === 'batting' ? 'ability' : 'velocity',
    ),
  ],
});
const raw = (category, key) => (player) => {
  const value = player.seasonStats?.[category]?.[key];
  return known(value) ? value : null;
};
const metric = (category, key) => (player) => {
  const value = player.performance?.[category]?.metrics?.[key];
  return known(value) ? value : null;
};
const battingRate = (fn) => (player) => {
  const m = player.performance?.batting?.metrics;
  return m && [m.avg, m.iso].every(known) ? fn(m) : null;
};
const field = (
  id,
  label,
  get,
  format = 'count',
  direction = 'desc',
  approximate = false,
) => ({ id, label, get, format, direction, approximate });
const b = (key, label, direction = 'desc') =>
  field(key, label, raw('batting', key), 'count', direction);
const p = (key, label, direction = 'desc') =>
  field(key, label, raw('pitching', key), 'count', direction);
const ability = (area, key, label, format = 'ability') =>
  field(
    `${area}:${key}`,
    label,
    (player) => (known(player[area]?.[key]) ? player[area][key] : null),
    format,
  );
const avg = field('avg', '打率', metric('batting', 'avg'), 'rate');
const pa = field('pa', '打席', metric('batting', 'pa'), 'count', 'desc', true);
const obp = field(
  'obp',
  '出塁率',
  metric('batting', 'obp'),
  'rate',
  'desc',
  true,
);
const slg = field(
  'slg',
  '長打率',
  battingRate((m) => m.avg + m.iso),
  'rate',
);
const ops = field(
  'ops',
  'OPS',
  battingRate((m) => (known(m.obp) ? m.obp + m.avg + m.iso : null)),
  'rate',
  'desc',
  true,
);
const iso = field('iso', 'ISO', metric('batting', 'iso'), 'rate');
const outs = field(
  'outs',
  '投球回',
  raw('pitching', 'inningsPitched'),
  'innings',
);
const era = field('era', '防御率', metric('pitching', 'era'), 'decimal', 'asc');
const k9 = field('k9', 'K/9', metric('pitching', 'k9'), 'decimal');
const bb9 = field('bb9', 'BB/9', metric('pitching', 'bb9'), 'decimal', 'asc');
const hr9 = field('hr9', '被本/9', metric('pitching', 'hr9'), 'decimal', 'asc');
const whip = field(
  'whip',
  'WHIP',
  (player) => {
    const s = player.seasonStats?.pitching;
    return s &&
      [s.hits, s.walks, s.inningsPitched].every(known) &&
      s.inningsPitched > 0
      ? ((s.hits + s.walks) * 3) / s.inningsPitched
      : null;
  },
  'decimal',
  'asc',
);
const kbb = field(
  'kbb',
  'K/BB',
  (player) => {
    const s = player.seasonStats?.pitching;
    if (!s || ![s.strikeouts, s.walks].every(known)) return null;
    return s.walks > 0
      ? s.strikeouts / s.walks
      : s.strikeouts > 0
        ? Infinity
        : null;
  },
  'decimal',
);
export const STAT_GROUPS = {
  batting: [
    {
      id: 'basic',
      label: '基本',
      columns: [
        avg,
        b('homeruns', '本塁打'),
        b('rbis', '打点'),
        b('stolenBases', '盗塁'),
      ],
    },
    {
      id: 'appearances',
      label: '出場・安打',
      columns: [b('games', '試合'), pa, b('atBats', '打数'), b('hits', '安打')],
    },
    {
      id: 'extra',
      label: '長打',
      columns: [
        b('doubles', '二塁打'),
        b('triples', '三塁打'),
        b('homeruns', '本塁打'),
        slg,
      ],
    },
    {
      id: 'discipline',
      label: '四死球・犠打',
      columns: [
        b('walks', '四球'),
        b('hitByPitch', '死球'),
        b('strikeouts', '三振', 'asc'),
        b('sacrificeBunts', '犠打'),
      ],
    },
    {
      id: 'sacrifices',
      label: '犠打飛・守備補助',
      columns: [
        b('sacrificeBunts', '犠打'),
        b('sacrificeFlies', '犠飛'),
        b('hitByPitch', '死球'),
        b('assists', '捕殺'),
      ],
    },
    {
      id: 'running',
      label: '走塁',
      columns: [
        b('stolenBases', '盗塁'),
        b('caughtStealing', '盗塁死', 'asc'),
        field('stealRate', '成功率', metric('batting', 'stealRate'), 'percent'),
        field('stealAttempts', '企図', metric('batting', 'stealAttempts')),
      ],
    },
    { id: 'sabers', label: '打撃指標', columns: [ops, obp, slg, iso] },
    {
      id: 'rates',
      label: '打席率',
      columns: [
        field(
          'kRate',
          'K%',
          metric('batting', 'kRate'),
          'percent',
          'asc',
          true,
        ),
        field(
          'bbRate',
          'BB%',
          metric('batting', 'bbRate'),
          'percent',
          'desc',
          true,
        ),
        field(
          'hrRate',
          '本塁打率',
          metric('batting', 'hrRate'),
          'percent',
          'desc',
          true,
        ),
        ops,
      ],
    },
    {
      id: 'fielding',
      label: '守備',
      columns: [
        b('fieldingChances', '機会'),
        b('errors', '失策', 'asc'),
        field(
          'fieldRate',
          '守備率',
          (player) => {
            const s = player.seasonStats?.batting;
            return s &&
              [s.fieldingChances, s.errors].every(known) &&
              s.fieldingChances > 0 &&
              s.errors <= s.fieldingChances
              ? (s.fieldingChances - s.errors) / s.fieldingChances
              : null;
          },
          'rate',
        ),
        b('games', '試合'),
      ],
    },
    status('batting'),
    {
      id: 'abilities',
      label: '打撃能力',
      columns: [
        ability('batting', 'meet', 'ミート'),
        ability('batting', 'power', 'パワー'),
        ability('batting', 'eye', '選球眼'),
        ability('physical', 'speed', '走力'),
      ],
    },
    {
      id: 'defense',
      label: '守備能力',
      columns: [
        ability('fielding', 'defense', '守備'),
        ability('physical', 'arm', '肩力'),
        ability('catching', 'lead', 'リード'),
        ability('physical', 'recovery', '回復'),
      ],
    },
  ],
  pitching: [
    {
      id: 'basic',
      label: '基本',
      columns: [
        era,
        outs,
        p('strikeouts', '奪三振'),
        p('walks', '四球', 'asc'),
      ],
    },
    {
      id: 'record',
      label: '登板・勝敗',
      columns: [
        p('games', '登板'),
        p('wins', '勝利'),
        p('losses', '敗戦', 'asc'),
        p('saves', 'セーブ'),
      ],
    },
    {
      id: 'usage',
      label: '先発・対戦打者',
      columns: [
        p('gamesStarted', '先発'),
        p('battersFaced', '対戦打者'),
        p('hitBatters', '死球', 'asc'),
        p('wildPitches', '暴投', 'asc'),
      ],
    },
    {
      id: 'relief',
      label: '救援',
      columns: [
        p('holds', 'ホールド'),
        p('saves', 'セーブ'),
        outs,
        p('pitches', '投球数'),
      ],
    },
    {
      id: 'allowed',
      label: '被打撃・失点',
      columns: [
        p('hits', '被安打', 'asc'),
        p('homeruns', '被本塁打', 'asc'),
        p('runsAllowed', '失点', 'asc'),
        p('earnedRuns', '自責点', 'asc'),
      ],
    },
    {
      id: 'quality',
      label: '先発・球数',
      columns: [
        p('qualityStarts', 'QS'),
        p('highQualityStarts', 'HQS'),
        p('pitches', '投球数'),
        outs,
      ],
    },
    { id: 'sabers', label: '投球指標', columns: [whip, kbb, k9, bb9] },
    { id: 'rates', label: '9回換算', columns: [k9, bb9, hr9, era] },
    status('pitching'),
    {
      id: 'abilities',
      label: '投球能力',
      columns: [
        ability('pitching', 'velocity', '球速', 'velocity'),
        ability('pitching', 'control', '制球'),
        ability('pitching', 'stamina', 'スタミナ', 'stamina'),
        ability('pitching', 'spinRate', '回転'),
      ],
    },
  ],
};
export function statGroup(category, id) {
  return (
    STAT_GROUPS[category].find((group) => group.id === id) ||
    STAT_GROUPS[category][0]
  );
}
export function formatStat(column, value, numericAbility = false) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (value === Infinity) return '∞';
  if (!known(value)) return '—';
  if (
    !numericAbility &&
    ['ability', 'velocity', 'stamina'].includes(column.format)
  )
    return getAbilityRank(
      value,
      column.format === 'velocity',
      column.format === 'stamina',
    );
  if (column.format === 'condition') return CONDITION_TEXT[value] || '—';
  if (column.format === 'innings')
    return `${Math.floor(value / 3)}.${value % 3}`;
  if (column.format === 'rate') return value.toFixed(3).replace(/^0\./, '.');
  if (column.format === 'decimal') return value.toFixed(2);
  if (column.format === 'percent')
    return `${Number((value * 100).toFixed(1))}%`;
  return value.toFixed(0);
}
export const statRank = (column, value) =>
  known(value) && ['ability', 'velocity', 'stamina'].includes(column.format)
    ? getAbilityRank(
        value,
        column.format === 'velocity',
        column.format === 'stamina',
      )
    : null;
export function sortedRoster(players, column, direction) {
  if (!column) return players;
  return players
    .map((player, index) => ({
      player,
      index,
      value: column === 'name' ? player.name : column.get(player),
    }))
    .sort((a, b) => {
      const missingA = a.value === null || a.value === undefined;
      const missingB = b.value === null || b.value === undefined;
      if (missingA || missingB)
        return missingA === missingB ? a.index - b.index : missingA ? 1 : -1;
      const comparison =
        column === 'name'
          ? a.value.localeCompare(b.value, 'ja')
          : a.value === b.value
            ? 0
            : a.value < b.value
              ? -1
              : 1;
      return comparison * (direction === 'asc' ? 1 : -1) || a.index - b.index;
    })
    .map((entry) => entry.player);
}

/**
 * 並べ替えを指定していないときの既定。
 *
 * ⚠ **出場量の多い順にすること**。名簿の順（ドラフト順）のままだと、
 *    打撃の1ページ目が投手だけで埋まり、スタメンが3ページ目まで出てこない。
 *    実測でそうなっていた。投球も同じで、先発ローテが埋もれる。
 */
export const defaultSort = (category) => ({
  column: category === 'batting' ? pa : outs,
  direction: 'desc',
});

export function overviewGroup(category) {
  const ids =
    category === 'batting'
      ? [
          'games',
          'pa',
          'avg',
          'homeruns',
          'rbis',
          'stolenBases',
          'obp',
          'slg',
          'ops',
          'strikeouts',
          'walks',
          'sacrificeBunts',
        ]
      : [
          'games',
          'era',
          'wins',
          'losses',
          'saves',
          'holds',
          'outs',
          'strikeouts',
          'walks',
          'k9',
          'bb9',
          'whip',
        ];
  const columns = STAT_GROUPS[category].flatMap((g) => g.columns);
  return {
    id: 'overview',
    label: '主要成績一覧',
    columns: ids.map((id) => columns.find((c) => c.id === id)).filter(Boolean),
  };
}

/** 指定した id の列だけを取り出す（打順・ローテの行に今季成績を短く出すときに使う） */
export function pickColumns(category, ids) {
  const columns = STAT_GROUPS[category].flatMap((g) => g.columns);
  return ids.map((id) => columns.find((c) => c.id === id)).filter(Boolean);
}
