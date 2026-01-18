import { prisma } from "@/lib/db";
import { ConversationJobType, JobStatus } from "@prisma/client";
import {
  generateLongConversationSummary,
  extractConversationArtifactsMini,
  formatTranscriptFromSegments,
  formatTranscript,
} from "@/lib/ai/llm";
import { applyProfileDelta } from "@/lib/profile";
import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";

export async function enqueueConversationJobs(conversationId: string) {
  // Check if jobs are already completed to avoid unnecessary job creation
  const existingLog = await prisma.conversationLog.findUnique({
    where: { id: conversationId },
    select: { summaryStatus: true, extractStatus: true },
  });
  
  // Only create jobs if they haven't been completed yet
  const jobsToCreate: Array<{ conversationId: string; type: ConversationJobType; status: JobStatus }> = [];
  
  if (!existingLog || existingLog.summaryStatus !== JobStatus.SUCCESS) {
    jobsToCreate.push({ conversationId, type: ConversationJobType.SUMMARY, status: JobStatus.PENDING });
  }
  
  if (!existingLog || existingLog.extractStatus !== JobStatus.SUCCESS) {
    jobsToCreate.push({ conversationId, type: ConversationJobType.EXTRACT, status: JobStatus.PENDING });
  }
  
  if (jobsToCreate.length > 0) {
    await prisma.conversationJob.createMany({
      data: jobsToCreate,
      skipDuplicates: true,
    });
  }
}

type ProcessResult =
  | { ok: true; jobId: string; type: ConversationJobType; status: JobStatus }
  | { ok: false; error: string };

async function claimJob(conversationId?: string): Promise<{
  id: string;
  conversationId: string;
  type: ConversationJobType;
  attempts: number;
} | null> {
  // Priority: SUMMARY first (fastest UX impact), then EXTRACT
  const target = await prisma.conversationJob.findFirst({
    where: conversationId
      ? { conversationId, status: JobStatus.PENDING }
      : { status: JobStatus.PENDING },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
    select: { id: true, conversationId: true, type: true, attempts: true },
  });
  if (!target) return null;

  const updated = await prisma.conversationJob.updateMany({
    where: { id: target.id, status: JobStatus.PENDING },
    data: {
      status: JobStatus.RUNNING,
      startedAt: new Date(),
      attempts: { increment: 1 },
    },
  });
  if (updated.count !== 1) return null;
  return target;
}

async function claimJobByType(
  conversationId: string,
  type: ConversationJobType
): Promise<{
  id: string;
  conversationId: string;
  type: ConversationJobType;
  attempts: number;
} | null> {
  const target = await prisma.conversationJob.findFirst({
    where: { conversationId, type, status: JobStatus.PENDING },
    select: { id: true, conversationId: true, type: true, attempts: true },
  });
  if (!target) return null;

  const updated = await prisma.conversationJob.updateMany({
    where: { id: target.id, status: JobStatus.PENDING },
    data: {
      status: JobStatus.RUNNING,
      startedAt: new Date(),
      attempts: { increment: 1 },
    },
  });
  if (updated.count !== 1) return null;
  return target;
}

