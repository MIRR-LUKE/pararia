import assert from "node:assert/strict";
import { prisma } from "../lib/db";
import {
  assertAuthThrottleAllowed,
  AuthRateLimitError,
  clearAuthThrottle,
  getRequestIp,
  recordAuthThrottleFailure,
} from "../lib/auth-throttle";

type Bucket = {
  id: string;
  scope: string;
  keyHash: string;
  failureCount: number;
  windowStartedAt: Date;
  lastFailureAt: Date | null;
  blockedUntil: Date | null;
};

const store = new Map<string, Bucket>();
const original = {
  findUnique: prisma.authThrottle.findUnique.bind(prisma.authThrottle),
  create: prisma.authThrottle.create.bind(prisma.authThrottle),
  update: prisma.authThrottle.update.bind(prisma.authThrottle),
  deleteMany: prisma.authThrottle.deleteMany.bind(prisma.authThrottle),
};

let idCounter = 0;

function bucketKey(scope: string, keyHash: string) {
  return `${scope}:${keyHash}`;
}

(prisma.authThrottle.findUnique as any) = async ({ where }: any) => {
  const key = bucketKey(where.scope_keyHash.scope, where.scope_keyHash.keyHash);
  return store.get(key) ?? null;
};

(prisma.authThrottle.create as any) = async ({ data }: any) => {
  const bucket: Bucket = {
    id: `bucket-${++idCounter}`,
    scope: data.scope,
    keyHash: data.keyHash,
    failureCount: data.failureCount,
    windowStartedAt: data.windowStartedAt,
    lastFailureAt: data.lastFailureAt ?? null,
    blockedUntil: data.blockedUntil ?? null,
  };
  store.set(bucketKey(bucket.scope, bucket.keyHash), bucket);
  return bucket;
};

(prisma.authThrottle.update as any) = async ({ where, data }: any) => {
  const match = Array.from(store.values()).find((bucket) => bucket.id === where.id);
  assert.ok(match, "bucket should exist");
  const updated = {
    ...match,
    ...data,
  };
  store.set(bucketKey(updated.scope, updated.keyHash), updated);
  return updated;
};

(prisma.authThrottle.deleteMany as any) = async ({ where }: any) => {
  const key = bucketKey(where.scope, where.keyHash);
  const existed = store.delete(key);
  return { count: existed ? 1 : 0 };
};

try {
  const ip = getRequestIp(
    new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
    })
  );
  assert.equal(ip, "203.0.113.10");

  for (let i = 0; i < 5; i += 1) {
    await recordAuthThrottleFailure("login_email", "admin@example.com");
  }

  await assert.rejects(
    () => assertAuthThrottleAllowed("login_email", "admin@example.com"),
    (error: unknown) => error instanceof AuthRateLimitError
  );

  await clearAuthThrottle("login_email", "admin@example.com");
  await assert.doesNotReject(() => assertAuthThrottleAllowed("login_email", "admin@example.com"));

  console.log("auth throttle regression checks passed");
} finally {
  (prisma.authThrottle.findUnique as any) = original.findUnique;
  (prisma.authThrottle.create as any) = original.create;
  (prisma.authThrottle.update as any) = original.update;
  (prisma.authThrottle.deleteMany as any) = original.deleteMany;
  store.clear();
}
