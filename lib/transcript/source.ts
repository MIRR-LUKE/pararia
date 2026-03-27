import { sanitizeTranscriptText } from "@/lib/user-facing-japanese";

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

// Evidence path is reviewed -> raw. The legacy display field is only for rescue reads.
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

export function pickStoredDisplayTranscriptSource(source: TranscriptSource) {
  return (
    normalizeRawTranscriptText(source.reviewedText) ||
    normalizeRawTranscriptText(source.rawTextCleaned) ||
    normalizeRawTranscriptText(source.rawTextOriginal)
  );
}

export function pickDisplayTranscriptText(source: TranscriptSource) {
  return buildDisplayTranscriptText(pickStoredDisplayTranscriptSource(source));
}
