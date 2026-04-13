import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import {
  buildReportDeliverySummary,
  deriveReportDeliveryState,
  reportDeliveryStateLabel,
} from "@/lib/report-delivery";
import { listStudentRows, type StudentListRow } from "@/lib/students/list-student-rows";

export type DashboardQueueKind = "interview" | "report" | "review" | "share" | "room";

export type DashboardQueueItem = {
  kind: DashboardQueueKind;
  title: string;
  reason: string;
  cta: string;
  href: string;
  score: number;
};

export type DashboardStudentRow = {
  id: string;
  name: string;
  grade?: string | null;
  state: string;
  oneLiner: string;
  queue: DashboardQueueItem;
  recordingLock?: { mode: string; lockedByName: string } | null;
};

export type DashboardStats = {
  reportUncreated: number;
  reviewWait: number;
  shareWait: number;
  sent: number;
  manualShare: number;
  delivered: number;
  resent: number;
  failedBounced: number;
  averageTimeToShareHours: number | null;
  measuredShares: number;
};

export type DashboardSnapshot = {
  queue: DashboardStudentRow[];
  stats: DashboardStats;
  totalStudents: number;
  candidateCount: number;
  averageProfileCompleteness: number;
};

type DashboardReportSummary = NonNullable<StudentListRow["reports"]>[number];

type DashboardSnapshotOptions = {
  organizationId: string;
  candidateLimit?: number;
  queueLimit?: number;
};

type DashboardSnapshotBase = {
  queue: DashboardStudentRow[];
  stats: DashboardStats;
  totalStudents: number;
  candidateCount: number;
  averageProfileCompleteness: number;
};

function toDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function diffHours(start?: string | null, end?: string | null) {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!startDate || !endDate) return null;
  const diffMs = endDate.getTime() - startDate.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return diffMs / (60 * 60 * 1000);
}

function latestReportSummary(report?: DashboardReportSummary | null) {
  if (!report) return null;
  return buildReportDeliverySummary(report);
}

export function reportStateLabel(report?: DashboardReportSummary | null) {
  if (!report) return "保護者レポート未生成";
  const summary = latestReportSummary(report);
  if (summary) return reportDeliveryStateLabel(summary.deliveryState);
  const deliveryState = deriveReportDeliveryState(report);
  return reportDeliveryStateLabel(deliveryState);
}

