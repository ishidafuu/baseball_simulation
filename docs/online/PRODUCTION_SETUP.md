# 本番環境の構成と、構築でつまずいた点

`README.md` は**手順の一般形**を書いている。こちらは**実際に作った本番環境の固有情報**と、
**作業中に実際に詰まった箇所**を残す。次に環境を作り直すとき、または別の作品を同じ形で
公開するときに読み返すためのもの。

⚠ **秘密値・メールアドレス・UUID はここに書かない。** このリポジトリは公開されている。
値が必要なときは、下記の「どこを見れば分かるか」に従って管理画面から取る。

## 環境は2つある。取り違えないこと

| | URL | 所有者 | 役割 |
|---|---|---|---|
| **本番** | `https://baseball-simulation-neon.vercel.app` | 作者 | こちらを育てる |
| 試作 | `https://baseballsimulation.vercel.app` | 友人 | 先に作られたもの。触らない |

⚠ **名前がよく似ている。`neon` が付くほうが本番。**
実際に、試作環境へログインして「本番が動いた」と誤認し、
「ユーザーが0人なのにログインできる」という矛盾の追跡に時間を使った。
**ログイン前にアドレスバーを確認すること。**

⚠ Vercel が各デプロイに割り当てる長いURL（`...-ice-north.vercel.app`）は使い捨て。
**利用者に配るのは固定URLのほう**。デプロイのたびに変わるURLを配ると次回から届かなくなる。

## 構成

| 項目 | 値 | どこで確認するか |
|---|---|---|
| Supabase プロジェクト | `nextstage-online` | ダッシュボード左上 |
| リージョン | `ap-northeast-1`（東京） | Project Settings → General |
| Vercel プロジェクト | `baseball-simulation` | Vercel ダッシュボード |
| プラン | Hobby（無料） | Vercel 左上 |
| Production ブランチ | `main` | Vercel → Settings → Git |
| API キーの形式 | **Legacy**（`eyJ…`） | Project Settings → API Keys |

⚠ **Supabase のリージョンは後から変更できない。** 間違えたら作り直すしかない。
空のうちなら作り直しは3分で済む。データが入ってからだと退避と復元の手間がかかる。

## 参加者と球団

参加すると、最下層（2部）の空いているCPU球団のうち**成績が一番低い球団**を引き継ぐ。
球団そのものは選べない（名前は付けられる）。

⚠ **四国4球団・2人固定は廃止した。** いまは**2部制12球団**（1部6・2部6）で、参加者は1〜12人。
詳細は [PYRAMID_LEAGUE.md](PYRAMID_LEAGUE.md)。

- 管理者は `ONLINE_ADMIN` で決める。リーグ作成・停止・再開ができる
- 参加者は**ログインした人が空き球団に入る**だけで増える。環境変数をいじる必要は無い
- 参加者は**最下層（2部）から**割り当たる。途中参加ではCPUの最下位が弾かれる
- 昇降格は「1部の最下位が降格・2部の1位が昇格」
- 観戦リプレイは既定で「人の球団の試合だけ・球団ごとに直近10試合」を残す（容量）。`ONLINE_RECORD_REPLAY=1` で全試合、`0` で残さない
- 球団名は参加者が自分で付ける

## 環境変数（名前だけ。値は Vercel の管理画面にある）

