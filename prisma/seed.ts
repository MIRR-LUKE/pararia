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
  const lessonDate = "2026-03-12T10:00:00.000Z";

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
      timelineJson: [
        {
          title: "長文の安定感が上がった",
          what_happened: "長文で止まる回数が減り、以前より読み進めやすくなっている。",
          coach_point: "うまく読めた手順を言葉にして、再現できる形に固定する。",
          student_state: "手応えはあるが、睡眠次第で波が出ることも自覚している。",
          evidence_quotes: ["前より読みやすいです", "寝る時間が遅い日はミスが増える"],
        },
      ] as any,
      nextActionsJson: [
        {
          owner: "STUDENT",
          action: "23時30分までにスマホを置いて就寝準備に入る",
          due: "次回面談まで",
          metric: "5日実行",
          why: "点数の振れ幅を減らすため",
        },
      ] as any,
      profileDeltaJson: {
        basic: [],
        personal: [{ field: "sleep", value: "就寝が遅い日は集中が落ちやすい", confidence: 84, evidence_quotes: [] }],
      } as any,
      parentPackJson: { monthlyChange: "長文読解の安定感が上がってきた", focus: "睡眠リズムと再現性の固定" } as any,
      studentStateJson: {
        label: "前進中",
        oneLiner: "英語の手応えは出てきた。次は睡眠リズムを整えたい。",
        rationale: ["長文で止まりにくくなっている", "振れ幅は睡眠の影響が大きい"],
        confidence: 86,
      } as any,
      topicSuggestionsJson: [
        {
          category: "学習",
          title: "長文を安定させた要因の確認",
          reason: "伸びが偶然ではなく、再現できる学習手順に育ちつつあるため。",
          question: "今週、長文で止まりにくかった理由を自分ではどう考えている？",
          priority: 1,
        },
      ] as any,
      quickQuestionsJson: [
        {
          category: "生活",
          question: "今週いちばん遅く寝た日は何時ごろだった？",
          reason: "実際の睡眠リズムを確認するため",
        },
      ] as any,
      profileSectionsJson: [
        {
          category: "学習",
          status: "改善",
          highlights: [{ label: "長文読解", value: "文章構造の把握が速くなってきた", isUpdated: true }],
          nextQuestion: "うまく読めたときの手順をもう一度言葉にできる？",
        },
      ] as any,
      observationJson: [
        {
          sourceType: "INTERVIEW",
          category: "学習",
          statusDraft: "改善",
          insights: ["長文読解の安定感が上がってきた"],
          topics: ["英語長文", "睡眠リズム"],
          nextActions: ["読解の手順を短くメモする"],
          evidence: ["前より読みやすいです"],
          characterSignal: "伸びを実感できると行動が早い",
          weight: 0.9,
        },
      ] as any,
      formattedTranscript:
        "## 面談\n講師: 長文は前より止まりにくくなったね。\n生徒: 前より読みやすいです。\n講師: ただ寝る時間が遅い日はミスが増えるね。",
      qualityMetaJson: { seeded: true, modelFinal: "gpt-5.4", modelFast: "gpt-5-mini" } as any,
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
      title: "英語授業報告",
      sessionDate: new Date(lessonDate),
      heroStateLabel: "集中維持",
      heroOneLiner: "授業中の集中は高い。宿題の着手だけ整えたい。",
      latestSummary: "授業中の集中は安定しているが、宿題の着手がまだ重い。",
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
        rawTextOriginal: "宿題の長文は2本のうち1本まで進めた。",
        rawTextCleaned: "宿題の長文は2本のうち1本まで進めた。",
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
        rawTextOriginal: "授業中の集中は良好。宿題は開始時刻を決めて組み直した。",
        rawTextCleaned: "授業中の集中は良好。宿題は開始時刻を決めて組み直した。",
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
      rawTextOriginal: "宿題の長文は2本のうち1本まで進めた。\n\n授業中の集中は良好。宿題は開始時刻を決めて組み直した。",
      rawTextCleaned: "宿題の長文は2本のうち1本まで進めた。\n\n授業中の集中は良好。宿題は開始時刻を決めて組み直した。",
      rawSegments: [] as any,
      rawTextExpiresAt: plusDays(lessonDate, 30),
      summaryMarkdown:
        "## 授業で確認したこと\n授業中の集中は高く、説明への反応も安定していた。\n\n## 講師の見立て\n課題は量ではなく、宿題に着手する最初の一歩が重いこと。\n\n## 次回までに進めること\n負荷は増やさず、開始時刻を固定して着手のハードルを下げる。",
      timelineJson: [] as any,
      nextActionsJson: [
        {
          owner: "STUDENT",
          action: "日曜の長文は20時に着手する",
          due: "次回授業まで",
          metric: "開始時刻を守れた日数",
          why: "宿題の着手負荷を下げるため",
        },
      ] as any,
      profileDeltaJson: { basic: [], personal: [] } as any,
      parentPackJson: { monthlyChange: "授業中の集中は安定している", focus: "宿題開始の習慣化" } as any,
      studentStateJson: {
        label: "集中維持",
        oneLiner: "授業中の集中は高い。宿題の着手だけ整えたい。",
        rationale: ["授業中の集中は安定している", "宿題開始の摩擦が残っている"],
        confidence: 80,
      } as any,
      topicSuggestionsJson: [] as any,
      quickQuestionsJson: [] as any,
      profileSectionsJson: [] as any,
      observationJson: [] as any,
      lessonReportJson: {
        todayGoal: "復習確認と長文1本の演習",
        covered: ["前回内容の確認テスト", "長文1本の演習"],
        blockers: ["宿題に着手するまでが重い"],
        homework: ["長文1本", "単語チェック"],
        nextLessonFocus: ["読解手順の再現", "宿題開始時刻の固定"],
      } as any,
      formattedTranscript:
        "## チェックイン\n宿題の長文は2本のうち1本まで進めた。\n\n## チェックアウト\n授業中の集中は良好。宿題は開始時刻を決めて組み直した。",
      qualityMetaJson: { seeded: true, modelFinal: "gpt-5.4", modelFast: "gpt-5-mini" } as any,
      createdAt: new Date(lessonDate),
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
      sourceLogIds: ["conversation-demo-1-interview", "conversation-demo-1-lesson"] as any,
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
      timelineJson: [] as any,
      nextActionsJson: [
        {
          owner: "STUDENT",
          action: "難問では解き始める前に条件・図・最初の式を3行で書く",
          due: "次回授業まで",
          metric: "3問で実行",
          why: "最初の一手で止まる時間を減らすため",
        },
      ] as any,
      profileDeltaJson: { basic: [], personal: [] } as any,
      parentPackJson: { monthlyChange: "数学の粘り強さが安定している", focus: "最初の一手の型づくり" } as any,
      studentStateJson: {
        label: "思考安定",
        oneLiner: "数学の粘りはある。最初の一手に型を持たせたい。",
        rationale: ["手順は丁寧に書けている", "最初の一手だけ止まりやすい"],
        confidence: 84,
      } as any,
      topicSuggestionsJson: [] as any,
      quickQuestionsJson: [] as any,
      profileSectionsJson: [] as any,
      observationJson: [] as any,
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
