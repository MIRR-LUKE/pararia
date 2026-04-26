import { NextResponse } from "next/server";
import { getAdminOperationsSnapshot } from "@/lib/admin/get-admin-operations-snapshot";
import { resolvePlatformOperatorForSession } from "@/lib/admin/platform-operators";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const sessionResult = await requireAuthorizedSession();
    if (sessionResult.response) return sessionResult.response;

    const { session } = sessionResult;
    const operator = await resolvePlatformOperatorForSession({
      email: session.user.email,
      role: session.user.role,
    });

    if (!operator?.permissions.canPrepareWriteActions) {
      return NextResponse.json({ error: "PlatformOperator 権限が必要です。" }, { status: 403 });
    }

    const organizationId = new URL(request.url).searchParams.get("organizationId")?.trim();
    if (!organizationId) {
      return NextResponse.json({ error: "対象校舎を指定してください。" }, { status: 400 });
    }

    const snapshot = await getAdminOperationsSnapshot({
      organizationId,
      viewerRole: session.user.role,
      viewerEmail: session.user.email,
    });

    if (!snapshot) {
      return NextResponse.json({ error: "organization not found" }, { status: 404 });
    }

    return NextResponse.json(snapshot);
  } catch (error: any) {
    console.error("[GET /api/admin/operations] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
