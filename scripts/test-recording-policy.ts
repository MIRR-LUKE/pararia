import assert from "node:assert/strict";
import {
  DEFAULT_MIN_RECORDING_DURATION_SEC,
  buildRecordingAutoStopMessage,
  buildRecordingTooLongMessage,
  buildRecordingTooShortMessage,
  buildUnknownDurationMessage,
  getDefaultMaxRecordingDurationSeconds,
} from "../lib/recording/policy.js";

assert.equal(DEFAULT_MIN_RECORDING_DURATION_SEC, 60);
assert.equal(getDefaultMaxRecordingDurationSeconds("INTERVIEW"), 120 * 60);

assert.match(buildRecordingTooShortMessage(), /60秒未満/);
assert.match(buildRecordingTooLongMessage("INTERVIEW"), /120分まで/);
assert.match(buildUnknownDurationMessage("INTERVIEW"), /120分以内/);
assert.match(buildRecordingAutoStopMessage("INTERVIEW"), /120分に達したため/);

console.log("recording policy tests passed");
