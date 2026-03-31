import type { ConversationArtifact } from "@/lib/conversation-artifact";

export type SessionMode = "INTERVIEW" | "LESSON_REPORT";

export type ChatResult = {
  raw: string;
  contentText: string | null;
  finishReason?: string;
  refusal?: string;
};

export type DraftGenerationInput = {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
  durationMinutes?: number | null;
  minSummaryChars: number;
  sessionType?: SessionMode;
};

export type DraftGenerationResult = {
  summaryMarkdown: string;
  artifact: ConversationArtifact;
  model: string;
  apiCalls: number;
  evidenceChars: number;
  usedFallback: boolean;
  inputTokensEstimate: number;
};
