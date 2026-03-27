import { sanitizeTranscriptText } from "@/lib/user-facing-japanese";

// Database columns keep raw / reviewed / legacy display text separately.
type TranscriptSource = {
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  reviewedText?: string | null;
};

export function normalizeRawTranscriptText(text: unknown) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

export function buildDisplayTranscriptText(text: unknown) {
  return sanitizeTranscriptText(normalizeRawTranscriptText(text));
}

// Evidence path is always reviewed -> raw.
// The legacy display field is only for rescue reads when old records are missing raw text.
export function pickEvidenceTranscriptText(source: TranscriptSource, options?: { allowLegacyDisplayFallback?: boolean }) {
  const reviewedText = normalizeRawTranscriptText(source.reviewedText);
  if (reviewedText) return reviewedText;

  const rawTextOriginal = normalizeRawTranscriptText(source.rawTextOriginal);
  if (rawTextOriginal) return rawTextOriginal;

  if (options?.allowLegacyDisplayFallback) {
    return normalizeRawTranscriptText(source.rawTextCleaned);
  }

  return "";
}

// Stored display text prefers reviewed text, then the legacy preview field, then raw.
export function pickStoredDisplayTranscriptSource(source: TranscriptSource) {
  return (
    normalizeRawTranscriptText(source.reviewedText) ||
    normalizeRawTranscriptText(source.rawTextCleaned) ||
    normalizeRawTranscriptText(source.rawTextOriginal)
  );
}

// UI display goes through user-facing cleanup on top of the stored display source.
export function pickDisplayTranscriptText(source: TranscriptSource) {
  return buildDisplayTranscriptText(pickStoredDisplayTranscriptSource(source));
}