Vercel → Settings → Environment Variables に6つ。`.env.example` と対応する。

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ONLINE_ADMIN            ← 管理者のUUID。参加者はここに書かない
ONLINE_CRON_SECRET
ONLINE_ALLOW_STEP       ← 任意。検証用の「1時間進める」を出す（1 で有効）
```

⚠ **`ONLINE_MEMBER_1` / `ONLINE_MEMBER_2` は廃止した。** 参加者はリーグのデータ側で
管理する。アカウントを作れるのは管理者だけ（公開サインアップは無効）なので、
入口はそこで絞れている。環境変数に残っていても無視される。

- ⚠ **`VITE_` を付けない。** 付けるとブラウザに配られるコードへ埋め込まれ、全員に見える。
- `ONLINE_ADMIN` と `ONLINE_ALLOW_STEP` は **Config** 型にしておくと後から読み返せる。
  UUIDは鍵ではない。
- 残り4つは **Secret** 型。保存すると二度と読めない。
- ⚠ **`ONLINE_CRON_SECRET` は Supabase Vault にも同じ値を入れる。**
  Secret で保存すると読み返せないので、**Vault への登録を済ませるまで手元に控えておく**。

## 公開サインアップを無効にする（必須）

⚠ **参加の入口はここだけで絞っている。** 招待コードを廃止したので、Supabase に
ログインできる人は誰でも空き球団に入れる。Supabase は**新規プロジェクトの既定が
「サインアップ有効」**なので、切り忘れると、URLを知った誰でもアカウントを作って参加できる。

1. Supabase → Authentication → Sign In / Providers を開く
2. 「Allow new users to sign up」をオフにして保存する
3. 参加者のアカウントは Authentication → Users → Add user で管理者が作る

確認方法（オフになっていれば、登録が断られる）：

```
curl -s -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"signup-test@example.com","password":"test-password-123"}'
# → "Signups not allowed for this instance" のような拒否が返ればよい。
#   ユーザーが作られてしまったら、すぐ Users から削除して設定を見直す
```

## Vault（Supabase → Project Settings → Vault → Secrets）

```
online_tick_url      本番の固定URL + /api/online?action=tick
online_cron_secret   Vercel の ONLINE_CRON_SECRET と同じ値
```

⚠ 名前は一字一句この通り。Cron の SQL がこの名前で値を引く。

## 自動進行（Cron）

`supabase/cron.example.sql` を適用する。前提として `pg_cron` と `pg_net` を
Database → Extensions で有効にしておく。

**毎正時に1ターン**（1ターン＝1時間＝1試合日）。登録は1本。

```
online-turn    0,5,10 * * * *
```

毎時なので UTC と JST のずれは効かない。

分の指定が `0,5,10` となっているのは、**通知の取りこぼしに備えた再送**。
3回届いても進行は1回に限定される（`nextAdvanceAt` で制御）。

登録の確認:

```sql
select jobname, schedule, active from cron.job;
```

⚠ `cron.job_run_details` の成功は **SQLが走ったこと**しか示さない。
HTTP が通ったか、ゲームが実際に進んだかは `net._http_response` と
ゲーム画面の日付・revision で確かめる。

## ⚠ 構築で実際に詰まった点（ここが本題）

### 1. 環境変数は「保存しただけ」では反映されない

登録後に**新しいデプロイを作らないと、サーバーからは見えない**。
Deployments → 最新行の「⋯」→ Redeploy。
これを知らずに、設定済みなのに「未設定」と言われ続けて時間を使った。

**6つまとめて登録してから、最後に1回再デプロイすればよい。**

### 2. UUID はプロジェクトごとに違う

友人の環境で使っていたUUIDは、新しいプロジェクトでは通用しない。
**Auth ユーザーを作った瞬間にUUIDが発行される**ので、
「先にユーザーを作る → UUIDを控える → 環境変数に入れる」の順でないと進めない。

### 3. 「Auto Confirm User」を忘れるとログインできない

Authentication → Users → Add user のときのトグル。
オフだとメール未確認扱いになり、ログインが弾かれる。
確認メールは送られない作りなので、自分でオンにするしかない。

### 4. ログイン失敗の理由は画面に出ない

サーバーは `認証に失敗しました` で固定して返す（攻撃者に情報を与えないため）。
原因の切り分けは **Supabase の Authentication → Users** を見て行う。
メールアドレスの誤り・未確認・ユーザー不在のどれかを目視で判断する。

### 5. 設定不備の切り分けは `?action=config` で行う

```
https://＜本番URL＞/api/online?action=config
```

- `{"local":false}` … 6つとも読めている
- `{"error":"…","code":"config","missing":[…]}` … 足りない変数の**名前**が返る

⚠ この `missing` は後から足した仕組み（PR #6）。
以前はどの変数が欠けても同じ503文面だったため、原因を切り分けられなかった。
**値は返さない**ので、結果をそのまま人に見せても安全。

### 6. Supabase ダッシュボードの「ユーザー0人」を信じる前に

プロジェクトを取り違えている可能性を先に疑う。アドレスバーの
`/dashboard/project/＜ref＞/` を確認する。UIを信じずSQLで数えるのも早い。

```sql
select
  (select count(*) from auth.users)                                 as 認証ユーザー数,
  (select generation from public.online_control where id='pennant') as 世代;
```

## 適用済みのデータベース設定の確認

```sql
select
  (select count(*) from public.online_control where id = 'pennant')            as 制御行,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('online_claim','online_publish','online_release'))    as 関数の数,
  (select b.public from storage.buckets b where b.id = 'online-world')         as バケットが公開,
  (select relrowsecurity from pg_class where oid = 'public.online_control'::regclass) as RLS有効;
