import React, { useEffect, useState } from 'react';
import { POS, POS_FULL, posTone, posInk } from '../../online/api.js';
import { Fatigue } from '../../online/BoardParts.jsx';
import FieldDiagram from '../../online/FieldDiagram.jsx';
import {
  benchFielders,
  benchPitchers,
  groupBench,
  positionFitness,
  playablePositions,
  bestFieldPosition,
  LOW_FITNESS,
} from '../../online/lineupEdit.js';
import { AbilityValue } from '../AbilityValue.jsx';
import { getFatigueTone } from '../../utils/constants.js';
import { ConditionMark } from '../../online/PlayerPerformance.jsx';
import '../../online/online.css';
import { orderFromTeam, writeOrder, candidatesForSlot, orderProblems } from './soloLineupOrder.js';
import { useLineupPicking } from '../../online/useLineupPicking.js';

// ============================================================
// 一人用のスタメン設定（ロスター管理 → 試合のオーダー → スタメン設定）。
// **オンラインPC版のスタメン設定（`src/online/LineupBoard.jsx`）の形を流用**した表。
//
// 【意図】スタメン決めは「この守備位置に誰を置くか」の比べ合い。スタメンと控えを
//   **1枚の表・同じ列**に並べ、1行に能力・今季成績・調子と疲労・その位置の適性を出す。
// 【操作】行を押して選び、もう一方を押すと入れ替わる（打順どうし＝打順、
//   守備位置のバッジどうし＝守備、打順と控え＝交代）。ドラッグでも同じ。
// ⚠ 以前の一人用の画面にあった次のものは**置かない**（オンラインで同じ指摘を受けて外した。
//    2026-11-04 いしだ）: 自動設定ボタン（どう変わるか分からない）・守備位置のコンボボックス・
//    ✕で外す（7人の状態を経由する）・常に出ている守備図・控えの比較チェックボックス。
// ⚠ 見た目はオンラインの部品のクラス（`.online-lineup-*`）をそのまま使うので、
//    `.online.online-desktop.online-embed` の中に置く（`src/online/online.css` の `.online.online-embed`）。
//    中に一人用（Tailwind）の部品を入れないこと（`.online button` が上書きする）。
// ⚠ 編集はその場で `team` に書き、`onChange` で親（`LineupSettingContent`）に知らせる。
//    元に戻す・やり直すは親の履歴が受け持つ（打順は `snapshotRoster` に入っている）。
// ============================================================

const ABILITIES = [
  { key: 'meet', label: 'ミ', title: 'ミート', get: (p) => p.batting?.meet },
  { key: 'power', label: 'パ', title: 'パワー', get: (p) => p.batting?.power },
  { key: 'eye', label: '眼', title: '選球眼', get: (p) => p.batting?.eye },
  { key: 'speed', label: '走', title: '走力', get: (p) => p.physical?.speed },
];

// 今季成績（打撃）。⚠ 一人用の選手は `seasonStats.batting` に積む（オンラインの
// `performance` は持たない）ので、ここで直に計算する
const rate = (v) => (v === null ? '—' : v.toFixed(3).replace(/^0\./, '.'));
const battingOf = (p) => {
  const s = p.seasonStats?.batting;
  if (!s) return null;
  const hbp = s.hitByPitch || 0;
  const sf = s.sacrificeFlies || 0;
  const pa = s.plateAppearances ?? (s.atBats || 0) + (s.walks || 0) + hbp + (s.sacrificeBunts || 0) + sf;
  const ab = s.atBats || 0;
  const avg = ab ? (s.hits || 0) / ab : null;
  const obpBase = ab + (s.walks || 0) + hbp + sf;
  const obp = obpBase ? ((s.hits || 0) + (s.walks || 0) + hbp) / obpBase : null;
  const tb = (s.hits || 0) + (s.doubles || 0) + 2 * (s.triples || 0) + 3 * (s.homeruns || 0);
  const slg = ab ? tb / ab : null;
  return { pa, avg, homeruns: s.homeruns || 0, rbis: s.rbis || 0, obp, ops: obp !== null && slg !== null ? obp + slg : null };
};
const STATS = [
  { id: 'pa', label: '打席', show: (b) => b.pa },
  { id: 'avg', label: '打率', show: (b) => rate(b.avg) },
  { id: 'homeruns', label: '本塁打', show: (b) => b.homeruns },
  { id: 'rbis', label: '打点', show: (b) => b.rbis },
  { id: 'obp', label: '出塁率', show: (b) => rate(b.obp) },
  { id: 'ops', label: 'OPS', show: (b) => rate(b.ops) },
];

