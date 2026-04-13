import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  FasterWhisperWorkerHandle,
  WorkerReadyResponse,
  WorkerRequest,
  WorkerResponse,
  WorkerSuccessResponse,
} from "./types";

type PendingWorkerRequest = {
  resolve: (value: WorkerSuccessResponse) => void;
  reject: (reason?: unknown) => void;
};

function readWorkerCommand() {
  return process.env.FASTER_WHISPER_WORKER_COMMAND?.trim() || process.env.FASTER_WHISPER_PYTHON?.trim() || "python";
}

function readWorkerArgs(): string[] {
  const raw = process.env.FASTER_WHISPER_WORKER_ARGS_JSON?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
        return parsed as string[];
      }
    } catch {
      throw new Error("FASTER_WHISPER_WORKER_ARGS_JSON must be a JSON string array.");
    }
  }
  return [path.join(process.cwd(), "scripts", "faster_whisper_worker.py")];
}

function buildWorkerEnv() {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  env.PYTHONUTF8 = env.PYTHONUTF8?.trim() || "1";
  env.PYTHONIOENCODING = env.PYTHONIOENCODING?.trim() || "utf-8";
  const defaultCudaPath = path.join(process.cwd(), ".data", "local-stt", "cuda12");
  const libraryPath =
    process.env.FASTER_WHISPER_LIBRARY_PATH?.trim() ||
    (existsSync(path.join(defaultCudaPath, "cublas64_12.dll")) ? defaultCudaPath : "");
  if (libraryPath) {
    env.PATH = `${libraryPath};${env.PATH ?? ""}`;
  }
  return env;
}

function buildWorkerError(message: string, stderr: string) {
  const detail = stderr.trim();
  if (!detail) {
    return new Error(message);
  }
  return new Error(`${message}\n${detail}`);
}

function readWorkerPoolSize() {
  const n = Number(process.env.FASTER_WHISPER_POOL_SIZE ?? "1");
  return Number.isFinite(n) && n >= 1 ? Math.min(8, Math.floor(n)) : 1;
}

class FasterWhisperWorker implements FasterWhisperWorkerHandle {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingWorkerRequest>();
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private inFlight = 0;
  private readyInfo: WorkerReadyResponse | null = null;
  private readyPromise: Promise<WorkerReadyResponse> | null = null;
  private resolveReady: ((value: WorkerReadyResponse) => void) | null = null;
  private rejectReady: ((reason?: unknown) => void) | null = null;

  private suppressUnhandledReadyRejection() {
    this.readyPromise?.catch(() => undefined);
  }

  private handleStdoutChunk(chunk: Buffer | string) {
    this.stdoutBuffer += String(chunk);
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex < 0) break;
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      let payload: WorkerResponse | WorkerReadyResponse;
      try {
        payload = JSON.parse(line) as WorkerResponse;
      } catch {
        this.rejectAll(buildWorkerError("faster-whisper worker returned invalid JSON.", this.stderrBuffer));
        return;
      }
      if (
        payload &&
        typeof payload === "object" &&
        "event" in payload &&
        (payload as { event?: unknown }).event === "ready"
      ) {
        const readyPayload = payload as WorkerReadyResponse;
        this.readyInfo = readyPayload;
        this.resolveReady?.(readyPayload);
        this.resolveReady = null;
        this.rejectReady = null;
        continue;
      }
      const responsePayload = payload as WorkerResponse;
      const pending = this.pending.get(responsePayload.id);
      if (!pending) continue;
      this.pending.delete(responsePayload.id);
      if (responsePayload.ok) {
        pending.resolve(responsePayload);
      } else {
        pending.reject(
          buildWorkerError(responsePayload.error?.trim() || "faster-whisper worker failed.", this.stderrBuffer)
        );
      }
    }
  }

  private handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
    const message =
      signal
        ? `faster-whisper worker exited with signal ${signal}.`
        : `faster-whisper worker exited with code ${code ?? "unknown"}.`;
    this.child = null;
    this.stdoutBuffer = "";
    const error = buildWorkerError(message, this.stderrBuffer);
    this.stderrBuffer = "";
    this.suppressUnhandledReadyRejection();
    this.rejectReady?.(error);
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    this.readyInfo = null;
    this.rejectAll(error);
  };

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private ensureWorker() {
    if (this.child && !this.child.killed) {
      return this.child;
    }

    const child = spawn(readWorkerCommand(), readWorkerArgs(), {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: buildWorkerEnv(),
    });

    this.readyInfo = null;
    this.readyPromise = new Promise<WorkerReadyResponse>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    child.stdout.on("data", (chunk) => this.handleStdoutChunk(chunk));
    child.stderr.on("data", (chunk) => {
      this.stderrBuffer += String(chunk);
    });
    child.on("error", (error) => {
      this.child = null;
      this.suppressUnhandledReadyRejection();
      this.rejectReady?.(buildWorkerError(`faster-whisper worker could not start: ${error.message}`, this.stderrBuffer));
      this.readyPromise = null;
      this.resolveReady = null;
      this.rejectReady = null;
      this.rejectAll(buildWorkerError(`faster-whisper worker could not start: ${error.message}`, this.stderrBuffer));
    });
    child.on("exit", this.handleExit);

    this.child = child;
    return child;
  }

  async warm() {
    this.ensureWorker();
    if (this.readyInfo) return this.readyInfo;
    if (!this.readyPromise) {
      throw new Error("faster-whisper worker readiness promise is unavailable.");
    }
    return this.readyPromise;
  }

  async transcribe(input: { audioPath: string; language: string }) {
    const child = this.ensureWorker();
    const id = randomUUID();
    const payload: WorkerRequest = {
      id,
      audio_path: input.audioPath,
      language: input.language,
    };

    this.inFlight += 1;
    return new Promise<WorkerSuccessResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(buildWorkerError(`faster-whisper worker write failed: ${error.message}`, this.stderrBuffer));
      });
    }).finally(() => {
      this.inFlight = Math.max(0, this.inFlight - 1);
    });
  }

  getLoad() {
    return this.inFlight;
  }

  shutdown() {
    const child = this.child;
    this.child = null;
    this.stdoutBuffer = "";
    const stderr = this.stderrBuffer;
    this.stderrBuffer = "";
    this.suppressUnhandledReadyRejection();
    this.rejectReady?.(buildWorkerError("faster-whisper worker stopped.", stderr));
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    this.readyInfo = null;
    this.rejectAll(buildWorkerError("faster-whisper worker stopped.", stderr));
    if (!child) return;
    child.stdin.end();
    child.kill();
  }
}

const sharedWorkers = Array.from({ length: readWorkerPoolSize() }, () => new FasterWhisperWorker());

export function pickLeastBusyWorker() {
  return sharedWorkers.reduce((best, current) => (current.getLoad() < best.getLoad() ? current : best), sharedWorkers[0]);
}

export function stopLocalSttWorker() {
  for (const worker of sharedWorkers) {
    worker.shutdown();
  }
}

export async function warmFasterWhisperWorkers() {
  return Promise.all(sharedWorkers.map((worker) => worker.warm()));
}

export const stopFasterWhisperWorkers = stopLocalSttWorker;
