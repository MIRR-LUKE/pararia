"use client";

import { memo } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StudentSessionConsoleLockSection } from "./StudentSessionConsoleLockSection";
import { StudentSessionConsoleModeSection } from "./StudentSessionConsoleModeSection";
import { StudentSessionConsoleProgressSection } from "./StudentSessionConsoleProgressSection";
import { StudentSessionConsoleRecordingSection } from "./StudentSessionConsoleRecordingSection";
import { StudentSessionConsoleUploadSection } from "./StudentSessionConsoleUploadSection";
import { useStudentSessionConsoleController } from "./useStudentSessionConsoleController";
import styles from "./studentSessionConsole.module.css";

export type { SessionConsoleLessonPart, SessionConsoleMode } from "./studentSessionConsoleTypes";

type Props = {
  studentId: string;
  studentName: string;
  mode: "INTERVIEW";
  lessonPart: "FULL" | "TEXT_NOTE";
  ongoingLessonSession?: import("./roomTypes").SessionItem | null;
  onModeChange: (mode: "INTERVIEW") => void;
  onLessonPartChange: (part: "FULL" | "TEXT_NOTE") => void;
  onRefresh: () => Promise<void> | void;
  onOpenLog: (logId: string) => void;
  recordingLock?: import("./roomTypes").RecordingLockInfo;
  showModePicker?: boolean;
  autoStartOnMount?: boolean;
};

function StudentSessionConsoleInner({
  studentId,
  studentName,
  mode,
  lessonPart,
  ongoingLessonSession,
  onModeChange,
  onLessonPartChange,
  onRefresh,
  onOpenLog,
  recordingLock,
  showModePicker = true,
  autoStartOnMount = false,
}: Props) {
  const controller = useStudentSessionConsoleController({
    studentId,
    studentName,
    mode,
    lessonPart,
    ongoingLessonSession,
    onModeChange,
    onLessonPartChange,
    onRefresh,
    onOpenLog,
    recordingLock,
    autoStartOnMount,
  });

  return (
    <div className={styles.console} data-recording-state={controller.state}>
      <StudentSessionConsoleModeSection
        showModePicker={false}
        mode={mode}
        lessonPart={lessonPart}
        lessonFlowState={controller.lessonFlowState}
        isPreparingOrRecording={controller.isPreparingOrRecording}
        pendingDraft={controller.pendingDraft}
        onModeChange={controller.onModeChange}
        onLessonPartChange={controller.onLessonPartChange}
      />

      <div className={styles.surface}>
        <StudentSessionConsoleRecordingSection
          state={controller.state}
          currentModeLabel={controller.isPreparingOrRecording ? controller.modeLabel : null}
          currentStudentLabel={controller.statusCopy.currentStudentLabel}
          statusLine={controller.statusCopy.statusLine}
          lessonMetaLine={null}
          lessonGuide={null}
          canStartFromCircle={controller.canStartFromCircle}
          isPaused={controller.isPaused}
          levels={controller.levels}
          seconds={controller.seconds}
          estimatedSize={controller.estimatedSize}
          canFinishRecording={controller.canFinishRecording}
          remainingSecondsUntilSavable={controller.remainingSecondsUntilSavable}
          onStartRecording={() => void controller.startRecording()}
          onTogglePause={controller.togglePause}
          onRequestCancelRecording={controller.openCancelDialog}
          onStopRecording={controller.stopRecording}
        />

        <StudentSessionConsoleProgressSection
          showGenerationProgress={controller.showGenerationProgress}
          progress={controller.generationProgress}
        />

        <StudentSessionConsoleLockSection
          lockConflict={Boolean(controller.lockConflict)}
          lockConflictName={controller.lockConflictName}
        />

        <StudentSessionConsoleUploadSection
          canUpload={controller.canUpload}
          pendingDraft={controller.pendingDraft}
          pendingDraftPersistence={controller.pendingDraftPersistence}
          pendingDraftCanUpload={controller.pendingDraftCanUpload}
          error={controller.error}
          recoverableSessionId={controller.recoverableSessionId}
          createdConversationId={controller.createdConversationId}
          message={controller.message}
          state={controller.state}
          onSelectFile={(file) => void controller.handleFileSelection(file)}
          onRetryPendingDraft={() => void controller.retryPendingDraftUpload()}
          onDownloadPendingDraft={controller.downloadPendingDraft}
          onDiscardPendingDraft={() => controller.setShowDiscardDraftDialog(true)}
          onRetryGeneration={() => void controller.retryGeneration()}
          onReset={controller.reset}
          onOpenLog={onOpenLog}
        />
      </div>

      <ConfirmDialog
        open={controller.showCancelDialog}
        title="録音を中止しますか？"
        description="ここまでの録音はこの端末に一時保存できます。あとで再送することも、端末へ保存してから破棄することもできます。"
        details={[
          "終了は保存して処理へ進みます。",
          "キャンセルはサーバーへ送らず、この端末に一時保存します。",
        ]}
        confirmLabel="録音を中止する"
        cancelLabel="続ける"
        tone="danger"
        onConfirm={controller.confirmCancelRecording}
        onCancel={() => controller.setShowCancelDialog(false)}
      />

      <ConfirmDialog
        open={controller.showDiscardDraftDialog}
        title="一時保存した録音を破棄しますか？"
        description="破棄すると、この端末に残っている再送用の録音データも消えます。"
        confirmLabel="破棄する"
        cancelLabel="戻る"
        tone="danger"
        onConfirm={() => void controller.discardPendingDraft()}
        onCancel={() => controller.setShowDiscardDraftDialog(false)}
      />
    </div>
  );
}

StudentSessionConsoleInner.displayName = "StudentSessionConsole";

export const StudentSessionConsole = memo(StudentSessionConsoleInner);
