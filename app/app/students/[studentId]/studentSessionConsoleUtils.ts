import type { PendingRecordingDraft, SessionConsoleLessonPart, SessionConsoleMode } from "./studentSessionConsoleTypes";
import type { PendingRecordingDraftRecord } from "@/lib/recording/pendingRecordingStore";
import {
  DEFAULT_MIN_RECORDING_DURATION_SEC,
  buildRecordingTooLongMessage,
  buildRecordingTooShortMessage,
  getDefaultMaxRecordingDurationSeconds,
} from "@/lib/recording/policy";
import { isLiveChunkUploadEnabled } from "@/lib/recording/live-chunk-upload";

export const MAX_SECONDS: Record<SessionConsoleMode, number> = {
  INTERVIEW: getDefaultMaxRecordingDurationSeconds("INTERVIEW"),
};
export const MIN_SECONDS = DEFAULT_MIN_RECORDING_DURATION_SEC;
export const MIN_SECONDS_BEFORE_SAVE_ENABLED = MIN_SECONDS + 1;
export const RECORDING_TIMESLICE_MS = 1000;
export const LIVE_STT_WINDOW_MS: Record<SessionConsoleMode, number> = {
  INTERVIEW: 15_000,
};
export const CLIENT_AUDIO_STORAGE_MODE =
  process.env.NEXT_PUBLIC_AUDIO_STORAGE_MODE?.trim().toLowerCase() === "blob" ? "blob" : "local";
export const LIVE_CHUNK_UPLOAD_ENABLED = isLiveChunkUploadEnabled();

export async function loadPendingRecordingStoreModule() {
  return import("@/lib/recording/pendingRecordingStore");
}

export async function loadBlobUploadModule() {
  return import("@/lib/blob-browser-upload");
}

export function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function modeLabel(mode: SessionConsoleMode, part: SessionConsoleLessonPart) {
  return "面談";
}

export function buildUploadFileName(
  studentId: string,
  mode: SessionConsoleMode,
  part: SessionConsoleLessonPart,
  mimeType: string
) {
  const ext = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("wav")
      ? "wav"
      : mimeType.includes("mp4") || mimeType.includes("m4a")
        ? "m4a"
        : "webm";
  const prefix = "interview";
  return `${prefix}-${studentId}-${new Date().toISOString().slice(0, 19)}.${ext}`;
}

export function buildChunkUploadFileName(baseName: string, sequence: number) {
  const dotIndex = baseName.lastIndexOf(".");
  if (dotIndex === -1) return `${baseName}-chunk-${String(sequence).padStart(4, "0")}`;
  return `${baseName.slice(0, dotIndex)}-chunk-${String(sequence).padStart(4, "0")}${baseName.slice(dotIndex)}`;
}

export function pickRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null;
}

export function getDurationValidationMessage(
  mode: SessionConsoleMode,
  durationSeconds: number | null
) {
  if (durationSeconds !== null && durationSeconds < MIN_SECONDS) {
    return buildRecordingTooShortMessage(MIN_SECONDS);
  }
  if (durationSeconds !== null && durationSeconds > MAX_SECONDS[mode]) {
    return buildRecordingTooLongMessage(mode, MAX_SECONDS[mode]);
  }
  return null;
}

export function readAudioDurationSeconds(file: File) {
  return new Promise<number | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.src = "";
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : null;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      resolve(null);
    };
    audio.src = url;
  });
}

export function toPendingDraft(record: PendingRecordingDraftRecord): PendingRecordingDraft {
  const file = new File([record.blob], record.fileName, {
    type: record.mimeType || "audio/webm",
    lastModified: Date.parse(record.updatedAt) || Date.now(),
  });
  return {
    key: record.key,
    file,
    createdAt: record.createdAt,
    durationSeconds: record.durationSeconds,
    sizeBytes: record.sizeBytes,
  };
}
