import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { buildOperationalLog, renderOperationalSummaryMarkdown } from "@/lib/operational-log";
import { getRecordingLockView } from "@/lib/recording/lockService";

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
            entities: {
              orderBy: [{ status: "asc" }, { confidence: "desc" }],
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
                entityCandidatesJson: true,
                createdAt: true,
              },
            },
          },
          take: 12,
        },
        reports: {
          orderBy: { createdAt: "desc" },
          take: 6,
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
        entityCandidatesJson: true,
        createdAt: true,
      },
    });

    const sessions = student.sessions.map((session) => {
      const conversation = session.conversation
        ? {
            ...session.conversation,
            timelineJson: session.conversation.timelineJson as any,
            parentPackJson: session.conversation.parentPackJson as any,
            topicSuggestionsJson: session.conversation.topicSuggestionsJson as any,
            quickQuestionsJson: session.conversation.quickQuestionsJson as any,
            nextActionsJson: session.conversation.nextActionsJson as any,
            profileSectionsJson: session.conversation.profileSectionsJson as any,
            lessonReportJson: session.conversation.lessonReportJson as any,
            entityCandidatesJson: session.conversation.entityCandidatesJson as any,
            studentStateJson: session.conversation.studentStateJson as any,
            operationalLog: buildOperationalLog({
              sessionType: session.type,
              createdAt: session.conversation.createdAt,
              summaryMarkdown: session.conversation.summaryMarkdown ?? "",
              timeline: session.conversation.timelineJson as any,
              nextActions: session.conversation.nextActionsJson as any,
              parentPack: session.conversation.parentPackJson as any,
              studentState: session.conversation.studentStateJson as any,
              profileSections: session.conversation.profileSectionsJson as any,
              quickQuestions: session.conversation.quickQuestionsJson as any,
              entityCandidates: session.conversation.entityCandidatesJson as any,
              lessonReport: session.conversation.lessonReportJson as any,
              sessionEntities: session.entities as any,
            }),
            operationalSummaryMarkdown: renderOperationalSummaryMarkdown(
              buildOperationalLog({
                sessionType: session.type,
                createdAt: session.conversation.createdAt,
                summaryMarkdown: session.conversation.summaryMarkdown ?? "",
                timeline: session.conversation.timelineJson as any,
                nextActions: session.conversation.nextActionsJson as any,
                parentPack: session.conversation.parentPackJson as any,
                studentState: session.conversation.studentStateJson as any,
                profileSections: session.conversation.profileSectionsJson as any,
                quickQuestions: session.conversation.quickQuestionsJson as any,
                entityCandidates: session.conversation.entityCandidatesJson as any,
                lessonReport: session.conversation.lessonReportJson as any,
                sessionEntities: session.entities as any,
              })
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
          timelineJson: latestConversation.timelineJson as any,
          parentPackJson: latestConversation.parentPackJson as any,
          topicSuggestionsJson: latestConversation.topicSuggestionsJson as any,
          quickQuestionsJson: latestConversation.quickQuestionsJson as any,
          nextActionsJson: latestConversation.nextActionsJson as any,
          profileSectionsJson: latestConversation.profileSectionsJson as any,
          lessonReportJson: latestConversation.lessonReportJson as any,
          entityCandidatesJson: latestConversation.entityCandidatesJson as any,
          studentStateJson: latestConversation.studentStateJson as any,
          operationalLog: buildOperationalLog({
            createdAt: latestConversation.createdAt,
            summaryMarkdown: latestConversation.summaryMarkdown ?? "",
            timeline: latestConversation.timelineJson as any,
            nextActions: latestConversation.nextActionsJson as any,
            parentPack: latestConversation.parentPackJson as any,
            studentState: latestConversation.studentStateJson as any,
            profileSections: latestConversation.profileSectionsJson as any,
            quickQuestions: latestConversation.quickQuestionsJson as any,
            entityCandidates: latestConversation.entityCandidatesJson as any,
            lessonReport: latestConversation.lessonReportJson as any,
          }),
          operationalSummaryMarkdown: renderOperationalSummaryMarkdown(
            buildOperationalLog({
              createdAt: latestConversation.createdAt,
              summaryMarkdown: latestConversation.summaryMarkdown ?? "",
              timeline: latestConversation.timelineJson as any,
              nextActions: latestConversation.nextActionsJson as any,
              parentPack: latestConversation.parentPackJson as any,
              studentState: latestConversation.studentStateJson as any,
              profileSections: latestConversation.profileSectionsJson as any,
              quickQuestions: latestConversation.quickQuestionsJson as any,
              entityCandidates: latestConversation.entityCandidatesJson as any,
              lessonReport: latestConversation.lessonReportJson as any,
            })
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
      reports: student.reports,
      recordingLock,
    });
  } catch (error: any) {
    console.error("[GET /api/students/[id]/room] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
