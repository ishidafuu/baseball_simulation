import { tacticalChance, tacticalPitchLimit, tacticalDamageLimit, STRATEGY_MODS } from '../online/tactics.js';
import { createDecisionLog, observeDecisionLog, decisionsFromResult, recordDecisions } from './pitcherDecisions.js';
import { TEAMS_DATA, LEAGUE_SETTINGS, normalizeMaxExtraInnings } from '../teams-data.js';
import { calculatePhysicsContact, calculateBattedBallPhysics, judgeFielderReach, getTunnelingEffect, getThrowErrorRate, spinAdjustedArsenal } from '../simulation-logic.js';
import { PITCHING_FORM_EFFECTS, adjustGrowthModifier, applyFatigueGrowthPenalty, DP_BASE,
  pitchVelocityDrop, isUnreadablePitch, registeredAsFielder } from '../utils/constants.js';
import { conditionBattingMod, CONDITION_PITCHING_MODIFIER, CONDITION_LEVELS, initializeCondition } from './condition.js';
import { getPositionFitness, getHandednessEffect } from '../utils/physics.js';
import { contactFoulProbability, isDirectionalFoul } from './contactRules.js';
import { getTeamStaffBonus } from '../corporate/staffData.js';
import { callPitchTarget, resolvePitchLocation, decideSwing, ballZoneContactChance, getPitchQualityEffect, getHeightPitchEffect, BALL_ZONE_PENALTY, selectPitchType, infieldDefenseOf, guessSuccessRate } from './pitchCalling.js';
import { getZoneProfile, getZoneMatchupEffect, combineBatterEffects, zoneWeaknessAt } from './batterZone.js';
import { decideSwingPower, getSwingPowerEffect } from './swingType.js';
import { createSequence, pushCall, lastCall, sequenceShift, shiftMeetAdjust, locationReadChance,
  pushSwingQuality, decayFooled, fooledLevel } from './pitchSequence.js';
import { decidePitchObjective } from './pitchSituation.js';
import { hitByPitchChance, hitByPitchFatigue } from './pitchZone.js';
import { getBatterType, resolveAiBatterGuess } from './batterType.js';
import { getDeception, deceptionAxis } from './deception.js';
import { resolveGroundOutAdvance, tryExtraAdvance } from './baserunning.js';
import { stealSuccessRate, stealAttemptRate } from './stealing.js';
import { classifyBuntContact, rollBuntQuality, buntFieldDefense,
         buntThrowOutChance, squeezeHomeThrowChance } from './bunting.js';
import { effectiveArsenalSize, activeArsenal } from './arsenal.js';
import { withSeededRandom } from './rng.js';
import { nextRotationStarterId } from './lineup.js';

// 投手疲労閾値: この値以上の疲労なら先発起用しない
const PITCHER_REST_FATIGUE_THRESHOLD = 40;

// ロール別球数制限
const PITCH_LIMITS = {
  // 先発
  complete: 120, ace: 110, quality: 100, short: 65, opener: 40, auto_s: 100,
  // リリーフ
  closer: 40, setup: 35, ace_relief: 40, long: 60,
  onepoint: 15, behind: 50, mopup: 50, auto_r: 35
};

// 先発の球数上限はスタミナで決める（`quality` / `ace` / 自動）。
// ⚠ 固定の100球だと、スタミナ110でも150でも同じ所で降りて投球回がスタミナに依存しない。
//    スタミナ100→95球 / 120→102球 / 140→109球、エースは+8（上限はどちらも120）。
//    完投型・ショート・オープナーは起用法そのものなので固定値のまま
const STAMINA_PITCH_ROLES = new Set(['quality', 'ace', 'auto_s']);
const pitchLimitFor = (role, isReliever, stamina = 100) => {
  if (!isReliever && (STAMINA_PITCH_ROLES.has(role) || !role)) {
    const base = 60 + stamina * 0.35 + (role === 'ace' ? 8 : 0);
    return Math.round(Math.min(120, base));
  }
  return PITCH_LIMITS[role] || (isReliever ? 35 : 100);
};

// イニング別ダメージ閾値（残りスタミナで伸び縮みする。下の `damageThreshold`）
// ⚠ 旧値は 45→5 と5刻みで落ち、7回15・8回10・9回5 だった。終盤は単打1本と失点1で
//    必ず降板になり、スタミナが残っていても7回以降を投げられなかった（スタミナ130〜150で平均5.3回）
const INNING_DAMAGE_THRESHOLDS = [45, 40, 36, 32, 28, 25, 22, 19, 16];
// ⚠ **ダメージの許容量は残りスタミナで伸び縮みさせる**。
//    旧実装はイニングだけで決まり、先発の降板理由の約半分がダメージだった
//    （スタミナ120以上でも平均4.9回・78球で降りていた）。これだと投球回が
//    **打たれ方だけで決まってスタミナに依存しない**。（×0.7〜1.7）余力のある投手は多少打たれても
//    続投し、疲れてきた投手は少しの綻びで代える——采配モードの `aiManager` が
//    スタミナで判断しているのと同じ考え方に揃える。
const damageThreshold = (inning, staminaRate) =>
  Math.round((INNING_DAMAGE_THRESHOLDS[Math.min(inning - 1, 8)] || 5) * (0.7 + Math.max(0, Math.min(1, staminaRate))));

// リリーフを reliefFatigue の少ない順に並べるための比較関数。
// ⚠ **守護神だけは最後に回す**。守護神はセーブ場面（実測で1チーム110試合あたり
//    32.6回）でしか呼ばれないので、**常にブルペンで最も疲労が少ない**。
//    疲労順の緊急フォールバックがそれを毎回拾い、セーブ場面が32.6回しか
//    無いのに登板が61回まで膨らんでいた（実NPBの守護神は35〜42%の試合）。
//    除外ではなく末尾送りにするのは、本当に誰も居ないときに投げられなくなるのを防ぐため。
const closerLast = (fatigue, closerId, tieBreak = null) => (a, b) => {
  const ac = a.id === closerId ? 1 : 0, bc = b.id === closerId ? 1 : 0;
  if (ac !== bc) return ac - bc;
  const d = (fatigue[a.id] || 0) - (fatigue[b.id] || 0);
  return d || (tieBreak ? tieBreak(a, b) : 0);
};

// 9回の「守護神を投入」を出してよいか＝守護神がいまマウンドに上がれるか。
// ⚠ **上がれないときに交代の合図だけ出さないこと**。以前は「いまの投手が守護神で
//    ない」だけで合図していたため、守護神が既に投げて降りた・疲れている・いない
//    ときは、**打者ごと（延長なら回ごと）に別の中継ぎを呼び続け**、先発まで
//    使い切っていた。上がれないなら、いまの投手に任せる（他の条件の継投は残る）。
const closerCanEnter = (rotation, gs, teamKey, currentPitcherId, players) => {
  const id = rotation?.closer;
  if (!id || id === currentPitcherId) return false;
  if (gs.removedIds?.has(id)) return false;
  if ((gs.pitcherAppearances?.[teamKey] || []).some(a => a.id === id)) return false;
  if (((rotation.reliefFatigue || {})[id] || 0) >= 50) return false;
  return canEnterRelief(players, id, currentPitcherId, gs.removedIds);
};

// 試合で既に退いた選手（降板した先発を含む）を再登板の候補から外す。
// ⚠ 先発は `pitcherAppearances`（救援の記録）に入らないので、それだけで判定すると
//    緊急時の経路で**降板した先発がもう一度マウンドに上がっていた**。
const addRemovedIds = (ids, gs) => {
  for (const id of gs.removedIds || []) ids.add(id);
  return ids;
};

// 選手が投手かどうかを判定（positionだけでなく能力値も確認）
export const isPitcherPlayer = (player) => {
  // ⚠ **コンバートで野手にした選手は投手にしない**。下の「スタミナ100以上」は
  //    当て推量なので、投手から野手へ移した選手が投げ続けてしまう
  if (registeredAsFielder(player)) return false;
  // 明示的にpitcherと設定されている場合
  if (player.position === 'pitcher') return true;
  // 投手としての能力を持っている（スタミナ100以上は投手専用）
  if (player.pitching?.stamina >= 100) return true;
  // primaryRoleが設定されている場合はそれを優先
  if (player.primaryRole === 'pitcher') return true;
  return false;
};

// 野手から救援に回すときの代役。退いた選手や抹消中の選手は戻さない。
// 控え野手が尽きていれば、投手も野手の枠を埋められる。
const reliefFieldReplacement = (players, reliever, currentPitcherId, removedIds) =>
  (players || []).filter(p =>
    p.isActive !== false && p.battingOrder === 0 &&
    p.id !== reliever.id && p.id !== currentPitcherId && !removedIds?.has(p.id)
  ).sort((a, b) =>
    Number(isPitcherPlayer(a)) - Number(isPitcherPlayer(b)) ||
    getPositionFitness(b, reliever.position, 0) - getPositionFitness(a, reliever.position, 0)
  )[0];

// 野手の打順（守備に就いている）に居るか。⚠ DH制では9番も野手（投手は打順0）。
// 「9番＝投手」とみなすと、DH制で9番を打つ二刀流の選手が代役なしに登板して打順に穴が開く
const inFieldSlot = (player) => {
  const order = player?.battingOrder || 0;
  return order > 0 && (LEAGUE_SETTINGS.useDH || order < 9);
};

const canEnterRelief = (players, id, currentPitcherId, removedIds) => {
  const player = players?.find(p => p.id === id);
  return !!player && player.isActive !== false && !removedIds?.has(id) &&
    (!inFieldSlot(player) ||
      !!reliefFieldReplacement(players, player, currentPitcherId, removedIds));
};

// AI監督がスタメンを自動生成する機能（エクスポート）
// 毎試合呼ばれ、ローテーション・疲労を考慮して合理的なラインナップを組む。
// 返り値は今日の先発投手（`teamData.players` の中の人。選べなければ undefined）
export const generateAILineup = (teamData, teamName) => {
  const players = teamData.players || [];
  if (players.length === 0) {
    return;
  }


  // 全員の打順をリセット
  // ⚠ **DH の印（`_isDH`）も一緒に外す**。下で印を付け直すのは打順に入る人だけなので、
  //    前の打順の DH が控えに回ると印が残り、守備固めで入ると印付きのまま守備位置を受け取って
  //    「DH が2人・その守備位置が空」になっていた（守備の検索は `!p._isDH` で探す）
  players.forEach(p => { p.battingOrder = 0; delete p._isDH; });

  // 先発投手を先に決定（二刀流選手のフィールド配置に影響するため）
  const rotation = teamData.pitchingRotation;
  const allPitchers = players.filter(p => isPitcherPlayer(p) && p.isActive !== false);
  let starter = null;

  if (rotation?.starters?.length > 0) {
    const index = rotation.currentStarterIndex || 0;

    if (rotation._userSelectedStarter) {
      // ユーザーが簡易スタメンで指定した先発を優先（疲労チェックなし）
      const starterId = rotation.starters[index];
      const candidate = allPitchers.find(p => p.id === starterId);
      if (candidate) {
        starter = candidate;
        if (TEAMS_DATA[teamName]?.pitchingRotation) {
          TEAMS_DATA[teamName].pitchingRotation.currentStarterIndex =
            (index + 1) % rotation.starters.length;
        }
      }
    }

    if (!starter) {
      for (let i = 0; i < rotation.starters.length; i++) {
        const candidateIdx = (index + i) % rotation.starters.length;
        const candidateId = rotation.starters[candidateIdx];
        const candidate = allPitchers.find(p => p.id === candidateId);
        if (candidate && (candidate.fatigue || 0) < PITCHER_REST_FATIGUE_THRESHOLD) {
          starter = candidate;
          if (TEAMS_DATA[teamName]?.pitchingRotation) {
            // index+1 でローテを進める（candidateIdx+1 だとwrap時に同じ位置に戻るバグを防ぐ）
            TEAMS_DATA[teamName].pitchingRotation.currentStarterIndex =
              (index + 1) % rotation.starters.length;
          }
          break;
        }
      }
    }
  }

  if (!starter) {
    const availablePitchers = allPitchers.filter(p => (p.fatigue || 0) < PITCHER_REST_FATIGUE_THRESHOLD);
    if (availablePitchers.length > 0) {
      availablePitchers.sort((a, b) => {
        const staminaA = a.pitching?.stamina || 100;
        const staminaB = b.pitching?.stamina || 100;
        if (staminaA !== staminaB) return staminaB - staminaA;
        return (a.fatigue || 0) - (b.fatigue || 0);
      });
      starter = availablePitchers[0];
    } else {
      allPitchers.sort((a, b) => (a.fatigue || 0) - (b.fatigue || 0));
      starter = allPitchers[0];
    }
  }

  const useDH = LEAGUE_SETTINGS.useDH;

  if (starter) {
    starter.battingOrder = useDH ? 0 : 9;
    starter.position = 'pitcher';
  }

  // 野手を取得（投手登録の二刀流は今日の先発でなければ野手として起用）
  const fieldPlayers = players.filter(p => {
    if (starter && p.id === starter.id) return false;
    if (p.isTwoWay) return true;
    return !isPitcherPlayer(p);
  });

  // コンディション・疲労による実効打撃力の計算
  const getEffectiveBatting = (p) => {
    const condMod = { 4: 5, 3: 2, 2: 0, 1: -2, 0: -5 }[p.condition ?? 2] || 0;
    const fatigue = p.fatigue || 0;
    const fatiguePenalty = fatigue > 0 ? Math.round(fatigue * fatigue / 1200) : 0;
    const meet = (p.batting?.meet || 50) + condMod - fatiguePenalty;
    const power = (p.batting?.power || 50) + condMod - fatiguePenalty;
    return { meet, power, condMod, fatiguePenalty };
  };

  // ポジションごとに最適な選手を選ぶ（守備適性+打撃力+調子+疲労の総合判断）
  const lineup = [];
  const usedPlayers = new Set();

  // 重要守備位置を先に埋める
  const priorityPositions = ['short', 'second', 'center', 'catcher', 'third', 'first', 'left', 'right'];
  priorityPositions.forEach(pos => {
    const available = fieldPlayers.filter(p => !usedPlayers.has(p.id));
    if (available.length === 0) return;

    available.sort((a, b) => {
      const aFit = getPositionFitness(a, pos);
      const bFit = getPositionFitness(b, pos);
      const aEff = getEffectiveBatting(a);
      const bEff = getEffectiveBatting(b);
      const aBat = aEff.meet + aEff.power;
      const bBat = bEff.meet + bEff.power;
      // 疲労41以上から段階的に成長ペナルティ(-0.01/-0.02/-0.03)が発生するため休養を促す。
      // fatiguePenalty = 疲労²/1200 なので 疲労41→1, 61→3, 81→5 に対応する
      const fatigueMalus = (fp) => (fp >= 5 ? -50 : fp >= 3 ? -25 : fp >= 1 ? -8 : 0);
      const aFatigueMalus = fatigueMalus(aEff.fatiguePenalty);
      const bFatigueMalus = fatigueMalus(bEff.fatiguePenalty);
      return (bFit * 0.6 + bBat * 0.4 + bFatigueMalus) - (aFit * 0.6 + aBat * 0.4 + aFatigueMalus);
    });

    const selected = available[0];
    lineup.push({ player: selected, position: pos });
    usedPlayers.add(selected.id);
  });

  // DH制: 打撃専門のDHをベンチから選出
  if (useDH) {
    const dhCandidates = fieldPlayers.filter(p => !usedPlayers.has(p.id));
    if (dhCandidates.length > 0) {
      dhCandidates.sort((a, b) => {
        const aEff = getEffectiveBatting(a);
        const bEff = getEffectiveBatting(b);
        return (bEff.meet + bEff.power) - (aEff.meet + aEff.power);
      });
      lineup.push({ player: dhCandidates[0], position: 'dh' });
      usedPlayers.add(dhCandidates[0].id);
    }
  }

  // 打順を決定
  const battingOrder = [];
  const remaining = [...lineup];
  const maxBattingOrder = useDH ? 9 : 8;

  // 1番: 出塁率重視（ミート+選球眼+足）※調子・疲労込み
  remaining.sort((a, b) => {
    const aEff = getEffectiveBatting(a.player);
    const bEff = getEffectiveBatting(b.player);
    const aVal = aEff.meet * 0.4 + (a.player.batting?.eye || 50) * 0.3 + (a.player.physical?.speed || 50) * 0.3;
    const bVal = bEff.meet * 0.4 + (b.player.batting?.eye || 50) * 0.3 + (b.player.physical?.speed || 50) * 0.3;
    return bVal - aVal;
  });
  if (remaining.length > 0) battingOrder.push({ ...remaining.shift(), battingOrder: 1 });

  // 2番: ミート重視
  remaining.sort((a, b) => {
    const aEff = getEffectiveBatting(a.player);
    const bEff = getEffectiveBatting(b.player);
    const aVal = aEff.meet * 0.5 + (a.player.batting?.eye || 50) * 0.3 + (a.player.physical?.speed || 50) * 0.2;
    const bVal = bEff.meet * 0.5 + (b.player.batting?.eye || 50) * 0.3 + (b.player.physical?.speed || 50) * 0.2;
    return bVal - aVal;
  });
  if (remaining.length > 0) battingOrder.push({ ...remaining.shift(), battingOrder: 2 });

  // 3番: 総合力
  remaining.sort((a, b) => {
    const aEff = getEffectiveBatting(a.player);
    const bEff = getEffectiveBatting(b.player);
    return (bEff.meet * 0.5 + bEff.power * 0.5) - (aEff.meet * 0.5 + aEff.power * 0.5);
  });
  if (remaining.length > 0) battingOrder.push({ ...remaining.shift(), battingOrder: 3 });

  // 4番: パワー最重視
  remaining.sort((a, b) => getEffectiveBatting(b.player).power - getEffectiveBatting(a.player).power);
  if (remaining.length > 0) battingOrder.push({ ...remaining.shift(), battingOrder: 4 });

  // 5番: パワー2番手
  remaining.sort((a, b) => getEffectiveBatting(b.player).power - getEffectiveBatting(a.player).power);
  if (remaining.length > 0) battingOrder.push({ ...remaining.shift(), battingOrder: 5 });

  // 6-最終番: 残りを総合打力順
  remaining.sort((a, b) => {
    const aEff = getEffectiveBatting(a.player);
    const bEff = getEffectiveBatting(b.player);
    return (bEff.meet + bEff.power) - (aEff.meet + aEff.power);
  });
  let nextOrder = 6;
  while (remaining.length > 0 && nextOrder <= maxBattingOrder) {
    battingOrder.push({ ...remaining.shift(), battingOrder: nextOrder++ });
  }

  // 打順を選手に適用（DHは打順のみ設定し、選手の守備ポジションは変更しない）
  battingOrder.forEach(entry => {
    const player = teamData.players.find(p => p.id === entry.player.id);
    if (player) {
      player.battingOrder = entry.battingOrder;
      if (entry.position === 'dh') {
        player._isDH = true;
      } else {
        player.position = entry.position;
        delete player._isDH;
      }
    }
  });

  // 今日の先発（DH制では打順に入らないので、呼ぶ側はこれで先発を知る。`gameSetup.js`）
  return starter;
};

// ユーザーチームに推奨スタメンを設定
export const setRecommendedLineup = (teamData, teamName) => {
  // AI同様の最適配置を作成し、lineupSettingsに保存
  const players = teamData.players || [];
  if (players.length === 0) return;

  // generateAILineupはcurrentStarterIndexを進めてしまうので保存・復元
  const savedIndex = TEAMS_DATA[teamName]?.pitchingRotation?.currentStarterIndex || 0;

  // 一旦AIロジックでスタメンを組む
  generateAILineup(teamData, teamName);

  if (TEAMS_DATA[teamName]?.pitchingRotation) {
    TEAMS_DATA[teamName].pitchingRotation.currentStarterIndex = savedIndex;
  }

  // 結果をlineupSettingsに保存
  if (!teamData.lineupSettings) {
    teamData.lineupSettings = { battingOrder: [], benchPlayers: [], substitutionRules: { pinchHitter: [], pinchRunner: [] } };
  }

  const starters = players.filter(p => p.battingOrder > 0 && p.battingOrder <= 9);
  // ⚠ DH は守備位置ではなく `_isDH` の印で持つ（position は本来の守備位置のまま）。
  //    打順の保存には「dh」で書くこと。本来の位置で書くと同じ守備位置が2人になり、
  //    日付進行の補完（`ensureCompleteLineup`）が重なった人を空いた位置へ順に回して、
  //    左翼手が捕手・捕手が一塁…と守備が連鎖してずれていた（独立リーグの開幕で見つかった）
  teamData.lineupSettings.battingOrder = starters.map(p => ({
    playerId: p.id,
    battingOrder: p.battingOrder,
    position: p._isDH ? 'dh' : p.position
  }));

};

// 野手の日次回復ベース量（投手は別途 recoveryAmount を使用）
export const POSITION_PLAYER_RECOVERY_BASE = 7;

