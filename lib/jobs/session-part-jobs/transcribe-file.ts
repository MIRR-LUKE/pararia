import { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { ensureSessionPartReviewedTranscript } from "@/lib/transcript/review";
import { toPrismaJson } from "@/lib/prisma-json";
import {
  transcribeSessionPartTask,
  type SessionPartTranscriptionResult,
} from "@/lib/runpod/stt/session-part-task";
import { enqueuePromotionJob, markPartReady, markPartRejected, type SessionPartJobPayload, type SessionPartPayload } from "./shared";

export async function applySessionPartTranscriptionOutcome(input: {
  job: SessionPartJobPayload;
  part: SessionPartPayload;
  outcome: SessionPartTranscriptionResult;
}) {
  const { job, part, outcome } = input;

  if (outcome.kind === "rejected") {
    await markPartRejected(part, outcome.messageJa, outcome.qualityMeta);
    await prisma.sessionPartJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.DONE,
        finishedAt: new Date(),
        outputJson: toPrismaJson(outcome.outputJson),
      },
    });
    await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch((stopError) => {
      console.warn("[sessionPartJobs] failed to stop Runpod worker after transcript rejection", stopError);
    });
    return;
  }

  await markPartReady({
    part,
    rawTextOriginal: outcome.rawTextOriginal,
    rawTextCleaned: outcome.rawTextCleaned,
    rawSegments: outcome.rawSegments,
    qualityMeta: outcome.qualityMeta,
  });
  await ensureSessionPartReviewedTranscript(part.id);
  await enqueuePromotionJob(part.id);

  await prisma.sessionPartJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      outputJson: toPrismaJson(outcome.outputJson),
      costMetaJson: toPrismaJson(outcome.costMetaJson),
    },
  });
}

export async function executeTranscribeFileJob(job: SessionPartJobPayload, part: SessionPartPayload) {
  if (!part.storageUrl) {
    throw new Error("session part storage is missing");
  }

  const outcome = await transcribeSessionPartTask({
    id: part.id,
    storageUrl: part.storageUrl,
    fileName: part.fileName,
    mimeType: part.mimeType,
    qualityMetaJson: part.qualityMetaJson,
    sessionType: part.sessionType,
  });
  await applySessionPartTranscriptionOutcome({
    job,
    part,
    outcome,
  });
}
