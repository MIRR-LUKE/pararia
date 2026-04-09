import { prisma } from "@/lib/db";
import { renderConversationArtifactOrFallback } from "@/lib/conversation-artifact";
import { deriveReportDeliveryState, reportDeliveryStateLabel } from "@/lib/report-delivery";
import { sanitizeSummaryMarkdown } from "@/lib/user-facing-japanese";

export type LogListItem = {
  id: string;
  studentId: string;
  sessionId: string | null;
  status: string;
  summaryMarkdown: string | null;
  createdAt: string;
  date: string;
  sessionType?: string | null;
  student?: { id: string; name: string; grade?: string | null };
};

export type LogTraceRow = {
  studentId: string;
  studentName: string;
  reportId: string;
  reportLabel: string;
  sourceCount: number;
};

export type LogListPageData = {
  conversations: LogListItem[];
  traceByLogId: Record<string, LogTraceRow[]>;
  counts: {
    all: number;
    interview: number;
    lesson: number;
  };
};

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

export async function getLogListPageData({
  organizationId,
  studentId,
}: {
  organizationId: string;
  studentId?: string | null;
}): Promise<LogListPageData> {
  const conversations = await prisma.conversationLog.findMany({
    where: {
      organizationId,
      ...(studentId ? { studentId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: studentId ? 100 : 80,
    select: {
      id: true,
      studentId: true,
      sessionId: true,
      status: true,
      artifactJson: true,
      summaryMarkdown: true,
      createdAt: true,
      student: { select: { id: true, name: true, grade: true } },
      session: { select: { type: true } },
    },
  });

  const mappedConversations = conversations.map((conversation) => ({
    id: conversation.id,
    studentId: conversation.studentId,
    sessionId: conversation.sessionId,
    status: conversation.status,
    summaryMarkdown: sanitizeSummaryMarkdown(
      renderConversationArtifactOrFallback(conversation.artifactJson, conversation.summaryMarkdown)
    ),
    createdAt: conversation.createdAt.toISOString(),
    date: conversation.createdAt.toLocaleDateString("ja-JP"),
    student: conversation.student,
    sessionType: conversation.session?.type ?? null,
  }));

  const visibleLogIds = new Set(mappedConversations.map((conversation) => conversation.id));
  const visibleStudentIds = [...new Set(mappedConversations.map((conversation) => conversation.studentId))];
  const oldestConversationDate = conversations.at(-1)?.createdAt;
  const traceByLogId = new Map<string, LogTraceRow[]>();

  if (visibleLogIds.size > 0 && visibleStudentIds.length > 0) {
    const reports = await prisma.report.findMany({
      where: {
        organizationId,
        studentId: { in: visibleStudentIds },
        ...(oldestConversationDate ? { createdAt: { gte: oldestConversationDate } } : {}),
      },
      select: {
        id: true,
        status: true,
        deliveryChannel: true,
        sourceLogIds: true,
        student: {
          select: {
            id: true,
            name: true,
          },
        },
        deliveryEvents: {
          orderBy: { createdAt: "asc" },
          select: {
            eventType: true,
            createdAt: true,
            deliveryChannel: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    for (const report of reports) {
      const sourceLogIds = toStringArray(report.sourceLogIds);
      const matchingLogIds = sourceLogIds.filter((logId) => visibleLogIds.has(logId));
      if (matchingLogIds.length === 0) continue;

      const reportLabel = reportDeliveryStateLabel(deriveReportDeliveryState(report));
      for (const logId of matchingLogIds) {
        const current = traceByLogId.get(logId) ?? [];
        current.push({
          studentId: report.student.id,
          studentName: report.student.name,
          reportId: report.id,
          reportLabel,
          sourceCount: sourceLogIds.length,
        });
        traceByLogId.set(logId, current);
      }
    }
  }

  return {
    conversations: mappedConversations,
    traceByLogId: Object.fromEntries(traceByLogId),
    counts: {
      all: mappedConversations.length,
      interview: mappedConversations.filter((item) => item.sessionType !== "LESSON_REPORT").length,
      lesson: mappedConversations.filter((item) => item.sessionType === "LESSON_REPORT").length,
    },
  };
}
