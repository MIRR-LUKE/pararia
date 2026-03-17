import { prisma } from "@/lib/db";
import { ConversationJobType, ConversationStatus, JobStatus, SessionStatus, SessionType } from "@prisma/client";
import {
  analyzeChunkBlocks,
  reduceChunkAnalyses,
  finalizeConversationArtifacts,
  generateConversationArtifactsSinglePass,
  getPromptVersion,
  estimateTokens,
} from "@/lib/ai/conversationPipeline";
import { formatTranscriptFromSegments, formatTranscriptFromText } from "@/lib/ai/llm";
import { applyProfileDelta } from "@/lib/profile";
import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";
import type { ConversationQualityMeta, ChunkAnalysis, ReducedAnalysis } from "@/lib/types/conversation";
import { preprocessTranscript, preprocessTranscriptWithSegments } from "@/lib/transcript/preprocess";
import { getEntityDictionary, syncSessionAfterConversation } from "@/lib/session-service";
import { buildOperationalLog, renderOperationalSummaryMarkdown } from "@/lib/operational-log";

const DEFAULT_JOB_TYPES: ConversationJobType[] = [
  ConversationJobType.CHUNK_ANALYZE,
  ConversationJobType.REDUCE,
  ConversationJobType.FINALIZE,
];

const JOB_PRIORITY: Record<ConversationJobType, number> = {
  [ConversationJobType.CHUNK_ANALYZE]: 0,
  [ConversationJobType.REDUCE]: 1,
  [ConversationJobType.FINALIZE]: 2,
  [ConversationJobType.FORMAT]: 3,
  [ConversationJobType.REPORT]: 4,
};

const activeConversationRuns = new Set<string>();
const ENABLE_SINGLE_PASS_MODE = process.env.ENABLE_SINGLE_PASS_MODE !== "0";
const SINGLE_PASS_MAX_BLOCKS = Math.max(1, Math.min(4, Number(process.env.SINGLE_PASS_MAX_BLOCKS ?? 2)));
const SINGLE_PASS_MAX_CHARS = Math.max(1200, Number(process.env.SINGLE_PASS_MAX_CHARS ?? 12000));

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
  studentId: string;
  sessionId?: string | null;
  sessionType?: SessionType | null;
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  rawSegments?: any[] | null;
  formattedTranscript?: string | null;
  summaryMarkdown?: string | null;
  timelineJson?: any;
  nextActionsJson?: any;
  profileDeltaJson?: any;
  parentPackJson?: any;
  studentStateJson?: any;
  topicSuggestionsJson?: any;
  quickQuestionsJson?: any;
  profileSectionsJson?: any;
  observationJson?: any;
  entityCandidatesJson?: any;
  lessonReportJson?: any;
  studentName?: string | null;
  teacherName?: string | null;
  qualityMetaJson?: ConversationQualityMeta | null;
  chunkAnalysisJson?: any;
  entityDictionary?: Array<{ kind: string; canonicalName: string; aliases?: string[] }>;
};

