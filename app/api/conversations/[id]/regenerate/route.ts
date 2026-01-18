import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { JobStatus, ConversationJobType } from "@prisma/client";
import { enqueueConversationJobs, processAllConversationJobs } from "@/lib/jobs/conversationJobs";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const conversation = await prisma.conversationLog.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        rawTextOriginal: true,
        rawTextCleaned: true,
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    if (!conversation.rawTextOriginal || !conversation.rawTextCleaned) {
      return NextResponse.json(
        { error: "rawTextOriginal or rawTextCleaned is missing. Cannot regenerate." },
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
        summary: "",
        timeline: undefined,
        nextActions: undefined,
        structuredDelta: undefined,
        formattedTranscript: undefined,
        summaryStatus: JobStatus.PENDING,
        extractStatus: JobStatus.PENDING,
        summaryError: null,
        extractError: null,
        summaryUpdatedAt: null,
        extractUpdatedAt: null,
      },
    });
    
    // titleフィールドを別途更新（型定義の問題を回避）
    try {
      await prisma.$executeRaw`UPDATE "ConversationLog" SET title = NULL WHERE id = ${params.id}`;
    } catch (e) {
      console.warn("[regenerate] Failed to clear title field:", e);
    }

    // 新しいジョブを強制的に作成（再生成のため、既存の完了状態を無視）
    await prisma.conversationJob.createMany({
      data: [
        { conversationId: params.id, type: ConversationJobType.SUMMARY, status: JobStatus.PENDING },
        { conversationId: params.id, type: ConversationJobType.EXTRACT, status: JobStatus.PENDING },
      ],
      skipDuplicates: true,
    });

    // 非同期でジョブを実行（Fire-and-forget）
    processAllConversationJobs(params.id).catch((e) => {
      console.error("[POST /api/conversations/[id]/regenerate] Background job processing failed:", {
        conversationId: params.id,
        error: e?.message,
        stack: e?.stack,
      });
    });

    return NextResponse.json({
      success: true,
      message: "再生成を開始しました。数分後に反映されます。",
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

