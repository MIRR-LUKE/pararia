ALTER TABLE "ConversationLog"
ADD COLUMN "processingLeaseExecutionId" TEXT,
ADD COLUMN "processingLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "processingLeaseStartedAt" TIMESTAMP(3),
ADD COLUMN "processingLeaseHeartbeatAt" TIMESTAMP(3);

CREATE INDEX "ConversationLog_status_processingLeaseExpiresAt_idx"
ON "ConversationLog"("status", "processingLeaseExpiresAt");

CREATE INDEX "ConversationLog_organizationId_processingLeaseExpiresAt_idx"
ON "ConversationLog"("organizationId", "processingLeaseExpiresAt");
