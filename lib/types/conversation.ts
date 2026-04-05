export type ConversationQualityMeta = {
  modelFinalize?: string;
  summaryCharCount?: number;
  sttSeconds?: number;
  sttModel?: string;
  sttResponseFormat?: string;
  sttRecoveryUsed?: boolean;
  sttAttemptCount?: number;
  sttSegmentCount?: number;
  sttSpeakerCount?: number;
  sttQualityWarnings?: string[];
  preprocessSeconds?: number;
  jobSecondsFinalize?: number;
  jobSecondsFormat?: number;
  llmApiCallsFinalize?: number;
  promptVersion?: string;
  generatedAt?: string;
  inputTokensEstimate?: number;
  outputTokensEstimate?: number;
  llmInputTokensActual?: number;
  llmCachedInputTokensActual?: number;
  llmOutputTokensActual?: number;
  llmCostUsd?: number;
  usedFallbackSummary?: boolean;
  reviewReasonCodes?: string[];
  usedReviewedTranscript?: boolean;
  // reviewState is the current source of truth.
  // transcriptReview only keeps explanation metadata for UI / ops.
  transcriptReview?: {
    reasons?: Array<{ code?: string; message?: string; count?: number }>;
    pendingSuggestionCount?: number;
    suggestionCount?: number;
    updatedAt?: string;
  };
  errors?: string[];
  finalizeJob?: Record<string, unknown>;
  formatJob?: Record<string, unknown>;
  lastJobFailure?: Record<string, unknown>;
};
