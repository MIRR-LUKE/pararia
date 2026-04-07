import { JobStatus, Prisma, SessionPartJobType, SessionPartStatus, SessionPartType, SessionType } from "@prisma/client";
import { transcribeAudioForPipeline } from "@/lib/ai/stt";
import { rm } from "node:fs/promises";
import { getAudioDurationSeconds, normalizeAudioForStt } from "@/lib/audio-processing";
import { materializeStorageFile } from "@/lib/audio-storage";
import { prisma } from "@/lib/db";
import { finalizeLiveTranscriptionPart } from "@/lib/live-session-transcription";
import {
  buildSummaryPreview,
  readSessionPartMeta,
  toSessionPartMetaJson,
} from "@/lib/session-part-meta";
import { toPrismaJson } from "@/lib/prisma-json";
import {
  evaluateDurationGate,
  evaluateTranscriptSubstance,
  getRecordingMaxDurationSeconds,
} from "@/lib/recording/validation";
import {
  ensureConversationForSession,
  updateSessionStatusFromParts,
} from "@/lib/session-service";
import { getAudioExpiryDate } from "@/lib/system-config";
import { preprocessTranscript, preprocessTranscriptWithSegments } from "@/lib/transcript/preprocess";
import { ensureSessionPartReviewedTranscript } from "@/lib/transcript/review";
import {
  enqueueConversationJobs,
  processAllConversationJobs,
} from "@/lib/jobs/conversationJobs";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";

const JOB_EXECUTION_RETRIES = 2;
const activeSessionRuns = new Set<string>();

const MAX_TRANSCRIPTION_RECOVERY_ATTEMPTS = 4;
const MAX_PROMOTION_RECOVERY_ATTEMPTS = 5;

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

type SessionPartRecoveryPayload = {
  id: string;
  sessionId: string;
  status: SessionPartStatus;
  rawTextOriginal: string | null;
  rawTextCleaned: string | null;
  qualityMetaJson: Record<string, unknown> | null;
  session: {
    conversation: {
      status: string;
    } | null;
  };
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

function isRecoverablePromotionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (isRetryableJobError(message)) return true;
  return /(Invalid prisma\.|Unknown arg|column .* does not exist|migration|schema|artifactJson|maxAttempts|executionId|nextRetryAt|leaseExpiresAt)/i.test(
    message
  );
}

function isRecoverableTranscriptionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (isRetryableJobError(message)) return true;
  return /empty transcript/i.test(message);
}

function partHasTranscript(part: Pick<SessionPartPayload, "rawTextOriginal" | "rawTextCleaned">) {
  return Boolean(part.rawTextCleaned?.trim() || part.rawTextOriginal?.trim());
}

function getSessionPartRecoveryPlan(
  jobType: SessionPartJobType,
  error: unknown,
  attempts: number
) {
  if (jobType === SessionPartJobType.PROMOTE_SESSION) {
    const recoverable = isRecoverablePromotionErrorMessage(error);
    return {
      recoverable,
      canRetry: recoverable && attempts < MAX_PROMOTION_RECOVERY_ATTEMPTS,
      maxAttempts: MAX_PROMOTION_RECOVERY_ATTEMPTS,
    };
  }

  const recoverable = isRecoverableTranscriptionErrorMessage(error);
  return {
    recoverable,
    canRetry: recoverable && attempts < MAX_TRANSCRIPTION_RECOVERY_ATTEMPTS,
    maxAttempts: MAX_TRANSCRIPTION_RECOVERY_ATTEMPTS,
  };
}

async function markPartRecovering(
  part: SessionPartPayload,
  jobType: SessionPartJobType,
  errorMessage: string,
  attempts: number,
  maxAttempts: number
) {
  const promotionRetry = jobType === SessionPartJobType.PROMOTE_SESSION && partHasTranscript(part);
  const retryQueuedAt = new Date().toISOString();

  await prisma.sessionPart.update({
    where: { id: part.id },
    data: {
      status: promotionRetry ? SessionPartStatus.READY : SessionPartStatus.TRANSCRIBING,
      qualityMetaJson: toSessionPartMetaJson(part.qualityMetaJson, {
        pipelineStage: promotionRetry ? "GENERATING" : "TRANSCRIBING",
        errorSource: undefined,
        lastError: null,
        retryPending: true,
        retryAttempt: attempts,
        retryMaxAttempts: maxAttempts,
        lastRecoverableError: errorMessage,
        lastRecoverableErrorAt: retryQueuedAt,
        promotionRetryQueuedAt: promotionRetry ? retryQueuedAt : undefined,
        transcriptionRetryQueuedAt: promotionRetry ? undefined : retryQueuedAt,
      }),
    },
  });
  await updateSessionStatusFromParts(part.sessionId);
}

