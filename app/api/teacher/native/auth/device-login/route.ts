import { TeacherAppClientPlatform } from "@prisma/client";
import { NextResponse } from "next/server";
import { loginWithEmail } from "@/lib/auth";
import {
  assertAuthThrottleAllowed,
  AuthRateLimitError,
  clearAuthThrottle,
  getRequestIp,
  recordAuthThrottleFailure,
} from "@/lib/auth-throttle";
import { parseJsonWithSchema, RequestValidationError } from "@/lib/server/request-validation";
import { teacherNativeDeviceLoginBodySchema } from "@/lib/teacher-app/native-auth-contract";
import { registerTeacherAppDevice } from "@/lib/teacher-app/device-registry";
import { issueTeacherAppNativeAuthSession } from "@/lib/teacher-app/server/native-auth-sessions";
import { canConfigureTeacherAppDevice } from "@/lib/server/teacher-app-session";

function toPrismaPlatform(value: "IOS" | "ANDROID" | "WEB" | "UNKNOWN") {
  switch (value) {
    case "IOS":
      return TeacherAppClientPlatform.IOS;
    case "ANDROID":
      return TeacherAppClientPlatform.ANDROID;
    case "WEB":
      return TeacherAppClientPlatform.WEB;
    default:
      return TeacherAppClientPlatform.UNKNOWN;
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonWithSchema(request, teacherNativeDeviceLoginBodySchema, "Teacher native login");
    const ipAddress = getRequestIp(request);

    try {
      await assertAuthThrottleAllowed("teacher_native_device_login_email", body.email);
      if (ipAddress) {
        await assertAuthThrottleAllowed("teacher_native_device_login_ip", ipAddress);
      }
    } catch (error) {
      if (error instanceof AuthRateLimitError) {
        return NextResponse.json({ error: error.message }, { status: 429 });
      }
      throw error;
    }

    const user = await loginWithEmail(body.email, body.password);
    if (!user) {
      await recordAuthThrottleFailure("teacher_native_device_login_email", body.email);
      if (ipAddress) {
        await recordAuthThrottleFailure("teacher_native_device_login_ip", ipAddress);
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

    await clearAuthThrottle("teacher_native_device_login_email", body.email);
    if (ipAddress) {
      await clearAuthThrottle("teacher_native_device_login_ip", ipAddress);
    }

    const device = await registerTeacherAppDevice({
      organizationId: user.organizationId,
      configuredByUserId: user.id,
      label: body.deviceLabel,
      clientPlatform: toPrismaPlatform(body.client.platform),
      appVersion: body.client.appVersion,
      buildNumber: body.client.buildNumber,
    });

    const authResponse = await issueTeacherAppNativeAuthSession({
      client: body.client,
      device,
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? "",
        organizationId: user.organizationId,
        role: user.role,
      },
    });

    return NextResponse.json(authResponse, { status: 201 });
  } catch (error: any) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[POST /api/teacher/native/auth/device-login] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
