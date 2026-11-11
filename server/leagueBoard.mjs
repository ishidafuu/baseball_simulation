// ============================================================
// ホームに出すリーグ全体の眺めのうち、サーバーで作る分。
//   1. 今後の日程に重ねる先発予定（`withStarters`）
//   2. 各項目のベスト5（`leagueLeaders`）
//
// ⚠ 順位表の2部制分けは `projection.teamLeagues` ＋ 画面側の `Standings` が持つ。
//    ここで作り直さないこと（同じものが2つになる）。
//
// ⚠ **投影（表示用）であって、保存データではない**。ここで作った値を
//    判定や保存に使わないこと。内部名（`name`）での照合は呼ぶ側が行う。
// ⚠ 12球団×24人＝288人を毎回なめる。1回の投影で**1度だけ**呼ぶこと
//    （参加者ごとに呼ぶと人数ぶん重くなる）。
// ============================================================
import { observedSeason, completeCoverage } from './recordedStats.mjs';

/**
 * これから行う試合に**先発予定を重ねる**。
 *
 * ⚠ 並べ方（日付順・自球団を必ず含める）は `projection.upcomingGames` が正本。
 *    ここでは順番を変えず、先発だけ足す。並べ直すと出どころが2つになる。
 * ⚠ **予定であって確定ではない**。実際の先発は当日の疲労で入れ替わる
 *    （`prepareDailyLineup` が疲れた投手を外す）。画面にもそう書くこと。
 * ⚠ 同じ球団が続けて出るときは**ローテを回すこと**。毎回同じだと
 *    1人が全試合に先発する予定になる。
 */
export function withStarters(games, teams, statsOf = null) {
  const seen = {};
  const nextStarter = (name, offset) => {
    const rotation = teams[name]?.pitchingRotation;
    const list = rotation?.starters || [];
    if (!list.length) return null;
    const base = rotation.currentStarterIndex || 0;
    const id = list[(base + offset) % list.length];
    return teams[name].players.find((p) => p.id === id) || null;
  };
  // ⚠ 投げる手と今季成績は `statsOf` を渡したときだけ付ける。渡さない呼び出し
  //    （試合結果の画面が使う `upcoming`）は名前だけのままにする——あちらは
  //    一覧に出すだけで、投影を重くする意味がない。
  const profile = (teamName, player) => {
    if (!player) return null;
    const pitching = statsOf(teamName, player)?.pitching;
    const outs = pitching?.inningsPitched || 0;
    return {
      name: player.name,
      // ⚠ 投げる手は `physical.throws`（選手直下ではない）。選手直下を見ると
      //    全員 undefined になり、**全員が右投げ**として出る。
      // ⚠ 既定は右。未設定の選手を「左」に倒すと、左投手が実際より多く見える
      throws: player.physical?.throws === 'left' ? 'left' : 'right',
      wins: pitching?.wins || 0,
      losses: pitching?.losses || 0,
      // ⚠ `inningsPitched` はアウト数。投げていなければ null（0.00 と出さない）
      era: outs > 0 ? ((pitching.earnedRuns || 0) * 27) / outs : null,
    };
  };
  return games.map((g) => {
    const homeOffset = seen[g.home] || 0;
    const awayOffset = seen[g.away] || 0;
    seen[g.home] = homeOffset + 1;
    seen[g.away] = awayOffset + 1;
    const home = nextStarter(g.home, homeOffset);
    const away = nextStarter(g.away, awayOffset);
    return {
      ...g,
      homeStarter: home?.name || null,
      awayStarter: away?.name || null,
      ...(statsOf
        ? {
            homeStarterInfo: profile(g.home, home),
            awayStarterInfo: profile(g.away, away),
          }
        : null),
    };
  });
}

// ⚠ 率の項目は**規定に届いた選手だけ**で競う。届かない人を混ぜると、
//    3打数2安打の控えが打率1位になって順位表として意味を成さない。
const PLATE_PER_GAME = 3.1;
const INNINGS_PER_GAME = 1;

