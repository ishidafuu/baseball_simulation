import React, { useCallback, useRef, useState } from 'react';
import { POS, POS_FULL, posTone, posInk } from './api.js';
import { turnOfDate, restFatigueOf } from './shared.js';
import { BoardPage, Fatigue } from './BoardParts.jsx';
import FieldDiagram from './FieldDiagram.jsx';
import { useBoardHistory } from './useBoardHistory.js';
import { useLineupPicking } from './useLineupPicking.js';
import { ConditionMark, PlayerStatsButton } from './PlayerPerformance.jsx';
import { overviewGroup, formatStat } from './statsView.js';
import { teamShort } from './gameText.js';
import { AbilityValue } from '../components/AbilityValue.jsx';
import { getFatigueTone } from '../utils/constants.js';
import {
  orderFromLineup,
  battingOrderFromOrder,
  sameOrder,
  benchFielders,
  groupBench,
  candidatesFor,
  positionFitness,
  playablePositions,
  orderProblems,
  canPlayField,
  benchPitchers,
  bestFieldPosition,
  REST_FATIGUE,
  REST_TEXT,
  LOW_FITNESS,
} from './lineupEdit.js';
import { PlayerFace, TeamMark } from './look/Art.jsx';

// ============================================================
// PC版のスタメン設定。**スタメンを決めるときに比べたいものを、1つの表で比べる**。
//
// 【意図】スタメン決めは「この守備位置に誰を置くか」の比べ合い。比べるには、
//   スタメンと控えが**同じ列**に並び、1行に「実力（能力）・結果（今季成績）・
//   状態（調子・疲労）・その位置の守備適性」が同時に見えている必要がある。
//   だから、スタメン9行と控え野手を**1枚の表**に並べる（列が必ずそろう）。
//
// ⚠ 以前は一人用の画面を移植していて、次の指摘があった（2026-11-04）。
//    ここではどれも作りで起きないようにしてある。
//    - 自動設定ボタン（どう変わるか分からない）→ 置かない
//    - 守備位置がコンボボックス → 守備位置のバッジ同士を入れ替える
//    - ✕でスタメンから外す → 交代（控えと入れ替え）だけ。7人の状態を経由しない
//    - 守備図が場所を取る → 置かない（守備位置は表の列）
//    - 控えだけ謎のチェックボックス（比較）→ 同じ表に並ぶので比較は要らない
//    - 控えの先頭に投手 → 野手を捕手・内野・外野で括り、投手は最後に別の括りで出す
//      （二刀流で野手の枠に入れられる。守れる位置のある投手だけ出し、残りは畳む）
//    - スタメンと控えで書き方が違う → 同じ表・同じ列
//    - 数字がはみ出す → 表の列に入れる
// ⚠ 守備分析のページはこの表に入れた（守備位置の入れ替え・位置ごとの候補と適性）。
//    同じ編成を2か所で編集しない（PC版の統一の決まり）。
// ⚠ 保存するのは打順（`battingOrder`）だけ。投手起用は別のページで別に保存する
//    （`rebaseLineupSave` の受け持ち項目を分けてある。`lineupBridge.js` の `LINEUP_BOARD_KEYS`）。
// ============================================================

const STAT_IDS = ['pa', 'avg', 'homeruns', 'rbis', 'obp', 'ops'];
const STAT_COLUMNS = (() => {
  const columns = overviewGroup('batting').columns;
  return STAT_IDS.map((id) => columns.find((c) => c.id === id)).filter(Boolean);
})();
const SHORT_LABEL = { homeruns: '本塁打', rbis: '打点', obp: '出塁率' };

const ABILITIES = [
  { key: 'meet', label: 'ミ', title: 'ミート', get: (p) => p.batting?.meet },
  { key: 'power', label: 'パ', title: 'パワー', get: (p) => p.batting?.power },
  { key: 'eye', label: '眼', title: '選球眼', get: (p) => p.batting?.eye },
  { key: 'speed', label: '走', title: '走力', get: (p) => p.physical?.speed },
];

