-- Delete legacy lesson-report/demo rows before recreating enums without those values.
DELETE FROM "ReportDeliveryEvent" event
USING "Report" report
WHERE event."reportId" = report.id
  AND EXISTS (
    SELECT 1
    FROM "ConversationLog" conversation
    JOIN "Session" session ON session.id = conversation."sessionId"
    WHERE session."type"::text = 'LESSON_REPORT'
      AND COALESCE(report."sourceLogIds"::text, '') LIKE '%' || conversation.id || '%'
  );

DELETE FROM "Report" report
WHERE EXISTS (
  SELECT 1
  FROM "ConversationLog" conversation
  JOIN "Session" session ON session.id = conversation."sessionId"
  WHERE session."type"::text = 'LESSON_REPORT'
    AND COALESCE(report."sourceLogIds"::text, '') LIKE '%' || conversation.id || '%'
);

DELETE FROM "ProperNounSuggestion"
WHERE "sessionId" IN (
    SELECT id FROM "Session" WHERE "type"::text = 'LESSON_REPORT'
  )
  OR "sessionPartId" IN (
    SELECT id FROM "SessionPart" WHERE "partType"::text IN ('CHECK_IN', 'CHECK_OUT')
  )
  OR "conversationId" IN (
    SELECT conversation.id
    FROM "ConversationLog" conversation
    JOIN "Session" session ON session.id = conversation."sessionId"
    WHERE session."type"::text = 'LESSON_REPORT'
  );

DELETE FROM "NextMeetingMemo"
WHERE "sessionId" IN (
    SELECT id FROM "Session" WHERE "type"::text = 'LESSON_REPORT'
  )
  OR "conversationId" IN (
    SELECT conversation.id
    FROM "ConversationLog" conversation
    JOIN "Session" session ON session.id = conversation."sessionId"
    WHERE session."type"::text = 'LESSON_REPORT'
  );

DELETE FROM "ConversationJob"
WHERE "conversationId" IN (
  SELECT conversation.id
  FROM "ConversationLog" conversation
  JOIN "Session" session ON session.id = conversation."sessionId"
  WHERE session."type"::text = 'LESSON_REPORT'
);

DELETE FROM "SessionPartJob"
WHERE "sessionPartId" IN (
  SELECT id
  FROM "SessionPart"
  WHERE "partType"::text IN ('CHECK_IN', 'CHECK_OUT')
     OR "sessionId" IN (SELECT id FROM "Session" WHERE "type"::text = 'LESSON_REPORT')
);

DELETE FROM "BlobUploadReservation"
WHERE "partType"::text IN ('CHECK_IN', 'CHECK_OUT')
   OR "sessionId" IN (SELECT id FROM "Session" WHERE "type"::text = 'LESSON_REPORT');

DELETE FROM "ConversationLog"
WHERE "sessionId" IN (SELECT id FROM "Session" WHERE "type"::text = 'LESSON_REPORT');

DELETE FROM "SessionPart"
WHERE "partType"::text IN ('CHECK_IN', 'CHECK_OUT')
   OR "sessionId" IN (SELECT id FROM "Session" WHERE "type"::text = 'LESSON_REPORT');

DELETE FROM "StudentRecordingLock"
WHERE "mode"::text = 'LESSON_REPORT';

DELETE FROM "Session"
WHERE "type"::text = 'LESSON_REPORT';

CREATE TYPE "RecordingLockMode_new" AS ENUM ('INTERVIEW');
ALTER TABLE "StudentRecordingLock"
  ALTER COLUMN "mode" TYPE "RecordingLockMode_new"
  USING ("mode"::text::"RecordingLockMode_new");

CREATE TYPE "SessionType_new" AS ENUM ('INTERVIEW');
ALTER TABLE "Session"
  ALTER COLUMN "type" TYPE "SessionType_new"
  USING ("type"::text::"SessionType_new");

CREATE TYPE "SessionPartType_new" AS ENUM ('FULL', 'TEXT_NOTE');
ALTER TABLE "BlobUploadReservation"
  ALTER COLUMN "partType" TYPE "SessionPartType_new"
  USING ("partType"::text::"SessionPartType_new");
ALTER TABLE "SessionPart"
  ALTER COLUMN "partType" TYPE "SessionPartType_new"
  USING ("partType"::text::"SessionPartType_new");

DROP TYPE "RecordingLockMode";
ALTER TYPE "RecordingLockMode_new" RENAME TO "RecordingLockMode";

DROP TYPE "SessionType";
ALTER TYPE "SessionType_new" RENAME TO "SessionType";

DROP TYPE "SessionPartType";
ALTER TYPE "SessionPartType_new" RENAME TO "SessionPartType";
