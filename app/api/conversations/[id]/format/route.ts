import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ConversationJobType, JobStatus } from "@prisma/client";
import { processAllConversationJobs } from "@/lib/jobs/conversationJobs";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const conversation = await prisma.conversationLog.findFirst({
      where: { id: params.id, organizationId },
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

    void processAllConversationJobs(params.id).catch((error) => {
      console.error("[POST /api/conversations/[id]/format] Background process failed:", error);
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
