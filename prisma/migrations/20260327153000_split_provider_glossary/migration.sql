ALTER TABLE "ProperNounGlossaryEntry"
ADD COLUMN IF NOT EXISTS "sendToProvider" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "ProperNounGlossaryEntry_organizationId_sendToProvider_idx"
ON "ProperNounGlossaryEntry"("organizationId", "sendToProvider");
