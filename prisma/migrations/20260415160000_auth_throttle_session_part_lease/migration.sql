-- CreateTable
CREATE TABLE "AuthThrottle" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "lastFailureAt" TIMESTAMP(3),
    "blockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthThrottle_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Session"
ADD COLUMN "sessionPartLeaseExecutionId" TEXT,
ADD COLUMN "sessionPartLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "sessionPartLeaseHeartbeatAt" TIMESTAMP(3),
ADD COLUMN "sessionPartLeaseStartedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "AuthThrottle_scope_keyHash_key" ON "AuthThrottle"("scope", "keyHash");

-- CreateIndex
CREATE INDEX "AuthThrottle_scope_blockedUntil_idx" ON "AuthThrottle"("scope", "blockedUntil");

-- CreateIndex
CREATE INDEX "Session_sessionPartLeaseExpiresAt_idx" ON "Session"("sessionPartLeaseExpiresAt");
