CREATE TYPE "ReportDeliveryEventType" AS ENUM (
  'DRAFT_CREATED',
  'REVIEWED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'BOUNCED',
  'MANUAL_SHARED',
  'RESENT'
);

CREATE TABLE "ReportDeliveryEvent" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "eventType" "ReportDeliveryEventType" NOT NULL,
  "deliveryChannel" TEXT,
  "note" TEXT,
  "eventMetaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReportDeliveryEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportDeliveryEvent_reportId_createdAt_idx"
  ON "ReportDeliveryEvent"("reportId", "createdAt");

CREATE INDEX "ReportDeliveryEvent_organizationId_createdAt_idx"
  ON "ReportDeliveryEvent"("organizationId", "createdAt");

CREATE INDEX "ReportDeliveryEvent_studentId_createdAt_idx"
  ON "ReportDeliveryEvent"("studentId", "createdAt");

ALTER TABLE "ReportDeliveryEvent"
  ADD CONSTRAINT "ReportDeliveryEvent_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "Report"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportDeliveryEvent"
  ADD CONSTRAINT "ReportDeliveryEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportDeliveryEvent"
  ADD CONSTRAINT "ReportDeliveryEvent_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportDeliveryEvent"
  ADD CONSTRAINT "ReportDeliveryEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
