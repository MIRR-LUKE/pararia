import { randomUUID } from "node:crypto";
import { JobStatus, Prisma, SessionPartJobType, TeacherRecordingJobType, TeacherRecordingSessionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { processQueuedSessionPartJobs } from "@/lib/jobs/sessionPartJobs";
import { getSessionPartRecoveryPlan, markPartRecoveringForRetry, requeueRecoverableTranscriptionJobs } from "@/lib/jobs/session-part-jobs/retry";
import { loadSessionPart, markPartExecutionError, type SessionPartJobPayload } from "@/lib/jobs/session-part-jobs/shared";
import { applySessionPartTranscriptionOutcome } from "@/lib/jobs/session-part-jobs/transcribe-file";
import { maybeStopRunpodWorkerWhenGpuQueuesIdle, maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import type {
  RunpodRemoteSessionPartTask,
  RunpodRemoteSttTask,
  RunpodRemoteTeacherRecordingTask,
  RunpodRemoteTaskFailure,
} from "@/lib/runpod/remote-stt-types";
import type { SessionPartTranscriptionResult } from "@/lib/runpod/stt/session-part-task";
import type { TeacherRecordingTranscriptionResult } from "@/lib/runpod/stt/teacher-recording-task";
import {
  acquireTeacherRecordingLease,
  applyTeacherRecordingTranscriptionResult,
  releaseTeacherRecordingLease,
} from "@/lib/teacher-app/server/recordings";
import { toPrismaJson } from "@/lib/prisma-json";

const STALE_SESSION_PART_TRANSCRIPTION_MS = 45 * 60 * 1000;
const STALE_TEACHER_RECORDING_LEASE_GRACE_MS = 2 * 60 * 1000;

function readSessionPartQualityMeta(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function recoverStaleTeacherRecordingJobs() {
  const now = new Date();
  const staleWithoutLeaseBefore = new Date(Date.now() - STALE_TEACHER_RECORDING_LEASE_GRACE_MS);
  const staleJobs = await prisma.teacherRecordingJob.findMany({
    where: {
      status: JobStatus.RUNNING,
      type: TeacherRecordingJobType.TRANSCRIBE_AND_SUGGEST,
      recordingSession: {
        status: TeacherRecordingSessionStatus.TRANSCRIBING,
        OR: [
          { processingLeaseExpiresAt: { lt: now } },
          {
            processingLeaseExpiresAt: null,
            updatedAt: {
              lt: staleWithoutLeaseBefore,
            },
          },
        ],
      },
    },
    select: {
      id: true,
      recordingSessionId: true,
    },
    take: 20,
  });

  for (const stale of staleJobs) {
    const reset = await prisma.teacherRecordingJob.updateMany({
      where: {
        id: stale.id,
        status: JobStatus.RUNNING,
      },
      data: {
        status: JobStatus.QUEUED,
        executionId: null,
        lastError: null,
        outputJson: Prisma.DbNull,
        costMetaJson: Prisma.DbNull,
        startedAt: null,
        finishedAt: null,
      },
    });
    if (reset.count === 0) {
      continue;
    }
    await prisma.teacherRecordingSession.update({
      where: { id: stale.recordingSessionId },
      data: {
        status: TeacherRecordingSessionStatus.TRANSCRIBING,
        errorMessage: null,
        processingLeaseExecutionId: null,
        processingLeaseExpiresAt: null,
        processingLeaseStartedAt: null,
        processingLeaseHeartbeatAt: null,
      },
    }).catch(() => {});
  }
}

async function recoverStaleSessionPartTranscriptionJobs(sessionId?: string) {
  const staleBefore = new Date(Date.now() - STALE_SESSION_PART_TRANSCRIPTION_MS);
  const staleJobs = await prisma.sessionPartJob.findMany({
    where: {
      status: JobStatus.RUNNING,
      type: SessionPartJobType.TRANSCRIBE_FILE,
      startedAt: {
        lt: staleBefore,
      },
      ...(sessionId
        ? {
            sessionPart: {
              sessionId,
            },
          }
        : {}),
    },
    select: {
      id: true,
      sessionPartId: true,
    },
    take: 20,
  });

  for (const stale of staleJobs) {
    await prisma.sessionPartJob.updateMany({
      where: {
        id: stale.id,
        status: JobStatus.RUNNING,
      },
      data: {
        status: JobStatus.ERROR,
        lastError: "stale remote worker execution",
        finishedAt: new Date(),
      },
    });
  }
}

async function claimTeacherRecordingTask(): Promise<RunpodRemoteTeacherRecordingTask | null> {
  await recoverStaleTeacherRecordingJobs();

  while (true) {
    const next = await prisma.teacherRecordingJob.findFirst({
      where: {
        status: JobStatus.QUEUED,
        type: TeacherRecordingJobType.TRANSCRIBE_AND_SUGGEST,
        recordingSession: {
          status: TeacherRecordingSessionStatus.TRANSCRIBING,
          audioStorageUrl: {
            not: null,
          },
          audioFileName: {
            not: null,
          },
        },
      },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        recordingSessionId: true,
      },
    });
    if (!next) {
      return null;
    }

    const executionId = randomUUID();
    const claimed = await prisma.teacherRecordingJob.updateMany({
      where: {
        id: next.id,
        status: JobStatus.QUEUED,
      },
      data: {
        status: JobStatus.RUNNING,
        executionId,
        attempts: { increment: 1 },
        startedAt: new Date(),
        finishedAt: null,
        lastError: null,
      },
    });
    if (claimed.count === 0) {
      continue;
    }

    const leaseAcquired = await acquireTeacherRecordingLease(next.recordingSessionId, executionId);
    if (!leaseAcquired) {
      await prisma.teacherRecordingJob.updateMany({
        where: {
          id: next.id,
          status: JobStatus.RUNNING,
          executionId,
        },
        data: {
          status: JobStatus.QUEUED,
          executionId: null,
          startedAt: null,
        },
      });
      continue;
    }

    const recording = await prisma.teacherRecordingSession.findUnique({
      where: { id: next.recordingSessionId },
      select: {
        id: true,
        audioStorageUrl: true,
        audioFileName: true,
        audioMimeType: true,
      },
    });
    if (!recording?.audioStorageUrl || !recording.audioFileName) {
      await releaseTeacherRecordingLease(next.recordingSessionId, executionId).catch(() => {});
      await prisma.teacherRecordingJob.update({
        where: { id: next.id },
        data: {
          status: JobStatus.ERROR,
          lastError: "teacher recording audio is missing",
          finishedAt: new Date(),
        },
      });
      continue;
    }

    return {
      kind: "teacher_recording",
      jobId: next.id,
      recordingId: recording.id,
      audioStorageUrl: recording.audioStorageUrl,
      audioFileName: recording.audioFileName,
      audioMimeType: recording.audioMimeType,
    };
  }
}

async function claimSessionPartTask(sessionId?: string): Promise<RunpodRemoteSessionPartTask | null> {
  await recoverStaleSessionPartTranscriptionJobs(sessionId);
  await requeueRecoverableTranscriptionJobs(sessionId ? { sessionId, types: [SessionPartJobType.TRANSCRIBE_FILE] } : { types: [SessionPartJobType.TRANSCRIBE_FILE] });

  while (true) {
    const next = await prisma.sessionPartJob.findFirst({
      where: {
        status: JobStatus.QUEUED,
        type: SessionPartJobType.TRANSCRIBE_FILE,
        sessionPart: {
          storageUrl: {
            not: null,
          },
          ...(sessionId ? { sessionId } : {}),
        },
      },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        sessionPartId: true,
        sessionPart: {
          select: {
            id: true,
            sessionId: true,
            storageUrl: true,
            fileName: true,
            mimeType: true,
            qualityMetaJson: true,
            session: {
              select: {
                type: true,
              },
            },
          },
        },
      },
    });
    if (!next) {
      return null;
    }

    if (!next.sessionPart.storageUrl) {
      await prisma.sessionPartJob.update({
        where: { id: next.id },
        data: {
          status: JobStatus.ERROR,
          lastError: "session part storage is missing",
          finishedAt: new Date(),
        },
      });
      continue;
    }

    const claimed = await prisma.sessionPartJob.updateMany({
      where: {
        id: next.id,
        status: JobStatus.QUEUED,
      },
      data: {
        status: JobStatus.RUNNING,
        attempts: { increment: 1 },
        startedAt: new Date(),
        finishedAt: null,
        lastError: null,
      },
    });
    if (claimed.count === 0) {
      continue;
    }

    return {
      kind: "session_part_transcription",
      jobId: next.id,
      sessionPartId: next.sessionPartId,
      sessionId: next.sessionPart.sessionId,
      storageUrl: next.sessionPart.storageUrl,
      fileName: next.sessionPart.fileName,
      mimeType: next.sessionPart.mimeType,
      qualityMetaJson: readSessionPartQualityMeta(next.sessionPart.qualityMetaJson),
      sessionType: next.sessionPart.session.type,
    };
  }
}

export async function claimNextRunpodRemoteSttTask(scope?: {
  sessionId?: string;
}): Promise<RunpodRemoteSttTask | null> {
  const teacherRecordingTask = await claimTeacherRecordingTask();
  if (teacherRecordingTask) {
    return teacherRecordingTask;
  }
  return claimSessionPartTask(scope?.sessionId);
}

async function completeTeacherRecordingFailure(jobId: string, failure: RunpodRemoteTaskFailure) {
  const job = await prisma.teacherRecordingJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      attempts: true,
      maxAttempts: true,
      executionId: true,
      recordingSessionId: true,
    },
  });
  if (!job) {
    return;
  }

  const shouldRetry = (job.attempts ?? 0) < (job.maxAttempts ?? 3);
  await prisma.teacherRecordingSession.update({
    where: { id: job.recordingSessionId },
    data: {
      status: shouldRetry
        ? TeacherRecordingSessionStatus.TRANSCRIBING
        : TeacherRecordingSessionStatus.ERROR,
      errorMessage: failure.errorMessage,
    },
  }).catch(() => {});
  await prisma.teacherRecordingJob.update({
    where: { id: job.id },
    data: {
      status: shouldRetry ? JobStatus.QUEUED : JobStatus.ERROR,
      executionId: shouldRetry ? null : job.executionId,
      lastError: failure.errorMessage,
      outputJson: shouldRetry ? Prisma.DbNull : undefined,
      costMetaJson: shouldRetry ? Prisma.DbNull : undefined,
      startedAt: shouldRetry ? null : undefined,
      finishedAt: shouldRetry ? null : new Date(),
    },
  });
  if (job.executionId) {
    await releaseTeacherRecordingLease(job.recordingSessionId, job.executionId).catch(() => {});
  }
  await maybeStopRunpodWorkerWhenGpuQueuesIdle().catch(() => {});
}

