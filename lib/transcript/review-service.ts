import {
  ProperNounSuggestionStatus,
  SessionPartStatus,
  SessionPartType,
  SessionType,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { toPrismaJson } from "@/lib/prisma-json";
import { loadInternalGlossaryCandidates, listProviderHintTerms } from "@/lib/transcript/glossary";
import { assessConversationReview, assessSessionPartReview, buildReviewMetaPatch } from "@/lib/transcript/review-assessment";
import { applySuggestionsToText } from "@/lib/transcript/reviewed-text";
import {
  type ConversationReviewSummary,
  type ConversationSuggestionList,
  type SessionPartReviewSummary,
  type StoredSuggestion,
  type SuggestionSpan,
} from "@/lib/transcript/review-types";
import { buildSuggestionDrafts, mergeDraftsWithStored, parseSpan } from "@/lib/transcript/suggestion";
import {
  normalizeRawTranscriptText,
  pickDisplayTranscriptText,
  pickEvidenceTranscriptText,
} from "@/lib/transcript/source";

function orderForSessionType(sessionType: SessionType) {
  if (sessionType === SessionType.LESSON_REPORT) {
    return {
      [SessionPartType.CHECK_IN]: 0,
      [SessionPartType.FULL]: 1,
      [SessionPartType.CHECK_OUT]: 2,
      [SessionPartType.TEXT_NOTE]: 3,
    } as const;
  }
  return {
    [SessionPartType.FULL]: 0,
    [SessionPartType.CHECK_IN]: 1,
    [SessionPartType.CHECK_OUT]: 2,
    [SessionPartType.TEXT_NOTE]: 3,
  } as const;
}

function combineSessionTranscript(
  sessionType: SessionType,
  parts: Array<{
    partType: SessionPartType;
    status: SessionPartStatus;
    rawTextOriginal?: string | null;
    reviewedText?: string | null;
  }>,
  kind: "raw" | "reviewed"
) {
  const order = orderForSessionType(sessionType);
  const labelMap: Record<SessionPartType, string> = {
    FULL: "面談・通し録音",
    CHECK_IN: "授業前チェックイン",
    CHECK_OUT: "授業後チェックアウト",
    TEXT_NOTE: "補足メモ",
  };

  return [...parts]
    .filter((part) => part.status === SessionPartStatus.READY)
    .sort((left, right) => order[left.partType] - order[right.partType])
    .map((part) => {
      const body =
        kind === "reviewed"
          ? pickEvidenceTranscriptText({
              reviewedText: part.reviewedText,
              rawTextOriginal: part.rawTextOriginal,
            })
          : normalizeRawTranscriptText(part.rawTextOriginal);
      if (!body) return null;
      return `## ${labelMap[part.partType]}\n${body}`;
    })
    .filter((chunk): chunk is string => Boolean(chunk))
    .join("\n\n")
    .trim();
}

async function syncSuggestionsForSessionPart(input: {
  sessionPartId: string;
  organizationId: string;
  studentId: string;
  sessionId: string;
  drafts: ReturnType<typeof mergeDraftsWithStored>;
  existing: StoredSuggestion[];
}) {
  const keepIds: string[] = [];
  const existingById = new Map(input.existing.map((item) => [item.id, item]));

  for (const draft of input.drafts) {
    const payload = {
      organizationId: input.organizationId,
      studentId: input.studentId,
      sessionId: input.sessionId,
      sessionPartId: input.sessionPartId,
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

  const staleIds = input.existing.map((item) => item.id).filter((id) => !keepIds.includes(id));
  if (staleIds.length > 0) {
    await prisma.properNounSuggestion.deleteMany({
      where: { id: { in: staleIds } },
    });
  }
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
  existingSuggestions: StoredSuggestion[];
}) {
  const glossaryCandidates = await loadInternalGlossaryCandidates({
    organizationId: input.organizationId,
    studentId: input.studentId,
    tutorUserId: input.teacherId ?? null,
    studentName: input.studentName,
    studentNameKana: input.studentNameKana,
    teacherName: input.teacherName,
  });
  const drafts = buildSuggestionDrafts(input.rawTextOriginal, glossaryCandidates);
  const merged = mergeDraftsWithStored(drafts, input.existingSuggestions);

  const keepIds: string[] = [];
  const existingById = new Map(input.existingSuggestions.map((item) => [item.id, item]));
  for (const draft of merged) {
    const payload = {
      organizationId: input.organizationId,
      studentId: input.studentId,
      conversationId: input.conversationId,
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

  const staleIds = input.existingSuggestions.map((item) => item.id).filter((id) => !keepIds.includes(id));
  if (staleIds.length > 0) {
    await prisma.properNounSuggestion.deleteMany({
      where: { id: { in: staleIds } },
    });
  }

  const suggestions = await prisma.properNounSuggestion.findMany({
    where: { conversationId: input.conversationId, sessionPartId: null },
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

  const applicable = suggestions
    .map((suggestion) => ({
      ...suggestion,
      span: parseSpan(suggestion.spanJson),
    }))
    .filter((suggestion): suggestion is typeof suggestion & { span: SuggestionSpan } => Boolean(suggestion.span));
  const reviewedText = applySuggestionsToText(input.rawTextOriginal, applicable);
  const review = assessConversationReview({
    rawTextOriginal: input.rawTextOriginal,
    suggestions,
    qualityMetaJson: input.qualityMetaJson,
  });

  await prisma.conversationLog.update({
    where: { id: input.conversationId },
    data: {
      reviewedText: normalizeRawTranscriptText(reviewedText) || null,
      reviewState: review.reviewState,
      qualityMetaJson: toPrismaJson({
        ...(input.qualityMetaJson as Record<string, unknown> | null),
        ...buildReviewMetaPatch(review),
      }),
    },
  });

  return {
    ...review,
    reviewedText,
    rawTextOriginal: input.rawTextOriginal,
  };
}

async function syncReviewedTextFromStoredSuggestionsForPart(sessionPartId: string) {
  const part = await prisma.sessionPart.findUnique({
    where: { id: sessionPartId },
    select: {
      id: true,
      rawTextOriginal: true,
      qualityMetaJson: true,
      properNounSuggestions: {
        select: {
          id: true,
          rawValue: true,
          suggestedValue: true,
          finalValue: true,
          status: true,
          spanJson: true,
        },
      },
    },
  });
  if (!part) throw new Error("session part not found");

  const rawTextOriginal = normalizeRawTranscriptText(part.rawTextOriginal);
  const applicable = part.properNounSuggestions
    .map((suggestion) => ({
      ...suggestion,
      span: parseSpan(suggestion.spanJson),
    }))
    .filter((suggestion): suggestion is typeof suggestion & { span: SuggestionSpan } => Boolean(suggestion.span));
  const reviewedText = applySuggestionsToText(rawTextOriginal, applicable);
  const review = assessSessionPartReview({
    rawTextOriginal,
    suggestions: part.properNounSuggestions,
    qualityMetaJson: part.qualityMetaJson,
  });

  await prisma.sessionPart.update({
    where: { id: part.id },
    data: {
      reviewedText: normalizeRawTranscriptText(reviewedText) || null,
      reviewState: review.reviewState,
      qualityMetaJson: toPrismaJson({
        ...(part.qualityMetaJson as Record<string, unknown> | null),
        ...buildReviewMetaPatch(review),
      }),
    },
  });

  return review;
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
    const empty = assessSessionPartReview({
      rawTextOriginal,
      suggestions: [],
      qualityMetaJson: part.qualityMetaJson,
    });
    await prisma.sessionPart.update({
      where: { id: part.id },
      data: {
        reviewedText: null,
        reviewState: empty.reviewState,
        qualityMetaJson: toPrismaJson({
          ...(part.qualityMetaJson as Record<string, unknown> | null),
          ...buildReviewMetaPatch(empty),
        }),
      },
    });
    return {
      ...empty,
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
  const merged = mergeDraftsWithStored(drafts, part.properNounSuggestions as StoredSuggestion[]);

  await syncSuggestionsForSessionPart({
    sessionPartId: part.id,
    organizationId: part.session.organizationId,
    studentId: part.session.studentId,
    sessionId: part.session.id,
    drafts: merged,
    existing: part.properNounSuggestions as StoredSuggestion[],
  });

  const storedSuggestions = await prisma.properNounSuggestion.findMany({
    where: { sessionPartId: part.id },
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

  const applicable = storedSuggestions
    .map((suggestion) => ({
      ...suggestion,
      span: parseSpan(suggestion.spanJson),
    }))
    .filter((suggestion): suggestion is typeof suggestion & { span: SuggestionSpan } => Boolean(suggestion.span));

  const reviewedText = applySuggestionsToText(rawTextOriginal, applicable);
  const review = assessSessionPartReview({
    rawTextOriginal,
    suggestions: storedSuggestions,
    qualityMetaJson: part.qualityMetaJson,
  });

  await prisma.sessionPart.update({
    where: { id: part.id },
    data: {
      reviewedText: normalizeRawTranscriptText(reviewedText) || null,
      reviewState: review.reviewState,
      qualityMetaJson: toPrismaJson({
        ...(part.qualityMetaJson as Record<string, unknown> | null),
        ...buildReviewMetaPatch(review),
      }),
    },
  });

  return {
    ...review,
    reviewedText,
  };
}

export async function ensureConversationReviewedTranscript(conversationId: string): Promise<ConversationReviewSummary> {
  const conversation = await prisma.conversationLog.findUnique({
    where: { id: conversationId },
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
      },
    },
  });
  if (!conversation) {
    throw new Error("conversation not found");
  }

  if (conversation.session) {
    const readyPartIds = conversation.session.parts
      .filter((part) => part.status === SessionPartStatus.READY)
      .map((part) => part.id);
    for (const partId of readyPartIds) {
      await ensureSessionPartReviewedTranscript(partId);
    }

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
            reviewState: true,
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

    if (readyPartIds.length > 0) {
      await prisma.properNounSuggestion.updateMany({
        where: {
          sessionPartId: { in: readyPartIds },
        },
        data: {
          conversationId: conversation.id,
        },
      });
    }

    await prisma.conversationLog.update({
      where: { id: conversation.id },
      data: {
        rawTextOriginal: rawTextOriginal || conversation.rawTextOriginal,
        reviewedText: normalizeRawTranscriptText(reviewedText) || null,
        reviewState: review.reviewState,
        qualityMetaJson: toPrismaJson({
          ...(conversation.qualityMetaJson as Record<string, unknown> | null),
          ...buildReviewMetaPatch(review),
        }),
      },
    });

    return {
      ...review,
      reviewedText,
      rawTextOriginal,
    };
  }

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
    existingSuggestions: (conversation.properNounSuggestions as StoredSuggestion[]).filter((item) => !item.sessionPartId),
  });
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
    await syncReviewedTextFromStoredSuggestionsForPart(suggestion.sessionPartId);
  }
  if (suggestion.conversationId) {
    await ensureConversationReviewedTranscript(suggestion.conversationId);
  } else if (suggestion.sessionPartId) {
    const linkedConversation = await prisma.conversationLog.findFirst({
      where: {
        session: {
          parts: {
            some: {
              id: suggestion.sessionPartId,
            },
          },
        },
      },
      select: { id: true },
    });
    if (linkedConversation?.id) {
      await ensureConversationReviewedTranscript(linkedConversation.id);
    }
  }
}

export async function listConversationProperNounSuggestions(conversationId: string): Promise<ConversationSuggestionList> {
  const conversation = await prisma.conversationLog.findUnique({
    where: { id: conversationId },
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
      part.properNounSuggestions.map((suggestion) => ({
        ...suggestion,
        partType: part.partType,
      }))
    ) ?? [];
  const suggestions = partSuggestions.length > 0 ? partSuggestions : conversation.properNounSuggestions;

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
    suggestions: suggestions.map((suggestion) => ({
      ...suggestion,
      span: parseSpan(suggestion.spanJson),
    })),
  };
}

export { listProviderHintTerms };
