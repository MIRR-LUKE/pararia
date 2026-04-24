"use client";

import type { SessionPipelineInfo } from "./roomTypes";
import type {
  ConsoleState,
  PendingRecordingDraft,
  SessionConsoleLessonPart,
  SessionConsoleMode,
} from "./studentSessionConsoleTypes";
import {
  MIN_SECONDS_BEFORE_SAVE_ENABLED,
  getDurationValidationMessage,
  modeLabel,
} from "./studentSessionConsoleUtils";
import {
  buildStudentSessionConsoleProgress,
  buildStudentSessionConsoleStatusCopy,
} from "./studentSessionConsoleView";

type Input = {
  lockConflict: unknown;
  pendingDraft: PendingRecordingDraft | null;
  state: ConsoleState;
  seconds: number;
  mode: SessionConsoleMode;
  lessonPart: SessionConsoleLessonPart;
  sessionProgress: SessionPipelineInfo | null;
  studentName: string;
  message: string;
};

export function buildStudentSessionConsoleDerivedState({
  lockConflict,
  pendingDraft,
  state,
  seconds,
  mode,
  lessonPart,
  sessionProgress,
  studentName,
  message,
}: Input) {
  const canRecord =
    !lockConflict && !pendingDraft && state !== "preparing" && state !== "uploading" && state !== "processing";
  const canUpload =
    !lockConflict &&
    !pendingDraft &&
    state !== "preparing" &&
    state !== "recording" &&
    state !== "uploading" &&
    state !== "processing";
  const canStartFromCircle = canRecord && state !== "recording";
  const canFinishRecording = seconds >= MIN_SECONDS_BEFORE_SAVE_ENABLED;
  const pendingDraftCanUpload = pendingDraft
    ? pendingDraft.durationSeconds === null || !getDurationValidationMessage(mode, pendingDraft.durationSeconds)
    : false;
  const showPendingDraftWarning = Boolean(pendingDraft) && (state === "idle" || state === "error");
  const generationProgress = buildStudentSessionConsoleProgress({
    mode,
    state,
    sessionProgress,
  });

  return {
    canFinishRecording,
    canRecord,
    canStartFromCircle,
    canUpload,
    generationProgress,
    isPreparingOrRecording: state === "preparing" || state === "recording",
    modeLabel: modeLabel(mode, lessonPart),
    pendingDraft: showPendingDraftWarning ? pendingDraft : null,
    pendingDraftCanUpload,
    remainingSecondsUntilSavable: Math.max(0, MIN_SECONDS_BEFORE_SAVE_ENABLED - seconds),
    showGenerationProgress: Boolean(generationProgress),
    statusCopy: buildStudentSessionConsoleStatusCopy({
      mode,
      lessonPart,
      state,
      studentName,
      message,
      generationProgress,
    }),
  };
}
