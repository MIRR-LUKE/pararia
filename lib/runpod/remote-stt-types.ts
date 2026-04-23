import type { SessionPartTranscriptionResult } from "@/lib/runpod/stt/session-part-task";
import type { TeacherRecordingTranscriptionResult } from "@/lib/runpod/stt/teacher-recording-task";

export type RunpodRemoteTeacherRecordingTask = {
  kind: "teacher_recording";
  jobId: string;
  recordingId: string;
  audioStorageUrl: string;
  audioFileName: string;
  audioMimeType: string | null;
};

export type RunpodRemoteSessionPartTask = {
  kind: "session_part_transcription";
  jobId: string;
  sessionPartId: string;
  sessionId: string;
  storageUrl: string;
  fileName: string | null;
  mimeType: string | null;
  qualityMetaJson: Record<string, unknown> | null;
  sessionType: string;
};

export type RunpodRemoteSttTask =
  | RunpodRemoteTeacherRecordingTask
  | RunpodRemoteSessionPartTask;

export type RunpodRemoteSttClaimResponse = {
  ok: true;
  task: RunpodRemoteSttTask | null;
};

export type RunpodRemoteTaskFailure = {
  kind: "error";
  errorMessage: string;
};

export type RunpodRemoteSttSubmitRequest =
  | {
      taskKind: "teacher_recording";
      jobId: string;
      result: TeacherRecordingTranscriptionResult | RunpodRemoteTaskFailure;
    }
  | {
      taskKind: "session_part_transcription";
      jobId: string;
      result: SessionPartTranscriptionResult | RunpodRemoteTaskFailure;
    };
