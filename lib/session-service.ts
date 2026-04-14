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
import { toPrismaJson } from "./prisma-json";
import { parseConversationArtifact, renderConversationArtifactOrFallback } from "./conversation-artifact";
import { getTranscriptExpiryDate } from "./system-config";
import { sanitizeTranscriptSegments } from "./user-facing-japanese";
import { normalizeRawTranscriptText, pickEvidenceTranscriptText } from "./transcript/source";

type SessionPartLike = {
  id: string;
  partType: SessionPartType;
  status: SessionPartStatus;
  sourceType: ConversationSourceType;
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  reviewedText?: string | null;
  rawSegments?: unknown;
};

export type SessionTranscriptSegment = {
  start?: number;
  end?: number;
  text: string;
  speaker?: string;
};

const PART_LABEL: Record<SessionPartType, string> = {
  FULL: "面談・通し録音",
  CHECK_IN: "授業前チェックイン",
  CHECK_OUT: "授業後チェックアウト",
  TEXT_NOTE: "補足メモ",
};

function getPartOrder(sessionType: SessionType) {
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

function getReadyPartsForConversation(sessionType: SessionType, parts: SessionPartLike[]) {
  const order = getPartOrder(sessionType);
  return [...parts]
    .filter((part) => part.status === SessionPartStatus.READY)
    // Session readiness and log generation both follow the evidence path: reviewed -> raw.
    .filter((part) => Boolean(pickEvidenceTranscriptText(part)))
    .sort((a, b) => order[a.partType] - order[b.partType]);
}

export function buildSessionEvidenceTranscript(sessionType: SessionType, parts: SessionPartLike[]) {
  const ordered = getReadyPartsForConversation(sessionType, parts);

  const chunks = ordered
    .map((part) => {
      const body = pickEvidenceTranscriptText(part);
      if (!body) return null;
      return `## ${PART_LABEL[part.partType]}\n${body}`;
    })
    .filter((chunk): chunk is string => Boolean(chunk));

  if (chunks.length === 0) return "";
  return chunks.join("\n\n").trim();
}

export const buildSessionTranscript = buildSessionEvidenceTranscript;

function buildSessionRawTranscript(sessionType: SessionType, parts: SessionPartLike[]) {
  const ordered = getReadyPartsForConversation(sessionType, parts);
  const chunks = ordered
    .map((part) => {
      const body = normalizeRawTranscriptText(part.rawTextOriginal);
      if (!body) return null;
      return `## ${PART_LABEL[part.partType]}\n${body}`;
    })
    .filter((chunk): chunk is string => Boolean(chunk));

  if (chunks.length === 0) return "";
  return chunks.join("\n\n").trim();
}

function buildSessionDisplayTranscriptSnapshot(parts: SessionPartLike[]) {
  // This legacy snapshot is only for preview / UI fallback and is not used as evidence.
  return normalizeRawTranscriptText(parts.map((part) => part.rawTextCleaned ?? "").join("\n\n"));
}

function normalizePartSegments(rawSegments: unknown): SessionTranscriptSegment[] {
  if (!Array.isArray(rawSegments)) return [];
  const parsed: Array<SessionTranscriptSegment | null> = sanitizeTranscriptSegments(rawSegments as Array<Record<string, unknown>>)
    .map((segment) => {
      if (!segment || typeof segment !== "object" || Array.isArray(segment)) return null;
      const current = segment as Record<string, unknown>;
      const text = typeof current.text === "string" ? current.text.trim() : "";
      if (!text) return null;
      return {
        start: typeof current.start === "number" && Number.isFinite(current.start) ? current.start : undefined,
        end: typeof current.end === "number" && Number.isFinite(current.end) ? current.end : undefined,
        text,
        speaker: typeof current.speaker === "string" && current.speaker.trim() ? current.speaker.trim() : undefined,
      };
    });
  return parsed.filter((segment): segment is SessionTranscriptSegment => segment !== null);
}

function estimateSegmentDurationSeconds(text: string) {
  const compact = text.replace(/\s+/g, "");
  return Math.min(Math.max(Math.ceil(compact.length / 18), 2), 20);
}

export function buildSessionTranscriptSegments(sessionType: SessionType, parts: SessionPartLike[]) {
  const ordered = getReadyPartsForConversation(sessionType, parts);
  const combined: SessionTranscriptSegment[] = [];
  let cursorSeconds = 0;

  for (const part of ordered) {
    const body = pickEvidenceTranscriptText(part);
    const segments = normalizePartSegments(part.rawSegments);

    if (segments.length > 0) {
      const adjusted = segments.map((segment) => ({
        ...segment,
        start: typeof segment.start === "number" ? segment.start + cursorSeconds : undefined,
        end: typeof segment.end === "number" ? segment.end + cursorSeconds : undefined,
      }));
      combined.push(...adjusted);

      const lastEndSeconds = adjusted.reduce((max, segment) => {
        const end = typeof segment.end === "number" ? segment.end : segment.start;
        return typeof end === "number" && end > max ? end : max;
      }, cursorSeconds);
      cursorSeconds = lastEndSeconds + 2;
      continue;
    }

    if (!body) continue;
    const estimatedDuration = estimateSegmentDurationSeconds(body);
    combined.push({
      start: cursorSeconds,
      end: cursorSeconds + estimatedDuration,
      text: body,
    });
    cursorSeconds += estimatedDuration + 2;
  }

  return combined;
}

export function isSessionReady(sessionType: SessionType, parts: SessionPartLike[]) {
  const readyParts = parts.filter((part) => part.status === SessionPartStatus.READY);
  if (sessionType === SessionType.INTERVIEW) {
    return readyParts.some((part) => Boolean(pickEvidenceTranscriptText(part)));
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

  const combinedRawText = buildSessionRawTranscript(session.type, session.parts);
  if (!combinedRawText) throw new Error("session transcript is empty");
  const combinedReviewedText = buildSessionEvidenceTranscript(session.type, session.parts);
  const combinedSegments = buildSessionTranscriptSegments(session.type, session.parts);

  const readyParts = getReadyPartsForConversation(session.type, session.parts);
  const hasAudio = readyParts.some((part) => part.sourceType === ConversationSourceType.AUDIO);
  const sourceType = hasAudio ? ConversationSourceType.AUDIO : ConversationSourceType.MANUAL;

  const data: Prisma.ConversationLogUncheckedCreateInput = {
    organizationId: session.organizationId,
    studentId: session.studentId,
    userId: session.userId ?? undefined,
    sessionId: session.id,
    sourceType,
    status: ConversationStatus.PROCESSING,
    rawTextOriginal: combinedRawText,
    rawTextCleaned: buildSessionDisplayTranscriptSnapshot(session.parts),
    reviewedText: combinedReviewedText || combinedRawText,
    rawSegments: toPrismaJson(combinedSegments),
    rawTextExpiresAt: getTranscriptExpiryDate(),
  };

  if (session.conversation?.id) {
    const conversation = await prisma.conversationLog.update({
      where: { id: session.conversation.id },
      data: {
        ...data,
        artifactJson: Prisma.DbNull,
        summaryMarkdown: null,
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

function mapConversationToSessionStatus(status: ConversationStatus): SessionStatus {
  if (status === ConversationStatus.DONE) return SessionStatus.READY;
  if (status === ConversationStatus.ERROR) return SessionStatus.ERROR;
  return SessionStatus.PROCESSING;
}

function extractHeroOneLiner(summaryMarkdown?: string | null) {
  const lines = String(summaryMarkdown ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("■ "));
  const line = lines.find((item) => !item.startsWith("- ") && !item.startsWith("対象生徒:")) ?? lines[0] ?? "";
  return line.slice(0, 100) || null;
}

export async function syncSessionAfterConversation(conversationId: string) {
  const conversation = await prisma.conversationLog.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      sessionId: true,
      studentId: true,
      status: true,
      artifactJson: true,
      summaryMarkdown: true,
      session: {
        select: {
          type: true,
        },
      },
    },
  });
  if (!conversation?.sessionId) return;
  const heroStateLabel = conversation.session?.type === SessionType.LESSON_REPORT ? "指導報告ログ" : "面談ログ";
  const renderedSummary = renderConversationArtifactOrFallback(
    conversation.artifactJson,
    conversation.summaryMarkdown
  );
  const parsedArtifact = parseConversationArtifact(conversation.artifactJson);
  const heroOneLiner =
    parsedArtifact?.summary?.[0]?.text.slice(0, 100) || extractHeroOneLiner(renderedSummary);

  await prisma.session.update({
    where: { id: conversation.sessionId },
    data: {
      status: mapConversationToSessionStatus(conversation.status),
      heroStateLabel,
      heroOneLiner,
      latestSummary: renderedSummary || null,
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
