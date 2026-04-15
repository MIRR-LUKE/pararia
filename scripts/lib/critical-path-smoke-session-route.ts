import { pathToFileURL } from "node:url";
import { SessionPartType, SessionStatus, SessionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  CRITICAL_PATH_BASE_URL,
  DEMO_EMAIL,
  loadCriticalPathSmokeEnv,
  SESSION_ROUTE_SESSION_ID,
  SESSION_ROUTE_STUDENT_ID,
} from "./critical-path-smoke-env";

type JsonValue = Record<string, unknown>;

export async function prepareSessionRouteSmokeSession(sessionId: string = SESSION_ROUTE_SESSION_ID) {
  await loadCriticalPathSmokeEnv();

  const student = await prisma.student.findUnique({
    where: { id: SESSION_ROUTE_STUDENT_ID },
    select: { id: true, organizationId: true },
  });
  if (!student) {
    throw new Error(`student ${SESSION_ROUTE_STUDENT_ID} is required for session route smoke`);
  }

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
  if (fullPart !== null) {
    throw new Error("session route smoke cleanup should remove FULL session part");
  }
}

export async function loginForCriticalPathSmoke(
  baseUrl: string = CRITICAL_PATH_BASE_URL,
  options?: {
    bootstrapUrl?: string | null;
  }
) {
  await loadCriticalPathSmokeEnv();
  const previousBootstrapUrl = process.env.CRITICAL_PATH_BOOTSTRAP_URL;
  if (options?.bootstrapUrl !== undefined) {
    process.env.CRITICAL_PATH_BOOTSTRAP_URL = options.bootstrapUrl ?? "";
  }

  const { createCriticalPathSmokeApi } = await import("./critical-path-smoke-browser");
  const { api, close } = await createCriticalPathSmokeApi(baseUrl);

  if (options?.bootstrapUrl !== undefined) {
    process.env.CRITICAL_PATH_BOOTSTRAP_URL = previousBootstrapUrl;
  }

  return {
    baseUrl,
    async requestJson<T extends JsonValue = JsonValue>(pathname: string, init?: RequestInit) {
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = init?.headers as Record<string, string> | undefined;
      const requestOptions: any = {};
      if (headers) {
        requestOptions.headers = headers;
      }
      if (init?.body instanceof FormData) {
        requestOptions.multipart = init.body;
      } else if (init?.body !== undefined) {
        requestOptions.data = init.body;
      }

      const response =
        method === "POST"
          ? await api.post(pathname, requestOptions)
          : method === "DELETE"
            ? await api.delete(pathname, requestOptions)
            : method === "PATCH"
              ? await api.patch(pathname, requestOptions)
              : method === "PUT"
                ? await api.put(pathname, requestOptions)
                : await api.get(pathname, requestOptions);
      const body = (await response.json().catch(() => ({}))) as T;
      return {
        response: {
          status: response.status(),
          ok: response.ok(),
        },
        body,
      };
    },
    close,
  };
}

export function isMainModule(metaUrl: string) {
  return process.argv[1] ? metaUrl === pathToFileURL(process.argv[1]).href : false;
}