export function summarizeDashboardStudent(student: StudentListRow): DashboardStudentRow {
  const latestSession = student.sessions?.[0];
  const latestReport = student.reports?.[0] ?? null;
  const latestReportSummary = latestReport ? buildReportDeliverySummary(latestReport) : null;

  if (!latestSession) {
    return {
      id: student.id,
      name: student.name,
      grade: student.grade,
      state: "未開始",
      oneLiner: "まだ会話データがありません。最初の面談から始めます。",
      queue: {
        kind: "interview",
        title: "面談を始める",
        reason: "この生徒にはまだ会話ログがありません。",
        cta: "面談を始める",
        href: `/app/students/${student.id}?panel=recording&mode=INTERVIEW`,
        score: 100,
      },
    };
  }

  if (latestSession.conversation?.id && !latestReport) {
    return {
      id: student.id,
      name: student.name,
      grade: student.grade,
      state: latestSession.heroStateLabel ?? "レポート作成待ち",
      oneLiner:
        latestSession.heroOneLiner ??
        latestSession.latestSummary ??
        "ログは生成済みです。必要なログを選んで保護者レポートを作成できます。",
      queue: {
        kind: "report",
        title: "レポートを作る",
        reason: "会話ログはそろっています。保護者レポートをまだ作っていません。",
        cta: "ログを選ぶ",
        href: `/app/students/${student.id}?panel=report`,
        score: 88,
      },
    };
  }

  if (latestReportSummary?.deliveryState === "draft") {
    return {
      id: student.id,
      name: student.name,
      grade: student.grade,
      state: latestReportSummary.deliveryStateLabel,
      oneLiner:
        latestSession.heroOneLiner ??
        latestSession.latestSummary ??
        "保護者レポートは下書き済みです。確認して共有まで進められます。",
      queue: {
        kind: "review",
        title: "レビュー待ち",
        reason: "保護者レポートは下書き済みです。確認して送付前に整えます。",
        cta: "レポートを開く",
        href: `/app/students/${student.id}?panel=report`,
        score: 86,
      },
    };
  }

  if (latestReportSummary?.deliveryState === "reviewed") {
    return {
      id: student.id,
      name: student.name,
      grade: student.grade,
      state: latestReportSummary.deliveryStateLabel,
      oneLiner:
        latestSession.heroOneLiner ?? latestSession.latestSummary ?? "保護者レポートは確認済みです。共有に進めます。",
      queue: {
        kind: "share",
        title: "共有待ち",
        reason: "保護者レポートは確認済みです。送信または手動共有を完了します。",
        cta: "共有を進める",
        href: `/app/students/${student.id}?panel=report`,
        score: 84,
      },
    };
  }

  if (latestReportSummary && ["failed", "bounced"].includes(latestReportSummary.deliveryState)) {
    return {
      id: student.id,
      name: student.name,
      grade: student.grade,
      state: latestReportSummary.deliveryStateLabel,
      oneLiner: "送信に失敗しています。再送または手動共有を確認してください。",
      queue: {
        kind: "share",
        title: "再送を確認",
        reason: "failed / bounced の履歴があります。送信方法を見直します。",
        cta: "共有を見直す",
        href: `/app/students/${student.id}?panel=report`,
        score: 88,
      },
    };
  }

  if (
    latestReportSummary &&
    ["sent", "delivered", "resent", "manual_shared"].includes(latestReportSummary.deliveryState)
  ) {
    return {
      id: student.id,
      name: student.name,
      grade: student.grade,
      state: latestReportSummary.deliveryStateLabel,
      oneLiner:
        latestSession.heroOneLiner ??
        latestSession.latestSummary ??
        "保護者共有は完了しています。履歴と次の会話に進めます。",
      queue: {
        kind: "room",
        title: "送付済みを確認",
        reason: "送付後の履歴と次の会話を確認できます。",
        cta: "レポートを見る",
        href: `/app/students/${student.id}`,
        score: 40,
      },
    };
  }

  return {
    id: student.id,
    name: student.name,
    grade: student.grade,
    state: latestSession.heroStateLabel ?? "更新済み",
    oneLiner:
      latestSession.heroOneLiner ?? latestSession.latestSummary ?? "次の会話に向けて確認内容が整理されています。",
    queue: {
      kind: "room",
      title: "次の会話を見る",
      reason: "次の会話に向けた質問と行動を確認できます。",
      cta: "生徒ルームへ",
      href: `/app/students/${student.id}`,
      score: 40,
    },
  };
}

