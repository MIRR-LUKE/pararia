import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

type ApiThrottleRule = {
  windowMs: number;
  blockMs: number;
  maxRequests: number;
  maxBytes?: number;
};

type ConsumeApiQuotaInput = {
  scope: string;
  rawKey: string;
  bytes?: number | null;
  rule: ApiThrottleRule;
};

export class ApiQuotaExceededError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "ApiQuotaExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function hashApiThrottleKey(scope: string, rawKey: string) {
  return createHash("sha256")
    .update(`${scope}:${rawKey.trim().toLowerCase()}`)
    .digest("hex");
}

function clampNonNegativeInt(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(0, Math.floor(value ?? 0));
}

function buildBlockedError(scope: string, blockedUntil: Date, rule: ApiThrottleRule) {
  const retryAfterSeconds = Math.max(1, Math.ceil((blockedUntil.getTime() - Date.now()) / 1000));
  const message =
    scope.includes("report")
      ? "レポート生成が短時間に集中しました。少し待ってからもう一度お試しください。"
      : scope.includes("blob")
        ? "音声アップロードが短時間に集中しました。少し待ってからもう一度お試しください。"
        : "重い処理が短時間に集中しました。少し待ってからもう一度お試しください。";
  return new ApiQuotaExceededError(message, Math.max(1, Math.min(retryAfterSeconds, Math.ceil(rule.blockMs / 1000))));
}

export async function consumeApiQuota(input: ConsumeApiQuotaInput) {
  const rawKey = input.rawKey.trim();
  if (!rawKey) return;

  const now = new Date();
  const keyHash = hashApiThrottleKey(input.scope, rawKey);
  const current = await prisma.apiThrottleBucket.findUnique({
    where: {
      scope_keyHash: {
        scope: input.scope,
        keyHash,
      },
    },
  });

  if (!current) {
    const nextBytes = clampNonNegativeInt(input.bytes);
    if (
      1 > input.rule.maxRequests ||
      (typeof input.rule.maxBytes === "number" && nextBytes > input.rule.maxBytes)
    ) {
      throw buildBlockedError(input.scope, new Date(now.getTime() + input.rule.blockMs), input.rule);
    }

    await prisma.apiThrottleBucket.create({
      data: {
        scope: input.scope,
        keyHash,
        requestCount: 1,
        byteCount: nextBytes,
        windowStartedAt: now,
      },
    });
    return;
  }

  if (current.blockedUntil && current.blockedUntil > now) {
    throw buildBlockedError(input.scope, current.blockedUntil, input.rule);
  }

  const windowExpired = now.getTime() - current.windowStartedAt.getTime() > input.rule.windowMs;
  const nextRequestCount = windowExpired ? 1 : current.requestCount + 1;
  const nextByteCount = (windowExpired ? 0 : current.byteCount) + clampNonNegativeInt(input.bytes);

  if (
    nextRequestCount > input.rule.maxRequests ||
    (typeof input.rule.maxBytes === "number" && nextByteCount > input.rule.maxBytes)
  ) {
    const blockedUntil = new Date(now.getTime() + input.rule.blockMs);
    await prisma.apiThrottleBucket.update({
      where: { id: current.id },
      data: {
        requestCount: nextRequestCount,
        byteCount: nextByteCount,
        windowStartedAt: windowExpired ? now : current.windowStartedAt,
        blockedUntil,
      },
    });
    throw buildBlockedError(input.scope, blockedUntil, input.rule);
  }

  await prisma.apiThrottleBucket.update({
    where: { id: current.id },
    data: {
      requestCount: nextRequestCount,
      byteCount: nextByteCount,
      windowStartedAt: windowExpired ? now : current.windowStartedAt,
      blockedUntil: null,
    },
  });
}

export const API_THROTTLE_RULES = {
  publicRumIp: {
    windowMs: 10 * 60 * 1000,
    blockMs: 10 * 60 * 1000,
    maxRequests: 60,
  },
  writeUser: {
    windowMs: 5 * 60 * 1000,
    blockMs: 10 * 60 * 1000,
    maxRequests: 30,
  },
  writeOrg: {
    windowMs: 5 * 60 * 1000,
    blockMs: 10 * 60 * 1000,
    maxRequests: 120,
  },
  writeIp: {
    windowMs: 5 * 60 * 1000,
    blockMs: 10 * 60 * 1000,
    maxRequests: 45,
  },
  blobUploadUser: {
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
    maxRequests: 30,
    maxBytes: 2 * 1024 * 1024 * 1024,
  },
  blobUploadOrg: {
    windowMs: 15 * 60 * 1000,
    blockMs: 10 * 60 * 1000,
    maxRequests: 120,
    maxBytes: 8 * 1024 * 1024 * 1024,
  },
  sessionPartUser: {
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
    maxRequests: 24,
    maxBytes: 2 * 1024 * 1024 * 1024,
  },
  sessionPartOrg: {
    windowMs: 15 * 60 * 1000,
    blockMs: 10 * 60 * 1000,
    maxRequests: 96,
    maxBytes: 8 * 1024 * 1024 * 1024,
  },
  reportGenerateUser: {
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
    maxRequests: 8,
  },
  reportGenerateOrg: {
    windowMs: 15 * 60 * 1000,
    blockMs: 10 * 60 * 1000,
    maxRequests: 40,
  },
} satisfies Record<string, ApiThrottleRule>;
