# 本番監視・SLO・アラート・インシデント手順

最終更新: 2026-04-25

## 1. 目的

この文書は、PARARIA SaaS の本番運用で守る SLO、監視、アラート、インシデント対応を定義する正本です。日本国内の教育事業者向け SaaS として、保護者・講師・運用者が使う導線を止めないこと、音声・面談ログ・帳票の完全性を守ること、障害時に説明可能な証跡を残すことを目的にします。

関連文書:

- `docs/performance-observability.md`
- `docs/runpod-worker.md`
- `docs/db-backup-recovery.md`
- `docs/disaster-recovery-evidence.md`
- `docs/release-governance.md`

## 2. サービス階層

| tier | 対象 | 例 | 障害時の優先度 |
| --- | --- | --- | --- |
| Tier 0 | 認証、DB、Blob、録音投入、面談ログ生成の正本保存 | NextAuth、Supabase Postgres、Vercel Blob、conversation artifact | 最優先 |
| Tier 1 | 講師の録音、STT、ログ生成、保護者帳票生成 | web -> queue -> Runpod worker -> web-side LLM finalize | 高 |
| Tier 2 | 一覧、検索、配信履歴、管理画面 | dashboard、students、logs、reports | 中 |
| Tier 3 | 内部診断、計測、ベンチマーク | RUM、Runpod UX summary、eval report | 低。ただし証跡として保全 |

## 3. SLO

SLO は月次で評価し、エラーバジェットを使い切る見込みがある場合は新機能リリースより信頼性改善を優先します。

| SLI | SLO | 測定方法 | 除外条件 |
| --- | --- | --- | --- |
| 本番 Web 可用性 | 99.9% / 月 | Vercel deployment health、`Production Integrity Audit`、外形監視 | 事前告知済みメンテナンス |
| 認証済みページの 5xx 率 | 0.1% 未満 / 30日 | Vercel logs、`/api/*` error rate | 利用者の通信断、4xx |
| 録音 upload 成功率 | 99.5% 以上 / 30日 | `test:teacher-recording-smoke`、本番 route logs、Blob write failure | 端末の容量不足、ブラウザ権限拒否 |
| STT job 完了率 | 99.0% 以上 / 30日 | Runpod worker heartbeat、session progress、`Production Recording Smoke` | Runpod 側の広域障害で代替不能な時間 |
| 面談ログ生成完了率 | 99.0% 以上 / 30日 | conversation job status、`test:generation-preservation` | provider の公式障害で retry 上限を超えたもの |
| 主要画面 p95 route timing | `docs/performance-observability.md` の hard budget 以下 | `POST /api/rum`、`test:route-performance` | RUM sample 外、社内検証端末 |
| DB backup 成功 | 100% / 日 | `Backup Runtime And DB` artifact | GitHub Actions の広域障害時は手動 backup を代替 |
| 復旧演習 | 月 1 回以上 | `Backup Restore Drill` artifact | なし |

## 4. アラート分類

| severity | 条件 | 初動期限 | 通知先 | 例 |
| --- | --- | --- | --- | --- |
| SEV-1 | データ喪失の疑い、認証不能、全利用者で録音不可、DB 書込不可 | 15分 | on-call、事業責任者、開発責任者 | 大量削除、Supabase outage |
| SEV-2 | 主要導線の一部停止、STT/LLM job の連続失敗、p95 大幅悪化 | 30分 | on-call、開発責任者 | Runpod worker 起動不能 |
| SEV-3 | 回避策ありの機能劣化、単一 tenant の障害、backup warning | 4時間 | owning engineer | Blob manifest の一部欠落 |
| SEV-4 | 監視の欠測、runbook 不備、軽微な品質劣化 | 翌営業日 | owning engineer | RUM sample rate 設定漏れ |

## 5. アラート閾値

### 5.1 Web / API

- 5分間で 5xx が 10 件以上、または error rate が 2% 以上: SEV-2。
- 認証、録音、生成 finalize の 5xx が 3 件連続: SEV-2。
- `Production Integrity Audit` 失敗: SEV-2。read-only audit が認証・主要画面・DB 参照のいずれかで失敗したら即時確認。
- `Critical Path Smoke` または `Generation Route Smoke` が main で失敗: リリース停止。production 影響が疑われる場合 SEV-2。

### 5.2 Performance / UX

`docs/performance-observability.md` の hard budget を正本とします。

- 同一 route で p95 hard budget 超過が 30分継続: SEV-3。
- dashboard / reports / logs の p95 が hard budget の 2倍を 15分超過: SEV-2。
- RUM が 2時間以上完全欠測: SEV-4。利用増の時間帯なら SEV-3。

ローカル・CI 確認:

```bash
npm run test:route-performance -- --label local
npm run test:rum-route
```

### 5.3 Runpod / STT

`docs/runpod-worker.md` の `web -> queue -> Runpod worker(STT only) -> Runpod stop -> web-side LLM finalize` を正本導線とします。

- Runpod worker heartbeat が 5分以上更新されない、かつ未処理 job がある: SEV-2。
- STT job p95 が直近 7日 p95 の 2倍、または 30分以上 queue lag が増加: SEV-2。
- `Production Recording Smoke` 失敗: SEV-2。
- `RUNPOD_WORKER_IMAGE` / `RUNPOD_WORKER_GIT_SHA` / `RUNPOD_WORKER_RUNTIME_REVISION` の不一致: SEV-3。直近リリース後なら rollback 判定に入る。

