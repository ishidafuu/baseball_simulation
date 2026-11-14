import { PHASE_LABELS, CAMP_ROUNDS } from './shared.js';
import { PHASE_STAFF_AREA } from './coaches.js';

// ============================================================
// 「自分が何かしないといけないこと」の数え方。PC版の左メニューの数字・上の帯、
// スマホ版の印が**同じ数え方**をするよう、ここだけに置く。
//
// ⚠ 初期メンバー選択・人員整理（契約更改）・キャンプは**左メニューの「手続き」から
//    入るので見逃しやすい**（いしだ指摘: うっかり飛ばす危険がある）。数え方を
//    画面ごとに書くと、片方だけ「済んだ」扱いになって帯が消える、がおきる。
// ============================================================

/**
 * いま自分が決める手続き。無ければ null。
 * - 初期メンバー選択: まだセットを選んでいない
 * - キャンプ: 4クールを終えていない
 * - そのほか（契約更改・トライアウト・年度更新）: まだ決定していない
 *
 * ⚠ 初期メンバーを待っている球団には、リーグの手続きを出さない
 *    （その球団の手続きはCPUが決め、サーバーも決定を待たない）。
 * ⚠ 指導者に任せた手続き（`phase.delegated`）も出さない。サーバーはその人の決定を待たず、
 *    指導者の案で決める（`leagueEngine` の `waitsFor`）。
 */
export function pendingProcedure(view) {
  if (!view) return null;
  if (view.pendingPack) {
    if (view.pendingPack.chosen) return null;
    return {
      kind: 'pack_select',
      label: PHASE_LABELS.pack_select,
      deadline: null,
      progress: null,
    };
  }
  const phase = view.phase;
  if (!phase) return null;
  if (phase.delegated) return null;
  if (phase.kind === 'camp') {
    const done = phase.camp?.rounds || 0;
    const total = phase.camp?.total || CAMP_ROUNDS;
    if (done >= total) return null;
    return {
      kind: 'camp',
      label: PHASE_LABELS.camp,
      deadline: phase.deadline || null,
      progress: `第${done + 1}クール / 全${total}クール`,
    };
  }
  if (phase.submission?.ready) return null;
  return {
    kind: phase.kind,
    label: PHASE_LABELS[phase.kind] || phase.label || '手続き',
    deadline: phase.deadline || null,
    progress: null,
  };
}

/**
 * 手続きの一覧に出す、球団ごとの様子。PC・スマホで同じ言葉（アプリは `ProceduresScreen.kt`）。
 * ⚠ 指導者に任せた球団（`delegated`）は待たないので「検討中」と出さない（`leagueEngine` の `waitsFor`）
 */
export const phaseStatusLabel = (member) =>
  member.cpu
    ? 'CPUが決定（初期メンバー待ち）'
    : member.delegated
      ? '指導者に任せています'
      : member.ready
        ? '決定済み'
        : '検討中';

/**
 * 任せ方の保存（`changes` は送る分 `{ area: mode }`）で、いまの手続きがその場で決まるか。
 * 決まるなら手続きの名前（「トライアウト」など）、決まらないなら null。
 * ⚠ サーバーは**待たれている最後の1人が手続きの分野を「任せる」にした瞬間に**、指導者の案で
 *    手続きを進める（`leagueEngine` の `updateStaffModes`）。取り消せないので、画面は保存の前に
 *    確認を1段挟む（再監査 A2。`StaffPage.jsx` の `Modes`。アプリの StaffPanel も同じ条件）。
 *    1人リーグなら手続き中に任せるといつもこれになる。
 * ⚠ 条件は `waitsFor` と同じ見方: 自分がまだ決めておらず（`ready` でも `cpu` でもない）、
 *    自分のほかは全員 `ready`（決定済み・任せた球団を含む）か `cpu`
 */
export function delegationSettles(view, changes) {
  const phase = view?.phase;
  const area = PHASE_STAFF_AREA[phase?.kind];
  if (!area || changes?.[area] !== 'delegate' || phase.delegated) return null;
  const members = view.members || [];
  const me = members.find((m) => m.teamName === view.teamName);
  if (!me || me.ready || me.cpu) return null;
  if (!members.every((m) => m === me || m.ready || m.cpu)) return null;
  return PHASE_LABELS[phase.kind] || '手続き';
}

/**
 * 任せ方を保存したあとの知らせ。手続きがその場で決まったら言い分ける（`delegationSettles`）。
 * `before` / `after` は送る前と後のビュー
 */
export function staffModesDoneText(payload, before, after) {
  const phase = before?.phase;
  const area = PHASE_STAFF_AREA[phase?.kind];
  if (area && payload?.modes?.[area] === 'delegate' && after && after.phase?.id !== phase.id)
    return `任せ方を変えました。${PHASE_LABELS[phase.kind]}は指導者の案で決まりました`;
  return '任せ方を変えました';
}

/** 自分が返事をする番のトレードの提案の数 */
export const waitingTradeCount = (view) =>
  (view?.trades || []).filter((t) => t.myTurn).length;

/** 左メニュー・タブに出す数（手続き1件＋返事待ちの提案） */
export function noticeCounts(view) {
  const procedure = pendingProcedure(view) ? 1 : 0;
  const trades = waitingTradeCount(view);
  // 届いた練習試合の申し込み（PC の左メニューの「練習試合」に付ける）。
  // ⚠ `total`（アプリの `Notices.kt` と同じ数え方）には入れない。返事をしなくても困らないので
  const challenges = (view?.exhibitions || []).filter((e) => e.status === 'offered' && !e.mine).length;
  return { procedure, trades, challenges, total: procedure + trades };
}

/**
 * 途中参加で初期メンバーを選び終え、自分の球団になるのを待っている間の知らせ。
 * 無ければ null。`joinsAt` はその球団で始まる時刻（キャンプの締め切り＝開幕）。
 *
 * ⚠ 選んだ時点で手続きの帯（`pendingProcedure`）は消える。代わりにこれを出して、
 *    「いつ自分の球団になるか」を見せ続ける（いしだ指摘: セットと名前を決めた後も
 *    画面がそのままで、済んだのか・次に何が起きるのか分からなかった）。
 *    アプリの `Notices.kt` の `packWaiting` と同じ決まり。
 */
export function packWaiting(view) {
  const pending = view?.pendingPack;
  if (!pending?.chosen) return null;
  const pack = pending.packs?.find((p) => p.id === pending.chosen);
  return {
    packName: pack?.name || '選んだセット',
    feature: pack?.feature || null,
    joinsAt: pending.joinsAt || null,
    // キャンプの最中なら締め切りは決まっている。でなければ見込み
    estimated: !pending.joinsInCamp,
  };
}
