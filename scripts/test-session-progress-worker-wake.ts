import assert from "node:assert/strict";
import { shouldWakeExternalSessionWorker } from "../app/api/sessions/[id]/progress/route";

assert.equal(
  shouldWakeExternalSessionWorker({
    partStatuses: ["READY"],
    queuedSessionPartJobCount: 0,
  }),
  false,
  "idle ready session should not wake worker"
);

assert.equal(
  shouldWakeExternalSessionWorker({
    partStatuses: ["READY"],
    queuedSessionPartJobCount: 1,
  }),
  true,
  "queued promote job should wake worker even when part is READY"
);

assert.equal(
  shouldWakeExternalSessionWorker({
    partStatuses: ["TRANSCRIBING"],
    queuedSessionPartJobCount: 0,
  }),
  true,
  "active transcription should wake worker"
);

assert.equal(
  shouldWakeExternalSessionWorker({
    partStatuses: ["READY"],
    queuedSessionPartJobCount: 0,
  }),
  false,
  "pending conversation work alone must not wake Runpod"
);

console.log("session progress worker wake regression checks passed");
