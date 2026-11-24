import React from "react";
import { BATTERY_NOTE } from "./recordStats.js";
import { inningsCell } from "../utils/physics.js";

// 投手×捕手の組み合わせ（選手の詳細）。サーバーの `period.battery`（recordedViews.mjs `batteryFor`）。
// ⚠ このゲームに「相性」の仕組みは無い（いしだ: 仕組みは足さず、結果として見られる形）。
//    回数が少ない組は運の差が大きいので、薄く出して「少」と書く。
// ⚠ 文言と境目はアプリ（PlayerSheet.kt の BatterySection）と同じにする
const dec = (v) => (v === null || v === undefined ? "—" : v.toFixed(2));
const rate = (v) =>
  v === null || v === undefined ? "—" : v.toFixed(3).replace(/^0\./, ".");
const pct = (v) =>
  v === null || v === undefined ? "—" : `${Number((v * 100).toFixed(1))}%`;

function Rows({ rows, who }) {
  return (
    <table className="online-battery-table">
      <thead>
        <tr>
          <th>{who}</th>
          <th>回</th>
          <th>防御率</th>
          <th>K/9</th>
          <th>BB/9</th>
          <th>被打率</th>
          <th>読まれ率</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} data-few={row.few || undefined}>
            <th>
              {row.name}
              {row.few && <small>（少）</small>}
            </th>
            <td>{inningsCell(row.outs)}</td>
            <td>{dec(row.era)}</td>
            <td>{dec(row.k9)}</td>
            <td>{dec(row.bb9)}</td>
            <td>{rate(row.avg)}</td>
            <td>{pct(row.readRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function BatteryStats({ battery }) {
  if (!battery) return <p>この期間の組み合わせの記録はまだありません。</p>;
  const c = battery.caught;
  return (
    <>
      {c && (
        <>
          <h3>
            捕手として <small>マスクをかぶった時の投手成績</small>
          </h3>
          <dl className="online-stat-grid">
            {[
              ["守備回", inningsCell(c.outs)],
              ["先発マスク", c.starts],
              ["捕手防御率", dec(c.era)],
              ["読まれ率", pct(c.readRate)],
              ["K/9", dec(c.k9)],
              ["BB/9", dec(c.bb9)],
              ["被打率", rate(c.avg)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {battery.pitchers.length > 0 && (
            <Rows rows={battery.pitchers} who="受けた投手" />
          )}
        </>
      )}
      {battery.catchers.length > 0 && (
        <>
          <h3>
            組んだ捕手 <small>この投手が投げた時の成績</small>
          </h3>
          <Rows rows={battery.catchers} who="捕手" />
        </>
      )}
      <small className="online-stat-note">{BATTERY_NOTE}</small>
    </>
  );
}
