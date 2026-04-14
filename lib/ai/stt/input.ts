import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRuntimePath } from "@/lib/runtime-paths";
import type { TranscribeInput } from "./types";

export async function materializeInputFile(input: TranscribeInput) {
  if (input.filePath?.trim()) {
    return {
      audioPath: path.resolve(input.filePath),
      cleanup: async () => {},
    };
  }

  if (!input.buffer) {
    throw new Error("buffer or filePath is required for faster-whisper STT.");
  }

  const tempDir = getRuntimePath("temp", "stt");
  await mkdir(tempDir, { recursive: true });
  const extension = path.extname(input.filename || "").trim() || ".bin";
  const tempPath = path.join(tempDir, `${Date.now()}-${randomUUID()}${extension}`);
  await writeFile(tempPath, input.buffer);

  return {
    audioPath: tempPath,
    cleanup: async () => {
      await rm(tempPath, { force: true }).catch(() => {});
    },
  };
}
