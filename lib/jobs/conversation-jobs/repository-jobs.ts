import { ConversationJobType, ConversationStatus, JobStatus, NextMeetingMemoStatus, Prisma, SessionStatus, SessionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import { toPrismaJson } from "@/lib/prisma-json";
import type { ConversationQualityMeta } from "@/lib/types/conversation";
import { ACTIVE_JOB_TYPES, JOB_MAX_ATTEMPTS, getRetryDelayMs, isRetryableJobError } from "./shared";
import type { JobPayload } from "./types";
import { updateConversationStatus } from "./repository-status";

function upsertNextMeetingMemoRecord(input: {
  conversationId: string;
  sessionId: string;
  organizationId: string;
  studentId: string;
  status: NextMeetingMemoStatus;
  clearContent?: boolean;
}) {
  return prisma.nextMeetingMemo.upsert({
    where: { sessionId: input.sessionId },
    update: {
      conversationId: input.conversationId,
      status: input.status,
      errorMessage: null,
      model: null,
      startedAt: null,
      completedAt: null,
      ...(input.clearContent
        ? {
            previousSummary: null,
            suggestedTopics: null,
            rawJson: Prisma.DbNull,
          }
        : {}),
    },
    create: {
      organizationId: input.organizationId,
      studentId: input.studentId,
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      status: input.status,
    },
  });
}

export async function enqueueNextMeetingMemoJob(conversationId: string) {
  const conversation = await prisma.conversationLog.findFirst({
    where: withVisibleConversationWhere({ id: conversationId }),
    select: {
      id: true,
      organizationId: true,
      studentId: true,
      sessionId: true,
      session: {
        select: {
          type: true,
        },
      },
    },
  });
  if (!conversation?.sessionId || conversation.session?.type !== SessionType.INTERVIEW) {
    return { queued: false, reason: "not_interview_session" as const };
  }

  await prisma.$transaction([
    prisma.conversationJob.upsert({
      where: {
        conversationId_type: {
          conversationId,
          type: ConversationJobType.GENERATE_NEXT_MEETING_MEMO,
        },
      },
      update: {
        status: JobStatus.QUEUED,
        executionId: null,
        attempts: 0,
        maxAttempts: JOB_MAX_ATTEMPTS,
        lastError: null,
        nextRetryAt: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        failedAt: null,
        completedAt: null,
        lastRunDurationMs: null,
        lastQueueLagMs: null,
        outputJson: Prisma.DbNull,
        costMetaJson: Prisma.DbNull,
        startedAt: null,
        finishedAt: null,
      },
      create: {
        conversationId,
        type: ConversationJobType.GENERATE_NEXT_MEETING_MEMO,
        status: JobStatus.QUEUED,
        maxAttempts: JOB_MAX_ATTEMPTS,
      },
    }),
    upsertNextMeetingMemoRecord({
      conversationId,
      sessionId: conversation.sessionId,
      organizationId: conversation.organizationId,
      studentId: conversation.studentId,
      status: NextMeetingMemoStatus.QUEUED,
      clearContent: true,
    }),
  ]);

  return { queued: true as const };
}

export async function enqueueConversationJobs(
  conversationId: string,
  opts?: { includeFormat?: boolean }
) {
  const types = [ConversationJobType.FINALIZE, ...(opts?.includeFormat ? [ConversationJobType.FORMAT] : [])];
  await prisma.conversationJob.deleteMany({
    where: {
      conversationId,
      type: { notIn: types },
    },
  });

  return prisma.$transaction(
    types.map((type) =>
      prisma.conversationJob.upsert({
        where: {
          conversationId_type: {
            conversationId,
            type,
          },
        },
        update: {
          status: JobStatus.QUEUED,
          executionId: null,
          attempts: 0,
          maxAttempts: JOB_MAX_ATTEMPTS,
          lastError: null,
          nextRetryAt: null,
          leaseExpiresAt: null,
          lastHeartbeatAt: null,
          failedAt: null,
          completedAt: null,
          lastRunDurationMs: null,
          lastQueueLagMs: null,
          outputJson: Prisma.DbNull,
          costMetaJson: Prisma.DbNull,
          startedAt: null,
          finishedAt: null,
        },
        create: {
          conversationId,
          type,
          status: JobStatus.QUEUED,
          maxAttempts: JOB_MAX_ATTEMPTS,
        },
      })
    )
  );
}

export function shouldRecoverProcessingConversationJobs(input: {
  status: ConversationStatus | string | null | undefined;
  jobs: Array<{ status: JobStatus | string | null | undefined }>;
}) {
  if (input.status !== ConversationStatus.PROCESSING) return false;
  if (input.jobs.length === 0) return true;
  return input.jobs.every((job) => job.status === JobStatus.ERROR);
}

export async function ensureConversationJobsAvailable(
  conversationId: string,
  opts?: { includeFormat?: boolean }
) {
  const conversation = await prisma.conversationLog.findFirst({
    where: withVisibleConversationWhere({ id: conversationId }),
    select: {
      status: true,
      jobs: {
        where: {
          type: { in: ACTIVE_JOB_TYPES },
        },
        select: {
          status: true,
        },
      },
    },
  });

  if (!conversation) {
    return { healed: false as const, reason: "not_found" as const };
  }

  if (!shouldRecoverProcessingConversationJobs(conversation)) {
    return { healed: false as const, reason: "jobs_present" as const };
  }

  await enqueueConversationJobs(conversationId, opts);
  return { healed: true as const, reason: "enqueued_missing_jobs" as const };
}

export async function recordJobFailure(job: JobPayload, error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  const retryable = isRetryableJobError(error);
  const canRetry = retryable && job.attempt < job.maxAttempts;
  const durationMs = Math.max(0, Date.now() - job.startedAt.getTime());
  const failedAt = new Date();
  const nextRetryAt = canRetry ? new Date(Date.now() + getRetryDelayMs(job.attempt)) : null;

  await prisma.conversationJob.update({
    where: { id: job.id },
    data: {
      status: canRetry ? JobStatus.QUEUED : JobStatus.ERROR,
      lastError: message,
      nextRetryAt,
      leaseExpiresAt: null,
      lastHeartbeatAt: failedAt,
      failedAt,
      finishedAt: failedAt,
      lastRunDurationMs: durationMs,
      outputJson: toPrismaJson({
        executionId: job.executionId,
        attempt: job.attempt,
        retryable,
        nextRetryAt,
      }),
    },
  });

  const existing = await prisma.conversationLog.findFirst({
    where: withVisibleConversationWhere({ id: job.conversationId }),
    select: { qualityMetaJson: true, sessionId: true, studentId: true },
  });
  const prev = (existing?.qualityMetaJson as ConversationQualityMeta) ?? {};
  await prisma.conversationLog.updateMany({
    where: withVisibleConversationWhere({ id: job.conversationId }),
    data: {
      qualityMetaJson: toPrismaJson({
        ...prev,
        errors: [...(prev.errors ?? []), message],
        lastJobFailure: {
          jobId: job.id,
          executionId: job.executionId,
          jobType: job.type,
          attempt: job.attempt,
          maxAttempts: job.maxAttempts,
          retryable,
          nextRetryAt,
          failedAt: failedAt.toISOString(),
        },
      }),
    },
  });

  if (job.type === ConversationJobType.FINALIZE) {
    await updateConversationStatus(
      job.conversationId,
      canRetry ? ConversationStatus.PROCESSING : ConversationStatus.ERROR
    );
    if (existing?.sessionId) {
      await prisma.session.update({
        where: { id: existing.sessionId },
        data: { status: canRetry ? SessionStatus.PROCESSING : SessionStatus.ERROR },
      });
    }
  } else if (job.type === ConversationJobType.GENERATE_NEXT_MEETING_MEMO) {
    await prisma.nextMeetingMemo.updateMany({
      where: { conversationId: job.conversationId },
      data: canRetry
        ? {
            status: NextMeetingMemoStatus.QUEUED,
            errorMessage: null,
            completedAt: null,
          }
        : {
            status: NextMeetingMemoStatus.FAILED,
            errorMessage: message,
            completedAt: failedAt,
          },
    });
    await updateConversationStatus(job.conversationId);
  } else {
    await updateConversationStatus(job.conversationId);
  }

  return {
    message,
    canRetry,
    durationMs,
    failedAt,
    nextRetryAt,
    existing,
  };
}
