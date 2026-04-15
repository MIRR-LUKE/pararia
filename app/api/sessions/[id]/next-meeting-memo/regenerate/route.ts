import { NextResponse } from "next/server";
import { ConversationStatus, SessionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  enqueueNextMeetingMemoJob,
  processAllConversationJobs,
} from "@/lib/jobs/conversationJobs";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { createOperationContext, logOperationError, operationErrorResponse, withOperationMeta } from "@/lib/observability/operation-errors";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";
import { requireAuthorizedMutationSession } from "@/lib/server/request-auth";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";

export async function POST(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const operation = createOperationContext("POST /api/sessions/[id]/next-meeting-memo/regenerate");
  try {
    const { id } = await Promise.resolve(params);
    const sessionId = typeof id === "string" ? id.trim() : "";
    if (!sessionId) {
      return NextResponse.json(withOperationMeta(operation, "resolve_params", { error: "sessionId が必要です。" }), { status: 400 });
    }

    const authResult = await requireAuthorizedMutationSession(request);
    if (authResult.response) {
      return NextResponse.json(withOperationMeta(operation, "authorize", { error: "Unauthorized" }), { status: 401 });
    }
    const organizationId = authResult.session.user.organizationId;
    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "next-meeting-memo.regenerate",
      userId: authResult.session.user.id,
      organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        organizationId,
      },
      select: {
        id: true,
        type: true,
        conversation: {
          select: {
            id: true,
            status: true,
            summaryMarkdown: true,
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json(withOperationMeta(operation, "session_lookup", { error: "セッションが見つかりません。" }), { status: 404 });
    }

    if (session.type !== SessionType.INTERVIEW) {
      return NextResponse.json(
        withOperationMeta(operation, "validate_session_type", { error: "面談セッションのみ再生成できます。" }),
        { status: 409 }
      );
    }

    if (!session.conversation?.id || session.conversation.status !== ConversationStatus.DONE) {
      return NextResponse.json(
        withOperationMeta(operation, "validate_conversation", { error: "面談ログの生成完了後に作り直してください。" }),
        { status: 409 }
      );
    }

    if (!session.conversation.summaryMarkdown?.trim()) {
      return NextResponse.json(
        withOperationMeta(operation, "validate_conversation", { error: "面談ログ本文がないため、次回の面談メモを作り直せません。" }),
        { status: 409 }
      );
    }

    await enqueueNextMeetingMemoJob(session.conversation.id);

    if (shouldRunBackgroundJobsInline()) {
      void (async () => {
        try {
          await processAllConversationJobs(session.conversation!.id);
        } catch (error) {
          logOperationError(operation, {
            stage: "background_process",
            message: "Background process failed",
            error,
          });
        } finally {
          await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch(() => {});
        }
      })();
    } else {
      void maybeEnsureRunpodWorker().catch((error) => {
        logOperationError(operation, {
          stage: "wake_runpod_worker",
          message: "Runpod wake failed",
          error,
        });
      });
    }

    return NextResponse.json({
      ok: true,
      sessionId: session.id,
      conversationId: session.conversation.id,
      operationId: operation.operationId,
    });
  } catch (error: any) {
    return operationErrorResponse(operation, {
      stage: "enqueue_job",
      message: error?.message ?? "Internal Server Error",
      error,
    });
  }
}
