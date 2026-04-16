import { NextResponse } from "next/server";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import { prisma } from "@/lib/db";
import { ConversationJobType, JobStatus } from "@prisma/client";
import { processAllConversationJobs } from "@/lib/jobs/conversationJobs";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { requireAuthorizedMutationSession } from "@/lib/server/request-auth";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import { runAfterResponse } from "@/lib/server/after-response";

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
      scope: "conversations.format",
      userId: authResult.session.user.id,
      organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const conversation = await prisma.conversationLog.findFirst({
      where: withVisibleConversationWhere({ id, organizationId }),
      select: {
        id: true,
        formattedTranscript: true,
        rawTextOriginal: true,
        rawTextCleaned: true,
        reviewedText: true,
        rawSegments: true,
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    if (conversation.formattedTranscript) {
      return NextResponse.json({ ok: true, message: "already formatted" });
    }

    if (!conversation.rawTextOriginal && !conversation.rawTextCleaned && !conversation.reviewedText && !conversation.rawSegments) {
      return NextResponse.json(
        { error: "raw transcript is missing. Cannot format." },
        { status: 400 }
      );
    }

    await prisma.conversationJob.createMany({
      data: [
        { conversationId: id, type: ConversationJobType.FORMAT, status: JobStatus.QUEUED },
      ],
      skipDuplicates: true,
    });

    if (shouldRunBackgroundJobsInline()) {
      void (async () => {
        try {
          await processAllConversationJobs(id);
        } catch (error) {
          console.error("[POST /api/conversations/[id]/format] Background process failed:", error);
        } finally {
          await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch(() => {});
        }
      })();
    } else {
      runAfterResponse(async () => {
        await maybeEnsureRunpodWorker().catch((error) => {
          console.error("[POST /api/conversations/[id]/format] Runpod wake failed:", error);
        });
      }, "POST /api/conversations/[id]/format wake runpod");
    }

    return NextResponse.json({ ok: true, message: "format job queued" });
  } catch (error: any) {
    console.error("[POST /api/conversations/[id]/format] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
