#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [
  teacherPage,
  teacherSetupPage,
  webTeacherDeviceLoginRoute,
  studentDetailPage,
  dashboardSnapshot,
  newSessionPage,
  teacherRecordingsRoute,
  teacherRecordingAudioRoute,
] = await Promise.all([
  read("app/(teacher)/teacher/page.tsx"),
  read("app/(teacher)/teacher/setup/page.tsx"),
  read("app/api/teacher/auth/device-login/route.ts"),
  read("app/app/students/[studentId]/StudentDetailPageClient.tsx"),
  read("lib/students/dashboard-snapshot.ts"),
  read("app/app/students/[studentId]/sessions/new/page.tsx"),
  read("app/api/teacher/recordings/route.ts"),
  read("app/api/teacher/recordings/[id]/audio/route.ts"),
]);

assert.match(teacherPage, /録音はネイティブアプリ専用です/);
assert.doesNotMatch(teacherPage, /TeacherAppClient|buildTeacherAppBootstrap|loadLatestActiveTeacherRecording/);

assert.match(teacherSetupPage, /端末設定はアプリで行います/);
assert.doesNotMatch(teacherSetupPage, /TeacherSetupScreen|getTeacherAppSession/);

assert.match(webTeacherDeviceLoginRoute, /status:\s*410/);
assert.doesNotMatch(webTeacherDeviceLoginRoute, /loginWithEmail|registerTeacherAppDevice|buildTeacherAppSessionCookie/);

assert.match(studentDetailPage, /録音の開始、終了、音声アップロードは Android Teacher App 専用です/);
assert.doesNotMatch(studentDetailPage, /StudentSessionConsole|recording-start-button|input\[type="file"\]/);

assert.doesNotMatch(dashboardSnapshot, /panel=recording|mode=INTERVIEW/);
assert.doesNotMatch(newSessionPage, /panel=recording|mode=INTERVIEW/);

assert.match(teacherRecordingsRoute, /requireNativeTeacherAppSessionForRequest/);
assert.match(teacherRecordingsRoute, /requireNativeTeacherAppMutationSession/);
assert.match(teacherRecordingAudioRoute, /requireNativeTeacherAppMutationSession/);

console.log("web recording UI retired regression checks passed");
