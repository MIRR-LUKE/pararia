import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

type RecordingScenario = {
  id: string;
  concurrentRecordings: number;
  maxUploadMinutes: number;
  tenantCount: number;
};

type LoadScaleCostThresholds = {
  schemaVersion: number;
  scope: string;
  recordingScenarios: RecordingScenario[];
  upload: {
    maxAudioMinutesPerRecording: number;
    requiredIdempotency: boolean;
    requiredTenantScopedObjectKey: boolean;
    maxDuplicateCompletedUploadRatePct: number;
  };
  batchStt: {
    mode: string;
    maxQueueToStartP95Seconds: number;
    maxAudioProcessingRatioP95: number;
    maxRetryAttempts: number;
    requiresProviderFailureFallback: boolean;
    requiresNoInlineFallbackWhenExternalMode: boolean;
  };
  reportGeneration: {
    continuousReportsPerTenantPerHour: number;
    maxReportQueueToDoneP95Seconds: number;
    maxConcurrentReportsPerTenant: number;
    requiresGenerationIsolation: boolean;
  };
  multiTenant: {
    minTenantsInScalePlan: number;
    requiresOrganizationScopedReads: boolean;
    requiresPerTenantQuota: boolean;
    requiresCrossTenantLeakageRatePct: number;
  };
  failureAndBackpressure: {
    providerFailureModes: string[];
    backpressureActions: string[];
    maxWorkerSaturationPct: number;
    requiredCircuitBreakerOpenAfterFailures: number;
  };
  quota: {
    maxAudioMinutesPerTenantPerHour: number;
    maxAudioMinutesPerUserPerHour: number;
    maxReportGenerationsPerTenantPerHour: number;
    maxReportGenerationsPerUserPerHour: number;
    requiresAdminOverrideAudit: boolean;
  };
  costBudget: {
    currency: string;
    maxSttCostPerAudioMinute: number;
    maxSttCostPerAudioHour: number;
    maxBlendedCostPerAudioMinute: number;
    maxBlendedCostPerAudioHour: number;
    maxDailyCostAt200Concurrent120MinUploads: number;
    requiresCostAlertAtPctOfBudget: number;
  };
  staticVerification: {
    script: string;
    npmScript: string;
    requiresNoNetwork: boolean;
  };
};

const ROOT = process.cwd();
const PLAN_PATH = path.join(ROOT, "docs", "load-scale-cost-plan.md");

function extractThresholds(markdown: string): LoadScaleCostThresholds {
  const match = markdown.match(/```json load-scale-cost-thresholds\s+([\s\S]*?)```/);
  assert.ok(match, "docs/load-scale-cost-plan.md must include a json load-scale-cost-thresholds fenced block");
  return JSON.parse(match[1]) as LoadScaleCostThresholds;
}

