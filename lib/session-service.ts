import {
  ConversationSourceType,
  ConversationStatus,
  Prisma,
  SessionPartStatus,
  SessionPartType,
  SessionStatus,
  SessionType,
} from "@prisma/client";
import { prisma } from "./db";
import type { EntityCandidate } from "./types/session";

type SessionPartLike = {
  id: string;
  partType: SessionPartType;
  status: SessionPartStatus;
  sourceType: ConversationSourceType;
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  rawSegments?: unknown;
};

const PART_LABEL: Record<SessionPartType, string> = {
  FULL: "面談・通し録音",
  CHECK_IN: "授業前チェックイン",
  CHECK_OUT: "授業後チェックアウト",
  TEXT_NOTE: "メモ",
};

export function buildSessionTranscript(parts: SessionPartLike[]) {
  const ordered = [...parts].sort((a, b) => {
    const order = {
      [SessionPartType.CHECK_IN]: 0,
      [SessionPartType.FULL]: 1,
      [SessionPartType.CHECK_OUT]: 2,
      [SessionPartType.TEXT_NOTE]: 3,
    };
    return order[a.partType] - order[b.partType];
  });

  const chunks = ordered
    .map((part) => {
      const body = part.rawTextCleaned?.trim() || part.rawTextOriginal?.trim() || "";
      if (!body) return null;
      return `## ${PART_LABEL[part.partType]}\n${body}`;
    })
    .filter(Boolean);

  return chunks.join("\n\n").trim();
}

export function isSessionReady(sessionType: SessionType, parts: SessionPartLike[]) {
  const readyParts = parts.filter((part) => part.status === SessionPartStatus.READY);
  if (sessionType === SessionType.INTERVIEW) {
    return readyParts.some((part) => Boolean(part.rawTextCleaned?.trim() || part.rawTextOriginal?.trim()));
  }
  const hasCheckIn = readyParts.some((part) => part.partType === SessionPartType.CHECK_IN);
  const hasCheckOut = readyParts.some((part) => part.partType === SessionPartType.CHECK_OUT);
  return hasCheckIn && hasCheckOut;
}

export async function ensureConversationForSession(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      parts: true,
      student: { select: { id: true } },
      user: { select: { id: true } },
      conversation: { select: { id: true } },
    },
  });
  if (!session) throw new Error("session not found");
  if (!isSessionReady(session.type, session.parts)) {
    throw new Error("session is not ready for generation");
  }

  const combinedText = buildSessionTranscript(session.parts);
  if (!combinedText) throw new Error("session transcript is empty");

  const hasAudio = session.parts.some((part) => part.sourceType === ConversationSourceType.AUDIO);
  const sourceType = hasAudio ? ConversationSourceType.AUDIO : ConversationSourceType.MANUAL;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const data: Prisma.ConversationLogUncheckedCreateInput = {
    organizationId: session.organizationId,
    studentId: session.studentId,
    userId: session.userId ?? undefined,
    sessionId: session.id,
    sourceType,
    status: ConversationStatus.PROCESSING,
    rawTextOriginal: combinedText,
    rawTextCleaned: combinedText,
    rawSegments: [],
    rawTextExpiresAt: expiresAt,
  };

  if (session.conversation?.id) {
    const conversation = await prisma.conversationLog.update({
      where: { id: session.conversation.id },
      data: {
        ...data,
        summaryMarkdown: null,
        timelineJson: Prisma.DbNull,
        nextActionsJson: Prisma.DbNull,
        profileDeltaJson: Prisma.DbNull,
        parentPackJson: Prisma.DbNull,
        studentStateJson: Prisma.DbNull,
        topicSuggestionsJson: Prisma.DbNull,
        quickQuestionsJson: Prisma.DbNull,
        profileSectionsJson: Prisma.DbNull,
        observationJson: Prisma.DbNull,
        entityCandidatesJson: Prisma.DbNull,
        lessonReportJson: Prisma.DbNull,
        chunkAnalysisJson: Prisma.DbNull,
        formattedTranscript: null,
        qualityMetaJson: Prisma.DbNull,
      },
      select: { id: true },
    });
    return conversation.id;
  }

  const conversation = await prisma.conversationLog.create({
    data,
    select: { id: true },
  });
  return conversation.id;
}

export async function getEntityDictionary(studentId: string) {
  const entities = await prisma.studentEntity.findMany({
    where: { studentId },
    orderBy: [{ kind: "asc" }, { canonicalName: "asc" }],
  });
  return entities.map((entity) => ({
    kind: entity.kind,
    canonicalName: entity.canonicalName,
    aliases: Array.isArray(entity.aliasesJson) ? (entity.aliasesJson as string[]) : [],
  }));
}

function mapConversationToSessionStatus(status: ConversationStatus): SessionStatus {
  if (status === ConversationStatus.DONE) return SessionStatus.READY;
  if (status === ConversationStatus.ERROR) return SessionStatus.ERROR;
  return SessionStatus.PROCESSING;
}

export async function syncSessionAfterConversation(conversationId: string) {
  const conversation = await prisma.conversationLog.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      sessionId: true,
      studentId: true,
      status: true,
      summaryMarkdown: true,
      studentStateJson: true,
      entityCandidatesJson: true,
    },
  });
  if (!conversation?.sessionId) return;

  const entityCandidates = (Array.isArray(conversation.entityCandidatesJson)
    ? conversation.entityCandidatesJson
    : []) as EntityCandidate[];

  await prisma.sessionEntity.deleteMany({
    where: { sessionId: conversation.sessionId },
  });

  if (entityCandidates.length > 0) {
    await prisma.sessionEntity.createMany({
      data: entityCandidates.map((candidate) => ({
        sessionId: conversation.sessionId!,
        conversationId: conversation.id,
        studentId: conversation.studentId,
        kind: candidate.kind,
        rawValue: candidate.rawValue,
        canonicalValue: candidate.canonicalValue ?? candidate.rawValue,
        confidence: candidate.confidence,
        status: candidate.status,
        sourceJson: candidate.context ? ({ context: candidate.context } as any) : Prisma.DbNull,
      })),
    });
  }

  const pendingEntityCount = await prisma.sessionEntity.count({
    where: { sessionId: conversation.sessionId, status: "PENDING" },
  });

  const studentState = (conversation.studentStateJson ?? {}) as { label?: string; oneLiner?: string };

  await prisma.session.update({
    where: { id: conversation.sessionId },
    data: {
      status: mapConversationToSessionStatus(conversation.status),
      heroStateLabel: studentState.label ?? undefined,
      heroOneLiner: studentState.oneLiner ?? undefined,
      latestSummary: conversation.summaryMarkdown ?? undefined,
      pendingEntityCount,
      completedAt: conversation.status === ConversationStatus.DONE ? new Date() : null,
    },
  });
}

export async function updateSessionStatusFromParts(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { parts: true },
  });
  if (!session) return null;

  const ready = isSessionReady(session.type, session.parts);
  const hasError = session.parts.some((part) => part.status === SessionPartStatus.ERROR);
  const hasReadyPart = session.parts.some((part) => part.status === SessionPartStatus.READY);

  let status: SessionStatus = SessionStatus.DRAFT;
  if (hasError) status = SessionStatus.ERROR;
  else if (ready) status = SessionStatus.PROCESSING;
  else if (hasReadyPart) status = SessionStatus.COLLECTING;

  return prisma.session.update({
    where: { id: sessionId },
    data: { status },
  });
}
