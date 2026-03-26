import path from "node:path";
import { JobStatus, Prisma, SessionPartJobType, SessionPartStatus, SessionPartType, SessionType } from "@prisma/client";
import { transcribeAudioForPipeline } from "@/lib/ai/stt";
import {
  cleanupChunkDirectory,
  getAudioDurationMs,
  guessAudioMimeType,
  normalizeAudioForStt,
  splitAudioIntoChunks,
} from "@/lib/audio-chunking";
import { prisma } from "@/lib/db";
import { finalizeLiveTranscriptionPart } from "@/lib/live-session-transcription";
import {
  buildSummaryPreview,
  readSessionPartMeta,
  toSessionPartMetaJson,
} from "@/lib/session-part-meta";
import { toPrismaJson } from "@/lib/prisma-json";
import {
  evaluateTranscriptSubstance,
} from "@/lib/recording/validation";
import {
  ensureConversationForSession,
  updateSessionStatusFromParts,
} from "@/lib/session-service";
import { readSessionPartUpload } from "@/lib/session-part-storage";
import { preprocessTranscript, preprocessTranscriptWithSegments } from "@/lib/transcript/preprocess";
import {
  enqueueConversationJobs,
  processAllConversationJobs,
} from "@/lib/jobs/conversationJobs";

const JOB_EXECUTION_RETRIES = 2;
const activeSessionRuns = new Set<string>();

function readClampedEnvInt(names: string[], fallback: number, min: number, max: number) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    return Math.max(min, Math.min(max, Math.floor(value)));
  }
  return Math.max(min, Math.min(max, Math.floor(fallback)));
}

const FILE_SPLIT_MIN_SECONDS = readClampedEnvInt(["FILE_SPLIT_MIN_SECONDS"], 75, 60, 300);
const FILE_SPLIT_CHUNK_SECONDS_INTERVIEW = readClampedEnvInt(
  ["FILE_SPLIT_CHUNK_SECONDS_INTERVIEW", "FILE_SPLIT_CHUNK_SECONDS"],
  60,
  20,
  120
);
const FILE_SPLIT_CHUNK_SECONDS_LESSON = readClampedEnvInt(
  ["FILE_SPLIT_CHUNK_SECONDS_LESSON", "FILE_SPLIT_CHUNK_SECONDS"],
  45,
  20,
  120
);
const FILE_SPLIT_CONCURRENCY_INTERVIEW = readClampedEnvInt(
  ["FILE_SPLIT_CONCURRENCY_INTERVIEW", "FILE_SPLIT_CONCURRENCY"],
  8,
  1,
  8
);
const FILE_SPLIT_CONCURRENCY_LESSON = readClampedEnvInt(
  ["FILE_SPLIT_CONCURRENCY_LESSON", "FILE_SPLIT_CONCURRENCY"],
  8,
  1,
  8
);

function isUnsupportedAudioError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Audio file might be corrupted or unsupported|invalid_value|unsupported/i.test(message);
}

type SessionPartJobPayload = {
  id: string;
  sessionPartId: string;
  type: SessionPartJobType;
};

type SessionPartPayload = {
  id: string;
  sessionId: string;
  partType: SessionPartType;
  status: SessionPartStatus;
  sourceType: string;
  fileName: string | null;
  mimeType: string | null;
  byteSize: number | null;
  storageUrl: string | null;
  rawTextOriginal: string | null;
  rawTextCleaned: string | null;
  rawSegments: any[];
  qualityMetaJson: Record<string, unknown> | null;
  sessionType: SessionType;
};

function waitForJobRetry(attempt: number) {
  const base = Math.min(3500, 500 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 200);
  return new Promise((resolve) => setTimeout(resolve, base + jitter));
}

function isRetryableJobError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(429|500|502|503|504|timeout|temporar|network|ECONNRESET|ETIMEDOUT|rate limit)/i.test(message);
}

