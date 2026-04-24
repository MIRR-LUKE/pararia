"use client";

type LessonFlowState = {
  hasFull: boolean;
  hasReadyFull: boolean;
  hasTextNote: boolean;
  hasReadyTextNote: boolean;
  isComplete: boolean;
};

type Props = {
  showModePicker: boolean;
  mode: "INTERVIEW";
  lessonPart: "FULL" | "TEXT_NOTE";
  lessonFlowState: LessonFlowState;
  isPreparingOrRecording: boolean;
  pendingDraft: unknown;
  onModeChange: (mode: "INTERVIEW") => void;
  onLessonPartChange: (part: "FULL" | "TEXT_NOTE") => void;
};

export function StudentSessionConsoleModeSection(_props: Props) {
  return null;
}
