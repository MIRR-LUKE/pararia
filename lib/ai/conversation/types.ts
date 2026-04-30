import type { ConversationArtifact } from "@/lib/conversation-artifact";

export type SessionMode = "INTERVIEW";

export type ChatResult = {
  raw: string;
  contentText: string | null;
  finishReason?: string;
  refusal?: string;
  usage?: LlmTokenUsage;
};

export type LlmTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
};

export type PromptCacheRetention = "in_memory" | "24h";

export type DraftGenerationInput = {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
  durationMinutes?: number | null;
  minSummaryChars: number;
  sessionType?: SessionMode;
  promptCacheNamespace?: string | null;
  promptCacheRetention?: PromptCacheRetention | null;
};

export type DraftGenerationResult = {
  summaryMarkdown: string;
  artifact: ConversationArtifact;
  model: string;
  apiCalls: number;
  evidenceChars: number;
  usedFallback: boolean;
  inputTokensEstimate: number;
  tokenUsage: LlmTokenUsage;
  llmCostUsd: number;
  llmCostJpy: number;
  llmCostUsdJpyRate: number;
  promptCacheKey?: string;
  promptCacheRetention?: PromptCacheRetention;
  promptCacheStablePrefixChars?: number;
  promptCacheStablePrefixTokensEstimate?: number;
};
