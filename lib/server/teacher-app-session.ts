import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { canManageSettings } from "@/lib/permissions";
import { readBearerToken } from "@/lib/server/route-guards";
import { requireSameOriginRequest } from "@/lib/server/request-security";
import {
  getTeacherAppCookieName,
  parseTeacherAppSessionToken,
} from "@/lib/teacher-app/device-auth";
import {
  loadActiveTeacherAppDevice,
  touchTeacherAppDeviceLastSeen,
} from "@/lib/teacher-app/device-registry";
import type { TeacherAppDeviceSession } from "@/lib/teacher-app/types";

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
  return readVerifiedTeacherAppSession(cookieStore.get(getTeacherAppCookieName())?.value);
}

export async function requireTeacherAppSessionForRequest(request: Request) {
  const bearer = readBearerToken(request.headers.get("authorization"));
  const cookieToken = readTeacherAppCookieFromHeader(request.headers.get("cookie"));
  const session = await readVerifiedTeacherAppSession(bearer || cookieToken);
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Teacher App の端末認証が必要です。" }, { status: 401 }),
    } as const;
  }
  return {
    session,
    response: null,
  } as const;
}

export async function requireTeacherAppMutationSession(request: Request) {
  const sessionResult = await requireTeacherAppSessionForRequest(request);
  if (sessionResult.response) {
    return sessionResult;
  }

  const sameOriginResponse = requireSameOriginRequest(request);
  if (sameOriginResponse) {
    return {
      session: null,
      response: sameOriginResponse,
    } as const;
  }

  return sessionResult;
}

export function canConfigureTeacherAppDevice(role: string | null | undefined) {
  return canManageSettings(role);
}

async function readVerifiedTeacherAppSession(token: string | null | undefined): Promise<TeacherAppDeviceSession | null> {
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
