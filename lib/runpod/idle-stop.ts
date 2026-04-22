import { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { stopCurrentRunpodPod, stopManagedRunpodWorker } from "@/lib/runpod/worker-control";

export function evaluateRunpodStopEligibility(input: {
  inlineMode: boolean;
  pendingTeacherRecordingJobs?: number;
  pendingSessionPartJobs: number;
}) {
  if (input.inlineMode) {
    return {
      attempted: false,
      reason: "inline_background_mode",
    } as const;
  }

  if ((input.pendingTeacherRecordingJobs ?? 0) > 0) {
    return {
      attempted: false,
      reason: "pending_teacher_recording_jobs",
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
    reason: "gpu_work_queue_drained",
  } as const;
}

export async function maybeStopRunpodWorkerWhenGpuQueuesIdle() {
  const inlineMode = shouldRunBackgroundJobsInline();

  const [pendingTeacherRecordingJobs, pendingSessionPartJobs] = await Promise.all([
    prisma.teacherRecordingJob.count({
      where: {
        status: {
          in: [JobStatus.QUEUED, JobStatus.RUNNING],
        },
      },
    }),
    prisma.sessionPartJob.count({
      where: {
        status: {
          in: [JobStatus.QUEUED, JobStatus.RUNNING],
        },
      },
    }),
  ]);

  const decision = evaluateRunpodStopEligibility({
    inlineMode,
    pendingTeacherRecordingJobs,
    pendingSessionPartJobs,
  });

  if (!decision.attempted) {
    return {
      ...decision,
      pendingTeacherRecordingJobs,
      pendingSessionPartJobs,
    } as const;
  }

  const stopResult = process.env.RUNPOD_POD_ID?.trim()
    ? await stopCurrentRunpodPod()
    : await stopManagedRunpodWorker();
  return {
    attempted: true,
    reason: stopResult.ok ? "stopped_or_already_stopped" : "stop_failed",
    pendingTeacherRecordingJobs,
    pendingSessionPartJobs,
    stopResult,
  } as const;
}

export async function maybeStopRunpodWorkerWhenSessionPartQueueIdle() {
  return maybeStopRunpodWorkerWhenGpuQueuesIdle();
}
