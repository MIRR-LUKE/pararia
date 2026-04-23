import assert from "node:assert/strict";
import {
  dispatchPromotedConversationJobs,
  kickPromotedConversationJobsOutsideRunpod,
  requestPromotedConversationJobsFromApp,
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

async function runRunpodRemoteDispatchCase() {
  const calls: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }> = [];

  const started = await requestPromotedConversationJobsFromApp("conversation-runpod", "external", {
    baseUrl: "https://pararia.example.com/",
    maintenanceSecret: "maintenance-secret",
    requireRunpodStopped: true,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        url,
        method: (init?.method || "GET").toUpperCase(),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  });

  assert.equal(started, true);
  assert.deepEqual(calls, [
    {
      url: "https://pararia.example.com/api/maintenance/conversations/conversation-runpod/dispatch",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-maintenance-secret": "maintenance-secret",
      },
      body: {
        requireRunpodStopped: true,
      },
    },
  ]);
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
await runRunpodRemoteDispatchCase();
runManualKickCase();

console.log("promote-session dispatch regression checks passed");
