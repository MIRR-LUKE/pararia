import assert from "node:assert/strict";
import { dispatchTeacherRecordingUploadJobs } from "../app/api/teacher/recordings/[id]/audio/route";

async function waitForMicrotask() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function runInlineCase() {
  const events: string[] = [];

  const result = await dispatchTeacherRecordingUploadJobs("teacher-recording-inline", {
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

  await waitForMicrotask();
  assert.equal(result.mode, "inline");
  assert.equal(result.workerWake, null);
  assert.deepEqual(events, ["process:teacher-recording-inline"]);
}

async function runExternalCase() {
  const events: string[] = [];

  const result = await dispatchTeacherRecordingUploadJobs("teacher-recording-external", {
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

  await waitForMicrotask();
  assert.equal(result.mode, "external");
  assert.equal(result.workerWake?.ok, false);
  assert.deepEqual(
    events,
    ["wake"],
    "teacher recording upload should wake Runpod and must not fall back to inline processing in external mode"
  );
}

await runInlineCase();
await runExternalCase();

console.log("teacher recording audio dispatch regression checks passed");
