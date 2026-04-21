import assert from "node:assert/strict";
import {
  getSessionProgressPollIntervalMs,
  getSessionProgressWakeIntervalMs,
  shouldKickSessionProgressWorker,
} from "../app/app/students/[studentId]/useStudentSessionProgress";

assert.equal(getSessionProgressPollIntervalMs(0, false), 1500, "polling should stay responsive without hammering the API");
assert.equal(getSessionProgressPollIntervalMs(15_000, false), 1500, "polling should avoid the old 1s loop during early generation");
assert.equal(getSessionProgressPollIntervalMs(90_000, false), 2500, "polling should stay brisk through the main generation window");
assert.equal(getSessionProgressPollIntervalMs(200_000, false), 3500, "polling should ease later in the run");
assert.equal(getSessionProgressPollIntervalMs(320_000, false), 5000, "polling should stay readable near timeout");

assert.equal(getSessionProgressPollIntervalMs(0, true), 8000, "hidden tabs should start much quieter");
assert.equal(getSessionProgressPollIntervalMs(90_000, true), 12000, "hidden tabs should back off further");
assert.equal(getSessionProgressPollIntervalMs(180_000, true), 15000, "hidden tabs should stay quiet later");

assert.equal(getSessionProgressWakeIntervalMs(0, false), 20000, "worker wake POSTs should be explicit and sparse");
assert.equal(getSessionProgressWakeIntervalMs(30_000, false), 20000, "worker wake POSTs should stay calm through STT handoff");
assert.equal(getSessionProgressWakeIntervalMs(120_000, false), 30000, "worker wake POSTs should taper once generation is underway");
assert.equal(getSessionProgressWakeIntervalMs(320_000, false), 45000, "worker wake POSTs should remain sparse late");

assert.equal(getSessionProgressWakeIntervalMs(0, true), 30000, "hidden tabs should wake workers only occasionally");
assert.equal(getSessionProgressWakeIntervalMs(120_000, true), 45000, "hidden tabs should stay quiet");

const now = Date.now();
assert.equal(
  shouldKickSessionProgressWorker({
    elapsedMs: 0,
    pageHidden: false,
    lastKickAt: 0,
    stage: null,
  }),
  true,
  "initial progress loop should still trigger the first wake"
);
assert.equal(
  shouldKickSessionProgressWorker({
    elapsedMs: 5_000,
    pageHidden: false,
    lastKickAt: now - 25_000,
    stage: "TRANSCRIBING",
  }),
  false,
  "transcribing sessions should stop sending repeated wake requests"
);
assert.equal(
  shouldKickSessionProgressWorker({
    elapsedMs: 90_000,
    pageHidden: false,
    lastKickAt: now - 20_000,
    stage: "GENERATING",
  }),
  false,
  "once generation is running, the UI should stop nudging the worker"
);
assert.equal(
  shouldKickSessionProgressWorker({
    elapsedMs: 15_000,
    pageHidden: false,
    lastKickAt: now - 20_000,
    stage: "RECEIVED",
  }),
  false,
  "received sessions should not retry wake too early"
);
assert.equal(
  shouldKickSessionProgressWorker({
    elapsedMs: 25_000,
    pageHidden: false,
    lastKickAt: now - 25_000,
    stage: "RECEIVED",
  }),
  true,
  "received sessions may retry wake after the stall threshold and cooldown"
);

console.log("session progress polling cadence regression checks passed");
