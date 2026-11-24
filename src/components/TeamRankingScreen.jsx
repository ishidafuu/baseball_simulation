import React, { useState, useMemo } from 'react';
import TutorialHint from './TutorialHint.jsx';
import { assignRankByPercentile, RANK_BAND_LABEL } from '../corporate/corporateInit.js';
import { ScreenShell, ScreenHeader } from './GameUIComponents.jsx';
import { WORLD_DATA } from '../corporate/worldData.js';
import { TEAMS_DATA } from '../teams-data.js';
import { UNIVERSITY_TEAMS } from '../university/universityTeamsData.js';
import { universityPool } from '../state/schoolPools.js';
import { calcPlayerOverall } from '../season/dispatchSystem.js';
import { POSITION_NAMES, getOverallColor } from '../utils/constants.js';
import PlayerDetailModal from './PlayerDetailModal.jsx';

const RANK_COLOR = { S: 'text-yellow-400', A: 'text-orange-400', B: 'text-green-400', C: 'text-blue-400', D: 'text-gray-300' };
const RANK_BG = { S: 'bg-yellow-900/40 border-yellow-700/60', A: 'bg-orange-900/30 border-orange-700/50', B: 'bg-green-900/30 border-green-700/50', C: 'bg-blue-900/20 border-blue-700/40', D: 'bg-gray-900/20 border-gray-700/30' };
const TYPE_LABEL = { corporate: '社会人', worldUniversity: '大学', university: '大学', independent: '独立' };
// ⚠ 帯の定義は `corporateInit.RANK_BAND_*` が唯一の権威。ここに数字を書かないこと
//    （以前はこのファイルが独自の帯を持っており、画面だけ旧い値を出していた）。
const RANK_BAND_PCT = RANK_BAND_LABEL;

// 全ての「順位表」ソースを走査し、チーム名→通算成績のマップを作る。
// 同じチームが複数箇所（レギュラーシーズン＋春秋リーグ等）にあれば全て合算。
// TEAMS_DATA上の team.wins 直接カウントもあれば拾う（トーナメント勝ち星等）。
const buildStandingsMap = (seasonData) => {
  const map = {};
  const add = (s) => {
    if (!s?.team) return;
    const w = s.wins || 0, l = s.losses || 0, d = s.draws || 0, gp = s.gamesPlayed || (w + l + d);
    if (w + l + d + gp === 0) return;
    if (!map[s.team]) map[s.team] = { wins: 0, losses: 0, draws: 0, gamesPlayed: 0 };
    map[s.team].wins += w;
    map[s.team].losses += l;
    map[s.team].draws += d;
    map[s.team].gamesPlayed += gp;
  };
  (seasonData?.standings || []).forEach(add);
  const seenLeagueIds = new Set();
  Object.entries(WORLD_DATA.independentLeagues || {}).forEach(([id, ld]) => {
    // seasonData と同じユーザーリーグを二重に足さないため、ゲーム数が seasonData と一致するものはスキップ
    // シンプルに: seasonData に含まれるチーム集合と全一致する独立リーグは重複としてスキップ
    const seasonTeams = new Set((seasonData?.standings || []).map(s => s.team));
    const leagueTeams = new Set((ld?.standings || []).map(s => s.team));
    const isSameAsUser = seasonTeams.size > 0 && seasonTeams.size === leagueTeams.size &&
      [...leagueTeams].every(t => seasonTeams.has(t));
    if (isSameAsUser) { seenLeagueIds.add(id); return; }
    (ld?.standings || []).forEach(add);
  });
  Object.values(WORLD_DATA.universityLeagues || {}).forEach(ld => {
    ['spring', 'fall'].forEach(season => {
      const sd = ld?.[season];
      if (!sd) return;
      (sd.standings || []).forEach(add);
      (sd.standingsA || []).forEach(add);
      (sd.standingsB || []).forEach(add);
    });
  });
  return map;
};

// team.players[].seasonStats から通算打率・防御率を計算。
const computeTeamStats = (team) => {
  if (!team?.players) return { avg: null, era: null, hits: 0, atBats: 0, homeruns: 0, earnedRuns: 0, inningsPitched: 0, strikeouts: 0 };
  let hits = 0, atBats = 0, homeruns = 0, er = 0, outs = 0, k = 0;
  team.players.forEach(p => {
    const b = p.seasonStats?.batting;
    if (b) { hits += b.hits || 0; atBats += b.atBats || 0; homeruns += b.homeruns || 0; }
    const pi = p.seasonStats?.pitching;
    if (pi) { er += pi.earnedRuns || 0; outs += pi.inningsPitched || 0; k += pi.strikeouts || 0; }
  });
  const ip = outs / 3;
  return {
    avg: atBats > 0 ? hits / atBats : null,
    era: ip > 0 ? (er / ip) * 9 : null,
    hits, atBats, homeruns, earnedRuns: er, inningsPitched: ip, strikeouts: k,
  };
};

