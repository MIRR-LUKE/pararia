import { NextResponse } from "next/server";
import {
  exportPlatformAuditLogs,
  renderPlatformAuditCsv,
  type PlatformAuditExportFormat,
} from "@/lib/admin/platform-audit-search";
import { resolvePlatformOperatorForSession } from "@/lib/admin/platform-operators";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseNumber(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFormat(value: string | null): PlatformAuditExportFormat {
  return value === "json" ? "json" : "csv";
}

function getRequestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
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
      return NextResponse.json({ error: "監査ログのエクスポート権限が必要です。" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const format = parseFormat(searchParams.get("format"));
    const rows = await exportPlatformAuditLogs({
      operator,
      format,
      filters: {
        from: searchParams.get("from"),
        to: searchParams.get("to"),
        operator: searchParams.get("operator"),
        campus: searchParams.get("campus"),
        action: searchParams.get("action"),
        status: searchParams.get("status"),
        take: parseNumber(searchParams.get("take")) ?? 1000,
      },
      request: {
        requestId: request.headers.get("x-request-id"),
        ipAddress: getRequestIp(request),
        userAgent: request.headers.get("user-agent"),
      },
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (format === "json") {
      return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), rows }, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="platform-audit-${timestamp}.json"`,
        },
      });
    }

    return new NextResponse(renderPlatformAuditCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="platform-audit-${timestamp}.csv"`,
      },
    });
  } catch (error: any) {
    console.error("[GET /api/admin/audit/export] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
