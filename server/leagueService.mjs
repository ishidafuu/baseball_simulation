import { isLiveSession, withLogin, withLogout } from './sessions.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { applyJoin, applyProfile } from '../src/online/membership.js';
import { isDeepStrictEqual } from 'node:util';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  requireOnline,
  nextProgressionAt,
  assertLeagueVersion,
  ONLINE_SCHEMA,
  TURN_MINUTES,
} from '../src/online/shared.js';

/**
 * これ以上遅れていたら、定期進行を止めて管理者に見てもらう。
 *
 * ⚠ **ターンの長さから導くこと**。かつて 15分 と直に書いてあり、1ターンを
 *    45分にしたときに取り残された。毎時のcronだと必ず15分超の遅れになるので、
 *    **1ターン進んだ次の時間に必ず止まる**状態になっていた（実測）。
 * ⚠ 少しの遅れで止めないこと。1回の進行で進むのはいつも1ターンなので、
 *    遅れても取り戻しの連打は起きない。止めるのは「本当に長く動いていない」
 *    ときだけでよい（8ターンぶん＝45分なら6時間）。
 */
const STALL_AFTER_MS = TURN_MINUTES * 8 * 60000;
import { isCurrent, migrateLeague } from '../src/online/leagueMigration.js';
import {
  projectLeague,
  projectLineup,
  projectPlayerInfo,
  projectTeamInfo,
  projectGames,
  projectGameInfo,
} from './projection.mjs';
import { saveLineup } from './lineupCommand.mjs';
import { touchPresence } from './social.mjs';
import { setStarterPick } from './starterPicks.mjs';
import { projectTransactions } from './projection.mjs';
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = (value) => structuredClone(value);
// 世界（リーグ外の球団・高校生の母集団など）を必ず読む命令。保存側は最初から全体を読む。
// ⚠ ここに無い命令も、世界に触れば保存側が全体で読み直してやり直すので正しさは崩れない。
//    並べるのはやり直しの1回ぶん（数秒）を省くためだけ（`server/storage/snapshotParts.mjs`）
const FULL_COMMANDS = new Set([
  'create',
  'reset',
  'backup',
  'restore',
  'step',
  'resolve',
  'campRound',
  // 提出は手続きの案を確かめるのに世界を読み込む（`submitPhase` → `loadLeagueWorld`）
  'submit',
  'tradeOffer',
  'tradeRespond',
  // 守備位置の変更も世界を読み込む（`convertPosition` の前の `loadLeagueWorld`）
  'convert',
  // 球団をCPUに戻すと編成を作り直す。練習試合を受けるとその場で1試合する
  'releaseMember',
  'challengeRespond',
]);
// ⚠ **バックアップは圧縮した文字列で持つ**。リーグ（世界の写し込み）をそのまま
//    抱えると、操作のたびに読み書きする一式が倍の大きさになり、
//    取り込み・書き出しの時間とメモリも倍かかっていた。
//    文字列なら JSON の読み書きは一瞬で、中身は復元のときだけ開く。
//    以前の形（`backup.league` に生のリーグ）もそのまま読める。
const packBackup = (league, takenAt) => ({
  packed: gzipSync(JSON.stringify(league)).toString('base64'),
  takenAt,
});
const unpackBackup = (backup) =>
  typeof backup?.packed === 'string'
    ? JSON.parse(gunzipSync(Buffer.from(backup.packed, 'base64')).toString())
    : clone(backup?.league);
