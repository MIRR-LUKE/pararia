import { z } from "zod";

export const SESSION_PART_UPLOAD_PART_TYPES = ["FULL", "CHECK_IN", "CHECK_OUT", "TEXT_NOTE"] as const;
export const SESSION_PART_UPLOAD_SOURCES = ["file_upload", "direct_recording"] as const;
export const SESSION_PART_UPLOAD_PATH_PREFIX = "session-audio/uploads";

export type SessionPartUploadPartType = (typeof SESSION_PART_UPLOAD_PART_TYPES)[number];
export type BlobUploadSource = (typeof SESSION_PART_UPLOAD_SOURCES)[number];

const blobUploadClientPayloadSchema = z.object({
  sessionId: z.string().trim().min(1).max(191),
  partType: z.enum(SESSION_PART_UPLOAD_PART_TYPES),
  uploadedFileName: z.string().trim().min(1).max(255),
  uploadedMimeType: z.string().trim().max(191).optional(),
  uploadedByteSize: z.number().int().nonnegative().max(512 * 1024 * 1024).optional(),
  uploadSource: z.enum(SESSION_PART_UPLOAD_SOURCES).optional(),
});

export type BlobUploadClientPayload = z.infer<typeof blobUploadClientPayloadSchema>;

export function parseBlobUploadClientPayload(value: unknown) {
  return blobUploadClientPayloadSchema.parse(value);
}

export function parseBlobUploadClientPayloadString(value: string | null | undefined) {
  if (!value) return null;
  return parseBlobUploadClientPayload(JSON.parse(value));
}

export function buildBlobUploadClientPayload(value: BlobUploadClientPayload) {
  return JSON.stringify(blobUploadClientPayloadSchema.parse(value));
}
