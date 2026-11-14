// ============================================================
// 多人数ペナントの参加者（ログインして参加・途中参加）
//
// 設計は docs/online/PYRAMID_LEAGUE.md。
//
// 【なぜ必要か】現行は参加者を環境変数（ONLINE_MEMBER_1 / 2）で固定しており、
// 1人増やすたびに設定の編集と再デプロイが要る。`createLeague` にも
// `members.length === 2` の強制があった。これでは2人以外で遊べない。
// **参加者はリーグのデータ側で持つ**形に変える。
//
// ⚠ **ここは純粋な計算だけを持つこと**。保存・通信・乱数の生成に触らない。
//    `Math.random()` を呼ばない（シードから決まる必要がある）。
//    配線（API・サーバー）は別のファイルで行う。
// ============================================================
import { requireOnline } from './shared.js';
import { cleanText, OWNER_COMMENT_MAX } from './social.js';
import { PACK_STYLE } from './rosterPack.js';
import { PYRAMID_LEAGUES, PYRAMID_TEAM_COUNT } from './pyramidLeague.js';

/** 参加できる上限。球団数と同じ（全球団が人間でも成立する） */
export const MAX_MEMBERS = PYRAMID_TEAM_COUNT; // 12（2部制）

/**
 * 途中参加が入れる階層。**最下層だけ**。
 * 上の階層から始められると、昇降格で積み上げた順位の意味が消える。
 *
 * ⚠ **構造から導くこと**。以前は `2` と直に書いており、
 *    7リーグ（最下層=2）から2部制（最下層=1）へ変えたときに
 *    「誰も参加できないリーグ」になるところだった。
 */
export const JOIN_TIER = Math.max(...PYRAMID_LEAGUES.map((l) => l.tier));

export const joinableLeagueIds = () =>
  PYRAMID_LEAGUES.filter((l) => l.tier === JOIN_TIER).map((l) => l.id);

/**
 * 参加者に割り当てる順の球団。**下の階層から**並べる。
 * ⚠ 上の階層から埋めると、昇降格で積み上げた順位の意味が消える。
 *    Cが埋まったらB、それも埋まったらA、という順で続ける。
 */
export function assignmentOrder(teams) {
  const tierOf = Object.fromEntries(PYRAMID_LEAGUES.map((l) => [l.id, l.tier]));
  return [...teams].sort(
    (a, b) =>
      (tierOf[b.league] ?? 0) - (tierOf[a.league] ?? 0) ||
      (a.league < b.league ? -1 : a.league > b.league ? 1 : 0) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

/** 人間が持っていない球団（＝CPU） */
export function cpuTeams(league) {
  const held = new Set((league.members || []).map((m) => m.teamName));
  return (league.teams || []).filter((t) => !held.has(t.name));
}

/**
 * 途中参加者が入る枠を決める。**最下層（2部）のCPUの中で一番弱い球団**。
 *
 * 弱さの順は 勝利数 → 勝率 → 球団の格付け → 名前 の順で比べる。
 * ⚠ **最後に名前まで見ること**。開幕前は全球団が 0勝0敗・同じ格付けになり得るので、
 *    そこで止めると「どれが最下位か」が実行のたびに変わる。
 */
export function weakestJoinableTeam(league, standings = {}) {
  const ids = joinableLeagueIds();
  const RANK_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 };
  const candidates = cpuTeams(league).filter((t) => ids.includes(t.league));
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const sa = standings[a.name] || {};
    const sb = standings[b.name] || {};
    return (
      (sa.wins || 0) - (sb.wins || 0) ||
      (sa.winRate || 0) - (sb.winRate || 0) ||
      (RANK_ORDER[b.rank] ?? 9) - (RANK_ORDER[a.rank] ?? 9) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    );
  })[0];
}

