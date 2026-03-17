import {
  ConversationSourceType,
  ConversationStatus,
  EntityKind,
  EntityStatus,
  PrismaClient,
  ReportStatus,
  SessionPartStatus,
  SessionPartType,
  SessionStatus,
  SessionType,
  UserRole,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_ORGANIZATION_ID, DEFAULT_ORGANIZATION_NAME } from "../lib/constants";

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
    const passwordHash = await bcrypt.hash(user.password, SALT_ROUNDS);
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
  await prisma.sessionEntity.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.report.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.conversationLog.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.sessionPart.deleteMany({ where: { session: { studentId: { in: studentIds } } } });
  await prisma.session.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.studentEntity.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.studentProfile.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
}

async function createHana() {
  const studentId = "student-demo-1";
  const interviewDate = "2026-03-10T19:30:00.000Z";
  const lessonDate = "2026-03-12T10:00:00.000Z";

  await prisma.student.create({
    data: {
      id: studentId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      name: "Hana Yamada",
      nameKana: "HANA YAMADA",
      grade: "High School 2",
      course: "Advanced English",
      guardianNames: "Father Ichiro / Mother Yoko",
      enrollmentDate: new Date("2025-04-01"),
      birthdate: new Date("2009-08-12"),
    },
  });

  await prisma.studentProfile.create({
    data: {
      studentId,
      summary: "Reading comprehension is improving. Sleep rhythm is the next lever.",
      personality: "Honest and quick to act when the step is concrete.",
      motivationSource: "Visible score gains and a clear target school.",
      ngApproach: "Too many tasks at once causes freeze.",
      profileData: {
        basic: [
          { field: "school", value: "Aoyama High School", confidence: 90 },
          { field: "targetSchool", value: "Waseda University", confidence: 88 },
        ],
        personal: [
          { field: "strength", value: "Reads structure fast", confidence: 84 },
          { field: "challenge", value: "Late nights reduce focus", confidence: 83 },
        ],
      } as any,
      basicData: { basic: [{ field: "school", value: "Aoyama High School" }] } as any,
    },
  });

  await prisma.studentEntity.createMany({
    data: [
      { studentId, kind: EntityKind.SCHOOL, canonicalName: "Aoyama High School", aliasesJson: [] as any },
      { studentId, kind: EntityKind.TARGET_SCHOOL, canonicalName: "Waseda University", aliasesJson: ["Waseda"] as any },
    ],
  });

  await prisma.session.create({
    data: {
      id: "session-demo-1-interview",
      organizationId: DEFAULT_ORGANIZATION_ID,
      studentId,
      userId: "user-demo-teacher",
      type: SessionType.INTERVIEW,
      status: SessionStatus.READY,
      title: "March Interview",
      sessionDate: new Date(interviewDate),
      heroStateLabel: "Forward",
      heroOneLiner: "English is moving. Sleep rhythm is the next leverage point.",
      latestSummary: "English is more stable. Sleep rhythm now explains most score variance.",
      pendingEntityCount: 1,
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
        "Coach: Your reading is more stable now. Student: I get stuck less often. Coach: Late nights still hurt your accuracy.",
      rawTextCleaned:
        "Coach: Your reading is more stable now. Student: I get stuck less often. Coach: Late nights still hurt your accuracy.",
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
        "Coach: Your reading is more stable now. Student: I get stuck less often. Coach: Late nights still hurt your accuracy.",
      rawTextCleaned:
        "Coach: Your reading is more stable now. Student: I get stuck less often. Coach: Late nights still hurt your accuracy.",
      rawSegments: [] as any,
      rawTextExpiresAt: plusDays(interviewDate, 30),
      summaryMarkdown:
        "## Session Summary\nReading is more stable than before.\n\n## Coaching Core\nSleep rhythm now explains most score variance.\n\n## Next Direction\nFix bedtime and keep reading review focused on repeatability.",
      timelineJson: [
        {
          title: "Reading gain",
          what_happened: "She gets stuck less often in long passages.",
          coach_point: "Lock in the gain through repeatable review.",
          student_state: "Positive but aware of variance.",
          evidence_quotes: ["I get stuck less often", "Late nights hurt your accuracy"],
        },
      ] as any,
      nextActionsJson: [
        {
          owner: "STUDENT",
          action: "Put the phone away by 23:30",
          due: "Before next interview",
          metric: "5 days completed",
          why: "Reduce score variance",
        },
      ] as any,
      profileDeltaJson: {
        basic: [],
        personal: [{ field: "sleep", value: "Late nights reduce focus", confidence: 84, evidence_quotes: [] }],
      } as any,
      parentPackJson: { monthlyChange: "Reading is more stable", focus: "sleep and repeatability" } as any,
      studentStateJson: {
        label: "Forward",
        oneLiner: "English is moving. Sleep rhythm is the next leverage point.",
        rationale: ["Reading is more stable", "Variance is tied to sleep"],
        confidence: 86,
      } as any,
      topicSuggestionsJson: [
        {
          category: "Study",
          title: "Repeatable reading process",
          reason: "The gain looks real and can be locked in.",
          question: "What exactly helped you avoid getting stuck this week?",
          priority: 1,
        },
      ] as any,
      quickQuestionsJson: [
        {
          category: "Life",
          question: "What was your latest bedtime this week?",
          reason: "Check real sleep rhythm",
        },
      ] as any,
      profileSectionsJson: [
        {
          category: "Study",
          status: "Improving",
          highlights: [{ label: "Reading", value: "Structure recognition is faster", isUpdated: true }],
          nextQuestion: "Can you explain the reading process that worked?",
        },
      ] as any,
      observationJson: [
        {
          sourceType: "INTERVIEW",
          category: "Study",
          statusDraft: "Improving",
          insights: ["Reading has become more stable"],
          topics: ["English reading", "sleep"],
          nextActions: ["Write short reading notes"],
          evidence: ["I get stuck less often"],
          characterSignal: "Moves fast when progress is visible",
          weight: 0.9,
        },
      ] as any,
      entityCandidatesJson: [
        {
          id: "entity-demo-1-pending",
          kind: "TARGET_SCHOOL",
          rawValue: "Waseda",
          canonicalValue: "Waseda University",
          confidence: 88,
          status: "PENDING",
          context: "Mentioned during target-school discussion",
        },
      ] as any,
      formattedTranscript:
        "## Interview\nCoach: Your reading is more stable now.\nStudent: I get stuck less often.\nCoach: Late nights still hurt your accuracy.",
      qualityMetaJson: { seeded: true, modelFinal: "gpt-5.4", modelFast: "gpt-5-mini" } as any,
      createdAt: new Date(interviewDate),
    },
  });

  await prisma.sessionEntity.create({
    data: {
      id: "entity-demo-1-pending",
      sessionId: "session-demo-1-interview",
      conversationId: "conversation-demo-1-interview",
      studentId,
      kind: EntityKind.TARGET_SCHOOL,
      rawValue: "Waseda",
      canonicalValue: "Waseda University",
      confidence: 88,
      status: EntityStatus.PENDING,
      sourceJson: { context: "Mentioned during target-school discussion" } as any,
      createdAt: new Date(interviewDate),
    },
  });

  await prisma.session.create({
    data: {
      id: "session-demo-1-lesson",
      organizationId: DEFAULT_ORGANIZATION_ID,
      studentId,
      userId: "user-demo-instructor",
      type: SessionType.LESSON_REPORT,
      status: SessionStatus.READY,
      title: "English Lesson Report",
      sessionDate: new Date(lessonDate),
      heroStateLabel: "Focused",
      heroOneLiner: "Lesson focus is strong. Homework starts are still slow.",
      latestSummary: "Focus during the lesson was strong, but homework start friction remains.",
      pendingEntityCount: 0,
      completedAt: new Date(lessonDate),
      createdAt: new Date(lessonDate),
    },
  });

  await prisma.sessionPart.createMany({
    data: [
      {
        id: "part-demo-1-lesson-in",
        sessionId: "session-demo-1-lesson",
        partType: SessionPartType.CHECK_IN,
        sourceType: ConversationSourceType.MANUAL,
        status: SessionPartStatus.READY,
        rawTextOriginal: "One of two homework readings was done.",
        rawTextCleaned: "One of two homework readings was done.",
        rawSegments: [] as any,
        qualityMetaJson: { seeded: true } as any,
        transcriptExpiresAt: plusDays(lessonDate, 30),
        createdAt: new Date(lessonDate),
      },
      {
        id: "part-demo-1-lesson-out",
        sessionId: "session-demo-1-lesson",
        partType: SessionPartType.CHECK_OUT,
        sourceType: ConversationSourceType.MANUAL,
        status: SessionPartStatus.READY,
        rawTextOriginal: "Focus during class was good. Homework was reset with a fixed start time.",
        rawTextCleaned: "Focus during class was good. Homework was reset with a fixed start time.",
        rawSegments: [] as any,
        qualityMetaJson: { seeded: true } as any,
        transcriptExpiresAt: plusDays(lessonDate, 30),
        createdAt: new Date(lessonDate),
      },
    ],
  });

  await prisma.conversationLog.create({
    data: {
      id: "conversation-demo-1-lesson",
      organizationId: DEFAULT_ORGANIZATION_ID,
      studentId,
      userId: "user-demo-instructor",
      sessionId: "session-demo-1-lesson",
      sourceType: ConversationSourceType.MANUAL,
      status: ConversationStatus.DONE,
      rawTextOriginal: "One of two homework readings was done.\n\nFocus during class was good. Homework was reset with a fixed start time.",
      rawTextCleaned: "One of two homework readings was done.\n\nFocus during class was good. Homework was reset with a fixed start time.",
      rawSegments: [] as any,
      rawTextExpiresAt: plusDays(lessonDate, 30),
      summaryMarkdown:
        "## Lesson Report\nFocus during the lesson was strong.\n\n## Coaching Core\nThe issue is homework start friction.\n\n## Next Direction\nKeep the workload and fix the start time.",
      timelineJson: [] as any,
      nextActionsJson: [
        {
          owner: "STUDENT",
          action: "Start Sunday reading at 20:00",
          due: "Before next lesson",
          metric: "Start time kept",
          why: "Reduce homework friction",
        },
      ] as any,
      profileDeltaJson: { basic: [], personal: [] } as any,
      parentPackJson: { monthlyChange: "In-class focus remains strong", focus: "homework start routine" } as any,
      studentStateJson: {
        label: "Focused",
        oneLiner: "Lesson focus is strong. Homework starts are still slow.",
        rationale: ["Class focus is stable", "Homework start friction remains"],
        confidence: 80,
      } as any,
      topicSuggestionsJson: [] as any,
      quickQuestionsJson: [] as any,
      profileSectionsJson: [] as any,
      observationJson: [] as any,
      entityCandidatesJson: [] as any,
      lessonReportJson: {
        todayGoal: "Review and one new reading",
        covered: ["review quiz", "one long reading"],
        blockers: ["homework start friction"],
        homework: ["one reading", "vocabulary check"],
        nextLessonFocus: ["repeatable reading process", "homework start time"],
      } as any,
      formattedTranscript:
        "## Check-in\nOne of two homework readings was done.\n\n## Check-out\nFocus during class was good. Homework was reset with a fixed start time.",
      qualityMetaJson: { seeded: true, modelFinal: "gpt-5.4", modelFast: "gpt-5-mini" } as any,
      createdAt: new Date(lessonDate),
    },
  });

  await prisma.report.create({
    data: {
      id: "report-demo-1",
      studentId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      reportMarkdown:
        "## Biggest change this month\nEnglish reading is more stable.\n\n## Study\nLesson focus remains strong and reading is more repeatable.\n\n## Life\nSleep rhythm is the main next lever.",
      reportJson: { seeded: true } as any,
      status: ReportStatus.DRAFT,
      qualityChecksJson: { pendingEntityCount: 1, seeded: true } as any,
      periodFrom: plusDays(interviewDate, -30),
      periodTo: new Date("2026-03-13T01:00:00.000Z"),
      sourceLogIds: ["conversation-demo-1-interview", "conversation-demo-1-lesson"] as any,
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
      name: "Aoi Sato",
      nameKana: "AOI SATO",
      grade: "High School 1",
      course: "Math Intensive",
      guardianNames: "Mother Mari Sato",
      enrollmentDate: new Date("2025-04-01"),
      birthdate: new Date("2010-02-18"),
    },
  });

  await prisma.studentProfile.create({
    data: {
      studentId,
      summary: "Math persistence is strong. The weak point is the first move on hard problems.",
      personality: "Wants to understand before acting. Once convinced, speed goes up fast.",
      motivationSource: "Small wins on quizzes.",
      ngApproach: "Throwing a full hard problem at the start causes freeze.",
      profileData: {
        basic: [{ field: "school", value: "Urawa High School", confidence: 92 }],
        personal: [{ field: "challenge", value: "Stops on the first move of hard problems", confidence: 82 }],
      } as any,
      basicData: { basic: [{ field: "school", value: "Urawa High School" }] } as any,
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
      title: "Math Interview",
      sessionDate: new Date(sessionDate),
      heroStateLabel: "Focused",
      heroOneLiner: "Math persistence is there. The first move needs a template.",
      latestSummary: "The real bottleneck is the first move on hard problems.",
      pendingEntityCount: 0,
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
      rawTextOriginal: "Math work is careful, but the first move on hard problems often stalls.",
      rawTextCleaned: "Math work is careful, but the first move on hard problems often stalls.",
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
      rawTextOriginal: "Math work is careful, but the first move on hard problems often stalls.",
      rawTextCleaned: "Math work is careful, but the first move on hard problems often stalls.",
      rawSegments: [] as any,
      rawTextExpiresAt: plusDays(sessionDate, 30),
      summaryMarkdown:
        "## Session Summary\nMath persistence is strong.\n\n## Coaching Core\nThe weak point is the first move on harder problems.\n\n## Next Direction\nFix a simple first-move template: conditions, sketch, first line.",
      timelineJson: [] as any,
      nextActionsJson: [
        {
          owner: "STUDENT",
          action: "Write three setup lines before solving hard problems",
          due: "Before next lesson",
          metric: "Used on 3 problems",
          why: "Reduce first-move freeze",
        },
      ] as any,
      profileDeltaJson: { basic: [], personal: [] } as any,
      parentPackJson: { monthlyChange: "Math effort is steady", focus: "first-move template" } as any,
      studentStateJson: {
        label: "Focused",
        oneLiner: "Math persistence is there. The first move needs a template.",
        rationale: ["Careful written steps", "First move still stalls"],
        confidence: 84,
      } as any,
      topicSuggestionsJson: [] as any,
      quickQuestionsJson: [] as any,
      profileSectionsJson: [] as any,
      observationJson: [] as any,
      entityCandidatesJson: [] as any,
      formattedTranscript: "## Interview\nMath work is careful, but the first move on hard problems often stalls.",
      qualityMetaJson: { seeded: true, modelFinal: "gpt-5.4", modelFast: "gpt-5-mini" } as any,
      createdAt: new Date(sessionDate),
    },
  });

  await prisma.report.create({
    data: {
      id: "report-demo-2",
      studentId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      reportMarkdown:
        "## Biggest change this month\nMath effort is steady and visible.\n\n## Study\nThe next gain is to make the first move on harder problems more consistent.",
      reportJson: { seeded: true } as any,
      status: ReportStatus.SENT,
      sentAt: new Date("2026-03-11T09:00:00.000Z"),
      sentByUserId: "user-demo-teacher",
      deliveryChannel: "manual",
      qualityChecksJson: { pendingEntityCount: 0, seeded: true } as any,
      periodFrom: plusDays(sessionDate, -30),
      periodTo: new Date("2026-03-11T08:00:00.000Z"),
      sourceLogIds: ["conversation-demo-2-interview"] as any,
      createdAt: new Date("2026-03-11T08:00:00.000Z"),
    },
  });
}

async function main() {
  console.log("Seeding PARARIA MVP demo data...");

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
  await createHana();
  await createAoi();

  console.log("Seed completed.");
  console.log(`Organization: ${DEFAULT_ORGANIZATION_ID} (${DEFAULT_ORGANIZATION_NAME})`);
  console.log("Demo login: admin@demo.com / demo123");
  console.log("Students: 2");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
