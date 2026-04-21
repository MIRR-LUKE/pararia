import { DEFAULT_MIN_RECORDING_DURATION_SEC } from "@/lib/recording/policy";
import type { PendingTeacherUploadItem } from "@/lib/teacher-app/types";
import type { PendingTeacherUploadRecord } from "@/lib/teacher-app/pending-upload-store";

export const TEACHER_MIN_RECORDING_SECONDS = DEFAULT_MIN_RECORDING_DURATION_SEC;

export function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
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

export function formatRecordingTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function buildTeacherRecordingFileName(recordingId: string, mimeType: string) {
  const ext = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mp4") || mimeType.includes("m4a")
      ? "m4a"
      : "webm";
  return `teacher-recording-${recordingId}-${new Date().toISOString().slice(0, 19)}.${ext}`;
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

export async function loadTeacherPendingUploadStoreModule() {
  return import("@/lib/teacher-app/pending-upload-store");
}

export function formatTeacherPendingRecordedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function toPendingTeacherUploadItem(record: PendingTeacherUploadRecord): PendingTeacherUploadItem {
  return {
    id: record.id,
    recordingId: record.recordingId,
    recordedAt: formatTeacherPendingRecordedAt(record.recordedAt),
    status: record.status,
    label: record.fileName,
    errorMessage: record.errorMessage,
  };
}
