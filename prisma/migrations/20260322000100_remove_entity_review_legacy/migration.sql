ALTER TABLE "ConversationLog"
  DROP COLUMN IF EXISTS "entityCandidatesJson";

ALTER TABLE "Session"
  DROP COLUMN IF EXISTS "pendingEntityCount";

DROP TABLE IF EXISTS "SessionEntity";
DROP TABLE IF EXISTS "StudentEntity";

DROP TYPE IF EXISTS "EntityStatus";
DROP TYPE IF EXISTS "EntityKind";
