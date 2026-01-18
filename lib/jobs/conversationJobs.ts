import { prisma } from "@/lib/db";
import { ConversationJobType, ConversationStatus, JobStatus } from "@prisma/client";
import {
  generateSummaryChunkMemos,
  generateExtractChunkMemos,
  mergeConversationArtifacts,
  getPromptVersion,
  estimateTokens,
} from "@/lib/ai/conversationPipeline";
import { formatTranscriptFromSegments, formatTranscriptFromText } from "@/lib/ai/llm";
import { applyProfileDelta } from "@/lib/profile";
import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";
import type { ConversationQualityMeta, ChunkSummaryMemo, ChunkExtractMemo } from "@/lib/types/conversation";
import { preprocessTranscript } from "@/lib/transcript/preprocess";

const JOB_TYPES: ConversationJobType[] = [
  ConversationJobType.SUMMARY,
  ConversationJobType.EXTRACT,
  ConversationJobType.MERGE,
  ConversationJobType.FORMAT,
];

type JobPayload = {
  id: string;
  conversationId: string;
  type: ConversationJobType;
  attempts: number;
};

type ConversationPayload = {
  id: string;
  studentId: string;
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  rawSegments?: any[] | null;
  formattedTranscript?: string | null;
  studentName?: string | null;
  teacherName?: string | null;
  qualityMetaJson?: ConversationQualityMeta | null;
};

export async function enqueueConversationJobs(conversationId: string) {
  const data = JOB_TYPES.map((type) => ({
    conversationId,
    type,
    status: JobStatus.QUEUED,
  }));
  await prisma.conversationJob.createMany({ data, skipDuplicates: true });
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

function estimateSttSeconds(segments?: Array<{ start?: number; end?: number }> | null) {
  if (!segments?.length) return null;
  const starts = segments.map((s) => s.start ?? 0);
  const ends = segments.map((s) => s.end ?? 0);
  const min = Math.min(...starts);
  const max = Math.max(...ends);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return Math.max(0, max - min);
}

async function claimNextJob(): Promise<JobPayload | null> {
  const queued = await prisma.conversationJob.findMany({
    where: { status: JobStatus.QUEUED },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
    take: 20,
    select: { id: true, conversationId: true, type: true, attempts: true },
  });

  for (const job of queued) {
    if (job.type === ConversationJobType.MERGE) {
      const deps = await prisma.conversationJob.findMany({
        where: {
          conversationId: job.conversationId,
          type: { in: [ConversationJobType.SUMMARY, ConversationJobType.EXTRACT] },
          status: JobStatus.DONE,
        },
        select: { id: true },
      });
      if (deps.length < 2) continue;
    }

    const updated = await prisma.conversationJob.updateMany({
      where: { id: job.id, status: JobStatus.QUEUED },
      data: {
        status: JobStatus.RUNNING,
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (updated.count === 1) return job;
  }

  return null;
}

async function updateConversationStatus(conversationId: string, statusHint?: ConversationStatus) {
  const jobs = await prisma.conversationJob.findMany({
    where: { conversationId },
    select: { type: true, status: true, lastError: true },
  });

  const byType = (type: ConversationJobType) =>
    jobs.find((j) => j.type === type)?.status ?? JobStatus.QUEUED;

  const summaryDone = byType(ConversationJobType.SUMMARY) === JobStatus.DONE;
  const extractDone = byType(ConversationJobType.EXTRACT) === JobStatus.DONE;
  const mergeDone = byType(ConversationJobType.MERGE) === JobStatus.DONE;
  const formatDone = byType(ConversationJobType.FORMAT) === JobStatus.DONE;
  const hasError = jobs.some((j) => j.status === JobStatus.ERROR);

  let status: ConversationStatus = ConversationStatus.PROCESSING;
  if (mergeDone && formatDone) {
    status = ConversationStatus.DONE;
  } else if (mergeDone || summaryDone || extractDone || formatDone) {
    status = ConversationStatus.PARTIAL;
  }

  if (hasError && status === ConversationStatus.PROCESSING) {
    status = ConversationStatus.ERROR;
  }

  if (statusHint) status = statusHint;

  await prisma.conversationLog.update({
    where: { id: conversationId },
    data: { status },
  });
}

async function executeSummaryJob(job: JobPayload, convo: ConversationPayload) {
  const sourceText = normalizeSourceText(convo);
  const pre = preprocessTranscript(sourceText);
  if (pre.blocks.length === 0) {
    throw new Error("No transcript blocks available for SUMMARY job");
  }
  const sttSeconds = estimateSttSeconds(convo.rawSegments);

  const start = Date.now();
  const { memos, model } = await generateSummaryChunkMemos(
    pre.blocks.map((b) => ({ index: b.index, text: b.text })),
    { studentName: convo.studentName ?? undefined, teacherName: convo.teacherName ?? undefined, sttSeconds }
  );
  const duration = Date.now() - start;

  await prisma.conversationJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      model,
      outputJson: { memos },
      costMetaJson: {
        promptVersion: getPromptVersion(),
        inputTokensEstimate: pre.blocks.reduce((acc, b) => acc + b.approxTokens, 0),
        outputTokensEstimate: memos.reduce((acc, m) => acc + estimateTokens(JSON.stringify(m)), 0),
        seconds: Math.round(duration / 1000),
      },
    },
  });

  await prisma.conversationLog.update({
    where: { id: convo.id },
    data: {
      qualityMetaJson: {
        ...(convo.qualityMetaJson ?? {}),
        jobSecondsSummary: Math.round(duration / 1000),
      } as any,
    },
  });

  await updateConversationStatus(convo.id);
  return { memos, duration };
}

async function executeExtractJob(job: JobPayload, convo: ConversationPayload) {
  const sourceText = normalizeSourceText(convo);
  const pre = preprocessTranscript(sourceText);
  if (pre.blocks.length === 0) {
    throw new Error("No transcript blocks available for EXTRACT job");
  }
  const sttSeconds = estimateSttSeconds(convo.rawSegments);

  const start = Date.now();
  const { memos, model } = await generateExtractChunkMemos(
    pre.blocks.map((b) => ({ index: b.index, text: b.text })),
    { studentName: convo.studentName ?? undefined, teacherName: convo.teacherName ?? undefined, sttSeconds }
  );
  const duration = Date.now() - start;

  await prisma.conversationJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      model,
      outputJson: { memos },
      costMetaJson: {
        promptVersion: getPromptVersion(),
        inputTokensEstimate: pre.blocks.reduce((acc, b) => acc + b.approxTokens, 0),
        outputTokensEstimate: memos.reduce((acc, m) => acc + estimateTokens(JSON.stringify(m)), 0),
        seconds: Math.round(duration / 1000),
      },
    },
  });

  await prisma.conversationLog.update({
    where: { id: convo.id },
    data: {
      qualityMetaJson: {
        ...(convo.qualityMetaJson ?? {}),
        jobSecondsExtract: Math.round(duration / 1000),
      } as any,
    },
  });

  await updateConversationStatus(convo.id);
  return { memos, duration };
}

