import assert from "node:assert/strict";
import { kickTeacherRecordingProcessing } from "../app/api/teacher/recordings/[id]/progress/route";

async function runForcedExternalCase() {
  const events: string[] = [];

  const result = await kickTeacherRecordingProcessing("teacher-recording-progress", true, {
    processTeacherRecordingInline: async (recordingId) => {
      events.push(`process:${recordingId}`);
      return { processed: 1, errors: [] };
    },
    shouldRunBackgroundJobsInline: () => false,
    maybeEnsureRunpodWorkerReady: async () => {
      events.push("wake");
      return {
        attempted: true,
        ok: false,
        stage: "wake_failed" as const,
        podId: null,
        wake: {
          attempted: true,
          ok: false,
          error: "runpod unavailable",
        },
        readiness: null,
        error: "runpod unavailable",
      };
    },
  });

  assert.equal(result?.mode, "external");
  assert.equal(result?.workerWake?.ok, false);
  assert.deepEqual(
    events,
    ["wake"],
    "teacher recording progress recovery should not fall back to inline processing when Runpod wake fails"
  );
}

async function runForcedInlineCase() {
  const events: string[] = [];

  const result = await kickTeacherRecordingProcessing("teacher-recording-progress-inline", true, {
    processTeacherRecordingInline: async (recordingId) => {
      events.push(`process:${recordingId}`);
      return { processed: 1, errors: [] };
    },
    shouldRunBackgroundJobsInline: () => true,
    maybeEnsureRunpodWorkerReady: async () => {
      events.push("wake");
      return {
        attempted: true,
        ok: true,
        stage: "db_ok" as const,
        podId: "pod-inline",
        wake: {
          attempted: true,
          ok: true,
          podId: "pod-inline",
        },
        readiness: { checkedAt: new Date().toISOString() },
      };
    },
  });

  assert.equal(result?.mode, "inline");
  assert.equal(result?.workerWake, null);
  assert.deepEqual(events, ["process:teacher-recording-progress-inline"]);
}

await runForcedExternalCase();
await runForcedInlineCase();

console.log("teacher recording progress dispatch regression checks passed");
