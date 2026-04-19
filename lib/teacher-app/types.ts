export type TeacherAppDeviceSession = {
  userId: string;
  organizationId: string;
  role: string;
  roleLabel: string;
  userName: string | null;
  userEmail: string | null;
  deviceLabel: string;
  issuedAt: string;
  expiresAt: string;
};

export type TeacherStudentCandidate = {
  id: string;
  name: string;
  subtitle: string | null;
  score?: number | null;
  reason?: string | null;
};

export type PendingTeacherUploadItem = {
  id: string;
  recordingId: string;
  recordedAt: string;
  status: "pending" | "failed";
  label: string;
  errorMessage?: string | null;
};

export type TeacherRecordingStatus =
  | "RECORDING"
  | "TRANSCRIBING"
  | "AWAITING_STUDENT_CONFIRMATION"
  | "STUDENT_CONFIRMED"
  | "CANCELLED"
  | "ERROR";

export type TeacherRecordingSummary = {
  id: string;
  status: TeacherRecordingStatus;
  deviceLabel: string;
  recordedAt: string | null;
  uploadedAt: string | null;
  analyzedAt: string | null;
  confirmedAt: string | null;
  durationSeconds: number | null;
  transcriptText: string | null;
  candidates: TeacherStudentCandidate[];
  errorMessage: string | null;
};

export type TeacherFlowState =
  | { kind: "standby"; unsentCount: number }
  | { kind: "recording"; recordingId: string; seconds: number }
  | { kind: "analyzing"; recordingId: string; description: string }
  | { kind: "confirm"; recording: TeacherRecordingSummary }
  | { kind: "done" }
  | { kind: "pending"; items: PendingTeacherUploadItem[] };

export type TeacherAppBootstrap = {
  session: TeacherAppDeviceSession;
  activeRecording: TeacherRecordingSummary | null;
  initialState: TeacherFlowState;
};
