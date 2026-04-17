import { JobStatus, SessionPartStatus, SessionPartType, SessionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ensureConversationForSession } from "@/lib/session-service";
import { enqueueConversationJobs, processAllConversationJobs } from "@/lib/jobs/conversationJobs";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { toPrismaJson } from "@/lib/prisma-json";
import { toSessionPartMetaJson } from "@/lib/session-part-meta";
import { runAfterResponse } from "@/lib/server/after-response";
import { type SessionPartJobPayload, type SessionPartPayload } from "./shared";

type PromoteConversationDispatchDeps = {
  enqueueConversationJobs: typeof enqueueConversationJobs;
  processAllConversationJobs: typeof processAllConversationJobs;
  shouldRunBackgroundJobsInline: typeof shouldRunBackgroundJobsInline;
};

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

  const conversationId = await ensureConversationForSession(part.sessionId);
  const dispatch = await dispatchPromotedConversationJobs(conversationId);

  await prisma.sessionPartJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      outputJson: toPrismaJson({
        conversationId,
        dispatchMode: dispatch.mode,
        workerWake: dispatch.workerWake,
      }),
    },
  });

  runAfterResponse(async () => {
    await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch((error) => {
      console.warn("[sessionPartJobs] failed to stop Runpod worker after promotion", error);
    });
  }, "sessionPartJobs promote idle stop");
}
