import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { API_THROTTLE_RULES } from "../lib/api-throttle";

const userRule = API_THROTTLE_RULES.teacherRecordingUploadUser;
const orgRule = API_THROTTLE_RULES.teacherRecordingUploadOrg;

assert.equal(userRule.windowMs, 15 * 60 * 1000);
assert.equal(orgRule.windowMs, 15 * 60 * 1000);
assert.equal(userRule.blockMs, 15 * 60 * 1000);
assert.equal(orgRule.blockMs, 10 * 60 * 1000);
assert.equal(userRule.maxRequests, 24);
assert.equal(orgRule.maxRequests, 96);
assert.equal(userRule.maxBytes, 2 * 1024 * 1024 * 1024);
assert.equal(orgRule.maxBytes, 8 * 1024 * 1024 * 1024);

assert.ok(
  (userRule.maxBytes ?? 0) <= (API_THROTTLE_RULES.sessionPartUser.maxBytes ?? 0),
  "teacher recording user byte quota should not exceed web session-part upload quota"
);
assert.ok(
  (orgRule.maxBytes ?? 0) <= (API_THROTTLE_RULES.sessionPartOrg.maxBytes ?? 0),
  "teacher recording org byte quota should not exceed web session-part upload quota"
);

const routeSource = readFileSync(
  new URL("../app/api/teacher/recordings/[id]/audio/route.ts", import.meta.url),
  "utf8"
);

assert.match(routeSource, /teacher_recording_upload:user/);
assert.match(routeSource, /teacher_recording_upload:org/);
assert.match(routeSource, /API_THROTTLE_RULES\.teacherRecordingUploadUser/);
assert.match(routeSource, /API_THROTTLE_RULES\.teacherRecordingUploadOrg/);
assert.match(routeSource, /Retry-After/);
assert.match(routeSource, /status:\s*429/);

console.log("teacher recording upload quota checks passed");
