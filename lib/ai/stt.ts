import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanupAudioChunkDirectory, getAudioDurationSeconds, splitAudioForParallelTranscription } from "@/lib/audio-processing";
import { getRuntimePath } from "@/lib/runtime-paths";
import { normalizeRawTranscriptText } from "@/lib/transcript/source";

type TranscribeInput = {
  buffer?: Buffer;
  filePath?: string;
  filename?: string;
  mimeType?: string;
  language?: string;
};

const FASTER_WHISPER_MODEL_NAME = process.env.FASTER_WHISPER_MODEL?.trim() || "large-v3";
const FASTER_WHISPER_RESPONSE_FORMAT = "segments_json" as const;

export type TranscriptSegment = {
  id?: number | string;
  seek?: number;
  start?: number;
  end?: number;
  text?: string;
  speaker?: string;
};

export type SegmentedTranscriptResult = {
  rawTextOriginal: string;
  segments: TranscriptSegment[];
};

export type TranscriptQualityWarning =
  | "too_many_short_segments"
  | "adjacent_duplicates_removed";

type WorkerGpuSnapshot = {
  utilization_gpu_percent?: number;
  memory_used_mb?: number;
  memory_total_mb?: number;
};

type WorkerGpuMonitor = {
  sample_count?: number;
  utilization_percent_max?: number;
  utilization_percent_avg?: number;
  memory_used_mb_max?: number;
  memory_used_mb_min?: number;
  memory_total_mb?: number;
  sampled_at_ms_start?: number;
  sampled_at_ms_end?: number;
};

export type PipelineTranscriptionResult = SegmentedTranscriptResult & {
  meta: {
    model: string;
    responseFormat: typeof FASTER_WHISPER_RESPONSE_FORMAT;
    recoveryUsed: boolean;
    fallbackUsed: false;
    attemptCount: number;
    segmentCount: number;
    speakerCount: 0;
    qualityWarnings: TranscriptQualityWarning[];
    device?: string;
    computeType?: string;
    pipeline?: string;
    batchSize?: number;
    gpuName?: string;
    gpuComputeCapability?: string;
    gpuSnapshotBefore?: WorkerGpuSnapshot;
    gpuSnapshotAfter?: WorkerGpuSnapshot;
    gpuMonitor?: WorkerGpuMonitor;
  };
};

type WorkerRequest = {
  id: string;
  audio_path: string;
  language: string;
};

type WorkerSegment = {
  id?: number | string;
  start?: number;
  end?: number;
  text?: string;
};

type WorkerSuccessResponse = {
  id: string;
  ok: true;
  text?: string;
  segments?: WorkerSegment[];
  model?: string;
  device?: string;
  compute_type?: string;
  pipeline?: string;
  batch_size?: number;
  gpu_name?: string;
  gpu_compute_capability?: string;
  gpu_snapshot_before?: WorkerGpuSnapshot;
  gpu_snapshot_after?: WorkerGpuSnapshot;
  gpu_monitor?: WorkerGpuMonitor;
};

type WorkerErrorResponse = {
  id: string;
  ok: false;
  error?: string;
};

type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

type WorkerReadyResponse = {
  event: "ready";
  ok: true;
  model?: string;
  device?: string;
  compute_type?: string;
  pipeline?: string;
  batch_size?: number;
  gpu_name?: string;
  gpu_compute_capability?: string;
};

type PendingWorkerRequest = {
  resolve: (value: WorkerSuccessResponse) => void;
  reject: (reason?: unknown) => void;
};

function normalizeSegmentText(text: unknown) {
  return typeof text === "string" ? text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() : "";
}

function comparableSegmentText(text: string) {
  return text.replace(/[\s、。,，．！？!?\-ー〜～]/g, "");
}

function joinSegmentText(left: string, right: string) {
  if (!left) return right;
  if (!right) return left;
  if (/[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right)) {
    return `${left} ${right}`.trim();
  }
  return `${left}${right}`.trim();
}

