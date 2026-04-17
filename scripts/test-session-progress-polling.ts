import assert from "node:assert/strict";
import {
  getSessionProgressPollIntervalMs,
  getSessionProgressWakeIntervalMs,
} from "../app/app/students/[studentId]/useStudentSessionProgress";

assert.equal(getSessionProgressPollIntervalMs(0, false), 1000, "polling should stay tight while the user is watching");
assert.equal(getSessionProgressPollIntervalMs(15_000, false), 1000, "polling should avoid early backoff during active generation");
assert.equal(getSessionProgressPollIntervalMs(90_000, false), 1500, "polling should stay brisk through the main generation window");
assert.equal(getSessionProgressPollIntervalMs(200_000, false), 2000, "polling should only ease slightly later");
assert.equal(getSessionProgressPollIntervalMs(320_000, false), 3000, "polling should remain responsive even near timeout");

assert.equal(getSessionProgressPollIntervalMs(0, true), 5000, "hidden tabs should start quieter");
assert.equal(getSessionProgressPollIntervalMs(90_000, true), 10000, "hidden tabs should back off further");
assert.equal(getSessionProgressPollIntervalMs(180_000, true), 15000, "hidden tabs should stay quiet later");

assert.equal(getSessionProgressWakeIntervalMs(0, false), 1000, "worker wake POSTs should start immediately");
assert.equal(getSessionProgressWakeIntervalMs(30_000, false), 2000, "worker wake POSTs should stay tight through STT handoff");
assert.equal(getSessionProgressWakeIntervalMs(120_000, false), 4000, "worker wake POSTs should taper only after generation is underway");
assert.equal(getSessionProgressWakeIntervalMs(320_000, false), 5000, "worker wake POSTs should remain responsive late");

assert.equal(getSessionProgressWakeIntervalMs(0, true), 10000, "hidden tabs should wake workers only occasionally");
assert.equal(getSessionProgressWakeIntervalMs(120_000, true), 15000, "hidden tabs should stay quiet");

console.log("session progress polling cadence regression checks passed");
