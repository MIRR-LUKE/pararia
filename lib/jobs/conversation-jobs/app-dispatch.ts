import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { runAfterResponse } from "@/lib/server/after-response";
import { processAllConversationJobs } from "./orchestration";

type AppConversationDispatchDeps = {
  processAllConversationJobs?: typeof processAllConversationJobs;
  shouldRunBackgroundJobsInline?: typeof shouldRunBackgroundJobsInline;
  maybeStopRunpodWorkerWhenSessionPartQueueIdle?: typeof maybeStopRunpodWorkerWhenSessionPartQueueIdle;
};

export async function processConversationJobsOutsideRunpod(
  conversationId: string,
  deps: AppConversationDispatchDeps = {}
) {
  const runInline = deps.shouldRunBackgroundJobsInline ?? shouldRunBackgroundJobsInline;
  const processConversationJobs = deps.processAllConversationJobs ?? processAllConversationJobs;
  const stopRunpodWorker =
    deps.maybeStopRunpodWorkerWhenSessionPartQueueIdle ?? maybeStopRunpodWorkerWhenSessionPartQueueIdle;

  if (!runInline()) {
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
  runAfterResponse(async () => {
    const dispatch = await processConversationJobsOutsideRunpod(conversationId, deps);
    if (!dispatch.started) {
      console.info("[conversation-jobs] app dispatch waiting for session-part drain", {
        conversationId,
        reason: dispatch.reason,
      });
    }
  }, label);
}
