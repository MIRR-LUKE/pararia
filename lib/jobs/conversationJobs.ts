import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  ConversationJobType,
  ConversationStatus,
  JobStatus,
  NextMeetingMemoStatus,
  Prisma,
  SessionStatus,
  SessionType,
} from "@prisma/client";
import { estimateTokens, generateConversationDraftFast, getPromptVersion } from "@/lib/ai/conversationPipeline";
import {
  generateNextMeetingMemo,
  getNextMeetingMemoPromptVersion,
} from "@/lib/ai/next-meeting-memo";
import { formatTranscriptFromSegments, formatTranscriptFromText } from "@/lib/ai/llm";
import { renderConversationArtifactMarkdown } from "@/lib/conversation-artifact";
import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";
import { sanitizeFormattedTranscript } from "@/lib/user-facing-japanese";
import type { ConversationQualityMeta } from "@/lib/types/conversation";
import { syncSessionAfterConversation } from "@/lib/session-service";
import { toPrismaJson } from "@/lib/prisma-json";
import { normalizeRawTranscriptText, pickEvidenceTranscriptText } from "@/lib/transcript/source";
import { ensureConversationReviewedTranscript } from "@/lib/transcript/review";
import { readSessionPartMeta } from "@/lib/session-part-meta";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";

const DEFAULT_JOB_TYPES: ConversationJobType[] = [ConversationJobType.FINALIZE];
const ACTIVE_JOB_TYPES: ConversationJobType[] = [
  ConversationJobType.FINALIZE,
  ConversationJobType.GENERATE_NEXT_MEETING_MEMO,
  ConversationJobType.FORMAT,
];
const JOB_PRIORITY: Partial<Record<ConversationJobType, number>> = {
  [ConversationJobType.FINALIZE]: 0,
  [ConversationJobType.GENERATE_NEXT_MEETING_MEMO]: 1,
  [ConversationJobType.FORMAT]: 2,
};

function readClampedEnvInt(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

const JOB_MAX_ATTEMPTS = readClampedEnvInt("JOB_MAX_ATTEMPTS", 3, 1, 10);
const JOB_LEASE_MS = readClampedEnvInt("JOB_LEASE_MS", 5 * 60 * 1000, 30_000, 15 * 60 * 1000);
const JOB_RETRY_BASE_MS = readClampedEnvInt("JOB_RETRY_BASE_MS", 15_000, 1_000, 5 * 60 * 1000);

type JobPayload = {
  id: string;
  conversationId: string;
  type: ConversationJobType;
  attempt: number;
  maxAttempts: number;
  executionId: string;
  createdAt: Date;
  startedAt: Date;
  lastQueueLagMs: number;
};

type ProcessJobsOptions = {
  conversationId?: string;
  sessionId?: string;
};

type ConversationPayload = {
  id: string;
  organizationId: string;
  studentId: string;
  sessionId?: string | null;
  sessionType?: SessionType | null;
  sessionDate?: Date | string | null;
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  reviewedText?: string | null;
  rawSegments?: any[] | null;
  formattedTranscript?: string | null;
  summaryMarkdown?: string | null;
  artifactJson?: Prisma.JsonValue | null;
  studentName?: string | null;
  teacherName?: string | null;
  durationMinutes?: number | null;
  qualityMetaJson?: ConversationQualityMeta | null;
};

const activeConversationRuns = new Set<string>();

export function isConversationJobRunActive(conversationId: string) {
  return activeConversationRuns.has(conversationId);
}

function isRetryableJobError(error: unknown) {
  const message =
    error instanceof Error ? `${error.name} ${error.message}` : typeof error === "string" ? error : "";
  return /(429|408|409|5\d\d|timeout|timed out|abort|temporar|overloaded|rate limit|fetch failed|network|econnreset|etimedout|socket)/i.test(
    message
  );
}

function getRetryDelayMs(attempt: number) {
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(5 * 60 * 1000, JOB_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1)) + jitter;
}

