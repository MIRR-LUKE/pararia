import assert from "node:assert/strict";
import { dispatchTextSessionPartJobs } from "../app/api/sessions/[id]/parts/session-part-ingest";

async function waitForMicrotask() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function runInlineCase() {
  const events: string[] = [];

  const result = await dispatchTextSessionPartJobs("session-inline", "part-inline", {
    enqueueSessionPartJob: async (partId) => {
      events.push(`enqueue:${partId}`);
      return {} as any;
    },
    processAllSessionPartJobs: async (sessionId) => {
      events.push(`process:${sessionId}`);
      return { processed: 1, errors: [] };
    },
    shouldRunBackgroundJobsInline: () => true,
    maybeEnsureRunpodWorker: async () => {
      events.push("wake");
      return {
        attempted: true,
        ok: true,
        podId: "pod-inline",
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

  const result = await dispatchTextSessionPartJobs("session-external", "part-external", {
    enqueueSessionPartJob: async (partId) => {
      events.push(`enqueue:${partId}`);
      return {} as any;
    },
    processAllSessionPartJobs: async (sessionId) => {
      events.push(`process:${sessionId}`);
      return { processed: 1, errors: [] };
    },
    shouldRunBackgroundJobsInline: () => false,
    maybeEnsureRunpodWorker: async () => {
      events.push("wake");
      return {
        attempted: true,
        ok: true,
        podId: "pod-external",
      };
    },
  });

  assert.equal(result.mode, "external");
  assert.equal(result.workerWake?.ok, true);
  assert.deepEqual(events, ["enqueue:part-external", "wake", "process:session-external"]);
}

await runInlineCase();
await runExternalCase();

console.log("session-part text dispatch regression checks passed");
