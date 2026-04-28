import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeRawTranscriptText } from "@/lib/transcript/source";
import type { TeacherRecordingSummary, TeacherStudentCandidate } from "@/lib/teacher-app/types";

export const TEACHER_RECORDING_SUMMARY_SELECT = {
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
} satisfies Prisma.TeacherRecordingSessionSelect;

export type TeacherRecordingRow = Prisma.TeacherRecordingSessionGetPayload<{
  select: typeof TEACHER_RECORDING_SUMMARY_SELECT;
}>;

export function buildTeacherRecordingDeviceWhere(input: {
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

export function toTeacherRecordingSummary(recording: TeacherRecordingRow): TeacherRecordingSummary {
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

export async function loadTeacherRecordingRow(
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
    select: TEACHER_RECORDING_SUMMARY_SELECT,
  });
}

export async function loadTeacherRecordingForProcessing(
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
