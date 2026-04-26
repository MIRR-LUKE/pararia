# バックアップ・災害復旧証跡

最終更新: 2026-04-25

## 1. 目的

この文書は、PARARIA SaaS のバックアップ、復旧演習、災害復旧時の判断と証跡を定義します。実装手順の正本は `docs/db-backup-recovery.md` とし、本書は上場企業審査・内部統制・顧客監査で説明するための運用証跡を補完します。

関連文書:

- `docs/db-backup-recovery.md`
- `docs/production-slo-runbooks.md`
- `docs/release-governance.md`

## 2. 復旧対象

| 対象 | 正本 | backup | 復旧時の確認 |
| --- | --- | --- | --- |
| Supabase Postgres | 生徒、面談、conversation、report、delivery、settings、audit | Supabase PITR、`npm run backup:db`、GitHub Actions artifact | row count、主要 relation、audit trail |
| Vercel Blob | 音声 upload、live chunk、runtime object | `npm run backup:blob`、manifest/full export | manifest checksum、任意音声の取得 |
| Runpod worker image | STT runtime | GHCR `sha-...` tag、`Publish Runpod Worker Image` | image digest、runtime revision |
| 生成 artifact | 面談ログ、保護者帳票 | DB record、Blob runtime path、last good artifact | review state、生成元 transcript、model metadata |
| 設定・secret | Vercel env、GitHub secrets、Runpod env | 管理者権限で棚卸し、secret 名の証跡 | 値は保存せず存在と更新者だけ記録 |

DB dump だけでは音声・runtime object を復旧できないため、DB と Blob の両方を必須の復旧単位として扱います。

## 3. RPO / RTO

| シナリオ | RPO | RTO | 復旧方針 |
| --- | --- | --- | --- |
| 単一生徒の誤 archive | 0分を目標 | 30分以内 | `students:archived` と `restore:student` |
| 単一 conversation / report の破損 | last good artifact まで | 2時間以内 | review gate で再生成、破損 artifact は保持 |
| DB 論理破損 / 大量削除 | 6時間以内。PITR 有効時は PITR 粒度 | 4時間以内 | write stop、sandbox restore、本番切替 |
| Blob object 消失 | 24時間以内 | 8時間以内 | manifest から対象 object を復元 |
| Runpod image 不具合 | 直前安定 SHA | 1時間以内 | worker image rollback |
| リージョン障害 / provider 障害 | provider の復旧可能範囲 | 24時間以内 | 代替 project / provider への復旧判断 |

SEV-1 では RTO よりデータ完全性を優先します。復旧を急ぐために破損した DB へ上書きしません。

## 4. 定常バックアップ

### 4.1 自動

GitHub Actions `Backup Runtime And DB` を 6 時間ごとに実行します。

生成 artifact:

- `pararia-db-backup-<timestamp>`
- `pararia-supabase-status-<timestamp>`
- `pararia-blob-backup-<timestamp>`

保存期間は `docs/db-backup-recovery.md` の通り 14 日を基準にし、監査で必要な月次 drill report は別途長期保管します。

### 4.2 手動

```bash
npm run backup:status
npm run backup:db
npm run backup:blob
npm run backup:blob -- --manifest-only
npm run backup:all
```

backup 専用 DB URL は `PARARIA_BACKUP_DATABASE_URL` を最優先にします。Blob backup は `PARARIA_BLOB_BACKUP_TOKEN` を使い、runtime の `BLOB_READ_WRITE_TOKEN` と分けます。

### 4.3 secrets 同期

```bash
npm run backup:sync-github-secrets
```

値そのものを証跡に残してはいけません。残すのは secret 名、同期日時、実行者、対象 repository、成功/失敗です。

## 5. 復旧演習

### 5.1 CI drill

GitHub Actions `Backup Restore Drill` を月 1 回以上、かつ DB schema 変更を含む release 前に実行します。

ローカル確認:

```bash
npm run test:backup-restore-drill
```

合格条件:

- source DB から backup が作成される。
- target DB へ restore できる。
- seed 済みの主要データが復元後に検証できる。
- artifact がアップロードされ、run URL が記録される。

