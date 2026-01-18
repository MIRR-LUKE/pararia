import { NextResponse } from "next/server";
import { processOneConversationJob } from "@/lib/jobs/conversationJobs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const conversationId = (body?.conversationId as string | undefined) ?? undefined;

    const result = await processOneConversationJob(conversationId);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[POST /api/jobs/conversation-logs/process] Error:", {
      error: e?.message,
      stack: e?.stack,
    });
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}



