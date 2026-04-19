import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { canManageSettings } from "@/lib/permissions";
import { readBearerToken } from "@/lib/server/route-guards";
import {
  getTeacherAppCookieName,
  parseTeacherAppSessionToken,
} from "@/lib/teacher-app/device-auth";
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
  return parseTeacherAppSessionToken(cookieStore.get(getTeacherAppCookieName())?.value);
}

export async function requireTeacherAppSessionForRequest(request: Request) {
  const bearer = readBearerToken(request.headers.get("authorization"));
  const cookieToken = readTeacherAppCookieFromHeader(request.headers.get("cookie"));
  const session = parseTeacherAppSessionToken(bearer || cookieToken);
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

export function canConfigureTeacherAppDevice(role: string | null | undefined) {
  return canManageSettings(role);
}
