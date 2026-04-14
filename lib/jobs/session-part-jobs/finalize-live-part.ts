import { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { finalizeLiveTranscriptionPart } from "@/lib/live-session-transcription";
import { evaluateTranscriptSubstance } from "@/lib/recording/validation";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { ensureSessionPartReviewedTranscript } from "@/lib/transcript/review";
import { toPrismaJson } from "@/lib/prisma-json";
import { enqueuePromotionJob, markPartReady, markPartRejected, type SessionPartJobPayload, type SessionPartPayload } from "./shared";

export async function executeFinalizeLivePartJob(job: SessionPartJobPayload, part: SessionPartPayload) {
  const startedAt = Date.now();
  const finalized = await finalizeLiveTranscriptionPart(part.sessionId, part.partType);
  const substance = evaluateTranscriptSubstance(finalized.displayTranscript || finalized.rawTextOriginal);

  if (!substance.ok) {
    await markPartRejected(part, substance.messageJa, {
      ...finalized.qualityMeta,
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
      console.warn("[sessionPartJobs] failed to stop Runpod worker after live transcript rejection", stopError);
    });
    return;
  }

  await markPartReady({
    part,
    fileName: finalized.fileName,
    mimeType: finalized.mimeType,
    byteSize: finalized.byteSize,
    storageUrl: finalized.storageUrl,
    rawTextOriginal: finalized.rawTextOriginal,
    rawTextCleaned: finalized.displayTranscript,
    rawSegments: finalized.rawSegments,
    qualityMeta: finalized.qualityMeta,
  });
  await ensureSessionPartReviewedTranscript(part.id);
  await enqueuePromotionJob(part.id);

  await prisma.sessionPartJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      outputJson: toPrismaJson({
        rawLength: finalized.rawTextOriginal.length,
        displayLength: finalized.displayTranscript.length,
        segmentCount: finalized.rawSegments.length,
      }),
      costMetaJson: toPrismaJson({
        seconds: Math.round((Date.now() - startedAt) / 1000),
      }),
    },
  });
}