function normalizeSourceText(payload: ConversationPayload) {
  // Generation always reads the evidence path first: reviewed -> raw.
  const evidence = pickEvidenceTranscriptText(payload);
  if (evidence) return evidence;
  // formattedTranscript is only a rescue source for older records.
  if (payload.formattedTranscript?.trim()) {
    return normalizeRawTranscriptText(
      payload.formattedTranscript
        .split("\n")
        .map((line) => line.replace(/^\*\*[^*]+\*\*:\s*/g, ""))
        .join("\n")
        .trim()
    );
  }
  return "";
}

function minSummaryCharsFor(input: { sessionType?: SessionType | null; sourceText: string }) {
  if (input.sessionType === SessionType.LESSON_REPORT) {
    if (input.sourceText.length >= 12000) return 900;
    if (input.sourceText.length <= 2500) return 600;
    return 760;
  }
  if (input.sourceText.length >= 12000) return 700;
  if (input.sourceText.length <= 2500) return 420;
  return 560;
}

function deriveSessionDurationMinutes(parts: Array<{ qualityMetaJson?: unknown }> | undefined) {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const totalSeconds = parts.reduce((sum, part) => {
    const meta = readSessionPartMeta(part.qualityMetaJson);
    const seconds =
      typeof meta.audioDurationSeconds === "number"
        ? meta.audioDurationSeconds
        : typeof meta.liveDurationSeconds === "number"
          ? meta.liveDurationSeconds
          : null;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return sum;
    return sum + seconds;
  }, 0);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
  return Math.max(1, Math.round(totalSeconds / 60));
}

function dependencySatisfied(
  type: ConversationJobType,
  statusByType: Map<ConversationJobType, JobStatus>
) {
  if (type === ConversationJobType.FINALIZE) return true;
  if (type === ConversationJobType.GENERATE_NEXT_MEETING_MEMO) {
    return statusByType.get(ConversationJobType.FINALIZE) === JobStatus.DONE;
  }
  if (type === ConversationJobType.FORMAT) {
    const finalizeStatus = statusByType.get(ConversationJobType.FINALIZE);
    return typeof finalizeStatus === "undefined" || finalizeStatus === JobStatus.DONE;
  }
  return false;
}

function buildJobContext(job: JobPayload, convo?: ConversationPayload) {
  return {
    conversationId: job.conversationId,
    jobId: job.id,
    executionId: job.executionId,
    jobType: job.type,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    studentId: convo?.studentId ?? null,
    sessionId: convo?.sessionId ?? null,
  };
}

function shouldGenerateNextMeetingMemo(convo: ConversationPayload) {
  return convo.sessionType === SessionType.INTERVIEW && Boolean(convo.sessionId);
}

function logJobInfo(message: string, context: Record<string, unknown>) {
  console.info("[conversation-jobs]", message, context);
}

function logJobWarn(message: string, context: Record<string, unknown>) {
  console.warn("[conversation-jobs]", message, context);
}

function logJobError(message: string, context: Record<string, unknown>) {
  console.error("[conversation-jobs]", message, context);
}

