import React from 'react';
import { TEAMS_DATA } from '../../teams-data.js';
import { WORLD_DATA } from '../../corporate/worldData.js';
import { FORM_NAME } from '../../utils/constants.js';
import { checkNPBDraftEligibility } from '../../season/yearProgressionSystem.js';
import { highSchoolPool, universityPool } from '../../state/schoolPools.js';

// ============================================================
// スポーツ新聞「ドラフト戦線」（`DateProgressScreen` から抽出）
//
// 紙面の作法・色の根拠は CLAUDE.md「スポーツ新聞は明るいグレーの紙にする」を参照。
// データ作りと紙面は1つの縦割りなので同じファイルに置く
// （`buildNewspaperData` の出す形をそのまま `NewspaperModal` が読む）。
// ============================================================

/**
 * 紙面に載せる候補を集める。呼び出し側が `useMemo` で包むこと（重い）。
 * @param fameDateRef 「その日もう知名度を配ったか」を持つ ref（下の⚠を参照）
 */
export function buildNewspaperData(seasonData, userTeamName, fameDateRef) {
  const POS_SHORT = { pitcher: '投', catcher: '捕', first: '一', second: '二', third: '三', short: '遊', left: '左', center: '中', right: '右' };

  // 指名確度(★)はカテゴリ内順位で算出する。
  // 実ドラフトは各カテゴリの上位から順に指名される（高63/大18/社16/独13%程度）ため、
  // カテゴリ内順位が指名到達性を最もよく表す。全候補横断の順位だと将来性倍率の乗る
  // 若い高校生に埋もれ、社会人/独立のNo.1すら★1になってしまう（実態と乖離）。
  const CAT_DEPTH = { highschool: 55, university: 16, corporate: 14, independent: 12 };
  const outlookByRank = (rank, source) => {
    const d = CAT_DEPTH[source] || 15;
    if (rank <= d * 0.35) return { stars: 5, prob: 95, label: '指名確実' };
    if (rank <= d * 0.6)  return { stars: 4, prob: 82, label: '指名有力' };
    if (rank <= d * 0.9)  return { stars: 3, prob: 60, label: '指名圏内' };
    if (rank <= d * 1.3)  return { stars: 2, prob: 32, label: '当落線上' };
    return { stars: 1, prob: 12, label: '来季に期待' };
  };
  const scoutComment = (c, o) => {
    const trait = c.isPitcher
      ? (c.velocity >= 150 ? '球速は即戦力級。'
        : c.control >= 60 ? '制球に円熟味あり。'
        : c.arsenalCount >= 4 ? '多彩な変化球が武器。'
        : c.stamina >= 110 ? 'スタミナ豊富な先発型。'
        : '線は細いが伸びしろ十分。')
      : (c.power >= 60 ? '長打力は一級品。'
        : c.speed >= 65 ? '走力で試合を変える。'
        : c.meet >= 60 ? '安定した打撃技術。'
        : c.defense >= 60 ? '守備に定評あり。'
        : '総合力でアピール。');
    const tail = ['来季の飛躍に期待。', '評価が割れる当落線上。', '中位〜下位で指名圏内。', '上位指名も十分だ。', 'ドラフトの目玉、1位候補。'][o.stars - 1];
    return trait + tail;
  };
  // カード + カテゴリ内順位 → ★・確率・寸評を付与
  const enrich = (card, rank, source) => {
    if (!card) return card;
    const o = outlookByRank(rank, source);
    card.stars = o.stars; card.prob = o.prob; card.outlook = o.label;
    card.comment = scoutComment(card, o);
    return card;
  };

  const makeCard = (p, source, orgName) => {
    const isPitcher = p.position === 'pitcher';
    const throws = p.physical?.throws === 'left' ? '左' : '右';
    const bats = p.batting?.bats === 'left' ? '左' : p.batting?.bats === 'switch' ? '両' : '右';
    const draft = checkNPBDraftEligibility(p);
    let headline = '';
    let subline = '';
    if (isPitcher) {
      const v = p.pitching?.velocity || 0;
      const ctrl = p.pitching?.control || 0;
      const sta = p.pitching?.stamina || 0;
      const formKey = p.pitching?.form;
      const form = FORM_NAME[formKey] || '';
      const balls = (p.pitching?.arsenal || []).filter(a => a.type !== 'straight').length;
      // ⚠ **表示ラベルで比較しないこと**。短縮名を共有表に一本化したとき
      //    'アンダースロー' → 'アンダー' になって、この分岐が黙って死んだ
      if (formKey === 'submarine' || formKey === 'sidearm') { headline = `${form}の技巧派`; subline = `制球${ctrl} ${balls}球種`; }
      else if (ctrl >= 60 && v < 145) { headline = `制球力${ctrl}の技巧派`; subline = `${v}km ${balls}球種`; }
      else if (balls >= 4) { headline = `${balls}球種の変化球王`; subline = `${v}km 制球${ctrl}`; }
      else if (sta >= 100 && v >= 140) { headline = `スタ${sta}の鉄腕`; subline = `${v}km 制球${ctrl}`; }
      else if (v >= 150) { headline = `最速${v}kmの剛腕`; subline = `制球${ctrl} ${balls}球種`; }
      else if (v >= 145) { headline = `${v}km速球派`; subline = `制球${ctrl} ${balls}球種`; }
      else { headline = `${v}km ${form || '右腕'}`; subline = `制球${ctrl} ${balls}球種`; }
    } else {
      const pw = p.batting?.power || 0;
      const spd = p.physical?.speed || 0;
      const mt = p.batting?.meet || 0;
      const def = p.fielding?.defense || 0;
      const eye = p.batting?.eye || 0;
      const arm = p.physical?.arm || 0;
      if (pw >= 55 && spd >= 60) { headline = '走攻の二刀流'; subline = `パ${pw} 走${spd}`; }
      else if (pw >= 55) { headline = `パワー${pw}の大砲`; subline = `ミ${mt} 走${spd}`; }
      else if (spd >= 65 && def >= 50) { headline = `俊足堅守`; subline = `走${spd} 守${def}`; }
      else if (spd >= 65) { headline = `走力${spd}の韋駄天`; subline = `ミ${mt} パ${pw}`; }
      else if (mt >= 55 && eye >= 45) { headline = `巧打者`; subline = `ミ${mt} 眼${eye}`; }
      else if (def >= 60 && arm >= 60) { headline = `鉄壁守備`; subline = `守${def} 肩${arm}`; }
      else if (mt >= 50) { headline = `ミート${mt}の好打者`; subline = `パ${pw} 走${spd}`; }
      else { headline = `総合力型`; subline = `ミ${mt} パ${pw} 走${spd}`; }
    }
    return {
      name: p.name, age: p.age, position: POS_SHORT[p.position] || p.position,
      throws, bats, source, orgName, headline, subline,
      // ⚠ 生の `totalScore` は小数（実測 419.52422906408486）。紙面にそのまま出ていた
      isPitcher, fame: p.fame || 0, score: Math.round(draft.totalScore),
      velocity: p.pitching?.velocity, control: p.pitching?.control,
      stamina: p.pitching?.stamina || 0,
      arsenalCount: (p.pitching?.arsenal || []).filter(a => a.type !== 'straight').length,
      meet: p.batting?.meet, power: p.batting?.power, speed: p.physical?.speed,
      arm: p.physical?.arm, defense: p.fielding?.defense,
      eye: p.batting?.eye || 0, steal: p.batting?.steal || 0,
      growthPotential: p.growthPotential,
    };
  };

  // 高校生注目選手
  let hsTop = null, hsOthers = [];
  if (highSchoolPool.players?.length > 0) {
    const sorted = highSchoolPool.players
      .map(p => ({ player: p, draft: checkNPBDraftEligibility(p) }))
      .filter(x => x.draft.totalScore >= 80)
      .sort((a, b) => b.draft.totalScore - a.draft.totalScore);
    if (sorted.length > 0) hsTop = enrich(makeCard(sorted[0].player, 'highschool', sorted[0].player.highSchool?.name || '高校'), 1, 'highschool');
    hsOthers = sorted.slice(1, 10).map((x, i) => enrich(makeCard(x.player, 'highschool', x.player.highSchool?.name || '高校'), i + 2, 'highschool'));
  }

  // 大学注目選手（3〜4年生）
  const uniAll = [];
  // enrollYear はゲーム内年度（1,2,3…）なので、比較にもゲーム年を使う。
  // currentDate.year はカレンダー年(2024等)なので、混ぜると全学年が3〜4年生として通ってしまう
  const gameYear = seasonData.settings?.year || seasonData.year || 1;
  // 大学生の実体は TEAMS_DATA の大学の名簿（プールは初期化中の仮置きだけ）
  Object.entries(TEAMS_DATA).forEach(([teamName, team]) => {
    if (!team?.universityData) return;
    (team.players || []).forEach(p => {
      const grade = p.universityYear || Math.max(1, (p.age || 19) - 18);
      if (grade < 3) return;
      const draft = checkNPBDraftEligibility(p);
      if (draft.totalScore >= 80) {
        const card = makeCard(p, 'university', teamName);
        card.year = grade;
        card.uniRank = team.universityData.rank;
        uniAll.push({ card, score: draft.totalScore, player: p });
      }
    });
  });
  Object.entries(universityPool).forEach(([enrollYear, entries]) => {
    if (!entries) return;
    const yearsInUni = gameYear - parseInt(enrollYear);
    if (yearsInUni < 2) return;
    entries.forEach(entry => {
      const p = entry.player;
      if (!p) return;
      const draft = checkNPBDraftEligibility(p);
      if (draft.totalScore >= 80) {
        const card = makeCard(p, 'university', entry.universityTeamName || '大学');
        card.year = yearsInUni + 1;
        card.uniRank = entry.universityRank;
        uniAll.push({ card, score: draft.totalScore, player: p });
      }
    });
  });
  uniAll.sort((a, b) => b.score - a.score);
  uniAll.forEach((x, i) => enrich(x.card, i + 1, 'university'));
  const uniTop = uniAll.length > 0 ? uniAll[0].card : null;
  const uniOthers = uniAll.slice(1, 10).map(x => x.card);

  // 社会人・独立
  const corpAll = [];
  const indAll = [];
  Object.entries(TEAMS_DATA).forEach(([teamName, team]) => {
    if (!team?.players) return;
    const isCorp = team.corporateData?.type === 'enterprise' || team.corporateData?.type === 'club';
    const isInd = !isCorp && !!team.independentLeagueId && teamName !== userTeamName;
    if (!isCorp && !isInd) return;
    team.players.forEach(p => {
      if (p.age >= 30) return;
      const draft = checkNPBDraftEligibility(p);
      if (draft.totalScore < 80) return;
      const card = makeCard(p, isCorp ? 'corporate' : 'independent', teamName);
      if (isCorp) corpAll.push({ card, score: draft.totalScore, player: p });
      else indAll.push({ card, score: draft.totalScore, player: p });
    });
  });
  corpAll.sort((a, b) => b.score - a.score);
  indAll.sort((a, b) => b.score - a.score);
  corpAll.forEach((x, i) => enrich(x.card, i + 1, 'corporate'));
  indAll.forEach((x, i) => enrich(x.card, i + 1, 'independent'));

  // 大会情報（社会人モード: seasonData、大学/独立モード: WORLD_DATA）
  const tournamentNews = [];
  const td = seasonData.toshitaikou || (WORLD_DATA.initialized ? WORLD_DATA.corporateToshitaikou : null);
  if (td?.champion) tournamentNews.push(`都市対抗 優勝: ${td.champion}`);
  else if (td?.mainTournament && td.mainTournament.phase !== 'done') tournamentNews.push('都市対抗 本戦開催中');
  else if (td?.generated && !td?.qualifiersDone) tournamentNews.push('都市対抗 予選進行中');
  const ns = seasonData.nihonSenshuken || (WORLD_DATA.initialized ? WORLD_DATA.corporateNihonSenshuken : null);
  if (ns?.champion) tournamentNews.push(`日本選手権 優勝: ${ns.champion}`);
  else if (ns?.generated && !ns?.done) tournamentNews.push('日本選手権 進行中');
  const cs = seasonData.clubSenshuken || (WORLD_DATA.initialized ? WORLD_DATA.corporateClubSenshuken : null);
  if (cs?.champion) tournamentNews.push(`クラブ選手権 優勝: ${cs.champion}`);

  // 掲載選手への知名度付与（1日1回）
  const curDate = seasonData.currentDate;
  const todayKey = `${curDate?.year}-${curDate?.month}-${curDate?.day}`;
  // ⚠ ここは**副作用**（掲載選手に知名度を配る）。`useMemo` の中だが、
  //    呼び出し側の ref で「1日1回」に絞っているので二重に配られない。
  if (fameDateRef && fameDateRef.current !== todayKey) {
    fameDateRef.current = todayKey;
    const boost = (player, amt) => { if (player) player.fame = Math.min(100, (player.fame || 0) + amt); };
    // 高校: No.1 +3、その他 +1
    if (highSchoolPool.players?.length > 0) {
      const hsSorted = highSchoolPool.players
        .map(p => ({ p, s: checkNPBDraftEligibility(p).totalScore }))
        .filter(x => x.s >= 80).sort((a, b) => b.s - a.s);
      hsSorted.forEach((x, i) => boost(x.p, i === 0 ? 3 : 1));
    }
    // 大学: No.1 +3、その他 +1
    uniAll.forEach((x, i) => boost(x.player, i === 0 ? 3 : 1));
    // 社会人: No.1 +3、その他 +1
    corpAll.forEach((x, i) => boost(x.player, i === 0 ? 3 : 1));
    // 独立: No.1 +3、その他 +1
    indAll.forEach((x, i) => boost(x.player, i === 0 ? 3 : 1));
  }

  return {
    hsTop, hsOthers,
    uniTop, uniOthers,
    corpTop: corpAll[0]?.card || null, corpOthers: corpAll.slice(1, 10).map(x => x.card),
    indTop: indAll[0]?.card || null, indOthers: indAll.slice(1, 10).map(x => x.card),
    tournamentNews,
  };
}

