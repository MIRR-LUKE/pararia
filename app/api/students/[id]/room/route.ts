import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runWithDatabaseRetry } from "@/lib/db-retry";
import { buildReportDeliverySummary } from "@/lib/report-delivery";
import { getRecordingLockView } from "@/lib/recording/lockService";
import { buildSessionProgressState } from "@/lib/session-progress";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { buildSummaryPreview } from "@/lib/session-part-meta";
import { pickDisplayTranscriptText } from "@/lib/transcript/source";
import { sanitizeReportMarkdown, sanitizeSummaryMarkdown } from "@/lib/user-facing-japanese";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const authSession = authResult.session;

    const student = await runWithDatabaseRetry("student-room", () =>
      prisma.student.findFirst({
        where: { id: params.id, organizationId: authSession.user.organizationId },
        select: {
          id: true,
          name: true,
          grade: true,
          course: true,
          guardianNames: true,
          profiles: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              profileData: true,
              createdAt: true,
            },
          },
          sessions: {
            orderBy: [{ sessionDate: "desc" }, { createdAt: "desc" }],
            take: 12,
            select: {
              id: true,
              type: true,
              status: true,
              title: true,
              sessionDate: true,
              heroStateLabel: true,
              heroOneLiner: true,
              latestSummary: true,
              parts: {
                select: {
                  id: true,
                  partType: true,
                  status: true,
                  fileName: true,
                  rawTextOriginal: true,
                  rawTextCleaned: true,
                  reviewedText: true,
                  reviewState: true,
                  qualityMetaJson: true,
                  createdAt: true,
                },
                orderBy: { createdAt: "asc" },
              },
              conversation: {
                select: {
                  id: true,
                  status: true,
                  reviewState: true,
                  artifactJson: true,
                  summaryMarkdown: true,
                  createdAt: true,
                  jobs: {
                    select: {
                      type: true,
                      status: true,
                      startedAt: true,
                      finishedAt: true,
                    },
                  },
                },
              },
              nextMeetingMemo: {
                select: {
                  id: true,
                  status: true,
                  previousSummary: true,
                  suggestedTopics: true,
                  errorMessage: true,
                  updatedAt: true,
                  conversationId: true,
                  sessionId: true,
                },
              },
            },
          },
          reports: {
            orderBy: { createdAt: "desc" },
            take: 6,
            select: {
              id: true,
              status: true,
              reportMarkdown: true,
              createdAt: true,
              sentAt: true,
              reviewedAt: true,
              deliveryChannel: true,
              qualityChecksJson: true,
              sourceLogIds: true,
              deliveryEvents: {
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  eventType: true,
                  deliveryChannel: true,
                  note: true,
                  createdAt: true,
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
      })
    );

    if (!student) {
      return NextResponse.json({ error: "student not found" }, { status: 404 });
    }

    const sessions = student.sessions.map((session) => {
      const summaryMarkdown = sanitizeSummaryMarkdown(session.conversation?.summaryMarkdown ?? "");
      const parts = session.parts.map((part) => ({
        id: part.id,
        partType: part.partType,
        status: part.status,
        fileName: part.fileName,
        previewText: buildSummaryPreview(
          pickDisplayTranscriptText({
            rawTextCleaned: part.rawTextCleaned,
            reviewedText: part.reviewedText,
            rawTextOriginal: part.rawTextOriginal,
          })
        ),
        reviewState: part.reviewState,
        qualityMetaJson: part.qualityMetaJson,
      }));
      const conversation = session.conversation
        ? {
            id: session.conversation.id,
            status: session.conversation.status,
            reviewState: session.conversation.reviewState,
            artifactJson: session.conversation.artifactJson,
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
        nextMeetingMemo: session.nextMeetingMemo,
        conversation,
      };
    });

    const latestConversation = sessions.find((session) => Boolean(session.conversation))?.conversation ?? null;
    const latestConversationWithDerived = latestConversation
      ? {
          id: latestConversation.id,
          status: latestConversation.status,
          reviewState: latestConversation.reviewState,
          summaryMarkdown: sanitizeSummaryMarkdown(latestConversation.summaryMarkdown ?? ""),
          createdAt: latestConversation.createdAt,
        }
      : null;

    const recordingLock = await runWithDatabaseRetry("recording-lock-view", () =>
      getRecordingLockView({
        studentId: student.id,
        viewerUserId: authSession?.user?.id ?? null,
      })
    );

    return NextResponse.json({
      student: {
        id: student.id,
        name: student.name,
        grade: student.grade,
        course: student.course,
        guardianNames: student.guardianNames,
        profiles: student.profiles,
      },
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
