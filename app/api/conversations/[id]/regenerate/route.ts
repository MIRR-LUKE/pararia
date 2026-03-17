import { NextResponse } from "next/server";
import { ConversationStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueConversationJobs } from "@/lib/jobs/conversationJobs";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const includeFormat = searchParams.get("format") === "1";
    const conversation = await prisma.conversationLog.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        rawTextOriginal: true,
        rawTextCleaned: true,
        formattedTranscript: true,
        sessionId: true,
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    if (!conversation.rawTextOriginal && !conversation.formattedTranscript) {
      return NextResponse.json(
        { error: "raw transcript is missing. Cannot regenerate." },
        { status: 400 }
      );
    }

    await prisma.conversationJob.deleteMany({ where: { conversationId: params.id } });

    await prisma.conversationLog.update({
      where: { id: params.id },
      data: {
        status: ConversationStatus.PROCESSING,
        summaryMarkdown: null,
        timelineJson: Prisma.DbNull,
        nextActionsJson: Prisma.DbNull,
        profileDeltaJson: Prisma.DbNull,
        parentPackJson: Prisma.DbNull,
        studentStateJson: Prisma.DbNull,
        topicSuggestionsJson: Prisma.DbNull,
        quickQuestionsJson: Prisma.DbNull,
        profileSectionsJson: Prisma.DbNull,
        observationJson: Prisma.DbNull,
        entityCandidatesJson: Prisma.DbNull,
        lessonReportJson: Prisma.DbNull,
        formattedTranscript: null,
      },
    });

    await enqueueConversationJobs(params.id, { includeFormat });

    if (conversation.sessionId) {
      await prisma.session.update({
        where: { id: conversation.sessionId },
        data: { status: "PROCESSING", pendingEntityCount: 0 },
      });
    }

    return NextResponse.json({
      success: true,
      message: "regeneration started",
      conversationId: params.id,
    });
  } catch (error: any) {
    console.error("[POST /api/conversations/[id]/regenerate] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
