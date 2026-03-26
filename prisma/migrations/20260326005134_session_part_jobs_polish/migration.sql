-- CreateEnum
CREATE TYPE "SessionPartJobType" AS ENUM ('TRANSCRIBE_FILE', 'FINALIZE_LIVE_PART', 'PROMOTE_SESSION');

-- CreateTable
CREATE TABLE "SessionPartJob" (
    "id" TEXT NOT NULL,
    "sessionPartId" TEXT NOT NULL,
    "type" "SessionPartJobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "outputJson" JSONB,
    "costMetaJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionPartJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionPartJob_status_type_idx" ON "SessionPartJob"("status", "type");

-- CreateIndex
CREATE INDEX "SessionPartJob_sessionPartId_type_status_idx" ON "SessionPartJob"("sessionPartId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SessionPartJob_sessionPartId_type_key" ON "SessionPartJob"("sessionPartId", "type");

-- AddForeignKey
ALTER TABLE "SessionPartJob" ADD CONSTRAINT "SessionPartJob_sessionPartId_fkey" FOREIGN KEY ("sessionPartId") REFERENCES "SessionPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
