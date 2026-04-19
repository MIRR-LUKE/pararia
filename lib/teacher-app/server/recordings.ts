import { randomUUID } from "node:crypto";
import { JobStatus, Prisma, TeacherRecordingJobType, TeacherRecordingSessionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { saveStorageBuffer, materializeStorageFile } from "@/lib/audio-storage";
import { buildTeacherRecordingUploadPathname, sanitizeStorageFileName } from "@/lib/audio-storage-paths";
import { toPrismaJson } from "@/lib/prisma-json";
import { transcribeAudioForPipeline } from "@/lib/ai/stt";
import { normalizeRawTranscriptText } from "@/lib/transcript/source";
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

type TeacherRecordingRow = Awaited<ReturnType<typeof loadTeacherRecordingRow>>;

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

async function loadTeacherRecordingRow(recordingId: string, organizationId: string, deviceLabel?: string) {
  return prisma.teacherRecordingSession.findFirst({
    where: {
      id: recordingId,
      organizationId,
      ...(deviceLabel ? { deviceLabel } : {}),
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
    deviceLabel?: string;
  }
) {
  return prisma.teacherRecordingSession.findFirst({
    where: {
      id: recordingId,
      ...(filters?.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters?.deviceLabel ? { deviceLabel: filters.deviceLabel } : {}),
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
      deviceLabel: session.deviceLabel,
      status: TeacherRecordingSessionStatus.RECORDING,
      recordedAt: new Date(),
    },
  });
  return created.id;
}

export async function cancelTeacherRecordingSession(input: {
  organizationId: string;
  deviceLabel: string;
  recordingId: string;
}) {
  await prisma.teacherRecordingSession.updateMany({
    where: {
      id: input.recordingId,
      organizationId: input.organizationId,
      deviceLabel: input.deviceLabel,
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
  deviceLabel: string;
  recordingId: string;
}) {
  const recording = await loadTeacherRecordingRow(input.recordingId, input.organizationId, input.deviceLabel);
  if (!recording) return null;
  return toTeacherRecordingSummary(recording);
}

export async function loadLatestActiveTeacherRecording(organizationId: string, deviceLabel: string) {
  const recording = await prisma.teacherRecordingSession.findFirst({
    where: {
      organizationId,
      deviceLabel,
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
  deviceLabel: string;
  recordingId: string;
  file: File;
  durationSecondsHint?: number | null;
}) {
  const recording = await loadTeacherRecordingForProcessing(input.recordingId, {
    organizationId: input.organizationId,
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
  deviceLabel: string;
  recordingId: string;
  studentId: string | null;
}) {
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

  const updated = await prisma.teacherRecordingSession.updateMany({
    where: {
      id: input.recordingId,
      organizationId: input.organizationId,
      deviceLabel: input.deviceLabel,
      status: TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
    },
    data: {
      status: TeacherRecordingSessionStatus.STUDENT_CONFIRMED,
      selectedStudentId: input.studentId,
      confirmedAt: new Date(),
      errorMessage: null,
    },
  });
  if (updated.count <= 0) {
    throw new Error("この録音は確認できる状態ではありません。");
  }
}

async function upsertTeacherRecordingJob(
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

async function acquireTeacherRecordingLease(recordingId: string, executionId: string) {
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

async function releaseTeacherRecordingLease(recordingId: string, executionId: string) {
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
    const materialized = await materializeStorageFile(recording.audioStorageUrl, {
      fileName: recording.audioFileName,
    });
    try {
      const stt = await transcribeAudioForPipeline({
        filePath: materialized.filePath,
        filename: recording.audioFileName,
        mimeType: recording.audioMimeType || "audio/webm",
      });
      const transcriptText = normalizeRawTranscriptText(stt.rawTextOriginal);
      if (!transcriptText) {
        throw new Error("文字起こし結果が空でした。");
      }

      const students = await prisma.student.findMany({
        where: {
          organizationId: recording.organizationId,
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
        transcriptText,
        students,
      });

      await prisma.teacherRecordingSession.update({
        where: { id: recording.id },
        data: {
          status: TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
          transcriptText,
          transcriptSegmentsJson: toPrismaJson(stt.segments),
          transcriptMetaJson: toPrismaJson(stt.meta),
          suggestedStudentsJson: toPrismaJson(candidates),
          analyzedAt: new Date(),
          errorMessage: null,
        },
      });
    } finally {
      await materialized.cleanup();
    }

    return loadTeacherRecordingSummary({
      organizationId: recording.organizationId,
      deviceLabel: recording.deviceLabel,
      recordingId: recording.id,
    });
  } finally {
    await releaseTeacherRecordingLease(recording.id, executionId);
  }
}
