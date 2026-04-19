CREATE TYPE "TeacherAppDeviceAuthSessionStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TYPE "TeacherAppClientPlatform" AS ENUM ('IOS', 'ANDROID', 'WEB', 'UNKNOWN');

ALTER TABLE "TeacherAppDevice"
ADD COLUMN "lastClientPlatform" "TeacherAppClientPlatform",
ADD COLUMN "lastAppVersion" TEXT,
ADD COLUMN "lastBuildNumber" TEXT;

CREATE TABLE "TeacherAppDeviceAuthSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" "TeacherAppDeviceAuthSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "clientPlatform" "TeacherAppClientPlatform" NOT NULL DEFAULT 'UNKNOWN',
    "appVersion" TEXT,
    "buildNumber" TEXT,
    "refreshTokenHash" TEXT NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "lastRefreshedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherAppDeviceAuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeacherAppDeviceAuthSession_refreshTokenHash_key"
ON "TeacherAppDeviceAuthSession"("refreshTokenHash");

CREATE INDEX "TeacherAppDeviceAuthSession_organizationId_deviceId_status_up_idx"
ON "TeacherAppDeviceAuthSession"("organizationId", "deviceId", "status", "updatedAt");

CREATE INDEX "TeacherAppDeviceAuthSession_organizationId_userId_status_upd_idx"
ON "TeacherAppDeviceAuthSession"("organizationId", "userId", "status", "updatedAt");

CREATE INDEX "TeacherAppDeviceAuthSession_refreshTokenExpiresAt_idx"
ON "TeacherAppDeviceAuthSession"("refreshTokenExpiresAt");

ALTER TABLE "TeacherAppDeviceAuthSession"
ADD CONSTRAINT "TeacherAppDeviceAuthSession_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherAppDeviceAuthSession"
ADD CONSTRAINT "TeacherAppDeviceAuthSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherAppDeviceAuthSession"
ADD CONSTRAINT "TeacherAppDeviceAuthSession_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "TeacherAppDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