// 暫定（1年目・成績なし）ランキング用の初期値
const INITIAL_RANKING_SCORE = { S: 1200, A: 1050, B: 900, C: 750, D: 600 };
const INITIAL_REPUTATION = { S: 85, A: 65, B: 40, C: 20, D: 5 };

const rosterAvgOverall = (players) => {
  if (!players || players.length === 0) return null;
  let total = 0, count = 0;
  for (const p of players) { total += calcPlayerOverall(p); count++; }
  return count ? total / count : null;
};

// 成績スナップショットが無い1年目に、所属選手の能力から暫定ランキングを算出する。
// 全チーム（自チーム含む）を対象とし、順位・ランクとも戦力スコア順で決定する。
const buildProvisionalRanking = (gameMode) => {
  const seen = new Set();
  const entries = [];
  const userType = gameMode === 'corporate' ? 'corporate'
    : gameMode === 'university' ? 'university' : 'independent';

  // 大学プール（WORLD_DATA大学）の所属選手平均を集計
  const uniAgg = {};
  Object.values(universityPool || {}).forEach(cohort => {
    if (!Array.isArray(cohort)) return;
    cohort.forEach(e => {
      const tn = e?.universityTeamName;
      if (!tn) return;
      if (!uniAgg[tn]) uniAgg[tn] = { total: 0, count: 0 };
      uniAgg[tn].total += calcPlayerOverall(e.player);
      uniAgg[tn].count++;
    });
  });

  // rank未設定の自チーム等はB基礎値を起点に、戦力補正で位置づける
  const collect = (name, type, rank, dataObj, players) => {
    if (seen.has(name)) return;
    seen.add(name);
    let avg = rosterAvgOverall(players);
    if (avg == null && uniAgg[name]?.count) avg = uniAgg[name].total / uniAgg[name].count;
    const base = dataObj?.rankingScore ?? (rank ? INITIAL_RANKING_SCORE[rank] : INITIAL_RANKING_SCORE.B);
    entries.push({
      name, type,
      base: base || 900,
      reputation: Math.round(dataObj?.reputation ?? (rank ? INITIAL_REPUTATION[rank] : INITIAL_REPUTATION.C) ?? 20),
      rosterAvg: avg != null ? Math.round(avg) : null,
    });
  };

  for (const [name, team] of Object.entries(TEAMS_DATA)) {
    if (team?.corporateData) {
      const cd = team.corporateData;
      collect(name, team.independentLeagueId ? 'independent' : 'corporate', cd.rank, cd, team.players);
    } else if (team?.universityData) {
      collect(name, 'university', team.universityData.rank, team.universityData, team.players);
    }
  }
  for (const def of UNIVERSITY_TEAMS) {
    collect(def.name, 'worldUniversity', def.rank, def, null);
  }
  // corporateData/universityData を持たない自チーム等（rankなし）も名簿があれば含める
  for (const [name, team] of Object.entries(TEAMS_DATA)) {
    if (seen.has(name)) continue;
    if (!team?.players?.length) continue;
    collect(name, userType, null, null, team.players);
  }

  // 戦力補正は「戦力を持つチームの平均」を基準に中心化する。
  const withRoster = entries.filter(e => e.rosterAvg != null);
  const meanAvg = withRoster.length
    ? withRoster.reduce((s, e) => s + e.rosterAvg, 0) / withRoster.length
    : 45;
  const K = 8; // ランク間隔150に対し補正は概ね±60程度に収まる

  entries.forEach(e => {
    const adj = e.rosterAvg != null ? Math.round((e.rosterAvg - meanAvg) * K) : 0;
    e.score = Math.round(e.base + adj);
  });

  entries.sort((a, b) => b.score - a.score);
  entries.forEach((e, i) => { e.position = i + 1; });
  assignRankByPercentile(entries);
  return entries;
};

