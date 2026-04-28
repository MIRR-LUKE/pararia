import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
const uploadServiceSource = readFileSync(
  new URL("../lib/teacher-app/server/recording-upload-service.ts", import.meta.url),
  "utf8"
);

assert.match(routeSource, /teacher_recording_upload:user/);
assert.match(routeSource, /teacher_recording_upload:org/);
assert.match(routeSource, /API_THROTTLE_RULES\.teacherRecordingUploadUser/);
assert.match(routeSource, /API_THROTTLE_RULES\.teacherRecordingUploadOrg/);
assert.match(routeSource, /Retry-After/);
assert.match(routeSource, /status:\s*429/);

assert.match(uploadServiceSource, /deleteStorageEntryDetailed/);
assert.match(uploadServiceSource, /withSavedTeacherRecordingAudioCleanup/);
assert.match(uploadServiceSource, /catch\s*\(error\)[\s\S]*cleanupSavedTeacherRecordingAudio\(storageUrl\)[\s\S]*throw error/);
assert.match(
  uploadServiceSource,
  /withSavedTeacherRecordingAudioCleanup\(storage\.storageUrl[\s\S]*updateTeacherRecordingStatus\(tx,[\s\S]*upsertTeacherRecordingJob/
);
assert.match(
  uploadServiceSource,
  /withSavedTeacherRecordingAudioCleanup\(input\.storageUrl[\s\S]*updateTeacherRecordingStatus\(tx,[\s\S]*upsertTeacherRecordingJob/
);

const previousStorageMode = process.env.PARARIA_AUDIO_STORAGE_MODE;
const previousRuntimeDir = process.env.PARARIA_RUNTIME_DIR;
const tempRuntimeDir = await mkdtemp(path.join(os.tmpdir(), "teacher-recording-upload-cleanup-"));
try {
  process.env.PARARIA_AUDIO_STORAGE_MODE = "local";
  process.env.PARARIA_RUNTIME_DIR = tempRuntimeDir;
  const [{ saveStorageBuffer }, { withSavedTeacherRecordingAudioCleanup }] = await Promise.all([
    import("../lib/audio-storage"),
    import("../lib/teacher-app/server/recording-upload-service"),
  ]);
  const saved = await saveStorageBuffer({
    storagePathname: "teacher-recordings/uploads/test-recording/orphan.webm",
    buffer: Buffer.from("audio"),
    contentType: "audio/webm",
  });
  await stat(saved.storageUrl);

  const dbFailure = new Error("mock status transition failed");
  await assert.rejects(
    () => withSavedTeacherRecordingAudioCleanup(saved.storageUrl, async () => {
      throw dbFailure;
    }),
    dbFailure
  );
  await assert.rejects(() => stat(saved.storageUrl), /ENOENT/);
} finally {
  if (previousStorageMode === undefined) {
    delete process.env.PARARIA_AUDIO_STORAGE_MODE;
  } else {
    process.env.PARARIA_AUDIO_STORAGE_MODE = previousStorageMode;
  }
  if (previousRuntimeDir === undefined) {
    delete process.env.PARARIA_RUNTIME_DIR;
  } else {
    process.env.PARARIA_RUNTIME_DIR = previousRuntimeDir;
  }
  await rm(tempRuntimeDir, { recursive: true, force: true });
}

console.log("teacher recording upload quota checks passed");
