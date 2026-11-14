import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRead, ReadContext } from './useRead.js';
import { teamLabel, teamShort } from './gameText.js';
import { POS } from './api.js';
import { ROSTER_LIMIT, ONLINE_ROSTER_TARGETS } from './shared.js';
import { Page } from './Page.jsx';
import { Choice } from './Choice.jsx';
import {
  ConditionMark,
  PlayerStatsButton,
  RoleMark,
} from './PlayerPerformance.jsx';
import { overviewGroup, formatStat } from './statsView.js';
import { playablePositions } from './lineupEdit.js';
import { overallScore } from './tryoutPlan.js';
import { rosterShortfall, rostersAfterTrade } from './trades.js';
import {
  rosterGroup,
  rosterCounts,
  getPitchTypeName,
} from '../utils/constants.js';
import { AbilityValue } from '../components/AbilityValue.jsx';
import {
  TRADE_FILTERS,
  TRADE_ODDS,
  cpuTradeRule,
  reinforcePoints,
  surplusPlayers,
  teamUsage,
  tradeCandidates,
  tradeOdds,
  tradeOddsBounds,
  tradeStrengthGap,
  tradeRatio,
  setTradeValues,
  tradeSlot,
  valueTiers,
} from './tradeSearch.js';

// ============================================================
// 球団間のトレード（PC）。**出す選手ともらう選手を、同じ物差しで比べて決める**。
//
// 【意図】トレードで知りたいのは「この交換で自分の球団は良くなるか」と
//   「相手が受けそうか」。そのために要るのは
//   - 選手どうしを**同じ列**で比べられること（能力・今季成績・年齢・値段の段）
//   - いま誰が**スタメン・ローテ**か（出すと穴が空く）
//   - 交換のあと両球団の**人数と構成**がどうなるか（上限・投手/捕手/野手の条件）
//   以前は名前・年齢・守備位置のチェック一覧が2つ並ぶだけで（中で送る7行ぶん）、
//   選手の力も、交換で名簿がどうなるかも画面から分からなかった（2026-11-06 の指摘）。
//
// 【形】
//   - 守備位置ごと（投手・捕手・内野手・外野手）に、**自球団と相手の選手を
//     1枚の表**に並べる（スタメン設定と同じ「比べるための1枚の表」）。
//     列がそろうので、同じ守備位置の選手を上下で見比べられる。能力の高い順（`overallScore`）。
//   - 行を押すと交換案に入る／外れる（自球団の行＝出す、相手の行＝もらう）。
//   - 右の「交換案」に、選んだ選手と、交換後の両球団の人数・構成を出す。
//     名簿が成り立たない（投手・捕手が居なくなる、野手8人割れ、上限超え）なら
//     理由を出して提案できなくする。
//   - 届いた提案・出した提案は、中身を同じ列の表で比べ、交換後の名簿も出す。
//
// ⚠ 名簿が成り立つかの判定は**サーバーと同じ関数**（`trades.js` の
//    `rosterShortfall` / `rostersAfterTrade`）を使う。画面で別の式を書くと
//    規則が2か所になる。最終の判断はサーバー（`assertTradeAllowed`）で、
//    断られたらその理由が出る。
// ⚠ 並べ替えは `overallScore`（トライアウトの画面と同じ目安）。数字は出さない（アプリと同じ。
//    「総合」はCPUの値段と別物で、並べると交渉の目安を取り違える）。代わりに値段の段を出す。
// ⚠ **補強から探す**（`ReinforcePanel`）と **CPUの見込み**（`OddsMeter`）はアプリと同じ式
//    （`tradeSearch.js` ⇔ `mobile/shared/.../TradeSearch.kt`）。
// ⚠ **相手はCPU球団でもよい**。CPUはその場で答える（受ける／逆提案／断る）。
//    以前は参加者の球団だけを相手にしていて、1人で遊んでいる間はトレードが
//    まったく使えなかった。どちらが人でどちらがCPUかは札に出す（返事が返る
//    までの時間が全く違う）。
// ⚠ 相手の名簿は**その場で取りに行く**（`useRead('team')`）。12球団ぶんを
//    いつもビューに載せると重い。
// ⚠ 逆提案は1回だけ（`trades.js` の `canCounter`）。
// ⚠ **成立につながる操作（提案・逆提案・成立させる）は確認を1段挟む**（`DealConfirm`）。
//    CPU球団は提案した瞬間に受けることがあり、成立は取り消せない。以前は押した瞬間に
//    選手が入れ替わり、出たのも「保存しました」だけで、受けたのか断ったのかも分からなかった。
//    確認には出す・もらう選手の名前と、片側が空ならその注意を出す。
// ⚠ **相手の答えを文で出す**（`offerResultText` / `respondResultText`）。CPUの答え
//    （受けた・逆提案・断った）は命令の返事に直には載らないので、送る前と後のビューを
//    比べて言い分ける（新しい提案が残っていれば逆提案か相手の返事待ち、残っていなければ成立）。
//    断ったときはサーバーが理由を返す（`openTrade`）。
// ============================================================

const GROUPS = [
  { id: 'pitcher', label: '投手', short: '投' },
  { id: 'catcher', label: '捕手', short: '捕' },
  { id: 'infielder', label: '内野手', short: '内' },
  { id: 'outfielder', label: '外野手', short: '外' },
];

const pickStats = (category, ids) => {
  const columns = overviewGroup(category).columns;
  return ids.map((id) => columns.find((c) => c.id === id)).filter(Boolean);
};

/** 投手と野手で列を変える（比べたい能力が違う）。どちらも「能力 → 今季成績」の順 */
const KINDS = {
  fielder: {
    category: 'batting',
    abilities: [
      { key: 'meet', label: 'ミ', title: 'ミート', get: (p) => p.batting?.meet },
      { key: 'power', label: 'パ', title: 'パワー', get: (p) => p.batting?.power },
      { key: 'eye', label: '眼', title: '選球眼', get: (p) => p.batting?.eye },
      { key: 'speed', label: '走', title: '走力', get: (p) => p.physical?.speed },
      { key: 'defense', label: '守', title: '守備', get: (p) => p.fielding?.defense },
      { key: 'arm', label: '肩', title: '肩力', get: (p) => p.physical?.arm },
    ],
    stats: pickStats('batting', ['pa', 'avg', 'homeruns', 'ops']),
    statLabel: { homeruns: '本塁打' },
    // 交換案の欄に出す主な能力（狭いので3つ）
    brief: ['meet', 'power', 'defense'],
  },
  pitcher: {
    category: 'pitching',
    abilities: [
      { key: 'velocity', label: '速', title: '球速', get: (p) => p.pitching?.velocity, isVel: true },
      { key: 'control', label: '制', title: '制球', get: (p) => p.pitching?.control },
      { key: 'stamina', label: 'ス', title: 'スタミナ', get: (p) => p.pitching?.stamina, isSta: true },
      { key: 'spin', label: '回', title: '回転（変化球のキレ）', get: (p) => p.pitching?.spinRate },
    ],
    stats: pickStats('pitching', ['games', 'outs', 'era', 'whip']),
    statLabel: { games: '登板' },
    brief: ['velocity', 'control', 'stamina'],
  },
};
const kindOf = (player) => (player.position === 'pitcher' ? 'pitcher' : 'fielder');
const byOverall = (a, b) => overallScore(b) - overallScore(a);

/** 変化球は「名前＋キレ」。直球は外す（全員が持っている）。キャンプの表と同じ書き方 */
function pitchTypes(player) {
  return (player.pitching?.arsenal || [])
    .filter((pitch) => pitch?.type && pitch.type !== 'straight')
    .map((pitch) => `${getPitchTypeName(pitch.type)}${pitch.level ?? ''}`)
    .join(' ');
}

