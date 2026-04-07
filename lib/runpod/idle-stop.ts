import { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { stopCurrentRunpodPod, stopManagedRunpodWorker } from "@/lib/runpod/worker-control";

export async function maybeStopRunpodWorkerWhenSessionPartQueueIdle() {
  if (shouldRunBackgroundJobsInline()) {
    return {
      attempted: false,
      reason: "inline_background_mode",
      pendingSessionPartJobs: 0,
    } as const;
  }

  const pendingSessionPartJobs = await prisma.sessionPartJob.count({
    where: {
      status: {
        in: [JobStatus.QUEUED, JobStatus.RUNNING],
      },
    },
  });

  if (pendingSessionPartJobs > 0) {
    return {
      attempted: false,
      reason: "pending_session_part_jobs",
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
