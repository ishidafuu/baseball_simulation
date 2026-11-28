// ============================================================
// ビューの約束: アプリが読む窓口の項目のうち、**名前を変えると黙って空になる**もの（どれも無ければ出さない
// だけなので、画面の検査では気づきにくい）。以前は mobile/README.md の文にだけ書いてあった。
//
// ⚠ 載せたのは主な項目だけ（mobile/README.md の「サーバーとの約束」の文の項目を全部は載せていない）。
//    サーバー（server/projection.mjs など）で項目の名前を変える・消すときは、ここも直し、
//    アプリ（mobile/shared・androidApp）の読むところも直す。
// ⚠ 確かめ方（tools/sim-harness/online-view-contract-check.mjs）: その場でリーグを作り、本物のサーバーの答えにあるかを見る。
//    - check: 開幕直後に必ずある項目（`live: true`）を、アプリと同じ窓口（view・team・player・transactions）で。
//    - check:full（`--year`）: 年度更新のあとのキャンプまで進め、時期の項目（`when`）が1年のどこかに出るか。
//    ⚠ 検査用に取ってある答え（mobile/shared/src/jvmTest/resources/）は古いことがある（作ったあとに足した項目が無い）ので、
//      そちらでは確かめない。
//
// 書き方: `a.b` は入れ子、`a[]` は配列の中のどれか1つ、`a{}` は鍵が何でもよい表の中のどれか1つ。
// `when` はその項目が載る時期（offseason・running・late は --year で1年のどこかに出るかを見る。pro・staff・elsewhere は
// 出る人・年・保存先が限られるので見ない）。`live: true` は開幕直後のビューに必ずある。
// ⚠ どの項目にも `when` か `live` のどちらかを付ける（どちらも無い項目は確かめようがないので、検査が落とす）。
// ============================================================

/** @typedef {{ path: string, when?: string, live?: boolean, why: string }} Item */

