import React, { useState } from 'react';
import { SPLIT_NAMES, rates } from './recordStats.js';
import { inningsCell } from '../utils/physics.js';
const GROUPS = {
  pitchRates: [
    '投球回・投球指標',
    ['outs', '投球回'],
    ['k9', '奪三振/9'],
    ['bb9', '四球/9'],
    ['whip', 'WHIP'],
  ],
  rates: [
    '率・打席',
    ['pa', '打席'],
    ['avg', '打率'],
    ['obp', '出塁率'],
    ['ops', 'OPS'],
  ],
  hits: [
    '打数・安打',
    ['atBats', '打数'],
    ['hits', '安打'],
    ['doubles', '二塁打'],
    ['triples', '三塁打'],
  ],
  power: [
    '長打・四死球',
    ['homeruns', '本塁打'],
    ['slg', '長打率'],
    ['walks', '四球'],
    ['hitByPitch', '死球'],
  ],
  counts: [
    '三振・犠打飛',
    ['strikeouts', '三振'],
    ['sacrificeBunts', '犠打'],
    ['sacrificeFlies', '犠飛'],
    ['fouls', 'ファウル'],
  ],
  tactics: [
    'バント・併殺',
    ['buntAttempts', '犠打企図'],
    ['buntSuccess', '犠打成功'],
    ['dpChances', '併殺機会'],
    ['doublePlays', '併殺'],
  ],
  other: [
    'その他',
    ['twoStrikeFouls', '追込後ファウル'],
    ['safetyAttempts', 'セーフティ企図'],
    ['squeezeAttempts', 'スクイズ企図'],
    ['intentionalWalks', '敬遠'],
  ],
};
export default function SplitStats({ period, category }) {
  const [key, setKey] = useState('risp');
  const [group, setGroup] = useState('rates');
  const selectedGroup =
    group === 'pitchRates' && category === 'batting' ? 'rates' : group;
  const names = SPLIT_NAMES[category];
  const selected = names[key] ? key : 'risp';
  const line = period?.splits?.[category]?.[selected];
  const values = line
    ? {
        ...line,
        ...rates(line),
        k9: line.outs > 0 ? (line.strikeouts * 27) / line.outs : null,
        bb9: line.outs > 0 ? (line.walks * 27) / line.outs : null,
        whip: line.outs > 0 ? ((line.hits + line.walks) * 3) / line.outs : null,
      }
    : null;
  return (
    <>
      <div className="online-stat-tools">
        <select
          aria-label="場面別の区分"
          value={selected}
          onChange={(e) => setKey(e.target.value)}
        >
          {Object.entries(names).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="場面別の表示項目"
          value={selectedGroup}
          onChange={(e) => setGroup(e.target.value)}
        >
          {Object.entries(GROUPS)
            .filter(([id]) => category === 'pitching' || id !== 'pitchRates')
            .map(([id, [label]]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
        </select>
      </div>
      {values ? (
        <dl className="online-stat-grid">
          {GROUPS[selectedGroup].slice(1).map(([id, label]) => {
            const value = values[id];
            return (
              <div key={id}>
                <dt>{label}</dt>
                <dd>
                  {value === null || value === undefined
                    ? '—'
                    : ['avg', 'obp', 'ops', 'slg'].includes(id)
                      ? value.toFixed(3).replace(/^0\./, '.')
                      : id === 'outs'
                        ? inningsCell(value)
                        : ['k9', 'bb9', 'whip'].includes(id)
                          ? value.toFixed(2)
                          : value}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p>この区分の記録はまだありません。</p>
      )}
      <small className="online-stat-note">
        {category === 'pitching'
          ? '投球区分の率は被打撃成績です。'
          : '犠打企図は送りバントのみ。'}
      </small>
    </>
  );
}
