import { NextResponse } from "next/server";
import {
  applyOperationJobAction,
  normalizeOperationJobAction,
  normalizeOperationJobKind,
  OperationJobControlError,
} from "@/lib/operations/job-control";
import { writePlatformAuditLog } from "@/lib/admin/platform-audit";
import { resolvePlatformOperatorForSession } from "@/lib/admin/platform-operators";
import { resolveRouteParams, type RouteParams } from "@/lib/server/route-params";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { methodNotAllowedResponse } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = {
  kind: string | undefined;
  id: string | undefined;
};

function readReason(raw: unknown) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value ? value.slice(0, 1000) : null;
}

function readString(raw: unknown) {
  return typeof raw === "string" ? raw.trim() : "";
}

function requestMeta(request: Request) {
  return {
    requestId: request.headers.get("x-request-id"),
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  };
}

export async function POST(request: Request, { params }: { params: RouteParams<Params> }) {
  const sessionResult = await requireAuthorizedSession();
  if (sessionResult.response) return sessionResult.response;

  const operator = await resolvePlatformOperatorForSession({
    email: sessionResult.session.user.email,
    role: sessionResult.session.user.role,
  });

  const { kind: rawKind, id: rawId } = await resolveRouteParams(params);
  const kind = normalizeOperationJobKind(rawKind);
  const jobId = rawId?.trim() ?? "";
  const body = await request.json().catch(() => ({}));
  const action = normalizeOperationJobAction(typeof body?.action === "string" ? body.action : null);
  const organizationId = readString(body?.organizationId);
  const reason = readReason(body?.reason);
  const confirmJobId = readString(body?.confirmJobId);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || readString(body?.idempotencyKey) || null;

  if (!kind || !jobId) {
    return NextResponse.json({ error: "kind と jobId が必要です。" }, { status: 400 });
  }
  if (!action) {
    return NextResponse.json({ error: "action は retry または cancel を指定してください。" }, { status: 400 });
  }
  if (!organizationId) {
    return NextResponse.json({ error: "対象校舎を指定してください。" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: "操作理由を入力してください。" }, { status: 400 });
  }
  if (confirmJobId !== jobId) {
    return NextResponse.json({ error: "確認用のジョブIDが一致しません。" }, { status: 400 });
  }

  if (!operator?.permissions.canExecuteDangerousActions) {
    await writePlatformAuditLog({
      actorOperatorId: operator?.id?.startsWith("env:") ? null : operator?.id ?? null,
      action: `admin.operations.jobs.${action}`,
      status: "DENIED",
      reason,
      riskLevel: "HIGH",
      target: { type: `${kind}_job`, id: jobId, organizationId },
      request: requestMeta(request),
      metadata: {
        viewerEmail: sessionResult.session.user.email,
        viewerRole: sessionResult.session.user.role,
        idempotencyKey,
      },
    });
    return NextResponse.json({ error: "この操作は運営の復旧権限が必要です。" }, { status: 403 });
  }

  try {
    await writePlatformAuditLog({
      actorOperatorId: operator.id.startsWith("env:") ? null : operator.id,
      action: `admin.operations.jobs.${action}`,
      status: "PREPARED",
      reason,
      riskLevel: "HIGH",
      target: { type: `${kind}_job`, id: jobId, organizationId },
      request: requestMeta(request),
      metadata: {
        confirmationMatched: true,
        idempotencyKey,
        dangerousOperationExecuted: false,
      },
    });

    const result = await applyOperationJobAction({
      organizationId,
      jobId,
      kind,
      action,
      reason,
    });

    await writePlatformAuditLog({
      actorOperatorId: operator.id.startsWith("env:") ? null : operator.id,
      action: `admin.operations.jobs.${action}`,
      status: "SUCCESS",
      reason,
      riskLevel: "HIGH",
      target: { type: `${kind}_job`, id: jobId, organizationId },
      request: requestMeta(request),
      before: {
        status: result.previousStatus,
      },
      after: {
        status: result.nextStatus,
      },
      metadata: {
        ...result,
        idempotencyKey,
        dangerousOperationExecuted: true,
      },
    });

    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    const status = error instanceof OperationJobControlError ? error.status : 500;
    await writePlatformAuditLog({
      actorOperatorId: operator.id.startsWith("env:") ? null : operator.id,
      action: `admin.operations.jobs.${action}`,
      status: "ERROR",
      reason,
      riskLevel: "HIGH",
      target: { type: `${kind}_job`, id: jobId, organizationId },
      request: requestMeta(request),
      metadata: {
        error: error?.message ?? "Internal Server Error",
        idempotencyKey,
      },
    });
    console.error("[POST /api/admin/operations/jobs/[kind]/[id]] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status });
  }
}

export async function GET() {
  return methodNotAllowedResponse(["POST"]);
}
