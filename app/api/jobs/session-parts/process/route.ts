import { NextResponse } from "next/server";
import { processQueuedSessionPartJobs } from "@/lib/jobs/sessionPartJobs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Number(body?.limit ?? 1);
    const concurrency = Number(body?.concurrency ?? process.env.SESSION_PART_JOB_CONCURRENCY ?? 1);
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : undefined;
    const result = await processQueuedSessionPartJobs(
      Number.isFinite(limit) ? limit : 1,
      Number.isFinite(concurrency) ? concurrency : 1,
      sessionId ? { sessionId } : undefined
    );
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[POST /api/jobs/session-parts/process] Error:", {
      error: e?.message,
      stack: e?.stack,
    });
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
