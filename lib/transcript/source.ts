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

export function pickEvidenceTranscriptText(source: TranscriptSource) {
  return (
    normalizeRawTranscriptText(source.reviewedText) ||
    normalizeRawTranscriptText(source.rawTextOriginal) ||
    normalizeRawTranscriptText(source.rawTextCleaned)
  );
}

export function pickDisplayTranscriptText(source: TranscriptSource) {
  return (
    buildDisplayTranscriptText(source.rawTextCleaned) ||
    buildDisplayTranscriptText(source.reviewedText) ||
    buildDisplayTranscriptText(source.rawTextOriginal)
  );
}