async function transcribeStoredFile(part: SessionPartPayload) {
  if (!part.storageUrl) {
    throw new Error("session part storage is missing");
  }

  const startedAt = Date.now();
  let localAudio: Awaited<ReturnType<typeof materializeStorageFile>> | null = null;
  let liveMeta =
    part.qualityMetaJson && typeof part.qualityMetaJson === "object" && !Array.isArray(part.qualityMetaJson)
      ? ({ ...part.qualityMetaJson } as Record<string, unknown>)
      : {};
  liveMeta = {
    ...liveMeta,
    transcriptionPhase: "PREPARING_STT",
    transcriptionPhaseUpdatedAt: new Date().toISOString(),
    sttEngine: "faster-whisper",
  };
  let metaPersistChain = Promise.resolve();
  const queueMetaPatch = (patch: Record<string, unknown>) => {
    liveMeta = {
      ...liveMeta,
      ...patch,
    };
    const snapshot = { ...liveMeta };
    metaPersistChain = metaPersistChain
      .then(async () => {
        await prisma.sessionPart.update({
          where: { id: part.id },
          data: {
            qualityMetaJson: toPrismaJson(snapshot),
          },
        });
      })
      .catch((error) => {
        console.error("[sessionPartJobs] Failed to persist transcription progress meta:", error);
      });
    return metaPersistChain;
  };

  await queueMetaPatch({});

  let stt;
  let normalizedRetryUsed = false;
  let measuredDurationSeconds: number | null = null;
  try {
    localAudio = await materializeStorageFile(part.storageUrl, {
      fileName: part.fileName,
    });
    measuredDurationSeconds = await getAudioDurationSeconds(localAudio.filePath).catch(() => 0);
    const maxDurationSeconds = getRecordingMaxDurationSeconds(part.sessionType);
    const durationGate = evaluateDurationGate(measuredDurationSeconds, {
      maxSeconds: maxDurationSeconds,
      rejectUnknown: true,
      tooLongMessageJa:
        part.sessionType === SessionType.LESSON_REPORT
          ? "指導報告のチェックイン / チェックアウト音声は1回10分までです。音声を分割して保存してください。"
          : "面談音声は1回60分までです。音声を分割して保存してください。",
      unknownMessageJa:
        part.sessionType === SessionType.LESSON_REPORT
          ? "指導報告音声の長さを確認できませんでした。10分以内のファイルを選び直してください。"
          : "面談音声の長さを確認できませんでした。60分以内のファイルを選び直してください。",
    });
    if (!durationGate.ok) {
      const gateError = new Error(durationGate.messageJa) as Error & {
        durationGate?: typeof durationGate;
      };
      gateError.durationGate = durationGate;
      throw gateError;
    }

    await queueMetaPatch({
      transcriptionPhase: "TRANSCRIBING_EXTERNAL",
      transcriptionPhaseUpdatedAt: new Date().toISOString(),
    });
    stt = await transcribeAudioForPipeline({
      filePath: localAudio.filePath,
      filename: part.fileName || "audio.webm",
      mimeType: part.mimeType || "audio/webm",
      language: "ja",
    });
  } catch (error) {
    if (!isUnsupportedAudioError(error)) throw error;
    if (!localAudio) throw error;
    const normalizedPath = `${localAudio.filePath}.stt-normalized.m4a`;
    try {
      await normalizeAudioForStt(localAudio.filePath, normalizedPath);
      await queueMetaPatch({
        transcriptionPhase: "TRANSCRIBING_EXTERNAL",
        transcriptionPhaseUpdatedAt: new Date().toISOString(),
      });
      stt = await transcribeAudioForPipeline({
        filePath: normalizedPath,
        filename: "audio-normalized.m4a",
        mimeType: "audio/mp4",
        language: "ja",
      });
      normalizedRetryUsed = true;
    } finally {
      await rm(normalizedPath, { force: true }).catch(() => {});
    }
  } finally {
    await localAudio?.cleanup().catch(() => {});
    await metaPersistChain;
  }

  const pre =
    stt.segments.length > 0
      ? preprocessTranscriptWithSegments(stt.rawTextOriginal, stt.segments ?? [])
      : preprocessTranscript(stt.rawTextOriginal);
  await queueMetaPatch({
    transcriptionPhase: "FINALIZING_TRANSCRIPT",
    transcriptionPhaseUpdatedAt: new Date().toISOString(),
  });
  await metaPersistChain;

  return {
    pre,
    segments: stt.segments ?? [],
    qualityMeta: {
      ...(part.qualityMetaJson ?? {}),
      sttSeconds: Math.round((Date.now() - startedAt) / 1000),
      sttModel: stt.meta.model,
      sttResponseFormat: stt.meta.responseFormat,
      sttDevice: stt.meta.device,
      sttComputeType: stt.meta.computeType,
      sttPipeline: stt.meta.pipeline,
      sttBatchSize: stt.meta.batchSize,
      sttGpuName: stt.meta.gpuName,
      sttGpuComputeCapability: stt.meta.gpuComputeCapability,
      sttGpuSnapshotBefore: stt.meta.gpuSnapshotBefore,
      sttGpuSnapshotAfter: stt.meta.gpuSnapshotAfter,
      sttGpuMonitor: stt.meta.gpuMonitor,
      sttRecoveryUsed: stt.meta.recoveryUsed,
      sttFallbackUsed: stt.meta.fallbackUsed,
      sttAttemptCount: stt.meta.attemptCount,
      sttSegmentCount: stt.meta.segmentCount,
      sttSpeakerCount: stt.meta.speakerCount,
      sttQualityWarnings: stt.meta.qualityWarnings,
      sttNormalizedRetryUsed: normalizedRetryUsed,
      audioDurationSeconds: measuredDurationSeconds,
      transcriptionPhase: "FINALIZING_TRANSCRIPT",
      sttEngine: "faster-whisper",
    },
  };
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
        retryPending: false,
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
        errorSource: "TRANSCRIPTION",
        lastError: errorMessage,
        retryPending: false,
      }),
    },
  });
  await updateSessionStatusFromParts(part.sessionId);
}