async function completeTeacherRecordingSuccess(jobId: string, result: TeacherRecordingTranscriptionResult) {
  const job = await prisma.teacherRecordingJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      executionId: true,
      recordingSessionId: true,
      recordingSession: {
        select: {
          organizationId: true,
        },
      },
    },
  });
  if (!job?.recordingSession) {
    return;
  }

  await applyTeacherRecordingTranscriptionResult({
    recordingId: job.recordingSessionId,
    organizationId: job.recordingSession.organizationId,
    result,
  });
  await prisma.teacherRecordingJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      outputJson: toPrismaJson(result.outputJson),
      costMetaJson: toPrismaJson(result.costMetaJson),
      finishedAt: new Date(),
    },
  });
  if (job.executionId) {
    await releaseTeacherRecordingLease(job.recordingSessionId, job.executionId).catch(() => {});
  }
  await maybeStopRunpodWorkerWhenGpuQueuesIdle().catch(() => {});
}

async function completeSessionPartFailure(jobId: string, failure: RunpodRemoteTaskFailure) {
  const job = await prisma.sessionPartJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      attempts: true,
      sessionPartId: true,
    },
  });
  if (!job) {
    return;
  }

  const attempts = job.attempts ?? 1;
  const recovery = getSessionPartRecoveryPlan(SessionPartJobType.TRANSCRIBE_FILE, failure.errorMessage, attempts);
  await prisma.sessionPartJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.ERROR,
      lastError: failure.errorMessage,
      finishedAt: new Date(),
    },
  });
  const part = await loadSessionPart({
    id: job.id,
    sessionPartId: job.sessionPartId,
    type: SessionPartJobType.TRANSCRIBE_FILE,
  }).catch(() => null);
  if (part) {
    if (recovery.canRetry) {
      await markPartRecoveringForRetry(
        part,
        SessionPartJobType.TRANSCRIBE_FILE,
        failure.errorMessage,
        attempts,
        recovery.maxAttempts
      ).catch(() => {});
    } else {
      await markPartExecutionError(part, failure.errorMessage).catch(() => {});
    }
  }
  await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch(() => {});
}