// 全チームの疲労を回復（日次処理）
//
// ⚠ **既定値は実ゲームと同じ 20 にすること**。以前は既定25で、実ゲームだけ
//    `dateProgression` が 20 を明示的に渡していた。ハーネスは引数なしで呼ぶので
//    **25で回っており、実ゲームより25%も回復の速いブルペンを測っていた**。
//    実測でロール別の登板数が変わる（守護神 37 → 54 / ビハインド 58 → 50）。
//    `reliefFatigue` もこの量で減るので、リリーフの起用分散に直接効く。
//
// ⚠ 野手はこの引数を使わない。体力比例の別式（下記）で回復する。
//    `POSITION_PLAYER_RECOVERY_BASE = 7` は**参照されていない死んだ定数**。
//
// スタッフの身体ケア能力で回復量にボーナス（0→×1.0、50→×1.1、100→×1.2）
export const recoverAllPitcherFatigue = (recoveryAmount = 20) => {
  Object.entries(TEAMS_DATA).forEach(([teamName, team]) => {
    if (!team || !team.players) return;

    // スタッフの身体ケアボーナス
    const staffBonus = team.corporateData?.staff ? getTeamStaffBonus(team.corporateData.staff) : null;
    const bodyCare = staffBonus ? (staffBonus.bodyCare || 0) : 0;
    const bodyCareMult = 1.0 + (bodyCare / 100) * 0.2;

    // 選手個人の疲労回復（回復能力が高いほど多く回復）
    // 出場した選手はその日は回復しない（代打・代走・守備固め・ワンポイントも含む）。
    // 試合処理で _playedToday が立つ → ここで消費してスキップする。
    team.players.forEach(player => {
      if (player._playedToday) {
        delete player._playedToday;
        return;
      }
      if (player.fatigue && player.fatigue > 0) {
        const recoveryAbility = player.physical?.recovery || 50;
        let actualRecovery;
        if (player.position === 'pitcher') {
          // 投手: ベース回復25 ×(0.7〜1.3)（ローテ維持のため従来式）
          const recoveryMult = 0.7 + (recoveryAbility / 100) * 0.6;
          actualRecovery = Math.round(recoveryAmount * recoveryMult * bodyCareMult);
        } else {
          // 野手: 1日回復 = 体力 ×(0.25 + 回復力/100×0.60)（回復0→25%,50→55%,100→85%）
          const body = player.physical?.bodyStamina ?? 50;
          const pct = 0.25 + (recoveryAbility / 100) * 0.60;
          actualRecovery = Math.round(body * pct * bodyCareMult);
        }
        player.fatigue = Math.max(0, player.fatigue - actualRecovery);
      }
    });

    // リリーフ投手の疲労回復
    if (team.pitchingRotation && team.pitchingRotation.reliefFatigue) {
      Object.keys(team.pitchingRotation.reliefFatigue).forEach(id => {
        team.pitchingRotation.reliefFatigue[id] = Math.max(0,
          team.pitchingRotation.reliefFatigue[id] - recoveryAmount
        );
      });
    }
  });
};

// 試合シミュレーション用のチーム複製。試合中に一切参照しない重い履歴/通算系
// フィールドを除外して複製することで、1試合あたりのディープコピーを約2倍高速化する。
// 成績は最後に TEAMS_DATA（原本）へ書き戻すため、コピーに履歴がなくても問題ない。
const SIM_CLONE_OMIT = new Set([
  'growthHistory', 'statsHistory', 'careerHistory', 'careerStats', 'previousSeasonStats',
]);
const cloneTeamForSim = (team) =>
  JSON.parse(JSON.stringify(team, (k, v) => (SIM_CLONE_OMIT.has(k) ? undefined : v)));

