import { SessionPartType } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  parseBlobUploadClientPayloadString,
  type BlobUploadClientPayload,
} from "@/lib/blob-upload-client-payload";
import { parseSessionPartUploadPathname } from "@/lib/audio-storage-paths";

export const BLOB_UPLOAD_MAX_BYTES = 512 * 1024 * 1024;
export const ALLOWED_AUDIO_CONTENT_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/flac",
] as const;

const BLOB_UPLOAD_RESERVATION_TTL_MS = 60 * 60 * 1000;

export function parseBlobUploadReservationRequest(pathname: string, clientPayload: string | null | undefined) {
  const parsedPath = parseSessionPartUploadPathname(pathname);
  if (!parsedPath) {
    throw new Error("audio upload path is invalid");
  }

  const parsedPayload =
    parseBlobUploadClientPayloadString(clientPayload) ??
    ({
      sessionId: parsedPath.sessionId,
      partType: parsedPath.partType,
      uploadedFileName: parsedPath.fileName,
      uploadSource: "file_upload",
    } satisfies BlobUploadClientPayload);

  if (parsedPayload.sessionId !== parsedPath.sessionId || parsedPayload.partType !== parsedPath.partType) {
    throw new Error("audio upload reservation does not match pathname");
  }

  return {
    pathname,
    sessionId: parsedPayload.sessionId,
    partType: parsedPayload.partType as SessionPartType,
    uploadedFileName: parsedPayload.uploadedFileName,
    uploadedMimeType: parsedPayload.uploadedMimeType?.trim() || null,
    uploadedByteSize:
      Number.isFinite(parsedPayload.uploadedByteSize ?? NaN) && (parsedPayload.uploadedByteSize ?? 0) >= 0
        ? Math.floor(parsedPayload.uploadedByteSize ?? 0)
        : null,
    uploadSource: parsedPayload.uploadSource ?? "file_upload",
  };
}

export async function upsertBlobUploadReservation(input: {
  organizationId: string;
  studentId: string;
  sessionId: string;
  partType: SessionPartType;
  pathname: string;
  uploadedByUserId: string;
  uploadSource: string;
  expectedFileName?: string | null;
  expectedMimeType?: string | null;
  expectedByteSize?: number | null;
}) {
  const expiresAt = new Date(Date.now() + BLOB_UPLOAD_RESERVATION_TTL_MS);
  return prisma.blobUploadReservation.upsert({
    where: { pathname: input.pathname },
    update: {
      organizationId: input.organizationId,
      studentId: input.studentId,
      sessionId: input.sessionId,
      partType: input.partType,
      uploadedByUserId: input.uploadedByUserId,
      uploadSource: input.uploadSource,
      expectedFileName: input.expectedFileName ?? null,
      expectedMimeType: input.expectedMimeType ?? null,
      expectedByteSize: input.expectedByteSize ?? null,
      blobUrl: null,
      blobDownloadUrl: null,
      blobContentType: null,
      blobByteSize: null,
      status: "PENDING",
      completedAt: null,
      consumedAt: null,
      expiresAt,
    },
    create: {
      organizationId: input.organizationId,
      studentId: input.studentId,
      sessionId: input.sessionId,
      partType: input.partType,
      pathname: input.pathname,
      uploadedByUserId: input.uploadedByUserId,
      uploadSource: input.uploadSource,
      expectedFileName: input.expectedFileName ?? null,
      expectedMimeType: input.expectedMimeType ?? null,
      expectedByteSize: input.expectedByteSize ?? null,
      expiresAt,
    },
  });
}

export async function markBlobUploadReservationCompleted(input: {
  pathname: string;
  blobUrl: string;
  blobDownloadUrl: string;
  blobContentType?: string | null;
  blobByteSize?: number | null;
}) {
  return prisma.blobUploadReservation.updateMany({
    where: {
      pathname: input.pathname,
      status: "PENDING",
    },
    data: {
      blobUrl: input.blobUrl,
      blobDownloadUrl: input.blobDownloadUrl,
      blobContentType: input.blobContentType ?? null,
      blobByteSize:
        Number.isFinite(input.blobByteSize ?? NaN) && (input.blobByteSize ?? 0) >= 0
          ? Math.floor(input.blobByteSize ?? 0)
          : null,
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });
}

export async function consumeCompletedBlobUploadReservation(input: {
  organizationId: string;
  sessionId: string;
  partType: SessionPartType;
  pathname: string;
}) {
  const now = new Date();
  const reservation = await prisma.blobUploadReservation.findFirst({
    where: {
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      partType: input.partType,
      pathname: input.pathname,
      status: "COMPLETED",
      expiresAt: { gt: now },
      consumedAt: null,
      blobUrl: { not: null },
    },
  });

  if (!reservation?.blobUrl) {
    throw new Error("アップロード予約が見つからないか、まだ完了していません。");
  }

  const consumed = await prisma.blobUploadReservation.updateMany({
    where: {
      id: reservation.id,
      consumedAt: null,
      status: "COMPLETED",
    },
    data: {
      status: "CONSUMED",
      consumedAt: now,
    },
  });
  if (consumed.count !== 1) {
    throw new Error("このアップロード予約はすでに使われました。");
  }

  return reservation;
}

export async function markExpiredBlobUploadReservations(now = new Date()) {
  const expired = await prisma.blobUploadReservation.findMany({
    where: {
      status: { in: ["PENDING", "COMPLETED"] },
      expiresAt: { lte: now },
    },
    select: {
      id: true,
      organizationId: true,
      blobUrl: true,
    },
  });

  if (expired.length === 0) {
    return [];
  }

  await prisma.blobUploadReservation.updateMany({
    where: {
      id: { in: expired.map((entry) => entry.id) },
    },
    data: {
      status: "EXPIRED",
    },
  });

  return expired;
}
