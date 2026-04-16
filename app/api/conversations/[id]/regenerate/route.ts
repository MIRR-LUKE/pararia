import { NextResponse } from "next/server";
import { ConversationStatus, JobStatus } from "@prisma/client";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import { prisma } from "@/lib/db";
import {
  enqueueConversationJobs,
  isConversationJobRunActive,
  processAllConversationJobs,
} from "@/lib/jobs/conversationJobs";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { ensureConversationReviewedTranscript } from "@/lib/transcript/review";
import { requireAuthorizedMutationSession } from "@/lib/server/request-auth";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import { runAfterResponse } from "@/lib/server/after-response";

type ConversationRegenerationSource = {
  rawTextOriginal: string | null;
  rawTextCleaned: string | null;
  reviewedText: string | null;
  formattedTranscript: string | null;
};

export function buildConversationRegenerationStartPlan(conversation: ConversationRegenerationSource) {
  const keepFormattedTranscriptAsSource =
    !conversation.rawTextCleaned?.trim() &&
    !conversation.rawTextOriginal?.trim() &&
    Boolean(conversation.formattedTranscript?.trim());

  return {
    keepFormattedTranscriptAsSource,
    updateData: {
      status: ConversationStatus.PROCESSING,
    },
  } as const;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
    const authResult = await requireAuthorizedMutationSession(request);
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;
    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "conversations.regenerate",
      userId: authResult.session.user.id,
      organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const { searchParams } = new URL(request.url);
    const includeFormat = searchParams.get("format") === "1";
    const conversation = await prisma.conversationLog.findFirst({
      where: withVisibleConversationWhere({ id, organizationId }),
      select: {
        id: true,
        rawTextOriginal: true,
        rawTextCleaned: true,
        reviewedText: true,
        formattedTranscript: true,
        sessionId: true,
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    const runningJobs = await prisma.conversationJob.count({
      where: {
        conversationId: id,
        status: JobStatus.RUNNING,
      },
    });

    if (runningJobs > 0 || (await isConversationJobRunActive(id))) {
      return NextResponse.json(
        { error: "このログは現在生成中です。完了後に再試行してください。" },
        { status: 409 }
      );
    }

    const hasRawSource =
      Boolean(conversation.reviewedText?.trim()) ||
      Boolean(conversation.rawTextCleaned?.trim()) ||
      Boolean(conversation.rawTextOriginal?.trim()) ||
      Boolean(conversation.formattedTranscript?.trim());

    if (!hasRawSource) {
      return NextResponse.json(
        { error: "raw transcript is missing. Cannot regenerate." },
        { status: 400 }
      );
    }

    const regenerationPlan = buildConversationRegenerationStartPlan(conversation);

    await prisma.conversationJob.deleteMany({ where: { conversationId: id } });

    await prisma.conversationLog.update({
      where: { id },
      data: {
        ...regenerationPlan.updateData,
      },
    });

    await ensureConversationReviewedTranscript(id);

    await enqueueConversationJobs(id, { includeFormat });
    if (shouldRunBackgroundJobsInline()) {
      void (async () => {
        try {
          await processAllConversationJobs(id);
        } catch (error) {
          console.error("[POST /api/conversations/[id]/regenerate] Background process failed:", error);
        } finally {
          await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch(() => {});
        }
      })();
    } else {
      runAfterResponse(async () => {
        await maybeEnsureRunpodWorker().catch((error) => {
          console.error("[POST /api/conversations/[id]/regenerate] Runpod wake failed:", error);
        });
      }, "POST /api/conversations/[id]/regenerate wake runpod");
    }

    if (conversation.sessionId) {
      await prisma.session.update({
        where: { id: conversation.sessionId },
        data: { status: "PROCESSING" },
      });
    }

    return NextResponse.json({
      success: true,
      message: "regeneration started",
      conversationId: id,
    });
  } catch (error: any) {
    console.error("[POST /api/conversations/[id]/regenerate] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
