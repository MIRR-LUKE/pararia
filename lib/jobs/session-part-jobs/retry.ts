import { JobStatus, Prisma, SessionPartJobType, SessionPartStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toSessionPartMetaJson } from "@/lib/session-part-meta";
import { updateSessionStatusFromParts } from "@/lib/session-service";
import { partHasTranscript, type ProcessSessionPartJobsOptions, type SessionPartJobPayload, type SessionPartPayload, type SessionPartRecoveryPayload } from "./shared";

export const MAX_TRANSCRIPTION_RECOVERY_ATTEMPTS = 4;
export const MAX_PROMOTION_RECOVERY_ATTEMPTS = 5;

export type RetryableSessionPart = Pick<
  SessionPartPayload,
  "id" | "sessionId" | "rawTextOriginal" | "rawTextCleaned" | "qualityMetaJson"
>;

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
  return /empty transcript|stale remote worker execution/i.test(message);
}

function resolveRequestedTypes(
  requested: SessionPartJobType[] | null | undefined,
  allowed: SessionPartJobType[]
) {
  if (!requested || requested.length === 0) {
    return allowed;
  }
  return allowed.filter((type) => requested.includes(type));
}

export function getSessionPartRecoveryPlan(jobType: SessionPartJobType, error: unknown, attempts: number) {
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

function waitForJobRetry(attempt: number) {
  const base = Math.min(3500, 500 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 200);
  return new Promise((resolve) => setTimeout(resolve, base + jitter));
}

async function markPartRecovering(part: RetryableSessionPart, jobType: SessionPartJobType, errorMessage: string, attempts: number, maxAttempts: number) {
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

export async function requeueRecoverableTranscriptionJobs(opts?: ProcessSessionPartJobsOptions) {
  const transcriptionTypes = resolveRequestedTypes(opts?.types, [
    SessionPartJobType.TRANSCRIBE_FILE,
    SessionPartJobType.FINALIZE_LIVE_PART,
  ]);
  if (transcriptionTypes.length === 0) {
    return;
  }

  const failedJobs = await prisma.sessionPartJob.findMany({
    where: {
      status: JobStatus.ERROR,
      type: {
        in: transcriptionTypes,
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

export async function requeueRecoverablePromotionJobs(opts?: ProcessSessionPartJobsOptions) {
  const promotionTypes = resolveRequestedTypes(opts?.types, [SessionPartJobType.PROMOTE_SESSION]);
  if (promotionTypes.length === 0) {
    return;
  }

  const failedJobs = await prisma.sessionPartJob.findMany({
    where: {
      status: JobStatus.ERROR,
      type: {
        in: promotionTypes,
      },
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

export async function markPartRecoveringForRetry(
  part: RetryableSessionPart,
  jobType: SessionPartJobType,
  errorMessage: string,
  attempts: number,
  maxAttempts: number
) {
  await markPartRecovering(part, jobType, errorMessage, attempts, maxAttempts);
}

export async function executeJobWithRetry<T>(job: SessionPartJobPayload, executeJob: (job: SessionPartJobPayload) => Promise<T>, maxRetries: number) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await executeJob(job);
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isRetryableJobError(error)) {
        throw error;
      }
      await waitForJobRetry(attempt);
    }
  }
  throw lastError;
}
