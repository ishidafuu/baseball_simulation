import React, { useEffect, useMemo, useRef, useState } from 'react';
import { menusFor, subMenusFor, clampMenu, clampSub } from './campMenus.js';
import { FORM_PITCH_AFFINITY } from '../season/campTraining.js';
import {
  DIRECTIONS,
  PHASES,
  playerWish,
  describeMood,
  resolveTraining,
  playerPolicy,
} from '../season/trainingPolicy.js';
import { POS, POS_FULL } from './api.js';
import { getPitchTypeName, FORM_SHORT, BATS_SHORT } from '../utils/constants.js';
import {
  CAMP_DIRECTIONS,
  CAMP_PHASES,
  CAMP_POLICY_GUIDE,
  CAMP_SUB_TARGETS,
  CAMP_PITCH_TYPES,
  CAMP_TARGET_REQUIRED,
  CAMP_FORMS,
  CAMP_BATS,
  currentBats,
  CONVERT_POSITIONS,
} from './shared.js';
import { PlayerStatsButton } from './PlayerPerformance.jsx';
import { useDraftState, phaseDraftName } from './Drafts.jsx';
import { Choice } from './Choice.jsx';
import {
  campGainRows,
  campGainTotals,
  campGainTable,
  sortCampGainRows,
  formatGain,
} from './campGains.js';
import { formatDeadline } from './LeaguePanels.jsx';

// ============================================================
// キャンプ。一人用のキャンプ画面と同じ作りにする。
//
//   育成方針（長所／全体／短所 × 基礎体力／技術）→ 全員に一括
//   選手ごとに**メイン練習とサブ練習**を選ぶ
//   「第Nクール練習を実行」→ 伸びた能力を見て、次のクールを決める（全4回）
//
// ⚠ **1クールずつサーバーで実行する**（`campRound` 命令）。画面で計算して
//    まとめて送る形にはしないこと——成長の計算は保存の正本に当てるもので、
//    画面で回すと手元の数字と保存がずれる。
// ⚠ **同じクールを2回走らせない**。押し直しや再送で成長が二重に積まれるので、
//    クール番号を送って、サーバーが次の1つだけを受け付ける。
// ⚠ 一人用の画面（`CampScreen`）をそのまま持ち込まないこと。あちらは派遣・
//    大学リーグの昇降格・スタッフ退職まで抱えていて、オンラインのエンジンは
//    それらを動かさない。出すと「できるように見えて何も起きない」ものが並ぶ。
// ⚠ メニューの表は一人用と**同じものを読む**（`TRAINING_MENUS` /
//    `SUB_TRAINING_MENUS`）。写すと、調整したときに片方だけ古くなる。
//    出すメニューの絞り込みと既定へ戻す判定は `campMenus.js`（node の道具と共用）。
// ============================================================

/**
 * サブ練習の「対象」の選択肢（`[値, 見せ方]` の並び）。
 *
 * ⚠ **選べるのに選ばせない、をやめる**。`executeSubTraining` は球種も守備位置も
 *    受け取れるのに、オンラインは何も渡していなかった（新球種は中で抽選、
 *    サブポジ練習は「置き場が無い」としてメニューごと外れていた）。
 * ⚠ 新球種は**まだ持っていない球種**、変化球練習は**持っている球種**。取り違えると
 *    選んでも1クール捨てることになる。
 * ⚠ サブポジはいまの守備位置を除き、適性を添える（どこなら現実的か分からない）。
 * ⚠ 新球種は**おすすめの印を添える**（いしだ指摘）。覚えやすさはフォーム適性と
 *    緩急の補完（`secondAffinity`）で決まるのに、名前だけ並べても分からない。
 *    一人用のキャンプ画面と同じ印（★フォーム適性・◆緩急適性）を使う。
 * ⚠ フォーム改造・打席変更は**いまの形を除く**。変わったあとは選択肢から消え、
 *    「未選択」に戻る（サーバーは基礎体力で回す。`campSubKey`）。文はアプリ（Camp.kt）と同じ
 */
export function subTargetChoices(key, player) {
  const kind = CAMP_SUB_TARGETS[key];
  const owned = (player.pitching?.arsenal || [])
    .filter((pitch) => pitch?.type && pitch.type !== 'straight')
    .map((pitch) => pitch.type);
  if (kind === 'pitch')
    return CAMP_PITCH_TYPES.filter((type) => !owned.includes(type)).map((type) => {
      const form = !!FORM_PITCH_AFFINITY[player.pitching?.form]?.[type];
      const second = player.pitching?.secondAffinity === type;
      const tag = form && second ? ' ★◆' : form ? ' ★' : second ? ' ◆' : '';
      return [type, `${getPitchTypeName(type)}${tag}`];
    });
  // ⚠ 極めた球種（100）は外す（選んでも伸びず、黙って分配に戻る。一人用と同じ）
  if (kind === 'ownPitch')
    return (player.pitching?.arsenal || [])
      .filter((pitch) => owned.includes(pitch.type) && (pitch.level ?? 0) < 100)
      .map((pitch) => [pitch.type, `${getPitchTypeName(pitch.type)}${pitch.level ?? ''}`]);
  if (kind === 'form')
    return CAMP_FORMS.filter(
      (form) => form !== (player.pitching?.form || 'threeQuarter'),
    ).map((form) => [form, `${FORM_SHORT[form]}へ`]);
  if (kind === 'bats')
    return CAMP_BATS.filter((bats) => bats !== currentBats(player)).map(
      (bats) => [bats, `${BATS_SHORT[bats]}へ`],
    );
  if (kind === 'position')
    return CONVERT_POSITIONS.filter(
      (pos) => pos !== 'pitcher' && pos !== player.position,
    ).map((pos) => [
      pos,
      `${POS_FULL[pos]}${
        Number.isFinite(player.positionFitness?.[pos])
          ? ` ${player.positionFitness[pos]}%`
          : ''
      }`,
    ]);
  return [];
}

