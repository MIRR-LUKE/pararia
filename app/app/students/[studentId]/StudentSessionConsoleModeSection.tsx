"use client";

type LessonFlowState = {
  hasCheckIn: boolean;
  hasReadyCheckIn: boolean;
  hasCheckOut: boolean;
  hasReadyCheckOut: boolean;
  isComplete: boolean;
};

type Props = {
  showModePicker: boolean;
  mode: "INTERVIEW";
  lessonPart: "CHECK_IN" | "CHECK_OUT";
  lessonFlowState: LessonFlowState;
  isPreparingOrRecording: boolean;
  pendingDraft: unknown;
  onModeChange: (mode: "INTERVIEW") => void;
  onLessonPartChange: (part: "CHECK_IN" | "CHECK_OUT") => void;
};

export function StudentSessionConsoleModeSection(_props: Props) {
  return null;
}
