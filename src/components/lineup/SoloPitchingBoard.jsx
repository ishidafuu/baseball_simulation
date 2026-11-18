import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Fatigue } from '../../online/BoardParts.jsx';
import { POS_FULL } from '../../online/api.js';
import {
  MAX_STARTERS,
  STARTER_ORDER,
  RELIEF_ORDER,
  isStarterRole,
  swapPitchers,
  setRole,
  insertStarter,
  reliefGroups,
  pitchingProblems,
  onStaff,
  addToStaff,
  removeFromStaff,
  staffCandidates,
  STARTER_SKIP_FATIGUE,
} from '../../online/pitchingEdit.js';
import { AbilityValue } from '../AbilityValue.jsx';
import { pitchTypes, totalBreak } from '../../online/playerColumns.js';
import { FORM_SHORT, FORM_NAME, getFatigueTone } from '../../utils/constants.js';
import { CONDITION_ICONS } from '../../game/condition.js';
import '../../online/online.css';
import {
  NO_ROLE,
  soloRoleLabel,
  soloRoleHint,
  pitchingFromTeam,
  writePitching,
  nextStarterIdOf,
  unassignedPitchers,
  roleBlocked,
  pitchingNotes,
} from './soloPitchingEdit.js';

// ============================================================
// 一人用の投手起用（ロスター管理 → 試合のオーダー → 投手起用）。
// **オンラインPC版の投手起用（`src/online/PitchingBoard.jsx`）の形を流用**した表。
//
// 【意図】投手起用で決めるのは「誰を何番目に先発させるか」と「救援の誰にどの場面を
//   任せるか」。比べたいのは同じ役割の候補どうしの実力・今季の結果・調子と疲労。
//   だから全投手を1枚の表に、先発ローテ（登板順）→ 救援（使われる場面の順）→ 役割なし
//   と並べ、役割は各行の札で示す。
// 【操作】行を押して選び、ほかの行を押すと持ち場（登板順・役割）を入れ替える。
//   見出しを押す・見出しへ落とすと、ローテに入れる／外す／役割なしにする。ドラッグでも同じ。
//   役割の札を押すと役割を選び直せる。
// ⚠ 以前の一人用の画面にあった次のものは**置かない**（オンラインで同じ指摘を受けて外した。
//    2026-11-04 いしだ）: 自動設定・全員おまかせのボタン（どう変わるか分からない）・
//    役割ごとの大きな空き枠・先発と救援で書き方の違うカード・ロール解説の折り畳み
//    （札を押すと各役割の説明が出る）。
// ⚠ 一人用だけの違い（「役割なし」・野手は救援だけ）は `soloPitchingEdit.js` の先頭。
// ⚠ 球種の封印は選手の詳細（名前を押す）に残してある（`LineupSettingContent` の詳細）。
// ⚠ 見た目はオンラインの部品のクラスをそのまま使うので `.online.online-desktop.online-embed`
//    の中に置く。中に一人用（Tailwind）の部品を入れないこと。
// ⚠ 編集はその場で `team` に書き、`onChange` で親に知らせる（元に戻すは親の履歴）。
// ============================================================

const CONDITION_TEXT = ['絶不調', '不調', '普通', '好調', '絶好調'];
const FATIGUE_TONE_TEXT = {
  warn: '疲れています（このまま投げ続けると成長が鈍ります）',
  heavy: 'かなり疲れています（成長の鈍り方が最も大きくなります）',
  '': undefined,
};

