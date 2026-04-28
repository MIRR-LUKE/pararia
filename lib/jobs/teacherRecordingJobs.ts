import { randomUUID } from "node:crypto";
import { JobStatus, TeacherRecordingJobType, TeacherRecordingSessionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runTeacherRecordingAnalysis } from "@/lib/teacher-app/server/recordings";
import { updateTeacherRecordingStatus } from "@/lib/teacher-app/server/recording-status";
import { notifyTeacherRecordingError } from "@/lib/teacher-app/server/recording-notifications";
import { maybeStopRunpodWorkerWhenGpuQueuesIdle } from "@/lib/runpod/idle-stop";

type ProcessTeacherRecordingJobsOptions = {
  recordingId?: string;
};

async function claimNextTeacherRecordingJob(recordingId?: string) {
  while (true) {
    const next = await prisma.teacherRecordingJob.findFirst({
      where: {
        status: JobStatus.QUEUED,
        ...(recordingId ? { recordingSessionId: recordingId } : {}),
      },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        type: true,
        recordingSessionId: true,
        recordingSession: {
          select: {
            organizationId: true,
          },
        },
        attempts: true,
        maxAttempts: true,
      },
    });
    if (!next) return null;

    const claimed = await prisma.teacherRecordingJob.updateMany({
      where: {
        id: next.id,
        status: JobStatus.QUEUED,
      },
      data: {
        status: JobStatus.RUNNING,
        executionId: randomUUID(),
        attempts: { increment: 1 },
        startedAt: new Date(),
        finishedAt: null,
        lastError: null,
      },
    });

    if (claimed.count > 0) {
      return next;
    }
  }
}

async function executeTeacherRecordingJob(job: {
  id: string;
  type: TeacherRecordingJobType;
  recordingSessionId: string;
}) {
  if (job.type === TeacherRecordingJobType.TRANSCRIBE_AND_SUGGEST) {
    return runTeacherRecordingAnalysis(job.recordingSessionId);
  }
  throw new Error(`unsupported teacher recording job type: ${job.type}`);
}

export async function processQueuedTeacherRecordingJobs(
  limit = 1,
  opts?: ProcessTeacherRecordingJobsOptions
): Promise<{ processed: number; errors: string[] }> {
  const maxLimit = Math.max(1, Math.floor(limit));
  let processed = 0;
  const errors: string[] = [];

  for (let index = 0; index < maxLimit; index += 1) {
    const job = await claimNextTeacherRecordingJob(opts?.recordingId);
    if (!job) {
      break;
    }

    try {
      const output = await executeTeacherRecordingJob({
        id: job.id,
        type: job.type,
        recordingSessionId: job.recordingSessionId,
      });
      await prisma.teacherRecordingJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.DONE,
          outputJson: output ? JSON.parse(JSON.stringify(output)) : null,
          finishedAt: new Date(),
        },
      });
      await maybeStopRunpodWorkerWhenGpuQueuesIdle().catch((stopError) => {
        console.warn("[teacher-recording-jobs] failed to stop Runpod worker after teacher STT", stopError);
      });
      processed += 1;
    } catch (error: any) {
      const lastError = error?.message ?? "teacher recording job failed";
      errors.push(lastError);
      const shouldRetry = (job.attempts ?? 0) + 1 < (job.maxAttempts ?? 3);
      if (shouldRetry) {
        await prisma.teacherRecordingSession.updateMany({
          where: {
            id: job.recordingSessionId,
            status: TeacherRecordingSessionStatus.TRANSCRIBING,
          },
          data: {
            errorMessage: lastError,
          },
        }).catch(() => {});
      } else {
        await prisma.$transaction((tx) =>
          updateTeacherRecordingStatus(tx, {
            recordingId: job.recordingSessionId,
            from: TeacherRecordingSessionStatus.TRANSCRIBING,
            to: TeacherRecordingSessionStatus.ERROR,
            data: {
              errorMessage: lastError,
            },
          })
        ).catch(() => {});
      }
      await prisma.teacherRecordingJob.update({
        where: { id: job.id },
        data: {
          status: shouldRetry ? JobStatus.QUEUED : JobStatus.ERROR,
          lastError,
          finishedAt: shouldRetry ? null : new Date(),
        },
      });
      if (!shouldRetry) {
        await notifyTeacherRecordingError({
          recordingId: job.recordingSessionId,
          organizationId: job.recordingSession.organizationId,
          errorMessage: lastError,
        }).catch((notifyError) => {
          console.warn("[teacher-recording-jobs] failed to notify teacher recording error", {
            recordingId: job.recordingSessionId,
            error: notifyError instanceof Error ? notifyError.message : String(notifyError),
          });
        });
      }
      await maybeStopRunpodWorkerWhenGpuQueuesIdle().catch((stopError) => {
        console.warn("[teacher-recording-jobs] failed to stop Runpod worker after teacher STT error", stopError);
      });
    }
  }

  return {
    processed,
    errors,
  };
}
