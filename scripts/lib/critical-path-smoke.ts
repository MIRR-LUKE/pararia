import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  ConversationJobType,
  ConversationSourceType,
  ConversationStatus,
  ReportDeliveryEventType,
  ReportStatus,
  SessionStatus,
  SessionType,
} from "@prisma/client";
import { chromium, request, type APIRequestContext } from "playwright-core";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { assertMutatingFixtureEnvironment } from "./environment-safety";
import { loadLocalEnvFiles } from "./load-local-env";

export const CRITICAL_PATH_ADMIN_EMAIL = "admin@demo.com";
export const CRITICAL_PATH_ADMIN_PASSWORD = "demo123";

export type CriticalPathSmokeFixture = {
  studentId: string;
  sessionId?: string;
  conversationId?: string;
};

type CriticalPathManagedFixture<T extends CriticalPathSmokeFixture> = T & {
  cleanup: () => Promise<void>;
};

export async function loadCriticalPathSmokeEnv() {
  await loadLocalEnvFiles();
}

function detectBrowserExecutable() {
  const candidates = [
    process.env.RECORDING_UI_BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!result.error) {
      return candidate;
    }
  }

  throw new Error("Edge / Chrome の実行ファイルが見つかりません。");
}

function buildFixtureId(prefix: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${suffix}`;
}

async function cleanupStudentFixtures(studentIds: string[]) {
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

async function createSmokeStudent(name: string) {
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

async function loginDemoUser(api: APIRequestContext, baseUrl: string) {
  const csrfResponse = await api.get("/api/auth/csrf");
  assert.equal(csrfResponse.ok(), true, "auth csrf");
  const csrfBody = await csrfResponse.json().catch(() => ({}));
  const csrfToken = String(csrfBody?.csrfToken ?? "").trim();
  assert.ok(csrfToken, "csrf token");

  const loginResponse = await api.post("/api/auth/callback/credentials?json=true", {
    form: {
      csrfToken,
      email: CRITICAL_PATH_ADMIN_EMAIL,
      password: CRITICAL_PATH_ADMIN_PASSWORD,
      callbackUrl: `${baseUrl}/app/dashboard`,
      json: "true",
    },
    maxRedirects: 0,
  });
  assert.ok(loginResponse.status() < 400, `demo login failed: ${loginResponse.status()}`);

  const sessionResponse = await api.get("/api/auth/session");
  assert.equal(sessionResponse.ok(), true, "auth session");
  const sessionBody = await sessionResponse.json().catch(() => ({}));
  if (sessionBody?.user?.email === CRITICAL_PATH_ADMIN_EMAIL) {
    assert.ok(String(sessionBody?.user?.id ?? "").length > 0, "authenticated user id");
    return;
  }

  const protectedResponse = await api.get("/api/students?limit=1");
  assert.ok(protectedResponse.status() < 400, `authenticated students access: ${protectedResponse.status()}`);
}

async function bootstrapIfNeeded(api: APIRequestContext) {
  const bootstrapUrl = process.env.CRITICAL_PATH_BOOTSTRAP_URL?.trim();
  if (!bootstrapUrl) return;
  const bootstrapResponse = await api.get(bootstrapUrl, { maxRedirects: 10 });
  assert.ok(bootstrapResponse.status() < 400, `bootstrap access failed: ${bootstrapResponse.status()}`);
}

export async function createCriticalPathSmokeApi(baseUrl: string) {
  const requestApi = await request.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
  });

  try {
    await bootstrapIfNeeded(requestApi);
    await loginDemoUser(requestApi, baseUrl);
    return {
      api: requestApi,
      close: () => requestApi.dispose(),
    };
  } catch (requestError) {
    await requestApi.dispose().catch(() => {});
    const browser = await chromium.launch({
      headless: true,
      executablePath: detectBrowserExecutable(),
    });
    const context = await browser.newContext({
      baseURL: baseUrl,
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 720 },
    });

    try {
      const page = await context.newPage();
      const bootstrapUrl = process.env.CRITICAL_PATH_BOOTSTRAP_URL?.trim();
      if (bootstrapUrl) {
        await page.goto(bootstrapUrl, { waitUntil: "domcontentloaded" });
      }
      await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
      await page.locator('input[type="email"]').fill(CRITICAL_PATH_ADMIN_EMAIL);
      await page.locator('input[type="password"]').fill(CRITICAL_PATH_ADMIN_PASSWORD);
      await page.getByRole("button", { name: "ログイン" }).click();
      await page.waitForURL(/\/app\/dashboard/, { timeout: 20_000 });
      const protectedResponse = await context.request.get("/api/students?limit=1");
      assert.ok(protectedResponse.status() < 400, `authenticated students access: ${protectedResponse.status()}`);
      return {
        api: context.request,
        close: async () => {
          await page.close().catch(() => {});
          await context.close().catch(() => {});
          await browser.close().catch(() => {});
        },
      };
    } catch (browserError) {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      throw browserError ?? requestError;
    }
  }
}

export async function createCriticalPathBrowserContext(baseUrl: string) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: detectBrowserExecutable(),
  });
  const context = await browser.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1024 },
  });

  try {
    await bootstrapIfNeeded(context.request);
    await loginDemoUser(context.request, baseUrl);
    return {
      browser,
      context,
      close: async () => {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      },
    };
  } catch (error) {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  }
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

export async function createRecordingLockFixture(): Promise<CriticalPathManagedFixture<{ studentId: string }>> {
  assertMutatingFixtureEnvironment(process.env.CRITICAL_PATH_BASE_URL || "http://127.0.0.1:3000", "critical-path-recording-lock");
  const studentId = await createSmokeStudent(`Critical Path Lock ${Date.now()}`);
  return {
    studentId,
    cleanup: async () => {
      await cleanupStudentFixtures([studentId]);
    },
  };
}

export async function createStudentRoomFixture(): Promise<
  CriticalPathManagedFixture<{ studentId: string; sessionId: string; conversationId: string; reportId: string }>
> {
  assertMutatingFixtureEnvironment(process.env.CRITICAL_PATH_BASE_URL || "http://127.0.0.1:3000", "critical-path-student-room");
  const studentId = await createSmokeStudent(`Critical Path Room ${Date.now()}`);
  const sessionId = buildFixtureId("session-smoke-room");
  const conversationId = buildFixtureId("conversation-smoke-room");
  const reportId = buildFixtureId("report-smoke-room");
  const sessionDate = new Date("2026-03-09T09:00:00.000Z");
  const reportCreatedAt = new Date("2026-03-11T08:00:00.000Z");

  await prisma.session.create({
    data: {
      id: sessionId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      studentId,
      userId: "user-demo-teacher",
      type: SessionType.INTERVIEW,
      status: SessionStatus.READY,
      title: "Smoke 数学面談",
      sessionDate,
      heroStateLabel: "思考安定",
      heroOneLiner: "数学の粘りはある。最初の一手に型を持たせたい。",
      latestSummary: "本当の詰まりどころは、難問で最初の一手が出ないこと。",
      completedAt: sessionDate,
      createdAt: sessionDate,
    },
  });

  await prisma.conversationLog.create({
    data: {
      id: conversationId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      studentId,
      userId: "user-demo-teacher",
      sessionId,
      sourceType: ConversationSourceType.MANUAL,
      status: ConversationStatus.DONE,
      rawTextOriginal: "smoke transcript",
      rawTextCleaned: "smoke transcript",
      rawSegments: [] as any,
      summaryMarkdown:
        "## 今回確認したこと\n数学は丁寧に取り組めており、粘り強さも見えている。\n\n## 講師の見立て\n弱点は難問で最初の一手が出るまでに時間がかかること。\n\n## 次回までに進めること\n条件整理、図、最初の式の3点セットを先に書く型を作る。",
      formattedTranscript: "## 面談\nsmoke transcript",
      qualityMetaJson: { smoke: true } as any,
      createdAt: sessionDate,
    },
  });

  await prisma.report.create({
    data: {
      id: reportId,
      studentId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      reportMarkdown:
        "## 今月の大きな変化\n数学の粘り強さが安定して見えるようになりました。\n\n## 学習面\n次の伸びしろは、難問で最初の一手をより安定して出せるようにすることです。",
      reportJson: { smoke: true } as any,
      status: ReportStatus.SENT,
      sentAt: new Date("2026-03-11T09:00:00.000Z"),
      sentByUserId: "user-demo-teacher",
      deliveryChannel: "manual",
      qualityChecksJson: { smoke: true } as any,
      periodFrom: new Date("2026-02-09T09:00:00.000Z"),
      periodTo: reportCreatedAt,
      sourceLogIds: [conversationId] as any,
      createdAt: reportCreatedAt,
    },
  });

  await prisma.reportDeliveryEvent.createMany({
    data: [
      {
        reportId,
        organizationId: DEFAULT_ORGANIZATION_ID,
        studentId,
        actorUserId: "user-demo-teacher",
        eventType: ReportDeliveryEventType.DRAFT_CREATED,
        eventMetaJson: { smoke: true } as any,
        createdAt: reportCreatedAt,
      },
      {
        reportId,
        organizationId: DEFAULT_ORGANIZATION_ID,
        studentId,
        actorUserId: "user-demo-teacher",
        eventType: ReportDeliveryEventType.MANUAL_SHARED,
        deliveryChannel: "manual",
        eventMetaJson: { smoke: true } as any,
        createdAt: new Date("2026-03-11T09:00:00.000Z"),
      },
    ],
  });

  return {
    studentId,
    sessionId,
    conversationId,
    reportId,
    cleanup: async () => {
      await cleanupStudentFixtures([studentId]);
    },
  };
}

export async function createNextMeetingMemoFixture(): Promise<
  CriticalPathManagedFixture<{ studentId: string; sessionId: string; conversationId: string }>
> {
  assertMutatingFixtureEnvironment(process.env.CRITICAL_PATH_BASE_URL || "http://127.0.0.1:3000", "critical-path-next-meeting-memo");
  const studentId = await createSmokeStudent(`Critical Path Memo ${Date.now()}`);
  const sessionId = buildFixtureId("session-smoke-memo");
  const conversationId = buildFixtureId("conversation-smoke-memo");
  const sessionDate = new Date("2026-03-10T19:30:00.000Z");

  await prisma.session.create({
    data: {
      id: sessionId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      studentId,
      userId: "user-demo-teacher",
      type: SessionType.INTERVIEW,
      status: SessionStatus.READY,
      title: "Smoke 3月面談",
      sessionDate,
      heroStateLabel: "前進中",
      heroOneLiner: "英語の手応えは出てきた。次は睡眠リズムを整えたい。",
      latestSummary: "英語は安定してきたが、睡眠の乱れが点数の振れ幅を生んでいる。",
      completedAt: sessionDate,
      createdAt: sessionDate,
    },
  });

  await prisma.conversationLog.create({
    data: {
      id: conversationId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      studentId,
      userId: "user-demo-teacher",
      sessionId,
      sourceType: ConversationSourceType.AUDIO,
      status: ConversationStatus.DONE,
      rawTextOriginal: "smoke memo transcript",
      rawTextCleaned: "smoke memo transcript",
      reviewedText: "smoke memo transcript",
      rawSegments: [] as any,
      summaryMarkdown:
        "## 今回確認したこと\n長文読解は前より安定してきており、止まりにくさが減っている。\n\n## 講師の見立て\nいまの点数差は英語力そのものより、睡眠リズムの乱れに引っ張られている。\n\n## 次回までに進めること\n就寝時間を整えながら、読解の再現手順を言語化して固定する。",
      formattedTranscript: "## 面談\nsmoke memo transcript",
      qualityMetaJson: { smoke: true } as any,
      createdAt: sessionDate,
    },
  });

  return {
    studentId,
    sessionId,
    conversationId,
    cleanup: async () => {
      await cleanupStudentFixtures([studentId]);
    },
  };
}