function offsetSegments(segments: any[], offsetMs: number) {
  const offsetSeconds = offsetMs / 1000;
  return segments.map((segment) => ({
    ...segment,
    start: typeof segment?.start === "number" ? segment.start + offsetSeconds : segment?.start,
    end: typeof segment?.end === "number" ? segment.end + offsetSeconds : segment?.end,
  }));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length || 1);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function transcribeStoredFile(part: SessionPartPayload) {
  if (!part.storageUrl) {
    throw new Error("session part storage is missing");
  }

  const durationSeconds =
    typeof part.qualityMetaJson?.audioDurationSeconds === "number"
      ? Number(part.qualityMetaJson.audioDurationSeconds)
      : null;
  const splitChunkSeconds =
    part.sessionType === SessionType.LESSON_REPORT
      ? FILE_SPLIT_CHUNK_SECONDS_LESSON
      : FILE_SPLIT_CHUNK_SECONDS_INTERVIEW;
  const splitConcurrency =
    part.sessionType === SessionType.LESSON_REPORT
      ? FILE_SPLIT_CONCURRENCY_LESSON
      : FILE_SPLIT_CONCURRENCY_INTERVIEW;
  const shouldSplit = durationSeconds !== null && Number.isFinite(durationSeconds) && durationSeconds >= FILE_SPLIT_MIN_SECONDS;
  const startedAt = Date.now();

  if (!shouldSplit) {
    const buffer = await readSessionPartUpload(part.storageUrl);
    let stt;
    let normalizedRetryUsed = false;
    try {
      stt = await transcribeAudioForPipeline({
        buffer,
        filename: part.fileName || "audio.webm",
        mimeType: part.mimeType || "audio/webm",
        language: "ja",
      });
    } catch (error) {
      if (!isUnsupportedAudioError(error)) throw error;
      const normalizedPath = `${part.storageUrl}.stt-normalized.m4a`;
      try {
        await normalizeAudioForStt(part.storageUrl, normalizedPath);
        const normalizedBuffer = await readSessionPartUpload(normalizedPath);
        stt = await transcribeAudioForPipeline({
          buffer: normalizedBuffer,
          filename: "audio-normalized.m4a",
          mimeType: "audio/mp4",
          language: "ja",
        });
        normalizedRetryUsed = true;
      } finally {
        await cleanupChunkDirectory(normalizedPath);
      }
    }
    const pre =
      stt.segments.length > 0
        ? preprocessTranscriptWithSegments(stt.rawTextOriginal, stt.segments ?? [])
        : preprocessTranscript(stt.rawTextOriginal);
    return {
      pre,
      segments: stt.segments ?? [],
      qualityMeta: {
        ...(part.qualityMetaJson ?? {}),
        sttSeconds: Math.round((Date.now() - startedAt) / 1000),
        sttModel: stt.meta.model,
        sttResponseFormat: stt.meta.responseFormat,
        sttRecoveryUsed: stt.meta.recoveryUsed,
        sttAttemptCount: stt.meta.attemptCount,
        sttSegmentCount: stt.meta.segmentCount,
        sttSpeakerCount: stt.meta.speakerCount,
        sttQualityWarnings: stt.meta.qualityWarnings,
        fileSplitUsed: false,
        sttNormalizedRetryUsed: normalizedRetryUsed,
      },
    };
  }

  const chunkDir = `${part.storageUrl}.chunks`;
  const chunkPaths = await splitAudioIntoChunks(part.storageUrl, chunkDir, splitChunkSeconds);
  const durationsMs = await Promise.all(chunkPaths.map((chunkPath) => getAudioDurationMs(chunkPath)));
  const offsetsMs: number[] = [];
  let cursorMs = 0;
  for (const durationMs of durationsMs) {
    offsetsMs.push(cursorMs);
    cursorMs += durationMs;
  }

  try {
    const results = await mapWithConcurrency(chunkPaths, splitConcurrency, async (chunkPath, index) => {
      const chunkStartedAt = Date.now();
      const buffer = await readSessionPartUpload(chunkPath);
      const stt = await transcribeAudioForPipeline({
        buffer,
        filename: path.basename(chunkPath) || `chunk-${index}.m4a`,
        mimeType: guessAudioMimeType(chunkPath),
        language: "ja",
      });
      const rawSegments = offsetSegments(stt.segments ?? [], offsetsMs[index] ?? 0);
      const pre =
        rawSegments.length > 0
          ? preprocessTranscriptWithSegments(stt.rawTextOriginal, rawSegments)
          : preprocessTranscript(stt.rawTextOriginal);
      return {
        pre,
        stt,
        rawSegments,
        wallClockSeconds: Math.round((Date.now() - chunkStartedAt) / 1000),
      };
    });

    const combinedOriginal = results
      .map((result) => String(result.pre.rawTextOriginal ?? "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    const combinedSegments = results.flatMap((result) => result.rawSegments);
    const pre =
      combinedSegments.length > 0
        ? preprocessTranscriptWithSegments(combinedOriginal, combinedSegments)
        : preprocessTranscript(combinedOriginal);
    const speakerCount = new Set(
      combinedSegments
        .map((segment) => (typeof segment?.speaker === "string" ? segment.speaker.trim() : ""))
        .filter(Boolean)
    ).size;
    const qualityWarnings = Array.from(
      new Set(results.flatMap((result) => result.stt.meta.qualityWarnings ?? []))
    );
    return {
      pre,
      segments: combinedSegments,
      qualityMeta: {
        ...(part.qualityMetaJson ?? {}),
        sttSeconds: Math.round((Date.now() - startedAt) / 1000),
        sttModel: results[0]?.stt.meta.model ?? "gpt-4o-transcribe-diarize",
        sttResponseFormat: results[0]?.stt.meta.responseFormat ?? "diarized_json",
        sttRecoveryUsed: results.some((result) => result.stt.meta.recoveryUsed),
        sttAttemptCount: results.reduce((total, result) => total + Number(result.stt.meta.attemptCount ?? 1), 0),
        sttSegmentCount: combinedSegments.length,
        sttSpeakerCount: speakerCount,
        sttQualityWarnings: qualityWarnings,
        fileSplitUsed: true,
        fileChunkCount: chunkPaths.length,
        fileChunkSeconds: splitChunkSeconds,
        fileChunkConcurrency: splitConcurrency,
        fileChunkWallClockSeconds: results.map((result) => result.wallClockSeconds),
      },
    };
  } finally {
    await cleanupChunkDirectory(chunkDir);
  }
}

async function loadSessionPart(job: SessionPartJobPayload): Promise<SessionPartPayload> {
  const part = await prisma.sessionPart.findUnique({
    where: { id: job.sessionPartId },
    include: {
      session: {
        select: {
          id: true,
          type: true,
        },
      },
    },
  });
  if (!part?.session) throw new Error("session part not found");
  return {
    id: part.id,
    sessionId: part.sessionId,
    partType: part.partType,
    status: part.status,
    sourceType: part.sourceType,
    fileName: part.fileName,
    mimeType: part.mimeType,
    byteSize: part.byteSize,
    storageUrl: part.storageUrl,
    rawTextOriginal: part.rawTextOriginal,
    rawTextCleaned: part.rawTextCleaned,
    rawSegments: Array.isArray(part.rawSegments) ? (part.rawSegments as any[]) : [],
    qualityMetaJson:
      part.qualityMetaJson && typeof part.qualityMetaJson === "object" && !Array.isArray(part.qualityMetaJson)
        ? (part.qualityMetaJson as Record<string, unknown>)
        : null,
    sessionType: part.session.type,
  };
}

async function markPartRejected(part: SessionPartPayload, message: string, details: Record<string, unknown>) {
  const meta = readSessionPartMeta(part.qualityMetaJson);
  await prisma.sessionPart.update({
    where: { id: part.id },
    data: {
      status: SessionPartStatus.ERROR,
      qualityMetaJson: toSessionPartMetaJson(meta, {
        ...details,
        pipelineStage: "REJECTED",
      }),
    },
  });
  await updateSessionStatusFromParts(part.sessionId);
  return { rejected: true, message };
}

async function markPartExecutionError(part: SessionPartPayload, errorMessage: string) {
  const meta = readSessionPartMeta(part.qualityMetaJson);
  await prisma.sessionPart.update({
    where: { id: part.id },
    data: {
      status: SessionPartStatus.ERROR,
      qualityMetaJson: toSessionPartMetaJson(meta, {
        pipelineStage: "ERROR",
        lastError: errorMessage,
      }),
    },
  });
  await updateSessionStatusFromParts(part.sessionId);
}

async function markPartReady(input: {
  part: SessionPartPayload;
  fileName?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  storageUrl?: string | null;
  rawTextOriginal: string;
  rawTextCleaned: string;
  rawSegments: any[];
  qualityMeta: Record<string, unknown>;
}) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  await prisma.sessionPart.update({
    where: { id: input.part.id },
    data: {
      status: SessionPartStatus.READY,
      fileName: input.fileName ?? input.part.fileName,
      mimeType: input.mimeType ?? input.part.mimeType,
      byteSize: input.byteSize ?? input.part.byteSize,
      storageUrl: input.storageUrl ?? input.part.storageUrl,
      rawTextOriginal: input.rawTextOriginal,
      rawTextCleaned: input.rawTextCleaned,
      rawSegments: toPrismaJson(input.rawSegments),
      qualityMetaJson: toSessionPartMetaJson(input.part.qualityMetaJson, {
        ...input.qualityMeta,
        lastError: null,
        pipelineStage: "READY",
        summaryPreview: buildSummaryPreview(input.rawTextCleaned || input.rawTextOriginal),
        lastCompletedAt: new Date().toISOString(),
      }),
      transcriptExpiresAt: expiresAt,
    },
  });
  await updateSessionStatusFromParts(input.part.sessionId);
}

async function enqueuePromotionJob(sessionPartId: string) {
  return prisma.sessionPartJob.upsert({
    where: {
      sessionPartId_type: {
        sessionPartId,
        type: SessionPartJobType.PROMOTE_SESSION,
      },
    },
    update: {
      status: JobStatus.QUEUED,
      lastError: null,
      outputJson: Prisma.DbNull,
      costMetaJson: Prisma.DbNull,
      startedAt: null,
      finishedAt: null,
    },
    create: {
      sessionPartId,
      type: SessionPartJobType.PROMOTE_SESSION,
      status: JobStatus.QUEUED,
    },
  });
}

async function executeTranscribeFileJob(job: SessionPartJobPayload, part: SessionPartPayload) {
  const { pre, segments, qualityMeta } = await transcribeStoredFile(part);

  const substance = evaluateTranscriptSubstance(pre.rawTextCleaned || pre.rawTextOriginal);

  if (!substance.ok) {
    await markPartRejected(part, substance.messageJa, {
      ...qualityMeta,
      validationRejection: {
        code: substance.code,
        messageJa: substance.messageJa,
        metrics: substance.metrics,
        at: new Date().toISOString(),
      },
    });
    await prisma.sessionPartJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.DONE,
        finishedAt: new Date(),
        outputJson: toPrismaJson({
          rejected: true,
          code: substance.code,
        }),
      },
    });
    return;
  }

  await markPartReady({
    part,
    rawTextOriginal: pre.rawTextOriginal,
    rawTextCleaned: pre.rawTextCleaned,
    rawSegments: segments,
    qualityMeta,
  });
  await enqueuePromotionJob(part.id);

  await prisma.sessionPartJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      outputJson: toPrismaJson({
        rawLength: pre.rawTextOriginal.length,
        cleanedLength: pre.rawTextCleaned.length,
        segmentCount: segments.length,
        fileSplitUsed: qualityMeta.fileSplitUsed === true,
      }),
      costMetaJson: toPrismaJson({
        seconds: Number(qualityMeta.sttSeconds ?? 0),
      }),
    },
  });
}

