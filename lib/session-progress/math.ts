import { readSessionPartMeta } from "@/lib/session-part-meta";
import {
  getSessionProgressProcessingErrorCopy,
  getSessionProgressTranscriptionPhaseCopy,
} from "./registry";
import type { SessionProgressConversationLike, SessionProgressPartLike, SessionProgressState } from "./types";

export type DetailedTranscriptionCopy = {
  statusLabel: string;
  title: string;
  description: string;
  value: number;
};

export type SessionProcessingErrorState = {
  title: string;
  description: string;
  stepIndex: number;
};

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function toTimestamp(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function readNonNegativeNumber(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

export function progressFromRatio(start: number, end: number, ratio: number) {
  return clamp(Math.round(start + (end - start) * ratio), start, end);
}

export function estimateElapsedProgress(start: number, end: number, startedAt: Date | string | null | undefined, expectedMs: number) {
  const startedAtMs = toTimestamp(startedAt);
  if (!startedAtMs) return Math.round((start + end) / 2);
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const safeExpectedMs = Math.max(1_000, expectedMs);
  const ratio = clamp(elapsedMs / safeExpectedMs, 0.08, 0.94);
  return progressFromRatio(start, end, ratio);
}

export function estimateValue(steps: SessionProgressState["progress"]["steps"]) {
  if (steps.every((step) => step.status === "complete")) return 100;
  const total = Math.max(steps.length, 1);
  const completed = steps.filter((step) => step.status === "complete").length;
  const active = steps.some((step) => step.status === "active");
  return Math.max(8, Math.min(96, Math.round(((completed + (active ? 0.64 : 0.25)) / total) * 100)));
}

export function estimatePartProgress(part: SessionProgressPartLike | null, start: number, end: number) {
  if (!part) return start;
  const meta = readSessionPartMeta(part.qualityMetaJson);
  const liveChunkCount = readNonNegativeNumber(meta.liveChunkCount);
  const liveReadyChunkCount = readNonNegativeNumber(meta.liveReadyChunkCount) ?? 0;
  const liveErrorChunkCount = readNonNegativeNumber(meta.liveErrorChunkCount) ?? 0;

  if (liveChunkCount && liveChunkCount > 0) {
    const completedChunks = clamp(liveReadyChunkCount + liveErrorChunkCount, 0, liveChunkCount);
    const ratio = clamp(completedChunks / liveChunkCount, 0.08, 0.96);
    return progressFromRatio(start, end, ratio);
  }

  const audioDurationSeconds =
    readNonNegativeNumber(meta.audioDurationSeconds) ?? readNonNegativeNumber(meta.liveDurationSeconds);
  const expectedMs = audioDurationSeconds
    ? clamp(Math.round(audioDurationSeconds * 18), 12_000, 120_000)
    : 24_000;

  return estimateElapsedProgress(
    start,
    end,
    (meta.lastQueuedAt as string | undefined) ?? (meta.lastAcceptedAt as string | undefined),
    expectedMs
  );
}

export function estimateConversationProgress(conversation: SessionProgressConversationLike | null | undefined, start: number, end: number) {
  const finalizeJob = conversation?.jobs?.find((job) => job.type === "FINALIZE") ?? null;
  if (!finalizeJob) {
    return clamp(start + 6, start, end);
  }
  if (finalizeJob.status === "DONE") return end;
  if (finalizeJob.status === "QUEUED") return clamp(start + 8, start, end);
  if (finalizeJob.status === "ERROR") return clamp(end - 4, start, end);
  return estimateElapsedProgress(start, end, finalizeJob.startedAt ?? conversation?.createdAt, 16_000);
}

export function buildDetailedTranscriptionCopy(
  part: SessionProgressPartLike | null,
  start: number,
  end: number,
  options: {
    unitLabel: string;
    acceptedTitle: string;
    acceptedDescription: string;
  }
): DetailedTranscriptionCopy {
  if (!part) {
    return {
      statusLabel: "文字起こし中",
      title: options.acceptedTitle,
      description: options.acceptedDescription,
      value: start,
    };
  }

  const meta = readSessionPartMeta(part.qualityMetaJson);
  const phase = typeof meta.transcriptionPhase === "string" ? meta.transcriptionPhase : null;
  const phaseUpdatedAt =
    (typeof meta.transcriptionPhaseUpdatedAt === "string" ? meta.transcriptionPhaseUpdatedAt : null) ??
    (typeof meta.lastQueuedAt === "string" ? meta.lastQueuedAt : null);

  if (phase === "PREPARING_STT") {
    const phaseCopy = getSessionProgressTranscriptionPhaseCopy("PREPARING_STT");
    return {
      statusLabel: phaseCopy.statusLabel,
      title: phaseCopy.title,
      description: phaseCopy.description,
      value: estimateElapsedProgress(start, Math.max(start + 8, end - 12), phaseUpdatedAt, 45_000),
    };
  }

  if (phase === "FINALIZING_TRANSCRIPT") {
    const phaseCopy = getSessionProgressTranscriptionPhaseCopy("FINALIZING_TRANSCRIPT");
    return {
      statusLabel: phaseCopy.statusLabel,
      title: phaseCopy.title,
      description: phaseCopy.description,
      value: estimateElapsedProgress(Math.max(start + 10, start), end, phaseUpdatedAt, 9_000),
    };
  }

  return {
    statusLabel: "文字起こし中",
    title: `${options.unitLabel}を文字起こし中です`,
    description: "STT worker で音声を文字起こししています。音声が長いほど時間はかかりますが、このまま閉じても大丈夫です。",
    value: estimatePartProgress(part, start, end),
  };
}

export function extractRejectedMessage(parts: SessionProgressPartLike[]) {
  for (const part of parts) {
    const meta = readSessionPartMeta(part.qualityMetaJson);
    const rejectionMessage = meta.validationRejection?.messageJa?.trim();
    if (rejectionMessage) return rejectionMessage;
  }
  return null;
}

export function partHasTranscript(part: SessionProgressPartLike, meta: ReturnType<typeof readSessionPartMeta>) {
  return Boolean(meta.summaryPreview || meta.lastCompletedAt || part.status === "READY");
}

export function extractProcessingErrorState(parts: SessionProgressPartLike[]): SessionProcessingErrorState | null {
  for (const part of parts) {
    const meta = readSessionPartMeta(part.qualityMetaJson);
    const rejectionMessage = meta.validationRejection?.messageJa?.trim();
    if (rejectionMessage) {
      return {
        title: "文字起こしで問題が発生しました",
        description: rejectionMessage,
        stepIndex: 1,
      };
    }
    const lastError = typeof meta.lastError === "string" ? meta.lastError.trim() : "";
    if (!lastError) continue;
    const isPostTranscriptionFailure = meta.errorSource === "PROMOTION" || partHasTranscript(part, meta);
    const detail = getSessionProgressProcessingErrorCopy(lastError, isPostTranscriptionFailure);
    return {
      title: detail.title,
      description: detail.description,
      stepIndex: detail.stepIndex,
    };
  }
  return null;
}
