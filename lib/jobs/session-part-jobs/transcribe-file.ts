import { JobStatus, SessionType } from "@prisma/client";
import { rm } from "node:fs/promises";
import { transcribeAudioForPipeline } from "@/lib/ai/stt";
import { getAudioDurationSeconds, normalizeAudioForStt } from "@/lib/audio-processing";
import { materializeStorageFile } from "@/lib/audio-storage";
import { prisma } from "@/lib/db";
import { evaluateDurationGate, evaluateTranscriptSubstance, getRecordingMaxDurationSeconds } from "@/lib/recording/validation";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { preprocessTranscript, preprocessTranscriptWithSegments } from "@/lib/transcript/preprocess";
import { ensureSessionPartReviewedTranscript } from "@/lib/transcript/review";
import { toPrismaJson } from "@/lib/prisma-json";
import { enqueuePromotionJob, isUnsupportedAudioError, markPartReady, markPartRejected, type SessionPartJobPayload, type SessionPartPayload } from "./shared";

async function transcribeStoredFile(part: SessionPartPayload) {
  if (!part.storageUrl) {
    throw new Error("session part storage is missing");
  }

  const startedAt = Date.now();
  let localAudio: Awaited<ReturnType<typeof materializeStorageFile>> | null = null;
  let liveMeta =
    part.qualityMetaJson && typeof part.qualityMetaJson === "object" && !Array.isArray(part.qualityMetaJson)
      ? ({ ...part.qualityMetaJson } as Record<string, unknown>)
      : {};
  liveMeta = {
    ...liveMeta,
    transcriptionPhase: "PREPARING_STT",
    transcriptionPhaseUpdatedAt: new Date().toISOString(),
    sttEngine: "faster-whisper",
  };
  let metaPersistChain = Promise.resolve();
  const queueMetaPatch = (patch: Record<string, unknown>) => {
    liveMeta = {
      ...liveMeta,
      ...patch,
    };
    const snapshot = { ...liveMeta };
    metaPersistChain = metaPersistChain
      .then(async () => {
        await prisma.sessionPart.update({
          where: { id: part.id },
          data: {
            qualityMetaJson: toPrismaJson(snapshot),
          },
        });
      })
      .catch((error) => {
        console.error("[sessionPartJobs] Failed to persist transcription progress meta:", error);
      });
    return metaPersistChain;
  };

  await queueMetaPatch({});

  let stt: Awaited<ReturnType<typeof transcribeAudioForPipeline>>;
  let normalizedRetryUsed = false;
  let measuredDurationSeconds: number | null = null;
  const uploadedDurationSecondsRaw =
    typeof part.qualityMetaJson?.audioDurationSeconds === "number"
      ? part.qualityMetaJson.audioDurationSeconds
      : Number(part.qualityMetaJson?.audioDurationSeconds ?? NaN);
  const uploadedDurationSeconds =
    Number.isFinite(uploadedDurationSecondsRaw) && uploadedDurationSecondsRaw > 0
      ? uploadedDurationSecondsRaw
      : null;
  try {
    localAudio = await materializeStorageFile(part.storageUrl, {
      fileName: part.fileName,
    });
    const parsedDurationSeconds = await getAudioDurationSeconds(localAudio.filePath).catch(() => 0);
    measuredDurationSeconds =
      parsedDurationSeconds > 0 && uploadedDurationSeconds !== null
        ? Math.max(parsedDurationSeconds, uploadedDurationSeconds)
        : parsedDurationSeconds > 0
          ? parsedDurationSeconds
          : uploadedDurationSeconds;
    const maxDurationSeconds = getRecordingMaxDurationSeconds(part.sessionType);
    const durationGate = evaluateDurationGate(measuredDurationSeconds, {
      maxSeconds: maxDurationSeconds,
      rejectUnknown: true,
      tooLongMessageJa:
        part.sessionType === SessionType.LESSON_REPORT
          ? "指導報告のチェックイン / チェックアウト音声は1回10分までです。音声を分割して保存してください。"
          : "面談音声は1回60分までです。音声を分割して保存してください。",
      unknownMessageJa:
        part.sessionType === SessionType.LESSON_REPORT
          ? "指導報告音声の長さを確認できませんでした。10分以内のファイルを選び直してください。"
          : "面談音声の長さを確認できませんでした。60分以内のファイルを選び直してください。",
    });
    if (!durationGate.ok) {
      const gateError = new Error(durationGate.messageJa) as Error & {
        durationGate?: typeof durationGate;
      };
      gateError.durationGate = durationGate;
      throw gateError;
    }

    await queueMetaPatch({
      transcriptionPhase: "TRANSCRIBING_EXTERNAL",
      transcriptionPhaseUpdatedAt: new Date().toISOString(),
    });
    stt = await transcribeAudioForPipeline({
      filePath: localAudio.filePath,
      filename: part.fileName || "audio.webm",
      mimeType: part.mimeType || "audio/webm",
      language: "ja",
    });
  } catch (error) {
    if (!isUnsupportedAudioError(error)) throw error;
    if (!localAudio) throw error;
    const normalizedPath = `${localAudio.filePath}.stt-normalized.m4a`;
    try {
      await normalizeAudioForStt(localAudio.filePath, normalizedPath);
      await queueMetaPatch({
        transcriptionPhase: "TRANSCRIBING_EXTERNAL",
        transcriptionPhaseUpdatedAt: new Date().toISOString(),
      });
      stt = await transcribeAudioForPipeline({
        filePath: normalizedPath,
        filename: "audio-normalized.m4a",
        mimeType: "audio/mp4",
        language: "ja",
      });
      normalizedRetryUsed = true;
    } finally {
      await rm(normalizedPath, { force: true }).catch(() => {});
    }
  } finally {
    await localAudio?.cleanup().catch(() => {});
    await metaPersistChain;
  }

  const pre =
    stt.segments.length > 0
      ? preprocessTranscriptWithSegments(stt.rawTextOriginal, stt.segments ?? [])
      : preprocessTranscript(stt.rawTextOriginal);
  await queueMetaPatch({
    transcriptionPhase: "FINALIZING_TRANSCRIPT",
    transcriptionPhaseUpdatedAt: new Date().toISOString(),
  });
  await metaPersistChain;

  return {
    pre,
    segments: stt.segments ?? [],
    qualityMeta: {
      ...(part.qualityMetaJson ?? {}),
      sttSeconds: Math.round((Date.now() - startedAt) / 1000),
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
      transcriptionPhase: "FINALIZING_TRANSCRIPT",
      sttEngine: "faster-whisper",
    },
  };
}