async function completeSessionPartSuccess(jobId: string, result: SessionPartTranscriptionResult) {
  const job = await prisma.sessionPartJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      sessionPartId: true,
    },
  });
  if (!job) {
    return;
  }

  const payload: SessionPartJobPayload = {
    id: job.id,
    sessionPartId: job.sessionPartId,
    type: SessionPartJobType.TRANSCRIBE_FILE,
  };
  const part = await loadSessionPart(payload);
  await applySessionPartTranscriptionOutcome({
    job: payload,
    part,
    outcome: result,
  });
  await processQueuedSessionPartJobs(4, 1, {
    sessionId: part.sessionId,
    types: [SessionPartJobType.PROMOTE_SESSION],
  });
  await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch(() => {});
}

export async function completeRunpodRemoteSttTask(input:
  | {
      taskKind: "teacher_recording";
      jobId: string;
      result: TeacherRecordingTranscriptionResult | RunpodRemoteTaskFailure;
    }
  | {
      taskKind: "session_part_transcription";
      jobId: string;
      result: SessionPartTranscriptionResult | RunpodRemoteTaskFailure;
    }) {
  if (input.taskKind === "teacher_recording") {
    if (input.result.kind === "error") {
      await completeTeacherRecordingFailure(input.jobId, input.result);
      return;
    }
    await completeTeacherRecordingSuccess(input.jobId, input.result);
    return;
  }

  if (input.result.kind === "error") {
    await completeSessionPartFailure(input.jobId, input.result);
    return;
  }
  await completeSessionPartSuccess(input.jobId, input.result);
}