function assertIncludesAll(source: string, label: string, values: string[]) {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} must include ${value}`);
  }
}

function assertPositiveNumber(value: number, label: string) {
  assert.equal(typeof value, "number", `${label} must be a number`);
  assert.ok(Number.isFinite(value) && value > 0, `${label} must be positive`);
}

function assertNearEqual(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) < 0.000001, `${label} expected ${expected}, received ${actual}`);
}

async function main() {
  const markdown = await readFile(PLAN_PATH, "utf8");
  const thresholds = extractThresholds(markdown);

  assert.equal(thresholds.schemaVersion, 1);
  assert.equal(thresholds.scope, "static-plan-only-no-network-load");

  const concurrency = thresholds.recordingScenarios
    .map((scenario) => scenario.concurrentRecordings)
    .sort((left, right) => left - right);
  assert.deepEqual(concurrency, [10, 50, 200], "plan must cover 10/50/200 concurrent recordings");

  for (const scenario of thresholds.recordingScenarios) {
    assert.equal(scenario.maxUploadMinutes, 120, `${scenario.id} must preserve the 120 minute upload limit`);
    assertPositiveNumber(scenario.tenantCount, `${scenario.id}.tenantCount`);
  }

  assert.equal(thresholds.upload.maxAudioMinutesPerRecording, 120);
  assert.equal(thresholds.upload.requiredIdempotency, true);
  assert.equal(thresholds.upload.requiredTenantScopedObjectKey, true);
  assert.equal(thresholds.upload.maxDuplicateCompletedUploadRatePct, 0);

  assert.equal(thresholds.batchStt.mode, "batch-stt");
  assert.ok(thresholds.batchStt.maxQueueToStartP95Seconds <= 600);
  assert.ok(thresholds.batchStt.maxAudioProcessingRatioP95 <= 1.5);
  assert.ok(thresholds.batchStt.maxRetryAttempts >= 3);
  assert.equal(thresholds.batchStt.requiresProviderFailureFallback, true);
  assert.equal(thresholds.batchStt.requiresNoInlineFallbackWhenExternalMode, true);

  assert.ok(thresholds.reportGeneration.continuousReportsPerTenantPerHour >= 120);
  assert.ok(thresholds.reportGeneration.maxReportQueueToDoneP95Seconds <= 180);
  assert.ok(thresholds.reportGeneration.maxConcurrentReportsPerTenant >= 8);
  assert.equal(thresholds.reportGeneration.requiresGenerationIsolation, true);

  assert.ok(thresholds.multiTenant.minTenantsInScalePlan >= 40);
  assert.equal(thresholds.multiTenant.requiresOrganizationScopedReads, true);
  assert.equal(thresholds.multiTenant.requiresPerTenantQuota, true);
  assert.equal(thresholds.multiTenant.requiresCrossTenantLeakageRatePct, 0);

  assertIncludesAll(thresholds.failureAndBackpressure.providerFailureModes.join(","), "provider failure modes", [
    "stt-timeout",
    "stt-429",
    "llm-429",
    "blob-write-failure",
  ]);
  assertIncludesAll(thresholds.failureAndBackpressure.backpressureActions.join(","), "backpressure actions", [
    "queue",
    "retry-after",
    "degrade-to-pending",
    "operator-alert",
  ]);
  assert.ok(thresholds.failureAndBackpressure.maxWorkerSaturationPct <= 80);
  assert.ok(thresholds.failureAndBackpressure.requiredCircuitBreakerOpenAfterFailures <= 5);

  assert.ok(thresholds.quota.maxAudioMinutesPerTenantPerHour >= 24_000);
  assert.ok(thresholds.quota.maxAudioMinutesPerUserPerHour >= 480);
  assert.ok(thresholds.quota.maxReportGenerationsPerTenantPerHour >= 120);
  assert.ok(thresholds.quota.maxReportGenerationsPerUserPerHour >= 30);
  assert.equal(thresholds.quota.requiresAdminOverrideAudit, true);

  assert.equal(thresholds.costBudget.currency, "USD");
  assertPositiveNumber(thresholds.costBudget.maxSttCostPerAudioMinute, "maxSttCostPerAudioMinute");
  assertPositiveNumber(thresholds.costBudget.maxSttCostPerAudioHour, "maxSttCostPerAudioHour");
  assertPositiveNumber(thresholds.costBudget.maxBlendedCostPerAudioMinute, "maxBlendedCostPerAudioMinute");
  assertPositiveNumber(thresholds.costBudget.maxBlendedCostPerAudioHour, "maxBlendedCostPerAudioHour");
  assertNearEqual(
    thresholds.costBudget.maxSttCostPerAudioHour,
    thresholds.costBudget.maxSttCostPerAudioMinute * 60,
    "maxSttCostPerAudioHour"
  );
  assertNearEqual(
    thresholds.costBudget.maxBlendedCostPerAudioHour,
    thresholds.costBudget.maxBlendedCostPerAudioMinute * 60,
    "maxBlendedCostPerAudioHour"
  );
  assert.ok(thresholds.costBudget.maxDailyCostAt200Concurrent120MinUploads <= 360);
  assert.ok(thresholds.costBudget.requiresCostAlertAtPctOfBudget <= 80);

  assert.equal(thresholds.staticVerification.script, "scripts/test-load-scale-cost-plan.ts");
  assert.equal(thresholds.staticVerification.npmScript, "test:load-scale-cost-plan");
  assert.equal(thresholds.staticVerification.requiresNoNetwork, true);

  assertIncludesAll(markdown, "plan text", [
    "10同時録音",
    "50同時録音",
    "200同時録音",
    "120分 upload",
    "batch STT",
    "multi-tenant",
    "report連続生成",
    "provider failure",
    "backpressure",
    "quota",
    "cost per audio minute/hour",
  ]);

  console.log("load scale cost plan static checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
