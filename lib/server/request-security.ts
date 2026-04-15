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

export function requireSameOriginRequest(request: Request, message = "同じサイトから実行してください。") {
  const expectedOrigin = new URL(request.url).origin;
  const requestOrigin = readRequestOrigin(request);

  if (!requestOrigin || requestOrigin !== expectedOrigin) {
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
