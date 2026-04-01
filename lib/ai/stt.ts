import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRuntimePath } from "@/lib/runtime-paths";
import { normalizeRawTranscriptText } from "@/lib/transcript/source";

type TranscribeInput = {
  buffer?: Buffer;
  filePath?: string;
  filename?: string;
  mimeType?: string;
  language?: string;
};

const LOCAL_STT_MODEL = process.env.FASTER_WHISPER_MODEL?.trim() || "large-v3";
const LOCAL_STT_RESPONSE_FORMAT = "segments_json" as const;

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

export type PipelineTranscriptionResult = SegmentedTranscriptResult & {
  meta: {
    model: string;
    responseFormat: typeof LOCAL_STT_RESPONSE_FORMAT;
    recoveryUsed: boolean;
    fallbackUsed: false;
    attemptCount: number;
    segmentCount: number;
    speakerCount: 0;
    qualityWarnings: TranscriptQualityWarning[];
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
};

type WorkerErrorResponse = {
  id: string;
  ok: false;
  error?: string;
};

type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

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

function buildWorkerError(message: string, stderr: string) {
  const detail = stderr.trim();
  if (!detail) {
    return new Error(message);
  }
  return new Error(`${message}\n${detail}`);
}

class FasterWhisperWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingWorkerRequest>();
  private stdoutBuffer = "";
  private stderrBuffer = "";

  private handleStdoutChunk(chunk: Buffer | string) {
    this.stdoutBuffer += String(chunk);
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex < 0) break;
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      let payload: WorkerResponse;
      try {
        payload = JSON.parse(line) as WorkerResponse;
      } catch {
        this.rejectAll(buildWorkerError("faster-whisper worker returned invalid JSON.", this.stderrBuffer));
        return;
      }
      const pending = this.pending.get(payload.id);
      if (!pending) continue;
      this.pending.delete(payload.id);
      if (payload.ok) {
        pending.resolve(payload);
      } else {
        pending.reject(buildWorkerError(payload.error?.trim() || "Local STT worker failed.", this.stderrBuffer));
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
      env: process.env,
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

    return new Promise<WorkerSuccessResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(buildWorkerError(`faster-whisper worker write failed: ${error.message}`, this.stderrBuffer));
      });
    });
  }

  shutdown() {
    const child = this.child;
    this.child = null;
    this.stdoutBuffer = "";
    const stderr = this.stderrBuffer;
    this.stderrBuffer = "";
    this.rejectAll(buildWorkerError("faster-whisper worker stopped.", stderr));
    if (!child) return;
    child.stdin.end();
    child.kill();
  }
}

const sharedWorker = new FasterWhisperWorker();

export function stopLocalSttWorker() {
  sharedWorker.shutdown();
}

async function materializeInputFile(input: TranscribeInput) {
  if (input.filePath?.trim()) {
    return {
      audioPath: path.resolve(input.filePath),
      cleanup: async () => {},
    };
  }
  if (!input.buffer) {
    throw new Error("buffer or filePath is required for local STT.");
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
    const response = await sharedWorker.transcribe({
      audioPath: file.audioPath,
      language: input.language || "ja",
    });

    const normalized = normalizeSegments({
      segments: response.segments,
    });
    const rawTextOriginal =
      normalizeRawTranscriptText(typeof response.text === "string" ? response.text : "") ||
      normalizeRawTranscriptText(buildRawTextFromSegments(normalized.segments));

    if (!rawTextOriginal) {
      throw new Error("Local STT returned an empty transcript.");
    }

    return {
      rawTextOriginal,
      segments: normalized.segments,
      meta: {
        model: `faster-whisper:${response.model?.trim() || LOCAL_STT_MODEL}`,
        responseFormat: LOCAL_STT_RESPONSE_FORMAT,
        recoveryUsed: false,
        fallbackUsed: false,
        attemptCount: 1,
        segmentCount: normalized.segments.length,
        speakerCount: 0,
        qualityWarnings: normalized.qualityWarnings,
      },
    };
  } finally {
    await file.cleanup();
  }
}
