import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
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
};

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

  if (!runInline() && requireRunpodStopped) {
    const stop = await stopRunpodWorker();
    if (!stop.attempted) {
      return {
        started: false as const,
        reason: stop.reason,
      };
    }
  }

  return {
    started: true as const,
    result: await processConversationJobs(conversationId),
  };
}

export function kickConversationJobsOutsideRunpod(
  conversationId: string,
  label: string,
  deps: AppConversationDispatchDeps = {}
) {
  if (!shouldKickConversationJobsOutsideRunpodNow(conversationId)) {
    return false;
  }

  runAfterResponse(async () => {
    const dispatch = await processConversationJobsOutsideRunpod(conversationId, deps);
    if (!dispatch.started) {
      console.info("[conversation-jobs] app dispatch waiting for session-part drain", {
        conversationId,
        reason: dispatch.reason,
      });
    }
  }, label);

  return true;
}