async function touchJobLease(job: JobPayload) {
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

async function updateConversationStatus(conversationId: string, statusHint?: ConversationStatus) {
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

async function recoverExpiredRunningJobs(opts?: ProcessJobsOptions) {
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

    logJobWarn("recovered_stale_job", {
      conversationId: stale.conversationId,
      jobId: stale.id,
      jobType: stale.type,
      attempts: stale.attempts,
      maxAttempts: stale.maxAttempts,
      exhausted,
    });
  }
}

async function claimNextJob(opts?: ProcessJobsOptions): Promise<JobPayload | null> {
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

async function executeFinalizeJob(job: JobPayload, convo: ConversationPayload) {
  const review = await ensureConversationReviewedTranscript(convo.id);
  const sourceText = normalizeRawTranscriptText(review.reviewedText || review.rawTextOriginal || normalizeSourceText(convo));
  if (!sourceText.trim()) {
    throw new Error("raw transcript is missing");
  }

  const minSummaryChars = minSummaryCharsFor({
    sessionType: convo.sessionType,
    sourceText,
  });
  await touchJobLease(job);

  const start = Date.now();
  const sessionType = convo.sessionType === SessionType.LESSON_REPORT ? "LESSON_REPORT" : "INTERVIEW";
  const {
    summaryMarkdown,
    artifact,
    model,
    apiCalls,
    evidenceChars,
    usedFallback,
    inputTokensEstimate,
    tokenUsage,
    llmCostUsd,
  } = await generateConversationDraftFast({
    transcript: sourceText,
    studentName: convo.studentName ?? undefined,
    teacherName: convo.teacherName ?? undefined,
    sessionDate: convo.sessionDate ?? undefined,
    durationMinutes: convo.durationMinutes ?? undefined,
    minSummaryChars,
    sessionType,
  });
  const duration = Date.now() - start;
  const cleanedSummary = summaryMarkdown.trim();
  if (!cleanedSummary) {
    throw new Error("summary generation returned empty markdown");
  }

  const renderedSummary = renderConversationArtifactMarkdown(artifact);

  const qualityMeta: ConversationQualityMeta = {
    ...(convo.qualityMetaJson ?? {}),
    modelFinalize: model,
    summaryCharCount: renderedSummary.length,
    jobSecondsFinalize: Math.round(duration / 1000),
    llmApiCallsFinalize: apiCalls,
    promptVersion: getPromptVersion(),
    generatedAt: new Date().toISOString(),
    inputTokensEstimate,
    outputTokensEstimate: tokenUsage.outputTokens || estimateTokens(renderedSummary),
    llmInputTokensActual: tokenUsage.inputTokens,
    llmCachedInputTokensActual: tokenUsage.cachedInputTokens,
    llmOutputTokensActual: tokenUsage.outputTokens,
    llmCostUsd,
    usedFallbackSummary: usedFallback,
    reviewReasonCodes: review.reasons.map((item) => item.code),
    usedReviewedTranscript: Boolean(review.reviewedText && review.reviewedText.trim()),
    finalizeJob: {
      jobId: job.id,
      executionId: job.executionId,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      queueLagMs: job.lastQueueLagMs,
      durationMs: duration,
    } as any,
  };

  await touchJobLease(job);

  const finishedAt = new Date();
  await prisma.conversationLog.update({
    where: { id: convo.id },
    data: {
      status: ConversationStatus.DONE,
      artifactJson: toPrismaJson(artifact),
      summaryMarkdown: renderedSummary,
      qualityMetaJson: toPrismaJson(qualityMeta),
    },
  });

  if (shouldGenerateNextMeetingMemo(convo)) {
    await enqueueNextMeetingMemoJob(convo.id);
  }

  await prisma.conversationJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt,
      completedAt: finishedAt,
      lastHeartbeatAt: finishedAt,
      leaseExpiresAt: null,
      model,
      lastRunDurationMs: duration,
      outputJson: toPrismaJson({
        summaryCharCount: renderedSummary.length,
        evidenceChars,
        llmApiCalls: apiCalls,
        usedFallback,
        tokenUsage,
        llmCostUsd,
        executionId: job.executionId,
        attempt: job.attempt,
        studentId: convo.studentId,
        sessionId: convo.sessionId,
      }),
      costMetaJson: toPrismaJson({
        promptVersion: getPromptVersion(),
        inputTokensEstimate,
        outputTokensEstimate: tokenUsage.outputTokens || estimateTokens(renderedSummary),
        inputTokensActual: tokenUsage.inputTokens,
        cachedInputTokensActual: tokenUsage.cachedInputTokens,
        outputTokensActual: tokenUsage.outputTokens,
        llmCostUsd,
        seconds: Math.round(duration / 1000),
        llmApiCalls: apiCalls,
        queueLagMs: job.lastQueueLagMs,
      }),
    },
  });

  await updateConversationStatus(convo.id, ConversationStatus.DONE);
  await syncSessionAfterConversation(convo.id);

  logJobInfo("job_completed", {
    ...buildJobContext(job, convo),
    model,
    durationMs: duration,
    usedFallback,
  });

  await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch((error) => {
    console.warn("[conversation-jobs] failed to stop Runpod worker after finalize", error);
  });

  return {
    summaryMarkdown: renderedSummary,
    duration,
  };
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

