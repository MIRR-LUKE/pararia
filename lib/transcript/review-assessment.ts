import {
  ProperNounSuggestionStatus,
  SessionType,
  TranscriptReviewState,
} from "@prisma/client";
import { extractMarkdownSectionBody, transcriptLines } from "@/lib/ai/conversation/shared";
import type { ReviewAssessment, ReviewReason } from "@/lib/transcript/review-types";
import { countMeaningfulChars } from "@/lib/transcript/review-shared";

function assessReviewState(reasons: ReviewReason[], suggestions: Array<{ status: ProperNounSuggestionStatus }>): ReviewAssessment {
  const pendingSuggestionCount = suggestions.filter((item) => item.status === ProperNounSuggestionStatus.PENDING).length;
  const reviewRequired = reasons.length > 0;
  let reviewState: TranscriptReviewState = TranscriptReviewState.NONE;
  if (reviewRequired) {
    reviewState = TranscriptReviewState.REQUIRED;
  } else if (suggestions.length > 0) {
    reviewState = TranscriptReviewState.RESOLVED;
  }
  return {
    reviewState,
    reviewRequired,
    reasons,
    pendingSuggestionCount,
    suggestionCount: suggestions.length,
  };
}

export function assessSessionPartReview(input: {
  rawTextOriginal: string;
  suggestions: Array<{ status: ProperNounSuggestionStatus }>;
  qualityMetaJson?: unknown;
}) {
  const qualityMeta =
    input.qualityMetaJson && typeof input.qualityMetaJson === "object" && !Array.isArray(input.qualityMetaJson)
      ? (input.qualityMetaJson as Record<string, unknown>)
      : {};
  const sttWarnings = Array.isArray(qualityMeta.sttQualityWarnings)
    ? qualityMeta.sttQualityWarnings.filter((item): item is string => typeof item === "string")
    : [];
  const reasons: ReviewReason[] = [];
  const pendingSuggestionCount = input.suggestions.filter((item) => item.status === ProperNounSuggestionStatus.PENDING).length;
  if (pendingSuggestionCount > 0) {
    reasons.push({
      code: "pending_proper_noun",
      message: "固有名詞の候補があり、確認が必要です。",
      count: pendingSuggestionCount,
    });
  }
  if (pendingSuggestionCount >= 6) {
    reasons.push({
      code: "too_many_proper_noun_candidates",
      message: "固有名詞候補が多く、自動補正だけでは危険です。",
      count: pendingSuggestionCount,
    });
  }
  if (sttWarnings.length > 0) {
    reasons.push({
      code: "stt_quality_warning",
      message: "文字起こし品質の注意が出ています。",
      count: sttWarnings.length,
    });
  }
  if (countMeaningfulChars(input.rawTextOriginal) < 40) {
    reasons.push({
      code: "transcript_too_short",
      message: "文字起こしが短く、確認が必要です。",
    });
  }
  return assessReviewState(reasons, input.suggestions);
}

export function assessConversationReview(input: {
  sessionType?: SessionType | null;
  rawTextOriginal: string;
  suggestions: Array<{ status: ProperNounSuggestionStatus }>;
  qualityMetaJson?: unknown;
}) {
  const qualityMeta =
    input.qualityMetaJson && typeof input.qualityMetaJson === "object" && !Array.isArray(input.qualityMetaJson)
      ? (input.qualityMetaJson as Record<string, unknown>)
      : {};
  const reasons: ReviewReason[] = [];
  const pendingSuggestionCount = input.suggestions.filter((item) => item.status === ProperNounSuggestionStatus.PENDING).length;
  if (pendingSuggestionCount > 0) {
    reasons.push({
      code: "pending_proper_noun",
      message: "固有名詞候補が残っているため、確認した方が安全です。",
      count: pendingSuggestionCount,
    });
  }
  if (pendingSuggestionCount >= 6) {
    reasons.push({
      code: "too_many_proper_noun_candidates",
      message: "固有名詞候補が多く、確認が必要です。",
      count: pendingSuggestionCount,
    });
  }
  if (qualityMeta.usedFallbackSummary === true) {
    reasons.push({
      code: "fallback_used",
      message: "保守的な fallback でログを作成しました。",
    });
  }
  const sttWarnings = Array.isArray(qualityMeta.sttQualityWarnings)
    ? qualityMeta.sttQualityWarnings.filter((item): item is string => typeof item === "string")
    : [];
  if (sttWarnings.length > 0) {
    reasons.push({
      code: "stt_quality_warning",
      message: "文字起こし品質の注意が残っています。",
      count: sttWarnings.length,
    });
  }
  if (countMeaningfulChars(input.rawTextOriginal) < 80) {
    reasons.push({
      code: "transcript_too_short",
      message: "会話ログ生成に使う入力が短いため、確認が必要です。",
    });
  }
  const lines = transcriptLines(input.rawTextOriginal);
  if (input.sessionType === SessionType.INTERVIEW && lines.length < 5) {
    reasons.push({
      code: "weak_interview_input",
      message: "面談の入力が弱く、根拠が足りない可能性があります。",
    });
  }
  return assessReviewState(reasons, input.suggestions);
}

export function buildReviewMetaPatch(review: ReviewAssessment) {
  return {
    transcriptReview: {
      reasons: review.reasons,
      pendingSuggestionCount: review.pendingSuggestionCount,
      suggestionCount: review.suggestionCount,
      updatedAt: new Date().toISOString(),
    },
  };
}
