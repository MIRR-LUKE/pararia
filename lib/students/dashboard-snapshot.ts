import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { deriveReportDeliveryState, reportDeliveryStateLabel } from "@/lib/report-delivery";
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

type DashboardDeliveryState =
  | "draft"
  | "reviewed"
  | "sent"
  | "resent"
  | "delivered"
  | "failed"
  | "bounced"
  | "manual_shared";

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

function latestReportDeliveryState(report?: DashboardReportSummary | null) {
  if (!report) return null;
  const latestEvent = report.deliveryEvents?.[0]?.eventType;
  if (latestEvent) {
    switch (latestEvent) {
      case "REVIEWED":
        return "reviewed";
      case "SENT":
        return "sent";
      case "DELIVERED":
        return "delivered";
      case "FAILED":
        return "failed";
      case "BOUNCED":
        return "bounced";
      case "MANUAL_SHARED":
        return "manual_shared";
      case "RESENT":
        return "resent";
      default:
        return "draft";
    }
  }

  return deriveReportDeliveryState(report) as DashboardDeliveryState;
}

export function reportStateLabel(report?: DashboardReportSummary | null) {
  if (!report) return "保護者レポート未生成";
  const summary = latestReportDeliveryState(report);
  return reportDeliveryStateLabel(summary ?? deriveReportDeliveryState(report));
}

export function summarizeDashboardStudent(student: StudentListRow): DashboardStudentRow {
  const latestSession = student.sessions?.[0];
  const latestReport = student.reports?.[0] ?? null;
  const latestReportState = latestReport ? latestReportDeliveryState(latestReport) : null;

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

  if (latestReportState === "draft") {
    return {
      id: student.id,
      name: student.name,
      grade: student.grade,
      state: reportDeliveryStateLabel(latestReportState),
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

  if (latestReportState === "reviewed") {
    return {
      id: student.id,
      name: student.name,
      grade: student.grade,
      state: reportDeliveryStateLabel(latestReportState),
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

  if (latestReportState && ["failed", "bounced"].includes(latestReportState)) {
    return {
      id: student.id,
      name: student.name,
      grade: student.grade,
      state: reportDeliveryStateLabel(latestReportState),
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
    latestReportState &&
    ["sent", "delivered", "resent", "manual_shared"].includes(latestReportState)
  ) {
    return {
      id: student.id,
      name: student.name,
      grade: student.grade,
      state: reportDeliveryStateLabel(latestReportState),
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
  let reportUncreated = 0;
  let reviewWait = 0;
  let shareWait = 0;
  let sent = 0;
  let manualShare = 0;
  let delivered = 0;
  let resent = 0;
  let failedBounced = 0;
  const shareDurations: number[] = [];

  for (const item of students) {
    const latestSession = item.sessions?.[0];
    const latestReport = item.reports?.[0] ?? null;
    const state = latestReport ? latestReportDeliveryState(latestReport) : null;

    if (latestSession?.conversation?.id && !latestReport) {
      reportUncreated += 1;
      continue;
    }

    if (state === "draft") {
      reviewWait += 1;
      continue;
    }

    if (state === "reviewed") {
      shareWait += 1;
      continue;
    }

    if (state === "manual_shared") {
      sent += 1;
      manualShare += 1;
    } else if (state === "delivered") {
      sent += 1;
      delivered += 1;
    } else if (state === "resent") {
      sent += 1;
      resent += 1;
    } else if (state === "failed" || state === "bounced") {
      failedBounced += 1;
    } else if (state === "sent") {
      sent += 1;
    }

    if (latestReport && state && ["sent", "delivered", "resent", "manual_shared"].includes(state)) {
      const duration = diffHours(latestReport.reviewedAt ?? latestReport.createdAt, latestReport.sentAt);
      if (typeof duration === "number") shareDurations.push(duration);
    }
  }

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
      revalidate: 30,
      tags: [`dashboard-snapshot:${organizationId}`],
    }
  )();
}

export async function getDashboardSnapshot(
  options: DashboardSnapshotOptions
): Promise<DashboardSnapshot> {
  return getCachedDashboardSnapshotBase(options);
}
