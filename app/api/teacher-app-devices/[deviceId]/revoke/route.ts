import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { canManageSettings } from "@/lib/permissions";
import { requireAuthorizedMutationSession } from "@/lib/server/request-auth";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import { revokeTeacherAppDevice } from "@/lib/teacher-app/device-registry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RevokeDeviceRouteParams = { deviceId?: string };

function normalizeReason(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
}

function normalizeConfirmLabel(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: { params: RevokeDeviceRouteParams | Promise<RevokeDeviceRouteParams> }
) {
  try {
    const authResult = await requireAuthorizedMutationSession(request);
    if (authResult.response) return authResult.response;

    if (!canManageSettings(authResult.session.user.role)) {
      return NextResponse.json({ error: "Teacher App 端末の停止は管理者または室長のみ可能です。" }, { status: 403 });
    }

    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "teacher-app-devices.revoke",
      userId: authResult.session.user.id,
      organizationId: authResult.session.user.organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const { deviceId: rawDeviceId } = await Promise.resolve(params);
    const deviceId = typeof rawDeviceId === "string" ? rawDeviceId.trim() : "";
    if (!deviceId) {
      return NextResponse.json({ error: "deviceId が必要です。" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const reason = normalizeReason(body?.reason);
    const confirmLabel = normalizeConfirmLabel(body?.confirmLabel);
    if (!reason) {
      return NextResponse.json({ error: "停止理由を入力してください。" }, { status: 400 });
    }
    if (!confirmLabel) {
      return NextResponse.json(
        {
          error: "confirmLabel が必要です。",
          confirmation: {
            deviceId,
            requiredField: "confirmLabel",
          },
        },
        { status: 400 }
      );
    }

    const result = await revokeTeacherAppDevice({
      deviceId,
      organizationId: authResult.session.user.organizationId,
      confirmLabel,
      reason,
    });

    if (!result.ok) {
      if (result.code === "not_found") {
        return NextResponse.json({ error: "Teacher App 端末が見つかりません。" }, { status: 404 });
      }
      return NextResponse.json(
        {
          error: "端末名の確認が一致しませんでした。",
          confirmation: {
            deviceId,
            expectedLabel: result.device.label,
            receivedLabel: confirmLabel,
          },
        },
        { status: 409 }
      );
    }

    await writeAuditLog({
      organizationId: authResult.session.user.organizationId,
      userId: authResult.session.user.id,
      action: "teacher_app_device.revoke",
      targetType: "teacher_app_device",
      targetId: result.device.id,
      detail: {
        deviceId: result.device.id,
        deviceLabel: result.device.label,
        reason: result.reason,
        alreadyRevoked: result.alreadyRevoked,
        revokedAuthSessionCount: result.revokedAuthSessionCount,
      },
    });

    revalidatePath("/app/settings");

    return NextResponse.json({
      ok: true,
      device: {
        id: result.device.id,
        label: result.device.label,
        status: result.device.status,
        updatedAt: result.device.updatedAt.toISOString(),
      },
      alreadyRevoked: result.alreadyRevoked,
      revokedAuthSessionCount: result.revokedAuthSessionCount,
    });
  } catch (error: any) {
    console.error("[POST /api/teacher-app-devices/[deviceId]/revoke] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
