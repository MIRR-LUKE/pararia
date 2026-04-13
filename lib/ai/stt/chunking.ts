import { randomUUID } from "node:crypto";
import { cleanupAudioChunkDirectory, splitAudioForParallelTranscription } from "@/lib/audio-processing";
import { getRuntimePath } from "@/lib/runtime-paths";
import { normalizeSegments, type NormalizedSegmentsResult } from "./normalize";
import type { FasterWhisperWorkerHandle, TranscriptSegment, WorkerSuccessResponse } from "./types";

export type TranscriptionRunResult = {
  responses: WorkerSuccessResponse[];
  normalized: NormalizedSegmentsResult;
};

export function readChunkingEnabled() {
  return process.env.FASTER_WHISPER_CHUNKING_ENABLED?.trim() === "1";
}

export function readChunkSeconds() {
  const n = Number(process.env.FASTER_WHISPER_CHUNK_SECONDS ?? "60");
  return Number.isFinite(n) && n >= 10 ? n : 60;
}

export function readChunkOverlapSeconds() {
  const n = Number(process.env.FASTER_WHISPER_CHUNK_OVERLAP_SECONDS ?? "1.5");
  return Number.isFinite(n) && n >= 0 ? n : 1.5;
}

export function readChunkMinDurationSeconds() {
  const n = Number(process.env.FASTER_WHISPER_CHUNK_MIN_DURATION_SECONDS ?? "180");
  return Number.isFinite(n) && n >= 30 ? n : 180;
}

export function shouldChunkTranscription(input: {
  chunkingEnabled: boolean;
  durationSeconds: number;
  hasFilePath: boolean;
  minDurationSeconds: number;
}) {
  return input.chunkingEnabled && input.hasFilePath && input.durationSeconds >= input.minDurationSeconds;
}

export async function transcribeSingleAudio(
  input: { audioPath: string; language: string },
  deps: { pickWorker: () => FasterWhisperWorkerHandle }
): Promise<TranscriptionRunResult> {
  const response = await deps.pickWorker().transcribe({
    audioPath: input.audioPath,
    language: input.language,
  });
  return {
    responses: [response],
    normalized: normalizeSegments({
      segments: response.segments,
    }),
  };
}

export async function transcribeChunkedAudio(
  input: { audioPath: string; language: string },
  deps: {
    chunkSeconds: number;
    overlapSeconds: number;
    pickWorker: () => FasterWhisperWorkerHandle;
    splitAudioForParallelTranscription?: typeof splitAudioForParallelTranscription;
    cleanupAudioChunkDirectory?: typeof cleanupAudioChunkDirectory;
  }
): Promise<TranscriptionRunResult> {
  const split = deps.splitAudioForParallelTranscription ?? splitAudioForParallelTranscription;
  const cleanup = deps.cleanupAudioChunkDirectory ?? cleanupAudioChunkDirectory;
  const chunkDir = getRuntimePath("temp", "stt-chunks", randomUUID());
  const chunking = await split(input.audioPath, chunkDir, {
    chunkSeconds: deps.chunkSeconds,
    overlapSeconds: deps.overlapSeconds,
  });
  try {
    const jobs = chunking.chunks.map(async (chunk) => {
      const worker = deps.pickWorker();
      const response = await worker.transcribe({
        audioPath: chunk.filePath,
        language: input.language,
      });
      return { chunk, response };
    });
    const settled = await Promise.all(jobs);
    const responses = settled.map((item) => item.response);
    const offsetSegments: TranscriptSegment[] = settled.flatMap(({ chunk, response }) =>
      (response.segments ?? []).map((segment, idx) => ({
        id: `${chunk.index}-${segment.id ?? idx}`,
        start: typeof segment.start === "number" ? segment.start + chunk.startSeconds : undefined,
        end: typeof segment.end === "number" ? segment.end + chunk.startSeconds : undefined,
        text: segment.text,
      }))
    );
    offsetSegments.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    return {
      responses,
      normalized: normalizeSegments({ segments: offsetSegments }),
    };
  } finally {
    await cleanup(chunkDir);
  }
}
