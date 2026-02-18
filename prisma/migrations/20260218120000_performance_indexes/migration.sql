-- Performance indexes for conversation/job/report read paths
CREATE INDEX IF NOT EXISTS "Student_organizationId_createdAt_idx"
  ON "Student"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "ConversationLog_studentId_createdAt_idx"
  ON "ConversationLog"("studentId", "createdAt");

CREATE INDEX IF NOT EXISTS "ConversationLog_organizationId_createdAt_idx"
  ON "ConversationLog"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "ConversationLog_rawTextExpiresAt_idx"
  ON "ConversationLog"("rawTextExpiresAt");

CREATE INDEX IF NOT EXISTS "ConversationJob_conversationId_type_status_idx"
  ON "ConversationJob"("conversationId", "type", "status");

CREATE INDEX IF NOT EXISTS "Report_studentId_createdAt_idx"
  ON "Report"("studentId", "createdAt");

CREATE INDEX IF NOT EXISTS "Report_organizationId_createdAt_idx"
  ON "Report"("organizationId", "createdAt");
