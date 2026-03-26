import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SessionPartType } from "@prisma/client";

const SESSION_PART_AUDIO_ROOT = path.join(process.cwd(), ".data", "session-audio", "uploads");

function sanitizeFileName(name: string) {
  const base = String(name || "audio.webm").trim();
  return base.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/\s+/g, "-");
}

function getPartUploadDir(sessionId: string, partType: SessionPartType) {
  return path.join(SESSION_PART_AUDIO_ROOT, sessionId, partType.toLowerCase());
}

export async function saveSessionPartUpload(input: {
  sessionId: string;
  partType: SessionPartType;
  fileName: string;
  buffer: Buffer;
}) {
  const dir = getPartUploadDir(input.sessionId, input.partType);
  await mkdir(dir, { recursive: true });
  const fileName = `${Date.now()}-${sanitizeFileName(path.basename(input.fileName))}`;
  const storageUrl = path.join(dir, fileName);
  await writeFile(storageUrl, input.buffer);
  return {
    storageUrl,
    fileName,
    byteSize: input.buffer.byteLength,
  };
}

export async function readSessionPartUpload(storageUrl: string) {
  return readFile(storageUrl);
}
