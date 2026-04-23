import assert from "node:assert/strict";
import { dispatchLiveSessionPartJobs } from "../app/api/sessions/[id]/parts/session-part-live";

async function waitForMicrotask() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function runInlineCase() {
  const events: string[] = [];

  await dispatchLiveSessionPartJobs("session-inline", "part-inline", {
    enqueueSessionPartJob: async (partId) => {
      events.push(`enqueue:${partId}`);
      return {} as any;
    },
    processAllSessionPartJobs: async (sessionId) => {
      events.push(`process:${sessionId}:all`);
      return { processed: 1, errors: [] };
    },
    shouldRunBackgroundJobsInline: () => true,
  });

  await waitForMicrotask();
  assert.deepEqual(events, ["enqueue:part-inline", "process:session-inline:all"]);
}

async function runExternalCase() {
  const events: string[] = [];

  await dispatchLiveSessionPartJobs("session-external", "part-external", {
    enqueueSessionPartJob: async (partId) => {
      events.push(`enqueue:${partId}`);
      return {} as any;
    },
    processAllSessionPartJobs: async (sessionId, opts) => {
      events.push(`process:${sessionId}:${(opts?.types ?? []).join(",")}`);
      return { processed: 1, errors: [] };
    },
    shouldRunBackgroundJobsInline: () => false,
  });

  await waitForMicrotask();
  assert.deepEqual(events, [
    "enqueue:part-external",
    "process:session-external:FINALIZE_LIVE_PART,PROMOTE_SESSION",
  ]);
}

await runInlineCase();
await runExternalCase();

console.log("session-part live dispatch regression checks passed");
