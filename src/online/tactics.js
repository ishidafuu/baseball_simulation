// 対人版の事前方針。未指定なら既存の自動試合と同じ判断・乱数消費を保つ。
export const STRATEGY_FIELDS = {
  batting: [
    '打撃方針',
    { balanced: 'バランス', patient: '慎重', aggressive: '積極' },
  ],
  pitching: [
    '投球方針',
    { balanced: 'バランス', strikeout: '三振狙い', contact: '打たせて取る' },
  ],
  baseRunning: [
    '走塁方針',
    {
      normal: '標準',
      aggressive: '積極',
      conservative: '慎重',
      never: '盗塁しない',
    },
  ],
  defense: [
    '守備方針',
    { normal: '標準', infield_in: '前進守備', shift: '守備シフト' },
  ],
};
export const STARTER_ROLES = {
  auto_s: 'おまかせ',
  ace: 'ゲームメーカー',
  complete: '完投型',
  quality: '勝ち権利型',
  short: 'ショートスターター',
  opener: 'オープナー',
};
export const RELIEF_ROLES = {
  auto_r: 'おまかせ',
  long: 'ロングリリーフ',
  ace_relief: '中継ぎエース',
  setup: 'セットアッパー',
  closer: '守護神',
  onepoint: 'ワンポイント',
  behind: 'ビハインド',
  mopup: '敗戦処理',
};
export const TACTIC_FIELDS = {
  sacrificeBunt: [
    '送りバント',
    { auto: 'AI判断', avoid: '控えめ', aggressive: '積極的', never: 'しない' },
  ],
  squeeze: [
    'スクイズ',
    { auto: 'AI判断', avoid: '控えめ', aggressive: '積極的', never: 'しない' },
  ],
  safetyBunt: [
    'セーフティバント',
    { auto: 'AI判断', avoid: '控えめ', aggressive: '積極的', never: 'しない' },
  ],
  pinchHit: ['代打', { auto: 'AI判断', never: '使わない' }],
  pinchHitFrom: [
    '代打を使い始める回',
    {
      0: 'AI判断',
      5: '5回以降',
      6: '6回以降',
      7: '7回以降',
      8: '8回以降',
      9: '9回以降',
    },
  ],
  defensiveSub: ['守備固め', { auto: 'AI判断', never: '使わない' }],
  defenseFrom: [
    '守備固めを使い始める回',
    { 0: 'AI判断', 7: '7回以降', 8: '8回以降', 9: '9回以降' },
  ],
  hook: [
    '先発の不調時の交代',
    { auto: '標準', early: '早めに交代', patient: '長めに任せる' },
  ],
  starterLimit: [
    '先発の球数上限',
    {
      0: '役割・スタミナで判断',
      60: '最大60球',
      80: '最大80球',
      100: '最大100球',
      120: '最大120球',
    },
  ],
};
/**
 * 方針が能力の数字に足す分（自動試合 `autoSimulation.js` が読む。画面の説明 `strategyEffectText` も同じ表から作る）。
 * ⚠ 足すなら必ず引く分も置く（得だけの方針は作らない。いしだ 2026-11-13）。
 *    数字を変えたら tactic-strength の測り（双子の球団の対戦）で、選んだだけで勝率が動かないことを確かめる。
 * - batting … 打者のミート・パワー・選球眼
 * - defense … 守る野手の守備（内野=一二三遊・捕手・投手 / 外野）
 * 投球方針と走塁方針は数字を変えない（配球・盗塁の回数だけ）。
 */
export const STRATEGY_MODS = {
  batting: {
    patient: { meet: 3, power: -5, eye: 10 },
    aggressive: { meet: -5, power: 8, eye: -5 },
  },
  defense: {
    infield_in: { infield: 10, outfield: -15 },
    shift: { infield: 5, outfield: -10 },
  },
};
/** 方針の中身（数字以外の効き方）。数字は `STRATEGY_MODS` から足して `strategyEffectText` が1行にする */
export const STRATEGY_NOTES = {
  batting: {
    balanced: '能力はそのまま。',
    patient: 'よく見て当てにいく。',
    aggressive: '長打を狙って強く振る。',
  },
  pitching: {
    balanced: '能力は変わらない。配球は捕手に任せる。',
    strikeout: '能力は変わらない。誘い球と変化球を増やし、空振りを取りにいく（四球は増える）。',
    contact: '能力は変わらない。ストライクゾーンで勝負し、ゴロを打たせる球種を選ぶ（四球は減るが打たれやすい）。',
  },
  baseRunning: {
    normal: '能力は変わらない。',
    aggressive: '能力は変わらない。盗塁を試みる回数が約1.5倍。',
    conservative: '能力は変わらない。盗塁を試みる回数が半分以下。',
    never: '盗塁しない。',
  },
  defense: {
    normal: '能力はそのまま。',
    infield_in: '内野は打球に早く追いつくが、外野の間を抜かれやすい。',
    shift: '内野の網を厚くするぶん、外野が手薄になる。',
  },
};
const MOD_LABELS = {
  meet: 'ミート',
  power: 'パワー',
  eye: '選球眼',
  infield: '内野の守備',
  outfield: '外野の守備',
};
const signed = (n) => (n > 0 ? `+${n}` : String(n));
/** 方針1つの効き目の文（PC・スマホの作戦画面、アプリは gen-tables で同じ文） */
export function strategyEffectText(key, value) {
  const note = STRATEGY_NOTES[key]?.[value] || '';
  const mods = STRATEGY_MODS[key]?.[value];
  const nums = mods
    ? Object.entries(mods)
        .map(([k, n]) => `${MOD_LABELS[k] || k}${signed(n)}`)
        .join('・')
    : '';
  return nums ? `${nums}。${note}` : note;
}
/** 方針の既定（各項目の最初の値）。保存に項目が無いときと同じ */
export const STRATEGY_DEFAULTS = Object.fromEntries(
  Object.entries(STRATEGY_FIELDS).map(([key, [, options]]) => [key, Object.keys(options)[0]]),
);
export const TACTIC_DEFAULTS = Object.fromEntries(
  Object.entries(TACTIC_FIELDS).map(([key, [, options]]) => [
    key,
    ['pinchHitFrom', 'defenseFrom', 'starterLimit'].includes(key)
      ? 0
      : Object.keys(options)[0],
  ]),
);
export function tacticalChance(chance, setting) {
  return setting === 'never'
    ? 0
    : setting === 'avoid'
      ? chance * 0.5
      : setting === 'aggressive'
        ? Math.min(1, chance * 1.5)
        : chance;
}
export function tacticalPitchLimit(limit, isReliever, tactics) {
  return !isReliever && tactics?.starterLimit > 0
    ? Math.min(limit, tactics.starterLimit)
    : limit;
}
export function tacticalDamageLimit(limit, tactics) {
  return tactics?.hook === 'early'
    ? limit * 0.75
    : tactics?.hook === 'patient'
      ? limit * 1.25
      : limit;
}
export function roleFor(role, starter) {
  return typeof role === 'string' &&
    Object.hasOwn(starter ? STARTER_ROLES : RELIEF_ROLES, role)
    ? role
    : starter
      ? 'auto_s'
      : 'auto_r';
}
