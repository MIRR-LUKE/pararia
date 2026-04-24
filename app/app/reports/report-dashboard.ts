import {
  deriveReportDeliveryState,
  reportDeliveryStateLabel,
  reportStatusLabel,
  type ReportDeliveryState,
} from "@/lib/report-delivery";
import type { StudentListRow } from "@/lib/students/list-student-rows";

export type FilterKey = "all" | "uncreated" | "review" | "share" | "sent" | "manual" | "delayed";

type SessionSummary = NonNullable<StudentListRow["sessions"]>[number];
type ReportSummary = NonNullable<StudentListRow["reports"]>[number];

type BadgeTone = "neutral" | "low" | "medium" | "high";

export type ReportCardRow = {
  id: string;
  name: string;
  grade?: string | null;
  workflowLabel: string;
  deliveryLabel: string;
  tone: BadgeTone;
  secondaryTone: BadgeTone;
  oneLiner: string;
  updatedLabel: string;
  sessionLabel: string;
  isUncreated: boolean;
  isReview: boolean;
  isShare: boolean;
  isSent: boolean;
  isManual: boolean;
  isDelayedShare: boolean;
};

export type QueueItem = {
  id: string;
  name: string;
  grade: string | null | undefined;
  label: string;
  description: string;
  href: string;
  cta: string;
  tone: BadgeTone;
  latestDeliveryLabel: string;
  updatedLabel: string;
  priority: number;
  isDelayedShare: boolean;
};

export type ReportCounts = {
  uncreated: number;
  review: number;
  share: number;
  sent: number;
  manual: number;
  delayed: number;
  failedBounced: number;
  processing: number;
};

export type ReportDashboardData = {
  rows: ReportCardRow[];
  queue: QueueItem[];
  delayedQueue: QueueItem[];
  counts: ReportCounts;
};

export function normalizeFilter(value?: string): FilterKey {
  if (value === "uncreated") return "uncreated";
  if (value === "review") return "review";
  if (value === "share") return "share";
  if (value === "sent") return "sent";
  if (value === "manual") return "manual";
  if (value === "delayed") return "delayed";
  return "all";
}

export function buildFilterHref(filter: FilterKey) {
  return filter === "all" ? "/app/reports" : `/app/reports?filter=${filter}`;
}

export function buildPageHref(filter: FilterKey, page: number) {
  const normalizedPage = Math.max(1, Math.floor(page));
  const filterHref = buildFilterHref(filter);
  return normalizedPage === 1 ? filterHref : `${filterHref}${filterHref.includes("?") ? "&" : "?"}page=${normalizedPage}`;
}

