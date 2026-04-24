import assert from "node:assert/strict";
import { completeRunpodRemoteSttTask } from "../lib/runpod/remote-stt-queue";

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
await runSessionFailureCase();
await runSessionSuccessCase();

console.log("runpod remote STT completion regression checks passed");
