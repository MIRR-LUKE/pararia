import assert from "node:assert/strict";
import {
  kickSessionWorkerOrFallback,
  shouldKickConversationJobsNow,
  shouldProcessConversationInlineDuringProgress,
  shouldProcessSessionProgressInline,
  shouldKickSessionWorkerNow,
} from "../app/api/sessions/[id]/progress/route";

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

assert.equal(
  shouldProcessConversationInlineDuringProgress({
    manualOnlyParts: true,
    needsWorkerWake: false,
    needsConversationWork: true,
    inlineBackgroundMode: false,
  }),
  true,
  "manual-only conversation work should run inside progress requests in external mode"
);

assert.equal(
  shouldProcessConversationInlineDuringProgress({
    manualOnlyParts: false,
    needsWorkerWake: false,
    needsConversationWork: true,
    inlineBackgroundMode: false,
  }),
  false,
  "audio-backed sessions should keep the existing external conversation path"
);

assert.equal(
  shouldProcessSessionProgressInline({
    inlineBackgroundMode: false,
    manualOnlyParts: true,
  }),
  true,
  "manual-only sessions should process progress inline even in external mode"
);

assert.equal(
  shouldProcessSessionProgressInline({
    inlineBackgroundMode: false,
    manualOnlyParts: false,
  }),
  false,
  "audio-backed sessions should keep background progress handling in external mode"
);

const sessionKickCache = new Map<string, number>();
assert.equal(
  shouldKickSessionWorkerNow("session-a", 10_000, sessionKickCache),
  true,
  "first session worker kick should pass"
);
assert.equal(
  shouldKickSessionWorkerNow("session-a", 12_000, sessionKickCache),
  false,
  "duplicate session worker kicks inside cooldown should be ignored"
);
assert.equal(
  shouldKickSessionWorkerNow("session-a", 15_000, sessionKickCache),
  true,
  "session worker kicks should reopen after the cooldown"
);

const conversationKickCache = new Map<string, number>();
assert.equal(
  shouldKickConversationJobsNow("conversation-a", 20_000, conversationKickCache),
  true,
  "first conversation dispatch kick should pass"
);
assert.equal(
  shouldKickConversationJobsNow("conversation-a", 22_000, conversationKickCache),
  false,
  "duplicate conversation dispatch kicks inside cooldown should be ignored"
);
assert.equal(
  shouldKickConversationJobsNow("conversation-a", 25_000, conversationKickCache),
  true,
  "conversation dispatch kicks should reopen after the cooldown"
);

console.log("session progress dispatch regression checks passed");
