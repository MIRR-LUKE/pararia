import { randomUUID } from "node:crypto";
import { TeacherRecordingSessionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { maybeStopRunpodWorkerWhenGpuQueuesIdle } from "@/lib/runpod/idle-stop";
import { transcribeTeacherRecordingTask, type TeacherRecordingTranscriptionResult } from "@/lib/runpod/stt/teacher-recording-task";
import { toPrismaJson } from "@/lib/prisma-json";
import {
  acquireTeacherRecordingLease,
  releaseTeacherRecordingLease,
  renewTeacherRecordingLease,
} from "@/lib/teacher-app/server/recording-lease-service";
import { notifyTeacherRecordingReady } from "@/lib/teacher-app/server/recording-notifications";
import { loadTeacherRecordingSummary } from "@/lib/teacher-app/server/recording-session-service";
import { loadTeacherRecordingForProcessing } from "@/lib/teacher-app/server/recording-summary-presenter";
import { updateTeacherRecordingStatus } from "@/lib/teacher-app/server/recording-status";
import { buildTeacherStudentCandidates } from "@/lib/teacher-app/student-candidates";

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

  await prisma.$transaction(async (tx) => {
    await updateTeacherRecordingStatus(tx, {
      recordingId: input.recordingId,
      from: TeacherRecordingSessionStatus.TRANSCRIBING,
      to: TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
      where: {
        organizationId: input.organizationId,
      },
      data: {
        transcriptText: input.result.transcriptText,
        transcriptSegmentsJson: toPrismaJson(input.result.segments),
        transcriptMetaJson: toPrismaJson(input.result.meta),
        suggestedStudentsJson: toPrismaJson(candidates),
        analyzedAt: new Date(),
        errorMessage: null,
      },
    });
  });

  await notifyTeacherRecordingReady({
    recordingId: input.recordingId,
    organizationId: input.organizationId,
  }).catch((error) => {
    console.warn("[teacher-recording-notifications] ready notification failed", {
      recordingId: input.recordingId,
      error: error instanceof Error ? error.message : String(error),
    });
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