function buildRawTextFromSegments(segments: TranscriptSegment[]) {
  return segments
    .map((segment) => normalizeSegmentText(segment.text))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeSegments(data: {
  segments?: WorkerSegment[];
}): {
  segments: TranscriptSegment[];
  qualityWarnings: TranscriptQualityWarning[];
} {
  if (!Array.isArray(data.segments)) {
    return {
      segments: [],
      qualityWarnings: [],
    };
  }

  const mapped = data.segments
    .map((segment, index) => ({
      id:
        typeof segment.id === "number" || typeof segment.id === "string"
          ? segment.id
          : index,
      start: typeof segment.start === "number" ? segment.start : undefined,
      end: typeof segment.end === "number" ? segment.end : undefined,
      text: normalizeSegmentText(segment.text),
    }))
    .filter((segment) => Boolean(segment.text));

  const merged: TranscriptSegment[] = [];
  let removedDuplicateCount = 0;

  for (const current of mapped) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(current);
      continue;
    }

    const previousComparable = comparableSegmentText(previous.text ?? "");
    const currentComparable = comparableSegmentText(current.text ?? "");
    const gap =
      typeof previous.end === "number" && typeof current.start === "number"
        ? current.start - previous.end
        : null;
    const exactDuplicate =
      previousComparable.length > 0 &&
      previousComparable === currentComparable &&
      (gap === null || gap <= 1.2);
    const overlapDuplicate =
      previousComparable.length > 8 &&
      currentComparable.length > 8 &&
      (previousComparable.includes(currentComparable) || currentComparable.includes(previousComparable)) &&
      (gap === null || gap <= 0.8);
    const shortContinuation =
      gap !== null &&
      gap >= 0 &&
      gap <= 0.35 &&
      currentComparable.length > 0 &&
      currentComparable.length <= 12 &&
      !/[。！？!?]$/.test(previous.text ?? "");

    if (exactDuplicate || overlapDuplicate) {
      const richerText =
        (current.text?.length ?? 0) > (previous.text?.length ?? 0) ? current.text : previous.text;
      merged[merged.length - 1] = {
        ...previous,
        end: typeof current.end === "number" ? current.end : previous.end,
        text: richerText,
      };
      removedDuplicateCount += 1;
      continue;
    }

    if (shortContinuation) {
      merged[merged.length - 1] = {
        ...previous,
        end: typeof current.end === "number" ? current.end : previous.end,
        text: joinSegmentText(previous.text ?? "", current.text ?? ""),
      };
      continue;
    }

    merged.push(current);
  }

  const shortSegmentRatio =
    merged.length > 0
      ? merged.filter((segment) => comparableSegmentText(segment.text ?? "").length <= 4).length / merged.length
      : 0;

  const qualityWarnings: TranscriptQualityWarning[] = [];
  if (shortSegmentRatio >= 0.55 && merged.length >= 8) qualityWarnings.push("too_many_short_segments");
  if (removedDuplicateCount > 0) qualityWarnings.push("adjacent_duplicates_removed");

  return {
    segments: merged,
    qualityWarnings,
  };
}

function readWorkerCommand() {
  return process.env.FASTER_WHISPER_WORKER_COMMAND?.trim() || process.env.FASTER_WHISPER_PYTHON?.trim() || "python";
}

