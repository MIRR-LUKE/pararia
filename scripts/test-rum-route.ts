#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { prisma } from "@/lib/db";
import { POST } from "../app/api/rum/route";
import { applyPublicIpThrottle } from "@/lib/server/request-throttle";

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

async function main() {
  const infoMessages: string[] = [];
  const originalInfo = console.info;

  try {
    console.info = (...args: unknown[]) => {
      infoMessages.push(args.map((value) => String(value)).join(" "));
    };

    const request = new Request("https://example.com/api/rum", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.20, 10.0.0.1",
      },
      body: JSON.stringify({
        kind: "route-timing",
        routeKey: "/app/students/123",
        pathname: "/app/students/123",
        search: "?token=secret&draft=1",
        durationMs: 128,
        transitionSource: "pushState",
        navigationType: "navigate",
        sentAt: new Date().toISOString(),
      }),
    });

    const response = await POST(request);
    assert.equal(response.status, 204, "rum route should accept valid payload");
    assert.ok(infoMessages.some((message) => message.includes("\"pathname\":\"/app/students/123\"")));
    assert.ok(infoMessages.every((message) => !message.includes("token=secret")), "search query should not be logged");

    const largePayload = {
      kind: "route-timing",
      routeKey: "/app/students/123",
      pathname: "/app/students/123",
      search: "",
      durationMs: 128,
      transitionSource: "pushState",
      navigationType: "navigate",
      sentAt: new Date().toISOString(),
      extra: "x".repeat(20_000),
    };
    const largeResponse = await POST(
      new Request("https://example.com/api/rum", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(largePayload),
      })
    );
    assert.equal(largeResponse.status, 413, "rum route should reject oversized bodies");

    const throttleRequest = new Request("https://example.com/api/rum", {
      headers: {
        "x-forwarded-for": "203.0.113.20, 10.0.0.1",
      },
    });

    for (let index = 0; index < 59; index += 1) {
      const throttleResponse = await applyPublicIpThrottle({
        request: throttleRequest,
        scope: "rum",
      });
      assert.equal(throttleResponse, null, "public throttle should allow requests before the limit");
    }

    const blockedResponse = await applyPublicIpThrottle({
      request: throttleRequest,
      scope: "rum",
    });
    assert.equal(blockedResponse?.status, 429, "public throttle should return 429 after the limit");
    assert.ok(blockedResponse?.headers.get("Retry-After"), "public throttle should set Retry-After");

    console.log("rum route regression checks passed");
  } finally {
    console.info = originalInfo;
    (prisma.apiThrottleBucket.findUnique as any) = original.findUnique;
    (prisma.apiThrottleBucket.create as any) = original.create;
    (prisma.apiThrottleBucket.update as any) = original.update;
    store.clear();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
