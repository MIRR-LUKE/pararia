import { prisma } from "@/lib/db";
import { ConversationJobType, ConversationStatus, JobStatus, Prisma, SessionStatus, SessionType } from "@prisma/client";
import { estimateTokens, generateConversationDraftFast, getPromptVersion } from "@/lib/ai/conversationPipeline";
import { formatTranscriptFromSegments, formatTranscriptFromText } from "@/lib/ai/llm";
import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";
import type { ConversationQualityMeta } from "@/lib/types/conversation";
import { syncSessionAfterConversation } from "@/lib/session-service";
import { toPrismaJson } from "@/lib/prisma-json";

const DEFAULT_JOB_TYPES: ConversationJobType[] = [ConversationJobType.FINALIZE];
const ACTIVE_JOB_TYPES: ConversationJobType[] = [ConversationJobType.FINALIZE, ConversationJobType.FORMAT];
const JOB_PRIORITY: Partial<Record<ConversationJobType, number>> = {
  [ConversationJobType.FINALIZE]: 0,
  [ConversationJobType.FORMAT]: 1,
};
const JOB_EXECUTION_RETRIES = Math.max(0, Math.min(3, Number(process.env.JOB_EXECUTION_RETRIES ?? 2)));

type JobPayload = {
  id: string;
  conversationId: string;
  type: ConversationJobType;
  attempts: number;
};

type ProcessJobsOptions = {
  conversationId?: string;
};

