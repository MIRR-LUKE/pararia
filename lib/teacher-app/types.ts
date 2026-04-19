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
};

export type PendingTeacherUploadItem = {
  id: string;
  recordedAt: string;
  status: "pending" | "failed";
  label: string;
};

export type TeacherFlowState =
  | { kind: "standby"; unsentCount: number }
  | { kind: "recording"; seconds: number }
  | { kind: "analyzing" }
  | { kind: "confirm"; candidates: TeacherStudentCandidate[] }
  | { kind: "done" }
  | { kind: "pending"; items: PendingTeacherUploadItem[] };

export type TeacherAppBootstrap = {
  session: TeacherAppDeviceSession;
  initialState: TeacherFlowState;
};
