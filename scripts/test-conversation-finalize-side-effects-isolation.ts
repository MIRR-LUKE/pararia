#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { runFinalizeBestEffortSideEffects } from "../lib/jobs/conversation-jobs/handlers";

async function main() {
  const warnings: Array<{ args: unknown[] }> = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push({ args });
  };

  try {
    await runFinalizeBestEffortSideEffects(
      { id: "conversation-side-effect-isolation", sessionId: "session-side-effect-isolation" },
      {
        shouldGenerateNextMeetingMemo: true,
        runners: {
          enqueueNextMeetingMemoJob: async () => {
            throw new Error("enqueue failed");
          },
          syncSessionAfterConversation: async () => {
            throw new Error("sync failed");
          },
          stopRunpodWorkerAfterConversationJob: async () => {
            throw new Error("stop failed");
          },
        },
      }
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length >= 3, true, "all failing side effects should be swallowed and logged");
  assert.ok(
    warnings.some((entry) =>
      entry.args.some((arg) => typeof arg === "string" && arg.includes("failed to enqueue next meeting memo after finalize"))
    ),
    "enqueue failure should be logged"
  );
  assert.ok(
    warnings.some((entry) =>
      entry.args.some((arg) => typeof arg === "string" && arg.includes("failed to sync session after finalize"))
    ),
    "session sync failure should be logged"
  );
  assert.ok(
    warnings.some((entry) =>
      entry.args.some((arg) => typeof arg === "string" && arg.includes("failed to stop Runpod worker after finalize"))
    ),
    "worker stop failure should be logged"
  );

  console.log("conversation finalize side-effect isolation regression checks passed");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
