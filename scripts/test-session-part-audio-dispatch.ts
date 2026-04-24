import assert from "node:assert/strict";
import { dispatchAudioSessionPartJobs } from "../app/api/sessions/[id]/parts/session-part-ingest";

async function waitForMicrotask() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function runInlineCase() {
  const events: string[] = [];

  const result = await dispatchAudioSessionPartJobs("session-inline", "part-inline", {
    enqueueSessionPartJob: async (partId) => {
      events.push(`enqueue:${partId}`);
      return {} as any;
    },
    processAllSessionPartJobs: async (sessionId) => {
      events.push(`process:${sessionId}`);
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
  assert.deepEqual(events, ["enqueue:part-inline", "process:session-inline"]);
}

async function runExternalCase() {
  const events: string[] = [];

  const result = await dispatchAudioSessionPartJobs("session-external", "part-external", {
    enqueueSessionPartJob: async (partId) => {
      events.push(`enqueue:${partId}`);
      return {} as any;
    },
    processAllSessionPartJobs: async (sessionId) => {
      events.push(`process:${sessionId}`);
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
    ["enqueue:part-external", "wake"],
    "external mode should wake Runpod and must not fall back to inline session part processing"
  );
}

await runInlineCase();
await runExternalCase();

console.log("session-part audio dispatch regression checks passed");
