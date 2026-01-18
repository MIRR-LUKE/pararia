import { PrismaClient, ConversationSourceType, ConversationStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { students as mockStudents, conversationLogs } from "../lib/mockData";
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_ORGANIZATION_NAME,
  DEFAULT_TEACHER_FULL_NAME,
} from "../lib/constants";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // 1. 組織を作成（既に存在する場合はスキップ）
  const orgId = DEFAULT_ORGANIZATION_ID;
  let org = await prisma.organization.findUnique({
    where: { id: orgId },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        id: orgId,
        name: DEFAULT_ORGANIZATION_NAME,
      },
    });
    console.log("✅ Created organization:", org.name);
  } else {
    console.log("ℹ️  Organization already exists:", org.name);
  }

  // 2. ユーザーを作成（既に存在する場合はスキップ）
  const adminEmail = "admin@demo.com";
  let admin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!admin) {
    const passwordHash = await bcrypt.hash("demo123", 10);
    admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        name: "管理者",
        role: "ADMIN",
        organizationId: orgId,
      },
    });
    console.log("✅ Created admin user:", admin.email);
  } else {
    console.log("ℹ️  Admin user already exists:", admin.email);
  }

  // 3. デモ講師ユーザー
  const teacherEmail = "teacher@demo.com";
  let teacher = await prisma.user.findUnique({
    where: { email: teacherEmail },
  });
  if (!teacher) {
    const passwordHash = await bcrypt.hash("demo123", 10);
    teacher = await prisma.user.create({
      data: {
        email: teacherEmail,
        passwordHash,
        name: DEFAULT_TEACHER_FULL_NAME,
        role: "TEACHER",
        organizationId: orgId,
      },
    });
    console.log("✅ Created teacher user:", teacher.email);
  }

  const toDeltaItems = (
    record?: Record<string, { value: string; detail?: string; confidence?: number }>
  ) =>
    Object.entries(record ?? {}).map(([field, value]) => ({
      field,
      value: value.value,
      confidence: value.confidence ?? 70,
      evidence_quotes: [],
    }));

  // 4. 生徒 + プロフィール
  for (const student of mockStudents) {
    const created = await prisma.student.upsert({
      where: { id: student.id },
      update: {
        organizationId: orgId,
        name: student.name,
        nameKana: student.nameKana ?? null,
        grade: student.grade,
        course: student.course,
        enrollmentDate: student.enrollmentDate ? new Date(student.enrollmentDate) : null,
        birthdate: student.birthdate ? new Date(student.birthdate) : null,
        guardianNames: student.guardianNames ?? null,
      },
      create: {
        id: student.id,
        organizationId: orgId,
        name: student.name,
        nameKana: student.nameKana ?? null,
        grade: student.grade,
        course: student.course,
        enrollmentDate: student.enrollmentDate ? new Date(student.enrollmentDate) : null,
        birthdate: student.birthdate ? new Date(student.birthdate) : null,
        guardianNames: student.guardianNames ?? null,
      },
    });

    const personalItems = toDeltaItems(student.profile?.personal as any);
    const basicItems = toDeltaItems(student.profile?.basics as any);
    const latestLog = conversationLogs
      .filter((log) => log.studentId === student.id)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];

    await prisma.studentProfile.deleteMany({ where: { studentId: created.id } });
    await prisma.studentProfile.create({
      data: {
        studentId: created.id,
        summary: student.profile?.summary ?? null,
        personality: student.profile?.personal?.personality?.value ?? null,
        motivationSource: student.profile?.personal?.motivationSource?.value ?? null,
        ngApproach: student.profile?.personal?.ngApproach?.value ?? null,
        profileData: {
          basic: basicItems,
          personal: personalItems,
          lastUpdatedFromLogId: latestLog?.id,
        },
        basicData: { basic: basicItems },
      },
    });
  }

  // 5. 会話ログ
  for (const log of conversationLogs) {
    const timeline = (log.keyTopics ?? []).map((topic) => ({
      title: topic,
      what_happened: log.summary,
      coach_point: "",
      student_state: "",
      evidence_quotes: (log.keyQuotes ?? []).slice(0, 2),
    }));
    const nextActions = (log.nextActions ?? []).map((action) => ({
      owner: "STUDENT",
      action,
      due: "次回面談まで",
      metric: "",
      why: "",
    }));
    const profileDelta = {
      basic: toDeltaItems(log.structuredDelta?.basics as any),
      personal: toDeltaItems(log.structuredDelta?.personal as any),
    };

    await prisma.conversationLog.upsert({
      where: { id: log.id },
      update: {
        organizationId: orgId,
        studentId: log.studentId,
        userId: teacher?.id ?? admin.id,
        sourceType:
          log.sourceType === "AUDIO" ? ConversationSourceType.AUDIO : ConversationSourceType.MANUAL,
        status: ConversationStatus.DONE,
        summaryMarkdown: log.summary,
        timelineJson: timeline as any,
        nextActionsJson: nextActions as any,
        profileDeltaJson: profileDelta as any,
        formattedTranscript:
          log.notes ??
          [log.summary, ...(log.keyQuotes ?? []).map((q) => `・${q}`)].join("\n"),
        createdAt: new Date(log.date),
      },
      create: {
        id: log.id,
        organizationId: orgId,
        studentId: log.studentId,
        userId: teacher?.id ?? admin.id,
        sourceType:
          log.sourceType === "AUDIO" ? ConversationSourceType.AUDIO : ConversationSourceType.MANUAL,
        status: ConversationStatus.DONE,
        summaryMarkdown: log.summary,
        timelineJson: timeline as any,
        nextActionsJson: nextActions as any,
        profileDeltaJson: profileDelta as any,
        formattedTranscript:
          log.notes ??
          [log.summary, ...(log.keyQuotes ?? []).map((q) => `・${q}`)].join("\n"),
        createdAt: new Date(log.date),
      },
    });
  }

  console.log("🎉 Seeding completed!");
  console.log("\n📋 Summary:");
  console.log(`   Organization ID: ${orgId}`);
  console.log(`   Admin Email: ${adminEmail}`);
  console.log(`   Admin Password: demo123`);
  console.log(`   Demo students: ${mockStudents.length}`);
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
