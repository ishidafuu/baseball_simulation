import React, { useState, useMemo } from 'react';
import { ScreenShell } from './GameUIComponents.jsx';
import { TEAMS_DATA } from '../teams-data.js';
import { POSITION_NAMES } from '../utils/constants.js';
import { advanceToNextYear, advanceToNextYearSandbox } from '../season/yearProgressionSystem.js';
import { generatePitchingRotation } from '../game/lineupGenerator.js';
import { getTransferCandidates, transferManagerTo, CATEGORY_LABEL, getTeamCategory } from '../game/managerTransfer.js';
import { showMessage, askConfirm } from '../utils/gameDialog.js';

const RANK_TEXT = { S: 'text-yellow-400', A: 'text-orange-400', B: 'text-green-400', C: 'text-blue-400', D: 'text-gray-300' };

const OffSeasonScreen = ({ seasonData, setSeasonData, onSave, onStartNextSeason, onAddHallOfFamePlayers, onRecordTeamHistory, saveSlots, gameMode, setGameMode, setLeagueConfig, setSelectedMonth, userTeamName }) => {
  const [processing, setProcessing] = useState(false);
  const [selectedSaveSlot, setSelectedSaveSlot] = useState(0);
  const [saveStatus, setSaveStatus] = useState(null);
  const [graduationReport, setGraduationReport] = useState(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferCat, setTransferCat] = useState(null);
  const [transferSearch, setTransferSearch] = useState('');
  const [transferResult, setTransferResult] = useState(null);

  const myTeamName = userTeamName || seasonData?.settings?.teamNames?.[0] || null;
  const transferCandidates = useMemo(
    () => (showTransfer ? getTransferCandidates(myTeamName) : null),
    [showTransfer, myTeamName]
  );

  const handleTransfer = async (teamName) => {
    const label = CATEGORY_LABEL[getTeamCategory(teamName)] || '';
    if (!(await askConfirm(
      `「${teamName}」（${label}）の監督に就任します。\n\n`
      + `・${myTeamName || '現チーム'} の指揮官を退任します\n`
      + `・翌シーズンから新チームで開始します\n`
      + `・選手や世界はそのまま引き継がれます\n\nよろしいですか？`,
      { okLabel: '就任する' },
    ))) return;
    const r = transferManagerTo(teamName, {
      seasonData, setSeasonData, setLeagueConfig, setGameMode, setSelectedMonth,
    });
    if (r.success) {
      setTransferResult({ ok: true, msg: `${teamName} の監督に就任しました（${label}）。「${(seasonData?.year || 1) + 1}年目へ進む」で新チームのシーズンが始まります。` });
      setShowTransfer(false);
    } else {
      setTransferResult({ ok: false, msg: r.error || '移籍に失敗しました' });
    }
  };

  const handleSaveToSlot = async () => {
    if (onSave) {
      await onSave(selectedSaveSlot);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  // シーズン成果をstandingsとfrozenAwardsから取得（プレーオフ完了時に確定済み）
  const seasonSummary = useMemo(() => {
    const standings = seasonData?.standings;
    if (!standings || standings.length === 0) return null;

    const sorted = [...standings].sort((a, b) => b.winRate - a.winRate);
    const champion = sorted[0];

    const awards = seasonData.frozenAwards;
    const topBatter = awards?.battingChampion
      ? { name: awards.battingChampion.name, team: awards.battingChampion.team, avg: awards.battingChampion.avg }
      : null;
    const topHR = awards?.homeRunKing
      ? { name: awards.homeRunKing.name, team: awards.homeRunKing.team, hr: awards.homeRunKing.homeruns }
      : null;
    const topPitcher = awards?.eraChampion
      ? { name: awards.eraChampion.name, team: awards.eraChampion.team, era: awards.eraChampion.era, wins: awards.winsLeader?.wins || 0 }
      : null;

    return { champion, standings: sorted, topBatter, topHR, topPitcher, awards };
  }, [seasonData]);

  const handleAdvanceYear = () => {
    if (!advanceToNextYear) {
      showMessage('年間進行システムが読み込まれていません');
      return;
    }
    setProcessing(true);
    try {
      const allTeams = TEAMS_DATA || {};

      if (onRecordTeamHistory && seasonData.standings) {
        const sortedStandings = [...seasonData.standings].sort((a, b) => b.winRate - a.winRate);
        const teamRecords = sortedStandings.map((s, idx) => {
          const team = allTeams[s.team];
          let mvpBatter = null;
          let mvpPitcher = null;
          if (team?.players) {
            const batters = team.players.filter(p => p.position !== 'pitcher' && p.seasonStats?.batting?.atBats >= 50);
            if (batters.length > 0) {
              mvpBatter = batters.reduce((best, p) => {
                const ops = (p.seasonStats.batting.atBats > 0 ? p.seasonStats.batting.hits / p.seasonStats.batting.atBats : 0) + (p.seasonStats.batting.homeruns || 0) * 0.01;
                const bestOps = (best.seasonStats.batting.atBats > 0 ? best.seasonStats.batting.hits / best.seasonStats.batting.atBats : 0) + (best.seasonStats.batting.homeruns || 0) * 0.01;
                return ops > bestOps ? p : best;
              });
              if (mvpBatter) {
                const ab = mvpBatter.seasonStats.batting.atBats;
                mvpBatter = {
                  name: mvpBatter.name,
                  avg: ab > 0 ? (mvpBatter.seasonStats.batting.hits / ab).toFixed(3) : '.000',
                  hr: mvpBatter.seasonStats.batting.homeruns || 0,
                  rbi: mvpBatter.seasonStats.batting.rbis || 0,
                  hits: mvpBatter.seasonStats.batting.hits || 0
                };
              }
            }
            const pitchers = team.players.filter(p => p.position === 'pitcher' && p.seasonStats?.pitching?.inningsPitched >= 10);
            if (pitchers.length > 0) {
              mvpPitcher = pitchers.reduce((best, p) => {
                const score = (p.seasonStats.pitching.wins || 0) * 3 + (p.seasonStats.pitching.saves || 0) * 2 + (p.seasonStats.pitching.strikeouts || 0) * 0.1;
                const bestScore = (best.seasonStats.pitching.wins || 0) * 3 + (best.seasonStats.pitching.saves || 0) * 2 + (best.seasonStats.pitching.strikeouts || 0) * 0.1;
                return score > bestScore ? p : best;
              });
              if (mvpPitcher) {
                const ip = mvpPitcher.seasonStats.pitching.inningsPitched || 0;
                mvpPitcher = {
                  name: mvpPitcher.name,
                  wins: mvpPitcher.seasonStats.pitching.wins || 0,
                  losses: mvpPitcher.seasonStats.pitching.losses || 0,
                  saves: mvpPitcher.seasonStats.pitching.saves || 0,
                  era: ip > 0 ? ((mvpPitcher.seasonStats.pitching.earnedRuns || 0) * 27 / ip).toFixed(2) : '-.--',
                  strikeouts: mvpPitcher.seasonStats.pitching.strikeouts || 0
                };
              }
            }
          }
          return {
            team: s.team, rank: idx + 1,
            wins: s.wins, losses: s.losses, draws: s.draws || 0,
            winRate: s.winRate, mvpBatter, mvpPitcher
          };
        });
        // 年鑑（歴代タイトル/記録）用に、その年のタイトルホルダーを軽量化して保存。
        // frozenAwards はプレーオフ確定時に seasonData に凍結済み。
        const fa = seasonData.frozenAwards;
        const slimAward = (a, statKeys) => {
          if (!a) return null;
          const out = { name: a.name, team: a.team };
          statKeys.forEach(k => { if (a[k] !== undefined) out[k] = a[k]; });
          return out;
        };
        const awardsArchive = fa ? {
          battingChampion: slimAward(fa.battingChampion, ['avg']),
          homeRunKing:     slimAward(fa.homeRunKing, ['homeruns']),
          rbiKing:         slimAward(fa.rbiKing, ['rbis']),
          stolenBaseKing:  slimAward(fa.stolenBaseKing, ['stolenBases']),
          eraChampion:     slimAward(fa.eraChampion, ['era']),
          winsLeader:      slimAward(fa.winsLeader, ['wins']),
          savesLeader:     slimAward(fa.savesLeader, ['saves']),
          strikeoutKing:   slimAward(fa.strikeoutKing, ['strikeouts']),
        } : null;
        onRecordTeamHistory({
          year: seasonData.year,
          standings: teamRecords,
          awards: awardsArchive,
          leagueChampion: fa?.champion || sortedStandings[0]?.team || null,
          playoffChampion: seasonData.playoffChampion || null,
        });
      }

      const result = gameMode === 'sandbox'
        ? advanceToNextYearSandbox(seasonData, allTeams)
        : advanceToNextYear(seasonData, allTeams);
      setSeasonData(result.newSeasonData);
      Object.keys(result.updatedTeams).forEach(teamName => {
        TEAMS_DATA[teamName] = result.updatedTeams[teamName];
      });
      // 全CPUチームのピッチングローテーションを新ロスターで再生成
      // （引退・加入後にIDが陳腐化するのを防ぐ。ユーザーチームは手動設定を保持）
      const userTeamNameForRotation = seasonData.settings?.teamNames?.[0];
      Object.keys(TEAMS_DATA).forEach(teamName => {
        if (teamName !== userTeamNameForRotation) {
          try { generatePitchingRotation(teamName); } catch (e) { /* skip */ }
        }
      });
      if (onAddHallOfFamePlayers && result.retirements && result.retirements.length > 0) {
        const retiredPlayers = result.retirements.map(r => ({
          ...r, departureType: 'retired', year: seasonData.year
        }));
        onAddHallOfFamePlayers(retiredPlayers);
      }
      // 大学モード: 卒業レポートを表示してから次へ進む
      if (gameMode === 'university' && result.universityGraduationReport) {
        setGraduationReport({
          ...result.universityGraduationReport,
          npbDrafted: seasonData.universityNpbDrafted || [],
        });
        setProcessing(false);
        return;
      }
      if (onStartNextSeason) onStartNextSeason();
    } catch (error) {
      console.error('年度進行エラー:', error);
      showMessage('年度進行中にエラーが発生しました');
      setProcessing(false);
    }
  };

  const slotNames = ['スロット1', 'スロット2', 'スロット3'];

  const SaveSlotSelector = () => (
    <div className="bg-surface-2 rounded-xl border border-gray-600/40 p-4 mb-5">
      <h3 className="text-base font-black text-white mb-3 flex items-center gap-2">
        <span>💾</span> セーブ
      </h3>
      <div className="flex gap-2 mb-3">
        {slotNames.map((name, idx) => {
          const info = saveSlots?.[idx];
          return (
            <button
              key={idx}
              onClick={() => setSelectedSaveSlot(idx)}
              className={`flex-1 p-2.5 rounded-xl text-left transition-all duration-150 ${
                selectedSaveSlot === idx
                  ? 'seg-on ring-1' : 'seg'
              }`}
            >
              <div className="font-bold text-sm">{name}</div>
              {info ? (
                <div className="mt-0.5">
                  <div className="text-xs opacity-80">{info.year}年目 {info.date?.month}/{info.date?.day}</div>
                  {info.teamName && <div className="text-xs font-bold truncate opacity-90">{info.teamName}</div>}
                </div>
              ) : (
                <div className="text-xs opacity-70 mt-0.5">空き</div>
              )}
            </button>
          );
        })}
      </div>
      <button
        onClick={handleSaveToSlot}
        className="btn-primary w-full px-4 py-2.5 rounded-xl text-base transition-all duration-150 hover:shadow-lg"
      >
        {slotNames[selectedSaveSlot]}に保存
      </button>
      {saveStatus === 'saved' && (
        <div className="mt-2 text-green-400 text-center text-sm font-bold animate-pulse">✓ セーブしました</div>
      )}
    </div>
  );

  // 大学モード: 卒業レポート画面
  if (graduationReport) {
    const r = graduationReport;
    const npbDrafted = r.npbDrafted || [];
    const pathLabel = { corporate: '社会人', independent: '独立L', club: 'クラブ', retired: '引退' };
    const posLabel = POSITION_NAMES || {};
    // チーム別にグループ化
    const teamGroups = {};
    r.graduated.forEach(g => {
      if (!teamGroups[g.team]) teamGroups[g.team] = [];
      teamGroups[g.team].push(g);
    });
    return (
      <ScreenShell width="form">
          <div className="mb-6">
            <p className="text-ink-sub text-sm font-semibold tracking-[0.15em] uppercase">Graduation Report</p>
            <h1 className="text-xl font-bold text-ink">🎓 卒業・入部レポート</h1>
          </div>

          {/* サマリー */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-surface-2 rounded-xl p-3 text-center border border-gray-700/40">
              <div className="text-gray-300 text-xs mb-1">卒業生</div>
              <div className="text-white font-black text-2xl">{r.graduated.length}</div>
            </div>
            <div className="bg-surface-2 rounded-xl p-3 text-center border border-red-800/30">
              <div className="text-red-400 text-xs mb-1">NPB指名</div>
              <div className="text-red-300 font-black text-2xl">{npbDrafted.length}</div>
            </div>
            <div className="bg-surface-2 rounded-xl p-3 text-center border border-emerald-800/30">
              <div className="text-emerald-400 text-xs mb-1">新入生</div>
              <div className="text-emerald-300 font-black text-2xl">{r.recruited.length}</div>
            </div>
          </div>

          {/* NPB指名 */}
          {npbDrafted.length > 0 && (
            <div className="bg-surface-2 border border-red-800/30 rounded-xl p-4 mb-5">
              <h3 className="text-sm font-black text-red-400 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-400"></span>
                NPBドラフト指名
              </h3>
              <div className="space-y-1.5">
                {npbDrafted.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 bg-red-900/25 rounded-lg px-3 py-2 text-sm">
                    <span className="text-red-300/70 text-xs font-bold w-20 shrink-0">{d.draftRound}</span>
                    <span className="text-white font-bold flex-1">{d.name}</span>
                    <span className="text-gray-300 text-xs">{posLabel[d.position] || d.position}</span>
                    <span className="text-gray-400 text-xs">{d.team}</span>
                    <span className="text-red-300 font-bold text-xs shrink-0">→ {d.npbTeam}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 卒業生進路一覧（チーム別） */}
          {r.graduated.length > 0 && (
            <div className="bg-surface-2 border border-amber-700/30 rounded-xl p-4 mb-5">
              <h3 className="text-sm font-black text-amber-400 mb-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                卒業生の進路
              </h3>
              <p className="text-xs text-gray-400 mb-3">
                社会人 {r.postGradPaths.corporate}名 / 独立リーグ {r.postGradPaths.independent}名 / クラブ {r.postGradPaths.club || 0}名 / 引退 {r.postGradPaths.retired}名
              </p>
              {Object.entries(teamGroups).map(([team, grads]) => (
                <div key={team} className="mb-3 last:mb-0">
                  <div className="text-xs font-bold text-gray-300 mb-1 px-1">{team}</div>
                  <div className="space-y-1">
                    {grads.map((g, i) => (
                      <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${
                        g.path === 'corporate' ? 'bg-blue-900/20' :
                        g.path === 'independent' ? 'bg-green-900/20' :
                        g.path === 'club' ? 'bg-cyan-900/20' :
                        'bg-gray-800/30'
                      }`}>
                        <span className={`font-bold text-xs w-14 text-center rounded px-1 py-0.5 ${
                          g.path === 'corporate' ? 'bg-blue-800/50 text-blue-300' :
                          g.path === 'independent' ? 'bg-green-800/50 text-green-300' :
                          g.path === 'club' ? 'bg-cyan-800/50 text-cyan-300' :
                          'bg-gray-700/50 text-gray-300'
                        }`}>{pathLabel[g.path]}</span>
                        <span className="text-white font-bold flex-1">{g.name}</span>
                        <span className="text-gray-300 text-xs w-6 text-center">{posLabel[g.position] || g.position}</span>
                        {g.nextYearTeam && (
                          <span className="text-amber-400/80 text-xs font-bold shrink-0">→ {g.nextYearTeam}</span>
                        )}
                        {g.stats && (
                          <span className="text-gray-400 text-xs tabular-nums w-28 text-right">
                            {g.position === 'pitcher'
                              ? `${g.stats.velocity}km / 制球${g.stats.control}`
                              : `M${g.stats.meet} P${g.stats.power} E${g.stats.eye} S${g.stats.speed}`
                            }
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 新入生 */}
          {r.recruited.length > 0 && (() => {
            const recTeamGroups = {};
            r.recruited.forEach(p => {
              if (!recTeamGroups[p.team]) recTeamGroups[p.team] = [];
              recTeamGroups[p.team].push(p);
            });
            return (
              <div className="bg-surface-2 border border-emerald-700/30 rounded-xl p-4 mb-5">
                <h3 className="text-sm font-black text-emerald-400 mb-1 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  新入生
                </h3>
                <p className="text-xs text-gray-400 mb-3">
                  推薦入学 {r.recruited.filter(p => p.type === 'recommended').length}名 / 一般入部 {r.recruited.filter(p => p.type === 'general').length}名
                </p>
                {Object.entries(recTeamGroups).map(([team, players]) => (
                  <div key={team} className="mb-2 last:mb-0">
                    <div className="text-xs font-bold text-gray-300 mb-1 px-1">{team}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {players.map((p, i) => (
                        <span key={i} className={`text-xs rounded px-2 py-1 ${
                          p.type === 'recommended'
                            ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/40'
                            : 'bg-gray-800/60 text-gray-300'
                        }`}>
                          {p.name}
                          <span className="text-gray-400 ml-1">{posLabel[p.position] || p.position}</span>
                          {p.type === 'recommended' && <span className="ml-1 text-emerald-500 font-bold">推</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          <div className="text-center">
            <button
              onClick={() => { if (onStartNextSeason) onStartNextSeason(); }}
              className="btn-primary px-12 py-4 rounded-xl font-black text-xl transition-all duration-200 shadow-xl hover:scale-105 active:scale-95"
            >
              キャンプへ進む →
            </button>
          </div>
      </ScreenShell>
    );
  }

  return (
    <div className="p-4">
      <style>{`
        @keyframes championGlow {
          0%, 100% { box-shadow: 0 0 20px rgba(234,179,8,0.3), 0 0 40px rgba(234,179,8,0.1); }
          50%       { box-shadow: 0 0 30px rgba(234,179,8,0.5), 0 0 60px rgba(234,179,8,0.2); }
        }
        @keyframes trophyBounce {
          0%, 100% { transform: translateY(0) scale(1); }
          50%       { transform: translateY(-6px) scale(1.08); }
        }
        .champion-card { animation: championGlow 2.5s ease-in-out infinite; }
        .trophy-icon   { animation: trophyBounce 2s ease-in-out infinite; }
      `}</style>

      <div className="max-w-3xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-6">
          <p className="text-ink-sub text-sm font-semibold tracking-[0.15em] uppercase">Off Season</p>
          <h1 className="text-xl font-bold text-ink">{seasonData.year}年目 シーズン終了</h1>
          {gameMode === 'sandbox' && (
            <span className="inline-block mt-1 bg-orange-900 text-orange-100 border border-orange-700 text-sm font-bold px-3 py-0.5 rounded-full">
              箱庭モード
            </span>
          )}
        </div>

        {/* 優勝チームカード */}
        {seasonSummary?.champion && (
          <div className="champion-card bg-gradient-to-r from-yellow-950 via-yellow-900 to-yellow-950 rounded-2xl border border-yellow-500/50 p-5 mb-5 text-center">
            <div className="trophy-icon text-5xl mb-2 inline-block">🏆</div>
            <p className="text-yellow-400/80 text-sm font-bold tracking-widest uppercase mb-1">Champion</p>
            <h2 className="text-3xl font-black text-white mb-1">{seasonSummary.champion.team}</h2>
            <p className="text-yellow-300 text-base font-semibold">
              {seasonSummary.champion.wins}勝 {seasonSummary.champion.losses}敗
              {seasonSummary.champion.draws > 0 ? ` ${seasonSummary.champion.draws}分` : ''}
              　勝率 {(seasonSummary.champion.winRate || 0).toFixed(3)}
            </p>
          </div>
        )}

        {/* 個人タイトルハイライト */}
        {seasonSummary?.awards && (() => {
          const a = seasonSummary.awards;
          const titles = [
            a.battingChampion && { label: '🏏 首位打者', name: a.battingChampion.name, value: a.battingChampion.avg, border: 'border-blue-500/30', titleColor: 'text-blue-400', valueColor: 'text-blue-300' },
            a.homeRunKing && { label: '💣 本塁打王', name: a.homeRunKing.name, value: `${a.homeRunKing.homeruns}本`, border: 'border-red-500/30', titleColor: 'text-red-400', valueColor: 'text-red-300' },
            a.rbiKing && { label: '🎯 打点王', name: a.rbiKing.name, value: `${a.rbiKing.rbis}打点`, border: 'border-orange-500/30', titleColor: 'text-orange-400', valueColor: 'text-orange-300' },
            a.stolenBaseKing && a.stolenBaseKing.stolenBases > 0 && { label: '💨 盗塁王', name: a.stolenBaseKing.name, value: `${a.stolenBaseKing.stolenBases}盗塁`, border: 'border-cyan-500/30', titleColor: 'text-cyan-400', valueColor: 'text-cyan-300' },
            a.eraChampion && { label: '⚾ 防御率王', name: a.eraChampion.name, value: `ERA ${a.eraChampion.era}`, border: 'border-green-500/30', titleColor: 'text-green-400', valueColor: 'text-green-300' },
            a.winsLeader && { label: '🏆 最多勝', name: a.winsLeader.name, value: `${a.winsLeader.wins}勝`, border: 'border-yellow-500/30', titleColor: 'text-yellow-400', valueColor: 'text-yellow-300' },
            a.savesLeader && { label: '🔒 最多セーブ', name: a.savesLeader.name, value: `${a.savesLeader.saves}S`, border: 'border-purple-500/30', titleColor: 'text-purple-400', valueColor: 'text-purple-300' },
            a.strikeoutKing && { label: '🔥 最多奪三振', name: a.strikeoutKing.name, value: `${a.strikeoutKing.strikeouts}K`, border: 'border-pink-500/30', titleColor: 'text-pink-400', valueColor: 'text-pink-300' },
          ].filter(Boolean);

          return titles.length > 0 && (
            <div className="grid grid-cols-4 gap-2.5 mb-5">
              {titles.map((t, i) => (
                <div key={i} className={`bg-surface-2 rounded-xl border ${t.border} p-2.5 text-center`}>
                  <p className={`${t.titleColor} text-xs font-bold tracking-wide mb-0.5`}>{t.label}</p>
                  <p className="text-white font-black text-sm leading-tight">{t.name}</p>
                  <p className={`${t.valueColor} text-lg font-black mt-0.5`}>{t.value}</p>
                </div>
              ))}
            </div>
          );
        })()}

        {/* 順位表（コンパクト） */}
        {seasonSummary?.standings && seasonSummary.standings.length > 1 && (() => {
          const renderStandingsRows = (rows) => rows.map((s, idx) => (
            <div
              key={s.team}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                idx === 0
                  ? 'bg-yellow-800/30 border border-yellow-600/30'
                  : 'bg-gray-700/40'
              }`}
            >
              <span className={`font-black text-base w-6 text-center ${
                idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-orange-400' : 'text-gray-400'
              }`}>{idx + 1}</span>
              <span className={`font-bold text-base flex-1 ${idx === 0 ? 'text-yellow-200' : 'text-white'}`}>
                {s.team}
              </span>
              <span className="text-gray-300 text-sm font-semibold tabular-nums">
                {s.wins}勝{s.losses}敗{s.draws > 0 ? `${s.draws}分` : ''}
              </span>
              <span className="text-gray-300 text-sm tabular-nums w-12 text-right">
                {(s.winRate || 0).toFixed(3)}
              </span>
            </div>
          ));
          const springRows = gameMode === 'university' && seasonData.springStandings?.length > 0
            ? [...seasonData.springStandings].sort((a, b) => b.winRate - a.winRate)
            : null;
          const fallLabel = gameMode === 'university' ? '秋季最終順位' : '最終順位表';
          return (
            <div className="bg-surface-2 rounded-2xl border border-gray-700/50 p-4 mb-5">
              {springRows && (
                <>
                  <h3 className="text-base font-black text-white mb-3">春季最終順位</h3>
                  <div className="space-y-1.5 mb-5">
                    {renderStandingsRows(springRows)}
                  </div>
                </>
              )}
              <h3 className="text-base font-black text-white mb-3">{fallLabel}</h3>
              <div className="space-y-1.5">
                {renderStandingsRows(seasonSummary.standings)}
              </div>
            </div>
          );
        })()}

        {/* 社会人モード: チーム注目度・ランク */}
        {(() => {
          const userTeamName = seasonData.settings?.teamNames?.[0] || Object.keys(TEAMS_DATA)[0];
          const cd = TEAMS_DATA[userTeamName]?.corporateData;
          if (!cd) return null;
          const rankColors = { S: 'text-yellow-400 border-yellow-500/40 bg-surface-2', A: 'text-blue-400 border-blue-500/40 bg-surface-2', B: 'text-green-400 border-green-500/40 bg-surface-2', C: 'text-gray-300 border-gray-500/40 bg-surface-2', D: 'text-gray-400 border-gray-600/40 bg-surface-2' };
          const colors = rankColors[cd.rank] || rankColors.C;
          return (
            <div className={`rounded-xl border p-4 mb-5 ${colors}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-300 mb-1">チームランク・注目度</h3>
                  <div className="flex items-center gap-3">
                    <span className={`text-3xl font-black ${colors.split(' ')[0]}`}>{cd.rank}</span>
                    <div>
                      <div className="text-white text-sm font-bold">{userTeamName}</div>
                      <div className="text-gray-300 text-xs">注目度: {Math.round(cd.reputation)} / 100</div>
                    </div>
                  </div>
                </div>
                <div className="w-32">
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all" style={{width: `${cd.reputation}%`}} />
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        <SaveSlotSelector />

        {/* 監督移籍（年度末のみ・カテゴリを跨いで就任できる） */}
        {gameMode !== 'sandbox' && (
          <div className="bg-surface-2 rounded-xl border border-gray-600/40 p-4 mb-5">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <span>🧳</span> 監督移籍
              </h3>
              <span className="text-xs text-gray-300">
                現職: <span className="font-bold text-white">{myTeamName || '—'}</span>
              </span>
              <button
                onClick={() => { setShowTransfer(v => !v); setTransferResult(null); }}
                className="btn-warn ml-auto px-4 py-1.5 rounded-lg text-sm transition"
              >
                {showTransfer ? '閉じる' : '他チームの監督に就任する'}
              </button>
            </div>
            <p className="text-xs text-gray-300 mt-2">
              大学・社会人・独立リーグを跨いで監督キャリアを歩めます。選手と世界はそのまま引き継がれ、教え子と再会することもあります。
            </p>
            {transferResult && (
              <div className={`mt-3 text-sm font-bold ${transferResult.ok ? 'text-green-300' : 'text-red-300'}`}>
                {transferResult.ok ? '✓ ' : '✕ '}{transferResult.msg}
              </div>
            )}

            {showTransfer && transferCandidates && (
              <div className="mt-3">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {['independent', 'corporate', 'club', 'university'].map(cat => {
                    const n = transferCandidates[cat]?.length || 0;
                    if (n === 0) return null;
                    return (
                      <button
                        key={cat}
                        onClick={() => setTransferCat(transferCat === cat ? null : cat)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                          transferCat === cat ? 'seg-on' : 'seg'
                        }`}
                      >
                        {CATEGORY_LABEL[cat]} <span className="opacity-80">{n}</span>
                      </button>
                    );
                  })}
                  <input
                    type="text"
                    value={transferSearch}
                    onChange={(e) => setTransferSearch(e.target.value)}
                    placeholder="チーム名で検索…"
                    className="ml-auto bg-surface-2 text-white text-xs rounded px-2 py-1 border border-gray-600 w-48"
                  />
                </div>

                {!transferCat && !transferSearch ? (
                  <div className="text-xs text-gray-300 py-3 text-center">
                    カテゴリを選ぶか、チーム名で検索してください。
                  </div>
                ) : (
                  <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                    {(transferSearch
                      ? ['independent', 'corporate', 'club', 'university'].flatMap(c =>
                          (transferCandidates[c] || []).map(t => ({ ...t, cat: c })))
                      : (transferCandidates[transferCat] || []).map(t => ({ ...t, cat: transferCat }))
                    )
                      .filter(t => !transferSearch || t.name.includes(transferSearch) || (t.leagueName || '').includes(transferSearch))
                      .slice(0, 120)
                      .map(t => (
                        <div key={t.name} className="flex items-center gap-2 bg-gray-800/60 rounded px-2 py-1.5 text-xs">
                          <span className={`font-black w-4 text-center ${RANK_TEXT[t.rank] || 'text-gray-300'}`}>{t.rank}</span>
                          <span className="text-white font-bold truncate w-40">{t.name}</span>
                          <span className="text-gray-300 truncate w-40 hidden md:block">{t.leagueName}</span>
                          <span className="text-gray-300 hidden lg:block">注目{t.reputation}</span>
                          <span className="text-gray-300 hidden lg:block">{t.rosterSize}人</span>
                          <span className="text-amber-300 ml-auto hidden sm:block">{CATEGORY_LABEL[t.cat]}</span>
                          <button
                            onClick={() => handleTransfer(t.name)}
                            className="btn-warn px-2 py-1 rounded flex-shrink-0"
                          >
                            就任
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 大学モード: 卒業レポートは年度進行後に専用画面で表示 */}

        <div className="text-center">
          <button
            onClick={handleAdvanceYear}
            disabled={processing}
            className="btn-primary px-12 py-4 rounded-xl font-black text-xl transition-all duration-200 shadow-xl hover:scale-105 active:scale-95 disabled:opacity-60"
          >
            {processing ? (
              <span className="flex items-center gap-2">
                <span className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                処理中...
              </span>
            ) : (
              `${seasonData.year + 1}年目へ進む →`
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OffSeasonScreen;