// エンジンはグローバル世界を使うため、同一Nodeプロセス内でも全storeをまたいで直列化する。
let engineQueue = Promise.resolve();
export class LeagueService {
  constructor(
    store,
    {
      members,
      adminId,
      clock = () => new Date().toISOString(),
      local = false,
      // ⚠ `local` とは別に持つこと。`local` は CORS をローカルへ開く印でもあるので、
      //    検証用の進行を本番で使いたいからといって `local` を立ててはいけない。
      allowStep = false,
    } = {},
  ) {
    this.store = store;
    // ⚠ **参加者の正本はリーグのデータ側**（`bundle.league.members`）。
    //    ここに渡すのはリーグがまだ無いときの種（管理者1人）と、
    //    リーグを作らずに動かす検査・開発サーバー向けの控え。
    //    環境変数で参加者を固定していた頃の名残なので、増やさないこと。
    this.members = members || [];
    this.adminId = adminId;
    this.clock = clock;
    this.local = local;
    this.allowStep = allowStep || local;
  }
  async view(userId, sessionId, since = null) {
    // ⚠ **手元のビューと同じ世代なら、ビューを送らない**（`{ unchanged: true }`）。
    //    PCの60秒ごと・アプリに戻るたびの読み直しで、毎回ビュー（数十〜百KB）を
    //    送っていた。世代は公開のたびに上がるので、同じなら中身も同じ。
    //    世代を持たない保存先（ローカルの FileStore）は従来どおり毎回送る。
    if (Number.isInteger(since) && this.store.readGeneration) {
      const current = await this.store.readGeneration(userId, sessionId);
      // ⚠ 保存の版が今のサーバーと違うときは近道しない（下の版の門番を通す）。
      //    更新でサーバーの版が上がっても世代は変わらず、開いていた画面に
      //    古いビューが残ったまま操作だけ弾かれていた
      if (current.generation === since && current.schema === ONLINE_SCHEMA)
        return { unchanged: true, viewGeneration: since, writable: current.writable };
    }
    const view = this.store.readView
      ? await this.store.readView(userId, sessionId)
      : projectLeague(await this.store.read(), userId, sessionId, this.adminId);
    requireOnline(view, 'このリーグの参加者ではありません', 403);
    // ⚠ **ここが版の門番の抜け道だった**。`assertLeagueVersion` は命令のときしか
    //    走らず、最初の画面は**保存済みのビュー**をそのまま出す経路がある
    //    （`SupabaseStore.readView`）。その経路はリーグ本体を読まないので、
    //    固定4球団の頃のリーグが2部制のコードで表示され、どこも壊れていないように
    //    見えてしまった。保存済みのビューには版の印が要る。
    // ⚠ リーグ本体から作ったビュー（`projectLeague`）は、もう自分で版を見て
    //    `versionMismatch` を返している。二重に潰すと `canMigrate` が消える
    if (
      !view.setupRequired &&
      !view.joinRequired &&
      !view.versionMismatch &&
      view.schema !== ONLINE_SCHEMA
    )
      return {
        versionMismatch: true,
        isAdmin: userId === this.adminId,
        // ⚠ 保存済みのビューからはリーグの中身を見られないので、直せるかは
        //    判定できない。画面は管理者に押させ、理由は命令の側が返す
        writable: !!view.writable,
      };
    return view;
  }
  /** 参加者の一覧。リーグがあればそちらを正本にする */
  memberIds(bundle) {
    const inLeague = (bundle?.league?.members || []).map((m) => m.userId);
    return inLeague.length ? inLeague : this.members.map((m) => m.userId);
  }

  /**
   * ⚠ **管理者は常に通すこと**。リーグを作る前は誰も参加者ではないので、
   *    参加者だけに絞ると管理者がログインできず、リーグを作れなくなる。
   */
  isMember(bundle, userId) {
    return userId === this.adminId || this.memberIds(bundle).includes(userId);
  }