/**
 * 紙面本体。`data` は `buildNewspaperData` の戻り値。
 */
export default function NewspaperModal({ data, seasonData, onClose }) {
    const d = data;
    const curDate = seasonData.currentDate;

    const gpBadge = (gp) => gp >= 1.5 ? '成長◎◎' : gp >= 1.3 ? '成長◎' : gp >= 1.1 ? '成長○' : null;

    // 新聞紙面カラーパレット（紙×インク＝明朝体で本物の紙面感・高コントラスト）
    // ⚠ **紙は地色より明るい**。以前は `--surface-0`(#abb1ad・輝度175) と同じ紙に
    //    していたが、**この紙面は地色の上ではなく黒い幕(bg-black/80)の上に浮く**ので
    //    「地色の上に直に載るもの」の文脈ではない。輝度175 では新聞紙に見えず、
    //    載っているインクも 3.5〜4.3 と紙面の割に薄かった。
    //    輝度210 の中立グレー（彩度2%）にすると**全インクが 5.1〜9.5 へ上がる**。
    //    ⚠ 明るくしても**クリームには戻さないこと**（彩度28%の別の紙になる）。
    //    「明るいグレーの新聞紙」であって「セピアの古紙」ではない。
    const PAPER = '#d2d3cf';   // 新聞紙（輝度210・彩度2%）
    const CARD  = '#f4f4f1';   // 囲み記事の中（紙に対し 1.37。**分離は太い黒枠が担う**）
    const INK   = '#262b32';   // = --ink                        9.47:1
    const MUTED = '#3a4048';   // --ink-sub を一段濃く            6.96:1
    const FAINT = '#4d545b';   // 補足（所属名）                  5.10:1
    const RULE = 'rgba(38,43,50,0.35)';
    const MAST = '#b91c1c';    // 題字脇の色帯（塗りのみ。文字は乗せない）
    const serif = { fontFamily: '"Hiragino Mincho ProN","Yu Mincho",serif' };
    // ⚠ **囲み記事の分離に「地色→カードは3.0以上」を当てはめないこと**。
    //    あちらは *面の明暗* だけで島を浮かせる話。新聞の囲み記事は
    //    **2px の黒枠**で切るのが本来の作法で、紙と記事面を明暗で離すと
    //    紙面がまだら（＝新聞に見えない）になる。ここは枠が境界を持つ。
    // カテゴリ別のインク色
    // ⚠ **900段（文字）と800段（塗り）を取り違えないこと**。紙の上に直に載る
    //    見出しは 900段（実測 6.03〜7.23）、白文字が乗る塗りは 800段（白で 7.09〜8.72）。
    //    800段を紙の上の文字に使うと 4.0 前後まで落ちる。
    // `bar` は**段見出しの白抜き（反転）**に使う。スポーツ紙の見出しは
    // 色文字ではなく色帯に白抜きなので、そちらを主にしてある。
    const CAT = {
      hs:   { head: 'text-green-900',  bar: 'bg-green-800',  chip: 'bg-green-800 text-green-50' },
      uni:  { head: 'text-blue-900',   bar: 'bg-blue-800',   chip: 'bg-blue-800 text-blue-50' },
      corp: { head: 'text-amber-900',  bar: 'bg-amber-800',  chip: 'bg-amber-800 text-amber-50' },
      ind:  { head: 'text-purple-900', bar: 'bg-purple-800', chip: 'bg-purple-800 text-purple-50' },
    };

    // 指名確度スター（中立な紙で映える濃オレンジ。ラベルも同色なので AA を満たす濃さにする）
    const STAR_ON = '#7c2d12';
    const STAR_OFF = '#868b88';   // 空の★。輪郭が見える程度（2.0:1）に留める
    const Stars = ({ n = 0, size = 'text-base' }) => (
      <span className={`${size} leading-none tracking-tighter`}>
        <span style={{ color: STAR_ON }}>{'★'.repeat(n)}</span><span style={{ color: STAR_OFF }}>{'☆'.repeat(5 - n)}</span>
      </span>
    );

    const FeatureCard = ({ c, label, cat }) => {
      if (!c) return null;
      const stats = c.isPitcher
        ? [c.velocity && `${c.velocity}km`, c.control && `制球${c.control}`, c.stamina && `スタ${c.stamina}`, c.arsenalCount && `${c.arsenalCount}球種`].filter(Boolean)
        : [c.meet && `ミート${c.meet}`, c.power && `パワー${c.power}`, c.speed && `走力${c.speed}`, c.defense && `守備${c.defense}`, c.eye && `選球${c.eye}`].filter(Boolean);
      const gp = gpBadge(c.growthPotential || 1.0);
      // 見出しは**白抜きの帯**（スポーツ紙の主見出し）。投手=赤 / 野手=紺の意味色は
      // そのまま塗りへ移す（白文字で 10.02 / 9.46）
      const headBand = c.isPitcher ? '#7f1d1d' : '#0c4a6e';
      return (
        // ⚠ **囲み記事は太い黒枠で切る**。紙との明暗差ではなく枠が境界を持つ
        <div className="flex flex-col" style={{ background: CARD, border: `2px solid ${INK}` }}>
          {/* 肩見出し（キッカー）＝カテゴリの反転チップ */}
          <div className={`flex items-center gap-1.5 px-2 py-1 ${cat.chip}`}>
            <span className="text-xs font-black tracking-wide">{label}</span>
            {gp && <span className="ml-auto text-xs font-black shrink-0">{gp}</span>}
          </div>
          <div className="p-2.5 flex flex-col gap-1.5">
            {/* 選手名（紙面の主役なので大きく、下に太い罫） */}
            <div>
              <div className="text-2xl font-black leading-tight" style={{ ...serif, color: INK }}>{c.name}</div>
              <div className={`h-0.5 mt-0.5 ${cat.bar}`} />
            </div>
            {/* ⚠ **1行に収めること**（所属名だけ truncate）。折り返すとカードごとに
                主見出しの帯の高さが変わり、4枚の紙面が段として揃わない */}
            <div className="text-xs font-medium flex items-baseline gap-1 whitespace-nowrap" style={{ color: MUTED }}>
              <span className="shrink-0">{c.position}・{c.throws}投{c.bats}打・{c.age}歳 ／</span>
              <span className="truncate min-w-0" style={{ color: FAINT }} title={c.orgName}>{c.orgName}</span>
            </div>
            {/* 主見出し（白抜きの帯） */}
            <div className="text-base font-black leading-snug px-2 py-1 text-white" style={{ ...serif, background: headBand }}>{c.headline}</div>
            {/* 指名確度: ★＋ラベル ／ 確率は大きな数字で囲む（紙面は数字を大きく出す） */}
            <div className="flex items-center gap-2">
              <div className="min-w-0">
                <Stars n={c.stars || 0} />
                <div className="text-xs font-black truncate" style={{ color: STAR_ON }}>{c.outlook}</div>
              </div>
              <div className="ml-auto shrink-0 text-center px-1.5 py-0.5" style={{ border: `1px solid ${INK}` }}>
                <div className="text-xs font-bold leading-none" style={{ color: MUTED }}>指名確度</div>
                <div className="text-xl font-black leading-none tnum" style={{ color: INK }}>{c.prob}<span className="text-xs">%</span></div>
              </div>
            </div>
            {/* データBOX（白地＋細罫。塗りつぶすと紙面が濁る） */}
            <div className="flex flex-wrap gap-1">
              {stats.map((s, i) => (
                <span key={i} className="text-xs font-bold px-1.5 py-0.5 tnum" style={{ background: '#ffffff', border: `1px solid ${RULE}`, color: INK }}>{s}</span>
              ))}
            </div>
            {/* スカウト寸評 */}
            {c.comment && <div className="text-xs font-medium leading-snug" style={{ ...serif, color: INK }}>「{c.comment}」</div>}
            {c.fame > 10 && <div className="text-xs font-bold tnum" style={{ color: '#6b3410' }}>注目度 {c.fame} ・ ドラフト評価 {c.score}</div>}
          </div>
        </div>
      );
    };

    const PlayerRow = ({ c, headColor, extra = '' }) => {
      const statStr = c.isPitcher
        ? `${c.velocity || '-'}km 制${c.control || '-'} ${c.arsenalCount || 0}球種`
        : `ミ${c.meet || '-'} パ${c.power || '-'} 走${c.speed || '-'}`;
      return (
        <div className="py-1.5" style={{ borderBottom: `1px solid ${RULE}` }}>
          <div className="flex items-center gap-1.5 leading-tight">
            {/* 守備位置は反転の小さな四角（紙面の約物。白 on INK で 14.25） */}
            <span className="text-xs font-black shrink-0 text-center text-white leading-none py-0.5"
                  style={{ background: INK, width: '1.15rem' }}>{c.position}</span>
            <span className="text-sm font-bold truncate" style={{ ...serif, color: INK }}>{c.name}</span>
            <span className="text-xs shrink-0 tnum" style={{ color: MUTED }}>{c.age}歳</span>
            {extra && <span className="text-xs font-bold shrink-0 text-blue-900">{extra}</span>}
            <Stars n={c.stars || 0} size="text-xs" />
          </div>
          <div className="flex items-center gap-1 mt-0.5" style={{ paddingLeft: '1.4rem' }}>
            <span className={`text-xs font-bold truncate ${headColor}`}>{c.headline}</span>
            <span className="ml-auto text-xs shrink-0 font-mono font-semibold tnum px-1" style={{ color: INK, background: '#ffffff', border: `1px solid ${RULE}` }}>{statStr}</span>
          </div>
          {/* 所属＋スカウト寸評（枠内で折り返し、途切れないように） */}
          <div className="text-xs leading-snug" style={{ paddingLeft: '1.4rem' }}>
            <span style={{ color: FAINT }}>{c.orgName}</span>
            <span style={{ color: FAINT }}> ／ </span>
            <span style={{ color: INK }}>{c.comment}</span>
          </div>
        </div>
      );
    };

    const SubColumn = ({ title, count, cat, children, borderLeft }) => (
      <div style={borderLeft ? { borderLeft: `1px solid ${RULE}`, paddingLeft: '0.75rem' } : undefined}>
        {/* 段見出しは**白抜き**（色文字ではなく色帯に白）。スポーツ紙の作法 */}
        <div className={`text-sm font-black px-2 py-1 mb-2 flex justify-between items-center text-white ${cat.bar}`} style={serif}>
          <span>{title}</span>
          <span className="text-xs font-black px-1 tnum" style={{ background: 'rgba(255,255,255,0.22)' }}>{count}名</span>
        </div>
        {children}
        {count === 0 && <div className="text-xs font-medium" style={{ color: FAINT }}>情報なし</div>}
      </div>
    );

    const hasContent = d.hsTop || d.uniTop || d.corpTop || d.indTop;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3" onClick={() => onClose()}>
        <div className="absolute inset-0 bg-black/80" />
        {/* ⚠ **角を丸めないこと**。紙面なので直角。丸めると本編のカードに見える */}
        <div className="relative w-full max-w-7xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()} style={{ background: PAPER, maxHeight: '95vh', border: `3px solid ${INK}` }}>
          {/* 題字（マストヘッド） */}
          <div className="pt-2 pb-0 px-4 shrink-0" style={{ background: PAPER, borderBottom: `4px double ${INK}` }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold tnum" style={{ color: MUTED }}>{curDate.year}年{curDate.month}月{curDate.day}日</span>
              <span className="text-xs tracking-[0.35em] uppercase font-bold" style={{ color: FAINT }}>Draft Watch</span>
              <button onClick={() => onClose()} className="text-xl leading-none px-1 font-bold hover:opacity-60" style={{ color: INK }}>✕</button>
            </div>
            {/* 題字＋脇の色帯（新聞の題字は左に色の柱を持つ） */}
            <div className="flex items-center justify-center gap-3 mt-0.5">
              <span className="w-1.5 h-9 shrink-0" style={{ background: MAST }} />
              <h2 className="text-4xl font-black tracking-[0.15em]" style={{ ...serif, color: INK }}>ドラフト戦線</h2>
              <span className="w-1.5 h-9 shrink-0" style={{ background: MAST }} />
            </div>
            {/* リード文は反転の帯（紙面の柱） */}
            <div className="mt-1.5 -mx-4 px-4 py-1 text-xs font-bold text-white text-center tracking-wide" style={{ background: INK }}>
              全国 高校・大学・社会人・独立リーグ　注目選手 速報
            </div>
          </div>

          {hasContent ? (
            <div className="overflow-y-auto flex-1 min-h-0 p-4" style={{ background: PAPER }}>
              {/* 速報ティッカー */}
              {d.tournamentNews.length > 0 && (
                <div className="px-3 py-2 mb-3 flex gap-3 items-center flex-wrap" style={{ background: '#7f1d1d', border: `2px solid ${INK}` }}>
                  <span className="text-xs font-black text-white px-1.5 py-0.5 shrink-0" style={{ background: '#dc2626' }}>速報</span>
                  {d.tournamentNews.map((t, i) => (
                    <span key={i} className="text-sm font-bold text-white">{t}</span>
                  ))}
                </div>
              )}

              {/* トップ特集カード（各カテゴリNo.1） */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                {d.hsTop && <FeatureCard c={d.hsTop} cat={CAT.hs} label="高校 注目No.1" />}
                {d.uniTop && <FeatureCard c={d.uniTop} cat={CAT.uni} label={`大学${d.uniTop.uniRank ? `[${d.uniTop.uniRank}]` : ''} 注目No.1`} />}
                {d.corpTop && <FeatureCard c={d.corpTop} cat={CAT.corp} label="社会人 注目No.1" />}
                {d.indTop && <FeatureCard c={d.indTop} cat={CAT.ind} label="独立 注目No.1" />}
              </div>

              <div className="mb-3" style={{ height: '3px', borderTop: `1px solid ${INK}`, borderBottom: `1px solid ${INK}` }} />

              {/* カテゴリ別 注目株一覧（4段組み・段間罫線） */}
              <div className="grid grid-cols-4 gap-3">
                <SubColumn title="高校 注目株" count={d.hsOthers.length} cat={CAT.hs}>
                  {d.hsOthers.map((c, i) => <PlayerRow key={i} c={c} headColor="text-green-900" />)}
                </SubColumn>
                <SubColumn title="大学 注目株" count={d.uniOthers.length} cat={CAT.uni} borderLeft>
                  {d.uniOthers.map((c, i) => <PlayerRow key={i} c={c} headColor="text-blue-900" extra={c.year ? `${c.year}年` : ''} />)}
                </SubColumn>
                <SubColumn title="社会人 注目株" count={d.corpOthers.length} cat={CAT.corp} borderLeft>
                  {d.corpOthers.map((c, i) => <PlayerRow key={i} c={c} headColor="text-amber-900" />)}
                </SubColumn>
                <SubColumn title="独立リーグ 注目株" count={d.indOthers.length} cat={CAT.ind} borderLeft>
                  {d.indOthers.map((c, i) => <PlayerRow key={i} c={c} headColor="text-purple-900" />)}
                </SubColumn>
              </div>

              <div className="mt-4 pt-2 text-xs font-medium text-center" style={{ borderTop: `1px solid ${RULE}`, color: MUTED }}>
                ※掲載選手の知名度が上昇します。ドラフト評価スコアは模擬値で、実際の指名は10月に確定します。
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-sm font-bold" style={{ color: MUTED, background: PAPER }}>まだ注目選手の情報がありません</div>
          )}
        </div>
      </div>
    );
}
