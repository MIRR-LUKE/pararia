# 負荷・スケール・コスト検証計画

Issue #200 の初期成果物として、実ネットワークへ負荷をかける前に、負荷シナリオ、SLO、backpressure、quota、cost budget を機械可読に固定する。対象は日本向け SaaS を上場企業利用に耐える保守品質へ引き上げるための静的ゲートであり、ここでは本番 API、Blob、STT provider、Runpod、LLM provider へ一切リクエストしない。

## 機械可読しきい値

以下の JSON は `npm run test:load-scale-cost-plan` が読み取る正本である。provider 単価は請求額の断言ではなく、設計時の内部予算上限として扱い、provider の公開価格や契約単価が変わった場合はこのブロックを更新して差分レビューする。

```json load-scale-cost-thresholds
{
  "schemaVersion": 1,
  "lastReviewed": "2026-04-25",
  "scope": "static-plan-only-no-network-load",
  "recordingScenarios": [
    {
      "id": "recordings-concurrent-10",
      "concurrentRecordings": 10,
      "maxUploadMinutes": 120,
      "tenantCount": 2,
      "expectedUse": "single-school peak lesson changeover"
    },
    {
      "id": "recordings-concurrent-50",
      "concurrentRecordings": 50,
      "maxUploadMinutes": 120,
      "tenantCount": 10,
      "expectedUse": "multi-school daily peak"
    },
    {
      "id": "recordings-concurrent-200",
      "concurrentRecordings": 200,
      "maxUploadMinutes": 120,
      "tenantCount": 40,
      "expectedUse": "listed-company rollout and incident drill"
    }
  ],
  "upload": {
    "maxAudioMinutesPerRecording": 120,
    "requiredIdempotency": true,
    "requiredTenantScopedObjectKey": true,
    "maxDuplicateCompletedUploadRatePct": 0,
    "maxUploadQueueDelayP95Seconds": 300,
    "maxUploadFinalizeP95Seconds": 30
  },
  "batchStt": {
    "mode": "batch-stt",
    "maxQueueToStartP95Seconds": 600,
    "maxAudioProcessingRatioP95": 1.5,
    "maxRetryAttempts": 3,
    "requiresProviderFailureFallback": true,
    "requiresNoInlineFallbackWhenExternalMode": true
  },
  "reportGeneration": {
    "continuousReportsPerTenantPerHour": 120,
    "maxReportQueueToDoneP95Seconds": 180,
    "maxConcurrentReportsPerTenant": 8,
    "requiresGenerationIsolation": true
  },
  "multiTenant": {
    "minTenantsInScalePlan": 40,
    "requiresOrganizationScopedReads": true,
    "requiresPerTenantQuota": true,
    "requiresCrossTenantLeakageRatePct": 0
  },
  "failureAndBackpressure": {
    "providerFailureModes": ["stt-timeout", "stt-429", "llm-429", "blob-write-failure"],
    "backpressureActions": ["queue", "retry-after", "degrade-to-pending", "operator-alert"],
    "max429RetryAfterSeconds": 120,
    "maxWorkerSaturationPct": 80,
    "requiredCircuitBreakerOpenAfterFailures": 5
  },
  "quota": {
    "maxAudioMinutesPerTenantPerHour": 24000,
    "maxAudioMinutesPerUserPerHour": 480,
    "maxReportGenerationsPerTenantPerHour": 120,
    "maxReportGenerationsPerUserPerHour": 30,
    "requiresAdminOverrideAudit": true
  },
  "costBudget": {
    "currency": "USD",
    "maxSttCostPerAudioMinute": 0.006,
    "maxSttCostPerAudioHour": 0.36,
    "maxBlendedCostPerAudioMinute": 0.015,
    "maxBlendedCostPerAudioHour": 0.9,
    "maxDailyCostAt200Concurrent120MinUploads": 360,
    "requiresCostAlertAtPctOfBudget": 80
  },
  "staticVerification": {
    "script": "scripts/test-load-scale-cost-plan.ts",
    "npmScript": "test:load-scale-cost-plan",
    "requiresNoNetwork": true
  }
}
```

## シナリオ表