function buildDashboardStats(students: StudentListRow[]): DashboardStats {
  const reportUncreated = students.filter((item) => Boolean(item.sessions?.[0]?.conversation?.id) && !item.reports?.[0]).length;
  const reviewWait = students.filter(
    (item) => latestReportSummary(item.reports?.[0] ?? null)?.deliveryState === "draft"
  ).length;
  const shareWait = students.filter(
    (item) => latestReportSummary(item.reports?.[0] ?? null)?.deliveryState === "reviewed"
  ).length;
  const sent = students.filter((item) => {
    const state = latestReportSummary(item.reports?.[0] ?? null)?.deliveryState;
    return state === "sent" || state === "delivered" || state === "resent" || state === "manual_shared";
  }).length;
  const manualShare = students.filter(
    (item) => latestReportSummary(item.reports?.[0] ?? null)?.deliveryState === "manual_shared"
  ).length;
  const delivered = students.filter(
    (item) => latestReportSummary(item.reports?.[0] ?? null)?.deliveryState === "delivered"
  ).length;
  const resent = students.filter(
    (item) => latestReportSummary(item.reports?.[0] ?? null)?.deliveryState === "resent"
  ).length;
  const failedBounced = students.filter((item) => {
    const state = latestReportSummary(item.reports?.[0] ?? null)?.deliveryState;
    return state === "failed" || state === "bounced";
  }).length;

  const shareDurations = students
    .map((item) => {
      const latestReport = item.reports?.[0] ?? null;
      const shareState = latestReportSummary(latestReport)?.deliveryState;
      if (!latestReport || !shareState || !["sent", "delivered", "resent", "manual_shared"].includes(shareState)) {
        return null;
      }
      return diffHours(latestReport.reviewedAt ?? latestReport.createdAt, latestReport.sentAt);
    })
    .filter((value): value is number => typeof value === "number");

  return {
    reportUncreated,
    reviewWait,
    shareWait,
    sent,
    manualShare,
    delivered,
    resent,
    failedBounced,
    averageTimeToShareHours:
      shareDurations.length > 0
        ? Number((shareDurations.reduce((sum, value) => sum + value, 0) / shareDurations.length).toFixed(1))
        : null,
    measuredShares: shareDurations.length,
  };
}

async function buildDashboardSnapshotBase(
  options: DashboardSnapshotOptions
): Promise<DashboardSnapshotBase> {
  const { organizationId, candidateLimit = 50, queueLimit = 8 } = options;
  const [students, totalStudents] = await Promise.all([
    listStudentRows({
      organizationId,
      limit: candidateLimit,
      projection: "dashboard",
    }),
    prisma.student.count({ where: { organizationId } }),
  ]);

  const enriched = students.map((student) => summarizeDashboardStudent(student));
  const queue = [...enriched].sort((a, b) => b.queue.score - a.queue.score).slice(0, queueLimit);
  const averageProfileCompleteness =
    students.length > 0
      ? Math.round(students.reduce((sum, item) => sum + item.profileCompleteness, 0) / Math.max(1, students.length))
      : 0;

  return {
    queue,
    stats: buildDashboardStats(students),
    totalStudents,
    candidateCount: enriched.length,
    averageProfileCompleteness,
  };
}

function getCachedDashboardSnapshotBase(options: DashboardSnapshotOptions) {
  const { organizationId, candidateLimit = 50, queueLimit = 8 } = options;
  return unstable_cache(
    () =>
      buildDashboardSnapshotBase({
        organizationId,
        candidateLimit,
        queueLimit,
      }),
    ["dashboard-snapshot", organizationId, String(candidateLimit), String(queueLimit)],
    {
      revalidate: 10,
      tags: [`dashboard-snapshot:${organizationId}`],
    }
  )();
}

async function getActiveRecordingLocks(studentIds: string[]) {
  if (studentIds.length === 0) return new Map<string, { mode: string; lockedByName: string }>();

  const activeLocks = await prisma.studentRecordingLock.findMany({
    where: {
      studentId: { in: studentIds },
      expiresAt: { gt: new Date() },
    },
    select: {
      studentId: true,
      mode: true,
      lockedBy: { select: { name: true } },
    },
  });

  return new Map(
    activeLocks.map((lock) => [
      lock.studentId,
      {
        mode: lock.mode,
        lockedByName: lock.lockedBy.name,
      },
    ])
  );
}

export async function getDashboardSnapshot(
  options: DashboardSnapshotOptions
): Promise<DashboardSnapshot> {
  const base = await getCachedDashboardSnapshotBase(options);
  const lockMap = await getActiveRecordingLocks(base.queue.map((item) => item.id));

  return {
    ...base,
    queue: base.queue.map((item) => ({
      ...item,
      recordingLock: lockMap.get(item.id) ?? null,
    })),
  };
}
