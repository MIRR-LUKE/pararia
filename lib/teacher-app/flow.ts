import type {
  PendingTeacherUploadItem,
  TeacherAppBootstrap,
  TeacherAppDeviceSession,
  TeacherFlowState,
  TeacherRecordingSummary,
} from "./types";

export function buildTeacherFlowState(input?: {
  activeRecording?: TeacherRecordingSummary | null;
  pendingItems?: PendingTeacherUploadItem[];
}): TeacherFlowState {
  const activeRecording = input?.activeRecording ?? null;
  const pendingItems = input?.pendingItems ?? [];
  if (activeRecording) {
    if (activeRecording.status === "AWAITING_STUDENT_CONFIRMATION") {
      return {
        kind: "confirm",
        recording: activeRecording,
      };
    }
    if (activeRecording.status === "TRANSCRIBING") {
      return {
        kind: "analyzing",
        recordingId: activeRecording.id,
        description: "文字起こしと生徒候補を確認しています。",
      };
    }
  }
  if (pendingItems.length > 0) {
    return {
      kind: "pending",
      items: pendingItems,
    };
  }
  return {
    kind: "standby",
    unsentCount: 0,
  };
}

export function buildTeacherAppBootstrap(
  session: TeacherAppDeviceSession,
  input?: {
    activeRecording?: TeacherRecordingSummary | null;
    pendingItems?: PendingTeacherUploadItem[];
  }
): TeacherAppBootstrap {
  return {
    activeRecording: input?.activeRecording ?? null,
    session,
    initialState: buildTeacherFlowState(input),
  };
}
