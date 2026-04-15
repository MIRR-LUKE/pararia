import { NextResponse } from "next/server";

function normalizeOrigin(raw: string | null | undefined) {
  const value = raw?.trim() ?? "";
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function readRequestOrigin(request: Request) {
  const origin = normalizeOrigin(request.headers.get("origin"));
  if (origin) return origin;

  const referer = normalizeOrigin(request.headers.get("referer"));
  if (referer) return referer;

  return null;
}

function isLocalHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function isSameLocalOrigin(expectedOrigin: string, requestOrigin: string) {
  try {
    const expected = new URL(expectedOrigin);
    const received = new URL(requestOrigin);
    return (
      expected.protocol === received.protocol &&
      expected.port === received.port &&
      isLocalHostname(expected.hostname) &&
      isLocalHostname(received.hostname)
    );
  } catch {
    return false;
  }
}

export function requireSameOriginRequest(request: Request, message = "同じサイトから実行してください。") {
  const expectedOrigin = new URL(request.url).origin;
  const requestOrigin = readRequestOrigin(request);
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase() ?? "";

  if (requestOrigin && requestOrigin !== expectedOrigin && !isSameLocalOrigin(expectedOrigin, requestOrigin)) {
    return NextResponse.json({ error: message }, { status: 403 });
  }

  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return NextResponse.json({ error: message }, { status: 403 });
  }

  return null;
}

export function methodNotAllowedResponse(allowedMethods: string[]) {
  return NextResponse.json(
    { error: "Method Not Allowed" },
    {
      status: 405,
      headers: {
        Allow: allowedMethods.join(", "),
      },
    }
  );
}
