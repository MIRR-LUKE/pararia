"use client";

import { Button } from "@/components/ui/Button";
import { StructuredMarkdown } from "@/components/ui/StructuredMarkdown";
import { LogView } from "../../logs/LogView";
import { ReportStudio } from "./ReportStudio";
import type { ReportItem, ReportStudioView, RoomResponse } from "./roomTypes";
import styles from "./studentDetail.module.css";

type OverlayState =
  | { kind: "log"; logId: string }
  | { kind: "report"; view: ReportStudioView }
  | { kind: "parentReport"; reportId: string };

type Props = {
  overlay: OverlayState;
  room: RoomResponse;
  activeParentReport: ReportItem | null;
  parentReportLoadingId: string | null;
  parentReportError: string | null;
  selectedSessionIds: string[];
  onSelectedSessionIdsChange: (ids: string[]) => void;
  onRequestClose: () => void;
  onRefresh: () => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void;
  onOpenLog: (logId: string) => void;
  onReportViewChange: (view: ReportStudioView) => void;
  onRetryParentReport: (reportId: string) => void;
  onOpenDeleteDialogForLog: () => void;
  onOpenDeleteDialogForReport: () => void;
  onOpenReportStudioSend: () => void;
};

function formatReportDate(value?: string | null) {
  if (!value) return "未生成";
  const date = new Date(value);
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

export function StudentDetailOverlay({
  overlay,
  room,
  activeParentReport,
  parentReportLoadingId,
  parentReportError,
  selectedSessionIds,
  onSelectedSessionIdsChange,
  onRequestClose,
  onRefresh,
  onDirtyChange,
  onOpenLog,
  onReportViewChange,
  onRetryParentReport,
  onOpenDeleteDialogForLog,
  onOpenDeleteDialogForReport,
  onOpenReportStudioSend,
}: Props) {
  return (
    <div
      className={styles.overlayBackdrop}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onRequestClose();
      }}
    >
      <div className={styles.overlayPanel} role="dialog" aria-modal="true">
        <div className={styles.overlayHeader}>
          <div className={styles.overlayTitleBlock}>
            <div className={styles.overlayEyebrow}>
              {overlay.kind === "log"
                ? "ログ"
                : overlay.kind === "report"
                  ? "保護者レポート"
                  : "保護者レポートログ"}
            </div>
            <h3 className={styles.overlayTitle}>
              {overlay.kind === "log" ? "ログを確認する" : "保護者レポートを確認する"}
            </h3>
          </div>
          <div className={styles.overlayActions}>
            {overlay.kind === "log" ? (
              <Button variant="ghost" className={styles.deleteButton} onClick={onOpenDeleteDialogForLog}>
                このログを削除
              </Button>
            ) : null}
            {overlay.kind === "parentReport" ? (
              <Button variant="ghost" className={styles.deleteButton} onClick={onOpenDeleteDialogForReport}>
                このレポートを削除
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onRequestClose}>
              閉じる
            </Button>
          </div>
        </div>

        <div className={styles.overlayContent}>
          {overlay.kind === "log" ? (
            <LogView
              logId={overlay.logId}
              showHeader={false}
              onBack={onRequestClose}
              onSaved={onRefresh}
              onDirtyChange={onDirtyChange}
            />
          ) : null}

          {overlay.kind === "report" ? (
            <ReportStudio
              view={overlay.view}
              studentId={room.student.id}
              studentName={room.student.name}
              sessions={room.sessions}
              reports={room.reports}
              selectedSessionIds={selectedSessionIds}
              onSelectedSessionIdsChange={onSelectedSessionIdsChange}
              onRefresh={onRefresh}
              onOpenLog={onOpenLog}
              onViewChange={onReportViewChange}
            />
          ) : null}

          {overlay.kind === "parentReport" && activeParentReport ? (
            parentReportLoadingId === activeParentReport.id && !activeParentReport.reportMarkdown ? (
              <div className={styles.overlayLoading}>保護者レポートを読み込んでいます...</div>
            ) : parentReportError && !activeParentReport.reportMarkdown ? (
              <div className={styles.reportDetailStack}>
                <div className={styles.memoError}>{parentReportError}</div>
                <div className={styles.detailActions}>
                  <Button variant="secondary" onClick={() => onRetryParentReport(activeParentReport.id)}>
                    もう一度読み込む
                  </Button>
                </div>
              </div>
            ) : (
              <div className={styles.reportDetailStack}>
                <div className={styles.detailMetaRow}>
                  <div>
                    <span>作成日</span>
                    <strong>{formatReportDate(activeParentReport.createdAt)}</strong>
                  </div>
                  <div>
                    <span>状態</span>
                    <strong>
                      {activeParentReport.deliveryStateLabel ?? activeParentReport.workflowStatusLabel ?? "状態確認中"}
                    </strong>
                  </div>
                  <div>
                    <span>参照ログ</span>
                    <strong>{activeParentReport.sourceLogIds?.length ?? 0}件</strong>
                  </div>
                </div>

                <div className={styles.reportParagraph}>
                  <StructuredMarkdown
                    markdown={activeParentReport.reportMarkdown}
                    emptyMessage="まだ保護者レポートは生成されていません。"
                  />
                </div>

                {activeParentReport.needsReview || activeParentReport.needsShare ? (
                  <div className={styles.detailActions}>
                    <Button onClick={onOpenReportStudioSend}>送付前確認へ進む</Button>
                  </div>
                ) : null}
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
