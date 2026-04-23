import { prisma } from "@/lib/db";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { toPrismaJson } from "@/lib/prisma-json";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { runAfterResponse } from "@/lib/server/after-response";
import { processAllConversationJobs } from "./orchestration";

const APP_DISPATCH_COOLDOWN_MS = 4_000;
const recentAppDispatchKickAt = new Map<string, number>();

type AppConversationDispatchDeps = {
  processAllConversationJobs?: typeof processAllConversationJobs;
  shouldRunBackgroundJobsInline?: typeof shouldRunBackgroundJobsInline;
  maybeStopRunpodWorkerWhenSessionPartQueueIdle?: typeof maybeStopRunpodWorkerWhenSessionPartQueueIdle;
  requireRunpodStopped?: boolean;
  recordDispatchState?: (
    conversationId: string,
    patch: Record<string, unknown>
  ) => void | Promise<void>;
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

async function persistConversationDispatchState(
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

export function shouldKickConversationJobsOutsideRunpodNow(
  conversationId: string,
  now = Date.now(),
  cache = recentAppDispatchKickAt
) {
  for (const [entryKey, lastTriggeredAt] of cache.entries()) {
    if (now - lastTriggeredAt >= APP_DISPATCH_COOLDOWN_MS) {
      cache.delete(entryKey);
    }
  }

  const lastTriggeredAt = cache.get(conversationId);
  if (typeof lastTriggeredAt === "number" && now - lastTriggeredAt < APP_DISPATCH_COOLDOWN_MS) {
    return false;
  }

  cache.set(conversationId, now);
  return true;
}

export async function processConversationJobsOutsideRunpod(
  conversationId: string,
  deps: AppConversationDispatchDeps = {}
) {
  const runInline = deps.shouldRunBackgroundJobsInline ?? shouldRunBackgroundJobsInline;
  const processConversationJobs = deps.processAllConversationJobs ?? processAllConversationJobs;
  const stopRunpodWorker =
    deps.maybeStopRunpodWorkerWhenSessionPartQueueIdle ?? maybeStopRunpodWorkerWhenSessionPartQueueIdle;
  const requireRunpodStopped = deps.requireRunpodStopped ?? true;
  const recordDispatchState = deps.recordDispatchState ?? persistConversationDispatchState;
  const appDispatchStartedAt = new Date().toISOString();

  await recordDispatchState(conversationId, {
    conversationAppDispatchStartedAt: appDispatchStartedAt,
    conversationAppDispatchRequireRunpodStopped: requireRunpodStopped,
  });

  if (!runInline() && requireRunpodStopped) {
    const stop = await stopRunpodWorker();
    if (!stop.attempted) {
      await recordDispatchState(conversationId, {
        conversationAppDispatchBlockedAt: new Date().toISOString(),
        conversationAppDispatchBlockedReason: stop.reason,
        conversationAppDispatchPendingSessionPartJobs:
          "pendingSessionPartJobs" in stop ? stop.pendingSessionPartJobs : null,
      });
      await recordDispatchState(conversationId, {
        conversationAppDispatchProceedingWithoutRunpodStopAt: new Date().toISOString(),
        conversationAppDispatchProceedingWithoutRunpodStopReason: stop.reason,
      });
    } else {
      await recordDispatchState(conversationId, {
        conversationAppDispatchRunpodStopReason: stop.reason,
        conversationAppDispatchPendingSessionPartJobs:
          "pendingSessionPartJobs" in stop ? stop.pendingSessionPartJobs : null,
      });
    }
  }

  try {
    const result = await processConversationJobs(conversationId);
    await recordDispatchState(conversationId, {
      conversationAppDispatchCompletedAt: new Date().toISOString(),
      conversationAppDispatchProcessedCount: result.processed,
      conversationAppDispatchErrorCount: result.errors.length,
    });
    return {
      started: true as const,
      result,
    };
  } catch (error) {
    await recordDispatchState(conversationId, {
      conversationAppDispatchFailedAt: new Date().toISOString(),
      conversationAppDispatchFailure:
        error instanceof Error ? error.message : String(error ?? "unknown error"),
    });
    throw error;
  }
}

export function kickConversationJobsOutsideRunpod(
  conversationId: string,
  label: string,
  deps: AppConversationDispatchDeps = {}
) {
  const recordDispatchState = deps.recordDispatchState ?? persistConversationDispatchState;
  const requestedAt = new Date().toISOString();
  if (!shouldKickConversationJobsOutsideRunpodNow(conversationId)) {
    void Promise.resolve(
      recordDispatchState(conversationId, {
        conversationKickSuppressedAt: requestedAt,
        conversationKickSuppressedReason: "cooldown",
      })
    ).catch(() => {});
    return false;
  }

  void Promise.resolve(
    recordDispatchState(conversationId, {
      conversationKickRequestedAt: requestedAt,
      conversationKickLabel: label,
      conversationKickRequireRunpodStopped: deps.requireRunpodStopped ?? true,
    })
  ).catch(() => {});

  runAfterResponse(async () => {
    await processConversationJobsOutsideRunpod(conversationId, deps);
  }, label);

  return true;
}
