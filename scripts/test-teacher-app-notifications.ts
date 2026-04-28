import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildTeacherRecordingNotificationMessage,
  notifyTeacherRecordingDevice,
} from "@/lib/teacher-app/server/recording-notifications";
import {
  readFcmAuthConfig,
  readFcmServiceAccount,
  type FcmSendInput,
  type FcmSendResult,
} from "@/lib/push/fcm";

const previousEnv = { ...process.env };

try {
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;
  delete process.env.GCP_PROJECT_ID;
  delete process.env.GCP_PROJECT_NUMBER;
  delete process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  delete process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  assert.equal(readFcmAuthConfig(), null);
  assert.equal(readFcmServiceAccount(), null);

  process.env.FIREBASE_PROJECT_ID = "pararia-test";
  process.env.FIREBASE_CLIENT_EMAIL = "firebase-adminsdk@example.iam.gserviceaccount.com";
  const fakePrivateKeyHeader = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  const fakePrivateKeyFooter = ["-----END", "PRIVATE KEY-----"].join(" ");
  process.env.FIREBASE_PRIVATE_KEY = `${fakePrivateKeyHeader}\\nabc\\n${fakePrivateKeyFooter}`;
  const account = readFcmServiceAccount();
  assert.equal(account?.projectId, "pararia-test");
  assert.equal(account?.privateKey.includes("\\n"), false);
  assert.equal(account?.privateKey.includes("\n"), true);

  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;
  process.env.GCP_PROJECT_ID = "pararia-firebase";
  process.env.GCP_PROJECT_NUMBER = "123456789012";
  process.env.GCP_SERVICE_ACCOUNT_EMAIL = "pararia-fcm-sender@pararia-firebase.iam.gserviceaccount.com";
  process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "vercel";
  process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "vercel";
  const oidcConfig = readFcmAuthConfig();
  assert.equal(oidcConfig?.mode, "vercel_oidc");
  assert.equal(oidcConfig?.projectId, "pararia-firebase");
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
assert.match(schema, /model TeacherRecordingNotificationAttempt/);
assert.match(schema, /recordingId\s+String/);
assert.match(schema, /deviceId\s+String\?/);
assert.match(schema, /sentAt\s+DateTime/);
assert.match(schema, /kind\s+TeacherRecordingNotificationKind/);
assert.match(schema, /success\s+Boolean/);
assert.match(schema, /failureReason\s+String\?/);
assert.match(schema, /permissionStatus\s+String\?/);

const historyMigration = readFileSync(
  "prisma/migrations/20260428150000_teacher_recording_notification_history/migration.sql",
  "utf8"
);
assert.match(historyMigration, /CREATE TABLE "TeacherRecordingNotificationAttempt"/);
assert.match(historyMigration, /"recordingId" TEXT NOT NULL/);
assert.match(historyMigration, /"deviceId" TEXT/);

const manifest = readFileSync("native/android/app/src/main/AndroidManifest.xml", "utf8");
assert.match(manifest, /POST_NOTIFICATIONS/);
assert.match(manifest, /TeacherMessagingService/);
assert.match(manifest, /jp\.pararia\.teacherapp\.OPEN_RECORDING/);

const gradle = readFileSync("native/android/app/build.gradle.kts", "utf8");
assert.match(gradle, /firebase-bom/);
assert.match(gradle, /PARARIA_FIREBASE_PROJECT_ID/);

type TestDevice = {
  id: string;
  organizationId: string;
  pushToken: string | null;
  pushTokenProvider: string | null;
  pushNotificationPermission: string | null;
};

type TestRecording = {
  id: string;
  organizationId: string;
  deviceLabel: string;
  durationSeconds: number | null;
  device: TestDevice | null;
};

const fixedSentAt = new Date("2026-04-28T01:02:03.000Z");

function createTestRecording(deviceOverrides?: Partial<TestDevice> | null): TestRecording {
  return {
    id: "rec_123",
    organizationId: "org_123",
    deviceLabel: "渋谷校 Android",
    durationSeconds: 120,
    device:
      deviceOverrides === null
        ? null
        : {
            id: "device_123",
            organizationId: "org_123",
            pushToken: "push_token_123",
            pushTokenProvider: "FCM",
            pushNotificationPermission: "granted",
            ...deviceOverrides,
          },
  };
}

function createNotificationTestDb(recording: TestRecording | null) {
  const attempts: any[] = [];
  const deviceUpdates: any[] = [];
  return {
    attempts,
    deviceUpdates,
    db: {
      teacherRecordingSession: {
        findFirst: async () => recording,
      },
      teacherAppDevice: {
        updateMany: async (args: any) => {
          deviceUpdates.push(args);
          return { count: 1 };
        },
      },
      teacherRecordingNotificationAttempt: {
        create: async (args: { data: any }) => {
          attempts.push(args.data);
          return args.data;
        },
      },
    },
  };
}

function createSendMessage(result: FcmSendResult) {
  const messages: FcmSendInput[] = [];
  return {
    messages,
    sendMessage: async (input: FcmSendInput): Promise<FcmSendResult> => {
      messages.push(input);
      return result;
    },
  };
}

{
  const { db, attempts, deviceUpdates } = createNotificationTestDb(createTestRecording());
  const { sendMessage, messages } = createSendMessage({
    ok: true,
    skipped: false,
    messageName: "projects/pararia/messages/1",
  });
  const result = await notifyTeacherRecordingDevice(
    {
      recordingId: "rec_123",
      organizationId: "org_123",
      kind: "ready",
    },
    { db, sendMessage, now: () => fixedSentAt }
  );
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(messages.length, 1);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].recordingId, "rec_123");
  assert.equal(attempts[0].deviceId, "device_123");
  assert.equal(attempts[0].sentAt, fixedSentAt);
  assert.equal(attempts[0].kind, "READY");
  assert.equal(attempts[0].success, true);
  assert.equal(attempts[0].skipped, false);
  assert.equal(attempts[0].failureReason, null);
  assert.equal(attempts[0].permissionStatus, "granted");
  assert.equal(attempts[0].fcmMessageName, "projects/pararia/messages/1");
  assert.equal(deviceUpdates[0].data.lastPushSentAt, fixedSentAt);
  assert.equal(deviceUpdates[0].data.lastPushError, null);
}

