ALTER TABLE "TeacherAppDevice"
ADD COLUMN "pushToken" TEXT,
ADD COLUMN "pushTokenProvider" TEXT,
ADD COLUMN "pushNotificationPermission" TEXT,
ADD COLUMN "pushTokenUpdatedAt" TIMESTAMP(3),
ADD COLUMN "lastPushSentAt" TIMESTAMP(3),
ADD COLUMN "lastPushError" TEXT,
ADD COLUMN "lastPushErrorAt" TIMESTAMP(3);

CREATE INDEX "TeacherAppDevice_organizationId_status_pushTokenUpdatedAt_idx"
ON "TeacherAppDevice"("organizationId", "status", "pushTokenUpdatedAt");
