// ============================================================
// 注目選手リスト（ウォッチリスト） - watchList.js
//
// 【役割】階層をまたいだ選手を追い続けられるようにする。
//
// この世界には高校生5000人・大学生・社会人・独立・プロが同時に存在するが、
// 選手がどこへ進んだかを追う手段が無かった。そのため
//   「甲子園で見たあの選手が、3年後にドラフト1位になった」
//   「うちが獲れなかった選手が、社会人でブレイクした」
// という、ステップアップを描く作品の核になる物語が、
// 実際には起きていても画面に現れなかった。
//
// ここでは playerId だけを登録しておき、表示のたびに各プールを横断検索して
// 「今どこにいるか」を解決する。選手オブジェクトはプールからプールへ移る際に
// 参照が張り替わるため、実体を握らず ID で追うのが唯一壊れない方法になる。
// ============================================================

import { WORLD_DATA } from '../corporate/worldData.js';
import { TEAMS_DATA, releasedPlayersPool } from '../teams-data.js';
import { highSchoolPool, universityPool } from '../state/schoolPools.js';

const MAX_WATCH = 60;

const list = () => {
  if (!Array.isArray(WORLD_DATA.watchList)) WORLD_DATA.watchList = [];
  return WORLD_DATA.watchList;
};

/** 注目リストに追加する。すでに居れば何もしない */
export function addToWatchList(player, year = 0, note = '') {
  if (!player?.id) return false;
  const l = list();
  if (l.some(w => w.playerId === player.id)) return false;
  if (l.length >= MAX_WATCH) return false;
  l.push({
    playerId: player.id,
    name: player.name,
    addedYear: year,
    note,
    // 登録時点の姿。後で「あの頃と比べてどう伸びたか」を出すために残す
    snapshot: {
      age: player.age,
      position: player.position,
      school: player.highSchool?.name || null,
      pref: player.highSchool?.pref || null,
      velocity: player.pitching?.velocity ?? null,
      control: player.pitching?.control ?? null,
      meet: player.batting?.meet ?? null,
      power: player.batting?.power ?? null,
      fame: player.fame ?? 0,
    },
  });
  return true;
}

export function removeFromWatchList(playerId) {
  const l = list();
  const i = l.findIndex(w => w.playerId === playerId);
  if (i === -1) return false;
  l.splice(i, 1);
  return true;
}

export function isWatched(playerId) {
  return list().some(w => w.playerId === playerId);
}



/**
 * 選手が今どこにいるかを解決する。
 * 進路が変わるたびに選手オブジェクトは別のプールへ移るため、
 * 全プールを順に探す。見つからなければ引退（消息不明）とみなす。
 *
 * @returns {{status, location, detail, player, npb}} status は
 *   'highschool' | 'university' | 'team' | 'npb' | 'released' | 'gone'
 */
export function resolveWatchedPlayer(playerId) {
  // 1. 高校生プール（4月〜11月の進路振り分けまで）
  const hs = (highSchoolPool.players || []).find(p => p.id === playerId);
  if (hs) {
    return {
      status: 'highschool', location: hs.highSchool?.name || '高校',
      detail: `${hs.highSchool?.pref || ''} ${hs.age}歳`, player: hs,
    };
  }

  // 2. 大学プール（在学中。入学年度ごとにネストしている）
  for (const [enrollYear, entries] of Object.entries(universityPool)) {
    for (const e of entries || []) {
      if (e?.player?.id !== playerId) continue;
      const grade = e.graduateYear && WORLD_DATA.year
        ? Math.max(1, 4 - (e.graduateYear - WORLD_DATA.year)) : null;
      return {
        status: 'university',
        location: e.universityName || e.player.universityName || '大学',
        detail: `${grade ? `${grade}年` : `${enrollYear}年入学`}${e.universityRank ? ` / ${e.universityRank}ランク校` : ''}`,
        player: e.player,
      };
    }
  }

  // 3. 各チームの所属選手（社会人・独立・大学チーム）
  for (const [teamName, team] of Object.entries(TEAMS_DATA || {})) {
    const p = (team?.players || []).find(x => x.id === playerId);
    if (p) {
      return {
        status: 'team', location: teamName,
        detail: `${p.age}歳 ${p.position === 'pitcher' ? '投手' : '野手'}`,
        player: p,
      };
    }
  }

  // 4. プロ入り（教え子として記録されている場合のみ経歴が追える）
  for (const [teamName, team] of Object.entries(TEAMS_DATA || {})) {
    const a = (team?.npbAlumni || []).find(x => x.playerId === playerId);
    if (a) {
      const last = (a.npbSeasons || [])[(a.npbSeasons || []).length - 1] || null;
      return {
        status: 'npb', location: a.npbTeam || 'NPB',
        detail: a.retired ? `${a.retiredYear}年に引退`
          : `${last?.level || '入団直後'} ${a.age}歳（${teamName}から${a.draftYear}年${a.draftRound}位）`,
        player: a, npb: a,
      };
    }
  }

  // 5. リリースプール（トライアウト・スカウトの候補として残っている）
  const rel = (releasedPlayersPool || []).find(p => p.id === playerId);
  if (rel) {
    return {
      status: 'released', location: '無所属',
      detail: `${rel.age}歳 / トライアウト・スカウト候補`, player: rel,
    };
  }

  return { status: 'gone', location: '消息不明', detail: '引退したとみられる', player: null };
}

export const WATCH_STATUS_LABEL = {
  highschool: '高校', university: '大学', team: '所属中',
  npb: 'プロ', released: '無所属', gone: '引退',
};

/** 注目リスト全員の現在地を解決して返す（表示用） */
export function resolveWatchList() {
  return list().map(w => {
    const cur = resolveWatchedPlayer(w.playerId);
    const p = cur.player;
    // 登録時からの伸びを出す。投手は球速と制球、野手はミートとパワー
    let growth = null;
    if (p && cur.status !== 'gone') {
      const s = w.snapshot || {};
      if (s.velocity != null && p.pitching?.velocity != null) {
        growth = `球速 ${s.velocity}→${p.pitching.velocity} / 制球 ${s.control ?? '-'}→${p.pitching.control ?? '-'}`;
      } else if (s.meet != null && p.batting?.meet != null) {
        growth = `ミート ${s.meet}→${p.batting.meet} / パワー ${s.power ?? '-'}→${p.batting.power ?? '-'}`;
      }
    }
    return { ...w, ...cur, growth };
  });
}
