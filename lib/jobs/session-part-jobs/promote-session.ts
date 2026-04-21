import { ConversationSourceType, JobStatus, SessionPartStatus, SessionPartType, SessionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ensureConversationForSession } from "@/lib/session-service";
import { enqueueConversationJobs, processAllConversationJobs } from "@/lib/jobs/conversationJobs";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { kickConversationJobsOutsideRunpod } from "@/lib/jobs/conversation-jobs/app-dispatch";
import { toPrismaJson } from "@/lib/prisma-json";
import { toSessionPartMetaJson } from "@/lib/session-part-meta";
import { type SessionPartJobPayload, type SessionPartPayload } from "./shared";

type PromoteConversationDispatchDeps = {
  enqueueConversationJobs: typeof enqueueConversationJobs;
  processAllConversationJobs: typeof processAllConversationJobs;
  shouldRunBackgroundJobsInline: typeof shouldRunBackgroundJobsInline;
};

function readConversationMetaRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function readFinalizeJobMeta(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

async function mergeConversationFinalizeMeta(
  conversationId: string,
  patch: Record<string, unknown>
) {
  const existing = await prisma.conversationLog.findUnique({
    where: { id: conversationId },
    select: {
      qualityMetaJson: true,
    },
  });
  if (!existing) return;

  const previousMeta = readConversationMetaRecord(existing.qualityMetaJson);
  const previousFinalizeJob = readFinalizeJobMeta(previousMeta.finalizeJob);

  await prisma.conversationLog.update({
    where: { id: conversationId },
    data: {
      qualityMetaJson: toPrismaJson({
        ...previousMeta,
        finalizeJob: {
          ...previousFinalizeJob,
          ...patch,
        },
      }),
    },
  });
}

export async function dispatchPromotedConversationJobs(
  conversationId: string,
  deps: PromoteConversationDispatchDeps = {
    enqueueConversationJobs,
    processAllConversationJobs,
    shouldRunBackgroundJobsInline,
  }
) {
  await deps.enqueueConversationJobs(conversationId);

  if (deps.shouldRunBackgroundJobsInline()) {
    void deps.processAllConversationJobs(conversationId).catch((error) => {
      console.error("[sessionPartJobs] Background conversation processing failed:", error);
    });
    return {
      mode: "inline" as const,
      workerWake: null,
    };
  }

  return {
    mode: "external" as const,
    workerWake: null,
  };
}

type PromoteConversationKickDeps = {
  kickConversationJobsOutsideRunpod?: typeof kickConversationJobsOutsideRunpod;
  isRunpodWorkerProcess?: () => boolean;
  requireRunpodStopped?: boolean;
};

export function kickPromotedConversationJobsOutsideRunpod(
  conversationId: string,
  dispatchMode: "inline" | "external",
  deps: PromoteConversationKickDeps = {}
) {
  const isRunpodWorkerProcess =
    deps.isRunpodWorkerProcess ?? (() => Boolean(process.env.RUNPOD_POD_ID?.trim()));

  if (dispatchMode !== "external" || isRunpodWorkerProcess()) {
    return false;
  }

  const kickConversationJobs = deps.kickConversationJobsOutsideRunpod ?? kickConversationJobsOutsideRunpod;
  kickConversationJobs(
    conversationId,
    "sessionPartJobs promote app conversation processing",
    {
      requireRunpodStopped: deps.requireRunpodStopped ?? true,
    }
  );
  return true;
}

export async function executePromoteSessionJob(job: SessionPartJobPayload, part: SessionPartPayload) {
  const session = await prisma.session.findUnique({
    where: { id: part.sessionId },
    include: {
      parts: true,
      conversation: {
        select: {
          id: true,
        },
      },
    },
  });
  if (!session) {
    throw new Error("session not found");
  }

  const hasReadyCheckIn = session.parts.some((item) => item.partType === SessionPartType.CHECK_IN && item.status === SessionPartStatus.READY);
  const hasReadyCheckOut = session.parts.some((item) => item.partType === SessionPartType.CHECK_OUT && item.status === SessionPartStatus.READY);
  const readyForGeneration =
    session.type === SessionType.INTERVIEW
      ? session.parts.some((item) => item.partType === SessionPartType.FULL && item.status === SessionPartStatus.READY)
      : hasReadyCheckIn && hasReadyCheckOut;

  if (!readyForGeneration) {
    await prisma.sessionPart.update({
      where: { id: part.id },
      data: {
        qualityMetaJson: toSessionPartMetaJson(part.qualityMetaJson, {
          pipelineStage: "WAITING_COUNTERPART",
        }),
      },
    });
    await prisma.sessionPartJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.DONE,
        finishedAt: new Date(),
        outputJson: toPrismaJson({
          waiting: true,
        }),
      },
    });
    return;
  }

  await prisma.sessionPart.update({
    where: { id: part.id },
    data: {
      qualityMetaJson: toSessionPartMetaJson(part.qualityMetaJson, {
        pipelineStage: "GENERATING",
      }),
    },
  });

  const ensured = await ensureConversationForSession(part.sessionId);
  const dispatch =
    ensured.state === "unchanged"
      ? { mode: "reused" as const, workerWake: null }
      : await dispatchPromotedConversationJobs(ensured.conversationId);
  const promotionCompletedAt = new Date().toISOString();
  const requireRunpodStopped = part.sourceType !== ConversationSourceType.MANUAL;

  await mergeConversationFinalizeMeta(ensured.conversationId, {
    promotionCompletedAt,
    conversationDispatchMode: dispatch.mode,
    conversationEnsureState: ensured.state,
    conversationKickRequireRunpodStopped: requireRunpodStopped,
  });

  await prisma.sessionPartJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      outputJson: toPrismaJson({
        conversationId: ensured.conversationId,
        ensureState: ensured.state,
        dispatchMode: dispatch.mode,
        workerWake: dispatch.workerWake,
      }),
    },
  });
  if (dispatch.mode === "external") {
    const kicked = kickPromotedConversationJobsOutsideRunpod(ensured.conversationId, dispatch.mode, {
      requireRunpodStopped,
    });
    if (!kicked && process.env.RUNPOD_POD_ID?.trim()) {
      await mergeConversationFinalizeMeta(ensured.conversationId, {
        conversationKickRequestedAt: promotionCompletedAt,
        conversationKickDeferredAt: promotionCompletedAt,
        conversationKickDeferredReason: "runpod_worker_process",
        conversationKickFollowup: "session_progress_background_dispatch",
      });
    }
  }
}
