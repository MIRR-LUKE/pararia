import type { PlatformRole } from "@prisma/client";

export type AdminCampusStatus = "needs_attention" | "active" | "onboarding" | "suspended";
export type AdminAttentionSeverity = "critical" | "warning" | "info";
export type AdminJobKind =
  | "conversation"
  | "session_part"
  | "teacher_recording"
  | "storage_deletion"
  | "delivery"
  | "runpod";

export type PlatformAdminPermissionSet = {
  canReadAllCampuses: boolean;
  canReadAuditLogs: boolean;
  canPrepareWriteActions: boolean;
  canExecuteDangerousActions: boolean;
  canManagePlatformOperators: boolean;
};

export type PlatformOperatorContext = {
  id: string;
  role: PlatformRole;
  displayName: string | null;
  permissions: PlatformAdminPermissionSet;
};

export type AdminCampusSummary = {
  id: string;
  name: string;
  status: AdminCampusStatus;
  statusLabel: string;
  customerLabel: string;
  planCode: string;
  contractStatus: string;
  contractRenewalDate: string | null;
  csOwnerName: string | null;
  studentLimit: number | null;
  activeStudentCount: number;
  archivedStudentCount: number;
  userCount: number;
  activeTeacherDeviceCount: number;
  openIssueCount: number;
  queuedJobCount: number;
  runningJobCount: number;
  staleJobCount: number;
  failedJobCount: number;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminCampusListResult = {
  campuses: AdminCampusSummary[];
  totalCount: number;
  page: {
    take: number;
    skip: number;
    hasMore: boolean;
  };
};

export type AdminAttentionItem = {
  id: string;
  campusId: string | null;
  campusName: string | null;
  severity: AdminAttentionSeverity;
  kind: AdminJobKind;
  status: string;
  statusLabel: string;
  title: string;
  causeLabel: string;
  nextActionLabel: string;
  targetType: string | null;
  targetId: string | null;
  occurredAt: string | null;
  elapsedSeconds: number | null;
};

export type AdminJobHealthSummary = {
  kind: AdminJobKind;
  label: string;
  queued: number;
  running: number;
  stale: number;
  failed: number;
  oldestQueuedAt: string | null;
  oldestRunningStartedAt: string | null;
};

export type AdminCrossCampusJobHealth = {
  generatedAt: string;
  staleThresholdMinutes: number;
  groups: AdminJobHealthSummary[];
  attentionItems: AdminAttentionItem[];
  runpod: {
    configured: boolean;
    workerName: string | null;
    workerImage: string | null;
  };
};

export type AdminCampusDetail = {
  campus: AdminCampusSummary;
  overview: {
    defaultLocale: string;
    defaultTimeZone: string;
    guardianConsentRequired: boolean;
    consentVersion: string | null;
    consentUpdatedAt: string | null;
    conversationCount: number;
    sessionCount: number;
    reportCount: number;
    deletedConversationCount: number;
    deletedReportCount: number;
  };
  contract: {
    status: string;
    renewalDate: string | null;
    billingContactName: string | null;
    billingContactEmail: string | null;
    salesOwnerName: string | null;
    csOwnerName: string | null;
    usageLimitNote: string | null;
    supportNote: string | null;
  };
  users: {
    total: number;
    byRole: Record<string, number>;
    pendingInvitationCount: number;
    expiredInvitationCount: number;
  };
  jobs: AdminCrossCampusJobHealth;
  devices: {
    total: number;
    active: number;
    revoked: number;
    recentlySeen: number;
  };
  audits: {
    recentPlatformActions: Array<{
      id: string;
      action: string;
      status: string;
      riskLevel: string;
      targetType: string | null;
      targetId: string | null;
      createdAt: string;
    }>;
  };
};

export type PlatformAdminSnapshot = {
  generatedAt: string;
  operator: PlatformOperatorContext | null;
  summary: {
    campusCount: number;
    needsAttentionCampusCount: number;
    queuedJobCount: number;
    runningJobCount: number;
    staleJobCount: number;
    failedJobCount: number;
  };
  campuses: AdminCampusListResult;
  attention: AdminAttentionItem[];
  jobHealth: AdminCrossCampusJobHealth;
};
