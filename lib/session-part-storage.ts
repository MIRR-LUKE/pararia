import { SessionPartType } from "@prisma/client";
import { readStorageBuffer, saveStorageBuffer } from "@/lib/audio-storage";
import { buildSessionPartUploadPathname } from "@/lib/audio-storage-paths";

export async function saveSessionPartUpload(input: {
  sessionId: string;
  partType: SessionPartType;
  fileName: string;
  buffer: Buffer;
  contentType?: string | null;
}) {
  return saveStorageBuffer({
    storagePathname: buildSessionPartUploadPathname(input.sessionId, input.partType, input.fileName),
    buffer: input.buffer,
    contentType: input.contentType ?? undefined,
  });
}

export async function readSessionPartUpload(storageUrl: string) {
  return readStorageBuffer(storageUrl);
}
