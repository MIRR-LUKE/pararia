import { NextResponse } from "next/server";
import { isRumEvent, type RumEvent } from "@/lib/observability/rum";
import { applyPublicIpThrottle } from "@/lib/server/request-throttle";
import { parseJsonWithByteLimit } from "@/lib/server/request-body";

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

export async function POST(request: Request) {
  try {
    const throttleResponse = await applyPublicIpThrottle({ request, scope: "rum" });
    if (throttleResponse) return throttleResponse;

    const payload = (await parseJsonWithByteLimit(request, 16 * 1024, "RUM")) as unknown;
    if (!isRumEvent(payload)) {
      return new NextResponse(null, { status: 204 });
    }

    console.info("[rum]", JSON.stringify(normalizeEvent(payload)));
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
