import { prisma } from "@/lib/db";
import { toPrismaJson } from "@/lib/prisma-json";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import type {
  ReviewAssessment,
  StoredSuggestion,
  SuggestionDraftWithState,
} from "@/lib/transcript/review-types";
import { normalizeRawTranscriptText } from "@/lib/transcript/source";

function buildSuggestionPayload(
  scope:
    | {
        organizationId: string;
        studentId: string;
        sessionId: string;
        sessionPartId: string;
        conversationId?: never;
      }
    | {
        organizationId: string;
        studentId: string;
        conversationId: string;
        sessionId?: never;
        sessionPartId?: never;
      },
  draft: SuggestionDraftWithState
) {
  return {
    organizationId: scope.organizationId,
    studentId: scope.studentId,
    sessionId: "sessionId" in scope ? scope.sessionId : undefined,
    sessionPartId: "sessionPartId" in scope ? scope.sessionPartId : undefined,
    conversationId: "conversationId" in scope ? scope.conversationId : undefined,
    kind: draft.kind,
    rawValue: draft.rawValue,
    suggestedValue: draft.suggestedValue,
    finalValue: draft.finalValue ?? null,
    reason: draft.reason,
    confidence: draft.confidence,
    source: draft.source,
    status: draft.status,
    spanJson: toPrismaJson(draft.span),
    glossaryEntryId: draft.glossaryEntryId ?? null,
  };
}

async function syncSuggestionDrafts(
  drafts: SuggestionDraftWithState[],
  existing: StoredSuggestion[],
  scope:
    | {
        organizationId: string;
        studentId: string;
        sessionId: string;
        sessionPartId: string;
        conversationId?: never;
      }
    | {
        organizationId: string;
        studentId: string;
        conversationId: string;
        sessionId?: never;
        sessionPartId?: never;
      }
) {
  const keepIds: string[] = [];
  const existingById = new Map(existing.map((item) => [item.id, item]));

  for (const draft of drafts) {
    const payload = buildSuggestionPayload(scope, draft);

    if (draft.id && existingById.has(draft.id)) {
      keepIds.push(draft.id);
      await prisma.properNounSuggestion.update({
        where: { id: draft.id },
        data: payload,
      });
      continue;
    }

    const created = await prisma.properNounSuggestion.create({
      data: payload,
      select: { id: true },
    });
    keepIds.push(created.id);
  }

  const staleIds = existing.map((item) => item.id).filter((id) => !keepIds.includes(id));
  if (staleIds.length > 0) {
    await prisma.properNounSuggestion.deleteMany({
      where: { id: { in: staleIds } },
    });
  }
}

export async function syncSessionPartSuggestionDrafts(input: {
  sessionPartId: string;
  organizationId: string;
  studentId: string;
  sessionId: string;
  drafts: SuggestionDraftWithState[];
  existing: StoredSuggestion[];
}) {
  return syncSuggestionDrafts(input.drafts, input.existing, {
    organizationId: input.organizationId,
    studentId: input.studentId,
    sessionId: input.sessionId,
    sessionPartId: input.sessionPartId,
  });
}

export async function syncConversationSuggestionDrafts(input: {
  conversationId: string;
  organizationId: string;
  studentId: string;
  drafts: SuggestionDraftWithState[];
  existing: StoredSuggestion[];
}) {
  return syncSuggestionDrafts(input.drafts, input.existing, {
    organizationId: input.organizationId,
    studentId: input.studentId,
    conversationId: input.conversationId,
  });
}

export async function loadSessionPartStoredSuggestions(sessionPartId: string) {
  return prisma.properNounSuggestion.findMany({
    where: { sessionPartId },
    select: {
      id: true,
      rawValue: true,
      suggestedValue: true,
      finalValue: true,
      status: true,
      spanJson: true,
      kind: true,
      reason: true,
      confidence: true,
      source: true,
      glossaryEntryId: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });
}

export async function loadConversationStoredSuggestions(conversationId: string) {
  return prisma.properNounSuggestion.findMany({
    where: { conversationId, sessionPartId: null },
    select: {
      id: true,
      rawValue: true,
      suggestedValue: true,
      finalValue: true,
      status: true,
      spanJson: true,
      kind: true,
      reason: true,
      confidence: true,
      source: true,
      glossaryEntryId: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });
}

export async function persistSessionPartReview(input: {
  sessionPartId: string;
  qualityMetaJson?: unknown;
  reviewedText: string;
  review: ReviewAssessment;
  qualityMetaPatch: Record<string, unknown>;
}) {
  await prisma.sessionPart.update({
    where: { id: input.sessionPartId },
    data: {
      reviewedText: normalizeRawTranscriptText(input.reviewedText) || null,
      reviewState: input.review.reviewState,
      qualityMetaJson: toPrismaJson({
        ...(input.qualityMetaJson as Record<string, unknown> | null),
        ...input.qualityMetaPatch,
      }),
    },
  });
}

export async function persistConversationReview(input: {
  conversationId: string;
  rawTextOriginal?: string | null;
  existingRawTextOriginal?: string | null;
  qualityMetaJson?: unknown;
  reviewedText: string;
  review: ReviewAssessment;
  qualityMetaPatch: Record<string, unknown>;
}) {
  await prisma.conversationLog.update({
    where: { id: input.conversationId },
    data: {
      rawTextOriginal: input.rawTextOriginal || input.existingRawTextOriginal,
      reviewedText: normalizeRawTranscriptText(input.reviewedText) || null,
      reviewState: input.review.reviewState,
      qualityMetaJson: toPrismaJson({
        ...(input.qualityMetaJson as Record<string, unknown> | null),
        ...input.qualityMetaPatch,
      }),
    },
  });
}

export async function attachConversationIdToPartSuggestions(sessionPartIds: string[], conversationId: string) {
  if (sessionPartIds.length === 0) return;
  await prisma.properNounSuggestion.updateMany({
    where: {
      sessionPartId: { in: sessionPartIds },
    },
    data: {
      conversationId,
    },
  });
}

export async function findConversationIdBySessionPart(sessionPartId: string) {
  const linkedConversation = await prisma.conversationLog.findFirst({
    where: withVisibleConversationWhere({
      session: {
        parts: {
          some: {
            id: sessionPartId,
          },
        },
      },
    }),
    select: { id: true },
  });
  return linkedConversation?.id ?? null;
}
