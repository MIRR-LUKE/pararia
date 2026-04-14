-- Recoverable student lifecycle:
-- 1. hard delete is replaced by archive
-- 2. immutable snapshots are kept before archive

ALTER TABLE "Student"
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "archivedByUserId" TEXT,
ADD COLUMN "archiveReason" TEXT;

CREATE INDEX "Student_organizationId_archivedAt_createdAt_idx"
ON "Student"("organizationId", "archivedAt", "createdAt");

CREATE INDEX "Student_organizationId_archivedAt_name_idx"
ON "Student"("organizationId", "archivedAt", "name");

CREATE TABLE "StudentArchiveSnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "studentName" TEXT NOT NULL,
  "archivedByUserId" TEXT,
  "reason" TEXT,
  "runtimePathsJson" JSONB,
  "snapshotJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StudentArchiveSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentArchiveSnapshot_organizationId_createdAt_idx"
ON "StudentArchiveSnapshot"("organizationId", "createdAt");

CREATE INDEX "StudentArchiveSnapshot_studentId_createdAt_idx"
ON "StudentArchiveSnapshot"("studentId", "createdAt");