/** @type {Record<'view' | 'team' | 'player' | 'transactions', Item[]>} */
export const VIEW_CONTRACT = {
  view: [
    // 画面
    { path: 'careerLeaders', live: true, why: '通算成績ランキング' },
    { path: 'chronicle.proDrafted[].round', when: 'offseason', why: 'プロ入りした選手の指名順位（「4位」）' },
    { path: 'chronicle.proDrafted[].ikusei', when: 'elsewhere', why: '育成指名（「育成2位」。育成で指名された選手にだけ付く）' },
    { path: 'lastCamp', live: true, why: 'キャンプの結果（キャンプの前は null で載る）' },
    { path: 'stage.key', live: true, why: 'season かどうかでキャンプ直後の案内を出す' },
    { path: 'rosterLimit', live: true, why: '選手枠の上限（無い古いサーバーだけアプリの表の数）' },
    { path: 'rosterStandard', live: true, why: '選手枠の標準の人数' },
    { path: 'yearSummary.year', when: 'offseason', why: 'その年のまとめ（年度更新から開幕した月の間だけ）' },
    { path: 'yearSummary.standings[].mine', when: 'offseason', why: 'その年のまとめの順位表' },
    { path: 'yearSummary.topics', when: 'offseason', why: 'その年のまとめの話題' },
    { path: 'roster[].naturalGrowth', live: true, why: '選手情報の「自然成長」（自球団の名簿だけ）' },
    // チーム分析・リーグ史・指導者
    { path: 'teamRatings{}.starters', live: true, why: 'チーム分析の先発（TeamAnalysis.kt の RATING_AXES）' },
    { path: 'teamRatings{}.relief', live: true, why: 'チーム分析の救援' },
    { path: 'teamRatings{}.offense', live: true, why: 'チーム分析の攻撃' },
    { path: 'teamRatings{}.defense', live: true, why: 'チーム分析の守備' },
    { path: 'teamRatings{}.speed', live: true, why: 'チーム分析の走力' },
    { path: 'teamRatings{}.bench', live: true, why: 'チーム分析の控え' },
    { path: 'teamStats{}.average', live: true, why: 'チーム成績と紙面の部の中の順位' },
    { path: 'teamStats{}.era', live: true, why: 'チーム成績' },
    { path: 'teamNames', live: true, why: '全球団の名前（部の球団・球団の選択・トレードの相手）' },
    { path: 'history[].standings[].winRate', when: 'offseason', why: 'リーグ史の過去の順位' },
    { path: 'history[].leagues', when: 'offseason', why: 'リーグ史の部' },
    { path: 'history[].playoffChampion', when: 'offseason', why: '歴代の優勝' },
    { path: 'leagueStaff.teams[].manager.id', live: true, why: '指導者の名前を押すと人物の小窓（StaffPanel.kt の LeagueCoachName）' },
    // 通知（ResultWorker）
    { path: 'teamName', live: true, why: '通知・ウィジェットの見出し' },
    { path: 'teamLabels', live: true, why: '通知・ウィジェットの球団の表示名' },
    { path: 'teamLabels{}.logo.layers', live: true, why: '球団ロゴの部品の重ね（LookLogo.kt の teamLogoOf。無ければ今までの帽子のマーク）' },
    { path: 'teamLabels{}.logo.colors', live: true, why: '球団ロゴと一緒に選んだ球団の色（帽子・帯もこの色）' },
    { path: 'recentGames[].id', live: true, why: '試合結果の通知の「新しい試合か」' },
    { path: 'recentGames[].homeScore', live: true, why: '試合結果の通知・ウィジェット' },
    { path: 'recentGames[].lineScore', live: true, why: 'ウィジェットのスコア' },
    { path: 'nextGames[].home', live: true, why: 'ウィジェットの次の試合' },
    { path: 'upcoming[].home', live: true, why: '今日の一戦のほかの試合（TodayGame.kt の otherGameCards）' },
    { path: 'teamLeagues', live: true, why: '通知・ウィジェットの順位' },
    { path: 'standings', live: true, why: '通知・ウィジェットの順位' },
    { path: 'currentDate.month', live: true, why: 'ウィジェットの日付' },
    { path: 'year', live: true, why: '手続きの通知' },
    { path: 'phase.label', when: 'offseason', why: 'ウィジェット・手続きの通知' },
    { path: 'phase.id', when: 'offseason', why: '手続きの通知の知らせ終えた印' },
    { path: 'phase.kind', when: 'offseason', why: '手続きの通知' },
    { path: 'inbox', live: true, why: 'あなたへのお知らせの通知（INBOX_TITLES の種類だけ）' },
    { path: 'trades', live: true, why: 'トレードの提案の通知' },
    { path: 'lastTryout.picks[].name', when: 'running', why: 'トライアウトの結果の通知' },
    { path: 'lastOffseason.departed', when: 'offseason', why: '年度更新の結果の通知' },
    // 今季総括号・作戦別成績・縁
    { path: 'strategyStats.fields[].rows[].cells', when: 'late', why: '作戦別成績の表' },
    { path: 'ties', live: true, why: '地元・同窓の縁の記事' },
    // 年間表彰・プロのその後・年齢構成・はじめての1週間
    { path: 'chronicle.honors.titles[].line', when: 'offseason', why: '年間表彰の行（Chronicle.kt の honorRows）' },
    { path: 'chronicle.honors.leagues[].bestNine[].label', when: 'offseason', why: 'ベストナイン' },
    { path: 'chronicle.proNews[].highlight', when: 'pro', why: 'プロのその後の便り' },
    { path: 'ageOutlook.bands[].pitchers', live: true, why: '年齢構成の帯（AgeOutlook.kt の ageOutlookOf）' },
    { path: 'ageOutlook.grid[].later', live: true, why: '年齢 × 守備位置の図' },
    { path: 'joinedAt', when: 'pro', why: 'はじめての1週間の期間（リーグを作った人には無い）' },
    // ドラフトの気配・歴代タイトル
    { path: 'proWatch', live: true, why: 'ドラフトの気配（server/proDraft.mjs の proWatchList）' },
    { path: 'chronicle.titles[].titles[].line', when: 'offseason', why: '歴代タイトル' },
    // 指導者
    { path: 'staff.seats[].coach', when: 'staff', why: '契約更改の「指導者の異動」の席・指導者カード' },
    { path: 'staff.scheduled', when: 'staff', why: '年度更新で動く人事の文' },
    { path: 'staff.policy.rows[].note', when: 'staff', why: 'チームの方針（TeamAnalysisScreen.kt の TeamPolicyCard。src/online/teamPolicy.js）' },
    // 手続きの任せ方・読むだけの窓口
    { path: 'phase.delegated', when: 'offseason', why: '自分がその手続きを指導者に任せているか' },
    { path: 'members[].ready', live: true, why: '手続きの準備完了' },
    { path: 'members[].cpu', when: 'elsewhere', why: 'CPU 球団か（CPU に任せた席だけ）' },
    { path: 'viewGeneration', when: 'elsewhere', why: '次の view に添える since（本番の保存先だけ。開発の FileStore には無い）' },
    { path: 'leaders[].rows[].id', live: true, why: 'タイトル争いの行から選手を開く（PlayerLookup.kt）' },
    { path: 'lineup', live: true, why: '編成の保存は丸ごと送り返す' },
  ],
  team: [
    { path: 'formerCareers', when: 'offseason', why: '引退・退団した選手の通算' },
    { path: 'chronicle.moves', when: 'offseason', why: '入退団履歴' },
    { path: 'roster[].years', live: true, why: '他球団の選手の年ごとの推移' },
    { path: 'lineup', live: true, why: '他球団のスタメン・投手陣と守備分析' },
    { path: 'chronicle.face.tenure', when: 'offseason', why: '球団の顔（在籍の長い選手）' },
    { path: 'staff.policy.headline', when: 'staff', why: '他球団のチームの方針（TeamAnalysisScreen.kt の TeamPolicyCard）' },
  ],
  player: [{ path: 'years', live: true, why: '自球団の選手の年ごとの推移' }],
  transactions: [
    { path: 'years', live: true, why: '取引の年の選択' },
    { path: 'items', live: true, why: '移籍・取引の一覧（LeagueHistoryScreen.kt の TransactionsPane）' },
  ],
};

/** 値の中に `path` があるか（`[]` は配列のどれか、`{}` は表のどれか。値が null でも「ある」） */
export function hasPath(value, path) {
  const parts = path.split('.');
  const walk = (at, i) => {
    if (i === parts.length) return true;
    if (at === null || typeof at !== 'object') return false;
    const part = parts[i];
    const many = part.endsWith('[]') ? '[]' : part.endsWith('{}') ? '{}' : '';
    const key = many ? part.slice(0, -2) : part;
    if (!(key in at)) return false;
    const next = at[key];
    if (!many) return walk(next, i + 1);
    if (next === null || typeof next !== 'object') return false;
    const items = many === '[]' ? (Array.isArray(next) ? next : []) : Object.values(next);
    return i + 1 === parts.length ? items.length > 0 : items.some((item) => walk(item, i + 1));
  };
  return walk(value, 0);
}