### 5.2 手動 drill

1. 本番とは別の sandbox DB / Blob 領域を用意する。
2. 最新 DB backup と Blob manifest を取得する。
3. DB restore を sandbox に実行する。
4. Blob backup から任意の音声を 1 本取り出し、manifest とサイズを照合する。
5. archived student を 1 件 restore し、session、conversation、report、delivery event が戻ることを確認する。
6. `npm run test:generation-preservation` と `npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md` を実行し、復旧後の生成導線が壊れていないことを確認する。

## 6. 災害復旧 Runbook

### 6.1 誤操作・単一生徒復旧

```bash
npm run students:archived
npm run restore:student -- --student-id <studentId>
```

確認項目:

- 対象生徒が active に戻っている。
- archive 前 snapshot が復元根拠として残っている。
- runtime 音声は削除されていない。
- 復旧理由、依頼者、承認者、実行者を記録する。

### 6.2 大量削除・DB 破損

1. incident を SEV-1 として起票する。
2. 書込を止める。録音・生成・管理画面更新の順で停止範囲を決める。
3. Supabase PITR の restore point と最新 `Backup Runtime And DB` artifact を確認する。
4. sandbox DB に PITR または dump を restore する。
5. 本番 DB と sandbox DB の差分を比較する。対象 tenant、row count、最新 session、audit を確認する。
6. 復旧方法を選ぶ。部分復旧で足りる場合は本番全体を巻き戻さない。
7. 本番切替または部分 restore は二者承認で実行する。
8. 復旧後、`Production Integrity Audit` と主要 smoke を実行する。

### 6.3 Blob 消失

1. 対象 prefix、session ID、conversation ID を特定する。
2. 最新 manifest の checksum と object path を確認する。
3. full export artifact または外部保管から対象 object を復元する。
4. DB の runtime path と Blob object の整合を確認する。
5. 必要に応じて STT / 生成を再実行する。ただし last good artifact は保持する。

### 6.4 Runpod worker 復旧

1. `npm run runpod:status` で現在の Pod と image を確認する。
2. `Publish Runpod Worker Image` の直近成功 SHA を確認する。
3. 直前安定 image を指定して起動する。

```bash
npm run runpod:start -- --fresh --wait --image=ghcr.io/<GitHub owner>/pararia-runpod-worker:sha-<commit>
```

4. `Production Recording Smoke` または `npm run test:teacher-recording-smoke` で本番相当の録音導線を 1 本確認する。

## 7. 証跡テンプレート

```markdown
# DR Evidence: <YYYY-MM-DD>

- scenario:
- severity:
- commander:
- approver_1:
- approver_2:
- started_at:
- completed_at:
- rpo_actual:
- rto_actual:
- affected_scope:
- data_restored:
- backup_source:
- backup_timestamp:
- github_actions_run:
- artifact_names:
- checksums:
- commands:
- validation:
- customer_notification:
- residual_risk:
- follow_up_issues:
```

## 8. 監査チェックリスト

- 直近 24時間以内の DB backup が存在する。
- 直近 24時間以内の Blob manifest または full export が存在する。
- 直近 1か月以内の `Backup Restore Drill` 成功 run が存在する。
- Supabase PITR が有効で、復旧権限者が明記されている。
- `PARARIA_BACKUP_DATABASE_URL` と `PARARIA_BLOB_BACKUP_TOKEN` が runtime secret と分離されている。
- restore 手順が二者承認になっている。
- 復旧後に `Production Integrity Audit`、`Critical Path Smoke`、`Generation Route Smoke`、必要に応じて `Production Recording Smoke` を実行している。
- 事故後に root cause と再発防止が issue 化されている。

## 9. 顧客・社内報告の基準

- データ喪失の疑いがある場合は、確定前でも一次報告を出す。
- 個人情報または学習記録の誤表示・消失・漏えいが疑われる場合は、法務・情報管理責任者へ即時エスカレーションする。
- 顧客向け報告では、影響範囲、発生時刻、復旧時刻、失われた可能性のあるデータ種別、再発防止を明記する。
- secret 値、内部 endpoint、個人情報を incident report に直接貼らない。
