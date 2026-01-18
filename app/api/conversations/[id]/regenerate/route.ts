import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ConversationStatus, Prisma } from "@prisma/client";
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
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    if (!conversation.rawTextOriginal && !conversation.formattedTranscript) {
      return NextResponse.json(
        { error: "rawTextOriginal or formattedTranscript is missing. Cannot regenerate." },
        { status: 400 }
      );
    }

    // 既存のジョブを削除（再生成のため）
    await prisma.conversationJob.deleteMany({
      where: { conversationId: params.id },
    });

    // ステータスをリセット
    await prisma.conversationLog.update({
      where: { id: params.id },
      data: {
        status: ConversationStatus.PROCESSING,
        summaryMarkdown: null,
        timelineJson: Prisma.DbNull,
        nextActionsJson: Prisma.DbNull,
        profileDeltaJson: Prisma.DbNull,
        parentPackJson: Prisma.DbNull,
        formattedTranscript: null,
      },
    });

    await enqueueConversationJobs(params.id, { includeFormat });

    return NextResponse.json({
      success: true,
      message: "再生成を開始しました。ジョブ実行APIで処理を進めてください。",
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