// 今季成績（投球）。⚠ 一人用の選手は `seasonStats.pitching` に積む（`inningsPitched` はアウト数）
// 投球回（アウト数 → 「18 2/3」）
const innings = (outs) => `${Math.floor(outs / 3)}${outs % 3 ? ` ${outs % 3}/3` : ''}`;
const decimal = (v, digits = 2) => (v === null ? '—' : v.toFixed(digits));
const STATS = [
  { id: 'games', label: '登板', title: '登板', show: (s) => s.games || 0 },
  { id: 'outs', label: '投球回', title: '投球回', show: (s) => innings(s.inningsPitched || 0) },
  {
    id: 'era',
    label: '防御率',
    title: '防御率',
    show: (s) => decimal(s.inningsPitched > 0 ? ((s.earnedRuns || 0) * 27) / s.inningsPitched : null),
  },
  { id: 'wins', label: '勝', title: '勝利', show: (s) => s.wins || 0 },
  { id: 'losses', label: '敗', title: '敗戦', show: (s) => s.losses || 0 },
  { id: 'holds', label: 'H', title: 'ホールド', show: (s) => s.holds || 0 },
  { id: 'saves', label: 'S', title: 'セーブ', show: (s) => s.saves || 0 },
  {
    id: 'whip',
    label: 'WHIP',
    title: 'WHIP（1回あたりに出した走者）',
    show: (s) => decimal(s.inningsPitched > 0 ? (((s.hits || 0) + (s.walks || 0)) * 3) / s.inningsPitched : null),
  },
];
// ⚠ 列を足したらここも直すこと（`colSpan` がずれると罫線が折れる）。
//    順・役割・投手 / 投・フォーム・年齢・疲労 / 球速・制球・スタ・変化 / 成績（オンラインPC版と同じ）
const COLUMN_COUNT = 3 + 4 + 4 + STATS.length;

function ConditionMark({ player }) {
  const level = Number.isInteger(player.condition) && player.condition >= 0 && player.condition <= 4 ? player.condition : null;
  const text = level === null ? '未記録' : CONDITION_TEXT[level];
  return (
    <span className={`online-condition online-condition-${level ?? 'unknown'}`} title={`調子: ${text}`} aria-label={`調子: ${text}`} role="img">
      {level === null ? '—' : CONDITION_ICONS[level]}
    </span>
  );
}

function HeaderRow() {
  return (
    <tr>
      <th className="online-lineup-slot">順</th>
      <th className="online-pitch-rolecell">役割</th>
      <th className="online-lineup-person">投手</th>
      <th title="投げる手">投</th>
      {/* ⚠ フォームを出す。球種の相性と左右の打者への効き方が変わるので、救援の並べ方を決めるのに要る */}
      <th title="投球フォーム">フォーム</th>
      <th>年齢</th>
      <th className="is-sep" title={`先発は疲労${STARTER_SKIP_FATIGUE}以上でその日の登板を飛ばします`}>
        疲労
      </th>
      <th className="is-sep" title="球速">
        球速
      </th>
      <th title="制球">制球</th>
      <th title="スタミナ">スタ</th>
      <th title="変化球（直球を除く持ち球）の変化量の合計">変化</th>
      {STATS.map((s, i) => (
        <th key={s.id} className={i === 0 ? 'is-sep is-stat' : 'is-stat'} title={`今季の${s.title}`}>
          {s.label}
        </th>
      ))}
    </tr>
  );
}

function PitcherCells({ player, starter, onOpen }) {
  const tone = getFatigueTone(player.fatigue);
  const stats = player.seasonStats?.pitching;
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
        {player.position !== 'pitcher' && (
          <small className="online-role-mark" title="野手登録の選手です（二刀流）。役割の札から投手起用を外せます">
            野手・{POS_FULL[player.position] || ''}
          </small>
        )}
      </td>
      <td>{player.physical?.throws === 'left' ? '左' : '右'}</td>
      <td className="online-pitch-form" title={FORM_NAME[player.pitching?.form] || undefined}>
        {FORM_SHORT[player.pitching?.form] || '—'}
      </td>
      <td>{player.age ?? '—'}</td>
      <td className="is-sep">
        {/* ⚠ 救援は疲労（シーズンの疲れ）では休ませない。登板間隔は試合の側が別の値
            （`pitchingRotation.reliefFatigue`）で見るので、赤（休み）の印は先発だけに付ける */}
        <Fatigue
          value={player.fatigue}
          rest={starter ? STARTER_SKIP_FATIGUE : Infinity}
          warn={starter ? 20 : 30}
          restText="登板の日は飛ばして、次の先発が投げます"
        />
      </td>
      <td className="is-sep">
        <AbilityValue value={player.pitching?.velocity} isVel placeholder="—" />
      </td>
      <td>
        <AbilityValue value={player.pitching?.control} placeholder="—" />
      </td>
      <td>
        <AbilityValue value={player.pitching?.stamina} isSta placeholder="—" />
      </td>
      <td title={pitchTypes(player) || '変化球なし'}>{totalBreak(player) ?? '—'}</td>
      {STATS.map((s, i) => (
        <td key={s.id} className={i === 0 ? 'is-sep is-stat' : 'is-stat'}>
          {stats ? s.show(stats) : '—'}
        </td>
      ))}
    </>
  );
}

