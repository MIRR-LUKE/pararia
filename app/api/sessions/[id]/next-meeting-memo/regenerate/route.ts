import { NextResponse } from "next/server";
import { ConversationStatus, SessionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  enqueueNextMeetingMemoJob,
  processAllConversationJobs,
} from "@/lib/jobs/conversationJobs";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const session = await prisma.session.findFirst({
      where: {
        id: params.id,
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
      return NextResponse.json({ error: "セッションが見つかりません。" }, { status: 404 });
    }

    if (session.type !== SessionType.INTERVIEW) {
      return NextResponse.json({ error: "面談セッションのみ再生成できます。" }, { status: 409 });
    }

    if (!session.conversation?.id || session.conversation.status !== ConversationStatus.DONE) {
      return NextResponse.json(
        { error: "面談ログの生成完了後に作り直してください。" },
        { status: 409 }
      );
    }

    if (!session.conversation.summaryMarkdown?.trim()) {
      return NextResponse.json(
        { error: "面談ログ本文がないため、次回の面談メモを作り直せません。" },
        { status: 409 }
      );
    }

    await enqueueNextMeetingMemoJob(session.conversation.id);

    if (shouldRunBackgroundJobsInline()) {
      void (async () => {
        try {
          await processAllConversationJobs(session.conversation!.id);
        } catch (error) {
          console.error("[POST /api/sessions/[id]/next-meeting-memo/regenerate] Background process failed:", error);
        } finally {
          await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch(() => {});
        }
      })();
    } else {
      void maybeEnsureRunpodWorker().catch((error) => {
        console.error("[POST /api/sessions/[id]/next-meeting-memo/regenerate] Runpod wake failed:", error);
      });
    }

    return NextResponse.json({
      ok: true,
      sessionId: session.id,
      conversationId: session.conversation.id,
    });
  } catch (error: any) {
    console.error("[POST /api/sessions/[id]/next-meeting-memo/regenerate] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
