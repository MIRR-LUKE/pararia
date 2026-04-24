import {
  ConversationSourceType,
  ConversationStatus,
  PrismaClient,
  ReportDeliveryEventType,
  ReportStatus,
  SessionPartStatus,
  SessionPartType,
  SessionStatus,
  SessionType,
  UserRole,
} from "@prisma/client";
import { hash } from "@node-rs/bcrypt";
import { DEFAULT_ORGANIZATION_ID, DEFAULT_ORGANIZATION_NAME } from "../lib/constants";
import { assertSeedTargetSafe } from "../scripts/lib/environment-safety";

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

const USERS = [
  { id: "user-demo-admin", email: "admin@demo.com", password: "demo123", name: "PARARIA Admin", role: UserRole.ADMIN },
  { id: "user-demo-manager", email: "manager@demo.com", password: "demo123", name: "Mina Manager", role: UserRole.MANAGER },
  { id: "user-demo-teacher", email: "teacher@demo.com", password: "demo123", name: "Takumi Coach", role: UserRole.TEACHER },
  { id: "user-demo-instructor", email: "instructor@demo.com", password: "demo123", name: "Aoi Instructor", role: UserRole.INSTRUCTOR },
];

function plusDays(dateString: string, days: number) {
  const date = new Date(dateString);
  date.setDate(date.getDate() + days);
  return date;
}

async function upsertUsers() {
  for (const user of USERS) {
    const passwordHash = await hash(user.password, SALT_ROUNDS);
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        id: user.id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        name: user.name,
        role: user.role,
        passwordHash,
      },
      create: {
        id: user.id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash,
      },
    });
  }
}

async function cleanup(studentIds: string[]) {
  const conversations = await prisma.conversationLog.findMany({
    where: { studentId: { in: studentIds } },
    select: { id: true },
  });

  await prisma.conversationJob.deleteMany({
    where: { conversationId: { in: conversations.map((item) => item.id) } },
  });
  await prisma.report.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.conversationLog.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.sessionPart.deleteMany({ where: { session: { studentId: { in: studentIds } } } });
  await prisma.session.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.studentProfile.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
}

