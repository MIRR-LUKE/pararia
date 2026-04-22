#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { prisma } from "@/lib/db";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";

type Bucket = {
  id: string;
  scope: string;
  keyHash: string;
  requestCount: number;
  byteCount: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
};

const store = new Map<string, Bucket>();
const original = {
  findUnique: prisma.apiThrottleBucket.findUnique.bind(prisma.apiThrottleBucket),
  create: prisma.apiThrottleBucket.create.bind(prisma.apiThrottleBucket),
  update: prisma.apiThrottleBucket.update.bind(prisma.apiThrottleBucket),
};
const originalWarn = console.warn;

let idCounter = 0;

function bucketKey(scope: string, keyHash: string) {
  return `${scope}:${keyHash}`;
}

(prisma.apiThrottleBucket.findUnique as any) = async ({ where }: any) => {
  const key = bucketKey(where.scope_keyHash.scope, where.scope_keyHash.keyHash);
  return store.get(key) ?? null;
};

(prisma.apiThrottleBucket.create as any) = async ({ data }: any) => {
  const bucket: Bucket = {
    id: `bucket-${++idCounter}`,
    scope: data.scope,
    keyHash: data.keyHash,
    requestCount: data.requestCount,
    byteCount: data.byteCount,
    windowStartedAt: data.windowStartedAt,
    blockedUntil: data.blockedUntil ?? null,
  };
  store.set(bucketKey(bucket.scope, bucket.keyHash), bucket);
  return bucket;
};

(prisma.apiThrottleBucket.update as any) = async ({ where, data }: any) => {
  const match = Array.from(store.values()).find((bucket) => bucket.id === where.id);
  assert.ok(match, "bucket should exist");
  const updated = {
    ...match,
    ...data,
  };
  store.set(bucketKey(updated.scope, updated.keyHash), updated);
  return updated;
};

try {
  const warningMessages: string[] = [];
  console.warn = (...args: unknown[]) => {
    warningMessages.push(args.map((value) => String(value)).join(" "));
  };

  const request = new Request("https://example.com/api/test", {
    headers: {
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
    },
  });

  const bypassResponse = await applyLightMutationThrottle({
    request,
    scope: "sessions.progress",
    userId: "teacher-progress",
    organizationId: "org-progress",
  });
  assert.equal(bypassResponse, null, "progress wake scopes should bypass write throttle");
  assert.equal(store.size, 0, "bypass scopes should not touch ApiThrottleBucket");

  const teacherBypassResponse = await applyLightMutationThrottle({
    request,
    scope: "teacher.recordings.progress",
    userId: "teacher-native",
    organizationId: "org-progress",
  });
  assert.equal(teacherBypassResponse, null, "teacher progress wake scopes should bypass write throttle");
  assert.equal(store.size, 0, "teacher bypass scopes should not touch ApiThrottleBucket");

  const firstResponse = await applyLightMutationThrottle({
    request,
    scope: "students.create",
    userId: "teacher-1",
    organizationId: "org-1",
  });
  assert.equal(firstResponse, null, "first write should pass");

  assert.equal(store.size >= 3, true, "user / org / ip buckets should be created");

  for (let index = 0; index < 29; index += 1) {
    const response = await applyLightMutationThrottle({
      request,
      scope: "students.create",
      userId: "teacher-1",
      organizationId: "org-1",
    });
    assert.equal(response, null, "quota should still allow requests before the limit");
  }

  const blockedResponse = await applyLightMutationThrottle({
    request,
    scope: "students.create",
    userId: "teacher-1",
    organizationId: "org-1",
  });
  assert.equal(blockedResponse?.status, 429, "over-limit write should return 429");
  assert.ok(blockedResponse?.headers.get("Retry-After"), "429 response should include Retry-After");

  (prisma.apiThrottleBucket.findUnique as any) = async () => {
    throw {
      code: "P2021",
      meta: { table: "public.ApiThrottleBucket" },
    };
  };

  const fallbackResponse = await applyLightMutationThrottle({
    request,
    scope: "students.update",
    userId: "teacher-2",
    organizationId: "org-1",
  });
  assert.equal(fallbackResponse, null, "missing throttle table should not break writes");
  assert.equal(
    warningMessages.filter((message) => message.includes("ApiThrottleBucket table is missing")).length,
    1,
    "missing throttle table warning should be emitted once"
  );

  (prisma.apiThrottleBucket.findUnique as any) = async () => {
    throw new Error("Invalid `prisma.apiThrottleBucket.findUnique()` invocation: Timed out fetching a new connection from the connection pool. More info: http://pris.ly/d/connection-pool (Current connection pool timeout: 20, connection limit: 1)");
  };

  const saturationResponse = await applyLightMutationThrottle({
    request,
    scope: "students.update",
    userId: "teacher-3",
    organizationId: "org-1",
  });
  assert.equal(saturationResponse, null, "database pool saturation in throttle should not break writes");
  assert.equal(
    warningMessages.filter((message) => message.includes("ApiThrottleBucket is temporarily bypassed because the database pool is saturated")).length,
    1,
    "database pool saturation warning should be emitted once"
  );

  console.log("write throttle regression checks passed");
} finally {
  console.warn = originalWarn;
  (prisma.apiThrottleBucket.findUnique as any) = original.findUnique;
  (prisma.apiThrottleBucket.create as any) = original.create;
  (prisma.apiThrottleBucket.update as any) = original.update;
  store.clear();
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  // no-op entrypoint gate for tsx consistency
}
