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
    const message = error?.message ?? "Internal Server Error";
    const status = message === "session is not ready for generation" ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
