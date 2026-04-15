import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { processQueuedJobs } from "@/lib/jobs/conversationJobs";
import { processQueuedSessionPartJobs } from "@/lib/jobs/sessionPartJobs";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { describeRequestActor, requireMaintenanceAccess } from "@/lib/server/request-auth";

async function handleRequest(request: Request) {
  const access = await requireMaintenanceAccess(request);
  if (access.response) return access.response;
  const actor = access.actor;

  try {
    if (!shouldRunBackgroundJobsInline()) {
      await writeAuditLog({
        organizationId: access.session?.user.organizationId ?? null,
        userId: access.session?.user.id ?? null,
        action: "maintenance.jobs.run",
        targetType: "maintenance_job",
        targetId: "jobs/run",
        status: "DENIED",
        detail: {
          reason: "external_worker_mode_enabled",
          actor: actor ? describeRequestActor(actor) : null,
        },
      });
      return NextResponse.json(
        {
          ok: false,
          error: "external_worker_mode_enabled",
          message: "この環境は external worker mode です。Runpod worker を起動してください。",
        },
        { status: 409 }
      );
    }

    const { searchParams } = new URL(request.url);
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const limit = Number(searchParams.get("limit") ?? 3);
    const concurrencyParam = Number(searchParams.get("concurrency") ?? (body as any)?.concurrency);
    const conversationId =
      searchParams.get("conversationId") ?? (typeof (body as any)?.conversationId === "string" ? (body as any).conversationId : undefined);
    const sessionId =
      searchParams.get("sessionId") ?? (typeof (body as any)?.sessionId === "string" ? (body as any).sessionId : undefined);
    const envConcurrency = Number(process.env.JOB_CONCURRENCY ?? 3);
    const concurrency = Number.isFinite(concurrencyParam)
      ? concurrencyParam
      : Number.isFinite(envConcurrency)
        ? envConcurrency
        : 1;
    const sessionPartJobs = await processQueuedSessionPartJobs(
      Number.isFinite(limit) ? limit : 1,
      concurrency,
      sessionId ? { sessionId } : undefined
    );
    const conversationJobs = await processQueuedJobs(
      Number.isFinite(limit) ? limit : 1,
      concurrency,
      conversationId ? { conversationId } : undefined
    );
    const result = {
      sessionPartJobs,
      conversationJobs,
      processed: sessionPartJobs.processed + conversationJobs.processed,
      errors: [...sessionPartJobs.errors, ...conversationJobs.errors],
    };

    await writeAuditLog({
      organizationId: access.session?.user.organizationId ?? null,
      userId: access.session?.user.id ?? null,
      action: "maintenance.jobs.run",
      targetType: "maintenance_job",
      targetId: "jobs/run",
      status: "SUCCESS",
      detail: {
        actor: actor ? describeRequestActor(actor) : null,
        limit: Number.isFinite(limit) ? limit : 1,
        concurrency,
        conversationId: conversationId ?? null,
        sessionId: sessionId ?? null,
        processed: result.processed,
        errorCount: result.errors.length,
      },
    });

    return NextResponse.json({
      ...result,
      invokedBy: actor ? describeRequestActor(actor) : null,
    });
  } catch (e: any) {
    await writeAuditLog({
      organizationId: access.session?.user.organizationId ?? null,
      userId: access.session?.user.id ?? null,
      action: "maintenance.jobs.run",
      targetType: "maintenance_job",
      targetId: "jobs/run",
      status: "ERROR",
      detail: {
        actor: actor ? describeRequestActor(actor) : null,
        error: e?.message ?? "Internal Server Error",
      },
    });
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