function ensureMemos(data: any): ChunkSummaryMemo[] | ChunkExtractMemo[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.memos)) return data.memos;
  return [];
}

async function executeMergeJob(job: JobPayload, convo: ConversationPayload) {
  const summaryJob = await prisma.conversationJob.findFirst({
    where: { conversationId: convo.id, type: ConversationJobType.SUMMARY, status: JobStatus.DONE },
    select: { outputJson: true, costMetaJson: true },
  });
  const extractJob = await prisma.conversationJob.findFirst({
    where: { conversationId: convo.id, type: ConversationJobType.EXTRACT, status: JobStatus.DONE },
    select: { outputJson: true, costMetaJson: true },
  });

  const summaryMemos = ensureMemos(summaryJob?.outputJson) as ChunkSummaryMemo[];
  const extractMemos = ensureMemos(extractJob?.outputJson) as ChunkExtractMemo[];

  if (!summaryMemos.length || !extractMemos.length) {
    throw new Error("MERGE dependencies not ready");
  }

  const sourceText = normalizeSourceText(convo);
  const minSummaryChars = sourceText.length >= 20000 ? 1200 : 700;

  const start = Date.now();
  const { result, model } = await mergeConversationArtifacts({
    studentName: convo.studentName ?? undefined,
    teacherName: convo.teacherName ?? undefined,
    summaryMemos,
    extractMemos,
    minSummaryChars,
  });
  const duration = Date.now() - start;

  const quotesCountTotal =
    result.timeline.reduce((acc, t) => acc + (t.evidence_quotes?.length ?? 0), 0) +
    result.profileDelta.basic.reduce((acc, i) => acc + (i.evidence_quotes?.length ?? 0), 0) +
    result.profileDelta.personal.reduce((acc, i) => acc + (i.evidence_quotes?.length ?? 0), 0);

  const qualityMeta: ConversationQualityMeta = {
    ...(convo.qualityMetaJson ?? {}),
    modelSummaryFinal: model,
    modelExtractFinal: model,
    summaryCharCount: result.summaryMarkdown.length,
    timelineSectionCount: result.timeline.length,
    todoCount: result.nextActions.length,
    quotesCountTotal,
    jobSecondsMerge: Math.round(duration / 1000),
    promptVersion: getPromptVersion(),
    generatedAt: new Date().toISOString(),
    inputTokensEstimate: estimateTokens(sourceText),
  };

  await prisma.conversationLog.update({
    where: { id: convo.id },
    data: {
      summaryMarkdown: result.summaryMarkdown,
      timelineJson: result.timeline as any,
      nextActionsJson: result.nextActions as any,
      profileDeltaJson: result.profileDelta as any,
      qualityMetaJson: qualityMeta as any,
    },
  });

  await prisma.conversationJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      model,
      outputJson: {
        summaryCharCount: result.summaryMarkdown.length,
        timelineSectionCount: result.timeline.length,
        todoCount: result.nextActions.length,
      },
      costMetaJson: {
        promptVersion: getPromptVersion(),
        inputTokensEstimate: estimateTokens(JSON.stringify({ summaryMemos, extractMemos })),
        outputTokensEstimate: estimateTokens(JSON.stringify(result)),
        seconds: Math.round(duration / 1000),
      },
    },
  });

  try {
    await applyProfileDelta(convo.studentId, result.profileDelta, convo.id);
  } catch (e: any) {
    console.error("[executeMergeJob] applyProfileDelta failed (non-fatal):", e?.message);
  }

  await updateConversationStatus(convo.id);
  return { result, duration };
}

