CREATE TYPE "PlatformRole" AS ENUM (
  'PLATFORM_OWNER',
  'OPS_ADMIN',
  'SUPPORT_LEAD',
  'CUSTOMER_SUCCESS',
  'READONLY_AUDITOR',
  'ENGINEER_ONCALL'
);

CREATE TABLE "PlatformOperator" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "displayName" TEXT,
  "role" "PlatformRole" NOT NULL DEFAULT 'CUSTOMER_SUCCESS',
  "disabledAt" TIMESTAMP(3),
  "lastSignedInAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlatformOperator_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformAuditLog" (
  "id" TEXT NOT NULL,
  "actorOperatorId" TEXT,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUCCESS',
  "reason" TEXT,
  "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
  "targetType" TEXT,
  "targetId" TEXT,
  "targetOrganizationId" TEXT,
  "requestId" TEXT,
  "requestIpHash" TEXT,
  "userAgentHash" TEXT,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformOperator_email_key" ON "PlatformOperator"("email");
CREATE INDEX "PlatformOperator_role_disabledAt_idx" ON "PlatformOperator"("role", "disabledAt");
CREATE INDEX "PlatformOperator_disabledAt_updatedAt_idx" ON "PlatformOperator"("disabledAt", "updatedAt");
CREATE INDEX "PlatformAuditLog_actorOperatorId_createdAt_idx" ON "PlatformAuditLog"("actorOperatorId", "createdAt");
CREATE INDEX "PlatformAuditLog_targetOrganizationId_createdAt_idx" ON "PlatformAuditLog"("targetOrganizationId", "createdAt");
CREATE INDEX "PlatformAuditLog_targetType_targetId_createdAt_idx" ON "PlatformAuditLog"("targetType", "targetId", "createdAt");
CREATE INDEX "PlatformAuditLog_action_createdAt_idx" ON "PlatformAuditLog"("action", "createdAt");
CREATE INDEX "PlatformAuditLog_status_createdAt_idx" ON "PlatformAuditLog"("status", "createdAt");

ALTER TABLE "PlatformAuditLog"
  ADD CONSTRAINT "PlatformAuditLog_actorOperatorId_fkey"
  FOREIGN KEY ("actorOperatorId")
  REFERENCES "PlatformOperator"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