/**
 * 相手の名簿。⚠ 選んだ相手のものだけ取りに行く。
 * ⚠ **読み直しの間は前の名簿を出し続けること**。`useRead` は読み直すたびに
 *    中身を空にするので、そのままだと画面の更新のたびに相手の表が
 *    「読んでいます…」に変わり、押そうとした行が消える（実測でちらついた）。
 */
function usePartnerRoster(view, partner) {
  const read = useRead(partner ? 'team' : null, {
    team: partner,
    revision: view.revision,
  });
  const last = useRef(null);
  const fresh = read.data?.teamName === partner ? read.data.roster : null;
  if (fresh) last.current = { partner, roster: fresh };
  const freshInfo = read.data?.teamName === partner ? read.data : null;
  if (freshInfo && last.current) last.current.info = freshInfo;
  const roster =
    fresh || (last.current?.partner === partner ? last.current.roster : null);
  const info =
    freshInfo || (last.current?.partner === partner ? last.current.info : null);
  return { roster, info, error: roster ? '' : read.error };
}

/**
 * リーグ全球団の名簿（自球団も。値段 `tradeValue` は球団の読み込みにだけ載る）。
 * ⚠ 補強ポイントと候補は11球団ぶんを比べるので、全部を読む。読めた球団から順に出し、
 *    全部を待たない（以前のアプリは読み終わるまで順位が出ず、最初の数秒は何も分からなかった）。
 * ⚠ 読みは覚え（`readCache.js`）を通すので、相手を選んだときの `usePartnerRoster` と
 *    同じ通信を2回しない（問い合わせの形 `{ team, revision }` をそろえている）。
 */
function useLeagueRosters(view) {
  const read = useContext(ReadContext);
  const names = useMemo(() => view.teamNames || [], [view.teamNames]);
  const revision = view.revision;
  const peekAll = () =>
    Object.fromEntries(
      names
        .map((team) => [team, read?.peek?.('team', { team, revision })])
        .filter(([, data]) => data?.roster),
    );
  const [teams, setTeams] = useState(peekAll);
  const [failed, setFailed] = useState(0);
  useEffect(() => {
    if (!read) return undefined;
    let cancelled = false;
    setTeams(peekAll());
    setFailed(0);
    // 3本ずつ読む（12本を一度に投げると、ほかの画面の読み込みが後ろで待たされる）
    const queue = [...names];
    const worker = async () => {
      while (queue.length && !cancelled) {
        const team = queue.shift();
        try {
          const data = await read('team', { team, revision });
          if (!cancelled && data?.roster)
            setTeams((old) =>
              old[team] === data ? old : { ...old, [team]: data },
            );
        } catch {
          if (!cancelled) setFailed((n) => n + 1);
        }
      }
    };
    Promise.all([worker(), worker(), worker()]);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, names, revision]);
  return { teams, total: names.length, failed };
}

/**
 * 値段の段（高・中・低）。⚠ 段の境目は**リーグ全員**の値段で引く（表に出ている人だけで
 * 引くと、相手を変えるたびに同じ選手の段が変わる）。自球団の選手はビューに値段が無いので、
 * 球団の読み込みから id で引く。
 */
const TierContext = createContext(() => null);

function useTierOf(league) {
  return useMemo(() => {
    const values = new Map();
    for (const data of Object.values(league.teams))
      for (const p of data.roster || [])
        if (Number.isFinite(p.tradeValue)) values.set(p.id, p.tradeValue);
    const tier = valueTiers([...values.values()]);
    const valueOf = (player) => player?.tradeValue ?? values.get(player?.id);
    return Object.assign((player) => tier(valueOf(player)), { valueOf });
  }, [league.teams]);
}

function ValueTier({ player }) {
  const tierOf = useContext(TierContext);
  const tier = tierOf(player);
  return tier ? (
    <span
      className={`online-trade-value is-${{ 高: 'high', 中: 'mid', 低: 'low' }[tier]}`}
    >
      {tier}
    </span>
  ) : (
    '—'
  );
}

const ODDS_HELP =
  'CPU球団は「受け取る選手の値段の合計が、出す選手の値段の合計の上乗せ分以上」なら受けます。' +
  '値段は素質（ドラフトと同じ見立て。若いほど高い）といまの持ち場での力を半々で見て、今季の成績で上下します。' +
  '相手が出す選手は、抜けると穴が空く主力ほど高くなります（控えが厚い持ち場なら上乗せはありません。何人かまとめてもらうと、まとめて空く穴で見ます）。' +
  'そこに監督の見る目（若手を高く見る・主力を高く見る など）が1人ずつかかるので、' +
  '境目の近くは「相手の監督しだい」です。足りないときは、同じ持ち場（投手・捕手・内野・外野）の安い選手に替えた逆提案が来るか、断られます。' +
  'また、値段が釣り合っていても、交換のあとのスタメン・ローテ・中継ぎの力がそちらばかり上がる交換は断ります（弱い2人で強い1人を取る形など）。';

/**
 * CPU球団が受けそうかの目安（3段のメーター）。⚠ 参加者の球団には出さない（人が決める）。
 * メーターの横軸は「出す値段 ÷ もらう値段」。境目はサーバーの決まり（`team.trade`）から引く。
 */
function OddsMeter({ rule, give, get, valueOf, roster, myRoster }) {
  if (!rule) return null;
  if (!get.length || !give.length) {
    return (
      <div className="online-trade-odds" aria-label="CPUの見込み">
        <p className="online-muted">
          出す選手ともらう選手を選ぶと、CPU球団が受けそうかの目安が出ます。
        </p>
      </div>
    );
  }
  const giveValues = give.map(valueOf).filter(Number.isFinite);
  // ⚠ 何人かまとめてもらうときは、まとめて抜けた穴の上乗せで引く（サーバーの
  //    `setValuesOf` と同じ式）。事情を抜いた値段（`tradeBase`）が無ければ1人ずつの値段
  const getValues = (
    get.length > 1 && roster && get.every((p) => Number.isFinite(p.tradeBase))
      ? setTradeValues(roster, get, (p) => p.tradeBase)
      : get.map(valueOf)
  ).filter(Number.isFinite);
  if (giveValues.length < give.length || getValues.length < get.length) {
    return (
      <div className="online-trade-odds" aria-label="CPUの見込み">
        <p className="online-muted">値段を読んでいます…</p>
      </div>
    );
  }
  // ⚠ 戦力の開きはサーバーと同じ式（`tradeStrengthGap`）。値段より先に見る（釣り合っても断るため）
  const gap =
    rule.gapLimit != null && roster && myRoster
      ? tradeStrengthGap(
          myRoster,
          roster,
          give.map((p) => p.id),
          get.map((p) => p.id),
        )
      : null;
  const lopsided = gap != null && gap > rule.gapLimit;
  const odds = lopsided ? 'lopsided' : tradeOdds(giveValues, getValues, rule);
  const ratio = tradeRatio(giveValues, getValues);
  const [low, high] = tradeOddsBounds(rule);
  // 横軸は 0 〜 境目の上の1.5倍。はみ出したら端に止める
  const max = high * 1.5;
  const at = (v) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  return (
    <div
      className="online-trade-odds"
      aria-label="CPUの見込み"
      data-odds={odds}
    >
      <p className="online-trade-odds-head">
        <span>CPUの見込み</span>
        <b className={`is-${odds}`}>{TRADE_ODDS[odds]}</b>
      </p>
      <div className="online-trade-odds-bar" aria-hidden="true">
        <span className="is-short" style={{ width: at(low) }} />
        <span
          className="is-depends"
          style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }}
        />
        <span className="is-likely" style={{ left: at(high), right: 0 }} />
        <i style={{ left: at(ratio) }} />
      </div>
      <p className="online-trade-odds-note">
        釣り合い {Math.round(ratio * 100)}%（受けるには {Math.round(low * 100)}
        〜{Math.round(high * 100)}% が境目）
      </p>
      {lopsided && (
        <p className="online-trade-odds-note is-lopsided">
          この交換でそちらの戦力が相手より {gap.toFixed(1)} 点多く上がるので、値段が釣り合っても断ります（{rule.gapLimit} 点まで）。
        </p>
      )}
      {rule.eyeNote && <p className="online-trade-odds-note">{rule.eyeNote}</p>}
      <details className="online-trade-odds-help">
        <summary>CPUの判断のしかた</summary>
        <p>{ODDS_HELP}</p>
      </details>
    </div>
  );
}

