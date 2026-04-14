import assert from "node:assert/strict";
import { shouldWakeExternalSessionWorker } from "../app/api/sessions/[id]/progress/route";

assert.equal(
  shouldWakeExternalSessionWorker({
    partStatuses: ["READY"],
    queuedSessionPartJobCount: 0,
    hasPendingConversationWork: false,
  }),
  false,
  "idle ready session should not wake worker"
);

assert.equal(
  shouldWakeExternalSessionWorker({
    partStatuses: ["READY"],
    queuedSessionPartJobCount: 1,
    hasPendingConversationWork: false,
  }),
  true,
  "queued promote job should wake worker even when part is READY"
);

assert.equal(
  shouldWakeExternalSessionWorker({
    partStatuses: ["TRANSCRIBING"],
    queuedSessionPartJobCount: 0,
    hasPendingConversationWork: false,
  }),
  true,
  "active transcription should wake worker"
);

assert.equal(
  shouldWakeExternalSessionWorker({
    partStatuses: ["READY"],
    queuedSessionPartJobCount: 0,
    hasPendingConversationWork: true,
  }),
  true,
  "pending conversation work should wake worker"
);

console.log("session progress worker wake regression checks passed");
