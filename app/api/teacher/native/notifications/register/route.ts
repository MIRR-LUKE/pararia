import { NextResponse } from "next/server";
import { requireNativeTeacherAppMutationSession } from "@/lib/server/teacher-app-session";
import { parseJsonWithSchema, RequestValidationError } from "@/lib/server/request-validation";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import { teacherNativeNotificationRegistrationBodySchema } from "@/lib/teacher-app/native-auth-contract";
import { updateTeacherAppDevicePushRegistration } from "@/lib/teacher-app/device-registry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const authResult = await requireNativeTeacherAppMutationSession(request);
    if (authResult.response) return authResult.response;

    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "teacher.native.notifications.register",
      userId: authResult.session.userId,
      organizationId: authResult.session.organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const body = await parseJsonWithSchema(
      request,
      teacherNativeNotificationRegistrationBodySchema,
      "Teacher native notification registration"
    );

    await updateTeacherAppDevicePushRegistration({
      deviceId: authResult.session.deviceId,
      organizationId: authResult.session.organizationId,
      provider: body.provider,
      token: body.token,
      permissionStatus: body.permissionStatus,
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[POST /api/teacher/native/notifications/register] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
