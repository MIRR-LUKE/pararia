import { revalidatePath, revalidateTag } from "next/cache";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  ensureConversationJobsAvailable,
  processAllConversationJobs,
} from "@/lib/jobs/conversationJobs";
import { parseConversationArtifact, renderConversationArtifactMarkdown, renderConversationArtifactOrFallback } from "@/lib/conversation-artifact";
import { buildConversationSummaryEditPayload } from "@/lib/conversation-editing";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { syncSessionAfterConversation } from "@/lib/session-service";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import { sanitizeFormattedTranscript, sanitizeSummaryMarkdown } from "@/lib/user-facing-japanese";
import { normalizeRawTranscriptText, pickDisplayTranscriptText } from "@/lib/transcript/source";
import { getLogListCacheTag } from "@/lib/logs/get-log-list-page-data";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";
import { normalizeTranscriptReviewMeta } from "@/lib/logs/transcript-review-display";
import { toPrismaJson } from "@/lib/prisma-json";
import { runAfterResponse } from "@/lib/server/after-response";

async function wakeConversationWorkerOrFallback(conversationId: string) {
  runAfterResponse(async () => {
    const workerWake = await maybeEnsureRunpodWorker().catch((error: any) => ({
      attempted: true,
      ok: false,
      error: error?.message ?? String(error),
    }));

    if (workerWake.attempted && workerWake.ok) {
      return;
    }

    console.warn("[GET /api/conversations/[id]] falling back to inline conversation processing", {
      conversationId,
      workerWake,
    });
    await processAllConversationJobs(conversationId);
  }, "GET /api/conversations/[id] wake conversation worker");
}

async function recoverMissingConversationJobs(conversationId: string) {
  const recovery = await ensureConversationJobsAvailable(conversationId);
  if (!recovery.healed) {
    return recovery;
  }

  if (shouldRunBackgroundJobsInline()) {
    await processAllConversationJobs(conversationId);
  } else {
    runAfterResponse(async () => {
      await processAllConversationJobs(conversationId);
    }, "GET /api/conversations/[id] recover conversation jobs");
  }
  return recovery;
}

export async function processVisibleConversation(conversationId: string, status: string) {
  const recovery = await recoverMissingConversationJobs(conversationId).catch(() => ({
    healed: false as const,
    reason: "recovery_failed" as const,
  }));
  if (recovery.healed) {
    return;
  }
  if (shouldRunBackgroundJobsInline()) {
    try {
      await processAllConversationJobs(conversationId);
    } finally {
      await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch(() => {});
    }
    return;
  }
  if (status === "PROCESSING") {
    await wakeConversationWorkerOrFallback(conversationId);
  }
}

export async function getConversationBrief(conversationId: string, organizationId: string) {
  return prisma.conversationLog.findFirst({
    where: withVisibleConversationWhere({ id: conversationId, organizationId }),
    select: {
      id: true,
      sessionId: true,
      status: true,
      createdAt: true,
      jobs: {
        select: {
          id: true,
          type: true,
          status: true,
          executionId: true,
          attempts: true,
          maxAttempts: true,
          startedAt: true,
          finishedAt: true,
          nextRetryAt: true,
          leaseExpiresAt: true,
          lastHeartbeatAt: true,
          failedAt: true,
          completedAt: true,
          lastRunDurationMs: true,
          lastQueueLagMs: true,
          lastError: true,
        },
      },
    },
  });
}

export async function getConversationDetail(conversationId: string, organizationId: string) {
  return prisma.conversationLog.findFirst({
    where: withVisibleConversationWhere({ id: conversationId, organizationId }),
    select: {
      id: true,
      status: true,
      reviewState: true,
      createdAt: true,
      artifactJson: true,
      summaryMarkdown: true,
      qualityMetaJson: true,
      rawTextOriginal: true,
      rawTextCleaned: true,
      reviewedText: true,
      formattedTranscript: true,
      student: {
        select: {
          id: true,
          name: true,
          grade: true,
        },
      },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      session: {
        select: {
          id: true,
          type: true,
          status: true,
          sessionDate: true,
        },
      },
      jobs: {
        select: {
          id: true,
          type: true,
          status: true,
          executionId: true,
          model: true,
          attempts: true,
          maxAttempts: true,
          startedAt: true,
          finishedAt: true,
          nextRetryAt: true,
          leaseExpiresAt: true,
          lastHeartbeatAt: true,
          failedAt: true,
          completedAt: true,
          lastRunDurationMs: true,
          lastQueueLagMs: true,
          lastError: true,
        },
      },
    },
  });
}

