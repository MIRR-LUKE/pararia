import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { prisma } from "@/lib/db";
import { normalizeTranscriptReviewMeta } from "@/lib/logs/transcript-review-display";
import { getAppSession } from "@/lib/server/app-session";
import { listConversationProperNounSuggestions } from "@/lib/transcript/review";
import TranscriptReviewPage from "./TranscriptReviewPage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LogReviewPage({ params }: { params: Promise<{ logId: string }> }) {
  const { logId } = await params;
  const session = await getAppSession();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const conversation = await prisma.conversationLog.findFirst({
    where: {
      id: logId,
      organizationId,
    },
    select: {
      id: true,
      status: true,
      reviewState: true,
      summaryMarkdown: true,
      formattedTranscript: true,
      rawTextOriginal: true,
      rawTextCleaned: true,
      reviewedText: true,
      qualityMetaJson: true,
      student: {
        select: {
          id: true,
          name: true,
          grade: true,
        },
      },
      session: {
        select: {
          type: true,
          status: true,
          sessionDate: true,
        },
      },
    },
  });

  if (!conversation) {
    notFound();
  }

  const transcriptReview = normalizeTranscriptReviewMeta(conversation.qualityMetaJson);
  const review = await listConversationProperNounSuggestions(logId);

  return (
    <div>
      <AppHeader
        title="文字起こしレビュー"
        subtitle="固有名詞候補をここで見て、採用・却下・手修正までまとめて進められます。"
        viewerName={session.user.name ?? null}
        viewerRole={(session.user as { role?: string | null }).role ?? null}
      />
      <TranscriptReviewPage
        logId={logId}
        initialConversation={{
          ...conversation,
          session: conversation.session
            ? {
                ...conversation.session,
                sessionDate: conversation.session.sessionDate?.toISOString() ?? null,
              }
            : null,
          transcriptReview,
        }}
        initialReview={review}
      />
    </div>
  );
}
