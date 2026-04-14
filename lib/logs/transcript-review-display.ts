import { TranscriptReviewState } from "@prisma/client";

export type TranscriptReviewReason = {
  code: string;
  message: string;
  count?: number;
};

export type TranscriptReviewMeta = {
  reasons: TranscriptReviewReason[];
  pendingSuggestionCount: number;
  suggestionCount: number;
  updatedAt?: string;
};

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function toReason(value: unknown): TranscriptReviewReason | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const reason = value as Record<string, unknown>;
  const code = typeof reason.code === "string" ? reason.code : "";
  const message = typeof reason.message === "string" ? reason.message : "";
  if (!code || !message) return null;
  const countValue = asNumber(reason.count);
  return {
    code,
    message,
    ...(Number.isFinite(countValue) ? { count: countValue } : {}),
  };
}

export function normalizeTranscriptReviewMeta(value: unknown): TranscriptReviewMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const source =
    root.transcriptReview && typeof root.transcriptReview === "object" && !Array.isArray(root.transcriptReview)
      ? (root.transcriptReview as Record<string, unknown>)
      : root;

  const reasons = Array.isArray(source.reasons)
    ? source.reasons.map(toReason).filter((item): item is TranscriptReviewReason => Boolean(item))
    : [];
  const pendingSuggestionCount = asNumber(source.pendingSuggestionCount);
  const suggestionCount = asNumber(source.suggestionCount);

  if (!reasons.length && !Number.isFinite(pendingSuggestionCount) && !Number.isFinite(suggestionCount)) {
    return null;
  }

  return {
    reasons,
    pendingSuggestionCount: Number.isFinite(pendingSuggestionCount) ? pendingSuggestionCount : 0,
    suggestionCount: Number.isFinite(suggestionCount) ? suggestionCount : 0,
    ...(typeof source.updatedAt === "string" && source.updatedAt ? { updatedAt: source.updatedAt } : {}),
  };
}

export function transcriptReviewStateLabel(state?: TranscriptReviewState | string | null) {
  if (state === TranscriptReviewState.REQUIRED) return "要確認";
  if (state === TranscriptReviewState.RESOLVED) return "確認済み";
  return "未評価";
}

export function transcriptReviewTone(
  state?: TranscriptReviewState | string | null,
  review?: TranscriptReviewMeta | null
): "neutral" | "low" | "medium" | "high" {
  if (state === TranscriptReviewState.REQUIRED) return "high";
  if (state === TranscriptReviewState.RESOLVED) return "low";
  if ((review?.pendingSuggestionCount ?? 0) > 0) return "medium";
  return "neutral";
}

export function transcriptReviewSummary(review?: TranscriptReviewMeta | null) {
  if (!review) return "レビュー情報はまだありません。";
  if (review.pendingSuggestionCount > 0) {
    return `${review.pendingSuggestionCount}件の確認待ち`;
  }
  if (review.suggestionCount > 0) {
    return `${review.suggestionCount}件を確認済み`;
  }
  return "確認対象はありません。";
}