const POS_SHORT = { ...POS, dh: 'DH' };
const POS_NAME = { ...POS_FULL, dh: '指名打者' };
const BATS = { left: '左', right: '右', switch: '両' };
const batsOf = (p) => BATS[p.batting?.bats || p.physical?.bats] || '—';
const throwsOf = (p) => (p.physical?.throws === 'left' ? '左' : '右');
const FATIGUE_TONE_TEXT = {
  warn: '疲れています（このまま出し続けると成長が鈍ります）',
  heavy: 'かなり疲れています（成長の鈍り方が最も大きい）',
  '': undefined,
};

function Fitness({ value, position }) {
  if (position === 'dh') return <span className="online-muted" title="指名打者は守らない">—</span>;
  if (value === null || value === undefined) return <span className="online-muted">—</span>;
  const low = value < LOW_FITNESS;
  return (
    <span
      className={`online-lineup-fitness ${low ? 'is-low' : value >= 90 ? 'is-good' : ''}`}
      title={`${POS_NAME[position] || ''}の守備適性 ${value}%${low ? '（低い: 守備で失点しやすい）' : ''}`}
    >
      {value}
      <small>%</small>
    </span>
  );
}

function PlayerCells({ player, fitnessPosition, onOpen }) {
  const tone = getFatigueTone(player.fatigue);
  const b = battingOf(player);
  return (
    <>
      <td className={`online-lineup-person online-fatigue-${tone || 'none'}`} title={FATIGUE_TONE_TEXT[tone]}>
        <button
          type="button"
          className="online-player-name"
          aria-label={`${player.name}の選手情報を見る`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(player);
          }}
        >
          {player.name}
        </button>
        <ConditionMark player={player} />
        {player.position === 'pitcher' && (
          <small className="online-role-mark" title="投手登録の選手です（二刀流で野手の枠に入れています）">
            投手
          </small>
        )}
      </td>
      <td title={player.physical?.throws === 'left' ? '左投げ' : '右投げ'}>{throwsOf(player)}</td>
      <td title={`${batsOf(player)}打ち`}>{batsOf(player)}</td>
      <td>{player.age ?? '—'}</td>
      <td className="is-sep">
        <Fatigue value={player.fatigue} rest={Infinity} restText="" />
      </td>
      {ABILITIES.map((a, i) => (
        <td key={a.key} className={i === 0 ? 'is-sep' : ''}>
          <AbilityValue value={a.get(player)} placeholder="—" />
        </td>
      ))}
      <td className="is-sep">
        <Fitness value={positionFitness(player, fitnessPosition)} position={fitnessPosition} />
      </td>
      <td>
        <AbilityValue value={player.fielding?.defense} placeholder="—" />
      </td>
      <td>
        <AbilityValue value={player.physical?.arm} placeholder="—" />
      </td>
      {STATS.map((s, i) => (
        <td key={s.id} className={i === 0 ? 'is-sep is-stat' : 'is-stat'}>
          {b ? s.show(b) : '—'}
        </td>
      ))}
    </>
  );
}

// ⚠ 列を足したらここも直すこと（`colSpan` がずれると罫線が折れる）
const COLUMN_COUNT = 3 + 4 + ABILITIES.length + 3 + STATS.length;

