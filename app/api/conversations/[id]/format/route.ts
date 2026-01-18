import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ConversationJobType, ConversationStatus, JobStatus } from "@prisma/client";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const conversation = await prisma.conversationLog.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        formattedTranscript: true,
        rawTextOriginal: true,
        rawTextCleaned: true,
        rawSegments: true,
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    if (conversation.formattedTranscript) {
      return NextResponse.json({ ok: true, message: "already formatted" });
    }

    if (!conversation.rawTextOriginal && !conversation.rawTextCleaned && !conversation.rawSegments) {
      return NextResponse.json(
        { error: "raw transcript is missing. Cannot format." },
        { status: 400 }
      );
    }

    await prisma.conversationJob.createMany({
      data: [
        { conversationId: params.id, type: ConversationJobType.FORMAT, status: JobStatus.QUEUED },
      ],
      skipDuplicates: true,
    });

    await prisma.conversationLog.update({
      where: { id: params.id },
      data: { status: ConversationStatus.PARTIAL },
    });

    return NextResponse.json({ ok: true, message: "format job queued" });
  } catch (error: any) {
    console.error("[POST /api/conversations/[id]/format] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