export async function deleteConversation(
  conversationId: string,
  organizationId: string,
  userId: string,
  deleteReason: string | null
) {
  const conversation = await prisma.conversationLog.findFirst({
    where: withVisibleConversationWhere({ id: conversationId, organizationId }),
    select: { id: true, studentId: true, sessionId: true },
  });

  if (!conversation) {
    return null;
  }

  const deletedAt = new Date();
  const deletedSessionId = conversation.sessionId ?? null;
  await prisma.$transaction(async (tx) => {
    await tx.conversationLog.update({
      where: { id: conversationId },
      data: {
        deletedAt,
        deletedByUserId: userId,
        deletedReason: deleteReason,
        deletedSessionId,
        sessionId: null,
      },
    });

    if (deletedSessionId) {
      await tx.session.updateMany({
        where: { id: deletedSessionId },
        data: {
          status: "DRAFT",
          heroStateLabel: null,
          heroOneLiner: null,
          latestSummary: null,
          completedAt: null,
        },
      });
    }
  });

  await writeAuditLog({
    organizationId,
    userId,
    action: "conversation.delete",
    targetType: "conversation",
    targetId: conversationId,
    detail: {
      conversationId,
      studentId: conversation.studentId,
      sessionId: deletedSessionId,
      deletedAt: deletedAt.toISOString(),
      deleteReason,
    },
  });

  revalidateTag(`student-directory:${organizationId}`, "max");
  revalidateTag(`dashboard-snapshot:${organizationId}`, "max");
  revalidateTag(getLogListCacheTag(organizationId), "max");
  revalidatePath("/app/dashboard");
  revalidatePath("/app/students");
  revalidatePath("/app/logs");
  revalidatePath("/app/reports");
  revalidatePath(`/app/students/${conversation.studentId}`);

  return {
    success: true as const,
    message: "conversation deleted",
    studentId: conversation.studentId,
    sessionId: deletedSessionId,
  };
}

export async function patchConversation(
  conversationId: string,
  organizationId: string,
  body: any
) {
  const conversation = await prisma.conversationLog.findFirst({
    where: withVisibleConversationWhere({ id: conversationId, organizationId }),
    select: {
      id: true,
      summaryMarkdown: true,
      artifactJson: true,
      session: { select: { type: true } },
    },
  });
  if (!conversation) {
    return null;
  }

  const { summaryMarkdown, formattedTranscript, artifactJson } = body ?? {};

  const updateData: any = {};
  const sessionType = conversation.session?.type === "LESSON_REPORT" ? "LESSON_REPORT" : "INTERVIEW";

  if (summaryMarkdown !== undefined) {
    const nextSummary = buildConversationSummaryEditPayload({
      sessionType,
      summaryMarkdown,
    });
    updateData.summaryMarkdown = nextSummary.summaryMarkdown;
    updateData.artifactJson = toPrismaJson(nextSummary.artifactJson);
  }

  if (artifactJson !== undefined) {
    const parsedArtifact = parseConversationArtifact(artifactJson);
    if (!parsedArtifact) {
      return { error: "artifactJson is invalid" as const, status: 400 as const };
    }
    updateData.artifactJson = toPrismaJson(parsedArtifact);
    if (summaryMarkdown === undefined) {
      updateData.summaryMarkdown = renderConversationArtifactMarkdown(parsedArtifact);
    }
  }

  if (formattedTranscript !== undefined) updateData.formattedTranscript = sanitizeFormattedTranscript(formattedTranscript);

  const updated = await prisma.conversationLog.update({
    where: { id: conversation.id },
    data: updateData,
  });
  await syncSessionAfterConversation(updated.id);

  revalidateTag(`student-directory:${organizationId}`, "max");
  revalidateTag(`dashboard-snapshot:${organizationId}`, "max");
  revalidateTag(getLogListCacheTag(organizationId), "max");
  revalidatePath("/app/dashboard");
  revalidatePath("/app/students");
  revalidatePath("/app/logs");
  revalidatePath(`/app/students/${updated.studentId}`);

  return {
    conversation: {
      ...updated,
      summaryMarkdown: sanitizeSummaryMarkdown(
        renderConversationArtifactOrFallback(updated.artifactJson, updated.summaryMarkdown)
      ),
      qualityMetaJson: updated.qualityMetaJson as any,
    },
  };
}

export function buildConversationReadResponse(conversation: Awaited<ReturnType<typeof getConversationDetail>> | null) {
  if (!conversation) return null;
  const renderedSummary = renderConversationArtifactOrFallback(
    conversation.artifactJson,
    conversation.summaryMarkdown
  );
  const summaryMarkdown = sanitizeSummaryMarkdown(renderedSummary);
  const formattedTranscript = sanitizeFormattedTranscript(conversation.formattedTranscript ?? "");
  const rawTextOriginal = normalizeRawTranscriptText(conversation.rawTextOriginal ?? "");
  const rawTextCleaned = pickDisplayTranscriptText({
    rawTextCleaned: conversation.rawTextCleaned,
    reviewedText: conversation.reviewedText,
    rawTextOriginal: conversation.rawTextOriginal,
  });
  const reviewedText = normalizeRawTranscriptText(conversation.reviewedText ?? "");

  return {
    conversation: {
      id: conversation.id,
      status: conversation.status,
      formattedTranscript,
      rawTextOriginal,
      rawTextCleaned,
      reviewedText,
      reviewState: conversation.reviewState,
      student: conversation.student,
      user: conversation.user,
      session: conversation.session,
      jobs: conversation.jobs,
      createdAt: conversation.createdAt,
      artifactJson: conversation.artifactJson,
      summaryMarkdown,
      qualityMetaJson: conversation.qualityMetaJson as any,
      transcriptReview: normalizeTranscriptReviewMeta(conversation.qualityMetaJson),
    },
  };
}