const simulateGame = (homeTeamName, awayTeamName, isCupGame = false, observer = null) => {

  // TEAMS_DATAからチームデータを取得
  if (!TEAMS_DATA || !TEAMS_DATA[homeTeamName] || !TEAMS_DATA[awayTeamName]) {
    // ⚠ どちらが欠けているか出さないと追えない（0-0引分で静かに返してしまうため）
    const missing = [!TEAMS_DATA?.[homeTeamName] && homeTeamName, !TEAMS_DATA?.[awayTeamName] && awayTeamName]
      .filter(Boolean).join(' / ');
    console.error(`チームデータが見つかりません: ${missing}（${awayTeamName} @ ${homeTeamName}）`);
    return { homeScore: 0, awayScore: 0, result: '引分 0-0', winner: null };
  }

  const homeTeamData = cloneTeamForSim(TEAMS_DATA[homeTeamName]);
  const awayTeamData = cloneTeamForSim(TEAMS_DATA[awayTeamName]);


  // スタメン設定を適用（なければAI生成）
  // AI監督は毎試合新しくスタメンを決める
  const applyLineupSettings = (teamData, teamName) => {
    const settings = teamData.lineupSettings;
    const isUserTeam = settings?.battingOrder?.length > 0;

    if (!isUserTeam) {
      // AI監督が毎試合スタメンを決定
      // currentStarterIndex は selectStarterFromRotation が進める責務を持つため、
      // generateAILineup が進めた分を復元して二重進行を防ぐ
      const rot = TEAMS_DATA[teamName]?.pitchingRotation;
      const savedIdx = rot?.currentStarterIndex;
      generateAILineup(teamData, teamName);
      if (rot && savedIdx !== undefined) rot.currentStarterIndex = savedIdx;
      return;
    }


    // まず全員の打順を0にリセット（DH の印も外す。`generateAILineup` の説明を参照）
    teamData.players.forEach(p => { p.battingOrder = 0; delete p._isDH; });

    // lineupSettingsから打順と守備位置を適用（DHは打順のみ、ポジション変更しない）
    settings.battingOrder.forEach(entry => {
      const player = teamData.players.find(p => p.id === entry.playerId);
      if (player) {
        player.battingOrder = entry.battingOrder;
        if (entry.position === 'dh') {
          player._isDH = true;
        } else {
          player.position = entry.position;
          delete player._isDH;
        }
      }
    });
  };

  applyLineupSettings(homeTeamData, homeTeamName);
  applyLineupSettings(awayTeamData, awayTeamName);

  const useDH = LEAGUE_SETTINGS.useDH;
  const pitcherBattingOrder = useDH ? 0 : 9;

  // 投手ローテーションから先発投手を選択
  const selectStarterFromRotation = (teamData, teamName) => {
    const rotation = teamData.pitchingRotation;
    const userSelected = rotation?._userSelectedStarter;

    // ユーザー指定 or カスタムラインナップ: ローテの今の順番から先発する（疲労チェックなし）
    // ⚠ 先発は `nextRotationStarterId`（`ensureCompleteLineup` が DH制で打順から外す選手・
    //    非DH制で9番に入れる選手と**同じ決め方**）。以前は今の番の選手だけを見て、
    //    抹消中なら下の疲労チェック付きの選び方に落ちていた。すると次の番が疲れているとき
    //    別の選手が投げ、DH制では打順から外した選手は投げず、打順に残した二刀流の選手が
    //    投げて打順から抜け、8人で戦っていた。
    if ((userSelected || teamData.lineupSettings?.battingOrder?.length > 0) && rotation?.starters?.length > 0) {
      const starterId = nextRotationStarterId(teamData);
      const starter = starterId === undefined ? null : teamData.players.find(p => p.id === starterId);
      const index = starter ? rotation.starters.indexOf(starter.id) : -1;
      // _userSelectedStarter は非アクティブ時でも必ずクリア（無効指名が永続しないよう）
      const teamsRot = TEAMS_DATA[teamName]?.pitchingRotation;
      if (teamsRot) delete teamsRot._userSelectedStarter;
      if (starter) {
        // generateAILineupで既にindex進行済みの場合があるので、重複進行を防止
        // カップ戦はローテ進行しない（リーグ戦のインデックスを維持）
        if (teamsRot && !isCupGame) {
          teamsRot.currentStarterIndex = (index + 1) % rotation.starters.length;
        }
        teamData.players.forEach(p => {
          if (p.id === starter.id) {
            p.battingOrder = pitcherBattingOrder;
            p.position = 'pitcher';
          } else if (!useDH && p.battingOrder === 9 && p.id !== starter.id) {
            p.battingOrder = 0;
          }
        });
        return starter;
      }
    }

    // AIチーム / ローテーション未設定: 疲労チェック付きで先発を選択
    if (!rotation || !rotation.starters || rotation.starters.length === 0) {
      const fallback = teamData.players.filter(p => isPitcherPlayer(p) && p.isActive !== false).sort((a, b) => (a.fatigue || 0) - (b.fatigue || 0))[0];
      if (fallback) {
        fallback.battingOrder = pitcherBattingOrder;
        fallback.position = 'pitcher';
      }
      return fallback;
    }

    const isEligible = (p) => p && p.isActive !== false && (p.fatigue || 0) < PITCHER_REST_FATIGUE_THRESHOLD;
    // 全員疲労/ベンチ外のフォールバック: 最も疲労の少ない登録中の投手
    const getLeastTiredPitcher = () => {
      const all = teamData.players.filter(p => isPitcherPlayer(p) && p.isActive !== false);
      all.sort((a, b) => (a.fatigue || 0) - (b.fatigue || 0));
      return all[0];
    };

    let starter = null;

    if (isCupGame) {
      // カップ戦: ローテ上位（エース級）から疲労の少ない投手を選ぶ
      // ローテ進行なし（リーグ戦のローテに影響させない）
      const topCount = Math.min(3, rotation.starters.length);
      const candidates = rotation.starters
        .map((id, idx) => ({ id, idx, player: teamData.players.find(p => p.id === id) }))
        .filter(({ player }) => isEligible(player))
        .sort((a, b) => {
          const aTop = a.idx < topCount;
          const bTop = b.idx < topCount;
          if (aTop !== bTop) return aTop ? -1 : 1;
          return (a.player.fatigue || 0) - (b.player.fatigue || 0);
        });
      if (candidates.length > 0) {
        starter = candidates[0].player;
      } else {
        starter = getLeastTiredPitcher();
      }
      // カップ戦はローテ進行しない（リーグ戦のインデックスを維持）
    } else {
      // リーグ戦: ローテーション順に疲労・ベンチ外チェックして選択
      const index = rotation.currentStarterIndex || 0;
      let selectedIdx = index;

      for (let i = 0; i < rotation.starters.length; i++) {
        const candidateIdx = (index + i) % rotation.starters.length;
        const candidateId = rotation.starters[candidateIdx];
        const candidate = teamData.players.find(p => p.id === candidateId);
        if (isEligible(candidate)) {
          starter = candidate;
          selectedIdx = candidateIdx;
          break;
        }
      }

      if (!starter) starter = getLeastTiredPitcher();

      if (starter) {
        // selectedIdx+1 でローテを進める（選んだ投手の次から開始してスキップ連鎖を防ぐ）
        TEAMS_DATA[teamName].pitchingRotation.currentStarterIndex =
          (selectedIdx + 1) % rotation.starters.length;
      }
    }

    if (starter) {
      teamData.players.forEach(p => {
        if (p.id === starter.id) {
          p.battingOrder = pitcherBattingOrder;
          p.position = 'pitcher';
        } else if (!useDH && p.battingOrder === 9 && p.id !== starter.id) {
          p.battingOrder = 0;
        }
      });
    }

    return starter;
  };

  const homeStarter = selectStarterFromRotation(homeTeamData, homeTeamName);
  const awayStarter = selectStarterFromRotation(awayTeamData, awayTeamName);

  // 先発投手を確認
  const homePitchers = homeTeamData.players.filter(p => p.position === 'pitcher' && (p.battingOrder === pitcherBattingOrder || p.battingOrder === 9));
  const awayPitchers = awayTeamData.players.filter(p => p.position === 'pitcher' && (p.battingOrder === pitcherBattingOrder || p.battingOrder === 9));

  // 試合状態の初期化
  let gameState = {
    // 回ごとの得点（表＝away、裏＝home）。サヨナラの回は決まった時点までの得点
    lineScore: { away: [], home: [] },
    inning: 1,
    isTopInning: true,
    outs: 0,
    bases: [false, false, false],
    // 自責点判定用: そのイニングで失策により免れたアウト数（本来なら発生していたアウト）
    inningErrorOuts: 0,
    score: { home: 0, away: 0 },
    count: { balls: 0, strikes: 0 },
    homeTeam: {
      ...homeTeamData,
      currentBatterOrder: 1,
      players: homeTeamData.players.map(p => {
        const maxStamina = p.pitching?.stamina || 100;
        const fatigue = p.fatigue || 0;
        // 疲労によりスタミナ上限が低下（最低50%まで）
        const startStamina = Math.max(Math.floor(maxStamina * 0.5), maxStamina - fatigue);
        return {
        ...p,
        currentStamina: startStamina,
        gameStats: {
          batting: { atBats: 0, hits: 0, homeruns: 0, rbis: 0, walks: 0, hitByPitch: 0, strikeouts: 0, stolenBases: 0, caughtStealing: 0 },
          pitching: { outs: 0, runsAllowed: 0, earnedRuns: 0, strikeouts: 0, walks: 0, hitBatters: 0, pitches: 0, wildPitches: 0 },
          fielding: { chances: 0, errors: 0, assists: 0 }
        }
      };})
    },
    awayTeam: {
      ...awayTeamData,
      currentBatterOrder: 1,
      players: awayTeamData.players.map(p => {
        const maxStamina = p.pitching?.stamina || 100;
        const fatigue = p.fatigue || 0;
        const startStamina = Math.max(Math.floor(maxStamina * 0.5), maxStamina - fatigue);
        return {
        ...p,
        currentStamina: startStamina,
        gameStats: {
          batting: { atBats: 0, hits: 0, homeruns: 0, rbis: 0, walks: 0, hitByPitch: 0, strikeouts: 0, stolenBases: 0, caughtStealing: 0 },
          pitching: { outs: 0, runsAllowed: 0, earnedRuns: 0, strikeouts: 0, walks: 0, hitBatters: 0, pitches: 0, wildPitches: 0 },
          fielding: { chances: 0, errors: 0, assists: 0 }
        }
      };})
    },
    // リリーフ投手追跡（登板制限用）
    reliefTracking: {
      home: {
        starterLeftInning: null,  // 先発が降板したイニング
        currentRelieverId: null,  // 現在のリリーフ投手ID
        relieverOutsPitched: 0,   // 現在のリリーフの投球アウト数
        relieverBattersFaced: 0,  // 現在のリリーフの対戦打者数
        relieverInningRuns: 0     // 現在のリリーフの今イニング失点
      },
      away: {
        starterLeftInning: null,
        currentRelieverId: null,
        relieverOutsPitched: 0,
        relieverBattersFaced: 0,
        relieverInningRuns: 0     // 現在のリリーフの今イニング失点
      }
    },
    // イニング開始時の失点記録（イニング失点計算用）
    inningStartRuns: { home: 0, away: 0 },
    // 先発投手のダメージポイント積算（降板判定用）
    // 単打/四球=4点、長打=6点、失点=10点。イニングまたぎで-10（最低0）
    starterDamagePoints: { home: 0, away: 0 },
    // 投手登板記録（セーブ・ホールド判定用）
    pitcherAppearances: { home: [], away: [] },
    // 守り終えた直後に決めた継投を、次に守る直前まで持ち越す（攻撃中に投手を代えない）
    pendingPitcherChange: { home: null, away: null },
    // 投手交代記録（理由表示用）
    pitcherChanges: [],
    // 現在の投手ID（DH制で複数pitcher判別用）
    currentPitcherId: { home: homeStarter?.id || null, away: awayStarter?.id || null },
    // 交代で退いた選手（再出場させない）。⚠ battingOrder=0 だけだと控えと区別できず、
    //    代打で退いた選手が次の打席でまた代打に出てこられた
    removedIds: new Set(),
    // 投手に代打を出したチーム → { slot, phId, phPos }。イニング終了処理で必ず継投する
    //    （⚠ 以前は代打に position='pitcher' を渡すだけで currentPitcherId が変わらず、
    //       打順から外れた投手がそのまま投げ続けていた）
    pitcherPinchHit: { home: null, away: null },
    // 勝敗・セーブ・ホールドの判定用（登板順とリードの移り変わり。pitcherDecisions.js）
    decisionLog: createDecisionLog()
  };
  observer?.start?.({ homeTeam: gameState.homeTeam, awayTeam: gameState.awayTeam });
  const observeDecisions = () => observeDecisionLog(gameState.decisionLog, {
    score: gameState.score, pitcherIds: gameState.currentPitcherId,
  });

  // 現在の打者を取得
  const getCurrentBatter = (team) => {
    return team.players.find(p => p.battingOrder === team.currentBatterOrder) || team.players[0];
  };

  // 現在の投手を取得
  // 選手が投手かどうかを判定（ローカル版）
  // ⚠ 写しを置かない（判定が食い違う）。同じモジュールの `isPitcherPlayer` を使う
  const isPitcher = (player) => isPitcherPlayer(player);

  const getCurrentPitcher = (team) => {
    // currentPitcherIdで追跡（DH制で複数pitcherがbattingOrder=0を持つ問題を回避）
    const teamKey = team === gameState.homeTeam ? 'home' : 'away';
    const currentId = gameState.currentPitcherId?.[teamKey];
    if (currentId) {
      const tracked = team.players.find(p => p.id === currentId);
      if (tracked) return tracked;
    }
    // フォールバック: position + battingOrder
    const pitcher = team.players.find(p => p.position === 'pitcher' && (p.battingOrder === pitcherBattingOrder || p.battingOrder === 9));
    if (pitcher) return pitcher;

    const reliever = team.players.find(p => isPitcher(p) && p.pitching && p.isActive !== false);
    if (reliever) return reliever;

    return team.players.find(p => p.pitching?.stamina >= 100);
  };

  // 現在の捕手を取得
  const getCurrentCatcher = (team) => {
    // ⚠ 出場中の捕手を先に探す（代打・守備固めで退いた捕手も position='catcher' のまま残る）
    return team.players.find(p => p.position === 'catcher' && p.battingOrder > 0 && !p._isDH)
      || team.players.find(p => p.position === 'catcher') || team.players[0];
  };

  // 守備データを構築（守備位置適正を反映: 適正100→100%、適正0→50%）
  const buildDefense = (team) => {
    const defense = {};
    const defStrat = team.strategy?.defense || 'normal';
    // 守備方針の得と損（数字は tactics.js の STRATEGY_MODS。画面の説明も同じ表から）
    const defMod = STRATEGY_MODS.defense[defStrat] || {};
    const infieldBonus = defMod.infield || 0;
    const outfieldBonus = defMod.outfield || 0;
    const infieldPositions = ['first', 'second', 'short', 'third', 'catcher', 'pitcher'];

    // DH制: 投手はbattingOrder=0だが守備参加、DHはbattingOrder>0だが守備不参加
    const currentPitcherForDef = getCurrentPitcher(team);
    team.players.filter(p =>
      (p.battingOrder > 0 && p.battingOrder <= 9 && !p._isDH) ||
      (p.position === 'pitcher' && p.id === currentPitcherForDef?.id)
    ).forEach(player => {
      const fitness = getPositionFitness(player, player.position);
      const fitnessMult = 0.5 + (fitness / 100) * 0.5;
      const posBonus = infieldPositions.includes(player.position) ? infieldBonus : outfieldBonus;
      defense[player.position] = {
        defense: Math.round((player.fielding?.defense || 50) * fitnessMult) + posBonus,
        speed: Math.round((player.physical?.speed || 50) * fitnessMult),
        arm: Math.round((player.physical?.arm || 50) * fitnessMult),
        throws: player.physical?.throws || 'right'
      };
    });
    return defense;
  };

  // 直前の1球で打者が狙い球を当てたか（対人の記録だけが読む。試合の判定には使わない）
  let lastGuessRight = false;
  // 一球シミュレーション（自己完結型）
  const simulateOnePitch = (batterPlayer, pitcherPlayer, catcherPlayer, defense, count, pitcherStamina, bases, sequence, offenseStrategy, defenseStrategy) => {
    lastGuessRight = false;
    // 前球（打席内の配球メモリ。詳細は pitchSequence.js）
    const lastPitch = lastCall(sequence);
    // この場面で捕手が求める結果（併殺狙い / 三振狙い / 通常。pitchSituation.js）
    const objective = decidePitchObjective(bases, gameState.outs);
    const battingStrat = offenseStrategy?.batting || 'balanced';
    const pitchingStrat = defenseStrategy?.pitching || 'balanced';

    // 打撃方針の効果
    const batMod = STRATEGY_MODS.batting[battingStrat] || {};
    const stratMeetMod = batMod.meet || 0;
    const stratPowerMod = batMod.power || 0;
    const stratEyeMod = batMod.eye || 0;

    // コンディション補正
    const batterCondition = batterPlayer.condition ?? CONDITION_LEVELS.NORMAL;
    const pitcherCondition = pitcherPlayer.condition ?? CONDITION_LEVELS.NORMAL;
    const batterCondMod = conditionBattingMod(batterCondition);
    const pitcherCondMod = CONDITION_PITCHING_MODIFIER[pitcherCondition] || 0;

    // 疲労による能力低下（疲労0→0%, 疲労50→-5%, 疲労100→-15%）
    const batterFatigue = batterPlayer.fatigue || 0;
    const fatiguePenalty = batterFatigue > 0 ? Math.round(batterFatigue * batterFatigue / 1200) : 0;

    // 精神力によるチャンス/ピンチ補正
    const isClutch = bases[1] || bases[2]; // 得点圏にランナー
    const batterMental = batterPlayer.personality?.mental ?? 50;
    const pitcherMental = pitcherPlayer.personality?.mental ?? 50;
    const batterClutchMod = isClutch ? Math.round((batterMental - 50) / 10) : 0;
    const pitcherClutchMod = isClutch ? Math.round((pitcherMental - 50) / 10) : 0;

    const batter = {
      meet: (batterPlayer.batting?.meet || 50) + stratMeetMod + batterCondMod.meet - fatiguePenalty + batterClutchMod,
      power: (batterPlayer.batting?.power || 50) + stratPowerMod + batterCondMod.power - fatiguePenalty + batterClutchMod,
      eye: (batterPlayer.batting?.eye || 50) + stratEyeMod - Math.floor(fatiguePenalty * 0.5),
      speed: (batterPlayer.physical?.speed || 50) - fatiguePenalty,
      bats: batterPlayer.batting?.bats || 'right',
      // コース適性（内外角・高低の得手不得手）。25セルは持たず2数値から導出する
      zone: getZoneProfile(batterPlayer),
    };

    // 投手の疲労ペナルティ（打者と同じ二次曲線: 疲労0→0, 50→-4, 100→-15）
    const pitcherFatigue = pitcherPlayer.fatigue || 0;
    const pitcherFatiguePenalty = pitcherFatigue > 0 ? Math.round(pitcherFatigue * pitcherFatigue / 670) : 0;

    const pitcherFormEffect = PITCHING_FORM_EFFECTS[pitcherPlayer.pitching?.form] || PITCHING_FORM_EFFECTS.threeQuarter;
    const pitcher = {
      velocity: Math.round((pitcherPlayer.pitching?.velocity || 140) * (pitcherFormEffect.velocityMult || 1.0)) - pitcherFatiguePenalty,
      control: (pitcherPlayer.pitching?.control || 50) + pitcherCondMod - pitcherFatiguePenalty + pitcherClutchMod,
      throws: pitcherPlayer.physical?.throws || 'right',
      spinRate: pitcherPlayer.pitching?.spinRate ?? 50
    };

    // スタミナによる能力低下（2次曲線: スタミナ50%以下で急激に低下）
    const pitcherMaxStamina = pitcherPlayer.pitching?.stamina || 100;
    const staminaRatio = Math.max(0, Math.min(pitcherStamina / pitcherMaxStamina, 1));
    const staminaCurve = staminaRatio * staminaRatio; // 0→0, 0.5→0.25, 0.7→0.49, 1.0→1.0
    const effectiveControl = pitcher.control * (0.6 + 0.4 * staminaCurve);
    const effectiveVelocity = pitcher.velocity * (0.88 + 0.12 * staminaCurve);

    // 左右相性
    const handEffect = getHandednessEffect(pitcher.throws, batter.bats);

    // 投球する球種を選択（捕手のリードが効く。詳細は pitchCalling.js）。
    // 従来はここで変化球を完全ランダムに選んでおり、采配モードだけが
    // リードでスコア選択していた。リーグ成績を作るのは自動側なので、
    // 捕手のリード能力が成績にまったく反映されていなかった。
    // 封印した球は投げない（arsenal.js）。練習・成長からは消さない
    // 回転数を変化量へ織り込む（回転の高い投手は変化球も少し曲がる）。
    // ここで一度だけ掛けることで、球種選択・球速減・コース・スイング判断・
    // 物理エンジンのすべてが同じ実効変化量で動く（simulation-logic.js）
    const arsenal = spinAdjustedArsenal(
      activeArsenal(pitcherPlayer.pitching?.arsenal), pitcher.spinRate);
    const selectedPitch = selectPitchType({
      arsenal,
      catcherLead: catcherPlayer?.catching?.lead ?? 50,
      form: pitcherPlayer.pitching?.form || 'threeQuarter',
      strategy: pitchingStrat,
      strikes: count.strikes,
      // 奥行き: 速球のあとは変化球、変化球のあとは速球（リードが高いほど意識する）
      lastWasBreaking: lastPitch ? lastPitch.isBreaking : null,
      // 場面: 走者一塁ならゴロ系、走者三塁なら空振り系の決め球を選ぶ
      objective: objective.goal,
      // 到達球速で曲がりの効き(breakEfficiency)が変わるので投手の速球を渡す
      velocity: effectiveVelocity,
      // 崩した直後は球速帯を替えずに畳み掛けてよい（pitchSequence.js）
      fooled: fooledLevel(sequence),
      // 守備の堅いチームではゴロ・凡打を狙う球の値打ちが上がる
      infieldDefense: infieldDefenseOf(defense),
    });


    // 変化球の球速減速（緩急効果）
    // 球種ごとの球速減。**采配モードと同じ式を使う**（constants.js）。
    // 以前はここだけ `8 + level/100×15` で、Lv100なら全球種が一律 -23 だった
    let pitchVelocityFinal = effectiveVelocity
      - pitchVelocityDrop(selectedPitch.type, selectedPitch.level ?? 50);

    // 緩急ペナルティ: **前球との**球速差で打者のタイミングが狂う（比率ベース）。
    // 遅い投手ほど同じ球速差でも体感の緩急が大きくなる。
    // 従来は前球ではなく「その投手のストレート」と比べていたうえ、そもそも
    // lastPitch が常に null だったため一度も発火していなかった。
    let speedDiffPenalty = 0;
    if (lastPitch && lastPitch.velocity) {
      const veloDiff = Math.abs(lastPitch.velocity - pitchVelocityFinal);
      const speedDiffRatio = veloDiff / Math.max(lastPitch.velocity, pitchVelocityFinal);
      speedDiffPenalty = speedDiffRatio * 22;
    }

    // ===== 配球 → 投球位置 → スイング判定 =====
    // 制球は「ストライク率」ではなく「狙った所へ投げられる再現性」として効く。
    // 詳細は pitchCalling.js 参照。采配モード(App.jsx)と同じモデルを共有している。
    const isBreaking = selectedPitch.type !== 'straight';
    // 変化球のばらつきは pitchShape.shapeSigma に一本化した
    // （旧 breakingControlPenalty。自動と采配で係数が 0.20 / 0.30 と食い違っていた）
    // 投球方針は配球だけを変える（contact=ゾーンで勝負しやすく / strikeout=誘い球を増やす。
    // callPitchTarget・selectPitchType 側）。⚠ 以前は打たせて取るに制球+4が付いていた
    // （選ぶだけで勝率 .524。いしだ 2026-11-13「型で強さを変えない」で外した）

    const aim = callPitchTarget({
      balls: count.balls, strikes: count.strikes, batterEye: batter.eye,
      catcherLead: catcherPlayer?.catching?.lead ?? 50, strategy: pitchingStrat,
      pitcherControl: effectiveControl, objective,
    });
    const loc = resolvePitchLocation({
      aim,
      control: effectiveControl,
      catcherDefense: catcherPlayer?.fielding?.defense ?? 50,
      // 捕手は打者の弱点コースを要求する（狙いの配分は変えない）
      batterZone: batter.zone,
      catcherLead: catcherPlayer?.catching?.lead ?? 50,
      // 前球との関係（対角へ動かす／同じ引き出しを続けない）
      sequence, velocity: pitchVelocityFinal, isBreaking,
      // 場面: 併殺が欲しければ低め、三振が欲しければ高め
      objective: objective.goal,
      // 球種に合ったコース（速球=高め / スライダーは逃げる側）と、
      // 変化球レベルによる決まりやすさ
      pitchType: selectedPitch.type, pitchLevel: selectedPitch.level ?? 50,
      pitcherThrows: pitcher.throws, batterBats: batter.bats,
    });

    // 揺さぶれた球は打ちにくく、同じ所へ続けた球は打たれやすい（リーグ平均で±0）
    const shift = sequenceShift(lastPitch,
      { col: loc.col, row: loc.row, velocity: pitchVelocityFinal });
    const shiftMeet = shiftMeetAdjust(shift);
    // 同じ引き出しが続くと打者に読まれる。的中の効果は球種の読みと同じ
    // 打者の狙い球（コース）。捕手の要求の偏りと、同じ引き出しの繰り返しで読む
    const locationRead = Math.random()
      < locationReadChance(sequence, loc.col, loc.row, isBreaking, batter.eye, loc.readSignal);

    // 打者の型（野村の4分類）ごとの狙い方。batterType.js
    const aiGuess = resolveAiBatterGuess({
      type: getBatterType(batterPlayer), player: batterPlayer,
      balls: count.balls, strikes: count.strikes,
      isBreaking, col: loc.col, sequence, batterEye: batter.eye,
      // ナックルは読み合いが成立しない（誰にもどこへ来るか分からない）
      // ⚠ 代入は記録（捕手の「狙い球を外した率」）のためだけ。乱数を引く順番は変えない
      guessRight: (lastGuessRight = !isUnreadablePitch(selectedPitch.type) && Math.random() < guessSuccessRate({
        catcherLead: catcherPlayer?.catching?.lead ?? 50,
        // **何球種持っているかではなく、どれだけ幅があるか**（arsenal.js）。
        // 似た球（スライダー＋カット等）は同じ引き出しとして数えない
        arsenalSize: effectiveArsenalSize(arsenal), batterEye: batter.eye,
        // 崩された直後は球種を読むどころではない
        fooled: fooledLevel(sequence),
        // 出どころが見えなければ球種も判断できない（deception.js）
        deception: deceptionAxis(getDeception(pitcherPlayer)),
      })),
    });
    const guessLevel = Math.max(-2, Math.min(2, aiGuess.level + (locationRead ? 1 : 0)));
    pushCall(sequence, {
      col: loc.col, row: loc.row, isBreaking,
      velocity: pitchVelocityFinal, type: selectedPitch.type,
    });

    observer?.pitchDetail?.({ type: selectedPitch.type, velocity: pitchVelocityFinal, col: loc.col, row: loc.row });

    // そのセルが打者にとってどれだけ苦手か。スイング判断・打撃補正・振り方で共有する
    const weakness = zoneWeaknessAt(loc, batter.zone);
    const swung = decideSwing({
      inZone: loc.inZone, quality: loc.quality, strikes: count.strikes, batterEye: batter.eye,
      pitcherControl: effectiveControl, isBreaking, breakingLevel: selectedPitch.level || 50,
      // 打者は自分の得意コースをより振る
      zoneWeakness: weakness,
      // B型は張っていないコースを見送る
      approachMult: aiGuess.swingMult ?? 1,
      // 崩された打者はゾーンを広げる（pitchCalling.js）
      fooled: fooledLevel(sequence),
    });

    // 打球の解決。投球位置の質（甘い球=meatball / 際どい球=edge / ボール球）で
    // 打者の実効ミート・パワーを補正してから物理エンジンに渡す。
    const resolveContact = (mod) => {
      const effBatter = {
        ...batter,
        meet: Math.max(1, Math.min(100, batter.meet + (mod?.meet || 0))),
        power: Math.max(1, Math.min(100, batter.power + (mod?.power || 0))),
        // C型（方向決定型）が決めた打球方向
        dirBias: aiGuess.dirBias,
      };
      const pitchData = {
        type: selectedPitch.type,
        velocity: pitchVelocityFinal,
        level: selectedPitch.level || 50
      };
      const tunnelingEffect = lastPitch ? getTunnelingEffect(lastPitch, pitchData, catcherPlayer?.catching?.lead || 50) : 0;

      // 物理コンタクト計算
      const physicsResult = calculatePhysicsContact(
        { velocity: effectiveVelocity, throws: pitcher.throws, form: pitcherPlayer.pitching?.form || 'threeQuarter', spinRate: pitcherPlayer.pitching?.spinRate ?? 50,
          deception: deceptionAxis(getDeception(pitcherPlayer)) },
        effBatter,
        // 打者の狙い球。球種とコースを別々に張り、当たった数で効果が変わる
        // （1つ=タイミング窓×1.30 / 両方=×1.50。simulation-logic.js）。
        // 従来は球種だけで、しかも 0.3/0.2 の固定値だった。
        guessLevel,
        pitchData,
        tunnelingEffect,
        handEffect
      );

      // 崩されたか（芯品質）を打席の記憶に残す。次の球の振り方に効く
      pushSwingQuality(sequence, physicsResult.isContact ? physicsResult.meetQuality : null);
      if (!physicsResult.isContact) {
       
        return { type: 'swinging_strike' };
      }

      // ファウル: タイミングを外した打球は左右のファウルゾーンへ切れる。
      // 実データでは全投球の約17%（＝コンタクトの4割弱）がファウルで、打席が長引く。
      // これが無いとコンタクトが即座に打席を終わらせてしまい、四球が構造的に出ない。
      const foulProb = contactFoulProbability(physicsResult.meetQuality, count.strikes);
      if (Math.random() < foulProb) {
        return { type: 'foul' };
      }

      // 打球物理パラメータ計算
      // 緩急（前球との速度差）を打球方向に効かせるため lastPitch を渡す
      const battedBall = calculateBattedBallPhysics(effBatter, pitcher, pitchData, physicsResult, loc, lastPitch);

      if (isDirectionalFoul(battedBall.direction)) return { type: 'foul' };

      // 守備判定
      const fieldResult = judgeFielderReach(battedBall, defense, effBatter);

      if (fieldResult.result === 'homerun') {
        return { type: 'homerun' };
      } else if (fieldResult.result === 'out') {
        // 2アウトからは併殺が成立しない（打者アウトで3アウト目）。
        // outs のチェックが無かったため、2アウトから「4アウト目」が記録され
        // 投手の投球回がわずかに水増しされていた。
        // 併殺。**内野ゴロのアウトなら距離は問わない**。
        // 以前は `distance < 40` も条件にしていたが、この分岐に来た時点で
        // 内野手が捕球している（外野へ抜けた打球は 'out' にならない）ので
        // 二重の門番になっており、実NPBの1/4しか併殺が出ていなかった。
        if (bases[0] && gameState.outs < 2 && battedBall.launchAngle < 10
            && !fieldResult.isOutfieldFly) {
          const ifDefense = ['second', 'short'].map(p => defense[p]?.defense || 50);
          const ifAvg = ifDefense.reduce((a, b) => a + b, 0) / 2;
          // 走者の足が速いと二塁が間に合わない／一塁がセーフになる
          const runnerSpeed = bases[0]?.physical?.speed ?? 55;
          const dpBase = DP_BASE + (ifAvg - 50) * 0.35 - (runnerSpeed - 55) * 0.30;
          if (Math.random() * 100 < dpBase) {
            return { type: 'double_play' };
          }
        }
        return {
          type: 'out',
          isOutfieldFly: fieldResult.isOutfieldFly || false,
          // 内野ゴロは走者を進める（ゴロGO・進塁打）。フライ・ライナーは進まない
          isGroundOut: battedBall.launchAngle < 10 && !fieldResult.isOutfieldFly,
          tagupThrowbackChance: fieldResult.tagupThrowbackChance || 0,
          fieldingPosition: fieldResult.fieldingPosition
        };
      } else if (fieldResult.result === 'triple') {
        return { type: 'triple', fieldingPosition: fieldResult.fieldingPosition };
      } else if (fieldResult.result === 'double') {
        return { type: 'double', fieldingPosition: fieldResult.fieldingPosition };
      } else {
        return {
          type: 'single',
          isError: fieldResult.isError || false,
          hitWithError: !!fieldResult.hitWithError,
          errorPosition: fieldResult.errorPosition,
          fieldingPosition: fieldResult.fieldingPosition,
          // 悪送球・中継ミスは走者が余分に1つ進む
          extraAdvance: !!fieldResult.extraAdvance || !!fieldResult.isThrowingError,
        };
      }
    };

    // コース適性: 苦手なコースに来るとミート・パワーが落ちる（得意なら上がる）。
    // 母集団の平均は0なのでリーグ成績は動かず、打者ごとの差だけが出る。
    // コース適性 + 前球からの揺さぶり（どちらもリーグ平均では±0）
    // 振り方: 得意コース・打者有利カウントならフルスイング、
    // 苦手コース・2ストライクなら当てにいく（swingType.js）
    const swingPower = swung ? decideSwingPower({
      weakness, balls: count.balls, strikes: count.strikes,
      // 前の球で崩されていれば当てにいく（pitchSequence.js）
      fooled: fooledLevel(sequence),
      meet: batter.meet, power: batter.power, approach: battingStrat,
    }) : 0;
    const matchup = combineBatterEffects(
      combineBatterEffects(
        combineBatterEffects(getZoneMatchupEffect(loc, batter.zone),
          // 高めの速球・低めの変化球は空振りを取れる（逆は打たれる）
          getHeightPitchEffect(loc.row, isBreaking)),
        getSwingPowerEffect(swingPower)),
      { meet: shiftMeet, power: shiftMeet * 0.6 });

    if (loc.inZone) {
      if (!swung) { decayFooled(sequence); return { type: 'called_strike' }; }
      const q = combineBatterEffects(getPitchQualityEffect(loc.quality), matchup);
      const breakingPenalty = isBreaking ? (selectedPitch.level || 50) * 0.12 : 0;
      const contactChance = 82 + (batter.meet + q.meet) * 0.45
        + (handEffect.meetBonus || handEffect.meetPenalty || 0) - breakingPenalty - speedDiffPenalty;
      if (Math.random() * 100 >= contactChance) { pushSwingQuality(sequence, null); return { type: 'swinging_strike' }; }
      return resolveContact(q);
    }

    // ボールゾーン。振ってしまった場合は半分以上バットに当たり、凡打になる。
    // 以前は「20%ファウル / 80%空振り」で打球が一切発生せず、chase率を上げると
    // 三振だけが増えてしまう構造だった。
    if (!swung) {
      decayFooled(sequence);
      // あまりにも内角へ外れた球は打者に当たる（pitchZone.js）。
      // 振って当たればストライクなので、見送った球にだけ問う
      if (Math.random() < hitByPitchChance(loc.col, loc.row)) {
        return { type: 'hit_by_pitch', velocity: pitchVelocityFinal };
      }
      return { type: 'ball' };
    }
    if (Math.random() >= ballZoneContactChance(batter.eye)) { pushSwingQuality(sequence, null); return { type: 'swinging_strike' }; }
    if (Math.random() < 0.56) return { type: 'foul' };
    return resolveContact(combineBatterEffects(BALL_ZONE_PENALTY, matchup));
  };

  // 守備機会（刺殺・補殺）を1つ記録する。守備位置が取れないものは無視する
  const addFieldingChance = (team, position) => {
    if (!position || !team) return;
    const f = team.players.find(p => p.position === position && p.battingOrder >= 1 && !p._isDH);
    if (f?.gameStats?.fielding) f.gameStats.fielding.chances++;
  };

  // 走者進塁処理（外野手の肩で進塁を抑制）
  // bases配列にはプレイヤーオブジェクト or false が格納される
  // hitType に応じて走者を進める。
  // 自責点判定のため、失策で出塁した走者には _reachedOnError を立てておき（塁の移動に追随する）、
  // 生還した非自責走者の数を unearnedRunsScored として返す。
  // extraAdvance: 悪送球・中継ミスで既存の走者が余分に1つ進むケース
  // fieldingPosition: 打球を処理した野手（捕殺の記録先）
  // 戻り値の outsMade / assistBy は呼び出し側でアウト加算・捕殺記録に使う
  const advanceRunners = (hitType, bases, defense, batter, extraAdvance = false, fieldingPosition = null, currentOuts = 0) => {
    const newBases = [false, false, false];
    let runsScored = 0;
    let unearnedRunsScored = 0;
    let outsMade = 0;
    let assistBy = null;
    const isUnearnedRunner = (r) => !!(r && r._reachedOnError);

    if (hitType === 'homerun') {
      runsScored = 1 + bases.filter(b => b).length;
      unearnedRunsScored = bases.reduce((n, b) => n + (isUnearnedRunner(b) ? 1 : 0), 0)
        + (isUnearnedRunner(batter) ? 1 : 0);
      return { bases: [false, false, false], runsScored, unearnedRunsScored, outsMade: 0, assistBy: null };
    }

    const advancement = hitType === 'single' ? 1 : hitType === 'double' ? 2 : 3;

    // 外野手の平均肩力（進塁抑制に使用）
    const ofArms = ['left', 'center', 'right'].map(p => defense?.[p]?.arm || 60);
    const avgArm = ofArms.reduce((a, b) => a + b, 0) / 3;

    for (let i = 2; i >= 0; i--) {
      if (bases[i]) {
        let newBase = i + advancement;

        // 肩による進塁抑制: シングルで1塁走者が3塁を狙う、2塁走者がホームを狙う等
        // 強肩の場合、余分な進塁（1塁→3塁、2塁→本塁on single）をブロック
        // 積極進塁（単打で1塁→3塁 / 2塁→本塁）の駆け引き。
        // 足が速い走者ほど狙い、外野の肩が強いほど自重する。狙って失敗すれば捕殺で刺される。
        const runner = bases[i];
        const runnerSpeed = (runner && typeof runner === 'object' && runner.physical?.speed) || 55;
        // 積極進塁（単打で 2塁→本塁 / 1塁→3塁、二塁打で 1塁→本塁）。詳細は baserunning.js 参照
        if (!extraAdvance && outsMade === 0) {
          const thrower = fieldingPosition ? (defense?.[fieldingPosition] || null) : null;
          const cutoff = defense?.short || defense?.second || { defense: 60 };
          const { attempt, thrownOut } = tryExtraAdvance({
            hitType, fromBase: i, runnerSpeed, avgArm, currentOuts,
            throwerArm: thrower?.arm ?? null, cutoffDefense: cutoff.defense || 60,
          });
          if (attempt && thrownOut) {
            outsMade++;
            assistBy = fieldingPosition || null;
            continue; // 刺された → 進塁も得点もしない
          }
          if (attempt) newBase++; // 賭けに勝って余分に進塁
        }
        // 悪送球・中継ミス: 送球が乱れているので走者が余分に1つ進む
        if (extraAdvance) newBase++;

        if (newBase >= 3) {
          runsScored++;
          if (isUnearnedRunner(bases[i])) unearnedRunsScored++;
        } else {
          newBases[newBase] = bases[i]; // プレイヤー参照を維持（_reachedOnError も追随）
        }
      }
    }

    // 打者自身を塁に配置
    if (advancement < 3) {
      newBases[advancement - 1] = batter || true;
    } else {
      runsScored++;
      if (isUnearnedRunner(batter)) unearnedRunsScored++;
    }

    return { bases: newBases, runsScored, unearnedRunsScored, outsMade, assistBy };
  };

  // 得点を投手の自責点に計上する（失点は呼び出し側で別途加算済み）。
  //   非自責となるのは
  //     (a) 失策で出塁した走者が生還した分
  //     (b) 失策が無ければ既に3アウトだった後の得点（そのイニングは以降すべて非自責）
  const creditRuns = (pitcher, runsScored, unearnedRunsScored = 0) => {
    if (!pitcher || runsScored <= 0) return;
    const ps = pitcher.gameStats.pitching;
    const inningOver = (gameState.outs + (gameState.inningErrorOuts || 0)) >= 3;
    const earned = inningOver ? 0 : Math.max(0, runsScored - (unearnedRunsScored || 0));
    ps.earnedRuns = (ps.earnedRuns || 0) + earned;
  };

  // 盗塁判定（AI監督）- 走者の実際の走力を使用
  const attemptStolenBase = (offenseTeam, defenseTeam) => {
    if (offenseTeam.strategy?.baseRunning === 'never') return null;
    const pitcher = getCurrentPitcher(defenseTeam);
    const catcher = getCurrentCatcher(defenseTeam);

    for (let base = 0; base < 2; base++) {
      if (gameState.bases[base] && !gameState.bases[base + 1]) {
        // 塁上の走者オブジェクトから直接走力を取得
        const runner = gameState.bases[base];
        const runnerSpeed = (typeof runner === 'object' && runner?.physical?.speed)
          ? runner.physical.speed
          : offenseTeam.players.filter(p => p.battingOrder > 0 && p.battingOrder <= 9)
              .reduce((sum, p) => sum + (p.physical?.speed || 50), 0) / 9;

        const catcherArm = catcher?.physical?.arm || 50;
        // 盗塁の判断・成否は采配モードと共有する（stealing.js）。
        // 以前は2エンジンが別式で、しかもこちらは盗塁スキル(steal)を見ていなかった
        const runnerSteal = (typeof runner === 'object' && runner?.batting?.steal) ?? 50;
        const successChance = stealSuccessRate({
          runnerSpeed, runnerSteal, catcherArm,
          pitcherControl: pitcher?.pitching?.control || 50,
          pitcherThrows: pitcher?.physical?.throws || 'right',
          toBase: base + 2,
        });
        const attemptRate = stealAttemptRate({
          successRate: successChance, runnerSteal, outs: gameState.outs, toBase: base + 2,
          strategy: offenseTeam.strategy?.baseRunning || 'normal',
        });

        if (Math.random() < attemptRate) {
          if (Math.random() < successChance) {
            const stolenRunner = gameState.bases[base];
            gameState.bases[base] = false;
            gameState.bases[base + 1] = stolenRunner;
            // 盗塁成功を実際の走者の成績に記録
            if (typeof stolenRunner === 'object' && stolenRunner?.gameStats?.batting) {
              stolenRunner.gameStats.batting.stolenBases = (stolenRunner.gameStats.batting.stolenBases || 0) + 1;
            }
            const runnerName = typeof stolenRunner === 'object' ? stolenRunner.name : '走者';
            return { success: true, base };
          } else {
            // 刺すはずの送球が乱れると走者は生き、さらに次の塁まで進む（捕手の失策）。
            // 送り手＝捕手の肩、受け手＝二塁/三塁カバーの守備で判定する。
            const coverPos = base === 0 ? 'second' : 'third';
            const cover = defenseTeam.players.find(p => p.position === coverPos && p.battingOrder >= 1 && !p._isDH);
            const throwErr = getThrowErrorRate(catcherArm, cover?.fielding?.defense ?? 60, 0.4);
            if (Math.random() < throwErr) {
              const runnerObj = gameState.bases[base];
              gameState.bases[base] = false;
              // 悪送球で1つ余分に進む。⚠ 先の塁が埋まっていたら盗んだ塁で止まる
              //    （以前は三塁走者を上書きして消していた）
              const dest = (base + 2 <= 2 && gameState.bases[base + 2]) ? base + 1 : base + 2;
              if (dest <= 2) {
                gameState.bases[dest] = runnerObj;
              } else {
                // 生還（失策絡みなので非自責）
                if (runnerObj && typeof runnerObj === 'object') runnerObj._reachedOnError = true;
                if (gameState.isTopInning) gameState.score.away++;
                else gameState.score.home++;
                const p = getCurrentPitcher(defenseTeam);
                if (p?.gameStats?.pitching) p.gameStats.pitching.runsAllowed++;
              }
              if (catcher?.gameStats?.fielding) {
                catcher.gameStats.fielding.errors++;
                catcher.gameStats.fielding.chances++;
              }
              return { success: true, base, throwError: true };
            }
            gameState.bases[base] = false;
            gameState.outs++;
            // ⚠ 盗塁死のアウトも投手の投球回に入る（以前は抜けていて、投球回が試合で26や23になった）
            if (pitcher?.gameStats?.pitching) pitcher.gameStats.pitching.outs++;
            // 盗塁死を走者の成績に記録する（従来は記録されておらず成功率が常に100%だった）
            if (typeof runner === 'object' && runner?.gameStats?.batting) {
              runner.gameStats.batting.caughtStealing = (runner.gameStats.batting.caughtStealing || 0) + 1;
            }
            // 盗塁刺は捕手の補殺＋塁のカバーの刺殺
            if (catcher?.gameStats?.fielding) {
              catcher.gameStats.fielding.chances++;
              catcher.gameStats.fielding.assists = (catcher.gameStats.fielding.assists || 0) + 1;
            }
            if (cover?.gameStats?.fielding) cover.gameStats.fielding.chances++;
            return { success: false, base };
          }
        }
      }
    }
    return null;
  };

  // バント実行（結果判定）
  const executeBunt = (buntType, batterPlayer, pitcherPlayer, catcherPlayer, defense, bases, outs) => {
    const buntSkill = batterPlayer.batting?.bunt || 30;
    const meet = batterPlayer.batting?.meet || 50;
    const speed = batterPlayer.physical?.speed || 50;

    // Step 1: フェア/ファウル/フライ判定（式は `bunting.js` で采配モードと共有）
    const contact = classifyBuntContact(Math.random() * 100, buntSkill, meet);
    if (contact === 'popup') return { type: 'bunt_popup' };
    if (contact === 'foul') return { type: 'bunt_foul' };

    // Step 2: バントの質
    const quality = rollBuntQuality(buntSkill, meet);

    // Step 3: 守備の送球アウト判定
    const avgFieldDef = buntFieldDefense(
      defense.pitcher?.defense, defense.first?.defense,
      defense.third?.defense, catcherPlayer?.fielding?.defense);
    const batterOut = Math.random() * 100 < buntThrowOutChance(buntType, speed, quality, avgFieldDef);

    // スクイズ時の本塁送球判定（3塁走者のセーフ/アウト）
    let squeezeRunnerSafe = true;
    if (buntType === 'squeeze' && bases[2]) {
      squeezeRunnerSafe = Math.random() * 100 >= squeezeHomeThrowChance(quality, avgFieldDef);
    }

    return { type: 'bunt_fair', batterOut, quality, buntType, squeezeRunnerSafe };
  };

  // バントAI判定
  const decideBunt = (batter, offenseTeam, gameState) => {
    const { bases, outs } = gameState;
    const myScore = gameState.isTopInning ? gameState.score.away : gameState.score.home;
    const oppScore = gameState.isTopInning ? gameState.score.home : gameState.score.away;
    const scoreDiff = myScore - oppScore;
    const isCloseGame = Math.abs(scoreDiff) <= 2;
    const buntSkill = batter.batting?.bunt || 30;
    const batterTotal = (batter.batting?.meet || 0) + (batter.batting?.power || 0);
    const batterSpeed = batter.physical?.speed || 50;
    // ⚠ 「投手が打席に立っている」は**その試合の守備位置**で見る。登録や能力
    //    （`isPitcher` はスタミナ100以上も投手とみなす）で見ると、野手で出ている
    //    二刀流の投手まで投手扱いになり、送りバントや代打の対象になっていた
    const isPitcherBatter = batter.position === 'pitcher';

    // スクイズ: 3塁ランナー、1アウト、接戦、バント能力40以上
    if (bases[2] && outs === 1 && isCloseGame && buntSkill >= 40) {
      const squeezeChance = isPitcherBatter ? 0.60 :
                            (buntSkill >= 60 && batterTotal < 110) ? 0.40 :
                            (buntSkill >= 50) ? 0.25 : 0.10;
      if (Math.random() < tacticalChance(squeezeChance, offenseTeam.onlineTactics?.squeeze)) return 'squeeze';
    }

    // 犠打: 1塁or2塁ランナー、0-1アウト、弱打者or投手
    if ((bases[0] || bases[1]) && !bases[2] && outs <= 1) {
      const shouldSacrifice = isPitcherBatter ||
                              (batterTotal < 100 && buntSkill >= 35) ||
                              (buntSkill >= 60 && batterTotal < 120);
      if (shouldSacrifice) {
        const sacChance = isPitcherBatter ? 0.70 :
                          (gameState.inning >= 7 && isCloseGame) ? 0.50 : 0.35;
        if (Math.random() < tacticalChance(sacChance, offenseTeam.onlineTactics?.sacrificeBunt)) return 'sacrifice';
      }
    }

    // セーフティ: 俊足+バント巧者、0-1アウト
    if (batterSpeed >= 75 && buntSkill >= 55 && outs <= 1) {
      if (!bases[0] || (bases[0] && !bases[1] && !bases[2])) {
        const safetyChance = 0.05 + (batterSpeed - 75) * 0.003 + (buntSkill - 55) * 0.002;
        if (Math.random() < tacticalChance(safetyChance, offenseTeam.onlineTactics?.safetyBunt)) return 'safety';
      }
    }

    return null;
  };

  // 代打判定（AI監督）- 状況判断・理由付き版
  const considerPinchHitter = (offenseTeam, batter) => {
    if (offenseTeam.onlineTactics?.pinchHit === 'never' || gameState.inning < (offenseTeam.onlineTactics?.pinchHitFrom || 0)) return batter;
    const benchFielders = offenseTeam.players.filter(p =>
      p.isActive !== false && p.battingOrder === 0 && !isPitcher(p) && !gameState.removedIds.has(p.id)
    );
    if (benchFielders.length === 0) return batter;
    const offenseKey = offenseTeam === gameState.homeTeam ? 'home' : 'away';

    // 控え選手の中から最強打者を選ぶヘルパー
    const getBestBench = () => benchFielders.reduce((best, p) => {
      const total = (p.batting?.meet || 0) + (p.batting?.power || 0);
      const bestTotal = (best.batting?.meet || 0) + (best.batting?.power || 0);
      return total > bestTotal ? p : best;
    }, benchFielders[0]);

    // 代打実行ヘルパー
    const executePinchHit = (pinchHitter, reason) => {
      const batterData = offenseTeam.players.find(p => p.id === batter.id);
      const phData = offenseTeam.players.find(p => p.id === pinchHitter.id);
      if (batterData && phData) {
        const forPitcher = batterData.id === gameState.currentPitcherId[offenseKey];
        if (forPitcher) {
          // ⚠ 代打を出すのは**次の守備で実際に選ばれる投手が居るとき**だけ。継投の選び方と
          //    同じ範囲で見る: 救援の欄（登録を問わない）で疲労50未満の人か、打順に居ない
          //    投手（緊急の登板）。ローテの野手は救援に選ばれないので数えない。数えると
          //    代打の後に誰も上がれず、退いた投手が投げ続け、代打が9番に残っていた
          const removed = new Set([...gameState.removedIds, batterData.id, phData.id]);
          const rotation = offenseTeam.pitchingRotation || {};
          const reliefFatigue = rotation.reliefFatigue || {};
          const bullpen = new Set([
            ...(rotation.middleRelievers || []), ...(rotation.setupMen || []), rotation.closer,
          ].filter(Boolean));
          if (!offenseTeam.players.some(p =>
            ((isPitcher(p) && (p.battingOrder || 0) === 0) ||
              (bullpen.has(p.id) && (reliefFatigue[p.id] || 0) < 50)) &&
            canEnterRelief(offenseTeam.players, p.id, batterData.id, removed)
          )) return batter;
        }
        phData.battingOrder = batterData.battingOrder;
        if (forPitcher) {
          // 投手の打順に入った代打は、次の守備で継投の投手と入れ替わる（守備には就かない）
          gameState.pitcherPinchHit[offenseKey] = { slot: batterData.battingOrder, phId: phData.id };
        } else if (batterData._isDH) {
          // ⚠ **DHへの代打はDHのまま**（守備には就かない）。以前は守備位置だけ写して
          //    DHの印を付けず、代打が本来の野手と同じ守備位置に重なっていた
          //    （守備の記録がDHに付く・捕手が二人になる、など）
          phData._isDH = true;
        } else {
          phData.position = batterData.position;
          delete phData._isDH;
        }
        batterData.battingOrder = 0;
        gameState.removedIds.add(batterData.id);
        return pinchHitter;
      }
      return batter;
    };

    const batterTotal = (batter.batting?.meet || 0) + (batter.batting?.power || 0);
    const bestBench = getBestBench();
    const bestBenchTotal = bestBench ? (bestBench.batting?.meet || 0) + (bestBench.batting?.power || 0) : 0;

    const myScore = gameState.isTopInning ? gameState.score.away : gameState.score.home;
    const oppScore = gameState.isTopInning ? gameState.score.home : gameState.score.away;
    const scoreDiff = myScore - oppScore;
    const runnersOn = gameState.bases.filter(Boolean).length;
    const isScoring = gameState.bases[1] || gameState.bases[2];

    // 1. 投手の打順：代打を出すと**その投手は降板する**（次の守備で継投）。
    //    ⚠ 「6回以降・控えの方が少しでも打てる」だけで出すと、控えは必ず投手より打てるので
    //    好投中の先発まで6回で降ろしてしまう（実測 先発の平均投球回 5.20→4.51回、
    //    6回以上 41%→24%）。代打は「点が欲しい場面」か「先発がもう限界」のときだけ。
    // ⚠ 打席の投手は**その試合の守備位置**で見る（上の `isPitcherBatter` と同じ理由）
    if (batter.position === 'pitcher') {
      const stRate = (batter.currentStamina || 0) / Math.max(1, batter.pitching?.stamina || 100);
      const tired = stRate < 0.40 || (batter.gameStats?.pitching?.pitches || 0) >= 95;
      const needRuns = scoreDiff <= 0 && (isScoring || gameState.inning >= 8);
      if (gameState.inning >= 6 && (tired || needRuns)
          && bestBench && ((bestBench.batting?.meet || 0) > (batter.batting?.meet || 0) + 5)) {
        return executePinchHit(bestBench,
          needRuns ? `${gameState.inning}回、投手に代打（${scoreDiff < 0 ? '反撃' : '勝ち越し'}の好機）`
                   : `${gameState.inning}回、疲れの見える投手に代打`);
      }
      // ⚠ 投手の打席には以下の汎用ルールを当てない（どれも「控えの方が打てる」で成立するため）
      return batter;
    }

    // 2. 7回以降、得点圏にランナーがいて打撃力差が大きい
    if (gameState.inning >= 7 && isScoring && bestBenchTotal > batterTotal + 10) {
      const runnerDesc = gameState.bases[2] ? '三塁' : '二塁';
      return executePinchHit(bestBench, `チャンス(${runnerDesc}にランナー)で打撃力の高い代打`);
    }

    // 3. 8回以降、ビハインドで下位打線に代打
    if (gameState.inning >= 8 && scoreDiff < 0 && batter.battingOrder >= 6 && bestBenchTotal > batterTotal + 5) {
      return executePinchHit(bestBench, `${Math.abs(scoreDiff)}点ビハインド、反撃のため代打起用`);
    }

    // 4. 9回以降、接戦でランナーあり、少しでも打力が上がるなら代打
    if (gameState.inning >= 9 && Math.abs(scoreDiff) <= 2 && runnersOn > 0 && bestBenchTotal > batterTotal + 3) {
      const situationDesc = scoreDiff < 0 ? `${Math.abs(scoreDiff)}点ビハインド最終回の勝負` :
                           scoreDiff === 0 ? '同点の勝負所' : 'リード守る一打';
      return executePinchHit(bestBench, `${situationDesc}、${bestBench.name}に託す`);
    }

    // 5. 7回以降、接戦でランナー2人以上、控えの方が打撃力が高い
    if (gameState.inning >= 7 && Math.abs(scoreDiff) <= 3 && runnersOn >= 2 && bestBenchTotal > batterTotal) {
      return executePinchHit(bestBench, `接戦の大チャンス(ランナー${runnersOn}人)で代打起用`);
    }

    return batter;
  };

  // 守備固め判定（AI監督）- イニング終了時に呼ばれる
  const considerDefensiveReplacement = (defenseTeam) => {
    if (defenseTeam.onlineTactics?.defensiveSub === 'never' || gameState.inning < (defenseTeam.onlineTactics?.defenseFrom || 0)) return;
    const isLeading = gameState.isTopInning
      ? gameState.score.home > gameState.score.away
      : gameState.score.away > gameState.score.home;
    const scoreDiff = gameState.isTopInning
      ? gameState.score.home - gameState.score.away
      : gameState.score.away - gameState.score.home;

    const benchFielders = defenseTeam.players.filter(p =>
      p.isActive !== false && p.battingOrder === 0 && !isPitcher(p) && !gameState.removedIds.has(p.id)
    );
    if (benchFielders.length === 0) return;

    // 1. 7回以降リード時: 守備力が低いスタメンを守備固め（閾値緩め）
    if (gameState.inning >= 7 && isLeading) {
      defenseTeam.players.forEach(starter => {
        if (starter.battingOrder > 0 && starter.position !== 'pitcher' && !starter._isDH) {
          const starterDef = starter.fielding?.defense || 50;
          if (starterDef < 60) {
            const replacement = benchFielders.find(p =>
              p.battingOrder === 0 &&
              (p.fielding?.defense || 0) > starterDef + 8
            );
            if (replacement) {
              replacement.battingOrder = starter.battingOrder;
              replacement.position = starter.position;
              // 守備に就く（DH の印が残っていると守備の検索に掛からず、その位置が空になる）
              delete replacement._isDH;
              starter.battingOrder = 0;
              gameState.removedIds.add(starter.id);
            }
          }
        }
      });
    }

    // ⚠ 旧「2. 8回以降リード時の代走」は撤去した。この関数はイニング終了時に呼ばれるので
    //    塁上は**終わった攻撃の残塁**で、代走の意味が無いうえ、残塁していた投手を
    //    代走と入れ替えて position='pitcher' の野手を打順9に作り、継投時に打順が重複していた

    // 3. 6回以降大量リード: 控え野手を順番に出場させる（経験積ませる）
    if (gameState.inning >= 6 && scoreDiff >= 5) {
      const activeBench = benchFielders.filter(p => p.battingOrder === 0);
      if (activeBench.length > 0) {
        // 出場機会が少ない控えを優先
        const leastUsed = activeBench.reduce((best, p) => {
          const pGames = (p.seasonStats?.games || 0);
          const bGames = (best.seasonStats?.games || 0);
          return pGames < bGames ? p : best;
        }, activeBench[0]);

        // 打撃が最も弱いスタメンと交代（投手・DHは守備固め対象外）
        const starters = defenseTeam.players.filter(p => p.battingOrder > 0 && p.position !== 'pitcher' && !p._isDH);
        if (starters.length > 0) {
          const weakest = starters.reduce((w, p) => {
            const wBat = (w.batting?.meet || 0) + (w.batting?.power || 0);
            const pBat = (p.batting?.meet || 0) + (p.batting?.power || 0);
            return pBat < wBat ? p : w;
          }, starters[0]);

          leastUsed.battingOrder = weakest.battingOrder;
          leastUsed.position = weakest.position;
          delete leastUsed._isDH;
          weakest.battingOrder = 0;
          gameState.removedIds.add(weakest.id);
        }
      }
    }
  };

  // AI監督: 打席間のピンチ投手交代（ロールベース対応）
  const considerMidInningPitcherChange = (defenseTeam, currentPitcher, gs) => {
    const teamName = defenseTeam === gs.homeTeam ? homeTeamName : awayTeamName;
    const teamKey = defenseTeam === gs.homeTeam ? 'home' : 'away';
    const team = TEAMS_DATA[teamName];
    if (!team) return;
    const rotation = team.pitchingRotation;
    if (!rotation) return;
    const fatigue = rotation.reliefFatigue || {};
    const pitcherRoles = rotation.pitcherRoles || {};
    const reliefTrack = gs.reliefTracking[teamKey];

    const pitcherData = defenseTeam.players.find(p => p.id === currentPitcher.id);
    if (!pitcherData) return;
    const staminaRate = pitcherData.currentStamina / (currentPitcher.pitching?.stamina || 80);

    const scoreDiff = defenseTeam === gs.homeTeam
      ? gs.score.home - gs.score.away
      : gs.score.away - gs.score.home;

    const runnersOn = gs.bases.filter(Boolean).length;
    const isLate = gs.inning >= 7;

    let shouldChange = false;
    let situation = 'middle';
    let changeReason = '';

    // ワンポイント投手の1打者制限チェック
    const currentPitcherRole = pitcherRoles[currentPitcher.id] || '';
    if (currentPitcherRole === 'onepoint' && reliefTrack.currentRelieverId === currentPitcher.id) {
      if (reliefTrack.relieverBattersFaced >= 1) {
        shouldChange = true;
        situation = 'middle';
        changeReason = `ワンポイント${currentPitcher.name}が1打者対戦済み、交代`;
      }
    }

    // セットアッパー/中継ぎエース: 失点したら即交代（イニング途中でも）
    if (!shouldChange && reliefTrack.currentRelieverId === currentPitcher.id) {
      if (currentPitcherRole === 'setup' || currentPitcherRole === 'ace_relief') {
        const currentRuns = pitcherData.gameStats?.pitching?.runsAllowed || 0;
        const inningStartRuns = gs.inningStartRuns?.[teamKey] || 0;
        const inningRuns = currentRuns - inningStartRuns;
        if (inningRuns > 0) {
          shouldChange = true;
          situation = 'middle';
          changeReason = `${currentPitcherRole === 'setup' ? 'セットアッパー' : '中継ぎエース'}${currentPitcher.name}が失点、緊急交代`;
        }
      }
    }

    // === 新降板ルール: 打席間チェック（対戦中の勝負が終わったタイミング） ===
    const isRelieverMid = reliefTrack.currentRelieverId === currentPitcher.id;
    const totalPitchesMid = pitcherData.gameStats?.pitching?.pitches || 0;

    // 条件1: 球数制限（ロール別）
    if (!shouldChange) {
      const pitchLimit = tacticalPitchLimit(pitchLimitFor(currentPitcherRole, isRelieverMid, currentPitcher.pitching?.stamina), isRelieverMid, defenseTeam.onlineTactics);
      if (totalPitchesMid >= pitchLimit) {
        shouldChange = true;
        situation = Math.abs(scoreDiff) <= 2 ? 'hold' : 'middle';
        changeReason = `${currentPitcher.name}が球数制限到達(${totalPitchesMid}/${pitchLimit}球)`;
      }
    }

    // 条件2: スタミナ25%以下
    if (!shouldChange && staminaRate < 0.25) {
      shouldChange = true;
      situation = 'middle';
      changeReason = `${currentPitcher.name}のスタミナ限界(${Math.round(staminaRate * 100)}%)`;
    }

    // 条件3: ダメージポイント制（先発のみ）
    if (!shouldChange && !isRelieverMid) {
      const threshold = tacticalDamageLimit(damageThreshold(gs.inning, staminaRate), defenseTeam.onlineTactics);
      const currentDamage = gs.starterDamagePoints[teamKey];
      if (currentDamage >= threshold) {
        shouldChange = true;
        situation = Math.abs(scoreDiff) <= 2 ? 'hold' : 'middle';
        changeReason = `先発${currentPitcher.name}がダメージ蓄積で降板(DP:${currentDamage}/${threshold})`;
      }
    }

    // 9回リード時→クローザー必須。
    // ⚠ **同点(0点差)も含める**。実際の監督は9回同点でも守護神を投入する。
    //    セーブ機会（1チーム110試合あたり32.6回）だけだと登板が28%に留まり、
    //    実NPBの35〜42%に届かない。同点を足して34%になる。
    if (!shouldChange && gs.inning >= 9 && scoreDiff >= 0 && scoreDiff <= 3) {
      if (closerCanEnter(rotation, gs, teamKey, currentPitcher.id, defenseTeam.players)) {
        shouldChange = true;
        situation = 'save';
        changeReason = scoreDiff === 0 ? `9回同点、守護神を投入` : `9回${scoreDiff}点リード、守護神を投入`;
      }
    }
    // 8回僅差→セットアッパー
    if (!shouldChange && gs.inning === 8 && Math.abs(scoreDiff) <= 2) {
      const isSetup = (rotation.setupMen || []).includes(currentPitcher.id);
      const isCloser = rotation.closer && currentPitcher.id === rotation.closer;
      if (!isSetup && !isCloser && staminaRate < 0.60) {
        shouldChange = true;
        situation = 'hold';
        changeReason = `8回僅差(${scoreDiff > 0 ? scoreDiff + '点リード' : Math.abs(scoreDiff) + '点ビハインド'})、セットアッパーへ`;
      }
    }
    // ピンチ場面: ランナー2人以上+アウト1以下+後半+スタミナ低い
    if (!shouldChange && runnersOn >= 2 && gs.outs <= 1 && isLate && staminaRate < 0.45) {
      shouldChange = true;
      situation = 'middle';
      changeReason = `ピンチ(ランナー${runnersOn}人・${gs.outs}アウト)でスタミナ${Math.round(staminaRate * 100)}%`;
    }
    // 満塁+アウト1以下（回に関係なく）でスタミナ低い
    else if (runnersOn === 3 && gs.outs <= 1 && staminaRate < 0.50) {
      shouldChange = true;
      situation = 'middle';
      changeReason = `満塁のピンチでスタミナ${Math.round(staminaRate * 100)}%、緊急交代`;
    }

    // 左打者にワンポイント左投手を送り込む判定
    // 条件: 7回以降、僅差、現在の投手が右投げ、次の打者が左打ち
    const offenseTeamForOnepoint = defenseTeam === gs.homeTeam ? gs.awayTeam : gs.homeTeam;
    const nextBatter = offenseTeamForOnepoint.players.find(p => p.battingOrder === offenseTeamForOnepoint.currentBatterOrder);
    const nextBatterBats = nextBatter?.batting?.bats || 'right';
    const currentPitcherThrows = currentPitcher.physical?.throws || 'right';
    if (!shouldChange && gs.inning >= 7 && Math.abs(scoreDiff) <= 3 && nextBatterBats === 'left' && currentPitcherThrows !== 'left') {
      // 左投げのワンポイント投手が使えるか確認
      const onepointIds = (rotation.middleRelievers || []).filter(id =>
        pitcherRoles[id] === 'onepoint' && (fatigue[id] || 0) < 50 && id !== currentPitcher.id
      );
      for (const opId of onepointIds) {
        const opPlayer = defenseTeam.players.find(p => p.id === opId);
        if (opPlayer && (opPlayer.physical?.throws === 'left')) {
          shouldChange = true;
          situation = 'lefty';
          changeReason = `左打者${nextBatter.name}に対し左ワンポイント投入`;
          break;
        }
      }
    }

    if (!shouldChange) return;

    // リリーフ投手選択（ロールベース、再登板防止）
    let reliever = null;
    let selectedRoleLabel = '';

    // 今試合で既に登板した投手のIDセット（再登板防止）
    const alreadyPitchedIds = addRemovedIds(new Set(
      gs.pitcherAppearances[teamKey].map(a => a.id)
    ), gs);
    alreadyPitchedIds.add(currentPitcher.id);
    // 登板間隔のゲート。絶対値50だけで判定すると、全員が50を超えた時点で
    // ロール別の経路が総崩れになり、疲労を見ない緊急経路へ流れる（実測24%）。
    // 「50未満」か「今日まだ投げていない中で最も疲労の少ない投手」なら通す
    // 相対ゲートにして、ブルペンが枯れても必ずロール別の選択が働くようにする。
    const bullpenIds = [...(rotation.middleRelievers || []), ...(rotation.setupMen || []),
      rotation.closer].filter(Boolean).filter(id => !alreadyPitchedIds.has(id) &&
        canEnterRelief(defenseTeam.players, id, currentPitcher.id, gs.removedIds));
    const freshest = bullpenIds.length
      ? Math.min(...bullpenIds.map(id => fatigue[id] || 0)) : 0;
    const fatigueGate = Math.max(50, freshest + 1);
    const isAvailableMid = (id) => !alreadyPitchedIds.has(id) && (fatigue[id] || 0) < fatigueGate &&
      canEnterRelief(defenseTeam.players, id, currentPitcher.id, gs.removedIds);

    // 左打者対策: ワンポイント左投手を優先選択
    if (situation === 'lefty') {
      // 疲労の少ない順。ロスター順に break すると、左のワンポイントが1人しか
      // 居ないチームでは左打者のたびに毎回その1人が呼ばれ、
      // 100試合中69登板というような突出した起用になる
      const onepointIds = (rotation.middleRelievers || []).filter(id =>
        pitcherRoles[id] === 'onepoint' && isAvailableMid(id)
      ).sort((a, b) => (fatigue[a] || 0) - (fatigue[b] || 0));
      for (const opId of onepointIds) {
        const opPlayer = defenseTeam.players.find(p => p.id === opId);
        if (opPlayer && opPlayer.physical?.throws === 'left') {
          reliever = opPlayer;
          selectedRoleLabel = 'ワンポイント(左)';
          break;
        }
      }
    }

    if (situation === 'save' && rotation.closer) {
      const closerData = defenseTeam.players.find(p => p.id === rotation.closer);
      if (closerData && isAvailableMid(rotation.closer)) {
        reliever = closerData;
        selectedRoleLabel = '守護神';
      }
    }

    if (!reliever && (situation === 'hold' || situation === 'save')) {
      const setupIds = (rotation.setupMen || [])
        .filter(id => isAvailableMid(id))
        .sort((a, b) => (fatigue[a] || 0) - (fatigue[b] || 0));
      for (const setupId of setupIds) {
        const setupData = defenseTeam.players.find(p => p.id === setupId);
        if (setupData) {
          reliever = setupData;
          selectedRoleLabel = 'セットアッパー';
          break;
        }
      }
    }

    // 接戦ピンチ: 中継ぎエースを優先
    if (!reliever && Math.abs(scoreDiff) <= 3) {
      const aceRelievers = (rotation.middleRelievers || [])
        .filter(id => pitcherRoles[id] === 'ace_relief' && isAvailableMid(id))
        .sort((a, b) => (fatigue[a] || 0) - (fatigue[b] || 0))
        .map(id => defenseTeam.players.find(p => p.id === id))
        .filter(Boolean);
      if (aceRelievers.length > 0) {
        reliever = aceRelievers[0];
        selectedRoleLabel = '中継ぎエース';
      }
    }

    if (!reliever) {
      const sortedMiddle = (rotation.middleRelievers || [])
        .filter(id => {
          const p = defenseTeam.players.find(pl => pl.id === id);
          return p && isAvailableMid(id) && pitcherRoles[id] !== 'onepoint';
        })
        .sort((a, b) => (fatigue[a] || 0) - (fatigue[b] || 0));
      if (sortedMiddle.length > 0) {
        reliever = defenseTeam.players.find(p => p.id === sortedMiddle[0]);
        const role = pitcherRoles[sortedMiddle[0]];
        selectedRoleLabel = role === 'long' ? 'ロングリリーフ' :
                           role === 'ace_relief' ? '中継ぎエース' : '中継ぎ';
      }
    }

    if (!reliever) {
      // 疲労の少ない順に選ぶ。ロスター順に .find() すると同じ投手が
      // 毎試合指名され、1人だけ100試合中97登板というような偏りが生まれる
      const starterIds = new Set(rotation.starters || []);
      reliever = defenseTeam.players
        .filter(p =>
          isPitcher(p) &&
          p.battingOrder === 0 &&
          p.isActive !== false &&
          !alreadyPitchedIds.has(p.id) &&
          !starterIds.has(p.id) &&
          (p.currentStamina || 80) > 40
        )
        // reliefFatigue（登板間隔の管理値）の少ない順。p.fatigue はシーズン疲労で
        // リリーフではほとんど溜まらないため、ここで使うと選択が偏る
        // ⚠ **守護神は最後に回す**（`closerLast`）。セーブ場面でしか投げないので
        //    常にブルペンで最も疲労が少なく、疲労順のこの経路が毎回拾ってしまう。
        .sort(closerLast(fatigue, rotation.closer))[0];
      if (reliever) selectedRoleLabel = '緊急中継ぎ';
    }

    // 最終フォールバック: 先発ローテーション投手を除いた上で最もスタミナの残っている投手を選ぶ
    // （先発をpitcherAppearancesに入れるとセーブ・ホールド判定が狂うため先発は最後の手段）
    if (!reliever) {
      const starterIdsSet = new Set(rotation.starters || []);
      const nonStarterPitchers = defenseTeam.players
        .filter(p => isPitcher(p) && p.isActive !== false && p.battingOrder === 0 && !alreadyPitchedIds.has(p.id) && !starterIdsSet.has(p.id))
        // currentStamina は登板のたびにリセットされるため、スタミナ順だと常に同じ投手が
        // 選ばれてしまう。reliefFatigue の少ない順を主キーにする（守護神は最後）
        .sort(closerLast(fatigue, rotation.closer, (a, b) => (b.currentStamina || 0) - (a.currentStamina || 0)));
      if (nonStarterPitchers.length > 0) {
        reliever = nonStarterPitchers[0];
        selectedRoleLabel = '緊急登板';
      } else {
        // 本当に誰もいない場合のみ先発投手を緊急起用
        const starterPitchers = defenseTeam.players
          .filter(p => isPitcher(p) && p.isActive !== false && p.battingOrder === 0 && !alreadyPitchedIds.has(p.id))
          .sort((a, b) => ((fatigue[a.id] || 0) - (fatigue[b.id] || 0)) || ((b.currentStamina || 0) - (a.currentStamina || 0)));
        if (starterPitchers.length > 0) {
          reliever = starterPitchers[0];
          selectedRoleLabel = '緊急登板(先発)';
        }
      }
    }

    if (reliever) {
      // 投手交代記録を保存
      gs.pitcherChanges.push({
        inning: gs.inning,
        isTop: gs.isTopInning,
        team: teamName,
        out: currentPitcher.name,
        in: reliever.name,
        role: selectedRoleLabel,
        reason: changeReason
      });

      if (!reliefTrack.starterLeftInning) {
        reliefTrack.starterLeftInning = gs.inning;
      }

      // 登板記録を追加（セーブ・ホールド判定用）
      const appearances = gs.pitcherAppearances[teamKey];
      appearances.push({
        id: reliever.id,
        entryInning: gs.inning,
        entryIsTop: gs.isTopInning,
        entryScore: { ...gs.score },
        isStarter: false
      });

      const relieverData = defenseTeam.players.find(p => p.id === reliever.id);
      const relieverOldOrder = relieverData.battingOrder;
      const relieverOldPos = relieverData.position;
      const relieverWasDH = !!relieverData._isDH;
      const isTwoWaySwap = inFieldSlot(relieverData);
      const replacement = isTwoWaySwap
        ? reliefFieldReplacement(defenseTeam.players, relieverData, currentPitcher.id, gs.removedIds)
        : null;

      const pitcherSlot = useDH ? 0 : (pitcherData.battingOrder || 9);
      pitcherData.battingOrder = 0;
      pitcherData.position = 'pitcher';
      gs.removedIds.add(pitcherData.id);

      relieverData.battingOrder = pitcherSlot;
      relieverData.position = 'pitcher';
      delete relieverData._isDH;
      relieverData.currentStamina = relieverData.pitching?.stamina || 80;

      // 二刀流リリーフ: 空いた野手スロットをベンチから補充
      // ⚠ DH の枠なら代わりも DH（守備には就かない）。印を写さないと本来の野手と守備位置が重なる
      if (replacement && relieverOldPos) {
        replacement.battingOrder = relieverOldOrder;
        replacement.position = relieverOldPos;
        if (relieverWasDH) replacement._isDH = true; else delete replacement._isDH;
      }

      reliefTrack.currentRelieverId = reliever.id;
      reliefTrack.relieverOutsPitched = 0;
      reliefTrack.relieverBattersFaced = 0;
      reliefTrack.relieverInningRuns = 0;

      // currentPitcherId を更新
      const pitcherTeamKey = defenseTeam === gs.homeTeam ? 'home' : 'away';
      gs.currentPitcherId[pitcherTeamKey] = reliever.id;

      if (TEAMS_DATA[teamName]?.pitchingRotation?.reliefFatigue) {
        // 登板疲労。回復は1日25なので、+30 では 50 のゲートに永久に届かず、
        // 同じリリーフが100試合中97登板するという偏りが生まれていた。
        // +50 にすると2連投で頭打ちになり、最多登板が中央値で62→50登板に収まる。
        // これ以上（+70等）にすると全員がゲートに掛かり、疲労を見ない緊急経路へ
        // 流れて（22%→55%）かえって偏りが悪化する。
        // 上限を設ける。相対ゲートを入れたことで疲労が溜まり続けても登板できるため、
        // 無制限だと 4210 のような値になり、他の箇所の絶対値判定（左ワンポイント投入の
        // `< 50` など）が永久に無効化されてしまう。3登板ぶんで頭打ちにする。
        TEAMS_DATA[teamName].pitchingRotation.reliefFatigue[reliever.id] = Math.min(150,
          (TEAMS_DATA[teamName].pitchingRotation.reliefFatigue[reliever.id] || 0) + 50);
      }
    }
  };

  // バント安打の走者の進め方。⚠ 以前は `bases[2]=bases[1]` の後に二塁を空けておらず、
  //    同じ走者が二・三塁の両方に残っていた（600試合で26件）。
  //    一塁走者は押し出されて二塁へ、二塁走者は一塁が空いていても三塁へ進む（送りバントの形）。
  const advanceOnBuntHit = (batter, pitcher) => {
    pitcher.gameStats.pitching.hits = (pitcher.gameStats.pitching.hits || 0) + 1;
    const b = gameState.bases;
    if (b[0]) {
      if (b[1]) {
        if (b[2]) {   // 満塁の押し出し
          if (gameState.isTopInning) gameState.score.away++; else gameState.score.home++;
          batter.gameStats.batting.rbis++;
          pitcher.gameStats.pitching.runsAllowed++;
          creditRuns(pitcher, 1, b[2]?._reachedOnError ? 1 : 0);
        }
        b[2] = b[1];
      }
      b[1] = b[0];
    } else if (b[1] && !b[2]) {
      b[2] = b[1];
      b[1] = false;
    }
    b[0] = batter;
  };

  // 打席シミュレーション
  const simulateAtBat = () => {
    const offenseTeam = gameState.isTopInning ? gameState.awayTeam : gameState.homeTeam;
    const defenseTeam = gameState.isTopInning ? gameState.homeTeam : gameState.awayTeam;

    let batter = getCurrentBatter(offenseTeam);
    let pitcher = getCurrentPitcher(defenseTeam);

    if (!batter) {
      console.error('打者が取得できません', offenseTeam);
      return;
    }
    if (!pitcher) {
      console.error('投手が取得できません', defenseTeam);
      return;
    }

    const scheduledBatterId = observer ? batter.id : null;
    // AI監督: 代打を検討
    batter = considerPinchHitter(offenseTeam, batter);

    // AI監督: 打席間のピンチ投手交代（ランナー状況・スタミナ考慮）
    considerMidInningPitcherChange(defenseTeam, pitcher, gameState);
    // ⚠ 交代したらこの打者には**新しい投手**が投げる。以前は交代前に取った
    //    `const pitcher` のまま打席を進めており、全打席の約6%で交代済みの投手が投げていた
    //    （左のワンポイントは狙った左打者ではなく次の打者と対戦していた）
    pitcher = getCurrentPitcher(defenseTeam) || pitcher;
    observeDecisions();   // この打者に投げる投手を登板順に記録（登板時の点差つき）
    const catcher = getCurrentCatcher(defenseTeam);
    const defense = buildDefense(defenseTeam);

    // 対人版から明示的に指定された時だけ観測する。通常試合の記録・判定・乱数には触れない。
    const observed = observer ? {
      before: { ...batter.gameStats.batting },
      pitcherOuts: pitcher.gameStats.pitching.outs,
      batterId: batter.id, batterName: batter.name, pitcherId: pitcher.id, pitcherName: pitcher.name,
      // 捕手の成績（マスクをかぶった時の投手成績）のため。失点・自責点はこの打席で増えたぶん
      catcherId: catcher?.id ?? null,
      runsBefore: pitcher.gameStats.pitching.runsAllowed || 0,
      earnedBefore: pitcher.gameStats.pitching.earnedRuns || 0,
      calls: 0, reads: 0,
      offense: offenseTeam.name, defense: defenseTeam.name,
      inning: gameState.inning, pinchHit: batter.id !== scheduledBatterId,
      scoreBefore: { ...gameState.score },
      throws: pitcher.physical?.throws || 'right',
      starter: pitcher.id === (defenseTeam === gameState.homeTeam ? homeStarter?.id : awayStarter?.id),
      pitches: 0, twoStrikes: false, fouls: 0, result: null,
    } : null;
    const observeReplay = (kind, extra = {}) => {
      if (!observer?.replay) return;
      observer.replay({
        kind, inning: gameState.inning, top: gameState.isTopInning,
        outs: gameState.outs, balls: gameState.count.balls, strikes: gameState.count.strikes,
        homeScore: gameState.score.home, awayScore: gameState.score.away,
        batterId: batter.id, pitcherId: pitcher.id, order: batter.battingOrder,
        bases: gameState.bases.map(r => r ? (r.id ?? true) : null),
        stamina: pitcher.currentStamina ?? null,
        pitcherPitches: pitcher.gameStats?.pitching?.pitches || 0,
        homeHits: gameState.homeTeam.players.reduce((n,p) => n + (p.gameStats?.batting?.hits || 0), 0),
        awayHits: gameState.awayTeam.players.reduce((n,p) => n + (p.gameStats?.batting?.hits || 0), 0),
        homeErrors: gameState.homeTeam.players.reduce((n,p) => n + (p.gameStats?.fielding?.errors || 0), 0),
        awayErrors: gameState.awayTeam.players.reduce((n,p) => n + (p.gameStats?.fielding?.errors || 0), 0),
        ...(kind === 'matchup' ? { lineups: Object.fromEntries([offenseTeam, defenseTeam].map(t => [t.name, t.players.filter(p => p.battingOrder > 0).map(p => ({ id: p.id, order: p.battingOrder, position: p.position }))])) } : {}),
        ...extra,
      });
    };
    observeReplay('matchup', { pinchHit: batter.id !== scheduledBatterId });
    const observeSituation = () => {
      if (!observed) return;
      observed.risp = !!(gameState.bases[1] || gameState.bases[2]);
      observed.dpPossible = gameState.outs < 2 && !!gameState.bases[0];
      observed.resultStartOuts = pitcher.gameStats.pitching.outs;
    };

    let atBatOver = false;
    let pitchCount = 0;
    const maxPitches = 20;
    // 打席ごとの配球メモリ（前球の位置・球速・引き出し）。pitchSequence.js
    const sequence = createSequence();
    gameState._stolenAttempted = false;
    let atBatDamagePoints = 0; // この打席で先発に蓄積するダメージポイント

    // AI監督: バント判定（投球ループ前に決定）
    const buntDecision = decideBunt(batter, offenseTeam, gameState);
    if (buntDecision) {
      const pitcherData = defenseTeam.players.find(p => p.id === pitcher.id);
      pitcherData.currentStamina = Math.max(0, pitcherData.currentStamina - 1);
      pitcherData.gameStats.pitching.pitches++;

      observeSituation();
      const buntResult = executeBunt(buntDecision, batter, pitcher, catcher, defense, gameState.bases, gameState.outs);
      if (observed) {
        observed.bunt = buntDecision;
        observed.buntOutcome = buntResult.type;
        observed.pitches++;
        observed.result = buntResult;
      }

      if (buntResult.type === 'bunt_popup') {
        batter.gameStats.batting.atBats++;
        pitcher.gameStats.pitching.outs++;
        gameState.outs++;
        atBatOver = true;
      } else if (buntResult.type === 'bunt_foul') {
        // ファウル → 0-1カウントで通常打席へ
        gameState.count = { balls: 0, strikes: 1 };
      } else if (buntResult.type === 'bunt_fair') {
        if (buntDecision === 'squeeze') {
          if (buntResult.squeezeRunnerSafe && gameState.bases[2]) {
            if (gameState.isTopInning) gameState.score.away++;
            else gameState.score.home++;
            batter.gameStats.batting.rbis++;
            pitcher.gameStats.pitching.runsAllowed++;
            creditRuns(pitcher, 1, gameState.bases[2]?._reachedOnError ? 1 : 0);
            atBatDamagePoints += 10;
            gameState.bases[2] = false;
          } else if (!buntResult.squeezeRunnerSafe && gameState.bases[2]) {
            gameState.outs++;
            pitcher.gameStats.pitching.outs++;
            gameState.bases[2] = false;
          }
          if (buntResult.batterOut) {
            pitcher.gameStats.pitching.outs++;
            gameState.outs++;
            batter.gameStats.batting.sacrificeBunts = (batter.gameStats.batting.sacrificeBunts || 0) + 1;
          } else {
            batter.gameStats.batting.atBats++;
            batter.gameStats.batting.hits++;
            // 走者進塁 + 打者1塁
            advanceOnBuntHit(batter, pitcher);
          }
          atBatDamagePoints += 4;
          atBatOver = true;
        } else if (buntDecision === 'sacrifice') {
          if (buntResult.batterOut) {
            pitcher.gameStats.pitching.outs++;
            gameState.outs++;
            batter.gameStats.batting.sacrificeBunts = (batter.gameStats.batting.sacrificeBunts || 0) + 1;
            // 走者進塁（アウト3未満の場合）
            if (gameState.outs < 3) {
              if (gameState.bases[1]) {
                gameState.bases[2] = gameState.bases[1];
                gameState.bases[1] = false;
              }
              if (gameState.bases[0]) {
                gameState.bases[1] = gameState.bases[0];
                gameState.bases[0] = false;
              }
            }
          } else {
            batter.gameStats.batting.atBats++;
            batter.gameStats.batting.hits++;
            advanceOnBuntHit(batter, pitcher);
          }
          atBatDamagePoints += 4;
          atBatOver = true;
        } else {
          // セーフティバント
          if (buntResult.batterOut) {
            batter.gameStats.batting.atBats++;
            pitcher.gameStats.pitching.outs++;
            gameState.outs++;
          } else {
            batter.gameStats.batting.atBats++;
            batter.gameStats.batting.hits++;
            advanceOnBuntHit(batter, pitcher);
            atBatDamagePoints += 4;
          }
          atBatOver = true;
        }
      }
    }

    const isWalkOff = () => !gameState.isTopInning && gameState.inning >= 9
      && gameState.score.home > gameState.score.away;
    if (buntDecision) observeReplay('bunt', { result: observed?.buntOutcome || null, completed: atBatOver });
    while (!atBatOver && pitchCount < maxPitches) {
      // 暴投・盗塁の悪送球でサヨナラの走者が還ったら、その時点で試合終了
      if (isWalkOff()) break;
      pitchCount++;

      // AI監督: 盗塁を検討（各球で検討、ただし1打席1回まで）
      if (pitchCount <= 3 && gameState.outs < 2 && !gameState._stolenAttempted) {
        const stealBefore = observed ? {outs:pitcher.gameStats.pitching.outs,risp:!!(gameState.bases[1] || gameState.bases[2])} : null;
        const stealResult = attemptStolenBase(offenseTeam, defenseTeam);
        if (observed && pitcher.gameStats.pitching.outs > stealBefore.outs) observer.runnerOut?.({...observed,risp:stealBefore.risp,outs:pitcher.gameStats.pitching.outs-stealBefore.outs});
        if (stealResult) gameState._stolenAttempted = true;
        if (stealResult) observeReplay('steal', { success: stealResult.success, base: stealResult.base });
        if (stealResult && !stealResult.success && gameState.outs >= 3) {
          // 盗塁死で3アウトなら打席終了
          atBatOver = true;
          break;
        }
      }

      // 暴投・捕逸（走者がいる時のみ）: 投手の制球と捕手の守備で決まる。
      // 守備の良い捕手はワンバウンドを確実に止め、走者の進塁を防ぐ。
      if (gameState.bases.some(Boolean)) {
        const pControl = pitcher.pitching?.control ?? pitcher.control ?? 50;
        const cDef = catcher?.fielding?.defense ?? 50;
        // 制球50・捕手守備60 で1球あたり約0.8%。捕手守備が低いほど後逸が増える
        const wpRate = Math.max(0.001,
          0.010 * (1 - pControl / 200) * (1 - (cDef - 30) / 140));
        if (Math.random() < wpRate) {
          const pd = defenseTeam.players.find(p => p.id === pitcher.id);
          if (pd?.gameStats?.pitching) pd.gameStats.pitching.wildPitches = (pd.gameStats.pitching.wildPitches || 0) + 1;
          // 全走者が1つ進塁（三塁走者は生還）
          for (let b = 2; b >= 0; b--) {
            if (!gameState.bases[b]) continue;
            const r = gameState.bases[b];
            gameState.bases[b] = false;
            if (b === 2) {
              if (gameState.isTopInning) gameState.score.away++;
              else gameState.score.home++;
              const pp = getCurrentPitcher(defenseTeam);
              if (pp?.gameStats?.pitching) pp.gameStats.pitching.runsAllowed++;
              creditRuns(pp, 1, (r && r._reachedOnError) ? 1 : 0);
            } else {
              gameState.bases[b + 1] = r;
            }
          }
          observeReplay('wild_pitch');
        }
      }

      // ⚠ 盗塁の悪送球・暴投でサヨナラの走者が還ったら、この球の結果は出さない。
      //    ループ先頭の判定だけだと、同じ球の中で決まったサヨナラの後にもう1球投げ、
      //    打席の結果（三振・安打など）まで記録していた
      if (isWalkOff()) break;

      // 投手のスタミナを取得
      const pitcherData = defenseTeam.players.find(p => p.id === pitcher.id);
      const pitcherStamina = pitcherData.currentStamina;

      // チームの作戦設定を取得
      const offenseStrategy = (gameState.isTopInning ? gameState.awayTeam : gameState.homeTeam).strategy;
      const defenseStrategy = (gameState.isTopInning ? gameState.homeTeam : gameState.awayTeam).strategy;

      // 一球シミュレーション（simulation-logic.jsの物理エンジンを使用）
      // 前球の記録は simulateOnePitch 内で sequence に積まれる（緩急・対角の判定に使う）
      if (observed) {
        observeSituation();
        observed.twoStrikes ||= gameState.count.strikes >= 2;
      }
      const result = simulateOnePitch(batter, pitcher, catcher, defense, gameState.count, pitcherStamina, gameState.bases, sequence, offenseStrategy, defenseStrategy);
      if (observed) {
        observed.pitches++;
        observed.calls++;
        if (lastGuessRight) observed.reads++;
        observed.result = result;
        if (result.type === 'foul') {
          observed.fouls++;
          if (gameState.count.strikes >= 2) observed.twoStrikeFouls=(observed.twoStrikeFouls || 0)+1;
        }
      }

      // スタミナ減少
      pitcherData.currentStamina = Math.max(0, pitcherData.currentStamina - 1);
      pitcherData.gameStats.pitching.pitches++;

      // 結果処理
  
      switch (result.type) {
        case 'ball':
          gameState.count.balls++;
          if (gameState.count.balls === 4) {
            // 四球
            batter.gameStats.batting.walks++;
            pitcher.gameStats.pitching.walks++;
            atBatDamagePoints += 4; // 四球=4ダメージ
            if (gameState.bases[0] && gameState.bases[1] && gameState.bases[2]) {
              // 満塁押し出し: 3塁走者が生還
              if (gameState.isTopInning) gameState.score.away++;
              else gameState.score.home++;
              pitcher.gameStats.pitching.runsAllowed++;
              creditRuns(pitcher, 1, gameState.bases[2]?._reachedOnError ? 1 : 0);
              batter.gameStats.batting.rbis++;   // 押し出しは打点（以前は付いていなかった）
              atBatDamagePoints += 10; // 失点=10ダメージ
              gameState.bases[2] = gameState.bases[1];
              gameState.bases[1] = gameState.bases[0];
              gameState.bases[0] = batter;
            } else {
              if (gameState.bases[1] && gameState.bases[0]) gameState.bases[2] = gameState.bases[1];
              if (gameState.bases[0]) gameState.bases[1] = gameState.bases[0];
              gameState.bases[0] = batter;
            }
            atBatOver = true;
          }
          break;

        case 'hit_by_pitch': {
          // 死球。四球と同じ押し出し進塁だが、打数にも四球にも計上しない
          batter.gameStats.batting.hitByPitch++;
          pitcher.gameStats.pitching.hitBatters++;
          // 故障は作らないが、**疲労は大きく溜まる**（速い球ほど・体力が無いほど）
          batter.gameStats.batting.hbpFatigue =
            (batter.gameStats.batting.hbpFatigue || 0)
            + hitByPitchFatigue(result.velocity, batter.physical?.bodyStamina ?? 50);
          atBatDamagePoints += 4;
          if (gameState.bases[0] && gameState.bases[1] && gameState.bases[2]) {
            if (gameState.isTopInning) gameState.score.away++;
            else gameState.score.home++;
            pitcher.gameStats.pitching.runsAllowed++;
            creditRuns(pitcher, 1, gameState.bases[2]?._reachedOnError ? 1 : 0);
            batter.gameStats.batting.rbis++;   // 押し出し死球も打点
            atBatDamagePoints += 10;
            gameState.bases[2] = gameState.bases[1];
            gameState.bases[1] = gameState.bases[0];
            gameState.bases[0] = batter;
          } else {
            if (gameState.bases[1] && gameState.bases[0]) gameState.bases[2] = gameState.bases[1];
            if (gameState.bases[0]) gameState.bases[1] = gameState.bases[0];
            gameState.bases[0] = batter;
          }
          atBatOver = true;
          break;
        }

        case 'called_strike':
        case 'swinging_strike':
          gameState.count.strikes++;
          if (gameState.count.strikes === 3) {
            // 三振
            batter.gameStats.batting.atBats++;
            batter.gameStats.batting.strikeouts++;
            addFieldingChance(defenseTeam, 'catcher');   // 三振は捕手の刺殺
            pitcher.gameStats.pitching.outs++;
            pitcher.gameStats.pitching.strikeouts++;
            gameState.outs++;
            atBatOver = true;
          }
          break;

        case 'foul':
        case 'foul_2strike':
          if (gameState.count.strikes < 2) {
            gameState.count.strikes++;
          }
          // 2ストライク時のファウルはカウント変わらず
          break;

        case 'out': {
          batter.gameStats.batting.atBats++;
          pitcher.gameStats.pitching.outs++;
          gameState.outs++;

          // 守備機会を記録（アウトにした野手）
          addFieldingChance(defenseTeam, result.fieldingPosition);
          // **送球を受けた側にも刺殺が付く**。内野ゴロのアウトは
          // 「捕った野手の補殺 ＋ 一塁手の刺殺」の2つが記録される。
          // これが無いと一塁手の守備機会が実NPBの9.5に対し1.1しか出ず、
          // 守備率が事実上測定できない（三振の捕手も同様）
          if (result.isGroundOut && result.fieldingPosition && result.fieldingPosition !== 'first') {
            addFieldingChance(defenseTeam, 'first');
          }

          // 内野ゴロでの走者進塁（ゴロGO・進塁打）。詳細は baserunning.js 参照
          if (result.isGroundOut && gameState.outs < 3) {
            const inf = ['first', 'second', 'third', 'short'].map(p => defense[p]?.defense ?? 50);
            const adv = resolveGroundOutAdvance({
              hasThird: !!gameState.bases[2], hasSecond: !!gameState.bases[1],
              infieldDefense: inf.reduce((a, b) => a + b, 0) / inf.length,
              // ⚠ 塁上は選手そのもの（走力は physical.speed）。以前は `.speed` を読んで
              //    常に 50 になり、俊足でも鈍足でもゴロでの進塁率が同じだった
              thirdSpeed: gameState.bases[2]?.physical?.speed ?? 50,
              secondSpeed: gameState.bases[1]?.physical?.speed ?? 50,
            });
            if (adv.scoreFromThird) {
              const unearned = gameState.bases[2]?._reachedOnError ? 1 : 0;
              gameState.bases[2] = false;
              if (gameState.isTopInning) gameState.score.away++;
              else gameState.score.home++;
              batter.gameStats.batting.rbis++;
              pitcher.gameStats.pitching.runsAllowed++;
              creditRuns(pitcher, 1, unearned);
              atBatDamagePoints += 10; // 失点=10ダメージ
            }
            if (adv.secondToThird) {
              gameState.bases[2] = gameState.bases[1];
              gameState.bases[1] = false;
            }
          }

          // 外野フライでのタッグアップ（犠牲フライ・進塁）
          if (result.isOutfieldFly && gameState.outs < 3) {
            // 3塁走者のタッグアップ（犠牲フライ）
            if (gameState.bases[2]) {
              const throwbackChance = result.tagupThrowbackChance || 0;
              if (Math.random() >= throwbackChance) {
                // 送球間に合わず得点
                const sfUnearned = gameState.bases[2]?._reachedOnError ? 1 : 0;
                gameState.bases[2] = false;
                if (gameState.isTopInning) gameState.score.away++;
                else gameState.score.home++;
                batter.gameStats.batting.rbis++;
                pitcher.gameStats.pitching.runsAllowed++;
                creditRuns(pitcher, 1, sfUnearned);
                atBatDamagePoints += 10; // 失点=10ダメージ
              } else {
                gameState.bases[2] = false;
                gameState.outs++;
                pitcher.gameStats.pitching.outs++;
              }
            }
            // 2塁走者のタッグアップ進塁（深いフライ時）
            if (gameState.bases[1] && !gameState.bases[2] && gameState.outs < 3) {
              const advanceChance = 0.4 - (result.tagupThrowbackChance || 0) * 0.5;
              if (Math.random() < advanceChance) {
                gameState.bases[2] = gameState.bases[1]; // 走者参照を維持
                gameState.bases[1] = false;
              }
            }
          }

          atBatOver = true;
          break;
        }

        case 'double_play':
          // 二塁のピボット(fieldingPosition)＋一塁でのアウトで刺殺2つ
          addFieldingChance(defenseTeam, 'first');
          batter.gameStats.batting.atBats++;
          pitcher.gameStats.pitching.outs += 2;
          gameState.outs += 2;
          gameState.bases[0] = false;
          atBatOver = true;
          break;

        case 'single':
        case 'double':
        case 'triple':
        case 'homerun':
          // 失策による出塁は「ヒット扱い」で単打として処理されるが、自責点上は非自責走者。
          // また失策が無ければアウトだったので、そのイニングの想定アウト数を1つ増やす。
          // 中継ミス（`hitWithError`）は安打のあとの失策なので、打者は安打で出塁している
          const reachedOnError = !!result.isError && !result.hitWithError;
          if (reachedOnError) {
            batter._reachedOnError = true;   // 失策出塁の走者＝この走者の生還は非自責
            gameState.inningErrorOuts++;     // 失策が無ければアウトだった＝想定アウトを1つ加算
          }
          const { bases: newBases, runsScored, unearnedRunsScored, outsMade, assistBy } =
            advanceRunners(result.type, gameState.bases, defense, batter, !!result.extraAdvance,
              result.fieldingPosition || null, gameState.outs);
          batter.gameStats.batting.atBats++;
          // 失策での出塁は「安打」ではない（打数のみ加算し、打点も付かない）。
          // ここを安打扱いにすると失策が増えるほどリーグ打率が上振れする。
          if (!reachedOnError) {
            batter.gameStats.batting.hits++;
            batter.gameStats.batting.rbis += runsScored;
            if (result.type === 'double') batter.gameStats.batting.doubles = (batter.gameStats.batting.doubles || 0) + 1;
            if (result.type === 'triple') batter.gameStats.batting.triples = (batter.gameStats.batting.triples || 0) + 1;
            if (result.type === 'homerun') batter.gameStats.batting.homeruns++;
          }
          // ダメージポイント: 単打=4, 長打(二塁打/三塁打/本塁打)=6, 失点=10×得点数
          atBatDamagePoints += (result.type === 'single') ? 4 : 6;
          atBatDamagePoints += runsScored * 10;

          // 投手の被安打・被本塁打を記録（失策出塁は被安打にしない）
          if (!reachedOnError) {
            pitcher.gameStats.pitching.hits = (pitcher.gameStats.pitching.hits || 0) + 1;
            if (result.type === 'homerun') pitcher.gameStats.pitching.homeruns = (pitcher.gameStats.pitching.homeruns || 0) + 1;
          }

          // エラー記録（守備側の該当野手）
          if (result.isError && result.errorPosition) {
            const errorFielder = defenseTeam.players.find(p => p.position === result.errorPosition && p.battingOrder >= 1 && !p._isDH);
            if (errorFielder) {
              errorFielder.gameStats.fielding.errors++;
              errorFielder.gameStats.fielding.chances++;
            }
          }

          if (gameState.isTopInning) gameState.score.away += runsScored;
          else gameState.score.home += runsScored;

          pitcher.gameStats.pitching.runsAllowed += runsScored;
          // 自責点: 失策で出塁した走者の生還は除外。さらに失策が無ければ既に3アウトだった場合、
          // そのイニングの以降の得点は全て非自責（公式のイニング再構成ルール）。
          creditRuns(pitcher, runsScored, unearnedRunsScored);
          // 捕殺（走者を本塁/塁上で刺した）→ アウトを加算し、送球した野手に記録
          if (outsMade > 0) {
            gameState.outs += outsMade;
            pitcher.gameStats.pitching.outs = (pitcher.gameStats.pitching.outs || 0) + outsMade;
            if (assistBy) {
              const assistFielder = defenseTeam.players.find(p => p.position === assistBy && p.battingOrder >= 1 && !p._isDH);
              if (assistFielder?.gameStats?.fielding) {
                assistFielder.gameStats.fielding.assists = (assistFielder.gameStats.fielding.assists || 0) + 1;
                assistFielder.gameStats.fielding.chances++;
              }
            }
          }
          gameState.bases = newBases;
          atBatOver = true;
          break;
      }
      observeReplay('pitch', {
        pitchResult: result.type,
        result: result.isError && !result.hitWithError ? 'error' : result.type === 'ball' && gameState.count.balls >= 4 ? 'walk'
          : ['called_strike', 'swinging_strike'].includes(result.type) && gameState.count.strikes >= 3 ? 'strikeout' : result.type,
        completed: atBatOver,
        pitch: lastCall(sequence) ? { ...lastCall(sequence) } : null,
      });
    }

    if (observed) {
      const after = batter.gameStats.batting;
      const delta = Object.fromEntries(['atBats','hits','doubles','triples','homeruns','rbis','walks','hitByPitch','strikeouts','sacrificeBunts'].map(key=>[key,(after[key] || 0)-(observed.before[key] || 0)]));
      // 盗塁死や暴投サヨナラ、球数上限の未完了打席は対戦打席へ加えない。
      const completed = delta.atBats + delta.walks + delta.hitByPitch + delta.sacrificeBunts > 0;
      observer.plateAppearance({ ...observed, delta, completed, scoreAfter: { ...gameState.score }, outs: pitcher.gameStats.pitching.outs - (observed.resultStartOuts ?? pitcher.gameStats.pitching.outs),
        runs: (pitcher.gameStats.pitching.runsAllowed || 0) - observed.runsBefore,
        earnedRuns: (pitcher.gameStats.pitching.earnedRuns || 0) - observed.earnedBefore });
    }

    // 先発投手のダメージポイント積算（先発のみに適用）
    const dmgTeamKey = defenseTeam === gameState.homeTeam ? 'home' : 'away';
    const isStarterOnMound = !gameState.reliefTracking[dmgTeamKey].currentRelieverId;
    if (isStarterOnMound && atBatDamagePoints > 0) {
      gameState.starterDamagePoints[dmgTeamKey] += atBatDamagePoints;
    }

    // リリーフ投手の対戦打者数を追跡
    const teamKeyForReliefBatter = defenseTeam === gameState.homeTeam ? 'home' : 'away';
    const reliefTrackBatter = gameState.reliefTracking[teamKeyForReliefBatter];
    if (reliefTrackBatter.currentRelieverId === pitcher.id) {
      reliefTrackBatter.relieverBattersFaced++;
    }

    // カウントリセット & 打順進行
    gameState.count = { balls: 0, strikes: 0 };
    offenseTeam.currentBatterOrder++;
    if (offenseTeam.currentBatterOrder > 9) offenseTeam.currentBatterOrder = 1;
  };

  // イニングシミュレーション
  const simulateInning = () => {
    gameState.outs = 0;
    gameState.bases = [false, false, false];
    // 自責点判定はイニング単位でリセットする。
    // 塁が空になるこのタイミングで、失策出塁フラグも全選手からクリアしておく
    // （次のイニング以降に持ち越さないため）。
    gameState.inningErrorOuts = 0;
    gameState.homeTeam.players.forEach(p => { if (p._reachedOnError) delete p._reachedOnError; });
    gameState.awayTeam.players.forEach(p => { if (p._reachedOnError) delete p._reachedOnError; });

    const inningLabel = `${gameState.inning}回${gameState.isTopInning ? '表' : '裏'}`;
    const offenseTeam = gameState.isTopInning ? gameState.awayTeam.name : gameState.homeTeam.name;
    // 回ごとの得点（紙面の「逆転」「先制」に使う）。⚠ 乱数は引かない（記録するだけ）
    const offenseKey = gameState.isTopInning ? 'away' : 'home';
    const runsBeforeInning = gameState.score[offenseKey];

    // イニング開始時の失点を記録（イニング失点計算用）
    // 守備チーム = 攻撃チームの反対
    const defenseKey = gameState.isTopInning ? 'home' : 'away';
    const defenseTeamForInning = gameState.isTopInning ? gameState.homeTeam : gameState.awayTeam;
    const defPitcher = getCurrentPitcher(defenseTeamForInning);
    if (defPitcher) {
      const defPitcherData = defenseTeamForInning.players.find(p => p.id === defPitcher.id);
      gameState.inningStartRuns[defenseKey] = defPitcherData?.gameStats?.pitching?.runsAllowed || 0;
    }
    // リリーフのイニング失点をリセット
    gameState.reliefTracking[defenseKey].relieverInningRuns = 0;

    let atBats = 0;
    while (gameState.outs < 3 && atBats < 50) {  // 無限ループ防止（打席数制限）
      simulateAtBat();
      atBats++;
      observeDecisions();   // リードが入れ替わったら、その時の両チームの投手を責任投手として記録
      // サヨナラ: 9回以降の裏にホームが勝ち越した時点で試合終了。
      // ⚠ 以前は3アウトまで攻撃が続き、余分な得点が打者・投手の成績と勝敗に混ざっていた
      if (!gameState.isTopInning && gameState.inning >= 9
          && gameState.score.home > gameState.score.away) {
        gameState.walkOff = true;
        break;
      }
    }

    if (atBats >= 50) {
      console.error(`${inningLabel}: 異常な打席数（${atBats}打席）。強制終了します。`);
      // ゲーム状態を正常化: アウトを3にしてベースをクリア
      gameState.outs = 3;
      gameState.bases = [false, false, false];
    }

    gameState.lineScore[offenseKey].push(gameState.score[offenseKey] - runsBeforeInning);
    // イニング終了処理
    if (gameState.isTopInning) {
      gameState.isTopInning = false;
    } else {
      gameState.isTopInning = true;
      gameState.inning++;
    }

    // 先発ダメージポイントのイニングまたぎ回復（-10、最低0）
    ['home', 'away'].forEach(key => {
      if (!gameState.reliefTracking[key].currentRelieverId) {
        gameState.starterDamagePoints[key] = Math.max(0, gameState.starterDamagePoints[key] - 10);
      }
    });

    // ⚠ **試合が終わった半イニングの後は、継投も守備固めもしない**。以前はここが
    //    試合終了後にも走り、投げない投手に登板記録と救援疲労（+50）が付き、
    //    守備固めで入った控えは「出場した」扱いで翌日の回復を失っていた。
    //    判定は下の試合ループ（`MAX_INNINGS`）と同じ。
    {
      const endedTop = !gameState.isTopInning;
      const inn = endedTop ? gameState.inning : gameState.inning - 1;
      const { home, away } = gameState.score;
      if (gameState.walkOff || (inn >= 9 && ((endedTop && home > away)
          || (!endedTop && (home !== away || inn >= MAX_INNINGS))))) return;
    }

    // 投手スタミナ回復 & AI監督機能（役割ベースの投手交代・登板制限）
    [gameState.homeTeam, gameState.awayTeam].forEach(team => {
      const pitcher = getCurrentPitcher(team);
      const teamName = team === gameState.homeTeam ? homeTeamName : awayTeamName;
      const teamKey = team === gameState.homeTeam ? 'home' : 'away';
      const scoreDiff = team === gameState.homeTeam
        ? gameState.score.home - gameState.score.away
        : gameState.score.away - gameState.score.home;
      const reliefTrack = gameState.reliefTracking[teamKey];

      if (pitcher) {
        const pitcherData = team.players.find(p => p.id === pitcher.id);
        if (pitcherData) {
          // スタミナ回復（イニング間の休憩）
          pitcherData.currentStamina = Math.min(
            pitcherData.currentStamina + 3,
            pitcher.pitching.stamina
          );

          // このイニングで守備したかどうかを判定
          // ※ isTopInning は既に反転済み
          // 表終了後: isTopInning = false → home が守備していた
          // 裏終了後: isTopInning = true, inning++ → away が守備していた
          const defendedThisInning = (!gameState.isTopInning && teamKey === 'home') ||
                                     (gameState.isTopInning && teamKey === 'away');
          // 次の半イニングで守備に就くか（継投はその直前にだけ行う）
          const defendsNext = !defendedThisInning;

          // リリーフ投手のイニング追跡。⚠ 実際に取ったアウトで数えること。
          //    以前は半イニングごとに**守備していない側にも** +3 を足しており、
          //    守護神の「2イニング」が実質1イニング、ロングの3イニングが約1.5で打ち切られていた
          if (reliefTrack.currentRelieverId === pitcher.id && defendedThisInning) {
            reliefTrack.relieverOutsPitched = pitcherData.gameStats?.pitching?.outs || 0;
          }
          // 今イニングの失点数を計算
          const inningRunsAllowed = defendedThisInning
            ? (pitcherData.gameStats?.pitching?.runsAllowed || 0) - (gameState.inningStartRuns[teamKey] || 0)
            : 0;

          // AI監督: ロール別の投手交代判定（pitcherRoles対応）
          const staminaRate = pitcherData.currentStamina / pitcher.pitching.stamina;
          const rotation = TEAMS_DATA[teamName]?.pitchingRotation;
          const pitcherRoles = rotation?.pitcherRoles || {};
          const currentRole = pitcherRoles[pitcher.id] || '';
          let shouldChange = false;
          let situation = 'middle';
          let changeReason = '';

          // 球数制限チェック（先発投手用）
          const totalPitches = pitcherData.gameStats?.pitching?.pitches || 0;
          const isReliever = reliefTrack.currentRelieverId === pitcher.id;

          // 投手に代打を出した → 次の守備は必ず継投（打順から外れた投手は投げられない）
          const phForPitcher = gameState.pitcherPinchHit[teamKey];
          if (phForPitcher) {
            shouldChange = true;
            situation = scoreDiff > 0 && scoreDiff <= 3 && gameState.inning >= 8 ? 'hold'
              : scoreDiff < 0 ? 'behind' : 'middle';
            changeReason = `${pitcher.name}に代打が出たため継投`;
          }

          // リリーフ投手の役割完了チェック（登板制限を役割ベースに変更）
          if (!shouldChange && isReliever && defendedThisInning) {
            const relieverRole = pitcherRoles[pitcher.id] || 'auto_r';
            const inningRuns = (pitcherData.gameStats?.pitching?.runsAllowed || 0) - (gameState.inningStartRuns[teamKey] || 0);

            if (relieverRole === 'onepoint') {
              // ワンポイント: 打っても抑えても必ず交代（イニング終了時のフォールバック）
              shouldChange = true;
              changeReason = `ワンポイント${pitcher.name}の仕事完了、交代`;
              situation = 'middle';
            } else if (relieverRole === 'setup' || relieverRole === 'ace_relief') {
              // セットアッパー/中継ぎエース: イニングを抑えたら交代、失点でも交代
              if (inningRuns > 0) {
                shouldChange = true;
                changeReason = `${relieverRole === 'setup' ? 'セットアッパー' : '中継ぎエース'}${pitcher.name}が失点、交代`;
                situation = 'middle';
              } else if (reliefTrack.relieverOutsPitched >= 3) {
                // 1イニング完了で交代（好投でも役割完了）
                shouldChange = true;
                changeReason = `${relieverRole === 'setup' ? 'セットアッパー' : '中継ぎエース'}${pitcher.name}が1イニング完了、交代`;
                situation = 'middle';
              }
            } else if (relieverRole === 'closer') {
              // クローザー: イニングを抑えたら交代、最大2イニング
              if (reliefTrack.relieverOutsPitched >= 6) {
                shouldChange = true;
                changeReason = `守護神${pitcher.name}が2イニング投球、交代`;
                situation = 'middle';
              }
            } else if (relieverRole === 'long' || relieverRole === 'mopup' || relieverRole === 'behind') {
              // ロング/敗戦処理/ビハインド: イニングイーター、多少の失点はOK
              const maxOuts = relieverRole === 'long' ? 9 : // ロング: 3イニング
                (reliefTrack.starterLeftInning || 9) <= 3 ? 12 : 6; // 早期降板なら4回、通常2回
              if (reliefTrack.relieverOutsPitched >= maxOuts) {
                const inningsStr = Math.floor(reliefTrack.relieverOutsPitched / 3);
                changeReason = `${pitcher.name}が登板制限(${inningsStr}回)に到達`;
                shouldChange = true;
                situation = 'middle';
              } else if (inningRuns >= 3) {
                // さすがに3失点以上は交代
                changeReason = `${pitcher.name}が${inningRuns}失点、交代`;
                shouldChange = true;
                situation = 'middle';
              }
            } else {
              // auto_r / 未設定: 従来どおりのアウト数制限
              const starterLeft = reliefTrack.starterLeftInning || 9;
              const maxOuts = starterLeft <= 3 ? 12 : 6;
              if (reliefTrack.relieverOutsPitched >= maxOuts) {
                const inningsStr = Math.floor(reliefTrack.relieverOutsPitched / 3);
                changeReason = `${pitcher.name}が登板制限(${inningsStr}回)に到達`;
                shouldChange = true;
                situation = 'middle';
              }
            }
          } else if (!shouldChange && isReliever && !defendedThisInning) {
            // 守備していないイニングでもワンポイントのフォールバックチェック
            const relieverRole = pitcherRoles[pitcher.id] || 'auto_r';
            if (relieverRole === 'onepoint' && reliefTrack.relieverBattersFaced >= 1) {
              changeReason = `ワンポイント${pitcher.name}が1打者対戦済み、交代`;
              shouldChange = true;
              situation = 'middle';
            }
          }

          // === 新降板ルール: 3条件のいずれか1つで降板 ===
          // 条件1: 球数制限（ロール別）
          // 条件2: スタミナ25%以下
          // 条件3: ダメージポイント制（先発のみ）

          // --- 条件1: 球数制限（先発・リリーフ共通） ---
          if (!shouldChange) {
            const pitchLimit = tacticalPitchLimit(pitchLimitFor(currentRole, isReliever, pitcher.pitching?.stamina), isReliever, team.onlineTactics);
            if (totalPitches >= pitchLimit) {
              shouldChange = true;
              situation = Math.abs(scoreDiff) <= 2 ? 'hold' : 'middle';
              const roleLabel = {
                complete: '完投型', ace: 'ゲームメーカー', quality: '勝ち権利型',
                short: 'ショートスターター', opener: 'オープナー', closer: '守護神', setup: 'セットアッパー',
                ace_relief: '中継ぎエース', long: 'ロングリリーフ', onepoint: 'ワンポイント',
                behind: 'ビハインド', mopup: '敗戦処理'
              }[currentRole] || (isReliever ? 'リリーフ' : '先発');
              changeReason = `${roleLabel}${pitcher.name}が球数制限到達(${totalPitches}/${pitchLimit}球)`;
            }
          }

          // --- 条件2: スタミナ25%以下（先発・リリーフ共通） ---
          if (!shouldChange && staminaRate < 0.25) {
            shouldChange = true;
            situation = 'middle';
            changeReason = `${pitcher.name}のスタミナ限界(${Math.round(staminaRate * 100)}%)`;
          }

          // --- オープナー: 2イニング（6アウト）投げたら役割完了、ロングへ繋ぐ ---
          if (!shouldChange && !isReliever && currentRole === 'opener' && defendedThisInning) {
            const openerOuts = pitcherData.gameStats?.pitching?.outs || 0;
            if (openerOuts >= 6) {
              shouldChange = true;
              situation = 'middle';
              changeReason = `オープナー${pitcher.name}が役割完了、ロングリリーフへ`;
            }
          }

          // --- 条件3: ダメージポイント制（先発のみ） ---
          if (!shouldChange && !isReliever && defendedThisInning) {
            const threshold = tacticalDamageLimit(damageThreshold(gameState.inning, staminaRate), team.onlineTactics); // 延長は9回の閾値
            const currentDamage = gameState.starterDamagePoints[teamKey];
            if (currentDamage >= threshold) {
              shouldChange = true;
              situation = Math.abs(scoreDiff) <= 2 ? 'hold' : 'middle';
              changeReason = `先発${pitcher.name}がダメージ蓄積で降板(DP:${currentDamage}/${threshold})`;
            }
          }
          // 9回、同点〜3点差以内のリード → クローザー（同点を含める理由は上記）
          // ⚠ 勝ちパターン・温存の継投は「次に守るチーム」にだけ行う（攻撃前に守護神を
          //    登板扱いにすると、投げないのに登板記録と疲労だけが付く）
          if (!shouldChange && defendsNext && gameState.inning >= 9 && scoreDiff >= 0 && scoreDiff <= 3) {
            if (closerCanEnter(rotation, gameState, teamKey, pitcher.id, team.players)) {
              shouldChange = true;
              situation = 'save';
              changeReason = scoreDiff === 0 ? `9回同点、守護神を投入` : `9回セーブ場面、守護神を投入`;
            }
          }
          // 8回で僅差リード → セットアッパー
          if (!shouldChange && defendsNext && gameState.inning === 8 && scoreDiff > 0 && Math.abs(scoreDiff) <= 2 && !isReliever) {
            shouldChange = true;
            situation = 'hold';
            changeReason = `8回僅差リード、セットアッパーへ`;
          }
          // 6回以降、大量リードで先発温存
          if (!shouldChange && !isReliever && gameState.inning >= 6 && Math.abs(scoreDiff) >= 5 && staminaRate < 0.50) {
            shouldChange = true;
            situation = scoreDiff < 0 ? 'behind' : 'middle';
            changeReason = scoreDiff >= 5 ? `大量リードで先発${pitcher.name}を温存` : `大量ビハインドで先発${pitcher.name}を温存`;
          }

          // ⚠ **これから攻撃する側の投手は、ここでは代えない**。守り終えた直後に決めた
          //    継投は、次に守りに就く直前（次の半イニングの終わり）まで持ち越す。
          //    以前はその場で代えていたため、投げない救援投手に登板記録と疲労が付き、
          //    その攻撃で勝ち越すと**1球も投げていない投手に勝ちが付いていた**
          //    （本来は直前の回を投げた投手の勝ち）。
          if (!defendsNext) {
            if (shouldChange) gameState.pendingPitcherChange[teamKey] = { situation, changeReason };
            shouldChange = false;
          } else {
            const pending = gameState.pendingPitcherChange[teamKey];
            gameState.pendingPitcherChange[teamKey] = null;
            if (!shouldChange && pending) {
              shouldChange = true;
              situation = pending.situation;
              changeReason = pending.changeReason;
            }
          }

          if (shouldChange) {
            let reliever = null;
            const fatigue = rotation?.reliefFatigue || {};
            let selectedRoleLabel = '';

            // 今試合で既に登板した投手のIDセット（再登板防止）
            const alreadyPitchedIds = addRemovedIds(new Set(
              gameState.pitcherAppearances[teamKey].map(a => a.id)
            ), gameState);
            // 現在の投手も除外対象に追加
            alreadyPitchedIds.add(pitcher.id);
            // 選手が起用可能かチェック（未登板 & 疲労OK & 現在の投手でない）
            const isAvailable = (id) => !alreadyPitchedIds.has(id) && (fatigue[id] || 0) < 50 &&
              canEnterRelief(team.players, id, pitcher.id, gameState.removedIds);

            // セーブ場面: クローザー最優先（既にマウンドにいる場合は交代不要）
            if (situation === 'save' && rotation?.closer) {
              if (pitcher.id === rotation.closer) {
                shouldChange = false;
              } else {
                const closerData = team.players.find(p => p.id === rotation.closer && p.id !== pitcher.id);
                if (closerData && isAvailable(rotation.closer)) {
                  reliever = closerData;
                  selectedRoleLabel = '守護神';
                }
              }
            }

            // ホールド場面: セットアッパー優先
            if (shouldChange && !reliever && (situation === 'hold' || situation === 'save')) {
              for (const setupId of (rotation?.setupMen || [])) {
                const setupData = team.players.find(p => p.id === setupId);
                if (setupData && isAvailable(setupId)) {
                  reliever = setupData;
                  selectedRoleLabel = 'セットアッパー';
                  break;
                }
              }
            }

            // ビハインド場面: ビハインドロール優先
            if (shouldChange && !reliever && situation === 'behind') {
              const behindPitchers = (rotation?.middleRelievers || [])
                .filter(id => pitcherRoles[id] === 'behind' && isAvailable(id))
                .map(id => team.players.find(p => p.id === id))
                .filter(Boolean);
              if (behindPitchers.length > 0) {
                reliever = behindPitchers[0];
                selectedRoleLabel = 'ビハインド';
              }
            }

            // 大量リード: 敗戦処理ロール優先
            if (shouldChange && !reliever && scoreDiff >= 5) {
              const mopupPitchers = (rotation?.middleRelievers || [])
                .filter(id => pitcherRoles[id] === 'mopup' && isAvailable(id))
                .map(id => team.players.find(p => p.id === id))
                .filter(Boolean);
              if (mopupPitchers.length > 0) {
                reliever = mopupPitchers[0];
                selectedRoleLabel = '敗戦処理';
              }
            }

            // ショートスターター・オープナー後: ロングリリーフ優先
            if (shouldChange && !reliever && (currentRole === 'short' || currentRole === 'opener')) {
              const longRelievers = (rotation?.middleRelievers || [])
                .filter(id => pitcherRoles[id] === 'long' && isAvailable(id))
                .map(id => team.players.find(p => p.id === id))
                .filter(Boolean);
              if (longRelievers.length > 0) {
                reliever = longRelievers[0];
                selectedRoleLabel = 'ロングリリーフ';
              }
            }

            // 中継ぎエース→通常中継ぎ（疲労が少ない順、ロール別ラベル付き）
            // ワンポイント投手は左打者対策専用なので一般選択から除外
            if (shouldChange && !reliever) {
              const sortedMiddle = (rotation?.middleRelievers || [])
                .filter(id => {
                  const p = team.players.find(pl => pl.id === id);
                  return p && isAvailable(id) && pitcherRoles[id] !== 'onepoint';
                })
                .sort((a, b) => {
                  // 中継ぎエースを接戦時に優先
                  const aIsAce = pitcherRoles[a] === 'ace_relief' ? -1 : 0;
                  const bIsAce = pitcherRoles[b] === 'ace_relief' ? -1 : 0;
                  if (Math.abs(scoreDiff) <= 3) return aIsAce - bIsAce || (fatigue[a] || 0) - (fatigue[b] || 0);
                  return (fatigue[a] || 0) - (fatigue[b] || 0);
                });

              if (sortedMiddle.length > 0) {
                reliever = team.players.find(p => p.id === sortedMiddle[0]);
                const role = pitcherRoles[sortedMiddle[0]];
                selectedRoleLabel = role === 'long' ? 'ロングリリーフ' :
                                   role === 'ace_relief' ? '中継ぎエース' :
                                   role === 'mopup' ? '敗戦処理' :
                                   role === 'behind' ? 'ビハインド' : '中継ぎ';
              }
            }

            // フォールバック（先発ローテーション投手・登板済み投手は除外）
            if (shouldChange && !reliever) {
              const starterIds = new Set(rotation?.starters || []);
              // ⚠ `.find()` はロスター順なので同じ投手が毎試合指名される。
              //    reliefFatigue の少ない順にし、守護神は最後へ回す（`closerLast`）
              reliever = team.players
                .filter(p =>
                  isPitcher(p) &&
                  p.battingOrder === 0 &&
                  p.isActive !== false &&
                  !alreadyPitchedIds.has(p.id) &&
                  !starterIds.has(p.id) &&
                  (p.currentStamina || 80) > 40
                )
                .sort(closerLast(fatigue, rotation?.closer))[0];
              if (reliever) selectedRoleLabel = '緊急中継ぎ';
              if (!reliever) {
                // 最終手段: 先発ローテーション投手も除外せず最もスタミナの残っている投手を選ぶ
                // （先発がpitcherAppearancesに入るとセーブ判定が狂うため、先発は除外して探す）
                const allPitchers = team.players
                  .filter(p => isPitcher(p) && p.battingOrder === 0 && p.isActive !== false && !alreadyPitchedIds.has(p.id) && !starterIds.has(p.id))
                  .sort(closerLast(fatigue, rotation?.closer, (a, b) => (b.currentStamina || 0) - (a.currentStamina || 0)));
                if (allPitchers.length > 0) {
                  reliever = allPitchers[0];
                  selectedRoleLabel = '緊急登板';
                } else {
                  // 本当に誰もいない場合のみ先発投手を緊急起用
                  const starterPitchers = team.players
                    .filter(p => isPitcher(p) && p.battingOrder === 0 && p.isActive !== false && !alreadyPitchedIds.has(p.id) && starterIds.has(p.id))
                    .sort((a, b) => (b.currentStamina || 0) - (a.currentStamina || 0));
                  if (starterPitchers.length > 0) {
                    reliever = starterPitchers[0];
                    selectedRoleLabel = '緊急登板(先発)';
                  }
                }
              }
            }

            if (reliever) {

              // 投手交代記録を保存
              gameState.pitcherChanges.push({
                inning: gameState.inning,
                isTop: gameState.isTopInning,
                team: teamName,
                out: pitcher.name,
                in: reliever.name,
                role: selectedRoleLabel,
                reason: changeReason
              });

              if (!reliefTrack.starterLeftInning) {
                reliefTrack.starterLeftInning = gameState.inning;
              }

              // 登板記録を追加（セーブ・ホールド判定用）
              const teamKey = team === gameState.homeTeam ? 'home' : 'away';
              const appearances = gameState.pitcherAppearances[teamKey];
              appearances.push({
                id: reliever.id,
                entryInning: gameState.inning,
                entryIsTop: gameState.isTopInning,
                entryScore: { ...gameState.score },
                isStarter: false
              });

              const relieverData = team.players.find(p => p.id === reliever.id);
              const relieverOldOrder2 = relieverData.battingOrder;
              const relieverOldPos2 = relieverData.position;
              const relieverWasDH2 = !!relieverData._isDH;
              const isTwoWaySwap2 = inFieldSlot(relieverData);
              const replacement = isTwoWaySwap2
                ? reliefFieldReplacement(team.players, relieverData, pitcher.id, gameState.removedIds)
                : null;

              // 投手に代打が出ていたら、継投の投手はその代打の打順に入り、代打は退く
              const ph = gameState.pitcherPinchHit[teamKey];
              const pitcherSlot = useDH ? 0 : (ph ? ph.slot : (pitcherData.battingOrder || 9));
              if (ph) {
                const phData = team.players.find(p => p.id === ph.phId);
                if (phData) { phData.battingOrder = 0; gameState.removedIds.add(phData.id); }
                gameState.pitcherPinchHit[teamKey] = null;
              }
              pitcherData.battingOrder = 0;
              pitcherData.position = 'pitcher';
              gameState.removedIds.add(pitcherData.id);

              relieverData.battingOrder = pitcherSlot;
              relieverData.position = 'pitcher';
              delete relieverData._isDH;
              relieverData.currentStamina = relieverData.pitching?.stamina || 80;

              // DH の枠なら代わりも DH（上の継投と同じ）
              if (replacement && relieverOldPos2) {
                replacement.battingOrder = relieverOldOrder2;
                replacement.position = relieverOldPos2;
                if (relieverWasDH2) replacement._isDH = true; else delete replacement._isDH;
              }

              reliefTrack.currentRelieverId = reliever.id;
              reliefTrack.relieverOutsPitched = 0;
              reliefTrack.relieverBattersFaced = 0;
      reliefTrack.relieverInningRuns = 0;

              // currentPitcherId を更新
              const pitcherTeamKey2 = team === gameState.homeTeam ? 'home' : 'away';
              gameState.currentPitcherId[pitcherTeamKey2] = reliever.id;

              if (TEAMS_DATA[teamName]?.pitchingRotation?.reliefFatigue) {
                // ⚠ 打席間の交代・aiManager と同じ +50・上限150（ここだけ +30・上限なしだった）
                TEAMS_DATA[teamName].pitchingRotation.reliefFatigue[reliever.id] = Math.min(150,
                  (TEAMS_DATA[teamName].pitchingRotation.reliefFatigue[reliever.id] || 0) + 50);
              }
            }
          }
        }
      }

      // AI監督: 守備固めを検討
      considerDefensiveReplacement(team);
    });
  };

  // 試合実行
  // ⚠ 終了判定は**半イニングごと**に行うこと。以前は
  //    `inning <= 9 || (inning > 9 && 同点)` だったので、延長の表に勝ち越した瞬間に
  //    （裏を打たせずに）試合が終わっていた（延長で決着した試合の約6%＝全試合の約6%）。
  //    9回以降: 表の終了時にホームがリード → 裏は不要 / 裏の終了時に差がある → 決着。
  //    延長は規定の上限まで（既定12回。その回の裏を終えて同点なら引き分け）
  // ⚠ 勝ち抜きの大会（`isCupGame`）は規定の上限を使わず、従来どおり12回まで。
  //    規定はリーグ戦のためのもので、上限を9回にすると、裏で回っている
  //    大会の試合まで引き分けが増え、勝者が強さのくじ（`simulateQuickMatch`）で決まっていた
  const MAX_INNINGS = isCupGame ? 12 : normalizeMaxExtraInnings(LEAGUE_SETTINGS.maxExtraInnings);
  for (;;) {
    simulateInning();                         // 終わると isTopInning が反転済み
    const endedTop = !gameState.isTopInning;  // いま終わったのが表か
    const inn = endedTop ? gameState.inning : gameState.inning - 1;
    if (inn < 9) continue;
    const { home, away } = gameState.score;
    if (endedTop && home > away) break;
    if (!endedTop && (home !== away || inn >= MAX_INNINGS)) break;
  }

  // 試合結果
  const homeScore = gameState.score.home;
  const awayScore = gameState.score.away;
  let result;
  let winner;

  if (homeScore > awayScore) {
    result = `${homeTeamName} ${homeScore}-${awayScore}`;
    winner = homeTeamName;
  } else if (awayScore > homeScore) {
    result = `${awayTeamName} ${awayScore}-${homeScore}`;
    winner = awayTeamName;
  } else {
    result = `引分 ${homeScore}-${awayScore}`;
    winner = null;
  }


  // 試合終了後、選手のシーズン成績と通算成績を更新
  const updatePlayerSeasonStats = (team, isWinner) => {
    // 先発投手のIDを特定（pitcherAppearancesはリリーフ投手のみ記録されるため、
    // リリーフリストに含まれない＆投球イニングがある投手＝先発投手）
    const teamKey = team === gameState.homeTeam ? 'home' : 'away';
    const reliefIds = new Set(gameState.pitcherAppearances[teamKey].map(a => a.id));

    team.players.forEach(player => {
      if (!player.gameStats) return;

      // TEAMS_DATAの該当選手を取得（参照を更新）
      const teamData = TEAMS_DATA[team.name];
      if (!teamData) return;

      const playerData = teamData.players.find(p => p.id === player.id);
      if (!playerData) return;

      // seasonStats が未初期化の場合（新加入選手など）に安全に初期化
      if (!playerData.seasonStats) playerData.seasonStats = { batting: {}, pitching: {} };
      if (!playerData.seasonStats.batting) playerData.seasonStats.batting = {};
      if (!playerData.seasonStats.pitching) playerData.seasonStats.pitching = {};

      // 出場した選手はその日の疲労回復を行わない（recoverAllPitcherFatigueでスキップ）。
      // 打席・登板が無くても、打順を持っていれば途中出場（代走・守備固め）とみなす。
      {
        const gb = player.gameStats.batting || {};
        const gp = player.gameStats.pitching || {};
        const appeared = (gb.atBats || 0) > 0 || (gb.walks || 0) > 0 || (gb.hitByPitch || 0) > 0
          || (gp.outs || 0) > 0 || (gp.pitches || 0) > 0
          || (player.battingOrder || 0) > 0;
        if (appeared) playerData._playedToday = true;
      }

      // 打撃成績の集計
      // ⚠ 条件を atBats>0 だけにすると「0打数2四球」の試合の四球・死球が
      //    シーズン成績から丸ごと落ちる（実測で死球が9%欠けていた）
      if (player.gameStats.batting.atBats > 0
          || player.gameStats.batting.walks > 0
          || player.gameStats.batting.hitByPitch > 0
          || (player.gameStats.batting.sacrificeBunts || 0) > 0) {   // 犠打だけの試合も出場
        const b = player.gameStats.batting;
        const season = playerData.seasonStats.batting;

        season.games = (season.games || 0) + 1;
        season.atBats = (season.atBats || 0) + b.atBats;
        season.hits = (season.hits || 0) + b.hits;
        season.doubles = (season.doubles || 0) + (b.doubles || 0);
        season.triples = (season.triples || 0) + (b.triples || 0);
        season.homeruns = (season.homeruns || 0) + b.homeruns;
        season.rbis = (season.rbis || 0) + b.rbis;
        season.walks = (season.walks || 0) + b.walks;
        season.hitByPitch = (season.hitByPitch || 0) + (b.hitByPitch || 0);
        season.strikeouts = (season.strikeouts || 0) + b.strikeouts;
        season.stolenBases = (season.stolenBases || 0) + (b.stolenBases || 0);
        season.caughtStealing = (season.caughtStealing || 0) + (b.caughtStealing || 0);
        season.sacrificeBunts = (season.sacrificeBunts || 0) + (b.sacrificeBunts || 0);

        // 経験値蓄積（出場1 + 打席数/3）
        const expGained = 1 + Math.floor(b.atBats / 3);
        playerData.experience = (playerData.experience || 0) + expGained;

        // ポジション・打順別経験を蓄積
        if (!playerData.positionExperience) playerData.positionExperience = {};
        const pos = player.position || 'unknown';
        playerData.positionExperience[pos] = (playerData.positionExperience[pos] || 0) + 1;

        if (!playerData.battingOrderExperience) playerData.battingOrderExperience = {};
        const bo = player.battingOrder || 0;
        if (bo >= 1 && bo <= 9) {
          playerData.battingOrderExperience[bo] = (playerData.battingOrderExperience[bo] || 0) + 1;
        }

        // 野手疲労蓄積: スタメン出場(3打席以上)のみ疲労が溜まる
        // 代打(1-2打席)や守備固めは疲労の蓄積なし（ただし回復もしない）
        if (b.atBats >= 3) {
          const bodyStamina = playerData.physical?.bodyStamina || 50;
          // 基礎疲労 7〜15（体力100→7, 体力1→15）
          const baseFatigue = Math.round(15 - (bodyStamina / 100) * 8);
          playerData.fatigue = (playerData.fatigue || 0) + baseFatigue;
        }
        // 死球の疲労は打席数に関わらず乗る（代打の1打席で当たっても痛い）
        if (b.hbpFatigue) playerData.fatigue = (playerData.fatigue || 0) + b.hbpFatigue;

        // 成長率変動: 10試合出場ごとに+0.01
        // 摩耗ペナルティはスタメン出場(3打席以上)時のみ、疲労度に応じて段階的に適用
        // （代打・代走・守備固めではペナルティ無し）
        applyFatigueGrowthPenalty(playerData, b.atBats >= 3);
        if (season.games % 10 === 0) adjustGrowthModifier(playerData, 0.01);
      }

      // 投手成績の集計
      // ⚠ **アウトを1つも取れなかった登板も数える**（采配試合の `gameSetup` と同じ条件）。
      //    以前は `outs > 0` だけで、打者に投げて1死も取れずに降りた投手の
      //    失点・被安打・四球・登板数・疲労がまるごと消えていた（防御率が良く見える）。
      if (player.gameStats.pitching.outs > 0 || player.gameStats.pitching.pitches > 0) {
        const p = player.gameStats.pitching;
        const season = playerData.seasonStats.pitching;

        season.games = (season.games || 0) + 1;
        season.inningsPitched = (season.inningsPitched || 0) + p.outs;
        season.runsAllowed = (season.runsAllowed || 0) + p.runsAllowed;
        // 自責点は試合中に失策を考慮して積算済み（p.earnedRuns）。
        // 万一未設定なら失点で代替する（旧セーブ・想定外経路の保険）。
        season.earnedRuns = (season.earnedRuns || 0) + (p.earnedRuns ?? p.runsAllowed);
        season.hits = (season.hits || 0) + (p.hits || 0);
        season.homeruns = (season.homeruns || 0) + (p.homeruns || 0);
        season.strikeouts = (season.strikeouts || 0) + p.strikeouts;
        season.walks = (season.walks || 0) + p.walks;
        season.hitBatters = (season.hitBatters || 0) + (p.hitBatters || 0);
        season.pitches = (season.pitches || 0) + p.pitches;
        season.wildPitches = (season.wildPitches || 0) + (p.wildPitches || 0);

        // 成長率変動: 摩耗ペナルティは10球以上投げた登板のみ、疲労度に応じて段階的に適用
        // （10球以下のワンポイント起用ではペナルティ無し）
        applyFatigueGrowthPenalty(playerData, (p.pitches || 0) >= 10);

        // 投手疲労蓄積: bodyStaminaが高いほど疲労が溜まりにくい
        // 先発かどうかはリリーフリストに含まれないかで判定（投球回数ではなく登板種別）
        // ショートスターターも先発登板扱いにしてリリーフより多く疲労が溜まる
        const wasStarter = !reliefIds.has(player.id);
        const bodyStamina = playerData.physical?.bodyStamina || 50;
        const staminaBonus = (bodyStamina / 100) * 1.5;
        const baseDivisor = wasStarter ? 1.5 : 3;
        const pitchFatigue = Math.floor(p.pitches / (baseDivisor + staminaBonus));
        // startBonusは先発として1イニング以上投げた場合のみ付与（短命降板でもペナルティがつかないよう）
        const startBonus = (wasStarter && (p.outs || 0) >= 3) ? 30 : 0;
        const fatigueGain = wasStarter ? pitchFatigue + startBonus : Math.max(11, pitchFatigue);
        playerData.fatigue = (playerData.fatigue || 0) + fatigueGain;

        // 成長率変動: 先発はイニング数ベース、リリーフは登板数ベース
        if (wasStarter) {
          // 先発: 15イニング(45アウト)ごとに+0.01
          const prevTotalOuts = season.inningsPitched - p.outs;
          if (Math.floor(season.inningsPitched / 45) > Math.floor(prevTotalOuts / 45)) {
            adjustGrowthModifier(playerData, 0.01);
          }
        } else {
          // リリーフ: 登板数ベース（守護神/セットアッパー/中継ぎエースは4登板、その他は5登板ごと）
          const pitcherRoles = teamData.pitchingRotation?.pitcherRoles || {};
          const role = pitcherRoles[player.id] || '';
          const highPressureRoles = ['closer', 'setup', 'ace_relief'];
          const threshold = highPressureRoles.includes(role) ? 4 : 5;
          if (season.games % threshold === 0) {
            adjustGrowthModifier(playerData, 0.01);
          }
        }

        // 経験値蓄積（登板1 + 投球回数）
        const inningsPitched = Math.floor(p.outs / 3);
        const expGained = 1 + inningsPitched;
        playerData.experience = (playerData.experience || 0) + expGained;

        // QS/HQS判定（先発投手のみ）
        if (wasStarter) {
          season.gamesStarted = (season.gamesStarted || 0) + 1;
          const innings = p.outs; // アウト数（18アウト = 6回）
          const earnedRuns = p.earnedRuns ?? p.runsAllowed; // QS/HQSは自責点で判定
          // QS: 6回以上 && 自責点3以下
          if (innings >= 18 && earnedRuns <= 3) {
            season.qualityStarts = (season.qualityStarts || 0) + 1;
          }
          // HQS: 7回以上 && 自責点2以下
          if (innings >= 21 && earnedRuns <= 2) {
            season.highQualityStarts = (season.highQualityStarts || 0) + 1;
          }
        }

        // 勝敗・セーブ・ホールドは試合の最後に `recordDecisions` がまとめて記録する
      }

      // 守備成績の集計
      if (player.gameStats.fielding) {
        const f = player.gameStats.fielding;
        if (f.chances > 0 || f.errors > 0 || f.assists > 0) {
          const season = playerData.seasonStats.batting;
          season.fieldingChances = (season.fieldingChances || 0) + f.chances;
          season.errors = (season.errors || 0) + f.errors;
          season.assists = (season.assists || 0) + (f.assists || 0); // 捕殺
        }
      }
    });
  };

  // ホームチームとアウェイチームの成績を更新
  updatePlayerSeasonStats(gameState.homeTeam, winner === homeTeamName ? true : winner === awayTeamName ? false : null);
  updatePlayerSeasonStats(gameState.awayTeam, winner === awayTeamName ? true : winner === homeTeamName ? false : null);

  // 勝利・敗戦・セーブ・ホールド（リードの移り変わりから。pitcherDecisions.js）
  const decisions = decisionsFromResult({
    homeScore, awayScore, homeTeam: gameState.homeTeam, awayTeam: gameState.awayTeam,
    decisionLog: gameState.decisionLog,
  });
  if (winner) {
    recordDecisions(decisions, {
      winTeam: winner, loseTeam: winner === homeTeamName ? awayTeamName : homeTeamName,
    }, TEAMS_DATA);
  }

  return {
    homeScore,
    awayScore,
    result,
    winner,
    homeTeam: gameState.homeTeam,
    awayTeam: gameState.awayTeam,
    pitcherChanges: gameState.pitcherChanges,
    decisionLog: gameState.decisionLog,
    decisions,
    lineScore: gameState.lineScore,
    walkOff: !!gameState.walkOff,
    pitcherAppearances: gameState.pitcherAppearances
  };
};

export const autoSimulateGame = (homeTeamName, awayTeamName, isCupGame = false, seed = null, observer = null) =>
  seed === null ? simulateGame(homeTeamName, awayTeamName, isCupGame, observer)
    : withSeededRandom(seed, () => ({ ...simulateGame(homeTeamName, awayTeamName, isCupGame, observer), rngSeed: seed }));

