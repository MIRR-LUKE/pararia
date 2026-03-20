-- CreateEnum
CREATE TYPE "RecordingLockMode" AS ENUM ('INTERVIEW', 'LESSON_REPORT');

-- CreateTable
CREATE TABLE "StudentRecordingLock" (
    "studentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lockedByUserId" TEXT NOT NULL,
    "lockTokenHash" TEXT NOT NULL,
    "mode" "RecordingLockMode" NOT NULL,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentRecordingLock_pkey" PRIMARY KEY ("studentId")
);

-- CreateTable
CREATE TABLE "OrganizationInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'TEACHER',
    "tokenHash" TEXT NOT NULL,
    "invitedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationInvitation_tokenHash_key" ON "OrganizationInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "OrganizationInvitation_organizationId_acceptedAt_idx" ON "OrganizationInvitation"("organizationId", "acceptedAt");

-- CreateIndex
CREATE INDEX "OrganizationInvitation_email_organizationId_idx" ON "OrganizationInvitation"("email", "organizationId");

-- CreateIndex
CREATE INDEX "StudentRecordingLock_organizationId_idx" ON "StudentRecordingLock"("organizationId");

-- CreateIndex
CREATE INDEX "StudentRecordingLock_expiresAt_idx" ON "StudentRecordingLock"("expiresAt");

-- AddForeignKey
ALTER TABLE "StudentRecordingLock" ADD CONSTRAINT "StudentRecordingLock_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRecordingLock" ADD CONSTRAINT "StudentRecordingLock_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRecordingLock" ADD CONSTRAINT "StudentRecordingLock_lockedByUserId_fkey" FOREIGN KEY ("lockedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
