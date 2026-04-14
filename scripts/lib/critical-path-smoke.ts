import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { prisma } from "../../lib/db";
import { loadLocalEnvFiles } from "./load-local-env";

export const CRITICAL_PATH_BASE_URL = process.env.CRITICAL_PATH_BASE_URL?.trim() || "http://127.0.0.1:3000";
export const DEMO_EMAIL = process.env.CRITICAL_PATH_SMOKE_EMAIL?.trim() || "admin@demo.com";
export const DEMO_PASSWORD = process.env.CRITICAL_PATH_SMOKE_PASSWORD?.trim() || "demo123";
export const ROOM_STUDENT_ID = "student-demo-1";
export const LOCK_STUDENT_ID = "student-demo-2";
export const NEXT_MEETING_SESSION_ID = "session-demo-1-interview";
export const NEXT_MEETING_CONVERSATION_ID = "conversation-demo-1-interview";

type JsonValue = Record<string, unknown>;

class CookieJar {
  private readonly cookies = new Map<string, string>();

  updateFromResponse(response: Response) {
    for (const rawCookie of getSetCookieHeaders(response.headers)) {
      const firstSegment = rawCookie.split(";", 1)[0]?.trim();
      if (!firstSegment) continue;
      const separatorIndex = firstSegment.indexOf("=");
      if (separatorIndex <= 0) continue;
      const name = firstSegment.slice(0, separatorIndex).trim();
      const value = firstSegment.slice(separatorIndex + 1).trim();
      if (!name) continue;
      this.cookies.set(name, value);
    }
  }

  toHeader() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

function getSetCookieHeaders(headers: Headers) {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === "function") {
    return extended.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function withCookieHeader(headers: HeadersInit | undefined, jar: CookieJar) {
  const nextHeaders = new Headers(headers);
  const cookieHeader = jar.toHeader();
  if (cookieHeader) {
    nextHeaders.set("cookie", cookieHeader);
  }
  return nextHeaders;
}

export async function loadCriticalPathEnv() {
  await loadLocalEnvFiles();
}

export async function cleanupRecordingLock(studentId: string) {
  await prisma.studentRecordingLock.deleteMany({ where: { studentId } });
}

export async function cleanupNextMeetingMemo(sessionId: string, conversationId: string) {
  await prisma.nextMeetingMemo.deleteMany({ where: { sessionId } });
  await prisma.conversationJob.deleteMany({
    where: {
      conversationId,
      type: "GENERATE_NEXT_MEETING_MEMO",
    },
  });
}

export async function loginForCriticalPathSmoke(baseUrl: string = CRITICAL_PATH_BASE_URL) {
  await loadCriticalPathEnv();
  const jar = new CookieJar();

  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`, { redirect: "manual" });
  jar.updateFromResponse(csrfResponse);
  assert.equal(csrfResponse.ok, true, `csrf request failed: ${csrfResponse.status}`);
  const csrfBody = (await csrfResponse.json()) as { csrfToken?: string };
  assert.ok(csrfBody.csrfToken, "csrfToken is required");

  const callbackBody = new URLSearchParams({
    csrfToken: csrfBody.csrfToken,
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    callbackUrl: `${baseUrl}/app/dashboard`,
    redirect: "false",
    json: "true",
  });

  const callbackResponse = await fetch(`${baseUrl}/api/auth/callback/credentials?json=true`, {
    method: "POST",
    redirect: "manual",
    headers: withCookieHeader({ "content-type": "application/x-www-form-urlencoded" }, jar),
    body: callbackBody.toString(),
  });
  jar.updateFromResponse(callbackResponse);
  assert.ok(callbackResponse.status < 400, `credentials callback failed: ${callbackResponse.status}`);

  const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
    headers: withCookieHeader(undefined, jar),
  });
  jar.updateFromResponse(sessionResponse);
  assert.equal(sessionResponse.ok, true, `session request failed: ${sessionResponse.status}`);
  const sessionBody = (await sessionResponse.json()) as { user?: { email?: string | null } };
  assert.equal(sessionBody.user?.email, DEMO_EMAIL, "demo session email mismatch");

  return {
    baseUrl,
    jar,
    async requestJson<T extends JsonValue = JsonValue>(pathname: string, init?: RequestInit) {
      const response = await fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: withCookieHeader(init?.headers, jar),
      });
      jar.updateFromResponse(response);
      const body = (await response.json().catch(() => ({}))) as T;
      return { response, body };
    },
  };
}

export function isMainModule(metaUrl: string) {
  return process.argv[1] ? metaUrl === pathToFileURL(process.argv[1]).href : false;
}
