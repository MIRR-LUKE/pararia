-- CreateEnum
CREATE TYPE "NextMeetingMemoStatus" AS ENUM ('QUEUED', 'GENERATING', 'READY', 'FAILED');

-- AlterEnum
ALTER TYPE "ConversationJobType" ADD VALUE 'GENERATE_NEXT_MEETING_MEMO';

-- CreateTable
CREATE TABLE "NextMeetingMemo" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "NextMeetingMemoStatus" NOT NULL DEFAULT 'QUEUED',
    "previousSummary" TEXT,
    "suggestedTopics" TEXT,
    "rawJson" JSONB,
    "model" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NextMeetingMemo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NextMeetingMemo_sessionId_key" ON "NextMeetingMemo"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "NextMeetingMemo_conversationId_key" ON "NextMeetingMemo"("conversationId");

-- CreateIndex
CREATE INDEX "NextMeetingMemo_studentId_createdAt_idx" ON "NextMeetingMemo"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "NextMeetingMemo_organizationId_createdAt_idx" ON "NextMeetingMemo"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "NextMeetingMemo_status_updatedAt_idx" ON "NextMeetingMemo"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "NextMeetingMemo" ADD CONSTRAINT "NextMeetingMemo_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextMeetingMemo" ADD CONSTRAINT "NextMeetingMemo_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextMeetingMemo" ADD CONSTRAINT "NextMeetingMemo_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextMeetingMemo" ADD CONSTRAINT "NextMeetingMemo_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ConversationLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