const SIDE_TEXT = { give: '出す', get: 'もらう' };

/** 選手の並びを「名前・名前」に（確認と結果の文で使う） */
const nameList = (players) => players.map((p) => p.name).join('・');
/** 結果の文の後ろに付ける「（出した選手: … ／ 来た選手: …）」 */
const dealText = (give, get) =>
  `（出した選手: ${give.length ? nameList(give) : 'なし'} ／ 来た選手: ${get.length ? nameList(get) : 'なし'}）`;

/**
 * 提案したあとの文。⚠ CPU球団の答えは返事に直には載らないので、送る前と後のビューで見分ける。
 * - 新しい提案が逆提案になって残っている → CPUの逆提案
 * - 新しい提案がそのまま残っている → 参加者の球団へ申し込んだ（相手の返事待ち）
 * - 残っていない → その場で受けた（成立）
 * 断られたときは命令が失敗して理由が返るので、ここには来ない
 */
function offerResultText({ to, give, get, before, after }) {
  const known = new Set((before?.trades || []).map((t) => t.id));
  const fresh = (after?.trades || []).find(
    (t) => !known.has(t.id) && t.mine && t.toTeam === to,
  );
  const label = teamLabel(to);
  if (fresh?.countered)
    return `${label}から逆提案が届きました。もらう選手を「${nameList(fresh.want || []) || 'なし'}」に変えてほしいそうです。上の「返事が必要な提案」で、受けるか断るかを選んでください。`;
  if (fresh)
    return `${label}へ提案しました。相手が受けた時点で成立します（返事が来るまでは取り下げられます）。`;
  // 提案が残っていないうえに、選手が実際に動いていれば成立（読み直せなかったときは決めつけない）
  const roster = after?.roster || [];
  const moved =
    give.some((p) => !roster.some((r) => r.id === p.id)) ||
    get.some((p) => roster.some((r) => r.id === p.id));
  return moved ? `${label}が受けました。トレードが成立しました${dealText(give, get)}。` : '';
}

/** 返事をしたあとの文 */
function respondResultText({ action, trade, partner, give, get }) {
  const label = teamLabel(partner);
  if (action === 'accept') return `トレードが成立しました${dealText(give, get)}。`;
  if (action === 'counter')
    return `${label}へ逆提案を返しました。相手が受けた時点で成立します。`;
  if (trade.mine)
    return trade.countered
      ? `${label}の逆提案を断りました。この提案はなくなりました。`
      : `${label}への提案を取り下げました。`;
  return `${label}からの提案を断りました。`;
}

/**
 * 成立につながる操作の前の確認。出す・もらう選手と、成立したら取り消せないこと。
 * ⚠ 片側が空でも止めはしない（渡すだけ・もらうだけも提案はできる）が、注意を出す。
 */
function DealConfirm({ give, get, note, confirmLabel, busy, onConfirm, onBack }) {
  return (
    <div className="online-trade-confirm" role="group" aria-label="トレードの確認">
      <p className="online-trade-confirm-head">この内容でよいか確かめてください</p>
      <dl>
        <div className="is-give">
          <dt>出す</dt>
          <dd>{give.length ? nameList(give) : 'なし'}</dd>
        </div>
        <div className="is-get">
          <dt>もらう</dt>
          <dd>{get.length ? nameList(get) : 'なし'}</dd>
        </div>
      </dl>
      {!give.length && (
        <p className="online-trade-warn">
          出す選手がいません。相手の選手をもらうだけの申し込みです。
        </p>
      )}
      {!get.length && (
        <p className="online-trade-warn">
          もらう選手がいません。選手を渡すだけで、代わりの選手は来ません。
        </p>
      )}
      <p>{note}</p>
      <div className="online-actions">
        <button className="online-primary" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" disabled={busy} onClick={onBack}>
          戻る
        </button>
      </div>
    </div>
  );
}

/** 直前の操作の結果（相手の答え・断られた理由）。⚠ 次の操作を始めるまで残す（帯はすぐ消える） */
function TradeResult({ result }) {
  if (!result?.text) return null;
  return (
    <p
      className={`online-trade-result ${result.ok ? '' : 'is-bad'}`}
      aria-live="polite"
    >
      {result.text}
    </p>
  );
}

function HeaderRow({ kind, lead = null }) {
  const k = KINDS[kind];
  return (
    <tr>
      <th className="online-lineup-slot" />
      {lead}
      <th className="online-lineup-person">選手</th>
      <th className="online-trade-poscell">{kind === 'pitcher' ? '投' : '守備'}</th>
      <th>年齢</th>
      <th
        className="is-sep"
        title="CPU球団がトレードで付ける値段の段（リーグ全員の上3分の1が高・下3分の1が低）。若いほど高い"
      >
        値段
      </th>
      {k.abilities.map((a, i) => (
        <th key={a.key} className={i === 0 ? 'is-sep' : ''} title={a.title}>
          {a.label}
        </th>
      ))}
      {k.stats.map((column, i) => (
        <th
          key={column.id}
          className={i === 0 ? 'is-sep is-stat' : 'is-stat'}
          title={`今季の${column.label}`}
        >
          {k.statLabel[column.id] || column.label}
        </th>
      ))}
      {kind === 'pitcher' && <th className="is-sep online-trade-pitches">変化球</th>}
    </tr>
  );
}

const columnCount = (kind) =>
  5 + KINDS[kind].abilities.length + KINDS[kind].stats.length + (kind === 'pitcher' ? 1 : 0);

/** 1人ぶんの列（自球団と相手で**同じ部品**を使う） */
function PlayerCells({ player, kind, lineup }) {
  const k = KINDS[kind];
  return (
    <>
      <td className="online-lineup-person">
        <span onClick={(e) => e.stopPropagation()}>
          <PlayerStatsButton player={player} category={k.category} group="basic" />
        </span>
        <ConditionMark player={player} />
        {/* ⚠ 起用の札は自球団だけ（相手の打順・ローテは公開していない） */}
        <RoleMark player={player} lineup={lineup} />
      </td>
      <td className="online-trade-poscell">
        {kind === 'pitcher' ? (
          player.physical?.throws === 'left' ? '左' : '右'
        ) : (
          <span
            className="online-lineup-playable"
            title="本職と、ほかに守れる位置（適性の高い順）"
          >
            <span className="online-lineup-pos is-bench">{POS[player.position] || '?'}</span>
            {playablePositions(player)
              .filter((e) => e.position !== player.position)
              .slice(0, 2)
              .map((e) => (
                <span key={e.position}>{POS[e.position]}</span>
              ))}
          </span>
        )}
      </td>
      <td>{player.age ?? '—'}</td>
      <td className="is-sep online-trade-tier">
        <ValueTier player={player} />
      </td>
      {k.abilities.map((a, i) => (
        <td key={a.key} className={i === 0 ? 'is-sep' : ''}>
          <AbilityValue value={a.get(player)} isVel={a.isVel} isSta={a.isSta} placeholder="—" />
        </td>
      ))}
      {k.stats.map((column, i) => (
        <td key={column.id} className={i === 0 ? 'is-sep is-stat' : 'is-stat'}>
          {formatStat(column, column.get(player))}
        </td>
      ))}
      {kind === 'pitcher' && (
        <td className="is-sep online-trade-pitches" title={pitchTypes(player)}>
          {pitchTypes(player) || '—'}
        </td>
      )}
    </>
  );
}

