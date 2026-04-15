import assert from "node:assert/strict";
import {
  getSessionProgressPollIntervalMs,
  getSessionProgressWakeIntervalMs,
} from "../app/app/students/[studentId]/useStudentSessionProgress";

assert.equal(getSessionProgressPollIntervalMs(0, false), 1000, "polling should be tight at the start");
assert.equal(getSessionProgressPollIntervalMs(15_000, false), 2000, "polling should slow down after the first burst");
assert.equal(getSessionProgressPollIntervalMs(90_000, false), 4000, "polling should settle into a calmer cadence");
assert.equal(getSessionProgressPollIntervalMs(200_000, false), 6000, "polling should remain slow later on");
assert.equal(getSessionProgressPollIntervalMs(260_000, false), 8000, "polling should stay relaxed near the end");

assert.equal(getSessionProgressPollIntervalMs(0, true), 4000, "hidden tabs should start slower");
assert.equal(getSessionProgressPollIntervalMs(90_000, true), 8000, "hidden tabs should back off further");
assert.equal(getSessionProgressPollIntervalMs(180_000, true), 15000, "hidden tabs should stay quiet later");

assert.equal(getSessionProgressWakeIntervalMs(0, false), 5000, "worker wake POSTs should start conservatively");
assert.equal(getSessionProgressWakeIntervalMs(30_000, false), 15000, "worker wake POSTs should be less frequent after startup");
assert.equal(getSessionProgressWakeIntervalMs(120_000, false), 30000, "worker wake POSTs should taper further");
assert.equal(getSessionProgressWakeIntervalMs(240_000, false), 45000, "worker wake POSTs should remain sparse");

assert.equal(getSessionProgressWakeIntervalMs(0, true), 30000, "hidden tabs should wake workers only occasionally");
assert.equal(getSessionProgressWakeIntervalMs(120_000, true), 60000, "hidden tabs should stay very quiet");

console.log("session progress polling cadence regression checks passed");
