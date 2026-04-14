#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { prisma } from "@/lib/db";
import {
  createRecordingLockFixture,
  createCriticalPathSmokeApi,
  loadCriticalPathSmokeEnv,
  resetRecordingLockFixture,
} from "./lib/critical-path-smoke";

type RecordingLockRouteSmokeResult = {
  studentId: string;
  initialActive: boolean;
  acquiredMode: string;
  afterAcquireActive: boolean;
  heldByViewer: boolean;
  heartbeatOk: boolean;
  released: boolean;
  finalActive: boolean;
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

export async function runRecordingLockRouteSmoke(baseUrl: string): Promise<RecordingLockRouteSmokeResult> {
  await loadCriticalPathSmokeEnv();
  process.env.CRITICAL_PATH_BASE_URL = baseUrl;
  const fixture = await createRecordingLockFixture();
  await resetRecordingLockFixture(fixture.studentId);

  const { api, close } = await createCriticalPathSmokeApi(baseUrl);
  try {
    const initialResponse = await api.get(`/api/students/${fixture.studentId}/recording-lock`);
    assert.equal(initialResponse.ok(), true, `initial GET failed: ${initialResponse.status()}`);
    const initialBody = await initialResponse.json();
    assert.deepEqual(initialBody, { active: false, lock: null }, "initial recording lock view");

    const acquireResponse = await api.post(`/api/students/${fixture.studentId}/recording-lock`, {
      data: { mode: "INTERVIEW" },
    });
    assert.equal(acquireResponse.ok(), true, `acquire failed: ${acquireResponse.status()}`);
    const acquireBody = await acquireResponse.json();
    assert.equal(acquireBody.mode, "INTERVIEW");
    assert.equal(typeof acquireBody.lockToken, "string");
    assert.equal(typeof acquireBody.expiresAt, "string");
    const lockToken = String(acquireBody.lockToken);

    const afterAcquireResponse = await api.get(`/api/students/${fixture.studentId}/recording-lock`);
    assert.equal(afterAcquireResponse.ok(), true, `after acquire GET failed: ${afterAcquireResponse.status()}`);
    const afterAcquireBody = await afterAcquireResponse.json();
    assert.equal(afterAcquireBody.active, true);
    assert.equal(afterAcquireBody.lock?.mode, "INTERVIEW");
    assert.equal(afterAcquireBody.lock?.isHeldByViewer, true);

    const heartbeatResponse = await api.patch(`/api/students/${fixture.studentId}/recording-lock`, {
      data: { lockToken },
    });
    assert.equal(heartbeatResponse.ok(), true, `heartbeat failed: ${heartbeatResponse.status()}`);
    const heartbeatBody = await heartbeatResponse.json();
    assert.equal(heartbeatBody.ok, true);
    assert.equal(typeof heartbeatBody.expiresAt, "string");

    const releaseResponse = await api.delete(`/api/students/${fixture.studentId}/recording-lock`, {
      data: { lockToken },
    });
    assert.equal(releaseResponse.ok(), true, `release failed: ${releaseResponse.status()}`);
    const releaseBody = await releaseResponse.json();
    assert.equal(releaseBody.ok, true);

    const finalResponse = await api.get(`/api/students/${fixture.studentId}/recording-lock`);
    assert.equal(finalResponse.ok(), true, `final GET failed: ${finalResponse.status()}`);
    const finalBody = await finalResponse.json();
    assert.deepEqual(finalBody, { active: false, lock: null }, "final recording lock view");

    const persistedLock = await prisma.studentRecordingLock.findUnique({
      where: { studentId: fixture.studentId },
    });
    assert.equal(persistedLock, null);

    return {
      studentId: fixture.studentId,
      initialActive: initialBody.active,
      acquiredMode: acquireBody.mode,
      afterAcquireActive: afterAcquireBody.active,
      heldByViewer: afterAcquireBody.lock?.isHeldByViewer ?? false,
      heartbeatOk: heartbeatBody.ok,
      released: releaseBody.ok,
      finalActive: finalBody.active,
    };
  } finally {
    await resetRecordingLockFixture(fixture.studentId).catch(() => {});
    await fixture.cleanup().catch(() => {});
    await close().catch(() => {});
  }
}

async function main() {
  const baseUrl = argValue("--base-url") || process.env.CRITICAL_PATH_BASE_URL || "http://127.0.0.1:3000";
  const result = await runRecordingLockRouteSmoke(baseUrl);
  console.log(JSON.stringify({ label: "recording-lock-route", baseUrl, result }, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
