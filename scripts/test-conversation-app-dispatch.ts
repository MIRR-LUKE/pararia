import assert from "node:assert/strict";
import { kickConversationJobsOutsideRunpod, processConversationJobsOutsideRunpod } from "../lib/jobs/conversation-jobs/app-dispatch";

async function waitForMicrotask() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function runExternalBlockedCase() {
  const events: string[] = [];

  const result = await processConversationJobsOutsideRunpod("conversation-blocked", {
    shouldRunBackgroundJobsInline: () => false,
    maybeStopRunpodWorkerWhenSessionPartQueueIdle: async () => {
      events.push("stop-check");
      return {
        attempted: false as const,
        reason: "pending_session_part_jobs" as const,
        pendingSessionPartJobs: 1,
      };
    },
    processAllConversationJobs: async () => {
      events.push("process");
      return { processed: 1, errors: [] };
    },
  });

  assert.deepEqual(events, ["stop-check"]);
  assert.deepEqual(result, {
    started: false,
    reason: "pending_session_part_jobs",
  });
}

async function runExternalDispatchCase() {
  const events: string[] = [];

  kickConversationJobsOutsideRunpod("conversation-ready", "conversation app dispatch test", {
    shouldRunBackgroundJobsInline: () => false,
    maybeStopRunpodWorkerWhenSessionPartQueueIdle: async () => {
      events.push("stop-check");
      return {
        attempted: true as const,
        reason: "stopped_or_already_stopped" as const,
        pendingSessionPartJobs: 0,
        stopResult: { ok: true, podId: "pod-stopped" },
      };
    },
    processAllConversationJobs: async (conversationId) => {
      events.push(`process:${conversationId}`);
      return { processed: 1, errors: [] };
    },
  });

  await waitForMicrotask();
  assert.deepEqual(events, ["stop-check", "process:conversation-ready"]);
}

await runExternalBlockedCase();
await runExternalDispatchCase();

console.log("conversation app dispatch regression checks passed");