export async function executeTranscribeFileJob(job: SessionPartJobPayload, part: SessionPartPayload) {
  let transcription;
  try {
    transcription = await transcribeStoredFile(part);
  } catch (error: any) {
    if (error?.durationGate && !error.durationGate.ok) {
      await markPartRejected(part, error.durationGate.messageJa, {
        validationRejection: {
          code: error.durationGate.code,
          messageJa: error.durationGate.messageJa,
          durationSeconds: error.durationGate.durationSeconds,
          maxAllowedSeconds: "maxAllowedSeconds" in error.durationGate ? error.durationGate.maxAllowedSeconds : undefined,
          at: new Date().toISOString(),
        },
      });
      await prisma.sessionPartJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.DONE,
          finishedAt: new Date(),
          outputJson: toPrismaJson({
            rejected: true,
            code: error.durationGate.code,
          }),
        },
      });
      await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch((stopError) => {
        console.warn("[sessionPartJobs] failed to stop Runpod worker after duration rejection", stopError);
      });
      return;
    }
    throw error;
  }

  const { pre, segments, qualityMeta } = transcription;

  const substance = evaluateTranscriptSubstance(pre.displayTranscript || pre.rawTextOriginal);

  if (!substance.ok) {
    await markPartRejected(part, substance.messageJa, {
      ...qualityMeta,
      validationRejection: {
        code: substance.code,
        messageJa: substance.messageJa,
        metrics: substance.metrics,
        at: new Date().toISOString(),
      },
    });
    await prisma.sessionPartJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.DONE,
        finishedAt: new Date(),
        outputJson: toPrismaJson({
          rejected: true,
          code: substance.code,
        }),
      },
    });
    await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch((stopError) => {
      console.warn("[sessionPartJobs] failed to stop Runpod worker after transcript rejection", stopError);
    });
    return;
  }

  await markPartReady({
    part,
    rawTextOriginal: pre.rawTextOriginal,
    rawTextCleaned: pre.displayTranscript,
    rawSegments: segments,
    qualityMeta,
  });
  await ensureSessionPartReviewedTranscript(part.id);
  await enqueuePromotionJob(part.id);

  await prisma.sessionPartJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      outputJson: toPrismaJson({
        rawLength: pre.rawTextOriginal.length,
        displayLength: pre.displayTranscript.length,
        segmentCount: segments.length,
        sttEngine: qualityMeta.sttEngine ?? "faster-whisper",
      }),
      costMetaJson: toPrismaJson({
        seconds: Number(qualityMeta.sttSeconds ?? 0),
      }),
    },
  });
}