export async function enqueueConversationJobs(
  conversationId: string,
  opts?: { includeFormat?: boolean }
) {
  try {
    const data = [...DEFAULT_JOB_TYPES, ...(opts?.includeFormat ? [ConversationJobType.FORMAT] : [])].map((type) => ({
      conversationId,
      type,
      status: JobStatus.QUEUED,
    }));
    const result = await prisma.conversationJob.createMany({ data, skipDuplicates: true });
    console.log("[enqueueConversationJobs] Jobs enqueued:", {
      conversationId,
      count: result.count,
      types: data.map((d) => d.type),
    });
    return result;
  } catch (e: any) {
    console.error("[enqueueConversationJobs] Failed to enqueue jobs:", {
      conversationId,
      error: e?.message,
      code: e?.code,
      stack: e?.stack,
    });
    throw new Error(`Failed to enqueue jobs: ${e?.message ?? "unknown error"}`);
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

function hasSinglePassArtifacts(payload: ConversationPayload) {
  const hasTimeline = Array.isArray(payload.timelineJson) && payload.timelineJson.length > 0;
  const hasActions = Array.isArray(payload.nextActionsJson) && payload.nextActionsJson.length > 0;
  return Boolean(
    payload.summaryMarkdown?.trim() &&
    hasTimeline &&
    hasActions &&
    payload.profileDeltaJson &&
    payload.parentPackJson
  );
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

function dependencySatisfied(
  type: ConversationJobType,
  statusByType: Map<ConversationJobType, JobStatus>
) {
  if (type === ConversationJobType.CHUNK_ANALYZE) return true;
  if (type === ConversationJobType.REDUCE) {
    return statusByType.get(ConversationJobType.CHUNK_ANALYZE) === JobStatus.DONE;
  }
  if (type === ConversationJobType.FINALIZE) {
    return statusByType.get(ConversationJobType.REDUCE) === JobStatus.DONE;
  }
  if (type === ConversationJobType.FORMAT) {
    return statusByType.get(ConversationJobType.FINALIZE) === JobStatus.DONE;
  }
  return true;
}

async function claimNextJob(opts?: ProcessJobsOptions): Promise<JobPayload | null> {
  const queued = await prisma.conversationJob.findMany({
    where: {
      status: JobStatus.QUEUED,
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
      type: {
        in: [
          ConversationJobType.CHUNK_ANALYZE,
          ConversationJobType.REDUCE,
          ConversationJobType.FINALIZE,
        ],
      },
    },
    select: { conversationId: true, type: true, status: true },
  });

  const statusByConversation = new Map<string, Map<ConversationJobType, JobStatus>>();
  for (const state of states) {
    const byType =
      statusByConversation.get(state.conversationId) ?? new Map<ConversationJobType, JobStatus>();
    byType.set(state.type, state.status);
    statusByConversation.set(state.conversationId, byType);
  }

  const eligible = queued
    .filter((job) => dependencySatisfied(job.type, statusByConversation.get(job.conversationId) ?? new Map()))
    .sort((a, b) => {
      const pri = JOB_PRIORITY[a.type] - JOB_PRIORITY[b.type];
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

  const sourceLength = sourceText.length;
  const minSummaryChars = sourceLength >= 20000 ? 1200 : sourceLength < 3000 ? 380 : 700;
  const minTimelineSections = sourceLength >= 12000 ? 3 : 2;
  const singlePassEligible =
    ENABLE_SINGLE_PASS_MODE &&
    pre.blocks.length <= SINGLE_PASS_MAX_BLOCKS &&
    sourceLength <= SINGLE_PASS_MAX_CHARS &&
    !hasSinglePassArtifacts(convo);

  if (singlePassEligible) {
    const start = Date.now();
    const { result, model, apiCalls, repaired } = await generateConversationArtifactsSinglePass({
      transcript: sourceText,
      studentName: convo.studentName ?? undefined,
      teacherName: convo.teacherName ?? undefined,
      minSummaryChars,
      minTimelineSections,
      sessionType: convo.sessionType === SessionType.LESSON_REPORT ? "LESSON_REPORT" : "INTERVIEW",
      entityDictionary: convo.entityDictionary,
    });
    const duration = Date.now() - start;
    const quotesCountTotal =
      result.timeline.reduce((acc, t) => acc + (t.evidence_quotes?.length ?? 0), 0) +
      result.profileDelta.basic.reduce((acc, i) => acc + (i.evidence_quotes?.length ?? 0), 0) +
      result.profileDelta.personal.reduce((acc, i) => acc + (i.evidence_quotes?.length ?? 0), 0) +
      (result.parentPack?.evidence_quotes?.length ?? 0);
    const summaryMarkdown = renderOperationalSummaryMarkdown(
      buildOperationalLog({
        sessionType: convo.sessionType,
        createdAt: new Date(),
        summaryMarkdown: result.summaryMarkdown,
        timeline: result.timeline as any,
        nextActions: result.nextActions as any,
        parentPack: result.parentPack as any,
        studentState: result.studentState as any,
        profileSections: result.profileSections as any,
        quickQuestions: result.quickQuestions as any,
        entityCandidates: result.entityCandidates as any,
        lessonReport: result.lessonReport as any,
      })
    );

    await prisma.conversationLog.update({
      where: { id: convo.id },
      data: {
        summaryMarkdown,
        timelineJson: result.timeline as any,
        nextActionsJson: result.nextActions as any,
        profileDeltaJson: result.profileDelta as any,
        parentPackJson: result.parentPack as any,
        studentStateJson: result.studentState as any,
        topicSuggestionsJson: result.recommendedTopics as any,
        quickQuestionsJson: result.quickQuestions as any,
        profileSectionsJson: result.profileSections as any,
        observationJson: result.observationEvents as any,
        entityCandidatesJson: result.entityCandidates as any,
        lessonReportJson: result.lessonReport as any,
        qualityMetaJson: {
          ...(convo.qualityMetaJson ?? {}),
          singlePassMode: true,
          singlePassRepaired: repaired,
          modelSinglePass: model,
          jobSecondsSinglePass: Math.round(duration / 1000),
          llmApiCallsSinglePass: apiCalls,
          modelAnalyze: model,
          modelFinalize: model,
          jobSecondsAnalyze: Math.round(duration / 1000),
          llmApiCallsAnalyze: apiCalls,
          finalizeRepaired: repaired,
          summaryCharCount: summaryMarkdown.length,
          timelineSectionCount: result.timeline.length,
          todoCount: result.nextActions.length,
          quotesCountTotal,
          promptVersion: getPromptVersion(),
          generatedAt: new Date().toISOString(),
          inputTokensEstimate: estimateTokens(sourceText),
        } as any,
      },
    });

    await prisma.conversationJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.DONE,
        finishedAt: new Date(),
        model,
        outputJson: {
          mode: "single-pass",
          summaryCharCount: summaryMarkdown.length,
          timelineSectionCount: result.timeline.length,
          todoCount: result.nextActions.length,
          llmApiCalls: apiCalls,
          repaired,
        },
        costMetaJson: {
          promptVersion: getPromptVersion(),
          inputTokensEstimate: pre.blocks.reduce((acc, b) => acc + b.approxTokens, 0),
          outputTokensEstimate: estimateTokens(JSON.stringify(result)),
          seconds: Math.round(duration / 1000),
          llmApiCalls: apiCalls,
        },
      },
    });

    await updateConversationStatus(convo.id);
    await syncSessionAfterConversation(convo.id);
    return { analyses: [], duration };
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

  const { analyses: analyzed, model, apiCalls: analyzeApiCalls } = toAnalyze.length
    ? await analyzeChunkBlocks(toAnalyze, {
        studentName: convo.studentName ?? undefined,
        teacherName: convo.teacherName ?? undefined,
      })
    : { analyses: [], model: "reuse", apiCalls: 0 };
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
        llmApiCalls: analyzeApiCalls,
      },
      costMetaJson: {
        promptVersion: getPromptVersion(),
        inputTokensEstimate: pre.blocks.reduce((acc, b) => acc + b.approxTokens, 0),
        outputTokensEstimate: estimateTokens(JSON.stringify(merged)),
        seconds: Math.round(duration / 1000),
        llmApiCalls: analyzeApiCalls,
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
        llmApiCallsAnalyze: analyzeApiCalls,
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
  const singlePassMode = (convo.qualityMetaJson as any)?.singlePassMode === true;
  if (singlePassMode && hasSinglePassArtifacts(convo)) {
    await prisma.conversationJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.DONE,
        finishedAt: new Date(),
        model: "skip-single-pass",
        outputJson: { skipped: true, reason: "single-pass", llmApiCalls: 0 },
        costMetaJson: {
          promptVersion: getPromptVersion(),
          inputTokensEstimate: 0,
          outputTokensEstimate: 0,
          seconds: 0,
          llmApiCalls: 0,
        },
      },
    });

    await prisma.conversationLog.update({
      where: { id: convo.id },
      data: {
        qualityMetaJson: {
          ...(convo.qualityMetaJson ?? {}),
          modelReduce: "skip-single-pass",
          jobSecondsReduce: 0,
          llmApiCallsReduce: 0,
        } as any,
      },
    });

    await updateConversationStatus(convo.id);
    return {
      reduced: {
        facts: [],
        coaching_points: [],
        decisions: [],
        student_state_delta: [],
        todo_candidates: [],
        timeline_candidates: [],
        profile_delta_candidates: { basic: [], personal: [] },
        quotes: [],
        safety_flags: [],
      } as ReducedAnalysis,
      duration: 0,
    };
  }

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
  const { reduced, model, apiCalls: reduceApiCalls } = await reduceChunkAnalyses({
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
      outputJson: { reduced, llmApiCalls: reduceApiCalls },
      costMetaJson: {
        promptVersion: getPromptVersion(),
        inputTokensEstimate: estimateTokens(JSON.stringify(analyses)),
        outputTokensEstimate: estimateTokens(JSON.stringify(reduced)),
        seconds: Math.round(duration / 1000),
        llmApiCalls: reduceApiCalls,
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
        llmApiCallsReduce: reduceApiCalls,
      } as any,
    },
  });

  await updateConversationStatus(convo.id);
  return { reduced, duration };
}

