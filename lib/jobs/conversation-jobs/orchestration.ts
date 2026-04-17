import { randomUUID } from "node:crypto";
import { ConversationStatus, JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import { ACTIVE_JOB_TYPES, buildJobContext } from "./shared";
import type { JobPayload, ProcessJobsOptions } from "./types";
import {
  acquireConversationProcessingLease,
  claimNextJob,
  enqueueConversationJobs,
  enqueueNextMeetingMemoJob,
  ensureConversationJobsAvailable,
  recordJobFailure,
  releaseConversationProcessingLease,
  shouldRecoverProcessingConversationJobs,
  isConversationProcessingLeaseActive,
} from "./repository";
import { executeJob } from "./handlers";
import { logJobError, logJobWarn, stopRunpodWorkerAfterConversationJob } from "./side-effects";

export async function isConversationJobRunActive(conversationId: string) {
  const conversation = await prisma.conversationLog.findFirst({
    where: withVisibleConversationWhere({ id: conversationId }),
    select: {
      status: true,
      processingLeaseExecutionId: true,
      processingLeaseExpiresAt: true,
    },
  });
  if (!conversation) return false;
  return isConversationProcessingLeaseActive({
    status: conversation.status,
    processingLeaseExecutionId: conversation.processingLeaseExecutionId,
    processingLeaseExpiresAt: conversation.processingLeaseExpiresAt,
  });
}

export function requiresConversationProcessingLease(status: ConversationStatus | string | null | undefined) {
  return status === ConversationStatus.PROCESSING;
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

  void stopRunpodWorkerAfterConversationJob("job failure");

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

async function listRunnableConversationIds(limit: number, opts?: ProcessJobsOptions) {
  const now = new Date();
  const rows = await prisma.conversationJob.findMany({
    where: {
      type: { in: ACTIVE_JOB_TYPES },
      ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
      conversation: {
        deletedAt: null,
        ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}),
      },
      OR: [
        {
          status: JobStatus.QUEUED,
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        {
          status: JobStatus.RUNNING,
        },
      ],
    },
    orderBy: [{ createdAt: "asc" }],
    select: {
      conversationId: true,
    },
    take: Math.max(10, limit * 5),
  });
  const seen = new Set<string>();
  const conversationIds: string[] = [];
  for (const row of rows) {
    if (seen.has(row.conversationId)) continue;
    seen.add(row.conversationId);
    conversationIds.push(row.conversationId);
    if (conversationIds.length >= limit) break;
  }
  return conversationIds;
}

export async function processQueuedJobs(
  limit = 1,
  concurrency = 1,
  opts?: ProcessJobsOptions
): Promise<{ processed: number; errors: string[] }> {
  const maxLimit = Math.max(1, Math.floor(limit));
  const maxConcurrency = Math.max(1, Math.floor(concurrency));

  if (!opts?.conversationId) {
    const conversationIds = await listRunnableConversationIds(maxLimit, opts);
    if (conversationIds.length === 0) {
      return { processed: 0, errors: [] };
    }

    let nextIndex = 0;
    let processed = 0;
    const errors: string[] = [];
    const workerCount = Math.min(conversationIds.length, maxConcurrency);

    const claimConversationId = () => {
      const conversationId = conversationIds[nextIndex];
      nextIndex += 1;
      return conversationId ?? null;
    };

    const runConversationWorker = async () => {
      while (true) {
        const conversationId = claimConversationId();
        if (!conversationId) return;
        const result = await processAllConversationJobs(conversationId);
        processed += result.processed;
        errors.push(...result.errors);
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runConversationWorker()));
    return { processed, errors };
  }

  const errors: string[] = [];
  let processed = 0;
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
  const runExecutionId = randomUUID();
  const conversation = await prisma.conversationLog.findFirst({
    where: withVisibleConversationWhere({ id: conversationId }),
    select: { status: true },
  });
  if (!conversation) {
    return { processed: 0, errors: [] };
  }

  const runQueue = async () => {
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
    return processQueuedJobs(limit, concurrency, { conversationId, executionId: runExecutionId });
  };

  if (!requiresConversationProcessingLease(conversation.status)) {
    return runQueue();
  }

  const lease = await acquireConversationProcessingLease({
    conversationId,
    executionId: runExecutionId,
  });
  if (!lease.acquired) {
    logJobWarn("conversation_processing_lease_busy", {
      conversationId,
      executionId: runExecutionId,
    });
    return { processed: 0, errors: [] };
  }
  try {
    return runQueue();
  } finally {
    await releaseConversationProcessingLease({
      conversationId,
      executionId: runExecutionId,
    });
  }
}
