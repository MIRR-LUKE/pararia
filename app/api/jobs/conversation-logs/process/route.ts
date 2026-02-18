import { NextResponse } from "next/server";
import { processQueuedJobs } from "@/lib/jobs/conversationJobs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Number(body?.limit ?? 1);
    const concurrency = Number(body?.concurrency ?? process.env.JOB_CONCURRENCY ?? 1);
    const conversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;
    const result = await processQueuedJobs(
      Number.isFinite(limit) ? limit : 1,
      Number.isFinite(concurrency) ? concurrency : 1,
      conversationId ? { conversationId } : undefined
    );
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
