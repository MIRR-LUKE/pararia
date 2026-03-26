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
  minSummaryChars: number;
  sessionType?: SessionMode;
};

export type DraftGenerationResult = {
  summaryMarkdown: string;
  model: string;
  apiCalls: number;
  evidenceChars: number;
  usedFallback: boolean;
  inputTokensEstimate: number;
};
