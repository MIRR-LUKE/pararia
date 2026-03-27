DO $$
BEGIN
  CREATE TYPE "TranscriptReviewState" AS ENUM ('NONE', 'REQUIRED', 'RESOLVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ProperNounKind" AS ENUM (
    'SCHOOL',
    'MOCK_EXAM',
    'MATERIAL',
    'TEXTBOOK',
    'TUTOR',
    'STUDENT',
    'CAMPUS',
    'SERVICE',
    'EXAM',
    'UNIT',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ProperNounSuggestionSource" AS ENUM ('GLOSSARY', 'CONTEXT', 'ALIAS', 'HEURISTIC');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ProperNounSuggestionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'MANUALLY_EDITED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ConversationLog"
  ADD COLUMN IF NOT EXISTS "reviewedText" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewState" "TranscriptReviewState" NOT NULL DEFAULT 'NONE';

ALTER TABLE "SessionPart"
  ADD COLUMN IF NOT EXISTS "reviewedText" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewState" "TranscriptReviewState" NOT NULL DEFAULT 'NONE';

CREATE TABLE IF NOT EXISTS "ProperNounGlossaryEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "studentId" TEXT,
  "tutorUserId" TEXT,
  "kind" "ProperNounKind" NOT NULL DEFAULT 'OTHER',
  "canonicalValue" TEXT NOT NULL,
  "aliasesJson" JSONB,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProperNounGlossaryEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProperNounSuggestion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "sessionId" TEXT,
  "sessionPartId" TEXT,
  "conversationId" TEXT,
  "glossaryEntryId" TEXT,
  "kind" "ProperNounKind" NOT NULL DEFAULT 'OTHER',
  "rawValue" TEXT NOT NULL,
  "suggestedValue" TEXT NOT NULL,
  "finalValue" TEXT,
  "reason" TEXT NOT NULL,
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "source" "ProperNounSuggestionSource" NOT NULL,
  "status" "ProperNounSuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "spanJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProperNounSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProperNounGlossaryEntry_organizationId_kind_idx"
  ON "ProperNounGlossaryEntry"("organizationId", "kind");
CREATE INDEX IF NOT EXISTS "ProperNounGlossaryEntry_studentId_kind_idx"
  ON "ProperNounGlossaryEntry"("studentId", "kind");
CREATE INDEX IF NOT EXISTS "ProperNounGlossaryEntry_tutorUserId_kind_idx"
  ON "ProperNounGlossaryEntry"("tutorUserId", "kind");

CREATE INDEX IF NOT EXISTS "ProperNounSuggestion_organizationId_status_idx"
  ON "ProperNounSuggestion"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "ProperNounSuggestion_studentId_status_idx"
  ON "ProperNounSuggestion"("studentId", "status");
CREATE INDEX IF NOT EXISTS "ProperNounSuggestion_sessionPartId_status_idx"
  ON "ProperNounSuggestion"("sessionPartId", "status");
CREATE INDEX IF NOT EXISTS "ProperNounSuggestion_conversationId_status_idx"
  ON "ProperNounSuggestion"("conversationId", "status");

ALTER TABLE "ProperNounGlossaryEntry"
  ADD CONSTRAINT "ProperNounGlossaryEntry_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProperNounGlossaryEntry"
  ADD CONSTRAINT "ProperNounGlossaryEntry_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProperNounGlossaryEntry"
  ADD CONSTRAINT "ProperNounGlossaryEntry_tutorUserId_fkey"
  FOREIGN KEY ("tutorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProperNounSuggestion"
  ADD CONSTRAINT "ProperNounSuggestion_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProperNounSuggestion"
  ADD CONSTRAINT "ProperNounSuggestion_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProperNounSuggestion"
  ADD CONSTRAINT "ProperNounSuggestion_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProperNounSuggestion"
  ADD CONSTRAINT "ProperNounSuggestion_sessionPartId_fkey"
  FOREIGN KEY ("sessionPartId") REFERENCES "SessionPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProperNounSuggestion"
  ADD CONSTRAINT "ProperNounSuggestion_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "ConversationLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProperNounSuggestion"
  ADD CONSTRAINT "ProperNounSuggestion_glossaryEntryId_fkey"
  FOREIGN KEY ("glossaryEntryId") REFERENCES "ProperNounGlossaryEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