| シナリオ | 負荷形状 | 受け入れ基準 | 実負荷前の証跡 |
| --- | --- | --- | --- |
| 10同時録音 | 2 tenants、各 5 本の 120分 upload | upload queue p95 300s 以下、finalize p95 30s 以下、duplicate completed upload 0% | 静的計画テスト、idempotency 契約、tenant-scoped object key review |
| 50同時録音 | 10 tenants、授業終了ピーク、batch STT | queue-to-STT start p95 600s 以下、audio processing ratio p95 1.5 以下 | worker queue budget、retry policy、external-mode inline fallback guard |
| 200同時録音 | 40 tenants、上場企業 rollout drill | worker saturation 80% 以下、tenant quota enforcement、operator alert | capacity worksheet、quota fixture、backpressure runbook |
| 120分 upload | サポート上限の録音長 | 120分音声を 1 object として扱い、途中失敗は pending retry に戻す | recording policy と upload reservation checks |
| batch STT | queue 経由の transcription、provider-independent orchestration | provider 429/timeout は max 3 retry、circuit breaker は 5 failures で open | static failure matrix と Runpod worker readiness checks |
| report連続生成 | 120 reports / tenant / hour | tenant あたり同時 8 件、p95 180s 以下、生成 isolation を維持 | generation boundary と report route checks |

## マルチテナント要件

- すべての recording、upload reservation、STT job、report job は `organizationId` を持つ境界で読み書きする。
- 200同時録音の検証では、最低 40 tenants を想定し、1 tenant の大量 upload が他 tenant の report generation を飢餓状態にしないことを確認する。
- cross-tenant leakage は許容 0% とし、検証 fixture では tenant A の音声、transcript、report、progress が tenant B から読めない前提を崩さない。
- quota は tenant と user の両方で持ち、管理者 override は理由、実行者、対象 tenant、期限、変更前後の値を audit log に残す。

## Provider Failure と Backpressure

- STT provider timeout、STT 429、LLM 429、Blob write failure は個別の failure mode として扱う。
- STT provider failure 時は queued retry に戻し、同じ recording の duplicate STT completion を idempotent に破棄する。
- external worker mode では inline STT fallback を行わない。provider failure は待機、再試行、operator alert の対象にする。
- backpressure は `queue`、`retry-after`、`degrade-to-pending`、`operator-alert` の順で適用し、ユーザーには「失敗」ではなく「送信済み、処理待ち」の状態を返す。
- worker saturation が 80% を超えたら新規 batch STT 起動を抑制し、既存 job の完了と tenant quota enforcement を優先する。

## Quota 基準

| Quota | しきい値 | 根拠 |
| --- | ---: | --- |
| audio minutes / tenant / hour | 24,000 | 200 concurrent recordings x 120 minutes を 1 時間窓で受けられる上限 |
| audio minutes / user / hour | 480 | 1 user が 120分 recording を 4 本並列化する異常値を抑える |
| report generations / tenant / hour | 120 | peak hour に連続 report generation を許容する上限 |
| report generations / user / hour | 30 | 操作ミスや retry storm による過剰生成を止める |
| cost alert | budget の 80% | provider invoice に出る前に日次運用で検知する |

## コスト基準

cost budget は audio minute と audio hour の両方で評価する。STT 単体は `maxSttCostPerAudioMinute = 0.006 USD`、`maxSttCostPerAudioHour = 0.36 USD` を内部上限とする。STT、queue、worker、LLM、storage を含む blended budget は `maxBlendedCostPerAudioMinute = 0.015 USD`、`maxBlendedCostPerAudioHour = 0.9 USD` とする。

200同時録音がすべて 120分 upload になった場合、総 audio minutes は 24,000 分である。blended budget では `24,000 * 0.015 = 360 USD` を日次 incident drill の上限として扱い、80% 到達時点で alert を出す。

## 静的テスト契約

- `npm run test:load-scale-cost-plan` はこの Markdown だけを読み、実ネットワークには接続しない。
- テストは JSON block の構造、10/50/200同時録音、120分 upload、batch STT、multi-tenant、report連続生成、provider failure、backpressure、quota、cost per audio minute/hour の存在と値を検証する。
- この静的ゲートが通ったあとにのみ、別 Issue で fixture-driven local load test、staging synthetic load、production-safe canary の順に進める。
