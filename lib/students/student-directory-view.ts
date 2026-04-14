import { buildReportDeliverySummary } from "@/lib/report-delivery";
import type { StudentListRow } from "@/lib/students/list-student-rows";

export type StudentDirectoryViewKey = "all" | "interview" | "report" | "review" | "share" | "sent";

export type StudentDirectoryViewRow = {
  id: string;
  name: string;
  createdAt: string;
  nameKana?: string | null;
  grade?: string | null;
  course?: string | null;
  guardianNames?: string | null;
  profileCompleteness: number;
  sessionCount: number;
  reportCount: number;
  state: string;
  oneLiner: string;
  nextAction: string;
  viewKey: StudentDirectoryViewKey;
  href: string;
};

type DirectorySessionSummary = NonNullable<StudentListRow["sessions"]>[number];

function computeProfileCompleteness(profileData?: any) {
  const basic = Array.isArray(profileData?.basic) ? profileData.basic.length : 0;
  const personal = Array.isArray(profileData?.personal) ? profileData.personal.length : 0;
  return Math.min(100, (basic + personal) * 6);
}

function isEmptyInterviewDraft(session?: DirectorySessionSummary) {
  if (!session) return false;
  return (
    session.type === "INTERVIEW" &&
    session.status === "DRAFT" &&
    !session.conversation?.id &&
    (session.parts?.length ?? 0) === 0
  );
}

function summarize(student: StudentListRow) {
  const latestSession = student.sessions?.find((session) => !isEmptyInterviewDraft(session));
  const latestReport = student.reports?.[0] ?? null;
  const latestReportSummary = latestReport ? buildReportDeliverySummary(latestReport) : null;

  if (!latestSession) {
    return {
      state: "未開始",
      oneLiner: "まだ会話データがありません。最初の面談から始められる状態です。",
      nextAction: "最初の面談を始める",
      viewKey: "interview" as const,
    };
  }

  if (latestSession.type === "INTERVIEW" && !latestSession.conversation?.id) {
    return {
      state: latestSession.heroStateLabel ?? "面談準備中",
      oneLiner:
        latestSession.heroOneLiner ??
        latestSession.latestSummary ??
        "面談の準備を進めています。詳細から続きの状態を確認できます。",
      nextAction: "生徒詳細を開く",
      viewKey: "interview" as const,
    };
  }

  if (latestSession.conversation?.id && !latestReport) {
    return {
      state: latestSession.heroStateLabel ?? "レポート作成待ち",
      oneLiner:
        latestSession.heroOneLiner ??
        latestSession.latestSummary ??
        "ログは生成済みです。必要なログを選んで保護者レポートを作れます。",
      nextAction: "ログを選んでレポートを作る",
      viewKey: "report" as const,
    };
  }

  if (latestReportSummary?.deliveryState === "draft") {
    return {
      state: latestReportSummary.deliveryStateLabel,
      oneLiner:
        latestSession.heroOneLiner ??
        latestSession.latestSummary ??
        "保護者レポートの確認と共有がまだ残っています。",
      nextAction: "レポートを開く",
      viewKey: "review" as const,
    };
  }

  if (latestReportSummary?.deliveryState === "reviewed") {
    return {
      state: latestReportSummary.deliveryStateLabel,
      oneLiner: latestSession.heroOneLiner ?? latestSession.latestSummary ?? "保護者レポートは共有待ちです。",
      nextAction: "共有を完了する",
      viewKey: "share" as const,
    };
  }

  if (latestReportSummary && ["failed", "bounced"].includes(latestReportSummary.deliveryState)) {
    return {
      state: latestReportSummary.deliveryStateLabel,
      oneLiner: latestSession.heroOneLiner ?? latestSession.latestSummary ?? "保護者共有に失敗しています。再送が必要です。",
      nextAction: "再送を確認",
      viewKey: "share" as const,
    };
  }

  if (
    latestReportSummary &&
    ["sent", "delivered", "resent", "manual_shared"].includes(latestReportSummary.deliveryState)
  ) {
    return {
      state: latestReportSummary.deliveryStateLabel,
      oneLiner: latestSession.heroOneLiner ?? latestSession.latestSummary ?? "保護者共有は完了しています。",
      nextAction: "生徒詳細を開く",
      viewKey: "sent" as const,
    };
  }

  return {
    state: latestSession.heroStateLabel ?? "更新済み",
    oneLiner: latestSession.heroOneLiner ?? latestSession.latestSummary ?? "次の会話に向けた材料が揃っています。",
    nextAction: "生徒詳細を開く",
    viewKey: "all" as const,
  };
}

function toCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function mapStudentDirectoryRow(student: StudentListRow): StudentDirectoryViewRow {
  const summary = summarize(student);
  return {
    id: student.id,
    name: student.name,
    createdAt: student.createdAt,
    nameKana: student.nameKana,
    grade: student.grade,
    course: student.course,
    guardianNames: student.guardianNames,
    profileCompleteness: computeProfileCompleteness(student.profiles?.[0]?.profileData),
    sessionCount: toCount(student._count?.sessions),
    reportCount: toCount(student._count?.reports),
    state: summary.state,
    oneLiner: summary.oneLiner,
    nextAction: summary.nextAction,
    viewKey: summary.viewKey,
    href: `/app/students/${student.id}`,
  };
}

export function mapStudentDirectoryRows(students: StudentListRow[]): StudentDirectoryViewRow[] {
  return students.map(mapStudentDirectoryRow);
}

export type StudentDirectoryViewSummary = ReturnType<typeof summarize>;
