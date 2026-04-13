import { JobStatus, Prisma, SessionPartJobType, SessionPartStatus, SessionPartType, SessionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildSummaryPreview, readSessionPartMeta, toSessionPartMetaJson } from "@/lib/session-part-meta";
import { toPrismaJson } from "@/lib/prisma-json";
import { updateSessionStatusFromParts } from "@/lib/session-service";
import { getAudioExpiryDate } from "@/lib/system-config";

export type SessionPartJobPayload = {
  id: string;
  sessionPartId: string;
  type: SessionPartJobType;
};

export type SessionPartPayload = {
  id: string;
  sessionId: string;
  partType: SessionPartType;
  status: SessionPartStatus;
  sourceType: string;
  fileName: string | null;
  mimeType: string | null;
  byteSize: number | null;
  storageUrl: string | null;
  rawTextOriginal: string | null;
  rawTextCleaned: string | null;
  rawSegments: any[];
  qualityMetaJson: Record<string, unknown> | null;
  sessionType: SessionType;
};

export type SessionPartRecoveryPayload = {
  id: string;
  sessionId: string;
  status: SessionPartStatus;
  rawTextOriginal: string | null;
  rawTextCleaned: string | null;
  qualityMetaJson: Record<string, unknown> | null;
  session: {
    conversation: {
      status: string;
    } | null;
  };
};

export type ProcessSessionPartJobsOptions = {
  sessionId?: string;
};

export function isUnsupportedAudioError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Audio file might be corrupted or unsupported|invalid_value|unsupported/i.test(message);
}

export function partHasTranscript(part: Pick<SessionPartPayload, "rawTextOriginal" | "rawTextCleaned">) {
  return Boolean(part.rawTextCleaned?.trim() || part.rawTextOriginal?.trim());
}

export async function loadSessionPart(job: SessionPartJobPayload): Promise<SessionPartPayload> {
  const part = await prisma.sessionPart.findUnique({
    where: { id: job.sessionPartId },
    include: {
      session: {
        select: {
          id: true,
          type: true,
        },
      },
    },
  });
  if (!part?.session) throw new Error("session part not found");
  return {
    id: part.id,
    sessionId: part.sessionId,
    partType: part.partType,
    status: part.status,
    sourceType: part.sourceType,
    fileName: part.fileName,
    mimeType: part.mimeType,
    byteSize: part.byteSize,
    storageUrl: part.storageUrl,
    rawTextOriginal: part.rawTextOriginal,
    rawTextCleaned: part.rawTextCleaned,
    rawSegments: Array.isArray(part.rawSegments) ? (part.rawSegments as any[]) : [],
    qualityMetaJson:
      part.qualityMetaJson && typeof part.qualityMetaJson === "object" && !Array.isArray(part.qualityMetaJson)
        ? (part.qualityMetaJson as Record<string, unknown>)
        : null,
    sessionType: part.session.type,
  };
}

export async function markPartRejected(
  part: SessionPartPayload,
  message: string,
  details: Record<string, unknown>
) {
  const meta = readSessionPartMeta(part.qualityMetaJson);
  await prisma.sessionPart.update({
    where: { id: part.id },
    data: {
      status: SessionPartStatus.ERROR,
      qualityMetaJson: toSessionPartMetaJson(meta, {
        ...details,
        pipelineStage: "REJECTED",
        retryPending: false,
      }),
    },
  });
  await updateSessionStatusFromParts(part.sessionId);
  return { rejected: true, message };
}

export async function markPartExecutionError(part: SessionPartPayload, errorMessage: string) {
  const meta = readSessionPartMeta(part.qualityMetaJson);
  await prisma.sessionPart.update({
    where: { id: part.id },
    data: {
      status: SessionPartStatus.ERROR,
      qualityMetaJson: toSessionPartMetaJson(meta, {
        pipelineStage: "ERROR",
        errorSource: "TRANSCRIPTION",
        lastError: errorMessage,
        retryPending: false,
      }),
    },
  });
  await updateSessionStatusFromParts(part.sessionId);
}

export async function markPartPromotionError(part: SessionPartPayload, errorMessage: string) {
  const meta = readSessionPartMeta(part.qualityMetaJson);
  await prisma.sessionPart.update({
    where: { id: part.id },
    data: {
      status: SessionPartStatus.ERROR,
      qualityMetaJson: toSessionPartMetaJson(meta, {
        pipelineStage: "ERROR",
        errorSource: "PROMOTION",
        lastError: errorMessage,
        lastPromotionErrorAt: new Date().toISOString(),
        retryPending: false,
      }),
    },
  });
  await updateSessionStatusFromParts(part.sessionId);
}

export async function markPartReady(input: {
  part: SessionPartPayload;
  fileName?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  storageUrl?: string | null;
  rawTextOriginal: string;
  rawTextCleaned: string;
  rawSegments: any[];
  qualityMeta: Record<string, unknown>;
}) {
  await prisma.sessionPart.update({
    where: { id: input.part.id },
    data: {
      status: SessionPartStatus.READY,
      fileName: input.fileName ?? input.part.fileName,
      mimeType: input.mimeType ?? input.part.mimeType,
      byteSize: input.byteSize ?? input.part.byteSize,
      storageUrl: input.storageUrl ?? input.part.storageUrl,
      rawTextOriginal: input.rawTextOriginal,
      rawTextCleaned: input.rawTextCleaned,
      reviewedText: null,
      reviewState: "NONE",
      rawSegments: toPrismaJson(input.rawSegments),
      qualityMetaJson: toSessionPartMetaJson(input.part.qualityMetaJson, {
        ...input.qualityMeta,
        lastError: null,
        errorSource: undefined,
        pipelineStage: "READY",
        retryPending: false,
        summaryPreview: buildSummaryPreview(input.rawTextCleaned || input.rawTextOriginal),
        lastCompletedAt: new Date().toISOString(),
      }),
      transcriptExpiresAt: getAudioExpiryDate(),
    },
  });
  await updateSessionStatusFromParts(input.part.sessionId);
}

export async function enqueuePromotionJob(sessionPartId: string) {
  return prisma.sessionPartJob.upsert({
    where: {
      sessionPartId_type: {
        sessionPartId,
        type: SessionPartJobType.PROMOTE_SESSION,
      },
    },
    update: {
      status: JobStatus.QUEUED,
      lastError: null,
      outputJson: Prisma.DbNull,
      costMetaJson: Prisma.DbNull,
      startedAt: null,
      finishedAt: null,
    },
    create: {
      sessionPartId,
      type: SessionPartJobType.PROMOTE_SESSION,
      status: JobStatus.QUEUED,
    },
  });
}
