UPDATE "ConversationLog"
SET "status" = 'DONE'
WHERE "status"::text = 'PARTIAL';

ALTER TYPE "ConversationStatus" RENAME TO "ConversationStatus_old";
CREATE TYPE "ConversationStatus" AS ENUM ('PROCESSING', 'DONE', 'ERROR');

ALTER TABLE "ConversationLog"
  ALTER COLUMN "status" TYPE "ConversationStatus"
  USING ("status"::text::"ConversationStatus");

DROP TYPE "ConversationStatus_old";