確認コマンド:

```bash
npm run runpod:status
npm run runpod:measure-summary -- --dir .tmp/runpod-ux --out .tmp/runpod-ux-summary.md
npm run test:runpod-worker-ready
npm run test:runpod-remote-stt-completion
```

### 5.4 Backup / DR

- `Backup Runtime And DB` 失敗: SEV-2。
- `Backup Restore Drill` 失敗: SEV-2。
- DB dump は成功したが Blob backup / manifest が失敗: SEV-2。DB だけでは完全復旧できないため。
- 24時間以内に有効な DB backup artifact がない: SEV-1。

確認コマンド:

```bash
npm run backup:status
npm run backup:all
npm run test:backup-restore-drill
```

## 6. 日次・週次・月次運用

### 日次

- GitHub Actions `Backup Runtime And DB` の artifact と checksum を確認する。
- `Production Integrity Audit` の結果を確認する。
- Vercel 5xx、Runpod heartbeat、Blob backup warning を確認する。
- SEV-2 以上の未解決 incident がある場合、当日の release は凍結する。

### 週次

- `npm run verify` を main 相当で通し、失敗が残っていないことを確認する。
- `npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md` の差分を確認する。
- RUM の route budget 超過を確認し、改善 issue に紐づける。
- `npm run runpod:measure-summary -- --dir .tmp/runpod-ux --out .tmp/runpod-ux-summary.md` を保管する。

### 月次

- `Backup Restore Drill` の結果を監査フォルダに保管する。
- SLO レポートを作成し、availability、error budget、SEV 件数、MTTA、MTTR、顧客影響を記録する。
- アラート閾値、runbook、連絡先、権限者一覧を棚卸しする。

## 7. Incident Runbook

### 7.1 共通初動

1. incident channel を作成し、時刻、検知元、暫定 severity、incident commander を記録する。
2. 直近の release、env 変更、migration、Runpod image 変更、provider status を確認する。
3. 影響範囲を「全体 / tenant 限定 / 機能限定 / 内部監視のみ」に分類する。
4. 証跡を残す。GitHub Actions run URL、Vercel deployment URL、Runpod Pod ID、DB backup timestamp、対象 session/conversation ID を貼る。
5. 復旧優先で mitigation を決める。原因究明は利用者影響を止めた後に深掘りする。

### 7.2 Web/API 5xx

1. 直近 deploy を特定し、`docs/release-governance.md` の rollback 判定へ進む。
2. `npm run test:critical-path-smoke`、`npm run test:generation-preservation`、`npm run test:security-headers` の失敗有無を確認する。
3. DB 接続、Blob token、NextAuth 設定、middleware/proxy の変更を確認する。
4. rollback で復旧する場合は rollback を優先し、incident channel に deployment ID と完了時刻を記録する。

### 7.3 録音・STT 停止

1. `Production Recording Smoke` の最新 run を確認する。
2. `npm run runpod:status` で Pod 状態、image、runtime revision を確認する。
3. Pod が止まっている場合は `npm run runpod:start -- --wait` を実行する。
4. image 起因が疑われる場合は `docs/runpod-worker.md` に従い SHA 固定の直前 image で `npm run runpod:start -- --fresh --wait --image=...` を実行する。
5. `npm run test:teacher-recording-smoke -- --base-url https://pararia.vercel.app --env-file .tmp/.env.production.runpod` で 1 本確認する。env file は `env:write-production-ops` で生成し、元の Vercel pull file は削除する。

### 7.4 DB・Blob 障害

1. 書込継続で破損が広がる場合は maintenance route / feature flag / Vercel env で該当導線を停止する。
2. `docs/db-backup-recovery.md` と `docs/disaster-recovery-evidence.md` の DR runbook に移る。
3. 直近 `Backup Runtime And DB` artifact、Supabase PITR、Blob manifest を確認する。
4. 復旧先は原則 sandbox で検証し、本番切替は二者承認にする。

### 7.5 AI 生成品質劣化

1. `docs/ai-governance-evals.md` のモデル変更・評価手順を確認する。
2. `npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md` を実行し、直近 report と比較する。
3. 事実性、固有名詞、禁止表現、安全性のいずれかが悪化した場合は model/prompt/env の変更を rollback する。
4. 生成済み artifact の扱いは「破棄せず last good を保持」を原則とし、再生成は review gate を通す。

## 8. Incident 記録テンプレート

```markdown
# Incident: <YYYY-MM-DD title>

- severity:
- commander:
- detected_at:
- resolved_at:
- affected_tenants:
- affected_features:
- customer_impact:
- detection_source:
- related_deployments:
- related_actions:
- related_scripts:
- evidence:

## Timeline

- HH:MM detected
- HH:MM mitigated
- HH:MM resolved

## Root Cause

## Mitigation

## Follow-ups
```

## 9. 監査で提示する証跡

- GitHub Actions: `Production Integrity Audit`、`Production Recording Smoke`、`Critical Path Smoke`、`Generation Route Smoke`、`Backup Runtime And DB`、`Backup Restore Drill`。
- npm scripts: `verify`、`test:critical-path-smoke`、`test:generation-preservation`、`test:conversation-eval`、`test:route-performance`、`backup:all`、`test:backup-restore-drill`。
- runtime 証跡: Runpod heartbeat、`runpodWorkerImage`、`runpodWorkerGitSha`、`runpodWorkerRuntimeRevision`、RUM route timing、conversation eval report。