/** 役割の選び直し。先発の型・救援の役割・役割なしを並べて出す（押した札の下に出る） */
function RoleMenu({ menu, state, player, close, choose, remove }) {
  const ref = useRef(null);
  useEffect(() => {
    // ⚠ 開いた札を押したときは閉じない（札の側で閉じる。ここで閉じると続くクリックで開き直す）
    const away = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (e.target.closest?.('.online-role-chip[aria-expanded="true"]')) return;
      close();
    };
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [close]);
  const current = state.roles[menu.id];
  const option = (role) => {
    const blocked = roleBlocked(state, player, role);
    return (
      <button
        key={role}
        type="button"
        aria-pressed={current === role}
        disabled={!!blocked}
        title={blocked || soloRoleHint(role)}
        onClick={() => choose(role)}
      >
        <strong>{soloRoleLabel(role)}</strong>
        <small>{soloRoleHint(role)}</small>
      </button>
    );
  };
  const fielder = player.position !== 'pitcher';
  return (
    <div ref={ref} className="online-role-menu" role="dialog" aria-label={`${menu.name}の役割`} style={{ top: menu.top, left: menu.left }}>
      {!fielder && (
        <>
          <p>先発（ローテーションに入る）</p>
          <div>{STARTER_ORDER.map(option)}</div>
        </>
      )}
      <p>救援</p>
      <div>{RELIEF_ORDER.map(option)}</div>
      {fielder ? (
        <>
          <p>野手（二刀流）</p>
          <div>
            <button type="button" title="投手起用から外します。試合では投げません" onClick={remove}>
              <strong>投手起用から外す</strong>
              <small>野手だけで出る</small>
            </button>
          </div>
        </>
      ) : (
        <>
          <p>控え</p>
          <div>
            {option(NO_ROLE)}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * @param team     編集する球団（その場で書き換える）
 * @param onChange 書き換えたあとに呼ぶ（親が描き直して履歴に積む）
 * @param onOpen   選手名を押したとき（選手詳細を開く。球種の封印もそこ）
 * @param resetKey これが変わったら選択を外す（親の 元に戻す・やり直す）
 */
export default function SoloPitchingBoard({ team, onChange, onOpen, resetKey }) {
  const roster = team.players || [];
  const byId = new Map(roster.map((p) => [p.id, p]));
  const state = pitchingFromTeam(team);
  const [selection, setSelection] = useState(null);
  const [menu, setMenu] = useState(null);
  const [drag, setDrag] = useState(null);
  const [dropAt, setDropAt] = useState(null);
  // 「野手を投手で起用する」の一覧を開いているか（ふだんは畳む。野手は多い）
  const [fieldersOpen, setFieldersOpen] = useState(false);
  const clearSelection = useCallback(() => {
    setSelection(null);
    setMenu(null);
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(clearSelection, [resetKey, clearSelection]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commit = (next) => {
    setSelection(null);
    setMenu(null);
    if (next === state) return;
    writePitching(team, next);
    onChange();
  };

  const nameOf = (id) => byId.get(id)?.name || '名簿に居ない投手';
  const pitcherOf = (id) => (onStaff(state, id) && byId.get(id)) || null;
  const isFielder = (id) => {
    const p = byId.get(id);
    return !!p && p.position !== 'pitcher';
  };
  // ⚠ 野手は先発に入れない（一人用の先発選びは投手登録の選手だけ。`soloPitchingEdit.js`）。
  //    先発と野手の入れ替えは、野手が先発の持ち場を引き継ぐので受け付けない
  const canSwap = (a, b) => {
    if (a === b) return false;
    const aStarter = state.starters.includes(a);
    const bStarter = state.starters.includes(b);
    return !((aStarter && isFielder(b)) || (bStarter && isFielder(a)));
  };
  const swap = (a, b) => (canSwap(a, b) ? swapPitchers(state, a, b) : state);
  const clickRow = (id) => {
    if (selection !== null && selection !== id) commit(swap(selection, id));
    else setSelection(selection === id ? null : id);
  };
  // 見出しへ移せるか: 救援・役割なし → 「先発ローテーション」（最後へ入る）/ 先発・救援 → 「救援」/
  //   先発・救援 → 「役割なし」。⚠ 人数の決まり（先発は1〜8人）で動かせないときは光らせない
  const canMoveTo = (id, target) => {
    const starter = state.starters.includes(id);
    if (target === 'rotation') return !starter && !isFielder(id) && state.starters.length < MAX_STARTERS;
    if (starter && state.starters.length <= 1) return false;
    if (target === 'relief') return starter || state.roles[id] === NO_ROLE;
    // 役割なし: 投手だけ（野手は「投手起用から外す」で外す）
    return !isFielder(id) && state.roles[id] !== undefined && state.roles[id] !== NO_ROLE;
  };
  const moveTo = (id, target) => {
    if (!canMoveTo(id, target)) return state;
    if (target === 'rotation') return insertStarter(state, id, state.starters.length);
    return setRole(state, id, target === 'relief' ? 'auto_r' : NO_ROLE);
  };
  const clickHead = (target) => {
    if (selection !== null) commit(moveTo(selection, target));
  };
  const openMenu = (player) => (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const width = 420;
    setSelection(null);
    setMenu(
      menu?.id === player.id
        ? null
        : {
            id: player.id,
            name: player.name,
            // ⚠ 一人用は「控え（役割なし）」の段があるぶんオンラインより背が高い（下が切れないように）
            top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 470)),
            left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
          },
    );
  };

  // ---- ドラッグ: 落とした先で決まる（行＝入れ替え、見出し＝そこへ移す）
  const startDrag = (id) => (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
    setDrag(id);
    setSelection(null);
    setMenu(null);
  };
  const endDrag = () => {
    setDrag(null);
    setDropAt(null);
  };
  const HEADS = ['rotation', 'relief', 'none'];
  const over = (target) => (e) => {
    if (drag === null) return;
    if (HEADS.includes(target) ? !canMoveTo(drag, target) : !canSwap(drag, target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropAt !== target) setDropAt(target);
  };
  const dropOn = (target) => (e) => {
    e.preventDefault();
    const id = drag;
    endDrag();
    if (id === null) return;
    commit(HEADS.includes(target) ? moveTo(id, target) : swap(id, target));
  };
  const dropProps = (target) => ({
    onDragOver: over(target),
    onDragLeave: () => setDropAt(null),
    onDrop: dropOn(target),
  });

  const problems = [
    ...pitchingProblems(state, roster),
    ...(state.starters.some((id) => isFielder(id)) ? ['野手が先発に入っています（一人用の先発は投手登録の選手だけです）'] : []),
  ];
  const notes = pitchingNotes(state, roster);
  const nextStarterId = nextStarterIdOf(team);
  const groups = reliefGroups(state, roster);
  const relievers = groups.flatMap((g) => g.players);
  const vacant = groups.filter((g) => !g.players.length && g.role !== 'auto_r').map((g) => g.role);
  const unassigned = unassignedPitchers(state, roster);
  const candidates = staffCandidates(state, roster);
  const selectedStarter = selection !== null && state.starters.includes(selection);
  const help =
    selection !== null
      ? `${nameOf(selection)}を選択中：ほかの投手を押すと持ち場（登板順・役割）を入れ替えます。${
          selectedStarter
            ? canMoveTo(selection, 'relief')
              ? '「救援」の見出しを押すとローテから外します。'
              : '先発が1人だけなので、ローテからは外せません。'
            : isFielder(selection)
              ? '野手は先発に入れられません。'
              : canMoveTo(selection, 'rotation')
                ? '「先発ローテーション」の見出しを押すとローテの最後に入れます。'
                : `先発は${MAX_STARTERS}人までです。ローテに入れるには先発の投手と入れ替えてください。`
        }`
      : '役割の札を押すと役割を選び直せます。行を押して選び、ほかの投手を押すと持ち場を入れ替えます。ドラッグでも同じです（先発どうしは2人の登板順を入れ替えます）。Escで選択を取り消します。';
  const pickLabel = (id, name) => (selection !== null && selection !== id ? `${name}と入れ替える` : `${name}を選ぶ`);

  const rowClass = (id, extra = []) =>
    ['online-lineup-row', selection === id ? 'is-selected' : '', drag === id ? 'is-dragging' : '', dropAt === id ? 'is-drop' : '', ...extra]
      .filter(Boolean)
      .join(' ');
  const headClass = (target) =>
    [
      'online-lineup-bench-head',
      dropAt === target ? 'is-drop' : '',
      selection !== null && canMoveTo(selection, target) ? 'is-target' : '',
    ]
      .filter(Boolean)
      .join(' ');

  const roleChip = (player) => {
    const role = state.roles[player.id];
    return (
      <button
        type="button"
        className={[
          'online-role-chip',
          isStarterRole(role) ? 'is-starter' : 'is-relief',
          role === 'closer' ? 'is-closer' : '',
          role.startsWith('auto') || role === NO_ROLE ? 'is-auto' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-haspopup="dialog"
        aria-expanded={menu?.id === player.id}
        aria-label={`${player.name}の役割（${soloRoleLabel(role)}）を選び直す`}
        title={soloRoleHint(role)}
        onClick={openMenu(player)}
      >
        {soloRoleLabel(role)}
      </button>
    );
  };

  const slotButton = (id, name, number = null) => (
    <button
      type="button"
      aria-pressed={selection === id}
      aria-label={pickLabel(id, name)}
      onClick={(e) => {
        e.stopPropagation();
        clickRow(id);
      }}
    >
      <span aria-hidden="true" className="online-lineup-grip">
        ⠿
      </span>
      {number}
    </button>
  );

  const pitcherRow = (player, kind, extra = []) => (
    <tr
      key={player.id}
      className={rowClass(player.id, extra)}
      draggable
      onDragStart={startDrag(player.id)}
      onDragEnd={endDrag}
      {...dropProps(player.id)}
      onClick={() => clickRow(player.id)}
      {...{ [`data-${kind}`]: player.id }}
    >
      <td className="online-lineup-slot">{slotButton(player.id, player.name)}</td>
      <td className="online-pitch-rolecell">{roleChip(player)}</td>
      <PitcherCells player={player} starter={false} onOpen={onOpen} />
    </tr>
  );

  const menuPlayer = menu ? byId.get(menu.id) : null;

  return (
    <div className="online online-desktop online-embed">
      <section className="online-card online-lineup-board" data-testid="solo-pitching-board">
        <p className="online-lineup-help" aria-live="polite">
          {problems.length ? <span className="online-error-text">{problems[0]}</span> : help}
          {!problems.length && notes.length > 0 && <span className="online-error-text"> 注意：{notes.join('・')}</span>}
        </p>
        <div className="online-lineup-scroll">
          <table className="online-lineup-table online-pitch-table">
            <thead>
              <HeaderRow />
            </thead>
            <tbody aria-label="先発ローテーション" data-starter-order>
              <tr className={headClass('rotation')} onClick={() => clickHead('rotation')} {...dropProps('rotation')}>
                <th colSpan={COLUMN_COUNT}>
                  先発ローテーション {state.starters.length}/{MAX_STARTERS}人
                  <small>
                    上から順に登板します（「次」の印が次の試合の先発）。疲労{STARTER_SKIP_FATIGUE}以上の先発はその日を飛ばします。
                  </small>
                </th>
              </tr>
              {state.starters.map((id, index) => {
                const player = pitcherOf(id);
                return (
                  <tr
                    key={id}
                    className={rowClass(id)}
                    draggable
                    onDragStart={startDrag(id)}
                    onDragEnd={endDrag}
                    {...dropProps(id)}
                    onClick={() => clickRow(id)}
                    data-starter={id}
                  >
                    <td className="online-lineup-slot">
                      {slotButton(id, `先発${index + 1}番手`, index + 1)}
                      {id === nextStarterId && (
                        <span className="online-pitch-next" title="次の試合の先発予定">
                          次
                        </span>
                      )}
                    </td>
                    <td className="online-pitch-rolecell">{player && roleChip(player)}</td>
                    {player ? (
                      <PitcherCells player={player} starter onOpen={onOpen} />
                    ) : (
                      <td colSpan={COLUMN_COUNT - 2} className="online-lineup-missing">
                        {byId.has(id) ? `${nameOf(id)}は今は起用できません。` : '名簿に居ない投手です。'}
                        この行を選んで救援の投手を押すと入れ替わります（「救援」の見出しへ落とすと外れます）
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tbody aria-label="救援">
              <tr className={headClass('relief')} onClick={() => clickHead('relief')} {...dropProps('relief')}>
                <th colSpan={COLUMN_COUNT}>
                  救援 {relievers.length}人
                  <small>
                    使われる場面の順（役割の順）に並べています。
                    {vacant.length > 0 && <> 空いている役割：{vacant.map(soloRoleLabel).join('・')}</>}
                  </small>
                </th>
              </tr>
              {relievers.map((player, i) =>
                pitcherRow(player, 'reliever', [
                  i > 0 && state.roles[relievers[i - 1].id] !== state.roles[player.id] ? 'is-role-start' : '',
                ]),
              )}
            </tbody>
            <tbody aria-label="役割なし">
              <tr className={headClass('none')} onClick={() => clickHead('none')} {...dropProps('none')}>
                <th colSpan={COLUMN_COUNT}>
                  役割なし {unassigned.length}人
                  <small>救援の顔ぶれに入らず、ほかに投げる投手が居ないときだけ投げます。</small>
                </th>
              </tr>
              {unassigned.map((player) => pitcherRow(player, 'unassigned'))}
            </tbody>
            {candidates.length > 0 && (
              <tbody aria-label="野手を投手で起用する">
                <tr className="online-lineup-bench-head">
                  <th colSpan={COLUMN_COUNT}>
                    野手を投手で起用する（二刀流） {candidates.length}人
                    <small>
                      加えると救援の「おまかせ」で入ります。役割の札で救援の役割を選び直せます。先発にするには選手の詳細でポジションを投手に変えてください。
                    </small>
                    <button
                      type="button"
                      className="online-lineup-group-toggle"
                      aria-expanded={fieldersOpen}
                      onClick={() => setFieldersOpen(!fieldersOpen)}
                    >
                      {fieldersOpen ? '畳む' : '野手を出す'}
                    </button>
                  </th>
                </tr>
                {fieldersOpen &&
                  candidates.map((player) => (
                    <tr key={player.id} className="online-lineup-row is-candidate" data-staff-candidate={player.id}>
                      <td className="online-lineup-slot" />
                      <td className="online-pitch-rolecell">
                        <button
                          type="button"
                          className="online-role-chip is-add"
                          aria-label={`${player.name}を投手起用に加える`}
                          onClick={() => commit(addToStaff(state, player))}
                        >
                          加える
                        </button>
                      </td>
                      <PitcherCells player={player} starter={false} onOpen={onOpen} />
                    </tr>
                  ))}
              </tbody>
            )}
          </table>
        </div>
      </section>
      {menu && menuPlayer && (
        <RoleMenu
          menu={menu}
          state={state}
          player={menuPlayer}
          close={closeMenu}
          choose={(role) => commit(setRole(state, menu.id, role))}
          remove={() => commit(removeFromStaff(state, menu.id, roster))}
        />
      )}
    </div>
  );
}
