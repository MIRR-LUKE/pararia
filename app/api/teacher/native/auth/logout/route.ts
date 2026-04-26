import { NextResponse } from "next/server";
import { requireTeacherAppSessionForRequest } from "@/lib/server/teacher-app-session";
import { clearTeacherAppDevicePushRegistration } from "@/lib/teacher-app/device-registry";
import { revokeTeacherAppNativeAuthSession } from "@/lib/teacher-app/server/native-auth-sessions";

export async function POST(request: Request) {
  try {
    const authResult = await requireTeacherAppSessionForRequest(request);
    if (authResult.response) {
      return authResult.response;
    }
    if (authResult.authMode !== "bearer" || !authResult.authSessionId) {
      return NextResponse.json({ error: "native bearer token が必要です。" }, { status: 401 });
    }

    await revokeTeacherAppNativeAuthSession({
      authSessionId: authResult.authSessionId,
      organizationId: authResult.session.organizationId,
      reason: "logged_out",
    });
    await clearTeacherAppDevicePushRegistration({
      deviceId: authResult.session.deviceId,
      organizationId: authResult.session.organizationId,
      reason: "logged_out",
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[POST /api/teacher/native/auth/logout] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
