import { NextResponse } from "next/server";
import { processQueuedJobs } from "@/lib/jobs/conversationJobs";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? 3);
    const result = await processQueuedJobs(Number.isFinite(limit) ? limit : 1);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[POST /api/jobs/run] Error:", {
      error: e?.message,
      stack: e?.stack,
    });
    return NextResponse.json({ ok: false, error: e?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
