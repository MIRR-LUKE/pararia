import { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ACTIVE_JOB_TYPES, buildJobContext } from "./shared";
import type { JobPayload, ProcessJobsOptions } from "./types";
import {
  claimNextJob,
  enqueueConversationJobs,
  enqueueNextMeetingMemoJob,
  ensureConversationJobsAvailable,
  recordJobFailure,
  shouldRecoverProcessingConversationJobs,
} from "./repository";
import { executeJob } from "./handlers";
import { logJobError, logJobWarn, stopRunpodWorkerAfterConversationJob } from "./side-effects";

const activeConversationRuns = new Set<string>();

export function isConversationJobRunActive(conversationId: string) {
  return activeConversationRuns.has(conversationId);
}

async function handleJobFailure(job: JobPayload, error: unknown) {
  const failure = await recordJobFailure(job, error);
  const logContext = {
    ...buildJobContext(
      job,
      failure.existing
        ? {
            id: job.conversationId,
            organizationId: "unknown",
            studentId: failure.existing.studentId,
            sessionId: failure.existing.sessionId,
          }
        : undefined
    ),
    retryable: failure.canRetry,
    nextRetryAt: failure.nextRetryAt?.toISOString() ?? null,
    durationMs: failure.durationMs,
    message: failure.message,
  };
  if (failure.canRetry) {
    logJobWarn("job_retry_scheduled", logContext);
  } else {
    logJobError("job_failed", logContext);
  }

  await stopRunpodWorkerAfterConversationJob("job failure");

  return {
    message: failure.message,
    canRetry: failure.canRetry,
  };
}

export {
  enqueueConversationJobs,
  enqueueNextMeetingMemoJob,
  ensureConversationJobsAvailable,
  shouldRecoverProcessingConversationJobs,
};

export async function processQueuedJobs(
  limit = 1,
  concurrency = 1,
  opts?: ProcessJobsOptions
): Promise<{ processed: number; errors: string[] }> {
  const errors: string[] = [];
  let processed = 0;
  const maxLimit = Math.max(1, Math.floor(limit));
  const maxConcurrency = Math.max(1, Math.floor(concurrency));
  const workerCount = Math.min(maxLimit, maxConcurrency);
  let remaining = maxLimit;

  const reserveSlot = () => {
    if (remaining <= 0) return false;
    remaining -= 1;
    return true;
  };

  const releaseSlot = () => {
    remaining += 1;
  };

  const runWorker = async () => {
    let idle = 0;
    while (true) {
      if (!reserveSlot()) return;
      const job = await claimNextJob(opts);
      if (!job) {
        releaseSlot();
        idle += 1;
        if (idle >= 2) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }

      idle = 0;
      try {
        await executeJob(job);
        processed += 1;
      } catch (error) {
        const failure = await handleJobFailure(job, error);
        errors.push(failure.message);
      } finally {
        releaseSlot();
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return { processed, errors };
}

export async function processAllConversationJobs(conversationId: string) {
  if (activeConversationRuns.has(conversationId)) {
    return { processed: 0, errors: [] };
  }
  activeConversationRuns.add(conversationId);
  try {
    const envConcurrency = Number(process.env.JOB_CONCURRENCY ?? 3);
    const concurrency = Number.isFinite(envConcurrency) ? Math.max(1, Math.floor(envConcurrency)) : 1;
    const pending = await prisma.conversationJob.count({
      where: {
        conversationId,
        type: { in: ACTIVE_JOB_TYPES },
        status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
      },
    });
    const limit = Math.max(4, pending * 2);
    return processQueuedJobs(limit, concurrency, { conversationId });
  } finally {
    activeConversationRuns.delete(conversationId);
  }
}
