import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const RUNPOD_WAKE_LEASE_SCOPE = "runpod-worker-wake-lease";
const DEFAULT_RUNPOD_WAKE_LEASE_TTL_MS = 30_000;

// Reuse the existing idempotency table as a tiny distributed lease so we never
// hold a Postgres connection open while waiting on the Runpod API.

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function buildLeaseKeyHash(workerName: string) {
  return hashText(`${RUNPOD_WAKE_LEASE_SCOPE}:${workerName.trim()}`);
}

export async function acquireRunpodWorkerWakeLease(
  workerName: string,
  workerImage: string,
  ttlMs = DEFAULT_RUNPOD_WAKE_LEASE_TTL_MS
) {
  const keyHash = buildLeaseKeyHash(workerName);
  const ownerToken = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  const data = {
    scope: RUNPOD_WAKE_LEASE_SCOPE,
    keyHash,
    requestHash: ownerToken,
    organizationId: null,
    userId: null,
    status: "PENDING",
    responseStatus: null,
    responseBody: Prisma.JsonNull,
    completedAt: null,
    expiresAt,
  } as const;

  try {
    await prisma.idempotencyRequest.create({
      data,
    });
    return {
      acquired: true,
      ownerToken,
    };
  } catch (error: any) {
    if (error?.code !== "P2002") {
      throw error;
    }
  }

  const updated = await prisma.idempotencyRequest.updateMany({
    where: {
      scope: RUNPOD_WAKE_LEASE_SCOPE,
      keyHash,
      OR: [
        { status: { not: "PENDING" } },
        { expiresAt: { lte: now } },
      ],
    },
    data,
  });

  return {
    acquired: updated.count > 0,
    ownerToken,
    workerImage,
  };
}

export async function releaseRunpodWorkerWakeLease(
  workerName: string,
  ownerToken: string,
  ok: boolean
) {
  const keyHash = buildLeaseKeyHash(workerName);
  await prisma.idempotencyRequest.updateMany({
    where: {
      scope: RUNPOD_WAKE_LEASE_SCOPE,
      keyHash,
      requestHash: ownerToken,
      status: "PENDING",
    },
    data: {
      status: ok ? "COMPLETED" : "FAILED",
      responseStatus: ok ? 200 : 500,
      responseBody: {
        workerName,
        ok,
      },
      completedAt: new Date(),
      expiresAt: new Date(),
    },
  });
}
