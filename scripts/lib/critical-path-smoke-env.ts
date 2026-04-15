import { ConversationJobType } from "@prisma/client";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { loadLocalEnvFiles } from "./load-local-env";

export type CriticalPathSmokeCredentials = {
  email: string;
  password: string;
};

export let CRITICAL_PATH_ADMIN_EMAIL = "";
export let CRITICAL_PATH_ADMIN_PASSWORD = "";
export const CRITICAL_PATH_BASE_URL = process.env.CRITICAL_PATH_BASE_URL?.trim() || "http://127.0.0.1:3000";
export const CRITICAL_PATH_BOOTSTRAP_URL = process.env.CRITICAL_PATH_BOOTSTRAP_URL?.trim() || "";
export let DEMO_EMAIL = "";
export let DEMO_PASSWORD = "";
export const ROOM_STUDENT_ID = "student-demo-1";
export const LOCK_STUDENT_ID = "student-demo-2";
export const NEXT_MEETING_SESSION_ID = "session-demo-1-interview";
export const NEXT_MEETING_CONVERSATION_ID = "conversation-demo-1-interview";
export const SESSION_ROUTE_SESSION_ID = "session-critical-path-routes";
export const SESSION_ROUTE_STUDENT_ID = ROOM_STUDENT_ID;

function syncCriticalPathSmokeCredentials(credentials: CriticalPathSmokeCredentials) {
  CRITICAL_PATH_ADMIN_EMAIL = credentials.email;
  CRITICAL_PATH_ADMIN_PASSWORD = credentials.password;
  DEMO_EMAIL = credentials.email;
  DEMO_PASSWORD = credentials.password;
}

export function requireCriticalPathSmokeCredentials(): CriticalPathSmokeCredentials {
  const email = process.env.CRITICAL_PATH_SMOKE_EMAIL?.trim() || "";
  const password = process.env.CRITICAL_PATH_SMOKE_PASSWORD?.trim() || "";
  if (!email || !password) {
    throw new Error(
      "CRITICAL_PATH_SMOKE_EMAIL / CRITICAL_PATH_SMOKE_PASSWORD を設定してください。固定の demo ログインは廃止しました。"
    );
  }

  const credentials = { email, password };
  syncCriticalPathSmokeCredentials(credentials);
  return credentials;
}

export type CriticalPathSmokeFixture = {
  studentId: string;
  sessionId?: string;
  conversationId?: string;
};

export type CriticalPathManagedFixture<T extends CriticalPathSmokeFixture> = T & {
  cleanup: () => Promise<void>;
};

export async function loadCriticalPathSmokeEnv(): Promise<CriticalPathSmokeCredentials> {
  await loadLocalEnvFiles();
  return requireCriticalPathSmokeCredentials();
}

export function buildFixtureId(prefix: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${suffix}`;
}

export async function cleanupStudentFixtures(studentIds: string[]) {
  if (studentIds.length === 0) return;
  const conversations = await prisma.conversationLog.findMany({
    where: { studentId: { in: studentIds } },
    select: { id: true },
  });
  const conversationIds = conversations.map((conversation) => conversation.id);

  await prisma.studentRecordingLock.deleteMany({ where: { studentId: { in: studentIds } } });
  if (conversationIds.length > 0) {
    await prisma.conversationJob.deleteMany({ where: { conversationId: { in: conversationIds } } });
  }
  await prisma.nextMeetingMemo.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.reportDeliveryEvent.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.report.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.conversationLog.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.sessionPart.deleteMany({ where: { session: { studentId: { in: studentIds } } } });
  await prisma.session.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.studentProfile.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
}

export async function createSmokeStudent(name: string) {
  const studentId = buildFixtureId("student-smoke");
  await prisma.student.create({
    data: {
      id: studentId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      name,
      nameKana: name,
    },
  });
  return studentId;
}

export async function resetRecordingLockFixture(studentId: string) {
  await prisma.studentRecordingLock.deleteMany({ where: { studentId } });
}

export async function resetNextMeetingMemoFixture(sessionId: string, conversationId: string) {
  await prisma.conversationJob.deleteMany({
    where: {
      conversationId,
      type: ConversationJobType.GENERATE_NEXT_MEETING_MEMO,
    },
  });
  await prisma.nextMeetingMemo.deleteMany({
    where: {
      OR: [{ sessionId }, { conversationId }],
    },
  });
}