/**
 * 選手の表。`sections` ごとに見出しの行を置き、同じ列で並べる。
 * `onToggle` があれば行を押して選ぶ（交換案に入れる／外す）。無ければ見るだけ。
 */
function TradeTable({ kind, sections, onToggle, busy }) {
  const count = columnCount(kind);
  return (
    <table className="online-lineup-table online-trade-table" data-kind={kind}>
      <thead>
        <HeaderRow kind={kind} />
      </thead>
      {sections.map((section) => (
        <tbody key={section.key} aria-label={section.label} data-side={section.side}>
          <tr className="online-lineup-group">
            <th colSpan={count}>
              {section.title}
              {section.note && <small>{section.note}</small>}
            </th>
          </tr>
          {section.players.map((player) => {
            const picked = section.picked?.includes(player.id);
            const toggle = () => !busy && onToggle?.(section.side, player.id);
            return (
              <tr
                key={player.id}
                data-player={player.id}
                className={[
                  'online-lineup-row',
                  onToggle ? '' : 'is-static',
                  picked ? `is-picked is-${section.side}` : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={onToggle ? toggle : undefined}
              >
                <td className="online-lineup-slot">
                  {onToggle ? (
                    <button
                      type="button"
                      className="online-trade-toggle"
                      aria-pressed={!!picked}
                      aria-label={`${player.name}を${SIDE_TEXT[section.side]}選手に${picked ? 'しない' : 'する'}`}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle();
                      }}
                    >
                      {picked ? SIDE_TEXT[section.side] : '＋'}
                    </button>
                  ) : (
                    <span className={`online-trade-chip is-${section.side}`}>
                      {SIDE_TEXT[section.side]}
                    </span>
                  )}
                </td>
                <PlayerCells player={player} kind={kind} lineup={section.lineup} />
              </tr>
            );
          })}
          {!section.players.length && (
            <tr>
              <td colSpan={count} className="online-muted online-trade-empty">
                {section.empty || 'この守備位置の選手は居ません。'}
              </td>
            </tr>
          )}
        </tbody>
      ))}
    </table>
  );
}

/** 交換のあとの1球団の人数と構成。⚠ 条件はサーバーと同じ `rosterShortfall` */
function TeamImpact({ name, own, before, after }) {
  const was = rosterCounts(before);
  const now = rosterCounts(after);
  const problems = rosterShortfall(after);
  return (
    <div
      className={`online-trade-impact-team ${problems.length ? 'is-bad' : ''}`}
      data-team={name}
    >
      <h4>
        {teamShort(name)}
        <small>{own ? '自球団' : '相手'}</small>
      </h4>
      <p className="online-trade-impact-size">
        {before.length === after.length ? (
          <>{after.length}人</>
        ) : (
          <>
            {before.length} → <b>{after.length}</b>人
          </>
        )}
        <small> / 上限{ROSTER_LIMIT}</small>
      </p>
      <ul>
        {GROUPS.map((g) => {
          const delta = now[g.id] - was[g.id];
          return (
            <li
              key={g.id}
              className={delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}
              title={`${g.label}（目安 ${ONLINE_ROSTER_TARGETS[g.id]}人）`}
            >
              {g.short}
              {delta ? (
                <>
                  {was[g.id]}→<b>{now[g.id]}</b>
                </>
              ) : (
                now[g.id]
              )}
            </li>
          );
        })}
      </ul>
      {problems.length > 0 && (
        <p role="alert" className="online-trade-problem">
          {problems.join('・')}
        </p>
      )}
    </div>
  );
}

/** 交換のあとの両球団。⚠ 相手の名簿が読めるまでは出さない（数えられない） */
function Impact({ view, partner, theirRoster, giveIds, getIds }) {
  if (!theirRoster) return null;
  const myRoster = view.roster || [];
  const after = rostersAfterTrade(myRoster, theirRoster, giveIds, getIds);
  return (
    <div className="online-trade-impact" aria-label="交換のあとの名簿">
      <TeamImpact name={view.teamName} own before={myRoster} after={after.from} />
      <TeamImpact name={partner} before={theirRoster} after={after.to} />
    </div>
  );
}

/** 交換で名簿が成り立たなくなるか（どちらかの球団）。⚠ サーバーと同じ判定 */
function dealProblems(myRoster, theirRoster, giveIds, getIds) {
  if (!theirRoster) return [];
  const after = rostersAfterTrade(myRoster, theirRoster, giveIds, getIds);
  return [...rosterShortfall(after.from), ...rosterShortfall(after.to)];
}

/**
 * 交換案の欄（狭い）。選んだ選手を1行ずつ、主な能力と値段の段で。
 * `detail` のときは名前を押すと能力と成績を開く（スマホの返事。表が無いので、ここで確かめる）
 */
