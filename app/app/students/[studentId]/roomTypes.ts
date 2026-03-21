import type { OperationalLog } from "@/lib/operational-log";

export type TopicCard = {
  category: string;
  title: string;
  reason: string;
  question: string;
  priority: number;
};

export type NextAction = {
  owner: string;
  action: string;
  due: string | null;
  metric: string;
  why: string;
};

export type ProfileSection = {
  category: string;
  status: string;
  highlights: Array<{ label: string; value: string; isNew?: boolean; isUpdated?: boolean }>;
  nextQuestion: string;
};

export type StudentState = {
  label: string;
  oneLiner: string;
  rationale: string[];
  confidence: number;
};

export type SessionEntity = {
  id: string;
  kind: string;
  rawValue: string;
  canonicalValue?: string | null;
  confidence: number;
  status: string;
};

export type LessonReportArtifact = {
  goal?: string;
  did?: string[];
  blocked?: string[];
  homework?: string[];
  nextLessonFocus?: string[];
  parentShare?: string;
  coachMemo?: string;
};

export type SessionPartItem = {
  id: string;
  partType: string;
  status: string;
  fileName?: string | null;
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
  pendingEntityCount: number;
  parts: SessionPartItem[];
  entities: SessionEntity[];
  conversation?: {
    id: string;
    status: string;
    summaryMarkdown?: string | null;
    operationalLog?: OperationalLog | null;
    operationalSummaryMarkdown?: string | null;
    studentStateJson?: StudentState | null;
    topicSuggestionsJson?: TopicCard[] | null;
    quickQuestionsJson?: Array<{ question: string; reason?: string; category?: string }> | null;
    nextActionsJson?: NextAction[] | null;
    profileSectionsJson?: ProfileSection[] | null;
    lessonReportJson?: LessonReportArtifact | null;
    createdAt: string;
  } | null;
};

export type ReportItem = {
  id: string;
  status: string;
  reportMarkdown: string;
  createdAt: string;
  sentAt?: string | null;
  qualityChecksJson?: {
    pendingEntityCount?: number;
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
    operationalLog?: OperationalLog | null;
    operationalSummaryMarkdown?: string | null;
    studentStateJson?: StudentState | null;
    topicSuggestionsJson?: TopicCard[] | null;
    nextActionsJson?: NextAction[] | null;
    profileSectionsJson?: ProfileSection[] | null;
    createdAt: string;
  } | null;
  latestProfile?: { profileData?: any } | null;
  sessions: SessionItem[];
  reports: ReportItem[];
  recordingLock?: RecordingLockInfo;
};

export type ReportStudioView = "selection" | "generated" | "send";
