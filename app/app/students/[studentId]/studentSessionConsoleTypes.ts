import type { SessionPipelineInfo } from "./roomTypes";
import type { SessionProgressTimingSnapshot } from "@/lib/session-progress/timing";

export type SessionConsoleMode = "INTERVIEW";
export type SessionConsoleLessonPart = "CHECK_IN" | "CHECK_OUT";
export type ConsoleState = "idle" | "preparing" | "recording" | "uploading" | "processing" | "success" | "error";
export type UploadSource = "file_upload" | "direct_recording";
export type StopIntent = "save" | "cancel";

export type PendingRecordingDraft = {
  key: string;
  file: File;
  createdAt: string;
  durationSeconds: number | null;
  sizeBytes: number;
};

export type SessionProgressResponse = {
  conversation?: {
    id: string;
    status: string;
  } | null;
  progress: SessionPipelineInfo;
  timing?: SessionProgressTimingSnapshot | null;
};
