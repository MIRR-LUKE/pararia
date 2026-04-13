import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/students/dashboard-snapshot";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;

    const snapshot = await getDashboardSnapshot({
      organizationId: authResult.session.user.organizationId,
      candidateLimit: 16,
      queueLimit: 8,
    });

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error: any) {
    console.error("[GET /api/dashboard] Error:", {
      error: error?.message,
      stack: error?.stack,
    });

    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