async function executeFinalizeLivePartJob(job: SessionPartJobPayload, part: SessionPartPayload) {
  const startedAt = Date.now();
  const finalized = await finalizeLiveTranscriptionPart(part.sessionId, part.partType);
  const substance = evaluateTranscriptSubstance(finalized.rawTextCleaned || finalized.rawTextOriginal);

  if (!substance.ok) {
    await markPartRejected(part, substance.messageJa, {
      ...finalized.qualityMeta,
      validationRejection: {
        code: substance.code,
        messageJa: substance.messageJa,
        metrics: substance.metrics,
        at: new Date().toISOString(),
      },
    });
    await prisma.sessionPartJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.DONE,
        finishedAt: new Date(),
        outputJson: toPrismaJson({
          rejected: true,
          code: substance.code,
        }),
      },
    });
    return;
  }

  await markPartReady({
    part,
    fileName: finalized.fileName,
    mimeType: finalized.mimeType,
    byteSize: finalized.byteSize,
    storageUrl: finalized.storageUrl,
    rawTextOriginal: finalized.rawTextOriginal,
    rawTextCleaned: finalized.rawTextCleaned,
    rawSegments: finalized.rawSegments,
    qualityMeta: finalized.qualityMeta,
  });
  await enqueuePromotionJob(part.id);

  await prisma.sessionPartJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      outputJson: toPrismaJson({
        rawLength: finalized.rawTextOriginal.length,
        cleanedLength: finalized.rawTextCleaned.length,
        segmentCount: finalized.rawSegments.length,
      }),
      costMetaJson: toPrismaJson({
        seconds: Math.round((Date.now() - startedAt) / 1000),
      }),
    },
  });
}

