import type {
  ProperNounKind,
  ProperNounSuggestionSource,
  ProperNounSuggestionStatus,
  SessionPartType,
  TranscriptReviewState,
} from "@prisma/client";

export type GlossaryCandidate = {
  glossaryEntryId?: string | null;
  canonicalValue: string;
  aliases: string[];
  kind: ProperNounKind;
  source: ProperNounSuggestionSource;
  reasonPrefix: string;
  sendToProvider: boolean;
};

export type SuggestionSpan = {
  start: number;
  end: number;
  line: number;
};

export type SuggestionDraft = {
  kind: ProperNounKind;
  rawValue: string;
  suggestedValue: string;
  reason: string;
  confidence: number;
  source: ProperNounSuggestionSource;
  span: SuggestionSpan;
  glossaryEntryId?: string | null;
};

export type StoredSuggestion = {
  id: string;
  kind: ProperNounKind;
  rawValue: string;
  suggestedValue: string;
  finalValue: string | null;
  reason: string;
  confidence: number;
  source: ProperNounSuggestionSource;
  status: ProperNounSuggestionStatus;
  glossaryEntryId: string | null;
  spanJson: unknown;
  sessionPartId?: string | null;
};

export type ReviewReason = {
  code: string;
  message: string;
  count?: number;
};

export type ReviewAssessment = {
  reviewState: TranscriptReviewState;
  reviewRequired: boolean;
  reasons: ReviewReason[];
  pendingSuggestionCount: number;
  suggestionCount: number;
};

export type SessionPartReviewSummary = ReviewAssessment & {
  reviewedText: string;
};

export type ConversationReviewSummary = ReviewAssessment & {
  reviewedText: string;
  rawTextOriginal: string;
};

export type ConversationSuggestionList = {
  conversationId: string;
  rawTextOriginal: string;
  reviewedText: string;
  displayText: string;
  reviewState: TranscriptReviewState;
  qualityMetaJson: unknown;
  suggestions: Array<
    StoredSuggestion & {
      span: SuggestionSpan | null;
      partType?: SessionPartType;
    }
  >;
};
