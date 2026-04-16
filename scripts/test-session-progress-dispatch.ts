import assert from "node:assert/strict";
import { kickSessionWorkerOrFallback } from "../app/api/sessions/[id]/progress/route";

async function waitForMicrotask() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const events: string[] = [];

const startedAt = Date.now();
kickSessionWorkerOrFallback("session-progress-dispatch", false, {
  maybeEnsureRunpodWorker: async () => {
    events.push("wake");
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      attempted: true,
      ok: true,
      podId: "pod-smoke",
    };
  },
  processAllSessionPartJobs: async () => {
    events.push("session-fallback");
    return { attempted: 0, processed: 0, errors: [] };
  },
  processAllConversationJobs: async () => {
    events.push("conversation-fallback");
    return { attempted: 0, processed: 0, errors: [] };
  },
});

const elapsedMs = Date.now() - startedAt;
assert.ok(elapsedMs < 10, `kick should return immediately, but took ${elapsedMs}ms`);
assert.deepEqual(events, ["wake"], "worker wake may start immediately, but must not block the request");

await waitForMicrotask();
assert.deepEqual(events, ["wake"], "worker wake should continue in the background");

console.log("session progress dispatch regression checks passed");
