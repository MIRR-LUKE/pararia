import { SessionType, TeacherRecordingSessionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { processAllSessionPartJobs } from "@/lib/jobs/sessionPartJobs";
import { evaluateTranscriptSubstance } from "@/lib/recording/validation";
import { updateSessionStatusFromParts } from "@/lib/session-service";
import {
  upsertTeacherPromotionJob,
  upsertTeacherRecordingSessionPart,
} from "@/lib/teacher-app/server/recording-session-ops";
import { buildTeacherRecordingDeviceWhere } from "@/lib/teacher-app/server/recording-summary-presenter";
import { updateTeacherRecordingStatus } from "@/lib/teacher-app/server/recording-status";
import { preprocessTranscript } from "@/lib/transcript/preprocess";
import { ensureSessionPartReviewedTranscript } from "@/lib/transcript/review-service";
import { normalizeRawTranscriptText } from "@/lib/transcript/source";

export type TeacherRecordingConfirmationResult = {
  state: "promoted" | "saved_without_student";
  sessionId: string | null;
  conversationId: string | null;
  alreadyConfirmed: boolean;
  followUpDispatchOk?: boolean;
  followUpDispatchError?: string | null;
};

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
    await prisma.$transaction(async (tx) => {
      await updateTeacherRecordingStatus(tx, {
        recordingId: input.recordingId,
        from: TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
        to: TeacherRecordingSessionStatus.STUDENT_CONFIRMED,
        where: {
          organizationId: input.organizationId,
          ...buildTeacherRecordingDeviceWhere(input),
        },
        data: {
          selectedStudentId: null,
          confirmedAt,
          errorMessage: null,
        },
      });
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

    const sessionId = (
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

    await updateTeacherRecordingStatus(tx, {
      recordingId: input.recordingId,
      from: TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
      to: TeacherRecordingSessionStatus.STUDENT_CONFIRMED,
      where: {
        organizationId: input.organizationId,
        ...buildTeacherRecordingDeviceWhere(input),
      },
      data: {
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
  let followUpDispatchError: string | null = null;
  const sessionPartProcessing = await processAllSessionPartJobs(promotion.sessionId).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[teacher-recordings] failed to process promoted session parts", {
      recordingId: input.recordingId,
      sessionId: promotion.sessionId,
      error,
    });
    return { processed: 0, errors: [message] };
  });
  if (sessionPartProcessing.errors.length > 0) {
    followUpDispatchError = sessionPartProcessing.errors[0] || "failed to dispatch promoted conversation jobs";
    console.error("[teacher-recordings] promoted session part processing reported errors", {
      recordingId: input.recordingId,
      sessionId: promotion.sessionId,
      errors: sessionPartProcessing.errors,
    });
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
    followUpDispatchOk: !followUpDispatchError,
    followUpDispatchError,
  } satisfies TeacherRecordingConfirmationResult;
}
