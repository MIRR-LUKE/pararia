import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import {
  deriveReportDeliveryState,
  reportDeliveryStateLabel,
  reportStatusLabel,
} from "@/lib/report-delivery";
import { getAppSession } from "@/lib/server/app-session";
import { getCachedStudentDirectory } from "@/lib/students/get-cached-student-directory";
import type { StudentListRow } from "@/lib/students/list-student-rows";
import styles from "./reportDashboard.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type FilterKey = "all" | "uncreated" | "review" | "share" | "sent" | "manual" | "delayed";
type SessionSummary = NonNullable<StudentListRow["sessions"]>[number];
type ReportSummary = NonNullable<StudentListRow["reports"]>[number];

type ReportCardRow = {
  id: string;
  name: string;
  grade?: string | null;
  latestSession: SessionSummary | null;
  latestReport: ReportSummary | null;
  statusLabel: string;
  sourceTraceLabel: string;
  sourceLogIds: string[];
  oneLiner: string;
  reportSourceCount: number;
  isUncreated: boolean;
  isReview: boolean;
  isShare: boolean;
  isSent: boolean;
  isManual: boolean;
  isDelayedShare: boolean;
};

type QueueItem = {
  id: string;
  name: string;
  grade: string | null | undefined;
  label: string;
  description: string;
  href: string;
  cta: string;
  isDelayedShare: boolean;
  reportSourceCount: number;
  sourceTraceLabel: string;
  latestDeliveryLabel: string;
  latestReport: ReportSummary | null;
};

function readQueryParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeFilter(value?: string): FilterKey {
  if (value === "uncreated") return "uncreated";
  if (value === "review") return "review";
  if (value === "share") return "share";
  if (value === "sent") return "sent";
  if (value === "manual") return "manual";
  if (value === "delayed") return "delayed";
  return "all";
}

function buildFilterHref(filter: FilterKey) {
  return filter === "all" ? "/app/reports" : `/app/reports?filter=${filter}`;
}

function hoursSince(value?: string | null) {
  if (!value) return null;
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return null;
  return diff / (60 * 60 * 1000);
}

