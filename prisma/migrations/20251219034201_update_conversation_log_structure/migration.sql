-- AlterTable
ALTER TABLE "ConversationLog" ADD COLUMN     "formattedTranscript" TEXT,
ADD COLUMN     "timeline" JSONB;