async function executeJob(
  job: { id: string; conversationId: string; type: ConversationJobType },
  convo: {
    id: string;
    studentId: string;
    rawTextCleaned: string;
    rawTextOriginal: string;
    studentName?: string | null;
    teacherName?: string | null;
  }
): Promise<void> {
  if (job.type === ConversationJobType.SUMMARY) {
    console.log("[executeJob] Starting SUMMARY job:", {
      conversationId: convo.id,
      rawTextCleanedLength: convo.rawTextCleaned.length,
    });
    const startTime = Date.now();

    // 漢字変換処理を削除（速度優先）
    const summary = await generateLongConversationSummary(convo.rawTextCleaned || convo.rawTextOriginal, {
      logId: convo.id,
      studentName: convo.studentName ?? undefined,
      teacherName: convo.teacherName ?? undefined,
    });
    
    const elapsedTime = Date.now() - startTime;
    console.log("[executeJob] SUMMARY job completed:", {
      conversationId: convo.id,
      elapsedTimeMs: elapsedTime,
      elapsedTimeSec: (elapsedTime / 1000).toFixed(2),
      summaryLength: summary.length,
    });
    await prisma.conversationLog.update({
      where: { id: convo.id },
      data: {
        summary,
        summaryStatus: JobStatus.SUCCESS,
        summaryError: null,
        summaryUpdatedAt: new Date(),
      },
    });
    await prisma.conversationJob.update({
      where: { id: job.id },
      data: { status: JobStatus.SUCCESS, finishedAt: new Date(), lastError: null },
    });
  } else {
    // Get existing categories and check for formatted transcript
    const existingLog = await prisma.conversationLog.findUnique({
      where: { id: convo.id },
      select: { formattedTranscript: true, rawTextOriginal: true, rawSegments: true, extractStatus: true },
    });
    
    // Get existing categories from student profile for consistency
    const studentProfile = await prisma.studentProfile.findFirst({
      where: { studentId: convo.studentId },
      select: { profileData: true },
    });
    const existingCategories: string[] = [];
    if (studentProfile?.profileData && typeof studentProfile.profileData === "object") {
      const personal = (studentProfile.profileData as any)?.personal;
      if (personal && typeof personal === "object") {
        existingCategories.push(...Object.keys(personal));
      }
    }

    // Execute extractConversationArtifactsMini and formatTranscript in parallel
    const transcriptSource =
      existingLog?.rawTextOriginal || convo.rawTextOriginal || convo.rawTextCleaned || "";
    const rawSegments = Array.isArray(existingLog?.rawSegments) ? (existingLog?.rawSegments as any[]) : [];
    // 再生成時（extractStatusがPENDING）またはformattedTranscriptが存在しない場合は再生成
    // 再生成時は常にformattedTranscriptを再生成する（extractStatusがPENDINGの場合は強制再生成）
    const isRegenerating = existingLog?.extractStatus === JobStatus.PENDING;
    const needsFormatting = (isRegenerating || !existingLog?.formattedTranscript) && transcriptSource;

    console.log("[executeJob] Starting EXTRACT job with parallel execution:", {
      conversationId: convo.id,
      needsFormatting,
      transcriptSourceLength: transcriptSource.length,
      hasExistingCategories: existingCategories.length > 0,
    });

    const startTime = Date.now();
    const [extracted, formattedTranscript] = await Promise.allSettled([
      extractConversationArtifactsMini(convo.rawTextCleaned || convo.rawTextOriginal, {
        logId: convo.id,
        studentName: convo.studentName ?? undefined,
        teacherName: convo.teacherName ?? undefined,
        existingCategories,
      }),
      needsFormatting
        ? (async () => {
            try {
              if (rawSegments.length > 0) {
                return await formatTranscriptFromSegments(rawSegments, {
                  studentName: convo.studentName ?? undefined,
                  teacherName: convo.teacherName ?? undefined,
                });
              }
              return await formatTranscript(transcriptSource, {
                studentName: convo.studentName ?? undefined,
                teacherName: convo.teacherName ?? undefined,
              });
            } catch (e: any) {
              console.error("[executeJob] formatTranscript failed (non-fatal):", e?.message);
              return null;
            }
          })()
        : Promise.resolve(existingLog?.formattedTranscript ?? null),
    ]);

    const elapsedTime = Date.now() - startTime;
    console.log("[executeJob] EXTRACT job parallel execution completed:", {
      conversationId: convo.id,
      elapsedTimeMs: elapsedTime,
      elapsedTimeSec: (elapsedTime / 1000).toFixed(2),
      extractStatus: extracted.status,
      formatStatus: formattedTranscript.status,
    });

    const extractedResult =
      extracted.status === "fulfilled" ? extracted.value : { title: undefined, timeline: undefined, nextActions: undefined, structuredDelta: undefined };
    const formattedResult =
      formattedTranscript.status === "fulfilled" ? formattedTranscript.value : null;

    if (extracted.status === "rejected") {
      console.error("[executeJob] extractConversationArtifactsMini failed:", extracted.reason);
      throw extracted.reason;
    }

    await prisma.conversationLog.update({
      where: { id: convo.id },
      data: {
        title: extractedResult.title ?? undefined,
        timeline: extractedResult.timeline ?? undefined,
        nextActions: extractedResult.nextActions ?? [],
        structuredDelta: extractedResult.structuredDelta ?? {},
        formattedTranscript: formattedResult ?? undefined,
        extractStatus: JobStatus.SUCCESS,
        extractError: null,
        extractUpdatedAt: new Date(),
      },
    });

    // profile update (non-fatal)
    try {
      await applyProfileDelta(convo.studentId, (extractedResult.structuredDelta ?? {}) as any, convo.id);
    } catch (e: any) {
      console.error("[executeJob] applyProfileDelta failed (non-fatal):", {
        error: e?.message,
        stack: e?.stack,
      });
    }

    await prisma.conversationJob.update({
      where: { id: job.id },
      data: { status: JobStatus.SUCCESS, finishedAt: new Date(), lastError: null },
    });
  }
}

/**
 * Process both Job A (SUMMARY) and Job B (EXTRACT) in parallel for a conversation.
 * This is the main entry point for parallel LLM processing.
 */
