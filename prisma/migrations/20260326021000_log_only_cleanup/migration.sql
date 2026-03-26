DELETE FROM "ConversationJob"
WHERE "type"::text IN ('CHUNK_ANALYZE', 'REDUCE', 'POLISH', 'REPORT');

ALTER TABLE "ConversationLog"
  DROP COLUMN IF EXISTS "timelineJson",
  DROP COLUMN IF EXISTS "nextActionsJson",
  DROP COLUMN IF EXISTS "profileDeltaJson",
  DROP COLUMN IF EXISTS "parentPackJson",
  DROP COLUMN IF EXISTS "studentStateJson",
  DROP COLUMN IF EXISTS "topicSuggestionsJson",
  DROP COLUMN IF EXISTS "quickQuestionsJson",
  DROP COLUMN IF EXISTS "profileSectionsJson",
  DROP COLUMN IF EXISTS "observationJson",
  DROP COLUMN IF EXISTS "lessonReportJson",
  DROP COLUMN IF EXISTS "chunkAnalysisJson";

ALTER TYPE "ConversationJobType" RENAME TO "ConversationJobType_old";
CREATE TYPE "ConversationJobType" AS ENUM ('FINALIZE', 'FORMAT');

ALTER TABLE "ConversationJob"
  ALTER COLUMN "type" TYPE "ConversationJobType"
  USING ("type"::text::"ConversationJobType");

DROP TYPE "ConversationJobType_old";
