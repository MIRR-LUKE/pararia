import { randomUUID } from "node:crypto";
import { ConversationJobType, ConversationStatus, JobStatus, NextMeetingMemoStatus, Prisma, SessionStatus, SessionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";
import { toPrismaJson } from "@/lib/prisma-json";
import type { ConversationQualityMeta } from "@/lib/types/conversation";
import type { ConversationPayload, JobPayload, ProcessJobsOptions } from "./types";
import {
  ACTIVE_JOB_TYPES,
  dependencySatisfied,
  deriveSessionDurationMinutes,
  getRetryDelayMs,
  isRetryableJobError,
  JOB_LEASE_MS,
  JOB_MAX_ATTEMPTS,
  JOB_PRIORITY,
} from "./shared";

type LoadedConversation = {
  id: string;
  organizationId: string;
  studentId: string;
  sessionId: string | null;
  rawTextOriginal: string | null;
  rawTextCleaned: string | null;
  reviewedText: string | null;
  rawSegments: unknown;
  formattedTranscript: string | null;
  summaryMarkdown: string | null;
  artifactJson: Prisma.JsonValue | null;
  qualityMetaJson: Prisma.JsonValue | null;
  student: { id: string; name: string | null } | null;
  user: { name: string | null } | null;
  session: {
    id: string;
    type: SessionType;
    sessionDate: Date | null;
    parts: Array<{ qualityMetaJson: unknown }>;
  } | null;
};

function buildConversationPayload(convo: LoadedConversation): ConversationPayload {
  return {
    id: convo.id,
    organizationId: convo.organizationId,
    studentId: convo.studentId,
    sessionId: convo.sessionId,
    sessionType: convo.session?.type ?? null,
    sessionDate: convo.session?.sessionDate ?? null,
    rawTextOriginal: convo.rawTextOriginal,
    rawTextCleaned: convo.rawTextCleaned,
    reviewedText: convo.reviewedText,
    rawSegments: (convo.rawSegments as any[]) ?? [],
    formattedTranscript: convo.formattedTranscript,
    summaryMarkdown: convo.summaryMarkdown,
    artifactJson: (convo.artifactJson as Prisma.JsonValue | null) ?? null,
    studentName: convo.student?.name ?? null,
    teacherName: convo.user?.name ?? DEFAULT_TEACHER_FULL_NAME,
    durationMinutes: deriveSessionDurationMinutes(convo.session?.parts),
    qualityMetaJson: (convo.qualityMetaJson as ConversationQualityMeta) ?? null,
  } satisfies ConversationPayload;
}

export async function loadConversationPayload(conversationId: string) {
  const convo = await prisma.conversationLog.findUnique({
    where: { id: conversationId },
    include: {
      student: { select: { id: true, name: true } },
      user: { select: { name: true } },
      session: { select: { id: true, type: true, sessionDate: true, parts: { select: { qualityMetaJson: true } } } },
    },
  });
  if (!convo) throw new Error("conversation not found");
  return buildConversationPayload(convo as LoadedConversation);
}

export async function touchJobLease(job: JobPayload) {
  const now = new Date();
  await prisma.conversationJob.updateMany({
    where: {
      id: job.id,
      status: JobStatus.RUNNING,
      executionId: job.executionId,
    },
    data: {
      lastHeartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS),
    },
  });
}

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

  await prisma.conversationLog.update({
    where: { id: conversationId },
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
      ...(opts?.sessionId ? { conversation: { sessionId: opts.sessionId } } : {}),
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
      ...(opts?.sessionId ? { conversation: { sessionId: opts.sessionId } } : {}),
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
    const executionId = randomUUID();
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
  const conversation = await prisma.conversationLog.findUnique({
    where: { id: conversationId },
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

  const existing = await prisma.conversationLog.findUnique({
    where: { id: job.conversationId },
    select: { qualityMetaJson: true, sessionId: true, studentId: true },
  });
  const prev = (existing?.qualityMetaJson as ConversationQualityMeta) ?? {};
  await prisma.conversationLog.update({
    where: { id: job.conversationId },
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
