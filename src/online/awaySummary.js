// ============================================================
// 留守中のまとめ（改善案 D1）。前に開いたときのビューと今のビューを比べて、
// 「前回から: 9試合 6勝3敗、2部 3位→1位、佐藤が通算100安打、トレードの返事待ち1件」を作る。
//
// ⚠ サーバーは変えない。前のビューは端末に残してある（PC は `savedView.js`、アプリは
//    `SessionStore.viewJson`）。比べるだけ。
// ⚠ アプリにも同じ作り方がある（`mobile/shared/.../AwaySummary.kt`）。文を変えたらそちらも直す
//    （`mobile/tools/expect-social.mjs` の答えと `SocialTest` が同じ入力で照らし合わせる）。
// ============================================================

const own = (view) => (view?.standings || []).find((s) => s.team === view.teamName) || null;
const played = (row) => (row ? (row.wins || 0) + (row.losses || 0) + (row.draws || 0) : 0);

/** 自球団の部の中の順位（1始まり）。順位表は全球団を通した並びなので、部で絞って数える */
export function divisionRank(view) {
  const league = view?.teamLeagues?.[view.teamName];
  const rows = (view?.standings || []).filter(
    (s) => !league || view.teamLeagues?.[s.team] === league,
  );
  const at = rows.findIndex((s) => s.team === view.teamName);
  return at >= 0 ? at + 1 : null;
}

const DIVISION = { A: '1部', B: '2部' };

/**
 * まとめの行（文の配列）。変わったことが無ければ null。
 * `before` は前に開いたときのビュー、`after` は今のビュー。
 */
export function awaySummary(before, after) {
  if (!before || !after || before.teamName !== after.teamName) return null;
  if (before.revision === after.revision) return null;
  const lines = [];
  if (after.year !== before.year) lines.push(`${after.year}年目に入りました`);
  else {
    const a = own(before);
    const b = own(after);
    const games = played(b) - played(a);
    if (a && b && games > 0) {
      const wins = (b.wins || 0) - (a.wins || 0);
      const losses = (b.losses || 0) - (a.losses || 0);
      const draws = (b.draws || 0) - (a.draws || 0);
      lines.push(`${games}試合 ${wins}勝${losses}敗${draws > 0 ? `${draws}分` : ''}`);
    }
    const from = divisionRank(before);
    const to = divisionRank(after);
    const division = DIVISION[after.teamLeagues?.[after.teamName]] || '';
    if (from && to && from !== to && games > 0) lines.push(`${division}${from}位→${to}位`);
    else if (to && games > 0) lines.push(`${division}${to}位`);
  }
  // 自球団の節目の記録（通算100安打など）
  const seen = new Set(
    (before.chronicle?.milestones || []).map((m) => `${m.year}:${m.playerId}:${m.label}`),
  );
  const fresh = (after.chronicle?.milestones || []).filter(
    (m) => m.team === after.teamName && !seen.has(`${m.year}:${m.playerId}:${m.label}`),
  );
  for (const m of fresh.slice(0, 2)) lines.push(`${m.name}が${m.label}`);
  if (fresh.length > 2) lines.push(`ほか節目の記録${fresh.length - 2}件`);
  // 手続きが始まった
  if (after.phase && after.phase.id !== before.phase?.id && after.phase.label)
    lines.push(`${after.phase.label}が始まりました`);
  // 返事が要るトレード（新しく届いたもの）
  const waiting = new Set((before.trades || []).filter((t) => t.myTurn).map((t) => `${t.id}:${t.updatedAt}`));
  const trades = (after.trades || []).filter((t) => t.myTurn && !waiting.has(`${t.id}:${t.updatedAt}`)).length;
  if (trades) lines.push(`トレードの返事待ち${trades}件`);
  // 練習試合の申し込み（新しく届いたもの）
  const offered = new Set((before.exhibitions || []).map((e) => e.id));
  const challenges = (after.exhibitions || []).filter(
    (e) => e.status === 'offered' && !e.mine && !offered.has(e.id),
  ).length;
  if (challenges) lines.push(`練習試合の申し込み${challenges}件`);
  // あなたへのお知らせ（新しいもの）
  const known = new Set((before.inbox || []).map((n) => n.id));
  const notes = (after.inbox || []).filter((n) => !known.has(n.id)).length;
  if (notes) lines.push(`あなたへのお知らせ${notes}件`);
  return lines.length ? lines : null;
}

/** 「前回（11/14 7:00）から」の時刻の部分。日本時間 */
export function sinceLabel(at) {
  if (!Number.isFinite(at)) return '';
  const d = new Date(at + 9 * 3600 * 1000);
  const hh = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`;
}
