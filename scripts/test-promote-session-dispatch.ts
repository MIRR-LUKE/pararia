import assert from "node:assert/strict";
import { dispatchPromotedConversationJobs } from "../lib/jobs/session-part-jobs/promote-session";

async function waitForMicrotask() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function runInlineCase() {
  const events: string[] = [];

  const result = await dispatchPromotedConversationJobs("conversation-inline", {
    enqueueConversationJobs: async (conversationId) => {
      events.push(`enqueue:${conversationId}`);
      return {} as any;
    },
    processAllConversationJobs: async (conversationId) => {
      events.push(`process:${conversationId}`);
      return { processed: 1, errors: [] };
    },
    shouldRunBackgroundJobsInline: () => true,
  });

  await waitForMicrotask();
  assert.equal(result.mode, "inline");
  assert.equal(result.workerWake, null);
  assert.deepEqual(events, ["enqueue:conversation-inline", "process:conversation-inline"]);
}

async function runExternalCase() {
  const events: string[] = [];

  const result = await dispatchPromotedConversationJobs("conversation-external", {
    enqueueConversationJobs: async (conversationId) => {
      events.push(`enqueue:${conversationId}`);
      return {} as any;
    },
    processAllConversationJobs: async (conversationId) => {
      events.push(`process:${conversationId}`);
      return { processed: 1, errors: [] };
    },
    shouldRunBackgroundJobsInline: () => false,
  });

  await waitForMicrotask();
  assert.equal(result.mode, "external");
  assert.equal(result.workerWake, null);
  assert.deepEqual(events, ["enqueue:conversation-external"]);
}

await runInlineCase();
await runExternalCase();

console.log("promote-session dispatch regression checks passed");
