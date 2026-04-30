import { readSessionPartMeta } from "@/lib/session-part-meta";

type SessionTimingPartLike = {
  createdAt?: Date | string | null;
  qualityMetaJson?: unknown;
};

type SessionTimingConversationJobLike = {
  type?: string | null;
  executionId?: string | null;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  lastQueueLagMs?: number | null;
};

type SessionTimingConversationLike = {
  createdAt?: Date | string | null;
  qualityMetaJson?: unknown;
  jobs?: SessionTimingConversationJobLike[] | null;
};

type SessionTimingNextMeetingMemoLike = {
  status?: string | null;
  updatedAt?: Date | string | null;
};

export type SessionProgressTimingSnapshot = {
  traceId: string | null;
  pipelineStartedAt: string | null;
  transcriptReadyAt: string | null;
  logReadyAt: string | null;
  nextMeetingMemoReadyAt: string | null;
  audioSeconds: number | null;
  sttPrepareSeconds: number | null;
  transcriptionSeconds: number | null;
  sttWorkerSeconds: number | null;
  sttFinalizeSeconds: number | null;
  acceptedToTranscriptSeconds: number | null;
  logGenerationSeconds: number | null;
  transcriptToLogSeconds: number | null;
  nextMeetingMemoSeconds: number | null;
  logToNextMeetingMemoSeconds: number | null;
  totalPipelineSeconds: number | null;
  finalizeQueueLagSeconds: number | null;
  llmApiCalls: number | null;
  llmInputTokens: number | null;
  llmCachedInputTokens: number | null;
  llmCachedInputRatio: number | null;
  llmOutputTokens: number | null;
  llmCostUsd: number | null;
  llmCostJpy: number | null;
  llmCostUsdJpyRate: number | null;
};

type BuildSessionProgressTimingInput = {
  sessionId?: string | null;
  sessionCreatedAt?: Date | string | null;
  conversationId?: string | null;
  parts?: SessionTimingPartLike[] | null;
  conversation?: SessionTimingConversationLike | null;
  nextMeetingMemo?: SessionTimingNextMeetingMemoLike | null;
};

