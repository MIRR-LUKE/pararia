import {
  ProperNounSuggestionStatus,
  SessionPartStatus,
  SessionType,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import { loadInternalGlossaryCandidates, listProviderHintTerms } from "@/lib/transcript/glossary";
import { assessConversationReview, assessSessionPartReview, buildReviewMetaPatch } from "@/lib/transcript/review-assessment";
import { buildConversationSuggestionList } from "@/lib/transcript/review-list";
import {
  attachConversationIdToPartSuggestions,
  findConversationIdBySessionPart,
  loadConversationStoredSuggestions,
  loadSessionPartStoredSuggestions,
  persistConversationReview,
  persistSessionPartReview,
  syncConversationSuggestionDrafts,
  syncSessionPartSuggestionDrafts,
} from "@/lib/transcript/review-persistence";
import { applySuggestionsToText, selectSuggestionsWithSpan } from "@/lib/transcript/reviewed-text";
import {
  type ConversationReviewSummary,
  type ConversationSuggestionList,
  type SessionPartReviewSummary,
} from "@/lib/transcript/review-types";
import { buildSuggestionDrafts, mergeDraftsWithStored } from "@/lib/transcript/suggestion";
import { combineSessionTranscript } from "@/lib/transcript/review-composition";
import { normalizeRawTranscriptText } from "@/lib/transcript/source";

async function rebuildSessionPartFromStoredSuggestions(sessionPartId: string) {
  const part = await prisma.sessionPart.findUnique({
    where: { id: sessionPartId },
    select: {
      id: true,
      rawTextOriginal: true,
      qualityMetaJson: true,
    },
  });
  if (!part) throw new Error("session part not found");

  const rawTextOriginal = normalizeRawTranscriptText(part.rawTextOriginal);
  const storedSuggestions = await loadSessionPartStoredSuggestions(part.id);
  const reviewedText = applySuggestionsToText(rawTextOriginal, selectSuggestionsWithSpan(storedSuggestions));
  const review = assessSessionPartReview({
    rawTextOriginal,
    suggestions: storedSuggestions,
    qualityMetaJson: part.qualityMetaJson,
  });

  await persistSessionPartReview({
    sessionPartId: part.id,
    qualityMetaJson: part.qualityMetaJson,
    reviewedText,
    review,
    qualityMetaPatch: buildReviewMetaPatch(review),
  });

  return {
    ...review,
    reviewedText,
  };
}

async function syncDirectConversationSuggestions(input: {
  conversationId: string;
  organizationId: string;
  studentId: string;
  rawTextOriginal: string;
  studentName?: string | null;
  studentNameKana?: string | null;
  teacherId?: string | null;
  teacherName?: string | null;
  qualityMetaJson?: unknown;
}) {
  const existingSuggestions = await loadConversationStoredSuggestions(input.conversationId);
  const glossaryCandidates = await loadInternalGlossaryCandidates({
    organizationId: input.organizationId,
    studentId: input.studentId,
    tutorUserId: input.teacherId ?? null,
    studentName: input.studentName,
    studentNameKana: input.studentNameKana,
    teacherName: input.teacherName,
  });
  const drafts = buildSuggestionDrafts(input.rawTextOriginal, glossaryCandidates);
  const mergedDrafts = mergeDraftsWithStored(drafts, existingSuggestions);

  await syncConversationSuggestionDrafts({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    studentId: input.studentId,
    drafts: mergedDrafts,
    existing: existingSuggestions,
  });

  const storedSuggestions = await loadConversationStoredSuggestions(input.conversationId);
  const reviewedText = applySuggestionsToText(input.rawTextOriginal, selectSuggestionsWithSpan(storedSuggestions));
  const review = assessConversationReview({
    rawTextOriginal: input.rawTextOriginal,
    suggestions: storedSuggestions,
    qualityMetaJson: input.qualityMetaJson,
  });

  await persistConversationReview({
    conversationId: input.conversationId,
    rawTextOriginal: input.rawTextOriginal,
    qualityMetaJson: input.qualityMetaJson,
    reviewedText,
    review,
    qualityMetaPatch: buildReviewMetaPatch(review),
  });

  return {
    ...review,
    reviewedText,
    rawTextOriginal: input.rawTextOriginal,
  };
}

export async function ensureSessionPartReviewedTranscript(sessionPartId: string): Promise<SessionPartReviewSummary> {
  const part = await prisma.sessionPart.findUnique({
    where: { id: sessionPartId },
    include: {
      session: {
        select: {
          id: true,
          organizationId: true,
          studentId: true,
          student: {
            select: {
              name: true,
              nameKana: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
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
        },
      },
    },
  });
  if (!part?.session) {
    throw new Error("session part not found");
  }

  const rawTextOriginal = normalizeRawTranscriptText(part.rawTextOriginal);
  if (!rawTextOriginal) {
    const review = assessSessionPartReview({
      rawTextOriginal,
      suggestions: [],
      qualityMetaJson: part.qualityMetaJson,
    });
    await persistSessionPartReview({
      sessionPartId: part.id,
      qualityMetaJson: part.qualityMetaJson,
      reviewedText: "",
      review,
      qualityMetaPatch: buildReviewMetaPatch(review),
    });
    return {
      ...review,
      reviewedText: "",
    };
  }

  const glossaryCandidates = await loadInternalGlossaryCandidates({
    organizationId: part.session.organizationId,
    studentId: part.session.studentId,
    tutorUserId: part.session.user?.id ?? null,
    studentName: part.session.student.name,
    studentNameKana: part.session.student.nameKana,
    teacherName: part.session.user?.name,
  });
  const drafts = buildSuggestionDrafts(rawTextOriginal, glossaryCandidates);
  const mergedDrafts = mergeDraftsWithStored(drafts, part.properNounSuggestions);

  await syncSessionPartSuggestionDrafts({
    sessionPartId: part.id,
    organizationId: part.session.organizationId,
    studentId: part.session.studentId,
    sessionId: part.session.id,
    drafts: mergedDrafts,
    existing: part.properNounSuggestions,
  });

  return rebuildSessionPartFromStoredSuggestions(part.id);
}

export async function ensureConversationReviewedTranscript(conversationId: string): Promise<ConversationReviewSummary> {
  const conversation = await prisma.conversationLog.findFirst({
    where: withVisibleConversationWhere({ id: conversationId }),
    include: {
      student: {
        select: {
          id: true,
          name: true,
          nameKana: true,
        },
      },
      user: {
        select: {
          id: true,
          name: true,
        },
      },
      session: {
        include: {
          parts: {
            select: {
              id: true,
              partType: true,
              status: true,
              rawTextOriginal: true,
              reviewedText: true,
              reviewState: true,
            },
          },
        },
      },
    },
  });
  if (!conversation) {
    throw new Error("conversation not found");
  }

  if (!conversation.session) {
    return syncDirectConversationSuggestions({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      studentId: conversation.studentId,
      rawTextOriginal: normalizeRawTranscriptText(conversation.rawTextOriginal),
      studentName: conversation.student?.name,
      studentNameKana: conversation.student?.nameKana,
      teacherId: conversation.user?.id,
      teacherName: conversation.user?.name,
      qualityMetaJson: conversation.qualityMetaJson,
    });
  }

  const readyPartIds = conversation.session.parts
    .filter((part) => part.status === SessionPartStatus.READY)
    .map((part) => part.id);

  const refreshedSession = await prisma.session.findUnique({
    where: { id: conversation.session.id },
    include: {
      parts: {
        select: {
          id: true,
          partType: true,
          status: true,
          rawTextOriginal: true,
          reviewedText: true,
          properNounSuggestions: {
            select: {
              id: true,
              status: true,
              rawValue: true,
              suggestedValue: true,
              finalValue: true,
              spanJson: true,
            },
          },
        },
      },
    },
  });
  if (!refreshedSession) {
    throw new Error("session not found");
  }

  const rawTextOriginal = combineSessionTranscript(refreshedSession.type, refreshedSession.parts, "raw");
  const reviewedText = combineSessionTranscript(refreshedSession.type, refreshedSession.parts, "reviewed");
  const suggestions = refreshedSession.parts.flatMap((part) => part.properNounSuggestions);
  const review = assessConversationReview({
    sessionType: refreshedSession.type,
    rawTextOriginal,
    suggestions,
    qualityMetaJson: conversation.qualityMetaJson,
  });

  await attachConversationIdToPartSuggestions(readyPartIds, conversation.id);
  await persistConversationReview({
    conversationId: conversation.id,
    existingRawTextOriginal: conversation.rawTextOriginal,
    rawTextOriginal,
    qualityMetaJson: conversation.qualityMetaJson,
    reviewedText,
    review,
    qualityMetaPatch: buildReviewMetaPatch(review),
  });

  return {
    ...review,
    reviewedText,
    rawTextOriginal,
  };
}

export async function updateProperNounSuggestionDecision(input: {
  suggestionId: string;
  status: ProperNounSuggestionStatus;
  finalValue?: string | null;
}) {
  const suggestion = await prisma.properNounSuggestion.findUnique({
    where: { id: input.suggestionId },
    select: {
      id: true,
      sessionPartId: true,
      conversationId: true,
    },
  });
  if (!suggestion) {
    throw new Error("proper noun suggestion not found");
  }

  await prisma.properNounSuggestion.update({
    where: { id: suggestion.id },
    data: {
      status: input.status,
      finalValue:
        input.status === ProperNounSuggestionStatus.MANUALLY_EDITED
          ? normalizeRawTranscriptText(input.finalValue ?? "")
          : input.status === ProperNounSuggestionStatus.CONFIRMED
            ? normalizeRawTranscriptText(input.finalValue ?? "")
            : null,
    },
  });

  if (suggestion.sessionPartId) {
    await rebuildSessionPartFromStoredSuggestions(suggestion.sessionPartId);
  }
  if (suggestion.conversationId) {
    await ensureConversationReviewedTranscript(suggestion.conversationId);
    return;
  }
  if (suggestion.sessionPartId) {
    const linkedConversationId = await findConversationIdBySessionPart(suggestion.sessionPartId);
    if (linkedConversationId) {
      await ensureConversationReviewedTranscript(linkedConversationId);
    }
  }
}

export async function listConversationProperNounSuggestions(
  conversationId: string
): Promise<ConversationSuggestionList> {
  return buildConversationSuggestionList(conversationId);
}

export { listProviderHintTerms };
