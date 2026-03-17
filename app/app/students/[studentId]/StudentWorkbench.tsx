"use client";

import { Button } from "@/components/ui/Button";
import { LogDetailView } from "../../logs/LogDetailView";
import { StudentQueueDock } from "./StudentQueueDock";
import { StudentSessionConsole, type SessionConsoleLessonPart, type SessionConsoleMode } from "./StudentSessionConsole";
import { ReportStudio } from "./ReportStudio";
import type { ReportItem, SessionItem, WorkbenchPanel } from "./roomTypes";
import styles from "./studentWorkbench.module.css";

type Props = {
  panel: WorkbenchPanel;
  studentId: string;
  studentName: string;
  sessions: SessionItem[];
  reports: ReportItem[];
  selectedSessionIds: string[];
  onSelectedSessionIdsChange: (ids: string[]) => void;
  recordingMode: SessionConsoleMode;
  lessonPart: SessionConsoleLessonPart;
  proofLogId: string | null;
  onOpenRecording: (mode: SessionConsoleMode, part?: SessionConsoleLessonPart) => void;
  onOpenProof: (logId: string) => void;
  onOpenReport: (options?: { sendReady?: boolean }) => void;
  onClosePanel: () => void;
  onRefresh: () => void;
};

export function StudentWorkbench({
  panel,
  studentId,
  studentName,
  sessions,
  reports,
  selectedSessionIds,
  onSelectedSessionIdsChange,
  recordingMode,
  lessonPart,
  proofLogId,
  onOpenRecording,
  onOpenProof,
  onOpenReport,
  onClosePanel,
  onRefresh,
}: Props) {
  const isReportPanel = panel === "report_selection" || panel === "report_generated" || panel === "send_ready";

  return (
    <aside aria-label="Student Room workbench">
      <StudentQueueDock
        sessions={sessions}
        reports={reports}
        onOpenProof={onOpenProof}
        onOpenReport={() => onOpenReport()}
        onOpenRecording={onOpenRecording}
      />

      {panel === "recording" ? (
        <StudentSessionConsole
          studentId={studentId}
          studentName={studentName}
          mode={recordingMode}
          lessonPart={lessonPart}
          onModeChange={(mode) => onOpenRecording(mode, lessonPart)}
          onLessonPartChange={(part) => onOpenRecording("LESSON_REPORT", part)}
          onRefresh={onRefresh}
          onOpenProof={onOpenProof}
          onOpenReport={() => onOpenReport()}
        />
      ) : null}

      {panel === "proof" && proofLogId ? (
        <section className={styles.workbenchSection}>
          <div className={styles.workbenchHeader}>
            <div>
              <div className={styles.eyebrow}>Proof Console</div>
              <h3 className={styles.workbenchTitle}>根拠をその場で確認する</h3>
              <p className={styles.mutedText}>この生徒の文脈を失わずに、要点・entity・文字起こしを見返せます。</p>
            </div>
            <Button size="small" variant="ghost" onClick={onClosePanel}>
              閉じる
            </Button>
          </div>
          <LogDetailView logId={proofLogId} showHeader={false} onBack={onClosePanel} />
        </section>
      ) : null}

      {isReportPanel ? (
        <ReportStudio
          studentId={studentId}
          studentName={studentName}
          sessions={sessions}
          reports={reports}
          selectedSessionIds={selectedSessionIds}
          onSelectedSessionIdsChange={onSelectedSessionIdsChange}
          onRefresh={onRefresh}
          onOpenProof={onOpenProof}
          onSendReady={() => onOpenReport({ sendReady: true })}
        />
      ) : null}

      {panel === "idle" ? (
        <section className={styles.workbenchSection}>
          <div className={styles.workbenchHeader}>
            <div>
              <div className={styles.eyebrow}>Workbench</div>
              <h3 className={styles.workbenchTitle}>ここで録音・根拠確認・レポ送付まで完結します</h3>
              <p className={styles.mutedText}>左で会話ログを読み、右で必要な作業だけを進めます。録音開始か、既存ログの確認から始めてください。</p>
            </div>
          </div>
          <div className={styles.actionStack}>
            <Button onClick={() => onOpenRecording("INTERVIEW")}>面談を始める</Button>
            <Button variant="secondary" onClick={() => onOpenRecording("LESSON_REPORT", "CHECK_IN")}>授業を始める</Button>
            <Button variant="ghost" onClick={() => onOpenReport()} disabled={selectedSessionIds.length === 0}>
              選択ログで保護者レポートを組む
            </Button>
          </div>
        </section>
      ) : null}

      {panel === "error" ? (
        <section className={styles.workbenchSection}>
          <div className={styles.inlineError}>処理の途中でエラーが起きました。再読み込みか、別のパネルからやり直してください。</div>
          <Button variant="secondary" onClick={onClosePanel}>閉じる</Button>
        </section>
      ) : null}
    </aside>
  );
}
