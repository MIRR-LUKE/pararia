import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";

export function logJobInfo(message: string, context: Record<string, unknown>) {
  console.info("[conversation-jobs]", message, context);
}

export function logJobWarn(message: string, context: Record<string, unknown>) {
  console.warn("[conversation-jobs]", message, context);
}

export function logJobError(message: string, context: Record<string, unknown>) {
  console.error("[conversation-jobs]", message, context);
}

export async function stopRunpodWorkerAfterConversationJob(stage: string) {
  await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch((error) => {
    console.warn(`[conversation-jobs] failed to stop Runpod worker after ${stage}`, error);
  });
}