const BATS = { left: '左', right: '右', switch: '両' };
const batsOf = (p) => BATS[p.batting?.bats || p.physical?.bats] || '—';
// ⚠ 投げる手は `physical.throws` にある（`player.throws` はいつも undefined）
const THROW_MARK = { left: '左', right: '右' };
const throwsOf = (p) => THROW_MARK[p.physical?.throws] || '右';
const THROWS = { left: '左投', right: '右投' };
/** 名前の色の意味。⚠ **色だけに頼らない**（読み上げとマウスオーバーに出す） */
const FATIGUE_TONE_TEXT = {
  warn: '疲れています（このまま出し続けると成長が鈍ります）',
  heavy:
    'かなり疲れています（成長の鈍り方が最も大きく、試合では控えと入れ替わります）',
  '': undefined,
};

/** 次の数試合の相手と、相手の先発予定（投げる手）。左右の並べ方の手がかり */
function NextOpponents({ view }) {
  const games = (view.nextGames || []).slice(0, 5);
  if (!games.length) return null;
  return (
    <div className="online-lineup-next" aria-label="この先の相手先発">
      <span className="online-lineup-next-label">この先の相手先発</span>
      {games.map((game) => {
        const home = game.home === view.teamName;
        const opponent = home ? game.away : game.home;
        const info = home ? game.awayStarterInfo : game.homeStarterInfo;
        const name = info?.name || (home ? game.awayStarter : game.homeStarter);
        return (
          <span
            key={game.id ?? `${game.number}:${opponent}`}
            className="online-lineup-next-game"
          >
            {/* ⚠ **ターンで出す**（「○試合目」ではない）。オンラインはターンで
                進むので、画面によって単位が違うと「いまどこか」が読めない */}
            <small>
              {turnOfDate(game.date, view.seasonTurns)
                ? `第${turnOfDate(game.date, view.seasonTurns)}ターン`
                : ''}
            </small>
            <strong>
              <TeamMark team={opponent} size={18} />
              {teamShort(opponent)}
            </strong>
            {name ? (
              <span>
                {name}
                {info?.throws && (
                  <em className={`is-${info.throws}`}>{THROWS[info.throws]}</em>
                )}
              </span>
            ) : (
              <span className="online-muted">未定</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function Fitness({ value, position }) {
  if (value === null || value === undefined)
    return <span className="online-muted">—</span>;
  const low = value < LOW_FITNESS;
  return (
    <span
      className={`online-lineup-fitness ${low ? 'is-low' : value >= 90 ? 'is-good' : ''}`}
      title={`${POS_FULL[position] || ''}の守備適性 ${value}%${low ? '（低い: 守備で失点しやすい）' : ''}`}
    >
      {value}
      <small>%</small>
    </span>
  );
}

/** 1人ぶんの数字の列（スタメンと控えで**同じ部品**を使う） */
function PlayerCells({ player, fitness, fitnessPosition, restAt = REST_FATIGUE }) {
  return (
    <>
      {/* ⚠ 疲労は**名前にも色を付ける**。数字の列にも色はあるが、スタメンを
          選ぶときに目で追っているのは名前なので、数字まで目が行かない。
          黄＝成長が鈍り始める、赤＝鈍り方が最も大きい（`getFatigueTone`） */}
      <td
        className={`online-lineup-person online-fatigue-${getFatigueTone(player.fatigue) || 'none'}`}
        title={FATIGUE_TONE_TEXT[getFatigueTone(player.fatigue)]}
      >
        <PlayerFace player={player} size={26} />
        <span onClick={(e) => e.stopPropagation()}>
          <PlayerStatsButton player={player} category="batting" group="basic" />
        </span>
        <ConditionMark player={player} />
        {/* 投手登録の選手が野手の枠に居る・控えに居る（二刀流） */}
        {player.position === 'pitcher' && (
          <small
            className="online-role-mark"
            title="投手登録の選手です。野手の枠に入れると、先発の日は9番・投手に回ります"
          >
            投手
          </small>
        )}
      </td>
      {/* ⚠ 投げる手は**打つ手の前**に、別の列で出す。以前は打の列の
          マウスオーバーにだけ入れていて、右投左打かどうかが一覧で分からなかった。
          ⚠ **打の列を置き換えないこと**（実際にやって表が1列ずれた）。
             `COLUMN_COUNT` も列の数と合わせる */}
      <td title={player.physical?.throws === 'left' ? '左投げ' : '右投げ'}>
        {throwsOf(player)}
      </td>
      <td title={`${batsOf(player)}打ち`}>{batsOf(player)}</td>
      <td>{player.age ?? '—'}</td>
      <td className="is-sep">
        <Fatigue
          value={player.fatigue}
          rest={restAt}
          restText={REST_TEXT}
        />
      </td>
      {ABILITIES.map((a, i) => (
        <td key={a.key} className={i === 0 ? 'is-sep' : ''}>
          <AbilityValue value={a.get(player)} placeholder="—" />
        </td>
      ))}
      <td className="is-sep">
        <Fitness value={fitness} position={fitnessPosition} />
      </td>
      <td>
        <AbilityValue value={player.fielding?.defense} placeholder="—" />
      </td>
      <td>
        <AbilityValue value={player.physical?.arm} placeholder="—" />
      </td>
      {STAT_COLUMNS.map((column, i) => (
        <td key={column.id} className={i === 0 ? 'is-sep is-stat' : 'is-stat'}>
          {formatStat(column, column.get(player))}
        </td>
      ))}
    </>
  );
}

// ⚠ 列を足したらここも直すこと（`colSpan` がずれると罫線が折れる）。
//    打順・守備・選手 / 投・打・年齢・疲労 / 能力 / 適性・守・肩 / 成績
const COLUMN_COUNT = 3 + 4 + ABILITIES.length + 3 + STAT_COLUMNS.length;

function HeaderRow({ fitnessLabel, restAt = REST_FATIGUE }) {
  return (
    <tr>
      <th className="online-lineup-slot">打順</th>
      <th className="online-lineup-poscell">守備</th>
      <th className="online-lineup-person">選手</th>
      <th title="投げる手（左・右）">投</th>
      <th title="打席（左・右・両）">打</th>
      <th>年齢</th>
      <th className="is-sep" title={`${restAt}以上: ${REST_TEXT}`}>
        疲労
      </th>
      {ABILITIES.map((a, i) => (
        <th key={a.key} className={i === 0 ? 'is-sep' : ''} title={a.title}>
          {a.label}
        </th>
      ))}
      <th
        className="is-sep"
        title={`その守備位置の適性（${LOW_FITNESS}%未満は赤）`}
      >
        {fitnessLabel}
      </th>
      <th title="守備力">守</th>
      <th title="肩力">肩</th>
      {STAT_COLUMNS.map((column, i) => (
        <th
          key={column.id}
          className={i === 0 ? 'is-sep is-stat' : 'is-stat'}
          title={`今季の${column.label}`}
        >
          {SHORT_LABEL[column.id] || column.label}
        </th>
      ))}
    </tr>
  );
}

export default function LineupBoard({
  view,
  busy,
  hidden,
  restore,
  onSave,
  onDirty,
  onDraft,
}) {
  const roster = view.roster || [];
  const byId = new Map(roster.map((p) => [p.id, p]));
  // 疲れた野手を休ませる目安（自動采配の `restLine`。保存済みの値）。疲労の色をこれに合わせる
  const restAt = restFatigueOf(view.lineup?.tactics);
  // スタメンに入れられる選手（名簿に居て、抹消されていない選手。投手も入れられる）。
  // ⚠ 名簿には抹消中も入る
  const fielderOf = (id) => {
    const player = byId.get(id);
    return canPlayField(player) ? player : null;
  };

  // ---- 編集の状態（履歴つき。`useBoardHistory`）
  // 守備図。守備位置を選ぶと開き、表の成績の列の場所に出す（閉じるまで開いたまま）
  const [fieldOpen, setFieldOpen] = useState(false);
  const [hoverPos, setHoverPos] = useState(null);
  // 控えの投手を全員出すか（ふだんは守れる位置のある投手だけ）
  const [allPitchers, setAllPitchers] = useState(false);
  // ⚠ 選択は下の `useLineupPicking` が持つ。履歴（元に戻す・Esc）から外せるよう、ここは引き当てだけ
  const clearRef = useRef(null);
  const clearSelection = useCallback(() => clearRef.current?.(), []);
  const board = useBoardHistory({
    view,
    fromView: (v) => orderFromLineup(v.lineup),
    same: sameOrder,
    toPlan: (order) => ({ battingOrder: battingOrderFromOrder(order) }),
    onSave,
    onDirty,
    onDraft,
    restore,
    keyActive: !hidden && !busy,
    onEscape: clearSelection,
  });
  const order = board.value;

  // ---- 操作（クリック・ドラッグ。一人用と共通の `useLineupPicking`）
  const bench = benchFielders(roster, order);
  const pitcherBench = benchPitchers(roster, order);
  const {
    selectedRow,
    selectedPos,
    selectedBench,
    focusPosition,
    drag,
    dropAt,
    clickRow,
    clickPosition,
    clickBench,
    startDrag,
    endDrag,
    over,
    leave,
    dropOn,
    rowClass,
    clearSelection: clearPicking,
  } = useLineupPicking({
    order,
    byId,
    commit: board.commit,
    onPickPosition: () => setFieldOpen(true),
  });
  clearRef.current = clearPicking;

  // ---- 表示
  const problems = orderProblems(order, roster);
  const nextStarter = byId.get(view.nextStarterId);
  const help =
    selectedRow !== null
      ? `${(order[selectedRow] && byId.get(order[selectedRow].playerId)?.name) || `${selectedRow + 1}番`}を選択中：控えを押すと交代、ほかの打順を押すと打順を入れ替えます。`
      : selectedPos !== null
        ? `${POS_FULL[order[selectedPos]?.position]}を選択中：ほかの選手の守備位置を押すと入れ替えます。`
        : selectedBench
          ? `${selectedBench.name}を選択中：交代させる打順を押してください。`
          : '行を押して選び、もう一方を押すと入れ替わります（打順どうし＝打順、守備位置どうし＝守備、打順と控え＝交代）。ドラッグでも同じです。Escで選択を取り消します。';

  // ⚠ 投手は多い（10人以上）。守れる位置（適性 LOW_FITNESS 以上）のある投手だけを出し、
  //    残りは「全員を出す」で開く。候補の並びでは、その位置を守れる投手だけを混ぜる
  const shownPitchers = (
    allPitchers
      ? pitcherBench
      : pitcherBench.filter((p) =>
          focusPosition
            ? positionFitness(p, focusPosition) >= LOW_FITNESS
            : playablePositions(p).length > 0,
        )
  ).sort(
    (a, b) =>
      positionFitness(b, bestFieldPosition(b)) -
      positionFitness(a, bestFieldPosition(a)),
  );
  const hiddenPitchers = pitcherBench.length - shownPitchers.length;
  const benchRows = focusPosition
    ? [
        {
          id: 'candidates',
          label: `${POS_FULL[focusPosition]}の交代候補（${POS_FULL[focusPosition]}の適性が高い順）`,
          players: candidatesFor([...bench, ...shownPitchers], focusPosition),
        },
      ]
    : [
        ...groupBench(bench),
        ...(pitcherBench.length
          ? [{ id: 'pitcher', label: '投手', players: shownPitchers }]
          : []),
      ];
  // 次の先発が野手の枠にも入っている（二刀流の先発の日）
  const twoWaySlot = order.find(
    (e) => e.playerId != null && e.playerId === view.nextStarterId,
  );


  return (
    <BoardPage
      title="スタメン設定"
      board={board}
      busy={busy}
      problems={problems}
      hidden={hidden}
    >
      {/* ⚠ 保存の応答待ちの間は触れなくする（送信中の編集が、保存後の作り直しで消える） */}
      <section
        className="online-card online-lineup-board"
        inert={busy ? '' : undefined}
      >
        <NextOpponents view={view} />
        <div className="online-lineup-toolbar">
          <p className="online-lineup-help" aria-live="polite">
            {help}
          </p>
          <button
            type="button"
            className="online-lineup-field-toggle"
            aria-pressed={fieldOpen}
            title="守備の並びと各位置の適性を図で見る（今季成績の列の場所に出ます）"
            onClick={() => setFieldOpen(!fieldOpen)}
          >
            守備図
          </button>
        </div>
        <div className={`online-lineup-split ${fieldOpen ? 'is-field' : ''}`}>
          <div className="online-lineup-scroll">
            <table className="online-lineup-table">
              <thead>
                <HeaderRow fitnessLabel="適性" restAt={restAt} />
              </thead>
              <tbody aria-label="スタメン">
                {order.map((entry, index) => {
                  const player = fielderOf(entry.playerId);
                  return (
                    <tr
                      key={`${index}:${entry.playerId}`}
                      className={rowClass(index)}
                      draggable={!busy}
                      onDragStart={startDrag({ kind: 'row', index })}
                      onDragEnd={endDrag}
                      onDragOver={over({ kind: 'row', index })}
                      onDragLeave={leave}
                      onDrop={dropOn({ kind: 'row', index })}
                      onClick={() => clickRow(index)}
                      data-slot={index + 1}
                    >
                      <td className="online-lineup-slot">
                        <button
                          type="button"
                          aria-pressed={selectedRow === index}
                          aria-label={`${index + 1}番を選ぶ`}
                          onClick={(e) => {
                            e.stopPropagation();
                            clickRow(index);
                          }}
                        >
                          <span
                            aria-hidden="true"
                            className="online-lineup-grip"
                          >
                            ⠿
                          </span>
                          {index + 1}
                        </button>
                      </td>
                      <td
                        className="online-lineup-poscell"
                        title={`守っている位置と、ほかに守れる位置（適性${LOW_FITNESS}%以上、高い順）`}
                      >
                        <span className="online-lineup-playable">
                          <button
                            type="button"
                            className={`online-lineup-pos ${posTone(entry.position)} ${selectedPos === index ? 'is-selected' : ''}`}
                            aria-pressed={selectedPos === index}
                            aria-label={`${index + 1}番の守備位置（${POS[entry.position]}）を入れ替える`}
                            draggable={!busy}
                            onDragStart={startDrag({ kind: 'pos', index })}
                            onDragEnd={endDrag}
                            onMouseEnter={() => setHoverPos(index)}
                            onMouseLeave={() => setHoverPos(null)}
                            onClick={(e) => {
                              e.stopPropagation();
                              clickPosition(index);
                            }}
                          >
                            {POS[entry.position] || '?'}
                          </button>
                          {/* 控えの行と同じく、守っている位置の右にほかに守れる位置を並べる */}
                          {player &&
                            playablePositions(player)
                              .filter((e) => e.position !== entry.position)
                              .slice(0, 2)
                              .map((e) => (
                                <span key={e.position} className={posInk(e.position)}>{POS[e.position]}</span>
                              ))}
                        </span>
                      </td>
                      {player ? (
                        <PlayerCells
                          player={player}
                          fitness={positionFitness(player, entry.position)}
                          fitnessPosition={entry.position}
                          restAt={restAt}
                        />
                      ) : (
                        <td
                          colSpan={COLUMN_COUNT - 2}
                          className="online-lineup-missing"
                        >
                          {entry.playerId == null
                            ? '空いています。控えと交代して（ドラッグでも）埋めてください'
                            : byId.has(entry.playerId)
                              ? `${byId.get(entry.playerId).name}は今は起用できません。控えと交代してください`
                              : '名簿に居ない選手です。控えと交代してください'}
                        </td>
                      )}
                    </tr>
                  );
                })}
                <tr className="online-lineup-row is-pitcher">
                  <td className="online-lineup-slot">
                    <span>9</span>
                  </td>
                  <td className="online-lineup-poscell">
                    <span className={`online-lineup-pos is-fixed ${posTone('pitcher')}`}>投</span>
                  </td>
                  <td
                    colSpan={COLUMN_COUNT - 2}
                    className="online-lineup-person"
                  >
                    {nextStarter
                      ? `${nextStarter.name}（次の先発）`
                      : '次の先発'}
                    <small>
                      {twoWaySlot
                        ? `${nextStarter?.name || '次の先発'}は${POS_FULL[twoWaySlot.position]}にも入っています。先発の日は9番・投手に回り、${POS_FULL[twoWaySlot.position]}はその日だけ控えが守ります（試合の後は元に戻ります）。`
                        : '投手は9番で打ちます。先発の順は「投手起用」で決めます。'}
                    </small>
                  </td>
                </tr>
              </tbody>
              <tbody
                aria-label="控え"
                className={`online-lineup-bench ${drag?.kind === 'row' ? 'is-target' : ''}`}
              >
                <tr className="online-lineup-bench-head">
                  <th colSpan={COLUMN_COUNT}>
                    控え 野手{bench.length}人
                    {pitcherBench.length > 0 &&
                      `・投手${pitcherBench.length}人`}
                    <small>
                      {focusPosition
                        ? '押すと交代します。適性の列はこの守備位置での値です。'
                        : '控えは試合に出ないと伸びにくくなります（年300打席の選手は0打席の約2.7倍伸びる）。'}
                    </small>
                  </th>
                </tr>
                {benchRows.map((group) => (
                  <React.Fragment key={group.id}>
                    <tr className="online-lineup-group">
                      <th colSpan={COLUMN_COUNT}>
                        {group.label}
                        {group.id !== 'candidates' &&
                          group.id !== 'pitcher' && (
                            <small>{group.players.length}人</small>
                          )}
                        {group.id === 'pitcher' && (
                          <small>
                            二刀流：投手も野手の枠に入れられます。先発の日は9番・投手に回り、その日だけ控えが守ります。
                          </small>
                        )}
                        {(group.id === 'pitcher' ||
                          group.id === 'candidates') &&
                          (allPitchers || hiddenPitchers > 0) && (
                            <button
                              type="button"
                              className="online-lineup-group-toggle"
                              aria-pressed={allPitchers}
                              onClick={(e) => {
                                e.stopPropagation();
                                setAllPitchers(!allPitchers);
                              }}
                            >
                              {allPitchers
                                ? '守れる投手だけにする'
                                : `投手を全員出す（ほか${hiddenPitchers}人）`}
                            </button>
                          )}
                      </th>
                    </tr>
                    {group.players.map((player) => {
                      // ⚠ 投手の本職（投手）の適性は出しても意味が無い。守るなら一番合う位置で
                      const fitnessPosition =
                        focusPosition ||
                        (player.position === 'pitcher'
                          ? bestFieldPosition(player)
                          : player.position);
                      const fitness = positionFitness(player, fitnessPosition);
                      const selected = selectedBench?.id === player.id;
                      return (
                        <tr
                          key={player.id}
                          className={[
                            'online-lineup-row',
                            selected ? 'is-selected' : '',
                            focusPosition && fitness < LOW_FITNESS
                              ? 'is-unfit'
                              : '',
                            drag?.kind === 'row' &&
                            dropAt?.kind === 'bench' &&
                            dropAt.playerId === player.id
                              ? 'is-drop is-drop-bench'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          draggable={!busy}
                          onDragStart={startDrag({
                            kind: 'bench',
                            playerId: player.id,
                          })}
                          onDragEnd={endDrag}
                          onDragOver={over({
                            kind: 'bench',
                            playerId: player.id,
                          })}
                          onDragLeave={leave}
                          onDrop={dropOn({
                            kind: 'bench',
                            playerId: player.id,
                          })}
                          onClick={() => clickBench(player.id)}
                          data-bench={player.id}
                          data-bench-group={group.id}
                        >
                          <td className="online-lineup-slot">
                            <button
                              type="button"
                              aria-pressed={selected}
                              aria-label={
                                selectedRow !== null
                                  ? `${player.name}と交代する`
                                  : `${player.name}を選ぶ`
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                clickBench(player.id);
                              }}
                            >
                              <span
                                aria-hidden="true"
                                className="online-lineup-grip"
                              >
                                ⠿
                              </span>
                              {selectedRow !== null ? '交代' : ''}
                            </button>
                          </td>
                          <td
                            className="online-lineup-poscell"
                            title={`本職と、ほかに守れる位置（適性${LOW_FITNESS}%以上、高い順）`}
                          >
                            <span className="online-lineup-playable">
                              <span className={`online-lineup-pos is-bench ${posTone(player.position)}`}>
                                {POS[player.position] || '?'}
                              </span>
                              {playablePositions(player)
                                .filter((e) => e.position !== player.position)
                                .slice(0, 2)
                                .map((e) => (
                                  <span key={e.position} className={posInk(e.position)}>
                                    {POS[e.position]}
                                  </span>
                                ))}
                            </span>
                          </td>
                          <PlayerCells
                            player={player}
                            fitness={fitness}
                            fitnessPosition={fitnessPosition}
                            restAt={restAt}
                          />
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
                {!bench.length && !pitcherBench.length && (
                  <tr>
                    <td colSpan={COLUMN_COUNT} className="online-muted">
                      控えが居ません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {fieldOpen && (
            <FieldDiagram
              order={order}
              playerOf={fielderOf}
              pitcher={nextStarter}
              selected={
                selectedPos ?? (drag?.kind === 'pos' ? drag.index : null)
              }
              target={
                drag?.kind === 'pos' && dropAt?.kind === 'row'
                  ? dropAt.index
                  : hoverPos
              }
              focus={selectedRow}
              onPick={clickPosition}
              onHover={setHoverPos}
            />
          )}
        </div>
      </section>
    </BoardPage>
  );
}
