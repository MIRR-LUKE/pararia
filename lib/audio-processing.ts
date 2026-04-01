import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import path from "node:path";

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