function readWorkerArgs() {
  const raw = process.env.FASTER_WHISPER_WORKER_ARGS_JSON?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
        return parsed;
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

function readChunkingEnabled() {
  // 既定はオフ。まずは 1 本の音声をそのまま GPU に流す。
  return process.env.FASTER_WHISPER_CHUNKING_ENABLED?.trim() === "1";
}

function readChunkSeconds() {
  const n = Number(process.env.FASTER_WHISPER_CHUNK_SECONDS ?? "60");
  return Number.isFinite(n) && n >= 10 ? n : 60;
}

function readChunkOverlapSeconds() {
  const n = Number(process.env.FASTER_WHISPER_CHUNK_OVERLAP_SECONDS ?? "1.5");
  return Number.isFinite(n) && n >= 0 ? n : 1.5;
}

function readChunkMinDurationSeconds() {
  const n = Number(process.env.FASTER_WHISPER_CHUNK_MIN_DURATION_SECONDS ?? "180");
  return Number.isFinite(n) && n >= 30 ? n : 180;
}

function readWorkerPoolSize() {
  // 既定は 1。複数 worker を立てるのは明示指定のときだけ。
  const n = Number(process.env.FASTER_WHISPER_POOL_SIZE ?? "1");
  return Number.isFinite(n) && n >= 1 ? Math.min(8, Math.floor(n)) : 1;
}

class FasterWhisperWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingWorkerRequest>();
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private inFlight = 0;
  private readyInfo: WorkerReadyResponse | null = null;
  private readyPromise: Promise<WorkerReadyResponse> | null = null;
  private resolveReady: ((value: WorkerReadyResponse) => void) | null = null;
  private rejectReady: ((reason?: unknown) => void) | null = null;

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
      const pending = this.pending.get(payload.id);
      if (!pending) continue;
      this.pending.delete(payload.id);
      if (payload.ok) {
        pending.resolve(payload);
      } else {
        pending.reject(buildWorkerError(payload.error?.trim() || "faster-whisper worker failed.", this.stderrBuffer));
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

  async transcribe(input: {
    audioPath: string;
    language: string;
  }) {
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
        this.inFlight = Math.max(0, this.inFlight - 1);
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

function pickLeastBusyWorker() {
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

async function materializeInputFile(input: TranscribeInput) {
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

export async function transcribeAudio({
  buffer,
  filePath,
  filename = filePath ? path.basename(filePath) : "audio.webm",
  mimeType = "audio/webm",
  language = "ja",
}: TranscribeInput): Promise<string> {
  const result = await transcribeAudioForPipeline({ buffer, filePath, filename, mimeType, language });
  return result.rawTextOriginal;
}

export async function transcribeAudioForPipeline(input: TranscribeInput): Promise<PipelineTranscriptionResult> {
  const file = await materializeInputFile(input);
  try {
    const language = input.language || "ja";
    // 普段は 1 本の音声をそのまま 1 worker に渡す。
    // 分割して並列にするのは env を明示したときだけ。
    const shouldChunk =
      readChunkingEnabled() &&
      Boolean(input.filePath?.trim()) &&
      (await getAudioDurationSeconds(file.audioPath).catch(() => 0)) >= readChunkMinDurationSeconds();
    let responses: WorkerSuccessResponse[] = [];
    let normalized;

    if (shouldChunk) {
      const chunkDir = getRuntimePath("temp", "stt-chunks", randomUUID());
      const chunking = await splitAudioForParallelTranscription(file.audioPath, chunkDir, {
        chunkSeconds: readChunkSeconds(),
        overlapSeconds: readChunkOverlapSeconds(),
      });
      try {
        const jobs = chunking.chunks.map(async (chunk) => {
          const worker = pickLeastBusyWorker();
          const response = await worker.transcribe({
            audioPath: chunk.filePath,
            language,
          });
          return { chunk, response };
        });
        const settled = await Promise.all(jobs);
        responses = settled.map((item) => item.response);
        const offsetSegments: WorkerSegment[] = settled.flatMap(({ chunk, response }) =>
          (response.segments ?? []).map((segment, idx) => ({
            id: `${chunk.index}-${segment.id ?? idx}`,
            start: typeof segment.start === "number" ? segment.start + chunk.startSeconds : undefined,
            end: typeof segment.end === "number" ? segment.end + chunk.startSeconds : undefined,
            text: segment.text,
          }))
        );
        offsetSegments.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
        normalized = normalizeSegments({ segments: offsetSegments });
      } finally {
        await cleanupAudioChunkDirectory(chunkDir);
      }
    } else {
      const response = await pickLeastBusyWorker().transcribe({
        audioPath: file.audioPath,
        language,
      });
      responses = [response];
      normalized = normalizeSegments({
        segments: response.segments,
      });
    }

    const primaryResponse = responses[0];
    const rawTextOriginal =
      normalizeRawTranscriptText(
        responses
          .map((entry) => (typeof entry.text === "string" ? entry.text : ""))
          .filter(Boolean)
          .join("\n")
      ) ||
      normalizeRawTranscriptText(buildRawTextFromSegments(normalized.segments));

    if (!rawTextOriginal) {
      throw new Error("faster-whisper STT returned an empty transcript.");
    }

      return {
        rawTextOriginal,
        segments: normalized.segments,
        meta: {
          model: `faster-whisper:${primaryResponse?.model?.trim() || FASTER_WHISPER_MODEL_NAME}`,
          responseFormat: FASTER_WHISPER_RESPONSE_FORMAT,
          recoveryUsed: false,
          fallbackUsed: false,
          attemptCount: responses.length,
          segmentCount: normalized.segments.length,
          speakerCount: 0,
          qualityWarnings: normalized.qualityWarnings,
          device: primaryResponse?.device?.trim() || undefined,
          computeType: primaryResponse?.compute_type?.trim() || undefined,
          pipeline: primaryResponse?.pipeline?.trim() || undefined,
          batchSize:
            typeof primaryResponse?.batch_size === "number" && Number.isFinite(primaryResponse.batch_size)
              ? primaryResponse.batch_size
              : undefined,
          gpuName: primaryResponse?.gpu_name?.trim() || undefined,
          gpuComputeCapability: primaryResponse?.gpu_compute_capability?.trim() || undefined,
          gpuSnapshotBefore: primaryResponse?.gpu_snapshot_before,
          gpuSnapshotAfter: primaryResponse?.gpu_snapshot_after,
          gpuMonitor: primaryResponse?.gpu_monitor,
        },
      };
  } finally {
    await file.cleanup();
  }
}
