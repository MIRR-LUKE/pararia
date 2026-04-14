import { NextResponse } from "next/server";
import { getCachedLogListPageData } from "@/lib/logs/get-log-list-page-data";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get("studentId");
    const data = await getCachedLogListPageData({
      organizationId: authResult.session.user.organizationId,
      studentId,
    });

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error: any) {
    console.error("[GET /api/logs] Error:", {
      error: error?.message,
      stack: error?.stack,
    });

    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
