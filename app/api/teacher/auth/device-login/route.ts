import { NextResponse } from "next/server";
import { loginWithEmail } from "@/lib/auth";
import {
  assertAuthThrottleAllowed,
  AuthRateLimitError,
  clearAuthThrottle,
  getRequestIp,
  recordAuthThrottleFailure,
} from "@/lib/auth-throttle";
import {
  buildTeacherAppSessionCookie,
  createTeacherAppDeviceSession,
  serializeTeacherAppSessionToken,
} from "@/lib/teacher-app/device-auth";
import { canConfigureTeacherAppDevice } from "@/lib/server/teacher-app-session";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { email?: string; password?: string; deviceLabel?: string }
      | null;
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const deviceLabel = String(body?.deviceLabel ?? "").trim();
    if (!email || !password || !deviceLabel) {
      return NextResponse.json(
        { error: "メールアドレス、パスワード、端末名を入力してください。" },
        { status: 400 }
      );
    }
    if (deviceLabel.length < 2 || deviceLabel.length > 60) {
      return NextResponse.json({ error: "端末名は 2 文字以上 60 文字以内で入力してください。" }, { status: 400 });
    }

    const ipAddress = getRequestIp(request);
    try {
      await assertAuthThrottleAllowed("teacher_device_login_email", email);
      if (ipAddress) {
        await assertAuthThrottleAllowed("teacher_device_login_ip", ipAddress);
      }
    } catch (error) {
      if (error instanceof AuthRateLimitError) {
        return NextResponse.json({ error: error.message }, { status: 429 });
      }
      throw error;
    }

    const user = await loginWithEmail(email, password);
    if (!user) {
      await recordAuthThrottleFailure("teacher_device_login_email", email);
      if (ipAddress) {
        await recordAuthThrottleFailure("teacher_device_login_ip", ipAddress);
      }
      return NextResponse.json(
        { error: "ログインに失敗しました。メールアドレスとパスワードを確認してください。" },
        { status: 401 }
      );
    }
    if (!canConfigureTeacherAppDevice(user.role)) {
      return NextResponse.json(
        { error: "Teacher App の端末設定は管理者または室長のみ実行できます。" },
        { status: 403 }
      );
    }

    await clearAuthThrottle("teacher_device_login_email", email);
    if (ipAddress) {
      await clearAuthThrottle("teacher_device_login_ip", ipAddress);
    }

    const session = createTeacherAppDeviceSession(user, deviceLabel);
    const token = serializeTeacherAppSessionToken(session);
    const response = NextResponse.json({
      session,
    });
    response.cookies.set(buildTeacherAppSessionCookie(token));
    return response;
  } catch (error: any) {
    console.error("[POST /api/teacher/auth/device-login] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
