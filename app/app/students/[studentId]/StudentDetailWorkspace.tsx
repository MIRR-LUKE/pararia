"use client";

import { memo } from "react";
import { StudentSessionStream } from "./StudentSessionStream";
import type { ReportItem, SessionItem } from "./roomTypes";
import {
  formatReportDate,
  formatSessionLabel,
  lessonSummaryLabel,
} from "./studentDetailFormatting";
import styles from "./studentDetail.module.css";

export type StudentDetailTabKey = "communications" | "lessonReports" | "parentReports";
export type StudentDetailPeriodFilter = "all" | "month";
export type StudentDetailSortOrder = "desc" | "asc";

type Props = {
  sessions: SessionItem[];
  reports: ReportItem[];
  activeTab: StudentDetailTabKey;
  periodFilter: StudentDetailPeriodFilter;
  sortOrder: StudentDetailSortOrder;
  viewerBadge: string;
  viewerName?: string | null;
  onActiveTabChange: (tab: StudentDetailTabKey) => void;
  onPeriodFilterChange: (filter: StudentDetailPeriodFilter) => void;
  onSortOrderChange: (order: StudentDetailSortOrder) => void;
  onOpenLog: (logId: string) => void;
  onOpenParentReport: (reportId: string) => void;
};

function withinCurrentMonth(value: string) {
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function conversationReviewLabel(session: SessionItem) {
  if (session.conversation?.reviewState === "REQUIRED") return "要確認あり";
  if (session.conversation?.reviewState === "RESOLVED") return "確認済み";
  return session.pipeline?.progress.title ?? "ログ確認";
}

function reportMetaLabel(report: ReportItem) {
  const meta: string[] = [];
  if (report.sourceLogIds?.length) {
    meta.push(`参照ログ ${report.sourceLogIds.length}件`);
  }
  if (report.latestEvent?.label) {
    meta.push(report.latestEvent.label);
  }
  return meta.join(" / ");
}

function StudentDetailWorkspaceInner({
  sessions,
  reports,
  activeTab,
  periodFilter,
  sortOrder,
  viewerBadge,
  viewerName,
  onActiveTabChange,
  onPeriodFilterChange,
  onSortOrderChange,
  onOpenLog,
  onOpenParentReport,
}: Props) {
  const communicationSessions = (() => {
    const base = sessions.filter((session) => session.type === "INTERVIEW" && session.conversation?.id);
    const filtered = periodFilter === "month" ? base.filter((session) => withinCurrentMonth(session.sessionDate)) : base;
    return [...filtered].sort((left, right) =>
      sortOrder === "desc"
        ? new Date(right.sessionDate).getTime() - new Date(left.sessionDate).getTime()
        : new Date(left.sessionDate).getTime() - new Date(right.sessionDate).getTime()
    );
  })();

  const parentReports = (() => {
    const filtered = periodFilter === "month" ? reports.filter((report) => withinCurrentMonth(report.createdAt)) : reports;
    return [...filtered].sort((left, right) =>
      sortOrder === "desc"
        ? new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        : new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    );
  })();

  const lessonReports = (() => {
    const base = sessions.filter((session) => session.type === "LESSON_REPORT");
    const filtered = periodFilter === "month" ? base.filter((session) => withinCurrentMonth(session.sessionDate)) : base;
    return [...filtered].sort((left, right) =>
      sortOrder === "desc"
        ? new Date(right.sessionDate).getTime() - new Date(left.sessionDate).getTime()
        : new Date(left.sessionDate).getTime() - new Date(right.sessionDate).getTime()
    );
  })();

  return (
    <>
      <div className={styles.tabBar}>
        {[
          { key: "communications", label: "面談ログ" },
          { key: "lessonReports", label: "指導報告" },
          { key: "parentReports", label: "保護者レポートログ" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`${styles.tabButton} ${activeTab === tab.key ? styles.tabButtonActive : ""}`}
            onClick={() => onActiveTabChange(tab.key as StudentDetailTabKey)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.filterRow}>
        <div className={styles.filterGroup}>
          <button
            type="button"
            className={`${styles.filterButton} ${periodFilter === "all" ? styles.filterButtonActive : ""}`}
            onClick={() => onPeriodFilterChange("all")}
          >
            すべて
          </button>
          <button
            type="button"
            className={`${styles.filterButton} ${periodFilter === "month" ? styles.filterButtonActive : ""}`}
            onClick={() => onPeriodFilterChange("month")}
          >
            今月
          </button>
        </div>
        <div className={styles.filterGroup}>
          <button
            type="button"
            className={`${styles.filterButton} ${sortOrder === "desc" ? styles.filterButtonActive : ""}`}
            onClick={() => onSortOrderChange("desc")}
          >
            新しい順
          </button>
          <button
            type="button"
            className={`${styles.filterButton} ${sortOrder === "asc" ? styles.filterButtonActive : ""}`}
            onClick={() => onSortOrderChange("asc")}
          >
            古い順
          </button>
        </div>
      </div>

      {activeTab === "communications" ? (
        <StudentSessionStream
          sessions={communicationSessions}
          assigneeName={viewerName ?? undefined}
          onOpenLog={onOpenLog}
        />
      ) : null}

      {activeTab === "lessonReports" ? (
        <div className={styles.historyList}>
          {lessonReports.length === 0 ? (
            <div className={styles.emptyState}>
              まだ指導報告はありません。チェックインとチェックアウトがそろうとここに並びます。
            </div>
          ) : (
            lessonReports.map((session) => {
              const logId = session.pipeline?.openLogId ?? session.conversation?.id ?? null;
              return (
                <button
                  key={session.id}
                  type="button"
                  className={`${styles.historyRow} ${!logId ? styles.historyRowDisabled : ""}`}
                  disabled={!logId}
                  onClick={() => {
                    if (logId) onOpenLog(logId);
                  }}
                >
                  <div className={styles.historyRowLeft}>
                    <div className={styles.historyIcon} aria-hidden>
                      <span />
                    </div>
                    <div>
                      <div className={styles.historyRowTitle}>{formatSessionLabel(session)}</div>
                      <div className={styles.historyRowMeta}>
                        {lessonSummaryLabel(session)} / {conversationReviewLabel(session)}
                      </div>
                    </div>
                  </div>
                  <div className={styles.assigneePill}>{viewerBadge}</div>
                </button>
              );
            })
          )}
        </div>
      ) : null}

      {activeTab === "parentReports" ? (
        <div className={styles.historyList}>
          {parentReports.length === 0 ? (
            <div className={styles.emptyState}>
              まだ保護者レポートはありません。上段のカードから対象ログを選んで生成してください。
            </div>
          ) : (
            parentReports.map((report) => {
              const metaLabel = reportMetaLabel(report);
              return (
                <button
                  key={report.id}
                  type="button"
                  className={styles.historyRow}
                  onClick={() => void onOpenParentReport(report.id)}
                >
                  <div className={styles.historyRowLeft}>
                    <div className={styles.historyIcon} aria-hidden>
                      <span />
                    </div>
                    <div>
                      <div className={styles.historyRowTitle}>{formatReportDate(report.createdAt)} の保護者レポート</div>
                      <div className={styles.historyRowMeta}>
                        {report.deliveryStateLabel ?? report.workflowStatusLabel ?? "状態確認中"}
                        {metaLabel ? ` / ${metaLabel}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className={styles.assigneePill}>{viewerBadge}</div>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </>
  );
}

StudentDetailWorkspaceInner.displayName = "StudentDetailWorkspace";

export const StudentDetailWorkspace = memo(StudentDetailWorkspaceInner);
