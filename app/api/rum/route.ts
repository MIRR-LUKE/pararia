import { NextResponse } from "next/server";
import { isRumEvent, type RumEvent } from "@/lib/observability/rum";

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
      search: event.search,
      navigationType: event.navigationType,
      sentAt: event.sentAt,
    };
  }

  return {
    kind: event.kind,
    routeKey: event.routeKey,
    pathname: event.pathname,
    search: event.search,
    durationMs: event.durationMs,
    transitionSource: event.transitionSource,
    navigationType: event.navigationType,
    sentAt: event.sentAt,
  };
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as unknown;
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
}
