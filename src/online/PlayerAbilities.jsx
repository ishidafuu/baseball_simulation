import React from 'react';
import { ABILITY_GROUPS, abilityRows } from './playerInfo.js';
import {
  getZoneProfile,
  zoneHeatmap,
  describeZoneProfile,
} from '../game/batterZone.js';
import {
  getBatterType,
  BATTER_TYPE_LABEL,
  BATTER_TYPE_NOTE,
} from '../game/batterType.js';
import { getAbilityRank, getRankColor } from '../utils/constants.js';
// 能力すべて。⚠ **セレクトで1群ずつ切り替えない**。以前は「見る能力」セレクト（9種類）で
// 選んでから6項目ずつ見ていて、比べるのに何度も切り替えが要った。縦に全部並べる。
export default function PlayerAbilities({ player }) {
  const order =
    player.position === 'pitcher'
      ? ['pitching', 'arsenal', 'fielding', 'physical', 'mental', 'profile']
      : ['batting', 'zone', 'fielding', 'positions', 'physical', 'mental', 'profile'];
  return (
    <div className="online-ability-all">
      {order.map((id) => {
        const label = ABILITY_GROUPS.find(([key]) => key === id)?.[1];
        return (
          <section key={id}>
            <h3>{label}</h3>
            <AbilityGroup player={player} group={id} />
          </section>
        );
      })}
    </div>
  );
}
function AbilityGroup({ player, group }) {
  const rows = abilityRows(player, group);
  const type = player.batting ? getBatterType(player) : null;
  return (
    <section className="online-player-abilities">

      {group === 'zone' ? (
        player.batting ? (
          <>
            <p className="online-batter-type">{BATTER_TYPE_LABEL[type]}</p>
            <small>{BATTER_TYPE_NOTE[type]}</small>
            <div
              className="online-zone-grid"
              role="img"
              aria-label="打撃コース適性。上が高め、下が低め、左が外角、右が内角。赤が得意、青が苦手。"
            >
              {zoneHeatmap(getZoneProfile(player), {
                withLocation: true,
              }).flatMap((line, y) =>
                line.map((value, x) => (
                  <span
                    key={`${x}:${y}`}
                    className={`online-zone-${value >= 0.5 ? 'hot' : value >= 0.2 ? 'warm' : value > -0.2 ? 'neutral' : value > -0.5 ? 'cool' : 'cold'} ${x >= 1 && x <= 3 && y >= 1 && y <= 3 ? 'online-zone-strike' : ''}`}
                  />
                )),
              )}
            </div>
            <p className="online-zone-legend">
              赤＝得意／青＝苦手　左＝外角・右＝内角
            </p>
            <ul>
              {describeZoneProfile(getZoneProfile(player)).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>打撃データはありません。</p>
        )
      ) : (
        <>
          <dl
            className={`online-stat-grid ${group === 'profile' ? 'online-profile-grid' : ''}`}
          >
            {rows.map(([label, value], index) => (
                <div key={`${label}:${index}`}>
                  <dt>{label}</dt>
                  <dd
                    className={
                      typeof value === 'number' && group !== 'profile'
                        ? getRankColor(
                            getAbilityRank(
                              value,
                              label === '球速',
                              label === 'スタミナ',
                            ),
                          )
                        : ''
                    }
                  >
                    {value ?? '—'}
                  </dd>
                </div>
              ))}
          </dl>
          {!rows.length && <p>記録はありません。</p>}

        </>
      )}
    </section>
  );
}