function HeaderRow() {
  return (
    <tr>
      <th className="online-lineup-slot">打順</th>
      <th className="online-lineup-poscell">守備</th>
      <th className="online-lineup-person">選手</th>
      <th title="投げる手（左・右）">投</th>
      <th title="打席（左・右・両）">打</th>
      <th>年齢</th>
      <th className="is-sep" title="疲労（黄: 成長が鈍り始める、赤: 鈍り方が最も大きい）">
        疲労
      </th>
      {ABILITIES.map((a, i) => (
        <th key={a.key} className={i === 0 ? 'is-sep' : ''} title={a.title}>
          {a.label}
        </th>
      ))}
      <th className="is-sep" title={`その守備位置の適性（${LOW_FITNESS}%未満は赤）`}>
        適性
      </th>
      <th title="守備力">守</th>
      <th title="肩力">肩</th>
      {STATS.map((s, i) => (
        <th key={s.id} className={i === 0 ? 'is-sep is-stat' : 'is-stat'} title={`今季の${s.label}`}>
          {s.label}
        </th>
      ))}
    </tr>
  );
}

/**
 * @param team        編集する球団（その場で書き換える）
 * @param useDH       DH制か（`LEAGUE_SETTINGS.useDH`）
 * @param nextStarter 次の先発（DH無しの9番の行に出す）
 * @param onChange    書き換えたあとに呼ぶ（親が描き直して履歴に積む）
 * @param onOpen      選手名を押したとき（選手詳細を開く）
 * @param resetKey    これが変わったら選択を外す（親の 元に戻す・やり直す）
 */
