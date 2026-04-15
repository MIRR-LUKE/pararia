-- Soft delete support for conversation logs and parent reports.

ALTER TABLE "ConversationLog"
ADD COLUMN "deletedSessionId" TEXT,
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedByUserId" TEXT,
ADD COLUMN "deletedReason" TEXT;

ALTER TABLE "Report"
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedByUserId" TEXT,
ADD COLUMN "deletedReason" TEXT;

ALTER TABLE "ConversationLog"
ADD CONSTRAINT "ConversationLog_deletedByUserId_fkey"
FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Report"
ADD CONSTRAINT "Report_deletedByUserId_fkey"
FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ConversationLog_organizationId_deletedAt_createdAt_idx"
ON "ConversationLog"("organizationId", "deletedAt", "createdAt");

CREATE INDEX "ConversationLog_studentId_deletedAt_createdAt_idx"
ON "ConversationLog"("studentId", "deletedAt", "createdAt");

CREATE INDEX "Report_organizationId_deletedAt_createdAt_idx"
ON "Report"("organizationId", "deletedAt", "createdAt");

CREATE INDEX "Report_studentId_deletedAt_createdAt_idx"
ON "Report"("studentId", "deletedAt", "createdAt");
