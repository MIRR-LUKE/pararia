"use client";

import {
  ReportStudioDraftSection,
  ReportStudioError,
  ReportStudioHeader,
  ReportStudioHistorySection,
  ReportStudioMetrics,
  ReportStudioSelectedSessions,
  ReportStudioSelectionSection,
  ReportStudioSendSection,
} from "./ReportStudioSections";
import styles from "./reportStudio.module.css";
import type { ReportItem, ReportStudioView, SessionItem } from "./roomTypes";
import { useReportStudioController } from "./useReportStudioController";

type Props = {
  view: ReportStudioView;
  studentId: string;
  studentName: string;
  sessions: SessionItem[];
  reports: ReportItem[];
  selectedSessionIds: string[];
  onSelectedSessionIdsChange: (ids: string[]) => void;
  onRefresh: () => Promise<void> | void;
  onOpenLog: (logId: string) => void;
  onViewChange: (view: ReportStudioView) => void;
};

export function ReportStudio({
  view,
  studentId,
  studentName,
  sessions,
  reports,
  selectedSessionIds,
  onSelectedSessionIdsChange,
  onRefresh,
  onOpenLog,
  onViewChange,
}: Props) {
  const controller = useReportStudioController({
    studentId,
    sessions,
    reports,
    selectedSessionIds,
    onSelectedSessionIdsChange,
    onRefresh,
    onOpenLog,
    onViewChange,
  });

  return (
    <section className={styles.workbenchSection} aria-label="保護者レポート生成">
      <ReportStudioHeader view={view} selectedSessionCount={controller.selectedSessionIds.length} />
      <ReportStudioError error={controller.error} />
      <ReportStudioMetrics
        quality={controller.quality}
        workflowLabel={controller.workflowLabel}
        deliveryLabel={controller.deliveryLabel}
        selectedCount={controller.selectedSessionIds.length}
      />
      <ReportStudioSelectedSessions
        selectedSessions={controller.selectedSessions}
        removeSelectedSession={controller.removeSelectedSession}
      />
      <ReportStudioSelectionSection
        view={view}
        reportGenerationProgress={controller.reportGenerationProgress}
        previewText={controller.previewText}
        quality={controller.quality}
        suggestedSessions={controller.suggestedSessions}
        selectedSessionIds={controller.selectedSessionIds}
        onSelectedSessionIdsChange={controller.onSelectedSessionIdsChange}
        generateReport={controller.generateReport}
        isGenerating={controller.isGenerating}
      />
      <ReportStudioSendSection
        view={view}
        latestReport={controller.latestReport}
        isSending={controller.isSending}
        recordReportAction={controller.recordReportAction}
        onViewChange={onViewChange}
      />
      <ReportStudioDraftSection
        previewParagraphs={controller.previewParagraphs}
        selectedSessions={controller.selectedSessions}
        studentName={studentName}
        onOpenLog={controller.onOpenLog}
      />
      <ReportStudioHistorySection shareHistory={controller.shareHistory} />
    </section>
  );
}
