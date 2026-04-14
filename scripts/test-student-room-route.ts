import assert from "node:assert/strict";
import {
  ROOM_STUDENT_ID,
  cleanupRecordingLock,
  isMainModule,
  loginForCriticalPathSmoke,
} from "./lib/critical-path-smoke";

export async function runStudentRoomRouteTest() {
  await cleanupRecordingLock(ROOM_STUDENT_ID);
  const client = await loginForCriticalPathSmoke();

  const summary = await client.requestJson<{
    meta?: { scope?: string };
    student?: { id?: string };
    sessions?: unknown[];
  }>(`/api/students/${ROOM_STUDENT_ID}/room?scope=summary`);
  assert.equal(summary.response.status, 200, "summary room should load");
  assert.equal(summary.body.meta?.scope, "summary", "summary scope should be returned");
  assert.equal(summary.body.student?.id, ROOM_STUDENT_ID, "summary should return requested student");
  assert.ok(Array.isArray(summary.body.sessions), "summary should include sessions");

  const acquire = await client.requestJson(`/api/students/${ROOM_STUDENT_ID}/recording-lock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "INTERVIEW" }),
  });
  assert.equal(acquire.response.status, 200, "room setup lock acquire should succeed");

  const full = await client.requestJson<{
    meta?: { scope?: string };
    student?: { id?: string };
    recordingLock?: { active?: boolean };
    reports?: unknown[];
  }>(`/api/students/${ROOM_STUDENT_ID}/room?scope=full`);
  assert.equal(full.response.status, 200, "full room should load");
  assert.equal(full.body.meta?.scope, "full", "full scope should be returned");
  assert.equal(full.body.student?.id, ROOM_STUDENT_ID, "full room should return requested student");
  assert.equal(full.body.recordingLock?.active, true, "full room should include active recording lock");
  assert.ok(Array.isArray(full.body.reports), "full room should include reports");

  await client.requestJson(`/api/students/${ROOM_STUDENT_ID}/recording-lock`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lockToken: acquire.body.lockToken }),
  });
  await cleanupRecordingLock(ROOM_STUDENT_ID);
  console.log("student-room route smoke passed");
}

if (isMainModule(import.meta.url)) {
  runStudentRoomRouteTest().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
