import { toPrismaJson } from "@/lib/prisma-json";
import { sanitizeTranscriptText } from "@/lib/user-facing-japanese";

export type SessionPartPipelineStage =
  | "RECEIVED"
  | "TRANSCRIBING"
  | "WAITING_COUNTERPART"
  | "GENERATING"
  | "READY"
  | "REJECTED"
  | "ERROR";

export type SessionPartErrorSource =
  | "TRANSCRIPTION"
  | "PROMOTION";

export type SessionPartValidationRejection = {
  code?: string;
  messageJa?: string;
  metrics?: {
    significantChars?: number;
    minRequired?: number;
    uniqueRatio?: number;
  };
  at?: string;
};

export type SessionPartMeta = {
  pipelineStage?: SessionPartPipelineStage;
  errorSource?: SessionPartErrorSource;
  uploadMode?: "file_upload" | "direct_recording" | "manual";
  transcriptionPhase?:
    | "PREPARING_STT"
    | "TRANSCRIBING_EXTERNAL"
    | "TRANSCRIBING_LOCAL"
    | "FINALIZING_TRANSCRIPT";
  transcriptionPhaseUpdatedAt?: string;
  lastAcceptedAt?: string;
  lastQueuedAt?: string;
  lastCompletedAt?: string;
  lastError?: string | null;
  summaryPreview?: string;
  validationRejection?: SessionPartValidationRejection;
  liveTranscription?: boolean;
  liveChunkCount?: number;
  liveReadyChunkCount?: number;
  liveErrorChunkCount?: number;
  liveDurationSeconds?: number;
  [key: string]: unknown;
};

export function readSessionPartMeta(value: unknown): SessionPartMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as SessionPartMeta;
}

export function mergeSessionPartMeta(existing: unknown, patch: SessionPartMeta) {
  const base = readSessionPartMeta(existing);
  return {
    ...base,
    ...patch,
  };
}

export function toSessionPartMetaJson(existing: unknown, patch: SessionPartMeta) {
  return toPrismaJson(mergeSessionPartMeta(existing, patch));
}

export function buildSummaryPreview(text?: string | null) {
  const compact = sanitizeTranscriptText(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return undefined;
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}
