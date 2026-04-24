import { ConversationJobType, JobStatus, SessionType } from "@prisma/client";
import { readSessionPartMeta } from "@/lib/session-part-meta";
import type { ConversationPayload, JobPayload } from "./types";
import { normalizeRawTranscriptText, pickEvidenceTranscriptText } from "@/lib/transcript/source";

export const DEFAULT_JOB_TYPES: ConversationJobType[] = [ConversationJobType.FINALIZE];
export const ACTIVE_JOB_TYPES: ConversationJobType[] = [
  ConversationJobType.FINALIZE,
  ConversationJobType.GENERATE_NEXT_MEETING_MEMO,
  ConversationJobType.FORMAT,
];
export const JOB_PRIORITY: Partial<Record<ConversationJobType, number>> = {
  [ConversationJobType.FINALIZE]: 0,
  [ConversationJobType.GENERATE_NEXT_MEETING_MEMO]: 1,
  [ConversationJobType.FORMAT]: 2,
};

function readClampedEnvInt(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export const JOB_MAX_ATTEMPTS = readClampedEnvInt("JOB_MAX_ATTEMPTS", 3, 1, 10);
export const JOB_LEASE_MS = readClampedEnvInt("JOB_LEASE_MS", 5 * 60 * 1000, 30_000, 15 * 60 * 1000);
export const JOB_RETRY_BASE_MS = readClampedEnvInt("JOB_RETRY_BASE_MS", 15_000, 1_000, 5 * 60 * 1000);

export function isRetryableJobError(error: unknown) {
  const message =
    error instanceof Error ? `${error.name} ${error.message}` : typeof error === "string" ? error : "";
  return /(429|408|409|5\d\d|timeout|timed out|abort|temporar|overloaded|rate limit|fetch failed|network|econnreset|etimedout|socket)/i.test(
    message
  );
}

export function getRetryDelayMs(attempt: number) {
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(5 * 60 * 1000, JOB_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1)) + jitter;
}

export function normalizeSourceText(payload: ConversationPayload) {
  const evidence = pickEvidenceTranscriptText(payload);
  if (evidence) return evidence;
  if (payload.formattedTranscript?.trim()) {
    return normalizeRawTranscriptText(
      payload.formattedTranscript
        .split("\n")
        .map((line) => line.replace(/^\*\*[^*]+\*\*:\s*/g, ""))
        .join("\n")
        .trim()
    );
  }
  return "";
}

export function minSummaryCharsFor(input: { sessionType?: SessionType | null; sourceText: string }) {
  if (input.sourceText.length >= 12000) return 700;
  if (input.sourceText.length <= 2500) return 420;
  return 560;
}

export function deriveSessionDurationMinutes(parts: Array<{ qualityMetaJson?: unknown }> | undefined) {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const totalSeconds = parts.reduce((sum, part) => {
    const meta = readSessionPartMeta(part.qualityMetaJson);
    const seconds =
      typeof meta.audioDurationSeconds === "number"
        ? meta.audioDurationSeconds
        : typeof meta.liveDurationSeconds === "number"
          ? meta.liveDurationSeconds
          : null;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return sum;
    return sum + seconds;
  }, 0);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
  return Math.max(1, Math.round(totalSeconds / 60));
}

export function dependencySatisfied(
  type: ConversationJobType,
  statusByType: Map<ConversationJobType, JobStatus>
) {
  if (type === ConversationJobType.FINALIZE) return true;
  if (type === ConversationJobType.GENERATE_NEXT_MEETING_MEMO) {
    return statusByType.get(ConversationJobType.FINALIZE) === JobStatus.DONE;
  }
  if (type === ConversationJobType.FORMAT) {
    const finalizeStatus = statusByType.get(ConversationJobType.FINALIZE);
    return typeof finalizeStatus === "undefined" || finalizeStatus === JobStatus.DONE;
  }
  return false;
}

export function buildJobContext(job: JobPayload, convo?: ConversationPayload) {
  return {
    conversationId: job.conversationId,
    jobId: job.id,
    executionId: job.executionId,
    jobType: job.type,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    studentId: convo?.studentId ?? null,
    sessionId: convo?.sessionId ?? null,
  };
}

export function shouldGenerateNextMeetingMemo(convo: ConversationPayload) {
  return convo.sessionType === SessionType.INTERVIEW && Boolean(convo.sessionId);
}