// universityPool から「大学名 → 現在の在籍人数」のマップを作る。
// TEAMS_DATA に選手が実体化されていない大学（他ゲームモードの並行世界大学など）でも、
// プールに所属している在籍者数を表示できるようにするためのフォールバック。
const buildUniversityPoolCountMap = () => {
  const map = {};
  Object.values(universityPool || {}).forEach(cohort => {
    if (!Array.isArray(cohort)) return;
    cohort.forEach(e => {
      const tn = e?.universityTeamName;
      if (!tn) return;
      map[tn] = (map[tn] || 0) + 1;
    });
  });
  return map;
};

// 詳細行に並べる小ブロック（タイトル＋行）。
const StatBlock = ({ title, rows }) => (
  <div className="bg-gray-900/60 border border-gray-700/60 rounded px-3 py-2">
    <div className="text-xs font-bold text-cyan-300 mb-1.5 border-b border-gray-700/60 pb-1">{title}</div>
    <div className="space-y-0.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-center justify-between text-xs">
          <span className="text-gray-300">{k}</span>
          <span className="text-white font-mono font-semibold tabular-nums">{v}</span>
        </div>
      ))}
    </div>
  </div>
);

const TeamRankingScreen = ({ userTeamName, gameMode, seasonData, onBack }) => {
  const [filterType, setFilterType] = useState('all');
  const [filterRank, setFilterRank] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [expandedTeam, setExpandedTeam] = useState(null); // 詳細を開いているチーム名
  const [sortKey, setSortKey] = useState('position'); // 'position'|'score'|'reputation'|'roster'|'wins'|'winRate'|'avg'|'era'
  const [sortAsc, setSortAsc] = useState(true); // position=昇順, その他=降順
  const [detailPlayer, setDetailPlayer] = useState(null); // 主な選手のチップから開く

  const storedRanking = WORLD_DATA._teamRanking || [];
  const isProvisional = storedRanking.length === 0;
  const provisionalRanking = useMemo(
    () => (isProvisional ? buildProvisionalRanking(gameMode) : []),
    [isProvisional, gameMode, Object.keys(TEAMS_DATA).length]
  );
  // Eloランキング(storedRanking)は corporateData/universityData を持つチームのみ収録される。
  // 自リーグ（独立モードでマーカー未設定のユーザーリーグ等）が漏れて消えるのを防ぐため、
  // 実体化済みで未収録のチームを補完し、スコア順で再ソート・再採番する。
  const ranking = useMemo(() => {
    if (isProvisional) return provisionalRanking;
    const seen = new Set(storedRanking.map(e => e.name));
    const extra = [];
    for (const [name, team] of Object.entries(TEAMS_DATA)) {
      if (seen.has(name) || !team?.players?.length) continue;
      const cd = team.corporateData, ud = team.universityData;
      const type = team.independentLeagueId ? 'independent'
        : cd ? (cd.type === 'independent' ? 'independent' : 'corporate')
        : ud ? 'university'
        : (gameMode === 'corporate' ? 'corporate' : gameMode === 'university' ? 'university' : 'independent');
      const rank = cd?.rank || ud?.rank || 'C';
      extra.push({
        name, type, rank,
        score: Math.round(cd?.rankingScore ?? ud?.rankingScore ?? INITIAL_RANKING_SCORE[rank] ?? 900),
        reputation: Math.round(cd?.reputation ?? ud?.reputation ?? INITIAL_REPUTATION[rank] ?? 20),
      });
    }
    if (extra.length === 0) return storedRanking;
    const merged = [...storedRanking.map(e => ({ ...e })), ...extra].sort((a, b) => (b.score || 0) - (a.score || 0));
    merged.forEach((e, i) => { e.position = i + 1; });
    return merged;
  }, [isProvisional, provisionalRanking, storedRanking, gameMode]);

  // 標記データ（人数・成績）で全チームを1度だけ集計
  const standingsMap = useMemo(() => buildStandingsMap(seasonData), [seasonData, ranking.length]);
  const uniPoolCountMap = useMemo(() => buildUniversityPoolCountMap(), [ranking.length]);

  // Determine type for TEAMS_DATA entries (independent check), plus stats
  const enriched = useMemo(() => {
    return ranking.map(entry => {
      let type = entry.type;
      const td = TEAMS_DATA[entry.name];
      if (type === 'corporate' && td?.independentLeagueId) type = 'independent';
      const rec = standingsMap[entry.name] || null;
      const stats = computeTeamStats(td);
      // 人数: 実体化されたTEAMS_DATA選手 > universityPool由来の在籍数 の順で採用
      let roster = td?.players?.length ?? null;
      let rosterSource = 'team';
      if (roster == null || roster === 0) {
        const pool = uniPoolCountMap[entry.name];
        if (pool > 0) { roster = pool; rosterSource = 'pool'; }
      }
      const winRate = rec && (rec.wins + rec.losses) > 0 ? rec.wins / (rec.wins + rec.losses) : null;
      return {
        ...entry, displayType: type,
        record: rec, stats, roster, rosterSource, winRate,
      };
    });
  }, [ranking, standingsMap, uniPoolCountMap]);

  // 「主な選手」（能力ランキングのチーム表示から移設）。
  // ⚠ **展開中の1チームぶんだけ計算すること**。移設元は全チームぶんを先に集計しており、
  //    約16000人に `calcPlayerOverall` を掛けていた。この画面は560行あるので同じことは
  //    できない。展開は常に1チームなので、そこだけ引けば足りる。
  // ⚠ **選手の実体を持つこと**。移設元は {name, position, overall, age} のスナップ
  //    ショットだったので選手詳細を開けなかった。実体なら共有モーダルへそのまま渡せる。
  const topPlayers = useMemo(() => {
    if (!expandedTeam) return [];
    const td = TEAMS_DATA[expandedTeam];
    const list = [];
    if (td?.players?.length) {
      td.players.forEach(p => list.push({ player: p, overall: calcPlayerOverall(p) }));
    } else {
      // 実体化されていない並行世界の大学は universityPool から引く（人数列の † と同じ経路）
      Object.values(universityPool || {}).forEach(cohort => {
        if (!Array.isArray(cohort)) return;
        cohort.forEach(e => {
          if (e?.universityTeamName !== expandedTeam || !e.player) return;
          list.push({ player: e.player, overall: calcPlayerOverall(e.player) });
        });
      });
    }
    // ⚠ **一度ここで「投手2 / 野手3」と群を分けていたが、もう要らない**。
    //    投手が出てこなかったのは選び方ではなく `calcPlayerOverall` が投手と野手で
    //    別スケールだったからで、そちらを直してある（実測で素直に上位5名を取った
    //    ときの投手シェアが **2.3% → 30.5%** ＝ ロスターの投手比率とほぼ一致）。
    //    **原因を直したら、その症状を避けるために足した細工は外すこと。**
    return list.sort((a, b) => b.overall - a.overall).slice(0, 5);
  }, [expandedTeam]);

  const filtered = useMemo(() => {
    const list = enriched.filter(e => {
      if (filterType !== 'all') {
        if (filterType === 'university') {
          if (e.displayType !== 'university' && e.displayType !== 'worldUniversity') return false;
        } else if (e.displayType !== filterType) return false;
      }
      if (filterRank !== 'all' && e.rank !== filterRank) return false;
      if (searchText && !e.name.includes(searchText)) return false;
      return true;
    });
    const getVal = (e) => {
      switch (sortKey) {
        case 'score': return e.score ?? 0;
        case 'reputation': return e.reputation ?? 0;
        case 'roster': return e.roster ?? -1;
        case 'wins': return e.record?.wins ?? -1;
        case 'winRate': return e.winRate ?? -1;
        case 'avg': return e.stats?.avg ?? -1;
        case 'era': return e.stats?.era ?? 999; // ERAは小さい方が良いので"未算出"は最下位に
        default: return e.position ?? 9999;
      }
    };
    const sorted = [...list].sort((a, b) => {
      const va = getVal(a), vb = getVal(b);
      // ERA: 小さい方が「良い」順。sortAsc=true(昇順)がデフォルト良い順、falseで逆転。
      const eraFlip = sortKey === 'era' ? -1 : 1;
      return sortAsc ? (va - vb) * eraFlip : (vb - va) * eraFlip;
    });
    return sorted;
  }, [enriched, filterType, filterRank, searchText, sortKey, sortAsc]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      // 順位・防御率は昇順（1位から / 低い順）、それ以外は降順（大きい順）が初期値
      setSortAsc(key === 'position' || key === 'era');
    }
  };

  const userEntry = enriched.find(e => e.name === userTeamName);

  if (ranking.length === 0) {
    return (
      <ScreenShell className="text-white">
        <ScreenHeader title="チームランキング"
          right={onBack && <button onClick={onBack} className="btn-secondary px-3 py-1.5 rounded text-sm">← 戻る</button>} />
        {/* ⚠ 地色（明るい紙）の上に直に載る（index.css の「文字色の決まり」の地色の列） */}
        <div className="text-ink text-center py-16">
          <div className="text-5xl mb-4">📊</div>
          <p className="text-lg mb-2">ランキングデータがまだありません</p>
          <p className="text-sm text-ink-sub">オフシーズン終了後にランキングが確定します</p>
        </div>
      </ScreenShell>
    );
  }

  const totalTeams = enriched.length;
  const rankCounts = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  enriched.forEach(e => { if (rankCounts[e.rank] !== undefined) rankCounts[e.rank]++; });

  return (
    <ScreenShell className="text-white">
      <ScreenHeader title="チームランキング" sub={`全 ${totalTeams} チーム`}
        right={<>
          {isProvisional && (
            <span className="text-xs font-bold text-amber-200 bg-amber-950 border border-amber-600/50 rounded px-2 py-0.5">暫定（戦力評価）</span>
          )}
          {onBack && <button onClick={onBack} className="btn-secondary px-3 py-1.5 rounded text-sm">← 戻る</button>}
        </>} />
      <TutorialHint id="teamranking-intro" title="全チームの序列">
        全国の社会人・大学・独立チームをS〜Dランクで序列化しています。<b className="text-cyan-200">行をクリック</b>すると成績・打撃・投手・編成の詳細が開きます。ヘッダーで並び替え可。1年目は成績が無いため所属選手の戦力から算出した暫定順位です。
      </TutorialHint>
      {isProvisional && (
        <div className="mb-4 -mt-1 text-xs text-gray-300 bg-surface-2 border border-gray-700/60 rounded px-3 py-2">
          まだ公式戦の結果がないため、<span className="text-amber-200 font-bold">所属選手の能力</span>から算出した暫定ランキングを表示しています。シーズン終了後は実際の成績（Eloスコア）で更新されます。
        </div>
      )}

      {/* User team highlight */}
      {userEntry && (
        <div className="mb-4 bg-surface-2 rounded-xl p-1"><div className="p-3 rounded-lg border-2 border-yellow-500/60 bg-yellow-900/20">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-yellow-400 font-bold text-sm">あなたのチーム</div>
            <div className="font-bold">{userEntry.name}</div>
            <div className={`font-bold text-lg ${RANK_COLOR[userEntry.rank]}`}>{userEntry.rank}ランク</div>
            <div className="text-gray-300 text-sm">#{userEntry.position} / {totalTeams}</div>
            {isProvisional && userEntry.rosterAvg != null && (
              <div className="text-sm"><span className="text-gray-300">戦力平均 </span><span className="text-white font-bold">{userEntry.rosterAvg}</span></div>
            )}
            <div className="ml-auto text-sm">
              <span className="text-gray-300">{isProvisional ? '戦力スコア ' : 'Eloスコア '}</span>
              <span className="text-white font-mono font-bold">{userEntry.score}</span>
            </div>
            <div className="text-sm text-gray-300">注目度 {userEntry.reputation}</div>
          </div>
          {(userEntry.record || userEntry.stats?.atBats > 0 || userEntry.stats?.inningsPitched > 0 || userEntry.roster != null) && (
            <div className="mt-2 pt-2 border-t border-yellow-700/30 flex items-center gap-4 flex-wrap text-xs">
              {userEntry.roster != null && (
                <span><span className="text-gray-300">所属人数 </span><span className="text-white font-bold">{userEntry.roster}</span></span>
              )}
              {userEntry.record && (
                <span>
                  <span className="text-gray-300">成績 </span>
                  <span className="font-mono font-bold">
                    <span className="text-green-300">{userEntry.record.wins}</span>
                    <span className="text-gray-400">−</span>
                    <span className="text-red-300">{userEntry.record.losses}</span>
                    <span className="text-gray-400">−</span>
                    <span className="text-gray-200">{userEntry.record.draws}</span>
                  </span>
                  {userEntry.winRate != null && (
                    <span className="ml-1 text-gray-300">
                      （勝率<span className="text-white font-bold ml-0.5">{userEntry.winRate.toFixed(3).replace(/^0/, '')}</span>）
                    </span>
                  )}
                </span>
              )}
              {userEntry.stats?.avg != null && (
                <span><span className="text-gray-300">打率 </span><span className="text-blue-300 font-bold font-mono">{userEntry.stats.avg.toFixed(3).replace(/^0/, '')}</span></span>
              )}
              {userEntry.stats?.era != null && (
                <span><span className="text-gray-300">防御率 </span><span className="text-orange-300 font-bold font-mono">{userEntry.stats.era.toFixed(2)}</span></span>
              )}
              {userEntry.stats?.homeruns > 0 && (
                <span><span className="text-gray-300">本塁打 </span><span className="text-white font-bold">{userEntry.stats.homeruns}</span></span>
              )}
            </div>
          )}
          {(() => {
            const alumni = TEAMS_DATA[userTeamName]?.npbAlumni || [];
            const produced = TEAMS_DATA[userTeamName]?.totalProPlayersProduced || alumni.length;
            if (produced <= 0) return null;
            const recent = [...alumni].slice(-3).reverse();
            return (
              <div className="mt-2 pt-2 border-t border-yellow-700/30 flex items-center gap-2 flex-wrap text-xs">
                <span className="text-yellow-300 font-bold">⚾ NPB輩出 {produced}名</span>
                {recent.map((a, i) => (
                  <span key={i} className="text-gray-300 bg-gray-800/60 rounded px-1.5 py-0.5">
                    {/* ⚠ かつて `a.year` を読んでいたが、それは削除した重複レコード
                        （`{name, position, npbTeam, draftRound, year}`）だけが持つ
                        フィールドで、正規のレコードは `draftYear` を持つ。
                        重複を消した瞬間に「undefined年目」と出た。 */}
                    {a.name}（{a.draftYear}年目・{a.npbTeam}{a.draftRound ? '/' + a.draftRound : ''}）
                  </span>
                ))}
              </div>
            );
          })()}
        </div></div>
      )}

      {/* Rank band summary */}
      <div className="flex gap-2 mb-4 bg-surface-2 rounded-xl p-2">
        {['S', 'A', 'B', 'C', 'D'].map(r => (
          <div key={r} className={`flex-1 text-center p-2 rounded border ${RANK_BG[r]}`}>
            <div className={`font-bold ${RANK_COLOR[r]}`}>{r}</div>
            <div className="text-xs text-gray-300">{rankCounts[r]}チーム</div>
            <div className="text-xs text-gray-400">{RANK_BAND_PCT[r]}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3 bg-surface-2 rounded-xl p-2">
        <div className="flex gap-1">
          {[['all', '全て'], ['corporate', '社会人'], ['university', '大学'], ['independent', '独立']].map(([v, label]) => (
            <button key={v} onClick={() => setFilterType(v)}
              className={`px-2 py-1 rounded text-xs font-medium ${filterType === v ? 'seg-on' : 'seg'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {['all', 'S', 'A', 'B', 'C', 'D'].map(r => (
            <button key={r} onClick={() => setFilterRank(r)}
              className={`px-2 py-1 rounded text-xs font-medium ${filterRank === r ? 'seg-on' : 'seg'}`}>
              {r === 'all' ? '全ランク' : r}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="チーム名検索..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="px-2 py-1 rounded text-xs bg-surface-2 border border-gray-600 text-white placeholder-gray-500 w-32"
        />
        <span className="text-xs text-gray-300 self-center">{filtered.length}件表示</span>
      </div>

      {/* Ranking table */}
      <div className="overflow-auto bg-surface-2 rounded-xl p-2" style={{ maxHeight: 'calc(100vh - 340px)' }}>
        <table className="w-full text-xs border-collapse tabular-nums">
          <thead className="sticky top-0 bg-surface-1 z-10">
            <tr className="text-gray-300 border-b border-gray-700">
              {(() => {
                const cols = [
                  { key: 'position', label: '順位', className: 'text-right pr-2 py-2 w-14' },
                  { key: null,       label: 'チーム名', className: 'text-left py-2 pl-1' },
                  { key: null,       label: 'ランク', className: 'text-center py-2 w-12' },
                  { key: 'score',    label: isProvisional ? '戦力' : 'Elo', className: 'text-center py-2 w-16' },
                  { key: 'reputation', label: '注目', className: 'text-center py-2 w-16' },
                  { key: 'roster',   label: '人数', className: 'text-center py-2 w-12' },
                  { key: 'wins',     label: '勝−敗−分', className: 'text-center py-2 w-24' },
                  { key: 'winRate',  label: '勝率', className: 'text-center py-2 w-14' },
                  { key: 'avg',      label: '打率', className: 'text-center py-2 w-14' },
                  { key: 'era',      label: '防御率', className: 'text-center py-2 w-14' },
                  { key: null,       label: '種別', className: 'text-center py-2 w-12' },
                ];
                return cols.map((c, i) => {
                  const active = c.key && sortKey === c.key;
                  return (
                    <th key={i} className={`${c.className} ${c.key ? 'cursor-pointer select-none hover:text-white' : ''} ${active ? 'text-cyan-300' : ''}`}
                      onClick={c.key ? () => toggleSort(c.key) : undefined}>
                      {c.label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
                    </th>
                  );
                });
              })()}
            </tr>
          </thead>
          <tbody>
            {filtered.map(entry => {
              const isUser = entry.name === userTeamName;
              const isExpanded = expandedTeam === entry.name;
              const rec = entry.record;
              const gp = rec ? (rec.wins + rec.losses + rec.draws) : 0;
              const wrText = entry.winRate != null ? entry.winRate.toFixed(3).replace(/^0/, '') : '—';
              const avgText = entry.stats?.avg != null ? entry.stats.avg.toFixed(3).replace(/^0/, '') : '—';
              const eraText = entry.stats?.era != null ? entry.stats.era.toFixed(2) : '—';
              return (
                <React.Fragment key={entry.name}>
                <tr
                  className={`border-b border-gray-800/50 cursor-pointer ${isUser ? 'bg-yellow-900/20' : isExpanded ? 'bg-gray-800/50' : 'hover:bg-gray-800/30'}`}
                  onClick={() => setExpandedTeam(isExpanded ? null : entry.name)}
                >
                  <td className={`text-right pr-2 py-1.5 font-mono ${entry.position <= 10 ? 'text-yellow-400 font-bold' : 'text-gray-300'}`}>
                    #{entry.position}
                  </td>
                  <td className={`pl-1 py-1.5 ${isUser ? 'font-bold text-yellow-300' : 'text-white'}`}>
                    <span className="text-gray-400 mr-1">{isExpanded ? '▾' : '▸'}</span>
                    {entry.name}
                    {isUser && <span className="ml-1 text-yellow-500 text-xs">★</span>}
                  </td>
                  <td className="text-center py-1.5">
                    <span className={`font-bold text-sm ${RANK_COLOR[entry.rank]}`}>{entry.rank}</span>
                  </td>
                  <td className="text-center py-1.5 text-gray-100 font-mono font-bold">{entry.score}</td>
                  <td className="text-center py-1.5">
                    <div className="flex items-center justify-center gap-1">
                      <div className="w-10 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${entry.reputation}%` }} />
                      </div>
                      <span className="text-gray-300 text-xs w-6 text-right">{entry.reputation}</span>
                    </div>
                  </td>
                  <td className="text-center py-1.5 text-gray-200" title={entry.rosterSource === 'pool' ? '大学プール由来の在籍者数' : ''}>
                    {entry.roster != null ? (
                      <>
                        {entry.roster}
                        {entry.rosterSource === 'pool' && <span className="text-gray-400 text-xs ml-0.5">†</span>}
                      </>
                    ) : '—'}
                  </td>
                  <td className="text-center py-1.5">
                    {rec ? (
                      <span className="font-mono">
                        <span className="text-green-400 font-bold">{rec.wins}</span>
                        <span className="text-gray-400">−</span>
                        <span className="text-red-400 font-bold">{rec.losses}</span>
                        <span className="text-gray-400">−</span>
                        <span className="text-gray-300">{rec.draws}</span>
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className={`text-center py-1.5 font-mono ${entry.winRate != null && entry.winRate >= 0.5 ? 'text-green-300' : 'text-gray-300'}`}>
                    {wrText}
                  </td>
                  <td className={`text-center py-1.5 font-mono ${entry.stats?.avg != null && entry.stats.avg >= 0.28 ? 'text-blue-300' : 'text-gray-300'}`}>
                    {avgText}
                  </td>
                  <td className={`text-center py-1.5 font-mono ${entry.stats?.era != null && entry.stats.era <= 3.5 ? 'text-orange-300' : 'text-gray-300'}`}>
                    {eraText}
                  </td>
                  <td className="text-center py-1.5 text-gray-300 text-xs">{TYPE_LABEL[entry.displayType] || '—'}</td>
                </tr>
                {isExpanded && (
                  <tr className="bg-gray-800/40 border-b border-gray-700/70">
                    <td colSpan={11} className="px-4 py-3">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
                        <StatBlock title="試合成績" rows={rec ? [
                          ['試合数', gp],
                          ['勝利', rec.wins],
                          ['敗戦', rec.losses],
                          ['引分', rec.draws],
                          ['勝率', wrText],
                        ] : [['試合数', '—'], ['備考', '順位表なし']]}
                        />
                        <StatBlock title="チーム打撃" rows={entry.stats.atBats > 0 ? [
                          ['打率', avgText],
                          ['安打', entry.stats.hits],
                          ['打数', entry.stats.atBats],
                          ['本塁打', entry.stats.homeruns],
                        ] : [['備考', '打撃記録なし']]}
                        />
                        <StatBlock title="チーム投手" rows={entry.stats.inningsPitched > 0 ? [
                          ['防御率', eraText],
                          ['投球回', entry.stats.inningsPitched.toFixed(1)],
                          ['自責点', entry.stats.earnedRuns],
                          ['奪三振', entry.stats.strikeouts],
                        ] : [['備考', '投手記録なし']]}
                        />
                        <StatBlock title="編成・評価" rows={[
                          ['所属人数', entry.roster != null ? `${entry.roster}名` : '—'],
                          [isProvisional ? '戦力スコア' : 'Eloスコア', entry.score],
                          ['注目度', entry.reputation],
                          ['ランク', entry.rank],
                          entry.rosterAvg != null ? ['戦力平均', entry.rosterAvg] : null,
                        ].filter(Boolean)}
                        />
                      </div>

                      {topPlayers.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-700/60">
                          <div className="text-xs font-bold text-cyan-300 mb-1.5">主な選手</div>
                          <div className="flex gap-1 flex-wrap">
                            {topPlayers.map(({ player, overall }, j) => (
                              // ⚠ 行のクリックは展開のトグルなので、必ず stopPropagation すること
                              <button key={j}
                                onClick={(ev) => { ev.stopPropagation(); setDetailPlayer(player); }}
                                className="text-xs bg-gray-900 hover:bg-gray-700 transition px-2 py-0.5 rounded inline-flex items-center gap-1"
                                title="クリックで選手の詳細">
                                <span className="text-gray-300">{POSITION_NAMES[player.position] || player.position}</span>
                                <span className="text-white font-bold">{player.name}</span>
                                <span className={`font-bold ${getOverallColor(overall)}`}>{overall}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Score explanation */}
      {isProvisional ? (
        <div className="mt-3 p-2 bg-surface-2 rounded text-xs text-gray-300 space-y-1">
          <div><span className="font-bold text-amber-300">暫定戦力スコア：</span> ランク基礎値（S=1200 / A=1050 / B=900 / C=750 / D=600）に、所属選手の平均総合力による補正を加算した値。順位・ランクとも戦力スコア順で算出（S〜Dの帯は上の内訳のとおり）。公式戦を消化するとEloスコア方式の実力ランキングに切り替わります。</div>
          <div className="text-gray-300">行をクリックすると、試合成績・打撃・投手・編成の詳細と、総合力上位5名の「主な選手」を展開できます（選手名をクリックで詳細）。ヘッダーをクリックでソート可。人数の <span className="text-gray-300">†</span> 印は大学プール由来（並行世界の実体化されていない大学）。</div>
        </div>
      ) : (
        <div className="mt-3 p-2 bg-surface-2 rounded text-xs text-gray-300 space-y-1">
          <div><span className="font-bold text-gray-100">FIFAランキング方式Elo：</span> ΔP = I×(W−We) / We = 1/(10^(−Δスコア/400)+1)。
          重要度I: レギュラーシーズン=50 / リーグ=40 / 全国大会1回戦=40・決勝=60。
          初期値: S=1200 / A=1050 / B=900 / C=750 / D=600。ランクは全体でのパーセンタイル（帯は上の内訳のとおり）。</div>
          <div className="text-gray-300">成績・打率・防御率は各リーグ順位表と選手個人成績から集計。行をクリックで詳細（成績・編成＋総合力上位5名の「主な選手」。選手名をクリックで詳細）を展開、ヘッダーでソート可。人数の <span className="text-gray-300">†</span> 印は大学プール由来（選手が個別に実体化されていない並行世界チーム）を示します。</div>
        </div>
      )}

      {detailPlayer && <PlayerDetailModal player={detailPlayer} onClose={() => setDetailPlayer(null)} />}
    </ScreenShell>
  );
};

export default TeamRankingScreen;
