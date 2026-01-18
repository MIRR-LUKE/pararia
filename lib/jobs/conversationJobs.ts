import { prisma } from "@/lib/db";
import { ConversationJobType, ConversationStatus, JobStatus } from "@prisma/client";
import {
  analyzeChunkBlocks,
  reduceChunkAnalyses,
  finalizeConversationArtifacts,
  getPromptVersion,
  estimateTokens,
} from "@/lib/ai/conversationPipeline";
import { formatTranscriptFromSegments, formatTranscriptFromText } from "@/lib/ai/llm";
import { applyProfileDelta } from "@/lib/profile";
import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";
import type { ConversationQualityMeta, ChunkAnalysis, ReducedAnalysis } from "@/lib/types/conversation";
import { preprocessTranscript, preprocessTranscriptWithSegments } from "@/lib/transcript/preprocess";

const DEFAULT_JOB_TYPES: ConversationJobType[] = [
  ConversationJobType.CHUNK_ANALYZE,
  ConversationJobType.REDUCE,
  ConversationJobType.FINALIZE,
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
  chunkAnalysisJson?: any;
};

export async function enqueueConversationJobs(
  conversationId: string,
  opts?: { includeFormat?: boolean }
) {
  const data = [...DEFAULT_JOB_TYPES, ...(opts?.includeFormat ? [ConversationJobType.FORMAT] : [])].map((type) => ({
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
    if (job.type === ConversationJobType.REDUCE) {
      const deps = await prisma.conversationJob.findMany({
        where: {
          conversationId: job.conversationId,
          type: ConversationJobType.CHUNK_ANALYZE,
          status: JobStatus.DONE,
        },
        select: { id: true },
      });
      if (deps.length < 1) continue;
    }
    if (job.type === ConversationJobType.FINALIZE) {
      const deps = await prisma.conversationJob.findMany({
        where: {
          conversationId: job.conversationId,
          type: ConversationJobType.REDUCE,
          status: JobStatus.DONE,
        },
        select: { id: true },
      });
      if (deps.length < 1) continue;
    }
    if (job.type === ConversationJobType.FORMAT) {
      const deps = await prisma.conversationJob.findMany({
        where: {
          conversationId: job.conversationId,
          type: ConversationJobType.FINALIZE,
          status: JobStatus.DONE,
        },
        select: { id: true },
      });
      if (deps.length < 1) continue;
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

  const analyzeDone = byType(ConversationJobType.CHUNK_ANALYZE) === JobStatus.DONE;
  const reduceDone = byType(ConversationJobType.REDUCE) === JobStatus.DONE;
  const finalizeDone = byType(ConversationJobType.FINALIZE) === JobStatus.DONE;
  const formatJob = jobs.find((j) => j.type === ConversationJobType.FORMAT);
  const formatDone = formatJob ? formatJob.status === JobStatus.DONE : true;
  const hasError = jobs.some((j) => j.status === JobStatus.ERROR);

  let status: ConversationStatus = ConversationStatus.PROCESSING;
  if (finalizeDone && formatDone) {
    status = ConversationStatus.DONE;
  } else if (finalizeDone || reduceDone || analyzeDone || (formatJob && formatJob.status === JobStatus.RUNNING)) {
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

async function executeAnalyzeJob(job: JobPayload, convo: ConversationPayload) {
  const sourceText = normalizeSourceText(convo);
  const pre = Array.isArray(convo.rawSegments) && convo.rawSegments.length > 0
    ? preprocessTranscriptWithSegments(convo.rawTextOriginal ?? sourceText, convo.rawSegments as any)
    : preprocessTranscript(sourceText);
  if (pre.blocks.length === 0) {
    throw new Error("No transcript blocks available for CHUNK_ANALYZE job");
  }

  const start = Date.now();
  const existing = (convo.chunkAnalysisJson as any)?.chunks ?? [];
  const existingByHash = new Map<string, ChunkAnalysis>(
    existing
      .map((c: any) => c?.analysis)
      .filter(Boolean)
      .map((a: ChunkAnalysis) => [a.hash, a])
  );

  const blocks = pre.blocks.map((b) => ({ index: b.index, text: b.text, hash: b.hash }));
  const toAnalyze = blocks.filter((b) => !existingByHash.has(b.hash));

  const { analyses: analyzed, model } = toAnalyze.length
    ? await analyzeChunkBlocks(toAnalyze, {
        studentName: convo.studentName ?? undefined,
        teacherName: convo.teacherName ?? undefined,
      })
    : { analyses: [], model: "reuse" };
  const analyzedByHash = new Map(analyzed.map((a) => [a.hash, a]));

  const merged: ChunkAnalysis[] = blocks.map((b) => {
    const reuse = existingByHash.get(b.hash) ?? analyzedByHash.get(b.hash);
    if (reuse) return { ...reuse, index: b.index, hash: b.hash };
    return {
      index: b.index,
      hash: b.hash,
      facts: [],
      coaching_points: [],
      decisions: [],
      student_state_delta: [],
      todo_candidates: [],
      timeline_candidates: [],
      profile_delta_candidates: { basic: [], personal: [] },
      quotes: [],
      safety_flags: ["NO_ANALYSIS"],
    };
  });
  const duration = Date.now() - start;

  await prisma.conversationJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      model,
      outputJson: {
        chunks: merged,
        reused: blocks.length - toAnalyze.length,
        analyzed: toAnalyze.length,
      },
      costMetaJson: {
        promptVersion: getPromptVersion(),
        inputTokensEstimate: pre.blocks.reduce((acc, b) => acc + b.approxTokens, 0),
        outputTokensEstimate: estimateTokens(JSON.stringify(merged)),
        seconds: Math.round(duration / 1000),
      },
    },
  });

  await prisma.conversationLog.update({
    where: { id: convo.id },
    data: {
      chunkAnalysisJson: {
        chunks: merged.map((a) => ({ hash: a.hash, analysis: a })),
        updatedAt: new Date().toISOString(),
      },
      qualityMetaJson: {
        ...(convo.qualityMetaJson ?? {}),
        modelAnalyze: model,
        jobSecondsAnalyze: Math.round(duration / 1000),
      } as any,
    },
  });

  await updateConversationStatus(convo.id);
  return { analyses: merged, duration };
}

function ensureAnalyses(data: any): ChunkAnalysis[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as ChunkAnalysis[];
  if (Array.isArray(data.chunks)) return data.chunks as ChunkAnalysis[];
  return [];
}

async function executeReduceJob(job: JobPayload, convo: ConversationPayload) {
  const analysisJob = await prisma.conversationJob.findFirst({
    where: { conversationId: convo.id, type: ConversationJobType.CHUNK_ANALYZE, status: JobStatus.DONE },
    select: { outputJson: true },
  });

  const chunkJson = analysisJob?.outputJson ?? convo.chunkAnalysisJson ?? {};
  const rawChunks = (chunkJson as any)?.chunks ?? [];
  const analyses = ensureAnalyses(rawChunks.map((c: any) => c?.analysis ?? c));
  if (!analyses.length) {
    throw new Error("REDUCE dependencies not ready");
  }

  const start = Date.now();
  const { reduced, model } = await reduceChunkAnalyses({
    analyses,
    studentName: convo.studentName ?? undefined,
    teacherName: convo.teacherName ?? undefined,
  });
  const duration = Date.now() - start;

  await prisma.conversationJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      model,
      outputJson: { reduced },
      costMetaJson: {
        promptVersion: getPromptVersion(),
        inputTokensEstimate: estimateTokens(JSON.stringify(analyses)),
        outputTokensEstimate: estimateTokens(JSON.stringify(reduced)),
        seconds: Math.round(duration / 1000),
      },
    },
  });

  await prisma.conversationLog.update({
    where: { id: convo.id },
    data: {
      qualityMetaJson: {
        ...(convo.qualityMetaJson ?? {}),
        modelReduce: model,
        jobSecondsReduce: Math.round(duration / 1000),
      } as any,
    },
  });

  await updateConversationStatus(convo.id);
  return { reduced, duration };
}

