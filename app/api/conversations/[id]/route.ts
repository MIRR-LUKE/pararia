import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildOperationalLog, buildReuseBlocks, renderOperationalSummaryMarkdown } from "@/lib/operational-log";
import {
  sanitizeQuickQuestions,
  sanitizeSummaryMarkdown,
  sanitizeTopicSuggestions,
} from "@/lib/user-facing-japanese";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const process = searchParams.get("process");
    const brief = searchParams.get("brief") === "1";
    if (process === "1") {
      try {
        const { processAllConversationJobs } = await import("@/lib/jobs/conversationJobs");
        void processAllConversationJobs(params.id).catch(() => {});
      } catch {
        // ignore
      }
    }

    if (brief) {
      const briefConversation = await prisma.conversationLog.findUnique({
        where: { id: params.id },
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
              startedAt: true,
              finishedAt: true,
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

    const conversation = await prisma.conversationLog.findUnique({
      where: { id: params.id },
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
            model: true,
            startedAt: true,
            finishedAt: true,
            lastError: true,
          },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const summaryMarkdown = sanitizeSummaryMarkdown(conversation.summaryMarkdown ?? "");
    const quickQuestionsJson = sanitizeQuickQuestions(conversation.quickQuestionsJson);

    return NextResponse.json({
      conversation: {
        ...conversation,
        summaryMarkdown,
        rawSegments: conversation.rawSegments as any,
        timelineJson: conversation.timelineJson as any,
        nextActionsJson: conversation.nextActionsJson as any,
        profileDeltaJson: conversation.profileDeltaJson as any,
        parentPackJson: conversation.parentPackJson as any,
        studentStateJson: conversation.studentStateJson as any,
        topicSuggestionsJson: sanitizeTopicSuggestions(conversation.topicSuggestionsJson),
        quickQuestionsJson,
        profileSectionsJson: conversation.profileSectionsJson as any,
        observationJson: conversation.observationJson as any,
        lessonReportJson: conversation.lessonReportJson as any,
        qualityMetaJson: conversation.qualityMetaJson as any,
        operationalLog: buildOperationalLog({
          sessionType: conversation.session?.type,
          createdAt: conversation.createdAt,
          summaryMarkdown,
          timeline: conversation.timelineJson as any,
          nextActions: conversation.nextActionsJson as any,
          parentPack: conversation.parentPackJson as any,
          studentState: conversation.studentStateJson as any,
          profileSections: conversation.profileSectionsJson as any,
          quickQuestions: quickQuestionsJson,
          lessonReport: conversation.lessonReportJson as any,
        }),
        operationalSummaryMarkdown: renderOperationalSummaryMarkdown(
          buildOperationalLog({
            sessionType: conversation.session?.type,
            createdAt: conversation.createdAt,
            summaryMarkdown,
            timeline: conversation.timelineJson as any,
            nextActions: conversation.nextActionsJson as any,
            parentPack: conversation.parentPackJson as any,
            studentState: conversation.studentStateJson as any,
            profileSections: conversation.profileSectionsJson as any,
            quickQuestions: quickQuestionsJson,
            lessonReport: conversation.lessonReportJson as any,
          })
        ),
        reuseBlocks: buildReuseBlocks(
          buildOperationalLog({
            sessionType: conversation.session?.type,
            createdAt: conversation.createdAt,
            summaryMarkdown,
            timeline: conversation.timelineJson as any,
            nextActions: conversation.nextActionsJson as any,
            parentPack: conversation.parentPackJson as any,
            studentState: conversation.studentStateJson as any,
            profileSections: conversation.profileSectionsJson as any,
            quickQuestions: quickQuestionsJson,
            lessonReport: conversation.lessonReportJson as any,
          })
        ),
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
    const conversation = await prisma.conversationLog.findUnique({
      where: { id: params.id },
      select: { id: true, studentId: true, sessionId: true },
    });

    if (!conversation) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    await prisma.conversationJob.deleteMany({ where: { conversationId: params.id } });
    await prisma.conversationLog.delete({ where: { id: params.id } });

    if (conversation.sessionId) {
      await prisma.session.update({
        where: { id: conversation.sessionId },
        data: { status: "DRAFT" },
      });
    }

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
    const body = await request.json();
    const {
      summaryMarkdown,
      timelineJson,
      nextActionsJson,
      profileDeltaJson,
      formattedTranscript,
      studentStateJson,
      topicSuggestionsJson,
      quickQuestionsJson,
      profileSectionsJson,
      observationJson,
      lessonReportJson,
    } = body ?? {};

    const updateData: any = {};
    if (summaryMarkdown !== undefined) updateData.summaryMarkdown = summaryMarkdown;
    if (timelineJson !== undefined) updateData.timelineJson = timelineJson;
    if (nextActionsJson !== undefined) updateData.nextActionsJson = nextActionsJson;
    if (profileDeltaJson !== undefined) updateData.profileDeltaJson = profileDeltaJson;
    if (formattedTranscript !== undefined) updateData.formattedTranscript = formattedTranscript;
    if (studentStateJson !== undefined) updateData.studentStateJson = studentStateJson;
    if (topicSuggestionsJson !== undefined) updateData.topicSuggestionsJson = topicSuggestionsJson;
    if (quickQuestionsJson !== undefined) updateData.quickQuestionsJson = quickQuestionsJson;
    if (profileSectionsJson !== undefined) updateData.profileSectionsJson = profileSectionsJson;
    if (observationJson !== undefined) updateData.observationJson = observationJson;
    if (lessonReportJson !== undefined) updateData.lessonReportJson = lessonReportJson;

    const updated = await prisma.conversationLog.update({
      where: { id: params.id },
      data: updateData,
    });

    return NextResponse.json({
      conversation: {
        ...updated,
        rawSegments: updated.rawSegments as any,
        timelineJson: updated.timelineJson as any,
        nextActionsJson: updated.nextActionsJson as any,
        profileDeltaJson: updated.profileDeltaJson as any,
        parentPackJson: updated.parentPackJson as any,
        studentStateJson: updated.studentStateJson as any,
        topicSuggestionsJson: updated.topicSuggestionsJson as any,
        quickQuestionsJson: updated.quickQuestionsJson as any,
        profileSectionsJson: updated.profileSectionsJson as any,
        observationJson: updated.observationJson as any,
        lessonReportJson: updated.lessonReportJson as any,
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