{
  const { db, attempts, deviceUpdates } = createNotificationTestDb(createTestRecording());
  const { sendMessage } = createSendMessage({
    ok: false,
    skipped: false,
    error: "FCM quota exhausted",
    status: 429,
  });
  const result = await notifyTeacherRecordingDevice(
    {
      recordingId: "rec_123",
      organizationId: "org_123",
      kind: "ready",
    },
    { db, sendMessage, now: () => fixedSentAt }
  );
  assert.equal(result.ok, false);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].success, false);
  assert.equal(attempts[0].skipped, false);
  assert.equal(attempts[0].failureReason, "FCM quota exhausted");
  assert.equal(attempts[0].fcmStatus, 429);
  assert.equal(deviceUpdates[0].data.lastPushError, "FCM quota exhausted");
  assert.equal(deviceUpdates[0].data.lastPushErrorAt, fixedSentAt);
}

{
  const { db, attempts } = createNotificationTestDb(
    createTestRecording({ pushNotificationPermission: null })
  );
  const { sendMessage, messages } = createSendMessage({
    ok: true,
    skipped: false,
    messageName: "projects/pararia/messages/unknown-permission",
  });
  await notifyTeacherRecordingDevice(
    {
      recordingId: "rec_123",
      organizationId: "org_123",
      kind: "ready",
    },
    { db, sendMessage, now: () => fixedSentAt }
  );
  assert.equal(messages.length, 1);
  assert.equal(attempts[0].permissionStatus, "unknown");
  assert.equal(attempts[0].success, true);
}

{
  const { db, attempts } = createNotificationTestDb(createTestRecording());
  let sendCount = 0;
  const sendMessage = async (input: FcmSendInput): Promise<FcmSendResult> => {
    assert.equal(input.token, "push_token_123");
    sendCount += 1;
    return {
      ok: true,
      skipped: false,
      messageName: `projects/pararia/messages/${sendCount}`,
    };
  };
  await notifyTeacherRecordingDevice(
    {
      recordingId: "rec_123",
      organizationId: "org_123",
      kind: "ready",
    },
    { db, sendMessage, now: () => fixedSentAt }
  );
  await notifyTeacherRecordingDevice(
    {
      recordingId: "rec_123",
      organizationId: "org_123",
      kind: "error",
      errorMessage: "worker failed",
    },
    { db, sendMessage, now: () => fixedSentAt }
  );
  assert.equal(sendCount, 2);
  assert.deepEqual(
    attempts.map((attempt) => attempt.kind),
    ["READY", "ERROR"]
  );
  assert.deepEqual(
    attempts.map((attempt) => attempt.fcmMessageName),
    ["projects/pararia/messages/1", "projects/pararia/messages/2"]
  );
}

{
  const { db, attempts, deviceUpdates } = createNotificationTestDb(
    createTestRecording({ pushToken: null })
  );
  let sent = false;
  const result = await notifyTeacherRecordingDevice(
    {
      recordingId: "rec_123",
      organizationId: "org_123",
      kind: "ready",
    },
    {
      db,
      sendMessage: async () => {
        sent = true;
        return { ok: true, skipped: false, messageName: "unexpected" };
      },
      now: () => fixedSentAt,
    }
  );
  assert.equal(sent, false);
  assert.equal(result.skipped, true);
  if (!result.skipped) throw new Error("expected push token missing to skip");
  assert.equal(result.reason, "push_token_missing");
  assert.equal(attempts[0].success, false);
  assert.equal(attempts[0].skipped, true);
  assert.equal(attempts[0].failureReason, "push_token_missing");
  assert.equal(deviceUpdates.length, 0);
}

{
  const { db, attempts } = createNotificationTestDb(
    createTestRecording({ pushNotificationPermission: "denied" })
  );
  const result = await notifyTeacherRecordingDevice(
    {
      recordingId: "rec_123",
      organizationId: "org_123",
      kind: "ready",
    },
    {
      db,
      sendMessage: async () => ({ ok: true, skipped: false, messageName: "unexpected" }),
      now: () => fixedSentAt,
    }
  );
  assert.equal(result.skipped, true);
  if (!result.skipped) throw new Error("expected denied permission to skip");
  assert.equal(result.reason, "notifications_denied");
  assert.equal(attempts[0].permissionStatus, "denied");
  assert.equal(attempts[0].failureReason, "notifications_denied");
}

console.log("teacher app notification checks passed");