async function executeFinalizeJob(job: JobPayload, convo: ConversationPayload) {
  const reduceJob = await prisma.conversationJob.findFirst({
    where: { conversationId: convo.id, type: ConversationJobType.REDUCE, status: JobStatus.DONE },
    select: { outputJson: true },
  });

  const reduced = (reduceJob?.outputJson as any)?.reduced as ReducedAnalysis | undefined;
  if (!reduced) {
    throw new Error("FINALIZE dependencies not ready");
  }

  const sourceText = normalizeSourceText(convo);
  const minSummaryChars = sourceText.length >= 20000 ? 1200 : 700;

  const start = Date.now();
  const { result, model } = await finalizeConversationArtifacts({
    studentName: convo.studentName ?? undefined,
    teacherName: convo.teacherName ?? undefined,
    reduced,
    minSummaryChars,
  });
  const duration = Date.now() - start;

  const quotesCountTotal =
    result.timeline.reduce((acc, t) => acc + (t.evidence_quotes?.length ?? 0), 0) +
    result.profileDelta.basic.reduce((acc, i) => acc + (i.evidence_quotes?.length ?? 0), 0) +
    result.profileDelta.personal.reduce((acc, i) => acc + (i.evidence_quotes?.length ?? 0), 0) +
    (result.parentPack?.evidence_quotes?.length ?? 0);

  const qualityMeta: ConversationQualityMeta = {
    ...(convo.qualityMetaJson ?? {}),
    modelFinalize: model,
    summaryCharCount: result.summaryMarkdown.length,
    timelineSectionCount: result.timeline.length,
    todoCount: result.nextActions.length,
    quotesCountTotal,
    jobSecondsFinalize: Math.round(duration / 1000),
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
      parentPackJson: result.parentPack as any,
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
        inputTokensEstimate: estimateTokens(JSON.stringify(reduced)),
        outputTokensEstimate: estimateTokens(JSON.stringify(result)),
        seconds: Math.round(duration / 1000),
      },
    },
  });

  try {
    await applyProfileDelta(convo.studentId, result.profileDelta, convo.id);
  } catch (e: any) {
    console.error("[executeFinalizeJob] applyProfileDelta failed (non-fatal):", e?.message);
  }

  await updateConversationStatus(convo.id);

  const formatJob = await prisma.conversationJob.findFirst({
    where: { conversationId: convo.id, type: ConversationJobType.FORMAT },
    select: { id: true },
  });
  if (!formatJob) {
    await prisma.conversationLog.update({
      where: { id: convo.id },
      data: { rawTextCleaned: null },
    });
  }

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
    chunkAnalysisJson: (convo.chunkAnalysisJson as any) ?? null,
  };

  if (job.type === ConversationJobType.CHUNK_ANALYZE) return executeAnalyzeJob(job, payload);
  if (job.type === ConversationJobType.REDUCE) return executeReduceJob(job, payload);
  if (job.type === ConversationJobType.FINALIZE) return executeFinalizeJob(job, payload);
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
