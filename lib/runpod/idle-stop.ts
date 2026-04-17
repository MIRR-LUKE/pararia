import { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { stopCurrentRunpodPod, stopManagedRunpodWorker } from "@/lib/runpod/worker-control";

export function evaluateRunpodStopEligibility(input: {
  inlineMode: boolean;
  pendingSessionPartJobs: number;
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

  return {
    attempted: true,
    reason: "session_part_queue_drained",
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

  const decision = evaluateRunpodStopEligibility({
    inlineMode,
    pendingSessionPartJobs,
  });

  if (!decision.attempted) {
    return {
      ...decision,
      pendingSessionPartJobs,
    } as const;
  }

  const stopResult = process.env.RUNPOD_POD_ID?.trim()
    ? await stopCurrentRunpodPod()
    : await stopManagedRunpodWorker();
  return {
    attempted: true,
    reason: stopResult.ok ? "stopped_or_already_stopped" : "stop_failed",
    pendingSessionPartJobs,
    stopResult,
  } as const;
}
