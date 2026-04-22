import assert from "node:assert/strict";
import {
  kickConversationJobsOutsideRunpod,
  processConversationJobsOutsideRunpod,
  shouldKickConversationJobsOutsideRunpodNow,
} from "../lib/jobs/conversation-jobs/app-dispatch";

async function waitForMicrotask() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function runExternalBlockedCase() {
  const events: string[] = [];
  const states: Record<string, unknown>[] = [];

  const result = await processConversationJobsOutsideRunpod("conversation-blocked", {
    shouldRunBackgroundJobsInline: () => false,
    recordDispatchState: async (_conversationId, patch) => {
      states.push(patch);
    },
    maybeStopRunpodWorkerWhenSessionPartQueueIdle: async () => {
      events.push("stop-check");
      return {
        attempted: false as const,
        reason: "pending_session_part_jobs" as const,
        pendingTeacherRecordingJobs: 0,
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
  assert.equal(
    states.some((patch) => typeof patch.conversationAppDispatchStartedAt === "string"),
    true,
    "blocked dispatch should still record when app dispatch started"
  );
  assert.equal(
    states.some((patch) => patch.conversationAppDispatchBlockedReason === "pending_session_part_jobs"),
    true,
    "blocked dispatch should record why it deferred"
  );
}

async function runExternalDispatchCase() {
  const events: string[] = [];
  const states: Record<string, unknown>[] = [];

  const kicked = kickConversationJobsOutsideRunpod("conversation-ready", "conversation app dispatch test", {
    shouldRunBackgroundJobsInline: () => false,
    recordDispatchState: async (_conversationId, patch) => {
      states.push(patch);
    },
    maybeStopRunpodWorkerWhenSessionPartQueueIdle: async () => {
      events.push("stop-check");
      return {
        attempted: true as const,
        reason: "stopped_or_already_stopped" as const,
        pendingTeacherRecordingJobs: 0,
        pendingSessionPartJobs: 0,
        stopResult: { ok: true, podId: "pod-stopped" },
      };
    },
    processAllConversationJobs: async (conversationId) => {
      events.push(`process:${conversationId}`);
      return { processed: 1, errors: [] };
    },
  });

  assert.equal(kicked, true, "first app dispatch should schedule work");
  await waitForMicrotask();
  assert.deepEqual(events, ["stop-check", "process:conversation-ready"]);
  assert.equal(
    states.some((patch) => typeof patch.conversationKickRequestedAt === "string"),
    true,
    "scheduled dispatch should record the kick request timestamp"
  );
  assert.equal(
    states.some((patch) => typeof patch.conversationAppDispatchCompletedAt === "string"),
    true,
    "scheduled dispatch should record completion"
  );
}

async function runExternalManualDispatchCase() {
  const events: string[] = [];
  const states: Record<string, unknown>[] = [];

  const result = await processConversationJobsOutsideRunpod("conversation-manual", {
    shouldRunBackgroundJobsInline: () => false,
    requireRunpodStopped: false,
    recordDispatchState: async (_conversationId, patch) => {
      states.push(patch);
    },
    maybeStopRunpodWorkerWhenSessionPartQueueIdle: async () => {
      events.push("stop-check");
      return {
        attempted: true as const,
        reason: "stopped_or_already_stopped" as const,
        pendingTeacherRecordingJobs: 0,
        pendingSessionPartJobs: 0,
        stopResult: { ok: true, podId: "pod-skipped" },
      };
    },
    processAllConversationJobs: async (conversationId) => {
      events.push(`process:${conversationId}`);
      return { processed: 1, errors: [] };
    },
  });

  assert.deepEqual(events, ["process:conversation-manual"]);
  assert.equal(result.started, true);
  assert.equal(
    states.some((patch) => patch.conversationAppDispatchRequireRunpodStopped === false),
    true,
    "manual dispatch should record that it skipped the runpod stop requirement"
  );
}

await runExternalBlockedCase();
await runExternalDispatchCase();
await runExternalManualDispatchCase();

const dispatchKickCache = new Map<string, number>();
assert.equal(
  shouldKickConversationJobsOutsideRunpodNow("conversation-cache", 30_000, dispatchKickCache),
  true,
  "first app dispatch cooldown check should pass"
);
assert.equal(
  shouldKickConversationJobsOutsideRunpodNow("conversation-cache", 32_000, dispatchKickCache),
  false,
  "duplicate app dispatch kicks inside cooldown should be ignored"
);
assert.equal(
  shouldKickConversationJobsOutsideRunpodNow("conversation-cache", 35_000, dispatchKickCache),
  true,
  "app dispatch cooldown should reopen after the window"
);

console.log("conversation app dispatch regression checks passed");