function latestReportState(report?: ReportSummary | null) {
  if (!report) return "none";
  return deriveReportDeliveryState(report);
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

function reportTone(
  report?: ReportSummary | null
): "neutral" | "low" | "medium" | "high" {
  if (!report) return "medium";
  const state = latestReportState(report);
  if (state === "failed" || state === "bounced" || state === "manual_shared") return "high";
  if (state === "sent" || state === "delivered" || state === "resent") return "low";
  if (state === "reviewed") return "medium";
  return "high";
}

function reportPresentationLabel(
  report?: ReportSummary | null
) {
  if (!report) return "未作成";
  const state = latestReportState(report);
  if (state === "none") return "未作成";
  if (state === "manual_shared") return "手動共有";
  if (state === "failed" || state === "bounced") return reportDeliveryStateLabel(state);
  if (state === "sent" || state === "delivered" || state === "resent") {
    return report.deliveryChannel === "manual" ? "手動共有" : reportDeliveryStateLabel(state);
  }
  if (report.status === "DRAFT") return "レビュー待ち";
  if (report.status === "REVIEWED") return "共有待ち";
  return reportStatusLabel(report.status);
}

function traceLabel(sourceLogIds?: string[] | null) {
  if (!sourceLogIds || sourceLogIds.length === 0) return "まだ source trace はありません。";
  return `${sourceLogIds.length} 件のログを選択`;
}

function buildSourceTraceSummary(sourceLogIds?: string[] | null) {
  if (!sourceLogIds || sourceLogIds.length === 0) return "まだ sourceLogIds はありません。";
  return sourceLogIds.slice(0, 3).join(" / ");
}

export default async function ReportDashboardPage({
  searchParams,
}: {
  searchParams?: { filter?: string | string[] };
}) {
  const session = await getAppSession();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const filter = normalizeFilter(readQueryParam(searchParams?.filter));
  const students = await getCachedStudentDirectory({
    organizationId,
    limit: 200,
  });

  const rows = students
    .map((student) => {
      const latestReport = student.reports?.[0] ?? null;
      const latestSession = student.sessions?.[0] ?? null;
      const hasConversation = Boolean(latestSession?.conversation?.id);
      const sourceLogIds = latestReport?.sourceLogIds ?? [];
      const reportState = latestReportState(latestReport);
      const isUncreated = hasConversation && !latestReport;
      const isReview = latestReport?.status === "DRAFT";
      const isShare = latestReport?.status === "REVIEWED";
      const isSent = reportState === "sent" || reportState === "delivered" || reportState === "resent";
      const isManual = reportState === "manual_shared" || (isSent && latestReport?.deliveryChannel === "manual");
      const isDelayedShare = isDelayed(latestReport);

      return {
        id: student.id,
        name: student.name,
        grade: student.grade,
        latestSession,
        latestReport,
        statusLabel: reportPresentationLabel(latestReport),
        sourceTraceLabel: traceLabel(sourceLogIds),
        sourceLogIds,
        oneLiner:
          latestSession?.heroOneLiner ??
          latestSession?.latestSummary ??
          "まだ会話要約はありません。ログを生成するとここに要点が出ます。",
        reportSourceCount: sourceLogIds.length,
        isUncreated,
        isReview,
        isShare,
        isSent,
        isManual,
        isDelayedShare,
      } satisfies ReportCardRow;
    })
    .filter((student) => {
      if (filter === "all") return true;
      if (filter === "uncreated") return student.isUncreated;
      if (filter === "review") return student.isReview;
      if (filter === "share") return student.isShare;
      if (filter === "sent") return student.isSent && !student.isManual;
      if (filter === "manual") return student.isManual;
      if (filter === "delayed") return student.isDelayedShare;
      return true;
    });

  const queue = students
    .map((student) => {
      const latestReport = student.reports?.[0] ?? null;
      const latestSession = student.sessions?.[0] ?? null;
      const hasConversation = Boolean(latestSession?.conversation?.id);
      const needsCheckout = latestSession?.type === "LESSON_REPORT" && latestSession.status === "COLLECTING";
      const needsReport = hasConversation && !latestReport;
      const needsReview = latestReport?.status === "DRAFT";
      const needsShare = latestReport?.status === "REVIEWED";

      if (!latestSession || (!needsCheckout && !needsReport && !needsReview && !needsShare)) {
        return null;
      }

      return {
        id: student.id,
        name: student.name,
        grade: student.grade,
        label: needsCheckout
          ? "チェックアウト待ち"
          : needsReport
            ? "レポート未作成"
            : needsReview
              ? "レビュー待ち"
              : "共有待ち",
        description: needsCheckout
          ? "録音を閉じてからレポート生成に進むと、次の処理に流せます。"
          : needsReport
            ? "会話ログがあるので、この生徒はまずレポート生成が必要です。"
            : needsReview
              ? "レポート本文を確認して、共有前の最終チェックに進めます。"
              : "共有待ちのレポートがあります。送信前の確認だけで進められます。",
        href: needsCheckout
          ? `/app/students/${student.id}?panel=recording&mode=LESSON_REPORT&part=CHECK_OUT`
          : `/app/students/${student.id}?panel=report`,
        cta: needsCheckout ? "チェックアウトする" : needsReport ? "ログを生成する" : "共有を確認する",
        isDelayedShare: isDelayed(latestReport),
        reportSourceCount: latestReport?.sourceLogIds?.length ?? 0,
        sourceTraceLabel: traceLabel(latestReport?.sourceLogIds ?? null),
        latestDeliveryLabel: reportPresentationLabel(latestReport),
        latestReport,
      } satisfies QueueItem;
    })
    .filter((item): item is QueueItem => item !== null);

  const delayedQueue = queue.filter((item) => item.isDelayedShare);

  const counts = {
    uncreated: students.filter((student) => Boolean(student.sessions?.[0]?.conversation?.id) && !student.reports?.[0]).length,
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
  };

  return (
    <div className={styles.page}>
      <AppHeader
        title="保護者レポート"
        subtitle="ここは配信の一覧ではなく、レビュー待ち・共有待ち・送信済み・手動共有・遅延を一望する補助面です。"
        viewerName={session.user.name ?? null}
        viewerRole={(session.user as { role?: string | null }).role ?? null}
      />

      <section className={styles.summaryRow}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>レポート未作成</span>
          <strong>{counts.uncreated}</strong>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>レビュー待ち</span>
          <strong>{counts.review}</strong>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>共有待ち</span>
          <strong>{counts.share}</strong>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>送信済み</span>
          <strong>{counts.sent}</strong>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>手動共有</span>
          <strong>{counts.manual}</strong>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>遅延 / 失敗</span>
          <strong>{counts.delayed + counts.failedBounced}</strong>
        </div>
      </section>

      <section className={styles.filterRow}>
        {[
          { key: "all", label: "すべて" },
          { key: "uncreated", label: "未作成" },
          { key: "review", label: "レビュー待ち" },
          { key: "share", label: "共有待ち" },
          { key: "sent", label: "送信済み" },
          { key: "manual", label: "手動共有" },
          { key: "delayed", label: "遅延" },
        ].map((item) => (
          <Link
            key={item.key}
            href={buildFilterHref(item.key as FilterKey)}
            className={filter === item.key ? styles.filterChipActive : styles.filterChip}
          >
            {item.label}
          </Link>
        ))}
      </section>

      <Card
        title="保護者レポート一覧"
        subtitle="レポートの状態と source trace を並べて、Student Room へすぐ戻れるようにしています。"
      >
        {rows.length === 0 ? (
          <div className={styles.empty}>この条件に合うレポートはありません。</div>
        ) : (
          <div className={styles.grid}>
            {rows.map((student, index) => (
              <Link
                key={student.id}
                href={`/app/students/${student.id}?panel=report`}
                className={styles.linkCard}
                prefetch={index < 4}
              >
                <div className={styles.cardHeader}>
                  <div>
                    <div className={styles.name}>{student.name}</div>
                    <div className={styles.meta}>{student.grade ?? "学年未設定"}</div>
                  </div>
                  <Badge label={student.statusLabel} tone={reportTone(student.latestReport)} />
                </div>

                <p className={styles.oneLiner}>{student.oneLiner}</p>

                <div className={styles.metricGrid}>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>ログ数</span>
                    <strong>{student.reportSourceCount} 件</strong>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>共有状態</span>
                    <strong>{student.latestReport ? reportPresentationLabel(student.latestReport) : "未作成"}</strong>
                  </div>
                </div>

                <div className={styles.traceBox}>
                  <span className={styles.metricLabel}>source trace</span>
                  <p className={styles.traceSummary}>{student.sourceTraceLabel}</p>
                  <p className={styles.traceMeta}>{buildSourceTraceSummary(student.sourceLogIds)}</p>
                </div>

                <div className={styles.footer}>
                  <span className={styles.footerLabel}>Student Room で確認する</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card title="共有遅延キュー" subtitle="24時間以上止まっているものだけを、最初に拾えるようにしています。">
        {delayedQueue.length === 0 ? (
          <div className={styles.empty}>遅延中のレポートはありません。</div>
        ) : (
          <div className={styles.grid}>
            {delayedQueue.map((item, index) => (
              <Link key={item.id} href={item.href} className={styles.linkCard} prefetch={index < 4}>
                <div className={styles.cardHeader}>
                  <div>
                    <div className={styles.name}>{item.name}</div>
                    <div className={styles.meta}>{item.grade ?? "学年未設定"}</div>
                  </div>
                  <Badge label={item.label} tone="high" />
                </div>

                <p className={styles.oneLiner}>{item.description}</p>

                <div className={styles.metricGrid}>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>最新状態</span>
                    <strong>{item.latestReport ? item.latestDeliveryLabel : "未作成"}</strong>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>source trace</span>
                    <strong>{item.reportSourceCount} 件</strong>
                  </div>
                </div>

                <div className={styles.traceBox}>
                  <span className={styles.metricLabel}>source trace</span>
                  <p className={styles.traceSummary}>{item.sourceTraceLabel}</p>
                </div>

                <div className={styles.footer}>
                  <span className={styles.footerLabel}>{item.cta}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