  /**
   * @param client 端末の種類。アプリは 'app'、それ以外（PC・スマホのブラウザ）は 'web'。
   *   ブラウザ1台とアプリ1台まで同時に操作できる（`server/sessions.mjs`）
   */
  async login(userId, client = 'web') {
    return this.store.transaction((bundle) => {
      // ⚠ **参加者でなくてもログインは通すこと**。招待された人は
      //    ログインしてからコードを入れるので、ここで締め出すと参加できない
      //    （鶏と卵になる）。公開サインアップは無いので、ここに来られるのは
      //    管理者が作ったアカウントだけ。できることは `command` 側で絞る。
      const sessionId = randomUUID();
      bundle.sessions[userId] = withLogin(bundle.sessions[userId], client, sessionId);
      // 最後に来た時刻（おるすばんを解く）。⚠ 古い形のリーグには書かない（移行の前に形を変えない）
      if (bundle.league && isCurrent(bundle.league)) touchPresence(bundle.league, userId, this.clock());
      return { value: { sessionId } };
    });
  }
  /**
   * 画面を開いた・アプリに戻ったことを知らせる（最後に来た時刻とおるすばん。改善案 A3）。
   * ⚠ **revision は上げない**（誰かの操作ではない。送信中の提出を弾かない）。書くのは
   *    前に書いてから数時間経ったとき・おるすばん中のときだけ（`touchPresence`）
   */
  async presence(userId, sessionId) {
    return this.store.transaction((bundle) => {
      const l = bundle.league;
      if (
        !l ||
        !isCurrent(l) ||
        !isLiveSession(bundle.sessions, userId, sessionId) ||
        !touchPresence(l, userId, this.clock())
      )
        return { unchanged: true, value: { ok: true } };
      return { value: { ok: true }, archiveUnchanged: true };
    });
  }
  /** 取引の記録（トレード・退団・入団）。⚠ 芯にあるので軽い読みで足りる */
  async transactions(userId, query) {
    if (this.store.readLight) {
      const light = await this.store.readLight();
      try {
        const result = projectTransactions(light.bundle, userId, query);
        if (!light.touched()) return result;
      } catch (error) {
        if (!light.touched()) throw error;
      }
    }
    return projectTransactions(await this.store.read(), userId, query);
  }
  async teamInfo(userId, teamName) {
    if (this.store.readTeamInfo)
      return this.store.readTeamInfo(userId, teamName);
    return projectTeamInfo(await this.store.read(), userId, teamName);
  }
  async playerInfo(userId, id) {
    if (this.store.readPlayerInfo) return this.store.readPlayerInfo(userId, id);
    return projectPlayerInfo(await this.store.read(), userId, id);
  }
  async games(userId, query) {
    if (this.store.readGames) return this.store.readGames(userId, query);
    return projectGames(await this.store.read(), userId, query);
  }
  async gameInfo(userId, id, year) {
    if (this.store.readGameInfo)
      return this.store.readGameInfo(userId, id, year);
    return projectGameInfo(await this.store.read(), userId, id, year);
  }
  async logout(userId, sessionId) {
    return this.store.transaction((bundle) => {
      // ⚠ **参加者でなくてもログアウトは通す**。ログインは非参加者にも通すので
      //    （参加画面へ進むため）、ここで弾くと参加画面の「ログアウト」が
      //    403になって抜けられなかった。消すのは自分のセッションだけ
      if (!isLiveSession(bundle.sessions, userId, sessionId))
        return { unchanged: true, value: { ok: true } };
      // ⚠ 外すのはこの端末だけ（同時に使っているもう1台は残す）
      const rest = withLogout(bundle.sessions[userId], sessionId);
      if (rest) bundle.sessions[userId] = rest;
      else delete bundle.sessions[userId];
      return { value: { ok: true } };
    });
  }
  /**
   * 保存されたリーグを、いまのコードが読める形へ直す。
   * ⚠ **複製に当ててから差し替える**こと。途中で例外が出たリーグを保存すると、
   *    半分だけ新しい形になって次の移行も通らなくなる。
   * ⚠ **revision は上げない**。中身の形が変わっただけで、誰かの操作ではない。
   *    上げると、送信中だった提出が「他の操作で更新されました」で弾かれる。
   */
  ensureMigrated(bundle) {
    const l = bundle.league;
    if (!l || isCurrent(l)) return { applied: [], changed: false };
    const working = clone(l);
    const result = migrateLeague(working, { now: this.clock() });
    bundle.league = working;
    bundle.league.updatedAt = this.clock();
    // ⚠ **移行で消した次の進行時刻は、ここで入れ直す**（6→7 の段が消す）。
    //    進行中のリーグで空のままだと、定期処理は「進行時刻なし」で何もせず、
    //    保存側の `isDue` も起こさなくなり、**二度と進まない**。
    //    命令の側も「進行中になったとき」しか入れないので、tick と命令の
    //    両方が通るここで直す
    if (bundle.league.status === 'running' && !bundle.league.nextAdvanceAt)
      bundle.league.nextAdvanceAt = nextProgressionAt(this.clock());
    return result;
  }
  /**
   * 手で進められるか。
   * ⚠ 環境変数（`ONLINE_ALLOW_STEP`）は再デプロイが要るので、リーグの
   *    切り替え（`testMode`）でも立てられるようにしてある。どちらかでON
   */
  canStep(league) {
    return this.allowStep || league?.testMode === true;
  }
  async command(userId, sessionId, command) {
    requireOnline(
      command && typeof command === 'object' && !Array.isArray(command),
      '操作内容が不正です',
    );
    return this.store.transaction(async (bundle) => {
      requireOnline(
        isLiveSession(bundle.sessions, userId, sessionId),
        '別の端末でログインしました（ブラウザ・アプリはそれぞれ1台まで）。この端末からの操作はできません',
        409,
        'session',
      );
      requireOnline(
        typeof command.requestId === 'string' &&
          /^[a-zA-Z0-9:-]{8,100}$/.test(command.requestId),
        '操作IDが不正です',
      );
      const key = `${userId}:${command.requestId}`;
      const hash = digest(command);
      if (bundle.receipts[key]) {
        requireOnline(
          bundle.receipts[key].hash === hash,
          '操作IDの使い回しはできません',
          409,
        );
        return { unchanged: true, value: bundle.receipts[key].value };
      }
      // ⚠ **全データのリセットも版の照合を飛ばす**。壊れて読めなくなった
      //    リーグを捨てるための操作なので、版が合うことを前提にできない。
      //    消したあとは `create` からやり直す（revision は0に戻る）。
      // ⚠ **移行より先に置くこと**。移行できない形（作り直すしかない版）だと
      //    移行が例外を投げ、捨てるための操作まで届かなかった
      if (command.type === 'reset') {
        requireOnline(
          userId === this.adminId,
          '全データのリセットは管理者専用です',
          403,
        );
        // ⚠ **「リーグが無い」を先に見ること**。`canStep(null)` は false なので、
        //    順を逆にすると、消したあとの2回目が「検証モードが入っていません」に
        //    なって、何が起きているのか分からない
        const l = bundle.league;
        requireOnline(l, 'リーグがまだありません', 409);
        // ⚠ 検証モードの間だけ。遊んでいるリーグで押せると、全員の成績が
        //    管理者の一押しで消える
        requireOnline(this.canStep(l), '検証モードが入っていません', 403);
        bundle.league = null;
        // ⚠ バックアップも消すこと。残すと「リセットしたのに復元できる」状態
        //    になり、何が正本か分からなくなる
        delete bundle.backup;
        return { value: { ok: true, reset: true } };
      }
      // ⚠ **版の照合より先に移行する**。古い形のままでは他の命令が通らず、
      //    「更新したらリーグが読めなくなった」が起きる。どの命令で入っても
      //    ここを通るので、誰かが何か操作すれば自然に直る。
      const migrated = this.ensureMigrated(bundle);
      const l = bundle.league;
      // ⚠ 取り込みだけは**版の照合を飛ばす**。古い形の画面は revision を
      //    持っていないので、照合すると取り込みボタンが押せない
      if (command.type === 'migrate') {
        requireOnline(l, 'リーグがまだありません', 409);
        return {
          ...(migrated.changed ? {} : { unchanged: true }),
          value: { ok: true, applied: migrated.applied },
        };
      }
      requireOnline(
        l ? command.revision === l.revision : command.revision === 0,
        '他の操作で更新されました。最新状態を読み直してください',
        409,
        'revision',
      );
      const now = this.clock();
      const previousStatus = l?.status;
      // 任せ方の変更で手続きが進んだか（進んだら記録の索引を作り直す。下の archiveUnchanged）
      let settledByModes = false;
      if (command.type === 'create') {
        requireOnline(
          userId === this.adminId && !l,
          'リーグを作成できません',
          403,
        );
        bundle.league = await this.engine((engine) =>
          // ⚠ 作成時の参加者は**管理者1人**。以降はログインした人が空き球団に入る
          engine.createLeague({
            members: this.members.length
              ? this.members
              : [{ userId: this.adminId, label: '管理者' }],
            now,
            // ⚠ **作るたびに違う世界にする**（いしだ要望: 土地と愛称の幅）。
            //    種を既定値のままにすると、どのリーグも同じ12球団になり、
            //    名前の候補を増やしても出てくる顔ぶれが変わらない
            seed: engine.worldSeedFromTime(now),
          }),
        );
      } else if (command.type === 'join') {
        // ⚠ **参加者チェックより前に置くこと**。参加する人はまだ参加者ではない
        requireOnline(l, 'リーグがまだありません', 409);
        assertLeagueVersion(l);
        applyJoin(l, {
          userId,
          teamName: command.payload?.teamName,
          now,
        });
        l.revision++; // ⚠ 上と同じ理由
      } else {
        requireOnline(
          l?.members.some((m) => m.userId === userId),
          '参加者ではありません',
          403,
        );
        // 最後に来た時刻。⚠ **命令の前に**おるすばんを解く（来た人の操作を、留守の扱いのまま通さない）
        touchPresence(l, userId, now);
        // ⚠ 指導者の命令（任せ方・人事）も版を見る。移行前のリーグには指導者がいない
        if (['submit', 'lineup', 'step', 'resume', 'staffModes', 'staff'].includes(command.type))
          assertLeagueVersion(l);
        if (['submit', 'lineup'].includes(command.type))
          requireOnline(
            command.payload &&
              typeof command.payload === 'object' &&
              !Array.isArray(command.payload),
            '提出内容が不正です',
          );
        if (command.type === 'submit') {
          requireOnline(
            Object.hasOwn(command.payload, 'baseSubmission'),
            '画面を再読み込みしてから提出してください',
            400,
            'edit_base',
          );
          const submitted = l.phase?.submissions?.[userId] || null;
          requireOnline(
            isDeepStrictEqual(
              JSON.parse(JSON.stringify(submitted)),
              command.payload.baseSubmission,
            ),
            '保存済みの提出が更新されています。最新の提出を読み直してください',
            409,
            'edit_conflict',
          );
          await this.engine((engine) =>
            engine.submitPhase(l, userId, command.payload, now),
          );
        } else if (command.type === 'lineup') {
          requireOnline(
            command.payload.baseLineup &&
              typeof command.payload.baseLineup === 'object',
            '画面を再読み込みしてから編成を保存してください',
            400,
            'edit_base',
          );
          const member = l.members.find((m) => m.userId === userId);
          const currentLineup = JSON.parse(
            JSON.stringify(projectLineup(l.game.teams[member.teamName])),
          );
          requireOnline(
            isDeepStrictEqual(currentLineup, command.payload.baseLineup),
            // ⚠ 取り消しのボタンは画面ごとに名前が違う（PCの各ページとスマホの「打順」は
            //    「変更を取り消す」、スマホの投手起用（全画面の編成）は閉じて開き直す）。
            //    どの画面から保存しても分かる案内にする
            '編成がほかの画面で更新されています。PCの各ページとスマホの「打順」は「変更を取り消す」、スマホの投手起用（全画面）は閉じて開き直して、最新の編成から編集し直してください',
            409,
            'edit_conflict',
          );
          saveLineup(l, userId, command.payload);
        } else if (command.type === 'pause') {
          requireOnline(
            userId === this.adminId && l.status === 'running',
            '進行中に管理者が停止してください',
            403,
          );
          l.status = 'paused';
          l.nextAdvanceAt = null;
        } else if (command.type === 'resume') {
          requireOnline(
            userId === this.adminId && ['paused', 'error'].includes(l.status),
            '再開できません',
            403,
          );
          l.status = l.phase ? 'waiting' : 'running';
          l.nextAdvanceAt = l.phase ? null : nextProgressionAt(now);
          delete l.error;
        } else if (command.type === 'backup') {
          requireOnline(
            userId === this.adminId && l.status !== 'running',
            '進行を停止してからバックアップしてください',
            403,
          );
          bundle.backup = packBackup(l, now);
        } else if (command.type === 'restore') {
          requireOnline(
            userId === this.adminId &&
              ['paused', 'error'].includes(l.status) &&
              bundle.backup,
            '停止中に保存済みバックアップを復元できます',
            409,
          );
          const revision = l.revision;
          // ⚠ **古い版で取ったバックアップは移行してから戻す**。版を上げたあとに
          //    復元すると、以前は「バージョンが対応していません」で必ず失敗した。
          //    直せない版（作り直すしかない形）は従来どおり断る。
          const restored = unpackBackup(bundle.backup);
          if (restored && !isCurrent(restored))
            migrateLeague(restored, { now: this.clock() });
          assertLeagueVersion(restored);
          bundle.league = restored;
          bundle.league.revision = revision;
          bundle.league.status = bundle.league.phase ? 'waiting' : 'paused';
          bundle.league.nextAdvanceAt = null;
          // 復元前の操作を再実行させない。過去のログイン権限を復活させない。
        } else if (command.type === 'profile') {
          // ⚠ 参加のときしか名前を付けられず、管理者には機会すら無かった
          applyProfile(l, {
            userId,
            teamName: command.payload?.teamName,
            playerName: command.payload?.playerName,
            comment: command.payload?.comment,
            now,
          });
        } else if (command.type === 'staffModes') {
          // 分野ごとの任せ方（自分で / 意見を聞く / 任せる）。⚠ スタメン・投手起用を
          //    任せたときだけ世界を読んで編成を作り直す（`updateStaffModes`）
          // ⚠ 手続きを待っていた最後の1人が任せると、その場で手続きが進む（選手が動く）
          settledByModes = await this.engine((e) =>
            e.updateStaffModes(l, userId, command.payload?.modes, now),
          );
        } else if (command.type === 'staff') {
          // 指導者の解任・市場から呼ぶ・役職の入れ替え（キャンプの間だけ）
          await this.engine((e) => e.updateStaff(l, userId, command.payload || {}));
        } else if (command.type === 'tradeOffer') {
          // ⚠ **選手が動くのでエンジンの中で行う**。`TEAMS_DATA` を触るものは
          //    必ず `loadLeagueWorld` → 処理 → `captureLeagueWorld` の順で囲む
          await this.engine((e) => {
            e.loadLeagueWorld(l);
            e.openTrade(l, userId, command.payload || {}, now);
            l.game = e.captureLeagueWorld();
          });
        } else if (command.type === 'convert') {
          // ⚠ **選手の登録が変わるのでエンジンの中で行う**。`TEAMS_DATA` を
          //    触るものは `loadLeagueWorld` → 処理 → `captureLeagueWorld` の順で囲む
          await this.engine((e) => {
            e.loadLeagueWorld(l);
            e.convertPosition(l, userId, command.payload || {});
            l.game = e.captureLeagueWorld();
          });
        } else if (command.type === 'tradeRespond') {
          await this.engine((e) => {
            e.loadLeagueWorld(l);
            e.respondTrade(l, userId, command.payload || {}, now);
            l.game = e.captureLeagueWorld();
          });
        } else if (command.type === 'starterPick') {
          // 予告先発（改善案 B1）。世界は読まない（保存した世界の名簿で確かめる）
          setStarterPick(l, userId, command.payload || {});
        } else if (command.type === 'challenge') {
          // 練習試合の申し込み（改善案 B4）
          await this.engine((e) => e.openChallenge(l, userId, command.payload || {}, now));
        } else if (command.type === 'challengeRespond') {
          // ⚠ 受けるとその場で1試合する。**世界は保存し直さない**（写しで行う。`respondChallenge`）
          await this.engine((e) => e.respondChallenge(l, userId, command.payload || {}, now));
        } else if (command.type === 'releaseMember') {
          // 来なくなった人の球団をCPUに戻す（改善案 A3）。管理者だけ
          requireOnline(userId === this.adminId, '球団をCPUに戻せるのは管理者だけです', 403);
          assertLeagueVersion(l);
          await this.engine((e) =>
            e.releaseMember(l, this.adminId, command.payload?.userId, now),
          );
        } else if (command.type === 'campRound') {
          // ⚠ **キャンプは1クールずつ自分で実行する**（一人用と同じ）。
          //    伸びた能力を見てから次のクールを決められるようにするため、
          //    締め切りを待たずにその場で反映する。
          requireOnline(l.phase?.kind === 'camp', 'キャンプ中ではありません', 409);
          const me = l.members.find((m) => m.userId === userId);
          // ⚠ 参加していない人（管理者だけの人）は球団が無い。見ないと
          //    `me.teamName` で落ち、理由の分からない500になる
          requireOnline(me, '参加者ではありません', 403);
          l.phase.camp = l.phase.camp || {};
          const state = (l.phase.camp[userId] = l.phase.camp[userId] || {
            rounds: 0,
          });
          const engine = await import('./leagueEngine.mjs');
          requireOnline(
            state.rounds < engine.CAMP_ROUNDS,
            'キャンプは終わっています',
            409,
          );
          // ⚠ **同じクールを2回走らせないこと**。押し直しや再送で成長が二重に
          //    積まれる。クール番号を送らせて、次の1つだけを受け付ける
          requireOnline(
            Number(command.payload?.round) === state.rounds + 1,
            '別のクールが進行中です。最新状態を読み直してください',
            409,
          );
          const plan = engine.validateCampRound(l, me.teamName, command.payload);
          // ⚠ キャンプを指導者に任せていたのに自分で回したら、キャンプは「意見を聞く」に戻す
          //    （任せたままだと、締め切りで残りのクールが指導者の方針に変わる）
          engine.takeBackCamp(l, me);
          let result = null;
          await this.engine((e) => {
            e.loadLeagueWorld(l);
            // ⚠ 経験値の消費は**最後のクールで1回だけ**（覚醒率を均すため）
            result = e.runCampRound(l, me.teamName, plan, {
              lastRound: Number(command.payload?.round) >= engine.CAMP_ROUNDS,
            });
            l.game = e.captureLeagueWorld();
          });
          engine.recordCampRound(state, result);
          state.plan = plan;
          // ⚠ 4クール終わったら**提出する**。全員が終われば締め切りを待たずに
          //    次へ進む（手続きの仕組みをそのまま使う）。
          // ⚠ **印（`submissions[...].ready`）を直に立てないこと**。手続きを
          //    解決するのは `submitPhase` の中（最後の1人が決定した瞬間）で、
          //    印だけ立てても誰も解決しない。実測で、4クール終えてもキャンプが
          //    終わらず、日付が1月1日のまま止まっていた。
          if (state.rounds >= engine.CAMP_ROUNDS)
            await this.engine((e) =>
              e.submitPhase(
                l,
                userId,
                {
                  phaseId: l.phase.id,
                  plan: {
                    menu: 'standard',
                    assignments: plan.main,
                    subAssignments: plan.sub,
                    policy: plan.policy,
                    players: plan.players,
                  },
                  ready: true,
                },
                now,
              ),
            );
        } else if (command.type === 'pack') {
          // ⚠ **途中参加した人だけの選択**。リーグ全体の手続き（`submit`）とは別。
          //    選んだセットは次のキャンプで名簿に入る。
          const me = l.members.find((m) => m.userId === userId);
          requireOnline(
            me?.packSeed,
            '初期メンバーを選ぶ段階ではありません',
            409,
          );
          const ids = new Set(
            (await this.engine((engine) => engine.packIdsFor(me))) || [],
          );
          requireOnline(
            typeof command.payload?.packId === 'string' &&
              ids.has(command.payload.packId),
            '初期メンバーの選択が不正です',
          );
          me.pendingPackId = command.payload.packId;
        } else if (command.type === 'testmode') {
          // ⚠ 切り替えは管理者だけ。ONの間は管理者が好きな時に進められるので、
          //    遊び始めたらOFFに戻すこと
          requireOnline(
            userId === this.adminId,
            '検証モードの切り替えは管理者専用です',
            403,
          );
          l.testMode = command.payload?.on === true;
        } else if (command.type === 'resolve') {
          // ⚠ 手続きを**いま**締め切る。未提出の人には標準案を当てる。
          //    時間を待たずに試せるようにするためで、検証モード中だけ。
          requireOnline(this.canStep(l), '検証モードが入っていません', 403);
          requireOnline(
            userId === this.adminId,
            '検証用の進行操作は管理者専用です',
            403,
          );
          requireOnline(l.phase, '決定待ちの手続きはありません', 409);
          await this.engine((engine) => engine.resolvePhaseNow(l, now));
        } else if (command.type === 'step') {
          requireOnline(this.canStep(l), '検証モードが入っていません', 403);
          requireOnline(
            userId === this.adminId,
            '検証用の進行操作は管理者専用です',
            403,
          );
          requireOnline(l.status === 'running', '試合の期間ではありません', 409);
          // ⚠ 1ターン＝1時間＝1試合日。まとめて進めるときも**1日ずつ繰り返す**。
          //    日付を飛ばすと、間の日の試合・疲労回復・コンディション更新が落ちる
          const turns = Math.max(1, Math.min(24, Number(command.payload?.turns) || 1));
          for (let i = 0; i < turns; i += 1) {
            if (l.status !== 'running') break;
            await this.engine((engine) =>
              engine.advanceLeagueDay(l, `step:${command.requestId}:${i}`, now),
            );
          }
        } else requireOnline(false, '未対応の操作です');
        bundle.league.revision++;
      }
      const completedAt = this.clock();
      // ⚠ 手続きの解決で開幕したときは、エンジンが決めた時刻（キャンプ後は
      //    月曜0時の `seasonStartAt`）が**まだ先なら上書きしない**。以前は無条件に
      //    完了時刻の次の正時へ書き換えていたため、全員が早くキャンプを決めると
      //    火曜開幕になり、締め切りでの自動決定（月曜開幕）と食い違っていた。
      //    処理の間に枠を過ぎてしまったとき（`online-clock-check`）だけ、
      //    完了時刻から数え直す。
      if (
        bundle.league.status === 'running' &&
        (command.type === 'step' ||
          (previousStatus !== 'running' &&
            !(bundle.league.nextAdvanceAt > completedAt)))
      )
        bundle.league.nextAdvanceAt = nextProgressionAt(completedAt);
      bundle.league.updatedAt = completedAt;
      const value = { ok: true, revision: bundle.league.revision };
      bundle.receipts[key] = { hash, value };
      const keys = Object.keys(bundle.receipts);
      for (const old of keys.slice(0, Math.max(0, keys.length - 256)))
        delete bundle.receipts[old];
      // ⚠ **返事に自分の最新の画面（ビュー）を載せる**。以前は画面が保存のあとに
      //    view を読み直しており、認証と読み込みの往復が1回余計にかかっていた。
      //    控え（receipts）には入れないこと。リーグの保存一式が参加者の画面ぶん膨らむ。
      //    控えから返す二重送信のときはビューが無いので、画面は従来どおり読み直す。
      // ⚠ 作れなかったら載せないだけにする（例外を投げると、済んだ保存まで取り消される）
      let view = null;
      try {
        view = projectLeague(bundle, userId, sessionId, this.adminId);
      } catch (error) {
        console.error('online: 返事のビューを作れませんでした:', error.message);
      }
      return {
        value: view ? { ...value, view } : value,
        // ⚠ 編成の保存は記録の索引（選手・球団・試合の記録）に関わらない。索引の作り直し
        //    （全試合をなめる）を省くよう保存側に伝える。選手の能力や名簿を変える命令には付けないこと
        //    （`online-service-check` で、保存の前後で索引が同じことを確かめている）
        // ⚠ 任せ方（`staffModes`）も同じ。任せた編成を作り直しても、索引の選手・球団は変わらない
        //    （`online-coach-check` で確かめている）。人事（`staff`）は球団の指導者の欄が変わるので作り直す
        // ⚠ ただし**任せ方の変更で手続きが進んだときは作り直す**（トライアウト・退団・キャンプで
        //    選手と能力が動く。`updateStaffModes`）
        // ⚠ 予告先発・練習試合の申し込みと返事・ひとことも索引に関わらない（選手も能力も動かない。
        //    練習試合は写しで行い、世界を保存し直さない）
        ...(command.type === 'lineup' ||
        (command.type === 'staffModes' && !settledByModes) ||
        ['starterPick', 'challenge', 'challengeRespond'].includes(command.type)
          ? { archiveUnchanged: true }
          : {}),
      };
    }, { full: FULL_COMMANDS.has(command?.type) });
  }
  engine(fn) {
    const result = engineQueue.then(async () =>
      fn(await import('./leagueEngine.mjs')),
    );
    engineQueue = result.catch(() => {});
    return result;
  }
  async defaults(userId, sessionId) {
    // ⚠ **まず芯だけで作る**（`readLight`。世界・記録は読まない）。標準案はリーグの球団と手続きの
    //    候補しか見ないので、たいていはそれで足りる。世界に触れたら全体を読んでやり直す
    //    （以前は毎回世界まるごとを読み、手続きの画面を開くたびに数秒待った）
    if (this.store.readLight) {
      const light = await this.store.readLight();
      try {
        const result = await this.defaultsFrom(light.bundle, userId, sessionId);
        if (!light.touched()) return result;
      } catch (error) {
        if (!light.touched()) throw error;
      }
    }
    return this.defaultsFrom(await this.store.read(), userId, sessionId);
  }
  async defaultsFrom(bundle, userId, sessionId) {
    // 候補一覧に対する純粋な提案。エンジンの共有世界には書き込まない。
    const member = bundle.league?.members.find((m) => m.userId === userId);
    requireOnline(
      member && bundle.league.phase,
      '決定待ちイベントがありません',
      409,
    );
    requireOnline(
      isLiveSession(bundle.sessions, userId, sessionId),
      'ログインし直してください',
      409,
      'session',
    );
    assertLeagueVersion(bundle.league);
    return this.engine((engine) => ({
      phaseId: bundle.league.phase.id,
      revision: bundle.league.revision,
      plan: engine.defaultPhasePlan(bundle.league, member.teamName),
    }));
  }
  async tick() {
    if (this.store.isDue && !(await this.store.isDue(this.clock())))
      return { advanced: false };
    return this.store.transaction(async (bundle) => {
      // ⚠ **定期処理でも移行する**。誰も操作しなくても、5分以内（cron の刻み）に自然に直る。
      //    直せない形（作り直すしかない版）なら止めるだけにして、
      //    定期処理そのものを例外で落とさない
      let migrated = { applied: [], changed: false };
      try {
        migrated = this.ensureMigrated(bundle);
      } catch (error) {
        console.error('online migrate failed:', error.message);
        return { unchanged: true, value: { advanced: false } };
      }
      const l = bundle.league;
      const now = this.clock();
      // ⚠ **締め切り超過の手続きを先に片付ける**。手続き中は status が
      //    running でないので、下の判定だけだと永遠に動かない。
      // ⚠ 自動決定に失敗して止めた後（status が error）は、管理者が再開するまで
      //    やり直さない。毎時同じ失敗を繰り返して記録を埋めないため。
      if (l?.phase?.deadline && l.phase.deadline <= now && l.status !== 'error') {
        const working = clone(l);
        try {
          const resolved = await this.engine((engine) =>
            engine.autoResolvePhase(working, now),
          );
          bundle.league = working;
          bundle.league.revision++;
          bundle.league.updatedAt = this.clock();
          if (bundle.league.status === 'running' && !bundle.league.nextAdvanceAt)
            bundle.league.nextAdvanceAt = nextProgressionAt(bundle.league.updatedAt);
          return { value: { advanced: true, autoResolved: resolved } };
        } catch (error) {
          // ⚠ **黙って握りつぶさない**。以前はログに出すだけで保存を変えず、
          //    画面は「締め切り済み」のまま何も起きない状態が続いた
          //    （誰も原因に気づけない）。止めて理由を画面に出す。
          //    管理者が「再開」すると待機に戻り、次の定期処理でやり直す。
          console.error('online auto resolve failed:', error.stack);
          l.status = 'error';
          l.nextAdvanceAt = null;
          l.error = `締め切りの自動決定に失敗しました（${error.message}）。提出内容を確認して管理者が再開してください`;
          l.revision++;
          l.updatedAt = this.clock();
          return { value: { advanced: false, autoResolveFailed: true } };
        }
      }
      if (
        !l ||
        l.status !== 'running' ||
        !l.nextAdvanceAt ||
        l.nextAdvanceAt > now
      )
        // ⚠ 移行したのに `unchanged` で返すと、直した形が保存されず
        //    毎回やり直しになる（画面は古いままに見える）
        return migrated.changed
          ? { value: { advanced: false, migrated: migrated.applied } }
          : { unchanged: true, value: { advanced: false } };
      const due = l.nextAdvanceAt;
      // ⚠ **遅れただけで止めないこと**。1回の進行で進むのはいつも1ターンなので、
      //    遅れても取り戻しの連打は起きない（`advanceLeagueDay`）。
      //    かつて「15分以上遅れたら停止」にしていたが、これは1ターン＝1時間の
      //    頃の値で、45分ターンにしたとき**毎時のcronだと必ず15分超の遅れになり、
      //    1ターン進んだ次の時間に必ず止まっていた**（実測）。
      //    枠を外すのが設定の間違いか本当の障害かは、遅れの大きさで分ける:
      //      1ターンぶんまで  … そのまま進める（毎回の揺らぎ）
      //      数時間まで        … 進める。取りこぼした枠は捨てて次の枠から
      //      それ以上          … 止めて管理者に見てもらう（本当の障害）
      const late = Date.parse(now) - Date.parse(due);
      if (late > STALL_AFTER_MS) {
        l.status = 'error';
        l.nextAdvanceAt = null;
        l.error =
          '定期進行が長く止まっていました。状態を確認して管理者が再開してください';
      } else {
        const working = clone(l);
        try {
          await this.engine((engine) =>
            engine.advanceLeagueDay(working, due, now),
          );
          bundle.league = working;
        } catch (error) {
          l.status = 'error';
          l.nextAdvanceAt = null;
          l.error = '日次処理に失敗しました。管理者が状態を確認してください';
          console.error('online tick failed:', error.stack);
        }
      }
      bundle.league.revision++;
      const completedAt = this.clock();
      if (bundle.league.status === 'running')
        bundle.league.nextAdvanceAt = nextProgressionAt(completedAt);
      bundle.league.updatedAt = completedAt;
      return {
        value: {
          advanced:
            bundle.league.status === 'running' ||
            bundle.league.status === 'waiting',
          revision: bundle.league.revision,
        },
      };
    }, { full: true });
  }
}
