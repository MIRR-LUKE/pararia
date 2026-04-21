import { ConversationJobType, ConversationStatus, JobStatus, NextMeetingMemoStatus, SessionType } from "@prisma/client";
import { estimateTokens, generateConversationDraftFast, getPromptVersion } from "@/lib/ai/conversationPipeline";
import {
  generateNextMeetingMemo,
  getNextMeetingMemoPromptVersion,
} from "@/lib/ai/next-meeting-memo";
import { formatTranscriptFromSegments, formatTranscriptFromText } from "@/lib/ai/llm";
import { renderConversationArtifactMarkdown } from "@/lib/conversation-artifact";
import { syncSessionAfterConversation } from "@/lib/session-service";
import { toPrismaJson } from "@/lib/prisma-json";
import { sanitizeFormattedTranscript } from "@/lib/user-facing-japanese";
import type { ConversationQualityMeta } from "@/lib/types/conversation";
import { ensureConversationReviewedTranscript } from "@/lib/transcript/review";
import { normalizeRawTranscriptText } from "@/lib/transcript/source";
import { buildJobContext, minSummaryCharsFor, normalizeSourceText, shouldGenerateNextMeetingMemo } from "./shared";
import type { ConversationPayload, JobPayload } from "./types";
import {
  enqueueNextMeetingMemoJob,
  loadConversationPayload,
  touchJobLease,
  updateConversationStatus,
} from "./repository";
import { logJobInfo, stopRunpodWorkerAfterConversationJob } from "./side-effects";
import { prisma } from "@/lib/db";

type FinalizeSideEffectRunner = {
  enqueueNextMeetingMemoJob?: typeof enqueueNextMeetingMemoJob;
  syncSessionAfterConversation?: typeof syncSessionAfterConversation;
};

function readConversationMetaRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function readFinalizeJobMeta(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

async function loadConversationQualityMeta(conversationId: string) {
  const conversation = await prisma.conversationLog.findUnique({
    where: { id: conversationId },
    select: {
      qualityMetaJson: true,
    },
  });
  return readConversationMetaRecord(conversation?.qualityMetaJson);
}

async function mergeConversationFinalizeMeta(
  conversationId: string,
  patch: Record<string, unknown>
) {
  const previousMeta = await loadConversationQualityMeta(conversationId);
  const previousFinalizeJob = readFinalizeJobMeta(previousMeta.finalizeJob);

  await prisma.conversationLog.update({
    where: { id: conversationId },
    data: {
      qualityMetaJson: toPrismaJson({
        ...previousMeta,
        finalizeJob: {
          ...previousFinalizeJob,
          ...patch,
        },
      }),
    },
  });
}

export async function runFinalizeBestEffortSideEffects(
  convo: Pick<ConversationPayload, "id" | "sessionId">,
  opts?: {
    shouldGenerateNextMeetingMemo?: boolean;
    runners?: FinalizeSideEffectRunner;
  }
) {
  const shouldGenerateNextMeetingMemo = opts?.shouldGenerateNextMeetingMemo ?? false;
  const runners = opts?.runners ?? {};
  const enqueueNextMeetingMemo = runners.enqueueNextMeetingMemoJob ?? enqueueNextMeetingMemoJob;
  const syncSession = runners.syncSessionAfterConversation ?? syncSessionAfterConversation;

  const tasks: Promise<unknown>[] = [];
  if (shouldGenerateNextMeetingMemo) {
    tasks.push(
      Promise.resolve()
        .then(() => enqueueNextMeetingMemo(convo.id))
        .catch((error) => {
          console.warn("[conversation-jobs] failed to enqueue next meeting memo after finalize", {
            conversationId: convo.id,
            message: error instanceof Error ? error.message : String(error ?? "unknown error"),
          });
        })
    );
  }

  if (convo.sessionId) {
    tasks.push(
      Promise.resolve()
        .then(() => syncSession(convo.id))
        .catch((error) => {
          console.warn("[conversation-jobs] failed to sync session after finalize", {
            conversationId: convo.id,
            sessionId: convo.sessionId,
            message: error instanceof Error ? error.message : String(error ?? "unknown error"),
          });
        })
    );
  }
  await Promise.all(tasks);
}

async function executeFinalizeJob(job: JobPayload, convo: ConversationPayload) {
  const reviewStartedAt = new Date().toISOString();
  await mergeConversationFinalizeMeta(convo.id, {
    conversationJobClaimedAt: job.startedAt.toISOString(),
    reviewStartedAt,
  });
  const review = await ensureConversationReviewedTranscript(convo.id);
  const reviewCompletedAt = new Date().toISOString();
  const reviewDurationMs = Math.max(0, Date.parse(reviewCompletedAt) - Date.parse(reviewStartedAt));
  await mergeConversationFinalizeMeta(convo.id, {
    reviewCompletedAt,
    reviewDurationMs,
  });
  const sourceText = normalizeRawTranscriptText(review.reviewedText || review.rawTextOriginal || normalizeSourceText(convo));
  if (!sourceText.trim()) {
    throw new Error("raw transcript is missing");
  }

  const minSummaryChars = minSummaryCharsFor({
    sessionType: convo.sessionType,
    sourceText,
  });
  await touchJobLease(job);

  const finalizeStartedAt = new Date().toISOString();
  await mergeConversationFinalizeMeta(convo.id, {
    finalizeStartedAt,
  });
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
    promptCacheKey,
    promptCacheRetention,
    promptCacheStablePrefixChars,
    promptCacheStablePrefixTokensEstimate,
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
  const latestQualityMeta = await loadConversationQualityMeta(convo.id);
  const previousFinalizeJob = readFinalizeJobMeta(latestQualityMeta.finalizeJob);

  const qualityMeta: ConversationQualityMeta = {
    ...(latestQualityMeta as ConversationQualityMeta),
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
    promptCacheKey: promptCacheKey ?? null,
    promptCacheRetention: promptCacheRetention ?? null,
    promptCacheStablePrefixChars: promptCacheStablePrefixChars ?? undefined,
    promptCacheStablePrefixTokensEstimate: promptCacheStablePrefixTokensEstimate ?? undefined,
    usedFallbackSummary: usedFallback,
    reviewReasonCodes: review.reasons.map((item) => item.code),
    usedReviewedTranscript: Boolean(review.reviewedText && review.reviewedText.trim()),
    finalizeJob: {
      ...previousFinalizeJob,
      jobId: job.id,
      executionId: job.executionId,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      queueLagMs: job.lastQueueLagMs,
      durationMs: duration,
      conversationJobClaimedAt: job.startedAt.toISOString(),
      reviewStartedAt,
      reviewCompletedAt,
      reviewDurationMs,
      finalizeStartedAt,
    } as Record<string, unknown>,
  };

  await touchJobLease(job);

  const finishedAt = new Date();
  await prisma.conversationLog.update({
    where: { id: convo.id },
    data: {
      status: ConversationStatus.DONE,
      artifactJson: toPrismaJson(artifact),
      summaryMarkdown: renderedSummary,
      qualityMetaJson: toPrismaJson({
        ...qualityMeta,
        finalizeJob: {
          ...(qualityMeta.finalizeJob ?? {}),
          finalizeCompletedAt: finishedAt.toISOString(),
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
      model,
      lastRunDurationMs: duration,
      outputJson: toPrismaJson({
        summaryCharCount: renderedSummary.length,
        evidenceChars,
        llmApiCalls: apiCalls,
        usedFallback,
        tokenUsage,
        llmCostUsd,
        promptCacheKey: promptCacheKey ?? null,
        promptCacheRetention: promptCacheRetention ?? null,
        promptCacheStablePrefixChars: promptCacheStablePrefixChars ?? null,
        promptCacheStablePrefixTokensEstimate: promptCacheStablePrefixTokensEstimate ?? null,
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
        promptCacheKey: promptCacheKey ?? null,
        promptCacheRetention: promptCacheRetention ?? null,
        promptCacheStablePrefixChars: promptCacheStablePrefixChars ?? null,
        promptCacheStablePrefixTokensEstimate: promptCacheStablePrefixTokensEstimate ?? null,
        seconds: Math.round(duration / 1000),
        llmApiCalls: apiCalls,
        queueLagMs: job.lastQueueLagMs,
      }),
    },
  });

  await updateConversationStatus(convo.id, ConversationStatus.DONE);

  logJobInfo("job_completed", {
    ...buildJobContext(job, convo),
    model,
    durationMs: duration,
    usedFallback,
  });

  await runFinalizeBestEffortSideEffects(convo, {
    shouldGenerateNextMeetingMemo: shouldGenerateNextMeetingMemo(convo),
  });

  return {
    summaryMarkdown: renderedSummary,
    duration,
  };
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

  void stopRunpodWorkerAfterConversationJob("format");

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
        promptCacheKey: memo.promptCacheKey ?? null,
        promptCacheRetention: memo.promptCacheRetention ?? null,
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

  void stopRunpodWorkerAfterConversationJob("next meeting memo");

  return {
    previousSummary: memo.previousSummary,
    suggestedTopics: memo.suggestedTopics,
    duration,
  };
}

export async function executeJob(job: JobPayload) {
  const convo = await loadConversationPayload(job.conversationId);
  logJobInfo("job_started", buildJobContext(job, convo));

  if (job.type === ConversationJobType.FINALIZE) return executeFinalizeJob(job, convo);
  if (job.type === ConversationJobType.GENERATE_NEXT_MEETING_MEMO) {
    return executeNextMeetingMemoJob(job, convo);
  }
  if (job.type === ConversationJobType.FORMAT) return executeFormatJob(job, convo);
  throw new Error(`unsupported job type: ${job.type}`);
}