const LEADER_CATEGORIES = [
  {
    id: 'avg', label: '打率', side: 'batting', digits: 3, desc: true, qualified: true,
    of: (s) => (s.atBats > 0 ? s.hits / s.atBats : null),
  },
  { id: 'homeruns', label: '本塁打', side: 'batting', desc: true, of: (s) => s.homeruns },
  { id: 'rbis', label: '打点', side: 'batting', desc: true, of: (s) => s.rbis },
  { id: 'stolenBases', label: '盗塁', side: 'batting', desc: true, of: (s) => s.stolenBases },
  {
    id: 'era', label: '防御率', side: 'pitching', digits: 2, desc: false, qualified: true,
    of: (s) => (s.inningsPitched > 0 ? (s.earnedRuns * 27) / s.inningsPitched : null),
  },
  { id: 'wins', label: '勝利', side: 'pitching', desc: true, of: (s) => s.wins },
  { id: 'strikeouts', label: '奪三振', side: 'pitching', desc: true, of: (s) => s.strikeouts },
  { id: 'saves', label: 'セーブ', side: 'pitching', desc: true, of: (s) => s.saves },
];

/**
 * 各項目の上位（既定は10人。PC・スマホの Web は上の5人を出し、アプリは10人を出す）。
 * 行には選手の id を添える（アプリが行から選手の詳細を開く。同じ名前の選手を取り違えないように）。
 * ⚠ 並びを決定的にすること（同値は名前で分ける）。実行のたびに順位が
 *    入れ替わると、見るたび違う人が1位になる。
 */
export function leagueLeaders(league, statsOf, labelOf = (n) => n, top = 10) {
  const names = league.season.settings.teamNames || [];
  const played = Object.fromEntries(
    (league.season.standings || []).map((s) => [s.team, s.gamesPlayed || 0]),
  );
  const entries = [];
  for (const team of names) {
    for (const player of league.game.teams[team]?.players || []) {
      entries.push({ team, player, stats: statsOf(team, player) });
    }
  }
  return LEADER_CATEGORIES.map((category) => {
    const rows = entries
      .map((entry) => {
        const stats = entry.stats?.[category.side];
        if (!stats) return null;
        if (category.qualified) {
          const games = played[entry.team] || 0;
          const enough =
            category.side === 'batting'
              ? (Number.isFinite(stats.plateAppearances)
                  ? stats.plateAppearances
                  : (stats.atBats || 0) + (stats.walks || 0) +
                    (stats.hitByPitch || 0) + (stats.sacrificeBunts || 0) +
                    (stats.sacrificeFlies || 0)) >= games * PLATE_PER_GAME
              : (stats.inningsPitched || 0) / 3 >= games * INNINGS_PER_GAME;
          if (!enough) return null;
        }
        const value = category.of(stats);
        if (value === null || value === undefined || !Number.isFinite(value))
          return null;
        if (!category.qualified && value <= 0) return null;
        return {
          // ⚠ アプリは行を押すと選手の詳細を id で開く（名前で探すと、同じ球団の同名の別人に当たる）
          id: entry.player.id,
          id: entry.player.id,
          name: entry.player.name,
          team: entry.team,
          label: labelOf(entry.team),
          value,
        };
      })
      .filter(Boolean)
      .sort(
        (a, b) =>
          (category.desc ? b.value - a.value : a.value - b.value) ||
          a.name.localeCompare(b.name, 'ja'),
      )
      .slice(0, top);
    return { id: category.id, label: category.label, digits: category.digits || 0, rows };
  });
}

/**
 * 球団ごとのチーム打率・チーム防御率。順位表に添える。
 *
 * 記録が完備していれば、当季のボックススコアを出場当時の球団ごとに足す。
 * 移籍した選手の個人成績には前の球団の分も含むため、今の名簿の合計では
 * トレードしただけで過去のチーム打率・防御率まで移ってしまう。
 * 未記録・部分記録のリーグは、欠けた試合を0にせず従来の名簿合計を使う。
 * ⚠ `inningsPitched` は**アウト数**（`leagueLeaders` の防御率と同じ式を使う）。
 *    イニング数だと思って9を掛けると3倍の防御率になる。
 * ⚠ 打席・投球回が0の球団は `null`。0除算を画面に出さない（開幕前は全球団）。
 * ⚠ 288人をなめるので、`leagueLeaders` と**同じ成績の引き当て**を渡すこと
 *    （投影で2回数え直さない）。
 */