const MOOD_TONE = { good: '意欲的', mid: '納得', bad: '身が入らない' };

// 方針の決め方。⚠ 既定は**おすすめ**（球団で1つの方針だと、希望の違う選手が
//    必ず「身が入らない」で残る。いしだ指摘: 一括指定が有効に見えない）
export const CAMP_MODE_LABELS = {
  recommended: 'おすすめ',
  wish: '全員を希望どおり',
  team: '全員同じ方針',
};
const CAMP_MODE_NOTES = {
  recommended:
    '本人の希望どおりにします。ただし技術が平凡な選手が「短所を埋める」を望むときは「長所を伸ばす」に変えます（段階は希望のままなので「納得」）。',
  wish: '全員を本人の希望どおりにします（全員「意欲的」）。希望どおりが正解とは限りません。',
  team: '全員に同じ方針を当てます。希望と違う選手は身が入りにくくなります。',
};
export const DEFAULT_CAMP_POLICY = {
  mode: 'recommended',
  direction: 'balanced',
  phase: 'skill',
};
/**
 * 方向と段階が欠けた方針に既定を敷く。
 * ⚠ 指導者の案・締め切りの標準案の方針は `{ mode: 'recommended' }` だけで、方向と段階を
 *    持たない。そこから「全員同じ方針」に切り替えると、説明が「undefined／undefined」になり、
 *    育成方針・段階のボタンがどれも選ばれていない状態になっていた（アプリは既定を敷いている）
 */
export const withPolicyDefaults = (policy) => ({
  ...policy,
  direction: policy?.direction || DEFAULT_CAMP_POLICY.direction,
  phase: policy?.phase || DEFAULT_CAMP_POLICY.phase,
});
const grade = (v) => (typeof v === 'number' ? Math.round(v) : '—');

/**
 * 能力の値と、**直近のクール**の伸び（「52+3」）。
 * ⚠ 先方指摘: 通算の伸びを出していたので、1つのクールでどれだけ伸びたか分からなかった。
 *    いまは `camp.last.gains`（直近の1クール）。通算はキャンプ後のまとめ（`CampResultList`）で見る。
 * ⚠ 伸びは**サーバーの記録**。画面で前の値と比べない
 */
function Stat({ value, diff }) {
  return (
    <>
      {grade(value)}
      {diff ? (
        <small className={`online-gain ${diff > 0 ? 'is-up' : 'is-down'}`}>
          {formatGain(diff)}
        </small>
      ) : null}
    </>
  );
}
// ⚠ 成長は**倍率**（0.70〜1.30）。四捨五入すると全員「1」になって読めない
const ratio = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');

/**
 * 変化球の短い表記。表の1列に3〜5球種を並べるため、**頭の3文字**に畳む。
 *
 * ⚠ **2文字は読めない**（いしだ指摘）。「カブ」「パム」「フォ」は、カーブ・
 *    パーム・フォークのことだと分からない。3文字なら名前の頭がそのまま残る
 *    （カーブ・パーム・スライ・チェン）。
 * ⚠ 畳まないものは畳まない（カーブ・パームは元から3文字）。
 * ⚠ 全文（名前＋キレ）は `title` で出す。
 */
const PITCH_SHORT = {
  slider: 'スライ',
  curve: 'カーブ',
  fork: 'フォー',
  changeup: 'チェン',
  sinker: 'シンカ',
  shoot: 'シュー',
  cutter: 'カッタ',
  twoSeam: 'ツーシ',
  splitter: 'スプリ',
  palm: 'パーム',
  knuckle: 'ナック',
};

/** 直球を除いた持ち球。⚠ 置き場は `pitching.arsenal` */
const breakingBalls = (player) =>
  (player.pitching?.arsenal || []).filter(
    (pitch) => pitch?.type && pitch.type !== 'straight',
  );

/** 表に出す短い表記（スラ カブ フォ） */
const pitchTypesShort = (player) =>
  breakingBalls(player)
    .map((pitch) => PITCH_SHORT[pitch.type] || getPitchTypeName(pitch.type))
    .join(' ');

/** マウスを載せたときの全文（スライダー50 カーブ32） */
const pitchTypesFull = (player) =>
  breakingBalls(player)
    .map((pitch) => `${getPitchTypeName(pitch.type)}${pitch.level ?? ''}`)
    .join(' ');

