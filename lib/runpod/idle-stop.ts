import { ConversationJobType, JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { stopCurrentRunpodPod, stopManagedRunpodWorker } from "@/lib/runpod/worker-control";

export function evaluateRunpodStopEligibility(input: {
  inlineMode: boolean;
  pendingSessionPartJobs: number;
  pendingConversationJobs: number;
}) {
  if (input.inlineMode) {
    return {
      attempted: false,
      reason: "inline_background_mode",
    } as const;
  }

  if (input.pendingSessionPartJobs > 0) {
    return {
      attempted: false,
      reason: "pending_session_part_jobs",
    } as const;
  }

  if (input.pendingConversationJobs > 0) {
    return {
      attempted: false,
      reason: "pending_conversation_jobs",
    } as const;
  }

  return {
    attempted: true,
    reason: "queues_drained",
  } as const;
}

export async function maybeStopRunpodWorkerWhenSessionPartQueueIdle() {
  const inlineMode = shouldRunBackgroundJobsInline();

  const pendingSessionPartJobs = await prisma.sessionPartJob.count({
    where: {
      status: {
        in: [JobStatus.QUEUED, JobStatus.RUNNING],
      },
    },
  });

  const pendingConversationJobs = await prisma.conversationJob.count({
    where: {
      type: {
        in: [
          ConversationJobType.FINALIZE,
          ConversationJobType.FORMAT,
          ConversationJobType.GENERATE_NEXT_MEETING_MEMO,
        ],
      },
      status: {
        in: [JobStatus.QUEUED, JobStatus.RUNNING],
      },
    },
  });

  const decision = evaluateRunpodStopEligibility({
    inlineMode,
    pendingSessionPartJobs,
    pendingConversationJobs,
  });

  if (!decision.attempted) {
    return {
      ...decision,
      pendingSessionPartJobs,
      pendingConversationJobs,
    } as const;
  }

  const stopResult = process.env.RUNPOD_POD_ID?.trim()
    ? await stopCurrentRunpodPod()
    : await stopManagedRunpodWorker();
  return {
    attempted: true,
    reason: stopResult.ok ? "stopped_or_already_stopped" : "stop_failed",
    pendingSessionPartJobs,
    pendingConversationJobs,
    stopResult,
  } as const;
}
