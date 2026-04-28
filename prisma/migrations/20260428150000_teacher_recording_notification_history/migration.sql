CREATE TYPE "TeacherRecordingNotificationKind" AS ENUM ('READY', 'ERROR');

CREATE TABLE "TeacherRecordingNotificationAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "deviceId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "TeacherRecordingNotificationKind" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "permissionStatus" TEXT,
    "pushTokenProvider" TEXT,
    "fcmMessageName" TEXT,
    "fcmStatus" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherRecordingNotificationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeacherRecordingNotificationAttempt_org_recording_sent_idx"
ON "TeacherRecordingNotificationAttempt"("organizationId", "recordingId", "sentAt");

CREATE INDEX "TeacherRecordingNotificationAttempt_org_device_sent_idx"
ON "TeacherRecordingNotificationAttempt"("organizationId", "deviceId", "sentAt");

CREATE INDEX "TeacherRecordingNotificationAttempt_recording_sent_idx"
ON "TeacherRecordingNotificationAttempt"("recordingId", "sentAt");

CREATE INDEX "TeacherRecordingNotificationAttempt_device_sent_idx"
ON "TeacherRecordingNotificationAttempt"("deviceId", "sentAt");

ALTER TABLE "TeacherRecordingNotificationAttempt"
ADD CONSTRAINT "TeacherRecordingNotificationAttempt_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherRecordingNotificationAttempt"
ADD CONSTRAINT "TeacherRecordingNotificationAttempt_recordingId_fkey"
FOREIGN KEY ("recordingId") REFERENCES "TeacherRecordingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherRecordingNotificationAttempt"
ADD CONSTRAINT "TeacherRecordingNotificationAttempt_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "TeacherAppDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
