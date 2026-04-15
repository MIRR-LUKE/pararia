import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

function readPositiveIntEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

const FAILURE_WINDOW_MS = readPositiveIntEnv("AUTH_THROTTLE_FAILURE_WINDOW_MS", 10 * 60 * 1000, 60_000, 60 * 60 * 1000);
const BLOCK_DURATION_MS = readPositiveIntEnv("AUTH_THROTTLE_BLOCK_MS", 15 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000);
const MAX_FAILURES = readPositiveIntEnv("AUTH_THROTTLE_MAX_FAILURES", 5, 3, 20);

export class AuthRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("短時間に試行が集中しました。少し待ってからもう一度お試しください。");
    this.name = "AuthRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function hashThrottleKey(scope: string, rawKey: string) {
  return createHash("sha256")
    .update(`${scope}:${rawKey.trim().toLowerCase()}`)
    .digest("hex");
}

function resolveBlockDeadline(now: Date) {
  return new Date(now.getTime() + BLOCK_DURATION_MS);
}

function readHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function getRequestIp(request: Request | { headers?: Headers | null } | null | undefined) {
  const headers = request?.headers;
  if (!headers) return null;

  const forwardedFor = readHeader(headers, "x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = readHeader(headers, "x-real-ip");
  if (realIp) return realIp;

  const cfIp = readHeader(headers, "cf-connecting-ip");
  if (cfIp) return cfIp;

  return null;
}

export async function assertAuthThrottleAllowed(scope: string, rawKey: string) {
  const key = rawKey.trim().toLowerCase();
  if (!key) return;

  const bucket = await prisma.authThrottle.findUnique({
    where: {
      scope_keyHash: {
        scope,
        keyHash: hashThrottleKey(scope, key),
      },
    },
    select: {
      blockedUntil: true,
    },
  });

  if (!bucket?.blockedUntil) return;

  const now = new Date();
  if (bucket.blockedUntil <= now) return;

  throw new AuthRateLimitError(Math.max(1, Math.ceil((bucket.blockedUntil.getTime() - now.getTime()) / 1000)));
}

export async function recordAuthThrottleFailure(scope: string, rawKey: string) {
  const key = rawKey.trim().toLowerCase();
  if (!key) return;

  const now = new Date();
  const keyHash = hashThrottleKey(scope, key);
  const current = await prisma.authThrottle.findUnique({
    where: {
      scope_keyHash: {
        scope,
        keyHash,
      },
    },
    select: {
      id: true,
      failureCount: true,
      windowStartedAt: true,
    },
  });

  if (!current) {
    await prisma.authThrottle.create({
      data: {
        scope,
        keyHash,
        failureCount: 1,
        windowStartedAt: now,
        lastFailureAt: now,
      },
    });
    return;
  }

  const withinWindow = now.getTime() - current.windowStartedAt.getTime() <= FAILURE_WINDOW_MS;
  const failureCount = withinWindow ? current.failureCount + 1 : 1;
  const blockedUntil = failureCount >= MAX_FAILURES ? resolveBlockDeadline(now) : null;

  await prisma.authThrottle.update({
    where: { id: current.id },
    data: {
      failureCount,
      windowStartedAt: withinWindow ? current.windowStartedAt : now,
      lastFailureAt: now,
      blockedUntil,
    },
  });
}

export async function clearAuthThrottle(scope: string, rawKey: string) {
  const key = rawKey.trim().toLowerCase();
  if (!key) return;

  await prisma.authThrottle.deleteMany({
    where: {
      scope,
      keyHash: hashThrottleKey(scope, key),
    },
  });
}