function readTime(value: Date | string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function toIsoOrNull(value: number | null) {
  return typeof value === "number" ? new Date(value).toISOString() : null;
}

function toRoundedSecondsOrNull(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round((value / 1000) * 10) / 10;
}

function diffSeconds(endMs: number | null, startMs: number | null) {
  if (typeof endMs !== "number" || typeof startMs !== "number") return null;
  if (endMs < startMs) return null;
  return toRoundedSecondsOrNull(endMs - startMs);
}

function readPositiveNumber(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

function readNonNegativeNumber(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

function readTotalAudioSeconds(parts: SessionTimingPartLike[]) {
  let total = 0;
  let found = false;
  for (const part of parts) {
    const meta = readSessionPartMeta(part.qualityMetaJson);
    const audioSeconds =
      readPositiveNumber(meta.audioDurationSeconds) ?? readPositiveNumber(meta.liveDurationSeconds);
    if (audioSeconds === null) continue;
    total += audioSeconds;
    found = true;
  }
  return found ? Math.round(total * 10) / 10 : null;
}

function readTranscriptionSeconds(parts: SessionTimingPartLike[], transcriptReadyAtMs: number | null, pipelineStartedAtMs: number | null) {
  let total = 0;
  let found = false;
  for (const part of parts) {
    const meta = readSessionPartMeta(part.qualityMetaJson);
    const sttSeconds = readPositiveNumber(meta.sttSeconds);
    if (sttSeconds === null) continue;
    total += sttSeconds;
    found = true;
  }
  if (found) {
    return Math.round(total * 10) / 10;
  }
  return diffSeconds(transcriptReadyAtMs, pipelineStartedAtMs);
}

function readAccumulatedSeconds(parts: SessionTimingPartLike[], key: string) {
  let total = 0;
  let found = false;
  for (const part of parts) {
    const meta = readSessionPartMeta(part.qualityMetaJson);
    const milliseconds = readNonNegativeNumber(meta[key]);
    if (milliseconds === null) continue;
    total += milliseconds;
    found = true;
  }
  return found ? toRoundedSecondsOrNull(total) : null;
}

function readConversationQualityMeta(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readJobDurationMs(
  job: SessionTimingConversationJobLike | null,
  fallbackMs: unknown
) {
  const startedAtMs = readTime(job?.startedAt ?? null);
  const finishedAtMs = readTime(job?.finishedAt ?? null);
  if (typeof startedAtMs === "number" && typeof finishedAtMs === "number" && finishedAtMs >= startedAtMs) {
    return finishedAtMs - startedAtMs;
  }

  const fallbackNumber = Number(fallbackMs);
  if (Number.isFinite(fallbackNumber) && fallbackNumber > 0) {
    return fallbackNumber;
  }
  return null;
}

export function buildSessionProgressTimingSnapshot(
  input: BuildSessionProgressTimingInput
): SessionProgressTimingSnapshot {
  const parts = input.parts ?? [];
  const partAcceptedTimes = parts
    .map((part) => {
      const meta = readSessionPartMeta(part.qualityMetaJson);
      return readTime((meta.lastAcceptedAt as string | undefined) ?? part.createdAt ?? null);
    })
    .filter((value): value is number => typeof value === "number");
  const partCompletedTimes = parts
    .map((part) => {
      const meta = readSessionPartMeta(part.qualityMetaJson);
      return readTime((meta.lastCompletedAt as string | undefined) ?? null);
    })
    .filter((value): value is number => typeof value === "number");

  const pipelineStartedAtMs =
    partAcceptedTimes.length > 0
      ? Math.min(...partAcceptedTimes)
      : readTime(input.sessionCreatedAt ?? null);
  const transcriptReadyAtMs = partCompletedTimes.length > 0 ? Math.max(...partCompletedTimes) : null;

  const conversationMeta = readConversationQualityMeta(input.conversation?.qualityMetaJson);
  const jobs = input.conversation?.jobs ?? [];
  const finalizeJob = jobs.find((job) => job.type === "FINALIZE") ?? null;
  const nextMeetingMemoJob = jobs.find((job) => job.type === "GENERATE_NEXT_MEETING_MEMO") ?? null;

  const logReadyAtMs =
    readTime(finalizeJob?.finishedAt ?? null) ??
    readTime(input.conversation?.createdAt ?? null);
  const nextMeetingMemoReadyAtMs =
    readTime(nextMeetingMemoJob?.finishedAt ?? null) ??
    (input.nextMeetingMemo?.status === "READY" || input.nextMeetingMemo?.status === "FAILED"
      ? readTime(input.nextMeetingMemo.updatedAt ?? null)
      : null);

  const logGenerationMs = readJobDurationMs(
    finalizeJob,
    (conversationMeta.finalizeJob as Record<string, unknown> | undefined)?.durationMs ??
      (() => {
        const finalizeSeconds = readPositiveNumber(conversationMeta.jobSecondsFinalize);
        return finalizeSeconds === null ? null : finalizeSeconds * 1000;
      })()
  );
  const nextMeetingMemoMs = readJobDurationMs(nextMeetingMemoJob, null);
  const llmInputTokens = readPositiveNumber(conversationMeta.llmInputTokensActual);
  const llmCachedInputTokens = readNonNegativeNumber(conversationMeta.llmCachedInputTokensActual);
  const llmOutputTokens = readPositiveNumber(conversationMeta.llmOutputTokensActual);
  const llmApiCalls = readPositiveNumber(conversationMeta.llmApiCallsFinalize);
  const llmCostUsd = readNonNegativeNumber(conversationMeta.llmCostUsd);
  const llmCostJpy = readNonNegativeNumber(conversationMeta.llmCostJpy);
  const llmCostUsdJpyRate = readNonNegativeNumber(conversationMeta.llmCostUsdJpyRate);
  const finalizeQueueLagSeconds = toRoundedSecondsOrNull(readNonNegativeNumber(finalizeJob?.lastQueueLagMs ?? null));
  const llmCachedInputRatio =
    llmInputTokens && llmCachedInputTokens !== null && llmInputTokens > 0
      ? Math.round((llmCachedInputTokens / llmInputTokens) * 1000) / 1000
      : null;
  const traceId =
    String(finalizeJob?.executionId ?? nextMeetingMemoJob?.executionId ?? input.conversationId ?? input.sessionId ?? "").trim() ||
    null;

  const latestKnownFinishedAtMs = [nextMeetingMemoReadyAtMs, logReadyAtMs, transcriptReadyAtMs]
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => right - left)[0] ?? null;

  return {
    traceId,
    pipelineStartedAt: toIsoOrNull(pipelineStartedAtMs),
    transcriptReadyAt: toIsoOrNull(transcriptReadyAtMs),
    logReadyAt: toIsoOrNull(logReadyAtMs),
    nextMeetingMemoReadyAt: toIsoOrNull(nextMeetingMemoReadyAtMs),
    audioSeconds: readTotalAudioSeconds(parts),
    sttPrepareSeconds: readAccumulatedSeconds(parts, "sttPrepareMs"),
    transcriptionSeconds: readTranscriptionSeconds(parts, transcriptReadyAtMs, pipelineStartedAtMs),
    sttWorkerSeconds: readAccumulatedSeconds(parts, "sttTranscribeWorkerMs"),
    sttFinalizeSeconds: readAccumulatedSeconds(parts, "sttFinalizeMs"),
    acceptedToTranscriptSeconds: diffSeconds(transcriptReadyAtMs, pipelineStartedAtMs),
    logGenerationSeconds: toRoundedSecondsOrNull(logGenerationMs),
    transcriptToLogSeconds: diffSeconds(logReadyAtMs, transcriptReadyAtMs),
    nextMeetingMemoSeconds: toRoundedSecondsOrNull(nextMeetingMemoMs),
    logToNextMeetingMemoSeconds: diffSeconds(nextMeetingMemoReadyAtMs, logReadyAtMs),
    totalPipelineSeconds: diffSeconds(latestKnownFinishedAtMs, pipelineStartedAtMs),
    finalizeQueueLagSeconds,
    llmApiCalls,
    llmInputTokens,
    llmCachedInputTokens,
    llmCachedInputRatio,
    llmOutputTokens,
    llmCostUsd,
    llmCostJpy,
    llmCostUsdJpyRate,
  };
}
