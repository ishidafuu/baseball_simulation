import React, { useState } from 'react';
import MobilePanel from './MobilePanel.jsx';
import { PageNav } from './PageNav.jsx';
import { PlayerStatsButton, ConditionMark } from './PlayerPerformance.jsx';
import { StaffActual as Actual, TacticsDelegateNote } from './StaffPage.jsx';
import {
  STARTER_ROLES,
  STRATEGY_FIELDS,
  strategyEffectText,
  RELIEF_ROLES,
  TACTIC_FIELDS,
  TACTIC_DEFAULTS,
  roleFor,
} from './tactics.js';
const GROUPS = {
  basic: '基本方針',
  bunt: 'バント',
  subs: '代打・守備固め',
  pitcher: '先発の交代',
  roles: '投手の役割（確認）',
};
const FIELDS = {
  bunt: ['sacrificeBunt', 'squeeze', 'safetyBunt'],
  subs: ['pinchHit', 'pinchHitFrom', 'defensiveSub', 'defenseFrom'],
  pitcher: ['hook', 'starterLimit'],
};
export default function MobileTactics({
  view,
  plan,
  change,
  busy,
  dirty,
  save,
  error,
  close,
}) {
  const [group, setGroup] = useState('basic'),
    [page, setPage] = useState(0);
  const pitchers = view.roster
    .filter((p) => p.position === 'pitcher' && p.isActive !== false)
    .sort((a, b) => {
      const x = plan.starters.indexOf(a.id),
        y = plan.starters.indexOf(b.id);
      return (x < 0 ? 99 : x) - (y < 0 ? 99 : y);
    });
  // ⚠ **呼び名はPC・アプリと同じ「方針・采配」**。以前は「事前采配」で、同じ設定なのに
  //    端末で名前が違った。保存の押しボタンも「編成を保存」ではなくPCと同じ「保存」
  //    （打順の下書きも同じなので、ここで保存すると打順の変更も一緒に保存する。下の文がそう書く）
  return (
    <MobilePanel
      title="方針・采配"
      close={close}
      footer={
        <>
          <small role="status">
            {!view.writable
              ? '閲覧のみ。操作するにはこの端末でログインし直してください'
              : dirty
                ? '打順・采配に未保存の変更があります'
                : '保存済みの設定'}
          </small>
          <div>
            <button onClick={close}>打順に戻る</button>
            <button
              className="online-primary"
              disabled={busy || !dirty}
              onClick={save}
            >
              保存
            </button>
          </div>
        </>
      }
    >
      <select
        aria-label="見る設定"
        value={group}
        onChange={(e) => {
          setGroup(e.target.value);
          setPage(0);
        }}
      >
        {Object.entries(GROUPS).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="online-alert">
          {error}
        </p>
      )}
      <TacticsDelegateNote view={view} />
      <fieldset disabled={busy} className="online-mobile-tactic-fields">
        {group === 'basic' &&
          Object.entries(STRATEGY_FIELDS).map(([key, [label, options]]) => (
            <label key={key}>
              {label}
              <select
                aria-label={label}
                value={plan.strategy?.[key] ?? Object.keys(options)[0]}
                onChange={(e) =>
                  change({
                    ...plan,
                    strategy: {
                      ...(plan.strategy || {}),
                      [key]: e.target.value,
                    },
                  })
                }
              >
                {Object.entries(options).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
              <small className="online-strategy-effect">
                {strategyEffectText(key, plan.strategy?.[key] ?? Object.keys(options)[0])}
              </small>
              <Actual view={view} field="strategy" name={key} />
            </label>
          ))}
        {(FIELDS[group] || []).map((key) => {
          const [label, options] = TACTIC_FIELDS[key];
          return (
            <label key={key}>
              {label}
              <select
                aria-label={label}
                value={plan.tactics?.[key] ?? TACTIC_DEFAULTS[key]}
                onChange={(e) =>
                  change({
                    ...plan,
                    tactics: {
                      ...(plan.tactics || {}),
                      [key]:
                        typeof TACTIC_DEFAULTS[key] === 'number'
                          ? Number(e.target.value)
                          : e.target.value,
                    },
                  })
                }
              >
                {Object.entries(options).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
              <Actual view={view} field="tactics" name={key} />
            </label>
          );
        })}
      </fieldset>
      {group === 'roles' ? (
        <>
          {/* ⚠ スマホでも変えられる（「打順」の「投手起用を開く」の全画面。`OnlineLineup.jsx`）。
              以前は「PCから」と書いていて、同じ画面にある入口と食い違っていた（再監査 B6） */}
          <p className="online-mobile-tactic-note">
            役割・ローテーションは「打順」の「投手起用を開く」で変えられます
          </p>
          <div className="online-mobile-role-list">
            {pitchers.slice(page * 4, page * 4 + 4).map((p) => {
              const order = plan.starters.indexOf(p.id),
                role = roleFor(plan.pitcherRoles?.[p.id], order >= 0);
              return (
                <article key={p.id}>
                  <div>
                    <PlayerStatsButton player={p} panel="abilities" />
                    <ConditionMark player={p} />
                  </div>
                  <small>
                    {order >= 0 ? `先発${order + 1}番手` : '救援'} ·{' '}
                    {STARTER_ROLES[role] || RELIEF_ROLES[role]} · 疲労
                    {p.fatigue ?? '—'}
                  </small>
                </article>
              );
            })}
          </div>
          <PageNav
            page={page}
            size={4}
            count={pitchers.length}
            setPage={setPage}
          />
        </>
      ) : (
        <p className="online-mobile-tactic-note">
          {group === 'pitcher'
            ? '球数による交代は打席の区切りで判断します。'
            : '次の試合から反映。状況判断はAIが行います。'}
        </p>
      )}
    </MobilePanel>
  );
}
