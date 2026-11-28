import {
  ATTACK_TYPES,
  DEFENSE_TYPES,
  ROLE_LABELS,
  growthStyleOf,
  shortName,
  visionHeadline,
  visionOf,
} from './coaches.js';
import { TRADE_SLOTS } from './tradeSearch.js';

// ============================================================
// チームの方針（先方要望 #9「チーム分析に、そのチームの方針が書かれているといい」。2026-11-28）
//
// 【何をするものか】監督（とコーチ）の型から、球団の方針を「攻撃・投手起用・重心・編成・育成・いまの重点」の
//   6行にして返す。各行に、それで実際に何が変わるかを一言添える（チーム分析の「チームの方針」。PC とアプリ）。
// ⚠ ここは**見せるための言い換え**。中身はどれも、すでに試合や編成に効いているもの
//   （攻撃・投手起用 = 采配の考え方 `VIEWS` と好む選手、編成 = 時間軸 `HORIZONS`、育成 = 育成観と育成の的 `campAim`、
//   いまの重点 = 球団の穴 `teamNeeds`）。ここで新しい効き目を作らない。
//   例外は「積極補強」がCPU同士のトレードを言い出しやすくすること（`tradeEagerness`。サーバーの `runCpuTrades` が読む）。
// ⚠ 文はサーバーでだけ作り、ビュー（`staff.policy`）に載せる。アプリは載ってきた文を出すだけ。
// ============================================================

/** 攻めの型 → 方針の名前と、効き目の一言 */
const ATTACK_POLICY = {
  speed: {
    value: '機動力重視',
    note: '盗塁・送りバントを多めに。俊足の選手を好んで取る',
  },
  power: {
    value: '長打重視',
    note: '小技を控えて強攻。長打のある選手を好んで取る',
  },
  contact: {
    value: 'つなぎ重視',
    note: '打席では球を見て四球とミートでつなぐ。巧打の選手を好んで取る',
  },
};
/** 守りの型 → 投手起用（継投パターン） */
const DEFENSE_POLICY = {
  rotation: {
    value: '先発完投型',
    note: '先発に長いイニングを任せ、三振を狙う。スタミナのある先発を好む',
  },
  bullpen: {
    value: '継投型',
    note: '先発を早めに代えて、ブルペンでつなぐ。球の速い投手を好む',
  },
  fielding: {
    value: '打たせて取る',
    note: '打たせて取り、守りで1点を守る。制球の良い投手と守備の良い野手を好む',
  },
};
/** 時間軸 → 編成 */
const HORIZON_POLICY = {
  develop: {
    value: '若手育成',
    note: '若手を使って育てる。トライアウトやトレードでは若さを買い、ベテランを手放しやすい',
  },
  middle: { value: 'バランス', note: '調子と成績を見て、使う選手を入れ替える' },
  win: {
    value: '積極補強',
    note: '今年勝ちに行く。実績のある選手を買い、CPUどうしのトレードも自分から言い出しやすい',
  },
};
/** 育成観 → 育成 */
const GROWTH_POLICY = {
  extreme: { value: '長所を伸ばす', note: '長所を伸ばせるだけ伸ばす' },
  staged: {
    value: '長所を伸ばす',
    note: 'まず武器を作り、ある程度まで伸びたら穴を埋める',
  },
  shape: {
    value: '選手の形に合わせる',
    note: '尖った選手は長所を、そうでない選手は全体を伸ばす',
  },
  complete: { value: '穴を埋める', note: '短所を埋めて、穴のない選手に育てる' },
};
/** 能力の名前（いまの重点） */
const STAT_LABELS = {
  meet: 'ミート',
  power: '長打',
  eye: '選球眼',
  speed: '走力',
  defense: '守備',
  control: '制球',
  velocity: '球速',
  stamina: 'スタミナ',
};
/** いまの重点に挙げる穴の線（`teamNeeds` の 0〜1） */
export const POLICY_NEED_LINE = 0.25;
/** いまの重点に挙げる数 */
const POLICY_NEED_COUNT = 3;

/** 「山田監督」 */
const byName = (coach, role) => `${shortName(coach)}${ROLE_LABELS[role]}`;

/** コーチの居ない側（人の球団。キャンプはおすすめで練習する） */
const NO_COACH = (side) => ({ value: 'おすすめ', note: `${side}コーチが居ないので、キャンプはおすすめの練習` });

/**
 * 育成の行（投手は投手コーチ、野手は野手コーチ。居なければ監督。2人の考えが違えば分けて書く）
 * ⚠ **人の球団は監督で埋めない**（キャンプの `campPlan` の `strictSeats` と同じ。コーチの居ない側の
 *    選手はおすすめで練習する）。埋めると、画面は監督の育成観なのに実際はおすすめで回っていた（監査18）
 */