function PlayerRow({
  player,
  main,
  sub,
  target,
  onMain,
  onSub,
  onTarget,
  busy,
  policy,
  onFitWish,
  gains = {},
  events = [],
}) {
  const g = (key) => gains[key];
  const choices = subTargetChoices(sub, player);
  const isPitcher = player.position === 'pitcher';
  const wish = useMemo(() => playerWish(player), [player]);
  // ⚠ `policy` は**この選手に当てる方針**（`playerPolicy` の結果）
  const mood = describeMood(player, policy.direction, policy.phase);
  const fits =
    wish.direction === policy.direction && wish.phase === policy.phase;
  return (
    <tr>
      <th>
        <PlayerStatsButton player={player} panel="abilities" />
        {/* ⚠ 直近のクールの出来事（フォーム改造・新球種・覚醒）。数字が動かない出来事もあり、
            上のまとめを消したので、ここに出さないとキャンプが終わるまで知らされない */}
        {events.map((text, i) => (
          <small key={`${i}:${text}`} className="online-camp-gain-event">
            {' '}
            {text}
          </small>
        ))}
      </th>
      {/* ⚠ 投手の表に守備位置は出さない（全員「投」で、1列ぶん無駄になる） */}
      {!isPitcher && <td>{POS[player.position]}</td>}
      <td>{player.age}</td>
      <td>{ratio(player.growthPotential)}</td>
      <td className={`online-mood is-${mood.tone}`}>
        {MOOD_TONE[mood.tone] || mood.label}
        {/* ⚠ この選手だけ希望に合わせる（1人ずつ方針を変えられる） */}
        {!fits && (
          <button
            className="online-camp-wish-fit"
            disabled={busy}
            title="この選手だけ本人の希望に合わせる"
            onClick={() => onFitWish(player)}
          >
            合わせる
          </button>
        )}
      </td>
      {/* ⚠ 希望は**意欲の隣**に置く。意欲は「希望と方針が噛み合うか」なので、
          並べないと見比べられない（右端に置いていて、1440px でも半分切れていた）。
          印だけにして全文は title と表の下の凡例で出す。名前で出すと
          「長所を伸ばす·基礎体力」で90pxを取り、右端の列が隠れる */}
      <td
        className="online-camp-wish"
        title={`${DIRECTIONS[wish.direction]?.name}·${PHASES[wish.phase]?.name}`}
      >
        {DIRECTIONS[wish.direction]?.icon}
        {PHASES[wish.phase]?.icon}
      </td>
      <td>{isPitcher ? FORM_SHORT[player.pitching?.form] || '—' : '—'}</td>
      <td>
        <Stat value={player.physical?.arm} diff={g('physical.arm')} />
      </td>
      {isPitcher ? (
        <>
          <td>
            <Stat
              value={player.pitching?.velocity}
              diff={g('pitching.velocity')}
            />
          </td>
          <td>
            <Stat
              value={player.pitching?.control}
              diff={g('pitching.control')}
            />
          </td>
          <td>
            <Stat
              value={player.pitching?.spinRate}
              diff={g('pitching.spinRate')}
            />
          </td>
          <td>
            <Stat
              value={player.pitching?.stamina}
              diff={g('pitching.stamina')}
            />
          </td>
        </>
      ) : (
        <>
          <td>
            <Stat value={player.batting?.meet} diff={g('batting.meet')} />
          </td>
          <td>
            <Stat value={player.batting?.power} diff={g('batting.power')} />
          </td>
          <td>
            <Stat value={player.batting?.eye} diff={g('batting.eye')} />
          </td>
          <td>
            <Stat value={player.batting?.bunt} diff={g('batting.bunt')} />
          </td>
        </>
      )}
      <td>
        <Stat value={player.physical?.speed} diff={g('physical.speed')} />
      </td>
      <td>
        <Stat value={player.fielding?.defense} diff={g('fielding.defense')} />
      </td>
      <td>
        <Stat
          value={player.physical?.bodyStamina}
          diff={g('physical.bodyStamina')}
        />
      </td>
      <td>
        <Stat value={player.physical?.recovery} diff={g('physical.recovery')} />
      </td>
      <td>
        <Stat value={player.physical?.muscle} diff={g('physical.muscle')} />
      </td>
      {/* ⚠ 持ち球は**練習を選ぶ2列のすぐ左**。メイン・サブは右に留める（下の
          `CampTableScroll`）ので、その右に列を足すと留めた列の下に隠れる。
          長いので溢れたぶんは … にして、全文は title で出す。
          ⚠ 投手の行だけ（野手の表に空の列を作らない） */}
      {isPitcher && (
        <td className="online-camp-pitches" title={pitchTypesFull(player)}>
          {pitchTypesShort(player)}
        </td>
      )}
      <td className="online-camp-main">
        <select
          aria-label={`${player.name}のメイン練習`}
          value={main}
          disabled={busy}
          onChange={(e) => onMain(player.id, e.target.value)}
        >
          {menusFor(isPitcher).map(([key, menu]) => (
            <option key={key} value={key}>
              {menu.icon} {menu.name}
            </option>
          ))}
        </select>
      </td>
      <td className="online-camp-sub">
        <select
          aria-label={`${player.name}のサブ練習`}
          value={sub}
          disabled={busy}
          onChange={(e) => onSub(player.id, e.target.value)}
        >
          {subMenusFor(player).map(([key, menu]) => (
            <option key={key} value={key}>
              {menu.icon} {menu.name}
            </option>
          ))}
        </select>
        {/* ⚠ 対象を取る練習だけ**同じ欄の中に横に**出す。列を足すと23列が24列に
            なって横に溢れ、下に積むと行の高さが倍になる。
            ⚠ 「おまかせ」を残す（従来どおり中で選ぶ）。フォーム改造・打席変更は選ばないと
            練習しない（基礎体力になる）ので「未選択」 */}
        {choices.length > 0 && (
          <select
            className="online-camp-target"
            aria-label={`${player.name}の練習の対象`}
            title={
              CAMP_TARGET_REQUIRED.includes(CAMP_SUB_TARGETS[sub])
                ? '選ばないと基礎体力になります'
                : undefined
            }
            value={target || ''}
            disabled={busy}
            onChange={(e) => onTarget(player.id, e.target.value)}
          >
            <option value="">
              {CAMP_TARGET_REQUIRED.includes(CAMP_SUB_TARGETS[sub])
                ? '未選択'
                : 'おまかせ'}
            </option>
            {choices.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        )}
      </td>
    </tr>
  );
}

/**
 * キャンプの表の横送りの枠。
 * ⚠ **練習を選ぶ2列（メイン・サブ）は右に留める**（`online.css` の `.online-camp-main` /
 *    `.online-camp-sub`）。1440px より狭いと表が横に送れ、1280px ではサブの列が枠の外に
 *    あった（再監査 F11）。メインを留める位置はサブの列の幅で、サブは対象の欄が出ると
 *    広がるので、画面で測って `--online-camp-sub-width` に入れる（測る前はメインは留めない）
 */
function CampTableScroll({ children }) {
  const ref = useRef(null);
  useEffect(() => {
    const box = ref.current;
    const sub = box?.querySelector('thead .online-camp-sub');
    if (!sub) return undefined;
    const measure = () =>
      box.style.setProperty(
        '--online-camp-sub-width',
        `${sub.getBoundingClientRect().width}px`,
      );
    measure();
    // ⚠ `window.` を付けて読む（`scope-check` は素の名前を未定義の識別子として落とす）
    if (!window.ResizeObserver) return undefined;
    const observer = new window.ResizeObserver(measure);
    observer.observe(sub);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="online-camp-scroll">
      {children}
    </div>
  );
}

/** 携帯用: 直近のクールで伸びた能力（畳んで出す） */
function LastRoundGains({ last, roster }) {
  const rows = campGainRows(last.gains || {}, roster, last.events || {});
  return (
    <details className="online-camp-last">
      <summary>
        第{last.round}クールで伸びた選手（{rows.length}人）
      </summary>
      <ul className="online-camp-gain-list">
        {rows.map(({ player, items, events }) => (
          <li key={player.id}>
            <span className="online-camp-gain-name">
              <PlayerStatsButton player={player} panel="abilities" />
              <small>{POS[player.position]}</small>
            </span>
            <span className="online-camp-gain-items">
              {items.map((i) => (
                <span
                  key={i.key}
                  className={`online-gain ${i.diff > 0 ? 'is-up' : 'is-down'}`}
                >
                  {i.label}
                  {formatGain(i.diff)}
                </span>
              ))}
              {events.map((text, index) => (
                <strong key={`${index}:${text}`} className="online-camp-gain-event">
                  {text}
                </strong>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * キャンプ後の成果（選手ごとの総合上昇値）。
 *
 * ⚠ 先方指摘「キャンプ中の能力値上昇をまとめた上のウィンドウを削除し、キャンプ後に、
 *    各選手の総合上昇値が見れるように」。キャンプ中は表の「+〇」（直近のクールの伸び）だけにし、
 *    まとめは**全クールが終わってから**出す。
 * ⚠ 先方指摘「選手3列9行は見づらい。各選手1行にし、何が伸びたかチームメイトと比べられるように」。
 *    **1人1行の表**にし、列を項目（ミート・制球…）にそろえる。見出しを押すとその項目で並べ替える
 *    （既定は「計」の多い順）。列は誰か1人でも動いた項目だけ（`campGainTable`）。
 * ⚠ クールごとの合計は右端の列。クールごとの記録（`byRound`）が全クールぶん無いキャンプ
 *    （版を上げる前に始めたもの）は出さない。
 * ⚠ 全員を出す（上位だけに絞らない。「各選手の」が求められている）。
 */
export function CampResultList({ camp, roster }) {
  const [sort, setSort] = useState({ key: 'sum', dir: 'desc' });
  const table = campGainTable(camp?.gains || {}, roster, camp?.events || {});
  if (!table.rows.length && !camp?.rounds) return null;
  // ⚠ **全クールぶん揃っているときだけ**クール別を出す。記録を足す前に始めたキャンプは
  //    途中のクールからしか無く、並べると「計」と合わない（抜けたクールが黙って消える）
  const byRound =
    (camp?.byRound || []).length === camp?.rounds ? camp.byRound : [];
  const totals = campGainTotals(camp?.gains || {});
  const grown = table.rows.filter((r) => r.items.some((i) => i.diff > 0)).length;
  const roundSum = (round, id) =>
    Object.values(round.gains?.[id] || {}).reduce((n, d) => n + d, 0);
  const rows = sortCampGainRows(table.rows, sort.key, sort.dir);
  const sortBy = (key) =>
    setSort((now) =>
      now.key === key ? { key, dir: now.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' },
    );
  const header = (key, label) => (
    <th key={key}>
      <button
        type="button"
        aria-label={`${label}で並べ替え`}
        aria-pressed={sort.key === key}
        onClick={() => sortBy(key)}
      >
        {label}
        {sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
      </button>
    </th>
  );
  const cell = (diff) =>
    diff === undefined || diff === 0 ? (
      <td className="online-muted">·</td>
    ) : (
      <td className={`online-gain ${diff > 0 ? 'is-up' : 'is-down'}`}>{formatGain(diff)}</td>
    );
  return (
    <section className="online-camp-gains" aria-label="キャンプの成果">
      <div className="online-camp-gains-head">
        <h4>選手ごとの総合上昇値（キャンプ通算）</h4>
      </div>
      {table.rows.length === 0 ? (
        <p className="online-muted">伸びた能力はありません。</p>
      ) : (
        <>
          <p className="online-camp-gain-totals">
            <strong>{grown}人</strong>が伸びました。球団全体:{' '}
            {totals
              .slice(0, 6)
              .map((t) => `${t.label}${formatGain(t.diff)}`)
              .join(' · ')}
            <small>　見出しを押すと、その項目で並べ替えます。</small>
          </p>
          <div className="online-contract-scroll">
            <table className="online-camp-result-table">
              <thead>
                <tr>
                  <th className="online-camp-result-name">選手</th>
                  {header('sum', '計')}
                  {table.columns.map((c) => header(c.key, c.label))}
                  {byRound.length > 0 && <th>クール別</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ player, values, sum, events }) => (
                  <tr key={player.id}>
                    <th scope="row" className="online-camp-result-name">
                      <PlayerStatsButton player={player} panel="abilities" />
                      <small>{POS[player.position]}</small>
                      {events.map((text, index) => (
                        <strong key={`${index}:${text}`} className="online-camp-gain-event">
                          {text}
                        </strong>
                      ))}
                    </th>
                    <td
                      className={`online-gain online-camp-gain-sum ${sum >= 0 ? 'is-up' : 'is-down'}`}
                      title="伸びた量の合計（項目ごとの伸びを足したもの）"
                    >
                      {formatGain(Math.round(sum * 10) / 10)}
                    </td>
                    {table.columns.map((c) => (
                      <React.Fragment key={c.key}>{cell(values[c.key])}</React.Fragment>
                    ))}
                    {byRound.length > 0 && (
                      <td className="online-camp-gain-rounds">
                        {byRound
                          .map((r) => {
                            // ⚠ 0 は「±0」と書く（「第1」「0」が続いて「第10」に読めた）
                            const n = Math.round(roundSum(r, player.id) * 10) / 10;
                            return `第${r.round} ${n ? formatGain(n) : '±0'}`;
                          })
                          .join(' / ')}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * 決め方の説明・4クールの伸びの目安・希望と噛み合う人数。
 * ⚠ **全部まとめて1行**（折り返しは禁じない）。キャンプはホームに出して
 *    1画面に収めるので、段落を分けると人数の多い球団で実行ボタンが出る。
 */
function CampPolicyGuide({ policy, roster, policyOf, note, hint }) {
  // ⚠ 伸びの目安は「全員同じ方針」のときだけ（選手ごとに方針が違うと1つに決まらない）
  const guide =
    policy.mode === 'team'
      ? CAMP_POLICY_GUIDE[`${policy.direction}:${policy.phase}`]
      : null;
  const moods = roster.map((p) => {
    const own = policyOf(p);
    return describeMood(p, own.direction, own.phase).tone;
  });
  const count = (tone) => moods.filter((t) => t === tone).length;
  // ⚠ 「全員同じ方針」のときだけ。選手ごとの決め方にも既定の方向・段階が敷かれているので、
  //    決め方を見ないと「いまは『全体を伸ばす×技術』です」と誤って出る
  const standard =
    (policy.mode || 'team') === 'team' &&
    policy.direction === 'balanced' &&
    policy.phase === 'skill';
  // ⚠ 読めなくはしない。長い説明は title に入れて、マウスを載せれば読める
  const title = [
    note,
    hint,
    standard
      ? 'いまは「全体を伸ばす×技術」です。試合に効きやすいミート・制球が伸びます。'
      : '「全体を伸ばす×技術」なら、ミート・制球が伸びます。',
    '基礎体力は体力・体幹の数字が大きく伸びますが、打撃・制球はほとんど伸びません。',
    '締め切りまでに回さなかったクールは、最後に指示した方針で自動で行われます。',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <p className="online-muted online-camp-note online-camp-guide" title={title}>
      {note && <span className="online-camp-guide-note">{note}</span>}
      {guide && (
        <>
          <span>野手 {guide.fielder}</span>
          <span>投手 {guide.pitcher}</span>
        </>
      )}
      <span>
        噛み合い: 意欲的 {count('good')}人・納得 {count('mid')}人・身が入らない{' '}
        {count('bad')}人
      </span>
    </p>
  );
}

/**
 * 最終クールや締め切りで手続きが閉じた後も、保存した成果を確認できる。
 *
 * ⚠ 先方指摘「キャンプ結果の表示タイミングが契約更改後になっている。キャンプ直後に」。
 *    キャンプが閉じると開幕し、ホームから手続きのページへ行く人はいないので、次に結果を見るのは
 *    契約更改のころ（手続きのページの下）だった。**ホームの上にも出し**、「閉じる」まで残す
 *    （`onHome`）。閉じた年はこのブラウザに覚え、その年のキャンプ結果はホームに出さない
 *    （手続きのページの下にはいつでもある）。シーズンの年が替わったら出さない。
 */
const CAMP_SEEN_KEY = 'baseball-online-camp-seen';
const campSeenStamp = (view) => `${view.teamName}:${view.lastCamp?.year}`;
function campSeen(view) {
  try {
    return localStorage.getItem(CAMP_SEEN_KEY) === campSeenStamp(view);
  } catch {
    return false;
  }
}
/** ホームのキャンプ結果のまとめ（何人が伸び、伸びの大きかった3人） */
function CampHomeSummary({ camp, roster }) {
  const table = campGainTable(camp?.gains || {}, roster, camp?.events || {});
  const grown = table.rows.filter((r) => r.items.some((i) => i.diff > 0));
  const top = sortCampGainRows(table.rows, 'sum', 'desc').slice(0, 3);
  const sum = (r) => r.items.reduce((n, i) => n + i.diff, 0);
  return (
    <p className="online-muted">
      キャンプが終わりました。{grown.length}人が伸びました
      {top.length > 0 && `（伸びの大きかった選手: ${top.map((r) => `${r.player.name} ${formatGain(Math.round(sum(r) * 10) / 10)}`).join('・')}）`}
      。閉じたあとも「現在の手続き」の下で見られます。
    </p>
  );
}

export function CompletedCamp({ view, onHome = false }) {
  const camp = view.lastCamp;
  const [closed, setClosed] = useState(() => onHome && campSeen(view));
  // ⚠ ホームでは**まとめの1行だけ**出し、表は押して開く（ホームは1画面に収める決まり）
  const [open, setOpen] = useState(!onHome);
  if (!camp) return null;
  // ⚠ ホームに出すのは**キャンプが終わってから開幕まで**（「キャンプ直後」）。シーズンに入ったら
  //    手続きの下（「現在の手続き」）でだけ見る。ずっと出すとホームが1画面に収まらない
  if (onHome && (closed || camp.year !== view.year || view.stage?.key === 'season')) return null;
  const close = () => {
    try {
      localStorage.setItem(CAMP_SEEN_KEY, campSeenStamp(view));
    } catch {
      /* 覚えられなくても、この画面の間は閉じる */
    }
    setClosed(true);
  };
  return (
    <section className="online-card online-camp-done" aria-label="キャンプ結果">
      <div className="online-card-heading">
        <h2>{camp.year}年目のキャンプ結果</h2>
        {onHome && (
          <button type="button" onClick={close}>
            閉じる
          </button>
        )}
      </div>
      {onHome && <CampHomeSummary camp={camp} roster={view.roster || []} />}
      {onHome && (
        <div className="online-actions">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? '表を閉じる' : '選手ごとの表を開く'}
          </button>
        </div>
      )}
      {open && <CampResultList camp={camp} roster={view.roster || []} />}
    </section>
  );
}

// 守備位置のまとまり。⚠ 一人用のキャンプ画面と同じ分け方にする
const CAMP_GROUPS = [
  { id: 'pitcher', label: '投手', has: (p) => p.position === 'pitcher' },
  { id: 'catcher', label: '捕手', has: (p) => p.position === 'catcher' },
  {
    id: 'infield',
    label: '内野手',
    has: (p) => ['first', 'second', 'third', 'short'].includes(p.position),
  },
  {
    id: 'outfield',
    label: '外野手',
    has: (p) => ['left', 'center', 'right'].includes(p.position),
  },
];

export default function CampPlanner({
  view,
  busy,
  run,
  command,
  compact = false,
}) {
  const [group, setGroup] = useState('pitcher');
  const camp = view.phase?.camp;
  const done = camp?.rounds || 0;
  const total = camp?.total || 4;
  const roster = view.roster || [];
  // ⚠ **未保存の割り当ては、再読込や表示の切り替えで消さないこと**
  //    （ほかの手続きと同じ `useDraftState`）。26人ぶん選んだあとに画面を
  //    読み直して全部消えると、やり直す気が失せる。
  //    実行済みのクールの指示（`camp.plan`）を初期値にする。
  //    ⚠ まだ回していなければ指導者の案（`camp.suggested`。「意見を聞く」「任せる」のとき）。
  //    締め切りで回さなかったクールに当たるのはこの案なので、画面もここから始める
  //    （以前は「おすすめ」から始まり、見たことのない案で締め切りに回っていた）
  const phaseId = view.phase?.id;
  const start = camp?.plan || camp?.suggested || null;
  const [savedPolicy, setPolicy] = useDraftState(
    phaseDraftName(phaseId, 'camp.policy'),
    () => start?.policy || DEFAULT_CAMP_POLICY,
  );
  const policy = withPolicyDefaults(savedPolicy);
  // 選手ごとの方針の上書き（「合わせる」で1人ずつ希望へ。指導者の案も選手ごと）
  const [overrides, setOverrides] = useDraftState(
    phaseDraftName(phaseId, 'camp.players'),
    () => start?.players || {},
  );
  const policyOf = (p) => playerPolicy(p, policy, overrides);
  const [main, setMain] = useDraftState(
    phaseDraftName(phaseId, 'camp.main'),
    () => camp?.plan?.main || {},
  );
  const [sub, setSub] = useDraftState(
    phaseDraftName(phaseId, 'camp.sub'),
    () => camp?.plan?.sub || {},
  );
  const [subTarget, setSubTarget] = useDraftState(
    phaseDraftName(phaseId, 'camp.target'),
    () => camp?.plan?.subTarget || {},
  );
  const trainingOf = (p) => {
    const own = policyOf(p);
    return resolveTraining(p, own.direction, own.phase);
  };
  const mainOf = (p) => clampMenu(main[p.id] || trainingOf(p).main, p);
  const subOf = (p) => clampSub(sub[p.id] || trainingOf(p).sub, p);
  // ⚠ 方針を変えたら**割り当ても引き直す**。方針はやる気にも効くので、
  //    方針だけ変わって練習が前のままだと噛み合いが読めない
  //    ⚠ 1人ずつの上書きも消す（決め方を選び直したら、全員その決め方に従う）
  const applyPolicy = (picked) => {
    const next = withPolicyDefaults(picked);
    setPolicy(next);
    setOverrides({});
    const nextMain = {};
    const nextSub = {};
    for (const p of roster) {
      const own = playerPolicy(p, next, {});
      const r = resolveTraining(p, own.direction, own.phase);
      nextMain[p.id] = clampMenu(r.main, p);
      nextSub[p.id] = clampSub(r.sub, p);
    }
    setMain(nextMain);
    setSub(nextSub);
  };
  // この選手だけ本人の希望に合わせる（練習もその方針で引き直す）
  const fitWish = (p) => {
    const wish = playerWish(p);
    setOverrides({ ...overrides, [p.id]: wish });
    const r = resolveTraining(p, wish.direction, wish.phase);
    setMain({ ...main, [p.id]: clampMenu(r.main, p) });
    setSub({ ...sub, [p.id]: clampSub(r.sub, p) });
  };
  const applyAll = (key, isPitcherOnly) => {
    const next = { ...main };
    for (const p of roster)
      if (
        isPitcherOnly === null ||
        (p.position === 'pitcher') === isPitcherOnly
      )
        next[p.id] = clampMenu(key, p);
    setMain(next);
  };
  const execute = () =>
    run(() =>
      command('campRound', {
        round: done + 1,
        policy,
        players: overrides,
        main: Object.fromEntries(roster.map((p) => [p.id, mainOf(p)])),
        sub: Object.fromEntries(roster.map((p) => [p.id, subOf(p)])),
        // ⚠ **いまのサブ練習に合う対象だけ送る**。練習を変えたあとに前の対象が
        //    残っていると、サーバーが「対象を選べない練習に対象が付いている」と断る
        subTarget: Object.fromEntries(
          roster
            .map((p) => [p.id, subTarget[p.id], subTargetChoices(subOf(p), p)])
            .filter(([, value, choices]) =>
              choices.some(([key]) => key === value),
            )
            .map(([id, value]) => [id, value]),
        ),
      }),
    );
  // ⚠ **守備位置で1グループずつ出す**（一人用と同じ）。24人を全部並べると
  //    1行31pxでも画面が1300px超になり、下の実行ボタンまで何度もスクロール
  //    することになる（実測で全部出すと1326px、1グループなら700px前後）。
  const groups = CAMP_GROUPS.map(({ id, label, has }) => ({
    id,
    label,
    list: roster.filter(has),
  })).filter((g) => g.list.length);
  const shownGroup = groups.find((g) => g.id === group) || groups[0];
  const finished = done >= total;
  return (
    <div className="online-camp">
      <div className="online-camp-head">
        <h3>春季キャンプ</h3>
        {/* ⚠ **締め切りをここに出す**。キャンプをホームへ移したので、上の
            手続きの帯（`online-procedure-banner`）はホームでは出さない。
            帯が持っていた締め切りの案内を落とさないよう、見出しの横に置く。
            ⚠ 行を増やさない（1画面に収めるため）。説明は title で出す */}
        {!finished && view.phase?.deadline && (
          <small
            className="online-camp-deadline"
            title="締め切りまでに終わらなかったクールは、最後に指示した内容で自動で実行します"
          >
            締め切り {formatDeadline(view.phase.deadline)}
          </small>
        )}
        {/* ⚠ 説明の段落は**title へ畳んだ**。1行17pxと余白12pxで、12人目の
            行が1画面からはみ出していた（実測 1044px）。進み具合の丸と
            「第Nクール練習を実行」で、やることは画面から読める */}
        <div
          className="online-camp-rounds"
          aria-label="クールの進み"
          title="1クールずつ実行し、伸びた能力を見て次のクールを決めます"
        >
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={i < done ? 'is-done' : i === done ? 'is-now' : ''}
            >
              {i + 1}
            </span>
          ))}
          <small>
            {done}/{total}
          </small>
        </div>
      </div>
      {finished && (
        <p className="online-muted" role="status">
          全{total}クールが終わりました。伸びた能力で
          <strong>スタメン設定・投手起用</strong>
          を整えて、月曜の開幕を待ちます。
        </p>
      )}
      {/* ⚠ **誰の案かは必ず出す**。「任せています」のときは、ここで何を選んでも
          指導者の案で決まるので、出さないと選び続けて無駄になる。
          ⚠ ここに置くのは、キャンプをホームへ出して `PhasePanel` を通らなく
          なったため（`PhasePanel` はキャンプのぶんを出さない）。スマホは
          `PhasePanel` 経由だが、同じこの部品を通るので両方に出る。
          ⚠ 1行に収める（指導者の入れ替えの案内は title へ） */}
      {!finished && view.phase?.planBy && (
        <p
          className="online-staff-note online-camp-note"
          title={
            view.staff
              ? '指導者の留任・解任・市場から呼ぶのは「指導者」の画面で決められます（キャンプの間だけ）'
              : undefined
          }
        >
          {view.phase.planBy.text}
        </p>
      )}
      {/* ⚠ **まとめはキャンプが終わってから**出す（先方指摘: キャンプ中に上に出る
          上昇のまとめは要らない。キャンプ後に選手ごとの総合上昇値を見たい）。
          キャンプ中は表の数字の横の「+〇」（直近のクールの伸び）で見る */}
      {finished && <CampResultList camp={camp} roster={roster} />}
      <section className="online-camp-bulk">
        <div className="online-camp-bulk-fields">
          {/* ⚠ 選択肢が数個のものは**ボタンを並べる**（PC版の共通のルール。
              コンボボックスは開かないと何があるか分からない） */}
          <Choice
            label="決め方"
            options={CAMP_MODE_LABELS}
            value={policy.mode || 'team'}
            disabled={busy || finished}
            onChange={(mode) => applyPolicy({ ...policy, mode })}
          />
          {(policy.mode || 'team') === 'team' && (
            <>
              <Choice
                label="育成方針"
                options={Object.fromEntries(
                  CAMP_DIRECTIONS.map((key) => [
                    key,
                    `${DIRECTIONS[key].icon} ${DIRECTIONS[key].name}`,
                  ]),
                )}
                value={policy.direction}
                disabled={busy || finished}
                onChange={(direction) => applyPolicy({ ...policy, direction })}
              />
              <Choice
                label="段階"
                options={Object.fromEntries(
                  CAMP_PHASES.map((key) => [
                    key,
                    `${PHASES[key].icon} ${PHASES[key].name}`,
                  ]),
                )}
                value={policy.phase}
                disabled={busy || finished}
                onChange={(phase) => applyPolicy({ ...policy, phase })}
              />
            </>
          )}
          <span className="online-camp-bulk-all">全員に一括:</span>
          {menusFor(false)
            .filter(([key]) => !key.startsWith('intensive_'))
            .map(([key, menu]) => (
              <button
                key={key}
                disabled={busy || finished}
                onClick={() => applyAll(key, false)}
              >
                {menu.icon} {menu.name}
              </button>
            ))}
          {menusFor(true)
            .filter(
              ([key]) => !key.startsWith('intensive_') && key !== 'fielding',
            )
            .map(([key, menu]) => (
              <button
                key={key}
                disabled={busy || finished}
                onClick={() => applyAll(key, true)}
              >
                {menu.icon} {menu.name}
              </button>
            ))}
        </div>
        {/* ⚠ いしだ指摘: どれくらい伸びるのか・おまかせでいいのかが分からない。
            実測の目安と、希望と噛み合う人数を出す（`CAMP_POLICY_GUIDE`）。
            ⚠ **決め方の説明と目安と人数で1行**。別々の段落にすると、
            「全員同じ方針」のときだけ4行になって実行ボタンが画面から出た
            （実測 1050px）。長い説明は title へ逃がす */}
        <CampPolicyGuide
          policy={policy}
          roster={roster}
          policyOf={policyOf}
          note={
            (policy.mode || 'team') === 'team'
              ? `${DIRECTIONS[policy.direction]?.description}／${PHASES[policy.phase]?.description}`
              : CAMP_MODE_NOTES[policy.mode]
          }
          hint={`本人の希望と噛み合うほど練習が身につきます（正解とは限りません）。${
            compact ? '' : '意欲の欄の「合わせる」で、1人ずつ希望に合わせられます。'
          }`}
        />
      </section>
      {/* ⚠ 携帯は表を出さない。23列は入らない。方針と実行だけで4クール回せる */}
      {compact && !finished && (
        <p className="online-muted">
          選手ごとの練習はPCで選べます。ここでは育成方針だけで進みます。
        </p>
      )}
      {/* ⚠ 携帯は表（能力の横の「+〇」）を出さないので、**直近のクールの伸びだけ**を畳んで置く。
          上に出していた「練習の成果」（通算のまとめ）は消した（先方指摘）。通算はキャンプ後に出す */}
      {compact && !finished && camp?.last && (
        <LastRoundGains last={camp.last} roster={roster} />
      )}
      {!compact && (
        <div
          className="online-segments online-camp-tabs"
          role="group"
          aria-label="守備位置"
        >
          {groups.map((g) => (
            <button
              key={g.id}
              aria-pressed={g.id === shownGroup?.id}
              onClick={() => setGroup(g.id)}
            >
              {g.label} {g.list.length}
            </button>
          ))}
        </div>
      )}
      {!compact && shownGroup && (
        <section key={shownGroup.id} className="online-camp-group">
          <CampTableScroll>
            <table>
              <thead>
                <tr>
                  <th>氏名</th>
                  {shownGroup.id !== 'pitcher' && <th>ポジ</th>}
                  <th>年齢</th>
                  <th>成長</th>
                  {/* ⚠ **プロ意識・精神・投打の列は外した**。キャンプはホームに
                      出すので1画面に収める必要があり、練習を選ぶ判断には使わない
                      （やる気は「本人の希望と方針が噛み合うか」＝意欲の列）。
                      3つとも選手の詳細（名前を押す）で見られる。 */}
                  <th>意欲</th>
                  <th title="本人が伸ばしたいと思っている方向">希望</th>
                  <th>フォーム</th>
                  <th>肩</th>
                  {shownGroup.id === 'pitcher' ? (
                    <>
                      <th>球速</th>
                      <th>制球</th>
                      <th>スピン</th>
                      <th>スタミナ</th>
                    </>
                  ) : (
                    <>
                      <th>ミート</th>
                      <th>パワー</th>
                      <th>選球眼</th>
                      <th>バント</th>
                    </>
                  )}
                  <th>走力</th>
                  <th>守備</th>
                  <th>体力</th>
                  <th>回復</th>
                  <th>体幹</th>
                  {/* ⚠ **いま持っている変化球を出す**（いしだ指摘: 現在の球種が
                      見えない）。1画面に収めるために一度外したが、どの球を
                      磨くか・何を覚えさせるかはこれを見ないと決められない。
                      ⚠ 投手の表だけ（野手の表に空の列を作らない） */}
                  {shownGroup.id === 'pitcher' && <th>変化球</th>}
                  <th className="online-camp-main">メイン</th>
                  <th className="online-camp-sub">サブ</th>
                </tr>
              </thead>
              <tbody>
                {shownGroup.list.map((p) => (
                  <PlayerRow
                    key={p.id}
                    player={p}
                    main={mainOf(p)}
                    sub={subOf(p)}
                    busy={busy || finished}
                    policy={policyOf(p)}
                    onFitWish={fitWish}
                    gains={camp?.last?.gains?.[p.id]}
                    events={camp?.last?.events?.[p.id]}
                    target={subTarget[p.id]}
                    onMain={(id2, key) => setMain({ ...main, [id2]: key })}
                    onSub={(id2, key) => {
                      setSub({ ...sub, [id2]: key });
                      // ⚠ 練習を変えたら**対象は捨てる**（別の練習の対象が残る）
                      setSubTarget({ ...subTarget, [id2]: '' });
                    }}
                    onTarget={(id2, key) =>
                      setSubTarget({ ...subTarget, [id2]: key })
                    }
                  />
                ))}
              </tbody>
            </table>
          </CampTableScroll>
          {/* ⚠ 希望の印と成長の数字の**読み方を表の下に1行で**出す。印だけ・
              倍率だけでは何のことか分からなかった（title はPCでもまず開かれない）。
              ⚠ 1行に収める。キャンプはホームに出すので1画面（1440×1000）に収める */}
          <p className="online-camp-legend">
            <span>
              希望の印：
              {Object.values(DIRECTIONS)
                .map((d) => `${d.icon}${d.name}`)
                .join(' ')}
              {' ／ '}
              {Object.values(PHASES)
                .map((d) => `${d.icon}${d.name}`)
                .join(' ')}
            </span>
            <span>成長：伸びやすさ（1.00 が並み。高いほど同じ練習でよく伸びる）</span>
            {/* ⚠ 「+〇」が何の数か書く（以前は通算で、1つのクールの伸びが分からなかった） */}
            <span>
              {camp?.last
                ? `能力の横の＋は第${camp.last.round}クールで伸びた分`
                : '能力の横の＋は、クールを実行するとそのクールで伸びた分が出ます'}
            </span>
          </p>
        </section>
      )}
      {!finished && (
        <div className="online-actions online-camp-run">
          <button className="online-primary" disabled={busy} onClick={execute}>
            第{done + 1}クール練習を実行
          </button>
        </div>
      )}
    </div>
  );
}
