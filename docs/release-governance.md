# リリース統制・Rollback 手順

最終更新: 2026-04-25

## 1. 目的

この文書は、PARARIA SaaS をエンタープライズ運用へ耐える形で release / rollback するための統制を定義します。変更を速く出すことよりも、本番影響を予測し、証跡を残し、問題時に戻せることを優先します。

関連文書:

- `docs/production-slo-runbooks.md`
- `docs/disaster-recovery-evidence.md`
- `docs/ai-governance-evals.md`
- `docs/runpod-worker.md`
- `docs/db-backup-recovery.md`

## 2. Release 種別

| 種別 | 例 | 承認 | 必須 gate |
| --- | --- | --- | --- |
| standard | UI 改善、軽微な API 修正 | reviewer 1名 | `verify` 相当 |
| high-risk | migration、認証、録音、STT、LLM、Blob、backup | reviewer 2名 | `verify`、関連 smoke、rollback plan |
| emergency | SEV 対応 hotfix | incident commander + reviewer 1名 | 最小 smoke、事後 `verify` |
| config-only | Vercel env、Runpod env、feature flag | owning engineer + 承認者 | 変更前後の値名、rollback 手順 |
| worker image | Runpod Docker image | owning engineer + 運用責任者 | `Publish Runpod Worker Image`、recording smoke |

## 3. 変更凍結条件

次の条件では新機能 release を止めます。

- SEV-1 / SEV-2 incident が未解決。
- `Backup Runtime And DB` が 24時間以内に成功していない。
- `Backup Restore Drill` が月次で失敗したまま。
- main の `Conversation Quality`、`Critical Path Smoke`、`Generation Route Smoke` のいずれかが赤。
- 本番 migration の rollback 方針が説明できない。
- AI model / prompt 変更で eval report がない。

## 4. Release 前チェック

### 4.1 共通

```bash
npm run lint
npm run typecheck
npm run scan:secrets
npm run check:code-shape
npm run verify
```

`npm run verify` は重い統合 gate です。時間が厳しい hotfix でも、事後に必ず実行して結果を incident / PR に追記します。

### 4.2 DB / migration

```bash
npm run test:migration-safety
npm run prisma:migrate:deploy
```

ルール:

- shared / production DB に `prisma migrate dev` を実行しない。
- 破壊的 migration は backup 成功後に実行する。
- deploy 前に `npm run backup:status` で Supabase backup 状態を確認する。
- 大きな data migration は dry-run、batch、resume 手順を PR に書く。

### 4.3 録音・STT・Runpod

```bash
npm run test:teacher-recording-smoke
npm run test:runpod-worker-ready
npm run test:runpod-remote-stt-completion
```

Runpod image を変える場合:

- GitHub Actions `Publish Runpod Worker Image` を実行する。
- `latest` ではなく `sha-...` tag を release note に記録する。
- 本番 smoke は `Production Recording Smoke` を正本にする。

### 4.4 AI / 生成

```bash
npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md
npm run test:generation-preservation
npm run test:parent-report-generation
```

model、prompt、rubric、generation route を触る release は `docs/ai-governance-evals.md` の承認を必要とします。

### 4.5 Backup / DR

```bash
npm run backup:status
npm run test:backup-restore-drill
```

high-risk release では、直近 24時間の DB/Blob backup と直近 1か月の restore drill 成功を確認します。

## 5. GitHub Actions Gate

必須確認対象:

- `Secret Scan`
- `Backend Scope Guard`
- `Conversation Quality`
- `Critical Path Smoke`
- `Generation Route Smoke`
- `Production Integrity Audit`
- `Production Recording Smoke`
- `Backup Runtime And DB`
- `Backup Restore Drill`
- `Publish Runpod Worker Image`

PR には、該当する workflow run URL と失敗時の判断を残します。`allowed failure` とする場合は、承認者と理由、期限付き follow-up issue を記録します。

## 6. Release 手順

1. PR description に変更目的、影響範囲、リスク、検証、rollback plan を書く。
2. CI と必要な手動 smoke を完了する。
3. high-risk release は二者承認を取る。
4. DB / env / worker image の変更順序を明記する。
5. production deploy 後 30分は 5xx、RUM、Runpod heartbeat、conversation job failure、backup warning を監視する。
6. deploy 後に `Production Integrity Audit` を確認する。
7. 録音導線を触った場合は `Production Recording Smoke` を確認する。

## 7. Rollback 判断

次のいずれかで rollback を検討し、顧客影響が継続する場合は即時実行します。

- 5xx が `docs/production-slo-runbooks.md` の SEV-2 閾値を超える。
- 認証、録音、STT、LLM finalize、report delivery の主導線が止まる。
- migration 後にデータ不整合、欠落、重複が見つかる。
- AI 生成で重大な幻覚、不適切表現、固有名詞誤りが増える。
- Runpod worker image の runtime revision 不一致、heartbeat 欠測、STT 連続失敗。
- backup / restore に影響する変更で backup 成功が確認できない。

## 8. Rollback 手順

### 8.1 Web deploy

1. 直近の正常 deployment を特定する。
2. Vercel の promote / rollback 機能で戻す。
3. env 変更を伴う場合は env も戻す。値は incident report に書かず、secret 名と変更時刻だけ記録する。
4. `Production Integrity Audit`、必要に応じて `Critical Path Smoke` / `Generation Route Smoke` を実行する。

### 8.2 DB migration

1. migration が backward compatible なら code rollback を先に行う。
2. destructive migration の場合は write stop し、`docs/disaster-recovery-evidence.md` に従う。
3. 本番 DB を直接手作業で戻す場合は二者承認、SQL、実行時刻、row count before/after を記録する。
4. restore が必要な場合は sandbox 検証を先に行う。

### 8.3 Runpod worker

1. 直前安定 SHA を確認する。
2. SHA 固定で Pod を作り直す。

```bash
npm run runpod:start -- --fresh --wait --image=ghcr.io/<GitHub owner>/pararia-runpod-worker:sha-<commit>
```

3. `Production Recording Smoke` を実行する。
4. heartbeat の `runpodWorkerImage`、`runpodWorkerGitSha`、`runpodWorkerRuntimeRevision` を incident report に記録する。

### 8.4 AI model / prompt

1. model / prompt / env を直前安定版へ戻す。
2. 生成済み artifact は削除せず、review state を確認する。
3. `npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md` を実行する。
4. 顧客向けに配信済みの不適切 artifact がある場合は、対象と再発防止を incident report に残す。

## 9. Release 証跡テンプレート

```markdown
# Release Evidence: <version or date>

- release_owner:
- approvers:
- merged_prs:
- deployment_url:
- git_sha:
- migration:
- runpod_worker_image:
- ai_model_or_prompt_change:
- backup_status:
- ci_runs:
- smoke_runs:
- rollback_plan:
- post_deploy_monitoring:
- decision:
```

## 10. Hotfix 例外

SEV 対応では最短で復旧するために一部 gate を後回しにできます。ただし次は省略できません。

- `scan:secrets`
- 影響範囲に対応する最小 smoke
- rollback plan
- incident commander の承認
- 事後の `npm run verify`
- 事後レビューと follow-up issue

## 11. リリース後レビュー

週次で次を確認します。

- rollback 件数と原因。
- release 後 24時間以内の SEV / customer issue。
- CI flake と gate 失敗の傾向。
- SLO error budget の消費。
- eval regression と reviewer rejection。
- backup / restore drill の成功状況。
