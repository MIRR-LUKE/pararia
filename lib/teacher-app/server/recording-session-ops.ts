import {
  ConversationSourceType,
  JobStatus,
  Prisma,
  SessionPartJobType,
  SessionPartStatus,
  SessionPartType,
  SessionStatus,
  SessionType,
  TeacherRecordingJobType,
  TranscriptReviewState,
} from "@prisma/client";
import { buildSummaryPreview, toSessionPartMetaJson } from "@/lib/session-part-meta";
import { getTranscriptExpiryDate } from "@/lib/system-config";

export async function findReusableInterviewSessionId(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    studentId: string;
  }
) {
  const existing = await tx.session.findFirst({
    where: {
      organizationId: input.organizationId,
      studentId: input.studentId,
      type: SessionType.INTERVIEW,
      status: SessionStatus.DRAFT,
      conversation: {
        is: null,
      },
      parts: {
        none: {},
      },
    },
    orderBy: [{ sessionDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
    },
  });
  return existing?.id ?? null;
}

export async function upsertTeacherRecordingSessionPart(
  tx: Prisma.TransactionClient,
  input: {
    sessionId: string;
    recordingId: string;
    deviceLabel: string;
    fileName: string | null;
    mimeType: string | null;
    byteSize: number | null;
    storageUrl: string;
    transcriptText: string;
    displayTranscript: string;
    transcriptSegmentsJson: Prisma.JsonValue | null;
    transcriptMetaJson: Prisma.JsonValue | null;
    confirmedAt: Date;
  }
) {
  const summaryPreview = buildSummaryPreview(input.displayTranscript || input.transcriptText);
  const qualityMeta = toSessionPartMetaJson(
    {
      teacherAppTranscriptMeta: input.transcriptMetaJson ?? null,
    },
    {
      pipelineStage: "READY",
      uploadMode: "direct_recording",
      lastAcceptedAt: input.confirmedAt.toISOString(),
      lastCompletedAt: input.confirmedAt.toISOString(),
      summaryPreview,
      teacherAppRecordingId: input.recordingId,
      teacherAppDeviceLabel: input.deviceLabel,
    }
  );

  const existing = await tx.sessionPart.findUnique({
    where: {
      sessionId_partType: {
        sessionId: input.sessionId,
        partType: SessionPartType.FULL,
      },
    },
    select: {
      id: true,
    },
  });

  const data = {
    partType: SessionPartType.FULL,
    sourceType: ConversationSourceType.AUDIO,
    status: SessionPartStatus.READY,
    fileName: input.fileName,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    storageUrl: input.storageUrl,
    rawTextOriginal: input.transcriptText,
    rawTextCleaned: input.displayTranscript,
    reviewedText: null,
    reviewState: TranscriptReviewState.NONE,
    rawSegments: input.transcriptSegmentsJson ?? Prisma.JsonNull,
    qualityMetaJson: qualityMeta,
    transcriptExpiresAt: getTranscriptExpiryDate(),
  };

  if (existing) {
    return tx.sessionPart.update({
      where: { id: existing.id },
      data,
      select: { id: true },
    });
  }

  return tx.sessionPart.create({
    data: {
      sessionId: input.sessionId,
      ...data,
    },
    select: { id: true },
  });
}

export async function upsertTeacherPromotionJob(tx: Prisma.TransactionClient, sessionPartId: string) {
  const existing = await tx.sessionPartJob.findUnique({
    where: {
      sessionPartId_type: {
        sessionPartId,
        type: SessionPartJobType.PROMOTE_SESSION,
      },
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (existing && (existing.status === JobStatus.QUEUED || existing.status === JobStatus.RUNNING)) {
    return tx.sessionPartJob.findUniqueOrThrow({
      where: { id: existing.id },
    });
  }

  if (existing) {
    return tx.sessionPartJob.update({
      where: { id: existing.id },
      data: {
        status: JobStatus.QUEUED,
        lastError: null,
        outputJson: Prisma.DbNull,
        costMetaJson: Prisma.DbNull,
        startedAt: null,
        finishedAt: null,
      },
    });
  }

  return tx.sessionPartJob.create({
    data: {
      sessionPartId,
      type: SessionPartJobType.PROMOTE_SESSION,
      status: JobStatus.QUEUED,
    },
  });
}

export async function upsertTeacherRecordingJob(
  tx: Prisma.TransactionClient,
  recordingId: string,
  organizationId: string,
  type: TeacherRecordingJobType
) {
  const existing = await tx.teacherRecordingJob.findUnique({
    where: {
      recordingSessionId_type: {
        recordingSessionId: recordingId,
        type,
      },
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (existing && (existing.status === JobStatus.QUEUED || existing.status === JobStatus.RUNNING)) {
    return tx.teacherRecordingJob.findUniqueOrThrow({
      where: { id: existing.id },
    });
  }

  if (existing) {
    return tx.teacherRecordingJob.update({
      where: { id: existing.id },
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
  }

  return tx.teacherRecordingJob.create({
    data: {
      organizationId,
      recordingSessionId: recordingId,
      type,
      status: JobStatus.QUEUED,
    },
  });
}