export function normalizePage(value?: string) {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function hoursSince(value?: string | null) {
  if (!value) return null;
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return null;
  return diff / (60 * 60 * 1000);
}

function formatRelativeLabel(value?: string | null) {
  if (!value) return "未更新";
  const hours = hoursSince(value);
  if (hours === null) return "未更新";
  if (hours < 1) return "1時間未満";
  if (hours < 24) return `${Math.max(1, Math.round(hours))}時間前`;
  return `${Math.max(1, Math.round(hours / 24))}日前`;
}

function latestReportState(report?: ReportSummary | null) {
  if (!report) return "none";
  return deriveReportDeliveryState(report);
}

function toneForState(state: ReportDeliveryState | "none"): BadgeTone {
  if (state === "none") return "neutral";
  if (state === "sent" || state === "delivered" || state === "resent") return "low";
  if (state === "draft" || state === "reviewed") return "medium";
  return "high";
}

function isDelayed(report?: ReportSummary | null) {
  if (!report) return false;
  const state = latestReportState(report);
  if (state === "sent" || state === "manual_shared" || state === "delivered" || state === "resent") {
    return false;
  }
  const anchor = report.reviewedAt ?? report.createdAt;
  const hours = hoursSince(anchor);
  return typeof hours === "number" && hours >= 24;
}

function workflowLabel(report?: ReportSummary | null) {
  if (!report) return "未生成";
  return reportStatusLabel(report.status);
}

function deliveryLabel(report?: ReportSummary | null) {
  if (!report) return "未生成";
  const state = latestReportState(report);
  if (state === "none") return "未生成";
  if (state === "manual_shared") return "手動共有";
  if (state === "failed" || state === "bounced") return reportDeliveryStateLabel(state);
  if (state === "sent" || state === "delivered" || state === "resent") {
    return report.deliveryChannel === "manual" ? "手動共有" : reportDeliveryStateLabel(state);
  }
  if (report.status === "DRAFT") return "レビュー待ち";
  if (report.status === "REVIEWED") return "共有待ち";
  return reportStatusLabel(report.status);
}

function sessionLabel(session?: SessionSummary | null) {
  if (!session) return "会話ログなし";
  return "面談";
}

function latestInterviewSession(student: StudentListRow) {
  return student.sessions?.find((session) => session.type === "INTERVIEW") ?? null;
}

function sourceText(student: StudentListRow) {
  const session = latestInterviewSession(student);
  return session?.heroOneLiner ?? session?.latestSummary ?? "まだ会話要約はありません。ログを生成するとここに要点が出ます。";
}

function reportRank(row: ReportCardRow) {
  if (row.isDelayedShare) return 0;
  if (row.isUncreated) return 1;
  if (row.isReview) return 2;
  if (row.isShare) return 3;
  if (row.isManual) return 4;
  if (row.isSent) return 5;
  return 6;
}

function queueRank(item: QueueItem) {
  return item.priority;
}

function buildReportRow(student: StudentListRow): ReportCardRow {
  const latestReport = student.reports?.[0] ?? null;
  const latestSession = latestInterviewSession(student);
  const hasConversation = Boolean(latestSession?.conversation?.id);
  const state = latestReportState(latestReport);
  const workflow = workflowLabel(latestReport);
  const delivery = deliveryLabel(latestReport);

  const isUncreated = hasConversation && !latestReport;
  const isReview = latestReport?.status === "DRAFT";
  const isShare = latestReport?.status === "REVIEWED";
  const isSent = state === "sent" || state === "delivered" || state === "resent";
  const isManual = state === "manual_shared" || (isSent && latestReport?.deliveryChannel === "manual");
  const isDelayedShare = isDelayed(latestReport);

  const sourceAnchor = latestReport?.reviewedAt ?? latestReport?.createdAt ?? latestSession?.sessionDate ?? null;

  return {
    id: student.id,
    name: student.name,
    grade: student.grade,
    workflowLabel: workflow,
    deliveryLabel: delivery,
    tone: toneForState(state),
    secondaryTone: toneForState(state),
    oneLiner: sourceText(student),
    updatedLabel: formatRelativeLabel(sourceAnchor),
    sessionLabel: sessionLabel(latestSession),
    isUncreated,
    isReview,
    isShare,
    isSent,
    isManual,
    isDelayedShare,
  };
}

function buildQueueItem(student: StudentListRow): QueueItem | null {
  const latestReport = student.reports?.[0] ?? null;
  const latestSession = latestInterviewSession(student);
  const hasConversation = Boolean(latestSession?.conversation?.id);
  const needsReport = hasConversation && !latestReport;
  const needsReview = latestReport?.status === "DRAFT";
  const needsShare = latestReport?.status === "REVIEWED";
  const isDelayedShare = isDelayed(latestReport);

  if (!latestSession || (!needsReport && !needsReview && !needsShare)) {
    return null;
  }

  const updatedSource = latestReport?.reviewedAt ?? latestReport?.createdAt ?? latestSession.sessionDate ?? null;

  return {
    id: student.id,
    name: student.name,
    grade: student.grade,
    label: needsReport ? "レポート未作成" : needsReview ? "レビュー待ち" : "共有待ち",
    description: needsReport
      ? "面談ログがあるので、この生徒はまず保護者レポート生成が必要です。"
      : needsReview
        ? "レポート本文を確認して、共有前の最終チェックに進めます。"
        : "共有待ちのレポートがあります。送信前の確認だけで進められます。",
    href: `/app/students/${student.id}?panel=report`,
    cta: needsReport ? "レポートを作る" : "共有を確認する",
    tone: isDelayedShare ? "high" : needsReport ? "high" : needsReview ? "medium" : "low",
    latestDeliveryLabel: deliveryLabel(latestReport),
    updatedLabel: formatRelativeLabel(updatedSource),
    priority: isDelayedShare ? 0 : needsReport ? 1 : needsReview ? 2 : 3,
    isDelayedShare,
  };
}

export type PaginationWindow = {
  page: number;
  pageSize: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  visibleCount: number;
};

export function buildPaginationWindow(totalItems: number, page: number, pageSize: number): PaginationWindow {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalItems) / safePageSize));
  const normalizedPage = Math.min(Math.max(1, Math.floor(page)), totalPages);
  const startIndex = (normalizedPage - 1) * safePageSize;
  const endIndex = Math.min(totalItems, startIndex + safePageSize);
  return {
    page: normalizedPage,
    pageSize: safePageSize,
    totalPages,
    startIndex,
    endIndex,
    visibleCount: Math.max(0, endIndex - startIndex),
  };
}

export function buildReportDashboardData(
  students: StudentListRow[],
  filter: FilterKey
): ReportDashboardData {
  const rows = students
    .map((student) => buildReportRow(student))
    .filter((student) => {
      if (filter === "all") return true;
      if (filter === "uncreated") return student.isUncreated;
      if (filter === "review") return student.isReview;
      if (filter === "share") return student.isShare;
      if (filter === "sent") return student.isSent && !student.isManual;
      if (filter === "manual") return student.isManual;
      if (filter === "delayed") return student.isDelayedShare;
      return true;
    })
    .sort((left, right) => reportRank(left) - reportRank(right) || left.name.localeCompare(right.name, "ja"));

  const queue = students
    .map((student) => buildQueueItem(student))
    .filter((item): item is QueueItem => item !== null)
    .sort((left, right) => queueRank(left) - queueRank(right) || left.name.localeCompare(right.name, "ja"));

  const delayedQueue = queue.filter((item) => item.isDelayedShare);

  const counts: ReportCounts = {
    uncreated: students.filter((student) => Boolean(latestInterviewSession(student)?.conversation?.id) && !student.reports?.[0]).length,
    // Keep dashboard interview-only even while old lesson data still exists in the database.
    review: students.filter((student) => student.reports?.[0]?.status === "DRAFT").length,
    share: students.filter((student) => student.reports?.[0]?.status === "REVIEWED").length,
    sent: students.filter((student) => {
      const report = student.reports?.[0];
      return Boolean(report) && ["sent", "delivered", "resent"].includes(latestReportState(report));
    }).length,
    manual: students.filter((student) => latestReportState(student.reports?.[0]) === "manual_shared").length,
    delayed: students.filter((student) => isDelayed(student.reports?.[0] ?? null)).length,
    failedBounced: students.filter((student) => {
      const report = student.reports?.[0];
      if (!report) return false;
      const state = latestReportState(report);
      return state === "failed" || state === "bounced";
    }).length,
    processing: queue.length,
  };

  return {
    rows,
    queue,
    delayedQueue,
    counts,
  };
}
