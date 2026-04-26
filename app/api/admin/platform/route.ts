import { NextResponse } from "next/server";
import { getPlatformAdminSnapshot } from "@/lib/admin/platform-console";
import { resolvePlatformOperatorForSession } from "@/lib/admin/platform-operators";
import type { AdminCampusStatus } from "@/lib/admin/platform-admin-types";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_STATUS = new Set<AdminCampusStatus | "all">(["all", "needs_attention", "active", "onboarding", "suspended"]);

function parseNumber(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: Request) {
  try {
    const sessionResult = await requireAuthorizedSession();
    if (sessionResult.response) return sessionResult.response;

    const { session } = sessionResult;
    const operator = await resolvePlatformOperatorForSession({
      email: session.user.email,
      role: session.user.role,
    });

    if (!operator?.permissions.canReadAllCampuses) {
      return NextResponse.json({ error: "PlatformOperator 権限が必要です。" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const rawStatus = searchParams.get("status");
    const status = rawStatus && VALID_STATUS.has(rawStatus as AdminCampusStatus | "all") ? rawStatus : "all";

    const snapshot = await getPlatformAdminSnapshot({
      operator,
      query: searchParams.get("q"),
      status: status as AdminCampusStatus | "all",
      skip: parseNumber(searchParams.get("skip")),
      take: parseNumber(searchParams.get("take")),
    });

    return NextResponse.json(snapshot);
  } catch (error: any) {
    console.error("[GET /api/admin/platform] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
