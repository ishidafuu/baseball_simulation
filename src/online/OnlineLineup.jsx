import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LineupSettingContent } from '../components/LineupSettingScreen.jsx';
import { LEAGUE_SETTINGS } from '../teams-data.js';
import { teamFromView, planFromTeam } from './lineupBridge.js';
import { teamLabel } from './gameText.js';
import { Page } from './Page.jsx';
import { useDraftMemory, useDraftMemoryStore } from './Drafts.jsx';
import { CompactRoster } from './PlayerPerformance.jsx';

// 成績の表を横に出すか（PCの編成ページ）。端末ごとの好みなので localStorage に残す。
// ⚠ 読めない環境（プライベートウィンドウなど）でも動くよう、読み書きは try で包む
const STATS_PANEL_KEY = 'baseball-online-lineup-stats-v1';
const readStatsPanel = () => {
  try {
    return window.localStorage.getItem(STATS_PANEL_KEY) === '1';
  } catch {
    return false;
  }
};
const writeStatsPanel = (open) => {
  try {
    window.localStorage.setItem(STATS_PANEL_KEY, open ? '1' : '0');
  } catch {
    // 残せなくても、この画面を開いている間は効く
  }
};

/** 全画面の編成に、保存していない編集が残っているか（回転で作り直したときに開き直す判断に使う） */
export function hasUnsavedFullLineup(editing) {
  return !!editing && JSON.stringify(planFromTeam(editing.team)) !== editing.basePlan;
}

// ============================================================
// オンライン版の編成画面。**一人用の編成画面をそのまま使う**。
//
// 【なぜそのまま使えるか】`LineupSettingContent` は `team` をプロップで受け取り、
// その場で書き換える作りで、`TEAMS_DATA` への結合は外側の1行だけだった。
// だから view から `team` 形の複製を組み立てて渡せば、2,600行が動く。
// 組み立てと読み直しは `./lineupBridge.js`（ハーネスから検査するため別ファイル）。
//
// ⚠ **`.online` の中に置くなら `.online-sp` で包むこと**（PC版）。`online.css` は
//    `.online button { min-height:44px; border:1px solid …; background:var(--surface-1) }`
//    のように**要素名で**当てている。詳細度が 0,1,1 で Tailwind の
//    `.bg-gray-700`（0,1,0）より強いため、そのまま入れると一人用の画面の
//    ボタンが全部44pxの同じ高さ・同じ色に潰れて、小さな操作が読めなくなる。
//    要素名の指定には `:not(:where(.online-sp *))` が付けてある（`online.css` 冒頭）。
//    スマホ版は横に長い画面なので、ポータルで body 直下へ全画面で出す。
// ============================================================

const clone = (value) => JSON.parse(JSON.stringify(value));
// ⚠ PCでは隠れている間も残すので、外の再描画（毎分の更新・処理中の切り替え）で
//    作り直さないよう包む。中の画面は `team` をその場で書き換えて自分で再描画する
const MemoLineupContent = React.memo(LineupSettingContent);

export default function OnlineLineup(props) {
  return props.embedded ? <EmbeddedLineup {...props} /> : <PortalLineup {...props} />;
}

/**
 * PC版。**ほかのページと同じ枠の中に出す**（見出し・左メニュー・保存の場所が同じ）。
 *
 * ⚠ 以前はPCもポータルで全画面に被せていて、この3ページだけアプリの見出しが
 *    消え、別の見出しバー（「○○・編成」「方針・采配へ（保存しない）」
 *    「この編成で保存」）と、左メニューと同じタブが出ていた。
 * ⚠ 中に入れられるのは、`online.css` の要素指定（`.online button` など）が
 *    `.online-sp` の中に**当たらない**ようにしてあるから（`online.css` 冒頭）。
 *    当たると一人用の小さなボタンが全部44pxに潰れる。
 * ⚠ **ページを移っても編集を残す**（隠すだけで外さない）。以前は投手起用から
 *    選手成績へ移っただけで、保存していない編集が黙って消えていた。
 *    未保存の間は左メニューに印が付く（`onDirty`）。保存済みの間は
 *    最新のビューで作り直す（他の端末や締め切りでの変更を拾う）。
 */