type ConversationPayload = {
  id: string;
  sessionId?: string | null;
  sessionType?: SessionType | null;
  sessionDate?: Date | string | null;
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  rawSegments?: any[] | null;
  formattedTranscript?: string | null;
  summaryMarkdown?: string | null;
  studentName?: string | null;
  teacherName?: string | null;
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

function waitForJobRetry(attempt: number) {
  const base = Math.min(5000, 700 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 300);
  return new Promise((resolve) => setTimeout(resolve, base + jitter));
}

async function executeJobWithRetry(job: JobPayload) {
  for (let attempt = 0; attempt <= JOB_EXECUTION_RETRIES; attempt += 1) {
    try {
      await executeJob(job);
      return;
    } catch (error) {
      if (attempt >= JOB_EXECUTION_RETRIES || !isRetryableJobError(error)) {
        throw error;
      }
      await waitForJobRetry(attempt);
    }
  }
}

function normalizeSourceText(payload: ConversationPayload) {
  if (payload.rawTextCleaned?.trim()) return payload.rawTextCleaned;
  if (payload.rawTextOriginal?.trim()) return payload.rawTextOriginal;
  if (payload.formattedTranscript?.trim()) {
    return payload.formattedTranscript
      .split("\n")
      .map((line) => line.replace(/^\*\*[^*]+\*\*:\s*/g, ""))
      .join("\n")
      .trim();
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

function dependencySatisfied(
  type: ConversationJobType,
  statusByType: Map<ConversationJobType, JobStatus>
) {
  if (type === ConversationJobType.FINALIZE) return true;
  if (type === ConversationJobType.FORMAT) {
    const finalizeStatus = statusByType.get(ConversationJobType.FINALIZE);
    return typeof finalizeStatus === "undefined" || finalizeStatus === JobStatus.DONE;
  }
  return false;
}

async function claimNextJob(opts?: ProcessJobsOptions): Promise<JobPayload | null> {
  await prisma.conversationJob.deleteMany({
    where: {
      ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
      type: { notIn: ACTIVE_JOB_TYPES },
    },
  });

  const queued = await prisma.conversationJob.findMany({
    where: {
      status: JobStatus.QUEUED,
      type: { in: ACTIVE_JOB_TYPES },
      ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
    },
    orderBy: [{ createdAt: "asc" }],
    take: 50,
    select: { id: true, conversationId: true, type: true, attempts: true, createdAt: true },
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
    const updated = await prisma.conversationJob.updateMany({
      where: { id: job.id, status: JobStatus.QUEUED },
      data: {
        status: JobStatus.RUNNING,
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (updated.count === 1) {
      return {
        id: job.id,
        conversationId: job.conversationId,
        type: job.type,
        attempts: job.attempts,
      };
    }
  }

  return null;
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

async function executeFinalizeJob(job: JobPayload, convo: ConversationPayload) {
  const sourceText = normalizeSourceText(convo);
  if (!sourceText.trim()) {
    throw new Error("raw transcript is missing");
  }

  const minSummaryChars = minSummaryCharsFor({
    sessionType: convo.sessionType,
    sourceText,
  });
  const start = Date.now();
  const {
    summaryMarkdown,
    model,
    apiCalls,
    evidenceChars,
    usedFallback,
    inputTokensEstimate,
  } = await generateConversationDraftFast({
    transcript: sourceText,
    studentName: convo.studentName ?? undefined,
    teacherName: convo.teacherName ?? undefined,
    sessionDate: convo.sessionDate ?? undefined,
    minSummaryChars,
    sessionType: convo.sessionType === SessionType.LESSON_REPORT ? "LESSON_REPORT" : "INTERVIEW",
  });
  const duration = Date.now() - start;
  const cleanedSummary = summaryMarkdown.trim();
  if (!cleanedSummary) {
    throw new Error("summary generation returned empty markdown");
  }

  const qualityMeta: ConversationQualityMeta = {
    ...(convo.qualityMetaJson ?? {}),
    modelFinalize: model,
    summaryCharCount: cleanedSummary.length,
    jobSecondsFinalize: Math.round(duration / 1000),
    llmApiCallsFinalize: apiCalls,
    promptVersion: getPromptVersion(),
    generatedAt: new Date().toISOString(),
    inputTokensEstimate,
    outputTokensEstimate: estimateTokens(cleanedSummary),
    usedFallbackSummary: usedFallback,
  };

  await prisma.conversationLog.update({
    where: { id: convo.id },
    data: {
      status: ConversationStatus.DONE,
      summaryMarkdown: cleanedSummary,
      qualityMetaJson: toPrismaJson(qualityMeta),
    },
  });

  await prisma.conversationJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      model,
      outputJson: toPrismaJson({
        summaryCharCount: cleanedSummary.length,
        evidenceChars,
        llmApiCalls: apiCalls,
        usedFallback,
      }),
      costMetaJson: toPrismaJson({
        promptVersion: getPromptVersion(),
        inputTokensEstimate,
        outputTokensEstimate: estimateTokens(cleanedSummary),
        seconds: Math.round(duration / 1000),
        llmApiCalls: apiCalls,
      }),
    },
  });

  await updateConversationStatus(convo.id, ConversationStatus.DONE);
  await syncSessionAfterConversation(convo.id);

  return {
    summaryMarkdown: cleanedSummary,
    duration,
  };
}

async function executeFormatJob(job: JobPayload, convo: ConversationPayload) {
  const sourceText = normalizeSourceText(convo);
  const start = Date.now();
  let formatted: string | null = null;

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

  await prisma.conversationLog.update({
    where: { id: convo.id },
    data: {
      formattedTranscript: formatted ?? undefined,
      qualityMetaJson: toPrismaJson({
        ...(convo.qualityMetaJson ?? {}),
        jobSecondsFormat: Math.round(duration / 1000),
      }),
    },
  });

  await prisma.conversationJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      model: "hybrid",
      outputJson: toPrismaJson({
        formattedLength: formatted?.length ?? 0,
      }),
      costMetaJson: toPrismaJson({
        promptVersion: getPromptVersion(),
        seconds: Math.round(duration / 1000),
      }),
    },
  });

  await updateConversationStatus(convo.id);

  return { formatted, duration };
}

async function executeJob(job: JobPayload) {
  const convo = await prisma.conversationLog.findUnique({
    where: { id: job.conversationId },
    include: {
      student: { select: { name: true } },
      user: { select: { name: true } },
      session: { select: { id: true, type: true, sessionDate: true } },
    },
  });
  if (!convo) throw new Error("conversation not found");

  const payload: ConversationPayload = {
    id: convo.id,
    sessionId: convo.sessionId,
    sessionType: convo.session?.type ?? null,
    sessionDate: convo.session?.sessionDate ?? null,
    rawTextOriginal: convo.rawTextOriginal,
    rawTextCleaned: convo.rawTextCleaned,
    rawSegments: (convo.rawSegments as any[]) ?? [],
    formattedTranscript: convo.formattedTranscript,
    summaryMarkdown: convo.summaryMarkdown,
    studentName: convo.student?.name ?? null,
    teacherName: convo.user?.name ?? DEFAULT_TEACHER_FULL_NAME,
    qualityMetaJson: (convo.qualityMetaJson as ConversationQualityMeta) ?? null,
  };

  if (job.type === ConversationJobType.FINALIZE) return executeFinalizeJob(job, payload);
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
          lastError: null,
          outputJson: Prisma.DbNull,
          costMetaJson: Prisma.DbNull,
          startedAt: null,
          finishedAt: null,
        },
        create: {
          conversationId,
          type,
          status: JobStatus.QUEUED,
        },
      })
    )
  );
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
        await executeJobWithRetry(job);
        processed += 1;
      } catch (error: any) {
        const message = error?.message ?? "unknown error";
        errors.push(message);
        await prisma.conversationJob.update({
          where: { id: job.id },
          data: { status: JobStatus.ERROR, lastError: message, finishedAt: new Date() },
        });
        const existing = await prisma.conversationLog.findUnique({
          where: { id: job.conversationId },
          select: { qualityMetaJson: true, sessionId: true },
        });
        const prev = (existing?.qualityMetaJson as ConversationQualityMeta) ?? {};
        await prisma.conversationLog.update({
          where: { id: job.conversationId },
          data: {
            qualityMetaJson: toPrismaJson({
              ...prev,
              errors: [...(prev.errors ?? []), message],
            }),
          },
        });

        if (job.type === ConversationJobType.FINALIZE) {
          await updateConversationStatus(job.conversationId, ConversationStatus.ERROR);
          if (existing?.sessionId) {
            await prisma.session.update({
              where: { id: existing.sessionId },
              data: { status: SessionStatus.ERROR },
            });
          }
        } else {
          await updateConversationStatus(job.conversationId);
        }
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
