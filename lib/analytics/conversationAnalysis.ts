import { ConversationSourceType } from "@prisma/client";
import { prisma } from "../db";
import { structureConversation, StructuredDelta } from "../ai/llm";
import { applyProfileDelta } from "../profile";

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

  const structured = await structureConversation(transcript, { studentName });
  console.log("[createStructuredConversationLog] Structured data received:", {
    summaryLength: structured.summary.length,
    timeSectionsCount: structured.timeSections?.length ?? 0,
    keyQuotesCount: structured.keyQuotes.length,
    keyTopicsCount: structured.keyTopics.length,
    nextActionsCount: structured.nextActions.length,
    hasStructuredDelta: !!structured.structuredDelta,
  });

  console.log("[createStructuredConversationLog] Creating conversation log in DB...");
  const conversation = await prisma.conversationLog.create({
    data: {
      organizationId,
      studentId,
      userId,
      sourceType,
      summary: structured.summary,
      timeSections: structured.timeSections && structured.timeSections.length > 0 
        ? structured.timeSections 
        : undefined,
      keyQuotes: structured.keyQuotes,
      keyTopics: structured.keyTopics,
      nextActions: structured.nextActions,
      structuredDelta: structured.structuredDelta,
    },
  });
  console.log("[createStructuredConversationLog] Conversation log created:", {
    id: conversation.id,
    hasTimeSections: !!conversation.timeSections,
    timeSectionsType: conversation.timeSections ? typeof conversation.timeSections : "null",
  });

  try {
    console.log("[createStructuredConversationLog] Applying profile delta...");
    await applyProfileDelta(studentId, structured.structuredDelta as StructuredDelta, conversation.id);
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