function EmbeddedLineup({ view, busy, tab, title, hidden, onSave, onDirty }) {
  const [history, setHistory] = useState(null);
  const [generation, setGeneration] = useState(0);
  const [saveError, setSaveError] = useState('');
  // ⚠ **スマホの全画面編成と、編集中の球団を受け渡す**（下書きの入れ物 'lineup.full'）。
  //    スマホを横にすると幅が768px以上になり、PCの画面（この部品）に切り替わる。
  //    受け渡さないと、縦で編集した打順が横では消えて見え、横で保存して縦に戻すと
  //    古い編集が開き直されて「編成が更新されています」で保存できなかった
  const memory = useDraftMemoryStore();
  // 縦で保存していない編集を引き継いだか。引き継いだ編集は、中の画面の履歴から
  // 見ると「最初の状態」なので、未保存の印をこちらで立てておく
  const [restored, setRestored] = useState(() =>
    hasUnsavedFullLineup(memory?.get('lineup.full')),
  );
  const dirty = !!history?.dirty || restored;
  // ⚠ **成績の表を横に並べる**（「選手成績と同じ情報を見ながら編成したい」）。
  //    表は選手成績ページの部品（`CompactRoster`）をそのまま使う。見た目・並べ替え・
  //    選手の詳細が同じになり、編成の操作には手を入れない
  const [statsOpen, setStatsOpen] = useState(readStatsPanel);
  const toggleStats = () =>
    setStatsOpen((open) => {
      writeStatsPanel(!open);
      return !open;
    });
  const teamRef = useRef(null);
  const baseRef = useRef(null);
  const builtFor = useRef(null);
  if (!teamRef.current || (!dirty && builtFor.current !== view.revision)) {
    // ⚠ 未保存の編集があるあいだは作り直さない（作り直すと編集が消える）
    const kept = !teamRef.current ? memory?.get('lineup.full') : null;
    if (restored && kept && hasUnsavedFullLineup(kept)) {
      teamRef.current = kept.team;
      baseRef.current = kept.base;
    } else {
      const fresh = teamFromView(view);
      teamRef.current = fresh;
      baseRef.current = clone(view.lineup || {});
      // 中の画面は `team` をその場で書き換えるので、入れ物に入れておけば
      // 縦に戻したときにスマホの全画面編成がそのまま引き継げる
      memory?.set('lineup.full', {
        team: fresh,
        base: baseRef.current,
        basePlan: JSON.stringify(planFromTeam(fresh)),
      });
    }
    builtFor.current = view.revision;
  }
  const team = teamRef.current;
  // 表の「4番」「控え」「先発1」の印と起用の順は、**編集中の編成**で出す。
  //    保存した編成のままだと、打順を入れ替えても表の印が古いままになる。
  //    中の画面は `team` をその場で書き換え、編集のたびに `onHistory` で
  //    ここを描き直させるので、描くたびに組み立てれば追いつく
  const statsView = statsOpen
    ? { ...view, lineup: { ...(view.lineup || {}), ...planFromTeam(team) } }
    : null;
  // 作り直したら中の画面（履歴・選択中の状態）も作り直す
  const key = `${builtFor.current}:${generation}`;
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  // ⚠ 未保存の編集があるうちは、閉じる・再読み込みの前に確かめる。
  //    ほかの編集（`Drafts` の `lineup.dirty`）と同じ。この画面の編集は
  //    下書きに残らない（一人用の画面がその場で書き換える）ので、閉じると消える
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ⚠ 一人用の画面は `LEAGUE_SETTINGS.useDH` を見る。オンラインのリーグ設定に合わせる
  LEAGUE_SETTINGS.useDH = !!view.useDH;

  const save = async () => {
    setSaveError('');
    const result = await onSave(planFromTeam(team), baseRef.current);
    if (result && !result.ok) {
      setSaveError(result.error || '保存できませんでした');
      return;
    }
    // ⚠ 保存できたら、保存した内容を新しい起点にする（元に戻すの履歴も切る）
    memory?.delete('lineup.full');
    teamRef.current = null;
    setRestored(false);
    setHistory(null);
    setGeneration((g) => g + 1);
  };
  const discard = () => {
    memory?.delete('lineup.full');
    teamRef.current = null;
    setRestored(false);
    setHistory(null);
    setSaveError('');
    setGeneration((g) => g + 1);
  };
  return (
    <div hidden={hidden}>
      <Page
        title={title}
        sticky
        sub={
          saveError ? (
            <span role="alert" className="online-error-text">
              保存できませんでした：{saveError}（編集は残っています）
            </span>
          ) : dirty ? (
            '保存していない変更があります。保存するまで試合には反映されません。'
          ) : (
            '変更は「保存」を押すまでサーバーには送られません。'
          )
        }
        actions={
          <>
            <button
              aria-pressed={statsOpen}
              onClick={toggleStats}
              title="選手成績と同じ表を右に並べます"
            >
              {statsOpen ? '成績を隠す' : '成績を表示'}
            </button>
            <button
              disabled={busy || !history?.canUndo}
              onClick={() => history?.undo()}
              title="元に戻す（Ctrl+Z）"
            >
              元に戻す
            </button>
            <button
              disabled={busy || !history?.canRedo}
              onClick={() => history?.redo()}
              title="やり直す（Ctrl+Shift+Z）"
            >
              やり直す
            </button>
            <button disabled={busy || !dirty} onClick={discard}>
              変更を取り消す
            </button>
            <button
              className="online-primary"
              disabled={busy || !dirty}
              onClick={save}
            >
              保存
            </button>
          </>
        }
      >
        {/* ⚠ **保存の応答待ちの間は触れなくする**（`inert`）。一人用の画面は
            `busy` を知らないので、そのままだと送信中にも並べ替えられ、
            保存が終わって作り直したときにその編集が黙って消える */}
        <div className={`online-lineup-split${statsOpen ? ' has-stats' : ''}`}>
        <div className="online-sp" inert={busy ? '' : undefined}>
          {/* ⚠ teamName は内部名のまま渡す（画面の中で名前による照合に使われる）
              ⚠ `initialTab` は左メニューの項目から、画面の中のタブへ直に入るため
              ⚠ `canConvertPosition` / `canSealPitch`: オンラインの保存に項目が無いので出さない
              ⚠ `embedded`: 見出しと画面内のタブを出さない（左メニューと二重になる） */}
          <MemoLineupContent
            key={key}
            teamName={view.teamName}
            displayName={teamLabel(view.teamName)}
            team={team}
            canConvertPosition={false}
            canSealPitch={false}
            initialTab={tab}
            embedded
            keyboardActive={!hidden && !busy}
            onHistory={setHistory}
          />
        </div>
        {/* ⚠ 表は**画面の上に留める**（`position: sticky`）。編成の一覧を下へ
            送っても、見比べたい成績が隠れないように。幅は右下の角で変えられる */}
        {statsOpen && (
          <aside className="online-card online-lineup-stats" aria-label="選手成績">
            {/* ⚠ 区分はページに合わせる（投手起用なら投球）。ページを移ったら作り直す */}
            <CompactRoster
              key={tab}
              view={statsView}
              desktop
              initialCategory={tab === 'rotation' ? 'pitching' : 'batting'}
            />
          </aside>
        )}
        </div>
      </Page>
    </div>
  );
}

