import type { Prisma } from "@prisma/client";
import type { ConversationQualityMeta } from "@/lib/types/conversation";
import type { ConversationJobType, SessionType } from "@prisma/client";

export type JobPayload = {
  id: string;
  conversationId: string;
  type: ConversationJobType;
  attempt: number;
  maxAttempts: number;
  executionId: string;
  createdAt: Date;
  startedAt: Date;
  lastQueueLagMs: number;
};

export type ProcessJobsOptions = {
  conversationId?: string;
  sessionId?: string;
  executionId?: string;
  stopWhenConversationDone?: boolean;
};

export type ConversationPayload = {
  id: string;
  organizationId: string;
  studentId: string;
  sessionId?: string | null;
  sessionType?: SessionType | null;
  sessionDate?: Date | string | null;
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  reviewedText?: string | null;
  rawSegments?: any[] | null;
  formattedTranscript?: string | null;
  summaryMarkdown?: string | null;
  artifactJson?: Prisma.JsonValue | null;
  studentName?: string | null;
  teacherName?: string | null;
  durationMinutes?: number | null;
  qualityMetaJson?: ConversationQualityMeta | null;
};
