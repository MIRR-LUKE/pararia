import { ConversationSourceType, ConversationStatus, SessionType } from "@prisma/client";
import { prisma } from "../db";
import { preprocessTranscript } from "../transcript/preprocess";
import { analyzeChunkBlocks, reduceChunkAnalyses, finalizeConversationArtifacts } from "../ai/conversationPipeline";

type CreateConversationInput = {
  transcript: string;
  organizationId: string;
  studentId: string;
  userId?: string;
  sourceType?: ConversationSourceType;
  studentName?: string;
  sessionType?: SessionType;
};

export async function createStructuredConversationLog({
  transcript,
  organizationId,
  studentId,
  userId,
  sourceType = ConversationSourceType.MANUAL,
  studentName,
  sessionType = SessionType.INTERVIEW,
}: CreateConversationInput) {
  console.log("[createStructuredConversationLog] Starting...", {
    studentId,
    organizationId,
    transcriptLength: transcript.length,
  });

  const pre = preprocessTranscript(transcript);
  const { analyses } = await analyzeChunkBlocks(
    pre.blocks.map((b) => ({ index: b.index, text: b.text, hash: b.hash })),
    {
      studentName,
      sessionType: sessionType === SessionType.LESSON_REPORT ? "LESSON_REPORT" : "INTERVIEW",
    }
  );
  const { reduced } = await reduceChunkAnalyses({
    analyses,
    studentName,
    sessionType: sessionType === SessionType.LESSON_REPORT ? "LESSON_REPORT" : "INTERVIEW",
  });
  const { result } = await finalizeConversationArtifacts({
    studentName,
    reduced,
    minSummaryChars: transcript.length >= 20000 ? 1200 : 700,
    sessionType: sessionType === SessionType.LESSON_REPORT ? "LESSON_REPORT" : "INTERVIEW",
  });
  const summaryMarkdown = result.summaryMarkdown;

  console.log("[createStructuredConversationLog] Creating conversation log in DB...");
  const conversation = await prisma.conversationLog.create({
    data: {
      organizationId,
      studentId,
      userId,
      sourceType,
      status: ConversationStatus.DONE,
      summaryMarkdown,
    },
  });
  console.log("[createStructuredConversationLog] Conversation log created:", {
    id: conversation.id,
  });

  return conversation;
}
