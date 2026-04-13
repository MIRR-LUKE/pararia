import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { normalizeTranscriptReviewMeta, type TranscriptReviewMeta } from "@/lib/logs/transcript-review-display";
import { sanitizeSummaryMarkdown } from "@/lib/user-facing-japanese";

export type LogListItem = {
  id: string;
  status: string;
  reviewState: string;
  summaryMarkdown: string | null;
  date: string;
  sessionType?: string | null;
  transcriptReview: TranscriptReviewMeta | null;
  student?: { id: string; name: string; grade?: string | null };
};

export type LogListPageData = {
  conversations: LogListItem[];
  counts: {
    all: number;
    interview: number;
    lesson: number;
  };
};

export function getLogListCacheTag(organizationId: string) {
  return `log-list:${organizationId}`;
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
      status: true,
      reviewState: true,
      summaryMarkdown: true,
      qualityMetaJson: true,
      createdAt: true,
      student: { select: { id: true, name: true, grade: true } },
      session: { select: { type: true } },
    },
  });

  const mappedConversations = conversations.map((conversation) => ({
    id: conversation.id,
    status: conversation.status,
    reviewState: conversation.reviewState,
    summaryMarkdown: sanitizeSummaryMarkdown(conversation.summaryMarkdown),
    date: conversation.createdAt.toLocaleDateString("ja-JP"),
    student: conversation.student,
    sessionType: conversation.session?.type ?? null,
    transcriptReview: normalizeTranscriptReviewMeta(conversation.qualityMetaJson),
  }));

  let interviewCount = 0;
  let lessonCount = 0;
  for (const conversation of mappedConversations) {
    if (conversation.sessionType === "LESSON_REPORT") {
      lessonCount += 1;
    } else {
      interviewCount += 1;
    }
  }

  return {
    conversations: mappedConversations,
    counts: {
      all: mappedConversations.length,
      interview: interviewCount,
      lesson: lessonCount,
    },
  };
}

export function getCachedLogListPageData({
  organizationId,
  studentId,
}: {
  organizationId: string;
  studentId?: string | null;
}) {
  const normalizedStudentId = studentId ?? "all";
  return unstable_cache(
    () =>
      getLogListPageData({
        organizationId,
        studentId,
      }),
    ["log-list-page-data", organizationId, normalizedStudentId],
    {
      revalidate: 10,
      tags: [getLogListCacheTag(organizationId)],
    }
  )();
}
