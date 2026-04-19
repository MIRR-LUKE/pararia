import { NextResponse } from "next/server";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { requireTeacherAppSessionForRequest } from "@/lib/server/teacher-app-session";
import { loadTeacherRecordingSummary } from "@/lib/teacher-app/server/recordings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: RouteParams }) {
  try {
    const authResult = await requireTeacherAppSessionForRequest(request);
    if (authResult.response) return authResult.response;

    const recordingId = await resolveRouteId(params);
    if (!recordingId) {
      return NextResponse.json({ error: "recordingId が必要です。" }, { status: 400 });
    }

    const recording = await loadTeacherRecordingSummary({
      organizationId: authResult.session.organizationId,
      deviceLabel: authResult.session.deviceLabel,
      recordingId,
    });
    if (!recording) {
      return NextResponse.json({ error: "録音セッションが見つかりません。" }, { status: 404 });
    }

    return NextResponse.json({
      recording,
    });
  } catch (error: any) {
    console.error("[GET /api/teacher/recordings/[id]] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
