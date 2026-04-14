import assert from "node:assert/strict";
import { prisma } from "../lib/db";
import {
  LOCK_STUDENT_ID,
  cleanupRecordingLock,
  isMainModule,
  loginForCriticalPathSmoke,
} from "./lib/critical-path-smoke";

export async function runRecordingLockRouteTest() {
  await cleanupRecordingLock(LOCK_STUDENT_ID);
  const client = await loginForCriticalPathSmoke();

  const initial = await client.requestJson(`/api/students/${LOCK_STUDENT_ID}/recording-lock`);
  assert.equal(initial.response.status, 200, "initial GET recording-lock");
  assert.equal(initial.body.active, false, "lock should be inactive before acquire");

  const acquired = await client.requestJson(`/api/students/${LOCK_STUDENT_ID}/recording-lock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "INTERVIEW" }),
  });
  assert.equal(acquired.response.status, 200, "POST recording-lock should succeed");
  assert.equal(typeof acquired.body.lockToken, "string", "lockToken should be returned");

  const afterAcquire = await client.requestJson(`/api/students/${LOCK_STUDENT_ID}/recording-lock`);
  assert.equal(afterAcquire.response.status, 200, "GET after acquire should succeed");
  assert.equal(afterAcquire.body.active, true, "lock should be active after acquire");

  const heartbeat = await client.requestJson(`/api/students/${LOCK_STUDENT_ID}/recording-lock`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lockToken: acquired.body.lockToken }),
  });
  assert.equal(heartbeat.response.status, 200, "PATCH heartbeat should succeed");
  assert.equal(heartbeat.body.ok, true, "heartbeat should confirm lock");

  const released = await client.requestJson(`/api/students/${LOCK_STUDENT_ID}/recording-lock`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lockToken: acquired.body.lockToken }),
  });
  assert.equal(released.response.status, 200, "DELETE release should succeed");
  assert.equal(released.body.ok, true, "release should succeed");

  const finalView = await client.requestJson(`/api/students/${LOCK_STUDENT_ID}/recording-lock`);
  assert.equal(finalView.response.status, 200, "final GET recording-lock");
  assert.equal(finalView.body.active, false, "lock should be inactive after release");

  const persisted = await prisma.studentRecordingLock.findUnique({ where: { studentId: LOCK_STUDENT_ID } });
  assert.equal(persisted, null, "recording lock row should be removed");

  await cleanupRecordingLock(LOCK_STUDENT_ID);
  console.log("recording-lock route smoke passed");
}

if (isMainModule(import.meta.url)) {
  runRecordingLockRouteTest().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