async function createHana() {
  const studentId = "student-demo-1";
  const interviewDate = "2026-03-10T19:30:00.000Z";

  await prisma.student.create({
    data: {
      id: studentId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      name: "山田 花",
      nameKana: "ヤマダ ハナ",
      grade: "高校2年",
      course: "英語強化コース",
      guardianNames: "父: 山田 一郎 / 母: 山田 陽子",
      enrollmentDate: new Date("2025-04-01"),
      birthdate: new Date("2009-08-12"),
    },
  });

  await prisma.studentProfile.create({
    data: {
      studentId,
      summary: "長文読解の再現性が上がってきた。次のレバーは睡眠リズム。",
      personality: "やることが具体的ならすぐ動ける素直さがある。",
      motivationSource: "点数の伸びと志望校への手応え。",
      ngApproach: "課題を一度に出しすぎると止まりやすい。",
      profileData: {
        basic: [
          { field: "school", value: "青山高校", confidence: 90 },
          { field: "targetSchool", value: "早稲田大学", confidence: 88 },
        ],
        personal: [
          { field: "strength", value: "文章の構造をつかむのが早い", confidence: 84 },
          { field: "challenge", value: "就寝が遅い日に集中が落ちやすい", confidence: 83 },
        ],
      } as any,
      basicData: { basic: [{ field: "school", value: "青山高校" }] } as any,
    },
  });

  await prisma.session.create({
    data: {
      id: "session-demo-1-interview",
      organizationId: DEFAULT_ORGANIZATION_ID,
      studentId,
      userId: "user-demo-teacher",
      type: SessionType.INTERVIEW,
      status: SessionStatus.READY,
      title: "3月面談",
      sessionDate: new Date(interviewDate),
      heroStateLabel: "前進中",
      heroOneLiner: "英語の手応えは出てきた。次は睡眠リズムを整えたい。",
      latestSummary: "英語は安定してきたが、睡眠の乱れが点数の振れ幅を生んでいる。",
      completedAt: new Date(interviewDate),
      createdAt: new Date(interviewDate),
    },
  });

  await prisma.sessionPart.create({
    data: {
      id: "part-demo-1-interview-full",
      sessionId: "session-demo-1-interview",
      partType: SessionPartType.FULL,
      sourceType: ConversationSourceType.AUDIO,
      status: SessionPartStatus.READY,
      fileName: "hana-interview.webm",
      rawTextOriginal:
        "講師: 長文は前より止まりにくくなったね。生徒: 前より読みやすいです。講師: ただ寝る時間が遅い日はミスが増えるね。",
      rawTextCleaned:
        "講師: 長文は前より止まりにくくなったね。生徒: 前より読みやすいです。講師: ただ寝る時間が遅い日はミスが増えるね。",
      rawSegments: [] as any,
      qualityMetaJson: { seeded: true } as any,
      transcriptExpiresAt: plusDays(interviewDate, 30),
      createdAt: new Date(interviewDate),
    },
  });

  await prisma.conversationLog.create({
    data: {
      id: "conversation-demo-1-interview",
      organizationId: DEFAULT_ORGANIZATION_ID,
      studentId,
      userId: "user-demo-teacher",
      sessionId: "session-demo-1-interview",
      sourceType: ConversationSourceType.AUDIO,
      status: ConversationStatus.DONE,
      rawTextOriginal:
        "講師: 長文は前より止まりにくくなったね。生徒: 前より読みやすいです。講師: ただ寝る時間が遅い日はミスが増えるね。",
      rawTextCleaned:
        "講師: 長文は前より止まりにくくなったね。生徒: 前より読みやすいです。講師: ただ寝る時間が遅い日はミスが増えるね。",
      rawSegments: [] as any,
      rawTextExpiresAt: plusDays(interviewDate, 30),
      summaryMarkdown:
        "## 今回確認したこと\n長文読解は前より安定してきており、止まりにくさが減っている。\n\n## 講師の見立て\nいまの点数差は英語力そのものより、睡眠リズムの乱れに引っ張られている。\n\n## 次回までに進めること\n就寝時間を整えながら、読解の再現手順を言語化して固定する。",
      formattedTranscript:
        "## 面談\n講師: 長文は前より止まりにくくなったね。\n生徒: 前より読みやすいです。\n講師: ただ寝る時間が遅い日はミスが増えるね。",
      qualityMetaJson: { seeded: true, modelFinal: "gpt-5.4", modelFast: "gpt-5-mini" } as any,
      createdAt: new Date(interviewDate),
    },
  });

  const harutoReport = await prisma.report.create({
    data: {
      id: "report-demo-1",
      studentId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      reportMarkdown:
        "## 今月の大きな変化\n英語長文の安定感が上がってきました。\n\n## 学習面\n授業中の集中は維持できており、読解手順の再現性も高まっています。\n\n## 生活面\n次の焦点は睡眠リズムを整えて、点数の振れ幅を減らすことです。",
      reportJson: { seeded: true } as any,
      status: ReportStatus.DRAFT,
      qualityChecksJson: { seeded: true } as any,
      periodFrom: plusDays(interviewDate, -30),
      periodTo: new Date("2026-03-13T01:00:00.000Z"),
      sourceLogIds: ["conversation-demo-1-interview"] as any,
      createdAt: new Date("2026-03-13T01:00:00.000Z"),
    },
  });

  await prisma.reportDeliveryEvent.create({
    data: {
      reportId: harutoReport.id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      studentId,
      actorUserId: "user-demo-teacher",
      eventType: ReportDeliveryEventType.DRAFT_CREATED,
      eventMetaJson: { seeded: true } as any,
      createdAt: new Date("2026-03-13T01:00:00.000Z"),
    },
  });
}

