import { Prisma, SessionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";
import type { ConversationQualityMeta } from "@/lib/types/conversation";
import { deriveSessionDurationMinutes } from "./shared";
import type { ConversationPayload } from "./types";

type LoadedConversation = {
  id: string;
  organizationId: string;
  studentId: string;
  sessionId: string | null;
  rawTextOriginal: string | null;
  rawTextCleaned: string | null;
  reviewedText: string | null;
  rawSegments: unknown;
  formattedTranscript: string | null;
  summaryMarkdown: string | null;
  artifactJson: Prisma.JsonValue | null;
  qualityMetaJson: Prisma.JsonValue | null;
  student: { id: string; name: string | null } | null;
  user: { name: string | null } | null;
  session: {
    id: string;
    type: SessionType;
    sessionDate: Date | null;
    parts: Array<{ qualityMetaJson: unknown }>;
  } | null;
};

export function buildConversationPayload(convo: LoadedConversation): ConversationPayload {
  return {
    id: convo.id,
    organizationId: convo.organizationId,
    studentId: convo.studentId,
    sessionId: convo.sessionId,
    sessionType: convo.session?.type ?? null,
    sessionDate: convo.session?.sessionDate ?? null,
    rawTextOriginal: convo.rawTextOriginal,
    rawTextCleaned: convo.rawTextCleaned,
    reviewedText: convo.reviewedText,
    rawSegments: (convo.rawSegments as any[]) ?? [],
    formattedTranscript: convo.formattedTranscript,
    summaryMarkdown: convo.summaryMarkdown,
    artifactJson: (convo.artifactJson as Prisma.JsonValue | null) ?? null,
    studentName: convo.student?.name ?? null,
    teacherName: convo.user?.name ?? DEFAULT_TEACHER_FULL_NAME,
    durationMinutes: deriveSessionDurationMinutes(convo.session?.parts),
    qualityMetaJson: (convo.qualityMetaJson as ConversationQualityMeta) ?? null,
  } satisfies ConversationPayload;
}

export async function loadConversationPayload(conversationId: string) {
  const convo = await prisma.conversationLog.findFirst({
    where: withVisibleConversationWhere({ id: conversationId }),
    include: {
      student: { select: { id: true, name: true } },
      user: { select: { name: true } },
      session: { select: { id: true, type: true, sessionDate: true, parts: { select: { qualityMetaJson: true } } } },
    },
  });
  if (!convo) throw new Error("conversation not found");
  return buildConversationPayload(convo as LoadedConversation);
}
