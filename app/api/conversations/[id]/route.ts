import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const process = searchParams.get("process");
    if (process === "1") {
      // Fire-and-forget: Process both Job A (SUMMARY) and Job B (EXTRACT) in parallel
      try {
        const { processAllConversationJobs } = await import("@/lib/jobs/conversationJobs");
        // don't await heavy work here; both jobs run in parallel in the background
        void processAllConversationJobs(params.id).catch(() => {});
      } catch (e) {
        // ignore
      }
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
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // JSONフィールドを適切にシリアライズ
    const response = {
      ...conversation,
      rawTextOriginal: conversation.rawTextOriginal,
      rawTextCleaned: conversation.rawTextCleaned,
      rawSegments: conversation.rawSegments as any,
      timeline: conversation.timeline as any,
      nextActions: conversation.nextActions as string[] | null,
      structuredDelta: conversation.structuredDelta as any,
      formattedTranscript: conversation.formattedTranscript,
      // Legacy fields (for backward compatibility)
      timeSections: conversation.timeSections as any,
      keyQuotes: conversation.keyQuotes as string[] | null,
      keyTopics: conversation.keyTopics as string[] | null,
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
      summary,
      title,
      timeline,
      nextActions,
      structuredDelta,
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
    if (summary !== undefined) updateData.summary = summary;
    if (title !== undefined) updateData.title = title;
    if (timeline !== undefined) updateData.timeline = timeline;
    if (nextActions !== undefined) updateData.nextActions = nextActions;
    if (structuredDelta !== undefined) updateData.structuredDelta = structuredDelta;
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

    // JSONフィールドを適切にシリアライズ
    const response = {
      ...updated,
      rawTextOriginal: updated.rawTextOriginal,
      rawTextCleaned: updated.rawTextCleaned,
      rawSegments: updated.rawSegments as any,
      timeline: updated.timeline as any,
      nextActions: updated.nextActions as string[] | null,
      structuredDelta: updated.structuredDelta as any,
      formattedTranscript: updated.formattedTranscript,
      timeSections: updated.timeSections as any,
      keyQuotes: updated.keyQuotes as string[] | null,
      keyTopics: updated.keyTopics as string[] | null,
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
