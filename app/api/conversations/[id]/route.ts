import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const process = searchParams.get("process");
    const brief = searchParams.get("brief") === "1";
    if (process === "1") {
      // Fire-and-forget: Process queued jobs in the background
      try {
        const { processAllConversationJobs } = await import("@/lib/jobs/conversationJobs");
        // don't await heavy work here; both jobs run in parallel in the background
        void processAllConversationJobs(params.id).catch(() => {});
      } catch (e) {
        // ignore
      }
    }

    if (brief) {
      const briefConversation = await prisma.conversationLog.findUnique({
        where: { id: params.id },
        select: {
          id: true,
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

    const response = {
      ...conversation,
      rawTextOriginal: conversation.rawTextOriginal,
      rawTextCleaned: conversation.rawTextCleaned,
      rawSegments: conversation.rawSegments as any,
      summaryMarkdown: conversation.summaryMarkdown,
      timelineJson: conversation.timelineJson as any,
      nextActionsJson: conversation.nextActionsJson as any,
      profileDeltaJson: conversation.profileDeltaJson as any,
      parentPackJson: conversation.parentPackJson as any,
      formattedTranscript: conversation.formattedTranscript,
      qualityMetaJson: conversation.qualityMetaJson as any,
    };

    return NextResponse.json({ conversation: response });
  } catch (error: any) {
    console.error("[GET /api/conversations/[id]] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const conversation = await prisma.conversationLog.findUnique({
      where: { id: params.id },
      select: { id: true, studentId: true },
    });

    if (!conversation) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    // Delete related jobs first
    await prisma.conversationJob.deleteMany({
      where: { conversationId: params.id },
    });

    // Delete the conversation log
    await prisma.conversationLog.delete({
      where: { id: params.id },
    });

    return NextResponse.json({
      success: true,
      message: "会話ログを削除しました",
      studentId: conversation.studentId,
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
    } = body;

    const conversation = await prisma.conversationLog.findUnique({
      where: { id: params.id },
    });

    if (!conversation) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    // Update only provided fields
    const updateData: any = {};
    if (summaryMarkdown !== undefined) updateData.summaryMarkdown = summaryMarkdown;
    if (timelineJson !== undefined) updateData.timelineJson = timelineJson;
    if (nextActionsJson !== undefined) updateData.nextActionsJson = nextActionsJson;
    if (profileDeltaJson !== undefined) updateData.profileDeltaJson = profileDeltaJson;
    if (formattedTranscript !== undefined) updateData.formattedTranscript = formattedTranscript;

    const updated = await prisma.conversationLog.update({
      where: { id: params.id },
      data: updateData,
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
      },
    });

    const response = {
      ...updated,
      rawTextOriginal: updated.rawTextOriginal,
      rawTextCleaned: updated.rawTextCleaned,
      rawSegments: updated.rawSegments as any,
      summaryMarkdown: updated.summaryMarkdown,
      timelineJson: updated.timelineJson as any,
      nextActionsJson: updated.nextActionsJson as any,
      profileDeltaJson: updated.profileDeltaJson as any,
      parentPackJson: updated.parentPackJson as any,
      formattedTranscript: updated.formattedTranscript,
      qualityMetaJson: updated.qualityMetaJson as any,
    };

    return NextResponse.json({ conversation: response });
  } catch (error: any) {
    console.error("[PATCH /api/conversations/[id]] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
