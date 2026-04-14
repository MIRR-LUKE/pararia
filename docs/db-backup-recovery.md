# DB Backup / Recovery Runbook

最終更新: 2026-04-14

## 1. 目的

この runbook は、PARARIA の本番データを **二度と戻せない形で失わない** ための正本です。

守る対象は 2 系統あります。

1. **DB**
   - Supabase Postgres
   - 生徒、面談 session、conversation、report、delivery event、settings、audit
2. **runtime object**
   - Vercel Blob 上の音声 upload / live chunk / 生成過程の runtime object

重要なのは、**DB backup だけでは完全復旧できない** ことです。  
面談音声は Blob にあるため、DB dump だけ戻しても中身の再生成が詰まります。

## 2. 世界標準の運用方針

### 2.1 4 層防御

1. **Supabase PITR / managed backups**
2. **論理バックアップ (`pg_dump`)**
3. **Blob object backup**
4. **アプリ側 recoverability**

この repo では 4 をコードで担保しています。

- 生徒は hard delete しない
- `/api/students/[id]` の DELETE は archive に置き換えた
- archive 前 snapshot を `StudentArchiveSnapshot` に保存する
- restore 用の API / script を用意した

### 2.2 やってはいけないこと

- shared / prod DB に `prisma migrate dev` を打つ
- backup のない状態で destructive SQL を流す
- DB dump だけ取って Blob backup を取らない
- restore drill をしない
- UI の削除操作を hard delete のまま運用する

## 3. 現在の実装

### 3.1 archive

- 生徒一覧の destructive action は「削除」ではなく「アーカイブ」
- archive 時に関連データ snapshot を `StudentArchiveSnapshot` に保存する
- session / conversation / report / delivery event / profile / runtime path をまとめて保全する
- runtime 音声は消さない

### 3.2 backup scripts

DB:

```bash
npm run backup:db
```

- `pg_dump --format=custom`
- 実行端末には PostgreSQL client (`pg_dump`) が必要
- `pg_dump` が無い場合は Supabase CLI fallback を試せるが、Windows では Docker Desktop が必要
- 出力先: `.backups/db/<timestamp>/`
- 生成物:
  - `pararia.dump`
  - `metadata.json`

Blob:

```bash
npm run backup:blob
```

- 既定 prefix: `session-audio/`
- 出力先: `.backups/blob/<timestamp>/`
- 生成物:
  - `files/...`
  - `manifest.json`

manifest のみ:

```bash
npm run backup:blob -- --manifest-only
```

まとめて:

```bash
npm run backup:all
```

GitHub Actions:

- workflow: `.github/workflows/backup-runtime-and-db.yml`
- schedule: 6 時間ごと
- secret:
  - `SUPABASE_DB_URL`
  - `SUPABASE_PROJECT_REF`
  - `SUPABASE_ACCESS_TOKEN`
  - `BLOB_READ_WRITE_TOKEN` (Blob backup を含める場合)
- artifact:
  - DB dump: 14 日保持
  - Supabase backup status: 14 日保持
  - Blob backup: 14 日保持

手動実行の input:

- `blob_mode=manifest`
  - 軽い inventory だけ取る
- `blob_mode=full`
  - 指定 prefix の blob 本体まで artifact 化する

GitHub secrets 同期:

```bash
npm run backup:sync-github-secrets
```

ただし `gh` token に Actions secrets の write 権限が必要です。

## 3.2.1 Supabase 側の one-time 設定

repo 外で必ずやること:

1. `Settings > Add-ons` で **PITR** を有効化
2. restore 用の権限を持つ管理者を明確化
3. 月 1 回、sandbox project へ restore drill

現時点でこのマシンからは `SUPABASE_ACCESS_TOKEN` が見えていないため、
**Supabase dashboard の設定変更そのもの** はまだ実行していません。  
ただし、repo 側の backup 自動化と restore 導線は先に入れてあります。

### 3.3 restore scripts

archived student 一覧:

```bash
npm run students:archived
```

restore:

```bash
npm run restore:student -- --student-id <studentId>
```

## 4. 環境変数

### 4.1 DB

- `DATABASE_URL`
  - app 通常接続用
- `DIRECT_URL`
  - migration / backup / 直結系の優先候補
- `PARARIA_BACKUP_DATABASE_URL`
  - backup 専用に別接続先を明示したいときに使う

### 4.2 Blob

- `BLOB_READ_WRITE_TOKEN`
  - Blob backup の基本 token
- `PARARIA_BLOB_BACKUP_TOKEN`
  - backup 専用 token を分けたいときに使う
- `PARARIA_AUDIO_BLOB_ACCESS`
  - 通常は `private`
- `PARARIA_BLOB_BACKUP_ACCESS`
  - backup script 用に access を明示したいときに使う

## 5. 推奨運用 cadence

### 毎日

- `backup:db`
- `backup:blob`
- backup 成否を通知
- 退避先の容量監視

### 毎週

- dump を別 DB に restore
- blob backup から任意の音声を 1 本取り出して読めるか確認
- archived student を 1 件 restore して戻るか確認

### 毎月

- PITR の restore point から sandbox project を立てる
- backup retention とコストを見直す

## 6. 本番事故時の優先順位

### A. 直近の誤 archive / 誤操作

1. `npm run students:archived`
2. `npm run restore:student -- --student-id <id>`
3. 画面確認

### B. DB 破損 / 大量削除

1. まず write を止める
2. Supabase 側で PITR 可能範囲を確認
3. 新しい sandbox DB に restore
4. 直近 dump と整合比較
5. 本番へ切り戻し

### C. Blob 消失

1. 直近 blob backup の manifest を確認
2. 対象 object を backup から復元
3. session / conversation の再生成可否を確認

## 7. 公式ドキュメント

- Supabase Backups / PITR
  - https://supabase.com/docs/guides/platform/backups
- Supabase CLI `db dump`
  - https://supabase.com/docs/reference/cli/supabase-db-dump
- Vercel Blob SDK
  - https://vercel.com/docs/storage/vercel-blob
