import { NextResponse } from "next/server";
import { ConversationStatus, JobStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  enqueueConversationJobs,
  isConversationJobRunActive,
  processAllConversationJobs,
} from "@/lib/jobs/conversationJobs";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const { searchParams } = new URL(request.url);
    const includeFormat = searchParams.get("format") === "1";
    const conversation = await prisma.conversationLog.findFirst({
      where: { id: params.id, organizationId },
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

    const runningJobs = await prisma.conversationJob.count({
      where: {
        conversationId: params.id,
        status: JobStatus.RUNNING,
      },
    });

    if (runningJobs > 0 || isConversationJobRunActive(params.id)) {
      return NextResponse.json(
        { error: "このログは現在生成中です。完了後に再試行してください。" },
        { status: 409 }
      );
    }

    const hasRawSource =
      Boolean(conversation.rawTextCleaned?.trim()) ||
      Boolean(conversation.rawTextOriginal?.trim()) ||
      Boolean(conversation.formattedTranscript?.trim());

    if (!hasRawSource) {
      return NextResponse.json(
        { error: "raw transcript is missing. Cannot regenerate." },
        { status: 400 }
      );
    }

    const keepFormattedTranscriptAsSource =
      !conversation.rawTextCleaned?.trim() &&
      !conversation.rawTextOriginal?.trim() &&
      Boolean(conversation.formattedTranscript?.trim());

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
        lessonReportJson: Prisma.DbNull,
        chunkAnalysisJson: Prisma.DbNull,
        qualityMetaJson: Prisma.DbNull,
        formattedTranscript: keepFormattedTranscriptAsSource ? conversation.formattedTranscript : null,
      },
    });

    await enqueueConversationJobs(params.id, { includeFormat });
    void processAllConversationJobs(params.id).catch((error) => {
      console.error("[POST /api/conversations/[id]/regenerate] Background process failed:", error);
    });

    if (conversation.sessionId) {
      await prisma.session.update({
        where: { id: conversation.sessionId },
        data: { status: "PROCESSING" },
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
