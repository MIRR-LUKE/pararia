import { randomUUID } from "node:crypto";
import { JobStatus, Prisma, SessionPartJobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { executeFinalizeLivePartJob } from "@/lib/jobs/session-part-jobs/finalize-live-part";
import { executePromoteSessionJob } from "@/lib/jobs/session-part-jobs/promote-session";
import { executeTranscribeFileJob } from "@/lib/jobs/session-part-jobs/transcribe-file";
import {
  executeJobWithRetry,
  getSessionPartRecoveryPlan,
  markPartRecoveringForRetry,
  requeueRecoverablePromotionJobs,
  requeueRecoverableTranscriptionJobs,
} from "@/lib/jobs/session-part-jobs/retry";
import {
  loadSessionPart,
  markPartExecutionError,
  markPartPromotionError,
  partHasTranscript,
  type ProcessSessionPartJobsOptions,
  type SessionPartJobPayload,
} from "@/lib/jobs/session-part-jobs/shared";

const JOB_EXECUTION_RETRIES = 2;
const SESSION_PART_LEASE_MS = readClampedEnvInt("SESSION_PART_JOB_LEASE_MS", 5 * 60 * 1000, 30_000, 15 * 60 * 1000);

type SessionPartJobRunResult = {
  attempted: number;
  processed: number;
  errors: string[];
};

function readClampedEnvInt(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function shouldPreserveActiveSessionPartJob(status: JobStatus | string | null | undefined) {
  return status === JobStatus.QUEUED || status === JobStatus.RUNNING;
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

async function executeJobWithSessionRetry(job: SessionPartJobPayload) {
  return executeJobWithRetry(job, executeJob, JOB_EXECUTION_RETRIES);
}

async function requeueRecoverableJobs(opts?: ProcessSessionPartJobsOptions) {
  await requeueRecoverableTranscriptionJobs(opts);
  await requeueRecoverablePromotionJobs(opts);
}

async function claimNextJobForSession(sessionId: string): Promise<SessionPartJobPayload | null> {
  while (true) {
    const next = await prisma.sessionPartJob.findFirst({
      where: {
        status: JobStatus.QUEUED,
        sessionPart: {
          sessionId,
        },
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
  return prisma.$transaction(async (tx) => {
    const existing = await tx.sessionPartJob.findUnique({
      where: {
        sessionPartId_type: {
          sessionPartId,
          type,
        },
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (existing && shouldPreserveActiveSessionPartJob(existing.status)) {
      return tx.sessionPartJob.findUniqueOrThrow({
        where: { id: existing.id },
      });
    }

    if (existing) {
      return tx.sessionPartJob.update({
        where: { id: existing.id },
        data: {
          status: JobStatus.QUEUED,
          lastError: null,
          outputJson: Prisma.DbNull,
          costMetaJson: Prisma.DbNull,
          startedAt: null,
          finishedAt: null,
        },
      });
    }

    return tx.sessionPartJob.create({
      data: {
        sessionPartId,
        type,
        status: JobStatus.QUEUED,
      },
    });
  });
}

async function acquireSessionPartProcessingLease(sessionId: string, executionId: string) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + SESSION_PART_LEASE_MS);
  const claimed = await prisma.session.updateMany({
    where: {
      id: sessionId,
      OR: [
        { sessionPartLeaseExecutionId: null },
        { sessionPartLeaseExpiresAt: null },
        { sessionPartLeaseExpiresAt: { lt: now } },
        { sessionPartLeaseExecutionId: executionId },
      ],
    },
    data: {
      sessionPartLeaseExecutionId: executionId,
      sessionPartLeaseStartedAt: now,
      sessionPartLeaseHeartbeatAt: now,
      sessionPartLeaseExpiresAt: leaseExpiresAt,
    },
  });
  return claimed.count > 0;
}

async function renewSessionPartProcessingLease(sessionId: string, executionId: string) {
  await prisma.session.updateMany({
    where: {
      id: sessionId,
      sessionPartLeaseExecutionId: executionId,
    },
    data: {
      sessionPartLeaseHeartbeatAt: new Date(),
      sessionPartLeaseExpiresAt: new Date(Date.now() + SESSION_PART_LEASE_MS),
    },
  });
}

async function releaseSessionPartProcessingLease(sessionId: string, executionId: string) {
  await prisma.session.updateMany({
    where: {
      id: sessionId,
      sessionPartLeaseExecutionId: executionId,
    },
    data: {
      sessionPartLeaseExecutionId: null,
      sessionPartLeaseStartedAt: null,
      sessionPartLeaseHeartbeatAt: null,
      sessionPartLeaseExpiresAt: null,
    },
  });
}

async function claimNextLeasableSession(executionId: string): Promise<string | null> {
  while (true) {
    const now = new Date();
    const next = await prisma.sessionPartJob.findFirst({
      where: {
        status: JobStatus.QUEUED,
        sessionPart: {
          session: {
            OR: [
              { sessionPartLeaseExecutionId: null },
              { sessionPartLeaseExpiresAt: null },
              { sessionPartLeaseExpiresAt: { lt: now } },
              { sessionPartLeaseExecutionId: executionId },
            ],
          },
        },
      },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
      select: {
        sessionPart: {
          select: {
            sessionId: true,
          },
        },
      },
    });
    const sessionId = next?.sessionPart.sessionId;
    if (!sessionId) return null;
    const leaseAcquired = await acquireSessionPartProcessingLease(sessionId, executionId);
    if (leaseAcquired) {
      return sessionId;
    }
  }
}

async function processLeasedSessionPartJobs(
  sessionId: string,
  executionId: string,
  maxLimit: number,
  maxConcurrency: number
): Promise<SessionPartJobRunResult> {
  const workerCount = Math.min(maxLimit, maxConcurrency);
  let remaining = maxLimit;
  let attempted = 0;
  let processed = 0;
  const errors: string[] = [];

  const reserveSlot = () => {
    if (remaining <= 0) return false;
    remaining -= 1;
    return true;
  };

  const runWorker = async () => {
    while (reserveSlot()) {
      await renewSessionPartProcessingLease(sessionId, executionId);
      const job = await claimNextJobForSession(sessionId);
      if (!job) break;
      attempted += 1;
      try {
        await executeJobWithSessionRetry(job);
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
            await markPartRecoveringForRetry(part, job.type, message, attempts, recovery.maxAttempts).catch(() => {});
          } else if (job.type === SessionPartJobType.PROMOTE_SESSION && partHasTranscript(part)) {
            await markPartPromotionError(part, message).catch(() => {});
          } else {
            await markPartExecutionError(part, message).catch(() => {});
          }
        }
      } finally {
        await renewSessionPartProcessingLease(sessionId, executionId);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return { attempted, processed, errors };
}

async function processSessionPartJobsForSession(
  sessionId: string,
  maxLimit: number,
  maxConcurrency: number
): Promise<SessionPartJobRunResult> {
  const executionId = randomUUID();
  const leaseAcquired = await acquireSessionPartProcessingLease(sessionId, executionId);
  if (!leaseAcquired) {
    return { attempted: 0, processed: 0, errors: [] };
  }
  try {
    return await processLeasedSessionPartJobs(sessionId, executionId, maxLimit, maxConcurrency);
  } finally {
    await releaseSessionPartProcessingLease(sessionId, executionId);
  }
}

export async function processQueuedSessionPartJobs(
  limit = 1,
  concurrency = 1,
  opts?: ProcessSessionPartJobsOptions
): Promise<{ processed: number; errors: string[] }> {
  await requeueRecoverableJobs(opts);

  const maxLimit = Math.max(1, Math.floor(limit));
  const maxConcurrency = Math.max(1, Math.floor(concurrency));
  if (opts?.sessionId) {
    const result = await processSessionPartJobsForSession(opts.sessionId, maxLimit, maxConcurrency);
    return { processed: result.processed, errors: result.errors };
  }

  let remaining = maxLimit;
  let processed = 0;
  const errors: string[] = [];

  while (remaining > 0) {
    const executionId = randomUUID();
    const sessionId = await claimNextLeasableSession(executionId);
    if (!sessionId) break;
    try {
      const batch = await processLeasedSessionPartJobs(sessionId, executionId, remaining, maxConcurrency);
      processed += batch.processed;
      errors.push(...batch.errors);
      remaining -= batch.attempted;
      if (batch.attempted <= 0) {
        break;
      }
    } finally {
      await releaseSessionPartProcessingLease(sessionId, executionId);
    }
  }

  return { processed, errors };
}

export async function processAllSessionPartJobs(sessionId: string) {
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
  const result = await processSessionPartJobsForSession(sessionId, limit, concurrency);
  return { processed: result.processed, errors: result.errors };
}
