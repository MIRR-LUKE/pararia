import { TeacherRecordingJobType, TeacherRecordingSessionStatus } from "@prisma/client";
import { deleteStorageEntryDetailed, saveStorageBuffer } from "@/lib/audio-storage";
import { buildTeacherRecordingUploadPathname, sanitizeStorageFileName } from "@/lib/audio-storage-paths";
import { prisma } from "@/lib/db";
import { upsertTeacherRecordingJob } from "@/lib/teacher-app/server/recording-session-ops";
import {
  buildTeacherRecordingDeviceWhere,
  loadTeacherRecordingForProcessing,
} from "@/lib/teacher-app/server/recording-summary-presenter";
import { updateTeacherRecordingStatus } from "@/lib/teacher-app/server/recording-status";

function assertTeacherRecordingUploadable(
  recording: Awaited<ReturnType<typeof loadTeacherRecordingForProcessing>>
): asserts recording is NonNullable<Awaited<ReturnType<typeof loadTeacherRecordingForProcessing>>> {
  if (!recording) {
    throw new Error("録音セッションが見つかりません。");
  }
  if (recording.status !== TeacherRecordingSessionStatus.RECORDING) {
    if (recording.status === TeacherRecordingSessionStatus.CANCELLED) {
      throw new Error("この録音はすでに中止されています。最初からやり直してください。");
    }
    throw new Error("この録音はすでに送信済みです。最初からやり直してください。");
  }
}

function normalizeDurationSecondsHint(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function cleanupSavedTeacherRecordingAudio(storageUrl: string) {
  const cleanup = await deleteStorageEntryDetailed(storageUrl);
  if (!cleanup.ok) {
    console.error("[teacher-recording-upload] failed to delete unclaimed audio blob", {
      storageUrl,
      error: cleanup.error,
    });
  }
}

export async function withSavedTeacherRecordingAudioCleanup<T>(storageUrl: string, operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    await cleanupSavedTeacherRecordingAudio(storageUrl).catch((cleanupError) => {
      console.error("[teacher-recording-upload] failed to run unclaimed audio blob cleanup", {
        storageUrl,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    });
    throw error;
  }
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
  if (recording?.organizationId !== input.organizationId) {
    throw new Error("録音セッションが見つかりません。");
  }
  assertTeacherRecordingUploadable(recording);

  const safeFileName = sanitizeStorageFileName(input.file.name || "teacher-recording.webm");
  const storage = await saveStorageBuffer({
    storagePathname: buildTeacherRecordingUploadPathname(input.recordingId, safeFileName),
    buffer: Buffer.from(await input.file.arrayBuffer()),
    contentType: input.file.type || "audio/webm",
  });
  const uploadedAt = new Date();

  return withSavedTeacherRecordingAudioCleanup(storage.storageUrl, () =>
    prisma.$transaction(async (tx) => {
      await updateTeacherRecordingStatus(tx, {
        recordingId: input.recordingId,
        from: TeacherRecordingSessionStatus.RECORDING,
        to: TeacherRecordingSessionStatus.TRANSCRIBING,
        where: {
          organizationId: input.organizationId,
          ...buildTeacherRecordingDeviceWhere(input),
        },
        data: {
          audioFileName: safeFileName,
          audioMimeType: input.file.type || "audio/webm",
          audioByteSize: input.file.size,
          audioStorageUrl: storage.storageUrl,
          durationSeconds: normalizeDurationSecondsHint(input.durationSecondsHint),
          uploadedAt,
          errorMessage: null,
        },
      });

      return upsertTeacherRecordingJob(
        tx,
        input.recordingId,
        input.organizationId,
        TeacherRecordingJobType.TRANSCRIBE_AND_SUGGEST
      );
    })
  );
}

export async function prepareTeacherRecordingBlobUpload(input: {
  organizationId: string;
  deviceId?: string | null;
  deviceLabel?: string | null;
  recordingId: string;
  fileName: string;
}) {
  const recording = await loadTeacherRecordingForProcessing(input.recordingId, {
    organizationId: input.organizationId,
    deviceId: input.deviceId,
    deviceLabel: input.deviceLabel,
  });
  if (recording?.organizationId !== input.organizationId) {
    throw new Error("録音セッションが見つかりません。");
  }
  assertTeacherRecordingUploadable(recording);

  const safeFileName = sanitizeStorageFileName(input.fileName || "teacher-recording.m4a");
  return {
    safeFileName,
    storagePathname: buildTeacherRecordingUploadPathname(input.recordingId, safeFileName),
  };
}

export async function completeTeacherRecordingBlobUpload(input: {
  organizationId: string;
  deviceId?: string | null;
  deviceLabel?: string | null;
  recordingId: string;
  fileName: string;
  mimeType?: string | null;
  byteSize?: number | null;
  storageUrl: string;
  storagePathname?: string | null;
  durationSecondsHint?: number | null;
}) {
  const recording = await loadTeacherRecordingForProcessing(input.recordingId, {
    organizationId: input.organizationId,
    deviceId: input.deviceId,
    deviceLabel: input.deviceLabel,
  });
  if (recording?.organizationId !== input.organizationId) {
    throw new Error("録音セッションが見つかりません。");
  }
  assertTeacherRecordingUploadable(recording);

  const storagePathname = String(input.storagePathname || "").trim();
  const expectedPrefix = `teacher-recordings/uploads/${input.recordingId}/`;
  if (!storagePathname.startsWith(expectedPrefix)) {
    throw new Error("音声アップロードの保存先が不正です。");
  }

  const uploadedAt = new Date();
  const safeFileName = sanitizeStorageFileName(input.fileName || "teacher-recording.m4a");
  const byteSize =
    typeof input.byteSize === "number" && Number.isFinite(input.byteSize) && input.byteSize >= 0
      ? Math.floor(input.byteSize)
      : null;

  return withSavedTeacherRecordingAudioCleanup(input.storageUrl, () =>
    prisma.$transaction(async (tx) => {
      await updateTeacherRecordingStatus(tx, {
        recordingId: input.recordingId,
        from: TeacherRecordingSessionStatus.RECORDING,
        to: TeacherRecordingSessionStatus.TRANSCRIBING,
        where: {
          organizationId: input.organizationId,
          ...buildTeacherRecordingDeviceWhere(input),
        },
        data: {
          audioFileName: safeFileName,
          audioMimeType: input.mimeType || "audio/mp4",
          audioByteSize: byteSize,
          audioStorageUrl: input.storageUrl,
          durationSeconds: normalizeDurationSecondsHint(input.durationSecondsHint),
          uploadedAt,
          errorMessage: null,
        },
      });

      return upsertTeacherRecordingJob(
        tx,
        input.recordingId,
        input.organizationId,
        TeacherRecordingJobType.TRANSCRIBE_AND_SUGGEST
      );
    })
  );
}
