import { prisma } from "@/lib/db";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import { normalizeRawTranscriptText, pickDisplayTranscriptText } from "@/lib/transcript/source";
import { selectSuggestionsWithSpan } from "@/lib/transcript/reviewed-text";
import type { ConversationSuggestionList } from "@/lib/transcript/review-types";

export async function buildConversationSuggestionList(
  conversationId: string
): Promise<ConversationSuggestionList> {
  const conversation = await prisma.conversationLog.findFirst({
    where: withVisibleConversationWhere({ id: conversationId }),
    select: {
      id: true,
      sessionId: true,
      rawTextOriginal: true,
      reviewedText: true,
      rawTextCleaned: true,
      reviewState: true,
      qualityMetaJson: true,
      properNounSuggestions: {
        select: {
          id: true,
          kind: true,
          rawValue: true,
          suggestedValue: true,
          finalValue: true,
          reason: true,
          confidence: true,
          source: true,
          status: true,
          glossaryEntryId: true,
          spanJson: true,
          sessionPartId: true,
        },
        orderBy: [{ createdAt: "asc" }],
      },
      session: {
        select: {
          parts: {
            select: {
              id: true,
              partType: true,
              properNounSuggestions: {
                select: {
                  id: true,
                  kind: true,
                  rawValue: true,
                  suggestedValue: true,
                  finalValue: true,
                  reason: true,
                  confidence: true,
                  source: true,
                  status: true,
                  glossaryEntryId: true,
                  spanJson: true,
                  sessionPartId: true,
                },
                orderBy: [{ createdAt: "asc" }],
              },
            },
          },
        },
      },
    },
  });
  if (!conversation) {
    throw new Error("conversation not found");
  }

  const partSuggestions =
    conversation.session?.parts.flatMap((part) =>
      selectSuggestionsWithSpan(part.properNounSuggestions).map((suggestion) => ({
        ...suggestion,
        partType: part.partType,
      }))
    ) ?? [];
  const suggestions =
    partSuggestions.length > 0
      ? partSuggestions
      : selectSuggestionsWithSpan(conversation.properNounSuggestions);

  return {
    conversationId: conversation.id,
    rawTextOriginal: normalizeRawTranscriptText(conversation.rawTextOriginal),
    reviewedText: normalizeRawTranscriptText(conversation.reviewedText),
    displayText: pickDisplayTranscriptText({
      rawTextCleaned: conversation.rawTextCleaned,
      reviewedText: conversation.reviewedText,
      rawTextOriginal: conversation.rawTextOriginal,
    }),
    reviewState: conversation.reviewState,
    qualityMetaJson: conversation.qualityMetaJson,
    suggestions,
  };
}
