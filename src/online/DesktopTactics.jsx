import React, { useEffect, useState } from 'react';
import { STRATEGY_FIELDS, TACTIC_FIELDS, TACTIC_DEFAULTS, strategyEffectText } from './tactics.js';
import { useDraftState } from './Drafts.jsx';
import {
  rebaseLineupSave,
  sameValue,
  LINEUP_EDITOR_KEYS,
  TACTICS_EDITOR_KEYS,
} from './lineupBridge.js';
import { Page } from './Page.jsx';
import { Choice } from './Choice.jsx';
import { StaffActual as Actual, TacticsDelegateNote } from './StaffPage.jsx';

// ============================================================
// PC版「方針・采配」。**基本方針と自動采配だけ**を決めるページ。
//
// ⚠ 以前はここに「打順・守備」「先発」「投手の役割」のタブもあり、
//    スタメン設定・投手起用と**同じものを別の操作で**編集できた。
//    しかもコンボボックスと↑↓で、名前しか出ない（能力・調子・成績が見えない）。
//    打順・先発・役割はスタメン設定・投手起用だけで決める。
// ⚠ **選択肢はボタンで並べる**（コンボボックスにしない）。どれも2〜6択で、
//    開かないと今の値以外が見えないのは使いづらいという指摘を受けた。
// ⚠ 保存はほかの編集ページと同じく**見出しの右**に「変更を取り消す」「保存」。
// ⚠ 編成は1つの塊で保存するので、スタメン設定側の未保存の編集とぶつからないよう
//    自分の項目（方針・自動采配）だけを最新の編成に載せて送る（`rebaseLineupSave`）。
// ⚠ 下書きは**スマホの「打順」カード（`LineupPanel`）と同じ名前**（`lineup.*`）。
//    同じタブで幅が変わってPC表示になっても、スマホで変えた采配が消えない。
//    閉じる前の確認（`Drafts` の `lineup.dirty`）もこれで効く。
// ============================================================

const clone = (value) => JSON.parse(JSON.stringify(value));

export default function DesktopTactics({ view, busy, run, command }) {
  const [draft, setDraft] = useDraftState('lineup.plan', () =>
    clone(view.lineup || {}),
  );
  const [dirty, setDirty] = useDraftState('lineup.dirty', false);
  const [base, setBase] = useDraftState('lineup.base', () =>
    clone(view.lineup || {}),
  );
  const [error, setError] = useState('');
  // 保存済みの間は最新の編成に合わせる（他の端末やスタメン設定での保存を拾う）
  useEffect(() => {
    if (!dirty) {
      setDraft(clone(view.lineup || {}));
      setBase(clone(view.lineup || {}));
    }
  }, [view.lineup, dirty, setDraft, setBase]);

  const setStrategy = (key, value) => {
    setDraft({ ...draft, strategy: { ...draft.strategy, [key]: value } });
    setDirty(true);
  };
  const setTactic = (key, value) => {
    setDraft({
      ...draft,
      tactics: {
        ...draft.tactics,
        [key]: typeof TACTIC_DEFAULTS[key] === 'number' ? Number(value) : value,
      },
    });
    setDirty(true);
  };
  // ⚠ スマホ表示のときに打順などを変えて未保存のままPC表示になった場合、
  //    その変更も一緒に送る（ここで「保存済み」にすると黙って消えるため）
  const ownKeys = [
    ...TACTICS_EDITOR_KEYS,
    ...LINEUP_EDITOR_KEYS.filter((k) => !sameValue(draft[k], base[k])),
  ];
  const save = () =>
    run(async () => {
      setError('');
      try {
        await command(
          'lineup',
          rebaseLineupSave(draft, base, view.lineup, ownKeys),
          { message: '方針・采配を保存しました' },
        );
        setDirty(false);
      } catch (e) {
        setError(e.message);
        throw e;
      }
    });
  const discard = () => {
    setDraft(clone(view.lineup || {}));
    setBase(clone(view.lineup || {}));
    setDirty(false);
    setError('');
  };

  return (
    <Page
      title="方針・采配"
      sticky
      sub={
        error ? (
          <span role="alert" className="online-error-text">
            保存できませんでした：{error}（編集は残っています）
          </span>
        ) : dirty ? (
          '保存していない変更があります。保存すると次回の進行から反映します。'
        ) : (
          '打順・先発・投手の役割は「スタメン設定」「投手起用」で決めます。'
        )
      }
      actions={
        <>
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
      <TacticsDelegateNote view={view} />
      <div className="online-board is-even">
        <section className="online-card online-board-main">
          <h2>基本方針</h2>
          <p className="online-muted">試合全体の攻め方・守り方です。</p>
          <div className="online-choices">
            {Object.entries(STRATEGY_FIELDS).map(([key, [label, values]]) => (
              <div key={key} className="online-staff-choice">
                <Choice
                  label={label}
                  options={values}
                  value={draft.strategy?.[key] || Object.keys(values)[0]}
                  disabled={busy}
                  onChange={(value) => setStrategy(key, value)}
                />
                <small className="online-strategy-effect">
                  {strategyEffectText(key, draft.strategy?.[key] || Object.keys(values)[0])}
                </small>
                <Actual view={view} field="strategy" name={key} />
              </div>
            ))}
          </div>
        </section>
        <section className="online-card online-board-side">
          <h2>自動采配</h2>
          <p className="online-muted">
            AIが状況を判断する範囲です。球数上限は役割の上限より低い場合に打席の区切りで判断し、疲労限界による交代は維持します。
          </p>
          <div className="online-choices">
            {Object.entries(TACTIC_FIELDS).map(([key, [label, options]]) => (
              <div key={key} className="online-staff-choice">
                <Choice
                  label={label}
                  options={options}
                  value={draft.tactics?.[key] ?? TACTIC_DEFAULTS[key]}
                  disabled={busy}
                  onChange={(value) => setTactic(key, value)}
                />
                <Actual view={view} field="tactics" name={key} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </Page>
  );
}