/**
 * 参加できるかを検査する。できないときは理由付きで止める。
 *
 * ⚠ **招待コードは廃止した**。アカウントは管理者が Supabase で作らない限り
 *    増えない（公開サインアップは無効）ので、入口はそこで絞れている。
 *    その上にコードを重ねると、人を呼ぶたびに発行と受け渡しの手間が増えるだけだった。
 * ⚠ **理由を分けて返すこと**。「参加できません」だけだと、満員なのか
 *    既に参加済みなのかが分からず、受け取った人が詰む。
 */
export function assertCanJoin(league, userId) {
  requireOnline(league, 'リーグがまだありません', 409);
  requireOnline(
    !(league.members || []).some((m) => m.userId === userId),
    'すでに参加しています',
    409,
  );
  requireOnline(
    (league.members || []).length < MAX_MEMBERS,
    `参加できるのは${MAX_MEMBERS}人までです`,
    409,
  );
  // ⚠ **順位表を渡すこと**。渡さないと勝敗が見られず、常に「格付けが低い→名前順」で
  //    決まる（シーズン途中だと2部の首位のCPU球団を引き継ぐこともあった）。
  //    順位表は配列なので、球団名で引ける形にして渡す
  const standings = Object.fromEntries(
    (league.season?.standings || []).map((s) => [s.team, s]),
  );
  const team = weakestJoinableTeam(league, standings);
  requireOnline(team, '空いている球団がありません', 409);
  return { team };
}

/**
 * 参加を反映する。`league` を書き換えて返す。
 *
 * 弾かれたCPU球団の扱いは **A方式（引き継ぎ）**。
 * 新しい参加者がその枠と選手をそのまま受け取り、**表示名**を自分のものにする。
 *
 * ⚠ **内部の球団名（`name`）は変えないこと。** 名前は
 *    `TEAMS_DATA` のキー・日程の対戦相手・順位表・試合結果・
 *    記録の選手キー（`onlinePlayerId`）まで貫いており、
 *    参加のたびに付け替えると記録が迷子になる。
 *    見せる名前は `displayName` で持ち、内部の同一性は `name` が担う
 *    （一人用の社会人球団と同じ作り）。
 * ⚠ B方式（球団ごと消して新規に作る）へ変えるなら**ここだけ**を差し替える。
 *    選手の行き先（プール・分配・消滅）を決める必要がある。
 */
// ⚠ **この関数は `league` と、その中の球団オブジェクトを書き換える**（engine 側の流儀に合わせている）。
//    呼ぶ側が「参加前の球団名」を参照で持っていると、書き換えで一緒に変わる。
//    比べたいなら**文字列で控えてから**呼ぶこと（検査で実際に踏んだ）。
/**
 * 球団名が使えるか。⚠ 内部名と表示名の**両方**と見比べる。
 *    片方だけだと同じ名前が2つ並ぶ。
 */
export function assertTeamNameFree(league, team, shown) {
  requireOnline(shown.length <= 24, '球団名が長すぎます', 400);
  requireOnline(
    !(league.teams || []).some(
      (t) => t !== team && (t.name === shown || t.displayName === shown),
    ),
    'その球団名は使われています',
    409,
  );
}

/**
 * 球団名とプレイヤー名を後から変える。
 *
 * ⚠ **参加のときしか名前を付けられなかった**。リーグを作った管理者には
 *    その機会すら無く、順位表に「湘南サンズ（湘南サンズ）」のように
 *    球団名が2回出ていた（参加時の呼び名が既定で球団名だったため）。
 * ⚠ 内部名（`name`）は変えない。記録の選手キーまで貫いている。
 */
