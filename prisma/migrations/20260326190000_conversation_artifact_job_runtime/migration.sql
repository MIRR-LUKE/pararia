ALTER TABLE "ConversationLog"
ADD COLUMN "artifactJson" JSONB;

ALTER TABLE "ConversationJob"
ADD COLUMN "executionId" TEXT,
ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "nextRetryAt" TIMESTAMP(3),
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
ADD COLUMN "failedAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "lastRunDurationMs" INTEGER,
ADD COLUMN "lastQueueLagMs" INTEGER;

CREATE INDEX "ConversationJob_status_nextRetryAt_type_idx"
ON "ConversationJob"("status", "nextRetryAt", "type");

CREATE INDEX "ConversationJob_conversationId_leaseExpiresAt_idx"
ON "ConversationJob"("conversationId", "leaseExpiresAt");
