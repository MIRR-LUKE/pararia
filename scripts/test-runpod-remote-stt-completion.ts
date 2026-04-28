import assert from "node:assert/strict";
import { JobStatus } from "@prisma/client";
import { completeRunpodRemoteSttTask } from "../lib/runpod/remote-stt-queue";
import { TeacherRecordingStatusTransitionError } from "../lib/teacher-app/server/recording-status";

const teacherSuccessResult = {
  kind: "success" as const,
  transcriptText: "こんにちは",
  rawTextOriginal: "こんにちは",
  segments: [],
  meta: {},
  outputJson: {},
  costMetaJson: {},
};

const sessionSuccessResult = {
  kind: "success" as const,
  rawTextOriginal: "こんにちは",
  rawTextCleaned: "こんにちは",
  rawSegments: [],
  qualityMeta: {},
  outputJson: {},
  costMetaJson: {},
};

async function runTeacherFailureCase() {
  const events: string[] = [];

  await completeRunpodRemoteSttTask(
    {
      taskKind: "teacher_recording",
      jobId: "teacher-job-error",
      result: {
        kind: "error",
        errorMessage: "teacher worker failed",
      },
    },
    {
      completeTeacherRecordingFailure: async (jobId, failure) => {
        events.push(`teacher-failure:${jobId}:${failure.errorMessage}`);
      },
      completeTeacherRecordingSuccess: async () => {
        events.push("teacher-success");
      },
    }
  );

  assert.deepEqual(events, ["teacher-failure:teacher-job-error:teacher worker failed"]);
}

async function runTeacherSuccessCase() {
  const events: string[] = [];

  await completeRunpodRemoteSttTask(
    {
      taskKind: "teacher_recording",
      jobId: "teacher-job-success",
      result: teacherSuccessResult,
    },
    {
      completeTeacherRecordingFailure: async () => {
        events.push("teacher-failure");
      },
      completeTeacherRecordingSuccess: async (jobId, result) => {
        events.push(`teacher-success:${jobId}:${result.transcriptText}`);
      },
    }
  );

  assert.deepEqual(events, ["teacher-success:teacher-job-success:こんにちは"]);
}

async function runTeacherSuccessImplementationCase() {
  const events: string[] = [];
  const job = {
    id: "teacher-job-success-impl",
    executionId: "teacher-execution-success-impl",
    recordingSessionId: "teacher-recording-success-impl",
    recordingSession: {
      organizationId: "org-success-impl",
    },
  };

  await completeRunpodRemoteSttTask(
    {
      taskKind: "teacher_recording",
      jobId: job.id,
      result: teacherSuccessResult,
    },
    {
      teacherRecordingSuccessDeps: {
        findJob: async (jobId) => {
          events.push(`find:${jobId}`);
          return job;
        },
        applyResult: async (input) => {
          events.push(`apply:${input.recordingId}:${input.organizationId}:${input.result.transcriptText}`);
        },
        markJobDone: async (input) => {
          events.push(`update:${input.jobId}:${JobStatus.DONE}`);
          assert.equal(input.result.transcriptText, teacherSuccessResult.transcriptText);
        },
        markJobError: async () => {
          events.push("unexpected-error-update");
        },
        releaseLease: async (recordingId, executionId) => {
          events.push(`release:${recordingId}:${executionId}`);
        },
        maybeStopGpuQueuesIdle: async () => {
          events.push("idle-stop");
        },
      },
    }
  );

  assert.deepEqual(events, [
    "find:teacher-job-success-impl",
    "apply:teacher-recording-success-impl:org-success-impl:こんにちは",
    `update:${job.id}:${JobStatus.DONE}`,
    "release:teacher-recording-success-impl:teacher-execution-success-impl",
    "idle-stop",
  ]);
}

async function runTeacherStaleCompletionImplementationCase() {
  const events: string[] = [];
  const job = {
    id: "teacher-job-stale-impl",
    executionId: "teacher-execution-stale-impl",
    recordingSessionId: "teacher-recording-stale-impl",
    recordingSession: {
      organizationId: "org-stale-impl",
    },
  };

  await completeRunpodRemoteSttTask(
    {
      taskKind: "teacher_recording",
      jobId: job.id,
      result: teacherSuccessResult,
    },
    {
      teacherRecordingSuccessDeps: {
        findJob: async (jobId) => {
          events.push(`find:${jobId}`);
          return job;
        },
        applyResult: async () => {
          events.push("apply-stale");
          throw new TeacherRecordingStatusTransitionError(
            "Teacher録音の状態を更新できませんでした。最新の状態を確認してください。"
          );
        },
        markJobDone: async () => {
          events.push("unexpected-done-update");
        },
        markJobError: async (input) => {
          events.push(`mark-error:${input.jobId}:${JobStatus.RUNNING}:${input.executionId}:${JobStatus.ERROR}`);
          assert.equal(input.jobId, job.id);
          assert.equal(input.executionId, job.executionId);
          assert.match(input.lastError, /recording state changed/);
          assert.match(input.lastError, /最新の状態/);
        },
        releaseLease: async (recordingId, executionId) => {
          events.push(`release:${recordingId}:${executionId}`);
        },
        maybeStopGpuQueuesIdle: async () => {
          events.push("idle-stop");
        },
      },
    }
  );

  assert.deepEqual(events, [
    "find:teacher-job-stale-impl",
    "apply-stale",
    `mark-error:${job.id}:${JobStatus.RUNNING}:${job.executionId}:${JobStatus.ERROR}`,
    "release:teacher-recording-stale-impl:teacher-execution-stale-impl",
    "idle-stop",
  ]);
}

async function runSessionFailureCase() {
  const events: string[] = [];

  await completeRunpodRemoteSttTask(
    {
      taskKind: "session_part_transcription",
      jobId: "session-job-error",
      result: {
        kind: "error",
        errorMessage: "session worker failed",
      },
    },
    {
      completeSessionPartFailure: async (jobId, failure) => {
        events.push(`session-failure:${jobId}:${failure.errorMessage}`);
      },
      completeSessionPartSuccess: async () => {
        events.push("session-success");
      },
    }
  );

  assert.deepEqual(events, ["session-failure:session-job-error:session worker failed"]);
}

async function runSessionSuccessCase() {
  const events: string[] = [];

  await completeRunpodRemoteSttTask(
    {
      taskKind: "session_part_transcription",
      jobId: "session-job-success",
      result: sessionSuccessResult,
    },
    {
      completeSessionPartFailure: async () => {
        events.push("session-failure");
      },
      completeSessionPartSuccess: async (jobId, result) => {
        const cleaned =
          "rawTextCleaned" in result ? result.rawTextCleaned : "unexpected-session-result";
        events.push(`session-success:${jobId}:${cleaned}`);
      },
    }
  );

  assert.deepEqual(events, ["session-success:session-job-success:こんにちは"]);
}

await runTeacherFailureCase();
await runTeacherSuccessCase();
await runTeacherSuccessImplementationCase();
await runTeacherStaleCompletionImplementationCase();
await runSessionFailureCase();
await runSessionSuccessCase();

console.log("runpod remote STT completion regression checks passed");
