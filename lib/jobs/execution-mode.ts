import { getAudioStorageMode } from "@/lib/audio-storage";

const BACKGROUND_MODE_ENV = "PARARIA_BACKGROUND_MODE";

export type BackgroundExecutionMode = "inline" | "external";

export function getBackgroundExecutionMode(): BackgroundExecutionMode {
  const raw = process.env[BACKGROUND_MODE_ENV]?.trim().toLowerCase();
  if (raw === "external") return "external";
  return "inline";
}

export function shouldRunBackgroundJobsInline() {
  return getBackgroundExecutionMode() === "inline";
}

export function getExternalWorkerAudioStorageError() {
  if (shouldRunBackgroundJobsInline()) return null;
  if (getAudioStorageMode() === "blob") return null;
  return "Runpod worker を使う external mode では `PARARIA_AUDIO_STORAGE_MODE=blob` が必要です。";
}
