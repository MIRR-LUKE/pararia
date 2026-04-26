import { NextResponse, type NextRequest } from "next/server";
import { isMaintenanceRoutePath, readBearerToken } from "@/lib/server/route-guards";

const USER = process.env.BASIC_AUTH_USER;
const PASS = process.env.BASIC_AUTH_PASS;
const MAINTENANCE_SECRETS = [
  process.env.CRON_SECRET?.trim(),
  process.env.MAINTENANCE_SECRET?.trim(),
  process.env.MAINTENANCE_CRON_SECRET?.trim(),
].filter((secret): secret is string => Boolean(secret));

function hasMaintenanceAuthorization(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (!isMaintenanceRoutePath(pathname)) {
    return false;
  }

  const bearerToken = readBearerToken(request.headers.get("authorization"));
  if (!bearerToken) {
    return false;
  }

  return MAINTENANCE_SECRETS.some((secret) => bearerToken === secret);
}

function normalizeHost(value: string | null) {
  return value?.split(":")[0]?.trim().toLowerCase() ?? "";
}

function readAdminHosts() {
  return new Set(
    (process.env.PARARIA_ADMIN_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.startsWith("/robots.txt")) {
    return NextResponse.next();
  }

  if (hasMaintenanceAuthorization(request)) {
    return NextResponse.next();
  }

  const adminHosts = readAdminHosts();
  const adminBaseUrl = process.env.PARARIA_ADMIN_BASE_URL?.trim();
  const requestHost = normalizeHost(request.headers.get("host"));
  const isAdminHost = adminHosts.size > 0 && adminHosts.has(requestHost);

  if (isAdminHost && pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    return NextResponse.redirect(url);
  }

  if (!isAdminHost && adminBaseUrl && pathname.startsWith("/admin")) {
    const url = new URL(`${pathname}${request.nextUrl.search}`, adminBaseUrl);
    return NextResponse.redirect(url);
  }

  if (!USER || !PASS) {
    return NextResponse.next();
  }

  const auth = request.headers.get("authorization");
  if (!auth || !auth.startsWith("Basic ")) {
    return new NextResponse("Authorization required", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="PARARIA"',
      },
    });
  }

  const base64 = auth.split(" ")[1] ?? "";
  const decoded = Buffer.from(base64, "base64").toString("utf-8");
  const [user, pass] = decoded.split(":");

  if (user !== USER || pass !== PASS) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="PARARIA"',
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
