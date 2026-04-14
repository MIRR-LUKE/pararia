#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  createStudentRoomFixture,
  createCriticalPathSmokeApi,
  loadCriticalPathSmokeEnv,
  resetRecordingLockFixture,
} from "./lib/critical-path-smoke";

type StudentRoomRouteSmokeResult = {
  studentId: string;
  summarySessionCount: number;
  fullSessionCount: number;
  reportCount: number;
  latestConversationId: string | null;
  recordingLockVisible: boolean;
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

export async function runStudentRoomRouteSmoke(baseUrl: string): Promise<StudentRoomRouteSmokeResult> {
  await loadCriticalPathSmokeEnv();
  process.env.CRITICAL_PATH_BASE_URL = baseUrl;
  const fixture = await createStudentRoomFixture();
  await resetRecordingLockFixture(fixture.studentId);

  const { api, close } = await createCriticalPathSmokeApi(baseUrl);
  try {
    const summaryResponse = await api.get(`/api/students/${fixture.studentId}/room?scope=summary`);
    assert.equal(summaryResponse.ok(), true, `summary GET failed: ${summaryResponse.status()}`);
    const summaryBody = await summaryResponse.json();
    assert.equal(summaryBody.meta?.scope, "summary");
    assert.equal(summaryBody.student?.id, fixture.studentId);
    assert.ok(Array.isArray(summaryBody.sessions) && summaryBody.sessions.length >= 1, "summary sessions");
    assert.ok(Array.isArray(summaryBody.reports) && summaryBody.reports.length >= 1, "summary reports");
    assert.equal(summaryBody.sessions[0]?.parts?.length, 0);
    assert.equal("pipeline" in (summaryBody.sessions[0] ?? {}), false);

    const lockResponse = await api.post(`/api/students/${fixture.studentId}/recording-lock`, {
      data: { mode: "INTERVIEW" },
    });
    assert.equal(lockResponse.ok(), true, `lock POST failed: ${lockResponse.status()}`);
    const lockBody = await lockResponse.json();
    assert.equal(lockBody.mode, "INTERVIEW");
    const lockToken = String(lockBody.lockToken);

    const fullResponse = await api.get(`/api/students/${fixture.studentId}/room`);
    assert.equal(fullResponse.ok(), true, `full GET failed: ${fullResponse.status()}`);
    const fullBody = await fullResponse.json();
    assert.equal(fullBody.meta?.scope, "full");
    assert.equal(fullBody.student?.id, fixture.studentId);
    assert.ok(Array.isArray(fullBody.sessions) && fullBody.sessions.length >= 1, "full sessions");
    assert.ok(Array.isArray(fullBody.reports) && fullBody.reports.length >= 1, "full reports");
    assert.equal(fullBody.recordingLock?.active, true);
    assert.equal(fullBody.recordingLock?.lock?.mode, "INTERVIEW");
    assert.equal(fullBody.recordingLock?.lock?.isHeldByViewer, true);
    assert.equal(fullBody.latestConversation?.id ?? null, fixture.conversationId);
    assert.equal(fullBody.latestConversation?.status, "DONE");
    assert.equal(fullBody.sessions.every((session: any) => Array.isArray(session.parts) && session.parts.length === 0), true);
    assert.equal(fullBody.sessions.every((session: any) => Boolean(session.pipeline)), true);

    const releaseResponse = await api.delete(`/api/students/${fixture.studentId}/recording-lock`, {
      data: { lockToken },
    });
    assert.equal(releaseResponse.ok(), true, `lock DELETE failed: ${releaseResponse.status()}`);

    return {
      studentId: fixture.studentId,
      summarySessionCount: summaryBody.sessions.length,
      fullSessionCount: fullBody.sessions.length,
      reportCount: fullBody.reports.length,
      latestConversationId: fullBody.latestConversation?.id ?? null,
      recordingLockVisible: Boolean(fullBody.recordingLock?.active),
    };
  } finally {
    await resetRecordingLockFixture(fixture.studentId).catch(() => {});
    await fixture.cleanup().catch(() => {});
    await close().catch(() => {});
  }
}

async function main() {
  const baseUrl = argValue("--base-url") || process.env.CRITICAL_PATH_BASE_URL || "http://127.0.0.1:3000";
  const result = await runStudentRoomRouteSmoke(baseUrl);
  console.log(JSON.stringify({ label: "student-room-route", baseUrl, result }, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
