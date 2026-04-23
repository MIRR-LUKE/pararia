import { randomUUID } from "node:crypto";
import {
  Prisma,
  SessionType,
  TeacherRecordingJobType,
  TeacherRecordingSessionStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { saveStorageBuffer } from "@/lib/audio-storage";
import { buildTeacherRecordingUploadPathname, sanitizeStorageFileName } from "@/lib/audio-storage-paths";
import { toPrismaJson } from "@/lib/prisma-json";
import { processAllSessionPartJobs } from "@/lib/jobs/sessionPartJobs";
import { evaluateTranscriptSubstance } from "@/lib/recording/validation";
import { maybeStopRunpodWorkerWhenGpuQueuesIdle } from "@/lib/runpod/idle-stop";
import { transcribeTeacherRecordingTask, type TeacherRecordingTranscriptionResult } from "@/lib/runpod/stt/teacher-recording-task";
import { updateSessionStatusFromParts } from "@/lib/session-service";
import { ensureSessionPartReviewedTranscript } from "@/lib/transcript/review-service";
import { preprocessTranscript } from "@/lib/transcript/preprocess";
import { normalizeRawTranscriptText } from "@/lib/transcript/source";
import {
  findReusableInterviewSessionId,
  upsertTeacherPromotionJob,
  upsertTeacherRecordingJob,
  upsertTeacherRecordingSessionPart,
} from "@/lib/teacher-app/server/recording-session-ops";
import { buildTeacherStudentCandidates } from "@/lib/teacher-app/student-candidates";
import type {
  TeacherAppDeviceSession,
  TeacherRecordingSummary,
  TeacherStudentCandidate,
} from "@/lib/teacher-app/types";

const TEACHER_RECORDING_LEASE_MS = 30 * 60 * 1000;
const ACTIVE_TEACHER_RECORDING_STATUSES = [
  TeacherRecordingSessionStatus.TRANSCRIBING,
  TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
];

export type TeacherRecordingConfirmationResult = {
  state: "promoted" | "saved_without_student";
  sessionId: string | null;
  conversationId: string | null;
  alreadyConfirmed: boolean;
};

type TeacherRecordingRow = Awaited<ReturnType<typeof loadTeacherRecordingRow>>;

function buildTeacherRecordingDeviceWhere(input: {
  deviceId?: string | null;
  deviceLabel?: string | null;
}) {
  if (input.deviceId) {
    return { deviceId: input.deviceId };
  }
  if (input.deviceLabel) {
    return { deviceLabel: input.deviceLabel };
  }
  return {};
}

function parseCandidatesJson(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return [];
  const parsed = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const current = item as Record<string, unknown>;
      if (typeof current.id !== "string" || typeof current.name !== "string") return null;
      const candidate: TeacherStudentCandidate = {
        id: current.id,
        name: current.name,
        subtitle: typeof current.subtitle === "string" ? current.subtitle : null,
        score: typeof current.score === "number" ? current.score : null,
        reason: typeof current.reason === "string" ? current.reason : null,
      };
      return candidate;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
  return parsed;
}

function toTeacherRecordingSummary(recording: NonNullable<TeacherRecordingRow>): TeacherRecordingSummary {
  return {
    id: recording.id,
    status: recording.status,
    deviceLabel: recording.deviceLabel,
    recordedAt: recording.recordedAt?.toISOString() ?? null,
    uploadedAt: recording.uploadedAt?.toISOString() ?? null,
    analyzedAt: recording.analyzedAt?.toISOString() ?? null,
    confirmedAt: recording.confirmedAt?.toISOString() ?? null,
    durationSeconds: typeof recording.durationSeconds === "number" ? recording.durationSeconds : null,
    transcriptText: normalizeRawTranscriptText(recording.transcriptText),
    candidates: parseCandidatesJson(recording.suggestedStudentsJson),
    errorMessage: recording.errorMessage ?? null,
  };
}

async function loadTeacherRecordingRow(
  recordingId: string,
  organizationId: string,
  deviceScope?: { deviceId?: string | null; deviceLabel?: string | null }
) {
  return prisma.teacherRecordingSession.findFirst({
    where: {
      id: recordingId,
      organizationId,
      ...buildTeacherRecordingDeviceWhere(deviceScope ?? {}),
    },
    select: {
      id: true,
      organizationId: true,
      status: true,
      deviceLabel: true,
      audioFileName: true,
      audioMimeType: true,
      audioByteSize: true,
      audioStorageUrl: true,
      durationSeconds: true,
      transcriptText: true,
      transcriptSegmentsJson: true,
      transcriptMetaJson: true,
      suggestedStudentsJson: true,
      errorMessage: true,
      recordedAt: true,
      uploadedAt: true,
      analyzedAt: true,
      confirmedAt: true,
      processingLeaseExecutionId: true,
      processingLeaseExpiresAt: true,
      createdAt: true,
      updatedAt: true,
      selectedStudentId: true,
      jobs: {
        select: {
          id: true,
          type: true,
          status: true,
          attempts: true,
          maxAttempts: true,
          lastError: true,
        },
      },
    },
  });
}

async function loadTeacherRecordingForProcessing(
  recordingId: string,
  filters?: {
    organizationId?: string;
    deviceId?: string | null;
    deviceLabel?: string | null;
  }
) {
  return prisma.teacherRecordingSession.findFirst({
    where: {
      id: recordingId,
      ...(filters?.organizationId ? { organizationId: filters.organizationId } : {}),
      ...buildTeacherRecordingDeviceWhere(filters ?? {}),
    },
    select: {
      id: true,
      organizationId: true,
      status: true,
      deviceLabel: true,
      audioFileName: true,
      audioMimeType: true,
      audioStorageUrl: true,
      durationSeconds: true,
      processingLeaseExecutionId: true,
      processingLeaseExpiresAt: true,
    },
  });
}

export async function createTeacherRecordingSession(session: TeacherAppDeviceSession) {
  const created = await prisma.teacherRecordingSession.create({
    data: {
      organizationId: session.organizationId,
      createdByUserId: session.userId,
      deviceId: session.deviceId,
      deviceLabel: session.deviceLabel,
      status: TeacherRecordingSessionStatus.RECORDING,
      recordedAt: new Date(),
    },
  });
  return created.id;
}

export async function cancelTeacherRecordingSession(input: {
  organizationId: string;
  deviceId: string;
  recordingId: string;
}) {
  await prisma.teacherRecordingSession.updateMany({
    where: {
      id: input.recordingId,
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      status: TeacherRecordingSessionStatus.RECORDING,
    },
    data: {
      status: TeacherRecordingSessionStatus.CANCELLED,
      errorMessage: null,
    },
  });
}

export async function loadTeacherRecordingSummary(input: {
  organizationId: string;
  deviceId?: string | null;
  deviceLabel?: string | null;
  recordingId: string;
}) {
  const recording = await loadTeacherRecordingRow(input.recordingId, input.organizationId, {
    deviceId: input.deviceId,
    deviceLabel: input.deviceLabel,
  });
  if (!recording) return null;
  return toTeacherRecordingSummary(recording);
}

export async function loadLatestActiveTeacherRecording(
  organizationId: string,
  deviceScope: { deviceId?: string | null; deviceLabel?: string | null }
) {
  const recording = await prisma.teacherRecordingSession.findFirst({
    where: {
      organizationId,
      ...buildTeacherRecordingDeviceWhere(deviceScope),
      status: {
        in: ACTIVE_TEACHER_RECORDING_STATUSES,
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      organizationId: true,
      status: true,
      deviceLabel: true,
      audioFileName: true,
      audioMimeType: true,
      audioByteSize: true,
      audioStorageUrl: true,
      durationSeconds: true,
      transcriptText: true,
      transcriptSegmentsJson: true,
      transcriptMetaJson: true,
      suggestedStudentsJson: true,
      errorMessage: true,
      recordedAt: true,
      uploadedAt: true,
      analyzedAt: true,
      confirmedAt: true,
      processingLeaseExecutionId: true,
      processingLeaseExpiresAt: true,
      createdAt: true,
      updatedAt: true,
      selectedStudentId: true,
      jobs: {
        select: {
          id: true,
          type: true,
          status: true,
          attempts: true,
          maxAttempts: true,
          lastError: true,
        },
      },
    },
  });
  return recording ? toTeacherRecordingSummary(recording) : null;
}

export async function uploadTeacherRecordingAudio(input: {
  organizationId: string;
  deviceId?: string | null;
  deviceLabel?: string | null;
  recordingId: string;
  file: File;
  durationSecondsHint?: number | null;
}) {
  const recording = await loadTeacherRecordingForProcessing(input.recordingId, {
    organizationId: input.organizationId,
    deviceId: input.deviceId,
    deviceLabel: input.deviceLabel,
  });
  if (!recording || recording.organizationId !== input.organizationId) {
    throw new Error("録音セッションが見つかりません。");
  }
  if (recording.status !== TeacherRecordingSessionStatus.RECORDING) {
    if (recording.status === TeacherRecordingSessionStatus.CANCELLED) {
      throw new Error("この録音はすでに中止されています。最初からやり直してください。");
    }
    throw new Error("この録音はすでに送信済みです。最初からやり直してください。");
  }

  const safeFileName = sanitizeStorageFileName(input.file.name || "teacher-recording.webm");
  const storage = await saveStorageBuffer({
    storagePathname: buildTeacherRecordingUploadPathname(input.recordingId, safeFileName),
    buffer: Buffer.from(await input.file.arrayBuffer()),
    contentType: input.file.type || "audio/webm",
  });
  const uploadedAt = new Date();

  return prisma.$transaction(async (tx) => {
    await tx.teacherRecordingSession.update({
      where: { id: input.recordingId },
      data: {
        status: TeacherRecordingSessionStatus.TRANSCRIBING,
        audioFileName: safeFileName,
        audioMimeType: input.file.type || "audio/webm",
        audioByteSize: input.file.size,
        audioStorageUrl: storage.storageUrl,
        durationSeconds:
          typeof input.durationSecondsHint === "number" && Number.isFinite(input.durationSecondsHint)
            ? input.durationSecondsHint
            : null,
        uploadedAt,
        errorMessage: null,
      },
    });

    return upsertTeacherRecordingJob(tx, input.recordingId, input.organizationId, TeacherRecordingJobType.TRANSCRIBE_AND_SUGGEST);
  });
}

export async function confirmTeacherRecordingStudent(input: {
  organizationId: string;
  deviceId?: string | null;
  deviceLabel?: string | null;
  recordingId: string;
  studentId: string | null;
}) {
  const existing = await prisma.teacherRecordingSession.findFirst({
    where: {
      id: input.recordingId,
      organizationId: input.organizationId,
      ...buildTeacherRecordingDeviceWhere(input),
    },
    select: {
      id: true,
      status: true,
      selectedStudentId: true,
      promotedSessionId: true,
      promotedConversationId: true,
    },
  });
  if (!existing) {
    throw new Error("録音セッションが見つかりません。");
  }
  if (
    existing.status === TeacherRecordingSessionStatus.STUDENT_CONFIRMED &&
    (existing.selectedStudentId ?? null) === (input.studentId ?? null)
  ) {
    return {
      state: input.studentId ? "promoted" : "saved_without_student",
      sessionId: existing.promotedSessionId ?? null,
      conversationId: existing.promotedConversationId ?? null,
      alreadyConfirmed: true,
    } satisfies TeacherRecordingConfirmationResult;
  }
  if (existing.status !== TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION) {
    throw new Error("この録音は確認できる状態ではありません。");
  }

  if (input.studentId) {
    const student = await prisma.student.findFirst({
      where: {
        id: input.studentId,
        organizationId: input.organizationId,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!student) {
      throw new Error("生徒が見つかりません。");
    }
  }

  const confirmedAt = new Date();

  if (!input.studentId) {
    await prisma.teacherRecordingSession.update({
      where: { id: input.recordingId },
      data: {
        status: TeacherRecordingSessionStatus.STUDENT_CONFIRMED,
        selectedStudentId: null,
        confirmedAt,
        errorMessage: null,
      },
    });
    return {
      state: "saved_without_student",
      sessionId: null,
      conversationId: null,
      alreadyConfirmed: false,
    } satisfies TeacherRecordingConfirmationResult;
  }

  const selectedStudentId = input.studentId;

  const promotion = await prisma.$transaction(async (tx) => {
    const recording = await tx.teacherRecordingSession.findFirst({
      where: {
        id: input.recordingId,
        organizationId: input.organizationId,
        ...buildTeacherRecordingDeviceWhere(input),
        status: TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
      },
      select: {
        id: true,
        organizationId: true,
        createdByUserId: true,
        deviceLabel: true,
        audioFileName: true,
        audioMimeType: true,
        audioByteSize: true,
        audioStorageUrl: true,
        transcriptText: true,
        transcriptSegmentsJson: true,
        transcriptMetaJson: true,
        recordedAt: true,
      },
    });
    if (!recording) {
      throw new Error("この録音は確認できる状態ではありません。");
    }

    const transcriptText = normalizeRawTranscriptText(recording.transcriptText);
    if (!transcriptText) {
      throw new Error("文字起こし結果が見つかりません。");
    }
    const preprocessed = preprocessTranscript(transcriptText);
    const substance = evaluateTranscriptSubstance(preprocessed.rawTextOriginal);
    if (!substance.ok) {
      throw new Error(substance.messageJa);
    }
    if (!recording.audioStorageUrl) {
      throw new Error("録音データが見つかりません。");
    }

    const targetSessionId = await findReusableInterviewSessionId(tx, {
      organizationId: input.organizationId,
      studentId: selectedStudentId,
    });
    const sessionId =
      targetSessionId ??
      (
        await tx.session.create({
          data: {
            organizationId: input.organizationId,
            studentId: selectedStudentId,
            userId: recording.createdByUserId ?? undefined,
            type: SessionType.INTERVIEW,
            sessionDate: recording.recordedAt ?? confirmedAt,
          },
          select: { id: true },
        })
      ).id;

    const part = await upsertTeacherRecordingSessionPart(tx, {
      sessionId,
      recordingId: recording.id,
      deviceLabel: recording.deviceLabel,
      fileName: recording.audioFileName,
      mimeType: recording.audioMimeType,
      byteSize: recording.audioByteSize,
      storageUrl: recording.audioStorageUrl,
      transcriptText: preprocessed.rawTextOriginal,
      displayTranscript: preprocessed.displayTranscript,
      transcriptSegmentsJson: recording.transcriptSegmentsJson,
      transcriptMetaJson: recording.transcriptMetaJson,
      confirmedAt,
    });

    await tx.teacherRecordingSession.update({
      where: { id: input.recordingId },
      data: {
        status: TeacherRecordingSessionStatus.STUDENT_CONFIRMED,
        selectedStudentId,
        confirmedAt,
        promotionTriggeredAt: confirmedAt,
        promotedSessionId: sessionId,
        errorMessage: null,
      },
    });

    await upsertTeacherPromotionJob(tx, part.id);

    return {
      sessionId,
      sessionPartId: part.id,
    };
  });

  await updateSessionStatusFromParts(promotion.sessionId).catch(() => {});
  await ensureSessionPartReviewedTranscript(promotion.sessionPartId).catch((error) => {
    console.error("[teacher-recordings] failed to build reviewed transcript", {
      recordingId: input.recordingId,
      sessionPartId: promotion.sessionPartId,
      error,
    });
  });
  const sessionPartProcessing = await processAllSessionPartJobs(promotion.sessionId).catch((error) => {
    console.error("[teacher-recordings] failed to process promoted session parts", {
      recordingId: input.recordingId,
      sessionId: promotion.sessionId,
      error,
    });
    throw error;
  });
  if (sessionPartProcessing.errors.length > 0) {
    throw new Error(sessionPartProcessing.errors[0] || "failed to dispatch promoted conversation jobs");
  }

  const promotedSession = await prisma.session.findUnique({
    where: { id: promotion.sessionId },
    select: {
      id: true,
      conversation: {
        select: { id: true },
      },
    },
  });
  if (promotedSession?.conversation?.id) {
    await prisma.teacherRecordingSession.update({
      where: { id: input.recordingId },
      data: {
        promotedConversationId: promotedSession.conversation.id,
      },
    }).catch(() => {});
  }

  return {
    state: "promoted",
    sessionId: promotion.sessionId,
    conversationId: promotedSession?.conversation?.id ?? null,
    alreadyConfirmed: false,
  } satisfies TeacherRecordingConfirmationResult;
}

export async function acquireTeacherRecordingLease(recordingId: string, executionId: string) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + TEACHER_RECORDING_LEASE_MS);
  const claimed = await prisma.teacherRecordingSession.updateMany({
    where: {
      id: recordingId,
      OR: [
        { processingLeaseExecutionId: null },
        { processingLeaseExpiresAt: null },
        { processingLeaseExpiresAt: { lt: now } },
        { processingLeaseExecutionId: executionId },
      ],
    },
    data: {
      processingLeaseExecutionId: executionId,
      processingLeaseStartedAt: now,
      processingLeaseHeartbeatAt: now,
      processingLeaseExpiresAt: leaseExpiresAt,
    },
  });
  return claimed.count > 0;
}

async function renewTeacherRecordingLease(recordingId: string, executionId: string) {
  await prisma.teacherRecordingSession.updateMany({
    where: {
      id: recordingId,
      processingLeaseExecutionId: executionId,
    },
    data: {
      processingLeaseHeartbeatAt: new Date(),
      processingLeaseExpiresAt: new Date(Date.now() + TEACHER_RECORDING_LEASE_MS),
    },
  });
}

export async function releaseTeacherRecordingLease(recordingId: string, executionId: string) {
  await prisma.teacherRecordingSession.updateMany({
    where: {
      id: recordingId,
      processingLeaseExecutionId: executionId,
    },
    data: {
      processingLeaseExecutionId: null,
      processingLeaseStartedAt: null,
      processingLeaseHeartbeatAt: null,
      processingLeaseExpiresAt: null,
    },
  });
}

export async function applyTeacherRecordingTranscriptionResult(input: {
  recordingId: string;
  organizationId: string;
  result: TeacherRecordingTranscriptionResult;
}) {
  const students = await prisma.student.findMany({
    where: {
      organizationId: input.organizationId,
      archivedAt: null,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      nameKana: true,
      grade: true,
      course: true,
    },
    take: 500,
  });

  const candidates = buildTeacherStudentCandidates({
    transcriptText: input.result.transcriptText,
    students,
  });

  await prisma.teacherRecordingSession.update({
    where: { id: input.recordingId },
    data: {
      status: TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
      transcriptText: input.result.transcriptText,
      transcriptSegmentsJson: toPrismaJson(input.result.segments),
      transcriptMetaJson: toPrismaJson(input.result.meta),
      suggestedStudentsJson: toPrismaJson(candidates),
      analyzedAt: new Date(),
      errorMessage: null,
    },
  });
}

export async function runTeacherRecordingAnalysis(recordingId: string) {
  const recording = await loadTeacherRecordingForProcessing(recordingId);
  if (!recording) {
    throw new Error("teacher recording not found");
  }
  if (recording.status !== TeacherRecordingSessionStatus.TRANSCRIBING) {
    return loadTeacherRecordingSummary({
      organizationId: recording.organizationId,
      deviceLabel: recording.deviceLabel,
      recordingId: recording.id,
    });
  }
  if (!recording.audioStorageUrl || !recording.audioFileName) {
    throw new Error("teacher recording audio is missing");
  }

  const executionId = randomUUID();
  const leaseAcquired = await acquireTeacherRecordingLease(recording.id, executionId);
  if (!leaseAcquired) {
    return loadTeacherRecordingSummary({
      organizationId: recording.organizationId,
      deviceLabel: recording.deviceLabel,
      recordingId: recording.id,
    });
  }

  try {
    await renewTeacherRecordingLease(recording.id, executionId);
    const result = await transcribeTeacherRecordingTask({
      audioStorageUrl: recording.audioStorageUrl,
      audioFileName: recording.audioFileName,
      audioMimeType: recording.audioMimeType,
    });
    await applyTeacherRecordingTranscriptionResult({
      recordingId: recording.id,
      organizationId: recording.organizationId,
      result,
    });

    return loadTeacherRecordingSummary({
      organizationId: recording.organizationId,
      deviceLabel: recording.deviceLabel,
      recordingId: recording.id,
    });
  } finally {
    await releaseTeacherRecordingLease(recording.id, executionId);
    await maybeStopRunpodWorkerWhenGpuQueuesIdle().catch(() => {});
  }
}
