import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { canManageSettings } from "@/lib/permissions";
import { readBearerToken } from "@/lib/server/route-guards";
import { requireSameOriginRequest } from "@/lib/server/request-security";
import {
  getTeacherAppCookieName,
  parseTeacherAppAccessToken,
  parseTeacherAppSessionToken,
} from "@/lib/teacher-app/device-auth";
import {
  loadActiveTeacherAppDevice,
  touchTeacherAppDeviceLastSeen,
} from "@/lib/teacher-app/device-registry";
import {
  loadActiveTeacherAppNativeAuthContext,
  touchTeacherAppNativeAuthSessionLastSeen,
} from "@/lib/teacher-app/server/native-auth-sessions";
import type { TeacherAppDeviceSession } from "@/lib/teacher-app/types";

const TEACHER_APP_WEB_RETIRED_MESSAGE =
  "Web からの録音操作は終了しました。Android Teacher App から操作してください。";

function readTeacherAppCookieFromHeader(cookieHeader: string | null) {
  if (!cookieHeader) return null;
  const cookieName = getTeacherAppCookieName();
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === cookieName) {
      return rawValue.join("=");
    }
  }
  return null;
}

export async function getTeacherAppSession(): Promise<TeacherAppDeviceSession | null> {
  const cookieStore = await cookies();
  return readVerifiedTeacherAppCookieSession(cookieStore.get(getTeacherAppCookieName())?.value);
}

export async function requireTeacherAppSessionForRequest(request: Request) {
  const bearer = readBearerToken(request.headers.get("authorization"));
  const cookieToken = readTeacherAppCookieFromHeader(request.headers.get("cookie"));
  if (bearer) {
    const bearerSession = await readVerifiedTeacherAppBearerSession(bearer);
    if (bearerSession) {
      return {
        authMode: "bearer" as const,
        authSessionId: bearerSession.authSessionId,
        session: bearerSession.session,
        response: null,
      } as const;
    }
  }

  const session = await readVerifiedTeacherAppCookieSession(cookieToken);
  if (!session) {
    return {
      authMode: null,
      authSessionId: null,
      session: null,
      response: NextResponse.json({ error: "Teacher App の端末認証が必要です。" }, { status: 401 }),
    } as const;
  }
  return {
    authMode: "cookie" as const,
    authSessionId: null,
    session,
    response: null,
  } as const;
}

export async function requireTeacherAppMutationSession(request: Request) {
  const sessionResult = await requireTeacherAppSessionForRequest(request);
  if (sessionResult.response) {
    return sessionResult;
  }

  if (sessionResult.authMode === "cookie") {
    const sameOriginResponse = requireSameOriginRequest(request);
    if (sameOriginResponse) {
      return {
        authMode: null,
        authSessionId: null,
        session: null,
        response: sameOriginResponse,
      } as const;
    }
  }

  return sessionResult;
}

export async function requireNativeTeacherAppSessionForRequest(request: Request) {
  const sessionResult = await requireTeacherAppSessionForRequest(request);
  if (sessionResult.response) {
    return sessionResult;
  }

  if (sessionResult.authMode !== "bearer") {
    return {
      authMode: null,
      authSessionId: null,
      session: null,
      response: NextResponse.json({ error: TEACHER_APP_WEB_RETIRED_MESSAGE }, { status: 410 }),
    } as const;
  }

  return sessionResult;
}

export async function requireNativeTeacherAppMutationSession(request: Request) {
  return requireNativeTeacherAppSessionForRequest(request);
}

export function canConfigureTeacherAppDevice(role: string | null | undefined) {
  return canManageSettings(role);
}

async function readVerifiedTeacherAppCookieSession(token: string | null | undefined): Promise<TeacherAppDeviceSession | null> {
  const parsed = parseTeacherAppSessionToken(token);
  if (!parsed) return null;

  const device = await loadActiveTeacherAppDevice({
    deviceId: parsed.deviceId,
    organizationId: parsed.organizationId,
  });
  if (!device || device.label !== parsed.deviceLabel) {
    return null;
  }

  void touchTeacherAppDeviceLastSeen({
    deviceId: parsed.deviceId,
    organizationId: parsed.organizationId,
  }).catch(() => {});

  return parsed;
}

async function readVerifiedTeacherAppBearerSession(token: string | null | undefined) {
  const parsed = parseTeacherAppAccessToken(token);
  if (!parsed) return null;

  const authContext = await loadActiveTeacherAppNativeAuthContext({
    authSessionId: parsed.authSessionId,
    organizationId: parsed.session.organizationId,
  });
  if (!authContext) {
    return null;
  }

  void Promise.all([
    touchTeacherAppDeviceLastSeen({
      deviceId: parsed.session.deviceId,
      organizationId: parsed.session.organizationId,
    }),
    touchTeacherAppNativeAuthSessionLastSeen({
      authSessionId: authContext.authSessionId,
      organizationId: parsed.session.organizationId,
    }),
  ]).catch(() => {});

  return {
    authSessionId: authContext.authSessionId,
    session: parsed.session,
  };
}