async function executePromoteSessionJob(job: SessionPartJobPayload, part: SessionPartPayload) {
  const session = await prisma.session.findUnique({
    where: { id: part.sessionId },
    include: {
      parts: true,
      conversation: {
        select: {
          id: true,
        },
      },
    },
  });
  if (!session) {
    throw new Error("session not found");
  }

  const hasReadyCheckIn = session.parts.some((item) => item.partType === SessionPartType.CHECK_IN && item.status === SessionPartStatus.READY);
  const hasReadyCheckOut = session.parts.some((item) => item.partType === SessionPartType.CHECK_OUT && item.status === SessionPartStatus.READY);
  const readyForGeneration =
    session.type === SessionType.INTERVIEW
      ? session.parts.some((item) => item.partType === SessionPartType.FULL && item.status === SessionPartStatus.READY)
      : hasReadyCheckIn && hasReadyCheckOut;

  if (!readyForGeneration) {
    await prisma.sessionPart.update({
      where: { id: part.id },
      data: {
        qualityMetaJson: toSessionPartMetaJson(part.qualityMetaJson, {
          pipelineStage: "WAITING_COUNTERPART",
        }),
      },
    });
    await prisma.sessionPartJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.DONE,
        finishedAt: new Date(),
        outputJson: toPrismaJson({
          waiting: true,
        }),
      },
    });
    return;
  }

  await prisma.sessionPart.update({
    where: { id: part.id },
    data: {
      qualityMetaJson: toSessionPartMetaJson(part.qualityMetaJson, {
        pipelineStage: "GENERATING",
      }),
    },
  });

  const conversationId = await ensureConversationForSession(part.sessionId);
  await enqueueConversationJobs(conversationId);
  void processAllConversationJobs(conversationId).catch((error) => {
    console.error("[sessionPartJobs] Background conversation processing failed:", error);
  });

  await prisma.sessionPartJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      outputJson: toPrismaJson({
        conversationId,
      }),
    },
  });
}

