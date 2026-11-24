import React, { useEffect, useRef, useState } from 'react';
import {
  PitchingHeaderRow,
  PitchingCells,
  pitchingColumnCount,
  useRoleMenuDismiss,
  SlotButton,
  RoleChip,
} from '../../online/PitchingRows.jsx';
import { usePitchingPicking } from '../../online/usePitchingPicking.js';
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
import { ConditionMark } from '../../online/PlayerPerformance.jsx';
import '../../online/online.css';
import { inningsCell } from '../../utils/physics.js';
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

// 今季成績（投球）。⚠ 一人用の選手は `seasonStats.pitching` に積む（`inningsPitched` はアウト数）
const decimal = (v, digits = 2) => (v === null ? '—' : v.toFixed(digits));
const STATS = [
  { id: 'games', label: '登板', title: '登板', show: (s) => s.games || 0 },
  { id: 'outs', label: '投球回', title: '投球回', show: (s) => inningsCell(s.inningsPitched || 0) },
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
const STAT_HEADS = STATS.map((s) => ({ id: s.id, label: s.label, title: s.title }));
const COLUMN_COUNT = pitchingColumnCount(STAT_HEADS);

function HeaderRow() {
  return <PitchingHeaderRow stats={STAT_HEADS} fatigueTitle={`先発は疲労${STARTER_SKIP_FATIGUE}以上でその日の登板を飛ばします`} />;
}

function PitcherCells({ player, starter, onOpen }) {
  const stats = player.seasonStats?.pitching;
  return (
    <PitchingCells
      player={player}
      starter={starter}
      name={
        <>
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
        </>
      }
      // ⚠ 救援は疲労（シーズンの疲れ）では休ませない。登板間隔は試合の側が別の値
      //   （`pitchingRotation.reliefFatigue`）で見るので、赤（休み）の印は先発だけに付ける
      fatigue={{ rest: starter ? STARTER_SKIP_FATIGUE : Infinity, restText: '登板の日は飛ばして、次の先発が投げます' }}
      stats={STATS.map((s) => ({ id: s.id, text: stats ? s.show(stats) : '—' }))}
    />
  );
}

/** 役割の選び直し。先発の型・救援の役割・役割なしを並べて出す（押した札の下に出る） */
function RoleMenu({ menu, state, player, close, choose, remove }) {
  const ref = useRef(null);
  useRoleMenuDismiss(ref, close);
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
  // 「野手を投手で起用する」の一覧を開いているか（ふだんは畳む。野手は多い）
  const [fieldersOpen, setFieldersOpen] = useState(false);

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
    if ((aStarter && isFielder(b)) || (bStarter && isFielder(a))) return false;
    // 野手と「役割なし」の投手も入れ替えない（野手が役割なしになると、投手起用から黙って消える）
    const noRole = (id) => !state.starters.includes(id) && state.roles[id] === NO_ROLE;
    return !((isFielder(a) && noRole(b)) || (isFielder(b) && noRole(a)));
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
  // 選ぶ・入れ替える・見出しへ移す・ドラッグ・役割の一覧の位置はオンラインPC版と共通（`usePitchingPicking`）
  const picking = usePitchingPicking({
    commit: (next) => {
      if (next === state) return;
      writePitching(team, next);
      onChange();
    },
    swap: (a, b) => (canSwap(a, b) ? swapPitchers(state, a, b) : state),
    canSwap,
    canMoveTo,
    moveTo: (id, target) => {
      if (!canMoveTo(id, target)) return state;
      if (target === 'rotation') return insertStarter(state, id, state.starters.length);
      return setRole(state, id, target === 'relief' ? 'auto_r' : NO_ROLE);
    },
    heads: ['rotation', 'relief', 'none'],
    // ⚠ 一人用は「控え（役割なし）」の段があるぶんオンラインより背が高い（下が切れないように）
    menuHeight: () => 470,
  });
  const { selection, menu, clearSelection, closeMenu, clickRow, clickHead, startDrag, endDrag, dropProps, rowClass, headClass } =
    picking;
  const commit = picking.apply;
  useEffect(clearSelection, [resetKey, clearSelection]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection]);

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
  const roleChip = (player) => {
    const role = state.roles[player.id];
    return (
      <RoleChip
        picking={picking}
        player={player}
        role={role}
        label={soloRoleLabel(role)}
        hint={soloRoleHint(role)}
        starter={isStarterRole(role)}
        auto={role.startsWith('auto') || role === NO_ROLE}
      />
    );
  };
  const slotButton = (id, name, number = null) => <SlotButton picking={picking} id={id} name={name} number={number} />;

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
