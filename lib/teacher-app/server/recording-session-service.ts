import { TeacherRecordingSessionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  buildTeacherRecordingDeviceWhere,
  loadTeacherRecordingRow,
  TEACHER_RECORDING_SUMMARY_SELECT,
  toTeacherRecordingSummary,
} from "@/lib/teacher-app/server/recording-summary-presenter";
import { updateTeacherRecordingStatus } from "@/lib/teacher-app/server/recording-status";
import type { TeacherAppDeviceSession } from "@/lib/teacher-app/types";

const ACTIVE_TEACHER_RECORDING_STATUSES = [
  TeacherRecordingSessionStatus.TRANSCRIBING,
  TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
];

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
  await prisma.$transaction(async (tx) => {
    await updateTeacherRecordingStatus(tx, {
      recordingId: input.recordingId,
      from: TeacherRecordingSessionStatus.RECORDING,
      to: TeacherRecordingSessionStatus.CANCELLED,
      where: {
        organizationId: input.organizationId,
        deviceId: input.deviceId,
      },
      data: {
        errorMessage: null,
      },
    });
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
    select: TEACHER_RECORDING_SUMMARY_SELECT,
  });
  return recording ? toTeacherRecordingSummary(recording) : null;
}