async function executeJob(job: SessionPartJobPayload) {
  const part = await loadSessionPart(job);
  if (job.type === SessionPartJobType.TRANSCRIBE_FILE) {
    return executeTranscribeFileJob(job, part);
  }
  if (job.type === SessionPartJobType.FINALIZE_LIVE_PART) {
    return executeFinalizeLivePartJob(job, part);
  }
  if (job.type === SessionPartJobType.PROMOTE_SESSION) {
    return executePromoteSessionJob(job, part);
  }
  throw new Error(`unsupported session part job type: ${job.type}`);
}

async function executeJobWithRetry(job: SessionPartJobPayload) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= JOB_EXECUTION_RETRIES; attempt += 1) {
    try {
      return await executeJob(job);
    } catch (error) {
      lastError = error;
      if (attempt >= JOB_EXECUTION_RETRIES || !isRetryableJobError(error)) {
        throw error;
      }
      await waitForJobRetry(attempt);
    }
  }
  throw lastError;
}

type ProcessSessionPartJobsOptions = {
  sessionId?: string;
};

async function claimNextJob(opts?: ProcessSessionPartJobsOptions): Promise<SessionPartJobPayload | null> {
  while (true) {
    const next = await prisma.sessionPartJob.findFirst({
      where: {
        status: JobStatus.QUEUED,
        ...(opts?.sessionId
          ? {
              sessionPart: {
                sessionId: opts.sessionId,
              },
            }
          : {}),
      },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        sessionPartId: true,
        type: true,
      },
    });
    if (!next) return null;
    const claimed = await prisma.sessionPartJob.updateMany({
      where: {
        id: next.id,
        status: JobStatus.QUEUED,
      },
      data: {
        status: JobStatus.RUNNING,
        attempts: { increment: 1 },
        startedAt: new Date(),
        finishedAt: null,
        lastError: null,
      },
    });
    if (claimed.count > 0) {
      return next;
    }
  }
}