export function applyProfile(league, { userId, teamName, playerName, comment, now = null }) {
  requireOnline(league, 'リーグがまだありません', 409);
  const member = (league.members || []).find((m) => m.userId === userId);
  requireOnline(member, '参加者ではありません', 403);
  const team = (league.teams || []).find((t) => t.name === member.teamName);
  requireOnline(team, '球団が見つかりません', 409);
  if (teamName !== undefined) {
    const shown = String(teamName || '').trim() || team.name;
    assertTeamNameFree(league, team, shown);
    team.displayName = shown;
    member.displayName = shown;
  }
  if (playerName !== undefined) {
    const who = String(playerName || '').trim();
    requireOnline(who.length <= 24, '名前が長すぎます', 400);
    member.label = who || member.displayName || team.name;
  }
  // オーナーのひとこと（改善案 C1）。順位表・球団の画面・紙面に出す。空なら消す。
  // ⚠ 書いた日も残す（紙面で「開幕前の宣言」と結果を並べられるように）
  if (comment !== undefined) {
    const { text, tooLong } = cleanText(comment, OWNER_COMMENT_MAX);
    requireOnline(!tooLong, `ひとことは${OWNER_COMMENT_MAX}字までです`, 400);
    if (text) member.comment = { text, at: now, year: league.season?.year ?? null };
    else delete member.comment;
  }
  return {
    teamName: team.name,
    displayName: team.displayName,
    label: member.label,
    comment: member.comment?.text || '',
  };
}

export function applyJoin(league, { userId, label, teamName, now }) {
  const { team } = assertCanJoin(league, userId);
  const shown = String(teamName || '').trim() || team.name;
  assertTeamNameFree(league, team, shown);
  team.displayName = shown;
  // ⚠ **種の番号は参加の通し番号**（人数ではない）。球団をCPUに戻すと人数が減るので、
  //    人数で数えると次に入った人が残っている人と同じ種になり、同じidの選手ができる
  const index = Math.max(league.memberSeq ?? 0, (league.members || []).length);
  league.memberSeq = index + 1;
  league.members = [
    ...(league.members || []),
    {
      userId,
      label: label || shown,
      // ⚠ `teamName` は**内部名**。参加後の照合はすべてこれで行う
      teamName: team.name,
      displayName: shown,
      joinedAt: now,
      // ⚠ **開幕後に参加した人には、自分のセットを選ばせる**。引き継いだCPUの
      //    名簿のままだと、自分で選んだ24人で始められない。
      //    選んだセットは**次のキャンプ**で名簿に入る（シーズン途中で入れ替えると
      //    順位表と成績が合わなくなる）。
      // ⚠ セットそのものは保存しない。20セット×24人＝480人を抱えることになる。
      //    **種だけ**持ち、見るたびに作り直す（`generateRosterPacks` はシードから
      //    決まるので、何度作っても同じ選手になる）。
      // ⚠ 種は人ごとにずらすこと。選手のidは `種×1000＋1〜480` なので、
      //    同じ種を使うと**別の人の名簿に同じidの選手**ができる。
      ...(league.phase?.kind === 'pack_select'
        ? // 開幕前の手続きの最中なら、その手続きで一緒に選ぶ
          null
        : {
            packSeed: (league.seed || 0) + 7 + index,
            // ⚠ **作り方の版も残す**。種から作り直すので、版が変わると
            //    選んだあとでセットの中身が入れ替わってしまう
            packStyle: PACK_STYLE,
            pendingPackId: null,
          }),
    },
  ];
  return {
    league,
    teamName: team.name,
    displayName: shown,
    leagueId: team.league,
  };
}

/**
 * 参加者の人数が成立しているか。1人でも成立する。
 * ⚠ **0人を許さないこと**。誰も居ないリーグは進める意味が無く、
 *    管理者が不在なので停止も再開もできなくなる。
 */
export function assertMemberCount(members) {
  requireOnline(Array.isArray(members), '参加者の設定が必要です');
  requireOnline(members.length >= 1, '参加者が1人も居ません');
  requireOnline(
    members.length <= MAX_MEMBERS,
    `参加できるのは${MAX_MEMBERS}人までです`,
  );
  requireOnline(
    members.every((m) => typeof m.userId === 'string' && m.userId),
    '参加者の識別子が不正です',
  );
  requireOnline(
    new Set(members.map((m) => m.userId)).size === members.length,
    '同じ参加者が重複しています',
  );
}