async function executeFormatJob(job: JobPayload, convo: ConversationPayload) {
  const sourceText = normalizeSourceText(convo);
  const start = Date.now();
  let formatted: string | null = null;

  await touchJobLease(job);

  if (Array.isArray(convo.rawSegments) && convo.rawSegments.length > 0) {
    formatted = await formatTranscriptFromSegments(convo.rawSegments, {
      studentName: convo.studentName ?? undefined,
      teacherName: convo.teacherName ?? undefined,
    });
  } else if (sourceText) {
    formatted = await formatTranscriptFromText(sourceText, {
      studentName: convo.studentName ?? undefined,
      teacherName: convo.teacherName ?? undefined,
    });
  }

  const duration = Date.now() - start;
  const cleanedFormatted = sanitizeFormattedTranscript(formatted ?? "");
  const finishedAt = new Date();

  await prisma.conversationLog.update({
    where: { id: convo.id },
    data: {
      formattedTranscript: cleanedFormatted || undefined,
      qualityMetaJson: toPrismaJson({
        ...(convo.qualityMetaJson ?? {}),
        jobSecondsFormat: Math.round(duration / 1000),
        formatJob: {
          jobId: job.id,
          executionId: job.executionId,
          attempt: job.attempt,
          maxAttempts: job.maxAttempts,
          queueLagMs: job.lastQueueLagMs,
          durationMs: duration,
        },
      }),
    },
  });

  await prisma.conversationJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt,
      completedAt: finishedAt,
      lastHeartbeatAt: finishedAt,
      leaseExpiresAt: null,
      model: "hybrid",
      lastRunDurationMs: duration,
      outputJson: toPrismaJson({
        formattedLength: cleanedFormatted.length,
        executionId: job.executionId,
        attempt: job.attempt,
        studentId: convo.studentId,
        sessionId: convo.sessionId,
      }),
      costMetaJson: toPrismaJson({
        promptVersion: getPromptVersion(),
        seconds: Math.round(duration / 1000),
        queueLagMs: job.lastQueueLagMs,
      }),
    },
  });

  await updateConversationStatus(convo.id);

  logJobInfo("job_completed", {
    ...buildJobContext(job, convo),
    model: "hybrid",
    durationMs: duration,
  });

  await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch((error) => {
    console.warn("[conversation-jobs] failed to stop Runpod worker after format", error);
  });

  return { formatted: cleanedFormatted, duration };
}

