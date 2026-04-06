import assert from "node:assert/strict";
import {
  DEFAULT_MIN_RECORDING_DURATION_SEC,
  buildRecordingTooLongMessage,
  buildRecordingTooShortMessage,
  buildUnknownDurationMessage,
  getDefaultMaxRecordingDurationSeconds,
} from "../lib/recording/policy.js";

assert.equal(DEFAULT_MIN_RECORDING_DURATION_SEC, 60);
assert.equal(getDefaultMaxRecordingDurationSeconds("INTERVIEW"), 60 * 60);
assert.equal(getDefaultMaxRecordingDurationSeconds("LESSON_REPORT"), 10 * 60);

assert.match(buildRecordingTooShortMessage(), /60秒未満/);
assert.match(buildRecordingTooLongMessage("INTERVIEW"), /60分まで/);
assert.match(buildRecordingTooLongMessage("LESSON_REPORT"), /10分まで/);
assert.match(buildUnknownDurationMessage("INTERVIEW"), /60分以内/);
assert.match(buildUnknownDurationMessage("LESSON_REPORT"), /10分以内/);

console.log("recording policy tests passed");
