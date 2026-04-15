import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type BeginIdempotencyInput = {
  scope: string;
  idempotencyKey: string;
  requestBody: unknown;
  organizationId?: string | null;
  userId?: string | null;
  ttlMs?: number;
};

export class IdempotencyConflictError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "IdempotencyConflictError";
    this.status = status;
  }
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJson(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)])
    );
  }
  return value;
}

export function buildStableRequestHash(value: unknown) {
  return hashText(JSON.stringify(sortJson(value)));
}

function buildIdempotencyKeyHash(scope: string, value: string) {
  return hashText(`${scope}:${value.trim()}`);
}

export async function beginIdempotency(input: BeginIdempotencyInput) {
  const key = input.idempotencyKey.trim();
  if (!key) {
    throw new IdempotencyConflictError("二重実行キーが空です。");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? 24 * 60 * 60 * 1000));
  const keyHash = buildIdempotencyKeyHash(input.scope, key);
  const requestHash = buildStableRequestHash(input.requestBody);

  try {
    await prisma.idempotencyRequest.create({
      data: {
        scope: input.scope,
        keyHash,
        requestHash,
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        status: "PENDING",
        expiresAt,
      },
    });
    return { state: "started" as const, requestHash, keyHash };
  } catch (error: any) {
    if (error?.code !== "P2002") throw error;
  }

  const existing = await prisma.idempotencyRequest.findUnique({
    where: {
      scope_keyHash: {
        scope: input.scope,
        keyHash,
      },
    },
  });

  if (!existing) {
    return beginIdempotency(input);
  }

  if (existing.requestHash !== requestHash) {
    throw new IdempotencyConflictError("同じ操作キーで別の内容が送られました。画面を更新してやり直してください。");
  }

  if (existing.expiresAt <= now || existing.status === "FAILED") {
    await prisma.idempotencyRequest.update({
      where: { id: existing.id },
      data: {
        requestHash,
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        status: "PENDING",
        responseStatus: null,
        responseBody: Prisma.JsonNull,
        completedAt: null,
        expiresAt,
      },
    });
    return { state: "started" as const, requestHash, keyHash };
  }

  if (existing.status === "COMPLETED") {
    return {
      state: "completed" as const,
      requestHash,
      keyHash,
      responseStatus: existing.responseStatus ?? 200,
      responseBody: existing.responseBody,
    };
  }

  return { state: "pending" as const, requestHash, keyHash };
}

export async function completeIdempotency(input: {
  scope: string;
  idempotencyKey: string;
  responseStatus: number;
  responseBody: unknown;
}) {
  const keyHash = buildIdempotencyKeyHash(input.scope, input.idempotencyKey);
  await prisma.idempotencyRequest.updateMany({
    where: {
      scope: input.scope,
      keyHash,
    },
    data: {
      status: "COMPLETED",
      responseStatus: input.responseStatus,
      responseBody: input.responseBody as any,
      completedAt: new Date(),
    },
  });
}

export async function failIdempotency(input: {
  scope: string;
  idempotencyKey: string;
}) {
  const keyHash = buildIdempotencyKeyHash(input.scope, input.idempotencyKey);
  await prisma.idempotencyRequest.updateMany({
    where: {
      scope: input.scope,
      keyHash,
    },
    data: {
      status: "FAILED",
      completedAt: new Date(),
    },
  });
}
