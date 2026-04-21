#!/usr/bin/env tsx

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

type RunpodMeasureResult = {
  ok?: boolean;
  profile?: string;
  gpu?: string;
  startupMode?: string;
  workerImage?: string | null;
  workerName?: string | null;
  runpodWorkerImage?: string | null;
  runpodWorkerRuntimeRevision?: string | null;
  runpodWorkerGitSha?: string | null;
  runpodWorkerFeatureFlags?: Record<string, unknown> | null;
  podReadyMs?: number | null;
  queueToSttMs?: number | null;
  sttSeconds?: number | null;
  sttPrepareMs?: number | null;
  sttTranscribeMs?: number | null;
  sttTranscribeWorkerMs?: number | null;
  sttFinalizeMs?: number | null;
  sttVadParameters?: Record<string, number> | null;
  queueToConversationMs?: number | null;
  postSttTotalMs?: number | null;
  sttToPromotionMs?: number | null;
  promotionToKickMs?: number | null;
  kickDeferredToKickMs?: number | null;
  kickToAppDispatchMs?: number | null;
  appDispatchToClaimMs?: number | null;
  claimToReviewStartMs?: number | null;
  reviewDurationMs?: number | null;
  reviewToFinalizeMs?: number | null;
  finalizeActiveMs?: number | null;
  postSttUnknownMs?: number | null;
  promotionCompletedAt?: string | null;
  conversationKickRequestedAt?: string | null;
  conversationAppDispatchStartedAt?: string | null;
  conversationJobClaimedAt?: string | null;
  reviewCompletedAt?: string | null;
  finalizeStartedAt?: string | null;
  finalizeCompletedAt?: string | null;
  finalizeDurationMs?: number | null;
  finalizeQueueLagMs?: number | null;
  llmCachedInputRatio?: number | null;
  llmCostUsd?: number | null;
  promptCacheKey?: string | null;
  promptCacheRetention?: "in_memory" | "24h" | null;
  promptCacheStablePrefixTokensEstimate?: number | null;
};

function parseArg(flag: string, fallback?: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback ?? null;
  return process.argv[index + 1] ?? fallback ?? null;
}

async function collectJsonFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const resolved = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonFiles(resolved)));
      continue;
    }
    if (entry.isFile() && resolved.toLowerCase().endsWith(".json")) {
      files.push(resolved);
    }
  }
  return files;
}

function coerceResults(value: unknown): RunpodMeasureResult[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is RunpodMeasureResult => Boolean(item && typeof item === "object"));
  }
  if (value && typeof value === "object") {
    return [value as RunpodMeasureResult];
  }
  return [];
}

function readFiniteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? null;
}

function formatMs(value: number | null) {
  if (value === null) return "-";
  return `${Math.round(value)}ms`;
}

function formatSeconds(value: number | null) {
  if (value === null) return "-";
  return `${Math.round(value * 10) / 10}s`;
}

function formatRatio(value: number | null) {
  if (value === null) return "-";
  return `${Math.round(value * 100)}%`;
}

function formatUsd(value: number | null) {
  if (value === null) return "-";
  return `$${value.toFixed(4)}`;
}

function formatTokens(value: number | null) {
  if (value === null) return "-";
  return `${Math.round(value)} tok`;
}