async function executeNextMeetingMemoJob(job: JobPayload, convo: ConversationPayload) {
  if (!shouldGenerateNextMeetingMemo(convo) || !convo.sessionId) {
    const finishedAt = new Date();
    await prisma.conversationJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.DONE,
        finishedAt,
        completedAt: finishedAt,
        lastHeartbeatAt: finishedAt,
        leaseExpiresAt: null,
        model: "skipped",
        lastRunDurationMs: 0,
        outputJson: toPrismaJson({
          skipped: true,
          reason: "not_interview_session",
          executionId: job.executionId,
        }),
      },
    });
    return { skipped: true };
  }

  const startedAt = new Date();

  await prisma.nextMeetingMemo.upsert({
    where: { sessionId: convo.sessionId },
    update: {
      conversationId: convo.id,
      status: NextMeetingMemoStatus.GENERATING,
      errorMessage: null,
      startedAt,
      completedAt: null,
    },
    create: {
      organizationId: convo.organizationId,
      studentId: convo.studentId,
      sessionId: convo.sessionId,
      conversationId: convo.id,
      status: NextMeetingMemoStatus.GENERATING,
      startedAt,
    },
  });

  await touchJobLease(job);

  const start = Date.now();
  const memo = await generateNextMeetingMemo({
    studentName: convo.studentName,
    sessionDate: convo.sessionDate,
    artifactJson: convo.artifactJson,
    summaryMarkdown: convo.summaryMarkdown ?? null,
  });
  const duration = Date.now() - start;
  const finishedAt = new Date();

  await prisma.nextMeetingMemo.update({
    where: { sessionId: convo.sessionId },
    data: {
      status: NextMeetingMemoStatus.READY,
      previousSummary: memo.previousSummary,
      suggestedTopics: memo.suggestedTopics,
      rawJson: toPrismaJson({
        promptVersion: getNextMeetingMemoPromptVersion(),
        apiCalls: memo.apiCalls,
        tokenUsage: memo.tokenUsage,
        llmCostUsd: memo.llmCostUsd,
        sourceSections: memo.sourceSections,
      }),
      model: memo.model,
      errorMessage: null,
      completedAt: finishedAt,
    },
  });

  await prisma.conversationJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt,
      completedAt: finishedAt,
      lastHeartbeatAt: finishedAt,
      leaseExpiresAt: null,
      model: memo.model,
      lastRunDurationMs: duration,
      outputJson: toPrismaJson({
        previousSummaryChars: memo.previousSummary.length,
        suggestedTopicsChars: memo.suggestedTopics.length,
        executionId: job.executionId,
        attempt: job.attempt,
        apiCalls: memo.apiCalls,
      }),
      costMetaJson: toPrismaJson({
        promptVersion: getNextMeetingMemoPromptVersion(),
        tokenUsage: memo.tokenUsage,
        llmCostUsd: memo.llmCostUsd,
        seconds: Math.round(duration / 1000),
        queueLagMs: job.lastQueueLagMs,
      }),
    },
  });

  logJobInfo("job_completed", {
    ...buildJobContext(job, convo),
    model: memo.model,
    durationMs: duration,
  });

  await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch((error) => {
    console.warn("[conversation-jobs] failed to stop Runpod worker after next meeting memo", error);
  });

  return {
    previousSummary: memo.previousSummary,
    suggestedTopics: memo.suggestedTopics,
    duration,
  };
}

async function executeJob(job: JobPayload) {
  const convo = await prisma.conversationLog.findUnique({
    where: { id: job.conversationId },
    include: {
      student: { select: { id: true, name: true } },
      user: { select: { name: true } },
      session: { select: { id: true, type: true, sessionDate: true, parts: { select: { qualityMetaJson: true } } } },
    },
  });
  if (!convo) throw new Error("conversation not found");

  const payload: ConversationPayload = {
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
  };

  logJobInfo("job_started", buildJobContext(job, payload));

  if (job.type === ConversationJobType.FINALIZE) return executeFinalizeJob(job, payload);
  if (job.type === ConversationJobType.GENERATE_NEXT_MEETING_MEMO) {
    return executeNextMeetingMemoJob(job, payload);
  }
  if (job.type === ConversationJobType.FORMAT) return executeFormatJob(job, payload);
  throw new Error(`unsupported job type: ${job.type}`);
}

export async function enqueueConversationJobs(
  conversationId: string,
  opts?: { includeFormat?: boolean }
) {
  const types = [...DEFAULT_JOB_TYPES, ...(opts?.includeFormat ? [ConversationJobType.FORMAT] : [])];
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

async function handleJobFailure(job: JobPayload, error: unknown) {
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

  const logContext = {
    ...buildJobContext(
      job,
      existing
        ? {
            id: job.conversationId,
            organizationId: "unknown",
            studentId: existing.studentId,
            sessionId: existing.sessionId,
          }
        : undefined
    ),
    retryable,
    nextRetryAt: nextRetryAt?.toISOString() ?? null,
    durationMs,
    message,
  };
  if (canRetry) {
    logJobWarn("job_retry_scheduled", logContext);
  } else {
    logJobError("job_failed", logContext);
  }

  await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch((error) => {
    console.warn("[conversation-jobs] failed to stop Runpod worker after job failure", error);
  });

  return {
    message,
    canRetry,
  };
}

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
