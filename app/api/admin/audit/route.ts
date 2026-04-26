import { NextResponse } from "next/server";
import { searchPlatformAuditLogs } from "@/lib/admin/platform-audit-search";
import { resolvePlatformOperatorForSession } from "@/lib/admin/platform-operators";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

    if (!operator?.permissions.canReadAuditLogs) {
      return NextResponse.json({ error: "監査ログの閲覧権限が必要です。" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const result = await searchPlatformAuditLogs({
      from: searchParams.get("from"),
      to: searchParams.get("to"),
      operator: searchParams.get("operator"),
      campus: searchParams.get("campus"),
      action: searchParams.get("action"),
      status: searchParams.get("status"),
      take: parseNumber(searchParams.get("take")),
      skip: parseNumber(searchParams.get("skip")),
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[GET /api/admin/audit] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