/** スマホ版。横に長い画面なので、押したときだけ全画面で被せる */
function PortalLineup({ view, busy, tab, onSave, onClose }) {
  // ⚠ 画面は `team` を書き換えるので、開いている間は同じオブジェクトを保つ。
  //    毎回作り直すと編集が消える。
  // ⚠ 部品の中（useRef）ではなく下書きの入れ物に持つ。スマホの回転でスマホ用と
  //    PC用の画面が入れ替わると、この部品ごと作り直されて編集が消えていた
  //    編集していない写しは使い回さない（開き直したら最新の編成から始める）
  const [editing, discard] = useDraftMemory(
    'lineup.full',
    () => {
      const fresh = teamFromView(view);
      return {
        team: fresh,
        base: clone(view.lineup || {}),
        basePlan: JSON.stringify(planFromTeam(fresh)),
      };
    },
    hasUnsavedFullLineup,
  );
  const team = editing.team;

  const [saveError, setSaveError] = useState('');
  const save = async () => {
    setSaveError('');
    const result = await onSave(planFromTeam(team), editing.base);
    if (result && !result.ok) setSaveError(result.error || '保存できませんでした');
    else if (result?.ok) discard();
  };
  const close = () => {
    discard();
    onClose();
  };

  // ⚠ 一人用の画面は `LEAGUE_SETTINGS.useDH` を見る。オンラインのリーグ設定に合わせる
  LEAGUE_SETTINGS.useDH = !!view.useDH;

  return createPortal(
    <div className="online-lineup-portal fixed inset-0 z-50 overflow-y-auto bg-surface-0">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-700 bg-surface-1 px-4 py-2">
        <strong className="text-white">{teamLabel(view.teamName)} · 編成</strong>
        {saveError ? (
          // ⚠ 失敗の文言はここに出す。画面上部の帯はこの全画面の裏に隠れる
          <span role="alert" className="text-xs text-red-300">
            保存できませんでした：{saveError}（編集は残っています）
          </span>
        ) : (
          <span className="text-xs text-gray-300">
            保存するまでサーバーには送られません
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className="rounded border border-gray-600 bg-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600 disabled:opacity-50"
          >
            方針・采配の設定へ（保存しない）
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="rounded bg-cyan-500 px-3 py-1.5 text-sm font-bold text-cyan-950 hover:bg-cyan-400 disabled:opacity-50"
          >
            この編成で保存
          </button>
        </div>
      </div>
      {/* ⚠ teamName は内部名のまま渡す（画面の中で名前による照合に使われる）
          ⚠ `initialTab` は左メニューの項目から、画面の中のタブへ直に入るため */}
      <LineupSettingContent
        teamName={view.teamName}
        displayName={teamLabel(view.teamName)}
        team={team}
        canConvertPosition={false}
        canSealPitch={false}
        initialTab={tab}
      />
    </div>,
    document.body,
  );
}
