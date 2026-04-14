import { NextResponse } from "next/server";
import { ConversationStatus, JobStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  enqueueConversationJobs,
  isConversationJobRunActive,
  processAllConversationJobs,
} from "@/lib/jobs/conversationJobs";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { ensureConversationReviewedTranscript } from "@/lib/transcript/review";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const { searchParams } = new URL(request.url);
    const includeFormat = searchParams.get("format") === "1";
    const conversation = await prisma.conversationLog.findFirst({
      where: { id, organizationId },
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

    if (runningJobs > 0 || isConversationJobRunActive(id)) {
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

    const keepFormattedTranscriptAsSource =
      !conversation.rawTextCleaned?.trim() &&
      !conversation.rawTextOriginal?.trim() &&
      Boolean(conversation.formattedTranscript?.trim());

    await prisma.conversationJob.deleteMany({ where: { conversationId: id } });

    await prisma.conversationLog.update({
      where: { id },
      data: {
        status: ConversationStatus.PROCESSING,
        artifactJson: Prisma.DbNull,
        summaryMarkdown: null,
        qualityMetaJson: Prisma.DbNull,
        formattedTranscript: keepFormattedTranscriptAsSource ? conversation.formattedTranscript : null,
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
      void maybeEnsureRunpodWorker().catch((error) => {
        console.error("[POST /api/conversations/[id]/regenerate] Runpod wake failed:", error);
      });
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
