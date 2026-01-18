import { ConversationSourceType, ConversationStatus } from "@prisma/client";
import { prisma } from "../db";
import { applyProfileDelta } from "../profile";
import { preprocessTranscript } from "../transcript/preprocess";
import { analyzeChunkBlocks, reduceChunkAnalyses, finalizeConversationArtifacts } from "../ai/conversationPipeline";

type CreateConversationInput = {
  transcript: string;
  organizationId: string;
  studentId: string;
  userId?: string;
  sourceType?: ConversationSourceType;
  studentName?: string;
};

export async function createStructuredConversationLog({
  transcript,
  organizationId,
  studentId,
  userId,
  sourceType = ConversationSourceType.MANUAL,
  studentName,
}: CreateConversationInput) {
  console.log("[createStructuredConversationLog] Starting...", {
    studentId,
    organizationId,
    transcriptLength: transcript.length,
  });

  const pre = preprocessTranscript(transcript);
  const { analyses } = await analyzeChunkBlocks(
    pre.blocks.map((b) => ({ index: b.index, text: b.text, hash: b.hash })),
    { studentName }
  );
  const { reduced } = await reduceChunkAnalyses({ analyses, studentName });
  const { result } = await finalizeConversationArtifacts({
    studentName,
    reduced,
    minSummaryChars: transcript.length >= 20000 ? 1200 : 700,
  });

  console.log("[createStructuredConversationLog] Creating conversation log in DB...");
  const conversation = await prisma.conversationLog.create({
    data: {
      organizationId,
      studentId,
      userId,
      sourceType,
      status: ConversationStatus.DONE,
      summaryMarkdown: result.summaryMarkdown,
      timelineJson: result.timeline as any,
      nextActionsJson: result.nextActions as any,
      profileDeltaJson: result.profileDelta as any,
      parentPackJson: result.parentPack as any,
    },
  });
  console.log("[createStructuredConversationLog] Conversation log created:", {
    id: conversation.id,
  });

  try {
    console.log("[createStructuredConversationLog] Applying profile delta...");
    await applyProfileDelta(studentId, result.profileDelta, conversation.id);
    console.log("[createStructuredConversationLog] Profile delta applied successfully");
  } catch (profileError: any) {
    console.error("[createStructuredConversationLog] Profile delta failed (non-fatal):", {
      error: profileError?.message,
      stack: profileError?.stack,
    });
    // プロフィール更新の失敗は会話ログ作成を阻害しない
  }

  return conversation;
}
