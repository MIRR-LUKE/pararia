DO $$
BEGIN
  CREATE TYPE "SessionType" AS ENUM ('INTERVIEW', 'LESSON_REPORT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SessionStatus" AS ENUM ('DRAFT', 'COLLECTING', 'PROCESSING', 'READY', 'ERROR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SessionPartType" AS ENUM ('FULL', 'CHECK_IN', 'CHECK_OUT', 'TEXT_NOTE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SessionPartStatus" AS ENUM ('PENDING', 'UPLOADING', 'TRANSCRIBING', 'READY', 'ERROR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "EntityKind" AS ENUM ('SCHOOL', 'TARGET_SCHOOL', 'MATERIAL', 'EXAM', 'CRAM_SCHOOL', 'TEACHER', 'METRIC', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "EntityStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IGNORED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'REVIEWED', 'SENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'INSTRUCTOR';

ALTER TABLE "ConversationLog"
  ADD COLUMN IF NOT EXISTS "sessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "studentStateJson" JSONB,
  ADD COLUMN IF NOT EXISTS "topicSuggestionsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "quickQuestionsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "profileSectionsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "observationJson" JSONB,
  ADD COLUMN IF NOT EXISTS "entityCandidatesJson" JSONB,
  ADD COLUMN IF NOT EXISTS "lessonReportJson" JSONB;

ALTER TABLE "Report"
  ADD COLUMN IF NOT EXISTS "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sentByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryChannel" TEXT,
  ADD COLUMN IF NOT EXISTS "qualityChecksJson" JSONB;

CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "userId" TEXT,
  "type" "SessionType" NOT NULL,
  "status" "SessionStatus" NOT NULL DEFAULT 'DRAFT',
  "title" TEXT,
  "notes" TEXT,
  "sessionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heroStateLabel" TEXT,
  "heroOneLiner" TEXT,
  "latestSummary" TEXT,
  "pendingEntityCount" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SessionPart" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "partType" "SessionPartType" NOT NULL,
  "sourceType" "ConversationSourceType" NOT NULL DEFAULT 'AUDIO',
  "status" "SessionPartStatus" NOT NULL DEFAULT 'PENDING',
  "fileName" TEXT,
  "mimeType" TEXT,
  "byteSize" INTEGER,
  "storageUrl" TEXT,
  "rawTextOriginal" TEXT,
  "rawTextCleaned" TEXT,
  "rawSegments" JSONB,
  "qualityMetaJson" JSONB,
  "transcriptExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionPart_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StudentEntity" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "kind" "EntityKind" NOT NULL,
  "canonicalName" TEXT NOT NULL,
  "aliasesJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SessionEntity" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "conversationId" TEXT,
  "studentId" TEXT NOT NULL,
  "studentEntityId" TEXT,
  "kind" "EntityKind" NOT NULL,
  "rawValue" TEXT NOT NULL,
  "canonicalValue" TEXT,
  "confidence" INTEGER NOT NULL DEFAULT 50,
  "status" "EntityStatus" NOT NULL DEFAULT 'PENDING',
  "occurrencesJson" JSONB,
  "sourceJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionEntity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConversationLog_sessionId_key" ON "ConversationLog"("sessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "SessionPart_sessionId_partType_key" ON "SessionPart"("sessionId", "partType");
CREATE UNIQUE INDEX IF NOT EXISTS "StudentEntity_studentId_kind_canonicalName_key"
  ON "StudentEntity"("studentId", "kind", "canonicalName");

CREATE INDEX IF NOT EXISTS "Session_studentId_sessionDate_idx" ON "Session"("studentId", "sessionDate");
CREATE INDEX IF NOT EXISTS "Session_organizationId_sessionDate_idx" ON "Session"("organizationId", "sessionDate");
CREATE INDEX IF NOT EXISTS "Session_status_type_idx" ON "Session"("status", "type");
CREATE INDEX IF NOT EXISTS "SessionPart_sessionId_status_idx" ON "SessionPart"("sessionId", "status");
CREATE INDEX IF NOT EXISTS "StudentEntity_studentId_kind_idx" ON "StudentEntity"("studentId", "kind");
CREATE INDEX IF NOT EXISTS "SessionEntity_sessionId_status_idx" ON "SessionEntity"("sessionId", "status");
CREATE INDEX IF NOT EXISTS "SessionEntity_studentId_kind_idx" ON "SessionEntity"("studentId", "kind");

ALTER TABLE "ConversationLog"
  ADD CONSTRAINT "ConversationLog_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Report"
  ADD CONSTRAINT "Report_sentByUserId_fkey"
  FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SessionPart"
  ADD CONSTRAINT "SessionPart_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudentEntity"
  ADD CONSTRAINT "StudentEntity_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionEntity"
  ADD CONSTRAINT "SessionEntity_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionEntity"
  ADD CONSTRAINT "SessionEntity_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "ConversationLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SessionEntity"
  ADD CONSTRAINT "SessionEntity_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionEntity"
  ADD CONSTRAINT "SessionEntity_studentEntityId_fkey"
  FOREIGN KEY ("studentEntityId") REFERENCES "StudentEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
