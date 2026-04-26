ALTER TABLE "Organization"
  ADD COLUMN "contractStatus" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "contractRenewalDate" TIMESTAMP(3),
  ADD COLUMN "billingContactName" TEXT,
  ADD COLUMN "billingContactEmail" TEXT,
  ADD COLUMN "salesOwnerName" TEXT,
  ADD COLUMN "csOwnerName" TEXT,
  ADD COLUMN "usageLimitNote" TEXT,
  ADD COLUMN "supportNote" TEXT;

CREATE INDEX "Organization_contractStatus_updatedAt_idx" ON "Organization"("contractStatus", "updatedAt");
CREATE INDEX "Organization_planCode_updatedAt_idx" ON "Organization"("planCode", "updatedAt");
CREATE INDEX "Organization_updatedAt_createdAt_idx" ON "Organization"("updatedAt", "createdAt");
CREATE INDEX "User_organizationId_role_idx" ON "User"("organizationId", "role");
CREATE INDEX "OrganizationInvitation_organizationId_acceptedAt_expiresAt_idx" ON "OrganizationInvitation"("organizationId", "acceptedAt", "expiresAt");

CREATE INDEX "ConversationJob_status_updatedAt_createdAt_idx" ON "ConversationJob"("status", "updatedAt", "createdAt");
CREATE INDEX "ConversationJob_status_leaseExpiresAt_idx" ON "ConversationJob"("status", "leaseExpiresAt");
CREATE INDEX "ConversationJob_status_startedAt_idx" ON "ConversationJob"("status", "startedAt");
CREATE INDEX "SessionPartJob_status_updatedAt_createdAt_idx" ON "SessionPartJob"("status", "updatedAt", "createdAt");
CREATE INDEX "SessionPartJob_status_startedAt_idx" ON "SessionPartJob"("status", "startedAt");
CREATE INDEX "TeacherRecordingSession_organizationId_updatedAt_idx" ON "TeacherRecordingSession"("organizationId", "updatedAt");
CREATE INDEX "TeacherRecordingSession_organizationId_recordedAt_idx" ON "TeacherRecordingSession"("organizationId", "recordedAt");
CREATE INDEX "TeacherRecordingJob_organizationId_status_updatedAt_createdAt_idx" ON "TeacherRecordingJob"("organizationId", "status", "updatedAt", "createdAt");
CREATE INDEX "TeacherRecordingJob_organizationId_status_startedAt_idx" ON "TeacherRecordingJob"("organizationId", "status", "startedAt");
CREATE INDEX "StorageDeletionRequest_organizationId_status_updatedAt_idx" ON "StorageDeletionRequest"("organizationId", "status", "updatedAt");
CREATE INDEX "StorageDeletionRequest_status_updatedAt_createdAt_idx" ON "StorageDeletionRequest"("status", "updatedAt", "createdAt");
CREATE INDEX "ReportDeliveryEvent_organizationId_eventType_createdAt_idx" ON "ReportDeliveryEvent"("organizationId", "eventType", "createdAt");
