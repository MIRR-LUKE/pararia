import assert from "node:assert/strict";
import {
  buildLessonReportFlowMessage,
  getLessonReportPartState,
  pickOngoingLessonReportSession,
} from "../lib/lesson-report-flow";

const empty = getLessonReportPartState([]);
assert.equal(empty.hasReadyCheckIn, false);
assert.equal(empty.hasReadyCheckOut, false);
assert.equal(empty.nextRecommendedPart, "CHECK_IN");

const checkInOnly = getLessonReportPartState([
  { partType: "CHECK_IN", status: "READY" },
]);
assert.equal(checkInOnly.hasReadyCheckIn, true);
assert.equal(checkInOnly.hasReadyCheckOut, false);
assert.equal(checkInOnly.nextRecommendedPart, "CHECK_OUT");

const complete = getLessonReportPartState([
  { partType: "CHECK_IN", status: "READY" },
  { partType: "CHECK_OUT", status: "READY" },
]);
assert.equal(complete.isComplete, true);

const ongoing = pickOngoingLessonReportSession([
  {
    id: "done",
    type: "LESSON_REPORT",
    parts: [
      { partType: "CHECK_IN", status: "READY" },
      { partType: "CHECK_OUT", status: "READY" },
    ],
  },
  {
    id: "collecting",
    type: "LESSON_REPORT",
    parts: [{ partType: "CHECK_IN", status: "READY" }],
  },
]);
assert.equal(ongoing?.id, "collecting");

assert.match(
  buildLessonReportFlowMessage({
    type: "LESSON_REPORT",
    parts: [{ partType: "CHECK_IN", status: "READY" }],
  }),
  /チェックアウト/
);

console.log("lesson-report flow smoke check passed");
