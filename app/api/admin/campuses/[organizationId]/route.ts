import { NextResponse } from "next/server";
import { getPlatformCampusDetail } from "@/lib/admin/platform-console";
import { resolvePlatformOperatorForSession } from "@/lib/admin/platform-operators";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ organizationId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
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

    const { organizationId } = await context.params;
    const detail = await getPlatformCampusDetail({ operator, organizationId });
    if (!detail) {
      return NextResponse.json({ error: "校舎が見つかりません。" }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error: any) {
    console.error("[GET /api/admin/campuses/:organizationId] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
