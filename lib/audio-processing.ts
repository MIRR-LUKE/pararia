import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import path from "node:path";
import { parseFile } from "music-metadata";

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

export async function getAudioDurationSeconds(filePath: string) {
  const metadata = await parseFile(filePath);
  const seconds = metadata.format.duration ?? 0;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export type AudioChunkFile = {
  index: number;
  startSeconds: number;
  durationSeconds: number;
  filePath: string;
};

export async function splitAudioForParallelTranscription(inputPath: string, targetDir: string, opts: {
  chunkSeconds: number;
  overlapSeconds: number;
}) {
  const durationSeconds = await getAudioDurationSeconds(inputPath);
  const chunkSeconds = Math.max(10, opts.chunkSeconds);
  const overlapSeconds = Math.max(0, Math.min(opts.overlapSeconds, chunkSeconds / 3));
  const strideSeconds = Math.max(1, chunkSeconds - overlapSeconds);

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("audio duration could not be determined");
  }

  await rm(targetDir, { recursive: true, force: true }).catch(() => {});
  await mkdir(targetDir, { recursive: true });

  const chunks: AudioChunkFile[] = [];
  let cursor = 0;
  let index = 0;
  while (cursor < durationSeconds) {
    const remaining = durationSeconds - cursor;
    const piece = Math.min(chunkSeconds, remaining);
    const outPath = path.join(targetDir, `chunk-${String(index).padStart(4, "0")}.m4a`);
    await runFfmpeg([
      "-y",
      "-ss",
      cursor.toFixed(3),
      "-t",
      piece.toFixed(3),
      "-i",
      inputPath,
      "-vn",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      outPath,
    ]);
    chunks.push({
      index,
      startSeconds: cursor,
      durationSeconds: piece,
      filePath: outPath,
    });
    index += 1;
    cursor += strideSeconds;
  }

  return {
    durationSeconds,
    chunkSeconds,
    overlapSeconds,
    strideSeconds,
    chunks,
  };
}

export async function cleanupAudioChunkDirectory(targetDir: string) {
  const entries = await readdir(targetDir).catch(() => []);
  if (entries.length === 0) {
    await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    return;
  }
  await rm(targetDir, { recursive: true, force: true }).catch(() => {});
}
