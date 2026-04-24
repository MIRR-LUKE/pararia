import path from "node:path";
import { getAudioDurationSeconds } from "@/lib/audio-processing";
import { materializeInputFile } from "./stt/input";
import {
  readChunkingEnabled,
  readChunkMinDurationSeconds,
  readChunkOverlapSeconds,
  readChunkSeconds,
  shouldChunkTranscription,
  transcribeChunkedAudio,
  transcribeSingleAudio,
} from "./stt/chunking";
import {
  buildRawTranscriptText,
} from "./stt/normalize";
import { pickLeastBusyWorker } from "./stt/worker-pool";
import type {
  PipelineTranscriptionResult,
  TranscribeInput,
} from "./stt/types";

const FASTER_WHISPER_MODEL_NAME = process.env.FASTER_WHISPER_MODEL?.trim() || "turbo";
const FASTER_WHISPER_RESPONSE_FORMAT = "segments_json" as const;
const STT_PROVIDER_ENV = "PARARIA_STT_PROVIDER";

function readConfiguredTranscriptionProvider() {
  const explicit = process.env[STT_PROVIDER_ENV]?.trim().toLowerCase();
  if (!explicit || explicit === "faster-whisper") {
    return "faster-whisper";
  }
  if (explicit === "openai") {
    throw new Error(
      `${STT_PROVIDER_ENV}=openai は廃止されました。STT は Runpod / faster-whisper only です。`
    );
  }
  throw new Error(
    `${STT_PROVIDER_ENV}=${explicit} は未対応です。STT は faster-whisper のみ指定できます。`
  );
}

function assertTranscriptionExecutionAllowed() {
  readConfiguredTranscriptionProvider();

  const inRunpodWorker = Boolean(process.env.RUNPOD_POD_ID?.trim());
  if (inRunpodWorker) {
    return;
  }

  const backgroundMode = process.env.PARARIA_BACKGROUND_MODE?.trim().toLowerCase();
  if (backgroundMode === "external") {
    throw new Error(
      "503 Runpod STT worker is temporarily unavailable in external mode. OpenAI STT fallback has been removed; wake the Runpod worker and retry."
    );
  }
}

export type {
  PipelineTranscriptionResult,
  TranscriptQualityWarning,
  TranscriptSegment,
} from "./stt/types";

export { stopFasterWhisperWorkers, stopLocalSttWorker, warmFasterWhisperWorkers } from "./stt/worker-pool";

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
  assertTranscriptionExecutionAllowed();

  const file = await materializeInputFile(input);
  try {
    const language = input.language || "ja";
    const chunkingEnabled = readChunkingEnabled();
    const durationSeconds = await getAudioDurationSeconds(file.audioPath).catch(() => 0);
    const shouldChunk = shouldChunkTranscription({
      chunkingEnabled,
      durationSeconds,
      hasFilePath: Boolean(input.filePath?.trim()),
      minDurationSeconds: readChunkMinDurationSeconds(),
    });

    const run = shouldChunk
      ? await transcribeChunkedAudio(
          {
            audioPath: file.audioPath,
            language,
          },
          {
            chunkSeconds: readChunkSeconds(),
            overlapSeconds: readChunkOverlapSeconds(),
            pickWorker: pickLeastBusyWorker,
          }
        )
      : await transcribeSingleAudio(
          {
            audioPath: file.audioPath,
            language,
          },
          {
            pickWorker: pickLeastBusyWorker,
          }
        );

    const primaryResponse = run.responses[0];
    const rawTextOriginal = buildRawTranscriptText(run.responses, run.normalized.segments);

    if (!rawTextOriginal) {
      throw new Error("faster-whisper STT returned an empty transcript.");
    }

    return {
      rawTextOriginal,
      segments: run.normalized.segments,
      meta: {
        model: `faster-whisper:${primaryResponse?.model?.trim() || FASTER_WHISPER_MODEL_NAME}`,
        responseFormat: FASTER_WHISPER_RESPONSE_FORMAT,
        recoveryUsed: false,
        fallbackUsed: false,
        attemptCount: run.responses.length,
        segmentCount: run.normalized.segments.length,
        speakerCount: 0,
        qualityWarnings: run.normalized.qualityWarnings,
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
        vadParameters: primaryResponse?.vad_parameters,
        transcribeElapsedMs:
          typeof primaryResponse?.transcribe_elapsed_ms === "number" &&
          Number.isFinite(primaryResponse.transcribe_elapsed_ms)
            ? primaryResponse.transcribe_elapsed_ms
            : undefined,
      },
    };
  } finally {
    await file.cleanup();
  }
}
