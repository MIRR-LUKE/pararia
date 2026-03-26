import { mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { parseFile } from "music-metadata";
import { guessAudioMimeTypeFromFileName } from "@/lib/audio-upload-support";

function getFfmpegPath() {
  const bundledPath = typeof ffmpegPath === "string" ? ffmpegPath : "";
  if (bundledPath && existsSync(bundledPath)) {
    return bundledPath;
  }
  const localBinary = path.join(
    process.cwd(),
    "node_modules",
    "ffmpeg-static",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
  );
  if (existsSync(localBinary)) {
    return localBinary;
  }
  throw new Error("ffmpeg-static is unavailable.");
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(getFfmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

function prefersCopySegmenting(inputPath: string) {
  return /\.(m4a|mp4|aac)$/i.test(inputPath);
}

export async function getAudioDurationMs(filePath: string) {
  const metadata = await parseFile(filePath);
  return Math.max(0, Math.round((metadata.format.duration ?? 0) * 1000));
}

export function guessAudioMimeType(filePath: string) {
  return guessAudioMimeTypeFromFileName(filePath, "audio/webm");
}

export async function splitAudioIntoChunks(inputPath: string, targetDir: string, segmentSeconds: number) {
  await mkdir(targetDir, { recursive: true });
  if (prefersCopySegmenting(inputPath)) {
    try {
      await runFfmpeg([
        "-y",
        "-i",
        inputPath,
        "-f",
        "segment",
        "-segment_time",
        String(segmentSeconds),
        "-reset_timestamps",
        "1",
        "-c",
        "copy",
        path.join(targetDir, "chunk-%03d.m4a"),
      ]);
    } catch {
      await runFfmpeg([
        "-y",
        "-i",
        inputPath,
        "-f",
        "segment",
        "-segment_time",
        String(segmentSeconds),
        "-reset_timestamps",
        "1",
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        path.join(targetDir, "chunk-%03d.m4a"),
      ]);
    }
  } else {
    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-f",
      "segment",
      "-segment_time",
      String(segmentSeconds),
      "-reset_timestamps",
      "1",
      "-vn",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      path.join(targetDir, "chunk-%03d.m4a"),
    ]);
  }

  const entries = await readdir(targetDir);
  return entries
    .filter((name) => /^chunk-\d+\./.test(name))
    .sort()
    .map((name) => path.join(targetDir, name));
}

export async function normalizeAudioForStt(inputPath: string, outputPath: string) {
  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    outputPath,
  ]);
  return outputPath;
}

export async function cleanupChunkDirectory(targetDir: string) {
  await rm(targetDir, { recursive: true, force: true }).catch(() => {});
}
