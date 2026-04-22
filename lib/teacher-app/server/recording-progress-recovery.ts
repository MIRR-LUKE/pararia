import { JobStatus } from "@prisma/client";

export const TEACHER_RECORDING_PROGRESS_WAKE_COOLDOWN_MS = 30_000;
export const TEACHER_RECORDING_PROGRESS_RECOVERY_GRACE_MS = 15_000;

export type TeacherRecordingProgressWakeState = {
  uploadedAt: Date | null;
  processingLeaseExpiresAt: Date | null;
  jobStatus: JobStatus | null;
};

export function shouldRecoverTeacherRecordingProcessing(
  state: TeacherRecordingProgressWakeState,
  now = Date.now()
) {
  const uploadedAtMs = state.uploadedAt?.getTime() ?? 0;
  const leaseExpiresAtMs = state.processingLeaseExpiresAt?.getTime() ?? 0;
  const withinGraceWindow =
    uploadedAtMs > 0 && now - uploadedAtMs < TEACHER_RECORDING_PROGRESS_RECOVERY_GRACE_MS;

  if (state.jobStatus === JobStatus.RUNNING) {
    return leaseExpiresAtMs <= now;
  }

  if (state.jobStatus === JobStatus.QUEUED) {
    return !withinGraceWindow;
  }

  return false;
}
