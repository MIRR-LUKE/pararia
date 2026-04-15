import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { processQueuedJobs } from "@/lib/jobs/conversationJobs";
import { processQueuedSessionPartJobs } from "@/lib/jobs/sessionPartJobs";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { describeRequestActor, requireMaintenanceAccess } from "@/lib/server/request-auth";
import { methodNotAllowedResponse, requireSameOriginRequest } from "@/lib/server/request-security";

function clampRouteInt(raw: unknown, fallback: number, min: number, max: number) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

const JOB_ROUTE_LIMIT_MAX = clampRouteInt(process.env.JOB_ROUTE_LIMIT_MAX ?? 20, 20, 1, 100);
const JOB_ROUTE_CONCURRENCY_MAX = clampRouteInt(process.env.JOB_ROUTE_CONCURRENCY_MAX ?? 4, 4, 1, 12);

async function handleRequest(request: Request) {
  const access = await requireMaintenanceAccess(request);
  if (access.response) return access.response;
  const actor = access.actor;

  if (actor?.kind === "session") {
    const sameOriginResponse = requireSameOriginRequest(request);
    if (sameOriginResponse) return sameOriginResponse;
  }

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
    const body = await request.json().catch(() => ({}));
    const limit = clampRouteInt(searchParams.get("limit") ?? (body as any)?.limit, 3, 1, JOB_ROUTE_LIMIT_MAX);
    const rawConcurrency = searchParams.get("concurrency") ?? (body as any)?.concurrency;
    const conversationId =
      searchParams.get("conversationId") ?? (typeof (body as any)?.conversationId === "string" ? (body as any).conversationId : undefined);
    const sessionId =
      searchParams.get("sessionId") ?? (typeof (body as any)?.sessionId === "string" ? (body as any).sessionId : undefined);
    const envConcurrency = clampRouteInt(process.env.JOB_CONCURRENCY ?? 3, 3, 1, JOB_ROUTE_CONCURRENCY_MAX);
    const concurrency =
      rawConcurrency == null
        ? envConcurrency
        : clampRouteInt(rawConcurrency, envConcurrency, 1, JOB_ROUTE_CONCURRENCY_MAX);
    const sessionPartJobs = await processQueuedSessionPartJobs(
      limit,
      concurrency,
      sessionId ? { sessionId } : undefined
    );
    const conversationJobs = await processQueuedJobs(
      limit,
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
        limit,
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

export async function GET() {
  return methodNotAllowedResponse(["POST"]);
}

export async function POST(request: Request) {
  return handleRequest(request);
}
