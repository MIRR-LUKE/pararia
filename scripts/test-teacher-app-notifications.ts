import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTeacherRecordingNotificationMessage } from "@/lib/teacher-app/server/recording-notifications";
import { readFcmServiceAccount } from "@/lib/push/fcm";

const previousEnv = { ...process.env };

try {
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;
  assert.equal(readFcmServiceAccount(), null);

  process.env.FIREBASE_PROJECT_ID = "pararia-test";
  process.env.FIREBASE_CLIENT_EMAIL = "firebase-adminsdk@example.iam.gserviceaccount.com";
  process.env.FIREBASE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----";
  const account = readFcmServiceAccount();
  assert.equal(account?.projectId, "pararia-test");
  assert.equal(account?.privateKey.includes("\\n"), false);
  assert.equal(account?.privateKey.includes("\n"), true);
} finally {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, previousEnv);
}

const ready = buildTeacherRecordingNotificationMessage({
  kind: "ready",
  recordingId: "rec_123",
  deviceLabel: "渋谷校",
});
assert.equal(ready.title, "録音の文字起こしが完了しました");
assert.equal(ready.data.kind, "teacher_recording_ready");
assert.equal(ready.data.route, "student_confirmation");

const failed = buildTeacherRecordingNotificationMessage({
  kind: "error",
  recordingId: "rec_123",
  deviceLabel: "渋谷校",
  errorMessage: "GPU worker failed",
});
assert.equal(failed.title, "録音の文字起こしに失敗しました");
assert.equal(failed.body, "GPU worker failed");
assert.equal(failed.data.kind, "teacher_recording_error");

const schema = readFileSync("prisma/schema.prisma", "utf8");
assert.match(schema, /pushToken\s+String\?/);
assert.match(schema, /lastPushSentAt\s+DateTime\?/);

const manifest = readFileSync("native/android/app/src/main/AndroidManifest.xml", "utf8");
assert.match(manifest, /POST_NOTIFICATIONS/);
assert.match(manifest, /TeacherMessagingService/);
assert.match(manifest, /jp\.pararia\.teacherapp\.OPEN_RECORDING/);

const gradle = readFileSync("native/android/app/build.gradle.kts", "utf8");
assert.match(gradle, /firebase-bom/);
assert.match(gradle, /PARARIA_FIREBASE_PROJECT_ID/);

console.log("teacher app notification checks passed");
