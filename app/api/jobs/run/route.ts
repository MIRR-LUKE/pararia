import { NextResponse } from "next/server";
import { processQueuedJobs } from "@/lib/jobs/conversationJobs";

async function handleRequest(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? 3);
    const concurrencyParam = Number(searchParams.get("concurrency"));
    const envConcurrency = Number(process.env.JOB_CONCURRENCY ?? 3);
    const concurrency = Number.isFinite(concurrencyParam)
      ? concurrencyParam
      : Number.isFinite(envConcurrency)
        ? envConcurrency
        : 1;
    const result = await processQueuedJobs(Number.isFinite(limit) ? limit : 1, concurrency);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[/api/jobs/run] Error:", {
      error: e?.message,
      stack: e?.stack,
    });
    return NextResponse.json({ ok: false, error: e?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}
