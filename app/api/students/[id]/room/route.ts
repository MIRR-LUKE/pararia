import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildReportDeliverySummary } from "@/lib/report-delivery";
import { getRecordingLockView } from "@/lib/recording/lockService";
import { buildSessionProgressState } from "@/lib/session-progress";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { buildSummaryPreview } from "@/lib/session-part-meta";
import { sanitizeReportMarkdown, sanitizeSummaryMarkdown } from "@/lib/user-facing-japanese";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const authSession = authResult.session;

    const student = await prisma.student.findFirst({
      where: { id: params.id, organizationId: authSession.user.organizationId },
      include: {
        profiles: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        sessions: {
          orderBy: [{ sessionDate: "desc" }, { createdAt: "desc" }],
          include: {
            parts: {
              select: {
                id: true,
                partType: true,
                status: true,
                sourceType: true,
                fileName: true,
                rawTextOriginal: true,
                rawTextCleaned: true,
                qualityMetaJson: true,
                createdAt: true,
              },
              orderBy: { createdAt: "asc" },
            },
            conversation: {
              select: {
                id: true,
                status: true,
                summaryMarkdown: true,
                createdAt: true,
              },
            },
          },
          take: 12,
        },
        reports: {
          orderBy: { createdAt: "desc" },
          take: 6,
          include: {
            deliveryEvents: {
              orderBy: { createdAt: "asc" },
              include: {
                actor: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!student) {
      return NextResponse.json({ error: "student not found" }, { status: 404 });
    }

    const latestConversation = await prisma.conversationLog.findFirst({
      where: {
        studentId: student.id,
        organizationId: authSession.user.organizationId,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        summaryMarkdown: true,
        createdAt: true,
      },
    });

    const sessions = student.sessions.map((session) => {
      const summaryMarkdown = sanitizeSummaryMarkdown(session.conversation?.summaryMarkdown ?? "");
      const parts = session.parts.map((part) => ({
        id: part.id,
        partType: part.partType,
        status: part.status,
        fileName: part.fileName,
        previewText: buildSummaryPreview(part.rawTextCleaned || part.rawTextOriginal),
        qualityMetaJson: part.qualityMetaJson,
      }));
      const conversation = session.conversation
        ? {
            id: session.conversation.id,
            status: session.conversation.status,
            summaryMarkdown,
            createdAt: session.conversation.createdAt,
          }
        : null;

      const pipeline = buildSessionProgressState({
        sessionId: session.id,
        type: session.type,
        parts: session.parts,
        conversation: session.conversation,
      });

      return {
        ...session,
        parts,
        pipeline,
        conversation,
      };
    });

    const latestConversationWithDerived = latestConversation
      ? {
          id: latestConversation.id,
          status: latestConversation.status,
          summaryMarkdown: sanitizeSummaryMarkdown(latestConversation.summaryMarkdown ?? ""),
          createdAt: latestConversation.createdAt,
        }
      : null;

    const recordingLock = await getRecordingLockView({
      studentId: student.id,
      viewerUserId: authSession?.user?.id ?? null,
    });

    return NextResponse.json({
      student,
      latestConversation: latestConversationWithDerived,
      latestProfile: student.profiles[0] ?? null,
      sessions,
      reports: student.reports.map((report) => ({
        ...report,
        reportMarkdown: sanitizeReportMarkdown(report.reportMarkdown),
        ...buildReportDeliverySummary(report),
      })),
      recordingLock,
    });
  } catch (error: any) {
    console.error("[GET /api/students/[id]/room] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
