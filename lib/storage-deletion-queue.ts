import { prisma } from "@/lib/db";
import { deleteStorageEntryDetailed } from "@/lib/audio-storage";
import { getRuntimeDeletionTargets } from "@/lib/runtime-cleanup";
import { markExpiredBlobUploadReservations } from "@/lib/blob-upload-reservations";

const STORAGE_DELETE_MAX_ATTEMPTS = 3;

export async function enqueueStorageDeletion(input: {
  storageUrl: string | null | undefined;
  organizationId?: string | null;
  reason: string;
}) {
  const storageUrl = String(input.storageUrl || "").trim();
  if (!storageUrl) return null;

  return prisma.storageDeletionRequest.upsert({
    where: {
      storageUrl,
    },
    update: {
      organizationId: input.organizationId ?? null,
      reason: input.reason,
      status: "PENDING",
      attempts: 0,
      lastError: null,
      completedAt: null,
      nextAttemptAt: null,
    },
    create: {
      organizationId: input.organizationId ?? null,
      storageUrl,
      reason: input.reason,
    },
  });
}

export async function enqueueStorageDeletions(input: {
  storageUrls: Array<string | null | undefined>;
  organizationId?: string | null;
  reason: string;
}) {
  const queued: string[] = [];
  for (const storageUrl of input.storageUrls) {
    const created = await enqueueStorageDeletion({
      storageUrl,
      organizationId: input.organizationId ?? null,
      reason: input.reason,
    });
    if (created) queued.push(created.storageUrl);
  }
  return queued;
}

export async function enqueueRuntimeDeletionTargets(input: {
  filePaths: Array<string | null | undefined>;
  organizationId?: string | null;
  reason: string;
}) {
  const targets = Array.from(new Set(input.filePaths.flatMap((filePath) => getRuntimeDeletionTargets(filePath))));
  const queued = await enqueueStorageDeletions({
    storageUrls: targets,
    organizationId: input.organizationId ?? null,
    reason: input.reason,
  });
  return { targets, queued };
}

export async function processPendingStorageDeletionRequests(limit = 100) {
  const now = new Date();
  const rows = await prisma.storageDeletionRequest.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let deletedCount = 0;
  let failedCount = 0;
  const failures: Array<{ storageUrl: string; error: string }> = [];

  for (const row of rows) {
    const result = await deleteStorageEntryDetailed(row.storageUrl);
    if (result.ok) {
      deletedCount += 1;
      await prisma.storageDeletionRequest.update({
        where: { id: row.id },
        data: {
          status: "COMPLETED",
          attempts: row.attempts + 1,
          lastError: null,
          lastAttemptAt: now,
          completedAt: now,
          nextAttemptAt: null,
        },
      });
      continue;
    }

    failedCount += 1;
    const attempts = row.attempts + 1;
    const finalFailure = attempts >= STORAGE_DELETE_MAX_ATTEMPTS;
    const error = result.error ?? "storage deletion failed";
    failures.push({ storageUrl: row.storageUrl, error });
    await prisma.storageDeletionRequest.update({
      where: { id: row.id },
      data: {
        status: finalFailure ? "FAILED" : "PENDING",
        attempts,
        lastError: error,
        lastAttemptAt: now,
        nextAttemptAt: finalFailure ? null : new Date(now.getTime() + attempts * 5 * 60 * 1000),
      },
    });
  }

  return {
    deletedCount,
    failedCount,
    failures,
    processedCount: rows.length,
  };
}

export async function queueExpiredBlobUploadReservationsForDeletion(now = new Date()) {
  const expired = await markExpiredBlobUploadReservations(now);
  const queued = await enqueueStorageDeletions({
    storageUrls: expired.map((entry) => entry.blobUrl),
    reason: "expired_blob_upload_reservation",
  });
  return {
    expiredCount: expired.length,
    queuedCount: queued.length,
  };
}
