import { NextResponse } from "next/server";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { requireTeacherAppMutationSession } from "@/lib/server/teacher-app-session";
import { confirmTeacherRecordingStudent } from "@/lib/teacher-app/server/recordings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, { params }: { params: RouteParams }) {
  try {
    const authResult = await requireTeacherAppMutationSession(request);
    if (authResult.response) return authResult.response;

    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "teacher.recordings.confirm",
      userId: authResult.session.userId,
      organizationId: authResult.session.organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const recordingId = await resolveRouteId(params);
    if (!recordingId) {
      return NextResponse.json({ error: "recordingId が必要です。" }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as { studentId?: string | null } | null;
    const studentId = typeof body?.studentId === "string" && body.studentId.trim() ? body.studentId.trim() : null;

    await confirmTeacherRecordingStudent({
      organizationId: authResult.session.organizationId,
      deviceLabel: authResult.session.deviceLabel,
      recordingId,
      studentId,
    });

    return NextResponse.json({
      ok: true,
    });
  } catch (error: any) {
    console.error("[POST /api/teacher/recordings/[id]/confirm] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
