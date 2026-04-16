import { spawn } from "node:child_process";

function findRawArgValue(name: string) {
  const prefix = `--${name}=`;

  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === `--${name}`) {
      const next = process.argv[index + 1];
      if (!next || next.startsWith("--")) {
        return "";
      }
      return next;
    }
  }

  return null;
}

export function parseArg(name: string, fallback?: string) {
  const raw = findRawArgValue(name);
  return raw !== null ? raw : fallback ?? null;
}

export function must(value: string | null | undefined, message: string) {
  if (!value) throw new Error(message);
  return value;
}

export function readNumberArg(name: string, fallback: number) {
  const raw = Number(parseArg(name, String(fallback)));
  return Number.isFinite(raw) ? raw : fallback;
}

export function readBoolArg(name: string, fallback: boolean) {
  const raw = findRawArgValue(name);
  if (raw === null) return fallback;
  if (raw === "") return true;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

export async function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with code ${code}\n${stderr.trim()}`.trim()));
    });
  });
}

export async function createAudioClip(sourcePath: string, outputPath: string, startSeconds: number, durationSeconds: number) {
  const ffmpegPath = (await import("ffmpeg-static")).default;
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static path is unavailable.");
  }

  await runCommand(ffmpegPath, [
    "-y",
    "-ss",
    String(startSeconds),
    "-t",
    String(durationSeconds),
    "-i",
    sourcePath,
    "-vn",
    "-acodec",
    "aac",
    "-b:a",
    "128k",
    outputPath,
  ]);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
