import { NextResponse } from "next/server";
import { ensureConversationForSession } from "@/lib/session-service";
import { enqueueConversationJobs, processAllConversationJobs } from "@/lib/jobs/conversationJobs";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const conversationId = await ensureConversationForSession(params.id);
    await enqueueConversationJobs(conversationId);
    void processAllConversationJobs(conversationId).catch((error) => {
      console.error("[POST /api/sessions/[id]/generate] Background processing failed:", error);
    });
    return NextResponse.json({ ok: true, conversationId });
  } catch (error: any) {
    console.error("[POST /api/sessions/[id]/generate] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