async function executeFinalizeJob(job: JobPayload, convo: ConversationPayload) {
  const singlePassMode = (convo.qualityMetaJson as any)?.singlePassMode === true;
  if (singlePassMode && hasSinglePassArtifacts(convo)) {
    const timeline = (Array.isArray(convo.timelineJson) ? convo.timelineJson : []) as any[];
    const nextActions = (Array.isArray(convo.nextActionsJson) ? convo.nextActionsJson : []) as any[];
    const profileDelta = (convo.profileDeltaJson as any) ?? { basic: [], personal: [] };
    const parentPack = (convo.parentPackJson as any) ?? {
      what_we_did: [],
      what_improved: [],
      what_to_practice: [],
      risks_or_notes: [],
      next_time_plan: [],
      evidence_quotes: [],
    };
    const studentState = (convo.studentStateJson as any) ?? null;
    const recommendedTopics = (Array.isArray(convo.topicSuggestionsJson) ? convo.topicSuggestionsJson : []) as any[];
    const quickQuestions = (Array.isArray(convo.quickQuestionsJson) ? convo.quickQuestionsJson : []) as any[];
    const profileSections = (Array.isArray(convo.profileSectionsJson) ? convo.profileSectionsJson : []) as any[];
    const observationEvents = (Array.isArray(convo.observationJson) ? convo.observationJson : []) as any[];
    const entityCandidates = (Array.isArray(convo.entityCandidatesJson) ? convo.entityCandidatesJson : []) as any[];
    const lessonReport = (convo.lessonReportJson as any) ?? null;
    const summaryMarkdown = renderOperationalSummaryMarkdown(
      buildOperationalLog({
        sessionType: convo.sessionType,
        createdAt: new Date(),
        summaryMarkdown: convo.summaryMarkdown ?? "",
        timeline: timeline as any,
        nextActions: nextActions as any,
        parentPack: parentPack as any,
        studentState: studentState as any,
        profileSections: profileSections as any,
        quickQuestions: quickQuestions as any,
        entityCandidates: entityCandidates as any,
        lessonReport: lessonReport as any,
      })
    );
    const quotesCountTotal =
      timeline.reduce((acc: number, t: any) => acc + (t?.evidence_quotes?.length ?? 0), 0) +
      (profileDelta?.basic ?? []).reduce((acc: number, i: any) => acc + (i?.evidence_quotes?.length ?? 0), 0) +
      (profileDelta?.personal ?? []).reduce((acc: number, i: any) => acc + (i?.evidence_quotes?.length ?? 0), 0) +
      (parentPack?.evidence_quotes?.length ?? 0);

    try {
      await applyProfileDelta(convo.studentId, profileDelta, convo.id);
    } catch (e: any) {
      console.error("[executeFinalizeJob] applyProfileDelta failed (single-pass, non-fatal):", e?.message);
    }

    const qualityMeta: ConversationQualityMeta = {
      ...(convo.qualityMetaJson ?? {}),
      modelFinalize:
        (convo.qualityMetaJson as any)?.modelSinglePass ||
        (convo.qualityMetaJson as any)?.modelAnalyze ||
        "skip-single-pass",
      summaryCharCount: summaryMarkdown.length,
      timelineSectionCount: timeline.length,
      todoCount: nextActions.length,
      quotesCountTotal,
      jobSecondsFinalize: 0,
      llmApiCallsFinalize: 0,
      finalizeRepaired: (convo.qualityMetaJson as any)?.singlePassRepaired ?? false,
      promptVersion: getPromptVersion(),
      generatedAt: new Date().toISOString(),
      inputTokensEstimate: estimateTokens(normalizeSourceText(convo)),
    };

    await prisma.conversationLog.update({
      where: { id: convo.id },
      data: {
        summaryMarkdown,
        qualityMetaJson: qualityMeta as any,
      },
    });

    await prisma.conversationJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.DONE,
        finishedAt: new Date(),
        model: "skip-single-pass",
        outputJson: {
          skipped: true,
          reason: "single-pass",
          summaryCharCount: summaryMarkdown.length,
          timelineSectionCount: timeline.length,
          todoCount: nextActions.length,
          llmApiCalls: 0,
          repaired: (convo.qualityMetaJson as any)?.singlePassRepaired ?? false,
        },
        costMetaJson: {
          promptVersion: getPromptVersion(),
          inputTokensEstimate: 0,
          outputTokensEstimate: 0,
          seconds: 0,
          llmApiCalls: 0,
        },
      },
    });

    await updateConversationStatus(convo.id);
    await syncSessionAfterConversation(convo.id);

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

    return {
      result: {
        summaryMarkdown,
        timeline: timeline as any,
        nextActions: nextActions as any,
        profileDelta: profileDelta as any,
        parentPack: parentPack as any,
        studentState: studentState as any,
        recommendedTopics: recommendedTopics as any,
        quickQuestions: quickQuestions as any,
        profileSections: profileSections as any,
        entityCandidates: entityCandidates as any,
        observationEvents: observationEvents as any,
        lessonReport: lessonReport as any,
      },
      duration: 0,
    };
  }

  const reduceJob = await prisma.conversationJob.findFirst({
    where: { conversationId: convo.id, type: ConversationJobType.REDUCE, status: JobStatus.DONE },
    select: { outputJson: true },
  });

  const reduced = (reduceJob?.outputJson as any)?.reduced as ReducedAnalysis | undefined;
  if (!reduced) {
    throw new Error("FINALIZE dependencies not ready");
  }

  const sourceText = normalizeSourceText(convo);
  const minSummaryChars = sourceText.length >= 20000 ? 1200 : sourceText.length < 3000 ? 380 : 700;
  const minTimelineSections = sourceText.length >= 12000 ? 3 : 2;

  const start = Date.now();
  const { result, model, apiCalls: finalizeApiCalls, repaired } = await finalizeConversationArtifacts({
    studentName: convo.studentName ?? undefined,
    teacherName: convo.teacherName ?? undefined,
    reduced,
    minSummaryChars,
    minTimelineSections,
    sessionType: convo.sessionType === SessionType.LESSON_REPORT ? "LESSON_REPORT" : "INTERVIEW",
    entityDictionary: convo.entityDictionary,
  });
  const duration = Date.now() - start;

  const quotesCountTotal =
    result.timeline.reduce((acc, t) => acc + (t.evidence_quotes?.length ?? 0), 0) +
    result.profileDelta.basic.reduce((acc, i) => acc + (i.evidence_quotes?.length ?? 0), 0) +
    result.profileDelta.personal.reduce((acc, i) => acc + (i.evidence_quotes?.length ?? 0), 0) +
    (result.parentPack?.evidence_quotes?.length ?? 0);
  const summaryMarkdown = renderOperationalSummaryMarkdown(
    buildOperationalLog({
      sessionType: convo.sessionType,
      createdAt: new Date(),
      summaryMarkdown: result.summaryMarkdown,
      timeline: result.timeline as any,
      nextActions: result.nextActions as any,
      parentPack: result.parentPack as any,
      studentState: result.studentState as any,
      profileSections: result.profileSections as any,
      quickQuestions: result.quickQuestions as any,
      entityCandidates: result.entityCandidates as any,
      lessonReport: result.lessonReport as any,
    })
  );

  const qualityMeta: ConversationQualityMeta = {
    ...(convo.qualityMetaJson ?? {}),
    modelFinalize: model,
    summaryCharCount: summaryMarkdown.length,
    timelineSectionCount: result.timeline.length,
    todoCount: result.nextActions.length,
    quotesCountTotal,
    jobSecondsFinalize: Math.round(duration / 1000),
    llmApiCallsFinalize: finalizeApiCalls,
    finalizeRepaired: repaired,
    promptVersion: getPromptVersion(),
    generatedAt: new Date().toISOString(),
    inputTokensEstimate: estimateTokens(sourceText),
  };

    await prisma.conversationLog.update({
      where: { id: convo.id },
      data: {
      summaryMarkdown,
      timelineJson: result.timeline as any,
      nextActionsJson: result.nextActions as any,
      profileDeltaJson: result.profileDelta as any,
      parentPackJson: result.parentPack as any,
      studentStateJson: result.studentState as any,
      topicSuggestionsJson: result.recommendedTopics as any,
      quickQuestionsJson: result.quickQuestions as any,
      profileSectionsJson: result.profileSections as any,
      observationJson: result.observationEvents as any,
      entityCandidatesJson: result.entityCandidates as any,
      lessonReportJson: result.lessonReport as any,
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
        summaryCharCount: summaryMarkdown.length,
        timelineSectionCount: result.timeline.length,
        todoCount: result.nextActions.length,
        llmApiCalls: finalizeApiCalls,
        repaired,
      },
      costMetaJson: {
        promptVersion: getPromptVersion(),
        inputTokensEstimate: estimateTokens(JSON.stringify(reduced)),
        outputTokensEstimate: estimateTokens(JSON.stringify(result)),
        seconds: Math.round(duration / 1000),
        llmApiCalls: finalizeApiCalls,
      },
    },
  });

  try {
    await applyProfileDelta(convo.studentId, result.profileDelta, convo.id);
  } catch (e: any) {
    console.error("[executeFinalizeJob] applyProfileDelta failed (non-fatal):", e?.message);
  }

  await updateConversationStatus(convo.id);
  await syncSessionAfterConversation(convo.id);

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
      session: { select: { id: true, type: true } },
    },
  });
  if (!convo) throw new Error("conversation not found");

  const payload: ConversationPayload = {
    id: convo.id,
    studentId: convo.studentId,
    sessionId: convo.sessionId,
    sessionType: convo.session?.type ?? null,
    rawTextOriginal: convo.rawTextOriginal,
    rawTextCleaned: convo.rawTextCleaned,
    rawSegments: (convo.rawSegments as any[]) ?? [],
    formattedTranscript: convo.formattedTranscript,
    summaryMarkdown: convo.summaryMarkdown,
    timelineJson: convo.timelineJson as any,
    nextActionsJson: convo.nextActionsJson as any,
    profileDeltaJson: convo.profileDeltaJson as any,
    parentPackJson: convo.parentPackJson as any,
    studentStateJson: convo.studentStateJson as any,
    topicSuggestionsJson: convo.topicSuggestionsJson as any,
    quickQuestionsJson: convo.quickQuestionsJson as any,
    profileSectionsJson: convo.profileSectionsJson as any,
    observationJson: convo.observationJson as any,
    entityCandidatesJson: convo.entityCandidatesJson as any,
    lessonReportJson: convo.lessonReportJson as any,
    studentName: convo.student?.name ?? null,
    teacherName: convo.user?.name ?? DEFAULT_TEACHER_FULL_NAME,
    qualityMetaJson: (convo.qualityMetaJson as ConversationQualityMeta) ?? null,
    chunkAnalysisJson: (convo.chunkAnalysisJson as any) ?? null,
    entityDictionary: await getEntityDictionary(convo.studentId),
  };

  if (job.type === ConversationJobType.CHUNK_ANALYZE) return executeAnalyzeJob(job, payload);
  if (job.type === ConversationJobType.REDUCE) return executeReduceJob(job, payload);
  if (job.type === ConversationJobType.FINALIZE) return executeFinalizeJob(job, payload);
  if (job.type === ConversationJobType.FORMAT) return executeFormatJob(job, payload);
  throw new Error(`unsupported job type: ${job.type}`);
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
        const failedConversation = await prisma.conversationLog.findUnique({
          where: { id: job.conversationId },
          select: { sessionId: true },
        });
        if (failedConversation?.sessionId) {
          await prisma.session.update({
            where: { id: failedConversation.sessionId },
            data: { status: SessionStatus.ERROR },
          });
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
        status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
      },
    });
    const limit = Math.max(10, pending * 2, 4);
    const result = await processQueuedJobs(limit, concurrency, { conversationId });
    return result;
  } finally {
    activeConversationRuns.delete(conversationId);
  }
}
