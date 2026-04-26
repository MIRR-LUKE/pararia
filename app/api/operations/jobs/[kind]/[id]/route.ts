import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { canOperateProductionJobs } from "@/lib/permissions";
import {
  applyOperationJobAction,
  normalizeOperationJobAction,
  normalizeOperationJobKind,
  OperationJobControlError,
} from "@/lib/operations/job-control";
import { resolveRouteParams, type RouteParams } from "@/lib/server/route-params";
import { requireAuthorizedMutationSession } from "@/lib/server/request-auth";
import { methodNotAllowedResponse } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = {
  kind: string | undefined;
  id: string | undefined;
};

function readReason(raw: unknown) {
  if (typeof raw !== "string") return "operator_action";
  const value = raw.trim();
  return value ? value.slice(0, 500) : "operator_action";
}

export async function POST(request: Request, { params }: { params: RouteParams<Params> }) {
  const authResult = await requireAuthorizedMutationSession(request);
  if (authResult.response) return authResult.response;

  const { kind: rawKind, id: rawId } = await resolveRouteParams(params);
  const kind = normalizeOperationJobKind(rawKind);
  const jobId = rawId?.trim() ?? "";
  if (!kind || !jobId) {
    return NextResponse.json({ error: "kind と jobId が必要です。" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const action = normalizeOperationJobAction(typeof body?.action === "string" ? body.action : null);
  const reason = readReason(body?.reason);
  if (!action) {
    return NextResponse.json({ error: "action は retry または cancel を指定してください。" }, { status: 400 });
  }

  if (!canOperateProductionJobs(authResult.session.user.role, authResult.session.user.email)) {
    await writeAuditLog({
      organizationId: authResult.session.user.organizationId,
      userId: authResult.session.user.id,
      action: `operations.jobs.${action}`,
      targetType: `${kind}_job`,
      targetId: jobId,
      status: "DENIED",
      detail: {
        reason: "insufficient_role",
        viewerRole: authResult.session.user.role ?? null,
      },
    });
    return NextResponse.json({ error: "この操作は管理者のみ可能です。" }, { status: 403 });
  }

  try {
    const result = await applyOperationJobAction({
      organizationId: authResult.session.user.organizationId,
      jobId,
      kind,
      action,
      reason,
    });

    await writeAuditLog({
      organizationId: authResult.session.user.organizationId,
      userId: authResult.session.user.id,
      action: `operations.jobs.${action}`,
      targetType: `${kind}_job`,
      targetId: jobId,
      status: "SUCCESS",
      detail: {
        ...result,
        reason,
      },
    });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error: any) {
    const status = error instanceof OperationJobControlError ? error.status : 500;
    await writeAuditLog({
      organizationId: authResult.session.user.organizationId,
      userId: authResult.session.user.id,
      action: `operations.jobs.${action}`,
      targetType: `${kind}_job`,
      targetId: jobId,
      status: "ERROR",
      detail: {
        reason,
        error: error?.message ?? "Internal Server Error",
      },
    });
    console.error("[POST /api/operations/jobs/[kind]/[id]] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status });
  }
}

export async function GET() {
  return methodNotAllowedResponse(["POST"]);
}
