-- CreateEnum
CREATE TYPE "ConversationJobType" AS ENUM ('SUMMARY', 'EXTRACT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "ConversationLog" ADD COLUMN     "extractError" TEXT,
ADD COLUMN     "extractStatus" "JobStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "extractUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "rawSegments" JSONB,
ADD COLUMN     "rawTextCleaned" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rawTextOriginal" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "summaryError" TEXT,
ADD COLUMN     "summaryStatus" "JobStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "summaryUpdatedAt" TIMESTAMP(3),
ALTER COLUMN "summary" SET DEFAULT '';

-- CreateTable
CREATE TABLE "ConversationJob" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "type" "ConversationJobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationJob_status_type_idx" ON "ConversationJob"("status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationJob_conversationId_type_key" ON "ConversationJob"("conversationId", "type");

-- AddForeignKey
ALTER TABLE "ConversationJob" ADD CONSTRAINT "ConversationJob_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ConversationLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