async function main() {
  const dir = path.resolve(parseArg("--dir", ".tmp/runpod-ux")!);
  const outputPath = parseArg("--out", "");
  const files = await collectJsonFiles(dir);
  if (files.length === 0) {
    throw new Error(`no JSON files found under ${dir}`);
  }

  const rows = (
    await Promise.all(
      files.map(async (filePath) => {
        const raw = (await readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
        const parsed = JSON.parse(raw);
        return coerceResults(parsed);
      })
    )
  ).flat();

  if (rows.length === 0) {
    throw new Error(`no runpod UX results found under ${dir}`);
  }

  const groups = new Map<string, RunpodMeasureResult[]>();
  for (const row of rows) {
    const key = [
      row.profile || "unknown",
      row.startupMode || "unknown",
      row.gpu || "unknown",
      row.runpodWorkerRuntimeRevision || row.runpodWorkerImage || row.workerImage || row.workerName || "default",
    ].join(" | ");
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }

  const lines = [
    "# Runpod UX Summary",
    "",
    `- Source directory: \`${dir}\``,
    `- Samples: ${rows.length}`,
    "",
    "| Group | n | Success | Pod Ready p50/p95 | Queue->STT p50/p95 | STT p50 | Worker p50 | Queue->Conversation p50/p95 | Finalize p50 | Cache Hit p50 | Stable Prefix p50 | Cost p50 |",
    "| --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const warnings: string[] = [];
  const breakdownSections: string[] = [];

  for (const [groupKey, items] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const successes = items.filter((item) => item.ok);
    const successRate = items.length > 0 ? successes.length / items.length : 0;
    const podReady = successes.map((item) => readFiniteNumber(item.podReadyMs)).filter((value): value is number => value !== null);
    const queueToStt = successes.map((item) => readFiniteNumber(item.queueToSttMs)).filter((value): value is number => value !== null);
    const sttSeconds = successes.map((item) => readFiniteNumber(item.sttSeconds)).filter((value): value is number => value !== null);
    const workerMs = successes
      .map((item) => readFiniteNumber(item.sttTranscribeWorkerMs))
      .filter((value): value is number => value !== null);
    const queueToConversation = successes
      .map((item) => readFiniteNumber(item.queueToConversationMs))
      .filter((value): value is number => value !== null);
    const finalize = successes
      .map((item) => readFiniteNumber(item.finalizeDurationMs))
      .filter((value): value is number => value !== null);
    const cacheHitRatio = successes
      .map((item) => readFiniteNumber(item.llmCachedInputRatio))
      .filter((value): value is number => value !== null);
    const stablePrefixTokens = successes
      .map((item) => readFiniteNumber(item.promptCacheStablePrefixTokensEstimate))
      .filter((value): value is number => value !== null);
    const llmCost = successes
      .map((item) => readFiniteNumber(item.llmCostUsd))
      .filter((value): value is number => value !== null);
    const postSttTotal = successes
      .map((item) => readFiniteNumber(item.postSttTotalMs))
      .filter((value): value is number => value !== null);
    const sttToPromotion = successes
      .map((item) => readFiniteNumber(item.sttToPromotionMs))
      .filter((value): value is number => value !== null);
    const promotionToKick = successes
      .map((item) => readFiniteNumber(item.promotionToKickMs))
      .filter((value): value is number => value !== null);
    const deferredToKick = successes
      .map((item) => readFiniteNumber(item.kickDeferredToKickMs))
      .filter((value): value is number => value !== null);
    const kickToDispatch = successes
      .map((item) => readFiniteNumber(item.kickToAppDispatchMs))
      .filter((value): value is number => value !== null);
    const dispatchToClaim = successes
      .map((item) => readFiniteNumber(item.appDispatchToClaimMs))
      .filter((value): value is number => value !== null);
    const claimToReviewStart = successes
      .map((item) => readFiniteNumber(item.claimToReviewStartMs))
      .filter((value): value is number => value !== null);
    const reviewDuration = successes
      .map((item) => readFiniteNumber(item.reviewDurationMs))
      .filter((value): value is number => value !== null);
    const reviewToFinalize = successes
      .map((item) => readFiniteNumber(item.reviewToFinalizeMs))
      .filter((value): value is number => value !== null);
    const finalizeActive = successes
      .map((item) => readFiniteNumber(item.finalizeActiveMs))
      .filter((value): value is number => value !== null);
    const postSttUnknown = successes
      .map((item) => readFiniteNumber(item.postSttUnknownMs))
      .filter((value): value is number => value !== null);

    lines.push(
      `| ${groupKey} | ${items.length} | ${formatRatio(successRate)} | ${formatMs(percentile(podReady, 0.5))} / ${formatMs(percentile(podReady, 0.95))} | ${formatMs(percentile(queueToStt, 0.5))} / ${formatMs(percentile(queueToStt, 0.95))} | ${formatSeconds(percentile(sttSeconds, 0.5))} | ${formatMs(percentile(workerMs, 0.5))} | ${formatMs(percentile(queueToConversation, 0.5))} / ${formatMs(percentile(queueToConversation, 0.95))} | ${formatMs(percentile(finalize, 0.5))} | ${formatRatio(percentile(cacheHitRatio, 0.5))} | ${formatTokens(percentile(stablePrefixTokens, 0.5))} | ${formatUsd(percentile(llmCost, 0.5))} |`
    );

    breakdownSections.push(`### ${groupKey}`);
    breakdownSections.push("");
    breakdownSections.push(`- samples: ${successes.length}/${items.length} success`);
    breakdownSections.push(
      `- post-STT total p50/p95: ${formatMs(percentile(postSttTotal, 0.5))} / ${formatMs(percentile(postSttTotal, 0.95))}`
    );
    breakdownSections.push(
      `- STT->promotion p50/p95: ${formatMs(percentile(sttToPromotion, 0.5))} / ${formatMs(percentile(sttToPromotion, 0.95))}`
    );
    breakdownSections.push(
      `- promotion->kick p50/p95: ${formatMs(percentile(promotionToKick, 0.5))} / ${formatMs(percentile(promotionToKick, 0.95))}`
    );
    if (deferredToKick.length > 0) {
      breakdownSections.push(
        `- deferred->kick p50/p95: ${formatMs(percentile(deferredToKick, 0.5))} / ${formatMs(percentile(deferredToKick, 0.95))}`
      );
    }
    breakdownSections.push(
      `- kick->app dispatch p50/p95: ${formatMs(percentile(kickToDispatch, 0.5))} / ${formatMs(percentile(kickToDispatch, 0.95))}`
    );
    breakdownSections.push(
      `- app dispatch->job claim p50/p95: ${formatMs(percentile(dispatchToClaim, 0.5))} / ${formatMs(percentile(dispatchToClaim, 0.95))}`
    );
    breakdownSections.push(
      `- claim->review start p50/p95: ${formatMs(percentile(claimToReviewStart, 0.5))} / ${formatMs(percentile(claimToReviewStart, 0.95))}`
    );
    breakdownSections.push(
      `- review duration p50/p95: ${formatMs(percentile(reviewDuration, 0.5))} / ${formatMs(percentile(reviewDuration, 0.95))}`
    );
    breakdownSections.push(
      `- review->finalize p50/p95: ${formatMs(percentile(reviewToFinalize, 0.5))} / ${formatMs(percentile(reviewToFinalize, 0.95))}`
    );
    breakdownSections.push(
      `- finalize active p50/p95: ${formatMs(percentile(finalizeActive, 0.5))} / ${formatMs(percentile(finalizeActive, 0.95))}`
    );
    breakdownSections.push(
      `- post-STT unknown p50/p95: ${formatMs(percentile(postSttUnknown, 0.5))} / ${formatMs(percentile(postSttUnknown, 0.95))}`
    );
    breakdownSections.push("");

    const missingFieldCounts = new Map<string, number>();
    const countMissing = (label: string, predicate: (item: RunpodMeasureResult) => boolean) => {
      const count = successes.filter(predicate).length;
      if (count > 0) {
        missingFieldCounts.set(label, count);
      }
    };

    countMissing("runpodWorkerRuntimeRevision", (item) => !item.runpodWorkerRuntimeRevision);
    countMissing("sttPrepareMs", (item) => item.sttPrepareMs === null || item.sttPrepareMs === undefined);
    countMissing("sttTranscribeMs", (item) => item.sttTranscribeMs === null || item.sttTranscribeMs === undefined);
    countMissing(
      "sttTranscribeWorkerMs",
      (item) => item.sttTranscribeWorkerMs === null || item.sttTranscribeWorkerMs === undefined
    );
    countMissing("sttFinalizeMs", (item) => item.sttFinalizeMs === null || item.sttFinalizeMs === undefined);
    countMissing("sttVadParameters", (item) => !item.sttVadParameters);
    countMissing("promotionCompletedAt", (item) => !item.promotionCompletedAt);
    countMissing("conversationKickRequestedAt", (item) => !item.conversationKickRequestedAt);
    countMissing("conversationAppDispatchStartedAt", (item) => !item.conversationAppDispatchStartedAt);
    countMissing("conversationJobClaimedAt", (item) => !item.conversationJobClaimedAt);
    countMissing("reviewCompletedAt", (item) => !item.reviewCompletedAt);
    countMissing("finalizeStartedAt", (item) => !item.finalizeStartedAt);
    countMissing("finalizeCompletedAt", (item) => !item.finalizeCompletedAt);
    countMissing("promptCacheKey", (item) => !item.promptCacheKey);
    countMissing(
      "promptCacheStablePrefixTokensEstimate",
      (item) =>
        item.promptCacheStablePrefixTokensEstimate === null || item.promptCacheStablePrefixTokensEstimate === undefined
    );

    if (missingFieldCounts.size > 0) {
      warnings.push(
        `- ${groupKey}: ${[...missingFieldCounts.entries()].map(([label, count]) => `${label} ${count}/${successes.length}`).join(", ")}`
      );
    }

    const stablePrefixReadyCount = successes.filter(
      (item) =>
        typeof item.promptCacheStablePrefixTokensEstimate === "number" &&
        item.promptCacheStablePrefixTokensEstimate >= 1024
    ).length;
    const zeroCacheHitCount = successes.filter((item) => (readFiniteNumber(item.llmCachedInputRatio) ?? 0) === 0).length;
    if (successes.length > 0 && zeroCacheHitCount === successes.length && stablePrefixReadyCount > 0) {
      warnings.push(
        `- ${groupKey}: llmCachedInputRatio 0/${successes.length} despite stable prefix >=1024 tokens in ${stablePrefixReadyCount}/${successes.length}`
      );
    }
  }

  lines.push("");
  lines.push("## Warnings");
  lines.push("");
  if (warnings.length === 0) {
    lines.push("- none");
  } else {
    lines.push(...warnings);
  }

  lines.push("");
  lines.push("## Post-STT breakdown");
  lines.push("");
  if (breakdownSections.length === 0) {
    lines.push("- none");
  } else {
    lines.push(...breakdownSections);
  }

  const markdown = `${lines.join("\n")}\n`;
  if (outputPath) {
    const resolvedOutput = path.resolve(outputPath);
    await mkdir(path.dirname(resolvedOutput), { recursive: true });
    await writeFile(resolvedOutput, markdown, "utf8");
  }

  console.log(markdown);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
