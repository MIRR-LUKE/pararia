import { randomUUID } from "node:crypto";
import { ConversationJobType, ConversationStatus, JobStatus, NextMeetingMemoStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import { ACTIVE_JOB_TYPES, JOB_LEASE_MS, JOB_PRIORITY, dependencySatisfied } from "./shared";
import type { JobPayload, ProcessJobsOptions } from "./types";

export async function updateConversationStatus(conversationId: string, statusHint?: ConversationStatus) {
  const jobs = await prisma.conversationJob.findMany({
    where: { conversationId, type: { in: ACTIVE_JOB_TYPES } },
    select: { type: true, status: true },
  });

  const finalizeJob = jobs.find((job) => job.type === ConversationJobType.FINALIZE);
  let status: ConversationStatus = ConversationStatus.PROCESSING;
  if (finalizeJob?.status === JobStatus.DONE) {
    status = ConversationStatus.DONE;
  } else if (finalizeJob?.status === JobStatus.ERROR) {
    status = ConversationStatus.ERROR;
  }
  if (statusHint) status = statusHint;

  await prisma.conversationLog.updateMany({
    where: withVisibleConversationWhere({ id: conversationId }),
    data: { status },
  });
}

export async function recoverExpiredRunningJobs(opts?: ProcessJobsOptions) {
  const now = new Date();
  const staleJobs = await prisma.conversationJob.findMany({
    where: {
      status: JobStatus.RUNNING,
      leaseExpiresAt: { lt: now },
      type: { in: ACTIVE_JOB_TYPES },
      ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
      conversation: {
        ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}),
        deletedAt: null,
      },
    },
    select: {
      id: true,
      conversationId: true,
      type: true,
      attempts: true,
      maxAttempts: true,
    },
  });

  for (const stale of staleJobs) {
    const exhausted = stale.attempts >= stale.maxAttempts;
    const updated = await prisma.conversationJob.updateMany({
      where: { id: stale.id, status: JobStatus.RUNNING },
      data: {
        status: exhausted ? JobStatus.ERROR : JobStatus.QUEUED,
        lastError: exhausted ? "lease expired and max attempts reached" : "lease expired; requeued",
        nextRetryAt: exhausted ? null : now,
        leaseExpiresAt: null,
        lastHeartbeatAt: now,
        failedAt: now,
        finishedAt: now,
      },
    });
    if (updated.count !== 1) continue;

    if (stale.type === ConversationJobType.GENERATE_NEXT_MEETING_MEMO) {
      const updateData = exhausted
        ? {
            status: NextMeetingMemoStatus.FAILED,
            errorMessage: "lease expired and max attempts reached",
            completedAt: now,
          }
        : {
            status: NextMeetingMemoStatus.QUEUED,
            errorMessage: null,
            completedAt: null,
          };
      await prisma.nextMeetingMemo.updateMany({
        where: { conversationId: stale.conversationId },
        data: updateData,
      });
      await updateConversationStatus(stale.conversationId);
    } else if (stale.type === ConversationJobType.FINALIZE) {
      await updateConversationStatus(
        stale.conversationId,
        exhausted ? ConversationStatus.ERROR : ConversationStatus.PROCESSING
      );
    } else {
      await updateConversationStatus(stale.conversationId);
    }
  }
}

export async function claimNextJob(opts?: ProcessJobsOptions): Promise<JobPayload | null> {
  await prisma.conversationJob.deleteMany({
    where: {
      ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
      ...(opts?.sessionId ? { conversation: { sessionId: opts.sessionId } } : {}),
      type: { notIn: ACTIVE_JOB_TYPES },
    },
  });

  await recoverExpiredRunningJobs(opts);

  const now = new Date();
  const queued = await prisma.conversationJob.findMany({
    where: {
      status: JobStatus.QUEUED,
      type: { in: ACTIVE_JOB_TYPES },
      ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
      conversation: {
        ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}),
        deletedAt: null,
      },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    orderBy: [{ createdAt: "asc" }],
    take: 50,
    select: {
      id: true,
      conversationId: true,
      type: true,
      attempts: true,
      maxAttempts: true,
      createdAt: true,
    },
  });
  if (queued.length === 0) return null;

  const conversationIds = Array.from(new Set(queued.map((job) => job.conversationId)));
  const states = await prisma.conversationJob.findMany({
    where: {
      conversationId: { in: conversationIds },
      type: { in: ACTIVE_JOB_TYPES },
      conversation: {
        deletedAt: null,
      },
    },
    select: { conversationId: true, type: true, status: true },
  });

  const statusByConversation = new Map<string, Map<ConversationJobType, JobStatus>>();
  for (const state of states) {
    const byType = statusByConversation.get(state.conversationId) ?? new Map<ConversationJobType, JobStatus>();
    byType.set(state.type, state.status);
    statusByConversation.set(state.conversationId, byType);
  }

  const eligible = queued
    .filter((job) => dependencySatisfied(job.type, statusByConversation.get(job.conversationId) ?? new Map()))
    .sort((a, b) => {
      const pri = (JOB_PRIORITY[a.type] ?? 99) - (JOB_PRIORITY[b.type] ?? 99);
      if (pri !== 0) return pri;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

  for (const job of eligible) {
    const claimedAt = new Date();
    const executionId = opts?.executionId ?? randomUUID();
    const lastQueueLagMs = Math.max(0, claimedAt.getTime() - job.createdAt.getTime());
    const updated = await prisma.conversationJob.updateMany({
      where: { id: job.id, status: JobStatus.QUEUED },
      data: {
        status: JobStatus.RUNNING,
        executionId,
        startedAt: claimedAt,
        finishedAt: null,
        failedAt: null,
        completedAt: null,
        nextRetryAt: null,
        leaseExpiresAt: new Date(claimedAt.getTime() + JOB_LEASE_MS),
        lastHeartbeatAt: claimedAt,
        lastQueueLagMs,
        attempts: { increment: 1 },
      },
    });
    if (updated.count === 1) {
      return {
        id: job.id,
        conversationId: job.conversationId,
        type: job.type,
        attempt: job.attempts + 1,
        maxAttempts: job.maxAttempts,
        executionId,
        createdAt: job.createdAt,
        startedAt: claimedAt,
        lastQueueLagMs,
      };
    }
  }

  return null;
}
