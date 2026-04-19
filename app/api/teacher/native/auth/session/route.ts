import { NextResponse } from "next/server";
import { requireTeacherAppSessionForRequest } from "@/lib/server/teacher-app-session";
import { loadActiveTeacherAppNativeAuthContext } from "@/lib/teacher-app/server/native-auth-sessions";

export async function GET(request: Request) {
  try {
    const authResult = await requireTeacherAppSessionForRequest(request);
    if (authResult.response) {
      return authResult.response;
    }
    if (authResult.authMode !== "bearer" || !authResult.authSessionId) {
      return NextResponse.json({ error: "native bearer token が必要です。" }, { status: 401 });
    }

    const context = await loadActiveTeacherAppNativeAuthContext({
      authSessionId: authResult.authSessionId,
      organizationId: authResult.session.organizationId,
    });
    if (!context) {
      return NextResponse.json({ error: "native session が見つかりません。" }, { status: 401 });
    }

    return NextResponse.json({
      session: authResult.session,
      client: context.client,
      auth: {
        authSessionId: context.authSessionId,
        accessTokenExpiresAt: authResult.session.expiresAt,
        tokenType: "Bearer" as const,
      },
    });
  } catch (error: any) {
    console.error("[GET /api/teacher/native/auth/session] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