export async function enqueueSessionPartJob(sessionPartId: string, type: SessionPartJobType) {
  return prisma.sessionPartJob.upsert({
    where: {
      sessionPartId_type: {
        sessionPartId,
        type,
      },
    },
    update: {
      status: JobStatus.QUEUED,
      lastError: null,
      outputJson: Prisma.DbNull,
      costMetaJson: Prisma.DbNull,
      startedAt: null,
      finishedAt: null,
    },
    create: {
      sessionPartId,
      type,
      status: JobStatus.QUEUED,
    },
  });
}

export async function processQueuedSessionPartJobs(
  limit = 1,
  concurrency = 1,
  opts?: ProcessSessionPartJobsOptions
): Promise<{ processed: number; errors: string[] }> {
  const maxLimit = Math.max(1, Math.floor(limit));
  const maxConcurrency = Math.max(1, Math.floor(concurrency));
  const workerCount = Math.min(maxLimit, maxConcurrency);
  let remaining = maxLimit;
  let processed = 0;
  const errors: string[] = [];

  const reserveSlot = () => {
    if (remaining <= 0) return false;
    remaining -= 1;
    return true;
  };

  const runWorker = async () => {
    while (reserveSlot()) {
      const job = await claimNextJob(opts);
      if (!job) break;
      try {
        await executeJobWithRetry(job);
        processed += 1;
      } catch (error: any) {
        const message = error?.message ?? "unknown session part job error";
        errors.push(message);
        await prisma.sessionPartJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.ERROR,
            lastError: message,
            finishedAt: new Date(),
          },
        });
        const part = await loadSessionPart(job).catch(() => null);
        if (part) {
          await markPartExecutionError(part, message).catch(() => {});
        }
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return { processed, errors };
}

export async function processAllSessionPartJobs(sessionId: string) {
  if (activeSessionRuns.has(sessionId)) {
    return { processed: 0, errors: [] };
  }
  activeSessionRuns.add(sessionId);
  try {
    const pending = await prisma.sessionPartJob.count({
      where: {
        sessionPart: {
          sessionId,
        },
        status: {
          in: [JobStatus.QUEUED, JobStatus.RUNNING],
        },
      },
    });
    const envConcurrency = Number(process.env.SESSION_PART_JOB_CONCURRENCY ?? 2);
    const concurrency = Number.isFinite(envConcurrency) ? Math.max(1, Math.floor(envConcurrency)) : 1;
    const limit = Math.max(4, pending * 2, 2);
    return processQueuedSessionPartJobs(limit, concurrency, { sessionId });
  } finally {
    activeSessionRuns.delete(sessionId);
  }
}
