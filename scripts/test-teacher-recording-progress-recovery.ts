import assert from "node:assert/strict";
import { JobStatus } from "@prisma/client";
import {
  shouldRecoverTeacherRecordingProcessing,
  TEACHER_RECORDING_PROGRESS_RECOVERY_GRACE_MS,
} from "../lib/teacher-app/server/recording-progress-recovery";

const now = new Date("2026-04-22T00:00:30.000Z").getTime();

assert.equal(
  shouldRecoverTeacherRecordingProcessing(
    {
      uploadedAt: new Date(now - 5_000),
      processingLeaseExpiresAt: null,
      jobStatus: JobStatus.QUEUED,
    },
    now
  ),
  false,
  "freshly queued uploads should rely on the upload-triggered wake instead of GET polling"
);

assert.equal(
  shouldRecoverTeacherRecordingProcessing(
    {
      uploadedAt: new Date(now - (TEACHER_RECORDING_PROGRESS_RECOVERY_GRACE_MS + 1_000)),
      processingLeaseExpiresAt: null,
      jobStatus: JobStatus.QUEUED,
    },
    now
  ),
  true,
  "stale queued recordings should recover on progress polling"
);

assert.equal(
  shouldRecoverTeacherRecordingProcessing(
    {
      uploadedAt: new Date(now - 60_000),
      processingLeaseExpiresAt: new Date(now + 30_000),
      jobStatus: JobStatus.RUNNING,
    },
    now
  ),
  false,
  "actively leased jobs should not be re-woken on every poll"
);

assert.equal(
  shouldRecoverTeacherRecordingProcessing(
    {
      uploadedAt: new Date(now - 60_000),
      processingLeaseExpiresAt: new Date(now - 1_000),
      jobStatus: JobStatus.RUNNING,
    },
    now
  ),
  true,
  "expired running leases should recover on the next poll"
);

console.log("teacher recording progress recovery checks passed");