function growthRow(staff, human = false) {
  const fill = human ? null : staff.manager;
  const pitching = staff.pitching || fill;
  const batting = staff.batting || fill;
  if (!pitching && !batting)
    return human
      ? { key: 'growth', label: '育成', value: 'おすすめ', note: 'コーチが居ないので、キャンプはおすすめの練習' }
      : null;
  const pStyle = pitching ? growthStyleOf(pitching) : null;
  const bStyle = batting ? growthStyleOf(batting) : null;
  const pv = (pStyle && GROWTH_POLICY[pStyle]) || (human ? NO_COACH('投手') : null);
  const bv = (bStyle && GROWTH_POLICY[bStyle]) || (human ? NO_COACH('野手') : null);
  if (pv && bv && pv.value !== bv.value)
    return {
      key: 'growth',
      label: '育成',
      value: `野手は${bv.value}・投手は${pv.value}`,
      note: `野手は${bv.note}。投手は${pv.note}`,
    };
  const one = bv || pv;
  return { key: 'growth', label: '育成', value: one.value, note: one.note };
}

/** いまの重点（リーグの中で足りないもの。大きい順に `POLICY_NEED_COUNT` まで） */
function needRow(needs, horizon) {
  if (!needs) return null;
  const slots = TRADE_SLOTS.map((s) => ({
    label: s.label,
    v: needs.slots?.[s.key] ?? 0,
  }));
  const stats = Object.entries(STAT_LABELS).map(([k, label]) => ({
    label,
    v: needs.stats?.[k] ?? 0,
  }));
  const top = [...slots, ...stats]
    .filter((x) => x.v >= POLICY_NEED_LINE)
    .sort((a, b) => b.v - a.v)
    .slice(0, POLICY_NEED_COUNT);
  if (!top.length)
    return {
      key: 'need',
      label: 'いまの重点',
      value: '目立つ穴なし',
      note: 'リーグのほかの球団と比べて、大きく足りないものは無い',
    };
  const how =
    horizon === 'win'
      ? '今年勝つために、穴を強く見て埋めにいく'
      : horizon === 'develop'
        ? 'ただしキャンプでは、穴より選手の長所を先に見る'
        : '穴と選手の長所を半々に見る';
  return {
    key: 'need',
    label: 'いまの重点',
    value: top.map((x) => x.label).join('・'),
    note: `リーグのほかの球団と比べて足りないもの。キャンプの練習の的に効き、持ち場の穴はCPUのトレードでも埋めにいく。${how}`,
  };
}

/**
 * チームの方針。`staff` は `{ manager, pitching, batting }`（`staffOf`）、`needs` は `teamNeeds` の結果（無ければ「いまの重点」を出さない）。
 * `human` なら、人の球団として「実際の采配と編成はオーナーが決める」と添える（中身の任せ方は見せない）。`own` は見ている人の球団。
 * @returns {{ by: string|null, headline: string, tags: string[], rows: {key,label,value,note}[], note: string|null }}
 */
export function teamPolicy(staff = {}, { needs = null, human = false, own = false } = {}) {
  const manager = staff?.manager || null;
  const rows = [];
  let headline = 'バランス型（監督不在）';
  let horizon = 'middle';
  if (manager) {
    const v = visionOf(manager);
    horizon = v.horizon;
    headline = visionHeadline(manager);
    const attack = ATTACK_POLICY[v.attack];
    const defense = DEFENSE_POLICY[v.defense];
    rows.push({ key: 'attack', label: '攻撃', ...attack });
    rows.push({ key: 'pitching', label: '投手起用', ...defense });
    rows.push({
      key: 'lean',
      label: '重心',
      value: v.flagship === 'defense' ? '守備重視' : '攻撃重視',
      note:
        v.flagship === 'defense'
          ? `看板は「${DEFENSE_TYPES[v.defense].label}」。攻撃の色は控えめに出る`
          : `看板は「${ATTACK_TYPES[v.attack].label}」。投手起用の色は控えめに出る`,
    });
    rows.push({ key: 'build', label: '編成', ...HORIZON_POLICY[v.horizon] });
  } else {
    rows.push({
      key: 'lean',
      label: '重心',
      value: 'バランス型',
      note: '監督がいないので、采配は標準のまま',
    });
  }
  const growth = growthRow(staff || {}, human);
  if (growth) rows.push(growth);
  const need = needRow(needs, horizon);
  if (need) rows.push(need);
  const tags = rows
    .filter((r) => ['attack', 'pitching', 'build', 'growth'].includes(r.key) || (r.key === 'lean' && !manager))
    .map((r) => r.value);
  return {
    by: manager ? byName(manager, 'manager') : null,
    headline,
    tags,
    rows,
    note: own
      ? 'あなたの球団です。指導者に「任せる」「意見を聞く」にした分野で、この方針が案や動きに出ます'
      : human
        ? 'オーナーの球団です。実際の采配と編成はオーナーが決め、任せた分野だけこの方針で動きます'
        : null,
  };
}

/** トレードを言い出しやすさ（積極補強 1.6・バランス 1・若手育成 0.6。監督不在は 1） */
const EAGERNESS = { develop: 0.6, middle: 1, win: 1.6 };
export function tradeEagerness(manager) {
  return manager ? (EAGERNESS[visionOf(manager).horizon] ?? 1) : 1;
}
