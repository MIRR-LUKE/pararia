import { ConversationSourceType, ConversationStatus, ReportDeliveryEventType, ReportStatus, SessionStatus, SessionType } from "@prisma/client";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { assertMutatingFixtureEnvironment } from "./environment-safety";
import {
  cleanupStudentFixtures,
  createSmokeStudent,
  buildFixtureId,
  type CriticalPathManagedFixture,
  CRITICAL_PATH_BASE_URL,
} from "./critical-path-smoke-env";

export async function createRecordingLockFixture(): Promise<CriticalPathManagedFixture<{ studentId: string }>> {
  assertMutatingFixtureEnvironment(process.env.CRITICAL_PATH_BASE_URL || CRITICAL_PATH_BASE_URL, "critical-path-recording-lock");
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
  assertMutatingFixtureEnvironment(process.env.CRITICAL_PATH_BASE_URL || CRITICAL_PATH_BASE_URL, "critical-path-student-room");
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
  assertMutatingFixtureEnvironment(process.env.CRITICAL_PATH_BASE_URL || CRITICAL_PATH_BASE_URL, "critical-path-next-meeting-memo");
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
