import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const confirmRouteSource = readFileSync(
  new URL("../app/api/teacher/recordings/[id]/confirm/route.ts", import.meta.url),
  "utf8"
);

assert.match(confirmRouteSource, /Idempotency-Key/);
assert.match(confirmRouteSource, /teacher_recording_confirm/);
assert.match(confirmRouteSource, /beginIdempotency/);
assert.match(confirmRouteSource, /completeIdempotency/);
assert.match(confirmRouteSource, /failIdempotency/);
assert.match(confirmRouteSource, /recordingId/);
assert.match(confirmRouteSource, /studentId/);
assert.match(
  confirmRouteSource,
  /同じ生徒確定リクエストがまだ進行中です/,
  "confirm route should reject duplicate in-flight requests"
);

const confirmServiceSource = readFileSync(
  new URL("../lib/teacher-app/server/recording-confirm-service.ts", import.meta.url),
  "utf8"
);

assert.match(
  confirmServiceSource,
  /existing\.status === TeacherRecordingSessionStatus\.STUDENT_CONFIRMED[\s\S]*alreadyConfirmed: true/,
  "service should safely replay already-confirmed requests for the same student"
);
assert.match(
  confirmServiceSource,
  /selectedStudentId: null[\s\S]*alreadyConfirmed: false/,
  "service should support the no-student confirmation path"
);
assert.match(
  confirmServiceSource,
  /where:\s*\{[\s\S]*status:\s*TeacherRecordingSessionStatus\.AWAITING_STUDENT_CONFIRMATION/,
  "promotion transaction should still guard the source recording status"
);
assert.match(
  confirmServiceSource,
  /upsertTeacherPromotionJob\(tx, part\.id\)/,
  "promotion job should remain unique per promoted session part"
);
assert.match(
  confirmServiceSource,
  /processAllSessionPartJobs\(promotion\.sessionId\)\.catch[\s\S]*return \{ processed: 0, errors: \[message\] \}/,
  "post-confirmation dispatch failures should not make the confirmed request fail"
);
assert.match(
  confirmServiceSource,
  /followUpDispatchOk: !followUpDispatchError/,
  "confirmation response should expose whether follow-up dispatch succeeded"
);

console.log("teacher recording confirm idempotency checks passed");