async function createAoi() {
  const studentId = "student-demo-2";
  const sessionDate = "2026-03-09T09:00:00.000Z";

  await prisma.student.create({
    data: {
      id: studentId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      name: "佐藤 葵",
      nameKana: "サトウ アオイ",
      grade: "高校1年",
      course: "数学強化コース",
      guardianNames: "母: 佐藤 真理",
      enrollmentDate: new Date("2025-04-01"),
      birthdate: new Date("2010-02-18"),
    },
  });

  await prisma.studentProfile.create({
    data: {
      studentId,
      summary: "数学の粘り強さはある。難問で最初の一手が止まりやすい。",
      personality: "納得してから動きたいタイプで、腹落ちすると一気に進む。",
      motivationSource: "小テストでの小さな成功体験。",
      ngApproach: "最初から重い問題を投げると止まりやすい。",
      profileData: {
        basic: [{ field: "school", value: "浦和高校", confidence: 92 }],
        personal: [{ field: "challenge", value: "難問で最初の一手が止まりやすい", confidence: 82 }],
      } as any,
      basicData: { basic: [{ field: "school", value: "浦和高校" }] } as any,
    },
  });

  await prisma.session.create({
    data: {
      id: "session-demo-2-interview",
      organizationId: DEFAULT_ORGANIZATION_ID,
      studentId,
      userId: "user-demo-teacher",
      type: SessionType.INTERVIEW,
      status: SessionStatus.READY,
      title: "数学面談",
      sessionDate: new Date(sessionDate),
      heroStateLabel: "思考安定",
      heroOneLiner: "数学の粘りはある。最初の一手に型を持たせたい。",
      latestSummary: "本当の詰まりどころは、難問で最初の一手が出ないこと。",
      completedAt: new Date(sessionDate),
      createdAt: new Date(sessionDate),
    },
  });

  await prisma.sessionPart.create({
    data: {
      id: "part-demo-2-interview-full",
      sessionId: "session-demo-2-interview",
      partType: SessionPartType.FULL,
      sourceType: ConversationSourceType.MANUAL,
      status: SessionPartStatus.READY,
      rawTextOriginal: "数学は丁寧に取り組めているが、難問になると最初の一手で止まりやすい。",
      rawTextCleaned: "数学は丁寧に取り組めているが、難問になると最初の一手で止まりやすい。",
      rawSegments: [] as any,
      qualityMetaJson: { seeded: true } as any,
      transcriptExpiresAt: plusDays(sessionDate, 30),
      createdAt: new Date(sessionDate),
    },
  });

  await prisma.conversationLog.create({
    data: {
      id: "conversation-demo-2-interview",
      organizationId: DEFAULT_ORGANIZATION_ID,
      studentId,
      userId: "user-demo-teacher",
      sessionId: "session-demo-2-interview",
      sourceType: ConversationSourceType.MANUAL,
      status: ConversationStatus.DONE,
      rawTextOriginal: "数学は丁寧に取り組めているが、難問になると最初の一手で止まりやすい。",
      rawTextCleaned: "数学は丁寧に取り組めているが、難問になると最初の一手で止まりやすい。",
      rawSegments: [] as any,
      rawTextExpiresAt: plusDays(sessionDate, 30),
      summaryMarkdown:
        "## 今回確認したこと\n数学は丁寧に取り組めており、粘り強さも見えている。\n\n## 講師の見立て\n弱点は難問で最初の一手が出るまでに時間がかかること。\n\n## 次回までに進めること\n条件整理、図、最初の式の3点セットを先に書く型を作る。",
      formattedTranscript: "## 面談\n数学は丁寧に取り組めているが、難問になると最初の一手で止まりやすい。",
      qualityMetaJson: { seeded: true, modelFinal: "gpt-5.4", modelFast: "gpt-5-mini" } as any,
      createdAt: new Date(sessionDate),
    },
  });

  const aoiReport = await prisma.report.create({
    data: {
      id: "report-demo-2",
      studentId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      reportMarkdown:
        "## 今月の大きな変化\n数学の粘り強さが安定して見えるようになりました。\n\n## 学習面\n次の伸びしろは、難問で最初の一手をより安定して出せるようにすることです。",
      reportJson: { seeded: true } as any,
      status: ReportStatus.SENT,
      sentAt: new Date("2026-03-11T09:00:00.000Z"),
      sentByUserId: "user-demo-teacher",
      deliveryChannel: "manual",
      qualityChecksJson: { seeded: true } as any,
      periodFrom: plusDays(sessionDate, -30),
      periodTo: new Date("2026-03-11T08:00:00.000Z"),
      sourceLogIds: ["conversation-demo-2-interview"] as any,
      createdAt: new Date("2026-03-11T08:00:00.000Z"),
    },
  });

  await prisma.reportDeliveryEvent.createMany({
    data: [
      {
        reportId: aoiReport.id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        studentId,
        actorUserId: "user-demo-teacher",
        eventType: ReportDeliveryEventType.DRAFT_CREATED,
        eventMetaJson: { seeded: true } as any,
        createdAt: new Date("2026-03-11T08:00:00.000Z"),
      },
      {
        reportId: aoiReport.id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        studentId,
        actorUserId: "user-demo-teacher",
        eventType: ReportDeliveryEventType.MANUAL_SHARED,
        deliveryChannel: "manual",
        eventMetaJson: { seeded: true } as any,
        createdAt: new Date("2026-03-11T09:00:00.000Z"),
      },
    ],
  });
}

async function main() {
  console.log("Seeding PARARIA MVP demo data...");
  assertSeedTargetSafe("prisma-seed");
  const includeDemoStudents = /^(1|true|yes)$/i.test(process.env.PARARIA_INCLUDE_DEMO_STUDENTS ?? "");

  await prisma.organization.upsert({
    where: { id: DEFAULT_ORGANIZATION_ID },
    update: { name: DEFAULT_ORGANIZATION_NAME },
    create: {
      id: DEFAULT_ORGANIZATION_ID,
      name: DEFAULT_ORGANIZATION_NAME,
    },
  });

  await upsertUsers();
  await cleanup(["student-demo-1", "student-demo-2"]);
  if (includeDemoStudents) {
    await createHana();
    await createAoi();
  }

  console.log("Seed completed.");
  console.log(`Organization: ${DEFAULT_ORGANIZATION_ID} (${DEFAULT_ORGANIZATION_NAME})`);
  console.log("Demo login: admin@demo.com / demo123");
  console.log(`Students: ${includeDemoStudents ? 2 : 0}`);
  if (!includeDemoStudents) {
    console.log("Demo students skipped. Set PARARIA_INCLUDE_DEMO_STUDENTS=1 to seed fixture students.");
  }
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
