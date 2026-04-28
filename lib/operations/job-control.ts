import {
  ConversationStatus,
  JobStatus,
  Prisma,
  SessionPartStatus,
  SessionStatus,
  TeacherRecordingSessionStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";

export const OPERATION_JOB_KINDS = ["conversation", "session_part", "teacher_recording"] as const;
export type OperationJobKind = (typeof OPERATION_JOB_KINDS)[number];

export const OPERATION_JOB_ACTIONS = ["retry", "cancel"] as const;
export type OperationJobAction = (typeof OPERATION_JOB_ACTIONS)[number];

export class OperationJobControlError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "OperationJobControlError";
    this.status = status;
  }
}

export function normalizeOperationJobKind(raw: string | null | undefined): OperationJobKind | null {
  const value = raw?.trim();
  if (!value) return null;
  return OPERATION_JOB_KINDS.includes(value as OperationJobKind) ? (value as OperationJobKind) : null;
}

export function normalizeOperationJobAction(raw: string | null | undefined): OperationJobAction | null {
  const value = raw?.trim();
  if (!value) return null;
  return OPERATION_JOB_ACTIONS.includes(value as OperationJobAction) ? (value as OperationJobAction) : null;
}

function buildOperatorMessage(action: OperationJobAction, reason: string) {
  const normalizedReason = reason.trim() || "operator_action";
  return action === "retry" ? `operator_retry: ${normalizedReason}` : `operator_cancelled: ${normalizedReason}`;
}

function resetConversationJobData(): Prisma.ConversationJobUpdateInput {
  return {
    status: JobStatus.QUEUED,
    executionId: null,
    attempts: 0,
    lastError: null,
    nextRetryAt: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    failedAt: null,
    completedAt: null,
    lastRunDurationMs: null,
    lastQueueLagMs: null,
    outputJson: Prisma.DbNull,
    costMetaJson: Prisma.DbNull,
    startedAt: null,
    finishedAt: null,
  };
}

function resetSessionPartJobData(): Prisma.SessionPartJobUpdateInput {
  return {
    status: JobStatus.QUEUED,
    attempts: 0,
    lastError: null,
    outputJson: Prisma.DbNull,
    costMetaJson: Prisma.DbNull,
    startedAt: null,
    finishedAt: null,
  };
}

function resetTeacherRecordingJobData(): Prisma.TeacherRecordingJobUpdateInput {
  return {
    status: JobStatus.QUEUED,
    executionId: null,
    attempts: 0,
    lastError: null,
    outputJson: Prisma.DbNull,
    costMetaJson: Prisma.DbNull,
    startedAt: null,
    finishedAt: null,
  };
}

const TEACHER_RECORDING_OPERATION_RETRYABLE_STATUSES = new Set<TeacherRecordingSessionStatus>([
  TeacherRecordingSessionStatus.TRANSCRIBING,
  TeacherRecordingSessionStatus.ERROR,
]);

const TEACHER_RECORDING_OPERATION_CANCELABLE_STATUSES = new Set<TeacherRecordingSessionStatus>([
  TeacherRecordingSessionStatus.RECORDING,
  TeacherRecordingSessionStatus.TRANSCRIBING,
  TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
  TeacherRecordingSessionStatus.ERROR,
]);

export function canOperateTeacherRecordingStatus(
  status: TeacherRecordingSessionStatus,
  action: OperationJobAction
) {
  if (action === "retry") {
    return TEACHER_RECORDING_OPERATION_RETRYABLE_STATUSES.has(status);
  }
  return TEACHER_RECORDING_OPERATION_CANCELABLE_STATUSES.has(status);
}

export function assertTeacherRecordingOperationStatus(
  status: TeacherRecordingSessionStatus,
  action: OperationJobAction
) {
  if (!canOperateTeacherRecordingStatus(status, action)) {
    throw new OperationJobControlError(
      action === "retry"
        ? "この状態のTeacher App録音ジョブは再実行できません。"
        : "この状態のTeacher App録音ジョブはキャンセルできません。",
      409
    );
  }
}

async function operateConversationJob(input: {
  organizationId: string;
  jobId: string;
  action: OperationJobAction;
  reason: string;
}) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.conversationJob.findFirst({
      where: {
        id: input.jobId,
        conversation: {
          organizationId: input.organizationId,
          deletedAt: null,
        },
      },
      select: {
        id: true,
        conversationId: true,
        type: true,
        status: true,
      },
    });
    if (!job) {
      throw new OperationJobControlError("対象の会話ジョブが見つかりません。", 404);
    }

    if (input.action === "retry") {
      await tx.conversationJob.update({
        where: { id: job.id },
        data: resetConversationJobData(),
      });
      await tx.conversationLog.update({
        where: { id: job.conversationId },
        data: {
          status: ConversationStatus.PROCESSING,
          processingLeaseExecutionId: null,
          processingLeaseStartedAt: null,
          processingLeaseHeartbeatAt: null,
          processingLeaseExpiresAt: null,
        },
      });
    } else {
      const now = new Date();
      const message = buildOperatorMessage(input.action, input.reason);
      await tx.conversationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.ERROR,
          executionId: null,
          lastError: message,
          nextRetryAt: null,
          leaseExpiresAt: null,
          lastHeartbeatAt: now,
          failedAt: now,
          finishedAt: now,
        },
      });
      await tx.conversationLog.update({
        where: { id: job.conversationId },
        data: {
          status: ConversationStatus.ERROR,
          processingLeaseExecutionId: null,
          processingLeaseStartedAt: null,
          processingLeaseHeartbeatAt: null,
          processingLeaseExpiresAt: null,
        },
      });
    }

    return {
      kind: "conversation" as const,
      jobId: job.id,
      targetId: job.conversationId,
      jobType: job.type,
      previousStatus: job.status,
      nextStatus: input.action === "retry" ? JobStatus.QUEUED : JobStatus.ERROR,
    };
  });
}

