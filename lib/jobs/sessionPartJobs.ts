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
const activeSessionRuns = new Set<string>();

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
  await requeueRecoverableJobs(opts);

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
