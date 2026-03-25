import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { buildOperationalLog, renderOperationalSummaryMarkdown } from "@/lib/operational-log";
import { buildReportDeliverySummary } from "@/lib/report-delivery";
import { getRecordingLockView } from "@/lib/recording/lockService";
import {
  sanitizeQuickQuestions,
  sanitizeReportMarkdown,
  sanitizeSummaryMarkdown,
  sanitizeTopicSuggestions,
} from "@/lib/user-facing-japanese";
import {
  normalizeLessonReportForView,
  normalizeNextActionsForView,
  normalizeProfileSectionsForView,
  normalizeStudentStateForView,
  normalizeTimelineForView,
} from "@/lib/conversation-artifacts-view";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const student = await prisma.student.findUnique({
      where: { id: params.id },
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
                createdAt: true,
              },
              orderBy: { createdAt: "asc" },
            },
            conversation: {
              select: {
                id: true,
                status: true,
                summaryMarkdown: true,
                timelineJson: true,
                parentPackJson: true,
                studentStateJson: true,
                topicSuggestionsJson: true,
                quickQuestionsJson: true,
                nextActionsJson: true,
                profileSectionsJson: true,
                lessonReportJson: true,
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
      where: { studentId: student.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        summaryMarkdown: true,
        timelineJson: true,
        parentPackJson: true,
        studentStateJson: true,
        topicSuggestionsJson: true,
        quickQuestionsJson: true,
        nextActionsJson: true,
        profileSectionsJson: true,
        lessonReportJson: true,
        createdAt: true,
      },
    });

    const sessions = student.sessions.map((session) => {
      const summaryMarkdown = sanitizeSummaryMarkdown(session.conversation?.summaryMarkdown ?? "");
      const topicSuggestionsJson = sanitizeTopicSuggestions(session.conversation?.topicSuggestionsJson);
      const quickQuestionsJson = sanitizeQuickQuestions(session.conversation?.quickQuestionsJson);
      const timelineJson = normalizeTimelineForView(session.conversation?.timelineJson);
      const nextActionsJson = normalizeNextActionsForView(session.conversation?.nextActionsJson);
      const profileSectionsJson = normalizeProfileSectionsForView(session.conversation?.profileSectionsJson);
      const lessonReportJson = normalizeLessonReportForView(session.conversation?.lessonReportJson);
      const studentStateJson = normalizeStudentStateForView(session.conversation?.studentStateJson);
      const conversation = session.conversation
        ? {
            ...session.conversation,
            summaryMarkdown,
            timelineJson,
            parentPackJson: session.conversation.parentPackJson as any,
            topicSuggestionsJson,
            quickQuestionsJson,
            nextActionsJson,
            profileSectionsJson,
            lessonReportJson,
            studentStateJson,
            operationalLog: buildOperationalLog({
              sessionType: session.type,
              createdAt: session.conversation.createdAt,
              summaryMarkdown,
              timeline: timelineJson as any,
              nextActions: nextActionsJson as any,
              parentPack: session.conversation.parentPackJson as any,
              studentState: studentStateJson as any,
              profileSections: profileSectionsJson as any,
              quickQuestions: quickQuestionsJson,
              lessonReport: lessonReportJson as any,
            }),
            operationalSummaryMarkdown: renderOperationalSummaryMarkdown(
              buildOperationalLog({
                sessionType: session.type,
                createdAt: session.conversation.createdAt,
                summaryMarkdown,
                timeline: timelineJson as any,
                nextActions: nextActionsJson as any,
                parentPack: session.conversation.parentPackJson as any,
                studentState: studentStateJson as any,
                profileSections: profileSectionsJson as any,
                quickQuestions: quickQuestionsJson,
                lessonReport: lessonReportJson as any,
              }),
              {
                sessionType: session.type,
                studentName: student.name,
                sessionDate: session.conversation.createdAt,
              }
            ),
          }
        : null;

      return {
        ...session,
        conversation,
      };
    });

    const latestConversationWithDerived = latestConversation
      ? {
          ...latestConversation,
          summaryMarkdown: sanitizeSummaryMarkdown(latestConversation.summaryMarkdown ?? ""),
          timelineJson: normalizeTimelineForView(latestConversation.timelineJson),
          parentPackJson: latestConversation.parentPackJson as any,
          topicSuggestionsJson: sanitizeTopicSuggestions(latestConversation.topicSuggestionsJson),
          quickQuestionsJson: sanitizeQuickQuestions(latestConversation.quickQuestionsJson),
          nextActionsJson: normalizeNextActionsForView(latestConversation.nextActionsJson),
          profileSectionsJson: normalizeProfileSectionsForView(latestConversation.profileSectionsJson),
          lessonReportJson: normalizeLessonReportForView(latestConversation.lessonReportJson),
          studentStateJson: normalizeStudentStateForView(latestConversation.studentStateJson),
          operationalLog: buildOperationalLog({
            createdAt: latestConversation.createdAt,
            summaryMarkdown: sanitizeSummaryMarkdown(latestConversation.summaryMarkdown ?? ""),
            timeline: normalizeTimelineForView(latestConversation.timelineJson) as any,
            nextActions: normalizeNextActionsForView(latestConversation.nextActionsJson) as any,
            parentPack: latestConversation.parentPackJson as any,
            studentState: normalizeStudentStateForView(latestConversation.studentStateJson) as any,
            profileSections: normalizeProfileSectionsForView(latestConversation.profileSectionsJson) as any,
            quickQuestions: sanitizeQuickQuestions(latestConversation.quickQuestionsJson),
            lessonReport: normalizeLessonReportForView(latestConversation.lessonReportJson) as any,
          }),
          operationalSummaryMarkdown: renderOperationalSummaryMarkdown(
            buildOperationalLog({
              createdAt: latestConversation.createdAt,
              summaryMarkdown: sanitizeSummaryMarkdown(latestConversation.summaryMarkdown ?? ""),
              timeline: normalizeTimelineForView(latestConversation.timelineJson) as any,
              nextActions: normalizeNextActionsForView(latestConversation.nextActionsJson) as any,
              parentPack: latestConversation.parentPackJson as any,
              studentState: normalizeStudentStateForView(latestConversation.studentStateJson) as any,
              profileSections: normalizeProfileSectionsForView(latestConversation.profileSectionsJson) as any,
              quickQuestions: sanitizeQuickQuestions(latestConversation.quickQuestionsJson),
              lessonReport: normalizeLessonReportForView(latestConversation.lessonReportJson) as any,
            }),
            {
              studentName: student.name,
              sessionDate: latestConversation.createdAt,
            }
          ),
        }
      : null;

    const authSession = await auth();
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
