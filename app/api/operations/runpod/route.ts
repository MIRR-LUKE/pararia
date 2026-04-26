import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { canOperateProductionJobs } from "@/lib/permissions";
import {
  getManagedRunpodPods,
  getRunpodWorkerConfig,
  maybeEnsureRunpodWorker,
  stopManagedRunpodWorker,
} from "@/lib/runpod/worker-control";
import { requireAuthorizedMutationSession, requireAuthorizedSession } from "@/lib/server/request-auth";
import { methodNotAllowedResponse } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function serializePods(pods: Awaited<ReturnType<typeof getManagedRunpodPods>>) {
  return pods.map((pod) => ({
    id: pod.id,
    name: pod.name ?? null,
    image: pod.imageName ?? pod.image ?? null,
    desiredStatus: pod.desiredStatus ?? null,
    lastStartedAt: pod.lastStartedAt ?? null,
    createdAt: pod.createdAt ?? null,
    publicIp: pod.publicIp ?? null,
    machineId: pod.machineId ?? null,
    gpuName: pod.gpu?.displayName ?? null,
    gpuCount: pod.gpu?.count ?? null,
    costPerHr: pod.adjustedCostPerHr ?? pod.costPerHr ?? null,
  }));
}

async function loadRunpodStatus() {
  const config = getRunpodWorkerConfig();
  if (!config) {
    return {
      configured: false,
      workerName: null,
      workerImage: null,
      pods: [],
      error: null,
    };
  }

  try {
    const pods = await getManagedRunpodPods(config);
    return {
      configured: true,
      workerName: config.name,
      workerImage: config.image,
      pods: serializePods(pods),
      error: null,
    };
  } catch (error: any) {
    return {
      configured: true,
      workerName: config.name,
      workerImage: config.image,
      pods: [],
      error: error?.message ?? String(error),
    };
  }
}

export async function GET() {
  const authResult = await requireAuthorizedSession();
  if (authResult.response) return authResult.response;

  if (!canOperateProductionJobs(authResult.session.user.role, authResult.session.user.email)) {
    return NextResponse.json({ error: "この操作は管理者のみ可能です。" }, { status: 403 });
  }

  const status = await loadRunpodStatus();
  return NextResponse.json({ ok: true, runpod: status });
}

export async function POST(request: Request) {
  const authResult = await requireAuthorizedMutationSession(request);
  if (authResult.response) return authResult.response;

  if (!canOperateProductionJobs(authResult.session.user.role, authResult.session.user.email)) {
    await writeAuditLog({
      organizationId: authResult.session.user.organizationId,
      userId: authResult.session.user.id,
      action: "operations.runpod",
      targetType: "runpod_worker",
      targetId: "managed",
      status: "DENIED",
      detail: {
        reason: "insufficient_role",
        viewerRole: authResult.session.user.role ?? null,
      },
    });
    return NextResponse.json({ error: "この操作は管理者のみ可能です。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action.trim() : "";
  if (!["start", "stop", "status"].includes(action)) {
    return NextResponse.json({ error: "action は start / stop / status を指定してください。" }, { status: 400 });
  }

  try {
    const result =
      action === "start"
        ? await maybeEnsureRunpodWorker()
        : action === "stop"
          ? await stopManagedRunpodWorker()
          : await loadRunpodStatus();
    const status = await loadRunpodStatus();

    await writeAuditLog({
      organizationId: authResult.session.user.organizationId,
      userId: authResult.session.user.id,
      action: `operations.runpod.${action}`,
      targetType: "runpod_worker",
      targetId: "managed",
      status: "SUCCESS",
      detail: {
        result,
        status,
      },
    });

    return NextResponse.json({ ok: true, action, result, runpod: status });
  } catch (error: any) {
    await writeAuditLog({
      organizationId: authResult.session.user.organizationId,
      userId: authResult.session.user.id,
      action: `operations.runpod.${action}`,
      targetType: "runpod_worker",
      targetId: "managed",
      status: "ERROR",
      detail: {
        error: error?.message ?? "Internal Server Error",
      },
    });
    console.error("[/api/operations/runpod] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT() {
  return methodNotAllowedResponse(["GET", "POST"]);
}
