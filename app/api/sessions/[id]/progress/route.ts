import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { processAllConversationJobs } from "@/lib/jobs/conversationJobs";
import { processAllSessionPartJobs } from "@/lib/jobs/sessionPartJobs";
import { buildSessionProgressState } from "@/lib/session-progress";
import { buildSummaryPreview } from "@/lib/session-part-meta";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { pickDisplayTranscriptText } from "@/lib/transcript/source";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const authSession = authResult.session;

    const session = await prisma.session.findFirst({
      where: {
        id,
        organizationId: authSession.user.organizationId,
      },
      include: {
        parts: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            partType: true,
            status: true,
            fileName: true,
            rawTextOriginal: true,
            rawTextCleaned: true,
            reviewedText: true,
            reviewState: true,
            qualityMetaJson: true,
          },
        },
        conversation: {
          select: {
            id: true,
            status: true,
            summaryMarkdown: true,
            createdAt: true,
            jobs: {
              select: {
                type: true,
                status: true,
                startedAt: true,
                finishedAt: true,
              },
            },
          },
        },
        nextMeetingMemo: {
          select: {
            status: true,
            previousSummary: true,
            suggestedTopics: true,
            errorMessage: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "セッションが見つかりません。" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    if (searchParams.get("process") === "1") {
      const needsConversationWork =
        session.conversation?.status === "PROCESSING" ||
        session.nextMeetingMemo?.status === "QUEUED" ||
        session.nextMeetingMemo?.status === "GENERATING";
      if (shouldRunBackgroundJobsInline()) {
        void processAllSessionPartJobs(session.id).catch(() => {});
        void (async () => {
          try {
            if (session.conversation?.id && needsConversationWork) {
              await processAllConversationJobs(session.conversation.id);
            }
          } catch {}
        })();
        await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch(() => {});
      } else {
        const needsWorkerWake =
          session.parts.some((part) => part.status === "PENDING" || part.status === "UPLOADING" || part.status === "TRANSCRIBING") ||
          needsConversationWork;
        if (needsWorkerWake) {
          void maybeEnsureRunpodWorker().catch(() => {});
        }
      }
    }

    const progress = buildSessionProgressState({
      sessionId: session.id,
      type: session.type,
      parts: session.parts,
      conversation: session.conversation,
    });

    return NextResponse.json({
      session: {
        id: session.id,
        type: session.type,
        status: session.status,
      },
      conversation: session.conversation,
      nextMeetingMemo: session.nextMeetingMemo
        ? {
            status: session.nextMeetingMemo.status,
            previousSummary: session.nextMeetingMemo.previousSummary,
            suggestedTopics: session.nextMeetingMemo.suggestedTopics,
            errorMessage: session.nextMeetingMemo.errorMessage,
            updatedAt: session.nextMeetingMemo.updatedAt,
          }
        : null,
      parts: session.parts.map((part) => ({
        id: part.id,
        partType: part.partType,
        status: part.status,
        fileName: part.fileName,
        previewText: buildSummaryPreview(
          pickDisplayTranscriptText({
            rawTextCleaned: part.rawTextCleaned,
            reviewedText: part.reviewedText,
            rawTextOriginal: part.rawTextOriginal,
          })
        ),
        reviewState: part.reviewState,
        qualityMetaJson: part.qualityMetaJson,
      })),
      progress,
    });
  } catch (error: any) {
    console.error("[GET /api/sessions/[id]/progress] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
