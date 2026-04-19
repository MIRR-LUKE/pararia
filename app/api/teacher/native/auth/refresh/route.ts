import { NextResponse } from "next/server";
import { applyPublicIpThrottle } from "@/lib/server/request-throttle";
import { parseJsonWithSchema, RequestValidationError } from "@/lib/server/request-validation";
import { teacherNativeRefreshBodySchema } from "@/lib/teacher-app/native-auth-contract";
import { rotateTeacherAppNativeAuthSession } from "@/lib/teacher-app/server/native-auth-sessions";

export async function POST(request: Request) {
  try {
    const throttleResponse = await applyPublicIpThrottle({
      request,
      scope: "teacher.native.auth.refresh",
    });
    if (throttleResponse) {
      return throttleResponse;
    }

    const body = await parseJsonWithSchema(request, teacherNativeRefreshBodySchema, "Teacher native refresh");
    const authResponse = await rotateTeacherAppNativeAuthSession({
      refreshToken: body.refreshToken,
      client: body.client ?? null,
    });
    if (!authResponse) {
      return NextResponse.json({ error: "refreshToken が無効か、期限切れです。" }, { status: 401 });
    }
    return NextResponse.json(authResponse);
  } catch (error: any) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[POST /api/teacher/native/auth/refresh] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