export default function SoloLineupBoard({ team, useDH, nextStarter, onChange, onOpen, resetKey }) {
  const roster = team.players || [];
  const byId = new Map(roster.map((p) => [p.id, p]));
  const fielderOf = (id) => {
    const player = byId.get(id);
    return player && player.isActive !== false ? player : null;
  };
  const order = orderFromTeam(team, useDH);

  const [fieldOpen, setFieldOpen] = useState(false);
  const [hoverPos, setHoverPos] = useState(null);
  const [allPitchers, setAllPitchers] = useState(false);

  const bench = benchFielders(roster, order);
  const pitcherBench = benchPitchers(roster, order);
  // 選ぶ・入れ替える・ドラッグはオンラインPC版と共通（`useLineupPicking`）
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
    setSelection,
  } = useLineupPicking({
    order,
    byId,
    commit: (next) => {
      if (next === order) return;
      writeOrder(team, next, useDH, nextStarter?.id);
      onChange();
    },
    onPickPosition: () => setFieldOpen(true),
  });
  // 親の 元に戻す・やり直す で並びが替わったら選択を外す（位置で持つ選択が別の選手を指す）
  useEffect(() => setSelection(null), [resetKey, setSelection]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelection]);

  const problems = orderProblems(order, roster);
  // 次の先発が野手の枠にも入っている（二刀流）。⚠ 一人用はオンラインと違い、試合の日に
  //    `ensureCompleteLineup` が先発をその枠から外して控えで埋め、**試合の後も戻さない**
  const twoWaySlot = nextStarter ? order.find((e) => e.playerId === nextStarter.id) : null;
  const twoWayText = twoWaySlot
    ? `${nextStarter.name}は次の先発で、${POS_NAME[twoWaySlot.position]}にも入っています。先発の日は${useDH ? '打順から外れ' : '9番・投手に回り'}、${POS_NAME[twoWaySlot.position]}には控えが入ります（試合の後も元には戻りません）。`
    : null;
  const help =
    selectedRow !== null
      ? `${(order[selectedRow] && byId.get(order[selectedRow].playerId)?.name) || `${selectedRow + 1}番`}を選択中：控えを押すと交代、ほかの打順を押すと打順を入れ替えます。`
      : selectedPos !== null
        ? `${POS_NAME[order[selectedPos]?.position]}を選択中：ほかの選手の守備位置を押すと入れ替えます。`
        : selectedBench
          ? `${selectedBench.name}を選択中：交代させる打順を押してください。`
          : '行を押して選び、もう一方を押すと入れ替わります（打順どうし＝打順、守備位置どうし＝守備、打順と控え＝交代）。ドラッグでも同じです。Escで選択を取り消します。';

  const fitsFocus = (p) => (focusPosition === 'dh' ? true : positionFitness(p, focusPosition) >= LOW_FITNESS);
  const shownPitchers = (
    allPitchers ? pitcherBench : pitcherBench.filter((p) => (focusPosition ? focusPosition !== 'dh' && fitsFocus(p) : playablePositions(p).length > 0))
  ).sort((a, b) => positionFitness(b, bestFieldPosition(b)) - positionFitness(a, bestFieldPosition(a)));
  const hiddenPitchers = pitcherBench.length - shownPitchers.length;
  const benchRows = focusPosition
    ? [
        {
          id: 'candidates',
          label:
            focusPosition === 'dh'
              ? '指名打者の交代候補（打撃の能力が高い順）'
              : `${POS_NAME[focusPosition]}の交代候補（${POS_NAME[focusPosition]}の適性が高い順）`,
          players: candidatesForSlot([...bench, ...shownPitchers], focusPosition),
        },
      ]
    : [...groupBench(bench), ...(pitcherBench.length ? [{ id: 'pitcher', label: '投手', players: shownPitchers }] : [])];


  return (
    <div className="online online-desktop online-embed">
      <section className="online-card online-lineup-board" data-testid="solo-lineup-board">
        <div className="online-lineup-toolbar">
          <p className="online-lineup-help" aria-live="polite">
            {problems.length ? <span className="online-error-text">{problems[0]}</span> : help}
            {useDH && twoWayText && <span className="online-error-text"> {twoWayText}</span>}
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
                <HeaderRow />
              </thead>
              <tbody aria-label="スタメン">
                {order.map((entry, index) => {
                  const player = fielderOf(entry.playerId);
                  return (
                    <tr
                      key={`${index}:${entry.playerId}`}
                      className={rowClass(index)}
                      draggable
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
                          <span aria-hidden="true" className="online-lineup-grip">
                            ⠿
                          </span>
                          {index + 1}
                        </button>
                      </td>
                      <td className="online-lineup-poscell" title={`守っている位置と、ほかに守れる位置（適性${LOW_FITNESS}%以上、高い順）`}>
                        <span className="online-lineup-playable">
                          <button
                            type="button"
                            className={`online-lineup-pos ${posTone(entry.position)} ${selectedPos === index ? 'is-selected' : ''}`}
                            aria-pressed={selectedPos === index}
                            aria-label={`${index + 1}番の守備位置（${POS_SHORT[entry.position]}）を入れ替える`}
                            draggable
                            onDragStart={startDrag({ kind: 'pos', index })}
                            onDragEnd={endDrag}
                            onMouseEnter={() => setHoverPos(index)}
                            onMouseLeave={() => setHoverPos(null)}
                            onClick={(e) => {
                              e.stopPropagation();
                              clickPosition(index);
                            }}
                          >
                            {POS_SHORT[entry.position] || '?'}
                          </button>
                          {player &&
                            playablePositions(player)
                              .filter((e) => e.position !== entry.position)
                              .slice(0, 2)
                              .map((e) => <span key={e.position} className={posInk(e.position)}>{POS[e.position]}</span>)}
                        </span>
                      </td>
                      {player ? (
                        <PlayerCells player={player} fitnessPosition={entry.position} onOpen={onOpen} />
                      ) : (
                        <td colSpan={COLUMN_COUNT - 2} className="online-lineup-missing">
                          {entry.playerId == null
                            ? '空いています。控えと交代して（ドラッグでも）埋めてください'
                            : byId.has(entry.playerId)
                              ? `${byId.get(entry.playerId).name}はベンチ外です。控えと交代してください`
                              : '名簿に居ない選手です。控えと交代してください'}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!useDH && (
                  <tr className="online-lineup-row is-pitcher">
                    <td className="online-lineup-slot">
                      <span>9</span>
                    </td>
                    <td className="online-lineup-poscell">
                      <span className={`online-lineup-pos is-fixed ${posTone('pitcher')}`}>投</span>
                    </td>
                    <td colSpan={COLUMN_COUNT - 2} className="online-lineup-person">
                      {nextStarter ? `${nextStarter.name}（次の先発）` : '次の先発'}
                      <small>{twoWayText || '投手は9番で打ちます。先発の順は「投手起用」で決めます。'}</small>
                    </td>
                  </tr>
                )}
              </tbody>
              <tbody aria-label="控え" className={`online-lineup-bench ${drag?.kind === 'row' ? 'is-target' : ''}`}>
                <tr className="online-lineup-bench-head">
                  <th colSpan={COLUMN_COUNT}>
                    控え 野手{bench.length}人{pitcherBench.length > 0 && `・投手${pitcherBench.length}人`}
                    <small>
                      {focusPosition
                        ? focusPosition === 'dh'
                          ? '押すと交代します。'
                          : '押すと交代します。適性の列はこの守備位置での値です。'
                        : '控えは試合に出ないと伸びにくくなります（年300打席の選手は0打席の約2.7倍伸びる）。'}
                    </small>
                  </th>
                </tr>
                {benchRows.map((group) => (
                  <React.Fragment key={group.id}>
                    <tr className="online-lineup-group">
                      <th colSpan={COLUMN_COUNT}>
                        {group.label}
                        {group.id !== 'candidates' && group.id !== 'pitcher' && <small>{group.players.length}人</small>}
                        {group.id === 'pitcher' && <small>二刀流：投手も野手の枠に入れられます。</small>}
                        {(group.id === 'pitcher' || group.id === 'candidates') && focusPosition !== 'dh' && (allPitchers || hiddenPitchers > 0) && (
                          <button
                            type="button"
                            className="online-lineup-group-toggle"
                            aria-pressed={allPitchers}
                            onClick={(e) => {
                              e.stopPropagation();
                              setAllPitchers(!allPitchers);
                            }}
                          >
                            {allPitchers ? '守れる投手だけにする' : `投手を全員出す（ほか${hiddenPitchers}人）`}
                          </button>
                        )}
                      </th>
                    </tr>
                    {group.players.map((player) => {
                      const fitnessPosition = focusPosition || (player.position === 'pitcher' ? bestFieldPosition(player) : player.position);
                      const selected = selectedBench?.id === player.id;
                      return (
                        <tr
                          key={player.id}
                          className={[
                            'online-lineup-row',
                            selected ? 'is-selected' : '',
                            focusPosition && !fitsFocus(player) ? 'is-unfit' : '',
                            drag?.kind === 'row' && dropAt?.kind === 'bench' && dropAt.playerId === player.id ? 'is-drop is-drop-bench' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          draggable
                          onDragStart={startDrag({ kind: 'bench', playerId: player.id })}
                          onDragEnd={endDrag}
                          onDragOver={over({ kind: 'bench', playerId: player.id })}
                          onDragLeave={leave}
                          onDrop={dropOn({ kind: 'bench', playerId: player.id })}
                          onClick={() => clickBench(player.id)}
                          data-bench={player.id}
                          data-bench-group={group.id}
                        >
                          <td className="online-lineup-slot">
                            <button
                              type="button"
                              aria-pressed={selected}
                              aria-label={selectedRow !== null ? `${player.name}と交代する` : `${player.name}を選ぶ`}
                              onClick={(e) => {
                                e.stopPropagation();
                                clickBench(player.id);
                              }}
                            >
                              <span aria-hidden="true" className="online-lineup-grip">
                                ⠿
                              </span>
                              {selectedRow !== null ? '交代' : ''}
                            </button>
                          </td>
                          <td className="online-lineup-poscell" title={`本職と、ほかに守れる位置（適性${LOW_FITNESS}%以上、高い順）`}>
                            <span className="online-lineup-playable">
                              <span className={`online-lineup-pos is-bench ${posTone(player.position)}`}>{POS[player.position] || '?'}</span>
                              {playablePositions(player)
                                .filter((e) => e.position !== player.position)
                                .slice(0, 2)
                                .map((e) => (
                                  <span key={e.position} className={posInk(e.position)}>{POS[e.position]}</span>
                                ))}
                            </span>
                          </td>
                          <PlayerCells player={player} fitnessPosition={fitnessPosition} onOpen={onOpen} />
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
              selected={selectedPos ?? (drag?.kind === 'pos' ? drag.index : null)}
              target={drag?.kind === 'pos' && dropAt?.kind === 'row' ? dropAt.index : hoverPos}
              focus={selectedRow}
              onPick={clickPosition}
              onHover={setHoverPos}
            />
          )}
        </div>
      </section>
    </div>
  );
}
