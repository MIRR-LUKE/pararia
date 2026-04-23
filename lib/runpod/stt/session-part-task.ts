import { SessionType } from "@prisma/client";
import { rm } from "node:fs/promises";
import { transcribeAudioForPipeline } from "@/lib/ai/stt";
import { getAudioDurationSeconds, normalizeAudioForStt } from "@/lib/audio-processing";
import { materializeStorageFile } from "@/lib/audio-storage";
import {
  evaluateDurationGate,
  evaluateTranscriptSubstance,
  getRecordingMaxDurationSeconds,
} from "@/lib/recording/validation";
import { readRunpodWorkerRuntimeMetadata } from "@/lib/runpod/runtime-metadata";
import { preprocessTranscript, preprocessTranscriptWithSegments } from "@/lib/transcript/preprocess";

export type SessionPartSttTaskInput = {
  id: string;
  storageUrl: string;
  fileName: string | null;
  mimeType: string | null;
  qualityMetaJson: Record<string, unknown> | null;
  sessionType: SessionType;
};

export type SessionPartTranscriptionRejected = {
  kind: "rejected";
  code: string;
  messageJa: string;
  qualityMeta: Record<string, unknown>;
  outputJson: Record<string, unknown>;
};

export type SessionPartTranscriptionSucceeded = {
  kind: "success";
  rawTextOriginal: string;
  rawTextCleaned: string;
  rawSegments: any[];
  qualityMeta: Record<string, unknown>;
  outputJson: Record<string, unknown>;
  costMetaJson: Record<string, unknown>;
};

export type SessionPartTranscriptionResult =
  | SessionPartTranscriptionRejected
  | SessionPartTranscriptionSucceeded;

function readMeasuredDuration(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildRejectedOutcome(
  code: string,
  messageJa: string,
  qualityMeta: Record<string, unknown>
): SessionPartTranscriptionRejected {
  return {
    kind: "rejected",
    code,
    messageJa,
    qualityMeta: {
      ...qualityMeta,
      validationRejection: {
        code,
        messageJa,
        at: new Date().toISOString(),
      },
    },
    outputJson: {
      rejected: true,
      code,
    },
  };
}

function isUnsupportedAudioError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Audio file might be corrupted or unsupported|invalid_value|unsupported/i.test(message);
}

export async function transcribeSessionPartTask(
  input: SessionPartSttTaskInput
): Promise<SessionPartTranscriptionResult> {
  const startedAt = Date.now();
  let firstTranscribeStartedAt: number | null = null;
  let totalTranscribeMs = 0;
  let normalizedRetryUsed = false;
  let measuredDurationSeconds: number | null = null;
  let localAudio: Awaited<ReturnType<typeof materializeStorageFile>> | null = null;
  let stt: Awaited<ReturnType<typeof transcribeAudioForPipeline>> | null = null;
  const uploadedDurationSeconds = readMeasuredDuration(input.qualityMetaJson?.audioDurationSeconds);

  try {
    localAudio = await materializeStorageFile(input.storageUrl, {
      fileName: input.fileName,
    });
    const parsedDurationSeconds = await getAudioDurationSeconds(localAudio.filePath).catch(() => 0);
    measuredDurationSeconds =
      parsedDurationSeconds > 0 && uploadedDurationSeconds !== null
        ? Math.max(parsedDurationSeconds, uploadedDurationSeconds)
        : parsedDurationSeconds > 0
          ? parsedDurationSeconds
          : uploadedDurationSeconds;

    const maxDurationSeconds = getRecordingMaxDurationSeconds(input.sessionType);
    const durationGate = evaluateDurationGate(measuredDurationSeconds, {
      maxSeconds: maxDurationSeconds,
      rejectUnknown: true,
      tooLongMessageJa:
        input.sessionType === SessionType.LESSON_REPORT
          ? "指導報告のチェックイン / チェックアウト音声は1回10分までです。音声を分割して保存してください。"
          : "面談音声は1回60分までです。音声を分割して保存してください。",
      unknownMessageJa:
        input.sessionType === SessionType.LESSON_REPORT
          ? "指導報告音声の長さを確認できませんでした。10分以内のファイルを選び直してください。"
          : "面談音声の長さを確認できませんでした。60分以内のファイルを選び直してください。",
    });
    if (!durationGate.ok) {
      return buildRejectedOutcome(durationGate.code, durationGate.messageJa, {
        ...(input.qualityMetaJson ?? {}),
        audioDurationSeconds: measuredDurationSeconds,
        sttEngine: "faster-whisper",
        ...readRunpodWorkerRuntimeMetadata(),
      });
    }

    try {
      firstTranscribeStartedAt = Date.now();
      const transcribeStartedAt = Date.now();
      stt = await transcribeAudioForPipeline({
        filePath: localAudio.filePath,
        filename: input.fileName || "audio.webm",
        mimeType: input.mimeType || "audio/webm",
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
          filename: "audio-normalized.m4a",
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

    const pre =
      (stt.segments ?? []).length > 0
        ? preprocessTranscriptWithSegments(stt.rawTextOriginal, stt.segments ?? [])
        : preprocessTranscript(stt.rawTextOriginal);
    const substance = evaluateTranscriptSubstance(pre.displayTranscript || pre.rawTextOriginal);
    const finishedAt = Date.now();
    const sttTotalMs = Math.max(0, finishedAt - startedAt);
    const sttPrepareMs =
      typeof firstTranscribeStartedAt === "number"
        ? Math.max(0, firstTranscribeStartedAt - startedAt)
        : null;
    const finalizePhaseMs = Math.max(0, finishedAt - Math.max(firstTranscribeStartedAt ?? startedAt, startedAt));

    const qualityMeta = {
      ...(input.qualityMetaJson ?? {}),
      sttSeconds: Math.round(sttTotalMs / 1000),
      sttTotalMs,
      sttPrepareMs,
      sttTranscribeMs: totalTranscribeMs,
      sttFinalizeMs: finalizePhaseMs,
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
      sttEngine: "faster-whisper",
      ...readRunpodWorkerRuntimeMetadata(),
    } satisfies Record<string, unknown>;

    if (!substance.ok) {
      return {
        kind: "rejected",
        code: substance.code,
        messageJa: substance.messageJa,
        qualityMeta: {
          ...qualityMeta,
          validationRejection: {
            code: substance.code,
            messageJa: substance.messageJa,
            metrics: substance.metrics,
            at: new Date().toISOString(),
          },
        },
        outputJson: {
          rejected: true,
          code: substance.code,
        },
      };
    }

    return {
      kind: "success",
      rawTextOriginal: pre.rawTextOriginal,
      rawTextCleaned: pre.displayTranscript,
      rawSegments: stt.segments ?? [],
      qualityMeta,
      outputJson: {
        rawLength: pre.rawTextOriginal.length,
        displayLength: pre.displayTranscript.length,
        segmentCount: (stt.segments ?? []).length,
        sttEngine: qualityMeta.sttEngine ?? "faster-whisper",
      },
      costMetaJson: {
        seconds: Number(qualityMeta.sttSeconds ?? 0),
      },
    };
  } finally {
    await localAudio?.cleanup().catch(() => {});
  }
}
