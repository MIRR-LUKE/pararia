import { NextResponse } from "next/server";
import { ConversationStatus, SessionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  enqueueNextMeetingMemoJob,
  processAllConversationJobs,
} from "@/lib/jobs/conversationJobs";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import {
  createOperationErrorContext,
  logOperationIssue,
  respondWithOperationError,
} from "@/lib/observability/operation-errors";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const context = createOperationErrorContext("next-meeting-memo-regenerate");
  let stage = "auth";
  try {
    const { id } = await Promise.resolve(params);
    const sessionId = typeof id === "string" ? id.trim() : "";
    if (!sessionId) {
      return NextResponse.json(withOperationMeta(operation, "resolve_params", { error: "sessionId が必要です。" }), { status: 400 });
    }

    const authResult = await requireAuthorizedSession();
    if (authResult.response) {
      return respondWithOperationError({
        context,
        stage,
        message: "Unauthorized",
        status: 401,
      });
    }
    const organizationId = authResult.session.user.organizationId;
    const { id } = await Promise.resolve(params);
    const sessionId = typeof id === "string" ? id.trim() : "";
    if (!sessionId) {
      return respondWithOperationError({
        context,
        stage: "params",
        message: "セッションIDが必要です。",
        status: 400,
        level: "warn",
      });
    }

    stage = "session_lookup";
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
      return respondWithOperationError({
        context,
        stage,
        message: "セッションが見つかりません。",
        status: 404,
        level: "warn",
      });
    }

    stage = "validate_session_type";
    if (session.type !== SessionType.INTERVIEW) {
      return respondWithOperationError({
        context,
        stage,
        message: "面談セッションのみ再生成できます。",
        status: 409,
        level: "warn",
      });
    }

    stage = "validate_conversation";
    if (!session.conversation?.id || session.conversation.status !== ConversationStatus.DONE) {
      return respondWithOperationError({
        context,
        stage,
        message: "面談ログの生成完了後に作り直してください。",
        status: 409,
        level: "warn",
      });
    }

    if (!session.conversation.summaryMarkdown?.trim()) {
      return respondWithOperationError({
        context,
        stage,
        message: "面談ログ本文がないため、次回の面談メモを作り直せません。",
        status: 409,
        level: "warn",
      });
    }

    stage = "enqueue_job";
    await enqueueNextMeetingMemoJob(session.conversation.id);

    if (shouldRunBackgroundJobsInline()) {
      void (async () => {
        try {
          await processAllConversationJobs(session.conversation!.id);
        } catch (error) {
          logOperationIssue({
            context,
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
        logOperationIssue({
          context,
          stage: "worker_wake",
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
    return respondWithOperationError({
      context,
      stage,
      message: error?.message ?? "Internal Server Error",
      status: 500,
      error,
    });
  }
}
