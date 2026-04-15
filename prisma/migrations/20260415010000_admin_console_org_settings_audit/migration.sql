ALTER TABLE "Organization"
ADD COLUMN "planCode" TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN "studentLimit" INTEGER,
ADD COLUMN "defaultLocale" TEXT NOT NULL DEFAULT 'ja-JP',
ADD COLUMN "defaultTimeZone" TEXT NOT NULL DEFAULT 'Asia/Tokyo',
ADD COLUMN "guardianConsentRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "consentVersion" TEXT,
ADD COLUMN "consentUpdatedAt" TIMESTAMP(3);

ALTER TABLE "AuditLog"
ADD COLUMN "organizationId" TEXT,
ADD COLUMN "targetType" TEXT,
ADD COLUMN "targetId" TEXT,
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'SUCCESS',
ADD COLUMN "detailJson" JSONB;

CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
