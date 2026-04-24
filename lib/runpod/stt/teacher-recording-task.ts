import { rm } from "node:fs/promises";
import { transcribeAudioForPipeline } from "@/lib/ai/stt";
import { getAudioDurationSeconds, normalizeAudioForStt } from "@/lib/audio-processing";
import { materializeStorageFile } from "@/lib/audio-storage";
import { readRunpodWorkerRuntimeMetadata } from "@/lib/runpod/runtime-metadata";
import { normalizeRawTranscriptText } from "@/lib/transcript/source";

export type TeacherRecordingSttTaskInput = {
  audioStorageUrl: string;
  audioFileName: string;
  audioMimeType: string | null;
};

export type TeacherRecordingTranscriptionResult = {
  kind: "success";
  transcriptText: string;
  rawTextOriginal: string;
  segments: any[];
  meta: Record<string, unknown>;
  outputJson: Record<string, unknown>;
  costMetaJson: Record<string, unknown>;
};

function readMeasuredDuration(value: number) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isUnsupportedAudioError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Audio file might be corrupted or unsupported|invalid_value|unsupported/i.test(message);
}

export async function transcribeTeacherRecordingTask(
  input: TeacherRecordingSttTaskInput
): Promise<TeacherRecordingTranscriptionResult> {
  const startedAt = Date.now();
  let firstTranscribeStartedAt: number | null = null;
  let totalTranscribeMs = 0;
  let normalizedRetryUsed = false;
  let measuredDurationSeconds: number | null = null;
  let localAudio: Awaited<ReturnType<typeof materializeStorageFile>> | null = null;

  try {
    localAudio = await materializeStorageFile(input.audioStorageUrl, {
      fileName: input.audioFileName,
    });
    measuredDurationSeconds = readMeasuredDuration(
      await getAudioDurationSeconds(localAudio.filePath).catch(() => 0)
    );

    let stt: Awaited<ReturnType<typeof transcribeAudioForPipeline>> | null = null;
    try {
      firstTranscribeStartedAt = Date.now();
      const transcribeStartedAt = Date.now();
      stt = await transcribeAudioForPipeline({
        filePath: localAudio.filePath,
        filename: input.audioFileName,
        mimeType: input.audioMimeType || "audio/webm",
        language: "ja",
      });
      totalTranscribeMs += Date.now() - transcribeStartedAt;
    } catch (error) {
      if (!isUnsupportedAudioError(error)) throw error;
      const normalizedPath = `${localAudio.filePath}.stt-normalized.m4a`;
      try {
        await normalizeAudioForStt(localAudio.filePath, normalizedPath);
        normalizedRetryUsed = true;
        firstTranscribeStartedAt ??= Date.now();
        const transcribeStartedAt = Date.now();
        stt = await transcribeAudioForPipeline({
          filePath: normalizedPath,
          filename: "teacher-recording-normalized.m4a",
          mimeType: "audio/mp4",
          language: "ja",
        });
        totalTranscribeMs += Date.now() - transcribeStartedAt;
      } finally {
        await rm(normalizedPath, { force: true }).catch(() => {});
      }
    }

    if (!stt) {
      throw new Error("faster-whisper transcription did not return a result");
    }

    const sttEngine = stt.meta.model.startsWith("openai:") ? "openai" : "faster-whisper";

    const transcriptText = normalizeRawTranscriptText(stt.rawTextOriginal);
    if (!transcriptText) {
      throw new Error("文字起こし結果が空でした。");
    }

    const finishedAt = Date.now();
    const sttTotalMs = Math.max(0, finishedAt - startedAt);
    const sttPrepareMs =
      typeof firstTranscribeStartedAt === "number"
        ? Math.max(0, firstTranscribeStartedAt - startedAt)
        : null;

    const meta = {
      sttSeconds: Math.round(sttTotalMs / 1000),
      sttTotalMs,
      sttPrepareMs,
      sttTranscribeMs: totalTranscribeMs,
      sttTranscribeWorkerMs: stt.meta.transcribeElapsedMs,
      sttVadParameters: stt.meta.vadParameters,
      sttModel: stt.meta.model,
      sttResponseFormat: stt.meta.responseFormat,
      sttDevice: stt.meta.device,
      sttComputeType: stt.meta.computeType,
      sttPipeline: stt.meta.pipeline,
      sttBatchSize: stt.meta.batchSize,
      sttGpuName: stt.meta.gpuName,
      sttGpuComputeCapability: stt.meta.gpuComputeCapability,
      sttGpuSnapshotBefore: stt.meta.gpuSnapshotBefore,
      sttGpuSnapshotAfter: stt.meta.gpuSnapshotAfter,
      sttGpuMonitor: stt.meta.gpuMonitor,
      sttRecoveryUsed: stt.meta.recoveryUsed,
      sttFallbackUsed: stt.meta.fallbackUsed,
      sttAttemptCount: stt.meta.attemptCount,
      sttSegmentCount: stt.meta.segmentCount,
      sttSpeakerCount: stt.meta.speakerCount,
      sttQualityWarnings: stt.meta.qualityWarnings,
      sttNormalizedRetryUsed: normalizedRetryUsed,
      audioDurationSeconds: measuredDurationSeconds,
      sttEngine,
      ...readRunpodWorkerRuntimeMetadata(),
    } satisfies Record<string, unknown>;

    return {
      kind: "success",
      transcriptText,
      rawTextOriginal: stt.rawTextOriginal,
      segments: stt.segments ?? [],
      meta,
      outputJson: {
        rawLength: stt.rawTextOriginal.length,
        segmentCount: (stt.segments ?? []).length,
        sttEngine,
      },
      costMetaJson: {
        seconds: Math.round(sttTotalMs / 1000),
      },
    };
  } finally {
    await localAudio?.cleanup().catch(() => {});
  }
}
