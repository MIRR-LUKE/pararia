#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { prisma } from "@/lib/db";
import { dispatchRumEvent } from "@/lib/observability/rum";
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
  const originalEnv = {
    NEXT_PUBLIC_PARARIA_RUM_ENABLED: process.env.NEXT_PUBLIC_PARARIA_RUM_ENABLED,
    NEXT_PUBLIC_PARARIA_RUM_SAMPLE_RATE: process.env.NEXT_PUBLIC_PARARIA_RUM_SAMPLE_RATE,
    PARARIA_RUM_LOG_ENABLED: process.env.PARARIA_RUM_LOG_ENABLED,
    PARARIA_RUM_LOG_SAMPLE_RATE: process.env.PARARIA_RUM_LOG_SAMPLE_RATE,
  };
  const env = process.env as Record<string, string | undefined>;
  const globalAny = globalThis as typeof globalThis & {
    window?: unknown;
    navigator?: { sendBeacon?: (...args: any[]) => boolean };
  };
  const originalWindow = globalAny.window;
  const originalNavigator = globalAny.navigator;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

  function buildRequest() {
    return new Request("https://example.com/api/rum", {
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
  }

  try {
    console.info = (...args: unknown[]) => {
      infoMessages.push(args.map((value) => String(value)).join(" "));
    };

    env.NEXT_PUBLIC_PARARIA_RUM_ENABLED = "1";
    env.NEXT_PUBLIC_PARARIA_RUM_SAMPLE_RATE = "1";

    const response = await POST(buildRequest());
    assert.equal(response.status, 204, "rum route should accept valid payload");
    assert.equal(infoMessages.length, 0, "rum route should stay quiet unless logging is enabled");

    env.PARARIA_RUM_LOG_ENABLED = "1";
    env.PARARIA_RUM_LOG_SAMPLE_RATE = "1";
    const loggedResponse = await POST(buildRequest());
    assert.equal(loggedResponse.status, 204, "rum route should still accept valid payload when logging is enabled");
    assert.ok(infoMessages.some((message) => message.includes("\"pathname\":\"/app/students/123\"")));
    assert.ok(infoMessages.every((message) => !message.includes("token=secret")), "search query should not be logged");

    env.PARARIA_RUM_LOG_SAMPLE_RATE = "0";
    infoMessages.length = 0;
    const sampledOutResponse = await POST(buildRequest());
    assert.equal(sampledOutResponse.status, 204, "rum route should accept valid payload when log sampling is off");
    assert.equal(infoMessages.length, 0, "rum route should not log when the sample rate is zero");

    const beaconCalls: unknown[] = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      enumerable: true,
      value: {},
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      enumerable: true,
      value: {
        sendBeacon: (...args: any[]) => {
          beaconCalls.push(args);
          return true;
        },
      },
      writable: true,
    });

    env.NEXT_PUBLIC_PARARIA_RUM_ENABLED = "";
    const disabledDispatch = dispatchRumEvent({
      kind: "route-timing",
      routeKey: "/app/students/123",
      pathname: "/app/students/123",
      search: "",
      durationMs: 1,
      transitionSource: "pushState",
      navigationType: "navigate",
      sentAt: new Date().toISOString(),
    });
    assert.equal(disabledDispatch, false, "client rum should stay disabled until opted in");
    assert.equal(beaconCalls.length, 0, "client rum should not beacon when disabled");

    env.NEXT_PUBLIC_PARARIA_RUM_ENABLED = "1";
    env.NEXT_PUBLIC_PARARIA_RUM_SAMPLE_RATE = "1";
    const enabledDispatch = dispatchRumEvent({
      kind: "route-timing",
      routeKey: "/app/students/123",
      pathname: "/app/students/123",
      search: "",
      durationMs: 1,
      transitionSource: "pushState",
      navigationType: "navigate",
      sentAt: new Date().toISOString(),
    });
    assert.equal(enabledDispatch, true, "client rum should send when enabled");
    assert.equal(beaconCalls.length, 1, "client rum should beacon once when enabled");

    store.clear();

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

    for (let index = 0; index < 60; index += 1) {
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
    if (originalEnv.NEXT_PUBLIC_PARARIA_RUM_ENABLED === undefined) {
      delete env.NEXT_PUBLIC_PARARIA_RUM_ENABLED;
    } else {
      env.NEXT_PUBLIC_PARARIA_RUM_ENABLED = originalEnv.NEXT_PUBLIC_PARARIA_RUM_ENABLED;
    }
    if (originalEnv.NEXT_PUBLIC_PARARIA_RUM_SAMPLE_RATE === undefined) {
      delete env.NEXT_PUBLIC_PARARIA_RUM_SAMPLE_RATE;
    } else {
      env.NEXT_PUBLIC_PARARIA_RUM_SAMPLE_RATE = originalEnv.NEXT_PUBLIC_PARARIA_RUM_SAMPLE_RATE;
    }
    if (originalEnv.PARARIA_RUM_LOG_ENABLED === undefined) {
      delete env.PARARIA_RUM_LOG_ENABLED;
    } else {
      env.PARARIA_RUM_LOG_ENABLED = originalEnv.PARARIA_RUM_LOG_ENABLED;
    }
    if (originalEnv.PARARIA_RUM_LOG_SAMPLE_RATE === undefined) {
      delete env.PARARIA_RUM_LOG_SAMPLE_RATE;
    } else {
      env.PARARIA_RUM_LOG_SAMPLE_RATE = originalEnv.PARARIA_RUM_LOG_SAMPLE_RATE;
    }
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        enumerable: windowDescriptor?.enumerable ?? true,
        value: originalWindow,
        writable: windowDescriptor?.writable ?? true,
      });
    }
    if (originalNavigator === undefined) {
      Reflect.deleteProperty(globalThis, "navigator");
    } else {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        enumerable: navigatorDescriptor?.enumerable ?? true,
        value: originalNavigator,
        writable: navigatorDescriptor?.writable ?? true,
      });
    }
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