```

期待値: `1` / `3` / `false` / `true`。
**`バケットが公開 = false` と `RLS有効 = true` が安全性の要**。
ブラウザに配られる鍵でデータを直接読まれないことを、この2つで担保している。

この構成では `src/` 配下に Supabase への参照が**1件も無い**。
ブラウザは `/api/online` としか話さず、鍵はサーバー（Vercel の関数）の中だけで使われる。

## 停止・再開・バックアップ・復元

停止と再開は**管理者がゲーム内の「管理」画面から**行う。

手元への退避と復元は、作者のPCで実行する。`.env` に本番の値を書いて使う。

```sh
node --env-file=.env tools/online-backup.mjs export  /安全な保存先/world.json.gz
node --env-file=.env tools/online-backup.mjs restore /安全な保存先/world.json.gz
```

- ⚠ **退避も復元も、先に進行を停止する必要がある**（動作中は拒否される）。
- ⚠ 退避ファイルには参加者情報が入る。**Gitや公開先に置かない。**
- ⚠ **復元は参加者UUIDが一致しないと拒否される**（`バックアップの参加者が異なります`）。
  別環境のデータを持ち込むには、ファイル内のUUIDを書き換える必要がある。
- ⚠ `.env` には `service_role` キーが入る。作業後は扱いに注意する。

## 更新したときの3つの場合

| 更新の種類 | 画面に出ること | やること |
|---|---|---|
| 画面・処理だけの変更 | 何も起きない | なし（Vercel が自動で入れ替える） |
| 環境変数が増える・名前が変わる | 「オンライン環境の初期設定が必要です」 | Vercel に足して **Redeploy**。データは無事 |
| 保存の形が変わる（`ONLINE_SCHEMA` を上げた） | 「ゲームの更新を取り込みます」 | 管理者が**取り込む**。移行できない形なら作り直し |

⚠ **環境変数は保存しただけでは反映されない。** 必ず Redeploy する。

### 保存の形が変わったとき

`src/online/leagueMigration.js` の `MIGRATIONS` に段があれば、**作り直さずに済む**。

- 管理者がログインすると「更新を取り込む」が出る。押せばその場で直る
- 押さなくても、**次の正時の定期処理**で取り込まれる
- 取り込めない形式なら、押したときに理由が出る（その場合だけ下の作り直し）

⚠ **移行できるのは「項目を足すだけ」の変更**。既存の項目の意味を変えると、
古い値から新しい値を作れないので段が書けない。形を変えるときは足す方向で設計する。

⚠ `ONLINE_SCHEMA` を上げたら、**同じコミットで段を1つ足すこと**。
`online-migration-check` が「手順の終わりが `ONLINE_SCHEMA` と一致すること」を
見ているので、足し忘れるとハーネスが落ちる。

## リーグを作り直す（移行できない形のとき）

移行できない版（いまは版1＝固定4球団・2人）は、作り直すしかない。
**自動では作り直らない。**
`create` は既存リーグがあると拒むので、制御行を空にしてから作り直す。

⚠ **実行すると、これまでの試合も成績も戻らない。** 残したいときは先に
上の `export` で退避する（ただし古い形の退避は新しいコードでは復元できない）。
⚠ **対象のプロジェクトが本番用か、実行前に必ず確認すること。**

Supabase の SQL Editor で:

```sql
update public.online_control
   set snapshot_path = null,
       previous_paths = '{}',
       views          = '{}'::jsonb,
       generation     = generation + 1
 where id = 'pennant';
```

その後、**管理者のアカウントで**ログインすると「リーグを作成」が出る。
作成したら、参加者に本番のURLを伝えるだけでよい。ログインすると
「リーグに参加する」画面が出て、空き球団のうち下の階層で一番弱いものを引き継ぐ。

⚠ 人を増やすには **Supabase の Authentication でアカウントを作る**。
そこが唯一の入口なので、アカウントを渡した相手だけが参加できる。

バケットに残った古い `snapshots/` と `archives/` は参照されないが、
容量を使うので Storage の画面から消してよい。

## この形は他の作品にも使い回せる

骨格は作品に依存しない。

| 毎回同じ | 毎回考え直す |
|---|---|
| GitHub → Vercel の自動公開 | テーブル設計 |
| Supabase の Auth / DB / Storage | 誰が何を読めるかの権限（RLS） |
| pg_cron + pg_net + Vault での定期実行 | 無料枠に収まるかの見積もり |
| 秘密値を Vercel の環境変数に置く形 | |

「定期実行で外部から値を取り、DBに貯め、画面で見せる」種類のものは、
Cron の呼び先が変わるだけで**同じ骨格にそのまま乗る**。