function DealList({ side, players, onRemove, busy, detail = false, emptyText }) {
  return (
    <div className={`online-trade-deal-side is-${side}`}>
      <h4>
        {SIDE_TEXT[side]}
        <small>{players.length}人</small>
      </h4>
      {players.length ? (
        <ul>
          {players.map((player) => {
            const k = KINDS[kindOf(player)];
            return (
              <li key={player.id}>
                <span className="online-trade-deal-name">
                  {detail ? (
                    <PlayerStatsButton player={player} panel="abilities" />
                  ) : (
                    <b>{player.name}</b>
                  )}
                  <small>
                    {POS[player.position]}·{player.age}歳
                  </small>
                </span>
                <span className="online-trade-deal-values">
                  <span title="値段（CPU球団の見立て）">
                    値<ValueTier player={player} />
                  </span>
                  {k.brief.map((key) => {
                    const a = k.abilities.find((x) => x.key === key);
                    return (
                      <span key={key} title={a.title}>
                        {a.label}
                        <AbilityValue value={a.get(player)} isVel={a.isVel} isSta={a.isSta} placeholder="—" />
                      </span>
                    );
                  })}
                </span>
                {onRemove && (
                  <button
                    type="button"
                    className="online-trade-remove"
                    aria-label={`${player.name}を外す`}
                    disabled={busy}
                    onClick={() => onRemove(side, player.id)}
                  >
                    外す
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="online-muted">
          {emptyText ||
            (side === 'give' ? '自球団の行を押して選びます' : '相手の行を押して選びます')}
        </p>
      )}
    </div>
  );
}

/**
 * 提案を作る／逆提案を作る。左に守備位置ごとの表（自球団と相手）、右に交換案。
 * `give` は自球団が出す選手、`get` は相手からもらう選手（いつも**自分から見た**向き）。
 */
function TradeComposer({
  view,
  partners,
  humans,
  lockedPartner = null,
  initialPartner = null,
  initialGive = [],
  initialGet = [],
  initialGroup = null,
  submitLabel,
  confirmLabel,
  busy,
  onSubmit,
  onCancel,
}) {
  const [chosen, setChosen] = useState(
    lockedPartner || initialPartner || partners[0] || '',
  );
  const tierOf = useContext(TierContext);
  // 確認の欄を開いているか・直前の結果（`TradeResult`）
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);
  // ⚠ 相手の一覧は参加者の出入りで変わる。選んでいた相手が居なくなったら先頭へ
  const partner =
    lockedPartner || (partners.includes(chosen) ? chosen : partners[0] || '');
  const [give, setGive] = useState(initialGive);
  const [get, setGet] = useState(initialGet);
  const [group, setGroup] = useState(() => {
    if (initialGroup) return initialGroup;
    const first = initialGive
      .map((id) => (view.roster || []).find((p) => p.id === id))
      .find(Boolean);
    return first ? rosterGroup(first.position) : 'pitcher';
  });
  const theirs = usePartnerRoster(view, partner);
  const myRoster = view.roster || [];
  const theirRoster = theirs.roster;
  // ⚠ 名簿から居なくなった選手（別のトレードで移った）は選択から外して数える
  const giveIds = give.filter((id) => myRoster.some((p) => p.id === id));
  const getIds = theirRoster
    ? get.filter((id) => theirRoster.some((p) => p.id === id))
    : get;
  const givePlayers = giveIds.map((id) => myRoster.find((p) => p.id === id));
  const getPlayers = theirRoster
    ? getIds.map((id) => theirRoster.find((p) => p.id === id))
    : [];
  const toggle = (side, id) => {
    const [list, setList] = side === 'give' ? [give, setGive] : [get, setGet];
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    // 中身を変えたら確認をやり直す（確かめた内容と送る内容を食い違わせない）
    setConfirming(false);
    setResult(null);
  };
  // ⚠ 逆提案（相手が決まっている）は参加者どうし。CPU球団は逆提案を受けない
  const cpu = !lockedPartner && !humans?.has(partner);
  const send = async () => {
    const outcome = await onSubmit(partner, giveIds, getIds, {
      give: givePlayers,
      get: getPlayers,
      reset: () => {
        setGive([]);
        setGet([]);
      },
    });
    setConfirming(false);
    setResult(outcome || null);
  };
  const problems = dealProblems(myRoster, theirRoster, giveIds, getIds);
  const empty = giveIds.length + getIds.length === 0;
  const inGroup = (players) =>
    players.filter((p) => rosterGroup(p.position) === group).sort(byOverall);
  const kind = group === 'pitcher' ? 'pitcher' : 'fielder';
  const pickedIn = (id) =>
    [...givePlayers, ...getPlayers].filter((p) => rosterGroup(p.position) === id)
      .length;
  return (
    <div className="online-trade-composer">
      {!lockedPartner && (
        <Choice
          label="相手の球団"
          /* ⚠ **どちらが人でどちらがCPUか分かるようにする**。返事が返るまでの
             時間が全く違う（CPUはその場、人は相手が開くまで） */
          options={Object.fromEntries(
            partners.map((name) => [
              name,
              `${teamLabel(name)}${humans?.has(name) ? '' : '（CPU）'}`,
            ]),
          )}
          value={partner}
          disabled={busy}
          onChange={(name) => {
            setChosen(name);
            setGet([]);
            setConfirming(false);
          }}
        />
      )}
      <div className="online-trade-work">
        <div className="online-trade-board">
          <Choice
            label="守備位置"
            options={Object.fromEntries(
              GROUPS.map((g) => [
                g.id,
                pickedIn(g.id) ? `${g.label}（${pickedIn(g.id)}人選択）` : g.label,
              ]),
            )}
            value={group}
            onChange={setGroup}
          />
          <div className="online-lineup-scroll">
            <TradeTable
              kind={kind}
              busy={busy}
              onToggle={toggle}
              sections={[
                {
                  key: 'mine',
                  side: 'give',
                  label: '自球団の選手',
                  title: `${teamLabel(view.teamName)}（自球団）`,
                  note: '押すと「出す」に入ります。能力の高い順',
                  players: inGroup(myRoster),
                  picked: giveIds,
                  lineup: view.lineup,
                },
                {
                  key: 'theirs',
                  side: 'get',
                  label: '相手の選手',
                  title: teamLabel(partner),
                  note: '押すと「もらう」に入ります。能力の高い順',
                  players: theirRoster ? inGroup(theirRoster) : [],
                  picked: getIds,
                  empty: theirs.error
                    ? `名簿を読めませんでした（${theirs.error}）`
                    : theirRoster
                      ? undefined
                      : '名簿を読んでいます…',
                },
              ]}
            />
          </div>
        </div>
        <aside className="online-trade-deal" aria-label="交換案">
          <h3>交換案</h3>
          <DealList side="give" players={givePlayers} onRemove={toggle} busy={busy} />
          <DealList side="get" players={getPlayers} onRemove={toggle} busy={busy} />
          <Impact
            view={view}
            partner={partner}
            theirRoster={theirRoster}
            giveIds={giveIds}
            getIds={getIds}
          />
          {/* ⚠ CPU球団だけ（参加者の球団は人が決める）。逆提案を作るときも出さない */}
          {cpu && (
            <OddsMeter
              rule={cpuTradeRule(theirs.info)}
              give={givePlayers}
              get={getPlayers}
              valueOf={tierOf.valueOf || (() => undefined)}
              roster={theirRoster}
              myRoster={view.roster}
            />
          )}
          {confirming && !(!partner || empty || problems.length > 0 || !theirRoster) ? (
            <DealConfirm
              give={givePlayers}
              get={getPlayers}
              note={
                cpu
                  ? 'CPU球団はその場で答えます。受けた場合はすぐに選手が入れ替わり、取り消せません。'
                  : '相手が受けた時点で選手が入れ替わり、取り消せません（返事が来るまでは取り下げられます）。'
              }
              confirmLabel={confirmLabel}
              busy={busy}
              onConfirm={send}
              onBack={() => setConfirming(false)}
            />
          ) : (
            <div className="online-actions">
              <button
                className="online-primary"
                disabled={busy || !partner || empty || problems.length > 0 || !theirRoster}
                onClick={() => {
                  setResult(null);
                  setConfirming(true);
                }}
              >
                {submitLabel}
              </button>
              {onCancel && (
                <button type="button" disabled={busy} onClick={onCancel}>
                  やめる
                </button>
              )}
            </div>
          )}
          <TradeResult result={result} />
          {problems.length > 0 && (
            <p className="online-muted">
              交換のあとどちらかの名簿が成り立たないため、提案できません。
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

/** 提案の中身（id と名前）を、名簿の選手（能力・成績つき）に引き当てる */
function dealPlayers(view, theirRoster, giveEntries, getEntries) {
  const found = (entries, roster) =>
    entries.map((e) => roster?.find((p) => p.id === e.id)).filter(Boolean);
  return {
    give: found(giveEntries, view.roster || []),
    get: found(getEntries, theirRoster),
    // ⚠ 居ない選手（別のトレードで移った）は**消さずに出す**。黙って減ると
    //    「出したはずの選手が提案から消えた」ように見える
    gone: [...giveEntries, ...getEntries].filter((e) => e.gone),
  };
}

/** 別のトレードで移った選手の知らせ（PC・スマホ） */
function GoneNote({ gone }) {
  if (!gone.length) return null;
  return (
    <p role="alert">
      {gone.map((e) => e.name).join('・')}
      は別のトレードで移っています。受けても成立しません。
    </p>
  );
}

/**
 * スマホの返事で見せる提案の中身。PCの表（10列ほど）は幅に入らないので、
 * 交換案の欄と同じ形（`DealList`）で出す・もらう選手を縦に並べ、交換のあとの名簿を添える
 */
function MobileDeal({ view, partner, theirRoster, theirError, giveEntries, getEntries }) {
  const { give, get, gone } = dealPlayers(view, theirRoster, giveEntries, getEntries);
  return (
    <>
      <div className="online-trade-deal online-trade-mobile-deal">
        <DealList side="give" players={give} detail emptyText="出す選手はいません" />
        {theirRoster ? (
          <DealList side="get" players={get} detail emptyText="もらう選手はいません" />
        ) : (
          <p className="online-muted">
            {theirError ? `相手の名簿を読めませんでした（${theirError}）` : '相手の名簿を読んでいます…'}
          </p>
        )}
      </div>
      <GoneNote gone={gone} />
      <Impact
        view={view}
        partner={partner}
        theirRoster={theirRoster}
        giveIds={give.map((p) => p.id)}
        getIds={get.map((p) => p.id)}
      />
    </>
  );
}

/** 届いた提案・出した提案の中身。出す選手ともらう選手を同じ列の表で */
function TradeCompare({ view, partner, theirRoster, theirError, giveEntries, getEntries }) {
  const { give, get, gone } = dealPlayers(view, theirRoster, giveEntries, getEntries);
  const kinds = ['pitcher', 'fielder'].filter((kind) =>
    [...give, ...get].some((p) => kindOf(p) === kind),
  );
  return (
    <>
      {!theirRoster && (
        <p className="online-muted">
          {theirError ? `相手の名簿を読めませんでした（${theirError}）` : '相手の名簿を読んでいます…'}
        </p>
      )}
      {theirRoster && (
        <div className="online-lineup-scroll">
          {kinds.map((kind) => (
            <TradeTable
              key={kind}
              kind={kind}
              // ⚠ 空の側は出さない（「投手はもらいません」の行が並ぶと読みにくい）
              sections={[
                {
                  key: 'give',
                  side: 'give',
                  label: '出す選手',
                  title: `出す（${teamLabel(view.teamName)}）`,
                  players: give.filter((p) => kindOf(p) === kind),
                  lineup: view.lineup,
                },
                {
                  key: 'get',
                  side: 'get',
                  label: 'もらう選手',
                  title: `もらう（${teamLabel(partner)}）`,
                  players: get.filter((p) => kindOf(p) === kind),
                },
              ].filter((section) => section.players.length)}
            />
          ))}
        </div>
      )}
      <GoneNote gone={gone} />
      <Impact
        view={view}
        partner={partner}
        theirRoster={theirRoster}
        giveIds={give.map((p) => p.id)}
        getIds={get.map((p) => p.id)}
      />
    </>
  );
}

function TradeCard({ view, trade, busy, run, command, onResult, mobile = false }) {
  const [countering, setCountering] = useState(false);
  // 「この内容で成立させる」の確認を開いているか
  const [accepting, setAccepting] = useState(false);
  // 「断る」の確認を開いているか（スマホだけ。下の注）
  const [rejecting, setRejecting] = useState(false);
  const partner = trade.mine ? trade.toTeam : trade.fromTeam;
  // ⚠ **自分から見た向きに直すこと**。`trade.offer` はいつも「提案した側
  //    （`fromTeam`）が出す選手」なので、提案を受けた側から見ると相手の選手
  const giveEntries = trade.mine ? trade.offer : trade.want;
  const getEntries = trade.mine ? trade.want : trade.offer;
  const theirs = usePartnerRoster(view, partner);
  // 返事を送り、結果の文をページの上に出す（成立・断ると、このカードは消える）
  // ⚠ **スマホは共通の帯（トースト）を出さない**。結果は「トレードの返事」の枠の文
  //    （`TradeResult`）に出していて、帯がそのすぐ上に浮いて同じ文が2つ重なっていた。
  //    枠の文は次の操作まで残るので、すぐ消える帯の方をやめる。PCは帯が右下・文がページの
  //    上と離れていて、下の方のカードで返事をしたときは帯でしか見えないので残す
  const respond = async (action, payload, players = {}) => {
    let text = '';
    const outcome = await run(async () => {
      text = await command(
        'tradeRespond',
        { tradeId: trade.id, action, ...payload },
        {
          message: () =>
            respondResultText({
              action,
              trade,
              partner,
              give: players.give || [],
              get: players.get || [],
            }),
          toast: !mobile,
        },
      );
    });
    setAccepting(false);
    setRejecting(false);
    onResult?.(outcome.ok ? { ok: true, text } : { ok: false, text: outcome.error });
    return outcome;
  };
  const stale = [...trade.offer, ...trade.want].some((p) => p.gone);
  const problems = dealProblems(
    view.roster || [],
    theirs.roster,
    giveEntries.filter((e) => !e.gone).map((e) => e.id),
    getEntries.filter((e) => !e.gone).map((e) => e.id),
  );
  return (
    <section className="online-card online-trade-card" data-trade={trade.id}>
      <div className="online-card-heading">
        <h3>
          {/* ⚠ 逆提案が返ってきたら**そう書く**。「へ提案中」のままだと、
              自分の返事待ちなのに相手を待っているように読める */}
          {trade.mine
            ? trade.countered
              ? `${teamLabel(trade.toTeam)} からの逆提案`
              : `${teamLabel(trade.toTeam)} へ提案中`
            : `${teamLabel(trade.fromTeam)} からの提案`}
        </h3>
        <small className={trade.myTurn ? 'online-own-text' : 'online-muted'}>
          {trade.myTurn ? 'あなたの返事待ち' : '相手の返事待ち'}
          {trade.countered && '（逆提案あり）'}
        </small>
      </div>
      {!countering &&
        (mobile ? (
          <MobileDeal
            view={view}
            partner={partner}
            theirRoster={theirs.roster}
            theirError={theirs.error}
            giveEntries={giveEntries}
            getEntries={getEntries}
          />
        ) : (
          <TradeCompare
            view={view}
            partner={partner}
            theirRoster={theirs.roster}
            theirError={theirs.error}
            giveEntries={giveEntries}
            getEntries={getEntries}
          />
        ))}
      {trade.myTurn && !countering && accepting && !(stale || problems.length > 0) && (
        <DealConfirm
          give={giveEntries}
          get={getEntries}
          note="成立させると、すぐに選手が入れ替わります。取り消せません。"
          confirmLabel="成立させる"
          busy={busy}
          onConfirm={() =>
            respond('accept', {}, { give: giveEntries, get: getEntries })
          }
          onBack={() => setAccepting(false)}
        />
      )}
      {/* ⚠ **スマホでは「断る」にも確認を挟む**（アプリと同じ）。指の届く所に「成立させる」と
          並んでいて押し違えやすく、断った提案は消えて戻せない。PCはそのまま（表の下で押し違えにくい） */}
      {mobile && rejecting && (
        <div className="online-trade-confirm" role="group" aria-label="断る前の確認">
          <p className="online-trade-confirm-head">提案を断りますか？</p>
          <p>この提案は消えます。</p>
          <div className="online-actions">
            <button disabled={busy} onClick={() => respond('reject')}>
              断る
            </button>
            <button type="button" disabled={busy} onClick={() => setRejecting(false)}>
              戻る
            </button>
          </div>
        </div>
      )}
      {trade.myTurn && !countering && !rejecting && !(accepting && !(stale || problems.length > 0)) && (
        <div className="online-actions">
          <button
            className="online-primary"
            disabled={busy || stale || problems.length > 0}
            onClick={() => setAccepting(true)}
          >
            この内容で成立させる
          </button>
          {/* ⚠ 逆提案は1回だけ。2回目の返事では出さない。
              スマホWebは受ける・断るだけ（逆提案の表は幅に入らない。PCかアプリで） */}
          {trade.canCounter && !mobile && (
            <button disabled={busy} onClick={() => setCountering(true)}>
              逆提案する
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => (mobile ? setRejecting(true) : respond('reject'))}
          >
            断る
          </button>
        </div>
      )}
      {trade.myTurn && countering && (
        <>
          <p className="online-muted">
            中身を作り替えて返します。
            <strong>逆提案はこの1回だけ</strong>
            で、相手が受けなければこの提案は消えます。
          </p>
          <TradeComposer
            view={view}
            partners={[partner]}
            lockedPartner={partner}
            initialGive={giveEntries.filter((e) => !e.gone).map((e) => e.id)}
            initialGet={getEntries.filter((e) => !e.gone).map((e) => e.id)}
            submitLabel="この内容で返す"
            confirmLabel="逆提案を送る"
            busy={busy}
            onCancel={() => setCountering(false)}
            onSubmit={async (_, give, get) => {
              const outcome = await respond('counter', {
                // ⚠ `offer` はいつも**提案した側**が出す選手。向きを変えない
                offer: trade.mine ? give : get,
                want: trade.mine ? get : give,
              });
              if (outcome.ok) setCountering(false);
              // 結果（失敗の理由も）はページの上（`onResult`）に出している
              return null;
            }}
          />
        </>
      )}
      {!trade.myTurn && (
        <div className="online-actions">
          <button disabled={busy} onClick={() => respond('reject')}>
            {trade.mine ? '取り下げる' : '断る'}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * スマホWebのトレードの返事（届いた提案を受ける・断る。オーナーの判断1・案B ②）。
 * ⚠ 以前はホームに「PCかアプリで返事してください」と出すだけで、スマホWebだけの人は
 *    提案に答えられず、放っておくしかなかった（提案に期限は無く、返事か取り下げまで残る）。
 * ⚠ 返事はPCと同じ部品（`TradeCard`）・同じ命令（`tradeRespond`）・同じ確認（`DealConfirm`）。
 *    新しい提案と逆提案はPCかアプリのまま（選ぶ表が幅に入らない）
 */
export function MobileTradeReplies({ view, busy, run, command }) {
  const waiting = (view.trades || []).filter((t) => t.myTurn);
  // 返事の結果（成立・断るとカードごと消えるので、上に残す。PCと同じ）
  const [answered, setAnswered] = useState(null);
  return (
    <>
      <section className="online-card">
        <h2>トレードの返事</h2>
        <p className="online-muted">
          届いた提案を受けるか断るかを選びます。選手の名前を押すと、能力と今季の成績を見られます。
          新しい提案と逆提案はPCかアプリでできます。
        </p>
        <TradeResult result={answered} />
        {!waiting.length && <p>返事が必要な提案はありません。</p>}
      </section>
      {waiting.map((t) => (
        <TradeCard
          key={t.id}
          view={view}
          trade={t}
          busy={busy}
          run={run}
          command={command}
          onResult={setAnswered}
          mobile
        />
      ))}
    </>
  );
}

/** 候補の表の列（前に足す分）。`PlayerCells` の前に置く */
const CANDIDATE_LEAD = (
  <>
    <th>球団</th>
    <th title="今の自球団の一番手と比べた、その持ち場での力の差（目安）">差</th>
  </>
);

/**
 * 補強から探す（PC）。⚠ トレードは「自球団のどこを強くしたいか」から始まる（いしだ 2026-11-13）。
 * 相手球団を先に選ぶ形だと、欲しい選手を探すのに11球団を1つずつ開くしかなかった。
 *   - 補強ポイント … 持ち場ごとに、自球団の一番手がリーグで何位か・控えがいるか（弱い順）
 *   - 候補 … 押した持ち場を他球団の誰が担えるか。型で絞れる。「この選手で考える」で下の提案へ
 *   - 余りを出す … 起用していない選手のうち、他球団なら一番手になれる人と、その球団
 * ⚠ 力は画面の目安（`tradeSearch.js`。アプリと同じ式）。試合の強さはサーバーの演算で決まる。
 */
function ReinforcePanel({ view, league, busy, onStart }) {
  const [mode, setMode] = useState(null);
  const [filterKey, setFilterKey] = useState('');
  const mine = view.roster || [];
  const usage = useMemo(() => teamUsage(view.lineup), [view.lineup]);
  const others = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(league.teams)
          .filter(([name]) => name !== view.teamName)
          .map(([name, data]) => [name, data.roster || []]),
      ),
    [league.teams, view.teamName],
  );
  const loaded = Object.keys(others).length;
  const expected = Math.max(0, league.total - 1);
  const points = useMemo(
    () => reinforcePoints(mine, usage, others),
    [mine, usage, others],
  );
  const slot = mode && mode !== 'surplus' ? tradeSlot(mode) : null;
  const filters = TRADE_FILTERS.filter(
    (f) => !slot || f.pitcher == null || f.pitcher === slot.pitcher,
  );
  const filter = filters.find((f) => f.key === filterKey) || null;
  const candidates = useMemo(
    () =>
      slot
        ? tradeCandidates(slot.key, mine, usage, others, filter).slice(0, 30)
        : [],
    [slot, mine, usage, others, filter],
  );
  const surplus = useMemo(
    () => (mode === 'surplus' ? surplusPlayers(mine, usage, others) : []),
    [mode, mine, usage, others],
  );
  const kind = slot?.pitcher ? 'pitcher' : 'fielder';
  return (
    <section
      className="online-card online-trade-search"
      aria-label="補強から探す"
    >
      <h2>補強から探す</h2>
      <p className="online-muted">
        持ち場ごとに、自球団の一番手がリーグで何位かを弱い順に並べています。
        押すと、その持ち場を担える他球団の選手が出ます（力は能力と適性から出した目安です）。
        {loaded < expected &&
          ` 各球団の名簿を読んでいます（${loaded}/${expected}）。順位は読めた球団の中での順位です。`}
        {league.failed > 0 && ` 読めなかった球団が${league.failed}つあります。`}
      </p>
      <div className="online-lineup-scroll">
        <table className="online-lineup-table online-trade-points">
          <thead>
            <tr>
              <th>持ち場</th>
              <th>今の一番手</th>
              <th title="自球団を含む、読めた球団の中での順位（1位がいちばん強い）">
                リーグ順位
              </th>
              <th title="打順の外に、その位置を守れる（適性60以上）野手がいるか">
                控え
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr
                key={point.slot.key}
                className={[
                  'online-lineup-row',
                  mode === point.slot.key ? 'is-picked' : '',
                  point.rank > point.teams / 2 ? 'is-weak' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <th scope="row">{point.slot.label}</th>
                <td>
                  {point.holder ? (
                    <PlayerStatsButton
                      player={point.holder}
                      category={point.slot.pitcher ? 'pitching' : 'batting'}
                    />
                  ) : (
                    <span className="online-muted">居ない</span>
                  )}
                  {point.slot.key === 'sp' && point.holder && (
                    <small>（ローテの5番手）</small>
                  )}
                </td>
                <td className="online-trade-rank">
                  <b>{point.rank}</b>位<small> / {point.teams}</small>
                </td>
                <td>
                  {point.slot.pitcher ? (
                    '—'
                  ) : point.noBackup ? (
                    <b className="online-trade-nobackup">なし</b>
                  ) : (
                    'あり'
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    data-slot={point.slot.key}
                    aria-pressed={mode === point.slot.key}
                    onClick={() =>
                      setMode(mode === point.slot.key ? null : point.slot.key)
                    }
                  >
                    候補を見る
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="online-actions">
        <button
          type="button"
          aria-pressed={mode === 'surplus'}
          onClick={() => setMode(mode === 'surplus' ? null : 'surplus')}
        >
          余りを出す（起用していない選手の行き先）
        </button>
      </div>
      {slot && (
        <div
          className="online-trade-candidates"
          aria-label={`${slot.label}の候補`}
        >
          <h3>{slot.label}の候補</h3>
          <div
            className="online-trade-filters"
            role="group"
            aria-label="型で絞る"
          >
            {[{ key: '', label: 'すべて' }, ...filters].map((f) => (
              <button
                key={f.key || 'all'}
                type="button"
                aria-pressed={(filter?.key || '') === f.key}
                onClick={() => setFilterKey(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="online-lineup-scroll">
            <table
              className="online-lineup-table online-trade-table"
              data-kind={kind}
            >
              <thead>
                <HeaderRow kind={kind} lead={CANDIDATE_LEAD} />
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr
                    key={`${c.team}-${c.player.id}`}
                    className="online-lineup-row is-static"
                  >
                    <td className="online-lineup-slot">
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`${c.player.name}でトレードを考える`}
                        onClick={() =>
                          onStart({
                            partner: c.team,
                            get: [c.player.id],
                            group: rosterGroup(c.player.position),
                          })
                        }
                      >
                        考える
                      </button>
                    </td>
                    <td className="online-trade-team">
                      {teamShort(c.team)}
                      {c.theirStarter && (
                        <small
                          className="online-trade-starter"
                          title="相手球団でもこの持ち場の一番手（抜けると相手に穴が空く）"
                        >
                          相手の一番手
                        </small>
                      )}
                    </td>
                    <td
                      className={
                        c.diff > 0
                          ? 'online-trade-diff is-up'
                          : 'online-trade-diff is-down'
                      }
                    >
                      {c.diff > 0 ? '+' : ''}
                      {Math.round(c.diff)}
                    </td>
                    <PlayerCells player={c.player} kind={kind} />
                  </tr>
                ))}
                {!candidates.length && (
                  <tr>
                    <td
                      colSpan={columnCount(kind) + 2}
                      className="online-muted online-trade-empty"
                    >
                      {loaded
                        ? 'この条件の候補は居ません。'
                        : '名簿を読んでいます…'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {mode === 'surplus' && (
        <div className="online-trade-candidates" aria-label="余りを出す">
          <h3>余りを出す</h3>
          <p className="online-muted">
            打順・先発ローテ・抑え・主な中継ぎ（4人）に入っていない選手のうち、他球団ならその持ち場の一番手を上回る人です。
            相手に穴があるところへ出すと、相手にも得があります。球団を押すと、その選手を出す提案を作ります。
          </p>
          <div className="online-lineup-scroll">
            <table className="online-lineup-table online-trade-surplus">
              <thead>
                <tr>
                  <th>選手</th>
                  <th>年齢</th>
                  <th>値段</th>
                  <th>活きる持ち場</th>
                  <th>一番手になれる球団</th>
                </tr>
              </thead>
              <tbody>
                {surplus.map((entry) => (
                  <tr
                    key={entry.player.id}
                    className="online-lineup-row is-static"
                  >
                    <td>
                      <PlayerStatsButton
                        player={entry.player}
                        category={entry.slot.pitcher ? 'pitching' : 'batting'}
                      />
                    </td>
                    <td>{entry.player.age ?? '—'}</td>
                    <td>
                      <ValueTier player={entry.player} />
                    </td>
                    <td>{entry.slot.label}</td>
                    <td className="online-trade-wanted">
                      {entry.wantedBy.map((team) => (
                        <button
                          key={team}
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            onStart({
                              partner: team,
                              give: [entry.player.id],
                              group: rosterGroup(entry.player.position),
                            })
                          }
                        >
                          {teamShort(team)}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
                {!surplus.length && (
                  <tr>
                    <td colSpan={5} className="online-muted online-trade-empty">
                      {loaded
                        ? '他球団で一番手になれる控えは居ません。'
                        : '名簿を読んでいます…'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export default function TradeScreen({
  view,
  busy,
  run,
  command,
  tradeSeed = null,
  // 受け取った種を使い終えた合図（親が種を消す。⚠ 消さないと、あとでトレードを開くたびに古い相手・選手で作り直された）
  onSeedUsed,
}) {
  // ⚠ **全球団を相手に出す**（CPUも含む）。参加者の球団は「相手の返事待ち」に
  //    なり、CPU球団は押した瞬間に答えが返る。
  // ⚠ **人の球団を先に並べる**。交渉の相手として考えるのはまず人で、
  //    CPU11球団に埋もれると探すことになる
  const humans = new Set((view.members || []).map((m) => m.teamName));
  const others = (view.teamNames || []).filter(
    (name) => name !== view.teamName,
  );
  const partners = [
    ...others.filter((name) => humans.has(name)),
    ...others.filter((name) => !humans.has(name)),
  ];
  const trades = view.trades || [];
  const waiting = trades.filter((t) => t.myTurn);
  const sent = trades.filter((t) => !t.myTurn);
  // 届いた提案への返事の結果（成立・断るとカードごと消えるので、ページの上に残す）
  const [answered, setAnswered] = useState(null);
  const league = useLeagueRosters(view);
  const tierOf = useTierOf(league);
  // 補強から探す・選手の詳細から始めた提案（相手・出す・もらう）。⚠ `n` が変わったら
  // 提案の欄を作り直す（途中まで選んでいた中身は捨てる。押したのは新しく考え直す合図）
  const [seed, setSeed] = useState(tradeSeed);
  const composer = useRef(null);
  const start = (next) => {
    setSeed({ n: Date.now(), give: [], get: [], ...next });
    setAnswered(null);
  };
  useEffect(() => {
    if (!tradeSeed) return;
    setSeed(tradeSeed);
    onSeedUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeSeed]);
  useEffect(() => {
    if (seed)
      composer.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
      });
  }, [seed]);
  const card = (t) => (
    <TradeCard
      key={t.id}
      view={view}
      trade={t}
      busy={busy}
      run={run}
      command={command}
      onResult={setAnswered}
    />
  );
  return (
    <TierContext.Provider value={tierOf}>
      <Page
        title="トレード"
        sub="ほかの球団と選手を交換します。CPU球団はその場で答え、参加者の球団は相手が受けた時点で成立します。"
      >
        <TradeResult result={answered} />
        {waiting.length > 0 && (
          <>
            <h2 className="online-trade-heading">返事が必要な提案</h2>
            {waiting.map(card)}
          </>
        )}
        {sent.length > 0 && (
          <>
            <h2 className="online-trade-heading">相手の返事待ち</h2>
            {sent.map(card)}
          </>
        )}
        {partners.length > 0 && (
          <ReinforcePanel
            view={view}
            league={league}
            busy={busy}
            onStart={start}
          />
        )}
        <section className="online-card" ref={composer}>
          <h2>新しく提案する</h2>
          {partners.length ? (
            <>
              <p className="online-muted">
                表の行を押して、出す選手（自球団）ともらう選手（相手）を選びます。
                右の交換案に、交換のあと両球団の人数と構成がどうなるかが出ます。
                相手が受けるとその場で選手が入れ替わり、逆提案が返ってきたら
                こんどはあなたが受けるか断るかを選びます（逆提案は1回だけ）。
                <strong>CPU球団はその場で答えます</strong>
                （受ける・逆提案・断るのどれか）。
              </p>
              <TradeComposer
                key={seed?.n ?? 0}
                view={view}
                partners={partners}
                humans={humans}
                initialPartner={seed?.partner}
                initialGive={seed?.give || []}
                initialGet={seed?.get || []}
                initialGroup={seed?.group}
                submitLabel="この内容で提案する"
                confirmLabel="提案を送る"
                busy={busy}
                onSubmit={async (to, give, get, players) => {
                  let text = '';
                  const outcome = await run(async () => {
                    text = await command(
                      'tradeOffer',
                      { to, offer: give, want: get },
                      {
                        message: (after, before) =>
                          offerResultText({
                            to,
                            give: players.give,
                            get: players.get,
                            before,
                            after,
                          }),
                      },
                    );
                    players.reset();
                  });
                  setAnswered(null);
                  // ⚠ 断られたときは理由（サーバーの文）を交換案の下にも出す。
                  //    上の赤い帯はページの先頭にあり、表を下へ送っていると見えない
                  return outcome.ok
                    ? { ok: true, text }
                    : { ok: false, text: outcome.error };
                }}
              />
            </>
          ) : (
            <p>トレードの相手になる球団がありません。</p>
          )}
        </section>
        <section className="online-card">
          <h2>解雇と獲得</h2>
          <p>
            <strong>解雇</strong>は土曜の「契約更改」、
            <strong>選手の獲得</strong>は土曜の「トライアウト」で行います。
          </p>
        </section>
      </Page>
    </TierContext.Provider>
  );
}
