import React, { useState, useEffect, useRef } from 'react';
import TutorialHint from './TutorialHint.jsx';
import ConfirmBar, { keepAboveConfirmBar } from './ConfirmBar.jsx';
import { TEAMS_DATA } from '../teams-data.js';
import { generateTryoutCandidates, generateSnakeDraftOrder, selectPlayerForAI, applyReputationBonus, updateReleasedPoolAfterTryout, removeDraftedFromClubTeams } from '../season/tryoutSystem.js';
import { generateScoutComment } from '../game/scoutComment.js';
import { removeDraftedFromGraduatePools } from '../season/universityPool.js';
import { getPitchTypeName } from '../season/yearProgressionSystem.js';
import { POSITION_NAMES, POSITION_NAMES_FULL, getAbilityRank, getRankColor, getPositionSortIndex, getMentalGrade, mentalScore } from '../utils/constants.js';
import { INDEPENDENT_LEAGUES } from '../corporate/independentLeagueData.js';
import { getLeagueRankFromTeams } from '../corporate/corporateInit.js';
import { packTryoutDraft, unpackTryoutDraft } from '../season/tryoutDraftState.js';

const TryoutScreen = ({ seasonData, setSeasonData, allTeams, isInitialTryout = false, onComplete, initializeAllPitchingRotations, onSave, saveSlots }) => {
  const tryoutYear = isInitialTryout ? 1 : (seasonData?.year || 1);
  // 途中で保存したトライアウトの続き（無ければ null で、候補を作るところから始める）。
  // ⚠ 最初の描画で1回だけ読む。続きを持っていても別の年・別の種類のものは使わない
  const [resumed] = useState(() => unpackTryoutDraft(seasonData?.tryoutDraft, { year: tryoutYear, initial: isInitialTryout }));
  const [tryoutCandidates, setTryoutCandidates] = useState(() => resumed?.candidates || []);
  const [draftOrder, setDraftOrder] = useState(() => resumed?.draftOrder || []);
  const [currentPick, setCurrentPick] = useState(() => resumed?.currentPick || 0);
  const [userRoster, setUserRoster] = useState(() => resumed?.userRoster || []);
  const [teamRosters, setTeamRosters] = useState(() => resumed?.teamRosters || {});
  const [positionTab, setPositionTab] = useState('all');
  const [draftComplete, setDraftComplete] = useState(() => !!resumed?.complete);
  const [viewTab, setViewTab] = useState('draft');
  const [detailCandidate, setDetailCandidate] = useState(null);
  const [sortKey, setSortKey] = useState('overall');
  const [sortDir, setSortDir] = useState('desc');
  const [draftHistory, setDraftHistory] = useState(() => resumed?.draftHistory || []);
  // 名簿へ書き終えたか。続きが「書き終えた」なら、もう一度書かない（同じ選手が2人になる）
  const draftFinalizedRef = useRef(!!resumed?.complete);
  // 自チームの指名を打ち切ったか。⚠ 打ち切っても**他球団の指名は最後まで続ける**
  //    （以前は「指名終了」でドラフト全体を締めていたため、全球団が9〜10人・
  //    捕手0人のまま開幕し、自チームは打順が組めず1日も進められなかった）。
  const [userDone, setUserDone] = useState(() => !!resumed?.userDone);
  // 行を押したら「選んだ」だけにして、「指名する」で決める（2段）。
  // ⚠ 以前は行を押した瞬間に指名が確定し、取り消せなかった。表は行ごと押せる作りなので
  //    詳細を見ようとした・スクロールしようとしただけで指名が決まっていた
  const [pendingPick, setPendingPick] = useState(null);
  // 直前の自分の指名を取り消すための写し（1人ぶんだけ）。指名の結果は finalizeDraft まで
  // TEAMS_DATA に書かないので、state を指名の直前に戻せばそのまま取り消せる。
  // 取り消すと、その後のほかの球団の指名もやり直しになる
  const [undoSnap, setUndoSnap] = useState(null);
  // 「指名終了」を押したあとの確認の帯を出しているか（指名の帯と同じ形で決める）
  const [confirmEnd, setConfirmEnd] = useState(false);
  const candidatesGeneratedRef = useRef(!!resumed);
  // 途中で保存している最中か。⚠ 保存のあいだはほかの球団の指名を止める
  //    （保存は圧縮を待つ間に中身を読むので、そのあいだに指名が進むと書き終える前の状態と混ざる）
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState(null);

  // 途中の状態を seasonData に写す（保存・オートセーブ・緊急保存がそのまま持っていく）。
  // ⚠ 取り消しで state を巻き戻したときも、ここで巻き戻した状態が写る（保存と食い違わない）。
  //    終えたら呼ぶ側（ManagementScreen・GameFlowScreens）が `withoutTryoutDraft` で外す
  useEffect(() => {
    if (!setSeasonData || draftOrder.length === 0) return;
    const draft = packTryoutDraft({
      year: tryoutYear, initial: isInitialTryout,
      candidates: tryoutCandidates, draftOrder, currentPick, draftHistory,
      teamRosters, userRoster, userDone, complete: draftComplete,
    });
    setSeasonData(prev => (prev ? { ...prev, tryoutDraft: draft } : prev));
  }, [setSeasonData, tryoutYear, isInitialTryout, tryoutCandidates, draftOrder, currentPick, draftHistory, teamRosters, userRoster, userDone, draftComplete]);

  const getPositionName = (position) => POSITION_NAMES_FULL[position] || position;

  const getPositionCategory = (position) => {
    if (position === 'pitcher') return 'pitcher';
    if (position === 'catcher') return 'catcher';
    if (['first', 'second', 'third', 'short'].includes(position)) return 'infielder';
    if (['left', 'center', 'right'].includes(position)) return 'outfielder';
    return 'all';
  };

  useEffect(() => {
    if (candidatesGeneratedRef.current || tryoutCandidates.length > 0) return;
    candidatesGeneratedRef.current = true;

    const year = tryoutYear;
    const teamCount = seasonData?.settings?.teamsCount || Object.keys(allTeams).length || 4;
    const preset = seasonData?.settings?.preset;
    const leagueDef = preset ? INDEPENDENT_LEAGUES[preset] : null;
    // 現在の自リーグ格＝所属チームの現ランクの最頻値（優勝で昇格すると受験者の質も上がる）。
    // 日程画面の「独立リーグ状況」に出るランク表示と同じ算出を共有する。
    const leagueTeamNamesForRank = Array.isArray(allTeams) ? allTeams : Object.keys(allTeams);
    const ilRank = getLeagueRankFromTeams(leagueTeamNamesForRank)
      || (leagueDef ? (leagueDef.teams?.[0]?.rank || 'B') : null);
    // リーグ注目度: 所属チームのdevelopmentReputation平均（プロ輩出で上昇）
    const leagueTeamNames = Array.isArray(allTeams) ? allTeams : Object.keys(allTeams);
    const repVals = leagueTeamNames.map(n => TEAMS_DATA[n]?.developmentReputation).filter(v => typeof v === 'number');
    const leagueReputation = repVals.length ? repVals.reduce((a, b) => a + b, 0) / repVals.length : 0;
    let candidates = generateTryoutCandidates(year, teamCount, isInitialTryout, ilRank, leagueReputation);
    if (!isInitialTryout) {
      candidates = applyReputationBonus(candidates, allTeams);
    }
    setTryoutCandidates(candidates);

    const teamsArray = Array.isArray(allTeams) ? allTeams : Object.keys(allTeams);
    let teamNames = ['ユーザー', ...teamsArray.slice(1)];

    if (!isInitialTryout && seasonData?.standings?.length > 0) {
      const standingsSorted = [...seasonData.standings].sort((a, b) => a.winRate - b.winRate);
      teamNames = standingsSorted.map(s => {
        return s.team === teamsArray[0] ? 'ユーザー' : s.team;
      });
    }

    const rounds = isInitialTryout ? 24 : Math.min(24, Math.floor(candidates.length / teamNames.length));
    const order = generateSnakeDraftOrder(teamNames, rounds);
    setDraftOrder(order);
  }, [seasonData, allTeams, tryoutCandidates.length, isInitialTryout, tryoutYear]);

  const handleSelectPlayer = (player) => {
    if (currentPick >= draftOrder.length) {
      alert('ドラフトは終了しました');
      return;
    }
    const currentTeam = draftOrder[currentPick].team;
    if (currentTeam === 'ユーザー') {
      const teamsArray = Array.isArray(allTeams) ? allTeams : Object.keys(allTeams);
      const actualTeamName = teamsArray[0];
      setUndoSnap({ player, currentPick, tryoutCandidates, userRoster, teamRosters, draftHistory });
      setPendingPick(null);
      setDraftHistory(prev => [...prev, {
        pick: currentPick + 1,
        round: draftOrder[currentPick].round,
        team: actualTeamName,
        player: player
      }]);
      setUserRoster([...userRoster, player]);
      setTeamRosters({
        ...teamRosters,
        [currentTeam]: [...(teamRosters[currentTeam] || []), player]
      });
      setTryoutCandidates(tryoutCandidates.filter(c => c.id !== player.id));
      setCurrentPick(currentPick + 1);
    }
  };

  // 直前の自分の指名を取り消す（その後のほかの球団の指名も巻き戻る）
  const undoLastPick = () => {
    if (!undoSnap || saving || draftComplete || draftFinalizedRef.current) return;
    setTryoutCandidates(undoSnap.tryoutCandidates);
    setUserRoster(undoSnap.userRoster);
    setTeamRosters(undoSnap.teamRosters);
    setDraftHistory(undoSnap.draftHistory);
    setCurrentPick(undoSnap.currentPick);
    setPendingPick(undoSnap.player);
    setUndoSnap(null);
    // ⚠ 「指名を終えますか？」の帯も落とす。残すと、取り消しで出る指名の帯を「やめる」で閉じたときに
    //    押していない終える帯が戻り、取り消しで足りなくなった編成のまま指名を終えられた
    setConfirmEnd(false);
  };

  useEffect(() => {
    if (saving) return;
    if (currentPick >= draftOrder.length || tryoutCandidates.length === 0) return;
    const currentTeam = draftOrder[currentPick].team;
    if (currentTeam === 'ユーザー' && userDone) {
      const t = setTimeout(() => {
        setDraftHistory(prev => [...prev, {
          pick: currentPick + 1,
          round: draftOrder[currentPick].round,
          team: (Array.isArray(allTeams) ? allTeams : Object.keys(allTeams))[0],
          player: null,
          skipped: true,
          reason: '指名終了'
        }]);
        setCurrentPick(currentPick + 1);
      }, 50);
      return () => clearTimeout(t);
    }
    if (currentTeam !== 'ユーザー') {
      // ⚠ タイマーは必ず片付けること。取り消しで state を巻き戻したときに、
      //    古い番号のまま走る指名が残ると同じ順番が2度進む
      const t = setTimeout(() => {
        const existingCount = TEAMS_DATA[currentTeam]?.players?.length || 0;
        const draftedCount = (teamRosters[currentTeam] || []).length;
        if (existingCount + draftedCount >= 24) {
          setDraftHistory(prev => [...prev, {
            pick: currentPick + 1,
            round: draftOrder[currentPick].round,
            team: currentTeam,
            player: null,
            skipped: true,
            reason: 'ロスター満員'
          }]);
          setCurrentPick(currentPick + 1);
          return;
        }
        const currentTeamRoster = teamRosters[currentTeam] || [];
        // チーム状況（前年勝率）: 再建/優勝狙いで指名方針が変わる
        const standing = seasonData?.standings?.find(s => s.team === currentTeam);
        const teamContext = { winRate: standing ? (standing.winRate ?? 0.5) : 0.5 };
        const selected = selectPlayerForAI(tryoutCandidates, currentTeamRoster, teamContext);
        if (selected) {
          setDraftHistory(prev => [...prev, {
            pick: currentPick + 1,
            round: draftOrder[currentPick].round,
            team: currentTeam,
            player: selected
          }]);
          setTeamRosters(prev => ({
            ...prev,
            [currentTeam]: [...(prev[currentTeam] || []), selected]
          }));
          setTryoutCandidates(tryoutCandidates.filter(c => c.id !== selected.id));
          setCurrentPick(currentPick + 1);
        } else {
          setCurrentPick(currentPick + 1);
        }
      }, 500);
      return () => clearTimeout(t);
    }
  }, [currentPick, draftOrder, tryoutCandidates, teamRosters, userDone, saving]);

  // 自チームの編成（現有＋今回の指名）。「現在の編成」「おすすめ候補」「指名終了」の判定はどれもこれで数える。
  // ⚠ 指名が終わると指名した選手は名簿（TEAMS_DATA）にも入る。現有からは除いて数える
  //    （除かないと「現有23＋指名1」のように二重に数えていた）。
  // ⚠ おすすめ候補は以前、今回の指名（userRoster）だけを数えていて、名簿が足りている年末の
  //    トライアウトでも全区分が「0/10・0/2・0/6・0/6」の赤で出ていた
  const userComposition = () => {
    const teamsArray = Array.isArray(allTeams) ? allTeams : Object.keys(allTeams);
    const picked = new Set(userRoster.map(p => p.id));
    const existing = (TEAMS_DATA[teamsArray[0]]?.players || []).filter(p => !picked.has(p.id));
    const players = [...existing, ...userRoster];
    const counts = { pitcher: 0, catcher: 0, infielder: 0, outfielder: 0 };
    players.forEach(p => {
      const category = getPositionCategory(p.position);
      if (category in counts) counts[category]++;
    });
    return { players, existing: existing.length, picked: userRoster.length, counts };
  };

  // 試合に出られる最低限の構成か（投手1・捕手1・野手8、DH制なら野手9）。足りないものを
  // 「編成不足」の帯と同じ言い方（「〜があとN人必要」）で返す。
  // ⚠ 人数だけで見ないこと。9人でも捕手がいない・野手が足りないと、
  //    日程画面の「スタメンを自動補完できませんでした」で1日も進めなくなる。
  const getUserShortage = () => {
    const { players } = userComposition();
    const pitchers = players.filter(p => p.position === 'pitcher').length;
    const catchers = players.filter(p => p.position === 'catcher').length;
    const fielders = players.length - pitchers;
    const needFielders = seasonData?.settings?.useDH ? 9 : 8;
    const missing = [];
    if (pitchers < 1) missing.push('投手があと1人必要');
    if (catchers < 1) missing.push('捕手があと1人必要');
    if (fielders < needFielders) missing.push(`野手があと${needFielders - fielders}人必要`);
    return missing;
  };
  // 指名を終えられないか（足りないものがあり、まだ候補がいる）。候補がいなければ足りなくても終えられる
  const isEndBlocked = () => getUserShortage().length > 0 && tryoutCandidates.length > 0;

  // 途中で保存する（ロードするとこの続きから指名できる。途中の状態は seasonData.tryoutDraft）。
  // ⚠ 名簿へ書き終えたあとは保存しない（書き終えた名簿と「途中」の写しが食い違う）
  const saveMidway = async (slotIndex) => {
    if (!onSave || saving || draftFinalizedRef.current) return;
    if (saveSlots?.[slotIndex] && !window.confirm(`スロット${slotIndex + 1}を上書きします。よろしいですか？（上書き前のデータは「1つ前のセーブに戻す」で戻せます）`)) return;
    setSaving(true);
    setSaveNote(null);
    try {
      const result = await onSave(slotIndex);
      setSaveNote(result?.success
        ? { ok: true, text: `スロット${slotIndex + 1}に保存しました。ロードするとこの続きから指名できます` }
        : { ok: false, text: result?.error || '保存できませんでした' });
    } catch (e) {
      setSaveNote({ ok: false, text: `保存できませんでした: ${e.message}` });
    } finally {
      setSaving(false);
    }
  };

  // ⚠ 足りないあいだは「指名終了」を押せなくして、理由をボタンの横に出す（以前は押すと alert で断り、
  //    言い方も「編成不足」の帯と違っていた）。ここと帯の「指名を終える」でも見直す
  const endUserPicks = () => {
    if (isEndBlocked()) return;
    setPendingPick(null);
    setConfirmEnd(true);
  };
  const confirmEndUserPicks = () => {
    setConfirmEnd(false);
    if (isEndBlocked()) return;
    setUserDone(true);
  };

  const finalizeDraft = (skipCheck = false) => {
    if (draftFinalizedRef.current || draftComplete) return;
    const teamsArrayForSave = Array.isArray(allTeams) ? allTeams : Object.keys(allTeams);

    if (!skipCheck) {
      const userTeamName = teamsArrayForSave[0];
      const userDrafted = teamRosters['ユーザー'] || [];
      const existingPlayers = TEAMS_DATA[userTeamName]?.players || [];
      const totalPlayers = existingPlayers.length + userDrafted.length;
      if (totalPlayers < 9) {
        if (tryoutCandidates.length === 0) {
          if (!window.confirm(`チームの合計人数が${totalPlayers}人です（最低9人必要）。\n候補選手がいないため、このまま続行します。`)) return;
        } else {
          alert(`チームの合計人数が${totalPlayers}人です。試合に必要な最低9人になるまで指名を続けてください。`);
          return;
        }
      }
    }

    draftFinalizedRef.current = true;

    const allDraftedIds = [];
    const allDraftedPlayers = [];
    const draftYear = isInitialTryout ? 1 : (seasonData?.year || 1);
    Object.keys(teamRosters).forEach(teamName => {
      const draftedPlayers = teamRosters[teamName] || [];
      const actualTeamName = teamName === 'ユーザー' ? teamsArrayForSave[0] : teamName;
      if (TEAMS_DATA[actualTeamName]) {
        const existingIds = new Set((TEAMS_DATA[actualTeamName].players || []).map(p => p.id));
        const newPlayers = draftedPlayers.filter(p => !existingIds.has(p.id));
        newPlayers.forEach(p => {
          const historyEntry = draftHistory.find(h => h.player?.id === p.id);
          p.draftInfo = {
            year: draftYear,
            round: historyEntry?.round || 0
          };
          if (!p.careerHistory) p.careerHistory = [];
          p.careerHistory.push({ type: 'independent', year: draftYear, label: actualTeamName });
        });
        TEAMS_DATA[actualTeamName].players = [
          ...(TEAMS_DATA[actualTeamName].players || []),
          ...newPlayers
        ];
      }
      draftedPlayers.forEach(p => { allDraftedIds.push(p.id); allDraftedPlayers.push(p); });
    });
    // 解雇プールを更新（再獲得された選手は削除、不指名は年齢+1・能力減衰）
    if (!isInitialTryout) {
      updateReleasedPoolAfterTryout(allDraftedIds);
      // 高校生プール・大学プールから指名者を除去（オフシーズン振り分けとの二重計上を防止）
      removeDraftedFromGraduatePools(allDraftedIds, allDraftedPlayers);
      // クラブチームから指名者を除去（同一選手の二重所属を防止）
      removeDraftedFromClubTeams(allDraftedIds);
    }
    if (initializeAllPitchingRotations) initializeAllPitchingRotations();
    setDraftComplete(true);
    if (isInitialTryout && onComplete) {
      setTimeout(() => onComplete(), 1000);
    }
  };

  useEffect(() => {
    if ((currentPick >= draftOrder.length || tryoutCandidates.length === 0) && draftOrder.length > 0 && !draftComplete) {
      finalizeDraft(false);
    }
  }, [currentPick, draftOrder.length, draftComplete, tryoutCandidates.length, teamRosters]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const getSortIndicator = (key) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

  // 選手の所属（出身・前所属）を返す
  const getAffiliation = (p) => {
    if (p._tryoutSource === 'club') return p._previousClub || 'クラブ';
    if (p._tryoutSource === 'university') return p.universityTeamName || p.universityName || '大学';
    if (p._tryoutSource === 'highschool') return p.highSchool?.name || '高校';
    if (p.isReleasedCandidate) return p.previousTeam || '自由契約';
    if (p.highSchool?.name) return p.highSchool.name;
    const last = p.careerHistory?.length ? p.careerHistory[p.careerHistory.length - 1].label : null;
    return last || '—';
  };

  const getFielderOverall = (p) => {
    return Math.round(((p.batting?.meet||0) + (p.batting?.power||0) + (p.physical?.speed||0) + (p.physical?.arm||0) + (p.fielding?.defense||0)) / 5);
  };
  const getPitcherOverall = (p) => {
    const vel = ((p.pitching?.velocity||130) - 115) * 2.5;
    const ctrl = p.pitching?.control || 50;
    const sta = (p.pitching?.stamina || 100) / 2;
    return Math.round((vel + ctrl + sta) / 3);
  };

  const getSortValue = (p, key) => {
    switch(key) {
      case 'name': return p.name;
      case 'age': return p.age || 20;
      case 'position': return getPositionSortIndex(p.position);
      case 'meet': return p.batting?.meet || 0;
      case 'power': return p.batting?.power || 0;
      case 'speed': return p.physical?.speed || 0;
      case 'arm': return p.physical?.arm || 0;
      case 'defense': return p.fielding?.defense || 0;
      case 'velocity': return p.pitching?.velocity || 0;
      case 'control': return p.pitching?.control || 0;
      case 'stamina': return p.pitching?.stamina || 0;
      case 'spinRate': return p.pitching?.spinRate ?? 50;
      case 'mental': return mentalScore(p);
      case 'fielderOverall': return getFielderOverall(p);
      case 'pitcherOverall': return getPitcherOverall(p);
      case 'overall': default: {
        const isPitcher = p.position === 'pitcher';
        return isPitcher ? getPitcherOverall(p) : getFielderOverall(p);
      }
    }
  };

  const filteredCandidates = tryoutCandidates
    .filter(player => {
      if (positionTab !== 'all') {
        const category = getPositionCategory(player.position);
        if (category !== positionTab) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      const dir = sortDir === 'desc' ? -1 : 1;
      if (typeof aVal === 'string') return dir * aVal.localeCompare(bVal);
      return dir * (aVal - bVal);
    });

  const currentTeam = currentPick < draftOrder.length ? draftOrder[currentPick].team : null;
  const isUserTurn = currentTeam === 'ユーザー' && !userDone;
  // 内部キー 'ユーザー' を画面に出さない（自分のチーム名で表示する）
  const teamLabel = (t) => {
    if (t !== 'ユーザー') return t;
    const names = Array.isArray(allTeams) ? allTeams : Object.keys(allTeams || {});
    return names[0] || 'あなたのチーム';
  };

  const showPickBar = isUserTurn && !!pendingPick && tryoutCandidates.some(c => c.id === pendingPick.id);
  const endShortage = isUserTurn ? getUserShortage() : [];
  const endBlocked = endShortage.length > 0 && tryoutCandidates.length > 0;
  const composition = userComposition();

  return (
    <div className="p-4">
      <div className="max-w-7xl mx-auto">
        {/* ⚠ 地色（明るい紙）の上の見出しは text-ink。カード（rounded-xl）は不透明な bg-surface-2 */}
        <h1 className="text-xl font-bold text-ink mb-1">トライアウト</h1>
        <p className="text-ink-sub text-sm mb-3">ドラフト形式で選手を指名してロスターを編成してください</p>

        <TutorialHint id="tryout-intro" title="選手を指名してチームを作る">
          自分の番になったら候補から1人ずつ指名します。<b className="text-cyan-200">投手・捕手・内野・外野をバランス良く</b>集めましょう（不足があれば警告が出ます）。若くて<b className="text-cyan-200">将来性（伸びしろ）</b>の高い選手を獲ると、育成で化ける可能性があります。候補の ⓘ で詳細能力を確認できます。
        </TutorialHint>

        {/* ⚠ 1280×720 で候補の表が画面の外から始まらないよう、上の枠は縦を詰める
            （以前は1人指名すると表の見出しが y=705 まで下がっていた）。途中で保存はピックの数字の右、
            取り消し・指名終了は「あなたの指名順です」の行に並べ、現在の編成は1行にまとめる */}
        <div className="bg-surface-2 rounded-xl border border-gray-700/50 px-5 py-4 mb-4">
          <div className="flex flex-wrap items-start gap-x-10 gap-y-3 text-white">
            <div>
              <div className="text-xs text-gray-300 mb-0.5">現在のピック</div>
              <div className="text-2xl font-bold">{currentPick + 1} / {draftOrder.length}</div>
            </div>
            <div className="min-w-0 max-w-[22rem]">
              <div className="text-xs text-gray-300 mb-0.5">指名チーム</div>
              <div className="text-2xl font-bold truncate" title={currentTeam ? teamLabel(currentTeam) : undefined}>{currentTeam ? teamLabel(currentTeam) : '終了'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-300 mb-0.5">獲得選手数</div>
              <div className="text-2xl font-bold">{userRoster.length} 人</div>
            </div>
            {/* 途中で保存。⚠ この画面ではサイドバー（セーブ＆ロード）を出さないので、ここが唯一の入口 */}
            {onSave && !draftComplete && (
              <div className="ml-auto max-w-full" data-testid="tryout-save">
                <div className="text-xs text-gray-300 mb-1">途中で保存（ロードするとこの続きから指名できます）</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[0, 1, 2].map(i => {
                    const info = saveSlots?.[i];
                    return (
                      <button key={i} onClick={() => saveMidway(i)} disabled={saving}
                        title={info ? `スロット${i + 1}（${info.year}年目 ${info.date?.month}/${info.date?.day} の保存）を上書きします` : `スロット${i + 1}（空き）に保存します`}
                        className="btn-secondary px-2.5 py-1 rounded-lg text-xs whitespace-nowrap">
                        スロット{i + 1}に保存
                        <span className="ml-1 font-normal opacity-80">
                          {info ? `（${info.year}年目 ${info.date?.month}/${info.date?.day}）` : '（空き）'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {saving && <div className="mt-1 text-xs text-gray-300">保存中…（そのあいだ指名は止まります）</div>}
                {!saving && saveNote && (
                  <div className={`mt-1 text-xs font-bold ${saveNote.ok ? 'text-green-400' : 'text-red-400'}`}>{saveNote.text}</div>
                )}
              </div>
            )}
          </div>
          {(currentTeam || (!draftComplete && (userDone || undoSnap))) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              {isUserTurn && (
                <div className="text-green-400 font-semibold text-sm">
                  あなたの指名順です。候補の行を押して選び、「指名する」で決めてください。
                </div>
              )}
              {!isUserTurn && currentTeam && (
                <div className="text-yellow-400 text-sm">
                  {teamLabel(currentTeam)} が選択中...
                </div>
              )}
              {!draftComplete && userDone && (
                <div className="text-gray-300 text-sm">
                  自チームの指名は終えました。他球団の指名が終わるまでお待ちください。
                </div>
              )}
              {!draftComplete && !userDone && undoSnap && (
                <button
                  onClick={undoLastPick}
                  className="btn-secondary px-4 py-1.5 rounded-lg text-sm"
                  title="ほかの球団がその後に指名した分も、やり直しになります"
                >
                  ↩ 直前の指名（{undoSnap.player.name}）を取り消す
                </button>
              )}
              {!draftComplete && isUserTurn && (userRoster.length > 0 || !isInitialTryout) && (
                <>
                  <button
                    onClick={endUserPicks}
                    disabled={endBlocked}
                    className="btn-secondary px-5 py-1.5 rounded-lg font-semibold transition text-sm"
                  >
                    指名終了
                  </button>
                  {/* 足りないあいだは押せない。理由は「編成不足」の帯と同じ言い方で横に出す */}
                  {endBlocked && (
                    <span className="text-xs text-yellow-400" data-testid="tryout-end-blocked">
                      試合に出る最低限がそろうまで終えられません（{endShortage.join(' / ')}）
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          {draftComplete && (
            <div className="mt-3">
              <div className="text-green-400 font-semibold mb-3">
                ドラフト完了 - 各チームの選手がロスターに追加されました
              </div>
              {/* 初回は書き終えると自動で次へ進む。書き終えたところで保存したもの（緊急保存）を
                  ロードしたときだけ、自動では進まないのでボタンを出す */}
              {(!isInitialTryout || resumed?.complete) && onComplete && (
                <button
                  onClick={() => onComplete()}
                  className="btn-primary px-5 py-2 rounded-lg font-semibold transition text-sm"
                >
                  トライアウト終了 →
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-1.5 mb-3 bg-surface-2 rounded-xl p-1 border border-gray-700/50">
          {[
            { key: 'draft', label: 'ドラフト' },
            { key: 'roster', label: '現有戦力' },
            { key: 'history', label: '指名結果' },
            { key: 'details', label: '詳細' }
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setViewTab(key)}
              className={`flex-1 px-4 py-1.5 rounded-lg text-sm font-semibold transition ${
                viewTab === key ? 'seg-on' : 'seg'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 現在の編成（現有＋指名）。⚠ 指名する前から出す（名簿が足りているか、まず分かるように）。1行にまとめる */}
        {viewTab === 'draft' && (() => {
          const { counts, existing, picked } = composition;
          const total = existing + picked;
          const getStatusIcon = (current, min, ideal) => {
            if (current >= ideal) return '✅';
            if (current >= min) return '🟡';
            return '🔴';
          };
          const shortages = [];
          if (counts.pitcher < 5) shortages.push(`投手があと${5 - counts.pitcher}人必要`);
          if (counts.catcher < 1) shortages.push('捕手が不足');
          if (counts.infielder < 4) shortages.push(`内野手があと${4 - counts.infielder}人必要`);
          if (counts.outfielder < 3) shortages.push(`外野手があと${3 - counts.outfielder}人必要`);
          return (
            <div className="bg-surface-2 rounded-xl border border-gray-700/50 px-4 py-2.5 mb-3" data-testid="tryout-composition">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <h3 className="text-white font-bold">
                  現在の編成 ({total}/24人)
                  {existing > 0 && <span className="text-gray-300 text-xs font-normal ml-1">（現有{existing}＋指名{picked}）</span>}
                </h3>
                {[['投手', counts.pitcher, 5, 10], ['捕手', counts.catcher, 1, 2], ['内野手', counts.infielder, 4, 6], ['外野手', counts.outfielder, 3, 6]].map(([label, n, min, ideal]) => (
                  <span key={label} className="text-gray-300 whitespace-nowrap">
                    {label} <span className="text-white font-bold">{getStatusIcon(n, min, ideal)} {n}/{ideal}</span>
                  </span>
                ))}
              </div>
              {shortages.length > 0 && (
                <div className="mt-1.5 flex items-start gap-2 text-xs">
                  <span className="text-red-400 font-bold shrink-0">!</span>
                  <div className="text-red-400">
                    <span className="font-bold">編成不足: </span>
                    {shortages.join(' / ')}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {viewTab === 'roster' && (
          <div className="bg-surface-2 rounded-xl border border-gray-700/50 p-5 mb-5">
            <h2 className="text-lg font-bold text-white mb-4">現有戦力一覧</h2>
            {(() => {
              const teamsArray = Array.isArray(allTeams) ? allTeams : Object.keys(allTeams);
              const userTeamName = teamsArray[0];
              const existingPlayers = TEAMS_DATA[userTeamName]?.players || [];
              const total = existingPlayers.length + userRoster.length;
              const positionCounts = { pitcher: 0, catcher: 0, infielder: 0, outfielder: 0 };
              existingPlayers.forEach(p => {
                const category = getPositionCategory(p.position);
                if (category in positionCounts) positionCounts[category]++;
              });
              userRoster.forEach(p => {
                const category = getPositionCategory(p.position);
                if (category in positionCounts) positionCounts[category]++;
              });
              return (
                <>
                  <div className="bg-gray-700 rounded-lg p-4 mb-4">
                    <div className="text-white font-bold text-lg mb-2">
                      {userTeamName} - 現在 {existingPlayers.length}人 + ドラフト {userRoster.length}人 = 合計 {total}人
                    </div>
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      <div className="bg-gray-600 rounded p-2 text-center">
                        <div className="text-sm text-gray-300">投手</div>
                        <div className="text-white font-bold">{positionCounts.pitcher}人</div>
                      </div>
                      <div className="bg-gray-600 rounded p-2 text-center">
                        <div className="text-sm text-gray-300">捕手</div>
                        <div className="text-white font-bold">{positionCounts.catcher}人</div>
                      </div>
                      <div className="bg-gray-600 rounded p-2 text-center">
                        <div className="text-sm text-gray-300">内野手</div>
                        <div className="text-white font-bold">{positionCounts.infielder}人</div>
                      </div>
                      <div className="bg-gray-600 rounded p-2 text-center">
                        <div className="text-sm text-gray-300">外野手</div>
                        <div className="text-white font-bold">{positionCounts.outfielder}人</div>
                      </div>
                    </div>
                    {total > 24 && (
                      <div className="text-red-400 text-sm mt-2">⚠️ ロスター上限(24人)を超えています。トライアウト後に解雇が必要です。</div>
                    )}
                  </div>
                  {existingPlayers.length > 0 ? (
                    <div className="space-y-4">
                      {['pitcher', 'catcher', 'infielder', 'outfielder'].map(category => {
                        const categoryPlayers = existingPlayers.filter(p => getPositionCategory(p.position) === category);
                        if (categoryPlayers.length === 0) return null;
                        const categoryLabels = { pitcher: '投手', catcher: '捕手', infielder: '内野手', outfielder: '外野手' };
                        return (
                          <div key={category}>
                            <h3 className="text-white font-bold mb-2 text-sm border-b border-gray-600 pb-1">{categoryLabels[category]} ({categoryPlayers.length}人)</h3>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs text-left">
                                <thead className="bg-gray-600 text-gray-300">
                                  <tr>
                                    <th className="px-2 py-1">名前</th>
                                    <th className="px-2 py-1">年齢</th>
                                    <th className="px-2 py-1">守備</th>
                                    <th className="px-2 py-1">ミ</th>
                                    <th className="px-2 py-1">パ</th>
                                    <th className="px-2 py-1">走</th>
                                    <th className="px-2 py-1">肩</th>
                                    <th className="px-2 py-1">守</th>
                                    <th className="px-2 py-1">速</th>
                                    <th className="px-2 py-1">制</th>
                                    <th className="px-2 py-1">ス</th>
                                    <th className="px-2 py-1">回転</th>
                                    <th className="px-2 py-1" title="プロ意識・度胸をまとめた大雑把な評価。成長を最も左右するが、正確には見抜けない">精神</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {categoryPlayers.map(player => (
                                    <tr key={player.id} className="border-b border-gray-700">
                                      <td className="px-2 py-1 text-white font-bold">{player.name}</td>
                                      <td className="px-2 py-1 text-gray-300">{player.age || '?'}</td>
                                      <td className="px-2 py-1 text-gray-300">{getPositionName(player.position)}</td>
                                      <td className={`px-2 py-1 ${getRankColor(getAbilityRank(player.batting?.meet||0))}`}>{getAbilityRank(player.batting?.meet||0)}</td>
                                      <td className={`px-2 py-1 ${getRankColor(getAbilityRank(player.batting?.power||0))}`}>{getAbilityRank(player.batting?.power||0)}</td>
                                      <td className={`px-2 py-1 ${getRankColor(getAbilityRank(player.physical?.speed||0))}`}>{getAbilityRank(player.physical?.speed||0)}</td>
                                      <td className={`px-2 py-1 ${getRankColor(getAbilityRank(player.physical?.arm||0))}`}>{getAbilityRank(player.physical?.arm||0)}</td>
                                      <td className={`px-2 py-1 ${getRankColor(getAbilityRank(player.fielding?.defense||0))}`}>{getAbilityRank(player.fielding?.defense||0)}</td>
                                      <td className={`px-2 py-1 ${getRankColor(getAbilityRank(player.pitching?.velocity||0, true))}`}>{getAbilityRank(player.pitching?.velocity||0, true)}</td>
                                      <td className={`px-2 py-1 ${getRankColor(getAbilityRank(player.pitching?.control||0))}`}>{getAbilityRank(player.pitching?.control||0)}</td>
                                      <td className={`px-2 py-1 ${getRankColor(getAbilityRank(player.pitching?.stamina||0, false, true))}`}>{getAbilityRank(player.pitching?.stamina||0, false, true)}</td>
                                      <td className={`px-2 py-1 ${getRankColor(getAbilityRank(player.pitching?.spinRate??50))}`}>{getAbilityRank(player.pitching?.spinRate??50)}</td>
                                      <td className={`px-2 py-1 font-bold ${getRankColor(getMentalGrade(player))}`}>{getMentalGrade(player)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-gray-300 text-center py-8">現有選手はいません（初回トライアウト）</div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {viewTab === 'history' && (
          <div className="bg-surface-2 rounded-xl border border-gray-700/50 p-5 mb-5">
            <h2 className="text-lg font-bold text-white mb-4">ドラフト指名結果</h2>
            {draftHistory.length > 0 ? (
              <div className="space-y-1 max-h-[520px] overflow-y-auto">
                {draftHistory.map((entry, index) => {
                  const teamsArray = Array.isArray(allTeams) ? allTeams : Object.keys(allTeams);
                  const isUserTeam = entry.team === teamsArray[0];
                  if (entry.skipped) {
                    return (
                      <div key={index} className="flex items-center gap-3 p-2 rounded bg-gray-800/50 opacity-60">
                        <span className="text-gray-400 font-bold w-24 shrink-0">ドラフト{entry.round}位</span>
                        <span className="text-gray-400 w-24 shrink-0">---</span>
                        <span className="text-gray-400 w-16 shrink-0">{entry.reason}</span>
                        <span className="text-gray-400">{teamLabel(entry.team)}</span>
                      </div>
                    );
                  }
                  const positionLabel = entry.player.position === 'pitcher' ? '投手' :
                    entry.player.position === 'catcher' ? '捕手' :
                    ['first', 'second', 'third', 'short'].includes(entry.player.position) ? '内野手' : '外野手';
                  return (
                    <div
                      key={index}
                      className={`flex items-center gap-3 p-2 rounded ${isUserTeam ? 'bg-blue-900/50' : 'bg-gray-700/50'}`}
                    >
                      <span className="text-yellow-400 font-bold w-24 shrink-0">ドラフト{entry.round}位</span>
                      <span className="text-white font-bold w-24 shrink-0">{entry.player.name}</span>
                      <span className="text-gray-300 w-16 shrink-0">{positionLabel}</span>
                      <span className="text-gray-300 w-12 shrink-0">{entry.player.age}歳</span>
                      <span className={`font-bold ${isUserTeam ? 'text-blue-400' : 'text-gray-300'}`}>{teamLabel(entry.team)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-gray-300 text-center py-8">まだ指名がありません</div>
            )}
          </div>
        )}

        {viewTab === 'details' && (
          <div className="space-y-4 mb-6">
            {userRoster.length > 0 && (
              <div className="bg-surface-2 rounded-xl border border-blue-700/50 p-5">
                <h2 className="text-lg font-bold text-white mb-4">あなたのチーム ({userRoster.length}/24人)</h2>
                <div className="space-y-4">
                  {['pitcher', 'catcher', 'infielder', 'outfielder'].map(category => {
                    const categoryPlayers = userRoster.filter(p => getPositionCategory(p.position) === category);
                    if (categoryPlayers.length === 0) return null;
                    const categoryLabels = { pitcher: '投手', catcher: '捕手', infielder: '内野手', outfielder: '外野手' };
                    return (
                      <div key={category}>
                        <h3 className="text-white font-bold mb-2 text-sm border-b border-blue-700 pb-1">{categoryLabels[category]} ({categoryPlayers.length}人)</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                          {categoryPlayers.map(player => (
                            <div key={player.id} className="bg-gray-700 rounded p-2 text-white text-sm">
                              <div className="font-bold">{player.name}</div>
                              <div className="text-xs text-gray-300">{getPositionName(player.position)} | {player.age}歳</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-surface-2 rounded-xl border border-gray-700/50 p-5">
              <h2 className="text-lg font-bold text-white mb-4">各チームのドラフト状況</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.keys(teamRosters).map(teamName => {
                  const roster = teamRosters[teamName] || [];
                  if (roster.length === 0) return null;
                  return (
                    <div key={teamName} className="bg-gray-700 rounded-lg p-4">
                      <h3 className="text-white font-bold mb-2 flex items-center justify-between">
                        <span>{teamLabel(teamName)}</span>
                        <span className="text-sm text-gray-300">{roster.length}人</span>
                      </h3>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {roster.map(player => (
                          <div key={player.id} className="text-sm text-gray-300 flex justify-between">
                            <span>{player.name}</span>
                            <span className="text-gray-400">{getPositionName(player.position)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {viewTab === 'draft' && (
          <>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <div className="flex gap-1 bg-surface-2 rounded-xl p-1 border border-gray-700/50">
                {[
                  { key: 'all', label: '全選手' },
                  { key: 'pitcher', label: '投手' },
                  { key: 'catcher', label: '捕手' },
                  { key: 'infielder', label: '内野手' },
                  { key: 'outfielder', label: '外野手' }
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setPositionTab(tab.key)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
                      positionTab === tab.key ? 'seg-on' : 'seg'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="text-ink-sub text-sm ml-auto">候補者: {filteredCandidates.length} 人</div>
            </div>

            {/* おすすめ候補 */}
            {isUserTurn && (() => {
              // 数え方は「現在の編成」と同じ（現有＋指名）
              const positionCounts = composition.counts;
              const needs = [];
              const mins = { pitcher: { min: 5, ideal: 10 }, catcher: { min: 1, ideal: 2 }, infielder: { min: 4, ideal: 6 }, outfielder: { min: 3, ideal: 6 } };
              const catLabels = { pitcher: '投手', catcher: '捕手', infielder: '内野手', outfielder: '外野手' };
              Object.entries(mins).forEach(([cat, { min, ideal }]) => {
                if (positionCounts[cat] < ideal) {
                  const urgency = positionCounts[cat] < min ? 'critical' : 'want';
                  const best = tryoutCandidates
                    .filter(p => getPositionCategory(p.position) === cat)
                    .sort((a, b) => {
                      const aO = a.position === 'pitcher' ? getPitcherOverall(a) : getFielderOverall(a);
                      const bO = b.position === 'pitcher' ? getPitcherOverall(b) : getFielderOverall(b);
                      return bO - aO;
                    })[0];
                  if (best) needs.push({ cat, urgency, label: catLabels[cat], current: positionCounts[cat], ideal, player: best });
                }
              });
              if (needs.length === 0) return null;
              return (
                <div className="bg-surface-2 rounded-xl border border-gray-700/50 px-3 py-2 mb-3 flex items-center gap-3">
                  <div className="text-xs text-gray-300 font-bold shrink-0">おすすめ候補</div>
                  <div className="flex gap-2 flex-wrap">
                    {needs.map(n => (
                      <div
                        key={n.cat}
                        // ⚠ ここも選ぶだけ（以前はここだけ押した瞬間に指名が決まっていた）
                        onClick={(e) => { if (!isUserTurn) return; setConfirmEnd(false); setPendingPick(n.player); keepAboveConfirmBar(e.currentTarget); }}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition hover:scale-[1.02] ${
                          pendingPick?.id === n.player.id ? 'outline outline-2 outline-cyan-400 ' : ''}${
                          n.urgency === 'critical'
                            ? 'bg-red-900/30 border-red-700/50 hover:bg-red-900/50'
                            : 'bg-blue-900/20 border-blue-700/40 hover:bg-blue-900/40'
                        }`}
                      >
                        <div>
                          <div className={`text-xs font-bold ${n.urgency === 'critical' ? 'text-red-400' : 'text-blue-400'}`}>
                            {n.label} ({n.current}/{n.ideal})
                          </div>
                          <div className="text-white text-xs font-bold">{n.player.name}</div>
                          <div className="text-gray-400 text-xs">
                            {POSITION_NAMES[n.player.position]} {n.player.age}歳
                            {n.player.position === 'pitcher'
                              ? ` ${n.player.pitching?.velocity || 0}km 制${n.player.pitching?.control || 0}`
                              : ` ミ${n.player.batting?.meet || 0} パ${n.player.batting?.power || 0}`
                            }
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="bg-surface-2 rounded-xl border border-gray-700/50 mb-5">
              {/* 1文字の見出しの凡例。title だけでは指で触る端末や、気づかない人には伝わらない */}
              <div className="px-2 py-1.5 text-xs text-gray-300 border-b border-gray-700/50 flex flex-wrap gap-x-4 gap-y-0.5">
                <span><b className="text-gray-100">野</b> 野手としての総合</span>
                <span><b className="text-gray-100">投</b> 投手としての総合</span>
                <span><b className="text-gray-100">精</b> 精神（成長を左右するが正確には分からない）</span>
                <span className="text-gray-400">見出しを押すと並べ替え</span>
              </div>
              <table className="w-full text-xs text-left">
                <thead className="bg-surface-2 text-gray-300 text-xs sticky top-0 border-b border-gray-700/50">
                  <tr>
                    {[
                      { label: '名前', key: 'name', tip: null },
                      { label: '所属', key: null, tip: '出身・前所属チーム' },
                      { label: '齢', key: 'age', tip: '年齢' },
                      { label: '守', key: 'position', tip: 'ポジション' },
                      { label: '投打', key: null, tip: '投球/打席の左右' },
                      { label: 'ミ', key: 'meet', tip: 'ミート（打撃精度）' },
                      { label: 'パ', key: 'power', tip: 'パワー（長打力）' },
                      { label: '走', key: 'speed', tip: '走力' },
                      { label: '肩', key: 'arm', tip: '肩力' },
                      { label: '守', key: 'defense', tip: '守備力' },
                      { label: '速', key: 'velocity', tip: '球速（km/h）' },
                      { label: '制', key: 'control', tip: '制球力' },
                      { label: 'ス', key: 'stamina', tip: 'スタミナ' },
                      { label: '回', key: 'spinRate', tip: '球の回転数' },
                      { label: '精', key: 'mental', tip: '精神（プロ意識・度胸をまとめた大雑把な評価）。成長を最も左右するが正確には見抜けない' },
                      { label: '変化球', key: null, tip: '習得変化球' },
                      { label: '野', key: 'fielderOverall', tip: '野手総合力' },
                      { label: '投', key: 'pitcherOverall', tip: '投手総合力' },
                      { label: 'スカウト評価', key: null, tip: 'スカウトの選手評価' },
                    ].map((col, i) => (
                      // Tooltipでラップすると<tr>直下が<span>になり列がズレるため、
                      // <th>を直接の子にしてツールチップは native title で付ける
                      <th
                        key={i}
                        title={col.tip || undefined}
                        className={`px-1 py-1.5 whitespace-nowrap ${col.key ? 'cursor-pointer hover:text-white' : ''}`}
                        onClick={col.key ? () => handleSort(col.key) : undefined}
                      >
                        {col.label}{col.key ? getSortIndicator(col.key) : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.map((player, idx) => {
                    const throwLabel = player.physical?.throws === 'left' ? '左投' : '右投';
                    const batLabel = player.batting?.bats === 'left' ? '左打' : player.batting?.bats === 'switch' ? '両打' : '右打';
                    const fOverall = getFielderOverall(player);
                    const pOverall = getPitcherOverall(player);
                    const fRank = getAbilityRank(fOverall);
                    const pRank = getAbilityRank(pOverall);
                    return (
                      <tr
                        key={`${player.id}-${idx}`}
                        className={`border-b border-gray-700 ${isUserTurn ? 'cursor-pointer hover:bg-gray-700' : 'opacity-60'} transition ${
                          pendingPick?.id === player.id ? 'bg-cyan-900/70 outline outline-2 -outline-offset-2 outline-cyan-400'
                            : player.isReleasedCandidate ? 'bg-amber-950/30' : ''}`}
                        onClick={(e) => { if (!isUserTurn) return; setConfirmEnd(false); setPendingPick(pendingPick?.id === player.id ? null : player); keepAboveConfirmBar(e.currentTarget); }}
                      >
                        <td className="px-1 py-1 text-white font-bold whitespace-nowrap">
                          <button
                            onClick={(e) => { e.stopPropagation(); setDetailCandidate(player); }}
                            className="mr-1 text-gray-300 hover:text-white align-middle"
                            title="詳細を表示"
                          >ⓘ</button>
                          {player.name}
                          {player.isReleasedCandidate && (
                            <span
                              className="ml-0.5 inline-block px-0.5 text-xs bg-amber-700 text-amber-100 rounded align-middle"
                              title={`前所属: ${player.previousTeam || '不明'} / 解雇 ${player.releasedYear || '?'}年目`}
                            >
                              FA
                            </span>
                          )}
                          {player._tryoutSource === 'highschool' && (
                            <span className="ml-0.5 inline-block px-0.5 text-xs bg-sky-700 text-sky-100 rounded align-middle" title="高校卒業予定">高卒</span>
                          )}
                          {player._tryoutSource === 'university' && (
                            <span className="ml-0.5 inline-block px-0.5 text-xs bg-emerald-700 text-emerald-100 rounded align-middle" title="大学4年生（卒業予定）">大卒</span>
                          )}
                          {player._tryoutSource === 'club' && (
                            <span className="ml-0.5 inline-block px-0.5 text-xs bg-purple-700 text-purple-100 rounded align-middle" title={`クラブチーム${player._previousClub ? '（' + player._previousClub + '）' : ''}`}>クラブ</span>
                          )}
                          {player.isNewcomer && !player.isReleasedCandidate && !player._tryoutSource && (
                            <span className="ml-0.5 inline-block px-0.5 text-xs bg-gray-600 text-gray-100 rounded align-middle" title="新規候補">新人</span>
                          )}
                        </td>
                        <td className="px-1 py-1 text-gray-300 whitespace-nowrap max-w-[8rem] truncate" title={getAffiliation(player)}>{getAffiliation(player)}</td>
                        <td className="px-1 py-1 text-gray-300 text-center whitespace-nowrap">{player.age}</td>
                        <td className="px-1 py-1 text-gray-300 text-center whitespace-nowrap">{POSITION_NAMES[player.position] || player.position}</td>
                        <td className="px-1 py-1 text-gray-300 text-center whitespace-nowrap">{throwLabel}{batLabel}</td>
                        <td className={`px-1 py-1 font-bold text-center ${getRankColor(getAbilityRank(player.batting?.meet||0))}`}>{getAbilityRank(player.batting?.meet||0)}</td>
                        <td className={`px-1 py-1 font-bold text-center ${getRankColor(getAbilityRank(player.batting?.power||0))}`}>{getAbilityRank(player.batting?.power||0)}</td>
                        <td className={`px-1 py-1 font-bold text-center ${getRankColor(getAbilityRank(player.physical?.speed||0))}`}>{getAbilityRank(player.physical?.speed||0)}</td>
                        <td className={`px-1 py-1 font-bold text-center ${getRankColor(getAbilityRank(player.physical?.arm||0))}`}>{getAbilityRank(player.physical?.arm||0)}</td>
                        <td className={`px-1 py-1 font-bold text-center ${getRankColor(getAbilityRank(player.fielding?.defense||0))}`}>{getAbilityRank(player.fielding?.defense||0)}</td>
                        <td className={`px-1 py-1 font-bold text-center ${getRankColor(getAbilityRank(player.pitching?.velocity||0, true))}`}>{getAbilityRank(player.pitching?.velocity||0, true)}</td>
                        <td className={`px-1 py-1 font-bold text-center ${getRankColor(getAbilityRank(player.pitching?.control||0))}`}>{getAbilityRank(player.pitching?.control||0)}</td>
                        <td className={`px-1 py-1 font-bold text-center ${getRankColor(getAbilityRank(player.pitching?.stamina||0, false, true))}`}>{getAbilityRank(player.pitching?.stamina||0, false, true)}</td>
                        <td className={`px-1 py-1 font-bold text-center ${getRankColor(getAbilityRank(player.pitching?.spinRate??50))}`}>{getAbilityRank(player.pitching?.spinRate??50)}</td>
                        <td className={`px-1 py-1 font-bold text-center ${getRankColor(getMentalGrade(player))}`}>{getMentalGrade(player)}</td>
                        <td className="px-1 py-1 text-xs whitespace-nowrap">
                          {(() => {
                            // ⚠ 野手にも球種のデータはあるが、投げない選手に出すと投手に見える。
                            //    投手と二刀流だけに出す
                            if (player.position !== 'pitcher' && !player.isTwoWay) return <span className="text-gray-400">-</span>;
                            const arsenal = (player.pitching?.arsenal || []).filter(a => a.type !== 'straight');
                            if (arsenal.length === 0) return <span className="text-gray-400">-</span>;
                            return arsenal.map((a, i) => {
                              const rank = getAbilityRank(a.level || 0);
                              return <span key={i} className={getRankColor(rank)}>{i > 0 ? '/' : ''}{getPitchTypeName(a.type)}{rank}</span>;
                            });
                          })()}
                        </td>
                        <td className={`px-1 py-1 font-bold text-center ${getRankColor(fRank)}`}>{fRank}</td>
                        <td className={`px-1 py-1 font-bold text-center ${getRankColor(pRank)}`}>{pRank}</td>
                        <td className="px-1 py-1 text-xs leading-tight">
                          {(() => {
                            const comment = player.scoutComment || generateScoutComment(player);
                            const sc = typeof comment === 'string' ? { text: comment, potentialHint: '', potentialLevel: 3 } : comment;
                            const hintColor = sc.potentialLevel >= 5 ? 'text-red-400 font-bold'
                              : sc.potentialLevel >= 4 ? 'text-orange-400 font-bold'
                              : sc.potentialLevel <= 1 ? 'text-blue-400'
                              : sc.potentialLevel <= 2 ? 'text-gray-400'
                              : '';
                            const talentColor = (sc.talentHint || '').includes('線が細') || (sc.talentHint || '').includes('不器用')
                              ? 'text-gray-400' : 'text-emerald-400';
                            return (
                              <span>
                                <span className="text-gray-300">{sc.text}</span>
                                {sc.talentHint && <span className={`ml-0.5 ${talentColor}`}>{sc.talentHint}</span>}
                                {sc.potentialHint && <span className={`ml-0.5 ${hintColor}`}>{sc.potentialHint}</span>}
                              </span>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {userRoster.length > 24 && draftComplete && (
          <div className="mt-6 bg-surface-2 border border-red-700 rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div>
                <div className="text-red-300 font-bold mb-1">ロスター人数が24人を超えています</div>
                <div className="text-red-400 text-sm">ロスター管理画面で{userRoster.length - 24}人を解雇してください</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 選んだ候補を決める帯（ConfirmBar）。画面の下に固定して、表をどこまでスクロールしていても押せる */}
      {showPickBar && (
        <ConfirmBar
          title={`${pendingPick.name} を指名しますか？`}
          detail={`${POSITION_NAMES[pendingPick.position] || pendingPick.position}・${pendingPick.age}歳・${getAffiliation(pendingPick)}`}
          confirmLabel="指名する"
          disabled={saving}
          onConfirm={() => handleSelectPlayer(pendingPick)}
          onCancel={() => setPendingPick(null)}
        />
      )}
      {isUserTurn && !draftComplete && confirmEnd && !showPickBar && !endBlocked && (
        <ConfirmBar
          title="自チームの指名をここで終えますか？"
          detail={`獲得${userRoster.length}人で終えます。ほかの球団の指名は最後まで続きます`}
          note="終えると取り消せません。このトライアウトでは、もう指名できません。"
          confirmLabel="指名を終える"
          confirmClass="btn-warn"
          disabled={saving}
          onConfirm={confirmEndUserPicks}
          onCancel={() => setConfirmEnd(false)}
        />
      )}

      {detailCandidate && (() => {
        const p = detailCandidate;
        const throwLabel = p.physical?.throws === 'left' ? '左投' : '右投';
        const batLabel = p.batting?.bats === 'left' ? '左打' : p.batting?.bats === 'switch' ? '両打' : '右打';
        const srcBadge = p._tryoutSource === 'club' ? { t: 'クラブ', c: 'bg-purple-700 text-purple-100' }
          : p._tryoutSource === 'university' ? { t: '大卒', c: 'bg-emerald-700 text-emerald-100' }
          : p._tryoutSource === 'highschool' ? { t: '高卒', c: 'bg-sky-700 text-sky-100' }
          : p.isReleasedCandidate ? { t: 'FA', c: 'bg-amber-700 text-amber-100' }
          : { t: '新人', c: 'bg-gray-600 text-gray-100' };
        const row = (label, value, opts = {}) => {
          const rank = getAbilityRank(value || 0, !!opts.vel, !!opts.sta);
          return (
            <div className="flex items-center justify-between px-2 py-0.5">
              <span className="text-gray-300 text-xs">{label}</span>
              <span className="flex items-center gap-1.5">
                <span className="text-gray-100 text-sm tabular-nums w-8 text-right">{value ?? '-'}</span>
                <span className={`text-xs font-bold w-4 text-center ${getRankColor(rank)}`}>{rank}</span>
              </span>
            </div>
          );
        };
        const arsenal = (p.pitching?.arsenal || []).filter(a => a.type !== 'straight');
        const fitness = Object.entries(p.positionFitness || {})
          .filter(([pos]) => pos !== 'pitcher')
          .sort((a, b) => b[1] - a[1]).slice(0, 6);
        const gp = p.growthPotential || 1.0;
        const gpColor = gp >= 1.3 ? 'text-pink-400' : gp >= 1.2 ? 'text-red-400' : gp >= 1.1 ? 'text-orange-400' : gp >= 1.0 ? 'text-yellow-400' : gp >= 0.9 ? 'text-green-400' : 'text-blue-400';
        const career = p.careerHistory || [];
        return (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setDetailCandidate(null)}>
            <div className="bg-surface-2 rounded-xl border border-gray-600 max-w-2xl w-full max-h-[85vh] overflow-y-auto p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <span className="text-white font-bold text-lg">{p.name}</span>
                <span className={`text-xs font-bold rounded px-1.5 py-0.5 ${srcBadge.c}`}>{srcBadge.t}</span>
                <span className="text-sm text-gray-300">{POSITION_NAMES[p.position] || p.position} / {p.age}歳 / {throwLabel}{batLabel}</span>
                <button onClick={() => setDetailCandidate(null)} className="ml-auto text-gray-300 hover:text-white text-lg">✕</button>
              </div>

              <div className="text-xs text-gray-300 mb-3">
                <div>
                  <span className="text-gray-300">所属: </span><span className="text-white font-bold">{getAffiliation(p)}</span>
                  {career.filter(c => c.type !== 'achievement').length > 0 && (
                    <>
                      <span className="ml-3 text-gray-300">経歴: </span>
                      {career.filter(c => c.type !== 'achievement').map((c, i) => (
                        <span key={i} className="text-gray-200">{i > 0 ? ' → ' : ''}{c.label}</span>
                      ))}
                    </>
                  )}
                </div>
                {career.some(c => c.type === 'achievement') && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {career.filter(c => c.type === 'achievement').map((c, i) => (
                      <span key={i} className={`rounded px-1.5 py-0.5 ${c.result === '優勝' ? 'bg-yellow-900/50 text-yellow-200 border border-yellow-700/50' : 'bg-surface-2 text-gray-300 border border-gray-600/50'}`}>
                        🏆 {c.grade ? `${c.grade}年時 ` : ''}{c.team ? `${c.team} ` : ''}{c.tournament}{c.result}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div className="bg-gray-900/50 rounded p-2">
                  <div className="text-xs text-blue-300 font-bold mb-1 border-b border-gray-700 pb-1">打撃・走塁・守備</div>
                  {row('ミート', p.batting?.meet)}
                  {row('パワー', p.batting?.power)}
                  {row('選球眼', p.batting?.eye)}
                  {row('走力', p.physical?.speed)}
                  {row('肩力', p.physical?.arm)}
                  {row('守備', p.fielding?.defense)}
                  {row('盗塁', p.batting?.steal)}
                  {p.position === 'catcher' && row('リード', p.catching?.lead)}
                </div>
                <div className="bg-gray-900/50 rounded p-2">
                  <div className="text-xs text-red-300 font-bold mb-1 border-b border-gray-700 pb-1">投球</div>
                  {row('球速', p.pitching?.velocity, { vel: true })}
                  {row('制球', p.pitching?.control)}
                  {row('スタミナ', p.pitching?.stamina, { sta: true })}
                  {row('回転', p.pitching?.spinRate)}
                  <div className="mt-1 pt-1 border-t border-gray-700/60">
                    <div className="text-xs text-gray-300 mb-0.5">変化球</div>
                    <div className="flex flex-wrap gap-1">
                      {arsenal.length === 0 ? <span className="text-gray-400 text-xs">なし</span>
                        : arsenal.map((a, i) => {
                          const rank = getAbilityRank(a.level || 0);
                          return <span key={i} className={`text-xs ${getRankColor(rank)}`}>{getPitchTypeName(a.type)}{rank}</span>;
                        })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs mb-3 px-1">
                <span className="text-gray-300">成長力: <span className={`font-bold ${gpColor}`}>{gp.toFixed(2)}</span></span>
                <span className="text-gray-300">知名度: <span className="text-gray-100 font-bold">{p.fame || 0}</span></span>
                {p.isTwoWay && <span className="text-teal-300 font-bold">二刀流</span>}
              </div>

              {fitness.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs text-gray-300 mb-1">守備適性</div>
                  <div className="flex flex-wrap gap-1.5">
                    {fitness.map(([pos, val]) => (
                      <span key={pos} className={`text-xs px-1.5 py-0.5 rounded bg-gray-900/60 ${getRankColor(getAbilityRank(val))}`}>
                        {POSITION_NAMES[pos] || pos} {val}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(() => {
                const comment = p.scoutComment || generateScoutComment(p);
                const sc = typeof comment === 'string' ? { text: comment } : comment;
                return (
                  <div className="bg-gray-900/50 rounded p-2 text-xs">
                    <div className="text-gray-300 mb-0.5">スカウト所見</div>
                    <span className="text-gray-200">{sc.text}</span>
                    {sc.talentHint && <span className="ml-1 text-emerald-400">{sc.talentHint}</span>}
                    {sc.potentialHint && <span className="ml-1 text-orange-400 font-bold">{sc.potentialHint}</span>}
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default TryoutScreen;