async function operateSessionPartJob(input: {
  organizationId: string;
  jobId: string;
  action: OperationJobAction;
  reason: string;
}) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.sessionPartJob.findFirst({
      where: {
        id: input.jobId,
        sessionPart: {
          session: {
            organizationId: input.organizationId,
          },
        },
      },
      select: {
        id: true,
        sessionPartId: true,
        type: true,
        status: true,
        sessionPart: {
          select: {
            id: true,
            sessionId: true,
          },
        },
      },
    });
    if (!job) {
      throw new OperationJobControlError("対象の音声ジョブが見つかりません。", 404);
    }

    if (input.action === "retry") {
      await tx.sessionPartJob.update({
        where: { id: job.id },
        data: resetSessionPartJobData(),
      });
      await tx.sessionPart.update({
        where: { id: job.sessionPartId },
        data: {
          status: SessionPartStatus.TRANSCRIBING,
        },
      });
      await tx.session.update({
        where: { id: job.sessionPart.sessionId },
        data: {
          status: SessionStatus.PROCESSING,
          sessionPartLeaseExecutionId: null,
          sessionPartLeaseStartedAt: null,
          sessionPartLeaseHeartbeatAt: null,
          sessionPartLeaseExpiresAt: null,
        },
      });
    } else {
      const message = buildOperatorMessage(input.action, input.reason);
      await tx.sessionPartJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.ERROR,
          lastError: message,
          finishedAt: new Date(),
        },
      });
      await tx.sessionPart.update({
        where: { id: job.sessionPartId },
        data: {
          status: SessionPartStatus.ERROR,
        },
      });
      await tx.session.update({
        where: { id: job.sessionPart.sessionId },
        data: {
          status: SessionStatus.ERROR,
          sessionPartLeaseExecutionId: null,
          sessionPartLeaseStartedAt: null,
          sessionPartLeaseHeartbeatAt: null,
          sessionPartLeaseExpiresAt: null,
        },
      });
    }

    return {
      kind: "session_part" as const,
      jobId: job.id,
      targetId: job.sessionPartId,
      sessionId: job.sessionPart.sessionId,
      jobType: job.type,
      previousStatus: job.status,
      nextStatus: input.action === "retry" ? JobStatus.QUEUED : JobStatus.ERROR,
    };
  });
}

async function operateTeacherRecordingJob(input: {
  organizationId: string;
  jobId: string;
  action: OperationJobAction;
  reason: string;
}) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.teacherRecordingJob.findFirst({
      where: {
        id: input.jobId,
        organizationId: input.organizationId,
      },
      select: {
        id: true,
        recordingSessionId: true,
        type: true,
        status: true,
        recordingSession: {
          select: {
            id: true,
            status: true,
            audioStorageUrl: true,
          },
        },
      },
    });
    if (!job) {
      throw new OperationJobControlError("対象のTeacher App録音ジョブが見つかりません。", 404);
    }
    assertTeacherRecordingOperationStatus(job.recordingSession.status, input.action);

    if (input.action === "retry") {
      if (!job.recordingSession.audioStorageUrl) {
        throw new OperationJobControlError("音声ファイルがない録音ジョブは再実行できません。", 409);
      }
      await tx.teacherRecordingJob.update({
        where: { id: job.id },
        data: resetTeacherRecordingJobData(),
      });
      const updated = await tx.teacherRecordingSession.updateMany({
        where: {
          id: job.recordingSessionId,
          status: job.recordingSession.status,
        },
        data: {
          status: TeacherRecordingSessionStatus.TRANSCRIBING,
          errorMessage: null,
          processingLeaseExecutionId: null,
          processingLeaseStartedAt: null,
          processingLeaseHeartbeatAt: null,
          processingLeaseExpiresAt: null,
        },
      });
      if (updated.count === 0) {
        throw new OperationJobControlError("Teacher App録音の状態が更新されています。再読み込みしてください。", 409);
      }
    } else {
      const message = buildOperatorMessage(input.action, input.reason);
      await tx.teacherRecordingJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.ERROR,
          executionId: null,
          lastError: message,
          finishedAt: new Date(),
        },
      });
      const updated = await tx.teacherRecordingSession.updateMany({
        where: {
          id: job.recordingSessionId,
          status: job.recordingSession.status,
        },
        data: {
          status: TeacherRecordingSessionStatus.CANCELLED,
          errorMessage: message,
          processingLeaseExecutionId: null,
          processingLeaseStartedAt: null,
          processingLeaseHeartbeatAt: null,
          processingLeaseExpiresAt: null,
        },
      });
      if (updated.count === 0) {
        throw new OperationJobControlError("Teacher App録音の状態が更新されています。再読み込みしてください。", 409);
      }
    }

    return {
      kind: "teacher_recording" as const,
      jobId: job.id,
      targetId: job.recordingSessionId,
      jobType: job.type,
      previousStatus: job.status,
      nextStatus: input.action === "retry" ? JobStatus.QUEUED : JobStatus.ERROR,
    };
  });
}

export async function applyOperationJobAction(input: {
  organizationId: string;
  jobId: string;
  kind: OperationJobKind;
  action: OperationJobAction;
  reason: string;
}) {
  if (input.kind === "conversation") return operateConversationJob(input);
  if (input.kind === "session_part") return operateSessionPartJob(input);
  return operateTeacherRecordingJob(input);
}
