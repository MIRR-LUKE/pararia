import { NextResponse } from "next/server";
import { ConversationSourceType, JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ensureConversationJobsAvailable,
  processAllConversationJobs,
} from "@/lib/jobs/conversationJobs";
import { processAllSessionPartJobs } from "@/lib/jobs/sessionPartJobs";
import { buildSessionProgressState } from "@/lib/session-progress";
import { buildSummaryPreview } from "@/lib/session-part-meta";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { requireAuthorizedMutationSession, requireAuthorizedSession } from "@/lib/server/request-auth";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import { pickDisplayTranscriptText } from "@/lib/transcript/source";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";

async function loadSessionProgressSnapshot(sessionId: string, organizationId: string) {
  return prisma.session.findFirst({
    where: {
      id: sessionId,
      organizationId,
    },
    include: {
      parts: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          partType: true,
          sourceType: true,
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
}

function hasOnlyManualParts(parts: Array<{ sourceType: ConversationSourceType }>) {
  return parts.length > 0 && parts.every((part) => part.sourceType === ConversationSourceType.MANUAL);
}

export function shouldWakeExternalSessionWorker(input: {
  partStatuses: string[];
  queuedSessionPartJobCount: number;
  hasPendingConversationWork: boolean;
}) {
  return (
    input.queuedSessionPartJobCount > 0 ||
    input.partStatuses.some((status) => status === "PENDING" || status === "UPLOADING" || status === "TRANSCRIBING") ||
    input.hasPendingConversationWork
  );
}

type SessionWorkerWakeDeps = {
  maybeEnsureRunpodWorker?: typeof maybeEnsureRunpodWorker;
  processAllSessionPartJobs?: typeof processAllSessionPartJobs;
  processAllConversationJobs?: typeof processAllConversationJobs;
};

export function kickSessionWorkerOrFallback(
  sessionId: string,
  hasPendingConversationWork: boolean,
  deps: SessionWorkerWakeDeps = {}
) {
  const ensureWorker = deps.maybeEnsureRunpodWorker ?? maybeEnsureRunpodWorker;
  const processSessionParts = deps.processAllSessionPartJobs ?? processAllSessionPartJobs;
  const processConversation = deps.processAllConversationJobs ?? processAllConversationJobs;

  void (async () => {
    const workerWake = await ensureWorker().catch((error: any) => ({
      attempted: true,
      ok: false,
      error: error?.message ?? String(error),
    }));

    if (workerWake.attempted && workerWake.ok) {
      return;
    }

    console.warn("[GET /api/sessions/[id]/progress] falling back to inline processing", {
      sessionId,
      workerWake,
    });

    await processSessionParts(sessionId);

    const refreshedConversation = await prisma.conversationLog.findFirst({
      where: withVisibleConversationWhere({ sessionId }),
      select: {
        id: true,
        status: true,
        jobs: {
          select: {
            status: true,
          },
        },
      },
    });

    const shouldProcessConversation =
      Boolean(refreshedConversation?.id) &&
      (hasPendingConversationWork ||
        refreshedConversation?.status === "PROCESSING" ||
        Boolean(refreshedConversation?.jobs.some((job) => job.status === "QUEUED" || job.status === "RUNNING")));

    if (refreshedConversation?.id && shouldProcessConversation) {
      await processConversation(refreshedConversation.id);
    }
  })().catch((error) => {
    console.error("[GET /api/sessions/[id]/progress] worker wake fallback failed:", error);
  });
}

async function recoverMissingConversationJobs(conversationId: string | null | undefined) {
  if (!conversationId) {
    return { healed: false as const, reason: "missing_conversation_id" as const };
  }

  const recovery = await ensureConversationJobsAvailable(conversationId);
  if (!recovery.healed) {
    return recovery;
  }

  await processAllConversationJobs(conversationId);
  return recovery;
}

async function processSessionProgress(session: NonNullable<Awaited<ReturnType<typeof loadSessionProgressSnapshot>>>) {
  const manualOnlyParts = hasOnlyManualParts(session.parts);
  const queuedSessionPartJobCount = await prisma.sessionPartJob.count({
    where: {
      status: {
        in: [JobStatus.QUEUED, JobStatus.RUNNING],
      },
      sessionPart: {
        sessionId: session.id,
      },
    },
  });

  if (manualOnlyParts && queuedSessionPartJobCount > 0) {
    await processAllSessionPartJobs(session.id).catch(() => {});
  }

  const recovery = await recoverMissingConversationJobs(session.conversation?.id).catch(() => ({
    healed: false as const,
    reason: "recovery_failed" as const,
  }));
  const needsConversationWork =
    recovery.healed ||
    session.conversation?.status === "PROCESSING" ||
    Boolean(session.conversation?.jobs.some((job) => job.status === "QUEUED" || job.status === "RUNNING")) ||
    session.nextMeetingMemo?.status === "QUEUED" ||
    session.nextMeetingMemo?.status === "GENERATING";
  if (recovery.healed) {
    await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch(() => {});
    return;
  }

  if (shouldRunBackgroundJobsInline()) {
    void processAllSessionPartJobs(session.id).catch(() => {});
    if (session.conversation?.id && needsConversationWork) {
      await processAllConversationJobs(session.conversation.id).catch(() => {});
    }
    await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch(() => {});
    return;
  }

  const needsWorkerWake = shouldWakeExternalSessionWorker({
    partStatuses: session.parts.map((part) => part.status),
    queuedSessionPartJobCount,
    hasPendingConversationWork: needsConversationWork,
  });
  if (needsWorkerWake) {
    kickSessionWorkerOrFallback(session.id, needsConversationWork);
  }
}

function buildSessionProgressResponse(session: NonNullable<Awaited<ReturnType<typeof loadSessionProgressSnapshot>>>) {
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
}

async function loadAuthorizedProgressSession(params: RouteParams, request?: Request) {
  const sessionId = await resolveRouteId(params);
  if (!sessionId) {
    return {
      sessionId: null,
      authSession: null,
      session: null,
      response: NextResponse.json({ error: "sessionId が必要です。" }, { status: 400 }),
    } as const;
  }

  const authResult = request
    ? await requireAuthorizedMutationSession(request)
    : await requireAuthorizedSession();
  if (authResult.response) {
    return {
      sessionId,
      authSession: null,
      session: null,
      response: authResult.response,
    } as const;
  }

  const session = await loadSessionProgressSnapshot(sessionId, authResult.session.user.organizationId);
  if (!session) {
    return {
      sessionId,
      authSession: authResult.session,
      session: null,
      response: NextResponse.json({ error: "セッションが見つかりません。" }, { status: 404 }),
    } as const;
  }

  return {
    sessionId,
    authSession: authResult.session,
    session,
    response: null,
  } as const;
}

export async function GET(_request: Request, { params }: { params: RouteParams }) {
  try {
    const loaded = await loadAuthorizedProgressSession(params);
    if (loaded.response) return loaded.response;
    return buildSessionProgressResponse(loaded.session);
  } catch (error: any) {
    console.error("[GET /api/sessions/[id]/progress] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: RouteParams }) {
  try {
    const loaded = await loadAuthorizedProgressSession(params, request);
    if (loaded.response) return loaded.response;
    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "sessions.progress",
      userId: loaded.authSession!.user.id,
      organizationId: loaded.authSession!.user.organizationId,
    });
    if (throttleResponse) return throttleResponse;

    await processSessionProgress(loaded.session);
    const refreshedSession = await loadSessionProgressSnapshot(loaded.sessionId!, loaded.authSession!.user.organizationId);
    if (!refreshedSession) {
      return NextResponse.json({ error: "セッションが見つかりません。" }, { status: 404 });
    }
    return buildSessionProgressResponse(refreshedSession);
  } catch (error: any) {
    console.error("[POST /api/sessions/[id]/progress] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
