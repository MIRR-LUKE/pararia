import { NextResponse } from "next/server";
import { isRumEvent, type RumEvent } from "@/lib/observability/rum";
import { applyPublicIpThrottle } from "@/lib/server/request-throttle";
import { parseJsonWithByteLimit } from "@/lib/server/request-body";

function normalizeLogSampleRate(value: string | undefined) {
  if (!value) return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  if (parsed <= 0) return 0;
  if (parsed >= 1) return 1;
  return parsed;
}

function stableHash(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return (hash >>> 0) / 2 ** 32;
}

function normalizeEvent(event: RumEvent) {
  if (event.kind === "web-vital") {
    return {
      kind: event.kind,
      name: event.name,
      id: event.id,
      value: event.value,
      delta: event.delta,
      rating: event.rating,
      routeKey: event.routeKey,
      pathname: event.pathname,
      navigationType: event.navigationType,
      sentAt: event.sentAt,
    };
  }

  return {
    kind: event.kind,
    routeKey: event.routeKey,
    pathname: event.pathname,
    durationMs: event.durationMs,
    transitionSource: event.transitionSource,
    navigationType: event.navigationType,
    sentAt: event.sentAt,
  };
}

function shouldLogRumEvent(event: RumEvent) {
  if (process.env.PARARIA_RUM_LOG_ENABLED !== "1") return false;

  const sampleRate = normalizeLogSampleRate(process.env.PARARIA_RUM_LOG_SAMPLE_RATE);
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;

  const seed = `${event.kind}:${event.routeKey}:${event.pathname}:${event.sentAt}`;
  return stableHash(seed) < sampleRate;
}

export async function POST(request: Request) {
  try {
    const throttleResponse = await applyPublicIpThrottle({ request, scope: "rum" });
    if (throttleResponse) return throttleResponse;

    const payload = (await parseJsonWithByteLimit(request, 16 * 1024, "RUM")) as unknown;
    if (!isRumEvent(payload)) {
      return new NextResponse(null, { status: 204 });
    }

    if (shouldLogRumEvent(payload)) {
      console.info("[rum]", JSON.stringify(normalizeEvent(payload)));
    }
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error: any) {
    if (error?.status === 413) {
      return NextResponse.json({ error: error.message ?? "本文が大きすぎます。" }, { status: 413 });
    }

    console.error("[POST /api/rum]", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
