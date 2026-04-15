"use client";

import styles from "./studentSessionConsole.module.css";

type LessonFlowState = {
  hasCheckIn: boolean;
  hasReadyCheckIn: boolean;
  hasCheckOut: boolean;
  hasReadyCheckOut: boolean;
  isComplete: boolean;
};

type Props = {
  showModePicker: boolean;
  mode: "INTERVIEW" | "LESSON_REPORT";
  lessonPart: "CHECK_IN" | "CHECK_OUT";
  lessonFlowState: LessonFlowState;
  isPreparingOrRecording: boolean;
  pendingDraft: unknown;
  onModeChange: (mode: "INTERVIEW" | "LESSON_REPORT") => void;
  onLessonPartChange: (part: "CHECK_IN" | "CHECK_OUT") => void;
};

export function StudentSessionConsoleModeSection({
  showModePicker,
  mode,
  lessonPart,
  lessonFlowState,
  isPreparingOrRecording,
  pendingDraft,
  onModeChange,
  onLessonPartChange,
}: Props) {
  if (!showModePicker) return null;

  return (
    <>
      <div className={styles.modePicker} role="tablist" aria-label="録音モード">
        <button
          type="button"
          className={`${styles.modeButton} ${mode === "INTERVIEW" ? styles.modeButtonActive : ""}`}
          onClick={() => onModeChange("INTERVIEW")}
          disabled={isPreparingOrRecording || Boolean(pendingDraft)}
        >
          面談
        </button>
        <button
          type="button"
          className={`${styles.modeButton} ${mode === "LESSON_REPORT" ? styles.modeButtonActive : ""}`}
          onClick={() => onModeChange("LESSON_REPORT")}
          disabled={isPreparingOrRecording || Boolean(pendingDraft)}
        >
          指導報告
        </button>
      </div>

      {mode === "LESSON_REPORT" ? (
        <div className={styles.lessonSteps} role="tablist" aria-label="指導報告のステップ">
          <button
            type="button"
            className={`${styles.lessonStep} ${
              lessonFlowState.hasCheckIn
                ? styles.lessonStepDone
                : lessonPart === "CHECK_IN"
                  ? styles.lessonStepCurrent
                  : styles.lessonStepPending
            }`}
            onClick={() => onLessonPartChange("CHECK_IN")}
            disabled={isPreparingOrRecording || Boolean(pendingDraft) || lessonFlowState.hasCheckIn}
          >
            <span className={styles.lessonStepNum}>
              {lessonFlowState.hasReadyCheckIn ? "✓" : lessonFlowState.hasCheckIn ? "…" : "1"}
            </span>
            <span>チェックイン</span>
          </button>
          <div className={`${styles.lessonStepConnector} ${lessonFlowState.hasCheckIn ? styles.lessonStepConnectorDone : ""}`} />
          <button
            type="button"
            className={`${styles.lessonStep} ${
              lessonFlowState.hasCheckOut
                ? styles.lessonStepDone
                : lessonPart === "CHECK_OUT"
                  ? styles.lessonStepCurrent
                  : !lessonFlowState.hasCheckIn
                    ? styles.lessonStepLocked
                    : styles.lessonStepPending
            }`}
            onClick={() => onLessonPartChange("CHECK_OUT")}
            disabled={isPreparingOrRecording || Boolean(pendingDraft) || !lessonFlowState.hasCheckIn}
          >
            <span className={styles.lessonStepNum}>
              {lessonFlowState.hasReadyCheckOut ? "✓" : lessonFlowState.hasCheckOut ? "…" : !lessonFlowState.hasCheckIn ? "🔒" : "2"}
            </span>
            <span>チェックアウト</span>
          </button>
          <div className={`${styles.lessonStepConnector} ${lessonFlowState.isComplete ? styles.lessonStepConnectorDone : ""}`} />
          <div
            className={`${styles.lessonStep} ${lessonFlowState.isComplete ? styles.lessonStepCurrent : styles.lessonStepPending}`}
          >
            <span className={styles.lessonStepNum}>3</span>
            <span>自動生成</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
