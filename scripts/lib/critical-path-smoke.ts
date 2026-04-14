import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { SessionPartType, SessionStatus, SessionType } from "@prisma/client";
import { prisma } from "../../lib/db";
import { loadLocalEnvFiles } from "./load-local-env";

export const CRITICAL_PATH_BASE_URL = process.env.CRITICAL_PATH_BASE_URL?.trim() || "http://127.0.0.1:3000";
export const DEMO_EMAIL = process.env.CRITICAL_PATH_SMOKE_EMAIL?.trim() || "admin@demo.com";
export const DEMO_PASSWORD = process.env.CRITICAL_PATH_SMOKE_PASSWORD?.trim() || "demo123";
export const ROOM_STUDENT_ID = "student-demo-1";
export const LOCK_STUDENT_ID = "student-demo-2";
export const NEXT_MEETING_SESSION_ID = "session-demo-1-interview";
export const NEXT_MEETING_CONVERSATION_ID = "conversation-demo-1-interview";
export const SESSION_ROUTE_SESSION_ID = "session-critical-path-routes";
export const SESSION_ROUTE_STUDENT_ID = ROOM_STUDENT_ID;

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

export async function prepareSessionRouteSmokeSession(sessionId: string = SESSION_ROUTE_SESSION_ID) {
  await loadCriticalPathEnv();

  const student = await prisma.student.findUnique({
    where: { id: SESSION_ROUTE_STUDENT_ID },
    select: { id: true, organizationId: true },
  });
  assert.ok(student, `student ${SESSION_ROUTE_STUDENT_ID} is required for session route smoke`);

  const user = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: { id: true },
  });

  await cleanupSessionRouteSmokeSession(sessionId);

  return prisma.session.upsert({
    where: { id: sessionId },
    update: {
      organizationId: student.organizationId,
      studentId: student.id,
      userId: user?.id ?? null,
      type: SessionType.INTERVIEW,
      status: SessionStatus.DRAFT,
      title: "Critical path smoke session",
      notes: null,
      sessionDate: new Date("2026-04-14T00:00:00.000Z"),
      heroStateLabel: null,
      heroOneLiner: null,
      latestSummary: null,
      completedAt: null,
    },
    create: {
      id: sessionId,
      organizationId: student.organizationId,
      studentId: student.id,
      userId: user?.id ?? null,
      type: SessionType.INTERVIEW,
      status: SessionStatus.DRAFT,
      title: "Critical path smoke session",
      notes: null,
      sessionDate: new Date("2026-04-14T00:00:00.000Z"),
    },
  });
}

export async function cleanupSessionRouteSmokeSession(sessionId: string = SESSION_ROUTE_SESSION_ID) {
  const sessionParts = await prisma.sessionPart.findMany({
    where: { sessionId },
    select: { id: true },
  });
  const sessionPartIds = sessionParts.map((part) => part.id);

  const conversation = await prisma.conversationLog.findUnique({
    where: { sessionId },
    select: { id: true },
  });

  await prisma.nextMeetingMemo.deleteMany({ where: { sessionId } });
  await prisma.properNounSuggestion.deleteMany({ where: { sessionId } });

  if (sessionPartIds.length > 0) {
    await prisma.properNounSuggestion.deleteMany({
      where: { sessionPartId: { in: sessionPartIds } },
    });
    await prisma.sessionPartJob.deleteMany({
      where: { sessionPartId: { in: sessionPartIds } },
    });
  }

  if (conversation?.id) {
    await prisma.properNounSuggestion.deleteMany({
      where: { conversationId: conversation.id },
    });
    await prisma.conversationJob.deleteMany({
      where: { conversationId: conversation.id },
    });
  }

  await prisma.conversationLog.deleteMany({ where: { sessionId } });
  await prisma.sessionPart.deleteMany({ where: { sessionId } });
  await prisma.session.updateMany({
    where: { id: sessionId },
    data: {
      status: SessionStatus.DRAFT,
      heroStateLabel: null,
      heroOneLiner: null,
      latestSummary: null,
      completedAt: null,
    },
  });

  const fullPart = await prisma.sessionPart.findUnique({
    where: {
      sessionId_partType: {
        sessionId,
        partType: SessionPartType.FULL,
      },
    },
    select: { id: true },
  });
  assert.equal(fullPart, null, "session route smoke cleanup should remove FULL session part");
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
