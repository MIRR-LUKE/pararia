import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pararia-runpod-summary-"));

  try {
    const samplePath = path.join(tempDir, "sample.json");
    await writeFile(
      samplePath,
      JSON.stringify(
        {
          ok: true,
          profile: "5090",
          gpu: "NVIDIA GeForce RTX 5090",
          startupMode: "reuse",
          workerImage: "ghcr.io/mirr-luke/pararia-runpod-worker:sha-abc123",
          runpodWorkerImage: "ghcr.io/mirr-luke/pararia-runpod-worker:sha-abc123",
          runpodWorkerRuntimeRevision: "git-abc123",
          podReadyMs: 15000,
          queueToSttMs: 51000,
          sttSeconds: 24,
          sttPrepareMs: null,
          sttTranscribeMs: 18000,
          sttTranscribeWorkerMs: null,
          sttFinalizeMs: 1200,
          sttVadParameters: null,
          queueToConversationMs: 145000,
          postSttTotalMs: 94000,
          sttToPromotionMs: 800,
          promotionToKickMs: 45000,
          kickToAppDispatchMs: 2000,
          appDispatchToClaimMs: 6000,
          claimToReviewStartMs: 200,
          reviewDurationMs: 3000,
          reviewToFinalizeMs: 400,
          finalizeActiveMs: 16500,
          postSttUnknownMs: 20100,
          promotionCompletedAt: "2026-04-19T00:00:51.800Z",
          conversationKickRequestedAt: "2026-04-19T00:01:36.800Z",
          conversationAppDispatchStartedAt: "2026-04-19T00:01:38.800Z",
          conversationJobClaimedAt: "2026-04-19T00:01:44.800Z",
          reviewCompletedAt: "2026-04-19T00:01:48.000Z",
          finalizeStartedAt: "2026-04-19T00:01:48.400Z",
          finalizeCompletedAt: "2026-04-19T00:02:04.900Z",
          finalizeDurationMs: 16000,
          llmCachedInputRatio: 0,
          llmCostUsd: 0.0476,
          promptCacheStablePrefixTokensEstimate: 1320,
        },
        null,
        2
      ),
      "utf8"
    );

    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/summarize-runpod-ux.ts", "--dir", tempDir],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      }
    );

    assert.match(output, /## Warnings/);
    assert.match(output, /git-abc123/);
    assert.match(output, /sttPrepareMs 1\/1/);
    assert.match(output, /sttTranscribeWorkerMs 1\/1/);
    assert.match(output, /sttVadParameters 1\/1/);
    assert.match(output, /## Post-STT breakdown/);
    assert.match(output, /post-STT unknown p50\/p95: 20100ms \/ 20100ms/);
    assert.match(output, /promptCacheKey 1\/1/);

    console.log("runpod UX summary warning regression check passed");
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

void main();
