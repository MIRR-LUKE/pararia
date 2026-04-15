import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import {
  ensureConversationJobsAvailable,
  processAllConversationJobs,
} from "@/lib/jobs/conversationJobs";
import { prisma } from "@/lib/db";
import {
  parseConversationArtifact,
  renderConversationArtifactMarkdown,
  renderConversationArtifactOrFallback,
} from "@/lib/conversation-artifact";
import { buildConversationSummaryEditPayload } from "@/lib/conversation-editing";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { toPrismaJson } from "@/lib/prisma-json";
import { syncSessionAfterConversation } from "@/lib/session-service";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import { sanitizeFormattedTranscript, sanitizeSummaryMarkdown } from "@/lib/user-facing-japanese";
import { normalizeRawTranscriptText, pickDisplayTranscriptText } from "@/lib/transcript/source";
import { getLogListCacheTag } from "@/lib/logs/get-log-list-page-data";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";
import { normalizeTranscriptReviewMeta } from "@/lib/logs/transcript-review-display";

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

async function wakeConversationWorkerOrFallback(conversationId: string) {
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
}

async function recoverMissingConversationJobs(conversationId: string) {
  const recovery = await ensureConversationJobsAvailable(conversationId);
  if (!recovery.healed) {
    return recovery;
  }

  await processAllConversationJobs(conversationId);
  return recovery;
}

async function processVisibleConversation(conversationId: string, status: string) {
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
    await wakeConversationWorkerOrFallback(conversationId).catch(() => {});
  }
}

export async function GET(
  request: Request,
  { params }: { params: RouteParams }
) {
  try {
    const conversationId = await resolveRouteId(params);
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const { searchParams } = new URL(request.url);
    const brief = searchParams.get("brief") === "1";

    if (brief) {
      const briefConversation = await prisma.conversationLog.findFirst({
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
      if (!briefConversation) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      return NextResponse.json({ conversation: briefConversation });
    }

    const conversation = await prisma.conversationLog.findFirst({
      where: withVisibleConversationWhere({ id: conversationId, organizationId }),
      include: {
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

    if (!conversation) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

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

    return NextResponse.json({
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
    });
  } catch (error: any) {
    console.error("[GET /api/conversations/[id]] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: RouteParams }
) {
  try {
    const conversationId = await resolveRouteId(params);
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const conversation = await prisma.conversationLog.findFirst({
      where: withVisibleConversationWhere({ id: conversationId, organizationId }),
      select: {
        id: true,
        status: true,
      },
    });
    if (!conversation) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    await processVisibleConversation(conversation.id, conversation.status);
    return GET(request, { params });
  } catch (error: any) {
    console.error("[POST /api/conversations/[id]] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: RouteParams }
) {
  try {
    const conversationId = await resolveRouteId(params);
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const body = await _request.json().catch(() => ({}));
    const deleteReason =
      typeof body?.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim().slice(0, 500)
        : null;

    const conversation = await prisma.conversationLog.findFirst({
      where: withVisibleConversationWhere({ id: conversationId, organizationId }),
      select: { id: true, studentId: true, sessionId: true },
    });

    if (!conversation) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    const deletedAt = new Date();
    const deletedSessionId = conversation.sessionId ?? null;
    await prisma.$transaction(async (tx) => {
      await tx.conversationLog.update({
        where: { id: conversationId },
        data: {
          deletedAt,
          deletedByUserId: authResult.session.user.id,
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
      userId: authResult.session.user.id,
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

    return NextResponse.json({
      success: true,
      message: "conversation deleted",
      studentId: conversation.studentId,
      sessionId: deletedSessionId,
    });
  } catch (error: any) {
    console.error("[DELETE /api/conversations/[id]] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: RouteParams }
) {
  try {
    const conversationId = await resolveRouteId(params);
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

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
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    const body = await request.json();
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
        return NextResponse.json({ error: "artifactJson is invalid" }, { status: 400 });
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

    return NextResponse.json({
      conversation: {
        ...updated,
        summaryMarkdown: sanitizeSummaryMarkdown(
          renderConversationArtifactOrFallback(updated.artifactJson, updated.summaryMarkdown)
        ),
        qualityMetaJson: updated.qualityMetaJson as any,
      },
    });
  } catch (error: any) {
    console.error("[PATCH /api/conversations/[id]] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