export async function processAllConversationJobs(conversationId: string): Promise<{
  summary: ProcessResult;
  extract: ProcessResult;
}> {
  const convo = await prisma.conversationLog.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      studentId: true,
      rawTextCleaned: true,
      rawTextOriginal: true,
      summaryStatus: true,
      extractStatus: true,
      student: { select: { name: true } },
      user: { select: { name: true } },
    },
  });
  if (!convo) {
    const err = "conversation not found";
    return {
      summary: { ok: false, error: err },
      extract: { ok: false, error: err },
    };
  }

  const convoPayload = {
    id: convo.id,
    studentId: convo.studentId,
    rawTextCleaned: convo.rawTextCleaned,
    rawTextOriginal: convo.rawTextOriginal ?? "",
    studentName: convo.student?.name ?? null,
    teacherName: convo.user?.name ?? DEFAULT_TEACHER_FULL_NAME,
  };

  // Skip if both jobs are already completed
  if (convo.summaryStatus === JobStatus.SUCCESS && convo.extractStatus === JobStatus.SUCCESS) {
    return {
      summary: { ok: true, jobId: "already-completed", type: ConversationJobType.SUMMARY, status: JobStatus.SUCCESS },
      extract: { ok: true, jobId: "already-completed", type: ConversationJobType.EXTRACT, status: JobStatus.SUCCESS },
    };
  }

  // Claim both jobs simultaneously
  const [summaryJob, extractJob] = await Promise.all([
    claimJobByType(conversationId, ConversationJobType.SUMMARY),
    claimJobByType(conversationId, ConversationJobType.EXTRACT),
  ]);

  // Execute both jobs in parallel
  const [summaryResult, extractResult] = await Promise.allSettled([
    summaryJob
      ? executeJob(summaryJob, convoPayload)
          .then(() => ({ ok: true, jobId: summaryJob.id, type: summaryJob.type, status: JobStatus.SUCCESS } as ProcessResult))
          .catch((e: any) => {
            const msg = e?.message ?? "unknown error";
            console.error("[processAllConversationJobs] SUMMARY job failed:", {
              jobId: summaryJob.id,
              conversationId,
              error: msg,
              stack: e?.stack,
            });
            return prisma.conversationJob
              .update({
                where: { id: summaryJob.id },
                data: { status: JobStatus.FAILED, finishedAt: new Date(), lastError: msg },
              })
              .then(() =>
                prisma.conversationLog.update({
                  where: { id: conversationId },
                  data: { summaryStatus: JobStatus.FAILED, summaryError: msg },
                })
              )
              .then(() => ({ ok: false, error: msg } as ProcessResult));
          })
      : Promise.resolve({ ok: false, error: "no pending SUMMARY job" } as ProcessResult),
    extractJob
      ? executeJob(extractJob, convoPayload)
          .then(() => ({ ok: true, jobId: extractJob.id, type: extractJob.type, status: JobStatus.SUCCESS } as ProcessResult))
          .catch((e: any) => {
            const msg = e?.message ?? "unknown error";
            console.error("[processAllConversationJobs] EXTRACT job failed:", {
              jobId: extractJob.id,
              conversationId,
              error: msg,
              stack: e?.stack,
            });
            return prisma.conversationJob
              .update({
                where: { id: extractJob.id },
                data: { status: JobStatus.FAILED, finishedAt: new Date(), lastError: msg },
              })
              .then(() =>
                prisma.conversationLog.update({
                  where: { id: conversationId },
                  data: { extractStatus: JobStatus.FAILED, extractError: msg },
                })
              )
              .then(() => ({ ok: false, error: msg } as ProcessResult));
          })
      : Promise.resolve({ ok: false, error: "no pending EXTRACT job" } as ProcessResult),
  ]);

  return {
    summary: summaryResult.status === "fulfilled" ? summaryResult.value : { ok: false, error: "summary job execution failed" },
    extract: extractResult.status === "fulfilled" ? extractResult.value : { ok: false, error: "extract job execution failed" },
  };
}

export async function processOneConversationJob(conversationId?: string): Promise<ProcessResult> {
  const job = await claimJob(conversationId);
  if (!job) return { ok: false, error: "no pending jobs" };

  try {
    const convo = await prisma.conversationLog.findUnique({
      where: { id: job.conversationId },
      select: {
        id: true,
        studentId: true,
        rawTextCleaned: true,
        rawTextOriginal: true,
        student: { select: { name: true } },
        user: { select: { name: true } },
      },
    });
    if (!convo) throw new Error("conversation not found");

    await executeJob(job, {
      id: convo.id,
      studentId: convo.studentId,
      rawTextCleaned: convo.rawTextCleaned,
      rawTextOriginal: convo.rawTextOriginal,
      studentName: convo.student?.name ?? null,
      teacherName: convo.user?.name ?? null,
    });
    return { ok: true, jobId: job.id, type: job.type, status: JobStatus.SUCCESS };
  } catch (e: any) {
    const msg = e?.message ?? "unknown error";
    console.error("[processOneConversationJob] job failed:", {
      jobId: job.id,
      conversationId: job.conversationId,
      type: job.type,
      error: msg,
      stack: e?.stack,
    });
    await prisma.conversationJob.update({
      where: { id: job.id },
      data: { status: JobStatus.FAILED, finishedAt: new Date(), lastError: msg },
    });
    if (job.type === ConversationJobType.SUMMARY) {
      await prisma.conversationLog.update({
        where: { id: job.conversationId },
        data: { summaryStatus: JobStatus.FAILED, summaryError: msg },
      });
    } else {
      await prisma.conversationLog.update({
        where: { id: job.conversationId },
        data: { extractStatus: JobStatus.FAILED, extractError: msg },
      });
    }
    return { ok: false, error: msg };
  }
}
