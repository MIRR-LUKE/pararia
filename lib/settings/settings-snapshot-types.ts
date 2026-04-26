export type MissingStudent = {
  id: string;
  name: string;
  grade?: string | null;
  guardianNames?: string | null;
};

export type OperationsJobRow = {
  id: string;
  kind: "conversation" | "session_part" | "teacher_recording";
  targetId: string;
  sessionId: string | null;
  studentId: string | null;
  studentName: string | null;
  jobType: string;
  status: string;
  statusLabel: string;
  fileName: string | null;
  partType: string | null;
  lastError: string | null;
  nextRetryAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  leaseExpiresAt: string | null;
};

export type DeletedContentRow = {
  id: string;
  kind: "conversation" | "report";
  studentId: string;
  studentName: string | null;
  deletedAt: string;
  deletedByLabel: string | null;
  note: string | null;
  sessionId: string | null;
};

export type TeacherAppDeviceRow = {
  id: string;
  label: string;
  status: string;
  statusLabel: string;
  lastClientPlatform: string | null;
  lastAppVersion: string | null;
  lastBuildNumber: string | null;
  lastAuthenticatedAt: string | null;
  lastSeenAt: string | null;
  configuredByLabel: string | null;
  activeAuthSessionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SettingsSnapshot = {
  organization: {
    id: string;
    name: string;
    planCode: string;
    studentLimit: number | null;
    defaultLocale: string;
    defaultTimeZone: string;
    guardianConsentRequired: boolean;
    consentVersion: string | null;
    consentUpdatedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  permissions: {
    viewerRole?: string;
    canManage: boolean;
    canRunOperations: boolean;
    roleCounts: Record<string, number>;
    policyRows: Array<{
      label: string;
      roles: string;
      note: string;
    }>;
  };
  guardianContacts: {
    totalStudents: number;
    studentsWithGuardian: number;
    studentsMissingGuardian: number;
    coveragePercent: number;
    missingStudents: MissingStudent[];
  };
  invitations: {
    pendingCount: number;
    expiredCount: number;
    acceptedCount: number;
    recentPending: Array<{
      id: string;
      email: string;
      role: string;
      expiresAt: string;
    }>;
  };
  teacherAppDevices: {
    activeCount: number;
    revokedCount: number;
    devices: TeacherAppDeviceRow[];
  };
  operations: {
    queuedConversationJobs: number;
    runningConversationJobs: number;
    staleConversationJobs: number;
    queuedSessionPartJobs: number;
    runningSessionPartJobs: number;
    staleSessionPartJobs: number;
    queuedTeacherRecordingJobs: number;
    runningTeacherRecordingJobs: number;
    staleTeacherRecordingJobs: number;
    archivedStudents: number;
    conversationJobRows: OperationsJobRow[];
    sessionPartJobRows: OperationsJobRow[];
    teacherRecordingJobRows: OperationsJobRow[];
    runpod: {
      configured: boolean;
      workerName: string | null;
      workerImage: string | null;
    };
    deletedConversations: DeletedContentRow[];
    deletedReports: DeletedContentRow[];
    recentAuditLogs: Array<{
      id: string;
      action: string;
      status: string;
      targetType: string | null;
      targetId: string | null;
      createdAt: string;
    }>;
  };
  sending: {
    provider: "resend" | "postmark" | "none";
    manualShareEnabled: boolean;
    emailConfigured: boolean;
    lineConfigured: boolean;
    emailStatusLabel: string;
    lineStatusLabel: string;
  };
  trust: {
    transcriptRetentionDays: number;
    reportDeliveryEventRetentionDays: number;
    guardianNoticeRequired: boolean;
    deletionRequestFlow: string;
  };
};