async function executeFormatJob(job: JobPayload, convo: ConversationPayload) {
  const sourceText = normalizeSourceText(convo);
  const start = Date.now();

  let formatted: string | null = null;
  try {
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
  } catch (e: any) {
    console.error("[executeFormatJob] formatTranscript failed:", e?.message);
    throw e;
  }

  const duration = Date.now() - start;

  await prisma.conversationLog.update({
    where: { id: convo.id },
    data: { formattedTranscript: formatted ?? undefined },
  });

  await prisma.conversationJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      model: "hybrid",
      outputJson: {
        formattedLength: formatted?.length ?? 0,
      },
      costMetaJson: {
        promptVersion: getPromptVersion(),
        seconds: Math.round(duration / 1000),
      },
    },
  });

  await prisma.conversationLog.update({
    where: { id: convo.id },
    data: {
      qualityMetaJson: {
        ...(convo.qualityMetaJson ?? {}),
        jobSecondsFormat: Math.round(duration / 1000),
      } as any,
    },
  });

  await updateConversationStatus(convo.id);

  // delete rawTextCleaned when DONE
  const convoAfter = await prisma.conversationLog.findUnique({
    where: { id: convo.id },
    select: { status: true },
  });
  if (convoAfter?.status === ConversationStatus.DONE) {
    await prisma.conversationLog.update({
      where: { id: convo.id },
      data: { rawTextCleaned: null },
    });
  }

  return { formatted, duration };
}

async function executeJob(job: JobPayload) {
  const convo = await prisma.conversationLog.findUnique({
    where: { id: job.conversationId },
    include: {
      student: { select: { name: true } },
      user: { select: { name: true } },
    },
  });
  if (!convo) throw new Error("conversation not found");

  const payload: ConversationPayload = {
    id: convo.id,
    studentId: convo.studentId,
    rawTextOriginal: convo.rawTextOriginal,
    rawTextCleaned: convo.rawTextCleaned,
    rawSegments: (convo.rawSegments as any[]) ?? [],
    formattedTranscript: convo.formattedTranscript,
    studentName: convo.student?.name ?? null,
    teacherName: convo.user?.name ?? DEFAULT_TEACHER_FULL_NAME,
    qualityMetaJson: (convo.qualityMetaJson as ConversationQualityMeta) ?? null,
  };

  if (job.type === ConversationJobType.SUMMARY) return executeSummaryJob(job, payload);
  if (job.type === ConversationJobType.EXTRACT) return executeExtractJob(job, payload);
  if (job.type === ConversationJobType.MERGE) return executeMergeJob(job, payload);
  if (job.type === ConversationJobType.FORMAT) return executeFormatJob(job, payload);
  throw new Error(`unsupported job type: ${job.type}`);
}

export async function processQueuedJobs(
  limit = 1,
  concurrency = 1
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
      const job = await claimNextJob();
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
      } catch (e: any) {
        const msg = e?.message ?? "unknown error";
        errors.push(msg);
        await prisma.conversationJob.update({
          where: { id: job.id },
          data: { status: JobStatus.ERROR, lastError: msg, finishedAt: new Date() },
        });
        const existing = await prisma.conversationLog.findUnique({
          where: { id: job.conversationId },
          select: { qualityMetaJson: true },
        });
        const prev = (existing?.qualityMetaJson as ConversationQualityMeta) ?? {};
        await prisma.conversationLog.update({
          where: { id: job.conversationId },
          data: {
            qualityMetaJson: {
              ...prev,
              errors: [...(prev.errors ?? []), msg],
            } as any,
          },
        });
        await updateConversationStatus(job.conversationId, ConversationStatus.ERROR);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return { processed, errors };
}

export async function processAllConversationJobs(conversationId: string) {
  const envConcurrency = Number(process.env.JOB_CONCURRENCY ?? 3);
  const concurrency = Number.isFinite(envConcurrency) ? envConcurrency : 1;
  const result = await processQueuedJobs(10, concurrency);
  return result;
}