export function teamSeasonStats(league, statsOf) {
  const names = league.season.settings.teamNames || [];
  const season = observedSeason(league);
  const games = season ? Object.values(season.games || {}) : [];
  const recorded = completeCoverage(league, season) && games.every((game) =>
    Array.isArray(game.teams?.[game.home]) && Array.isArray(game.teams?.[game.away]),
  );
  const totals = Object.fromEntries(
    names.map((name) => [name, { hits: 0, atBats: 0, earnedRuns: 0, outs: 0 }]),
  );
  const add = (total, stats) => {
    total.hits += stats?.batting?.hits || 0;
    total.atBats += stats?.batting?.atBats || 0;
    total.earnedRuns += stats?.pitching?.earnedRuns || 0;
    total.outs += stats?.pitching?.inningsPitched || 0;
  };
  if (recorded) {
    for (const game of games)
      for (const name of [game.home, game.away])
        if (Object.hasOwn(totals, name))
          for (const stats of game.teams[name]) add(totals[name], stats);
  } else {
    for (const name of names)
      for (const player of league.game.teams[name]?.players || [])
        add(totals[name], statsOf(name, player));
  }
  const out = {};
  for (const name of names) {
    const { hits, atBats, earnedRuns, outs } = totals[name];
    out[name] = {
      average: atBats > 0 ? hits / atBats : null,
      era: outs > 0 ? (earnedRuns * 27) / outs : null,
    };
  }
  return out;
}

// ⚠ 能力ランキングの項目表は**サーバーが持つ**。全球団をなめる必要があり、
//    画面には並べ替えの材料が無い（自球団の名簿しか持っていない）。
//    画面に同じ表を置くと、足したときに片方だけ直して食い違う。
const ABILITY_FIELDS = [
  { id: 'meet', label: 'ミート', side: 'batting', of: (p) => p.batting?.meet },
  { id: 'power', label: 'パワー', side: 'batting', of: (p) => p.batting?.power },
  { id: 'speed', label: '走力', side: 'batting', of: (p) => p.physical?.speed },
  { id: 'defense', label: '守備', side: 'batting', of: (p) => p.fielding?.defense },
  { id: 'arm', label: '肩', side: 'batting', of: (p) => p.physical?.arm },
  {
    id: 'velocity', label: '球速', side: 'pitching', velocity: true,
    of: (p) => p.pitching?.velocity,
  },
  { id: 'control', label: '制球', side: 'pitching', of: (p) => p.pitching?.control },
  {
    id: 'stamina', label: 'スタミナ', side: 'pitching', stamina: true,
    of: (p) => p.pitching?.stamina,
  },
];

/**
 * 能力ランキング（**リーグ全球団**の中での上位）。
 *
 * ⚠ 以前は自球団の中だけだった。12球団288人の中での位置が分からないと、
 *    自分の選手が強いのか弱いのか判断できない。
 * ⚠ 能力は元から公開の情報（他球団の名簿は「選手成績」から能力も見られる）。
 *    ここで新しく秘密を開けているわけではない。
 * ⚠ 並びを決定的にすること（同値は名前で分ける）。実行のたびに順位が
 *    入れ替わると、見るたび違う人が1位になる。
 * ⚠ 投手の項目は投手だけ、野手の項目は野手だけで競う。混ぜると
 *    「走力ランキングが投手で埋まる」ようなことが起きる。
 * ⚠ **ベスト10まで出す**。5人だと、12球団288人の中で「上澄みのさらに上」しか
 *    見えず、自分の選手が入っているかどうかの判断に使えない。
 */
export function abilityLeaders(league, labelOf = (n) => n, top = 10) {
  const entries = [];
  for (const team of league.season.settings.teamNames || [])
    for (const player of league.game.teams[team]?.players || [])
      entries.push({ team, player });
  return ABILITY_FIELDS.map((field) => {
    const pool = entries.filter(({ player }) =>
      field.side === 'pitching'
        ? player.position === 'pitcher'
        : player.position !== 'pitcher',
    );
    const rows = pool
      .map(({ team, player }) => ({ team, player, value: field.of(player) }))
      .filter((row) => typeof row.value === 'number')
      .sort(
        (a, b) =>
          b.value - a.value || a.player.name.localeCompare(b.player.name, 'ja'),
      )
      .slice(0, top)
      .map(({ team, player, value }) => ({
        id: player.id,
        name: player.name,
        team,
        label: labelOf(team),
        position: player.position,
        age: player.age,
        value,
        // 選手情報の小窓に出すぶんだけ（全項目は載せない）
        batting: { meet: player.batting?.meet, power: player.batting?.power },
        physical: { speed: player.physical?.speed, arm: player.physical?.arm },
        fielding: { defense: player.fielding?.defense },
        pitching: {
          velocity: player.pitching?.velocity,
          control: player.pitching?.control,
          stamina: player.pitching?.stamina,
        },
      }));
    return {
      id: field.id,
      label: field.label,
      side: field.side,
      velocity: !!field.velocity,
      stamina: !!field.stamina,
      rows,
    };
  });
}
