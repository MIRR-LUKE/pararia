import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { processAllConversationJobs } from "@/lib/jobs/conversationJobs";
import { prisma } from "@/lib/db";
import {
  buildConversationArtifactFromMarkdown,
  parseConversationArtifact,
  renderConversationArtifactMarkdown,
  renderConversationArtifactOrFallback,
} from "@/lib/conversation-artifact";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { toPrismaJson } from "@/lib/prisma-json";
import { syncSessionAfterConversation } from "@/lib/session-service";
import { sanitizeFormattedTranscript, sanitizeSummaryMarkdown, sanitizeTranscriptText } from "@/lib/user-facing-japanese";

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const { searchParams } = new URL(request.url);
    const process = searchParams.get("process");
    const brief = searchParams.get("brief") === "1";

    if (brief) {
      const briefConversation = await prisma.conversationLog.findFirst({
        where: { id: params.id, organizationId },
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
      if (process === "1") {
        void processAllConversationJobs(params.id).catch(() => {});
      }
      return NextResponse.json({ conversation: briefConversation });
    }

    const conversation = await prisma.conversationLog.findFirst({
      where: { id: params.id, organizationId },
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
    if (process === "1") {
      void processAllConversationJobs(params.id).catch(() => {});
    }

    const renderedSummary = renderConversationArtifactOrFallback(
      conversation.artifactJson,
      conversation.summaryMarkdown
    );
    const summaryMarkdown = sanitizeSummaryMarkdown(renderedSummary);
    const formattedTranscript = sanitizeFormattedTranscript(conversation.formattedTranscript ?? "");
    const rawTextOriginal = sanitizeTranscriptText(conversation.rawTextOriginal ?? "");
    const rawTextCleaned = sanitizeTranscriptText(conversation.rawTextCleaned ?? "");

    return NextResponse.json({
      conversation: {
        id: conversation.id,
        status: conversation.status,
        formattedTranscript,
        rawTextOriginal,
        rawTextCleaned,
        student: conversation.student,
        user: conversation.user,
        session: conversation.session,
        jobs: conversation.jobs,
        createdAt: conversation.createdAt,
        artifactJson: conversation.artifactJson,
        summaryMarkdown,
        qualityMetaJson: conversation.qualityMetaJson as any,
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

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const conversation = await prisma.conversationLog.findFirst({
      where: { id: params.id, organizationId },
      select: { id: true, studentId: true, sessionId: true },
    });

    if (!conversation) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    const relatedReports = await prisma.report.findMany({
      where: {
        organizationId,
        studentId: conversation.studentId,
      },
      select: {
        id: true,
        sourceLogIds: true,
      },
    });

    const detachedReportIds = relatedReports
      .filter((report) => toStringArray(report.sourceLogIds).includes(params.id))
      .map((report) => report.id);

    await prisma.$transaction(async (tx) => {
      for (const report of relatedReports) {
        const sourceLogIds = toStringArray(report.sourceLogIds);
        if (!sourceLogIds.includes(params.id)) continue;

        await tx.report.update({
          where: { id: report.id },
          data: {
            sourceLogIds: sourceLogIds.filter((logId) => logId !== params.id),
          },
        });
      }

      await tx.conversationJob.deleteMany({ where: { conversationId: params.id } });
      await tx.conversationLog.delete({ where: { id: params.id } });

      if (conversation.sessionId) {
        await tx.session.updateMany({
          where: { id: conversation.sessionId },
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
      userId: authResult.session.user.id,
      action: "conversation.delete",
      detail: {
        conversationId: params.id,
        studentId: conversation.studentId,
        sessionId: conversation.sessionId,
        detachedReportCount: detachedReportIds.length,
      },
    });

    return NextResponse.json({
      success: true,
      message: "conversation deleted",
      studentId: conversation.studentId,
      sessionId: conversation.sessionId,
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
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const conversation = await prisma.conversationLog.findFirst({
      where: { id: params.id, organizationId },
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
      const sanitizedSummary = sanitizeSummaryMarkdown(summaryMarkdown);
      updateData.summaryMarkdown = sanitizedSummary;
      updateData.artifactJson = sanitizedSummary
        ? toPrismaJson(
            buildConversationArtifactFromMarkdown({
              sessionType,
              summaryMarkdown: sanitizedSummary,
            })
          )
        : toPrismaJson(null);
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
