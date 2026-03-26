import type { ReportDeliveryState } from "@/lib/report-delivery";
import type { GenerationProgressState } from "@/lib/generation-progress";

export type SessionPipelineInfo = {
  stage: string;
  statusLabel: string;
  canLeavePage: boolean;
  canOpenLog: boolean;
  openLogId: string | null;
  waitingForPart: "CHECK_IN" | "CHECK_OUT" | null;
  progress: GenerationProgressState;
};

export type SessionPartItem = {
  id: string;
  partType: string;
  status: string;
  fileName?: string | null;
  previewText?: string | null;
  qualityMetaJson?: any;
};

export type SessionItem = {
  id: string;
  type: "INTERVIEW" | "LESSON_REPORT";
  status: string;
  title?: string | null;
  sessionDate: string;
  heroStateLabel?: string | null;
  heroOneLiner?: string | null;
  latestSummary?: string | null;
  parts: SessionPartItem[];
  pipeline?: SessionPipelineInfo;
  conversation?: {
    id: string;
    status: string;
    summaryMarkdown?: string | null;
    createdAt: string;
  } | null;
};

export type ReportHistoryItem = {
  id?: string;
  eventType: string;
  label: string;
  deliveryChannel?: string | null;
  note?: string | null;
  createdAt: string;
  actor?: { id?: string; name?: string | null; email?: string | null } | null;
};

export type ReportItem = {
  id: string;
  status: string;
  reportMarkdown: string;
  createdAt: string;
  sentAt?: string | null;
  reviewedAt?: string | null;
  deliveryChannel?: string | null;
  qualityChecksJson?: {
    bundleQualityEval?: {
      periodLabel?: string;
      logCount?: number;
      mainThemes?: string[];
      strongElements?: string[];
      weakElements?: string[];
      parentPoints?: string[];
      warnings?: string[];
      suggestedLogIds?: string[];
    };
  } | null;
  sourceLogIds?: string[] | null;
  workflowStatusLabel?: string;
  deliveryState?: ReportDeliveryState;
  deliveryStateLabel?: string;
  latestEvent?: ReportHistoryItem | null;
  history?: ReportHistoryItem[];
  isShareCompleted?: boolean;
  needsReview?: boolean;
  needsShare?: boolean;
};

export type RecordingLockInfo = {
  active: boolean;
  lock: null | {
    lockedByUserId: string;
    lockedByName: string;
    lockedByEmail?: string;
    mode: "INTERVIEW" | "LESSON_REPORT";
    expiresAt: string;
    isHeldByViewer: boolean;
  };
};

export type RoomResponse = {
  student: {
    id: string;
    name: string;
    grade?: string | null;
    course?: string | null;
    guardianNames?: string | null;
    profiles: Array<{ profileData?: any }>;
  };
  latestConversation?: {
    id: string;
    status: string;
    summaryMarkdown?: string | null;
    createdAt: string;
  } | null;
  latestProfile?: { profileData?: any } | null;
  sessions: SessionItem[];
  reports: ReportItem[];
  recordingLock?: RecordingLockInfo;
};

export type ReportStudioView = "selection" | "generated" | "send";