async function markPartPromotionError(part: SessionPartPayload, errorMessage: string) {
  const meta = readSessionPartMeta(part.qualityMetaJson);
  await prisma.sessionPart.update({
    where: { id: part.id },
    data: {
      status: SessionPartStatus.ERROR,
      qualityMetaJson: toSessionPartMetaJson(meta, {
        pipelineStage: "ERROR",
        errorSource: "PROMOTION",
        lastError: errorMessage,
        lastPromotionErrorAt: new Date().toISOString(),
        retryPending: false,
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
      reviewedText: null,
      reviewState: "NONE",
      rawSegments: toPrismaJson(input.rawSegments),
      qualityMetaJson: toSessionPartMetaJson(input.part.qualityMetaJson, {
        ...input.qualityMeta,
        lastError: null,
        errorSource: undefined,
        pipelineStage: "READY",
        retryPending: false,
        summaryPreview: buildSummaryPreview(input.rawTextCleaned || input.rawTextOriginal),
        lastCompletedAt: new Date().toISOString(),
      }),
      transcriptExpiresAt: getAudioExpiryDate(),
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
  let transcription;
  try {
    transcription = await transcribeStoredFile(part);
  } catch (error: any) {
    if (error?.durationGate && !error.durationGate.ok) {
      await markPartRejected(part, error.durationGate.messageJa, {
        validationRejection: {
          code: error.durationGate.code,
          messageJa: error.durationGate.messageJa,
          durationSeconds: error.durationGate.durationSeconds,
          maxAllowedSeconds: "maxAllowedSeconds" in error.durationGate ? error.durationGate.maxAllowedSeconds : undefined,
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
            code: error.durationGate.code,
          }),
        },
      });
      return;
    }
    throw error;
  }

  const { pre, segments, qualityMeta } = transcription;

  const substance = evaluateTranscriptSubstance(pre.displayTranscript || pre.rawTextOriginal);

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
    rawTextCleaned: pre.displayTranscript,
    rawSegments: segments,
    qualityMeta,
  });
  await ensureSessionPartReviewedTranscript(part.id);
  await enqueuePromotionJob(part.id);

  await prisma.sessionPartJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      outputJson: toPrismaJson({
        rawLength: pre.rawTextOriginal.length,
        displayLength: pre.displayTranscript.length,
        segmentCount: segments.length,
        sttEngine: qualityMeta.sttEngine ?? "faster-whisper",
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
  const substance = evaluateTranscriptSubstance(finalized.displayTranscript || finalized.rawTextOriginal);

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
    rawTextCleaned: finalized.displayTranscript,
    rawSegments: finalized.rawSegments,
    qualityMeta: finalized.qualityMeta,
  });
  await ensureSessionPartReviewedTranscript(part.id);
  await enqueuePromotionJob(part.id);

  await prisma.sessionPartJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      outputJson: toPrismaJson({
        rawLength: finalized.rawTextOriginal.length,
        displayLength: finalized.displayTranscript.length,
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
  if (shouldRunBackgroundJobsInline()) {
    void processAllConversationJobs(conversationId).catch((error) => {
      console.error("[sessionPartJobs] Background conversation processing failed:", error);
    });
  }

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

async function requeueRecoverableTranscriptionJobs(opts?: ProcessSessionPartJobsOptions) {
  const failedJobs = await prisma.sessionPartJob.findMany({
    where: {
      status: JobStatus.ERROR,
      type: {
        in: [SessionPartJobType.TRANSCRIBE_FILE, SessionPartJobType.FINALIZE_LIVE_PART],
      },
      attempts: {
        lt: MAX_TRANSCRIPTION_RECOVERY_ATTEMPTS,
      },
      ...(opts?.sessionId
        ? {
            sessionPart: {
              sessionId: opts.sessionId,
            },
          }
        : {}),
    },
    select: {
      id: true,
      lastError: true,
      sessionPart: {
        select: {
          id: true,
          sessionId: true,
          qualityMetaJson: true,
        },
      },
    },
  });

  for (const failedJob of failedJobs) {
    if (!isRecoverableTranscriptionErrorMessage(failedJob.lastError ?? "")) continue;

    const queued = await prisma.sessionPartJob.updateMany({
      where: {
        id: failedJob.id,
        status: JobStatus.ERROR,
      },
      data: {
        status: JobStatus.QUEUED,
        lastError: null,
        outputJson: Prisma.DbNull,
        costMetaJson: Prisma.DbNull,
        startedAt: null,
        finishedAt: null,
      },
    });
    if (queued.count !== 1) continue;

    await prisma.sessionPart.update({
      where: { id: failedJob.sessionPart.id },
      data: {
        status: SessionPartStatus.TRANSCRIBING,
        qualityMetaJson: toSessionPartMetaJson(failedJob.sessionPart.qualityMetaJson, {
          pipelineStage: "TRANSCRIBING",
          errorSource: undefined,
          lastError: null,
          retryPending: true,
          transcriptionRetryQueuedAt: new Date().toISOString(),
        }),
      },
    });
    await updateSessionStatusFromParts(failedJob.sessionPart.sessionId);
  }
}

async function requeueRecoverablePromotionJobs(opts?: ProcessSessionPartJobsOptions) {
  const failedJobs = await prisma.sessionPartJob.findMany({
    where: {
      status: JobStatus.ERROR,
      type: SessionPartJobType.PROMOTE_SESSION,
      attempts: {
        lt: MAX_PROMOTION_RECOVERY_ATTEMPTS,
      },
      ...(opts?.sessionId
        ? {
            sessionPart: {
              sessionId: opts.sessionId,
            },
          }
        : {}),
    },
    select: {
      id: true,
      lastError: true,
      sessionPart: {
        select: {
          id: true,
          sessionId: true,
          status: true,
          rawTextOriginal: true,
          rawTextCleaned: true,
          qualityMetaJson: true,
          session: {
            select: {
              conversation: {
                select: {
                  status: true,
                },
              },
            },
          },
        },
      },
    },
  });

  for (const failedJob of failedJobs) {
    if (!isRecoverablePromotionErrorMessage(failedJob.lastError ?? "")) continue;
    const part = failedJob.sessionPart as SessionPartRecoveryPayload;
    if (!partHasTranscript(part)) continue;
    if (part.session.conversation?.status === "DONE") continue;

    const queued = await prisma.sessionPartJob.updateMany({
      where: {
        id: failedJob.id,
        status: JobStatus.ERROR,
      },
      data: {
        status: JobStatus.QUEUED,
        lastError: null,
        outputJson: Prisma.DbNull,
        costMetaJson: Prisma.DbNull,
        startedAt: null,
        finishedAt: null,
      },
    });
    if (queued.count !== 1) continue;

    await prisma.sessionPart.update({
      where: { id: part.id },
      data: {
        status: SessionPartStatus.READY,
        qualityMetaJson: toSessionPartMetaJson(part.qualityMetaJson, {
          pipelineStage: "GENERATING",
          errorSource: undefined,
          lastError: null,
          retryPending: true,
          promotionRetryQueuedAt: new Date().toISOString(),
        }),
      },
    });
    await updateSessionStatusFromParts(part.sessionId);
  }
}

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
  await requeueRecoverableTranscriptionJobs(opts);
  await requeueRecoverablePromotionJobs(opts);

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
        const currentJob = await prisma.sessionPartJob.findUnique({
          where: { id: job.id },
          select: { attempts: true },
        });
        const attempts = currentJob?.attempts ?? 1;
        const recovery = getSessionPartRecoveryPlan(job.type, error, attempts);
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
          if (recovery.canRetry && (job.type !== SessionPartJobType.PROMOTE_SESSION || partHasTranscript(part))) {
            await markPartRecovering(part, job.type, message, attempts, recovery.maxAttempts).catch(() => {});
          } else if (job.type === SessionPartJobType.PROMOTE_SESSION && partHasTranscript(part)) {
            await markPartPromotionError(part, message).catch(() => {});
          } else {
            await markPartExecutionError(part, message).catch(() => {});
          }
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
