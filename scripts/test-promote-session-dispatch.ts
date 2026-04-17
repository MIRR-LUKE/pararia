import assert from "node:assert/strict";
import {
  dispatchPromotedConversationJobs,
  kickPromotedConversationJobsOutsideRunpod,
} from "../lib/jobs/session-part-jobs/promote-session";

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

function runExternalKickCase() {
  const events: string[] = [];

  const started = kickPromotedConversationJobsOutsideRunpod("conversation-external", "external", {
    kickConversationJobsOutsideRunpod: (conversationId, label, deps) => {
      events.push(`kick:${conversationId}:${label}:${String(deps?.requireRunpodStopped)}`);
      return true;
    },
  });

  assert.equal(started, true);
  assert.deepEqual(events, ["kick:conversation-external:sessionPartJobs promote app conversation processing:true"]);
}

function runInlineKickCase() {
  const events: string[] = [];

  const started = kickPromotedConversationJobsOutsideRunpod("conversation-inline", "inline", {
    kickConversationJobsOutsideRunpod: () => {
      events.push("kick");
      return true;
    },
  });

  assert.equal(started, false);
  assert.deepEqual(events, []);
}

function runRunpodWorkerSkipCase() {
  const events: string[] = [];

  const started = kickPromotedConversationJobsOutsideRunpod("conversation-runpod", "external", {
    isRunpodWorkerProcess: () => true,
    kickConversationJobsOutsideRunpod: () => {
      events.push("kick");
      return true;
    },
  });

  assert.equal(started, false);
  assert.deepEqual(events, []);
}

function runManualKickCase() {
  const events: string[] = [];

  const started = kickPromotedConversationJobsOutsideRunpod("conversation-manual", "external", {
    requireRunpodStopped: false,
    kickConversationJobsOutsideRunpod: (conversationId, label, deps) => {
      events.push(`kick:${conversationId}:${label}:${String(deps?.requireRunpodStopped)}`);
      return true;
    },
  });

  assert.equal(started, true);
  assert.deepEqual(events, ["kick:conversation-manual:sessionPartJobs promote app conversation processing:false"]);
}

await runInlineCase();
await runExternalCase();
runExternalKickCase();
runInlineKickCase();
runRunpodWorkerSkipCase();
runManualKickCase();

console.log("promote-session dispatch regression checks passed");
